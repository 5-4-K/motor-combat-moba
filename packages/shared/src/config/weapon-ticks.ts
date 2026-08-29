import { TICK_RATE_HZ } from "../constants.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import type { WeaponDef, WeaponId } from "./weapon-types.js";

/**
 * Milliseconds to whole ticks, rounded up so an authored duration is never *shorter* than written.
 * At 30 Hz a tick is 33.3ms, so `250` becomes 8 ticks (266ms). That rounding is the documented
 * cost of authoring in ms; it happens here, once, and nowhere else.
 */
export function msToTicks(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil((ms * TICK_RATE_HZ) / 1000);
}

/** Every duration a weapon has, in the integer ticks the sim actually counts. */
export interface WeaponTicks {
  startUp: number;
  cooldown: number;
  recovery: number;
  /** From `stock.refireDelayMs`; 0 when the weapon is single-stock. */
  refireDelay: number;
  /** Beams only: linger after full extension. 0 for projectiles. */
  lifetime: number;
  /** `Infinity` when `damageFrequencyMs` is 0 — one hit per target, ever. */
  damageInterval: number;
  volleyInterval: number;
  /** Projectiles: ticks to cross `range`. Beams: ticks to reach full extension. */
  flight: number;
}

function ticksFor(def: WeaponDef): WeaponTicks {
  return {
    startUp: msToTicks(def.startUpMs),
    cooldown: msToTicks(def.cooldownMs),
    recovery: msToTicks(def.recoveryMs),
    refireDelay: def.stock ? msToTicks(def.stock.refireDelayMs) : 0,
    lifetime: def.kind === "beam" ? msToTicks(def.lifetimeMs) : 0,
    damageInterval:
      def.damageFrequencyMs === 0 ? Number.POSITIVE_INFINITY : msToTicks(def.damageFrequencyMs),
    volleyInterval: def.kind === "projectile" ? msToTicks(def.volley.volleyIntervalMs) : 0,
    flight: Math.ceil((def.range / def.speed) * TICK_RATE_HZ),
  };
}

/**
 * Derived once at module load and frozen. Server and client both import shared's built `dist`, so
 * both compute identical tick counts or neither does — which is what keeps ms-authored balance
 * safe for a lockstep sim.
 */
export const WEAPON_TICKS: Readonly<Record<WeaponId, WeaponTicks>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(WEAPON_TABLE) as WeaponId[]).map((id) => [id, Object.freeze(ticksFor(WEAPON_TABLE[id]))]),
  ) as Record<WeaponId, WeaponTicks>,
);

export function weaponTicksOf(id: WeaponId): WeaponTicks {
  return WEAPON_TICKS[id];
}

/**
 * A tick count seen through the `weaponCooldown` channel: below 1 is faster, above 1 slower.
 *
 * Applied only to the three "when may I shoot again" clocks — `cooldown`, `refireDelay` and
 * `recovery` — at the two sites in `fire.ts` that read them. Wind-up and the gap between a burst's
 * volleys are deliberately left alone: those are the shape of one press, and a haste buff that
 * compressed them would change what a weapon *is* rather than how often you get it.
 *
 * The three pass-through cases each matter. `0` stays 0: a weapon with no recovery must not acquire
 * one from a debuff. `Infinity` stays infinite (`damageInterval`'s "once per target, ever"). A
 * non-positive or non-finite multiplier is ignored, so a bad config value costs the effect rather
 * than freezing a weapon. Everything else floors at 1 — a scaled clock may never round to 0 and
 * hand a weapon a free shot the table never authored.
 */
export function scaleTicks(ticks: number, multiplier: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return ticks;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return ticks;
  return Math.max(1, Math.round(ticks * multiplier));
}
