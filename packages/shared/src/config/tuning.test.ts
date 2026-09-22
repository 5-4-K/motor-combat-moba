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
  // Several tests below are marked with the same note: as of the accessor-layer rewrite (MC14),
  // `driveOf`, `hpOf`, `weaponTicksOf`, `ramTicks()` and `instanceDefOf` all read the INSTALLED mode
  // bundle's own `derived.*` (or its own tables), resolved once by `assembleModeConfig` when that
  // bundle was assembled — not the mutable `CAR_TABLE`/`DRIVE_CONFIG`/`WEAPON_TABLE`/`RAM_CONFIG`
  // `setTuning` still writes to below. `setTuning` still calls `rebuildResolvedDrive` /
  // `rebuildWeaponTicks` / `rebuildRamTicks` / `rebuildBurstDefs` on every write, but each is now a
  // no-op (`// phase 5 deletes this`, in each config file). So a `setTuning` override still lands in
  // the live table — the assertions on `CAR_TABLE`/`DRIVE_CONFIG`/`WEAPON_TABLE` below still hold —
  // but no longer reaches any of the five bundle-backed accessors. Per-mode runtime tuning that DOES
  // reach them is an overlay that rebuilds a whole bundle (phase 5, `modes/overlay.ts`), not a
  // rebuild of one cached table; these tests will move back to asserting propagation once that lands.

  it("driveOf/weaponTicksOf/ramTicks resolve to the mode bundle's own values, independent of setTuning", () => {
    setTuning(null);
    // No longer `toBe` (reference-identical to the raw `CHASSIS_DRIVE`/`WEAPON_TICKS` module
    // constants): `driveOf`/`weaponTicksOf` now read the installed bundle's own
    // independently-resolved `derived.chassisDrive`/`derived.weaponTicks`, value-equal but no
    // longer the same object.
    expect(driveOf("mirage")).toEqual(CHASSIS_DRIVE.mirage);
    expect(weaponTicksOf("pepperbox")).toEqual(WEAPON_TICKS.pepperbox);
    // `ramTicks()` still returns the SAME reference on every call — there is no rebuild left to
    // swap it out, so this is now trivially stable rather than proof of a null-tuning reset.
    const shippedRamTicks = ramTicks();
    setTuning({ "ram.ramUncontrolMs": RAM_CONFIG.ramUncontrolMs * 2 });
    expect(ramTicks()).toBe(shippedRamTicks);
    setTuning(null);
    expect(activeTuning()).toBeNull();
  });

  it("a car rating override still lands in CAR_TABLE, but no longer moves driveOf/hpOf (MC14)", () => {
    const before = driveOf("bastion").maxSpeed;
    const beforeHp = hpOf("bastion");
    setTuning({ "car.bastion.speed": 90 });
    expect(CAR_TABLE.bastion.speed as number).toBe(90);
    expect(driveOf("bastion").maxSpeed).toBe(before);
    expect(activeTuning()).toEqual({ "car.bastion.speed": 90 });

    setTuning({ "car.bastion.hp": 10 });
    expect(CAR_TABLE.bastion.hp as number).toBe(10);
    expect(hpOf("bastion")).toBe(beforeHp);
  });

  it("a drive override still lands in DRIVE_CONFIG, but no longer moves driveOf (MC14)", () => {
    const shipped: number = DRIVE_CONFIG.baseTurnRate;
    const shippedTurn = driveOf("mirage").turnRate;

    setTuning({ "drive.baseTurnRate": shipped * 2 });
    expect(DRIVE_CONFIG.baseTurnRate as number).toBe(shipped * 2);
    expect(driveOf("mirage").turnRate).toBe(shippedTurn);
    expect(driveOf("bastion").turnRate).toBe(CHASSIS_DRIVE.bastion.turnRate);

    setTuning(null);
    expect(DRIVE_CONFIG.baseTurnRate as number).toBe(shipped);
    expect(driveOf("mirage")).toEqual(CHASSIS_DRIVE.mirage);
  });

  it("a weapon ms override still lands in WEAPON_TABLE, but no longer re-derives weaponTicksOf (MC14)", () => {
    const shippedCooldownMs: number = WEAPON_TABLE.pepperbox.cooldownMs;
    const before = weaponTicksOf("pepperbox").cooldown;
    setTuning({ "weapon.pepperbox.cooldownMs": shippedCooldownMs * 4 });
    expect(WEAPON_TABLE.pepperbox.cooldownMs as number).toBe(shippedCooldownMs * 4);
    expect(weaponTicksOf("pepperbox").cooldown).toBe(before);

    setTuning({ "weapon.pepperbox.hitbox.radiusAlong": 99 });
    expect(WEAPON_TABLE.pepperbox.hitbox.radiusAlong as number).toBe(99);
    expect(weaponTicksOf("pepperbox").cooldown).toBe(before);

    setTuning(null);
    expect(WEAPON_TABLE.pepperbox.hitbox.radiusAlong as number).toBe(9);
  });

  it("an explosion override still lands in WEAPON_TABLE, but no longer re-derives the synthesized burst def (MC14)", () => {
    // `magmablast.explosion.radius`/`.damage` are copied into `instanceDefOf`'s synthesized burst
    // def once when the installed mode bundle was assembled (`derived.burstDefs`); a live
    // `WEAPON_TABLE` override no longer reaches it at all.
    const before = instanceDefOf("magmablast", true);
    expect(before.range).toBe(WEAPON_TABLE.magmablast.explosion!.radius);
    expect(before.damage).toBe(WEAPON_TABLE.magmablast.explosion!.damage);

    setTuning({ "weapon.magmablast.explosion.radius": 999, "weapon.magmablast.explosion.damage": 777 });
    expect(WEAPON_TABLE.magmablast.explosion!.radius as number).toBe(999);
    expect(WEAPON_TABLE.magmablast.explosion!.damage as number).toBe(777);
    const stillUnmoved = instanceDefOf("magmablast", true);
    expect(stillUnmoved.range).toBe(60);
    expect(stillUnmoved.damage).toBe(15);

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

  it("a ram duration override still lands in RAM_CONFIG, but no longer re-derives ramTicks() (MC14)", () => {
    // This used to prove `setTuning` rebuilds `ramTicks()` (spec U40's bug: `RAM_TICKS` was once a
    // plain frozen `const` `setTuning` never rebuilt at all). As of the accessor-layer rewrite,
    // `ramTicks()` reads the installed mode bundle's own `derived.ramTicks`, resolved once when that
    // bundle was assembled, so a live `RAM_CONFIG` write no longer reaches it either — the same shape
    // as every other bundle-backed accessor above, not a regression of U40's fix.
    const shippedMs: number = RAM_CONFIG.ramUncontrolMs;
    const before = ramTicks().uncontrol;
    setTuning({ "ram.ramUncontrolMs": shippedMs * 2 });
    expect(RAM_CONFIG.ramUncontrolMs as number).toBe(shippedMs * 2);
    expect(ramTicks().uncontrol).toBe(before);

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
    // Not `weaponTicksOf` here (MC14): it reads the installed mode bundle's own
    // `derived.weaponTicks`, resolved once when that bundle was assembled, so a live `WEAPON_TABLE`
    // write no longer reaches it — it still reads the shipped "reeling", not this override.
    expect(weaponTicksOf("wildcharge").impulse!.applies[0]!.statusId).toBe("reeling");
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
