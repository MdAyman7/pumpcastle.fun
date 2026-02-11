import type { TokenData, CastleTier, CastleScale, WallDefense, WallStrengthTier, PopulationIndicators, EconomicActivity, CastleReadiness, TokenHeritage, KingdomStability, CorruptionOverlay, PriceWeather, PerformanceBudget, WorldState, LifePhase } from '$lib/types';
import { computeDecay } from './DecayState';
import { computeActivity, type ActivityResult } from './ActivityState';
import { computeGraduation, type GraduationResult } from './GraduationState';
import { TIER, SCALE, WALL_DEFENSE, POPULATION, ECONOMY, READINESS, HERITAGE, STABILITY, CORRUPTION, WEATHER, PERFORMANCE } from './CastleConstants';

// Market cap thresholds for castle tiers (in USD), descending order

/**
 * Determine castle tier based on ATH market cap.
 * Once a tier is reached, structure remains forever.
 * Pre-graduation tokens are always 'hut'.
 */
export function computeTier(athMarketCap: number, isGraduated: boolean): CastleTier {
  if (!isGraduated) return 'hut';
  for (const [threshold, tier] of TIER.THRESHOLDS) {
    if (athMarketCap >= threshold) return tier;
  }
  return 'cottage';
}

/**
 * Determine if token is legendary (ever crossed 100M)
 */
export function isLegendary(athMarketCap: number): boolean {
  return athMarketCap >= TIER.LEGENDARY_THRESHOLD;
}

// ── Castle scale constants ──────────────────────────────────────────────────
//
// Market-cap → physical size mapping uses a log-scale curve that flattens
// at SIZE_CAP_MCAP (500M).  Beyond that cap the *size* stays constant but a
// `detailMultiplier` keeps rising so rendering systems can add ornamental
// complexity (extra pinnacles, glow particles, rune pillars) without making
// the castle physically larger.
//
// Formulas:
//   t            = clamp(log10(marketCap / MIN_MCAP) / log10(SIZE_CAP_MCAP / MIN_MCAP), 0, 1)
//   height       = lerp(MIN_HEIGHT, MAX_HEIGHT, t)
//   towerCount   = floor(lerp(MIN_TOWERS, MAX_TOWERS, t))
//   keepLevels   = floor(lerp(MIN_LEVELS, MAX_LEVELS, t))
//   grandeur     = clamp(log10(marketCap / MIN_MCAP) / log10(GRANDEUR_CAP_MCAP / MIN_MCAP), 0, 1)
//   detailMult   = 1 + max(0, log10(marketCap / SIZE_CAP_MCAP))  (>1 only above cap)

/**
 * Map a token's market cap to physical castle dimensions.
 *
 * Uses logarithmic scaling so early growth (10K → 1M) produces visible
 * jumps, while later growth (100M → 500M) compresses into smaller size
 * deltas — matching the diminishing visual impact of ever-larger structures.
 *
 * Beyond 500M ("size cap") the structure stops growing and instead
 * `detailMultiplier` increases, signalling renderers to add architectural
 * ornament, particle density, or glow intensity.
 *
 * @param marketCap  Current (or ATH) market cap in USD
 * @returns          CastleScale with height, tower count, keep levels, etc.
 */
export function computeCastleScale(marketCap: number): CastleScale {
  // Guard: anything at or below the floor yields the smallest castle
  if (marketCap <= SCALE.MIN_MCAP) {
    return {
      baseCastleHeight: SCALE.MIN_HEIGHT,
      towerCount: SCALE.MIN_TOWERS,
      innerKeepLevels: SCALE.MIN_LEVELS,
      grandeur: 0,
      detailMode: false,
      detailMultiplier: 1,
    };
  }

  // ── Size parameter t ∈ [0, 1]  (log-scaled, capped at SIZE_CAP) ──
  const logRange = Math.log10(SCALE.SIZE_CAP_MCAP / SCALE.MIN_MCAP); // ≈ 4.699
  const t = Math.min(1, Math.log10(marketCap / SCALE.MIN_MCAP) / logRange);

  // ── Physical dimensions (linear interpolation on t) ──
  const baseCastleHeight = SCALE.MIN_HEIGHT + (SCALE.MAX_HEIGHT - SCALE.MIN_HEIGHT) * t;
  const towerCount       = Math.floor(SCALE.MIN_TOWERS + (SCALE.MAX_TOWERS - SCALE.MIN_TOWERS) * t);
  const innerKeepLevels  = Math.max(SCALE.MIN_LEVELS, Math.floor(SCALE.MIN_LEVELS + (SCALE.MAX_LEVELS - SCALE.MIN_LEVELS) * t));

  // ── Grandeur (extends above size cap for material / glow systems) ──
  const grandeurRange = Math.log10(SCALE.GRANDEUR_CAP_MCAP / SCALE.MIN_MCAP); // ≈ 5.301
  const grandeur = Math.min(1, Math.log10(marketCap / SCALE.MIN_MCAP) / grandeurRange);

  // ── Detail multiplier (>1 only above size cap) ──
  const detailMode = marketCap > SCALE.SIZE_CAP_MCAP;
  const detailMultiplier = detailMode
    ? 1 + Math.log10(marketCap / SCALE.SIZE_CAP_MCAP)   // e.g. 1B → 1.301, 2B → 1.602
    : 1;

  return {
    baseCastleHeight,
    towerCount,
    innerKeepLevels,
    grandeur,
    detailMode,
    detailMultiplier,
  };
}

// ── Wall defense constants ──────────────────────────────────────────────────
//
// Liquidity-to-market-cap ratio is the core health signal for wall strength.
// A well-liquefied token (ratio ≥ 10%) has thick, buttressed walls with no
// cracks.  A thinly-liquefied token (ratio < 1%) has paper-thin walls that
// are visibly crumbling.
//
// Step 1 — wallStrengthScore:
//   liquidityRatio  = liquidity / marketCap            (raw, unbounded)
//   wallStrengthScore = clamp(log10(liquidityRatio * 100), 0, 1)
//
//   This maps:  ratio 0.01 (1%)  → score 0.0
//               ratio 0.10 (10%) → score 1.0
//               ratio 0.03 (3%)  → score ≈ 0.48
//               ratio 0.05 (5%)  → score ≈ 0.70
//
// Step 2 — Discrete tier bucketing (overrides minor interpolation wobble):
//
//   Score range       Tier          Visual intent
//   ─────────────────────────────────────────────────
//   [0.00, 0.20)      fragile       Paper-thin walls, many cracks, no reinforcement
//   [0.20, 0.40)      weak          Thin walls, visible cracks, wooden bracing
//   [0.40, 0.60)      reinforced    Medium walls, few cracks, iron bands
//   [0.60, 0.80)      fortress      Thick walls, clean stone, stone buttresses
//   [0.80, 1.00]      citadel       Massive walls, zero cracks, steel-clad
//
// Step 3 — Per-tier output overrides:
//
//   Trait                fragile    weak    reinforced   fortress   citadel
//   ────────────────────────────────────────────────────────────────────────
//   wallThickness (m)     0.15      0.30       0.55       0.85       1.20
//   wallHeightMult        0.70      0.85       1.00       1.20       1.40
//   buttressCount           0         1          3          5          8
//   crackDensity           0.9       0.5        0.2       0.05         0
//   reinforcementType     none      wood       iron      stone      steel

/**
 * Compute wall defense visuals from liquidity and market cap.
 *
 * The liquidity-to-market-cap ratio is the fundamental measure of how
 * "defensible" a token position is.  High liquidity relative to cap means
 * trades don't move price much (thick walls, hard to breach).  Low liquidity
 * means even small sells crater the price (fragile walls, many cracks).
 *
 * The score is log-scaled so that the common range (1-10% ratio) maps
 * to the full 0-1 visual range, and the result is snapped to one of five
 * discrete tiers to guarantee perceptible differences at default camera
 * distance.
 *
 * @param liquidity  Token pool liquidity in USD
 * @param marketCap  Token market cap in USD
 * @returns          WallDefense with all visual outputs + tooltip
 */
