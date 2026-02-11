/**
 * PhysicsMotion.ts
 *
 * Lightweight physics-like motion for environmental elements:
 * - Hanging banners (sway with wind)
 * - Scaffolding (creak + slight movement with decay)
 * - Cracked towers (lean + vibration)
 * - Loose debris (occasional fall)
 *
 * No heavy physics engine - just math-driven motion.
 */

import * as THREE from 'three';
import type { RenderState } from '$lib/types';
import type { WeatherRenderState } from '$lib/state/WeatherState';
import { seededRandom } from '$lib/state/CastleState';

interface SwayingElement {
  mesh: THREE.Object3D;
  baseRotation: THREE.Euler;
  frequency: number;
  amplitude: number;
  phase: number;
  damping: number;
}

interface CreakingElement {
  mesh: THREE.Object3D;
  basePosition: THREE.Vector3;
  frequency: number;
  amplitude: number;
  phase: number;
}

interface FallingDebris {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  rotSpeed: THREE.Vector3;
  life: number;
  settled: boolean;
}

export class PhysicsMotion {
  private scene: THREE.Scene;
  private physicsGroup: THREE.Group;
  private random: () => number;
  private seed: number;

  // Tracked elements
  private swayingElements: SwayingElement[] = [];
  private creakingElements: CreakingElement[] = [];
  private fallingDebris: FallingDebris[] = [];

  // Persistent debris on ground (scars)
  private groundDebris: THREE.Mesh[] = [];
  private readonly MAX_GROUND_DEBRIS = 30;

  // Wind state
  private windStrength: number = 0.3;
  private windDirection: number = 0;
  private windGustTimer: number = 0;
  private windGustStrength: number = 0;

  // Debris spawn timer
  private debrisTimer: number = 0;

  constructor(scene: THREE.Scene, seed: number = 12345) {
    this.scene = scene;
    this.seed = seed;
    this.random = seededRandom(seed);

    this.physicsGroup = new THREE.Group();
    this.physicsGroup.name = 'physics';
    this.scene.add(this.physicsGroup);
  }

  /**
   * Register a mesh to sway (flags, banners, hanging cloth)
   */
  registerSwaying(mesh: THREE.Object3D, options?: {
    frequency?: number;
    amplitude?: number;
    damping?: number;
  }): void {
    this.swayingElements.push({
      mesh,
      baseRotation: mesh.rotation.clone(),
      frequency: options?.frequency ?? (0.5 + this.random() * 1.5),
      amplitude: options?.amplitude ?? (0.05 + this.random() * 0.1),
      phase: this.random() * Math.PI * 2,
      damping: options?.damping ?? 0.95
    });
  }

  /**
   * Register a mesh to creak (scaffolding, platforms)
   */
  registerCreaking(mesh: THREE.Object3D, options?: {
    frequency?: number;
    amplitude?: number;
  }): void {
    this.creakingElements.push({
      mesh,
      basePosition: mesh.position.clone(),
      frequency: options?.frequency ?? (1 + this.random() * 2),
      amplitude: options?.amplitude ?? (0.01 + this.random() * 0.02),
      phase: this.random() * Math.PI * 2
    });
  }

  /**
   * Main update
   */
  update(state: RenderState, weather?: WeatherRenderState): void {
    const dt = state.deltaTime / 1000;
    const time = state.time;

    // Update wind (weather amplifies wind)
    this.updateWind(state, dt, weather);

    // Update swaying elements
    this.updateSwaying(state, time);

    // Update creaking elements (cold = stiffer)
    this.updateCreaking(state, time, weather);

    // Update falling debris
    this.updateFallingDebris(dt, weather);

    // Spawn debris during decay (more in wind/storm)
    this.maybeSpawnDebris(state, dt, weather);
  }

