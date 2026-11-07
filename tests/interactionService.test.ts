// Regression tests for the interaction detection. They run the real detection code on
// real PDB entries and pin the chemistry that the audit (Nov 2026) found wrong.
import { describe, it, expect, beforeAll } from 'vitest';
import * as NGL from 'ngl';
import { readFileSync } from 'node:fs';
import { prepareStructure, getLigandCandidates, analyzeInteractions } from '../src/services/interactionService';
import type { PreparedStructure } from '../src/services/interactionService';
import { structureFormat, isSupportedStructureFile } from '../src/services/fileFormat';
import { InteractionType } from '../src/types';
import { canonicalResidue } from '../src/constants';
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

// ---------------------------------------------------------------------------
// Hydrogens and force-field naming. Results must depend only on geometry, never on how
// a tool names or orders hydrogens (PDB, CHARMM, AMBER, GROMACS, Open Babel ...).
// ---------------------------------------------------------------------------

const atomLines = (text: string) => text.split('\n').filter(l => /^(ATOM|HETATM)/.test(l));
const isH = (l: string) => (l.slice(76, 78).trim() || l.slice(12, 14).trim()[0]) === 'H';
const setAtomName = (l: string, name: string) => l.padEnd(80).slice(0, 12) + (name.length === 4 ? name : ` ${name.padEnd(3)}`) + l.padEnd(80).slice(16);
/** Fixed-column PDB atom line (element column omitted when el is ''). */
const pdbLine = (rec: 'ATOM' | 'HETATM', serial: number, name: string, resName: string, chain: string, resNo: number, p: number[], el = '') =>
  `${rec.padEnd(6)}${String(serial).padStart(5)} ${name.length === 4 ? name : ` ${name.padEnd(3)}`} ${resName.padEnd(3)}${resName.length > 3 ? '' : ' '}${chain}${String(resNo).padStart(4)}    ${p.map(v => v.toFixed(3).padStart(8)).join('')}  1.00  0.00          ${el.padStart(2)}`.trimEnd();
const signature = (r: AnalysisResult) => r.interactions
  .map(i => `${i.type}|${i.ligandAtom.name}|${i.proteinAtom.resName}${i.proteinAtom.resNo}:${i.proteinAtom.chain}.${i.proteinAtom.name}|${i.distance.toFixed(3)}`)
  .sort();

describe('explicit hydrogens: order- and name-independent (1STP, Open Babel output)', () => {
  // Open Babel writes every hydrogen after all heavy atoms, with generic names "H".
  // Reference (PLIP --nohydro and an independent numpy implementation, same hydrogens): 5 H-bonds.
  const text = read('./fixtures/1stp_obabel_h.pdb');
  const lines = atomLines(text);
  const heavy = lines.filter(l => !isH(l));
  const hyd = lines.filter(isH);
  let base: AnalysisResult;
  beforeAll(async () => { base = analyse(await load(text), 'BTN'); });

  it('applies the D–H···A angle check to these hydrogens (5 H-bonds, not the 8 of the distance-only fallback)', () => {
    expect(base.hydrogens).toEqual({ ligand: true, receptor: true });
    expect(ofType(base, InteractionType.HydrogenBond)).toHaveLength(5);
  });

  it('gives identical results when hydrogens are reversed, renamed, relabelled or written as deuterium', async () => {
    const variants = [
      heavy.concat([...hyd].reverse()),
      heavy.concat(hyd.map((l, i) => setAtomName(l, `HX${i % 99}`))),
      heavy.concat(hyd.map(l => l.padEnd(80).slice(0, 17) + 'UNK Z9999 ' + l.padEnd(80).slice(27))),
      heavy.concat(hyd.map(l => { const d = setAtomName(l, 'D'); return d.slice(0, 76) + ' D' + d.slice(78); })),
      lines.map(l => l.padEnd(80).slice(0, 76).trimEnd()), // no element column at all
    ];
    for (const v of variants) {
      expect(signature(analyse(await load(v.join('\n') + '\nEND\n'), 'BTN'))).toEqual(signature(base));
    }
  });
});

