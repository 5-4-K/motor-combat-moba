import { describe, expect, it } from "vitest";
import { RAM_CONFIG } from "../config/ram-config.js";
import { ramAttackOf, ramDefenceOf } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import { applyImpulse } from "./impulse.js";
import { applyRams, impactSideOf, pairKey, resolveRam, type RamCar } from "./ram.js";
import type { SimBody } from "./step.js";

function car(over: Partial<RamCar> = {}): RamCar {
  // `defenceMult: 1` is the neutral value of the `ramDefence` status channel: every expectation in
  // this file is the unbuffed maths, and must stay so.
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
 * Converts an old "speed along heading" value into a world-frame velocity — the vector model has no
 * scalar speed field any more, but plenty of fixtures below are cleanest expressed this way.
 */
function velocityAt(speed: number, angle: number): { vx: number; vy: number } {
  return { vx: speed * Math.cos(angle), vy: speed * Math.sin(angle) };
}

/**
 * Attacker at the origin driving +x into a victim just ahead of it.
 *
 * The victim's OWN heading decides which face is struck, and it is easy to get backwards: the
 * attacker always arrives from the victim's -x side, so a victim facing +x (angle 0) is hit in the
 * REAR, and a victim facing -x (angle PI) is hit in the FRONT. Verified against `impactSideOf`.
 */
function headOn(attackerSpeed: number, victimAngle = 0) {
  const attacker = car({ sessionId: "a", x: 0, y: 0, angle: 0, ...velocityAt(attackerSpeed, 0) });
  const victim = car({ sessionId: "b", x: 47, y: 0, angle: victimAngle });
  return { attacker, victim };
}

const REAR_ON = 0;
const FRONT_ON = Math.PI;

function ram(attackerSpeed: number, victimAngle = REAR_ON) {
  const { attacker, victim } = headOn(attackerSpeed, victimAngle);
  return resolveRam(attacker, victim, "ffa");
}

/**
 * The attacker fixture for "the ram contest" block below: driving +x with real drive-in by default.
 * `resolveRam` names whichever side drives in harder the attacker, so several of that block's cases
 * only hold if this car genuinely wins the split — 300 u/s comfortably clears every override those
 * cases give the victim.
 */
function attackerAt(x: number, y: number, carId: CarId = "mirage" as CarId): RamCar {
  return car({ sessionId: "a", x, y, angle: 0, vx: 300, vy: 0, carId });
}

/**
 * The victim fixture for the same block: stationary by default (a case overrides `vx`/`vy` when it
 * wants to test the victim's own drive-in), facing perpendicular to the attacker's approach so the
 * hit reads as a flank.
 */
function victimAt(x: number, y: number, carId: CarId = "mirage" as CarId): RamCar {
  return car({ sessionId: "b", x, y, angle: Math.PI / 2, carId });
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

  it("returns null when combined drive-in does not exceed minApproachSpeed", () => {
    // Ships at 0 (spec R9) — written against the live config value, not a hardcoded number, so this
    // keeps meaning something if the gate is ever retuned back on. At 0 this coincides with "neither
    // car has any actual drive-in," which is exactly the boundary `<=` is meant to catch.
    const attacker = car({ sessionId: "a", x: 0, angle: 0, vx: RAM_CONFIG.minApproachSpeed, vy: 0 });
    const victim = car({ sessionId: "b", x: 47, angle: 0 });
    expect(resolveRam(attacker, victim, "ffa")).toBeNull();
  });

  it("returns null when the cars are not in contact", () => {
    const attacker = car({ sessionId: "a", vx: 400, vy: 0 });
    const far = car({ sessionId: "b", x: 400 });
    expect(resolveRam(attacker, far, "ffa")).toBeNull();
  });

  it("names the faster approacher the attacker and the other the victim", () => {
    const a = car({ sessionId: "a", x: 0, angle: 0, ...velocityAt(400, 0) });
    const b = car({ sessionId: "b", x: 47, angle: Math.PI, ...velocityAt(100, Math.PI) });
    const hit = resolveRam(a, b, "ffa");
    expect(hit?.attackerId).toBe("a");
    expect(hit?.victimId).toBe("b");
  });

  it("deals nothing to a car shunted backwards into someone — facing is what counts", () => {
    // `a` is travelling in -x (negative velocity along its own +x heading) so it is not driving into
    // `b`, and `b` never moves at all: combined drive-in is 0, at (not below) `minApproachSpeed`.
    const a = car({ sessionId: "a", x: 0, angle: 0, vx: -400, vy: 0 });
    const b = car({ sessionId: "b", x: 47, angle: 0, vx: 0, vy: 0 });
    expect(resolveRam(a, b, "ffa")).toBeNull();
  });

  it("grades the victim's impulse by attacker approach speed", () => {
    expect(ram(540)!.impulse.speed).toBeGreaterThan(ram(150)!.impulse.speed);
  });

  it("grades the victim's impulse by the attacker's chassis (ramAttack AND ramDefence both feed its push)", () => {
    // bastion carries the roster's highest ramAttack (70) and ramDefence (90); bullseye the lowest
    // ramDefence (30) and second-lowest ramAttack (45). Both terms fold into the SAME `attackerPush`
    // that `impactOn` scales the victim's impulse by (see `pushOf`), so a chassis strictly ahead on
    // both ratings must produce a strictly larger victim impulse at the identical approach speed —
    // no separate isolation of the two ratings is needed to prove that ordering.
    const light = car({ sessionId: "a", vx: 100, vy: 0, carId: "bullseye" as CarId });
    const heavy = car({ sessionId: "a", vx: 100, vy: 0, carId: "bastion" as CarId });
    const victim = car({ sessionId: "b", x: 47 });
    const lightHit = resolveRam(light, victim, "ffa")!;
    const heavyHit = resolveRam(heavy, victim, "ffa")!;
    expect(ramAttackOf("bastion")).toBeGreaterThan(ramAttackOf("bullseye"));
    expect(heavyHit.impulse.speed).toBeGreaterThan(lightHit.impulse.speed);
  });

  it("hurts the victim more from behind than from the front, at the same approach speed", () => {
    const front = ram(540, FRONT_ON)!;
    const rear = ram(540, REAR_ON)!;
    expect(front.side).toBe("front");
    expect(rear.side).toBe("rear");
    // The face bonus table (bonusFront 0.3, bonusRear 1.3) is the whole positional read now that the
    // old severity grade is gone — `impactOn` multiplies straight through it.
    expect(rear.impulse.speed).toBeGreaterThan(front.impulse.speed);
  });

  it("has no ceiling on the victim's impulse — extreme approach speed keeps scaling it up (spec R9)", () => {
    // Revision 1's severity grade clamped at 1, which is exactly what revision 2 forbids re-adding
    // (spec R9: open-ended and linear, no ceiling constant). A ten-fold jump in impulse from a
    // roughly 200x jump in approach speed is nowhere near what a clamp would allow (a clamped model
    // would top out at a small, bounded multiple), so this is a real absence-of-ceiling check, not
    // merely "bigger is bigger."
    const moderate = ram(500, REAR_ON)!;
    const extreme = ram(100000, REAR_ON)!;
    expect(extreme.impulse.speed).toBeGreaterThan(moderate.impulse.speed * 10);
  });

  it("produces no spin on a dead-centre hit along the victim's long axis", () => {
    // `resolveRam` itself only produces the `Impulse` now; the spin from a lever arm is
    // `applyImpulse`'s job (Task 3). This end-to-end check proves the two compose correctly: a
    // dead-centre hit's recovered contact point and push direction are colinear, so the torque
    // `applyImpulse` derives from them is genuinely zero, not merely untested.
    const { attacker, victim } = headOn(540);
    const hit = resolveRam(attacker, victim, "ffa")!;
    const next = applyImpulse(bodyAt(victim.x, victim.y, victim.angle), ramDefenceOf(victim.carId), hit.impulse);
    expect(next.angVel).toBeCloseTo(0, 9);
  });

  it("spins opposite ways for flank hits forward of and aft of centre", () => {
    const attackerFwd = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, ...velocityAt(500, Math.PI / 2) });
    const attackerAft = car({ sessionId: "a", x: -12, y: -30, angle: Math.PI / 2, ...velocityAt(500, Math.PI / 2) });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const fwd = resolveRam(attackerFwd, victim, "ffa")!;
    const aft = resolveRam(attackerAft, victim, "ffa")!;
    expect(fwd.side).toBe("flank");
    expect(aft.side).toBe("flank");
    const fwdSpin = applyImpulse(bodyAt(victim.x, victim.y, victim.angle), ramDefenceOf(victim.carId), fwd.impulse).angVel;
    const aftSpin = applyImpulse(bodyAt(victim.x, victim.y, victim.angle), ramDefenceOf(victim.carId), aft.impulse).angVel;
    expect(Math.sign(fwdSpin)).toBe(-Math.sign(aftSpin));
    expect(fwdSpin).not.toBe(0);
  });

  it("clamps spin at spinMaxRate when the torque genuinely exceeds it", () => {
    // An extreme approach speed plus an off-centre flank hit drives torque-derived spin arbitrarily
    // high now that the contest has no ceiling (spec R9) — unlike the old severity-clamped model,
    // reaching the spin ceiling no longer needs a swept-and-tuned geometry, only a genuine off-axis
    // lever arm (a dead-centre hit stays zero regardless of magnitude, by construction).
    const attacker = car({ sessionId: "a", x: 22.5, y: 8.5, angle: 3.25, carId: "bastion" as CarId, ...velocityAt(100000, 3.25) });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0, carId: "bullseye" as CarId });
    const hit = resolveRam(attacker, victim, "ffa")!;
    const next = applyImpulse(bodyAt(victim.x, victim.y, victim.angle), ramDefenceOf(victim.carId), hit.impulse);
    expect(Math.abs(next.angVel)).toBe(RAM_CONFIG.spinMaxRate);
  });

  it("produces an ordinary flank ram spin in a sane, non-trivial band", () => {
    // Pins the magnitude, not just the sign, so a future scale regression (e.g. spinScale silently
    // reverting toward 1) fails loudly instead of only showing up as a "feels weak" bug report.
    //
    // FIX ROUND 1 (stage 3 Task 3 review): the previous fixture kept the pre-Task-3 500 u/s speed
    // (already above any real chassis's top speed) and asserted `toBe(spinMaxRate)`, byte-identical
    // to the neighbouring "clamps spin at spinMaxRate" test above. It was not testing a band, only
    // the clamp path a second time.
    //
    // FIX ROUND 2 (stage 3 Task 4, spec P25b): re-derived at the MEASURED constants — `globalScale`
    // 1 -> 0.4 and `spinScale` 100 -> 10. The round-1 fixture's 40 u/s approach was picked to keep
    // the old constants under the ceiling; at the new ones the same fixture lands on 0.19 rad/s,
    // which is not a band worth pinning. The approach speed is now a realistic **267 u/s — Mirage's
    // own shipped top speed** — so this measures what a full-speed ordinary flank ram actually does,
    // and the value that falls out is the same 1.028 rad/s the composed-pipeline sweep behind
    // `RAM_CONFIG.spinScale`'s table measured independently for a 12 u lever arm. Two derivations,
    // one by hand and one through `serverTick` -> `contactTick`, agreeing to three decimals is what
    // makes this a re-derivation rather than a paste of whatever the code now emits.
    //
    // A LITERAL 267, not `forwardMaxSpeedOf("mirage")`: the whole derivation below is arithmetic on
    // fixed inputs, and reading a live table would make the expected value move under a speed retune
    // while the hand-derivation kept claiming the old answer. Frozen fixture, deliberately.
    //
    // Hand-derivation (both cars are mirage: ramAttack 55, ramDefence 50; from `RAM_CONFIG`,
    // defencePushScale 35, globalScale 0.4, bonusFlank 1.0, spinScale 10; inertiaCoefficient =
    // (carWidth^2 + carHeight^2)/12 = (48^2+32^2)/12 = 3328/12):
    //
    //   Geometry: attacker at (12,-30) facing +y (angle pi/2) closes on the stationary victim at
    //   (0,0) facing +x (angle 0). The two hulls' axes are world-axis-aligned (attacker rotated
    //   exactly 90 deg), the overlap is shallower along y than x, and the attacker sits on the -y
    //   side, so the contact normal (pointing victim -> attacker) is (0,-1); the victim is pushed
    //   along (0,1). `impactSideOf` puts that push on the victim's flank (perpendicular to its
    //   own +x nose), so bonusFlank applies.
    //
    //   attackerDriveIn = 267 (all of the attacker's velocity is along the closing normal),
    //   victimDriveIn = 0 (victim stationary).
    //   attackerPush = ramAttack*driveIn + ramDefence*defencePushScale = 55*267 + 50*35 = 16435
    //   victimPush   = 55*0 + 50*35 = 1750
    //   victim's share of the contest = attackerPush / (attackerPush + victimPush) = 16435/18185
    //   impulse.speed = attackerPush * share * bonusFlank * globalScale / victimRamDefence
    //                 = 16435 * (16435/18185) * 1.0 * 0.4 / 50 ~= 118.8272 u/s
    //
    //   The recovered contact point clamps the attacker's offset into the victim's hull half-extents
    //   (24 long, 16 wide): local (12, -30) clamps to (12, -16) — the y lever arm is capped at the
    //   hull's half-width. The push is (0, impulse.speed) in the victim's own (unrotated, angle 0)
    //   frame, so:
    //     torque = rx*fy - ry*fx = 12 * impulse.speed - (-16) * 0 = 12 * 118.8272 ~= 1425.926
    //     inertia = ramDefence * inertiaCoefficient = 50 * 3328/12 = 41600/3 ~= 13866.667
    //     spin (unclamped) = torque / inertia * spinScale
    //                      = (1425.926 / 13866.667) * 10 ~= 1.0283 rad/s
    //
    //   Well inside spinMaxRate (6.0), with headroom on both sides that the band below converts into
    //   a real guard: reverting `spinScale` toward 100 pushes this past 10 and into the clamp, and
    //   halving `globalScale` drops it to 0.51 — both fail. Note it is sensitive to BOTH re-pitched
    //   constants, which is the property the round-1 version lost by sitting on the clamp.
    const attacker = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, ...velocityAt(267, Math.PI / 2) });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.side).toBe("flank");
    const next = applyImpulse(bodyAt(victim.x, victim.y, victim.angle), ramDefenceOf(victim.carId), hit.impulse);
    expect(Math.abs(next.angVel)).toBeGreaterThan(0.9);
    expect(Math.abs(next.angVel)).toBeLessThan(1.2);
  });

  it("shoves a lower-ramDefence victim further than a higher-ramDefence one", () => {
    // The two rams below are NOT "identical" — swapping the victim's chassis changes `ramDefence`
    // (bastion carries the roster's highest), which changes what `impactOn` divides by, so
    // `resolveRam` itself already returns a smaller `impulse.speed` for the bastion victim before
    // `applyImpulse` ever runs. Both impulses here are `defenceScaled: false` (the contest already
    // divided by `ramDefence`), so `applyImpulse`'s own `defenceFactorOf` returns 1 for both and
    // contributes nothing on top — the entire gap this test measures came from `resolveRam`, not
    // from `applyImpulse`'s divisor. Still run end-to-end through `applyImpulse`, passing each
    // victim's real `ramDefenceOf`, to match how `ram-bridge.ts`'s `ramDefenceFor` actually applies
    // a ram, rather than asserting on `impulse.speed` directly (`impulse.test.ts` covers
    // `applyImpulse`'s own `ramDefence` scaling in isolation, on impulses where it actually applies).
    const attacker = car({ sessionId: "a", carId: "bastion" as CarId, ...velocityAt(540, 0) });
    const light = car({ sessionId: "b", x: 47, carId: "mirage" as CarId });
    const heavy = car({ sessionId: "b", x: 47, carId: "bastion" as CarId });
    const lightHit = resolveRam(attacker, light, "ffa")!;
    const heavyHit = resolveRam(attacker, heavy, "ffa")!;
    const lightNext = applyImpulse(bodyAt(light.x, light.y, light.angle), ramDefenceOf(light.carId), lightHit.impulse);
    const heavyNext = applyImpulse(bodyAt(heavy.x, heavy.y, heavy.angle), ramDefenceOf(heavy.carId), heavyHit.impulse);
    expect(Math.hypot(lightNext.vx, lightNext.vy)).toBeGreaterThan(Math.hypot(heavyNext.vx, heavyNext.vy));
  });

  it("shoves the victim away from the attacker", () => {
    const { attacker, victim } = headOn(540);
    const hit = resolveRam(attacker, victim, "ffa")!;
    // Attacker is at -x of the victim, so the victim is pushed toward +x.
    expect(hit.impulse.dirX).toBeGreaterThan(0);
  });

  it("spares teammates in team mode entirely", () => {
    const a = car({ sessionId: "a", team: 0, ...velocityAt(540, 0) });
    const mate = car({ sessionId: "b", team: 0, x: 47 });
    expect(resolveRam(a, mate, "team")).toBeNull();
  });

  it("still rams opponents in team mode", () => {
    const a = car({ sessionId: "a", team: 0, ...velocityAt(540, 0) });
    const foe = car({ sessionId: "b", team: 1, x: 47 });
    expect(resolveRam(a, foe, "team")).not.toBeNull();
  });

  it("rams everyone in ffa regardless of team number", () => {
    const a = car({ sessionId: "a", team: 0, ...velocityAt(540, 0) });
    const other = car({ sessionId: "b", team: 0, x: 47 });
    expect(resolveRam(a, other, "ffa")).not.toBeNull();
  });
});

