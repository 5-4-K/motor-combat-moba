import {
  DRIVE_CONFIG, TICK_RATE_HZ, NEUTRAL_MODIFIERS, carAimRangeOf, inAcquireRegion, inRetainRegion,
  turnRateOf, weaponDefOf, type SimBody, type WeaponDef, type WeaponId,
} from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import type { BotArenaView, BotCarView, BotSelfView, BotSlotView } from "../types.js";
import { signedDelta } from "./aim.js";
import { slotIsReady } from "./firing.js";
import { bodyFromSelf, interceptTicks, rollForward, type DriveAction } from "./predict.js";
import { proxyDangerAgainst, proxyValue, type PosePredictor } from "./solution.js";

const DEG_PER_RAD = 180 / Math.PI;

/**
 * Every input the game accepts. COMPLETE, not sampled: `InputMessage.steer` and `.throttle` are
 * each `-1 | 0 | 1` and nothing else, so these nine sequences are the whole action space and a
 * search over them carries no discretization error at all — there is no finer input the bot
 * declined to consider, and no interpolation between two of these that the sim could execute.
 *
 * THE ORDER IS THE TIE-BREAK OF RECORD. `plan` keeps the first candidate of an exact tie (it
 * improves on strictly greater). Exact ties are reachable whenever nothing in the weights or the
 * scene distinguishes two candidates — e.g. every weight zeroed — and USED TO BE guaranteed at
 * `horizonTicks: 0`, when the rollout moved nothing at all and every candidate scored the
 * identical current pose. R-P6 (fix round 1, 2026-09-06) closed that: `plan` now floors the
 * per-segment roll at one tick even when K is 0, so a K=0 plan still moves before it scores and
 * the nine candidates are no longer forced to tie. Straight-and-forward leads, so a genuine tie
 * still resolves to "drive on" rather than to whichever corner of the grid an arbitrary
 * enumeration happened to start in.
 */
export const ALL_ACTIONS: readonly DriveAction[] = Object.freeze(
  ([1, 0, -1] as const).flatMap((throttle) =>
    ([0, 1, -1] as const).map((steer) => Object.freeze({ steer, throttle }))),
);

/** How much each term counts. Supplied by the situation (P27), scaled by the profile (P38). */
export interface PlanWeights {
  myEv: number;
  theirEv: number;
  rangeError: number;
  wallPenalty: number;
  lockKeep: number;
  /**
   * How much this play wants to get OFF the line of a shot already in the air (P40, R-P8).
   *
   * Maximised, and deliberately separate from `theirEv`: that term is about firing solutions the
   * opponent COULD take from where they are standing, and reads their loaded guns. This one is
   * about the bolt that is already flying, which no reading of the shooter's cooldowns can see.
   * The design keeps both reflexes because they are different reflexes.
   */
  threatAvoid: number;
}

export interface PlanResult {
  action: DriveAction;
  /** The score that actually won, commit bonus included. */
  score: number;
  /** Per-term contributions of the winning candidate, for the overlay (P45). */
  terms: Record<keyof PlanWeights, number>;
  /**
   * The best candidate whose FIRST action differs from the winner's — the real alternative, not
   * merely the second row of the table. At depth 2 nine sequences share each first action, so a
   * naive runner-up is usually the same emitted input with a different second segment, which tells
   * an overlay reader nothing about what the bot nearly did instead.
   */
  runnerUp: DriveAction | undefined;
}

