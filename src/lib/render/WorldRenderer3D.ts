/**
 * WorldRenderer3D.ts
 *
 * Main Three.js renderer orchestrating the entire scene.
 *
 * Features:
 * - Day/night cycle driven by user's local clock
 * - Mouse-hold orbit camera (hold + drag to rotate)
 * - ActorManager, EventSystem, PhysicsMotion, MemoryState/Renderer
 * - Smooth atmosphere transitions layered with time-of-day
 */

import * as THREE from 'three';
import type { TokenData, WorldState, RenderState } from '$lib/types';
import { computeWorldState, hashString, seededRandom } from '$lib/state/CastleState';
import { getCelebrationProgress, resetGraduationState } from '$lib/state/GraduationState';
import { MemoryState } from '$lib/state/MemoryState';
import { WeatherState } from '$lib/state/WeatherState';
import type { WeatherRenderState } from '$lib/state/WeatherState';
import { CastleMeshBuilder } from './CastleMeshBuilder';
import { CreatureMeshBuilder } from './CreatureMeshBuilder';
import { EnvironmentBuilder } from './EnvironmentBuilder';
import { EffectsManager } from './EffectsManager';
import { ActorManager } from './ActorManager';
import { EventSystem } from './EventSystem';
import { PhysicsMotion } from './PhysicsMotion';
import { MemoryRenderer } from './MemoryRenderer';
import { OuterWorldBuilder } from './OuterWorldBuilder';
import { WeatherEffects } from './WeatherEffects';

export class WorldRenderer3D {
  // Three.js core
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Dimensions
  private width: number;
  private height: number;
  private container: HTMLElement;

  // Sub-builders
  private castleBuilder: CastleMeshBuilder;
  private creatureBuilder: CreatureMeshBuilder;
  private environmentBuilder: EnvironmentBuilder;
  private effectsManager: EffectsManager;

  // Enhanced systems
  private actorManager: ActorManager;
  private eventSystem: EventSystem;
  private physicsMotion: PhysicsMotion;
  private memoryState: MemoryState;
  private memoryRenderer: MemoryRenderer;
  private outerWorldBuilder: OuterWorldBuilder;
  private weatherState: WeatherState;
  private weatherEffects: WeatherEffects;

  // Lighting
  private sunLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  private moonLight!: THREE.DirectionalLight;

  // State
  private currentTokenData: TokenData | null = null;
  private worldState: WorldState | null = null;
  private renderState: RenderState | null = null;

  // Animation
  private animationId: number | null = null;
  private lastTime: number = 0;
  private time: number = 0;
  private clock: THREE.Clock;

  // Interpolation
  private targetDecay: number = 0;
  private targetVolume: number = 0;
  private targetConstruction: number = 0;
  private smoothDecay: number = 0;
  private smoothVolume: number = 0;
  private smoothConstruction: number = 0;

  // Camera – base target (state-driven)
  private baseCameraPosition: THREE.Vector3;
  private baseLookAt: THREE.Vector3;
  private cameraShakeIntensity: number = 0;

  // Idle orbit (auto-rotates slowly when not dragging)
  private cameraIdleOrbitAngle: number = 0;
  private cameraIdleOrbitSpeed: number = 0.03;

  // Mouse-hold orbit
  private isDragging: boolean = false;
  private dragOrbitYaw: number = 0;   // horizontal angle offset (radians)
  private dragOrbitPitch: number = 0; // vertical angle offset (radians)
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragStartYaw: number = 0;
  private dragStartPitch: number = 0;

  // Atmosphere interpolation
  private currentFogColor: THREE.Color;
  private targetFogColor: THREE.Color;
  private currentFogNear: number = 30;
  private currentFogFar: number = 100;
  private targetFogNear: number = 30;
  private targetFogFar: number = 100;
  private currentSunColor: THREE.Color;
  private targetSunColor: THREE.Color;
  private currentSunIntensity: number = 1.2;
  private targetSunIntensity: number = 1.2;
  private currentAmbientIntensity: number = 0.4;
  private targetAmbientIntensity: number = 0.4;