describe('protonation: hydrogens > residue name > convention', () => {
  const demo = atomLines(read('../public/1R9Q.pdb'));
  const his = Object.fromEntries(demo.filter(l => l.slice(17, 20) === 'HIS' && l.slice(22, 26).trim() === '69')
    .map(l => [l.slice(12, 16).trim(), [+l.slice(30, 38), +l.slice(38, 46), +l.slice(46, 54)]]));
  // a hydrogen 1.01 Å from ring nitrogen n, along the external bisector of its two ring neighbours
  const ringH = (n: string, a: string, b: string) => {
    const v = [0, 1, 2].map(i => 2 * his[n][i] - his[a][i] - his[b][i]);
    const m = Math.hypot(...v);
    const p = [0, 1, 2].map(i => (his[n][i] + 1.01 * v[i] / m).toFixed(3).padStart(8));
    return `ATOM  99999  H   HIS A  69    ${p.join('')}  1.00  0.00           H`;
  };
  const rename = (name: string) => demo.map(l => (l.slice(17, 20) === 'HIS' && l.slice(22, 26).trim() === '69' ? l.slice(0, 17) + name.padEnd(4) + l.slice(21) : l));
  const sbTo69 = async (lines: string[]) => ofType(analyse(await load(lines.join('\n') + '\nEND\n')), InteractionType.SaltBridge).some(i => i.proteinAtom.resNo === 69);

  it('His with H on both ring nitrogens is cationic — generic names, written at the end of the file', async () => {
    expect(await sbTo69([...demo, ringH('ND1', 'CG', 'CE1'), ringH('NE2', 'CD2', 'CE1')])).toBe(true);
  });
  it('His with H on one ring nitrogen is neutral, whatever its name says', async () => {
    expect(await sbTo69([...demo, ringH('NE2', 'CD2', 'CE1')])).toBe(false);
    expect(await sbTo69([...rename('HSP'), ringH('NE2', 'CD2', 'CE1')])).toBe(false);
  });
  it('without ring hydrogens the residue name decides', async () => {
    expect(await sbTo69(rename('HSD'))).toBe(false);
    expect(await sbTo69(rename('HIE'))).toBe(false);
    expect(await sbTo69(rename('HSP'))).toBe(true);
    expect(await sbTo69(rename('HISH'))).toBe(true);
    expect(await sbTo69(demo)).toBe(true); // plain HIS: PLIP convention
  });
  it('maps force-field residue names to their protonation state', () => {
    expect(canonicalResidue('ASH')).toEqual({ base: 'ASP', state: 'neutral' });
    expect(canonicalResidue('GLUP')).toEqual({ base: 'GLU', state: 'neutral' });
    expect(canonicalResidue('LYSN')).toEqual({ base: 'LYS', state: 'neutral' });
    expect(canonicalResidue('HIP')).toEqual({ base: 'HIS', state: 'charged' });
    expect(canonicalResidue('NALA')).toEqual({ base: 'ALA' });   // AMBER terminal prefix
    expect(canonicalResidue('NAG', true)).toEqual({ base: 'NAG' }); // a sugar, not N-terminal "AG"
    expect(canonicalResidue('CALA', true)).toEqual({ base: 'CALA' }); // prefixes only on ATOM records
  });
});

