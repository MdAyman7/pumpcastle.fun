/**
 * Batch token API endpoint
 *
 * POST /api/tokens
 * Body: { addresses: string[] }
 *
 * Fetches multiple tokens from Codex API in a batch.
 * Returns an array of TokenData for successfully fetched tokens.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchCodexTokens } from '$lib/server/codex';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);

  if (!body?.addresses || !Array.isArray(body.addresses)) {
    throw error(400, { message: 'Request body must contain an "addresses" array' });
  }

  // Only accept valid Solana addresses (base58, 32-44 chars)
  const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const addresses: string[] = body.addresses.filter(
    (a: unknown) => typeof a === 'string' && solanaAddressRegex.test(a as string)
  );

  if (addresses.length === 0) {
    throw error(400, { message: 'No valid Solana addresses provided. PumpCastle only supports pump.fun tokens.' });
  }

  if (addresses.length > 20) {
    throw error(400, { message: 'Maximum 20 addresses per request' });
  }

  try {
    const results = await fetchCodexTokens(addresses);
    // Return as array (order matches input where available)
    const tokens = addresses
      .map(addr => results.get(addr))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);

    return json({ tokens });
  } catch (e) {
    console.error('[API] Batch fetch error:', e);
    throw error(502, { message: 'Failed to fetch token data' });
  }
};