  // Day / night (0-1 where 0=midnight, 0.5=noon)
  private dayPhase: number = 0.5;
  private currentExposure: number = 1.0;
  private targetExposure: number = 1.0;

  // Seed
  private seed: number = 12345;

  // Bound event handlers (for cleanup)
  private onMouseDown: (e: MouseEvent) => void;
  private onMouseMove: (e: MouseEvent) => void;
  private onMouseUp: (e: MouseEvent) => void;
  private onTouchStart: (e: TouchEvent) => void;
  private onTouchMove: (e: TouchEvent) => void;
  private onTouchEnd: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;
    this.clock = new THREE.Clock();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    // Camera – wider FOV to see more of the world
    this.camera = new THREE.PerspectiveCamera(55, this.width / this.height, 0.1, 1000);
    this.baseCameraPosition = new THREE.Vector3(0, 12, 32);
    this.baseLookAt = new THREE.Vector3(0, 2, 0);
    this.camera.position.copy(this.baseCameraPosition);
    this.camera.lookAt(this.baseLookAt);

    // Atmosphere
    this.currentFogColor = new THREE.Color(0x87ceeb);
    this.targetFogColor = new THREE.Color(0x87ceeb);
    this.currentSunColor = new THREE.Color(0xffeedd);
    this.targetSunColor = new THREE.Color(0xffeedd);

    // Lighting
    this.setupLighting();

    // Builders
    this.castleBuilder = new CastleMeshBuilder(this.scene, this.seed);
    this.creatureBuilder = new CreatureMeshBuilder(this.scene, this.seed);
    this.environmentBuilder = new EnvironmentBuilder(this.scene);
    this.effectsManager = new EffectsManager(this.scene, this.seed);

    // Enhanced systems
    this.actorManager = new ActorManager(this.scene, this.seed);
    this.eventSystem = new EventSystem(this.scene);
    this.physicsMotion = new PhysicsMotion(this.scene, this.seed);
    this.memoryState = new MemoryState(this.seed);
    this.memoryRenderer = new MemoryRenderer(this.scene);
    this.outerWorldBuilder = new OuterWorldBuilder(this.scene, this.seed);
    this.weatherState = new WeatherState();
    this.weatherEffects = new WeatherEffects(this.scene);

    // Terrain
    this.environmentBuilder.buildTerrain();

