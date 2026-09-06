import { describe, expect, it } from "vitest";
import { RAM_CONFIG } from "../config/ram-config.js";
import { massOf } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import { applyImpulse } from "./impulse.js";
import { applyRams, impactSideOf, pairKey, resolveRam, type RamCar } from "./ram.js";
import type { SimBody } from "./step.js";

function car(over: Partial<RamCar> = {}): RamCar {
  // `massMult: 1` is the neutral value of the `ramMass` status channel: every expectation in
  // this file is the unbuffed maths, and must stay so.
  return {
    sessionId: "a",
    team: 0,
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    carId: "mirage" as CarId,
    massMult: 1,
    ...over,
  };
}

/**
 * A resting `SimBody` at the given pose, for feeding a `resolveRam` result through `applyImpulse`.
 * `resolveRam` itself no longer computes a landed velocity or spin at all (Task 3/4 of the
 * car-physics rework moved that entirely into `applyImpulse`) — it only produces the `Impulse`, so
 * a handful of tests below apply it end-to-end exactly as `ram-bridge.ts` does, to keep proving the
 * geometry (contact point, lever arm, spin sign) composes correctly with the new applier.
 */
function bodyAt(x: number, y: number, angle: number): SimBody {
  return {
    x, y, angle, vx: 0, vy: 0, reverseHold: 0, angVel: 0,
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
  };
}

/**
 * Attacker at the origin driving +x into a victim just ahead of it.
 *
 * The victim's OWN heading decides which face is struck, and it is easy to get backwards: the
 * attacker always arrives from the victim's -x side, so a victim facing +x (angle 0) is hit in the
 * REAR, and a victim facing -x (angle PI) is hit in the FRONT. Verified against `impactSideOf`.
 */
function headOn(attackerSpeed: number, victimAngle = 0) {
  const attacker = car({ sessionId: "a", x: 0, y: 0, angle: 0, speed: attackerSpeed });
  const victim = car({ sessionId: "b", x: 47, y: 0, angle: victimAngle });
  return { attacker, victim };
}

const REAR_ON = 0;
const FRONT_ON = Math.PI;

function ram(attackerSpeed: number, victimAngle = REAR_ON) {
  const { attacker, victim } = headOn(attackerSpeed, victimAngle);
  return resolveRam(attacker, victim, "ffa");
}

describe("impactSideOf", () => {
  it("classifies a normal off the nose as front", () => {
    expect(impactSideOf({ x: 1, y: 0 }, 0)).toBe("front");
  });

  it("classifies a normal off the tail as rear", () => {
    expect(impactSideOf({ x: -1, y: 0 }, 0)).toBe("rear");
  });

  it("classifies a normal off either side as flank", () => {
    expect(impactSideOf({ x: 0, y: 1 }, 0)).toBe("flank");
    expect(impactSideOf({ x: 0, y: -1 }, 0)).toBe("flank");
  });

  it("is measured in the victim's frame, so rotating the victim reclassifies the same normal", () => {
    expect(impactSideOf({ x: 1, y: 0 }, 0)).toBe("front");
    expect(impactSideOf({ x: 1, y: 0 }, Math.PI)).toBe("rear");
    expect(impactSideOf({ x: 1, y: 0 }, Math.PI / 2)).toBe("flank");
  });
});

describe("pairKey", () => {
  it("is order independent", () => {
    expect(pairKey("z", "a")).toBe(pairKey("a", "z"));
  });
});

