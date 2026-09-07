
import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface Props {
    onBack: () => void;
}

const HelpPage: React.FC<Props> = ({ onBack }) => {
    return (
        <div className="h-screen bg-slate-100 flex flex-col font-sans text-slate-900 overflow-hidden">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 shrink-0 h-14 flex items-center justify-between px-6 z-40 shadow-sm">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 text-slate-600 hover:text-indigo-600 transition-colors"
                    >
                        <ArrowLeft size={18} />
                        <span className="text-sm font-medium">Back</span>
                    </button>
                    <h1 className="text-lg font-bold text-slate-800">
                        LigPlot<span className="text-indigo-600">3D</span> — Documentation
                    </h1>
                </div>
            </header>

            {/* Content */}
            <main className="flex-1 overflow-auto p-6">
                <div className="max-w-4xl mx-auto space-y-8">

                    {/* Introduction */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-800 mb-3">About LigPlot3D</h2>
                        <p className="text-slate-600 leading-relaxed">
                            LigPlot3D is a web-based tool for analyzing and visualizing protein-ligand interactions
                            from molecular docking studies. It uses geometric algorithms inspired by PLIP
                            (Protein-Ligand Interaction Profiler) to detect and classify different types of
                            non-covalent interactions.
                        </p>
                    </section>

                    {/* Interaction Types & Cutoffs */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-800 mb-4">Interaction Detection</h2>
                        <p className="text-slate-600 mb-4">
                            All interactions are detected using distance and angle-based geometric criteria.
                            The following table summarizes the thresholds used:
                        </p>

                        <div className="overflow-hidden rounded-lg border border-slate-200">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="text-left px-4 py-3 font-semibold text-slate-700">Interaction Type</th>
                                        <th className="text-left px-4 py-3 font-semibold text-slate-700">Distance Cutoff</th>
                                        <th className="text-left px-4 py-3 font-semibold text-slate-700">Additional Criteria</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-100">
                                    <tr>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">Hydrogen Bond</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-slate-600">≤ 3.5 Å</td>
                                        <td className="px-4 py-3 text-slate-600">
                                            Between donor (N, O, S) and acceptor atoms. Donor–H–Acceptor angle ≥ 120°,
                                            applied when the donor's hydrogen is present in the structure; otherwise the
                                            heavy-atom distance alone is used.
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-1 bg-yellow-50 text-yellow-700 rounded text-xs font-medium">Salt Bridge</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-slate-600">≤ 4.0 Å</td>
                                        <td className="px-4 py-3 text-slate-600">
                                            Between charged heavy atoms: ARG/LYS/HIS (positive) ↔ ASP/GLU or ligand carboxyl/phosphate/sulfate (negative).
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-1 bg-orange-50 text-orange-700 rounded text-xs font-medium">Hydrophobic</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-slate-600">≤ 4.5 Å</td>
                                        <td className="px-4 py-3 text-slate-600">
                                            Carbon–carbon contacts (aliphatic or aromatic).
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium">Pi-Stacking</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-slate-600">≤ 5.5 Å</td>
                                        <td className="px-4 py-3 text-slate-600">
                                            Centroid–centroid distance. Parallel: angle &lt; 30° with lateral offset ≤ 2.0 Å.
                                            T-shaped: angle ≥ 60°.
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium">Cation–π</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-slate-600">≤ 6.0 Å</td>
                                        <td className="px-4 py-3 text-slate-600">
                                            Aromatic ring centroid to a positively charged centre. Reported within the
                                            Pi-Stacking category rather than as a separate interaction type.
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs font-medium">Halogen Bond</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-slate-600">≤ 3.5 Å</td>
                                        <td className="px-4 py-3 text-slate-600">
                                            Between halogen (Cl, Br, I) on ligand and acceptor (N, O, S). C–X···A angle 165° ± 30°.
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-medium">Metal Coordination</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-slate-600">≤ 2.8 Å</td>
                                        <td className="px-4 py-3 text-slate-600">
                                            Between a metal ion (Zn, Mg, Fe, Cu, Ca, Na, K, Mn, Co, Ni) and an electronegative
                                            partner (N, O, S). Optimal distance varies by metal type.
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* How It Works */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-800 mb-4">How Detection Works</h2>
                        <div className="space-y-4 text-slate-600">
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">1. Ligand Identification</h3>
                                <p>
                                    Heteroatoms (HETATM records) are scanned to identify potential ligands. Common residues
                                    like water (HOH), ions (NA, CL, CA), and buffers are excluded. Common ligand names
                                    (LIG, UNK, DRG) are prioritized.
                                </p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">2. Binding Pocket Detection</h3>
                                <p>
                                    All protein atoms within 18 Å of the ligand center are considered for interaction
                                    analysis. This creates a sphere around the ligand for efficient computation.
                                </p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">3. Ring Detection</h3>
                                <p>
                                    For Pi-stacking, aromatic rings in the ligand are detected using a geometric DFS
                                    algorithm that identifies 5–6 membered rings based on bond lengths (&lt; 1.65 Å).
                                </p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">4. Deduplication</h3>
                                <p>
                                    If multiple interaction types are detected for the same atom pair, only the strongest
                                    is kept. Priority: Salt Bridge &gt; Pi-Stacking &gt; Hydrogen Bond &gt; Hydrophobic.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Export Formats */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-800 mb-4">Export File Formats</h2>

                        <div className="space-y-4">
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">CSV Export</h3>
                                <p className="text-slate-600 mb-2">
                                    Comma-separated values with the following columns:
                                </p>
                                <code className="block bg-slate-50 p-3 rounded text-sm font-mono text-slate-700">
                                    ID, Type, Distance (Å), Ligand Atom, Protein Atom, Residue
                                </code>
                                <p className="text-slate-500 text-sm mt-2">
                                    Example: <code>hb-0, Hydrogen Bond, 2.45, O:O1, N:NH1, ARG 42</code>
                                </p>
                            </div>

                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">JSON Export</h3>
                                <p className="text-slate-600 mb-2">
                                    Full interaction data as JSON array. Each object contains:
                                </p>
                                <pre className="bg-slate-50 p-3 rounded text-sm font-mono text-slate-700 overflow-x-auto">
                                    {`{
  "id": "hb-0",
  "type": "Hydrogen Bond",
  "distance": 2.45,
  "ligandAtom": {
    "index": 145,
    "name": "O1",
    "element": "O",
    "x": 12.34, "y": 5.67, "z": 8.90,
    "resName": "LIG",
    "resNo": 1,
    "chain": "A"
  },
  "proteinAtom": {
    "index": 234,
    "name": "NH1",
    "element": "N",
    "x": 10.12, "y": 4.56, "z": 7.89,
    "resName": "ARG",
    "resNo": 42,
    "chain": "A"
  }
}`}</pre>
                            </div>
                        </div>
                    </section>

                    {/* Residue Definitions */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-800 mb-4">Residue Classifications</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">Hydrophobic Residues</h3>
                                <p className="font-mono text-sm text-slate-600">ALA, VAL, LEU, ILE, MET, PHE, TRP, PRO, CYS</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">Aromatic Residues</h3>
                                <p className="font-mono text-sm text-slate-600">PHE, TYR, TRP, HIS</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">Positively Charged</h3>
                                <p className="font-mono text-sm text-slate-600">ARG, LYS, HIS</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">Negatively Charged</h3>
                                <p className="font-mono text-sm text-slate-600">ASP, GLU</p>
                            </div>
                        </div>
                    </section>

                    {/* Limitations */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-800 mb-4">Limitations</h2>
                        <ul className="list-disc list-inside space-y-2 text-slate-600">
                            <li>Hydrogen atoms are often missing from PDB files; H-bond detection uses heavy-atom distances.</li>
                            <li>Water-mediated hydrogen bonds are not currently detected.</li>
                            <li>Covalent bonds between ligand and protein are not analyzed.</li>
                            <li>Angle criteria for H-bonds may be relaxed when hydrogen positions are unavailable.</li>
                        </ul>
                    </section>

                    {/* References */}
                    <section className="pb-8">
                        <h2 className="text-2xl font-bold text-slate-800 mb-4">References</h2>
                        <ul className="space-y-2 text-slate-600">
                            <li>
                                <span className="font-medium">PLIP:</span> Salentin et al. (2015). PLIP: fully automated protein-ligand
                                interaction profiler. <em>Nucleic Acids Research</em>.
                            </li>
                            <li>
                                <span className="font-medium">NGL Viewer:</span> Rose et al. (2018). NGL viewer: web-based molecular
                                graphics for large complexes. <em>Bioinformatics</em>.
                            </li>
                            <li>
                                <span className="font-medium">3Dmol.js:</span> Rego & Koes (2015). 3Dmol.js: molecular visualization
                                with WebGL. <em>Bioinformatics</em>.
                            </li>
                        </ul>
                    </section>

                </div>
            </main>
        </div>
    );
};

export default HelpPage;
