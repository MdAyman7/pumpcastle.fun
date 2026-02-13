/**
 * mapLayout.ts
 *
 * Spatial layout engine for the kingdom world map.
 *
 * Structured geographic grid:
 *   3 columns (left realm, central kingdom, right realm)
 *   3 rows (northern mountains, central political, southern coast/trade)
 *
 * Static layouts for known demo tokens use hand-tuned positions.
 * Dynamic engine places regions in a structured grid with terrain-aware
 * borders, mountain ridges, rivers, forests, and coastline.
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
const CY = 320;        // Kingdom center Y
const MAP_W = 1000;
const MAP_H = 700;
const PADDING = 80;    // Min distance from SVG edges
const MIN_RADIUS = 30; // Smallest region
const MAX_RADIUS = 70; // Largest region (legendary)

// ── Geographic grid positions (3×3) ──
// Northern row: y ~ 120–180 (mountains zone)
// Central row: y ~ 280–380 (political heartland)
// Southern row: y ~ 480–560 (coastal/trade zone)

/** Grid slot positions for the 3×3 + extras layout */
const GRID_SLOTS: Array<{ cx: number; cy: number; zone: 'north' | 'central' | 'south' }> = [
  // Central kingdom — heart of the map (slightly dominant)
  { cx: 500, cy: 320, zone: 'central' },
  // Northern row — mountain realms
  { cx: 280, cy: 150, zone: 'north' },   // NW
  { cx: 500, cy: 120, zone: 'north' },   // N center (hilltop)
  { cx: 720, cy: 150, zone: 'north' },   // NE
  // Central row — flanking kingdoms
  { cx: 250, cy: 340, zone: 'central' }, // W
  { cx: 750, cy: 340, zone: 'central' }, // E
  // Southern row — coastal/trade zones
  { cx: 280, cy: 520, zone: 'south' },   // SW
  { cx: 720, cy: 520, zone: 'south' },   // SE
  // Overflow slots for 9+ regions
  { cx: 500, cy: 540, zone: 'south' },   // S center
  { cx: 140, cy: 240, zone: 'north' },   // far NW
  { cx: 860, cy: 240, zone: 'north' },   // far NE
  { cx: 140, cy: 460, zone: 'south' },   // far SW
  { cx: 860, cy: 460, zone: 'south' },   // far SE
];

// ── Static presets (hand-tuned, kept for the 8 known demo tokens) ──

