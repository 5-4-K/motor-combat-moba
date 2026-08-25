import { describe, expect, it } from "vitest";
import { FULLSCREEN_KEY, isFullscreenToggle } from "./display.js";

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
