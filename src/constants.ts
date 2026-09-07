
// Interaction Thresholds (Angstroms & Degrees) - SCIENTIFICALLY CORRECTED
export const THRESHOLDS = {
  HBOND_DIST: 3.5, // Heavy atom donor-acceptor distance
  HBOND_ANGLE: 120, // Donor-H-Acceptor angle (≥120°, ≥130° preferred)
  SALT_BRIDGE_DIST: 4.0, // Between charged heavy atoms
  HYDROPHOBIC_DIST: 4.5, // Carbon-carbon contacts (aliphatic/aromatic); not filtered by polarity
  PI_STACKING_DIST: 5.5, // Centroid-centroid max
  PI_STACKING_OFFSET: 2.0, // Max offset for parallel stacking
  PI_STACKING_ANGLE_PARALLEL: 30, // Max deviation from parallel
  PI_STACKING_ANGLE_TSHAPED: 60, // Min angle for T-shaped
  PI_CATION_DIST: 6.0, // Ring center to charge center; 99% of significant cation-pi
                       // interactions fall within 6.0 A (Gallivan & Dougherty, 1999)
  HALOGEN_DIST: 3.5, // Halogen bond distance (approximates sum of vdW radii: 3.27 Cl···O to 3.50 I···O)
  HALOGEN_DON_ANGLE: 165, // Optimal C-X···A donor angle (Auffinger et al., 2004)
  HALOGEN_ANGLE_DEV: 30, // Max deviation from the optimal donor angle
  METAL_DIST: 2.8, // General metal coordination (varies by metal)
};

// --- Residue-name aliases for non-PDB force-field naming ---
// CHARMM/NAMD emit HSD/HSE/HSP, AMBER emits HID/HIE/HIP and GROMACS HISD/HISE/HISH.
// Without these, histidines in any MD-derived structure are invisible to the
// aromatic and charge lookups below, which are keyed on 'HIS'.

// Ring geometry does not depend on protonation, so EVERY histidine variant maps
// to HIS for aromatic / pi-stacking / cation-pi purposes.
export const AROMATIC_RESIDUE_ALIASES: Record<string, string> = {
  HSD: 'HIS', HSE: 'HIS', HSP: 'HIS',
  HID: 'HIS', HIE: 'HIS', HIP: 'HIS',
  HISD: 'HIS', HISE: 'HIS', HISH: 'HIS',
};

// Charge state DOES depend on protonation. Only the doubly-protonated histidine
// (HSP / HIP / HISH) carries a positive charge; HSD/HSE/HID/HIE are neutral and
// are deliberately NOT mapped, so they are not treated as salt-bridge cations.
export const CHARGED_RESIDUE_ALIASES: Record<string, string> = {
  HSP: 'HIS', HIP: 'HIS', HISH: 'HIS',
};

export const aromaticResName = (n: string): string => {
  const u = n.toUpperCase();
  return AROMATIC_RESIDUE_ALIASES[u] ?? u;
};

export const chargedResName = (n: string): string => {
  const u = n.toUpperCase();
  return CHARGED_RESIDUE_ALIASES[u] ?? u;
};

// Residue Definitions
export const RESIDUE_PROPS = {
  HYDROPHOBIC: new Set(['ALA', 'VAL', 'LEU', 'ILE', 'MET', 'PHE', 'TRP', 'PRO', 'CYS']),
  AROMATIC: new Set(['PHE', 'TYR', 'TRP', 'HIS']),
  POSITIVE: new Set(['ARG', 'LYS', 'HIS']),
  NEGATIVE: new Set(['ASP', 'GLU']),
};

// Explicit Ligand Names to always detect (even if not HETATM)
// Includes common drug-like ligands and carbohydrate/polymer residues
export const COMMON_LIGANDS = new Set([
  // Generic ligand names
  'LIG', 'UNK', 'DRG', 'INH', '001', '1',
  // Carbohydrates/Glycans (often appear as ATOM not HETATM)
  'NAG', 'NDG', 'MAN', 'BMA', 'GAL', 'GLC', 'FUC', 'SIA', 'BGC',
  'BGLC', 'BGLCC', 'AGLC', 'AGLCA', // Beta/Alpha glucose variants
  'GLA', 'GUP', 'XYL', 'RIB', 'ARA', // Other sugars
  // Lipids/Fatty acids
  'PLM', 'OLA', 'MYR', 'STE',
  // Common cofactors
  'ATP', 'ADP', 'AMP', 'GTP', 'GDP', 'NAD', 'NADP', 'FAD', 'FMN', 'HEM', 'HEC'
]);
export const IGNORED_RESIDUES = new Set(['HOH', 'DOD', 'TIP', 'WAT', 'SOL', 'NA', 'CL', 'K', 'MG', 'ZN', 'CA', 'MN', 'SO4', 'PO4']);

// Atom Definitions for specific interaction types
export const ATOM_PROPS = {
  // Protein Side Chain Charge Centers
  POS_CHARGE_ATOMS: {
    'ARG': ['NH1', 'NH2', 'CZ'], // Guanidinium group
    'LYS': ['NZ'],
    'HIS': ['ND1', 'NE2']
  },
  NEG_CHARGE_ATOMS: {
    'ASP': ['OD1', 'OD2'],
    'GLU': ['OE1', 'OE2']
  },
  // Protein Aromatic Ring Atoms (for Centroid calc)
  AROMATIC_PLANES: {
    'PHE': ['CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ'],
    'TYR': ['CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ'],
    'TRP': ['CG', 'CD1', 'CD2', 'NE1', 'CE2', 'CE3', 'CZ2', 'CZ3', 'CH2'],
    'HIS': ['CG', 'ND1', 'CD2', 'CE1', 'NE2']
  },
  // General
  // Donors: N or O bonded to H. S can also donate in some cases (thiols).
  // Fluorine is NOT a routine H-bond participant in biological systems.
  DONORS: new Set(['N', 'O', 'S']),
  ACCEPTORS: new Set(['N', 'O', 'S']),
  // Halogen bond donors: Cl, Br, I (F has weak σ-hole, rarely forms halogen bonds)
  HALOGENS: new Set(['CL', 'BR', 'I']),
  METALS: new Set(['ZN', 'MG', 'FE', 'CU', 'CA', 'NA', 'K', 'MN', 'CO', 'NI']),
};
