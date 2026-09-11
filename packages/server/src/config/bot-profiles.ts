import type { BotDifficulty } from "@motor-combat-moba/shared";

/**
 * One difficulty's knobs (H44). Thirty-nine of them, grouped: perception, aim, fire
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
  // `standoffFraction` and `deadbandFraction` were deleted here in spec phase D (P35, 2026-09-07).
  // `standoffFraction` was a per-tier fudge on a hand-written reach average; `preferredRangeOf`
  // (`bot/brain/firing.ts`) now asks the solver where the kit's value actually peaks, and the
  // per-tier ladder those fractions encoded falls out of `aimErrorSigmaRad` on its own (measured:
  // bullseye 70/170/420, mirage 87/170/220, bastion 70/133/133 easy/medium/hard). `deadbandFraction`
  // was the coast band `reduceToIntent` compared a range error against, and the planner scores a
  // continuous `rangeError` instead of thresholding one.
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
   * THE DIAL STAYS. This field keeps its `1 | 2` type, and the depth-2 machinery
   * (`rollCandidates`' first-window sharing in `planner.ts`, and its own tests) stays live and
   * covered: it is the exact knob P33 names for whoever earns the budget to raise it back — a
   * faster machine, a lower K, fewer simultaneous bots, or a cheaper scoring pass.
   *
   * THE THREE MS FIGURES ABOVE ARE FROM R-PF1's ROUND (2026-09-06) and predate the candidate set
   * the planner ships. R-P10's terminal policy, R-P12's commitment window and R-P17's per-depth
   * division of it all changed what a candidate IS, and depth 1's cost moved with them: the same
   * hard configuration measured **0.432 ms** in fix wave 1's re-sweep (2026-09-07 — see
   * `trajectorySampleCount`'s table, re-swept in the same wave). That is this sweep's own number,
   * not the baseline: `planner.bench.test.ts` reads hard at 0.375-0.422 ms isolated over eleven
   * runs, and is what a future edit is compared against (M9).
   *
   * DEPTH 2 HAS NOW BEEN RE-MEASURED, and the 3x above is NOT the ratio any more. At the shipped
   * `planHorizonTicks` and `targetBranches`, depth 2 costs **3.03 ms** per plan against depth 1's
   * **0.385** on the same machine in the same run — **7.95x**, not 3x, and 9x the stated budget.
   * (Task 8's `planner.bench.test.ts`, best-of-five: 1000 iterations per repeat at depth 1, 300 at
   * depth 2, both after 300 warm-up.) R-P10's terminal policy is why the ratio grew: the coasting
   * tail starts from wherever its own candidate left off, so it cannot be shared the way the first
   * window is, and 81 candidates each pay a `rollForward` for it against depth 1's 9. Depth 2 is
   * further out of budget than this comment used to say, not closer.
   *
   * R-P17 (fix wave 1) is what makes depth 2 SAFE to turn on at all. The commitment window used to
   * be computed from the whole horizon and then applied `depth` times, so at depth 2 the committed
   * ticks swallowed the horizon whole and the coasting tail was identically 0 — the first person to
   * take this upgrade path would have got the aim-freeze R-P10 fixed, back, with no failing test.
   * `commitWindowOf` divides by the depth now; `planner.test.ts` pins it.
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
   *
   * RE-SCALED A THIRD TIME, TO 0.072 / 0.126 / 0.18 (R-P16b, task 3 fix-round, 2026-09-07), because
   * R-P16 changed what this fraction is OF, not just what the field is called. `planner.ts` swapped
   * the spread denominator from `maxScore - minScore` to `maxScore - medianScore` so one out-of-arena
   * candidate could no longer blow the bonus up into a latch (measured: 2382 against a sane spread of
   * 16). `median(list) >= min(list)` always, so `maxScore - medianScore <= maxScore - minScore` in
   * EVERY scene the planner ever scores, not only the outlier ones — the fix is correct and stays,
   * but it uniformly halves-ish the denominator everywhere, so a `commitPenalty` value calibrated
   * against the old denominator is now a uniformly weaker knob than it was tuned to be. This is a
   * units change, not a behaviour change: the ladder's SHAPE (strictly rising, same three ratios to
   * each other) is preserved; only the common scale factor moves, exactly as R-P10's re-tuning above
   * scaled the whole ladder rather than touching one rung.
   *
   * MEASURED, not assumed. Instrumented `plan()` to log `{max, median, min}` for every candidate set
   * scored during both `controller.test.ts` closed-loop duels (hard tier, 300 ticks each) plus the
   * nine-cell (tier x chassis) 600-tick duel in "fires a non-zero number of shots on EVERY chassis" —
   * 1647 candidate sets in total, spanning all three tiers. The ratio `(max - median) / (max - min)`:
   *
   *   | sample set                          | count | mean ratio | median ratio | median of (max-min)/(max-median) |
   *   |--------------------------------------|-------|------------|---------------|-----------------------------------|
   *   | both hard duels                       |  298  |    0.516   |     0.447     |               2.24                |
   *   | all three tiers, nine chassis cells   | 1349  |    0.413   |     0.398     |               2.51                |
   *   | combined                              | 1647  |    0.432   |     0.409     |               2.44                |
   *
   * The mean of the inverse is not trustworthy here (it blows up past 9 on the mixed-tier set,
   * because a handful of near-flat candidate fields put `median` almost on top of `max` and divide by
   * almost nothing) — exactly the kind of single-sample sensitivity a MEDIAN-based normaliser is
   * supposed to resist reading FROM, so the median of the ratio, ~2.2-2.5x, is what is trustworthy:
   * "roughly half" was a fair first guess (an unskewed spread puts the median near the midpoint,
   * which would give almost exactly 2x), and the real distribution is a bit more compressed than
   * that guess, not less.
   *
   * That statistical ratio is what SHAPE of correction is needed, not the exact knob: the actual duel
   * outcome is a step function of this fraction (it decides which candidate's bonus clears which
   * other candidate's deficit), so the shipped value was chosen by sweeping hard's rung directly
   * against both closed-loop duels (a duel passes only when it clears BOTH `fires > 90` and
   * `meanOffset < 0.2`) and reading where the real pass/fail boundaries fall, the same method R-P9,
   * R-P10 and R-P12 above all used:
   *
   *   | hard `commitPenalty` | 0.1 (pre-fix) | 0.14 | 0.16 | 0.18 (SHIPPED) | 0.2 | 0.202 | 0.204 |
   *   |-----------------------|---------------|------|------|-----------------|-----|-------|-------|
   *   | on-axis fires          |      138      | 138  | 138  |      138        | 138 |  138  |  24   |
   *   | off-axis fires         |       90      |  94  |  96  |      112        | 124 |  124  |  124  |
   *
   * 0.1 no longer clears the off-axis bar at all (exactly 90 against a `> 90` bar — this is the
   * regression this ruling fixes). A second, NARROWER cliff sits at 0.204: on-axis collapses from 138
   * to 24 there and does not recover until 0.22, a knife's-edge pocket rather than a safe landing.
   * 0.18 sits in the middle of the wide, flat, well-measured plateau between the two — off-axis
   * clears its bar by 22 fires (112 against 90) and on-axis is nowhere near either cliff (0.024 clear
   * of the 0.204 collapse, more than 10% of the value itself) — rather than banking margin on one
   * side by living next to a wall on the other.
   *
   * 0.18 / 0.1 = 1.8, close to but a little under the measured statistical ratio (2.2-2.5x); the
   * duel's step-function boundaries, not the continuous statistical ratio, are what a `commitPenalty`
   * value is actually judged against, so the swept number is what shipped. Medium and easy are
   * scaled by that SAME 1.8x — 0.126 and 0.072 — rather than independently swept, because neither
   * tier has a closed-loop duel of its own to sweep against and the ladder's whole point (R-P10's
   * comment above) is that one scale factor moves every rung together. `LADDER` in
   * `bot-profiles.test.ts` still holds strictly increasing (0.072 < 0.126 < 0.18) and both
   * `PROBABILITY_FIELDS` (that test) and `UNIT_INTERVAL_FIELDS` (`personality.ts`) still hold inside
   * [0, 1] with room to spare — `commitPenalty` is not one of the fields any `ARCHETYPES` entry
   * shifts, so `rollPersonality` never moves it off the tier value at all, and the 200-seed sweep in
   * "keeps every probability in [0, 1] on a ROLLED personality too" passes on that value untouched
   * rather than on a jittered one.
   *
   * WHOEVER CHANGES THE NORMALISER AGAIN: this knob travels with it. It is calibrated against
   * `maxScore - medianScore`, not against `myEv` or any other fixed scale, so swapping the spread
   * measure a third time (a trimmed mean, a different percentile, anything else) obliges the same
   * re-measurement this comment records, not a reuse of these numbers.
   */
  readonly commitPenalty: number;
}

