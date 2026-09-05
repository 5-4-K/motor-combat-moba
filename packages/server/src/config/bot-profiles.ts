import type { BotDifficulty } from "@motor-combat-moba/shared";

/**
 * One difficulty's knobs (H44). Thirty-seven of them, grouped: perception, aim, fire
 * economy, target politics, positioning, and judgment plus consistency.
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
  /**
   * Steering deadzone. `compensateForLag` may widen the EFFECTIVE deadzone well past this at
   * runtime (R12) — up to `BRAIN_CONSTANTS.deadzoneCapMultiplier` times this value — to respect the
   * car's actuator resolution; this is the floor a bot with a perfectly responsive body would settle
   * to.
   */
  readonly aimToleranceRad: number;
  /**
   * Fraction of the correct intercept lead actually applied to `interceptPoint` — 0 shoots/drives at
   * where the target IS, 1 at the full ballistic lead point (R21).
   *
   * Restored here (fix round 2, 2026-09-06) after P35 removed it in phase B as "superseded by real
   * forward prediction" — but that predictor is a PHASE A deliverable (`predict.ts`, P17-P22) that
   * has not landed. `controller.ts` had been calling `interceptPoint` with a hardcoded lead of `1`
   * for every tier in the meantime, which silently gave easy (was 0, no lead at all) and medium (was
   * 0.55) a hands upgrade in exactly the axis meant to separate the tiers. It will be removed again,
   * for real this time, in the phase that actually replaces it — see P35's table in
   * `docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md`.
   */
  readonly leadFactor: number;

  // --- Fire economy -------------------------------------------------------------------------
  /** Minimum ticks between presses. The sim accepts one press per tick regardless. */
  readonly burstGapTicks: number;
  /**
   * The FRACTION of this shooter's own kit's best-achievable `value` (`bestAchievableValueOf`,
   * solution.ts) a shot must clear before this bot takes it (P14, R20).
   *
   * R16 (fix round 1, 2026-09-05) calibrated this field as an ABSOLUTE expected-damage-per-second
   * number (easy 0.5 / medium 7 / hard 25) and that was WRONG IN KIND, not just in value: a kit's
   * achievable `value` ceiling varies by roughly a factor of four across the roster's three chassis
   * (measured at each tier's own `aimErrorSigmaRad`, nose-on-target, best range per slot via
   * `bestAchievableValueOf`):
   *
   * | chassis  | slot 0        | slot 1         | slot 2         |
   * |----------|---------------|----------------|----------------|
   * | bullseye | predator 32.0 | pepperbox 78.3 | lance 11.3     |
   * | mirage   | magmablast 45.0 | thunderclap 20.4 | afterburner 21.2 |
   * | bastion  | thumper 18.3  | roadblock 15.3 | wildcharge 11.5 |
   *
   * Bastion's best possible shot ANYWHERE (18.3) sat below hard's absolute threshold of 25, so a
   * hard Bastion pressed nothing — 0 fires in 600 ticks of a closed-loop duel, while hard Bullseye
   * and hard Mirage fired hundreds of times each with the same profile. Every ult on the roster also
   * values below 25, so `ULT_WINDOW_BONUS`, `ultDisciplineChance` and the ult-hold machinery were
   * dead code at hard regardless of chassis. No single absolute number can separate "amateur" from
   * "only takes shots that pay" across kits with a 4x spread in what "paying" can even mean.
   *
   * R20 (fix round 2, 2026-09-06) replaced the absolute number with THIS fraction, compared against
   * `bestAchievableValueOf(self.carId, profile.aimErrorSigmaRad)` — the ceiling the shooter's OWN
   * kit can reach at the shooter's OWN aim quality, computed once per (carId, sigma) pair and
   * memoised (a kit is fixed for a match, so this must never be recomputed per tick). A shot is
   * "worth taking" relative to what this car could ever do, not relative to a number borrowed from
   * whichever chassis happened to calibrate it.
   *
   * MEASURED (not assumed), starting from the ruling's own suggested 0.05 / 0.35 / 0.6 and swept
   * DOWN from there once measurement showed those values go mute — with a closed-loop duel
   * generalised to all three chassis (`controller.test.ts`'s `closedLoopDuel`, now parameterised on
   * the shooter's carId), 600 ticks per (tier, chassis) cell against a stationary target, counting
   * ticks with a non-zero `fireSlots`.
   *
   * The starting point does NOT survive contact with Bullseye. Bullseye is the one chassis on the
   * roster whose kit ceiling (pepperbox, 78.3 — driven by a converged multi-pellet value only
   * reachable very close in) sits far above what its OTHER good weapon (predator, 32.0, aim-assisted,
   * usable out to 800u) or even pepperbox itself at a realistic mid-fight standoff (~26, measured at
   * 300u) can produce. A fraction picked to look "picky" against the 78.3 ceiling is, in practice,
   * pickier than EVERY shot Bullseye's kit actually offers at its own chosen standoff range — sweeping
   * candidate fractions against the real closed-loop duel finds a hard cliff for Bullseye alone
   * (mirage and bastion stay flat across the whole 0.02-0.6 range swept, because their kit's
   * ceiling-defining weapon is also the one they mostly fire in a real fight): hard's off-axis fires
   * hold at 94/300 up to fraction 0.32, then fall to 0/300 at 0.34; medium's off-axis fires hold at
   * 102/300 up to 0.08, then fall to 0/300 at 0.1; easy's off-axis fires hold at 87/300 only at
   * 0.01, falling to 27/300 at 0.02. Each tier's chosen value sits on the flat, safe side of ITS
   * cliff, with margin, and reproduces the ORIGINAL R16 calibration's own committed fire counts
   * almost exactly (120/87 easy, 144/102 medium, 140/94 hard, on/off-axis) — evidence that R16's
   * absolute numbers were themselves reasonable fractions of Bullseye's realistic (not ceiling) value
   * band; R16's actual defect was applying that Bullseye-shaped number to every other chassis.
   *
   * Chosen: easy 0.01, medium 0.05, hard 0.3 (strictly increasing, per `bot-profiles.test.ts`'s
   * `LADDER`). Verified non-zero on every one of the 9 (tier, chassis) cells in a 600-tick
   * closed-loop duel — see `final-fix-report.md` for the full table.
   */
  readonly minShotValueFraction: number;
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
  /** Standard deviation of the noise added to target scores. */
  readonly scoreNoiseSigma: number;
  /** Probability of hunting toward a shot the bot has not identified as a car. */
  readonly hearChance: number;
  /** Probability of treating a dead/phased car as unhittable (S12). */
  readonly deadRespect: number;
  /** How hard to stay outside the opponent's shortest gun (S11). */
  readonly opponentRangeRespect: number;
  /** Probability of leaving a bound/corner when a hittable target exists (S13). */
  readonly cornerRespect: number;
  /** Probability of treating an approaching car as an evade threat (S16). */
  readonly incomingCarChance: number;
  /** How long a situation is held before a same-or-lower priority may replace it (S8). */
  readonly situationCommitTicks: number;
  /** How long `chooseSlot` keeps the same slot unless the situation or reach changes (S15). */
  readonly slotStickTicks: number;
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
  /**
   * Fraction of ONE TICK's worth of rotation that floors the effective steering deadzone (R10,
   * 2026-09-05; corrected R12, review round 1). A bang-bang steer law — `reduceToIntent`'s `steer`
   * is only ever -1/0/1, never proportional — cannot settle inside a tolerance band smaller than
   * the smallest step the actuator can take, or it overshoots every correction and limit-cycles
   * forever. The smallest step is ONE TICK of rotation, not a whole decision interval's worth:
   * `rotationPerTick = turnRate / TICK_RATE_HZ`. Measured on hard/bullseye while moving
   * (turnRateOf("bullseye") = 7.11 rad/s): `rotationPerTick` = 7.11 / 30 = 0.237 rad/tick. At
   * INTRODUCTION (R10) the floor was `rotationPerTick * 0.5` = 0.1185 rad — above `aimToleranceRad`
   * (0.07, so the floor binds) and, at the time, below `fireConeRad` (0.2, so it did not disable
   * firing). **That headline number is stale**: R15 below (fix round 3) redefines the floor as the
   * LARGER of one tick's rotation and one `recomputeTicks` window's, and hard's `recomputeTicks` is
   * 2, so hard's actual floor today is `rotationPerTick * recomputeTicks * 0.5` = 0.237 * 2 * 0.5 =
   * 0.237 rad — capped to `aimToleranceRad * deadzoneCapMultiplier` = 0.07 * 2.3 = 0.161 rad by the
   * ceiling below. See R15's own paragraph for the mechanism; this is its number for hard.
   *
   * `fireConeRad` no longer exists (Task 7, 2026-09-05, retired it along with the angular fire gate); see
   * `deadzoneCapMultiplier` below for what the ceiling is keyed to now. Halving one tick's rotation is
   * the standard "deadzone >= half a step" rule for a discretized bang-bang controller: tight
   * enough to still track, loose enough to stop chasing a precision the car cannot deliver in one
   * tick.
   *
   * The review round 1 defect: an earlier version of this constant floored against a whole
   * DECISION INTERVAL's rotation (`turnRate * lagSeconds`, where `lagSeconds` covers
   * `reactionDelayTicks + recomputeTicks` — 6 ticks on hard, so `turnRate * lagSeconds` = 7.11 *
   * 0.2 = 1.422 rad) rather than one tick's. That produced an effective deadzone of 1.422 * 0.5 =
   * 0.711 rad (41 degrees, 3.5x `fireConeRad`), which does not just fail to help — it disables
   * steering almost entirely once the bot is off-axis, because the bang-bang test never fires
   * until the heading error clears a band wider than any real duel geometry produces. `lagSeconds`
   * still belongs in the PROJECTION term (`compensateForLag`'s `projectedError`) — that part was
   * always correct and is unchanged; it just does not belong in the floor. See `movement.ts`'s
   * `compensateForLag`.
   *
   * One more wrinkle the off-axis test surfaced: `rotationPerTick` must use the car's MOVING turn
   * rate (`floorTurnRate` in `compensateForLag`), never the speed-dependent one R10 already threads
   * through for the projection. The stopped rate is roughly half the moving one (`stopTurnRatio`
   * 0.5), so floor-from-current-speed collapses to ~0.059 rad — below `aimToleranceRad` — the
   * instant the car comes to rest at its standoff range, silently undoing the fix at exactly the
   * moment `fight` needs it most (parked, facing the target). The floor is the finest correction the
   * car can EVER make, not the one it happens to be capable of on a given tick.
   *
   * A THIRD wrinkle (R15, fix round 3, 2026-09-05): one tick's rotation is not the only thing the
   * bot cannot correct within. It also cannot correct within its own `recomputeTicks` window — it
   * re-decides only that often, holding the previous steer the whole time — and for a tier with a
   * large `recomputeTicks` (medium: 6 ticks) that window's rotation is several times one tick's, so
   * a floor keyed only to one tick left medium's off-axis deadzone too tight to settle, and it
   * aimed WORSE off-axis than easy despite outranking it everywhere else. The floor is now the
   * LARGER of "half one tick's rotation" and "half one decision window's rotation" — the same
   * fraction, applied once, to whichever raw rotation (one tick's, or `recomputeTicks` ticks') is
   * bigger. Taking the larger candidate is only safe because of `deadzoneCapMultiplier` below, which
   * still stops the floor from swallowing `aimToleranceRad` many times over on a tier with a very
   * long `recomputeTicks`. See `movement.ts`'s `compensateForLag`.
   */
  deadzoneFloorFraction: 0.5,
  /**
   * Hard ceiling on the effective steering deadzone, as a MULTIPLE of `aimToleranceRad` (R12,
   * review round 1; re-keyed here 2026-09-05 when Task 7's EV firing gate retired `fireConeRad`).
   * 2.3 is a FITTED constant chosen to reproduce hard/bullseye's measured convergence from before
   * Task 7, NOT derived from any per-tier invariant or a fixed ratio between tiers — no single
   * multiplier can do that, because `fireConeRad` was authored independently per tier (easy 0.55,
   * medium 0.35, hard 0.2) and the ratios of these old caps to the current `aimToleranceRad` values
   * are NOT uniform: easy 0.55 / 0.3 = 1.83, medium 0.35 / 0.16 = 2.19, hard 0.2 / 0.07 = 2.86.
   * A literal read of 2.3 therefore does NOT preserve the old fire-cone containment invariant for
   * easy and medium: applying 2.3 to easy's `aimToleranceRad` (0.3) yields 0.69 rad, exceeding the
   * old easy cap of 0.55 by ~25%; medium's 0.16 × 2.3 = 0.368 rad exceeds the old cap of 0.35 by
   * ~5%; hard's 0.07 × 2.3 = 0.161 rad stays within the old cap of 0.2, at ~80% of it.
   *
   * That deviation from the old invariant is currently acceptable because the fire gate itself is
   * no longer an angle at all — it was deleted when the EV firing gate landed, so the fire-cone
   * containment invariant it enforced is defined in terms of a field that no longer exists. What
   * matters now is measured behaviour, and all three tiers fire healthily: easy 120/87 (on/off-axis),
   * medium 144/102, hard 140/94 (both geometries in the committed `controller.test.ts` duel).
   *
   * THE VALUE IS SENSITIVE and NON-MONOTONIC, not a free constant (Task 7 finding, 2026-09-05):
   * measured on the off-axis duel, cap 0.14 rad (multiplier 2.0) left the bang-bang controller
   * oscillating with mean offset 0.222 rad and never settling; cap 0.16 rad (multiplier ~2.29,
   * the old hard `fireConeRad` numeric value itself) settled cleanly to mean offset 0.018 rad;
   * cap 0.21 rad (multiplier 3.0) also settled cleanly, but to a different resting offset of
   * 0.086 rad — three nearby values, three qualitatively different outcomes. 2.3 lands in hard's
   * known-good band, recovering its pre-Task-7 convergence almost exactly. This means the cap is
   * not robust to small changes and MUST be re-measured rather than nudged if anything around it
   * changes — a `turnRate` edit, a change to `deadzoneFloorFraction`, or a future tier's different
   * turn-rate profile could all shift it unexpectedly.
   *
   * This constant is expected to be temporary: a lookahead planner is planned to replace the
   * bang-bang steering entirely, which will delete `compensateForLag` and with it this cap.
   */
  deadzoneCapMultiplier: 2.3,
});

