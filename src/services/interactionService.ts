
import * as NGL from 'ngl';
import { InteractionType } from '../types';
import {
  THRESHOLDS, ATOM_PROPS, COVALENT_RADII, GENERIC_LIGAND_NAMES, COFACTOR_GLYCAN_LIPID, ADDITIVES,
  IGNORED_RESIDUES, MODIFIED_RESIDUES, CATIONIC_HIS, NEUTRAL_HIS, aromaticResName,
} from '../constants';
import { distance, getCenter, ringPlane, angleBetween, angleDeg, lateralOffset } from './geometryUtils';
import type { AtomData, Interaction, ResidueOption, AnalysisResult, Point3D } from '../types';

/** NGL does not export its AtomProxy class at the top level; derive the type instead. */
type AtomProxy = Parameters<Parameters<NGL.Structure['eachAtom']>[0]>[0];

// ---------------------------------------------------------------------------
// Structure preparation
// ---------------------------------------------------------------------------

export interface PreparedStructure {
  /** First model only — the same model 3Dmol displays by default. */
  structure: NGL.Structure;
  /** Number of models in the file (docking poses, NMR models, ...). */
  modelCount: number;
}

/**
 * Multi-model files (docking poses, NMR ensembles) are restricted to their first
 * model so that the analysis matches what the viewer draws. Previously every model
 * was merged: two poses gave twice the ligand atoms, each interacting with both
 * copies of the protein.
 */
export const prepareStructure = (structure: NGL.Structure): PreparedStructure => {
  const modelCount = structure.modelStore.count;
  if (modelCount <= 1) return { structure, modelCount };
  return { structure: structure.getView(new NGL.Selection('/0')), modelCount };
};

/**
 * Alternate conformations: keep blank and 'A' only, exactly as 3Dmol does when it
 * draws the structure. NGL keeps every altloc, which double-counted disordered atoms.
 */
const isPrimaryAltloc = (ap: AtomProxy): boolean => {
  const alt = ap.altloc;
  return !alt || alt === 'A' || alt === ' ' || alt === '.' || alt === '?';
};

const parseNGLAtom = (ap: AtomProxy): AtomData => ({
  index: ap.index,
  name: ap.atomname,
  element: ap.element.toUpperCase(),
  x: ap.x,
  y: ap.y,
  z: ap.z,
  resName: ap.resname,
  resNo: ap.resno,
  chain: ap.chainname,
  isHet: ap.isHetero(),
  resKey: ap.residueIndex,
  insCode: ap.inscode || '',
});

// ---------------------------------------------------------------------------
// Geometric bond perception (PDB-type input carries no bond orders)
// ---------------------------------------------------------------------------

const isMetalElement = (el: string) => ATOM_PROPS.METALS.has(el);
const covalentRadius = (el: string) => COVALENT_RADII[el] ?? 0.77;

/** Covalent bond by radius sum + tolerance (as Open Babel). Metal coordination is not a covalent bond here. */
const isBonded = (a: AtomData, b: AtomData): boolean => {
  if (isMetalElement(a.element) || isMetalElement(b.element)) return false;
  const d = distance(a, b);
  return d > 0.4 && d <= covalentRadius(a.element) + covalentRadius(b.element) + THRESHOLDS.BOND_TOLERANCE;
};

const buildAdjacency = (atoms: AtomData[]): number[][] => {
  const adj: number[][] = atoms.map(() => []);
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      if (isBonded(atoms[i], atoms[j])) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  return adj;
};

// --- Helper: nearest covalently bonded carbon to a halogen ---
// C-X bond lengths run 1.75 (C-Cl) to 2.14 (C-I); 2.2 covers all three.
const HALOGEN_CARBON_BOND_MAX = 2.2;
const findBondedCarbon = (halogen: AtomData, atoms: AtomData[]): AtomData | null => {
  let best: AtomData | null = null;
  let bestD = Infinity;
  for (const a of atoms) {
    if (a.element !== 'C') continue;
    const d = distance(a, halogen);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best && bestD <= HALOGEN_CARBON_BOND_MAX ? best : null;
};

// --- Ligand ring detection (DFS over the bond graph), returned in ring order ---
const findRings = (adj: number[][], atoms: AtomData[]): number[][] => {
  const rings: number[][] = [];
  const seen = new Set<string>();
  const dfs = (start: number, current: number, path: number[]) => {
    if (path.length > 6) return;
    if (path.length >= 5 && adj[current].includes(start)) {
      const key = [...path].sort((a, b) => a - b).join(',');
      if (!seen.has(key)) {
        seen.add(key);
        rings.push(path);
      }
      return;
    }
    for (const nb of adj[current]) {
      if (!path.includes(nb)) dfs(start, nb, [...path, nb]);
    }
  };
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i].element === 'C' || atoms[i].element === 'N') dfs(i, i, [i]);
  }
  return rings;
};

