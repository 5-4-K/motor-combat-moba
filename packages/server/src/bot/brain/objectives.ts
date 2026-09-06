import type { BotProfile } from "../../config/bot-profiles.js";
import type { SituationId } from "../types.js";
import type { PlanWeights } from "./planner.js";

/**
 * What each situation is FOR, as a weight vector (P27).
 *
 * The situation layer used to choose a heading per play, which the movement layer then averaged
 * against wall and orbit desires — and averaging two good headings is what produced spec section
 * 1.1. Now a situation states an objective and the planner is the only thing that turns an
 * objective into steer and throttle. There is no second place for a heading to come from.
 *
 * These are BASE weights, identical across tiers. Exactly two terms are then profile-scaled
 * (P38) — a tier may change how strongly it feels a pressure, never what a situation is for.
 */
const BASE: Readonly<Record<SituationId, PlanWeights>> = Object.freeze({
  recover: { myEv: 0, theirEv: 0, rangeError: 0, wallPenalty: 1, lockKeep: 0 },
  waitOut: { myEv: 0, theirEv: 0.5, rangeError: 0.02, wallPenalty: 4, lockKeep: 0 },
  evade: { myEv: 0.3, theirEv: 4, rangeError: 0, wallPenalty: 6, lockKeep: 0 },
  unpin: { myEv: 0.2, theirEv: 1, rangeError: 0, wallPenalty: 40, lockKeep: 0 },
  punish: { myEv: 3, theirEv: 0.25, rangeError: 0.03, wallPenalty: 4, lockKeep: 1.5 },
  reset: { myEv: 0.4, theirEv: 3, rangeError: 0.04, wallPenalty: 6, lockKeep: 0.2 },
  fight: { myEv: 2, theirEv: 1, rangeError: 0.02, wallPenalty: 5, lockKeep: 1 },
  close: { myEv: 1, theirEv: 0.75, rangeError: 0.06, wallPenalty: 5, lockKeep: 0.5 },
});

/**
 * The objective the planner optimises for this tick's play.
 *
 * Returns a FRESH object every call: `BASE` is the shared identity of the eight plays and a caller
 * that mutated a returned vector would silently re-author every later decision at every tier.
 */
export function weightsFor(situation: SituationId, profile: BotProfile): PlanWeights {
  const base = BASE[situation];
  return { ...base, theirEv: base.theirEv * profile.opponentRangeRespect };
}
