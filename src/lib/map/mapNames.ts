/**
 * mapNames.ts
 *
 * Deterministic fantasy-style naming for map regions.
 * Names are derived from token state + token name/symbol so they
 * never change randomly and persist across reloads.
 */

import type { MapRegion } from '$lib/types';
import type { CastleTier, LifePhase } from '$lib/types';

export interface RegionNames {
  /** The castle / stronghold name, e.g. "Stonekeep" */
  castleName: string;
  /** The district / area name, e.g. "Ward of Embers" */
  districtName: string;
  /** Short lore tag (optional flavor), e.g. "Where the gold still gleams" */
  loreTag: string;
}

// ── Castle name prefixes by tier ──
const TIER_PREFIXES: Record<CastleTier, string[]> = {
  keep:     ['Stone', 'Wood', 'Mud', 'Thorn', 'Ash'],
  castle:   ['Iron', 'Oak', 'Grey', 'Ember', 'Storm'],
  fortress: ['High', 'Grand', 'Silver', 'Crown', 'Steel'],
  citadel:  ['Golden', 'Ancient', 'Radiant', 'Eternal', 'Celestial'],
};

// ── Castle name suffixes by tier ──
const TIER_SUFFIXES: Record<CastleTier, string[]> = {
  keep:     ['keep', 'hold', 'watch', 'hovel', 'hut'],
  castle:   ['castle', 'hall', 'tower', 'fort', 'bastion'],
  fortress: ['fortress', 'stronghold', 'citadel', 'bulwark', 'spire'],
  citadel:  ['citadel', 'palace', 'sanctum', 'dominion', 'throne'],
};

// ── District names by phase ──
const PHASE_DISTRICTS: Record<LifePhase, string[]> = {
  construction: ['Scaffold Yard', 'Foundation Quarter', 'Builder\'s Row', 'Timber Ward', 'New Works'],
  graduated:    ['Bastion Rise', 'Herald\'s Ward', 'Gatehouse Quarter', 'Banner Row', 'Covenant Way'],
  thriving:     ['Golden Ward', 'Market Square', 'Flourishing Row', 'Silk Quarter', 'Crown Gate'],
  declining:    ['Fading Quarter', 'Dusk Row', 'Hollow Ward', 'Waning Gate', 'Rust Alley'],
  dormant:      ['Silent Quarter', 'Dust Row', 'Forgotten Ward', 'Grey Gate', 'Still Alley'],
  zombie:       ['Zombie Quarter', 'Dead Row', 'Hollow Gate', 'Rot Ward', 'Bone Alley'],
  cursed:       ['Cursed Ward', 'Hex Row', 'Shadow Gate', 'Doom Quarter', 'Wither Alley'],
};

// ── Lore tags by phase ──
const PHASE_LORE: Record<LifePhase, string[]> = {
  construction: [
    'Foundations freshly laid',
    'The hammers still ring',
    'A kingdom in the making',
    'Mortar yet to dry',
    'Where dreams take stone form',
  ],
  graduated:    [
    'Newly crowned in glory',
    'The banners have risen',
    'Born from the bonding curve',
    'A realm christened',
    'The gates stand open',
  ],
  thriving:     [
    'Where gold still gleams',
    'Trade winds blow strong',
    'Prosperity reigns within',
    'The coffers overflow',
    'A beacon in the realm',
  ],
  declining:    [
    'Glory fading like dusk',
    'The banners hang low',
    'Once great, now waning',
    'Shadows creep inward',
    'The old songs grow quiet',
  ],
  dormant:      [
    'All is still here',
    'The watchers have left',
    'Silence upon the walls',
    'A kingdom in slumber',
    'No torch burns tonight',
  ],
  zombie:       [
    'The dead walk these halls',
    'Forsaken by the living',
    'Only echoes remain',
    'Ruins of old pump',
    'None dare enter',
  ],
  cursed:       [
    'Hexed beyond redemption',
    'A darkness dwells within',
    'The land itself recoils',
    'Cursed by the old rug',
    'Beware the purple fog',
  ],
};

// ── Legendary overrides ──
const LEGENDARY_PREFIXES = ['Mythic', 'Sovereign', 'Exalted', 'Immortal', 'Legendary'];
const LEGENDARY_SUFFIXES = ['Throne', 'Crown', 'Sanctum', 'Apex', 'Pinnacle'];
const LEGENDARY_DISTRICTS = ['Hall of Legends', 'Sovereign Rise', 'The Gilded Court', 'Eternal Quarter', 'Mythic Heights'];
const LEGENDARY_LORE = [
  'Where legends never fade',
  'Touched by ancient glory',
  'A name etched in eternity',
  'The realm bows in reverence',
  'Gold runs through its veins',
];

/**
 * Simple deterministic hash from a string → number.
 * Used to pick from word arrays based on token identity.
 */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Pick from an array deterministically based on token address */
function pick<T>(arr: T[], hash: number, offset: number = 0): T {
  return arr[((hash >>> offset) + offset) % arr.length];
}

/**
 * Generate deterministic fantasy names for a map region.
 * Names are fully derived from the token address + current state,
 * so they persist across reloads and never change randomly.
 */
export function getRegionNames(region: MapRegion): RegionNames {
  const h = hashStr(region.id);

  if (region.isLegendary) {
    return {
      castleName: `${pick(LEGENDARY_PREFIXES, h, 0)} ${pick(LEGENDARY_SUFFIXES, h, 3)}`,
      districtName: pick(LEGENDARY_DISTRICTS, h, 5),
      loreTag: pick(LEGENDARY_LORE, h, 7),
    };
  }

  const prefix = pick(TIER_PREFIXES[region.tier], h, 0);
  const suffix = pick(TIER_SUFFIXES[region.tier], h, 3);
  const castleName = `${prefix}${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}`;

  const districtName = pick(PHASE_DISTRICTS[region.phase], h, 5);
  const loreTag = pick(PHASE_LORE[region.phase], h, 7);

  return { castleName, districtName, loreTag };
}
