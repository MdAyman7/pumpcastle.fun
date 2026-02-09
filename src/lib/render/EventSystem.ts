/**
 * EventSystem.ts
 *
 * Short visual micro-events triggered by data deltas.
 * Events last 2-6 seconds with cooldowns to avoid spam.
 */

import * as THREE from 'three';
import type { RenderState } from '$lib/types';

export type MicroEventType =
  | 'volume_spike'       // Volume doubles → builders cheer
  | 'new_ath'           // New all-time high → fireworks
  | 'sudden_dump'       // Price drop > 20% → bells + panic
  | 'graduation'        // Token graduates → construction surge
  | 'legendary_reach'   // Hit 100M → golden flash
  | 'zombie_rise'       // Became zombie → eerie pulse
  | 'recovery'          // Decay decreasing → warm glow
  ;

interface ActiveEvent {
  type: MicroEventType;
  startTime: number;
  duration: number;      // seconds
  progress: number;      // 0-1
  intensity: number;     // 0-1
  data: Record<string, number>;
}

interface EventCooldown {
  type: MicroEventType;
  expiry: number; // timestamp
}

export class EventSystem {
  private scene: THREE.Scene;
  private activeEvents: ActiveEvent[] = [];
  private cooldowns: EventCooldown[] = [];
  private eventGroup: THREE.Group;

  // Previous state for delta detection
  private prevVolume: number = 0;
  private prevDecay: number = 0;
  private prevMarketCap: number = 0;
  private prevATH: number = 0;
  private prevPhase: string = '';
  private prevIsLegendary: boolean = false;
  private prevIsZombie: boolean = false;
  private initialized: boolean = false;

  // Visual effect meshes
  private fireworkParticles: Array<{
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    life: number;
    color: THREE.Color;
  }> = [];

  private flashLight: THREE.PointLight | null = null;

  // Cooldown durations per event type (seconds)
  private readonly COOLDOWNS: Record<MicroEventType, number> = {
    volume_spike: 30,
    new_ath: 60,
    sudden_dump: 20,
    graduation: 120,
    legendary_reach: 120,
    zombie_rise: 60,
    recovery: 45
  };

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.eventGroup = new THREE.Group();
    this.eventGroup.name = 'events';
    this.scene.add(this.eventGroup);

