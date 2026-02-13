// Exchange listing for a token
export interface ExchangeListing {
  name: string;           // Exchange name (e.g., "Raydium", "Jupiter", "Binance")
  tier: 'dex' | 'cex_small' | 'cex_major';  // Exchange significance
}

// Token data from API
export interface TokenData {
  address: string;
  name: string;
  symbol: string;
  imageUrl?: string;       // Token logo/image URL (optional — used for banner cloth)
  marketCap: number;
  athMarketCap: number;
  priceChange24h: number;
  priceChange1h?: number;        // 1-hour price change (%) — for weather momentum
  high24?: number;               // 24h high price — for volatility calculation
  low24?: number;                // 24h low price — for volatility calculation
  volume24h: number;
  previousVolume24h: number;
  txnCount24: number;           // Total transactions in 24h
  uniqueTransactions24: number;  // Unique wallets transacting in 24h
  buyCount24?: number;           // Buy transactions in 24h — for castle readiness
  sellCount24?: number;          // Sell transactions in 24h — for castle readiness
  walletAgeAvg?: number;         // Avg age (seconds) of wallets trading in 24h — for stability
  walletAgeStd?: number;         // Std dev of wallet ages (seconds) — for structural regularity
  devHeldPercentage?: number;    // % of supply held by dev wallet (0–100) — corruption signal
  insiderHeldPercentage?: number; // % of supply held by insiders (0–100) — corruption signal
  sniperCount?: number;          // Number of sniper bots that bought — corruption signal
  isScam?: boolean;              // Whether the token has been flagged as a scam
  lastTradeTimestamp: number;
  holders: number;
  liquidity: number;
  createdAt: number;
  isGraduated: boolean;
  graduatedAt: number | null;
  exchanges?: ExchangeListing[];  // Where this token is listed (optional)
}

// Castle tier based on ATH market cap — 12 visual progression levels
export type CastleTier =
  | 'hut'        // Pre-graduation
  | 'cottage'    // Graduated → 200K
  | 'tower'      // 200K → 500K
  | 'keep'       // 500K → 1M
  | 'manor'      // 1M → 2M
  | 'castle'     // 2M → 5M
  | 'stronghold' // 5M → 10M
  | 'fortress'   // 10M → 50M
  | 'palace'     // 50M → 100M
  | 'citadel'    // 100M → 500M
  | 'empire'     // 500M → 1B
  | 'legend';    // 1B+

// Life phase of the token (simplified — no negative labels)
export type LifePhase =
  | 'construction'  // Pre-graduation
  | 'graduated'     // Just graduated (trigger celebration)
  | 'thriving';     // Post-graduation (activity effects driven by populationDensity)

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
  populationDensity: number;   // 0-1, drives castle life (villagers, guards, smoke, lights)

  // Transaction activity
  txnCount24: number;
  uniqueTransactions24: number;

  // Flags
  isLegendary: boolean;    // Ever crossed 100M
  hasGraduated: boolean;
  showGraduationCelebration: boolean;

  // Time-based
  hoursSinceLastTrade: number;
  tokenAgeHours: number;

  // Raw values for rendering
  marketCap: number;
  athMarketCap: number;
  priceChange24h: number;

  // ─── Token Identity ──────────────────────────────────────
  tokenName: string;                    // Castle canonical name
  tokenSymbol: string;                  // Drives sigil colors deterministically
  tokenImageUrl?: string;               // Banner cloth texture source
  exchanges: ExchangeListing[];         // Trade route markers
  exchangeCount: number;                // Total exchanges (drives trade atmosphere)
  hasMajorExchange: boolean;            // Has at least one major CEX listing
  priceMood: number;                    // -1 (bearish) to +1 (bullish), clamped and smoothed
}

// Interpolated state for smooth rendering
export interface RenderState extends WorldState {
  // These are smoothly interpolated versions
  smoothDecay: number;
  smoothVolume: number;
  smoothConstruction: number;
  smoothPopulation: number;  // Smoothly interpolated populationDensity

  // Animation time
  time: number;
  deltaTime: number;

  // Celebration state
  celebrationProgress: number; // 0-1 during graduation celebration

