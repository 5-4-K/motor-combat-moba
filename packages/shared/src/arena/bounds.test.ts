import { describe, expect, it } from "vitest";
import { boundsOf, playableExtentOf } from "./bounds.js";
import { ARENA_01 } from "./arena-01.js";
import { ARENA_02 } from "./arena-02.js";

describe("boundsOf", () => {
  it("gives an arena with no polygon no planes at all", () => {
    const bounds = boundsOf({ width: 800, height: 600 });
    expect(bounds).toEqual({ width: 800, height: 600 });
    expect(bounds.planes).toBeUndefined();
  });

  it("carries the width and height of a polygon arena unchanged", () => {
    const bounds = boundsOf(ARENA_01);
    expect(bounds.width).toBe(ARENA_01.width);
    expect(bounds.height).toBe(ARENA_01.height);
  });
});

describe("playableExtentOf", () => {
  it("measures the polygon, not the image frame", () => {
    // The octagon's own bounding box: x 74-1206, y 54-666. Deliberately NOT `width`/`height`, which
    // are the frame the art is drawn in and the camera's bounds.
    expect(playableExtentOf(ARENA_01)).toEqual({ width: 1132, height: 612 });
    expect(playableExtentOf(ARENA_01).width).not.toBe(ARENA_01.width);
  });

  it("measures arena-02's inset wall-face rect the same way", () => {
    expect(playableExtentOf(ARENA_02)).toEqual({ width: 1161, height: 607 });
    expect(playableExtentOf(ARENA_02).width).not.toBe(ARENA_02.width);
  });

  it("falls back to width and height for an arena with no boundary", () => {
    expect(playableExtentOf({ width: 800, height: 600 })).toEqual({
      width: 800,
      height: 600,
    });
  });
});
