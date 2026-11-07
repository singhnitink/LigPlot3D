
// Interaction Thresholds (Angstroms & Degrees)
export const THRESHOLDS = {
  HBOND_DIST: 3.5, // Heavy atom donor-acceptor distance
  HBOND_ANGLE: 120, // Donor-H-Acceptor angle (≥120°, ≥130° preferred)
  SALT_BRIDGE_DIST: 4.0, // Between oppositely charged heavy atoms (Barlow & Thornton, 1983)
  HYDROPHOBIC_DIST: 4.5, // Between carbons bonded only to C/H
  PI_STACKING_DIST: 5.5, // Centroid-centroid max
  PI_STACKING_OFFSET: 2.0, // Max lateral offset, parallel AND T-shaped (as PLIP)
  PI_STACKING_ANGLE_PARALLEL: 30, // Max deviation from parallel
  PI_STACKING_ANGLE_TSHAPED: 60, // Min angle for T-shaped
  PI_CATION_DIST: 6.0, // Ring center to charge center; 99% of significant cation-pi
                       // interactions fall within 6.0 A (Gallivan & Dougherty, 1999)
  PI_CATION_OFFSET: 2.0, // Charge centre must project within this distance of the ring centroid (as PLIP)
  HALOGEN_DIST: 3.5, // Halogen bond distance (approximates sum of vdW radii: 3.27 Cl···O to 3.50 I···O)
  HALOGEN_DON_ANGLE: 165, // Optimal C-X···A donor angle (Auffinger et al., 2004)
  HALOGEN_ANGLE_DEV: 30, // Max deviation from the optimal donor angle
  METAL_DIST: 2.8, // General metal coordination (varies by metal)
  // --- geometric perception (no bond orders are available in PDB-type input) ---
  BOND_TOLERANCE: 0.45, // covalent-radius sum + tolerance defines a bond (as Open Babel)
  AROMATIC_PLANARITY: 0.15, // max out-of-plane deviation (Å) of a ligand ring's atoms
  AROMATIC_MEAN_BOND: 1.45, // max mean ring bond length (Å, bonds to S excluded)
  PREFILTER_MARGIN: 6.0, // residues with any atom within this of the ligand are analysed in full
};

// Single-bond covalent radii (Å), Cordero et al. 2008. Keys are NGL's upper-case elements.
export const COVALENT_RADII: Record<string, number> = {
  H: 0.31, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, SI: 1.11, P: 1.07, S: 1.05,
  CL: 1.02, SE: 1.20, BR: 1.20, I: 1.39,
};

// --- Residue-name aliases for non-PDB force-field naming ---
// CHARMM/NAMD emit HSD/HSE/HSP, AMBER emits HID/HIE/HIP and GROMACS HISD/HISE/HISH.
// Ring geometry does not depend on protonation, so EVERY histidine variant maps
// to HIS for aromatic / pi-stacking / cation-pi purposes.
export const AROMATIC_RESIDUE_ALIASES: Record<string, string> = {
  HSD: 'HIS', HSE: 'HIS', HSP: 'HIS',
  HID: 'HIS', HIE: 'HIS', HIP: 'HIS',
  HISD: 'HIS', HISE: 'HIS', HISH: 'HIS',
};

// Histidine charge state. Force-field names state it explicitly. Plain 'HIS' (PDB) is
// resolved in interactionService: explicit HD1+HE2 hydrogens -> cationic, one of them ->
// neutral; no hydrogens -> cationic (PLIP convention) unless it coordinates a metal ion.
export const CATIONIC_HIS = new Set(['HSP', 'HIP', 'HISH']);
export const NEUTRAL_HIS = new Set(['HSD', 'HSE', 'HID', 'HIE', 'HISD', 'HISE']);

export const aromaticResName = (n: string): string => {
  const u = n.toUpperCase();
  return AROMATIC_RESIDUE_ALIASES[u] ?? u;
};

