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
};

/** Tier affects region icon scale */
export function tierScale(tier: CastleTier): number {
  switch (tier) {
    case 'hut':        return 0.7;
    case 'cottage':    return 0.75;
    case 'tower':      return 0.8;
    case 'keep':       return 0.85;
    case 'manor':      return 0.9;
    case 'castle':     return 1.0;
    case 'stronghold': return 1.05;
    case 'fortress':   return 1.15;
    case 'palace':     return 1.2;
    case 'citadel':    return 1.3;
    case 'empire':     return 1.4;
    case 'legend':     return 1.5;
  }
}

/** Get full region style from a MapRegion */
export function getRegionStyle(region: MapRegion): RegionStyle {
  const base = PHASE_STYLES[region.phase] ?? PHASE_STYLES.construction;

  let filter = '';
  if (region.isLegendary) {
    filter = 'url(#legendaryGlow)';
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
  };
  return labels[phase] ?? phase;
}

/** Tier display name (capitalize first letter) */
export function tierDisplayName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
