
import * as NGL from 'ngl';
import { InteractionType } from '../types';
import { THRESHOLDS, ATOM_PROPS, COMMON_LIGANDS, IGNORED_RESIDUES, aromaticResName, chargedResName } from '../constants';
import { distance, getCenter, getPlaneNormal, angleBetween, angleDeg, lateralOffset } from './geometryUtils';
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

export const getLigandCandidates = (structure: NGL.Structure): ResidueOption[] => {
  // First pass: collect all potential ligand residues
  const residueMap: Map<string, { resName: string; resNo: number; chain: string; atomCount: number; centerX: number; centerY: number; centerZ: number; heavy: { x: number; y: number; z: number }[] }> = new Map();

  structure.eachResidue((rp) => {
    const resNameUpper = rp.resname.toUpperCase();
    const isCommon = COMMON_LIGANDS.has(resNameUpper);
    const isHet = rp.isHetero();
    const isIgnored = IGNORED_RESIDUES.has(resNameUpper);

    if (isCommon || (isHet && !isIgnored)) {
      const key = `${rp.chainname}:${rp.resno}`;
      if (!residueMap.has(key)) {
        // Calculate center of residue, and retain heavy-atom coordinates so
        // polymer linkage can be decided by covalent bond distance below.
        let sumX = 0, sumY = 0, sumZ = 0, count = 0;
        const heavy: { x: number; y: number; z: number }[] = [];
        rp.eachAtom((ap: any) => {
          sumX += ap.x;
          sumY += ap.y;
          sumZ += ap.z;
          count++;
          if (ap.element !== 'H') heavy.push({ x: ap.x, y: ap.y, z: ap.z });
        });
        residueMap.set(key, {
          resName: rp.resname,
          resNo: rp.resno,
          chain: rp.chainname,
          atomCount: rp.atomCount,
          centerX: count > 0 ? sumX / count : 0,
          centerY: count > 0 ? sumY / count : 0,
          centerZ: count > 0 ? sumZ / count : 0,
          heavy
        });
      }
    }
  });

  // Second pass: group residues with same name/chain that are spatially connected (polymer chains)
  const residues = Array.from(residueMap.values());
  const grouped: Map<string, ResidueOption> = new Map();
  const visited = new Set<string>();

  // Two residues belong to the same polymer if any pair of their heavy atoms is
  // within covalent bonding distance. Glycosidic C-O is ~1.40 A and peptide C-N
  // ~1.33 A, so 1.9 A accepts every real linkage while rejecting mere packing.
  //
  // This replaces an earlier centroid-to-centroid test with a 5.0 A cutoff, which
  // silently fragmented long chains: consecutive glucose centroids in a glucan run
  // 4.6-5.7 A apart, straddling that threshold, so a 10-residue chain was split
  // into a 5-residue group plus five singletons and only part of it was analysed.
  const POLYMER_BOND_MAX = 1.9;

  const areBonded = (
    a: { heavy: { x: number; y: number; z: number }[]; centerX: number; centerY: number; centerZ: number },
    b: { heavy: { x: number; y: number; z: number }[]; centerX: number; centerY: number; centerZ: number }
  ): boolean => {
    // Cheap bounding-sphere reject before the O(n*m) atom scan.
    const dc = Math.sqrt(
      (a.centerX - b.centerX) ** 2 + (a.centerY - b.centerY) ** 2 + (a.centerZ - b.centerZ) ** 2
    );
    if (dc > 25) return false;
    for (const p of a.heavy) {
      for (const q of b.heavy) {
        const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
        if (dx * dx + dy * dy + dz * dz <= POLYMER_BOND_MAX * POLYMER_BOND_MAX) return true;
      }
    }
    return false;
  };

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

        // Check if this residue is covalently linked to any in our group
        for (const groupedResNo of resNos) {
          const groupedRes = residueMap.get(`${res.chain}:${groupedResNo}`);
          if (!groupedRes) continue;

          if (areBonded(other, groupedRes)) {
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
  //
  // Measured against the NEAREST LIGAND ATOM, not the ligand centroid. A centroid
  // radius is only safe while the ligand is small: this previously used 18 A from
  // the centroid, so for an extended polymer ligand any atom more than ~13.5 A out
  // could find no partners at all and its residues silently reported no contacts.
  // A 10-residue glucan spans ~24 A from its own centroid, so both chain ends went
  // blank. Distance to the nearest ligand atom is correct for any ligand size.
  const PREFILTER_MARGIN = 6.0; // > the 4.5 A max per-pair cutoff, with headroom
  const ligandGrid = new Map<string, AtomData[]>();
  const cellKey = (x: number, y: number, z: number) =>
    `${Math.floor(x / PREFILTER_MARGIN)},${Math.floor(y / PREFILTER_MARGIN)},${Math.floor(z / PREFILTER_MARGIN)}`;
  ligandAtoms.forEach(a => {
    const k = cellKey(a.x, a.y, a.z);
    const arr = ligandGrid.get(k);
    if (arr) arr.push(a); else ligandGrid.set(k, [a]);
  });

  const relevantProteinAtoms = proteinAtoms.filter(pAtom => {
    const cx = Math.floor(pAtom.x / PREFILTER_MARGIN);
    const cy = Math.floor(pAtom.y / PREFILTER_MARGIN);
    const cz = Math.floor(pAtom.z / PREFILTER_MARGIN);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          const bucket = ligandGrid.get(`${cx + i},${cy + j},${cz + k}`);
          if (!bucket) continue;
          for (const l of bucket) {
            if (distance(pAtom, l) <= PREFILTER_MARGIN) return true;
          }
        }
      }
    }
    return false;
  });

  const proteinResidues: Record<string, AtomData[]> = {};
  relevantProteinAtoms.forEach(a => {
    const key = `${a.chain}:${a.resNo}`;
    if (!proteinResidues[key]) proteinResidues[key] = [];
    proteinResidues[key].push(a);
  });

  // 2b. Map each hydrogen to the heavy atom it is covalently bonded to.
  // Used for the donor-H-acceptor angle criterion. Hydrogens bond within their
  // own residue, so only that residue is scanned. Most crystallographic and
  // docking-derived structures omit hydrogens entirely; in that case this map is
  // empty and the heavy-atom distance criterion alone governs assignment.
  const HYDROGEN_COVALENT_MAX = 1.3;
  const atomsByResidue = new Map<string, AtomData[]>();
  const bucketByResidue = (a: AtomData) => {
    const k = `${a.chain}:${a.resNo}`;
    const arr = atomsByResidue.get(k);
    if (arr) arr.push(a); else atomsByResidue.set(k, [a]);
  };
  ligandAtoms.forEach(bucketByResidue);
  relevantProteinAtoms.forEach(bucketByResidue);

  const donorHydrogens = new Map<number, AtomData[]>(); // heavy atom index -> bonded H
  atomsByResidue.forEach(atoms => {
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
    // Normalise force-field histidine names (HSD/HSE/HSP, HID/HIE/HIP, ...).
    // Aromatic geometry applies to every variant; positive charge only to the
    // doubly-protonated ones. See constants.ts for the rationale.
    const aromName = aromaticResName(resName);
    const chargeName = chargedResName(resName);

    // A. PI-STACKING & PI-CATION (Protein Ring vs Ligand)
    const aromDef = ATOM_PROPS.AROMATIC_PLANES[aromName as keyof typeof ATOM_PROPS.AROMATIC_PLANES];
    if (aromDef) {
      const ringAtoms = resAtoms.filter(a => aromDef.includes(a.name));
      if (ringAtoms.length >= 3) {
        const pCenter = getCenter(ringAtoms);
        const pNormal = getPlaneNormal(ringAtoms);

        // Pi-Stacking
        ligandRingData.forEach(lRing => {
          const dist = distance(pCenter, lRing.center);
          if (dist <= THRESHOLDS.PI_STACKING_DIST) {
            // angleBetween() takes |dot|, so it only ever returns 0-90 deg.
            // The old `|| angle > 150` and `&& angle < 120` clauses were therefore
            // unreachable; removing them leaves the semantics identical.
            const angle = angleBetween(pNormal, lRing.normal);
            // Parallel stacking additionally requires a small lateral offset,
            // otherwise two coplanar but laterally displaced rings would qualify.
            // Measured against both ring planes, taking the smaller (as PLIP does).
            const offset = Math.min(
              lateralOffset(pCenter, lRing.center, pNormal),
              lateralOffset(pCenter, lRing.center, lRing.normal)
            );
            const isParallel = angle <= THRESHOLDS.PI_STACKING_ANGLE_PARALLEL
              && offset <= THRESHOLDS.PI_STACKING_OFFSET;
            const isTShaped = angle >= THRESHOLDS.PI_STACKING_ANGLE_TSHAPED;

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
          if ((lAtom.element === 'N' || lAtom.name.includes('NH')) && distance(lAtom, pCenter) <= THRESHOLDS.PI_CATION_DIST) {
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
    const posDef = ATOM_PROPS.POS_CHARGE_ATOMS[chargeName as keyof typeof ATOM_PROPS.POS_CHARGE_ATOMS];
    const negDef = ATOM_PROPS.NEG_CHARGE_ATOMS[chargeName as keyof typeof ATOM_PROPS.NEG_CHARGE_ATOMS];

    // Protein Positive -> Ligand Negative/Ring
    if (posDef) {
      const posAtoms = resAtoms.filter(a => posDef.includes(a.name));
      if (posAtoms.length > 0) {
        const pPosCenter = getCenter(posAtoms);

        // Check Ligand Rings (Cation-Pi)
        ligandRingData.forEach(lRing => {
          if (distance(pPosCenter, lRing.center) <= THRESHOLDS.PI_CATION_DIST) {
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
            if (d <= THRESHOLDS.SALT_BRIDGE_DIST) {
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
            if (d <= THRESHOLDS.SALT_BRIDGE_DIST) {
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
      // PLIP uses 4.1A and Angle > 90. We check Element types + Distance.
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
          // Enforce the donor-H-acceptor angle when the donor's hydrogen is
          // resolvable from the structure. DONORS and ACCEPTORS are the same set
          // {N,O,S}, so both directions are tested and either may satisfy it.
          // If neither candidate donor carries a hydrogen -- the usual case for
          // crystallographic and docked structures -- fall back to the heavy-atom
          // distance criterion alone, preserving the previous behaviour exactly.
          const lH = donorHydrogens.get(lAtom.index);
          const pH = donorHydrogens.get(pAtom.index);
          const lHas = !!lH && lH.length > 0;
          const pHas = !!pH && pH.length > 0;

          let accept = false;
          if (!lHas && !pHas) {
            accept = true; // no hydrogens available: distance-only, as before
          } else {
            if (lHas) {
              for (const h of lH!) {
                if (angleDeg(lAtom, h, pAtom) >= THRESHOLDS.HBOND_ANGLE) { accept = true; break; }
              }
            }
            if (!accept && pHas) {
              for (const h of pH!) {
                if (angleDeg(pAtom, h, lAtom) >= THRESHOLDS.HBOND_ANGLE) { accept = true; break; }
              }
            }
          }

          if (accept) {
            interactions.push({
              id: `hb-${idCounter++}`,
              type: InteractionType.HydrogenBond,
              distance: dist,
              ligandAtom: lAtom,
              proteinAtom: pAtom
            });
          }
        }
      }

      // Halogen Bond
      if (ATOM_PROPS.HALOGENS.has(lAtom.element.toUpperCase()) && ATOM_PROPS.ACCEPTORS.has(pAtom.element)) {
        if (dist <= THRESHOLDS.HALOGEN_DIST) {
          // Enforce sigma-hole directionality: the C-X...A angle must lie within
          // HALOGEN_ANGLE_DEV of the optimal donor angle (Auffinger et al., 2004).
          // A halogen substituent is bonded to exactly one heavy atom, so this is
          // normally well defined; if that carbon cannot be located, fall back to
          // the distance criterion alone rather than silently losing the contact.
          const bondedC = findBondedCarbon(lAtom, ligandAtoms);
          let accept = true;
          let xAngle: number | undefined;
          if (bondedC) {
            xAngle = angleDeg(bondedC, lAtom, pAtom);
            accept = Math.abs(xAngle - THRESHOLDS.HALOGEN_DON_ANGLE) <= THRESHOLDS.HALOGEN_ANGLE_DEV;
          }
          if (accept) {
            interactions.push({
              id: `xb-${idCounter++}`,
              type: InteractionType.HalogenBond,
              distance: dist,
              ligandAtom: lAtom,
              proteinAtom: pAtom,
              angle: xAngle
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

      // Metal coordination.
      // Exactly one side must be the metal, and the coordinating partner must be
      // an electronegative donor (N/O/S). Previously an `||` allowed the partner
      // to be any element (including carbon) and allowed metal-metal pairs.
      const lIsMetal = ATOM_PROPS.METALS.has(lAtom.element.toUpperCase());
      const pIsMetal = ATOM_PROPS.METALS.has(pAtom.element.toUpperCase());
      if (lIsMetal !== pIsMetal) {
        const partner = lIsMetal ? pAtom : lAtom;
        if (ATOM_PROPS.ACCEPTORS.has(partner.element) && dist <= THRESHOLDS.METAL_DIST) {
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
