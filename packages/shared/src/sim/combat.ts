import { DEFAULT_CAR_ID, hpOf } from "../config/car-config.js";
import { isStatusId } from "../config/status-config.js";
import type { StatusId } from "../config/status-types.js";
import { instanceDefOf, isWeaponId, weaponDefOf } from "../config/weapon-config.js";
import { msToTicks, weaponTicksOf } from "../config/weapon-ticks.js";
import type { ManeuverWeaponDef, WeaponId } from "../config/weapon-types.js";
import type { CarId } from "../config/types.js";
import { TICK_RATE_HZ } from "../constants.js";
import { cars, spike } from "../modes/active.js";
import {
  convexOverlapsAabb,
  pointOutsideBounds,
  pointsBoundsOf,
  type Aabb,
  type Bounds,
} from "./collide.js";
import type { CombatEvents, DamageSource } from "./combat-events.js";
import type { ContactHit, SpikeHit } from "./contact.js";
import { carHullOf, carIdOf } from "./context.js";
import { applyDamage, applyHeal, damageFor, scaleDamage, weaponDamageOf } from "./damage.js";
import type { Impulse } from "./impulse.js";
import { ManeuverKind, NO_MANEUVER } from "./maneuver.js";
import { applyStatus, hasStatus, statusPulses, type ActiveStatus } from "./status/statuses.js";
import { modifiersOf, NEUTRAL_MODIFIERS, type Modifiers } from "./status/modifiers.js";
import { cancelPending, tickRecharge, type FireState } from "./weapons/fire.js";
import { pressPhase } from "./weapons/press.js";
import { resolveInstanceHits, type PoseSnapshot } from "./weapons/hits.js";
import {
  instanceExpired,
  spawnInstances,
  stepInstance,
  type WeaponInstance,
} from "./weapons/instances.js";
import { beamShapeAt, projectileShapeAt, shapeHitsObb, smear } from "./weapons/shapes.js";
import { radialSourceOf } from "./weapons/impulse-source.js";
import { canDamage } from "./weapons/targets.js";

/**
 * One player as the combat step sees them. Plain data on purpose: the room maps `PlayerState` onto
 * this and back, so combat can be tested without standing up a Colyseus room.
 *
 * `fireMask` is "this player pressed these slots on an input the server actually simulated this
 * tick", not the raw key state — see `serverTick`, which reports it. `fireState` is what actually
 * gates firing: cooldowns, recovery and any pending burst, so holding a key and tapping it fire at
 * the same rate.
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
   * The statuses this car is in, carried in and back out. Unlike `fireState`, this one IS
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
   * The press that started the running maneuver, or `""` (B8a). Server-only, carried in and out
   * like `maneuverWeaponId` beside it, and for the same reason: the contact pass prices a dash or
   * slam hit long after the press, and the damage event it produces has to name that press or the
   * two maneuver weapons can never be measured for how often they land.
   */
  maneuverPressId: string;
  /**
   * Who last took hp off this car, or `""` if nothing has.
   *
   * The whole of kill attribution (M5–M7). There is no damage ledger and no contribution window,
   * because there are no assists: the last point of damage decides the kill outright.
   *
   * Carried in and back out like `fireState`, and server-only for the same reason — the
   * client does not predict damage, so putting it on the wire would patch a string to everyone at
   * the tick rate for nothing. `stepSim` never reads it, so invariant 8 does not apply.
   *
   * This is well-defined for every death in the game: status pulses already carry
   * `sourceSessionId`, and contact hits are priced with their attacker. There is no world kill to
   * attribute to nobody.
   */
  lastDamagerSessionId: string;
  /**
   * The world bearing this tick's press was aimed along (spec TR24), or null/absent when the input
   * carried none. Read only when a press commits a turret weapon.
   */
  aimBearing?: number | null;
}

/**
 * Reset a car's four maneuver fields to neutral and drop its `maneuverWeaponId` and
 * `maneuverPressId` (O8/O14, B8a).
 *
 * The two ids are set here rather than folded into `NO_MANEUVER`: that constant's four numeric
 * fields are also spread by `drive.ts` into `ChassisDrive`'s maneuver-derived state, which has no
 * `maneuverPressId` of its own and must not gain one by riding along on a shared reset object.
 */
