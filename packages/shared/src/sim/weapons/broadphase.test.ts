import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../../arena/arena-01.js";
import { ARENA_02 } from "../../arena/arena-02.js";
import type { BeamHitbox, ProjectileHitbox } from "../../config/weapon-types.js";
import {
  aabbCorners,
  convexOverlap,
  convexOverlapsAabb,
  pointsBoundsOf,
  type Aabb,
  type Obb,
} from "../collide.js";
import { shapeReach } from "./hits.js";
import { beamShapeAt, projectileShapeAt, shapeHitsObb, smear, type WorldShape } from "./shapes.js";

/**
 * The two broadphases NR37's fast-forward leaned on (`shapeReach` for cars, `convexOverlapsAabb` for
 * level geometry) claim to be EXACT: they may only skip a narrowphase call that would have said "no".
 * These seeded property tests hold them to it over every hitbox family the table authors, rotated
 * hulls, real spike strips, and pairs built to touch exactly at the broadphase's own edges — the case
 * a sloppy `<` vs `<=` would get wrong.
 */

/** Deterministic LCG: the same pairs every run, so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

const PROJECTILES: ProjectileHitbox[] = [
  { shape: "circle", radius: 12 },
  { shape: "ellipse", radiusAlong: 9, radiusAcross: 3 },
  { shape: "capsule", radiusAlong: 24, radiusAcross: 15 },
  { shape: "bar", radiusAlong: 6, radiusAcross: 60 },
];
const BEAMS: BeamHitbox[] = [
  { shape: "rect", width: 57.5 },
  { shape: "cone", angleDeg: 55 },
  { shape: "disc" },
];

/**
 * How far past (positive) or into (negative) a face a flush pair is placed. Spans both sides of the
 * SAT's own 1e-6 "just touching" tolerance, so a broadphase that rejects a shallow real overlap fails.
 */
const HAIRS = [0, 1e-9, -1e-9, 1e-4, -1e-4, -1e-3, -0.1];

/** A random weapon shape near the origin: a projectile (alone or smeared) or a beam of any reach. */
function randomShape(r: () => number): WorldShape {
  const x = (r() - 0.5) * 200;
  const y = (r() - 0.5) * 200;
  const angle = r() * Math.PI * 2;
  const pick = r();
  if (pick < 0.5) {
    const hitbox = PROJECTILES[Math.floor(r() * PROJECTILES.length)]!;
    const at = projectileShapeAt(hitbox, x, y, angle);
    if (r() < 0.3) return at;
    const step = r() * 60;
    return smear(at, projectileShapeAt(hitbox, x + Math.cos(angle) * step, y + Math.sin(angle) * step, angle));
  }
  const hitbox = BEAMS[Math.floor(r() * BEAMS.length)]!;
  // Reach 0 included on purpose: an empty polygon, which both sides must call a miss.
  const extent = r() < 0.05 ? 0 : r() * 300;
  return beamShapeAt(hitbox, x, y, angle, extent);
}

/** The shape's own axis-aligned bounds, for building pairs that touch them exactly. */
function boundsOfShape(shape: WorldShape) {
  if (shape.kind === "circle") {
    return { minX: shape.x - shape.radius, maxX: shape.x + shape.radius, minY: shape.y - shape.radius, maxY: shape.y + shape.radius };
  }
  return pointsBoundsOf(shape.points);
}

