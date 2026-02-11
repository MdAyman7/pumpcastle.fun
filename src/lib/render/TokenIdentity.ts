/**
 * TokenIdentity.ts
 *
 * Derives deterministic visual identity from token data:
 * - Sigil colors (from symbol hash → hue)
 * - Banner fabric color + accent color
 * - Material aging/wear/polish based on token health
 * - Exchange marker counts and tiers
 *
 * Design principle: each token should feel unique at a glance,
 * but the palette must stay medieval — no neon, no brand logos.
 */

import * as THREE from 'three';
import type { WorldState, ExchangeListing } from '$lib/types';

export interface TokenColors {
  primary: number;      // Main banner/sigil color (saturated, medieval)
  accent: number;       // Secondary accent (lighter complement)
  trim: number;         // Metallic trim color (gold, silver, bronze, or dark iron)
  fabric: number;       // Banner fabric base (slightly desaturated primary)
}

export interface MaterialWear {
  roughnessBoost: number;   // 0 = polished, 0.3 = weathered
  metalnessReduction: number; // 0 = pristine, 0.2 = tarnished
  emissiveScale: number;     // 1 = full glow, 0.3 = dim/dead
  saturationScale: number;   // 1 = vibrant, 0.5 = faded
}

/**
 * Generate a deterministic hash from a string.
 * Used to convert symbol → consistent hue/palette.
 */
function symbolHash(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash) + symbol.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Convert HSL to a hex number for Three.js materials.
 * h: 0-360, s: 0-1, l: 0-1
 */
function hslToHex(h: number, s: number, l: number): number {
  const color = new THREE.Color();
  color.setHSL(h / 360, s, l);
  return parseInt(color.getHexString(), 16);
}

/**
 * Medieval color palette constraints.
 * Certain hue ranges are boosted/suppressed to keep the palette grounded.
 * - Reds, deep blues, greens, purples, golds → medieval
 * - Neon pink, cyan, lime → pushed toward deeper tones
 */
function medievalHue(rawHue: number): number {
  // rawHue is 0-360
  // Suppress overly bright/neon ranges by deepening saturation bands
  // This is subtle — just nudges hues toward "natural dye" territory
  if (rawHue > 40 && rawHue < 80) return rawHue + 10;   // push yellow → amber
  if (rawHue > 160 && rawHue < 200) return rawHue - 10;  // push cyan → teal
  return rawHue;
}

/**
 * Derive token sigil colors deterministically from the symbol string.
 * Every token gets a unique but medieval-feeling palette.
 */
export function getTokenColors(symbol: string, decay: number): TokenColors {
  const hash = symbolHash(symbol);
  const hue = medievalHue(hash % 360);

  // Saturation depends on token health — thriving tokens are more vivid
  const baseSat = 0.55 + (1 - decay) * 0.2; // 0.55 (fallen) → 0.75 (at ATH)
  const baseLightness = 0.35;                 // Deep, not pastel

  const primary = hslToHex(hue, baseSat, baseLightness);
  const accent = hslToHex((hue + 30) % 360, baseSat * 0.8, baseLightness + 0.15);
  const fabric = hslToHex(hue, baseSat * 0.7, baseLightness + 0.05);

  // Trim color: gold for healthy, silver for declining, dark iron for cursed/zombie
  let trim: number;
  if (decay < 0.3) {
    trim = 0xc8a84e; // Gold
  } else if (decay < 0.6) {
    trim = 0xa8a8a0; // Silver
  } else if (decay < 0.8) {
    trim = 0x8a7a5a; // Bronze/tarnished
  } else {
    trim = 0x4a4a4a; // Dark iron (cursed/fallen)
  }

  return { primary, accent, trim, fabric };
}

/**
 * Compute material wear based on token health.
 * Healthy tokens = polished stone, gold glow, vibrant cloth.
 * Decayed tokens = rough stone, tarnished metal, faded cloth.
 */
export function getMaterialWear(state: WorldState): MaterialWear {
  const { decay } = state;

  // Smooth gradient from polished (decay=0) to weathered (decay=1)
  // Population density also affects emissive glow (low pop = dimmer)
  const pop = state.populationDensity ?? 0.5;
  const popDim = 0.5 + pop * 0.5; // 0.5 at ghost town, 1.0 at peak

  return {
    roughnessBoost: decay * 0.25,
    metalnessReduction: decay * 0.15,
    emissiveScale: (1 - decay * 0.5) * popDim,
    saturationScale: 1 - decay * 0.3
  };
}

