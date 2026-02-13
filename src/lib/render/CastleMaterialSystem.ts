/**
 * CastleMaterialSystem.ts
 *
 * Premium material system that differentiates castle tiers by finish quality.
 *
 * Quality levels:
 *   ruins    → rough, matte, uneven (construction / deep decay)
 *   normal   → solid stone, clean edges (keep, castle)
 *   high     → polished stone, subtle reflections via clearcoat (fortress)
 *   legendary → cinematic, Disney-like: bright, clean, magical glow, rim lighting (citadel)
 *
 * High & legendary tiers use MeshPhysicalMaterial for clearcoat, sheen,
 * and iridescence. Legendary materials get rim-light glow via onBeforeCompile
 * shader injection.
 *
 * Quality transitions animate smoothly — roughness, metalness, emissive, and
 * clearcoat lerp over ~1.5 seconds when quality changes.
 *
 * Decay never reverts premium finish — it only damages the structure
 * (faded glow, slight roughness rise, desaturation). Legendary decay feels
 * tragic, not ugly: luminous cracks, faded gold, muted elegance.
 */

import * as THREE from 'three';
import type { CastleTier } from '$lib/types';

// ─── Quality enum ───────────────────────────────────────────

export type MaterialQuality = 'ruins' | 'normal' | 'high' | 'legendary';

export function qualityForTier(tier: CastleTier, isLegendary: boolean): MaterialQuality {
  if (isLegendary) return 'legendary';
  if (tier === 'legend' || tier === 'empire' || tier === 'citadel') return 'legendary';
  if (tier === 'palace' || tier === 'fortress' || tier === 'stronghold') return 'high';
  if (tier === 'castle' || tier === 'manor' || tier === 'keep') return 'normal';
  return 'ruins';
}

export function qualityForConstruction(progress: number): MaterialQuality {
  if (progress < 0.4) return 'ruins';
  if (progress < 0.8) return 'normal';
  return 'normal';
}

// ─── Color palettes ─────────────────────────────────────────

/**
 * ColorPalette: enriched per-tier color definition.
 *
 * Each slot has a base color PLUS a highlight and shadow tone used for
 * vertical gradients on geometry. Higher tiers have more pronounced
 * highlight–shadow separation (more depth, more polish). Lower tiers
 * keep the range narrow (flat, muted, simple).
 *
 * `foundation` tints the raw stone during early construction.
 * `woodTint` shifts the scaffolding wood tone per tier.
 */
export interface ColorPalette {
  primary:   number;
  primaryHighlight: number;   // lighter top-of-wall tone
  primaryShadow: number;      // darker base-of-wall tone
  secondary: number;
  secondaryHighlight: number;
  secondaryShadow: number;
  roof:      number;
  roofHighlight: number;
  accent:    number;
  accentHighlight: number;
  trim:      number;
  trimHighlight: number;
  glow:      number;
  foundation: number;
  woodTint:  number;
}

