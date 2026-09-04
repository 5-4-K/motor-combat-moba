import { hasStatus, weaponDefOf } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotCarView, BotSelfView, BotSlotView } from "../types.js";

/**
 * How much a good window is worth to an ult's ranking (H30).
 *
 * Every ult on this roster is worth less per second than the slot beside it, so without this a good
 * window could never actually produce an ult press and "saves it for a stunned target" would be
 * unobservable from outside.
 */
const ULT_WINDOW_BONUS = 4;

/** A slot with a stock in hand and neither lock running. */
export function slotIsReady(slot: BotSlotView, tick: number): boolean {
  return slot.stocks >= 1 && tick >= slot.refireLockUntilTick;
}

/** A long-cooldown weapon, worth saving for a moment (H30). */
export function isUlt(slot: BotSlotView): boolean {
  return weaponDefOf(slot.weaponId).cooldownMs >= BRAIN_CONSTANTS.ultCooldownMs;
}

/**
 * A slot's rough worth per second, times this bot's preference for it.
 *
 * A SHAPING HEURISTIC for standoff and slot ranking only (H35). `damage` is the raw table field, so
 * a beam's pulse and a pepperbox pellet are both under-rated; that is accepted. `sim/damage.ts` is
 * the only authority on damage and nothing here may be mistaken for it.
 */
export function weaponValueOf(slot: BotSlotView, weight: number): number {
  const def = weaponDefOf(slot.weaponId);
  const seconds = Math.max(def.cooldownMs, 1) / 1000;
  return (def.damage / seconds) * Math.max(weight, 0.01);
}

/**
 * The range this kit wants to fight at: every ready slot's reach, weighted by its worth (H35).
 *
 * Range-0 rows are excluded — a charge dashes nowhere and would drag the average to nothing — but
 * they still pull the bot in through the `Brawl` stance (H36).
 */
export function effectiveRangeOf(
  slots: readonly BotSlotView[],
  weights: readonly number[],
  tick: number,
): number {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot.range <= 0) continue;
    if (!slotIsReady(slot, tick)) continue;
    const value = weaponValueOf(slot, weights[i] ?? 1);
    weighted += slot.range * value;
    total += value;
  }
  if (total === 0) {
    // Nothing ready: fall back to the kit's reach as authored, so a bot mid-recharge does not
    // suddenly decide it wants to be nose to nose.
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot.range <= 0) continue;
      const value = weaponValueOf(slot, weights[i] ?? 1);
      weighted += slot.range * value;
      total += value;
    }
  }
  return total === 0 ? 0 : weighted / total;
}

/** Where this bot wants to stand (H35): a fraction of its own reach, floored and capped. */
export function preferredRangeOf(
  self: BotSelfView,
  profile: BotProfile,
  weights: readonly number[],
  tick: number,
): number {
  const effective = effectiveRangeOf(self.slots, weights, tick);
  const wanted = profile.standoffFraction * effective;
  return Math.min(
    Math.max(wanted, BRAIN_CONSTANTS.minEngageUnits),
    profile.awarenessRadiusUnits,
  );
}

export interface FireDecision {
  /** The single slot to press, or `undefined` to hold fire. NEVER a mask (H27). */
  slot: number | undefined;
}

/**
 * Which one slot to press this tick (H27).
 *
 * `beginFire` resolves at most one press per tick and takes the LOWEST set bit it can use, so a bot
 * that ORs every in-range slot fires slot 0 and essentially nothing else. Ranking and returning one
 * slot is what lets a chassis actually use its kit.
 *
 * Draws exactly two random numbers, always, in this order: the discipline roll and the ult roll.
 */
export function chooseSlot(args: {
  self: BotSelfView;
  target: BotCarView;
  distance: number;
  aimDelta: number;
  profile: BotProfile;
  weights: readonly number[];
  tick: number;
  lastPressTick: number;
  rng: Rng;
}): FireDecision {
  const { self, target, distance, aimDelta, profile, weights, tick, rng } = args;

  // Both drawn unconditionally, before any early return, so the stream stays aligned (H21).
  const disciplineRoll = rng();
  const ultRoll = rng();

  const hold: FireDecision = { slot: undefined };
  if (Math.abs(aimDelta) >= profile.fireConeRad) return hold;
  if (tick - args.lastPressTick < profile.burstGapTicks) return hold;
  // A press the sim would refuse is a press thrown away. Reading our OWN switch lock is fair —
  // it is on our own HUD (H27a).
  if (tick < self.switchLockUntilTick) return hold;

  const targetHpFraction = target.maxHp > 0 ? target.hp / target.maxHp : 1;
  const targetStunned = hasStatus(target.statuses, "stunned", tick);

  let best: number | undefined;
  let bestScore = -Infinity;

  for (let i = 0; i < self.slots.length; i++) {
    const slot = self.slots[i]!;
    if (!slotIsReady(slot, tick)) continue;

    const reach = slot.range > 0 ? slot.range : BRAIN_CONSTANTS.contactTriggerUnits;
    if (distance > reach) continue;

    let windowBonus = 1;
    if (isUlt(slot)) {
      const goodMoment =
        targetHpFraction <= profile.ultWindowHpFraction ||
        targetStunned ||
        distance <= reach / 2;
      // Discipline is the probability of HOLDING when the moment is not good (H30).
      if (!goodMoment && ultRoll < profile.ultDisciplineChance) continue;
      // And when the moment IS good, the ult has to be able to WIN the ranking, or "saves it for a
      // stunned target" is unobservable: every ult on this roster is worth less per second than the
      // slot beside it (lance ~10.6/s against predator's 30/s), so raw value would pick the small
      // gun forever and discipline would only ever read as "never fires the ult".
      if (goodMoment) windowBonus = ULT_WINDOW_BONUS;
    } else if (distance > reach * 0.9 && disciplineRoll < profile.fireDisciplineChance) {
      // A marginal shot at the very edge of reach: a disciplined bot waits, a sprayer takes it (H29).
      continue;
    }

    // Prefer the weapon that is worth the most and fits the current distance best.
    const fit = 1 - Math.min(distance / reach, 1) * 0.5;
    const score = weaponValueOf(slot, weights[i] ?? 1) * fit * windowBonus;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return { slot: best };
}
