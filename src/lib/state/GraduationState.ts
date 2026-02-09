/**
 * GraduationState.ts
 *
 * Handles the graduation state and celebration trigger.
 * Graduation is a MAJOR milestone that transforms the castle.
 */

import type { TokenData, WorldState } from '$lib/types';

// Duration of graduation celebration in milliseconds
export const GRADUATION_CELEBRATION_DURATION = 5000;

export interface GraduationResult {
  hasGraduated: boolean;
  justGraduated: boolean;  // Triggered this update
  showCelebration: boolean;
  timeSinceGraduation: number | null;
}

// Track celebration state externally (for persistence across updates)
let celebrationStartTime: number | null = null;
let lastGraduatedState: boolean = false;

/**
 * Compute graduation state and detect celebration trigger
 */
export function computeGraduation(
  tokenData: TokenData,
  previousState: WorldState | null
): GraduationResult {
  const now = Date.now();

  // Check if token just graduated (transition from false to true)
  const justGraduated = tokenData.isGraduated && !lastGraduatedState;
  lastGraduatedState = tokenData.isGraduated;

  // Start celebration timer if just graduated
  if (justGraduated) {
    celebrationStartTime = now;
  }

  // Calculate if we're still in celebration period
  const inCelebration = celebrationStartTime !== null &&
    (now - celebrationStartTime) < GRADUATION_CELEBRATION_DURATION;

  // Calculate time since graduation
  const timeSinceGraduation = tokenData.graduatedAt
    ? now - tokenData.graduatedAt
    : null;

  return {
    hasGraduated: tokenData.isGraduated,
    justGraduated,
    showCelebration: inCelebration,
    timeSinceGraduation
  };
}

/**
 * Get celebration progress (0-1)
 */
export function getCelebrationProgress(): number {
  if (celebrationStartTime === null) return 0;

  const elapsed = Date.now() - celebrationStartTime;
  const progress = elapsed / GRADUATION_CELEBRATION_DURATION;

  if (progress >= 1) {
    celebrationStartTime = null;
    return 0;
  }

  return progress;
}

/**
 * Reset graduation state (for new token)
 */
export function resetGraduationState(): void {
  celebrationStartTime = null;
  lastGraduatedState = false;
}

/**
 * Graduation visual sequence phases
 */
export type GraduationPhase =
  | 'scaffolding_remove'   // 0-20%: Scaffolding fades/falls
  | 'walls_lock'           // 20-40%: Stone walls solidify
  | 'flags_raise'          // 40-60%: Flags animate upward
  | 'banners_unfurl'       // 60-80%: Banners roll down
  | 'celebration'          // 80-100%: Confetti and sparkles

export function getGraduationPhase(progress: number): GraduationPhase {
  if (progress < 0.2) return 'scaffolding_remove';
  if (progress < 0.4) return 'walls_lock';
  if (progress < 0.6) return 'flags_raise';
  if (progress < 0.8) return 'banners_unfurl';
  return 'celebration';
}

/**
 * Get phase-specific progress (0-1 within that phase)
 */
export function getPhaseProgress(globalProgress: number): number {
  const phaseStart = Math.floor(globalProgress / 0.2) * 0.2;
  return (globalProgress - phaseStart) / 0.2;
}
