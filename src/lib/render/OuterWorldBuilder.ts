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
import type { RenderState, CastleTier } from '$lib/types';
import type { WeatherRenderState } from '$lib/state/WeatherState';

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

  // Animated villagers
  private villagers: Villager[] = [];
  private maxVillagers: number = 0;
  private spawnTimer: number = 0;

  // State tracking
  private currentTier: CastleTier | null = null;
  private builtForTier: CastleTier | null = null;

  constructor(scene: THREE.Scene, seed: number) {
    this.scene = scene;
    this.seed = seed;
    this.group = new THREE.Group();
    this.group.name = 'outerWorld';
    this.scene.add(this.group);

    this.parkGroup = new THREE.Group();
    this.parkGroup.name = 'amusementPark';
    this.parkGroup.visible = false;
    this.group.add(this.parkGroup);
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

    this.buildPaths(wallRadius);
    this.buildGardens(wallRadius, tier);
    this.buildMarketStalls(wallRadius, tier);
    this.buildBenches(wallRadius, tier);
    this.buildBillboards(wallRadius, tier);
    this.buildLampposts(wallRadius, tier);
  }

  private getWallRadius(tier: CastleTier): number {
    switch (tier) {
      case 'keep': return 4;
      case 'castle': return 7;
      case 'fortress': return 10;
      case 'citadel': return 14;
    }
  }

  // ─── Paths ────────────────────────────────────────────────

  private buildPaths(wallRadius: number): void {
    const pathMat = new THREE.MeshStandardMaterial({
      color: 0xc4a672,
      roughness: 0.95,
      metalness: 0
    });

    // Main road going outward from gate (positive Z)
    const mainPath = new THREE.Mesh(
      new THREE.PlaneGeometry(2.5, 30),
      pathMat
    );
    mainPath.rotation.x = -Math.PI / 2;
    mainPath.position.set(0, 0.02, wallRadius + 15);
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
      sidePath.position.set(Math.sin(angle) * dist, 0.02, Math.cos(angle) * dist);
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
      seg.position.set(cx, 0.02, cz);
      seg.receiveShadow = true;
      this.group.add(seg);
      this.paths.push(seg);
    }
  }

  // ─── Gardens ──────────────────────────────────────────────

  private buildGardens(wallRadius: number, tier: CastleTier): void {
    const gardenCount = tier === 'keep' ? 3 : tier === 'castle' ? 5 : tier === 'fortress' ? 7 : 10;
    const gardenDist = wallRadius + 8;

    for (let i = 0; i < gardenCount; i++) {
      const angle = (i / gardenCount) * Math.PI * 2 + this.random() * 0.3;
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
    const stallCount = tier === 'keep' ? 1 : tier === 'castle' ? 3 : tier === 'fortress' ? 5 : 8;
    const stallDist = wallRadius + 6;

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
    if (tier !== 'keep') {
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
        new THREE.MeshStandardMaterial({ color: goodColor, roughness: 0.7 })
      );
      good.position.set(-0.6 + i * 0.4, 0.88, 0);
      stall.add(good);
    }

    return stall;
  }

  // ─── Benches ──────────────────────────────────────────────

  private buildBenches(wallRadius: number, tier: CastleTier): void {
    const benchCount = tier === 'keep' ? 2 : tier === 'castle' ? 4 : tier === 'fortress' ? 6 : 10;

    for (let i = 0; i < benchCount; i++) {
      const angle = (i / benchCount) * Math.PI * 2 + this.random() * 0.5;
      const dist = wallRadius + 5 + this.random() * 8;
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
    const count = tier === 'keep' ? 1 : tier === 'castle' ? 2 : tier === 'fortress' ? 3 : 5;

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
    const count = tier === 'keep' ? 2 : tier === 'castle' ? 4 : tier === 'fortress' ? 6 : 10;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = wallRadius + 5;
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

  private getMaxVillagers(tier: CastleTier, activityLevel: string, isLegendary: boolean): number {
    const base: Record<string, number> = {
      'keep': 4, 'castle': 8, 'fortress': 14, 'citadel': 22
    };
    let count = base[tier] || 8;

    if (activityLevel === 'booming') count += 6;
    else if (activityLevel === 'active') count += 3;
    else if (activityLevel === 'dying' || activityLevel === 'dead') count = Math.floor(count * 0.3);

    if (isLegendary) count += 10;

    return count;
  }

  private spawnVillager(tier: CastleTier): void {
    const wallRadius = this.getWallRadius(tier);
    const mesh = this.createVillagerMesh();

    // Spawn around the outer area
    const angle = this.random() * Math.PI * 2;
    const dist = wallRadius + 4 + this.random() * 14;
    const x = Math.sin(angle) * dist;
    const z = Math.cos(angle) * dist;
    mesh.position.set(x, 0, z);

    const behaviors: Villager['behavior'][] = ['wander', 'shop', 'watch', 'play', 'wander', 'wander'];
    const behavior = behaviors[Math.floor(this.random() * behaviors.length)];

    // Pick a random target
    const tAngle = this.random() * Math.PI * 2;
    const tDist = wallRadius + 4 + this.random() * 14;

    this.group.add(mesh);
    this.villagers.push({
      mesh,
      targetX: Math.sin(tAngle) * tDist,
      targetZ: Math.cos(tAngle) * tDist,
      speed: 0.6 + this.random() * 0.8,
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

    // Manage villager population
    this.maxVillagers = this.getMaxVillagers(
      state.tier,
      state.activityLevel,
      state.isLegendary
    );

    // Don't spawn villagers in zombie/cursed (ghost town feel)
    if (!state.isZombie && !state.isCursed) {
      this.spawnTimer -= state.deltaTime / 1000;
      if (this.spawnTimer <= 0 && this.villagers.length < this.maxVillagers) {
        this.spawnVillager(state.tier);
        this.spawnTimer = 0.5 + this.random() * 1.5;
      }
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
  }

  dispose(): void {
    this.clearStructures();
    this.scene.remove(this.group);
  }
}
