import { CAR_TABLE } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { weaponDefOf } from "../config/weapon-config.js";
import type { WeaponId } from "../config/weapon-types.js";
import {
  aabbCorners,
  convexOverlap,
  obbsInContact,
  pointOutsideBounds,
  type Aabb,
  type Bounds,
} from "./collide.js";
import { carHullOf, carIdOf } from "./context.js";
import { applyDamage } from "./damage.js";
import { isRamming, ramDamage, ramOutcome } from "./ram.js";
import { beginFire, cancelPending, releaseShots, tickRecharge, type FireState } from "./weapons/fire.js";
import { resolveInstanceHits, type PoseSnapshot } from "./weapons/hits.js";
import {
  instanceExpired,
  spawnInstances,
  stepInstance,
  type WeaponInstance,
} from "./weapons/instances.js";
import { muzzleOf, newLockState, updateLock, type LockState, type LockTarget } from "./weapons/lock.js";
import { projectileShapeAt, smear } from "./weapons/shapes.js";
import { canDamage } from "./weapons/targets.js";

/**
 * One player as the combat step sees them. Plain data on purpose: the room maps `PlayerState` onto
 * this and back, so combat can be tested without standing up a Colyseus room.
 *
 * `fireMask` is "this player pressed these slots on an input the server actually simulated this
 * tick", not the raw key state — see `serverTick`, which reports it. `fireState` is what actually
 * gates firing: cooldowns, locks and any pending burst, so holding a key and tapping it fire at the
 * same rate.
 */
export interface CombatPlayer {
  sessionId: string;
  x: number;
  y: number;
  angle: number;
  team: 0 | 1;
  carId: string;
  hp: number;
  alive: boolean;
  inRoster: boolean;
  /** Slot bitmask from an input the server actually simulated this tick. Bit 0 = slot 1. */
  fireMask: number;
  fireState: FireState;
  /**
   * This car's ambient target lock (A1). Server-only state carried in and back out, exactly as
   * `fireState` is; only `targetSessionId` is ever projected onto the schema.
   */
  lock: LockState;
}

/** Everything about the tick that is the same for every player in it. */
export interface CombatWorld {
  tick: number;
  dt: number;
  mode: "ffa" | "team";
  obstacles: readonly Aabb[];
  bounds: Bounds;
}

export interface CombatInput {
  world: CombatWorld;
  players: readonly CombatPlayer[];
  instances: readonly WeaponInstance[];
  /** `"idA|idB"` (session ids sorted) to the tick at which that pair may deal ram damage again. */
  ramCooldowns: ReadonlyMap<string, number>;
  /** Monotonic counter behind instance ids. Carried in and back out so ids never repeat. */
  instanceSeq: number;
}

export interface CombatResult {
  players: CombatPlayer[];
  instances: WeaponInstance[];
  ramCooldowns: Map<string, number>;
  instanceSeq: number;
}

/**
 * One tick of combat: recharge, shots fired, shots flown, shots landed, rams. Pure — inputs are
 * never mutated, and the result is a fresh set of players, instances, and cooldowns for the caller
 * to write back.
 *
 * This runs *after* driving has resolved for the tick, so every hit test reads the poses cars
 * actually ended up at. That ordering is what makes ramming legible: you are damaged by where the
 * other car is now, not by where it was before the collision pushed it off you.
 *
 * The whole step is server-only. The client draws the resulting instances and never predicts a shot
 * or an hp change: a mispredicted bullet is a phantom kill, and there is no reconciliation story for
 * "you were dead for 80ms". Prediction covers the local car's motion and nothing else.
 *
 * Hits are tested against the current tick with no lag compensation. A shooter on 80ms therefore has
 * to lead a moving target by roughly their own latency. Rewind-and-replay hit testing is the
 * standard fix and is deliberately out of scope for v1.
 *
 * Everything iterates in sorted `sessionId` order for the same reason `serverTick` does: an
 * instance that could hit two overlapping cars must always pick the same one.
 *
 * Per-tick phase order — pinned by `weapons/fire.ts`'s own module comment and its tests:
 *
 *     tickRecharge -> (step existing instances) -> beginFire -> releaseShots -> hit resolution -> ramming
 *
 * Every weapon in the table today has `startUpMs: 0`, so a press must schedule and fire on the same
 * tick: `beginFire` before `releaseShots` is what makes that true. Existing instances step BEFORE new
 * ones are born, so a fresh shot draws at the muzzle rather than a tick's travel beyond it.
 */
