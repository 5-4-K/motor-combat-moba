import { describe, expect, it } from "vitest";
import { AIM_CONFIG } from "../../config/aim-config.js";
import type { Aabb, Bounds } from "../collide.js";
import {
  hasLineOfSight,
  inAcquireRegion,
  inRetainRegion,
  lockScore,
  muzzleOf,
  signedAngleDegTo,
  type LockOwner,
} from "./lock.js";

// `Bounds` is an extent, not a min/max box: the world is [0, width] x [0, height].
const BOUNDS: Bounds = { width: 2000, height: 2000 };

// `Aabb` is `{x, y, w, h}` with x/y at the TOP-LEFT, matching how arena obstacles are authored.
function ownerAt(x: number, y: number, angle = 0): LockOwner {
  return { sessionId: "me", team: 0, x, y, angle };
}

describe("signedAngleDegTo", () => {
  it("is zero for a target straight ahead", () => {
    expect(signedAngleDegTo(ownerAt(100, 100), 300, 100)).toBeCloseTo(0, 6);
  });

  it("is signed, and measured relative to the car's heading, not to the world", () => {
    // Same world bearing, two headings: the angle is what the DRIVER sees, so rotating the car
    // must move it. A world-relative angle would report 90 in both cases.
    const facingEast = signedAngleDegTo(ownerAt(100, 100, 0), 100, 300);
    const facingSouth = signedAngleDegTo(ownerAt(100, 100, Math.PI / 2), 100, 300);
    expect(facingEast).toBeCloseTo(90, 6);
    expect(facingSouth).toBeCloseTo(0, 6);
  });

  it("wraps to (-180, 180] rather than accumulating", () => {
    // A car that has spun several times carries a large `angle`. Without normalisation the delta
    // grows without bound and every region test fails for a target sitting straight ahead.
    const spun = ownerAt(100, 100, Math.PI * 6);
    expect(Math.abs(signedAngleDegTo(spun, 300, 100))).toBeLessThan(1e-6);
    const behind = signedAngleDegTo(ownerAt(100, 100, 0), 0, 100);
    expect(Math.abs(behind)).toBeCloseTo(180, 6);
  });
});

describe("lockScore", () => {
  it("adds the angle in degrees to the distance in scaled world units", () => {
    expect(lockScore(10, 200)).toBeCloseTo(10 + 200 * AIM_CONFIG.scorePerDistanceUnit, 6);
  });

  it("ignores the sign of the angle", () => {
    expect(lockScore(-12, 300)).toBeCloseTo(lockScore(12, 300), 6);
  });

  it("prefers a nearer off-axis target to a far centreline one", () => {
    // This is the case the distance term exists for (A5). Without it, the far target -- which sits
    // near the centreline precisely BECAUSE it is far -- wins every contest.
    const nearOffAxis = lockScore(12, 80);
    const farCentreline = lockScore(1, 390);
    expect(nearOffAxis).toBeLessThan(farCentreline);
  });
});

