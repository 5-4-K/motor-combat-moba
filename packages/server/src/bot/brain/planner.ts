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
  /**
   * How many committed windows a candidate contains (P25). 1 is "commit, then coast"; 2 is
   * "commit, commit again, then coast", 81 sequences sharing nine first windows.
   */
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
  /**
   * THE INPUTS ALREADY IN FLIGHT — `humanize.ts`'s delay line, oldest first, exactly the actions
   * the wheels will see over the next `actuationDelayTicks` ticks (R-P10b, fix round 4,
   * 2026-09-07). Empty when nothing has been decided yet, which is a real case on the first ticks
   * of a match.
   *
   * This replaces "roll `lastAction` for the whole dead time", and it is not a refinement: it is
   * the defect R-P10 exposed. A hard bot re-decides every 2 ticks and its delay line is 4 ticks
   * long, so the queue holds TWO different decisions. Rolling the newest one across all four ticks
   * DOUBLES the correction the planner believes is already committed, so a bot sitting 0.05 rad off
   * its target plans as though it were about to be 0.47 rad past it and commands the opposite lock.
   * Next window it does the same thing in the other direction: a period-4 limit cycle, measured in
   * the off-axis duel as a steer stream of `-1 -1 +1 +1` forever with the heading swinging ±0.28
   * rad and the bot only on-line for a third of its ticks. Under the old 22-tick candidates the
   * cycle was invisible because there was no small correction to overshoot with — `steer: 0` won
   * every tick — so this became load-bearing on the same day the action space got fine enough to
   * use. Rolling the real queue removes the cycle outright: measured, the same duel holds -0.02 rad
   * with `steer: 0` and fires on half its ticks.
   */
  pending: readonly DriveAction[];
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
 * Receding horizon: every candidate is rolled out to the end of the K-tick horizon, but only the
 * winner's FIRST action is emitted, and the whole thing is redone on the next recompute. That is
 * what lets a bot plan a second-long arc while still reacting inside two ticks.
 *
 * A CANDIDATE IS THE COMMITMENT THE BOT ACTUALLY MAKES, NOT A 22-TICK HOLD IT NEVER PERFORMS
 * (R-P10, fix round 4, 2026-09-07). Three rounds of scoring experiments established that the
 * missing quantity was never in the score: the action held for the commitment window and then a
 * neutral continuation is what `rollCandidates` builds now, and `PlanArgs.commitTicks` and
 * `CONTINUATION` carry the argument and the measurements. Everything below about which term is
 * read where is unchanged from round 3 and still holds; what changed is what a candidate IS.
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
 * FOUR OF THE SIX TERMS ARE MOMENTS; `rangeError` AND `threatAvoid` ARE DESTINATIONS AND ARE READ
 * AT THE TERMINUS (R-P7 third revision, fix round 3; `threatAvoid` joined them under R-P11, fix
 * round 4, 2026-09-07):
 *
 * - `myEv` — the BEST found anywhere along the path. That is the sweep.
 * - `lockKeep` — the BEST along the path, for the same reason.
 * - `threatAvoid` — AT THE TERMINUS (R-P11). Displacement along a threat's `awayHeadingRad` asks
 *   "am I out of the line", which is a destination: a maximum over the arc rewards an arc that
 *   steps aside and then drifts straight back, because the moment it was clear is banked and the
 *   return costs nothing. Round 3's ablation also attributed `balance/match.test.ts`'s seed-96
 *   failure to the arc reading and measured that file 11 / 11 green with this term at the terminus.
 * - `theirEv` — the WORST (maximum danger). An arc that carries you through someone's line is
 *   dangerous even if it ends somewhere safe.
 * - `wallPenalty` — the WORST. Clipping a wall mid-arc is a real cost, not an artifact.
 * - `rangeError` — AT THE TERMINUS. It is not a moment. It is the only term that says GO SOMEWHERE,
 *   and in a targetless plan it is the ENTIRE objective: `waitOut` hands the planner a synthetic
 *   hunt waypoint and a `preferredRange` of 0, and every other term is identically zero there. A
 *   navigation objective must be able to say "turn around and drive 500 units", and that is a claim
 *   about where an arc ENDS which cannot be made about any moment along it.
 *
 * THREE READINGS HAVE NOW BEEN TRIED AND THE OTHER TWO ARE RECORDED HERE, because each will look
 * tempting again. Round 2 moved `rangeError` to the SMALLEST error along the path; round 3 was asked
 * to move it to the FIRST sample — the servo window a throttle decision is really committed over —
 * with a path MEAN as the sanctioned fallback. All four readings were measured on the two
 * closed-loop duels in `controller.test.ts` over SEVEN seeds (a duel passes only if it clears BOTH
 * `fires > 90` and `meanOffset < 0.2`), and on the whole `src/bot/` + `src/config/` suite:
 *
 * | `rangeError` read at | on-axis duel | off-axis duel | suite failures |
 * |---|---|---|---|
 * | terminus (SHIPPED)  | 4 / 7 seeds | 6 / 7 seeds | 3 |
 * | min along the path  | 6 / 7 seeds | 0 / 7 seeds | 4, plus a balance fixture |
 * | mean along the path | 4 / 7 seeds | 1 / 7 seeds | 6 |
 * | first sample        | 4 / 7 seeds | 1 / 7 seeds | 8 |
 *
 * The first-sample reading is myopic in exactly the way the hunt punishes. Over the two ticks a
 * throttle is actually committed for, REVERSING at a waypoint that sits behind the bot closes the
 * gap faster than turning around does, so both of `controller.test.ts`'s G12 hunt tests flip to
 * `throttle: -1`. The long horizon is what makes a bot turn around instead of reversing, and the
 * range term is the only term that can ask for it. Raising the weight does not rescue it (swept
 * 1x-24x: the duels plateau but the dodge tests go red as the term swamps `threatAvoid`), and
 * neither does mixing the two readings (swept at 10-60% terminus: strictly worse than either
 * endpoint at every seed, because two competing minima make the term oscillate).
 *
 * WHAT THE TERMINUS USED TO COST, AND WHY THAT IS SETTLED NOW. Under round 3's candidate set — one
 * input held for the whole horizon — the terminus reading left the on-axis duel firing 24 times per
 * 300 ticks against a bar of 90: the bot aimed perfectly (0.000 rad) but, once a `panic-reverse`
 * blunder had shoved it from 508 units out to 586 against a preferred 530, no candidate closed the
 * gap, because an input held for 22 ticks TERMINATES ~190 units along and the closing arc's
 * terminal error (130) read worse than standing still's (56). Every alternative reading fixed one
 * duel by breaking the other, which is what identified the candidate set rather than the score as
 * the fault. R-P10 puts a 56-unit move on the menu and the terminus reading becomes honest: the
 * same duel now fires 134 times and settles at 530-530, without touching a single aggregation.
 *
 * Draws no randomness (P43, H21) — every term is a deterministic function of the observation, which
 * is also what keeps the score smooth enough not to chatter. There is no `rng` parameter here on
 * purpose: every layer must draw the same number of `rng()` calls regardless of which branch it
 * takes, or one seed stops replaying and the balance harness's paired runs stop being comparable.
 */
