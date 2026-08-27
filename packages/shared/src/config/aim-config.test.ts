import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { AIM_CONFIG, AIM_TICKS } from "./aim-config.js";

describe("AIM_CONFIG", () => {
  it("keeps the cone a real forward cone", () => {
    // A9.1. At 90 degrees or more the cone stops meaning "in front of me": it would accept a target
    // exactly beside the car, and at 180 it accepts one directly behind.
    expect(AIM_CONFIG.coneDeg).toBeGreaterThan(0);
    expect(AIM_CONFIG.coneDeg).toBeLessThan(90);
  });

  it("keeps the lateral cap and lock range positive", () => {
    // A9.2. Either at zero collapses the acquisition region to nothing and aim assist silently
    // never fires, which looks exactly like the feature not being wired up.
    expect(AIM_CONFIG.lateralMax).toBeGreaterThan(0);
    expect(AIM_CONFIG.lockRange).toBeGreaterThan(0);
  });

  it("keeps every retention pad non-negative", () => {
    // A6. A negative pad would make retention TIGHTER than acquisition, so a target would be
    // dropped on the tick after it was acquired and the lock would strobe at the region edge.
    expect(AIM_CONFIG.retentionConeDeg).toBeGreaterThanOrEqual(0);
    expect(AIM_CONFIG.retentionLateralUnits).toBeGreaterThanOrEqual(0);
    expect(AIM_CONFIG.retentionRangeUnits).toBeGreaterThanOrEqual(0);
  });

  it("keeps the steal margin a real fraction", () => {
    // A7. At 0 any better score steals and the commit timer is the only friction; at 1 a candidate
    // would need a score of zero or less, which is unreachable, so nothing could ever steal.
    expect(AIM_CONFIG.stealMarginFraction).toBeGreaterThan(0);
    expect(AIM_CONFIG.stealMarginFraction).toBeLessThan(1);
  });

  it("scales the distance term to trade off against the angle term", () => {
    // A5. The two terms of the score must be comparable in magnitude across the lock range, or the
    // larger one decides every contest alone. At 0.4 per world unit (the figure that reads
    // naturally as "per metre", a unit this game does not have) a target at lockRange scores 160
    // against an angle term that maxes at coneDeg -- the angle becomes noise and the system
    // degenerates to "always nearest".
    const maxDistanceTerm = AIM_CONFIG.lockRange * AIM_CONFIG.scorePerDistanceUnit;
    expect(maxDistanceTerm).toBeGreaterThan(AIM_CONFIG.coneDeg / 4);
    expect(maxDistanceTerm).toBeLessThan(AIM_CONFIG.coneDeg * 4);
  });
});

describe("AIM_TICKS", () => {
  it("derives whole ticks from the authored milliseconds", () => {
    expect(AIM_TICKS.commit).toBe(Math.ceil((AIM_CONFIG.commitMs * TICK_RATE_HZ) / 1000));
    expect(AIM_TICKS.lockTimeout).toBe(Math.ceil((AIM_CONFIG.lockTimeoutMs * TICK_RATE_HZ) / 1000));
    expect(AIM_TICKS.losGrace).toBe(Math.ceil((AIM_CONFIG.losGraceMs * TICK_RATE_HZ) / 1000));
  });

  it("pins the derived counts at 30 Hz", () => {
    expect(TICK_RATE_HZ).toBe(30);
    expect(AIM_TICKS.commit).toBe(12);
    expect(AIM_TICKS.lockTimeout).toBe(24);
    expect(AIM_TICKS.losGrace).toBe(9);
  });

  it("gives the commit timer room to matter inside the engagement window", () => {
    // A7/A8 interact: if the commit window were as long as the engagement timeout, a lock could
    // never be stolen -- the timer would always lapse before the commit cleared, so every switch
    // would go through the no-margin path and the 25% margin would be dead config.
    expect(AIM_TICKS.commit).toBeLessThan(AIM_TICKS.lockTimeout);
  });
});
