import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { Aabb, Obb } from "./collide.js";
import { obbsOverlap, pointInAabb, pointInObb, resolveWorld } from "./collide.js";
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

  // These two fixtures are hand-computed from the rotation by construction, and that is the point.
  // `cornersOf` and `hullHalfExtents` in this file are line-for-line copies of the implementation's
  // rotation maths, so a sign error shared by both would sail through any assertion built on them.
  // Boxes placed at coordinates worked out by hand cannot collude with such a bug: each one lies
  // inside exactly one of the two poses, so getting the rotation sign backwards swaps which test
  // fails. `overlaps` (independent, sampled) rather than `penetrationDepth` (a SAT copy) is used
  // below for the same reason.
  //
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

describe("resolveWorld - deep penetration (containment on a separating axis)", () => {
  // ARENA_01's centre block. Spans x[1080,1320], y[620,980].
  const block: Aabb = { x: 1080, y: 620, w: 240, h: 360 };
  const ARENA = { width: 2400, height: 1600 };

  /** Car centre for a car whose leading +x edge is `depth` past the block's left face. */
  function centreAtDepth(depth: number): number {
    return block.x + depth - CAR_W / 2;
  }

  // The old raw-intersection MTV picked the wrong axis once `depth` exceeded the car's extent
  // perpendicular to the face (32), shoving the car sideways along the wall instead of back out.
  for (const depth of [33, 60, 100]) {
    it(`ejects a car ${depth} deep through the left face along the face normal`, () => {
      const start = body({ x: centreAtDepth(depth), y: 800, angle: 0, speed: 100 });
      expect(overlaps(carObb(start), boxObb(block))).toBe(true);

      const out = resolveWorld(start, [], [block], ARENA);

      expect(overlaps(carObb(out), boxObb(block))).toBe(false);
      // Push must be along the face normal (-x), not sideways along the face.
      expect(out.x).toBeLessThan(start.x);
      expect(out.y).toBe(start.y);
      // A normal opposing travel must actually fire the bounce.
      expect(out.speed).toBeCloseTo(-100 * DRIVE_CONFIG.restitution);
    });
  }

  it("ejects a car sitting fully inside the block, taking the nearest face out", () => {
    // Off-centre: nearest exit is the top face (y = 620), 210 away vs 240/270/150+ elsewhere.
    const start = body({ x: 1200, y: 700, angle: 0, speed: 0 });
    const out = resolveWorld(start, [], [block], ARENA);

    expect(overlaps(carObb(out), boxObb(block))).toBe(false);
    expect(out.y).toBeLessThan(start.y);
    expect(out.x).toBe(start.x);
  });

  it("ejects a car at the block's exact centre", () => {
    const start = body({ x: 1200, y: 800, angle: 0, speed: 0 });
    const out = resolveWorld(start, [], [block], ARENA);
    expect(overlaps(carObb(out), boxObb(block))).toBe(false);
  });

  it("ejects a car deeply overlapping another car", () => {
    const start = body({ x: 500, y: 500, angle: 0, speed: 0 });
    const other: Obb = { x: 505, y: 500, angle: 0, w: CAR_W, h: CAR_H };
    const out = resolveWorld(start, [other], [], BOUNDS);

    expect(overlaps(carObb(out), other)).toBe(false);
    // Near-coincident cars separate along their short axis: 32 up beats 43 sideways, so the floor
    // here is carHeight, not carWidth. An MTV is the *minimum* push, not the axis you expected.
    expect(Math.hypot(out.x - other.x, out.y - other.y)).toBeGreaterThanOrEqual(CAR_H - TOUCH_SLACK);
  });

  it("settles in a single resolve, however deep the penetration", () => {
    // The guard against an undersized MTV: if one resolve truly separates the body, resolving the
    // result again must change nothing. A too-short push shows up here as continued movement.
    for (const depth of [1, 32, 33, 100, 239]) {
      const once = resolveWorld(body({ x: centreAtDepth(depth), y: 800, angle: 0, speed: 100 }), [], [block], ARENA);
      const twice = resolveWorld(once, [], [block], ARENA);
      expect(twice).toEqual(once);
    }
  });

  it("clamps a body shoved far past a world bound", () => {
    const start = body({ x: BOUNDS.width + 500, y: 500, angle: 0, speed: 100 });
    const out = resolveWorld(start, [], [], BOUNDS);
    const { hx } = hullHalfExtents(out.angle);
    expect(out.x + hx).toBeLessThanOrEqual(BOUNDS.width + TOUCH_SLACK);
  });
});

