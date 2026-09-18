import { describe, expect, it } from "vitest";
import { RAM_CONFIG } from "../config/ram-config.js";
import { ramDefenceOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { CarId } from "../config/types.js";
import {
  applyRams,
  pairKey,
  ramTypeOf,
  regionOf,
  resolveRam,
  type RamCar,
  type RamResolution,
} from "./ram.js";

function car(over: Partial<RamCar> = {}): RamCar {
  // `defenceMult: 1` is the neutral value of the `ramDefence` status channel: every expectation in
  // this file is the unbuffed maths, and must stay so. `ramBlocked: false` is likewise the neutral
  // value of the gate stage 3 added — a car in no reeling and no attacker lock.
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
    ramBlocked: false,
    ...over,
  };
}

/**
 * Converts an old "speed along heading" value into a world-frame velocity — the vector model has no
 * scalar speed field, but every fixture below is cleanest expressed this way.
 */
function velocityAt(speed: number, angle: number): { vx: number; vy: number } {
  return { vx: speed * Math.cos(angle), vy: speed * Math.sin(angle) };
}

// Every fixture below places car "a" at the origin facing +x, so its 60 x 40 hull spans x [-30, 30]
// and y [-20, 20]. The victim distances are chosen to leave a 1 u hull overlap — deep enough for
// `contactNormalBetween` at `contactPad`, shallow enough that the recovered contact point sits on
// the faces a real ram would touch rather than somewhere inside either car.
const BROADSIDE_X = 49; // victim rotated 90 degrees: 20 u of half-width in x, so 30 + 20 - 1
const INLINE_X = 59; //    victim aligned with x:    30 u of half-length in x, so 30 + 30 - 1

/**
 * "a"'s +x/-y corner against a car facing +y, 2 u of overlap on each axis. The one placement in this
 * file where BOTH cars lead with a nose — each reads its own `frontCorner` — while the headings sit
 * 90 degrees apart, so neither classification is a head-on and the drive-in tiebreak is what decides.
 */
const CORNER_TO_CORNER = { x: 48, y: -48, angle: Math.PI / 2 } as const;

/** The attacker: nose-first along +x at `speed`. The one car in this file that ever qualifies alone. */
function noseFirstAt(speed: number, carId: CarId = "mirage" as CarId, team: 0 | 1 = 0): RamCar {
  return car({ sessionId: "a", team, x: 0, y: 0, angle: 0, carId, ...velocityAt(speed, 0) });
}

/** A stationary victim turned across the attacker's path, so its SIDE is what gets struck. */
function parkedBroadside(carId: CarId = "mirage" as CarId, team: 0 | 1 = 0): RamCar {
  return car({ sessionId: "b", team, x: BROADSIDE_X, y: 0, angle: Math.PI / 2, carId });
}

/** The same broadside victim, shifted along the attacker's nose so the hit lands off-centre. */
function parkedBroadsideOffset(offsetY: number, carId: CarId = "mirage" as CarId): RamCar {
  return car({ sessionId: "b", x: BROADSIDE_X, y: offsetY, angle: Math.PI / 2, carId });
}

/** A stationary victim facing the same way as the attacker, so its REAR is what gets struck. */
function parkedFacingAway(carId: CarId = "mirage" as CarId): RamCar {
  return car({ sessionId: "b", x: INLINE_X, y: 0, angle: 0, carId });
}

/** An oncoming car, nose-first along -x: front face to front face. */
function noseFirstOncoming(speed: number, carId: CarId = "mirage" as CarId): RamCar {
  return car({
    sessionId: "b",
    x: INLINE_X,
    y: 0,
    angle: Math.PI,
    carId,
    ...velocityAt(speed, Math.PI),
  });
}

/**
 * A car moving fast, and fast along its own nose too — but arriving at the other car SIDEWAYS, so
 * the face it leads with is its flank. Heading +y at 300 u/s while also carrying 300 u/s of +x
 * drift: it clears `minRamSpeed` several times over and still must not qualify as an attacker.
 */
