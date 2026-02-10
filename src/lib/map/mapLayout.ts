/**
 * mapLayout.ts
 *
 * Spatial layout engine for the kingdom world map.
 *
 * Supports two modes:
 *   1. Static layouts for the 8 preset tokens (hand-tuned SVG paths)
 *   2. Dynamic layout engine for arbitrary numbers of regions
 *
 * The dynamic engine:
 *   - Sorts regions by importance (highest → center)
 *   - Places them in concentric rings (inner = important, outer = minor)
 *   - Scales each region's radius by importance
 *   - Generates organic polygon SVG paths procedurally
 *   - Generates road paths connecting each region to a hub
 *   - All fully deterministic from region data (hash-seeded, no randomness)
 *
 * SVG viewBox: 0 0 1000 700
 */

import type { MapRegion } from '$lib/types';

export interface RegionLayout {
  /** Center X in SVG coords */
  cx: number;
  /** Center Y in SVG coords */
  cy: number;
  /** SVG path "d" for the region border (closed irregular polygon) */
  path: string;
  /** SVG path for the road connecting this region to the center */
  roadPath: string;
}

// ── Canvas constants ──
const CX = 500;        // Kingdom center X
const CY = 340;        // Kingdom center Y (slightly above center for hilltop feel)
const MAP_W = 1000;
const MAP_H = 700;
const PADDING = 80;    // Min distance from SVG edges
const MIN_RADIUS = 30; // Smallest region
const MAX_RADIUS = 70; // Largest region (legendary)

// ── Static presets (hand-tuned, kept for the 8 known demo tokens) ──

const STATIC_LAYOUTS: Record<string, RegionLayout> = {
  // Legendary — top center hilltop, largest region
  'legend123456789012345678901234567890123456': {
    cx: 500, cy: 115,
    path: 'M435,70 L465,58 Q500,50 535,58 L565,70 L580,95 L575,130 L560,155 L535,165 Q500,170 465,165 L440,155 L425,130 L420,95 Z',
    roadPath: 'M500,165 L500,230',
  },
  // Thriving — upper-left district
  'thriving1234567890123456789012345678901234': {
    cx: 320, cy: 225,
    path: 'M255,195 L290,185 L330,190 L365,200 L380,225 L375,255 L355,275 L320,280 L280,272 L258,250 L250,225 Z',
    roadPath: 'M365,225 L435,225 Q460,230 470,250',
  },
  // Graduated — upper-right district
  'justgrad12345678901234567890123456789012345': {
    cx: 680, cy: 225,
    path: 'M625,195 L660,188 L700,192 L735,205 L745,230 L738,258 L718,275 L685,280 L648,270 L630,250 L622,225 Z',
    roadPath: 'M630,230 L560,240 Q535,245 530,260',
  },
  // Construction — center, heart of the kingdom
  'pregrad123456789012345678901234567890123456': {
    cx: 500, cy: 340,
    path: 'M438,295 L470,288 Q500,285 530,288 L562,295 L578,320 L580,350 L570,378 L545,392 Q500,398 455,392 L430,378 L420,350 L422,320 Z',
    roadPath: '',
  },
  // Decaying — lower-left
  'decayed12345678901234567890123456789012345': {
    cx: 290, cy: 430,
    path: 'M228,400 L262,390 L310,395 L345,410 L352,438 L342,465 L315,478 L275,480 L242,468 L225,445 L222,420 Z',
    roadPath: 'M345,425 L430,380',
  },
  // Cursed — lower-right
  'cursed123456789012345678901234567890123456': {
    cx: 710, cy: 430,
    path: 'M652,402 L688,392 L730,396 L762,410 L772,435 L765,462 L742,478 L705,482 L668,472 L650,450 L648,425 Z',
    roadPath: 'M655,425 L575,380',
  },
  // Zombie — bottom-left outskirts
  'zombie123456789012345678901234567890123456': {
    cx: 230, cy: 575,
    path: 'M168,545 L202,535 L250,538 L285,552 L292,578 L282,605 L255,620 L215,622 L182,610 L165,588 L162,562 Z',
    roadPath: 'M280,565 L310,480',
  },
  // Fallen — bottom-right outskirts
  'fallen123456789012345678901234567890123456': {
    cx: 770, cy: 575,
    path: 'M710,545 L745,535 L790,540 L822,555 L828,580 L818,608 L792,622 L752,625 L718,612 L705,588 L705,562 Z',
    roadPath: 'M715,568 L695,480',
  },
};