  /**
   * Update wind parameters based on state + weather
   */
  private updateWind(state: RenderState, dt: number, weather?: WeatherRenderState): void {
    // Base wind from activity
    let targetWind =
      state.activityLevel === 'booming' ? 0.5 :
        state.activityLevel === 'active' ? 0.35 :
          state.activityLevel === 'slow' ? 0.2 : 0.1;

    // Weather wind modifier (additive, capped)
    if (weather) {
      targetWind += weather.windFactor * 0.5;
      targetWind += weather.stormFactor * 0.3;
      targetWind = Math.min(1.2, targetWind);
    }

    this.windStrength += (targetWind - this.windStrength) * dt * 2;

    // Wind direction slowly changes
    this.windDirection += dt * 0.1;

    // Wind gusts (more frequent in storms)
    this.windGustTimer -= dt;
    const gustInterval = (weather && weather.stormFactor > 0.3)
      ? 1.5 + this.random() * 3
      : 3 + this.random() * 8;
    if (this.windGustTimer <= 0) {
      this.windGustStrength = this.random() * 0.4 + (weather ? weather.stormFactor * 0.3 : 0);
      this.windGustTimer = gustInterval;
    }
    this.windGustStrength *= Math.pow(0.3, dt);
  }

  /**
   * Update swaying elements (banners, flags)
   */
  private updateSwaying(state: RenderState, time: number): void {
    const totalWind = this.windStrength + this.windGustStrength;

    // Decay increases sway amplitude
    const decayAmplifier = 1 + state.smoothDecay * 2;

    for (const elem of this.swayingElements) {
      const windPhase = time * elem.frequency + elem.phase;
      const swayX = Math.sin(windPhase) * elem.amplitude * totalWind * decayAmplifier;
      const swayZ = Math.cos(windPhase * 0.7 + 1.3) * elem.amplitude * totalWind * decayAmplifier * 0.5;

      elem.mesh.rotation.x = elem.baseRotation.x + swayX;
      elem.mesh.rotation.z = elem.baseRotation.z + swayZ;
    }
  }

  /**
   * Update creaking elements (scaffolding) – cold makes them stiffer
   */
  private updateCreaking(state: RenderState, time: number, weather?: WeatherRenderState): void {
    // More creaking with more decay
    const decayFactor = state.smoothDecay;
    if (decayFactor < 0.1) return;

    // Cold → stiffer (reduce amplitude), heat → more dust/creak
    const stiffness = weather ? (1 - weather.coldFactor * 0.4) : 1;
    const heatLoosen = weather ? (1 + weather.heatFactor * 0.3) : 1;

    for (const elem of this.creakingElements) {
      const amp = elem.amplitude * stiffness * heatLoosen;
      const creak = Math.sin(time * elem.frequency + elem.phase) * amp * decayFactor;
      const creak2 = Math.sin(time * elem.frequency * 1.7 + elem.phase) * amp * 0.5 * decayFactor;

      elem.mesh.position.x = elem.basePosition.x + creak;
      elem.mesh.position.z = elem.basePosition.z + creak2;

      // Slight rotation with heavy decay
      if (decayFactor > 0.5) {
        elem.mesh.rotation.z = Math.sin(time * elem.frequency * 0.3 + elem.phase) * 0.02 * decayFactor * stiffness;
      }
    }
  }

  /**
   * Update falling debris particles – rain makes debris heavier, wind pushes
   */
  private updateFallingDebris(dt: number, weather?: WeatherRenderState): void {
    for (let i = this.fallingDebris.length - 1; i >= 0; i--) {
      const d = this.fallingDebris[i];
      if (d.settled) continue;

      // Gravity (rain adds weight)
      const gravityMul = (weather && weather.rainIntensity > 0.2) ? 1.2 : 1.0;
      d.velocity.y -= 9.8 * dt * gravityMul;

      // Wind pushes debris
      if (weather && weather.windFactor > 0.1) {
        d.velocity.x += weather.windFactor * 2 * dt;
      }

      // Move
      d.mesh.position.add(d.velocity.clone().multiplyScalar(dt));

      // Rotate
      d.mesh.rotation.x += d.rotSpeed.x * dt;
      d.mesh.rotation.y += d.rotSpeed.y * dt;
      d.mesh.rotation.z += d.rotSpeed.z * dt;

      // Ground collision
      if (d.mesh.position.y < 0.05) {
        d.mesh.position.y = 0.05;

        if (d.velocity.length() < 0.5) {
          // Settle on ground as permanent scar
          d.settled = true;
          d.velocity.set(0, 0, 0);

          // Add to ground debris (persistent)
          if (this.groundDebris.length < this.MAX_GROUND_DEBRIS) {
            this.groundDebris.push(d.mesh);
          } else {
            // Remove oldest ground debris
            const old = this.groundDebris.shift()!;
            this.physicsGroup.remove(old);
            old.geometry.dispose();
          }

          // Remove from active list
          this.fallingDebris.splice(i, 1);
        } else {
          // Bounce
          d.velocity.y = Math.abs(d.velocity.y) * 0.3;
          d.velocity.x *= 0.7;
          d.velocity.z *= 0.7;
          d.rotSpeed.multiplyScalar(0.5);
        }
      }

      // Life limit for particles that fly off
      d.life -= dt;
      if (d.life <= 0) {
        this.physicsGroup.remove(d.mesh);
        d.mesh.geometry.dispose();
        this.fallingDebris.splice(i, 1);
      }
    }
  }

