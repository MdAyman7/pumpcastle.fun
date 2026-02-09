/**
 * ActorManager.ts
 *
 * Manages continuous ambient activity:
 * - Guards patrolling walls
 * - Smoke particles from chimneys
 * - Birds crossing the sky
 *
 * Ensures the scene NEVER feels idle.
 * Volume drives actor count and speed.
 */

import * as THREE from 'three';
import type { RenderState } from '$lib/types';
import { seededRandom } from '$lib/state/CastleState';

// Guard patrol path point
interface PatrolPoint {
  x: number;
  y: number;
  z: number;
}

interface Guard {
  mesh: THREE.Group;
  patrolPath: PatrolPoint[];
  currentPathIndex: number;
  position: THREE.Vector3;
  speed: number;
  animPhase: number;
}

interface Bird {
  mesh: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  flapPhase: number;
  life: number;
}

interface SmokeParticle {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  startSize: number;
}

export class ActorManager {
  private scene: THREE.Scene;
  private actorGroup: THREE.Group;
  private random: () => number;
  private seed: number;

  // Guards
  private guards: Guard[] = [];
  private guardTemplate: THREE.Group | null = null;

  // Birds
  private birds: Bird[] = [];
  private birdTemplate: THREE.Group | null = null;
  private birdSpawnTimer: number = 0;

  // Smoke
  private smokeParticles: SmokeParticle[] = [];
  private smokeMaterial: THREE.MeshBasicMaterial;

  // Chimney positions (set based on tier)
  private chimneyPositions: THREE.Vector3[] = [];

  // Guard patrol paths per tier
  private readonly KEEP_PATROL: PatrolPoint[][] = [
    [{ x: -2, y: 0.1, z: 3 }, { x: 2, y: 0.1, z: 3 }, { x: 2, y: 0.1, z: -2 }, { x: -2, y: 0.1, z: -2 }]
  ];
  private readonly CASTLE_PATROL: PatrolPoint[][] = [
    [{ x: -5, y: 3, z: 5 }, { x: 5, y: 3, z: 5 }],
    [{ x: 5, y: 3, z: 5 }, { x: 5, y: 3, z: -5 }],
    [{ x: -5, y: 3, z: -5 }, { x: -5, y: 3, z: 5 }]
  ];
  private readonly FORTRESS_PATROL: PatrolPoint[][] = [];
  private readonly CITADEL_PATROL: PatrolPoint[][] = [];

