/**
 * CollisionWorld.ts
 *
 * Lightweight collision geometry for the roaming mode.
 * Stores simple primitives (AABBs, cylinders, ground plane)
 * and tests a capsule against them each frame.
 *
 * No third-party physics engine — pure analytical math.
 */

import type { CastleTier } from '$lib/types';
import { WORLD_SCALE } from '$lib/state/CastleConstants';

// ── Primitives ───────────────────────────────────────────────

export interface AABBPrimitive {
  type: 'aabb';
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export interface CylinderPrimitive {
  type: 'cylinder';
  cx: number;       // center X
  cz: number;       // center Z
  radius: number;
  minY: number;
  maxY: number;
}

/** Hollow cylinder — collision only on the shell (wall). */
export interface WallRingPrimitive {
  type: 'wallRing';
  cx: number;
  cz: number;
  radius: number;
  thickness: number;   // wall thickness (collision band = radius ± thickness/2)
  minY: number;
  maxY: number;
  gateAngle: number;   // center angle of gate opening (radians)
  gateHalfArc: number; // half angular width of gate opening
}

export type CollisionPrimitive = AABBPrimitive | CylinderPrimitive | WallRingPrimitive;

export interface PushResult {
  pushX: number;
  pushY: number;
  pushZ: number;
}

// ── Tier → geometry mapping ──────────────────────────────────

function getWallRadius(tier: CastleTier): number {
  const S = WORLD_SCALE;
  switch (tier) {
    case 'hut': return 2 * S;
    case 'cottage': return 3 * S;
    case 'tower': return 3.5 * S;
    case 'keep': return 4 * S;
    case 'manor': return 5.5 * S;
    case 'castle': return 7 * S;
    case 'stronghold': return 8.5 * S;
    case 'fortress': return 10 * S;
    case 'palace': return 12 * S;
    case 'citadel': return 14 * S;
    case 'empire': return 16 * S;
    case 'legend': return 18 * S;
    default: return 7 * S;
  }
}

function getGateZ(tier: CastleTier): number {
  const S = WORLD_SCALE;
  switch (tier) {
    case 'hut': return 1.5 * S;
    case 'cottage': return 2 * S;
    case 'tower': return 2 * S;
    case 'keep': return 2 * S;
    case 'manor': return 3.5 * S;
    case 'castle': return 5.25 * S;
    case 'stronghold': return 7 * S;
    case 'fortress': return 8.5 * S;
    case 'palace': return 10.5 * S;
    case 'citadel': return 12.5 * S;
    case 'empire': return 14.5 * S;
    case 'legend': return 16.5 * S;
    default: return 5.25 * S;
  }
}

function getWallHeight(tier: CastleTier): number {
  const S = WORLD_SCALE;
  switch (tier) {
    case 'hut': return 2.5 * S;
    case 'cottage': return 3 * S;
    case 'tower': return 7 * S;
    case 'keep': return 5 * S;
    case 'manor': return 4 * S;
    case 'castle': return 3 * S;
    case 'stronghold': return 4 * S;
    case 'fortress': return 4 * S;
    case 'palace': return 5 * S;
    case 'citadel': return 5 * S;
    case 'empire': return 6 * S;
    case 'legend': return 7 * S;
    default: return 4 * S;
  }
}

function getTowerCount(tier: CastleTier): number {
  switch (tier) {
    case 'stronghold': return 6;
    case 'fortress': return 8;
    case 'palace': return 8;
    case 'citadel': return 10;
    case 'empire': return 12;
    case 'legend': return 12;
    default: return 0;
  }
}

function getTowerRadius(tier: CastleTier): number {
  const S = WORLD_SCALE;
  switch (tier) {
    case 'stronghold': return 1.2 * S;
    case 'fortress': return 1.3 * S;
    case 'palace': return 1.5 * S;
    case 'citadel': return 1.5 * S;
    case 'empire': return 1.8 * S;
    case 'legend': return 2.0 * S;
    default: return 1.0 * S;
  }
}

function getTowerHeight(tier: CastleTier): number {
  const S = WORLD_SCALE;
  switch (tier) {
    case 'stronghold': return 6 * S;
    case 'fortress': return 7 * S;
    case 'palace': return 8 * S;
    case 'citadel': return 9 * S;
    case 'empire': return 10 * S;
    case 'legend': return 12 * S;
    default: return 6 * S;
  }
}

// ── CollisionWorld ───────────────────────────────────────────

export class CollisionWorld {
  primitives: CollisionPrimitive[] = [];
  groundY = 0;
  /** World-space boundary: character can't roam beyond this radius. */
  worldBoundary = 45 * WORLD_SCALE;

