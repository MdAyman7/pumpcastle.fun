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
  keep: {
    // ─── Dull stone, earthy browns, flat greys ──────────────────
    primary:            0x9B8B6E,  // warm stone
    primaryHighlight:   0xA89880,  // only slightly lighter — muted
    primaryShadow:      0x8A7A5E,  // barely darker
    secondary:          0x7A6B55,
    secondaryHighlight: 0x877862,
    secondaryShadow:    0x6E604C,
    roof:               0x6B5A44,
    roofHighlight:      0x7A6A54,
    accent:             0xD4A76A,
    accentHighlight:    0xDEB87A,
    trim:               0xB8854D,
    trimHighlight:      0xC89560,
    glow:               0x000000,
    foundation:         0x7A7060,
    woodTint:           0x8B6A43,
  },
  castle: {
    // ─── Clean stone, balanced neutrals, subtle blue-grey ───────
    primary:            0x8095A8,  // blue-grey stone
    primaryHighlight:   0x96AAB8,  // cooler, brighter crown
    primaryShadow:      0x6A8095,  // deeper blue-grey base
    secondary:          0x5C6E7F,
    secondaryHighlight: 0x6E8090,
    secondaryShadow:    0x4E6070,
    roof:               0x8B1A1A,  // deep crimson
    roofHighlight:      0xA02828,  // brighter crimson peak
    accent:             0xC9A84C,  // rich gold
    accentHighlight:    0xD8BA60,
    trim:               0xDEB953,
    trimHighlight:      0xE8CA68,
    glow:               0x000000,
    foundation:         0x6A6E78,
    woodTint:           0x7A5E3A,
  },
  fortress: {
    // ─── Brighter stone, subtle color variation, warm highlights ─
    primary:            0x5878A8,  // royal blue
    primaryHighlight:   0x7090C0,  // clear bright blue crown
    primaryShadow:      0x486898,  // deeper royal base
    secondary:          0x3D5A8A,
    secondaryHighlight: 0x5070A0,
    secondaryShadow:    0x304E7A,
    roof:               0x7A1830,  // burgundy
    roofHighlight:      0x9A2840,  // brighter burgundy ridge
    accent:             0xFFD54F,  // bright gold
    accentHighlight:    0xFFE070,  // warm gold highlight
    trim:               0xFFB74D,  // warm gold
    trimHighlight:      0xFFC868,
    glow:               0xFFD54F,
    foundation:         0x5A6478,
    woodTint:           0x6E5238,
  },
  citadel: {
    // ─── Premium: ivory, pearl, gold, soft blue — Disney fairy-tale ─
    primary:            0xC4B8E0,  // softer lavender stone
    primaryHighlight:   0xD8CEF0,  // pearl-white lavender crown (brighter, cleaner)
    primaryShadow:      0xB0A4D0,  // slightly deeper lavender base
    secondary:          0x9A8CC8,  // deeper lavender
    secondaryHighlight: 0xB0A4D8,  // soft highlight
    secondaryShadow:    0x8A7CB8,
    roof:               0xFFE89A,  // warm golden roof
    roofHighlight:      0xFFF0B8,  // bright golden ridge
    accent:             0xFFFBEF,  // bright ivory / cream
    accentHighlight:    0xFFFFFF,  // pure white highlight
    trim:               0xFFDD63,  // rich gold
    trimHighlight:      0xFFE880,  // warm bright gold
    glow:               0xFFE89A,  // warm bloom
    foundation:         0xA8A0B8,
    woodTint:           0x9A8068,
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
    case 'ruins':     return 0.15; // barely any gradient — flat, muted
    case 'normal':    return 0.40; // noticeable but subtle
    case 'high':      return 0.70; // clearly polished
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
    case 'ruins':     return { stone: 0.92, roof: 0.75, accent: 0.55 };
    case 'normal':    return { stone: 0.72, roof: 0.58, accent: 0.35 };
    case 'high':      return { stone: 0.48, roof: 0.38, accent: 0.18 };
    case 'legendary': return { stone: 0.32, roof: 0.25, accent: 0.10 };
  }
}

