import type { InputMessage } from "@motor-combat-moba/shared";
import type { BotProfile } from "../config/bot-profiles.js";

export type { BotProfile } from "../config/bot-profiles.js";
export { BOT_PROFILES } from "../config/bot-profiles.js";

/** The only pieces of a car's state the bot needs to aim and drive: position and heading. */
export interface BotPose {
  x: number;
  y: number;
  angle: number;
}

/**
 * How close the target must be for the bot to press a slot.
 *
 * A weapon that authors a real reach is gated on that reach. A weapon with NO reach of its own is
 * gated on the distance this bot chooses to fight at instead — the outer edge of the band it
 * holds (`standoffUnits + deadbandUnits`), so the press lands while the target is somewhere the
 * effect can plausibly reach, and scales with the tier rather than with a number invented here.
 *
 * `wildcharge` is the roster's only `range: 0` row (a charge dashes nowhere — it damages through
 * driven hull contact inside its window, never through a spawned shot). Gating it on its own range
 * meant gating it on `distance < 0`, which no distance satisfies, so no bot had ever pressed it:
 * Bastion played every room and every balance run with two thirds of its kit. This is the fix, and
 * it is the ONE place `LegacyController` knowingly departs from the bot that shipped.
 */
export function triggerRangeOf(range: number, profile: BotProfile): number {
  if (range > 0) return range;
  return profile.standoffUnits + profile.deadbandUnits;
}

/**
 * One tick of bot intent, ported from the LAN probe's chaser (`playtest/lan.ts` ~line 97):
 * signed shortest angle delta to the target decides `steer`, distance decides `throttle`, and a
 * slot fires when the target is both inside the fire cone and inside that slot's trigger range
 * (`triggerRangeOf` above — its own reach, or the standoff band for a weapon that has none).
 *
 * `target: null` — alone mode, or the target has died — coasts: everything zero.
 */
export function botInput(
  seq: number,
  self: BotPose,
  target: BotPose | null,
  slotRanges: readonly number[],
  profile: BotProfile,
): InputMessage {
  if (target === null) {
    return { seq, steer: 0, throttle: 0, fireSlots: 0 };
  }

  const dx = target.x - self.x;
  const dy = target.y - self.y;
  const bearing = Math.atan2(dy, dx);
  // Signed shortest delta: a raw subtraction can read as a near-2*pi turn at the +-pi seam, which
  // would steer the long way. atan2(sin(d), cos(d)) wraps it back into (-pi, pi].
  const delta = Math.atan2(Math.sin(bearing - self.angle), Math.cos(bearing - self.angle));

  const steer: -1 | 0 | 1 =
    delta > profile.aimToleranceRad ? 1 : delta < -profile.aimToleranceRad ? -1 : 0;

  const distance = Math.hypot(dx, dy);
  // Coast inside the deadband rather than charging or reversing (PG28). The old expression was
  // `distance > standoff ? 1 : -1`, which at the standoff distance oscillates between full ahead and
  // full astern every tick — a large part of what made the one shipped bot feel relentless.
  //
  // The `deadbandUnits > 0` term is load-bearing, not defensive: at exactly `standoffUnits` a zero
  // band still satisfies `Math.abs(0) <= 0`, so without it hard would COAST where it used to
  // reverse. Testing the band for width first is what makes `deadbandUnits: 0` reproduce the old
  // expression exactly, which is the whole basis of "hard is the bot that shipped".
  const inDeadband =
    profile.deadbandUnits > 0 &&
    Math.abs(distance - profile.standoffUnits) <= profile.deadbandUnits;
  const throttle: -1 | 0 | 1 = inDeadband ? 0 : distance > profile.standoffUnits ? 1 : -1;

  let fireSlots = 0;
  if (Math.abs(delta) < profile.fireConeRad) {
    for (let i = 0; i < slotRanges.length; i++) {
      if (distance < triggerRangeOf(slotRanges[i], profile)) fireSlots |= 1 << i;
    }
  }

  return { seq, steer, throttle, fireSlots };
}

/**
 * Should the bot recompute its intent this tick, or re-enqueue the one it is holding (PG29)?
 *
 * A cleared hold always recomputes: a setup change, a bot toggled off and back on, or a dead target
 * drops the held intent, and waiting out the rest of the interval would enqueue a decision made
 * against a pose from before the change. A non-positive cadence recomputes every tick rather than
 * dividing by zero — the table cannot produce one, and a modulo by zero is `NaN`, which is falsy and
 * would freeze the bot on its last intent forever.
 */
export function shouldRecomputeIntent(
  tick: number,
  reactionTicks: number,
  hasHeldIntent: boolean,
): boolean {
  if (!hasHeldIntent) return true;
  if (reactionTicks <= 1) return true;
  return tick % reactionTicks === 0;
}

/**
 * The fire bits that actually reach the wire this tick (PG29).
 *
 * `serverTick` counts only newly-set bits as a press (`clean & ~prev`), so a bot holding the same
 * bits fires each slot ONCE and then never again; `respawnPlayer` does not clear `prevFireMasks`
 * either, so a killed bot comes back still latched. Zeroing the bits off-pulse turns every pulse
 * tick into a fresh press edge. It does not make the bot fire faster than its weapons allow —
 * stocks, recharges and the switch lock still bound the rate, and feeling those is the point.
 */
export function pulsedFireSlots(tick: number, firePeriodTicks: number, fireSlots: number): number {
  if (firePeriodTicks <= 1) return fireSlots;
  return tick % firePeriodTicks === 0 ? fireSlots : 0;
}