  // Day/night
  dayPhase: number;      // 0 = midnight, 0.5 = noon (raw clock phase)
  nightFactor: number;   // 0 = full day, 1 = full night (smooth)
  eveningFactor: number; // 0 = not evening, 1 = peak golden hour
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

// Castle scale computed from market cap — logarithmic sizing with detail beyond cap
export interface CastleScale {
  /** Base castle structure height in Three.js units (1.5 → 20) */
  baseCastleHeight: number;
  /** Number of towers to place (0 → 20) */
  towerCount: number;
  /** Number of internal keep levels / floors (1 → 5) */
  innerKeepLevels: number;
  /** Normalized 0-1 value representing overall grandeur for material/detail systems */
  grandeur: number;
  /** Whether size is capped and detail should increase instead */
  detailMode: boolean;
  /** Detail multiplier (1.0 at cap, scales up beyond cap for ornaments/particles) */
  detailMultiplier: number;
}

// Wall strength tiers — discrete visual classes to ensure perceptible differences
export type WallStrengthTier = 'fragile' | 'weak' | 'reinforced' | 'fortress' | 'citadel';

// Wall defense computed from liquidity-to-marketCap ratio
export interface WallDefense {
  /** Raw score 0–1 from log-scaled liquidity ratio */
  wallStrengthScore: number;
  /** Discrete strength tier for visual clarity */
  tier: WallStrengthTier;
  /** Wall thickness in Three.js meters (0.15 → 1.2) */
  wallThickness: number;
  /** Multiplier applied to base wall height (0.7 → 1.4) */
  wallHeightMultiplier: number;
  /** Number of buttress supports along each wall segment (0 → 8) */
  buttressCount: number;
  /** Crack density on wall surfaces, 0 = pristine, 1 = heavily cracked */
  crackDensity: number;
  /** Material reinforcement type for wall rendering */
  reinforcementType: 'none' | 'wood' | 'iron' | 'stone' | 'steel';
  /** Human-readable tooltip explaining the wall strength */
  tooltip: string;
}

// Economic activity indicators from txn + wallet + volume signals
export interface EconomicActivity {
  /** Composite economic activity score (0–1) from all three input signals */
  activityScore: number;
  /** Global animation speed multiplier (0.15 → 2.0) — applied to NPC walk cycles,
   *  builder hammer swings, guard patrol speed, bird flight.
   *  Floor of 0.15 keeps the world perceptibly alive even for tiny tokens. */
  animationSpeed: number;
  /** Banner / flag cloth wave intensity (0.05 → 1.0) — amplitude of vertex
   *  displacement in flag wave shader.  Low values = limp cloth, high = full snap. */
  bannerMotionIntensity: number;
  /** Smoke particle emission rate multiplier (0.0 → 3.0) — applied to per-chimney
   *  spawn chance.  0 = no smoke, 3 = roaring chimneys. */
  smokeEmissionRate: number;
}

// Internal population indicators derived from holders count
export interface PopulationIndicators {
  /** NPC spawn density multiplier (0.05 → 1.0) — controls animation speed & idle
   *  variation rather than spawning more mesh objects */
  npcDensity: number;
  /** Number of windows that should glow at night (0 → 12) */
  windowLightCount: number;
  /** Courtyard animation intensity 0–1: idle sway amplitude, walk speed,
   *  smoke drift rate, torch flicker frequency — NOT extra object spawns */
  courtyardActivityLevel: number;
  /** The log-scaled normalized holders value used internally (0–1) */
  holdersNorm: number;
}

// Castle readiness from buy/sell pressure — smooth defensive posture
export interface CastleReadiness {
  /** Raw buy/(buy+sell) pressure ratio 0–1.  0.5 = balanced, 1 = pure buying */
  pressureRatio: number;
  /** Gate open percentage 0–1: 0 = sealed shut (sell panic), 1 = wide open (buy confidence) */
  gateOpenPercentage: number;
  /** Guard alert level 0–1: 0 = relaxed patrol, 1 = full battle stations */
  guardAlertLevel: number;
  /** Shield / barrier visual opacity 0–1: 0 = invisible, 1 = fully raised */
  shieldVisibility: number;
}

// Token heritage — age-driven architectural maturity (old = established, not decayed)
export interface TokenHeritage {
  /** Token age in days (from createdAt to now) */
  ageDays: number;
  /** Log-normalized age 0–1 against a 365-day reference ceiling */
  ageNorm: number;
  /** Architectural layering 0–1: 0 = single-era structure, 1 = rich multi-era additions
   *  (extra wings, extensions, mixed stone styles).  Ramps with sqrt for early gains. */
  architecturalLayering: number;
  /** Statue presence 0–1: 0 = no statues, 1 = full gallery of monument figures.
   *  Delayed onset (only visible after ~7 days), then linear ramp. */
  presenceOfStatues: number;
  /** Material wear level 0–1: 0 = fresh-cut stone, 1 = deeply patinated / moss-touched.
   *  Conveys *character* not damage — roughness and color shift, not cracks. */
  materialWearLevel: number;
}

// Kingdom stability from wallet age distribution — structural soundness
export interface KingdomStability {
  /** Normalized average wallet age 0–1 (high = mature holders) */
  maturityNorm: number;
  /** Normalized wallet age std deviation 0–1 (high = mixed crowd) */
  diversityNorm: number;
  /** Tower alignment variance 0–1: 0 = perfectly plumb towers,
   *  1 = visibly leaning/offset.  High std = structural irregularity. */
  towerAlignmentVariance: number;
  /** Subtle vibration amplitude 0–1: 0 = rock solid, 1 = faint structural tremor.
   *  Driven by high diversity (mixed wallet ages = unstable foundation). */
  vibrationAmplitude: number;
  /** Foundation evenness 0–1: 0 = uneven/cracked base, 1 = perfectly level.
   *  High avg + low std = stable kingdom = even foundation. */
  foundationEvenness: number;
}

// Corruption overlay from risk metrics — visible taint on the castle
export interface CorruptionOverlay {
  /** Composite corruption score 0–1: weighted blend of all risk signals */
  corruptionIntensity: number;
  /** Visual corruption indicators — each 0–1, controlling specific effects */
  visualIndicators: {
    /** Dark vein density on stone surfaces (0 = clean, 1 = heavily veined) */
    veinDensity: number;
    /** Shadow darkening multiplier (0 = normal shadows, 1 = deep unnatural darkness) */
    shadowDepth: number;
    /** Surface decay overlay opacity (0 = pristine, 1 = visibly corroded).
     *  Distinct from age patina — this is sickly, not distinguished. */
    decayOpacity: number;
  };
  /** Hue/saturation shift applied to castle materials.
   *  Ranges from [0, 0, 0] (no shift) toward sickly green/purple at high corruption.
   *  [hueShift (-0.15–0), saturationDrain (0–0.5), brightnessLoss (0–0.3)] */
  colorShift: [number, number, number];
  /** Whether the token is flagged as a confirmed scam — triggers max corruption */
  isScamFlagged: boolean;
}

// Price-driven weather — maps token price momentum to atmospheric mood
export interface PriceWeather {
  /** Color temperature shift: 0 = cool/blue (bearish), 0.5 = neutral, 1 = warm/golden (bullish) */
  lightColorTemperature: number;
  /** Cloud cover 0–1: 0 = clear sky, 1 = overcast.  Heavy clouds ≤ 0.7 to avoid scene obscuring */
  cloudDensity: number;
  /** Wind intensity 0–1: 0 = calm, 1 = gale.  Capped at 0.6 for readability */
  windStrength: number;
  /** Precipitation type driven by price severity */
  precipitationType: 'none' | 'fog' | 'rain' | 'storm';
  /** Volatility score 0–1 from high/low spread — drives lightning flicker intensity */
  volatility: number;
  /** Price momentum -1 (crash) to +1 (moon) — raw signed mood for optional downstream use */
  momentum: number;
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

// Map region for world map view
export interface MapRegion {
  id: string;              // token address
  name: string;
  symbol: string;
  tier: CastleTier;
  phase: LifePhase;
  isLegendary: boolean;
  marketCap: number;
  athMarketCap: number;
  decay: number;
  constructionProgress: number;
  /** Computed importance score 0–1 (drives placement and size) */
  importance: number;
  /** Token logo/image URL (optional) */
  imageUrl?: string;
}

// Performance budget — per-castle object and effect limits
export interface PerformanceBudget {
  // ── Object counts (hard caps per castle instance) ──────────────────
  /** Max tower meshes to instantiate (0 → 20) */
  maxTowers: number;
  /** Max wall segment meshes (4 → 32) */
  maxWallSegments: number;
  /** Max buttress meshes across all walls (0 → 24) */
  maxButtresses: number;
  /** Max NPC actors (villagers + guards combined) (0 → 16) */
  maxNPCs: number;
  /** Max chimney smoke emitter points (0 → 6) */
  maxChimneys: number;
  /** Max banner/flag cloth meshes (0 → 10) */
  maxBanners: number;
  /** Max prop meshes (benches, stalls, lampposts, etc.) (0 → 20) */
  maxProps: number;
  /** Max tree meshes in the surrounding environment (0 → 30) */
  maxTrees: number;
  /** Max statue meshes (0 → 8) */
  maxStatues: number;
  /** Max point lights active simultaneously (1 → 12) */
  maxPointLights: number;

