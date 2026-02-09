/**
 * CastleMaterialSystem.ts
 *
 * Premium material system that differentiates castle tiers by finish quality.
 *
 * Quality levels:
 *   ruins    → rough, matte, uneven (construction / deep decay)
 *   normal   → solid stone, clean edges (keep, castle)
 *   high     → polished stone, subtle reflections (fortress)
 *   legendary → cinematic, Disney-like: bright, clean, magical glow (citadel)
 *
 * Legendary finish: softer palette, ivory/gold accents, edge glow, bloom,
 * symmetrical high-contrast look. Decay never reverts premium finish —
 * it only damages the structure (cracks, faded glow, broken elegance).
 */

import * as THREE from 'three';
import type { CastleTier } from '$lib/types';

// ─── Quality enum ───────────────────────────────────────────

export type MaterialQuality = 'ruins' | 'normal' | 'high' | 'legendary';

export function qualityForTier(tier: CastleTier, isLegendary: boolean): MaterialQuality {
  if (isLegendary) return 'legendary';
  if (tier === 'citadel') return 'legendary';
  if (tier === 'fortress') return 'high';
  if (tier === 'castle') return 'normal';
  return 'ruins';
}

export function qualityForConstruction(progress: number): MaterialQuality {
  if (progress < 0.4) return 'ruins';
  if (progress < 0.8) return 'normal';
  return 'normal';
}

// ─── Color palettes ─────────────────────────────────────────

// Legendary uses softer, brighter Disney-like palette
const PALETTES = {
  keep: {
    primary:   0x9B8B6E,  // warm stone
    secondary: 0x7A6B55,
    roof:      0x6B5A44,
    accent:    0xD4A76A,
    trim:      0xB8854D,
    glow:      0x000000,
  },
  castle: {
    primary:   0x8095A8,  // blue-grey stone
    secondary: 0x5C6E7F,
    roof:      0x8B1A1A,  // deep crimson
    accent:    0xC9A84C,  // rich gold
    trim:      0xDEB953,
    glow:      0x000000,
  },
  fortress: {
    primary:   0x5878A8,  // royal blue
    secondary: 0x3D5A8A,
    roof:      0x7A1830,  // burgundy
    accent:    0xFFD54F,  // bright gold
    trim:      0xFFB74D,  // warm gold
    glow:      0xFFD54F,
  },
  citadel: {
    // ─── Disney / fairy-tale palette ──────────
    primary:   0xB8A9D4,  // soft lavender stone
    secondary: 0x8878B0,  // deeper lavender
    roof:      0xFFE082,  // warm golden roof
    accent:    0xFFF8E1,  // ivory/cream
    trim:      0xFFD54F,  // bright gold
    glow:      0xFFE082,  // warm bloom
  },
};

// ─── Material factory ───────────────────────────────────────

export type MaterialSlot = 'primary' | 'secondary' | 'roof' | 'accent' | 'trim';

export interface TierMaterials {
  primary: THREE.MeshStandardMaterial;
  secondary: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;    // edge-bloom material for legendary
  wood: THREE.MeshStandardMaterial;     // scaffolding / construction wood
  foundation: THREE.MeshStandardMaterial; // bare stone for early construction
}

export function createTierMaterials(
  tier: CastleTier,
  quality: MaterialQuality
): TierMaterials {
  const p = PALETTES[tier];

  // Base roughness / metalness by quality
  const qr = qualityRoughness(quality);
  const qm = qualityMetalness(quality);

  const primary = new THREE.MeshStandardMaterial({
    color: p.primary,
    roughness: qr.stone,
    metalness: qm.stone,
  });

  const secondary = new THREE.MeshStandardMaterial({
    color: p.secondary,
    roughness: qr.stone + 0.05,
    metalness: qm.stone,
  });

  const roof = new THREE.MeshStandardMaterial({
    color: p.roof,
    roughness: qr.roof,
    metalness: quality === 'legendary' ? 0.35 : qm.roof,
    emissive: quality === 'legendary' ? p.roof : 0x000000,
    emissiveIntensity: quality === 'legendary' ? 0.08 : 0,
  });

  const accent = new THREE.MeshStandardMaterial({
    color: p.accent,
    roughness: qr.accent,
    metalness: qm.accent,
    emissive: quality === 'legendary' || quality === 'high' ? p.accent : 0x000000,
    emissiveIntensity: quality === 'legendary' ? 0.25 : (quality === 'high' ? 0.1 : 0),
  });

  const trim = new THREE.MeshStandardMaterial({
    color: p.trim,
    roughness: qr.accent,
    metalness: qm.accent + 0.1,
    emissive: quality === 'legendary' ? p.trim : 0x000000,
    emissiveIntensity: quality === 'legendary' ? 0.2 : 0,
  });

  const glow = new THREE.MeshStandardMaterial({
    color: quality === 'legendary' ? p.glow : 0xFFD700,
    roughness: 0.15,
    metalness: 0.7,
    emissive: quality === 'legendary' ? p.glow : 0xFFD700,
    emissiveIntensity: quality === 'legendary' ? 0.6 : 0.3,
  });

  const wood = new THREE.MeshStandardMaterial({
    color: 0x8B6A43,
    roughness: 0.85,
    metalness: 0,
  });

  const foundation = new THREE.MeshStandardMaterial({
    color: 0x7A7060,
    roughness: 0.95,
    metalness: 0,
  });

  return { primary, secondary, roof, accent, trim, glow, wood, foundation };
}

