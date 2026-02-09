/**
 * Token API endpoint
 *
 * GET /api/token?address=<token_address>
 *
 * Returns mocked token data for development.
 * In production, this would fetch from Pump.fun or other APIs.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { TokenData } from '$lib/types';

// Mock token database with different scenarios
const mockTokens: Record<string, Partial<TokenData>> = {
  // Pre-graduation token (under construction)
  'pregrad123456789012345678901234567890123456': {
    name: 'BuilderCoin',
    symbol: 'BUILD',
    marketCap: 500_000,
    athMarketCap: 600_000,
    priceChange24h: 5,
    volume24h: 50_000,
    previousVolume24h: 40_000,
    holders: 500,
    liquidity: 100_000,
    isGraduated: false,
    graduatedAt: null,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2, // 2 days ago
    lastTradeTimestamp: Date.now() - 1000 * 60 * 5 // 5 min ago
  },

  // Just graduated token (celebration!)
  'justgrad12345678901234567890123456789012345': {
    name: 'GradToken',
    symbol: 'GRAD',
    marketCap: 2_000_000,
    athMarketCap: 2_500_000,
    priceChange24h: 25,
    volume24h: 500_000,
    previousVolume24h: 200_000,
    holders: 2000,
    liquidity: 500_000,
    isGraduated: true,
    graduatedAt: Date.now() - 1000 * 60 * 2, // 2 min ago (triggers celebration)
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
    lastTradeTimestamp: Date.now() - 1000 * 30
  },

  // Thriving castle
  'thriving1234567890123456789012345678901234': {
    name: 'MoonCastle',
    symbol: 'MOON',
    marketCap: 15_000_000,
    athMarketCap: 18_000_000,
    priceChange24h: 8,
    volume24h: 2_000_000,
    previousVolume24h: 1_500_000,
    holders: 10000,
    liquidity: 3_000_000,
    isGraduated: true,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 60,
    lastTradeTimestamp: Date.now() - 1000 * 60
  },

  // Decaying fortress (was big, now fallen)
  'decayed12345678901234567890123456789012345': {
    name: 'FallenKing',
    symbol: 'FALL',
    marketCap: 3_000_000,
    athMarketCap: 50_000_000,
    priceChange24h: -15,
    volume24h: 100_000,
    previousVolume24h: 500_000,
    holders: 5000,
    liquidity: 800_000,
    isGraduated: true,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 180,
    lastTradeTimestamp: Date.now() - 1000 * 60 * 60 * 2
  },

  // Zombie token (no recent trades)
  'zombie123456789012345678901234567890123456': {
    name: 'DeadCoin',
    symbol: 'DEAD',
    marketCap: 100_000,
    athMarketCap: 5_000_000,
    priceChange24h: 0,
    volume24h: 0,
    previousVolume24h: 1000,
    holders: 1000,
    liquidity: 50_000,
    isGraduated: true,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 120,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 200,
    lastTradeTimestamp: Date.now() - 1000 * 60 * 60 * 12 // 12 hours ago
  },

  // Legendary citadel (100M+ ATH)
  'legend123456789012345678901234567890123456': {
    name: 'DragonCoin',
    symbol: 'DRAG',
    marketCap: 80_000_000,
    athMarketCap: 150_000_000,
    priceChange24h: -5,
    volume24h: 10_000_000,
    previousVolume24h: 12_000_000,
    holders: 50000,
    liquidity: 20_000_000,
    isGraduated: true,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 60,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
    lastTradeTimestamp: Date.now() - 1000 * 60 * 2
  },

  // Cursed token (repeated dumps, very bad state)
  'cursed123456789012345678901234567890123456': {
    name: 'CursedRealm',
    symbol: 'CURSE',
    marketCap: 50_000,
    athMarketCap: 10_000_000,
    priceChange24h: -45,
    volume24h: 5_000,
    previousVolume24h: 50_000,
    holders: 500,
    liquidity: 20_000,
    isGraduated: true,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 150,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 180,
    lastTradeTimestamp: Date.now() - 1000 * 60 * 30
  },

  // Fallen legendary (was 100M+, now ruined)
  'fallen123456789012345678901234567890123456': {
    name: 'StoneWyrm',
    symbol: 'WYRM',
    marketCap: 500_000,
    athMarketCap: 120_000_000,
    priceChange24h: -20,
    volume24h: 10_000,
    previousVolume24h: 100_000,
    holders: 2000,
    liquidity: 150_000,
    isGraduated: true,
    graduatedAt: Date.now() - 1000 * 60 * 60 * 24 * 200,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 250,
    lastTradeTimestamp: Date.now() - 1000 * 60 * 60 * 4
  }
};

/**
 * Generate dynamic mock data for unknown addresses
 */
function generateMockData(address: string): TokenData {
  // Use address to seed consistent random values
  const seed = address.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const random = (min: number, max: number) => {
    const x = Math.sin(seed * 9999) * 10000;
    return min + (x - Math.floor(x)) * (max - min);
  };

  const isGraduated = random(0, 1) > 0.3;
  const athMarketCap = Math.floor(random(100_000, 50_000_000));
  const marketCap = Math.floor(athMarketCap * random(0.1, 1));
  const volume24h = Math.floor(random(1000, marketCap * 0.1));

  return {
    address,
    name: `Token${address.slice(0, 4)}`,
    symbol: address.slice(0, 4).toUpperCase(),
    marketCap,
    athMarketCap,
    priceChange24h: random(-30, 30),
    volume24h,
    previousVolume24h: Math.floor(volume24h * random(0.5, 2)),
    holders: Math.floor(random(100, 10000)),
    liquidity: Math.floor(marketCap * random(0.1, 0.3)),
    isGraduated,
    graduatedAt: isGraduated ? Date.now() - random(1000 * 60 * 60, 1000 * 60 * 60 * 24 * 30) : null,
    createdAt: Date.now() - random(1000 * 60 * 60 * 24, 1000 * 60 * 60 * 24 * 100),
    lastTradeTimestamp: Date.now() - random(1000 * 60, 1000 * 60 * 60 * 10)
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

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300));

  // Check for known mock tokens
  const mockData = mockTokens[address];

  if (mockData) {
    const tokenData: TokenData = {
      address,
      name: mockData.name || 'Unknown Token',
      symbol: mockData.symbol || 'UNK',
      marketCap: mockData.marketCap || 0,
      athMarketCap: mockData.athMarketCap || 0,
      priceChange24h: mockData.priceChange24h || 0,
      volume24h: mockData.volume24h || 0,
      previousVolume24h: mockData.previousVolume24h || 0,
      lastTradeTimestamp: mockData.lastTradeTimestamp || Date.now(),
      holders: mockData.holders || 0,
      liquidity: mockData.liquidity || 0,
      createdAt: mockData.createdAt || Date.now(),
      isGraduated: mockData.isGraduated || false,
      graduatedAt: mockData.graduatedAt || null
    };

    return json(tokenData);
  }

  // Generate mock data for unknown addresses
  const generatedData = generateMockData(address);
  return json(generatedData);
};
