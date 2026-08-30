import { describe, expect, it } from "vitest";
import {
  ARENA_VIEW_WIDTH,
  FULLSCREEN_KEY,
  HUD_GUTTER_WIDTH,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  isFullscreenToggle,
} from "./display.js";

function key(k: string, extra: Partial<{ repeat: boolean; tag: string }> = {}) {
  return { key: k, repeat: extra.repeat ?? false, target: extra.tag ? { tagName: extra.tag } : null };
}

describe("isFullscreenToggle", () => {
  it("fires on the fullscreen key in either case", () => {
    expect(isFullscreenToggle(key(FULLSCREEN_KEY))).toBe(true);
    expect(isFullscreenToggle(key(FULLSCREEN_KEY.toUpperCase()))).toBe(true);
  });

  it("ignores other keys and held-key repeats", () => {
    expect(isFullscreenToggle(key("g"))).toBe(false);
    expect(isFullscreenToggle(key(FULLSCREEN_KEY, { repeat: true }))).toBe(false);
  });

  it("ignores the key while typing into a text field, so a name containing it does not toggle", () => {
    expect(isFullscreenToggle(key(FULLSCREEN_KEY, { tag: "INPUT" }))).toBe(false);
    expect(isFullscreenToggle(key(FULLSCREEN_KEY, { tag: "TEXTAREA" }))).toBe(false);
    expect(isFullscreenToggle(key(FULLSCREEN_KEY, { tag: "CANVAS" }))).toBe(true);
  });
});

describe("view size", () => {
  it("is the arena viewport plus the HUD gutter, so no HUD pixel sits over the floor", () => {
    expect(VIEW_WIDTH).toBe(ARENA_VIEW_WIDTH + HUD_GUTTER_WIDTH);
    expect(VIEW_HEIGHT).toBe(720);
  });

  it("keeps the arena viewport at the size ARENA_01 is authored to, so nobody loses play space", () => {
    expect(ARENA_VIEW_WIDTH).toBe(1280);
  });
});
