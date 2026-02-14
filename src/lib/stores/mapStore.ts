/**
 * mapStore.ts
 *
 * Multi-token store for the world map view.
 * Fetches top pump.fun tokens via the discover API and derives MapRegion data.
 * Supports adding new tokens dynamically (from search).
 */

import { writable, derived, type Readable } from 'svelte/store';
import type { TokenData, WorldState, MapRegion } from '$lib/types';
import { computeWorldState } from '$lib/state/CastleState';
import { fetchTokenData } from './tokenStore';

interface TokenEntry {
  token: TokenData;
  state: WorldState;
}

// All tracked addresses (discovered + user-added)
export const trackedAddresses = writable<string[]>([]);

export const allTokens = writable<Map<string, TokenEntry>>(new Map());
export const mapLoading = writable<boolean>(false);

/**
 * Fetch top pump.fun tokens from the discover endpoint.
 * Returns up to 200 tokens sorted by market cap.
 */
async function discoverTokens(): Promise<TokenEntry[]> {
  const entries: TokenEntry[] = [];

  try {
    const response = await fetch('/api/tokens/discover?limit=200');

    if (response.ok) {
      const data = await response.json();
      for (const token of data.tokens) {
        entries.push({
          token,
          state: computeWorldState(token),
        });
      }
    }
  } catch (err) {
    console.error('[MapStore] Discover fetch failed:', err);
  }

  return entries;
}

/**
 * Fetch tokens via the batch endpoint (for user-added addresses).
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

// Track whether initial discovery has been completed to avoid redundant API calls
let tokensLoaded = false;

/** Fetch all tokens: discover top pump.fun tokens + any user-added ones */
export async function loadAllTokens(): Promise<void> {
  // Skip if tokens are already loaded — the store persists across view transitions
  if (tokensLoaded) return;

  mapLoading.set(true);
  try {
    // 1. Discover top pump.fun tokens sorted by market cap
    const discovered = await discoverTokens();
    const tokenMap = new Map<string, TokenEntry>();

    // Add all discovered tokens
    const discoveredAddresses: string[] = [];
    for (const entry of discovered) {
      tokenMap.set(entry.token.address, entry);
      discoveredAddresses.push(entry.token.address);
    }

    // Update tracked addresses with discovered ones
    trackedAddresses.set(discoveredAddresses);

    // 2. Fetch any user-added addresses not already in the discovered set
    let currentAddresses: string[] = [];
    trackedAddresses.subscribe(v => { currentAddresses = v; })();

    const extraAddresses = currentAddresses.filter(a => !tokenMap.has(a));
    if (extraAddresses.length > 0) {
      const extraEntries = await batchFetchTokens(extraAddresses);
      for (const [addr, entry] of extraEntries) {
        tokenMap.set(addr, entry);
      }
    }

    allTokens.set(tokenMap);

    // Mark as loaded only if we got actual results
    if (tokenMap.size > 0) {
      tokensLoaded = true;
    }
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