function qualityMetalness(q: MaterialQuality): SurfaceParams {
  switch (q) {
    case 'ruins':     return { stone: 0.0, roof: 0.0,  accent: 0.15 };
    case 'normal':    return { stone: 0.05, roof: 0.05, accent: 0.45 };
    case 'high':      return { stone: 0.14, roof: 0.12, accent: 0.70 };
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
    case 'normal':
      return { clearcoat: 0, clearcoatRoughness: 1, sheen: 0, sheenRoughness: 1, sheenColor: 0x000000 };
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
    emissive: isLegendary || quality === 'high'
      ? new THREE.Color(p.accent)
      : new THREE.Color(0x000000),
    emissiveIntensity: isLegendary ? 0.30 : (quality === 'high' ? 0.12 : 0),
    clearcoat: isLegendary ? 0.6 : (usesPhysical ? 0.3 : 0),
    clearcoatRoughness: isLegendary ? 0.1 : 0.3,
    sheen: isLegendary ? 0.4 : 0,
    sheenRoughness: 0.25,
    sheenColor: new THREE.Color(isLegendary ? 0xFFF8E1 : 0x000000),
  });

  const trim = new THREE.MeshPhysicalMaterial({
    color: blendedTrim,
    roughness: qr.accent,
    metalness: qm.accent + 0.1,
    emissive: isLegendary ? new THREE.Color(p.trim) : new THREE.Color(0x000000),
    emissiveIntensity: isLegendary ? 0.25 : 0,
    clearcoat: isLegendary ? 0.55 : (usesPhysical ? 0.25 : 0),
    clearcoatRoughness: isLegendary ? 0.1 : 0.3,
    sheen: isLegendary ? 0.35 : 0,
    sheenRoughness: 0.25,
    sheenColor: new THREE.Color(isLegendary ? 0xFFF0C0 : 0x000000),
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
  quality: MaterialQuality
): void {
  const clampedDecay = Math.max(0, Math.min(1, decay));
  if (clampedDecay < 0.001) return;

  const isLegendary = quality === 'legendary';
  const isHigh = quality === 'high';

  // How much decay affects each quality — legendary is far more resistant
  const decayImpact = isLegendary ? clampedDecay * 0.35
    : isHigh ? clampedDecay * 0.55
    : clampedDecay * 0.85;

  const decayGrey = isLegendary ? LEGENDARY_DECAY_GREY : GREY;

  // Stone materials: roughness rises, desaturate, clearcoat degrades
  for (const key of ['primary', 'secondary', 'roof'] as const) {
    const mat = mats[key];
    mat.roughness = Math.min(
      isLegendary ? 0.55 : 1,  // legendary: never rougher than "normal" quality stone
      mat.roughness + decayImpact * 0.20
    );
    mat.color.lerp(decayGrey, decayImpact * (isLegendary ? 0.10 : 0.20));

    if (isLegendary) {
      // Legendary: metalness never drops below floor — retains premium reflections
      mat.metalness = Math.max(0.10, mat.metalness * (1 - decayImpact * 0.3));
    }

    // Clearcoat degrades with decay (surface gets scuffed)
    if (mat.clearcoat > 0) {
      mat.clearcoat = Math.max(
        isLegendary ? 0.10 : 0,  // legendary: always retains some clearcoat
        mat.clearcoat * (1 - decayImpact * 0.5)
      );
    }
    // Sheen fades
    if (mat.sheen > 0) {
      mat.sheen = Math.max(
        isLegendary ? 0.05 : 0,  // legendary: ghost of former luster
        mat.sheen * (1 - decayImpact * 0.4)
      );
    }
  }

  // Emissive fades — legendary fades slower and keeps a warm residual glow
  for (const key of ['accent', 'trim', 'glow', 'roof'] as const) {
    const mat = mats[key];
    if (mat.emissiveIntensity > 0) {
      const fadeFactor = isLegendary
        ? (1 - clampedDecay * 0.40)   // legendary retains 60% glow even at full decay
        : (1 - clampedDecay * 0.75);
      mat.emissiveIntensity *= fadeFactor;
    }
  }

  // Accent/trim: slight desaturation, clearcoat degradation
  for (const key of ['accent', 'trim'] as const) {
    const mat = mats[key];
    mat.color.lerp(decayGrey, decayImpact * (isLegendary ? 0.06 : 0.15));
    if (mat.clearcoat > 0) {
      mat.clearcoat = Math.max(
        isLegendary ? 0.15 : 0, // legendary accents: always a hint of polish
        mat.clearcoat * (1 - decayImpact * 0.3)
      );
    }
    if (isLegendary) {
      // Legendary accents: metalness floor — gold never becomes dull stone
      mat.metalness = Math.max(0.30, mat.metalness * (1 - decayImpact * 0.2));
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
  if (progress >= 1) return;

  const rawness = 1 - progress; // 1 = totally raw, 0 = finished

  for (const key of ['primary', 'secondary'] as const) {
    const mat = mats[key];
    mat.roughness = Math.min(1, mat.roughness + rawness * 0.3);
    mat.color.lerp(new THREE.Color(0x7A7060), rawness * 0.5);
    mat.metalness *= progress;
    // Kill clearcoat/sheen during construction
    mat.clearcoat *= progress;
    mat.sheen *= progress;
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
    mat.clearcoat *= trimVisibility;
    mat.sheen *= trimVisibility;
  }
}

// ─── Dispose helper ─────────────────────────────────────────

export function disposeTierMaterials(mats: TierMaterials): void {
  for (const key of Object.keys(mats) as (keyof TierMaterials)[]) {
    mats[key].dispose();
  }
}
