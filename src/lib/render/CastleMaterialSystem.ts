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
    // ─── Raw mud/thatch, very humble — earthy warm clay ─────────
    primary:            0x9C8860,
    primaryHighlight:   0xAA9670,
    primaryShadow:      0x8A7850,
    secondary:          0x7A6A4E,
    secondaryHighlight: 0x887A5C,
    secondaryShadow:    0x6C5C42,
    roof:               0x7A6840,
    roofHighlight:      0x8A7850,
    accent:             0xCC9E58,
    accentHighlight:    0xDCAE68,
    trim:               0xAA8040,
    trimHighlight:      0xBA9050,
    glow:               0x000000,
    foundation:         0x786A52,
    woodTint:           0x7A5A38,
  },
  cottage: {
    // ─── Warm fieldstone + timber, golden hour tones ────────────
    primary:            0xA89470,
    primaryHighlight:   0xB8A480,
    primaryShadow:      0x988460,
    secondary:          0x847058,
    secondaryHighlight: 0x928068,
    secondaryShadow:    0x76624A,
    roof:               0x6E5840,
    roofHighlight:      0x7E6850,
    accent:             0xD4AE60,
    accentHighlight:    0xE4BE70,
    trim:               0xBC9450,
    trimHighlight:      0xCCA460,
    glow:               0x000000,
    foundation:         0x7A7058,
    woodTint:           0x8A6A42,
  },
  tower: {
    // ─── Cut stone, warm grey with golden highlights ────────────
    primary:            0xA89880,
    primaryHighlight:   0xB8A890,
    primaryShadow:      0x988870,
    secondary:          0x8A7E6A,
    secondaryHighlight: 0x988E7A,
    secondaryShadow:    0x7C705E,
    roof:               0x5C4E3C,
    roofHighlight:      0x6C5E4C,
    accent:             0xD8B460,
    accentHighlight:    0xE8C470,
    trim:               0xC09A4C,
    trimHighlight:      0xD0AA5C,
    glow:               0x000000,
    foundation:         0x847A68,
    woodTint:           0x886840,
  },
  keep: {
    // ─── Warm sandstone, Bojnice-inspired golden buff ────────────
    primary:            0xB8A480,
    primaryHighlight:   0xC8B490,
    primaryShadow:      0xA89470,
    secondary:          0x948468,
    secondaryHighlight: 0xA29478,
    secondaryShadow:    0x86765A,
    roof:               0x5A4838,
    roofHighlight:      0x6A5848,
    accent:             0xE0B868,
    accentHighlight:    0xF0C878,
    trim:               0xCC9C50,
    trimHighlight:      0xDCAC60,
    glow:               0xC8A050,
    foundation:         0x8A7E68,
    woodTint:           0x8B6A43,
  },
  manor: {
    // ─── Rich sandstone, copper & bronze, warm elegance ─────────
    primary:            0xBCA888,
    primaryHighlight:   0xCCB898,
    primaryShadow:      0xAC9878,
    secondary:          0x98886C,
    secondaryHighlight: 0xA8987C,
    secondaryShadow:    0x8A7A5E,
    roof:               0x6E4438,
    roofHighlight:      0x7E5448,
    accent:             0xD8A850,
    accentHighlight:    0xE8B860,
    trim:               0xCC9844,
    trimHighlight:      0xDCA854,
    glow:               0xC09040,
    foundation:         0x8A8068,
    woodTint:           0x7E5E3E,
  },
  castle: {
    // ─── Neuschwanstein cream stone, slate roofs, regal ─────────
    primary:            0xC4B498,
    primaryHighlight:   0xD4C4A8,
    primaryShadow:      0xB4A488,
    secondary:          0xA89880,
    secondaryHighlight: 0xB8A890,
    secondaryShadow:    0x988870,
    roof:               0x504540,
    roofHighlight:      0x605550,
    accent:             0xDCB858,
    accentHighlight:    0xECC868,
    trim:               0xE0C060,
    trimHighlight:      0xF0D070,
    glow:               0xD4B050,
    foundation:         0x908474,
    woodTint:           0x7A5E3A,
  },
  stronghold: {
    // ─── Weathered fortress stone, iron-bound, formidable ───────
    primary:            0xA89888,
    primaryHighlight:   0xB8A898,
    primaryShadow:      0x988878,
    secondary:          0x8C7E70,
    secondaryHighlight: 0x9C8E80,
    secondaryShadow:    0x7E7062,
    roof:               0x4A3C34,
    roofHighlight:      0x5A4C44,
    accent:             0xD4A848,
    accentHighlight:    0xE4B858,
    trim:               0xCC9C40,
    trimHighlight:      0xDCAC50,
    glow:               0xD0A848,
    foundation:         0x7E746A,
    woodTint:           0x6A5038,
  },
  fortress: {
    // ─── Grand limestone, rich warm walls, bronze details ───────
    primary:            0xC8B89C,
    primaryHighlight:   0xD8C8AC,
    primaryShadow:      0xB8A88C,
    secondary:          0xAA9A82,
    secondaryHighlight: 0xBAAA92,
    secondaryShadow:    0x9A8A74,
    roof:               0x5C4030,
    roofHighlight:      0x6C5040,
    accent:             0xE8C458,
    accentHighlight:    0xF8D468,
    trim:               0xDCB44C,
    trimHighlight:      0xECC45C,
    glow:               0xE0C050,
    foundation:         0x948878,
    woodTint:           0x6E5238,
  },
  palace: {
    // ─── Elegant warm marble, rose-gold, sunset stone ───────────
    primary:            0xD0C0A4,
    primaryHighlight:   0xE0D0B4,
    primaryShadow:      0xC0B094,
    secondary:          0xB4A48C,
    secondaryHighlight: 0xC4B49C,
    secondaryShadow:    0xA4947C,
    roof:               0x6A4838,
    roofHighlight:      0x7A5848,
    accent:             0xE8CC78,
    accentHighlight:    0xF8DC88,
    trim:               0xE0C060,
    trimHighlight:      0xF0D078,
    glow:               0xE0C060,
    foundation:         0xA09484,
    woodTint:           0x8A7058,
  },
  citadel: {
    // ─── Premium: warm ivory, burnished gold, fairy-tale ────────
    primary:            0xD8C8AC,
    primaryHighlight:   0xE8D8BC,
    primaryShadow:      0xC8B89C,
    secondary:          0xBCAC90,
    secondaryHighlight: 0xCCBCA0,
    secondaryShadow:    0xAC9C82,
    roof:               0x584030,
    roofHighlight:      0x685040,
    accent:             0xF0D470,
    accentHighlight:    0xFFE488,
    trim:               0xF0D060,
    trimHighlight:      0xFFE078,
    glow:               0xF0D870,
    foundation:         0xA89C88,
    woodTint:           0x9A8068,
  },
  empire: {
    // ─── Imperial: polished sandstone, commanding gold ──────────
    primary:            0xDCD0B0,
    primaryHighlight:   0xECE0C0,
    primaryShadow:      0xCCC0A0,
    secondary:          0xC0B498,
    secondaryHighlight: 0xD0C4A8,
    secondaryShadow:    0xB0A488,
    roof:               0x504038,
    roofHighlight:      0x605048,
    accent:             0xF4DC78,
    accentHighlight:    0xFFEC90,
    trim:               0xF0D450,
    trimHighlight:      0xFFE468,
    glow:               0xF4DC70,
    foundation:         0xACA090,
    woodTint:           0x887060,
  },
  legend: {
    // ─── Mythic: luminous warm white, radiant golden glow ───────
    primary:            0xE4D8C0,
    primaryHighlight:   0xF0E8D4,
    primaryShadow:      0xD4C8B0,
    secondary:          0xCCC0A8,
    secondaryHighlight: 0xDCD0B8,
    secondaryShadow:    0xBCB098,
    roof:               0x584840,
    roofHighlight:      0x685850,
    accent:             0xFCE888,
    accentHighlight:    0xFFF4A8,
    trim:               0xF8E068,
    trimHighlight:      0xFFF088,
    glow:               0xFFECA0,
    foundation:         0xB8AC98,
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
    case 'ruins':     return { stone: 0.82, roof: 0.68, accent: 0.42 };
    case 'normal':    return { stone: 0.55, roof: 0.42, accent: 0.20 };
    case 'high':      return { stone: 0.36, roof: 0.26, accent: 0.10 };
    case 'legendary': return { stone: 0.24, roof: 0.18, accent: 0.06 };
  }
}