// ─── Quality → surface params ───────────────────────────────

function qualityRoughness(q: MaterialQuality) {
  switch (q) {
    case 'ruins':     return { stone: 0.92, roof: 0.75, accent: 0.55 };
    case 'normal':    return { stone: 0.72, roof: 0.58, accent: 0.35 };
    case 'high':      return { stone: 0.52, roof: 0.42, accent: 0.22 };
    case 'legendary': return { stone: 0.38, roof: 0.30, accent: 0.15 };
  }
}

function qualityMetalness(q: MaterialQuality) {
  switch (q) {
    case 'ruins':     return { stone: 0.0, roof: 0.0,  accent: 0.15 };
    case 'normal':    return { stone: 0.05, roof: 0.05, accent: 0.45 };
    case 'high':      return { stone: 0.12, roof: 0.10, accent: 0.65 };
    case 'legendary': return { stone: 0.18, roof: 0.20, accent: 0.80 };
  }
}

// ─── Decay blending ─────────────────────────────────────────

/**
 * Apply decay to materials without reverting quality.
 * Legendary decay: cracks feel tragic, glow fades, roughness rises slightly.
 * Lower tier decay: darker, rougher, more uneven.
 */
export function applyDecayToMaterials(
  mats: TierMaterials,
  decay: number,
  quality: MaterialQuality
): void {
  const clampedDecay = Math.max(0, Math.min(1, decay));

  // How much decay affects each quality — legendary is more resistant
  const decayImpact = quality === 'legendary' ? clampedDecay * 0.5
    : quality === 'high' ? clampedDecay * 0.65
    : clampedDecay * 0.85;

  // Roughness rises with decay (never past 1)
  for (const key of ['primary', 'secondary', 'roof'] as const) {
    const mat = mats[key];
    mat.roughness = Math.min(1, mat.roughness + decayImpact * 0.25);
    // Desaturate slightly: lerp color toward grey
    const grey = new THREE.Color(0x6a6a6a);
    mat.color.lerp(grey, decayImpact * 0.2);
  }

  // Emissive fades
  for (const key of ['accent', 'trim', 'glow', 'roof'] as const) {
    const mat = mats[key];
    if (mat.emissiveIntensity > 0) {
      mat.emissiveIntensity *= (1 - clampedDecay * 0.7);
    }
  }
}

/**
 * Apply construction progress to materials.
 * Early construction → rough, matte appearance.
 */
export function applyConstructionToMaterials(
  mats: TierMaterials,
  progress: number
): void {
  if (progress >= 1) return; // fully built

  // Blend materials toward rough, unfinished look
  const rawness = 1 - progress; // 1 = totally raw, 0 = finished

  for (const key of ['primary', 'secondary'] as const) {
    const mat = mats[key];
    // More roughness at low progress
    mat.roughness = Math.min(1, mat.roughness + rawness * 0.3);
    // Shift color toward foundation stone
    mat.color.lerp(new THREE.Color(0x7A7060), rawness * 0.5);
    // No metalness during construction
    mat.metalness *= progress;
  }

  // Trim/accent barely visible until > 60%
  const trimVisibility = Math.max(0, (progress - 0.6) / 0.4);
  for (const key of ['accent', 'trim', 'glow'] as const) {
    const mat = mats[key];
    mat.opacity = trimVisibility;
    mat.transparent = trimVisibility < 1;
    if (mat.emissiveIntensity > 0) {
      mat.emissiveIntensity *= trimVisibility;
    }
  }
}

// ─── Dispose helper ─────────────────────────────────────────

export function disposeTierMaterials(mats: TierMaterials): void {
  for (const key of Object.keys(mats) as (keyof TierMaterials)[]) {
    mats[key].dispose();
  }
}