const PALETTES: Record<CastleTier, ColorPalette> = {
  hut: {
    // ─── Raw mud/thatch, very humble ─────────────────────────────
    primary:            0x8E7A52,
    primaryHighlight:   0x9C8860,
    primaryShadow:      0x7E6A44,
    secondary:          0x6E5E44,
    secondaryHighlight: 0x7C6C52,
    secondaryShadow:    0x604E38,
    roof:               0x6B5A40,
    roofHighlight:      0x7A6A50,
    accent:             0xC49C58,
    accentHighlight:    0xD4AC68,
    trim:               0xA47A3C,
    trimHighlight:      0xB48A4C,
    glow:               0x000000,
    foundation:         0x6A6050,
    woodTint:           0x7A5A38,
  },
  cottage: {
    // ─── Simple stone + wood, warm tones ─────────────────────────
    primary:            0x947E60,
    primaryHighlight:   0xA28E70,
    primaryShadow:      0x846E50,
    secondary:          0x70604A,
    secondaryHighlight: 0x7E6E58,
    secondaryShadow:    0x625040,
    roof:               0x6B5A44,
    roofHighlight:      0x7A6A54,
    accent:             0xCCA860,
    accentHighlight:    0xDCB870,
    trim:               0xB28C4C,
    trimHighlight:      0xC29C5C,
    glow:               0x000000,
    foundation:         0x706858,
    woodTint:           0x8A6A42,
  },
  tower: {
    // ─── Grey stone, slightly refined ───────────────────────────
    primary:            0x968A72,
    primaryHighlight:   0xA49A82,
    primaryShadow:      0x887C64,
    secondary:          0x7A7060,
    secondaryHighlight: 0x887E6E,
    secondaryShadow:    0x6C6254,
    roof:               0x5A4A3A,
    roofHighlight:      0x6A5A4A,
    accent:             0xD0AC58,
    accentHighlight:    0xE0BC68,
    trim:               0xB48C44,
    trimHighlight:      0xC49C54,
    glow:               0x000000,
    foundation:         0x787060,
    woodTint:           0x886840,
  },
  keep: {
    // ─── Warm stone, earthy tones ───────────────────────────────
    primary:            0xA08C66,
    primaryHighlight:   0xAE9A78,
    primaryShadow:      0x907C58,
    secondary:          0x7A6B55,
    secondaryHighlight: 0x877862,
    secondaryShadow:    0x6E604C,
    roof:               0x6B5A44,
    roofHighlight:      0x7A6A54,
    accent:             0xDCAA62,
    accentHighlight:    0xECBA72,
    trim:               0xC08A48,
    trimHighlight:      0xD09A58,
    glow:               0x000000,
    foundation:         0x7A7060,
    woodTint:           0x8B6A43,
  },
  manor: {
    // ─── Warmer stone, copper/bronze accents ────────────────────
    primary:            0x8E8E70,
    primaryHighlight:   0x9E9E80,
    primaryShadow:      0x7E7E62,
    secondary:          0x6A6A58,
    secondaryHighlight: 0x787868,
    secondaryShadow:    0x5C5C4C,
    roof:               0x7A4030,
    roofHighlight:      0x8A5040,
    accent:             0xD09448,
    accentHighlight:    0xE0A458,
    trim:               0xC88C44,
    trimHighlight:      0xD89C54,
    glow:               0xA88040,
    foundation:         0x6E6E60,
    woodTint:           0x7E5E3E,
  },
  castle: {
    // ─── Clean stone, rich blue-grey, vivid ─────────────────────
    primary:            0x5C7A96,
    primaryHighlight:   0x708EA8,
    primaryShadow:      0x4A6884,
    secondary:          0x465A6E,
    secondaryHighlight: 0x566A7E,
    secondaryShadow:    0x384C5E,
    roof:               0x8B1A1A,
    roofHighlight:      0xA02828,
    accent:             0xD0AC48,
    accentHighlight:    0xE0BC5C,
    trim:               0xE0BC50,
    trimHighlight:      0xF0CC64,
    glow:               0xC9A84C,
    foundation:         0x525860,
    woodTint:           0x7A5E3A,
  },
  stronghold: {
    // ─── Dark steel stone, military feel ────────────────────────
    primary:            0x506070,
    primaryHighlight:   0x607080,
    primaryShadow:      0x405060,
    secondary:          0x3A4A5A,
    secondaryHighlight: 0x4A5A6A,
    secondaryShadow:    0x2E3E4E,
    roof:               0x6A2020,
    roofHighlight:      0x803030,
    accent:             0xD0A840,
    accentHighlight:    0xE0B850,
    trim:               0xC89838,
    trimHighlight:      0xD8A848,
    glow:               0xD0A840,
    foundation:         0x484E56,
    woodTint:           0x6A5038,
  },
  fortress: {
    // ─── Deep blue stone, rich color, warm highlights ───────────
    primary:            0x3E5E90,
    primaryHighlight:   0x5878A8,
    primaryShadow:      0x304E80,
    secondary:          0x2E4A74,
    secondaryHighlight: 0x3E5A88,
    secondaryShadow:    0x223E66,
    roof:               0x7A1830,
    roofHighlight:      0x9A2840,
    accent:             0xFFD54F,
    accentHighlight:    0xFFE070,
    trim:               0xFFB74D,
    trimHighlight:      0xFFC868,
    glow:               0xFFD54F,
    foundation:         0x465468,
    woodTint:           0x6E5238,
  },
  palace: {
    // ─── Elegant marble, deeper tones, rose-gold accents ────────
    primary:            0x8880A0,
    primaryHighlight:   0x9C94B4,
    primaryShadow:      0x766E8E,
    secondary:          0x706888,
    secondaryHighlight: 0x847C9A,
    secondaryShadow:    0x605878,
    roof:               0xD4A070,
    roofHighlight:      0xE4B488,
    accent:             0xE8D0B0,
    accentHighlight:    0xF4E0C8,
    trim:               0xE0B860,
    trimHighlight:      0xECC878,
    glow:               0xE0B860,
    foundation:         0x706880,
    woodTint:           0x8A7058,
  },
  citadel: {
    // ─── Premium: deep amethyst-blue, rich gold — fairy-tale ────
    primary:            0x8878B8,
    primaryHighlight:   0xA090D0,
    primaryShadow:      0x7468A4,
    secondary:          0x6C5EA0,
    secondaryHighlight: 0x8476B4,
    secondaryShadow:    0x5C4E90,
    roof:               0xF0D070,
    roofHighlight:      0xF8E090,
    accent:             0xFFF0C8,
    accentHighlight:    0xFFF8E0,
    trim:               0xFFD24E,
    trimHighlight:      0xFFDE6A,
    glow:               0xF0D070,
    foundation:         0x7A70A0,
    woodTint:           0x9A8068,
  },
  empire: {
    // ─── Imperial: deep blue marble, commanding gold ────────────
    primary:            0x6880A8,
    primaryHighlight:   0x8098C0,
    primaryShadow:      0x567098,
    secondary:          0x506888,
    secondaryHighlight: 0x687E9C,
    secondaryShadow:    0x405878,
    roof:               0xF0C050,
    roofHighlight:      0xF8D478,
    accent:             0xFFE8B0,
    accentHighlight:    0xFFF0CC,
    trim:               0xFFC030,
    trimHighlight:      0xFFD050,
    glow:               0xF0C050,
    foundation:         0x586880,
    woodTint:           0x887060,
  },
  legend: {
    // ─── Mythic: deep crystalline violet, radiant glow ──────────
    primary:            0x9088C8,
    primaryHighlight:   0xA8A0E0,
    primaryShadow:      0x7C74B4,
    secondary:          0x7870B0,
    secondaryHighlight: 0x9088C4,
    secondaryShadow:    0x6860A0,
    roof:               0xF8E080,
    roofHighlight:      0xFFF0A0,
    accent:             0xFFF8E0,
    accentHighlight:    0xFFFFFF,
    trim:               0xFFE060,
    trimHighlight:      0xFFF088,
    glow:               0xFFE8A0,
    foundation:         0x807898,
    woodTint:           0xA09078,
  },
};

