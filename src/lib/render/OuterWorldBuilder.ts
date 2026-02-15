/**
 * OuterWorldBuilder.ts
 *
 * Builds and animates everything OUTSIDE the castle walls:
 * - Dirt paths radiating outward
 * - Flower gardens with color patches
 * - Market stalls with awnings
 * - Benches where villagers sit
 * - Billboards / signposts
 * - Wandering villagers (shoppers, couples, kids playing)
 * - Legendary tier: amusement park (ferris wheel, carousel, festival stalls)
 */

import * as THREE from 'three';
import type { RenderState, CastleTier, ExchangeListing } from '$lib/types';
import type { WeatherRenderState } from '$lib/state/WeatherState';
import { WORLD_SCALE } from '$lib/state/CastleConstants';
import { getTokenColors, getMaterialWear, categorizeExchanges, getMoodEmissiveScale, getExchangeColor, type TokenColors, type MaterialWear } from './TokenIdentity';

interface Villager {
  mesh: THREE.Group;
  targetX: number;
  targetZ: number;
  speed: number;
  behavior: 'wander' | 'sit' | 'shop' | 'watch' | 'play';
  timer: number;
  phase: number; // animation phase
}

export class OuterWorldBuilder {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private seed: number;

  // Static structures
  private paths: THREE.Mesh[] = [];
  private gardens: THREE.Group[] = [];
  private stalls: THREE.Group[] = [];
  private benches: THREE.Group[] = [];
  private billboards: THREE.Group[] = [];
  private lampposts: THREE.Group[] = [];

  // Amusement park (legendary only)
  private parkGroup: THREE.Group;
  private ferrisWheel: THREE.Group | null = null;
  private carousel: THREE.Group | null = null;
  private festivalStalls: THREE.Group[] = [];
  private parkBuilt: boolean = false;

  // Legendary landmarks (regal structures — fountains, statues, obelisks, torches)
  private landmarkGroup: THREE.Group;
  private landmarksBuilt: boolean = false;

  // Legendary plazas (ceremonial gathering spaces along the approach)
  private plazaGroup: THREE.Group;
  private plazasBuilt: boolean = false;

  // Legendary polish (soft ground glow, torch spill, material enhancements)
  private polishGroup: THREE.Group;
  private polishBuilt: boolean = false;

  // Animated villagers
  private villagers: Villager[] = [];
  private maxVillagers: number = 0;
  private spawnTimer: number = 0;

  // Token identity (colors, wear, exchange markers)
  private tokenColors: TokenColors = { primary: 0xcc2222, accent: 0xdd6644, trim: 0xc8a84e, fabric: 0xaa2222 };
  private materialWear: MaterialWear = { roughnessBoost: 0, metalnessReduction: 0, emissiveScale: 1, saturationScale: 1 };
  private identityApplied: boolean = false;

  // Exchange trade markers (built once per token)
  private tradeMarkerGroup: THREE.Group;
  private tradeMarkersBuilt: boolean = false;

  // Token image texture for banners (loaded async from tokenImageUrl)
  private textureLoader: THREE.TextureLoader = new THREE.TextureLoader();
  private tokenImageTexture: THREE.Texture | null = null;
  private tokenImageUrl: string | null = null;
  private tokenImageLoading: boolean = false;

  // State tracking
  private currentTier: CastleTier | null = null;
  private builtForTier: CastleTier | null = null;

  constructor(scene: THREE.Scene, seed: number) {
    this.scene = scene;
    this.seed = seed;
    this.group = new THREE.Group();
    this.group.name = 'outerWorld';
    this.group.scale.setScalar(WORLD_SCALE);
    this.scene.add(this.group);

    this.parkGroup = new THREE.Group();
    this.parkGroup.name = 'amusementPark';
    this.parkGroup.visible = false;
    this.group.add(this.parkGroup);

    this.landmarkGroup = new THREE.Group();
    this.landmarkGroup.name = 'legendaryLandmarks';
    this.landmarkGroup.visible = false;
    this.group.add(this.landmarkGroup);

    this.plazaGroup = new THREE.Group();
    this.plazaGroup.name = 'legendaryPlazas';
    this.plazaGroup.visible = false;
    this.group.add(this.plazaGroup);

    this.polishGroup = new THREE.Group();
    this.polishGroup.name = 'legendaryPolish';
    this.polishGroup.visible = false;
    this.group.add(this.polishGroup);

    this.tradeMarkerGroup = new THREE.Group();
    this.tradeMarkerGroup.name = 'tradeMarkers';
    this.tradeMarkerGroup.visible = false;
    this.group.add(this.tradeMarkerGroup);
  }

  private random(): number {
    this.seed = (this.seed * 16807 + 0) % 2147483647;
    return (this.seed & 0x7fffffff) / 2147483647;
  }

  // ─── Build static world elements ──────────────────────────

