
import * as NGL from 'ngl';
import { InteractionType } from '../types';
import { THRESHOLDS, ATOM_PROPS, COMMON_LIGANDS, IGNORED_RESIDUES } from '../constants';
import { distance, getCenter, getPlaneNormal, angleBetween, angleDeg } from './geometryUtils';
import type { AtomData, Interaction, ResidueOption, AnalysisResult } from '../types';

const parseNGLAtom = (ap: any): AtomData => ({
  index: ap.index,
  name: ap.atomname,
  element: ap.element,
  x: ap.x,
  y: ap.y,
  z: ap.z,
  resName: ap.resname,
  resNo: ap.resno,
  chain: ap.chainname,
  isHet: ap.isHetero(),
});

// --- Helper: Ligand Ring Detection (Geometric DFS) ---
const findLigandRings = (atoms: AtomData[]): AtomData[][] => {
  if (!atoms || atoms.length === 0) return [];
  const rings: AtomData[][] = [];
  // Simple adjacency based on bond length < 1.65 (covers C-C, C-N, C-O in rings)
  const adj: number[][] = atoms.map(() => []);
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      if (distance(atoms[i], atoms[j]) < 1.65) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const visitedPaths = new Set<string>();

  const dfs = (start: number, current: number, path: number[]) => {
    if (path.length > 6) return;
    if (path.length >= 5) {
      if (adj[current].includes(start)) {
        const sortedPath = [...path].sort((a, b) => a - b);
        const key = sortedPath.join(',');
        if (!visitedPaths.has(key)) {
          visitedPaths.add(key);
          rings.push(path.map(idx => atoms[idx]));
        }
        return;
      }
    }

    for (const neighbor of adj[current]) {
      if (!path.includes(neighbor)) {
        dfs(start, neighbor, [...path, neighbor]);
      }
    }
  };

  for (let i = 0; i < atoms.length; i++) {
    // Start searches from Carbon or Nitrogen
    if (['C', 'N'].includes(atoms[i].element)) {
      dfs(i, i, [i]);
    }
  }
  return rings;
};