/** Check if all regions have static layouts */
function allHaveStaticLayouts(regions: MapRegion[]): boolean {
  return regions.every(r => r.id in STATIC_LAYOUTS);
}

// ── Deterministic hash ──

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Seeded pseudo-random number from a hash. Returns 0–1. */
function seededRand(hash: number, salt: number): number {
  const x = Math.sin((hash + salt) * 9.8765) * 43758.5453;
  return x - Math.floor(x);
}

// ── Polygon path generation ──

/**
 * Generate an organic irregular polygon path for a region.
 * Points are distributed around a circle at (cx, cy) with radius,
 * with deterministic wobble from the region's hash.
 */
function generatePolygonPath(cx: number, cy: number, radius: number, hash: number, vertices: number = 10): string {
  const points: [number, number][] = [];
  for (let i = 0; i < vertices; i++) {
    const angle = (Math.PI * 2 * i) / vertices - Math.PI / 2;
    // Wobble: ±15% of radius, deterministic per vertex
    const wobble = 1 + (seededRand(hash, i * 7) - 0.5) * 0.3;
    const r = radius * wobble;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    points.push([x, y]);
  }

  // Build SVG path with slight curve between points for organic feel
  const [first, ...rest] = points;
  let d = `M${first[0].toFixed(0)},${first[1].toFixed(0)}`;
  for (const [x, y] of rest) {
    d += ` L${x.toFixed(0)},${y.toFixed(0)}`;
  }
  d += ' Z';
  return d;
}

/** Generate a road SVG path from a region center to the kingdom hub */
function generateRoadPath(cx: number, cy: number, hubX: number, hubY: number): string {
  if (Math.abs(cx - hubX) < 10 && Math.abs(cy - hubY) < 10) return '';
  // Simple line; slightly curved through a midpoint offset
  const midX = (cx + hubX) / 2;
  const midY = (cy + hubY) / 2;
  return `M${cx.toFixed(0)},${cy.toFixed(0)} Q${midX.toFixed(0)},${midY.toFixed(0)} ${hubX.toFixed(0)},${hubY.toFixed(0)}`;
}

// ── Ring placement ──

interface PlacedRegion {
  id: string;
  cx: number;
  cy: number;
  radius: number;
}

/**
 * Compute the radius for a region based on importance.
 * Importance 0 → MIN_RADIUS, importance 1 → MAX_RADIUS.
 */
function importanceToRadius(importance: number): number {
  return MIN_RADIUS + importance * (MAX_RADIUS - MIN_RADIUS);
}

/**
 * Place regions in concentric elliptical rings around the kingdom center.
 * Ring 0 = single region at center (highest importance).
 * Ring 1+ = distributed evenly around ellipses of increasing radius.
 *
 * Ring capacities: ring 1 = up to 6, ring 2 = up to 10, ring 3+ = up to 14.
 * This ensures the map scales to 30+ regions without overlap.
 */
