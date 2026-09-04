import type { BotDifficulty } from "@motor-combat-moba/shared";

/**
 * One difficulty's knobs (H44). Thirty-three of them, in five groups: perception, aim, fire
 * economy, target politics, positioning, and consistency.
 *
 * Every field is a NUMBER, and no code outside this file branches on which tier it came from (H8).
 * That is the whole mechanism by which the tiers stay distinct as the brain grows: a behaviour is
 * code, a tier is data.
 */
export interface BotProfile {
  // --- Perception ---------------------------------------------------------------------------
  /** The world other cars are drawn from is this many ticks old: 20 Hz patch rate plus ping. */
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

  // --- Aim ----------------------------------------------------------------------------------
  /** Standard deviation of the aim error, in radians. */
  readonly aimErrorSigmaRad: number;
  /** How often the aim error is resampled. Long enough that error DRIFTS rather than jitters. */
  readonly aimErrorDriftTicks: number;
  /** Steering deadzone. MUST stay below `fireConeRad`. */
  readonly aimToleranceRad: number;
  /** How well aimed the bot must be to fire. */
  readonly fireConeRad: number;
  /** Fraction of the correct intercept lead actually applied. 0 shoots at where the target is. */
  readonly leadFactor: number;

  // --- Fire economy -------------------------------------------------------------------------
  /** Minimum ticks between presses. The sim accepts one press per tick regardless. */
  readonly burstGapTicks: number;
  /** Probability of HOLDING a shot that is outside the good window. */
  readonly fireDisciplineChance: number;
  /** Probability of saving a long-cooldown weapon for a good moment (TF2's airblast gate). */
  readonly ultDisciplineChance: number;
  /** Target hp fraction under which an ult is considered worth spending. */
  readonly ultWindowHpFraction: number;

  // --- Target politics ----------------------------------------------------------------------
  /** How long the bot stays on one target before switching is cheap. */
  readonly targetCommitTicks: number;
  /** Weight on (1 - hp fraction) when choosing a target — Quake's EASY_FRAGGER. */
  readonly woundedBias: number;
  /** Weight on "this car was shooting at me". Runs BACKWARDS up the ladder (H33). */
  readonly vengefulness: number;

  // --- Positioning and survival -------------------------------------------------------------
  /** Preferred range as a fraction of the bot's own effective weapon range (H35). */
  readonly standoffFraction: number;
  /** Half-width of the coast band around the preferred range, as a fraction of it. */
  readonly deadbandFraction: number;
  /** How strongly the bot circles rather than closing head-on. */
  readonly orbitBias: number;
  /** How far ahead the bot looks for a wall or obstacle. */
  readonly wallLookaheadUnits: number;
  /** Hp fraction below which the bot disengages. 0 means it fights to zero. */
  readonly retreatHpFraction: number;
  /** Probability of committing to a deliberate ram when one is available. */
  readonly ramIntentChance: number;

  // --- Threat reaction and consistency ------------------------------------------------------
  /** Probability of reacting at all to a newly-noticed incoming shot. Rolled ONCE per threat. */
  readonly dodgeChance: number;
  /** Extra ticks between noticing an incoming shot and moving. */
  readonly dodgeReactionTicks: number;
  /** How far ahead a shot's path is projected when deciding whether it threatens. */
  readonly dodgeHorizonTicks: number;
  /** Probability per decision window of committing to a wrong action. */
  readonly blunderChance: number;
  /** How long a blunder lasts once committed to. */
  readonly blunderTicks: number;
  /** Probability of a small idle steering input when there is nothing to do. */
  readonly idleFidgetChance: number;
  /** Standard deviation of the noise added to stance and target scores. */
  readonly scoreNoiseSigma: number;
  /** How long a stance is held before rescoring is allowed (pre-emptions excepted). */
  readonly stanceCommitTicks: number;
}

/**
 * Constants shared by every tier — not per-tier, and therefore deliberately not in the profile.
 */
export const BRAIN_CONSTANTS = Object.freeze({
  /** Closest range the bot will ever choose to hold. Roughly one and a half car lengths. */
  minEngageUnits: 70,
  /** Range at which a `range: 0` weapon (`wildcharge`) is worth pressing. */
  contactTriggerUnits: 150,
  /** `cooldownMs` at or above which a weapon counts as an ult for discipline purposes. */
  ultCooldownMs: 5000,
  /** How far a personality may move a parameter from its tier value, as a fraction. */
  personalityJitter: 0.25,
});

