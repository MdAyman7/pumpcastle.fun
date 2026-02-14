/**
 * tokenStore.ts
 *
 * Svelte store for managing token data with polling support.
 */

import { writable, derived, type Readable } from 'svelte/store';
import type { TokenData, WorldState } from '$lib/types';
import { computeWorldState } from '$lib/state/CastleState';

// Store for token data
export const tokenData = writable<TokenData | null>(null);

// Store for loading state
export const isLoading = writable<boolean>(false);

// Store for error state
export const error = writable<string | null>(null);

// Store for current token address
export const tokenAddress = writable<string>('');

// Derived store for world state
export const worldState: Readable<WorldState | null> = derived(
  tokenData,
  ($tokenData) => $tokenData ? computeWorldState($tokenData) : null
);

// Polling interval ID
let pollingInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Fetch token data from API.
 * @param trusted - If true, skip pump.fun validation (token is already known to be pump.fun)
 */
export async function fetchTokenData(address: string, trusted = false): Promise<TokenData> {
  const params = new URLSearchParams({ address });
  if (trusted) params.set('trusted', '1');

  const response = await fetch(`/api/token?${params}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Failed to fetch token data' }));
    throw new Error(errorData.message || 'Failed to fetch token data');
  }

  return response.json();
}

/**
 * Load token data for a given address.
 * Returns true if the token loaded successfully, false otherwise.
 * @param trusted - If true, skip pump.fun validation server-side.
 */
export async function loadToken(address: string, trusted = false): Promise<boolean> {
  if (!address || address.length < 32) {
    error.set('Please enter a valid Solana pump.fun token address');
    return false;
  }

  // Client-side Solana base58 format check
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    error.set('Invalid address format. PumpCastle only supports Solana pump.fun tokens.');
    return false;
  }

  // Stop any existing polling
  stopPolling();

  isLoading.set(true);
  error.set(null);
  tokenAddress.set(address);

  try {
    const data = await fetchTokenData(address, trusted);
    tokenData.set(data);

    // Start polling for updates (polling always trusted — token already validated)
    startPolling(address);
    return true;
  } catch (e) {
    error.set(e instanceof Error ? e.message : 'Unknown error occurred');
    tokenData.set(null);
    return false;
  } finally {
    isLoading.set(false);
  }
}

/**
 * Start polling for token updates
 */
export function startPolling(address: string, intervalMs: number = 60000): void {
  stopPolling();

  pollingInterval = setInterval(async () => {
    try {
      const data = await fetchTokenData(address, true);
      tokenData.set(data);
    } catch (e) {
      console.error('Polling error:', e);
      // Don't set error on polling failures, just log
    }
  }, intervalMs);
}

/**
 * Stop polling
 */
export function stopPolling(): void {
  if (pollingInterval !== null) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/**
 * Reset store state
 */
export function resetStore(): void {
  stopPolling();
  tokenData.set(null);
  isLoading.set(false);
  error.set(null);
  tokenAddress.set('');
}