export function clearManeuver(player: CombatPlayer): void {
  Object.assign(player, NO_MANEUVER);
  player.maneuverWeaponId = "";
  player.maneuverPressId = "";
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
   * in phase 0e below — see that phase's comment. Absent is none, which is every tick a match has no
   * live contact.
   */
  contactHits?: readonly ContactHit[];
  /**
   * Wall-spike hits the contact pass found and the server bridge already filtered and attributed
   * (`resolveSpikeHits` — trigger speed, retrigger lockout, `sourceSessionId`). Applied in phase 0c
   * below, flat and unscaled. Absent is none, which is every tick on an arena with no spike strips.
   */
  spikeHits?: readonly SpikeHit[];
  /**
   * Where this tick's observations go, or absent for none — which is every live room (B3).
   *
   * A caller-owned bag rather than a return value: `runCombat` runs at the tick rate and a balance
   * run wants ONE log for the whole match, so returning an array would allocate and concatenate
   * 5,400 times per match. When absent, every emit site is a single undefined check.
   *
   * Observation only. Nothing in the sim may ever read an event back (B1).
   */
  events?: CombatEvents;
  /**
   * Shot compensation (NR37, NR38): owner session id -> how many EXTRA ticks the instances spawned by
   * the press that owner begins THIS tick are stepped, inside this same call, so a shot lands where
   * it would have been had it been fired that many ticks ago. The server prices it per press from
   * the frame's `viewTick` (NR36, `packages/server/src/net/shot-comp.ts`) and already clamps it.
   *
   * Read once, at press time, and frozen onto the press (`PendingFire.compTicks`), so a wind-up
   * weapon's instance is advanced by its own press's budget on the tick it is finally released, and
   * an entry for a session that does not begin a press this tick does nothing. Absent, or 0, or a
   * value that is not a positive integer, is no fast-forward — which is every bot, every harness, and
   * the whole of the k = 0 path, which is byte-for-byte the pre-NR37 tick.
   *
   * Projectile and beam instances only. A maneuver press spawns no instance and is never advanced
   * (the car is driven by `stepSim`, not here), nor is any status, contact hit or spike hit.
   */
  fastForward?: ReadonlyMap<string, number>;
}

/**
 * One push a weapon's `impulse` owes a car it just damaged: who, and the fully built `Impulse`.
 *
 * `runCombat` is pure and carries no velocity (`CombatPlayer` has x/y/angle only), so it cannot apply
 * the push itself. It reports it, and the server — which owns `SimBody.vx/vy/angVel` — applies it
 * with `applyImpulse` the same way it applies a slam's (`ram-bridge.ts`).
 */
export interface WeaponImpulse {
  targetSessionId: string;
  /** The weapon's owner: credited as the shover if the pushed car meets a spike (AS20). */
  sourceSessionId: string;
  imp: Impulse;
}

export interface CombatResult {
  players: CombatPlayer[];
  instances: WeaponInstance[];
  instanceSeq: number;
  /**
   * Instances born THIS tick that also ended this tick — at the muzzle, or inside their own shot
   * fast-forward (NR37): a close hit, a wall, an expiry, a burst whose short life ran out inside it.
   * None of them is in `instances`, so without this list no client would ever learn they existed
   * (Phase F final review I1). Each is the instance at its END pose — where `detonate` would put its
   * blast: the hit pose for a car, the pre-step pose for a wall — with `alive: false`.
   *
   * Server output only, for the room to show every client for a moment as an ended row
   * (`applyCombatResult`). Never an input to anything: `runCombat` does not take it back, and
   * `stepSim` never reads it (invariant 8 untouched). An instance that lived on an earlier tick is
   * never here — that one is `endedLived`'s.
   */
  ended: WeaponInstance[];
  /**
   * Instances that lived on an EARLIER tick and ended this one — by a hit, a wall, an expiry, a stun
   * cutting off an attached beam, or an attached beam's owner leaving the fight — each at its END pose
   * (the same pose `ended` uses), `alive: false`. Bursts are listed too; the room decides what to send.
   *
   * Server output only, like `ended` (G5, protocol 8): the room writes each ending onto the shot's own
   * row as `alive: false` for `endedShotRowMs`, so a client learns a shot ENDED from the wire rather
   * than inferring it from the row vanishing — which, under interest management, also means "left
   * your view". Never an input to anything, and kept apart from `ended` so the golden fingerprint of
   * `ended` (`combat-golden.test.ts`) still describes the birth-tick list alone.
   */
  endedLived: WeaponInstance[];
  /**
   * Pushes owed this tick: one per car a weapon with an `impulse` damaged for the FIRST time (per
   * victim, per instance — `WeaponInstance.impulsedVictims`), in the order the hits resolved.
   *
   * Server output only, like `ended`: the room applies each to the victim's `SimBody` after combat
   * (`tick-pipeline.ts`), and `stepSim` never reads it, so nothing new crosses the wire (invariant 8
   * untouched). Empty on the overwhelming majority of ticks.
   */
  impulses: WeaponImpulse[];
}

