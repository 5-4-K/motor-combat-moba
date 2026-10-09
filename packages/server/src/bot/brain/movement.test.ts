import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { ARENA_01 } from "@motor-combat-moba/shared";
import { legacyOctagonView } from "./legacy-octagon.fixture.js";
import { inCorner, spikesAhead, wallAhead, wallPush } from "./movement.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const arena = { width: 1280, height: 720, obstacles: [] };

/**
 * These three cases are the old `wallDesire` describe, re-pointed at `wallAhead` rather than
 * deleted with the rest of the desire model (P6). `wallDesire` was never anything but this
 * predicate wearing a heading, and `controller.ts` still reads the predicate for `pinned` — so the
 * scenes that pinned it are exactly the scenes that pin `unpin`'s trigger (R-O2).
 */
describe("wallAhead", () => {
  it("is silent in open floor", () => {
    expect(wallAhead({ x: 640, y: 360, angle: 0 }, arena, 150)).toBe(false);
  });

  it("fires on a wall the car is driving at", () => {
    expect(wallAhead({ x: 1200, y: 360, angle: 0 }, arena, 150)).toBe(true);
  });

  it("sees less of the wall with a shorter look-ahead", () => {
    expect(wallAhead({ x: 1180, y: 360, angle: 0 }, arena, 40)).toBe(false);
    expect(wallAhead({ x: 1180, y: 360, angle: 0 }, arena, 150)).toBe(true);
  });

  it("ignores a wall the nose is pointed away from", () => {
    // The reason it is not a bound test on the current position: the car is 80 units off the right
    // wall either way, and only one of these two is pinned.
    expect(wallAhead({ x: 1200, y: 360, angle: Math.PI }, arena, 150)).toBe(false);
    expect(wallAhead({ x: 1200, y: 360, angle: 0 }, arena, 150)).toBe(true);
  });

  it("fires on an obstacle inside the look-ahead", () => {
    const withBox = { width: 1280, height: 720, obstacles: [{ x: 700, y: 340, w: 60, h: 60 }] };
    expect(wallAhead({ x: 640, y: 360, angle: 0 }, withBox, 100)).toBe(true);
    // The `false` half depends on a CHASSIS BOUND, not only on the look-ahead: `wallAhead` inflates
    // the box by `max(carWidth, carHeight) / 2`, so the probe at x=660 misses the box's 700 edge
    // only while that margin stays under 40 units — i.e. while the larger of `DRIVE_CONFIG`'s
    // `carWidth`/`carHeight` is under 80 (it is 60 today, for a margin of 30). A chassis-size change
    // past that flips this case, and the failure would read as a look-ahead bug rather than as the
    // hitbox growing; move the box or the probe rather than the expectation if it ever does.
    expect(wallAhead({ x: 640, y: 360, angle: 0 }, withBox, 20)).toBe(false);
  });
});

// The legacy octagon with NO obstacles: the chamfer case below must be caught by the PLANES alone.
const octagon = legacyOctagonView();
// The shipped arena-01 (tile arena: wall obstacles and spike strips, no boundary polygon).
const tileArena = {
  width: ARENA_01.width,
  height: ARENA_01.height,
  obstacles: ARENA_01.obstacles,
};

describe("wallAhead on a polygon arena", () => {
  it("sees a chamfer, which a rectangle test cannot", () => {
    // (90, 70), nose pointed at (95, 70), sits in the top-left corner cut by the chamfer between
    // (74, 104) and (124, 54) — inside the rect on both axes, and close enough to that plane to
    // register within `wallAhead`'s margin. Deliberately clear of BOTH the TOP spike strip (its
    // nearest span starts at x=129, plus the car's own margin) and the LEFT one (its nearest span
    // starts at y=105): the point (110, 80) that a naive reading of the corner might reach for
    // instead sits inside the TOP strip's margin-inflated box, so it registers a wall EVEN on the
    // unfixed rectangle-and-obstacles code — it would not catch a regression back to comparing only
    // `arena.width`/`height`. This one only registers once `wallAhead` walks `arena.planes`.
    expect(wallAhead({ x: 90, y: 70, angle: 0 }, octagon, 5)).toBe(true);
  });

  it("still calls the middle of the arena clear", () => {
    expect(wallAhead({ x: 640, y: 360, angle: 0 }, octagon, 150)).toBe(false);
  });
});