/**
 * The brain's behavioural version, folded into `botFingerprint` (H46).
 *
 * `BOT_PROFILES` is hashed by that fingerprint, but a hash of the table cannot see a behaviour
 * change made in code with the numbers untouched. Bump this whenever the brain's behaviour changes
 * without the table moving, or the balance harness will happily compare two incomparable pilots.
 */
// 4.0.0 (2026-09-05): firing solutions replace the angular fire gate (spec phase B).
export const BOT_BRAIN_VERSION = "4.0.0";

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
    aimErrorSigmaRad: 0.18, aimErrorDriftTicks: 20, aimToleranceRad: 0.3, leadFactor: 0,
    burstGapTicks: 14, minShotValueFraction: 0.01, ultDisciplineChance: 0, ultWindowHpFraction: 0.4,
    targetCommitTicks: 150, woundedBias: 0.1, vengefulness: 0.8,
    standoffFraction: 0.45, deadbandFraction: 0.25, wallLookaheadUnits: 40,
    retreatHpFraction: 0, ramIntentChance: 0.15,
    dodgeChance: 0.05, dodgeReactionTicks: 12, dodgeHorizonTicks: 12,
    blunderChance: 0.12, blunderTicks: 10, idleFidgetChance: 0.1, scoreNoiseSigma: 0.3,
    hearChance: 0.15,
    deadRespect: 0.25, opponentRangeRespect: 0, cornerRespect: 0.35, incomingCarChance: 0.1,
    situationCommitTicks: 20, slotStickTicks: 4,
  }),
  medium: Object.freeze({
    viewStalenessTicks: 3, reactionDelayTicks: 6, recomputeTicks: 6, acquireTicks: 9,
    awarenessRadiusUnits: 700, rearBlindHalfAngleRad: 0.6, trackedThreatLimit: 2, memoryTicks: 45,
    aimErrorSigmaRad: 0.09, aimErrorDriftTicks: 14, aimToleranceRad: 0.16, leadFactor: 0.55,
    burstGapTicks: 7, minShotValueFraction: 0.05, ultDisciplineChance: 0.5, ultWindowHpFraction: 0.4,
    targetCommitTicks: 60, woundedBias: 0.5, vengefulness: 0.5,
    standoffFraction: 0.55, deadbandFraction: 0.15, wallLookaheadUnits: 90,
    retreatHpFraction: 0.3, ramIntentChance: 0.3,
    dodgeChance: 0.55, dodgeReactionTicks: 8, dodgeHorizonTicks: 18,
    blunderChance: 0.05, blunderTicks: 10, idleFidgetChance: 0.05, scoreNoiseSigma: 0.15,
    hearChance: 0.55,
    deadRespect: 0.75, opponentRangeRespect: 0.45, cornerRespect: 0.75, incomingCarChance: 0.55,
    situationCommitTicks: 12, slotStickTicks: 8,
  }),
  hard: Object.freeze({
    viewStalenessTicks: 2, reactionDelayTicks: 4, recomputeTicks: 2, acquireTicks: 5,
    awarenessRadiusUnits: 900, rearBlindHalfAngleRad: 0, trackedThreatLimit: 4, memoryTicks: 90,
    aimErrorSigmaRad: 0.035, aimErrorDriftTicks: 9, aimToleranceRad: 0.07, leadFactor: 0.95,
    burstGapTicks: 3, minShotValueFraction: 0.3, ultDisciplineChance: 0.9, ultWindowHpFraction: 0.4,
    targetCommitTicks: 25, woundedBias: 0.9, vengefulness: 0.25,
    standoffFraction: 0.7, deadbandFraction: 0.08, wallLookaheadUnits: 150,
    retreatHpFraction: 0.35, ramIntentChance: 0.5,
    dodgeChance: 0.95, dodgeReactionTicks: 4, dodgeHorizonTicks: 24,
    blunderChance: 0.015, blunderTicks: 10, idleFidgetChance: 0.02, scoreNoiseSigma: 0.05,
    hearChance: 1,
    deadRespect: 1, opponentRangeRespect: 0.9, cornerRespect: 1, incomingCarChance: 0.95,
    situationCommitTicks: 6, slotStickTicks: 12,
  }),
});
