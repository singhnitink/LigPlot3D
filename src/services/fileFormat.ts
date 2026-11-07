/** Supported molecular structure file extensions. */
export const SUPPORTED_EXTENSIONS = ['.pdb', '.ent', '.cif', '.sdf', '.mol2'];

export const isSupportedStructureFile = (fileName: string): boolean =>
  SUPPORTED_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));

/**
 * Parser format names for a file. The extension is lower-cased (NGL rejected
 * '1ABC.PDB' with "ext 'PDB' unknown") and '.ent' is mapped to 'pdb' for 3Dmol,
 * which does not know 'ent'.
 */
export const structureFormat = (fileName: string): { ngl: string; mol3d: string } => {
  const ext = (fileName.split('.').pop() || 'pdb').toLowerCase();
  return { ngl: ext, mol3d: ext === 'ent' ? 'pdb' : ext };
};
