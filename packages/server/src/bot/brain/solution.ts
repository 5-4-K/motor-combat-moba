import {
  TICK_RATE_HZ, beamShapeAt, carHullOf, forwardMaxSpeedOf, instanceExpired, projectileShapeAt,
  shapeHitsObb, slotsOf, smear, spawnInstances, stepInstance, weaponDamageOf, weaponDefOf,
  weaponTicksOf, type CarId, type WeaponInstance, type WorldShape,
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
 * AIM ASSIST (Task 6, P13): when a live, in-range lock is held on THIS target and the weapon uses
 * assist, the real sim's `aimAngleFor` (`sim/combat.ts`) points the shot at the target regardless of
 * where the nose is aimed — so `nominal` is overridden back to the bearing and `sigma` forced to 0,
 * collapsing the quadrature's spread to a single certain point. The gate mirrors `aimAngleFor`'s own
 * conditions (`usesAimAssist`, a lock on this exact target, centre-to-centre distance within
 * `aimRangeUnits`) with two simplifications noted in the Task 5/6 report: it does not check the
 * target is still fighting or not phased (the caller is not expected to solve against a target that
 * is neither), and it aims from the shooter's centre rather than `muzzleOf`'s offset.
 */
export function solve(args: SolveArgs): FiringSolution {
  const { shooter, slot, target, aimSigmaRad, tick } = args;
  const def = weaponDefOf(slot.weaponId);
  const reach = weaponReachOf(slot.weaponId);
  const distance = Math.hypot(target.x - shooter.x, target.y - shooter.y);
  if (distance > reach) return NO_SOLUTION;

  const bearing = Math.atan2(target.y - shooter.y, target.x - shooter.x);
  const assisted = def.usesAimAssist
    && shooter.lockTargetSessionId === target.sessionId
    && distance <= (def.aimRangeUnits ?? 0);
  // The shot leaves along the car's nose (`aimAngleFor`) UNLESS an assist lock overrides it onto the
  // bearing — evaluating the bearing unconditionally would answer "if I were aimed right" and gate
  // nothing for an unassisted weapon.
  const nominal = assisted ? bearing : shooter.angle;
  const sigma = assisted ? 0 : aimSigmaRad;
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

/** `bestAchievableValueOf` keys its cache on carId and sigma together — a kit is fixed per match,
 * so this only needs computing once per (chassis, tier) combination the whole process ever sees. */
const bestAchievableValueCache = new Map<string, number>();

/**
 * Fractions of a slot's `weaponReachOf` tried when hunting for its best-case `value` (R20). A grid
 * rather than a closed form because "best range" is not the same shape for every weapon: a pellet
 * spread and a beam both want to stand close (a target subtends a wider angle, so aim noise is less
 * likely to miss it), an aim-assisted gun's ceiling is flat across most of its lock envelope, and a
 * maneuver's hull-sweep can connect anywhere along its own travel line. Sampling densely near 0 and
 * coarsely out to the full reach covers all three shapes without hand-deriving one per weapon kind.
 *
 * Each sampled distance is still floored at `BRAIN_CONSTANTS.minEngageUnits` (below) — without that
 * floor, a short-range weapon's small fractions (e.g. 2% of `pepperbox`'s 600u range, 12 units) put
 * the target's hull CENTRE closer than the two cars' own half-lengths, so the synthetic geometry has
 * shooter and target overlapping and every one of `pepperbox`'s four muzzles (three pointed sideways
 * and backward, per `WEAPON_TABLE`) lands on a target that is, physically, inside the shooter. That
 * measured a 235 ceiling for Bullseye — a number no real engagement can ever produce, since no two
 * cars stand inside each other — instead of the roughly-78 pepperbox actually achieves at a distance
 * where only its forward muzzle's fan can connect.
 */
const CEILING_RANGE_FRACTIONS: readonly number[] = Object.freeze([
  0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.98,
]);

/**
 * The best `value` (expected damage per second) this chassis's kit can produce anywhere, at this
 * aim sigma, with perfect aim GEOMETRY — nose pointed exactly at a stationary target (R20).
 *
 * This is the denominator `minShotValueFraction` (bot-profiles.ts) divides against: an absolute EV
 * threshold cannot compare across kits whose ceilings differ by a factor of four (see that field's
 * doc comment for the measured per-chassis numbers this fixes), so the gate instead asks "is this
 * shot worth taking, relative to the best this kit can ever do at this shooter's own aim quality".
 *
 * Built the same way `solve` itself works — a synthetic stationary target, straight ahead, at a grid
 * of candidate ranges per slot (`CEILING_RANGE_FRACTIONS`) — and taking the best `value` any slot
 * reaches at any sampled range. A lock is assumed held on the synthetic target (matching distance
 * within `aimRangeUnits`) so an aim-assisted weapon's real ceiling — a forced sigma of 0 — is not
 * silently discarded, the same condition `solve` itself checks.
 *
 * MEMOISED (`bestAchievableValueCache`): a kit is fixed for the whole match, so this must never be
 * recomputed per tick — only look it up once per (carId, aimSigma) pair.
 */
export function bestAchievableValueOf(carId: CarId, aimSigmaRad: number): number {
  const key = `${carId}|${aimSigmaRad}`;
  const cached = bestAchievableValueCache.get(key);
  if (cached !== undefined) return cached;

  const arena: BotArenaView = { width: 1_000_000, height: 1_000_000, obstacles: [] };
  const shooter: SolverShooter = {
    sessionId: "ceiling-shooter", carId, team: 0,
    x: 0, y: 0, angle: 0, speed: 0, lockTargetSessionId: "ceiling-target",
  };

  let best = 0;
  const weaponIds = slotsOf(carId);
  for (let i = 0; i < weaponIds.length; i++) {
    const weaponId = weaponIds[i]!;
    const reach = weaponReachOf(weaponId);
    const slot: BotSlotView = {
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
      range: weaponDefOf(weaponId).range,
    };
    for (const fraction of CEILING_RANGE_FRACTIONS) {
      const distance = Math.max(BRAIN_CONSTANTS.minEngageUnits, reach * fraction);
      const target: BotCarView = {
        sessionId: "ceiling-target", carId, team: 1, x: distance, y: 0, angle: 0,
        speed: 0, hp: Number.POSITIVE_INFINITY, maxHp: Number.POSITIVE_INFINITY,
        alive: true, phased: false, statuses: [], maneuver: 0,
      };
      const solution = solve({
        shooter, slot, slotIndex: i, target, targetAt: constantVelocityPredictor(target),
        aimSigmaRad, tick: 0, arena,
      });
      if (solution.value > best) best = solution.value;
    }
  }

  bestAchievableValueCache.set(key, best);
  return best;
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
  if (def.kind === "maneuver") return marchManeuver(args, heading, def);

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
    previous = current;
    if (instanceExpired(instance, now)) {
      damage += splashAt(instance, pose, def); // (b) natural expiry, position-gated.
      break;
    }
  }
  return damage;
}

/** No shot on this roster stays alive longer than this; the loop must terminate regardless. */
const MAX_MARCH_TICKS = 120;

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
