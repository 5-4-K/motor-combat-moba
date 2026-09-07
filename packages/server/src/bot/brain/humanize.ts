import type { BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotIntent } from "../types.js";
import type { DriveAction } from "./predict.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

export type BlunderKind = "second-best" | "late-brake" | "hold-fire";

/**
 * The menu is DERIVED FROM THE UNION, not typed out beside it (R-C1, fix wave 4).
 *
 * `Record<BlunderKind, true>` cannot be written without a row for every member, so adding a kind to
 * `BlunderKind` fails to compile here until it is listed, and `BLUNDERS` then carries it for free.
 * Without this the guard was one-sided: `humanize.test.ts`'s "EVERY kind is observable" iterates
 * `BLUNDERS`, so it catches a kind that does nothing — but a kind added to the union and to
 * `applyBlunder`'s exhaustive switch while `BLUNDERS` was forgotten was dead code no test could see,
 * which is the mirror of the hole that test was written to close.
 */
const BLUNDER_MENU: Record<BlunderKind, true> = {
  "second-best": true, "late-brake": true, "hold-fire": true,
};

/**
 * The mistakes on the menu (P41). Exported so a test can hold EVERY entry to being observable —
 * see `applyBlunder` for why a kind that cannot change an intent is a defect rather than a nuance.
 *
 * The ORDER is what `Math.floor(kindRoll * BLUNDERS.length)` selects from, so changing it changes
 * which mistake a given seed makes — and the order is `BLUNDER_MENU`'s own key order, since string
 * keys enumerate in insertion order. It does not change how many numbers are drawn (H21).
 */
export const BLUNDERS: readonly BlunderKind[] = Object.keys(BLUNDER_MENU) as BlunderKind[];

/**
 * The last layer (H7): everything that makes a correct decision come out human.
 *
 * Runs EVERY tick, never on the recompute cadence — a delay line that only shifts when the bot
 * re-decides delays by a multiple of the cadence rather than by its own value (H6).
 */
export interface HumanizeState {
  delayLine: BotIntent[];
  blunderUntilTick: number;
  blunderKind: BlunderKind | undefined;
}

export function newHumanizeState(): HumanizeState {
  return { delayLine: [], blunderUntilTick: 0, blunderKind: undefined };
}

/**
 * Apply reaction delay, blunders and idle fidget.
 *
 * Draws exactly three random numbers, always, in this order: the blunder roll, the blunder kind, and
 * the fidget roll (H21). All three are drawn on EVERY tick, including the ticks that cannot start a
 * blunder — `decisionWindow` gates what the first roll is allowed to DO, never whether it happens,
 * so the stream stays aligned tick-for-tick regardless of the recompute cadence.
 *
 * `decisionWindow` is the caller's `shouldRecompute(tick)`: `blunderChance` is authored as a
 * probability *per decision window* (H41), and rolling it every tick instead compounded it by the
 * cadence — easy spent 57.9% of its ticks inside a blunder, medium 34.5%, hard 13.2%, against the
 * ~9%/8%/7% the numbers describe (`blunderChance * blunderTicks / recomputeTicks`). Two of the four
 * blunder kinds THEN IN PLACE inverted `steer`, so an easy bot was steering the wrong way more often
 * than not; P41 has since replaced the kinds outright (see `applyBlunder`), and the rate this
 * paragraph is about is unchanged by that.
 *
 * `runnerUp` is the planner's own second-best first action (`PlanResult.runnerUp`), threaded through
 * from `controller.ts` for the `second-best` blunder. It is STATE, not a draw: whether one is
 * available may not move the rng stream, and does not.
 *
 * IT IS RE-READ EVERY TICK, NOT SNAPSHOTTED WHEN THE WINDOW OPENS (R-C3, fix wave 4) — the KIND is
 * what this file commits to for a window, and the runner-up rides along live. `controller.ts` passes
 * `this.lastPlan?.runnerUp`, which is rewritten on every recompute, so a `second-best` blunder can
 * change which alternative line it is driving part-way through one window, at recompute granularity.
 * Snapshotting it was tried and reverted: it moves no `rng()` draw, but it is a real behaviour change
 * downstream — at seed 17 it lifted a medium bot's measured hit rate in the `tiers.test.ts` duel from
 * 0.632 to 1.000, collapsing the P50 ladder's medium-to-hard rung to a tie — and re-pinning five
 * seeds of a settled measurement was not what that review asked for. `applyBlunder`'s doc says what
 * is and is not committed here; if a future phase wants the stronger reading, it owns the re-measure.
 */
export function applyHumanize(
  state: HumanizeState,
  intent: BotIntent,
  tick: number,
  profile: BotProfile,
  rng: Rng,
  idle: boolean,
  decisionWindow: boolean,
  runnerUp?: DriveAction,
): BotIntent {
  const blunderRoll = rng();
  const kindRoll = rng();
  const fidgetRoll = rng();

  if (tick >= state.blunderUntilTick) {
    // The window EXPIRES on its own tick, whatever the cadence — a mistake that outlived its
    // `blunderTicks` because the next decision window had not come round yet would be the same
    // cadence-multiplied bug in the other direction.
    state.blunderKind = undefined;
    if (decisionWindow && blunderRoll < profile.blunderChance) {
      state.blunderKind = BLUNDERS[Math.floor(kindRoll * BLUNDERS.length)] ?? "second-best";
      state.blunderUntilTick = tick + profile.blunderTicks;
    }
  }

  let out = intent;
  if (state.blunderKind !== undefined) out = applyBlunder(out, state.blunderKind, runnerUp);
  if (idle && fidgetRoll < profile.idleFidgetChance) {
    out = { ...out, steer: kindRoll < 0.5 ? 1 : -1 };
  }

  return delay(state, out, profile.reactionDelayTicks);
}

