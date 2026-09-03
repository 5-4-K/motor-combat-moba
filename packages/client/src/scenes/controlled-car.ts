import type { ArenaState } from "@motor-combat-moba/shared";

/**
 * "Which car am I driving?" and "is the world stopped?", answered for both room kinds at once.
 *
 * The dev-only playground (`PlaygroundState`) adds `controlledSessionId` and `paused` on top of
 * `ArenaState`; every shipped room state has neither. Both reads are therefore written as *optional*
 * field reads with a neutral answer, so a real match resolves to the client's own session and to
 * "not paused" without `ArenaScene` ever asking which room it is in (spec PG7, PG9). That is the
 * whole point of putting them here: the scene gets one seam instead of a room-kind branch at every
 * identity site, and the seam is a pure function this file's test can pin.
 */

/** The session id of the car this client DRIVES. Base ArenaState has no controlledSessionId, so a
 *  real match always resolves to the client's own session (spec PG9). */
export function controlledCarOf(state: ArenaState, ownSessionId: string): string {
  const id = (state as { controlledSessionId?: string }).controlledSessionId;
  return id || ownSessionId;
}

/**
 * Is this room's sim frozen? True for a paused playground AND a paused practice session (spec PR22).
 *
 * Duck-typed off a bare `ArenaState` rather than off either subclass, which is why one predicate
 * covers both rooms: a real match's state has no `paused` field, so this is always false there.
 */
export function isSimPaused(state: ArenaState): boolean {
  return (state as { paused?: boolean }).paused === true;
}
