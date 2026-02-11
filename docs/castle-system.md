# Pumpcastle Visual System Reference

> **Source of truth:** `src/lib/state/CastleConstants.ts`
> All thresholds, weights, and ceilings live in that file. When you change a constant there, every computation function picks it up automatically.

---

## Architecture Overview

```
TokenData (Codex API)
    |
    v
computeWorldState()           -- tier, phase, decay, activity, identity
computeCastleScale()          -- height, towers, grandeur
computeWallDefense()          -- wall thickness, cracks, reinforcement
computePopulationIndicators() -- NPC liveliness, window glow
computeEconomicActivity()     -- animation speed, banners, smoke
computeCastleReadiness()      -- gates, guards, shield
computeTokenHeritage()        -- layering, statues, patina
computeKingdomStability()     -- tower lean, vibration, foundation
computeCorruptionOverlay()    -- veins, shadows, color shift
computePriceWeather()         -- light temp, clouds, wind, rain
computePerformanceBudget()    -- object caps, LOD, effect toggles
    |
    v
WorldState + sub-states --> interpolated RenderState --> Three.js renderers
```

---

## 1. Castle Tier

**Input:** `athMarketCap` (all-time high market cap in USD)
**Function:** `computeTier()`
**Constants:** `CastleConstants.TIER`

| Tier       | ATH Market Cap    | Visual Identity               |
|------------|-------------------|-------------------------------|
| hut        | (pre-graduation)  | Tiny shack, no walls          |
| cottage    | graduated - $200K | Small home, basic fence       |
| tower      | $200K - $500K     | Single watchtower             |
| keep       | $500K - $1M       | Walled enclosure, 2 towers    |
| manor      | $1M - $2M         | Residential estate            |
| castle     | $2M - $5M         | Full castle with courtyard    |
| stronghold | $5M - $10M        | Military fortification        |
| fortress   | $10M - $50M       | Major fortress complex        |
| palace     | $50M - $100M      | Royal palace                  |
| citadel    | $100M - $500M     | Massive citadel               |
| empire     | $500M - $1B       | Multi-structure empire        |
| legend     | $1B+              | Legendary monument            |

**Rules:**
- Tier is permanent -- once reached via ATH, never decreases
- Pre-graduation tokens are always `hut`
- Legendary status triggers at $100M ATH (permanent glow effects)

---

## 2. Castle Scale

**Input:** `marketCap`
**Function:** `computeCastleScale()`
**Constants:** `CastleConstants.SCALE`

| Constant        | Value    | Purpose                                     |
|-----------------|----------|---------------------------------------------|
| MIN_MCAP        | $10K     | Below this = minimum size                   |
| SIZE_CAP_MCAP   | $500M    | Physical size stops growing here            |
| GRANDEUR_CAP_MCAP | $2B    | Grandeur (0-1) saturates here               |
| MIN_HEIGHT      | 1.5      | Hut height (Three.js units)                 |
| MAX_HEIGHT      | 20       | Maximum castle height                       |
| MIN/MAX_TOWERS  | 0 / 20   | Tower count range                           |
| MIN/MAX_LEVELS  | 1 / 5    | Inner keep floor levels                     |

**Formula:**
```
t = clamp(log10(mcap / MIN_MCAP) / log10(SIZE_CAP_MCAP / MIN_MCAP), 0, 1)

baseCastleHeight = lerp(MIN_HEIGHT, MAX_HEIGHT, t)
towerCount       = floor(lerp(MIN_TOWERS, MAX_TOWERS, t))
innerKeepLevels  = floor(lerp(MIN_LEVELS, MAX_LEVELS, t))
grandeur         = clamp(log10(mcap / MIN_MCAP) / log10(GRANDEUR_CAP / MIN_MCAP), 0, 1)
detailMultiplier = 1 + max(0, log10(mcap / SIZE_CAP))  (>1 only above cap)
```

| Output             | Range      | Description                                    |
|--------------------|------------|------------------------------------------------|
| baseCastleHeight   | 1.5 - 20   | Physical height in scene units                 |
| towerCount         | 0 - 20     | Number of tower meshes                         |
| innerKeepLevels    | 1 - 5      | Keep floor count                               |
| grandeur           | 0 - 1      | Material richness, ornament density, glow      |
| detailMode         | bool       | True when mcap > $500M                         |
| detailMultiplier   | 1.0+       | Extra ornamental complexity beyond size cap    |