describe("spikesAhead", () => {
  it("fires for a car approaching a strip", () => {
    // Driving left toward the left wall, inside the y-span of the strip at 120-200. The strip spans
    // x 0-40 and is inflated by the 30 u hull margin, so the look-ahead point (210 - 150 = 60) sits
    // 10 u inside its near edge (70) rather than on it.
    expect(spikesAhead({ x: 210, y: 150, angle: Math.PI }, tileArena, 150)).toBe(true);
  });

  it("does not fire for a bare stretch of the same wall", () => {
    // y = 260 sits in the gap between the strips at 120-200 and 320-400, on a plain wall tile.
    expect(spikesAhead({ x: 200, y: 260, angle: Math.PI }, tileArena, 150)).toBe(false);
  });

  it("does not fire in open floor", () => {
    expect(spikesAhead({ x: 640, y: 360, angle: 0 }, tileArena, 150)).toBe(false);
  });

  it("ignores an ordinary obstacle that is not a spike", () => {
    // The y = 260 case above already drives at a plain wall tile, but this one isolates the
    // question: an obstacle that is not a spike, with no spike anywhere near it, so it tells a
    // `kind`-aware implementation from one that fires on any nearby obstacle.
    // This is the same box and the same pose `wallAhead`'s own "fires on an obstacle" case uses
    // (above) — `wallAhead` DOES fire on it, because it does not care what an obstacle is. A
    // `spikesAhead` that (wrongly) matched on overlap alone, ignoring `box.kind`, would also fire
    // here; the real implementation must not.
    const withPlainBox = { width: 1280, height: 720, obstacles: [{ x: 700, y: 340, w: 60, h: 60 }] };
    expect(spikesAhead({ x: 640, y: 360, angle: 0 }, withPlainBox, 100)).toBe(false);
  });
});

describe("spikesAhead on one-sided spikes (TC40)", () => {
  // y grows downward: a car with larger y is on the box's "s" face.
  const box = { x: 500, y: 300, w: 100, h: 20, kind: "spike" as const };
  const viewOf = (damageFaces?: readonly ("n" | "e" | "s" | "w")[]) => ({
    width: 1280,
    height: 720,
    obstacles: [damageFaces === undefined ? box : { ...box, damageFaces }],
  });
  const south = { x: 550, y: 400, angle: -Math.PI / 2 }; // south of the box, facing north
  const north = { x: 550, y: 200, angle: Math.PI / 2 }; // north of the box, facing south

  it("fires from the damaging face", () => {
    expect(spikesAhead(south, viewOf(["s"]), 100)).toBe(true);
  });

  it("ignores the safe face", () => {
    expect(spikesAhead(north, viewOf(["s"]), 100)).toBe(false);
  });

  it("fires from every face when damageFaces is absent", () => {
    expect(spikesAhead(south, viewOf(), 100)).toBe(true);
    expect(spikesAhead(north, viewOf(), 100)).toBe(true);
  });
});