export function computeWallDefense(liquidity: number, marketCap: number): WallDefense {
  // ── Step 1: wallStrengthScore ─────────────────────────────────────────
  // Guard: avoid division by zero or nonsensical inputs
  if (marketCap <= 0 || liquidity <= 0) {
    const def = WALL_DEFENSE.TIER_DEFS.fragile;
    return {
      wallStrengthScore: 0,
      tier: 'fragile',
      ...def,
      tooltip: buildTooltip(0, 0, 'fragile'),
    };
  }

  const liquidityRatio = liquidity / marketCap;
  // log10(ratio * 100): ratio 0.01 → 0, ratio 0.1 → 1
  const rawScore = Math.log10(liquidityRatio * 100);
  const wallStrengthScore = Math.max(0, Math.min(1, rawScore));

  // ── Step 2: Snap to discrete tier ─────────────────────────────────────
  let tier: WallStrengthTier = 'fragile';
  for (const [threshold, t] of WALL_DEFENSE.TIER_THRESHOLDS) {
    if (wallStrengthScore >= threshold) {
      tier = t;
      break;
    }
  }

  // ── Step 3: Tier-defined visual outputs ───────────────────────────────
  const def = WALL_DEFENSE.TIER_DEFS[tier];

  return {
    wallStrengthScore,
    tier,
    ...def,
    tooltip: buildTooltip(wallStrengthScore, liquidityRatio, tier),
  };
}

/** Build a plain-language tooltip explaining the wall strength */
function buildTooltip(score: number, ratio: number, tier: WallStrengthTier): string {
  const pct = (ratio * 100).toFixed(1);
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const desc = WALL_DEFENSE.TIER_DESCRIPTIONS[tier];
  return `Wall Strength: ${tierLabel} (${(score * 100).toFixed(0)}%)\n` +
    `Liquidity is ${pct}% of market cap.\n` +
    desc;
}

// ── Holders → Population indicators ─────────────────────────────────────────
//
// Holders count represents the *structural* community size — people who own
// the token, not necessarily trading right now.  This is distinct from
// `populationDensity` (driven by 24h txn/wallet counts) which measures
// *transient* activity.
//
// Design philosophy: **animation intensity over object count.**
// Rather than spawning more NPCs (GPU-expensive, visually cluttered),
// we modulate *how alive* existing NPCs feel:
//   - npcDensity:            walk speed, idle sway amplitude, gesture frequency
//   - windowLightCount:      how many windows glow (capped at 12 to stay readable)
//   - courtyardActivityLevel: smoke drift speed, torch flicker rate, ambient bustle
//
// Log-scaled so the common 100 → 100K holder range produces useful variance:
//
//   holdersNorm = clamp(log10(max(1, holders)) / log10(REF_MAX), 0, 1)
//
//   holders    holdersNorm   npcDensity   windowLights   courtyardActivity
//   ────────── ────────────  ──────────   ────────────   ─────────────────
//         1        0.00         0.05            0              0.00
//        10        0.20         0.24            2              0.15
//       100        0.40         0.43            5              0.36
//      1000        0.60         0.62            7              0.56
//     10000        0.80         0.81           10              0.76
//    100000        1.00         1.00           12              1.00

/**
 * Translate holders count into internal population indicators.
 *
 * All outputs prefer animation intensity over object count:
 * - `npcDensity` drives walk speed, idle sway, gesture frequency — NOT spawn rate
 * - `windowLightCount` is an integer cap on visible lit windows — NOT real lights
 * - `courtyardActivityLevel` drives smoke speed, torch flicker — NOT extra meshes
 *
 * @param holders  Total holder/wallet count for the token
 * @returns        PopulationIndicators with numeric ranges documented on the interface
 */
export function computePopulationIndicators(holders: number): PopulationIndicators {
  // ── Log-scale normalization ───────────────────────────────────────────
  const safeHolders = Math.max(1, holders);
  const logMax = Math.log10(POPULATION.REF_MAX); // 5.0
  const holdersNorm = Math.min(1, Math.log10(safeHolders) / logMax);

  // ── npcDensity (0.05 → 1.0) ──────────────────────────────────────────
  // Smooth power curve with a floor so ghost towns still have a flicker of life.
  // Using sqrt to front-load the gains: the first thousand holders have the
  // most visual impact; going from 10K → 100K adds only the last ~10%.
  const npcDensity = POPULATION.NPC_DENSITY_FLOOR + (1 - POPULATION.NPC_DENSITY_FLOOR) * Math.sqrt(holdersNorm);

  // ── windowLightCount (0 → 12) ────────────────────────────────────────
  // Integer count.  Ramps linearly with holdersNorm for easy readability.
  // 0 holders → 0 lights, ~100 holders → 5, ~10K → 10, 100K+ → 12.
  const windowLightCount = Math.round(holdersNorm * POPULATION.MAX_WINDOW_LIGHTS);

  // ── courtyardActivityLevel (0 → 1.0) ─────────────────────────────────
  // Cubic ease-in: courtyard feels quiet until there's a real crowd.
  // holders < ~30 → essentially idle.  Ramps gently, then surges past 1K.
  const courtyardActivityLevel = Math.pow(holdersNorm, 1.5);

  return {
    npcDensity,
    windowLightCount,
    courtyardActivityLevel,
    holdersNorm,
  };
}

// ── Economic activity → animation controls ──────────────────────────────────
//
// Combines three raw 24h signals into a single composite score that drives
// animation intensity across the castle.  Unlike `populationDensity` (which
// focuses on wallet diversity for NPC count) or `ActivityLevel` (which is
// a discrete enum from volume *ratio*), this produces a continuous 0–1 score
// from the *absolute magnitudes* of all three economic indicators.
//
// Design goal: **small tokens remain readable.**
// A token with only 5 txns, 3 wallets, and $200 volume must still produce a
// non-zero score so the castle doesn't look frozen.  The log-scale
// normalization and output floors guarantee this.
//
// ── Normalization ───────────────────────────────────────────────────────────
//
// Each input is independently log-normalized against a reference ceiling,
// then combined with weights reflecting visual salience:
//
//   txnNorm    = clamp(log10(max(1, txnCount24))           / log10(50_000),  0, 1)
//   walletNorm = clamp(log10(max(1, uniqueTransactions24)) / log10(10_000),  0, 1)
//   volumeNorm = clamp(log10(max(1, volume24h))            / log10(50_000_000), 0, 1)
//
//   activityScore = txnNorm × 0.35 + walletNorm × 0.35 + volumeNorm × 0.30
//
// Weights:
//   - txnCount24 (35%): raw throughput — many trades = bustling marketplace
//   - uniqueTransactions24 (35%): crowd diversity — many wallets = many visitors
//   - volume24h (30%): economic mass — large volume = wealthy kingdom
//   Volume is slightly lower because a single whale trade can spike it without
//   implying broad activity.
//
// ── Output mapping ──────────────────────────────────────────────────────────
//
//   activityScore   animSpeed   bannerMotion   smokeRate
//   ──────────────  ─────────   ────────────   ─────────
//        0.00         0.15         0.05          0.00
//        0.10         0.34         0.14          0.10
//        0.25         0.61         0.29          0.44
//        0.50         1.08         0.53          1.06
//        0.75         1.54         0.76          1.84
//        1.00         2.00         1.00          3.00

/**
 * Compute economic activity score and animation controls from
 * txnCount24, uniqueTransactions24, and volume24h.
 *
 * Produces a single composite `activityScore` (0–1) and three
 * downstream animation multipliers that renderers apply directly.
 * All outputs have non-zero floors so small tokens remain visually
 * alive — a castle with 2 txns, 1 wallet, and $50 volume will still
 * show faint flag ripple and slow NPC drift.
 *
 * @param txnCount24           Total transactions in the last 24 hours
 * @param uniqueTransactions24 Unique wallets transacting in the last 24 hours
 * @param volume24h            Total trade volume in USD in the last 24 hours
 * @returns                    EconomicActivity with score + animation outputs
 */
