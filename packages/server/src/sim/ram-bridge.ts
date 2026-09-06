import {
  SLAM_CONFIG,
  SLAM_TICKS,
  applyImpulse,
  carHullOf,
  carIdOf,
  expireStatusesFromSource,
  forwardMaxSpeedOf,
  forwardOf,
  getArena,
  hasStatus,
  hullTouchesWorld,
  isSolid,
  isWeaponId,
  massOf,
  resolveContacts,
  toWorld,
  weaponDefOf,
  type ArenaState,
  type ContactCar,
  type ContactHit,
  type Modifiers,
  type PlayerState,
  type StatusRequest,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { modifiersFor, readStatuses, writeStatuses } from "./status-bridge.js";

/**
 * The schema half of contact: read `ArenaState` into plain objects, run the pure `resolveContacts`,
 * write the answer back.
 *
 * The split mirrors `combat-bridge.ts`. Every rule lives in `@motor-combat-moba/shared` and can be
 * tested without a Colyseus room; this file knows about `MapSchema` and holds no rules at all.
 *
 * Contact runs between driving and combat, extending what used to be a plain ram tick: a DASH pair
 * reports a hit for combat to price, and a CHARGE pair resolves a hard slam — a fixed knock plus a
 * wall-stun window this bridge tracks in room memory (spec S3, O2/O3/O18). Driving must have
 * resolved first, so contacts are measured against the poses cars actually ended the tick at;
 * combat runs after, reading the `ContactHit`s and `StatusRequest`s this produces.
 */

/** One slammed victim's two independent clocks: the wall-stun window and the re-slam immunity. */
interface SlamRecord {
  bySessionId: string;
  wallStunUntilTick: number;
  immuneUntilTick: number;
}

/** Room-owned state that lives across ticks and is deliberately never networked. */
export interface ContactMemory {
  /** Pairs that were in contact last tick, so contact fires on entry rather than every tick. */
  contacts: Set<string>;
  /** Every car slammed recently enough that either clock below is still running. */
  slammed: Map<string, SlamRecord>;
}

export function newContactMemory(): ContactMemory {
  return { contacts: new Set(), slammed: new Map() };
}

export interface ContactTickResult {
  contactHits: ContactHit[];
  statusRequests: StatusRequest[];
}

/**
 * Reset a player to a neutral rest state: no spin, and — since the vector-drive rework merged
 * ordinary driving velocity and ram shove onto the same two fields — the car's ENTIRE velocity, not
 * merely a "knock" component distinct from it. Correct for the two call sites that use it (a fresh
 * match, a respawn), where the car needs to arrive fully at rest either way; the name and this doc
 * now say more than "knock state" to reflect that.
 *
 * Also clears the four maneuver fields, the same "nothing survives into a fresh match" rule this
 * already applies to ram state: a car must not spawn into the countdown still mid-dash or mid-charge
 * from the match that just ended.
 */
export function clearKnock(player: PlayerState): void {
  player.angVel = 0;
  player.vx = 0;
  player.vy = 0;
  player.maneuver = 0;
  player.maneuverTicksLeft = 0;
  player.maneuverAngle = 0;
  player.maneuverSpeed = 0;
}

/**
 * Zero the four maneuver fields alone, touching no velocity. Split out of `endDash` (below) for the
 * slam-attacker case (Task 4): that car's post-slam velocity is written by the impulses loop's
 * `entry.attackerImpulse`, in the same pass that resolves every other impulse this tick — as of
 * stage 3 Task 2 (the ram contest) a slam's `attackerImpulse` is a deliberate zero-magnitude
 * `Impulse` (a slam is authored, not contested, so the attacker takes nothing from its own hit), not
 * an equal-and-opposite reaction to the victim's push. A maneuver end must not stomp that outcome
 * back to a forced-forward speed the way `endDash` deliberately does for a dash. Order between the
 * two writes does not matter — they touch disjoint fields.
 */
function endManeuverOnly(player: PlayerState): void {
  player.maneuver = 0;
  player.maneuverTicksLeft = 0;
  player.maneuverAngle = 0;
  player.maneuverSpeed = 0;
}

/**
 * Zero the four maneuver fields and set the car's velocity to `exitSpeed` purely forward along its
 * current heading (no lateral component). The one place a dash or a wall-blocked dash stops — the
 * bridge writing motion fields is the established ram pattern; combat still never moves a car.
 *
 * This DISCARDS whatever lateral component the car's velocity carried into the call. A wall-blocked
 * dasher (the `endDash(player, 0)` call below) loses any push it was still carrying; a dash that
 * lands its one hit exits at the drive model's cap. Neither of those two cases is Impulse-driven —
 * a dash carries no `Impulse` at all (spec: it reports a `ContactHit` and combat prices the damage),
 * so there is no reaction to preserve here the way there is for a slam's attacker (`endManeuverOnly`
 * above).
 */
function endDash(player: PlayerState, exitSpeed: number): void {
  endManeuverOnly(player);
  const v = toWorld(player.angle, exitSpeed, 0);
  player.vx = v.vx;
  player.vy = v.vy;
}

/** May this weapon's hard slam land on an already-stunned victim (O3)? `false` off any non-charge id. */
function slamsStunnedOf(weaponId: WeaponId | ""): boolean {
  if (!isWeaponId(weaponId)) return false;
  const def = weaponDefOf(weaponId);
  return def.kind === "maneuver" && def.maneuver.type === "charge" ? def.maneuver.slamsStunned : false;
}

function immuneMapFrom(slammed: ReadonlyMap<string, SlamRecord>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [victimId, entry] of slammed) out.set(victimId, entry.immuneUntilTick);
  return out;
}

