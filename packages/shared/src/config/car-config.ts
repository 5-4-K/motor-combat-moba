import { DRIVE_CONFIG, perTickDecay } from "./drive-config.js";
import type { DriveConfig } from "./drive-config.js";
import { RAM_CONFIG, reelingSpinPerTick } from "./ram-config.js";
import type { RamConfig } from "./ram-config.js";
import type { CarDef, CarId } from "./types.js";
import type { WeaponId } from "./weapon-types.js";
import { cars, combat, derived, drive } from "../modes/active.js";

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
 * are read only by the ram shove (`shoveOf` in `sim/ram.ts` — `ramAttack` multiplies the attacker's,
 * `ramDefence` divides the victim's), by `applyImpulse`'s inertia term for a slam, and by
 * `resolveWorld`'s separation split; they touch nothing else — never acceleration, never top speed
 * (spec P7). Until the 2026-09-18 Unity ram port both fed a two-sided contest (`pushOf`/`impactOn`),
 * which is why `ramDefence` used to be described as adding to your own push as well.
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
  mirage: { id: "mirage", name: "Mirage", speed: 85, accel: 85, handling: 85, attack: 63, hp: 70, ramAttack: 55, ramDefence: 50, brakeDecel: 500, weapons: ["magmablast", "thunderclap", "afterburner"], basicAttack: "basic-attack-mirage", turretMount: { x: 0, y: 0 }, isActive: true },
  bullseye: { id: "bullseye", name: "Bullseye", speed: 65, accel: 45, handling: 65, attack: 55, hp: 65, ramAttack: 45, ramDefence: 30, brakeDecel: 520, weapons: ["predator", "pepperbox", "lance"], basicAttack: "basic-attack-bullseye", turretMount: { x: 0, y: 0 }, isActive: true },
  bastion: { id: "bastion", name: "Bastion", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90, brakeDecel: 430, weapons: ["thumper", "roadblock", "wildcharge"], basicAttack: "basic-attack-bastion", turretMount: { x: 0, y: 0 }, isActive: true },

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
  taurus: { id: "taurus", name: "Taurus", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90, brakeDecel: 430, weapons: [], basicAttack: "basic-attack-taurus", turretMount: { x: 0, y: 0 }, isActive: false },
  anvil: { id: "anvil", name: "Anvil", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90, brakeDecel: 430, weapons: [], basicAttack: "basic-attack-anvil", turretMount: { x: 0, y: 0 }, isActive: false },
  prowler: { id: "prowler", name: "Prowler", speed: 85, accel: 85, handling: 85, attack: 63, hp: 70, ramAttack: 55, ramDefence: 50, brakeDecel: 500, weapons: [], basicAttack: "basic-attack-prowler", turretMount: { x: 0, y: 0 }, isActive: false },
  cleaver: { id: "cleaver", name: "Cleaver", speed: 85, accel: 85, handling: 85, attack: 63, hp: 70, ramAttack: 55, ramDefence: 50, brakeDecel: 500, weapons: [], basicAttack: "basic-attack-cleaver", turretMount: { x: 0, y: 0 }, isActive: false },
  skorpios: { id: "skorpios", name: "Skorpios", speed: 65, accel: 45, handling: 65, attack: 55, hp: 65, ramAttack: 45, ramDefence: 30, brakeDecel: 520, weapons: [], basicAttack: "basic-attack-skorpios", turretMount: { x: 0, y: 0 }, isActive: false },
  caprico: { id: "caprico", name: "Caprico", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90, brakeDecel: 430, weapons: [], basicAttack: "basic-attack-caprico", turretMount: { x: 0, y: 0 }, isActive: false },
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
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(cars(), value);
}

const NO_MOUNT = { x: 0, y: 0 } as const;

/** The turret mount of a chassis; the centre for an unknown id (spec TR5). */
export function turretMountOf(carId: string): { x: number; y: number } {
  return isCarId(carId) ? cars()[carId].turretMount : NO_MOUNT;
}

/** True only for an id that both exists AND is active — real matches gate on this, not `isCarId`. */
export function isActiveCarId(value: unknown): value is CarId {
  return isCarId(value) && cars()[value].isActive;
}

export function activeCarIds(): CarId[] {
  return (Object.keys(cars()) as CarId[]).filter((id) => cars()[id].isActive);
}

export function hpOf(id: CarId): number {
  return cars()[id].hp * combat().hpPerRating;
}

/**
 * This chassis's basic attack (BA9). Beside `slotsOf`, never inside it: `slotsOf` answers "what kit
 * was this chassis designed around" and this answers "what else can it fire".
 */
export function basicAttackOf(id: CarId): WeaponId {
  return cars()[id].basicAttack;
}