export function computeEconomicActivity(
  txnCount24: number,
  uniqueTransactions24: number,
  volume24h: number,
): EconomicActivity {
  // ── Per-channel log-normalization ──────────────────────────────────────
  const txnNorm    = Math.min(1, Math.log10(Math.max(1, txnCount24))           / Math.log10(ECONOMY.TXN_REF_MAX));
  const walletNorm = Math.min(1, Math.log10(Math.max(1, uniqueTransactions24)) / Math.log10(ECONOMY.WALLET_REF_MAX));
  const volumeNorm = Math.min(1, Math.log10(Math.max(1, volume24h))            / Math.log10(ECONOMY.VOLUME_REF_MAX));

  // ── Composite score ───────────────────────────────────────────────────
  const activityScore = txnNorm * ECONOMY.W_TXN + walletNorm * ECONOMY.W_WALLET + volumeNorm * ECONOMY.W_VOLUME;

  // ── Animation speed (0.15 → 2.0) ─────────────────────────────────────
  // Linear ramp with a floor.  Small tokens get slow-motion drift;
  // booming tokens get double-speed hustle.
  const animationSpeed = ECONOMY.ANIM_SPEED_FLOOR + (ECONOMY.ANIM_SPEED_CEIL - ECONOMY.ANIM_SPEED_FLOOR) * activityScore;

  // ── Banner motion intensity (0.05 → 1.0) ─────────────────────────────
  // Linear ramp.  Even at score 0 the cloth has a tiny ripple (wind exists).
  const bannerMotionIntensity = ECONOMY.BANNER_FLOOR + (1.0 - ECONOMY.BANNER_FLOOR) * activityScore;

  // ── Smoke emission rate (0.0 → 3.0) ──────────────────────────────────
  // Power curve (^1.4) so smoke stays sparse at low activity and ramps
  // visibly only once there's genuine economic mass.  This prevents
  // smoke-heavy scenes for tokens with only a handful of txns.
  const smokeEmissionRate = ECONOMY.SMOKE_CEIL * Math.pow(activityScore, 1.4);

  return {
    activityScore,
    animationSpeed,
    bannerMotionIntensity,
    smokeEmissionRate,
  };
}

// ── Buy/sell pressure → castle readiness ─────────────────────────────────────
//
// The ratio of buy transactions to total transactions over 24h measures the
// "mood at the gate" — are visitors arriving (buying) or fleeing (selling)?
//
// pressureRatio = buyCount24 / (buyCount24 + sellCount24)
//
// A balanced market sits at 0.5.  The three visual outputs use smooth curves
// centred on that midpoint so there are no jarring binary flips:
//
//   1. gateOpenPercentage — how far the castle gates stand open.
//      Pure buying (ratio = 1) → gates wide open (1.0), welcoming traders.
//      Pure selling (ratio = 0) → gates sealed shut (0.05), defensive lockdown.
//      Balanced (0.5) → gates at 55% — slightly open, cautiously welcoming.
//      Uses a shifted sigmoid so the transition is gentle around the midpoint.
//
//   2. guardAlertLevel — patrol urgency of castle guards.
//      Sell-heavy → guards on high alert (1.0): faster patrol, raised weapons.
//      Buy-heavy  → guards relaxed (0.05): slow stroll, lowered weapons.
//      This is the *inverse* of gateOpenPercentage, scaled differently.
//      Uses a power curve on the sell fraction for a steeper response to panic.
//
//   3. shieldVisibility — energy barrier / magic shield opacity.
//      Only becomes visible when selling pressure dominates (ratio < 0.45).
//      Ramps smoothly from 0 → 1 as ratio drops from 0.45 → 0.
//      Uses a quadratic ease-in so mild sell pressure barely shows the shield,
//      but heavy selling makes it glow brightly.
//
// ── Output reference table ──────────────────────────────────────────────────
//
//   pressureRatio   gateOpen   guardAlert   shieldVis
//   ─────────────   ────────   ──────────   ─────────
//        0.00         0.05       1.00         1.00
//        0.15         0.12       0.86         0.84
//        0.30         0.28       0.64         0.50
//        0.45         0.48       0.38         0.01
//        0.50         0.55       0.30         0.00
//        0.65         0.72       0.16         0.00
//        0.80         0.86       0.06         0.00
//        1.00         1.00       0.00         0.00

/**
 * Determine castle readiness state from buy/sell transaction pressure.
 *
 * All three outputs use smooth interpolation — no binary states.  A castle
 * that is 60% buys looks subtly different from one at 40% buys; the user
 * never sees a sudden flip.
 *
 * When buy/sell data is unavailable (both zero), the castle assumes a
 * neutral balanced posture (pressureRatio = 0.5).
 *
 * @param buyCount24   Number of buy transactions in the last 24 hours
 * @param sellCount24  Number of sell transactions in the last 24 hours
 * @returns            CastleReadiness with all visual outputs
 */
export function computeCastleReadiness(
  buyCount24: number,
  sellCount24: number,
): CastleReadiness {
  // ── Pressure ratio ──────────────────────────────────────────────────
  // Guard: if both are zero (no data / dead token), assume balanced.
  const total = buyCount24 + sellCount24;
  const pressureRatio = total > 0
    ? buyCount24 / total
    : 0.5;

  // ── Gate open percentage (0.05 → 1.0) ──────────────────────────────
  // Shifted sigmoid: steep around 0.5, compresses at the extremes.
  //   f(r) = floor + (1 - floor) × sigmoid(k × (r - 0.5))
  // where sigmoid(x) = 1 / (1 + e^(-x)) mapped to 0–1.
  const gateSigmoid = 1 / (1 + Math.exp(-READINESS.GATE_SIGMOID_K * (pressureRatio - 0.5)));
  const gateOpenPercentage = READINESS.GATE_FLOOR + (1 - READINESS.GATE_FLOOR) * gateSigmoid;

  // ── Guard alert level (0 → 1.0) ────────────────────────────────────
  // Driven by the sell fraction (1 - pressureRatio).  Power curve
  // gives a steeper ramp when selling dominates — guards respond faster
  // to panic than they relax during euphoria.
  const sellFraction = 1 - pressureRatio;
  const guardRaw = Math.pow(sellFraction, READINESS.GUARD_POWER);
  // When sellFraction is exactly 0 (pure buying), no alert at all.
  // Otherwise maintain a tiny floor so guards never look completely asleep.
  const guardAlertLevel = sellFraction === 0
    ? 0
    : Math.max(READINESS.GUARD_ALERT_FLOOR, guardRaw);

  // ── Shield visibility (0 → 1.0) ────────────────────────────────────
  // Only activates when sell pressure dominates (ratio < SHIELD_ONSET).
  // Quadratic ease-in: mild selling = faint shimmer, heavy selling = full barrier.
  let shieldVisibility = 0;
  if (pressureRatio < READINESS.SHIELD_ONSET_RATIO) {
    const shieldT = (READINESS.SHIELD_ONSET_RATIO - pressureRatio) / READINESS.SHIELD_ONSET_RATIO; // 0–1
    shieldVisibility = shieldT * shieldT;  // quadratic ease-in
  }

  return {
    pressureRatio,
    gateOpenPercentage,
    guardAlertLevel,
    shieldVisibility,
  };
}

// ── Token age → architectural heritage ───────────────────────────────────────
//
// Token age measures how long a castle has stood.  Older tokens should feel
// *established* — stately, layered, storied — NOT decayed.  Decay is driven
// by market-cap distance from ATH (see `computeDecay`), not by age.
//
// The three outputs map age onto visual qualities that accrue with time:
//
//   1. architecturalLayering — the number of "eras" visible in the stonework.
//      A brand-new token has a single clean style.  Over weeks the castle
//      gains visible additions: an extended wing, a second gatehouse, mixed
//      stone colors implying generations of builders.
//      Uses sqrt(ageNorm) so the first month produces the most visible jump,
//      matching the real-world pattern where early growth is most dramatic.
//
//   2. presenceOfStatues — monument density across the castle grounds.
//      Statues don't appear immediately; the first ~7 days yield zero.
//      After that onset period they accumulate linearly, reaching full
//      gallery density at the reference ceiling (365 days).
//      The onset delay prevents brand-new tokens from looking decorated.
//
//   3. materialWearLevel — patina / moss / weathering on stone surfaces.
//      Conveys *character*, not damage: increased roughness, subtle color
//      shift toward mossy green/warm amber, softened edges.  Crucially,
//      this does NOT add cracks (that's `WallDefense.crackDensity`).
//      Uses a gentler power curve (^0.7) so wear accumulates fastest in
//      the first few months, then levels off into a distinguished plateau.
//
// Log-scaled against a 365-day reference ceiling:
//   ageNorm = clamp(log10(max(1, ageDays)) / log10(365), 0, 1)
//
// ── Output reference table ──────────────────────────────────────────────────
//
//   ageDays   ageNorm   layering   statues   wearLevel
//   ───────   ───────   ────────   ───────   ─────────
//        1     0.00       0.00      0.00       0.00
//        3     0.19       0.43      0.00       0.25
//        7     0.33       0.57      0.00       0.41
//       14     0.45       0.67      0.14       0.52
//       30     0.58       0.76      0.29       0.63
//       90     0.76       0.87      0.54       0.79
//      180     0.88       0.94      0.74       0.90
//      365     1.00       1.00      1.00       1.00

