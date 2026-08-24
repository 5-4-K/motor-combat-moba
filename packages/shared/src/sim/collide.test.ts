import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { Aabb, Obb } from "./collide.js";
import { resolveWorld } from "./collide.js";
import type { SimBody } from "./step.js";

const CAR_W = DRIVE_CONFIG.carWidth;
const CAR_H = DRIVE_CONFIG.carHeight;
const BOUNDS = { width: 1000, height: 1000 };

/** A contact this shallow counts as touching, not overlapping. */
const TOUCH_SLACK = 1e-6;

function body(patch: Partial<SimBody>): SimBody {
  return { x: 0, y: 0, angle: 0, speed: 0, reverseHold: 0, ...patch };
}

function carObb(b: SimBody): Obb {
  return { x: b.x, y: b.y, angle: b.angle, w: CAR_W, h: CAR_H };
}

function boxObb(a: Aabb): Obb {
  return { x: a.x + a.w / 2, y: a.y + a.h / 2, angle: 0, w: a.w, h: a.h };
}

function cornersOf(o: Obb): Array<{ x: number; y: number }> {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const hw = o.w / 2;
  const hh = o.h / 2;
  const local: Array<[number, number]> = [
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ];
  return local.map(([lx, ly]) => ({ x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c }));
}

/** Point-in-box in the box's own frame; `slack` shrinks the box so exact touching does not count. */
function isInside(px: number, py: number, o: Obb, slack: number): boolean {
  const dx = px - o.x;
  const dy = py - o.y;
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const u = dx * c + dy * s;
  const v = -dx * s + dy * c;
  return Math.abs(u) <= o.w / 2 - slack && Math.abs(v) <= o.h / 2 - slack;
}

/** Grid resolution for the sampled overlap check below. */
const SAMPLES_PER_SIDE = 17;

/** Evenly spaced points strictly inside a box, in world space. */
function interiorSamples(o: Obb): Array<{ x: number; y: number }> {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < SAMPLES_PER_SIDE; i++) {
    const u = ((i + 0.5) / SAMPLES_PER_SIDE - 0.5) * o.w;
    for (let j = 0; j < SAMPLES_PER_SIDE; j++) {
      const v = ((j + 0.5) / SAMPLES_PER_SIDE - 0.5) * o.h;
      points.push({ x: o.x + u * c - v * s, y: o.y + u * s + v * c });
    }
  }
  return points;
}

/**
 * Independent overlap check for the test suite: corner containment plus a sampled interior grid,
 * both ways. Corner containment alone misses edge-aligned rectangles (two cars sharing a y-span);
 * the grid covers those. Deliberately written without SAT so it cannot restate the implementation.
 */
function overlaps(a: Obb, b: Obb): boolean {
  const probesA = [...cornersOf(a), ...interiorSamples(a)];
  const probesB = [...cornersOf(b), ...interiorSamples(b)];
  return (
    probesA.some((p) => isInside(p.x, p.y, b, TOUCH_SLACK)) ||
    probesB.some((p) => isInside(p.x, p.y, a, TOUCH_SLACK))
  );
}

/** Half-extents of the axis-aligned box that encloses the car OBB at `angle`. */
function hullHalfExtents(angle: number): { hx: number; hy: number } {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return { hx: (c * CAR_W + s * CAR_H) / 2, hy: (s * CAR_W + c * CAR_H) / 2 };
}

describe("resolveWorld - world bounds", () => {
  it("a body driving +x through the right wall ends up in bounds and does not gain outward speed", () => {
    const start = body({ x: BOUNDS.width - 5, y: 500, angle: 0, speed: 100 });
    const out = resolveWorld(start, [], [], BOUNDS);

    const { hx } = hullHalfExtents(out.angle);
    expect(out.x + hx).toBeLessThanOrEqual(BOUNDS.width + TOUCH_SLACK);
    expect(out.x).toBeLessThan(start.x);
    // angle 0 means +speed points at the wall, so the surviving speed must not be outward.
    expect(out.speed).toBeLessThanOrEqual(0);
    expect(Math.abs(out.speed)).toBeLessThan(Math.abs(start.speed));
    expect(Math.abs(out.speed)).toBeCloseTo(Math.abs(start.speed) * DRIVE_CONFIG.restitution);
  });

  it("clamps both axes when a body is out of bounds past a corner", () => {
    const out = resolveWorld(body({ x: -30, y: -20, angle: 0 }), [], [], BOUNDS);
    const { hx, hy } = hullHalfExtents(out.angle);
    expect(out.x).toBeGreaterThanOrEqual(hx - TOUCH_SLACK);
    expect(out.y).toBeGreaterThanOrEqual(hy - TOUCH_SLACK);
  });

  it("carries angle and reverseHold through unchanged", () => {
    const start = body({ x: BOUNDS.width + 40, y: 500, angle: 1.23, speed: 40, reverseHold: 4 });
    const out = resolveWorld(start, [], [], BOUNDS);
    expect(out.angle).toBe(start.angle);
    expect(out.reverseHold).toBe(start.reverseHold);
  });
});

