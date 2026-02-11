/**
 * ActivityState.ts
 *
 * Handles activity level computation based on volume and trade activity.
 */

import type { TokenData, ActivityLevel } from '$lib/types';

// Hours without trades before zombie state
const ZOMBIE_THRESHOLD_HOURS = 6;

// Volume change thresholds
const VOLUME_BOOM_THRESHOLD = 1.5;   // 50% increase
const VOLUME_DYING_THRESHOLD = 0.3;  // 70% decrease

export interface ActivityResult {
  level: ActivityLevel;
  volumeRatio: number;
  isZombie: boolean;
  hoursSinceLastTrade: number;
  populationDensity: number;  // 0–1 normalized, drives castle life visuals
}

/**
 * Compute population density from transaction counts.
 * Returns a 0–1 score that drives castle life: villagers, guards, smoke, torch brightness.
 *
 * Unique wallets (60% weight) are the strongest signal of "real life" —
 * many wallets = many distinct people visiting the castle.
 * Transaction count (40% weight) adds bustle within the existing population.
 *
 * Log scale ensures both tiny and massive tokens produce useful values:
 *   0 → 0, 10 → 0.25, 100 → 0.50, 1000 → 0.75, 10000+ → 1.0
 */
export function computePopulationDensity(tokenData: TokenData): number {
  const walletScore = Math.min(1, Math.log10(Math.max(1, tokenData.uniqueTransactions24)) / 4);
  const txnScore = Math.min(1, Math.log10(Math.max(1, tokenData.txnCount24)) / 4.7);
  return walletScore * 0.6 + txnScore * 0.4;
}

/**
 * Compute activity level based on volume and trade recency
 */
export function computeActivity(tokenData: TokenData): ActivityResult {
  const now = Date.now();
  const hoursSinceLastTrade = (now - tokenData.lastTradeTimestamp) / (1000 * 60 * 60);

  // Check for zombie state first
  const isZombie = hoursSinceLastTrade >= ZOMBIE_THRESHOLD_HOURS;

  // Compute volume ratio (current vs previous)
  const volumeRatio = tokenData.previousVolume24h > 0
    ? tokenData.volume24h / tokenData.previousVolume24h
    : tokenData.volume24h > 0 ? 1 : 0;

  // Determine activity level
  let level: ActivityLevel;

  if (isZombie || tokenData.volume24h === 0) {
    level = 'dead';
  } else if (volumeRatio < VOLUME_DYING_THRESHOLD) {
    level = 'dying';
  } else if (volumeRatio >= VOLUME_BOOM_THRESHOLD) {
    level = 'booming';
  } else if (volumeRatio >= 0.8) {
    level = 'active';
  } else {
    level = 'slow';
  }

  const populationDensity = computePopulationDensity(tokenData);

  return {
    level,
    volumeRatio,
    isZombie,
    hoursSinceLastTrade,
    populationDensity
  };
}

/**
 * Get number of builders based on activity
 */
export function getBuilderCount(activity: ActivityResult, isPreGraduation: boolean): number {
  if (!isPreGraduation) return 0;

  switch (activity.level) {
    case 'booming': return 8;
    case 'active': return 5;
    case 'slow': return 3;
    case 'dying': return 1;
    case 'dead': return 0;
  }
}

/**
 * Get builder animation speed multiplier
 */
export function getBuilderSpeed(activity: ActivityResult): number {
  switch (activity.level) {
    case 'booming': return 2.0;
    case 'active': return 1.0;
    case 'slow': return 0.5;
    case 'dying': return 0.2;
    case 'dead': return 0;
  }
}

/**
 * Get environment effects based on activity
 */
export interface ActivityEnvironmentEffects {
  fogDensity: number;     // 0-1
  dustParticles: number;  // particle count
  windStrength: number;   // 0-1
  ambientSound: 'busy' | 'quiet' | 'eerie' | 'silent';
}

export function getActivityEnvironment(activity: ActivityResult): ActivityEnvironmentEffects {
  if (activity.isZombie) {
    return {
      fogDensity: 0.8,
      dustParticles: 0,
      windStrength: 0.2,
      ambientSound: 'eerie'
    };
  }

  switch (activity.level) {
    case 'booming':
      return { fogDensity: 0, dustParticles: 20, windStrength: 0.3, ambientSound: 'busy' };
    case 'active':
      return { fogDensity: 0.1, dustParticles: 10, windStrength: 0.2, ambientSound: 'busy' };
    case 'slow':
      return { fogDensity: 0.3, dustParticles: 5, windStrength: 0.4, ambientSound: 'quiet' };
    case 'dying':
      return { fogDensity: 0.5, dustParticles: 2, windStrength: 0.5, ambientSound: 'quiet' };
    case 'dead':
      return { fogDensity: 0.7, dustParticles: 0, windStrength: 0.1, ambientSound: 'silent' };
  }
}
