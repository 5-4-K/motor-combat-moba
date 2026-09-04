import { describe, expect, it } from "vitest";
import { BOT_PROFILES, BRAIN_CONSTANTS, BOT_BRAIN_VERSION } from "./bot-profiles.js";

const TIERS = ["easy", "medium", "hard"] as const;

describe("BOT_PROFILES", () => {
  it("carries every tier", () => {
    for (const tier of TIERS) expect(BOT_PROFILES[tier]).toBeDefined();
  });

  it("keeps aimToleranceRad below fireConeRad on every row", () => {
    for (const tier of TIERS) {
      const p = BOT_PROFILES[tier];
      expect(p.aimToleranceRad).toBeLessThan(p.fireConeRad);
    }
  });

  it("orders perceived latency easy > medium > hard", () => {
    const total = (t: (typeof TIERS)[number]) =>
      BOT_PROFILES[t].viewStalenessTicks + BOT_PROFILES[t].reactionDelayTicks;
    expect(total("easy")).toBeGreaterThan(total("medium"));
    expect(total("medium")).toBeGreaterThan(total("hard"));
  });

  it("gives every tier a non-zero view staleness and reaction delay (H48)", () => {
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].viewStalenessTicks).toBeGreaterThan(0);
      expect(BOT_PROFILES[tier].reactionDelayTicks).toBeGreaterThan(0);
    }
  });

  it("runs vengefulness backwards up the ladder (H33)", () => {
    expect(BOT_PROFILES.easy.vengefulness).toBeGreaterThan(BOT_PROFILES.medium.vengefulness);
    expect(BOT_PROFILES.medium.vengefulness).toBeGreaterThan(BOT_PROFILES.hard.vengefulness);
  });

  it("keeps every probability in [0, 1]", () => {
    const probabilities = [
      "fireDisciplineChance", "ultDisciplineChance", "ultWindowHpFraction", "woundedBias",
      "vengefulness", "standoffFraction", "deadbandFraction", "orbitBias", "retreatHpFraction",
      "ramIntentChance", "dodgeChance", "blunderChance", "idleFidgetChance", "leadFactor",
    ] as const;
    for (const tier of TIERS) {
      for (const key of probabilities) {
        expect(BOT_PROFILES[tier][key]).toBeGreaterThanOrEqual(0);
        expect(BOT_PROFILES[tier][key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("exposes the shared constants and a brain version", () => {
    expect(BRAIN_CONSTANTS.minEngageUnits).toBe(70);
    expect(BRAIN_CONSTANTS.contactTriggerUnits).toBe(150);
    expect(BRAIN_CONSTANTS.ultCooldownMs).toBe(5000);
    expect(BRAIN_CONSTANTS.personalityJitter).toBe(0.25);
    expect(BOT_BRAIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
