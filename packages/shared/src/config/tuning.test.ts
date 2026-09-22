import { afterEach, describe, expect, it } from "vitest";
import {
  CAR_TABLE,
  CHASSIS_DRIVE,
  driveOf,
  hpOf,
} from "./car-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { IMPULSE_CONFIG } from "./impulse-config.js";
import { RAM_CONFIG, ramTicks } from "./ram-config.js";
import { TICK_RATE_HZ } from "../constants.js";
import { TURRET_CONFIG, TURRET_TICKS } from "./turret-config.js";
import { instanceDefOf, WEAPON_TABLE } from "./weapon-config.js";
import { WEAPON_TICKS, weaponTicksOf } from "./weapon-ticks.js";
import { activeTuning, setTuning } from "./tuning.js";

afterEach(() => setTuning(null));

describe("tuning store", () => {
  it("null tuning resolves to the identical frozen defaults, by reference", () => {
    // `DEFAULT_RAM_TICKS` is not exported (unlike `CHASSIS_DRIVE`/`WEAPON_TICKS`, the ledger gives
    // `ram-config.ts` no such export), so the by-reference check captures `ramTicks()` before this
    // test touches tuning at all — at that point `afterEach` has already reset every prior test back
    // to null, so this IS the module-load default — and asserts a null `setTuning` reassigns the
    // identical object rather than a value-equal recomputation.
    const shippedRamTicks = ramTicks();
    setTuning(null);
    expect(driveOf("mirage")).toBe(CHASSIS_DRIVE.mirage);
    expect(weaponTicksOf("pepperbox")).toBe(WEAPON_TICKS.pepperbox);
    expect(ramTicks()).toBe(shippedRamTicks);
    expect(activeTuning()).toBeNull();
  });

  it("a car rating override moves the resolved drive and hp", () => {
    const before = driveOf("bastion").maxSpeed;
    setTuning({ "car.bastion.speed": 90 });
    expect(driveOf("bastion").maxSpeed).toBeGreaterThan(before);
    expect(activeTuning()).toEqual({ "car.bastion.speed": 90 });

    setTuning({ "car.bastion.hp": 10 });
    expect(hpOf("bastion")).toBe(10 * COMBAT_CONFIG.hpPerRating);
    // The previous override is gone: overrides replace, they never accumulate.
    expect(driveOf("bastion").maxSpeed).toBe(before);
  });

  it("a drive override reaches every chassis; reset restores the shipped number in the table itself", () => {
    const shipped: number = DRIVE_CONFIG.baseTurnRate;
    const shippedTurn = driveOf("mirage").turnRate;

    setTuning({ "drive.baseTurnRate": shipped * 2 });
    expect(DRIVE_CONFIG.baseTurnRate as number).toBe(shipped * 2);
    expect(driveOf("mirage").turnRate).toBe(shippedTurn + shipped);
    expect(driveOf("bastion").turnRate).toBeGreaterThan(CHASSIS_DRIVE.bastion.turnRate);

    setTuning(null);
    expect(DRIVE_CONFIG.baseTurnRate as number).toBe(shipped);
    expect(driveOf("mirage")).toBe(CHASSIS_DRIVE.mirage);
  });

  it("a weapon ms override re-derives ticks; a nested path works", () => {
    const before = weaponTicksOf("pepperbox").cooldown;
    setTuning({ "weapon.pepperbox.cooldownMs": WEAPON_TABLE.pepperbox.cooldownMs * 4 });
    expect(weaponTicksOf("pepperbox").cooldown).toBeGreaterThan(before);

    setTuning({ "weapon.pepperbox.hitbox.radiusAlong": 99 });
    expect(WEAPON_TABLE.pepperbox.hitbox.radiusAlong as number).toBe(99);
    expect(weaponTicksOf("pepperbox").cooldown).toBe(before);

    setTuning(null);
    expect(WEAPON_TABLE.pepperbox.hitbox.radiusAlong as number).toBe(9);
  });

  it("an explosion override re-derives the synthesized burst def (BURST_DEFS)", () => {
    // `magmablast.explosion.radius`/`.damage` are copied into `instanceDefOf`'s synthesized burst
    // def once at module load (BURST_DEFS); without a rebuild here, this override would move
    // `WEAPON_TABLE` and change nothing an actual detonation reads.
    const before = instanceDefOf("magmablast", true);
    expect(before.range).toBe(WEAPON_TABLE.magmablast.explosion!.radius);
    expect(before.damage).toBe(WEAPON_TABLE.magmablast.explosion!.damage);

    setTuning({ "weapon.magmablast.explosion.radius": 999, "weapon.magmablast.explosion.damage": 777 });
    const overridden = instanceDefOf("magmablast", true);
    expect(overridden.range).toBe(999);
    expect(overridden.damage).toBe(777);

    setTuning(null);
    const restored = instanceDefOf("magmablast", true);
    expect(restored.range).toBe(60);
    expect(restored.damage).toBe(15);
  });

  it("restores nested objects and arrays without replacing their identity", () => {
    // predator dropped its `applies` in the 2026-09-02 proximity-homing pass (corroded moved off
    // it); thunderclap is now the array-of-objects fixture for this test.
    const applies = WEAPON_TABLE.thunderclap.applies;
    const entry = applies[0];
    const weapons = CAR_TABLE.bastion.weapons;

    setTuning({ "weapon.thunderclap.applies.0.durationMs": 9000 });
    expect(WEAPON_TABLE.thunderclap.applies).toBe(applies);
    expect(WEAPON_TABLE.thunderclap.applies[0]).toBe(entry);
    expect(entry.durationMs as number).toBe(9000);

    setTuning(null);
    expect(entry.durationMs as number).toBe(1000);
    expect(CAR_TABLE.bastion.weapons).toBe(weapons);
    expect([...weapons]).toEqual(["thumper", "roadblock", "wildcharge"]);
  });

  it("rebuilds the ram durations when tuning moves them", () => {
    // The bug this replaces (spec U40): `RAM_TICKS` used to be a plain frozen `const` resolved once
    // at module load, and `setTuning` never rebuilt it — so `ramUncontrolMs` (among others) was
    // already a playground slider that moved `RAM_CONFIG` and changed nothing the sim read.
    const before = ramTicks().uncontrol;
    setTuning({ "ram.ramUncontrolMs": RAM_CONFIG.ramUncontrolMs * 2 });
    expect(ramTicks().uncontrol).toBeGreaterThan(before);

    setTuning(null);
    expect(ramTicks().uncontrol).toBe(before);
  });

  it("a no-op override re-resolves to the shipped derivations, value for value", () => {
    const shippedSpeed: number = CAR_TABLE.bastion.speed;
    const shippedRamTicks = ramTicks();
    setTuning({ "car.bastion.speed": shippedSpeed });
    expect(driveOf("bastion")).toEqual(CHASSIS_DRIVE.bastion);
    expect(ramTicks()).toEqual(shippedRamTicks);
  });

  // There is deliberately no "an override moves the ram reference" test any more. The two ram
  // reference values (`RAM_REFERENCE`, `RAM_REFERENCE_MASS`) and their `ramReference()`/
  // `ramReferenceMass()` accessors were deleted with `mass` in stage 3 Task 4 — the contest has no
  // global maximum to anchor against (spec R9), so there is nothing left for `rebuildResolvedDrive`
  // to re-derive on that side. This is a deletion, not a weakening: a test for a function that does
  // not exist proves nothing. The two ram ratings themselves ARE reachable through tuning and are
  // covered as ordinary `CAR_TABLE` leaves by `tuning-walker.test.ts`'s round-trip.
  it("a ramDefence override reaches CAR_TABLE live, with no resolved snapshot to rebuild", () => {
    const before: number = CAR_TABLE.bastion.ramDefence;
    setTuning({ "car.bastion.ramDefence": 12 });
    expect(CAR_TABLE.bastion.ramDefence as number).toBe(12);
    setTuning(null);
    expect(CAR_TABLE.bastion.ramDefence as number).toBe(before);
  });

  it("throws on a path that does not exist, leaving tables untouched", () => {
    expect(() => setTuning({ "car.mirage.nope": 1 })).toThrow();
    expect(activeTuning()).toBeNull();

    setTuning({ "car.mirage.speed": 99 });
    expect(() => setTuning({ "car.nosuchcar.speed": 1 })).toThrow();
    // A rejected call is a complete no-op: the live override survives it.
    expect(CAR_TABLE.mirage.speed as number).toBe(99);
    expect(activeTuning()).toEqual({ "car.mirage.speed": 99 });
  });

  it("refuses an unknown status id on every statusId leaf, and accepts a real one", () => {
    // The type check alone lets any string through, and a `statusId` is the one string in these
    // tables that is LOOKED UP rather than read: `applyStatus` takes it to `statusDefOf(...)!` and
    // throws mid-tick, which in the playground kills the room the tester is standing in. The
    // impulse paths are stage 4's new surface — no `statusId` lived under `impulse` before it.
    expect(() =>
      setTuning({ "weapon.wildcharge.impulse.applies.0.statusId": "nonsense" }),
    ).toThrow(/not a status id/);
    expect(() =>
      setTuning({ "weapon.wildcharge.impulse.onWallImpact.applies.0.statusId": "nonsense" }),
    ).toThrow(/not a status id/);
    expect(() => setTuning({ "weapon.roadblock.applies.0.statusId": "nonsense" })).toThrow(
      /not a status id/,
    );
    expect(activeTuning()).toBeNull();

    setTuning({ "weapon.wildcharge.impulse.applies.0.statusId": "spiked" });
    expect(WEAPON_TABLE.wildcharge.impulse!.applies[0]!.statusId).toBe("spiked");
    expect(weaponTicksOf("wildcharge").impulse!.applies[0]!.statusId).toBe("spiked");
  });

  it("throws when the value's type does not match the shipped one, and on a non-leaf path", () => {
    expect(() => setTuning({ "car.mirage.speed": "fast" })).toThrow();
    expect(() => setTuning({ "weapon.pepperbox.hitbox": 3 })).toThrow();
    expect(() => setTuning({ drive: 3 })).toThrow();
    expect(() => setTuning({ "car.mirage.toString": 3 })).toThrow();
    expect(activeTuning()).toBeNull();
  });

  it("the impulse root is tunable, and both members reach their call-time readers", () => {
    // `IMPULSE_CONFIG` became the sixth tuning root on 2026-09-19, once the Unity port made both
    // members matter: `spinScale` was inert until stage 4 gave an authored weapon push a real lever
    // arm, and `wallContactPad` is what every `ImpulseDef.onWallImpact` sweep measures against.
    //
    // It is the only root that owes `setTuning`'s rebuild list NOTHING, because nothing is derived
    // from it at module load: `sim/impulse.ts` reads `spinScale` inside `applyImpulse` and
    // `sim/contact.ts` reads `wallContactPad` inside the wall sweep, both at call time. That is
    // exactly why this test asserts the config object itself rather than a resolved artifact — and
    // it is the thing to re-read if someone ever derives one: this test would keep passing while the
    // derived value went stale, so the rebuild belongs there, not here.
    const shippedSpin = IMPULSE_CONFIG.spinScale;
    const shippedPad = IMPULSE_CONFIG.wallContactPad;

    setTuning({ "impulse.spinScale": 40, "impulse.wallContactPad": 7 });
    expect(IMPULSE_CONFIG.spinScale).toBe(40);
    expect(IMPULSE_CONFIG.wallContactPad).toBe(7);
    expect(activeTuning()).toEqual({ "impulse.spinScale": 40, "impulse.wallContactPad": 7 });

    setTuning(null);
    expect(IMPULSE_CONFIG.spinScale).toBe(shippedSpin);
    expect(IMPULSE_CONFIG.wallContactPad).toBe(shippedPad);
  });

  it("the turret root is tunable, and a turn-rate override rebuilds TURRET_TICKS in place (TR57)", () => {
    // `TURRET_TICKS.turnPerTick` is derived from `turnRateDegPerSec` once at module load, so it owes
    // `setTuning`'s rebuild list an entry — without it the playground's turn-rate knob would move the
    // config and leave the sim turning at the shipped rate. Asserted on the SAME object every reader
    // holds (`turnTurret`'s default step, the bot's turn budget), not on a fresh read.
    const ticks = TURRET_TICKS;
    const shippedStep = TURRET_TICKS.turnPerTick;
    const shippedSwing = TURRET_CONFIG.maxSwingDeg;

    setTuning({ "turret.turnRateDegPerSec": 360, "turret.maxSwingDeg": 180, "car.mirage.turretMount.x": 6 });
    expect(TURRET_CONFIG.turnRateDegPerSec).toBe(360);
    expect(TURRET_CONFIG.maxSwingDeg).toBe(180);
    expect(CAR_TABLE.mirage.turretMount.x).toBe(6);
    expect(TURRET_TICKS).toBe(ticks);
    expect(TURRET_TICKS.turnPerTick).toBeCloseTo((360 * Math.PI) / 180 / TICK_RATE_HZ, 12);

    setTuning(null);
    expect(TURRET_TICKS.turnPerTick).toBe(shippedStep);
    expect(TURRET_CONFIG.maxSwingDeg).toBe(shippedSwing);
    expect(CAR_TABLE.mirage.turretMount.x).toBe(0);
  });
});
