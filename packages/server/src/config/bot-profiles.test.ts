import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, TICK_RATE_HZ, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { BOT_PROFILES, RESOLVED_BOT_PROFILES, BRAIN_CONSTANTS, BOT_BRAIN_VERSION, resolveBotProfile, resolveBrainConstants, type BotProfile } from "./bot-profiles.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const TIERS = ["easy", "medium", "hard"] as const;

/** What a field is supposed to do as the ladder is climbed, easy -> medium -> hard. */
type Direction = "rises" | "falls" | "equal" | "rises-or-equal";

/**
 * Every knob's intended direction up the ladder, named one by one.
 *
 * This exists because a tier is DATA (H8): no module under `bot/` branches on the difficulty name,
 * so the only thing keeping `easy` and `hard` apart is that their numbers differ in the right
 * direction. A single collapsed field is invisible to every other test in this suite: a bot that
 * suddenly aims like a pro on easy still passes "orders perceived latency" and still plays a whole
 * match.
 *
 * Typed as a TOTAL record over `BotProfile`, so adding a knob without deciding its direction is a
 * COMPILE error rather than a silently unguarded field. These are the 23 v7 fields (BB49).
 *
 * `punishHpFraction` is deliberately `"equal"` and must stay listed as such rather than dropped:
 * what counts as a wounded target is a fact about the game, not about the pilot.
 *
 * `vengefulness` runs BACKWARDS on purpose (H33): a casual chases whoever hurt them, a pro is not
 * distracted. That is why this is a direction table and not a "harder is bigger" loop.
 *
 * `"rises-or-equal"` is for a field that may hold flat on ONE rung but must still rise on the ends.
 * No v7 field uses it today; it stays so the next one does not need the test reshaped.
 */
const LADDER: Readonly<Record<keyof BotProfile, Direction>> = {
  // Perception
  viewStalenessTicks: "falls",
  reactionDelayTicks: "falls",
  recomputeTicks: "falls",
  acquireTicks: "falls",
  awarenessRadiusUnits: "rises",
  rearBlindHalfAngleRad: "falls",
  trackedThreatLimit: "rises",
  memoryTicks: "rises",
  stateEstimationSigma: "falls",
  // Aim
  aimErrorSigmaRad: "falls",
  aimErrorDriftTicks: "falls",
  // Fire
  burstGapTicks: "falls",
  hitChanceBar: "rises",
  // Targets
  targetCommitTicks: "falls",
  woundedBias: "rises",
  vengefulness: "falls",
  // Positioning
  wallLookaheadUnits: "rises",
  retreatHpFraction: "rises",
  punishHpFraction: "equal",
  opponentRangeRespect: "rises",
  // Reaction
  dodgeReactionTicks: "falls",
  dodgeHorizonTicks: "rises",
  situationCommitTicks: "falls",
};

const PROBABILITY_FIELDS = [
  "hitChanceBar", "punishHpFraction", "woundedBias", "vengefulness", "retreatHpFraction", "opponentRangeRespect",
] as const;

