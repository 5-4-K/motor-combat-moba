import {
  NEUTRAL_MODIFIERS,
  carIdOf,
  modifiersFromRows,
  otherCarHulls,
  type ArenaDef,
  type ContextEntry,
  type ContextPlayer,
  type StatusRow,
  type Modifiers,
  type StepContext,
} from "@motor-combat-moba/shared";

export type { ContextPlayer };

/** Just the roster. The arena is passed in separately so it is not looked up per predicted tick. */
export interface ContextState {
  players: {
    forEach(callback: (player: ContextPlayer, sessionId: string) => void): void;
  };
}

/**
 * The `StepContext` the local car is predicted through. This is the client's half of the lockstep:
 * it must describe the same world `serverTick` describes for the same tick, or prediction diverges
 * and reconciliation spends the match snapping the car back.
 *
 * The parts that must agree — who is solid, how a hull is sized, and the fallback chassis — are not
 * reimplemented here. `carIdOf` and `otherCarHulls` are the *same* shared functions `serverTick`
 * calls, so a P5 change like per-car hull dimensions moves both sides at once. All this function
 * owns is getting the roster into sorted `sessionId` order, because `resolveWorld` resolves contacts
 * sequentially and `MapSchema` iteration order is not stable enough to rely on.
 *
 * Scope note: the `IN_MATCH` filter inside `otherCarHulls` is only the **wall** half of the gate —
 * which players are solid. The **mover** half, whether the local player's inputs may move anything
 * at all, is the caller's: see `ArenaScene.canDrive` and `reconcileLocal`. Calling this function
 * does not by itself gate movement.
 *
 * Remotes enter at their last-known *server* pose. The client predicts only itself, and that is also
 * what the server saw when it built its own `others`.
 */
export function buildStepContext(
  arena: ArenaDef,
  state: ContextState,
  selfSessionId: string,
  modifiers: Readonly<Modifiers>,
): StepContext {
  const entries: ContextEntry[] = [];
  state.players.forEach((player, sessionId) => {
    entries.push({ sessionId, player });
  });
  entries.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));

  const self = entries.find((entry) => entry.sessionId === selfSessionId);

  return {
    // A missing local player still yields a usable context; `carIdOf` supplies the default chassis.
    carId: carIdOf(self?.player ?? { carId: "" }),
    others: otherCarHulls(entries, selfSessionId),
    obstacles: arena.obstacles,
    bounds: { width: arena.width, height: arena.height },
    modifiers,
  };
}

/**
 * The local car's status multipliers, from the rows the server patched onto it.
 *
 * The client's half of the effect layer, and it is deliberately thin: `modifiersFromRows` is the
 * *same* shared function `serverTick` reaches through, so the two sides cannot drift on how a list
 * of effects becomes a set of multipliers — the same rule that keeps `carIdOf` and `otherCarHulls`
 * out of this file. All this adds is reading the rows off the schema and answering neutral for a
 * player who is not in the room yet.
 *
 * `tick` is the state's own tick, not a local clock. A status is active while `tick < endsTick`, so
 * the reading has to be taken on the tick the server is on — and `modifiersFromRows` filters by it
 * independently of the server's sweep, which is what stops a patch arriving one tick late from
 * predicting a slow the server has already dropped.
 */
export function localModifiers(
  state: StatusRowSource,
  selfSessionId: string,
  tick: number,
): Readonly<Modifiers> {
  const rows = state.players.get(selfSessionId)?.statuses;
  if (!rows) return NEUTRAL_MODIFIERS;
  return modifiersFromRows(rows, tick);
}

/**
 * Just enough of `ArenaState` to read one player's status rows. Named for what it supplies rather
 * than after the schema class `StatusState`, which is one row and not a source of them.
 */
export interface StatusRowSource {
  players: { get(sessionId: string): { statuses: Iterable<StatusRow> } | undefined };
}