/**
 * The contest (spec R2-R7, revision 2): each car brings its own push into the collision — its
 * `ramAttack` rating times its drive-in, plus a scaled `ramDefence` term — and what each one takes
 * is derived from the OTHER car's push, independently. This block proves the shape of that contest;
 * `resolveRam`'s own describe block above still covers side bonuses, spin and the ramDefence-divided
 * displacement end-to-end.
 */
describe("the ram contest", () => {
  it("gives the whole impact to a car that brings no drive-in", () => {
    // Attacker drives +x into a stationary victim's flank. Hand-derived from the contest formula
    // (`pushOf`/`impactOn` in ram.ts) against the live mirage ratings and RAM_CONFIG constants, so
    // this pins the actual claim rather than merely `> 0`:
    //   attackerPush = ramAttack(mirage) * attackerDriveIn(300) + ramDefence(mirage) * defencePushScale
    //   victimPush   = ramAttack(mirage) * 0                    + ramDefence(mirage) * defencePushScale
    //   victimImpact = attackerPush * (attackerPush / (attackerPush + victimPush)) * bonusFlank
    //                  * globalScale / ramDefence(mirage)
    // The victim brings no drive-in, but its standing `ramDefence` term still counts toward the
    // total the contest splits, so the attacker's share of that total (and hence of the impact) is
    // large but not exactly 1 — pinning the derived number, not asserting "share ≈ 1", is what
    // actually proves the maths rather than assuming it.
    const attackerPush = ramAttackOf("mirage") * 300 + ramDefenceOf("mirage") * RAM_CONFIG.defencePushScale;
    const victimPush = ramDefenceOf("mirage") * RAM_CONFIG.defencePushScale;
    const expectedImpact =
      (attackerPush * (attackerPush / (attackerPush + victimPush)) * RAM_CONFIG.bonusFlank * RAM_CONFIG.globalScale) /
      ramDefenceOf("mirage");
    const hit = resolveRam(attackerAt(600, 300), victimAt(640, 300), "ffa");
    expect(hit).not.toBeNull();
    expect(hit!.attackerId).toBe("a");
    expect(hit!.impulse.speed).toBeCloseTo(expectedImpact, 6);
  });

  it("takes less impact when you drive into the hit than when you are stopped", () => {
    const stopped = resolveRam(attackerAt(600, 300), victimAt(640, 300), "ffa");
    const driving = resolveRam(
      attackerAt(600, 300),
      { ...victimAt(640, 300), vx: -200, vy: 0 },
      "ffa",
    );
    // The attacker's own 300 u/s drive-in still exceeds the victim's 200, so the roles below are the
    // ones the fixture intends, not an accidental swap.
    expect(stopped!.attackerId).toBe("a");
    expect(driving!.attackerId).toBe("a");
    // The victim driving INTO the attacker wins more of the contest, so it absorbs less.
    expect(driving!.impulse.speed).toBeLessThan(stopped!.impulse.speed);
  });

  it("ignores a victim fleeing along the normal rather than crediting it negative push", () => {
    const stopped = resolveRam(attackerAt(600, 300), victimAt(640, 300), "ffa");
    const fleeing = resolveRam(
      attackerAt(600, 300),
      { ...victimAt(640, 300), vx: 400, vy: 0 },
      "ffa",
    );
    // driveIn clamps at 0, so a fleeing car brings only its standing defence push — identical to a
    // stationary one — and the attacker's own drive-in (unaffected by the victim's velocity) is
    // still what names it the attacker. Asserting EQUALITY with the stationary case, rather than
    // merely `> 0`, is what actually proves the clamp: if driveIn went negative instead of clamping,
    // the fleeing victim's own push would be smaller, changing the split and the resulting impulse.
    expect(stopped).not.toBeNull();
    expect(fleeing).not.toBeNull();
    expect(stopped!.attackerId).toBe("a");
    expect(fleeing!.attackerId).toBe("a");
    expect(fleeing!.impulse.speed).toBe(stopped!.impulse.speed);
  });

  it("is SUPERlinear in closing speed — doubling drive-in more than doubles the victim's impact", () => {
    // Was named "scales linearly with closing speed" and asserted only `fast > slow * 1.5`, which is
    // wrong on both counts: the contest is not linear in `driveIn` (`share` — the attacker's OWN
    // fraction of the total push — rises with `driveIn` too, so `victimImpact`'s two `attackerPush`
    // factors both grow), and the real ratio the old fixture produced was ~1.92, comfortably clearing
    // a `1.5` floor that would also pass a genuinely linear (exactly 2x) or even a mildly sublinear
    // curve. A band around the actual ratio is what would fail if the curve's shape changed.
    //
    // Hand-derived from the contest formula (mirage attacker, victim's own ratings never enter here
    // since its drive-in is 0 — only its `ramDefence`, 50, does; `defencePushScale` 35, `bonusFlank`
    // 1.0, `globalScale` 0.4):
    //   attackerPush(v) = ramAttack(55)*v + ramDefence(50)*defencePushScale(35) = 55v + 1750
    //   victimPush       = ramDefence(50)*defencePushScale(35) = 1750  (constant, independent of v)
    //   victimImpact(v)  = attackerPush(v)^2 * bonusFlank * globalScale / ((attackerPush(v)+victimPush) * ramDefence(50))
    //
    //   v=100: attackerPush = 5500+1750 = 7250;  victimImpact = 7250^2*0.4 / (9000*50)  ~= 46.7222
    //   v=200: attackerPush = 11000+1750 = 12750; victimImpact = 12750^2*0.4 / (14500*50) ~= 89.6897
    //   ratio = 89.6897 / 46.7222 = (51/29)^2 * (18/29) = 46818/24389 ~= 1.9196
    //
    // A materially different curve would miss this band: exactly linear lands at 2.0, and the old
    // "just monotonic" assumption (`> 1.5`) covers almost anything in between.
    const slow = resolveRam({ ...attackerAt(600, 300), vx: 100, vy: 0 }, victimAt(640, 300), "ffa");
    const fast = resolveRam({ ...attackerAt(600, 300), vx: 200, vy: 0 }, victimAt(640, 300), "ffa");
    expect(slow!.attackerId).toBe("a");
    expect(fast!.attackerId).toBe("a");
    const ratio = fast!.impulse.speed / slow!.impulse.speed;
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(1.94);
  });

  it("costs the attacker more for hitting a solid car than a flimsy one", () => {
    const vsFlimsy = resolveRam(attackerAt(600, 300), victimAt(640, 300, "bullseye"), "ffa");
    const vsSolid = resolveRam(attackerAt(600, 300), victimAt(640, 300, "bastion"), "ffa");
    expect(vsFlimsy!.attackerId).toBe("a");
    expect(vsSolid!.attackerId).toBe("a");
    expect(vsSolid!.attackerImpulse.speed).toBeGreaterThan(vsFlimsy!.attackerImpulse.speed);
  });

  it("scores the ATTACKER's own presented face too, not a hardcoded front (spec R6)", () => {
    // A car spun sideways by an earlier hit (or one genuinely reversing) can still win the drive-in
    // contest and be named `resolveRam`'s attacker while presenting its FLANK to the car it hits —
    // `driveInOf` dots the car's WHOLE velocity against the contact normal, so alignment between
    // velocity and heading is not assumed anywhere else in the contest. This is the regression test
    // for the bug where the attacker's face bonus was hardcoded to `bonusFront` regardless of the
    // geometry: mirage attacking mirage, both defaults, so `ramAttackOf`/`ramDefenceOf` are 55/50 for
    // both cars.
    //
    // Geometry: the attacker sits at x=-35, y=0, facing +y (angle pi/2 — perpendicular to its own
    // velocity), and drives along +x at 300 u/s into a stationary victim at the origin facing +x
    // (angle 0). The attacker's x-half-width (`carHeight`/2 = 16, since its long axis is rotated onto
    // world y) and the victim's x-half-length (`carWidth`/2 = 24) overlap by 5 u — a real contact —
    // while the attacker's y-half-length (24) fully contains the victim's y-half-width (16), so x is
    // the separating axis and the contact normal is world-axis-aligned: `towardVictim` = (1,0).
    // `impactSideOf((1,0), pi/2)` rotates that normal into the attacker's own frame and finds it
    // perpendicular to the attacker's heading (+y) — a FLANK, not a front, even though the attacker is
    // the one driving in.
    //
    // Hand-derived from the contest formula (`pushOf`/`impactOn` in `sim/ram.ts`), not pasted:
    //   attackerDriveIn = 300 (all of vx=300 is along the +x contact normal), victimDriveIn = 0.
    //   attackerPush = ramAttack(55)*300 + ramDefence(50)*defencePushScale(35) = 16500 + 1750 = 18250
    //   victimPush   = ramAttack(55)*0   + ramDefence(50)*defencePushScale(35) = 0     + 1750 = 1750
    //   attacker's share of the total = victimPush / (attackerPush + victimPush) = 1750 / 20000 = 0.0875
    //   attackerImpact = victimPush * share * bonusFlank(1.0) * globalScale(0.4) / ramDefence(50)
    //                  = 1750 * 0.0875 * 1.0 * 0.4 / 50 = 1.225 u/s
    // Had the attacker's face been (wrongly) hardcoded to `bonusFront` (0.3) instead of the flank it
    // actually presents, the same arithmetic would give 1750 * 0.0875 * 0.3 * 0.4 / 50 = 0.3675 u/s —
    // over 3x too cheap, which is exactly the shape of bug this test exists to catch.
    const attacker = car({ sessionId: "a", x: -35, y: 0, angle: Math.PI / 2, vx: 300, vy: 0 });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit).not.toBeNull();
    expect(hit.attackerId).toBe("a");
    expect(hit.attackerImpulse.speed).toBeCloseTo(1.225, 6);
  });

  it("makes a head-on meaningfully gentler than a T-bone at the same closing speed (R6)", () => {
    // R6's headline claim, pinned end to end against the MEASURED `globalScale` rather than argued
    // from the table: because both cars score their own presented face, a head-on scores
    // `bonusFront` (0.3) on the victim where a T-bone scores `bonusFlank` (1.0), so the same closing
    // speed lands far softer nose-to-nose than side-on. Nothing else in the suite compares the two
    // geometries directly — the front/flank/rear ordering test compares bonuses, not outcomes.
    //
    // T-bone: attacker drives +x into a victim sitting broadside (angle pi/2). The victim presents
    // its flank (bonusFlank 1.0); the attacker presents its nose (bonusFront 0.3).
    //
    // The two fixtures sit at DIFFERENT separations on purpose, and it does not skew the comparison:
    // a broadside victim is only 16 u wide along x (`carHeight`/2) against the head-on victim's 24
    // (`carWidth`/2), so 47 u — the head-on's contact distance — leaves the T-bone pair 7 u apart and
    // firing no ram at all. Separation feeds nothing in `pushOf`/`impactOn` beyond the contact test
    // and the contact normal, both identical here, so only the faces and the drive-ins differ.
    const tBone = resolveRam(
      car({ sessionId: "a", x: 0, y: 0, angle: 0, vx: 200, vy: 0 }),
      car({ sessionId: "b", x: 39, y: 0, angle: Math.PI / 2 }),
      "ffa",
    );
    // Head-on: the same 200 u/s of closing speed, split 100/100 so both cars face each other along
    // the same line and BOTH score `bonusFront` — the credit R6 gives that revision 1 never did.
    const headOn = resolveRam(
      car({ sessionId: "a", x: 0, y: 0, angle: 0, vx: 100, vy: 0 }),
      car({ sessionId: "b", x: 47, y: 0, angle: Math.PI, vx: -100, vy: 0 }),
      "ffa",
    );

    expect(tBone).not.toBeNull();
    expect(headOn).not.toBeNull();
    expect(tBone!.side).toBe("flank");
    expect(headOn!.side).toBe("front");
    // Pinned as a RATIO, which is invariant to `globalScale`, `defencePushScale` and any future
    // ramAttack/ramDefence retune — not as absolute figures, which move with all three. The spec's
    // own worked table puts a head-on at roughly 12% of a T-bone at equal closing speed; the shipped
    // roster lands well under that, which `globalScale`'s comment already records and flags as a feel
    // question rather than a defect. The bound is the claim ("meaningfully gentler"), not the value.
    expect(headOn!.impulse.speed).toBeLessThan(tBone!.impulse.speed * 0.3);
  });

  it("never fires on a pair that is not closing at all", () => {
    const apart = resolveRam(
      { ...attackerAt(600, 300), vx: 0, vy: 0 },
      { ...victimAt(640, 300), vx: 0, vy: 0 },
      "ffa",
    );
    // Both bring only standing defence push, and neither is driving in: no contact event.
    expect(apart).toBeNull();
  });
});

