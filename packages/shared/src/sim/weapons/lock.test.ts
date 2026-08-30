import { describe, expect, it } from "vitest";
import { AIM_CONFIG, AIM_TICKS } from "../../config/aim-config.js";
import type { Aabb, Bounds } from "../collide.js";
import {
  hasLineOfSight,
  inAcquireRegion,
  inRetainRegion,
  lockScore,
  muzzleOf,
  newLockState,
  signedAngleDegTo,
  updateLock,
  type LockOwner,
  type LockTarget,
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

/**
 * The owner sits well inside the arena, NOT at the origin. `pointOutsideBounds` is inclusive on
 * every edge, so a car at (0, 0) has its muzzle on the boundary and `wallClipDistance` reports a
 * reach of 0 — every line-of-sight test would fail for reasons that have nothing to do with locks.
 */
const OX = 400;
const OY = 400;

/** Enemies are placed in the owner's frame: `forward` along its nose, `lateral` across it. */
function enemyAt(sessionId: string, forward: number, lateral: number): LockTarget {
  return { sessionId, team: 1, x: OX + forward, y: OY + lateral };
}

function ctxFor(
  candidates: readonly LockTarget[],
  tick: number,
  overrides: Partial<Parameters<typeof updateLock>[1]> = {},
) {
  return {
    owner: ownerAt(OX, OY, 0),
    ownerFighting: true,
    pressedThisTick: false,
    candidates,
    mode: "ffa" as const,
    obstacles: [] as Aabb[],
    bounds: BOUNDS,
    tick,
    ...overrides,
  };
}

describe("updateLock: acquisition", () => {
  it("locks the only valid target in the region", () => {
    const next = updateLock(newLockState(), ctxFor([enemyAt("a", 200, 0)], 5));
    expect(next.targetSessionId).toBe("a");
    expect(next.lockedAtTick).toBe(5);
  });

  it("locks nothing when the region is empty", () => {
    const next = updateLock(newLockState(), ctxFor([enemyAt("a", 0, 300)], 5));
    expect(next.targetSessionId).toBe("");
  });

  it("takes the lowest score when several qualify", () => {
    // "b" is nearer and only slightly off-axis; "a" is dead ahead but far.
    const next = updateLock(newLockState(), ctxFor([enemyAt("a", 390, 0), enemyAt("b", 80, 17)], 5));
    expect(next.targetSessionId).toBe("b");
  });

  it("ignores the steal margin and the commit timer when there is no incumbent", () => {
    // Acquiring from nothing has no incumbent to beat, so a marginal target still locks instantly.
    const next = updateLock(newLockState(), ctxFor([enemyAt("a", 200, 0)], 0));
    expect(next.targetSessionId).toBe("a");
  });

  it("never locks a teammate in team mode", () => {
    const mate: LockTarget = { sessionId: "mate", team: 0, x: OX + 200, y: OY };
    const next = updateLock(newLockState(), ctxFor([mate], 5, { mode: "team" }));
    expect(next.targetSessionId).toBe("");
  });

  it("locks that same car in ffa, where teams are only seating", () => {
    const other: LockTarget = { sessionId: "other", team: 0, x: OX + 200, y: OY };
    const next = updateLock(newLockState(), ctxFor([other], 5, { mode: "ffa" }));
    expect(next.targetSessionId).toBe("other");
  });

  it("never locks itself", () => {
    const self: LockTarget = { sessionId: "me", team: 0, x: OX + 200, y: OY };
    const next = updateLock(newLockState(), ctxFor([self], 5));
    expect(next.targetSessionId).toBe("");
  });

  it("will not acquire a target it cannot see", () => {
    // Acquisition needs sight NOW. The grace period is a retention rule only -- extending it to
    // acquisition would let a lock pop onto a car that has been behind a wall the whole time.
    const wall: Aabb = { x: OX + 90, y: OY - 60, w: 40, h: 120 };
    const next = updateLock(newLockState(), ctxFor([enemyAt("a", 200, 0)], 5, { obstacles: [wall] }));
    expect(next.targetSessionId).toBe("");
  });
});

describe("updateLock: retention", () => {
  it("holds a target that has drifted past acquisition but not past retention", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    // 19 degrees at 380 units: 124 units of lateral offset, past the 120 cap, inside 120 + 30.
    const drifted = enemyAt("a", 380 * Math.cos(0.3316), 380 * Math.sin(0.3316));
    const next = updateLock(held, ctxFor([drifted], 20));
    expect(next.targetSessionId).toBe("a");
    expect(next.lockedAtTick).toBe(0);
  });

  it("releases a target that leaves the retention region", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const gone = enemyAt("a", 100, 400);
    expect(updateLock(held, ctxFor([gone], 20)).targetSessionId).toBe("");
  });

  it("releases a target that has left the field entirely", () => {
    // Death, disconnect and leaving the roster all arrive the same way: the car is simply absent
    // from the candidate list the caller builds from living fighters.
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    expect(updateLock(held, ctxFor([], 20)).targetSessionId).toBe("");
  });

  it("holds through a brief loss of sight and records when it started", () => {
    const wall: Aabb = { x: OX + 90, y: OY - 60, w: 40, h: 120 };
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([enemyAt("a", 200, 0)], 20, { obstacles: [wall] }));
    expect(next.targetSessionId).toBe("a");
    expect(next.losLostSinceTick).toBe(20);
  });

  it("releases once sight has been lost for longer than the grace", () => {
    const wall: Aabb = { x: OX + 90, y: OY - 60, w: 40, h: 120 };
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 20, lastPressTick: 0 };
    const stillHidden = updateLock(
      held,
      ctxFor([enemyAt("a", 200, 0)], 20 + AIM_TICKS.losGrace - 1, { obstacles: [wall] }),
    );
    expect(stillHidden.targetSessionId).toBe("a");

    const expired = updateLock(
      held,
      ctxFor([enemyAt("a", 200, 0)], 20 + AIM_TICKS.losGrace, { obstacles: [wall] }),
    );
    expect(expired.targetSessionId).toBe("");
  });

  it("clears the loss timer when sight returns", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 20, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([enemyAt("a", 200, 0)], 25));
    expect(next.losLostSinceTick).toBe(0);
  });

  it("releases and re-acquires in the same pass, never showing an unlocked frame", () => {
    // Spec A13. The incumbent has left the retention region and a rival is acquirable on the SAME
    // tick. A two-pass implementation — blank now, acquire next tick — would flicker the bracket
    // off for a frame. One call, one return: the rival is already locked.
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([enemyAt("a", 100, 400), enemyAt("b", 150, 0)], 40));
    expect(next.targetSessionId).toBe("b");
    expect(next.lockedAtTick).toBe(40);
  });
});

