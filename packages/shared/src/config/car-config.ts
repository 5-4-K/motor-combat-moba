import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { RAM_CONFIG } from "./ram-config.js";
import type { CarDef, CarId } from "./types.js";

/**
 * The roster. Every rating is an integer 0-100 with 50 as average.
 *
 * The three types (T1): **Mirage** is the all-round speedster — highest speed and accel,
 * above-average handling since 2026-08-31, the lightest-armoured glass cannon on offense but
 * middling hp. Its `handling` was 50 until then; 60 pulled its turn radius in from 91.4 u to 84.2 u
 * without cutting its speed, and it is still the widest arc on the roster. **Bullseye** is the
 * light, precise skirmisher — the roster's lowest hp and mass, modest speed and accel, and the
 * lowest handling (T6: a low turn RATE, not a tight turn RADIUS — see below). **Bastion** is the
 * tank — lowest speed and accel by far, the roster's highest hp and mass, and paradoxically the
 * highest handling of the three, which is what lets it out-turn faster chassis despite being the
 * slowest (T6).
 *
 * Ratings used to be held to a 150-point budget across speed/attack/hp, which was the roster's only
 * automatic guard against a fourth chassis being authored strictly better than these three. That
 * budget was deliberately removed on 2026-08-29 so `mass` could be a free-floating fourth axis, and
 * no replacement guard was adopted. Roster fairness is a review-time judgement from here on.
 *
 * `attack` is not damage. It is a percentage modifier on whatever weapon the car is firing, applied
 * by `damageFor` (`sim/damage.ts`): 0.5x at rating 0, 1.0x at 50, 1.5x at 100.
 *
 * `handling` is turn RATE, not turn radius (T7) — `turnRateOf` reads it directly (`baseTurnRate +
 * handling * turnRatePerRating`). Turn radius is a derived quantity, `forwardMaxSpeedOf(id) /
 * turnRateOf(id)`, so a chassis with a high `speed` rating and only average `handling` still corners
 * wide: raising speed without raising handling to match is what makes a car feel less agile despite
 * a higher ceiling. `accel` is likewise fed straight into `accelOf`.
 *
 * `mass` is not durability. It scales how hard this chassis rams and how easily it is rammed, and it
 * touches nothing else — see `RAM_CONFIG.massPerRating`.
 *
 * **Changing a car's `handling` or `speed` also owes `docs/turn-tuning.md` an edit**, and a fourth
 * chassis owes it a new column in two tables. That page tabulates every turn rate and radius on the
 * roster by hand, and `scripts/turn-tuning-doc.test.mjs` recomputes every cell from this table — it
 * fails until the page agrees. See its "Keeping this page honest" section.
 *
 * `weapons` is the chassis's kit in slot order, and the kits are EXCLUSIVE: no weapon id appears on
 * two chassis (L1). `weapon-slots.test.ts` enforces that, so moving a weapon between chassis means
 * swapping a pair, never copying one.
 */
export const CAR_TABLE = {
  mirage: { id: "mirage", name: "Mirage", speed: 88, accel: 85, handling: 60, attack: 63, hp: 48, mass: 48, weapons: ["predator", "thunderclap", "afterburner"] },
  bullseye: { id: "bullseye", name: "Bullseye", speed: 52, accel: 45, handling: 28, attack: 55, hp: 30, mass: 30, weapons: ["shockwave", "pepperbox", "lance"] },
  bastion: { id: "bastion", name: "Bastion", speed: 30, accel: 20, handling: 82, attack: 42, hp: 82, mass: 90, weapons: ["thumper", "roadblock", "wildcharge"] },
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
