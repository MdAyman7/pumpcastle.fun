/**
 * WeatherState.ts
 *
 * Fetches real weather based on user geolocation and exposes
 * a smoothly-interpolated weather state for the renderer.
 *
 * - Uses browser Geolocation API → Open-Meteo (no key required)
 * - Falls back to mild clear weather if geolocation denied
 * - Caches result for 30 minutes
 * - Smooth transitions between weather states
 */

export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'fog';

export interface WeatherData {
  temperature: number;       // Celsius
  condition: WeatherCondition;
  windSpeed: number;         // m/s
  humidity: number;          // 0-100
  cloudCover: number;        // 0-100
  isExtremeHeat: boolean;    // ≥ 35°C
  isExtremeCold: boolean;    // ≤ -5°C
}

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

const DEFAULT_WEATHER: WeatherData = {
  temperature: 20,
  condition: 'clear',
  windSpeed: 3,
  humidity: 50,
  cloudCover: 30,
  isExtremeHeat: false,
  isExtremeCold: false
};

const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export class WeatherState {
  private current: WeatherData = { ...DEFAULT_WEATHER };
  private renderState: WeatherRenderState;

  // Smooth targets
  private targetRain: number = 0;
  private targetSnow: number = 0;
  private targetCloud: number = 0.3;
  private targetWind: number = 0.1;
  private targetHeat: number = 0;
  private targetCold: number = 0;
  private targetStorm: number = 0;
  private targetFog: number = 0;

  // Cache
  private lastFetchTime: number = 0;
  private fetching: boolean = false;
  private latitude: number | null = null;
  private longitude: number | null = null;
  private geoAttempted: boolean = false;

  constructor() {
    this.renderState = {
      rainIntensity: 0,
      snowIntensity: 0,
      cloudiness: 0.3,
      windFactor: 0.1,
      heatFactor: 0,
      coldFactor: 0,
      stormFactor: 0,
      fogFactor: 0,
      temperature: 20,
      condition: 'clear'
    };

    // Start fetching weather on creation
    this.initGeolocation();
  }

  private async initGeolocation(): Promise<void> {
    if (this.geoAttempted) return;
    this.geoAttempted = true;

    if (!('geolocation' in navigator)) {
      this.fetchWeatherFallback();
      return;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 8000,
          maximumAge: CACHE_DURATION_MS,
          enableHighAccuracy: false
        });
      });

      this.latitude = position.coords.latitude;
      this.longitude = position.coords.longitude;
      await this.fetchWeather();
    } catch {
      // Geolocation denied or timed out → use default
      this.fetchWeatherFallback();
    }
  }

  private fetchWeatherFallback(): void {
    // Generate pleasant default weather based on time of day
    const hour = new Date().getHours();
    const isNight = hour < 6 || hour > 20;

    this.current = {
      temperature: isNight ? 14 : 22,
      condition: 'clear',
      windSpeed: 2 + Math.random() * 3,
      humidity: 45 + Math.random() * 20,
      cloudCover: 15 + Math.random() * 25,
      isExtremeHeat: false,
      isExtremeCold: false
    };

    this.computeTargets();
  }

  private async fetchWeather(): Promise<void> {
    if (this.fetching) return;
    if (this.latitude === null || this.longitude === null) return;

    const now = Date.now();
    if (now - this.lastFetchTime < CACHE_DURATION_MS) return;

    this.fetching = true;

    try {
      // Open-Meteo is free, no API key needed
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.latitude}&longitude=${this.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,cloud_cover&timezone=auto`;

      const response = await fetch(url);
      if (!response.ok) throw new Error('Weather fetch failed');

      const data = await response.json();
      const c = data.current;

      this.current = {
        temperature: c.temperature_2m ?? 20,
        condition: this.wmoToCondition(c.weather_code ?? 0),
        windSpeed: (c.wind_speed_10m ?? 10) / 3.6, // km/h → m/s
        humidity: c.relative_humidity_2m ?? 50,
        cloudCover: c.cloud_cover ?? 30,
        isExtremeHeat: (c.temperature_2m ?? 20) >= 35,
        isExtremeCold: (c.temperature_2m ?? 20) <= -5
      };

      this.lastFetchTime = now;
      this.computeTargets();
    } catch {
      // Silently fall back
      this.fetchWeatherFallback();
    } finally {
      this.fetching = false;
    }
  }

  /** Map WMO weather codes to our condition enum */
  private wmoToCondition(code: number): WeatherCondition {
    // WMO codes: https://open-meteo.com/en/docs#weathervariables
    if (code === 0 || code === 1) return 'clear';
    if (code === 2 || code === 3) return 'cloudy';
    if (code >= 45 && code <= 48) return 'fog';
    if (code >= 51 && code <= 67) return 'rain';
    if (code >= 71 && code <= 77) return 'snow';
    if (code >= 80 && code <= 82) return 'rain';
    if (code >= 85 && code <= 86) return 'snow';
    if (code >= 95 && code <= 99) return 'storm';
    return 'clear';
  }

  /** Compute smooth target values from raw weather data */
  private computeTargets(): void {
    const w = this.current;

    // Rain intensity
    this.targetRain = w.condition === 'rain' ? 0.7 :
      w.condition === 'storm' ? 1.0 : 0;

    // Snow intensity
    this.targetSnow = w.condition === 'snow' ? 0.8 : 0;
    if (w.isExtremeCold && w.condition !== 'snow') {
      this.targetSnow = 0.3; // light snow in extreme cold even if not "snowing"
    }

    // Cloud cover
    this.targetCloud = w.cloudCover / 100;

    // Wind (normalize: 0-20 m/s → 0-1)
    this.targetWind = Math.min(1, w.windSpeed / 20);

    // Heat factor
    if (w.temperature >= 35) {
      this.targetHeat = 1.0;
    } else if (w.temperature >= 30) {
      this.targetHeat = (w.temperature - 30) / 5;
    } else {
      this.targetHeat = 0;
    }

    // Cold factor
    if (w.temperature <= -5) {
      this.targetCold = 1.0;
    } else if (w.temperature <= 5) {
      this.targetCold = (5 - w.temperature) / 10;
    } else {
      this.targetCold = 0;
    }

    // Storm
    this.targetStorm = w.condition === 'storm' ? 1.0 : 0;

    // Fog
    this.targetFog = w.condition === 'fog' ? 0.8 : 0;
  }

  /** Call every frame to smoothly interpolate render state */
  update(deltaTime: number): void {
    const dt = deltaTime / 1000;
    const speed = 0.5; // transition speed (lower = slower)
    const lerp = 1 - Math.pow(0.1, dt * speed);

    this.renderState.rainIntensity += (this.targetRain - this.renderState.rainIntensity) * lerp;
    this.renderState.snowIntensity += (this.targetSnow - this.renderState.snowIntensity) * lerp;
    this.renderState.cloudiness += (this.targetCloud - this.renderState.cloudiness) * lerp;
    this.renderState.windFactor += (this.targetWind - this.renderState.windFactor) * lerp;
    this.renderState.heatFactor += (this.targetHeat - this.renderState.heatFactor) * lerp;
    this.renderState.coldFactor += (this.targetCold - this.renderState.coldFactor) * lerp;
    this.renderState.stormFactor += (this.targetStorm - this.renderState.stormFactor) * lerp;
    this.renderState.fogFactor += (this.targetFog - this.renderState.fogFactor) * lerp;
    this.renderState.temperature += (this.current.temperature - this.renderState.temperature) * lerp;
    this.renderState.condition = this.current.condition;

    // Periodically re-fetch weather
    const now = Date.now();
    if (now - this.lastFetchTime >= CACHE_DURATION_MS && this.latitude !== null) {
      this.fetchWeather();
    }
  }

  getRenderState(): WeatherRenderState {
    return this.renderState;
  }

  getRawData(): WeatherData {
    return this.current;
  }
}