function qualityMetalness(q: MaterialQuality): SurfaceParams {
  switch (q) {
    case 'ruins':     return { stone: 0.03, roof: 0.03, accent: 0.28 };
    case 'normal':    return { stone: 0.12, roof: 0.10, accent: 0.58 };
    case 'high':      return { stone: 0.20, roof: 0.20, accent: 0.78 };
    case 'legendary': return { stone: 0.25, roof: 0.30, accent: 0.90 };
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
      return { clearcoat: 0.04, clearcoatRoughness: 0.75, sheen: 0.03, sheenRoughness: 0.75, sheenColor: 0xC0A880 };
    case 'normal':
      return { clearcoat: 0.12, clearcoatRoughness: 0.50, sheen: 0.08, sheenRoughness: 0.60, sheenColor: 0xD8C8B0 };
    case 'high':
      return { clearcoat: 0.25, clearcoatRoughness: 0.30, sheen: 0.16, sheenRoughness: 0.45, sheenColor: 0xE8D8C0 };
    case 'legendary':
      return { clearcoat: 0.45, clearcoatRoughness: 0.15, sheen: 0.35, sheenRoughness: 0.25, sheenColor: 0xFFF0D0 };
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

  // Primary stone — warm stone base with subtle self-illumination at higher tiers
  const primary = new THREE.MeshPhysicalMaterial({
    color: blendedPrimary,
    roughness: qr.stone,
    metalness: qm.stone,
    // Higher tiers get a faint warm emissive so stone glows subtly even in shadow
    emissive: isLegendary ? new THREE.Color(0x806040) : (usesPhysical ? new THREE.Color(0x403020) : new THREE.Color(0x000000)),
    emissiveIntensity: isLegendary ? 0.08 : (usesPhysical ? 0.03 : 0),
    clearcoat: qp.clearcoat,
    clearcoatRoughness: qp.clearcoatRoughness,
    sheen: qp.sheen,
    sheenRoughness: qp.sheenRoughness,
    sheenColor: new THREE.Color(qp.sheenColor),
    vertexColors: true,  // enable vertex-color blending for gradients
  });

  const secondary = new THREE.MeshPhysicalMaterial({
    color: blendedSecondary,
    roughness: qr.stone + 0.04,
    metalness: qm.stone,
    emissive: isLegendary ? new THREE.Color(0x604830) : new THREE.Color(0x000000),
    emissiveIntensity: isLegendary ? 0.05 : 0,
    clearcoat: qp.clearcoat * 0.8,
    clearcoatRoughness: qp.clearcoatRoughness + 0.08,
    sheen: qp.sheen * 0.6,
    sheenRoughness: qp.sheenRoughness,
    sheenColor: new THREE.Color(qp.sheenColor),
    vertexColors: true,
  });

  const roof = new THREE.MeshPhysicalMaterial({
    color: blendedRoof,
    roughness: qr.roof,
    metalness: isLegendary ? 0.45 : (usesPhysical ? 0.25 : qm.roof),
    emissive: isLegendary ? new THREE.Color(0x604030) : (usesPhysical ? new THREE.Color(0x302018) : new THREE.Color(0x000000)),
    emissiveIntensity: isLegendary ? 0.12 : (usesPhysical ? 0.04 : 0),
    clearcoat: isLegendary ? 0.55 : (usesPhysical ? 0.28 : qp.clearcoat * 0.5),
    clearcoatRoughness: isLegendary ? 0.12 : 0.40,
    sheen: isLegendary ? 0.35 : (usesPhysical ? 0.10 : 0),
    sheenRoughness: 0.3,
    sheenColor: new THREE.Color(isLegendary ? 0xFFF0C0 : 0xD0B090),
    vertexColors: true,
  });

  const accent = new THREE.MeshPhysicalMaterial({
    color: blendedAccent,
    roughness: qr.accent,
    metalness: qm.accent,
    emissive: new THREE.Color(p.accent),
    emissiveIntensity: isLegendary ? 0.40 : (quality === 'high' ? 0.18 : (quality === 'normal' ? 0.08 : 0.04)),
    clearcoat: isLegendary ? 0.65 : (usesPhysical ? 0.35 : qp.clearcoat),
    clearcoatRoughness: isLegendary ? 0.08 : (usesPhysical ? 0.25 : qp.clearcoatRoughness),
    sheen: isLegendary ? 0.45 : qp.sheen,
    sheenRoughness: 0.20,
    sheenColor: new THREE.Color(isLegendary ? 0xFFF8E1 : qp.sheenColor),
  });

  const trim = new THREE.MeshPhysicalMaterial({
    color: blendedTrim,
    roughness: qr.accent,
    metalness: qm.accent + 0.1,
    emissive: (isLegendary || quality === 'high' || quality === 'normal')
      ? new THREE.Color(p.trim) : new THREE.Color(0x000000),
    emissiveIntensity: isLegendary ? 0.35 : (quality === 'high' ? 0.14 : (quality === 'normal' ? 0.06 : 0)),
    clearcoat: isLegendary ? 0.60 : (usesPhysical ? 0.30 : qp.clearcoat),
    clearcoatRoughness: isLegendary ? 0.08 : (usesPhysical ? 0.25 : qp.clearcoatRoughness),
    sheen: isLegendary ? 0.40 : qp.sheen,
    sheenRoughness: 0.20,
    sheenColor: new THREE.Color(isLegendary ? 0xFFF0C0 : qp.sheenColor),
  });

  const glow = new THREE.MeshPhysicalMaterial({
    color: isLegendary ? p.glow : 0xFFD080,
    roughness: 0.08,
    metalness: 0.80,
    emissive: new THREE.Color(isLegendary ? p.glow : 0xFFD080),
    emissiveIntensity: isLegendary ? 0.85 : 0.40,
    clearcoat: isLegendary ? 0.85 : 0.35,
    clearcoatRoughness: 0.04,
    sheen: isLegendary ? 0.55 : 0.10,
    sheenRoughness: 0.18,
    sheenColor: new THREE.Color(0xFFF8E1),
  });

  // Inject rim lighting — warm golden edge glow for premium feel
  if (isLegendary) {
    injectRimLight(primary, rimCol, 2.8, 0.45);
    injectRimLight(secondary, rimCol, 2.8, 0.35);
    injectRimLight(roof, new THREE.Color(0xFFE8B0), 2.2, 0.30);
    injectRimLight(accent, new THREE.Color(0xFFF8E0), 1.8, 0.55);
    injectRimLight(trim, new THREE.Color(0xFFE878), 2.0, 0.50);
    injectRimLight(glow, new THREE.Color(0xFFFFFF), 1.6, 0.70);
  } else if (quality === 'high') {
    // Warm rim for high quality — makes fortress/palace pop
    injectRimLight(primary, new THREE.Color(0xD0B080), 4.5, 0.10);
    injectRimLight(accent, new THREE.Color(0xFFD860), 3.5, 0.22);
    injectRimLight(trim, new THREE.Color(0xFFC850), 3.5, 0.18);
  } else if (quality === 'normal') {
    // Faint warm rim on stone + accent — mid-tier castles feel alive
    injectRimLight(primary, new THREE.Color(0xC0A070), 5.0, 0.06);
    injectRimLight(accent, new THREE.Color(p.accent), 4.5, 0.12);
  }

  const wood = new THREE.MeshStandardMaterial({
    color: p.woodTint,
    roughness: 0.82,
    metalness: 0.02,
  });

  const foundation = new THREE.MeshStandardMaterial({
    color: p.foundation,
    roughness: 0.90,
    metalness: 0.02,
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

const GREY = new THREE.Color(0x787060); // warm grey-brown (not cold grey)
const LEGENDARY_DECAY_GREY = new THREE.Color(0x988878); // warm sandy grey for elegant decay

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
  const constructionGrey = new THREE.Color(0x8A7E68); // warm raw stone

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