/**
 * `resolveRam` hands back an `Impulse` rather than a knock struct with its own landed velocity.
 * "pushes the victim away from the attacker" and "a lower `ramDefence` victim takes more of the
 * same hit" are covered above in the `resolveRam` block ("shoves the victim away from the
 * attacker", "shoves a lower-ramDefence victim further than a higher-ramDefence one"); this block
 * adds the two properties those don't already exercise: the contest itself opts BOTH impulses out of
 * `applyImpulse`'s own ramDefence scaling (it already divided by `ramDefence`), and the contact point is a
 * real, geometry-derived lever arm.
 */
describe("resolveRam produces an Impulse", () => {
  it("never defence-scales either impulse — the contest already divided by ramDefence", () => {
    const { attacker, victim } = headOn(540);
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.impulse.defenceScaled).toBe(false);
    expect(hit.attackerImpulse.defenceScaled).toBe(false);
  });

  it("records a contact point, so the lever arm is real", () => {
    // Off-axis on both dimensions (same fixture as the flank-spin tests above), so the recovered
    // point must differ from the victim's centre in x AND y — a stub that always returned the
    // victim's own position, or the attacker's unclamped position, would fail one of these two.
    const attacker = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, ...velocityAt(500, Math.PI / 2) });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.impulse.contactX).not.toBe(0);
    expect(hit.impulse.contactY).not.toBe(0);
  });
});

