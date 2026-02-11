/**
 * CastleConstants.ts — Single source of truth for every tunable constant
 * in the pumpcastle visual system.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW TO USE THIS FILE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every threshold, weight, floor, ceiling, and reference maximum used by the
 * castle computation functions lives here.  When you change a value in this
 * file, every function that uses it will automatically pick up the change —
 * no need to hunt through CastleState.ts for magic numbers.
 *
 * The constants are organized into sections matching the computation modules:
 *
 *   1. TIER           — market cap thresholds for the 12 castle tiers
 *   2. SCALE          — market cap → physical castle dimensions
 *   3. WALL_DEFENSE   — liquidity/mcap → wall strength tiers
 *   4. POPULATION     — holders → NPC liveliness
 *   5. ECONOMY        — txns + wallets + volume → animation controls
 *   6. READINESS      — buy/sell pressure → defensive posture
 *   7. HERITAGE       — token age → architectural maturity
 *   8. STABILITY      — wallet age distribution → structural soundness
 *   9. CORRUPTION     — risk metrics → corruption overlay
 *  10. WEATHER        — price momentum → atmospheric mood
 *  11. PERFORMANCE    — tier + activity → object limits, LOD, effect toggles
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { CastleTier, WallStrengthTier, WallDefense } from "$lib/types";

// ═══════════════════════════════════════════════════════════════════════════
// 1. TIER — Market cap thresholds for castle tier classification
// ═══════════════════════════════════════════════════════════════════════════
//
// CastleTier is a permanent structural identity — once reached via ATH, the
// tier never decreases.  Pre-graduation tokens are always 'hut'.
//
//   Tier          ATH Market Cap       Visual identity
//   ──────────    ─────────────────    ────────────────────────────
//   hut           (pre-graduation)     Tiny shack, no walls
//   cottage       graduated → $200K    Small home, basic fence
//   tower         $200K → $500K        Single watchtower
//   keep          $500K → $1M          Walled enclosure, 2 towers
//   manor         $1M → $2M            Residential estate
//   castle        $2M → $5M            Full castle with courtyard
//   stronghold    $5M → $10M           Military fortification
//   fortress      $10M → $50M          Major fortress complex
//   palace        $50M → $100M         Royal palace
//   citadel       $100M → $500M        Massive citadel
//   empire        $500M → $1B          Multi-structure empire
//   legend        $1B+                 Legendary monument

export const TIER = {
  /** Market cap thresholds in descending order: [minMarketCap, tierName] */
  THRESHOLDS: [
    [1_000_000_000, "legend"],
    [500_000_000, "empire"],
    [100_000_000, "citadel"],
    [50_000_000, "palace"],
    [10_000_000, "fortress"],
    [5_000_000, "stronghold"],
    [2_000_000, "castle"],
    [1_000_000, "manor"],
    [500_000, "keep"],
    [200_000, "tower"],
    [0, "cottage"],
  ] as [number, CastleTier][],

  /** ATH threshold for "legendary" status (permanent glow effects) */
  LEGENDARY_THRESHOLD: 100_000_000,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 2. SCALE — Market cap → physical castle dimensions
// ═══════════════════════════════════════════════════════════════════════════
//
// Uses logarithmic scaling:
//   t = clamp(log10(mcap / MIN) / log10(SIZE_CAP / MIN), 0, 1)
//
// Beyond SIZE_CAP, physical size stops growing; detailMultiplier increases
// instead (driving ornamental complexity).
//
//   MarketCap      t      Height   Towers   Levels   Grandeur
//   ──────────    ────    ──────   ──────   ──────   ────────
//   $10K          0.00     1.5       0        1       0.00
//   $100K         0.21     5.4       4        1       0.19
//   $1M           0.43     9.4       8        2       0.38
//   $10M          0.64    13.3      12        3       0.57
//   $100M         0.85    17.2      17        4       0.76
//   $500M         1.00    20.0      20        5       0.89
//   $2B           1.00    20.0      20        5       1.00  (detailMult=1.6)