export interface PlanArgs {
  self: BotSelfView;
  target: BotCarView | undefined;
  /**
   * Where the thing being driven at will be, `ticksAhead` from now.
   *
   * Required even when `target` is undefined: the caller is expected to pass a SYNTHETIC predictor
   * pointing at a hunt waypoint with `preferredRange: 0`, and the planner drives at it through the
   * same range term rather than through a parallel path (R-P3).
   */
  targetAt: PosePredictor;
  readiness: (weaponId: WeaponId) => number;
  aimSigmaRad: number;
  preferredRange: number;
  weights: PlanWeights;
  /**
   * Shots already in the air that this bot has noticed and decided to react to (P40, R-P8) —
   * `perception.ts`'s `activeThreats`, straight through. Only `awayHeadingRad` is read: the
   * direction perception already computed as "perpendicular to that shot's path, away from it".
   *
   * Empty is the normal case and costs nothing. The planner never decides WHETHER a threat is
   * reacted to — `dodgeChance` and `dodgeReactionTicks` did that before the list got here.
   */
  shotThreats: readonly { awayHeadingRad: number }[];
  /**
   * K. 0 is a reflex agent (P29): even then, `plan` floors the per-segment roll at ONE tick
   * (R-P6, fix round 1, 2026-09-06) rather than zero, so a K=0 plan still moves before it scores
   * and can still avoid a wall it is driving straight at. It cannot plan an arc — that is what
   * "reflex" means — but it is not degenerate.
   */
  horizonTicks: number;
  /** 1 holds one action for K ticks; 2 splits into two K/2 segments (P25). */
  depth: 1 | 2;
  /** How many of the target's possible inputs to hedge against (P28). 1 or 3. */
  targetBranches: 1 | 3;
  /** Anti-chatter (P30). A FRACTION of the candidate score spread, not a raw addend — see below. */
  commitPenalty: number;
  lastAction: DriveAction | undefined;
  /**
   * Ticks between this decision and the hands moving — `humanize.ts`'s delay line, i.e. the
   * profile's `reactionDelayTicks` (R-P7c, fix round 1, 2026-09-06).
   *
   * The planner rolls its candidates from the pose the bot will be in WHEN THE INPUT LANDS, not
   * from the pose it is in while deciding. Dead time is not a detail here: hard's 4 ticks is 0.48
   * rad of Bullseye rotation at rest, so a bot correcting a 0.27 rad error commits four more ticks
   * of full lock after it is already on target, overshoots to -0.44, corrects back, and limit-cycles
   * forever — measured, 0 fires in 300 ticks, with the wheel visibly sawing. The deleted
   * `compensateForLag` was the desire model's answer to the same dead time; this is the planner's,
   * and it is the textbook one (roll the plant forward through the delay, then plan from there).
   *
   * 0 disables it. `lastAction` is what the delay line is still paying out, so it is what the roll
   * holds; with no `lastAction` there is nothing in flight and the current pose is already correct.
   */
  actuationDelayTicks: number;
  tick: number;
  arena: BotArenaView;
}

/**
 * One rolled-out candidate: the input that would be emitted, and the WHOLE PATH it traces.
 *
 * R-P7 (fix round 1, 2026-09-06): this used to be the end pose alone, and that is what made a
 * 13-degree aim correction unrepresentable. See `plan`'s doc for the argument; `path[i]` is the
 * pose after `i + 1` ticks, so `path.at(-1)` is the terminus.
 */
interface Candidate {
  first: DriveAction;
  path: readonly SimBody[];
}

