
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

// --- Force-field residue naming ---
// Heavy-atom names (ND1, NE2, NZ, OD1, ...) are the same in PDB, CHARMM, AMBER and GROMACS;
// residue names are not: they encode protonation states. Each variant maps to its standard
// residue plus the protonation state the name declares.
export type ProtonationState = 'charged' | 'neutral';
export const FORCE_FIELD_RESIDUES: Record<string, { base: string; state: ProtonationState }> = {
  // Histidine: CHARMM HSD/HSE/HSP, AMBER HID/HIE/HIP, GROMACS HISD/HISE/HISH
  HSD: { base: 'HIS', state: 'neutral' }, HSE: { base: 'HIS', state: 'neutral' }, HSP: { base: 'HIS', state: 'charged' },
  HID: { base: 'HIS', state: 'neutral' }, HIE: { base: 'HIS', state: 'neutral' }, HIP: { base: 'HIS', state: 'charged' },
  HISD: { base: 'HIS', state: 'neutral' }, HISE: { base: 'HIS', state: 'neutral' }, HISH: { base: 'HIS', state: 'charged' },
  // Protonated (neutral) acids: AMBER ASH/GLH, CHARMM ASPP/GLUP, GROMACS ASPH/GLUH
  ASH: { base: 'ASP', state: 'neutral' }, ASPP: { base: 'ASP', state: 'neutral' }, ASPH: { base: 'ASP', state: 'neutral' },
  GLH: { base: 'GLU', state: 'neutral' }, GLUP: { base: 'GLU', state: 'neutral' }, GLUH: { base: 'GLU', state: 'neutral' },
  // Deprotonated (neutral) bases: AMBER LYN/ARN, CHARMM LSN, GROMACS LYSN
  LYN: { base: 'LYS', state: 'neutral' }, LSN: { base: 'LYS', state: 'neutral' }, LYSN: { base: 'LYS', state: 'neutral' },
  ARN: { base: 'ARG', state: 'neutral' },
  // Cysteine variants (no effect on the interaction classes, but recognised as protein)
  CYX: { base: 'CYS', state: 'neutral' }, CYM: { base: 'CYS', state: 'charged' }, CYSD: { base: 'CYS', state: 'charged' },
};

// GLYCAM glycosylated amino acids (N-linked Asn, O-linked Ser/Thr): protein residues.
const GLYCAM_AMINO_ACIDS: Record<string, string> = { NLN: 'ASN', OLS: 'SER', OLT: 'THR' };

export const STANDARD_AMINO_ACIDS = new Set([
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
  'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
]);

/**
 * Standard residue name and declared protonation state of a (possibly force-field) residue
 * name. Terminal prefixes some AMBER tools write (NALA, CLYS, NHIE ...) are stripped for
 * ATOM records. `state` is undefined when the name does not declare one (e.g. plain HIS).
 */
export const canonicalResidue = (name: string, isHetero = false): { base: string; state?: ProtonationState } => {
  const u = name.toUpperCase();
  const ff = FORCE_FIELD_RESIDUES[u];
  if (ff) return ff;
  if (GLYCAM_AMINO_ACIDS[u]) return { base: GLYCAM_AMINO_ACIDS[u] };
  if (!isHetero && u.length === 4 && (u[0] === 'N' || u[0] === 'C')) {
    const rest = u.slice(1);
    if (STANDARD_AMINO_ACIDS.has(rest)) return { base: rest };
    if (FORCE_FIELD_RESIDUES[rest]) return FORCE_FIELD_RESIDUES[rest];
  }
  return { base: u };
};

/** Ring templates do not depend on protonation: every histidine variant is 'HIS'. */
export const aromaticResName = (n: string, isHetero = false): string => canonicalResidue(n, isHetero).base;

// CHARMM ion residues whose atom name equals the residue name (SOD/SOD ...). Without an
// element column NGL guesses these from the name (SOD -> S, CAL -> C, POT -> P, CLA -> C).
export const CHARMM_ION_ELEMENTS: Record<string, string> = {
  SOD: 'NA', POT: 'K', CLA: 'CL', CAL: 'CA', CES: 'CS', LIT: 'LI', RUB: 'RB', BAR: 'BA', ZN2: 'ZN', CD2: 'CD',
};

