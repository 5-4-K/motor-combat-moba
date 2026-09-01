import { TICK_RATE_HZ } from "../constants.js";
import { STATUS_CONFIG } from "./status-config.js";
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
  /** Homing guidance window; 0 for a non-homing weapon. */
  homingDuration: number;
  /** Bounce flight clock; 0 for a non-bouncing weapon. */
  bounceLifetime: number;
  /** Charge duration; 0 for anything that is not a charge maneuver. */
  maneuverDuration: number;
  /**
   * How long each of this weapon's `applies` entries lasts, in ticks, positionally parallel to
   * `WeaponDef.applies`. Empty for a weapon that applies nothing.
   *
   * Derived here rather than at the application site for the same reason every other duration is:
   * milliseconds become ticks exactly once, at module load, so the two halves of the lockstep can
   * never round differently. Clamped to `STATUS_CONFIG.maxDurationMs` before conversion, so a
   * mis-authored row is shortened rather than left to outlive the match.
   */
  applyDurations: readonly number[];
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
    volleyInterval: msToTicks(def.volley.volleyIntervalMs),
    flight: def.kind === "maneuver" ? 0 : Math.ceil((def.range / def.speed) * TICK_RATE_HZ),
    homingDuration: def.kind === "projectile" && def.homing ? msToTicks(def.homing.durationMs) : 0,
    bounceLifetime: def.kind === "projectile" && def.bounce ? msToTicks(def.bounce.lifetimeMs) : 0,
    maneuverDuration:
      def.kind === "maneuver" && def.maneuver.type === "charge" ? msToTicks(def.maneuver.durationMs) : 0,
    applyDurations: Object.freeze(
      (def.applies ?? []).map((a) => msToTicks(Math.min(a.durationMs, STATUS_CONFIG.maxDurationMs))),
    ),
  };
}

/**
 * Derived once at module load and frozen. Server and client both import shared's built `dist`, so
 * both compute identical tick counts or neither does — which is what keeps ms-authored balance
 * safe for a lockstep sim.
 */
export const WEAPON_TICKS: Readonly<Record<WeaponId, WeaponTicks>> = resolveTicks();

function resolveTicks(): Readonly<Record<WeaponId, WeaponTicks>> {
  return Object.freeze(
    Object.fromEntries(
      (Object.keys(WEAPON_TABLE) as WeaponId[]).map((id) => [id, Object.freeze(ticksFor(WEAPON_TABLE[id]))]),
    ) as Record<WeaponId, WeaponTicks>,
  );
}

/** `WEAPON_TICKS` itself until playground tuning overrides a weapon row, and again once it clears. */
let ACTIVE_TICKS: Readonly<Record<WeaponId, WeaponTicks>> = WEAPON_TICKS;

export function weaponTicksOf(id: WeaponId): WeaponTicks {
  return ACTIVE_TICKS[id];
}

/**
 * Playground tuning only (spec PG12) — see `rebuildResolvedDrive` for why `hasOverrides` is passed
 * in rather than read back from the tuning store.
 */
export function rebuildWeaponTicks(hasOverrides: boolean): void {
  ACTIVE_TICKS = hasOverrides ? resolveTicks() : WEAPON_TICKS;
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
