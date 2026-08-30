import { describe, expect, it } from "vitest";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../config/display.js";
import { OVERLAY_HEIGHT, OVERLAY_WIDTH } from "./overlay.js";

describe("overlay size", () => {
  /**
   * The overlay is mounted at its own centre, so any width narrower than the canvas pushes every
   * menu screen off-centre by half the difference. That is exactly what a second 1280 constant did
   * once the canvas grew a HUD gutter: join, lobby, car select, reveal and results all drifted
   * left, with a bare strip of the game's background down the right.
   */
  it("fills the whole canvas, so menus stay centred whatever the canvas is", () => {
    expect(OVERLAY_WIDTH).toBe(VIEW_WIDTH);
    expect(OVERLAY_HEIGHT).toBe(VIEW_HEIGHT);
  });
});
