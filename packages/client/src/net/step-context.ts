import {
  carIdOf,
  otherCarHulls,
  type ArenaDef,
  type ContextEntry,
  type ContextPlayer,
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
  };
}
