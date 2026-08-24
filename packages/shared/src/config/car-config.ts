import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import type { CarDef, CarId } from "./types.js";

export const CAR_TABLE = {
  rectangle: { id: "rectangle", name: "Rectangle", speed: 8, strength: 3, hp: 5 },
  oval: { id: "oval", name: "Oval", speed: 5, strength: 8, hp: 3 },
  hexagon: { id: "hexagon", name: "Hexagon", speed: 3, strength: 5, hp: 8 },
} as const satisfies Record<CarId, CarDef>;

export function hpOf(id: CarId): number {
  return CAR_TABLE[id].hp * COMBAT_CONFIG.hpPerRating;
}

export function forwardMaxSpeedOf(id: CarId): number {
  return DRIVE_CONFIG.baseMaxSpeed + CAR_TABLE[id].speed * DRIVE_CONFIG.speedPerRating;
}

export function reverseMaxSpeedOf(id: CarId): number {
  return forwardMaxSpeedOf(id) * DRIVE_CONFIG.reverseSpeedRatio;
}
