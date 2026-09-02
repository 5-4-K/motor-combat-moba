import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { STATUS_CONFIG } from "./status-config.js";
import { DEATHMATCH_CONFIG, DEATHMATCH_TICKS } from "./deathmatch-config.js";

describe("DEATHMATCH_TICKS", () => {
  it("derives whole ticks from the authored seconds", () => {
    expect(DEATHMATCH_TICKS.match).toBe(180 * TICK_RATE_HZ);
    expect(DEATHMATCH_TICKS.respawnDelay).toBe(5 * TICK_RATE_HZ);
    expect(DEATHMATCH_TICKS.phase).toBe(45);
    expect(DEATHMATCH_TICKS.phaseMax).toBe(3 * TICK_RATE_HZ);
  });

  it("is frozen, so no caller can retune the match at runtime", () => {
    expect(Object.isFrozen(DEATHMATCH_TICKS)).toBe(true);
    expect(Object.isFrozen(DEATHMATCH_CONFIG)).toBe(true);
  });
});

describe("DEATHMATCH_CONFIG bounds", () => {
  it("gives the phase a cap strictly above its minimum, or extension is meaningless", () => {
    expect(DEATHMATCH_CONFIG.phaseMaxSeconds).toBeGreaterThan(DEATHMATCH_CONFIG.phaseSeconds);
  });

  it("keeps the phase inside the status system's own duration ceiling", () => {
    expect(DEATHMATCH_CONFIG.phaseMaxSeconds * 1000).toBeLessThanOrEqual(STATUS_CONFIG.maxDurationMs);
  });

  it("respawns players well inside the match, or the mode is last-standing wearing a clock", () => {
    expect(DEATHMATCH_CONFIG.respawnDelaySeconds).toBeLessThan(DEATHMATCH_CONFIG.matchSeconds / 10);
  });
});
