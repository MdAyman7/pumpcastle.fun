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
import { computeWorldState, computePriceWeather, hashString, seededRandom } from '$lib/state/CastleState';
import { getPriceMoodColor } from '$lib/render/TokenIdentity';
import { computeTimeInfo } from '$lib/state/TimeState';
import type { TimeInfo } from '$lib/state/TimeState';
import { getCelebrationProgress, resetGraduationState } from '$lib/state/GraduationState';
import { MemoryState } from '$lib/state/MemoryState';
import { WeatherState } from '$lib/state/WeatherState';
import type { WeatherRenderState } from '$lib/state/WeatherState';
import { CastleMeshBuilder } from './CastleMeshBuilder';
import { EnvironmentBuilder } from './EnvironmentBuilder';
import { EffectsManager } from './EffectsManager';
import { ActorManager } from './ActorManager';
import { EventSystem } from './EventSystem';
import { PhysicsMotion } from './PhysicsMotion';
import { MemoryRenderer } from './MemoryRenderer';
import { OuterWorldBuilder } from './OuterWorldBuilder';
import { WeatherEffects } from './WeatherEffects';
import { qualitySettings } from './QualitySettings';
import type { QualityConfig } from './QualitySettings';
import { getMusicManager } from '$lib/audio/MusicManager';
import type { MusicManager } from '$lib/audio/MusicManager';

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
  private musicManager: MusicManager;

  // Lighting
  private sunLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  private moonLight!: THREE.DirectionalLight;

  // Castle-focused lights (make castle pop against environment)
  private castleKeyLight!: THREE.SpotLight;
  private castleRimLight!: THREE.DirectionalLight;

  // Sky dome + atmosphere
  private skyDome!: THREE.Mesh;
  private skyDomeColors!: Float32Array; // vertex color buffer
  private cloudGroup!: THREE.Group;
  private cloudMeshes: THREE.Mesh[] = [];
  private hazeMesh!: THREE.Mesh;
  private hazeMaterial!: THREE.MeshBasicMaterial;

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
  private targetPopulation: number = 0;
  private smoothDecay: number = 0;
  private smoothVolume: number = 0;
  private smoothConstruction: number = 0;
  private smoothPopulation: number = 0;

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
  private currentSunIntensity: number = 1.8;
  private targetSunIntensity: number = 1.8;
  private currentAmbientIntensity: number = 0.7;
  private targetAmbientIntensity: number = 0.7;

  // Day / night (0-1 where 0=midnight, 0.5=noon)
  private dayPhase: number = 0.5;
  private currentExposure: number = 1.0;
  private targetExposure: number = 1.0;

  // Quality system
  private qualityConfig: QualityConfig;
  private frameCount: number = 0;
  private lastSkyDaylight: number = -1; // cache sky dome updates

  // Performance safeguard — dynamic FPS-based quality scaling
  private fpsHistory: number[] = [];
  private performanceScale: number = 1.0; // 1 = full quality, 0 = minimum

  // Reusable fog object (avoid creating new THREE.Fog every frame)
  private fog: THREE.Fog;

  // Seed
  private seed: number = 12345;

  // Scene readiness (prevents showing incomplete frames during token switch)
  private sceneReady: boolean = false;
  private framesAfterNewToken: number = 0;
  private static readonly FRAMES_UNTIL_READY = 3;

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
    this.qualityConfig = qualitySettings.getConfig();

    // Renderer — quality-aware
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.qualityConfig.antialias,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.qualityConfig.pixelRatio));
    this.renderer.shadowMap.enabled = this.qualityConfig.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // Scene — no flat background color; sky dome handles the sky
    this.scene = new THREE.Scene();

    // Camera – wider FOV to see more of the world
    this.camera = new THREE.PerspectiveCamera(55, this.width / this.height, 0.1, 1000);
    this.baseCameraPosition = new THREE.Vector3(0, 12, 32);
    this.baseLookAt = new THREE.Vector3(0, 2, 0);
    this.camera.position.copy(this.baseCameraPosition);
    this.camera.lookAt(this.baseLookAt);

    // Atmosphere
    this.currentFogColor = new THREE.Color(0x87ceeb);
    this.targetFogColor = new THREE.Color(0x87ceeb);
    this.currentSunColor = new THREE.Color(0xfff4e0);
    this.targetSunColor = new THREE.Color(0xfff4e0);

    // Reusable fog object (mutated each frame, no allocation)
    this.fog = new THREE.Fog(0x87ceeb, 30, 100);
    this.scene.fog = this.fog;

    // Lighting
    this.setupLighting();

    // Sky dome + atmosphere
    this.buildSkyDome();
    this.buildClouds();
    this.buildHaze();

    // Builders
    this.castleBuilder = new CastleMeshBuilder(this.scene, this.seed);
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
    this.musicManager = getMusicManager();

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

  /**
   * Compute an "evening factor" that peaks during golden hour.
   * 0 = not evening, 1 = peak golden hour.
   * Golden hour: daylight ≈ 0.15–0.40 (sunrise/sunset transition zone).
   */
  private getEveningFactor(): number {
    const daylight = this.getDaylightFactor();
    // Peak at daylight = 0.25, taper off both sides
    if (daylight < 0.10 || daylight > 0.50) return 0;
    if (daylight < 0.25) return (daylight - 0.10) / 0.15; // ramp up
    return 1 - (daylight - 0.25) / 0.25; // ramp down
  }

  /** Apply day/night to sun light position & base atmosphere */
  private updateDayNightCycle(): void {
    // Refresh every frame from real clock (low cost)
    this.dayPhase = this.computeDayPhase();

    const sunAngle = this.getSunAngle();
    const daylight = this.getDaylightFactor();
    const nightFactor = 1 - daylight;
    const eveningFactor = this.getEveningFactor();

    // Position the directional sun light on an arc
    const sunDist = 25;
    const sunY = Math.sin(sunAngle) * sunDist;
    const sunZ = Math.cos(sunAngle) * sunDist * 0.6;
    this.sunLight.position.set(10, Math.max(1, sunY), sunZ);

    // Sun intensity — bright and dominant at noon, warm glow during evening, soft fill at night
    // Night: 0.65 (cinematic — clearly readable terrain, not pitch black)
    // Noon: 2.5 (vibrant — ACES tonemapping compresses gracefully)
    const baseSunIntensity = 0.65 + daylight * 1.85;
    this.sunLight.intensity = baseSunIntensity;

    // Sun color shifts: warm golden during evening, cool-warm at night, white midday
    if (daylight < 0.10) {
      // Deep night: soft blue-silver (cinematic moonlit ambiance, not dark indigo)
      this.sunLight.color.setHex(0x5a6a90);
    } else if (daylight < 0.20) {
      // Late dusk / early dawn: deep warm transition
      const t = (daylight - 0.10) / 0.10;
      this.sunLight.color.setHex(0x5a6a90).lerp(new THREE.Color(0xff8040), t);
    } else if (daylight < 0.40) {
      // Golden hour: rich amber → warm sunny white
      const t = (daylight - 0.20) / 0.20;
      this.sunLight.color.setHex(0xff8040).lerp(new THREE.Color(0xfff4e0), t);
    } else {
      // Daytime: warm sunny white (slight yellow tint — pleasant afternoon feel)
      this.sunLight.color.setHex(0xfff4e0);
    }

    // Evening warmth boost: during golden hour, push sun color warmer
    if (eveningFactor > 0) {
      this.sunLight.color.lerp(new THREE.Color(0xFFB060), eveningFactor * 0.35);
    }

    // Moon light — cool blue-silver fill for clearly readable nights
    // Wide and high for maximum terrain coverage. Intensity scaled to
    // ensure distant hills catch enough light to remain visible.
    this.moonLight.color.setHex(0x8098cc);
    this.moonLight.intensity = nightFactor * 1.0;
    // Very high position + wide offset = broad moonlight wash across whole scene
    this.moonLight.position.set(-15, 28, -6);

    // Ambient — lifts shadows without flattening. Higher during day.
    // 0.60 at night → 0.90 at noon (strong night ambient = no black terrain)
    this.ambientLight.intensity = 0.60 + daylight * 0.30;

    // Ambient color: cool blue at night (cinematic), warm-neutral during day
    if (eveningFactor > 0) {
      this.ambientLight.color.setHex(0x708090).lerp(
        new THREE.Color(0x907060), eveningFactor * 0.4
      );
    } else if (nightFactor > 0.5) {
      // Night: cool blue ambient — everything gets soft blue fill
      // This is the key to readable nights: strong cool-toned ambient
      const nightBlueness = (nightFactor - 0.5) / 0.5;
      this.ambientLight.color.setHex(0x708090).lerp(
        new THREE.Color(0x6878a8), nightBlueness * 0.5
      );
    } else if (daylight > 0.5) {
      // Clear daytime: warm sky-bounce ambient (not cold blue-grey)
      this.ambientLight.color.setHex(0x708090).lerp(
        new THREE.Color(0x95907a), (daylight - 0.5) / 0.5 * 0.4
      );
    } else {
      this.ambientLight.color.setHex(0x708090);
    }

    // Hemi sky color — richer transitions
    const dayColor = new THREE.Color(0x87ceeb);
    const nightColor = new THREE.Color(0x384868); // moonlit blue (sky contributes real light)
    const sunriseColor = new THREE.Color(0xffa070);
    const eveningColor = new THREE.Color(0xE8A060); // warm golden sky
    let skyColor: THREE.Color;
    if (daylight < 0.10) {
      skyColor = nightColor;
    } else if (daylight < 0.25) {
      const t = (daylight - 0.10) / 0.15;
      skyColor = nightColor.clone().lerp(sunriseColor, t);
    } else if (daylight < 0.45) {
      const t = (daylight - 0.25) / 0.20;
      skyColor = sunriseColor.clone().lerp(dayColor, t);
    } else {
      skyColor = dayColor;
    }
    // Warm golden overlay during evening
    if (eveningFactor > 0) {
      skyColor.lerp(eveningColor, eveningFactor * 0.3);
    }
    this.hemiLight.color.copy(skyColor);

    // Hemi intensity scales with daylight — strong sky bounce at all times.
    // The hemisphere light IS the sky illumination on terrain — at night, the
    // sky color (blue) paints everything with cool ambient light. This is the
    // single most important light for preventing black terrain at night.
    // 0.50 at night → 0.90 at noon
    this.hemiLight.intensity = 0.50 + daylight * 0.40;

    // Hemi ground color — at night, ground bounce is cool blue-grey (moonlit earth).
    // Brighter ground color = upward fill that lifts undersides of hills/trees.
    const dayGround = new THREE.Color(0x5a7a50); // brighter green ground bounce
    const nightGround = new THREE.Color(0x304858); // cool blue-grey (visible uplight)
    this.hemiLight.groundColor.copy(dayGround).lerp(nightGround, nightFactor);

    // Target exposure — bright and clear during day, readable at night
    // Day peak: 1.75 (vibrant — ACES tonemapping compresses highlights gracefully)
    // Night floor: 0.95 (cinematic — ACES needs high input to stay readable)
    this.targetExposure = 0.95 + daylight * 0.80 + eveningFactor * 0.08;

    // ── Castle-focused lights ──────────────────────────────────
    // The castle is the visual anchor. At night it should GLOW like
    // a landmark — warm key light creates the "inhabited" feeling,
    // strong rim light ensures the silhouette pops against the sky.
    //
    // Key light: warm spotlight aimed at castle center.
    // Day: 0.95 warm-white (castle pops against grass)
    // Night: 0.60 warm amber (castle is brightest thing in scene)
    // Evening: warm golden boost
    const castleKeyBase = 0.60 + daylight * 0.35;
    this.castleKeyLight.intensity = castleKeyBase + eveningFactor * 0.15;

    // Key light color: warm white during day, rich warm amber at night.
    // The night color is deliberately warm — contrasts with cool moonlight
    // on the surrounding terrain, making the castle the obvious focal point.
    if (daylight > 0.4) {
      this.castleKeyLight.color.setHex(0xfff8ee); // warm white
    } else if (eveningFactor > 0) {
      this.castleKeyLight.color.setHex(0xfff8ee).lerp(
        new THREE.Color(0xffc870), eveningFactor * 0.3
      );
    } else {
      // Night: rich warm amber — castle glows warmly against cool blues
      this.castleKeyLight.color.setHex(0xffd890).lerp(
        new THREE.Color(0xfff8ee), daylight * 3
      );
    }

    // Rim light: creates edge separation so castle silhouette is clear.
    // AT NIGHT: the rim light is STRONGER than during the day.
    // The moonlit edge highlight makes the castle pop against the night sky.
    // This is the subtle "magic outline" that makes the castle look special.
    //
    // Day: 0.40 (clear edge definition against green terrain)
    // Night: 0.50 (strong moonlit rim — castle silhouette always pops)
    // Evening: warmer, golden edge glow
    const rimBase = 0.50 - daylight * 0.10; // INVERTED: stronger at night!
    this.castleRimLight.intensity = rimBase + eveningFactor * 0.10;

    if (daylight > 0.4) {
      // Daytime: cool sky-bounce backlight (lifts edges without yellowing)
      this.castleRimLight.color.setHex(0xc0d8f0);
    } else if (eveningFactor > 0) {
      // Evening: warm golden edge
      this.castleRimLight.color.setHex(0xc0d8f0).lerp(
        new THREE.Color(0xf0c888), eveningFactor * 0.4
      );
    } else if (nightFactor > 0.3) {
      // Night: bright cool-silver with subtle blue — moonlit magic outline
      const nightEdge = (nightFactor - 0.3) / 0.7;
      this.castleRimLight.color.setHex(0xa0b8d8).lerp(
        new THREE.Color(0xb0c8e8), nightEdge * 0.5
      );
    } else {
      this.castleRimLight.color.setHex(0xc0d8f0);
    }
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
    // Ambient: warm-neutral fill, lifts shadows without flattening
    this.ambientLight = new THREE.AmbientLight(0x708090, 0.7);
    this.scene.add(this.ambientLight);

    // Sun – warm sunny white, dominant directional light
    // Shadow quality scales with device capability
    const qc = this.qualityConfig;
    this.sunLight = new THREE.DirectionalLight(0xfff4e0, 1.8);
    this.sunLight.position.set(15, 25, 12);
    this.sunLight.castShadow = qc.shadowsEnabled;
    this.sunLight.shadow.mapSize.width = qc.shadowMapSize;
    this.sunLight.shadow.mapSize.height = qc.shadowMapSize;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 60;
    this.sunLight.shadow.camera.left = -qc.shadowCameraRange;
    this.sunLight.shadow.camera.right = qc.shadowCameraRange;
    this.sunLight.shadow.camera.top = qc.shadowCameraRange;
    this.sunLight.shadow.camera.bottom = -qc.shadowCameraRange;
    this.sunLight.shadow.bias = -0.0001;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);

    // Hemisphere: sky/ground bounce fill — bright day, dim night
    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x5a7a50, 0.6);
    this.scene.add(this.hemiLight);

    // Moonlight
    this.moonLight = new THREE.DirectionalLight(0x4466aa, 0);
    this.moonLight.position.set(-10, 15, -10);
    this.scene.add(this.moonLight);

    // ── Castle-focused lights ──────────────────────────────────
    // These give the castle extra visual weight vs the environment.
    // The key light is a tight spotlight aimed at the castle center,
    // adding ~25% more illumination than the surrounding terrain receives.
    // The rim light comes from behind/above to give edge separation.

    // Castle key light: warm spotlight from slightly in front and above
    this.castleKeyLight = new THREE.SpotLight(0xfff8ee, 0, 40);
    this.castleKeyLight.position.set(5, 22, 18);
    this.castleKeyLight.target.position.set(0, 4, 0); // castle center
    this.castleKeyLight.angle = Math.PI / 6; // 30° cone — covers castle area
    this.castleKeyLight.penumbra = 0.8;       // very soft falloff
    this.castleKeyLight.decay = 1.5;
    this.castleKeyLight.castShadow = false;   // main sun already casts shadows
    this.scene.add(this.castleKeyLight);
    this.scene.add(this.castleKeyLight.target);

    // Castle rim/back light: cool-warm directional from behind
    // Creates edge definition so the castle silhouette reads clearly
    this.castleRimLight = new THREE.DirectionalLight(0xc0d8f0, 0);
    this.castleRimLight.position.set(-8, 16, -14); // behind and above
    this.castleRimLight.target.position.set(0, 4, 0);
    this.castleRimLight.castShadow = false;
    this.scene.add(this.castleRimLight);
    this.scene.add(this.castleRimLight.target);
  }

  // ─── Sky dome ────────────────────────────────────────────

  /**
   * Build a large inverted sphere as the sky dome.
   * Uses vertex colors for a smooth gradient:
   *   Zenith  → deeper blue (rich sky overhead)
   *   Mid-sky → standard sky blue
   *   Horizon → warm, lighter (atmospheric scattering)
   *
   * The dome is enormous (radius 300) so it always surrounds the world.
   * BackSide rendering so the inside is visible.
   */
  private buildSkyDome(): void {
    const radius = 300;
    const widthSegments = 32;
    const heightSegments = 16;
    const geom = new THREE.SphereGeometry(radius, widthSegments, heightSegments);

    // Vertex colors: gradient based on vertical position (y-normalized)
    const positions = geom.attributes.position;
    const vertexCount = positions.count;
    this.skyDomeColors = new Float32Array(vertexCount * 3);

    // Default: daytime palette (will be updated per frame)
    const zenithColor = new THREE.Color(0x5a9ad7);   // vibrant blue overhead
    const midColor = new THREE.Color(0x87ceeb);       // standard sky blue
    const horizonColor = new THREE.Color(0xc8dce8);   // warm, pale (atmospheric)
    const belowColor = new THREE.Color(0x90a8b8);     // muted below-horizon

    for (let i = 0; i < vertexCount; i++) {
      const y = positions.getY(i);
      // Normalize: 1 = top (zenith), 0 = equator (horizon), negative = below
      const normalizedY = y / radius;

      let c: THREE.Color;
      if (normalizedY > 0.6) {
        // Upper sky: zenith color
        c = zenithColor.clone();
      } else if (normalizedY > 0.15) {
        // Mid to upper sky: blend zenith → mid
        const t = (normalizedY - 0.15) / 0.45;
        c = midColor.clone().lerp(zenithColor, t);
      } else if (normalizedY > -0.05) {
        // Horizon band: blend mid → warm horizon
        const t = (normalizedY + 0.05) / 0.20;
        c = horizonColor.clone().lerp(midColor, t);
      } else {
        // Below horizon: muted
        const t = Math.max(0, (normalizedY + 0.5) / 0.45);
        c = belowColor.clone().lerp(horizonColor, t);
      }

      this.skyDomeColors[i * 3] = c.r;
      this.skyDomeColors[i * 3 + 1] = c.g;
      this.skyDomeColors[i * 3 + 2] = c.b;
    }

    geom.setAttribute('color', new THREE.BufferAttribute(this.skyDomeColors, 3));

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,           // sky dome is not fogged
      depthWrite: false,    // render behind everything
    });

    this.skyDome = new THREE.Mesh(geom, mat);
    this.skyDome.renderOrder = -100; // render first
    this.scene.add(this.skyDome);
  }

  /**
   * Build a set of cloud planes at various altitudes.
   * Uses large, semi-transparent, billboard-like planes with soft edges.
   * Clouds are subtle — they add depth and scale, not drama.
   */
  private buildClouds(): void {
    this.cloudGroup = new THREE.Group();
    this.cloudGroup.name = 'clouds';

    // Cloud definitions: position, size, rotation, opacity
    const allCloudDefs = [
      // High, wispy clouds (cirrus-like)
      { x: -60, y: 55, z: -80, w: 50, h: 12, rot: 0.2, opacity: 0.12 },
      { x: 40, y: 60, z: -100, w: 65, h: 15, rot: -0.15, opacity: 0.10 },
      { x: -20, y: 65, z: -120, w: 80, h: 10, rot: 0.08, opacity: 0.08 },
      { x: 80, y: 50, z: -70, w: 45, h: 14, rot: 0.3, opacity: 0.11 },
      // Mid-level clouds
      { x: -90, y: 40, z: -60, w: 55, h: 16, rot: -0.1, opacity: 0.13 },
      { x: 60, y: 45, z: -90, w: 60, h: 13, rot: 0.25, opacity: 0.10 },
      { x: 0, y: 48, z: -110, w: 70, h: 11, rot: -0.05, opacity: 0.09 },
      // Distant horizon clouds
      { x: -40, y: 30, z: -140, w: 90, h: 18, rot: 0.02, opacity: 0.14 },
      { x: 50, y: 28, z: -130, w: 75, h: 20, rot: -0.08, opacity: 0.12 },
      { x: -100, y: 35, z: -110, w: 60, h: 14, rot: 0.12, opacity: 0.11 },
    ];

    // Quality-aware: only render configured number of clouds
    const cloudDefs = allCloudDefs.slice(0, this.qualityConfig.cloudCount);

    for (const def of cloudDefs) {
      const geom = new THREE.PlaneGeometry(def.w, def.h);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: def.opacity,
        fog: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const cloud = new THREE.Mesh(geom, mat);
      cloud.position.set(def.x, def.y, def.z);
      cloud.rotation.x = -0.15; // tilt slightly to face camera area
      cloud.rotation.z = def.rot;
      cloud.renderOrder = -90; // after sky dome, before scene
      this.cloudGroup.add(cloud);
      this.cloudMeshes.push(cloud);
    }

    this.scene.add(this.cloudGroup);
  }

  /**
   * Build a horizon haze ring — a large translucent cylinder near the ground
   * that simulates atmospheric scattering / haze at the horizon line.
   * Gives the impression of depth and distance.
   */
  private buildHaze(): void {
    // Thin cylinder ring at the horizon
    const geom = new THREE.CylinderGeometry(180, 200, 25, 32, 1, true);
    this.hazeMaterial = new THREE.MeshBasicMaterial({
      color: 0xc8dce8,
      transparent: true,
      opacity: 0.08,
      fog: false,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.hazeMesh = new THREE.Mesh(geom, this.hazeMaterial);
    this.hazeMesh.position.y = 5; // slightly above ground
    this.hazeMesh.renderOrder = -80;
    this.scene.add(this.hazeMesh);
  }

  /**
   * Update sky dome vertex colors, cloud appearance, and haze based on
   * daylight factor, evening factor, and weather conditions.
   * OPTIMIZED: sky dome vertex colors only update when daylight changes
   * beyond a threshold OR on a throttled interval. Clouds/haze update
   * every frame (cheap — just opacity/color sets).
   */
  private updateSky(weather?: WeatherRenderState): void {
    const daylight = this.getDaylightFactor();
    const nightFactor = 1 - daylight;
    const eveningFactor = this.getEveningFactor();
    const skyInterval = this.qualityConfig.skyUpdateInterval;

    // Determine if we need to update sky dome vertex colors this frame
    const daylightChanged = Math.abs(daylight - this.lastSkyDaylight) > 0.005;
    const shouldUpdateSkyDome = daylightChanged ||
      qualitySettings.shouldUpdateThisFrame(this.frameCount, skyInterval);

    // ─── Sky dome gradient colors by time of day ─────────────
    // Day: blue zenith → pale horizon
    // Night: deep navy → dark blue-grey horizon
    // Evening/dawn: warm amber/orange tones blended in

    let zenith: THREE.Color;
    let mid: THREE.Color;
    let horizon: THREE.Color;
    let below: THREE.Color;

    if (daylight < 0.10) {
      // Night: soft deep blues (cinematic — never pure black)
      // Brighter than realistic so terrain/trees read as silhouettes
      zenith = new THREE.Color(0x101830);
      mid = new THREE.Color(0x182440);
      horizon = new THREE.Color(0x283850);
      below = new THREE.Color(0x141e35);
    } else if (daylight < 0.25) {
      // Dawn/dusk transition — starting colors match night sky dome values
      const t = (daylight - 0.10) / 0.15;
      zenith = new THREE.Color(0x101830).lerp(new THREE.Color(0x2a4a7a), t);
      mid = new THREE.Color(0x182440).lerp(new THREE.Color(0xd08858), t);
      horizon = new THREE.Color(0x283850).lerp(new THREE.Color(0xf0a868), t);
      below = new THREE.Color(0x141e35).lerp(new THREE.Color(0xc89060), t);
    } else if (daylight < 0.45) {
      // Sunrise/sunset → day transition
      const t = (daylight - 0.25) / 0.20;
      zenith = new THREE.Color(0x2a4a7a).lerp(new THREE.Color(0x5a9ad7), t);
      mid = new THREE.Color(0xd08858).lerp(new THREE.Color(0x87ceeb), t);
      horizon = new THREE.Color(0xf0a868).lerp(new THREE.Color(0xc8dce8), t);
      below = new THREE.Color(0xc89060).lerp(new THREE.Color(0x90a8b8), t);
    } else {
      // Full day
      zenith = new THREE.Color(0x5a9ad7);
      mid = new THREE.Color(0x87ceeb);
      horizon = new THREE.Color(0xc8dce8);
      below = new THREE.Color(0x90a8b8);
    }

    // Evening golden hour warm tint
    if (eveningFactor > 0) {
      zenith.lerp(new THREE.Color(0x6a5a80), eveningFactor * 0.2);
      mid.lerp(new THREE.Color(0xd0a060), eveningFactor * 0.25);
      horizon.lerp(new THREE.Color(0xf0b868), eveningFactor * 0.35);
      below.lerp(new THREE.Color(0xd0a060), eveningFactor * 0.3);
    }

    // Weather overlays on sky colors
    if (weather) {
      // Clouds: slightly grey out the sky
      if (weather.cloudiness > 0.2) {
        const cloudGrey = weather.cloudiness * 0.25;
        const greyColor = new THREE.Color(0x8899aa);
        zenith.lerp(greyColor, cloudGrey);
        mid.lerp(greyColor, cloudGrey);
        horizon.lerp(greyColor, cloudGrey * 0.7);
      }
      // Rain: darken sky significantly
      if (weather.rainIntensity > 0.1) {
        const rainDark = weather.rainIntensity * 0.3;
        const stormColor = new THREE.Color(0x4a5060);
        zenith.lerp(stormColor, rainDark);
        mid.lerp(stormColor, rainDark);
        horizon.lerp(new THREE.Color(0x6a7080), rainDark);
      }
      // Cold/snow: cool blue wash
      if (weather.coldFactor > 0.2) {
        const coolTint = weather.coldFactor * 0.15;
        zenith.lerp(new THREE.Color(0x5a7aaa), coolTint);
        horizon.lerp(new THREE.Color(0xc0d8f0), coolTint);
      }
      // Heat: warm golden sky
      if (weather.heatFactor > 0.1) {
        const heatTint = weather.heatFactor * 0.12;
        zenith.lerp(new THREE.Color(0x6a8aaa), heatTint);
        mid.lerp(new THREE.Color(0xa0c0c0), heatTint);
        horizon.lerp(new THREE.Color(0xf0d8a8), heatTint);
      }
    }

    // Write vertex colors (only when needed — throttled by quality setting)
    if (shouldUpdateSkyDome) {
      this.lastSkyDaylight = daylight;
      const positions = this.skyDome.geometry.attributes.position;
      const colors = this.skyDome.geometry.attributes.color;
      const vertexCount = positions.count;
      const radius = 300;

      for (let i = 0; i < vertexCount; i++) {
        const y = positions.getY(i);
        const normalizedY = y / radius;

        let c: THREE.Color;
        if (normalizedY > 0.6) {
          c = zenith.clone();
        } else if (normalizedY > 0.15) {
          const t = (normalizedY - 0.15) / 0.45;
          c = mid.clone().lerp(zenith, t);
        } else if (normalizedY > -0.05) {
          const t = (normalizedY + 0.05) / 0.20;
          c = horizon.clone().lerp(mid, t);
        } else {
          const t = Math.max(0, (normalizedY + 0.5) / 0.45);
          c = below.clone().lerp(horizon, t);
        }

        colors.setXYZ(i, c.r, c.g, c.b);
      }
      colors.needsUpdate = true;
    }

    // ─── Cloud opacity and color by time of day ─────────────
    for (let i = 0; i < this.cloudMeshes.length; i++) {
      const cloud = this.cloudMeshes[i];
      const mat = cloud.material as THREE.MeshBasicMaterial;
      const baseDef = [0.12, 0.10, 0.08, 0.11, 0.13, 0.10, 0.09, 0.14, 0.12, 0.11];
      let baseOpacity = baseDef[i] || 0.10;

      // Night: clouds barely visible (just faint silhouettes)
      baseOpacity *= (0.15 + daylight * 0.85);

      // Evening: warm-tinted clouds, slightly brighter
      if (eveningFactor > 0) {
        mat.color.setHex(0xffffff).lerp(new THREE.Color(0xf0c080), eveningFactor * 0.4);
        baseOpacity *= (1 + eveningFactor * 0.3);
      } else if (nightFactor > 0.5) {
        mat.color.setHex(0x8090a0); // muted blue-grey at night
      } else {
        mat.color.setHex(0xffffff);
      }

      // Weather: more clouds = higher opacity
      if (weather && weather.cloudiness > 0.2) {
        baseOpacity += weather.cloudiness * 0.08;
      }

      mat.opacity = Math.min(0.25, baseOpacity);

      // Gentle cloud drift animation
      cloud.position.x += Math.sin(this.time * 0.02 + i * 1.5) * 0.003;
    }

    // ─── Horizon haze ─────────────────────────────────────────
    // Haze is strongest during day (atmospheric scattering), faint at night
    let hazeOpacity = 0.08 * daylight;

    // Evening: warmer haze
    if (eveningFactor > 0) {
      this.hazeMaterial.color.setHex(0xc8dce8).lerp(
        new THREE.Color(0xf0c888), eveningFactor * 0.4
      );
      hazeOpacity += eveningFactor * 0.04;
    } else if (nightFactor > 0.5) {
      this.hazeMaterial.color.setHex(0x1a2030);
      hazeOpacity = 0.03 * (1 - nightFactor * 0.5);
    } else {
      this.hazeMaterial.color.setHex(0xc8dce8);
    }

    // Weather: fog increases haze dramatically
    if (weather) {
      if (weather.fogFactor > 0.1) {
        hazeOpacity += weather.fogFactor * 0.12;
        this.hazeMaterial.color.lerp(new THREE.Color(0xb0b8c0), weather.fogFactor * 0.5);
      }
      if (weather.rainIntensity > 0.1) {
        hazeOpacity += weather.rainIntensity * 0.04;
      }
      // Heat shimmer: warmer haze
      if (weather.heatFactor > 0.1) {
        this.hazeMaterial.color.lerp(new THREE.Color(0xf0d8a8), weather.heatFactor * 0.2);
        hazeOpacity += weather.heatFactor * 0.03;
      }
    }

    this.hazeMaterial.opacity = Math.min(0.22, hazeOpacity);
  }

  // ─── Token data ──────────────────────────────────────────

  setTokenData(tokenData: TokenData): void {
    const isNewToken = !this.currentTokenData ||
      this.currentTokenData.address !== tokenData.address;

    if (isNewToken) {
      this.seed = hashString(tokenData.address);
      this.castleBuilder.reset(this.seed);
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
      this.smoothPopulation = 0;

      // Reset orbit offset on new token
      this.dragOrbitYaw = 0;
      this.dragOrbitPitch = 0;

      // Scene not ready until castle is built and camera settled
      this.sceneReady = false;
      this.framesAfterNewToken = 0;
    }

    this.currentTokenData = tokenData;
    this.worldState = computeWorldState(tokenData, this.worldState);

    this.targetDecay = this.worldState.decay;
    this.targetVolume = this.worldState.volumeRatio;
    this.targetConstruction = this.worldState.constructionProgress;
    this.targetPopulation = this.worldState.populationDensity;

    // Rebuild trees with road exclusion zones based on current state
    if (isNewToken) {
      this.environmentBuilder.addTrees(this.worldState.tier, this.worldState.isLegendary);
    }

    this.memoryState.update(this.worldState);

    // Feed price-driven weather into the weather system
    const priceWeather = computePriceWeather(
      tokenData.priceChange1h ?? tokenData.priceChange24h * 0.3, // fallback: 30% of 24h as 1h estimate
      tokenData.priceChange24h,
      tokenData.high24 ?? tokenData.marketCap * (1 + Math.abs(tokenData.priceChange24h) / 100), // estimate from change
      tokenData.low24  ?? tokenData.marketCap * (1 - Math.abs(tokenData.priceChange24h) / 100), // estimate from change
    );
    this.weatherState.setPriceWeather(priceWeather);

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
        'hut': 22, 'cottage': 24, 'tower': 26, 'keep': 28,
        'manor': 30, 'castle': 32, 'stronghold': 35, 'fortress': 38,
        'palace': 40, 'citadel': 44, 'empire': 48, 'legend': 52
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

  /** Pause rendering loop without destroying the scene. */
  pause(): void {
    this.stop();
  }

  /** Resume rendering loop after a pause. */
  resume(): void {
    this.start();
  }

  private animate = (): void => {
    const now = performance.now();
    const deltaTime = Math.min(100, now - this.lastTime);
    this.lastTime = now;
    this.time += deltaTime / 1000;
    this.frameCount++;

    // ── Performance safeguard: track FPS and auto-scale quality ──
    if (deltaTime > 0) {
      const fps = 1000 / deltaTime;
      this.fpsHistory.push(fps);
      if (this.fpsHistory.length > 60) this.fpsHistory.shift(); // rolling 60-frame window

      // Every 30 frames, evaluate performance and adjust scale
      if (this.frameCount % 30 === 0 && this.fpsHistory.length >= 30) {
        const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
        let targetScale = this.performanceScale;

        if (avgFps < 24) {
          // Critical: aggressively reduce quality
          targetScale = Math.max(0.2, this.performanceScale - 0.15);
        } else if (avgFps < 35) {
          // Low: gradually reduce
          targetScale = Math.max(0.4, this.performanceScale - 0.05);
        } else if (avgFps > 50 && this.performanceScale < 1.0) {
          // Headroom: gradually restore quality
          targetScale = Math.min(1.0, this.performanceScale + 0.03);
        }

        // Smooth transition (invisible to user)
        this.performanceScale += (targetScale - this.performanceScale) * 0.3;
      }
    }

    // ── Light LOD: scale castle lights by camera distance ──
    const cameraDist = this.camera.position.length();
    this.castleBuilder.setLightLOD(cameraDist);
    if (this.performanceScale < 0.95) {
      this.castleBuilder.applyPerformanceScale(this.performanceScale);
    }

    // Track scene readiness after new token
    if (!this.sceneReady && this.worldState) {
      this.framesAfterNewToken++;
      if (this.framesAfterNewToken >= WorldRenderer3D.FRAMES_UNTIL_READY) {
        this.sceneReady = true;
      }
    }

    // During warm-up: push fog very close to hide incomplete geometry,
    // and snap camera to target instead of lerping from a stale position
    if (!this.sceneReady && this.worldState) {
      this.fog.near = 0;
      this.fog.far = 5;
      // Snap camera to target position immediately (no smooth lerp)
      this.camera.position.copy(this.baseCameraPosition);
      this.camera.lookAt(this.baseLookAt);
    }

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
    this.smoothPopulation += (this.targetPopulation - this.smoothPopulation) * lerpFactor;

    // Post-graduation: construction is permanently locked at 100%.
    // Higher tiers always appear fully built — only decay affects them.
    if (this.worldState.hasGraduated) {
      this.smoothConstruction = 1;
    } else {
      this.smoothConstruction += (this.targetConstruction - this.smoothConstruction) * lerpFactor;
    }

    this.renderState = {
      ...this.worldState,
      smoothDecay: this.smoothDecay,
      smoothVolume: this.smoothVolume,
      smoothConstruction: this.smoothConstruction,
      smoothPopulation: this.smoothPopulation,
      time: this.time,
      deltaTime,
      celebrationProgress: getCelebrationProgress(),
      dayPhase: this.dayPhase,
      nightFactor: 1 - this.getDaylightFactor(),
      eveningFactor: this.getEveningFactor(),
    };

    // Weather (driven by token price data, smoothly interpolated each frame)
    this.weatherState.update(deltaTime);
    const weather = this.weatherState.getRenderState();

    // Day/night (updates sun position, base lighting)
    this.updateDayNightCycle();

    // Camera
    this.updateCamera(deltaTime);

    // Scene elements — always update (castle is focal point)
    this.castleBuilder.update(this.renderState);
    this.effectsManager.update(this.renderState, deltaTime);

    // Environment — trees/hills throttled by quality level
    const qc = this.qualityConfig;
    if (qualitySettings.shouldUpdateThisFrame(this.frameCount, qc.hillUpdateInterval)) {
      this.environmentBuilder.update(this.renderState, weather);
    }

    // Enhanced systems — throttle non-critical actors
    if (qualitySettings.shouldUpdateThisFrame(this.frameCount, qc.actorUpdateInterval)) {
      this.actorManager.update(this.renderState);
    }
    this.eventSystem.update(this.renderState, deltaTime);
    this.musicManager.update(this.renderState);
    this.physicsMotion.update(this.renderState, weather);
    this.memoryRenderer.update(this.memoryState.getMemory());
    if (qualitySettings.shouldUpdateThisFrame(this.frameCount, qc.actorUpdateInterval)) {
      this.outerWorldBuilder.update(this.renderState, weather);
    }

    // Weather effects — throttled on lower quality
    if (qualitySettings.shouldUpdateThisFrame(this.frameCount, qc.weatherEffectsInterval)) {
      this.weatherEffects.update(weather, deltaTime);
    }

    // Sky dome + clouds + haze (visual sky gradient, syncs with time/weather)
    this.updateSky(weather);

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
    const nightFactor = 1 - daylight;
    const eveningFactor = this.getEveningFactor();

    // Base sky from day/night — richer palette
    const daySky = new THREE.Color(0x87ceeb);
    const nightSky = new THREE.Color(0x182440);   // brighter navy, readable not black
    const sunriseSky = new THREE.Color(0xffa070);
    const eveningSky = new THREE.Color(0xD08050);  // warm amber sky during golden hour

    let baseSky: THREE.Color;
    if (daylight < 0.10) {
      baseSky = nightSky;
    } else if (daylight < 0.25) {
      const t = (daylight - 0.10) / 0.15;
      baseSky = nightSky.clone().lerp(sunriseSky, t);
    } else if (daylight < 0.45) {
      const t = (daylight - 0.25) / 0.20;
      baseSky = sunriseSky.clone().lerp(daySky, t);
    } else {
      baseSky = daySky;
    }

    // Evening golden warmth overlay
    if (eveningFactor > 0) {
      baseSky.lerp(eveningSky, eveningFactor * 0.25);
    }

    // State-driven overrides (blend on top of day/night)
    if (this.renderState.priceChange24h < -20) {
      this.targetFogColor.set(baseSky).lerp(new THREE.Color(0x5a5a6a), 0.4);
      this.targetFogNear = 20;
      this.targetFogFar = 70;
      this.targetSunIntensity = 0.7;
      this.targetAmbientIntensity = 0.3;
    } else if (this.renderState.phase === 'thriving' && this.renderState.priceChange24h > 10) {
      this.targetFogColor.copy(baseSky);
      this.targetFogNear = 50;
      this.targetFogFar = 140;
      this.targetSunIntensity = 2.2;
      this.targetAmbientIntensity = 0.65;
    } else {
      this.targetFogColor.copy(baseSky);
      // Clear day: fog pushed well back for open, airy feel
      // Night: fog still pushed back enough to see terrain and hills clearly.
      // Night floor: near=55, far=110 (not too close — hills should be visible)
      // Day peak: near=90, far=210 (open, airy, vibrant)
      this.targetFogNear = 55 + daylight * 35;
      this.targetFogFar = 110 + daylight * 100;
      // Match updateDayNightCycle values
      this.targetSunIntensity = 0.45 + daylight * 1.55;
      this.targetAmbientIntensity = 0.40 + daylight * 0.50;
    }

    // ── Night atmosphere enhancement — atmospheric light scattering ──
    // Moonlight scatters through the atmosphere, creating a soft blue haze
    // that lifts distant terrain out of darkness. This is the key to making
    // nights feel deep but not invisible. The fog color should be bright
    // enough that hills fade into visible blue haze, not black void.
    if (nightFactor > 0.3) {
      const nightStrength = (nightFactor - 0.3) / 0.7; // 0–1 in night range
      // Moonlit atmospheric haze: bright cool blue (NOT dark navy)
      // This is what makes distant hills readable — they fade into blue, not black
      this.targetFogColor.lerp(new THREE.Color(0x2a3a58), nightStrength * 0.40);
      // Push fog back generously — night terrain should be VISIBLE
      this.targetFogNear += nightStrength * 15;
      this.targetFogFar += nightStrength * 35;
      // Strong ambient boost: sky illumination fills shadows with cool light
      this.targetAmbientIntensity += nightStrength * 0.18;
      // Slight exposure lift for atmospheric scattering brightness
      this.targetExposure += nightStrength * 0.05;
    }

    // ── Evening golden hour enhancement ─────────────────────────
    // Warm cinematic glow during sunset / sunrise
    if (eveningFactor > 0) {
      this.targetFogColor.lerp(new THREE.Color(0xE8C088), eveningFactor * 0.15);
      this.targetSunIntensity *= 1 + eveningFactor * 0.15; // slightly brighter warm sun
      this.targetAmbientIntensity *= 1 + eveningFactor * 0.10;
      this.targetExposure += eveningFactor * 0.06;
    }

    // Legendary atmosphere: warm, luminous, premium feel — never muted
    if (this.renderState.isLegendary && this.renderState.hasGraduated) {
      // Slight golden warmth to the fog for a fairy-tale glow
      this.targetFogColor.lerp(new THREE.Color(0xf8f0e0), 0.08);
      // Push fog back for cleaner silhouettes against the sky
      this.targetFogNear += 8;
      this.targetFogFar += 25;
      // Slightly brighter sun — legendary castles catch more light
      this.targetSunIntensity *= 1.08;
      this.targetAmbientIntensity *= 1.06;
      // Warmer exposure
      this.targetExposure += 0.04;

      // ── Legendary night: MORE beautiful at night than day ──────
      // At night, legendary castles glow from within. The sky darkens
      // but the castle becomes the light source — a beacon in the dark.
      if (nightFactor > 0.3) {
        const legendaryNight = (nightFactor - 0.3) / 0.7;
        // Push fog even further back — legendary silhouette is always clear
        this.targetFogNear += legendaryNight * 8;
        this.targetFogFar += legendaryNight * 20;
        // Warm golden night fog tint — the castle's glow colors the air
        this.targetFogColor.lerp(new THREE.Color(0x1A1828), legendaryNight * 0.15);
        this.targetFogColor.lerp(new THREE.Color(0x2A2040), legendaryNight * 0.08);
        // Boost ambient for readability — legendary never goes truly dark
        this.targetAmbientIntensity += legendaryNight * 0.12;
        // Warmer exposure at night — the castle's inner light compensates
        this.targetExposure += legendaryNight * 0.10;
      }
    }

    // Decay darkens fog
    const decayFog = this.renderState.smoothDecay * 0.5;
    // Legendary castles resist atmospheric decay — fog only half as aggressive
    const fogDecayMult = this.renderState.isLegendary ? 0.5 : 1.0;
    this.targetFogNear -= decayFog * 10 * fogDecayMult;
    this.targetFogFar -= decayFog * 30 * fogDecayMult;
    this.targetSunIntensity *= (1 - this.renderState.smoothDecay * (this.renderState.isLegendary ? 0.20 : 0.30));
    this.targetAmbientIntensity *= (1 - this.renderState.smoothDecay * (this.renderState.isLegendary ? 0.15 : 0.22));

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

    // ── Castle-focused light modifiers (state + weather) ─────────
    // The castle key light and rim light are set in updateDayNightCycle()
    // based on time-of-day. Here we apply additional modifiers for
    // token state (population, legendary, decay) and weather.
    if (this.renderState) {
      // Low population dims castle lights (activity-driven, not label-driven)
      const pop = this.renderState.populationDensity ?? this.renderState.smoothPopulation ?? 0.5;
      if (pop < 0.2) {
        const dimFactor = 0.4 + pop * 3; // 0.4 at ghost town, 1.0 at pop=0.2
        this.castleKeyLight.intensity *= dimFactor;
        this.castleRimLight.intensity *= dimFactor;
      }

      // Legendary: castle gets stronger key and rim — the hero glow.
      // At night, legendary castles are dramatically boosted — they become
      // the undisputed visual centerpiece, glowing warmly against the cool night.
      if (this.renderState.isLegendary && this.renderState.hasGraduated) {
        this.castleKeyLight.intensity *= 1.25;
        this.castleRimLight.intensity *= 1.20;
        // Night legendary: warm golden key + strong cool rim = magical silhouette
        if (nightFactor > 0.3) {
          const legendaryNight = (nightFactor - 0.3) / 0.7;
          // Key light: warm golden glow intensifies — castle feels inhabited
          this.castleKeyLight.color.lerp(new THREE.Color(0xffd890), legendaryNight * 0.4);
          this.castleKeyLight.intensity += legendaryNight * 0.25;
          // Rim light: cool magical edge glow intensifies — silhouette pops
          this.castleRimLight.intensity += legendaryNight * 0.20;
          this.castleRimLight.color.lerp(new THREE.Color(0xb0c8f0), legendaryNight * 0.2);
        }
      }

      // Thriving + bullish: castle even more prominent
      if (this.renderState.phase === 'thriving' && this.renderState.priceChange24h > 10) {
        this.castleKeyLight.intensity *= 1.10;
      }

      // ─── Price Mood Accent Tinting ─────────────────────────
      // Subtly tints the castle key light warm (bullish) or cool (bearish).
      // Never recolors the entire castle — just a gentle accent shift.
      // priceMood: -1 (bearish) → 0 (neutral) → +1 (bullish)
      if (this.renderState.priceMood !== undefined) {
        const moodColor = getPriceMoodColor(this.renderState.priceMood);
        if (moodColor) {
          // Blend at most 22% toward mood color — noticeable but not overwhelming
          const blendStrength = Math.min(0.22, Math.abs(this.renderState.priceMood) * 0.25);
          this.castleKeyLight.color.lerp(moodColor, blendStrength);
        }
      }

      // Decay dims castle lights (but less than it dims the sun)
      const decayDim = 1 - this.renderState.smoothDecay * (this.renderState.isLegendary ? 0.15 : 0.30);
      this.castleKeyLight.intensity *= decayDim;
      this.castleRimLight.intensity *= decayDim;
    }

    // Weather modifiers on castle lights
    if (weather) {
      // Rain/storm dims key light, but keeps rim for silhouette
      const rainDim = 1 - weather.rainIntensity * 0.25 - weather.stormFactor * 0.20;
      this.castleKeyLight.intensity *= rainDim;
      this.castleRimLight.intensity *= (1 - weather.rainIntensity * 0.10); // rim persists

      // Clouds dim key slightly
      this.castleKeyLight.intensity *= (1 - weather.cloudiness * 0.12);

      // Fog: key light still visible (castle is the beacon in fog)
      // but rim dims (edges lost in haze)
      if (weather.fogFactor > 0.1) {
        this.castleRimLight.intensity *= (1 - weather.fogFactor * 0.40);
      }
    }

    // Smooth lerp
    this.currentFogColor.lerp(this.targetFogColor, lerpSpeed);
    this.currentFogNear += (this.targetFogNear - this.currentFogNear) * lerpSpeed;
    this.currentFogFar += (this.targetFogFar - this.currentFogFar) * lerpSpeed;
    this.currentSunIntensity += (this.targetSunIntensity - this.currentSunIntensity) * lerpSpeed;
    this.currentAmbientIntensity += (this.targetAmbientIntensity - this.currentAmbientIntensity) * lerpSpeed;
    this.currentExposure += (this.targetExposure - this.currentExposure) * lerpSpeed;

    // Apply — mutate existing fog (no allocation per frame)
    this.fog.color.copy(this.currentFogColor);
    this.fog.near = Math.max(5, this.currentFogNear);
    this.fog.far = Math.max(20, this.currentFogFar);
    // Sky dome provides the background — no flat scene.background needed
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

  /** True once the scene has had enough frames to build geometry and settle camera. */
  isSceneReady(): boolean {
    return this.sceneReady;
  }

  getWorldState(): WorldState | null {
    return this.worldState;
  }

  getTimeInfo(): TimeInfo {
    return computeTimeInfo();
  }

  getQualityLevel(): string {
    return qualitySettings.getLevel();
  }

  setQualityLevel(level: 'low' | 'medium' | 'high'): void {
    qualitySettings.setLevel(level);
    this.qualityConfig = qualitySettings.getConfig();
    // Apply renderer changes that require immediate effect
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.qualityConfig.pixelRatio));
    this.renderer.shadowMap.enabled = this.qualityConfig.shadowsEnabled;
    if (this.sunLight) {
      this.sunLight.castShadow = this.qualityConfig.shadowsEnabled;
    }
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

    // Dispose castle-focused lights
    if (this.castleKeyLight) {
      this.scene.remove(this.castleKeyLight);
      this.scene.remove(this.castleKeyLight.target);
      this.castleKeyLight.dispose();
    }
    if (this.castleRimLight) {
      this.scene.remove(this.castleRimLight);
      this.scene.remove(this.castleRimLight.target);
      this.castleRimLight.dispose();
    }

    // Dispose sky dome, clouds, haze
    if (this.skyDome) {
      this.skyDome.geometry.dispose();
      (this.skyDome.material as THREE.Material).dispose();
      this.scene.remove(this.skyDome);
    }
    if (this.cloudGroup) {
      for (const cloud of this.cloudMeshes) {
        cloud.geometry.dispose();
        (cloud.material as THREE.Material).dispose();
      }
      this.scene.remove(this.cloudGroup);
    }
    if (this.hazeMesh) {
      this.hazeMesh.geometry.dispose();
      this.hazeMaterial.dispose();
      this.scene.remove(this.hazeMesh);
    }

    // Dispose builders
    this.castleBuilder.dispose();
    this.environmentBuilder.dispose();
    this.effectsManager.dispose();

    // Dispose systems
    this.actorManager.dispose();
    this.eventSystem.dispose();
    this.physicsMotion.dispose();
    this.memoryRenderer.dispose();
    this.outerWorldBuilder.dispose();
    this.weatherEffects.dispose();
    this.musicManager.dispose();

    // Dispose renderer
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
