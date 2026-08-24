import { describe, expect, it } from "vitest";
import { CAR_TABLE, hpOf, forwardMaxSpeedOf } from "./car-config.js";
import { COLOR_TABLE } from "./color-config.js";
import { WEAPON_CONFIG } from "./weapon-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { FLOW_CONFIG } from "./flow-config.js";

describe("CAR_TABLE", () => {
  it("has exactly rectangle, oval, hexagon", () => {
    expect(Object.keys(CAR_TABLE).sort()).toEqual(["hexagon", "oval", "rectangle"]);
  });

  it("matches the locked ratings", () => {
    expect(CAR_TABLE.rectangle).toMatchObject({ speed: 8, strength: 3, hp: 5 });
    expect(CAR_TABLE.oval).toMatchObject({ speed: 5, strength: 8, hp: 3 });
    expect(CAR_TABLE.hexagon).toMatchObject({ speed: 3, strength: 5, hp: 8 });
  });

  it("derives actual HP via hpPerRating", () => {
    expect(hpOf("rectangle")).toBe(50);
    expect(hpOf("oval")).toBe(30);
    expect(hpOf("hexagon")).toBe(80);
  });

  it("derives forward max speed from the speed rating", () => {
    expect(forwardMaxSpeedOf("rectangle")).toBeGreaterThan(forwardMaxSpeedOf("oval"));
    expect(forwardMaxSpeedOf("oval")).toBeGreaterThan(forwardMaxSpeedOf("hexagon"));
  });
});

describe("COLOR_TABLE", () => {
  it("has 6 unique hex colors", () => {
    expect(COLOR_TABLE).toHaveLength(6);
    const hex = COLOR_TABLE.map((c) => c.hex);
    expect(new Set(hex).size).toBe(6);
    for (const h of hex) expect(h).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("weapon / combat / drive / flow knobs exist", () => {
  it("weapon defaults", () => {
    expect(WEAPON_CONFIG.damage).toBe(8);
    expect(WEAPON_CONFIG.fireRateHz).toBe(2);
    expect(WEAPON_CONFIG.projectileSpeed).toBe(900);
    expect(WEAPON_CONFIG.lifetimeTicks).toBe(30);
  });
  it("combat defaults", () => {
    expect(COMBAT_CONFIG.collisionDamagePerStrength).toBe(1);
    expect(COMBAT_CONFIG.ramDotThreshold).toBe(0.5);
    expect(COMBAT_CONFIG.collisionDamageCooldownTicks).toBe(15);
    expect(COMBAT_CONFIG.hpPerRating).toBe(10);
  });
  it("reverse is half of forward", () => {
    expect(DRIVE_CONFIG.reverseSpeedRatio).toBe(0.5);
  });
  it("flow timers", () => {
    expect(FLOW_CONFIG.carSelectSeconds).toBe(60);
    expect(FLOW_CONFIG.countdownSeconds).toBe(3);
  });
});
