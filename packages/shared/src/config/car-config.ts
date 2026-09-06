import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { halfLifeToPerTick } from "./ram-config.js";
import type { CarDef, CarId } from "./types.js";

/**
 * The roster. Every rating is an integer 0-100 with 50 as average.
 *
 * The three types (T1): **Mirage** is the all-round speedster — highest speed AND handling, the
 * lightest-armoured glass cannon on offense but middling hp. **Bullseye** is the light, precise
 * skirmisher — the roster's lowest hp and `ramDefence`, and mid-pack on both speed and handling.
 * **Bastion** is the tank — lowest speed and accel by far, the roster's highest hp, `ramAttack` and
 * `ramDefence`, and, since the 2026-09-02 rebalance, also the lowest handling: its durability and
 * its solidity carry the tank identity now, not a handling edge.
 *
 * As of 2026-09-02 `speed` and `handling` move together per car (85/85, 65/65, 50/50) rather than
 * trading off — before that, Bastion's `handling` (82) was the roster's *highest* despite its `speed`
 * (30) being the lowest, which is what let a car with the widest turn RATE spread also carry the
 * tightest turn RADIUS (T6). That inversion is gone: turn radius (`forwardMaxSpeedOf(id) /
 * turnRateOf(id)`) now orders the same way rating does — Mirage widest, Bastion tightest — because a
 * car with more of one now reliably has more of the other. Bastion still finishes with the tightest
 * radius (its lower turn rate is outweighed by its lower speed), but the margin between the three
 * shrank from tens of units to a few.
 *
 * Ratings used to be held to a 150-point budget across speed/attack/hp, which was the roster's only
 * automatic guard against a fourth chassis being authored strictly better than these three. That
 * budget was deliberately removed on 2026-08-29 so a free-floating ram axis could exist, and no
 * replacement guard was adopted — the ram axis has since become two (`ramAttack`/`ramDefence`), so
 * there is now MORE unbudgeted surface, not less. Roster fairness is a review-time judgement from
 * here on.
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
 * `ramAttack` and `ramDefence` are not durability, and they are not one rating split in two. They
 * are read only by the ram contest (`pushOf`/`impactOn` in `sim/ram.ts`) and by `resolveWorld`'s
 * separation split, and they touch nothing else — never acceleration, never top speed (spec P7).
 * They replaced the single `mass` rating on 2026-09-06: one number could not say "hits hard but is
 * also easy to shove", and could not be tuned on either half without moving the other.
 *
 * **Changing a car's `handling`, `speed`, `coastHalfLifeSeconds` or `brakeDecel` also owes
 * `docs/turn-tuning.md` an edit**, and a fourth chassis owes it a new column in three tables. That
 * page tabulates every turn rate and radius on the roster by hand, and
 * `scripts/turn-tuning-doc.test.mjs` recomputes every cell from this table — it fails until the page
 * agrees. See its "Keeping this page honest" section.
 *
 * `weapons` is the chassis's kit in slot order, and the kits are EXCLUSIVE: no weapon id appears on
 * two chassis (L1). `weapon-slots.test.ts` enforces that, so moving a weapon between chassis means
 * swapping a pair, never copying one.
 */
