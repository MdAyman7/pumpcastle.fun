/**
 * EffectsManager.ts
 *
 * Manages visual effects:
 * - Particle systems (confetti, sparks, embers, dust)
 * - Celebration effects
 * - Legendary rune glow
 */

import * as THREE from 'three';
import { WORLD_SCALE } from '$lib/state/CastleConstants';
import type { RenderState } from '$lib/types';
import { seededRandom } from '$lib/state/CastleState';

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  type: 'confetti' | 'spark' | 'ember' | 'dust';
}

export class EffectsManager {
  private scene: THREE.Scene;
  private effectsGroup: THREE.Group;
  private random: () => number;

  // Particle system
  private particles: Particle[] = [];
  private particleGeometry: THREE.BufferGeometry;
  private particleMaterial: THREE.PointsMaterial;
  private particleSystem: THREE.Points;

  // Max particles — reduced from 500. Celebration + legendary sparks + dust/embers
  // rarely exceed 150 even at peak. Lower cap means less buffer iteration per frame.
  private readonly MAX_PARTICLES = 200;

  // Confetti colors
  private confettiColors = [
    new THREE.Color(0xff6b6b),
    new THREE.Color(0xfeca57),
    new THREE.Color(0x48dbfb),
    new THREE.Color(0xff9ff3),
    new THREE.Color(0x54a0ff),
    new THREE.Color(0x5f27cd)
  ];

  // Celebration state
  private celebrationActive = false;

