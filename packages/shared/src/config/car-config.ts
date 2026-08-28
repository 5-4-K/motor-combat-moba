import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import type { CarDef, CarId } from "./types.js";

/**
 * The roster. Every rating is an integer 0-100 with 50 as average, and the three **must sum to
 * exactly 150** — the budget is what stops a fourth car being authored strictly better than these
 * three, and `config.test.ts` enforces it.
 *
 * `attack` is not damage. It is a percentage modifier on whatever weapon the car is firing, applied
 * by `damageFor` (`sim/damage.ts`): 0.5x at rating 0, 1.0x at 50, 1.5x at 100.
 *
 * `weapons` is the chassis's kit in slot order, and the kits are EXCLUSIVE: no weapon id appears on
 * two chassis (L1). `weapon-slots.test.ts` enforces that, so moving a weapon between chassis means
 * swapping a pair, never copying one.
 */
export const CAR_TABLE = {
  rectangle: { id: "rectangle", name: "Rectangle", speed: 80, attack: 30, hp: 40, weapons: ["fireball", "pepperbox", "afterburner"] },
  oval: { id: "oval", name: "Oval", speed: 50, attack: 70, hp: 30, weapons: ["splinter", "skewer", "lance"] },
  hexagon: { id: "hexagon", name: "Hexagon", speed: 30, attack: 50, hp: 70, weapons: ["thumper", "shockwave", "bulwark"] },
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
