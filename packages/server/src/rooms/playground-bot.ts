import type { BotDifficulty, InputMessage } from "@motor-combat-moba/shared";

/** The only pieces of a car's state the bot needs to aim and drive: position and heading. */
export interface BotPose {
  x: number;
  y: number;
  angle: number;
}

/** One difficulty's knobs (PG27). Three for pressure, two for accuracy, one for rate of fire. */
export interface BotProfile {
  /** Distance the bot tries to hold. */
  readonly standoffUnits: number;
  /** Half-width of a band around `standoffUnits` where throttle is 0 — the bot coasts instead of
   * charging or reversing. 0 reproduces the pre-split behaviour exactly. */
  readonly deadbandUnits: number;
  /** How often the ROOM recomputes intent, holding the previous one in between (PG29). Read there,
   * not here: `botInput` stays a pure function of the pose it is handed. */
  readonly reactionTicks: number;
  /** Steering deadzone. Wider settles further off target. MUST stay below `fireConeRad`. */
  readonly aimToleranceRad: number;
  /** How well aimed the bot must be to fire. */
  readonly fireConeRad: number;
  /** Fire-mask pulse cadence, also read by the room (PG29). */
  readonly firePeriodTicks: number;
}

/**
 * The three difficulties (PG27).
 *
 * `hard` is EXACTLY the bot that shipped — the old `BOT_CONFIG` plus the old `OPPONENT_FIRE_PERIOD`
 * — and `playground-bot.test.ts` pins those six numbers by value so it stays that way.
 *
 * `aimToleranceRad < fireConeRad` on every row, and a test asserts it: tolerance is the deadzone the
 * bot stops steering inside, the cone is the gate it must be inside to fire, so a row with the
 * inequality backwards produces a bot that settles happily at a heading it can never shoot from.
 * Easy widens BOTH — it settles further off target and is willing to shoot from there — but that is
 * the weakest of the six levers, because `resolveAimAngle` rotates a shot toward a locked target for
 * any weapon with `usesAimAssist`. The pressure knobs and `firePeriodTicks` do the real work.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({
    standoffUnits: 170,
    deadbandUnits: 60,
    reactionTicks: 6,
    aimToleranceRad: 0.55,
    fireConeRad: 0.6,
    firePeriodTicks: 10,
  }),
  medium: Object.freeze({
    standoffUnits: 110,
    deadbandUnits: 30,
    reactionTicks: 3,
    aimToleranceRad: 0.42,
    fireConeRad: 0.48,
    firePeriodTicks: 5,
  }),
  hard: Object.freeze({
    standoffUnits: 70,
    deadbandUnits: 0,
    reactionTicks: 1,
    aimToleranceRad: 0.3,
    fireConeRad: 0.35,
    firePeriodTicks: 2,
  }),
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
      if (distance < slotRanges[i]) fireSlots |= 1 << i;
    }
  }

  return { seq, steer, throttle, fireSlots };
}
