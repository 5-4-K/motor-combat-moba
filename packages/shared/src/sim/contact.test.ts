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
    pushesStunned: false,
    pushesOnContact: false,
    stunned: false,
    maneuverWeaponId: "",
    ...over,
  };
}

describe("maneuver push (spec S3, O2/O3/O18)", () => {
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
      pushesStunned: true,
      pushesOnContact: true,
      ...over,
    });
  const victimAt = (x: number, over = {}) =>
    car({ sessionId: "b", x, y: 0, angle: 0, vx: 0, vy: 0, carId: "mirage" as CarId, ...over });

  it("reports the contact geometry on the event and writes NO impulse (stage 4)", () => {
    // The whole payload of the charge branch now. A push's magnitude, spin, defence-scaling and
    // control-loss all live on `wildcharge`'s own `ImpulseDef` and are assembled by `ram-bridge.ts`;
    // what only this pass can produce is the OBB contact normal and the contact point, so that is
    // what the event carries and all this file can assert about the push.
    const r = resolveContacts([charger(), victimAt(58.75)], new Set(), "ffa", 10, new Map(), [], bounds);
    expect(r.events.contactHits).toHaveLength(1);
    const hit = r.events.contactHits[0]!;
    expect(hit).toMatchObject({ attackerSessionId: "a", targetSessionId: "b", weaponId: "wildcharge" });
    const push = hit.push!;
    // The charger sits at x=0 facing +x and the victim at x=58.75 (a grazing 1.25 u overlap against
    // the 60x40 hull; 47, a 1 u overlap, at 48x32 before the 2026-09-16 resize — every ±58.75 in
    // this file is that same scaled touch), so the push points along +x, and it is a UNIT vector —
    // `applyImpulse` multiplies it by the def's `speed`, so a non-unit direction would silently
    // rescale the ult.
    expect(push.dirX).toBeCloseTo(1, 6);
    expect(push.dirY).toBeCloseTo(0, 6);
    expect(Math.hypot(push.dirX, push.dirY)).toBeCloseTo(1, 6);
    // A GENUINE point on the victim's hull (`contactPointOn`), not its centre: the attacker's centre
    // (0,0) clamped into the victim's half-extents (±30 long, ±20 wide) around x=58.75 lands on the
    // victim's near face, x = 58.75 - 30 = 28.75 — 30 u short of the victim's own centre. Until
    // 2026-09-19 this field was hardcoded to the victim's centre (58.75), which zeroed the lever arm;
    // see `ContactHit.push`'s doc comment.
    expect(push.contactX).toBe(28.75);
    expect(push.contactY).toBe(0);
    // Nothing at all on the events' `rams` list: a maneuver hit does not compete with a ram for a
    // slot any more (there is no slot), and the pair produced no ram of its own either (`resolvePair`
    // short-circuits on `anyEvent`).
    expect(r.events.rams).toHaveLength(0);
  });

  it("only the ram fallback still produces a RamResolution here", () => {
    // The contrast that keeps the assertion above meaningful: the SAME geometry with no charge
    // running falls through to an ordinary ram, which does land on `events.rams` — so an empty list
    // above is evidence about the maneuver branch, not about the fixture failing to touch at all. The
    // attacker (behind, matching heading — a rear hit) stops dead (`replacesVelocity: true`, zero
    // shove) and is locked; the victim is flung along the attacker's heading and left reeling —
    // Unity's rule (spec §7.2), not a computed contest.
    const ram = resolveContacts(
      [car({ sessionId: "a", x: 0, y: 0, angle: 0, vx: 300, vy: 0, carId: "bastion" as CarId }), victimAt(58.75)],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      bounds,
    );
    expect(ram.events.contactHits).toHaveLength(0);
    expect(ram.events.rams).toHaveLength(1);
    const resolution = ram.events.rams[0]!;
    expect(resolution.type).toBe("rear");
    expect(resolution.attackerId).toBe("a");
    expect(resolution.locked).toEqual(["a"]);
    expect(resolution.reeled).toEqual(["b"]);
    const attackerSide = resolution.sides.find((s) => s.sessionId === "a")!;
    expect(attackerSide.replacesVelocity).toBe(true);
    expect(attackerSide.shoveX).toBe(0);
    const victimSide = resolution.sides.find((s) => s.sessionId === "b")!;
    expect(victimSide.replacesVelocity).toBe(false);
    expect(victimSide.shoveX).toBeGreaterThan(0);
  });

  it("pushes a stunned victim only when the weapon says so (O3)", () => {
    const blocked = resolveContacts(
      [charger({ pushesStunned: false }), victimAt(58.75, { stunned: true })],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      bounds,
    );
    expect(blocked.events.contactHits).toHaveLength(0); // falls back to an ordinary ram
    const exempt = resolveContacts(
      [charger({ pushesStunned: true }), victimAt(58.75, { stunned: true })],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      bounds,
    );
    expect(exempt.events.contactHits).toHaveLength(1);
    expect(exempt.events.contactHits[0]!.push).toBeDefined();
  });

  it("respects re-push immunity, falling back to an ordinary ram (O18)", () => {
    const immune = new Map([["b", 25]]); // immune until tick 25
    const r = resolveContacts([charger(), victimAt(58.75)], new Set(), "ffa", 10, immune, [], bounds);
    expect(r.events.contactHits).toHaveLength(0);
  });

  it("stays edge-triggered like the ram it extends", () => {
    const touching = new Set([pairKey("a", "b")]);
    const r = resolveContacts([charger(), victimAt(58.75)], touching, "ffa", 10, new Map(), [], bounds);
    expect(r.events.contactHits).toHaveLength(0);
    expect(r.events.rams).toHaveLength(0);
  });

  it("no longer displaces a concurrent ordinary ram on the same victim", () => {
    // Three cars: a rammer and a charger touch the SAME victim from opposite sides in one tick.
    // Through stage 3 (the old `best` map) both pairs competed for the one per-victim slot and the
    // push won it, on an ordering nothing enforced — the ram was simply thrown away. Now there is no
    // slot at all: `events.rams` and `events.contactHits` are two independent lists, so the ram
    // survives as its own entry and both land downstream.
    //
    // Session ids are chosen so the RAM pair is enumerated BEFORE the CHARGE pair: `resolveContacts`
    // sorts by session id ("aRam" < "victim" < "zCharge"), so the nested pair loop visits
    // (aRam, victim) ahead of (victim, zCharge). Under the old `best` comparison that ordering was
    // what gave the push something to overwrite.
    const rammer = car({ sessionId: "aRam", x: -58.75, y: 0, angle: 0, vx: 100, vy: 0, carId: "bastion" as CarId });
    const victim = car({ sessionId: "victim", x: 0, y: 0, angle: 0, carId: "mirage" as CarId });
    const charger2 = car({
      sessionId: "zCharge",
      x: 58.75,
      y: 0,
      angle: Math.PI,
      carId: "bastion" as CarId,
      maneuver: ManeuverKind.CHARGE,
      maneuverWeaponId: "wildcharge",
      pushesStunned: true,
      pushesOnContact: true,
    });
    const r = resolveContacts([rammer, victim, charger2], new Set(), "ffa", 10, new Map(), [], bounds);

    expect(r.events.contactHits).toHaveLength(1);
    expect(r.events.contactHits[0]).toMatchObject({ attackerSessionId: "zCharge", targetSessionId: "victim" });
    // The ram is still here, still attributed to the rammer, as its own resolution rather than
    // something a push overwrote.
    expect(r.events.rams).toHaveLength(1);
    const resolution = r.events.rams[0]!;
    expect(resolution.attackerId).toBe("aRam");
    expect(resolution.reeled).toEqual(["victim"]);
  });

  it("reports BOTH pushes when two chargers land on one victim in a tick", () => {
    // Two chargers hit the SAME victim from opposite sides. There is no per-victim slot for them to
    // contest any more, so neither is dropped: both events are reported, in pair-enumeration order,
    // and `ram-bridge.ts` applies both pushes. Under the old `best` map one of the two was silently
    // discarded, and which one depended on a `>=` comparison between two identical magnitudes.
    const charger1 = charger({ sessionId: "aCharge", x: -58.75, y: 0, angle: 0 });
    const victim = car({ sessionId: "victim", x: 0, y: 0, angle: 0, carId: "mirage" as CarId });
    const charger2 = charger({ sessionId: "zCharge", x: 58.75, y: 0, angle: Math.PI });
    const r = resolveContacts([charger1, victim, charger2], new Set(), "ffa", 10, new Map(), [], bounds);

    expect(r.events.contactHits.map((h) => h.attackerSessionId)).toEqual(["aCharge", "zCharge"]);
    // Opposite approaches produce opposite push directions, which is the geometry actually being
    // carried rather than a constant copied onto both events.
    expect(r.events.contactHits[0]!.push!.dirX).toBeCloseTo(1, 6);
    expect(r.events.contactHits[1]!.push!.dirX).toBeCloseTo(-1, 6);
    // Both pairs produced a hit (anyEvent), so neither one falls through to the ram arm at all —
    // not "no ram survived a contest", but "no ram was ever attempted" for either pair.
    expect(r.events.rams).toHaveLength(0);
  });
});