/**
 * One tick of combat: recharge, shots fired, shots flown, shots landed. Pure — inputs are never
 * mutated, and the result is a fresh set of players and instances for the caller to write back.
 *
 * This runs *after* driving has resolved for the tick, so every hit test reads the poses cars
 * actually ended up at.
 *
 * The whole step is server-only. The client draws the resulting instances and never predicts a hit
 * or an hp change: a mispredicted bullet is a phantom kill, and there is no reconciliation story for
 * "you were dead for 80ms". Prediction covers the local car's motion; the shooter's own shot is drawn
 * at once as a provisional (NR39, `net/provisional-shots.ts`), for drawing only.
 *
 * Hits are tested against the current tick; cars are never rewound. What a shooter's latency is
 * compensated with instead is shot FAST-FORWARD (NR37): an instance born from a press carrying
 * `fastForward` budget `k` is resolved at the muzzle as usual and then advanced `k` more times —
 * step, then resolve — through exactly the per-instance code every other tick uses
 * (`advanceInstance` and phase 4's `resolveInstance`), against the present world. See phase 4.
 *
 * Everything iterates in sorted `sessionId` order for the same reason `serverTick` does: an
 * instance that could hit two overlapping cars must always pick the same one.
 *
 * Per-tick phase order — pinned by `weapons/fire.ts`'s own module comment and its tests:
 *
 *     read modifiers -> status pulses -> status requests -> tickRecharge ->
 *     (step existing instances) -> beginFire -> turnTurret -> releaseShots ->
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
   * target. Collision and the ram pair list got that through
   * `otherCarHulls` (M15); this is combat's half of the same promise. It reads the answer off the
   * modifiers derived once above rather than re-scanning the status rows, so there is exactly one
   * derivation per car per tick and every phase below sees the same one.
   *
   * Deliberately NOT folded into `isFighting`, which gates firing as well as being hit. A phased
   * car must still be able to shoot: M23's first termination condition is "the player commits a
   * press", so the firing path has to run for them, or spawn protection becomes unbreakable by
   * firing and the state machine quietly changes shape. Gate every place a car is looked at as a
   * target — the hit-resolution snapshot, and proximity acquisition (`acquireByProximity`, passed
   * this same `isTargetable` closure rather than deriving its own) — and leave every place it acts
   * alone.
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
        recordDamage(
          player,
          pulse.damage,
          modsOf(player.sessionId),
          pulse.sourceSessionId,
          { kind: "pulse", statusId: pulse.statusId, sourceSessionId: pulse.sourceSessionId },
          world,
          byId,
          input.events,
        );
      }
      // `applyHeal` refuses to lift a wreck off 0, so a repair landing on the tick a bleed killed
      // its target cannot un-eliminate them.
      if (pulse.heal > 0) player.hp = applyHeal(player.hp, pulse.heal, hpOf(carIdOf(player)));
    }
  }

  // 0c. Environmental damage — a wall spike, already filtered and attributed by the server bridge
  // (`resolveSpikeHits`: trigger speed, retrigger lockout, `sourceSessionId`). Alongside burn and
  // repair above and before anything else this tick can act, so a car the spikes kill is already
  // dead for every phase below, including its own weapons.
  //
  // Flat and unmodified: `scaleDamage` is deliberately NOT called, so no status (e.g. `corroded`)
  // multiplies what a wall does (AS22) — every other damage source below routes through it, this
  // one does not.
  //
  // A phased car is skipped explicitly. It is not solid to other cars (`isSolid`), but `stepSim`
  // still runs it through `ctx.obstacles`/`ctx.bounds` unconditionally, so it DOES still collide
  // with level geometry — without this check, spawn protection would not protect anyone from the
  // walls (AS21).
  //
  // Through `recordDamage`, like every other damage path in this file: the wrapper is what emits the
  // `damaged`/`killed` events the balance harness counts kills and first blood from, and B4's "every
  // path into `dealDamageTo` has a tag" has to stay true of the environment too. `events` is absent
  // in every live room, so this costs a wreck-detection read there and nothing else.
  for (const hit of input.spikeHits ?? []) {
    const target = byId.get(hit.targetSessionId);
    if (!target || !isFighting(target)) continue;
    if (hasStatus(target.statuses, "phased", world.tick)) continue;
    recordDamage(
      target,
      spike().damage,
      modsOf(hit.targetSessionId),
      hit.sourceSessionId,
      { kind: "hazard", hazardId: "spike" },
      world,
      byId,
      input.events,
    );
  }

  // 0d. Statuses the room asked for — a pickup, a hazard — added AFTER the reading above, so a
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

  // 0e. Contact damage — a dash landing or a hard slam, discovered by the contact pass this tick.
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
    recordDamage(
      target,
      scaleDamage(dealt, targetMods.damageTaken),
      targetMods,
      hit.attackerSessionId,
      { kind: "contact", weaponId: hit.weaponId, pressId: byId.get(hit.attackerSessionId)?.maneuverPressId ?? "" },
      world,
      byId,
      input.events,
    );
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
  // An attached beam whose owner left the fight ends where it stood (`CombatResult.endedLived`).
  const vanished: WeaponInstance[] = [];
  for (const instance of input.instances) {
    const next = advanceInstance(instance, world, players, byId, isTargetable);
    if (next) stepped.push(next);
    else vanished.push({ ...instance, alive: false });
  }

  // Instance id -> the shot-compensation ticks it is owed (NR37), filled in phase 3 for instances
  // born this tick from a press that carried a budget, and spent in phase 4. Empty on every tick
  // nobody's press was compensated, which is every tick of every bot match and harness run.
  const fastForwardOf = new Map<string, number>();

  // 3. New presses, then whatever they (or an earlier tick's press) have scheduled for this tick.
  for (const player of players) {
    if (!isFighting(player)) continue;
    const mods = modsOf(player.sessionId);
    // The press phase — `beginFire`, the frozen shot compensation, `turnTurret`, `releaseShots` — is
    // shared with the shooter's client (`pressPhase`, NR39), so the two can never sequence it apart.
    const phase = pressPhase(player.sessionId, player.fireState, world.tick, {
      pressed: player.fireMask,
      maneuvering: player.maneuver !== ManeuverKind.NONE,
      disarmed: mods.disarmed,
      weaponCooldown: mods.weaponCooldown,
      aimBearing: player.aimBearing ?? null,
      carAngle: player.angle,
      fastForward: input.fastForward?.get(player.sessionId) ?? 0,
    });
    player.fireState = phase.state;
    const pending = phase.began;
    if (pending !== null) {
      input.events?.fired.push({
        tick: world.tick,
        shooterSessionId: player.sessionId,
        carId: carIdOf(player),
        weaponId: pending.weaponId,
        slot: pending.slot,
        pressId: pending.pressId,
      });
      // A hold weapon commits the car the moment the wind-up starts (O10): press -> HOLD for
      // wind-up + growth + linger, released early only by wreck or stun. Nothing in the press phase
      // reads `player.maneuver`, so setting it after the phase is the same tick as before.
      const pendingDef = weaponDefOf(pending.weaponId);
      if (pendingDef.kind === "beam" && pendingDef.holdsDuringFire && player.maneuver === ManeuverKind.NONE) {
        const t = weaponTicksOf(pendingDef.id);
        // Counted from the press, NOT shortened by the press's shot compensation: a compensated
        // beam's life is backdated by `k` (`lifeOffsetTicks`, NR37) while maneuvers are never
        // fast-forwarded (Phase F), so a lagging shooter's HOLD can outlast their own beam by up
        // to `k` ticks. Accepted — it costs only the lagging shooter, never anyone they shoot at.
        player.maneuver = ManeuverKind.HOLD;
        player.maneuverTicksLeft = t.startUp + t.flight + t.lifetime;
        player.maneuverWeaponId = pendingDef.id;
      }
    }
    const pressComp = phase.compTicks;
    for (const order of phase.orders) {
      const def = weaponDefOf(order.weaponId);
      // A press that would start a maneuver-kind weapon moves the car instead of spawning an
      // instance — no aim, no hit test, just the trigger for `startManeuver`.
      if (def.kind === "maneuver") {
        startManeuver(player, def, order.pressId);
        applySelfStatuses(player, order.weaponId, world.tick, order.finalVolley);
        continue;
      }
      // Every shot's exit angle is welded to the car's facing for a fixed muzzle (fanned by
      // `muzzles` and `spread`), or to the turret's frozen bearing for a turret row (spec TR18).
      // `homingTargetId` is likewise always `""` at spawn — the one shipped homing mode acquires
      // by proximity, in flight, from phase 2 above.
      const spawned = spawnInstances(
        order,
        player,
        world.tick,
        instanceSeq,
        mods.damageDealt,
        "",
        undefined,
        { obstacles: world.obstacles, bounds: world.bounds },
      );
      instanceSeq = spawned.seq;
      // A compensated press's shots are born `pressComp` ticks OLD (NR37): every clock that ends
      // their life or their guidance is backdated with their travel, so they fly, steer and linger
      // for exactly as long as a shot fired that many ticks earlier — never longer, which would hand
      // a laggier shooter more reach and damage window than a LAN one. `spawnTick` is the one clock
      // left at the press, because the shooter's client matches its provisional shot on it (NR39);
      // a beam's life, which `instanceExpired` counts from `spawnTick`, takes the offset instead.
      stepped.push(...(pressComp > 0 ? spawned.instances.map((i) => bornOlder(i, pressComp)) : spawned.instances));
      if (pressComp > 0) {
        for (const born of spawned.instances) fastForwardOf.set(born.id, pressComp);
      }
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

  // Bursts are collected separately and appended after the loop over `stepped`. Nothing inside the
  // loop reads `survivors`, so pushing a burst straight into it would behave identically — this is
  // bookkeeping clarity, not a correctness mechanism. (Spec P13a is "exactly one burst per shot,"
  // not an ordering rule; see `detonate`'s own guard for how that one is actually enforced.)
  const survivors: WeaponInstance[] = [];
  const bursts: WeaponInstance[] = [];
  // Born this tick and already over (see `CombatResult.ended`).
  const ended: WeaponInstance[] = [];
  // Lived on an earlier tick and over now (see `CombatResult.endedLived`).
  const endedLived: WeaponInstance[] = [];
  // Pushes owed to cars a weapon's `impulse` just caught (see `CombatResult.impulses`).
  const impulses: WeaponImpulse[] = [];

  /**
   * One instance's resolution for this tick, given the pose it swept from: expiry, the world, then
   * cars. Returns what stays in the world — the instance itself while it lives, or the burst it
   * left behind when it died (`detonate` returns `null` for a weapon with no explosion), never both.
   * Every damage and status it lands goes through `recordDamage`/`applyOpponentStatuses` at
   * `world.tick`, the one path every hit in this file takes.
   */
  const resolveInstance = (
    instance: WeaponInstance,
    before: WeaponInstance,
  ): { survivor: WeaponInstance | null; burst: WeaponInstance | null; end: WeaponInstance | null } => {
    const owner = byId.get(instance.ownerSessionId);
    const damageMult = owner ? modsOf(owner.sessionId).damageDealt : 1;
    const carId = owner ? carIdOf(owner) : DEFAULT_CAR_ID;
    const blastAt = (x: number, y: number): WeaponInstance | null => {
      const blast = detonate(instance, x, y, world.tick, instanceSeq, damageMult, carId);
      if (!blast) return null;
      instanceSeq = blast.seq;
      return blast.burst;
    };

    if (instanceExpired(instance, world.tick)) {
      return { survivor: null, burst: blastAt(instance.x, instance.y), end: { ...instance, alive: false } };
    }
    if (hitsWorld(instance, before, world)) {
      // P14: the PRE-step pose. `hitsWorld` fires when the swept hull CROSSED a boundary, so the
      // post-step point can be inside a wall or off the field entirely — the shell blows up where
      // it last legitimately was.
      return {
        survivor: null,
        burst: blastAt(before.x, before.y),
        end: { ...instance, x: before.x, y: before.y, angle: before.angle, extent: before.extent, alive: false },
      };
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
      recordDamage(
        target,
        scaleDamage(hit.amount, targetMods.damageTaken),
        targetMods,
        instance.ownerSessionId,
        { kind: "weapon", weaponId: instance.weaponId, pressId: instance.pressId, isExplosion: instance.isExplosion },
        world,
        byId,
        input.events,
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
      applyHitImpulse(instance, target, world.tick, impulses);
    }
    // `ownerInside` statuses cannot ride the damage list — `canDamage` refuses the owner by design —
    // so a live zone runs its own owner-hull test each tick. Placed here, beside the other status
    // application, so both kinds of rider land at the same point of the tick and take hold on the
    // next one like every other status.
    applyOwnerInsideStatuses(instance, byId, world.tick);
    if (outcome.instance.alive) return { survivor: outcome.instance, burst: null, end: null };
    return { survivor: null, burst: blastAt(instance.x, instance.y), end: { ...outcome.instance, alive: false } };
  };

  /**
   * Shot fast-forward (NR37, NR38): advance an already-resolved instance `ticks` more times, each a
   * step (`advanceInstance`, phase 2's body) followed by a resolution (`resolveInstance`, this
   * phase's body), stopping the moment it dies. Returns it if it is still alive at the end.
   *
   * It runs against the PRESENT world, and that is the whole contract:
   *
   * - Cars are not rewound. Hits, and a homing shot's proximity acquisition and steering, read every
   *   car where it stands this tick — the shooter's latency is paid back by moving the SHOT, never
   *   the targets (NR37).
   * - The clock is `world.tick` throughout. Damage and statuses land once, this tick, through the
   *   ordinary path, so kill attribution and the per-target damage clock (`damageMode` included) are
   *   untouched: a target swept on two loop steps is still hit once, because the clock reads the same
   *   tick both times. The shot's OWN clocks, though, were backdated by `ticks` when it was born
   *   (`bornOlder`): `expiresAtTick`, `homingUntilTick`, and a beam's life through
   *   `lifeOffsetTicks` — so a `lifetimeMs` row, a homing window and a beam's linger (and with it
   *   its interval damage) all end on the tick they would for a shot fired `ticks` earlier. Only
   *   `spawnTick` stays at the press, for the client's provisional-shot match (NR39).
   * - An attached beam re-anchors to its owner's CURRENT pose on every step (NR38); only its growth
   *   is advanced.
   *
   * A burst born at loop step `j` of `ticks` is treated as what it is: an event ON the advanced path,
   * which an earlier shell would have produced `ticks - j` ticks ago. Its `spawnTick` is backdated by
   * that remainder and it is advanced by the same remainder (`settleBurst`), so its linger window ends
   * exactly where the earlier shell's burst's would, and a car inside it is resolved this tick (once,
   * for the same clock reason) rather than first next tick. A burst born on the last step (remainder
   * 0) is pushed as-is, exactly like one born on an ordinary tick.
   */
  const runAhead = (instance: WeaponInstance, ticks: number): WeaponInstance | null => {
    let current = instance;
    for (let step = 1; step <= ticks; step++) {
      const next = advanceInstance(current, world, players, byId, isTargetable);
      if (!next) {
        ended.push({ ...current, alive: false });
        return null;
      }
      const resolved = resolveInstance(next, current);
      if (resolved.burst) settleBurst(resolved.burst, ticks - step);
      if (!resolved.survivor) {
        if (resolved.end) ended.push(resolved.end);
        return null;
      }
      current = resolved.survivor;
    }
    return current;
  };
  /** Keep a burst born `remaining` ticks before the end of a fast-forward; see `runAhead`. */
  const settleBurst = (burst: WeaponInstance, remaining: number): void => {
    if (remaining <= 0) {
      bursts.push(burst);
      return;
    }
    const aged = runAhead({ ...burst, spawnTick: burst.spawnTick - remaining }, remaining);
    if (aged) bursts.push(aged);
  };

  for (const instance of stepped) {
    // The pose to sweep from, shared by the world test and the car test so they cannot disagree
    // about where this tick's path started. `?? instance` covers one born this tick, which has no
    // previous pose: its smear collapses to its shape at the muzzle.
    const before = previous.get(instance.id) ?? instance;
    const resolved = resolveInstance(instance, before);
    // Born this tick and dead at its muzzle resolution: it never reaches `instances` alive. One that
    // lived on an earlier tick ends here too, and the client is told so (`endedLived`).
    if (resolved.end) (previous.has(instance.id) ? endedLived : ended).push(resolved.end);
    // 0 for everything but an instance born this tick from a compensated press (phase 3), which
    // continues from its muzzle resolution into `runAhead`. For 0 both lines below are exactly the
    // pre-NR37 bookkeeping: the burst to `bursts`, the survivor to `survivors`.
    const ahead = fastForwardOf.get(instance.id) ?? 0;
    if (resolved.burst) settleBurst(resolved.burst, ahead);
    const kept = resolved.survivor && ahead > 0 ? runAhead(resolved.survivor, ahead) : resolved.survivor;
    if (kept) survivors.push(kept);
  }
  survivors.push(...bursts);

  // Stun interruption (O8): a stun landing THIS tick cancels the car's committed states at the end
  // of the tick — after this tick's already-released shots resolved, the same one-tick seam every
  // other on-apply consequence accepts. Runs after hit resolution so it catches a stun applied by
  // any path this tick (0d request, 0e contact, or this tick's own hits), and `wasStunned` (captured
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
  // `weaponDefOf(i.weaponId)` here would describe the SHELL for a burst (whose `weaponId` is its
  // parent's), not the burst's own synthesized def — but `&&` short-circuits on `i.attached` first,
  // and a burst is never `attached` (P22, `buildBurstDefs`), so this is never reached for one. Safe
  // as written; do not reorder the `&&` operands without swapping this back to `instanceDefOf`.
  const kept: WeaponInstance[] = [];
  for (const i of survivors) {
    if (interrupted.has(i.ownerSessionId) && i.attached && !weaponDefOf(i.weaponId).isUnInterruptable) {
      // A beam born this tick and cut off by its owner's stun the same tick ends here, unseen too.
      (previous.has(i.id) ? endedLived : ended).push({ ...i, alive: false });
      continue;
    }
    kept.push(i);
  }

  endedLived.unshift(...vanished);
  return { players, instances: kept, instanceSeq, ended, endedLived, impulses };
}

