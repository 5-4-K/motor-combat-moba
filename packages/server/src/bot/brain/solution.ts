import {
  TICK_RATE_HZ, beamShapeAt, carHullOf, instanceExpired, projectileShapeAt, shapeHitsObb, smear,
  spawnInstances, stepInstance, weaponDefOf, weaponTicksOf,
  type CarId, type WeaponInstance, type WorldShape,
} from "@motor-combat-moba/shared";
import type { BotArenaView, BotCarView, BotSlotView } from "../types.js";
import { weaponReachOf } from "./reach.js";

/**
 * Where the aim error is sampled, and how much each sample counts (P43).
 *
 * Seven-point Gauss–Hermite, transformed for the probabilists' normal: nodes are `sqrt(2) * x_i` and
 * weights are `w_i / sqrt(pi)`. FIXED points, never random draws — the solver must consume no `rng()`
 * (H21), and a smooth `hitChance` is also what stops the phase-D planner chattering on a noisy score.
 */
export const AIM_QUADRATURE: readonly { z: number; weight: number }[] = Object.freeze([
  { z: -3.750439717725742, weight: 0.00054826 },
  { z: -2.366759410734541, weight: 0.03075712 },
  { z: -1.154405394739968, weight: 0.24012318 },
  { z: 0, weight: 0.45714286 },
  { z: 1.154405394739968, weight: 0.24012318 },
  { z: 2.366759410734541, weight: 0.03075712 },
  { z: 3.750439717725742, weight: 0.00054826 },
]);

/** Where a car will be `ticksAhead` from now. Plan 3 swaps the implementation behind this type. */
export type PosePredictor = (ticksAhead: number) => { x: number; y: number; angle: number };

/** Straight-line extrapolation — what a bot assumes before it can roll real physics forward. */
export function constantVelocityPredictor(target: BotCarView): PosePredictor {
  const vx = Math.cos(target.angle) * target.speed;
  const vy = Math.sin(target.angle) * target.speed;
  return (ticksAhead) => {
    const seconds = ticksAhead / TICK_RATE_HZ;
    return { x: target.x + vx * seconds, y: target.y + vy * seconds, angle: target.angle };
  };
}

export interface SolverShooter {
  sessionId: string;
  carId: CarId;
  team: 0 | 1;
  x: number; y: number; angle: number; speed: number;
  lockTargetSessionId: string;
}

export interface FiringSolution {
  /** 0..1, weighted over `AIM_QUADRATURE`. */
  hitChance: number;
  /** Damage this press is worth in expectation, counting every pellet and pulse that connects. */
  expectedDamage: number;
  /** `expectedDamage / cooldownSeconds` — EV per second of gun time (P14). */
  value: number;
  /** The heading to point at for the best chance — the BEARING to the target, not `nominal` below. */
  aimHeadingRad: number;
  /** 0 when the slot may be pressed now. */
  readyInTicks: number;
}

export interface SolveArgs {
  shooter: SolverShooter;
  slot: BotSlotView;
  slotIndex: number;
  target: BotCarView;
  targetAt: PosePredictor;
  /** The shooter's own aim-error sigma. 0 means perfect hands. */
  aimSigmaRad: number;
  tick: number;
  arena: BotArenaView;
}

const NO_SOLUTION: FiringSolution = Object.freeze({
  hitChance: 0, expectedDamage: 0, value: 0, aimHeadingRad: 0, readyInTicks: 0,
});

/** How many ticks until this slot may be pressed. */
export function readyInTicksOf(slot: BotSlotView, tick: number): number {
  if (slot.stocks >= 1 && tick >= slot.refireLockUntilTick) return 0;
  const when = Math.max(slot.refireLockUntilTick, slot.stocks >= 1 ? 0 : slot.rechargeEndsTick);
  return Math.max(0, when - tick);
}

/**
 * Would this slot's press land on this target, and what is it worth (P7)?
 *
 * Marches REAL instances — `spawnInstances` then `stepInstance` — rather than approximating a
 * trajectory, so pellets, bounces and expiry behave exactly as they will in the match. That is what
 * makes the ground-truth test in `solution.test.ts` meaningful rather than tautological: the solver
 * and the sim can still disagree about hulls, expiry or the muzzle, and the test catches it.
 *
 * CONTROLLER RULING R2: the shot leaves along the car's nose (`aimAngleFor` in `sim/combat.ts`
 * fires along `player.angle`, never along the bearing to a target), so `nominal` — the heading the
 * quadrature is centred on — must be `shooter.angle`, not the bearing. Evaluating the bearing would
 * answer "would this land if I were aimed correctly", which no fire gate can use, and it would make
 * the shooter's own facing irrelevant to the result.
 *
 * `aimHeadingRad` on the returned solution is still the BEARING — "where to point for the best
 * chance" — because that is what a later phase's planner wants to steer toward. The two headings
 * therefore diverge on purpose: `nominal` drives the physics, `aimHeadingRad` reports the target.
 *
 * SEAM FOR TASK 6 (not implemented here): when a live aim-assist lock is in range, `nominal` should
 * be overridden back to the bearing and `sigma` forced to 0 — the assist corrects the shot onto the
 * lock, so the quadrature's spread collapses to a single certain point. That override belongs right
 * here, before the quadrature loop, keyed off `shooter.lockTargetSessionId` and the weapon's own
 * `usesAimAssist`/`aimRangeUnits`. Nothing below this comment should need to change to add it.
 */