describe("inAcquireRegion", () => {
  it("accepts a target inside every bound", () => {
    expect(inAcquireRegion(5, 150)).toBe(true);
  });

  it("rejects on the cone alone, with the lateral cap satisfied", () => {
    // 40 units out at 45 degrees: lateral offset is only 28 units, far inside the 120 unit cap, and
    // the distance is far inside lockRange. The cone is the only thing saying no -- which is the
    // whole reason a pure lateral lane was rejected.
    expect(inAcquireRegion(45, 40)).toBe(false);
  });

  it("rejects on the lateral cap alone, with the cone satisfied", () => {
    // 380 units out at 19 degrees: inside the 20 degree cone, but the lateral offset is 124 units,
    // just past the 120 unit cap. The cap is the only thing saying no -- the reason a pure cone was
    // rejected.
    expect(inAcquireRegion(19, 380)).toBe(false);
  });

  it("rejects on range alone", () => {
    expect(inAcquireRegion(0, AIM_CONFIG.lockRange + 1)).toBe(false);
    expect(inAcquireRegion(0, AIM_CONFIG.lockRange)).toBe(true);
  });

  it("hands over from the cone to the cap at the crossover distance", () => {
    // Below the crossover the cone binds; above it the cap does.
    //
    // Derived with `sin`, not `tan`, because `distance` is RADIAL everywhere in this module —
    // `Math.hypot`, the same value `lockScore` weighs — so the perpendicular offset from the
    // centreline is `distance * sin(angle)`. The crossover therefore sits at 350.9 in radial
    // terms. The 330 u figure quoted in the design doc and in `AIM_CONFIG`'s comment is the same
    // physical point measured ALONG THE AXIS (`lateralMax / tan(coneDeg)`); both are correct, and
    // mixing them puts this assertion 21 units on the wrong side of the boundary.
    const crossover = AIM_CONFIG.lateralMax / Math.sin((AIM_CONFIG.coneDeg * Math.PI) / 180);
    const justInside = crossover - 20;
    const justOutside = crossover + 20;
    // At the cone's exact edge: accepted below the crossover, rejected above it.
    expect(inAcquireRegion(AIM_CONFIG.coneDeg, justInside)).toBe(true);
    expect(inAcquireRegion(AIM_CONFIG.coneDeg, justOutside)).toBe(false);
  });
});

describe("inRetainRegion", () => {
  it("is wider than acquisition on the cone", () => {
    const justPastCone = AIM_CONFIG.coneDeg + AIM_CONFIG.retentionConeDeg / 2;
    expect(inAcquireRegion(justPastCone, 100)).toBe(false);
    expect(inRetainRegion(justPastCone, 100)).toBe(true);
  });

  it("is wider than acquisition on the lateral cap", () => {
    // The bound that a cone-only retention pad would miss entirely (A6). At 380 units the cap binds,
    // so widening only the angle would leave this target with no hysteresis at all.
    expect(inAcquireRegion(19, 380)).toBe(false);
    expect(inRetainRegion(19, 380)).toBe(true);
  });

  it("is wider than acquisition on range", () => {
    const justPast = AIM_CONFIG.lockRange + AIM_CONFIG.retentionRangeUnits / 2;
    expect(inAcquireRegion(0, justPast)).toBe(false);
    expect(inRetainRegion(0, justPast)).toBe(true);
  });

  it("still releases once every pad is exceeded", () => {
    expect(inRetainRegion(AIM_CONFIG.coneDeg + AIM_CONFIG.retentionConeDeg + 1, 100)).toBe(false);
    expect(
      inRetainRegion(0, AIM_CONFIG.lockRange + AIM_CONFIG.retentionRangeUnits + 1),
    ).toBe(false);
  });
});

describe("muzzleOf", () => {
  it("sits half a car length ahead of the centre, along the heading", () => {
    const m = muzzleOf(ownerAt(100, 100, 0));
    expect(m.x).toBeCloseTo(124, 6);
    expect(m.y).toBeCloseTo(100, 6);
  });
});

describe("hasLineOfSight", () => {
  it("is clear across empty ground", () => {
    expect(hasLineOfSight(100, 100, 500, 100, [], BOUNDS)).toBe(true);
  });

  it("is blocked by an obstacle between the two", () => {
    const wall: Aabb = { x: 280, y: 60, w: 40, h: 200 };
    expect(hasLineOfSight(100, 100, 500, 100, [wall], BOUNDS)).toBe(false);
  });

  it("is clear when the obstacle sits BEYOND the target", () => {
    // The ray is cast only as far as the target. A raycast run to the weapon's full range instead
    // would report a wall standing behind the enemy as cover.
    const wall: Aabb = { x: 600, y: 60, w: 40, h: 200 };
    expect(hasLineOfSight(100, 100, 500, 100, [wall], BOUNDS)).toBe(true);
  });

  it("is clear when the obstacle is off the line", () => {
    const wall: Aabb = { x: 280, y: 400, w: 40, h: 200 };
    expect(hasLineOfSight(100, 100, 500, 100, [wall], BOUNDS)).toBe(true);
  });
});