describe("resolveRam", () => {
  it("returns null when neither car is driving into the other", () => {
    const { attacker, victim } = headOn(0);
    expect(resolveRam(attacker, victim, "ffa")).toBeNull();
  });

  it("returns null below the minimum approach speed", () => {
    const { attacker, victim } = headOn(RAM_CONFIG.minApproachSpeed - 1);
    expect(resolveRam(attacker, victim, "ffa")).toBeNull();
  });

  it("returns null when the cars are not in contact", () => {
    const attacker = car({ sessionId: "a", speed: 400 });
    const far = car({ sessionId: "b", x: 400 });
    expect(resolveRam(attacker, far, "ffa")).toBeNull();
  });

  it("names the faster approacher the attacker and the other the victim", () => {
    const a = car({ sessionId: "a", x: 0, angle: 0, speed: 400 });
    const b = car({ sessionId: "b", x: 47, angle: Math.PI, speed: 100 });
    const hit = resolveRam(a, b, "ffa");
    expect(hit?.attackerId).toBe("a");
    expect(hit?.victimId).toBe("b");
  });

  it("deals nothing to a car shunted backwards into someone — facing is what counts", () => {
    // `a` is travelling in -x (negative speed along +x heading) so it is not driving into `b`.
    const a = car({ sessionId: "a", x: 0, angle: 0, speed: -400 });
    const b = car({ sessionId: "b", x: 47, angle: 0, speed: 0 });
    expect(resolveRam(a, b, "ffa")).toBeNull();
  });

  it("grades severity by approach speed", () => {
    expect(ram(540)!.severity).toBeGreaterThan(ram(150)!.severity);
  });

  it("grades severity by attacker mass", () => {
    // 100, not the 300 this test used before the 2026-09-01 half-speed cut: RAM_REFERENCE halved
    // with the roster's top speed, and at 300 both chassis saturate the severity clamp and tie.
    const light = car({ sessionId: "a", speed: 100, carId: "mirage" as CarId });
    const heavy = car({ sessionId: "a", speed: 100, carId: "bastion" as CarId });
    const victim = car({ sessionId: "b", x: 47 });
    const lightHit = resolveRam(light, victim, "ffa")!;
    const heavyHit = resolveRam(heavy, victim, "ffa")!;
    expect(massOf("bastion")).toBeGreaterThan(massOf("mirage"));
    expect(heavyHit.severity).toBeGreaterThan(lightHit.severity);
  });

  it("hurts more from behind than from the front", () => {
    const front = ram(540, FRONT_ON)!;
    const rear = ram(540, REAR_ON)!;
    expect(front.side).toBe("front");
    expect(rear.side).toBe("rear");
    expect(rear.severity).toBeGreaterThan(front.severity);
    // Authority is gone (Task 4: `Impulse` has no such field) — the corollary now is a bigger
    // push, since `impulse.speed` is `severity * knockMaxSpeed` directly.
    expect(rear.impulse.speed).toBeGreaterThan(front.impulse.speed);
  });

  it("clamps severity at 1 even on a rear hit, so the impulse never exceeds knockMaxSpeed", () => {
    const attacker = car({ sessionId: "a", speed: 100000, carId: "bastion" as CarId });
    const victim = car({ sessionId: "b", x: 47, angle: REAR_ON });
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.severity).toBeLessThanOrEqual(1);
    expect(hit.impulse.speed).toBeCloseTo(RAM_CONFIG.knockMaxSpeed, 9);
  });

  it("produces no spin on a dead-centre hit along the victim's long axis", () => {
    // `resolveRam` itself only produces the `Impulse` now; the spin from a lever arm is
    // `applyImpulse`'s job (Task 3). This end-to-end check proves the two compose correctly: a
    // dead-centre hit's recovered contact point and push direction are colinear, so the torque
    // `applyImpulse` derives from them is genuinely zero, not merely untested.
    const { attacker, victim } = headOn(540);
    const hit = resolveRam(attacker, victim, "ffa")!;
    const next = applyImpulse(bodyAt(victim.x, victim.y, victim.angle), massOf(victim.carId), hit.impulse);
    expect(next.angVel).toBeCloseTo(0, 9);
  });

  it("spins opposite ways for flank hits forward of and aft of centre", () => {
    const attackerFwd = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, speed: 500 });
    const attackerAft = car({ sessionId: "a", x: -12, y: -30, angle: Math.PI / 2, speed: 500 });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const fwd = resolveRam(attackerFwd, victim, "ffa")!;
    const aft = resolveRam(attackerAft, victim, "ffa")!;
    expect(fwd.side).toBe("flank");
    expect(aft.side).toBe("flank");
    const fwdSpin = applyImpulse(bodyAt(victim.x, victim.y, victim.angle), massOf(victim.carId), fwd.impulse).angVel;
    const aftSpin = applyImpulse(bodyAt(victim.x, victim.y, victim.angle), massOf(victim.carId), aft.impulse).angVel;
    expect(Math.sign(fwdSpin)).toBe(-Math.sign(aftSpin));
    expect(fwdSpin).not.toBe(0);
  });

  it("clamps spin at spinMaxRate when the torque genuinely exceeds it", () => {
    // A near-corner flank hit at extreme speed and mass drives the unclamped torque-derived spin
    // well past the ceiling — this position was found by sweeping attacker pose against a fixed
    // victim until |angVel| saturated, so the assertion is pinned to the clamp itself rather than
    // merely being consistent with any implementation (including a no-op one).
    //
    // Victim is pinned to `bullseye` (the roster's lightest chassis post-T5, mass 300) rather than
    // the default `mirage`: spin is torque / (victimMass * inertiaCoefficient), and Task 4 raised
    // every chassis's mass, including mirage's (350 -> 480). At that higher inertia this same swept
    // pose no longer saturates the clamp — the theoretical max torque available at this geometry
    // (attacker mass and impulse are both already capped by the severity clamp) tops out under what
    // a 480-mass victim needs. The lightest victim keeps this a genuine ceiling test rather than a
    // number that happens to be under it.
    const attacker = car({ sessionId: "a", x: 22.5, y: 8.5, angle: 3.25, speed: 100000, carId: "bastion" as CarId });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0, carId: "bullseye" as CarId });
    const hit = resolveRam(attacker, victim, "ffa")!;
    const next = applyImpulse(bodyAt(victim.x, victim.y, victim.angle), massOf(victim.carId), hit.impulse);
    expect(Math.abs(next.angVel)).toBe(RAM_CONFIG.spinMaxRate);
  });

  it("produces an ordinary flank ram spin in a sane, non-trivial band", () => {
    // Pins the magnitude, not just the sign, so a future scale regression (e.g. spinScale silently
    // reverting toward 1) fails loudly instead of only showing up as a "feels weak" bug report.
    const attacker = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, speed: 500 });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.side).toBe("flank");
    const next = applyImpulse(bodyAt(victim.x, victim.y, victim.angle), massOf(victim.carId), hit.impulse);
    expect(Math.abs(next.angVel)).toBeGreaterThan(1);
    expect(Math.abs(next.angVel)).toBeLessThan(RAM_CONFIG.spinMaxRate);
  });

  it("shoves a light victim further than a heavy one for the identical ram", () => {
    // `resolveRam` no longer divides victim mass out at all (Task 4) — this is now an end-to-end
    // check through `applyImpulse`, the single place mass enters (see that function's own tests
    // in `impulse.test.ts` for the isolated version of this claim).
    const attacker = car({ sessionId: "a", speed: 540, carId: "bastion" as CarId });
    const light = car({ sessionId: "b", x: 47, carId: "mirage" as CarId });
    const heavy = car({ sessionId: "b", x: 47, carId: "bastion" as CarId });
    const lightHit = resolveRam(attacker, light, "ffa")!;
    const heavyHit = resolveRam(attacker, heavy, "ffa")!;
    const lightNext = applyImpulse(bodyAt(light.x, light.y, light.angle), massOf(light.carId), lightHit.impulse);
    const heavyNext = applyImpulse(bodyAt(heavy.x, heavy.y, heavy.angle), massOf(heavy.carId), heavyHit.impulse);
    expect(Math.hypot(lightNext.vx, lightNext.vy)).toBeGreaterThan(Math.hypot(heavyNext.vx, heavyNext.vy));
  });

  it("counts attacker mass once: equal momentum means equal impulse regardless of chassis", () => {
    // Two attackers whose (mass x speed) products match must produce the same push on one victim.
    // Speeds chosen so severity lands well short of the clamp — at the clamp both would trivially
    // agree at 1.0 and the test would prove nothing. Compared as `impulse.speed` directly rather
    // than a shoved velocity: that field IS the un-mass-scaled magnitude `resolveRam` now hands
    // off, so this is the precise quantity in question rather than a value one more step removed.
    const victim = car({ sessionId: "b", x: 47, carId: "bullseye" as CarId });
    const heavySlow = car({ sessionId: "a", speed: 70, carId: "bastion" as CarId });
    const scaled = (massOf("bastion") * 70) / massOf("mirage");
    const lightFast = car({ sessionId: "a", speed: scaled, carId: "mirage" as CarId });
    const one = resolveRam(heavySlow, victim, "ffa")!;
    const two = resolveRam(lightFast, victim, "ffa")!;
    expect(one.severity).toBeLessThan(1);
    expect(one.severity).toBeCloseTo(two.severity, 6);
    expect(one.impulse.speed).toBeCloseTo(two.impulse.speed, 6);
  });

  it("shoves the victim away from the attacker", () => {
    const { attacker, victim } = headOn(540);
    const hit = resolveRam(attacker, victim, "ffa")!;
    // Attacker is at -x of the victim, so the victim is pushed toward +x.
    expect(hit.impulse.dirX).toBeGreaterThan(0);
  });

  it("spares teammates in team mode entirely", () => {
    const a = car({ sessionId: "a", team: 0, speed: 540 });
    const mate = car({ sessionId: "b", team: 0, x: 47 });
    expect(resolveRam(a, mate, "team")).toBeNull();
  });

  it("still rams opponents in team mode", () => {
    const a = car({ sessionId: "a", team: 0, speed: 540 });
    const foe = car({ sessionId: "b", team: 1, x: 47 });
    expect(resolveRam(a, foe, "team")).not.toBeNull();
  });

  it("rams everyone in ffa regardless of team number", () => {
    const a = car({ sessionId: "a", team: 0, speed: 540 });
    const other = car({ sessionId: "b", team: 0, x: 47 });
    expect(resolveRam(a, other, "ffa")).not.toBeNull();
  });
});