export function runCombat(input: CombatInput): CombatResult {
  const { world } = input;
  const players = input.players
    .map((p) => ({ ...p }))
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  const byId = new Map(players.map((p) => [p.sessionId, p]));
  let instanceSeq = input.instanceSeq;

  // 1. Recharge first, so a stock that lands this tick can be spent this tick. A player who has left
  // the fight cannot bank a shot, and drops any pending burst — a wreck does not finish firing.
  for (const player of players) {
    if (!isFighting(player)) {
      player.fireState = cancelPending(player.fireState);
      continue;
    }
    player.fireState = tickRecharge(player.fireState, world.tick);
  }

  // 2. Existing instances step BEFORE new ones are born, so a fresh shot draws at the muzzle rather
  // than a tick's travel beyond it. Preserved from the pre-weapon-system behaviour.
  const previous = new Map(input.instances.map((i) => [i.id, i]));
  const stepped: WeaponInstance[] = [];
  for (const instance of input.instances) {
    const owner = byId.get(instance.ownerSessionId);
    // An attached beam dies with its owner: a wreck does not shoot. Everything already frozen at
    // birth — projectiles, detached beams — finishes its life regardless.
    if (instance.attached && (!owner || !isFighting(owner))) continue;
    stepped.push(
      stepInstance(instance, {
        dt: world.dt,
        tick: world.tick,
        obstacles: world.obstacles,
        bounds: world.bounds,
        ownerPose: owner ? { x: owner.x, y: owner.y, angle: owner.angle } : null,
      }),
    );
  }

  // 2b. Locks, BEFORE any shot is aimed by one. `spawnInstances` reads the lock in phase 3, and
  // with `startUpMs: 0` a press both schedules and fires on the same tick, so a lock updated after
  // phase 3 would aim every shot one tick stale. Runs after driving, like the rest of combat, so
  // scoring and the sight raycast read the poses cars actually ended the tick at.
  //
  // A car wrecked by THIS tick's hit resolution is still locked until the next tick's update: the
  // same one-tick seam the pose snapshot already accepts, worth at most one shot at 30 Hz.
  const lockTargets: LockTarget[] = players
    .filter(isFighting)
    .map((p) => ({ sessionId: p.sessionId, team: p.team, x: p.x, y: p.y }));

  for (const player of players) {
    player.lock = updateLock(player.lock ?? newLockState(), {
      owner: {
        sessionId: player.sessionId,
        team: player.team,
        x: player.x,
        y: player.y,
        angle: player.angle,
      },
      ownerFighting: isFighting(player),
      // Read before `beginFire`, so a press a cooldown will reject still counts as engagement.
      pressedThisTick: player.fireMask > 0,
      candidates: lockTargets,
      mode: world.mode,
      obstacles: world.obstacles,
      bounds: world.bounds,
      tick: world.tick,
    });
  }

  // 3. New presses, then whatever they (or an earlier tick's press) have scheduled for this tick.
  for (const player of players) {
    if (!isFighting(player)) continue;
    player.fireState = beginFire(player.fireState, player.fireMask, world.tick);
    const released = releaseShots(player.fireState, world.tick);
    player.fireState = released.state;
    for (const order of released.orders) {
      const spawned = spawnInstances(
        order,
        player,
        world.tick,
        instanceSeq,
        aimAngleFor(player, order.weaponId, byId),
      );
      instanceSeq = spawned.seq;
      stepped.push(...spawned.instances);
    }
  }

  // 4. Hits, against a snapshot rather than player state (the lag-compensation seam).
  const snapshot: PoseSnapshot = players
    .filter(isFighting)
    .map((p) => ({ sessionId: p.sessionId, team: p.team, hull: carHullOf(p.x, p.y, p.angle) }));

  const survivors: WeaponInstance[] = [];
  for (const instance of stepped) {
    if (instanceExpired(instance, world.tick)) continue;
    // The pose to sweep from, shared by the world test and the car test so they cannot disagree
    // about where this tick's path started. `?? instance` covers one born this tick, which has no
    // previous pose: its smear collapses to its shape at the muzzle.
    const before = previous.get(instance.id) ?? instance;
    if (hitsWorld(instance, before, world)) continue;

    const outcome = resolveInstanceHits(
      instance,
      before,
      snapshot,
      world.mode,
      world.tick,
    );
    for (const hit of outcome.damaged) {
      const target = byId.get(hit.sessionId);
      if (target) damage(target, hit.amount);
    }
    if (outcome.instance.alive) survivors.push(outcome.instance);
  }

  // 5. Ramming — unchanged from the pre-weapon-system combat step apart from the rename of the
  // projectile phase above it.
  const ramCooldowns = pruneCooldowns(input.ramCooldowns, world.tick);
  for (let i = 0; i < players.length; i++) {
    const a = players[i]!;
    if (!isFighting(a)) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j]!;
      if (!isFighting(b)) continue;

      // Friendly fire is off for rams too, not just for shots. `canDamage` is the single predicate
      // that decides it, so shots and contact can never disagree about who is on your side. The
      // check is symmetric — teammates are teammates in both directions — so asking once is enough.
      // Teammates still *collide*: they shove each other around, they just cost each other no hp.
      if (!canDamage(a.sessionId, a.team, b.sessionId, b.team, world.mode)) continue;

      const key = `${a.sessionId}|${b.sessionId}`;
      if (world.tick < (ramCooldowns.get(key) ?? 0)) continue;
      // Contact, not interpenetration: driving has already pushed this pair apart to exactly
      // touching by the time combat runs. See `obbsInContact` and `COMBAT_CONFIG.ramContactPad`.
      const inContact = obbsInContact(
        carHullOf(a.x, a.y, a.angle),
        carHullOf(b.x, b.y, b.angle),
        COMBAT_CONFIG.ramContactPad,
      );
      if (!inContact) continue;

      const threshold = COMBAT_CONFIG.ramDotThreshold;
      const outcome = ramOutcome(
        isRamming(a.x, a.y, a.angle, b.x, b.y, threshold),
        isRamming(b.x, b.y, b.angle, a.x, a.y, threshold),
      );
      if (outcome === "none") continue;

      // Both halves of a head-on are dealt from the pre-hit state, so the car that dies still trades
      // its damage. There is no first-strike advantage in a mutual ram.
      if (outcome === "both" || outcome === "a_hits_b") damage(b, ramDamageOf(a));
      if (outcome === "both" || outcome === "b_hits_a") damage(a, ramDamageOf(b));
      // Set on any damaging contact, including a one-sided one: the cooldown is per *pair*, so a car
      // grinding along another cannot drain hp at 30 Hz.
      ramCooldowns.set(key, world.tick + COMBAT_CONFIG.collisionDamageCooldownTicks);
    }
  }

  return { players, instances: survivors, ramCooldowns, instanceSeq };
}

