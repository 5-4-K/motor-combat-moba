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
   * How hard this chassis hits in a ram contest, 0-100. Affects **only** what it does to others —
   * never what happens to it (spec R1). This is what lets a chassis be made to hit harder without
   * also becoming immovable, which the single `mass` rating this pair replaced could not express.
   *
   * NOT `attack`: that field already exists on this table and scales WEAPON damage. Reusing it
   * would couple ramming power to gun damage, which is the class of hidden coupling revision 2
   * exists to remove.
   */
  ramAttack: number;
  /**
   * How solid this chassis is, 0-100: what it resists in the contest, what it absorbs, and how hard
   * it is to shoulder aside (spec R1, R5, R8).
   *
   * Worth more per point than `ramAttack`, deliberately: it both adds to your push and divides your
   * received impact, so its effect compounds. That is what makes a tank read as a tank — price the
   * roster around it rather than weakening one of the two roles (spec "Flagged for confirmation").
   */
  ramDefence: number;
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
   * table that are not ratings — do not scale them by anything, and above all do not derive them
   * from `ramDefence` (spec P7: the ram ratings stay out of the drive model entirely, exactly as the
   * `mass` rating they replaced was required to. A force-based drive would make solid imply
   * sluggish and collapse the roster back onto one axis).
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
