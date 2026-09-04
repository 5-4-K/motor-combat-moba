import { hasStatus } from "@motor-combat-moba/shared";
import type { BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotCarView, BotSelfView, StanceId } from "../types.js";
import { ticksSinceBlame, type PerceptionState } from "./perception.js";

export interface StanceState {
  current: StanceId;
  sinceTick: number;
}

/** A bot starts having seen nothing, so it starts hunting. */
export function newStanceState(): StanceState {
  return { current: "hunt", sinceTick: 0 };
}

const ALL_STANCES: readonly StanceId[] = [
  "engage", "brawl", "kite", "disengage", "reposition", "hunt", "recover",
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
 * Score every stance (H9). The winner is chosen by `pickStance`, which also holds it.
 *
 * Draws exactly one random number, always, for the score noise.
 */
export function scoreStances(args: {
  self: BotSelfView;
  target: BotCarView | undefined;
  distance: number;
  preferredRange: number;
  profile: BotProfile;
  tick: number;
  /** A ready `range: 0` weapon — a charge is worth walking into contact for (H36). */
  hasReadyContactWeapon: boolean;
  /** This bot has rolled and committed to a deliberate ram (H40). */
  wantsRam: boolean;
  pinnedOnWall: boolean;
  rng: Rng;
}): Record<StanceId, number> {
  const { self, target, distance, preferredRange, profile, tick, rng } = args;
  const noise = (rng() - 0.5) * 2 * profile.scoreNoiseSigma;

  const hpFraction = self.maxHp > 0 ? self.hp / self.maxHp : 1;
  const controlLost = !self.alive || hasStatus(self.statuses, "phased", tick);

  const scores: Record<StanceId, number> = {
    engage: 0, brawl: 0, kite: 0, disengage: 0, reposition: 0, hunt: 0, recover: 0,
  };

  if (controlLost) {
    scores.recover = 100;
    return scores;
  }
  if (!target) {
    scores.hunt = 10 + noise;
    return scores;
  }

  scores.engage = 5 + noise;

  // A ready charge is worth walking into contact for (H36) — what makes "Bastion is going for the
  // charge" legible from the outside — and so is a ram the bot has committed to (H40). Ram knockback
  // and the hard-slam stun are real mechanics no bot has ever used on purpose.
  scores.brawl = args.hasReadyContactWeapon || args.wantsRam
    ? 6 + (1 - Math.min(distance / Math.max(preferredRange, 1), 2)) * 2 + noise
    : -Infinity;

  // Too close for the range this kit wants.
  scores.kite = distance < preferredRange * 0.6 ? 6 + noise : 1 + noise;

  // `retreatHpFraction` 0 means this branch can never win, however hurt the bot is (H37): an easy
  // bot fights to zero, because self-preservation is a learned habit.
  scores.disengage = profile.retreatHpFraction > 0 && hpFraction < profile.retreatHpFraction
    ? 8 + (profile.retreatHpFraction - hpFraction) * 10 + noise
    : -Infinity;

  scores.reposition = args.pinnedOnWall ? 7 + noise : 0;

  return scores;
}

/**
 * Hold the current stance for `stanceCommitTicks`, then take the best (H10).
 *
 * `preempt` is the escape hatch, and there are exactly three of them: hp crossing the retreat
 * threshold, the target dying, and losing control. Dodging is NOT one — it is a steering desire
 * (H26), which is what lets the bot dodge without stopping fighting.
 */
export function pickStance(
  state: StanceState,
  scores: Record<StanceId, number>,
  tick: number,
  profile: BotProfile,
  preempt: StanceId | undefined,
): StanceState {
  if (preempt !== undefined) {
    return preempt === state.current ? state : { current: preempt, sinceTick: tick };
  }
  if (tick - state.sinceTick < profile.stanceCommitTicks) return state;

  let best: StanceId = state.current;
  let bestScore = -Infinity;
  for (const stance of ALL_STANCES) {
    const score = scores[stance];
    if (score > bestScore) {
      bestScore = score;
      best = stance;
    }
  }
  return best === state.current ? { ...state, sinceTick: tick } : { current: best, sinceTick: tick };
}
