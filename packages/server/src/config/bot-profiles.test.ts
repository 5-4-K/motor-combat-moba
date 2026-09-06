import { describe, expect, it } from "vitest";
import { makeRng } from "../bot/rng.js";
import { rollPersonality } from "../bot/brain/personality.js";
import { BOT_PROFILES, BRAIN_CONSTANTS, BOT_BRAIN_VERSION, type BotProfile } from "./bot-profiles.js";

const TIERS = ["easy", "medium", "hard"] as const;

/** What a field is supposed to do as the ladder is climbed, easy -> medium -> hard. */
type Direction = "rises" | "falls" | "equal" | "rises-or-equal";

/**
 * Every knob's intended direction up the ladder, named one by one.
 *
 * This exists because a tier is DATA (H8): no module under `bot/` branches on the difficulty name,
 * so the only thing keeping `easy` and `hard` apart is that their numbers differ in the right
 * direction. A single collapsed field is invisible to every other test in this suite — a bot that
 * suddenly aims like a pro on easy still passes "orders perceived latency", still passes the tier
 * characterisation scenes that do not happen to read that knob, and still plays a whole match.
 * The per-field monotonicity assertions that used to live in the deleted `bot/input.test.ts` were
 * the guard against exactly that, and the final review measured what replaced them: of the 25
 * single-field collapses it tried, 14 passed silently.
 *
 * Typed as a TOTAL record over `BotProfile`, so adding a knob without deciding its direction is a
 * COMPILE error rather than a silently unguarded field.
 *
 * Two fields are deliberately `"equal"` and must stay listed as such rather than dropped:
 *   - `ultWindowHpFraction` — what counts as a wounded target is a fact about the game, not about
 *     the pilot. Tiers differ in whether they WAIT for that window (`ultDisciplineChance`), not in
 *     where they think it is.
 *   - `blunderTicks` — how long a mistake lasts once made. Tiers differ in how OFTEN they blunder
 *     (`blunderChance`); a pro's mistake is not shorter, it is rarer.
 *
 * And one runs BACKWARDS on purpose: `vengefulness` (H33) — a casual chases whoever hurt them, a
 * pro is not distracted — which is why this is a direction table and not a "harder is bigger" loop.
 *
 * A fourth direction, `"rises-or-equal"`, exists for fields that may hold flat on ONE rung rather
 * than strictly rise on both: `targetBranches` (1, 1, 3) is flat easy -> medium and only rises
 * medium -> hard. Medium genuinely does not need a second target branch to play its role on the
 * ladder — inventing a value that rises on both rungs just to keep the table monotone-strict would
 * be tuning the field for this test, not for the bot. The direction still asserts SOMEWHERE, on the
 * ends (`hard > easy`), so a field that never moves at all still fails.
 *
 * `planDepth` used to share this direction too (1, 1, 2), until R-PF1 (fix round 1, 2026-09-06)
 * dropped hard back to 1 because the measured planning cost missed its budget by 3x — see
 * `planDepth`'s own doc comment in `bot-profiles.ts` for the numbers. It is `"equal"` now: all
 * three tiers ship depth 1, and the field keeps its `1 | 2` type and its depth-2 machinery for
 * whichever tier next earns the budget to raise it.
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
  aimToleranceRad: "falls",
  // Fire economy
  burstGapTicks: "falls",
  minShotValueFraction: "rises",
  ultDisciplineChance: "rises",
  ultWindowHpFraction: "equal",
  // Target politics
  targetCommitTicks: "falls",
  woundedBias: "rises",
  vengefulness: "falls",
  // Positioning and survival
  standoffFraction: "rises",
  deadbandFraction: "falls",
  wallLookaheadUnits: "rises",
  retreatHpFraction: "rises",
  ramIntentChance: "rises",
  // Threat reaction and consistency
  dodgeChance: "rises",
  dodgeReactionTicks: "falls",
  dodgeHorizonTicks: "rises",
  blunderChance: "falls",
  blunderTicks: "equal",
  idleFidgetChance: "falls",
  scoreNoiseSigma: "falls",
  hearChance: "rises",
  deadRespect: "rises",
  opponentRangeRespect: "rises",
  cornerRespect: "rises",
  incomingCarChance: "rises",
  situationCommitTicks: "falls",
  slotStickTicks: "rises",
  // Planning
  planHorizonTicks: "rises",
  planDepth: "equal",
  targetBranches: "rises-or-equal",
  commitPenalty: "rises",
};

const PROBABILITY_FIELDS = [
  "ultDisciplineChance", "ultWindowHpFraction", "woundedBias",
  "vengefulness", "standoffFraction", "deadbandFraction", "retreatHpFraction",
  "ramIntentChance", "dodgeChance", "blunderChance", "idleFidgetChance",
  "hearChance", "deadRespect", "opponentRangeRespect", "cornerRespect", "incomingCarChance",
  "commitPenalty",
] as const;

describe("BOT_PROFILES", () => {
  it("carries every tier", () => {
    for (const tier of TIERS) expect(BOT_PROFILES[tier]).toBeDefined();
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
    for (const tier of TIERS) {
      for (const key of PROBABILITY_FIELDS) {
        expect(BOT_PROFILES[tier][key]).toBeGreaterThanOrEqual(0);
        expect(BOT_PROFILES[tier][key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps every probability in [0, 1] on a ROLLED personality too, not just the table", () => {
    // The table is not what the brain runs — `rollPersonality` shifts up to four fields per bot and
    // clamps them into the tier's band, and a band is a bound on how FAR a value may move, not on
    // what it may become: a hard `opportunist` reached `ultDisciplineChance` 1.125 (0.9 x 1.25,
    // comfortably inside +-25%). It saturated harmlessly, but "keeps every probability in [0, 1]"
    // was then a claim about a table nothing reads. Sweeping seeds rather than picking one, because
    // which archetype a bot rolls is itself a draw and only two of the five shift a probability past
    // its tier value.
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 200; seed++) {
        const { profile } = rollPersonality(makeRng(seed), tier);
        for (const key of PROBABILITY_FIELDS) {
          expect(profile[key], `${tier} seed ${seed} ${key}`).toBeGreaterThanOrEqual(0);
          expect(profile[key], `${tier} seed ${seed} ${key}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("moves every knob in its intended direction up the ladder, and no other", () => {
    // One assertion per field per rung — the guard the deleted `bot/input.test.ts` used to carry.
    // A collapsed field (easy given hard's aim error, say) fails HERE, naming the field and the
    // rung, rather than surviving until someone notices the tiers play alike.
    for (const key of Object.keys(LADDER) as (keyof BotProfile)[]) {
      const [easy, medium, hard] = [
        BOT_PROFILES.easy[key], BOT_PROFILES.medium[key], BOT_PROFILES.hard[key],
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

  it("exposes the shared constants and a brain version", () => {
    expect(BRAIN_CONSTANTS.minEngageUnits).toBe(70);
    expect(BRAIN_CONSTANTS.contactTriggerUnits).toBe(150);
    expect(BRAIN_CONSTANTS.ultCooldownMs).toBe(5000);
    expect(BRAIN_CONSTANTS.personalityJitter).toBe(0.25);
    expect(BRAIN_CONSTANTS.assumedOpponentAimSigmaRad).toBe(0.06);
    expect(BRAIN_CONSTANTS.dangerEvadeFraction).toBe(1);
    expect(BRAIN_CONSTANTS.dangerEvadeCooldownTicks).toBe(120);
    expect(BOT_BRAIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