describe("resolveWorld - the arena boundary is inviolable", () => {
  /** True when the car's axis-aligned hull lies wholly inside the arena. */
  function inBounds(b: SimBody, bounds: { width: number; height: number }): boolean {
    const { hx, hy } = hullHalfExtents(b.angle);
    return (
      b.x - hx >= -TOUCH_SLACK &&
      b.y - hy >= -TOUCH_SLACK &&
      b.x + hx <= bounds.width + TOUCH_SLACK &&
      b.y + hy <= bounds.height + TOUCH_SLACK
    );
  }

  it("keeps a car squeezed between another car and the left wall inside the arena", () => {
    const start = body({ x: 26, y: 500, angle: 0, speed: 0 });
    const other: Obb = { x: 60, y: 500, angle: 0, w: CAR_W, h: CAR_H };

    const out = resolveWorld(start, [other], [], BOUNDS);
    expect(inBounds(out, BOUNDS)).toBe(true);
  });

  it("keeps a car wedged into a corner by two other cars inside the arena", () => {
    const start = body({ x: 30, y: 30, angle: 0, speed: 0 });
    const others: Obb[] = [
      { x: 64, y: 30, angle: 0, w: CAR_W, h: CAR_H },
      { x: 30, y: 62, angle: 0, w: CAR_W, h: CAR_H },
    ];

    const out = resolveWorld(start, others, [], BOUNDS);
    expect(inBounds(out, BOUNDS)).toBe(true);
  });

  it("keeps a car inside the arena when an obstacle push drives it at a wall", () => {
    // Obstacle hard against the left wall: the only way out is toward x = 0.
    const hugging: Aabb = { x: 0, y: 400, w: 60, h: 200 };
    const start = body({ x: 50, y: 500, angle: 0, speed: 0 });

    const out = resolveWorld(start, [], [hugging], BOUNDS);
    expect(inBounds(out, BOUNDS)).toBe(true);
  });
});

/**
 * Exact OBB-vs-OBB penetration depth: 0 when separated. Unlike `overlaps` above this mirrors the
 * implementation's SAT, so it cannot vouch for SAT itself — but it measures *how far* a body is
 * embedded, which a sampled boolean cannot. Use it where a depth bound is the point; use
 * `overlaps` where independence from the implementation is the point.
 */
function penetrationDepth(a: Obb, b: Obb): number {
  const cornersA = cornersOf(a);
  const cornersB = cornersOf(b);
  const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2].map((t) => ({
    x: Math.cos(t),
    y: Math.sin(t),
  }));

  let depth = Infinity;
  for (const axis of axes) {
    const project = (cs: Array<{ x: number; y: number }>) => cs.map((p) => p.x * axis.x + p.y * axis.y);
    const pa = project(cornersA);
    const pb = project(cornersB);
    const separation = Math.min(
      Math.max(...pa) - Math.min(...pb),
      Math.max(...pb) - Math.min(...pa),
    );
    if (separation <= 0) return 0;
    depth = Math.min(depth, separation);
  }
  return depth;
}

