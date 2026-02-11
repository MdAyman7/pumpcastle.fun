/**
 * WeatherEffects.ts
 *
 * Visual particle systems for weather:
 * - Rain streaks (batched LineSegments — 1 draw call)
 * - Rain splash (batched Points — 1 draw call)
 * - Snow flakes (batched Points — 1 draw call)
 * - Heat haze (batched Points — 1 draw call)
 * - Storm spray mist (batched Points — 1 draw call)
 * - Flood water plane (1 mesh)
 * - Storm lightning flashes
 * - Fog thickening
 *
 * OPTIMIZED: All particles use THREE.Points/LineSegments with BufferGeometry.
 * Rain/snow/haze/splash/spray share batched meshes instead of
 * hundreds of individual Mesh objects.
 */

import * as THREE from 'three';
import type { WeatherRenderState } from '$lib/state/WeatherState';
import { qualitySettings } from './QualitySettings';
import { WEATHER } from '$lib/state/CastleConstants';

interface RainParticle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
}

interface SplashParticle {
  x: number; y: number; z: number;
  vy: number;
  life: number;
  size: number;
}

interface SnowParticle {
  x: number; y: number; z: number;
  vy: number;
  drift: number;
  phase: number;
  life: number;
  scale: number;
}

interface HazeParticle {
  x: number; y: number; z: number;
  rotationY: number;
  life: number;
}

interface SprayParticle {
  x: number; y: number; z: number;
  vx: number; vz: number;
  life: number;
}

export class WeatherEffects {
  private scene: THREE.Scene;
  private group: THREE.Group;

  // Rain — LineSegments (streaked rain)
  private rainParticles: RainParticle[] = [];
  private rainLines: THREE.LineSegments;
  private rainPositions: Float32Array;
  private rainGeometry: THREE.BufferGeometry;
  private rainMaterial: THREE.LineBasicMaterial;

  // Splash — Points (ground impact bursts)
  private splashParticles: SplashParticle[] = [];
  private splashPoints: THREE.Points;
  private splashPositions: Float32Array;
  private splashSizes: Float32Array;
  private splashGeometry: THREE.BufferGeometry;

  // Snow — single Points mesh
  private snowParticles: SnowParticle[] = [];
  private snowPoints: THREE.Points;
  private snowPositions: Float32Array;
  private snowSizes: Float32Array;
  private snowGeometry: THREE.BufferGeometry;

  // Heat haze — single Points mesh
  private hazeParticles: HazeParticle[] = [];
  private hazePoints: THREE.Points;
  private hazePositions: Float32Array;
  private hazeGeometry: THREE.BufferGeometry;

  // Spray mist — Points (ground-level storm mist)
  private sprayParticles: SprayParticle[] = [];
  private sprayPoints: THREE.Points;
  private sprayPositions: Float32Array;
  private sprayGeometry: THREE.BufferGeometry;

  // Flood water plane
  private floodMesh: THREE.Mesh;
  private floodMaterial: THREE.MeshStandardMaterial;
  private floodOpacity: number = 0;

  // Lightning
  private lightningLight: THREE.PointLight;
  private lightningTimer: number = 0;
  private lightningActive: boolean = false;
  private lightningDuration: number = 0;
  private lightningIsDoubleFlash: boolean = false;
  private lightningPhase: number = 0; // 0 = first flash, 1 = gap, 2 = second flash

  // Ground snow cover
  private snowGroundMesh: THREE.Mesh | null = null;
  private snowGroundMaterial: THREE.MeshStandardMaterial;
  private snowCoverOpacity: number = 0;

  // Frost overlay (icicle meshes on structures)
  private frostGroup: THREE.Group;
  private frostBuilt: boolean = false;

  // Internal time
  private time: number = 0;

  // Quality caps
  private maxRain: number;
  private maxSnow: number;
  private maxHaze: number;
  private maxSplash: number;
  private maxSpray: number;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'weatherEffects';
    this.scene.add(this.group);