const RING_ELEMENTS = new Set(['C', 'N', 'O', 'S']);

/**
 * Aromaticity from geometry: a 5/6-membered ring is aromatic only if it is planar,
 * has no sp3 (4-connected) atoms, and has short (delocalised) bonds. Previously every
 * 5/6-membered ring counted, so sugars, cyclohexanes and piperidines "pi-stacked".
 */
const isAromaticRing = (ring: number[], atoms: AtomData[], adj: number[][]): boolean => {
  const ringAtoms = ring.map(i => atoms[i]);
  if (!ringAtoms.every(a => RING_ELEMENTS.has(a.element))) return false;
  if (ring.some(i => adj[i].length > 3)) return false;
  if (ringPlane(ringAtoms).maxDeviation > THRESHOLDS.AROMATIC_PLANARITY) return false;
  let sum = 0, n = 0;
  for (let k = 0; k < ringAtoms.length; k++) {
    const a = ringAtoms[k], b = ringAtoms[(k + 1) % ringAtoms.length];
    if (a.element === 'S' || b.element === 'S') continue; // C-S is long even when aromatic
    sum += distance(a, b);
    n++;
  }
  return n === 0 || sum / n <= THRESHOLDS.AROMATIC_MEAN_BOND;
};

interface Ring {
  atoms: AtomData[];
  center: Point3D;
  normal: Point3D;
}

const makeRing = (atoms: AtomData[]): Ring => {
  const { center, normal } = ringPlane(atoms);
  return { atoms, center, normal };
};

// ---------------------------------------------------------------------------
// Charged groups
// ---------------------------------------------------------------------------

interface ChargedGroup {
  sign: 1 | -1;
  /** The formally charged heavy atoms (used for salt-bridge distances). */
  atoms: AtomData[];
  /** Charge centre (used for cation-pi). */
  center: Point3D;
  kind: string;
}

const POLAR = new Set(['C', 'N', 'O', 'S']);

/**
 * Ligand charged groups, perceived from geometry. Previously ANY ligand nitrogen
 * was treated as a cation and ANY O/S/P as an anion (hydroxyls, ethers, amides,
 * sulfonamides, aromatic N ...).
 *   cations: quaternary ammonium, aliphatic amines, amidinium/guanidinium, sulfonium
 *   anions:  carboxylate, phosphate/phosphonate, sulfate/sulfonate
 */
const findLigandChargedGroups = (atoms: AtomData[], adj: number[][], aromatic: Set<number>): ChargedGroup[] => {
  const groups: ChargedGroup[] = [];
  const el = (i: number) => atoms[i].element;
  const d = (i: number, j: number) => distance(atoms[i], atoms[j]);
  const terminalO = (i: number) => adj[i].filter(j => el(j) === 'O' && adj[j].length === 1);
  // sp3 carbon: not aromatic and no short (multiple / conjugated) bond to C/N/O/S.
  const isSp3Carbon = (i: number) =>
    el(i) === 'C' && !aromatic.has(i) && !adj[i].some(j => POLAR.has(el(j)) && d(i, j) < 1.41);
  const isPlanar = (i: number) => {
    const nb = adj[i];
    if (nb.length !== 3) return false;
    const a = angleDeg(atoms[nb[0]], atoms[i], atoms[nb[1]]);
    const b = angleDeg(atoms[nb[1]], atoms[i], atoms[nb[2]]);
    const c = angleDeg(atoms[nb[2]], atoms[i], atoms[nb[0]]);
    return a + b + c >= 350;
  };

  for (let i = 0; i < atoms.length; i++) {
    const nb = adj[i];
    switch (el(i)) {
      case 'N': {
        if (aromatic.has(i)) break;
        if (nb.length === 4) {
          groups.push({ sign: 1, atoms: [atoms[i]], center: atoms[i], kind: 'quaternary ammonium' });
        } else if (
          nb.every(j => el(j) === 'C' && isSp3Carbon(j) && d(i, j) >= 1.43) &&
          !isPlanar(i)
        ) {
          groups.push({ sign: 1, atoms: [atoms[i]], center: atoms[i], kind: 'amine' });
        }
        break;
      }
      case 'C': {
        if (nb.length !== 3 || aromatic.has(i)) break;
        const ns = nb.filter(j => el(j) === 'N');
        const os = terminalO(i);
        if (ns.length >= 2 && !nb.some(j => el(j) === 'O' || el(j) === 'S') && ns.every(j => !aromatic.has(j))) {
          groups.push({
            sign: 1,
            atoms: ns.map(j => atoms[j]),
            center: atoms[i],
            kind: ns.length === 3 ? 'guanidinium' : 'amidinium',
          });
        } else if (os.length === 2) {
          const oAtoms = os.map(j => atoms[j]);
          groups.push({ sign: -1, atoms: oAtoms, center: getCenter(oAtoms), kind: 'carboxylate' });
        }
        break;
      }
      case 'P': {
        const os = terminalO(i);
        if (os.length >= 2) {
          groups.push({ sign: -1, atoms: os.map(j => atoms[j]), center: atoms[i], kind: 'phosphate' });
        }
        break;
      }
      case 'S': {
        const allO = nb.filter(j => el(j) === 'O');
        const os = terminalO(i);
        if (allO.length >= 3 && os.length >= 2) {
          groups.push({ sign: -1, atoms: os.map(j => atoms[j]), center: atoms[i], kind: 'sulfonate' });
        } else if (nb.length === 3 && nb.every(j => el(j) === 'C')) {
          groups.push({ sign: 1, atoms: [atoms[i]], center: atoms[i], kind: 'sulfonium' });
        }
        break;
      }
    }
  }
  return groups;
};