describe("one contact event, and a real contact point (2026-09-19)", () => {
  const bounds = { width: 4000, height: 4000 };
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
  const charger = car({
    sessionId: "a",
    x: 0,
    y: 0,
    angle: 0,
    vx: 300,
    vy: 0,
    carId: "bastion" as CarId,
    maneuver: ManeuverKind.CHARGE,
    maneuverWeaponId: "wildcharge",
    pushesStunned: true,
    pushesOnContact: true,
  });
  const victim = car({ sessionId: "b", x: 58.75, y: 0, angle: 0, carId: "bastion" as CarId });

  it("reports a dash and a charge as the same kind of event, in one list", () => {
    const { events } = resolveContacts([dasher, victim], new Set(), "ffa", 0, new Map(), [], bounds);
    expect(events.contactHits).toHaveLength(1);
    expect(events.contactHits[0]!.push).toBeUndefined();
  });

  it("carries push geometry only when the row declares an impulse", () => {
    const { events } = resolveContacts([charger, victim], new Set(), "ffa", 0, new Map(), [], bounds);
    expect(events.contactHits).toHaveLength(1);
    const push = events.contactHits[0]!.push!;
    expect(Math.hypot(push.dirX, push.dirY)).toBeCloseTo(1, 9);
  });

  it("derives a real contact point, not the victim's centre, so an authored spin can rotate", () => {
    // This is why `ImpulseDef.spin` could never do anything: a lever arm of exactly zero.
    const { events } = resolveContacts([charger, victim], new Set(), "ffa", 0, new Map(), [], bounds);
    const push = events.contactHits[0]!.push!;
    expect(Math.hypot(push.contactX - victim.x, push.contactY - victim.y)).toBeGreaterThan(0);
  });

  it("still keeps a car in any maneuver out of the ram arm", () => {
    // `anyEvent`'s real job. `ramLock` immobilises for half a second, and stranding a mid-ult charger
    // with it would be the worst bug this stage could ship.
    const { events } = resolveContacts([charger, victim], new Set(), "ffa", 0, new Map(), [], bounds);
    expect(events.rams).toHaveLength(0);
  });
});

