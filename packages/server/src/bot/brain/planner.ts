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
  tick: number;
  arena: BotArenaView;
}

/** One rolled-out candidate: the input that would be emitted, and the pose it ends in. */
interface Candidate {
  first: DriveAction;
  end: SimBody;
}

/**
 * Choose this tick's input by looking ahead (P24).
 *
 * Receding horizon: every candidate is rolled K ticks, but only the winner's FIRST action is
 * emitted, and the whole thing is redone on the next recompute. That is what lets a bot plan a
 * second-long arc while still reacting inside two ticks.
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
  const candidates = rollCandidates(args, segment);
  const elapsed = segment * args.depth;

  // Everything below this line that does not depend on WHERE THE BOT ENDS UP is hoisted out of the
  // per-candidate loop: the target's pose at `elapsed`, the shifted predictor a lead is solved
  // against, the hedged threat views, and the list of slots that could fire. All 81 candidates
  // share them, so computing them once is most of what keeps a depth-2 plan inside its budget.
  const future = args.targetAt(elapsed);
  /**
   * `targetAt` re-based on the END of the rollout, for `interceptTicks` (R-P5). That solver takes
   * its `at` as ticks-from-NOW, and the shot leaves when the bot arrives, so every query has to be
   * shifted by the horizon already spent getting there.
   */
  const fromArrival: PosePredictor = (ticksAhead) => args.targetAt(elapsed + ticksAhead);
  const threats = hedgedThreats(args, future, elapsed);
  const shared: SharedTerms = {
    future,
    fromArrival,
    threats,
    ready: args.self.slots
      .filter((slot) => slotIsReady(slot, args.tick))
      .map((slot) => ({ slot, def: weaponDefOf(slot.weaponId) })),
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

  const scored = candidates.map((candidate) => {
    const terms = scoreCandidate(args, candidate.end, shared);
    return { first: candidate.first, terms, score: rawScore(terms, args.weights) };
  });

  /**
   * R-P4: `commitPenalty` is a fraction of the candidate score SPREAD, not a raw addend.
   *
   * The shipped values are 0.1 / 0.4 / 0.8 while `myEv` alone runs into the tens, so added raw the
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
      terms: { myEv: 0, theirEv: 0, rangeError: 0, wallPenalty: 0, lockKeep: 0 },
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
function rollCandidates(args: PlanArgs, segment: number): Candidate[] {
  const start = bodyFromSelf(args.self);
  const roll = (from: SimBody, action: DriveAction): SimBody =>
    rollForward(from, args.self.carId, action, segment, NEUTRAL_MODIFIERS).at(-1) ?? from;

  const firstEnds = ALL_ACTIONS.map((action) => roll(start, action));
  if (args.depth === 1) {
    return ALL_ACTIONS.map((first, i) => ({ first, end: firstEnds[i]! }));
  }

  const out: Candidate[] = [];
  for (let i = 0; i < ALL_ACTIONS.length; i++) {
    const first = ALL_ACTIONS[i]!;
    for (const second of ALL_ACTIONS) out.push({ first, end: roll(firstEnds[i]!, second) });
  }
  return out;
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
 * Everything that is the same for all 81 candidates, resolved once. Not an optimization detail so
 * much as a statement of what the search actually varies: only where the bot ends up.
 */
interface SharedTerms {
  future: { x: number; y: number; angle: number };
  fromArrival: PosePredictor;
  threats: readonly BotCarView[];
  /** Slots that could be pressed on arrival, with their rows already resolved. */
  ready: readonly { slot: BotSlotView; def: WeaponDef }[];
  /** Every aim-assisted row this car carries, ready or not — see `lockKeep` below. */
  assisted: readonly WeaponDef[];
  /** The CAR's acquisition range: `carAimRangeOf`, exactly as `updateLock` reads it. */
  lockRange: number;
  holdsLock: boolean;
}

/**
 * Every term, measured at the pose one candidate ends in.
 *
 * R-P3: there is NO early return for a missing target. `wallPenalty` and `rangeError` are always
 * computed — `rangeError` against `targetAt(elapsed)`, which the caller points at a hunt waypoint
 * when there is nobody to fight — and only the three genuinely target-shaped terms are zeroed. A
 * shortcut here is what would force the hunt behaviours into a second, parallel mover.
 */
function scoreCandidate(
  args: PlanArgs,
  body: SimBody,
  shared: SharedTerms,
): Record<keyof PlanWeights, number> {
  const { future } = shared;
  const wallPenalty = boundsPenalty(body.x, body.y, args.arena);
  const distance = Math.hypot(future.x - body.x, future.y - body.y);
  const rangeError = Math.abs(distance - args.preferredRange);

  if (!args.target) {
    return { myEv: 0, theirEv: 0, rangeError, wallPenalty, lockKeep: 0 };
  }

  const { lockRange, holdsLock } = shared;

  let myEv = 0;
  for (const { slot, def } of shared.ready) {
    const assisted = withinLockEnvelope(body, future, def, lockRange, holdsLock);
    /**
     * R-P5: aim at where the target will be when the SHOT lands, not when the BOT arrives.
     *
     * `future` is the target's pose at the end of the rollout — the moment the bot gets there and
     * could pull the trigger. It carries no flight lead whatsoever, so scoring the proxy against it
     * would point the nose systematically short of a moving target and undo phase A's whole point.
     * `interceptTicks` solves the flight time from THIS candidate's end pose, per slot because a
     * 600 u/s shell and a 450 u/s one need visibly different leads, against the arrival-shifted
     * predictor and bounded by the same horizon a firing solution rolls.
     *
     * An ASSISTED slot is deliberately scored at the UNLED pose: the sim's `aimAngleFor` points the
     * shot at where the target IS, with no lead at all (`AIM_CONFIG.lockRange`'s doc comment), so
     * leading it here would score a shot the game will not fire.
     */
    let aimX = future.x;
    let aimY = future.y;
    if (!assisted) {
      const lead = interceptTicks(
        body, shared.fromArrival, projectileSpeedOf(def), BRAIN_CONSTANTS.predictionHorizonTicks,
      );
      const led = shared.fromArrival(lead);
      aimX = led.x;
      aimY = led.y;
    }
    const value = proxyValue({
      shooter: { x: body.x, y: body.y, angle: body.angle },
      slot, targetX: aimX, targetY: aimY,
      aimSigmaRad: args.aimSigmaRad, assisted,
    });
    if (value > myEv) myEv = value;
  }

  let lockKeep = 0;
  for (const def of shared.assisted) {
    if (withinLockEnvelope(body, future, def, lockRange, holdsLock)) {
      lockKeep = 1;
      break;
    }
  }

  return {
    myEv,
    theirEv: worstCaseDanger(args, body, shared.threats),
    rangeError,
    wallPenalty,
    lockKeep,
  };
}

function rawScore(terms: Record<keyof PlanWeights, number>, weights: PlanWeights): number {
  return terms.myEv * weights.myEv
    - terms.theirEv * weights.theirEv
    - terms.rangeError * weights.rangeError
    - terms.wallPenalty * weights.wallPenalty
    + terms.lockKeep * weights.lockKeep;
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