function placeInRings(sorted: MapRegion[]): PlacedRegion[] {
  if (sorted.length === 0) return [];

  const placed: PlacedRegion[] = [];

  // Ring 0: the single most important region at center
  const center = sorted[0];
  placed.push({
    id: center.id,
    cx: CX,
    cy: CY,
    radius: importanceToRadius(center.importance),
  });

  // Remaining regions distributed into rings
  const remaining = sorted.slice(1);
  const ringCapacities = [6, 10, 14, 18, 22]; // ring 1–5
  const ringBaseRadii = [140, 240, 330, 410, 480]; // ellipse semi-major axis

  let idx = 0;
  for (let ring = 0; ring < ringCapacities.length && idx < remaining.length; ring++) {
    const capacity = ringCapacities[ring];
    const ringRadius = ringBaseRadii[ring];
    const count = Math.min(capacity, remaining.length - idx);

    for (let i = 0; i < count; i++) {
      const region = remaining[idx + i];
      const r = importanceToRadius(region.importance);

      // Distribute evenly around the ring with a slight offset per ring
      const angleOffset = ring * 0.3; // stagger rings so they don't align
      const angle = (Math.PI * 2 * i) / count - Math.PI / 2 + angleOffset;

      // Elliptical: wider horizontally (1000 vs 700 canvas)
      const ellipseRatioX = 1.0;
      const ellipseRatioY = 0.75;

      let px = CX + Math.cos(angle) * ringRadius * ellipseRatioX;
      let py = CY + Math.sin(angle) * ringRadius * ellipseRatioY;

      // Clamp to map bounds
      px = Math.max(PADDING + r, Math.min(MAP_W - PADDING - r, px));
      py = Math.max(PADDING + r, Math.min(MAP_H - PADDING - r, py));

      placed.push({ id: region.id, cx: px, cy: py, radius: r });
    }

    idx += count;
  }

  // Overflow: place any remaining beyond ring 5 in a final outer ring
  if (idx < remaining.length) {
    const outerRadius = 520;
    const overflowCount = remaining.length - idx;
    for (let i = 0; i < overflowCount; i++) {
      const region = remaining[idx + i];
      const r = importanceToRadius(region.importance);
      const angle = (Math.PI * 2 * i) / overflowCount - Math.PI / 2 + 0.2;

      let px = CX + Math.cos(angle) * outerRadius;
      let py = CY + Math.sin(angle) * outerRadius * 0.7;
      px = Math.max(PADDING + r, Math.min(MAP_W - PADDING - r, px));
      py = Math.max(PADDING + r, Math.min(MAP_H - PADDING - r, py));

      placed.push({ id: region.id, cx: px, cy: py, radius: r });
    }
  }

  return placed;
}

// ── Road network generation ──

/**
 * Generate roads connecting regions. Strategy:
 * - Every region connects to the center hub
 * - Adjacent ring neighbors get inter-ring roads
 */
function generateRoadNetwork(placed: PlacedRegion[]): string[] {
  if (placed.length === 0) return [];

  const roads: string[] = [];
  const hub = placed[0]; // Center region is the hub

  // Each non-center region connects to hub
  for (let i = 1; i < placed.length; i++) {
    const r = placed[i];
    const road = generateRoadPath(r.cx, r.cy, hub.cx, hub.cy);
    if (road) roads.push(road);
  }

  return roads;
}

// ── Kingdom wall generation ──

/** Generate a kingdom wall that encloses all placed regions */
function generateKingdomWall(placed: PlacedRegion[]): string {
  if (placed.length === 0) return KINGDOM_WALL_PATH;

  // Find the bounding box of all regions with padding
  let minX = MAP_W, minY = MAP_H, maxX = 0, maxY = 0;
  for (const p of placed) {
    minX = Math.min(minX, p.cx - p.radius);
    minY = Math.min(minY, p.cy - p.radius);
    maxX = Math.max(maxX, p.cx + p.radius);
    maxY = Math.max(maxY, p.cy + p.radius);
  }

  // Expand with padding
  const pad = 50;
  minX = Math.max(20, minX - pad);
  minY = Math.max(20, minY - pad);
  maxX = Math.min(MAP_W - 20, maxX + pad);
  maxY = Math.min(MAP_H - 20, maxY + pad);

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  // Organic rounded rectangle-ish wall
  return `M${minX},${midY} Q${minX},${minY} ${midX},${minY} Q${maxX},${minY} ${maxX},${midY} Q${maxX},${maxY} ${midX},${maxY} Q${minX},${maxY} ${minX},${midY} Z`;
}

// ── Public API ──

export interface ComputedMapLayout {
  /** Layout per region, keyed by region id */
  layouts: Record<string, RegionLayout>;
  /** Kingdom outer wall SVG path */
  wallPath: string;
  /** Road network SVG paths */
  roads: string[];
}