/**
 * Constants shared by every tier — not per-tier, and therefore deliberately not in the profile.
 */
export const BRAIN_CONSTANTS = Object.freeze({
  /**
   * Closest range the bot will ever choose to hold. Roughly one and a half car lengths.
   *
   * `preferredRangeOf` (`bot/brain/firing.ts`) samples from here outward and caps the answer at
   * `awarenessRadiusUnits`, so it relies on EVERY tier's `awarenessRadiusUnits` exceeding this —
   * easy 600, medium 700, hard 900 against 70, three orders of margin. `firing.test.ts`'s "every
   * tier can perceive further than the close-quarters floor" pins that rather than leaving it as a
   * coincidence of the table, because the cap is a `Math.min` and would otherwise silently push the
   * chosen range BELOW the floor this constant exists to enforce.
   */
  minEngageUnits: 70,
  /**
   * How much of its kit's PEAK sampled value a bot is willing to keep while standing further off
   * (R-D5, fix wave 2, 2026-09-07) — `preferredRangeOf` returns the farthest sampled range whose
   * weighted total clears `peak * this`.
   *
   * THE REASON IT IS NOT 1. An exact tie (`total === peak`, which is what the outward `>=`
   * tie-break spelled) is provably independent of `weights`: in this function the target sits
   * straight ahead, so every slot's `proxyValue` is non-negative and non-increasing in range, and
   * a sum of such terms ties its own maximum ONLY when every term does individually. Strictly
   * positive weights cancel out of that condition, so the returned range was
   * `min over ready slots of min(reach, cliff)` — a VETO BY THE SHORTEST-REACHING SLOT, at full
   * strength even when the personality's weight on that slot was 0.5 and its weight on a
   * twice-as-long slot was 1.5. `rollPersonality`'s `slotWeights` therefore could not move the
   * standoff at all, which is not what P31's "where this kit's EV peaks" asks for. Under a
   * FRACTIONAL bar a heavily-weighted long slot keeps the total above the bar past a
   * lightly-weighted short slot's cliff, and the weights are live again.
   *
   * MEASURED, not guessed (40 weight vectors drawn from `rollPersonality`'s own 0.5-1.5 range,
   * every chassis x every tier, counting how many of the nine cells resolve to more than one
   * range):
   *
   * | fraction      | weight-live cells | note                                                 |
   * |---------------|-------------------|------------------------------------------------------|
   * | 1.00 - 0.975  | 0 / 9             | the exact tie's regime; weights provably inert       |
   * | 0.970 - 0.88  | 1 / 9             | mirage/hard, 220 <-> 386.7 depending on the roll     |
   * | 0.878 - 0.871 | 3 / 9             | the peak — and only 0.008 wide                       |
   * | 0.87 - 0.82   | 2 / 9             | mirage/hard goes mute again (its bar clears the cliff unconditionally) |
   *
   * 0.95 IS THE MINIMUM PERTURBATION THAT SATISFIES THE RULING, which is the property worth having
   * here: everything downstream of this function — `planner.ts`'s `rangeError`, `commitPenalty`,
   * `trajectorySampleCount` — was settled by seven-seed sweeps against the ranges the exact-tie
   * rule produced, so the fraction should move them as little as it can while still letting
   * `slotWeights` reach the standoff. Weights come alive at 0.970; 0.95 clears that by 0.02 and
   * holds the same 1/9 liveness all the way down to 0.88, so it is not perched on the boundary.
   * Only THREE of the nine neutral-weight cells move at all.
   *
   * Going further down buys nothing measured and costs behaviour. 0.92 and 0.90 are still 1/9 —
   * no extra cell comes alive — but they take mirage/hard's neutral standoff from 220 to 386.7, a
   * 167-unit shift, and 0.90 turns `balance/match.test.ts`'s pinned hard Mirage-vs-Bastion
   * deathmatch (seed 3) into a 1-1 draw with no winner inside its 30 s window. That fixture was
   * left alone rather than reseeded, and it is what separated the two candidates. The 3/9 reading
   * at 0.871-0.878 was rejected on its own terms: a 0.008-wide window between a 1/9 reading at
   * 0.879 and a 2/9 one at 0.870 is a spike, and a knob perched that finely re-tunes itself the
   * first time a weapon row moves.
   *
   * Resolved ranges at 0.95 (chassis x tier, neutral weights), against the exact-tie values it
   * replaces: bullseye 70 / 170 / 470 (was 70 / 170 / 420), mirage 86.7 / 186.7 / 220
   * (was 86.7 / 170 / 220), bastion 90.8 / 132.5 / 132.5 (was 70 / 132.5 / 132.5). Mirage/hard's
   * 220 is the NEUTRAL reading of the one weight-live cell; a long-gun-heavy roll stands at 386.7.
   */
  preferredRangePlateauFraction: 0.95,
  /**
   * How many samples `preferredRangeOf` takes across its kit's reach (R-D5, fix wave 2).
   *
   * Was an unnamed `24` inside the loop, and it is not incidental: it is the resolution of the only
   * grid the standoff range is ever read off, so it sets how finely a plateau edge can be located,
   * and every cell in `preferredRangePlateauFraction`'s tables is quoted on THIS grid. MEASURED at
   * that fraction's 0.95 with neutral weights, sweeping 12 / 16 / 24 / 32 / 48 / 96: a hard
   * Bullseye reads 470 / 445 / 470 / 445 / 470 / 470 and a hard Mirage 203.3 / 220 / 220 / 220 /
   * 220 / 220. The answer is stable to within about a car length across an eightfold change in
   * resolution, and it does not converge monotonically — a coarse grid can only land ON a sample,
   * so refining it moves the reported edge either way. 24 is where the roster's three step sizes
   * (bullseye 50 u, bastion 20.8 u, mirage 16.7 u) are all inside a car length, which is the
   * resolution at which a further refinement stops meaning anything to a driver.
   *
   * IT DOES NOT EXPLAIN BASTION'S MEDIUM/HARD TIE, which task 4's report suspected it did and named
   * this as the lever that would break. Measured across 12 / 16 / 24 / 32 / 48 / 96 samples,
   * Bastion's medium and hard resolve to the SAME range at every one of them (111.7 through 150.0
   * as the grid refines, but always equal). The tie is a property of Bastion's kit — a 150 u
   * `wildcharge` alongside a 400/500 u pair whose plateau ends before either tier's
   * `aimErrorSigmaRad` can separate them — not of this number.
   */
  preferredRangeSampleCount: 24,
  /**
   * Floor on `preferredRangeOf`'s sample step, in world units (R-D5, fix wave 2).
   *
   * Was an unnamed `10`. It binds only for a kit whose longest reach is under
   * `preferredRangeSampleCount * this` = 240 u, and NO CHASSIS ON THE ROSTER IS ONE: the smallest
   * step today is Mirage's 16.7 u (400 / 24). Measured at `preferredRangePlateauFraction` 0.95 with
   * neutral weights, 1 / 5 / 10 give byte-identical nine-cell results; 20 is the first value to
   * move anything (mirage 86.7 / 186.7 / 220 -> 90 / 170 / 210) and 40 collapses Mirage's and
   * Bastion's easy tiers back onto the 70 floor. So it is a guard against a future short-reach kit
   * spending 24 samples inside two car lengths, kept at the widest value still provably inert on
   * the shipped roster — and the Bastion tie above is measured with it inert, not with it binding.
   */
  preferredRangeMinStepUnits: 10,
  /** Range at which a `range: 0` weapon (`wildcharge`) is worth pressing. */
  contactTriggerUnits: 150,
  /** `cooldownMs` at or above which a weapon counts as an ult for discipline purposes. */
  ultCooldownMs: 5000,
  /** How far a personality may move a parameter from its tier value, as a fraction. */
  personalityJitter: 0.25,
  /**
   * Rounds of fixed-point iteration `interceptTicks` (`predict.ts`) runs to converge "how many ticks
   * ahead should I aim" against a curving `PosePredictor`. Three rounds is the physics analogue of
   * the textbook closed-form straight-line intercept (`aim.ts` carried one, `interceptPoint`, until
   * R-K1 deleted it unused in 2026-09-07's phase D), which solves the same problem in one shot
   * against constant velocity — a curving path has no closed form, so this converges it. Fixed rather
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
  // `closeLeadHorizonFraction` was deleted in spec phase D (R-K2, 2026-09-07). Its only reader was
  // the `close` case of the deleted eight-case heading switch, which aimed the BODY at a lead point;
  // `preferredRangeFor` answers `close` with `minEngageUnits` and the planner drives to it.
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
   * THAT MEASUREMENT WAS TAKEN AT A 449.5 u/s CAP. The 2026-09-06 heavy-car pass cut Mirage's
   * maximum to 267 u/s, so the figures above describe the pre-rework roster. The ARGUMENT is
   * unchanged — a ceiling still clips a positive estimation error on a car sitting at its cap,
   * whatever the cap is — and the fix (put the ceiling out of reach) is scale-free, which is why
   * the value below did not need revisiting. The numbers are kept as the record of why this knob
   * exists rather than restated as current.
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
  // `deadzoneFloorFraction` and `deadzoneCapMultiplier` were deleted in spec phase D (R-D1,
  // 2026-09-07). Both existed only for `compensateForLag`, the mid-phase band-aid on a limit cycle
  // in bang-bang steering: `reduceToIntent` emitted -1/0/1 with no proportional term, so the
  // controller could not settle inside its own deadzone and oscillated. `planner.ts` scores
  // candidate arcs and emits `steer` directly, so the cause is gone rather than the symptom
  // suppressed — and `deadzoneCapMultiplier`'s own doc comment said this would happen: "a lookahead
  // planner is planned to replace the bang-bang steering entirely, which will delete
  // `compensateForLag` and with it this cap." The last reader of `aimToleranceRad` went with them.
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
   * the SCORING half — the expensive half — while the rollout half is unchanged.
   *
   * RE-SWEPT AT THE SHIPPED CONFIGURATION (fix wave 1, 2026-09-07), and the earlier table is gone
   * rather than annotated. The original sweep chose 4 against a candidate set that two later
   * rulings replaced — its whole "hard on-axis" column reads 24/300 at every sample count, which is
   * the pre-commitment-window defect value, not a reading of the shipped bot — and R-P10's terminal
   * policy plus R-P12's commitment window changed a candidate's arc from a 22-tick hold into 12
   * committed ticks and 10 coasting. A sampling schedule over the arc is a discretization OF that
   * arc, so the project's own rule (re-derive a weight when the quantity under it moves — applied
   * twice to `rangeError` and three times to `commitPenalty` for this same event) applies here too.
   *
   * Measured at hard's shipped configuration (K=22, depth 1, `targetBranches` 3), on
   * `controller.test.ts`'s two closed-loop duels over the SAME seven seeds R-P12 swept
   * (17, 3, 7, 42, 96, 101, 2026); a duel counts as passed only when it clears BOTH `fires > 90`
   * and `meanOffset < 0.2` over the tail 100 ticks. `ms/plan` times `plan()` alone, 3000 iterations
   * after 300 warm-up:
   *
   *   | samples | ms/plan (hard/med/easy) | on-axis | off-axis | seed 17 on / off (fires per 300) |
   *   |---------|-------------------------|---------|----------|----------------------------------|
   *   |    3    |  0.381 / 0.200 / 0.065  |   6/7   |   1/7    |  140 / **0**                     |
   *   |    4    |  0.432 / 0.242 / 0.067  | **7/7** |   6/7    |  140 / 128                       |
   *   |    5    |  0.545 / 0.243 / 0.068  |   6/7   | **7/7**  |  140 / 128                       |
   *   |    6    |  0.654 / 0.372 / 0.074  | **7/7** |   5/7    |  140 / 128                       |
   *
   * FOUR, CARRIED — on new evidence, not on the old table's authority, and for a different reason
   * than the old table gave. It is no longer a one-cell window: 4, 5 and 6 all score 13 of the 14
   * duel-seeds and differ only in WHICH seed they drop, so the top of the axis is a plateau and
   * this is a cost decision inside it. Four is the cheapest cell on that plateau (0.432 ms against
   * 0.545 and 0.654) and the only one that also holds the on-axis duel at 7/7. THREE IS THE CLIFF,
   * and it is a real one — the off-axis duel collapses to 1/7 and to 0 fires at the tests' own seed
   * 17 — for the reason the original sweep gave and which survives the re-measurement: the
   * geometric schedule's earliest sample lands after the sweep is over (three samples of a 22-tick
   * path read ticks 3, 8, 22, and a Bullseye at rest has turned 0.45 rad by tick 3 against the
   * 0.25 rad correction the duel wants).
   *
   * WHAT THE RE-SWEEP CHANGED, said plainly: the old table's claim that 6 destabilises the heading
   * (1.263 rad, 6 fires) does NOT reproduce at the shipped configuration — 6 is a healthy cell now,
   * just a slower one. The commitment window is why: with only the committed half of the arc
   * carrying real motion, bunching samples toward the front no longer starves the far end of
   * anything the bot was reading. So the argument for 4 is now "cheapest on the plateau", and the
   * argument against going below it is unchanged.
   *
   * Hard's 0.432 ms in this sweep is 30% ABOVE the stated 0.33 ms budget, and that is accepted with
   * the number said out loud rather than hidden. (The bench file's gated range is wider still —
   * 0.375-0.593 ms, 13% to 78% over, isolated through full-suite load.) The budget is six bots replanning at 15 Hz inside ~30 ms of
   * CPU per simulated second; four samples make that 38.9 ms. Hard is the only tier that pays it
   * (medium 0.242, easy 0.067, both far under), and a full six-bot lobby of HARD bots is not a
   * configuration the game ships. Spec P33's instruction if that stops being true is to bring K and
   * `planDepth` down, not to raise the budget — and this constant would come down with them.
   *
   * THE FIGURE TO COMPARE A FUTURE EDIT AGAINST IS `planner.bench.test.ts`'s, NOT THIS ONE (M9,
   * fix wave 3, 2026-09-07). Several per-plan numbers are on record, each honestly labelled with
   * its own run, and a reader picking between them was being pointed here — at a single reading
   * that the shipped gate's own data does not reproduce. To be explicit:
   *
   *   | figure          | where it came from                                                    |
   *   |-----------------|-----------------------------------------------------------------------|
   *   | 0.365 ms        | the ORIGINAL sample-count sweep (task 3), before the commitment window |
   *   | ~0.34 ms        | phase D's final report, on a different scene                          |
   *   | 0.432 ms        | THIS table's own re-sweep (fix wave 1) — see the rows above            |
   *   | 0.385 ms        | the depth-1/depth-2 run on `planDepth`, best-of-five, same wave        |
   *   | **0.375-0.422** | **`planner.bench.test.ts`, hard, ISOLATED, over eleven runs**           |
   *
   * The last row is THE BASELINE. It is a range rather than a point, it comes from the gate that
   * actually runs in CI, and the file states the loaded conditions beside it (0.453-0.500 under
   * `src/bot/ src/config/`, 0.531-0.593 under the whole suite) so a comparison can be made under
   * matched load. The 0.432 and 0.385 above stay because each is the internally consistent number
   * for the sweep it belongs to — compare rows WITHIN a table to each other, and compare a future
   * edit to the bench file.
   */
  trajectorySampleCount: 4,
  /**
   * HOW MUCH OF THE HORIZON A CANDIDATE COMMITS TO before its terminal policy takes over — the
   * planner's commitment window, as a fraction of `planHorizonTicks`, rounded UP to a whole tick
   * (R-P12, fix round 5, 2026-09-07). Hard's K of 22 gives 12 ticks committed and 10 coasting;
   * medium's 8 gives 5 and 3; easy's 0 floors to a single tick, which is what keeps P29's reflex
   * tier a reflex.
   *
   * IT IS THE SHARE OF THE WHOLE PLAN, SPLIT ACROSS `planDepth` WINDOWS — `commitWindowOf` divides
   * by the depth, so a depth-2 candidate is two 6-tick windows and a 10-tick coast rather than two
   * 12-tick windows and no coast at all (R-P17, fix wave 1, 2026-09-07). At the `planDepth: 1`
   * every tier ships that division is a no-op and this number is read exactly as written; it
   * matters only to the depth-2 upgrade path spec P33 names.
   *
   * THE MIDDLE OF AN AXIS WHOSE TWO ENDS BOTH FAIL, and it had to be measured because both ends
   * look right from a distance. A candidate held for the WHOLE horizon (round 3) makes the steering
   * menu "0 / +150 / -150 degrees" and the throttle menu "floor it for 0.73 s / stop", so a
   * 13-degree aim correction and a 56-unit range close are not on it. A candidate held only for
   * `recomputeTicks` (round 4, hard: 2) and then braked to a stop gives a stationary bot about four
   * units of positional reach, so a dodge, a U-turn and leaving a wall are not on it either. Both
   * were shipped, and each broke what the other fixed.
   *
   * Swept as a grid, both closed-loop duels over seven seeds each, with the `rangeError` weights
   * re-derived per cell (R-P9's rule: a weight is re-derived when the quantity under it moves), and
   * `src/bot/` + `src/config/` red counts at the best row of each:
   *
   *   | window (hard) | continuation  | on-axis | off-axis | red |
   *   |---------------|---------------|---------|----------|-----|
   *   |  2 (recompute)| full neutral  |   6/7   |   7/7    |  7  |
   *   |  2 (recompute)| steer-only    |   4/7   |   6/7    |  -  |
   *   |  6 (K/4)      | full neutral  |   5/7   |   7/7    |  7  |
   *   |  8 (K/3)      | full neutral  |   6/7   |   5/7    |  7  |
   *   | 11 (K/2)      | full neutral  | **7/7** | **6/7**  |  3  |
   *   | 22 (K)        | none          |   1/7   |   1/7    |  -  |
   *
   * Half is a genuine plateau at 11-12 ticks and a cliff on both sides: 10 reads 6/7 and 5/7, and
   * 13 collapses the on-axis duel to 0/7 (the committed window grows past the coasting tail, and a
   * candidate stops being able to stop where it wants). Below the plateau the plan loses its reach
   * and the dodge, the hunt and the wall go with it; above it, the plan loses its aim.
   *
   * 0.52 RATHER THAN A FLAT 0.5, i.e. the TOP of that plateau (12 ticks, not 11), for one measured
   * reason: `balance/match.test.ts`'s seed-96 deathmatch-clock fixture goes red at 11 and green at
   * 12, and reseeding a fixture to accommodate a tuning choice inside its own plateau is the wrong
   * way round. Both windows read the same on everything else — 7/7 and 6/7 on the duels, the same
   * three red cases in `src/bot/` + `src/config/`. Any fraction in (0.5, 0.545] picks 12 at hard.
   *
   * A FRACTION OF THE HORIZON, not the profile's `recomputeTicks`, and that is the substantive
   * finding of the sweep. Round 4 reasoned that the window should be what the hands actually hold,
   * which is `recomputeTicks`; the measurement says the window is a property of the PLAN — how much
   * of the arc is a real commitment and how much is the terminal policy's coast — and it scales
   * with the horizon rather than with the recompute cadence. Both halves are needed: the committed
   * half is what gives the plan reach, the coasting half is what makes the terminus a place the car
   * can actually be left, which is what the two destination terms are read at.
   *
   * A number, so the planner still never learns which tier it is (H8).
   */
  commitWindowFraction: 0.52,
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
// 4.0.0 (2026-09-05): firing solutions replace the angular fire gate (spec phase B).
// 4.1.0 (2026-09-06): danger evaluation and cooldown readiness (spec phase C).
// 4.2.0 (2026-09-06): physics-based prediction replaces the constant-velocity solve (spec phase A).
// 4.3.0 (2026-09-07): the receding-horizon planner replaces desire blending (spec phase D).
// 4.4.0 (2026-09-07): the car-physics rework lands under the brain. aim.ts/perception.ts read the
// target's real vx/vy instead of reconstructing velocity from angle+speed — the bot's lead and
// dead-reckoning are now correct for a car that is sliding or being shoved, which they silently
// were not before — and predict.ts rolls the vector drive model rather than the scalar one.
// 4.5.0 (2026-09-07): the planner scores orientation. `rawScore` gains a seventh term,
// `facingError` — nose-versus-travel misalignment, bounded [0, 1] via sim/velocity.ts, subtracted
// like rangeError and wallPenalty, with a per-situation weight in objectives.ts's BASE. Fixes the
// fragility where a drive retune could flip forward/reverse and the planner would not notice.
// 4.5.1 (2026-09-07): `evade`'s `facingError` weight re-derived 40 -> 10 in objectives.ts's BASE
// (commit `7c2d271`) — at 40 the term cost more than the entire 0-24 range of `threatAvoid` an
// `evade` dodge can earn, so full-clearance dodges were dominated outright. This is EXACTLY the
// case this constant exists for: BASE is not part of `botFingerprint`'s hash (it hashes
// BOT_PROFILES, this string and the shared tables — see `balance/fingerprint.ts`), and
// `BOT_PROFILES` did not move, so without this bump a `npm run balance --baseline` across the
// change would have compared two different pilots under identical fingerprints and reported `ok`.
// Behaviour moved measurably: the change reshuffles which duel seeds are decisive (63/150 either
// way, but a different set), which is why `balance/match.test.ts` needed a re-seed.
// 4.6.0 (2026-09-11): the bot learns the octagon and the fourteen spike strips (Task 12). `wallAhead`
// tests every boundary plane instead of only width/height, so a chamfer now registers as a wall; the
// new `spikesAhead` fires earlier than a bare wall does (`BRAIN_CONSTANTS.spikeLookaheadFactor`),
// because the deliberate easy-tier "pins itself on walls" behaviour now bleeds HP against a spiked
// one. A minor bump: `BOT_PROFILES` did not move, but a bot that used to drive into a chamfer or
// grind on a spike strip no longer does, so a `--baseline` balance comparison across this change
// would silently compare two different pilots without it.
export const BOT_BRAIN_VERSION = "4.6.0";

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
    // R-P14 (residuals round, 2026-09-07): 520 -> 600. AN EASY BOT MUST BE ABLE TO SEE THE RANGE
    // THE GAME IS FOUGHT AT. At 520 it could not: the closed-loop duel opens with 553 units between
    // the cars, and hard's duels settle in a 464-597 band (R-P12's seven-seed measurement), so an
    // easy bot began every engagement BLIND. It then never recovered, because at
    // `planHorizonTicks: 0` the planner rolls a single tick and no candidate expresses a manoeuvre
    // — it cannot turn around or drive to a hunt waypoint, only drift. Traced: `target` was
    // `undefined` on 49 of the 50 recompute ticks in a 600-tick easy/Bastion duel.
    //
    // Measured, 7 seeds x 3 chassis = 21 closed-loop duels of 600 ticks each, easy only. The cliff
    // is between 540 and 560 — exactly where the radius crosses the 553-unit opening distance —
    // and 560-690 is one flat plateau, so this is not a tuned point:
    //
    // | radius | 520 | 540 | 560 | 580 | 600 | 620 | 660 | 690 |
    // |--------|-----|-----|-----|-----|-----|-----|-----|-----|
    // | cells firing 0 shots | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 0 |
    // | fewest presses in any cell | 0 | 0 | 48 | 36 | 36 | 48 | 48 | 36 |
    // | mean presses per cell | 27 | 15 | 154 | 143 | 151 | 154 | 154 | 145 |
    //
    // 600 rather than 560 because 560 sits seven units off the cliff, so any spawn or arena change
    // re-breaks it; 600 is mid-plateau and still 100 short of medium's 700, which keeps the ladder
    // and the tier's short-sightedness both visible. Raising `planHorizonTicks` was measured as the
    // alternative and rejected: it is a real second link (K=6 takes 11 mute cells to 2) but no value
    // below medium's 8 clears them all, and 8 would flatten the ladder.
    awarenessRadiusUnits: 600, rearBlindHalfAngleRad: 1.05, trackedThreatLimit: 1, memoryTicks: 15,
    stateEstimationSigma: 0.25,
    aimErrorSigmaRad: 0.18, aimErrorDriftTicks: 20,
    burstGapTicks: 14, minShotValueFraction: 0.01, ultDisciplineChance: 0, ultWindowHpFraction: 0.4,
    targetCommitTicks: 150, woundedBias: 0.1, vengefulness: 0.8,
    wallLookaheadUnits: 40,
    retreatHpFraction: 0, ramIntentChance: 0.15,
    dodgeChance: 0.05, dodgeReactionTicks: 12, dodgeHorizonTicks: 12,
    blunderChance: 0.12, blunderTicks: 10, idleFidgetChance: 0.1, scoreNoiseSigma: 0.3,
    hearChance: 0.15,
    deadRespect: 0.25, opponentRangeRespect: 0, cornerRespect: 0.35, incomingCarChance: 0.1,
    situationCommitTicks: 20, slotStickTicks: 4,
    planHorizonTicks: 0, planDepth: 1, targetBranches: 1, commitPenalty: 0.072,
  }),
  medium: Object.freeze({
    viewStalenessTicks: 3, reactionDelayTicks: 6, recomputeTicks: 6, acquireTicks: 9,
    awarenessRadiusUnits: 700, rearBlindHalfAngleRad: 0.6, trackedThreatLimit: 2, memoryTicks: 45,
    stateEstimationSigma: 0.1,
    aimErrorSigmaRad: 0.09, aimErrorDriftTicks: 14,
    burstGapTicks: 7, minShotValueFraction: 0.05, ultDisciplineChance: 0.5, ultWindowHpFraction: 0.4,
    targetCommitTicks: 60, woundedBias: 0.5, vengefulness: 0.5,
    wallLookaheadUnits: 90,
    retreatHpFraction: 0.3, ramIntentChance: 0.3,
    dodgeChance: 0.55, dodgeReactionTicks: 8, dodgeHorizonTicks: 18,
    blunderChance: 0.05, blunderTicks: 10, idleFidgetChance: 0.05, scoreNoiseSigma: 0.15,
    hearChance: 0.55,
    deadRespect: 0.75, opponentRangeRespect: 0.45, cornerRespect: 0.75, incomingCarChance: 0.55,
    situationCommitTicks: 12, slotStickTicks: 8,
    planHorizonTicks: 8, planDepth: 1, targetBranches: 1, commitPenalty: 0.126,
  }),
  hard: Object.freeze({
    viewStalenessTicks: 2, reactionDelayTicks: 4, recomputeTicks: 2, acquireTicks: 5,
    awarenessRadiusUnits: 900, rearBlindHalfAngleRad: 0, trackedThreatLimit: 4, memoryTicks: 90,
    stateEstimationSigma: 0.03,
    aimErrorSigmaRad: 0.035, aimErrorDriftTicks: 9,
    burstGapTicks: 3, minShotValueFraction: 0.3, ultDisciplineChance: 0.9, ultWindowHpFraction: 0.4,
    targetCommitTicks: 25, woundedBias: 0.9, vengefulness: 0.25,
    wallLookaheadUnits: 150,
    retreatHpFraction: 0.35, ramIntentChance: 0.5,
    dodgeChance: 0.95, dodgeReactionTicks: 2, dodgeHorizonTicks: 24,
    blunderChance: 0.015, blunderTicks: 10, idleFidgetChance: 0.02, scoreNoiseSigma: 0.05,
    hearChance: 1,
    deadRespect: 1, opponentRangeRespect: 0.9, cornerRespect: 1, incomingCarChance: 0.95,
    situationCommitTicks: 6, slotStickTicks: 12,
    planHorizonTicks: 22, planDepth: 1, targetBranches: 3, commitPenalty: 0.18,
  }),
});