// --- Helper: Find nearest covalently-bonded atom of a given element ---
// Used to recover the donor's hydrogen (for the D-H-A angle) or a halogen's
// bonded carbon (for the C-X...A angle) when the structure provides one.
const findBondedAtom = (center: AtomData, pool: AtomData[], element: string, maxDist: number): AtomData | null => {
  let best: AtomData | null = null;
  let bestDist = maxDist;
  for (const a of pool) {
    if (a.index === center.index) continue;
    if (a.element.toUpperCase() !== element.toUpperCase()) continue;
    const d = distance(center, a);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best;
};

const BOND_DIST_XH = 1.3; // Generous N/O/S-H covalent bond length
const BOND_DIST_CX = 2.2; // Generous C-halogen covalent bond length (covers C-I ~2.14 A)

export const getLigandCandidates = (structure: NGL.Structure): ResidueOption[] => {
  // First pass: collect all potential ligand residues
  const residueMap: Map<string, { resName: string; resNo: number; chain: string; atomCount: number; centerX: number; centerY: number; centerZ: number }> = new Map();

  structure.eachResidue((rp) => {
    const resNameUpper = rp.resname.toUpperCase();
    const isCommon = COMMON_LIGANDS.has(resNameUpper);
    const isHet = rp.isHetero();
    const isIgnored = IGNORED_RESIDUES.has(resNameUpper);

    if (isCommon || (isHet && !isIgnored)) {
      const key = `${rp.chainname}:${rp.resno}`;
      if (!residueMap.has(key)) {
        // Calculate center of residue for distance checking
        let sumX = 0, sumY = 0, sumZ = 0, count = 0;
        rp.eachAtom((ap: any) => {
          sumX += ap.x;
          sumY += ap.y;
          sumZ += ap.z;
          count++;
        });
        residueMap.set(key, {
          resName: rp.resname,
          resNo: rp.resno,
          chain: rp.chainname,
          atomCount: rp.atomCount,
          centerX: count > 0 ? sumX / count : 0,
          centerY: count > 0 ? sumY / count : 0,
          centerZ: count > 0 ? sumZ / count : 0
        });
      }
    }
  });

  // Second pass: group residues with same name/chain that are spatially connected (polymer chains)
  const residues = Array.from(residueMap.values());
  const grouped: Map<string, ResidueOption> = new Map();
  const visited = new Set<string>();

  const POLYMER_DISTANCE_THRESHOLD = 5.0; // Å - typical glycosidic bond distance + buffer

  for (const res of residues) {
    const resKey = `${res.chain}:${res.resNo}`;
    if (visited.has(resKey)) continue;

    // Start a new group with this residue
    const groupKey = `${res.chain}:${res.resName}:${res.resNo}`;
    const resNos: number[] = [res.resNo];
    let totalAtomCount = res.atomCount;
    visited.add(resKey);

    // Find all connected residues with same name and chain
    let changed = true;
    while (changed) {
      changed = false;
      for (const other of residues) {
        const otherKey = `${other.chain}:${other.resNo}`;
        if (visited.has(otherKey)) continue;
        if (other.resName !== res.resName || other.chain !== res.chain) continue;

        // Check if this residue is close to any in our group
        for (const groupedResNo of resNos) {
          const groupedRes = residueMap.get(`${res.chain}:${groupedResNo}`);
          if (!groupedRes) continue;

          const dx = other.centerX - groupedRes.centerX;
          const dy = other.centerY - groupedRes.centerY;
          const dz = other.centerZ - groupedRes.centerZ;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < POLYMER_DISTANCE_THRESHOLD) {
            resNos.push(other.resNo);
            totalAtomCount += other.atomCount;
            visited.add(otherKey);
            changed = true;
            break;
          }
        }
      }
    }

    // Sort residue numbers for consistent display
    resNos.sort((a, b) => a - b);

    grouped.set(groupKey, {
      resName: res.resName,
      resNo: resNos[0], // Primary residue number
      resNos: resNos.length > 1 ? resNos : undefined, // Only set if polymer
      chain: res.chain,
      atomCount: totalAtomCount
    });
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const aIsCommon = COMMON_LIGANDS.has(a.resName.toUpperCase());
    const bIsCommon = COMMON_LIGANDS.has(b.resName.toUpperCase());
    if (aIsCommon && !bIsCommon) return -1;
    if (!aIsCommon && bIsCommon) return 1;
    return b.atomCount - a.atomCount;
  });
};

export const findResidueByName = (structure: NGL.Structure, queryName: string): ResidueOption | null => {
  let found: ResidueOption | null = null;
  const q = queryName.toUpperCase().trim();
  structure.eachResidue((rp) => {
    if (found) return;
    if (rp.resname.toUpperCase() === q) {
      found = {
        resName: rp.resname,
        resNo: rp.resno,
        chain: rp.chainname,
        atomCount: rp.atomCount
      };
    }
  });
  return found;
};