const STATIC_LAYOUTS: Record<string, RegionLayout> = {
  // Legendary — north-center hilltop, slightly above kingdom center
  'legend123456789012345678901234567890123456': {
    cx: 500, cy: 120,
    path: 'M440,78 L468,68 Q500,60 532,68 L560,78 L574,100 L572,130 L558,152 L535,162 Q500,168 465,162 L442,152 L428,130 L430,100 Z',
    roadPath: 'M500,168 Q500,220 500,280',
  },
  // Thriving — upper-left, northwest realm
  'thriving1234567890123456789012345678901234': {
    cx: 280, cy: 150,
    path: 'M218,115 L252,105 L298,110 L335,125 L345,150 L338,178 L315,195 L280,198 L242,190 L220,170 L215,145 Z',
    roadPath: 'M335,155 Q400,220 460,290',
  },
  // Graduated — upper-right, northeast realm
  'justgrad12345678901234567890123456789012345': {
    cx: 720, cy: 150,
    path: 'M660,115 L695,108 L738,112 L775,128 L782,155 L775,182 L752,198 L718,200 L682,192 L662,172 L658,145 Z',
    roadPath: 'M665,158 Q600,220 540,290',
  },
  // Construction — center, heart of the kingdom (dominant)
  'pregrad123456789012345678901234567890123456': {
    cx: 500, cy: 320,
    path: 'M432,270 L468,260 Q500,255 532,260 L568,270 L585,298 L588,325 L582,355 L562,375 Q500,385 438,375 L418,355 L412,325 L415,298 Z',
    roadPath: '',
  },
  // Decaying — west, left flank
  'decayed12345678901234567890123456789012345': {
    cx: 250, cy: 340,
    path: 'M188,305 L222,295 L268,298 L305,312 L312,340 L305,368 L280,385 L248,388 L215,378 L192,358 L185,332 Z',
    roadPath: 'M305,340 Q380,330 430,322',
  },
  // Cursed — east, right flank
  'cursed123456789012345678901234567890123456': {
    cx: 750, cy: 340,
    path: 'M690,305 L725,298 L768,302 L802,318 L810,345 L802,372 L778,388 L748,390 L715,380 L695,360 L688,335 Z',
    roadPath: 'M695,340 Q620,330 570,322',
  },
  // Zombie — southwest, coastal outpost
  'zombie123456789012345678901234567890123456': {
    cx: 280, cy: 520,
    path: 'M218,488 L252,478 L298,482 L332,498 L338,522 L330,548 L305,562 L275,565 L242,555 L220,535 L215,510 Z',
    roadPath: 'M320,510 Q370,430 430,370',
  },
  // Fallen — southeast, coastal outpost
  'fallen123456789012345678901234567890123456': {
    cx: 720, cy: 520,
    path: 'M660,488 L695,480 L738,485 L768,500 L775,525 L768,552 L745,565 L715,568 L682,558 L662,538 L658,512 Z',
    roadPath: 'M670,510 Q630,430 570,370',
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
 * Generate an elegant cartographic border path for a region.
 * Uses smooth curves instead of jagged lines for a premium feel.
 */
function generatePolygonPath(cx: number, cy: number, radius: number, hash: number, vertices: number = 10): string {
  const points: [number, number][] = [];
  for (let i = 0; i < vertices; i++) {
    const angle = (Math.PI * 2 * i) / vertices - Math.PI / 2;
    // Gentle wobble: ±12% of radius (more controlled than before)
    const wobble = 1 + (seededRand(hash, i * 7) - 0.5) * 0.24;
    const r = radius * wobble;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    points.push([x, y]);
  }

  // Build SVG path with quadratic curves for smooth borders
  if (points.length < 3) return '';
  const [first, ...rest] = points;

  // Start at midpoint between last and first point for smooth closure
  const lastPt = points[points.length - 1];
  const startX = (lastPt[0] + first[0]) / 2;
  const startY = (lastPt[1] + first[1]) / 2;

  let d = `M${startX.toFixed(1)},${startY.toFixed(1)}`;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    const midX = (curr[0] + next[0]) / 2;
    const midY = (curr[1] + next[1]) / 2;
    d += ` Q${curr[0].toFixed(1)},${curr[1].toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`;
  }
  d += ' Z';
  return d;
}

/** Generate a road SVG path from a region center to the kingdom hub */
function generateRoadPath(cx: number, cy: number, hubX: number, hubY: number): string {
  if (Math.abs(cx - hubX) < 10 && Math.abs(cy - hubY) < 10) return '';
  // Curved road with a natural-feeling control point
  const midX = (cx + hubX) / 2 + (cy > hubY ? -15 : 15);
  const midY = (cy + hubY) / 2;
  return `M${cx.toFixed(0)},${cy.toFixed(0)} Q${midX.toFixed(0)},${midY.toFixed(0)} ${hubX.toFixed(0)},${hubY.toFixed(0)}`;
}

// ── Grid placement ──

interface PlacedRegion {
  id: string;
  cx: number;
  cy: number;
  radius: number;
}

function importanceToRadius(importance: number): number {
  return MIN_RADIUS + importance * (MAX_RADIUS - MIN_RADIUS);
}

/**
 * Place regions in the structured 3×3 grid.
 * Sorted by importance: most important gets center slot.
 */
function placeInGrid(sorted: MapRegion[]): PlacedRegion[] {
  if (sorted.length === 0) return [];

  const placed: PlacedRegion[] = [];

  for (let i = 0; i < sorted.length && i < GRID_SLOTS.length; i++) {
    const region = sorted[i];
    const slot = GRID_SLOTS[i];
    placed.push({
      id: region.id,
      cx: slot.cx,
      cy: slot.cy,
      radius: importanceToRadius(region.importance),
    });
  }

  // Overflow beyond grid slots: distribute in outer ring
  if (sorted.length > GRID_SLOTS.length) {
    const overflowCount = sorted.length - GRID_SLOTS.length;
    const outerRadius = 420;
    for (let i = 0; i < overflowCount; i++) {
      const region = sorted[GRID_SLOTS.length + i];
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

function generateRoadNetwork(placed: PlacedRegion[]): string[] {
  if (placed.length === 0) return [];

  const roads: string[] = [];
  const hub = placed[0];

  for (let i = 1; i < placed.length; i++) {
    const r = placed[i];
    const road = generateRoadPath(r.cx, r.cy, hub.cx, hub.cy);
    if (road) roads.push(road);
  }

  return roads;
}

// ── Kingdom wall generation ──

function generateKingdomWall(placed: PlacedRegion[]): string {
  if (placed.length === 0) return KINGDOM_WALL_PATH;

  let minX = MAP_W, minY = MAP_H, maxX = 0, maxY = 0;
  for (const p of placed) {
    minX = Math.min(minX, p.cx - p.radius);
    minY = Math.min(minY, p.cy - p.radius);
    maxX = Math.max(maxX, p.cx + p.radius);
    maxY = Math.max(maxY, p.cy + p.radius);
  }

  const pad = 50;
  minX = Math.max(20, minX - pad);
  minY = Math.max(20, minY - pad);
  maxX = Math.min(MAP_W - 20, maxX + pad);
  maxY = Math.min(MAP_H - 20, maxY + pad);

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  return `M${minX},${midY} Q${minX},${minY} ${midX},${minY} Q${maxX},${minY} ${maxX},${midY} Q${maxX},${maxY} ${midX},${maxY} Q${minX},${maxY} ${minX},${midY} Z`;
}

// ── Terrain features (static decorative SVG paths) ──

/** Continuous northern mountain ridge */
export const MOUNTAIN_RIDGE_PATH =
  'M40,60 L80,32 L110,50 L145,20 L180,45 L220,15 L260,40 L300,18 L340,42 L380,12 L420,38 L460,8 L500,35 L540,10 L580,38 L620,14 L660,42 L700,20 L740,45 L780,18 L820,40 L860,25 L900,48 L940,30 L960,55';

/** Mountain peak icons (positioned along the ridge) */
export const MOUNTAIN_PEAKS: Array<{ cx: number; cy: number; scale: number }> = [
  { cx: 145, cy: 22, scale: 1.0 },
  { cx: 260, cy: 38, scale: 0.8 },
  { cx: 380, cy: 14, scale: 1.1 },
  { cx: 500, cy: 10, scale: 1.3 },
  { cx: 620, cy: 16, scale: 1.0 },
  { cx: 740, cy: 42, scale: 0.9 },
  { cx: 860, cy: 27, scale: 0.85 },
];

/** River paths (originate from northern mountains, flow south naturally) */
export const RIVER_PATHS: string[] = [
  // Main river — flows from central mountains to southern sea
  'M500,35 C495,80 480,130 470,180 C455,230 440,280 435,320 C430,360 425,410 430,460 C435,510 445,560 460,600 C470,630 480,650 490,670',
  // Tributary — branches west from main river
  'M470,180 C440,200 400,220 360,245 C320,270 290,300 270,340 C255,370 245,410 240,450',
];

/** Forest cluster positions (compact, near borders) */
export const FOREST_CLUSTERS: Array<{ cx: number; cy: number; count: number; spread: number }> = [
  { cx: 120, cy: 120, count: 5, spread: 25 },   // NW forest
  { cx: 880, cy: 110, count: 4, spread: 22 },    // NE forest
  { cx: 150, cy: 400, count: 4, spread: 20 },    // W border forest
  { cx: 850, cy: 420, count: 4, spread: 20 },    // E border forest
  { cx: 400, cy: 600, count: 3, spread: 18 },    // S coastal woods
  { cx: 620, cy: 590, count: 3, spread: 18 },    // SE coastal woods
];

/** Southern coastline path (replaces excessive empty bottom-left) */
export const COASTLINE_PATH =
  'M30,620 C80,600 140,610 200,625 C260,640 330,650 400,645 C470,640 540,648 610,655 C680,662 750,655 820,640 C880,628 930,618 970,625';

/** Sea area below coastline (for subtle fill) */
export const SEA_AREA_PATH =
  'M30,620 C80,600 140,610 200,625 C260,640 330,650 400,645 C470,640 540,648 610,655 C680,662 750,655 820,640 C880,628 930,618 970,625 L970,700 L30,700 Z';

// ── Public API ──

export interface ComputedMapLayout {
  layouts: Record<string, RegionLayout>;
  wallPath: string;
  roads: string[];
}

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

  // Dynamic path: sort by importance, place in grid
  const sorted = [...regions].sort((a, b) => b.importance - a.importance);
  const placed = placeInGrid(sorted);

  const layouts: Record<string, RegionLayout> = {};

  for (const p of placed) {
    const hash = hashStr(p.id);
    const vertices = 8 + Math.round(seededRand(hash, 99) * 4);
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

// ── Legacy exports ──

export const REGION_LAYOUTS = STATIC_LAYOUTS;

/** Kingdom wall — elegant organic shape */
export const KINGDOM_WALL_PATH =
  'M160,55 Q500,20 840,55 Q920,120 900,260 Q910,440 870,570 Q780,660 500,670 Q220,660 130,570 Q90,440 100,260 Q80,120 160,55 Z';

/** Road network for preset layout */
export const ROAD_NETWORK: string[] = [
  'M500,255 Q500,200 500,168',                      // Center → N
  'M432,290 Q370,230 335,155',                       // Center → NW
  'M568,290 Q630,230 665,155',                       // Center → NE
  'M415,325 Q350,335 305,340',                       // Center → W
  'M585,325 Q650,335 695,340',                       // Center → E
  'M430,370 Q370,430 320,510',                       // Center → SW
  'M570,370 Q630,430 670,510',                       // Center → SE
];

/**
 * Tiny castle silhouette SVG paths per tier.
 * Standardized scale — all drawn at similar bounding size.
 */
export const CASTLE_ICONS: Record<string, string> = {
  keep:     'M-6,-12 L-6,-4 L-10,-4 L-10,4 L10,4 L10,-4 L6,-4 L6,-12 L3,-12 L3,-16 L-3,-16 L-3,-12 Z',
  castle:   'M-10,-14 L-10,-6 L-14,-6 L-14,6 L14,6 L14,-6 L10,-6 L10,-14 L6,-14 L6,-8 L-6,-8 L-6,-14 Z M-2,-18 L-2,-14 L2,-14 L2,-18 Z',
  fortress: 'M-14,-14 L-14,-6 L-18,-6 L-18,8 L18,8 L18,-6 L14,-6 L14,-14 L10,-14 L10,-8 L-10,-8 L-10,-14 Z M-6,-20 L-6,-14 L-2,-14 L-2,-20 Z M2,-20 L2,-14 L6,-14 L6,-20 Z',
  citadel:  'M-18,-14 L-18,-6 L-22,-6 L-22,10 L22,10 L22,-6 L18,-6 L18,-14 L14,-14 L14,-8 L-14,-8 L-14,-14 Z M-8,-22 L-8,-14 L-4,-14 L-4,-22 Z M4,-22 L4,-14 L8,-14 L8,-22 Z M-1,-28 L-1,-22 L1,-22 L1,-28 Z',
};