  // ── LOD rules ─────────────────────────────────────────────────────
  /** NPC LOD: 'full' = animated mesh, 'simple' = billboard sprite, 'none' = hidden */
  npcLOD: 'full' | 'simple' | 'none';
  /** Prop LOD: 'full' = detailed mesh, 'simple' = low-poly, 'none' = hidden */
  propLOD: 'full' | 'simple' | 'none';
  /** Tree LOD: 'full' = geometry, 'billboard' = camera-facing sprite, 'none' */
  treeLOD: 'full' | 'billboard' | 'none';

  // ── Effect toggles (disabled on low-activity tokens to save GPU) ──
  /** Whether corruption overlay shader is active */
  corruptionEffectEnabled: boolean;
  /** Whether weather particles (rain/snow/fog) are spawned */
  weatherParticlesEnabled: boolean;
  /** Whether shield barrier (readiness) renders */
  shieldEffectEnabled: boolean;
  /** Whether structural vibration (stability) is applied */
  vibrationEnabled: boolean;
  /** Whether chimney smoke particles spawn */
  smokeEnabled: boolean;
  /** Whether rim-glow / clearcoat on legendary materials is active */
  legendaryEffectsEnabled: boolean;
  /** Whether day/night window glow lights are placed */
  windowGlowEnabled: boolean;

  // ── Budget metadata ───────────────────────────────────────────────
  /** Total estimated triangle count for this budget (informational) */
  estimatedTriangles: number;
  /** Total estimated draw calls (informational) */
  estimatedDrawCalls: number;
}

// Canvas layer for rendering order
export type RenderLayer =
  | 'background'
  | 'environment'
  | 'castle-back'
  | 'castle-front'
  | 'builders'
  | 'effects'
  | 'ui';
