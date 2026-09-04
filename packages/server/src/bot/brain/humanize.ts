import type { BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotIntent } from "../types.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

export type BlunderKind = "oversteer" | "wrong-way" | "hold-fire" | "panic-reverse";

const BLUNDERS: readonly BlunderKind[] = ["oversteer", "wrong-way", "hold-fire", "panic-reverse"];

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
 * the fidget roll (H21).
 */
export function applyHumanize(
  state: HumanizeState,
  intent: BotIntent,
  tick: number,
  profile: BotProfile,
  rng: Rng,
  idle: boolean,
): BotIntent {
  const blunderRoll = rng();
  const kindRoll = rng();
  const fidgetRoll = rng();

  if (tick >= state.blunderUntilTick) {
    state.blunderKind = undefined;
    if (blunderRoll < profile.blunderChance) {
      state.blunderKind = BLUNDERS[Math.floor(kindRoll * BLUNDERS.length)] ?? "oversteer";
      state.blunderUntilTick = tick + profile.blunderTicks;
    }
  }

  let out = intent;
  if (state.blunderKind !== undefined) out = applyBlunder(out, state.blunderKind);
  if (idle && fidgetRoll < profile.idleFidgetChance) {
    out = { ...out, steer: kindRoll < 0.5 ? 1 : -1 };
  }

  return delay(state, out, profile.reactionDelayTicks);
}

/**
 * A mistake committed to for a window, not a per-tick coin flip (H41): a flip reads as a stutter,
 * a committed wrong action reads as a person who has misjudged something.
 */
function applyBlunder(intent: BotIntent, kind: BlunderKind): BotIntent {
  switch (kind) {
    case "oversteer":
      // Committing to a turn that wasn't there, or over-rotating past one that was: either way the
      // output must actually differ from the input, so a straight line gets a turn and an existing
      // turn gets swung past centre into the opposite lock rather than left untouched.
      return { ...intent, steer: intent.steer === 0 ? 1 : ((-intent.steer) as -1 | 0 | 1) };
    case "wrong-way":
      return { ...intent, steer: (intent.steer * -1) as -1 | 0 | 1 };
    case "hold-fire":
      return { ...intent, fireSlots: 0 };
    case "panic-reverse":
      return { ...intent, throttle: -1 };
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