describe("applyRams", () => {
  const attacker = () => car({ sessionId: "a", x: 0, angle: 0, ...velocityAt(540, 0) });
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
    // decided by speed and chassis alone, not by the front/rear bonus table.
    const soft = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, ...velocityAt(200, Math.PI / 2) });
    const hard = car({
      sessionId: "c", x: 12, y: 30, angle: -Math.PI / 2, carId: "bastion" as CarId,
      ...velocityAt(540, -Math.PI / 2),
    });
    const middle = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const out = applyRams([soft, middle, hard], new Set(), "ffa");
    // Exactly one entry survives for "b" — a Map keyed by victim id makes "at most one per victim"
    // structural rather than something to filter for, which is the whole reason contact.ts's
    // `ImpulseEntry` map replaced the old `RamKnock[]` array.
    expect(out.impulses.size).toBe(1);
    expect(out.impulses.has("b")).toBe(true);
    // And the survivor must actually BE the hardest one — "c" (bastion, 540 u/s) against "a" (mirage,
    // 200 u/s) — not merely "some" impulse.
    expect(out.impulses.get("b")!.attackerId).toBe("c");
  });

  it("is deterministic regardless of the order cars are supplied in", () => {
    const cars = [attacker(), victim()];
    const forward = applyRams(cars, new Set(), "ffa");
    const backward = applyRams([...cars].reverse(), new Set(), "ffa");
    expect([...backward.impulses]).toEqual([...forward.impulses]);
  });
});
