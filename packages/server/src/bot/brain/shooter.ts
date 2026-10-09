import { hasStatus, weaponDefOf } from "@motor-combat-moba/shared";
import type { BotProfile } from "../../config/bot-profiles.js";
import type { BotCarView, BotSelfView, BotSlotView } from "../types.js";
import { slotIsReady, usableSlots } from "./ranges.js";
import { weaponReachOf } from "./reach.js";
import type { FiringSolution } from "./solution.js";

export interface ShotDecision {
  /** The single slot to press, or `undefined` to hold fire. Never a mask. */
  slot: number | undefined;
  /** A ready fixed-muzzle slot would land if the nose came round (BB47). */
  wantsNose: boolean;
  /** Best solved hit chance among ready slots; the overlay's `hit` reading. */
  bestHitChance: number;
}

/** A press worth making: over the bar, and it does damage (BB38). */
export function isPressable(solution: FiringSolution | undefined, bar: number): boolean {
  return solution !== undefined && solution.hitChance >= bar && solution.expectedDamage > 0;
}

/** The kit's setup slot: the first that applies `stunned` to opponents (BB39). */
export function setupSlotIndex(slots: readonly BotSlotView[]): number | undefined {
  for (const { slot, index } of usableSlots(slots)) {
    const applies = weaponDefOf(slot.weaponId).applies;
    if (applies?.some((a) => a.statusId === "stunned" && a.target === "opponents")) return index;
  }
  return undefined;
}

/** Greedy on hit chance with one combo rule (BB38, BB39, BB47). */
export function chooseShot(args: {
  self: BotSelfView;
  target: BotCarView;
  profile: BotProfile;
  tick: number;
  lastPressTick: number;
  solutions: ReadonlyMap<number, FiringSolution>;
}): ShotDecision {
  const { self, target, profile, tick, solutions } = args;
  const bar = profile.hitChanceBar;
  const distance = Math.hypot(target.x - self.x, target.y - self.y);

  let bestHitChance = 0;
  let wantsNose = false;
  const pressable: { index: number; damage: number }[] = [];
  for (const { slot, index } of usableSlots(self.slots)) {
    if (!slotIsReady(slot, tick)) continue;
    const solution = solutions.get(index);
    if (solution) bestHitChance = Math.max(bestHitChance, solution.hitChance);
    if (solution !== undefined && isPressable(solution, bar)) {
      pressable.push({ index, damage: solution.expectedDamage });
    } else if (weaponDefOf(slot.weaponId).turret === undefined && distance <= weaponReachOf(slot.weaponId)) {
      wantsNose = true;
    }
  }

  const gated = tick - args.lastPressTick < profile.burstGapTicks || tick < self.switchLockUntilTick;
  if (gated || pressable.length === 0) return { slot: undefined, wantsNose, bestHitChance };

  const byDamage = [...pressable].sort((a, b) => b.damage - a.damage)[0]!.index;
  if (hasStatus(target.statuses, "stunned", tick)) return { slot: byDamage, wantsNose, bestHitChance };
  const setup = setupSlotIndex(self.slots);
  if (setup !== undefined && pressable.some((p) => p.index === setup)) return { slot: setup, wantsNose, bestHitChance };
  return { slot: byDamage, wantsNose, bestHitChance };
}
