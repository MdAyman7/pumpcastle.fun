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
  hut:        ['Mud', 'Straw', 'Clay', 'Moss', 'Bramble'],
  cottage:    ['Wood', 'Thorn', 'Ash', 'Reed', 'Pine'],
  tower:      ['Stone', 'Flint', 'Grey', 'Pale', 'Iron'],
  keep:       ['Iron', 'Oak', 'Ember', 'Dark', 'Storm'],
  manor:      ['Marble', 'Copper', 'Sage', 'Dusk', 'Vine'],
  castle:     ['Iron', 'Oak', 'Grey', 'Ember', 'Storm'],
  stronghold: ['Steel', 'Flame', 'Basalt', 'War', 'Thunder'],
  fortress:   ['High', 'Grand', 'Silver', 'Crown', 'Steel'],
  palace:     ['Pearl', 'Rose', 'Ivory', 'Silk', 'Crystal'],
  citadel:    ['Golden', 'Ancient', 'Radiant', 'Eternal', 'Celestial'],
  empire:     ['Sovereign', 'Imperial', 'Ascendant', 'Supreme', 'Arcane'],
  legend:     ['Mythic', 'Divine', 'Transcendent', 'Immortal', 'Legendary'],
};

// ── Castle name suffixes by tier ──
const TIER_SUFFIXES: Record<CastleTier, string[]> = {
  hut:        ['hut', 'hovel', 'shack', 'den', 'burrow'],
  cottage:    ['cottage', 'lodge', 'croft', 'hearth', 'cabin'],
  tower:      ['tower', 'spire', 'watch', 'beacon', 'pillar'],
  keep:       ['keep', 'hold', 'watch', 'guard', 'redoubt'],
  manor:      ['manor', 'estate', 'grange', 'villa', 'court'],
  castle:     ['castle', 'hall', 'tower', 'fort', 'bastion'],
  stronghold: ['stronghold', 'bulwark', 'rampart', 'ward', 'garrison'],
  fortress:   ['fortress', 'citadel', 'bulwark', 'spire', 'bastion'],
  palace:     ['palace', 'court', 'pavilion', 'hall', 'gallery'],
  citadel:    ['citadel', 'sanctum', 'dominion', 'throne', 'summit'],
  empire:     ['empire', 'dominion', 'realm', 'sovereignty', 'hegemony'],
  legend:     ['throne', 'crown', 'sanctum', 'apex', 'pinnacle'],
};

// ── District names by phase ──
const PHASE_DISTRICTS: Record<LifePhase, string[]> = {
  construction: ['Scaffold Yard', 'Foundation Quarter', 'Builder\'s Row', 'Timber Ward', 'New Works'],
  graduated:    ['Bastion Rise', 'Herald\'s Ward', 'Gatehouse Quarter', 'Banner Row', 'Covenant Way'],
  thriving:     ['Golden Ward', 'Market Square', 'Flourishing Row', 'Silk Quarter', 'Crown Gate'],
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