describe("BOT_PROFILES", () => {
  it("carries every tier", () => {
    for (const tier of TIERS) expect(RESOLVED_BOT_PROFILES[tier]).toBeDefined();
  });

  it("orders perceived latency easy > medium > hard", () => {
    const total = (t: (typeof TIERS)[number]) =>
      RESOLVED_BOT_PROFILES[t].viewStalenessTicks + RESOLVED_BOT_PROFILES[t].reactionDelayTicks;
    expect(total("easy")).toBeGreaterThan(total("medium"));
    expect(total("medium")).toBeGreaterThan(total("hard"));
  });

  it("gives every tier a non-zero view staleness and reaction delay (H48)", () => {
    for (const tier of TIERS) {
      expect(RESOLVED_BOT_PROFILES[tier].viewStalenessTicks).toBeGreaterThan(0);
      expect(RESOLVED_BOT_PROFILES[tier].reactionDelayTicks).toBeGreaterThan(0);
    }
  });

  it("runs vengefulness backwards up the ladder (H33)", () => {
    expect(RESOLVED_BOT_PROFILES.easy.vengefulness).toBeGreaterThan(RESOLVED_BOT_PROFILES.medium.vengefulness);
    expect(RESOLVED_BOT_PROFILES.medium.vengefulness).toBeGreaterThan(RESOLVED_BOT_PROFILES.hard.vengefulness);
  });

  it("keeps every probability in [0, 1]", () => {
    for (const tier of TIERS) {
      for (const key of PROBABILITY_FIELDS) {
        expect(RESOLVED_BOT_PROFILES[tier][key]).toBeGreaterThanOrEqual(0);
        expect(RESOLVED_BOT_PROFILES[tier][key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("moves every knob in its intended direction up the ladder, and no other", () => {
    // One assertion per field per rung. A collapsed field (easy given hard's aim error, say) fails
    // HERE, naming the field and the rung, rather than surviving until someone notices the tiers
    // play alike.
    for (const key of Object.keys(LADDER) as (keyof BotProfile)[]) {
      const [easy, medium, hard] = [
        RESOLVED_BOT_PROFILES.easy[key], RESOLVED_BOT_PROFILES.medium[key], RESOLVED_BOT_PROFILES.hard[key],
      ];
      const label = (from: string, to: string) => `${key}: ${from} -> ${to}`;
      switch (LADDER[key]) {
        case "rises":
          expect(medium, label("easy", "medium")).toBeGreaterThan(easy);
          expect(hard, label("medium", "hard")).toBeGreaterThan(medium);
          break;
        case "falls":
          expect(medium, label("easy", "medium")).toBeLessThan(easy);
          expect(hard, label("medium", "hard")).toBeLessThan(medium);
          break;
        case "equal":
          expect(medium, label("easy", "medium")).toBe(easy);
          expect(hard, label("medium", "hard")).toBe(medium);
          break;
        case "rises-or-equal":
          expect(medium, label("easy", "medium")).toBeGreaterThanOrEqual(easy);
          expect(hard, label("medium", "hard")).toBeGreaterThanOrEqual(medium);
          // Must still rise SOMEWHERE, or the direction is meaningless and the field is not a ladder.
          expect(hard, label("easy", "hard")).toBeGreaterThan(easy);
          break;
      }
    }
  });

  it("carries exactly the 23 v7 fields (BB49)", () => {
    expect(Object.keys(LADDER)).toHaveLength(23);
    for (const tier of TIERS) {
      expect(Object.keys(RESOLVED_BOT_PROFILES[tier]).sort()).toEqual(Object.keys(LADDER).sort());
    }
  });

  it("carries no coin flip (BB6)", () => {
    for (const tier of TIERS) {
      expect(Object.keys(RESOLVED_BOT_PROFILES[tier]).filter((k) => k.endsWith("Chance"))).toEqual([]);
    }
    expect(Object.keys(BRAIN_CONSTANTS)).not.toContain("planHorizonMs");
    expect(Object.keys(BRAIN_CONSTANTS)).not.toContain("ultFireSlots");
  });

  it("exposes the shared constants and a brain version", () => {
    expect(BRAIN_CONSTANTS.minEngageUnits).toBe(70);
    expect(BRAIN_CONSTANTS.contactTriggerUnits).toBe(150);
    expect(BRAIN_CONSTANTS.punishRangeFraction).toBe(0.5);
    expect(BRAIN_CONSTANTS.resetRangeMultiplier).toBe(1.15);
    expect(BOT_BRAIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exposes the v7 navigator and shooter constants (BB51)", () => {
    expect(BRAIN_CONSTANTS.comfortFraction).toBe(0.85);
    expect(BRAIN_CONSTANTS.rangeBandUnits).toBe(40);
    expect(BRAIN_CONSTANTS.steerDeadbandRad).toBe(0.06);
    expect(BRAIN_CONSTANTS.orbitOffsetRad).toBe(0.45);
    expect(BRAIN_CONSTANTS.dodgeDistanceUnits).toBe(120);
    expect(BRAIN_CONSTANTS.unpinDistanceUnits).toBe(180);
    expect(BRAIN_CONSTANTS.ramRangeUnits).toBe(400);
    expect(BRAIN_CONSTANTS.effectiveReachSamples).toBe(12);
    expect(resolveBrainConstants().soonReadyTicks).toBe(Math.round(TICK_RATE_HZ));
    expect(resolveBrainConstants().ramDryWindowTicks).toBe(Math.round(1.5 * TICK_RATE_HZ));
    expect(BOT_BRAIN_VERSION).toBe("7.0.0");
  });

  it("drops the 6.x constants (BB52)", () => {
    for (const gone of [
      "preferredRangePlateauFraction", "preferredRangeSampleCount", "preferredRangeMinStepUnits", "ultFireSlots",
      "personalityJitter", "assumedOpponentAimSigmaRad", "targetBranchMaxHeadingOffsetRad", "trajectorySampleCount",
      "commitWindowFraction", "minRolledHorizonMs",
    ]) {
      expect(Object.keys(BRAIN_CONSTANTS), gone).not.toContain(gone);
    }
    expect(Object.keys(resolveBrainConstants())).not.toContain("minRolledHorizonTicks");
  });
});

/** Today's table, in ticks at 30 Hz, copied verbatim before the ms conversion (NR14). */
const AT_30HZ = {
  easy: { viewStalenessTicks: 4, reactionDelayTicks: 9, recomputeTicks: 12, acquireTicks: 15, memoryTicks: 15, aimErrorDriftTicks: 20, burstGapTicks: 14, targetCommitTicks: 150, dodgeReactionTicks: 12, dodgeHorizonTicks: 12, situationCommitTicks: 20 },
  medium: { viewStalenessTicks: 3, reactionDelayTicks: 6, recomputeTicks: 6, acquireTicks: 9, memoryTicks: 45, aimErrorDriftTicks: 14, burstGapTicks: 7, targetCommitTicks: 60, dodgeReactionTicks: 8, dodgeHorizonTicks: 18, situationCommitTicks: 12 },
  hard: { viewStalenessTicks: 2, reactionDelayTicks: 4, recomputeTicks: 2, acquireTicks: 5, memoryTicks: 90, aimErrorDriftTicks: 9, burstGapTicks: 3, targetCommitTicks: 25, dodgeReactionTicks: 2, dodgeHorizonTicks: 24, situationCommitTicks: 6 },
} as const;

describe("bot timing is authored in ms (NR14)", () => {
  it.runIf(TICK_RATE_HZ === 30)("resolves to exactly today's ticks at 30 Hz", () => {
    for (const tier of TIERS) {
      expect(resolveBotProfile(BOT_PROFILES[tier])).toMatchObject(AT_30HZ[tier]);
    }
    expect(resolveBrainConstants().predictionHorizonTicks).toBe(90);
  });

  it("scales with the tick rate", () => {
    const hard = resolveBotProfile(BOT_PROFILES.hard);
    expect(hard.targetCommitTicks).toBe(Math.round((BOT_PROFILES.hard.targetCommitMs * TICK_RATE_HZ) / 1000));
  });

  it("leaves no *Ms key on the resolved profile", () => {
    expect(Object.keys(RESOLVED_BOT_PROFILES.hard).filter((k) => k.endsWith("Ms"))).toEqual([]);
  });
});
