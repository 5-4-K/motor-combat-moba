import { describe, expect, it } from "vitest";
import { SPECTATE_TARGET_MAX_LENGTH, isSpectateTargetMessage } from "./spectate-messages.js";

describe("isSpectateTargetMessage (wire shape only)", () => {
  it("accepts a string target, the empty one included", () => {
    expect(isSpectateTargetMessage({ target: "abc" })).toBe(true);
    expect(isSpectateTargetMessage({ target: "" })).toBe(true);
  });

  it("refuses anything else", () => {
    for (const bad of [null, undefined, "abc", 5, {}, { target: 5 }, { target: null }]) {
      expect(isSpectateTargetMessage(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isSpectateTargetMessage(Object.create({ target: "x" }))).toBe(false); // via prototype
    expect(isSpectateTargetMessage({ target: "x".repeat(SPECTATE_TARGET_MAX_LENGTH + 1) })).toBe(false);
  });
});
