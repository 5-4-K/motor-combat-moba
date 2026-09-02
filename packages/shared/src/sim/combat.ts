import { CAR_TABLE, DEFAULT_CAR_ID, hpOf } from "../config/car-config.js";
import { isStatusId } from "../config/status-config.js";
import type { StatusId } from "../config/status-types.js";
import { instanceDefOf, isWeaponId, weaponDefOf } from "../config/weapon-config.js";
import { carAimRangeOf } from "../config/weapon-slots.js";
import { msToTicks, weaponTicksOf } from "../config/weapon-ticks.js";
import type { ManeuverWeaponDef, WeaponId } from "../config/weapon-types.js";
import type { CarId } from "../config/types.js";
import { TICK_RATE_HZ } from "../constants.js";
import {
  aabbCorners,
  convexOverlap,
  pointOutsideBounds,
  type Aabb,
  type Bounds,
} from "./collide.js";
import type { ContactHit } from "./contact.js";
import { carHullOf, carIdOf } from "./context.js";
import { applyDamage, applyHeal, damageFor, scaleDamage, weaponDamageOf } from "./damage.js";
import { ManeuverKind, NO_MANEUVER } from "./maneuver.js";
import { applyStatus, hasStatus, statusPulses, type ActiveStatus } from "./status/statuses.js";
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
import { beamShapeAt, projectileShapeAt, shapeHitsObb, smear } from "./weapons/shapes.js";
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
  /**
   * The statuses this car is in, carried in and back out. Unlike `fireState` and `lock`, this one IS
   * networked in full (`PlayerState.statuses`) — the client predicts the local car through
   * `stepSim`, which reads the modifiers derived from it.
   *
   * Combat receives an already-expired list: `expireStatuses` runs once per tick, before driving, so
   * that everything reading a modifier this tick reads the same one.
   */
  statuses: readonly ActiveStatus[];
  /** `ManeuverKind` value. 0 = none. Server-only, carried in and back out like `fireState`. */
  maneuver: number;
  maneuverTicksLeft: number;
  /** Dash heading, radians. 0 outside a dash. */
  maneuverAngle: number;
  /** Dash translation speed, world units/sec. 0 outside a dash. */
  maneuverSpeed: number;
  /**
   * Which weapon started the running maneuver, or "". Server-only, carried in and out like
   * `fireState`: the contact pass reads it to price a slam/dash hit, and the stun sweep reads its
   * `isUnInterruptable`. Never networked — `stepSim` reads the four numeric fields, not this.
   */
  maneuverWeaponId: WeaponId | "";
  /**
   * Who last took hp off this car, or `""` if nothing has.
   *
   * The whole of kill attribution (M5–M7). There is no damage ledger and no contribution window,
   * because there are no assists: the last point of damage decides the kill outright.
   *
   * Carried in and back out like `fireState` and `lock`, and server-only for the same reason — the
   * client does not predict damage, so putting it on the wire would patch a string to everyone at
   * the tick rate for nothing. `stepSim` never reads it, so invariant 8 does not apply.
   *
   * This is well-defined for every death in the game: status pulses already carry
   * `sourceSessionId`, and contact hits are priced with their attacker. There is no world kill to
   * attribute to nobody.
   */
  lastDamagerSessionId: string;
}