describe("resolveWorld - obstacles", () => {
  const obstacle: Aabb = { x: 110, y: 90, w: 100, h: 100 };

  it("pushes a body overlapping an obstacle back out, away from the obstacle", () => {
    const start = body({ x: 100, y: 100, angle: 0, speed: 60 });
    expect(overlaps(carObb(start), boxObb(obstacle))).toBe(true);

    const out = resolveWorld(start, [], [obstacle], BOUNDS);
    expect(overlaps(carObb(out), boxObb(obstacle))).toBe(false);
    // Sign check: the push must move the car away from the obstacle centre, never into it.
    expect(out.x).toBeLessThan(start.x);
  });

  it("pushes a stationary, already-overlapping body out without inventing speed", () => {
    const start = body({ x: 120, y: 130, angle: 0.4, speed: 0 });
    const out = resolveWorld(start, [], [obstacle], BOUNDS);
    expect(overlaps(carObb(out), boxObb(obstacle))).toBe(false);
    expect(out.speed).toBe(0);
  });

  it("leaves a body that only touches an obstacle edge alone", () => {
    // Car spans [76,124] on x at angle 0; this obstacle starts exactly at x = 124.
    const touching: Aabb = { x: 124, y: 90, w: 100, h: 100 };
    const start = body({ x: 100, y: 100, angle: 0, speed: 60 });
    const out = resolveWorld(start, [], [touching], BOUNDS);
    expect(out.x).toBe(start.x);
    expect(out.y).toBe(start.y);
    expect(out.speed).toBe(start.speed);
  });

  it("keeps speed when the body is moving away from the surface it is against", () => {
    // Facing -x at the right wall: overlapping it, but travelling out of it.
    const start = body({ x: BOUNDS.width - 5, y: 500, angle: Math.PI, speed: 100 });
    const out = resolveWorld(start, [], [], BOUNDS);
    expect(out.x).toBeLessThan(start.x);
    expect(out.speed).toBeCloseTo(100);
  });
});

describe("resolveWorld - the car is a real OBB, not its axis-aligned hull", () => {
  // Car centre (100,100), half-extents 24 x 16.
  const start = { x: 100, y: 100, speed: 0, reverseHold: 0 };

  // Sits just past the car's +x face, but inside the 45deg-rotated rectangle.
  const clearsAxisAligned: Aabb = { x: 125, y: 104, w: 4, h: 4 };
  // Sits inside the car's +x/-y corner, but outside the 45deg-rotated rectangle.
  const clearsRotated: Aabb = { x: 120, y: 84, w: 4, h: 4 };

  it("a 45deg car hits a box that the unrotated car misses", () => {
    const flat = body({ ...start, angle: 0 });
    const outFlat = resolveWorld(flat, [], [clearsAxisAligned], BOUNDS);
    expect(outFlat.x).toBe(flat.x);
    expect(outFlat.y).toBe(flat.y);

    const tilted = body({ ...start, angle: Math.PI / 4 });
    expect(overlaps(carObb(tilted), boxObb(clearsAxisAligned))).toBe(true);
    const outTilted = resolveWorld(tilted, [], [clearsAxisAligned], BOUNDS);
    expect(outTilted.x === tilted.x && outTilted.y === tilted.y).toBe(false);
    expect(overlaps(carObb(outTilted), boxObb(clearsAxisAligned))).toBe(false);
  });

  it("a 45deg car clears a corner box that the unrotated car overlaps", () => {
    const tilted = body({ ...start, angle: Math.PI / 4 });
    const outTilted = resolveWorld(tilted, [], [clearsRotated], BOUNDS);
    expect(outTilted.x).toBe(tilted.x);
    expect(outTilted.y).toBe(tilted.y);

    const flat = body({ ...start, angle: 0 });
    expect(overlaps(carObb(flat), boxObb(clearsRotated))).toBe(true);
    const outFlat = resolveWorld(flat, [], [clearsRotated], BOUNDS);
    expect(overlaps(carObb(outFlat), boxObb(clearsRotated))).toBe(false);
  });
});

