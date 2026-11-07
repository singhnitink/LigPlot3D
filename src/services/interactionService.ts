
import * as NGL from 'ngl';
import { InteractionType } from '../types';
import {
  THRESHOLDS, ATOM_PROPS, COVALENT_RADII, GENERIC_LIGAND_NAMES, COFACTOR_GLYCAN_LIPID, ADDITIVES,
  IGNORED_RESIDUES, MODIFIED_RESIDUES, CHARMM_ION_ELEMENTS, HYDROGEN_ELEMENTS, HALIDE_ELEMENTS,
  aromaticResName, canonicalResidue, isPolymerResidueName,
} from '../constants';
import { distance, getCenter, ringPlane, angleBetween, angleDeg, lateralOffset } from './geometryUtils';
import type { AtomData, Interaction, ResidueOption, AnalysisResult, Point3D, LigandUnit } from '../types';

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

/**
 * Element of an atom, robust to force-field files:
 *  - hydrogen isotopes (D, T) are reported as 'H' — chemistry is identical;
 *  - CHARMM ions (atom name == residue name, e.g. SOD/SOD) get their real element even when
 *    the element column is blank (NGL would otherwise guess SOD -> S, CAL -> C, POT -> P).
 */
export const normalizedElement = (element: string, atomName: string, resName: string): string => {
  const el = element.toUpperCase();
  if (HYDROGEN_ELEMENTS.has(el)) return 'H';
  const rn = resName.toUpperCase();
  if (atomName.toUpperCase() === rn && CHARMM_ION_ELEMENTS[rn]) return CHARMM_ION_ELEMENTS[rn];
  return el;
};