/**
 * Only living roster members who are `isSolid` can contact or be contacted. A lobby player standing
 * in the room is not part of the fight. A wreck is no longer merely "scenery that still collides" —
 * it is not solid either, the same as a lobby player — and neither, now, is a car mid-phase (M14): a
 * respawning car is driveable but must pass through everyone without dealing or taking a ram, a
 * slam, or a dash hit.
 */
function contactCarsOf(
  state: ArenaState,
  roster: ReadonlySet<string>,
  statusMods: ReadonlyMap<string, Modifiers>,
  approachSpeeds: ReadonlyMap<string, number>,
  maneuverWeapons: ReadonlyMap<string, WeaponId | "">,
  tick: number,
): ContactCar[] {
  const cars: ContactCar[] = [];
  state.players.forEach((player, sessionId) => {
    if (!roster.has(sessionId)) return;
    if (!isSolid(player, tick)) return;
    const maneuverWeaponId = maneuverWeapons.get(sessionId) ?? "";
    cars.push({
      sessionId,
      team: player.team === 1 ? 1 : 0,
      x: player.x,
      y: player.y,
      angle: player.angle,
      // Stage 3 Task 2 shim: `approachSpeeds` still carries only the PRE-COLLISION forward
      // component. Task 4 widens `TickResult` to `approachVelocities` and this reconstruction goes
      // away; until then a purely-forward rebuild is exactly what the old scalar meant.
      ...toWorld(player.angle, approachSpeeds.get(sessionId) ?? forwardOf(player.vx, player.vy, player.angle), 0),
      carId: carIdOf(player),
      defenceMult: modifiersFor(statusMods, sessionId).ramMass,
      maneuver: player.maneuver,
      maneuverWeaponId,
      stunned: hasStatus(readStatuses(player), "stunned", tick),
      slamsStunned: slamsStunnedOf(maneuverWeaponId),
    });
  });
  return cars;
}

/**
 * This player's mass as `applyImpulse` sees it: chassis rating scaled by whatever `ramMass` effect
 * it carries. Both ram impulses are `defenceScaled: false` (the contest already divided by
 * `ramDefence`), so this value only reaches `applyImpulse`'s `nextSpin` inertia term today — Task 3/4
 * rename this function and its `mass` role once `mass` itself leaves the game. `0` for a session
 * with no player, which `massFactorOf` (`sim/impulse.ts`) treats as "unscaled" rather than dividing
 * by it.
 */