export function solve(args: SolveArgs): FiringSolution {
  const { shooter, slot, target, aimSigmaRad, tick } = args;
  const def = weaponDefOf(slot.weaponId);
  const reach = weaponReachOf(slot.weaponId);
  const distance = Math.hypot(target.x - shooter.x, target.y - shooter.y);
  if (distance > reach) return NO_SOLUTION;

  // The shot leaves along the car's nose (`aimAngleFor`), so that is what the solver must
  // evaluate — not the bearing, which would answer "if I were aimed right" and gate nothing.
  const nominal = shooter.angle;
  const sigma = aimSigmaRad;
  const bearing = Math.atan2(target.y - shooter.y, target.x - shooter.x);
  const cooldownSeconds = Math.max(def.cooldownMs, 1) / 1000;

  let hitChance = 0;
  let expectedDamage = 0;
  for (const node of AIM_QUADRATURE) {
    const heading = nominal + node.z * sigma;
    const landed = marchPress(args, heading);
    if (landed.hits > 0) hitChance += node.weight;
    expectedDamage += node.weight * landed.damage;
  }

  return {
    hitChance,
    expectedDamage,
    value: expectedDamage / cooldownSeconds,
    aimHeadingRad: bearing,
    readyInTicks: readyInTicksOf(slot, tick),
  };
}

/** One press fired along `heading`: how many instances connect, and for how much. */
function marchPress(
  args: SolveArgs,
  heading: number,
): { hits: number; damage: number } {
  // `target`, `targetAt` and `arena` are not destructured here on purpose (R5): this function only
  // spawns, and hands the whole `args` to `marchOne`, which is what actually walks the shot.
  const { shooter, slot, slotIndex, tick } = args;
  const def = weaponDefOf(slot.weaponId);
  if (def.kind === "maneuver") return { hits: 0, damage: 0 }; // Task 5 fills this in.

  const spawned = spawnInstances(
    { weaponId: slot.weaponId, slot: slotIndex, finalVolley: true, pressId: "solve" },
    {
      sessionId: shooter.sessionId, team: shooter.team, carId: shooter.carId,
      x: shooter.x, y: shooter.y, angle: heading,
    },
    tick,
    0,
  );

  let hits = 0;
  let damage = 0;
  for (const spawnedInstance of spawned.instances) {
    const landed = marchOne(spawnedInstance, args, heading);
    if (landed > 0) {
      hits += 1;
      damage += landed;
    }
  }
  return { hits, damage };
}

/**
 * March one instance to expiry, returning the damage it deals to the target.
 *
 * A projectile stops at its first contact. A ticking beam damages on the first tick it covers the
 * target, then once per `weaponTicksOf(id).damageInterval` — the same cadence `resolveInstanceHits`
 * applies in the real sim, so lance and afterburner are not under-counted to a single pulse.
 */
function marchOne(start: WeaponInstance, args: SolveArgs, heading: number): number {
  const { shooter, target, targetAt, tick, arena } = args;
  const def = weaponDefOf(start.weaponId);
  const interval = def.kind === "beam" ? weaponTicksOf(start.weaponId).damageInterval : Infinity;
  const dt = 1 / TICK_RATE_HZ;
  let instance = start;
  let previous = shapeOf(instance);
  let damage = 0;
  let lastHitTick = -Infinity;

  for (let ahead = 1; ahead <= MAX_MARCH_TICKS; ahead++) {
    const now = tick + ahead;
    instance = stepInstance(instance, {
      dt, tick: now,
      obstacles: arena.obstacles,
      bounds: { width: arena.width, height: arena.height },
      ownerPose: { x: shooter.x, y: shooter.y, angle: heading },
      homingTarget: { x: target.x, y: target.y },
    });
    const current = shapeOf(instance);
    const pose = targetAt(ahead);
    const connects = shapeHitsObb(smear(previous, current), carHullOf(pose.x, pose.y, pose.angle));
    if (connects) {
      if (!Number.isFinite(interval)) return damage + instance.damage;
      if (now - lastHitTick >= interval) {
        damage += instance.damage;
        lastHitTick = now;
      }
    }
    previous = current;
    if (instanceExpired(instance, now)) break;
  }
  return damage;
}

/** No shot on this roster stays alive longer than this; the loop must terminate regardless. */
const MAX_MARCH_TICKS = 120;

function shapeOf(instance: WeaponInstance): WorldShape {
  const def = weaponDefOf(instance.weaponId);
  if (def.kind === "projectile") {
    return projectileShapeAt(def.hitbox, instance.x, instance.y, instance.angle);
  }
  if (def.kind === "beam") {
    return beamShapeAt(def.hitbox, instance.x, instance.y, instance.angle, instance.extent);
  }
  throw new Error(`shapeOf: ${instance.weaponId} spawns no instance`);
}
