import { describe, expect, it } from "vitest";
import { BOT_PROFILES, BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import { rollPersonality } from "./personality.js";

describe("rollPersonality", () => {
  it("is deterministic for a seed", () => {
    expect(rollPersonality(makeRng(3), "hard").personality.id)
      .toBe(rollPersonality(makeRng(3), "hard").personality.id);
  });

  it("produces different archetypes across seeds", () => {
    const ids = new Set<string>();
    for (let seed = 0; seed < 60; seed++) ids.add(rollPersonality(makeRng(seed), "medium").personality.id);
    expect(ids.size).toBeGreaterThan(1);
  });

  it("never leaves the tier band (H47)", () => {
    const jitter = BRAIN_CONSTANTS.personalityJitter;
    for (let seed = 0; seed < 100; seed++) {
      const { profile } = rollPersonality(makeRng(seed), "hard");
      const base = BOT_PROFILES.hard;
      for (const key of ["standoffFraction", "minShotValue", "ramIntentChance", "vengefulness"] as const) {
        const low = base[key] * (1 - jitter);
        const high = base[key] * (1 + jitter);
        expect(profile[key]).toBeGreaterThanOrEqual(Math.min(low, high) - 1e-9);
        expect(profile[key]).toBeLessThanOrEqual(Math.max(low, high) + 1e-9);
      }
    }
  });

  it("never lets a hard bot become as undisciplined as a medium one (H47)", () => {
    for (let seed = 0; seed < 100; seed++) {
      const { profile } = rollPersonality(makeRng(seed), "hard");
      expect(profile.ultDisciplineChance).toBeGreaterThanOrEqual(BOT_PROFILES.medium.ultDisciplineChance);
    }
  });

  it("rolls one slot weight per possible slot", () => {
    const { personality } = rollPersonality(makeRng(1), "easy");
    expect(personality.slotWeights).toHaveLength(3);
    for (const weight of personality.slotWeights) {
      expect(weight).toBeGreaterThan(0);
    }
  });
});