    const qc = qualitySettings.getConfig();
    this.maxRain = qc.maxRain;
    this.maxSnow = qc.maxSnow;
    this.maxHaze = qc.maxHaze;
    this.maxSplash = qc.maxSplash;
    this.maxSpray = qc.maxSpray;

    // ─── Rain LineSegments (streaks) ─────────────────────────
    // Each particle = 2 vertices (start + end of streak) = 6 floats
    this.rainPositions = new Float32Array(this.maxRain * 6);
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position',
      new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    this.rainGeometry.setDrawRange(0, 0);

    this.rainMaterial = new THREE.LineBasicMaterial({
      color: 0x8899bb,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.rainLines = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rainLines.frustumCulled = false;
    this.group.add(this.rainLines);

    // ─── Splash Points ───────────────────────────────────────
    this.splashPositions = new Float32Array(this.maxSplash * 3);
    this.splashSizes = new Float32Array(this.maxSplash);
    this.splashGeometry = new THREE.BufferGeometry();
    this.splashGeometry.setAttribute('position',
      new THREE.BufferAttribute(this.splashPositions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    this.splashGeometry.setAttribute('size',
      new THREE.BufferAttribute(this.splashSizes, 1).setUsage(THREE.DynamicDrawUsage)
    );
    this.splashGeometry.setDrawRange(0, 0);

    const splashMaterial = new THREE.PointsMaterial({
      color: 0xccddee,
      transparent: true,
      opacity: 0.5,
      size: 1.0,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.splashPoints = new THREE.Points(this.splashGeometry, splashMaterial);
    this.splashPoints.frustumCulled = false;
    this.group.add(this.splashPoints);

    // ─── Snow Points ──────────────────────────────────────
    this.snowPositions = new Float32Array(this.maxSnow * 3);
    this.snowSizes = new Float32Array(this.maxSnow);
    this.snowGeometry = new THREE.BufferGeometry();
    this.snowGeometry.setAttribute('position',
      new THREE.BufferAttribute(this.snowPositions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    this.snowGeometry.setAttribute('size',
      new THREE.BufferAttribute(this.snowSizes, 1).setUsage(THREE.DynamicDrawUsage)
    );
    this.snowGeometry.setDrawRange(0, 0);

    const snowMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      size: 2.0,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.snowPoints = new THREE.Points(this.snowGeometry, snowMaterial);
    this.snowPoints.frustumCulled = false;
    this.group.add(this.snowPoints);

    // ─── Heat Haze Points ─────────────────────────────────
    this.hazePositions = new Float32Array(this.maxHaze * 3);
    this.hazeGeometry = new THREE.BufferGeometry();
    this.hazeGeometry.setAttribute('position',
      new THREE.BufferAttribute(this.hazePositions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    this.hazeGeometry.setDrawRange(0, 0);

    const hazeMaterial = new THREE.PointsMaterial({
      color: 0xffeecc,
      transparent: true,
      opacity: 0.06,
      size: 8.0,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.hazePoints = new THREE.Points(this.hazeGeometry, hazeMaterial);
    this.hazePoints.frustumCulled = false;
    this.group.add(this.hazePoints);

    // ─── Spray Mist Points ────────────────────────────────
    this.sprayPositions = new Float32Array(this.maxSpray * 3);
    this.sprayGeometry = new THREE.BufferGeometry();
    this.sprayGeometry.setAttribute('position',
      new THREE.BufferAttribute(this.sprayPositions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    this.sprayGeometry.setDrawRange(0, 0);

    const sprayMaterial = new THREE.PointsMaterial({
      color: 0x8899aa,
      transparent: true,
      opacity: 0.12,
      size: 5.0,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.sprayPoints = new THREE.Points(this.sprayGeometry, sprayMaterial);
    this.sprayPoints.frustumCulled = false;
    this.group.add(this.sprayPoints);

    // ─── Flood Water Plane ────────────────────────────────
    this.floodMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a4a6a,
      roughness: 0.15,
      metalness: 0.3,
      transparent: true,
      opacity: 0,
    });
    const floodGeom = new THREE.PlaneGeometry(100, 100);
    this.floodMesh = new THREE.Mesh(floodGeom, this.floodMaterial);
    this.floodMesh.rotation.x = -Math.PI / 2;
    this.floodMesh.position.y = 0.04;
    this.floodMesh.receiveShadow = true;
    this.floodMesh.visible = false;
    this.group.add(this.floodMesh);

    // Lightning point light (starts off)
    this.lightningLight = new THREE.PointLight(0xeeeeff, 0, 80);
    this.lightningLight.position.set(0, 30, 0);
    this.group.add(this.lightningLight);

    // Snow ground cover
    this.snowGroundMaterial = new THREE.MeshStandardMaterial({
      color: 0xeef4ff,
      roughness: 0.7,
      metalness: 0.0,
      transparent: true,
      opacity: 0
    });
    const snowGroundGeom = new THREE.PlaneGeometry(100, 100);
    this.snowGroundMesh = new THREE.Mesh(snowGroundGeom, this.snowGroundMaterial);
    this.snowGroundMesh.rotation.x = -Math.PI / 2;
    this.snowGroundMesh.position.y = 0.03;
    this.snowGroundMesh.receiveShadow = true;
    this.snowGroundMesh.visible = false;
    this.group.add(this.snowGroundMesh);

    // Frost group
    this.frostGroup = new THREE.Group();
    this.frostGroup.name = 'frost';
    this.frostGroup.visible = false;
    this.group.add(this.frostGroup);
  }

  update(weather: WeatherRenderState, deltaTime: number): void {
    const dt = deltaTime / 1000;
    this.time += dt;

    this.updateRain(weather, dt);
    this.updateSplash(weather, dt);
    this.updateSnow(weather, dt);
    this.updateHeatHaze(weather, dt);
    this.updateSpray(weather, dt);
    this.updateFlood(weather, dt);
    this.updateLightning(weather, dt);
    this.updateSnowGround(weather, dt);
    this.updateFrost(weather);
  }

  // ─── Rain (LineSegments streaks) ─────────────────────────────

  private updateRain(weather: WeatherRenderState, dt: number): void {
    const intensity = weather.rainIntensity;
    const storm = weather.stormFactor;
    const targetCount = Math.floor(intensity * this.maxRain);

    // Wind-driven horizontal velocity
    const windVx = weather.windFactor * (6 + storm * 8);

    // Spawn new rain particles
    const spread = 50 + storm * 20;
    while (this.rainParticles.length < targetCount) {
      const vy = -14 - Math.random() * 8 - storm * 12;
      this.rainParticles.push({
        x: (Math.random() - 0.5) * spread,
        y: 15 + Math.random() * 10,
        z: (Math.random() - 0.5) * spread,
        vx: windVx + (Math.random() - 0.5) * 2,
        vy,
        vz: (Math.random() - 0.5) * 2,
        life: 3,
      });
    }

    // Update existing
    for (let i = this.rainParticles.length - 1; i >= 0; i--) {
      const p = this.rainParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.life -= dt;

      if (p.y < 0.1 || p.life <= 0) {
        // Spawn splash on ground impact
        if (p.y < 0.1 && this.splashParticles.length < this.maxSplash) {
          this.splashParticles.push({
            x: p.x,
            y: 0.1,
            z: p.z,
            vy: 1.5 + Math.random() * 2,
            life: 0.15 + Math.random() * 0.15,
            size: 0.5 + Math.random() * 1.0,
          });
        }
        // Swap-remove for performance
        this.rainParticles[i] = this.rainParticles[this.rainParticles.length - 1];
        this.rainParticles.pop();
      }
    }

    // Remove excess
    while (this.rainParticles.length > targetCount + 10) {
      this.rainParticles.pop();
    }

    // Storm material darkening
    const baseColor = new THREE.Color(0x8899bb);
    const stormColor = new THREE.Color(0x556688);
    baseColor.lerp(stormColor, storm);
    this.rainMaterial.color.copy(baseColor);
    this.rainMaterial.opacity = 0.4 + storm * 0.2;

    // Write positions to buffer (2 vertices per particle for LineSegments)
    const streakLen = 0.06 + storm * 0.04;
    const count = this.rainParticles.length;
    for (let i = 0; i < count; i++) {
      const p = this.rainParticles[i];
      const idx = i * 6;
      // Start vertex
      this.rainPositions[idx]     = p.x;
      this.rainPositions[idx + 1] = p.y;
      this.rainPositions[idx + 2] = p.z;
      // End vertex (streak along velocity direction)
      this.rainPositions[idx + 3] = p.x + p.vx * streakLen;
      this.rainPositions[idx + 4] = p.y + p.vy * streakLen;
      this.rainPositions[idx + 5] = p.z + p.vz * streakLen;
    }
    this.rainGeometry.attributes.position.needsUpdate = true;
    this.rainGeometry.setDrawRange(0, count * 2); // 2 vertices per line segment
    this.rainLines.visible = count > 0;
  }

  // ─── Splash (ground impact) ─────────────────────────────────

  private updateSplash(_weather: WeatherRenderState, dt: number): void {
    // Update existing splashes
    for (let i = this.splashParticles.length - 1; i >= 0; i--) {
      const p = this.splashParticles[i];
      p.y += p.vy * dt;
      p.vy -= 12 * dt; // gravity deceleration
      p.life -= dt;

      if (p.life <= 0) {
        this.splashParticles[i] = this.splashParticles[this.splashParticles.length - 1];
        this.splashParticles.pop();
      }
    }

    // Write positions + sizes to buffer
    const count = this.splashParticles.length;
    for (let i = 0; i < count; i++) {
      const p = this.splashParticles[i];
      this.splashPositions[i * 3]     = p.x;
      this.splashPositions[i * 3 + 1] = p.y;
      this.splashPositions[i * 3 + 2] = p.z;
      // Size fades with remaining life
      this.splashSizes[i] = p.size * Math.max(0, p.life / 0.3);
    }
    this.splashGeometry.attributes.position.needsUpdate = true;
    this.splashGeometry.attributes.size.needsUpdate = true;
    this.splashGeometry.setDrawRange(0, count);
    this.splashPoints.visible = count > 0;
  }

  // ─── Snow ─────────────────────────────────────────────────

  private updateSnow(weather: WeatherRenderState, dt: number): void {
    const intensity = weather.snowIntensity;
    const targetCount = Math.floor(intensity * this.maxSnow);

    // Spawn
    while (this.snowParticles.length < targetCount) {
      const spread = 40;
      this.snowParticles.push({
        x: (Math.random() - 0.5) * spread,
        y: 12 + Math.random() * 8,
        z: (Math.random() - 0.5) * spread,
        vy: -1.2 - Math.random() * 0.8,
        drift: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        life: 12,
        scale: 0.5 + Math.random() * 1,
      });
    }

    // Update
    for (let i = this.snowParticles.length - 1; i >= 0; i--) {
      const p = this.snowParticles[i];
      p.phase += dt * 2;

      // Gentle sway
      const sway = Math.sin(p.phase + p.drift) * 0.5;
      p.x += (sway + weather.windFactor * 1.5) * dt;
      p.y += p.vy * dt;
      p.z += Math.cos(p.phase * 0.7) * 0.2 * dt;

      p.life -= dt;
      if (p.y < -0.2 || p.life <= 0) {
        this.snowParticles[i] = this.snowParticles[this.snowParticles.length - 1];
        this.snowParticles.pop();
      }
    }

    // Remove excess
    while (this.snowParticles.length > targetCount + 10) {
      this.snowParticles.pop();
    }

    // Write positions + sizes to buffer
    const count = this.snowParticles.length;
    for (let i = 0; i < count; i++) {
      const p = this.snowParticles[i];
      this.snowPositions[i * 3] = p.x;
      this.snowPositions[i * 3 + 1] = p.y;
      this.snowPositions[i * 3 + 2] = p.z;
      this.snowSizes[i] = p.scale * 2.0;
    }
    this.snowGeometry.attributes.position.needsUpdate = true;
    this.snowGeometry.attributes.size.needsUpdate = true;
    this.snowGeometry.setDrawRange(0, count);
    this.snowPoints.visible = count > 0;
  }

  // ─── Heat Haze ────────────────────────────────────────────

  private updateHeatHaze(weather: WeatherRenderState, dt: number): void {
    const intensity = weather.heatFactor;

    if (intensity < 0.05) {
      this.hazeParticles.length = 0;
      this.hazeGeometry.setDrawRange(0, 0);
      this.hazePoints.visible = false;
      return;
    }

    const targetCount = Math.floor(intensity * this.maxHaze);

    // Spawn
    while (this.hazeParticles.length < targetCount) {
      this.hazeParticles.push({
        x: (Math.random() - 0.5) * 30,
        y: 0.5 + Math.random() * 2,
        z: (Math.random() - 0.5) * 30,
        rotationY: Math.random() * Math.PI,
        life: 10 + Math.random() * 5,
      });
    }

    // Animate: slow upward drift + shimmer
    const hazeMat = this.hazePoints.material as THREE.PointsMaterial;
    for (let i = this.hazeParticles.length - 1; i >= 0; i--) {
      const p = this.hazeParticles[i];
      p.y += dt * 0.3;
      p.life -= dt;
      if (p.y > 4 || p.life <= 0) {
        // Recycle
        p.y = 0.5;
        p.x = (Math.random() - 0.5) * 30;
        p.z = (Math.random() - 0.5) * 30;
        p.life = 10 + Math.random() * 5;
      }
    }
    hazeMat.opacity = 0.04 + Math.sin(this.time * 3) * 0.02;

    // Remove excess
    while (this.hazeParticles.length > targetCount + 5) {
      this.hazeParticles.pop();
    }

    // Write positions
    const count = this.hazeParticles.length;
    for (let i = 0; i < count; i++) {
      const p = this.hazeParticles[i];
      this.hazePositions[i * 3] = p.x;
      this.hazePositions[i * 3 + 1] = p.y;
      this.hazePositions[i * 3 + 2] = p.z;
    }
    this.hazeGeometry.attributes.position.needsUpdate = true;
    this.hazeGeometry.setDrawRange(0, count);
    this.hazePoints.visible = count > 0;
  }

  // ─── Spray Mist (ground-level storm effect) ──────────────────

  private updateSpray(weather: WeatherRenderState, dt: number): void {
    const storm = weather.stormFactor;

    if (storm < 0.5) {
      // Drain existing spray
      for (let i = this.sprayParticles.length - 1; i >= 0; i--) {
        this.sprayParticles[i].life -= dt;
        if (this.sprayParticles[i].life <= 0) {
          this.sprayParticles[i] = this.sprayParticles[this.sprayParticles.length - 1];
          this.sprayParticles.pop();
        }
      }
      if (this.sprayParticles.length === 0) {
        this.sprayGeometry.setDrawRange(0, 0);
        this.sprayPoints.visible = false;
        return;
      }
    } else {
      // Target count scales with how far above 0.5 threshold
      const sprayIntensity = (storm - 0.5) / 0.5; // 0–1
      const targetCount = Math.floor(sprayIntensity * this.maxSpray);

      // Spawn
      const spread = 40;
      while (this.sprayParticles.length < targetCount) {
        this.sprayParticles.push({
          x: (Math.random() - 0.5) * spread,
          y: 0.1 + Math.random() * 0.7,
          z: (Math.random() - 0.5) * spread,
          vx: weather.windFactor * 4 + (Math.random() - 0.5) * 2,
          vz: (Math.random() - 0.5) * 2,
          life: 2 + Math.random() * 3,
        });
      }

      // Remove excess
      while (this.sprayParticles.length > targetCount + 5) {
        this.sprayParticles.pop();
      }
    }

    // Update existing
    for (let i = this.sprayParticles.length - 1; i >= 0; i--) {
      const p = this.sprayParticles[i];
      p.x += p.vx * dt + (Math.random() - 0.5) * 0.5 * dt;
      p.y += 0.3 * dt;
      p.z += p.vz * dt + (Math.random() - 0.5) * 0.5 * dt;
      p.life -= dt;

      if (p.life <= 0 || p.y > 2) {
        this.sprayParticles[i] = this.sprayParticles[this.sprayParticles.length - 1];
        this.sprayParticles.pop();
      }
    }

    // Write positions
    const count = this.sprayParticles.length;
    for (let i = 0; i < count; i++) {
      const p = this.sprayParticles[i];
      this.sprayPositions[i * 3]     = p.x;
      this.sprayPositions[i * 3 + 1] = p.y;
      this.sprayPositions[i * 3 + 2] = p.z;
    }
    this.sprayGeometry.attributes.position.needsUpdate = true;
    this.sprayGeometry.setDrawRange(0, count);
    this.sprayPoints.visible = count > 0;
  }

  // ─── Flood Water ────────────────────────────────────────────

  private updateFlood(weather: WeatherRenderState, dt: number): void {
    const targetOpacity = weather.floodLevel * WEATHER.FLOOD_MAX_OPACITY;

    this.floodOpacity += (targetOpacity - this.floodOpacity) * dt * 0.5;
    this.floodMaterial.opacity = this.floodOpacity;

    // Gentle wave ripple
    this.floodMesh.position.y = 0.04 + Math.sin(this.time * 1.5) * 0.015 * weather.floodLevel;

    this.floodMesh.visible = this.floodOpacity > 0.01;
  }

  // ─── Lightning ────────────────────────────────────────────

  private updateLightning(weather: WeatherRenderState, dt: number): void {
    if (weather.stormFactor < 0.3) {
      this.lightningLight.intensity = 0;
      return;
    }

    const storm = weather.stormFactor;

    // Update distance based on storm intensity
    this.lightningLight.distance = 80 + storm * 60;

    this.lightningTimer -= dt;

    if (this.lightningActive) {
      this.lightningDuration -= dt;

      if (this.lightningDuration <= 0) {
        // Check for double flash
        if (this.lightningIsDoubleFlash && this.lightningPhase === 0) {
          // Gap between flashes
          this.lightningPhase = 1;
          this.lightningDuration = 0.08; // brief dark gap
          this.lightningLight.intensity = 0;
        } else if (this.lightningIsDoubleFlash && this.lightningPhase === 1) {
          // Second flash (dimmer)
          this.lightningPhase = 2;
          this.lightningDuration = 0.08 + Math.random() * 0.1;
          this.lightningLight.intensity = (2 + storm * 4) * 0.6;
        } else {
          // Flash complete
          this.lightningActive = false;
          this.lightningLight.intensity = 0;
          this.lightningIsDoubleFlash = false;
          this.lightningPhase = 0;
        }
      } else if (this.lightningPhase !== 1) {
        // Flash flicker (skip during gap)
        const baseIntensity = 2 + storm * 4;
        const flickerMul = this.lightningPhase === 2 ? 0.6 : 1.0;
        this.lightningLight.intensity = (Math.random() > 0.3 ? baseIntensity : 0) * flickerMul;
      }
    } else if (this.lightningTimer <= 0) {
      // Trigger lightning
      this.lightningActive = true;
      this.lightningDuration = 0.1 + Math.random() * 0.15;
      this.lightningPhase = 0;
      this.lightningLight.position.set(
        (Math.random() - 0.5) * 40,
        25 + Math.random() * 10,
        (Math.random() - 0.5) * 40
      );

      // Double flash chance when storm is severe
      this.lightningIsDoubleFlash = storm > 0.7 && Math.random() < 0.4;

      // Frequency scales with storm intensity (more frequent = shorter wait)
      this.lightningTimer = (2 + Math.random() * 4) / (0.5 + storm);
    }
  }

  // ─── Snow Ground Cover ────────────────────────────────────

  private updateSnowGround(weather: WeatherRenderState, dt: number): void {
    if (!this.snowGroundMesh) return;

    const targetOpacity = weather.snowIntensity > 0.3 ? Math.min(0.6, weather.snowIntensity * 0.7) :
      weather.coldFactor > 0.5 ? 0.3 : 0;

    this.snowCoverOpacity += (targetOpacity - this.snowCoverOpacity) * dt * 0.3;
    this.snowGroundMaterial.opacity = this.snowCoverOpacity;
    this.snowGroundMesh.visible = this.snowCoverOpacity > 0.01;
  }

  // ─── Frost ────────────────────────────────────────────────

  private updateFrost(weather: WeatherRenderState): void {
    const shouldShowFrost = weather.coldFactor > 0.5;

    if (shouldShowFrost && !this.frostBuilt) {
      this.buildFrostDetails();
      this.frostBuilt = true;
    }

    this.frostGroup.visible = shouldShowFrost;

    // Fade frost meshes
    if (this.frostBuilt) {
      this.frostGroup.traverse(child => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          const targetOpacity = Math.min(1, weather.coldFactor);
          child.material.opacity += (targetOpacity - child.material.opacity) * 0.02;
        }
      });
    }
  }

  private buildFrostDetails(): void {
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0xd0e8ff,
      roughness: 0.2,
      metalness: 0.3,
      transparent: true,
      opacity: 0
    });

    // Shared icicle geometry (reused for all icicles)
    const icicleGeom = new THREE.ConeGeometry(0.06, 0.35, 4);

    // Small icicles scattered at various positions
    const iciclePositions = [
      { x: 3, z: 0 }, { x: -3, z: 0 }, { x: 0, z: 3 }, { x: 0, z: -3 },
      { x: 5, z: 2 }, { x: -5, z: -2 }, { x: 2, z: 5 }, { x: -2, z: -5 },
      { x: 7, z: 0 }, { x: -7, z: 0 }, { x: 0, z: 7 }, { x: 0, z: -7 }
    ];

    for (const pos of iciclePositions) {
      const icicle = new THREE.Mesh(icicleGeom, iceMat.clone());
      icicle.position.set(pos.x, 2.5 + Math.random() * 2, pos.z);
      icicle.rotation.z = Math.PI; // point downward
      this.frostGroup.add(icicle);
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────

  dispose(): void {
    this.rainParticles.length = 0;
    this.splashParticles.length = 0;
    this.snowParticles.length = 0;
    this.hazeParticles.length = 0;
    this.sprayParticles.length = 0;

    this.rainGeometry.dispose();
    this.rainMaterial.dispose();

    this.splashGeometry.dispose();
    (this.splashPoints.material as THREE.Material).dispose();

    this.snowGeometry.dispose();
    (this.snowPoints.material as THREE.Material).dispose();

    this.hazeGeometry.dispose();
    (this.hazePoints.material as THREE.Material).dispose();

    this.sprayGeometry.dispose();
    (this.sprayPoints.material as THREE.Material).dispose();

    this.floodMesh.geometry.dispose();
    this.floodMaterial.dispose();

    if (this.snowGroundMesh) {
      this.snowGroundMesh.geometry.dispose();
      this.snowGroundMaterial.dispose();
    }

    this.frostGroup.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    });

    this.scene.remove(this.group);
  }
}
