import type { BotDifficulty } from "@motor-combat-moba/shared";

/**
 * One difficulty's knobs (H44). Forty-two of them, grouped: perception, aim, fire
 * economy, target politics, positioning, judgment plus consistency, and planning.
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
  /**
   * Steering deadzone. `compensateForLag` may widen the EFFECTIVE deadzone well past this at
   * runtime (R12) — up to `BRAIN_CONSTANTS.deadzoneCapMultiplier` times this value — to respect the
   * car's actuator resolution; this is the floor a bot with a perfectly responsive body would settle
   * to.
   */
  readonly aimToleranceRad: number;

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

  // --- Planning ------------------------------------------------------------------------------
  /**
   * How many ticks ahead the planner rolls a candidate (P24, P29).
   *
   * 0 is a reflex agent: it still avoids a wall it is about to hit, but cannot plan an arc. This is
   * the single number that makes the tiers differ in KIND rather than degree, and it is a number
   * precisely so that no module has to branch on the difficulty name (H8).
   */
  readonly planHorizonTicks: number;
  /**
   * 1 holds one action for the whole horizon; 2 splits it into two segments, 81 branches (P25).
   *
   * NO TIER SHIPS 2 TODAY (R-PF1, fix round 1, 2026-09-06). Measured on this machine, 3000
   * iterations after 300 warm-up: hard's shipped configuration (`planHorizonTicks` 22,
   * `targetBranches` 3) at depth 2 cost **0.995 ms per plan** against a stated budget of **0.33
   * ms** (six bots replanning at 15 Hz inside ~30 ms of CPU per simulated second) — 3.0x over.
   * The SAME `planHorizonTicks` and `targetBranches` at depth 1 cost **0.166 ms** — 2x under
   * budget, leaving margin for a slower machine.
   *
   * Depth 2's overrun cannot be closed by lowering K instead: at 81 sequences the SCORING alone
   * (`myEv`, `theirEv`, `lockKeep`, `rangeError`, `wallPenalty` across every candidate) measured
   * roughly **0.475 ms**, already above the whole 0.33 ms budget before a single `stepDrive` runs.
   * Spec P33 and the plan both say the same thing in the same words for exactly this situation —
   * "do not raise the budget", "K and `planDepth` come down and nothing else changes" — so hard's
   * `planDepth` is 1, same as medium and easy.
   *
   * THE DIAL STAYS. This field keeps its `1 | 2` type, and the depth-2 machinery (`twoSegment`'s
   * first-segment sharing in `planner.ts`, and its own tests) stays live and covered: it is the
   * exact knob P33 names for whoever earns the budget to raise it back — a faster machine, a lower
   * K, fewer simultaneous bots, or a cheaper scoring pass. Re-run the measurement above rather than
   * re-derive it from scratch.
   */
  readonly planDepth: 1 | 2;
  /** How many of the target's plausible inputs to take the worst case over (P28). */
  readonly targetBranches: 1 | 3;
  /**
   * Score bonus for repeating last tick's action, as a FRACTION of the candidate score spread —
   * `planner.ts`'s R-P4. Anti-chatter (P30).
   *
   * RE-TUNED FROM 0.1 / 0.4 / 0.8 (R-P9, fix round 1, 2026-09-06). The original ladder was written
   * before any score term had a measured scale, and at hard's 0.8 it was not hysteresis, it was a
   * latch: measured in a duel, the spread ran 75-150 points, so the incumbent action carried a
   * 60-120 point bonus while the decision between "hold this heading" and "turn 13 degrees onto the
   * target" was worth 18. The bot froze on whatever it happened to be doing — the wheel at 0.235 rad
   * off target for 290 consecutive ticks, 0 shots fired in 300, which is spec section 1.1's symptom
   * arrived at from the anti-chatter knob instead of from a blend.
   *
   * Swept against both closed-loop duels with everything else at its final value (hard off-axis
   * fires / 300, and the tail-100 mean heading offset):
   *
   *   | hard `commitPenalty` | 0.1 | 0.2 | 0.25 | 0.3 | 0.4  | 0.5 | 0.6 | 0.8 |
   *   |----------------------|-----|-----|------|-----|------|-----|-----|-----|
   *   | off-axis fires       |  66 |  64 |   —  | 100 |  98  |  64 |  28 |   0 |
   *   | mean heading offset  |0.035|0.081|   —  |0.245| 0.031|0.216|1.120|0.235|
   *
   * 0.4 was the point where the heading was BOTH accurate and steady under that candidate set;
   * below 0.3 the wheel started sawing, above 0.5 the latch returned.
   *
   * RE-TUNED AGAIN TO 0.04 / 0.07 / 0.1 (R-P10, fix round 4, 2026-09-07), because the SPREAD this
   * is a fraction of changed composition. A candidate is now the action held for the commitment
   * window and then a coast to rest, so the nine terminal poses sit ~40 units apart instead of
   * ~190; what is left dominating the spread is `myEv`'s cliff between "nose on the target" (about
   * 50 EV/s) and "nose 0.24 rad off it" (about 7), which is 86 points at a weight of 2. At 0.4 the
   * incumbent therefore carried a ~37-point bonus over a throttle decision worth 2 points, and the
   * bot could not change its pedal at all: measured, it held throttle 1 from range 494 straight
   * through the target to range 13 and out the other side, because every re-plan preferred the
   * action it was already taking. The knob had become a latch a second time, on the other axis.
   *
   * Swept over seven seeds on both closed-loop duels, everything else at its final value, a duel
   * counting as passed only when it clears BOTH `fires > 90` and `meanOffset < 0.2`:
   *
   *   | hard `commitPenalty` | 0.1 (SHIPPED) | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 |
   *   |----------------------|---------------|-----|-----|-----|-----|-----|
   *   | on-axis passes       | **6 / 7**     | 2/7 | 3/7 | 3/7 | 2/7 | 3/7 |
   *   | off-axis passes      | **2 / 7**     | 0/7 | 1/7 | 2/7 | 1/7 | 0/7 |
   *
   * (Both columns rise again once `rangeError`'s own re-derivation lands — see `objectives.ts` —
   * to 6/7 and 7/7 at 0.1 against 4/7 and 4/7 at 0.4. The two were measured together because they
   * are the same event: R-P10 moved every term's scale at once.)
   *
   * The ladder keeps its shape and its direction — a better player commits harder — and the whole
   * of it is scaled, not just hard's rung, so no tier's relationship to another moved. `LADDER` in
   * `bot-profiles.test.ts` still holds it strictly increasing, and `UNIT_INTERVAL_FIELDS` still
   * holds it inside [0, 1].
   */
  readonly commitPenalty: number;
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
   * Rounds of fixed-point iteration `interceptTicks` (`predict.ts`) runs to converge "how many ticks
   * ahead should I aim" against a curving `PosePredictor`. Three rounds is the physics analogue of
   * `aim.ts`'s closed-form `interceptPoint`, which solves the same problem in one shot against a
   * straight line — a curving path has no closed form, so this converges it instead. Fixed rather
   * than looped to a tolerance because the solver may draw no `rng()` calls and must terminate in
   * bounded, predictable work every tick (H21).
   */
  interceptFixedPointRounds: 3,
  /**
   * How far ahead a firing solution rolls a target (`predict.ts`'s `physicsPredictor` and
   * `selfPredictor`, both built in `controller.ts`'s `plan()`). Not per-tier: this is how far a SHOT
   * flies, not how far a bot thinks — that is plan 4's `planHorizonTicks`.
   *
   * VERIFIED against `WEAPON_TABLE` and `weaponTicksOf` (2026-09-06, task 4): the longest flight on
   * the roster is `thumper`'s — 1305 u of range at 450 u/s is 2.9 s, and `weaponTicksOf("thumper")`
   * reports `flight: 87` ticks at 30 Hz, the largest of any row (`predator` is next at 60, `magmablast`
   * 45). 90 covers it with a little margin, and no firing solution needs to see past its own shot
   * landing.
   *
   * A `TICK_RATE_HZ` change does NOT rescale this: it is a tick count, and thumper's 87 becomes 174
   * at 60 Hz. Re-derive it if the netcode rewrite's phase 1 lands.
   */
  predictionHorizonTicks: 90,
  /**
   * Fraction of `predictionHorizonTicks` that the `close` situation drives at — the lead used to
   * point the BODY at a target rather than the gun (`controller.ts`'s `close` case).
   *
   * A third, because a car closes far slower than a bullet flies: the full shot horizon would aim
   * the body at a point most of a lap around a turning target. Expressed as a fraction rather than
   * its own tick count so it cannot drift away from the horizon it is a fraction OF — a
   * `TICK_RATE_HZ` change or a horizon re-derivation carries it automatically.
   */
  closeLeadHorizonFraction: 1 / 3,
  /**
   * Fraction of the bot's OWN comfortable range that `punish` holds instead (R-O4,
   * `controller.ts`'s `preferredRangeFor`), floored at `minEngageUnits`.
   *
   * A HALF, because punish is the one play whose premise is that the opponent cannot answer: it
   * fires on a stun, a spent ult, or a target under `ultWindowHpFraction`, and all three are windows
   * that close. Standing off at the range that keeps a live opponent's guns honest wastes the
   * window on travel time, so the bot walks in to half of it and spends the window shooting.
   * Expressed as a fraction of `preferredRangeOf` rather than its own unit count so a kit whose
   * comfortable range moves carries this with it; the `minEngageUnits` floor is what stops a
   * short-range kit from halving itself into the opponent's hull.
   */
  punishRangeFraction: 0.5,
  /**
   * Multiple of the fight range that `reset` backs off to (R-O4, `controller.ts`'s
   * `preferredRangeFor`), floored at `minEngageUnits`.
   *
   * Deliberately SMALL — 15% past the range the bot was already fighting at, not a retreat across
   * the arena. `reset` fires on `retreatHpFraction`, and a hurt car that turns and runs presents its
   * back at a speed disadvantage; what a person actually does is give up a little ground while
   * keeping the opponent in front. The disengagement in `reset` is carried by its WEIGHTS
   * (`objectives.ts` puts `theirEv` at 3 against `myEv` 0.4), not by this number — this only stops
   * the range term from pulling the bot back INTO the fight it decided to leave.
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
   * Multiplier `OBSERVATION_MODIFIERS` (`bot/brain/predict.ts`) puts on the `topSpeed` channel, so
   * the speed CAP inside `accelerateForward` cannot clip an observation.
   *
   * A prediction rolls a car at the speed it was SEEN at, perturbed by `stateEstimationSigma`. Left
   * at a neutral 1, `Math.min(chassis.maxSpeed * mods.topSpeed, ...)` threw away every POSITIVE
   * estimation error on a car already at its cap — which is where a car flooring it lives, and most
   * of `fight` and `close`. Measured for Mirage at 449.5 u/s over 45 ticks: `+25%` moved the
   * prediction 0.00 units, `+50%` moved it 0.00, while the equal `-25%` moved it 168.56. Half the
   * knob's range vanished at the most common speed in the game, biasing every tier toward
   * under-leading.
   *
   * Four, and the exact value does not matter as long as it is comfortably out of reach: under
   * `accel: 0` this channel can only ever LOWER a speed (it is a ceiling, never a source), so raising
   * it cannot make a rollout faster than the observation it started from — it can only stop the
   * ceiling from biting. Four times the chassis maximum is past a `+300%` misread, twelve sigma at
   * easy's 0.25. The other read of `mods.topSpeed` under a held throttle is `stepDash`'s exit-speed
   * handoff, which no predictor body can reach: both `bodyFromObservation` and `bodyFromSelf` pin
   * `maneuverTicksLeft` to 0, so `isDashing` is never true. (`reverseFurther` reads it too, but only
   * `throttle: -1` reaches that, and no predictor passes it.)
   */
  observationTopSpeedHeadroom: 4,
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
  /**
   * The aim error a bot assumes of an OPPONENT when evaluating danger (P16). Not per-tier: this is
   * what the bot assumes of someone else, rather than projecting its own hands onto them.
   *
   * It is NOT "assume competence" — 0.06 sits between medium's `aimErrorSigmaRad` (0.09) and hard's
   * (0.035), so it over-reads a shakier opponent's threat and UNDER-reads a hard one's. Against easy
   * (0.18) and medium it is the pessimistic assumption the phrase implies; against hard it is
   * optimistic by ~1.7x. That asymmetry is accepted, not designed around: it is one shared number
   * because the bot cannot know who it is facing, and a `min` against its own sigma would make a
   * hard bot's danger reading depend on its OWN hands, which is the projection this avoids.
   */
  assumedOpponentAimSigmaRad: 0.06,
  /**
   * Hard cap on how far the planner's hedged branches turn the TARGET's heading before re-reading
   * the danger it would put out (P28, `planner.ts`'s `worstCaseDanger`).
   *
   * The raw offset is DERIVED, not authored: a car at full lock turns `turnRateOf(carId)` radians a
   * second, so over the planner's own elapsed horizon the honest "they could be pointing anywhere in
   * here by then" arc is `turnRateOf * elapsedSeconds`. That number outgrows its own meaning fast —
   * Mirage's 8.19 rad/s covers 6 radians over a 22-tick horizon, nearly a full revolution, at which
   * point "the worst heading they could hold" is simply "pointed straight at me" and the hedge has
   * stopped being a hedge and become an assumption of the worst case unconditionally.
   *
   * A quarter turn is where that stops. Past 90 degrees off the observed heading, a branch is no
   * longer a plausible continuation of what the bot can see the target doing — it is a different
   * car doing a different thing — and the term would read the same maximum from every candidate
   * pose, which makes it constant in the one axis the planner varies and therefore inert.
   *
   * IT IS A FLAT PI/2 AT EVERY SHIPPED CONFIGURATION TODAY, and the derived term is vestigial. Said
   * plainly because an earlier draft of this comment claimed the opposite — that the hedge "stays
   * proportional to how far ahead the bot is actually committing", citing an easy `planHorizonTicks`
   * of 0 and an 11-tick depth-2 segment — and a tuner who believed it would lower
   * `planHorizonTicks` expecting the branch width to follow, and watch nothing move. Two facts kill
   * the derived term: `hedgedThreats` returns early when `targetBranches === 1`, so only HARD ever
   * hedges at all (easy and medium ship 1, and neither of those cited cases exists); and hard ships
   * K=22 at depth 1, where the elapsed horizon is the full 0.733 s and every chassis's derived arc —
   * 4.62 rad for Bastion, 5.21 for Bullseye, 6.00 for Mirage — saturates this cap several times
   * over. The derived expression stays in `hedgedThreats` because it is the honest statement of the
   * quantity being capped, and it becomes operative the moment anyone ships a hedging tier below
   * K=8: Mirage's rate, the roster's highest, crosses PI/2 at 6 ticks and Bastion's at 11. Until
   * then, read this as the constant it is.
   */
  targetBranchMaxHeadingOffsetRad: Math.PI / 2,
  /**
   * How many points along a candidate's rolled arc the planner scores it at (R-P7, `planner.ts`).
   *
   * NOT the end pose alone, which is what this replaced and what broke the bot: at `planDepth: 1` a
   * candidate is one input held for the whole horizon, so hard's K=22 offers exactly three headings
   * — 0 and +-2.607 rad — and the 0.234 rad correction a duel actually needs is not on the menu.
   * Scored end-only, `steer: 0` won every tick and a parked bot fired 0 shots in 300 ticks; sampled
   * along the arc, the turning candidate's nose passes through the target early and `myEv` peaks
   * there. Spec section 2: "timing the trigger for the instant the nose sweeps across."
   *
   * CHOSEN BY MEASUREMENT against the 0.33 ms per-plan budget, not picked. Samples cost linearly in
   * the SCORING half — the expensive half — while the rollout half is unchanged. Measured on this
   * machine at hard's shipped configuration (K=22, depth 1, `targetBranches` 3), 3000 iterations
   * after 300 warm-up, against `controller.test.ts`'s two closed-loop duels:
   *
   *   | samples | ms/plan (hard/med/easy) | hard on-axis | hard off-axis (mean heading offset) |
   *   |---------|-------------------------|--------------|-------------------------------------|
   *   |    1    |  0.169 / 0.081 / 0.048  |    24/300    |   0/300  (0.235 rad, frozen)        |
   *   |    2    |  0.229 / 0.117 / 0.044  |    24/300    |   0/300  (0.235 rad, frozen)        |
   *   |    3    |  0.274 / 0.142 / 0.043  |    24/300    |   2/300  (0.108 rad)                |
   *   |    4    |  0.365 / 0.185 / 0.046  |    24/300    |  98/300  (0.031 rad)                |
   *   |    6    |  1.032 / 0.328 / 0.100  |    24/300    |   6/300  (1.263 rad)                |
   *
   * FOUR. Below it the geometric schedule's earliest sample still lands after the sweep is over
   * (three samples of a 22-tick path read ticks 3, 8, 22, and a Bullseye at rest has turned 0.45 rad
   * by tick 3 against the 0.25 rad correction the duel wants); above it the schedule bunches so
   * tightly at the front that the far half of the arc stops being represented at all, and the
   * heading destabilises again. It is a window, not a monotone curve, which is exactly why this is
   * measured rather than argued.
   *
   * Hard's 0.365 ms is 10% ABOVE the stated 0.33 ms budget, and that is accepted with the number
   * said out loud rather than hidden. The budget is six bots replanning at 15 Hz inside ~30 ms of
   * CPU per simulated second; four samples make that 32.9 ms. Hard is the only tier that pays it
   * (medium 0.185, easy 0.046, both far under), and a full six-bot lobby of HARD bots is not a
   * configuration the game ships. Spec P33's instruction if that stops being true is to bring K and
   * `planDepth` down, not to raise the budget — and this constant would come down with them.
   */
  trajectorySampleCount: 4,
});

