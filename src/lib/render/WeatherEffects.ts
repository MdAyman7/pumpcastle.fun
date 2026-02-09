/**
 * WeatherEffects.ts
 *
 * Visual particle systems for weather:
 * - Rain streaks
 * - Snow flakes
 * - Heat haze (subtle screen-space distortion faked with particles)
 * - Storm lightning flashes
 * - Fog thickening
 */

import * as THREE from 'three';
import type { WeatherRenderState } from '$lib/state/WeatherState';

interface RainDrop {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

interface SnowFlake {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  drift: number;
  phase: number;
  life: number;
}

export class WeatherEffects {
  private scene: THREE.Scene;
  private group: THREE.Group;

  // Rain
  private rainDrops: RainDrop[] = [];
  private rainMaterial: THREE.MeshBasicMaterial;
  private rainGeometry: THREE.BoxGeometry;
  private readonly MAX_RAIN = 300;

  // Snow
  private snowFlakes: SnowFlake[] = [];
  private snowMaterial: THREE.MeshBasicMaterial;
  private snowGeometry: THREE.SphereGeometry;
  private readonly MAX_SNOW = 200;

  // Heat haze particles (shimmer effect)
  private hazeParticles: THREE.Mesh[] = [];
  private hazeMaterial: THREE.MeshBasicMaterial;
  private readonly MAX_HAZE = 40;

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

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'weatherEffects';
    this.scene.add(this.group);

    // Rain material: thin blue-white streaks
    this.rainMaterial = new THREE.MeshBasicMaterial({
      color: 0xaabbdd,
      transparent: true,
      opacity: 0.4
    });
    this.rainGeometry = new THREE.BoxGeometry(0.02, 0.4, 0.02);

