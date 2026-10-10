import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { SPIKE_CONFIG, SPIKE_TICKS } from "./spike-config.js";

describe("SPIKE_CONFIG", () => {
  it("converts its windows to whole ticks, rounded up so a window is never short", () => {
    expect(SPIKE_TICKS.retrigger).toBe(Math.ceil((SPIKE_CONFIG.retriggerMs / 1000) * TICK_RATE_HZ));
    expect(SPIKE_TICKS.shoverCredit).toBe(Math.ceil((SPIKE_CONFIG.shoverCreditMs / 1000) * TICK_RATE_HZ));
    expect(Number.isInteger(SPIKE_TICKS.retrigger)).toBe(true);
    expect(Number.isInteger(SPIKE_TICKS.shoverCredit)).toBe(true);
  });
});