function slidingSideways(): RamCar {
  return car({ sessionId: "a", x: 0, y: 0, angle: Math.PI / 2, vx: 300, vy: 300 });
}

/** A stationary car directly off "a"'s +x flank. */
function parked(carId: CarId = "mirage" as CarId): RamCar {
  return car({ sessionId: "b", x: BROADSIDE_X, y: 0, angle: 0, carId });
}

function sideOf(hit: RamResolution, sessionId: string) {
  const side = hit.sides.find((s) => s.sessionId === sessionId);
  if (side === undefined) throw new Error(`no side for ${sessionId} in ${JSON.stringify(hit)}`);
  return side;
}

function shoveMagnitudeOf(hit: RamResolution, sessionId: string): number {
  const side = sideOf(hit, sessionId);
  return Math.hypot(side.shoveX, side.shoveY);
}

describe("regionOf", () => {
  it("names the face a contact landed nearest, in the car's own frame", () => {
    const halfLength = DRIVE_CONFIG.carWidth / 2;
    const halfWidth = DRIVE_CONFIG.carHeight / 2;
    expect(regionOf(halfLength, 0, 4)).toBe("front");
    expect(regionOf(-halfLength, 0, 4)).toBe("rear");
    expect(regionOf(0, halfWidth, 4)).toBe("side");
    expect(regionOf(halfLength, halfWidth, 4)).toBe("frontCorner");
    expect(regionOf(-halfLength, -halfWidth, 4)).toBe("rearCorner");
  });

  it("names FACES, not volumes — a hit well behind the bumper is a side, not a front", () => {
    const halfWidth = DRIVE_CONFIG.carHeight / 2;
    // 6 u back from the nose but hard against the side panel: a front ZONE deep enough to catch
    // corner hits would swallow this and call a T-bone a head-on.
    expect(regionOf(DRIVE_CONFIG.carWidth / 2 - 6, halfWidth, 4)).toBe("side");
  });

  it("widens the corner band with the band argument, and only with it", () => {
    const nearCorner = DRIVE_CONFIG.carHeight / 2 - 6;
    expect(regionOf(DRIVE_CONFIG.carWidth / 2, nearCorner, 4)).toBe("front");
    expect(regionOf(DRIVE_CONFIG.carWidth / 2, nearCorner, 10)).toBe("frontCorner");
  });
});

describe("ramTypeOf", () => {
  const east = { x: 1, y: 0 };
  const west = { x: -1, y: 0 };
  const north = { x: 0, y: 1 };

  it("calls a side hit a flank however the two cars are pointed", () => {
    expect(ramTypeOf("side", east, west, 45)).toBe("flank");
    expect(ramTypeOf("side", east, east, 45)).toBe("flank");
    expect(ramTypeOf("side", east, north, 45)).toBe("flank");
  });

  it("calls a front hit a head-on only when the two are actually facing each other", () => {
    expect(ramTypeOf("front", east, west, 45)).toBe("headOn");
    expect(ramTypeOf("frontCorner", east, west, 45)).toBe("headOn");
    expect(ramTypeOf("front", east, north, 45)).toBe("flank");
  });

  it("calls a rear hit a rear only when the two headings agree", () => {
    expect(ramTypeOf("rear", east, east, 45)).toBe("rear");
    expect(ramTypeOf("rearCorner", east, east, 45)).toBe("rear");
    expect(ramTypeOf("rear", east, north, 45)).toBe("flank");
  });

  it("reads the angle argument, so widening it reclassifies a glancing hit", () => {
    expect(ramTypeOf("rear", east, { x: Math.cos(1), y: Math.sin(1) }, 45)).toBe("flank");
    expect(ramTypeOf("rear", east, { x: Math.cos(1), y: Math.sin(1) }, 80)).toBe("rear");
  });
});

describe("pairKey", () => {
  it("is order independent", () => {
    expect(pairKey("z", "a")).toBe(pairKey("a", "z"));
  });
});

