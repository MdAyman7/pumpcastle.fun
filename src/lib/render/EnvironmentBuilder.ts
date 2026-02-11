/**
 * EnvironmentBuilder.ts
 *
 * Builds and manages environment elements:
 * - Terrain/ground
 * - Hills
 * - Sky
 * - Trees/foliage
 */

import * as THREE from 'three';
import type { RenderState, CastleTier } from '$lib/types';
import type { WeatherRenderState } from '$lib/state/WeatherState';
import { qualitySettings } from './QualitySettings';
import { getPriceMoodColor } from './TokenIdentity';

export class EnvironmentBuilder {
  private scene: THREE.Scene;
  private environmentGroup: THREE.Group;

  // Ground mesh
  private groundMesh: THREE.Mesh | null = null;
  private groundMaterial: THREE.MeshStandardMaterial;

  // Hills
  private hills: THREE.Mesh[] = [];

  // Trees
  private trees: THREE.Group[] = [];

  // Shared tree geometries (reused across all trees — saves ~90 geometry allocations)
  private trunkGeometry!: THREE.CylinderGeometry;
  private foliageCone1Geometry!: THREE.ConeGeometry;
  private foliageCone2Geometry!: THREE.ConeGeometry;
  private foliageCone3Geometry!: THREE.ConeGeometry;

  // Shared foliage materials — pool of ~6 green variants (instead of unique per-tree)
  private foliageMaterials: THREE.MeshStandardMaterial[] = [];
  private trunkMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.environmentGroup = new THREE.Group();
    this.environmentGroup.name = 'environment';
    this.scene.add(this.environmentGroup);