/**
 * Every weapon some chassis carries in its basic-attack slot.
 *
 * The one honest way to ask "is this weapon a basic attack": it is a question about the SLOT, so
 * the answer comes from `CAR_TABLE` and never from the weapon's id. Nothing may infer it by
 * pattern-matching a name — a chassis is free to carry any `WEAPON_TABLE` row here, including one
 * another chassis carries as an ability, and an id-shaped test would answer wrongly in both
 * directions the day that happens.
 *
 * Note the consequence, since it is the point rather than a side effect: a weapon that appears in
 * BOTH some chassis's kit and some chassis's basic-attack slot is in this set.
 */
export function basicAttackIds(): ReadonlySet<WeaponId> {
  return new Set(Object.values(cars()).map((car) => car.basicAttack));
}

/**
 * Reads its trailing parameters only, defaulting to the active mode's own tables (CONTROLLER RULING
 * 8). `resolveChassisDrive` below passes ITS OWN cloned tables explicitly here rather than relying
 * on these defaults — the mode it is assembling is not yet installed while it runs, so falling back
 * to `cars()`/`drive()` there would silently compute one mode's chassis drive from whatever mode
 * happened to be active at build time. Every ordinary call site keeps calling this with just an
 * `id`, which is what the defaults are for.
 */
export function forwardMaxSpeedOf(
  id: CarId,
  carTable: Readonly<Record<CarId, CarDef>> = cars(),
  driveConfig: DriveConfig = drive(),
): number {
  return driveConfig.baseMaxSpeed + carTable[id].speed * driveConfig.speedPerRating;
}

export function turnRateOf(
  id: CarId,
  carTable: Readonly<Record<CarId, CarDef>> = cars(),
  driveConfig: DriveConfig = drive(),
): number {
  return driveConfig.baseTurnRate + carTable[id].handling * driveConfig.turnRatePerRating;
}

/**
 * This chassis's drag rate, 1/s — the single number that sets its wind-up AND its roll (U4).
 *
 * Named for what it IS rather than for the rating that feeds it: the rating is still `accel`,
 * because a higher rating still means a car that gets going sooner, but the quantity is drag. It was
 * `accelOf` and returned an acceleration until the Unity port; the engine push is `engineAccelOf`.
 *
 * Parameterised per CONTROLLER RULING 8 — see `forwardMaxSpeedOf`.
 */
export function dragRateOf(
  id: CarId,
  carTable: Readonly<Record<CarId, CarDef>> = cars(),
  driveConfig: DriveConfig = drive(),
): number {
  return driveConfig.baseDrag + carTable[id].accel * driveConfig.dragPerRating;
}

/**
 * The engine's push, u/s². DERIVED so top speed is exactly `forwardMaxSpeedOf`: at equilibrium
 * `engineAccel === maxSpeed * dragRate`. Nothing clamps to the ceiling any more — it is where these
 * two balance, which is why it cannot be authored independently of them.
 *
 * Parameterised per CONTROLLER RULING 8 — see `forwardMaxSpeedOf`. Delegates to the parameterised
 * `forwardMaxSpeedOf`/`dragRateOf`, passing its OWN parameters through rather than letting either
 * fall back to its own default, so a caller's explicit tables are honoured end to end.
 */
export function engineAccelOf(
  id: CarId,
  carTable: Readonly<Record<CarId, CarDef>> = cars(),
  driveConfig: DriveConfig = drive(),
): number {
  return forwardMaxSpeedOf(id, carTable, driveConfig) * dragRateOf(id, carTable, driveConfig);
}

/** Parameterised per CONTROLLER RULING 8 — see `forwardMaxSpeedOf`. */
export function reverseAccelOf(
  id: CarId,
  carTable: Readonly<Record<CarId, CarDef>> = cars(),
  driveConfig: DriveConfig = drive(),
): number {
  return engineAccelOf(id, carTable, driveConfig) * driveConfig.reverseAccelFactor;
}

// `brakeDecelOf(id)` stood here and is DELETED (2026-09-23). It read the raw `CAR_TABLE` rather
// than `cars()`, so it answered the DEFAULT mode's brake for every mode — and it had no caller
// anywhere in the repo, which is the only reason that never showed up as a wrong number on screen.
// Deleted rather than converted: `resolveChassisDrive` below already resolves `brakeDecel` off the
// mode's own table into `ChassisDrive.brakeDecel`, which is the one spelling the sim, the drive
// model and `docs/turn-tuning.md` all read. A second getter for the same field, unused and
// mode-blind, is a trap set for whoever reaches for it first.

export function ramAttackOf(id: CarId): number {
  return cars()[id].ramAttack;
}