/**
 * Categorize exchanges into display tiers for trade markers.
 * Returns sorted: major CEX first, then small CEX, then DEX.
 */
export function categorizeExchanges(exchanges: ExchangeListing[]): {
  major: ExchangeListing[];
  minor: ExchangeListing[];
  dex: ExchangeListing[];
} {
  const major = exchanges.filter(e => e.tier === 'cex_major');
  const minor = exchanges.filter(e => e.tier === 'cex_small');
  const dex = exchanges.filter(e => e.tier === 'dex');
  return { major, minor, dex };
}

/**
 * Compute the warm/cool accent color for price mood lighting.
 * priceMood: -1 (bearish) → +1 (bullish)
 *
 * Bullish:  warm amber/gold accent (subtle, not orange)
 * Neutral:  no accent (returns null)
 * Bearish:  cool blue-grey shadow tint (subtle, not full recolor)
 *
 * Returns a THREE.Color or null if mood is near-neutral.
 */
export function getPriceMoodColor(priceMood: number): THREE.Color | null {
  const abs = Math.abs(priceMood);
  if (abs < 0.15) return null; // Dead zone — no mood tinting

  if (priceMood > 0) {
    // Warm: blend from white → amber based on intensity
    const warm = new THREE.Color(0xffeedd);
    warm.lerp(new THREE.Color(0xffcc88), abs);
    return warm;
  } else {
    // Cool: blend from white → steel blue based on intensity
    const cool = new THREE.Color(0xeeeeff);
    cool.lerp(new THREE.Color(0x8899bb), abs);
    return cool;
  }
}

/**
 * Get mood-adjusted emissive intensity multiplier for accent lights.
 * Positive mood → slightly brighter torches/glow.
 * Negative mood → slightly dimmer torches/glow.
 */
export function getMoodEmissiveScale(priceMood: number): number {
  // 0.85 (bearish) → 1.0 (neutral) → 1.2 (bullish)
  return 1.0 + priceMood * 0.2;
}

/**
 * Medieval-friendly brand colors for known exchanges.
 * Muted/desaturated versions of actual brand colors,
 * shifted to work under torchlight and stone textures.
 */
const EXCHANGE_COLORS: Record<string, number> = {
  // Major CEX
  'Binance':    0xb09930, // Muted gold
  'Coinbase':   0x3060a0, // Muted blue
  'Kraken':     0x5a3a8a, // Muted purple
  'OKX':        0x808080, // Neutral grey
  'Bybit':      0xc07020, // Warm amber
  'KuCoin':     0x2a8a60, // Teal-green
  'Gate.io':    0x2a6a9a, // Steel blue
  'HTX':        0x2060a0, // Deep blue
  'MEXC':       0x2a6a9a, // Steel blue
  'Bitget':     0x3080b0, // Sky blue

  // Solana DEX / Launchpads
  'Pump':           0x2a8a6a, // Teal-green
  'Pump AMM':       0x6a6a6a, // Neutral grey
  'PumpSwap':       0xa05040, // Rust red
  'Mayhem':         0xb05030, // Flame red
  'Bags':           0x309050, // Green
  'Bonk':           0xc08030, // Warm orange
  'Bonkers':        0xb04530, // Deep orange-red
  'Surge':          0x309050, // Green
  'Soar':           0x3080b0, // Cyan-blue
  'Moonshot':       0xb09930, // Gold
  'Heaven':         0x8a8a8a, // Silver-grey
  'Daos.fun':       0x3060a0, // Blue
  'Candle':         0xc06030, // Warm orange
  'Sugar':          0xa08a60, // Tan/beige
  'Believe':        0x40a0b0, // Cyan
  'Jupiter':        0x308060, // Deep green
  'Jupiter Studio': 0x308060, // Deep green
  'Moonit':         0x90a030, // Yellow-green
  'Boop':           0xa050a0, // Magenta-purple
  'LaunchLab':      0x6a40a0, // Purple
  'Dynamic BC':     0xb06080, // Pink-coral
  'Raydium':        0x5a40a0, // Purple
  'Meteora':        0x7050a0, // Violet
  'Meteora AMM':    0xc07050, // Coral-orange
  'Meteora AMM V2': 0xc07050, // Coral-orange
  'Orca':           0xc09030, // Warm gold
  'Wavebreak':      0xb09040, // Gold-tan
};

export function getExchangeColor(exchangeName: string): number {
  return EXCHANGE_COLORS[exchangeName] ?? 0x7a6a5a; // Default: neutral stone
}
