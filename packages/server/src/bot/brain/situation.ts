import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type { BotCarView, SituationId } from "../types.js";

/** Priority order: lower index wins when two apply at once (BB15). */
export const ALL_SITUATIONS: readonly SituationId[] = [
  "recover", "evade", "unpin", "waitOut", "punish", "reset", "ram", "fight", "close",
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
  pinned: boolean;
  punish: boolean;
  reset: boolean;
  kitDry: boolean;
  inRamRange: boolean;
  inOwnReach: boolean;
}

/** First matching row of the BB15 table. */
export function classifySituation(input: SituationInputs): SituationId {
  if (input.selfControlLost) return "recover";
  if (input.evade) return "evade";
  if (input.pinned) return "unpin";
  if (!input.hittable) return "waitOut";
  if (input.punish) return "punish";
  if (input.reset) return "reset";
  if (input.kitDry && input.inRamRange) return "ram";
  if (input.inOwnReach) return "fight";
  return "close";
}

function priority(id: SituationId): number {
  return ALL_SITUATIONS.indexOf(id);
}

/**
 * Hysteresis (BB16). Higher priority (lower index) always cuts in. Same or lower waits
 * `situationCommitTicks`.
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

/** A car bearing down on us with an ETA inside the dodge horizon (BB20). Moved from the controller. */
export function isIncomingCar(
  self: { x: number; y: number },
  target: BotCarView,
  profile: BotProfile,
): boolean {
  const dx = self.x - target.x;
  const dy = self.y - target.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return true;
  const closing = (target.vx * dx + target.vy * dy) / dist;
  if (closing <= 0) return false;
  const eta = (dist - BRAIN_CONSTANTS.contactTriggerUnits) / closing;
  const horizon = profile.dodgeHorizonTicks / TICK_RATE_HZ;
  return eta >= 0 && eta <= horizon;
}