describe('simulation-style files (CHARMM naming, no element column)', () => {
  it('ignores waters written as ATOM records and types CHARMM ions correctly', async () => {
    const src = atomLines(read('./fixtures/3hs4.pdb'));
    const ref = analyse(await load(src.join('\n')), 'AZM');
    // Na+ 2.45 Å from the acetyl O3, placed outward along (ligand centroid -> O3) so it touches only O3
    const lig = src.filter(l => l.slice(17, 20) === 'AZM' && l.slice(22, 26).trim() === '701' && ' A'.includes(l[16]));
    const xyz = (l: string) => [+l.slice(30, 38), +l.slice(38, 46), +l.slice(46, 54)];
    const c = [0, 1, 2].map(i => lig.reduce((t, l) => t + xyz(l)[i], 0) / lig.length);
    const o3 = xyz(lig.find(l => l.slice(12, 16).trim() === 'O3')!);
    const u = [0, 1, 2].map(i => o3[i] - c[i]);
    const naPos = [0, 1, 2].map(i => o3[i] + 2.45 * u[i] / Math.hypot(...u));
    const charmm = src
      .map(l => (l.slice(17, 20) === 'HOH' ? 'ATOM  ' + l.slice(6, 12) + ' OH2 TIP3' + l.slice(21) : l))
      .map(l => l.padEnd(80).slice(0, 76).trimEnd())
      .concat([pdbLine('ATOM', 90001, 'SOD', 'SOD', 'X', 1, naPos)]);
    const r = analyse(await load(charmm.join('\n') + '\nEND\n'), 'AZM');
    expect(r.interactions.some(i => /TIP3/.test(i.proteinAtom.resName))).toBe(false);
    const na = ofType(r, InteractionType.MetalCoordination).filter(i => i.proteinAtom.resName === 'SOD');
    expect(na).toHaveLength(1);
    expect(na[0].proteinAtom.element).toBe('NA');
    expect(ofType(r, InteractionType.HydrogenBond).map(i => i.distance.toFixed(3)).sort())
      .toEqual(ofType(ref, InteractionType.HydrogenBond).map(i => i.distance.toFixed(3)).sort());
  });

  it('keeps chlorophyll a (CLA) as a ligand while a single-atom CLA is a chloride ion', async () => {
    const extra = [
      pdbLine('HETATM', 90001, 'MG', 'CLA', 'B', 601, [50, 50, 50], 'MG'),
      pdbLine('HETATM', 90002, 'NA', 'CLA', 'B', 601, [51.9, 50, 50], 'N'),
      pdbLine('HETATM', 90003, 'C1A', 'CLA', 'B', 601, [52.6, 51.2, 50], 'C'),
      pdbLine('ATOM', 90004, 'CLA', 'CLA', 'X', 2, [60, 60, 60]), // CHARMM chloride, no element column
    ];
    const s = await load(atomLines(read('../public/1R9Q.pdb')).concat(extra).join('\n') + '\nEND\n');
    const names = getLigandCandidates(s.structure).map(c => `${c.resName}:${c.chain}`);
    expect(names).toContain('CLA:B');
    expect(names).not.toContain('CLA:X');
  });
});

// ---------------------------------------------------------------------------
// Multi-residue ligands: one ligand = one covalently connected set of residues, whatever
// their residue names, chain IDs or record type (4HG6 cellulose synthase glucan, 18 units).
// ---------------------------------------------------------------------------

