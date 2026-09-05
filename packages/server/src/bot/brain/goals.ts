import type { BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotCarView, BotSelfView } from "../types.js";
import { ticksSinceBlame, type PerceptionState } from "./perception.js";

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