/**
 * Choose this tick's input by looking ahead (P24).
 *
 * Receding horizon: every candidate is rolled K ticks, but only the winner's FIRST action is
 * emitted, and the whole thing is redone on the next recompute. That is what lets a bot plan a
 * second-long arc while still reacting inside two ticks.
 *
 * THE WHOLE ARC IS SCORED, NOT ITS TERMINUS (R-P7, fix round 1, 2026-09-06). Spec section 2 says
 * what this game is: "Skilled play is finding arcs where those coincide, and timing the trigger for
 * the instant the nose sweeps across." A score read only at the end pose cannot express "the nose
 * sweeps across" — it can only ask where the nose ENDS — and that is not a stylistic complaint, it
 * is what broke the bot. At `planDepth: 1` a candidate is ONE input held for the whole horizon, so
 * at hard's K of 22 the three steer choices end at 0, +2.607 and -2.607 rad off the current heading
 * and NOTHING ELSE IS ON THE MENU. A 0.234 rad correction — the actual manoeuvre, measured in a
 * parked off-axis duel — is unreachable, `steer: 0` wins every tick, the heading freezes 13 degrees
 * off target and the bot fires 0 shots in 300 ticks. That is spec section 1.1's exact symptom
 * reached by a new road. Sampled along the path, the +1 candidate's nose passes straight through the
 * target at tick 2, `myEv` peaks there, and the arc wins on the sweep it actually contains.
 *
 * NOTHING IS READ AT THE TERMINUS (R-P7 revised, fix round 2, 2026-09-06). Round 1 kept
 * `rangeError` and `threatAvoid` at the end pose, on the reasoning that "that is where the arc
 * leaves you standing". Measurement falsified it, and the defect it left standing was the SAME one
 * trajectory scoring had just cured on the steer axis, only on the throttle axis: full throttle held
 * for 22 ticks TERMINATES ~190 units along, far past a 56-unit range correction, so closing scored
 * worse than coasting and the bot never closed the gap — exactly as full lock held for 22 ticks
 * overshot a 13-degree correction so the bot never turned. The terminus is simply the wrong question
 * for a RECEDING horizon: hard re-plans every 2 ticks and has re-planned eleven times before it
 * would reach a pose 22 ticks out, so it never stands there. The question the controller actually
 * executes on is "does this arc carry me through what I want".
 *
 * Each term aggregates the way its own direction demands, which is the whole content of the fix:
 *
 * - `myEv` — the BEST found anywhere along the path. That is the sweep.
 * - `lockKeep` — the BEST along the path, for the same reason.
 * - `rangeError` — the BEST (smallest) along the path. "Does this arc carry me through my preferred
 *   range", not "does it park me there".
 * - `threatAvoid` — the BEST (largest) displacement reached anywhere along the path. Getting off the
 *   line for the moment the bolt passes is the whole point; where the excursion ends is not.
 * - `theirEv` — the WORST (maximum danger). An arc that carries you through someone's line is
 *   dangerous even if it ends somewhere safe.
 * - `wallPenalty` — the WORST. Clipping a wall mid-arc is a real cost, not an artifact.
 *
 * WHAT THAT COST, MEASURED, because the honest version of this comment is not one-sided. Moving
 * `rangeError` off the terminus is what fixes the on-axis duel (`controller.test.ts` spec 1.1: 24
 * fires per 300 ticks -> 140, mean heading offset 0.000 rad, settling at exactly the preferred 530
 * instead of parking at 586 where only `predator` reaches). It also costs the off-axis duel (98 ->
 * 44, mean heading offset 0.031 -> 0.414 rad), `tiers.test.ts`'s H39 wall test, and the seed-96
 * deathmatch-clock fixture in `balance/match.test.ts` — five red tests where round 1 had three. The
 * mechanism of the loss is that a MINIMISED term aggregated over an arc goes inert wherever the bot
 * is already near its preferred range: every candidate's arc passes within a few units of the
 * current pose at the first sample, so every candidate's minimum is that same small error and the
 * term stops separating them. Near the settle point `myEv` and `theirEv` are then alone, they score
 * a left sweep and a right sweep almost identically, and the wheel saws. Swept and rejected as
 * remedies: `commitPenalty` over 0.3-0.9 (no value clears both duels), `fight`'s `rangeError` weight
 * over 0-0.8 (best is 88 fires at 0.390 rad, which fails the heading half), `trajectorySampleCount`
 * 3/5/6/8 (3 is the best duel pair at 146/86 but takes the whole suite to SIX failures by breaking
 * both dodge tests and G12), and starting the sample schedule later than tick 1 (much worse: the
 * on-axis duel collapses to 2 fires). The remaining candidate parameterization finding from round 1
 * — that `planDepth: 1` cannot express "throttle for five ticks" — is untouched by any of this.
 *
 * Draws no randomness (P43, H21) — every term is a deterministic function of the observation, which
 * is also what keeps the score smooth enough not to chatter. There is no `rng` parameter here on
 * purpose: every layer must draw the same number of `rng()` calls regardless of which branch it
 * takes, or one seed stops replaying and the balance harness's paired runs stop being comparable.
 */
