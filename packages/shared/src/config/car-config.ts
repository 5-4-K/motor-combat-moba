import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { RAM_CONFIG } from "./ram-config.js";
import type { CarDef, CarId } from "./types.js";

/**
 * The roster. Every rating is an integer 0-100 with 50 as average.
 *
 * The three types (T1): **Mirage** is the all-round speedster — highest speed AND handling, the
 * lightest-armoured glass cannon on offense but middling hp. **Bullseye** is the light, precise
 * skirmisher — the roster's lowest hp and mass, and mid-pack on both speed and handling. **Bastion**
 * is the tank — lowest speed and accel by far, the roster's highest hp and mass, and, since the
 * 2026-09-02 rebalance, also the lowest handling: its durability carries the tank identity alone now,
 * not a handling edge.
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
 * budget was deliberately removed on 2026-08-29 so `mass` could be a free-floating fourth axis, and
 * no replacement guard was adopted. Roster fairness is a review-time judgement from here on.
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
 * `mass` is not durability. It scales how hard this chassis rams and how easily it is rammed, and it
 * touches nothing else — see `RAM_CONFIG.massPerRating`.
 *
 * **Changing a car's `handling` or `speed` also owes `docs/turn-tuning.md` an edit**, and a fourth
 * chassis owes it a new column in two tables. That page tabulates every turn rate and radius on the
 * roster by hand, and `scripts/turn-tuning-doc.test.mjs` recomputes every cell from this table — it
 * fails until the page agrees. See its "Keeping this page honest" section.
 *
 * `weapons` is the chassis's kit in slot order, and the kits are EXCLUSIVE: no weapon id appears on
 * two chassis (L1). `weapon-slots.test.ts` enforces that, so moving a weapon between chassis means
 * swapping a pair, never copying one.
 */
export const CAR_TABLE = {
  mirage: { id: "mirage", name: "Mirage", speed: 85, accel: 85, handling: 85, attack: 63, hp: 70, mass: 48, weapons: ["magmablast", "thunderclap", "afterburner"], isActive: true },
  bullseye: { id: "bullseye", name: "Bullseye", speed: 65, accel: 45, handling: 65, attack: 55, hp: 65, mass: 30, weapons: ["predator", "pepperbox", "lance"], isActive: true },
  bastion: { id: "bastion", name: "Bastion", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, mass: 90, weapons: ["thumper", "roadblock", "wildcharge"], isActive: true },
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

export function massOf(id: CarId): number {
  return CAR_TABLE[id].mass * RAM_CONFIG.massPerRating;
}

/** The rating an "average" chassis carries — the anchor, not a mass. */
const REFERENCE_MASS_RATING = 50;

function resolveRamReferenceMass(): number {
  return REFERENCE_MASS_RATING * RAM_CONFIG.massPerRating;
}

function resolveRamReference(): number {
  return (
    resolveRamReferenceMass() *
    Math.max(...(Object.keys(CAR_TABLE) as CarId[]).map((id) => forwardMaxSpeedOf(id)))
  );
}

/**
 * The mass of a chassis rated exactly average. Ram severity is measured against this, so a rating of
 * 50 at top speed is the natural "1.0 severity" anchor rather than an arbitrary number.
 */
export const RAM_REFERENCE_MASS = resolveRamReferenceMass();

/**
 * The momentum that saturates ram severity: an average-mass chassis travelling at the roster's
 * highest top speed. Derived, never typed — raising `baseMaxSpeed` or a car's `speed` rating moves
 * this with it, so ram severity stays anchored to what a car can actually achieve.
 */
export const RAM_REFERENCE = resolveRamReference();

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
let activeRamReference = RAM_REFERENCE;
let activeRamReferenceMass = RAM_REFERENCE_MASS;

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
 */
export function rebuildResolvedDrive(hasOverrides: boolean): void {
  if (!hasOverrides) {
    ACTIVE_DRIVE = CHASSIS_DRIVE;
    activeRamReference = RAM_REFERENCE;
    activeRamReferenceMass = RAM_REFERENCE_MASS;
    return;
  }
  ACTIVE_DRIVE = resolveChassisDrive();
  activeRamReferenceMass = resolveRamReferenceMass();
  activeRamReference = resolveRamReference();
}

/** The live `RAM_REFERENCE` — equal to the constant unless playground tuning is active. */
export function ramReference(): number {
  return activeRamReference;
}

/** The live `RAM_REFERENCE_MASS` — equal to the constant unless playground tuning is active. */
export function ramReferenceMass(): number {
  return activeRamReferenceMass;
}