function massFor(state: ArenaState, statusMods: ReadonlyMap<string, Modifiers>, sessionId: string): number {
  const player = state.players.get(sessionId);
  if (!player) return 0;
  return massOf(carIdOf(player)) * modifiersFor(statusMods, sessionId).ramMass;
}

/**
 * `approachSpeeds` comes from `serverTick`'s `TickResult`: each car's FORWARD speed as it entered
 * the tick, before `resolveWorld` could reflect it. It is a required parameter rather than an
 * optional one with a `forwardOf(player.vx, player.vy, player.angle)` default, deliberately — a
 * default here would silently reinstate the trigger bug for any caller that forgot it, and the
 * failure mode is a ram that fires on 8-20% of contacts rather than an error anyone would notice.
 */
export function contactTick(
  state: ArenaState,
  roster: ReadonlySet<string>,
  memory: ContactMemory,
  mode: "ffa" | "team",
  statusMods: ReadonlyMap<string, Modifiers>,
  approachSpeeds: ReadonlyMap<string, number>,
  maneuverWeapons: ReadonlyMap<string, WeaponId | "">,
  tick: number,
): ContactTickResult {
  const arena = getArena(state.arenaId);
  const bounds = { width: arena.width, height: arena.height };

  const cars = contactCarsOf(state, roster, statusMods, approachSpeeds, maneuverWeapons, tick);
  const { impulses, contacts, events } = resolveContacts(
    cars,
    memory.contacts,
    mode,
    tick,
    immuneMapFrom(memory.slammed),
    arena.obstacles,
    bounds,
  );
  memory.contacts = contacts;

  // Stage 3 Task 2 (car-physics rework): both halves of the pair land through `Impulse` now, EACH
  // computed independently by the contest (spec R7) rather than one being a negated, mass-scaled
  // copy of the other. `impulses` is keyed by VICTIM id and carries `attackerId` alongside both
  // resolved pushes (`ImpulseEntry.impulse`/`attackerImpulse`) — no separate lookup is needed to
  // find who threw it, since only `resolveContacts`'s own pair loop is in a position to say. The
  // victim receives `entry.impulse`; the attacker receives `entry.attackerImpulse` directly —
  // `reactionOf` (still defined in `sim/impulse.ts`) is dead code on this path as of this task,
  // because handing the attacker a negated copy of a contest-derived impulse would be incoherent
  // (the contest already decided what the attacker takes, independently of what the victim took).
  // Task 3 deletes `reactionOf` outright. This also replaces `SLAM_CONFIG.selfKeepFactor`'s
  // hand-tuned forward-only restore for a slam's attacker outright: a slam's `attackerImpulse` is a
  // zero-magnitude `Impulse` built by `contact.ts`'s slam branch, riding through this exact same map,
  // so "the attacker takes nothing from its own slam" falls out of applying it rather than being a
  // separate rule in the `events.slams` loop below (see `endManeuverOnly`'s own comment).
  //
  // `knock.authority` had no successor and none is invented here (this task's scope note): ram
  // control-loss returns as the `reeling` status in stage 3b, and until then a rammed car keeps full
  // steering, exactly as the stage-1 shim already left it.
  for (const [victimId, entry] of impulses) {
    const victim = state.players.get(victimId);
    if (victim) {
      const next = applyImpulse(victim, massFor(state, statusMods, victimId), entry.impulse);
      victim.vx = next.vx;
      victim.vy = next.vy;
      victim.angVel = next.angVel;
    }

    const attacker = state.players.get(entry.attackerId);
    if (attacker) {
      const next = applyImpulse(attacker, massFor(state, statusMods, entry.attackerId), entry.attackerImpulse);
      attacker.vx = next.vx;
      attacker.vy = next.vy;
      attacker.angVel = next.angVel;
    }
  }

  // A dash into a wall exits stopped, not at cap.
  for (const sessionId of events.wallBlockedDashers) {
    const player = state.players.get(sessionId);
    if (player) endDash(player, 0);
  }

  const contactHits: ContactHit[] = [];

  // One target per dash (O12): only the FIRST hit a dasher lands this tick counts, and the dash ends
  // there — a dasher that clips two cars in the same tick does not get to hit both. `events.dashHits`
  // is produced by `resolvePair`'s per-pair loop, so a dasher touching several cars at once can
  // appear more than once here; every entry after the first for a given attacker is dropped.
  const dashedThisTick = new Set<string>();
  for (const hit of events.dashHits) {
    if (dashedThisTick.has(hit.attackerSessionId)) continue;
    dashedThisTick.add(hit.attackerSessionId);
    const attacker = state.players.get(hit.attackerSessionId);
    if (attacker) {
      // Exit at the drive model's cap, the same way natural dash expiry does — not the unmodified
      // rating, so a dash that ends on a hit while `topSpeed` is debuffed (or buffed) exits at the
      // speed the car would actually be capped to that tick.
      const mods = modifiersFor(statusMods, hit.attackerSessionId);
      endDash(attacker, forwardMaxSpeedOf(carIdOf(attacker)) * mods.topSpeed);
    }
    contactHits.push(hit);
  }

  for (const hit of events.slams) {
    memory.slammed.set(hit.targetSessionId, {
      bySessionId: hit.attackerSessionId,
      wallStunUntilTick: tick + SLAM_TICKS.wallStunWindow,
      immuneUntilTick: tick + SLAM_TICKS.reslamImmunity,
    });
    const attacker = state.players.get(hit.attackerSessionId);
    if (attacker) {
      // O2: the charge ends on its first slam, taking its own self-applied statuses with it — a
      // power whose window closes early cannot leave a buff running past the thing that ended it.
      // Velocity is NOT touched here (Task 4, and unchanged by stage 3 Task 2): the impulses loop
      // above already applied this attacker's `attackerImpulse` for this exact slam — a
      // zero-magnitude `Impulse`, not a Newton's-third-law reaction to the victim's push, so it
      // changes nothing. `SLAM_CONFIG.selfKeepFactor`'s hand-tuned forward-only restore is gone,
      // replaced outright rather than reproduced. Only the maneuver fields need clearing, so
      // `endManeuverOnly` rather than `endDash`.
      endManeuverOnly(attacker);
      writeStatuses(
        attacker,
        expireStatusesFromSource(readStatuses(attacker), hit.attackerSessionId, tick),
      );
    }
    contactHits.push(hit);
  }

  // Wall-stun sweep (O2 window): a car shoved by a slam that lands against level geometry within
  // `SLAM_TICKS.wallStunWindow` stuns once. Immunity and the stun window are independent clocks —
  // the stun firing closes only its own window, so re-slam immunity keeps running underneath it.
  const statusRequests: StatusRequest[] = [];
  for (const [victimId, entry] of [...memory.slammed]) {
    if (tick >= entry.wallStunUntilTick && tick >= entry.immuneUntilTick) {
      memory.slammed.delete(victimId);
      continue;
    }
    if (tick >= entry.wallStunUntilTick) continue;
    // `isSolid`, not `isOnField`: a victim who died and respawned phased inside the window is not
    // in the world (M13/M14), and spawn protection must not be broken by a stun from the old life.
    const player = state.players.get(victimId);
    if (!player || !isSolid(player, tick)) continue;
    if (!hullTouchesWorld(carHullOf(player.x, player.y, player.angle), arena.obstacles, bounds, SLAM_CONFIG.wallContactPad)) {
      continue;
    }
    statusRequests.push({
      targetSessionId: victimId,
      statusId: "stunned",
      durationTicks: SLAM_TICKS.wallStunDuration,
      sourceSessionId: entry.bySessionId,
    });
    // Closes THIS window only, so the stun fires once per slam; immunity keeps its own clock.
    entry.wallStunUntilTick = tick;
  }

  return { contactHits, statusRequests };
}
