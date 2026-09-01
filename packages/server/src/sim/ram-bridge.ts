import {
  SLAM_CONFIG,
  SLAM_TICKS,
  carHullOf,
  carIdOf,
  expireStatusesFromSource,
  forwardMaxSpeedOf,
  getArena,
  hasStatus,
  hullTouchesWorld,
  isSolid,
  isWeaponId,
  resolveContacts,
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
 * Reset a player's knock state to neutral. `authority` is 1 at rest, not 0.
 *
 * Also clears the four maneuver fields, the same "nothing survives into a fresh match" rule this
 * already applies to ram state: a car must not spawn into the countdown still mid-dash or mid-charge
 * from the match that just ended.
 */
export function clearKnock(player: PlayerState): void {
  player.angVel = 0;
  player.shoveX = 0;
  player.shoveY = 0;
  player.authority = 1;
  player.maneuver = 0;
  player.maneuverTicksLeft = 0;
  player.maneuverAngle = 0;
  player.maneuverSpeed = 0;
}

/**
 * Zero the four maneuver fields and set `player.speed` to the given exit speed. The one place a
 * dash, a wall-blocked dash, or a slammed charge stops — the bridge writing motion fields is the
 * established ram pattern; combat still never moves a car.
 */
function endDash(player: PlayerState, exitSpeed: number): void {
  player.maneuver = 0;
  player.maneuverTicksLeft = 0;
  player.maneuverAngle = 0;
  player.maneuverSpeed = 0;
  player.speed = exitSpeed;
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
      // The speed carried INTO this tick, not the one left on `PlayerState` — see `RamCar.speed`'s
      // own comment for why a post-collision read makes the approach term negative.
      speed: approachSpeeds.get(sessionId) ?? player.speed,
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
 * `approachSpeeds` comes from `serverTick`'s `TickResult`: each car's speed as it entered the tick,
 * before `resolveWorld` could reflect it. It is a required parameter rather than an optional one
 * with a `player.speed` default, deliberately — a default here would silently reinstate the trigger
 * bug for any caller that forgot it, and the failure mode is a ram that fires on 8-20% of contacts
 * rather than an error anyone would notice.
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
    // Only a harder knock may overwrite a standing one — see `RamMemory`'s (now `ContactMemory`'s)
    // predecessor comment in git history for the full "no rescue" rationale; unchanged here.
    if (knock.authority >= player.authority) continue;
    player.angVel = knock.angVel;
    player.shoveX = knock.shoveX;
    player.shoveY = knock.shoveY;
    player.authority = knock.authority;
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
      const restored =
        (approachSpeeds.get(hit.attackerSessionId) ?? attacker.speed) * SLAM_CONFIG.selfKeepFactor;
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
