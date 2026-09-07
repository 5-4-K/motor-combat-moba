import { describe, expect, it } from "vitest";
import { wallAhead } from "./movement.js";

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
    expect(wallAhead({ x: 640, y: 360, angle: 0 }, withBox, 20)).toBe(false);
  });
});