/** Reset a car's four maneuver fields to neutral and drop its `maneuverWeaponId` (O8/O14). */
function clearManeuver(player: CombatPlayer): void {
  Object.assign(player, NO_MANEUVER);
  player.maneuverWeaponId = "";
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
  /**
   * Dash hits and hard slams the contact pass (`sim/contact.ts`) found this tick, priced and applied
   * in phase 0d below — see that phase's comment. Absent is none, which is every tick a match has no
   * live contact.
   */
  contactHits?: readonly ContactHit[];
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

  // Stun interruption (O8) needs to know who was ALREADY stunned coming into this tick, captured
  // before phase 0c (or anything else) can add a fresh `stunned` — so the end-of-tick sweep below
  // only fires for a car whose stun is new this tick, never re-interrupting one still riding out an
  // older application.
  const wasStunned = new Set(
    players.filter((p) => hasStatus(p.statuses, "stunned", world.tick)).map((p) => p.sessionId),
  );

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
  /**
   * Spawn protection, on the TARGET side only (M13).
   *
   * A phasing car is not present in the world: not a collider, not a ram partner, not a weapon
   * target, not an aim-assist lock candidate. Collision and the ram pair list got that through
   * `otherCarHulls` (M15); this is combat's half of the same promise. It reads the answer off the
   * modifiers derived once above rather than re-scanning the status rows, so there is exactly one
   * derivation per car per tick and every phase below sees the same one.
   *
   * Deliberately NOT folded into `isFighting`, which gates firing as well as being hit. A phased
   * car must still be able to shoot: M23's first termination condition is "the player commits a
   * press", so the firing path has to run for them, or spawn protection becomes unbreakable by
   * firing and the state machine quietly changes shape. Gate every place a car is looked at as a
   * target — lock candidates, the hit-resolution snapshot, a held lock's continued validity
   * (`aimAngleFor`), and now proximity acquisition (`acquireByProximity`, passed this same
   * `isTargetable` closure rather than deriving its own) — and leave every place it acts alone.
   */
  const isPhasedOf = (sessionId: string): boolean => modsOf(sessionId).phased;
  /** In the fight AND actually present: the gate for everything that treats a car as a target. */
  const isTargetable = (player: CombatPlayer): boolean =>
    isFighting(player) && !isPhasedOf(player.sessionId);

  // 0b. Burn and repair, before anything else this tick can act. A car whose bleed kills it here is
  // `alive: false` for every phase below, so it does not get a parting shot — which is the right
  // answer to "who won" when the bleed was already on them.
  for (const player of players) {
    if (!isFighting(player)) continue;
    for (const pulse of statusPulses(player.statuses, world.tick)) {
      // Through the same `damage` as a bullet, so a bleed kill sets `alive` by exactly the same
      // path and the win check cannot tell the two apart — except `invulnerable`, which zeroes
      // everything, a pulse included.
      //
      // Deliberately NOT scaled by `damageTaken`: that channel is about incoming *weapon* damage,
      // and letting one status amplify another's bleed would compound two rows into a number
      // neither of them states. A pulse deals what its row says it deals.
      if (pulse.damage > 0) {
        dealDamageTo(player, pulse.damage, modsOf(player.sessionId), pulse.sourceSessionId);
      }
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

  // 0d. Contact damage — a dash landing or a hard slam, discovered by the contact pass this tick.
  // Priced exactly like a shot: the attacker's weapon row through their `attack` and `damageDealt`,
  // the target's `damageTaken` at impact, and the weapon's `applies` riding the hit (spec S3). The
  // hull was the hitbox; this is the damage half arriving through the same seam a pickup would.
  for (const hit of input.contactHits ?? []) {
    const target = byId.get(hit.targetSessionId);
    if (!target || !isFighting(target)) continue;
    const attacker = byId.get(hit.attackerSessionId);
    const base = weaponDamageOf(attacker ? carIdOf(attacker) : DEFAULT_CAR_ID, hit.weaponId);
    const dealt = scaleDamage(base, attacker ? modsOf(hit.attackerSessionId).damageDealt : 1);
    const targetMods = modsOf(hit.targetSessionId);
    dealDamageTo(target, scaleDamage(dealt, targetMods.damageTaken), targetMods, hit.attackerSessionId);
    applyOpponentStatuses(target, hit.weaponId, false, world.tick, hit.attackerSessionId, true);
  }

  // 1. Recharge first, so a stock that lands this tick can be spent this tick. A player who has left
  // the fight cannot bank a shot, and drops any pending burst — a wreck does not finish firing.
  for (const player of players) {
    if (!isFighting(player)) {
      player.fireState = cancelPending(player.fireState);
      // A wreck holds nothing: the same "nothing survives" rule `clearKnock` applies to ram state.
      clearManeuver(player);
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
    // The locked car's LIVE pose, looked up fresh every tick. For a proximity shot the target is
    // not known at spawn: it is chosen HERE, where the pose list is, so `instances.ts` keeps its
    // rule that it never reads player state (spec P1).
    let targetId = instance.homingTargetId;
    if (targetId === "") {
      targetId = acquireByProximity(instance, players, world.mode, isTargetable);
    }
    const homingOwner = targetId !== "" ? byId.get(targetId) : undefined;
    stepped.push({
      ...stepInstance(instance, {
        dt: world.dt,
        tick: world.tick,
        obstacles: world.obstacles,
        bounds: world.bounds,
        ownerPose: owner ? { x: owner.x, y: owner.y, angle: owner.angle } : null,
        homingTarget:
          homingOwner && isFighting(homingOwner) ? { x: homingOwner.x, y: homingOwner.y } : null,
      }),
      // Commit: once chosen the shot keeps this target for life, and flies straight if it dies
      // (spec P5). Written back here rather than inside `stepInstance` for the same reason the
      // scan is here — the choice is the caller's, the steering is the instance's.
      homingTargetId: targetId,
    });
  }

  // 2b. Locks, BEFORE any shot is aimed by one. `spawnInstances` reads the lock in phase 3, and
  // with `startUpMs: 0` a press both schedules and fires on the same tick, so a lock updated after
  // phase 3 would aim every shot one tick stale. Runs after driving, like the rest of combat, so
  // scoring and the sight raycast read the poses cars actually ended the tick at.
  //
  // A car wrecked by THIS tick's hit resolution is still locked until the next tick's update: the
  // same one-tick seam the pose snapshot already accepts, worth at most one shot at 30 Hz.
  //
  // A car under spawn protection is not a candidate: `isTargetable`, not `isFighting`, because a
  // phasing car may still hold and use a lock of its own — the OWNER gate a few lines below stays
  // `isFighting` for exactly that reason.
  const lockTargets: LockTarget[] = players
    .filter(isTargetable)
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
    // A press that would start a maneuver (or a hold weapon) while one runs is ignored BEFORE the
    // stock is spent — masked out of the press, not swallowed after commitment.
    const blocked = player.maneuver !== ManeuverKind.NONE ? maneuverSlotMask(player.fireState) : 0;
    if (!mods.disarmed) {
      const prevPending = player.fireState.pending;
      player.fireState = beginFire(player.fireState, player.fireMask & ~blocked, world.tick);
      // A hold weapon commits the car the moment the wind-up starts (O10): press -> HOLD for
      // wind-up + growth + linger, released early only by wreck or stun.
      const pending = player.fireState.pending;
      if (pending !== null && prevPending === null) {
        const pendingDef = weaponDefOf(pending.weaponId);
        if (pendingDef.kind === "beam" && pendingDef.holdsDuringFire && player.maneuver === ManeuverKind.NONE) {
          const t = weaponTicksOf(pendingDef.id);
          player.maneuver = ManeuverKind.HOLD;
          player.maneuverTicksLeft = t.startUp + t.flight + t.lifetime;
          player.maneuverWeaponId = pendingDef.id;
        }
      }
    }
    const released = releaseShots(player.fireState, world.tick, mods.weaponCooldown);
    player.fireState = released.state;
    for (const order of released.orders) {
      const def = weaponDefOf(order.weaponId);
      // A press that would start a maneuver-kind weapon moves the car instead of spawning an
      // instance — no aim, no hit test, just the trigger for `startManeuver`.
      if (def.kind === "maneuver") {
        startManeuver(player, def, byId);
        applySelfStatuses(player, order.weaponId, world.tick, order.finalVolley);
        continue;
      }
      const aim = aimAngleFor(player, order.weaponId, byId, isPhasedOf);
      // A homing shot needs both a live lock AND a successful aim assist — `aim === null` means the
      // lock was out of range, absent, or the weapon declined assist for some other reason, and
      // firing a rocket that steers toward a target it did not actually aim at would be a stealth
      // buff no other weapon gets.
      const homingTargetId =
        def.kind === "projectile" && def.homing && aim !== null ? player.lock.targetSessionId : "";
      const spawned = spawnInstances(
        order,
        player,
        world.tick,
        instanceSeq,
        aim,
        mods.damageDealt,
        homingTargetId,
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
  //
  // `isTargetable` drops a phasing car from the snapshot entirely, which is what makes M13's
  // "invulnerability falls out of intangibility" literally true here: the shot never sees the car,
  // so it deals no damage, spends no pierce, is not stopped by it, and lands none of its on-hit
  // statuses. That is precisely what the rejected `damageTaken: 0` could not buy.
  const snapshot: PoseSnapshot = players
    .filter(isTargetable)
    .map((p) => ({ sessionId: p.sessionId, team: p.team, hull: carHullOf(p.x, p.y, p.angle) }));

  // Bursts are collected separately and appended AFTER the loop, so a burst spawned this tick is
  // not itself hit-tested before every shell this tick has finished resolving (spec P13a).
  const survivors: WeaponInstance[] = [];
  const bursts: WeaponInstance[] = [];
  for (const instance of stepped) {
    // The pose to sweep from, shared by the world test and the car test so they cannot disagree
    // about where this tick's path started. `?? instance` covers one born this tick, which has no
    // previous pose: its smear collapses to its shape at the muzzle. Moved above the expiry check,
    // along with `owner`, since all three removal sites below need them.
    const before = previous.get(instance.id) ?? instance;
    const owner = byId.get(instance.ownerSessionId);
    const damageMult = owner ? modsOf(owner.sessionId).damageDealt : 1;
    const carId = owner ? carIdOf(owner) : DEFAULT_CAR_ID;

    if (instanceExpired(instance, world.tick)) {
      const blast = detonate(instance, instance.x, instance.y, world.tick, instanceSeq, damageMult, carId);
      if (blast) {
        bursts.push(blast.burst);
        instanceSeq = blast.seq;
      }
      continue;
    }
    if (hitsWorld(instance, before, world)) {
      // P14: the PRE-step pose. `hitsWorld` fires when the swept hull CROSSED a boundary, so the
      // post-step point can be inside a wall or off the field entirely — the shell blows up where
      // it last legitimately was.
      const blast = detonate(instance, before.x, before.y, world.tick, instanceSeq, damageMult, carId);
      if (blast) {
        bursts.push(blast.burst);
        instanceSeq = blast.seq;
      }
      continue;
    }

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
      const targetMods = modsOf(hit.sessionId);
      dealDamageTo(
        target,
        scaleDamage(hit.amount, targetMods.damageTaken),
        targetMods,
        instance.ownerSessionId,
      );
      // Statuses ride the DAMAGE list, so they inherit its rules for free: friendly fire, the
      // shooter's own immunity, wrecks, pierce, and the per-target damage clock that stops a
      // lingering beam re-applying every single tick.
      applyOpponentStatuses(
        target,
        instance.weaponId,
        instance.isExplosion,
        world.tick,
        instance.ownerSessionId,
        instance.finalWave,
      );
    }
    // `ownerInside` statuses cannot ride the damage list — `canDamage` refuses the owner by design —
    // so a live zone runs its own owner-hull test each tick. Placed here, beside the other status
    // application, so both kinds of rider land at the same point of the tick and take hold on the
    // next one like every other status.
    applyOwnerInsideStatuses(instance, byId, world.tick);
    if (outcome.instance.alive) {
      survivors.push(outcome.instance);
    } else {
      const blast = detonate(instance, instance.x, instance.y, world.tick, instanceSeq, damageMult, carId);
      if (blast) {
        bursts.push(blast.burst);
        instanceSeq = blast.seq;
      }
    }
  }
  survivors.push(...bursts);

  // Stun interruption (O8): a stun landing THIS tick cancels the car's committed states at the end
  // of the tick — after this tick's already-released shots resolved, the same one-tick seam every
  // other on-apply consequence accepts. Runs after hit resolution so it catches a stun applied by
  // any path this tick (0c request, 0d contact, or this tick's own hits), and `wasStunned` (captured
  // before any of those ran) keeps a car already riding out an older stun from being re-swept.
  // `isUnInterruptable` exempts a weapon's wind-up or maneuver per-row. Stocks spent on a cancelled
  // wind-up stay spent (O14): interruption is the stun's payoff.
  const interrupted = new Set<string>();
  for (const player of players) {
    if (wasStunned.has(player.sessionId)) continue;
    if (!hasStatus(player.statuses, "stunned", world.tick)) continue;
    const pending = player.fireState.pending;
    if (pending && !weaponDefOf(pending.weaponId).isUnInterruptable) {
      player.fireState = cancelPending(player.fireState);
    }
    const maneuverDef = isWeaponId(player.maneuverWeaponId) ? weaponDefOf(player.maneuverWeaponId) : null;
    if (player.maneuver !== ManeuverKind.NONE && !maneuverDef?.isUnInterruptable) {
      clearManeuver(player);
    }
    interrupted.add(player.sessionId);
  }
  const kept = survivors.filter(
    (i) => !(interrupted.has(i.ownerSessionId) && i.attached && !weaponDefOf(i.weaponId).isUnInterruptable),
  );

  return { players, instances: kept, instanceSeq };
}

/**
 * In the match and not yet a wreck: the gate for ACTING — firing, holding a lock, keeping an
 * attached beam alive, receiving a status the room asked for.
 *
 * Being *shot at* is the strictly narrower `isTargetable` inside `runCombat`, which adds "and not
 * phasing". Do not merge the two: see the note on `isPhasedOf` for what folding `phased` in here
 * would break.
 */
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
  isPhased: (sessionId: string) => boolean,
): number | null {
  if (!weaponDefOf(weaponId).usesAimAssist) return null;
  if (player.lock.targetSessionId === "") return null;
  const target = byId.get(player.lock.targetSessionId);
  if (!target || !isFighting(target)) return null;
  // A lock outlives by one tick the event that invalidates it — `updateLock` runs before hits, and
  // dropping a car from `lockTargets` only stops the NEXT acquisition, never the lock already held.
  // Without this guard that one stale tick curves a shot into a car spawn protection says is not
  // there. `isPhased` is a parameter rather than something derived here so `runCombat`'s single
  // per-tick derivation stays the only reading of the flag anywhere in combat; it is required, not
  // optional, so a future call site has to answer the question rather than inherit "no".
  if (isPhased(target.sessionId)) return null;
  const def = weaponDefOf(weaponId);
  // Per-weapon range gate (spec S1): a lock the car holds through its longest assisted weapon may
  // still be out of THIS weapon's reach — then the weapon declines the assist and fires straight.
  // Centre-to-centre, matching how lock scoring measures distance.
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  if (distance > (def.aimRangeUnits ?? 0)) return null;
  const muzzle = muzzleOf({ x: player.x, y: player.y, angle: player.angle });
  // NO lead, for any kind (A3): the assist points the shot at where the target IS and the player
  // carries the lead themselves. Aiming at a first-order intercept instead shipped briefly and was
  // reverted -- it made the assist decide the shot rather than set its direction.
  return Math.atan2(target.y - muzzle.y, target.x - muzzle.x);
}

/** The dash direction: the lock target's bearing (NO lead — the car arrives, not a shot), or the heading. */
export function dashAngleFor(
  player: CombatPlayer,
  def: ManeuverWeaponDef,
  byId: ReadonlyMap<string, CombatPlayer>,
): number {
  if (!def.usesAimAssist || player.lock.targetSessionId === "") return player.angle;
  const target = byId.get(player.lock.targetSessionId);
  if (!target || !isFighting(target)) return player.angle;
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  if (distance > (def.aimRangeUnits ?? 0)) return player.angle;
  return Math.atan2(target.y - player.y, target.x - player.x);
}

/** Begin a maneuver-kind weapon's effect. One maneuver at a time; a second press is ignored. */
export function startManeuver(
  player: CombatPlayer,
  def: ManeuverWeaponDef,
  byId: ReadonlyMap<string, CombatPlayer>,
): void {
  if (player.maneuver !== ManeuverKind.NONE) return;
  player.maneuverWeaponId = def.id;
  if (def.maneuver.type === "dash") {
    const distance = def.aimRangeUnits ?? def.range;
    player.maneuver = ManeuverKind.DASH;
    player.maneuverSpeed = def.speed;
    player.maneuverTicksLeft = Math.max(1, Math.ceil((distance / def.speed) * TICK_RATE_HZ));
    player.maneuverAngle = dashAngleFor(player, def, byId);
  } else {
    player.maneuver = ManeuverKind.CHARGE;
    player.maneuverTicksLeft = msToTicks(def.maneuver.durationMs);
    player.maneuverAngle = 0;
    player.maneuverSpeed = 0;
  }
}

/** Bitmask of slots whose weapon starts a maneuver or a hold — the presses masked out mid-maneuver. */
function maneuverSlotMask(fireState: FireState): number {
  let mask = 0;
  fireState.slots.forEach((slot, index) => {
    const def = weaponDefOf(slot.weaponId);
    if (def.kind === "maneuver" || (def.kind === "beam" && def.holdsDuringFire)) mask |= 1 << index;
  });
  return mask;
}

/**
 * The nearest car this shot may grab, or `""` for none (spec P1-P4).
 *
 * A full 360-degree bubble around the SHOT — not a cone off the shooter's nose. Eligibility is the
 * same pair of predicates the hit test already uses, so a proximity shot can never chase something
 * it could not have damaged: `canDamage` refuses the owner and teammates, `isTargetable` refuses
 * wrecks and phased cars. No third notion of "valid target" is introduced.
 *
 * `isTargetable` is a PARAMETER rather than something derived here, on purpose: it is the
 * `runCombat`-local closure reading that tick's single derived-once modifiers cache
 * (`modifiersFor`/`modsOf`), not a hand-rolled re-scan of `player.statuses`. A second derivation
 * would drift from the cache the moment a status's flag came from `STATUS_TABLE.flags` rather than
 * matching its id, or the moment a mid-tick addition needed the same "lands this tick, bites next"
 * treatment `isPhasedOf`'s cache already gives it for free.
 *
 * Deterministic under a distance TIE only because `runCombat` sorts `players` by `sessionId` before
 * this runs (this function does not re-sort), combined with the strict `distSq >= bestSq` below —
 * a later equal-distance candidate never displaces an earlier one. Moving that sort would silently
 * make acquisition order-dependent, which a lockstep sim cannot tolerate.
 *
 * Returns `""` for any instance whose weapon does not acquire by proximity, so the caller needs no
 * guard of its own.
 */
function acquireByProximity(
  instance: WeaponInstance,
  players: readonly CombatPlayer[],
  mode: "ffa" | "team",
  isTargetable: (player: CombatPlayer) => boolean,
): string {
  const def = weaponDefOf(instance.weaponId);
  if (def.kind !== "projectile") return "";
  const homing = def.homing;
  if (!homing || homing.acquire !== "proximity") return "";
  const radius = homing.acquireRadius ?? 0;
  if (radius <= 0) return "";

  const radiusSq = radius * radius;
  let bestId = "";
  let bestSq = Number.POSITIVE_INFINITY;
  for (const player of players) {
    if (!isTargetable(player)) continue;
    if (!canDamage(instance.ownerSessionId, instance.ownerTeam, player.sessionId, player.team, mode)) {
      continue;
    }
    const dx = player.x - instance.x;
    const dy = player.y - instance.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > radiusSq || distSq >= bestSq) continue;
    bestSq = distSq;
    bestId = player.sessionId;
  }
  return bestId;
}

/**
 * The burst one dying shot leaves behind, or `null` if its weapon authors no explosion.
 *
 * Born at FULL extent rather than growing from zero (spec P15). That is what makes "a direct hit
 * costs contact plus splash" true without a timing race: the car that stopped the shell is inside
 * the field on the very tick it forms, rather than a tick or two later once it has grown out.
 *
 * Damage is re-derived from the burst's own def and the owner's chassis, and frozen here for the
 * same reason a shell's is frozen at the muzzle: it must be answerable at impact without reading
 * player state, and the shooter may be wrecked before the field expires.
 *
 * Takes `damageMult` and `carId` rather than the whole owner: `modsOf` is a `runCombat`-local
 * closure over that tick's derived-once modifiers cache, so a module-level function cannot reach
 * it — the caller resolves both at the call site (`owner ? modsOf(owner.sessionId).damageDealt : 1`
 * and `owner ? carIdOf(owner) : DEFAULT_CAR_ID`), the same fallback phase 0d already uses for a
 * contact hit with no live attacker.
 */
function detonate(
  shell: WeaponInstance,
  x: number,
  y: number,
  tick: number,
  seq: number,
  damageMult: number,
  carId: CarId,
): { burst: WeaponInstance; seq: number } | null {
  const def = instanceDefOf(shell.weaponId, shell.isExplosion);
  if (def.kind !== "projectile" || !def.explosion) return null;
  const burstDef = instanceDefOf(shell.weaponId, true);
  const next = seq + 1;
  return {
    seq: next,
    burst: {
      id: `${shell.ownerSessionId}-${next}`,
      ownerSessionId: shell.ownerSessionId,
      ownerTeam: shell.ownerTeam,
      finalWave: shell.finalWave,
      // `weaponDamageOf` reads the weapon ROW's damage — the shell's 50, not the burst's 15 — so
      // it is the wrong helper here. `damageFor` takes an explicit base, which is what a burst
      // needs. Do not widen `weaponDamageOf` to mean two things.
      damage: scaleDamage(damageFor(CAR_TABLE[carId].attack, burstDef.damage), damageMult),
      weaponId: shell.weaponId,
      kind: "beam",
      x,
      y,
      angle: 0,
      extent: burstDef.range,
      spawnTick: tick,
      distance: 0,
      pierceLeft: 0,
      attached: false,
      damageClock: new Map(),
      alive: true,
      muzzleDir: 0,
      homingTargetId: "",
      homingUntilTick: 0,
      expiresAtTick: 0,
      isExplosion: true,
    },
  };
}

/**
 * A projectile that has left the arena or entered level geometry is spent, whatever its pierce.
 *
 * Tested as the SMEAR between the pre-step and post-step poses — the same solid the car test uses
 * (D8) — not as a point at the landing position. That is what actually retires the old authoring
 * rule that every obstacle be at least 30 units thick: a point sample at 600 u/s only looks every 20
 * units, so a fast shot passed clean through a thin wall while the docs claimed it could not.
 *
 * Beams are never destroyed by the world; they are CLIPPED by `wallClipDistance` as they grow, so
 * they leave here untouched by either reckoning of "is this a beam" — the instance's own kind or its
 * weapon def's.
 */
function hitsWorld(instance: WeaponInstance, previous: WeaponInstance, world: CombatWorld): boolean {
  const def = instanceDefOf(instance.weaponId, instance.isExplosion);
  // A bouncing projectile is never destroyed by the world — `stepInstance` reflected it instead,
  // and testing the pre-reflection smear here would kill it on the very wall it just bounced off.
  // A `piercesWalls` row is exempt too, by authored identity rather than mechanism: it flies
  // through geometry and bounds alike, and only its own `range` clock ends it. Both exemptions
  // matter most on the SPAWN tick, where the smear collapses to the shape at the muzzle — a
  // wide bar born with a wingtip touching a wall would otherwise die before any client saw it.
  if (def.kind !== "projectile" || instance.kind !== "projectile" || def.bounces) return false;
  if (def.piercesWalls) return false;

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

/**
 * Put this weapon's `ownerInside` statuses on the firing car for every tick its own hull stands
 * inside this live BEAM instance — the presence-buff seam (`tremor`'s fortified).
 *
 * A dedicated test rather than a damage rider, because the one predicate the damage list runs on
 * (`canDamage`) refuses the owner by design and must keep doing so. Beams only: a zone is a place
 * to stand. The application re-fires every covered tick, so the authored duration is meant to be
 * short and the row's `reapply: "refresh"` is what turns the flicker into a held window — the same
 * shape as `afterburner` holding `overheated` through its damage ticks.
 */
function applyOwnerInsideStatuses(
  instance: WeaponInstance,
  byId: ReadonlyMap<string, CombatPlayer>,
  tick: number,
): void {
  if (instance.kind !== "beam") return;
  const def = instanceDefOf(instance.weaponId, instance.isExplosion);
  if (def.kind !== "beam") return;
  const applies = def.applies;
  if (!applies || !applies.some((a) => a.target === "ownerInside")) return;
  const owner = byId.get(instance.ownerSessionId);
  if (!owner || !isFighting(owner)) return;
  const shape = beamShapeAt(def.hitbox, instance.x, instance.y, instance.angle, instance.extent);
  if (!shapeHitsObb(shape, carHullOf(owner.x, owner.y, owner.angle))) return;
  const ticks = weaponTicksOf(instance.weaponId);
  const durations = instance.isExplosion ? ticks.explosion!.applyDurations : ticks.applyDurations;
  applies.forEach((application, index) => {
    if (application.target !== "ownerInside") return;
    owner.statuses = applyStatus(
      owner.statuses,
      application.statusId,
      tick,
      durations[index] ?? 0,
      owner.sessionId,
    );
  });
}

/**
 * Put this weapon's `opponents` statuses on a car its shot just damaged.
 *
 * `isExplosion` routes the lookup through `instanceDefOf`: a burst's `applies` list lives on the
 * EXPLOSION's def, not the shell's (`magmablast.explosion.applies`, never `magmablast.applies`),
 * so a plain `weaponDefOf` here would silently drop `corroded` on every direct-splash hit.
 */
function applyOpponentStatuses(
  target: CombatPlayer,
  weaponId: WeaponId,
  isExplosion: boolean,
  tick: number,
  sourceSessionId: string,
  finalWave: boolean,
): void {
  const applies = instanceDefOf(weaponId, isExplosion).applies;
  if (!applies) return;
  const ticks = weaponTicksOf(weaponId);
  const durations = isExplosion ? ticks.explosion!.applyDurations : ticks.applyDurations;
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

/**
 * The only writer of damage-inflicted `hp`/`alive` changes in combat — `applyHeal` is the other half
 * of what moves `hp`, for the opposite direction. `invulnerable` zeroes the amount — the hit still
 * happened (pierce spent, statuses ride, the clock arms); only the hp change is refused. 0 hp is
 * the wreck: the car stays on the field, inert.
 *
 * `sourceSessionId` is stamped only when the hit actually costs hp (M5–M7). A pure applicator
 * weapon legitimately deals 0 and still registers as a hit, and an armored car loses nothing —
 * letting either claim the kill would credit a player who never scratched the target.
 */
export function dealDamageTo(
  player: CombatPlayer,
  amount: number,
  mods: Readonly<Modifiers>,
  sourceSessionId: string,
): void {
  if (!mods.invulnerable) {
    if (amount > 0 && sourceSessionId !== "") player.lastDamagerSessionId = sourceSessionId;
    player.hp = applyDamage(player.hp, amount);
  }
  if (player.hp === 0) player.alive = false;
}

