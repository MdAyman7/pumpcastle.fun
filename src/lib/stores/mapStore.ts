/**
 * mapStore.ts
 *
 * Multi-token store for the world map view.
 * Fetches real tokens via the batch API and derives MapRegion data.
 * Supports adding new tokens dynamically (from search).
 */

import { writable, derived, type Readable } from 'svelte/store';
import type { TokenData, WorldState, MapRegion } from '$lib/types';
import { computeWorldState } from '$lib/state/CastleState';
import { fetchTokenData } from './tokenStore';

// Default real Solana token addresses for the map
const DEFAULT_ADDRESSES = [
  '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',  // Fartcoin
  'Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump',
  '9PR7nCP9DpcUotnDPVLUBUZKu5WAYkwrCUx9wDnSpump',
  'a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump',
  '61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump',
  'HNg5PYJmtqcmzXrv6S9zP1CDKk5BgDuyFBxbvNApump',
];

interface TokenEntry {
  token: TokenData;
  state: WorldState;
}

// All tracked addresses (default + user-added)
export const trackedAddresses = writable<string[]>([...DEFAULT_ADDRESSES]);

export const allTokens = writable<Map<string, TokenEntry>>(new Map());
export const mapLoading = writable<boolean>(false);

/**
 * Fetch tokens via the batch endpoint.
 * Falls back to individual fetches if the batch fails.
 */
async function batchFetchTokens(addresses: string[]): Promise<Map<string, TokenEntry>> {
  const entries = new Map<string, TokenEntry>();

  try {
    const response = await fetch('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses }),
    });

    if (response.ok) {
      const data = await response.json();
      for (const token of data.tokens) {
        entries.set(token.address, {
          token,
          state: computeWorldState(token),
        });
      }
      return entries;
    }
  } catch {
    // Batch failed, fall through to individual fetches
  }

  // Fallback: fetch individually
  const results = await Promise.allSettled(
    addresses.map(addr => fetchTokenData(addr))
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const token = result.value;
      entries.set(token.address, {
        token,
        state: computeWorldState(token),
      });
    }
  }

  return entries;
}

/** Fetch all tracked tokens */
export async function loadAllTokens(): Promise<void> {
  mapLoading.set(true);
  try {
    let currentAddresses: string[] = [];
    trackedAddresses.subscribe(v => { currentAddresses = v; })();

    const entries = await batchFetchTokens(currentAddresses);
    allTokens.set(entries);
  } finally {
    mapLoading.set(false);
  }
}


/**
 * Add a new token address to the map.
 * If it's not already tracked, adds it and fetches its data.
 */
export async function addTokenToMap(address: string): Promise<void> {
  let currentAddresses: string[] = [];
  trackedAddresses.subscribe(v => { currentAddresses = v; })();

  if (currentAddresses.includes(address)) return;

  // Add to tracked list
  trackedAddresses.update(addrs => [...addrs, address]);

  // Fetch just this one token and merge into the map
  try {
    const token = await fetchTokenData(address);
    allTokens.update(map => {
      const newMap = new Map(map);
      newMap.set(token.address, {
        token,
        state: computeWorldState(token),
      });
      return newMap;
    });
  } catch {
    // If fetch fails, remove from tracked list
    trackedAddresses.update(addrs => addrs.filter(a => a !== address));
  }
}

/** Compute importance score 0–1 from state. Drives placement ring and region size. */
function computeImportance(state: WorldState): number {
  const tierScores: Record<string, number> = {
    hut: 0.05, cottage: 0.08, tower: 0.1, keep: 0.15, manor: 0.2,
    castle: 0.3, stronghold: 0.4, fortress: 0.55, palace: 0.65,
    citadel: 0.75, empire: 0.85, legend: 0.95,
  };
  let score = tierScores[state.tier] ?? 0.1;

  if (state.isLegendary) score += 0.2;
  if (state.phase === 'thriving') score += 0.05;

  return Math.max(0, Math.min(1, score));
}

/** Derived: MapRegion array computed from allTokens */
export const mapRegions: Readable<MapRegion[]> = derived(
  allTokens,
  ($allTokens) => {
    const regions: MapRegion[] = [];
    for (const [id, entry] of $allTokens) {
      regions.push({
        id,
        name: entry.token.name,
        symbol: entry.token.symbol,
        tier: entry.state.tier,
        phase: entry.state.phase,
        isLegendary: entry.state.isLegendary,
        marketCap: entry.state.marketCap,
        athMarketCap: entry.state.athMarketCap,
        decay: entry.state.decay,
        constructionProgress: entry.state.constructionProgress,
        importance: computeImportance(entry.state),
        imageUrl: entry.token.imageUrl,
      });
    }
    return regions;
  }
);
