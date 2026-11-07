
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Upload, Search, Table as TableIcon, RefreshCw, Move, Filter, HelpCircle, Menu, X, ChevronDown, ChevronUp, Info } from 'lucide-react';
import Viewer from './components/Viewer3Dmol';
import InteractionTable from './components/InteractionTable';
import type { TableState } from './components/InteractionTable';
import HelpPage from './components/HelpPage';
import { getLigandCandidates, analyzeInteractions, findResidueByName, ligandKey } from './services/interactionService';
import type { PreparedStructure } from './services/interactionService';
import { SUPPORTED_EXTENSIONS, isSupportedStructureFile } from './services/fileFormat';
import { InteractionType } from './types';
import type { ResidueOption } from './types';
import { DEFAULT_LIGAND_COLOR, INTERACTION_ORDER, INTERACTION_STYLES } from './interactionStyles';

export interface VisualSettings {
  proteinStyle: 'cartoon' | 'rope' | 'line' | 'hidden';
  ligandStyle: 'ball+stick' | 'licorice' | 'spacefill';
  pocketStyle: 'stick' | 'licorice' | 'ball+stick';
  interactionWidth: number;
  ligandColor: string;
  /** Opacity of the context protein, 0 (invisible) to 1 (solid). */
  proteinOpacity: number;
}

// Everything is shown by default except hydrophobic contacts, which are numerous.
// (π-stacking used to be off, hiding the cation-π cage the demo was chosen for.)
const DEFAULT_FILTERS: Record<InteractionType, boolean> = {
  [InteractionType.HydrogenBond]: true,
  [InteractionType.SaltBridge]: true,
  [InteractionType.PiStacking]: true,
  [InteractionType.MetalCoordination]: true,
  [InteractionType.HalogenBond]: true,
  [InteractionType.Hydrophobic]: false,
};

const ALL_ON = Object.fromEntries(INTERACTION_ORDER.map(t => [t, true])) as Record<InteractionType, boolean>;

const isHelpHash = () => window.location.hash === '#help';

const ligandOptionText = (lig: ResidueOption) => {
  const chain = lig.chain || '–';
  return lig.resNos && lig.resNos.length > 1
    ? `${lig.resName} ${lig.resNos[0]}-${lig.resNos[lig.resNos.length - 1]} (Chain ${chain}) [${lig.resNos.length} units]`
    : `${lig.resName} ${lig.resNo} (Chain ${chain})`;
};

interface PdbIdFormProps {
  id: string;
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  className?: string;
  showLabel?: boolean;
  placeholder?: string;
}

