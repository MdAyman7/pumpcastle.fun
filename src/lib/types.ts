// Token data from API
export interface TokenData {
  address: string;
  name: string;
  symbol: string;
  marketCap: number;
  athMarketCap: number;
  priceChange24h: number;
  volume24h: number;
  previousVolume24h: number;
  lastTradeTimestamp: number;
  holders: number;
  liquidity: number;
  createdAt: number;
  isGraduated: boolean;
  graduatedAt: number | null;
}

// Castle tier based on ATH
export type CastleTier = 'keep' | 'castle' | 'fortress' | 'citadel';

// Life phase of the token
export type LifePhase =
  | 'construction'  // Pre-graduation
  | 'graduated'     // Just graduated (trigger celebration)
  | 'thriving'      // Active and healthy
  | 'declining'     // Falling from glory
  | 'dormant'       // Low activity
  | 'zombie'        // No trades for extended period
  | 'cursed';       // Repeated dumps, very bad state

// Activity level based on volume
export type ActivityLevel = 'booming' | 'active' | 'slow' | 'dying' | 'dead';

// Computed world state from token data
export interface WorldState {
  tier: CastleTier;
  phase: LifePhase;
  activityLevel: ActivityLevel;

  // Normalized values 0-1
  decay: number;           // How far from ATH (0 = at ATH, 1 = completely fallen)
  volumeRatio: number;     // Current vs previous volume
  constructionProgress: number; // 0-1 for pre-graduation

  // Flags
  isLegendary: boolean;    // Ever crossed 100M
  hasGraduated: boolean;
  showGraduationCelebration: boolean;
  isZombie: boolean;
  isCursed: boolean;

  // Time-based
  hoursSinceLastTrade: number;
  tokenAgeHours: number;

  // Raw values for rendering
  marketCap: number;
  athMarketCap: number;
  priceChange24h: number;
}

// Interpolated state for smooth rendering
export interface RenderState extends WorldState {
  // These are smoothly interpolated versions
  smoothDecay: number;
  smoothVolume: number;
  smoothConstruction: number;

  // Animation time
  time: number;
  deltaTime: number;

  // Celebration state
  celebrationProgress: number; // 0-1 during graduation celebration
}

// Builder NPC state
export interface BuilderState {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  state: 'working' | 'walking' | 'idle' | 'leaving';
  animationPhase: number;
  scale: number;
}

// Creature state (dragons, zombies)
export interface CreatureState {
  id: number;
  type: 'dragon' | 'zombie' | 'ghost';
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  state: 'flying' | 'perched' | 'stone' | 'wandering';
  animationPhase: number;
  opacity: number;
}

// Particle for effects
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: 'confetti' | 'spark' | 'dust' | 'ember' | 'fog';
}

// Environment state
export interface EnvironmentState {
  fogDensity: number;
  fogColor: string;
  skyColor: string;
  ambientLight: number;
  windStrength: number;
  timeOfDay: number; // 0-1
}

// Canvas layer for rendering order
export type RenderLayer =
  | 'background'
  | 'environment'
  | 'castle-back'
  | 'creatures'
  | 'castle-front'
  | 'builders'
  | 'effects'
  | 'ui';
