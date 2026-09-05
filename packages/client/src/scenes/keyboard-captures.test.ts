import { describe, expect, it, vi } from "vitest";
import { releaseKeyboardCaptures } from "./keyboard-captures.js";

describe("releaseKeyboardCaptures", () => {
  it("clears the game-wide captures", () => {
    const clearCaptures = vi.fn();
    releaseKeyboardCaptures({ clearCaptures });
    expect(clearCaptures).toHaveBeenCalledTimes(1);
  });

  it("tolerates a scene with no keyboard", () => {
    expect(() => releaseKeyboardCaptures(undefined)).not.toThrow();
    // `Scene.input.keyboard` is typed `| null`, not `| undefined`, so both have to be safe.
    expect(() => releaseKeyboardCaptures(null)).not.toThrow();
  });
});
