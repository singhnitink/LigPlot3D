
import React, { useEffect, useRef, useState } from 'react';
import * as $3Dmol from '3dmol';
import * as NGL from 'ngl';
import { ZoomIn, ZoomOut, Camera, Loader2, AlertTriangle } from 'lucide-react';
import { prepareStructure } from '../services/interactionService';
import { structureFormat } from '../services/fileFormat';
import type { PreparedStructure } from '../services/interactionService';
import { INTERACTION_STYLES, LIGAND_ELEMENT_COLORS } from '../interactionStyles';
import type { AnalysisResult, Interaction, Point3D } from '../types';
import type { VisualSettings } from '../App';

interface Props {
    file: File | null;
    onStructureLoaded: (prepared: PreparedStructure) => void;
    onLoadError: (message: string) => void;
    /** Identity of the selected ligand; the camera re-centres only when this changes. */
    ligandKey: string | null;
    analysis: AnalysisResult | null;
    interactions: Interaction[];
    visualSettings: VisualSettings;
    triggerRecenter: number;
}

/**
 * Selects 3Dmol atoms by coordinates rather than by chain/residue name. The two
 * parsers name things differently (a blank chain is '' in NGL but ' ' in 3Dmol;
 * SDF/MOL2 residue names differ), but they always agree on coordinates.
 */
const coordinateSelection = (points: Point3D[]): $3Dmol.AtomSelectionSpec => {
    if (points.length === 0) return { predicate: () => false };
    const q = (v: number) => Math.round(v * 1000);
    const keys = new Set(points.map(p => `${q(p.x)},${q(p.y)},${q(p.z)}`));
    const pad = 0.01;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const p of points) {
        min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
    }
    return {
        predicate: (atom: $3Dmol.AtomSpec) => {
            const x = atom.x ?? NaN, y = atom.y ?? NaN, z = atom.z ?? NaN;
            if (x < min.x - pad || x > max.x + pad || y < min.y - pad || y > max.y + pad || z < min.z - pad || z > max.z + pad) return false;
            const kx = q(x), ky = q(y), kz = q(z);
            if (keys.has(`${kx},${ky},${kz}`)) return true;
            // float32 (NGL) vs float64 (3Dmol) can round to neighbouring keys
            for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
                if (keys.has(`${kx + i},${ky + j},${kz + k}`)) return true;
            }
            return false;
        },
    };
};

const elementScheme = (carbon: string) => ({ prop: 'elem', map: { ...LIGAND_ELEMENT_COLORS, C: carbon } });