  /**
   * Maybe spawn debris during decay (wind/storm increases frequency)
   */
  private maybeSpawnDebris(state: RenderState, dt: number, weather?: WeatherRenderState): void {
    if (state.smoothDecay < 0.3) return;

    this.debrisTimer -= dt;
    if (this.debrisTimer > 0) return;

    // Higher decay = more frequent debris; wind/storm accelerates
    const weatherAccel = weather ? (1 - weather.windFactor * 0.3 - weather.stormFactor * 0.3) : 1;
    this.debrisTimer = ((1 - state.smoothDecay) * 5 + 0.5) * Math.max(0.2, weatherAccel);

    if (this.fallingDebris.length > 20) return;

    const count = Math.floor(state.smoothDecay * 3);
    for (let i = 0; i < count; i++) {
      this.spawnDebris(state);
    }
  }

  /**
   * Spawn a single debris particle
   */
  private spawnDebris(state: RenderState): void {
    const size = 0.05 + this.random() * 0.15;
    const geom = new THREE.BoxGeometry(size, size * 0.8, size * 0.6);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.08, 0.2, 0.3 + this.random() * 0.2),
      roughness: 0.9
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;

    // Start from random position on castle structure
    const tierRadius = state.tier === 'citadel' ? 12 :
      state.tier === 'fortress' ? 8 :
        state.tier === 'castle' ? 5 : 2;

    const angle = this.random() * Math.PI * 2;
    const r = this.random() * tierRadius;
    mesh.position.set(
      Math.cos(angle) * r,
      2 + this.random() * 6,
      Math.sin(angle) * r
    );

    this.physicsGroup.add(mesh);

    this.fallingDebris.push({
      mesh,
      velocity: new THREE.Vector3(
        (this.random() - 0.5) * 2,
        this.random() * 1,
        (this.random() - 0.5) * 2
      ),
      rotSpeed: new THREE.Vector3(
        (this.random() - 0.5) * 5,
        (this.random() - 0.5) * 5,
        (this.random() - 0.5) * 5
      ),
      life: 5 + this.random() * 3,
      settled: false
    });
  }

  /**
   * Get current wind strength (for other systems)
   */
  getWindStrength(): number {
    return this.windStrength + this.windGustStrength;
  }

  /**
   * Get wind direction angle
   */
  getWindDirection(): number {
    return this.windDirection;
  }

  reset(seed: number): void {
    this.seed = seed;
    this.random = seededRandom(seed);
    this.swayingElements = [];
    this.creakingElements = [];

    // Clean up debris
    for (const d of this.fallingDebris) {
      this.physicsGroup.remove(d.mesh);
      d.mesh.geometry.dispose();
    }
    this.fallingDebris = [];

    for (const d of this.groundDebris) {
      this.physicsGroup.remove(d);
      d.geometry.dispose();
    }
    this.groundDebris = [];

    this.debrisTimer = 0;
    this.windGustTimer = 0;
    this.windGustStrength = 0;
  }

  dispose(): void {
    this.reset(0);
    this.scene.remove(this.physicsGroup);
  }
}