describe("resolveRam", () => {
  it("is null when the faster car leads with its flank, not its nose", () => {
    expect(resolveRam(slidingSideways(), parked(), "ffa")).toBeNull();
  });

  it("is null below minRamSpeed", () => {
    expect(resolveRam(noseFirstAt(RAM_CONFIG.minRamSpeed - 1), parked(), "ffa")).toBeNull();
  });

  it("is null when the cars are not in contact at all", () => {
    expect(resolveRam(noseFirstAt(300), car({ sessionId: "b", x: 400 }), "ffa")).toBeNull();
  });

  it("stops the attacker dead and flings the victim on a flank ram", () => {
    const hit = resolveRam(noseFirstAt(150), parkedBroadside(), "ffa")!;
    expect(hit.type).toBe("flank");
    expect(hit.attackerId).toBe("a");
    expect(hit.locked).toEqual(["a"]);
    expect(hit.reeled).toEqual(["b"]);
    expect(hit.sides).toHaveLength(2);

    const attacker = sideOf(hit, "a");
    expect(attacker.replacesVelocity).toBe(true);
    expect(Math.hypot(attacker.shoveX, attacker.shoveY)).toBe(0);
    expect(attacker.spin).toBe(0);

    const victim = sideOf(hit, "b");
    expect(victim.replacesVelocity).toBe(false);
    expect(Math.hypot(victim.shoveX, victim.shoveY)).toBeGreaterThan(0);
  });

  it("shoves the victim along the ATTACKER's heading, not along the line between centres", () => {
    const hit = resolveRam(noseFirstAt(150), parkedBroadsideOffset(20), "ffa")!;
    const victim = sideOf(hit, "b");
    // The attacker faces +x, so the whole push is +x even though the victim's centre is up and to
    // the right of the contact point.
    expect(victim.shoveY).toBeCloseTo(0, 9);
    expect(victim.shoveX).toBeGreaterThan(0);
  });

  it("grades the shove by how hard the attacker is driving in", () => {
    const slow = shoveMagnitudeOf(resolveRam(noseFirstAt(100), parkedBroadside(), "ffa")!, "b");
    const fast = shoveMagnitudeOf(resolveRam(noseFirstAt(200), parkedBroadside(), "ffa")!, "b");
    expect(fast / slow).toBeCloseTo(2, 6);
  });

  it("scales the shove by the attacker's ramAttack against the victim's ramDefence", () => {
    const soft = resolveRam(noseFirstAt(150, "bastion" as CarId), parkedBroadside("bullseye" as CarId), "ffa")!;
    const hard = resolveRam(noseFirstAt(150, "bastion" as CarId), parkedBroadside("bastion" as CarId), "ffa")!;
    expect(shoveMagnitudeOf(soft, "b") / shoveMagnitudeOf(hard, "b")).toBeCloseTo(
      ramDefenceOf("bastion" as CarId) / ramDefenceOf("bullseye" as CarId),
      6,
    );
  });

  it("softens the shove by the victim's ramDefence status multiplier", () => {
    const plain = resolveRam(noseFirstAt(150), parkedBroadside(), "ffa")!;
    const braced = resolveRam(
      noseFirstAt(150),
      { ...parkedBroadside(), defenceMult: 2 },
      "ffa",
    )!;
    expect(shoveMagnitudeOf(plain, "b") / shoveMagnitudeOf(braced, "b")).toBeCloseTo(2, 6);
  });

  it("throws a flank harder than a rear", () => {
    const flank = shoveMagnitudeOf(resolveRam(noseFirstAt(150), parkedBroadside(), "ffa")!, "b");
    const rear = shoveMagnitudeOf(resolveRam(noseFirstAt(150), parkedFacingAway(), "ffa")!, "b");
    expect(flank).toBeGreaterThan(rear);
  });

  it("classifies a hit on the victim's tail as a rear ram", () => {
    expect(resolveRam(noseFirstAt(150), parkedFacingAway(), "ffa")!.type).toBe("rear");
  });

  it("spins a victim struck off-centre and not one struck dead-on", () => {
    const offCentre = resolveRam(noseFirstAt(150), parkedBroadsideOffset(20), "ffa")!;
    const deadOn = resolveRam(noseFirstAt(150), parkedBroadside(), "ffa")!;
    expect(Math.abs(sideOf(offCentre, "b").spin)).toBeGreaterThan(0);
    expect(Math.abs(sideOf(deadOn, "b").spin)).toBeCloseTo(0, 6);
  });

  it("spins opposite ways for hits either side of the victim's centre", () => {
    const above = sideOf(resolveRam(noseFirstAt(150), parkedBroadsideOffset(20), "ffa")!, "b").spin;
    const below = sideOf(resolveRam(noseFirstAt(150), parkedBroadsideOffset(-20), "ffa")!, "b").spin;
    expect(Math.sign(above)).toBe(-Math.sign(below));
    expect(Math.abs(above)).toBeCloseTo(Math.abs(below), 6);
  });

  it("does not clamp the spin — that is the bridge's job, not the classifier's", () => {
    // A spin this large can only come out of an unclamped formula: `spinMaxRate` is applied where a
    // resolution is written onto a car, because a clamp here would make a resolution's meaning
    // depend on the car it is later applied to.
    const wild = resolveRam(noseFirstAt(20000), parkedBroadsideOffset(20), "ffa")!;
    expect(Math.abs(sideOf(wild, "b").spin)).toBeGreaterThan(RAM_CONFIG.spinMaxRate);
  });

  it("stops both cars on a head-on, spins neither and reels neither", () => {
    const hit = resolveRam(noseFirstAt(150), noseFirstOncoming(150), "ffa")!;
    expect(hit.type).toBe("headOn");
    expect(hit.attackerId).toBe("");
    expect(hit.locked.slice().sort()).toEqual(["a", "b"]);
    expect(hit.reeled).toEqual([]);
    expect(hit.sides).toHaveLength(2);
    for (const side of hit.sides) {
      expect(side.replacesVelocity).toBe(true);
      expect(side.spin).toBe(0);
    }
  });

  it("credits each car's head-on shove to the OTHER car's heading and ramAttack", () => {
    const hit = resolveRam(
      noseFirstAt(150, "bastion" as CarId),
      noseFirstOncoming(150, "bullseye" as CarId),
      "ffa",
    )!;
    // "a" faces +x and "b" faces -x, so each car is thrown the way the OTHER one was pointing.
    expect(sideOf(hit, "a").shoveX).toBeLessThan(0);
    expect(sideOf(hit, "b").shoveX).toBeGreaterThan(0);
  });

  it("refuses a teammate, as canDamage does", () => {
    expect(
      resolveRam(noseFirstAt(150, "bastion" as CarId, 0), parkedBroadside("bullseye" as CarId, 0), "team"),
    ).toBeNull();
  });

  it("still rams an opponent in team mode", () => {
    expect(
      resolveRam(noseFirstAt(150, "bastion" as CarId, 0), parkedBroadside("bullseye" as CarId, 1), "team"),
    ).not.toBeNull();
  });

  it("will not let a reeling or locked car attack", () => {
    expect(resolveRam({ ...noseFirstAt(150), ramBlocked: true }, parkedBroadside(), "ffa")).toBeNull();
  });

  it("lets the other car attack when the blocked one is the victim", () => {
    const hit = resolveRam(noseFirstAt(150), { ...parkedBroadside(), ramBlocked: true }, "ffa")!;
    expect(hit.attackerId).toBe("a");
  });

  it("makes a head-on of two qualifying cars that are not facing each other but tie on speed", () => {
    // Corner to corner at right angles: each car's own FRONT CORNER takes the hit, so both qualify
    // as attackers, but the headings are 90 degrees apart so neither classification is a head-on.
    // With the drive-in dead level there is no faster car to name the attacker, and spec §7.1's
    // tiebreak resolves that as a head-on rather than by an arbitrary pick.
    const a = car({ sessionId: "a", x: 0, y: 0, angle: 0, ...velocityAt(150, 0) });
    const b = car({ sessionId: "b", ...CORNER_TO_CORNER, ...velocityAt(150, Math.PI / 2) });
    const hit = resolveRam(a, b, "ffa")!;
    expect(hit.type).toBe("headOn");
    expect(hit.attackerId).toBe("");
  });

  it("names the faster of two qualifying cars the attacker", () => {
    // The same corner geometry, with "b" driving in slower: no tie, so the type comes off "b"'s own
    // struck face (a front corner, against a 90-degree heading difference — a flank, not a head-on).
    const a = car({ sessionId: "a", x: 0, y: 0, angle: 0, ...velocityAt(150, 0) });
    const b = car({ sessionId: "b", ...CORNER_TO_CORNER, ...velocityAt(60, Math.PI / 2) });
    const hit = resolveRam(a, b, "ffa")!;
    expect(hit.type).toBe("flank");
    expect(hit.attackerId).toBe("a");
    expect(hit.reeled).toEqual(["b"]);
  });
});

