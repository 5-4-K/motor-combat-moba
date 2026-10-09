import type { BotProfile } from "../../config/bot-profiles.js";
import type { BotIntent } from "../types.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

/** The reaction delay line (BB48). Nothing else: blunders, fidget and personalities are gone. */
export interface HumanizeState { delayLine: BotIntent[] }

export function newHumanizeState(): HumanizeState {
  return { delayLine: [] };
}

/** Emit the intent decided `reactionDelayTicks` ago; coast until the line has filled. */
export function applyHumanize(state: HumanizeState, intent: BotIntent, profile: BotProfile): BotIntent {
  const delayTicks = profile.reactionDelayTicks;
  if (delayTicks <= 0) return intent;
  state.delayLine.push(intent);
  if (state.delayLine.length > delayTicks) return state.delayLine.shift()!;
  return COAST;
}
