/**
 * DecayState.ts
 *
 * Handles the decay/fall from glory system.
 * Decay is based on how far the current market cap has fallen from ATH.
 */

/**
 * Compute decay value (0 = at ATH, 1 = completely fallen)
 */
export function computeDecay(currentMarketCap: number, athMarketCap: number): number {
  if (athMarketCap <= 0) return 0;
  if (currentMarketCap >= athMarketCap) return 0;

  const decay = 1 - (currentMarketCap / athMarketCap);
  return Math.max(0, Math.min(1, decay));
}

/**
 * Get decay visual effects thresholds
 */
export interface DecayEffects {
  showCracks: boolean;      // decay > 0.2
  showRust: boolean;        // decay > 0.4
  showLeaningTowers: boolean; // decay > 0.6
  showMissingBanners: boolean; // decay > 0.3
  showCrumbling: boolean;   // decay > 0.8
  crackIntensity: number;   // 0-1
  rustIntensity: number;    // 0-1
  abandonmentLevel: number; // 0-1
}

export function computeDecayEffects(decay: number): DecayEffects {
  return {
    showCracks: decay > 0.2,
    showRust: decay > 0.4,
    showLeaningTowers: decay > 0.6,
    showMissingBanners: decay > 0.3,
    showCrumbling: decay > 0.8,
    crackIntensity: Math.max(0, (decay - 0.2) / 0.8),
    rustIntensity: Math.max(0, (decay - 0.4) / 0.6),
    abandonmentLevel: decay
  };
}

/**
 * Get color tint based on decay (for desaturation effect)
 */
export function getDecayColorModifier(decay: number): {
  saturation: number;
  brightness: number;
  tint: string;
} {
  // Gradually desaturate and darken
  const saturation = 1 - (decay * 0.6);
  const brightness = 1 - (decay * 0.3);

  // Tint towards grey/brown as decay increases
  const r = Math.round(128 + decay * 50);
  const g = Math.round(128 + decay * 30);
  const b = Math.round(128 - decay * 20);

  return {
    saturation,
    brightness,
    tint: `rgb(${r}, ${g}, ${b})`
  };
}

/**
 * Calculate crack positions based on decay and seed
 */
export function generateCrackPattern(
  decay: number,
  seed: number,
  width: number,
  height: number
): Array<{ x1: number; y1: number; x2: number; y2: number; thickness: number }> {
  if (decay < 0.2) return [];

  const cracks: Array<{ x1: number; y1: number; x2: number; y2: number; thickness: number }> = [];
  const numCracks = Math.floor(decay * 10);

  // Seeded random
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  for (let i = 0; i < numCracks; i++) {
    const x1 = random() * width;
    const y1 = random() * height;
    const angle = random() * Math.PI * 2;
    const length = 20 + random() * 40 * decay;

    cracks.push({
      x1,
      y1,
      x2: x1 + Math.cos(angle) * length,
      y2: y1 + Math.sin(angle) * length,
      thickness: 1 + random() * 2 * decay
    });
  }

  return cracks;
}
