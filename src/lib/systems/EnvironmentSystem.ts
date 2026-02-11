/**
 * EnvironmentSystem.ts
 *
 * Manages environmental effects:
 * - Fog
 * - Sky/atmosphere
 * - Ambient light
 * - Wind effects
 */

import type { EnvironmentState, RenderState } from '$lib/types';
import { getActivityEnvironment } from '$lib/state/ActivityState';

export class EnvironmentSystem {
  private currentState: EnvironmentState;
  private targetState: EnvironmentState;

  constructor() {
    this.currentState = this.getDefaultState();
    this.targetState = this.getDefaultState();
  }

  /**
   * Get default environment state
   */
  private getDefaultState(): EnvironmentState {
    return {
      fogDensity: 0,
      fogColor: 'rgba(180, 180, 200, 0.5)',
      skyColor: '#87CEEB',
      ambientLight: 1.0,
      windStrength: 0.2,
      timeOfDay: 0.5
    };
  }

  /**
   * Update environment based on world state
   */
  update(state: RenderState, deltaTime: number): void {
    // Calculate target state based on world state
    this.targetState = this.calculateTargetState(state);

    // Smoothly interpolate current state towards target
    const lerpSpeed = 2 * (deltaTime / 1000);
    this.currentState = this.lerpState(this.currentState, this.targetState, lerpSpeed);
  }

  /**
   * Calculate target environment state from world state
   */
  private calculateTargetState(state: RenderState): EnvironmentState {
    const pop = state.populationDensity ?? state.smoothPopulation ?? 0;
    const activity = {
      level: state.activityLevel,
      volumeRatio: state.volumeRatio,
      isZombie: false,
      hoursSinceLastTrade: state.hoursSinceLastTrade,
      populationDensity: pop
    };

    const activityEnv = getActivityEnvironment(activity);

    // Base fog from activity
    let fogDensity = activityEnv.fogDensity;
    let fogColor = 'rgba(180, 180, 200, 0.5)';

    // Low population = slightly hazier (activity-driven, not label-driven)
    if (pop < 0.15) {
      fogDensity = Math.max(fogDensity, 0.4);
      fogColor = 'rgba(160, 170, 180, 0.5)';
    }

    // Sky color based on state
    let skyColor: string;
    if (state.phase === 'thriving') {
      skyColor = '#5a9fd4'; // Bright blue
    } else {
      skyColor = '#87CEEB'; // Default sky blue
    }

    // Ambient light based on decay and activity
    let ambientLight = 1.0 - state.decay * 0.4;
    if (state.priceChange24h < -20) {
      ambientLight *= 0.8; // Darken during dumps
    }

    // Wind strength
    let windStrength = activityEnv.windStrength;
    if (state.priceChange24h < -30) {
      windStrength = 0.8; // Strong wind during severe dumps
    }

    // Time of day (simulated, can be based on real time or state)
    const timeOfDay = 0.5; // Noon for now

    return {
      fogDensity,
      fogColor,
      skyColor,
      ambientLight,
      windStrength,
      timeOfDay
    };
  }

  /**
   * Linearly interpolate between two states
   */
  private lerpState(
    current: EnvironmentState,
    target: EnvironmentState,
    t: number
  ): EnvironmentState {
    t = Math.min(1, Math.max(0, t));

    return {
      fogDensity: current.fogDensity + (target.fogDensity - current.fogDensity) * t,
      fogColor: target.fogColor, // Color snaps (could lerp RGB)
      skyColor: this.lerpColor(current.skyColor, target.skyColor, t),
      ambientLight: current.ambientLight + (target.ambientLight - current.ambientLight) * t,
      windStrength: current.windStrength + (target.windStrength - current.windStrength) * t,
      timeOfDay: current.timeOfDay + (target.timeOfDay - current.timeOfDay) * t
    };
  }

  /**
   * Lerp between two hex colors
   */
  private lerpColor(color1: string, color2: string, t: number): string {
    const c1 = this.hexToRgb(color1);
    const c2 = this.hexToRgb(color2);

    if (!c1 || !c2) return color2;

    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);

    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Convert hex to RGB
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  /**
   * Get current environment state
   */
  getState(): EnvironmentState {
    return this.currentState;
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.currentState = this.getDefaultState();
    this.targetState = this.getDefaultState();
  }
}