const Viewer3Dmol: React.FC<Props> = ({
    file,
    onStructureLoaded,
    onLoadError,
    ligandKey,
    analysis,
    interactions,
    visualSettings,
    triggerRecenter,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<$3Dmol.GLViewer | null>(null);
    // Status is only ever set from asynchronous load callbacks; "loading" is derived.
    const [loadedFile, setLoadedFile] = useState<File | null>(null);
    const [failed, setFailed] = useState<{ file: File; message: string } | null>(null);
    const [modelVersion, setModelVersion] = useState(0);
    const loading = !!file && loadedFile !== file && failed?.file !== file;

    // Latest callbacks without re-triggering the load effect.
    const callbacks = useRef({ onStructureLoaded, onLoadError });
    useEffect(() => { callbacks.current = { onStructureLoaded, onLoadError }; });

    // One viewer for the lifetime of the component (the container is always mounted).
    useEffect(() => {
        if (!containerRef.current) return;
        const viewer = $3Dmol.createViewer(containerRef.current, { backgroundColor: 'white' });
        viewerRef.current = viewer;
        return () => {
            viewer.clear();
            viewerRef.current = null;
        };
    }, []);

    // Load a file: render in 3Dmol, parse with NGL (no WebGL Stage) for the analysis.
    useEffect(() => {
        const viewer = viewerRef.current;
        if (!viewer) return;
        viewer.clear();
        viewer.render();
        if (!file) return;

        let cancelled = false; // a newer file supersedes this one (rapid re-uploads)
        const fail = (message: string) => {
            if (cancelled) return;
            setFailed({ file, message });
            callbacks.current.onLoadError(message);
        };
        const reader = new FileReader();
        reader.onerror = () => fail(`Could not read “${file.name}”.`);
        reader.onload = async () => {
            if (cancelled) return;
            const content = String(reader.result ?? '');
            const fmt = structureFormat(file.name);
            try {
                viewer.addModel(content, fmt.mol3d);
                viewer.setStyle({}, { cartoon: { color: '#888888' } });
                viewer.zoomTo();
                viewer.render();
            } catch (err) {
                console.error('3Dmol parse error:', err);
                fail(`“${file.name}” could not be displayed. Is it a valid ${fmt.mol3d.toUpperCase()} file?`);
                return;
            }
            try {
                const raw = await NGL.autoLoad(new Blob([content], { type: 'text/plain' }), { ext: fmt.ngl });
                if (cancelled) return;
                if (!raw || typeof raw.eachAtom !== 'function' || raw.atomCount === 0) {
                    fail(`No atoms could be read from “${file.name}”.`);
                    return;
                }
                callbacks.current.onStructureLoaded(prepareStructure(raw as NGL.Structure));
                setLoadedFile(file);
                setModelVersion(v => v + 1);
            } catch (err) {
                console.error('NGL parse error:', err);
                fail(`“${file.name}” was displayed but could not be analysed (${String((err as Error)?.message ?? err)}).`);
            }
        };
        reader.readAsText(file);
        return () => {
            cancelled = true;
            reader.onload = null;
            reader.onerror = null;
        };
    }, [file]);

    // Ligand selection (by coordinates) shared by styling, zoom and recenter.
    const ligandSel = React.useMemo(
        () => coordinateSelection(analysis?.ligandAtoms ?? []),
        [analysis]
    );

    // Camera framing: the ligand plus every residue it interacts with (all types,
    // independent of filters), so the pocket context stays in view on small screens.
    const focusSel = React.useMemo(() => {
        if (!analysis) return coordinateSelection([]);
        const keys = new Set(analysis.interactions.map(i => i.proteinAtom.resKey));
        return coordinateSelection([...analysis.ligandAtoms, ...[...keys].flatMap(k => analysis.residueAtoms[k] ?? [])]);
    }, [analysis]);

    // Camera: frame the binding site when a ligand (or a new structure) is selected —
    // NOT on every style/filter change, which used to throw away the user's view.
    useEffect(() => {
        const viewer = viewerRef.current;
        if (!viewer || !ligandKey || !analysis || analysis.ligandAtoms.length === 0) return;
        viewer.zoomTo(focusSel, 500);
    }, [ligandKey, modelVersion, focusSel, analysis]);

    useEffect(() => {
        const viewer = viewerRef.current;
        if (!viewer || triggerRecenter === 0) return;
        if (analysis && analysis.ligandAtoms.length > 0) viewer.zoomTo(focusSel, 500);
        else viewer.zoomTo({}, 500);
        // only the button press should recenter
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [triggerRecenter]);

    // Scene: styles, pocket, labels, interaction lines.
    useEffect(() => {
        const viewer = viewerRef.current;
        if (!viewer || modelVersion === 0) return;

        viewer.removeAllShapes();
        viewer.removeAllLabels(); // always: labels of hidden interactions must go too
        viewer.setStyle({}, {});

        // 1. Context protein
        const opacity = Math.min(1, Math.max(0, visualSettings.proteinOpacity));
        const grey = '#cccccc';
        switch (visualSettings.proteinStyle) {
            case 'cartoon':
                viewer.setStyle({}, { cartoon: { color: grey, opacity } });
                break;
            case 'rope':
                viewer.setStyle({}, { cartoon: { color: grey, style: 'trace', thickness: 0.3, opacity } });
                break;
            case 'line':
                // 3Dmol lines have no opacity; the slider is disabled for this style.
                viewer.setStyle({}, { line: { color: grey } });
                break;
            case 'hidden':
                break;
        }

        // 2. Pocket residues and metal ions that take part in a shown interaction
        if (analysis) {
            const keys = Array.from(new Set(interactions.map(i => i.proteinAtom.resKey)));
            const residues = keys.map(k => analysis.residueAtoms[k]).filter((r): r is NonNullable<typeof r> => !!r && r.length > 0);
            const multiChain = new Set(residues.map(r => r[0].chain)).size > 1;
            const stickRadius = visualSettings.pocketStyle === 'licorice' ? 0.35 : visualSettings.pocketStyle === 'ball+stick' ? 0.15 : 0.2;
            for (const atoms of residues) {
                const isIon = atoms.length === 1;
                const sel = coordinateSelection(atoms);
                if (isIon) {
                    viewer.addStyle(sel, { sphere: { scale: 0.6 } });
                } else {
                    viewer.addStyle(sel, visualSettings.pocketStyle === 'ball+stick'
                        ? { stick: { radius: stickRadius }, sphere: { scale: 0.25 } }
                        : { stick: { radius: stickRadius } });
                }
                const a0 = atoms[0];
                const anchor = atoms.find(a => a.name === 'CA' && !isIon) ?? a0;
                viewer.addLabel(`${a0.resName} ${a0.resNo}${a0.insCode}${multiChain ? ` (${a0.chain})` : ''}`, {
                    fontSize: 11,
                    fontColor: '#374151',
                    backgroundColor: 'white',
                    backgroundOpacity: 0.85,
                    inFront: true,
                    alignment: 'center',
                    position: { x: anchor.x, y: anchor.y, z: anchor.z },
                });
            }
        }

        // 3. Ligand
        if (analysis && analysis.ligandAtoms.length > 0) {
            const scheme = elementScheme(visualSettings.ligandColor);
            const style: $3Dmol.AtomStyleSpec =
                visualSettings.ligandStyle === 'spacefill' ? { sphere: { colorscheme: scheme } }
                : visualSettings.ligandStyle === 'licorice' ? { stick: { radius: 0.3, colorscheme: scheme } }
                : { stick: { radius: 0.25, colorscheme: scheme }, sphere: { scale: 0.25, colorscheme: scheme } };
            viewer.setStyle(ligandSel, style);
        }

        // 4. Interaction lines — between the points the distance was measured from
        // (ring centroids / charge centres), so drawn length == reported distance.
        for (const i of interactions) {
            const s = INTERACTION_STYLES[i.type];
            const from = i.proteinPoint ?? i.proteinAtom;
            const to = i.ligandPoint ?? i.ligandAtom;
            viewer.addCylinder({
                start: { x: from.x, y: from.y, z: from.z },
                end: { x: to.x, y: to.y, z: to.z },
                radius: visualSettings.interactionWidth / 20.0,
                color: s.color,
                dashed: s.dashed,
                fromCap: 1,
                toCap: 1,
            });
            for (const p of [i.ligandPoint, i.proteinPoint]) {
                if (p) viewer.addSphere({ center: { x: p.x, y: p.y, z: p.z }, radius: 0.18, color: s.color });
            }
        }

        viewer.render();
    }, [analysis, interactions, visualSettings, ligandSel, modelVersion]);

    const handleZoom = (zoomIn: boolean) => viewerRef.current?.zoom(zoomIn ? 1.25 : 0.8);
    const handleTranslate = (x: number, y: number) => viewerRef.current?.translate(x, y);

    const handleSnapshot = (e: React.MouseEvent) => {
        e.stopPropagation();
        const viewer = viewerRef.current;
        if (!viewer) return;
        const link = document.createElement('a');
        link.href = viewer.pngURI();
        const base = file ? file.name.replace(/\.[^.]+$/, '') : 'ligplot3d';
        link.download = `${base}_view.png`;
        link.click();
    };

    const errorMessage = file && failed?.file === file ? failed.message : null;
    const btn = 'p-2.5 md:p-2 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors active:bg-indigo-100';
    const panBtn = 'p-1.5 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors';

    return (
        <div className="relative w-full h-full bg-white overflow-hidden group">
            {/* The 3Dmol container is always mounted; overlays sit on top of it. */}
            <div ref={containerRef} className="absolute inset-0 w-full h-full" />

            {!file && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-slate-500 bg-gradient-to-br from-slate-50 to-slate-100 border-dashed border-2 border-slate-200 rounded-lg select-none px-4 py-8">
                    <p className="text-sm text-center text-slate-500 mb-2 max-w-xs">
                        Drop a structure file here, upload one, enter a PDB ID, or click Try Demo to get started
                    </p>
                    <p className="text-xs text-slate-500">Supports: .pdb, .ent, .cif, .sdf, .mol2</p>
                    <p className="text-xs text-slate-400 mt-1">Files are processed in your browser and never uploaded.</p>
                </div>
            )}

            {loading && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80 backdrop-blur-sm" role="status" aria-live="polite">
                    <div className="flex flex-col items-center gap-2">
                        <Loader2 className="animate-spin text-indigo-600" size={32} aria-hidden="true" />
                        <span className="text-sm font-medium text-slate-600">Loading structure…</span>
                    </div>
                </div>
            )}

            {errorMessage && (
                <div className="absolute inset-x-3 top-3 z-30 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-sm md:right-20" role="alert">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{errorMessage}</span>
                </div>
            )}

            {file && (
                <div className="absolute top-2 right-2 md:top-4 md:right-4 flex flex-col gap-1 md:gap-2 bg-white/95 p-1.5 md:p-2 rounded-lg shadow-md border border-slate-200 backdrop-blur-sm z-10">
                    <button type="button" onClick={() => handleZoom(true)} className={btn} title="Zoom in" aria-label="Zoom in"><ZoomIn size={18} /></button>
                    <button type="button" onClick={() => handleZoom(false)} className={btn} title="Zoom out" aria-label="Zoom out"><ZoomOut size={18} /></button>

                    <hr className="border-slate-200 my-0.5 md:my-1" />

                    {/* Pan controls - hidden on mobile to save space */}
                    <div className="hidden md:grid grid-cols-3 gap-0.5">
                        <div className="col-start-2">
                            <button type="button" onClick={() => handleTranslate(0, 20)} className={panBtn} title="Pan up" aria-label="Pan up">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 3l4 4H4z" /></svg>
                            </button>
                        </div>
                        <button type="button" onClick={() => handleTranslate(-20, 0)} className={`${panBtn} col-start-1 row-start-2`} title="Pan left" aria-label="Pan left">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 8l4-4v8z" /></svg>
                        </button>
                        <button type="button" onClick={() => handleTranslate(20, 0)} className={`${panBtn} col-start-3 row-start-2`} title="Pan right" aria-label="Pan right">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13 8l-4 4V4z" /></svg>
                        </button>
                        <div className="col-start-2 row-start-3">
                            <button type="button" onClick={() => handleTranslate(0, -20)} className={panBtn} title="Pan down" aria-label="Pan down">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 13l-4-4h8z" /></svg>
                            </button>
                        </div>
                    </div>

                    <hr className="border-slate-200 my-0.5 md:my-1 hidden md:block" />
                    <button type="button" onClick={handleSnapshot} className={btn} title="Save image (PNG)" aria-label="Save image as PNG"><Camera size={18} /></button>
                </div>
            )}
        </div>
    );
};

export default Viewer3Dmol;