/**
 * Get the raw palette for a tier. Exported for external gradient utilities.
 */
export function getPalette(tier: CastleTier): ColorPalette {
  return PALETTES[tier];
}

// ─── Gradient multipliers per quality ───────────────────────
//
// How much the highlight–shadow range is expressed. Ruins = flat,
// legendary = full depth and richness.

function gradientStrength(q: MaterialQuality): number {
  switch (q) {
    case 'ruins':     return 0.25; // subtle gradient — adds some depth
    case 'normal':    return 0.55; // clear highlight–shadow separation
    case 'high':      return 0.80; // polished, rich
    case 'legendary': return 1.00; // full depth, full richness
  }
}

// ─── Quality → surface params ───────────────────────────────

interface SurfaceParams {
  stone: number;
  roof: number;
  accent: number;
}

function qualityRoughness(q: MaterialQuality): SurfaceParams {
  switch (q) {
    case 'ruins':     return { stone: 0.85, roof: 0.70, accent: 0.45 };
    case 'normal':    return { stone: 0.62, roof: 0.48, accent: 0.25 };
    case 'high':      return { stone: 0.42, roof: 0.32, accent: 0.14 };
    case 'legendary': return { stone: 0.32, roof: 0.25, accent: 0.10 };
  }
}

function qualityMetalness(q: MaterialQuality): SurfaceParams {
  switch (q) {
    case 'ruins':     return { stone: 0.02, roof: 0.02, accent: 0.25 };
    case 'normal':    return { stone: 0.10, roof: 0.08, accent: 0.55 };
    case 'high':      return { stone: 0.18, roof: 0.16, accent: 0.75 };
    case 'legendary': return { stone: 0.20, roof: 0.25, accent: 0.85 };
  }
}

// ─── Physical material params (clearcoat, sheen) ────────────

interface PhysicalParams {
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  sheenRoughness: number;
  sheenColor: number;
}

function qualityPhysical(q: MaterialQuality): PhysicalParams {
  switch (q) {
    case 'ruins':
      return { clearcoat: 0.03, clearcoatRoughness: 0.8, sheen: 0.02, sheenRoughness: 0.8, sheenColor: 0xb0a890 };
    case 'normal':
      return { clearcoat: 0.08, clearcoatRoughness: 0.6, sheen: 0.05, sheenRoughness: 0.7, sheenColor: 0xd0c8c0 };
    case 'high':
      return { clearcoat: 0.15, clearcoatRoughness: 0.4, sheen: 0.1, sheenRoughness: 0.6, sheenColor: 0xc0c8d0 };
    case 'legendary':
      return { clearcoat: 0.35, clearcoatRoughness: 0.2, sheen: 0.25, sheenRoughness: 0.35, sheenColor: 0xFFE8C0 };
  }
}

// ─── Rim lighting shader injection ──────────────────────────

/**
 * Injects rim-light / edge-glow into MeshPhysicalMaterial for legendary quality.
 * Adds a soft Fresnel-based glow at grazing angles — the "fairy tale" edge halo.
 */