/**
 * Map token age to architectural heritage indicators.
 *
 * Older tokens feel *established* — layered stonework, monument statues,
 * dignified patina — without any implication of damage or decline.
 * All outputs use smooth interpolation with no binary jumps.
 *
 * @param createdAt  Token creation timestamp (ms since epoch)
 * @param now        Current timestamp (ms since epoch), defaults to Date.now()
 * @returns          TokenHeritage with all visual maturity outputs
 */
export function computeTokenHeritage(
  createdAt: number,
  now: number = Date.now(),
): TokenHeritage {
  // ── Age in days ─────────────────────────────────────────────────────
  const ageMs = Math.max(0, now - createdAt);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // ── Log-normalized age (0–1) ────────────────────────────────────────
  const safeAge = Math.max(1, ageDays);
  const logMax = Math.log10(HERITAGE.AGE_REF_DAYS);  // ≈ 2.562
  const ageNorm = Math.min(1, Math.log10(safeAge) / logMax);

  // ── Architectural layering (0 → 1.0) ───────────────────────────────
  // sqrt gives front-loaded gains: the first month of existence adds the
  // most visible architectural complexity.  Going from 6 months → 12 months
  // adds only a subtle polish.
  const architecturalLayering = Math.sqrt(ageNorm);

  // ── Presence of statues (0 → 1.0) ──────────────────────────────────
  // Delayed onset: no statues until STATUE_ONSET_DAYS, then linear ramp.
  // A 1-day-old token should look fresh, not already decorated.
  let presenceOfStatues = 0;
  if (ageDays > HERITAGE.STATUE_ONSET_DAYS) {
    // After onset, normalize remaining age range into 0–1
    const statueAgeNorm = Math.min(1,
      Math.log10(ageDays / HERITAGE.STATUE_ONSET_DAYS) / Math.log10(HERITAGE.AGE_REF_DAYS / HERITAGE.STATUE_ONSET_DAYS));
    presenceOfStatues = statueAgeNorm;
  }

  // ── Material wear level (0 → 1.0) ──────────────────────────────────
  // Power curve (^0.7): wear accumulates quickly in the first months,
  // then asymptotes into a distinguished "aged stone" look.
  // This is character, not damage — roughness and moss, not cracks.
  const materialWearLevel = Math.pow(ageNorm, HERITAGE.WEAR_POWER);

  return {
    ageDays,
    ageNorm,
    architecturalLayering,
    presenceOfStatues,
    materialWearLevel,
  };
}

// ── Wallet age distribution → kingdom stability ──────────────────────────────
//
// The *age* of wallets actively trading a token tells us about the crowd's
// character.  Old wallets = experienced holders who've been in crypto a long
// time.  Young wallets = fresh accounts, possibly bots or hype chasers.
//
// Two signals from the Codex API:
//   walletAgeAvg — mean wallet age in seconds of wallets that traded in 24h
//   walletAgeStd — standard deviation of wallet ages in seconds
//
// The visual metaphor: a castle built on stable ground vs. shaky earth.
//
//   High avg + low std  → Stable kingdom: experienced, homogeneous crowd.
//                          Towers are plumb, foundation is level, no tremor.
//
//   Low avg + high std  → Unstable kingdom: mixed crowd of new & old wallets.
//                          Towers lean slightly, foundation uneven, subtle shake.
//
//   High avg + high std → Interesting: experienced crowd with outsiders arriving.
//                          Towers mostly straight but some lean. Foundation fair.
//
// ── Normalization ───────────────────────────────────────────────────────────
//
// Both inputs are log-scaled against reference ceilings so the common ranges
// produce useful variance:
//
//   maturityNorm  = clamp(log10(max(1, avgSeconds) / 86400) / log10(REF_AVG_DAYS), 0, 1)
//   diversityNorm = clamp(log10(max(1, stdSeconds) / 86400) / log10(REF_STD_DAYS), 0, 1)
//
// ── Output mapping ──────────────────────────────────────────────────────────
//
//   The stability score combines both signals:
//     stability = maturityNorm × (1 - diversityNorm × 0.6)
//
//   High maturity lifts stability; high diversity drags it down (but not
//   completely — even a diverse experienced crowd is partially stable).
//
//   maturityNorm  diversityNorm  towerVar  vibration  foundation
//   ────────────  ─────────────  ────────  ─────────  ──────────
//      0.00           0.00        0.25       0.08        0.50
//      0.00           1.00        0.70       0.35        0.10
//      0.50           0.00        0.12       0.04        0.75
//      0.50           0.50        0.22       0.12        0.58
//      1.00           0.00        0.00       0.00        1.00
//      1.00           0.50        0.10       0.07        0.82
//      1.00           1.00        0.25       0.15        0.60

/**
 * Map wallet age distribution to structural stability indicators.
 *
 * A high average wallet age with low standard deviation means a stable,
 * experienced, homogeneous holder base — the castle stands rock-solid
 * on level ground with perfectly aligned towers.
 *
 * High standard deviation (regardless of average) introduces structural
 * irregularity: slight tower lean, faint vibration, uneven foundation.
 * This reflects the uncertainty of a mixed crowd.
 *
 * When wallet age data is unavailable (both zero/undefined), the castle
 * assumes a neutral mid-range posture — neither perfectly stable nor
 * visibly shaky.
 *
 * @param walletAgeAvg  Average wallet age in seconds (of 24h active wallets)
 * @param walletAgeStd  Std deviation of wallet ages in seconds
 * @returns             KingdomStability with tower/vibration/foundation outputs
 */
export function computeKingdomStability(
  walletAgeAvg: number,
  walletAgeStd: number,
): KingdomStability {
  // ── Log-normalize both inputs to days ───────────────────────────────
  const avgDays = Math.max(1, walletAgeAvg) / STABILITY.SECONDS_PER_DAY;
  const stdDays = Math.max(1, walletAgeStd) / STABILITY.SECONDS_PER_DAY;

  const logRefAvg = Math.log10(STABILITY.WALLET_AGE_REF_DAYS);  // ≈ 2.255
  const logRefStd = Math.log10(STABILITY.WALLET_STD_REF_DAYS);  // ≈ 1.954

  const maturityNorm  = Math.min(1, Math.log10(avgDays) / logRefAvg);
  const diversityNorm = Math.min(1, Math.log10(stdDays) / logRefStd);

  // ── Composite stability: maturity lifts, diversity drags ────────────
  // The DIVERSITY_DRAG weight on diversity means even a fully diverse crowd only
  // pulls stability down to 40% of what maturity alone would give.
  const stability = Math.max(0, maturityNorm * (1 - diversityNorm * STABILITY.DIVERSITY_DRAG));

  // ── Tower alignment variance (0 → MAX_TOWER_VARIANCE) ──────────────
  // High diversity → towers lean.  High maturity dampens the effect.
  // Base variance from diversity, reduced by maturity.
  // Power curve on diversity so mild mixing barely shows.
  const rawTowerVar = Math.pow(diversityNorm, STABILITY.TOWER_VAR_POWER) * STABILITY.MAX_TOWER_VARIANCE;
  const maturityDamping = 1 - maturityNorm * STABILITY.MATURITY_DAMPING;  // mature crowds reduce lean
  const towerAlignmentVariance = rawTowerVar * maturityDamping;

  // ── Vibration amplitude (0 → MAX_VIBRATION) ────────────────────────
  // Subtle structural tremor.  Driven by inverse stability.
  // Capped low to stay subtle — this is a hint, not an earthquake.
  const vibrationAmplitude = (1 - stability) * STABILITY.MAX_VIBRATION;

  // ── Foundation evenness (FOUNDATION_FLOOR → 1.0) ───────────────────
  // Direct map from stability.  Floor so even the most chaotic
  // token doesn't look like it's floating — the castle always has ground.
  const foundationEvenness = STABILITY.FOUNDATION_FLOOR + (1 - STABILITY.FOUNDATION_FLOOR) * stability;

  return {
    maturityNorm,
    diversityNorm,
    towerAlignmentVariance,
    vibrationAmplitude,
    foundationEvenness,
  };
}

