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
    // ─── Disney / fairy-tale palette (softer, brighter) ──────────
    primary:   0xC4B8E0,  // softer lavender stone
    secondary: 0x9A8CC8,  // deeper lavender
    roof:      0xFFE89A,  // warm golden roof
    accent:    0xFFFBEF,  // bright ivory / cream
    trim:      0xFFDD63,  // rich gold
    glow:      0xFFE89A,  // warm bloom
  },
};

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

  const usesPhysical = quality === 'high' || quality === 'legendary';
  const isLegendary = quality === 'legendary';
  const rimCol = isLegendary ? new THREE.Color(p.glow || 0xFFE8C0) : new THREE.Color(0x000000);

  const primary = new THREE.MeshPhysicalMaterial({
    color: p.primary,
    roughness: qr.stone,
    metalness: qm.stone,
    clearcoat: qp.clearcoat,
    clearcoatRoughness: qp.clearcoatRoughness,
    sheen: qp.sheen,
    sheenRoughness: qp.sheenRoughness,
    sheenColor: new THREE.Color(qp.sheenColor),
  });

  const secondary = new THREE.MeshPhysicalMaterial({
    color: p.secondary,
    roughness: qr.stone + 0.05,
    metalness: qm.stone,
    clearcoat: qp.clearcoat * 0.7,
    clearcoatRoughness: qp.clearcoatRoughness + 0.1,
    sheen: qp.sheen * 0.5,
    sheenRoughness: qp.sheenRoughness,
    sheenColor: new THREE.Color(qp.sheenColor),
  });

  const roof = new THREE.MeshPhysicalMaterial({
    color: p.roof,
    roughness: qr.roof,
    metalness: isLegendary ? 0.40 : qm.roof,
    emissive: isLegendary ? new THREE.Color(p.roof) : new THREE.Color(0x000000),
    emissiveIntensity: isLegendary ? 0.10 : 0,
    clearcoat: isLegendary ? 0.5 : (usesPhysical ? 0.2 : 0),
    clearcoatRoughness: isLegendary ? 0.15 : 0.5,
    sheen: isLegendary ? 0.3 : 0,
    sheenRoughness: 0.3,
    sheenColor: new THREE.Color(isLegendary ? 0xFFF0C0 : 0x000000),
  });

  const accent = new THREE.MeshPhysicalMaterial({
    color: p.accent,
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
    color: p.trim,
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
 * broken but still beautiful — tragic elegance.
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
  const decayImpact = isLegendary ? clampedDecay * 0.40
    : isHigh ? clampedDecay * 0.60
    : clampedDecay * 0.85;

  const decayGrey = isLegendary ? LEGENDARY_DECAY_GREY : GREY;

  // Stone materials: roughness rises, desaturate, clearcoat degrades
  for (const key of ['primary', 'secondary', 'roof'] as const) {
    const mat = mats[key];
    mat.roughness = Math.min(1, mat.roughness + decayImpact * 0.20);
    mat.color.lerp(decayGrey, decayImpact * (isLegendary ? 0.12 : 0.20));

    // Clearcoat degrades with decay (surface gets scuffed)
    if (mat.clearcoat > 0) {
      mat.clearcoat *= (1 - decayImpact * 0.5);
    }
    // Sheen fades
    if (mat.sheen > 0) {
      mat.sheen *= (1 - decayImpact * 0.4);
    }
  }

  // Emissive fades — legendary fades slower and keeps a warm residual glow
  for (const key of ['accent', 'trim', 'glow', 'roof'] as const) {
    const mat = mats[key];
    if (mat.emissiveIntensity > 0) {
      const fadeFactor = isLegendary
        ? (1 - clampedDecay * 0.50)   // legendary retains half glow even at full decay
        : (1 - clampedDecay * 0.75);
      mat.emissiveIntensity *= fadeFactor;
    }
  }

  // Accent/trim: slight desaturation, clearcoat degradation
  for (const key of ['accent', 'trim'] as const) {
    const mat = mats[key];
    mat.color.lerp(decayGrey, decayImpact * (isLegendary ? 0.08 : 0.15));
    if (mat.clearcoat > 0) {
      mat.clearcoat *= (1 - decayImpact * 0.3);
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
