
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface AtomData extends Point3D {
  index: number;
  name: string;
  element: string;
  resName: string;
  resNo: number;
  chain: string;
  isHet: boolean;
  /** Unique residue identifier (NGL residueIndex); robust to insertion codes. */
  resKey: number;
  /** PDB insertion code ('' when absent). */
  insCode: string;
}

export const InteractionType = {
  HydrogenBond: 'Hydrogen Bond',
  Hydrophobic: 'Hydrophobic',
  SaltBridge: 'Salt Bridge',
  PiStacking: 'Pi-Stacking',
  HalogenBond: 'Halogen Bond',
  MetalCoordination: 'Metal Coordination',
} as const;

export type InteractionType = typeof InteractionType[keyof typeof InteractionType];

export interface Interaction {
  id: string;
  type: InteractionType;
  /** Distance in Å. For ring / charge-centre interactions this is measured between the centre points below. */
  distance: number;
  /** Closest real ligand atom (or a representative atom for ring/charge-centre interactions). */
  ligandAtom: AtomData;
  /** Closest real partner atom (protein residue or metal ion). */
  proteinAtom: AtomData;
  angle?: number;
  /** Finer classification, e.g. 'parallel', 'T-shaped', 'cation-π', 'carboxylate'. */
  subtype?: string;
  /** Geometric centres the distance was measured between (ring centroids, charge centres). */
  ligandPoint?: Point3D;
  proteinPoint?: Point3D;
  /** Human-readable group descriptions for ring / charged-group interactions. */
  ligandLabel?: string;
  proteinLabel?: string;
}

/** One residue of a ligand. */
export interface LigandUnit {
  resName: string;
  resNo: number;
  chain: string;
  insCode: string;
}

export interface ResidueOption {
  resName: string;      // first unit's residue name
  resNo: number;        // first unit's residue number
  resNos?: number[];    // all residue numbers (multi-residue ligands)
  chain: string;        // first unit's chain
  atomCount: number;    // heavy atoms
  /**
   * Every residue of a multi-residue ligand: residues covalently bonded to each other,
   * whatever their names or chains (glucan chains, glycan trees, peptidomimetic fragments).
   */
  units?: LigandUnit[];
}

export interface AnalysisResult {
  interactions: Interaction[];
  ligandCenter: Point3D;
  /** Ligand atoms as analysed (first model, primary altloc) — used to select them in the viewer. */
  ligandAtoms: AtomData[];
  /** All atoms of each partner residue within the binding-site prefilter, keyed by resKey. */
  residueAtoms: Record<number, AtomData[]>;
  /** Whether explicit hydrogens were found (and attached by geometry) on each side. */
  hydrogens: { ligand: boolean; receptor: boolean };
}