/**
 * Compute the full map layout for a set of regions.
 *
 * If all regions are known presets (the 8 demo tokens), uses the hand-tuned
 * static layouts for maximum visual quality. Otherwise, falls back to the
 * dynamic layout engine.
 *
 * Fully deterministic: same input regions → same output layout.
 */
export function computeMapLayout(regions: MapRegion[]): ComputedMapLayout {
  // Fast path: all regions are known presets
  if (allHaveStaticLayouts(regions)) {
    const layouts: Record<string, RegionLayout> = {};
    for (const r of regions) {
      layouts[r.id] = STATIC_LAYOUTS[r.id];
    }
    return {
      layouts,
      wallPath: KINGDOM_WALL_PATH,
      roads: ROAD_NETWORK,
    };
  }

  // Dynamic path: sort by importance, place in rings
  const sorted = [...regions].sort((a, b) => b.importance - a.importance);
  const placed = placeInRings(sorted);

  // Build layout map
  const layouts: Record<string, RegionLayout> = {};
  const regionMap = new Map(regions.map(r => [r.id, r]));

  for (const p of placed) {
    const hash = hashStr(p.id);
    const vertices = 8 + Math.round(seededRand(hash, 99) * 4); // 8–12 vertices
    layouts[p.id] = {
      cx: Math.round(p.cx),
      cy: Math.round(p.cy),
      path: generatePolygonPath(p.cx, p.cy, p.radius, hash, vertices),
      roadPath: generateRoadPath(p.cx, p.cy, CX, CY),
    };
  }

  return {
    layouts,
    wallPath: generateKingdomWall(placed),
    roads: generateRoadNetwork(placed),
  };
}

// ── Legacy exports (backward compatibility) ──

/** @deprecated Use computeMapLayout() instead for dynamic layout. */
export const REGION_LAYOUTS = STATIC_LAYOUTS;

/** Static kingdom wall for the preset layout */
export const KINGDOM_WALL_PATH =
  'M180,40 Q500,10 820,40 Q920,100 900,250 Q910,450 870,580 Q780,680 500,690 Q220,680 130,580 Q90,450 100,250 Q80,100 180,40 Z';

/** Static road network for the preset layout */
export const ROAD_NETWORK: string[] = [
  'M500,285 L500,170',
  'M438,330 L375,260',
  'M562,330 L625,260',
  'M440,375 L345,410',
  'M560,375 L650,410',
  'M255,270 L240,400',
  'M735,270 L755,400',
  'M230,465 L225,540',
  'M760,465 L765,540',
];

/**
 * Tiny castle silhouette SVG paths per tier.
 * Drawn relative to (0,0) — translate to region center.
 */
export const CASTLE_ICONS: Record<string, string> = {
  keep:     'M-6,-12 L-6,-4 L-10,-4 L-10,4 L10,4 L10,-4 L6,-4 L6,-12 L3,-12 L3,-16 L-3,-16 L-3,-12 Z',
  castle:   'M-10,-14 L-10,-6 L-14,-6 L-14,6 L14,6 L14,-6 L10,-6 L10,-14 L6,-14 L6,-8 L-6,-8 L-6,-14 Z M-2,-18 L-2,-14 L2,-14 L2,-18 Z',
  fortress: 'M-14,-14 L-14,-6 L-18,-6 L-18,8 L18,8 L18,-6 L14,-6 L14,-14 L10,-14 L10,-8 L-10,-8 L-10,-14 Z M-6,-20 L-6,-14 L-2,-14 L-2,-20 Z M2,-20 L2,-14 L6,-14 L6,-20 Z',
  citadel:  'M-18,-14 L-18,-6 L-22,-6 L-22,10 L22,10 L22,-6 L18,-6 L18,-14 L14,-14 L14,-8 L-14,-8 L-14,-14 Z M-8,-22 L-8,-14 L-4,-14 L-4,-22 Z M4,-22 L4,-14 L8,-14 L8,-22 Z M-1,-28 L-1,-22 L1,-22 L1,-28 Z',
};
