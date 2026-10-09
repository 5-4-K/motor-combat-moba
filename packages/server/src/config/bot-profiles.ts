import { TICK_RATE_HZ, type BotDifficulty } from "@motor-combat-moba/shared";

/**
 * One difficulty's knobs (H44, BB49). Twenty-three of them, grouped: perception, aim, fire,
 * targets, positioning, reaction. The v7 brain is deterministic, so there is no coin flip here:
 * a tier differs from another by how late it sees, how well it aims, and how much it will spend a
 * shot on, never by a probability of doing the right thing.
 *
 * Every field is a NUMBER, and no code outside this file branches on which tier it came from (H8).
 * That is the whole mechanism by which the tiers stay distinct as the brain grows: a behaviour is
 * code, a tier is data.
 */
export interface BotProfile {
  // --- Perception ---------------------------------------------------------------------------
  /** The world other cars are drawn from is this many ticks old: snapshot interval plus ping. */
  readonly viewStalenessTicks: number;
  /** The gap between seeing and the hands moving. With staleness this is the perceived latency. */
  readonly reactionDelayTicks: number;
  /** How often the bot re-decides. A refresh rate, NOT a reaction time (renamed from
   * `reactionTicks`, which read as one). */
  readonly recomputeTicks: number;
  /** How long a newly-seen car takes to register at all — TF2's recognition time. */
  readonly acquireTicks: number;
  /** Nothing beyond this radius is noticed. Doubles as the maximum engagement range (H35). */
  readonly awarenessRadiusUnits: number;
  /** Half-width of the arc behind the car the bot does not watch. 0 means full awareness. */
  readonly rearBlindHalfAngleRad: number;
  /** How many incoming shots can be tracked at once. */
  readonly trackedThreatLimit: number;
  /** How long something out of sight is remembered before it is forgotten. */
  readonly memoryTicks: number;
  /**
   * How wrong this bot's read of an opponent's speed and turn rate is, as a fraction (P20).
   *
   * Reading exact `speed` off a car every tick is the one place a bot sees more precisely than a
   * person, who eyeballs it. This is the answer to that, and it is a knob rather than a fixed
   * penalty because how well you read a car IS a skill.
   */
  readonly stateEstimationSigma: number;

  // --- Aim ----------------------------------------------------------------------------------
  /** Standard deviation of the aim error, in radians. */
  readonly aimErrorSigmaRad: number;
  /** How often the aim error is resampled. Long enough that error DRIFTS rather than jitters. */
  readonly aimErrorDriftTicks: number;

  // --- Fire ---------------------------------------------------------------------------------
  /** Minimum ticks between presses. The sim accepts one press per tick regardless. */
  readonly burstGapTicks: number;
  /**
   * Minimum solved hit chance a press must clear (BB38). `solve()`'s `hitChance` is a sum of the
   * five quadrature node weights (0.457 centre, 0.240 at ±1.15σ, 0.031 at ±2.37σ), so the bar is a
   * statement about which nodes must land: (0.06, 0.457] the exact aim; (0.457, 0.697] one 1.15σ
   * error as well; (0.697, 0.937] both (BB50).
   */
  readonly hitChanceBar: number;

  // --- Targets ------------------------------------------------------------------------------
  /** How long the bot stays on one target before switching is cheap. */
  readonly targetCommitTicks: number;
  /** Weight on (1 - hp fraction) when choosing a target — Quake's EASY_FRAGGER. */
  readonly woundedBias: number;
  /** Weight on "this car was shooting at me". Runs BACKWARDS up the ladder (H33). */
  readonly vengefulness: number;

  // --- Positioning --------------------------------------------------------------------------
  /** How far ahead the bot looks for a wall or obstacle. */
  readonly wallLookaheadUnits: number;
  /** Hp fraction below which the bot disengages. 0 means it fights to zero. */
  readonly retreatHpFraction: number;
  /** Target HP fraction at or below which `punish` applies (BB15). */
  readonly punishHpFraction: number;
  /** How hard to stay outside the opponent's shortest gun (S11). */
  readonly opponentRangeRespect: number;

  // --- Reaction -----------------------------------------------------------------------------
  /** Extra ticks between noticing an incoming shot and moving. */
  readonly dodgeReactionTicks: number;
  /** How far ahead a shot's path is projected when deciding whether it threatens. */
  readonly dodgeHorizonTicks: number;
  /** How long a situation is held before a same-or-lower priority may replace it (S8). */
  readonly situationCommitTicks: number;
}