export function plan(args: PlanArgs): PlanResult {
  // R-P6 (fix round 1, 2026-09-06): floor at ONE tick, never zero. Spec P29 promises a K=0 "reflex
  // agent" still avoids a wall it is about to hit; a segment of 0 rolls nothing at all, so every
  // one of the nine candidates would end at the identical current pose, score identically, and
  // let the ALL_ACTIONS tie-break silently decide easy's action on every tick regardless of the
  // world -- which cannot avoid anything. Rolling exactly one tick out is "one tick out", the
  // amateur tier P29 actually describes.
  const segment = Math.max(1, Math.floor(args.horizonTicks / args.depth));
  // R-P7c: plan from where the bot will be when this input LANDS. `actuationDelayTicks` of the
  // action already in the delay line, rolled through the same drive model, then every candidate
  // branches off THAT pose. See `PlanArgs.actuationDelayTicks` for why dead time is not optional.
  // CAPPED BY THE HORIZON, and that cap is a tier statement, not a guard. A bot cannot compensate
  // for more dead time than it plans through: P29's reflex agent (K=0) acts on what it sees, and
  // projecting its own hands nine ticks into the future would make it the opposite of a reflex.
  // Measured: uncapped, easy stopped closing on a visible target entirely (tiers.test.ts's S13,
  // 0 throttle-forward ticks in the late window against a bar of 15) because a nine-tick shared
  // roll swamped the one tick its candidates actually differ over. Capped, the ladder reads the way
  // the tiers already read — hard plans 22 and compensates all 4 of its ticks, medium plans 8 and
  // compensates all 6, easy plans one tick and compensates none.
  const lag = Math.max(0, Math.min(Math.floor(args.actuationDelayTicks), args.horizonTicks));
  const now = bodyFromSelf(args.self);
  const start = lag > 0 && args.lastAction
    ? rollForward(now, args.self.carId, args.lastAction, lag, NEUTRAL_MODIFIERS).at(-1) ?? now
    : now;
  const candidates = rollCandidates(args, segment, start);
  const pathTicks = segment * args.depth;

  /**
   * Everything that does not depend on WHERE THE BOT ENDS UP is hoisted out of the per-candidate
   * loop — once per SAMPLE POINT rather than once per plan now, because the target's pose, the
   * hedged threat headings and the set of loaded slots all move as the horizon runs. Every
   * candidate shares the same sample ticks, so this is still `samples x 1` work against
   * `samples x candidates` scoring, and it is most of what keeps a plan inside its budget.
   */
  const sampleTicks = sampleTicksFor(pathTicks);
  const constants: SharedConstants = {
    /**
     * `lockKeep` is scored across EVERY assisted slot, ready or not. A lock is a property of the
     * car and survives the weapon that uses it going on cooldown; counting it only while `predator`
     * is loaded would make the bot's whole positioning flip on a 1000 ms timer, which is exactly
     * the chatter `commitPenalty` exists to fight.
     */
    assisted: args.self.slots
      .map((slot) => weaponDefOf(slot.weaponId))
      .filter((def) => def.usesAimAssist),
    lockRange: carAimRangeOf(args.self.carId),
    holdsLock: args.target !== undefined
      && args.self.lockTargetSessionId === args.target.sessionId,
  };
  const samples: SampleTerms[] = sampleTicks.map((pathTick) => {
    // Ticks from NOW, which is the path tick plus the dead time spent getting to the plan's start.
    const elapsed = pathTick + lag;
    const future = args.targetAt(elapsed);
    return {
      elapsed,
      future,
      /**
       * `targetAt` re-based on the END of the rollout, for `interceptTicks` (R-P5). That solver
       * takes its `at` as ticks-from-NOW, and the shot leaves when the bot arrives, so every query
       * has to be shifted by the horizon already spent getting there.
       */
      fromArrival: (ticksAhead) => args.targetAt(elapsed + ticksAhead),
      threats: hedgedThreats(args, future, elapsed),
      /**
       * Loaded AT ARRIVAL, not loaded now (R-P7b, fix round 1). `slotIsReady(slot, args.tick)`
       * asked whether a gun is loaded at the instant the plan is made while `myEv` scores a pose
       * reached up to 22 ticks later, so a weapon that comes off cooldown two ticks into the arc
       * contributed exactly nothing to the arc's value. Sampling the trajectory makes that worse,
       * not better — the late samples are precisely the ones a recharging gun belongs in.
       */
      ready: args.self.slots
        .filter((slot) => slotIsReady(slot, args.tick + elapsed))
        .map((slot) => ({ slot, def: weaponDefOf(slot.weaponId) })),
    };
  });

  const away = threatAvoidDirections(args.shotThreats);
  // Displacement is measured from the plan's OWN start pose, so the term scores what this decision
  // buys rather than crediting a candidate with metres the last one already covered.
  const origin = { x: start.x, y: start.y };
  const scored = candidates.map((candidate) => {
    const terms = scoreCandidate(args, candidate.path, sampleTicks, samples, constants, away, origin);
    return { first: candidate.first, terms, score: rawScore(terms, args.weights) };
  });

  /**
   * R-P4: `commitPenalty` is a fraction of the candidate score SPREAD, not a raw addend.
   *
   * The shipped values are 0.1 / 0.25 / 0.4 while `myEv` alone runs into the tens, so added raw the
   * knob would be inert at every tier the game actually plays and only an absurd test value would
   * ever move a decision. Scaled by the spread it reads as what it is meant to be: "how much better
   * must a new option be, as a fraction of the whole range of options in front of me, before I
   * switch" — scale-free, and the same idiom `minShotValueFraction` already established for the
   * firing gate. A dead-flat field of candidates (spread 0) gives a bonus of 0, which is correct:
   * there is nothing to be tempted away by, so there is nothing to resist.
   */
  let minScore = Infinity;
  let maxScore = -Infinity;
  for (const entry of scored) {
    if (entry.score < minScore) minScore = entry.score;
    if (entry.score > maxScore) maxScore = entry.score;
  }
  const bonus = scored.length === 0 ? 0 : args.commitPenalty * (maxScore - minScore);

  const adjust = (entry: { first: DriveAction; score: number }): number =>
    entry.score + (sameAction(entry.first, args.lastAction) ? bonus : 0);

  let best: (typeof scored)[number] | undefined;
  let bestScore = -Infinity;
  for (const entry of scored) {
    const adjusted = adjust(entry);
    // Strictly greater, so an exact tie keeps the earlier candidate — see `ALL_ACTIONS`.
    if (adjusted > bestScore) {
      best = entry;
      bestScore = adjusted;
    }
  }

  if (!best) {
    return {
      action: ALL_ACTIONS[0]!,
      score: 0,
      terms: { myEv: 0, theirEv: 0, rangeError: 0, wallPenalty: 0, lockKeep: 0, threatAvoid: 0 },
      runnerUp: undefined,
    };
  }
  // A second pass rather than bookkeeping inside the first: the runner-up is the best candidate
  // that would EMIT SOMETHING ELSE, and which sequences qualify is not known until the winner is.
  const chosen = best;
  let runnerUp: DriveAction | undefined;
  let runnerUpScore = -Infinity;
  for (const entry of scored) {
    if (sameAction(entry.first, chosen.first)) continue;
    const adjusted = adjust(entry);
    if (adjusted > runnerUpScore) {
      runnerUpScore = adjusted;
      runnerUp = entry.first;
    }
  }
  return { action: chosen.first, score: bestScore, terms: chosen.terms, runnerUp };
}