// ── Risk metrics → corruption overlay ────────────────────────────────────────
//
// Token risk signals map to a visual "corruption" that taints the castle.
// This is intentionally unsettling — dark veins in stone, unnatural shadows,
// sickly color shifts — to signal caution without making the castle unusable.
//
// Four input signals, each contributing independently:
//
//   devHeldPercentage     — % of supply in dev wallet.  > 20% is concerning.
//   insiderHeldPercentage — % of supply in insider wallets.  > 30% is red flag.
//   sniperCount           — bots that sniped the launch.  > 10 is suspicious.
//   isScam                — hard flag from Codex.  Overrides everything to max.
//
// ── Design constraint ───────────────────────────────────────────────────────
//
//   Corruption must be **visible but not dominant** unless extreme:
//     • corruptionIntensity < 0.3 → subtle tint, barely noticeable veins
//     • corruptionIntensity 0.3–0.6 → clearly visible but castle still readable
//     • corruptionIntensity > 0.6 → unmistakably corrupted, strong warning
//     • isScam = true → forced to 0.95, nearly maximum corruption
//
// ── Channel weights ─────────────────────────────────────────────────────────
//
//   Each channel is independently normalized to 0–1, then combined:
//     devScore     = clamp(devHeld / 50, 0, 1)          weight 0.35
//     insiderScore = clamp(insiderHeld / 60, 0, 1)      weight 0.30
//     sniperScore  = clamp(log10(max(1,snipers)) / log10(50), 0, 1)  weight 0.20
//     scamOverride                                       weight 0.15 (binary boost)
//
//   corruptionIntensity = weighted sum, clamped to [0, 1]
//
// ── Output mapping reference ────────────────────────────────────────────────
//
//   intensity   veinDensity  shadowDepth  decayOpacity  hueShift  satDrain  brightLoss
//   ─────────   ───────────  ───────────  ────────────  ────────  ────────  ──────────
//     0.00         0.00         0.00         0.00        0.000     0.00       0.00
//     0.10         0.04         0.02         0.01       -0.015     0.05       0.03
//     0.25         0.12         0.06         0.04       -0.038     0.13       0.08
//     0.40         0.24         0.13         0.10       -0.060     0.20       0.12
//     0.60         0.47         0.26         0.22       -0.090     0.30       0.18
//     0.80         0.74         0.44         0.38       -0.120     0.40       0.24
//     0.95         0.93         0.57         0.50       -0.143     0.48       0.29
//     1.00         1.00         0.62         0.55       -0.150     0.50       0.30

/**
 * Compute corruption overlay from token risk metrics.
 *
 * Produces a composite corruption score and downstream visual indicators
 * that taint the castle — dark veins, deepened shadows, surface decay,
 * and sickly color shifts.  The effect is calibrated to be *visible but
 * not dominant* at low-to-moderate risk, escalating to unmistakable
 * corruption only when metrics are genuinely alarming.
 *
 * When risk data is unavailable (all undefined/zero), corruption is zero
 * and the castle renders clean.
 *
 * @param devHeldPercentage     % of token supply held by the dev wallet (0–100)
 * @param insiderHeldPercentage % of token supply held by insider wallets (0–100)
 * @param sniperCount           Number of sniper bots that bought at launch
 * @param isScam                Whether the token is flagged as a confirmed scam
 * @returns                     CorruptionOverlay with intensity, visual indicators, and color shift
 */
export function computeCorruptionOverlay(
  devHeldPercentage: number,
  insiderHeldPercentage: number,
  sniperCount: number,
  isScam: boolean,
): CorruptionOverlay {
  // ── Per-channel normalization (each → 0–1) ─────────────────────────
  const devScore = Math.min(1, Math.max(0, devHeldPercentage) / CORRUPTION.DEV_HELD_SATURATION);

  const insiderScore = Math.min(1, Math.max(0, insiderHeldPercentage) / CORRUPTION.INSIDER_HELD_SATURATION);

  // Snipers: log-scaled since the difference between 1 and 5 matters more
  // than between 40 and 45.
  const sniperScore = sniperCount > 0
    ? Math.min(1, Math.log10(Math.max(1, sniperCount)) / Math.log10(CORRUPTION.SNIPER_REF_MAX))
    : 0;

  const scamScore = isScam ? 1 : 0;

  // ── Composite corruption intensity ──────────────────────────────────
  let corruptionIntensity =
    devScore     * CORRUPTION.W_DEV +
    insiderScore * CORRUPTION.W_INSIDER +
    sniperScore  * CORRUPTION.W_SNIPER +
    scamScore    * CORRUPTION.W_SCAM;

  corruptionIntensity = Math.min(1, corruptionIntensity);

  // Scam override: if flagged, force to at least SCAM_FLOOR_INTENSITY
  if (isScam) {
    corruptionIntensity = Math.max(CORRUPTION.SCAM_FLOOR_INTENSITY, corruptionIntensity);
  }

  // ── Visual indicators ───────────────────────────────────────────────
  // Each uses a different power curve to control how quickly the effect
  // becomes noticeable.  Low corruption → barely visible; high → stark.

  // Vein density: veins stay faint at low corruption, then spread rapidly.
  const veinDensity = Math.pow(corruptionIntensity, CORRUPTION.VEIN_POWER);

  // Shadow depth: shadows deepen slowly, then dramatically.
  // Capped so the castle is never completely blacked out.
  const shadowDepth = Math.min(CORRUPTION.SHADOW_MAX, Math.pow(corruptionIntensity, CORRUPTION.SHADOW_POWER) * CORRUPTION.SHADOW_SCALE);

  // Decay opacity: capped so underlying textures always show through.
  // This is sickly corrosion, not age patina.
  const decayOpacity = Math.min(CORRUPTION.DECAY_MAX, Math.pow(corruptionIntensity, CORRUPTION.DECAY_POWER) * CORRUPTION.DECAY_SCALE);

  // ── Color shift [hueShift, saturationDrain, brightnessLoss] ─────────
  // Hue shifts toward sickly green (negative in HSL space).
  // Saturation drains toward grey.
  // Brightness dims.
  // All use linear ramp from intensity — the hue shift is the most
  // immediately noticeable, so it's the primary visual signal.
  const hueShift = CORRUPTION.MAX_HUE_SHIFT * corruptionIntensity;
  const saturationDrain = CORRUPTION.MAX_SAT_DRAIN * corruptionIntensity;
  const brightnessLoss = CORRUPTION.MAX_BRIGHT_LOSS * corruptionIntensity;

  return {
    corruptionIntensity,
    visualIndicators: {
      veinDensity,
      shadowDepth,
      decayOpacity,
    },
    colorShift: [hueShift, saturationDrain, brightnessLoss],
    isScamFlagged: isScam,
  };
}

