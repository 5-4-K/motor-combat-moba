import { afterEach, describe, expect, it } from "vitest";
import { setShowHitboxes, showHitboxes } from "./view-options.js";

/**
 * The module is a process-wide singleton, which is the point of it — so every test here has to put
 * it back, exactly as `PlaygroundScene.onShutdown` does for the real thing.
 */
afterEach(() => setShowHitboxes(false));

describe("view options", () => {
  it("starts off, which is what ordinary play must see", () => {
    // The playground is stripped from release builds, so nothing in a shipped game can ever call
    // the setter. This default IS the shipped behaviour.
    expect(showHitboxes()).toBe(false);
  });

  it("holds what it is set to", () => {
    setShowHitboxes(true);
    expect(showHitboxes()).toBe(true);
    setShowHitboxes(false);
    expect(showHitboxes()).toBe(false);
  });
});
