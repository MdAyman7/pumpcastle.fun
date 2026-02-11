/**
 * Token API endpoint
 *
 * GET /api/token?address=<token_address>
 *
 * Fetches real token data from Codex API (Solana tokens).
 * Falls back to mock data for known test addresses.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { TokenData } from '$lib/types';
import { fetchCodexToken } from '$lib/server/codex';

// Mock token database for development/testing (known test addresses)
const mockTokens: Record<string, Partial<TokenData>> = {
  'pregrad123456789012345678901234567890123456': {
    name: 'BuilderCoin', symbol: 'BUILD', marketCap: 500_000, athMarketCap: 600_000,
    priceChange24h: 5, volume24h: 50_000, previousVolume24h: 40_000, holders: 500,
    liquidity: 100_000, isGraduated: false, graduatedAt: null,
    txnCount24: 120, uniqueTransactions24: 45,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    lastTradeTimestamp: Date.now() - 1000 * 60 * 5
  },
  'justgrad12345678901234567890123456789012345': {
    name: 'GradToken', symbol: 'GRAD', marketCap: 2_000_000, athMarketCap: 2_500_000,
    priceChange24h: 25, volume24h: 500_000, previousVolume24h: 200_000, holders: 2000,
    liquidity: 500_000, isGraduated: true,
    txnCount24: 2500, uniqueTransactions24: 800,
    graduatedAt: Date.now() - 1000 * 60 * 2,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
    lastTradeTimestamp: Date.now() - 1000 * 30
  },
  'thriving1234567890123456789012345678901234': {
    name: 'MoonCastle', symbol: 'MOON', marketCap: 15_000_000, athMarketCap: 18_000_000,
    priceChange24h: 8, volume24h: 2_000_000, previousVolume24h: 1_500_000, holders: 10000,
    liquidity: 3_000_000, isGraduated: true,
    txnCount24: 15_000, uniqueTransactions24: 4000,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 60,
    lastTradeTimestamp: Date.now() - 1000 * 60,
    exchanges: [
      { name: 'Raydium', tier: 'dex' },
      { name: 'Jupiter', tier: 'dex' },
      { name: 'MEXC', tier: 'cex_small' }
    ]
  },
  'decayed12345678901234567890123456789012345': {
    name: 'FallenKing', symbol: 'FALL', marketCap: 3_000_000, athMarketCap: 50_000_000,
    priceChange24h: -15, volume24h: 100_000, previousVolume24h: 500_000, holders: 5000,
    liquidity: 800_000, isGraduated: true,
    txnCount24: 200, uniqueTransactions24: 60,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 180,
    lastTradeTimestamp: Date.now() - 1000 * 60 * 60 * 2,
    exchanges: [
      { name: 'MEXC', tier: 'cex_small' },
      { name: 'Raydium', tier: 'dex' },
      { name: 'Jupiter', tier: 'dex' }
    ]
  },
  'zombie123456789012345678901234567890123456': {
    name: 'DeadCoin', symbol: 'DEAD', marketCap: 100_000, athMarketCap: 5_000_000,
    priceChange24h: 0, volume24h: 0, previousVolume24h: 1000, holders: 1000,
    liquidity: 50_000, isGraduated: true,
    txnCount24: 0, uniqueTransactions24: 0,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 120,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 200,
    lastTradeTimestamp: Date.now() - 1000 * 60 * 60 * 12
  },
  'legend123456789012345678901234567890123456': {
    name: 'LegendCoin', symbol: 'LEGEND', marketCap: 80_000_000, athMarketCap: 150_000_000,
    priceChange24h: -5, volume24h: 10_000_000, previousVolume24h: 12_000_000, holders: 50000,
    liquidity: 20_000_000, isGraduated: true,
    txnCount24: 50_000, uniqueTransactions24: 12_000,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 60,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
    lastTradeTimestamp: Date.now() - 1000 * 60 * 2,
    exchanges: [
      { name: 'Binance', tier: 'cex_major' },
      { name: 'Coinbase', tier: 'cex_major' },
      { name: 'Bybit', tier: 'cex_small' },
      { name: 'MEXC', tier: 'cex_small' },
      { name: 'Raydium', tier: 'dex' },
      { name: 'Jupiter', tier: 'dex' },
      { name: 'Orca', tier: 'dex' }
    ]
  },
  'cottage1234567890123456789012345678901234': {
    name: 'HumbleCoin', symbol: 'HMBL', marketCap: 150_000, athMarketCap: 180_000,
    priceChange24h: 3, volume24h: 8_000, previousVolume24h: 6_000, holders: 300,
    liquidity: 40_000, isGraduated: true,
    txnCount24: 80, uniqueTransactions24: 30,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 10,
    lastTradeTimestamp: Date.now() - 1000 * 60 * 10
  },
  'palace12345678901234567890123456789012345': {
    name: 'RoseGold', symbol: 'ROSE', marketCap: 60_000_000, athMarketCap: 75_000_000,
    priceChange24h: 12, volume24h: 5_000_000, previousVolume24h: 3_000_000, holders: 25000,
    liquidity: 12_000_000, isGraduated: true,
    txnCount24: 30_000, uniqueTransactions24: 8000,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 45,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 70,
    lastTradeTimestamp: Date.now() - 1000 * 60,
    exchanges: [
      { name: 'Binance', tier: 'cex_major' },
      { name: 'Raydium', tier: 'dex' },
      { name: 'Jupiter', tier: 'dex' }
    ]
  },
  'empire12345678901234567890123456789012345': {
    name: 'SovereignDAO', symbol: 'SOV', marketCap: 600_000_000, athMarketCap: 800_000_000,
    priceChange24h: -3, volume24h: 30_000_000, previousVolume24h: 35_000_000, holders: 100000,
    liquidity: 80_000_000, isGraduated: true,
    txnCount24: 100_000, uniqueTransactions24: 25_000,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 150,
    lastTradeTimestamp: Date.now() - 1000 * 30,
    exchanges: [
      { name: 'Binance', tier: 'cex_major' },
      { name: 'Coinbase', tier: 'cex_major' },
      { name: 'Bybit', tier: 'cex_small' },
      { name: 'Raydium', tier: 'dex' },
      { name: 'Jupiter', tier: 'dex' }
    ]
  }
};

/**
 * Check if an address looks like a real Solana address (base58, ends with "pump" for pump.fun tokens, etc.)
 */