/** Hydrogen isotopes: neutron structures write D (deuterium), rarely T. */
export const HYDROGEN_ELEMENTS = new Set(['H', 'D', 'T']);
export const HALIDE_ELEMENTS = new Set(['F', 'CL', 'BR', 'I']);

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
  // Photosynthetic pigments and quinones (chlorophylls, bacteriochlorophylls, pheophytins, carotenoids)
  'CLA', 'CHL', 'BCL', 'BCB', 'BPH', 'PHO', 'BCR', 'CRT', 'LUT', 'NEX', 'XAT', 'PQN', 'PL9', 'UQ8',
]);
// Crystallisation additives / buffers: kept as candidates but ranked last.
export const ADDITIVES = new Set([
  'GOL', 'EDO', 'PEG', 'PGE', 'PG4', '1PE', 'P6G', '2PE', 'ACT', 'ACY', 'FMT', 'DMS', 'MPD',
  'MRD', 'BME', 'TRS', 'EPE', 'MES', 'CIT', 'FLC', 'IMD', 'IPA', 'EOH', 'MOH', 'SCN', 'NO3',
  'NH4', 'AZI', 'TAR', 'MLI', 'BU3', 'PE4', 'HEZ', 'CXS',
  // detergents / lipid-cubic-phase lipids
  'BOG', 'LMT', 'LDA', 'C8E', 'BNG', 'SDS', 'OLC', 'DMU', 'UMQ', 'DDQ', 'CPS', 'HTG', 'OGA',
  '2CV', 'LMU', 'LMN', 'J40', 'D10', 'D12', 'HEX', 'OCT', 'UND', 'LFA', 'PEF', 'PGV', 'PTY',
  // sterols and membrane lipids (crystal: CLR, Y01 ...; MD: POPC, CHL1 ...) — environment, not the ligand
  'CLR', 'Y01', 'CHS', 'OLB', 'PLC', 'PCW', 'LBN', '3PE', 'PEE', 'PGW', 'CDL',
  'POPC', 'POPE', 'POPG', 'POPS', 'POPA', 'DOPC', 'DOPE', 'DOPS', 'DOPG', 'DPPC', 'DMPC', 'DLPC',
  'DSPC', 'DPPE', 'CHL1', 'CHOL', 'PSM', 'SSM', 'SAPI', 'PIP2', 'CARD', 'PALM', 'OLEO',
]);
// Waters and simple ions: never ligand candidates. Metal ions among them are still used
// as metal-coordination partners. Any single-atom metal or halide residue is also treated
// as an ion (so CHARMM SOD/POT/CAL/CLA ions are covered WITHOUT listing those names here —
// "CLA" is also chlorophyll a in the PDB, a multi-atom ligand that must stay selectable).
export const IGNORED_RESIDUES = new Set([
  'HOH', 'DOD', 'TIP', 'TIP3', 'TIP4', 'T3P', 'T4P', 'WAT', 'SOL', 'SPC',
  'NA', 'CL', 'K', 'MG', 'ZN', 'CA', 'MN', 'FE', 'FE2', 'CU', 'CU1', 'CO', 'NI', 'CD', 'HG',
  'SR', 'BA', 'CS', 'LI', 'RB', 'IOD', 'BR', 'F', 'SO4', 'PO4', 'UNX',
]);
// Modified amino acids written as HETATM: part of the protein, not ligands.
export const MODIFIED_RESIDUES = new Set([
  'MSE', 'SEP', 'TPO', 'PTR', 'CSO', 'CSD', 'CME', 'CAS', 'CSS', 'OCS', 'MLY', 'M3L', 'ALY',
  'HYP', 'PCA', 'KCX', 'LLP', 'NEP', 'FME', 'SEC', 'MLZ', 'YCM',
  // modified nucleotides (tRNA / rRNA): part of the nucleic-acid receptor, not ligands
  'PSU', 'H2U', '5MC', '5MU', '2MG', '7MG', 'M2G', '1MA', 'MA6', '1MG', '2MA', '6MZ', '4SU',
  'OMC', 'OMG', 'OMU', 'YYG', 'YG', '3TD', '4OC', '5BU', 'CBR',
]);

// Residue names of the receptor polymer as written in ATOM records — protein (with
// force-field variants and capping groups) and nucleic acids (PDB, AMBER and CHARMM
// spellings). In simulation files EVERYTHING is an ATOM record, so any other residue
// (a GLYCAM sugar such as 4GB/3GB/0GB, a lipid, a cofactor) is treated like a HETATM group.
const PROTEIN_EXTRA = new Set(['UNK', 'ASX', 'GLX', 'PYL', 'ACE', 'NME', 'NMA', 'NHE', 'NH2', 'CT3', 'FOR']);
const NUCLEIC_RESIDUES = new Set([
  'A', 'C', 'G', 'U', 'T', 'I', 'N', 'DA', 'DC', 'DG', 'DT', 'DU', 'DI', 'DN',
  'RA', 'RC', 'RG', 'RU', 'RA5', 'RC5', 'RG5', 'RU5', 'RA3', 'RC3', 'RG3', 'RU3',
  'A5', 'C5', 'G5', 'U5', 'A3', 'C3', 'G3', 'U3', 'AN', 'CN', 'GN', 'UN',
  'DA5', 'DC5', 'DG5', 'DT5', 'DA3', 'DC3', 'DG3', 'DT3', 'DAN', 'DCN', 'DGN', 'DTN',
  'ADE', 'CYT', 'GUA', 'THY', 'URA',
]);
export const isPolymerResidueName = (name: string): boolean => {
  const u = name.trim().toUpperCase();
  if (u === '') return true; // unnamed ATOM residues stay with the receptor
  return STANDARD_AMINO_ACIDS.has(canonicalResidue(u).base) || PROTEIN_EXTRA.has(u)
    || NUCLEIC_RESIDUES.has(u) || MODIFIED_RESIDUES.has(u);
};

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
