import { describe, expect, it } from "vitest";
import {
  TICK_RATE_HZ, carHullOf, instanceExpired, projectileShapeAt, shapeHitsObb, smear,
  spawnInstances, stepInstance, weaponDefOf,
} from "@motor-combat-moba/shared";
import type { BotArenaView, BotCarView, BotSlotView } from "../types.js";
import {
  AIM_QUADRATURE, constantVelocityPredictor, solve, type SolverShooter,
} from "./solution.js";

const arena: BotArenaView = { width: 1280, height: 720, obstacles: [] };

function slotFor(weaponId: Parameters<typeof weaponDefOf>[0]): BotSlotView {
  return {
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  };
}

function shooterAt(x: number, y: number, angle: number): SolverShooter {
  return {
    sessionId: "me", carId: "bullseye", team: 0, x, y, angle, speed: 0,
    lockTargetSessionId: "",
  };
}

function targetAt(x: number, y: number): BotCarView {
  return {
    sessionId: "them", carId: "mirage", team: 1, x, y, angle: Math.PI, speed: 0,
    hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
  };
}

describe("AIM_QUADRATURE", () => {
  it("is a normalised weighting, so hitChance cannot exceed 1", () => {
    const total = AIM_QUADRATURE.reduce((sum, node) => sum + node.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("is symmetric about zero, so a perfectly aimed shot is not biased to one side", () => {
    const shifted = AIM_QUADRATURE.reduce((sum, node) => sum + node.z * node.weight, 0);
    expect(shifted).toBeCloseTo(0, 9);
  });
});

describe("solve — projectile", () => {
  it("is near certain against a stationary target dead ahead with perfect hands", () => {
    const target = targetAt(400, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeGreaterThan(0.95);
  });

  it("is near zero when the shooter is pointed 90 degrees away", () => {
    const target = targetAt(400, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, Math.PI / 2),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeLessThan(0.05);
  });

  it("falls off with distance for the same shaky hands, because the target subtends less", () => {
    const near = targetAt(200, 0);
    const far = targetAt(800, 0);
    const at = (target: BotCarView) => solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0.05, tick: 0, arena,
    }).hitChance;
    expect(at(near)).toBeGreaterThan(at(far));
  });

  it("reports 0 beyond the weapon's reach rather than a small number", () => {
    const target = targetAt(3000, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBe(0);
    expect(solution.value).toBe(0);
  });

  it("values a shot per second of gun time, not per press (P14)", () => {
    const target = targetAt(300, 0);
    const common = {
      shooter: shooterAt(0, 0, 0), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    };
    // predator: 30 damage on a 1000 ms cooldown. pepperbox: 45 per pellet on 1800 ms.
    const predator = solve({ ...common, slot: slotFor("predator") });
    expect(predator.value).toBeCloseTo(predator.expectedDamage / 1, 5);
  });
});

describe("solve — pellet fan", () => {
  it("counts more than one pellet's damage on a close target (P10)", () => {
    const target = targetAt(120, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("pepperbox"), slotIndex: 1,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    // 45 per pellet. A centred close fan puts at least two on the hull.
    expect(solution.expectedDamage).toBeGreaterThan(45);
  });
});

describe("solve — ticking beam", () => {
  it("counts repeated pulses, not one (P10)", () => {
    // Off the origin corner deliberately (unlike every other case in this file): a beam's `extent`
    // is capped by `wallClipDistance`, and `pointOutsideBounds` treats `y <= 0` as already outside
    // the arena (`sim/collide.ts`). At y=0 the cap latches at 0 forever and the beam never reaches
    // the target, which is an artifact of the shooter sitting exactly on the boundary edge — a pose
    // no car ever actually occupies — not a real gap in pulse counting. Projectile-only cases in
    // this file never touch `wallClipDistance`, so they are unaffected and keep y=0.
    const shooter = shooterAt(0, 300, 0);
    const target = targetAt(150, 300);
    const solution = solve({
      shooter,
      slot: slotFor("afterburner"), slotIndex: 2,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    // 49 per pulse; a target parked in the cone takes several.
    expect(solution.expectedDamage).toBeGreaterThan(49);
  });
});

describe("solve — maneuver", () => {
  it("gives wildcharge a real solution at contact range, so the bot can press it (P11)", () => {
    const target = targetAt(120, 300);
    const solution = solve({
      shooter: { ...shooterAt(0, 300, 0), carId: "bastion" },
      slot: slotFor("wildcharge"), slotIndex: 2,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeGreaterThan(0.5);
    expect(solution.expectedDamage).toBeGreaterThan(0);
  });

  it("gives it nothing across the arena", () => {
    const target = targetAt(900, 300);
    const solution = solve({
      shooter: { ...shooterAt(0, 300, 0), carId: "bastion" },
      slot: slotFor("wildcharge"), slotIndex: 2,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBe(0);
  });
});

describe("solve — explosion", () => {
  // CONTROLLER RULING R3: this replaces the brief's original "near miss" test. That test placed
  // the target laterally offset (300, 40) and asserted the splash still landed, on the premise that
  // a shell "detonates beside the target at closest approach" on a near miss. That premise is
  // physically wrong: a projectile's `instanceExpired` is `distance >= def.range`, and magmablast's
  // range is 900 — a shell that misses the target does NOT detonate beside it, it keeps flying to
  // 900 units and detonates there, far away from a target at 300-340 units out. The real, observable
  // consequence of magmablast's explosion (see `splashAt`'s doc comment in solution.ts) is instead
  // that a DIRECT hit deals more than the row's base damage, because the target is standing inside
  // its own 60-unit blast when the shell connects. Do not reinstate the near-miss version.
  it("credits magmablast's own blast on a direct hit (P12)", () => {
    const target = targetAt(300, 300);
    const solution = solve({
      shooter: { ...shooterAt(0, 300, 0), carId: "mirage" },
      slot: slotFor("magmablast"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    // 50 base (packages/shared/src/config/weapon-config.ts): a direct hit also detonates the
    // shell's own 15-damage blast on the same target, standing inside its own 60u radius.
    expect(solution.expectedDamage).toBeGreaterThan(weaponDefOf("magmablast").damage);
  });
});

describe("solve — aim assist", () => {
  it("is near certain with a live lock even when the nose is off, inside aimRangeUnits (P13)", () => {
    const target = targetAt(300, 300);
    const locked = solve({
      shooter: { ...shooterAt(0, 300, 0.25), lockTargetSessionId: "them" },
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    const unlocked = solve({
      shooter: shooterAt(0, 300, 0.25),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(locked.hitChance).toBeGreaterThan(unlocked.hitChance);
    expect(locked.hitChance).toBeGreaterThan(0.9);
  });

  // The brief's original version placed the target at 600 to be "beyond aimRangeUnits (400) but
  // within reach" -- but `weaponReachOf` returns `aimRangeUnits` itself for any assisted weapon
  // (reach.ts), and `weapon-config.test.ts` requires `range >= aimRangeUnits` for every such row, so
  // "inside weaponReachOf but outside aimRangeUnits" is unreachable for a real weapon on the roster:
  // `solve`'s outer reach gate (`distance > reach`) fires first and returns NO_SOLUTION before the
  // assist branch is ever reached, which is exactly why the original test was vacuous. The other
  // reachable way to decline the assist is the lock check itself: hold distance well inside both
  // `weaponReachOf` and `aimRangeUnits`, but name a session the lock is not actually on.
  it("declines the assist when the held lock names a different target, even inside aimRangeUnits", () => {
    // magmablast: aimRangeUnits 400, range 900. 300 sits inside both, so distance alone would pass
    // the assist gate -- only the lock mismatch (`shooter.lockTargetSessionId !== target.sessionId`)
    // should make it decline, exactly mirroring `aimAngleFor`'s own lock check in sim/combat.ts.
    const target = targetAt(300, 300);
    const common = {
      slot: slotFor("magmablast"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    };
    const staleLock = solve({
      shooter: { ...shooterAt(0, 300, 0.4), carId: "mirage", lockTargetSessionId: "someone-else" },
      ...common,
    });
    const liveLock = solve({
      shooter: { ...shooterAt(0, 300, 0.4), carId: "mirage", lockTargetSessionId: "them" },
      ...common,
    });
    // Same distance, same off-nose angle, same everything except which session the lock names: a
    // stale lock fires along the nose (0.4 rad off the bearing) and misses, a live lock is steered
    // onto the target and lands -- proof the decline is the lock check, not the distance.
    expect(staleLock.hitChance).toBeLessThan(0.5);
    expect(liveLock.hitChance).toBeGreaterThan(0.9);
  });
});

describe("solver ground truth (P48)", () => {
  it("agrees with resolveInstanceHits about whether a predator shot lands", () => {
    // Walk the target across a range of lateral offsets. For each, ask the solver with perfect
    // hands, then fire the real shot through the sim and see whether it connects. The two must
    // agree on every offset -- this is what makes the solver honest about the game rather than
    // merely self-consistent.
    for (let offset = 0; offset <= 60; offset += 10) {
      const target = targetAt(400, offset);
      const claimed = solve({
        shooter: shooterAt(0, 0, 0),
        slot: slotFor("predator"), slotIndex: 0,
        target, targetAt: constantVelocityPredictor(target),
        aimSigmaRad: 0, tick: 0, arena,
      }).hitChance > 0.5;

      const actual = firesAndConnects("predator", shooterAt(0, 0, 0), target);
      expect(actual, `lateral offset ${offset}`).toBe(claimed);
    }
  });
});

/** Fire one real press through the sim and report whether it touches the target's hull. */
function firesAndConnects(
  weaponId: Parameters<typeof weaponDefOf>[0],
  shooter: SolverShooter,
  target: BotCarView,
): boolean {
  const { instances } = spawnInstances(
    { weaponId, slot: 0, finalVolley: true, pressId: "truth" },
    {
      sessionId: shooter.sessionId, team: shooter.team, carId: shooter.carId,
      x: shooter.x, y: shooter.y, angle: shooter.angle,
    },
    0, 0,
  );
  const hull = carHullOf(target.x, target.y, target.angle);
  const def = weaponDefOf(weaponId);
  if (def.kind !== "projectile") throw new Error("helper handles projectiles only");

  for (const start of instances) {
    let instance = start;
    let previous = projectileShapeAt(def.hitbox, instance.x, instance.y, instance.angle);
    for (let tick = 1; tick <= 120; tick++) {
      instance = stepInstance(instance, {
        dt: 1 / TICK_RATE_HZ, tick,
        obstacles: arena.obstacles,
        bounds: { width: arena.width, height: arena.height },
        ownerPose: { x: shooter.x, y: shooter.y, angle: shooter.angle },
        homingTarget: { x: target.x, y: target.y },
      });
      const current = projectileShapeAt(def.hitbox, instance.x, instance.y, instance.angle);
      if (shapeHitsObb(smear(previous, current), hull)) return true;
      previous = current;
      if (instanceExpired(instance, tick)) break;
    }
  }
  return false;
}

describe("solver determinism (P43)", () => {
  it("draws no random numbers at all", () => {
    const target = targetAt(400, 0);
    const throwing = () => {
      throw new Error("the solver must not draw rng (P43)");
    };
    // The solver takes no rng parameter by design; this guards against one being threaded in
    // later, and against a helper reaching for Math.random.
    const original = Math.random;
    Math.random = throwing as unknown as typeof Math.random;
    try {
      expect(() => solve({
        shooter: shooterAt(0, 0, 0),
        slot: slotFor("predator"), slotIndex: 0,
        target, targetAt: constantVelocityPredictor(target),
        aimSigmaRad: 0.05, tick: 0, arena,
      })).not.toThrow();
    } finally {
      Math.random = original;
    }
  });

  it("returns identical results for identical inputs", () => {
    const target = targetAt(400, 25);
    const once = () => solve({
      shooter: shooterAt(0, 0, 0.1),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0.05, tick: 0, arena,
    });
    expect(once()).toEqual(once());
  });
});
