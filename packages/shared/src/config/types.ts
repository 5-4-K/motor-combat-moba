import type { GameMode } from "../constants.js";
import type { WeaponId } from "./weapon-types.js";

export type CarId = "bullseye" | "mirage" | "bastion";
export interface CarDef {
  id: CarId;
  name: string;
  speed: number;
  attack: number;
  hp: number;
  /**
   * Ram weight, 0-100. Affects ramming and NOTHING else — never acceleration, never top speed.
   * Scaled to real mass by `RAM_CONFIG.massPerRating`.
   */
  mass: number;
  /**
   * Engine push, 0-100. Scaled to units/s^2 by `accelOf`. Independent of `speed`: this roster's
   * accel ordering happens to match its speed ordering, but the axis exists so a future chassis can
   * be fast-topped and sluggish off the line, or the reverse.
   */
  accel: number;
  /**
   * Cornering, 0-100. Scaled to radians/s by `turnRateOf`. Note this is turn RATE, not turn radius:
   * radius is `speed / turnRate`, so a slow car with middling handling still corners tightly.
   */
  handling: number;
  /** Ordered loadout: index 0 is slot 1. Order IS the slot mapping. */
  weapons: readonly WeaponId[];
  /** Selectable in real matches. The playground ignores this — that is how a car is tested before release (spec PG18). */
  isActive: boolean;
}

export interface ModeDef {
  id: GameMode;
  name: string;
  /**
   * Selectable in a real lobby. Playground, practice, and the balance harness ignore this — that is
   * how an unpublished mode is tested before it appears to players.
   */
  isActive: boolean;
}
export interface ColorDef {
  colorId: number;
  name: string;
  hex: string;
}