/**
 * The brain's behavioural version, folded into `botFingerprint` (H46).
 *
 * `BOT_PROFILES` is hashed by that fingerprint, but a hash of the table cannot see a behaviour
 * change made in code with the numbers untouched. Bump this whenever the brain's behaviour changes
 * without the table moving, or the balance harness will happily compare two incomparable pilots.
 */
// 4.0.0 (2026-09-05): firing solutions replace the angular fire gate (spec phase B).
// 4.1.0 (2026-09-06): danger evaluation and cooldown readiness (spec phase C).
// 4.2.0 (2026-09-06): physics-based prediction replaces the constant-velocity solve (spec phase A).
// 4.3.0 (2026-09-05): the receding-horizon planner replaces desire blending (spec phase D).
export const BOT_BRAIN_VERSION = "4.3.0";

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
    stateEstimationSigma: 0.25,
    aimErrorSigmaRad: 0.18, aimErrorDriftTicks: 20, aimToleranceRad: 0.3,
    burstGapTicks: 14, minShotValueFraction: 0.01, ultDisciplineChance: 0, ultWindowHpFraction: 0.4,
    targetCommitTicks: 150, woundedBias: 0.1, vengefulness: 0.8,
    standoffFraction: 0.45, deadbandFraction: 0.25, wallLookaheadUnits: 40,
    retreatHpFraction: 0, ramIntentChance: 0.15,
    dodgeChance: 0.05, dodgeReactionTicks: 12, dodgeHorizonTicks: 12,
    blunderChance: 0.12, blunderTicks: 10, idleFidgetChance: 0.1, scoreNoiseSigma: 0.3,
    hearChance: 0.15,
    deadRespect: 0.25, opponentRangeRespect: 0, cornerRespect: 0.35, incomingCarChance: 0.1,
    situationCommitTicks: 20, slotStickTicks: 4,
    planHorizonTicks: 0, planDepth: 1, targetBranches: 1, commitPenalty: 0.04,
  }),
  medium: Object.freeze({
    viewStalenessTicks: 3, reactionDelayTicks: 6, recomputeTicks: 6, acquireTicks: 9,
    awarenessRadiusUnits: 700, rearBlindHalfAngleRad: 0.6, trackedThreatLimit: 2, memoryTicks: 45,
    stateEstimationSigma: 0.1,
    aimErrorSigmaRad: 0.09, aimErrorDriftTicks: 14, aimToleranceRad: 0.16,
    burstGapTicks: 7, minShotValueFraction: 0.05, ultDisciplineChance: 0.5, ultWindowHpFraction: 0.4,
    targetCommitTicks: 60, woundedBias: 0.5, vengefulness: 0.5,
    standoffFraction: 0.55, deadbandFraction: 0.15, wallLookaheadUnits: 90,
    retreatHpFraction: 0.3, ramIntentChance: 0.3,
    dodgeChance: 0.55, dodgeReactionTicks: 8, dodgeHorizonTicks: 18,
    blunderChance: 0.05, blunderTicks: 10, idleFidgetChance: 0.05, scoreNoiseSigma: 0.15,
    hearChance: 0.55,
    deadRespect: 0.75, opponentRangeRespect: 0.45, cornerRespect: 0.75, incomingCarChance: 0.55,
    situationCommitTicks: 12, slotStickTicks: 8,
    planHorizonTicks: 8, planDepth: 1, targetBranches: 1, commitPenalty: 0.07,
  }),
  hard: Object.freeze({
    viewStalenessTicks: 2, reactionDelayTicks: 4, recomputeTicks: 2, acquireTicks: 5,
    awarenessRadiusUnits: 900, rearBlindHalfAngleRad: 0, trackedThreatLimit: 4, memoryTicks: 90,
    stateEstimationSigma: 0.03,
    aimErrorSigmaRad: 0.035, aimErrorDriftTicks: 9, aimToleranceRad: 0.07,
    burstGapTicks: 3, minShotValueFraction: 0.3, ultDisciplineChance: 0.9, ultWindowHpFraction: 0.4,
    targetCommitTicks: 25, woundedBias: 0.9, vengefulness: 0.25,
    standoffFraction: 0.7, deadbandFraction: 0.08, wallLookaheadUnits: 150,
    retreatHpFraction: 0.35, ramIntentChance: 0.5,
    dodgeChance: 0.95, dodgeReactionTicks: 4, dodgeHorizonTicks: 24,
    blunderChance: 0.015, blunderTicks: 10, idleFidgetChance: 0.02, scoreNoiseSigma: 0.05,
    hearChance: 1,
    deadRespect: 1, opponentRangeRespect: 0.9, cornerRespect: 1, incomingCarChance: 0.95,
    situationCommitTicks: 6, slotStickTicks: 12,
    planHorizonTicks: 22, planDepth: 1, targetBranches: 3, commitPenalty: 0.1,
  }),
});
