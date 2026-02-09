/**
 * QualitySettings.ts
 *
 * Device-aware quality scaling system.
 * Auto-detects GPU capability and provides per-quality-level
 * configuration for shadows, particles, instancing, update rates, etc.
 *
 * Three quality levels: LOW / MEDIUM / HIGH
 * Default: auto-detected from device.
 * Can be overridden manually.
 */

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityConfig {
  // Shadows
  shadowMapSize: number;         // 512 / 1024 / 2048
  shadowsEnabled: boolean;       // false on LOW
  shadowCameraRange: number;     // frustum half-width for sun shadow camera

  // Particles
  maxRain: number;               // weather rain particles
  maxSnow: number;               // weather snow particles
  maxHaze: number;               // heat haze particles
  maxSmoke: number;              // chimney smoke particles
  maxEffectParticles: number;    // EffectsManager particles

  // Sky
  skyUpdateInterval: number;     // frames between sky dome vertex color updates (1 = every frame)
  cloudCount: number;            // number of cloud planes

  // Trees
  treeCount: number;             // max trees to render

  // Renderer
  pixelRatio: number;            // max device pixel ratio clamp
  antialias: boolean;            // MSAA

  // Update throttling
  hillUpdateInterval: number;    // frames between hill atmospheric updates
  treeUpdateInterval: number;    // frames between tree color updates
  weatherEffectsInterval: number; // frames between weather effect updates
  actorUpdateInterval: number;   // frames between actor logic updates

  // Fog
  fogEnabled: boolean;

  // Tone mapping
  toneMapping: boolean;
}

const QUALITY_PRESETS: Record<QualityLevel, QualityConfig> = {
  low: {
    shadowMapSize: 512,
    shadowsEnabled: false,
    shadowCameraRange: 20,
    maxRain: 80,
    maxSnow: 50,
    maxHaze: 10,
    maxSmoke: 15,
    maxEffectParticles: 200,
    skyUpdateInterval: 6,
    cloudCount: 4,
    treeCount: 15,
    pixelRatio: 1,
    antialias: false,
    hillUpdateInterval: 10,
    treeUpdateInterval: 8,
    weatherEffectsInterval: 2,
    actorUpdateInterval: 3,
    fogEnabled: true,
    toneMapping: true,
  },
  medium: {
    shadowMapSize: 1024,
    shadowsEnabled: true,
    shadowCameraRange: 25,
    maxRain: 150,
    maxSnow: 100,
    maxHaze: 20,
    maxSmoke: 30,
    maxEffectParticles: 350,
    skyUpdateInterval: 3,
    cloudCount: 7,
    treeCount: 22,
    pixelRatio: 1.5,
    antialias: true,
    hillUpdateInterval: 5,
    treeUpdateInterval: 4,
    weatherEffectsInterval: 1,
    actorUpdateInterval: 2,
    fogEnabled: true,
    toneMapping: true,
  },
  high: {
    shadowMapSize: 2048,
    shadowsEnabled: true,
    shadowCameraRange: 35,
    maxRain: 300,
    maxSnow: 200,
    maxHaze: 40,
    maxSmoke: 60,
    maxEffectParticles: 500,
    skyUpdateInterval: 1,
    cloudCount: 10,
    treeCount: 30,
    pixelRatio: 2,
    antialias: true,
    hillUpdateInterval: 1,
    treeUpdateInterval: 1,
    weatherEffectsInterval: 1,
    actorUpdateInterval: 1,
    fogEnabled: true,
    toneMapping: true,
  },
};

/**
 * Auto-detect quality level from device capabilities.
 *
 * Heuristic:
 * 1. Check WebGL renderer string for known low-end GPUs
 * 2. Check device pixel ratio (low DPR ≈ low-end device)
 * 3. Check max texture size support
 * 4. Check if mobile (touch device + small screen)
 * 5. Check navigator.hardwareConcurrency
 */
function autoDetectQuality(): QualityLevel {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'low';

    // Check renderer info
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    let renderer = '';
    if (debugInfo) {
      renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
    }

    // Known low-end GPU keywords
    const lowEndGPUs = [
      'intel hd graphics',
      'intel(r) hd graphics',
      'intel uhd graphics',
      'mali-4',
      'mali-t6',
      'adreno 3',
      'adreno 4',
      'powervr sgx',
      'apple gpu', // older iPhones/iPads sometimes report this
      'swiftshader',
      'llvmpipe',
      'mesa',
    ];

    const isLowEndGPU = lowEndGPUs.some(gpu => renderer.includes(gpu));

    // Max texture size
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    // Device pixel ratio
    const dpr = window.devicePixelRatio || 1;

    // Mobile detection
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) || (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);

    // Hardware concurrency
    const cores = navigator.hardwareConcurrency || 2;

    // Score-based detection
    let score = 0;

    // GPU power
    if (isLowEndGPU) score -= 3;
    if (renderer.includes('nvidia') || renderer.includes('radeon')) score += 2;
    if (renderer.includes('geforce rtx') || renderer.includes('radeon rx')) score += 1;
    if (renderer.includes('apple m')) score += 2; // Apple Silicon

    // Texture size
    if (maxTexture >= 16384) score += 1;
    if (maxTexture <= 4096) score -= 2;

    // DPR
    if (dpr >= 2) score += 1;
    if (dpr <= 1) score -= 1;

    // Mobile penalty
    if (isMobile) score -= 2;

    // CPU cores
    if (cores >= 8) score += 1;
    if (cores <= 2) score -= 1;

    // Cleanup
    canvas.remove();

    if (score <= -2) return 'low';
    if (score >= 2) return 'high';
    return 'medium';
  } catch {
    return 'medium';
  }
}

/**
 * Singleton quality settings manager.
 * Call getConfig() from any subsystem to read current quality parameters.
 */
class QualitySettingsManager {
  private level: QualityLevel;
  private config: QualityConfig;
  private manualOverride: boolean = false;

  constructor() {
    this.level = autoDetectQuality();
    this.config = { ...QUALITY_PRESETS[this.level] };
  }

  /** Get the active quality configuration */
  getConfig(): Readonly<QualityConfig> {
    return this.config;
  }

  /** Get the current quality level name */
  getLevel(): QualityLevel {
    return this.level;
  }

  /** Whether the level was manually set */
  isManualOverride(): boolean {
    return this.manualOverride;
  }

  /** Override quality level manually */
  setLevel(level: QualityLevel): void {
    this.level = level;
    this.config = { ...QUALITY_PRESETS[level] };
    this.manualOverride = true;
  }

  /** Reset to auto-detected quality */
  resetToAuto(): void {
    this.level = autoDetectQuality();
    this.config = { ...QUALITY_PRESETS[this.level] };
    this.manualOverride = false;
  }

  /** Helper: should this frame run a throttled system? */
  shouldUpdateThisFrame(frameCount: number, interval: number): boolean {
    return interval <= 1 || (frameCount % interval === 0);
  }
}

/** Global singleton — import and use from any render module */
export const qualitySettings = new QualitySettingsManager();
