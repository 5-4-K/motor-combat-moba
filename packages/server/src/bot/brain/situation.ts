import type { BotProfile } from "../../config/bot-profiles.js";
import type { SituationId } from "../types.js";

export const ALL_SITUATIONS: readonly SituationId[] = [
  "recover", "waitOut", "evade", "unpin", "punish", "reset", "fight", "close",
];

export interface SituationState {
  current: SituationId;
  sinceTick: number;
}

export function newSituationState(): SituationState {
  return { current: "waitOut", sinceTick: 0 };
}

export interface SituationInputs {
  selfControlLost: boolean;
  hittable: boolean;
  evade: boolean;
  unpin: boolean;
  punish: boolean;
  reset: boolean;
  inOwnReach: boolean;
}

/** First matching row in the S13 catalog. */
export function classifySituation(input: SituationInputs): SituationId {
  if (input.selfControlLost) return "recover";
  if (!input.hittable) return "waitOut";
  if (input.evade) return "evade";
  if (input.unpin) return "unpin";
  if (input.punish) return "punish";
  if (input.reset) return "reset";
  if (input.inOwnReach) return "fight";
  return "close";
}

function priority(id: SituationId): number {
  return ALL_SITUATIONS.indexOf(id);
}

/**
 * Higher priority (lower index) always cuts in. Same or lower waits `situationCommitTicks` (S8).
 */
export function pickSituation(
  state: SituationState,
  next: SituationId,
  tick: number,
  profile: BotProfile,
): SituationState {
  if (next === state.current) {
    return tick - state.sinceTick >= profile.situationCommitTicks
      ? { current: next, sinceTick: tick }
      : state;
  }
  // waitOut / recover exist only while their facts hold. When they end, leave immediately.
  if (state.current === "waitOut" || state.current === "recover") {
    return { current: next, sinceTick: tick };
  }
  const cutsIn = priority(next) < priority(state.current)
    || tick - state.sinceTick >= profile.situationCommitTicks;
  return cutsIn ? { current: next, sinceTick: tick } : state;
}