describe('multi-residue ligands (4HG6 glucan, 18 β-1,4-linked glucose units)', () => {
  const site = atomLines(read('./fixtures/4hg6_glucan_site.pdb'));
  const isGlucan = (l: string) => l.slice(17, 20) === 'BGC' && l[21] === 'C';
  const unitNo = (l: string) => +l.slice(22, 26);
  const withName = (l: string, name: string, rec?: string) => {
    const p = l.padEnd(80);
    return (rec ? rec.padEnd(6) : p.slice(0, 6)) + p.slice(6, 17) + name.padEnd(4).slice(0, 4) + p.slice(21);
  };
  // GLYCAM (AMBER) names encode the linkage: a mixed-linkage glucan alternates 4GB / 3GB, 0GB terminal
  const glycam = (u: number) => (u === 18 ? '0GB' : u % 3 ? '4GB' : '3GB');
  const variants: Record<string, string[]> = {
    'PDB (BGC, HETATM)': site,
    'AMBER/GLYCAM mixed-linkage names, ATOM records (tleap)': site.map(l => (isGlucan(l) ? withName(l, glycam(unitNo(l)), 'ATOM') : l)),
    'GLYCAM names, HETATM': site.map(l => (isGlucan(l) ? withName(l, glycam(unitNo(l))) : l)),
    'CHARMM BGLC, ATOM records': site.map(l => (isGlucan(l) ? withName(l, 'BGLC', 'ATOM') : l)),
    'mixed PDB codes BGC/GLC': site.map(l => (isGlucan(l) && unitNo(l) % 3 === 0 ? withName(l, 'GLC') : l)),
    'chain split over two chain IDs': site.map(l => (isGlucan(l) && unitNo(l) > 9 ? l.slice(0, 21) + 'G' + l.slice(22) : l)),
  };
  const glucanOf = (s: PreparedStructure) => getLigandCandidates(s.structure).find(c => (c.units?.length ?? 1) > 1);
  // compare by unit number + atom name (residue names differ between namings)
  const sig = (r: AnalysisResult) => r.interactions
    .map(i => `${i.type}|${i.ligandAtom.resNo}.${i.ligandAtom.name}|${i.proteinAtom.resName}${i.proteinAtom.resNo}.${i.proteinAtom.name}|${i.distance.toFixed(3)}`).sort();
  let reference: AnalysisResult;
  beforeAll(async () => {
    const s = await load(site.join('\n'));
    reference = analyzeInteractions(s.structure, glucanOf(s)!);
  });

  it.each(Object.keys(variants))('%s: all 18 units form one ligand with identical interactions', async (name) => {
    const s = await load(variants[name].join('\n') + '\nEND\n');
    const glucan = glucanOf(s)!;
    expect(glucan.units).toHaveLength(18);
    const r = analyzeInteractions(s.structure, glucan);
    expect(r.ligandAtoms).toHaveLength(199);
    expect(sig(r)).toEqual(sig(reference));
  });

  it('keeps UDP a separate ligand, and its analysis does not change when the glucan is written as ATOM records', async () => {
    const udpSig = async (lines: string[]) => {
      const s = await load(lines.join('\n') + '\nEND\n');
      const udp = getLigandCandidates(s.structure).find(c => c.resName === 'UDP')!;
      expect(udp.units).toBeUndefined();
      return sig(analyzeInteractions(s.structure, udp));
    };
    expect(await udpSig(variants['AMBER/GLYCAM mixed-linkage names, ATOM records (tleap)'])).toEqual(await udpSig(site));
  });

  it('does not merge two overlapping copies of a ligand (alternative poses)', async () => {
    const udp = site.filter(l => l.slice(17, 20) === 'UDP');
    const copy = udp.map(l => l.slice(0, 17) + 'UD2' + l.slice(20, 22) + ' 999' + l.slice(26, 30)
      + (+l.slice(30, 38) + 1.5).toFixed(3).padStart(8) + l.slice(38));
    const s = await load([...site, ...copy].join('\n') + '\nEND\n');
    const names = getLigandCandidates(s.structure).map(c => (c.units ? c.units.map(u => u.resName).join('+') : c.resName));
    expect(names).toContain('UDP');
    expect(names).toContain('UD2');
  });

  it('keeps two separate glucan chains separate when they are not bonded', async () => {
    // move units 10-18 15 Å away: the 9–10 glycosidic bond is broken
    const moved = site.map(l => (isGlucan(l) && unitNo(l) >= 10 ? l.slice(0, 30) + (+l.slice(30, 38) + 15).toFixed(3).padStart(8) + l.slice(38) : l));
    const s = await load(moved.join('\n') + '\nEND\n');
    const sizes = getLigandCandidates(s.structure).filter(c => c.resName === 'BGC').map(c => c.units?.length ?? 1).sort();
    expect(sizes).toEqual([9, 9]);
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