export function ramDefenceOf(id: CarId): number {
  return cars()[id].ramDefence;
}

/*
 * There is deliberately no ram REFERENCE constant here any more.
 *
 * The severity model this file used to anchor (`RAM_REFERENCE_MASS` — an average chassis's mass —
 * and `RAM_REFERENCE` — that mass at the roster's highest top speed) graded every ram as a 0-1
 * fraction of one global maximum, which is exactly the shape spec revision 2 rejected: there is no
 * ceiling to be a fraction OF. `shoveOf` (`sim/ram.ts`) is open-ended and linear in drive-in speed,
 * so the only global constant left is `RAM_CONFIG.globalScale`, and it converts rather than
 * normalises. The Unity ram port replaced revision 2's contest without changing that: it is still
 * open-ended, and `RAM_CONFIG.spinMaxRate` remains a playability clamp on spin rather than an anchor
 * on magnitude. Do not reintroduce a reference: an anchor is a clamp wearing a different name
 * (spec R9).
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
  spinPerTick: number; // reelingSpinPerTick() — perTickDecay(RAM_CONFIG.reelingSpinDecayRate)
}

/**
 * Reads `cars`, `drive` and `ram` only, never `CAR_TABLE`/`DRIVE_CONFIG`/`RAM_CONFIG` directly.
 *
 * **Delegates to the parameterised `forwardMaxSpeedOf`/`turnRateOf`/`dragRateOf`/`engineAccelOf`/
 * `reverseAccelOf`/`reelingSpinPerTick` above (CONTROLLER RULING 8) — passing its OWN `carTable`/
 * `driveConfig`/`ramConfig` through explicitly on every call, never omitted.** Omitting one there
 * would fall through to that helper's own default, which reads `cars()`/`drive()`/`ram()` — the
 * CURRENTLY INSTALLED mode. This function runs inside `assembleModeConfig` while the mode it is
 * building is not yet installed, so a fallen-through default would silently compute this mode's
 * chassis drive from whatever mode happened to be active at build time instead of from the tables
 * this call was actually given — exactly the "two mode bundles share a derivation" bug this
 * extraction exists to rule out. Explicit arguments at every call site are what keep that impossible.
 */
export function resolveChassisDrive(
  carTable: Readonly<Record<CarId, CarDef>> = CAR_TABLE,
  driveConfig: DriveConfig = DRIVE_CONFIG,
  ramConfig: RamConfig = RAM_CONFIG,
): Readonly<Record<CarId, ChassisDrive>> {
  return Object.freeze(
    Object.fromEntries(
      (Object.keys(carTable) as CarId[]).map((id) => {
        const car = carTable[id];
        const dragRate = dragRateOf(id, carTable, driveConfig);
        const engineAccel = engineAccelOf(id, carTable, driveConfig);
        return [
          id,
          Object.freeze({
            maxSpeed: forwardMaxSpeedOf(id, carTable, driveConfig),
            engineAccel,
            reverseAccel: reverseAccelOf(id, carTable, driveConfig),
            brakeDecel: car.brakeDecel,
            turnRate: turnRateOf(id, carTable, driveConfig),
            dragRate,
            dragPerTick: perTickDecay(dragRate),
            gripPerTick: perTickDecay(driveConfig.lateralGripRate),
            spinPerTick: reelingSpinPerTick(ramConfig),
          }),
        ];
      }),
    ) as Record<CarId, ChassisDrive>,
  );
}

/**
 * Resolved once at module load and frozen, mirroring `WEAPON_TICKS`. Kept as a standalone export —
 * it used to be what `driveOf` handed the sim (by reference) before this rewrite (MC14); now it is
 * only the shipped-roster reference value a few tests and scripts compare against directly.
 * `driveOf` below no longer reads it: it reads the active mode bundle's own
 * `derived.chassisDrive`, computed once by `assembleModeConfig` when THAT bundle was built — a
 * separately-resolved, value-equal, but not reference-equal object.
 */
export const CHASSIS_DRIVE: Readonly<Record<CarId, ChassisDrive>> = resolveChassisDrive();

/**
 * Everything `stepDrive` needs to move one chassis for one tick, resolved from the active mode
 * bundle's own `derived.chassisDrive` (MC14) — computed once by `assembleModeConfig`, not
 * recomputed per call. A playground retune (`applyOverrides`, `modes/overlay.ts`) moves it by
 * building a whole fresh bundle rather than by rebuilding a cached table in place — there is no `ACTIVE_DRIVE` left, and no
 * `rebuildResolvedDrive` either.
 */
export function driveOf(id: CarId): ChassisDrive {
  return derived().chassisDrive[id];
}