/**
 * Constants shared by every tier — not per-tier, and therefore deliberately not in the profile.
 */
export const BRAIN_CONSTANTS = Object.freeze({
  /** Fraction of the shortest ready gun's effective reach a bot stands at (BB43). */
  comfortFraction: 0.85,
  /** Half-width of the band around a goal range inside which the pedal is lifted (BB25, BB45). */
  rangeBandUnits: 40,
  /** Steering latch: start steering beyond this error, stop inside half of it (BB28). */
  steerDeadbandRad: 0.06,
  /**
   * How far off its nose an orbiting bot holds the target while inside the range band (BB24).
   * `maxSwingDeg` 60 is the TOTAL turret arc, so the reachable half-arc is ±0.524 rad; 0.45 leaves
   * a 4° margin.
   */
  orbitOffsetRad: 0.45,
  /** How far a dodge goal is projected off the shot's line (BB23). */
  dodgeDistanceUnits: 120,
  /** How far an unpin goal is projected along the wall push (BB23). */
  unpinDistanceUnits: 180,
  /** A slot ready within this counts as "ready soon" for comfort and close ranges (BB43). */
  soonReadyMs: 1000,
  /** The kit is dry when no slot is ready within this; a dry kit may ram (BB21). */
  ramDryWindowMs: 1500,
  /** A dry kit rams only inside this distance (BB15). */
  ramRangeUnits: 400,
  /** Sweep resolution of `effectiveReachOf` (BB42). */
  effectiveReachSamples: 12,
  /**
   * Closest range the bot will ever choose to hold. A shade over one car length (60 u since the
   * 2026-09-16 hull resize; one and a half of the old 48 u). It floors `punish`'s and `reset`'s
   * ranges, the comfort range in `ranges.ts`, and sets the corner margin and waypoint arrival radius.
   *
   * It relies on EVERY tier's `awarenessRadiusUnits` exceeding it — easy 600, medium 700, hard 900
   * against 70, three orders of margin — so a range capped at the awareness radius can never fall
   * below this floor.
   */
  minEngageUnits: 70,
  /** Range at which a `range: 0` weapon (`wildcharge`) is worth pressing. */
  contactTriggerUnits: 150,
  /**
   * Rounds of fixed-point iteration `interceptTicks` (`predict.ts`) runs to converge "how many ticks
   * ahead should I aim" against a curving `PosePredictor`. Three rounds is the physics analogue of
   * the textbook closed-form straight-line intercept, which solves the same problem in one shot
   * against constant velocity — a curving path has no closed form, so this converges it. Fixed rather
   * than looped to a tolerance because the solver may draw no `rng()` calls and must terminate in
   * bounded, predictable work every tick (H21).
   */
  interceptFixedPointRounds: 3,
  /**
   * How far ahead a firing solution rolls a target (`predict.ts`'s `physicsPredictor` and
   * `selfPredictor`). Not per-tier: this is how far a SHOT flies, not how far a bot thinks.
   *
   * VERIFIED against `weapons()` and `weaponTicksOf` (2026-09-06, task 4): the longest flight on
   * the roster is `thumper`'s — 1305 u of range at 450 u/s is 2.9 s, and `weaponTicksOf("thumper")`
   * reports `flight: 87` ticks at 30 Hz, the largest of any row (`predator` is next at 60, `magmablast`
   * 45). 90 covers it with a little margin, and no firing solution needs to see past its own shot
   * landing.
   *
   * Authored in ms (NR14), so a `TICK_RATE_HZ` change rescales it; `resolveBrainConstants()` turns it
   * into `predictionHorizonTicks`. 3000 ms is 90 ticks at 30 Hz.
   */
  predictionHorizonMs: 3000,
  /**
   * Fraction of the bot's OWN comfortable range that `punish` holds instead (R-O4,
   * `controller.ts`'s goal for `punish`), floored at `minEngageUnits`.
   *
   * A HALF, because punish is the one play whose premise is that the opponent cannot answer: it
   * fires on a stun, a spent ult, or a wounded target, and all three are windows that close.
   * Standing off at the range that keeps a live opponent's guns honest wastes the window on travel
   * time, so the bot walks in to half of it and spends the window shooting. Expressed as a fraction
   * of the comfort range rather than its own unit count so a kit whose comfortable range moves
   * carries this with it; the `minEngageUnits` floor is what stops a short-range kit from halving
   * itself into the opponent's hull.
   */
  punishRangeFraction: 0.5,
  /**
   * Multiple of the fight range that `reset` backs off to (R-O4, `controller.ts`'s goal for
   * `reset`), floored at `minEngageUnits`.
   *
   * Deliberately SMALL — 15% past the range the bot was already fighting at, not a retreat across
   * the arena. `reset` fires on `retreatHpFraction`, and a hurt car that turns and runs presents its
   * back at a speed disadvantage; what a person actually does is give up a little ground while
   * keeping the opponent in front.
   */
  resetRangeMultiplier: 1.15,
  /**
   * Fraction of a chassis's own `turnRateOf` that an observed turn rate must reach before it reads
   * as DELIBERATE STEERING rather than a residual spin (P18/P19). See `steerFromObservedTurn`
   * (`bot/brain/predict.ts`) for the full-lock reasoning this rests on.
   *
   * A half, because the sim has no partial steer: `stepDrive`'s steer is only ever -1, 0 or 1, so a
   * car that is genuinely turning is at FULL lock and its observed rate lands on `turnRateOf(carId)`
   * almost exactly. There is nothing between "full lock" and "not steering" to discriminate, so the
   * threshold only has to sit clear of both — halfway is the natural place, and it also keeps the
   * threshold per-chassis (Bastion's 6.30 rad/s gives a lower bar than Mirage's 8.19) rather than
   * one absolute rate that would read a slow chassis's full lock as noise.
   */
  fullLockAngVelFraction: 0.5,
  /**
   * How much further ahead a bot looks for a spike strip than for a bare wall (Task 12, AS28) —
   * `spikesAhead`'s lookahead is `wallLookaheadUnits * this`, so a spiked wall registers as "pinned"
   * before a plain one does.
   *
   * Shared across every tier on purpose, not a per-profile knob: every bot understands that spikes
   * hurt equally, and the tiers already differ through their own `wallLookaheadUnits` and reaction
   * knobs — a Hard-only awareness of spikes here would be exactly the branch the `bot-tuner` skill
   * exists to prevent. `spikesAhead` itself cannot push "harder" the way a per-tier weight might
   * suggest: `wallAhead`'s push vector collapses to a boolean before this ever sees it, so the only
   * lever left is noticing sooner.
   */
  spikeLookaheadFactor: 2,
});

