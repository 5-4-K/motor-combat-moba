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
    vx: 0,
    vy: 0,
    carId: "mirage" as CarId,
    defenceMult: 1,
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
      vx: 300,
      vy: 0,
      carId: "bastion" as CarId,
      maneuver: ManeuverKind.CHARGE,
      maneuverWeaponId: "wildcharge",
      slamsStunned: true,
      ...over,
    });
  const victimAt = (x: number, over = {}) =>
    car({ sessionId: "b", x, y: 0, angle: 0, vx: 0, vy: 0, carId: "mirage" as CarId, ...over });

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
    // `resolveContacts` no longer divides victim mass out at all (Task 4: that is `applyImpulse`'s
    // job, and a slam opts out of it anyway via `massScaled: false`) — `impulse.speed` is the
    // un-mass-scaled magnitude, and it must be identical for a bastion and a bullseye victim.
    expect(heavy.impulses.get("b")!.impulse.speed).toBeCloseTo(SLAM_CONFIG.knockSpeed);
    expect(light.impulses.get("b")!.impulse.speed).toBeCloseTo(SLAM_CONFIG.knockSpeed); // no mass factor
    // The magnitude-only check above dropped the sign the old `shoveX` assertion also pinned. The
    // charger sits at x=0 facing +x and the victim at x=47 (`victimAt`'s fixture), so the slam must
    // push the victim further along +x.
    expect(heavy.impulses.get("b")!.impulse.dirX).toBeCloseTo(1);
  });

  it("a slam ignores mass, unlike a ram's spin", () => {
    // Ruling C (stage-2 review): the concrete fixture the brief's placeholder pointed at, built
    // from the charger/victimAt fixtures above. The two assertions are the real requirement (spec
    // P28/P31): a slam's impulse is not mass-scaled, and carries no spin at all — "a clean straight
    // punt is the ult's signature."
    const slam = resolveContacts([charger(), victimAt(47)], new Set(), "ffa", 10, new Map(), [], bounds);
    const imp = slam.impulses.get("b")!.impulse;
    expect(imp.defenceScaled).toBe(false);
    expect(imp.spin).toBe(0);

    // "unlike a ram": the same geometry without a charge running produces an ORDINARY ram instead,
    // whose `Impulse` always authors `spin: 1` (`resolveRam`'s own hard-coded contract, not a
    // computed-torque check) — a slam's `spin: 0` opt-out is a real, structural difference, not a
    // coincidence of this one geometry. Both a slam's and an ordinary ram's victim impulse are
    // `defenceScaled: false` now (the contest already divides by `ramDefence`), so spin is the one
    // field left that actually distinguishes them.
    const ram = resolveContacts([car({ sessionId: "a", x: 0, y: 0, angle: 0, vx: 300, vy: 0, carId: "bastion" as CarId }), victimAt(47)], new Set(), "ffa", 10, new Map(), [], bounds);
    const ramImp = ram.impulses.get("b")!.impulse;
    expect(ramImp.defenceScaled).toBe(false);
    expect(ramImp.spin).toBe(1);
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
    expect(r.impulses.size).toBe(0);
  });

  it("beats a concurrent ordinary ram on the same victim", () => {
    // Three cars: a rammer and a charger touch the SAME victim from opposite sides in one tick, so
    // both pairs land in `resolveContacts`' shared per-victim `best` map. The ram's own approach
    // speed is moderate, not extreme: revision 2's contest has no ceiling (spec R9), so an
    // aggressive-enough ram CAN out-scale a slam's fixed magnitude at today's still-unmeasured
    // `RAM_CONFIG.globalScale` — this proves the ordinary case a slam is meant to beat, not an
    // impossible-to-lose guarantee (Task 4 owns whether that guarantee should exist at all).
    //
    // Session ids are chosen so the RAM pair is enumerated (and its impulse recorded) BEFORE the
    // SLAM pair: `resolveContacts` sorts by session id ("aRam" < "victim" < "zCharge"), so the nested
    // pair loop visits (aRam, victim) — the ram — ahead of (victim, zCharge) — the slam.
    const rammer = car({ sessionId: "aRam", x: -47, y: 0, angle: 0, vx: 100, vy: 0, carId: "bastion" as CarId });
    const victim = car({ sessionId: "victim", x: 0, y: 0, angle: 0, carId: "mirage" as CarId });
    const charger2 = car({
      sessionId: "zCharge",
      x: 47,
      y: 0,
      angle: Math.PI,
      carId: "bastion" as CarId,
      maneuver: ManeuverKind.CHARGE,
      maneuverWeaponId: "wildcharge",
      slamsStunned: true,
    });
    const r = resolveContacts([rammer, victim, charger2], new Set(), "ffa", 10, new Map(), [], bounds);

    expect(r.events.slams).toEqual([
      { attackerSessionId: "zCharge", targetSessionId: "victim", weaponId: "wildcharge" },
    ]);
    expect(r.impulses.size).toBe(1);
    const entry = r.impulses.get("victim")!;
    expect(entry.attackerId).toBe("zCharge");
    // The decisive evidence: a slam's impulse is `defenceScaled: false` with a FIXED 520 speed
    // (SLAM_CONFIG.knockSpeed) and `spin: 0`; an ordinary ram always authors `spin: 1`, structurally,
    // regardless of geometry — that field is what actually proves the slam overwrote the ram rather
    // than losing to its own comparison, independent of the ram's own (now open-ended) magnitude.
    expect(entry.impulse.defenceScaled).toBe(false);
    expect(entry.impulse.spin).toBe(0);
    expect(entry.impulse.speed).toBeCloseTo(SLAM_CONFIG.knockSpeed, 6);
  });

  it("wins a tie against an earlier slam on the same victim (best-impulse-per-victim, >=)", () => {
    // Two chargers hit the SAME victim from opposite sides in one tick. Both slams carry the
    // IDENTICAL fixed magnitude (`SLAM_CONFIG.knockSpeed`) — a genuine tie in the
    // best-impulse-per-victim map, the one case where `>` and `>=` disagree. Session ids are chosen
    // so the pair ("aCharge", "victim") is enumerated before ("victim", "zCharge"): only `>=` lets
    // the SECOND slam overwrite the first rather than the first silently surviving.
    const charger1 = charger({ sessionId: "aCharge", x: -47, y: 0, angle: 0 });
    const victim = car({ sessionId: "victim", x: 0, y: 0, angle: 0, carId: "mirage" as CarId });
    const charger2 = charger({ sessionId: "zCharge", x: 47, y: 0, angle: Math.PI });
    const r = resolveContacts([charger1, victim, charger2], new Set(), "ffa", 10, new Map(), [], bounds);

    expect(r.events.slams).toEqual([
      { attackerSessionId: "aCharge", targetSessionId: "victim", weaponId: "wildcharge" },
      { attackerSessionId: "zCharge", targetSessionId: "victim", weaponId: "wildcharge" },
    ]);
    expect(r.impulses.size).toBe(1);
    const entry = r.impulses.get("victim")!;
    expect(entry.attackerId).toBe("zCharge"); // the later slam wins the tie via `>=`
    expect(entry.impulse.speed).toBeCloseTo(SLAM_CONFIG.knockSpeed, 6);
  });
});

describe("dash contact", () => {
  it("reports a dash hit and writes no impulse — damage and stun ride combat", () => {
    const dasher = car({
      sessionId: "a",
      x: 0,
      y: 0,
      angle: 0,
      vx: 1600,
      vy: 0,
      carId: "mirage" as CarId,
      maneuver: ManeuverKind.DASH,
      maneuverWeaponId: "thunderclap",
    });
    const r = resolveContacts(
      [dasher, car({ sessionId: "b", x: 47, y: 0, angle: 0, vx: 0, vy: 0, carId: "bastion" as CarId })],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      { width: 4000, height: 4000 },
    );
    expect(r.events.dashHits).toEqual([{ attackerSessionId: "a", targetSessionId: "b", weaponId: "thunderclap" }]);
    expect(r.impulses.size).toBe(0);
  });

  it("reports a dasher pressed into level geometry", () => {
    const dasher = car({
      sessionId: "a",
      x: 25,
      y: 500,
      angle: Math.PI,
      vx: -1600,
      vy: 0,
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
