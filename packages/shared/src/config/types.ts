import type { WeaponId } from "./weapon-types.js";

/**
 * Every chassis the code knows, shipped or not. `isActive` on the row below is what decides which
 * of these a player can actually select — six of these nine are unreleased prototypes.
 */
export type CarId =
  | "bullseye"
  | "mirage"
  | "bastion"
  | "taurus"
  | "anvil"
  | "prowler"
  | "cleaver"
  | "skorpios"
  | "caprico";
export interface CarDef {
  id: CarId;
  name: string;
  speed: number;
  attack: number;
  hp: number;
  /**
   * How hard this chassis hits when it rams, 0-100 — the multiplier on the shove it lands
   * (`shoveOf`). Affects **only** what it does to others, never what happens to it (spec R1). This is what lets a chassis be made to hit harder without
   * also becoming immovable, which the single `mass` rating this pair replaced could not express.
   *
   * NOT `attack`: that field already exists on this table and scales WEAPON damage. Reusing it
   * would couple ramming power to gun damage, which is the class of hidden coupling revision 2
   * exists to remove.
   */
  ramAttack: number;
  /**
   * How solid this chassis is, 0-100: how far a ram throws you, how hard a slam punts you, and how
   * hard you are to shoulder aside in ordinary separation (spec R1, R5, R8).
   *
   * **It divides your received shove, and that is now its whole effect.** Under the two-sided
   * contest it was worth more per point than `ramAttack`, because it also ADDED to your own push, so
   * the two compounded; the 2026-09-18 Unity ram port deleted that half with the contest (spec §7.4).
   * The pair is closer to symmetric now — `ramAttack` multiplies what you deal, `ramDefence` divides
   * what you take — which is a real balance change and one stage 5 measures, not a re-description.
   */
  ramDefence: number;
  /**
   * How quickly this chassis winds up and how far it rolls off the throttle, 0-100. Scaled to a drag
   * rate (1/s) by `dragRateOf` (Unity's `DriveConfig.linearDrag`, U4) — the same rate also sets top
   * speed (`engineAccelOf(id) / dragRateOf(id) === forwardMaxSpeedOf(id)`), so this is no longer an
   * independently-authored push. Independent of `speed`: this roster's accel ordering happens to
   * match its speed ordering, but the axis exists so a future chassis can be fast-topped and
   * sluggish off the line, or the reverse.
   */
  accel: number;
  /**
   * Cornering, 0-100. Scaled to radians/s by `turnRateOf`. Note this is turn RATE, not turn radius:
   * radius is `speed / turnRate`, so a slow car with middling handling still corners tightly.
   */
  handling: number;
  /**
   * Flat deceleration while the brake is held, u/s². A DIRECT VALUE, NOT A 0-100 RATING — do not
   * scale it by anything, and above all do not derive it from `ramDefence` (spec P7: the ram
   * ratings stay out of the drive model entirely, exactly as the `mass` rating they replaced was
   * required to. A force-based drive would make solid imply sluggish and collapse the roster back
   * onto one axis).
   *
   * `coastHalfLifeSeconds` used to sit beside this as the drive model's other direct value — how
   * long a chassis took to shed half its speed while coasting. The Unity drive-model port (drive-
   * model port stage 1 Task 6) deleted it outright: coasting is no longer a dedicated per-car decay
   * knob, it is the same `dragRateOf`/`baseDrag`+`dragPerRating` pair that also sets top speed and
   * wind-up (U4), and that pair lives on `DRIVE_CONFIG`/`CarDef.accel`, not here.
   */
  brakeDecel: number;
  /** Ordered loadout: index 0 is slot 1. Order IS the slot mapping. */
  weapons: readonly WeaponId[];
  /**
   * This chassis's basic attack (BA9) — the fourth weapon it always carries, fired from its own
   * input and never drawn in the HUD slot bar.
   *
   * Deliberately NOT a fourth entry in `weapons`. That field means "the three-weapon kit this
   * chassis was designed around", and roughly fifteen readers depend on it meaning exactly that:
   * the HUD, the guide, the playground's loadout editor, the balance harness's armed filter, ttk's
   * attacker axis, the bot's reach model. `fireSlotsOf` is where the two are joined, and its
   * readers are named in `weapon-slots.ts`.
   *
   * Required on every row, including the unreleased prototypes: a chassis that cannot shoot cannot
   * be judged in the playground, and `isActive: true` stays a one-field change.
   */
  basicAttack: WeaponId;
  /**
   * Where the turret sits on the hull, car-local world units: `x` along the heading, `y` along the
   * car's +y in the sim frame (spec TR5). The line of fire is measured from here, not the centre.
   */
  turretMount: { x: number; y: number };
  /** Selectable in real matches. The playground ignores this — that is how a car is tested before release (spec PG18). */
  isActive: boolean;
}

export interface ColorDef {
  colorId: number;
  name: string;
  hex: string;
}