/**
 * A newborn instance aged `ticks` ticks (NR37): the life and homing clocks frozen into it at spawn are
 * moved back, and `lifeOffsetTicks` carries the age a beam's `spawnTick`-relative life reads. A clock
 * of 0 means "none" (no `lifetimeMs`, not homing) and stays 0.
 *
 * Exported for the client's `ShotView` (NR40), which re-derives these clocks from a wire row.
 */
export function bornOlder(instance: WeaponInstance, ticks: number): WeaponInstance {
  return {
    ...instance,
    expiresAtTick: instance.expiresAtTick > 0 ? instance.expiresAtTick - ticks : 0,
    homingUntilTick: instance.homingUntilTick > 0 ? instance.homingUntilTick - ticks : 0,
    lifeOffsetTicks: ticks,
  };
}

/**
 * One instance's step for one tick — phase 2's per-instance body, shared with the shot fast-forward
 * in phase 4 (NR37) so a compensated shot moves through exactly the code every other tick does.
 * `undefined` when the instance is gone before it moves: an attached beam whose owner is wrecked or
 * absent.
 *
 * The homing target's pose is the LIVE one, looked up here on every call — including every step of
 * a fast-forward, where it is therefore the target's CURRENT pose, not where it stood the ticks the
 * shot is being advanced through: cars are never rewound (NR37).
 */