describe("resolveWorld - contact priority ordering", () => {
  // ARENA_01's lower-right block. Spans x[1680,1900], y[1170,1250].
  const block: Aabb = { x: 1680, y: 1170, w: 220, h: 80 };
  const ARENA = { width: 2400, height: 1600 };

  it("never leaves a car embedded in an obstacle after another car pushes it there", () => {
    // Starts 6px CLEAR of the block; the car-vs-car push drives it 7px in. Obstacles must resolve
    // after cars, or this is a stable fixed point and the car is embedded in level geometry for good.
    const start = body({ x: 1650, y: 1210, angle: 0, speed: 0 });
    const other: Obb = { x: 1615, y: 1210, angle: 0, w: CAR_W, h: CAR_H };
    expect(penetrationDepth(carObb(start), boxObb(block))).toBe(0);

    const out = resolveWorld(start, [other], [block], ARENA);

    expect(penetrationDepth(carObb(out), boxObb(block))).toBe(0);
    expect(out.x + CAR_W / 2).toBeLessThanOrEqual(block.x + TOUCH_SLACK);
  });

  it("gives obstacles priority over other cars when a body is squeezed between the two", () => {
    // The same squeeze, but assert the concession lands on the car and not on the level: the body
    // may still touch `other`, and must not be inside `block`.
    const start = body({ x: 1650, y: 1210, angle: 0, speed: 0 });
    const other: Obb = { x: 1615, y: 1210, angle: 0, w: CAR_W, h: CAR_H };

    const out = resolveWorld(start, [other], [block], ARENA);
    expect(penetrationDepth(carObb(out), boxObb(block))).toBe(0);
  });
});

describe("resolveWorld - the leading bounds pass is load-bearing", () => {
  it("tests contacts against the pose the car can occupy, not the one it drove into the wall", () => {
    // Body is 10px past the right wall and clear of `other` where it stands. Clamping it back in
    // first brings it into contact along x. Without the leading pass the car-vs-car test runs on
    // the out-of-bounds pose, picks the y axis instead, and the body ends up displaced in y.
    const start = body({ x: BOUNDS.width + 10, y: 500, angle: 0, speed: 0 });
    const other: Obb = { x: BOUNDS.width, y: 500, angle: 0, w: CAR_W, h: CAR_H };

    const out = resolveWorld(start, [other], [], BOUNDS);

    expect(out.y).toBe(500);
    expect(out.x).toBe(952);
  });
});