describe("updateLock: stealing", () => {
  // "a" straight ahead at 200 scores 8. A rival must reach 6 or lower to beat it by 25%.
  const incumbent = enemyAt("a", 200, 0);
  const marginal = enemyAt("b", 175, 0); // score 7 -- better, but not by enough
  const decisive = enemyAt("c", 100, 0); // score 4 -- clears the margin

  it("refuses a rival that does not clear the margin", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 30 };
    const next = updateLock(held, ctxFor([incumbent, marginal], 30));
    expect(next.targetSessionId).toBe("a");
  });

  it("refuses even a decisive rival inside the commit window", () => {
    const held = { targetSessionId: "a", lockedAtTick: 28, losLostSinceTick: 0, lastPressTick: 30 };
    const next = updateLock(held, ctxFor([incumbent, decisive], 30));
    expect(next.targetSessionId).toBe("a");
  });

  it("allows a decisive rival once the commit window has passed", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 30 };
    const at = AIM_TICKS.commit + 1;
    const next = updateLock(held, ctxFor([incumbent, decisive], Math.max(at, 30)));
    expect(next.targetSessionId).toBe("c");
    expect(next.lockedAtTick).toBe(Math.max(at, 30));
  });
});

describe("updateLock: the engagement timeout", () => {
  const incumbent = enemyAt("a", 200, 0); // score 8
  const marginal = enemyAt("b", 175, 0); // score 7 -- beats it, but not by 25%

  it("keeps incumbency alive while the player keeps pressing fire", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const tick = AIM_TICKS.lockTimeout + 5;
    const next = updateLock(held, ctxFor([incumbent, marginal], tick, { pressedThisTick: true }));
    expect(next.targetSessionId).toBe("a");
    expect(next.lastPressTick).toBe(tick);
  });

  it("refreshes on a press of ANY slot, even one the cooldown will reject", () => {
    // The timer answers "has this player disengaged?", which is a fact about the driver. It is read
    // before `beginFire`, so a press blocked by a cooldown still counts as engagement.
    const next = updateLock(newLockState(), ctxFor([incumbent], 40, { pressedThisTick: true }));
    expect(next.lastPressTick).toBe(40);
  });

  it("drops the margin once the timer lapses, so the best target simply wins", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([incumbent, marginal], AIM_TICKS.lockTimeout));
    expect(next.targetSessionId).toBe("b");
  });

  it("does not blank the lock when the timer lapses with the incumbent still best", () => {
    // The timeout strips INCUMBENCY, not the lock. Releasing and re-acquiring resolve in the same
    // pass, so the bracket never flickers off for a frame.
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([incumbent], AIM_TICKS.lockTimeout + 50));
    expect(next.targetSessionId).toBe("a");
    expect(next.lockedAtTick).toBe(0);
  });

  it("ignores the commit window once the timer has lapsed", () => {
    // Freshly locked AND disengaged: the commit timer is competitive friction, which is exactly
    // what the timeout switches off.
    const held = { targetSessionId: "a", lockedAtTick: 100, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([incumbent, marginal], 100));
    expect(next.targetSessionId).toBe("b");
  });
});

describe("updateLock: the owner", () => {
  it("holds no lock once the owner stops fighting", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([enemyAt("a", 200, 0)], 20, { ownerFighting: false }));
    expect(next).toEqual(newLockState());
  });

  it("never mutates the state it was given", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const before = { ...held };
    updateLock(held, ctxFor([enemyAt("c", 100, 0)], 200));
    expect(held).toEqual(before);
  });
});
