# World Map View — Implementation Plan

## Overview

Add a **World Map View** — a stylized kingdom overview showing all 8 castle areas
as a top-down fantasy map. Each region visually reflects its token's state. Clicking
a region opens the detailed 3D castle scene.

The map uses **SVG** for lightweight, crisp, scalable rendering with no Three.js overhead.

---

## Architecture

### View Toggle (Map ↔ Castle)

The current `+page.svelte` gets a new `viewMode` state: `'map' | 'castle'`.

- **Map mode**: SVG map fills viewport, 3D renderer is hidden (paused).
- **Castle mode**: Current behavior — 3D viewport fills screen.
- Toggle via a button in the top bar.
- Clicking a map region transitions to castle mode with that token loaded.
- Back button in castle mode returns to the map.

### New Files

| File | Purpose |
|------|---------|
| `src/lib/components/WorldMap.svelte` | The SVG-based map component |
| `src/lib/stores/mapStore.ts` | Multi-token data store (fetches all 8 presets) |
| `src/lib/map/mapLayout.ts` | Region positions, sizes, path shapes |
| `src/lib/map/mapTheme.ts` | State → visual mapping (colors, effects, icons) |

### Modified Files

| File | Change |
|------|--------|
| `src/routes/+page.svelte` | Add viewMode toggle, conditionally show map vs castle |
| `src/lib/types.ts` | Add `MapRegion` interface |

---

## Data Model

### MapRegion (new type in types.ts)

```typescript
export interface MapRegion {
  id: string;            // token address
  name: string;          // token name
  symbol: string;        // token symbol
  tier: CastleTier;
  phase: LifePhase;
  isLegendary: boolean;
  marketCap: number;
  athMarketCap: number;
  decay: number;
  // Layout (computed from mapLayout.ts)
  x: number;             // center X on map (0-1000 SVG viewbox)
  y: number;             // center Y
  path: string;          // SVG path "d" attribute for region border
}
```

### mapStore.ts