describe("resolveWorld - one restitution per distinct surface", () => {
  const r = DRIVE_CONFIG.restitution;
  // Obstacle flush against the right wall: it spans x[940,1000] in a 1000-wide arena, so its right
  // face lies exactly ON the wall plane. A body can therefore be out of bounds AND inside the
  // obstacle at once, passing the leading bounds pass, the obstacle contact, and the trailing clamp
  // -- the three sites that used to each take a bite, yielding r^3.
  //
  // Note what the two contacts actually are: the wall at x=1000 facing inward (normal -x), then the
  // obstacle's right face at the same x=1000 facing outward (normal +x). That is one plane struck
  // from opposite sides, NOT two different surfaces. The r^2 result is still correct under the
  // "once per contact surface" rule -- these are two distinct contacts -- but nobody should read
  // this fixture as a car bouncing off two separate pieces of geometry.
  const hugging: Aabb = { x: 940, y: 400, w: 60, h: 200 };
  // Car spans [966,1014]: past the wall at 1000 and overlapping the obstacle at 940.
  const wedged = () => body({ x: 990, y: 500, angle: 0, speed: 100 });

  it("damps once per contact: wall then obstacle is r^2, never r^3", () => {
    const out = resolveWorld(wedged(), [], [hugging], BOUNDS);

    expect(out.speed).toBeCloseTo(100 * r ** 2, 6);
    // The trailing clamp must not take a third bite: that is the r^3 bug.
    expect(Math.abs(out.speed)).not.toBeCloseTo(100 * r ** 3, 3);
  });

  it("leaves the wedged body deeply embedded, and stably so -- the fixture's real outcome", () => {
    // Spelled out because the restitution assertion above hides it: there is nowhere legal for this
    // car to go. The obstacle fills the arena right up to the wall, so the boundary clamp (which
    // outranks obstacles) drags it back into geometry every tick.
    const out = resolveWorld(wedged(), [], [hugging], BOUNDS);

    expect(out.x).toBe(976);
    // 48px deep: the car's entire width, not a graze.
    expect(penetrationDepth(carObb(out), boxObb(hugging))).toBeCloseTo(CAR_W, 6);

    // And it is a fixed point -- position and speed both stick. Speed holds rather than decaying
    // because resolution applies no drag; only stepDrive does. Re-resolving cannot dig it out.
    let settled = out;
    for (let tick = 0; tick < 5; tick++) {
      settled = resolveWorld(settled, [], [hugging], BOUNDS);
      expect(settled.x).toBe(976);
      expect(settled.speed).toBeCloseTo(out.speed, 6);
    }
  });

  it("applies exactly one restitution for a lone wall contact", () => {
    const out = resolveWorld(body({ x: BOUNDS.width - 5, y: 500, angle: 0, speed: 100 }), [], [], BOUNDS);
    expect(out.speed).toBeCloseTo(-100 * r, 6);
  });

  it("applies exactly one restitution for a lone obstacle contact", () => {
    const clear: Aabb = { x: 600, y: 400, w: 100, h: 200 };
    const out = resolveWorld(body({ x: 580, y: 500, angle: 0, speed: 100 }), [], [clear], BOUNDS);
    expect(out.speed).toBeCloseTo(-100 * r, 6);
  });

  it("never lets the trailing clamp change speed on its own", () => {
    // Driven far out of bounds with no other contact: the leading pass bounces once and the
    // trailing clamp, reached with the body already inside, must be inert.
    const out = resolveWorld(body({ x: BOUNDS.width + 300, y: 500, angle: 0, speed: 100 }), [], [], BOUNDS);
    expect(out.speed).toBeCloseTo(-100 * r, 6);
  });
});

describe("resolveWorld - documented consequences of the locked velocity rule", () => {
  // These pin spec-mandated behaviour, not desirable behaviour. Changing them means changing the
  // plan's velocity rule; they exist so the next reader sees the edges rather than discovering them.

  it("flips the reported speed sign discontinuously at ~30.6 degrees off the surface normal", () => {
    const glance = (degrees: number): number => {
      const start = body({ x: BOUNDS.width - 5, y: 500, angle: (degrees * Math.PI) / 180, speed: 100 });
      return resolveWorld(start, [], [], BOUNDS).speed;
    };

    // The threshold is |dot(n, forward)| = 1 / sqrt(1 + restitution), i.e. ~30.609 degrees. Asserted
    // against where the sign actually flips rather than against acos of itself, so this pins the
    // formula to the behaviour: straddle the predicted angle and the reported speed must invert.
    const thresholdDegrees = (Math.acos(1 / Math.sqrt(1 + DRIVE_CONFIG.restitution)) * 180) / Math.PI;
    expect(glance(thresholdDegrees - 0.01)).toBeLessThan(0);
    expect(glance(thresholdDegrees + 0.01)).toBeGreaterThan(0);

    // Straddling it: the magnitude barely moves, but the sign inverts.
    expect(glance(30)).toBeCloseTo(-58.47, 2);
    expect(glance(32)).toBeCloseTo(60.74, 2);
    expect(Math.abs(Math.abs(glance(30)) - Math.abs(glance(32)))).toBeLessThan(3);
    expect(Math.sign(glance(30))).not.toBe(Math.sign(glance(32)));
  });

  it("grinds along a wall without ever redirecting, because angle is never changed", () => {
    const dt = 1 / 30;
    const angle = (70 * Math.PI) / 180;
    let car = body({ x: 990, y: 100, angle, speed: 100 });

    const wallX = BOUNDS.width - hullHalfExtents(angle).hx;
    const speeds: number[] = [];
    const xs: number[] = [];

    for (let tick = 0; tick < 8; tick++) {
      // Integrate the drive step inline rather than importing stepDrive: this test is about
      // resolution, and the motion it needs is one line.
      car = body({ ...car, x: car.x + Math.cos(angle) * car.speed * dt, y: car.y + Math.sin(angle) * car.speed * dt });
      car = resolveWorld(car, [], [], BOUNDS);
      speeds.push(car.speed);
      xs.push(car.x);
    }

    // Pinned to the wall, never deflected off it.
    for (const x of xs) expect(x).toBeCloseTo(wallX, 6);
    // Still nosing into the wall: speed stays forward, it is only bled down.
    for (const s of speeds) expect(s).toBeGreaterThan(0);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThan(speeds[i - 1]!);
    // It does slide along the wall in +y; it just never gets away from it.
    expect(car.y).toBeGreaterThan(100);
  });
});

