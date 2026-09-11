import { describe, expect, it } from "vitest";
import { boundsOf, ARENA_01 } from "@motor-combat-moba/shared";
import { spikesAhead, wallAhead } from "./movement.js";

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
    // `carWidth`/`carHeight` is under 80 (it is 48 today, for a margin of 24). A chassis-size change
    // past that flips this case, and the failure would read as a look-ahead bug rather than as the
    // hitbox growing; move the box or the probe rather than the expectation if it ever does.
    expect(wallAhead({ x: 640, y: 360, angle: 0 }, withBox, 20)).toBe(false);
  });
});

const octagon = {
  width: ARENA_01.width,
  height: ARENA_01.height,
  obstacles: ARENA_01.obstacles,
  planes: boundsOf(ARENA_01).planes,
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
    // Driving left toward the left wall, inside the y-span of the strip at 105-200. x=210 (not the
    // rounder 200) so the look-ahead point (60) clears the strip's margin-inflated near edge (50)
    // with room to spare, rather than landing exactly on it — `200 - 150` lands on that edge to the
    // unit and would make this pass or fail on a coin-flip of floating-point rounding.
    expect(spikesAhead({ x: 210, y: 150, angle: Math.PI }, octagon, 150)).toBe(true);
  });

  it("does not fire for a bare stretch of the same wall", () => {
    // y = 260 sits in the gap between the strips at 105-200 and 305-415.
    expect(spikesAhead({ x: 200, y: 260, angle: Math.PI }, octagon, 150)).toBe(false);
  });

  it("does not fire in open floor", () => {
    expect(spikesAhead({ x: 640, y: 360, angle: 0 }, octagon, 150)).toBe(false);
  });

  it("ignores an ordinary obstacle that is not a spike", () => {
    // Every obstacle in `ARENA_01` happens to be `kind: "spike"`, so the three cases above cannot
    // by themselves tell a `kind`-aware implementation from one that fires on any nearby obstacle.
    // This is the same box and the same pose `wallAhead`'s own "fires on an obstacle" case uses
    // (above) — `wallAhead` DOES fire on it, because it does not care what an obstacle is. A
    // `spikesAhead` that (wrongly) matched on overlap alone, ignoring `box.kind`, would also fire
    // here; the real implementation must not.
    const withPlainBox = { width: 1280, height: 720, obstacles: [{ x: 700, y: 340, w: 60, h: 60 }] };
    expect(spikesAhead({ x: 640, y: 360, angle: 0 }, withPlainBox, 100)).toBe(false);
  });
});