describe("applyRams", () => {
  const attacker = () => car({ sessionId: "a", x: 0, angle: 0, ...velocityAt(540, 0) });
  const victim = () => car({ sessionId: "b", x: INLINE_X, angle: 0 });

  it("fires on the tick a pair enters contact", () => {
    const out = applyRams([attacker(), victim()], new Set(), "ffa");
    expect(out.rams).toHaveLength(1);
    expect(out.rams[0]!.attackerId).toBe("a");
    expect(out.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("does not re-fire while the pair stays in contact", () => {
    const first = applyRams([attacker(), victim()], new Set(), "ffa");
    const second = applyRams([attacker(), victim()], first.contacts, "ffa");
    expect(second.rams).toHaveLength(0);
    expect(second.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("fires again after the pair separates and re-approaches", () => {
    const first = applyRams([attacker(), victim()], new Set(), "ffa");
    const apart = applyRams([attacker(), car({ sessionId: "b", x: 400 })], first.contacts, "ffa");
    expect(apart.contacts.has(pairKey("a", "b"))).toBe(false);
    expect(applyRams([attacker(), victim()], apart.contacts, "ffa").rams).toHaveLength(1);
  });

  it("tracks contact even for pairs that produce no ram, so a slow touch still blocks a re-trigger", () => {
    const idle = applyRams([car({ sessionId: "a" }), victim()], new Set(), "ffa");
    expect(idle.rams).toHaveLength(0);
    expect(idle.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("collects one resolution per ramming pair when a car is sandwiched", () => {
    // Two attackers on "b"'s flanks, 15 u clear of EACH OTHER so they cannot ram one another and
    // add a third resolution for a reason unrelated to this test.
    const soft = car({ sessionId: "a", x: 0, y: -37.5, angle: Math.PI / 2, ...velocityAt(200, Math.PI / 2) });
    const hard = car({
      sessionId: "c", x: 0, y: 37.5, angle: -Math.PI / 2, carId: "bastion" as CarId,
      ...velocityAt(540, -Math.PI / 2),
    });
    const middle = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const out = applyRams([soft, middle, hard], new Set(), "ffa");
    // Both land. Merging two pushes onto one car is the BRIDGE's decision now that a resolution
    // carries both cars' sides — the old per-victim `Impulse` map made "at most one" structural and
    // silently discarded the other attacker's lock and reel along with its push.
    expect(out.rams).toHaveLength(2);
    expect(out.rams.map((r) => r.attackerId).sort()).toEqual(["a", "c"]);
  });

  it("is deterministic regardless of the order cars are supplied in", () => {
    const cars = [attacker(), victim()];
    const forward = applyRams(cars, new Set(), "ffa");
    const backward = applyRams([...cars].reverse(), new Set(), "ffa");
    // Pinned non-empty first: two empty lists are equal too, and that would be a green test with
    // nothing left to say.
    expect(forward.rams).toHaveLength(1);
    expect(backward.rams).toEqual(forward.rams);
  });
});