// ── Price change → environmental weather ─────────────────────────────────────
//
// Maps token price momentum into atmospheric mood that enhances the castle
// scene without obscuring it.  All four inputs contribute to a composite
// picture of "how the market feels right now":
//
//   change1   — 1-hour price change (%)  — fast mood signal
//   change24  — 24-hour price change (%) — trend signal
//   high24    — 24-hour high price        — }  together with low24,
//   low24     — 24-hour low price         — }  measures volatility
//
// ── Design constraints ───────────────────────────────────────────────────────
//
//   1. Weather must enhance mood, never obscure the castle.
//      • cloudDensity caps at 0.70 (always see through)
//      • windStrength caps at 0.60 (flags snap but don't glitch)
//      • storm only triggers on severe dumps (< -25%)
//      • fog for mild negative drift, not total whiteout
//
//   2. Neutral/positive price → pleasant weather (warm light, clear skies).
//      Negative price → gloomy weather (cool light, clouds, precipitation).
//
//   3. Volatility (high-low spread) → wind + lightning flicker intensity,
//      independent of direction.
//
// ── Output mapping reference ─────────────────────────────────────────────────
//
//   change24   lightTemp  clouds  wind  precip     mood
//   ─────────  ─────────  ──────  ────  ─────────  ────────
//     +30%+      0.95      0.05   0.10   none       bullish
//     +10%       0.78      0.10   0.12   none       bullish
//       0%       0.50      0.20   0.15   none       neutral
//     -10%       0.28      0.45   0.25   fog        bearish
//     -25%       0.10      0.65   0.45   rain       bearish
//     -50%+      0.02      0.70   0.60   storm      crash

/**
 * Map price change data to environmental lighting and weather.
 *
 * Produces atmospheric conditions that reflect the token's current price
 * momentum — bullish prices bring warm light and clear skies; bearish
 * prices bring clouds, fog, and eventually rain/storm.
 *
 * Volatility (high/low spread) adds wind and lightning intensity
 * independently of direction, so a volatile upswing still has gusty winds.
 *
 * @param change1   1-hour price change in percent (e.g. +5 or -12)
 * @param change24  24-hour price change in percent
 * @param high24    24-hour high price in USD
 * @param low24     24-hour low price in USD
 * @returns         PriceWeather with all atmospheric outputs
 */
export function computePriceWeather(
  change1: number,
  change24: number,
  high24: number,
  low24: number,
): PriceWeather {
  // ── Momentum: weighted blend of fast + trend, clamped to [-1, +1] ──
  const rawMomentum = (change1 * WEATHER.MOMENTUM_W1H + change24 * WEATHER.MOMENTUM_W24H) / WEATHER.CHANGE_SATURATION;
  const momentum = Math.max(-1, Math.min(1, rawMomentum));

  // ── Volatility: high-low spread as fraction of midpoint, 0–1 ──
  const midPrice = (high24 + low24) / 2;
  const volatility = midPrice > 0
    ? Math.min(1, (high24 - low24) / midPrice)
    : 0;

  // ── Light color temperature: 0 (cool/blue) → 1 (warm/golden) ──
  // Maps momentum [-1, +1] to [0, 1] with a slight warm bias at neutral.
  // Uses a sigmoid-like curve so extremes compress gently.
  const tempLinear = (momentum + 1) / 2;                    // 0–1 linear
  const lightColorTemperature = 0.5 + 0.5 * Math.sign(tempLinear - 0.5) *
    Math.pow(Math.abs(tempLinear - 0.5) * 2, WEATHER.LIGHT_TEMP_POWER) ;        // compress extremes

  // ── Cloud density: 0 → MAX_CLOUD_DENSITY ──
  // Bullish = clear, bearish = overcast.  Volatility adds a small bump.
  const bearishFactor = Math.max(0, -momentum);             // 0–1
  const cloudBase = bearishFactor * WEATHER.CLOUD_BEARISH_WEIGHT;                    // base from momentum
  const cloudVolatility = volatility * WEATHER.CLOUD_VOLATILITY_WEIGHT;                 // volatility adds haze
  const cloudDensity = Math.min(WEATHER.MAX_CLOUD_DENSITY, cloudBase + cloudVolatility);

  // ── Wind strength: 0 → MAX_WIND_STRENGTH ──
  // Primarily driven by volatility (choppy market = gusty) with a bearish bump.
  const windBase = volatility * WEATHER.WIND_VOLATILITY_WEIGHT;                        // volatile = gusty
  const windBearish = bearishFactor * WEATHER.WIND_BEARISH_WEIGHT;                  // dumps add wind
  const windStrength = Math.min(WEATHER.MAX_WIND_STRENGTH, windBase + windBearish);

  // ── Precipitation type ──
  // Only triggers on negative momentum past discrete thresholds.
  // Severity escalates: fog → rain → storm.
  let precipitationType: PriceWeather['precipitationType'] = 'none';
  if (momentum < WEATHER.PRECIP_STORM_THRESHOLD) {
    precipitationType = 'storm';
  } else if (momentum < WEATHER.PRECIP_RAIN_THRESHOLD) {
    precipitationType = 'rain';
  } else if (momentum < WEATHER.PRECIP_FOG_THRESHOLD) {
    precipitationType = 'fog';
  }

  return {
    lightColorTemperature,
    cloudDensity,
    windStrength,
    precipitationType,
    volatility,
    momentum,
  };
}

/**
 * Determine the life phase based on graduation state.
 * Simplified: no negative labels. Activity effects are driven by populationDensity.
 */
export function computePhase(
  graduation: GraduationResult
): LifePhase {
  if (!graduation.hasGraduated) return 'construction';
  if (graduation.showCelebration) return 'graduated';
  return 'thriving';
}

/**
 * Compute complete world state from token data.
 * This is the main entry point for state computation.
 */
export function computeWorldState(
  tokenData: TokenData,
  previousState: WorldState | null = null
): WorldState {
  const now = Date.now();

  // Compute sub-states
  const decay = computeDecay(tokenData.marketCap, tokenData.athMarketCap);
  const activity = computeActivity(tokenData);
  const graduation = computeGraduation(tokenData, previousState);

  // Compute tier (based on ATH, never decreases)
  const tier = computeTier(tokenData.athMarketCap, tokenData.isGraduated);

  // Compute phase (simplified — no negative labels)
  const phase = computePhase(graduation);

  // Time calculations
  const hoursSinceLastTrade = (now - tokenData.lastTradeTimestamp) / (1000 * 60 * 60);
  const tokenAgeHours = (now - tokenData.createdAt) / (1000 * 60 * 60);

  // Construction progress for pre-graduation (based on market cap growth toward graduation)
  const constructionProgress = tokenData.isGraduated
    ? 1
    : Math.min(1, tokenData.marketCap / 100_000); // rough progress toward graduation

  // ─── Identity & Mood ──────────────────────────────────────
  const exchanges = tokenData.exchanges ?? [];
  const hasMajorExchange = exchanges.some(e => e.tier === 'cex_major');

  // Price mood: abstract ratio from -1 (very bearish) to +1 (very bullish).
  // Maps priceChange24h into a clamped, gentle curve.
  // ±5% → ±0.25, ±15% → ±0.5, ±30%+ → ±0.85 cap. Never hits ±1 to keep visual range.
  const rawMood = Math.sign(tokenData.priceChange24h) *
    Math.min(0.85, Math.abs(tokenData.priceChange24h) / 35);
  const priceMood = Math.max(-1, Math.min(1, rawMood));

  return {
    tier,
    phase,
    activityLevel: activity.level,

    decay,
    volumeRatio: activity.volumeRatio,
    constructionProgress,
    populationDensity: activity.populationDensity,

    txnCount24: tokenData.txnCount24,
    uniqueTransactions24: tokenData.uniqueTransactions24,

    isLegendary: isLegendary(tokenData.athMarketCap),
    hasGraduated: graduation.hasGraduated,
    showGraduationCelebration: graduation.showCelebration,

    hoursSinceLastTrade,
    tokenAgeHours,

    marketCap: tokenData.marketCap,
    athMarketCap: tokenData.athMarketCap,
    priceChange24h: tokenData.priceChange24h,

    // Identity
    tokenName: tokenData.name,
    tokenSymbol: tokenData.symbol,
    tokenImageUrl: tokenData.imageUrl,
    exchanges,
    exchangeCount: exchanges.length,
    hasMajorExchange,
    priceMood
  };
}

