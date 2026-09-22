// Deliberately alone: no other file's setup installs a mode for this one, so a passing test here
// proves `withDefaultMode` itself does the installing — not a sibling's `beforeEach` leaking in.
import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, modeConfigOf } from "./registry.js";
import { cfg, hasMode } from "./active.js";
import { withDefaultMode } from "./test-setup.js";

describe("withDefaultMode", () => {
  it("installs DEFAULT_GAME_MODE's bundle for the callback's duration", () => {
    expect(hasMode()).toBe(false);
    withDefaultMode(() => {
      expect(cfg()).toBe(modeConfigOf(DEFAULT_GAME_MODE));
    });
  });

  it("restores the unscoped state afterward — cfg() throws again outside the callback", () => {
    withDefaultMode(() => {
      expect(hasMode()).toBe(true);
    });
    expect(hasMode()).toBe(false);
    expect(() => cfg()).toThrow(/outside a mode scope/);
  });

  it("returns the callback's value", () => {
    expect(withDefaultMode(() => 7)).toBe(7);
  });
});