  // ── Build ──────────────────────────────────────────────────

  buildFromTier(tier: CastleTier): void {
    this.clear();

    const wallR = getWallRadius(tier);
    const wallH = getWallHeight(tier);
    const _gateZ = getGateZ(tier);

    const S = WORLD_SCALE;

    // Gate opening angle: gate is at +Z, opening ~2.5 units wide
    const gateHalfWidth = 1.5 * S;
    const gateAngle = Math.PI / 2; // +Z direction in our coordinate system is angle=π/2
    const gateHalfArc = Math.atan2(gateHalfWidth, wallR);

    // Small tiers (box-based structures)
    if (tier === 'hut' || tier === 'cottage' || tier === 'keep') {
      const halfW = (tier === 'hut' ? 1 : tier === 'cottage' ? 1.5 : 1.5) * S;
      const halfD = halfW;
      const h = wallH;

      // Four walls as thin AABBs with gate opening in front (+Z)
      const wallThick = 0.4 * S;

      // Back wall
      this.primitives.push({
        type: 'aabb',
        minX: -halfW, minY: 0, minZ: -halfD - wallThick,
        maxX: halfW, maxY: h, maxZ: -halfD,
      });
      // Left wall
      this.primitives.push({
        type: 'aabb',
        minX: -halfW - wallThick, minY: 0, minZ: -halfD,
        maxX: -halfW, maxY: h, maxZ: halfD,
      });
      // Right wall
      this.primitives.push({
        type: 'aabb',
        minX: halfW, minY: 0, minZ: -halfD,
        maxX: halfW + wallThick, maxY: h, maxZ: halfD,
      });
      // Front wall — two sections flanking the gate
      // Gate opening is ~1.2 units wide centered at x=0
      const gateHalf = 0.6 * S;
      this.primitives.push({
        type: 'aabb',
        minX: -halfW, minY: 0, minZ: halfD,
        maxX: -gateHalf, maxY: h, maxZ: halfD + wallThick,
      });
      this.primitives.push({
        type: 'aabb',
        minX: gateHalf, minY: 0, minZ: halfD,
        maxX: halfW, maxY: h, maxZ: halfD + wallThick,
      });
      return;
    }

    // Tower tier: single cylindrical structure
    if (tier === 'tower') {
      this.primitives.push({
        type: 'cylinder',
        cx: 0, cz: 0,
        radius: 1.5 * S,
        minY: 0, maxY: wallH,
      });
      return;
    }

    // Manor: L-shaped building (approximated as two AABBs)
    if (tier === 'manor') {
      // Main hall
      this.primitives.push({
        type: 'aabb',
        minX: -4 * S, minY: 0, minZ: -3 * S,
        maxX: 4 * S, maxY: 4 * S, maxZ: 3 * S,
      });
      // Side wing
      this.primitives.push({
        type: 'aabb',
        minX: -2.5 * S, minY: 0, minZ: 3 * S,
        maxX: 2.5 * S, maxY: 3.5 * S, maxZ: 5.5 * S,
      });
      return;
    }

    // Castle tier: box-based walls
    if (tier === 'castle') {
      const halfW = 5 * S;
      const halfD = 5 * S;
      const wallThick = 0.5 * S;
      const h = 3 * S;

      // Back wall
      this.primitives.push({
        type: 'aabb',
        minX: -halfW, minY: 0, minZ: -halfD - wallThick,
        maxX: halfW, maxY: h, maxZ: -halfD,
      });
      // Left wall
      this.primitives.push({
        type: 'aabb',
        minX: -halfW - wallThick, minY: 0, minZ: -halfD,
        maxX: -halfW, maxY: h, maxZ: halfD,
      });
      // Right wall
      this.primitives.push({
        type: 'aabb',
        minX: halfW, minY: 0, minZ: -halfD,
        maxX: halfW + wallThick, maxY: h, maxZ: halfD,
      });
      // Front gate flanking walls
      this.primitives.push({
        type: 'aabb',
        minX: -halfW, minY: 0, minZ: halfD,
        maxX: -1.2 * S, maxY: h, maxZ: halfD + wallThick,
      });
      this.primitives.push({
        type: 'aabb',
        minX: 1.2 * S, minY: 0, minZ: halfD,
        maxX: halfW, maxY: h, maxZ: halfD + wallThick,
      });
      // 4 corner towers
      for (const [tx, tz] of [[-halfW, -halfD], [halfW, -halfD], [-halfW, halfD], [halfW, halfD]]) {
        this.primitives.push({
          type: 'cylinder',
          cx: tx, cz: tz,
          radius: 1.2 * S,
          minY: 0, maxY: 5 * S,
        });
      }
      // Central keep
      this.primitives.push({
        type: 'cylinder',
        cx: 0, cz: 0,
        radius: 2.5 * S,
        minY: 0, maxY: 7 * S,
      });
      return;
    }

    // Large tiers (stronghold+): concentric cylinder walls + towers
    // Outer curtain wall
    this.primitives.push({
      type: 'wallRing',
      cx: 0, cz: 0,
      radius: wallR,
      thickness: 0.6 * S,
      minY: 0, maxY: wallH,
      gateAngle,
      gateHalfArc,
    });

    // Inner wall for some tiers
    const innerRadius = this.getInnerRadius(tier);
    if (innerRadius > 0) {
      this.primitives.push({
        type: 'wallRing',
        cx: 0, cz: 0,
        radius: innerRadius,
        thickness: 0.5 * S,
        minY: 0, maxY: wallH + 1 * S,
        gateAngle,
        gateHalfArc: gateHalfArc * 1.2, // inner gate slightly wider
      });
    }

    // Outer towers
    const towerCount = getTowerCount(tier);
    const towerR = getTowerRadius(tier);
    const towerH = getTowerHeight(tier);
    for (let i = 0; i < towerCount; i++) {
      const angle = (i / towerCount) * Math.PI * 2;
      // Skip tower if it overlaps gate opening
      const angleDiff = Math.abs(this.normalizeAngle(angle - gateAngle));
      if (angleDiff < gateHalfArc * 1.5) continue;

      const tx = Math.cos(angle) * wallR;
      const tz = Math.sin(angle) * wallR;
      this.primitives.push({
        type: 'cylinder',
        cx: tx, cz: tz,
        radius: towerR,
        minY: 0, maxY: towerH,
      });
    }

    // Central keep (solid cylinder)
    const keepR = this.getKeepRadius(tier);
    if (keepR > 0) {
      this.primitives.push({
        type: 'cylinder',
        cx: 0, cz: 0,
        radius: keepR,
        minY: 0, maxY: wallH + 3 * S,
      });
    }
  }