describe("shapeReach (car broadphase) is exact", () => {
  it("agrees with shapeHitsObb on every seeded pair, touching edges included", () => {
    const r = rng(20261001);
    let hits = 0;
    let misses = 0;
    for (let i = 0; i < 40000; i++) {
      const shape = randomShape(r);
      const reach = shapeReach(shape);
      const b = boundsOfShape(shape);
      let hull: Obb;
      const how = r();
      if (how < 0.2 && shape.kind === "polygon" && shape.points.length >= 3) {
        // A hull turned so one CORNER points straight at the shape's right-most vertex, sitting a
        // hair off it — the case where a hull reaches furthest for its size, and where a bounding
        // circle that is even slightly too small would wrongly reject.
        const w = 60;
        const h = 40;
        const vertex = shape.points.reduce((a, p) => (p.x > a.x ? p : a));
        const hair = HAIRS[Math.floor(r() * HAIRS.length)]!;
        const half = Math.hypot(w, h) / 2;
        hull = { x: vertex.x + half + hair, y: vertex.y, angle: Math.PI - Math.atan2(h, w), w, h };
      } else if (how < 0.45 && Number.isFinite(b.maxX)) {
        // Axis-aligned, flush against one face of the shape's bounds (± a hair).
        const w = 60;
        const h = 40;
        const hair = HAIRS[Math.floor(r() * HAIRS.length)]!;
        const side = Math.floor(r() * 4);
        const cy = b.minY + r() * (b.maxY - b.minY);
        const cx = b.minX + r() * (b.maxX - b.minX);
        hull =
          side === 0 ? { x: b.maxX + w / 2 + hair, y: cy, angle: 0, w, h }
          : side === 1 ? { x: b.minX - w / 2 - hair, y: cy, angle: 0, w, h }
          : side === 2 ? { x: cx, y: b.maxY + h / 2 + hair, angle: 0, w, h }
          : { x: cx, y: b.minY - h / 2 - hair, angle: 0, w, h };
      } else {
        hull = { x: (r() - 0.5) * 700, y: (r() - 0.5) * 700, angle: r() * Math.PI * 2, w: 60, h: 40 };
      }
      const exact = shapeHitsObb(shape, hull);
      expect(reach.touches(hull), `pair ${i}`).toBe(exact);
      if (exact) hits++;
      else misses++;
    }
    // Both outcomes well represented, or the property is vacuous.
    expect(hits).toBeGreaterThan(2000);
    expect(misses).toBeGreaterThan(2000);
  });
});

describe("convexOverlapsAabb (level-geometry broadphase) is exact", () => {
  /** A random projectile smear — the only thing `hitsWorld` ever tests against geometry. */
  function randomSmear(r: () => number, cx: number, cy: number) {
    const hitbox = PROJECTILES[Math.floor(r() * PROJECTILES.length)]!;
    const angle = r() * Math.PI * 2;
    const x = cx + (r() - 0.5) * 160;
    const y = cy + (r() - 0.5) * 160;
    const step = r() * 60;
    return smear(
      projectileShapeAt(hitbox, x, y, angle),
      projectileShapeAt(hitbox, x + Math.cos(angle) * step, y + Math.sin(angle) * step, angle),
    ).points;
  }

  it("agrees with convexOverlap against random boxes, flush boxes and the real spike strips", () => {
    const r = rng(37);
    const spikes: Aabb[] = [...ARENA_01.obstacles, ...ARENA_02.obstacles];
    let hits = 0;
    let misses = 0;
    for (let i = 0; i < 40000; i++) {
      const mode = r();
      let points;
      let box: Aabb;
      if (mode < 0.4 && spikes.length > 0) {
        box = spikes[Math.floor(r() * spikes.length)]!;
        points = randomSmear(r, box.x + box.w / 2, box.y + box.h / 2);
      } else {
        points = randomSmear(r, 0, 0);
        const b = pointsBoundsOf(points);
        if (mode < 0.7) {
          // Flush against one face of the smear's own bounds, ± a hair.
          const hair = HAIRS[Math.floor(r() * HAIRS.length)]!;
          const w = 5 + r() * 100;
          const h = 5 + r() * 100;
          const side = Math.floor(r() * 4);
          const oy = b.minY - h / 2 + r() * (b.maxY - b.minY);
          const ox = b.minX - w / 2 + r() * (b.maxX - b.minX);
          box =
            side === 0 ? { x: b.maxX + hair, y: oy, w, h }
            : side === 1 ? { x: b.minX - w - hair, y: oy, w, h }
            : side === 2 ? { x: ox, y: b.maxY + hair, w, h }
            : { x: ox, y: b.minY - h - hair, w, h };
        } else {
          box = { x: (r() - 0.5) * 300, y: (r() - 0.5) * 300, w: 5 + r() * 150, h: 5 + r() * 150 };
        }
      }
      const exact = convexOverlap(points, aabbCorners(box));
      expect(convexOverlapsAabb(points, pointsBoundsOf(points), box), `pair ${i}`).toBe(exact);
      if (exact) hits++;
      else misses++;
    }
    expect(hits).toBeGreaterThan(2000);
    expect(misses).toBeGreaterThan(2000);
  });
});