export const SCALE = {
  /** Minimum market cap that registers any scale */
  MIN_MCAP: 10_000,
  /** Market cap where physical size stops growing */
  SIZE_CAP_MCAP: 500_000_000,
  /** Market cap where grandeur (0–1) saturates */
  GRANDEUR_CAP_MCAP: 2_000_000_000,

  /** Castle height range in Three.js units */
  MIN_HEIGHT: 1.5,
  MAX_HEIGHT: 20,

  /** Tower count range */
  MIN_TOWERS: 0,
  MAX_TOWERS: 20,

  /** Inner keep floor levels */
  MIN_LEVELS: 1,
  MAX_LEVELS: 5,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 3. WALL_DEFENSE — Liquidity/market-cap ratio → wall strength
// ═══════════════════════════════════════════════════════════════════════════
//
// wallStrengthScore = clamp(log10(liquidityRatio * 100), 0, 1)
//
// Score is then bucketed into one of five tiers, each with fixed visual
// attributes.
//
//   Ratio   Score   Tier          Thick   Height×  Buttrs  Cracks  Material
//   ─────   ─────   ──────────    ─────   ──────   ──────  ──────  ────────
//   1%      0.00    fragile       0.15    0.70       0      0.90    none
//   2%      0.30    weak          0.30    0.85       1      0.50    wood
//   3%      0.48    reinforced    0.55    1.00       3      0.20    iron
//   5%      0.70    fortress      0.85    1.20       5      0.05    stone
//   10%+    1.00    citadel       1.20    1.40       8      0.00    steel

export const WALL_DEFENSE = {
  /** Score thresholds for tier classification [minScore, tier] */
  TIER_THRESHOLDS: [
    [0.8, "citadel"],
    [0.6, "fortress"],
    [0.4, "reinforced"],
    [0.2, "weak"],
    [0, "fragile"],
  ] as [number, WallStrengthTier][],

  /** Per-tier visual definitions */
  TIER_DEFS: {
    fragile: {
      wallThickness: 0.15,
      wallHeightMultiplier: 0.7,
      buttressCount: 0,
      crackDensity: 0.9,
      reinforcementType: "none" as WallDefense["reinforcementType"],
    },
    weak: {
      wallThickness: 0.3,
      wallHeightMultiplier: 0.85,
      buttressCount: 1,
      crackDensity: 0.5,
      reinforcementType: "wood" as WallDefense["reinforcementType"],
    },
    reinforced: {
      wallThickness: 0.55,
      wallHeightMultiplier: 1.0,
      buttressCount: 3,
      crackDensity: 0.2,
      reinforcementType: "iron" as WallDefense["reinforcementType"],
    },
    fortress: {
      wallThickness: 0.85,
      wallHeightMultiplier: 1.2,
      buttressCount: 5,
      crackDensity: 0.05,
      reinforcementType: "stone" as WallDefense["reinforcementType"],
    },
    citadel: {
      wallThickness: 1.2,
      wallHeightMultiplier: 1.4,
      buttressCount: 8,
      crackDensity: 0,
      reinforcementType: "steel" as WallDefense["reinforcementType"],
    },
  } as const,

  /** Human-readable tier descriptions for tooltips */
  TIER_DESCRIPTIONS: {
    fragile:
      "Paper-thin walls crumble at a touch — liquidity is dangerously low relative to market cap.",
    weak: "Walls hold together with wooden bracing, but visible cracks betray shallow liquidity.",
    reinforced:
      "Iron-banded walls stand firm — healthy liquidity provides solid defensive depth.",
    fortress:
      "Thick stone walls with buttresses — strong liquidity makes this position hard to breach.",
    citadel:
      "Massive steel-clad walls with zero vulnerabilities — exceptional liquidity depth.",
  } as Record<WallStrengthTier, string>,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 4. POPULATION — Holders → NPC liveliness
// ═══════════════════════════════════════════════════════════════════════════
//
// holdersNorm = clamp(log10(max(1, holders)) / log10(REF_MAX), 0, 1)
//
// Outputs drive animation INTENSITY, not object count:
//   npcDensity          = 0.05 + 0.95 × sqrt(holdersNorm)
//   windowLightCount    = round(holdersNorm × 12)
//   courtyardActivity   = holdersNorm^1.5
//
//   Holders    Norm    NPC     Windows    Courtyard
//   ───────    ────    ────    ───────    ─────────
//       1      0.00    0.05       0         0.00
//      10      0.20    0.47       2         0.09
//     100      0.40    0.65       5         0.25
//    1000      0.60    0.79       7         0.46
//   10000      0.80    0.90      10         0.72
//  100000      1.00    1.00      12         1.00

export const POPULATION = {
  /** Reference holder count — tokens above this produce holdersNorm = 1.0 */
  REF_MAX: 100_000,
  /** Minimum NPC density — even an empty castle has ambient presence */
  NPC_DENSITY_FLOOR: 0.05,
  /** Maximum lit windows — beyond 12 is unreadable from default camera */
  MAX_WINDOW_LIGHTS: 12,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 5. ECONOMY — Transactions + wallets + volume → animation controls
// ═══════════════════════════════════════════════════════════════════════════
//
// Three channels, independently log-normalized, then blended:
//   txnNorm    = clamp(log10(txnCount24)           / log10(50K),  0, 1)  ×0.35
//   walletNorm = clamp(log10(uniqueTransactions24)  / log10(10K),  0, 1)  ×0.35
//   volumeNorm = clamp(log10(volume24h)             / log10(50M),  0, 1)  ×0.30
//
//   activityScore → animationSpeed (0.15–2.0)
//                 → bannerMotion   (0.05–1.0)
//                 → smokeEmission  (0.0–3.0)

export const ECONOMY = {
  /** Reference ceilings for log normalization */
  TXN_REF_MAX: 50_000,
  WALLET_REF_MAX: 10_000,
  VOLUME_REF_MAX: 50_000_000,

  /** Blend weights */
  W_TXN: 0.35,
  W_WALLET: 0.35,
  W_VOLUME: 0.3,

  /** Animation speed range */
  ANIM_SPEED_FLOOR: 0.15,
  ANIM_SPEED_CEIL: 2.0,

  /** Banner motion floor — cloth never fully stiff */
  BANNER_FLOOR: 0.05,

  /** Smoke particle emission ceiling */
  SMOKE_CEIL: 3.0,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 6. READINESS — Buy/sell pressure → defensive posture
// ═══════════════════════════════════════════════════════════════════════════
//
// pressureRatio = buyCount24 / (buyCount24 + sellCount24)
// 0.5 = balanced, 1.0 = pure buying, 0.0 = pure selling
//
//   gateOpen  = sigmoid centered at 0.5 with k=8
//   guardAlert = (1 - pressureRatio)^1.3
//   shield    = quadratic onset below 0.45
//
//   Ratio    Gate     Guard    Shield
//   ─────    ────     ─────    ──────
//   0.00     0.05     1.00     1.00
//   0.25     0.22     0.72     0.56
//   0.50     0.55     0.30     0.00
//   0.75     0.86     0.06     0.00
//   1.00     1.00     0.00     0.00

export const READINESS = {
  /** Minimum gate opening — never perfectly sealed */
  GATE_FLOOR: 0.05,
  /** Minimum guard alert — faint patrol even in euphoria */
  GUARD_ALERT_FLOOR: 0.05,
  /** Shield only appears below this pressure ratio */
  SHIELD_ONSET_RATIO: 0.45,
  /** Sigmoid steepness for gate curve */
  GATE_SIGMOID_K: 8,
  /** Power exponent for guard alert curve */
  GUARD_POWER: 1.3,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 7. HERITAGE — Token age → architectural maturity
// ═══════════════════════════════════════════════════════════════════════════
//
// ageNorm = clamp(log10(max(1, ageDays)) / log10(365), 0, 1)
//
// Outputs:
//   architecturalLayering  = sqrt(ageNorm)       — front-loaded early gains
//   presenceOfStatues      = delayed onset (>7d)  — then log ramp
//   materialWearLevel      = ageNorm^0.7          — character not damage
//
//   Days    Norm    Layers   Statues   Wear
//   ─────   ────    ──────   ───────   ────
//      1    0.00     0.00     0.00     0.00
//      7    0.33     0.57     0.00     0.41
//     30    0.58     0.76     0.29     0.63
//     90    0.76     0.87     0.54     0.79
//    365    1.00     1.00     1.00     1.00

export const HERITAGE = {
  /** Reference ceiling: tokens older than this saturate at 1.0 */
  AGE_REF_DAYS: 365,
  /** Statues don't appear until this many days */
  STATUE_ONSET_DAYS: 7,
  /** Power exponent for material wear curve */
  WEAR_POWER: 0.7,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 8. STABILITY — Wallet age distribution → structural soundness
// ═══════════════════════════════════════════════════════════════════════════
//
// maturityNorm  = clamp(log10(avgDays)  / log10(180), 0, 1)
// diversityNorm = clamp(log10(stdDays)  / log10(90),  0, 1)
//
// stability = maturityNorm × (1 - diversityNorm × 0.6)
//
//   Maturity  Diversity  TowerVar  Vibration  Foundation
//   ────────  ─────────  ────────  ─────────  ──────────
//     0.00      0.00      0.25       0.08       0.50
//     0.50      0.50      0.22       0.12       0.58
//     1.00      0.00      0.00       0.00       1.00
//     1.00      1.00      0.25       0.15       0.60

export const STABILITY = {
  /** Reference ceiling for average wallet age in days */
  WALLET_AGE_REF_DAYS: 180,
  /** Reference ceiling for wallet age std deviation in days */
  WALLET_STD_REF_DAYS: 90,
  /** Seconds per day — conversion constant */
  SECONDS_PER_DAY: 86_400,
  /** How strongly diversity drags down stability (0–1) */
  DIVERSITY_DRAG: 0.6,
  /** How strongly maturity dampens tower lean */
  MATURITY_DAMPING: 0.65,
  /** Max tower alignment variance */
  MAX_TOWER_VARIANCE: 0.7,
  /** Power exponent for tower variance from diversity */
  TOWER_VAR_POWER: 1.2,
  /** Max vibration amplitude */
  MAX_VIBRATION: 0.35,
  /** Foundation evenness floor */
  FOUNDATION_FLOOR: 0.1,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 9. CORRUPTION — Risk metrics → corruption overlay
// ═══════════════════════════════════════════════════════════════════════════
//
// Four weighted channels:
//   devScore     = clamp(devHeld / 50, 0, 1)        ×0.35
//   insiderScore = clamp(insiderHeld / 60, 0, 1)    ×0.30
//   sniperScore  = log10(snipers) / log10(50)       ×0.20
//   scamOverride                                     ×0.15
//
// If isScam → floor at 0.95 corruption regardless.
//
//   Intensity   Veins   Shadow   Decay   HueShift  SatDrain  BrightLoss
//   ─────────   ─────   ──────   ─────   ────────  ────────  ──────────
//     0.00       0.00    0.00    0.00     0.000     0.00       0.00
//     0.25       0.12    0.06    0.04    -0.038     0.13       0.08
//     0.50       0.35    0.17    0.14    -0.075     0.25       0.15
//     0.80       0.74    0.44    0.38    -0.120     0.40       0.24
//     0.95       0.93    0.57    0.50    -0.143     0.48       0.29
//     1.00       1.00    0.62    0.55    -0.150     0.50       0.30

export const CORRUPTION = {
  /** Dev-held % that saturates the dev channel */
  DEV_HELD_SATURATION: 50,
  /** Insider-held % that saturates the insider channel */
  INSIDER_HELD_SATURATION: 60,
  /** Sniper count reference ceiling (log-scaled) */
  SNIPER_REF_MAX: 50,

  /** Channel blend weights */
  W_DEV: 0.35,
  W_INSIDER: 0.3,
  W_SNIPER: 0.2,
  W_SCAM: 0.15,

  /** When isScam=true, force intensity to at least this level */
  SCAM_FLOOR_INTENSITY: 0.95,

  /** Power curves for visual indicators */
  VEIN_POWER: 1.5,
  SHADOW_POWER: 1.8,
  SHADOW_MAX: 0.62,
  SHADOW_SCALE: 0.65,
  DECAY_POWER: 1.6,
  DECAY_MAX: 0.55,
  DECAY_SCALE: 0.58,

  /** Max color shift values [hue, saturation, brightness] */
  MAX_HUE_SHIFT: -0.15,
  MAX_SAT_DRAIN: 0.5,
  MAX_BRIGHT_LOSS: 0.3,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 10. WEATHER — Price momentum → atmospheric mood
// ═══════════════════════════════════════════════════════════════════════════
//
// momentum = clamp((change1×0.4 + change24×0.6) / 50, -1, +1)
// volatility = clamp((high24 - low24) / midPrice, 0, 1)
//
//   Momentum    LightTemp   Clouds   Wind   Precip
//   ────────    ─────────   ──────   ────   ──────
//    +1.0        0.95        0.05    0.10    none
//    +0.3        0.78        0.10    0.12    none
//     0.0        0.50        0.20    0.15    none
//    -0.15       0.28        0.45    0.25    fog
//    -0.40       0.10        0.65    0.45    rain
//    -0.65       0.02        0.70    0.60    storm

export const WEATHER = {
  /** Momentum blend weights */
  MOMENTUM_W1H: 0.4,
  MOMENTUM_W24H: 0.6,

  /** Maximum change magnitude for normalization (±50%) */
  CHANGE_SATURATION: 50,

  /** Cloud density cap — never fully obscures scene */
  MAX_CLOUD_DENSITY: 0.7,
  /** Wind strength cap — keeps flags readable */
  MAX_WIND_STRENGTH: 0.6,

  /** Precipitation thresholds on momentum (negative = bearish) */
  PRECIP_FOG_THRESHOLD: -0.15,
  PRECIP_RAIN_THRESHOLD: -0.4,
  PRECIP_STORM_THRESHOLD: -0.65,

  /** Cloud contribution weights */
  CLOUD_BEARISH_WEIGHT: 0.6,
  CLOUD_VOLATILITY_WEIGHT: 0.15,

  /** Wind contribution weights */
  WIND_VOLATILITY_WEIGHT: 0.4,
  WIND_BEARISH_WEIGHT: 0.15,

  /** Light temperature sigmoid exponent */
  LIGHT_TEMP_POWER: 0.8,

  /** Pre-storm buildup: heavy rain gets partial stormFactor (0–0.35) */
  PRESTORM_STORM_MAX: 0.35,
  /** Flood ramp: stormFactor threshold to start rising water */
  FLOOD_START_THRESHOLD: 0.4,
  /** Max flood water opacity */
  FLOOD_MAX_OPACITY: 0.55,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 11. PERFORMANCE — Per-tier object limits, LOD rules, effect toggles
// ═══════════════════════════════════════════════════════════════════════════
//
// Object counts are tier-driven (hard caps).
// LOD rules are activity-driven (simplify quiet tokens).
// Effect toggles disable GPU-expensive shaders below activity thresholds.
//
//   Tier           Towers  Walls  Butt  NPCs  Chim  Banners  Props  Trees  Statues  Lights  ~Tris   ~Draws
//   ──────────────  ─────  ─────  ────  ────  ────  ───────  ─────  ─────  ───────  ──────  ──────  ──────
//   hut                0      4     0     0     1       0       0      4       0       1       800       8
//   cottage            0      4     0     1     1       1       2      6       0       2     2,000      15
//   tower              1      4     0     2     1       1       3      8       0       2     3,500      20
//   keep               2      6     2     3     1       2       5     10       0       3     6,000      30
//   manor              3      8     3     5     2       3       8     12       1       4    10,000      42
//   castle             4     12     4     7     2       4      10     15       2       6    16,000      55
//   stronghold         6     16     6     9     3       5      12     18       3       7    22,000      68
//   fortress           8     20     8    11     4       6      15     22       4       8    30,000      80
//   palace            10     24    10    13     5       7      17     25       5      10    40,000      95
//   citadel           14     28    14    15     5       8      18     28       6      11    55,000     110
//   empire            17     30    18    16     6       9      19     30       7      12    70,000     125
//   legend            20     32    24    16     6      10      20     30       8      12    85,000     140

export const PERFORMANCE = {
  /** Per-tier object count caps */
  TIER_BUDGETS: {
    hut: {
      maxTowers: 0,
      maxWallSegments: 4,
      maxButtresses: 0,
      maxNPCs: 0,
      maxChimneys: 1,
      maxBanners: 0,
      maxProps: 0,
      maxTrees: 4,
      maxStatues: 0,
      maxPointLights: 1,
      estTris: 800,
      estDrawCalls: 8,
    },
    cottage: {
      maxTowers: 0,
      maxWallSegments: 4,
      maxButtresses: 0,
      maxNPCs: 1,
      maxChimneys: 1,
      maxBanners: 1,
      maxProps: 2,
      maxTrees: 6,
      maxStatues: 0,
      maxPointLights: 2,
      estTris: 2000,
      estDrawCalls: 15,
    },
    tower: {
      maxTowers: 1,
      maxWallSegments: 4,
      maxButtresses: 0,
      maxNPCs: 2,
      maxChimneys: 1,
      maxBanners: 1,
      maxProps: 3,
      maxTrees: 8,
      maxStatues: 0,
      maxPointLights: 2,
      estTris: 3500,
      estDrawCalls: 20,
    },
    keep: {
      maxTowers: 2,
      maxWallSegments: 6,
      maxButtresses: 2,
      maxNPCs: 3,
      maxChimneys: 1,
      maxBanners: 2,
      maxProps: 5,
      maxTrees: 10,
      maxStatues: 0,
      maxPointLights: 3,
      estTris: 6000,
      estDrawCalls: 30,
    },
    manor: {
      maxTowers: 3,
      maxWallSegments: 8,
      maxButtresses: 3,
      maxNPCs: 5,
      maxChimneys: 2,
      maxBanners: 3,
      maxProps: 8,
      maxTrees: 12,
      maxStatues: 1,
      maxPointLights: 4,
      estTris: 10000,
      estDrawCalls: 42,
    },
    castle: {
      maxTowers: 4,
      maxWallSegments: 12,
      maxButtresses: 4,
      maxNPCs: 7,
      maxChimneys: 2,
      maxBanners: 4,
      maxProps: 10,
      maxTrees: 15,
      maxStatues: 2,
      maxPointLights: 6,
      estTris: 16000,
      estDrawCalls: 55,
    },
    stronghold: {
      maxTowers: 6,
      maxWallSegments: 16,
      maxButtresses: 6,
      maxNPCs: 9,
      maxChimneys: 3,
      maxBanners: 5,
      maxProps: 12,
      maxTrees: 18,
      maxStatues: 3,
      maxPointLights: 7,
      estTris: 22000,
      estDrawCalls: 68,
    },
    fortress: {
      maxTowers: 8,
      maxWallSegments: 20,
      maxButtresses: 8,
      maxNPCs: 11,
      maxChimneys: 4,
      maxBanners: 6,
      maxProps: 15,
      maxTrees: 22,
      maxStatues: 4,
      maxPointLights: 8,
      estTris: 30000,
      estDrawCalls: 80,
    },
    palace: {
      maxTowers: 10,
      maxWallSegments: 24,
      maxButtresses: 10,
      maxNPCs: 13,
      maxChimneys: 5,
      maxBanners: 7,
      maxProps: 17,
      maxTrees: 25,
      maxStatues: 5,
      maxPointLights: 10,
      estTris: 40000,
      estDrawCalls: 95,
    },
    citadel: {
      maxTowers: 14,
      maxWallSegments: 28,
      maxButtresses: 14,
      maxNPCs: 15,
      maxChimneys: 5,
      maxBanners: 8,
      maxProps: 18,
      maxTrees: 28,
      maxStatues: 6,
      maxPointLights: 11,
      estTris: 55000,
      estDrawCalls: 110,
    },
    empire: {
      maxTowers: 17,
      maxWallSegments: 30,
      maxButtresses: 18,
      maxNPCs: 16,
      maxChimneys: 6,
      maxBanners: 9,
      maxProps: 19,
      maxTrees: 30,
      maxStatues: 7,
      maxPointLights: 12,
      estTris: 70000,
      estDrawCalls: 125,
    },
    legend: {
      maxTowers: 20,
      maxWallSegments: 32,
      maxButtresses: 24,
      maxNPCs: 16,
      maxChimneys: 6,
      maxBanners: 10,
      maxProps: 20,
      maxTrees: 30,
      maxStatues: 8,
      maxPointLights: 12,
      estTris: 85000,
      estDrawCalls: 140,
    },
  } as Record<
    CastleTier,
    {
      maxTowers: number;
      maxWallSegments: number;
      maxButtresses: number;
      maxNPCs: number;
      maxChimneys: number;
      maxBanners: number;
      maxProps: number;
      maxTrees: number;
      maxStatues: number;
      maxPointLights: number;
      estTris: number;
      estDrawCalls: number;
    }
  >,

  /** LOD thresholds based on activity score */
  LOD: {
    /** activityScore ≥ this → full-detail meshes */
    FULL_THRESHOLD: 0.3,
    /** activityScore ≥ this → simplified LOD; below → hidden */
    SIMPLE_THRESHOLD: 0.1,
    /** LOD triangle multipliers */
    FULL_TRI_MULT: 1.0,
    SIMPLE_TRI_MULT: 0.6,
    NONE_TRI_MULT: 0.3,
  },

  /** Effect activity thresholds — below these, the effect is disabled */
  EFFECTS: {
    CORRUPTION_THRESHOLD: 0.05,
    WEATHER_THRESHOLD: 0.08,
    SHIELD_THRESHOLD: 0.05,
    VIBRATION_THRESHOLD: 0.1,
    SMOKE_THRESHOLD: 0.05,
    LEGENDARY_THRESHOLD: 0.15,
    WINDOW_GLOW_THRESHOLD: 0.03,
  },
} as const;
