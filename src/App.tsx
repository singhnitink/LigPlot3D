
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import * as NGL from 'ngl';
import { Upload, Search, Table as TableIcon, RefreshCw, Move, Filter, HelpCircle, Menu, X, ChevronDown, ChevronUp } from 'lucide-react';
import Viewer from './components/Viewer3Dmol';
import InteractionTable from './components/InteractionTable';
import HelpPage from './components/HelpPage';
import { getLigandCandidates, analyzeInteractions, findResidueByName } from './services/interactionService';
import { InteractionType } from './types';
import type { ResidueOption, AnalysisResult } from './types';



export interface VisualSettings {
  proteinStyle: 'cartoon' | 'rope' | 'trace' | 'line' | 'hidden';
  ligandStyle: 'ball+stick' | 'licorice' | 'spacefill';
  pocketStyle: 'licorice' | 'ball+stick' | 'stick';
  interactionWidth: number;
  ligandColor: string;
  proteinOpacity: number;
}

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [structure, setStructure] = useState<NGL.Structure | null>(null);
  const [ligandCandidates, setLigandCandidates] = useState<ResidueOption[]>([]);
  const [selectedLigand, setSelectedLigand] = useState<ResidueOption | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [showInteractions] = useState(true);
  const [manualSearchQuery, setManualSearchQuery] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const [interactionFilters, setInteractionFilters] = useState<Record<InteractionType, boolean>>({
    [InteractionType.HydrogenBond]: true,
    [InteractionType.SaltBridge]: true,
    [InteractionType.Hydrophobic]: false,
    [InteractionType.PiStacking]: false,
    [InteractionType.HalogenBond]: false,
    [InteractionType.MetalCoordination]: false,
    [InteractionType.Unknown]: false
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [visualSettings, setVisualSettings] = useState<VisualSettings>({
    proteinStyle: 'cartoon',
    ligandStyle: 'ball+stick',
    pocketStyle: 'stick',
    interactionWidth: 2.0,
    ligandColor: '#22c55e',
    proteinOpacity: 0.15
  });

  const [recenterTrigger, setRecenterTrigger] = useState(0);

  // Mobile-specific states
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);

  // Supported molecular structure file extensions
  const SUPPORTED_EXTENSIONS = ['.pdb', '.ent', '.cif', '.sdf', '.mol2'];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const uploadedFile = e.target.files[0];
      const fileName = uploadedFile.name.toLowerCase();
      const isValidExtension = SUPPORTED_EXTENSIONS.some(ext => fileName.endsWith(ext));

      if (!isValidExtension) {
        alert(`Unsupported file format. Please upload a molecular structure file.\n\nSupported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

      setFile(uploadedFile);
      setStructure(null);
      setLigandCandidates([]);
      setSelectedLigand(null);
      setAnalysisResult(null);
    }
  };

  const handleReset = () => {
    setFile(null);
    setStructure(null);
    setLigandCandidates([]);
    setSelectedLigand(null);
    setAnalysisResult(null);
    setManualSearchQuery('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Load demo structure for visitors without their own files
  const loadDemoFile = async () => {
    try {
      const response = await fetch('/LigPlot3D/demo.cif');
      if (!response.ok) throw new Error('Failed to fetch demo file');
      const text = await response.text();
      const blob = new Blob([text], { type: 'text/plain' });
      const demoFile = new File([blob], 'demo.cif', { type: 'text/plain' });
      setFile(demoFile);
      setStructure(null);
      setLigandCandidates([]);
      setSelectedLigand(null);
      setAnalysisResult(null);
    } catch (error) {
      console.error('Error loading demo:', error);
      alert('Failed to load demo file. Please try uploading your own structure.');
    }
  };



  const handleStructureLoaded = useCallback((struct: NGL.Structure) => {
    setStructure(struct);
    const candidates = getLigandCandidates(struct);
    setLigandCandidates(candidates);
    if (candidates.length > 0) {
      setSelectedLigand(candidates[0]);
    }
  }, []);

  const handleManualSearch = () => {
    if (!structure || !manualSearchQuery) return;
    const found = findResidueByName(structure, manualSearchQuery);
    if (found) {
      setLigandCandidates(prev => {
        const exists = prev.some(l => l.chain === found.chain && l.resNo === found.resNo);
        return exists ? prev : [found, ...prev];
      });
      setSelectedLigand(found);
    } else {
      alert(`Residue '${manualSearchQuery}' not found.`);
    }
  };

  useEffect(() => {
    if (structure && selectedLigand) {
      const result = analyzeInteractions(structure, selectedLigand);
      setAnalysisResult(result);
    }
  }, [structure, selectedLigand]);


  const filteredInteractions = useMemo(() => {
    if (!analysisResult) return [];
    return analysisResult.interactions.filter(i => interactionFilters[i.type]);
  }, [analysisResult, interactionFilters]);

  const toggleFilter = (type: InteractionType) => {
    setInteractionFilters(prev => ({ ...prev, [type]: !prev[type] }));
  };

  return (
    <div className="h-screen bg-slate-100 flex flex-col font-sans text-slate-900 overflow-hidden selection:bg-indigo-100" style={{ maxWidth: '100%', width: '100%' }}>
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 shrink-0 h-14 flex items-center justify-between px-3 md:px-6 z-40 shadow-sm">
        <div className="flex items-center gap-2">
          {/* Mobile menu toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 -ml-1 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-md"
            aria-label="Toggle menu"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <h1 className="text-lg font-bold text-slate-800">LigPlot3D</h1>
        </div>

        <div className="flex items-center gap-1 md:gap-3">
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-md text-xs md:text-sm font-medium transition-colors"
          >
            <HelpCircle size={14} /> <span className="hidden sm:inline">Help</span>
          </button>
          {file && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-md text-xs md:text-sm font-medium transition-colors"
            >
              <RefreshCw size={14} /> <span className="hidden sm:inline">New Analysis</span><span className="sm:hidden">Reset</span>
            </button>
          )}
          {!file && (
            <button
              onClick={loadDemoFile}
              className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 bg-slate-500 hover:bg-slate-600 text-white rounded-md text-xs md:text-sm font-medium transition-colors shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span className="hidden sm:inline">Try Demo</span><span className="sm:hidden">Demo</span>
            </button>
          )}
          <label className="cursor-pointer inline-flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded-md text-xs md:text-sm font-medium transition-all shadow-sm">
            <Upload size={14} />
            <span className="hidden sm:inline">Upload Structure</span><span className="sm:hidden">Upload</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdb,.ent,.cif,.sdf,.mol2"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>
      </header>

      {showHelp ? (
        <HelpPage onBack={() => setShowHelp(false)} />
      ) : (

        <main className="flex-1 w-full flex flex-col lg:flex-row overflow-hidden relative">

          {/* Mobile sidebar backdrop */}
          {sidebarOpen && (
            <div
              className="lg:hidden fixed inset-0 bg-black/40 z-20 transition-opacity"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* SIDEBAR - Sliding drawer on mobile, fixed sidebar on desktop */}
          <aside className={`
            fixed lg:relative inset-y-0 left-0 z-30
            w-[85%] max-w-[320px] lg:w-80 
            bg-white border-r border-slate-200 
            flex flex-col shrink-0 
            transform transition-transform duration-300 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            lg:top-0 top-14
            overflow-y-auto
          `}>
            <div className="p-4 flex flex-col gap-4 lg:gap-6">

              {/* Ligand Selection */}
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                <h2 className="text-xs font-bold uppercase text-slate-500 mb-3 flex items-center gap-2">
                  Target Selection
                </h2>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Ligand</label>
                  <select
                    className="w-full border-slate-300 rounded text-sm p-2 border bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={selectedLigand ? `${selectedLigand.chain}:${selectedLigand.resNo}` : ''}
                    onChange={(e) => {
                      const [chain, resNo] = e.target.value.split(':');
                      const lig = ligandCandidates.find(l => l.chain === chain && l.resNo === parseInt(resNo));
                      if (lig) setSelectedLigand(lig);
                    }}
                    disabled={ligandCandidates.length === 0}
                  >
                    {ligandCandidates.map(lig => {
                      const isPolymer = lig.resNos && lig.resNos.length > 1;
                      const displayText = isPolymer
                        ? `${lig.resName} ${lig.resNos![0]}-${lig.resNos![lig.resNos!.length - 1]} (${lig.chain}) [${lig.resNos!.length} units]`
                        : `${lig.resName} ${lig.resNo} (Chain ${lig.chain})`;
                      return (
                        <option key={`${lig.chain}:${lig.resNo}`} value={`${lig.chain}:${lig.resNo}`}>
                          {displayText}
                        </option>
                      );
                    })}
                    {ligandCandidates.length === 0 && <option>No ligands found</option>}
                  </select>
                </div>

                <div className="pt-3 border-t border-slate-200">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 border border-slate-300 rounded text-sm px-2 py-1"
                      placeholder="Search residue (e.g. LIG)"
                      value={manualSearchQuery}
                      onChange={e => setManualSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                    />
                    <button onClick={handleManualSearch} className="px-3 py-1 bg-white border border-slate-300 hover:bg-slate-100 rounded text-sm shadow-sm">
                      <Search size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Visualization Controls */}
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                <h2 className="text-xs font-bold uppercase text-slate-500 mb-3">Visualization</h2>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">Protein</label>
                      <select className="w-full text-xs border p-1 rounded" value={visualSettings.proteinStyle} onChange={e => setVisualSettings({ ...visualSettings, proteinStyle: e.target.value as any })}>
                        <option value="cartoon">Cartoon</option>
                        <option value="rope">Rope</option>
                        <option value="line">Lines</option>
                        <option value="hidden">Hidden</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">Ligand</label>
                      <select className="w-full text-xs border p-1 rounded" value={visualSettings.ligandStyle} onChange={e => setVisualSettings({ ...visualSettings, ligandStyle: e.target.value as any })}>
                        <option value="ball+stick">Ball & Stick</option>
                        <option value="licorice">Licorice</option>
                        <option value="spacefill">Spacefill</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">Ligand Color</label>
                      <input
                        type="color"
                        value={visualSettings.ligandColor}
                        onChange={e => setVisualSettings({ ...visualSettings, ligandColor: e.target.value })}
                        className="w-full h-8 border rounded cursor-pointer"
                        title="Change ligand carbon color"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">Pocket Residues</label>
                      <select className="w-full text-xs border p-1 rounded" value={visualSettings.pocketStyle} onChange={e => setVisualSettings({ ...visualSettings, pocketStyle: e.target.value as any })}>
                        <option value="stick">Stick</option>
                        <option value="licorice">Licorice</option>
                        <option value="ball+stick">Ball & Stick</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-bold text-slate-500">
                        Protein Opacity
                      </label>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setVisualSettings({ ...visualSettings, proteinOpacity: 0.15 })}
                          disabled={visualSettings.proteinStyle === 'hidden'}
                          className="text-[9px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Make the protein nearly transparent"
                        >
                          Faint
                        </button>
                        <button
                          onClick={() => setVisualSettings({ ...visualSettings, proteinOpacity: 1 })}
                          disabled={visualSettings.proteinStyle === 'hidden'}
                          className="text-[9px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Make the protein fully opaque"
                        >
                          Solid
                        </button>
                        <span className="text-[10px] font-mono text-slate-400 w-8 text-right tabular-nums">
                          {Math.round(visualSettings.proteinOpacity * 100)}%
                        </span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={Math.round(visualSettings.proteinOpacity * 100)}
                      onChange={e => setVisualSettings({ ...visualSettings, proteinOpacity: parseInt(e.target.value) / 100 })}
                      disabled={visualSettings.proteinStyle === 'hidden'}
                      className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Adjust how transparent the protein appears"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Interaction Line Width</label>
                    <input type="range" min="1" max="8" step="1" value={visualSettings.interactionWidth} onChange={e => setVisualSettings({ ...visualSettings, interactionWidth: parseInt(e.target.value) })} className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                <h2 className="text-xs font-bold uppercase text-slate-500 mb-3 flex items-center gap-2">
                  <Filter size={14} /> Interaction Filters
                </h2>
                <div className="space-y-2">
                  {[
                    { type: InteractionType.HydrogenBond, color: 'bg-blue-500', label: 'H-Bonds' },
                    { type: InteractionType.SaltBridge, color: 'bg-yellow-500', label: 'Salt Bridges' },
                    { type: InteractionType.PiStacking, color: 'bg-green-600', label: 'Pi-Stacking' },
                    { type: InteractionType.Hydrophobic, color: 'bg-slate-400', label: 'Hydrophobic' },
                    { type: InteractionType.HalogenBond, color: 'bg-purple-600', label: 'Halogen Bonds' },
                  ].map(f => (
                    <label key={f.type} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-100 p-1 rounded -mx-1 transition-colors">
                      <input type="checkbox" checked={interactionFilters[f.type]} onChange={() => toggleFilter(f.type)} className="rounded text-indigo-600 focus:ring-0" />
                      <div className={`w-2 h-2 rounded-full ${f.color}`}></div>
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setRecenterTrigger(prev => prev + 1)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded text-sm font-medium hover:bg-slate-100 text-slate-700"
              >
                <Move size={14} /> Recenter View
              </button>

            </div>
          </aside>

          {/* RIGHT PANEL: Content */}
          <div className="flex-1 w-full flex flex-col overflow-hidden relative">

            {/* Top: 3D Viewer - Takes more space on mobile when table collapsed */}
            <div className={`w-full relative border-b border-slate-200 bg-white min-h-0 transition-all duration-300 ${tableExpanded ? 'flex-1' : 'flex-[2] lg:flex-[2]'}`}>
              <Viewer
                key={file ? file.name : 'empty'}
                file={file}
                onStructureLoaded={handleStructureLoaded}
                selectedLigand={selectedLigand}
                interactions={filteredInteractions}
                showInteractions={showInteractions}
                visualSettings={visualSettings}
                triggerRecenter={recenterTrigger}
              />
            </div>

            {/* Bottom: Table - Collapsible on mobile */}
            <div className={`w-full overflow-hidden flex flex-col bg-white min-h-0 transition-all duration-300 ${tableExpanded ? 'flex-[2]' : 'lg:flex-[1]'}`}>
              {/* Table Header - Clickable on mobile to expand/collapse */}
              <button
                onClick={() => setTableExpanded(!tableExpanded)}
                className="lg:pointer-events-none bg-slate-50 px-4 py-3 lg:py-2 border-b border-slate-200 flex items-center justify-between text-sm font-bold text-slate-700 shrink-0 w-full hover:bg-slate-100 lg:hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <TableIcon size={16} />
                  <span>Interaction Data</span>
                  {filteredInteractions.length > 0 && (
                    <span className="text-xs font-normal text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded-full">{filteredInteractions.length}</span>
                  )}
                </div>
                <div className="lg:hidden text-slate-400">
                  {tableExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>
              </button>
              {/* Table Content - Hidden on mobile when collapsed */}
              <div className={`flex-1 overflow-auto transition-all duration-300 ${!tableExpanded ? 'hidden lg:block' : 'block'}`}>
                <InteractionTable interactions={filteredInteractions} />
              </div>
            </div>

          </div>
        </main>
      )}
    </div>
  );
};

export default App;