function advanceInstance(
  instance: WeaponInstance,
  world: CombatWorld,
  players: readonly CombatPlayer[],
  byId: ReadonlyMap<string, CombatPlayer>,
  isTargetable: (player: CombatPlayer) => boolean,
): WeaponInstance | undefined {
  const owner = byId.get(instance.ownerSessionId);
  // An attached beam dies with its owner: a wreck does not shoot. Everything already frozen at
  // birth — projectiles, detached beams — finishes its life regardless.
  if (instance.attached && (!owner || !isFighting(owner))) return undefined;
  // The homing target's LIVE pose, looked up fresh every tick. The target is not known at
  // spawn: it is chosen HERE, where the pose list is, so `instances.ts` keeps its rule that it
  // never reads player state (spec P1).
  let targetId = instance.homingTargetId;
  if (targetId === "") {
    targetId = acquireByProximity(instance, players, world.mode, isTargetable);
  }
  const homingOwner = targetId !== "" ? byId.get(targetId) : undefined;
  return {
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
  };
}

/**
 * In the match and not yet a wreck: the gate for ACTING — firing, keeping an attached beam alive,
 * receiving a status the room asked for.
 *
 * Being *shot at* is the strictly narrower `isTargetable` inside `runCombat`, which adds "and not
 * phasing". Do not merge the two: see the note on `isPhasedOf` for what folding `phased` in here
 * would break.
 */