    // Mouse-hold orbit listeners
    this.onMouseDown = (e: MouseEvent) => this.handlePointerDown(e.clientX, e.clientY, e);
    this.onMouseMove = (e: MouseEvent) => this.handlePointerMove(e.clientX, e.clientY);
    this.onMouseUp = () => this.handlePointerUp();
    this.onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    this.onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    this.onTouchEnd = () => this.handlePointerUp();

    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: true });
    window.addEventListener('touchend', this.onTouchEnd);

    // Set initial day phase
    this.dayPhase = this.computeDayPhase();
  }

  // ─── Day / Night ─────────────────────────────────────────

  /** Returns 0-1 based on local time: 0 = midnight, 0.5 = noon */
  private computeDayPhase(): number {
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60;
    return hours / 24;
  }

  /**
   * Get sun position angle from day phase.
   * Maps 0..1 → -PI..PI so sun arcs across sky.
   * Sunrise ~6am (0.25), sunset ~18 (0.75).
   */
  private getSunAngle(): number {
    return (this.dayPhase - 0.25) * Math.PI * 2;
  }

  /** 0 at night, 1 at noon, smooth sine curve */
  private getDaylightFactor(): number {
    const angle = this.getSunAngle();
    const factor = Math.sin(angle);
    return Math.max(0, Math.min(1, factor));
  }

  /** Apply day/night to sun light position & base atmosphere */
  private updateDayNightCycle(): void {
    // Refresh every frame from real clock (low cost)
    this.dayPhase = this.computeDayPhase();

    const sunAngle = this.getSunAngle();
    const daylight = this.getDaylightFactor();

    // Position the directional sun light on an arc
    const sunDist = 25;
    const sunY = Math.sin(sunAngle) * sunDist;
    const sunZ = Math.cos(sunAngle) * sunDist * 0.6;
    this.sunLight.position.set(10, Math.max(1, sunY), sunZ);

    // Sun intensity scales with daylight – brighter overall
    const baseSunIntensity = 0.25 + daylight * 1.35; // 0.25 at night → 1.6 at noon
    this.sunLight.intensity = baseSunIntensity;

    // Sun color shifts: warm sunrise/sunset, white midday, blue-ish near horizon
    if (daylight < 0.15) {
      // Night
      this.sunLight.color.setHex(0x334466);
    } else if (daylight < 0.4) {
      // Sunrise/sunset
      const t = (daylight - 0.15) / 0.25;
      this.sunLight.color.setHex(0xffa060).lerp(new THREE.Color(0xffeedd), t);
    } else {
      // Daytime
      this.sunLight.color.setHex(0xffeedd);
    }

    // Moon light (subtle blue fill at night)
    const nightFactor = 1 - daylight;
    this.moonLight.intensity = nightFactor * 0.25;

    // Ambient – brighter fill
    this.ambientLight.intensity = 0.25 + daylight * 0.45;

    // Hemi sky color
    const dayColor = new THREE.Color(0x87ceeb);
    const nightColor = new THREE.Color(0x0a0e1a);
    const sunriseColor = new THREE.Color(0xffa070);
    let skyColor: THREE.Color;
    if (daylight < 0.15) {
      skyColor = nightColor;
    } else if (daylight < 0.35) {
      const t = (daylight - 0.15) / 0.2;
      skyColor = nightColor.clone().lerp(sunriseColor, t);
    } else if (daylight < 0.5) {
      const t = (daylight - 0.35) / 0.15;
      skyColor = sunriseColor.clone().lerp(dayColor, t);
    } else {
      skyColor = dayColor;
    }
    this.hemiLight.color.copy(skyColor);

    // Target exposure – brighter overall
    this.targetExposure = 0.5 + daylight * 0.9; // 0.5 at night, 1.4 at noon
  }

  // ─── Mouse-hold orbit ────────────────────────────────────

  private handlePointerDown(x: number, y: number, e?: MouseEvent): void {
    // Don't capture if clicking on UI (anything above canvas z-index)
    if (e) {
      const target = e.target as HTMLElement;
      if (target !== this.renderer.domElement) return;
    }
    this.isDragging = true;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartYaw = this.dragOrbitYaw;
    this.dragStartPitch = this.dragOrbitPitch;
    this.renderer.domElement.style.cursor = 'grabbing';
  }

  private handlePointerMove(x: number, y: number): void {
    if (!this.isDragging) return;
    const dx = x - this.dragStartX;
    const dy = y - this.dragStartY;
    // Sensitivity (lower = more subtle)
    this.dragOrbitYaw = this.dragStartYaw + dx * 0.004;
    this.dragOrbitPitch = this.dragStartPitch + dy * 0.003;
    // Clamp pitch so camera doesn't flip
    this.dragOrbitPitch = Math.max(-0.8, Math.min(0.8, this.dragOrbitPitch));
  }

  private handlePointerUp(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.renderer.domElement.style.cursor = 'grab';
    }
  }

  // ─── Lighting setup ──────────────────────────────────────

  private setupLighting(): void {
    // Brighter ambient for less harsh shadows
    this.ambientLight = new THREE.AmbientLight(0x607080, 0.6);
    this.scene.add(this.ambientLight);

    // Sun – slightly softer shadows, wider coverage
    this.sunLight = new THREE.DirectionalLight(0xffeedd, 1.4);
    this.sunLight.position.set(15, 25, 12);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 80;
    this.sunLight.shadow.camera.left = -35;
    this.sunLight.shadow.camera.right = 35;
    this.sunLight.shadow.camera.top = 35;
    this.sunLight.shadow.camera.bottom = -35;
    this.sunLight.shadow.bias = -0.0001;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);

    // Stronger hemisphere for fill light
    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x4a6a40, 0.5);
    this.scene.add(this.hemiLight);

    // Moonlight
    this.moonLight = new THREE.DirectionalLight(0x4466aa, 0);
    this.moonLight.position.set(-10, 15, -10);
    this.scene.add(this.moonLight);
  }

  // ─── Token data ──────────────────────────────────────────

  setTokenData(tokenData: TokenData): void {
    const isNewToken = !this.currentTokenData ||
      this.currentTokenData.address !== tokenData.address;

    if (isNewToken) {
      this.seed = hashString(tokenData.address);
      this.castleBuilder.reset(this.seed);
      this.creatureBuilder.reset(this.seed);
      this.effectsManager.reset(this.seed);
      this.actorManager.reset(this.seed);
      this.eventSystem.reset();
      this.physicsMotion.reset(this.seed);
      this.memoryState.reset(this.seed);
      this.memoryRenderer.reset();
      this.outerWorldBuilder.reset(this.seed);
      resetGraduationState();

      this.smoothDecay = 0;
      this.smoothVolume = 1;
      this.smoothConstruction = tokenData.isGraduated ? 1 : 0;

      // Reset orbit offset on new token
      this.dragOrbitYaw = 0;
      this.dragOrbitPitch = 0;
    }

    this.currentTokenData = tokenData;
    this.worldState = computeWorldState(tokenData, this.worldState);

    this.targetDecay = this.worldState.decay;
    this.targetVolume = this.worldState.volumeRatio;
    this.targetConstruction = this.worldState.constructionProgress;

    this.memoryState.update(this.worldState);
    this.updateCameraTarget();
  }

  // ─── Camera target (state-driven) ─────────────────────────

  private updateCameraTarget(): void {
    if (!this.worldState) return;

    if (this.worldState.phase === 'construction') {
      this.baseCameraPosition.set(10, 10, 24);
      this.baseLookAt.set(0, 1, 0);
    } else if (this.worldState.showGraduationCelebration) {
      this.baseCameraPosition.set(0, 18, 35);
      this.baseLookAt.set(0, 3, 0);
    } else if (this.worldState.isLegendary) {
      this.baseCameraPosition.set(0, 20, 45);
      this.baseLookAt.set(0, 3, 0);
    } else {
      const tierDistance: Record<string, number> = {
        'keep': 28, 'castle': 32, 'fortress': 38, 'citadel': 44
      };
      const dist = tierDistance[this.worldState.tier] || 32;
      this.baseCameraPosition.set(dist * 0.35, 12, dist);
      this.baseLookAt.set(0, 2, 0);
    }

    if (this.worldState.decay > 0.5) {
      this.cameraShakeIntensity = (this.worldState.decay - 0.5) * 0.3;
    } else {
      this.cameraShakeIntensity = 0;
    }
  }

  // ─── Render loop ──────────────────────────────────────────

  start(): void {
    if (this.animationId !== null) return;
    this.clock.start();
    this.lastTime = performance.now();
    this.renderer.domElement.style.cursor = 'grab';
    this.animate();
  }

  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private animate = (): void => {
    const now = performance.now();
    const deltaTime = Math.min(100, now - this.lastTime);
    this.lastTime = now;
    this.time += deltaTime / 1000;

    this.update(deltaTime);
    this.doRender();

    this.animationId = requestAnimationFrame(this.animate);
  };

  // ─── Update ───────────────────────────────────────────────

  private update(deltaTime: number): void {
    if (!this.worldState) return;

    const lerpFactor = 1 - Math.pow(0.05, deltaTime / 1000);
    this.smoothDecay += (this.targetDecay - this.smoothDecay) * lerpFactor;
    this.smoothVolume += (this.targetVolume - this.smoothVolume) * lerpFactor;
    this.smoothConstruction += (this.targetConstruction - this.smoothConstruction) * lerpFactor;

    this.renderState = {
      ...this.worldState,
      smoothDecay: this.smoothDecay,
      smoothVolume: this.smoothVolume,
      smoothConstruction: this.smoothConstruction,
      time: this.time,
      deltaTime,
      celebrationProgress: getCelebrationProgress()
    };

    // Weather (independent from token state)
    this.weatherState.update(deltaTime);
    const weather = this.weatherState.getRenderState();

    // Day/night (updates sun position, base lighting)
    this.updateDayNightCycle();

    // Camera
    this.updateCamera(deltaTime);

    // Scene elements
    this.castleBuilder.update(this.renderState);
    this.creatureBuilder.update(this.renderState);
    this.environmentBuilder.update(this.renderState, weather);
    this.effectsManager.update(this.renderState, deltaTime);

    // Enhanced systems
    this.actorManager.update(this.renderState);
    this.eventSystem.update(this.renderState, deltaTime);
    this.physicsMotion.update(this.renderState, weather);
    this.memoryRenderer.update(this.memoryState.getMemory());
    this.outerWorldBuilder.update(this.renderState, weather);

    // Weather effects (particles, lightning, ground cover)
    this.weatherEffects.update(weather, deltaTime);

    // Atmosphere (state-driven + weather overlay on top of day/night)
    this.updateAtmosphere(deltaTime, weather);
  }

  // ─── Camera ───────────────────────────────────────────────

  private updateCamera(deltaTime: number): void {
    const lerpFactor = 1 - Math.pow(0.02, deltaTime / 1000);
    const dt = deltaTime / 1000;

    // Start from base target position
    const basePos = this.baseCameraPosition.clone();
    const lookAt = this.baseLookAt.clone();

    // Apply mouse-hold orbit offset around lookAt
    const toCamera = basePos.clone().sub(lookAt);
    const radius = toCamera.length();
    const baseYaw = Math.atan2(toCamera.x, toCamera.z);
    const basePitch = Math.asin(Math.max(-1, Math.min(1, toCamera.y / radius)));

    // If not dragging, slowly return orbit offset to 0 and add idle orbit
    if (!this.isDragging) {
      this.dragOrbitYaw *= 0.97;
      this.dragOrbitPitch *= 0.97;
      if (Math.abs(this.dragOrbitYaw) < 0.001) this.dragOrbitYaw = 0;
      if (Math.abs(this.dragOrbitPitch) < 0.001) this.dragOrbitPitch = 0;
      // Idle orbit when hands-off
      this.cameraIdleOrbitAngle += this.cameraIdleOrbitSpeed * dt;
    }

    const yaw = baseYaw + this.dragOrbitYaw + (this.isDragging ? 0 : Math.sin(this.cameraIdleOrbitAngle) * 0.08);
    const pitch = Math.max(0.05, Math.min(1.2, basePitch + this.dragOrbitPitch));

    const orbitPos = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch) * radius,
      Math.sin(pitch) * radius,
      Math.cos(yaw) * Math.cos(pitch) * radius
    ).add(lookAt);

    // Smooth towards orbit position
    this.camera.position.lerp(orbitPos, this.isDragging ? 0.15 : lerpFactor);

    // Shake
    const eventShake = this.eventSystem.getCameraShake();
    const totalShake = this.cameraShakeIntensity + eventShake;
    if (totalShake > 0.01) {
      const t = this.time * 20;
      this.camera.position.x += Math.sin(t * 1.3) * Math.cos(t * 0.7) * totalShake * 0.15;
      this.camera.position.y += Math.sin(t * 1.7) * Math.cos(t * 1.1) * totalShake * 0.08;
    }

    // Breathing
    this.camera.position.y += Math.sin(this.time * 0.3) * 0.05;

    this.camera.lookAt(lookAt);
  }

  // ─── Atmosphere ───────────────────────────────────────────

  private updateAtmosphere(deltaTime: number, weather?: WeatherRenderState): void {
    if (!this.renderState) return;

    const lerpSpeed = deltaTime / 1000 * 1.5;
    const daylight = this.getDaylightFactor();

    // Base sky from day/night
    const daySky = new THREE.Color(0x87ceeb);
    const nightSky = new THREE.Color(0x0a0e1a);
    const sunriseSky = new THREE.Color(0xffa070);

    let baseSky: THREE.Color;
    if (daylight < 0.15) {
      baseSky = nightSky;
    } else if (daylight < 0.35) {
      const t = (daylight - 0.15) / 0.2;
      baseSky = nightSky.clone().lerp(sunriseSky, t);
    } else if (daylight < 0.5) {
      const t = (daylight - 0.35) / 0.15;
      baseSky = sunriseSky.clone().lerp(daySky, t);
    } else {
      baseSky = daySky;
    }

    // State-driven overrides (blend on top of day/night)
    if (this.renderState.isCursed) {
      this.targetFogColor.set(baseSky).lerp(new THREE.Color(0x2a1a3a), 0.7);
      this.targetFogNear = 10;
      this.targetFogFar = 40;
      this.targetSunIntensity = 0.3;
      this.targetAmbientIntensity = 0.2;
    } else if (this.renderState.isZombie) {
      this.targetFogColor.set(baseSky).lerp(new THREE.Color(0x3a4a3a), 0.6);
      this.targetFogNear = 15;
      this.targetFogFar = 50;
      this.targetSunIntensity = 0.5;
      this.targetAmbientIntensity = 0.3;
    } else if (this.renderState.phase === 'declining') {
      this.targetFogColor.set(baseSky).lerp(new THREE.Color(0x8090a0), 0.4);
      this.targetFogNear = 25;
      this.targetFogFar = 80;
      this.targetSunIntensity = 0.8;
      this.targetAmbientIntensity = 0.35;
    } else if (this.renderState.priceChange24h < -20) {
      this.targetFogColor.set(baseSky).lerp(new THREE.Color(0x5a5a6a), 0.4);
      this.targetFogNear = 20;
      this.targetFogFar = 70;
      this.targetSunIntensity = 0.7;
      this.targetAmbientIntensity = 0.3;
    } else if (this.renderState.phase === 'thriving' && this.renderState.priceChange24h > 10) {
      this.targetFogColor.copy(baseSky);
      this.targetFogNear = 40;
      this.targetFogFar = 120;
      this.targetSunIntensity = 1.4;
      this.targetAmbientIntensity = 0.5;
    } else {
      this.targetFogColor.copy(baseSky);
      this.targetFogNear = 40 + daylight * 20;
      this.targetFogFar = 80 + daylight * 70;
      this.targetSunIntensity = 0.25 + daylight * 1.35;
      this.targetAmbientIntensity = 0.25 + daylight * 0.45;
    }

    // Decay darkens fog
    const decayFog = this.renderState.smoothDecay * 0.5;
    this.targetFogNear -= decayFog * 10;
    this.targetFogFar -= decayFog * 30;
    this.targetSunIntensity *= (1 - this.renderState.smoothDecay * 0.4);
    this.targetAmbientIntensity *= (1 - this.renderState.smoothDecay * 0.3);

    // ─── Weather layer (additive modifier, never overpowers token state) ───
    if (weather) {
      // Rain/storm: darken sky, pull fog closer, dim sun
      const rainDim = weather.rainIntensity * 0.3;
      const stormDim = weather.stormFactor * 0.25;
      this.targetFogColor.lerp(new THREE.Color(0x5a6070), rainDim + stormDim);
      this.targetFogNear -= (rainDim + stormDim) * 15;
      this.targetFogFar -= (rainDim + stormDim) * 30;
      this.targetSunIntensity *= (1 - rainDim - stormDim);
      this.targetAmbientIntensity *= (1 - rainDim * 0.3);

      // Clouds: slightly mute colors
      const cloudDim = weather.cloudiness * 0.15;
      this.targetFogColor.lerp(new THREE.Color(0x8899aa), cloudDim);
      this.targetSunIntensity *= (1 - cloudDim);

      // Snow/cold: cool blue tint
      const coldTint = weather.coldFactor * 0.2 + weather.snowIntensity * 0.15;
      this.targetFogColor.lerp(new THREE.Color(0xc0d8f0), coldTint);
      this.targetAmbientIntensity += coldTint * 0.1; // snow reflects more ambient

      // Heat: warm golden tint, push fog back, increase exposure
      const heatTint = weather.heatFactor * 0.15;
      this.targetFogColor.lerp(new THREE.Color(0xf0d8a0), heatTint);
      this.targetFogFar += weather.heatFactor * 20; // heat = clearer distant views
      this.targetExposure += weather.heatFactor * 0.15;

      // Fog weather: pull fog very close
      if (weather.fogFactor > 0.1) {
        this.targetFogNear -= weather.fogFactor * 20;
        this.targetFogFar -= weather.fogFactor * 40;
        this.targetFogColor.lerp(new THREE.Color(0xb0b8c0), weather.fogFactor * 0.3);
      }
    }

    // Smooth lerp
    this.currentFogColor.lerp(this.targetFogColor, lerpSpeed);
    this.currentFogNear += (this.targetFogNear - this.currentFogNear) * lerpSpeed;
    this.currentFogFar += (this.targetFogFar - this.currentFogFar) * lerpSpeed;
    this.currentSunIntensity += (this.targetSunIntensity - this.currentSunIntensity) * lerpSpeed;
    this.currentAmbientIntensity += (this.targetAmbientIntensity - this.currentAmbientIntensity) * lerpSpeed;
    this.currentExposure += (this.targetExposure - this.currentExposure) * lerpSpeed;

    // Apply
    this.scene.fog = new THREE.Fog(
      this.currentFogColor,
      Math.max(5, this.currentFogNear),
      Math.max(20, this.currentFogFar)
    );
    this.scene.background = this.currentFogColor.clone();
    this.renderer.toneMappingExposure = this.currentExposure;
  }

  // ─── Render ───────────────────────────────────────────────

  private doRender(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // ─── Public API ───────────────────────────────────────────

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  getWorldState(): WorldState | null {
    return this.worldState;
  }

  getWeatherState(): WeatherRenderState {
    return this.weatherState.getRenderState();
  }

  burst(screenX: number, screenY: number, count: number = 20): void {
    const ndc = new THREE.Vector2(
      (screenX / this.width) * 2 - 1,
      -(screenY / this.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const intersects = raycaster.intersectObjects(this.scene.children, true);
    if (intersects.length > 0) {
      this.effectsManager.burst(intersects[0].point, count);
    } else {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const pos = this.camera.position.clone().add(dir.multiplyScalar(10));
      this.effectsManager.burst(pos, count);
    }
  }

  destroy(): void {
    this.stop();

    // Remove event listeners
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    canvas.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);

    // Dispose builders
    this.castleBuilder.dispose();
    this.creatureBuilder.dispose();
    this.environmentBuilder.dispose();
    this.effectsManager.dispose();

    // Dispose systems
    this.actorManager.dispose();
    this.eventSystem.dispose();
    this.physicsMotion.dispose();
    this.memoryRenderer.dispose();
    this.outerWorldBuilder.dispose();
    this.weatherEffects.dispose();

    // Dispose renderer
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
