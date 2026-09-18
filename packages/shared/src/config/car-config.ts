import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG, perTickDecay } from "./drive-config.js";
import type { CarDef, CarId } from "./types.js";
import type { WeaponId } from "./weapon-types.js";

/**
 * The roster. Every rating is an integer 0-100 with 50 as average.
 *
 * **Three chassis ship; six more are authored below with `isActive: false`.** Only the shipped
 * three carry an identity — everything this comment says about the triangle is about them.
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
 * **Changing a car's `handling`, `speed`, `accel` or `brakeDecel` also owes `docs/turn-tuning.md`
 * an edit** (`coastHalfLifeSeconds` used to be on this list; the Unity drive-model port deleted the
 * field outright — see `CarDef.brakeDecel`), and a fourth chassis owes it a new column in three
 * tables. That page tabulates every turn rate and radius on the roster by hand, and
 * `scripts/turn-tuning-doc.test.mjs` recomputes every cell from this table — it fails until the page
 * agrees. See its "Keeping this page honest" section.
 *
 * `weapons` is the chassis's kit in slot order, and the kits are EXCLUSIVE: no weapon id appears on
 * two chassis (L1). `weapon-slots.test.ts` enforces that, so moving a weapon between chassis means
 * swapping a pair, never copying one.
 */