  private getInnerRadius(tier: CastleTier): number {
    const S = WORLD_SCALE;
    switch (tier) {
      case 'stronghold': return 4 * S;
      case 'fortress': return 5 * S;
      case 'palace': return 6 * S;
      case 'citadel': return 8 * S;
      case 'empire': return 9 * S;
      case 'legend': return 10 * S;
      default: return 0;
    }
  }

  private getKeepRadius(tier: CastleTier): number {
    const S = WORLD_SCALE;
    switch (tier) {
      case 'stronghold': return 2 * S;
      case 'fortress': return 2.5 * S;
      case 'palace': return 3 * S;
      case 'citadel': return 3.5 * S;
      case 'empire': return 4 * S;
      case 'legend': return 4.5 * S;
      default: return 0;
    }
  }

  private normalizeAngle(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // ── Capsule Test ───────────────────────────────────────────
  //
  // The character capsule is approximated as a vertical line segment
  // (two endpoints) tested against each primitive.  The push vector
  // resolves penetration along the shortest axis.

  testCapsule(
    px: number, py: number, pz: number,
    radius: number, halfHeight: number,
  ): PushResult | null {
    let totalPushX = 0;
    let totalPushY = 0;
    let totalPushZ = 0;
    let hit = false;

    // Ground plane
    const footY = py - halfHeight - radius;
    if (footY < this.groundY) {
      totalPushY += this.groundY - footY;
      hit = true;
    }

    // World boundary (soft cylinder)
    const distFromCenter = Math.sqrt(px * px + pz * pz);
    if (distFromCenter > this.worldBoundary) {
      const overshoot = distFromCenter - this.worldBoundary;
      const nx = px / distFromCenter;
      const nz = pz / distFromCenter;
      totalPushX -= nx * overshoot;
      totalPushZ -= nz * overshoot;
      hit = true;
    }

    for (const prim of this.primitives) {
      const push = this.testCapsuleVsPrimitive(px, py, pz, radius, halfHeight, prim);
      if (push) {
        totalPushX += push.pushX;
        totalPushY += push.pushY;
        totalPushZ += push.pushZ;
        hit = true;
      }
    }

    return hit ? { pushX: totalPushX, pushY: totalPushY, pushZ: totalPushZ } : null;
  }

  private testCapsuleVsPrimitive(
    px: number, py: number, pz: number,
    radius: number, halfHeight: number,
    prim: CollisionPrimitive,
  ): PushResult | null {
    switch (prim.type) {
      case 'aabb': return this.capsuleVsAABB(px, py, pz, radius, halfHeight, prim);
      case 'cylinder': return this.capsuleVsCylinder(px, py, pz, radius, halfHeight, prim);
      case 'wallRing': return this.capsuleVsWallRing(px, py, pz, radius, halfHeight, prim);
    }
  }

  // ── Capsule vs AABB ────────────────────────────────────────
  // Closest point on capsule line segment to AABB, then sphere-AABB test.

  private capsuleVsAABB(
    px: number, py: number, pz: number,
    radius: number, halfH: number,
    box: AABBPrimitive,
  ): PushResult | null {
    // Y overlap test first (early out)
    const capsTop = py + halfH + radius;
    const capsBot = py - halfH - radius;
    if (capsTop < box.minY || capsBot > box.maxY) return null;

    // Closest point on AABB to capsule center (XZ only for simplicity)
    const clampX = Math.max(box.minX, Math.min(box.maxX, px));
    const clampZ = Math.max(box.minZ, Math.min(box.maxZ, pz));

    const dx = px - clampX;
    const dz = pz - clampZ;
    const distSq = dx * dx + dz * dz;

    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq);
      if (dist < 0.0001) {
        // Inside the box — push out toward closest face
        const pushes = [
          { axis: 'x' as const, val: box.maxX - px + radius },
          { axis: 'x' as const, val: -(px - box.minX + radius) },
          { axis: 'z' as const, val: box.maxZ - pz + radius },
          { axis: 'z' as const, val: -(pz - box.minZ + radius) },
        ];
        pushes.sort((a, b) => Math.abs(a.val) - Math.abs(b.val));
        const best = pushes[0];
        return {
          pushX: best.axis === 'x' ? best.val : 0,
          pushY: 0,
          pushZ: best.axis === 'z' ? best.val : 0,
        };
      }
      const penetration = radius - dist;
      const nx = dx / dist;
      const nz = dz / dist;
      return { pushX: nx * penetration, pushY: 0, pushZ: nz * penetration };
    }