function injectRimLight(
  material: THREE.MeshPhysicalMaterial,
  rimColor: THREE.Color,
  rimPower: number,
  rimIntensity: number
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rimColor };
    shader.uniforms.rimPower = { value: rimPower };
    shader.uniforms.rimIntensity = { value: rimIntensity };

    // Add varyings for view direction in fragment
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
varying vec3 vViewDir;
varying vec3 vWorldNormal;`
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
vec4 worldPos = modelMatrix * vec4(position, 1.0);
vViewDir = normalize(cameraPosition - worldPos.xyz);`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform vec3 rimColor;
uniform float rimPower;
uniform float rimIntensity;
varying vec3 vViewDir;
varying vec3 vWorldNormal;`
    );

    // Add rim contribution to final output
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `float rimDot = 1.0 - max(dot(normalize(vViewDir), normalize(vWorldNormal)), 0.0);
float rim = pow(rimDot, rimPower) * rimIntensity;
gl_FragColor.rgb += rimColor * rim;
#include <dithering_fragment>`
    );
  };
  // Force shader recompile
  material.needsUpdate = true;
}

// ─── Material factory ───────────────────────────────────────

export type MaterialSlot = 'primary' | 'secondary' | 'roof' | 'accent' | 'trim';

export interface TierMaterials {
  primary: THREE.MeshPhysicalMaterial;
  secondary: THREE.MeshPhysicalMaterial;
  roof: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshPhysicalMaterial;
  glow: THREE.MeshPhysicalMaterial;     // edge-bloom material for legendary
  wood: THREE.MeshStandardMaterial;     // scaffolding / construction wood
  foundation: THREE.MeshStandardMaterial; // bare stone for early construction
}

// ─── Base Paint Layer ────────────────────────────────────────
//
// Authoritative snapshot of material colors/emissive set ONCE per state change.
// Every frame, decay/construction/effects compute FROM this base — never from
// the current (already-tinted) material. This prevents cumulative color drift.

export interface BasePaintSnapshot {
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
}

export type BasePaintStore = Map<string, BasePaintSnapshot>;

/** Capture base paint from freshly created tier materials. */
export function snapshotBasePaint(mats: TierMaterials): BasePaintStore {
  const store: BasePaintStore = new Map();
  const slots = ['primary', 'secondary', 'roof', 'accent', 'trim', 'glow'] as const;
  for (const slot of slots) {
    const mat = mats[slot];
    store.set(slot, {
      color: mat.color.clone(),
      emissive: mat.emissive.clone(),
      emissiveIntensity: mat.emissiveIntensity,
      roughness: mat.roughness,
      metalness: mat.metalness,
      clearcoat: mat.clearcoat,
      clearcoatRoughness: mat.clearcoatRoughness,
      sheen: mat.sheen,
    });
  }
  return store;
}

/**
 * Color floor clamp — anti-black failsafe.
 * Ensures no material color channel drops below a minimum luminance.
 * Prevents the "everything turns black" failure mode.
 */
export function clampColorFloor(color: THREE.Color, minLuminance: number = 0.04): void {
  const lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
  if (lum < minLuminance && lum > 0.001) {
    const boost = minLuminance / lum;
    color.r = Math.min(1, color.r * boost);
    color.g = Math.min(1, color.g * boost);
    color.b = Math.min(1, color.b * boost);
  } else if (lum <= 0.001) {
    // Absolute black — lift to minimum visible grey
    color.setRGB(minLuminance, minLuminance, minLuminance);
  }
}

