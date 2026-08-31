import { hpOf } from "../config/car-config.js";
import { isStatusId } from "../config/status-config.js";
import type { StatusId } from "../config/status-types.js";
import { weaponDefOf } from "../config/weapon-config.js";
import { carAimRangeOf } from "../config/weapon-slots.js";
import { weaponTicksOf } from "../config/weapon-ticks.js";
import type { WeaponId } from "../config/weapon-types.js";
import {
  aabbCorners,
  convexOverlap,
  pointOutsideBounds,
  type Aabb,
  type Bounds,
} from "./collide.js";
import { carHullOf, carIdOf } from "./context.js";
import { applyDamage, applyHeal, scaleDamage } from "./damage.js";
import { applyStatus, statusPulses, type ActiveStatus } from "./status/statuses.js";
import { modifiersOf, NEUTRAL_MODIFIERS, type Modifiers } from "./status/modifiers.js";
import { beginFire, cancelPending, releaseShots, tickRecharge, type FireState } from "./weapons/fire.js";
import { resolveInstanceHits, type PoseSnapshot } from "./weapons/hits.js";
import {
  instanceExpired,
  spawnInstances,
  stepInstance,
  type WeaponInstance,
} from "./weapons/instances.js";
import { muzzleOf, updateLock, type LockState, type LockTarget } from "./weapons/lock.js";
import { projectileShapeAt, smear } from "./weapons/shapes.js";

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
  /**
   * The statuses this car is in, carried in and back out. Unlike `fireState` and `lock`, this one IS
   * networked in full (`PlayerState.statuses`) — the client predicts the local car through
   * `stepSim`, which reads the modifiers derived from it.
   *
   * Combat receives an already-expired list: `expireStatuses` runs once per tick, before driving, so
   * that everything reading a modifier this tick reads the same one.
   */
  statuses: readonly ActiveStatus[];
}

/** Everything about the tick that is the same for every player in it. */
export interface CombatWorld {
  tick: number;
  dt: number;
  mode: "ffa" | "team";
  obstacles: readonly Aabb[];
  bounds: Bounds;
}

/**
 * "Put this status on this car." The room half of the status seam, and the one a future pickup
 * system uses: a car drives over a repair crate, the room pushes one of these, and combat applies it
 * on the next tick it runs.
 *
 * It is a request rather than a direct write because `runCombat` owns the effect list for the
 * duration of a tick — a caller reaching past it to mutate `PlayerState.effects` mid-tick would race
 * whatever combat is about to write back. A request lands on the tick it is queued for and bites on
 * the NEXT one, exactly as an on-hit effect does; see the phase order on `runCombat`.
 *
 * `statusId` is typed but still validated: this queue is the one input to combat that does not come
 * from a table, and a pickup system reading ids out of arena config could hand over anything.
 */
export interface StatusRequest {
  targetSessionId: string;
  statusId: StatusId;
  /** How long it should last. The room owns the duration exactly as a weapon does. */
  durationTicks: number;
  /** Who caused it, or `""` for the world itself — a pickup, a hazard, a room-level grant. */
  sourceSessionId?: string;
}

export interface CombatInput {
  world: CombatWorld;
  players: readonly CombatPlayer[];
  instances: readonly WeaponInstance[];
  /** Monotonic counter behind instance ids. Carried in and back out so ids never repeat. */
  instanceSeq: number;
  /**
   * Statuses the room wants applied this tick, from anything that is not a weapon. Absent is none,
   * which is every tick today: no pickup system exists yet.
   */
  statusRequests?: readonly StatusRequest[];
}

export interface CombatResult {
  players: CombatPlayer[];
  instances: WeaponInstance[];
  instanceSeq: number;
}