function sameAction(a: DriveAction, b: DriveAction | undefined): boolean {
  return b !== undefined && a.steer === b.steer && a.throttle === b.throttle;
}

/**
 * Roll every candidate action sequence through the REAL drive model and keep the pose it ends in.
 *
 * FIRST-SEGMENT SHARING: at depth 2 the 81 sequences share only nine distinct first segments, so
 * each is rolled once and reused by the nine sequences that begin with it — 90 segment rollouts
 * instead of 162, which is 44% of the drive integration deleted for free.
 *
 * `NEUTRAL_MODIFIERS`, NEVER `OBSERVATION_MODIFIERS` (R-D3). `predict.ts`'s observation set zeroes
 * `accel` and `brakeDecel` so that rolling a car the bot can only LOOK at holds the speed it was
 * seen at. This is the bot's own car under a throttle it is choosing, where acceleration is the
 * entire content of the decision: rolled under that set every candidate would coast at its current
 * speed and the throttle axis would do nothing at all. `rollForward`'s `mods` parameter has no
 * default precisely so this choice is made explicitly at every call site — do not add one back.
 *
 * `segment` is always at least 1 here (R-P6: `plan` floors it before calling in), so every
 * candidate genuinely rolls — there is no zero-tick "stand still" case to special-case.
 */
function rollCandidates(args: PlanArgs, segment: number, start: SimBody): Candidate[] {
  const roll = (from: SimBody, action: DriveAction): SimBody[] =>
    rollForward(from, args.self.carId, action, segment, NEUTRAL_MODIFIERS);

  const firstPaths = ALL_ACTIONS.map((action) => roll(start, action));
  if (args.depth === 1) {
    return ALL_ACTIONS.map((first, i) => ({ first, path: firstPaths[i]! }));
  }

  const out: Candidate[] = [];
  for (let i = 0; i < ALL_ACTIONS.length; i++) {
    const first = ALL_ACTIONS[i]!;
    const head = firstPaths[i]!;
    const from = head.at(-1) ?? start;
    for (const second of ALL_ACTIONS) out.push({ first, path: [...head, ...roll(from, second)] });
  }
  return out;
}

/**
 * Which ticks along a `pathTicks`-long rollout the score is read at (R-P7).
 *
 * Ticks, one-based, ascending, and the LAST ENTRY IS ALWAYS `pathTicks` — no term is read at the
 * terminus any more (R-P7 revised, round 2), but the far end of the arc is where a candidate commits
 * the bot, so dropping it would let an arc that sweeps beautifully and then buries itself in a wall
 * score as clean.
 *
 * GEOMETRICALLY SPACED, not evenly, and that is load-bearing rather than a refinement. Measured: an
 * evenly-spaced schedule at hard's K=22 reads ticks 6, 11, 17, 22, and the sweep it exists to catch
 * is OVER by tick 6 — a Bullseye at rest turns ~0.9 rad in six ticks against the 0.25 rad
 * correction the duel actually wanted, so all four samples see the nose already past and the bot
 * fires 0 shots in 300 ticks exactly as it did reading the terminus alone. Even spacing needs about
 * eleven samples to catch it, which is three times the whole CPU budget. Geometric spacing reads
 * ticks 2, 5, 10, 22 for the same money and lands inside the sweep.
 *
 * The reason it is the right shape, rather than a lucky one: this is a RECEDING horizon. Only the
 * first action is emitted and the whole plan is redone `recomputeTicks` later (2 ticks at hard), so
 * the near end of an arc is what the bot actually executes and the far end is a guide to where that
 * commits it. Resolving the near end finely and the far end coarsely is what that asymmetry asks
 * for, and it is the standard non-uniform discretization of a receding-horizon control problem.
 *
 * A path shorter than the sample count is sampled at EVERY tick — there is nothing to skip, and
 * asking for four samples of a two-tick roll must not produce duplicates that pay for the same
 * pose twice.
 */
