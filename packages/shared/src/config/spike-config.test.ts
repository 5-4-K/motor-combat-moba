import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { SPIKE_CONFIG, SPIKE_TICKS } from "./spike-config.js";

describe("SPIKE_CONFIG", () => {
  it("hurts less than the biggest weapon hit and more than the smallest", () => {
    expect(SPIKE_CONFIG.damage).toBe(80);
  });

  it("states the notch depth the arena geometry is authored against", () => {
    expect(SPIKE_CONFIG.depth).toBe(20);
  });

  it("converts its windows to whole ticks, rounded up so a window is never short", () => {
    expect(SPIKE_TICKS.retrigger).toBe(Math.ceil((SPIKE_CONFIG.retriggerMs / 1000) * TICK_RATE_HZ));
    expect(SPIKE_TICKS.shoverCredit).toBe(Math.ceil((SPIKE_CONFIG.shoverCreditMs / 1000) * TICK_RATE_HZ));
    expect(Number.isInteger(SPIKE_TICKS.retrigger)).toBe(true);
    expect(Number.isInteger(SPIKE_TICKS.shoverCredit)).toBe(true);
  });
});