export function plan(args: PlanArgs): PlanResult {
  // THE COMMITMENT WINDOW: how much of the horizon a candidate genuinely commits to, before the
  // terminal policy coasts it to a stop. `BRAIN_CONSTANTS.commitWindowFraction` of K — just over
  // half, so hard commits 12 of its 22 ticks and coasts the other 10 (R-P12, round 5, 2026-09-07).
  //
  // It is a fraction of the HORIZON, not the profile's `recomputeTicks`, and the grid in that
  // constant's doc comment is why: swept across five windows and three continuations over seven
  // seeds per duel, both ends of the axis fail. A whole-horizon hold (round 3) cannot aim; a
  // `recomputeTicks` hold with a braking tail (round 4) has four units of positional reach and
  // cannot dodge, turn around or leave a wall. Half is the only cell that does both, and it is a
  // plateau at 11-12 ticks with cliffs on either side rather than a lucky point.
  //
  // R-P6 (fix round 1, 2026-09-06) survives inside the floor: at ONE tick, never zero. Spec P29
  // promises a K=0 "reflex agent" still avoids a wall it is about to hit; a window of 0 rolls
  // nothing at all, so every one of the nine candidates would end at the identical current pose,
  // score identically, and let the ALL_ACTIONS tie-break silently decide easy's action on every
  // tick regardless of the world -- which cannot avoid anything. Rolling exactly one tick out is
  // "one tick out", the amateur tier P29 actually describes. The horizon is also the cap: a bot
  // cannot commit for longer than it plans, which is what keeps easy (K=0, `recomputeTicks` 12) a
  // reflex rather than a twelve-tick lunge.
  const K = Math.max(1, Math.floor(args.horizonTicks));
  const commit = Math.max(
    1, Math.min(Math.ceil(K * BRAIN_CONSTANTS.commitWindowFraction), K),
  );
  // Whatever the horizon has left after the committed windows, spent under the continuation. Zero
  // is a normal case (easy plans one tick and commits it), not a degenerate one.
  const tail = Math.max(0, Math.floor(args.horizonTicks) - commit * args.depth);
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
  let start = now;
  // One tick at a time, because the queue is not one action: entry `i` is what the wheels see `i`
  // ticks from now. A queue shorter than the dead time falls back to `lastAction` for the ticks it
  // does not cover, and to standing still if there is no last action either — both only happen in
  // the first few ticks of a match, before the line has filled.
  for (let i = 0; i < lag; i++) {
    const act = args.pending[i] ?? args.lastAction;
    if (!act) break;
    start = rollForward(start, args.self.carId, act, 1, NEUTRAL_MODIFIERS).at(-1) ?? start;
  }
  const candidates = rollCandidates(args, commit, tail, start);
  const pathTicks = commit * args.depth + tail;

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
 * THE TERMINAL POLICY: what a candidate does once its committed window is over (R-P10, fix round
 * 4, 2026-09-07).
 *
 * FULL NEUTRAL — hands off both controls. Under `NEUTRAL_MODIFIERS` a `throttle: 0` continuation
 * genuinely BRAKES: `DRIVE_CONFIG.drag` is 900 u/s², about 0.32 s from top speed to rest, so this
 * models "commit this input, then coast to a stop" and the terminal pose is a place the car can
 * really be left. That is what makes the terminus an honest reading for `rangeError` and
 * `threatAvoid`: it is a destination the bot could actually stop at, not an extrapolation of a
 * 22-tick hold it never performs.
 *
 * THE ALTERNATIVE WAS MEASURED, not assumed. Steer-only neutral — `{steer: 0, throttle: <the
 * candidate's own throttle>}`, i.e. "commit the turn, keep the pedal where it is" — was
 * implemented and run at the otherwise identical final configuration, over seven seeds, on both
 * closed-loop duels (a duel counts as passed only when it clears BOTH `fires > 90` and
 * `meanOffset < 0.2` over the tail 100 ticks):
 *
 * | continuation | on-axis duel | off-axis duel | on-axis at the tests' own seed 17 |
 * |---|---|---|---|
 * | full neutral (SHIPPED) | **6 / 7 seeds** | **7 / 7 seeds** | 134 fires, 0.000 rad, settles 530 |
 * | steer-only neutral     | 4 / 7 seeds     | 6 / 7 seeds     | **24 fires**, 0.000 rad, settles 586 |
 *
 * Steer-only fixes the STEER axis and leaves the THROTTLE axis exactly as broken as it was before
 * R-P10, reproducing round 3's defect verbatim: a candidate that keeps its pedal down still
 * terminates ~190 units along at hard's K=22, so "close the last 56 units" is not on the menu, and
 * the on-axis duel parks at 586 units against a preferred 530 and fires 24 shots per 300 ticks
 * where the bar is 90. Full neutral puts a short move on the menu, and the bot settles at exactly
 * its preferred range.
 *
 * WHAT FULL NEUTRAL COSTS, and it is a LIVE REGRESSION rather than a settled trade. A braking
 * continuation makes the plan's positional REACH tiny: from rest, two ticks of throttle reaches
 * ~25 u/s and coasting from there covers about 1.4 units, so a stationary bot's whole menu spans
 * ~4 units of travel. That is exactly right for "stop at the range I want" and myopic for anything
 * that needs to GO somewhere, and four tests that need it are red as a result — both `G12` hunt
 * cases (the synthetic hunt waypoint sits 70 units away, and reversing 4 units at it beats turning
 * around), `tiers.test.ts`'s two dodge characterisations and `controller.test.ts`'s "still fires
 * while dodging" (a `threatAvoid` displacement of ~4 units cannot outweigh `theirEv`; measured
 * unchanged at threatAvoid weights of 3, 6 and 12, so it is reach and not weight), and H39's wall
 * steer stream. Measured and rejected as fixes: reading `threatAvoid` over the arc instead of at
 * the terminus (identical failures), and giving every action BOTH continuations so the menu spans
 * both reaches — 18 candidates, which took the suite from 7 failures to 8 and lost the off-axis
 * duel as well. The next ruling belongs on the terminal policy's reach, not on the score.
 */
