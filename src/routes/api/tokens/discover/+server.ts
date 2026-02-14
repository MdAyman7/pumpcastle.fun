/**
 * Discover API endpoint
 *
 * GET /api/tokens/discover?limit=200
 *
 * Fetches top pump.fun tokens on Solana sorted by market cap.
 * Used by the map view to populate the world with token castles.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchTopPumpFunTokens } from '$lib/server/codex';

export const GET: RequestHandler = async ({ url }) => {
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(limitParam ?? '200', 10) || 200, 1), 200);

  try {
    const tokens = await fetchTopPumpFunTokens(limit);

    if (tokens.length === 0) {
      throw error(502, { message: 'Failed to fetch tokens from Codex API. Please try again.' });
    }

    return json({ tokens, count: tokens.length });
  } catch (e: any) {
    if (e?.status) throw e;
    console.error('[API] Discover fetch error:', e);
    throw error(502, { message: 'Failed to discover tokens. Please try again.' });
  }
};