**Reference values:**

| Market Cap | t    | Height | Towers | Levels | Grandeur |
|------------|------|--------|--------|--------|----------|
| $10K       | 0.00 | 1.5    | 0      | 1      | 0.00     |
| $100K      | 0.21 | 5.4    | 4      | 1      | 0.19     |
| $1M        | 0.43 | 9.4    | 8      | 2      | 0.38     |
| $10M       | 0.64 | 13.3   | 12     | 3      | 0.57     |
| $100M      | 0.85 | 17.2   | 17     | 4      | 0.76     |
| $500M      | 1.00 | 20.0   | 20     | 5      | 0.89     |
| $2B        | 1.00 | 20.0   | 20     | 5      | 1.00     |

---

## 3. Wall Defense

**Inputs:** `liquidity`, `marketCap`
**Function:** `computeWallDefense()`
**Constants:** `CastleConstants.WALL_DEFENSE`

**Formula:**
```
liquidityRatio    = liquidity / marketCap
wallStrengthScore = clamp(log10(liquidityRatio * 100), 0, 1)
```

**Tier definitions:**

| Score Range | Tier       | Thickness | Height x | Buttresses | Cracks | Material |
|-------------|------------|-----------|----------|------------|--------|----------|
| [0.00,0.20) | fragile   | 0.15      | 0.70     | 0          | 0.90   | none     |
| [0.20,0.40) | weak      | 0.30      | 0.85     | 1          | 0.50   | wood     |
| [0.40,0.60) | reinforced| 0.55      | 1.00     | 3          | 0.20   | iron     |
| [0.60,0.80) | fortress  | 0.85      | 1.20     | 5          | 0.05   | stone    |
| [0.80,1.00] | citadel   | 1.20      | 1.40     | 8          | 0.00   | steel    |

| Output               | Range       | Description                              |
|----------------------|-------------|------------------------------------------|
| wallStrengthScore    | 0 - 1       | Raw score from liquidity ratio           |
| tier                 | enum        | Discrete visual class                    |
| wallThickness        | 0.15 - 1.20 | Wall thickness in scene units            |
| wallHeightMultiplier | 0.70 - 1.40 | Applied to base wall height              |
| buttressCount        | 0 - 8       | Support structures per wall              |
| crackDensity         | 0 - 0.90    | Surface crack overlay intensity          |
| reinforcementType    | enum        | none / wood / iron / stone / steel       |
| tooltip              | string      | Human-readable explanation               |

---

## 4. Population Indicators

**Input:** `holders`
**Function:** `computePopulationIndicators()`
**Constants:** `CastleConstants.POPULATION`

| Constant         | Value   | Purpose                               |
|------------------|---------|---------------------------------------|
| REF_MAX          | 100,000 | Holders above this = norm 1.0         |
| NPC_DENSITY_FLOOR| 0.05    | Min ambient presence                  |
| MAX_WINDOW_LIGHTS| 12      | Max lit windows (readability cap)     |

**Formula:**
```
holdersNorm          = clamp(log10(max(1, holders)) / log10(REF_MAX), 0, 1)
npcDensity           = 0.05 + 0.95 * sqrt(holdersNorm)
windowLightCount     = round(holdersNorm * 12)
courtyardActivityLvl = holdersNorm ^ 1.5
```

| Output                | Range    | Description                                  |
|-----------------------|----------|----------------------------------------------|
| npcDensity            | 0.05 - 1 | Animation speed/sway amplitude (NOT spawn count) |
| windowLightCount      | 0 - 12   | Glowing windows at night                     |
| courtyardActivityLevel| 0 - 1    | Smoke drift speed, torch flicker, bustle     |
| holdersNorm           | 0 - 1    | Internal normalized value                    |

| Holders | Norm | NPC  | Windows | Courtyard |
|---------|------|------|---------|-----------|
| 1       | 0.00 | 0.05 | 0       | 0.00      |
| 10      | 0.20 | 0.47 | 2       | 0.09      |
| 100     | 0.40 | 0.65 | 5       | 0.25      |
| 1,000   | 0.60 | 0.79 | 7       | 0.46      |
| 10,000  | 0.80 | 0.90 | 10      | 0.72      |
| 100,000 | 1.00 | 1.00 | 12      | 1.00      |

