import { describe, expect, it } from "vitest";
import { CAR_TABLE, hpOf, forwardMaxSpeedOf, isCarId } from "./car-config.js";
import { COLOR_TABLE } from "./color-config.js";
import { WEAPON_CONFIG } from "./weapon-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { FLOW_CONFIG } from "./flow-config.js";
import { NET_CONFIG } from "./net-config.js";

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

describe("isCarId", () => {
  it("accepts CAR_TABLE keys and rejects unknown ids", () => {
    expect(isCarId("rectangle")).toBe(true);
    expect(isCarId("oval")).toBe(true);
    expect(isCarId("hexagon")).toBe(true);
    expect(isCarId("triangle")).toBe(false);
    expect(isCarId("")).toBe(false);
    expect(isCarId(1)).toBe(false);
  });

  it("rejects names inherited from Object.prototype", () => {
    // `"constructor" in CAR_TABLE` is true; the own-property check is what keeps it out.
    expect(isCarId("constructor")).toBe(false);
    expect(isCarId("toString")).toBe(false);
    expect(isCarId("hasOwnProperty")).toBe(false);
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
  it("caps how many inputs one player can have applied per tick", () => {
    expect(NET_CONFIG.maxInputsPerTick).toBeTypeOf("number");
    expect(Number.isInteger(NET_CONFIG.maxInputsPerTick)).toBe(true);
    // Below 1 the server would drop every input and no one could move.
    expect(NET_CONFIG.maxInputsPerTick).toBeGreaterThanOrEqual(1);
  });
});