const CONTINUATION: DriveAction = Object.freeze({ steer: 0, throttle: 0 });

/**
 * Roll every candidate through the REAL drive model and keep the WHOLE path it traces.
 *
 * A candidate is `commit` ticks of one action followed by `tail` ticks of `continuationOf` it
 * (R-P10) — the commitment the bot actually makes, then the terminal policy. At depth 2 it is two
 * committed windows and then the tail.
 *
 * FIRST-WINDOW SHARING: at depth 2 the 81 sequences share only nine distinct first windows, so
 * each is rolled once and reused by the nine sequences that begin with it. The tail cannot be
 * shared — it starts from wherever its own candidate left off — but it is rolled under a single
 * action rather than branched, so it costs one `rollForward` per candidate and the search is still
 * exactly nine (or 81) sequences wide. R-P10 is a re-parameterization, not an expansion.
 *
 * `NEUTRAL_MODIFIERS`, NEVER `OBSERVATION_MODIFIERS` (R-D3). `predict.ts`'s observation set zeroes
 * `accel` and `brakeDecel` so that rolling a car the bot can only LOOK at holds the speed it was
 * seen at. This is the bot's own car under a throttle it is choosing, where acceleration is the
 * entire content of the decision: rolled under that set every candidate would coast at its current
 * speed and the throttle axis would do nothing at all — and the continuation's braking, which is
 * what makes the terminal pose a real destination, would not happen either. `rollForward`'s `mods`
 * parameter has no default precisely so this choice is made explicitly at every call site — do not
 * add one back.
 *
 * `commit` is always at least 1 here (R-P6: `plan` floors it before calling in), so every candidate
 * genuinely rolls — there is no zero-tick "stand still" case to special-case.
 */