---

## 5. Economic Activity

**Inputs:** `txnCount24`, `uniqueTransactions24`, `volume24h`
**Function:** `computeEconomicActivity()`
**Constants:** `CastleConstants.ECONOMY`

| Constant       | Value   | Purpose                                |
|----------------|---------|----------------------------------------|
| TXN_REF_MAX    | 50,000  | 50K daily txns = normalized 1.0        |
| WALLET_REF_MAX | 10,000  | 10K unique wallets = normalized 1.0    |
| VOLUME_REF_MAX | $50M    | $50M daily volume = normalized 1.0     |
| W_TXN          | 0.35    | Transaction count blend weight         |
| W_WALLET       | 0.35    | Wallet diversity blend weight          |
| W_VOLUME       | 0.30    | Volume blend weight (lower = less whale bias) |
| ANIM_SPEED_FLOOR/CEIL | 0.15 / 2.0 | Animation speed range          |
| BANNER_FLOOR   | 0.05    | Minimum cloth ripple                   |
| SMOKE_CEIL     | 3.0     | Max smoke particle multiplier          |

**Formula:**
```
txnNorm       = clamp(log10(txnCount24)    / log10(50K),  0, 1)
walletNorm    = clamp(log10(wallets24)      / log10(10K),  0, 1)
volumeNorm    = clamp(log10(volume24h)      / log10(50M),  0, 1)
activityScore = txnNorm*0.35 + walletNorm*0.35 + volumeNorm*0.30

animationSpeed      = 0.15 + 1.85 * activityScore
bannerMotionIntensity = 0.05 + 0.95 * activityScore
smokeEmissionRate   = 3.0 * activityScore^1.4
```

| Output               | Range      | Description                              |
|----------------------|------------|------------------------------------------|
| activityScore        | 0 - 1      | Composite economic activity              |
| animationSpeed       | 0.15 - 2.0 | Global NPC/animation speed multiplier    |
| bannerMotionIntensity| 0.05 - 1.0 | Flag wave amplitude                      |
| smokeEmissionRate    | 0.0 - 3.0  | Chimney particle spawn rate              |

---

## 6. Castle Readiness

**Inputs:** `buyCount24`, `sellCount24`
**Function:** `computeCastleReadiness()`
**Constants:** `CastleConstants.READINESS`

| Constant        | Value | Purpose                                 |
|-----------------|-------|-----------------------------------------|
| GATE_FLOOR      | 0.05  | Minimum gate opening                    |
| GUARD_ALERT_FLOOR| 0.05 | Minimum patrol presence                 |
| SHIELD_ONSET_RATIO| 0.45| Shield appears below this buy ratio     |
| GATE_SIGMOID_K  | 8     | Sigmoid steepness for gate curve        |
| GUARD_POWER     | 1.3   | Power exponent for guard alert          |

**Formula:**
```
pressureRatio    = buyCount24 / (buyCount24 + sellCount24)   [0.5 if both zero]
gateOpenPct      = 0.05 + 0.95 * sigmoid(8 * (ratio - 0.5))
guardAlertLevel  = (1 - ratio) ^ 1.3
shieldVisibility = ((0.45 - ratio) / 0.45) ^ 2   [only when ratio < 0.45]
```

| Output           | Range    | Description                                   |
|------------------|----------|-----------------------------------------------|
| pressureRatio    | 0 - 1    | Buy fraction (0.5 = balanced)                 |
| gateOpenPercentage | 0.05 - 1 | Gate opening (1 = wide open)                |
| guardAlertLevel  | 0 - 1    | Guard urgency (1 = full alert)                |
| shieldVisibility | 0 - 1    | Energy barrier opacity (0 = invisible)        |

| Ratio | Gate  | Guard | Shield |
|-------|-------|-------|--------|
| 0.00  | 0.05  | 1.00  | 1.00   |
| 0.25  | 0.22  | 0.72  | 0.56   |
| 0.50  | 0.55  | 0.30  | 0.00   |
| 0.75  | 0.86  | 0.06  | 0.00   |
| 1.00  | 1.00  | 0.00  | 0.00   |

---

## 7. Token Heritage

**Input:** `createdAt` (timestamp ms)
**Function:** `computeTokenHeritage()`
**Constants:** `CastleConstants.HERITAGE`

