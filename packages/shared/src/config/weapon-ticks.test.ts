import { beforeEach, describe, expect, it } from "vitest";
import { installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { MS_PER_TICK, TICK_RATE_HZ } from "../constants.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import type { WeaponId } from "./weapon-types.js";
import { WEAPON_TICKS, msToTicks, weaponTicksOf } from "./weapon-ticks.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

describe("msToTicks", () => {
  it("rounds up, so a duration is never shorter than authored", () => {
    expect(msToTicks(0)).toBe(0);
    expect(msToTicks(1)).toBe(1); // a fraction of a tick still costs a whole tick
    expect(msToTicks(1000)).toBe(TICK_RATE_HZ);
    expect(msToTicks(500)).toBe(TICK_RATE_HZ / 2);
    // Derived from the tick length rather than a literal ms (was `msToTicks(250)` -> 8, which is
    // 7.5 ticks at 30 Hz but a whole 15 at 60 Hz, so it stopped exercising the round-up).
    expect(msToTicks(MS_PER_TICK * 7.5)).toBe(8); // 7.5 -> 8
  });

  it("treats a negative duration as zero rather than a negative tick count", () => {
    expect(msToTicks(-100)).toBe(0);
  });
});

describe("WEAPON_TICKS", () => {
  it("derives magmablast's clocks from its milliseconds", () => {
    const ticks = weaponTicksOf("magmablast");
    // 1600ms is exactly 1.6 s of ticks.
    expect(ticks.cooldown).toBe((1600 * TICK_RATE_HZ) / 1000);
    expect(ticks.startUp).toBe(0);
    expect(ticks.recovery).toBe(0);
    expect(ticks.refireDelay).toBe(0); // no stock block
  });

  it("derives flight ticks from range and speed", () => {
    // 900 units at 600 u/s = 1.5 s of ticks.
    expect(weaponTicksOf("magmablast").flight).toBe(1.5 * TICK_RATE_HZ);
  });

  it("maps damageFrequencyMs 0 to Infinity, meaning one hit per target ever", () => {
    expect(weaponTicksOf("magmablast").damageInterval).toBe(Number.POSITIVE_INFINITY);
  });

  it("derives the roster's new-mechanic clocks for the rows that carry them (spec 2026-09-01)", () => {
    expect(weaponTicksOf("thumper").projectileLifetime).toBe((3000 * TICK_RATE_HZ) / 1000);
    expect(weaponTicksOf("wildcharge").maneuverDuration).toBe((10000 * TICK_RATE_HZ) / 1000);
    expect(weaponTicksOf("predator").homingDuration).toBe((2000 * TICK_RATE_HZ) / 1000);
  });

  it("covers every weapon in the table and is frozen", () => {
    for (const id of Object.keys(WEAPON_TABLE)) {
      expect(WEAPON_TICKS[id as keyof typeof WEAPON_TABLE]).toBeDefined();
    }
    expect(Object.isFrozen(WEAPON_TICKS)).toBe(true);
  });

  it("converts volleyInterval for beams as well as projectiles", () => {
    for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
      const def = WEAPON_TABLE[id];
      expect(weaponTicksOf(id).volleyInterval).toBe(msToTicks(def.volley.volleyIntervalMs));
    }
  });

  it("derives zero homing/lifetime/maneuver ticks for every row that does not carry the mechanic", () => {
    const homing: WeaponId[] = ["predator"];
    const hasLifetime: WeaponId[] = ["thumper", "predator"];
    const chargeManeuver: WeaponId[] = ["wildcharge"];
    for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
      const t = weaponTicksOf(id);
      if (!homing.includes(id)) expect(t.homingDuration, id).toBe(0);
      if (!hasLifetime.includes(id)) expect(t.projectileLifetime, id).toBe(0);
      if (!chargeManeuver.includes(id)) expect(t.maneuverDuration, id).toBe(0);
    }
  });

  it("derives an explosion's ticks, with flight pinned at one tick (spec P25b)", () => {
    const ticks = weaponTicksOf("magmablast").explosion;
    expect(ticks).not.toBeNull();
    expect(ticks!.flight).toBe(1);
    expect(ticks!.lifetime).toBe(msToTicks(WEAPON_TABLE.magmablast.explosion!.lingerMs));
    expect(ticks!.damageInterval).toBe(Number.POSITIVE_INFINITY);
    expect(ticks!.applyDurations).toEqual([msToTicks(2000)]);
  });

  it("leaves explosion ticks null for a weapon with no explosion", () => {
    expect(weaponTicksOf("predator").explosion).toBeNull();
  });
});
