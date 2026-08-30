import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import type { WeaponId } from "./weapon-types.js";
import { WEAPON_TICKS, msToTicks, weaponTicksOf } from "./weapon-ticks.js";

describe("msToTicks", () => {
  it("rounds up, so a duration is never shorter than authored", () => {
    expect(msToTicks(0)).toBe(0);
    expect(msToTicks(1)).toBe(1); // 0.03 ticks still costs a whole tick
    expect(msToTicks(1000)).toBe(TICK_RATE_HZ);
    expect(msToTicks(500)).toBe(15);
    expect(msToTicks(250)).toBe(8); // 7.5 -> 8, i.e. 266ms at 30Hz
  });

  it("treats a negative duration as zero rather than a negative tick count", () => {
    expect(msToTicks(-100)).toBe(0);
  });
});

describe("WEAPON_TICKS", () => {
  it("derives the fireball's clocks from its milliseconds", () => {
    const ticks = weaponTicksOf("fireball");
    // 550ms at 30Hz is 16.5, rounded UP to 17 so the authored cooldown is never shorter than
    // written. It was 15 at the 500ms this row shipped with, before T14's +10%.
    expect(ticks.cooldown).toBe(17);
    expect(ticks.startUp).toBe(0);
    expect(ticks.recovery).toBe(0);
    expect(ticks.refireDelay).toBe(0); // no stock block
  });

  it("derives flight ticks from range and speed", () => {
    // 900 units at 900 u/s = 1s = 30 ticks, the old WEAPON_CONFIG.lifetimeTicks
    expect(weaponTicksOf("fireball").flight).toBe(30);
  });

  it("maps damageFrequencyMs 0 to Infinity, meaning one hit per target ever", () => {
    expect(weaponTicksOf("fireball").damageInterval).toBe(Number.POSITIVE_INFINITY);
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
});
