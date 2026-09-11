import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { SPIKE_CONFIG } from "../config/spike-config.js";
import type { CarId } from "../config/types.js";
import { rectPlanes } from "./boundary.js";
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

  it("reports the contact geometry on the event and writes NO impulse (stage 4)", () => {
    // The whole payload of the charge branch now. A slam's magnitude, spin, defence-scaling and
    // control-loss all live on `wildcharge`'s own `ImpulseDef` and are assembled by `ram-bridge.ts`;
    // what only this pass can produce is the OBB contact normal and the contact point, so that is
    // what the event carries and all this file can assert about the push.
    const r = resolveContacts([charger(), victimAt(47)], new Set(), "ffa", 10, new Map(), [], bounds);
    expect(r.events.slams).toHaveLength(1);
    const slam = r.events.slams[0]!;
    expect(slam).toMatchObject({ attackerSessionId: "a", targetSessionId: "b", weaponId: "wildcharge" });
    // The charger sits at x=0 facing +x and the victim at x=47, so the push points along +x, and it
    // is a UNIT vector — `applyImpulse` multiplies it by the def's `speed`, so a non-unit direction
    // would silently rescale the ult.
    expect(slam.dirX).toBeCloseTo(1, 6);
    expect(slam.dirY).toBeCloseTo(0, 6);
    expect(Math.hypot(slam.dirX, slam.dirY)).toBeCloseTo(1, 6);
    expect(slam.contactX).toBe(47);
    expect(slam.contactY).toBe(0);
    // Nothing at all in the impulses map: a slam does not compete with a ram for the per-victim
    // slot any more, and the pair produced no ram of its own either (`resolvePair` short-circuits).
    expect(r.impulses.size).toBe(0);
  });

  it("only the ram fallback still builds an Impulse here", () => {
    // The contrast that keeps the assertion above meaningful: the SAME geometry with no charge
    // running falls through to an ordinary ram, which does write into `impulses` — so an empty map
    // above is evidence about the slam branch, not about the fixture failing to touch at all. A
    // ram's impulse always authors `spin: 1` (`resolveRam`'s hard-coded contract), where a slam's
    // `spin` is whatever its weapon row says (0 for `wildcharge`, "a clean straight punt").
    const ram = resolveContacts(
      [car({ sessionId: "a", x: 0, y: 0, angle: 0, vx: 300, vy: 0, carId: "bastion" as CarId }), victimAt(47)],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      bounds,
    );
    expect(ram.events.slams).toHaveLength(0);
    const ramImp = ram.impulses.get("b")!.impulse;
    expect(ramImp.defenceScaled).toBe(false); // the contest already divided by the victim's ramDefence
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

  it("no longer displaces a concurrent ordinary ram on the same victim", () => {
    // Three cars: a rammer and a charger touch the SAME victim from opposite sides in one tick.
    // Until stage 4 both pairs competed for the one per-victim slot in `best` and the slam won it,
    // on an ordering nothing enforced — the ram was simply thrown away. Now the slam does not enter
    // that map at all, so the ram survives as its own entry and both land downstream.
    //
    // Session ids are chosen so the RAM pair is enumerated BEFORE the SLAM pair: `resolveContacts`
    // sorts by session id ("aRam" < "victim" < "zCharge"), so the nested pair loop visits
    // (aRam, victim) ahead of (victim, zCharge). Under the old `best` comparison that ordering was
    // what gave the slam something to overwrite.
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

    expect(r.events.slams).toHaveLength(1);
    expect(r.events.slams[0]).toMatchObject({ attackerSessionId: "zCharge", targetSessionId: "victim" });
    // The ram is still here, still attributed to the rammer, and still an ordinary ram (`spin: 1`,
    // `resolveRam`'s structural contract) rather than something a slam overwrote.
    expect(r.impulses.size).toBe(1);
    const entry = r.impulses.get("victim")!;
    expect(entry.attackerId).toBe("aRam");
    expect(entry.impulse.spin).toBe(1);
  });

  it("reports BOTH slams when two chargers land on one victim in a tick", () => {
    // Two chargers hit the SAME victim from opposite sides. There is no per-victim slot for them to
    // contest any more, so neither is dropped: both events are reported, in pair-enumeration order,
    // and `ram-bridge.ts` applies both pushes. Under the old `best` map one of the two was silently
    // discarded, and which one depended on a `>=` comparison between two identical magnitudes.
    const charger1 = charger({ sessionId: "aCharge", x: -47, y: 0, angle: 0 });
    const victim = car({ sessionId: "victim", x: 0, y: 0, angle: 0, carId: "mirage" as CarId });
    const charger2 = charger({ sessionId: "zCharge", x: 47, y: 0, angle: Math.PI });
    const r = resolveContacts([charger1, victim, charger2], new Set(), "ffa", 10, new Map(), [], bounds);

    expect(r.events.slams.map((s) => s.attackerSessionId)).toEqual(["aCharge", "zCharge"]);
    // Opposite approaches produce opposite push directions, which is the geometry actually being
    // carried rather than a constant copied onto both events.
    expect(r.events.slams[0]!.dirX).toBeCloseTo(1, 6);
    expect(r.events.slams[1]!.dirX).toBeCloseTo(-1, 6);
    expect(r.impulses.size).toBe(0);
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

  it("reports a hull near a chamfer as touching the world", () => {
    const OCT = { width: 1280, height: 720, planes: [
      ...rectPlanes(1280, 720),
      { nx: Math.SQRT1_2, ny: Math.SQRT1_2, d: Math.SQRT1_2 * 124 + Math.SQRT1_2 * 54 },
    ] };
    const hull = { x: 120, y: 90, angle: 0, w: 48, h: 32 };
    expect(hullTouchesWorld(hull, [], OCT, 2)).toBe(true);
    expect(hullTouchesWorld({ ...hull, x: 640, y: 360 }, [], OCT, 2)).toBe(false);
  });
});

describe("spike contacts", () => {
  // Flush against the left wall, matching how `ARENA_01` authors a strip: 20 units deep, kind
  // "spike". An ordinary obstacle of the same footprint (`plain`) is the control for "not every
  // box is a hazard".
  const strip = { x: 74, y: 105, w: 20, h: 95, kind: "spike" as const };
  const plain = { x: 400, y: 400, w: 20, h: 95 };
  const bounds = { width: 1280, height: 720 };

  it("reports a car driving into a spike strip", () => {
    // x:100,y:150 overlaps the strip's AABB (x:[74,94], y:[105,200]) once the car's 48x32 hull is
    // applied; vx:-100 drives it further left, into the strip's face.
    const driving = car({ x: 100, y: 150, vx: -100, vy: 0 });
    const { events } = resolveContacts([driving], new Set(), "ffa", 1, new Map(), [strip], bounds);
    expect(events.spikeContacts).toHaveLength(1);
    expect(events.spikeContacts[0]!.sessionId).toBe("a");
    expect(events.spikeContacts[0]!.speedIn).toBeGreaterThan(0);
    expect(events.spikeContacts[0]!.nx).toBeGreaterThan(0); // pushes right, into the arena
  });

  it("reports nothing for an ordinary obstacle", () => {
    const overlapping = car({ x: 410, y: 450 });
    const { events } = resolveContacts([overlapping], new Set(), "ffa", 1, new Map(), [plain], bounds);
    expect(events.spikeContacts).toHaveLength(0);
  });

  it("reports a negative speedIn for a car driving away, and leaves the filtering to the bridge", () => {
    // Same overlap as the first case, but vx flipped: the car is pulling out of the strip, not into
    // it. If `speedIn`'s sign were inverted this would read positive and this test would fail —
    // that inversion is exactly the bug the sign-convention doc comment warns about.
    const leaving = car({ x: 100, y: 150, vx: 100, vy: 0 });
    const { events } = resolveContacts([leaving], new Set(), "ffa", 1, new Map(), [strip], bounds);
    expect(events.spikeContacts[0]!.speedIn).toBeLessThan(0);
  });

  it("reports exactly one contact for a car straddling two spike strips at once", () => {
    // A car parked on the seam between two vertically-stacked strips (the shape of an octagon
    // corner in ARENA_01, where two strips meet at an angle but both still overlap one hull). `strip`
    // covers y:[105,200]; `stripBelow` picks up immediately at y:200 and runs on. A car centred on
    // y:200 with the standard 32-unit-tall hull overlaps both by half its height.
    const stripBelow = { x: strip.x, y: strip.y + strip.h, w: strip.w, h: strip.h, kind: "spike" as const };
    const straddling = car({ x: 100, y: strip.y + strip.h, vx: -100, vy: 0 });
    const { events } = resolveContacts(
      [straddling],
      new Set(),
      "ffa",
      1,
      new Map(),
      [strip, stripBelow],
      bounds,
    );
    // Two candidate strips genuinely overlap this car's hull; the contract is still one report.
    expect(events.spikeContacts).toHaveLength(1);
    expect(events.spikeContacts[0]!.sessionId).toBe("a");
  });

  it("reports a contact closed only by SPIKE_CONFIG.contactPad, not by real geometric overlap", () => {
    // `contactNormalBetween` inflates BOTH shapes by `pad`, so the real slack between the two real
    // (unpadded) rectangles is `2 * pad`, not `pad` (see `hullTouchesWorld`'s comment in contact.ts).
    // Leave a real gap of `2 * pad - 1`: one unit short of the full padded slack, so the two hulls
    // are genuinely separated (gap > 0) and the only thing that closes it is the pad.
    const gap = 2 * SPIKE_CONFIG.contactPad - 1;
    const nearMiss = car({ x: strip.x + strip.w + gap + DRIVE_CONFIG.carWidth / 2, y: 150, vx: -100, vy: 0 });
    const { events } = resolveContacts([nearMiss], new Set(), "ffa", 1, new Map(), [strip], bounds);
    expect(events.spikeContacts).toHaveLength(1);
  });
});