/** Protein charged group of one residue, or null if the residue is neutral. */
const proteinChargedGroup = (resAtoms: AtomData[], metals: AtomData[]): ChargedGroup | null => {
  const name = resAtoms[0].resName.toUpperCase();
  const pick = (names: string[]) => names.map(n => resAtoms.find(a => a.name === n)).filter((a): a is AtomData => !!a);
  const build = (sign: 1 | -1, names: string[]): ChargedGroup | null => {
    const atoms = pick(names);
    return atoms.length ? { sign, atoms, center: getCenter(atoms), kind: name } : null;
  };

  if (ATOM_PROPS.NEG_CHARGE_ATOMS[name]) return build(-1, ATOM_PROPS.NEG_CHARGE_ATOMS[name]);
  if (name === 'ARG' || name === 'LYS') return build(1, ATOM_PROPS.POS_CHARGE_ATOMS[name]);
  if (CATIONIC_HIS.has(name)) return build(1, ATOM_PROPS.POS_CHARGE_ATOMS.HIS);
  if (NEUTRAL_HIS.has(name) || name !== 'HIS') return null;

  // Plain 'HIS': protonation is not stated in the file.
  if (resAtoms.some(a => a.element === 'H')) {
    // Hydrogens present: cationic only when both ring nitrogens carry one.
    const hd1 = resAtoms.some(a => a.name === 'HD1');
    const he2 = resAtoms.some(a => a.name === 'HE2');
    return hd1 && he2 ? build(1, ATOM_PROPS.POS_CHARGE_ATOMS.HIS) : null;
  }
  // No hydrogens: cationic by PLIP convention, except a metal ligand, which is neutral.
  const ringN = pick(ATOM_PROPS.POS_CHARGE_ATOMS.HIS);
  if (ringN.some(n => metals.some(m => distance(n, m) <= THRESHOLDS.METAL_DIST))) return null;
  return build(1, ATOM_PROPS.POS_CHARGE_ATOMS.HIS);
};

// ---------------------------------------------------------------------------
// Ligand candidates
// ---------------------------------------------------------------------------

/** Ranking tier: generic docking names, then other hetero groups, then cofactors/glycans/lipids, then additives. */
const candidateTier = (name: string): number => {
  if (GENERIC_LIGAND_NAMES.has(name)) return 0;
  if (ADDITIVES.has(name)) return 3;
  if (COFACTOR_GLYCAN_LIPID.has(name)) return 2;
  return 1;
};

