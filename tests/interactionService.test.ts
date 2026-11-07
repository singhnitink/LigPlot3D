// Regression tests for the interaction detection. They run the real detection code on
// real PDB entries and pin the chemistry that the audit (Nov 2026) found wrong.
import { describe, it, expect, beforeAll } from 'vitest';
import * as NGL from 'ngl';
import { readFileSync } from 'node:fs';
import { prepareStructure, getLigandCandidates, analyzeInteractions } from '../src/services/interactionService';
import type { PreparedStructure } from '../src/services/interactionService';
import { structureFormat, isSupportedStructureFile } from '../src/services/fileFormat';
import { InteractionType } from '../src/types';
import type { AnalysisResult, Interaction } from '../src/types';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const load = async (text: string, ext = 'pdb'): Promise<PreparedStructure> =>
  prepareStructure((await NGL.autoLoad(new Blob([text]), { ext })) as NGL.Structure);

const analyse = (s: PreparedStructure, resName?: string): AnalysisResult => {
  const cands = getLigandCandidates(s.structure);
  const lig = resName ? cands.find(c => c.resName === resName) : cands[0];
  if (!lig) throw new Error(`ligand ${resName} not found`);
  return analyzeInteractions(s.structure, lig);
};
const ofType = (r: AnalysisResult, t: InteractionType) => r.interactions.filter(i => i.type === t);
const partner = (i: Interaction) => `${i.proteinAtom.resName}${i.proteinAtom.resNo}`;

describe('1R9Q demo: proline betaine in a tryptophan cage', () => {
  let s: PreparedStructure;
  let r: AnalysisResult;
  beforeAll(async () => {
    s = await load(read('../public/1R9Q.pdb'));
    r = analyse(s);
  });

  it('auto-selects proline betaine (UNX unknown atom is not a candidate)', () => {
    expect(getLigandCandidates(s.structure).map(c => c.resName)).toEqual(['PBE']);
  });

  it('finds cation-π from the quaternary ammonium to Trp65 and Trp188, measured to ring centroids', () => {
    const cp = ofType(r, InteractionType.PiStacking).filter(i => i.subtype === 'cation-π');
    expect(cp.map(partner).sort()).toEqual(['TRP188', 'TRP65']);
    for (const i of cp) {
      expect(i.ligandAtom.name).toBe('N');
      expect(i.proteinPoint).toBeDefined();
      expect(i.distance).toBeLessThanOrEqual(6.0);
    }
  });

  it('does not report the edge-on Tyr46 as cation-π (lateral offset criterion)', () => {
    expect(r.interactions.some(i => partner(i) === 'TYR46' && i.type === InteractionType.PiStacking)).toBe(false);
  });

  it('reports the carboxylate–His69 salt bridge once, not also as an H-bond', () => {
    const sb = ofType(r, InteractionType.SaltBridge);
    expect(sb).toHaveLength(1);
    expect(partner(sb[0])).toBe('HIS69');
    expect(sb[0].subtype).toBe('carboxylate');
    const hbHis69 = ofType(r, InteractionType.HydrogenBond).filter(i => partner(i) === 'HIS69');
    expect(hbHis69).toHaveLength(0);
  });

  it('reduces hydrophobic contacts to a PLIP-like handful (was 63 atom pairs)', () => {
    expect(ofType(r, InteractionType.Hydrophobic).length).toBeLessThanOrEqual(8);
  });
});

