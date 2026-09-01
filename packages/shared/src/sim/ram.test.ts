import { describe, expect, it } from "vitest";
import { RAM_CONFIG } from "../config/ram-config.js";
import { massOf } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import { applyRams, impactSideOf, pairKey, resolveRam, type RamCar } from "./ram.js";

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

  it("writes the knock onto the victim, never the attacker", () => {
    const { attacker, victim } = headOn(500);
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.knock.sessionId).toBe(victim.sessionId);
  });

  it("degrades victim authority below 1 but never below the floor", () => {
    const { attacker, victim } = headOn(540);
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.knock.authority).toBeLessThan(1);
    expect(hit.knock.authority).toBeGreaterThanOrEqual(RAM_CONFIG.authorityFloor);
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
    expect(rear.knock.authority).toBeLessThan(front.knock.authority);
  });

  it("clamps severity at 1 even on a rear hit, so authority never dips below the floor", () => {
    const attacker = car({ sessionId: "a", speed: 100000, carId: "bastion" as CarId });
    const victim = car({ sessionId: "b", x: 47, angle: REAR_ON });
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.severity).toBeLessThanOrEqual(1);
    expect(hit.knock.authority).toBeCloseTo(RAM_CONFIG.authorityFloor, 9);
  });

  it("produces no spin on a dead-centre hit along the victim's long axis", () => {
    expect(ram(540)!.knock.angVel).toBeCloseTo(0, 9);
  });

  it("spins opposite ways for flank hits forward of and aft of centre", () => {
    const attackerFwd = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, speed: 500 });
    const attackerAft = car({ sessionId: "a", x: -12, y: -30, angle: Math.PI / 2, speed: 500 });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const fwd = resolveRam(attackerFwd, victim, "ffa")!;
    const aft = resolveRam(attackerAft, victim, "ffa")!;
    expect(fwd.side).toBe("flank");
    expect(aft.side).toBe("flank");
    expect(Math.sign(fwd.knock.angVel)).toBe(-Math.sign(aft.knock.angVel));
    expect(fwd.knock.angVel).not.toBe(0);
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
    expect(Math.abs(hit.knock.angVel)).toBe(RAM_CONFIG.spinMaxRate);
  });

  it("produces an ordinary flank ram spin in a sane, non-trivial band", () => {
    // Pins the magnitude, not just the sign, so a future scale regression (e.g. spinScale silently
    // reverting toward 1) fails loudly instead of only showing up as a "feels weak" bug report.
    const attacker = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, speed: 500 });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.side).toBe("flank");
    expect(Math.abs(hit.knock.angVel)).toBeGreaterThan(1);
    expect(Math.abs(hit.knock.angVel)).toBeLessThan(RAM_CONFIG.spinMaxRate);
  });

  it("shoves a light victim further than a heavy one for the identical ram", () => {
    const attacker = car({ sessionId: "a", speed: 540, carId: "bastion" as CarId });
    const light = car({ sessionId: "b", x: 47, carId: "mirage" as CarId });
    const heavy = car({ sessionId: "b", x: 47, carId: "bastion" as CarId });
    const lightHit = resolveRam(attacker, light, "ffa")!;
    const heavyHit = resolveRam(attacker, heavy, "ffa")!;
    expect(Math.hypot(lightHit.knock.shoveX, lightHit.knock.shoveY)).toBeGreaterThan(
      Math.hypot(heavyHit.knock.shoveX, heavyHit.knock.shoveY),
    );
  });

  it("counts attacker mass once: equal momentum means equal impulse regardless of chassis", () => {
    // Two attackers whose (mass x speed) products match must produce the same shove on one victim.
    // Speeds chosen so severity lands well short of the clamp — at the clamp both would trivially
    // agree at 1.0 and the test would prove nothing.
    const victim = car({ sessionId: "b", x: 47, carId: "bullseye" as CarId });
    const heavySlow = car({ sessionId: "a", speed: 70, carId: "bastion" as CarId });
    const scaled = (massOf("bastion") * 70) / massOf("mirage");
    const lightFast = car({ sessionId: "a", speed: scaled, carId: "mirage" as CarId });
    const one = resolveRam(heavySlow, victim, "ffa")!;
    const two = resolveRam(lightFast, victim, "ffa")!;
    expect(one.severity).toBeLessThan(1);
    expect(one.severity).toBeCloseTo(two.severity, 6);
    expect(one.knock.shoveX).toBeCloseTo(two.knock.shoveX, 6);
  });

  it("shoves the victim away from the attacker", () => {
    const { attacker, victim } = headOn(540);
    const hit = resolveRam(attacker, victim, "ffa")!;
    // Attacker is at -x of the victim, so the victim is pushed toward +x.
    expect(hit.knock.shoveX).toBeGreaterThan(0);
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

describe("applyRams", () => {
  const attacker = () => car({ sessionId: "a", x: 0, angle: 0, speed: 540 });
  const victim = () => car({ sessionId: "b", x: 47, angle: 0 });

  it("fires on the tick a pair enters contact", () => {
    const out = applyRams([attacker(), victim()], new Set(), "ffa");
    expect(out.knocks).toHaveLength(1);
    expect(out.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("does not re-fire while the pair stays in contact", () => {
    const first = applyRams([attacker(), victim()], new Set(), "ffa");
    const second = applyRams([attacker(), victim()], first.contacts, "ffa");
    expect(second.knocks).toHaveLength(0);
    expect(second.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("fires again after the pair separates and re-approaches", () => {
    const first = applyRams([attacker(), victim()], new Set(), "ffa");
    const apart = applyRams([attacker(), car({ sessionId: "b", x: 400 })], first.contacts, "ffa");
    expect(apart.contacts.has(pairKey("a", "b"))).toBe(false);
    const again = applyRams([attacker(), victim()], apart.contacts, "ffa");
    expect(again.knocks).toHaveLength(1);
  });

  it("tracks contact even for pairs that produce no ram, so a slow touch still blocks a re-trigger", () => {
    const idle = applyRams([car({ sessionId: "a" }), victim()], new Set(), "ffa");
    expect(idle.knocks).toHaveLength(0);
    expect(idle.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("keeps only the hardest knock when one car is hit by two others in a tick", () => {
    const soft = car({ sessionId: "a", x: -47, angle: 0, speed: 200 });
    const hard = car({ sessionId: "c", x: 47, angle: Math.PI, speed: 540, carId: "bastion" as CarId });
    const middle = car({ sessionId: "b", x: 0, angle: 0 });
    const out = applyRams([soft, middle, hard], new Set(), "ffa");
    const onB = out.knocks.filter((k) => k.sessionId === "b");
    expect(onB).toHaveLength(1);
  });

  it("is deterministic regardless of the order cars are supplied in", () => {
    const cars = [attacker(), victim()];
    const forward = applyRams(cars, new Set(), "ffa");
    const backward = applyRams([...cars].reverse(), new Set(), "ffa");
    expect(backward.knocks).toEqual(forward.knocks);
  });
});