| Constant         | Value | Purpose                                     |
|------------------|-------|---------------------------------------------|
| AGE_REF_DAYS     | 365   | Tokens older than this saturate at 1.0      |
| STATUE_ONSET_DAYS| 7     | Statues only appear after 7 days            |
| WEAR_POWER       | 0.7   | Power exponent for patina curve             |

**Formula:**
```
ageNorm               = clamp(log10(max(1, ageDays)) / log10(365), 0, 1)
architecturalLayering  = sqrt(ageNorm)
presenceOfStatues      = 0  if ageDays <= 7;  else log-ramp
materialWearLevel      = ageNorm ^ 0.7
```

| Output               | Range | Description                                      |
|----------------------|-------|--------------------------------------------------|
| ageDays              | 0+    | Raw age in days                                  |
| ageNorm              | 0 - 1 | Log-normalized age                               |
| architecturalLayering| 0 - 1 | Multi-era stonework additions (sqrt ramp)        |
| presenceOfStatues    | 0 - 1 | Monument figures (delayed onset after 7 days)    |
| materialWearLevel    | 0 - 1 | Patina/moss/weathering (character, NOT damage)   |

| Days | Norm | Layers | Statues | Wear |
|------|------|--------|---------|------|
| 1    | 0.00 | 0.00   | 0.00    | 0.00 |
| 7    | 0.33 | 0.57   | 0.00    | 0.41 |
| 30   | 0.58 | 0.76   | 0.29    | 0.63 |
| 90   | 0.76 | 0.87   | 0.54    | 0.79 |
| 365  | 1.00 | 1.00   | 1.00    | 1.00 |

---

## 8. Kingdom Stability

**Inputs:** `walletAgeAvg` (seconds), `walletAgeStd` (seconds)
**Function:** `computeKingdomStability()`
**Constants:** `CastleConstants.STABILITY`

| Constant            | Value  | Purpose                                  |
|---------------------|--------|------------------------------------------|
| WALLET_AGE_REF_DAYS | 180    | Avg wallet age ceiling (6 months)        |
| WALLET_STD_REF_DAYS | 90     | Std dev ceiling (3 months)               |
| SECONDS_PER_DAY     | 86,400 | Conversion constant                      |
| DIVERSITY_DRAG      | 0.6    | How strongly diversity reduces stability |
| MATURITY_DAMPING    | 0.65   | How strongly maturity dampens tower lean |
| MAX_TOWER_VARIANCE  | 0.7    | Maximum tower lean                       |
| TOWER_VAR_POWER     | 1.2    | Power curve for tower variance           |
| MAX_VIBRATION       | 0.35   | Maximum structural tremor                |
| FOUNDATION_FLOOR    | 0.1    | Minimum foundation levelness             |

**Formula:**
```
maturityNorm  = clamp(log10(avgDays)  / log10(180), 0, 1)
diversityNorm = clamp(log10(stdDays)  / log10(90),  0, 1)
stability     = maturityNorm * (1 - diversityNorm * 0.6)

towerAlignmentVariance = (diversityNorm^1.2 * 0.7) * (1 - maturityNorm * 0.65)
vibrationAmplitude     = (1 - stability) * 0.35
foundationEvenness     = 0.1 + 0.9 * stability
```

| Output                | Range     | Description                                    |
|-----------------------|-----------|------------------------------------------------|
| maturityNorm          | 0 - 1     | Holder experience level                        |
| diversityNorm         | 0 - 1     | Holder age spread                              |
| towerAlignmentVariance| 0 - 0.7   | Tower lean (0 = plumb, 0.7 = max lean)         |
| vibrationAmplitude    | 0 - 0.35  | Structural tremor (subtle!)                    |
| foundationEvenness    | 0.1 - 1.0 | Ground levelness                               |

| Maturity | Diversity | Tower Var | Vibration | Foundation |
|----------|-----------|-----------|-----------|------------|
| 0.00     | 0.00      | 0.25      | 0.08      | 0.50       |
| 0.50     | 0.50      | 0.22      | 0.12      | 0.58       |
| 1.00     | 0.00      | 0.00      | 0.00      | 1.00       |
| 1.00     | 1.00      | 0.25      | 0.15      | 0.60       |

---

## 9. Corruption Overlay