// ── Performance budget ──────────────────────────────────────────────────────────
//
// Concrete per-castle object limits, LOD rules, and effect toggles.
// Combines castle tier (how complex the structure is) with economic activity
// (how busy the scene is) to produce a budget that keeps the renderer
// within GPU-safe bounds.
//
// ── Design philosophy ──────────────────────────────────────────────────────────
//
//   1. Object counts are tier-driven.
//      A hut doesn't need 20 towers or 16 NPCs — its budget is tiny.
//      A citadel needs all of them.  Counts scale step-wise per tier.
//
//   2. LOD rules are activity-driven.
//      Low-activity tokens get simpler LODs (billboard NPCs, low-poly props)
//      because the user isn't zoomed in watching animations — they're checking
//      if the token is alive at all.
//
//   3. High-cost effects are disabled below activity thresholds.
//      Corruption shaders, weather particles, shield barriers, and vibration
//      FX consume GPU per-pixel.  For dead/dying tokens these are wasted.
//
// ── Tier → max object table ─────────────────────────────────────────────────
//
//   Tier           towers walls buttr  NPCs chim  banners props trees statues lights
//   ──────────────  ──── ──── ────── ──── ────  ─────── ───── ───── ─────── ──────
//   hut               0    4     0     0    1       0      0     4      0      1
//   cottage           0    4     0     1    1       1      2     6      0      2
//   tower             1    4     0     2    1       1      3     8      0      2
//   keep              2    6     2     3    1       2      5    10      0      3
//   manor             3    8     3     5    2       3      8    12      1      4
//   castle            4   12     4     7    2       4     10    15      2      6
//   stronghold        6   16     6     9    3       5     12    18      3      7
//   fortress          8   20     8    11    4       6     15    22      4      8
//   palace           10   24    10    13    5       7     17    25      5     10
//   citadel          14   28    14    15    5       8     18    28      6     11
//   empire           17   30    18    16    6       9     19    30      7     12
//   legend           20   32    24    16    6      10     20    30      8     12

/**
 * Compute performance budget from castle tier and activity level.
 *
 * Produces hard caps on object counts (preventing runaway mesh instantiation),
 * LOD rules for NPCs/props/trees (reducing vertex count for quiet tokens),
 * and effect toggles that disable GPU-expensive shaders when the token is
 * too inactive for anyone to notice them.
 *
 * The budget is designed so that:
 * - A hut with zero activity renders in < 1000 triangles and < 10 draw calls
 * - A legend at full activity peaks at ~85K triangles and ~140 draw calls
 * - Dead tokens (activity ≈ 0) disable all per-pixel effects regardless of tier
 * - The triangle estimate is conservative (actual may be lower due to instancing)
 *
 * @param tier            Castle tier (determines max object counts)
 * @param activityScore   Economic activity score 0–1 (determines LOD + effect toggles)
 * @param corruptionIntensity  Corruption level 0–1 (corruption effect needs this > 0)
 * @returns               PerformanceBudget with all limits and toggles
 */
export function computePerformanceBudget(
  tier: CastleTier,
  activityScore: number,
  corruptionIntensity: number = 0,
): PerformanceBudget {
  const tierBudget = PERFORMANCE.TIER_BUDGETS[tier];

  // ── LOD rules: activity-driven ──────────────────────────────────────
  const npcLOD: PerformanceBudget['npcLOD'] =
    activityScore >= PERFORMANCE.LOD.FULL_THRESHOLD ? 'full' :
    activityScore >= PERFORMANCE.LOD.SIMPLE_THRESHOLD ? 'simple' : 'none';

  const propLOD: PerformanceBudget['propLOD'] =
    activityScore >= PERFORMANCE.LOD.FULL_THRESHOLD ? 'full' :
    activityScore >= PERFORMANCE.LOD.SIMPLE_THRESHOLD ? 'simple' : 'none';

  const treeLOD: PerformanceBudget['treeLOD'] =
    activityScore >= PERFORMANCE.LOD.FULL_THRESHOLD ? 'full' :
    activityScore >= PERFORMANCE.LOD.SIMPLE_THRESHOLD ? 'billboard' : 'none';

  // ── Effect toggles: disabled on low-activity tokens ─────────────────
  // Corruption only renders if there's actually corruption AND some activity
  const corruptionEffectEnabled =
    corruptionIntensity > 0.01 && activityScore >= PERFORMANCE.EFFECTS.CORRUPTION_THRESHOLD;

  const weatherParticlesEnabled = activityScore >= PERFORMANCE.EFFECTS.WEATHER_THRESHOLD;
  const shieldEffectEnabled     = activityScore >= PERFORMANCE.EFFECTS.SHIELD_THRESHOLD;
  const vibrationEnabled        = activityScore >= PERFORMANCE.EFFECTS.VIBRATION_THRESHOLD;
  const smokeEnabled            = activityScore >= PERFORMANCE.EFFECTS.SMOKE_THRESHOLD;
  const legendaryEffectsEnabled = activityScore >= PERFORMANCE.EFFECTS.LEGENDARY_THRESHOLD;
  const windowGlowEnabled       = activityScore >= PERFORMANCE.EFFECTS.WINDOW_GLOW_THRESHOLD;

  // ── Adjust triangle/draw call estimates based on LOD ────────────────
  const lodMultiplier =
    npcLOD === 'full' ? PERFORMANCE.LOD.FULL_TRI_MULT :
    npcLOD === 'simple' ? PERFORMANCE.LOD.SIMPLE_TRI_MULT : PERFORMANCE.LOD.NONE_TRI_MULT;

  const estimatedTriangles = Math.round(tierBudget.estTris * lodMultiplier);
  const estimatedDrawCalls = Math.round(tierBudget.estDrawCalls * lodMultiplier);

  return {
    maxTowers: tierBudget.maxTowers,
    maxWallSegments: tierBudget.maxWallSegments,
    maxButtresses: tierBudget.maxButtresses,
    maxNPCs: tierBudget.maxNPCs,
    maxChimneys: tierBudget.maxChimneys,
    maxBanners: tierBudget.maxBanners,
    maxProps: tierBudget.maxProps,
    maxTrees: tierBudget.maxTrees,
    maxStatues: tierBudget.maxStatues,
    maxPointLights: tierBudget.maxPointLights,
    npcLOD,
    propLOD,
    treeLOD,
    corruptionEffectEnabled,
    weatherParticlesEnabled,
    shieldEffectEnabled,
    vibrationEnabled,
    smokeEnabled,
    legendaryEffectsEnabled,
    windowGlowEnabled,
    estimatedTriangles,
    estimatedDrawCalls,
  };
}

// ── Hover tooltip templates ────────────────────────────────────────────────────
//
// Each tooltip explains the visual cause → effect for a specific feature,
// referencing the underlying metric without numeric overload.
// Templates use {placeholders} that callers fill with actual computed values.
//
// Format:
//   title — one-line feature name
//   body  — 1–2 sentence explanation of what drives the visual and what it means

export interface TooltipTemplate {
  title: string;
  body: string;
}

/**
 * Generate tooltip text for every visual feature based on current computed state.
 *
 * Returns a Record keyed by feature name.  Callers can look up any feature
 * and display its title + body on hover.  The text is pre-formatted with
 * actual values baked in — no raw numbers, just human-readable context.
 */