export function createTierMaterials(
  tier: CastleTier,
  quality: MaterialQuality
): TierMaterials {
  const p = PALETTES[tier];
  const qr = qualityRoughness(quality);
  const qm = qualityMetalness(quality);
  const qp = qualityPhysical(quality);
  const gs = gradientStrength(quality);

  const usesPhysical = quality === 'high' || quality === 'legendary';
  const isLegendary = quality === 'legendary';
  const rimCol = isLegendary ? new THREE.Color(p.glow || 0xFFE8C0) : new THREE.Color(0x000000);

  // Blend base color toward highlight by gradient strength — higher tiers show
  // a subtly brighter, richer base tone. Vertex-color gradients add the rest.
  const blendedPrimary = new THREE.Color(p.primary).lerp(new THREE.Color(p.primaryHighlight), gs * 0.15);
  const blendedSecondary = new THREE.Color(p.secondary).lerp(new THREE.Color(p.secondaryHighlight), gs * 0.12);
  const blendedRoof = new THREE.Color(p.roof).lerp(new THREE.Color(p.roofHighlight), gs * 0.20);
  const blendedAccent = new THREE.Color(p.accent).lerp(new THREE.Color(p.accentHighlight), gs * 0.18);
  const blendedTrim = new THREE.Color(p.trim).lerp(new THREE.Color(p.trimHighlight), gs * 0.15);

  const primary = new THREE.MeshPhysicalMaterial({
    color: blendedPrimary,
    roughness: qr.stone,
    metalness: qm.stone,
    clearcoat: qp.clearcoat,
    clearcoatRoughness: qp.clearcoatRoughness,
    sheen: qp.sheen,
    sheenRoughness: qp.sheenRoughness,
    sheenColor: new THREE.Color(qp.sheenColor),
    vertexColors: true,  // enable vertex-color blending for gradients
  });

  const secondary = new THREE.MeshPhysicalMaterial({
    color: blendedSecondary,
    roughness: qr.stone + 0.05,
    metalness: qm.stone,
    clearcoat: qp.clearcoat * 0.7,
    clearcoatRoughness: qp.clearcoatRoughness + 0.1,
    sheen: qp.sheen * 0.5,
    sheenRoughness: qp.sheenRoughness,
    sheenColor: new THREE.Color(qp.sheenColor),
    vertexColors: true,
  });

  const roof = new THREE.MeshPhysicalMaterial({
    color: blendedRoof,
    roughness: qr.roof,
    metalness: isLegendary ? 0.40 : qm.roof,
    emissive: isLegendary ? new THREE.Color(p.roof) : new THREE.Color(0x000000),
    emissiveIntensity: isLegendary ? 0.10 : 0,
    clearcoat: isLegendary ? 0.5 : (usesPhysical ? 0.2 : 0),
    clearcoatRoughness: isLegendary ? 0.15 : 0.5,
    sheen: isLegendary ? 0.3 : 0,
    sheenRoughness: 0.3,
    sheenColor: new THREE.Color(isLegendary ? 0xFFF0C0 : 0x000000),
    vertexColors: true,
  });

  const accent = new THREE.MeshPhysicalMaterial({
    color: blendedAccent,
    roughness: qr.accent,
    metalness: qm.accent,
    emissive: new THREE.Color(p.accent),
    emissiveIntensity: isLegendary ? 0.30 : (quality === 'high' ? 0.12 : (quality === 'normal' ? 0.06 : 0.03)),
    clearcoat: isLegendary ? 0.6 : (usesPhysical ? 0.3 : qp.clearcoat),
    clearcoatRoughness: isLegendary ? 0.1 : (usesPhysical ? 0.3 : qp.clearcoatRoughness),
    sheen: isLegendary ? 0.4 : qp.sheen,
    sheenRoughness: 0.25,
    sheenColor: new THREE.Color(isLegendary ? 0xFFF8E1 : qp.sheenColor),
  });

  const trim = new THREE.MeshPhysicalMaterial({
    color: blendedTrim,
    roughness: qr.accent,
    metalness: qm.accent + 0.1,
    emissive: (isLegendary || quality === 'high' || quality === 'normal')
      ? new THREE.Color(p.trim) : new THREE.Color(0x000000),
    emissiveIntensity: isLegendary ? 0.25 : (quality === 'high' ? 0.10 : (quality === 'normal' ? 0.04 : 0)),
    clearcoat: isLegendary ? 0.55 : (usesPhysical ? 0.25 : qp.clearcoat),
    clearcoatRoughness: isLegendary ? 0.1 : (usesPhysical ? 0.3 : qp.clearcoatRoughness),
    sheen: isLegendary ? 0.35 : qp.sheen,
    sheenRoughness: 0.25,
    sheenColor: new THREE.Color(isLegendary ? 0xFFF0C0 : qp.sheenColor),
  });

  const glow = new THREE.MeshPhysicalMaterial({
    color: isLegendary ? p.glow : 0xFFD700,
    roughness: 0.10,
    metalness: 0.75,
    emissive: new THREE.Color(isLegendary ? p.glow : 0xFFD700),
    emissiveIntensity: isLegendary ? 0.70 : 0.3,
    clearcoat: isLegendary ? 0.8 : 0.3,
    clearcoatRoughness: 0.05,
    sheen: isLegendary ? 0.5 : 0,
    sheenRoughness: 0.2,
    sheenColor: new THREE.Color(0xFFF8E1),
  });

  // Inject rim lighting on legendary stone and accent materials
  if (isLegendary) {
    injectRimLight(primary, rimCol, 3.0, 0.35);
    injectRimLight(secondary, rimCol, 3.0, 0.28);
    injectRimLight(roof, new THREE.Color(0xFFF0C0), 2.5, 0.20);
    injectRimLight(accent, new THREE.Color(0xFFFBEF), 2.0, 0.45);
    injectRimLight(trim, new THREE.Color(0xFFDD63), 2.2, 0.40);
    injectRimLight(glow, new THREE.Color(0xFFFFFF), 1.8, 0.60);
  } else if (quality === 'high') {
    // Subtle rim for high quality
    injectRimLight(accent, new THREE.Color(0xFFD54F), 4.0, 0.15);
    injectRimLight(trim, new THREE.Color(0xFFB74D), 4.0, 0.12);
  } else if (quality === 'normal') {
    // Very faint rim on accent — prevents flat look on mid-tier castles
    injectRimLight(accent, new THREE.Color(p.accent), 5.0, 0.08);
  }

  const wood = new THREE.MeshStandardMaterial({
    color: p.woodTint,
    roughness: 0.85,
    metalness: 0,
  });

  const foundation = new THREE.MeshStandardMaterial({
    color: p.foundation,
    roughness: 0.95,
    metalness: 0,
  });

  return { primary, secondary, roof, accent, trim, glow, wood, foundation };
}

