/**
 * WeatherState.ts
 *
 * Converts price-driven weather (PriceWeather) into a smoothly-interpolated
 * WeatherRenderState consumed by all rendering systems.
 *
 * Replaces the former geolocation-based real-weather system.
 * Weather is now 100% derived from token price momentum and volatility,
 * meaning the castle's atmosphere directly reflects market conditions.
 */

import type { PriceWeather } from '$lib/types';

export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'fog';

// Smooth interpolated values for renderer consumption
export interface WeatherRenderState {
  // 0-1 factors for blending
  rainIntensity: number;
  snowIntensity: number;
  cloudiness: number;
  windFactor: number;         // 0 = calm, 1 = gale
  heatFactor: number;         // 0 = normal, 1 = extreme heat
  coldFactor: number;         // 0 = normal, 1 = extreme cold
  stormFactor: number;
  fogFactor: number;
  temperature: number;
  condition: WeatherCondition;
}

export class WeatherState {
  private renderState: WeatherRenderState;

  // Smooth targets (lerped toward each frame)
  private targetRain: number = 0;
  private targetSnow: number = 0;
  private targetCloud: number = 0.15;
  private targetWind: number = 0.1;
  private targetHeat: number = 0;
  private targetCold: number = 0;
  private targetStorm: number = 0;
  private targetFog: number = 0;
  private targetTemp: number = 20;
  private targetCondition: WeatherCondition = 'clear';

  constructor() {
    this.renderState = {
      rainIntensity: 0,
      snowIntensity: 0,
      cloudiness: 0.15,
      windFactor: 0.1,
      heatFactor: 0,
      coldFactor: 0,
      stormFactor: 0,
      fogFactor: 0,
      temperature: 20,
      condition: 'clear',
    };
  }

  /**
   * Feed new price weather data.
   * Call this whenever token data updates (typically every few seconds).
   * Targets are set immediately; the smooth lerp in update() catches up.
   */
  setPriceWeather(pw: PriceWeather): void {
    // ── Precipitation → rain / fog / storm factors ──
    this.targetRain = pw.precipitationType === 'rain' ? 0.65 :
      pw.precipitationType === 'storm' ? 0.85 : 0;

    this.targetStorm = pw.precipitationType === 'storm' ? 0.8 + pw.volatility * 0.2 : 0;

    this.targetFog = pw.precipitationType === 'fog' ? 0.5 + (1 - pw.lightColorTemperature) * 0.2 : 0;

    // Snow: not price-driven, always 0 (no real-world temperature to justify it)
    this.targetSnow = 0;

    // ── Cloud cover ──
    this.targetCloud = pw.cloudDensity;

    // ── Wind ──
    this.targetWind = pw.windStrength;

    // ── Light temperature → pseudo heat/cold factors ──
    // Warm light (bullish) → slight heat warmth; cool light (bearish) → cold tint.
    // These are subtle — they tint the scene, not simulate real weather extremes.
    this.targetHeat = pw.lightColorTemperature > 0.65
      ? (pw.lightColorTemperature - 0.65) / 0.35 * 0.4   // max 0.4
      : 0;

    this.targetCold = pw.lightColorTemperature < 0.35
      ? (0.35 - pw.lightColorTemperature) / 0.35 * 0.4   // max 0.4
      : 0;

    // ── Pseudo-temperature (for any downstream that reads it) ──
    // Maps lightColorTemperature 0–1 to 5°C–30°C range.
    this.targetTemp = 5 + pw.lightColorTemperature * 25;

    // ── Condition enum (for UI / audio systems) ──
    if (pw.precipitationType === 'storm') {
      this.targetCondition = 'storm';
    } else if (pw.precipitationType === 'rain') {
      this.targetCondition = 'rain';
    } else if (pw.precipitationType === 'fog') {
      this.targetCondition = 'fog';
    } else if (pw.cloudDensity > 0.4) {
      this.targetCondition = 'cloudy';
    } else {
      this.targetCondition = 'clear';
    }
  }

  /** Call every frame to smoothly interpolate render state */
  update(deltaTime: number): void {
    const dt = deltaTime / 1000;
    const speed = 0.5;  // transition speed (lower = slower)
    const lerp = 1 - Math.pow(0.1, dt * speed);

    this.renderState.rainIntensity += (this.targetRain - this.renderState.rainIntensity) * lerp;
    this.renderState.snowIntensity += (this.targetSnow - this.renderState.snowIntensity) * lerp;
    this.renderState.cloudiness += (this.targetCloud - this.renderState.cloudiness) * lerp;
    this.renderState.windFactor += (this.targetWind - this.renderState.windFactor) * lerp;
    this.renderState.heatFactor += (this.targetHeat - this.renderState.heatFactor) * lerp;
    this.renderState.coldFactor += (this.targetCold - this.renderState.coldFactor) * lerp;
    this.renderState.stormFactor += (this.targetStorm - this.renderState.stormFactor) * lerp;
    this.renderState.fogFactor += (this.targetFog - this.renderState.fogFactor) * lerp;
    this.renderState.temperature += (this.targetTemp - this.renderState.temperature) * lerp;
    this.renderState.condition = this.targetCondition;
  }

  getRenderState(): WeatherRenderState {
    return this.renderState;
  }
}
