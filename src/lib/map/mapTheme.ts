/**
 * mapTheme.ts
 *
 * Maps castle state (phase, tier, flags) to visual properties
 * for the SVG world map. Keeps all styling logic in one place.
 */

import type { MapRegion, LifePhase, CastleTier } from '$lib/types';

export interface RegionStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray: string;
  filter: string;          // SVG filter id reference or ''
  labelColor: string;
  iconFill: string;
  iconStroke: string;
  overlay: 'none' | 'fog' | 'cracks' | 'scaffolding';
}

const PHASE_STYLES: Record<LifePhase, Omit<RegionStyle, 'filter'>> = {
  construction: {
    fill: '#c4a06a',
    stroke: '#a88850',
    strokeWidth: 1.5,
    strokeDasharray: '6,3',
    labelColor: '#f0e0c0',
    iconFill: '#d4b07a',
    iconStroke: '#a88850',
    overlay: 'scaffolding',
  },
  graduated: {
    fill: '#6a8e6a',
    stroke: '#4a7a4a',
    strokeWidth: 2,
    strokeDasharray: '',
    labelColor: '#d8f0d8',
    iconFill: '#7aa87a',
    iconStroke: '#4a7a4a',
    overlay: 'none',
  },
  thriving: {
    fill: '#78a868',
    stroke: '#488838',
    strokeWidth: 2.5,
    strokeDasharray: '',
    labelColor: '#e0ffd0',
    iconFill: '#88c078',
    iconStroke: '#488838',
    overlay: 'none',
  },
  declining: {
    fill: '#8a7060',
    stroke: '#6a5040',
    strokeWidth: 1.5,
    strokeDasharray: '',
    labelColor: '#dcc0b0',
    iconFill: '#9a8070',
    iconStroke: '#6a5040',
    overlay: 'none',
  },
  dormant: {
    fill: '#686868',
    stroke: '#484848',
    strokeWidth: 1.5,
    strokeDasharray: '',
    labelColor: '#c0c0c0',
    iconFill: '#787878',
    iconStroke: '#484848',
    overlay: 'none',
  },
  zombie: {
    fill: '#3a4a3a',
    stroke: '#2a3a2a',
    strokeWidth: 1.5,
    strokeDasharray: '',
    labelColor: '#98b898',
    iconFill: '#4a5a4a',
    iconStroke: '#2a3a2a',
    overlay: 'fog',
  },
  cursed: {
    fill: '#4a2a4a',
    stroke: '#3a1a3a',
    strokeWidth: 2,
    strokeDasharray: '',
    labelColor: '#d098d0',
    iconFill: '#5a3a5a',
    iconStroke: '#3a1a3a',
    overlay: 'cracks',
  },
};

/** Tier affects region icon scale */
export function tierScale(tier: CastleTier): number {
  switch (tier) {
    case 'keep':     return 0.85;
    case 'castle':   return 1.0;
    case 'fortress': return 1.15;
    case 'citadel':  return 1.3;
  }
}

/** Get full region style from a MapRegion */
export function getRegionStyle(region: MapRegion): RegionStyle {
  const base = PHASE_STYLES[region.phase] ?? PHASE_STYLES.dormant;

  let filter = '';
  if (region.isLegendary) {
    filter = 'url(#legendaryGlow)';
  } else if (region.phase === 'zombie') {
    filter = 'url(#fogFilter)';
  } else if (region.phase === 'cursed') {
    filter = 'url(#cursedFilter)';
  }

  // Legendary overrides: gold stroke
  if (region.isLegendary) {
    return {
      ...base,
      stroke: '#ffd700',
      strokeWidth: 3,
      strokeDasharray: '',
      iconStroke: '#ffd700',
      filter,
    };
  }

  return { ...base, filter };
}

/** Format market cap for map labels */
export function formatMapMcap(mcap: number): string {
  if (mcap >= 1_000_000_000) return `$${(mcap / 1_000_000_000).toFixed(1)}B`;
  if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(1)}M`;
  if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(0)}K`;
  return `$${mcap.toFixed(0)}`;
}

/** Phase display name for map tooltip */
export function phaseLabel(phase: LifePhase): string {
  const labels: Record<LifePhase, string> = {
    construction: 'Under Construction',
    graduated: 'Graduated',
    thriving: 'Thriving',
    declining: 'Declining',
    dormant: 'Dormant',
    zombie: 'Abandoned',
    cursed: 'Cursed',
  };
  return labels[phase] ?? phase;
}
