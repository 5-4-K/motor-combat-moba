import {
  TICK_RATE_HZ, beamOriginOf, beamReachOf, beamShapeAt, carHullOf, derived, forwardMaxSpeedOf,
  instanceExpired, projectileExpired, projectileShapeAt, shapeHitsObb, smear, spawnInstances,
  stepProjectileMotion, clampBearingToSwing, clampToSwing, turret, turretPivotOf, turretTurnDelta,
  weaponDamageOf, weaponDefOf, weaponTicksOf, wrapAngle, type CarId, type StepInstanceContext,
  type WeaponDef, type WeaponId, type WeaponInstance, type WorldShape,
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

  // The target's path and hull, read ONCE per solve: every pellet of every quadrature node marches
  // against the same predicted poses, so sixty pepperbox marches used to rebuild the same 47 hulls
  // sixty times over. A maneuver sweeps the car itself over its own tick count, so it has no track.
  const track = def.kind === "maneuver" ? undefined : trackOf(marchArgs.targetAt, marchTicksOf(slot.weaponId));

  let hitChance = 0;
  let expectedDamage = 0;
  for (const node of AIM_QUADRATURE) {
    const aim = nominal + node.z * sigma;
    // A turret press moves the barrel, never the hull: the owner keeps its own heading and the
    // bearing rides on the order, exactly as `releaseShots` hands it to `spawnInstances`.
    const landed = lead ? marchPress(marchArgs, track, shooter.angle, aim) : marchPress(marchArgs, track, aim);
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
  track: TargetTrack | undefined,
  heading: number,
  bearing?: number,
): { hits: number; damage: number } {
  // `target`, `targetAt` and `arena` are not destructured here on purpose (R5): this function only
  // spawns, and hands the whole `args` to `marchOne`, which is what actually walks the shot.
  const { shooter, slot, slotIndex, tick } = args;
  const def = weaponDefOf(slot.weaponId);
  if (def.kind === "maneuver" || track === undefined) return marchManeuver(args, heading, def);

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
    const landed = def.kind === "beam"
      ? marchBeam(spawnedInstance, args, track, heading, def)
      : marchProjectile(spawnedInstance, args, track, heading, def);
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
 * The target's predicted path over one march, read once per `solve` and shared by every pellet of
 * every quadrature node (they all march against the same `targetAt`). `poses[ahead]` and
 * `hulls[ahead]` are indexed by ticks ahead, 1..`ticks`; index 0 is a placeholder. The bounding
 * circle (`cx`, `cy`, `radius`) holds every pose centre, so a march can ask "could this shot ever
 * come near the target at all" before it walks a single tick.
 */
interface TargetTrack {
  ticks: number;
  poses: readonly { x: number; y: number; angle: number }[];
  hulls: readonly ReturnType<typeof carHullOf>[];
  cx: number;
  cy: number;
  radius: number;
  /** Half the hull's diagonal: the circle about a pose that holds its hull. */
  hullRadius: number;
}

function trackOf(targetAt: PosePredictor, ticks: number): TargetTrack {
  const poses: { x: number; y: number; angle: number }[] = [{ x: 0, y: 0, angle: 0 }];
  const hulls: ReturnType<typeof carHullOf>[] = [carHullOf(0, 0, 0)];
  for (let ahead = 1; ahead <= ticks; ahead++) {
    const pose = targetAt(ahead);
    poses.push(pose);
    hulls.push(carHullOf(pose.x, pose.y, pose.angle));
  }
  // Centred on the first pose, radius to the farthest: not the tightest circle, but a circle that
  // holds every pose is all the bound needs.
  const cx = poses[1]?.x ?? 0;
  const cy = poses[1]?.y ?? 0;
  let radius = 0;
  for (let ahead = 1; ahead <= ticks; ahead++) {
    radius = Math.max(radius, Math.hypot(poses[ahead]!.x - cx, poses[ahead]!.y - cy));
  }
  const probe = hulls[0]!;
  return { ticks, poses, hulls, cx, cy, radius, hullRadius: Math.hypot(probe.w, probe.h) / 2 };
}

/**
 * March one projectile to expiry, returning the damage it deals to the target.
 *
 * A projectile stops at its first contact.
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
 *
 * COST (2026-10-10, solver cost). The sim's `stepInstance` copies the whole instance, a `Map` and a
 * `Set` every tick; this march keeps one mutable motion record and steps it through the same
 * `stepProjectileMotion` the sim's branch calls, so the arithmetic is identical and the allocation
 * is gone. Pellets and nodes share the target's hulls through `track`. And a STRAIGHT-flying shot
 * (no bounce, no homing, no detonation) whose whole flight line stays farther from every predicted
 * pose than the broad phase's reach is not walked at all: every per-tick broad test below would have
 * said no, so the march would have returned 0. Three of pepperbox's four muzzles point away from
 * the target on most presses, and that one check retires them.
 */
function marchProjectile(
  start: WeaponInstance,
  args: SolveArgs,
  track: TargetTrack,
  heading: number,
  def: WeaponDef,
): number {
  if (def.kind !== "projectile") throw new Error(`marchProjectile: ${def.id} is not a projectile`);
  const { shooter, target, tick, arena } = args;
  const dt = 1 / TICK_RATE_HZ;

  // NOT `boundsOf(arena)`: `arena` here is a `BotArenaView`, which carries no `boundary` field (it
  // is a constructed projection, never a handle on the arena def — see that type's doc). `boundsOf`
  // reads `.boundary`, so feeding it a view silently returns the bare rectangle no matter what
  // `.planes` the view actually carries, and the solver marches every shot through a rectangle
  // while the real sim simulates the octagon. Build the `Bounds` from the view's own pre-built
  // planes instead.
  const ctx: StepInstanceContext = {
    dt, tick,
    obstacles: arena.obstacles,
    bounds: { width: arena.width, height: arena.height, planes: arena.planes },
    ownerPose: { x: shooter.x, y: shooter.y, angle: heading },
    homingTarget: { x: target.x, y: target.y },
  };

  // The broad phase. The shot's swept shape this tick lies inside the capsule of radius
  // `shotRadius` around the segment its centre moved along (both end shapes do, and the capsule is
  // convex), and the target's hull lies inside a circle of `hullRadius` around its pose. Capsule
  // and circle apart means the exact test would say no, so the hull and the SAT are skipped — for a
  // shot nowhere near the target, which is most ticks of most marches. Exact: it only ever skips a
  // test that would have returned false.
  const startShape = projectileShapeAt(def.hitbox, start.x, start.y, start.angle);
  const shotRadius = radiusAbout(startShape, start.x, start.y);
  const reach = shotRadius + track.hullRadius + BROAD_PHASE_SLACK;
  const reachSq = reach ** 2;

  // The whole-march version of the same test, for a shot that flies a straight line: every per-tick
  // segment lies on the line from the muzzle to `track.ticks` steps out (the march never walks
  // further), and every pose lies in the track's circle. Line and circle further apart than `reach`
  // means no tick's test can pass. A bouncing or homing shot bends, and a detonating shell credits
  // `splashAt` where it stops, so those walk the full march as before.
  const straight = !def.bounces && !def.explosion && !(def.homing && start.homingTargetId !== "");
  if (straight) {
    const length = def.speed * dt * track.ticks;
    const tipX = start.x + Math.cos(start.angle) * length;
    const tipY = start.y + Math.sin(start.angle) * length;
    const clearance = track.radius + reach + STRAIGHT_FLIGHT_SLACK;
    if (segmentPointDistSq(start.x, start.y, tipX, tipY, track.cx, track.cy) > clearance ** 2) return 0;
  }

  const motion = {
    x: start.x, y: start.y, angle: start.angle, distance: start.distance,
    homingTargetId: start.homingTargetId, homingUntilTick: start.homingUntilTick,
  };
  // `undefined` while the shot is outside the broad phase: its shape is only built when the narrow
  // test is going to read it.
  let previous: WorldShape | undefined = startShape;
  for (let ahead = 1; ahead <= track.ticks; ahead++) {
    const now = tick + ahead;
    const pose = track.poses[ahead]!;
    const beforeX = motion.x;
    const beforeY = motion.y;
    const beforeAngle = motion.angle;
    ctx.tick = now;
    const moved = stepProjectileMotion(motion, ctx, def);
    motion.x = moved.x; motion.y = moved.y; motion.angle = moved.angle; motion.distance = moved.distance;

    if (segmentPointDistSq(beforeX, beforeY, motion.x, motion.y, pose.x, pose.y) <= reachSq) {
      const current = projectileShapeAt(def.hitbox, motion.x, motion.y, motion.angle);
      const before = previous ?? projectileShapeAt(def.hitbox, beforeX, beforeY, beforeAngle);
      if (shapeHitsObb(smear(before, current), track.hulls[ahead]!)) {
        // (a) Direct hit: the target is inside the blast by construction, no position check needed.
        return start.damage + (def.explosion ? def.explosion.damage : 0);
      }
      previous = current;
    } else {
      previous = undefined;
    }
    if (projectileExpired(motion.distance, start.expiresAtTick, now, def)) {
      return splashAt(motion.x, motion.y, pose, def); // (b) natural expiry, position-gated.
    }
  }
  return 0;
}

/**
 * March one beam to expiry, returning the damage it deals to the target.
 *
 * A ticking beam damages on the first tick it covers the target, then once per
 * `weaponTicksOf(id).damageInterval` — the same cadence `resolveInstanceHits` applies in the real
 * sim, so lance and afterburner are not under-counted to a single pulse.
 *
 * The owner pose is frozen for the whole march, so `stepInstance`'s beam branch would re-anchor to
 * the same origin and re-run the same wall clip every tick — that raycast alone was over a third of
 * a balance run's CPU (2026-10-09 profile). Both are resolved once and only the extent is stepped,
 * which is all the beam branch changes. Once the beam stops growing its swept shape is identical
 * tick to tick, so it is reused rather than re-hulled. Same result, bit for bit.
 *
 * BROAD PHASE (2026-10-10, solver cost): every beam shape `beamShapeAt` builds lies within
 * `beamHalfWidthAt` of its axis segment (a rect's long sides, a cone's tip corners, a disc's rim),
 * and that half-width never shrinks as the extent grows, so the swept hull of two consecutive
 * shapes lies within the capsule of the LONGER one's half-width about the longer axis. A pose
 * further from the axis than that capsule plus the hull's radius cannot be covered — the capsule
 * and the hull's circle are convex and apart — so the smear and the SAT are skipped for it. Exact:
 * it only ever skips a test that would have said no. The shapes themselves are then built lazily,
 * only on a tick the narrow test is going to read them.
 */
function marchBeam(
  start: WeaponInstance,
  args: SolveArgs,
  track: TargetTrack,
  heading: number,
  def: WeaponDef,
): number {
  if (def.kind !== "beam") throw new Error(`marchBeam: ${def.id} is not a beam`);
  const { shooter, tick, arena } = args;
  const interval = weaponTicksOf(start.weaponId).damageInterval;
  const dt = 1 / TICK_RATE_HZ;
  // See `marchProjectile` on why the bounds are built from the view's planes.
  const bounds = { width: arena.width, height: arena.height, planes: arena.planes };
  const ownerPose = { x: shooter.x, y: shooter.y, angle: heading };
  const origin = beamOriginOf(start, def, ownerPose);
  const beamReach = beamReachOf(def, origin, arena.obstacles, bounds);
  const dirX = Math.cos(origin.angle);
  const dirY = Math.sin(origin.angle);
  const shapeAt = (extent: number): WorldShape => beamShapeAt(def.hitbox, origin.x, origin.y, origin.angle, extent);

  let extent = start.extent;
  // The shape at `previousExtent`, built on demand. The spawned instance's own shape is the first
  // `previous` (it is built at the owner's pose, which `beamOriginOf` re-anchors to the same origin
  // on the first step — a zero-extent beam is an empty polygon wherever it sits).
  let previousExtent = start.extent;
  let previousShape: WorldShape | undefined = beamShapeAt(def.hitbox, start.x, start.y, start.angle, start.extent);
  let steadySwept: WorldShape | undefined;
  let damage = 0;
  let lastHitTick = -Infinity;

  for (let ahead = 1; ahead <= track.ticks; ahead++) {
    const now = tick + ahead;
    const next = Math.min(beamReach, extent + def.speed * dt);
    const unchanged = ahead > 1 && next === extent;
    extent = next;

    const pose = track.poses[ahead]!;
    const tipX = origin.x + dirX * extent;
    const tipY = origin.y + dirY * extent;
    const reach = beamHalfWidthAt(def.hitbox, extent) + track.hullRadius + BROAD_PHASE_SLACK;
    let connects = false;
    if (segmentPointDistSq(origin.x, origin.y, tipX, tipY, pose.x, pose.y) <= reach * reach) {
      if (unchanged) {
        steadySwept ??= smear(previousShape ??= shapeAt(previousExtent), previousShape);
        connects = shapeHitsObb(steadySwept, track.hulls[ahead]!);
      } else {
        const current = shapeAt(extent);
        connects = shapeHitsObb(smear(previousShape ?? shapeAt(previousExtent), current), track.hulls[ahead]!);
        previousShape = current;
      }
    } else if (!unchanged) {
      previousShape = undefined;
    }
    if (!unchanged) previousExtent = extent;

    if (connects && now - lastHitTick >= interval) {
      damage += start.damage;
      lastHitTick = now;
    }
    // A beam's expiry reads only its row, spawn tick and life offset — none of which the march
    // moves — so the spawned instance stands in for the stepped one exactly.
    if (instanceExpired(start, now)) break;
  }
  return damage;
}

/**
 * How far from its axis segment (origin to tip) any point of `beamShapeAt(hitbox, …, extent)` can
 * lie — the radius of the capsule that holds the shape. Mirrors that function case for case: a rect
 * is `width / 2` wide throughout, a cone's tip corners sit `tan(half) * reach` off the axis, and a
 * disc is a circle of radius `reach` about the origin (which the segment contains). Never decreases
 * with `extent`, which is what lets one capsule hold two consecutive shapes.
 */
function beamHalfWidthAt(hitbox: Extract<WeaponDef, { kind: "beam" }>["hitbox"], extent: number): number {
  const reach = Math.max(0, extent);
  switch (hitbox.shape) {
    case "rect": return hitbox.width / 2;
    case "cone": return Math.tan((hitbox.angleDeg * Math.PI) / 360) * reach;
    case "disc": return reach;
  }
}

/** Headroom on the broad phase's reach, in world units, so float rounding can never skip a graze. */
const BROAD_PHASE_SLACK = 1;

/**
 * Extra headroom on the whole-march straight-flight test: the march accumulates `cos(angle) * step`
 * tick by tick while the test extrapolates the line in one multiply, and the two can disagree by
 * rounding. A unit is many orders of magnitude more than that disagreement over the longest march.
 */
const STRAIGHT_FLIGHT_SLACK = 1;


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
 * How many ticks a march walks one `weaponId`'s instance: its own longest clock — a beam's
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
  x: number,
  y: number,
  pose: { x: number; y: number; angle: number },
  def: ReturnType<typeof weaponDefOf>,
): number {
  if (def.kind !== "projectile" || !def.explosion) return 0;
  const blast: WorldShape = { kind: "circle", x, y, radius: def.explosion.radius };
  return shapeHitsObb(blast, carHullOf(pose.x, pose.y, pose.angle)) ? def.explosion.damage : 0;
}
