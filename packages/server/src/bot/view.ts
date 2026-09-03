import {
  carIdOf, getArena, hasStatus, hpOf, weaponDefOf,
  type ArenaState, type FiredEvent, type PlayerState, type WeaponInstance,
} from "@motor-combat-moba/shared";
import { toInstances, type CombatMemory } from "../sim/combat-bridge.js";
// `readStatuses` is the SERVER's status bridge, not shared: it is the only file that maps
// `PlayerState.statuses` onto the sim's `ActiveStatus[]`, and it lives beside the other bridges.
import { readStatuses } from "../sim/status-bridge.js";
import type { Rng } from "./rng.js";
import type { BotCarView, BotInstanceView, BotSelfView, BotView } from "./types.js";
import type { ViewRing, WorldSnapshot } from "./view-ring.js";

/**
 * One car's fair picture of the world (B15-B19).
 *
 * Built fresh per decision rather than cached: it is a projection of mutable room state, and a view
 * held across a tick would describe a world that has moved.
 */
export function buildBotView(args: {
  state: ArenaState;
  selfSessionId: string;
  combat: CombatMemory;
  rng: Rng;
  observedFires?: readonly FiredEvent[];
  /**
   * View staleness (B19): how many ticks old the world OTHER cars and instances are drawn from is —
   * models the 20 Hz patch rate plus ping. 0 (the default, and every profile's value in this work)
   * takes the EXACT path this function had before the knob existed: `liveCars`/`liveInstances`
   * straight off `state`/`combat`, no ring lookup, no ring required at all.
   */
  stalenessTicks?: number;
  /**
   * Where past ticks' worlds live, when `stalenessTicks` is nonzero. Owned by the HOST (one ring per
   * match, pushed once per tick via `snapshotWorld`) — never constructed here, because the same
   * snapshot is shared across every bot deciding this tick. Ignored when `stalenessTicks` is 0.
   */
  ring?: ViewRing;
}): BotView | null {
  const { state, selfSessionId, combat, rng } = args;
  const self = state.players.get(selfSessionId);
  if (!self) return null;

  const arena = getArena(state.arenaId);
  const staleness = args.stalenessTicks ?? 0;

  let cars: readonly BotCarView[];
  let instances: readonly BotInstanceView[];
  if (staleness > 0 && args.ring) {
    // The world other cars are drawn from is `staleness` ticks old. Falls back to live when the
    // ring has nothing that old yet (the match's first few ticks) — "no patch has arrived yet" is
    // not the same as "nothing is visible"; a human's most recent patch there is simply this
    // match's very first one.
    const snap = args.ring.at(state.tick - staleness);
    cars = snap ? snap.cars : liveCars(state);
    instances = snap ? snap.instances : liveInstances(combat);
  } else {
    // The exact path this function always took before the knob existed: no ring touched, no lookup,
    // no allocation beyond what `liveCars`/`liveInstances` themselves do (same as before).
    cars = liveCars(state);
    instances = liveInstances(combat);
  }

  const others = cars.filter((car) => car.sessionId !== selfSessionId);

  return {
    tick: state.tick,
    self: selfView(self, combat),
    others,
    instances,
    arena: { width: arena.width, height: arena.height, obstacles: arena.obstacles },
    observedFires: args.observedFires ?? [],
    rng,
  };
}

/**
 * This tick's world, for a host that wants to push it into a `ViewRing` (B19). Exactly the two
 * pieces `buildBotView` computes fresh every call when `stalenessTicks` is 0 — a host opting into
 * staleness calls this once per tick (not once per bot) and `ring.push`es the result.
 */
export function snapshotWorld(state: ArenaState, combat: CombatMemory): WorldSnapshot {
  return { tick: state.tick, cars: liveCars(state), instances: liveInstances(combat) };
}

/** Every car, live off `state`, sorted by sessionId. The bot's own car is included — callers that
 * want "others" filter it out at read time, because which car is "self" depends on who is asking. */
function liveCars(state: ArenaState): BotCarView[] {
  const cars: BotCarView[] = [];
  state.players.forEach((player) => cars.push(carView(player, state.tick)));
  // Sorted, for the same reason the sim sorts by sessionId: a bot scanning "the nearest enemy" must
  // break a tie the same way on every replay of the same seed.
  cars.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  return cars;
}

/** Every live shot, drawn — see `instanceView` for what is deliberately dropped. */
function liveInstances(combat: CombatMemory): BotInstanceView[] {
  return toInstances(combat).map(instanceView);
}

function selfView(player: PlayerState, combat: CombatMemory): BotSelfView {
  const carId = carIdOf(player);
  const fireState = combat.fireStates.get(player.sessionId);
  return {
    sessionId: player.sessionId,
    carId,
    team: player.team as 0 | 1,
    x: player.x, y: player.y, angle: player.angle, speed: player.speed,
    hp: player.hp,
    maxHp: hpOf(carId),
    alive: player.alive,
    statuses: readStatuses(player),
    slots: (fireState?.slots ?? []).map((slot) => ({
      weaponId: slot.weaponId,
      stocks: slot.stocks,
      rechargeEndsTick: slot.rechargeEndsTick,
      refireLockUntilTick: slot.refireLockUntilTick,
      range: weaponDefOf(slot.weaponId).range,
    })),
    switchLockUntilTick: fireState?.switchLockUntilTick ?? 0,
    lockTargetSessionId: player.lockTargetSessionId,
    maneuver: player.maneuver,
    maneuverTicksLeft: player.maneuverTicksLeft,
  };
}

/**
 * Another car, drawn.
 *
 * Note what is NOT read here: no `FireState` from `CombatMemory`, no `lastDamagerSessionId`, no
 * lock internals. `phased` IS read, because spawn protection is drawn on screen — and because a bot
 * that shoots at a car it cannot hit would corrupt exactly the accuracy statistics this exists to
 * produce (B28a).
 */
function carView(player: PlayerState, tick: number): BotCarView {
  const carId = carIdOf(player);
  const statuses = readStatuses(player);
  return {
    sessionId: player.sessionId,
    carId,
    team: player.team as 0 | 1,
    x: player.x, y: player.y, angle: player.angle, speed: player.speed,
    hp: player.hp,
    maxHp: hpOf(carId),
    alive: player.alive,
    phased: hasStatus(statuses, "phased", tick),
    statuses,
    maneuver: player.maneuver,
  };
}

/**
 * A live shot, drawn.
 *
 * `WeaponInstance` also carries `damage`, `ownerTeam`, `pierceLeft`, `damageClock` and `pressId` —
 * sim-only bookkeeping that never reaches the wire and that a player has no way to see. `pressId`
 * in particular would hand the bot a cross-reference no human has: the same id that names which
 * press this shot came from also appears on `observedFires`, so keeping it here would let a bot
 * link "the shot I'm dodging" to "the press I watched" by string equality instead of by eye.
 */
function instanceView(instance: WeaponInstance): BotInstanceView {
  return {
    id: instance.id,
    ownerSessionId: instance.ownerSessionId,
    weaponId: instance.weaponId,
    x: instance.x,
    y: instance.y,
    angle: instance.angle,
  };
}
