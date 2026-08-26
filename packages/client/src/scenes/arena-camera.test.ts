import { describe, expect, it } from "vitest";
import { ARENA_01, CAMERA_CONFIG } from "@motor-combat-moba/shared";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../config/display.js";
import { fitsViewport, viewportWorldSize } from "./arena-camera.js";

const VIEW = { width: 1280, height: 720 };

describe("viewportWorldSize", () => {
  it("is the viewport itself at zoom 1", () => {
    expect(viewportWorldSize(VIEW, 1)).toEqual(VIEW);
  });

  it("covers more world as the camera zooms out", () => {
    expect(viewportWorldSize(VIEW, 0.5)).toEqual({ width: 2560, height: 1440 });
  });

  it("covers less world as the camera zooms in", () => {
    expect(viewportWorldSize(VIEW, 2)).toEqual({ width: 640, height: 360 });
  });
});

describe("fitsViewport", () => {
  it("fits an arena exactly the size of the view", () => {
    expect(fitsViewport(VIEW, VIEW, 1)).toBe(true);
  });

  it("does not fit an arena wider than the view", () => {
    expect(fitsViewport({ width: 1281, height: 720 }, VIEW, 1)).toBe(false);
  });

  it("does not fit an arena taller than the view", () => {
    expect(fitsViewport({ width: 1280, height: 721 }, VIEW, 1)).toBe(false);
  });

  it("fits a larger arena once the camera zooms out far enough", () => {
    const arena = { width: 2560, height: 1440 };
    expect(fitsViewport(arena, VIEW, 1)).toBe(false);
    expect(fitsViewport(arena, VIEW, 0.5)).toBe(true);
  });

  /**
   * The assertion that pins the whole design: the arena the game ships is on screen in its
   * entirety. If someone rescales `ARENA_01` or changes `CAMERA_CONFIG.zoom` without changing the
   * other to match, this is what tells them — not a player discovering the edge of the world.
   */
  it("shows the shipped arena in full at the shipped zoom", () => {
    expect(fitsViewport(ARENA_01, { width: VIEW_WIDTH, height: VIEW_HEIGHT }, CAMERA_CONFIG.zoom)).toBe(true);
  });
});