**Inputs:** `devHeldPercentage`, `insiderHeldPercentage`, `sniperCount`, `isScam`
**Function:** `computeCorruptionOverlay()`
**Constants:** `CastleConstants.CORRUPTION`

| Constant              | Value | Purpose                                   |
|-----------------------|-------|-------------------------------------------|
| DEV_HELD_SATURATION   | 50    | 50% dev held = channel maxed              |
| INSIDER_HELD_SATURATION| 60   | 60% insider held = channel maxed          |
| SNIPER_REF_MAX        | 50    | 50 snipers = channel maxed (log scale)    |
| W_DEV                 | 0.35  | Dev channel weight                        |
| W_INSIDER             | 0.30  | Insider channel weight                    |
| W_SNIPER              | 0.20  | Sniper channel weight                     |
| W_SCAM                | 0.15  | Scam flag weight                          |
| SCAM_FLOOR_INTENSITY  | 0.95  | Min corruption when isScam=true           |
| VEIN_POWER            | 1.5   | Power curve for vein density              |
| SHADOW_POWER / MAX / SCALE | 1.8 / 0.62 / 0.65 | Shadow depth curve    |
| DECAY_POWER / MAX / SCALE  | 1.6 / 0.55 / 0.58 | Decay opacity curve   |
| MAX_HUE_SHIFT         | -0.15 | Max hue shift toward sickly green         |
| MAX_SAT_DRAIN         | 0.50  | Max saturation drain toward grey          |
| MAX_BRIGHT_LOSS       | 0.30  | Max brightness reduction                  |

**Formula:**
```
devScore     = clamp(devHeld / 50, 0, 1)
insiderScore = clamp(insiderHeld / 60, 0, 1)
sniperScore  = clamp(log10(snipers) / log10(50), 0, 1)
corruptionIntensity = dev*0.35 + insider*0.30 + sniper*0.20 + scam*0.15
if isScam: intensity = max(0.95, intensity)

veinDensity    = intensity ^ 1.5
shadowDepth    = min(0.62, intensity^1.8 * 0.65)
decayOpacity   = min(0.55, intensity^1.6 * 0.58)
colorShift     = [intensity * -0.15, intensity * 0.50, intensity * 0.30]
```

| Output                | Range           | Description                          |
|-----------------------|-----------------|--------------------------------------|
| corruptionIntensity   | 0 - 1           | Composite corruption score           |
| veinDensity           | 0 - 1           | Dark vein pattern on stone           |
| shadowDepth           | 0 - 0.62        | Unnatural shadow darkening           |
| decayOpacity          | 0 - 0.55        | Surface corrosion overlay            |
| colorShift            | [hue, sat, bright] | Sickly color tint                 |
| isScamFlagged         | bool            | Hard scam flag from Codex            |

| Intensity | Veins | Shadow | Decay | Hue    | Sat  | Bright |
|-----------|-------|--------|-------|--------|------|--------|
| 0.00      | 0.00  | 0.00   | 0.00  | 0.000  | 0.00 | 0.00   |
| 0.25      | 0.12  | 0.06   | 0.04  | -0.038 | 0.13 | 0.08   |
| 0.50      | 0.35  | 0.17   | 0.14  | -0.075 | 0.25 | 0.15   |
| 0.80      | 0.74  | 0.44   | 0.38  | -0.120 | 0.40 | 0.24   |
| 0.95      | 0.93  | 0.57   | 0.50  | -0.143 | 0.48 | 0.29   |
| 1.00      | 1.00  | 0.62   | 0.55  | -0.150 | 0.50 | 0.30   |

**Design constraint:** Corruption is visible but not dominant unless extreme. `isScam=true` forces 95%+ corruption.

---

## 10. Price Weather

**Inputs:** `priceChange1h`, `priceChange24h`, `high24`, `low24`
**Function:** `computePriceWeather()`
**Constants:** `CastleConstants.WEATHER`