export const CAR_TABLE = {
  mirage: { id: "mirage", name: "Mirage", speed: 85, accel: 85, handling: 85, attack: 63, hp: 70, ramAttack: 55, ramDefence: 50, coastHalfLifeSeconds: 1.2, brakeDecel: 500, weapons: ["magmablast", "thunderclap", "afterburner"], isActive: true },
  bullseye: { id: "bullseye", name: "Bullseye", speed: 65, accel: 45, handling: 65, attack: 55, hp: 65, ramAttack: 45, ramDefence: 30, coastHalfLifeSeconds: 1.0, brakeDecel: 520, weapons: ["predator", "pepperbox", "lance"], isActive: true },
  bastion: { id: "bastion", name: "Bastion", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90, coastHalfLifeSeconds: 1.5, brakeDecel: 430, weapons: ["thumper", "roadblock", "wildcharge"], isActive: true },
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

/** True only for an id that both exists AND is active — real matches gate on this, not `isCarId`. */
export function isActiveCarId(value: unknown): value is CarId {
  return isCarId(value) && CAR_TABLE[value].isActive;
}

export function activeCarIds(): CarId[] {
  return (Object.keys(CAR_TABLE) as CarId[]).filter((id) => CAR_TABLE[id].isActive);
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

export function coastHalfLifeSecondsOf(id: CarId): number {
  return CAR_TABLE[id].coastHalfLifeSeconds;
}

export function brakeDecelOf(id: CarId): number {
  return CAR_TABLE[id].brakeDecel;
}

export function ramAttackOf(id: CarId): number {
  return CAR_TABLE[id].ramAttack;
}

export function ramDefenceOf(id: CarId): number {
  return CAR_TABLE[id].ramDefence;
}

/*
 * There is deliberately no ram REFERENCE constant here any more.
 *
 * The severity model this file used to anchor (`RAM_REFERENCE_MASS` — an average chassis's mass —
 * and `RAM_REFERENCE` — that mass at the roster's highest top speed) graded every ram as a 0-1
 * fraction of one global maximum, which is exactly the shape spec revision 2 rejects: a contest has
 * no ceiling to be a fraction OF. `pushOf`/`impactOn` (`sim/ram.ts`) are open-ended and linear, so
 * the only global constant left is `RAM_CONFIG.globalScale`, and it converts rather than normalises.
 * Do not reintroduce a reference: an anchor is a clamp wearing a different name (spec R9).
 */

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
  /** Per-tick multiplier on forward speed while coasting. Resolved from `coastHalfLifeSeconds`. */
  coastPerTick: number;
  /** Flat deceleration while the brake is held, u/s². */
  brakeDecel: number;
}

function resolveChassisDrive(): Readonly<Record<CarId, ChassisDrive>> {
  return Object.freeze(
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
          coastPerTick: halfLifeToPerTick(coastHalfLifeSecondsOf(id)),
          brakeDecel: brakeDecelOf(id),
        }),
      ]),
    ) as Record<CarId, ChassisDrive>,
  );
}

/**
 * Resolved once at module load and frozen, mirroring `WEAPON_TICKS`. `stepSim` runs this lookup for
 * every player every tick on both halves of the lockstep, so it must not allocate.
 */
export const CHASSIS_DRIVE: Readonly<Record<CarId, ChassisDrive>> = resolveChassisDrive();

/**
 * What `driveOf` actually hands the sim. It IS `CHASSIS_DRIVE` — the same object, not a copy —
 * until playground tuning overrides a balance table, and again the moment tuning is cleared.
 */
let ACTIVE_DRIVE: Readonly<Record<CarId, ChassisDrive>> = CHASSIS_DRIVE;

export function driveOf(id: CarId): ChassisDrive {
  return ACTIVE_DRIVE[id];
}

/**
 * Playground tuning only (spec PG12) — called by `setTuning`, never from the sim. With no overrides
 * it reassigns the module-load defaults BY REFERENCE rather than recomputing them, so an untuned
 * build resolves the identical frozen objects it always has and cannot drift by a float.
 *
 * `hasOverrides` is a parameter rather than a read of `activeTuning()` because `tuning.ts` imports
 * this module: asking it back would be an import cycle.
 *
 * This used to rebuild two ram reference values alongside the drive table. They are gone with the
 * severity model that needed them (see the note above `ChassisDrive`), and the contest needs no
 * rebuild step of its own: `pushOf`/`impactOn` read `CAR_TABLE` and `RAM_CONFIG` live on every
 * contact rather than through a resolved-once snapshot, so a playground override of `ramAttack`,
 * `ramDefence` or a `RAM_CONFIG` knob is already in effect on the next tick with nothing to refresh.
 */
export function rebuildResolvedDrive(hasOverrides: boolean): void {
  ACTIVE_DRIVE = hasOverrides ? resolveChassisDrive() : CHASSIS_DRIVE;
}
