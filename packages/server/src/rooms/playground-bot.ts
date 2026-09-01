import type { InputMessage } from "@motor-combat-moba/shared";

/** The only pieces of a car's state the bot needs to aim and drive: position and heading. */
export interface BotPose {
  x: number;
  y: number;
  angle: number;
}

/** Tuning for the playground bot's aim, standoff and fire decisions. */
export const BOT_CONFIG = Object.freeze({
  aimToleranceRad: 0.3,
  standoffUnits: 70,
  fireConeRad: 0.35,
});

/**
 * One tick of bot intent, ported from the LAN probe's chaser (`playtest/lan.ts` ~line 97):
 * signed shortest angle delta to the target decides `steer`, distance decides `throttle`, and a
 * slot fires when the target is both inside the fire cone and inside that slot's own range.
 *
 * `target: null` — alone mode, or the target has died — coasts: everything zero.
 */
export function botInput(
  seq: number,
  self: BotPose,
  target: BotPose | null,
  slotRanges: readonly number[],
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
    delta > BOT_CONFIG.aimToleranceRad ? 1 : delta < -BOT_CONFIG.aimToleranceRad ? -1 : 0;

  const distance = Math.hypot(dx, dy);
  const throttle: -1 | 0 | 1 = distance > BOT_CONFIG.standoffUnits ? 1 : -1;

  let fireSlots = 0;
  if (Math.abs(delta) < BOT_CONFIG.fireConeRad) {
    for (let i = 0; i < slotRanges.length; i++) {
      if (distance < slotRanges[i]) fireSlots |= 1 << i;
    }
  }

  return { seq, steer, throttle, fireSlots };
}