// ─── Vertex color gradient utility ──────────────────────────
//
// Paints a vertical gradient on mesh geometry using vertex colors.
// Bottom vertices get the shadow tone, top get the highlight tone.
// The gradient strength is scaled by quality — ruins are nearly flat,
// legendary has full richness.
//
// When vertexColors is enabled on MeshPhysicalMaterial, vertex colors
// MULTIPLY with the base material color. So we set vertex colors to
// near-white (1,1,1) in the mid range and slightly darker at the base,
// slightly brighter at the top. The base material color already carries
// the blended highlight, so vertex colors only need to add the
// highlight–shadow *variation*.

/**
 * Apply a vertical color gradient to a mesh's geometry.
 *
 * @param mesh      - The mesh to paint
 * @param shadow    - Shadow (bottom) tint color
 * @param highlight - Highlight (top) tint color
 * @param quality   - Current quality level (controls gradient depth)
 * @param yMin      - Optional: override min Y (default: auto from geometry)
 * @param yMax      - Optional: override max Y (default: auto from geometry)
 */
export function applyVerticalGradient(
  mesh: THREE.Mesh,
  shadow: number,
  highlight: number,
  quality: MaterialQuality,
  yMin?: number,
  yMax?: number
): void {
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  if (!pos) return;

  const gs = gradientStrength(quality);
  // For vertex color multiply mode, we blend between a slightly darkened
  // shadow factor and a slightly brightened highlight factor
  const shadowCol = new THREE.Color(shadow);
  const highlightCol = new THREE.Color(highlight);

  // Compute Y bounds from geometry if not provided
  let minY = yMin ?? Infinity;
  let maxY = yMax ?? -Infinity;
  if (yMin === undefined || yMax === undefined) {
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const range = maxY - minY;
  if (range < 0.001) {
    // Flat geometry — no gradient needed, fill with white (neutral)
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      colors[i * 3] = 1;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 1;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return;
  }

  const colors = new Float32Array(pos.count * 3);
  const white = new THREE.Color(1, 1, 1);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y - minY) / range; // 0 = bottom, 1 = top

    // Blend between shadow and highlight based on vertical position
    tmpColor.copy(shadowCol).lerp(highlightCol, t);

    // Blend with white (neutral) based on gradient strength.
    // gs=0 → all white (no gradient), gs=1 → full shadow/highlight
    tmpColor.copy(white).lerp(tmpColor, gs * 0.3);

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Convenience: apply the tier-appropriate gradient to a "primary" stone mesh.
 */
export function applyPrimaryGradient(
  mesh: THREE.Mesh,
  tier: CastleTier,
  quality: MaterialQuality
): void {
  const p = PALETTES[tier];
  applyVerticalGradient(mesh, p.primaryShadow, p.primaryHighlight, quality);
}

/**
 * Convenience: apply the tier-appropriate gradient to a "secondary" stone mesh.
 */
export function applySecondaryGradient(
  mesh: THREE.Mesh,
  tier: CastleTier,
  quality: MaterialQuality
): void {
  const p = PALETTES[tier];
  applyVerticalGradient(mesh, p.secondaryShadow, p.secondaryHighlight, quality);
}

/**
 * Convenience: apply a roof gradient (ridge highlight).
 */
export function applyRoofGradient(
  mesh: THREE.Mesh,
  tier: CastleTier,
  quality: MaterialQuality
): void {
  const p = PALETTES[tier];
  // Roofs: bottom edge is base color, peak is highlight
  applyVerticalGradient(mesh, p.roof, p.roofHighlight, quality);
}

// ─── Animated quality transition ────────────────────────────

/**
 * Snapshot of material numeric properties for interpolation.
 */
interface MaterialSnapshot {
  roughness: number;
  metalness: number;
  emissiveIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  color: THREE.Color;
  emissive: THREE.Color;
}

function snapshotMaterial(mat: THREE.MeshPhysicalMaterial): MaterialSnapshot {
  return {
    roughness: mat.roughness,
    metalness: mat.metalness,
    emissiveIntensity: mat.emissiveIntensity,
    clearcoat: mat.clearcoat,
    clearcoatRoughness: mat.clearcoatRoughness,
    sheen: mat.sheen,
    color: mat.color.clone(),
    emissive: mat.emissive.clone(),
  };
}

function applySnapshot(mat: THREE.MeshPhysicalMaterial, snap: MaterialSnapshot): void {
  mat.roughness = snap.roughness;
  mat.metalness = snap.metalness;
  mat.emissiveIntensity = snap.emissiveIntensity;
  mat.clearcoat = snap.clearcoat;
  mat.clearcoatRoughness = snap.clearcoatRoughness;
  mat.sheen = snap.sheen;
  mat.color.copy(snap.color);
  mat.emissive.copy(snap.emissive);
}

export type TransitionSlot = 'primary' | 'secondary' | 'roof' | 'accent' | 'trim' | 'glow';
const TRANSITION_SLOTS: TransitionSlot[] = ['primary', 'secondary', 'roof', 'accent', 'trim', 'glow'];

export interface QualityTransition {
  fromSnapshots: Map<TransitionSlot, MaterialSnapshot>;
  toSnapshots: Map<TransitionSlot, MaterialSnapshot>;
  progress: number;   // 0 → 1
  duration: number;   // seconds
  active: boolean;
}

/**
 * Begin a quality transition. Captures "from" snapshot from current materials
 * and "to" snapshot from newly created target materials (which get applied
 * at progress=1).
 */
export function beginQualityTransition(
  currentMats: TierMaterials,
  targetMats: TierMaterials,
  duration: number = 1.5
): QualityTransition {
  const fromSnapshots = new Map<TransitionSlot, MaterialSnapshot>();
  const toSnapshots = new Map<TransitionSlot, MaterialSnapshot>();

  for (const slot of TRANSITION_SLOTS) {
    fromSnapshots.set(slot, snapshotMaterial(currentMats[slot]));
    toSnapshots.set(slot, snapshotMaterial(targetMats[slot]));
  }

  return {
    fromSnapshots,
    toSnapshots,
    progress: 0,
    duration,
    active: true,
  };
}

/**
 * Advance transition and apply interpolated values to materials.
 * Returns true when transition is complete.
 */
export function updateQualityTransition(
  transition: QualityTransition,
  mats: TierMaterials,
  deltaSeconds: number
): boolean {
  if (!transition.active) return true;

  transition.progress = Math.min(1, transition.progress + deltaSeconds / transition.duration);

  // Smooth ease-in-out
  const t = smoothstep(transition.progress);

  for (const slot of TRANSITION_SLOTS) {
    const from = transition.fromSnapshots.get(slot)!;
    const to = transition.toSnapshots.get(slot)!;
    const mat = mats[slot];

    mat.roughness = lerp(from.roughness, to.roughness, t);
    mat.metalness = lerp(from.metalness, to.metalness, t);
    mat.emissiveIntensity = lerp(from.emissiveIntensity, to.emissiveIntensity, t);
    mat.clearcoat = lerp(from.clearcoat, to.clearcoat, t);
    mat.clearcoatRoughness = lerp(from.clearcoatRoughness, to.clearcoatRoughness, t);
    mat.sheen = lerp(from.sheen, to.sheen, t);
    mat.color.copy(from.color).lerp(to.color, t);
    mat.emissive.copy(from.emissive).lerp(to.emissive, t);
  }

  if (transition.progress >= 1) {
    transition.active = false;
    return true;
  }
  return false;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// ─── Decay blending ─────────────────────────────────────────

const GREY = new THREE.Color(0x6a6a6a);
const LEGENDARY_DECAY_GREY = new THREE.Color(0x8a7a8a); // warmer, purplish grey for elegant decay

/**
 * Apply decay to materials without reverting quality.
 *
 * Legendary decay: glow fades gently, roughness rises only slightly,
 * desaturation blends toward a warm grey (not cold). The castle feels
 * broken but still beautiful — tragic elegance. Critically:
 *   - roughness NEVER exceeds 0.55 (always smoother than normal quality)
 *   - metalness NEVER drops below 0.10 (retains premium reflections)
 *   - clearcoat degrades but never disappears (minimum floor of 0.10)
 *   - sheen fades but leaves a residual whisper (minimum floor of 0.05)
 *   - emissive retains warm residual glow even at full decay
 *
 * Lower tier decay: darker, rougher, more uneven, colder grey.
 */
export function applyDecayToMaterials(
  mats: TierMaterials,
  decay: number,
  quality: MaterialQuality,
  basePaint?: BasePaintStore
): void {
  const clampedDecay = Math.max(0, Math.min(1, decay));

  const isLegendary = quality === 'legendary';
  const isHigh = quality === 'high';

  // How much decay affects each quality — legendary is far more resistant
  const decayImpact = isLegendary ? clampedDecay * 0.35
    : isHigh ? clampedDecay * 0.55
    : clampedDecay * 0.85;

  const decayGrey = isLegendary ? LEGENDARY_DECAY_GREY : GREY;

  // Stone materials: roughness rises, desaturate, clearcoat degrades.
  // CRITICAL: Always compute FROM base paint, never accumulate.
  for (const key of ['primary', 'secondary', 'roof'] as const) {
    const mat = mats[key];
    const base = basePaint?.get(key);

    // Restore base color first, then apply decay tint as a computed blend
    if (base) {
      mat.color.copy(base.color);
      mat.roughness = base.roughness;
      if (isLegendary) mat.metalness = base.metalness;
    }

    if (clampedDecay < 0.001) continue;

    mat.roughness = Math.min(
      isLegendary ? 0.55 : 1,
      mat.roughness + decayImpact * 0.20
    );
    // Compute from base (or freshly restored) color — not cumulative
    mat.color.lerp(decayGrey, decayImpact * (isLegendary ? 0.10 : 0.20));

    if (isLegendary) {
      mat.metalness = Math.max(0.10, mat.metalness * (1 - decayImpact * 0.3));
    }

    // Clearcoat degrades with decay (surface gets scuffed)
    const baseClearcoat = base ? base.clearcoat : mat.clearcoat;
    if (baseClearcoat > 0) {
      mat.clearcoat = Math.max(
        isLegendary ? 0.10 : 0,
        baseClearcoat * (1 - decayImpact * 0.5)
      );
    }
    // Sheen fades
    const baseSheen = base ? base.sheen : mat.sheen;
    if (baseSheen > 0) {
      mat.sheen = Math.max(
        isLegendary ? 0.05 : 0,
        baseSheen * (1 - decayImpact * 0.4)
      );
    }

    // Color floor clamp — never let stone go black
    clampColorFloor(mat.color);
  }

  // Emissive fades — compute from base intensity, not cumulative multiply
  for (const key of ['accent', 'trim', 'glow', 'roof'] as const) {
    const mat = mats[key];
    const base = basePaint?.get(key);
    const baseIntensity = base ? base.emissiveIntensity : mat.emissiveIntensity;
    if (base) {
      mat.emissive.copy(base.emissive);
    }
    if (baseIntensity > 0) {
      const fadeFactor = isLegendary
        ? (1 - clampedDecay * 0.40)
        : (1 - clampedDecay * 0.75);
      mat.emissiveIntensity = baseIntensity * fadeFactor;
    }
  }

  // Accent/trim: slight desaturation, clearcoat degradation
  for (const key of ['accent', 'trim'] as const) {
    const mat = mats[key];
    const base = basePaint?.get(key);

    // Restore base color first, then compute decay blend
    if (base) {
      mat.color.copy(base.color);
      if (isLegendary) mat.metalness = base.metalness;
    }

    if (clampedDecay < 0.001) continue;

    mat.color.lerp(decayGrey, decayImpact * (isLegendary ? 0.06 : 0.15));
    const baseClearcoat = base ? base.clearcoat : mat.clearcoat;
    if (baseClearcoat > 0) {
      mat.clearcoat = Math.max(
        isLegendary ? 0.15 : 0,
        baseClearcoat * (1 - decayImpact * 0.3)
      );
    }
    if (isLegendary) {
      mat.metalness = Math.max(0.30, mat.metalness * (1 - decayImpact * 0.2));
    }

    // Color floor clamp — never let accent/trim go black
    clampColorFloor(mat.color);
  }
}

/**
 * Apply construction progress to materials.
 * Early construction → rough, matte appearance.
 */
export function applyConstructionToMaterials(
  mats: TierMaterials,
  progress: number,
  basePaint?: BasePaintStore
): void {
  if (progress >= 1) return;

  const rawness = 1 - progress; // 1 = totally raw, 0 = finished
  const constructionGrey = new THREE.Color(0x7A7060);

  for (const key of ['primary', 'secondary'] as const) {
    const mat = mats[key];
    const base = basePaint?.get(key);

    // Restore base values first, then compute construction blend
    if (base) {
      mat.color.copy(base.color);
      mat.roughness = base.roughness;
      mat.metalness = base.metalness;
      mat.clearcoat = base.clearcoat;
      mat.sheen = base.sheen;
    }

    mat.roughness = Math.min(1, mat.roughness + rawness * 0.3);
    mat.color.lerp(constructionGrey, rawness * 0.5);
    mat.metalness *= progress;
    mat.clearcoat *= progress;
    mat.sheen *= progress;

    // Color floor clamp
    clampColorFloor(mat.color);
  }

  // Trim/accent barely visible until > 60%
  const trimVisibility = Math.max(0, (progress - 0.6) / 0.4);
  for (const key of ['accent', 'trim', 'glow'] as const) {
    const mat = mats[key];
    const base = basePaint?.get(key);
    mat.opacity = trimVisibility;
    mat.transparent = trimVisibility < 1;

    const baseIntensity = base ? base.emissiveIntensity : mat.emissiveIntensity;
    if (baseIntensity > 0) {
      mat.emissiveIntensity = baseIntensity * trimVisibility;
    }
    const baseClearcoat = base ? base.clearcoat : mat.clearcoat;
    mat.clearcoat = baseClearcoat * trimVisibility;
    const baseSheen = base ? base.sheen : mat.sheen;
    mat.sheen = baseSheen * trimVisibility;
  }
}

// ─── Dispose helper ─────────────────────────────────────────

export function disposeTierMaterials(mats: TierMaterials): void {
  for (const key of Object.keys(mats) as (keyof TierMaterials)[]) {
    mats[key].dispose();
  }
}
