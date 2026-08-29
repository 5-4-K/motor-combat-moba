import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { RAM_CONFIG } from "./ram-config.js";
import type { CarDef, CarId } from "./types.js";

/**
 * The roster. Every rating is an integer 0-100 with 50 as average.
 *
 * Ratings used to be held to a 150-point budget across speed/attack/hp, which was the roster's only
 * automatic guard against a fourth chassis being authored strictly better than these three. That
 * budget was deliberately removed on 2026-08-29 so `mass` could be a free-floating fourth axis, and
 * no replacement guard was adopted. Roster fairness is a review-time judgement from here on.
 *
 * `attack` is not damage. It is a percentage modifier on whatever weapon the car is firing, applied
 * by `damageFor` (`sim/damage.ts`): 0.5x at rating 0, 1.0x at 50, 1.5x at 100.
 *
 * `mass` is not durability. It scales how hard this chassis rams and how easily it is rammed, and it
 * touches nothing else — see `RAM_CONFIG.massPerRating`.
 *
 * `weapons` is the chassis's kit in slot order, and the kits are EXCLUSIVE: no weapon id appears on
 * two chassis (L1). `weapon-slots.test.ts` enforces that, so moving a weapon between chassis means
 * swapping a pair, never copying one.
 */
export const CAR_TABLE = {
  mirage: { id: "mirage", name: "Mirage", speed: 80, attack: 30, hp: 40, mass: 35, accel: 50, handling: 50, weapons: ["fireball", "pepperbox", "afterburner"] },
  bullseye: { id: "bullseye", name: "Bullseye", speed: 50, attack: 70, hp: 30, mass: 45, accel: 50, handling: 50, weapons: ["needler", "skewer", "lance"] },
  bastion: { id: "bastion", name: "Bastion", speed: 30, attack: 50, hp: 70, mass: 85, accel: 50, handling: 50, weapons: ["thumper", "shockwave", "bulwark"] },
} as const satisfies Record<CarId, CarDef>;

/**
 * The chassis driven by anyone who has no valid `carId` yet — pre-reveal lobby players, and anything
 * unrecognised on the wire. Server tick and client prediction must agree on this: a fallback that
 * differed between them would silently drive two different cars and read as constant desync.
 */
export const DEFAULT_CAR_ID: CarId = "mirage";

/**
 * Own-property check, deliberately not `value in CAR_TABLE`: `in` walks the prototype chain, so
 * inherited names like `"constructor"` and `"toString"` would pass as car ids and then resolve to
 * undefined stats, NaN-ing every derived number below.
 */
export function isCarId(value: unknown): value is CarId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CAR_TABLE, value);
}

export function hpOf(id: CarId): number {
  return CAR_TABLE[id].hp * COMBAT_CONFIG.hpPerRating;
}

export function forwardMaxSpeedOf(id: CarId): number {
  return DRIVE_CONFIG.baseMaxSpeed + CAR_TABLE[id].speed * DRIVE_CONFIG.speedPerRating;
}

export function reverseMaxSpeedOf(id: CarId): number {
  return forwardMaxSpeedOf(id) * DRIVE_CONFIG.reverseSpeedRatio;
}

export function turnRateOf(id: CarId): number {
  return DRIVE_CONFIG.baseTurnRate + CAR_TABLE[id].handling * DRIVE_CONFIG.turnRatePerRating;
}

export function turnRateAtStopOf(id: CarId): number {
  return turnRateOf(id) * DRIVE_CONFIG.stopTurnRatio;
}

export function accelOf(id: CarId): number {
  return DRIVE_CONFIG.baseAccel + CAR_TABLE[id].accel * DRIVE_CONFIG.accelPerRating;
}

export function reverseAccelOf(id: CarId): number {
  return accelOf(id) * DRIVE_CONFIG.reverseAccelFactor;
}

export function massOf(id: CarId): number {
  return CAR_TABLE[id].mass * RAM_CONFIG.massPerRating;
}

/**
 * The mass of a chassis rated exactly average. Ram severity is measured against this, so a rating of
 * 50 at top speed is the natural "1.0 severity" anchor rather than an arbitrary number.
 */
export const RAM_REFERENCE_MASS = 50 * RAM_CONFIG.massPerRating;

/**
 * The momentum that saturates ram severity: an average-mass chassis travelling at the roster's
 * highest top speed. Derived, never typed — raising `baseMaxSpeed` or a car's `speed` rating moves
 * this with it, so ram severity stays anchored to what a car can actually achieve.
 */
export const RAM_REFERENCE =
  RAM_REFERENCE_MASS *
  Math.max(...(Object.keys(CAR_TABLE) as CarId[]).map((id) => forwardMaxSpeedOf(id)));

/**
 * Everything `stepDrive` needs to move one chassis for one tick, resolved from the roster and the
 * drive scales.
 *
 * The sim receives this instead of a `CarId` on purpose. `stepDrive` used to read `CAR_TABLE`
 * itself, which welded the drive integration to the roster: retuning a car's rating moved numbers
 * inside `golden.test.ts`, whose whole job is proving the integration has NOT changed. With the
 * chassis passed in, that suite pins the equation against a fixed set of constants and stays honest
 * through every future balance edit.
 */
export interface ChassisDrive {
  maxSpeed: number;
  reverseMaxSpeed: number;
  accel: number;
  reverseAccel: number;
  turnRate: number;
  turnRateAtStop: number;
}

/**
 * Resolved once at module load and frozen, mirroring `WEAPON_TICKS`. `stepSim` runs this lookup for
 * every player every tick on both halves of the lockstep, so it must not allocate.
 */
export const CHASSIS_DRIVE: Readonly<Record<CarId, ChassisDrive>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(CAR_TABLE) as CarId[]).map((id) => [
      id,
      Object.freeze({
        maxSpeed: forwardMaxSpeedOf(id),
        reverseMaxSpeed: reverseMaxSpeedOf(id),
        accel: accelOf(id),
        reverseAccel: reverseAccelOf(id),
        turnRate: turnRateOf(id),
        turnRateAtStop: turnRateAtStopOf(id),
      }),
    ]),
  ) as Record<CarId, ChassisDrive>,
);

export function driveOf(id: CarId): ChassisDrive {
  return CHASSIS_DRIVE[id];
}