    return null;
  }

  // ── Capsule vs Cylinder (solid) ────────────────────────────
  // XZ circle-circle test, then Y overlap.

  private capsuleVsCylinder(
    px: number, py: number, pz: number,
    radius: number, halfH: number,
    cyl: CylinderPrimitive,
  ): PushResult | null {
    // Y overlap
    const capsTop = py + halfH + radius;
    const capsBot = py - halfH - radius;
    if (capsTop < cyl.minY || capsBot > cyl.maxY) return null;

    const dx = px - cyl.cx;
    const dz = pz - cyl.cz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = cyl.radius + radius;

    if (dist < minDist) {
      if (dist < 0.0001) {
        // Dead center — push +Z
        return { pushX: 0, pushY: 0, pushZ: minDist };
      }
      const penetration = minDist - dist;
      const nx = dx / dist;
      const nz = dz / dist;
      return { pushX: nx * penetration, pushY: 0, pushZ: nz * penetration };
    }

    return null;
  }

  // ── Capsule vs Wall Ring ───────────────────────────────────
  // A ring wall: collision if character is near the ring radius
  // AND not in the gate opening arc.

  private capsuleVsWallRing(
    px: number, py: number, pz: number,
    radius: number, halfH: number,
    ring: WallRingPrimitive,
  ): PushResult | null {
    // Y overlap
    const capsTop = py + halfH + radius;
    const capsBot = py - halfH - radius;
    if (capsTop < ring.minY || capsBot > ring.maxY) return null;

    const dx = px - ring.cx;
    const dz = pz - ring.cz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Check if in gate opening
    const angle = Math.atan2(dz, dx);
    const angleDiff = Math.abs(this.normalizeAngle(angle - ring.gateAngle));
    if (angleDiff < ring.gateHalfArc) return null; // In the gate opening

    // Wall band: ring.radius ± ring.thickness/2
    const innerEdge = ring.radius - ring.thickness / 2;
    const outerEdge = ring.radius + ring.thickness / 2;

    // Inside inner edge: push inward
    if (dist > innerEdge - radius && dist < ring.radius) {
      const penetration = (innerEdge - radius) > 0 ? radius - (innerEdge - dist) : radius + dist - innerEdge;
      if (dist < innerEdge + radius) {
        const pushDist = innerEdge - radius - dist;
        if (pushDist < 0) {
          // Push character toward center (away from wall)
          const nd = dist > 0.0001 ? dist : 1;
          const nx = dx / nd;
          const nz = dz / nd;
          return { pushX: nx * pushDist, pushY: 0, pushZ: nz * pushDist };
        }
      }
    }

    // Outside outer edge: push outward
    if (dist > ring.radius && dist < outerEdge + radius) {
      const pushDist = outerEdge + radius - dist;
      if (pushDist > 0) {
        const nd = dist > 0.0001 ? dist : 1;
        const nx = dx / nd;
        const nz = dz / nd;
        return { pushX: nx * pushDist, pushY: 0, pushZ: nz * pushDist };
      }
    }

    // Character approaching from inside the ring
    if (dist < innerEdge + radius && dist > innerEdge - radius) {
      const nd = dist > 0.0001 ? dist : 1;
      const nx = dx / nd;
      const nz = dz / nd;
      // Push to whichever side is closer
      const toInner = innerEdge - radius - dist; // negative = penetrating from outside
      const toOuter = outerEdge + radius - dist; // positive = penetrating from inside

      if (Math.abs(toInner) < Math.abs(toOuter)) {
        return { pushX: nx * toInner, pushY: 0, pushZ: nz * toInner };
      } else {
        return { pushX: nx * toOuter, pushY: 0, pushZ: nz * toOuter };
      }
    }

    return null;
  }

  // ── Utilities ──────────────────────────────────────────────

  clear(): void {
    this.primitives.length = 0;
  }

  getSpawnPosition(tier: CastleTier): { x: number; y: number; z: number } {
    const wallR = getWallRadius(tier);
    const gateZ = getGateZ(tier);
    // Capsule center must be high enough for feet (center - halfHeight - radius) to touch ground.
    // halfHeight = 0.5 * WORLD_SCALE, radius = 0.3 * WORLD_SCALE → center Y = 0.8 * WORLD_SCALE
    return {
      x: 0,
      y: 0.8 * WORLD_SCALE, // capsule center above ground
      z: gateZ + wallR + 3 * WORLD_SCALE, // a bit outside the gate
    };
  }
}
