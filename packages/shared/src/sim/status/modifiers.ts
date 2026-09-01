import { STATUS_LIMITS, statusDefOf } from "../../config/status-config.js";
import type { StatusChannel, StatusFlag } from "../../config/status-types.js";
import type { ActiveStatus } from "./statuses.js";

/**
 * One car's statuses, collapsed into the numbers the sim reads.
 *
 * This is the whole interface between the status system and the rest of the tick. Nothing outside
 * this module looks at a status list to decide anything: driving, ramming and combat each read a
 * `Modifiers` and nothing else, which is why adding a status never touches the sim and adding a
 * channel touches exactly one call site.
 */
export interface Modifiers {
  topSpeed: number;
  accel: number;
  turnRate: number;
  brakeDecel: number;
  damageDealt: number;
  damageTaken: number;
  weaponCooldown: number;
  ramMass: number;
  /** Throttle forced to neutral. Steering, braking and drag are untouched. */
  immobilised: boolean;
  /** Steer input forced to 0. Injected ram spin is untouched. */
  steeringLocked: boolean;
  /** No new press may be committed. A press already committed still finishes — see `runCombat`. */
  disarmed: boolean;
  /** Speed forced to 0 every tick, after `stepDrive`'s normal integration runs. Shove is untouched. */
  fullStop: boolean;
  /** Every combat damage site deals 0 hp to this car. Riders (statuses, pierce) still land. */
  invulnerable: boolean;
  /** Not present in the world: no collision, no ram, no weapon target. See StatusFlag. */
  phased: boolean;
}

/**
 * A car in no status at all.
 *
 * Every multiplier is exactly 1 and every flag false, so a sim step taken with these is
 * arithmetically identical to the same step before the status system existed. That is the property
 * `golden.test.ts` pins, and it is why every channel is a multiplier rather than an additive term.
 *
 * Frozen and shared: it is read on most ticks by most cars and never written.
 */
export const NEUTRAL_MODIFIERS: Readonly<Modifiers> = Object.freeze({
  topSpeed: 1,
  accel: 1,
  turnRate: 1,
  brakeDecel: 1,
  damageDealt: 1,
  damageTaken: 1,
  weaponCooldown: 1,
  ramMass: 1,
  immobilised: false,
  steeringLocked: false,
  disarmed: false,
  fullStop: false,
  invulnerable: false,
  phased: false,
});

const CHANNELS = Object.keys(STATUS_LIMITS) as StatusChannel[];

/**
 * Collapse a car's active statuses into its modifiers, as of `tick`.
 *
 * Multipliers compose by multiplication, then clamp to `STATUS_LIMITS`. Flags OR together. Both are
 * order-independent, so the result cannot depend on the order statuses landed in or on the order the
 * list happens to be stored in.
 *
 * A status never contributes twice: one id on one car is exactly one instance at exactly the
 * strength its row states. Two *different* statuses touching the same channel do stack, which is the
 * only stacking the system has.
 *
 * **Expired entries are skipped rather than trusted.** The authoritative expiry pass runs once a
 * tick on the server, but the client reads this same list off a schema patch that can be up to a
 * patch behind (20 Hz patches against a 30 Hz sim), so a client would otherwise predict one or two
 * ticks of a status the server has already dropped. Filtering here means the two sides agree on the
 * tick, not on the patch — the same reason the HUD reads `tick < pendingUntilTick` rather than a
 * boolean.
 *
 * An unrecognised id has already been dropped by `toActiveStatuses`, so nothing here can reach an
 * undefined def.
 */
export function modifiersOf(statuses: readonly ActiveStatus[], tick: number): Modifiers {
  const mods: Modifiers = { ...NEUTRAL_MODIFIERS };
  const flags = new Set<StatusFlag>();
  let any = false;

  for (const status of statuses) {
    if (status.endsTick <= tick) continue;
    any = true;
    const def = statusDefOf(status.statusId);
    for (const channel of CHANNELS) {
      const value = def.modifiers[channel];
      if (value === undefined) continue;
      mods[channel] *= value;
    }
    for (const flag of def.flags ?? []) flags.add(flag);
  }

  if (!any) return { ...NEUTRAL_MODIFIERS };

  for (const channel of CHANNELS) {
    const limit = STATUS_LIMITS[channel];
    mods[channel] = Math.min(limit.max, Math.max(limit.min, mods[channel]));
  }
  mods.immobilised = flags.has("immobilised");
  mods.steeringLocked = flags.has("steeringLocked");
  mods.disarmed = flags.has("disarmed");
  mods.fullStop = flags.has("fullStop");
  mods.invulnerable = flags.has("invulnerable");
  mods.phased = flags.has("phased");
  return mods;
}