describe("wallPush (BB31)", () => {
  const rect = { width: 1280, height: 720, obstacles: [] as const };

  it("is undefined on open floor", () => {
    expect(wallPush({ x: 640, y: 360, angle: 0 }, rect, 150)).toBeUndefined();
  });

  it("points away from a wall the look-ahead point is inside", () => {
    // Facing +x, 100 u from the right wall, 150 u look-ahead: the ahead point is past x = 1280.
    const push = wallPush({ x: 1180, y: 360, angle: 0 }, rect, 150);
    expect(push).toBeDefined();
    expect(push!.x).toBeLessThan(0);
    expect(Math.abs(push!.y)).toBeLessThan(1e-9);
  });

  it("sums two normals in a corner even with the nose pointed at open floor", () => {
    // 50 u from both the left and top walls (inside minEngageUnits of each), facing +x along the
    // top wall: the look-ahead point is clear, the corner is not.
    const push = wallPush({ x: 50, y: 50, angle: 0 }, rect, 40);
    expect(push).toBeDefined();
    expect(push!.x).toBeGreaterThan(0);
    expect(push!.y).toBeGreaterThan(0);
  });

  it("ignores a one-sided spike's safe face", () => {
    const arena = {
      width: 1280, height: 720,
      obstacles: [{ x: 600, y: 300, w: 40, h: 120, kind: "spike" as const, damageFaces: ["e"] as const }],
    };
    // Approaching the west (safe) face head-on.
    expect(wallPush({ x: 540, y: 360, angle: 0 }, arena, 40)).toBeUndefined();
    // Approaching the east (damaging) face head-on.
    const push = wallPush({ x: 700, y: 360, angle: Math.PI }, arena, 40);
    expect(push).toBeDefined();
    expect(push!.x).toBeGreaterThan(0);
    expect(Math.abs(push!.y)).toBeLessThan(1e-9);
  });

  it("keeps a hit that cancels: two symmetric strips flanking the look-ahead point", () => {
    // Car at (640, 360) facing +x; one strip above (y 300-340), one below (y 380-420), both spanning
    // x 600-700, so their outward unit vectors are (0, +1) and (0, -1) and sum to zero.
    const arena = {
      width: 1280, height: 720,
      obstacles: [
        { x: 600, y: 300, w: 100, h: 40, kind: "spike" as const },
        { x: 600, y: 380, w: 100, h: 40, kind: "spike" as const },
      ],
    };
    const self = { x: 640, y: 360, angle: 0 };
    expect(spikesAhead(self, arena, 40)).toBe(true);
    const push = wallPush(self, arena, 40);
    expect(push).toBeDefined();
    // No net direction, so the fallback: a unit push opposite the heading.
    expect(push!.x).toBeCloseTo(-1, 9);
    expect(Math.abs(push!.y)).toBeLessThan(1e-9);
  });

  it("is defined for a car at the exact centre of a spike box", () => {
    const arena = {
      width: 1280, height: 720,
      obstacles: [{ x: 600, y: 340, w: 80, h: 40, kind: "spike" as const }],
    };
    const self = { x: 640, y: 360, angle: 0 };
    expect(spikesAhead(self, arena, 20)).toBe(true);
    expect(wallPush(self, arena, 20)).toBeDefined();
  });

  it("weights a long wall like a short one: every obstacle push is a unit vector", () => {
    // A 1000-wide wall (x 100-1100, y 0-40); the car sits at (900, 80), 40 u below its face
    // (y grows downward), with the nose toward the wall so the look-ahead point (900, 40) is inside
    // it. The nearest wall point is straight above, so the push is straight down the screen
    // (0, +1), not the mostly-horizontal car-minus-box-centre vector (400, 60).
    const arena = {
      width: 1280, height: 720,
      obstacles: [{ x: 100, y: 0, w: 1000, h: 40 }],
    };
    const push = wallPush({ x: 900, y: 80, angle: -Math.PI / 2 }, arena, 40);
    expect(push).toBeDefined();
    expect(push!.x).toBeCloseTo(0, 9);
    expect(push!.y).toBeCloseTo(1, 9);
  });

  it("sees a thin strip at the plain look-ahead that the longer sample overshoots", () => {
    // Strip x 330-340 (inflated 300-370). Car at (300, 360) facing +x, look-ahead 40: the 1x point
    // (340, 360) is inside it, the 2x point (380, 360) is past it.
    const arena = {
      width: 1280, height: 720,
      obstacles: [{ x: 330, y: 300, w: 10, h: 120, kind: "spike" as const }],
    };
    const self = { x: 300, y: 360, angle: 0 };
    expect(spikesAhead(self, arena, 80)).toBe(false);
    const push = wallPush(self, arena, 40);
    expect(push).toBeDefined();
    expect(push!.x).toBeLessThan(0);
  });

  it("inCorner moved here keeps its meaning", () => {
    expect(inCorner({ x: 50, y: 50 }, rect)).toBe(true);
    expect(inCorner({ x: 640, y: 50 }, rect)).toBe(false);
  });
});