function sampleTicksFor(pathTicks: number): number[] {
  const count = BRAIN_CONSTANTS.trajectorySampleCount;
  if (pathTicks <= count) {
    return Array.from({ length: pathTicks }, (_, i) => i + 1);
  }
  const out: number[] = [];
  for (let i = 1; i <= count; i++) {
    const tick = i === count
      ? pathTicks
      : Math.max(1, Math.round(pathTicks ** (i / count)));
    if (out.length === 0 || tick > out[out.length - 1]!) out.push(tick);
  }
  return out;
}

/**
 * The unit vectors a shot in the air wants this bot pushed along (P40, R-P8).
 *
 * Resolved once per plan, not per candidate: only the DISPLACEMENT varies across candidates.
 */
function threatAvoidDirections(
  shotThreats: readonly { awayHeadingRad: number }[],
): readonly { x: number; y: number }[] {
  return shotThreats.map((threat) => ({
    x: Math.cos(threat.awayHeadingRad),
    y: Math.sin(threat.awayHeadingRad),
  }));
}

/**
 * The target's plausible headings at the end of the horizon (P28): the observed one, and — when the
 * tier hedges — a hard left and a hard right off it. A skilled bot does not assume the opponent
 * holds still while it manoeuvres.
 *
 * The offset is DERIVED from the target's own chassis: full lock for as long as the plan commits
 * (`turnRateOf * elapsed`), capped by `BRAIN_CONSTANTS.targetBranchMaxHeadingOffsetRad`. The
 * POSITION is not branched — only the heading. Danger is dominated by where their guns point, the
 * pose half is already carried by `targetAt`'s physics rollout, and branching position too would
 * triple this list into nine.
 */
function hedgedThreats(
  args: PlanArgs,
  future: { x: number; y: number; angle: number },
  elapsed: number,
): BotCarView[] {
  const { target } = args;
  if (!target) return [];
  const nominal: BotCarView = { ...target, x: future.x, y: future.y, angle: future.angle };
  if (args.targetBranches === 1) return [nominal];
  const offset = Math.min(
    BRAIN_CONSTANTS.targetBranchMaxHeadingOffsetRad,
    turnRateOf(target.carId) * (elapsed / TICK_RATE_HZ),
  );
  return [
    nominal,
    { ...nominal, angle: future.angle + offset },
    { ...nominal, angle: future.angle - offset },
  ];
}

/**
 * Everything that is the same for all candidates AT ONE SAMPLE POINT, resolved once per sample.
 * Not an optimization detail so much as a statement of what the search actually varies: only where
 * the bot is, at each moment along its arc.
 */
interface SampleTerms {
  /** Ticks from now, one-based — the index into a candidate path is `elapsed - 1`. */
  elapsed: number;
  future: { x: number; y: number; angle: number };
  fromArrival: PosePredictor;
  threats: readonly BotCarView[];
  /** Slots that would be loaded at THIS moment, with their rows already resolved. */
  ready: readonly { slot: BotSlotView; def: WeaponDef }[];
}

/** The parts that do not move with the horizon either: a property of the car, not of a moment. */
interface SharedConstants {
  /** Every aim-assisted row this car carries, ready or not — see `lockKeep`. */
  assisted: readonly WeaponDef[];
  /** The CAR's acquisition range: `carAimRangeOf`, exactly as `updateLock` reads it. */
  lockRange: number;
  holdsLock: boolean;
}

/**
 * Every term, aggregated over the sample points of one candidate's ARC (R-P7).
 *
 * See `plan`'s doc for why the terminus alone is not enough and for which direction each term
 * aggregates in. The short version: what the bot is looking for is a moment, not a destination.
 *
 * R-P3: there is NO early return for a missing target. `wallPenalty` and `rangeError` are always
 * computed — `rangeError` against `targetAt(pathTicks)`, which the caller points at a hunt waypoint
 * when there is nobody to fight — and only the genuinely target-shaped terms are zeroed. A shortcut
 * here is what would force the hunt behaviours into a second, parallel mover.
 */
