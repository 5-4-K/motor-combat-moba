import {
  NEUTRAL_MODIFIERS,
  StatusState,
  expireStatuses,
  modifiersOf,
  toActiveStatuses,
  type ActiveStatus,
  type ArenaState,
  type Modifiers,
  type PlayerState,
} from "@motor-combat-moba/shared";

/**
 * The schema half of statuses: read `PlayerState.statuses` into plain objects, run the pure expiry,
 * write the answer back, and hand every other tick phase the modifiers it needs.
 *
 * The split mirrors `ram-bridge.ts` and `combat-bridge.ts`. Every rule lives in
 * `@motor-combat-moba/shared` and can be tested without a Colyseus room; this file knows about
 * `ArraySchema` and holds no rules at all.
 *
 * Unlike those two, this bridge owns no room memory. A status has no server-only half — the list on
 * the schema IS the state, because the client has to hold the same list to predict the same car
 * through `stepSim`. That is the difference between a status and a `FireState`: the fire machine's
 * rules are the server's business and the client is told only the result, whereas a status's rules
 * are read by both halves of the lockstep.
 *
 * `statusTick` runs FIRST in the room tick, before driving, ramming or combat — see `ArenaRoom.tick`.
 */

/** One player's statuses as the sim sees them, validated off the wire. */
export function readStatuses(player: PlayerState): ActiveStatus[] {
  return toActiveStatuses(player.statuses);
}

/**
 * Project a status list back onto the schema.
 *
 * Rows are positional and resized rather than rebuilt, exactly as `writeSlots` handles weapon slots:
 * an `ArraySchema` emptied and refilled patches every row to every client every tick, which is
 * precisely the bandwidth the patch rate exists to avoid. `applyStatus` keeps the list sorted by
 * `statusId`, so a stable set of statuses writes stable rows and produces no patch at all.
 */
export function writeStatuses(player: PlayerState, statuses: readonly ActiveStatus[]): void {
  while (player.statuses.length > statuses.length) player.statuses.pop();
  statuses.forEach((status, index) => {
    let row = player.statuses.at(index);
    if (!row) {
      row = new StatusState();
      player.statuses.push(row);
    }
    row.statusId = status.statusId;
    row.startTick = status.startTick;
    row.endsTick = status.endsTick;
    row.sourceSessionId = status.sourceSessionId;
  });
}

/** Every status gone at once. A new match, a fresh spawn — anything that is not "it ran out". */
export function clearPlayerStatuses(player: PlayerState): void {
  while (player.statuses.length > 0) player.statuses.pop();
}

/**
 * Sweep every player's expired statuses and return the modifiers the rest of the tick reads.
 *
 * Expiry happens here, once, before anything reads a modifier: driving, ramming and combat all see
 * the same list, so a tick can never simulate a status whose last tick was the previous one, and no
 * two phases can disagree about whether a car is still slowed.
 *
 * A player in no status is not written to and is not given an entry — `modifiersFor` below falls
 * back to the shared frozen `NEUTRAL_MODIFIERS`, so the common case costs one array read and
 * allocates nothing. The schema is only touched when something actually lapsed, because rewriting an
 * `ArraySchema` patches it whether or not its contents changed.
 */
export function statusTick(state: ArenaState, tick: number): Map<string, Modifiers> {
  const mods = new Map<string, Modifiers>();
  state.players.forEach((player, sessionId) => {
    if (player.statuses.length === 0) return;
    const before = readStatuses(player);
    const after = expireStatuses(before, tick);
    if (after !== before) writeStatuses(player, after);
    if (after.length === 0) return;
    mods.set(sessionId, modifiersOf(after, tick));
  });
  return mods;
}

/** This player's modifiers, or the shared neutral set when they are in no status. */
export function modifiersFor(
  mods: ReadonlyMap<string, Modifiers>,
  sessionId: string,
): Readonly<Modifiers> {
  return mods.get(sessionId) ?? NEUTRAL_MODIFIERS;
}
