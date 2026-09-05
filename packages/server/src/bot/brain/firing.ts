import { hasStatus, weaponDefOf, weaponTicksOf } from "@motor-combat-moba/shared";
import type { WeaponDef } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotCarView, BotSelfView, BotSlotView, SituationId } from "../types.js";
import type { KitRoles } from "./roles.js";
import { weaponReachOf } from "./reach.js";

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
 * How many times one press of a TICKING beam can damage the same car, counted the way
 * `resolveInstanceHits` does: a hit on the first tick it covers them, then one every
 * `damageInterval` for as long as `instanceExpired` keeps the instance alive. 1 for everything else.
 *
 * This exists because `damage` on a ticking row is a PULSE, not a press. Reading it raw made
 * `lance` — 43 a pulse since the 2026-09-04 retune, 170 a press before it — score 2.7/s against
 * `predator`'s 30, which the ult window's x4 could not overcome: a Bullseye bot would have held its
 * ult for a wounded target and then never pressed it.
 */
function pulsesPerPress(def: WeaponDef): number {
  if (def.kind !== "beam") return 1;
  const ticks = weaponTicksOf(def.id);
  if (!Number.isFinite(ticks.damageInterval)) return 1;
  return Math.floor((ticks.flight + ticks.lifetime - 1) / ticks.damageInterval) + 1;
}

/**
 * A slot's rough worth per second, times this bot's preference for it.
 *
 * A SHAPING HEURISTIC for standoff and slot ranking only (H35). It counts a ticking beam's pulses
 * (above) because the difference there is a factor of four or five, not a rounding — a pepperbox
 * pellet is still under-rated by its raw `damage`, and that stays accepted: three pellets from one
 * fan is a per-target ceiling nobody hits every press. `sim/damage.ts` is the only authority on
 * damage and nothing here may be mistaken for it.
 */
export function weaponValueOf(slot: BotSlotView, weight: number): number {
  const def = weaponDefOf(slot.weaponId);
  const seconds = Math.max(def.cooldownMs, 1) / 1000;
  return ((def.damage * pulsesPerPress(def)) / seconds) * Math.max(weight, 0.01);
}

/**
 * The range this kit wants to fight at: every ready slot's reach, weighted by its worth (H35).
 *
 * Range-0 rows are excluded — a charge dashes nowhere and would drag the average to nothing — but
 * they still pull the bot in through S10's contact trigger when that slot is a candidate.
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
    weighted += weaponReachOf(slot.weaponId) * value;
    total += value;
  }
  if (total === 0) {
    // Nothing ready: fall back to the kit's reach as authored, so a bot mid-recharge does not
    // suddenly decide it wants to be nose to nose.
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot.range <= 0) continue;
      const value = weaponValueOf(slot, weights[i] ?? 1);
      weighted += weaponReachOf(slot.weaponId) * value;
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
 * One ult slot's held discipline decision for its current (target, ready) episode (H30).
 *
 * Keyed by slot index on the controller and mutated in place by `chooseSlot`, the same shape as
 * `lastPressTick` — `chooseSlot` itself stays otherwise stateless. `holding` is rolled ONCE when a
 * slot enters a bad-moment episode, then reused verbatim every subsequent tick that episode is
 * still running: re-rolling every recompute would make even a 90%-disciplined tier's "hold" decay
 * geometrically to a certainty of firing (0.9^n keeps falling with every extra evaluation), which is
 * a coin that never stops flipping, not discipline. The episode ends — and the memo is cleared, so
 * the NEXT bad moment gets its own fresh roll — the moment the slot goes not-ready (fired, or still
 * mid-recharge) or the target changes; the moment turning good also clears it, because a good moment
 * is the episode resolving by firing, not by continuing to hold.
 */
export interface UltHoldEntry {
  targetSessionId: string;
  holding: boolean;
}

/**
 * Which one slot to press this tick (H27).
 *
 * `beginFire` resolves at most one press per tick and takes the LOWEST set bit it can use, so a bot
 * that ORs every in-range slot fires slot 0 and essentially nothing else. Ranking and returning one
 * slot is what lets a chassis actually use its kit.
 *
 * Draws exactly two random numbers, always, in this order: the discipline roll and the ult roll —
 * this NEVER changes, regardless of whether the ult roll's value ends up used (H21): a draw that
 * only happens on some ticks would make the stream depend on the branch.
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
  /** Per-slot ult discipline memo, owned and persisted by the caller (H30). Mutated in place. */
  ultHold: Map<number, UltHoldEntry>;
  /** Held situation (S18). Absent means rank as a normal fight — used by unit tests. */
  situation?: SituationId;
  roles?: KitRoles;
  /** Slot to keep pressing while stickiness lasts (S15). */
  stuckSlot?: number;
}): FireDecision {
  const { self, target, distance, aimDelta, profile, weights, tick, rng, ultHold } = args;

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
    if (!slotIsReady(slot, tick)) {
      // Not ready: fired, or still mid-recharge. The episode that memo belonged to is over — the
      // next time this slot is ready is a fresh one, and earns its own roll (H30).
      ultHold.delete(i);
      continue;
    }

    const reach = weaponReachOf(slot.weaponId);
    if (distance > reach) continue;

    const def = weaponDefOf(slot.weaponId);

    let windowBonus = 1;
    if (isUlt(slot)) {
      const goodMoment =
        targetHpFraction <= profile.ultWindowHpFraction ||
        targetStunned ||
        args.situation === "punish";
      if (goodMoment) {
        // The moment turning good resolves the episode by firing (the whole point of holding), so
        // there is no held decision left to carry forward (H30).
        ultHold.delete(i);
        // And the ult has to be able to WIN the ranking, or "saves it for a stunned target" is
        // unobservable: every ult on this roster is worth less per second than the slot beside it
        // (lance ~10.8/s against predator's 30/s), so raw value would pick the small gun forever
        // and discipline would only ever read as "never fires the ult".
        windowBonus = ULT_WINDOW_BONUS;
      } else {
        // Discipline is the probability of HOLDING when the moment is not good (H30) — rolled ONCE
        // per (target, ready) episode and held from there, not re-rolled every recompute.
        const memo = ultHold.get(i);
        const holding = memo && memo.targetSessionId === target.sessionId
          ? memo.holding
          : ultRoll < profile.ultDisciplineChance;
        if (!memo || memo.targetSessionId !== target.sessionId) {
          ultHold.set(i, { targetSessionId: target.sessionId, holding });
        }
        if (holding) continue;
      }
    } else if (distance > reach * 0.9 && disciplineRoll < profile.fireDisciplineChance) {
      // A marginal shot at the very edge of reach: a disciplined bot waits, a sprayer takes it (H29).
      continue;
    }

    // Prefer the weapon that is worth the most and fits the current distance best, then apply
    // the held situation's preference (S15).
    const fit = 1 - Math.min(distance / reach, 1) * 0.5;
    let score = weaponValueOf(slot, weights[i] ?? 1) * fit * windowBonus;
    const situation = args.situation;
    const roles = args.roles;
    if (situation === "punish" && roles?.setupCcSlot === i && targetStunned) score -= 500;
    if (args.stuckSlot === i) score += 200;
    if (self.lockTargetSessionId === target.sessionId && def.usesAimAssist) score += 50;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return { slot: best };
}