// --- Ligand candidate classification ---
// Generic names docking programs give the ligand. Always candidates (even as ATOM
// records) and ranked first.
export const GENERIC_LIGAND_NAMES = new Set(['LIG', 'UNL', 'DRG', 'INH', 'MOL', '001', '1']);
// Cofactors, glycans and lipids: real ligands but usually not the one under study, so
// they rank below other hetero groups. Glycans often appear as ATOM records, so these
// are also always candidates.
export const COFACTOR_GLYCAN_LIPID = new Set([
  // Carbohydrates/Glycans
  'NAG', 'NDG', 'MAN', 'BMA', 'GAL', 'GLC', 'FUC', 'SIA', 'BGC', 'FUL', 'A2G', 'NGA',
  'BGLC', 'BGLCC', 'AGLC', 'AGLCA', // CHARMM beta/alpha glucose variants
  'GLA', 'GUP', 'XYL', 'RIB', 'ARA',
  // Lipids/Fatty acids
  'PLM', 'OLA', 'MYR', 'STE',
  // Common cofactors
  'ATP', 'ADP', 'AMP', 'ANP', 'GTP', 'GDP', 'GNP', 'NAD', 'NAI', 'NAP', 'NDP', 'NADP',
  'FAD', 'FMN', 'HEM', 'HEC', 'HEA', 'SAM', 'SAH', 'COA', 'ACO', 'PLP', 'TPP',
]);
// Crystallisation additives / buffers: kept as candidates but ranked last.
export const ADDITIVES = new Set([
  'GOL', 'EDO', 'PEG', 'PGE', 'PG4', '1PE', 'P6G', '2PE', 'ACT', 'ACY', 'FMT', 'DMS', 'MPD',
  'MRD', 'BME', 'TRS', 'EPE', 'MES', 'CIT', 'FLC', 'IMD', 'IPA', 'EOH', 'MOH', 'SCN', 'NO3',
  'NH4', 'AZI', 'TAR', 'MLI', 'BU3', 'PE4', 'HEZ', 'CXS',
  // detergents / lipid-cubic-phase lipids
  'BOG', 'LMT', 'LDA', 'C8E', 'BNG', 'SDS', 'OLC', 'DMU', 'UMQ', 'DDQ', 'CPS', 'HTG', 'OGA',
]);
// Waters and simple ions: never ligand candidates. Metal ions among them are still used
// as metal-coordination partners.
export const IGNORED_RESIDUES = new Set([
  'HOH', 'DOD', 'TIP', 'TIP3', 'WAT', 'SOL', 'SPC',
  'NA', 'CL', 'K', 'MG', 'ZN', 'CA', 'MN', 'FE', 'FE2', 'CU', 'CU1', 'CO', 'NI', 'CD', 'HG',
  'SR', 'BA', 'CS', 'LI', 'RB', 'IOD', 'BR', 'F', 'SO4', 'PO4', 'UNX',
  'SOD', 'CLA', 'POT', 'CAL', // CHARMM ion names
]);
// Modified amino acids written as HETATM: part of the protein, not ligands.
export const MODIFIED_RESIDUES = new Set([
  'MSE', 'SEP', 'TPO', 'PTR', 'CSO', 'CSD', 'CME', 'CAS', 'CSS', 'OCS', 'MLY', 'M3L', 'ALY',
  'HYP', 'PCA', 'KCX', 'LLP', 'NEP', 'FME', 'SEC', 'MLZ',
]);

// Atom Definitions for specific interaction types
export const ATOM_PROPS = {
  // Charged side-chain atoms (Barlow & Thornton, 1983). HIS is handled separately.
  POS_CHARGE_ATOMS: {
    'ARG': ['NE', 'NH1', 'NH2'], // Guanidinium group
    'LYS': ['NZ'],
    'HIS': ['ND1', 'NE2'],
  } as Record<string, string[]>,
  NEG_CHARGE_ATOMS: {
    'ASP': ['OD1', 'OD2'],
    'GLU': ['OE1', 'OE2'],
  } as Record<string, string[]>,
  // Protein aromatic rings, atoms listed in ring order. Trp is two rings (as PLIP).
  AROMATIC_RINGS: {
    'PHE': [['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']],
    'TYR': [['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']],
    'TRP': [['CG', 'CD1', 'NE1', 'CE2', 'CD2'], ['CD2', 'CE2', 'CZ2', 'CH2', 'CZ3', 'CE3']],
    'HIS': [['CG', 'ND1', 'CE1', 'NE2', 'CD2']],
  } as Record<string, string[][]>,
  // Donors: N or O bonded to H. S can also donate in some cases (thiols).
  // Fluorine is NOT a routine H-bond participant in biological systems.
  DONORS: new Set(['N', 'O', 'S']),
  ACCEPTORS: new Set(['N', 'O', 'S']),
  // Halogen bond donors: Cl, Br, I (F has weak σ-hole, rarely forms halogen bonds)
  HALOGENS: new Set(['CL', 'BR', 'I']),
  METALS: new Set([
    'ZN', 'MG', 'FE', 'CU', 'CA', 'NA', 'K', 'MN', 'CO', 'NI', 'CD', 'HG', 'SR', 'BA', 'CS',
    'LI', 'RB', 'PT', 'AU', 'AG', 'MO', 'W', 'V', 'CR', 'GA',
  ]),
};
