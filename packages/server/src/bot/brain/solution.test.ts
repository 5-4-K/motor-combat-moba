import { describe, expect, it } from "vitest";
import { weaponDefOf } from "@motor-combat-moba/shared";
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

  it("declines the assist beyond the weapon's aimRangeUnits, per the sim's own gate", () => {
    // magmablast: aimRangeUnits 400. At 600 the lock exists but the weapon fires straight.
    const target = targetAt(600, 300);
    const solution = solve({
      shooter: { ...shooterAt(0, 300, 0.4), carId: "mirage", lockTargetSessionId: "them" },
      slot: slotFor("magmablast"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeLessThan(0.5);
  });
});
