import { hasStatus } from "@motor-combat-moba/shared";
import type { BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotCarView, BotSelfView, GoalId } from "../types.js";
import { isUlt, slotIsReady } from "./firing.js";
import { ticksSinceBlame, type PerceptionState } from "./perception.js";
import type { KitRoles } from "./roles.js";

export interface GoalState {
  current: GoalId;
  sinceTick: number;
}

/** A bot starts having seen nothing, so it starts hunting. */
export function newGoalState(): GoalState {
  return { current: "huntLastKnown", sinceTick: 0 };
}

export const ALL_GOALS: readonly GoalId[] = [
  "recover", "huntLastKnown", "rush", "holdRange", "intercept",
  "setupCc", "dump", "contact", "reset", "pinWall", "unpin",
];

/**
 * Who to shoot at (H32) — a weighted score, not nearest-first.
 *
 * Proximity, the wounded bias (Quake's EASY_FRAGGER), the grudge against whoever was last seen
 * shooting our way (VENGEFULNESS, which runs BACKWARDS up the ladder — a casual chases whoever hurt
 * them, a pro is not distracted), and a bonus for the target already held that decays across the
 * commitment window.
 *
 * Draws one random number per candidate, in `candidates` order, always.
 */
export function scoreTargets(args: {
  self: BotSelfView;
  candidates: readonly BotCarView[];
  perception: PerceptionState;
  profile: BotProfile;
  tick: number;
  heldTargetId: string | undefined;
  heldSinceTick: number;
  rng: Rng;
}): { targetSessionId: string | undefined; scores: Map<string, number> } {
  const { self, candidates, perception, profile, tick, rng } = args;
  const scores = new Map<string, number>();

  let best: string | undefined;
  let bestScore = -Infinity;

  for (const car of candidates) {
    const noise = (rng() - 0.5) * 2 * profile.scoreNoiseSigma;
    if (!car.alive || car.phased) continue;
    if (car.team === self.team && candidates.some((o) => o.team !== self.team)) continue;

    const distance = Math.hypot(car.x - self.x, car.y - self.y);
    const proximity = 1 - Math.min(distance / Math.max(profile.awarenessRadiusUnits, 1), 1);
    const wounded = car.maxHp > 0 ? 1 - car.hp / car.maxHp : 0;

    const sinceBlame = ticksSinceBlame(perception, car.sessionId, tick);
    const grudge = sinceBlame <= profile.targetCommitTicks
      ? 1 - sinceBlame / Math.max(profile.targetCommitTicks, 1)
      : 0;

    const heldFor = tick - args.heldSinceTick;
    const stickiness = car.sessionId === args.heldTargetId && heldFor < profile.targetCommitTicks
      ? 1 - heldFor / Math.max(profile.targetCommitTicks, 1)
      : 0;

    const score =
      proximity +
      wounded * profile.woundedBias * 2 +
      grudge * profile.vengefulness * 2 +
      stickiness * 1.5 +
      noise;

    scores.set(car.sessionId, score);
    if (score > bestScore) {
      bestScore = score;
      best = car.sessionId;
    }
  }

  return { targetSessionId: best, scores };
}

/**
 * Score every goal (G11). The winner is chosen by `pickGoal`, which also holds it.
 *
 * Draws exactly one random number, always, for the score noise.
 */
export function scoreGoals(args: {
  self: BotSelfView;
  target: BotCarView | undefined;
  distance: number;
  preferredRange: number;
  profile: BotProfile;
  tick: number;
  roles: KitRoles;
  hasReadyContactWeapon: boolean;
  wantsRam: boolean;
  pinnedOnWall: boolean;
  targetNearWall: boolean;
  ultSpent: boolean;
  rng: Rng;
}): Record<GoalId, number> {
  const { self, target, distance, preferredRange, profile, tick, roles, rng } = args;
  const noise = (rng() - 0.5) * 2 * profile.scoreNoiseSigma;
  const off = Number.NEGATIVE_INFINITY;

  const scores: Record<GoalId, number> = {
    recover: off, huntLastKnown: off, rush: off, holdRange: off, intercept: off,
    setupCc: off, dump: off, contact: off, reset: off, pinWall: off, unpin: off,
  };

  const controlLost = !self.alive || hasStatus(self.statuses, "phased", tick);
  if (controlLost) {
    scores.recover = 100;
    return scores;
  }
  if (!target) {
    scores.huntLastKnown = 10 + noise;
    return scores;
  }

  const hpFraction = self.maxHp > 0 ? self.hp / self.maxHp : 1;
  const targetHpFraction = target.maxHp > 0 ? target.hp / target.maxHp : 1;
  const targetStunned = hasStatus(target.statuses, "stunned", tick);
  const setupReady = roles.setupCcSlot !== undefined &&
    slotIsReady(self.slots[roles.setupCcSlot]!, tick);
  const ultReady = self.slots.some((s) => slotIsReady(s, tick) && isUlt(s));

  scores.rush = profile.rushWeight + noise;
  scores.holdRange = 5 + noise;
  scores.intercept = profile.interceptWeight + noise;

  scores.setupCc = setupReady && !targetStunned
    ? profile.setupWeight + 2 + noise
    : off;

  // Small base so dump can win a close call; the authored weight only applies when a dump
  // condition is actually true (stun, wounded+ult, or we watched their ult go out).
  let dump = 2 + noise;
  const dumpNow = targetStunned
    || (targetHpFraction <= profile.ultWindowHpFraction && ultReady)
    || args.ultSpent;
  if (dumpNow) {
    dump = profile.dumpWeight + noise;
    if (targetStunned) dump += 3;
    if (targetHpFraction <= profile.ultWindowHpFraction && ultReady) dump += 2;
    if (args.ultSpent) dump += 2;
  }
  scores.dump = dump;

  scores.contact = args.hasReadyContactWeapon || args.wantsRam ? 8 + noise : off;

  if (profile.retreatHpFraction > 0 && hpFraction < profile.retreatHpFraction) {
    scores.reset = 8 + (profile.retreatHpFraction - hpFraction) * 10 + noise;
  } else if (distance < preferredRange * 0.6) {
    scores.reset = 6 + noise;
  }

  const canPin = args.hasReadyContactWeapon || args.wantsRam || dumpNow;
  scores.pinWall = args.targetNearWall && canPin ? profile.pinWeight + 2 + noise : off;
  // Beats contact (8) and setupCc (hard 9): peeling off a wall outranks a commit into it.
  scores.unpin = args.pinnedOnWall ? 10 + noise : off;

  return scores;
}

/**
 * Hold the current goal for `goalCommitTicks`, then take the best (G7).
 *
 * `preempt` is the escape hatch, and there are exactly three of them: hp crossing the retreat
 * threshold, the target dying, and losing control. Dodging is NOT one — it is a steering overlay.
 */
export function pickGoal(
  state: GoalState,
  scores: Record<GoalId, number>,
  tick: number,
  profile: BotProfile,
  preempt: GoalId | undefined,
): GoalState {
  if (preempt !== undefined) {
    return preempt === state.current ? state : { current: preempt, sinceTick: tick };
  }
  if (tick - state.sinceTick < profile.goalCommitTicks) return state;

  let best: GoalId = state.current;
  let bestScore = -Infinity;
  for (const goal of ALL_GOALS) {
    const score = scores[goal];
    if (score > bestScore) {
      bestScore = score;
      best = goal;
    }
  }
  return best === state.current ? { ...state, sinceTick: tick } : { current: best, sinceTick: tick };
}