    this.groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x5e9658,
      roughness: 0.78,
      metalness: 0.0,
      vertexColors: true
    });

    // ─── Shared tree geometries (allocated once) ──────────────
    this.trunkGeometry = new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6);
    this.foliageCone1Geometry = new THREE.ConeGeometry(1.2, 1.5, 6);
    this.foliageCone2Geometry = new THREE.ConeGeometry(0.9, 1.2, 6);
    this.foliageCone3Geometry = new THREE.ConeGeometry(0.6, 1, 6);

    // ─── Pre-built material pools ─────────────────────────────
    // 6 foliage color variants × 3 lightness tiers = 18 materials
    // (vs ~90 unique materials in the old system)
    const foliageVariants = [
      { h: 0.28, s: 0.55, l: 0.32 },
      { h: 0.30, s: 0.60, l: 0.34 },
      { h: 0.32, s: 0.52, l: 0.30 },
      { h: 0.34, s: 0.65, l: 0.36 },
      { h: 0.29, s: 0.57, l: 0.33 },
      { h: 0.33, s: 0.50, l: 0.35 },
    ];
    for (const v of foliageVariants) {
      for (const boost of [0, 0.03, 0.06]) {
        this.foliageMaterials.push(new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(v.h, v.s, Math.min(0.42, v.l + boost)),
          roughness: 0.62,
        }));
      }
    }
    // 3 trunk color variants
    for (let i = 0; i < 3; i++) {
      const hue = 0.06 + i * 0.01;
      this.trunkMaterials.push(new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue, 0.35, 0.22 + i * 0.03),
        roughness: 0.82,
      }));
    }
  }

  /**
   * Build the terrain
   */
  buildTerrain(): void {
    // Main ground plane with some undulation
    const groundGeom = new THREE.PlaneGeometry(100, 100, 50, 50);

    // Add some height variation
    const positions = groundGeom.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getY(i); // Y in plane space = Z in world

      // Gentle hills
      let height = Math.sin(x * 0.1) * Math.cos(z * 0.1) * 0.5;

      // Keep center flat for castle
      const distFromCenter = Math.sqrt(x * x + z * z);
      if (distFromCenter < 15) {
        height *= distFromCenter / 15;
      }

      positions.setZ(i, height);
    }

    groundGeom.computeVertexNormals();

    // Vertex colors: subtle green variation across the terrain.
    // Center = slightly brighter (sunlit clearing), edges = richer/darker.
    // Adds organic life to what would otherwise be a flat-colored plane.
    const vertexCount = positions.count;
    const colors = new Float32Array(vertexCount * 3);
    const baseGreen = new THREE.Color(0x5e9658);
    const brightPatch = new THREE.Color(0x72b06e); // sunlit patch
    const richPatch = new THREE.Color(0x4d8248);   // lush shadow
    const dryPatch = new THREE.Color(0x7a9450);    // slight yellow-green

    for (let i = 0; i < vertexCount; i++) {
      const x = positions.getX(i);
      const z = positions.getY(i);
      const dist = Math.sqrt(x * x + z * z);

      // Start from base
      const c = baseGreen.clone();

      // Sunlit clearing near center — brighter, warmer green
      if (dist < 18) {
        const centerFactor = 1 - dist / 18;
        c.lerp(brightPatch, centerFactor * 0.35);
      }

      // Richer lush green at mid-distance (where trees grow)
      if (dist > 10 && dist < 30) {
        const midFactor = 1 - Math.abs(dist - 20) / 10;
        c.lerp(richPatch, midFactor * 0.2);
      }

      // Slight noise-like variation using cheap sine hashing
      const noise = Math.sin(x * 0.8 + z * 1.1) * Math.cos(x * 0.5 - z * 0.7);
      if (noise > 0.3) {
        c.lerp(brightPatch, (noise - 0.3) * 0.25);
      } else if (noise < -0.3) {
        c.lerp(dryPatch, (-noise - 0.3) * 0.2);
      }

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    groundGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.groundMesh = new THREE.Mesh(groundGeom, this.groundMaterial);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.environmentGroup.add(this.groundMesh);

    // Add hills in background
    this.addHills();

    // Add trees
    this.addTrees();
  }

  /**
   * Add background hills
   */
  private addHills(): void {
    const hillPositions = [
      { x: -30, z: -25, radius: 15, height: 8 },
      { x: 25, z: -30, radius: 12, height: 6 },
      { x: -20, z: -35, radius: 10, height: 5 },
      { x: 35, z: -20, radius: 8, height: 4 },
      { x: 0, z: -40, radius: 20, height: 10 }
    ];

    // Each hill gets a unique tint. Distant hills shift slightly blue-green
    // (aerial perspective), closer hills are warmer green.
    const baseHillColor = new THREE.Color(0x6a9a65);
    const distantTint = new THREE.Color(0x6a8a7a); // blue-green for distance

    for (const pos of hillPositions) {
      const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
      const distanceFactor = Math.min(1, dist / 50); // 0 near, 1 far

      const hillColor = baseHillColor.clone();
      hillColor.lerp(distantTint, distanceFactor * 0.3);
      // Per-hill noise variation
      const noise = Math.sin(pos.x * 0.3 + pos.z * 0.2) * 0.5 + 0.5;
      const hsl = { h: 0, s: 0, l: 0 };
      hillColor.getHSL(hsl);
      hillColor.setHSL(
        hsl.h + (noise - 0.5) * 0.02, // slight hue shift
        hsl.s + (noise - 0.5) * 0.06, // saturation variation
        hsl.l + (noise - 0.5) * 0.04  // brightness variation
      );

      const hillMaterial = new THREE.MeshStandardMaterial({
        color: hillColor,
        roughness: 0.82 + distanceFactor * 0.06 // distant hills slightly rougher
      });

      const hillGeom = new THREE.SphereGeometry(pos.radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const hill = new THREE.Mesh(hillGeom, hillMaterial);
      hill.position.set(pos.x, 0, pos.z);
      hill.scale.y = pos.height / pos.radius;
      hill.receiveShadow = true;
      this.environmentGroup.add(hill);
      this.hills.push(hill);
    }
  }

  /**
   * Check if a tree position conflicts with a road or entrance for a given tier.
   * Returns true if the position is too close to a road/entrance and should be excluded.
   */
  private isOnRoad(x: number, z: number, wallRadius: number, isLegendary?: boolean): boolean {
    // Castle entrance zone (broader exclusion near gate)
    if (Math.abs(x) < 4 && z > 0 && z < wallRadius + 8) return true;

    // ─── Legendary / Citadel: spline roads + plazas ──────────
    if (isLegendary) {
      const RING_R = wallRadius + 6;
      const distFromCenter = Math.sqrt(x * x + z * z);

      // Inner ceremonial zone — no trees within ring + very generous margin.
      // This creates the calm, powerful, intentional open space around the castle.
      // Radius 26 clears all inner trees and near-ring edge cases.
      if (distFromCenter < RING_R + 6) return true;

      // Forward approach cone — the +Z direction (main avenue / entrance) should
      // be completely clear of trees out to a significant distance.
      // Any tree with z > 0 and within ±30° of the main axis gets excluded.
      if (z > 0 && Math.abs(x) < z * 0.65 && distFromCenter < 38) return true;

      // Main avenue: X ≈ 0, from gate to end (+Z) — wide clearance
      if (Math.abs(x) < 5 && z > wallRadius - 2) return true;

      // Ring boulevard (wider exclusion for legendary smooth ring)
      if (Math.abs(distFromCenter - RING_R) < 3.5) return true;

      // Promenades: ±X curves from ring outward and backward (−Z direction)
      for (const side of [-1, 1]) {
        if (side > 0 && x > RING_R - 3 && x < RING_R + 16 && z > -9 && z < 3) return true;
        if (side < 0 && x < -RING_R + 3 && x > -RING_R - 16 && z > -9 && z < 3) return true;
      }

      // Rear processional path (−Z)
      if (Math.abs(x) < 3 && z < -RING_R + 2 && z > -RING_R - 14) return true;

      // ─── Plaza exclusion zones ────────────────────────────
      // Grand entrance plaza at (0, RING_R), radius 6 + generous margin
      const dxGrand = x;
      const dzGrand = z - RING_R;
      if (dxGrand * dxGrand + dzGrand * dzGrand < 9.5 * 9.5) return true;

      // Outer waypoint plaza at (0, RING_R+10), radius 3.5 + margin
      const dzWaypoint = z - (RING_R + 10);
      if (x * x + dzWaypoint * dzWaypoint < 6.5 * 6.5) return true;

      // Ring crossroad plazas at (±RING_R, 0), radius 2.8 + margin
      for (const side of [-1, 1]) {
        const dxRing = x - side * RING_R;
        if (dxRing * dxRing + z * z < 5.5 * 5.5) return true;
      }

      return false;
    }

    // ─── Standard tiers: original road layout ────────────────
    // Main road: X ≈ 0, Z > wallRadius (extends outward from gate)
    if (Math.abs(x) < 3 && z > wallRadius - 2) return true;

    // Side paths at ±45° and ±135° angles
    const sideAngles = [Math.PI / 4, -Math.PI / 4, Math.PI * 3 / 4, -Math.PI * 3 / 4];
    for (const angle of sideAngles) {
      const dirX = Math.sin(angle);
      const dirZ = Math.cos(angle);
      // Project point onto path direction line
      const dot = x * dirX + z * dirZ;
      if (dot > wallRadius - 1) {
        // Distance from point to path center line
        const perpDist = Math.abs(x * dirZ - z * dirX);
        if (perpDist < 2.5) return true;
      }
    }

    // Ring path at wallRadius + 5
    const ringRadius = wallRadius + 5;
    const distFromCenter = Math.sqrt(x * x + z * z);
    if (Math.abs(distFromCenter - ringRadius) < 2) return true;

    return false;
  }

  /**
   * Add trees around the castle.
   * OPTIMIZED: uses shared geometries and material pool.
   * Tree count scaled by quality setting.
   * When tier/legendary info is provided, excludes trees from roads and ceremonial zones.
   */
  addTrees(tier?: CastleTier, isLegendary?: boolean): void {
    // Flatten terrain under legendary roads/plazas so green doesn't bleed through
    if (isLegendary) {
      this.flattenTerrainForLegendary();
    }

    // Clear existing trees first
    for (const tree of this.trees) {
      this.environmentGroup.remove(tree);
    }
    this.trees = [];

    const allTreePositions = [
      // Inner ring (always rendered, even on LOW)
      { x: -12, z: 8 },
      { x: -14, z: -5 },
      { x: 13, z: 6 },
      { x: 15, z: -8 },
      { x: -10, z: -12 },
      { x: 10, z: -14 },
      { x: -18, z: 0 },
      { x: 18, z: 2 },
      // Outer ring (MEDIUM+)
      { x: -22, z: 12 },
      { x: -25, z: -3 },
      { x: 22, z: 10 },
      { x: 24, z: -6 },
      { x: -8, z: 20 },
      { x: 8, z: 22 },
      { x: -20, z: -15 },
      { x: 20, z: -18 },
      { x: 0, z: 25 },
      { x: -28, z: 8 },
      { x: 28, z: -2 },
      { x: -16, z: 18 },
      { x: 16, z: 16 },
      { x: -6, z: -22 },
      // Scattered far trees (HIGH only)
      { x: 6, z: -20 },
      { x: -30, z: -10 },
      { x: 32, z: 12 },
      { x: -24, z: 20 },
      { x: 26, z: -16 },
      { x: 0, z: -28 },
      { x: -34, z: 4 },
      { x: 34, z: 8 }
    ];

    // Quality-aware tree count
    const maxTrees = qualitySettings.getConfig().treeCount;
    let treePositions = allTreePositions.slice(0, maxTrees);

    // Exclude trees on roads/entrances/ceremonial zones for graduated castles
    if (tier) {
      const wallRadius = this.getWallRadius(tier);
      treePositions = treePositions.filter(pos => !this.isOnRoad(pos.x, pos.z, wallRadius, isLegendary));
    }

    for (const pos of treePositions) {
      const tree = this.createTree();
      tree.position.set(pos.x, 0, pos.z);
      // Legendary: surviving trees are further out — make them taller and more
      // stately to feel like curated background scenery, not random clutter.
      if (isLegendary) {
        tree.scale.setScalar(1.1 + Math.random() * 0.5);
      } else {
        tree.scale.setScalar(0.8 + Math.random() * 0.4);
      }
      tree.rotation.y = Math.random() * Math.PI * 2;
      this.environmentGroup.add(tree);
      this.trees.push(tree);
    }
  }

  /**
   * Flatten terrain vertices under all legendary roads, plazas, and ceremonial zones.
   * Without this, the terrain's gentle hills (±0.5 height) poke through the road/plaza
   * surfaces which sit at y ≈ 0.05. Called once when legendary state is first detected.
   */
  private flattenTerrainForLegendary(): void {
    if (!this.groundMesh) return;

    const geom = this.groundMesh.geometry;
    const positions = geom.attributes.position;
    const wallRadius = 14; // citadel
    const RING_R = wallRadius + 6; // = 20

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getY(i); // Y in plane space = Z in world
      const dist = Math.sqrt(x * x + z * z);

      let flatten = false;

      // Inner ceremonial zone (everything within ring + generous margin)
      if (dist < RING_R + 8) flatten = true;

      // Main avenue corridor: wide clearance along +Z from ring outward
      if (Math.abs(x) < 6 && z > wallRadius) flatten = true;

      // Forward approach cone: broad clearance in front of castle
      if (z > 0 && Math.abs(x) < z * 0.7 && dist < 45) flatten = true;

      // Grand entrance plaza at (0, RING_R), radius 6 + margin
      const dzGrand = z - RING_R;
      if (x * x + dzGrand * dzGrand < 9 * 9) flatten = true;

      // Outer waypoint plaza at (0, RING_R+10), radius 3.5 + margin
      const dzWay = z - (RING_R + 10);
      if (x * x + dzWay * dzWay < 6 * 6) flatten = true;

      // Ring crossroad plazas at (±RING_R, 0), radius 2.8 + margin
      for (const side of [-1, 1]) {
        const dxR = x - side * RING_R;
        if (dxR * dxR + z * z < 5.5 * 5.5) flatten = true;
      }

      // Promenades: backward-curving corridors from ±X ring positions
      for (const side of [-1, 1]) {
        if (side > 0 && x > RING_R - 4 && x < RING_R + 18 && z > -12 && z < 4) flatten = true;
        if (side < 0 && x < -RING_R + 4 && x > -RING_R - 18 && z > -12 && z < 4) flatten = true;
      }

      // Rear processional path
      if (Math.abs(x) < 4 && z < -RING_R + 3 && z > -RING_R - 15) flatten = true;

      if (flatten) {
        // Set height to zero (plane Z = world Y height)
        positions.setZ(i, 0);
      }
    }

    positions.needsUpdate = true;
    geom.computeVertexNormals();
  }

  private getWallRadius(tier: CastleTier): number {
    switch (tier) {
      case 'hut': return 2;
      case 'cottage': return 3;
      case 'tower': return 3.5;
      case 'keep': return 4;
      case 'manor': return 5.5;
      case 'castle': return 7;
      case 'stronghold': return 8.5;
      case 'fortress': return 10;
      case 'palace': return 12;
      case 'citadel': return 14;
      case 'empire': return 16;
      case 'legend': return 18;
      default: return 7;
    }
  }

  /**
   * Create a simple low-poly tree using shared geometries and material pool.
   * OPTIMIZED: All trees share 4 geometry instances and pick from a pool
   * of ~18 pre-built materials. This reduces geometry allocations from ~120
   * to 4, and material allocations from ~90 to ~21.
   *
   * Trees still look varied because each picks a random material variant
   * and each cone layer uses a different lightness tier.
   */
  private createTree(): THREE.Group {
    const tree = new THREE.Group();

    // Pick random trunk material from pool
    const trunkMat = this.trunkMaterials[Math.floor(Math.random() * this.trunkMaterials.length)];
    const trunk = new THREE.Mesh(this.trunkGeometry, trunkMat);
    trunk.position.y = 0.75;
    trunk.castShadow = true;
    tree.add(trunk);

    // Pick random foliage color variant (each variant has 3 lightness tiers)
    const variantBase = Math.floor(Math.random() * 6) * 3; // 6 variants

    const cone1 = new THREE.Mesh(
      this.foliageCone1Geometry,
      this.foliageMaterials[variantBase]     // base layer, darkest
    );
    cone1.position.y = 2;
    cone1.castShadow = true;
    tree.add(cone1);

    const cone2 = new THREE.Mesh(
      this.foliageCone2Geometry,
      this.foliageMaterials[variantBase + 1]  // middle — slightly brighter
    );
    cone2.position.y = 2.8;
    cone2.castShadow = true;
    tree.add(cone2);

    const cone3 = new THREE.Mesh(
      this.foliageCone3Geometry,
      this.foliageMaterials[variantBase + 2]  // top — brightest
    );
    cone3.position.y = 3.4;
    cone3.castShadow = true;
    tree.add(cone3);

    return tree;
  }

  /**
   * Update environment based on state and weather
   */
  update(state: RenderState, weather?: WeatherRenderState): void {
    // Update ground color based on state + weather
    this.updateGroundColor(state, weather);

    // Update tree visibility/color
    this.updateTrees(state, weather);

    // Update hill atmospheric perspective
    this.updateHills(state, weather);
  }

  /**
   * Update ground color (token state + weather + daylight modifiers)
   */
  private updateGroundColor(state: RenderState, weather?: WeatherRenderState): void {
    let groundColor = new THREE.Color(0x5a9055);
    const daylightFactor = 1 - state.nightFactor; // 0 at night, 1 at noon

    if (state.smoothDecay > 0.5) {
      groundColor.lerp(new THREE.Color(0x5a5a4a), (state.smoothDecay - 0.5) * 2);
    }

    // ── Daylight boost: sunlit grass is brighter, greener, livelier ───
    // This is the key visual improvement — clear day grass looks alive.
    if (daylightFactor > 0.4) {
      const sunFactor = (daylightFactor - 0.4) / 0.6; // 0–1 in daytime range
      // Bright sunlit green — grass catches warm sunlight
      groundColor.lerp(new THREE.Color(0x68a862), sunFactor * 0.25);
      // Roughness drops in sunlight — grass glistens slightly
      this.groundMaterial.roughness = 0.78 - sunFactor * 0.12; // 0.78 → 0.66
    } else {
      this.groundMaterial.roughness = 0.78;
    }

    // Weather modifiers (subtle, never overpowers token state)
    if (weather) {
      // Rain → slightly darker, wetter-looking ground
      if (weather.rainIntensity > 0.1) {
        groundColor.lerp(new THREE.Color(0x3a6a38), weather.rainIntensity * 0.25);
        this.groundMaterial.roughness = Math.min(this.groundMaterial.roughness,
          0.78 - weather.rainIntensity * 0.15); // wetter = shinier
      }

      // Storm → waterlogged, very dark and reflective ground
      if (weather.stormFactor > 0.3) {
        groundColor.lerp(new THREE.Color(0x2a4a2a), weather.stormFactor * 0.35);
        this.groundMaterial.roughness = Math.min(this.groundMaterial.roughness,
          0.50 - weather.stormFactor * 0.15); // slick wet surface
        this.groundMaterial.metalness = weather.stormFactor * 0.08; // wet reflections
      } else {
        this.groundMaterial.metalness = 0;
      }

      // Clear/sunny: additional brightness when no rain/cloud/fog
      const clearness = 1 - weather.rainIntensity - weather.cloudiness * 0.5 - weather.fogFactor;
      if (clearness > 0.5 && daylightFactor > 0.5) {
        const sunnyBoost = (clearness - 0.5) * 2 * ((daylightFactor - 0.5) * 2);
        groundColor.lerp(new THREE.Color(0x70b068), sunnyBoost * 0.15);
        this.groundMaterial.roughness -= sunnyBoost * 0.05;
      }

      // Heat → dry, yellowish ground
      if (weather.heatFactor > 0.1) {
        groundColor.lerp(new THREE.Color(0x7a7a45), weather.heatFactor * 0.2);
      }

      // Cold → blue-ish frost tint
      if (weather.coldFactor > 0.2) {
        groundColor.lerp(new THREE.Color(0x6a8a9a), weather.coldFactor * 0.2);
      }
    }

    // ── Night sky illumination on ground ──────────────────────────
    // At night, moonlight and sky glow lift the terrain with a cool blue tint.
    // This prevents the ground from becoming a dark void — it stays readable.
    if (state.nightFactor > 0.3) {
      const nightLift = (state.nightFactor - 0.3) / 0.7; // 0–1 in night range
      // Blend toward moonlit blue-green (lighter than natural nighttime decay)
      groundColor.lerp(new THREE.Color(0x3a5050), nightLift * 0.20);
      // Slightly increase emissive-like effect via reduced roughness
      // (moonlit wet grass catches more specular highlights from moonlight)
      this.groundMaterial.roughness -= nightLift * 0.05;
    }

    // ── Price mood ground tint ──────────────────────────────
    // Subtle green (bullish) or desaturated brown (bearish) tint on ground.
    // Barely perceptible at 8% max — complements the castle key light shift.
    if (state.priceMood !== undefined) {
      const moodColor = getPriceMoodColor(state.priceMood);
      if (moodColor) {
        const groundBlend = Math.min(0.08, Math.abs(state.priceMood) * 0.10);
        const groundMoodColor = state.priceMood > 0
          ? new THREE.Color(0x60b860).lerp(moodColor, 0.3)
          : new THREE.Color(0x8a6a4a).lerp(moodColor, 0.3);
        groundColor.lerp(groundMoodColor, groundBlend);
      }
    }

    // Clamp roughness to sane range — floor of 0.65 ensures terrain
    // never competes with castle's polished materials (which go to 0.32–0.48)
    this.groundMaterial.roughness = Math.max(0.65, Math.min(0.85, this.groundMaterial.roughness));

    this.groundMaterial.color.lerp(groundColor, 0.05);
  }

  /**
   * Update trees based on state, weather, and daylight.
   * OPTIMIZED: Since foliage materials are shared from a pool, we update
   * the pool materials once (affects all trees using them) instead of
   * traversing every mesh in every tree each frame.
   * Wind sway is still per-tree (cheap — just rotation).
   */
  private updateTrees(state: RenderState, weather?: WeatherRenderState): void {
    const deadTrees = state.smoothDecay > 0.7;
    const daylightFactor = 1 - state.nightFactor;

    // ─── Update shared foliage materials (once for all trees) ────────
    for (const mat of this.foliageMaterials) {
      if (deadTrees) {
        mat.color.lerp(new THREE.Color(0x4a3a2a), 0.02);
        mat.roughness += (0.90 - mat.roughness) * 0.02;
      } else {
        // Sunlight response
        if (daylightFactor > 0.4) {
          const sunStrength = (daylightFactor - 0.4) / 0.6;
          const hsl = { h: 0, s: 0, l: 0 };
          mat.color.getHSL(hsl);
          const sunlitColor = new THREE.Color().setHSL(
            hsl.h,
            Math.min(0.65, hsl.s + sunStrength * 0.08),
            Math.min(0.42, hsl.l + sunStrength * 0.06)
          );
          mat.color.lerp(sunlitColor, 0.02);
          mat.roughness += (0.65 - mat.roughness) * 0.02 * sunStrength;
        } else if (state.nightFactor > 0.5) {
          const nightDim = (state.nightFactor - 0.5) / 0.5;
          // Moonlight tint: trees go blue-green under moonlight (not darker)
          mat.color.lerp(new THREE.Color(0x3a5850), nightDim * 0.015);
          mat.roughness += (0.80 - mat.roughness) * 0.02;
        }

        // Weather tints
        if (weather) {
          if (weather.coldFactor > 0.3) {
            mat.color.lerp(new THREE.Color(0x5a7a7a), weather.coldFactor * 0.005);
          }
          if (weather.heatFactor > 0.2) {
            mat.color.lerp(new THREE.Color(0x5a6a2a), weather.heatFactor * 0.005);
          }
          if (weather.rainIntensity > 0.1) {
            mat.roughness += (0.55 - mat.roughness) * weather.rainIntensity * 0.02;
          }
        }

        // Price mood tint: foliage shifts greener (bullish) or dried brown (bearish)
        if (state.priceMood !== undefined) {
          const abs = Math.abs(state.priceMood);
          if (abs > 0.15) {
            const foliageBlend = Math.min(0.012, abs * 0.015);
            if (state.priceMood > 0) {
              mat.color.lerp(new THREE.Color(0x3aaa40), foliageBlend); // Vibrant green
            } else {
              mat.color.lerp(new THREE.Color(0x6a5a2a), foliageBlend); // Autumn brown
            }
          }
        }
      }
      mat.roughness = Math.max(0.58, Math.min(0.90, mat.roughness));
    }

    // ─── Per-tree wind sway (cheap — just rotation) ─────────────
    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i];

      if (weather && weather.windFactor > 0.05) {
        const windSway = Math.sin(state.time * 1.5 + i * 0.7) * weather.windFactor * 0.04;
        tree.rotation.z = windSway;
        tree.rotation.x = Math.cos(state.time * 1.2 + i * 1.1) * weather.windFactor * 0.02;
      } else {
        tree.rotation.z *= 0.95;
        tree.rotation.x *= 0.95;
      }
    }
  }

  /**
   * Update hills with atmospheric perspective.
   * Distant hills fade toward the sky/haze color — this creates depth
   * and makes the world feel expansive rather than boxed-in.
   */
  private updateHills(state: RenderState, weather?: WeatherRenderState): void {
    const daylightFactor = 1 - state.nightFactor;

    // Atmospheric perspective color shifts with time of day
    // At night, distant hills should fade toward moonlit blue-grey (NOT dark/black).
    // This mimics atmospheric light scattering from moonlight and sky glow.
    let atmosColor: THREE.Color;
    if (daylightFactor > 0.5) {
      // Daytime: hills fade toward pale sky-blue (aerial perspective)
      atmosColor = new THREE.Color(0xa8c8d8);
    } else if (daylightFactor > 0.15) {
      // Dawn/dusk: warm amber atmospheric color
      const t = (daylightFactor - 0.15) / 0.35;
      atmosColor = new THREE.Color(0x506878).lerp(new THREE.Color(0xa8c8d8), t);
    } else {
      // Night: cool blue-grey atmospheric haze (moonlit scattering)
      // Bright enough that distant hills read as silhouettes, not black blobs
      atmosColor = new THREE.Color(0x384858);
    }

    // Weather modifiers
    if (weather) {
      if (weather.fogFactor > 0.1) {
        atmosColor.lerp(new THREE.Color(0xb0b8c0), weather.fogFactor * 0.4);
      }
      if (weather.rainIntensity > 0.1) {
        atmosColor.lerp(new THREE.Color(0x6a7080), weather.rainIntensity * 0.3);
      }
    }

    const hillPositions = [
      { x: -30, z: -25 },
      { x: 25, z: -30 },
      { x: -20, z: -35 },
      { x: 35, z: -20 },
      { x: 0, z: -40 }
    ];

    for (let i = 0; i < this.hills.length; i++) {
      const hill = this.hills[i];
      const mat = hill.material as THREE.MeshStandardMaterial;
      const pos = hillPositions[i];
      if (!pos) continue;

      const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
      const distanceFactor = Math.min(1, dist / 50);

      // Atmospheric perspective: distant hills blend toward atmosphere color
      // At night, INCREASE scattering — moonlit haze makes distant hills
      // fade to soft blue-grey instead of becoming dark silhouettes.
      // Day: 0.25 strength (clear aerial perspective)
      // Night: 0.35 strength (stronger blue haze lifts dark hills)
      const atmosStrength = distanceFactor * (0.25 + state.nightFactor * 0.10);

      // Base hill color (restored from initial state)
      const baseHillColor = new THREE.Color(0x6a9a65);
      const distantTint = new THREE.Color(0x6a8a7a);
      const baseColor = baseHillColor.clone().lerp(distantTint, distanceFactor * 0.3);

      // Price mood tint: hills shift green (bullish) or desaturated red-brown (bearish)
      if (state.priceMood !== undefined) {
        const abs = Math.abs(state.priceMood);
        if (abs > 0.15) {
          const hillMoodBlend = Math.min(0.18, abs * 0.22);
          if (state.priceMood > 0) {
            baseColor.lerp(new THREE.Color(0x4aaa50), hillMoodBlend); // Lush green
          } else {
            baseColor.lerp(new THREE.Color(0x8a6a4a), hillMoodBlend); // Dried brown
          }
        }
      }

      // Apply atmospheric perspective
      const targetColor = baseColor.clone().lerp(atmosColor, atmosStrength);

      // Night moonlight lift: hills gain cool blue tint from sky illumination.
      // This prevents distant hills from becoming black blobs — they should
      // read as deep blue-grey silhouettes against the night sky.
      if (state.nightFactor > 0.3) {
        const nightLift = (state.nightFactor - 0.3) / 0.7;
        // Blend toward a moonlit blue-grey (brighter than the hill base at night)
        targetColor.lerp(new THREE.Color(0x3a4a58), nightLift * 0.25);
      }

      // Smooth transition
      mat.color.lerp(targetColor, 0.03);
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.groundMesh) {
      this.groundMesh.geometry.dispose();
    }
    this.groundMaterial.dispose();

    for (const hill of this.hills) {
      hill.geometry.dispose();
      if (hill.material instanceof THREE.Material) {
        hill.material.dispose();
      }
    }

    // Dispose shared tree geometries (shared, so dispose once)
    this.trunkGeometry.dispose();
    this.foliageCone1Geometry.dispose();
    this.foliageCone2Geometry.dispose();
    this.foliageCone3Geometry.dispose();

    // Dispose pooled materials
    for (const mat of this.foliageMaterials) mat.dispose();
    for (const mat of this.trunkMaterials) mat.dispose();

    this.scene.remove(this.environmentGroup);
  }
}