function scoreCandidate(
  args: PlanArgs,
  path: readonly SimBody[],
  sampleTicks: readonly number[],
  samples: readonly SampleTerms[],
  constants: SharedConstants,
  away: readonly { x: number; y: number }[],
  origin: { x: number; y: number },
): Record<keyof PlanWeights, number> {
  const { lockRange, holdsLock } = constants;
  const last = sampleTicks.length - 1;

  let myEv = 0;
  let theirEv = 0;
  let wallPenalty = 0;
  let lockKeep = 0;
  // Minimised and maximised respectively, so both start at the neutral end of their own scale and
  // are floored back to 0 below if the loop somehow runs zero times. `plan` guarantees at least one
  // sample (`segment` is floored at 1), so that floor is belt-and-braces, not a live case.
  let rangeError = Infinity;
  let threatAvoid = -Infinity;

  for (let i = 0; i <= last; i++) {
    const body = path[sampleTicks[i]! - 1]!;
    const sample = samples[i]!;
    const { future } = sample;

    const wall = boundsPenalty(body.x, body.y, args.arena);
    if (wall > wallPenalty) wallPenalty = wall;

    // BEST ANYWHERE ALONG THE ARC, not at the terminus (R-P7 revised, fix round 2, 2026-09-06).
    // "Does this arc carry me through my preferred range" is the question a receding horizon
    // actually executes on; "does it park me there" is not, because the plan is redone every
    // `recomputeTicks` and the terminal pose is never reached. Read at the end alone, full throttle
    // for 22 ticks overshoots a 56-unit correction by ~130 units and scores worse than coasting, so
    // the bot parks — the same defect trajectory scoring had already cured on the steer axis.
    const error = Math.abs(
      Math.hypot(future.x - body.x, future.y - body.y) - args.preferredRange,
    );
    if (error < rangeError) rangeError = error;

    // Likewise the best moment, not the last one: getting off the line for the instant the bolt
    // passes is the whole content of a dodge, and where the excursion finishes is not.
    const avoid = threatAvoidOf(origin, body, away);
    if (avoid > threatAvoid) threatAvoid = avoid;

    if (!args.target) continue;

    let sampleEv = 0;
    for (const { slot, def } of sample.ready) {
      const assisted = withinLockEnvelope(body, future, def, lockRange, holdsLock);
      /**
       * R-P5: aim at where the target will be when the SHOT lands, not when the BOT arrives.
       *
       * `future` is the target's pose at THIS sample — the moment the bot is here and could pull
       * the trigger. It carries no flight lead whatsoever, so scoring the proxy against it would
       * point the nose systematically short of a moving target and undo phase A's whole point.
       * `interceptTicks` solves the flight time from this pose, per slot because a 600 u/s shell
       * and a 450 u/s one need visibly different leads, against the arrival-shifted predictor and
       * bounded by the same horizon a firing solution rolls.
       *
       * An ASSISTED slot is deliberately scored at the UNLED pose: the sim's `aimAngleFor` points
       * the shot at where the target IS, with no lead at all (`AIM_CONFIG.lockRange`'s doc
       * comment), so leading it here would score a shot the game will not fire.
       */
      let aimX = future.x;
      let aimY = future.y;
      if (!assisted) {
        const lead = interceptTicks(
          body, sample.fromArrival, projectileSpeedOf(def), BRAIN_CONSTANTS.predictionHorizonTicks,
        );
        const led = sample.fromArrival(lead);
        aimX = led.x;
        aimY = led.y;
      }
      const value = proxyValue({
        shooter: { x: body.x, y: body.y, angle: body.angle },
        slot, targetX: aimX, targetY: aimY,
        aimSigmaRad: args.aimSigmaRad, assisted,
      });
      if (value > sampleEv) sampleEv = value;
    }
    if (sampleEv > myEv) myEv = sampleEv;

    if (lockKeep === 0) {
      for (const def of constants.assisted) {
        if (withinLockEnvelope(body, future, def, lockRange, holdsLock)) {
          lockKeep = 1;
          break;
        }
      }
    }

    const danger = worstCaseDanger(args, body, sample.threats);
    if (danger > theirEv) theirEv = danger;
  }

  return {
    myEv,
    theirEv,
    rangeError: Number.isFinite(rangeError) ? rangeError : 0,
    wallPenalty,
    lockKeep,
    threatAvoid: Number.isFinite(threatAvoid) ? threatAvoid : 0,
  };
}

/**
 * How far this pose along the arc has moved from the plan's start along the "get out of the way"
 * directions of every shot currently in the air, in world units (P40, R-P8).
 *
 * SUMMED across threats, deliberately, which is a vector sum of the away directions applied to one
 * displacement: two shots crossing from opposite sides cancel to roughly zero, and that is right —
 * there is nowhere to go, so the term stops arguing and lets the other five decide. Reading only
 * the nearest threat (which the deleted desire model did) would instead sidestep confidently into
 * the second one.
 *
 * A couple of flops per threat per candidate, and exactly zero when nothing is in the air.
 */
function threatAvoidOf(
  origin: { x: number; y: number },
  at: { x: number; y: number },
  away: readonly { x: number; y: number }[],
): number {
  if (away.length === 0) return 0;
  const dx = at.x - origin.x;
  const dy = at.y - origin.y;
  let total = 0;
  for (const dir of away) total += dx * dir.x + dy * dir.y;
  return total;
}