/**
 * The brain's behavioural version, folded into `botFingerprint` (H46).
 *
 * `BOT_PROFILES` is hashed by that fingerprint, but a hash of the table cannot see a behaviour
 * change made in code with the numbers untouched. Bump this whenever the brain's behaviour changes
 * without the table moving, or the balance harness will happily compare two incomparable pilots.
 */
// BOT_BRAIN_VERSION 7.0.0 — the deterministic core (docs/superpowers/specs/2026-10-09-bot-brain-v7-design.md).
export const BOT_BRAIN_VERSION = "7.0.0";

/**
 * The tick-valued knobs, authored in ms (NR14) and resolved to ticks at the build's tick rate.
 *
 * The three tiers (H44). Derived where derivable: perceived latency
 * (`viewStalenessTicks + reactionDelayTicks`) is 433 / 300 / 200 ms against measured human values of
 * ~250 ms casual, ~215 ms amateur and 150-165 ms pro; `acquireTicks` and `recomputeTicks` follow
 * TF2's recognition time and aim-tracking interval. The rest is first pass and expected to move
 * under playtesting.
 */
const TIMING_KEYS = [
  "viewStaleness", "reactionDelay", "recompute", "acquire", "memory", "aimErrorDrift", "burstGap",
  "targetCommit", "dodgeReaction", "dodgeHorizon", "situationCommit",
] as const;

/** A tier as authored: every tick-valued knob of `BotProfile` is a `…Ms` duration instead (NR14). */
export type AuthoredBotProfile = Omit<BotProfile, `${(typeof TIMING_KEYS)[number]}Ticks`> & {
  [K in (typeof TIMING_KEYS)[number] as `${K}Ms`]: number;
};

const toTicks = (ms: number): number => Math.round((ms * TICK_RATE_HZ) / 1000);

/** Authored ms -> the `BotProfile` in ticks that every brain module reads. */
export function resolveBotProfile(authored: AuthoredBotProfile): BotProfile {
  const out: Record<string, unknown> = { ...authored };
  for (const key of TIMING_KEYS) {
    out[`${key}Ticks`] = toTicks(authored[`${key}Ms`]);
    delete out[`${key}Ms`];
  }
  return out as unknown as BotProfile;
}

/** `BRAIN_CONSTANTS` with the authored ms durations replaced by their tick counts. */
export type ResolvedBrainConstants = Omit<
  typeof BRAIN_CONSTANTS,
  "predictionHorizonMs" | "soonReadyMs" | "ramDryWindowMs"