describe("obbsOverlap", () => {
  const hull = (x: number, y: number, angle = 0): Obb => ({ x, y, angle, w: CAR_W, h: CAR_H });

  it("is true for two cars sitting on the same spot", () => {
    expect(obbsOverlap(hull(0, 0), hull(0, 0))).toBe(true);
  });

  it("is false for cars that are clear of each other", () => {
    expect(obbsOverlap(hull(0, 0), hull(CAR_W + 1, 0))).toBe(false);
  });

  it("is false for cars that are merely touching", () => {
    expect(obbsOverlap(hull(0, 0), hull(CAR_W, 0))).toBe(false);
  });

  it("is true just inside contact", () => {
    expect(obbsOverlap(hull(0, 0), hull(CAR_W - 1, 0))).toBe(true);
  });

  it("agrees with the resolver: a pair that overlaps is a pair the resolver pushes apart", () => {
    // Clear of the arena walls, so the only contact in play is the other car.
    const a = body({ x: 500, y: 500 });
    const b = hull(500 + CAR_W - 4, 500);
    expect(obbsOverlap(carObb(a), b)).toBe(true);
    expect(resolveWorld(a, [b], [], BOUNDS).x).toBeLessThan(a.x);
  });

  it("accounts for rotation: a turned car reaches further along the short axis", () => {
    expect(obbsOverlap(hull(0, 0), hull(0, CAR_H + 4))).toBe(false);
    expect(obbsOverlap(hull(0, 0), hull(0, CAR_H + 4, Math.PI / 2))).toBe(true);
  });
});

describe("pointInObb", () => {
  it("contains its own centre", () => {
    expect(pointInObb(10, 10, { x: 10, y: 10, angle: 0, w: CAR_W, h: CAR_H })).toBe(true);
  });

  it("excludes a point past the long half-axis", () => {
    expect(pointInObb(10 + CAR_W / 2 + 1, 10, { x: 10, y: 10, angle: 0, w: CAR_W, h: CAR_H })).toBe(
      false,
    );
  });

  it("includes a point exactly on the edge", () => {
    expect(pointInObb(10 + CAR_W / 2, 10, { x: 10, y: 10, angle: 0, w: CAR_W, h: CAR_H })).toBe(true);
  });

  it("rotates with the box", () => {
    const turned: Obb = { x: 0, y: 0, angle: Math.PI / 2, w: CAR_W, h: CAR_H };
    expect(pointInObb(0, CAR_W / 2 - 1, turned)).toBe(true);
    expect(pointInObb(CAR_W / 2 - 1, 0, turned)).toBe(false);
  });
});

describe("pointInAabb", () => {
  const box: Aabb = { x: 100, y: 200, w: 40, h: 20 };

  it("reads x,y as the top-left corner", () => {
    expect(pointInAabb(100, 200, box)).toBe(true);
    expect(pointInAabb(99, 200, box)).toBe(false);
  });

  it("includes the far corner and excludes just past it", () => {
    expect(pointInAabb(140, 220, box)).toBe(true);
    expect(pointInAabb(141, 220, box)).toBe(false);
    expect(pointInAabb(140, 221, box)).toBe(false);
  });
});