function rawScore(terms: Record<keyof PlanWeights, number>, weights: PlanWeights): number {
  return terms.myEv * weights.myEv
    - terms.theirEv * weights.theirEv
    - terms.rangeError * weights.rangeError
    - terms.wallPenalty * weights.wallPenalty
    + terms.lockKeep * weights.lockKeep
    + terms.threatAvoid * weights.threatAvoid;
}

/** How fast this weapon's shot travels. A maneuver authors no shot, so it leads by nothing. */
function projectileSpeedOf(def: WeaponDef): number {
  return def.kind === "maneuver" ? 0 : def.speed;
}

/** How badly this pose is jammed against the world. Squared, so a corner dominates an edge. */
function boundsPenalty(x: number, y: number, arena: BotArenaView): number {
  const margin = Math.max(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);
  const over = (v: number) => (v < margin ? (margin - v) / margin : 0);
  const penalties = [over(x), over(y), over(arena.width - x), over(arena.height - y)];
  let total = 0;
  for (const p of penalties) total += p * p;
  for (const box of arena.obstacles) {
    if (x > box.x - margin && x < box.x + box.w + margin
      && y > box.y - margin && y < box.y + box.h + margin) total += 1;
  }
  return total;
}

/**
 * Would an aim-assisted weapon actually be pointed by a lock from this pose (P13, R-P2)?
 *
 * THE REAL LOCK RULES, not the weapon's reach. An earlier draft compared the distance against
 * `weaponReachOf`, which for `predator` is 800 units of aim range and admits a target sitting 90
 * degrees off the nose — the assist would never fire there, so `lockKeep` would have rewarded poses
 * that keep nothing and the term that names the mechanism would have been measuring something else.
 *
 * What the sim does, mirrored here in both halves:
 *
 * - `updateLock` (`sim/weapons/lock.ts`) admits a target through `inAcquireRegion` — cone AND
 *   lateral cap AND range, all three — against the CAR's `carAimRangeOf`, the longest-reaching
 *   assisted weapon it carries. A lock already held is instead tested against `inRetainRegion`, the
 *   same region widened by every retention pad, which is why the incumbent case is checked here
 *   too: hysteresis is the difference between holding a lock and re-earning it every tick.
 * - `aimAngleFor` (`sim/combat.ts`) then gates the assist PER WEAPON on `def.aimRangeUnits`: a lock
 *   the car holds through a longer gun may still be out of this one's reach, and then this weapon
 *   fires straight ahead like any other.
 *
 * The angle is computed from the car CENTRE, matching `signedAngleDegTo`, and the sim's
 * degrees-and-normalise convention is reproduced through `signedDelta` rather than by reaching for
 * `LockOwner`, which wants a `sessionId` and a `team` a candidate pose does not have.
 */
function withinLockEnvelope(
  body: { x: number; y: number; angle: number },
  target: { x: number; y: number },
  def: WeaponDef,
  lockRangeUnits: number,
  holdsLock: boolean,
): boolean {
  if (!def.usesAimAssist) return false;
  const dx = target.x - body.x;
  const dy = target.y - body.y;
  const distance = Math.hypot(dx, dy);
  if (distance > (def.aimRangeUnits ?? 0)) return false;
  const angleDeg = signedDelta(body.angle, Math.atan2(dy, dx)) * DEG_PER_RAD;
  return holdsLock
    ? inRetainRegion(angleDeg, distance, lockRangeUnits)
    : inAcquireRegion(angleDeg, distance, lockRangeUnits);
}

/**
 * How much damage per second this candidate pose would be standing in front of, worst case over the
 * target's hedged headings (P26, P28).
 *
 * R-P1: THE PROXY, not the exact solver. Spec P9 and P26 both say `theirEV` comes from "the proxy
 * solver, swapped", and the arithmetic is why: `dangerEvAgainst` runs the real `solve()`, roughly
 * 90 marched shape tests per weapon, so a depth-2 plan would pay 81 sequences x 3 branches x 3
 * weapons = 729 exact solutions per plan against a budget of a third of a millisecond. The exact
 * solver stays where it belongs — on the trigger, where a wrong answer costs a wasted press rather
 * than a slightly worse parking spot.
 */
function worstCaseDanger(
  args: PlanArgs,
  body: { x: number; y: number },
  threats: readonly BotCarView[],
): number {
  let worst = 0;
  for (const threat of threats) {
    const danger = proxyDangerAgainst({
      threat,
      meX: body.x,
      meY: body.y,
      readiness: args.readiness,
      assumedAimSigmaRad: BRAIN_CONSTANTS.assumedOpponentAimSigmaRad,
    });
    if (danger > worst) worst = danger;
  }
  return worst;
}
