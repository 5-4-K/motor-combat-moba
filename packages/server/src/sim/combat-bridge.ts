import {
  WeaponInstanceState,
  WeaponKind,
  WeaponSlotState,
  isCarId,
  newFireState,
  newLockState,
  runCombat,
  slotsOf,
  type ArenaState,
  type CarId,
  type CombatPlayer,
  type CombatResult,
  type FireState,
  type LockState,
  type PlayerState,
  type WeaponInstance,
} from "@motor-combat-moba/shared";

/**
 * The schema half of combat: read `ArenaState` into plain objects, run the pure `runCombat`, write
 * the answer back.
 *
 * The split is deliberate. `runCombat` is where every rule lives and it can be tested without a
 * Colyseus room; this file is the only place that knows about `MapSchema`, and it holds no rules at
 * all. Anything resembling a decision — who may be hit, what a ram costs — belongs on the other side
 * of this boundary, in `@motor-combat-moba/shared`.
 */

/** Room-owned state that lives across ticks but is deliberately never networked. */
export interface CombatMemory {
  /** `"idA|idB"` to the tick that pair may deal ram damage again. Server-only: clients never see it. */
  ramCooldowns: Map<string, number>;
  /** Monotonic across the room's life, so a re-used session id cannot re-use an instance id. */
  instanceSeq: number;
  /** Per-player fire state, and the per-instance damage clocks. Server-only, never networked. */
  fireStates: Map<string, FireState>;
  instances: Map<string, WeaponInstance>;
  /** Per-player target lock. Server-only; only `targetSessionId` is projected onto the schema. */
  locks: Map<string, LockState>;
}

export function newCombatMemory(): CombatMemory {
  return {
    ramCooldowns: new Map(),
    instanceSeq: 0,
    fireStates: new Map(),
    instances: new Map(),
    locks: new Map(),
  };
}

/**
 * Players as combat sees them. Only roster members are marked `inRoster`, which is what gates
 * firing, being hit, and ramming — a lobby player standing in the room is not part of the fight.
 *
 * Fire state is rebuilt whenever a player's chassis changes — including the reveal, where `carId`
 * goes from "" to a real car. Keyed by session id and never networked: the client is told the
 * *result* (stocks, timers) through `WeaponSlotState`, never the machine.
 *
 * `level` is re-read from `PlayerState` on EVERY call, not only when the state is rebuilt.
 * `applyCombatResult` writes `player.level = fireState.level` back unconditionally, so a cached
 * fire state carrying a stale level would overwrite the schema every tick: whoever builds levelling
 * would write `player.level = 2` and watch it revert to 1 on the next tick. D14 promises that
 * making `level` move is the only new work; this is what keeps that true.
 */
export function toCombatPlayers(
  state: ArenaState,
  roster: ReadonlySet<string>,
  masks: ReadonlyMap<string, number>,
  memory: CombatMemory,
): CombatPlayer[] {
  const players: CombatPlayer[] = [];
  state.players.forEach((player, sessionId) => {
    const existing = memory.fireStates.get(sessionId);
    const carId = isCarId(player.carId) ? player.carId : "";
    const stale = !existing || existing.slots.map((s) => s.weaponId).join() !== slotsFor(carId).join();
    const fireState = stale ? newFireState(carId, player.level) : { ...existing, level: player.level };
    memory.fireStates.set(sessionId, fireState);

    // Carried forward rather than rebuilt from the schema: `lockedAtTick` and `losLostSinceTick`
    // have no wire representation, so a rebuild would reset both timers every tick and neither the
    // commit window nor the sight grace could ever elapse.
    const lock = memory.locks.get(sessionId) ?? newLockState();
    memory.locks.set(sessionId, lock);

    players.push({
      sessionId,
      x: player.x,
      y: player.y,
      angle: player.angle,
      team: player.team === 1 ? 1 : 0,
      carId: player.carId,
      hp: player.hp,
      alive: player.alive,
      inRoster: roster.has(sessionId),
      fireMask: masks.get(sessionId) ?? 0,
      fireState,
      lock,
    });
  });
  return players;
}

function slotsFor(carId: CarId | ""): readonly string[] {
  return isCarId(carId) ? slotsOf(carId) : [];
}

/**
 * Live instances come from room memory rather than from the schema: `damageClock`, `pierceLeft` and
 * `distance` are server-only and have no wire representation, so the schema is a projection of this
 * map, never its source.
 */
