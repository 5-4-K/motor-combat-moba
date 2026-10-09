import type { BotProfile } from "../../config/bot-profiles.js";
import type { BotCarView, BotSelfView } from "../types.js";
import { ticksSinceBlame, type PerceptionState } from "./perception.js";

/**
 * Which hittable car to fight (BB46): proximity, wounded bias, grudge and stickiness, no noise.
 * `goals.ts`'s `scoreTargets` minus its `rng()` draw; evaluated on the recompute tick only.
 */
export function chooseTarget(args: {
  self: BotSelfView;
  candidates: readonly BotCarView[];
  perception: PerceptionState;
  profile: BotProfile;
  tick: number;
  heldTargetId: string | undefined;
  heldSinceTick: number;
}): string | undefined {
  const { self, candidates, perception, profile, tick } = args;
  let best: string | undefined;
  let bestScore = -Infinity;
  const anyEnemy = candidates.some((o) => o.team !== self.team);
  for (const car of candidates) {
    if (!car.alive || car.phased) continue;
    if (car.team === self.team && anyEnemy) continue;
    const distance = Math.hypot(car.x - self.x, car.y - self.y);
    const proximity = 1 - Math.min(distance / Math.max(profile.awarenessRadiusUnits, 1), 1);
    const wounded = car.maxHp > 0 ? 1 - car.hp / car.maxHp : 0;
    const sinceBlame = ticksSinceBlame(perception, car.sessionId, tick);
    const grudge = sinceBlame <= profile.targetCommitTicks ? 1 - sinceBlame / Math.max(profile.targetCommitTicks, 1) : 0;
    const heldFor = tick - args.heldSinceTick;
    const stickiness = car.sessionId === args.heldTargetId && heldFor < profile.targetCommitTicks
      ? 1 - heldFor / Math.max(profile.targetCommitTicks, 1) : 0;
    const score = proximity + wounded * profile.woundedBias * 2 + grudge * profile.vengefulness * 2 + stickiness * 1.5;
    if (score > bestScore) { bestScore = score; best = car.sessionId; }
  }
  return best;
}
