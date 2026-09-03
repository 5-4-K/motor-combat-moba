import type { BotDifficulty } from "@motor-combat-moba/shared";

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
 * The bot's difficulty tiers (spec PR17). These were a developer's tuning aid until practice mode
 * shipped; they are now balance a player judges, which is why they live in `config/` beside the rest
 * of the balance surface rather than inside a room helper.
 *
 * `hard` is frozen (PR18): it is EXACTLY the bot that shipped, and `bot.test.ts` pins its six numbers
 * by value. Only `easy` and `medium` may be retuned.
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
