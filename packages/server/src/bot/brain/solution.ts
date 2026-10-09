import {
  TICK_RATE_HZ, beamOriginOf, beamReachOf, beamShapeAt, carHullOf, derived, forwardMaxSpeedOf,
  instanceExpired, projectileShapeAt, shapeHitsObb, smear, spawnInstances, stepInstance,
  clampBearingToSwing, clampToSwing, turret, turretPivotOf, turretTurnDelta, weaponDamageOf, weaponDefOf,
  weaponTicksOf, wrapAngle, type CarId, type WeaponId,
  type WeaponInstance, type WorldShape,
} from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import type { BotArenaView, BotCarView, BotSlotView } from "../types.js";
import { weaponReachOf } from "./reach.js";

/**
 * Where the aim error is sampled, and how much each sample counts (P43).
 *
 * Seven-point Gauss–Hermite, transformed for the probabilists' normal: nodes are `sqrt(2) * x_i` and
 * weights are `w_i / sqrt(pi)`. FIXED points, never random draws — the solver must consume no `rng()`
 * (H21), and a smooth `hitChance` is also what stops the phase-D planner chattering on a noisy score.
 *
 * The two outermost nodes (z = ±3.75, 0.05% of the weight each) are dropped and the inner five
 * renormalised (2026-10-09, solver cost): every node is a full march of the shot, so they cost 2/7
 * of the solver for 0.1% of `hitChance`.
 */
const SEVEN_POINT_HERMITE = [
  { z: -3.750439717725742, weight: 0.00054826 },
  { z: -2.366759410734541, weight: 0.03075712 },
  { z: -1.154405394739968, weight: 0.24012318 },
  { z: 0, weight: 0.45714286 },
  { z: 1.154405394739968, weight: 0.24012318 },
  { z: 2.366759410734541, weight: 0.03075712 },
  { z: 3.750439717725742, weight: 0.00054826 },
];
const INNER_FIVE = SEVEN_POINT_HERMITE.slice(1, -1);
const INNER_WEIGHT = INNER_FIVE.reduce((sum, node) => sum + node.weight, 0);
export const AIM_QUADRATURE: readonly { z: number; weight: number }[] = Object.freeze(
  INNER_FIVE.map((node) => Object.freeze({ z: node.z, weight: node.weight / INNER_WEIGHT })),
);

/** Where a car will be `ticksAhead` from now. Plan 3 swaps the implementation behind this type. */
export type PosePredictor = (ticksAhead: number) => { x: number; y: number; angle: number };

/**
 * Straight-line extrapolation. No longer what the controller solves against — phase A's task 4
 * (2026-09-06) put `predict.ts`'s `physicsPredictor` behind this same `PosePredictor` seam there —
 * but still the right answer for a target that provably is not moving: `effectiveReachOf`
 * (`ranges.ts`) solves against a stationary synthetic target, where a physics rollout would buy nothing and
 * cost four rng draws (two gaussians, and `gaussian` is Box-Muller — a pair each). Also the fixture
 * `solution.test.ts` pins the solver with.
 */
export function constantVelocityPredictor(target: BotCarView): PosePredictor {
  // The car's REAL world velocity, not `cos(angle) * speed`. That reconstruction was one of the
  // five open-coded copies `sim/velocity.ts` was written to replace, and the one its doc singles out
  // as silently wrong: it extrapolated every car along its own nose, so a target that was sliding —
  // out of a corner, or shoved by a ram — was predicted travelling somewhere it was not going.
  const { vx, vy } = target;
  return (ticksAhead) => {
    const seconds = ticksAhead / TICK_RATE_HZ;
    return { x: target.x + vx * seconds, y: target.y + vy * seconds, angle: target.angle };
  };
}

