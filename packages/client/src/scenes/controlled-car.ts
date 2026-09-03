import { PRACTICE_ROOM_NAME, type ArenaState } from "@motor-combat-moba/shared";

/**
 * "Which car am I driving?", "is the world stopped?", and "is this a practice room?" — answered for
 * every room kind at once (spec PG7, PG9, PR22).
 *
 * The dev-only playground (`PlaygroundState`) adds `controlledSessionId` and `paused` on top of
 * `ArenaState`; the practice room's `PracticeState` adds `paused` too. Every shipped room state has
 * neither, so the first two are written as *optional* field reads with a neutral answer — a real
 * match resolves to the client's own session and to "not paused" without `ArenaScene` ever asking
 * which room it is in. `isPracticeRoom` below is the one function here that deliberately breaks that
 * pattern: see its own comment for why a room-kind check is the *safer* choice for the pause-menu
 * gate specifically.
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

/**
 * Is this a practice room (spec PR22)? Read off the room itself rather than a scene-set flag, which
 * can go stale: practice, exit, then join a real match, and a flag nobody cleared would put a pause
 * menu in a live match. The room's name cannot go stale.
 */
export function isPracticeRoom(room: { name?: string }): boolean {
  return room.name === PRACTICE_ROOM_NAME;
}