function isFighting(player: CombatPlayer): boolean {
  return player.inRoster && player.alive;
}

/** Begin a maneuver-kind weapon's effect. One maneuver at a time; a second press is ignored. */
export function startManeuver(player: CombatPlayer, def: ManeuverWeaponDef, pressId: string): void {
  if (player.maneuver !== ManeuverKind.NONE) return;
  player.maneuverWeaponId = def.id;
  player.maneuverPressId = pressId;
  if (def.maneuver.type === "dash") {
    player.maneuver = ManeuverKind.DASH;
    player.maneuverSpeed = def.speed;
    player.maneuverTicksLeft = Math.max(1, Math.ceil((def.range / def.speed) * TICK_RATE_HZ));
    // Straight along the heading. The dash used to snap toward a locked car; with targeting gone
    // the driver points it themselves, which is also why `range` alone now sets the distance.
    player.maneuverAngle = player.angle;
  } else {
    player.maneuver = ManeuverKind.CHARGE;
    player.maneuverTicksLeft = msToTicks(def.maneuver.durationMs);
    player.maneuverAngle = 0;
    player.maneuverSpeed = 0;
  }
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
 * would drift from the cache the moment a status's flag came from `statusTable().flags` rather than
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
 *
 * Reached for every live instance every tick — bursts included, since the caller runs before it
 * knows whether `targetId` will turn out empty. `instanceDefOf` (not `weaponDefOf`) is what makes
 * that safe: a burst's `weaponId` is its PARENT's, and `magmablast`'s shell authors no `homing`, so
 * today the two lookups agree — but a future row with both `homing` and `explosion` would have its
 * burst run this same acquisition scan if this read the shell's def instead of the burst's own.
 */
function acquireByProximity(
  instance: WeaponInstance,
  players: readonly CombatPlayer[],
  mode: "ffa" | "team",
  isTargetable: (player: CombatPlayer) => boolean,
): string {
  const def = instanceDefOf(instance.weaponId, instance.isExplosion);
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
 * and `owner ? carIdOf(owner) : DEFAULT_CAR_ID`), the same fallback phase 0e already uses for a
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
      damage: scaleDamage(damageFor(cars()[carId].attack, burstDef.damage), damageMult),
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
      impulsedVictims: new Set(),
      alive: true,
      muzzleDir: 0,
      homingTargetId: "",
      homingUntilTick: 0,
      expiresAtTick: 0,
      isExplosion: true,
      pressId: shell.pressId,
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
 *
 * Exported for the client's `ShotView` (NR40), which stops drawing a shot at the wall the server
 * ends it on by asking this same predicate rather than a copy of it.
 */
export function hitsWorld(
  instance: WeaponInstance,
  previous: WeaponInstance,
  world: Pick<CombatWorld, "obstacles" | "bounds">,
): boolean {
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
  // `convexOverlapsAabb` puts an exact broadphase in front of the SAT; it matters because this test
  // runs up to `1 + k` times per shot on a compensated press's birth tick (NR37), against every strip.
  const reach = pointsBoundsOf(swept.points);
  for (const obstacle of world.obstacles) {
    if (convexOverlapsAabb(swept.points, reach, obstacle)) return true;
  }
  return false;
}

/**
 * Put this weapon's `self` statuses on the car that fired it.
 *
 * Durations come from `derived().weaponTicks.applyDurations`, positionally parallel to the weapon's own
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
 * A weapon's own push on a car its shot just damaged: report it in `out`, once per victim per
 * instance, and apply the `applies` statuses that ride it.
 *
 * Runs in the same damaged loop as `applyOpponentStatuses`, so it inherits the damage list's rules
 * for free: friendly fire, the shooter's immunity, wrecks and phased cars never reach it. The gate is
 * `instance.impulsedVictims`, NOT the damage clock — a ticking beam re-arms its clock every interval
 * and damages the same car over and over, but must pull it once. `impulsedVictims` is a fresh copy
 * per step (`stepInstance`) and `resolveInstanceHits` spreads the instance, so the set written here
 * is the one on the instance that survives into the next tick.
 *
 * `direction` is the unit vector from the radial source (`radialSourceOf`) through the victim, so a
 * negative `speed` pulls toward the source. A victim exactly ON the source has no direction: the
 * push is spent without being emitted (its statuses still land), so it cannot be bought back by
 * drifting off a tick later.
 * `uncontrolTicks` is 0 as in `ram-bridge.ts`; any loss of control comes from `applies`.
 */
function applyHitImpulse(
  instance: WeaponInstance,
  target: CombatPlayer,
  tick: number,
  out: WeaponImpulse[],
): void {
  const def = instanceDefOf(instance.weaponId, instance.isExplosion);
  const impulse = def.impulse;
  if (impulse === undefined) return;
  if (instance.impulsedVictims.has(target.sessionId)) return;
  instance.impulsedVictims.add(target.sessionId);

  const ticks = weaponTicksOf(instance.weaponId);
  const resolved = instance.isExplosion ? ticks.explosion?.impulse : ticks.impulse;
  for (const application of resolved?.applies ?? []) {
    target.statuses = applyStatus(
      target.statuses,
      application.statusId,
      tick,
      application.durationTicks,
      instance.ownerSessionId,
    );
  }

  const source = radialSourceOf(def, instance, target.x, target.y);
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;

  out.push({
    targetSessionId: target.sessionId,
    sourceSessionId: instance.ownerSessionId,
    imp: {
      dirX: dx / length,
      dirY: dy / length,
      speed: impulse.speed,
      spin: impulse.spin,
      defenceScaled: impulse.defenceScaled,
      uncontrolTicks: 0,
      contactX: target.x,
      contactY: target.y,
    },
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
 * `dealDamageTo`, plus the observation of it (B6).
 *
 * The emit lives HERE rather than inside `dealDamageTo` because only a call site knows its own
 * `DamageSource`, and because `dealDamageTo`'s exported signature is pinned by tests that have
 * nothing to do with this seam. Wrapping is what keeps the seam additive.
 *
 * `killingBlow` is measured across the call (`wasAlive && target.hp === 0`), not inferred
 * afterwards: a car already at 0 coming in is a wreck taking another hit, which is damage but not a
 * kill. `amount` is likewise `before - target.hp`, not the requested `amount` argument —
 * `invulnerable` refuses the hp change while the hit still "happens" (pierce spends, statuses ride),
 * so reporting the requested amount would book damage that was never dealt.
 */
function recordDamage(
  target: CombatPlayer,
  amount: number,
  mods: Readonly<Modifiers>,
  attackerSessionId: string,
  source: DamageSource,
  world: CombatWorld,
  byId: ReadonlyMap<string, CombatPlayer>,
  events: CombatEvents | undefined,
): void {
  const wasAlive = target.hp > 0;
  const before = target.hp;
  dealDamageTo(target, amount, mods, attackerSessionId);
  if (!events) return;

  // `carIdOf` is called on the live player object, matching every other call site in this file
  // (e.g. phase 0e's `attacker ? carIdOf(attacker) : DEFAULT_CAR_ID`), rather than re-normalizing a
  // bare `carId` string pulled off it first.
  const attacker = attackerSessionId === "" ? undefined : byId.get(attackerSessionId);
  const attackerCarId = attacker ? carIdOf(attacker) : null;
  const killingBlow = wasAlive && target.hp === 0;
  events.damaged.push({
    tick: world.tick,
    victimSessionId: target.sessionId,
    victimCarId: carIdOf(target),
    attackerSessionId,
    attackerCarId,
    source,
    amount: before - target.hp,
    killingBlow,
  });
  if (killingBlow) {
    events.killed.push({
      tick: world.tick,
      victimSessionId: target.sessionId,
      victimCarId: carIdOf(target),
      killerSessionId: attackerSessionId,
      killerCarId: attackerCarId,
      source,
    });
  }
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