    // Create flash light (reused for multiple events)
    this.flashLight = new THREE.PointLight(0xffffff, 0, 30);
    this.flashLight.position.set(0, 10, 0);
    this.scene.add(this.flashLight);
  }

  /**
   * Update event system - detect triggers and animate active events
   */
  update(state: RenderState, deltaTime: number): void {
    const dt = deltaTime / 1000;
    const now = Date.now();

    // Clean up expired cooldowns
    this.cooldowns = this.cooldowns.filter(c => c.expiry > now);

    // Detect new events from state deltas
    if (this.initialized) {
      this.detectEvents(state, now);
    }

    // Store prev state
    this.prevVolume = state.smoothVolume;
    this.prevDecay = state.smoothDecay;
    this.prevMarketCap = state.marketCap;
    this.prevATH = state.athMarketCap;
    this.prevPhase = state.phase;
    this.prevIsLegendary = state.isLegendary;
    this.prevIsZombie = state.isZombie;
    this.initialized = true;

    // Update active events
    for (let i = this.activeEvents.length - 1; i >= 0; i--) {
      const event = this.activeEvents[i];
      const elapsed = (now - event.startTime) / 1000;
      event.progress = Math.min(1, elapsed / event.duration);

      if (event.progress >= 1) {
        this.activeEvents.splice(i, 1);
      }
    }

    // Animate visual effects
    this.updateVisuals(state, dt);
  }

  /**
   * Detect new events from state changes
   */
  private detectEvents(state: RenderState, now: number): void {
    // Volume spike: volume ratio jumps significantly
    if (state.smoothVolume > this.prevVolume * 1.8 && state.smoothVolume > 1.2) {
      this.triggerEvent('volume_spike', 3, state.smoothVolume, now);
    }

    // New ATH
    if (state.marketCap > this.prevATH && state.marketCap > this.prevMarketCap * 1.1) {
      this.triggerEvent('new_ath', 4, 1, now);
    }

    // Sudden dump
    if (state.priceChange24h < -20 && state.smoothDecay > this.prevDecay + 0.05) {
      this.triggerEvent('sudden_dump', 4, Math.abs(state.priceChange24h) / 50, now);
    }

    // Graduation
    if (state.showGraduationCelebration && this.prevPhase === 'construction') {
      this.triggerEvent('graduation', 6, 1, now);
    }

    // Legendary reach
    if (state.isLegendary && !this.prevIsLegendary) {
      this.triggerEvent('legendary_reach', 5, 1, now);
    }

    // Zombie rise
    if (state.isZombie && !this.prevIsZombie) {
      this.triggerEvent('zombie_rise', 4, 1, now);
    }

    // Recovery (decay decreasing meaningfully)
    if (this.prevDecay > 0.3 && state.smoothDecay < this.prevDecay - 0.05) {
      this.triggerEvent('recovery', 3, this.prevDecay - state.smoothDecay, now);
    }
  }

  /**
   * Trigger a new event if not on cooldown
   */
  private triggerEvent(type: MicroEventType, duration: number, intensity: number, now: number): void {
    // Check cooldown
    if (this.cooldowns.some(c => c.type === type)) return;

    // Check if already active
    if (this.activeEvents.some(e => e.type === type)) return;

    // Add event
    this.activeEvents.push({
      type,
      startTime: now,
      duration,
      progress: 0,
      intensity: Math.min(1, intensity),
      data: {}
    });

    // Set cooldown
    this.cooldowns.push({
      type,
      expiry: now + this.COOLDOWNS[type] * 1000
    });

    // Trigger immediate visuals
    this.onEventStart(type, intensity);
  }

  /**
   * Handle event start - spawn initial visuals
   */
  private onEventStart(type: MicroEventType, intensity: number): void {
    switch (type) {
      case 'new_ath':
      case 'legendary_reach':
        this.spawnFireworks(15 + Math.floor(intensity * 20));
        break;

      case 'sudden_dump':
        // Flash red
        if (this.flashLight) {
          this.flashLight.color.setHex(0xff2200);
          this.flashLight.intensity = 3 * intensity;
        }
        break;

      case 'graduation':
        this.spawnFireworks(30);
        if (this.flashLight) {
          this.flashLight.color.setHex(0xffd700);
          this.flashLight.intensity = 4;
        }
        break;

      case 'volume_spike':
        if (this.flashLight) {
          this.flashLight.color.setHex(0x44ff44);
          this.flashLight.intensity = 2 * intensity;
        }
        break;

      case 'zombie_rise':
        if (this.flashLight) {
          this.flashLight.color.setHex(0x44ff44);
          this.flashLight.intensity = 2;
        }
        break;

      case 'recovery':
        if (this.flashLight) {
          this.flashLight.color.setHex(0xffeebb);
          this.flashLight.intensity = 1.5;
        }
        break;
    }
  }

  /**
   * Spawn firework particles
   */
  private spawnFireworks(count: number): void {
    const colors = [0xff6b6b, 0xfeca57, 0x48dbfb, 0xff9ff3, 0xffd700, 0x54a0ff];
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const geom = new THREE.SphereGeometry(0.08, 4, 4);

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const elevation = Math.random() * Math.PI * 0.6 + 0.2;
      const speed = 3 + Math.random() * 5;
      const color = new THREE.Color(colors[i % colors.length]);

      const mesh = new THREE.Mesh(geom, mat.clone());
      (mesh.material as THREE.MeshBasicMaterial).color = color;
      mesh.position.set(
        (Math.random() - 0.5) * 4,
        5 + Math.random() * 5,
        (Math.random() - 0.5) * 4
      );
      this.eventGroup.add(mesh);

      this.fireworkParticles.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.sin(elevation) * speed,
          Math.cos(elevation) * speed,
          Math.sin(angle) * Math.sin(elevation) * speed
        ),
        life: 1.5 + Math.random() * 1.5,
        color
      });
    }
  }

  /**
   * Update visual effects each frame
   */
  private updateVisuals(_state: RenderState, dt: number): void {
    // Decay flash light
    if (this.flashLight && this.flashLight.intensity > 0) {
      this.flashLight.intensity *= Math.pow(0.05, dt);
      if (this.flashLight.intensity < 0.01) this.flashLight.intensity = 0;
    }

    // Update firework particles
    for (let i = this.fireworkParticles.length - 1; i >= 0; i--) {
      const fw = this.fireworkParticles[i];
      fw.velocity.y -= 9.8 * dt;
      fw.mesh.position.add(fw.velocity.clone().multiplyScalar(dt));
      fw.life -= dt;

      // Fade out
      const opacity = Math.max(0, fw.life / 2);
      if (fw.mesh.material instanceof THREE.MeshBasicMaterial) {
        fw.mesh.material.opacity = opacity;
        fw.mesh.material.transparent = true;
      }

      // Scale down
      const s = Math.max(0.01, fw.life / 2);
      fw.mesh.scale.setScalar(s);

      if (fw.life <= 0 || fw.mesh.position.y < 0) {
        this.eventGroup.remove(fw.mesh);
        fw.mesh.geometry.dispose();
        (fw.mesh.material as THREE.Material).dispose();
        this.fireworkParticles.splice(i, 1);
      }
    }
  }

  /**
   * Get active events for other systems to react to
   */
  getActiveEvents(): ReadonlyArray<ActiveEvent> {
    return this.activeEvents;
  }

  /**
   * Check if a specific event type is currently active
   */
  isEventActive(type: MicroEventType): boolean {
    return this.activeEvents.some(e => e.type === type);
  }

  /**
   * Get event progress (0-1) or -1 if not active
   */
  getEventProgress(type: MicroEventType): number {
    const event = this.activeEvents.find(e => e.type === type);
    return event ? event.progress : -1;
  }

  /**
   * Get camera shake intensity from active events
   */
  getCameraShake(): number {
    let shake = 0;
    for (const event of this.activeEvents) {
      const falloff = 1 - event.progress;
      switch (event.type) {
        case 'sudden_dump':
          shake += 0.3 * event.intensity * falloff;
          break;
        case 'graduation':
          shake += 0.1 * falloff;
          break;
        case 'legendary_reach':
          shake += 0.15 * falloff;
          break;
      }
    }
    return Math.min(0.5, shake);
  }

  reset(): void {
    this.activeEvents = [];
    this.cooldowns = [];
    this.initialized = false;

    // Clean up fireworks
    for (const fw of this.fireworkParticles) {
      this.eventGroup.remove(fw.mesh);
      fw.mesh.geometry.dispose();
      (fw.mesh.material as THREE.Material).dispose();
    }
    this.fireworkParticles = [];

    if (this.flashLight) {
      this.flashLight.intensity = 0;
    }
  }

  dispose(): void {
    this.reset();
    if (this.flashLight) {
      this.scene.remove(this.flashLight);
      this.flashLight.dispose();
    }
    this.scene.remove(this.eventGroup);
  }
}