/**
 * One tick of combat: recharge, shots fired, shots flown, shots landed. Pure — inputs are never
 * mutated, and the result is a fresh set of players and instances for the caller to write back.
 *
 * This runs *after* driving has resolved for the tick, so every hit test reads the poses cars
 * actually ended up at.
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
 *     read modifiers -> status pulses -> status requests -> tickRecharge ->
 *     (step existing instances) -> update lock -> beginFire -> releaseShots ->
 *     hit resolution (which applies each weapon's `applies` entries)
 *
 * Statuses bracket the rest of the tick. Every car's modifiers are derived ONCE, up front, from the
 * list `expireStatuses` has already swept — so nothing in a tick can be scaled by a status that
 * arrived halfway through it, and a stun cannot retroactively cancel a press it did not beat.
 *
 * Pulses (burn, repair) run next, before anything else can act, so a car killed by a bleed does not
 * also get to fire this tick — `isFighting` gates every phase below on the `alive` this sets.
 *
 * New statuses are only ever ADDED, and always take hold on the FOLLOWING tick: room requests first
 * (a pickup driven over before the shooting), then whatever this tick's hits and shots apply. One
 * rule for every source, and it has to be one rule because an on-hit status cannot work any other
 * way — hits resolve last. That is the same one-tick seam a ram knock already accepts, and it is
 * what makes the status layer order-independent within a tick rather than a race between whoever
 * ran first.
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

  // 0. Every car's modifiers, derived ONCE — before this tick's own statuses are added — and read
  // by every phase below. `expireStatuses` swept the list before driving, so this is the same
  // reading driving and ramming already took. A car in no status gets the shared frozen
  // `NEUTRAL_MODIFIERS` and the whole layer costs one map lookup.
  const modifiersFor = new Map<string, Readonly<Modifiers>>(
    players.map((p) => [
      p.sessionId,
      p.statuses.length === 0 ? NEUTRAL_MODIFIERS : modifiersOf(p.statuses, world.tick),
    ]),
  );
  const modsOf = (sessionId: string): Readonly<Modifiers> =>
    modifiersFor.get(sessionId) ?? NEUTRAL_MODIFIERS;

  // 0b. Burn and repair, before anything else this tick can act. A car whose bleed kills it here is
  // `alive: false` for every phase below, so it does not get a parting shot — which is the right
  // answer to "who won" when the bleed was already on them.
  for (const player of players) {
    if (!isFighting(player)) continue;
    for (const pulse of statusPulses(player.statuses, world.tick)) {
      // Through the same `damage` as a bullet, so a bleed kill sets `alive` by exactly the same
      // path and the win check cannot tell the two apart.
      //
      // Deliberately NOT scaled by `damageTaken`: that channel is about incoming *weapon* damage,
      // and letting one status amplify another's bleed would compound two rows into a number
      // neither of them states. A pulse deals what its row says it deals.
      if (pulse.damage > 0) damage(player, pulse.damage);
      // `applyHeal` refuses to lift a wreck off 0, so a repair landing on the tick a bleed killed
      // its target cannot un-eliminate them.
      if (pulse.heal > 0) player.hp = applyHeal(player.hp, pulse.heal, hpOf(carIdOf(player)));
    }
  }

  // 0c. Statuses the room asked for — a pickup, a hazard — added AFTER the reading above, so a
  // request behaves exactly as a weapon's does: it lands on this tick and bites on the next one. It
  // also means a crate and a shot arriving together cannot resolve differently depending on which
  // the room queued first, and a `weaponCooldown` grant cannot retroactively shorten a recharge
  // started this tick.
  for (const request of input.statusRequests ?? []) {
    const target = byId.get(request.targetSessionId);
    if (!target || !isFighting(target)) continue;
    if (!isStatusId(request.statusId)) continue;
    target.statuses = applyStatus(
      target.statuses,
      request.statusId,
      world.tick,
      request.durationTicks,
      request.sourceSessionId ?? "",
    );
  }

  // 1. Recharge first, so a stock that lands this tick can be spent this tick. A player who has left
  // the fight cannot bank a shot, and drops any pending burst — a wreck does not finish firing.
  for (const player of players) {
    if (!isFighting(player)) {
      player.fireState = cancelPending(player.fireState);
      continue;
    }
    player.fireState = tickRecharge(
      player.fireState,
      world.tick,
      modsOf(player.sessionId).weaponCooldown,
    );
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
    player.lock = updateLock(player.lock, {
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
      lockRangeUnits: carAimRangeOf(carIdOf(player)),
    });
  }

  // 3. New presses, then whatever they (or an earlier tick's press) have scheduled for this tick.
  for (const player of players) {
    if (!isFighting(player)) continue;
    const mods = modsOf(player.sessionId);
    // `disarmed` blocks a NEW press only; `releaseShots` below still runs. A press is a commitment
    // (`beginFire` spends the stock at press time because a wind-up cannot be cancelled), so a jam
    // landing mid-wind-up would otherwise eat a stock and produce nothing — a debuff that is
    // strictly worse the better your timing was. Jam what has not been committed yet; let what has
    // finish.
    if (!mods.disarmed) {
      player.fireState = beginFire(player.fireState, player.fireMask, world.tick);
    }
    const released = releaseShots(player.fireState, world.tick, mods.weaponCooldown);
    player.fireState = released.state;
    for (const order of released.orders) {
      const spawned = spawnInstances(
        order,
        player,
        world.tick,
        instanceSeq,
        aimAngleFor(player, order.weaponId, byId),
        mods.damageDealt,
      );
      instanceSeq = spawned.seq;
      stepped.push(...spawned.instances);
      // `self` statuses land when a shot actually goes OUT, not when the key went down: a press that
      // a cooldown rejected buys nothing, and a wind-up pays off at the end of the wind-up. No hit
      // test is involved, so a self-buff works whether or not the weapon connects with anything.
      applySelfStatuses(player, order.weaponId, world.tick, order.finalVolley);
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
      if (!target) continue;
      // Incoming damage is scaled at IMPACT, where outgoing was frozen at spawn. Deliberately
      // asymmetric: a shot's cost is the shooter's business at the moment they fired, but how much
      // it hurts is the target's business at the moment it lands — so armour applied while a shot is
      // in the air protects against it, which is the whole point of applying armour under fire.
      //
      // `hit.amount` may legitimately be 0: a pure applicator weapon still registers a hit, because
      // a status rides the hit rather than the number.
      damage(target, scaleDamage(hit.amount, modsOf(hit.sessionId).damageTaken));
      // Statuses ride the DAMAGE list, so they inherit its rules for free: friendly fire, the
      // shooter's own immunity, wrecks, pierce, and the per-target damage clock that stops a
      // lingering beam re-applying every single tick.
      applyOpponentStatuses(target, instance.weaponId, world.tick, instance.ownerSessionId, instance.finalWave);
    }
    if (outcome.instance.alive) survivors.push(outcome.instance);
  }

  return { players, instances: survivors, instanceSeq };
}

/** In the match and not yet a wreck: the gate for firing and being shot alike. */
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
export function aimAngleFor(
  player: CombatPlayer,
  weaponId: WeaponId,
  byId: ReadonlyMap<string, CombatPlayer>,
): number | null {
  if (!weaponDefOf(weaponId).usesAimAssist) return null;
  if (player.lock.targetSessionId === "") return null;
  const target = byId.get(player.lock.targetSessionId);
  if (!target || !isFighting(target)) return null;
  const def = weaponDefOf(weaponId);
  // Per-weapon range gate (spec S1): a lock the car holds through its longest assisted weapon may
  // still be out of THIS weapon's reach — then the weapon declines the assist and fires straight.
  // Centre-to-centre, matching how lock scoring measures distance.
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  if (distance > (def.aimRangeUnits ?? 0)) return null;
  const muzzle = muzzleOf({ x: player.x, y: player.y, angle: player.angle });
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

/**
 * Put this weapon's `self` statuses on the car that fired it.
 *
 * Durations come from `WEAPON_TICKS.applyDurations`, positionally parallel to the weapon's own
 * `applies` array — converted from milliseconds exactly once, at module load, so the two halves of
 * the lockstep can never round differently.
 */
function applySelfStatuses(
  player: CombatPlayer,
  weaponId: WeaponId,
  tick: number,
  finalWave: boolean,
): void {
  const applies = weaponDefOf(weaponId).applies;
  if (!applies) return;
  const durations = weaponTicksOf(weaponId).applyDurations;
  applies.forEach((application, index) => {
    if (application.target !== "self") return;
    if (application.onWave === "final" && !finalWave) return;
    player.statuses = applyStatus(
      player.statuses,
      application.statusId,
      tick,
      durations[index] ?? 0,
      player.sessionId,
    );
  });
}

/** Put this weapon's `opponents` statuses on a car its shot just damaged. */
function applyOpponentStatuses(
  target: CombatPlayer,
  weaponId: WeaponId,
  tick: number,
  sourceSessionId: string,
  finalWave: boolean,
): void {
  const applies = weaponDefOf(weaponId).applies;
  if (!applies) return;
  const durations = weaponTicksOf(weaponId).applyDurations;
  applies.forEach((application, index) => {
    if (application.target !== "opponents") return;
    if (application.onWave === "final" && !finalWave) return;
    target.statuses = applyStatus(
      target.statuses,
      application.statusId,
      tick,
      durations[index] ?? 0,
      sourceSessionId,
    );
  });
}

/** The only writer of `hp` and `alive`. 0 hp is the wreck: the car stays on the field, inert. */
function damage(player: CombatPlayer, amount: number): void {
  player.hp = applyDamage(player.hp, amount);
  if (player.hp === 0) player.alive = false;
}

