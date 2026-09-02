import { afterEach, describe, expect, it } from "vitest";
import {
  CAR_TABLE,
  CHASSIS_DRIVE,
  RAM_REFERENCE,
  driveOf,
  hpOf,
  ramReference,
} from "./car-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { RAM_DECAY, ramDecay } from "./ram-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import { WEAPON_TICKS, weaponTicksOf } from "./weapon-ticks.js";
import { activeTuning, setTuning } from "./tuning.js";

afterEach(() => setTuning(null));

describe("tuning store", () => {
  it("null tuning resolves to the identical frozen defaults, by reference", () => {
    setTuning(null);
    expect(driveOf("mirage")).toBe(CHASSIS_DRIVE.mirage);
    expect(weaponTicksOf("pepperbox")).toBe(WEAPON_TICKS.pepperbox);
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

  it("a half-life override moves the decay the sim reads, not just the seconds it is authored in", () => {
    const shipped = RAM_DECAY.spin;
    setTuning({ "ram.spinHalfLifeSeconds": 2 });
    expect(ramDecay().spin).toBeGreaterThan(shipped);
    expect(ramDecay().shove).toBe(RAM_DECAY.shove);

    setTuning(null);
    expect(ramDecay()).toBe(RAM_DECAY);
  });

  it("a no-op override re-resolves to the shipped derivations, value for value", () => {
    const shippedSpeed: number = CAR_TABLE.bastion.speed;
    setTuning({ "car.bastion.speed": shippedSpeed });
    expect(driveOf("bastion")).toEqual(CHASSIS_DRIVE.bastion);
    expect(ramReference()).toBe(RAM_REFERENCE);
    expect(ramDecay()).toEqual(RAM_DECAY);
  });

  it("a mass-scale override moves the ram reference", () => {
    const before = ramReference();
    setTuning({ "ram.massPerRating": 1 });
    expect(ramReference()).not.toBe(before);
    setTuning(null);
    expect(ramReference()).toBe(before);
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

  it("throws when the value's type does not match the shipped one, and on a non-leaf path", () => {
    expect(() => setTuning({ "car.mirage.speed": "fast" })).toThrow();
    expect(() => setTuning({ "weapon.pepperbox.hitbox": 3 })).toThrow();
    expect(() => setTuning({ drive: 3 })).toThrow();
    expect(() => setTuning({ "car.mirage.toString": 3 })).toThrow();
    expect(activeTuning()).toBeNull();
  });
});
