import { describe, expect, it } from "vitest";
import { ARENA_01, ARENA_03 } from "@motor-combat-moba/shared";
import { arenaColorsOf } from "../scenes/arena-visual.js";
import { cameraBackgroundOf, cameraBoundsOf } from "./bounds.js";

const VIEW = { width: 1280, height: 720 };

describe("cameraBoundsOf", () => {
  it("centres a 1600x880 arena in a 1280x720 view at zoom 0.8", () => {
    const b = cameraBoundsOf({ width: 1600, height: 880 }, VIEW, 0.8);
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(-10);
    expect(b.w).toBeCloseTo(1600);
    expect(b.h).toBeCloseTo(900);
  });

  it("keeps a view exactly the arena's width on the arena", () => {
    const b = cameraBoundsOf({ width: 1600, height: 880 }, VIEW, 0.8);
    expect(b.x).toBeCloseTo(0);
    expect(b.w).toBeCloseTo(1600);
  });

  it("leaves an arena larger than the view as the arena rect (arena-03)", () => {
    expect(cameraBoundsOf({ width: 1280, height: 2160 }, VIEW, 1)).toEqual({
      x: 0,
      y: 0,
      w: 1280,
      h: 2160,
    });
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
    expect(cameraBackgroundOf(ARENA_01, colors)).toBe(colors.border);
  });

  it("keeps the floor colour behind a non-tile arena", () => {
    const colors = arenaColorsOf(ARENA_03);
    expect(cameraBackgroundOf(ARENA_03, colors)).toBe(colors.floor);
  });
});