    // Snow material: white soft spheres
    this.snowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8
    });
    this.snowGeometry = new THREE.SphereGeometry(0.04, 4, 3);

    // Heat haze: semi-transparent warm-tinted quads
    this.hazeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffeecc,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide
    });

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
    const targetCount = Math.floor(intensity * this.MAX_RAIN);

    // Spawn
    while (this.rainDrops.length < targetCount) {
      this.spawnRainDrop(weather);
    }

    // Update existing
    for (let i = this.rainDrops.length - 1; i >= 0; i--) {
      const drop = this.rainDrops[i];
      drop.mesh.position.add(drop.velocity.clone().multiplyScalar(dt));

      // Wind pushes rain sideways
      drop.mesh.position.x += weather.windFactor * 3 * dt;

      drop.life -= dt;
      if (drop.mesh.position.y < -0.5 || drop.life <= 0) {
        this.group.remove(drop.mesh);
        this.rainDrops.splice(i, 1);
      }
    }

    // Remove excess
    while (this.rainDrops.length > targetCount + 10) {
      const removed = this.rainDrops.pop()!;
      this.group.remove(removed.mesh);
    }
  }

  private spawnRainDrop(weather: WeatherRenderState): void {
    const mesh = new THREE.Mesh(this.rainGeometry, this.rainMaterial);
    const spread = 40;
    mesh.position.set(
      (Math.random() - 0.5) * spread,
      15 + Math.random() * 10,
      (Math.random() - 0.5) * spread
    );
    mesh.rotation.z = weather.windFactor * 0.3;
    this.group.add(mesh);

    this.rainDrops.push({
      mesh,
      velocity: new THREE.Vector3(0, -12 - Math.random() * 6, 0),
      life: 3
    });
  }

  // ─── Snow ─────────────────────────────────────────────────

  private updateSnow(weather: WeatherRenderState, dt: number): void {
    const intensity = weather.snowIntensity;
    const targetCount = Math.floor(intensity * this.MAX_SNOW);

    // Spawn
    while (this.snowFlakes.length < targetCount) {
      this.spawnSnowFlake();
    }

    // Update
    for (let i = this.snowFlakes.length - 1; i >= 0; i--) {
      const flake = this.snowFlakes[i];
      flake.phase += dt * 2;

      // Gentle sway
      const sway = Math.sin(flake.phase + flake.drift) * 0.5;
      flake.mesh.position.x += (sway + weather.windFactor * 1.5) * dt;
      flake.mesh.position.y += flake.velocity.y * dt;
      flake.mesh.position.z += Math.cos(flake.phase * 0.7) * 0.2 * dt;

      flake.life -= dt;
      if (flake.mesh.position.y < -0.2 || flake.life <= 0) {
        this.group.remove(flake.mesh);
        this.snowFlakes.splice(i, 1);
      }
    }

    // Remove excess
    while (this.snowFlakes.length > targetCount + 10) {
      const removed = this.snowFlakes.pop()!;
      this.group.remove(removed.mesh);
    }
  }

  private spawnSnowFlake(): void {
    const mesh = new THREE.Mesh(this.snowGeometry, this.snowMaterial);
    const spread = 40;
    mesh.position.set(
      (Math.random() - 0.5) * spread,
      12 + Math.random() * 8,
      (Math.random() - 0.5) * spread
    );
    const scale = 0.5 + Math.random() * 1;
    mesh.scale.setScalar(scale);
    this.group.add(mesh);

    this.snowFlakes.push({
      mesh,
      velocity: new THREE.Vector3(0, -1.2 - Math.random() * 0.8, 0),
      drift: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      life: 12
    });
  }

  // ─── Heat Haze ────────────────────────────────────────────

  private updateHeatHaze(weather: WeatherRenderState, dt: number): void {
    const intensity = weather.heatFactor;

    if (intensity < 0.05) {
      // Remove all haze particles
      for (const p of this.hazeParticles) {
        this.group.remove(p);
      }
      this.hazeParticles = [];
      return;
    }

    const targetCount = Math.floor(intensity * this.MAX_HAZE);

    // Spawn
    while (this.hazeParticles.length < targetCount) {
      const geom = new THREE.PlaneGeometry(2 + Math.random() * 3, 0.8 + Math.random());
      const mesh = new THREE.Mesh(geom, this.hazeMaterial);
      mesh.position.set(
        (Math.random() - 0.5) * 30,
        0.5 + Math.random() * 2,
        (Math.random() - 0.5) * 30
      );
      mesh.rotation.y = Math.random() * Math.PI;
      this.group.add(mesh);
      this.hazeParticles.push(mesh);
    }

    // Animate: slow upward drift + shimmer
    for (const p of this.hazeParticles) {
      p.position.y += dt * 0.3;
      if (p.material instanceof THREE.MeshBasicMaterial) {
        p.material.opacity = 0.04 + Math.sin(this.time * 3 + p.position.x) * 0.03;
      }
      if (p.position.y > 4) {
        p.position.y = 0.5;
        p.position.x = (Math.random() - 0.5) * 30;
        p.position.z = (Math.random() - 0.5) * 30;
      }
    }

    // Remove excess
    while (this.hazeParticles.length > targetCount + 5) {
      const removed = this.hazeParticles.pop()!;
      this.group.remove(removed);
      removed.geometry.dispose();
    }
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

    // Small icicles scattered at various positions
    const iciclePositions = [
      { x: 3, z: 0 }, { x: -3, z: 0 }, { x: 0, z: 3 }, { x: 0, z: -3 },
      { x: 5, z: 2 }, { x: -5, z: -2 }, { x: 2, z: 5 }, { x: -2, z: -5 },
      { x: 7, z: 0 }, { x: -7, z: 0 }, { x: 0, z: 7 }, { x: 0, z: -7 }
    ];

    for (const pos of iciclePositions) {
      const icicle = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.3 + Math.random() * 0.2, 4),
        iceMat.clone()
      );
      icicle.position.set(pos.x, 2.5 + Math.random() * 2, pos.z);
      icicle.rotation.z = Math.PI; // point downward
      this.frostGroup.add(icicle);
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────

  dispose(): void {
    for (const drop of this.rainDrops) this.group.remove(drop.mesh);
    this.rainDrops = [];

    for (const flake of this.snowFlakes) this.group.remove(flake.mesh);
    this.snowFlakes = [];

    for (const p of this.hazeParticles) {
      this.group.remove(p);
      p.geometry.dispose();
    }
    this.hazeParticles = [];

    this.rainGeometry.dispose();
    this.rainMaterial.dispose();
    this.snowGeometry.dispose();
    this.snowMaterial.dispose();
    this.hazeMaterial.dispose();

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