function rollCandidates(
  args: PlanArgs, commit: number, tail: number, start: SimBody,
): Candidate[] {
  const roll = (from: SimBody, action: DriveAction, ticks: number): SimBody[] =>
    rollForward(from, args.self.carId, action, ticks, NEUTRAL_MODIFIERS);
  const coast = (head: SimBody[]): SimBody[] => {
    if (tail === 0) return head;
    const from = head.at(-1) ?? start;
    return [...head, ...roll(from, CONTINUATION, tail)];
  };

  const firstPaths = ALL_ACTIONS.map((action) => roll(start, action, commit));
  if (args.depth === 1) {
    return ALL_ACTIONS.map((first, i) => ({ first, path: coast(firstPaths[i]!) }));
  }

  const out: Candidate[] = [];
  for (let i = 0; i < ALL_ACTIONS.length; i++) {
    const first = ALL_ACTIONS[i]!;
    const head = firstPaths[i]!;
    const from = head.at(-1) ?? start;
    for (const second of ALL_ACTIONS) {
      out.push({ first, path: coast([...head, ...roll(from, second, commit)]) });
    }
  }
  return out;
}

/**
 * Which ticks along a `pathTicks`-long rollout the score is read at (R-P7).
 *
 * Ticks, one-based, ascending, and the LAST ENTRY IS ALWAYS `pathTicks`. That entry is load-bearing
 * twice over: it is where the two destination terms are read outright (`rangeError`, R-P7 third
 * revision, round 3; `threatAvoid`, R-P11, round 4), and it is where the four moment-terms catch an
 * arc that sweeps beautifully and then buries itself in a wall.
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
  // Both destination terms are assigned outright at the terminal sample (see below), so neither
  // needs a maximising or minimising seed. `plan` guarantees at least one sample (`commit` is
  // floored at 1), so the terminal branch always runs and 0 is never returned by accident.
  let rangeError = 0;
  let threatAvoid = 0;

  for (let i = 0; i <= last; i++) {
    const body = path[sampleTicks[i]! - 1]!;
    const sample = samples[i]!;
    const { future } = sample;

    const wall = boundsPenalty(body.x, body.y, args.arena);
    if (wall > wallPenalty) wallPenalty = wall;

    // THE TWO DESTINATION TERMS, both read AT THE TERMINUS. Every other term asks about a MOMENT
    // and takes its best or its worst anywhere along the arc; these two ask where the arc LEAVES
    // the bot, and under R-P10 the terminal pose is a real destination — where committing this
    // input and then coasting to a stop actually puts the car.
    if (i === last) {
      // `rangeError`: the only NAVIGATION term the planner has, and in a targetless plan the
      // entire objective (see `plan`'s doc). R-P7's third revision, kept.
      rangeError = Math.abs(
        Math.hypot(future.x - body.x, future.y - body.y) - args.preferredRange,
      );
      // `threatAvoid` AT THE TERMINUS (R-P11, fix round 4, 2026-09-07). Displacement along a
      // threat's `awayHeadingRad` asks "am I out of the line", which is a destination: a maximum
      // over the arc rewards an arc that steps aside and then drifts straight back, because the
      // moment it was clear is banked and the return costs nothing. Round 3's ablation also
      // attributed `balance/match.test.ts`'s seed-96 failure to the arc reading, and measured that
      // file 11 / 11 green with this term at the terminus.
      threatAvoid = threatAvoidOf(origin, body, away);
    }

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

  return { myEv, theirEv, rangeError, wallPenalty, lockKeep, threatAvoid };
}

/**
 * How far the arc's TERMINAL pose has moved from the plan's start along the "get out of the way"
 * directions of every shot currently in the air, in world units (P40, R-P8, R-P11).
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