export const getLigandCandidates = (structure: NGL.Structure): ResidueOption[] => {
  type Entry = {
    resName: string; resNo: number; chain: string; atomCount: number;
    centerX: number; centerY: number; centerZ: number; heavy: Point3D[];
  };
  const residueMap: Map<string, Entry> = new Map();

  structure.eachResidue((rp) => {
    const name = rp.resname.toUpperCase();
    if (IGNORED_RESIDUES.has(name) || MODIFIED_RESIDUES.has(name) || rp.isWater()) return;
    const forced = GENERIC_LIGAND_NAMES.has(name) || COFACTOR_GLYCAN_LIPID.has(name);
    if (!forced && !rp.isHetero()) return;

    const key = `${rp.chainname}:${rp.resno}:${rp.resname}`;
    if (residueMap.has(key)) return;
    let sumX = 0, sumY = 0, sumZ = 0, count = 0;
    const heavy: Point3D[] = [];
    const heavyEl: string[] = [];
    rp.eachAtom((ap) => {
      if (!isPrimaryAltloc(ap)) return;
      sumX += ap.x; sumY += ap.y; sumZ += ap.z; count++;
      if (ap.element.toUpperCase() !== 'H') { heavy.push({ x: ap.x, y: ap.y, z: ap.z }); heavyEl.push(ap.element.toUpperCase()); }
    });
    if (heavy.length === 0) return;
    // Lone metal ions under names not listed above are coordination partners, not ligands.
    if (heavy.length === 1 && isMetalElement(heavyEl[0])) return;
    residueMap.set(key, {
      resName: rp.resname, resNo: rp.resno, chain: rp.chainname, atomCount: heavy.length,
      centerX: sumX / count, centerY: sumY / count, centerZ: sumZ / count, heavy,
    });
  });

  // Group residues with same name/chain that are covalently connected (polymer chains).
  const residues = Array.from(residueMap.values());
  const grouped: ResidueOption[] = [];
  const visited = new Set<Entry>();

  // Two residues belong to the same polymer if any pair of their heavy atoms is
  // within covalent bonding distance. Glycosidic C-O is ~1.40 A and peptide C-N
  // ~1.33 A, so 1.9 A accepts every real linkage while rejecting mere packing.
  const POLYMER_BOND_MAX = 1.9;
  const areBonded = (a: Entry, b: Entry): boolean => {
    const dc = Math.sqrt((a.centerX - b.centerX) ** 2 + (a.centerY - b.centerY) ** 2 + (a.centerZ - b.centerZ) ** 2);
    if (dc > 25) return false; // cheap bounding-sphere reject
    for (const p of a.heavy) {
      for (const q of b.heavy) {
        const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
        if (dx * dx + dy * dy + dz * dz <= POLYMER_BOND_MAX * POLYMER_BOND_MAX) return true;
      }
    }
    return false;
  };

  for (const res of residues) {
    if (visited.has(res)) continue;
    const members: Entry[] = [res];
    visited.add(res);
    let changed = true;
    while (changed) {
      changed = false;
      for (const other of residues) {
        if (visited.has(other)) continue;
        if (other.resName !== res.resName || other.chain !== res.chain) continue;
        if (members.some(m => areBonded(other, m))) {
          members.push(other);
          visited.add(other);
          changed = true;
        }
      }
    }
    const resNos = members.map(m => m.resNo).sort((a, b) => a - b);
    grouped.push({
      resName: res.resName,
      resNo: resNos[0],
      resNos: resNos.length > 1 ? resNos : undefined,
      chain: res.chain,
      atomCount: members.reduce((s, m) => s + m.atomCount, 0),
    });
  }

  return grouped.sort((a, b) => {
    const ta = candidateTier(a.resName.toUpperCase());
    const tb = candidateTier(b.resName.toUpperCase());
    if (ta !== tb) return ta - tb;
    return b.atomCount - a.atomCount;
  });
};

export const findResidueByName = (structure: NGL.Structure, queryName: string): ResidueOption | null => {
  let found: ResidueOption | null = null;
  const q = queryName.toUpperCase().trim();
  structure.eachResidue((rp) => {
    if (found) return;
    if (rp.resname.toUpperCase() === q) {
      found = { resName: rp.resname, resNo: rp.resno, chain: rp.chainname, atomCount: rp.atomCount };
    }
  });
  return found;
};

/** Stable identity for a ligand option (chain + residue name + residue number). */
export const ligandKey = (l: ResidueOption): string => `${l.chain}:${l.resName}:${l.resNo}`;

// ---------------------------------------------------------------------------
// Interaction analysis
// ---------------------------------------------------------------------------

const resLabel = (a: AtomData) => `${a.resName} ${a.resNo}${a.insCode}`;
const ringLabel = (r: Ring) => `ring ${r.atoms.map(a => a.name).join('-')}`;
const closestTo = (atoms: AtomData[], p: Point3D): AtomData =>
  atoms.reduce((best, a) => (distance(a, p) < distance(best, p) ? a : best), atoms[0]);

