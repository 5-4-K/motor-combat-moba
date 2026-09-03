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

/**
 * One car's fair picture of the world (B15-B18).
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
}): BotView | null {
  const { state, selfSessionId, combat, rng } = args;
  const self = state.players.get(selfSessionId);
  if (!self) return null;

  const arena = getArena(state.arenaId);
  const others: BotCarView[] = [];
  state.players.forEach((player, id) => {
    if (id === selfSessionId) return;
    others.push(carView(player, state.tick));
  });
  // Sorted, for the same reason the sim sorts by sessionId: a bot scanning "the nearest enemy" must
  // break a tie the same way on every replay of the same seed.
  others.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));

  return {
    tick: state.tick,
    self: selfView(self, combat),
    others,
    // Live shots in flight, as drawn — id/owner/weapon/pose only. `toInstances` hands back the sim's
    // own `WeaponInstance`, which also carries `damage`, `ownerTeam`, `pierceLeft`, `damageClock` and
    // `pressId`: server-only bookkeeping a player never sees, so this map drops every one of them
    // rather than spreading the sim object through.
    instances: toInstances(combat).map(instanceView),
    arena: { width: arena.width, height: arena.height, obstacles: arena.obstacles },
    observedFires: args.observedFires ?? [],
    rng,
  };
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