/**
 * A MISTAKE A PERSON WOULD MAKE (P41), committed to for a window rather than flipped per tick
 * (H41): a flip reads as a stutter, a committed wrong action reads as a person who has misjudged
 * something.
 *
 * The four kinds this replaced were `oversteer`, `wrong-way`, `hold-fire` and `panic-reverse`, and
 * three of the four wrote a control to the OPPOSITE of what the brain had decided. That reads as a
 * car spasming, not as a driver getting it wrong. Every kind here is instead an action the bot
 * could plausibly have chosen on purpose.
 *
 * THREE KINDS, NOT THE FOUR THE TASK BRIEF LISTED (R-B1). The fourth, `marginal-shot` — "take a shot
 * the solver rated marginal" — was specified as `return intent`, i.e. UNCONDITIONALLY invisible: a
 * quarter of every tier's blunders would have done nothing at all, silently weakening
 * `blunderChance` by a quarter, and no test could have told. `late-brake` is only CONDITIONALLY
 * invisible — a no-op when the intent already said `throttle: 1` — which is exactly what "failed to
 * lift off in time" means and is fine. `humanize.test.ts`'s "EVERY kind is observable" is the
 * assertion that keeps the difference honest for whoever adds a fourth kind later.
 *
 * NEITHER `marginal-shot` NOR P41's OTHER SUGGESTION — "misjudge range by ~15%" — IS EXPRESSIBLE AT
 * THIS SEAM, and that is a property of where the layer sits rather than an omission. `applyHumanize`
 * receives a FINISHED `BotIntent`: a steer, a throttle and a fire mask. It can see neither the EV
 * gate that decided whether a shot was worth taking nor the range model that decided where to
 * stand. Both are blunders of the DECISION, and would have to be applied before the plan is made:
 *
 * - `marginal-shot` belongs in `chooseSlot` (`firing.ts`), where `minShotValueFraction` is compared
 *   against a slot's solved value — a blundering bot would lower that bar for the window.
 * - "misjudge range by ~15%" belongs on `preferredRangeOf` (same file), whose answer `controller.ts`
 *   hands the planner as `PlanArgs.preferredRange` — a blundering bot would scale it.
 *
 * Both would need the blunder window to be visible to `controller.plan()`, which is state
 * `HumanizeState` already holds; neither is wired up, and neither should be faked here.
 */
export function applyBlunder(
  intent: BotIntent,
  kind: BlunderKind,
  runnerUp: DriveAction | undefined,
): BotIntent {
  switch (kind) {
    case "second-best":
      /**
       * Commit to the line the planner rated SECOND. `PlanResult.runnerUp` is the best candidate
       * whose first action genuinely differs from the winner's, so it is by construction a
       * nearly-good line — which is exactly what P41 asks for: a mistake, not a malfunction. The
       * trigger is left alone; a runner-up is a DRIVE action and says nothing about firing.
       *
       * WHAT IS COMMITTED FOR THE WINDOW IS THE KIND, NOT THE LINE (R-C3). `applyHumanize` re-reads
       * the caller's live `runnerUp` on every tick of the window, so a bot inside a `second-best`
       * blunder keeps taking whatever the planner currently rates second — which changes at
       * recompute granularity. It is still a mistake held for the window (it never reverts to the
       * winning line mid-blunder) and every candidate it can land on is by construction a
       * nearly-good one, so it reads as a driver persisting with a worse idea rather than as a
       * stutter — but it is a weaker reading of "commits" than `blunderKind` gets, and it is
       * deliberate. See `applyHumanize`'s `runnerUp` paragraph for the measurement that decided it.
       *
       * WITH NO RUNNER-UP, `late-brake`'s behaviour. Reachable only before a bot's first decision
       * window has run — `controller.ts` writes `lastPlan` inside `plan()`, and after that `plan`
       * always names one, since `ALL_ACTIONS`' nine entries are distinct by construction. Falling
       * back to the other purely-motor kind keeps the blunder from evaporating into a no-op on
       * exactly the ticks a bot is least sure of itself, and costs nothing.
       */
      return runnerUp === undefined
        ? { ...intent, throttle: 1 }
        : { ...intent, steer: runnerUp.steer, throttle: runnerUp.throttle };
    case "late-brake":
      // Failing to lift off in time — the pedal stays down through the moment it should have come
      // up. A no-op when the bot was flooring it anyway, which is the honest reading of the
      // mistake: you cannot brake late if you were never going to brake.
      return { ...intent, throttle: 1 };
    case "hold-fire":
      // Hesitating on a shot that was there. Carried over unchanged from the old set — it was
      // already a mistake rather than a spasm.
      return { ...intent, fireSlots: 0 };
  }
}

/**
 * The gap between deciding and the hands moving (B19).
 *
 * Below `delay` calls since construction, the reaction to anything seen so far has not arrived yet —
 * the same as a human's first instant in a match — so this coasts rather than acting on a decision
 * it has not felt.
 */
function delay(state: HumanizeState, intent: BotIntent, delayTicks: number): BotIntent {
  if (delayTicks <= 0) return intent;
  state.delayLine.push(intent);
  if (state.delayLine.length > delayTicks) return state.delayLine.shift()!;
  return COAST;
}