export const analyzeInteractions = (
  structure: NGL.Structure,
  ligandResidue: ResidueOption
): AnalysisResult => {
  const interactions: Interaction[] = [];
  const ligandAtoms: AtomData[] = [];
  const proteinAtoms: AtomData[] = [];
  const metalIons: AtomData[] = [];
  const ligandResNos = ligandResidue.resNos ?? [ligandResidue.resNo];

  // 1. Extract atoms (primary altloc only).
  structure.eachAtom((ap) => {
    if (!isPrimaryAltloc(ap)) return;
    const isLigand =
      ligandResNos.includes(ap.resno) &&
      ap.chainname === ligandResidue.chain &&
      ap.resname === ligandResidue.resName;
    if (isLigand) {
      ligandAtoms.push(parseNGLAtom(ap));
    } else if (ap.isHetero() && isMetalElement(ap.element.toUpperCase())) {
      // Metal ions (and metals inside other hetero groups, e.g. a heme Fe) are
      // coordination partners. Previously every HETATM was dropped, so a ligand
      // binding a catalytic Zn never showed the coordination.
      metalIons.push(parseNGLAtom(ap));
    } else if (!ap.isHetero() || MODIFIED_RESIDUES.has(ap.resname.toUpperCase())) {
      proteinAtoms.push(parseNGLAtom(ap));
    }
    // Waters, other ligands, cofactors and buffers are not partners.
  });

  const empty: AnalysisResult = { interactions: [], ligandCenter: { x: 0, y: 0, z: 0 }, ligandAtoms, residueAtoms: {} };
  if (ligandAtoms.length === 0) return empty;
  const ligandCenter = getCenter(ligandAtoms);
  let idCounter = 0;
  const nextId = (p: string) => `${p}-${idCounter++}`;

  // 2. Binding site: every residue with ANY atom within PREFILTER_MARGIN of ANY ligand
  // atom, taken WHOLE so rings and charged groups straddling the cut-off keep all
  // their atoms (their centroids were previously computed from a subset).
  const M = THRESHOLDS.PREFILTER_MARGIN;
  const grid = new Map<string, AtomData[]>();
  const cell = (v: number) => Math.floor(v / M);
  for (const a of ligandAtoms) {
    const k = `${cell(a.x)},${cell(a.y)},${cell(a.z)}`;
    const arr = grid.get(k);
    if (arr) arr.push(a); else grid.set(k, [a]);
  }
  const nearLigand = (p: AtomData): boolean => {
    const cx = cell(p.x), cy = cell(p.y), cz = cell(p.z);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const bucket = grid.get(`${cx + i},${cy + j},${cz + k}`);
      if (bucket && bucket.some(l => distance(p, l) <= M)) return true;
    }
    return false;
  };

  const allResidues = new Map<number, AtomData[]>();
  for (const a of proteinAtoms) {
    const arr = allResidues.get(a.resKey);
    if (arr) arr.push(a); else allResidues.set(a.resKey, [a]);
  }
  const residueAtoms: Record<number, AtomData[]> = {};
  allResidues.forEach((atoms, key) => {
    if (atoms.some(a => a.element !== 'H' && nearLigand(a))) residueAtoms[key] = atoms;
  });
  const siteResidues = Object.values(residueAtoms);
  const siteAtoms = siteResidues.flat();
  const metals = metalIons.filter(nearLigand);
  const ligandMetals = ligandAtoms.filter(a => isMetalElement(a.element));
  metals.forEach(m => { residueAtoms[m.resKey] = [m]; });

  // 3. Ligand perception: bond graph, aromatic rings, charged groups.
  const ligHeavy = ligandAtoms.filter(a => a.element !== 'H');
  const ligAdj = buildAdjacency(ligHeavy);
  const ligRingsIdx = findRings(ligAdj, ligHeavy).filter(r => isAromaticRing(r, ligHeavy, ligAdj));
  const aromaticIdx = new Set(ligRingsIdx.flat());
  const ligRings = ligRingsIdx.map(r => makeRing(r.map(i => ligHeavy[i])));
  const ligGroups = findLigandChargedGroups(ligHeavy, ligAdj, aromaticIdx);
  const ligHydrophobic = new Set(
    ligHeavy.filter((a, i) => a.element === 'C' && ligAdj[i].every(j => ligHeavy[j].element === 'C')).map(a => a.index)
  );
  const ligHeavyPos = new Map(ligHeavy.map((a, i) => [a.index, i]));
  const heavyDegree = new Map<number, number>(ligHeavy.map((a, i) => [a.index, ligAdj[i].length]));

  // 4. Protein perception per site residue.
  const allMetals = [...metals, ...ligandMetals];
  const site = siteResidues.map(atoms => {
    const heavy = atoms.filter(a => a.element !== 'H');
    const adj = buildAdjacency(heavy);
    heavy.forEach((a, i) => heavyDegree.set(a.index, adj[i].length));
    const hydrophobic = heavy.filter((a, i) => a.element === 'C' && adj[i].every(j => heavy[j].element === 'C'));
    const ringDefs = ATOM_PROPS.AROMATIC_RINGS[aromaticResName(atoms[0].resName)] ?? [];
    const rings = ringDefs
      .map(names => names.map(n => heavy.find(a => a.name === n)))
      .filter((r): r is AtomData[] => r.every(Boolean)) // incomplete rings are skipped, not guessed
      .map(makeRing);
    return { atoms, heavy, hydrophobic, rings, charge: proteinChargedGroup(atoms, allMetals) };
  });

  // 5. Hydrogens bonded to each heavy atom (donor-H-acceptor angles).
  const HYDROGEN_COVALENT_MAX = 1.3;
  const donorHydrogens = new Map<number, AtomData[]>();
  const byResidue = new Map<number, AtomData[]>();
  for (const a of [...ligandAtoms, ...siteAtoms]) {
    const arr = byResidue.get(a.resKey);
    if (arr) arr.push(a); else byResidue.set(a.resKey, [a]);
  }
  byResidue.forEach(atoms => {
    for (const h of atoms) {
      if (h.element !== 'H') continue;
      let best: AtomData | null = null;
      let bestD = Infinity;
      for (const heavy of atoms) {
        if (heavy.element === 'H') continue;
        const d = distance(h, heavy);
        if (d < bestD) { bestD = d; best = heavy; }
      }
      if (best && bestD <= HYDROGEN_COVALENT_MAX) {
        const arr = donorHydrogens.get(best.index);
        if (arr) arr.push(h); else donorHydrogens.set(best.index, [h]);
      }
    }
  });
  const ligandHasH = ligandAtoms.some(a => a.element === 'H');
  const proteinHasH = siteAtoms.some(a => a.element === 'H');

  // 6. Metal coordination spheres (atom index -> metals it coordinates).
  const coordinatedBy = new Map<number, Set<number>>();
  const coordinate = (atom: AtomData, metal: AtomData) => {
    const s = coordinatedBy.get(atom.index);
    if (s) s.add(metal.index); else coordinatedBy.set(atom.index, new Set([metal.index]));
  };
  const sameMetalSphere = (a: AtomData, b: AtomData) => {
    const sa = coordinatedBy.get(a.index), sb = coordinatedBy.get(b.index);
    return !!sa && !!sb && [...sa].some(m => sb.has(m));
  };
  // A ring-type nitrogen (≥2 heavy neighbours, e.g. His NE2, porphyrin N) bound to a metal
  // has used its lone pair and carries no H: it can neither donate nor accept an H-bond.
  const metalSaturatedN = (a: AtomData) =>
    a.element === 'N' && coordinatedBy.has(a.index) && (heavyDegree.get(a.index) ?? 0) >= 2;

  // A. METAL COORDINATION
  for (const m of ligandMetals) {
    for (const p of siteAtoms) {
      if (!ATOM_PROPS.ACCEPTORS.has(p.element)) continue;
      const d = distance(m, p);
      if (d <= THRESHOLDS.METAL_DIST) {
        coordinate(p, m);
        interactions.push({ id: nextId('mt'), type: InteractionType.MetalCoordination, distance: d, ligandAtom: m, proteinAtom: p });
      }
    }
    for (const l of ligHeavy) if (ATOM_PROPS.ACCEPTORS.has(l.element) && distance(m, l) <= THRESHOLDS.METAL_DIST) coordinate(l, m);
  }
  for (const m of metals) {
    for (const l of ligHeavy) {
      if (!ATOM_PROPS.ACCEPTORS.has(l.element)) continue;
      const d = distance(m, l);
      if (d <= THRESHOLDS.METAL_DIST) {
        coordinate(l, m);
        interactions.push({
          id: nextId('mt'), type: InteractionType.MetalCoordination, distance: d, ligandAtom: l, proteinAtom: m,
          proteinLabel: `${m.element} ion (${resLabel(m)})`,
        });
      }
    }
    for (const p of siteAtoms) if (ATOM_PROPS.ACCEPTORS.has(p.element) && distance(m, p) <= THRESHOLDS.METAL_DIST) coordinate(p, m);
  }

  // B. SALT BRIDGES: closest pair of oppositely charged heavy atoms ≤ 4.0 Å, one per
  // ligand group / residue. Atoms of the two groups are remembered so the same
  // contact is not reported again as an H-bond (as PLIP).
  const saltBridgePairs = new Set<string>();
  for (const lg of ligGroups) {
    for (const r of site) {
      const pg = r.charge;
      if (!pg || pg.sign === lg.sign) continue;
      let best: { d: number; l: AtomData; p: AtomData } | null = null;
      for (const l of lg.atoms) for (const p of pg.atoms) {
        const d = distance(l, p);
        if (!best || d < best.d) best = { d, l, p };
      }
      if (best && best.d <= THRESHOLDS.SALT_BRIDGE_DIST) {
        interactions.push({
          id: nextId('sb'), type: InteractionType.SaltBridge, distance: best.d,
          ligandAtom: best.l, proteinAtom: best.p, subtype: lg.kind,
        });
        for (const l of lg.atoms) for (const p of pg.atoms) saltBridgePairs.add(`${l.index}-${p.index}`);
      }
    }
  }

  // C. PI-STACKING (ligand aromatic ring vs protein aromatic ring), best per ring/residue.
  const stackedPairs = new Set<string>();
  for (const lr of ligRings) {
    for (const r of site) {
      let best: Interaction | null = null;
      let bestRing: Ring | null = null;
      for (const pr of r.rings) {
        const d = distance(pr.center, lr.center);
        if (d > THRESHOLDS.PI_STACKING_DIST) continue;
        const angle = angleBetween(pr.normal, lr.normal);
        // Lateral offset against both ring planes, taking the smaller (as PLIP).
        const offset = Math.min(lateralOffset(pr.center, lr.center, pr.normal), lateralOffset(pr.center, lr.center, lr.normal));
        if (offset > THRESHOLDS.PI_STACKING_OFFSET) continue;
        const subtype = angle <= THRESHOLDS.PI_STACKING_ANGLE_PARALLEL ? 'parallel'
          : angle >= THRESHOLDS.PI_STACKING_ANGLE_TSHAPED ? 'T-shaped' : null;
        if (!subtype || (best && best.distance <= d)) continue;
        best = {
          id: '', type: InteractionType.PiStacking, distance: d, angle, subtype,
          ligandAtom: closestTo(lr.atoms, pr.center), proteinAtom: closestTo(pr.atoms, lr.center),
          ligandPoint: lr.center, proteinPoint: pr.center,
          ligandLabel: ringLabel(lr), proteinLabel: `${resLabel(pr.atoms[0])} ring`,
        };
        bestRing = pr;
      }
      if (best && bestRing) {
        best.id = nextId('pi');
        interactions.push(best);
        for (const a of lr.atoms) for (const b of bestRing.atoms) stackedPairs.add(`${a.index}-${b.index}`);
      }
    }
  }

  // D. CATION-PI: charge centre within 6.0 Å of a ring centroid AND projecting within
  // 2.0 Å of it (as PLIP), in both directions; best per group/residue.
  const cationPi = (ring: Ring, cation: ChargedGroup) => {
    const d = distance(ring.center, cation.center);
    if (d > THRESHOLDS.PI_CATION_DIST) return null;
    if (lateralOffset(ring.center, cation.center, ring.normal) > THRESHOLDS.PI_CATION_OFFSET) return null;
    return d;
  };
  for (const lg of ligGroups) {
    if (lg.sign !== 1) continue;
    for (const r of site) {
      let best: Interaction | null = null;
      for (const pr of r.rings) {
        const d = cationPi(pr, lg);
        if (d === null || (best && best.distance <= d)) continue;
        best = {
          id: '', type: InteractionType.PiStacking, distance: d, subtype: 'cation-π',
          ligandAtom: lg.atoms[0], proteinAtom: closestTo(pr.atoms, lg.center),
          ligandPoint: lg.center, proteinPoint: pr.center,
          ligandLabel: `${lg.atoms.map(a => a.name).join(',')} (${lg.kind})`,
          proteinLabel: `${resLabel(pr.atoms[0])} ring`,
        };
      }
      if (best) { best.id = nextId('pic'); interactions.push(best); }
    }
  }
  for (const r of site) {
    const pg = r.charge;
    if (!pg || pg.sign !== 1) continue;
    let best: Interaction | null = null;
    for (const lr of ligRings) {
      const d = cationPi(lr, pg);
      if (d === null || (best && best.distance <= d)) continue;
      best = {
        id: '', type: InteractionType.PiStacking, distance: d, subtype: 'cation-π',
        ligandAtom: closestTo(lr.atoms, pg.center), proteinAtom: closestTo(pg.atoms, lr.center),
        ligandPoint: lr.center, proteinPoint: pg.center,
        ligandLabel: ringLabel(lr), proteinLabel: `${resLabel(pg.atoms[0])} ${pg.atoms.map(a => a.name).join(',')}`,
      };
    }
    if (best) { best.id = nextId('pic'); interactions.push(best); }
  }

  // E. ATOM-ATOM: H-bonds, halogen bonds, hydrophobic candidates.
  const maxCut = Math.max(THRESHOLDS.HBOND_DIST, THRESHOLDS.HYDROPHOBIC_DIST, THRESHOLDS.HALOGEN_DIST);
  const siteHydrophobic = new Set(site.flatMap(r => r.hydrophobic.map(a => a.index)));
  const goodDonorH = (donor: AtomData, acceptor: AtomData) =>
    (donorHydrogens.get(donor.index) ?? []).some(h => angleDeg(donor, h, acceptor) >= THRESHOLDS.HBOND_ANGLE);
  const hydrophobicCandidates: Interaction[] = [];

  for (const l of ligHeavy) {
    for (const p of siteAtoms) {
      if (p.element === 'H') continue;
      const dist = distance(l, p);
      if (dist > maxCut) continue;

      // Hydrogen bond. Each direction is judged on its own donor: when that side of
      // the complex has explicit hydrogens, the donor must carry one at ≥120°;
      // when it has none, the heavy-atom distance alone decides. (Previously a
      // ligand with hydrogens vetoed protein-donor H-bonds whose H was missing.)
      if (dist <= THRESHOLDS.HBOND_DIST && !sameMetalSphere(l, p) && !metalSaturatedN(l) && !metalSaturatedN(p)
        && !saltBridgePairs.has(`${l.index}-${p.index}`)) {
        const ligDonates = ATOM_PROPS.DONORS.has(l.element) && ATOM_PROPS.ACCEPTORS.has(p.element) &&
          (ligandHasH ? goodDonorH(l, p) : true);
        const protDonates = ATOM_PROPS.DONORS.has(p.element) && ATOM_PROPS.ACCEPTORS.has(l.element) &&
          (proteinHasH ? goodDonorH(p, l) : true);
        if (ligDonates || protDonates) {
          interactions.push({ id: nextId('hb'), type: InteractionType.HydrogenBond, distance: dist, ligandAtom: l, proteinAtom: p });
        }
      }

      // Halogen bond
      if (ATOM_PROPS.HALOGENS.has(l.element) && ATOM_PROPS.ACCEPTORS.has(p.element) && dist <= THRESHOLDS.HALOGEN_DIST) {
        // Enforce sigma-hole directionality: the C-X...A angle must lie within
        // HALOGEN_ANGLE_DEV of the optimal donor angle (Auffinger et al., 2004).
        const bondedC = findBondedCarbon(l, ligandAtoms);
        let accept = true;
        let xAngle: number | undefined;
        if (bondedC) {
          xAngle = angleDeg(bondedC, l, p);
          accept = Math.abs(xAngle - THRESHOLDS.HALOGEN_DON_ANGLE) <= THRESHOLDS.HALOGEN_ANGLE_DEV;
        }
        if (accept) {
          interactions.push({ id: nextId('xb'), type: InteractionType.HalogenBond, distance: dist, ligandAtom: l, proteinAtom: p, angle: xAngle });
        }
      }

      // Hydrophobic: carbons bonded only to carbon/hydrogen on both sides (as PLIP).
      if (dist <= THRESHOLDS.HYDROPHOBIC_DIST && ligHydrophobic.has(l.index) && siteHydrophobic.has(p.index)
        && !stackedPairs.has(`${l.index}-${p.index}`)) {
        hydrophobicCandidates.push({ id: '', type: InteractionType.Hydrophobic, distance: dist, ligandAtom: l, proteinAtom: p });
      }
    }
  }

  // F. Hydrophobic reduction (PLIP rules): (1) atoms of stacked rings excluded above;
  // (2) one contact per ligand atom per residue, the closest; (3) per protein atom,
  // keep only the closest of each covalently connected cluster of ligand atoms.
  const perLigRes = new Map<string, Interaction>();
  for (const h of hydrophobicCandidates) {
    const k = `${h.ligandAtom.index}:${h.proteinAtom.resKey}`;
    const cur = perLigRes.get(k);
    if (!cur || h.distance < cur.distance) perLigRes.set(k, h);
  }
  const perProtAtom = new Map<number, Interaction[]>();
  perLigRes.forEach(h => {
    const arr = perProtAtom.get(h.proteinAtom.index);
    if (arr) arr.push(h); else perProtAtom.set(h.proteinAtom.index, [h]);
  });
  perProtAtom.forEach(list => {
    const remaining = [...list];
    while (remaining.length) {
      // flood-fill one connected cluster of ligand atoms
      const cluster = [remaining.pop()!];
      for (let grew = true; grew;) {
        grew = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
          const li = ligHeavyPos.get(remaining[i].ligandAtom.index)!;
          if (cluster.some(c => ligAdj[ligHeavyPos.get(c.ligandAtom.index)!].includes(li))) {
            cluster.push(remaining.splice(i, 1)[0]);
            grew = true;
          }
        }
      }
      const best = cluster.reduce((a, b) => (b.distance < a.distance ? b : a));
      best.id = nextId('hp');
      interactions.push(best);
    }
  });

  // G. Same atom pair under several types: keep the strongest.
  const typeScore = (t: InteractionType) => {
    switch (t) {
      case InteractionType.MetalCoordination: return 5;
      case InteractionType.SaltBridge: return 4;
      case InteractionType.PiStacking: return 3;
      case InteractionType.HydrogenBond: return 2;
      case InteractionType.HalogenBond: return 2;
      default: return 1;
    }
  };
  const pairMap = new Map<string, Interaction>();
  const ringBased: Interaction[] = [];
  for (const i of interactions) {
    // Ring / charge-centre interactions are group-level; they never collapse atom pairs.
    if (i.ligandPoint || i.proteinPoint) { ringBased.push(i); continue; }
    const key = `${i.ligandAtom.index}-${i.proteinAtom.index}`;
    const existing = pairMap.get(key);
    if (!existing || typeScore(i.type) > typeScore(existing.type)) pairMap.set(key, i);
  }

  return { interactions: [...pairMap.values(), ...ringBased], ligandCenter, ligandAtoms, residueAtoms };
};