export function generateTooltips(opts: {
  scale: CastleScale;
  walls: WallDefense;
  population: PopulationIndicators;
  economy: EconomicActivity;
  readiness: CastleReadiness;
  heritage: TokenHeritage;
  stability: KingdomStability;
  corruption: CorruptionOverlay;
  weather: PriceWeather;
  tier: CastleTier;
  marketCap: number;
  athMarketCap: number;
}): Record<string, TooltipTemplate> {
  const {
    scale, walls, population, economy, readiness,
    heritage, stability, corruption, weather, tier,
    marketCap, athMarketCap,
  } = opts;

  const fmt = (n: number) => {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

  return {
    // ── Castle Scale ──────────────────────────────────────────
    castleSize: {
      title: `${tierLabel} (${fmt(athMarketCap)} ATH)`,
      body: `Castle size is set by all-time high market cap. Current market cap is ${fmt(marketCap)}. The structure grows logarithmically — early growth has the most dramatic visual impact.`,
    },
    towerCount: {
      title: `${scale.towerCount} Tower${scale.towerCount !== 1 ? 's' : ''}`,
      body: `Tower count scales with market cap milestones. More towers signal greater economic reach.`,
    },
    grandeur: {
      title: `Grandeur: ${pct(scale.grandeur)}`,
      body: `Overall architectural richness — material quality, ornamental detail, and glow intensity. Driven by market cap on a logarithmic curve.`,
    },
    detailMode: {
      title: scale.detailMode ? 'Detail Mode Active' : 'Size Growth Mode',
      body: scale.detailMode
        ? `Market cap exceeds $500M — the castle has reached maximum physical size. Additional growth adds ornamental complexity instead: extra pinnacles, rune pillars, particle density.`
        : `The castle is still growing physically with market cap. Beyond $500M it will switch to adding architectural detail instead of size.`,
    },

    // ── Wall Defense ──────────────────────────────────────────
    wallStrength: {
      title: `Walls: ${walls.tier.charAt(0).toUpperCase() + walls.tier.slice(1)}`,
      body: walls.tooltip,
    },

    // ── Population ────────────────────────────────────────────
    populationActivity: {
      title: `Castle Life: ${pct(population.npcDensity)}`,
      body: `Driven by holder count. More holders means livelier villager animations, more lit windows at night, and busier courtyard activity. Currently ${population.windowLightCount} windows glow after dark.`,
    },

    // ── Economic Activity ─────────────────────────────────────
    economicActivity: {
      title: `Market Activity: ${pct(economy.activityScore)}`,
      body: `Blends 24h transaction count, unique wallets, and trade volume. High activity speeds up all castle animations — NPCs walk faster, banners snap in the wind, chimneys pour smoke.`,
    },
    bannerMotion: {
      title: `Banner Intensity: ${pct(economy.bannerMotionIntensity)}`,
      body: `How vigorously flags and banners wave. Driven by trading activity — a bustling market makes cloth snap; a quiet market lets it hang limp.`,
    },
    smokeEmission: {
      title: `Chimney Smoke: ${economy.smokeEmissionRate.toFixed(1)}x`,
      body: `Smoke particle density from castle chimneys. High trade volume and transaction count stoke the forges — more economic mass means more visible smoke.`,
    },

    // ── Castle Readiness ──────────────────────────────────────
    gateStatus: {
      title: `Gates: ${pct(readiness.gateOpenPercentage)} Open`,
      body: `Gate position reflects buy vs. sell pressure. More buying opens the gates wide (welcoming traders). Heavy selling seals them shut (defensive lockdown). Currently ${Math.round(readiness.pressureRatio * 100)}% of trades are buys.`,
    },
    guardAlert: {
      title: `Guard Alert: ${pct(readiness.guardAlertLevel)}`,
      body: `How urgently guards patrol the walls. Sell pressure raises the alarm — guards move faster with weapons drawn. Buy-dominant markets let them stroll at ease.`,
    },
    shieldBarrier: {
      title: readiness.shieldVisibility > 0.01
        ? `Shield Active: ${pct(readiness.shieldVisibility)}`
        : 'Shield: Inactive',
      body: readiness.shieldVisibility > 0.01
        ? `A defensive energy barrier has appeared — sell pressure exceeds buy pressure. The stronger the selling, the brighter the shield glows.`
        : `No defensive barrier needed — buy pressure is balanced or dominant. The shield only materializes when selling outweighs buying.`,
    },

    // ── Token Heritage ────────────────────────────────────────
    architecturalAge: {
      title: `Age: ${Math.floor(heritage.ageDays)} Day${Math.floor(heritage.ageDays) !== 1 ? 's' : ''}`,
      body: `Older tokens develop layered architecture — visible additions from different eras, mixed stone styles, and monument statues. This conveys establishment, not decay.`,
    },
    materialPatina: {
      title: `Stone Patina: ${pct(heritage.materialWearLevel)}`,
      body: `Surface weathering that adds character — moss, roughened edges, warm amber tones. This is the dignity of age, not damage. Cracks are controlled separately by wall strength.`,
    },
    statues: {
      title: heritage.presenceOfStatues > 0.01
        ? `Statues: ${pct(heritage.presenceOfStatues)}`
        : 'No Statues Yet',
      body: heritage.presenceOfStatues > 0.01
        ? `Monument figures across the grounds, honoring the token's history. Statues only appear after the first week and accumulate over months.`
        : `Statues appear after the token survives its first week. They accumulate gradually as the castle's history grows.`,
    },

    // ── Kingdom Stability ─────────────────────────────────────
    foundationStability: {
      title: `Foundation: ${pct(stability.foundationEvenness)} Level`,
      body: `Driven by wallet age distribution. Experienced, homogeneous holders create a rock-solid foundation. A mixed crowd of new and old wallets makes the ground uneven.`,
    },
    towerAlignment: {
      title: stability.towerAlignmentVariance > 0.1
        ? `Towers: Slight Lean (${pct(stability.towerAlignmentVariance)})`
        : `Towers: Plumb`,
      body: `Tower alignment reflects holder diversity. When wallets of very different ages trade the token, towers develop a subtle lean. Mature, stable crowds keep towers perfectly straight.`,
    },
    structuralVibration: {
      title: stability.vibrationAmplitude > 0.05
        ? `Tremor: ${pct(stability.vibrationAmplitude)}`
        : 'No Tremor',
      body: stability.vibrationAmplitude > 0.05
        ? `A faint structural vibration from mixed holder stability. The more diverse the trading crowd, the more the castle subtly shakes.`
        : `The castle stands perfectly still — the holder base is stable and homogeneous.`,
    },

    // ── Corruption ────────────────────────────────────────────
    corruption: {
      title: corruption.isScamFlagged
        ? 'Scam Flagged — Maximum Corruption'
        : corruption.corruptionIntensity > 0.6
          ? `High Corruption: ${pct(corruption.corruptionIntensity)}`
          : corruption.corruptionIntensity > 0.2
            ? `Moderate Corruption: ${pct(corruption.corruptionIntensity)}`
            : corruption.corruptionIntensity > 0.05
              ? `Low Corruption: ${pct(corruption.corruptionIntensity)}`
              : 'Clean — No Corruption',
      body: corruption.isScamFlagged
        ? `This token is flagged as a scam. The castle is heavily tainted — dark veins in the stone, unnatural shadows, and a sickly color shift warn of danger.`
        : corruption.corruptionIntensity > 0.05
          ? `Corruption intensity is driven by developer token holdings, insider concentration, and sniper bot activity. Higher risk shows as dark veins, deepened shadows, and a greenish color tint on the castle stone.`
          : `No significant risk signals detected. Developer holdings, insider concentration, and bot activity are all within normal ranges.`,
    },

    // ── Price Weather ─────────────────────────────────────────
    weather: {
      title: weather.precipitationType === 'storm' ? 'Storm'
        : weather.precipitationType === 'rain' ? 'Rain'
        : weather.precipitationType === 'fog' ? 'Fog'
        : weather.momentum > 0.3 ? 'Clear & Warm'
        : weather.momentum > -0.1 ? 'Fair'
        : 'Overcast',
      body: `Weather reflects price momentum. Bullish prices bring warm golden light and clear skies. Bearish prices bring cool blue tones, clouds, and eventually precipitation. Volatility adds wind regardless of direction.`,
    },
    lightTemperature: {
      title: weather.lightColorTemperature > 0.65
        ? 'Warm Golden Light'
        : weather.lightColorTemperature < 0.35
          ? 'Cool Blue Light'
          : 'Neutral Light',
      body: `Scene lighting temperature tracks price momentum. Strong upward movement brings warm, golden tones. Downward movement shifts to cool, blue hues.`,
    },
    windAndVolatility: {
      title: `Wind: ${pct(weather.windStrength)} | Volatility: ${pct(weather.volatility)}`,
      body: `Wind intensity is driven by price volatility — the spread between 24h high and low. A choppy market means gusty winds that affect flags, smoke, and particle drift. Bearish momentum adds extra gusts.`,
    },
  };
}

/**
 * Seeded random for deterministic visuals
 */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Hash a string to a number for seeding
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