describe('3HS4: acetazolamide on the carbonic anhydrase II zinc', () => {
  let r: AnalysisResult;
  beforeAll(async () => { r = analyse(await load(read('./fixtures/3hs4.pdb')), 'AZM'); });

  it('detects coordination of the sulfonamide N to the Zn ion (HETATM partner)', () => {
    const mt = ofType(r, InteractionType.MetalCoordination);
    expect(mt).toHaveLength(1);
    expect(mt[0].ligandAtom.name).toBe('N1');
    expect(mt[0].proteinAtom.element).toBe('ZN');
    expect(mt[0].distance).toBeLessThan(2.2);
  });

  it('does not call the Zn-bound sulfonamide N a cation', () => {
    expect(ofType(r, InteractionType.PiStacking)).toHaveLength(0);
    expect(ofType(r, InteractionType.SaltBridge)).toHaveLength(0);
  });

  it('keeps the Thr199 H-bond but none to the Zn-bound histidines', () => {
    const hb = ofType(r, InteractionType.HydrogenBond);
    expect(hb.some(i => i.ligandAtom.name === 'N1' && partner(i) === 'THR199' && i.proteinAtom.name === 'OG1')).toBe(true);
    expect(hb.some(i => ['HIS94', 'HIS96', 'HIS119'].includes(partner(i)))).toBe(false);
  });

  it('keeps only the primary alternate location of disordered atoms', () => {
    const seen = new Set<string>();
    for (const a of Object.values(r.residueAtoms).flat()) {
      const k = `${a.resKey}:${a.name}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});

describe('1PXX chain A: COX-2 with diclofenac, heme, glycans and detergent', () => {
  let s: PreparedStructure;
  beforeAll(async () => { s = await load(read('./fixtures/1pxx_chainA.pdb')); });

  it('ranks the drug above cofactors, glycans and detergents', () => {
    const names = getLigandCandidates(s.structure).map(c => c.resName);
    expect(names[0]).toBe('DIF');
    expect(names.indexOf('HEM')).toBeGreaterThan(0);
    expect(names.indexOf('NAG')).toBeGreaterThan(0);
    expect(names[names.length - 1]).toBe('BOG');
  });

  it('finds the diclofenac halogen bond and no spurious cation-π from its diarylamine', () => {
    const r = analyse(s, 'DIF');
    const xb = ofType(r, InteractionType.HalogenBond);
    expect(xb.map(i => `${i.ligandAtom.name}-${partner(i)}`)).toEqual(['CL4-SER530']);
    expect(ofType(r, InteractionType.PiStacking)).toHaveLength(0);
    expect(ofType(r, InteractionType.SaltBridge)).toHaveLength(0);
  });

  it('does not report porphyrin nitrogens on the heme Fe as H-bonds to the proximal His', () => {
    const r = analyse(s, 'HEM');
    expect(ofType(r, InteractionType.MetalCoordination).map(i => `${i.ligandAtom.name}-${partner(i)}`)).toEqual(['FE-HIS388']);
    expect(ofType(r, InteractionType.HydrogenBond).some(i => /^N[A-D]$/.test(i.ligandAtom.name))).toBe(false);
  });
});

describe('multi-model files', () => {
  it('analyses model 1 only, giving exactly the single-model result', async () => {
    const lines = read('../public/1R9Q.pdb').split('\n').filter(l => /^(ATOM|HETATM)/.test(l));
    const shifted = lines.map(l => (/^HETATM/.test(l) && l.slice(17, 20) === 'PBE')
      ? l.slice(0, 30) + (parseFloat(l.slice(30, 38)) + 3).toFixed(3).padStart(8) + l.slice(38)
      : l);
    const single = await load(lines.join('\n'));
    const multi = await load(['MODEL        1', ...lines, 'ENDMDL', 'MODEL        2', ...shifted, 'ENDMDL', 'END'].join('\n'));
    expect(multi.modelCount).toBe(2);
    const a = analyse(single), b = analyse(multi);
    expect(b.ligandAtoms).toHaveLength(a.ligandAtoms.length);
    expect(b.interactions.map(i => `${i.type}:${i.distance.toFixed(3)}`).sort())
      .toEqual(a.interactions.map(i => `${i.type}:${i.distance.toFixed(3)}`).sort());
  });
});

describe('file formats', () => {
  it('lower-cases extensions for the parsers and maps .ent for 3Dmol', () => {
    expect(structureFormat('1ABC.PDB')).toEqual({ ngl: 'pdb', mol3d: 'pdb' });
    expect(structureFormat('pdb1abc.ent')).toEqual({ ngl: 'ent', mol3d: 'pdb' });
    expect(structureFormat('pose.Mol2')).toEqual({ ngl: 'mol2', mol3d: 'mol2' });
  });

  it('accepts supported structure files regardless of case', () => {
    expect(isSupportedStructureFile('LIGAND.SDF')).toBe(true);
    expect(isSupportedStructureFile('notes.txt')).toBe(false);
  });

  it('parses an upper-case .PDB with NGL', async () => {
    const s = await load(read('./fixtures/3hs4.pdb'), structureFormat('3HS4.PDB').ngl);
    expect(s.structure.atomCount).toBeGreaterThan(1000);
  });
});
