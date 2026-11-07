
import React, { useMemo } from 'react';
import type { Interaction } from '../types';
import { Download, FileJson } from 'lucide-react';
import { INTERACTION_ORDER, INTERACTION_STYLES } from '../interactionStyles';

export type TableState = 'no-file' | 'loading' | 'error' | 'no-ligand' | 'ready';

interface Props {
  interactions: Interaction[];
  /** All interactions found for the ligand, before filtering. */
  totalCount: number;
  state: TableState;
  /** e.g. "1R9Q" — used in export file names and the CSV. */
  fileName: string;
  /** e.g. "PBE 1001 (A)" */
  ligandLabel: string;
  onShowAll: () => void;
  /** Explicit hydrogens found on each side (decides whether H-bond angles were checked). */
  hydrogens?: { ligand: boolean; receptor: boolean };
}

const residueText = (a: Interaction['proteinAtom']) => `${a.resName} ${a.resNo}${a.insCode}`;
const ligandText = (i: Interaction) => i.ligandLabel ?? i.ligandAtom.name;
const partnerAtomText = (i: Interaction) => i.proteinLabel ?? i.proteinAtom.name;

/** RFC 4180 field quoting. */
const csvField = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const download = (content: BlobPart, type: string, name: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');

const hydrogenNote = (h?: { ligand: boolean; receptor: boolean }): string => {
  if (!h) return '';
  if (h.ligand && h.receptor) return 'H-bond angles checked using the file’s hydrogens';
  if (h.ligand) return 'H-bond angles checked for ligand donors; receptor has no hydrogens (distance only)';
  if (h.receptor) return 'H-bond angles checked for receptor donors; ligand has no hydrogens (distance only)';
  return 'No hydrogens in file: H-bonds from heavy-atom distances';
};

const InteractionTable: React.FC<Props> = ({ interactions, totalCount, state, fileName, ligandLabel, onShowAll, hydrogens }) => {

  const sortedInteractions = useMemo(() => {
    return [...interactions].sort((a, b) => {
      if (a.type !== b.type) return INTERACTION_ORDER.indexOf(a.type) - INTERACTION_ORDER.indexOf(b.type);
      return a.distance - b.distance;
    });
  }, [interactions]);

  const exportBase = `${safe(fileName) || 'structure'}_${safe(ligandLabel) || 'ligand'}_interactions`;
  // Multi-residue ligands (e.g. an 18-unit glucan): atom names alone are ambiguous, so the
  // table also names the ligand residue of each contact.
  const multiUnit = new Set(interactions.map(i => `${i.ligandAtom.chain}|${i.ligandAtom.resNo}|${i.ligandAtom.insCode}|${i.ligandAtom.resName}`)).size > 1;
  const ligandCell = (i: Interaction) => (multiUnit ? `${residueText(i.ligandAtom)} · ${ligandText(i)}` : ligandText(i));

  const downloadCSV = () => {
    const headers = [
      'File', 'Ligand', 'ID', 'Type', 'Subtype', 'Distance (Å)', 'Angle (°)',
      'Ligand Residue', 'Ligand Chain', 'Ligand Atom(s)', 'Ligand Element',
      'Partner Residue', 'Partner Chain', 'Partner Atom(s)', 'Partner Element',
    ];
    const rows = sortedInteractions.map(i => [
      fileName, ligandLabel, i.id, i.type, i.subtype ?? '', i.distance.toFixed(2),
      i.angle !== undefined ? i.angle.toFixed(1) : '',
      residueText(i.ligandAtom), i.ligandAtom.chain, ligandText(i), i.ligandLabel ? '' : i.ligandAtom.element,
      residueText(i.proteinAtom), i.proteinAtom.chain, partnerAtomText(i), i.proteinLabel ? '' : i.proteinAtom.element,
    ]);
    const csv = [headers, ...rows].map(r => r.map(csvField).join(',')).join('\r\n');
    // BOM so spreadsheet software reads the Å / ° symbols as UTF-8.
    download('﻿' + csv, 'text/csv;charset=utf-8', `${exportBase}.csv`);
  };

  const downloadJSON = () => {
    download(JSON.stringify(sortedInteractions, null, 2), 'application/json', `${exportBase}.json`);
  };

  if (state !== 'ready' || interactions.length === 0) {
    let message: React.ReactNode;
    switch (state) {
      case 'no-file': message = 'Upload a structure or try the demo to see interactions.'; break;
      case 'loading': message = 'Analysing structure…'; break;
      case 'error': message = 'The structure could not be analysed. See the message above the viewer.'; break;
      case 'no-ligand': message = 'No ligand selected. Choose one in the sidebar or search by residue name.'; break;
      default:
        message = totalCount === 0
          ? 'No interactions detected for this ligand.'
          : (
            <span>
              All {totalCount} interactions are hidden by the current filters.{' '}
              <button type="button" onClick={onShowAll} className="font-medium text-indigo-600 underline hover:text-indigo-800">Show all</button>
            </span>
          );
    }
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm px-4 text-center" role="status">
        <p>{message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar with export buttons */}
      <div className="px-3 md:px-4 py-2 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {interactions.length === totalCount ? `${totalCount} interactions` : `${interactions.length} of ${totalCount} interactions shown`}
          {hydrogens && <span className="hidden sm:inline" data-testid="hydrogen-note"> · {hydrogenNote(hydrogens)}</span>}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={downloadCSV} className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium bg-slate-100 border border-slate-300 rounded hover:bg-slate-200 text-slate-700">
            <Download size={12} aria-hidden="true" /> <span className="hidden sm:inline">Export</span> CSV
          </button>
          <button type="button" onClick={downloadJSON} className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium bg-slate-100 border border-slate-300 rounded hover:bg-slate-200 text-slate-700">
            <FileJson size={12} aria-hidden="true" /> <span className="hidden sm:inline">Export</span> JSON
          </button>
        </div>
      </div>

      {/* Scrollable table container - horizontal scroll on mobile */}
      <div className="overflow-auto flex-1 bg-white">
        <table className="w-full text-xs md:text-sm text-left text-slate-600 min-w-[520px]">
          <thead className="text-[11px] md:text-xs text-slate-700 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
            <tr>
              <th scope="col" className="px-2 md:px-4 py-2 border-b">Type</th>
              <th scope="col" className="px-2 md:px-4 py-2 border-b">Dist (Å)</th>
              <th scope="col" className="px-2 md:px-4 py-2 border-b">Ligand</th>
              <th scope="col" className="px-2 md:px-4 py-2 border-b">Partner</th>
              <th scope="col" className="px-2 md:px-4 py-2 border-b hidden sm:table-cell">Partner Atom</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedInteractions.map((interaction) => {
              const style = INTERACTION_STYLES[interaction.type];
              return (
                <tr key={interaction.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-2 md:px-4 py-2">
                    <span className={`px-1.5 md:px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${style.badge}`}>
                      <span className="hidden md:inline">{interaction.type}</span>
                      <span className="md:hidden">{style.short}</span>
                    </span>
                    {interaction.subtype && (
                      <span className="ml-1.5 text-[11px] text-slate-500 whitespace-nowrap">{interaction.subtype}</span>
                    )}
                  </td>
                  <td className="px-2 md:px-4 py-2 font-mono text-slate-900 font-medium">
                    {interaction.distance.toFixed(2)}
                    {interaction.angle !== undefined && (
                      <span className="hidden md:inline text-slate-400 text-xs font-sans"> · {interaction.angle.toFixed(0)}°</span>
                    )}
                  </td>
                  <td className="px-2 md:px-4 py-2 text-slate-600">
                    {ligandCell(interaction)}
                    {!interaction.ligandLabel && (
                      <span className="hidden md:inline text-slate-400 text-xs"> ({interaction.ligandAtom.element})</span>
                    )}
                  </td>
                  <td className="px-2 md:px-4 py-2 font-medium text-slate-800 whitespace-nowrap">
                    {residueText(interaction.proteinAtom)}
                    <span className="text-slate-400 font-normal"> ({interaction.proteinAtom.chain || '–'})</span>
                  </td>
                  <td className="px-2 md:px-4 py-2 text-slate-600 hidden sm:table-cell">{partnerAtomText(interaction)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InteractionTable;