  private buildOuterWorld(tier: CastleTier): void {
    this.clearStructures();
    this.builtForTier = tier;

    const wallRadius = this.getWallRadius(tier);

    this.buildPaths(wallRadius, tier);
    this.buildGardens(wallRadius, tier);
    this.buildMarketStalls(wallRadius, tier);
    this.buildBenches(wallRadius, tier);
    this.buildBillboards(wallRadius, tier);
    this.buildLampposts(wallRadius, tier);
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
   * Returns the Z position of the castle gate for each tier.
   * Must match CastleMeshBuilder.addGate() call positions exactly.
   * The gate is the absolute anchor point for all road alignment.
   */
  private getGateZ(tier: CastleTier): number {
    switch (tier) {
      case 'hut': return 1.5;
      case 'cottage': return 2;
      case 'tower': return 2;
      case 'keep': return 2;
      case 'manor': return 3.5;
      case 'castle': return 5.25;
      case 'stronghold': return 7;
      case 'fortress': return 8.5;
      case 'palace': return 10.5;
      case 'citadel': return 12.5;
      case 'empire': return 14.5;
      case 'legend': return 16.5;
      default: return 5.25;
    }
  }

  // ─── Paths ────────────────────────────────────────────────

  private buildPaths(wallRadius: number, tier: CastleTier): void {
    if (tier === 'citadel' || tier === 'empire' || tier === 'legend') {
      this.buildLegendaryPaths(wallRadius);
      return;
    }

    const pathMat = new THREE.MeshStandardMaterial({
      color: 0xc4a672,
      roughness: 0.95,
      metalness: 0,
      // Pull roads forward in depth buffer to render above terrain
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    // Main road going outward from gate (positive Z)
    // Road starts at the actual gate position, not at wallRadius.
    const gateZ = this.getGateZ(tier);
    const roadLength = 30;
    const mainPath = new THREE.Mesh(
      new THREE.PlaneGeometry(2.5, roadLength),
      pathMat
    );
    mainPath.rotation.x = -Math.PI / 2;
    mainPath.position.set(0, 0.04, gateZ + roadLength / 2);
    mainPath.receiveShadow = true;
    this.group.add(mainPath);
    this.paths.push(mainPath);

    // Side paths at angles
    const sideAngles = [Math.PI / 4, -Math.PI / 4, Math.PI * 3 / 4, -Math.PI * 3 / 4];
    for (const angle of sideAngles) {
      const sidePath = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 18),
        pathMat
      );
      sidePath.rotation.x = -Math.PI / 2;
      sidePath.rotation.z = angle;
      const dist = wallRadius + 9;
      sidePath.position.set(Math.sin(angle) * dist, 0.04, Math.cos(angle) * dist);
      sidePath.receiveShadow = true;
      this.group.add(sidePath);
      this.paths.push(sidePath);
    }

    // Circular ring path around castle
    const ringSegments = 32;
    const ringRadius = wallRadius + 5;
    for (let i = 0; i < ringSegments; i++) {
      const a1 = (i / ringSegments) * Math.PI * 2;
      const a2 = ((i + 1) / ringSegments) * Math.PI * 2;
      const cx = (Math.sin(a1) + Math.sin(a2)) / 2 * ringRadius;
      const cz = (Math.cos(a1) + Math.cos(a2)) / 2 * ringRadius;
      const segLen = ringRadius * Math.PI * 2 / ringSegments * 1.1;

      const seg = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, segLen),
        pathMat
      );
      seg.rotation.x = -Math.PI / 2;
      seg.rotation.z = -a1 - Math.PI / ringSegments;
      seg.position.set(cx, 0.04, cz);
      seg.receiveShadow = true;
      this.group.add(seg);
      this.paths.push(seg);
    }
  }

  // ─── Legendary Ceremonial Paths (spline-based, clean geometry) ────

  /**
   * Builds a grand ceremonial road system for Legendary/Citadel tier.
   *
   * Uses merged BufferGeometry from smooth spline curves instead of
   * discrete PlaneGeometry tiles. This eliminates Z-fighting, seams,
   * and gives roads a clean, intentional, regal feel.
   *
   * Layout:
   *   - One wide ceremonial main avenue (gate → outward, +Z)
   *   - Two symmetrical curved promenades branching from the ring
   *   - A smooth ring boulevard around the castle
   *   - Gold/stone accent borders on all roads
   */
  private buildLegendaryPaths(wallRadius: number): void {
    // ─── Materials ──────────────────────────────────────────
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0xd4c5a0,   // warm sandstone — lighter than grass
      roughness: 0.55,   // polished ceremonial stone — subtle light reflection
      metalness: 0.08,
      // Pull roads forward in depth buffer to render above terrain
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const borderMat = new THREE.MeshStandardMaterial({
      color: 0xc8a84e,   // gold-stone trim
      roughness: 0.45,
      metalness: 0.35,
      emissive: 0xb8942e,
      emissiveIntensity: 0.03,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const ROAD_Y = 0.06;           // above terrain — prevents grass bleed-through
    const MAIN_HALF_W = 2.0;       // main avenue half-width
    const SIDE_HALF_W = 1.0;       // promenade half-width
    const RING_HALF_W = 1.2;       // ring boulevard half-width (wider for visibility)
    const BORDER_W = 0.12;         // border trim width
    const RING_R = wallRadius + 6; // ring radius

    // ─── Helper: create a flat ribbon mesh from a polyline ──
    const createRibbon = (
      points: THREE.Vector3[],
      halfWidth: number,
      material: THREE.Material,
      yOffset: number = ROAD_Y
    ): THREE.Mesh => {
      // Build vertices: for each point, create left/right verts
      // perpendicular to the path direction in the XZ plane.
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      let accLen = 0; // accumulated length for UV

      for (let i = 0; i < points.length; i++) {
        // Direction tangent
        let tx: number, tz: number;
        if (i === 0) {
          tx = points[1].x - points[0].x;
          tz = points[1].z - points[0].z;
        } else if (i === points.length - 1) {
          tx = points[i].x - points[i - 1].x;
          tz = points[i].z - points[i - 1].z;
        } else {
          tx = points[i + 1].x - points[i - 1].x;
          tz = points[i + 1].z - points[i - 1].z;
        }
        // Normalize
        const tLen = Math.sqrt(tx * tx + tz * tz) || 1;
        tx /= tLen;
        tz /= tLen;

        // Perpendicular in XZ (rotate 90°)
        const nx = -tz;
        const nz = tx;

        // Accumulated length for UV v-coordinate
        if (i > 0) {
          const dx = points[i].x - points[i - 1].x;
          const dz = points[i].z - points[i - 1].z;
          accLen += Math.sqrt(dx * dx + dz * dz);
        }

        const px = points[i].x;
        const pz = points[i].z;

        // Left vertex
        positions.push(px + nx * halfWidth, yOffset, pz + nz * halfWidth);
        normals.push(0, 1, 0);
        uvs.push(0, accLen / (halfWidth * 4));

        // Right vertex
        positions.push(px - nx * halfWidth, yOffset, pz - nz * halfWidth);
        normals.push(0, 1, 0);
        uvs.push(1, accLen / (halfWidth * 4));

        // Triangles (two triangles per quad)
        if (i > 0) {
          const v = (i - 1) * 2;
          indices.push(v, v + 1, v + 2);
          indices.push(v + 1, v + 3, v + 2);
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geom.setIndex(indices);

      const mesh = new THREE.Mesh(geom, material);
      mesh.receiveShadow = true;
      return mesh;
    };

    // ─── Helper: sample a CatmullRom spline into polyline ────
    const sampleSpline = (
      controlPoints: THREE.Vector3[],
      segments: number
    ): THREE.Vector3[] => {
      const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'catmullrom', 0.5);
      return curve.getPoints(segments);
    };

    // ─── Helper: create road + double border in one call ─────
    const createRoad = (
      points: THREE.Vector3[],
      halfWidth: number
    ): void => {
      // Main road surface
      const road = createRibbon(points, halfWidth, stoneMat, ROAD_Y);
      this.group.add(road);
      this.paths.push(road);

      // Gold border: a slightly wider ribbon underneath the road surface.
      // The stone road sits on top so only the gold edges peek out.
      const border = createRibbon(points, halfWidth + BORDER_W, borderMat, ROAD_Y - 0.002);
      this.group.add(border);
      this.paths.push(border);
    };

    // Gate Z is the absolute anchor — all roads align to this point.
    const gateZ = this.getGateZ('citadel');

    // ─── 0. Inner Courtyard Ground ────────────────────────────
    // Fills the entire zone between castle wall and ring road with stone.
    // Without this the green terrain shows through, looking incomplete.
    {
      // A large disc centered on the castle covers the inner ceremonial zone.
      // Outer radius matches ring road outer edge so there are no green gaps.
      const courtyardMat = new THREE.MeshStandardMaterial({
        color: 0xc8b890,    // warm stone, slightly darker than road
        roughness: 0.65,
        metalness: 0.05
      });
      const courtyard = new THREE.Mesh(
        new THREE.CircleGeometry(RING_R + RING_HALF_W + 0.5, 64),
        courtyardMat
      );
      courtyard.rotation.x = -Math.PI / 2;
      courtyard.position.y = ROAD_Y - 0.01; // just below road surface
      courtyard.receiveShadow = true;
      this.group.add(courtyard);
      this.paths.push(courtyard);

      // Subtle inner border ring at castle wall edge
      const innerBorderGeom = new THREE.RingGeometry(wallRadius + 0.5, wallRadius + 1.0, 48);
      const innerBorder = new THREE.Mesh(innerBorderGeom, borderMat);
      innerBorder.rotation.x = -Math.PI / 2;
      innerBorder.position.y = ROAD_Y + 0.001;
      this.group.add(innerBorder);
      this.paths.push(innerBorder);
    }

    // ─── 1. Gate Approach: gate → ring boulevard ─────────────
    // A straight, wide connector from the castle gate to the ring road.
    // This is the most sacred axis — perfectly centered on x=0.
    {
      const pts = [
        new THREE.Vector3(0, 0, gateZ),
        new THREE.Vector3(0, 0, RING_R)
      ];
      createRoad(pts, MAIN_HALF_W);
    }

    // ─── 2. Grand Ceremonial Main Avenue (ring → outward) ────
    // Continues the main axis from the ring boulevard outward.
    // Perfectly straight, centered on x=0, same width as approach.
    {
      const endZ = gateZ + 30;
      const controlPts = [
        new THREE.Vector3(0, 0, RING_R),
        new THREE.Vector3(0, 0, RING_R + 7),
        new THREE.Vector3(0, 0, RING_R + 14),
        new THREE.Vector3(0, 0, endZ)
      ];
      const points = sampleSpline(controlPts, 40);
      createRoad(points, MAIN_HALF_W);
    }

    // ─── 3. Smooth Ring Boulevard around castle ──────────────
    {
      const ringSegCount = 80;
      const ringPoints: THREE.Vector3[] = [];
      for (let i = 0; i <= ringSegCount; i++) {
        const a = (i / ringSegCount) * Math.PI * 2;
        ringPoints.push(new THREE.Vector3(
          Math.sin(a) * RING_R,
          0,
          Math.cos(a) * RING_R
        ));
      }
      createRoad(ringPoints, RING_HALF_W);
    }

    // ─── 4. Symmetric Promenades (curves away from main axis) ─
    // Two graceful promenades that branch from the ring at ±90°
    // and curve OUTWARD and BACKWARD — never approaching the
    // main +Z axis. They feel clearly subordinate.
    {
      for (const side of [-1, 1]) {
        // Start at ±X on the ring (perpendicular to main axis)
        const startX = side * RING_R;
        const startZ = 0;

        // Curve outward and slightly backward (−Z) to stay away from main axis
        const midX = startX + side * 7;
        const midZ = -3;

        const endX = startX + side * 14;
        const endZ = -6;

        const controlPts = [
          new THREE.Vector3(startX, 0, startZ),
          new THREE.Vector3(midX, 0, midZ),
          new THREE.Vector3(endX, 0, endZ)
        ];
        const points = sampleSpline(controlPts, 30);
        createRoad(points, SIDE_HALF_W);
      }
    }

    // ─── 5. Rear Processional Path (−Z, behind castle) ──────
    // Aligned perfectly on x=0 axis, extending from ring behind castle.
    // Narrower than main avenue — clearly subordinate.
    {
      const rearStartZ = -RING_R;
      const rearEndZ = rearStartZ - 12;
      const controlPts = [
        new THREE.Vector3(0, 0, rearStartZ),
        new THREE.Vector3(0, 0, (rearStartZ + rearEndZ) / 2),
        new THREE.Vector3(0, 0, rearEndZ)
      ];
      const points = sampleSpline(controlPts, 20);
      createRoad(points, SIDE_HALF_W);
    }
  }

  // ─── Gardens ──────────────────────────────────────────────

  private buildGardens(wallRadius: number, tier: CastleTier): void {
    // Legendary: fewer, curated gardens placed far from entrance/plazas
    const isLeg = tier === 'citadel' || tier === 'empire' || tier === 'legend';
    const gardenBase: Record<string, number> = {
      hut: 1, cottage: 2, tower: 2, keep: 3, manor: 4, castle: 5,
      stronghold: 6, fortress: 7, palace: 8, citadel: 4, empire: 5, legend: 6
    };
    const gardenCount = gardenBase[tier] ?? 3;
    const gardenDist = isLeg ? wallRadius + 14 : wallRadius + 8;

    for (let i = 0; i < gardenCount; i++) {
      // Legendary: place gardens only behind and to the sides (avoid +Z approach)
      let angle: number;
      if (isLeg) {
        // Distribute in rear hemisphere (π/2 to 3π/2 → sides and back)
        angle = Math.PI / 2 + (i / gardenCount) * Math.PI + this.random() * 0.2;
      } else {
        angle = (i / gardenCount) * Math.PI * 2 + this.random() * 0.3;
      }
      const dist = gardenDist + this.random() * 6;
      const gx = Math.sin(angle) * dist;
      const gz = Math.cos(angle) * dist;

      const garden = this.createGarden();
      garden.position.set(gx, 0, gz);
      garden.rotation.y = this.random() * Math.PI * 2;
      this.group.add(garden);
      this.gardens.push(garden);
    }
  }

  private createGarden(): THREE.Group {
    const garden = new THREE.Group();

    // Grass patch
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x5a9a4a, roughness: 0.9 });
    const grass = new THREE.Mesh(new THREE.CircleGeometry(2, 8), grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = 0.01;
    grass.receiveShadow = true;
    garden.add(grass);

    // Flowers (small colored spheres/cones clustered)
    const flowerColors = [0xff6b9d, 0xffd93d, 0xff8c42, 0xc084fc, 0x60a5fa, 0xf472b6];
    const flowerCount = 6 + Math.floor(this.random() * 8);
    for (let i = 0; i < flowerCount; i++) {
      const angle = this.random() * Math.PI * 2;
      const r = 0.3 + this.random() * 1.4;
      const flower = new THREE.Group();

      // Stem
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.25, 4),
        new THREE.MeshStandardMaterial({ color: 0x3a7a2a })
      );
      stem.position.y = 0.125;
      flower.add(stem);

      // Bloom
      const color = flowerColors[Math.floor(this.random() * flowerColors.length)];
      const bloom = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 4),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
      );
      bloom.position.y = 0.28;
      flower.add(bloom);

      flower.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      flower.scale.setScalar(0.8 + this.random() * 0.5);
      garden.add(flower);
    }

    // Maybe a small bush
    if (this.random() > 0.4) {
      const bush = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0x3d7a3d, roughness: 0.8 })
      );
      bush.position.set(this.random() * 0.8 - 0.4, 0.3, this.random() * 0.8 - 0.4);
      bush.scale.y = 0.7;
      bush.castShadow = true;
      garden.add(bush);
    }

    return garden;
  }

  // ─── Market Stalls ────────────────────────────────────────

  private buildMarketStalls(wallRadius: number, tier: CastleTier): void {
    const isLeg = tier === 'citadel' || tier === 'empire' || tier === 'legend';
    // Legendary: drastically fewer stalls — plazas/landmarks carry the scene
    const stallBase: Record<string, number> = {
      hut: 0, cottage: 0, tower: 1, keep: 1, manor: 2, castle: 3,
      stronghold: 4, fortress: 5, palace: 6, citadel: 3, empire: 4, legend: 5
    };
    const stallCount = stallBase[tier] ?? 2;
    const stallDist = isLeg ? wallRadius + 12 : wallRadius + 6;

    if (isLeg) {
      // Legendary: place stalls only along the side promenades, far from entrance
      const sideAngles = [Math.PI * 0.6, Math.PI * 0.8, -Math.PI * 0.6];
      for (let i = 0; i < stallCount; i++) {
        const angle = sideAngles[i];
        const stall = this.createStall();
        stall.position.set(
          Math.sin(angle) * stallDist,
          0,
          Math.cos(angle) * stallDist
        );
        stall.rotation.y = angle + Math.PI;
        this.group.add(stall);
        this.stalls.push(stall);
      }
      return;
    }

    // Stalls along the main path
    for (let i = 0; i < stallCount; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const z = wallRadius + 4 + i * 3.5;
      const stall = this.createStall();
      stall.position.set(side * 3.5, 0, z);
      stall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.group.add(stall);
      this.stalls.push(stall);
    }

    // Some stalls around the ring
    if (tier !== 'keep' && tier !== 'hut' && tier !== 'cottage' && tier !== 'tower') {
      for (let i = 0; i < Math.min(4, stallCount); i++) {
        const angle = Math.PI / 2 + i * Math.PI / 3 + this.random() * 0.3;
        const stall = this.createStall();
        stall.position.set(
          Math.sin(angle) * stallDist,
          0,
          Math.cos(angle) * stallDist
        );
        stall.rotation.y = angle + Math.PI;
        this.group.add(stall);
        this.stalls.push(stall);
      }
    }
  }

  private createStall(): THREE.Group {
    const stall = new THREE.Group();

    // Counter
    const counterMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.8 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 0.8), counterMat);
    counter.position.y = 0.4;
    counter.castShadow = true;
    stall.add(counter);

    // Legs
    const legMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.9 });
    const legPositions = [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]];
    for (const [lx, lz] of legPositions) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 4), legMat);
      leg.position.set(lx, 0.4, lz);
      stall.add(leg);
    }

    // Awning (angled plane)
    const awningColors = [0xcc3333, 0x3366cc, 0xcc9933, 0x339933, 0xcc6633];
    const awningColor = awningColors[Math.floor(this.random() * awningColors.length)];
    const awning = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.4),
      new THREE.MeshStandardMaterial({ color: awningColor, roughness: 0.7, side: THREE.DoubleSide })
    );
    awning.position.set(0, 1.3, -0.1);
    awning.rotation.x = -0.3;
    awning.castShadow = true;
    stall.add(awning);

    // Goods on counter (tiny boxes)
    for (let i = 0; i < 4; i++) {
      const goodColor = [0xdaa520, 0xcd853f, 0xf4a460, 0xd2691e][i];
      const good = new THREE.Mesh(
        new THREE.BoxGeometry(0.2 + this.random() * 0.15, 0.15, 0.15),
        new THREE.MeshStandardMaterial({ color: goodColor, roughness: 0.65, emissive: new THREE.Color(goodColor), emissiveIntensity: 0.02 })
      );
      good.position.set(-0.6 + i * 0.4, 0.88, 0);
      stall.add(good);
    }

    return stall;
  }

  // ─── Benches ──────────────────────────────────────────────

  private buildBenches(wallRadius: number, tier: CastleTier): void {
    const isLeg = tier === 'citadel' || tier === 'empire' || tier === 'legend';
    // Legendary: fewer benches, placed away from the ceremonial approach
    const benchBase: Record<string, number> = {
      hut: 0, cottage: 1, tower: 1, keep: 2, manor: 3, castle: 4,
      stronghold: 5, fortress: 6, palace: 8, citadel: 4, empire: 6, legend: 8
    };
    const benchCount = benchBase[tier] ?? 3;

    for (let i = 0; i < benchCount; i++) {
      let angle: number;
      if (isLeg) {
        // Only in rear/side areas (avoid the +Z approach)
        angle = Math.PI * 0.4 + (i / benchCount) * Math.PI * 1.2 + this.random() * 0.3;
      } else {
        angle = (i / benchCount) * Math.PI * 2 + this.random() * 0.5;
      }
      const dist = wallRadius + (isLeg ? 10 : 5) + this.random() * 8;
      const bench = this.createBench();
      bench.position.set(Math.sin(angle) * dist, 0, Math.cos(angle) * dist);
      bench.rotation.y = angle + Math.PI / 2;
      this.group.add(bench);
      this.benches.push(bench);
    }
  }

  private createBench(): THREE.Group {
    const bench = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.85 });

    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.35), woodMat);
    seat.position.y = 0.35;
    seat.castShadow = true;
    bench.add(seat);

    // Backrest
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.04), woodMat);
    back.position.set(0, 0.55, -0.15);
    bench.add(back);

    // Legs
    const legMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 });
    for (const x of [-0.5, 0.5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.35, 0.3), legMat);
      leg.position.set(x, 0.175, 0);
      bench.add(leg);
    }

    return bench;
  }

  // ─── Billboards / Signposts ───────────────────────────────

  private buildBillboards(wallRadius: number, tier: CastleTier): void {
    // Legendary: no billboards — they break the regal, ceremonial feel
    if (tier === 'citadel' || tier === 'empire' || tier === 'legend' || tier === 'palace') return;

    const count = tier === 'hut' ? 0 : tier === 'cottage' ? 0 : tier === 'tower' ? 1 : tier === 'keep' ? 1 : tier === 'manor' ? 2 : tier === 'castle' ? 2 : tier === 'stronghold' ? 3 : tier === 'fortress' ? 3 : 5;

    for (let i = 0; i < count; i++) {
      const angle = this.random() * Math.PI * 2;
      const dist = wallRadius + 10 + this.random() * 8;
      const billboard = this.createBillboard();
      billboard.position.set(Math.sin(angle) * dist, 0, Math.cos(angle) * dist);
      billboard.rotation.y = angle + Math.PI;
      this.group.add(billboard);
      this.billboards.push(billboard);
    }
  }

  private createBillboard(): THREE.Group {
    const bb = new THREE.Group();

    // Post
    const postMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6), postMat);
    post.position.y = 1.1;
    post.castShadow = true;
    bb.add(post);

    // Board
    const boardColors = [0xd4a574, 0xc4956a, 0xbfa87a];
    const boardColor = boardColors[Math.floor(this.random() * boardColors.length)];
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.9, 0.06),
      new THREE.MeshStandardMaterial({ color: boardColor, roughness: 0.75 })
    );
    board.position.y = 1.9;
    board.castShadow = true;
    bb.add(board);

    // Frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 });
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.08), frameMat);
    frameTop.position.y = 2.35;
    bb.add(frameTop);
    const frameBot = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.08), frameMat);
    frameBot.position.y = 1.45;
    bb.add(frameBot);

    // Decorative symbols on board (colored rectangles)
    for (let i = 0; i < 3; i++) {
      const symColor = [0xcc3333, 0xffd700, 0x3366cc][i];
      const sym = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.15, 0.07),
        new THREE.MeshStandardMaterial({ color: symColor, roughness: 0.5 })
      );
      sym.position.set(-0.4 + i * 0.4, 1.9, 0.04);
      bb.add(sym);
    }

    return bb;
  }

  // ─── Lampposts ────────────────────────────────────────────

  private buildLampposts(wallRadius: number, tier: CastleTier): void {
    // Legendary: fewer lampposts — plaza torches and landmark torches handle lighting
    const isLeg = tier === 'citadel' || tier === 'empire' || tier === 'legend';
    const countBase: Record<string, number> = {
      hut: 1, cottage: 1, tower: 2, keep: 2, manor: 3, castle: 4,
      stronghold: 5, fortress: 6, palace: 8, citadel: 4, empire: 6, legend: 8
    };
    const count = countBase[tier] ?? 3;

    for (let i = 0; i < count; i++) {
      let angle: number;
      if (isLeg) {
        // Place only in rear/side quadrants to avoid cluttering the approach
        angle = Math.PI * 0.3 + (i / count) * Math.PI * 1.4;
      } else {
        angle = (i / count) * Math.PI * 2;
      }
      const dist = wallRadius + (isLeg ? 8 : 5);
      const lamp = this.createLamppost();
      lamp.position.set(Math.sin(angle) * dist, 0, Math.cos(angle) * dist);
      this.group.add(lamp);
      this.lampposts.push(lamp);
    }
  }

  private createLamppost(): THREE.Group {
    const post = new THREE.Group();
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.4 });

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 2.5, 6), ironMat);
    pole.position.y = 1.25;
    pole.castShadow = true;
    post.add(pole);

    // Lamp housing
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.25, 0.2),
      ironMat
    );
    housing.position.y = 2.55;
    post.add(housing);

    // Glowing lamp
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xffdd88,
      emissive: 0xffaa44,
      emissiveIntensity: 0.3,
      roughness: 0.3
    });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), lampMat);
    lamp.position.y = 2.5;
    post.add(lamp);

    return post;
  }

  // ─── Villagers (animated) ──────────────────────────────────

  private getMaxVillagers(tier: CastleTier, activityLevel: string, isLegendary: boolean, populationDensity: number): number {
    const base: Record<string, number> = {
      hut: 1, cottage: 1, tower: 2, keep: 2, manor: 3, castle: 4,
      stronghold: 6, fortress: 8, palace: 10, citadel: 14, empire: 16, legend: 20
    };
    let count = base[tier] || 4;

    // Population density is the PRIMARY driver of villager count.
    // density 0 → base×0.1 (ghost town), 0.5 → base×1.0, 1.0 → base×2.5
    const densityMultiplier = 0.1 + populationDensity * 2.4;
    count = Math.round(count * densityMultiplier);

    // Activity level still adds a slight modifier for volume-based momentum
    if (activityLevel === 'booming') count += 2;
    else if (activityLevel === 'dead') count = Math.max(0, count - 1);

    if (isLegendary) count += Math.round(populationDensity * 10);

    return Math.max(0, count);
  }

  private spawnVillager(tier: CastleTier, populationDensity: number = 0.5): void {
    const wallRadius = this.getWallRadius(tier);
    const mesh = this.createVillagerMesh();

    // Spawn around the outer area
    const angle = this.random() * Math.PI * 2;
    const dist = wallRadius + 4 + this.random() * 14;
    const x = Math.sin(angle) * dist;
    const z = Math.cos(angle) * dist;
    mesh.position.set(x, 0, z);

    // Behavior depends on density: bustling → active behaviors, ghost town → aimless wandering
    let behaviors: Villager['behavior'][];
    if (populationDensity > 0.6) {
      behaviors = ['shop', 'play', 'shop', 'watch', 'wander', 'play'];
    } else if (populationDensity > 0.3) {
      behaviors = ['wander', 'shop', 'watch', 'wander', 'play', 'wander'];
    } else {
      behaviors = ['wander', 'wander', 'wander', 'sit', 'wander', 'wander'];
    }
    const behavior = behaviors[Math.floor(this.random() * behaviors.length)];

    // Pick a random target
    const tAngle = this.random() * Math.PI * 2;
    const tDist = wallRadius + 4 + this.random() * 14;

    // Movement speed scales with density (bustling = energetic, abandoned = sluggish)
    const baseSpeed = 0.4 + populationDensity * 0.8;
    const speedVariance = this.random() * 0.4;

    this.group.add(mesh);
    this.villagers.push({
      mesh,
      targetX: Math.sin(tAngle) * tDist,
      targetZ: Math.cos(tAngle) * tDist,
      speed: baseSpeed + speedVariance,
      behavior,
      timer: 3 + this.random() * 8,
      phase: this.random() * Math.PI * 2
    });
  }

  private createVillagerMesh(): THREE.Group {
    const villager = new THREE.Group();

    const skinColors = [0xe8c39e, 0xd4a574, 0xc4956a, 0xa07a5a];
    const clothColors = [0x4488cc, 0xcc4444, 0x44aa44, 0xddaa33, 0x8855aa, 0xcc6633, 0x5588aa, 0xaa6644];
    const skinColor = skinColors[Math.floor(this.random() * skinColors.length)];
    const clothColor = clothColors[Math.floor(this.random() * clothColors.length)];

    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.32, 0.16),
      new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.8 })
    );
    body.position.y = 0.46;
    body.castShadow = true;
    villager.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 5),
      new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 })
    );
    head.position.y = 0.7;
    villager.add(head);

    // Hat (sometimes)
    if (this.random() > 0.5) {
      const hatColors = [0x8B4513, 0x654321, 0x3a3a3a, 0xcc3333];
      const hat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.1, 0.1, 6),
        new THREE.MeshStandardMaterial({ color: hatColors[Math.floor(this.random() * hatColors.length)], roughness: 0.7 })
      );
      hat.position.y = 0.8;
      villager.add(hat);
    }

    // Legs
    const legMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.8 });
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.07), legMat);
    leftLeg.position.set(-0.06, 0.2, 0);
    leftLeg.name = 'leftLeg';
    villager.add(leftLeg);
    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.07), legMat);
    rightLeg.position.set(0.06, 0.2, 0);
    rightLeg.name = 'rightLeg';
    villager.add(rightLeg);

    // Arms
    const armMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.8 });
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), armMat);
    leftArm.position.set(-0.16, 0.44, 0);
    leftArm.name = 'leftArm';
    villager.add(leftArm);
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), armMat);
    rightArm.position.set(0.16, 0.44, 0);
    rightArm.name = 'rightArm';
    villager.add(rightArm);

    return villager;
  }

  private updateVillagers(state: RenderState, weather?: WeatherRenderState): void {
    const dt = state.deltaTime / 1000;
    const tier = state.tier;
    const wallRadius = this.getWallRadius(tier);

    // Weather affects villager speed and behavior
    let speedMultiplier = 1.0;
    let shouldHunker = false;
    if (weather) {
      // Rain: people walk faster (hurrying), hunker down
      if (weather.rainIntensity > 0.3) {
        speedMultiplier = 1.3;
        shouldHunker = true;
      }
      // Storm: even faster
      if (weather.stormFactor > 0.3) {
        speedMultiplier = 1.5;
        shouldHunker = true;
      }
      // Cold: slower, hunched
      if (weather.coldFactor > 0.3) {
        speedMultiplier *= (1 - weather.coldFactor * 0.3);
        shouldHunker = true;
      }
      // Heat: slower, lethargic
      if (weather.heatFactor > 0.3) {
        speedMultiplier *= (1 - weather.heatFactor * 0.25);
      }
      // Wind: slight push
      if (weather.windFactor > 0.3) {
        shouldHunker = true;
      }
    }

    for (let i = this.villagers.length - 1; i >= 0; i--) {
      const v = this.villagers[i];
      v.timer -= dt;
      v.phase += dt * 6;

      // Weather posture: hunch forward in rain/cold/wind
      const body = v.mesh.children.find(c => c.position.y > 0.4 && c.position.y < 0.5);
      if (body) {
        const hunchTarget = shouldHunker ? 0.12 : 0;
        body.rotation.x += (hunchTarget - body.rotation.x) * 0.05;
      }

      if (v.behavior === 'wander' || v.behavior === 'play') {
        // Walk towards target
        const dx = v.targetX - v.mesh.position.x;
        const dz = v.targetZ - v.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 0.3) {
          const effectiveSpeed = v.speed * speedMultiplier;
          const moveX = (dx / dist) * effectiveSpeed * dt;
          const moveZ = (dz / dist) * effectiveSpeed * dt;
          v.mesh.position.x += moveX;
          v.mesh.position.z += moveZ;

          // Wind pushes villagers slightly
          if (weather && weather.windFactor > 0.2) {
            v.mesh.position.x += weather.windFactor * 0.15 * dt;
          }

          v.mesh.rotation.y = Math.atan2(dx, dz);

          // Walk animation (faster animation when speed is higher)
          const animSpeed = v.phase * (speedMultiplier > 1 ? 1.2 : 1);
          v.mesh.children.forEach(c => {
            if (c.name === 'leftLeg') c.rotation.x = Math.sin(animSpeed) * 0.4;
            if (c.name === 'rightLeg') c.rotation.x = Math.sin(animSpeed + Math.PI) * 0.4;
            if (c.name === 'leftArm') c.rotation.x = Math.sin(animSpeed + Math.PI) * 0.25;
            if (c.name === 'rightArm') c.rotation.x = Math.sin(animSpeed) * 0.25;
          });

          // Bob
          v.mesh.position.y = Math.abs(Math.sin(v.phase)) * 0.02;
        } else if (v.timer <= 0) {
          // Pick new target
          const tAngle = this.random() * Math.PI * 2;
          const tDist = wallRadius + 4 + this.random() * 14;
          v.targetX = Math.sin(tAngle) * tDist;
          v.targetZ = Math.cos(tAngle) * tDist;
          v.timer = 2 + this.random() * 6;
          // Maybe change behavior
          if (this.random() > 0.7) {
            v.behavior = this.random() > 0.5 ? 'wander' : 'play';
          }
        }

        // Kids playing: faster, more bouncy (but not in heavy rain/storm)
        if (v.behavior === 'play') {
          const playIntensity = (weather && (weather.rainIntensity > 0.5 || weather.stormFactor > 0.3))
            ? 0.03 : 0.08;
          v.mesh.position.y = Math.abs(Math.sin(v.phase * 1.5)) * playIntensity;
        }
      } else if (v.behavior === 'shop') {
        // Stand near a stall, shift weight
        v.mesh.position.y = 0;
        v.mesh.rotation.y += Math.sin(state.time * 0.5 + i) * 0.002;
        // Idle arm movement
        v.mesh.children.forEach(c => {
          if (c.name === 'rightArm') c.rotation.x = Math.sin(state.time * 2 + i) * 0.1;
        });

        if (v.timer <= 0) {
          v.behavior = 'wander';
          const tAngle = this.random() * Math.PI * 2;
          const tDist = wallRadius + 4 + this.random() * 12;
          v.targetX = Math.sin(tAngle) * tDist;
          v.targetZ = Math.cos(tAngle) * tDist;
          v.timer = 4 + this.random() * 8;
        }
      } else if (v.behavior === 'watch') {
        // Stand facing a billboard, occasionally look around
        v.mesh.position.y = 0;
        if (v.timer <= 0) {
          v.behavior = 'wander';
          v.timer = 3 + this.random() * 5;
          const tAngle = this.random() * Math.PI * 2;
          const tDist = wallRadius + 4 + this.random() * 12;
          v.targetX = Math.sin(tAngle) * tDist;
          v.targetZ = Math.cos(tAngle) * tDist;
        }
      }

      // Remove if too far
      const dFromCenter = Math.sqrt(v.mesh.position.x ** 2 + v.mesh.position.z ** 2);
      if (dFromCenter > 40) {
        this.group.remove(v.mesh);
        this.villagers.splice(i, 1);
      }
    }
  }

  // ─── Legendary Landmarks (fountains, statues, obelisks, torches) ──

  private buildLandmarks(tier: CastleTier): void {
    if (this.landmarksBuilt) return;
    this.landmarksBuilt = true;

    const wallRadius = this.getWallRadius(tier);
    const RING_R_LM = wallRadius + 6;

    // Paired statues flanking the INNER approach (between castle wall and ring)
    // Placed just inside the courtyard, guarding the gate approach.
    for (const side of [-1, 1]) {
      const statue = this.createStatue();
      statue.position.set(side * 3.0, 0, wallRadius + 3);
      statue.rotation.y = side > 0 ? -0.15 : 0.15;
      this.landmarkGroup.add(statue);
    }

    // Obelisk at −Z (rear) on the ring road only.
    // ±X are handled by crossroad plazas, +Z by grand entrance plaza.
    {
      const obelisk = this.createObelisk();
      obelisk.position.set(0, 0, -RING_R_LM);
      obelisk.rotation.y = Math.PI;
      this.landmarkGroup.add(obelisk);
    }

    // Torch-lined main avenue (pairs along the Z+ path)
    // Must be OUTSIDE both the grand plaza (center z=20, r=6 → z<26)
    // AND the waypoint plaza (center z=30, r=3.5 → z<33.5).
    // Start torches past the waypoint plaza at z=34.5.
    const torchStartZ = RING_R_LM + 14.5; // 34.5 — past waypoint plaza
    const torchCount = 3;
    for (let i = 0; i < torchCount; i++) {
      const z = torchStartZ + i * 3;
      for (const side of [-1, 1]) {
        const torch = this.createTorch();
        torch.position.set(side * 2.5, 0, z);
        this.landmarkGroup.add(torch);
      }
    }

    // Banners along the ring road — 4 banners at diagonal positions.
    // Avoids: grand plaza (+Z ≈ 0°), crossroad plazas (±X ≈ ±90°), rear obelisk (−Z ≈ 180°).
    // Placed at ~45°, ~135°, ~225°, ~315° — clean diagonal symmetry.
    const RING_R = wallRadius + 6;
    const bannerAngles = [
      Math.PI * 0.25,   // front-right diagonal
      Math.PI * 0.75,   // rear-right diagonal
      Math.PI * 1.25,   // rear-left diagonal
      Math.PI * 1.75    // front-left diagonal
    ];
    for (const angle of bannerAngles) {
      const banner = this.createBanner();
      banner.position.set(Math.sin(angle) * RING_R, 0, Math.cos(angle) * RING_R);
      banner.rotation.y = angle + Math.PI; // face outward
      this.landmarkGroup.add(banner);
    }
  }

  private createStatue(): THREE.Group {
    const statue = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a9a8a, roughness: 0.6, metalness: 0.1 });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd700, roughness: 0.3, metalness: 0.7,
      emissive: 0xffa500, emissiveIntensity: 0.05
    });

    // Pedestal
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 1.2), stoneMat);
    pedestal.position.y = 0.75;
    pedestal.castShadow = true;
    statue.add(pedestal);

    // Figure body
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.2, 8), stoneMat);
    body.position.y = 2.1;
    body.castShadow = true;
    statue.add(body);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), stoneMat);
    head.position.y = 2.85;
    statue.add(head);

    // Sword held upright
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.0, 0.02), goldMat);
    sword.position.set(0.3, 2.6, 0);
    statue.add(sword);

    // Shield
    const shield = new THREE.Mesh(new THREE.CircleGeometry(0.25, 6), stoneMat);
    shield.position.set(-0.3, 2.2, 0.15);
    shield.rotation.y = Math.PI / 3;
    statue.add(shield);

    return statue;
  }

  private createObelisk(): THREE.Group {
    const obelisk = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7a7a6a, roughness: 0.5, metalness: 0.15 });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd700, roughness: 0.2, metalness: 0.8,
      emissive: 0xffa500, emissiveIntensity: 0.1
    });

    // Base
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 1.0), stoneMat);
    base.position.y = 0.2;
    base.castShadow = true;
    obelisk.add(base);

    // Shaft (tapered box)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 3.5, 4), stoneMat);
    shaft.position.y = 2.15;
    shaft.rotation.y = Math.PI / 4; // align edges
    shaft.castShadow = true;
    obelisk.add(shaft);

    // Gold pyramid cap
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 4), goldMat);
    cap.position.y = 4.15;
    cap.rotation.y = Math.PI / 4;
    cap.castShadow = true;
    obelisk.add(cap);

    return obelisk;
  }

  private createTorch(): THREE.Group {
    const torch = new THREE.Group();
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.5 });

    // Post
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.8, 6), ironMat);
    post.position.y = 0.9;
    post.castShadow = true;
    torch.add(post);

    // Bracket
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.04), ironMat);
    bracket.position.set(0, 1.85, 0);
    torch.add(bracket);

    // Flame bowl
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 0.1, 6), ironMat);
    bowl.position.y = 1.88;
    torch.add(bowl);

    // Flame glow
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      emissive: 0xff4400,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.9
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 6), flameMat);
    flame.position.y = 2.05;
    flame.name = 'flame';
    torch.add(flame);

    return torch;
  }

  /**
   * Load and cache the token's image as a texture for banner fabric.
   * Falls back to solid color if loading fails (CORS, 404, etc.).
   */
  private loadTokenImageTexture(imageUrl: string): void {
    if (this.tokenImageUrl === imageUrl) return;
    if (this.tokenImageLoading) return;

    this.tokenImageUrl = imageUrl;
    this.tokenImageLoading = true;

    this.textureLoader.setCrossOrigin('anonymous');
    this.textureLoader.load(
      imageUrl,
      (texture) => {
        if (this.tokenImageTexture) {
          this.tokenImageTexture.dispose();
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        this.tokenImageTexture = texture;
        this.tokenImageLoading = false;
        this.applyTokenTextureToExistingBanners();
      },
      undefined,
      () => {
        this.tokenImageLoading = false;
        this.tokenImageUrl = null;
      }
    );
  }

  /**
   * Retroactively apply loaded token image texture to all existing banner fabric meshes.
   */
  private applyTokenTextureToExistingBanners(): void {
    if (!this.tokenImageTexture) return;

    const targets = [this.landmarkGroup, this.group];
    for (const parent of targets) {
      parent.traverse((child) => {
        if (child.name === 'bannerFabric' && child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.map = this.tokenImageTexture;
          mat.transparent = true;
          mat.alphaTest = 0.1;
          mat.needsUpdate = true;
        }
      });
    }
  }

  /**
   * Create a banner pole with fabric colored by token identity.
   * The banner fabric uses the token's sigil color — every token
   * gets a unique medieval palette derived from its symbol.
   * If a token image texture is loaded, it's applied to the fabric.
   * Trim/finial metal reflects token health (gold → iron as decay increases).
   */
  private createBanner(): THREE.Group {
    const banner = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x5a4a3a,
      roughness: 0.85 + this.materialWear.roughnessBoost
    });

    // Pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 3, 6), woodMat);
    pole.position.y = 1.5;
    pole.castShadow = true;
    banner.add(pole);

    // Trim metal: token health determines gold vs iron
    const trimMat = new THREE.MeshStandardMaterial({
      color: this.tokenColors.trim,
      roughness: 0.3 + this.materialWear.roughnessBoost,
      metalness: 0.7 - this.materialWear.metalnessReduction
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), trimMat);
    ball.position.y = 3.05;
    banner.add(ball);

    // Fabric banner — colored by token sigil identity
    // Slight random variation (±10% lightness) so not all banners are identical
    const colorVariation = 0.95 + this.random() * 0.1;
    const fabricColor = new THREE.Color(this.tokenColors.fabric);
    fabricColor.multiplyScalar(colorVariation);

    const fabricMatOptions: THREE.MeshStandardMaterialParameters = {
      color: fabricColor,
      roughness: 0.65 + this.materialWear.roughnessBoost,
      side: THREE.DoubleSide,
    };
    if (this.tokenImageTexture) {
      fabricMatOptions.map = this.tokenImageTexture;
      fabricMatOptions.transparent = true;
      fabricMatOptions.alphaTest = 0.1;
    }
    const fabric = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 1.2),
      new THREE.MeshStandardMaterial(fabricMatOptions)
    );
    fabric.position.set(0, 2.1, 0.05);
    fabric.name = 'bannerFabric';
    banner.add(fabric);

    // Accent trim stripe at top of banner
    const trim = new THREE.Mesh(
      new THREE.PlaneGeometry(0.65, 0.05),
      trimMat
    );
    trim.position.set(0, 2.7, 0.06);
    banner.add(trim);

    return banner;
  }

  private updateLandmarks(state: RenderState): void {
    if (!this.landmarksBuilt) return;

    // Animate torch flames (flicker)
    this.landmarkGroup.traverse((child) => {
      if (child.name === 'flame' && child instanceof THREE.Mesh) {
        const flicker = 1.0 + Math.sin(state.time * 8 + child.position.x * 3) * 0.15;
        child.scale.setScalar(flicker);
        child.position.y = 2.05 + Math.sin(state.time * 6) * 0.01;
      }
      // Banner wind sway
      if (child.name === 'bannerFabric' && child instanceof THREE.Mesh) {
        child.rotation.y = Math.sin(state.time * 1.5 + child.position.z * 0.5) * 0.08;
      }
      // Gold accent shimmer — slow emissive pulse on gold materials (caps, balls, shields)
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.metalness >= 0.7 && mat.color && mat.color.getHex() === 0xffd700) {
          // Slow golden shimmer — each element slightly offset by world position
          const shimmer = 0.10 + Math.sin(state.time * 1.2 + child.position.x * 2 + child.position.z) * 0.05;
          mat.emissiveIntensity = shimmer;
        }
      }
    });
  }

  // ─── Legendary Plazas (ceremonial gathering spaces) ──────

  /**
   * Builds ceremonial plazas that break the road approach into a journey.
   *
   * Layout (all on the +Z main avenue axis):
   *   1. Grand Entrance Plaza — large circular plaza where the main avenue
   *      meets the ring boulevard. Acts as the primary arrival space.
   *   2. Outer Waypoint Plaza — smaller circular plaza further along the
   *      main avenue, breaking the long road stretch.
   *   3. Ring Crossroad Plazas — two small plazas at the ±X ring/promenade
   *      junctions, marking the boulevard intersections.
   *
   * Each plaza is a flat circular stone disc with gold border ring,
   * furnished with symmetrical elements: fountain/statue at center,
   * torch ring around perimeter, banner clusters at compass points.
   */
  private buildLegendaryPlazas(tier: CastleTier): void {
    if (this.plazasBuilt) return;
    this.plazasBuilt = true;

    const wallRadius = this.getWallRadius(tier);
    const RING_R = wallRadius + 6;
    const ROAD_Y = 0.07; // above road surface (0.06) to layer cleanly atop roads

    // ─── Shared materials ──────────────────────────────────
    const plazaStoneMat = new THREE.MeshStandardMaterial({
      color: 0xddd0b5,    // slightly lighter than road stone
      roughness: 0.50,    // polished plaza stone — catches ambient light
      metalness: 0.10,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const plazaBorderMat = new THREE.MeshStandardMaterial({
      color: 0xc8a84e,    // gold border ring
      roughness: 0.40,
      metalness: 0.40,
      emissive: 0xb8942e,
      emissiveIntensity: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const darkStoneMat = new THREE.MeshStandardMaterial({
      color: 0x8a8a7a,
      roughness: 0.55,
      metalness: 0.12
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: 0.25,
      metalness: 0.70,
      emissive: 0xffa500,
      emissiveIntensity: 0.06
    });
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x4488aa,
      roughness: 0.15,
      metalness: 0.3,
      transparent: true,
      opacity: 0.7
    });

    // ─── Helper: create a circular plaza disc ──────────────
    const createPlazaDisc = (
      cx: number, cz: number, radius: number
    ): void => {
      // Main stone surface
      const discGeom = new THREE.CircleGeometry(radius, 48);
      const disc = new THREE.Mesh(discGeom, plazaStoneMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(cx, ROAD_Y, cz);
      disc.receiveShadow = true;
      this.plazaGroup.add(disc);

      // Gold border ring (slightly larger circle underneath)
      const borderGeom = new THREE.RingGeometry(radius - 0.15, radius + 0.15, 48);
      const border = new THREE.Mesh(borderGeom, plazaBorderMat);
      border.rotation.x = -Math.PI / 2;
      border.position.set(cx, ROAD_Y + 0.003, cz);
      border.receiveShadow = true;
      this.plazaGroup.add(border);

      // Inner decorative ring (concentric accent at ~60% radius)
      const innerRingGeom = new THREE.RingGeometry(radius * 0.58, radius * 0.62, 48);
      const innerRing = new THREE.Mesh(innerRingGeom, plazaBorderMat);
      innerRing.rotation.x = -Math.PI / 2;
      innerRing.position.set(cx, ROAD_Y + 0.002, cz);
      this.plazaGroup.add(innerRing);
    };

    // ─── Helper: create a fountain centerpiece ─────────────
    const createFountain = (cx: number, cz: number): void => {
      const fountain = new THREE.Group();
      fountain.position.set(cx, 0, cz);

      // Octagonal basin (outer)
      const basin = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.8, 0.5, 8),
        darkStoneMat
      );
      basin.position.y = 0.25;
      basin.castShadow = true;
      fountain.add(basin);

      // Water surface inside basin
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(1.45, 24),
        waterMat
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.48;
      water.name = 'fountainWater';
      fountain.add(water);

      // Inner pedestal column
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.4, 1.2, 8),
        darkStoneMat
      );
      pedestal.position.y = 1.1;
      pedestal.castShadow = true;
      fountain.add(pedestal);

      // Upper bowl (smaller, elevated)
      const upperBowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.5, 0.25, 8),
        darkStoneMat
      );
      upperBowl.position.y = 1.8;
      upperBowl.castShadow = true;
      fountain.add(upperBowl);

      // Water spout sphere at top
      const spout = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 8, 6),
        goldMat
      );
      spout.position.y = 2.1;
      fountain.add(spout);

      // Upper water surface
      const upperWater = new THREE.Mesh(
        new THREE.CircleGeometry(0.55, 16),
        waterMat
      );
      upperWater.rotation.x = -Math.PI / 2;
      upperWater.position.y = 1.9;
      upperWater.name = 'fountainWater';
      fountain.add(upperWater);

      this.plazaGroup.add(fountain);
    };

    // ─── Helper: create torch ring around a plaza ──────────
    const createTorchRing = (
      cx: number, cz: number, radius: number, count: number
    ): void => {
      const ironMat = new THREE.MeshStandardMaterial({
        color: 0x3a3a3a, roughness: 0.5, metalness: 0.5
      });
      const flameMat = new THREE.MeshStandardMaterial({
        color: 0xff6600,
        emissive: 0xff4400,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.9
      });

      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const tx = cx + Math.sin(angle) * radius;
        const tz = cz + Math.cos(angle) * radius;

        const torch = new THREE.Group();
        torch.position.set(tx, 0, tz);

        // Post
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.06, 1.5, 6),
          ironMat
        );
        post.position.y = 0.75;
        post.castShadow = true;
        torch.add(post);

        // Bowl
        const bowl = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.07, 0.08, 6),
          ironMat
        );
        bowl.position.y = 1.55;
        torch.add(bowl);

        // Flame
        const flame = new THREE.Mesh(
          new THREE.ConeGeometry(0.07, 0.18, 6),
          flameMat
        );
        flame.position.y = 1.7;
        flame.name = 'plazaFlame';
        torch.add(flame);

        this.plazaGroup.add(torch);
      }
    };

    // ─── Helper: create banner cluster (pair flanking) ─────
    const createBannerPair = (
      cx: number, cz: number, facingAngle: number, spacing: number
    ): void => {
      const woodMat = new THREE.MeshStandardMaterial({
        color: 0x5a4a3a, roughness: 0.85 + this.materialWear.roughnessBoost
      });
      const trimMat = new THREE.MeshStandardMaterial({
        color: this.tokenColors.trim,
        roughness: 0.3 + this.materialWear.roughnessBoost,
        metalness: 0.7 - this.materialWear.metalnessReduction
      });

      for (const side of [-1, 1]) {
        const bx = cx + Math.cos(facingAngle) * side * spacing;
        const bz = cz - Math.sin(facingAngle) * side * spacing;

        const banner = new THREE.Group();
        banner.position.set(bx, 0, bz);

        // Pole
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.05, 2.6, 6),
          woodMat
        );
        pole.position.y = 1.3;
        pole.castShadow = true;
        banner.add(pole);

        // Finial — uses token trim metal
        const finial = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 6, 4),
          trimMat
        );
        finial.position.y = 2.65;
        banner.add(finial);

        // Fabric — token sigil color with slight variation
        const colorVariation = 0.9 + this.random() * 0.2;
        const fabricColor = new THREE.Color(this.tokenColors.fabric);
        fabricColor.multiplyScalar(colorVariation);
        const fabric = new THREE.Mesh(
          new THREE.PlaneGeometry(0.5, 1.0),
          new THREE.MeshStandardMaterial({
            color: fabricColor,
            roughness: 0.65 + this.materialWear.roughnessBoost,
            side: THREE.DoubleSide
          })
        );
        fabric.position.set(0, 1.85, 0.04);
        fabric.name = 'plazaBannerFabric';
        banner.add(fabric);

        // Trim strip — token accent metal
        const trimStrip = new THREE.Mesh(
          new THREE.PlaneGeometry(0.55, 0.04),
          trimMat
        );
        trimStrip.position.set(0, 2.35, 0.05);
        banner.add(trimStrip);

        banner.rotation.y = facingAngle;
        this.plazaGroup.add(banner);
      }
    };

    // ═══════════════════════════════════════════════════════════
    // 1. GRAND ENTRANCE PLAZA
    //    Located where the main avenue meets the ring boulevard.
    //    This is the primary arrival space — large, impressive.
    //    Intentionally restrained: fountain + torch ring only.
    //    Let the space breathe — grandeur through emptiness, not clutter.
    // ═══════════════════════════════════════════════════════════
    {
      const plazaCZ = RING_R; // centered on the ring road intersection
      const plazaRadius = 6.0; // larger radius for breathing room

      createPlazaDisc(0, plazaCZ, plazaRadius);

      // Central fountain — the singular focal point
      createFountain(0, plazaCZ);

      // Torch ring at perimeter edge — 6 torches (not 8), more spacing
      createTorchRing(0, plazaCZ, plazaRadius * 0.82, 6);

      // Only 2 banner pairs — flanking the main avenue entry and exit
      createBannerPair(0, plazaCZ + plazaRadius * 0.9, 0, 1.5);          // north (outward)
      createBannerPair(0, plazaCZ - plazaRadius * 0.9, Math.PI, 1.5);    // south (toward castle)
    }

    // ═══════════════════════════════════════════════════════════
    // 2. OUTER WAYPOINT PLAZA
    //    Further along the main avenue, breaking the long road.
    //    Smaller and more intimate — a moment of pause.
    // ═══════════════════════════════════════════════════════════
    {
      const plazaCZ = RING_R + 10; // along the main avenue, past ring
      const plazaRadius = 3.5;

      createPlazaDisc(0, plazaCZ, plazaRadius);

      // Central obelisk — the singular landmark here
      const obelisk = this.createObelisk();
      obelisk.position.set(0, 0, plazaCZ);
      this.plazaGroup.add(obelisk);

      // 4 torches at compass points
      createTorchRing(0, plazaCZ, plazaRadius * 0.75, 4);
    }

    // ═══════════════════════════════════════════════════════════
    // 3. RING CROSSROAD PLAZAS (×2)
    //    Small plazas at the ±X ring/promenade junctions.
    //    Mark the boulevard intersections symmetrically.
    //    Minimal: just a disc + obelisk, no torches/banners.
    // ═══════════════════════════════════════════════════════════
    for (const side of [-1, 1]) {
      const plazaCX = side * RING_R;
      const plazaCZ = 0;
      const plazaRadius = 2.8;

      createPlazaDisc(plazaCX, plazaCZ, plazaRadius);

      // Single obelisk at center — mirror of waypoint style
      const obelisk = this.createObelisk();
      obelisk.position.set(plazaCX, 0, plazaCZ);
      obelisk.scale.setScalar(0.8);
      this.plazaGroup.add(obelisk);
    }
  }

  private updatePlazas(state: RenderState): void {
    if (!this.plazasBuilt) return;

    this.plazaGroup.traverse((child) => {
      // Animate plaza torch flames
      if (child.name === 'plazaFlame' && child instanceof THREE.Mesh) {
        const flicker = 1.0 + Math.sin(state.time * 9 + child.position.x * 5 + child.position.z * 3) * 0.18;
        child.scale.setScalar(flicker);
        child.position.y = 1.7 + Math.sin(state.time * 7 + child.position.x) * 0.012;
      }
      // Banner sway
      if (child.name === 'plazaBannerFabric' && child instanceof THREE.Mesh) {
        child.rotation.y = Math.sin(state.time * 1.8 + child.position.z * 0.7 + child.position.x * 0.4) * 0.1;
      }
      // Fountain water shimmer (gentle scale pulse)
      if (child.name === 'fountainWater' && child instanceof THREE.Mesh) {
        const shimmer = 1.0 + Math.sin(state.time * 3 + child.position.x * 2) * 0.008;
        child.scale.set(shimmer, shimmer, 1);
      }
    });
  }

  private clearPlazas(): void {
    while (this.plazaGroup.children.length > 0) {
      const child = this.plazaGroup.children[0];
      this.plazaGroup.remove(child);
      if (child instanceof THREE.Group) this.disposeGroup(child);
      else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }
    this.plazasBuilt = false;
  }

  // ─── Legendary Polish (ground glow, torch spill, material sheen) ──

  /**
   * Adds final visual polish to the legendary environment.
   * Everything here is purely visual — emissive-only meshes with
   * no real PointLights (the zone light system handles actual lighting).
   *
   * Effects:
   *   1. Soft ground glow along the main avenue — warm amber ribbon
   *   2. Torch ground spill circles — faint warm circles beneath every torch
   *   3. Ring boulevard glow — subtle ring of warmth around the castle
   *   4. Gold accent shimmer — animated emissive pulse on gold elements
   */
  private buildLegendaryPolish(tier: CastleTier): void {
    if (this.polishBuilt) return;
    this.polishBuilt = true;

    const wallRadius = this.getWallRadius(tier);
    const RING_R = wallRadius + 6;
    const gateZ = this.getGateZ(tier);

    // ─── Shared glow material (warm amber, emissive-only) ────
    const groundGlowMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffaa55,
      emissiveIntensity: 0.12,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const torchSpillMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xff8833,
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.20,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // ─── 1. Main Avenue Ground Glow ─────────────────────────
    // A wide, soft amber ribbon along the main road center line.
    // Creates a sense of warmth and ceremony guiding the eye to the gate.
    {
      const glowLength = gateZ + 30 - gateZ; // full avenue length
      const glowWidth = 5.0; // wider than road for soft falloff
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(glowWidth, glowLength),
        groundGlowMat
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(0, 0.065, gateZ + glowLength / 2);
      glow.name = 'avenueGlow';
      this.polishGroup.add(glow);
    }

    // ─── 2. Gate Approach Glow (gate → ring) ────────────────
    // Slightly brighter glow for the sacred approach corridor.
    {
      const approachMat = groundGlowMat.clone();
      approachMat.emissiveIntensity = 0.16;
      approachMat.opacity = 0.30;

      const approachLen = RING_R - gateZ;
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(4.5, approachLen),
        approachMat
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(0, 0.065, gateZ + approachLen / 2);
      glow.name = 'approachGlow';
      this.polishGroup.add(glow);
    }

    // ─── 3. Ring Boulevard Glow ─────────────────────────────
    // Soft circular glow ring around the castle, matching the boulevard.
    {
      const ringGlow = new THREE.Mesh(
        new THREE.RingGeometry(RING_R - 1.8, RING_R + 1.8, 64),
        groundGlowMat
      );
      ringGlow.rotation.x = -Math.PI / 2;
      ringGlow.position.y = 0.065;
      ringGlow.name = 'ringGlow';
      this.polishGroup.add(ringGlow);
    }

    // ─── 4. Torch Ground Spill Circles ──────────────────────
    // Small warm circles at the base of each torch along the main avenue.
    // Must match torch positions in buildLandmarks (torchStartZ = RING_R+14.5).
    {
      const torchStartZ = RING_R + 14.5;
      const torchCount = 3;
      for (let i = 0; i < torchCount; i++) {
        const z = torchStartZ + i * 3;
        for (const side of [-1, 1]) {
          const spill = new THREE.Mesh(
            new THREE.CircleGeometry(1.2, 16),
            torchSpillMat
          );
          spill.rotation.x = -Math.PI / 2;
          spill.position.set(side * 2.5, 0.075, z);
          spill.name = 'torchSpill';
          this.polishGroup.add(spill);
        }
      }
    }

    // ─── 5. Plaza Torch Spill ───────────────────────────────
    // Spill circles at plaza torch positions (must match plaza build counts).
    {
      const plazaSpillMat = torchSpillMat.clone();
      plazaSpillMat.opacity = 0.15;

      // Grand entrance plaza torches (6 torches at RING_R, radius 6.0 * 0.82)
      const grandPlazaR = 6.0 * 0.82;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const spill = new THREE.Mesh(
          new THREE.CircleGeometry(1.0, 12),
          plazaSpillMat
        );
        spill.rotation.x = -Math.PI / 2;
        spill.position.set(
          Math.sin(angle) * grandPlazaR,
          0.075,
          RING_R + Math.cos(angle) * grandPlazaR
        );
        spill.name = 'torchSpill';
        this.polishGroup.add(spill);
      }

      // Outer waypoint plaza torches (4 torches at RING_R+10, radius 3.5 * 0.75)
      const waypointR = 3.5 * 0.75;
      const waypointZ = RING_R + 10;
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const spill = new THREE.Mesh(
          new THREE.CircleGeometry(0.8, 12),
          plazaSpillMat
        );
        spill.rotation.x = -Math.PI / 2;
        spill.position.set(
          Math.sin(angle) * waypointR,
          0.075,
          waypointZ + Math.cos(angle) * waypointR
        );
        spill.name = 'torchSpill';
        this.polishGroup.add(spill);
      }
      // Note: crossroad plazas have no torches, so no spill needed.
    }

    // ─── 6. Grand Plaza Fountain Glow ───────────────────────
    // A soft blue-white circle at the grand fountain base,
    // simulating water reflecting ambient light.
    {
      const waterGlowMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0x88bbdd,
        emissiveIntensity: 0.10,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const waterGlow = new THREE.Mesh(
        new THREE.CircleGeometry(2.2, 24),
        waterGlowMat
      );
      waterGlow.rotation.x = -Math.PI / 2;
      waterGlow.position.set(0, 0.075, RING_R);
      waterGlow.name = 'fountainGlow';
      this.polishGroup.add(waterGlow);
    }
  }

  private updatePolish(state: RenderState): void {
    if (!this.polishBuilt) return;

    // Gentle breathing pulse on all glow elements — slow, subtle, powerful.
    // Different elements pulse at slightly different rates for organic feel.
    this.polishGroup.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mat = child.material as THREE.MeshStandardMaterial;
      if (!mat.emissive) return;

      if (child.name === 'avenueGlow' || child.name === 'approachGlow') {
        // Main avenue: very slow breath (6s period)
        const breath = 1.0 + Math.sin(state.time * 1.05) * 0.08;
        mat.opacity = (child.name === 'approachGlow' ? 0.30 : 0.25) * breath;
      } else if (child.name === 'ringGlow') {
        // Ring: slower breath offset from avenue
        const breath = 1.0 + Math.sin(state.time * 0.8 + 1.5) * 0.06;
        mat.opacity = 0.25 * breath;
      } else if (child.name === 'torchSpill') {
        // Torch spill: gentle flicker matching torch flame rhythm
        const flicker = 1.0 + Math.sin(state.time * 7 + child.position.x * 3 + child.position.z * 2) * 0.15;
        mat.opacity = 0.18 * flicker;
      } else if (child.name === 'fountainGlow') {
        // Fountain: gentle shimmer
        const shimmer = 1.0 + Math.sin(state.time * 2.5 + 0.8) * 0.10;
        mat.opacity = 0.18 * shimmer;
      }
    });
  }

  private clearPolish(): void {
    while (this.polishGroup.children.length > 0) {
      const child = this.polishGroup.children[0];
      this.polishGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }
    this.polishBuilt = false;
  }

  // ─── Exchange Trade Markers ──────────────────────────────
  //
  // Each exchange listing becomes a simplified trade marker (banner/post)
  // placed along the main avenue or ring road. Markers indicate prosperity
  // and trade connections — more exchanges = more prosperous atmosphere.
  //
  // Major CEX = tall flag near the grand plaza
  // Small CEX = medium flag along the avenue
  // DEX = small marker post along the ring road

  /**
   * Render exchange name onto a small canvas for use as a texture label.
   */
  private createExchangeNameTexture(name: string, width = 128, height = 48): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 248, 230, 0.85)';
    ctx.font = `bold ${Math.floor(height * 0.5)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const displayName = name.length > 10 ? name.slice(0, 9) + '.' : name;
    ctx.fillText(displayName, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private buildTradeMarkers(state: RenderState): void {
    if (this.tradeMarkersBuilt) return;
    this.tradeMarkersBuilt = true;

    const { exchanges } = state;
    if (!exchanges || exchanges.length === 0) return;

    const wallRadius = this.getWallRadius(state.tier);
    const RING_R = wallRadius + 6;
    const { major, minor, dex } = categorizeExchanges(exchanges);

    const markerWoodMat = new THREE.MeshStandardMaterial({
      color: 0x6a5a4a, roughness: 0.8
    });

    // ─── Major CEX: tall allied banners near grand plaza entrance ───
    // Exchange-specific colors with name labels on pennants.
    major.forEach((exchange, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const offset = Math.floor(i / 2) * 2.5;
      const z = RING_R + 6.5 + offset;
      const x = side * 4.5;

      const marker = new THREE.Group();
      marker.position.set(x, 0, z);

      // Tall pole
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.07, 3.5, 6),
        markerWoodMat
      );
      pole.position.y = 1.75;
      pole.castShadow = true;
      marker.add(pole);

      // Large pennant — exchange-specific color
      const pennantColor = new THREE.Color(getExchangeColor(exchange.name));
      const pennant = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 1.4),
        new THREE.MeshStandardMaterial({
          color: pennantColor, roughness: 0.6, side: THREE.DoubleSide
        })
      );
      pennant.position.set(0, 2.6, 0.05);
      pennant.name = 'tradeMarkerFabric';
      marker.add(pennant);

      // Name label below pennant
      const nameTexture = this.createExchangeNameTexture(exchange.name);
      const nameLabel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.25),
        new THREE.MeshBasicMaterial({
          map: nameTexture, transparent: true,
          side: THREE.DoubleSide, depthWrite: false,
        })
      );
      nameLabel.position.set(0, 1.8, 0.06);
      nameLabel.name = 'tradeMarkerLabel';
      marker.add(nameLabel);

      // Gold cap
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 6, 4),
        new THREE.MeshStandardMaterial({
          color: this.tokenColors.trim, roughness: 0.3, metalness: 0.7
        })
      );
      cap.position.y = 3.55;
      marker.add(cap);

      marker.rotation.y = side > 0 ? -0.1 : 0.1;
      this.tradeMarkerGroup.add(marker);
    });

    // ─── Small CEX: medium markers along the avenue ───
    minor.forEach((exchange, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const z = RING_R + 12 + i * 2;
      const x = side * 3.8;

      const marker = new THREE.Group();
      marker.position.set(x, 0, z);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.06, 2.5, 6),
        markerWoodMat
      );
      pole.position.y = 1.25;
      marker.add(pole);

      // Exchange-specific colored flag
      const flagColor = new THREE.Color(getExchangeColor(exchange.name));
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.8),
        new THREE.MeshStandardMaterial({
          color: flagColor, roughness: 0.7, side: THREE.DoubleSide
        })
      );
      flag.position.set(0, 2.0, 0.04);
      flag.name = 'tradeMarkerFabric';
      marker.add(flag);

      // Smaller name label
      const nameTexture = this.createExchangeNameTexture(exchange.name, 96, 32);
      const nameLabel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.45, 0.18),
        new THREE.MeshBasicMaterial({
          map: nameTexture, transparent: true,
          side: THREE.DoubleSide, depthWrite: false,
        })
      );
      nameLabel.position.set(0, 1.4, 0.05);
      nameLabel.name = 'tradeMarkerLabel';
      marker.add(nameLabel);

      this.tradeMarkerGroup.add(marker);
    });

    // ─── DEX: small post markers along the ring road ───
    // Shield color from exchange identity, no name labels (too small).
    dex.forEach((exchange, i) => {
      const angle = Math.PI * 0.1 + (i / Math.max(dex.length, 1)) * Math.PI * 0.8;
      const side = i % 2 === 0 ? 1 : -1;
      const a = angle * side;
      const x = Math.sin(a) * (RING_R + 2.5);
      const z = Math.cos(a) * (RING_R + 2.5);

      const marker = new THREE.Group();
      marker.position.set(x, 0, z);

      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.04, 1.5, 6),
        markerWoodMat
      );
      post.position.y = 0.75;
      marker.add(post);

      // Exchange-specific shield color
      const shieldColor = new THREE.Color(getExchangeColor(exchange.name));
      const shield = new THREE.Mesh(
        new THREE.CircleGeometry(0.2, 6),
        new THREE.MeshStandardMaterial({
          color: shieldColor, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide
        })
      );
      shield.position.set(0, 1.3, 0.03);
      marker.add(shield);

      marker.rotation.y = a + Math.PI;
      this.tradeMarkerGroup.add(marker);
    });
  }

  private clearTradeMarkers(): void {
    while (this.tradeMarkerGroup.children.length > 0) {
      const child = this.tradeMarkerGroup.children[0];
      this.tradeMarkerGroup.remove(child);
      if (child instanceof THREE.Group) {
        // Dispose canvas textures from name labels
        child.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            const mat = c.material as THREE.Material & { map?: THREE.Texture };
            if (mat.map) mat.map.dispose();
          }
        });
        this.disposeGroup(child);
      } else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }
    this.tradeMarkersBuilt = false;
  }

  // ─── Legendary Amusement Park ─────────────────────────────

  private buildAmusementPark(tier: CastleTier): void {
    if (this.parkBuilt) return;
    this.parkBuilt = true;

    const wallRadius = this.getWallRadius(tier);
    const parkCenter = wallRadius + 18;

    // Ferris Wheel
    this.ferrisWheel = this.createFerrisWheel();
    this.ferrisWheel.position.set(-parkCenter * 0.6, 0, parkCenter * 0.8);
    this.parkGroup.add(this.ferrisWheel);

    // Carousel
    this.carousel = this.createCarousel();
    this.carousel.position.set(parkCenter * 0.5, 0, parkCenter * 0.7);
    this.parkGroup.add(this.carousel);

    // Festival stalls (colored, festive)
    const stallAngles = [0, 0.5, 1.0, 1.5, 2.0, 2.5];
    for (const offset of stallAngles) {
      const angle = offset + Math.PI * 0.3;
      const dist = parkCenter * 0.6;
      const stall = this.createFestivalStall();
      stall.position.set(
        Math.sin(angle) * dist,
        0,
        Math.cos(angle) * dist + wallRadius
      );
      stall.rotation.y = angle + Math.PI;
      this.parkGroup.add(stall);
      this.festivalStalls.push(stall);
    }

    // Entrance arch
    const arch = this.createParkEntrance();
    arch.position.set(0, 0, wallRadius + 12);
    this.parkGroup.add(arch);
  }

  private createFerrisWheel(): THREE.Group {
    const wheel = new THREE.Group();
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.4, metalness: 0.6 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.7 });

    // Support legs (A-frame)
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 5, 0.15), metalMat);
      leg.position.set(side * 1.2, 2.5, 0);
      leg.rotation.z = side * 0.15;
      leg.castShadow = true;
      wheel.add(leg);

      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 0.1), metalMat);
      brace.position.set(side * 0.8, 1.5, 0.6);
      brace.rotation.z = side * 0.1;
      brace.rotation.x = -0.3;
      wheel.add(brace);
    }

    // Cross brace
    const crossBrace = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.1), metalMat);
    crossBrace.position.y = 2;
    wheel.add(crossBrace);

    // The rotating wheel part
    const rotatingPart = new THREE.Group();
    rotatingPart.name = 'wheelRotator';
    rotatingPart.position.y = 4.5;

    // Hub
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 8), goldMat);
    hub.rotation.x = Math.PI / 2;
    rotatingPart.add(hub);

    // Spokes and gondolas
    const gondolaColors = [0xff4444, 0x4444ff, 0x44ff44, 0xffff44, 0xff44ff, 0x44ffff, 0xff8844, 0x8844ff];
    const spokeCount = 8;
    const wheelRadius = 3;
    for (let i = 0; i < spokeCount; i++) {
      const angle = (i / spokeCount) * Math.PI * 2;

      // Spoke
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, wheelRadius * 2, 0.05),
        metalMat
      );
      spoke.rotation.z = angle;
      rotatingPart.add(spoke);

      // Gondola at end
      const gondola = new THREE.Group();
      gondola.name = `gondola_${i}`;
      const gondolaBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.5, 0.35),
        new THREE.MeshStandardMaterial({ color: gondolaColors[i], roughness: 0.6 })
      );
      gondola.add(gondolaBody);

      // Gondola hanger
      const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), metalMat);
      hanger.position.y = 0.4;
      gondola.add(hanger);

      gondola.position.set(
        Math.sin(angle) * wheelRadius,
        Math.cos(angle) * wheelRadius,
        0
      );
      rotatingPart.add(gondola);
    }

    // Rim (ring of small segments)
    const rimSegments = 32;
    for (let i = 0; i < rimSegments; i++) {
      const a = (i / rimSegments) * Math.PI * 2;
      const na = ((i + 1) / rimSegments) * Math.PI * 2;
      const rimSeg = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.6, 0.04),
        metalMat
      );
      rimSeg.position.set(
        Math.sin(a) * wheelRadius,
        Math.cos(a) * wheelRadius,
        0
      );
      rimSeg.rotation.z = a + Math.PI / rimSegments;
      rotatingPart.add(rimSeg);
    }

    wheel.add(rotatingPart);
    return wheel;
  }

  private createCarousel(): THREE.Group {
    const carousel = new THREE.Group();
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.6 });

    // Base platform
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.6 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.8, 0.3, 16), baseMat);
    base.position.y = 0.15;
    base.castShadow = true;
    carousel.add(base);

    // Center pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.5, 8), goldMat);
    pole.position.y = 2;
    pole.castShadow = true;
    carousel.add(pole);

    // Conical roof
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.5 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3, 1.5, 12), roofMat);
    roof.position.y = 4;
    roof.castShadow = true;
    carousel.add(roof);

    // Roof trim
    const trim = new THREE.Mesh(new THREE.TorusGeometry(3, 0.08, 6, 24), goldMat);
    trim.position.y = 3.25;
    trim.rotation.x = Math.PI / 2;
    carousel.add(trim);

    // Rotating part with horses
    const rotator = new THREE.Group();
    rotator.name = 'carouselRotator';
    rotator.position.y = 0.35;

    const horseCount = 8;
    const horseColors = [0xf5f5dc, 0x8B4513, 0x2f2f2f, 0xd4a574, 0xffffff, 0xa0522d, 0x808080, 0xdeb887];
    for (let i = 0; i < horseCount; i++) {
      const angle = (i / horseCount) * Math.PI * 2;
      const horse = this.createCarouselHorse(horseColors[i]);
      horse.position.set(Math.sin(angle) * 2, 0.8 + (i % 2) * 0.3, Math.cos(angle) * 2);
      horse.rotation.y = angle + Math.PI / 2;
      horse.name = `horse_${i}`;
      rotator.add(horse);

      // Pole connecting horse to roof
      const horsePole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 2.5, 4),
        goldMat
      );
      horsePole.position.set(Math.sin(angle) * 2, 2, Math.cos(angle) * 2);
      rotator.add(horsePole);
    }

    carousel.add(rotator);

    // Top decoration
    const topBall = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), goldMat);
    topBall.position.y = 4.75;
    carousel.add(topBall);

    return carousel;
  }

  private createCarouselHorse(color: number): THREE.Group {
    const horse = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.2), mat);
    horse.add(body);

    // Head/neck
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.25, 0.12), mat);
    head.position.set(0.35, 0.15, 0);
    head.rotation.z = 0.3;
    horse.add(head);

    // Legs
    for (const [lx, lz] of [[-0.2, 0.08], [-0.2, -0.08], [0.2, 0.08], [0.2, -0.08]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), mat);
      leg.position.set(lx, -0.25, lz);
      horse.add(leg);
    }

    // Saddle
    const saddle = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.08, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.6 })
    );
    saddle.position.y = 0.16;
    horse.add(saddle);

    return horse;
  }

  private createFestivalStall(): THREE.Group {
    const stall = new THREE.Group();

    // Striped awning (wider, more festive)
    const awningMat = new THREE.MeshStandardMaterial({
      color: this.random() > 0.5 ? 0xff4444 : 0x4488ff,
      roughness: 0.6,
      side: THREE.DoubleSide
    });
    const awning = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.6), awningMat);
    awning.position.set(0, 1.8, -0.2);
    awning.rotation.x = -0.25;
    awning.castShadow = true;
    stall.add(awning);

    // Counter
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.8 })
    );
    counter.position.y = 0.45;
    counter.castShadow = true;
    stall.add(counter);

    // Prize/goods display (colorful small items)
    for (let i = 0; i < 5; i++) {
      const prize = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 6, 4),
        new THREE.MeshStandardMaterial({
          color: [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff][i],
          roughness: 0.5
        })
      );
      prize.position.set(-0.6 + i * 0.3, 1, 0);
      stall.add(prize);
    }

    // Festive pennant strings
    const pennantMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.5 });
    const pennant = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.02, 0.02), pennantMat);
    pennant.position.set(0, 2.1, 0);
    stall.add(pennant);

    return stall;
  }

  private createParkEntrance(): THREE.Group {
    const entrance = new THREE.Group();
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0xffa500,
      emissiveIntensity: 0.15
    });

    // Two pillars
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 4, 8), goldMat);
      pillar.position.set(side * 2.5, 2, 0);
      pillar.castShadow = true;
      entrance.add(pillar);

      // Top ball
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), goldMat);
      ball.position.set(side * 2.5, 4.2, 0);
      entrance.add(ball);
    }

    // Arch beam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.4, 0.3), goldMat);
    beam.position.y = 3.8;
    beam.castShadow = true;
    entrance.add(beam);

    // Decorative banner below arch
    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0xcc3333,
      roughness: 0.6,
      side: THREE.DoubleSide
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.6), bannerMat);
    banner.position.set(0, 3.3, 0.16);
    entrance.add(banner);

    return entrance;
  }

  private updateAmusementPark(state: RenderState): void {
    if (!this.parkBuilt) return;

    // Rotate ferris wheel
    if (this.ferrisWheel) {
      const rotator = this.ferrisWheel.getObjectByName('wheelRotator');
      if (rotator) {
        rotator.rotation.z += state.deltaTime / 1000 * 0.15;

        // Keep gondolas level (counter-rotate)
        rotator.children.forEach(child => {
          if (child.name.startsWith('gondola_')) {
            child.rotation.z = -rotator.rotation.z;
          }
        });
      }
    }

    // Rotate carousel
    if (this.carousel) {
      const rotator = this.carousel.getObjectByName('carouselRotator');
      if (rotator) {
        rotator.rotation.y += state.deltaTime / 1000 * 0.4;

        // Horses bob up and down
        rotator.children.forEach(child => {
          if (child.name.startsWith('horse_')) {
            const idx = parseInt(child.name.split('_')[1]);
            child.position.y = 0.8 + (idx % 2) * 0.3 + Math.sin(state.time * 2 + idx * 0.8) * 0.15;
          }
        });
      }
    }
  }

  // ─── Main update ──────────────────────────────────────────

  update(state: RenderState, weather?: WeatherRenderState): void {
    // ─── Token Identity ─────────────────────────────────────
    // Recompute identity colors when state updates (cheap — just hash + math).
    // This drives banner colors, material wear, trim metals, and glow intensity.
    if (state.tokenSymbol) {
      this.tokenColors = getTokenColors(state.tokenSymbol, state.decay);
      this.materialWear = getMaterialWear(state);
    }

    // Load token image for banner textures (lazy, cached)
    if (state.tokenImageUrl && state.tokenImageUrl !== this.tokenImageUrl) {
      this.loadTokenImageTexture(state.tokenImageUrl);
    }

    // Build world structures when tier changes
    if (state.tier !== this.builtForTier && state.hasGraduated) {
      this.buildOuterWorld(state.tier);
    }

    // Build for pre-graduation too (basic keep world)
    if (!this.builtForTier && state.phase === 'construction') {
      this.buildOuterWorld('keep');
    }

    // Legendary amusement park
    if (state.isLegendary && !this.parkBuilt) {
      this.buildAmusementPark(state.tier);
      this.parkGroup.visible = true;
    }
    if (this.parkGroup.visible !== state.isLegendary) {
      this.parkGroup.visible = state.isLegendary;
    }

    if (state.isLegendary) {
      this.updateAmusementPark(state);
    }

    // Legendary landmarks (fountains, statues, obelisks, torches)
    if (state.isLegendary && !this.landmarksBuilt) {
      this.buildLandmarks(state.tier);
      this.landmarkGroup.visible = true;
    }
    if (this.landmarkGroup.visible !== state.isLegendary) {
      this.landmarkGroup.visible = state.isLegendary;
    }

    if (state.isLegendary) {
      this.updateLandmarks(state);
    }

    // Legendary plazas (ceremonial arrival spaces)
    if (state.isLegendary && !this.plazasBuilt) {
      this.buildLegendaryPlazas(state.tier);
      this.plazaGroup.visible = true;
    }
    if (this.plazaGroup.visible !== state.isLegendary) {
      this.plazaGroup.visible = state.isLegendary;
    }

    if (state.isLegendary) {
      this.updatePlazas(state);
    }

    // Legendary polish (soft ground glow, torch spill, material enhancements)
    if (state.isLegendary && !this.polishBuilt) {
      this.buildLegendaryPolish(state.tier);
      this.polishGroup.visible = true;
    }
    if (this.polishGroup.visible !== state.isLegendary) {
      this.polishGroup.visible = state.isLegendary;
    }

    if (state.isLegendary) {
      this.updatePolish(state);
    }

    // Exchange trade markers (visible for any graduated token with exchanges)
    if (state.hasGraduated && state.exchangeCount > 0 && !this.tradeMarkersBuilt) {
      this.buildTradeMarkers(state);
      this.tradeMarkerGroup.visible = true;
    }
    if (this.tradeMarkerGroup.visible !== (state.hasGraduated && state.exchangeCount > 0)) {
      this.tradeMarkerGroup.visible = state.hasGraduated && state.exchangeCount > 0;
    }

    // Manage villager population — driven by transaction-based population density
    const pop = state.smoothPopulation ?? state.populationDensity ?? 0;
    this.maxVillagers = this.getMaxVillagers(
      state.tier,
      state.activityLevel,
      state.isLegendary,
      pop
    );

    this.spawnTimer -= state.deltaTime / 1000;
    if (this.spawnTimer <= 0 && this.villagers.length < this.maxVillagers) {
      this.spawnVillager(state.tier, pop);
      // Spawn rate scales with density: bustling → fast spawns, ghost town → slow
      const spawnInterval = pop > 0.6 ? 0.3 + this.random() * 0.7
        : pop > 0.3 ? 0.5 + this.random() * 1.5
        : 2 + this.random() * 3;
      this.spawnTimer = spawnInterval;
    }

    // Remove excess villagers
    while (this.villagers.length > this.maxVillagers + 2) {
      const removed = this.villagers.pop()!;
      this.group.remove(removed.mesh);
    }

    // Update villager animation with weather effects
    this.updateVillagers(state, weather);

    // Update lamppost glow based on daylight
    // (emissive intensity is static, but we could animate if needed)
  }

  // ─── Cleanup ──────────────────────────────────────────────

  private clearStructures(): void {
    // Remove all static elements
    for (const p of this.paths) { this.group.remove(p); p.geometry.dispose(); }
    this.paths = [];

    for (const g of this.gardens) { this.group.remove(g); this.disposeGroup(g); }
    this.gardens = [];

    for (const s of this.stalls) { this.group.remove(s); this.disposeGroup(s); }
    this.stalls = [];

    for (const b of this.benches) { this.group.remove(b); this.disposeGroup(b); }
    this.benches = [];

    for (const bb of this.billboards) { this.group.remove(bb); this.disposeGroup(bb); }
    this.billboards = [];

    for (const l of this.lampposts) { this.group.remove(l); this.disposeGroup(l); }
    this.lampposts = [];

    // Remove villagers
    for (const v of this.villagers) { this.group.remove(v.mesh); this.disposeGroup(v.mesh); }
    this.villagers = [];

    // Clear park
    this.clearPark();

    // Clear landmarks
    this.clearLandmarks();

    // Clear plazas
    this.clearPlazas();

    // Clear polish
    this.clearPolish();

    // Clear trade markers
    this.clearTradeMarkers();
  }

  private clearPark(): void {
    while (this.parkGroup.children.length > 0) {
      const child = this.parkGroup.children[0];
      this.parkGroup.remove(child);
      if (child instanceof THREE.Group) this.disposeGroup(child);
      else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }
    this.ferrisWheel = null;
    this.carousel = null;
    this.festivalStalls = [];
    this.parkBuilt = false;
  }

  private clearLandmarks(): void {
    while (this.landmarkGroup.children.length > 0) {
      const child = this.landmarkGroup.children[0];
      this.landmarkGroup.remove(child);
      if (child instanceof THREE.Group) this.disposeGroup(child);
      else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }
    this.landmarksBuilt = false;
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    });
  }

  reset(seed: number): void {
    this.seed = seed;
    this.clearStructures();
    this.builtForTier = null;
    this.currentTier = null;
    this.spawnTimer = 0;
    // Clear token image cache
    if (this.tokenImageTexture) {
      this.tokenImageTexture.dispose();
      this.tokenImageTexture = null;
    }
    this.tokenImageUrl = null;
    this.tokenImageLoading = false;
  }

  dispose(): void {
    this.clearStructures();
    if (this.tokenImageTexture) {
      this.tokenImageTexture.dispose();
      this.tokenImageTexture = null;
    }
    this.scene.remove(this.group);
  }
}
