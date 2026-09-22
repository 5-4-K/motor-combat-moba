import { afterEach, describe, expect, it } from "vitest";
import {
  CAR_TABLE,
  CHASSIS_DRIVE,
  driveOf,
  hpOf,
  ramDefenceOf,
} from "./car-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { IMPULSE_CONFIG } from "./impulse-config.js";
import { RAM_CONFIG, ramTicks } from "./ram-config.js";
import { TURRET_CONFIG, TURRET_TICKS } from "./turret-config.js";
import { instanceDefOf, WEAPON_TABLE, weaponDefOf } from "./weapon-config.js";
import { WEAPON_TICKS, weaponTicksOf } from "./weapon-ticks.js";
import { activeTuning, setTuning } from "./tuning.js";
import { impulse, turret } from "../modes/active.js";
import { turretMountOf } from "./car-config.js";

afterEach(() => setTuning(null));

describe("tuning store", () => {
  // `setTuning` was rewritten for fix round 1 on the accessor-layer migration (MC14): it no longer
  // mutates the seven balance tables in place — it clones `BRAWL_TABLES`, writes the overrides into
  // the clone, assembles a fresh `ModeConfig` bundle from it, and installs that bundle. Two
  // consequences run through every test below:
  //
  // 1. `CAR_TABLE`/`DRIVE_CONFIG`/`RAM_CONFIG`/`IMPULSE_CONFIG`/`COMBAT_CONFIG`/`WEAPON_TABLE`/
  //    `TURRET_CONFIG` are never written to by `setTuning` any more. They stay the pristine shipped
  //    values for the life of the process — a stronger guarantee than before, when they were the
  //    live objects `setTuning` mutated.
  // 2. Every accessor that reads the installed bundle (`driveOf`, `hpOf`, `weaponDefOf`,
  //    `weaponTicksOf`, `ramTicks()`, `instanceDefOf`, `ramAttackOf`/`ramDefenceOf`,
  //    `turretMountOf`, `impulse()`, `turret()`, ...) DOES reflect a live override again — this is
  //    the fix. `sim/impulse.ts`/`sim/contact.ts`/`sim/weapons/turret.ts` were converted onto
  //    `impulse()`/`turret()` in Phase 1 Tasks 4 and 5, and the client's drawn turret
  //    (`scenes/turret-visual.ts`, `ArenaScene.ts`) and the bot's aim solver
  //    (`bot/brain/solution.ts`) were converted in the fix round after them, so tuning either root
  //    now reaches real gameplay end to end, not merely the accessor; see the two tests for them
  //    below.

  it("null tuning installs a bundle whose values match the shipped defaults", () => {
    setTuning(null);
    // Not `toBe`: `driveOf`/`weaponTicksOf` read the installed bundle's own independently-resolved
    // `derived.chassisDrive`/`derived.weaponTicks`, value-equal to `CHASSIS_DRIVE`/`WEAPON_TICKS`
    // but never the same object — true before this fix too (MC14 itself), not something this fix
    // changed.
    expect(driveOf("mirage")).toEqual(CHASSIS_DRIVE.mirage);
    expect(weaponTicksOf("pepperbox")).toEqual(WEAPON_TICKS.pepperbox);
    expect(activeTuning()).toBeNull();
    // A bundle is assembled fresh on every `setTuning` call, including `null` -> `null`, so two
    // reads are reference-stable only when nothing installs a new bundle in between.
    expect(ramTicks()).toBe(ramTicks());
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

  it("a drive override reaches every chassis via the bundle; DRIVE_CONFIG itself never moves", () => {
    const shipped: number = DRIVE_CONFIG.baseTurnRate;
    const shippedTurn = driveOf("mirage").turnRate;

    setTuning({ "drive.baseTurnRate": shipped * 2 });
    // `DRIVE_CONFIG` is read-only from `setTuning`'s point of view now (see the file-level note) —
    // the override reaches every chassis through `driveOf` instead.
    expect(DRIVE_CONFIG.baseTurnRate as number).toBe(shipped);
    expect(driveOf("mirage").turnRate).toBe(shippedTurn + shipped);
    expect(driveOf("bastion").turnRate).toBeGreaterThan(CHASSIS_DRIVE.bastion.turnRate);

    setTuning(null);
    expect(DRIVE_CONFIG.baseTurnRate as number).toBe(shipped);
    expect(driveOf("mirage")).toEqual(CHASSIS_DRIVE.mirage);
  });

  it("a weapon ms override re-derives ticks via the bundle; a nested path works too", () => {
    const shippedCooldownMs: number = WEAPON_TABLE.pepperbox.cooldownMs;
    const before = weaponTicksOf("pepperbox").cooldown;
    setTuning({ "weapon.pepperbox.cooldownMs": shippedCooldownMs * 4 });
    expect(weaponTicksOf("pepperbox").cooldown).toBeGreaterThan(before);
    expect(WEAPON_TABLE.pepperbox.cooldownMs as number).toBe(shippedCooldownMs);

    setTuning({ "weapon.pepperbox.hitbox.radiusAlong": 99 });
    const hitbox = weaponDefOf("pepperbox").hitbox as { radiusAlong: number };
    expect(hitbox.radiusAlong).toBe(99);
    expect(weaponTicksOf("pepperbox").cooldown).toBe(before);

    setTuning(null);
    expect(weaponTicksOf("pepperbox").cooldown).toBe(before);
  });

  it("an explosion override re-derives the synthesized burst def (BURST_DEFS)", () => {
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

  it("WEAPON_TABLE's own object graph never mutates — only the installed bundle changes", () => {
    // This used to prove `restoreInPlace` preserved a captured reference's identity across a live
    // mutate-then-restore cycle. There is no live mutation left to preserve identity THROUGH: the
    // table this test captures references into is never written to at all any more, so `applies`,
    // `entry` and `weapons` below are permanently the objects they always were, with their shipped
    // values — a stronger and simpler guarantee than the one this test used to prove.
    const applies = WEAPON_TABLE.thunderclap.applies;
    const entry = applies[0];
    const weapons = CAR_TABLE.bastion.weapons;

    setTuning({ "weapon.thunderclap.applies.0.durationMs": 9000 });
    expect(WEAPON_TABLE.thunderclap.applies).toBe(applies);
    expect(WEAPON_TABLE.thunderclap.applies[0]).toBe(entry);
    expect(entry!.durationMs as number).toBe(1000);
    // The override is visible through the accessor instead, off the installed bundle's own clone.
    expect(weaponDefOf("thunderclap").applies![0]!.durationMs).toBe(9000);

    setTuning(null);
    expect(entry!.durationMs as number).toBe(1000);
    expect(CAR_TABLE.bastion.weapons).toBe(weapons);
    expect([...weapons]).toEqual(["thumper", "roadblock", "wildcharge"]);
    expect(weaponDefOf("thunderclap").applies![0]!.durationMs).toBe(1000);
  });

  it("rebuilds the ram durations when tuning moves them", () => {
    // The bug this replaces (spec U40): `RAM_TICKS` used to be a plain frozen `const` resolved once
    // at module load, and `setTuning` never rebuilt it. `ramTicks()` now reads the installed
    // bundle's own `derived.ramTicks`, assembled fresh on every `setTuning` call, so this holds
    // again exactly as it did before the accessor-layer migration broke it.
    const shippedMs: number = RAM_CONFIG.ramUncontrolMs;
    const before = ramTicks().uncontrol;
    setTuning({ "ram.ramUncontrolMs": shippedMs * 2 });
    expect(ramTicks().uncontrol).toBeGreaterThan(before);
    expect(RAM_CONFIG.ramUncontrolMs as number).toBe(shippedMs); // never mutated

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

  it("a ramDefence override reaches ramDefenceOf via the bundle; CAR_TABLE itself never moves", () => {
    // Historically the one leaf with "no resolved snapshot to rebuild": `ramAttackOf`/
    // `ramDefenceOf` read `CAR_TABLE` live, with nothing cached in between, so `setTuning`'s old
    // in-place mutation reached it with no rebuild step at all. As of the accessor-layer rewrite
    // (MC14) they read `cars()` — the installed bundle — like every other accessor here, so this is
    // no longer a special case: it is the same "bundle reflects it, the raw table never moves" shape
    // every other root in this file now has.
    const before: number = CAR_TABLE.bastion.ramDefence;
    setTuning({ "car.bastion.ramDefence": 12 });
    expect(ramDefenceOf("bastion")).toBe(12);
    expect(CAR_TABLE.bastion.ramDefence as number).toBe(before);
    setTuning(null);
    expect(ramDefenceOf("bastion")).toBe(before);
  });

  it("throws on a path that does not exist, leaving the installed bundle untouched", () => {
    expect(() => setTuning({ "car.mirage.nope": 1 })).toThrow();
    expect(activeTuning()).toBeNull();

    setTuning({ "car.mirage.speed": 99 });
    const survivingMaxSpeed = driveOf("mirage").maxSpeed;
    expect(() => setTuning({ "car.nosuchcar.speed": 1 })).toThrow();
    // A rejected call is a complete no-op: the previously-installed bundle, override included,
    // survives it untouched.
    expect(driveOf("mirage").maxSpeed).toBe(survivingMaxSpeed);
    expect(CAR_TABLE.mirage.speed as number).not.toBe(99);
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
    expect(weaponDefOf("wildcharge").impulse!.applies[0]!.statusId).toBe("spiked");
    expect(weaponTicksOf("wildcharge").impulse!.applies[0]!.statusId).toBe("spiked");
    // The live WEAPON_TABLE is untouched, as everywhere else in this file.
    expect(WEAPON_TABLE.wildcharge.impulse!.applies[0]!.statusId).toBe("reeling");
  });

  it("throws when the value's type does not match the shipped one, and on a non-leaf path", () => {
    expect(() => setTuning({ "car.mirage.speed": "fast" })).toThrow();
    expect(() => setTuning({ "weapon.pepperbox.hitbox": 3 })).toThrow();
    expect(() => setTuning({ drive: 3 })).toThrow();
    expect(() => setTuning({ "car.mirage.toString": 3 })).toThrow();
    expect(activeTuning()).toBeNull();
  });

  it("the impulse root is tunable through the bundle; IMPULSE_CONFIG itself never moves", () => {
    // Historically this asserted straight against `IMPULSE_CONFIG` because `sim/impulse.ts` and
    // `sim/contact.ts` read `spinScale`/`wallContactPad` live off it, at call time, with nothing
    // cached in between. That justification no longer holds: `setTuning` never writes to
    // `IMPULSE_CONFIG` any more (see the file-level note) — the override reaches `impulse()` (the
    // accessor) through the installed bundle instead. `sim/impulse.ts`/`sim/contact.ts` now read
    // `impulse()` exclusively (Phase 1 Task 4), so a live override of this root reaches real
    // gameplay, not merely the accessor.
    const shippedSpin = IMPULSE_CONFIG.spinScale;
    const shippedPad = IMPULSE_CONFIG.wallContactPad;

    setTuning({ "impulse.spinScale": 40, "impulse.wallContactPad": 7 });
    expect(impulse().spinScale).toBe(40);
    expect(impulse().wallContactPad).toBe(7);
    expect(IMPULSE_CONFIG.spinScale).toBe(shippedSpin);
    expect(IMPULSE_CONFIG.wallContactPad).toBe(shippedPad);
    expect(activeTuning()).toEqual({ "impulse.spinScale": 40, "impulse.wallContactPad": 7 });

    setTuning(null);
    expect(impulse().spinScale).toBe(shippedSpin);
    expect(impulse().wallContactPad).toBe(shippedPad);
  });

  it("the turret root is tunable through the bundle; TURRET_CONFIG/TURRET_TICKS never move", () => {
    // Historically this proved `setTuning` rebuilds `TURRET_TICKS` in place (TR57). `setTuning`
    // never mutates `TURRET_CONFIG` any more (see the file-level note), so `TURRET_TICKS` — derived
    // from it once at module load, and otherwise only rebuilt by `rebuildTurretTicks`, which
    // `setTuning` no longer calls — never moves either. The override reaches `turret()`/
    // `turretMountOf()` (the accessors) through the installed bundle instead. `sim/weapons/
    // turret.ts` reads `turret()`/`derived().turretTicks` exclusively (Phase 1 Task 5), and the
    // client's drawn turret and the bot's aim solver were converted the same way in the fix round
    // after it, so a live override of this root reaches real gameplay turret behaviour end to end,
    // not merely the accessors. `TURRET_CONFIG`/`TURRET_TICKS` themselves stay untouched, since
    // `turret-config.ts` is not part of this rewrite — only its raw readers are.
    const shippedStep = TURRET_TICKS.turnPerTick;
    const shippedSwing = TURRET_CONFIG.maxSwingDeg;
    const shippedTurnRate = TURRET_CONFIG.turnRateDegPerSec;
    const shippedMountX = turretMountOf("mirage").x;

    setTuning({ "turret.turnRateDegPerSec": 360, "turret.maxSwingDeg": 180, "car.mirage.turretMount.x": 6 });
    expect(turret().turnRateDegPerSec).toBe(360);
    expect(turret().maxSwingDeg).toBe(180);
    expect(turretMountOf("mirage").x).toBe(6);
    expect(TURRET_CONFIG.turnRateDegPerSec).toBe(shippedTurnRate);
    expect(TURRET_CONFIG.maxSwingDeg).toBe(shippedSwing);
    expect(TURRET_TICKS.turnPerTick).toBe(shippedStep);
    expect(CAR_TABLE.mirage.turretMount.x).toBe(shippedMountX);

    setTuning(null);
    expect(turret().turnRateDegPerSec).toBe(shippedTurnRate);
    expect(turretMountOf("mirage").x).toBe(shippedMountX);
  });
});
