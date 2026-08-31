import { describe, expect, it } from "vitest";
import type { CarId } from "../config/types.js";
import { SLAM_CONFIG } from "../config/slam-config.js";
import { carHullOf } from "./context.js";
import { pairKey } from "./ram.js";
import { ManeuverKind } from "./maneuver.js";
import { hullTouchesWorld, resolveContacts, type ContactCar } from "./contact.js";

function car(over: Partial<ContactCar> = {}): ContactCar {
  return {
    sessionId: "a",
    team: 0,
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    carId: "mirage" as CarId,
    massMult: 1,
    maneuver: ManeuverKind.NONE,
    slamsStunned: false,
    stunned: false,
    maneuverWeaponId: "",
    ...over,
  };
}

describe("hard slam (spec S3, O2/O3/O18)", () => {
  const bounds = { width: 4000, height: 4000 };
  const charger = (over = {}) =>
    car({
      sessionId: "a",
      x: 0,
      y: 0,
      angle: 0,
      speed: 300,
      carId: "bastion" as CarId,
      maneuver: ManeuverKind.CHARGE,
      maneuverWeaponId: "fireball",
      slamsStunned: true,
      ...over,
    });
  const victimAt = (x: number, over = {}) =>
    car({ sessionId: "b", x, y: 0, angle: 0, speed: 0, carId: "mirage" as CarId, ...over });

  it("replaces the ram with a FIXED impulse, independent of mass and speed", () => {
    const heavy = resolveContacts(
      [charger(), victimAt(47, { carId: "bastion" as CarId })],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      bounds,
    );
    const light = resolveContacts(
      [charger(), victimAt(47, { carId: "bullseye" as CarId })],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      bounds,
    );
    expect(heavy.events.slams).toHaveLength(1);
    expect(heavy.knocks[0]!.shoveX).toBeCloseTo(SLAM_CONFIG.knockSpeed);
    expect(light.knocks[0]!.shoveX).toBeCloseTo(SLAM_CONFIG.knockSpeed); // no mass factor
    expect(heavy.knocks[0]!.authority).toBe(SLAM_CONFIG.victimAuthority);
    expect(heavy.knocks[0]!.angVel).toBe(0); // a slam shoves, it does not spin
  });

  it("slams a stunned victim only when the weapon says so (O3)", () => {
    const blocked = resolveContacts(
      [charger({ slamsStunned: false }), victimAt(47, { stunned: true })],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      bounds,
    );
    expect(blocked.events.slams).toHaveLength(0); // falls back to an ordinary ram
    const exempt = resolveContacts(
      [charger({ slamsStunned: true }), victimAt(47, { stunned: true })],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      bounds,
    );
    expect(exempt.events.slams).toHaveLength(1);
  });

  it("respects re-slam immunity, falling back to an ordinary ram (O18)", () => {
    const immune = new Map([["b", 25]]); // immune until tick 25
    const r = resolveContacts([charger(), victimAt(47)], new Set(), "ffa", 10, immune, [], bounds);
    expect(r.events.slams).toHaveLength(0);
  });

  it("stays edge-triggered like the ram it extends", () => {
    const touching = new Set([pairKey("a", "b")]);
    const r = resolveContacts([charger(), victimAt(47)], touching, "ffa", 10, new Map(), [], bounds);
    expect(r.events.slams).toHaveLength(0);
    expect(r.knocks).toHaveLength(0);
  });
});

describe("dash contact", () => {
  it("reports a dash hit and writes no knock — damage and stun ride combat", () => {
    const dasher = car({
      sessionId: "a",
      x: 0,
      y: 0,
      angle: 0,
      speed: 1600,
      carId: "mirage" as CarId,
      maneuver: ManeuverKind.DASH,
      maneuverWeaponId: "fireball",
    });
    const r = resolveContacts(
      [dasher, car({ sessionId: "b", x: 47, y: 0, angle: 0, speed: 0, carId: "bastion" as CarId })],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      { width: 4000, height: 4000 },
    );
    expect(r.events.dashHits).toEqual([{ attackerSessionId: "a", targetSessionId: "b", weaponId: "fireball" }]);
    expect(r.knocks).toHaveLength(0);
  });

  it("reports a dasher pressed into level geometry", () => {
    const dasher = car({
      sessionId: "a",
      x: 25,
      y: 500,
      angle: Math.PI,
      speed: 1600,
      carId: "mirage" as CarId,
      maneuver: ManeuverKind.DASH,
      maneuverWeaponId: "fireball",
    });
    const r = resolveContacts([dasher], new Set(), "ffa", 10, new Map(), [], { width: 4000, height: 4000 });
    expect(r.events.wallBlockedDashers).toEqual(["a"]);
  });
});

describe("hullTouchesWorld", () => {
  const bounds = { width: 1000, height: 1000 };
  it("detects the arena edge and inflated obstacles, and clears open ground", () => {
    expect(hullTouchesWorld(carHullOf(24, 500, 0), [], bounds, 1)).toBe(true); // nose ON the edge
    expect(hullTouchesWorld(carHullOf(500, 500, 0), [], bounds, 1)).toBe(false);
    const box = { x: 530, y: 480, w: 40, h: 40 };
    expect(hullTouchesWorld(carHullOf(505, 500, 0), [box], bounds, 1)).toBe(true);
  });
});