  constructor(scene: THREE.Scene, seed: number = 12345) {
    this.scene = scene;
    this.seed = seed;
    this.random = seededRandom(seed);

    this.actorGroup = new THREE.Group();
    this.actorGroup.name = 'actors';
    this.scene.add(this.actorGroup);

    this.smokeMaterial = new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.3,
      depthWrite: false
    });

    this.createGuardTemplate();
    this.createBirdTemplate();
    this.buildFortressPatrol();
    this.buildCitadelPatrol();
  }

  private buildFortressPatrol(): void {
    // Fortress wall patrol paths (along the outer wall)
    for (let i = 0; i < 4; i++) {
      const angle1 = (i / 8) * Math.PI * 2;
      const angle2 = ((i + 1) / 8) * Math.PI * 2;
      const r = 8;
      this.FORTRESS_PATROL.push([
        { x: Math.cos(angle1) * r, y: 4, z: Math.sin(angle1) * r },
        { x: Math.cos(angle2) * r, y: 4, z: Math.sin(angle2) * r }
      ]);
    }
  }

  private buildCitadelPatrol(): void {
    for (let i = 0; i < 6; i++) {
      const angle1 = (i / 6) * Math.PI * 2;
      const angle2 = ((i + 1) / 6) * Math.PI * 2;
      const r = 12;
      this.CITADEL_PATROL.push([
        { x: Math.cos(angle1) * r, y: 5, z: Math.sin(angle1) * r },
        { x: Math.cos(angle2) * r, y: 5, z: Math.sin(angle2) * r }
      ]);
    }
  }

  /**
   * Create guard mesh template (small armored figure)
   */
  private createGuardTemplate(): void {
    const group = new THREE.Group();

    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x708090, roughness: 0.4, metalness: 0.7
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe8c39e, roughness: 0.8
    });

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.35, 0.18), armorMat);
    body.position.y = 0.37;
    body.castShadow = true;
    group.add(body);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), skinMat);
    head.position.y = 0.65;
    group.add(head);

    // Helmet
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), armorMat);
    helmet.position.y = 0.68;
    helmet.scale.y = 1.1;
    group.add(helmet);

    // Legs
    const legGeom = new THREE.BoxGeometry(0.08, 0.2, 0.08);
    const leftLeg = new THREE.Mesh(legGeom, armorMat);
    leftLeg.position.set(-0.06, 0.1, 0);
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeom, armorMat);
    rightLeg.position.set(0.06, 0.1, 0);
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    // Spear
    const spearShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.9, 4),
      new THREE.MeshStandardMaterial({ color: 0x8b4513 })
    );
    spearShaft.position.set(0.18, 0.65, 0);
    group.add(spearShaft);

    const spearTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.03, 0.1, 4),
      new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 })
    );
    spearTip.position.set(0.18, 1.15, 0);
    group.add(spearTip);

    this.guardTemplate = group;
  }

  /**
   * Create bird mesh template
   */
  private createBirdTemplate(): void {
    const group = new THREE.Group();
    const birdMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });

    // Body
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 4),
      birdMat
    );
    body.scale.set(1.5, 0.8, 1);
    group.add(body);

    // Left wing
    const wingGeom = new THREE.PlaneGeometry(0.2, 0.06);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide });
    const leftWing = new THREE.Mesh(wingGeom, wingMat);
    leftWing.position.set(0, 0.02, 0.08);
    leftWing.name = 'leftWing';
    group.add(leftWing);

    // Right wing
    const rightWing = new THREE.Mesh(wingGeom, wingMat);
    rightWing.position.set(0, 0.02, -0.08);
    rightWing.name = 'rightWing';
    group.add(rightWing);

    this.birdTemplate = group;
  }

  /**
   * Main update
   */
  update(state: RenderState): void {
    const dt = state.deltaTime / 1000;

    this.updateChimneyPositions(state);
    this.updateGuards(state, dt);
    this.updateBirds(state, dt);
    this.updateSmoke(state, dt);
  }

  /**
   * Set chimney positions based on castle tier
   */
  private updateChimneyPositions(state: RenderState): void {
    // Only recalculate when tier changes
    const positions: THREE.Vector3[] = [];
    switch (state.tier) {
      case 'keep':
        positions.push(new THREE.Vector3(0.5, 5.5, 0.5));
        break;
      case 'castle':
        positions.push(new THREE.Vector3(1, 6, -1));
        positions.push(new THREE.Vector3(-2, 3, 5));
        break;
      case 'fortress':
        positions.push(new THREE.Vector3(0, 8, 0));
        positions.push(new THREE.Vector3(3, 4, 3));
        positions.push(new THREE.Vector3(-3, 4, -3));
        break;
      case 'citadel':
        positions.push(new THREE.Vector3(0, 15, 0));
        positions.push(new THREE.Vector3(4, 6, 0));
        positions.push(new THREE.Vector3(-4, 6, 0));
        positions.push(new THREE.Vector3(0, 6, 4));
        break;
    }
    this.chimneyPositions = positions;
  }

  /**
   * Update guard patrol
   */
  private updateGuards(state: RenderState, dt: number): void {
    // Determine target guard count
    const isPostGrad = state.hasGraduated && !state.isZombie;
    let targetCount = 0;
    let patrols: PatrolPoint[][] = [];

    if (isPostGrad) {
      switch (state.tier) {
        case 'keep':
          targetCount = state.activityLevel === 'dead' ? 0 : 1;
          patrols = this.KEEP_PATROL;
          break;
        case 'castle':
          targetCount = state.activityLevel === 'dead' ? 0 : 2;
          patrols = this.CASTLE_PATROL;
          break;
        case 'fortress':
          targetCount = state.activityLevel === 'dead' ? 0 : 3;
          patrols = this.FORTRESS_PATROL;
          break;
        case 'citadel':
          targetCount = state.activityLevel === 'dead' ? 0 : 4;
          patrols = this.CITADEL_PATROL;
          break;
      }
    }

    // Adjust volume-based modifiers
    if (state.activityLevel === 'booming') targetCount += 1;
    if (state.smoothDecay > 0.6) targetCount = Math.max(0, targetCount - 1);

    // Spawn guards
    while (this.guards.length < targetCount && patrols.length > 0) {
      if (!this.guardTemplate) break;
      const pathIdx = this.guards.length % patrols.length;
      const path = patrols[pathIdx];
      const mesh = this.guardTemplate.clone();
      const startPos = new THREE.Vector3(path[0].x, path[0].y, path[0].z);
      mesh.position.copy(startPos);
      mesh.scale.setScalar(0.8);
      this.actorGroup.add(mesh);

      this.guards.push({
        mesh,
        patrolPath: path,
        currentPathIndex: 0,
        position: startPos.clone(),
        speed: 1.0 + this.random() * 0.3,
        animPhase: this.random() * Math.PI * 2
      });
    }

    // Remove excess guards
    while (this.guards.length > targetCount) {
      const g = this.guards.pop()!;
      this.actorGroup.remove(g.mesh);
      g.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    }

    // Animate guards
    const speedMul = state.activityLevel === 'booming' ? 1.5 :
      state.activityLevel === 'active' ? 1.0 :
        state.activityLevel === 'slow' ? 0.6 : 0.3;

    for (const guard of this.guards) {
      guard.animPhase += dt * 3 * speedMul;

      const target = guard.patrolPath[guard.currentPathIndex];
      const targetVec = new THREE.Vector3(target.x, target.y, target.z);
      const toTarget = targetVec.clone().sub(guard.position);
      const dist = toTarget.length();

      if (dist > 0.2) {
        const move = toTarget.normalize().multiplyScalar(guard.speed * speedMul * dt);
        guard.position.add(move);
        guard.mesh.position.copy(guard.position);

        // Face direction
        guard.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);

        // Walk cycle
        guard.mesh.traverse(child => {
          if (child.name === 'leftLeg') child.rotation.x = Math.sin(guard.animPhase * 4) * 0.4;
          if (child.name === 'rightLeg') child.rotation.x = Math.sin(guard.animPhase * 4 + Math.PI) * 0.4;
        });

        // Subtle bob
        guard.mesh.position.y = guard.position.y + Math.abs(Math.sin(guard.animPhase * 4)) * 0.02;
      } else {
        // Arrive at patrol point, move to next
        guard.currentPathIndex = (guard.currentPathIndex + 1) % guard.patrolPath.length;
      }
    }
  }

  /**
   * Update birds
   */
  private updateBirds(state: RenderState, dt: number): void {
    // Spawn birds occasionally
    this.birdSpawnTimer -= dt;
    if (this.birdSpawnTimer <= 0 && !state.isZombie && !state.isCursed) {
      const spawnChance = state.activityLevel === 'booming' ? 0.4 :
        state.activityLevel === 'active' ? 0.3 :
          state.activityLevel === 'slow' ? 0.15 : 0.05;

      if (this.random() < spawnChance && this.birds.length < 6) {
        this.spawnBird();
      }
      this.birdSpawnTimer = 2 + this.random() * 5;
    }

    // Update birds
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const bird = this.birds[i];
      bird.flapPhase += dt * 8;
      bird.life -= dt;

      // Move
      bird.position.add(bird.velocity.clone().multiplyScalar(dt));
      bird.mesh.position.copy(bird.position);

      // Gentle sine wave flight path
      bird.mesh.position.y += Math.sin(bird.flapPhase * 0.3) * 0.3;

      // Wing flapping
      bird.mesh.traverse(child => {
        if (child.name === 'leftWing') {
          child.rotation.x = Math.sin(bird.flapPhase) * 0.6;
        }
        if (child.name === 'rightWing') {
          child.rotation.x = -Math.sin(bird.flapPhase) * 0.6;
        }
      });

      // Face flight direction
      bird.mesh.rotation.y = Math.atan2(bird.velocity.x, bird.velocity.z);

      // Remove when out of view or life expired
      if (bird.life <= 0 || Math.abs(bird.position.x) > 50 || Math.abs(bird.position.z) > 50) {
        this.actorGroup.remove(bird.mesh);
        bird.mesh.traverse(child => {
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });
        this.birds.splice(i, 1);
      }
    }
  }

  /**
   * Spawn a bird from a random edge
   */
  private spawnBird(): void {
    if (!this.birdTemplate) return;

    const mesh = this.birdTemplate.clone();
    const side = Math.floor(this.random() * 4);
    let x: number, z: number, vx: number, vz: number;

    switch (side) {
      case 0: // From left
        x = -40; z = (this.random() - 0.5) * 30;
        vx = 4 + this.random() * 4; vz = (this.random() - 0.5) * 2;
        break;
      case 1: // From right
        x = 40; z = (this.random() - 0.5) * 30;
        vx = -(4 + this.random() * 4); vz = (this.random() - 0.5) * 2;
        break;
      case 2: // From back
        x = (this.random() - 0.5) * 30; z = -40;
        vx = (this.random() - 0.5) * 2; vz = 4 + this.random() * 4;
        break;
      default: // From front
        x = (this.random() - 0.5) * 30; z = 40;
        vx = (this.random() - 0.5) * 2; vz = -(4 + this.random() * 4);
        break;
    }

    const y = 8 + this.random() * 12;
    const pos = new THREE.Vector3(x, y, z);
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.8 + this.random() * 0.4);
    this.actorGroup.add(mesh);

    this.birds.push({
      mesh,
      position: pos.clone(),
      velocity: new THREE.Vector3(vx, (this.random() - 0.5) * 0.5, vz),
      flapPhase: this.random() * Math.PI * 2,
      life: 10 + this.random() * 10
    });
  }

  /**
   * Update smoke particles from chimneys
   */
  private updateSmoke(state: RenderState, dt: number): void {
    // Only emit smoke when active (not zombie/dead)
    if (state.activityLevel !== 'dead' && !state.isZombie) {
      const emitRate = state.activityLevel === 'booming' ? 3 :
        state.activityLevel === 'active' ? 2 :
          state.activityLevel === 'slow' ? 1 : 0.5;

      for (const chimneyPos of this.chimneyPositions) {
        if (this.random() < emitRate * dt && this.smokeParticles.length < 60) {
          this.spawnSmoke(chimneyPos);
        }
      }
    }

    // Update existing smoke
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const s = this.smokeParticles[i];
      s.life -= dt;
      s.position.add(s.velocity.clone().multiplyScalar(dt));

      // Smoke rises and drifts
      s.velocity.y *= 0.99;
      s.velocity.x += (this.random() - 0.5) * 0.1 * dt;
      s.velocity.z += (this.random() - 0.5) * 0.1 * dt;

      s.mesh.position.copy(s.position);

      // Expand and fade
      const lifeRatio = s.life / s.maxLife;
      const scale = s.startSize * (1 + (1 - lifeRatio) * 2);
      s.mesh.scale.setScalar(scale);

      if (s.mesh.material instanceof THREE.MeshBasicMaterial) {
        s.mesh.material.opacity = lifeRatio * 0.25;
      }

      if (s.life <= 0) {
        this.actorGroup.remove(s.mesh);
        s.mesh.geometry.dispose();
        this.smokeParticles.splice(i, 1);
      }
    }
  }

  /**
   * Spawn smoke particle at chimney position
   */
  private spawnSmoke(origin: THREE.Vector3): void {
    const geom = new THREE.SphereGeometry(0.3, 4, 4);
    const mat = this.smokeMaterial.clone();
    const mesh = new THREE.Mesh(geom, mat);

    const pos = origin.clone().add(new THREE.Vector3(
      (this.random() - 0.5) * 0.3,
      0,
      (this.random() - 0.5) * 0.3
    ));
    mesh.position.copy(pos);
    this.actorGroup.add(mesh);

    this.smokeParticles.push({
      mesh,
      position: pos.clone(),
      velocity: new THREE.Vector3(
        (this.random() - 0.5) * 0.3,
        0.5 + this.random() * 0.5,
        (this.random() - 0.5) * 0.3
      ),
      life: 3 + this.random() * 3,
      maxLife: 6,
      startSize: 0.2 + this.random() * 0.3
    });
  }

  reset(seed: number): void {
    this.seed = seed;
    this.random = seededRandom(seed);

    // Remove guards
    for (const g of this.guards) {
      this.actorGroup.remove(g.mesh);
      g.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    }
    this.guards = [];

    // Remove birds
    for (const b of this.birds) {
      this.actorGroup.remove(b.mesh);
      b.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    }
    this.birds = [];

    // Remove smoke
    for (const s of this.smokeParticles) {
      this.actorGroup.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
    this.smokeParticles = [];

    this.birdSpawnTimer = 0;
  }

  dispose(): void {
    this.reset(0);
    this.smokeMaterial.dispose();

    if (this.guardTemplate) {
      this.guardTemplate.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
    }
    if (this.birdTemplate) {
      this.birdTemplate.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      });
    }

    this.scene.remove(this.actorGroup);
  }
}
