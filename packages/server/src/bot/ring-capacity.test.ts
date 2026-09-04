import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../config/bot-profiles.js";
import { botRingCapacity } from "./view-ring.js";

describe("botRingCapacity", () => {
  it("covers the deepest staleness any tier asks for, plus one", () => {
    const deepest = Math.max(...Object.values(BOT_PROFILES).map((p) => p.viewStalenessTicks));
    expect(botRingCapacity()).toBe(deepest + 1);
  });

  it("is at least 2, so a ring is never degenerate", () => {
    expect(botRingCapacity()).toBeGreaterThanOrEqual(2);
  });
});
