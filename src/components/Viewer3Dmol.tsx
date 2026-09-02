
import React, { useEffect, useRef, useState } from 'react';
import * as $3Dmol from '3dmol';
import * as NGL from 'ngl'; // Keep NGL for analysis compatibility
import { InteractionType } from '../types';
import type { Interaction, ResidueOption } from '../types';
import { ZoomIn, ZoomOut, Camera, Loader2 } from 'lucide-react';
import type { VisualSettings } from '../App';

interface Props {
    file: File | null;
    onStructureLoaded: (structure: NGL.Structure) => void;
    selectedLigand: ResidueOption | null;
    interactions: Interaction[];
    showInteractions: boolean;
    visualSettings: VisualSettings;
    triggerRecenter: number;
}

const Viewer3Dmol: React.FC<Props> = ({
    file,
    onStructureLoaded,
    selectedLigand,
    interactions,
    showInteractions,
    visualSettings,
    triggerRecenter
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<any>(null);
    const [loading, setLoading] = useState(false);

    // Initialize 3Dmol Viewer
    useEffect(() => {
        if (!containerRef.current) return;

        const config = { backgroundColor: 'white' };
        const viewer = $3Dmol.createViewer(containerRef.current, config);
        viewerRef.current = viewer;

        return () => {
            // 3Dmol doesn't have a strict dispose, but we can clear
            if (viewerRef.current) {
                viewerRef.current.clear();
            }
        };
    }, []);

    // Load File
    useEffect(() => {
        if (!file || !viewerRef.current) return;

        setLoading(true);
        const reader = new FileReader();

        reader.onload = (e) => {
            const content = e.target?.result as string;
            const ext = file.name.split('.').pop() || 'pdb';

            // 1. Render in 3Dmol
            const viewer = viewerRef.current;
            viewer.clear();
            viewer.addModel(content, ext);
            viewer.setStyle({}, { cartoon: { color: '#888888', opacity: 1.0 } }); // Default style
            viewer.zoomTo();
            viewer.render();

            // 2. Parse with NGL for Analysis (Background)
            // We use NGL to parse the blob so we can pass the structure back to App.tsx
            const blob = new Blob([content], { type: 'text/plain' });
            const stage = new NGL.Stage(document.createElement('div')); // Headless stage
            stage.loadFile(blob, { ext }).then((component) => {
                if (component) {
                    const structComp = component as NGL.StructureComponent;
                    onStructureLoaded(structComp.structure);
                    stage.dispose(); // Cleanup headless stage
                }
                setLoading(false);
            }).catch(err => {
                console.error("NGL Parse Error:", err);
                setLoading(false);
            });
        };

        reader.readAsText(file);
    }, [file, onStructureLoaded]);

    // Handle Recenter
    useEffect(() => {
        if (triggerRecenter > 0 && viewerRef.current) {
            if (selectedLigand) {
                // Zoom to ligand - support polymer chains
                const resNos = selectedLigand.resNos ?? [selectedLigand.resNo];
                const sel = { resi: resNos, chain: selectedLigand.chain };
                viewerRef.current.zoomTo(sel, 500);
            } else {
                viewerRef.current.zoomTo({}, 500);
            }
        }
    }, [triggerRecenter, selectedLigand]);

    // Render Scene Updates (Styles & Interactions)
    useEffect(() => {
        const viewer = viewerRef.current;
        if (!viewer) return;

        viewer.removeAllShapes(); // Clear interactions
        // Reset styles
        viewer.setStyle({}, {});

        // Ligand Selection - support polymer chains with multiple residue numbers
        let ligSel: any = {};
        if (selectedLigand) {
            const resNos = selectedLigand.resNos ?? [selectedLigand.resNo];
            ligSel = { resi: resNos, chain: selectedLigand.chain };
        }

        // 1. Protein Style (context)
        // Opacity is user-controlled (Protein Opacity slider) so the receptor can be
        // faded back to keep the ligand readable, or made solid for context.
        if (visualSettings.proteinStyle !== 'hidden' && visualSettings.proteinOpacity > 0) {
            let styleObj: any = {};
            const color = '#cccccc';
            const opacity = visualSettings.proteinOpacity;

            switch (visualSettings.proteinStyle) {
                case 'cartoon':
                    styleObj = { cartoon: { color: color, opacity: opacity } };
                    break;
                case 'rope': // Tube in 3Dmol
                    styleObj = { cartoon: { color: color, style: 'trace', radius: 0.3, opacity: opacity } }; // approximate
                    break;
                case 'trace':
                    styleObj = { stick: { radius: 0.2, color: color, opacity: opacity } }; // approximate backbone
                    break;
                case 'line':
                    styleObj = { line: { color: color, opacity: opacity } };
                    break;
                default:
                    styleObj = { cartoon: { color: color, opacity: opacity } };
            }

            // Apply to everything NOT ligand
            // 3Dmol doesn't have "not" easily in one object, but we can style all then overwrite ligand
            viewer.setStyle({}, styleObj);
        }

        // 2. Pocket Residues & Labels
        if (selectedLigand && interactions && interactions.length > 0) {
            try {
                const pocketResidues = interactions
                    .filter(i => i && i.proteinAtom)
                    .map(i => ({ resi: i.proteinAtom.resNo, chain: i.proteinAtom.chain }));

                if (pocketResidues.length > 0) {
                    // Deduplicate
                    const uniquePocket = Array.from(new Set(pocketResidues.map(r => JSON.stringify(r)))).map(s => JSON.parse(s));

                    const pocketSel = { or: uniquePocket };

                    let pocketStyle: any = {};
                    switch (visualSettings.pocketStyle) {
                        case 'licorice': pocketStyle = { stick: { radius: 0.2 } }; break;
                        case 'stick': pocketStyle = { stick: { radius: 0.2 } }; break;
                        case 'ball+stick': pocketStyle = { stick: { radius: 0.2 }, sphere: { scale: 0.25 } }; break;
                        default: pocketStyle = { stick: { radius: 0.2 } }; break;
                    }

                    viewer.addStyle(pocketSel, pocketStyle);

                    // Add Labels to pocket residues
                    viewer.removeAllLabels();
                    uniquePocket.forEach((res: any) => {
                        // Find the residue name from interactions
                        const interaction = interactions.find(i => i.proteinAtom && i.proteinAtom.resNo === res.resi && i.proteinAtom.chain === res.chain);
                        const resName = interaction ? interaction.proteinAtom.resName : '';
                        const labelText = resName ? `${resName} ${res.resi}` : `${res.resi}`;

                        viewer.addLabel(labelText, {
                            fontSize: 11,
                            fontColor: '#374151',
                            backgroundColor: 'white',
                            backgroundOpacity: 0.85,
                            inFront: true,
                            alignment: 'center'
                        }, { resi: res.resi, chain: res.chain, atom: 'CA' });
                    });
                }
            } catch (e) {
                console.error("Error rendering pocket:", e);
            }
        }

        // 3. Ligand Style (with HIGHLY vibrant coloring for clear distinction from protein)
        if (selectedLigand) {
            let ligStyle: any = {};
            switch (visualSettings.ligandStyle) {
                case 'ball+stick':
                    ligStyle = {
                        stick: {
                            radius: 0.25, // Balanced stick radius for clear bonds
                            colorscheme: {
                                prop: 'elem',
                                map: {
                                    'C': visualSettings.ligandColor, // User-selected carbon color
                                    'N': '#3b82f6', // Blue
                                    'O': '#ef4444', // Red
                                    'S': '#fbbf24', // Bright Yellow
                                    'P': '#f97316', // Orange
                                    'default': '#9ca3af' // Gray
                                }
                            }
                        },
                        sphere: {
                            scale: 0.25, // REDUCED from 0.4 - smaller spheres to see bonds clearly
                            colorscheme: {
                                prop: 'elem',
                                map: {
                                    'C': visualSettings.ligandColor, // User-selected carbon color
                                    'N': '#3b82f6',
                                    'O': '#ef4444',
                                    'S': '#fbbf24',
                                    'P': '#f97316',
                                    'default': '#9ca3af'
                                }
                            }
                        }
                    };
                    break;
                case 'spacefill':
                    ligStyle = {
                        sphere: {
                            colorscheme: {
                                prop: 'elem',
                                map: {
                                    'C': visualSettings.ligandColor, // User-selected carbon color
                                    'N': '#3b82f6',
                                    'O': '#ef4444',
                                    'S': '#fbbf24',
                                    'P': '#f97316',
                                    'default': '#9ca3af'
                                }
                            }
                        }
                    };
                    break;
                case 'licorice':
                    ligStyle = {
                        stick: {
                            radius: 0.3, // Good thickness for clear bond visibility
                            colorscheme: {
                                prop: 'elem',
                                map: {
                                    'C': visualSettings.ligandColor, // User-selected carbon color
                                    'N': '#3b82f6',
                                    'O': '#ef4444',
                                    'S': '#fbbf24',
                                    'P': '#f97316',
                                    'default': '#9ca3af'
                                }
                            }
                        }
                    };
                    break;
            }
            viewer.setStyle(ligSel, ligStyle);

            // Zoom to ligand if it's the first render or changed? 
            // Maybe not every time, but let's ensure it's visible
            // viewer.zoomTo(ligSel, 500); 
        }

        // 3. Interactions
        if (showInteractions && interactions.length > 0) {
            interactions.forEach(i => {
                const start = { x: i.proteinAtom.x, y: i.proteinAtom.y, z: i.proteinAtom.z };
                const end = { x: i.ligandAtom.x, y: i.ligandAtom.y, z: i.ligandAtom.z };

                let color = 'gray';
                let dashed = false;

                switch (i.type) {
                    case InteractionType.HydrogenBond: color = '#3b82f6'; dashed = true; break; // Blue
                    case InteractionType.SaltBridge: color = '#eab308'; dashed = true; break; // Yellow
                    case InteractionType.PiStacking: color = '#22c55e'; dashed = false; break; // Green
                    case InteractionType.Hydrophobic: color = '#a3a3a3'; dashed = true; break; // Gray
                    case InteractionType.HalogenBond: color = '#a855f7'; dashed = true; break; // Purple
                }

                viewer.addCylinder({
                    start: start,
                    end: end,
                    radius: visualSettings.interactionWidth / 20.0, // Scale down
                    color: color,
                    dashed: dashed,
                    fromCap: 1, toCap: 1
                });

                // Label distance?
                // viewer.addLabel(i.distance.toFixed(2), {position: midPoint, ...})
            });
        }

        viewer.render();

        // Auto-zoom to interaction site for clear focus
        // This ensures atoms are clearly visible instead of blurred
        if (selectedLigand && interactions.length > 0) {
            // Zoom to ligand with slight buffer to show surrounding pocket context
            setTimeout(() => {
                viewer.zoomTo(ligSel, 500, 1.5); // 1.5x buffer to show context
            }, 100); // Small delay to ensure rendering completes
        }

    }, [selectedLigand, interactions, showInteractions, visualSettings]);

    const handleZoom = (delta: number) => {
        if (viewerRef.current) {
            // 3Dmol zoom is factor based
            const factor = delta > 0 ? 0.8 : 1.2;
            viewerRef.current.zoom(factor);
        }
    };

    const handleTranslate = (x: number, y: number) => {
        if (viewerRef.current) {
            viewerRef.current.translate(x, y);
        }
    };

    const handleSnapshot = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (viewerRef.current) {
            const dataURL = viewerRef.current.pngURI();
            const link = document.createElement('a');
            link.href = dataURL;
            link.download = `ligand_view.png`;
            link.click();
        }
    };

    if (!file) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 bg-gradient-to-br from-slate-50 to-slate-100 border-dashed border-2 border-slate-200 rounded-lg select-none px-4 py-8">

                <p className="text-xs md:text-sm text-center text-slate-400 mb-2 max-w-xs">
                    Upload a structure file or click Try Demo to get started
                </p>
                <p className="text-[10px] md:text-xs text-slate-400">
                    Supports: .pdb, .cif, .sdf, .mol2
                </p>
            </div>
        );
    }

    return (
        <div className="relative w-full h-full bg-white overflow-hidden group shadow-inner rounded-lg">
            {loading && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-2">
                        <Loader2 className="animate-spin text-indigo-600" size={32} />
                        <span className="text-sm font-medium text-slate-600">Loading Structure...</span>
                    </div>
                </div>
            )}

            <div ref={containerRef} className="absolute inset-0 w-full h-full" />

            {/* Controls - Touch-friendly on mobile */}
            <div className="absolute top-2 right-2 md:top-4 md:right-4 flex flex-col gap-1 md:gap-2 bg-white/95 p-1.5 md:p-2 rounded-lg shadow-md border border-slate-200 backdrop-blur-sm z-10">
                <button onClick={() => handleZoom(-5)} className="p-2.5 md:p-2 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors active:bg-indigo-100" title="Zoom In"><ZoomIn size={18} /></button>
                <button onClick={() => handleZoom(5)} className="p-2.5 md:p-2 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors active:bg-indigo-100" title="Zoom Out"><ZoomOut size={18} /></button>

                <hr className="border-slate-200 my-0.5 md:my-1" />

                {/* Translation Controls - Hidden on mobile to save space */}
                <div className="hidden md:grid grid-cols-3 gap-0.5">
                    <div className="col-start-2">
                        <button onClick={() => handleTranslate(0, 20)} className="p-1.5 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="Pan Up">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3l4 4H4z" /></svg>
                        </button>
                    </div>
                    <button onClick={() => handleTranslate(-20, 0)} className="p-1.5 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors col-start-1 row-start-2" title="Pan Left">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 8l4-4v8z" /></svg>
                    </button>
                    <button onClick={() => handleTranslate(20, 0)} className="p-1.5 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors col-start-3 row-start-2" title="Pan Right">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13 8l-4 4V4z" /></svg>
                    </button>
                    <div className="col-start-2 row-start-3">
                        <button onClick={() => handleTranslate(0, -20)} className="p-1.5 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="Pan Down">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 13l-4-4h8z" /></svg>
                        </button>
                    </div>
                </div>

                <hr className="border-slate-200 my-0.5 md:my-1 hidden md:block" />
                <button onClick={handleSnapshot} className="p-2.5 md:p-2 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors active:bg-indigo-100" title="Snapshot"><Camera size={18} /></button>
            </div>
        </div>
    );
};

export default Viewer3Dmol;