/**
 * The brain's behavioural version, folded into `botFingerprint` (H46).
 *
 * `BOT_PROFILES` is hashed by that fingerprint, but a hash of the table cannot see a behaviour
 * change made in code with the numbers untouched. Bump this whenever the brain's behaviour changes
 * without the table moving, or the balance harness will happily compare two incomparable pilots.
 */
export const BOT_BRAIN_VERSION = "1.0.0";

/**
 * The three tiers (H44). Derived where derivable: perceived latency
 * (`viewStalenessTicks + reactionDelayTicks`) is 433 / 300 / 200 ms against measured human values of
 * ~250 ms casual, ~215 ms amateur and 150-165 ms pro; `acquireTicks` and `recomputeTicks` follow
 * TF2's recognition time and aim-tracking interval; `ultDisciplineChance` reproduces TF2's airblast
 * gating (0% / 50% / 90%). The rest is first pass and expected to move under playtesting.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({
    viewStalenessTicks: 4, reactionDelayTicks: 9, recomputeTicks: 12, acquireTicks: 15,
    awarenessRadiusUnits: 520, rearBlindHalfAngleRad: 1.05, trackedThreatLimit: 1, memoryTicks: 15,
    aimErrorSigmaRad: 0.18, aimErrorDriftTicks: 20, aimToleranceRad: 0.3, fireConeRad: 0.55,
    leadFactor: 0,
    burstGapTicks: 14, fireDisciplineChance: 0.05, ultDisciplineChance: 0, ultWindowHpFraction: 0.4,
    targetCommitTicks: 150, woundedBias: 0.1, vengefulness: 0.8,
    standoffFraction: 0.45, deadbandFraction: 0.25, orbitBias: 0, wallLookaheadUnits: 40,
    retreatHpFraction: 0, ramIntentChance: 0.15,
    dodgeChance: 0.05, dodgeReactionTicks: 12, dodgeHorizonTicks: 12,
    blunderChance: 0.12, blunderTicks: 10, idleFidgetChance: 0.1, scoreNoiseSigma: 0.3,
    stanceCommitTicks: 45,
  }),
  medium: Object.freeze({
    viewStalenessTicks: 3, reactionDelayTicks: 6, recomputeTicks: 6, acquireTicks: 9,
    awarenessRadiusUnits: 700, rearBlindHalfAngleRad: 0.6, trackedThreatLimit: 2, memoryTicks: 45,
    aimErrorSigmaRad: 0.09, aimErrorDriftTicks: 14, aimToleranceRad: 0.16, fireConeRad: 0.35,
    leadFactor: 0.55,
    burstGapTicks: 7, fireDisciplineChance: 0.45, ultDisciplineChance: 0.5, ultWindowHpFraction: 0.4,
    targetCommitTicks: 60, woundedBias: 0.5, vengefulness: 0.5,
    standoffFraction: 0.7, deadbandFraction: 0.15, orbitBias: 0.35, wallLookaheadUnits: 90,
    retreatHpFraction: 0.3, ramIntentChance: 0.3,
    dodgeChance: 0.55, dodgeReactionTicks: 8, dodgeHorizonTicks: 18,
    blunderChance: 0.05, blunderTicks: 10, idleFidgetChance: 0.05, scoreNoiseSigma: 0.15,
    stanceCommitTicks: 30,
  }),
  hard: Object.freeze({
    viewStalenessTicks: 2, reactionDelayTicks: 4, recomputeTicks: 2, acquireTicks: 5,
    awarenessRadiusUnits: 900, rearBlindHalfAngleRad: 0, trackedThreatLimit: 4, memoryTicks: 90,
    aimErrorSigmaRad: 0.035, aimErrorDriftTicks: 9, aimToleranceRad: 0.07, fireConeRad: 0.2,
    leadFactor: 0.95,
    burstGapTicks: 3, fireDisciplineChance: 0.85, ultDisciplineChance: 0.9, ultWindowHpFraction: 0.4,
    targetCommitTicks: 25, woundedBias: 0.9, vengefulness: 0.25,
    standoffFraction: 0.85, deadbandFraction: 0.08, orbitBias: 0.75, wallLookaheadUnits: 150,
    retreatHpFraction: 0.45, ramIntentChance: 0.5,
    dodgeChance: 0.95, dodgeReactionTicks: 4, dodgeHorizonTicks: 24,
    blunderChance: 0.015, blunderTicks: 10, idleFidgetChance: 0.02, scoreNoiseSigma: 0.05,
    stanceCommitTicks: 18,
  }),
});
