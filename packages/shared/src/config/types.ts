import type { WeaponId } from "./weapon-types.js";

export type CarId = "rectangle" | "oval" | "hexagon";
export interface CarDef {
  id: CarId;
  name: string;
  speed: number;
  attack: number;
  hp: number;
  /** Ordered loadout: index 0 is slot 1. Order IS the slot mapping. */
  weapons: readonly WeaponId[];
}
export interface ColorDef {
  colorId: number;
  name: string;
  hex: string;
}