/** In the match and not yet a wreck: the gate for firing, being shot, and ramming alike. */
function isFighting(player: CombatPlayer): boolean {
  return player.inRoster && player.alive;
}

/**
 * The direction one shot should travel, or `null` for "along the car's heading".
 *
 * Re-derived per ORDER rather than once per press (A11c), so each volley of a burst aims at where
 * the target is on its own tick. That is the direct translation of the rule that a burst's shots
 * each exit from the car's pose at their own tick -- the thing that makes a burst steerable.
 *
 * Measured from the MUZZLE, not the car centre (A11a). Scoring uses the centre, because "angle off
 * my nose" is a fact about the car's facing, but the shot leaves the nose: at a target 100 units
 * out and 40 degrees off, a centre-derived angle misses by roughly a car length.
 */
function aimAngleFor(
  player: CombatPlayer,
  weaponId: WeaponId,
  byId: ReadonlyMap<string, CombatPlayer>,
): number | null {
  if (!weaponDefOf(weaponId).usesAimAssist) return null;
  if (player.lock.targetSessionId === "") return null;
  const target = byId.get(player.lock.targetSessionId);
  if (!target || !isFighting(target)) return null;
  const muzzle = muzzleOf({
    sessionId: player.sessionId,
    team: player.team,
    x: player.x,
    y: player.y,
    angle: player.angle,
  });
  return Math.atan2(target.y - muzzle.y, target.x - muzzle.x);
}

/**
 * A projectile that has left the arena or entered level geometry is spent, whatever its pierce.
 *
 * Tested as the SMEAR between the pre-step and post-step poses — the same solid the car test uses
 * (D8) — not as a point at the landing position. That is what actually retires the old authoring
 * rule that every obstacle be at least 30 units thick: a point sample at 900 u/s only looks every 30
 * units, so a fast shot passed clean through a thin wall while the docs claimed it could not.
 *
 * Beams are never destroyed by the world; they are CLIPPED by `wallClipDistance` as they grow, so
 * they leave here untouched by either reckoning of "is this a beam" — the instance's own kind or its
 * weapon def's.
 */
function hitsWorld(instance: WeaponInstance, previous: WeaponInstance, world: CombatWorld): boolean {
  const def = weaponDefOf(instance.weaponId);
  if (def.kind !== "projectile" || instance.kind !== "projectile") return false;

  const swept = smear(
    projectileShapeAt(def.hitbox, previous.x, previous.y, previous.angle),
    projectileShapeAt(def.hitbox, instance.x, instance.y, instance.angle),
  );
  // Any vertex of the swept hull off the field ends the shot: the hull covers the whole path, so a
  // shot whose hitbox crossed the boundary at any point this tick is out. `pointOutsideBounds` is
  // the one spelling of that rule, shared with the beam clip.
  for (const point of swept.points) {
    if (pointOutsideBounds(point.x, point.y, world.bounds)) return true;
  }
  for (const obstacle of world.obstacles) {
    if (convexOverlap(swept.points, aabbCorners(obstacle))) return true;
  }
  return false;
}

/** The only writer of `hp` and `alive`. 0 hp is the wreck: the car stays on the field, inert. */
function damage(player: CombatPlayer, amount: number): void {
  player.hp = applyDamage(player.hp, amount);
  if (player.hp === 0) player.alive = false;
}

function ramDamageOf(attacker: CombatPlayer): number {
  const strength = CAR_TABLE[carIdOf(attacker)].strength;
  return ramDamage(strength, COMBAT_CONFIG.collisionDamagePerStrength);
}

/**
 * Carry forward only the cooldowns that are still holding anything back. Without this the map grows
 * one entry per pair that ever touched and is never emptied for the life of the room.
 */
function pruneCooldowns(cooldowns: ReadonlyMap<string, number>, tick: number): Map<string, number> {
  const next = new Map<string, number>();
  for (const [key, until] of cooldowns) {
    if (until > tick) next.set(key, until);
  }
  return next;
}