export const analyzeInteractions = (
  structure: NGL.Structure,
  ligandResidue: ResidueOption
): AnalysisResult => {
  const interactions: Interaction[] = [];
  const ligandAtoms: AtomData[] = [];
  const proteinAtoms: AtomData[] = [];

  // Support polymer ligands with multiple residue numbers
  const ligandResNos = ligandResidue.resNos ?? [ligandResidue.resNo];

  // 1. Extract Atoms
  structure.eachAtom((ap) => {
    const isLigand =
      ligandResNos.includes(ap.resno) &&
      ap.chainname === ligandResidue.chain &&
      ap.resname === ligandResidue.resName;

    if (isLigand) {
      ligandAtoms.push(parseNGLAtom(ap));
    } else {
      // Exclude waters/ions from Protein set for general interactions, 
      // but potentially keep them if we wanted water bridges (not implemented yet)
      if (!ap.isHetero()) {
        proteinAtoms.push(parseNGLAtom(ap));
      }
    }
  });

  if (ligandAtoms.length === 0) return { interactions: [], ligandCenter: { x: 0, y: 0, z: 0 } };

  const ligandCenter = getCenter(ligandAtoms);
  let idCounter = 0;

  // 2. Filter Protein Atoms by coarse distance (Optimization)
  const relevantProteinAtoms = proteinAtoms.filter(pAtom => {
    const d = distance(pAtom, ligandCenter);
    return d < 18.0; // slightly larger than cutoffs to be safe
  });

  const proteinResidues: Record<string, AtomData[]> = {};
  relevantProteinAtoms.forEach(a => {
    const key = `${a.chain}:${a.resNo}`;
    if (!proteinResidues[key]) proteinResidues[key] = [];
    proteinResidues[key].push(a);
  });

  // 3. Geometric Analysis Prep
  const ligandRings = findLigandRings(ligandAtoms);
  const ligandRingData = ligandRings.map(ring => ({
    center: getCenter(ring),
    normal: getPlaneNormal(ring),
    atoms: ring
  }));

  // --- Interaction Detection ---

  // Iterate over nearby protein residues
  Object.values(proteinResidues).forEach(resAtoms => {
    const resName = resAtoms[0].resName;

    // A. PI-STACKING & PI-CATION (Protein Ring vs Ligand)
    const aromDef = ATOM_PROPS.AROMATIC_PLANES[resName as keyof typeof ATOM_PROPS.AROMATIC_PLANES];
    if (aromDef) {
      const ringAtoms = resAtoms.filter(a => aromDef.includes(a.name));
      if (ringAtoms.length >= 3) {
        const pCenter = getCenter(ringAtoms);
        const pNormal = getPlaneNormal(ringAtoms);

        // Pi-Stacking
        ligandRingData.forEach(lRing => {
          const dist = distance(pCenter, lRing.center);
          if (dist <= THRESHOLDS.PI_STACKING_DIST) {
            const angle = angleBetween(pNormal, lRing.normal);
            const isParallel = angle < THRESHOLDS.PI_STACKING_ANGLE_PARALLEL || angle > (180 - THRESHOLDS.PI_STACKING_ANGLE_PARALLEL);
            const isTShaped = (angle > THRESHOLDS.PI_STACKING_ANGLE_TSHAPED && angle < 120);

            if (isParallel || isTShaped) {
              interactions.push({
                id: `pi-${idCounter++}`,
                type: InteractionType.PiStacking,
                distance: dist,
                ligandAtom: lRing.atoms[0], // Representative
                proteinAtom: ringAtoms[0],  // Representative
                angle: angle
              });
            }
          }
        });

        // Pi-Cation (Protein Ring -> Ligand Cation)
        ligandAtoms.forEach(lAtom => {
          if ((lAtom.element === 'N' || lAtom.name.includes('NH')) && distance(lAtom, pCenter) < THRESHOLDS.PI_CATION_DIST) {
            interactions.push({
              id: `pic-${idCounter++}`,
              type: InteractionType.PiStacking, // Treating as Pi-interaction
              distance: distance(lAtom, pCenter),
              ligandAtom: lAtom,
              proteinAtom: ringAtoms[0]
            });
          }
        });
      }
    }

    // B. SALT BRIDGES & PI-CATION (Protein Charge vs Ligand)
    const posDef = ATOM_PROPS.POS_CHARGE_ATOMS[resName as keyof typeof ATOM_PROPS.POS_CHARGE_ATOMS];
    const negDef = ATOM_PROPS.NEG_CHARGE_ATOMS[resName as keyof typeof ATOM_PROPS.NEG_CHARGE_ATOMS];

    // Protein Positive -> Ligand Negative/Ring
    if (posDef) {
      const posAtoms = resAtoms.filter(a => posDef.includes(a.name));
      if (posAtoms.length > 0) {
        const pPosCenter = getCenter(posAtoms);

        // Check Ligand Rings (Cation-Pi)
        ligandRingData.forEach(lRing => {
          if (distance(pPosCenter, lRing.center) < THRESHOLDS.PI_CATION_DIST) {
            interactions.push({
              id: `pic-${idCounter++}`,
              type: InteractionType.PiStacking, // Cation-Pi
              distance: distance(pPosCenter, lRing.center),
              ligandAtom: lRing.atoms[0],
              proteinAtom: posAtoms[0]
            });
          }
        });

        // Check Ligand Negative (Salt Bridge)
        ligandAtoms.forEach(lAtom => {
          // Crude approx: O or S or P often carry neg charge in phosphates/sulfates/carboxyls
          if (['O', 'S', 'P'].includes(lAtom.element)) {
            const d = distance(lAtom, pPosCenter);
            if (d < THRESHOLDS.SALT_BRIDGE_DIST) {
              interactions.push({
                id: `sb-${idCounter++}`,
                type: InteractionType.SaltBridge,
                distance: d,
                ligandAtom: lAtom,
                proteinAtom: posAtoms[0]
              });
            }
          }
        });
      }
    }

    // Protein Negative -> Ligand Positive
    if (negDef) {
      const negAtoms = resAtoms.filter(a => negDef.includes(a.name));
      if (negAtoms.length > 0) {
        const pNegCenter = getCenter(negAtoms);
        ligandAtoms.forEach(lAtom => {
          if (lAtom.element === 'N' || lAtom.name.includes('NH')) { // Amine/Guanidine
            const d = distance(lAtom, pNegCenter);
            if (d < THRESHOLDS.SALT_BRIDGE_DIST) {
              interactions.push({
                id: `sb-${idCounter++}`,
                type: InteractionType.SaltBridge,
                distance: d,
                ligandAtom: lAtom,
                proteinAtom: negAtoms[0]
              });
            }
          }
        });
      }
    }
  });

  // C. ATOM-ATOM INTERACTIONS (HBond, Hydrophobic, Halogen, Metal)
  ligandAtoms.forEach(lAtom => {
    relevantProteinAtoms.forEach(pAtom => {
      const dist = distance(lAtom, pAtom);
      if (dist > Math.max(THRESHOLDS.HBOND_DIST, THRESHOLDS.HYDROPHOBIC_DIST)) return;

      // Hydrogen Bond
      // Heavy-atom distance + donor/acceptor typing is always required (cf. Baker
      // & Hubbard, 1984). When the donor's hydrogen is resolvable in the loaded
      // structure, additionally enforce the D-H-A angle (cf. McDonald & Thornton,
      // 1994); otherwise fall back to distance only, since most PDB/docking
      // structures omit hydrogens.
      if (dist <= THRESHOLDS.HBOND_DIST) {
        const lIsDon = ATOM_PROPS.DONORS.has(lAtom.element);
        const lIsAcc = ATOM_PROPS.ACCEPTORS.has(lAtom.element);
        const pIsDon = ATOM_PROPS.DONORS.has(pAtom.element);
        const pIsAcc = ATOM_PROPS.ACCEPTORS.has(pAtom.element);

        // Avoid Donor-Donor or Acc-Acc clashes (though some atoms are both)
        // Simple rule: If one is D and other is A.
        const match1 = lIsDon && pIsAcc;
        const match2 = lIsAcc && pIsDon;

        if (match1 || match2) {
          // N, O and S are typed as both donor and acceptor, so a pair is usually
          // assignable in either direction. Test every viable direction rather than
          // only the ligand-as-donor one, otherwise the angle check gets skipped
          // whenever the hydrogen sits on the protein side (e.g. Ser OG-H donating
          // to a ligand carbonyl oxygen that carries no hydrogen of its own).
          const candidates: { donor: AtomData; acceptor: AtomData; donorIsLigand: boolean }[] = [];
          if (match1) candidates.push({ donor: lAtom, acceptor: pAtom, donorIsLigand: true });
          if (match2) candidates.push({ donor: pAtom, acceptor: lAtom, donorIsLigand: false });

          let hbAngle: number | undefined;
          let angleOk = false;
          let hasResolvableH = false;

          for (const { donor, acceptor, donorIsLigand } of candidates) {
            const donorPool = donorIsLigand
              ? ligandAtoms
              : (proteinResidues[`${donor.chain}:${donor.resNo}`] ?? relevantProteinAtoms);
            const bondedH = findBondedAtom(donor, donorPool, 'H', BOND_DIST_XH);
            if (!bondedH) continue;

            hasResolvableH = true;
            const angle = angleDeg(donor, bondedH, acceptor);
            if (angle >= THRESHOLDS.HBOND_ANGLE) {
              hbAngle = angle;
              angleOk = true;
              break;
            }
          }

          // Neither candidate donor has a resolvable hydrogen, which is the norm for
          // structures without explicit hydrogens. Fall back to distance alone.
          if (!hasResolvableH) angleOk = true;

          if (angleOk) {
            interactions.push({
              id: `hb-${idCounter++}`,
              type: InteractionType.HydrogenBond,
              distance: dist,
              ligandAtom: lAtom,
              proteinAtom: pAtom,
              angle: hbAngle
            });
          }
        }
      }

      // Halogen Bond
      // Distance + sigma-hole directionality (cf. Auffinger et al., 2004). The
      // halogen is always singly bonded to exactly one ligand carbon, so the
      // C-X...A angle is unconditionally well-defined here (no missing-hydrogen
      // ambiguity, unlike the donor side of a hydrogen bond).
      if (ATOM_PROPS.HALOGENS.has(lAtom.element.toUpperCase()) && ATOM_PROPS.ACCEPTORS.has(pAtom.element)) {
        if (dist <= THRESHOLDS.HALOGEN_DIST) {
          const bondedC = findBondedAtom(lAtom, ligandAtoms, 'C', BOND_DIST_CX);

          let xbAngle: number | undefined;
          let angleOk = true;
          if (bondedC) {
            xbAngle = angleDeg(bondedC, lAtom, pAtom);
            angleOk = xbAngle >= THRESHOLDS.HALOGEN_ANGLE;
          }

          if (angleOk) {
            interactions.push({
              id: `xb-${idCounter++}`,
              type: InteractionType.HalogenBond,
              distance: dist,
              ligandAtom: lAtom,
              proteinAtom: pAtom,
              angle: xbAngle
            });
          }
        }
      }

      // Hydrophobic (Carbon-Carbon only)
      if (lAtom.element === 'C' && pAtom.element === 'C') {
        if (dist <= THRESHOLDS.HYDROPHOBIC_DIST) {
          // Ideally check if these C are part of polar groups (e.g. Carbonyl C).
          // PLIP excludes C in C=O.
          // Heuristic: If C is bonded to more than 1 N/O, exclude? 
          // Without graph, hard to tell. We stick to pure distance C-C.
          interactions.push({
            id: `hp-${idCounter++}`,
            type: InteractionType.Hydrophobic,
            distance: dist,
            ligandAtom: lAtom,
            proteinAtom: pAtom
          });
        }
      }

      // Metal
      if (ATOM_PROPS.METALS.has(lAtom.element.toUpperCase()) || ATOM_PROPS.METALS.has(pAtom.element.toUpperCase())) {
        if (dist <= THRESHOLDS.METAL_DIST) {
          interactions.push({
            id: `mt-${idCounter++}`,
            type: InteractionType.MetalCoordination,
            distance: dist,
            ligandAtom: lAtom,
            proteinAtom: pAtom
          });
        }
      }
    });
  });

  // Deduplicate: If multiple interactions exist between same atom pair, prioritize Strong > Weak.
  // SB > HB > HP
  const pairMap = new Map<string, Interaction>();

  interactions.forEach(i => {
    const key = `${i.ligandAtom.index}-${i.proteinAtom.index}`;
    const existing = pairMap.get(key);
    if (!existing) {
      pairMap.set(key, i);
    } else {
      // Hierarchy: SB > HB > Pi > HP
      const typeScore = (t: InteractionType) => {
        if (t === InteractionType.SaltBridge) return 4;
        if (t === InteractionType.PiStacking) return 3;
        if (t === InteractionType.HydrogenBond) return 2;
        return 1;
      };
      if (typeScore(i.type) > typeScore(existing.type)) {
        pairMap.set(key, i);
      }
    }
  });

  return { interactions: Array.from(pairMap.values()), ligandCenter };
};