/**
 * Task 4 of the car-physics rework: `resolveRam` hands back an `Impulse` rather than a `RamKnock`.
 * "pushes the victim away from the attacker" and "scales the victim's displacement by mass" are
 * covered above in the `resolveRam` block ("shoves the victim away from the attacker",
 * "shoves a light victim further than a heavy one") and by `massScaled` below; this block adds the
 * one property those don't already exercise: that the contact point is a real, geometry-derived
 * lever arm rather than a stub.
 */
describe("resolveRam produces an Impulse", () => {
  it("scales the victim's displacement by mass", () => {
    const { attacker, victim } = headOn(540);
    expect(resolveRam(attacker, victim, "ffa")!.impulse.massScaled).toBe(true);
  });

  it("records a contact point, so the lever arm is real", () => {
    // Off-axis on both dimensions (same fixture as the flank-spin tests above), so the recovered
    // point must differ from the victim's centre in x AND y — a stub that always returned the
    // victim's own position, or the attacker's unclamped position, would fail one of these two.
    const attacker = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, speed: 500 });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.impulse.contactX).not.toBe(0);
    expect(hit.impulse.contactY).not.toBe(0);
  });
});

describe("applyRams", () => {
  const attacker = () => car({ sessionId: "a", x: 0, angle: 0, speed: 540 });
  const victim = () => car({ sessionId: "b", x: 47, angle: 0 });

  it("fires on the tick a pair enters contact", () => {
    const out = applyRams([attacker(), victim()], new Set(), "ffa");
    expect(out.impulses.size).toBe(1);
    expect(out.impulses.has("b")).toBe(true);
    expect(out.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("does not re-fire while the pair stays in contact", () => {
    const first = applyRams([attacker(), victim()], new Set(), "ffa");
    const second = applyRams([attacker(), victim()], first.contacts, "ffa");
    expect(second.impulses.size).toBe(0);
    expect(second.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("fires again after the pair separates and re-approaches", () => {
    const first = applyRams([attacker(), victim()], new Set(), "ffa");
    const apart = applyRams([attacker(), car({ sessionId: "b", x: 400 })], first.contacts, "ffa");
    expect(apart.contacts.has(pairKey("a", "b"))).toBe(false);
    const again = applyRams([attacker(), victim()], apart.contacts, "ffa");
    expect(again.impulses.size).toBe(1);
  });

  it("tracks contact even for pairs that produce no ram, so a slow touch still blocks a re-trigger", () => {
    const idle = applyRams([car({ sessionId: "a" }), victim()], new Set(), "ffa");
    expect(idle.impulses.size).toBe(0);
    expect(idle.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("keeps only the hardest impulse when one car is hit by two others in a tick", () => {
    // Both attackers hit the SAME side (flank, bonus 1.0 either way) so which one is "hardest" is
    // decided by speed and mass alone, not by the front/rear bonus table — a head-on-vs-rear fixture
    // (the review found this one originally was) makes "hardest" ambiguous: a fast, heavy REAR hit
    // and a faster, heavier FRONT hit can trade places once the 0.3/1.3 bonus is folded in, which is
    // exactly what silently happened here before (attacker "a", the "soft" one, actually won on the
    // old rear/front fixture — the size/has assertions below never noticed).
    const soft = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, speed: 200 });
    const hard = car({ sessionId: "c", x: 12, y: 30, angle: -Math.PI / 2, speed: 540, carId: "bastion" as CarId });
    const middle = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const out = applyRams([soft, middle, hard], new Set(), "ffa");
    // Exactly one entry survives for "b" — a Map keyed by victim id makes "at most one per victim"
    // structural rather than something to filter for, which is the whole reason contact.ts's
    // `ImpulseEntry` map replaced the old `RamKnock[]` array.
    expect(out.impulses.size).toBe(1);
    expect(out.impulses.has("b")).toBe(true);
    // And the survivor must actually BE the hardest one — "c" (bastion, 540 u/s, severity saturates
    // to 1) against "a" (mirage, 200 u/s, severity ~0.72) — not merely "some" impulse. The name of
    // this test was previously true only by coincidence: nothing checked which attacker won.
    expect(out.impulses.get("b")!.attackerId).toBe("c");
  });

  it("is deterministic regardless of the order cars are supplied in", () => {
    const cars = [attacker(), victim()];
    const forward = applyRams(cars, new Set(), "ffa");
    const backward = applyRams([...cars].reverse(), new Set(), "ffa");
    expect([...backward.impulses]).toEqual([...forward.impulses]);
  });
});