export function toInstances(memory: CombatMemory): WeaponInstance[] {
  return [...memory.instances.values()];
}

/**
 * Write a combat result back onto the schema.
 *
 * Only the fields combat owns — `hp`, `alive`, and everything `fireState` carries — are copied onto
 * players. Poses are *not* written back: driving already set them this tick, and combat never moves
 * a car.
 *
 * Instances are diffed by id rather than cleared and refilled: a `MapSchema` emptied and repopulated
 * every tick patches every instance to every client every tick, which is precisely the bandwidth the
 * patch rate exists to avoid.
 */
export function applyCombatResult(state: ArenaState, result: CombatResult, memory: CombatMemory): void {
  for (const p of result.players) {
    memory.fireStates.set(p.sessionId, p.fireState);
    memory.locks.set(p.sessionId, p.lock);
    const player = state.players.get(p.sessionId);
    if (!player) continue;
    player.hp = p.hp;
    player.alive = p.alive;
    player.level = p.fireState.level;
    player.switchLockUntilTick = p.fireState.switchLockUntilTick;
    // The two halves of the car-wide lockout the HUD cannot derive from slot rows: a live wind-up or
    // volley, and which slot owns the recovery it is exempt from. `pending` itself stays server-only
    // (like `damageClock` and `pierceLeft`) — only the tick it next fires on crosses the wire.
    player.pendingUntilTick = p.fireState.pending?.nextShotTick ?? 0;
    player.lastFiredSlot = p.fireState.lastFiredSlot;
    player.lockTargetSessionId = p.lock.targetSessionId;
    writeSlots(player, p.fireState);
  }

  memory.instances = new Map(result.instances.map((i) => [i.id, i]));

  const stale: string[] = [];
  state.weapons.forEach((_, id) => {
    if (!memory.instances.has(id)) stale.push(id);
  });
  for (const id of stale) state.weapons.delete(id);

  // Diffed, never cleared and refilled: a collection emptied each tick patches every instance to
  // every client every tick, which is exactly the bandwidth the patch rate exists to avoid.
  for (const instance of result.instances) {
    let row = state.weapons.get(instance.id);
    if (!row) {
      row = new WeaponInstanceState();
      row.id = instance.id;
      row.ownerSessionId = instance.ownerSessionId;
      row.weaponId = instance.weaponId;
      row.kind = instance.kind === "beam" ? WeaponKind.BEAM : WeaponKind.PROJECTILE;
      row.spawnTick = instance.spawnTick;
      state.weapons.set(instance.id, row);
    }
    row.x = instance.x;
    row.y = instance.y;
    row.angle = instance.angle;
    row.extent = instance.extent;
    row.alive = instance.alive;
  }
}

/** Slot rows are positional: index is the slot, so they are resized rather than rebuilt. */
function writeSlots(player: PlayerState, fireState: FireState): void {
  while (player.weapons.length > fireState.slots.length) player.weapons.pop();
  fireState.slots.forEach((slot, index) => {
    let row = player.weapons.at(index);
    if (!row) {
      row = new WeaponSlotState();
      player.weapons.push(row);
    }
    row.weaponId = slot.weaponId;
    row.stocks = slot.stocks;
    row.rechargeEndsTick = slot.rechargeEndsTick;
    row.refireLockUntilTick = slot.refireLockUntilTick;
  });
}

/** Clear every live instance and fire state. Called when a match ends or a new one is set up. */
export function clearInstances(state: ArenaState, memory: CombatMemory): void {
  const ids: string[] = [];
  state.weapons.forEach((_, id) => ids.push(id));
  for (const id of ids) state.weapons.delete(id);
  memory.instances.clear();
  memory.fireStates.clear();
  memory.locks.clear();
  // The schema projection has to be cleared here too, separately from the memory map above: combat
  // only runs in RoomPhase.MATCH, but ArenaScene is on screen from COUNTDOWN onward, and `endMatch`
  // freezes whatever `lockTargetSessionId` was last written. Without this, the second match onward
  // would draw a lock bracket through the whole countdown before a single tick of combat has run
  // (spec A14: no lock survives a match end or setup).
  state.players.forEach((p) => {
    p.lockTargetSessionId = "";
  });
}

export { runCombat };