function isRealSolanaAddress(address: string): boolean {
  // Real Solana addresses are 32-44 characters of base58
  // Our mock addresses are longer and use obvious patterns
  if (mockTokens[address]) return false;
  // Base58 charset check (no 0, O, I, l)
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function buildMockTokenData(address: string, mock: Partial<TokenData>): TokenData {
  return {
    address,
    name: mock.name || 'Unknown Token',
    symbol: mock.symbol || 'UNK',
    imageUrl: mock.imageUrl,
    marketCap: mock.marketCap || 0,
    athMarketCap: mock.athMarketCap || 0,
    priceChange24h: mock.priceChange24h || 0,
    volume24h: mock.volume24h || 0,
    previousVolume24h: mock.previousVolume24h || 0,
    txnCount24: mock.txnCount24 || 0,
    uniqueTransactions24: mock.uniqueTransactions24 || 0,
    lastTradeTimestamp: mock.lastTradeTimestamp || Date.now(),
    holders: mock.holders || 0,
    liquidity: mock.liquidity || 0,
    createdAt: mock.createdAt || Date.now(),
    isGraduated: mock.isGraduated || false,
    graduatedAt: mock.graduatedAt || null,
    exchanges: mock.exchanges,
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const address = url.searchParams.get('address');

  if (!address) {
    throw error(400, { message: 'Token address is required' });
  }

  if (address.length < 32) {
    throw error(400, { message: 'Invalid token address format' });
  }

  // 1. Check for known mock tokens (development presets)
  const mockData = mockTokens[address];
  if (mockData) {
    // Simulate a small delay for consistency
    await new Promise(resolve => setTimeout(resolve, 100));
    return json(buildMockTokenData(address, mockData));
  }

  // 2. For real Solana addresses, fetch from Codex API
  if (isRealSolanaAddress(address)) {
    try {
      const tokenData = await fetchCodexToken(address);
      if (tokenData) {
        return json(tokenData);
      }
      // Token not found in Codex
      throw error(404, { message: 'Token not found. Make sure this is a valid Solana token address.' });
    } catch (e: any) {
      // If it's already an HTTP error from SvelteKit, re-throw
      if (e?.status) throw e;
      console.error('[API] Codex fetch error:', e);
      throw error(502, { message: 'Failed to fetch token data from the API. Please try again.' });
    }
  }

  // 3. Unknown non-real address format — return 404
  throw error(404, { message: 'Token not found' });
};