describe("resolveWorld - car vs car", () => {
  it("separates two cars overlapping along x", () => {
    const start = body({ x: 500, y: 500, angle: 0, speed: 0 });
    const other: Obb = { x: 520, y: 500, angle: 0, w: CAR_W, h: CAR_H };
    expect(overlaps(carObb(start), other)).toBe(true);

    const out = resolveWorld(start, [other], [], BOUNDS);
    expect(overlaps(carObb(out), other)).toBe(false);
    expect(Math.hypot(out.x - other.x, out.y - other.y)).toBeGreaterThanOrEqual(CAR_W - TOUCH_SLACK);
    expect(out.x).toBeLessThan(start.x);
  });

  it("bounces a car driving into another car", () => {
    const start = body({ x: 500, y: 500, angle: 0, speed: 80 });
    const other: Obb = { x: 530, y: 500, angle: 0, w: CAR_W, h: CAR_H };
    const out = resolveWorld(start, [other], [], BOUNDS);
    expect(out.speed).toBeCloseTo(-80 * DRIVE_CONFIG.restitution);
  });
});

describe("resolveWorld - degenerate geometry", () => {
  it("does not produce NaN when two cars sit exactly on top of each other", () => {
    const start = body({ x: 500, y: 500, angle: 0, speed: 20 });
    const other: Obb = { x: 500, y: 500, angle: 0, w: CAR_W, h: CAR_H };
    const out = resolveWorld(start, [other], [], BOUNDS);

    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(Number.isFinite(out.speed)).toBe(true);
    // Ambiguous push direction, but it must still be resolved the same way every time.
    expect(out).toEqual(resolveWorld(start, [other], [], BOUNDS));
  });

  it("settles to a finite pose when the car is wider than the gap between two obstacles", () => {
    const gap: Aabb[] = [
      { x: 400, y: 400, w: 90, h: 200 },
      { x: 500, y: 400, w: 90, h: 200 },
    ];
    const start = body({ x: 495, y: 500, angle: 0, speed: 90 });
    const out = resolveWorld(start, [], gap, BOUNDS);

    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(Number.isFinite(out.speed)).toBe(true);
    expect(Math.abs(out.speed)).toBeLessThanOrEqual(Math.abs(start.speed));
  });
});

describe("resolveWorld - purity and determinism", () => {
  const obstacles: Aabb[] = [
    { x: 110, y: 90, w: 100, h: 100 },
    { x: 60, y: 60, w: 40, h: 40 },
  ];
  const others: Obb[] = [
    { x: 118, y: 108, angle: 0.7, w: CAR_W, h: CAR_H },
    { x: 80, y: 120, angle: -0.3, w: CAR_W, h: CAR_H },
  ];
  const start = body({ x: 100, y: 100, angle: 0.2, speed: 55, reverseHold: 3 });

  it("is deterministic for identical inputs", () => {
    const a = resolveWorld(start, others, obstacles, BOUNDS);
    const b = resolveWorld(start, others, obstacles, BOUNDS);
    expect(a).toEqual(b);
  });

  it("does not mutate the body, the obstacles, or the other cars", () => {
    const bodyBefore = JSON.stringify(start);
    const obstaclesBefore = JSON.stringify(obstacles);
    const othersBefore = JSON.stringify(others);

    resolveWorld(start, others, obstacles, BOUNDS);

    expect(JSON.stringify(start)).toBe(bodyBefore);
    expect(JSON.stringify(obstacles)).toBe(obstaclesBefore);
    expect(JSON.stringify(others)).toBe(othersBefore);
  });

  it("returns a fresh body object", () => {
    const out = resolveWorld(start, [], [], BOUNDS);
    expect(out).not.toBe(start);
  });
});
