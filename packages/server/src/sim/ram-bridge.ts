import {
  SLAM_CONFIG,
  SLAM_TICKS,
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
 * Zero the four maneuver fields and set the car's velocity to `exitSpeed` purely forward along its
 * current heading (no lateral component). The one place a dash, a wall-blocked dash, or a slammed
 * charge stops — the bridge writing motion fields is the established ram pattern; combat still
 * never moves a car.
 *
 * This DISCARDS whatever lateral component the car's velocity carried into the call, where the old
 * `player.speed = exitSpeed` scalar assignment left `shoveX`/`shoveY` alone. A wall-blocked dasher
 * (the `endDash(player, 0)` call below) loses any shove it was still carrying, and a slammed charger
 * (the third call, at `restored` below) gets re-pointed straight along its nose. Consistent with this
 * stage's other forward-only choices and revisited in stage 2 when `RamKnock` becomes `Impulse`; not
 * silently swallowed today, just not fixed here.
 */
function endDash(player: PlayerState, exitSpeed: number): void {
  player.maneuver = 0;
  player.maneuverTicksLeft = 0;
  player.maneuverAngle = 0;
  player.maneuverSpeed = 0;
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
      // The FORWARD speed carried INTO this tick, not the one left on `PlayerState` — see
      // `RamCar.speed`'s own comment for why a post-collision read makes the approach term negative.
      speed: approachSpeeds.get(sessionId) ?? forwardOf(player.vx, player.vy, player.angle),
      carId: carIdOf(player),
      massMult: modifiersFor(statusMods, sessionId).ramMass,
      maneuver: player.maneuver,
      maneuverWeaponId,
      stunned: hasStatus(readStatuses(player), "stunned", tick),
      slamsStunned: slamsStunnedOf(maneuverWeaponId),
    });
  });
  return cars;
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
  const { knocks, contacts, events } = resolveContacts(
    cars,
    memory.contacts,
    mode,
    tick,
    immuneMapFrom(memory.slammed),
    arena.obstacles,
    bounds,
  );
  memory.contacts = contacts;

  for (const knock of knocks) {
    const player = state.players.get(knock.sessionId);
    if (!player) continue;
    // TEMPORARY SHIM (stage 1 of the car-physics rework): `RamKnock` still carries `shoveX`/`shoveY`
    // and `authority`, but `PlayerState` no longer has separate fields for them — velocity is just
    // `vx`/`vy` now. Until stage 2 replaces `RamKnock` with a proper `Impulse`, the knock is added
    // straight into the victim's velocity, additively, with no "no rescue" precedence: two knocks
    // landing on the same victim across different ticks now simply stack rather than the weaker one
    // being discarded. `knock.authority` is dropped on the floor entirely — ram control-loss returns
    // as the `reeling` status in stage 3, and until then a rammed car keeps full steering. This is
    // the documented "ramming temporarily degraded" state of this stage; do not invent a stand-in.
    player.angVel = knock.angVel;
    player.vx += knock.shoveX;
    player.vy += knock.shoveY;
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
      // STAGE 4: `SLAM_CONFIG.selfKeepFactor` is deleted along with the rest of `SLAM_CONFIG` once
      // the `ImpulseDef` seam lands — the attacker's cost falls out of equal-and-opposite impulses
      // instead of this hand-tuned fraction.
      const restored =
        (approachSpeeds.get(hit.attackerSessionId)
          ?? forwardOf(attacker.vx, attacker.vy, attacker.angle)) * SLAM_CONFIG.selfKeepFactor;
      endDash(attacker, restored);
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
