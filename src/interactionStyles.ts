import { InteractionType } from './types';

/**
 * Single source of truth for how each interaction type is drawn and labelled, used by
 * the sidebar legend, the 3D viewer, the interaction table and the Help page. They
 * previously disagreed (hydrophobic was grey in 3D but orange in the table, π-stacking
 * had no table colour, metal coordination had no colour anywhere).
 *
 * None of the line colours is reused for ligand atoms (see LIGAND_ELEMENT_COLORS).
 */
export interface InteractionStyle {
  /** Plural label for filters / legend. */
  label: string;
  /** Short label for narrow table cells. */
  short: string;
  /** 3D line colour. */
  color: string;
  dashed: boolean;
  /** Tailwind classes for the table badge. */
  badge: string;
  /** Tailwind class for the legend dot. */
  dot: string;
}

export const INTERACTION_STYLES: Record<InteractionType, InteractionStyle> = {
  [InteractionType.HydrogenBond]: {
    label: 'H-Bonds', short: 'H-Bond', color: '#3b82f6', dashed: true,
    badge: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500',
  },
  [InteractionType.SaltBridge]: {
    label: 'Salt Bridges', short: 'Salt', color: '#eab308', dashed: true,
    badge: 'bg-yellow-50 text-yellow-800 border-yellow-200', dot: 'bg-yellow-500',
  },
  [InteractionType.PiStacking]: {
    label: 'π-Stacking / Cation–π', short: 'π', color: '#16a34a', dashed: false,
    badge: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-600',
  },
  [InteractionType.MetalCoordination]: {
    label: 'Metal Coordination', short: 'Metal', color: '#0d9488', dashed: false,
    badge: 'bg-teal-50 text-teal-700 border-teal-200', dot: 'bg-teal-600',
  },
  [InteractionType.HalogenBond]: {
    label: 'Halogen Bonds', short: 'Halogen', color: '#9333ea', dashed: true,
    badge: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-600',
  },
  [InteractionType.Hydrophobic]: {
    label: 'Hydrophobic', short: 'Hydro', color: '#94a3b8', dashed: true,
    badge: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400',
  },
};

/** Display order for filters, legend and table sorting. */
export const INTERACTION_ORDER: InteractionType[] = [
  InteractionType.HydrogenBond,
  InteractionType.SaltBridge,
  InteractionType.PiStacking,
  InteractionType.MetalCoordination,
  InteractionType.HalogenBond,
  InteractionType.Hydrophobic,
];

/** Default ligand carbon colour: magenta, distinct from every interaction line colour. */
export const DEFAULT_LIGAND_COLOR = '#d946ef';

/** Ligand heteroatom colours. N is a dark blue so it does not match the H-bond line. */
export const LIGAND_ELEMENT_COLORS: Record<string, string> = {
  N: '#1e40af',
  O: '#ef4444',
  S: '#d97706',
  P: '#f97316',
  default: '#9ca3af',
};
