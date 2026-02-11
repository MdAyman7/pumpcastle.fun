/**
 * BuilderSystem.ts
 *
 * Manages builder NPCs during the construction phase.
 * Builders work on scaffolding, carry materials, and bring the castle to life.
 */

import type { BuilderState, RenderState } from '$lib/types';
import { getBuilderCount, getBuilderSpeed } from '$lib/state/ActivityState';
import { seededRandom } from '$lib/state/CastleState';

export class BuilderSystem {
  private builders: BuilderState[] = [];
  private seed: number;
  private random: () => number;

  // Building zones where builders can work
  private readonly workZones = [
    { x: 200, y: 400, radius: 50 },
    { x: 400, y: 350, radius: 60 },
    { x: 600, y: 400, radius: 50 },
    { x: 300, y: 300, radius: 40 },
    { x: 500, y: 280, radius: 40 },
  ];

  constructor(seed: number = 12345) {
    this.seed = seed;
    this.random = seededRandom(seed);
  }

  /**
   * Update builders based on current state
   */
  update(state: RenderState, deltaTime: number): void {
    const isConstruction = state.phase === 'construction';
    const activity = {
      level: state.activityLevel,
      volumeRatio: state.volumeRatio,
      isZombie: false,
      hoursSinceLastTrade: state.hoursSinceLastTrade,
      populationDensity: state.populationDensity ?? 0
    };

    const targetCount = getBuilderCount(activity, isConstruction);
    const speedMultiplier = getBuilderSpeed(activity);

    // Add or remove builders to match target
    this.adjustBuilderCount(targetCount);

    // Update each builder
    for (const builder of this.builders) {
      this.updateBuilder(builder, deltaTime, speedMultiplier, state);
    }
  }

  /**
   * Adjust number of builders
   */
  private adjustBuilderCount(target: number): void {
    // Add builders if needed
    while (this.builders.length < target) {
      const id = this.builders.length;
      const zone = this.workZones[id % this.workZones.length];
      const angle = this.random() * Math.PI * 2;
      const dist = this.random() * zone.radius;

      this.builders.push({
        id,
        x: zone.x + Math.cos(angle) * dist,
        y: zone.y + Math.sin(angle) * dist,
        targetX: zone.x,
        targetY: zone.y,
        state: 'walking',
        animationPhase: this.random() * Math.PI * 2,
        scale: 0.8 + this.random() * 0.4
      });
    }

    // Mark excess builders as leaving
    for (let i = target; i < this.builders.length; i++) {
      if (this.builders[i].state !== 'leaving') {
        this.builders[i].state = 'leaving';
        this.builders[i].targetX = -50; // Exit left
        this.builders[i].targetY = this.builders[i].y + 100;
      }
    }

    // Remove builders that have left
    this.builders = this.builders.filter(b =>
      b.state !== 'leaving' || b.x > -40
    );
  }

  /**
   * Update individual builder
   */
  private updateBuilder(
    builder: BuilderState,
    deltaTime: number,
    speedMultiplier: number,
    state: RenderState
  ): void {
    const speed = 30 * speedMultiplier * (deltaTime / 1000);

    // Update animation phase
    builder.animationPhase += deltaTime * 0.005 * speedMultiplier;

    switch (builder.state) {
      case 'walking':
        this.moveTowardsTarget(builder, speed);
        if (this.atTarget(builder)) {
          builder.state = 'working';
        }
        break;

      case 'working':
        // Periodically pick new target
        if (this.random() < 0.01) {
          const zone = this.workZones[builder.id % this.workZones.length];
          const angle = this.random() * Math.PI * 2;
          const dist = this.random() * zone.radius;
          builder.targetX = zone.x + Math.cos(angle) * dist;
          builder.targetY = zone.y + Math.sin(angle) * dist;
          builder.state = 'walking';
        }
        break;

      case 'idle':
        // Low activity - builders stand around
        if (this.random() < 0.005 * speedMultiplier) {
          builder.state = 'walking';
          const zone = this.workZones[builder.id % this.workZones.length];
          builder.targetX = zone.x + (this.random() - 0.5) * 40;
          builder.targetY = zone.y + (this.random() - 0.5) * 40;
        }
        break;

      case 'leaving':
        this.moveTowardsTarget(builder, speed * 1.5);
        break;
    }
  }

  /**
   * Move builder towards target
   */
  private moveTowardsTarget(builder: BuilderState, speed: number): void {
    const dx = builder.targetX - builder.x;
    const dy = builder.targetY - builder.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 1) {
      builder.x += (dx / dist) * speed;
      builder.y += (dy / dist) * speed;
    }
  }

  /**
   * Check if builder is at target
   */
  private atTarget(builder: BuilderState): boolean {
    const dx = builder.targetX - builder.x;
    const dy = builder.targetY - builder.y;
    return Math.sqrt(dx * dx + dy * dy) < 5;
  }

  /**
   * Get all builders for rendering
   */
  getBuilders(): readonly BuilderState[] {
    return this.builders;
  }

  /**
   * Reset system for new token
   */
  reset(seed: number): void {
    this.seed = seed;
    this.random = seededRandom(seed);
    this.builders = [];
  }
}
