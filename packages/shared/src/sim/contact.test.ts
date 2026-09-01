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
      maneuverWeaponId: "wildcharge",
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

  it("wins a tie against an ordinary ram already at severity 1 (best-knock-per-victim, >=)", () => {
    // Three cars: a rammer and a charger touch the SAME victim from opposite sides in one tick, so
    // both pairs land in `resolveContacts`' shared per-victim `best` map. The rammer is placed at an
    // extreme approach speed specifically so its severity clamps to EXACTLY 1 — the one value where
    // `>` and `>=` disagree on the slam's own overwrite check (`1 >= standing.severity`). A weaker
    // ram (severity < 1) would pass even a buggy strict `>`, since 1 > anything-less-than-1 is also
    // true; only the tie actually exercises the `>=`.
    //
    // Session ids are chosen so the RAM pair is enumerated (and its knock recorded) BEFORE the SLAM
    // pair: `resolveContacts` sorts by session id ("aRam" < "victim" < "zCharge"), so the nested pair
    // loop visits (aRam, victim) — the ram — ahead of (victim, zCharge) — the slam.
    const rammer = car({
      sessionId: "aRam",
      x: -47,
      y: 0,
      angle: 0,
      speed: 100000, // saturates `clamp01` to exactly severity 1, same idiom as ram.test.ts
      carId: "bastion" as CarId,
    });
    const victim = car({ sessionId: "victim", x: 0, y: 0, angle: 0, carId: "mirage" as CarId });
    const charger2 = car({
      sessionId: "zCharge",
      x: 47,
      y: 0,
      angle: Math.PI,
      speed: 300,
      carId: "bastion" as CarId,
      maneuver: ManeuverKind.CHARGE,
      maneuverWeaponId: "wildcharge",
      slamsStunned: true,
    });
    const r = resolveContacts([rammer, victim, charger2], new Set(), "ffa", 10, new Map(), [], bounds);

    expect(r.events.slams).toEqual([
      { attackerSessionId: "zCharge", targetSessionId: "victim", weaponId: "wildcharge" },
    ]);
    expect(r.knocks).toHaveLength(1);
    const knock = r.knocks[0]!;
    expect(knock.sessionId).toBe("victim");
    // The decisive evidence: a slam's knock is a FIXED 520 with no spin (SLAM_CONFIG.knockSpeed,
    // exactly 2x RAM_CONFIG.knockMaxSpeed); even a fully-saturated ram tops out at 260 times a mass
    // factor clamped to [0.6, 1.6] — 156 to 416, always short of 520 — and always carries some
    // spin. `authority` alone cannot tell the two apart (SLAM_CONFIG.victimAuthority is
    // RAM_CONFIG.authorityFloor's own value, by design), so the knock's magnitude and lack of spin
    // are what actually prove the slam overwrote the ram rather than losing to its own `>` sibling.
    expect(knock.angVel).toBe(0);
    expect(Math.abs(knock.shoveX)).toBeCloseTo(SLAM_CONFIG.knockSpeed, 6);
    expect(knock.authority).toBe(SLAM_CONFIG.victimAuthority);
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
      maneuverWeaponId: "thunderclap",
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
    expect(r.events.dashHits).toEqual([{ attackerSessionId: "a", targetSessionId: "b", weaponId: "thunderclap" }]);
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
      maneuverWeaponId: "thunderclap",
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
