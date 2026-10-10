import { describe, expect, it } from "vitest";
import { ARENA_01, ARENA_03, type ArenaDef } from "@motor-combat-moba/shared";
import { arenaColorsOf } from "../scenes/arena-visual.js";
import { cameraBackgroundOf, cameraBoundsOf } from "./bounds.js";

const VIEW = { width: 1280, height: 720 };

/**
 * No shipped arena is a non-tile arena any more (arena-03 became one in CT1–CT6), but the scene still
 * draws one — a hand-written arena — so the rule is pinned on a one-screen-wide, two-screen-tall
 * rectangle without a tile grid.
 */
const HAND_WRITTEN: ArenaDef = { ...ARENA_03, tiles: undefined, width: 1280, height: 2160 };

describe("cameraBoundsOf", () => {
  it("centres a 1600x880 arena in a 1280x720 view at zoom 0.8", () => {
    const b = cameraBoundsOf({ width: 1600, height: 880 }, VIEW, 0.8);
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(-10);
    expect(b.w).toBeCloseTo(1600);
    expect(b.h).toBeCloseTo(900);
  });

  it("leaves an arena larger than the view as the arena rect (arena-03 at Conquer's zoom 1)", () => {
    expect(cameraBoundsOf(ARENA_03, VIEW, 1)).toEqual({
      x: 0,
      y: 0,
      w: ARENA_03.width,
      h: ARENA_03.height,
    });
  });

  it("keeps an axis the arena exactly fills on the arena and centres the other", () => {
    const b = cameraBoundsOf({ width: 1280, height: 600 }, VIEW, 1);
    expect(b.x).toBeCloseTo(0);
    expect(b.w).toBeCloseTo(1280);
    expect(b.y).toBeCloseTo(-60);
    expect(b.h).toBeCloseTo(720);
  });

  it("centres both axes when the arena is smaller on both", () => {
    const b = cameraBoundsOf({ width: 1280, height: 720 }, VIEW, 0.8);
    expect(b.x).toBeCloseTo(-160);
    expect(b.y).toBeCloseTo(-90);
    expect(b.w).toBeCloseTo(1600);
    expect(b.h).toBeCloseTo(900);
  });
});

describe("cameraBackgroundOf", () => {
  it("paints the border colour behind a tile arena", () => {
    const colors = arenaColorsOf(ARENA_01);
    const bounds = cameraBoundsOf(ARENA_01, VIEW, 0.8);
    expect(cameraBackgroundOf(ARENA_01, colors, bounds)).toBe(colors.border);
  });

  it("paints the border colour behind a non-tile arena smaller than the view", () => {
    const colors = arenaColorsOf(HAND_WRITTEN);
    const bounds = cameraBoundsOf(HAND_WRITTEN, VIEW, 0.8);
    expect(cameraBackgroundOf(HAND_WRITTEN, colors, bounds)).toBe(colors.border);
  });

  it("keeps the floor colour behind a non-tile arena the view does not overhang", () => {
    const colors = arenaColorsOf(HAND_WRITTEN);
    const bounds = cameraBoundsOf(HAND_WRITTEN, VIEW, 1);
    expect(cameraBackgroundOf(HAND_WRITTEN, colors, bounds)).toBe(colors.floor);
  });
});