/** "Load from the PDB" field — in the header on wide screens, in the sidebar on phones. */
const PdbIdForm: React.FC<PdbIdFormProps> = ({ id, value, busy, onChange, onSubmit, className = '', showLabel = false, placeholder = 'PDB ID, e.g. 3HS4' }) => (
  <form className={className} onSubmit={e => { e.preventDefault(); onSubmit(); }}>
    <label htmlFor={id} className={showLabel ? 'block text-xs font-medium text-slate-600 mb-1' : 'sr-only'}>Load from the PDB</label>
    <div className="flex gap-2">
      <input
        id={id}
        type="text"
        autoCapitalize="characters"
        maxLength={4}
        className="flex-1 min-w-0 w-28 border border-slate-300 rounded text-sm px-2 py-1 uppercase placeholder:normal-case"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button
        type="submit"
        disabled={busy || value.trim().length === 0}
        className="px-3 py-1 bg-white border border-slate-300 hover:bg-slate-100 rounded text-sm font-medium shadow-sm disabled:opacity-50 whitespace-nowrap"
      >
        {busy ? 'Loading…' : 'Fetch'}
      </button>
    </div>
  </form>
);

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedStructure | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ligandCandidates, setLigandCandidates] = useState<ResidueOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [manualSearchQuery, setManualSearchQuery] = useState('');
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pdbIdInput, setPdbIdInput] = useState('');
  const [fetchingPdb, setFetchingPdb] = useState(false);
  const [interactionFilters, setInteractionFilters] = useState(DEFAULT_FILTERS);
  const [visualSettings, setVisualSettings] = useState<VisualSettings>({
    proteinStyle: 'cartoon',
    ligandStyle: 'ball+stick',
    pocketStyle: 'stick',
    interactionWidth: 2.0,
    ligandColor: DEFAULT_LIGAND_COLOR,
    proteinOpacity: 0.35,
  });
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  // Help is an overlay addressed by #help, so the browser Back button closes it and the
  // viewer underneath stays mounted (it used to be unmounted, losing ligand and camera).
  const [showHelp, setShowHelp] = useState(isHelpHash);
  const helpOpenedInApp = useRef(false);

  // Mobile-specific states
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onHash = () => setShowHelp(isHelpHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const openHelp = () => {
    helpOpenedInApp.current = true;
    window.location.hash = 'help';
  };
  const closeHelp = useCallback(() => {
    if (helpOpenedInApp.current) {
      helpOpenedInApp.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      setShowHelp(false);
    }
  }, []);

  useEffect(() => {
    if (!showHelp) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeHelp(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showHelp, closeHelp]);

  const startNewStructure = (next: File | null) => {
    setFile(next);
    setPrepared(null);
    setLoadError(null);
    setLigandCandidates([]);
    setSelectedKey(null);
    setSearchMessage(null);
    setNotice(null);
  };

  const acceptFile = (candidate: File) => {
    if (!isSupportedStructureFile(candidate.name)) {
      setNotice(`“${candidate.name}” is not a supported structure file. Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`);
      return;
    }
    startNewStructure(candidate);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again later
    if (uploadedFile) acceptFile(uploadedFile);
  };

  // Drag-and-drop a structure file anywhere in the window. A depth counter avoids
  // flicker as the pointer crosses child elements.
  const [dragDepth, setDragDepth] = useState(0);
  const draggingFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => { if (!draggingFiles(e) || showHelp) return; e.preventDefault(); setDragDepth(d => d + 1); },
    onDragOver: (e: React.DragEvent) => { if (draggingFiles(e) && !showHelp) e.preventDefault(); },
    onDragLeave: (e: React.DragEvent) => { if (draggingFiles(e)) setDragDepth(d => Math.max(0, d - 1)); },
    onDrop: (e: React.DragEvent) => {
      if (!draggingFiles(e) || showHelp) return;
      e.preventDefault();
      setDragDepth(0);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) acceptFile(dropped);
    },
  };

  const handleReset = () => startNewStructure(null);

  // Load demo structure for visitors without their own files
  const loadDemoFile = async () => {
    try {
      // PDB 1R9Q: ProX periplasmic binding protein from E. coli in complex with
      // proline betaine. Chosen because its quaternary ammonium is bound by an
      // aromatic cage of tryptophans, so the demo exercises cation-π,
      // salt-bridge and hydrogen-bond detection together.
      const response = await fetch(`${import.meta.env.BASE_URL}1R9Q.pdb`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      startNewStructure(new File([text], '1R9Q.pdb', { type: 'text/plain' }));
    } catch (error) {
      console.error('Error loading demo:', error);
      setNotice('The demo structure could not be loaded. Please try uploading your own structure.');
    }
  };

  // Load an entry straight from the RCSB PDB by its 4-character ID (mmCIF is
  // available for every entry, unlike legacy PDB format).
  const loadPdbId = async () => {
    const id = pdbIdInput.trim().toUpperCase();
    if (!/^[0-9][A-Z0-9]{3}$/.test(id)) {
      setNotice(`“${pdbIdInput.trim()}” is not a PDB ID. PDB IDs have 4 characters, e.g. 1R9Q.`);
      return;
    }
    setFetchingPdb(true);
    try {
      const response = await fetch(`https://files.rcsb.org/download/${id}.cif`);
      if (response.status === 404) throw new Error(`entry ${id} does not exist`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      startNewStructure(new File([text], `${id}.cif`, { type: 'text/plain' }));
      setSidebarOpen(false);
    } catch (error) {
      console.error('Error fetching PDB entry:', error);
      setNotice(`Could not download ${id} from the RCSB PDB (${(error as Error).message ?? error}).`);
    } finally {
      setFetchingPdb(false);
    }
  };

  const handleStructureLoaded = useCallback((p: PreparedStructure) => {
    setPrepared(p);
    const candidates = getLigandCandidates(p.structure);
    setLigandCandidates(candidates);
    setSelectedKey(candidates.length > 0 ? ligandKey(candidates[0]) : null);
  }, []);

  const handleLoadError = useCallback((message: string) => setLoadError(message), []);

  const handleManualSearch = () => {
    const q = manualSearchQuery.trim().toUpperCase();
    if (!prepared || !q) return;
    const existing = ligandCandidates.find(l => l.resName.toUpperCase() === q);
    const found = existing ?? findResidueByName(prepared.structure, q);
    if (found) {
      if (!existing) setLigandCandidates(prev => [found, ...prev]);
      setSelectedKey(ligandKey(found));
      setSearchMessage(null);
    } else {
      setSearchMessage(`No residue named “${manualSearchQuery.trim()}” in this structure.`);
    }
  };

  const selectedLigand = useMemo(
    () => ligandCandidates.find(l => ligandKey(l) === selectedKey) ?? null,
    [ligandCandidates, selectedKey]
  );

  // Analysis depends only on the structure and ligand — never on display settings.
  const analysisResult = useMemo(
    () => (prepared && selectedLigand ? analyzeInteractions(prepared.structure, selectedLigand) : null),
    [prepared, selectedLigand]
  );

  const filteredInteractions = useMemo(
    () => (analysisResult ? analysisResult.interactions.filter(i => interactionFilters[i.type]) : []),
    [analysisResult, interactionFilters]
  );

  const countsByType = useMemo(() => {
    const counts = Object.fromEntries(INTERACTION_ORDER.map(t => [t, 0])) as Record<InteractionType, number>;
    analysisResult?.interactions.forEach(i => { counts[i.type]++; });
    return counts;
  }, [analysisResult]);

  const toggleFilter = (type: InteractionType) => {
    setInteractionFilters(prev => ({ ...prev, [type]: !prev[type] }));
  };

  const tableState: TableState = !file ? 'no-file'
    : loadError ? 'error'
    : !prepared ? 'loading'
    : !selectedLigand ? 'no-ligand'
    : 'ready';

  const ligandLabel = selectedLigand
    ? `${selectedLigand.resName} ${selectedLigand.resNo} (${selectedLigand.chain || '–'})`
    : '';
  const fileBase = file ? file.name.replace(/\.[^.]+$/, '') : '';
  const opacityDisabled = visualSettings.proteinStyle === 'hidden' || visualSettings.proteinStyle === 'line';

  const emptyLigandOption = !file ? 'Upload a structure first'
    : loadError ? 'Structure could not be analysed'
    : !prepared ? 'Loading…'
    : 'No ligands found – search by name below';

  const labelCls = 'block text-[11px] font-bold text-slate-600 mb-1';

  return (
    <div className="h-screen bg-slate-100 flex flex-col font-sans text-slate-900 overflow-hidden selection:bg-indigo-100 w-full" {...dropHandlers}>
      <div className="contents" inert={showHelp}>
        {/* Navbar */}
        <header className="bg-white border-b border-slate-200 shrink-0 h-14 flex items-center justify-between px-3 md:px-6 z-40 shadow-sm">
          <div className="flex items-center gap-2">
            {/* Mobile menu toggle */}
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 -ml-1 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-md"
              aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={sidebarOpen}
              aria-controls="app-sidebar"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <h1 className="text-lg font-bold text-slate-800">LigPlot3D</h1>
          </div>

          <div className="flex items-center gap-1 md:gap-3">
            <PdbIdForm
              id="pdb-id"
              className="hidden md:block"
              placeholder="PDB ID"
              value={pdbIdInput}
              busy={fetchingPdb}
              onChange={setPdbIdInput}
              onSubmit={loadPdbId}
            />
            <button
              type="button"
              onClick={openHelp}
              className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-md text-xs md:text-sm font-medium transition-colors"
              aria-label="Help and documentation"
            >
              <HelpCircle size={14} aria-hidden="true" /> <span className="hidden sm:inline">Help</span>
            </button>
            {file ? (
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-md text-xs md:text-sm font-medium transition-colors"
              >
                <RefreshCw size={14} aria-hidden="true" /> <span className="hidden sm:inline">New Analysis</span><span className="sm:hidden">Reset</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={loadDemoFile}
                className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 bg-slate-500 hover:bg-slate-600 text-white rounded-md text-xs md:text-sm font-medium transition-colors shadow-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <span className="hidden sm:inline">Try Demo</span><span className="sm:hidden">Demo</span>
              </button>
            )}
            <label className="cursor-pointer inline-flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded-md text-xs md:text-sm font-medium transition-all shadow-sm focus-within:ring-2 focus-within:ring-rose-400">
              <Upload size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Upload Structure</span><span className="sm:hidden">Upload</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdb,.ent,.cif,.sdf,.mol2"
                onChange={handleFileUpload}
                className="sr-only"
                aria-label="Upload structure file"
              />
            </label>
          </div>
        </header>

        {(notice || (prepared && prepared.modelCount > 1)) && (
          <div className="shrink-0 border-b border-slate-200 bg-white px-3 md:px-6 py-2 flex flex-col gap-1 text-sm" role="status" aria-live="polite">
            {notice && (
              <div className="flex items-start gap-2 text-red-800">
                <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="flex-1">{notice}</span>
                <button type="button" onClick={() => setNotice(null)} className="p-0.5 text-red-700 hover:text-red-900" aria-label="Dismiss message"><X size={16} /></button>
              </div>
            )}
            {prepared && prepared.modelCount > 1 && (
              <div className="flex items-start gap-2 text-slate-700">
                <Info size={16} className="mt-0.5 shrink-0 text-indigo-600" aria-hidden="true" />
                <span>This file contains {prepared.modelCount} models (e.g. docking poses or NMR models). LigPlot3D displays and analyses <strong>model 1</strong> only.</span>
              </div>
            )}
          </div>
        )}

        <main className="flex-1 w-full flex flex-col lg:flex-row overflow-hidden relative">

          {/* Mobile sidebar backdrop */}
          {sidebarOpen && (
            <div
              className="lg:hidden fixed inset-0 bg-black/40 z-20 transition-opacity"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* SIDEBAR - Sliding drawer on mobile, fixed sidebar on desktop */}
          <aside id="app-sidebar" className={`
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
              <section className="bg-slate-50 rounded-lg border border-slate-200 p-4" aria-labelledby="target-heading">
                <h2 id="target-heading" className="text-xs font-bold uppercase text-slate-500 mb-3">Target Selection</h2>

                <PdbIdForm
                  id="pdb-id-mobile"
                  className="md:hidden mb-4 pb-4 border-b border-slate-200"
                  showLabel
                  value={pdbIdInput}
                  busy={fetchingPdb}
                  onChange={setPdbIdInput}
                  onSubmit={loadPdbId}
                />

                <div className="mb-4">
                  <label htmlFor="ligand-select" className="block text-xs font-medium text-slate-600 mb-1">Ligand</label>
                  <select
                    id="ligand-select"
                    className="w-full border-slate-300 rounded text-sm p-2 border bg-white focus:ring-2 focus:ring-indigo-500 outline-none disabled:text-slate-500"
                    value={selectedKey ?? ''}
                    onChange={(e) => setSelectedKey(e.target.value || null)}
                    disabled={ligandCandidates.length === 0}
                  >
                    {ligandCandidates.length === 0 && <option value="">{emptyLigandOption}</option>}
                    {ligandCandidates.map(lig => (
                      <option key={ligandKey(lig)} value={ligandKey(lig)}>{ligandOptionText(lig)}</option>
                    ))}
                  </select>
                </div>

                <div className="pt-3 border-t border-slate-200">
                  <form
                    className="flex gap-2"
                    onSubmit={e => { e.preventDefault(); handleManualSearch(); }}
                    role="search"
                  >
                    <input
                      type="text"
                      className="flex-1 min-w-0 border border-slate-300 rounded text-sm px-2 py-1 disabled:bg-slate-100"
                      placeholder="Search residue (e.g. LIG)"
                      aria-label="Search for a ligand by residue name"
                      value={manualSearchQuery}
                      onChange={e => { setManualSearchQuery(e.target.value); setSearchMessage(null); }}
                      disabled={!prepared}
                    />
                    <button type="submit" disabled={!prepared} className="px-3 py-1 bg-white border border-slate-300 hover:bg-slate-100 rounded text-sm shadow-sm disabled:opacity-50" aria-label="Search residue">
                      <Search size={14} aria-hidden="true" />
                    </button>
                  </form>
                  {searchMessage && <p className="mt-2 text-xs text-red-700" role="status">{searchMessage}</p>}
                </div>
              </section>

              {/* Visualization Controls */}
              <section className="bg-slate-50 rounded-lg border border-slate-200 p-4" aria-labelledby="vis-heading">
                <h2 id="vis-heading" className="text-xs font-bold uppercase text-slate-500 mb-3">Visualization</h2>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="protein-style" className={labelCls}>Protein</label>
                      <select id="protein-style" className="w-full text-xs border p-1 rounded bg-white" value={visualSettings.proteinStyle} onChange={e => setVisualSettings({ ...visualSettings, proteinStyle: e.target.value as VisualSettings['proteinStyle'] })}>
                        <option value="cartoon">Cartoon</option>
                        <option value="rope">Rope</option>
                        <option value="line">Lines</option>
                        <option value="hidden">Hidden</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="ligand-style" className={labelCls}>Ligand</label>
                      <select id="ligand-style" className="w-full text-xs border p-1 rounded bg-white" value={visualSettings.ligandStyle} onChange={e => setVisualSettings({ ...visualSettings, ligandStyle: e.target.value as VisualSettings['ligandStyle'] })}>
                        <option value="ball+stick">Ball &amp; Stick</option>
                        <option value="licorice">Licorice</option>
                        <option value="spacefill">Spacefill</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="ligand-color" className={labelCls}>Ligand Color</label>
                      <input
                        id="ligand-color"
                        type="color"
                        value={visualSettings.ligandColor}
                        onChange={e => setVisualSettings({ ...visualSettings, ligandColor: e.target.value })}
                        className="w-full h-8 border rounded cursor-pointer"
                        title="Change ligand carbon color"
                      />
                    </div>
                    <div>
                      <label htmlFor="pocket-style" className={labelCls}>Pocket Residues</label>
                      <select id="pocket-style" className="w-full text-xs border p-1 rounded bg-white" value={visualSettings.pocketStyle} onChange={e => setVisualSettings({ ...visualSettings, pocketStyle: e.target.value as VisualSettings['pocketStyle'] })}>
                        <option value="stick">Stick</option>
                        <option value="licorice">Licorice</option>
                        <option value="ball+stick">Ball &amp; Stick</option>
                      </select>
                    </div>
                  </div>

                  <div className={opacityDisabled ? 'opacity-50' : ''}>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="protein-opacity" className="block text-[11px] font-bold text-slate-600">Protein Opacity</label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setVisualSettings({ ...visualSettings, proteinOpacity: 0.15 })}
                          disabled={opacityDisabled}
                          className="px-1.5 py-0.5 text-[11px] border border-slate-300 rounded hover:bg-slate-100 text-slate-600 disabled:pointer-events-none"
                          title="Faint context protein"
                        >
                          Faint
                        </button>
                        <button
                          type="button"
                          onClick={() => setVisualSettings({ ...visualSettings, proteinOpacity: 1 })}
                          disabled={opacityDisabled}
                          className="px-1.5 py-0.5 text-[11px] border border-slate-300 rounded hover:bg-slate-100 text-slate-600 disabled:pointer-events-none"
                          title="Fully opaque protein"
                        >
                          Solid
                        </button>
                        <span className="text-[11px] text-slate-600 w-8 text-right tabular-nums">
                          {Math.round(visualSettings.proteinOpacity * 100)}%
                        </span>
                      </div>
                    </div>
                    <input
                      id="protein-opacity"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={Math.round(visualSettings.proteinOpacity * 100)}
                      onChange={e => setVisualSettings({ ...visualSettings, proteinOpacity: parseInt(e.target.value) / 100 })}
                      className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed"
                      disabled={opacityDisabled}
                    />
                    {visualSettings.proteinStyle === 'line' && (
                      <p className="mt-1 text-[11px] text-slate-500">Lines are always drawn opaque.</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="line-width" className={labelCls}>Interaction Line Width</label>
                    <input id="line-width" type="range" min="1" max="8" step="1" value={visualSettings.interactionWidth} onChange={e => setVisualSettings({ ...visualSettings, interactionWidth: parseInt(e.target.value) })} className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                  </div>
                </div>
              </section>

              {/* Filters */}
              <section className="bg-slate-50 rounded-lg border border-slate-200 p-4" aria-labelledby="filter-heading">
                <h2 id="filter-heading" className="text-xs font-bold uppercase text-slate-500 mb-3 flex items-center gap-2">
                  <Filter size={14} aria-hidden="true" /> Interaction Filters
                </h2>
                <div className="space-y-1">
                  {INTERACTION_ORDER.map(type => {
                    const style = INTERACTION_STYLES[type];
                    return (
                      <label key={type} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-100 p-1 rounded -mx-1 transition-colors">
                        <input type="checkbox" checked={interactionFilters[type]} onChange={() => toggleFilter(type)} className="rounded text-indigo-600 focus:ring-0" />
                        <span className={`w-2.5 h-2.5 rounded-full ${style.dot}`} aria-hidden="true"></span>
                        <span className="flex-1">{style.label}</span>
                        {analysisResult && (
                          <span className="text-xs tabular-nums text-slate-500">{countsByType[type]}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </section>

              <button
                type="button"
                onClick={() => setRecenterTrigger(prev => prev + 1)}
                disabled={!file}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded text-sm font-medium hover:bg-slate-100 text-slate-700 disabled:opacity-50"
              >
                <Move size={14} aria-hidden="true" /> Recenter View
              </button>

            </div>
          </aside>

          {/* RIGHT PANEL: Content */}
          <div className="flex-1 w-full flex flex-col overflow-hidden relative">

            {/* Top: 3D Viewer - Takes more space on mobile when table collapsed */}
            <div className={`w-full relative border-b border-slate-200 bg-white min-h-0 transition-all duration-300 ${tableExpanded ? 'flex-1' : 'flex-[2] lg:flex-[2]'}`}>
              <Viewer
                file={file}
                onStructureLoaded={handleStructureLoaded}
                onLoadError={handleLoadError}
                ligandKey={selectedKey}
                analysis={analysisResult}
                interactions={filteredInteractions}
                visualSettings={visualSettings}
                triggerRecenter={recenterTrigger}
              />
            </div>

            {/* Bottom: Table - Collapsible on mobile */}
            <div className={`w-full overflow-hidden flex flex-col bg-white min-h-0 transition-all duration-300 ${tableExpanded ? 'flex-[2]' : 'lg:flex-[1]'}`}>
              {/* Table Header - Clickable on mobile to expand/collapse */}
              <button
                type="button"
                onClick={() => setTableExpanded(!tableExpanded)}
                aria-expanded={tableExpanded}
                className="lg:pointer-events-none bg-slate-50 px-4 py-3 lg:py-2 border-b border-slate-200 flex items-center justify-between text-sm font-bold text-slate-700 shrink-0 w-full hover:bg-slate-100 lg:hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <TableIcon size={16} aria-hidden="true" />
                  <span>Interaction Data</span>
                  {analysisResult && (
                    <span className="text-xs font-normal text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded-full tabular-nums">
                      {filteredInteractions.length === analysisResult.interactions.length
                        ? filteredInteractions.length
                        : `${filteredInteractions.length}/${analysisResult.interactions.length}`}
                    </span>
                  )}
                </div>
                <div className="lg:hidden text-slate-400" aria-hidden="true">
                  {tableExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>
              </button>
              {/* Table Content - Hidden on mobile when collapsed */}
              <div className={`flex-1 overflow-auto ${!tableExpanded ? 'hidden lg:block' : 'block'}`}>
                <InteractionTable
                  interactions={filteredInteractions}
                  totalCount={analysisResult?.interactions.length ?? 0}
                  state={tableState}
                  fileName={fileBase}
                  ligandLabel={ligandLabel}
                  onShowAll={() => setInteractionFilters(ALL_ON)}
                />
              </div>
            </div>

          </div>
        </main>
      </div>

      {dragDepth > 0 && (
        <div className="fixed inset-0 z-40 m-3 flex items-center justify-center rounded-xl border-4 border-dashed border-rose-500 bg-white/85 pointer-events-none" aria-hidden="true">
          <p className="text-lg font-semibold text-rose-800">Drop a structure file to load it</p>
        </div>
      )}

      {showHelp && (
        <div className="fixed inset-0 z-50 bg-slate-100" role="dialog" aria-modal="true" aria-label="LigPlot3D documentation">
          <HelpPage onBack={closeHelp} />
        </div>
      )}
    </div>
  );
};

export default App;