| Constant             | Value | Purpose                                    |
|----------------------|-------|--------------------------------------------|
| MOMENTUM_W1H         | 0.4   | 1-hour change blend weight (fast signal)   |
| MOMENTUM_W24H        | 0.6   | 24-hour change blend weight (trend signal) |
| CHANGE_SATURATION    | 50    | +/-50% saturates momentum at +/-1          |
| MAX_CLOUD_DENSITY    | 0.70  | Never fully obscures scene                 |
| MAX_WIND_STRENGTH    | 0.60  | Keeps flags readable                       |
| PRECIP_FOG_THRESHOLD | -0.15 | Fog starts here                            |
| PRECIP_RAIN_THRESHOLD| -0.40 | Rain starts here                           |
| PRECIP_STORM_THRESHOLD| -0.65| Storm starts here                          |
| CLOUD_BEARISH/VOLATILITY_WEIGHT | 0.60 / 0.15 | Cloud contribution    |
| WIND_VOLATILITY/BEARISH_WEIGHT  | 0.40 / 0.15 | Wind contribution     |
| LIGHT_TEMP_POWER     | 0.8   | Sigmoid exponent for light temperature     |

**Formula:**
```
momentum   = clamp((change1*0.4 + change24*0.6) / 50, -1, +1)
volatility = clamp((high24 - low24) / midPrice, 0, 1)

lightColorTemperature = sigmoid-like mapping of momentum to 0-1
cloudDensity          = min(0.70, bearish*0.60 + volatility*0.15)
windStrength          = min(0.60, volatility*0.40 + bearish*0.15)
precipitationType     = none | fog | rain | storm  (thresholds on momentum)
```

| Output              | Range           | Description                            |
|---------------------|-----------------|----------------------------------------|
| lightColorTemperature| 0 - 1          | 0=cool/blue (bearish), 1=warm/gold (bullish) |
| cloudDensity        | 0 - 0.70        | Cloud cover                            |
| windStrength        | 0 - 0.60        | Wind intensity                         |
| precipitationType   | enum            | none / fog / rain / storm              |
| volatility          | 0 - 1           | High/low price spread                  |
| momentum            | -1 to +1        | Signed price mood                      |

| Change 24h | Light | Clouds | Wind | Precip | Mood    |
|------------|-------|--------|------|--------|---------|
| +30%+      | 0.95  | 0.05   | 0.10 | none   | bullish |
| +10%       | 0.78  | 0.10   | 0.12 | none   | bullish |
| 0%         | 0.50  | 0.20   | 0.15 | none   | neutral |
| -10%       | 0.28  | 0.45   | 0.25 | fog    | bearish |
| -25%       | 0.10  | 0.65   | 0.45 | rain   | bearish |
| -50%+      | 0.02  | 0.70   | 0.60 | storm  | crash   |

---

## 11. Performance Budget

**Inputs:** `tier`, `activityScore`, `corruptionIntensity`
**Function:** `computePerformanceBudget()`
**Constants:** `CastleConstants.PERFORMANCE`

### Object count caps (tier-driven)

| Tier       | Towers | Walls | Buttresses | NPCs | Chimneys | Banners | Props | Trees | Statues | Lights | ~Tris  | ~Draws |
|------------|--------|-------|------------|------|----------|---------|-------|-------|---------|--------|--------|--------|
| hut        | 0      | 4     | 0          | 0    | 1        | 0       | 0     | 4     | 0       | 1      | 800    | 8      |
| cottage    | 0      | 4     | 0          | 1    | 1        | 1       | 2     | 6     | 0       | 2      | 2,000  | 15     |
| tower      | 1      | 4     | 0          | 2    | 1        | 1       | 3     | 8     | 0       | 2      | 3,500  | 20     |
| keep       | 2      | 6     | 2          | 3    | 1        | 2       | 5     | 10    | 0       | 3      | 6,000  | 30     |
| manor      | 3      | 8     | 3          | 5    | 2        | 3       | 8     | 12    | 1       | 4      | 10,000 | 42     |
| castle     | 4      | 12    | 4          | 7    | 2        | 4       | 10    | 15    | 2       | 6      | 16,000 | 55     |
| stronghold | 6      | 16    | 6          | 9    | 3        | 5       | 12    | 18    | 3       | 7      | 22,000 | 68     |
| fortress   | 8      | 20    | 8          | 11   | 4        | 6       | 15    | 22    | 4       | 8      | 30,000 | 80     |
| palace     | 10     | 24    | 10         | 13   | 5        | 7       | 17    | 25    | 5       | 10     | 40,000 | 95     |
| citadel    | 14     | 28    | 14         | 15   | 5        | 8       | 18    | 28    | 6       | 11     | 55,000 | 110    |
| empire     | 17     | 30    | 18         | 16   | 6        | 9       | 19    | 30    | 7       | 12     | 70,000 | 125    |
| legend     | 20     | 32    | 24         | 16   | 6        | 10      | 20    | 30    | 8       | 12     | 85,000 | 140    |

