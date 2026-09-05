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
  /**
   * How long this chassis takes to shed half its speed while coasting, in seconds.
   *
   * A DIRECT VALUE, NOT A 0-100 RATING. This and `brakeDecel` are the first two fields on this
   * table that are not ratings — do not scale them by anything, and do not derive them from `mass`
   * (spec P7: mass stays out of the drive model).
   */
  coastHalfLifeSeconds: number;
  /** Flat deceleration while the brake is held, u/s². Also a direct value, not a rating. */
  brakeDecel: number;
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
