/**
 * WeatherEffects.ts
 *
 * Visual particle systems for weather:
 * - Rain streaks (batched Points — 1 draw call)
 * - Snow flakes (batched Points — 1 draw call)
 * - Heat haze (batched Points — 1 draw call)
 * - Storm lightning flashes
 * - Fog thickening
 *
 * OPTIMIZED: All particles use THREE.Points with BufferGeometry.
 * Rain/snow/haze share a single Points mesh each instead of
 * hundreds of individual Mesh objects. This reduces draw calls
 * from ~540 to ~3 for weather effects.
 */

import * as THREE from 'three';
import type { WeatherRenderState } from '$lib/state/WeatherState';
import { qualitySettings } from './QualitySettings';

interface RainParticle {
  x: number; y: number; z: number;
  vy: number;
  life: number;
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

export class WeatherEffects {
  private scene: THREE.Scene;
  private group: THREE.Group;

  // Rain — single Points mesh
  private rainParticles: RainParticle[] = [];
  private rainPoints: THREE.Points;
  private rainPositions: Float32Array;
  private rainGeometry: THREE.BufferGeometry;

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

  // Lightning
  private lightningLight: THREE.PointLight;
  private lightningTimer: number = 0;
  private lightningActive: boolean = false;
  private lightningDuration: number = 0;

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

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'weatherEffects';
    this.scene.add(this.group);

    const qc = qualitySettings.getConfig();
    this.maxRain = qc.maxRain;
    this.maxSnow = qc.maxSnow;
    this.maxHaze = qc.maxHaze;

    // ─── Rain Points ──────────────────────────────────────
    this.rainPositions = new Float32Array(this.maxRain * 3);
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position',
      new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    this.rainGeometry.setDrawRange(0, 0);

    const rainMaterial = new THREE.PointsMaterial({
      color: 0xaabbdd,
      transparent: true,
      opacity: 0.5,
      size: 1.5,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.rainPoints = new THREE.Points(this.rainGeometry, rainMaterial);
    this.rainPoints.frustumCulled = false;
    this.group.add(this.rainPoints);

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
    this.updateSnow(weather, dt);
    this.updateHeatHaze(weather, dt);
    this.updateLightning(weather, dt);
    this.updateSnowGround(weather, dt);
    this.updateFrost(weather);
  }

  // ─── Rain ──────────────────────────────────────────────────

  private updateRain(weather: WeatherRenderState, dt: number): void {
    const intensity = weather.rainIntensity;
    const targetCount = Math.floor(intensity * this.maxRain);

    // Spawn new rain particles
    while (this.rainParticles.length < targetCount) {
      const spread = 40;
      this.rainParticles.push({
        x: (Math.random() - 0.5) * spread,
        y: 15 + Math.random() * 10,
        z: (Math.random() - 0.5) * spread,
        vy: -12 - Math.random() * 6,
        life: 3,
      });
    }

    // Update existing
    for (let i = this.rainParticles.length - 1; i >= 0; i--) {
      const p = this.rainParticles[i];
      p.y += p.vy * dt;
      p.x += weather.windFactor * 3 * dt;
      p.life -= dt;
      if (p.y < -0.5 || p.life <= 0) {
        // Swap-remove for performance
        this.rainParticles[i] = this.rainParticles[this.rainParticles.length - 1];
        this.rainParticles.pop();
      }
    }

    // Remove excess
    while (this.rainParticles.length > targetCount + 10) {
      this.rainParticles.pop();
    }

    // Write positions to buffer
    const count = this.rainParticles.length;
    for (let i = 0; i < count; i++) {
      const p = this.rainParticles[i];
      this.rainPositions[i * 3] = p.x;
      this.rainPositions[i * 3 + 1] = p.y;
      this.rainPositions[i * 3 + 2] = p.z;
    }
    this.rainGeometry.attributes.position.needsUpdate = true;
    this.rainGeometry.setDrawRange(0, count);
    this.rainPoints.visible = count > 0;
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

  // ─── Lightning ────────────────────────────────────────────

  private updateLightning(weather: WeatherRenderState, dt: number): void {
    if (weather.stormFactor < 0.3) {
      this.lightningLight.intensity = 0;
      return;
    }

    this.lightningTimer -= dt;

    if (this.lightningActive) {
      this.lightningDuration -= dt;
      if (this.lightningDuration <= 0) {
        this.lightningActive = false;
        this.lightningLight.intensity = 0;
      } else {
        // Flash flicker
        this.lightningLight.intensity = (Math.random() > 0.3 ? 3 : 0) * weather.stormFactor;
      }
    } else if (this.lightningTimer <= 0) {
      // Trigger lightning
      this.lightningActive = true;
      this.lightningDuration = 0.1 + Math.random() * 0.15;
      this.lightningLight.position.set(
        (Math.random() - 0.5) * 40,
        25 + Math.random() * 10,
        (Math.random() - 0.5) * 40
      );
      this.lightningTimer = 3 + Math.random() * 8;
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
    this.snowParticles.length = 0;
    this.hazeParticles.length = 0;

    this.rainGeometry.dispose();
    (this.rainPoints.material as THREE.Material).dispose();

    this.snowGeometry.dispose();
    (this.snowPoints.material as THREE.Material).dispose();

    this.hazeGeometry.dispose();
    (this.hazePoints.material as THREE.Material).dispose();

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