> & {
  readonly predictionHorizonTicks: number;
  readonly soonReadyTicks: number;
  readonly ramDryWindowTicks: number;
};
let resolvedBrain: ResolvedBrainConstants | undefined;

/** `BRAIN_CONSTANTS` with its authored ms durations resolved to ticks at the current tick rate. */
export function resolveBrainConstants(): ResolvedBrainConstants {
  // Memoised: `TICK_RATE_HZ` is a build constant.
  resolvedBrain ??= (() => {
    const { predictionHorizonMs, soonReadyMs, ramDryWindowMs, ...rest } = BRAIN_CONSTANTS;
    return Object.freeze({
      ...rest,
      predictionHorizonTicks: toTicks(predictionHorizonMs),
      soonReadyTicks: toTicks(soonReadyMs),
      ramDryWindowTicks: toTicks(ramDryWindowMs),
    });
  })();
  return resolvedBrain;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, AuthoredBotProfile>> = Object.freeze({
  easy: Object.freeze({
    viewStalenessMs: 133, reactionDelayMs: 300, recomputeMs: 400, acquireMs: 500,
    // R-P14 (2026-09-07): 520 -> 600. AN EASY BOT MUST BE ABLE TO SEE THE RANGE THE GAME IS FOUGHT
    // AT. The closed-loop duel opens with 553 units between the cars, and at 520 an easy bot began
    // every engagement blind and never recovered. Measured over 7 seeds x 3 chassis, the cliff sat
    // between 540 and 560 (11 of 21 cells fired nothing below it, none above) and 560-690 was one
    // flat plateau. 600 is mid-plateau, so a spawn or arena change does not re-break it, and it is
    // still 100 short of medium's 700, which keeps the ladder visible.
    awarenessRadiusUnits: 600, rearBlindHalfAngleRad: 1.05, trackedThreatLimit: 1, memoryMs: 500,
    stateEstimationSigma: 0.25,
    aimErrorSigmaRad: 0.18, aimErrorDriftMs: 667,
    burstGapMs: 467, hitChanceBar: 0.3,
    targetCommitMs: 5000, woundedBias: 0.1, vengefulness: 0.8,
    wallLookaheadUnits: 40,
    retreatHpFraction: 0, punishHpFraction: 0.4, opponentRangeRespect: 0,
    dodgeReactionMs: 400, dodgeHorizonMs: 400, situationCommitMs: 667,
  }),
  medium: Object.freeze({
    viewStalenessMs: 100, reactionDelayMs: 200, recomputeMs: 200, acquireMs: 300,
    awarenessRadiusUnits: 700, rearBlindHalfAngleRad: 0.6, trackedThreatLimit: 2, memoryMs: 1500,
    stateEstimationSigma: 0.1,
    aimErrorSigmaRad: 0.09, aimErrorDriftMs: 467,
    burstGapMs: 233, hitChanceBar: 0.5,
    targetCommitMs: 2000, woundedBias: 0.5, vengefulness: 0.5,
    wallLookaheadUnits: 90,
    retreatHpFraction: 0.3, punishHpFraction: 0.4, opponentRangeRespect: 0.45,
    dodgeReactionMs: 267, dodgeHorizonMs: 600, situationCommitMs: 400,
  }),
  hard: Object.freeze({
    viewStalenessMs: 67, reactionDelayMs: 133, recomputeMs: 67, acquireMs: 167,
    awarenessRadiusUnits: 900, rearBlindHalfAngleRad: 0, trackedThreatLimit: 4, memoryMs: 3000,
    stateEstimationSigma: 0.03,
    aimErrorSigmaRad: 0.035, aimErrorDriftMs: 300,
    burstGapMs: 100, hitChanceBar: 0.7,
    targetCommitMs: 833, woundedBias: 0.9, vengefulness: 0.25,
    wallLookaheadUnits: 150,
    retreatHpFraction: 0.35, punishHpFraction: 0.4, opponentRangeRespect: 0.9,
    dodgeReactionMs: 67, dodgeHorizonMs: 800, situationCommitMs: 200,
  }),
});

/** `BOT_PROFILES` resolved to ticks at the current tick rate: what brain modules and tests read. */
export const RESOLVED_BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze(resolveBotProfile(BOT_PROFILES.easy)),
  medium: Object.freeze(resolveBotProfile(BOT_PROFILES.medium)),
  hard: Object.freeze(resolveBotProfile(BOT_PROFILES.hard)),
});
