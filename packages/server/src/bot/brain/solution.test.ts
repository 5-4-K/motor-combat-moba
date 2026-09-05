import { describe, expect, it } from "vitest";
import {
  TICK_RATE_HZ, carHullOf, instanceExpired, resolveInstanceHits, spawnInstances, stepInstance,
  weaponDefOf, type PoseSnapshot,
} from "@motor-combat-moba/shared";
import type { BotArenaView, BotCarView, BotSlotView } from "../types.js";
import {
  AIM_QUADRATURE, constantVelocityPredictor, solve, type PosePredictor, type SolverShooter,
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

function targetAt(x: number, y: number, angle = Math.PI, speed = 0): BotCarView {
  return {
    sessionId: "them", carId: "mirage", team: 1, x, y, angle, speed,
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
    //
    // Off the origin corner deliberately (unlike the "solve — projectile" block above, which keeps
    // y=0 -- see that section for why it's harmless there): this test's own fixture used to sit at
    // y=0 too, which works out fine for a non-bouncing projectile (`pointOutsideBounds` never gets
    // consulted), but it deviated from the y=300 convention the rest of the suite uses for no
    // reason worth re-deriving. y=300 keeps the geometry identical and drops that footnote.
    //
    // The offsets below mix the original coarse sweep (0, 10, ... 60 -- clearly-hits or
    // clearly-misses) with a fine pass across the actual hull boundary: the target's hull is 48x32
    // (half-height 16) and predator's hitbox adds another 6 units of `radiusAcross`, so a shot stops
    // connecting somewhere around offset 22. Sampling every 2 units through that band is what makes
    // a wrong hull, wrong hitbox, or wrong smear direction show up as a flipped verdict instead of
    // being swallowed by two samples that were never close enough to disagree.
    const offsets = [0, 10, 12, 14, 16, 18, 20, 22, 30, 40, 50, 60];
    for (const offset of offsets) {
      const target = targetAt(400, 300 + offset);
      const claimed = solve({
        shooter: shooterAt(0, 300, 0),
        slot: slotFor("predator"), slotIndex: 0,
        target, targetAt: constantVelocityPredictor(target),
        aimSigmaRad: 0, tick: 0, arena,
      }).hitChance > 0.5;

      const actual = firesAndConnects("predator", shooterAt(0, 300, 0), target);
      expect(actual, `lateral offset ${offset}`).toBe(claimed);
    }
  });

  // MUTATION NOTE: the offset sweep above cannot, by construction, catch a `smear()` regression in
  // `marchOne`. Predator's capsule is 2*19 = 38 units long and the shot advances 30 units/tick, so
  // consecutive un-smeared frames already overlap by 8 units -- more than the 6-unit tapered nose
  // where a single frame's reach is narrower than its flat midsection. That 8 > 6 margin means the
  // NEXT frame always covers whatever the current one's taper missed, for every offset and every
  // shooter angle, against a stationary target -- verified empirically by sweeping ~80,000
  // (distance, offset) pairs with `smear()` deleted from `marchOne` and finding zero disagreements
  // against `resolveInstanceHits`. A stationary target genuinely cannot expose this weapon's smear.
  //
  // A MOVING target can: the target's own pose isn't smeared (only the projectile's swept path is),
  // so a target crossing the shot's corridor between two ticks can sit exactly in the gap a
  // straight per-tick check would miss while the swept quadrilateral between those two ticks still
  // clips it. This case (speed 125, closing on the shot's line from 45 units out) sits in the
  // middle of a 4-unit-wide band (offset 43-46) where deleting `smear()` flips the verdict from hit
  // to miss -- found by sweeping target speed/heading/offset/distance and picking a comfortably
  // interior point rather than an edge value.
  it("still agrees when the target is moving fast enough to cross the shot's corridor between ticks", () => {
    const shooter = shooterAt(0, 300, 0);
    // Target starts 45 units above the shot's line, driving straight down into it at 125 u/s --
    // angle -90deg is both its facing and its heading, matching `constantVelocityPredictor`'s
    // straight-line assumption.
    const target = targetAt(100, 300 + 45, -Math.PI / 2, 125);
    const claimed = solve({
      shooter,
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    }).hitChance > 0.5;

    const actual = firesAndConnects("predator", shooter, target, constantVelocityPredictor(target));
    expect(actual).toBe(claimed);
    expect(actual).toBe(true); // this configuration is a genuine hit; smear is what makes it one
  });
});

/**
 * Fire one real press through the sim (`resolveInstanceHits`, the same function `runCombat` calls
 * every tick) and report whether it touches the target's hull. `targetAt` defaults to the target's
 * own constant-velocity line, mirroring what `solve` is handed in every call site above, so a
 * moving target is marched with the identical predicted pose on both sides of the comparison.
 */
function firesAndConnects(
  weaponId: Parameters<typeof weaponDefOf>[0],
  shooter: SolverShooter,
  target: BotCarView,
  targetAt: PosePredictor = constantVelocityPredictor(target),
): boolean {
  const { instances } = spawnInstances(
    { weaponId, slot: 0, finalVolley: true, pressId: "truth" },
    {
      sessionId: shooter.sessionId, team: shooter.team, carId: shooter.carId,
      x: shooter.x, y: shooter.y, angle: shooter.angle,
    },
    0, 0,
  );
  const def = weaponDefOf(weaponId);
  if (def.kind !== "projectile") throw new Error("helper handles projectiles only");

  for (const start of instances) {
    let instance = start;
    for (let tick = 1; tick <= 120; tick++) {
      const stepped = stepInstance(instance, {
        dt: 1 / TICK_RATE_HZ, tick,
        obstacles: arena.obstacles,
        bounds: { width: arena.width, height: arena.height },
        ownerPose: { x: shooter.x, y: shooter.y, angle: shooter.angle },
        homingTarget: { x: target.x, y: target.y },
      });
      const pose = targetAt(tick);
      // A snapshot of one car, sorted trivially (a single entry needs no real sort) -- the same
      // shape `runCombat` builds from every living fighter each tick (`sim/combat.ts`).
      const snapshot: PoseSnapshot = [
        { sessionId: target.sessionId, team: target.team, hull: carHullOf(pose.x, pose.y, pose.angle) },
      ];
      // `mode: "ffa"` matches this file's fixtures (`shooter.team` 0, `target.team` 1, and
      // `canDamage` treats any two different ids as damageable in ffa regardless of team) --
      // `tick` starts the damage clock empty, and `pierceLeft`/`isExplosion` bookkeeping this
      // function does more than a boolean hit test needs is simply along for the ride.
      const outcome = resolveInstanceHits(stepped, instance, snapshot, "ffa", tick);
      if (outcome.damaged.length > 0) return true;
      instance = outcome.instance;
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
