/**
 * ParticleSystem.ts
 *
 * Manages particle effects:
 * - Confetti (graduation)
 * - Sparks (celebration)
 * - Dust (construction)
 * - Embers (decay/fire)
 * - Fog particles
 */

import type { Particle, RenderState } from '$lib/types';
import { seededRandom } from '$lib/state/CastleState';

export class ParticleSystem {
  private particles: Particle[] = [];
  private random: () => number;

  constructor(seed: number = 12345) {
    this.random = seededRandom(seed);
  }

  /**
   * Update all particles
   */
  update(state: RenderState, deltaTime: number): void {
    const dt = deltaTime / 1000;

    // Update existing particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Update position
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Apply gravity to non-fog particles
      if (p.type !== 'fog') {
        p.vy += 200 * dt; // Gravity
      }

      // Update life
      p.life -= dt;

      // Remove dead particles
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Spawn new particles based on state
    this.spawnParticles(state, deltaTime);
  }

  /**
   * Spawn particles based on current state
   */
  private spawnParticles(state: RenderState, deltaTime: number): void {
    // Graduation celebration confetti
    if (state.showGraduationCelebration) {
      const spawnRate = 20 * (deltaTime / 1000);
      for (let i = 0; i < spawnRate; i++) {
        this.spawnConfetti();
      }
      // Also spawn sparks
      if (this.random() < 0.3) {
        this.spawnSpark();
      }
    }

    // Construction dust
    if (state.phase === 'construction' && state.activityLevel !== 'dead') {
      const dustRate = (state.volumeRatio * 3) * (deltaTime / 1000);
      for (let i = 0; i < dustRate; i++) {
        this.spawnDust();
      }
    }

    // Decay embers
    if (state.decay > 0.5 && state.phase !== 'construction') {
      const emberRate = (state.decay * 2) * (deltaTime / 1000);
      for (let i = 0; i < emberRate; i++) {
        if (this.random() < 0.5) {
          this.spawnEmber();
        }
      }
    }

    // Light fog for very low population (activity-driven, not label-driven)
    const pop = (state as any).populationDensity ?? (state as any).smoothPopulation ?? 0.5;
    if (pop < 0.1 && this.particles.filter(p => p.type === 'fog').length < 15) {
      if (this.random() < 0.05) {
        this.spawnFog(false);
      }
    }
  }

  /**
   * Spawn a confetti particle
   */
  private spawnConfetti(): void {
    const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd'];
    const color = colors[Math.floor(this.random() * colors.length)];

    this.particles.push({
      x: 400 + (this.random() - 0.5) * 200,
      y: 100,
      vx: (this.random() - 0.5) * 200,
      vy: -100 - this.random() * 150,
      life: 3 + this.random() * 2,
      maxLife: 5,
      size: 4 + this.random() * 6,
      color,
      type: 'confetti'
    });
  }

  /**
   * Spawn a spark particle
   */
  private spawnSpark(): void {
    this.particles.push({
      x: 400 + (this.random() - 0.5) * 100,
      y: 200 + this.random() * 100,
      vx: (this.random() - 0.5) * 100,
      vy: -50 - this.random() * 100,
      life: 1 + this.random(),
      maxLife: 2,
      size: 2 + this.random() * 3,
      color: this.random() > 0.5 ? '#ffd700' : '#ff6b00',
      type: 'spark'
    });
  }

  /**
   * Spawn a dust particle
   */
  private spawnDust(): void {
    // Spawn near work zones
    const zones = [
      { x: 200, y: 400 },
      { x: 400, y: 350 },
      { x: 600, y: 400 }
    ];
    const zone = zones[Math.floor(this.random() * zones.length)];

    this.particles.push({
      x: zone.x + (this.random() - 0.5) * 60,
      y: zone.y + this.random() * 20,
      vx: (this.random() - 0.5) * 30,
      vy: -20 - this.random() * 30,
      life: 1 + this.random(),
      maxLife: 2,
      size: 2 + this.random() * 3,
      color: `rgba(180, 160, 140, ${0.3 + this.random() * 0.4})`,
      type: 'dust'
    });
  }

  /**
   * Spawn an ember particle
   */
  private spawnEmber(): void {
    this.particles.push({
      x: 200 + this.random() * 400,
      y: 350 + this.random() * 50,
      vx: (this.random() - 0.5) * 20,
      vy: -10 - this.random() * 20,
      life: 2 + this.random() * 2,
      maxLife: 4,
      size: 1 + this.random() * 2,
      color: this.random() > 0.7 ? '#ff4400' : '#ff8800',
      type: 'ember'
    });
  }

  /**
   * Spawn a fog particle
   */
  private spawnFog(cursed: boolean): void {
    const color = cursed
      ? `rgba(80, 60, 100, ${0.1 + this.random() * 0.15})`
      : `rgba(100, 150, 100, ${0.1 + this.random() * 0.15})`;

    this.particles.push({
      x: this.random() * 800,
      y: 350 + this.random() * 150,
      vx: 10 + this.random() * 20,
      vy: -2 + this.random() * 4,
      life: 8 + this.random() * 4,
      maxLife: 12,
      size: 60 + this.random() * 80,
      color,
      type: 'fog'
    });
  }

  /**
   * Get all particles for rendering
   */
  getParticles(): readonly Particle[] {
    return this.particles;
  }

  /**
   * Burst effect (for events)
   */
  burst(x: number, y: number, count: number, type: Particle['type']): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 50 + this.random() * 100;

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 50,
        life: 1 + this.random() * 2,
        maxLife: 3,
        size: 3 + this.random() * 4,
        color: type === 'confetti' ? '#ffd700' : '#ff6b00',
        type
      });
    }
  }

  /**
   * Clear all particles
   */
  clear(): void {
    this.particles = [];
  }

  /**
   * Reset with new seed
   */
  reset(seed: number): void {
    this.random = seededRandom(seed);
    this.particles = [];
  }
}
