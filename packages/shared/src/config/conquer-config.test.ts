import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { CONQUER_CONFIG, resolveConquerTicks } from "./conquer-config.js";
import { withDefaultMode } from "../modes/test-setup.js";
import { conquer, derived } from "../modes/active.js";

describe("CONQUER_CONFIG (CQ25)", () => {
  it("authors the brainstormed values", () => {
    expect(CONQUER_CONFIG).toStrictEqual({
      captureDelaySeconds: 5,
      controlTargetSeconds: 60,
      teamSize: 3,
      uniqueChassisPerTeam: true,
    });
    expect(Object.isFrozen(CONQUER_CONFIG)).toBe(true);
  });

  it("resolves whole ticks with Math.round", () => {
    expect(resolveConquerTicks(CONQUER_CONFIG)).toStrictEqual({
      captureDelay: Math.round(5 * TICK_RATE_HZ),
      controlTarget: Math.round(60 * TICK_RATE_HZ),
    });
    expect(resolveConquerTicks({ ...CONQUER_CONFIG, captureDelaySeconds: 0.51 }).captureDelay).toBe(
      Math.round(0.51 * TICK_RATE_HZ),
    );
  });

  it("is reachable through the active bundle", () => {
    withDefaultMode(() => {
      expect(conquer()).toStrictEqual(CONQUER_CONFIG);
      expect(derived().conquerTicks).toStrictEqual(resolveConquerTicks(CONQUER_CONFIG));
    });
  });
});
