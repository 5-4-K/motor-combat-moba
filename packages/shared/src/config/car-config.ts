import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import type { CarDef, CarId } from "./types.js";

export const CAR_TABLE = {
  rectangle: { id: "rectangle", name: "Rectangle", speed: 8, strength: 3, hp: 5, weapons: ["fireball"] },
  oval: { id: "oval", name: "Oval", speed: 5, strength: 8, hp: 3, weapons: ["fireball"] },
  hexagon: { id: "hexagon", name: "Hexagon", speed: 3, strength: 5, hp: 8, weapons: ["fireball"] },
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