describe("resolveContacts carries rams on events, not as an impulse map", () => {
  it("reports an ordinary ram on the events, not as an impulse map", () => {
    // A flank: the attacker drives in along the victim's side rather than its nose or tail (spec
    // §7.1) — see `ramTypeOf`, which calls a side-region hit a flank regardless of heading.
    const attacker = car({
      sessionId: "a",
      x: 0,
      y: -48.75,
      angle: Math.PI / 2,
      vx: 0,
      vy: 300,
      carId: "bastion" as CarId,
    });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0, vx: 0, vy: 0, carId: "mirage" as CarId });
    const { events } = resolveContacts([attacker, victim], new Set(), "ffa", 0, new Map(), [], {
      width: 4000,
      height: 4000,
    });
    expect(events.rams).toHaveLength(1);
    expect(events.rams[0]!.type).toBe("flank");
  });

  it("still leaves a dash a ContactHit, with no ram alongside it", () => {
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
    const other = car({ sessionId: "b", x: 58.75, y: 0, angle: 0, vx: 0, vy: 0, carId: "bastion" as CarId });
    const { events } = resolveContacts([dasher, other], new Set(), "ffa", 0, new Map(), [], {
      width: 4000,
      height: 4000,
    });
    expect(events.contactHits).toHaveLength(1);
    expect(events.contactHits[0]!.push).toBeUndefined();
    expect(events.rams).toHaveLength(0);
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
      [dasher, car({ sessionId: "b", x: 58.75, y: 0, angle: 0, vx: 0, vy: 0, carId: "bastion" as CarId })],
      new Set(),
      "ffa",
      10,
      new Map(),
      [],
      { width: 4000, height: 4000 },
    );
    expect(r.events.contactHits).toEqual([
      { attackerSessionId: "a", targetSessionId: "b", weaponId: "thunderclap", push: undefined },
    ]);
    expect(r.events.rams).toHaveLength(0);
  });

  it("reports a dasher pressed into level geometry", () => {
    const dasher = car({
      sessionId: "a",
      // Nose 1 u off the arena's left edge, inside `SLAM_CONFIG.wallContactPad` (1) but not through
      // the wall: half the hull length plus 1 (25 at 48x32, before the 2026-09-16 resize).
      x: DRIVE_CONFIG.carWidth / 2 + 1,
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
    // 60x40 hull since the 2026-09-16 resize; both fixtures scaled 1.25x from their 48x32 originals
    // (x 24; box { x: 530, y: 480, w: 40, h: 40 }). The tail sits exactly ON the edge, and the box
    // leaves a real 1.25 u gap to the car's front (535) that only the inflation (2 * pad) closes.
    expect(hullTouchesWorld(carHullOf(30, 500, 0), [], bounds, 1)).toBe(true); // tail ON the edge
    expect(hullTouchesWorld(carHullOf(500, 500, 0), [], bounds, 1)).toBe(false);
    const box = { x: 536.25, y: 475, w: 50, h: 50 };
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
    // x:100,y:150 overlaps the strip's AABB (x:[74,94], y:[105,200]) once the car's 60x40 hull is
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
    // y:200 with the standard 40-unit-tall hull overlaps both by half its height.
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