- `allTokens` writable store: `Map<string, { token: TokenData, state: WorldState }>`
- `loadAllTokens()`: fetches all 8 preset addresses in parallel
- `mapRegions` derived store: computes `MapRegion[]` from allTokens + mapLayout
- Polls every 30s (slower than single-token 15s since it's overview)

---

## Map Layout (mapLayout.ts)

SVG viewBox: `0 0 1000 700`

8 regions arranged as a medieval kingdom map:

```
    ┌─────────────────────────────────────┐
    │         LEGENDARY (top center)       │
    │              ★ LegendCoin            │
    │                                      │
    │   THRIVING        GRADUATED          │
    │   (left)          (right)            │
    │                                      │
    │      CONSTRUCTION (center)           │
    │                                      │
    │   DECAYING        CURSED             │
    │   (left-low)      (right-low)        │
    │                                      │
    │   ZOMBIE            FALLEN           │
    │   (bottom-left)     (bottom-right)   │
    └─────────────────────────────────────┘
```

Each region is an organic, hand-drawn-style SVG path (irregular polygon, not rectangles).
Connecting roads drawn as SVG `<path>` strokes between regions.
A decorative outer wall / border wraps the entire kingdom.

---

## State → Visual Mapping (mapTheme.ts)

### Region Fill Colors

| Phase | Fill | Border | Extra |
|-------|------|--------|-------|
| construction | `#d4a574` (sandy) | `#b8956a` dashed | Scaffold hatch pattern |
| graduated | `#7a9e7a` (stone green) | `#5a7e5a` solid | Clean borders |
| thriving | `#8ab87a` (vibrant green) | `#5a8e4a` solid 2px | Flag icon |
| declining | `#9a8070` (muted brown) | `#7a6050` solid | — |
| dormant | `#787878` (grey) | `#585858` solid | — |
| zombie | `#4a5a4a` (dark grey-green) | `#3a4a3a` solid | SVG fog filter |
| cursed | `#5a3a5a` (dark purple) | `#4a2a4a` solid | Crack lines |

### Tier Scaling

Region visual size scales slightly with tier:
- keep: 0.85x
- castle: 1.0x
- fortress: 1.1x
- citadel: 1.2x

### Legendary Treatment

- Gold stroke (`#ffd700`) with `stroke-width: 3`
- Animated glow filter (SVG `<feGaussianBlur>` + `<feComposite>`)
- Small star/crown icon overlay
- CSS `@keyframes` pulse on the gold stroke opacity

### Hover / Selected States

- Hover: region lifts (slight `transform: scale(1.03)`), border brightens
- Selected: stronger border, subtle drop-shadow, label becomes bold
- Transition: `transition: transform 0.2s, filter 0.2s`

---

## WorldMap.svelte Component

### Props
```typescript
export let regions: MapRegion[];
export let selectedId: string | null;
export let onRegionClick: (id: string) => void;
```

### SVG Structure
```
<svg viewBox="0 0 1000 700">
  <defs>
    <!-- Filters: glow, fog, hatch pattern -->
  </defs>

  <!-- Background: parchment/terrain texture via gradient -->
  <rect fill="url(#parchment)" ... />

  <!-- Outer kingdom wall -->
  <path class="kingdom-wall" ... />

  <!-- Roads connecting regions -->
  <g class="roads">
    <path d="..." stroke="#8a7a60" stroke-dasharray="8,4" />
    ...
  </g>

  <!-- Regions -->
  {#each regions as region}
    <g class="region"
       class:hovered={hoveredId === region.id}
       class:selected={selectedId === region.id}
       on:click={() => onRegionClick(region.id)}
       on:mouseenter={() => hoveredId = region.id}
       on:mouseleave={() => hoveredId = null}
    >
      <path d={region.path} fill={getRegionFill(region)} ... />
      <!-- State overlays (fog, cracks, scaffolding) -->
      <!-- Castle icon (simple SVG shape scaled by tier) -->
      <!-- Label -->
      <text>{region.name}</text>
      <text class="subtitle">{formatMcap(region.marketCap)}</text>
    </g>
  {/each}

  <!-- Decorative elements: trees, mountains at edges -->
</svg>
```

### Castle Icon per Region

A tiny simplified castle silhouette in the center of each region,
scaled by tier (keep=small tower, citadel=multi-tower). These are
simple SVG path shapes, not 3D.

---

## Integration in +page.svelte

### New State
```typescript
let viewMode: 'map' | 'castle' = 'map';
```

### View Toggle Button
Added to the top bar next to the logo:
```svelte
<button class="view-toggle" on:click={toggleView}>
  {viewMode === 'map' ? '🏰 Enter Castle' : '🗺️ World Map'}
</button>
```

### Conditional Rendering
```svelte
{#if viewMode === 'map'}
  <WorldMap
    regions={$mapRegions}
    selectedId={$tokenAddress}
    onRegionClick={handleRegionClick}
  />
{:else}
  <div class="viewport" bind:this={containerEl}></div>
  <!-- existing castle UI overlays -->
{/if}
```

### handleRegionClick
```typescript
async function handleRegionClick(address: string) {
  await loadToken(address);
  viewMode = 'castle';
}
```

### Renderer Lifecycle
- When switching to map mode: `renderer.pause()` (stop animation loop)
- When switching to castle mode: `renderer.resume()` (restart loop)
- This avoids destroying/recreating the heavy 3D scene

---

## Implementation Order

1. **types.ts** — Add `MapRegion` interface
2. **mapLayout.ts** — Define region positions and SVG paths
3. **mapTheme.ts** — State-to-visual mapping functions
4. **mapStore.ts** — Multi-token fetch + derived mapRegions
5. **WorldMap.svelte** — Full SVG map component
6. **+page.svelte** — Wire up viewMode toggle, map ↔ castle switching
7. **WorldRenderer3D.ts** — Add pause()/resume() methods
8. **Build + verify**
