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
 */
export const CAR_TABLE = {
  rectangle: { id: "rectangle", name: "Rectangle", speed: 80, attack: 30, hp: 40, mass: 35, weapons: ["fireball"] },
  oval: { id: "oval", name: "Oval", speed: 50, attack: 70, hp: 30, mass: 45, weapons: ["fireball"] },
  hexagon: { id: "hexagon", name: "Hexagon", speed: 30, attack: 50, hp: 70, mass: 85, weapons: ["fireball"] },
} as const satisfies Record<CarId, CarDef>;

/**
 * The chassis driven by anyone who has no valid `carId` yet — pre-reveal lobby players, and anything
 * unrecognised on the wire. Server tick and client prediction must agree on this: a fallback that
 * differed between them would silently drive two different cars and read as constant desync.
 */
export const DEFAULT_CAR_ID: CarId = "rectangle";

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