export interface SolverShooter {
  sessionId: string;
  carId: CarId;
  team: 0 | 1;
  x: number; y: number; angle: number; vx: number; vy: number;
  /**
   * The turret's angle RELATIVE to the hull (`FireState.turretAngle`), which a turret press must turn
   * away from before it releases (TR26). Absent reads as 0 — the turret along the nose — which is
   * also all a bot can assume of an opponent's, since `BotCarView` does not carry it.
   */
  turretAngle?: number;
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
  /**
   * The world bearing to aim a turret weapon along: the LEAD bearing from the turret pivot to where
   * the target will be when the shot arrives, turret turn included (TR26). Absent for a fixed
   * muzzle, and for a turret weapon with no solution (out of reach).
   */
  turretBearingRad?: number;
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
  /**
   * The turret's swing arc (TR55). A test seam: absent reads `turret().maxSwingDeg` at call
   * time, exactly as the sim does, so production callers leave it out.
   */
  maxSwingDeg?: number;
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
 * `nominal` is UNCONDITIONALLY the shooter's own heading. It used to be overridden onto the bearing
 * with `sigma` forced to 0 whenever an ambient lock would have pointed the shot; with targeting
 * removed there is no such override, and every weapon is priced through the same quadrature over
 * the shooter's real aim noise.
 *
 * A TURRET weapon (`WeaponDef.turret`, TR26) is the exception R2 was never about: its shot leaves
 * the turret pivot along the press's own bearing, so `nominal` is the solved LEAD bearing
 * (`turretLeadOf`), the target is read `turretTurnTicksOf` later, and the hull need not face the
 * target at all. The lead is returned as `turretBearingRad` for the controller to put on the wire.
 */
export function solve(args: SolveArgs): FiringSolution {
  const { shooter, slot, target, aimSigmaRad, tick } = args;
  const def = weaponDefOf(slot.weaponId);
  const reach = weaponReachOf(slot.weaponId);
  const distance = Math.hypot(target.x - shooter.x, target.y - shooter.y);
  if (distance > reach) return NO_SOLUTION;

  const bearing = Math.atan2(target.y - shooter.y, target.x - shooter.x);
  const sigma = aimSigmaRad;
  const cooldownSeconds = Math.max(def.cooldownMs, 1) / 1000;

  // TR26: a turret weapon is aimed by BEARING, not by the hull. R2 above is a fact about a fixed
  // muzzle; a turret shot leaves the pivot along whatever bearing its press carries, so the
  // quadrature is centred on the solved lead instead of the nose, and the target is read as many
  // ticks later as the turret needs to get there first.
  const lead = def.turret ? turretLeadOf(shooter, slot.weaponId, args.targetAt, args.maxSwingDeg) : undefined;
  const marchArgs: SolveArgs = lead
    ? { ...args, targetAt: (ticksAhead) => args.targetAt(ticksAhead + lead.turnTicks) }
    : args;
  // The shot leaves along the car's nose (fixed muzzle) or the solved lead (turret). Evaluating the
  // bearing to the target's CURRENT position instead would answer "if I were aimed right" and gate
  // nothing.
  const nominal = lead ? lead.bearing : shooter.angle;

  let hitChance = 0;
  let expectedDamage = 0;
  for (const node of AIM_QUADRATURE) {
    const aim = nominal + node.z * sigma;
    // A turret press moves the barrel, never the hull: the owner keeps its own heading and the
    // bearing rides on the order, exactly as `releaseShots` hands it to `spawnInstances`.
    const landed = lead ? marchPress(marchArgs, shooter.angle, aim) : marchPress(marchArgs, aim);
    if (landed.hits > 0) hitChance += node.weight;
    expectedDamage += node.weight * landed.damage;
  }

  return {
    hitChance,
    expectedDamage,
    value: expectedDamage / cooldownSeconds,
    aimHeadingRad: bearing,
    ...(lead ? { turretBearingRad: lead.bearing } : {}),
    readyInTicks: readyInTicksOf(slot, tick),
  };
}

/**
 * Ticks the turret needs to swing from where it points now onto `bearing` (TR26): the arc
 * `turnTurret` will actually take — the shortest one unrestricted, the one that stays inside the
 * swing arc below 360 (TR55, `turretTurnDelta`) — over `derived().turretTicks.turnPerTick`. Fractional on
 * purpose — `turnTurret` snaps inside one step, so the gap between this fractional budget and the
 * real delay on the tick grid is under one tick (final-fixes item 9; the earlier claim that every
 * `PosePredictor` rounds its argument was false — `constantVelocityPredictor` does not).
 */
export function turretTurnTicksOf(
  shooter: SolverShooter,
  bearing: number,
  maxSwingDeg: number = turret().maxSwingDeg,
): number {
  const turnPerTick = derived().turretTicks.turnPerTick;
  // Unrestricted: the pre-TR55 expression exactly, so the shipped 360 moves no solver float.
  if (maxSwingDeg >= 360) {
    const pointing = shooter.angle + (shooter.turretAngle ?? 0);
    return Math.abs(wrapAngle(bearing - pointing)) / turnPerTick;
  }
  const target = clampToSwing(wrapAngle(bearing - shooter.angle), maxSwingDeg);
  return Math.abs(turretTurnDelta(shooter.turretAngle ?? 0, target, maxSwingDeg)) / turnPerTick;
}

/**
 * The lead bearing for a turret shot, and the turn it costs (TR26).
 *
 * Fixed-point, `BRAIN_CONSTANTS.interceptFixedPointRounds` rounds — the same bounded shape
 * `interceptTicks` (`predict.ts`) uses, and for the same reason (H21: bounded work, no `rng()`). It
 * cannot simply call that function: a turret shot's time to arrive has two halves, the turret's TURN
 * (which depends on the very bearing being solved) and the FLIGHT, which starts at the barrel tip
 * rather than the car centre. Each round aims from the pivot at where the target will be after both.
 *
 * The lead does not model the SHOOTER's own motion during the turn (final-fixes item 9): `pivot` is
 * fixed at the shooter's pose when `solve` was called, even though the turn itself takes real ticks
 * during which a moving shooter's pivot would have moved too.
 *
 * The bearing is clamped into the swing arc every round (TR55), exactly as `beginFire` will clamp
 * it, so a target outside the arc yields the nearer arc edge — whose shot usually misses, and the
 * march in `solve` is what says so. No new behaviour rides on it.
 */
function turretLeadOf(
  shooter: SolverShooter,
  weaponId: WeaponId,
  targetAt: PosePredictor,
  maxSwingDeg?: number,
): { bearing: number; turnTicks: number } {
  const def = weaponDefOf(weaponId);
  const pivot = turretPivotOf(shooter, shooter.carId);
  const barrel = turret().defaultOffset + (def.turret?.additionalOffset ?? 0);
  let aimPoint = targetAt(0);
  const bearingTo = (point: { x: number; y: number }): number =>
    clampBearingToSwing(Math.atan2(point.y - pivot.y, point.x - pivot.x), shooter.angle, maxSwingDeg);
  let bearing = bearingTo(aimPoint);
  for (let round = 0; round < BRAIN_CONSTANTS.interceptFixedPointRounds; round++) {
    const distance = Math.hypot(aimPoint.x - pivot.x, aimPoint.y - pivot.y);
    const flightTicks = def.speed > 0
      ? (Math.max(0, distance - barrel) / def.speed) * TICK_RATE_HZ
      : 0;
    aimPoint = targetAt(turretTurnTicksOf(shooter, bearing, maxSwingDeg) + flightTicks);
    bearing = bearingTo(aimPoint);
  }
  return { bearing, turnTicks: turretTurnTicksOf(shooter, bearing, maxSwingDeg) };
}

/**
 * One press fired along `heading`: how many instances connect, and for how much. `bearing` is a
 * turret press's aim (TR18) — the owner still faces `heading`, and the shot leaves along `bearing`.
 */
function marchPress(
  args: SolveArgs,
  heading: number,
  bearing?: number,
): { hits: number; damage: number } {
  // `target`, `targetAt` and `arena` are not destructured here on purpose (R5): this function only
  // spawns, and hands the whole `args` to `marchOne`, which is what actually walks the shot.
  const { shooter, slot, slotIndex, tick } = args;
  const def = weaponDefOf(slot.weaponId);
  if (def.kind === "maneuver") return marchManeuver(args, heading, def);

  const spawned = spawnInstances(
    {
      weaponId: slot.weaponId, slot: slotIndex, finalVolley: true, pressId: "solve",
      ...(bearing === undefined ? {} : { bearing }),
    },
    {
      sessionId: shooter.sessionId, team: shooter.team, carId: shooter.carId,
      x: shooter.x, y: shooter.y, angle: heading,
    },
    tick,
    0,
    1,
    "",
    def,
    undefined,
    args.maxSwingDeg,
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
 * A maneuver's "shot" is the car itself (P10, P11): a dash/charge spawns no instance, so there is
 * nothing for `marchOne` to step. Instead this sweeps the shooter's own hull along the maneuver's
 * travel line, tick by tick, and reports a hit when the swept sweep overlaps the target's predicted
 * hull — the same swept-hull idea `marchOne` uses for a projectile, just driven by the car instead
 * of a spawned instance.
 *
 * `wildcharge` authors `range: 0` and `speed: 0` (it is a charge, not a dash — the sim resolves it
 * as a hard slam on first contact, not a travelled distance), so its reach comes from
 * `weaponReachOf`, which falls through to `BRAIN_CONSTANTS.contactTriggerUnits` for a `range: 0`
 * weapon, and the sweep runs that distance at the chassis's own top speed (`forwardMaxSpeedOf`)
 * since the weapon itself declares no travel speed. `thunderclap` authors both `speed` and `range`
 * (the dash distance) directly, so it needs neither fallback.
 *
 * `solve()` and `minShotValue` are both new on THIS branch — there was no EV-gated firing model
 * before it for a maneuver-less `marchPress` to have ever shipped without this branch (a fix-round
 * commit on this same branch briefly had `marchPress` return `{ hits: 0, damage: 0 }` for every
 * maneuver weapon; that version never merged). This function is what makes the EV solver's maneuver
 * handling real from the start, not a fix to a shipped regression. The bot COULD already press
 * `wildcharge` before this branch, on the old range-heuristic firing logic
 * (`weaponReachOf`'s `contactTriggerUnits` fallback, gating on distance rather than a solved hit
 * chance) — see `balance/README.md`'s "Before you trust a number" section for that separate,
 * already-fixed history (1179 presses measured once it landed). What this branch changes is HOW a
 * maneuver gets pressed: a genuine swept-hull hit-probability solution instead of a bare
 * distance check.
 */
function marchManeuver(
  args: SolveArgs,
  heading: number,
  def: ReturnType<typeof weaponDefOf>,
): { hits: number; damage: number } {
  const { shooter, slot, target, targetAt } = args;
  const reach = weaponReachOf(slot.weaponId);
  const speed = def.speed > 0 ? def.speed : forwardMaxSpeedOf(shooter.carId);
  const ticks = Math.max(1, Math.ceil((reach / Math.max(speed, 1)) * TICK_RATE_HZ));

  let previous = carHullOf(shooter.x, shooter.y, heading);
  for (let ahead = 1; ahead <= ticks; ahead++) {
    const travelled = Math.min(reach, (speed * ahead) / TICK_RATE_HZ);
    const hull = carHullOf(
      shooter.x + Math.cos(heading) * travelled,
      shooter.y + Math.sin(heading) * travelled,
      heading,
    );
    const pose = targetAt(ahead);
    const swept = smear(obbShape(previous), obbShape(hull));
    if (shapeHitsObb(swept, carHullOf(pose.x, pose.y, pose.angle))) {
      return { hits: 1, damage: weaponDamageOf(shooter.carId, slot.weaponId) };
    }
    previous = hull;
  }
  return { hits: 0, damage: 0 };
}

/** An OBB as a polygon, so `smear` (which only hulls `WorldShape`s) can hull two car hulls together. */
function obbShape(hull: ReturnType<typeof carHullOf>): WorldShape {
  const cos = Math.cos(hull.angle);
  const sin = Math.sin(hull.angle);
  const hw = hull.w / 2;
  const hh = hull.h / 2;
  const corner = (dx: number, dy: number) => ({
    x: hull.x + dx * cos - dy * sin,
    y: hull.y + dx * sin + dy * cos,
  });
  return {
    kind: "polygon",
    points: [corner(hw, hh), corner(-hw, hh), corner(-hw, -hh), corner(hw, -hh)],
  };
}

/**
 * March one instance to expiry, returning the damage it deals to the target.
 *
 * A projectile stops at its first contact. A ticking beam damages on the first tick it covers the
 * target, then once per `weaponTicksOf(id).damageInterval` — the same cadence `resolveInstanceHits`
 * applies in the real sim, so lance and afterburner are not under-counted to a single pulse.
 *
 * SPLASH (Task 6, P12, CONTROLLER RULING R3): a projectile carrying `def.explosion` (only
 * `magmablast` today) detonates on death for any reason — the real sim spawns the burst as a
 * detached beam wherever the shell stops (`instanceDefOf`, `sim/weapons/instances.ts`). Two cases:
 *   (a) DIRECT HIT — the target is standing inside its own blast (`def.explosion.radius`, 60u for
 *       magmablast), so the explosion damage always lands alongside the shell's own.
 *   (b) NATURAL EXPIRY without a hit — the shell keeps flying to `def.range` (900u for magmablast;
 *       `instanceExpired`'s `distance >= def.range`) before it detonates, so a lateral near-miss at
 *       the target does NOT trigger the blast next to the target — it detonates 900 units away. The
 *       explosion is credited here only if the target's hull is actually within the blast radius of
 *       the point where the shell stopped, per `splashAt`.
 */
function marchOne(start: WeaponInstance, args: SolveArgs, heading: number): number {
  const { shooter, target, targetAt, tick, arena } = args;
  const def = weaponDefOf(start.weaponId);
  const interval = def.kind === "beam" ? weaponTicksOf(start.weaponId).damageInterval : Infinity;
  const dt = 1 / TICK_RATE_HZ;
  let instance = start;
  // `undefined` while a projectile is outside the broad phase below: its shape is only built when
  // the narrow test is going to read it.
  let previous: WorldShape | undefined = shapeOf(instance);
  let damage = 0;
  let lastHitTick = -Infinity;

  // NOT `boundsOf(arena)`: `arena` here is a `BotArenaView`, which carries no `boundary` field (it
  // is a constructed projection, never a handle on the arena def — see that type's doc). `boundsOf`
  // reads `.boundary`, so feeding it a view silently returns the bare rectangle no matter what
  // `.planes` the view actually carries, and the solver marches every shot through a rectangle
  // while the real sim simulates the octagon. Build the `Bounds` from the view's own pre-built
  // planes instead.
  const bounds = { width: arena.width, height: arena.height, planes: arena.planes };
  const ownerPose = { x: shooter.x, y: shooter.y, angle: heading };

  // A beam's fast path. The owner pose is frozen for the whole march, so `stepInstance`'s beam
  // branch re-anchors to the same origin and re-runs the same wall clip every tick — that raycast
  // alone was over a third of a balance run's CPU (2026-10-09 profile). Resolve both once and step
  // only the extent, which is all the beam branch changes. Once the beam stops growing its swept
  // shape is identical tick to tick, so it is reused rather than re-hulled. Same result, bit for bit.
  const beamOrigin = def.kind === "beam" ? beamOriginOf(start, def, ownerPose) : undefined;
  const beamReach = beamOrigin ? beamReachOf(def, beamOrigin, arena.obstacles, bounds) : 0;
  let steadySwept: WorldShape | undefined;

  // A projectile's broad phase. Its swept shape this tick lies inside the capsule of radius
  // `shotRadius` around the segment its centre moved along (both end shapes do, and the capsule is
  // convex), and the target's hull lies inside a circle of `hullRadius` around its pose. Capsule
  // and circle apart means the exact test would say no, so the hull and the SAT are skipped — for a
  // shot nowhere near the target, which is most ticks of most marches. Exact: it only ever skips a
  // test that would have returned false.
  const shotRadius = def.kind === "beam" ? 0 : radiusAbout(previous!, start.x, start.y);
  const hullProbe = carHullOf(0, 0, 0);
  const hullRadius = Math.hypot(hullProbe.w, hullProbe.h) / 2;
  const reachSq = (shotRadius + hullRadius + BROAD_PHASE_SLACK) ** 2;

  const marchTicks = marchTicksOf(start.weaponId);
  for (let ahead = 1; ahead <= marchTicks; ahead++) {
    const now = tick + ahead;
    const pose = targetAt(ahead);
    const hull = carHullOf(pose.x, pose.y, pose.angle);
    let connects: boolean;
    if (beamOrigin) {
      const extent = Math.min(beamReach, instance.extent + def.speed * dt);
      const unchanged = ahead > 1 && extent === instance.extent;
      instance = { ...instance, x: beamOrigin.x, y: beamOrigin.y, angle: beamOrigin.angle, extent };
      let swept: WorldShape;
      if (unchanged) {
        swept = steadySwept ??= smear(previous!, previous!);
      } else {
        const current = shapeOf(instance);
        swept = smear(previous!, current);
        previous = current;
      }
      connects = shapeHitsObb(swept, hull);
    } else {
      const before = instance;
      instance = stepInstance(instance, {
        dt, tick: now,
        obstacles: arena.obstacles,
        bounds,
        ownerPose,
        homingTarget: { x: target.x, y: target.y },
      });
      if (segmentPointDistSq(before.x, before.y, instance.x, instance.y, pose.x, pose.y) <= reachSq) {
        const current = shapeOf(instance);
        connects = shapeHitsObb(smear(previous ?? shapeOf(before), current), hull);
        previous = current;
      } else {
        connects = false;
        previous = undefined;
      }
    }
    if (connects) {
      if (!Number.isFinite(interval)) {
        // (a) Direct hit: the target is inside the blast by construction, no position check needed.
        const explosionOnHit = def.kind === "projectile" && def.explosion ? def.explosion.damage : 0;
        return damage + instance.damage + explosionOnHit;
      }
      if (now - lastHitTick >= interval) {
        damage += instance.damage;
        lastHitTick = now;
      }
    }
    if (instanceExpired(instance, now)) {
      damage += splashAt(instance, pose, def); // (b) natural expiry, position-gated.
      break;
    }
  }
  return damage;
}

/** Headroom on the broad phase's reach, in world units, so float rounding can never skip a graze. */
const BROAD_PHASE_SLACK = 1;

/** The radius of the smallest circle about (`x`, `y`) that holds `shape`. */
function radiusAbout(shape: WorldShape, x: number, y: number): number {
  if (shape.kind === "circle") return Math.hypot(shape.x - x, shape.y - y) + shape.radius;
  let max = 0;
  for (const p of shape.points) max = Math.max(max, Math.hypot(p.x - x, p.y - y));
  return max;
}

/** Squared distance from (`px`, `py`) to the segment (`ax`, `ay`)–(`bx`, `by`). */
function segmentPointDistSq(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/**
 * How many ticks `marchOne` walks one `weaponId`'s instance: its own longest clock — a beam's
 * extension plus linger, a projectile's flight, or a bouncing shot's `projectileLifetime` — plus a
 * little headroom, resolved from the ACTIVE mode's `weaponTicksOf` at call time. It was a typed
 * `MAX_MARCH_TICKS = 120` ("no shot stays alive longer than this"), which was 4 s at 30 Hz but only
 * 2 s at 60 Hz — shorter than thumper's 2900 ms lifetime, so the march stopped walking a thumper
 * shot 0.9 s early and ignored its late bounces. The loop still terminates: every clock is finite.
 */
export function marchTicksOf(weaponId: WeaponId): number {
  const t = weaponTicksOf(weaponId);
  return Math.max(t.flight + t.lifetime, t.projectileLifetime) + MARCH_HEADROOM_TICKS;
}

/** Slack past the longest clock, so an instance that expires on its last tick is still walked. */
const MARCH_HEADROOM_TICKS = 2;

/**
 * A shell's detonation credited on natural expiry without a direct hit — see the R3(b) note on
 * `marchOne` above for why this is position-gated rather than "any near miss counts". `magmablast`
 * is the only row with an `explosion` today; its blast is a detached centre-origin disc, so the
 * honest test is "is the target's hull inside the blast radius of where the shell actually died".
 */
function splashAt(
  instance: WeaponInstance,
  pose: { x: number; y: number; angle: number },
  def: ReturnType<typeof weaponDefOf>,
): number {
  if (def.kind !== "projectile" || !def.explosion) return 0;
  const blast: WorldShape = { kind: "circle", x: instance.x, y: instance.y, radius: def.explosion.radius };
  return shapeHitsObb(blast, carHullOf(pose.x, pose.y, pose.angle)) ? def.explosion.damage : 0;
}

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