export const CAR_TABLE = {
  mirage: { id: "mirage", name: "Mirage", speed: 85, accel: 85, handling: 85, attack: 63, hp: 70, ramAttack: 55, ramDefence: 50, brakeDecel: 500, weapons: ["magmablast", "thunderclap", "afterburner"], basicAttack: "basic-attack-mirage", isActive: true },
  bullseye: { id: "bullseye", name: "Bullseye", speed: 65, accel: 45, handling: 65, attack: 55, hp: 65, ramAttack: 45, ramDefence: 30, brakeDecel: 520, weapons: ["predator", "pepperbox", "lance"], basicAttack: "basic-attack-bullseye", isActive: true },
  bastion: { id: "bastion", name: "Bastion", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90, brakeDecel: 430, weapons: ["thumper", "roadblock", "wildcharge"], basicAttack: "basic-attack-bastion", isActive: true },

  // --- Unreleased prototypes (`isActive: false`) ------------------------------------------------
  //
  // Six chassis authored so their art and their handling can be driven in the playground before
  // any of them is published. Every one of them is a STAT CLONE of a shipped car — taurus, anvil and
  // caprico of Bastion, prowler and cleaver of Mirage, skorpios of Bullseye — a placeholder, not a
  // design: the identity each is meant to carry has not been chosen yet, and a clone is the one
  // starting point that says "this has not been tuned" out loud rather than inventing a triangle
  // nobody agreed to. Retune them one at a time; `docs/turn-tuning.md` has a column for each.
  //
  // `weapons: []` is deliberate and legal for an inactive row (see "Adding an inactive chassis" in
  // `docs/config-reference.md`): the at-least-one-weapon floor in `weapon-slots.test.ts` applies to
  // active cars only, and weapon exclusivity (L1) is unconditional, so a prototype may not borrow a
  // shipped kit — it gets its own `WEAPON_TABLE` rows when someone authors them.
  taurus: { id: "taurus", name: "Taurus", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90, brakeDecel: 430, weapons: [], basicAttack: "basic-attack-taurus", isActive: false },
  anvil: { id: "anvil", name: "Anvil", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90, brakeDecel: 430, weapons: [], basicAttack: "basic-attack-anvil", isActive: false },
  prowler: { id: "prowler", name: "Prowler", speed: 85, accel: 85, handling: 85, attack: 63, hp: 70, ramAttack: 55, ramDefence: 50, brakeDecel: 500, weapons: [], basicAttack: "basic-attack-prowler", isActive: false },
  cleaver: { id: "cleaver", name: "Cleaver", speed: 85, accel: 85, handling: 85, attack: 63, hp: 70, ramAttack: 55, ramDefence: 50, brakeDecel: 500, weapons: [], basicAttack: "basic-attack-cleaver", isActive: false },
  skorpios: { id: "skorpios", name: "Skorpios", speed: 65, accel: 45, handling: 65, attack: 55, hp: 65, ramAttack: 45, ramDefence: 30, brakeDecel: 520, weapons: [], basicAttack: "basic-attack-skorpios", isActive: false },
  caprico: { id: "caprico", name: "Caprico", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90, brakeDecel: 430, weapons: [], basicAttack: "basic-attack-caprico", isActive: false },
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

/**
 * This chassis's basic attack (BA9). Beside `slotsOf`, never inside it: `slotsOf` answers "what kit
 * was this chassis designed around" and this answers "what else can it fire".
 */
export function basicAttackOf(id: CarId): WeaponId {
  return CAR_TABLE[id].basicAttack;
}

export function forwardMaxSpeedOf(id: CarId): number {
  return DRIVE_CONFIG.baseMaxSpeed + CAR_TABLE[id].speed * DRIVE_CONFIG.speedPerRating;
}

export function turnRateOf(id: CarId): number {
  return DRIVE_CONFIG.baseTurnRate + CAR_TABLE[id].handling * DRIVE_CONFIG.turnRatePerRating;
}

/**
 * This chassis's drag rate, 1/s — the single number that sets its wind-up AND its roll (U4).
 *
 * Named for what it IS rather than for the rating that feeds it: the rating is still `accel`,
 * because a higher rating still means a car that gets going sooner, but the quantity is drag. It was
 * `accelOf` and returned an acceleration until the Unity port; the engine push is `engineAccelOf`.
 */
export function dragRateOf(id: CarId): number {
  return DRIVE_CONFIG.baseDrag + CAR_TABLE[id].accel * DRIVE_CONFIG.dragPerRating;
}

/**
 * The engine's push, u/s². DERIVED so top speed is exactly `forwardMaxSpeedOf`: at equilibrium
 * `engineAccel === maxSpeed * dragRate`. Nothing clamps to the ceiling any more — it is where these
 * two balance, which is why it cannot be authored independently of them.
 */
export function engineAccelOf(id: CarId): number {
  return forwardMaxSpeedOf(id) * dragRateOf(id);
}

export function reverseAccelOf(id: CarId): number {
  return engineAccelOf(id) * DRIVE_CONFIG.reverseAccelFactor;
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
  maxSpeed: number; // u/s — emergent: engineAccel / dragRate
  engineAccel: number; // u/s²
  reverseAccel: number; // u/s²
  brakeDecel: number; // u/s²
  turnRate: number; // rad/s, speed-independent
  dragRate: number; // 1/s — the authored rate, for docs and status scaling
  dragPerTick: number; // perTickDecay(dragRate)
  gripPerTick: number; // perTickDecay(DRIVE_CONFIG.lateralGripRate)
  spinPerTick: number; // perTickDecay(RAM_CONFIG.reelingSpinDecayRate) — 1 until stage 3
}

function resolveChassisDrive(): Readonly<Record<CarId, ChassisDrive>> {
  return Object.freeze(
    Object.fromEntries(
      (Object.keys(CAR_TABLE) as CarId[]).map((id) => [
        id,
        Object.freeze({
          maxSpeed: forwardMaxSpeedOf(id),
          engineAccel: engineAccelOf(id),
          reverseAccel: reverseAccelOf(id),
          brakeDecel: brakeDecelOf(id),
          turnRate: turnRateOf(id),
          dragRate: dragRateOf(id),
          dragPerTick: perTickDecay(dragRateOf(id)),
          gripPerTick: perTickDecay(DRIVE_CONFIG.lateralGripRate),
          // Placeholder for exactly one stage: stage 3 replaces this with
          // `perTickDecay(RAM_CONFIG.reelingSpinDecayRate)` once that knob exists. 1 means "no
          // decay", and nothing sets `spinFree` until that same stage, so it is unreachable here.
          spinPerTick: 1,
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
