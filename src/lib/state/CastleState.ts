import type { TokenData, CastleTier, WorldState, LifePhase } from '$lib/types';
import { computeDecay } from './DecayState';
import { computeActivity, type ActivityResult } from './ActivityState';
import { computeGraduation, type GraduationResult } from './GraduationState';

// Market cap thresholds for castle tiers (in USD)
const TIER_THRESHOLDS = {
  keep: 0,           // < 1M
  castle: 1_000_000, // 1M - 10M
  fortress: 10_000_000, // 10M - 100M
  citadel: 100_000_000  // > 100M (legendary)
};

const LEGENDARY_THRESHOLD = 100_000_000;

/**
 * Determine castle tier based on ATH market cap.
 * Once a tier is reached, structure remains forever.
 */
export function computeTier(athMarketCap: number): CastleTier {
  if (athMarketCap >= TIER_THRESHOLDS.citadel) return 'citadel';
  if (athMarketCap >= TIER_THRESHOLDS.fortress) return 'fortress';
  if (athMarketCap >= TIER_THRESHOLDS.castle) return 'castle';
  return 'keep';
}

/**
 * Determine if token is legendary (ever crossed 100M)
 */
export function isLegendary(athMarketCap: number): boolean {
  return athMarketCap >= LEGENDARY_THRESHOLD;
}

/**
 * Determine the life phase based on all factors
 */
export function computePhase(
  graduation: GraduationResult,
  activity: ActivityResult,
  decay: number,
  priceChange24h: number
): LifePhase {
  // Pre-graduation is always construction
  if (!graduation.hasGraduated) {
    return 'construction';
  }

  // Show graduation celebration
  if (graduation.showCelebration) {
    return 'graduated';
  }

  // Zombie state (no trades)
  if (activity.isZombie) {
    return 'zombie';
  }

  // Cursed state (repeated dumps)
  if (priceChange24h < -30 && decay > 0.8) {
    return 'cursed';
  }

  // Declining (significant decay)
  if (decay > 0.5) {
    return 'declining';
  }

  // Dormant (low activity but not zombie)
  if (activity.level === 'dying' || activity.level === 'dead') {
    return 'dormant';
  }

  // Thriving (everything is good)
  return 'thriving';
}

/**
 * Compute complete world state from token data.
 * This is the main entry point for state computation.
 */
export function computeWorldState(
  tokenData: TokenData,
  previousState: WorldState | null = null
): WorldState {
  const now = Date.now();

  // Compute sub-states
  const decay = computeDecay(tokenData.marketCap, tokenData.athMarketCap);
  const activity = computeActivity(tokenData);
  const graduation = computeGraduation(tokenData, previousState);

  // Compute tier (based on ATH, never decreases)
  const tier = computeTier(tokenData.athMarketCap);

  // Compute phase
  const phase = computePhase(graduation, activity, decay, tokenData.priceChange24h);

  // Time calculations
  const hoursSinceLastTrade = (now - tokenData.lastTradeTimestamp) / (1000 * 60 * 60);
  const tokenAgeHours = (now - tokenData.createdAt) / (1000 * 60 * 60);

  // Construction progress for pre-graduation (based on market cap growth)
  const constructionProgress = tokenData.isGraduated
    ? 1
    : Math.min(1, tokenData.marketCap / TIER_THRESHOLDS.castle);

  return {
    tier,
    phase,
    activityLevel: activity.level,

    decay,
    volumeRatio: activity.volumeRatio,
    constructionProgress,

    isLegendary: isLegendary(tokenData.athMarketCap),
    hasGraduated: graduation.hasGraduated,
    showGraduationCelebration: graduation.showCelebration,
    isZombie: activity.isZombie,
    isCursed: phase === 'cursed',

    hoursSinceLastTrade,
    tokenAgeHours,

    marketCap: tokenData.marketCap,
    athMarketCap: tokenData.athMarketCap,
    priceChange24h: tokenData.priceChange24h
  };
}

/**
 * Seeded random for deterministic visuals
 */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Hash a string to a number for seeding
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
