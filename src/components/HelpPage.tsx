
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { InteractionType } from '../types';
import { INTERACTION_STYLES } from '../interactionStyles';
import { THRESHOLDS } from '../constants';

interface Props {
    onBack: () => void;
}

const Badge: React.FC<{ type: InteractionType; children?: React.ReactNode }> = ({ type, children }) => (
    <span className={`px-2 py-1 rounded border text-xs font-medium whitespace-nowrap ${INTERACTION_STYLES[type].badge}`}>
        {children ?? type}
    </span>
);

const T = THRESHOLDS;
/** Distances always with one decimal (4.0 Å, not 4 Å). */
const f = (v: number) => v.toFixed(1);

const HelpPage: React.FC<Props> = ({ onBack }) => {
    return (
        <div className="h-full bg-slate-100 flex flex-col font-sans text-slate-900 overflow-hidden">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 shrink-0 h-14 flex items-center justify-between px-4 md:px-6 z-40 shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex items-center gap-2 text-slate-600 hover:text-indigo-600 transition-colors shrink-0"
                    >
                        <ArrowLeft size={18} aria-hidden="true" />
                        <span className="text-sm font-medium">Back</span>
                    </button>
                    <h1 className="text-base md:text-lg font-bold text-slate-800 truncate">
                        LigPlot<span className="text-indigo-600">3D</span> — Documentation
                    </h1>
                </div>
            </header>

            {/* Content */}
            <main className="flex-1 overflow-auto p-4 md:p-6">
                <div className="max-w-4xl mx-auto space-y-8">

                    {/* Introduction */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-800 mb-3">About LigPlot3D</h2>
                        <p className="text-slate-600 leading-relaxed">
                            LigPlot3D is a web-based tool for analyzing and visualizing protein-ligand interactions
                            from experimental structures and molecular docking studies. It uses geometric criteria
                            adapted from PLIP (Protein-Ligand Interaction Profiler) to detect and classify
                            non-covalent interactions. Everything runs in your browser: structure files are never uploaded.
                        </p>
                    </section>

                    {/* Interaction Types & Cutoffs */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-800 mb-4">Interaction Detection</h2>
                        <p className="text-slate-600 mb-4">
                            All interactions are detected with distance and angle criteria. The thresholds are:
                        </p>

                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full text-sm min-w-[560px]">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th scope="col" className="text-left px-4 py-3 font-semibold text-slate-700">Interaction Type</th>
                                        <th scope="col" className="text-left px-4 py-3 font-semibold text-slate-700">Distance Cutoff</th>
                                        <th scope="col" className="text-left px-4 py-3 font-semibold text-slate-700">Additional Criteria</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-100 text-slate-600">
                                    <tr>
                                        <td className="px-4 py-3"><Badge type={InteractionType.HydrogenBond} /></td>
                                        <td className="px-4 py-3 font-mono">≤ {f(T.HBOND_DIST)} Å</td>
                                        <td className="px-4 py-3">
                                            Donor–acceptor heavy-atom distance between N, O and S atoms. Each direction is judged on its
                                            donor: if that side of the complex contains explicit hydrogens, the donor must carry a hydrogen
                                            with a Donor–H···Acceptor angle ≥ {T.HBOND_ANGLE}°; if it has no hydrogens, the distance alone decides.
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3"><Badge type={InteractionType.SaltBridge} /></td>
                                        <td className="px-4 py-3 font-mono">≤ {f(T.SALT_BRIDGE_DIST)} Å</td>
                                        <td className="px-4 py-3">
                                            Closest pair of oppositely charged heavy atoms (Barlow &amp; Thornton). Protein: Arg (NE, NH1, NH2),
                                            Lys (NZ), cationic His (ND1, NE2), Asp (OD1, OD2), Glu (OE1, OE2). Ligand: charged groups listed
                                            below. One salt bridge is reported per ligand group and residue.
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3"><Badge type={InteractionType.PiStacking}>π-Stacking</Badge></td>
                                        <td className="px-4 py-3 font-mono">≤ {f(T.PI_STACKING_DIST)} Å</td>
                                        <td className="px-4 py-3">
                                            Aromatic ring centroid–centroid distance. Parallel: inter-plane angle ≤ {T.PI_STACKING_ANGLE_PARALLEL}°;
                                            T-shaped: angle ≥ {T.PI_STACKING_ANGLE_TSHAPED}°. Both require a lateral offset ≤ {f(T.PI_STACKING_OFFSET)} Å.
                                            Trp contributes its 5- and 6-membered rings separately; the closest ring is reported.
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3"><Badge type={InteractionType.PiStacking}>Cation–π</Badge></td>
                                        <td className="px-4 py-3 font-mono">≤ {f(T.PI_CATION_DIST)} Å</td>
                                        <td className="px-4 py-3">
                                            Aromatic ring centroid to a positive charge centre (ligand cationic group, or Lys/Arg/cationic His),
                                            which must project within {f(T.PI_CATION_OFFSET)} Å of the ring centroid. Reported in the π category
                                            with the subtype “cation-π”.
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3"><Badge type={InteractionType.HalogenBond} /></td>
                                        <td className="px-4 py-3 font-mono">≤ {f(T.HALOGEN_DIST)} Å</td>
                                        <td className="px-4 py-3">
                                            Ligand halogen (Cl, Br, I) to an acceptor (N, O, S). C–X···A angle {T.HALOGEN_DON_ANGLE}° ± {T.HALOGEN_ANGLE_DEV}°.
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3"><Badge type={InteractionType.MetalCoordination} /></td>
                                        <td className="px-4 py-3 font-mono">≤ {f(T.METAL_DIST)} Å</td>
                                        <td className="px-4 py-3">
                                            Metal ion (Zn, Mg, Fe, Cu, Ca, Na, K, Mn, Co, Ni and others) and an N, O or S atom, in either
                                            direction: a ligand atom bound to a metal ion or cofactor metal (e.g. heme Fe), or a metal
                                            within the ligand bound to the protein.
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3"><Badge type={InteractionType.Hydrophobic} /></td>
                                        <td className="px-4 py-3 font-mono">≤ {f(T.HYDROPHOBIC_DIST)} Å</td>
                                        <td className="px-4 py-3">
                                            Between carbon atoms bonded only to carbon or hydrogen, on both sides (as PLIP). Reduced to
                                            the closest contact per ligand atom and residue, then per protein atom the closest of each
                                            group of bonded ligand atoms. Hidden by default because contacts are numerous.
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
                                <h3 className="font-semibold text-slate-800 mb-2">1. Structure preparation</h3>
                                <p>
                                    Only the first model of multi-model files (docking poses, NMR ensembles) is displayed and
                                    analysed, and only the first alternate location (blank or “A”) of disordered atoms is kept,
                                    so the analysis always matches what is drawn.
                                </p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">2. Ligand identification</h3>
                                <p>
                                    Hetero groups (HETATM) are ligand candidates. Water, simple ions and modified amino acids such as
                                    selenomethionine (MSE) are excluded. Candidates are ranked: generic docking names (LIG, UNL, …) first,
                                    then other hetero groups, then cofactors, glycans and lipids (HEM, NAD, NAG, …), and last
                                    crystallisation additives and detergents (GOL, EDO, PEG, BOG, …); larger groups first within a rank.
                                    Covalently linked residues of the same name (e.g. glycan chains) are grouped into one ligand.
                                    Any residue can also be selected by name with the search box.
                                </p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">3. Binding site</h3>
                                <p>
                                    Every protein residue with any atom within {f(T.PREFILTER_MARGIN)} Å of any ligand atom is analysed, and
                                    always in full, so rings and charged groups at the edge of the site keep all their atoms.
                                    Metal ions within the same distance are included as coordination partners. Waters, other
                                    ligands and cofactors are not interaction partners.
                                </p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">4. Chemical perception from geometry</h3>
                                <p className="mb-2">
                                    Structure files rarely carry bond orders, so ligand chemistry is perceived from coordinates.
                                    Bonds are assigned from covalent radii (sum + {T.BOND_TOLERANCE.toFixed(2)} Å).
                                </p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li>
                                        <strong>Aromatic rings:</strong> 5- or 6-membered rings that are planar (every atom within
                                        {' '}{T.AROMATIC_PLANARITY.toFixed(2)} Å of the ring plane), contain no 4-connected atoms and have short
                                        bonds (mean ≤ {T.AROMATIC_MEAN_BOND.toFixed(2)} Å, bonds to S excluded). Sugars and saturated rings are not aromatic.
                                    </li>
                                    <li>
                                        <strong>Ligand cations:</strong> quaternary ammonium, aliphatic primary/secondary/tertiary
                                        amines (not amides, anilines or aromatic N), amidinium/guanidinium, sulfonium.
                                    </li>
                                    <li>
                                        <strong>Ligand anions:</strong> carboxylate, phosphate/phosphonate, sulfate/sulfonate.
                                    </li>
                                    <li>
                                        <strong>Histidine:</strong> force-field names state the charge (HSP/HIP/HISH cationic;
                                        HSD/HSE/HID/HIE neutral). For plain HIS, explicit hydrogens decide (cationic only with both
                                        HD1 and HE2); without hydrogens it is treated as cationic (PLIP convention) unless it
                                        coordinates a metal ion.
                                    </li>
                                </ul>
                            </div>
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">5. Refinement</h3>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li>Atoms of a salt bridge's two charged groups are not reported again as an H-bond (as PLIP).</li>
                                    <li>Atoms in the same metal's coordination sphere, and metal-bound ring nitrogens (e.g. His NE2), are not H-bond partners.</li>
                                    <li>Atoms of two π-stacked rings are not reported again as hydrophobic contacts (as PLIP).</li>
                                    <li>If the same atom pair qualifies for several types, only the strongest is kept:
                                        Metal &gt; Salt Bridge &gt; π &gt; Hydrogen/Halogen Bond &gt; Hydrophobic.</li>
                                </ul>
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
                                    UTF-8 comma-separated values (opens directly in spreadsheet software) with the columns:
                                </p>
                                <code className="block bg-slate-50 p-3 rounded text-sm font-mono text-slate-700 break-words">
                                    File, Ligand, ID, Type, Subtype, Distance (Å), Angle (°), Ligand Residue, Ligand Chain,
                                    Ligand Atom(s), Ligand Element, Partner Residue, Partner Chain, Partner Atom(s), Partner Element
                                </code>
                                <p className="text-slate-500 text-sm mt-2">
                                    For ring and charge-centre interactions the atom columns name the group
                                    (e.g. <code>ring CG-CD1-NE1-CE2-CD2</code>) and the distance is measured between the group centres.
                                </p>
                            </div>

                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="font-semibold text-slate-800 mb-2">JSON Export</h3>
                                <p className="text-slate-600 mb-2">
                                    The full interaction list as a JSON array. Each object contains:
                                </p>
                                <pre className="bg-slate-50 p-3 rounded text-sm font-mono text-slate-700 overflow-x-auto">
                                    {`{
  "id": "sb-3",
  "type": "Salt Bridge",
  "subtype": "carboxylate",
  "distance": 2.89,
  "ligandAtom": { "index": 2440, "name": "OXT", "element": "O",
                  "x": 12.34, "y": 5.67, "z": 8.90,
                  "resName": "PBE", "resNo": 1001, "chain": "A", ... },
  "proteinAtom": { "name": "NE2", "resName": "HIS", "resNo": 69, ... },
  // ring / charge-centre interactions also carry:
  "ligandPoint": { "x": ..., "y": ..., "z": ... },
  "proteinPoint": { "x": ..., "y": ..., "z": ... },
  "ligandLabel": "...", "proteinLabel": "...", "angle": ...
}`}</pre>
                            </div>
                        </div>
                    </section>

                    {/* Limitations */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-800 mb-4">Limitations</h2>
                        <ul className="list-disc pl-5 space-y-2 text-slate-600">
                            <li>Hydrogen atoms are often missing from structure files; H-bond detection then relies on heavy-atom distances and cannot tell donors from acceptors.</li>
                            <li>Protonation states are assumed (amines and carboxylates charged; His as described above), not computed.</li>
                            <li>Chemistry is perceived from geometry; badly distorted ligand geometries can be misclassified.</li>
                            <li>Water-mediated hydrogen bonds are not detected.</li>
                            <li>Covalent bonds between ligand and protein are not analyzed.</li>
                            <li>Only the first model of multi-model files is analysed.</li>
                        </ul>
                    </section>

                    {/* Privacy */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-800 mb-4">Privacy</h2>
                        <p className="text-slate-600">
                            Structure files are read and analysed entirely in your browser and are never sent to a server.
                            Entries loaded by PDB ID are downloaded directly from the RCSB PDB (files.rcsb.org).
                            The site uses Google Analytics to count anonymous page visits.
                        </p>
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
                                <span className="font-medium">Salt bridges:</span> Barlow &amp; Thornton (1983). Ion-pairs in proteins.
                                <em> Journal of Molecular Biology</em>.
                            </li>
                            <li>
                                <span className="font-medium">Cation–π:</span> Gallivan &amp; Dougherty (1999). Cation-π interactions in
                                structural biology. <em>PNAS</em>.
                            </li>
                            <li>
                                <span className="font-medium">Halogen bonds:</span> Auffinger et al. (2004). Halogen bonds in biological
                                molecules. <em>PNAS</em>.
                            </li>
                            <li>
                                <span className="font-medium">Covalent radii:</span> Cordero et al. (2008). Covalent radii revisited.
                                <em> Dalton Transactions</em>.
                            </li>
                            <li>
                                <span className="font-medium">3Dmol.js</span> (visualisation): Rego &amp; Koes (2015). 3Dmol.js: molecular
                                visualization with WebGL. <em>Bioinformatics</em>.
                            </li>
                            <li>
                                <span className="font-medium">NGL</span> (file parsing): Rose et al. (2018). NGL viewer: web-based molecular
                                graphics for large complexes. <em>Bioinformatics</em>.
                            </li>
                        </ul>
                    </section>

                </div>
            </main>
        </div>
    );
};

export default HelpPage;