### LOD rules (activity-driven)

| Activity Score | NPC LOD  | Prop LOD | Tree LOD  | Tri Multiplier |
|----------------|----------|----------|-----------|----------------|
| < 0.10         | none     | none     | none      | 0.3x           |
| 0.10 - 0.29    | simple   | simple   | billboard | 0.6x           |
| >= 0.30        | full     | full     | full      | 1.0x           |

### Effect toggles (activity thresholds)

| Effect              | Min Activity | Description                           |
|---------------------|-------------|---------------------------------------|
| Window glow         | 0.03        | Night-time window lights              |
| Corruption shader   | 0.05        | Also requires corruptionIntensity > 0 |
| Shield barrier      | 0.05        | Readiness energy barrier              |
| Smoke particles     | 0.05        | Chimney smoke emitters                |
| Weather particles   | 0.08        | Rain / snow / fog                     |
| Vibration           | 0.10        | Structural tremor from stability      |
| Legendary effects   | 0.15        | Rim glow / clearcoat on legend mats   |

---

## TokenData Fields (API Input)

| Field                 | Type     | Required | Source          | Used By                |
|-----------------------|----------|----------|-----------------|------------------------|
| address               | string   | yes      | Codex           | Identity               |
| name                  | string   | yes      | Codex           | Identity               |
| symbol                | string   | yes      | Codex           | Identity               |
| imageUrl              | string?  | no       | Codex           | Banner texture         |
| marketCap             | number   | yes      | Codex           | Tier, Scale, Walls     |
| athMarketCap          | number   | yes      | Codex           | Tier, Scale, Legendary |
| priceChange24h        | number   | yes      | Codex           | Weather, Mood          |
| priceChange1h         | number?  | no       | Codex           | Weather momentum       |
| high24                | number?  | no       | Codex           | Weather volatility     |
| low24                 | number?  | no       | Codex           | Weather volatility     |
| volume24h             | number   | yes      | Codex           | Economy                |
| previousVolume24h     | number   | yes      | Codex (derived) | Activity level         |
| txnCount24            | number   | yes      | Codex           | Economy                |
| uniqueTransactions24  | number   | yes      | Codex           | Economy                |
| buyCount24            | number?  | no       | Codex           | Readiness              |
| sellCount24           | number?  | no       | Codex           | Readiness              |
| walletAgeAvg          | number?  | no       | Codex           | Stability              |
| walletAgeStd          | number?  | no       | Codex           | Stability              |
| devHeldPercentage     | number?  | no       | Codex           | Corruption             |
| insiderHeldPercentage | number?  | no       | Codex           | Corruption             |
| sniperCount           | number?  | no       | Codex           | Corruption             |
| isScam                | boolean? | no       | Codex           | Corruption             |
| lastTradeTimestamp    | number   | yes      | Codex           | Activity               |
| holders               | number   | yes      | Codex           | Population             |
| liquidity             | number   | yes      | Codex           | Walls                  |
| createdAt             | number   | yes      | Codex           | Heritage               |
| isGraduated           | boolean  | yes      | Codex           | Tier, Phase            |
| graduatedAt           | number?  | no       | Codex           | Phase timing           |
| exchanges             | array?   | no       | Codex           | Identity               |

---

## File Map

| File                              | Purpose                                    |
|-----------------------------------|--------------------------------------------|
| `src/lib/types.ts`               | All TypeScript interfaces                  |
| `src/lib/state/CastleConstants.ts`| **All tunable constants (edit here)**      |
| `src/lib/state/CastleState.ts`   | All computation functions                  |
| `src/lib/state/WeatherState.ts`  | Price-weather smooth interpolation         |
| `src/lib/state/DecayState.ts`    | ATH-distance decay computation             |
| `src/lib/state/ActivityState.ts` | Volume-ratio activity level                |
| `src/lib/state/GraduationState.ts`| Graduation detection + celebration         |
| `src/lib/render/QualitySettings.ts`| Device-level GPU quality presets          |
| `src/lib/server/codex.ts`        | Codex API data fetching                    |