const parseNGLAtom = (ap: AtomProxy): AtomData => ({
  index: ap.index,
  name: ap.atomname,
  element: normalizedElement(ap.element, ap.atomname, ap.resname),
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

/**
 * Protein charged group of one residue (heavy atoms), or null if the residue is neutral.
 *
 * Charge states, in order of precedence:
 *  1. Histidine ring hydrogens, when the file has them: H on both ND1 and NE2 -> cationic,
 *     on one -> neutral. They are found by geometry (hydrogensOf), so any naming or atom
 *     order works. Zero ring hydrogens carries no information (a neutral imidazole must
 *     have one), so it falls through to the residue name.
 *  2. Residue names that declare a state (HSP/HIP/HISH charged; HSD/HIE/ASH/GLH/LYN/... neutral).
 *  3. Convention: Asp/Glu/Lys/Arg charged; plain HIS cationic (PLIP) unless metal-bound.
 * Hydrogen counts are deliberately NOT used for Asp/Glu/Lys/Arg: tools that add hydrogens
 * by valence (e.g. `obabel -h`) write COOH / NH2 for every residue, which is
 * indistinguishable from a deliberate choice; MD and preparation tools state deliberate
 * non-standard states through the residue name instead.
 */
const proteinChargedGroup = (
  resAtoms: AtomData[], hydrogensOf: Map<number, AtomData[]>, metals: AtomData[]
): ChargedGroup | null => {
  const raw = resAtoms[0].resName.toUpperCase();
  const { base, state } = canonicalResidue(raw, resAtoms[0].isHet);
  const pick = (names: string[]) => names.map(n => resAtoms.find(a => a.name === n)).filter((a): a is AtomData => !!a);
  const build = (sign: 1 | -1, names: string[]): ChargedGroup | null => {
    const atoms = pick(names);
    return atoms.length ? { sign, atoms, center: getCenter(atoms), kind: raw } : null;
  };

  if (ATOM_PROPS.NEG_CHARGE_ATOMS[base]) return state === 'neutral' ? null : build(-1, ATOM_PROPS.NEG_CHARGE_ATOMS[base]);
  if (base === 'ARG' || base === 'LYS') return state === 'neutral' ? null : build(1, ATOM_PROPS.POS_CHARGE_ATOMS[base]);
  if (base !== 'HIS') return null;

  const ringN = pick(ATOM_PROPS.POS_CHARGE_ATOMS.HIS);
  const protonatedRingN = ringN.filter(n => (hydrogensOf.get(n.index)?.length ?? 0) > 0).length;
  if (protonatedRingN === 2) return build(1, ATOM_PROPS.POS_CHARGE_ATOMS.HIS);
  if (protonatedRingN === 1) return null;
  if (state === 'charged') return build(1, ATOM_PROPS.POS_CHARGE_ATOMS.HIS);
  if (state === 'neutral') return null;
  // Plain HIS with no ring hydrogens: cationic by PLIP convention, unless it is a metal ligand.
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

// Memoised polymer-residue test (called once per atom in large files).
const polymerNameCache = new Map<string, boolean>();
const isPolymerName = (name: string): boolean => {
  let v = polymerNameCache.get(name);
  if (v === undefined) { v = isPolymerResidueName(name); polymerNameCache.set(name, v); }
  return v;
};

/** Is this atom part of the receptor polymer (protein / nucleic acid, incl. modified residues)? */
const isReceptorResidue = (resName: string, isHetero: boolean): boolean =>
  MODIFIED_RESIDUES.has(resName.toUpperCase()) || (!isHetero && isPolymerName(resName));

const unitId = (chain: string, resNo: number, insCode: string, resName: string) => `${chain}|${resNo}|${insCode}|${resName}`;

export const getLigandCandidates = (structure: NGL.Structure): ResidueOption[] => {
  type UnitAtom = { x: number; y: number; z: number; el: string };
  type Unit = LigandUnit & { atoms: UnitAtom[] };
  const byId = new Map<string, Unit>();

  // 1. Ligand units: every residue that is not part of the receptor polymer, not water and
  //    not a lone ion — HETATM groups and, in simulation files (where everything is an ATOM
  //    record), any residue that is not a standard polymer residue: GLYCAM sugars
  //    (4GB/3GB/0GB ...), CHARMM BGLC, cofactors, lipids.
  structure.eachResidue((rp) => {
    const name = rp.resname.toUpperCase();
    if (rp.isWater() || IGNORED_RESIDUES.has(name) || isReceptorResidue(rp.resname, rp.isHetero())) return;
    const id = unitId(rp.chainname, rp.resno, rp.inscode || '', rp.resname);
    let unit = byId.get(id); // the same residue may be split into several NGL residues
    rp.eachAtom((ap) => {
      if (!isPrimaryAltloc(ap)) return;
      const el = normalizedElement(ap.element, ap.atomname, ap.resname);
      if (el === 'H') return;
      if (!unit) {
        unit = { resName: rp.resname, resNo: rp.resno, chain: rp.chainname, insCode: rp.inscode || '', atoms: [] };
        byId.set(id, unit);
      }
      unit.atoms.push({ x: ap.x, y: ap.y, z: ap.z, el });
    });
  });
  // Lone metal or halide ions (whatever their residue name, e.g. CHARMM SOD/CLA) are
  // coordination partners or counter-ions, not ligands.
  const units = [...byId.values()].filter(u =>
    !(u.atoms.length === 1 && (isMetalElement(u.atoms[0].el) || HALIDE_ELEMENTS.has(u.atoms[0].el))));

  // 2. One ligand = one covalently connected set of units, whatever their residue names or
  //    chain IDs (glucan chains, glycan trees, fragments of a peptidomimetic inhibitor ...).
  //    Two units are linked when 1–3 of their atom pairs are at covalent-bond distance and no
  //    atoms overlap (< 0.9 Å): a glycosidic or peptide link is a single bond, while two
  //    partially occupied ligands modelled in the same place overlap or clash at many pairs.
  const C = 2.6; // > the longest bond considered (S–S: 1.05 + 1.05 + 0.45)
  const cellOf = (v: number) => Math.floor(v / C);
  const grid = new Map<string, [number, number][]>();
  units.forEach((u, ui) => u.atoms.forEach((a, ai) => {
    const k = `${cellOf(a.x)},${cellOf(a.y)},${cellOf(a.z)}`;
    const arr = grid.get(k);
    if (arr) arr.push([ui, ai]); else grid.set(k, [[ui, ai]]);
  }));
  const links = new Map<string, { i: number; j: number; bonds: number; overlap: boolean }>();
  units.forEach((u, ui) => u.atoms.forEach((a) => {
    const cx = cellOf(a.x), cy = cellOf(a.y), cz = cellOf(a.z);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const [uj, aj] of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        if (uj <= ui) continue;
        const b = units[uj].atoms[aj];
        const d = distance(a, b);
        const overlap = d < 0.9;
        const bonded = !overlap && !isMetalElement(a.el) && !isMetalElement(b.el)
          && d <= covalentRadius(a.el) + covalentRadius(b.el) + THRESHOLDS.BOND_TOLERANCE;
        if (!overlap && !bonded) continue;
        const key = `${ui}|${uj}`;
        const l = links.get(key) ?? { i: ui, j: uj, bonds: 0, overlap: false };
        if (overlap) l.overlap = true; else l.bonds++;
        links.set(key, l);
      }
    }
  }));
  const root = units.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  links.forEach(l => { if (!l.overlap && l.bonds >= 1 && l.bonds <= 3) root[find(l.i)] = find(l.j); });

  // 3. Candidates, ranked: generic docking names > other hetero groups > cofactors / glycans
  //    / lipids > additives, detergents and membrane lipids; larger first within a rank.
  const groups = new Map<number, Unit[]>();
  units.forEach((u, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(u); else groups.set(r, [u]);
  });
  const ranked = [...groups.values()].map(g => {
    g.sort((a, b) => a.chain.localeCompare(b.chain) || a.resNo - b.resNo || a.insCode.localeCompare(b.insCode));
    const option: ResidueOption = {
      resName: g[0].resName,
      resNo: g[0].resNo,
      resNos: g.length > 1 ? g.map(u => u.resNo) : undefined,
      chain: g[0].chain,
      atomCount: g.reduce((n, u) => n + u.atoms.length, 0),
      units: g.length > 1 ? g.map(({ resName, resNo, chain, insCode }) => ({ resName, resNo, chain, insCode })) : undefined,
    };
    return { option, tier: Math.min(...g.map(u => candidateTier(u.resName.toUpperCase()))) };
  });
  return ranked
    .sort((a, b) => (a.tier - b.tier) || (b.option.atomCount - a.option.atomCount))
    .map(r => r.option);
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
  const ligHeavy: AtomData[] = [];
  const proteinHeavy: AtomData[] = [];
  const metalIons: AtomData[] = [];
  const otherHeavy: AtomData[] = []; // other hetero groups / counter-ions: possible hydrogen parents only
  const hydrogens: AtomData[] = [];
  const ligandResNos = ligandResidue.resNos ?? [ligandResidue.resNo];
  const ligandUnitIds = ligandResidue.units
    ? new Set(ligandResidue.units.map(u => unitId(u.chain, u.resNo, u.insCode, u.resName)))
    : null;

  // 1. Extract atoms (primary altloc only). Hydrogens are collected on their own and
  // attached to their parent atom by GEOMETRY (step 3) — never by name, residue or file
  // order, which differ between tools: Open Babel writes every H after all heavy atoms,
  // and PDB / CHARMM / AMBER / GROMACS all name hydrogens differently.
  structure.eachAtom((ap) => {
    if (!isPrimaryAltloc(ap)) return;
    const isLigand = ligandUnitIds
      ? ligandUnitIds.has(unitId(ap.chainname, ap.resno, ap.inscode || '', ap.resname))
      : ligandResNos.includes(ap.resno) && ap.chainname === ligandResidue.chain && ap.resname === ligandResidue.resName;
    const water = !isLigand && ap.isWater();
    const a = parseNGLAtom(ap);
    if (a.element === 'H') {
      if (!water) hydrogens.push(a);
      return;
    }
    if (isLigand) ligHeavy.push(a);
    // Waters are not partners — including MD waters written as ATOM records (TIP3, WAT, SOL).
    else if (water) return;
    // Metal ions, in HETATM or ATOM records (CHARMM ZN2/CAL/SOD), and cofactor metals
    // (heme Fe) are coordination partners.
    else if (isMetalElement(a.element)) metalIons.push(a);
    // Halide counter-ions are not partners.
    else if (HALIDE_ELEMENTS.has(a.element)) otherHeavy.push(a);
    // Receptor: protein / nucleic-acid residues (incl. modified ones). In simulation files the
    // other ATOM-record residues (sugars, lipids, cofactors) are treated like HETATM groups.
    else if (isReceptorResidue(ap.resname, ap.isHetero())) proteinHeavy.push(a);
    // Other ligands, cofactors and buffers are not partners.
    else otherHeavy.push(a);
  });

  if (ligHeavy.length === 0) {
    return { interactions: [], ligandCenter: { x: 0, y: 0, z: 0 }, ligandAtoms: [], residueAtoms: {}, hydrogens: { ligand: false, receptor: false } };
  }
  let idCounter = 0;
  const nextId = (p: string) => `${p}-${idCounter++}`;

  // 2. Binding site: every residue with ANY heavy atom within PREFILTER_MARGIN of ANY
  // ligand heavy atom, taken WHOLE so rings and charged groups straddling the cut-off
  // keep all their atoms.
  const M = THRESHOLDS.PREFILTER_MARGIN;
  const grid = new Map<string, AtomData[]>();
  const cell = (v: number) => Math.floor(v / M);
  for (const a of ligHeavy) {
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
  for (const a of proteinHeavy) {
    const arr = allResidues.get(a.resKey);
    if (arr) arr.push(a); else allResidues.set(a.resKey, [a]);
  }
  const siteResidues: AtomData[][] = [];
  allResidues.forEach(atoms => { if (atoms.some(nearLigand)) siteResidues.push(atoms); });
  const siteAtoms = siteResidues.flat();
  const metals = metalIons.filter(nearLigand);
  const ligandMetals = ligHeavy.filter(a => isMetalElement(a.element));

  // 3. Hydrogens -> parent heavy atom, purely by distance (nearest heavy atom within
  // 1.45 Å, which covers S–H at 1.34 Å; a non-bonded heavy atom is never that close).
  // Independent of atom names, residue grouping and file order.
  const HYDROGEN_PARENT_MAX = 1.45;
  const parentPool = [...ligHeavy, ...siteAtoms, ...otherHeavy.filter(nearLigand)];
  const hydrogensOf = new Map<number, AtomData[]>();
  if (hydrogens.length > 0 && parentPool.length > 0) {
    const C = 1.5;
    const pc = (v: number) => Math.floor(v / C);
    const pgrid = new Map<string, AtomData[]>();
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const a of parentPool) {
      const k = `${pc(a.x)},${pc(a.y)},${pc(a.z)}`;
      const arr = pgrid.get(k);
      if (arr) arr.push(a); else pgrid.set(k, [a]);
      minX = Math.min(minX, a.x); minY = Math.min(minY, a.y); minZ = Math.min(minZ, a.z);
      maxX = Math.max(maxX, a.x); maxY = Math.max(maxY, a.y); maxZ = Math.max(maxZ, a.z);
    }
    for (const h of hydrogens) {
      if (h.x < minX - C || h.x > maxX + C || h.y < minY - C || h.y > maxY + C || h.z < minZ - C || h.z > maxZ + C) continue;
      let best: AtomData | null = null;
      let bestD = HYDROGEN_PARENT_MAX;
      const cx = pc(h.x), cy = pc(h.y), cz = pc(h.z);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        for (const p of pgrid.get(`${cx + i},${cy + j},${cz + k}`) ?? []) {
          const d = distance(h, p);
          if (d <= bestD) { bestD = d; best = p; }
        }
      }
      if (!best) continue;
      // The hydrogen belongs to its parent's residue, whatever residue the file put it in.
      const attached: AtomData = { ...h, resKey: best.resKey, resName: best.resName, resNo: best.resNo, chain: best.chain, insCode: best.insCode, isHet: best.isHet };
      const arr = hydrogensOf.get(best.index);
      if (arr) arr.push(attached); else hydrogensOf.set(best.index, [attached]);
    }
  }
  const hOf = (a: AtomData) => hydrogensOf.get(a.index) ?? [];
  const ligandAtoms = [...ligHeavy, ...ligHeavy.flatMap(hOf)];
  const ligandCenter = getCenter(ligHeavy);
  const residueAtoms: Record<number, AtomData[]> = {};
  for (const atoms of siteResidues) residueAtoms[atoms[0].resKey] = [...atoms, ...atoms.flatMap(hOf)];
  metals.forEach(m => { residueAtoms[m.resKey] = [m]; });
  // Explicit hydrogens on each side decide whether H-bond angles can be checked (step E).
  const ligandHasH = ligHeavy.some(a => hOf(a).length > 0);
  const proteinHasH = siteAtoms.some(a => hOf(a).length > 0);

  // 4. Ligand perception: bond graph, aromatic rings, charged groups.
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

  // 5. Protein perception per site residue (heavy atoms; hydrogens via hydrogensOf).
  const allMetals = [...metals, ...ligandMetals];
  const site = siteResidues.map(heavy => {
    const adj = buildAdjacency(heavy);
    heavy.forEach((a, i) => heavyDegree.set(a.index, adj[i].length));
    const hydrophobic = heavy.filter((a, i) => a.element === 'C' && adj[i].every(j => heavy[j].element === 'C'));
    const ringDefs = ATOM_PROPS.AROMATIC_RINGS[aromaticResName(heavy[0].resName, heavy[0].isHet)] ?? [];
    const rings = ringDefs
      .map(names => names.map(n => heavy.find(a => a.name === n)))
      .filter((r): r is AtomData[] => r.every(Boolean)) // incomplete rings are skipped, not guessed
      .map(makeRing);
    return { atoms: heavy, heavy, hydrophobic, rings, charge: proteinChargedGroup(heavy, hydrogensOf, allMetals) };
  });

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
    hOf(donor).some(h => angleDeg(donor, h, acceptor) >= THRESHOLDS.HBOND_ANGLE);
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

  return {
    interactions: [...pairMap.values(), ...ringBased], ligandCenter, ligandAtoms, residueAtoms,
    hydrogens: { ligand: ligandHasH, receptor: proteinHasH },
  };
};