  constructor(scene: THREE.Scene, seed: number = 12345) {
    this.scene = scene;
    this.random = seededRandom(seed);

    this.effectsGroup = new THREE.Group();
    this.effectsGroup.name = 'effects';
    this.effectsGroup.scale.setScalar(WORLD_SCALE);
    this.scene.add(this.effectsGroup);

    // Initialize particle system
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleMaterial = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending
    });

    // Initialize buffers
    const positions = new Float32Array(this.MAX_PARTICLES * 3);
    const colors = new Float32Array(this.MAX_PARTICLES * 3);
    const sizes = new Float32Array(this.MAX_PARTICLES);

    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    this.particleSystem = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.effectsGroup.add(this.particleSystem);
  }

  /**
   * Update effects based on state
   */
  update(state: RenderState, deltaTime: number): void {
    const dt = deltaTime / 1000;

    // Spawn particles based on state
    this.spawnParticles(state, dt);

    // Update existing particles
    this.updateParticles(dt);

    // Update particle buffers
    this.updateParticleBuffers();

    // Handle celebration
    if (state.showGraduationCelebration && !this.celebrationActive) {
      this.startCelebration();
    } else if (!state.showGraduationCelebration) {
      this.celebrationActive = false;
    }
  }

  /**
   * Spawn particles based on state
   */
  private spawnParticles(state: RenderState, dt: number): void {
    // Celebration confetti — 12/sec (reduced from 30). Combined with EventSystem
    // fireworks, this is plenty of visual celebratory density without excess.
    if (state.showGraduationCelebration) {
      const spawnRate = 12 * dt;
      for (let i = 0; i < spawnRate; i++) {
        this.spawnConfetti();
      }
    }

    // Construction dust
    if (state.phase === 'construction' && state.activityLevel !== 'dead') {
      const dustRate = state.smoothVolume * 5 * dt;
      for (let i = 0; i < dustRate; i++) {
        if (this.random() < 0.5) {
          this.spawnDust();
        }
      }
    }

    // Decay embers
    if (state.smoothDecay > 0.5 && state.hasGraduated) {
      const emberRate = state.smoothDecay * 3 * dt;
      for (let i = 0; i < emberRate; i++) {
        if (this.random() < 0.3) {
          this.spawnEmber();
        }
      }
    }

    // Legendary sparks
    if (state.isLegendary && state.smoothDecay < 0.7) {
      const sparkRate = (1 - state.smoothDecay) * 2 * dt;
      for (let i = 0; i < sparkRate; i++) {
        if (this.random() < 0.2) {
          this.spawnSpark();
        }
      }
    }
  }

  /**
   * Spawn confetti particle
   */
  private spawnConfetti(): void {
    if (this.particles.length >= this.MAX_PARTICLES) return;

    const color = this.confettiColors[Math.floor(this.random() * this.confettiColors.length)];

    this.particles.push({
      position: new THREE.Vector3(
        (this.random() - 0.5) * 8,
        10 + this.random() * 5,
        (this.random() - 0.5) * 8
      ),
      velocity: new THREE.Vector3(
        (this.random() - 0.5) * 4,
        -3 - this.random() * 2,
        (this.random() - 0.5) * 4
      ),
      life: 3 + this.random() * 2,
      maxLife: 5,
      size: 0.15 + this.random() * 0.15,
      color: color.clone(),
      type: 'confetti'
    });
  }

  /**
   * Spawn dust particle
   */
  private spawnDust(): void {
    if (this.particles.length >= this.MAX_PARTICLES) return;

    const angle = this.random() * Math.PI * 2;
    const radius = 1 + this.random() * 3;

    this.particles.push({
      position: new THREE.Vector3(
        Math.cos(angle) * radius,
        0.5 + this.random() * 1,
        Math.sin(angle) * radius
      ),
      velocity: new THREE.Vector3(
        (this.random() - 0.5) * 0.5,
        0.5 + this.random() * 1,
        (this.random() - 0.5) * 0.5
      ),
      life: 1 + this.random(),
      maxLife: 2,
      size: 0.08 + this.random() * 0.08,
      color: new THREE.Color(0xb4a88c),
      type: 'dust'
    });
  }

  /**
   * Spawn ember particle
   */
  private spawnEmber(): void {
    if (this.particles.length >= this.MAX_PARTICLES) return;

    const angle = this.random() * Math.PI * 2;
    const radius = 2 + this.random() * 4;

    this.particles.push({
      position: new THREE.Vector3(
        Math.cos(angle) * radius,
        1 + this.random() * 3,
        Math.sin(angle) * radius
      ),
      velocity: new THREE.Vector3(
        (this.random() - 0.5) * 0.3,
        0.3 + this.random() * 0.5,
        (this.random() - 0.5) * 0.3
      ),
      life: 2 + this.random() * 2,
      maxLife: 4,
      size: 0.05 + this.random() * 0.05,
      color: new THREE.Color(this.random() > 0.5 ? 0xff4400 : 0xff8800),
      type: 'ember'
    });
  }

  /**
   * Spawn spark particle (legendary)
   */
  private spawnSpark(): void {
    if (this.particles.length >= this.MAX_PARTICLES) return;

    const angle = this.random() * Math.PI * 2;
    const radius = 2 + this.random() * 2;

    this.particles.push({
      position: new THREE.Vector3(
        Math.cos(angle) * radius,
        3 + this.random() * 8,
        Math.sin(angle) * radius
      ),
      velocity: new THREE.Vector3(
        (this.random() - 0.5) * 2,
        -1 + this.random() * 2,
        (this.random() - 0.5) * 2
      ),
      life: 1 + this.random(),
      maxLife: 2,
      size: 0.1 + this.random() * 0.1,
      color: new THREE.Color(0xffd700),
      type: 'spark'
    });
  }

  /**
   * Update all particles
   */
  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Update position
      p.position.add(p.velocity.clone().multiplyScalar(dt));

      // Apply gravity (except for embers which rise)
      if (p.type !== 'ember') {
        p.velocity.y -= 9.8 * dt * 0.3;
      }

      // Air resistance
      p.velocity.multiplyScalar(0.99);

      // Update life
      p.life -= dt;

      // Fade color based on life
      const lifeRatio = p.life / p.maxLife;
      if (lifeRatio < 0.3) {
        p.color.multiplyScalar(0.95);
      }

      // Remove dead particles
      if (p.life <= 0 || p.position.y < -1) {
        this.particles.splice(i, 1);
      }
    }
  }

  /**
   * Update particle buffer attributes
   */
  private updateParticleBuffers(): void {
    const positions = this.particleGeometry.attributes.position.array as Float32Array;
    const colors = this.particleGeometry.attributes.color.array as Float32Array;
    const sizes = this.particleGeometry.attributes.size.array as Float32Array;

    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      if (i < this.particles.length) {
        const p = this.particles[i];
        const lifeRatio = p.life / p.maxLife;

        positions[i * 3] = p.position.x;
        positions[i * 3 + 1] = p.position.y;
        positions[i * 3 + 2] = p.position.z;

        colors[i * 3] = p.color.r * lifeRatio;
        colors[i * 3 + 1] = p.color.g * lifeRatio;
        colors[i * 3 + 2] = p.color.b * lifeRatio;

        sizes[i] = p.size * lifeRatio;
      } else {
        // Hide unused particles
        positions[i * 3] = 0;
        positions[i * 3 + 1] = -100;
        positions[i * 3 + 2] = 0;
        sizes[i] = 0;
      }
    }

    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;
    this.particleGeometry.attributes.size.needsUpdate = true;
  }

  /**
   * Start celebration sequence
   */
  private startCelebration(): void {
    this.celebrationActive = true;

    // Initial burst — reduced from 50+30. EventSystem adds its own fireworks
    // on the same frame, so this only needs to seed the continuous stream.
    for (let i = 0; i < 20; i++) {
      this.spawnConfetti();
    }
    for (let i = 0; i < 10; i++) {
      this.spawnSpark();
    }
  }

  /**
   * Trigger burst effect at position (sparks and embers, no confetti)
   */
  burst(position: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.MAX_PARTICLES) break;

      const angle = (i / count) * Math.PI * 2;
      const speed = 2 + this.random() * 3;
      const isSpark = this.random() > 0.4;

      this.particles.push({
        position: position.clone(),
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          2 + this.random() * 3,
          Math.sin(angle) * speed
        ),
        life: 1 + this.random() * 2,
        maxLife: 3,
        size: 0.08 + this.random() * 0.08,
        color: new THREE.Color(isSpark ? 0xffd700 : (this.random() > 0.5 ? 0xff6600 : 0xff4400)),
        type: isSpark ? 'spark' : 'ember'
      });
    }
  }

  /**
   * Reset for new token
   */
  reset(seed: number): void {
    this.random = seededRandom(seed);
    this.particles = [];
    this.celebrationActive = false;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();
    this.scene.remove(this.effectsGroup);
  }
}
