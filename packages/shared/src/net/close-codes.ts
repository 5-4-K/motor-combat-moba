import { PROTOCOL_VERSION } from "../constants.js";

/**
 * Every close / refusal code this game chooses for itself, in ONE place (D5 ruling A).
 *
 * They sit in 4100–4199 because Colyseus 0.18 claims the bottom of the 4000 block for its own
 * `CloseCode` (4000 CONSENTED, 4001 SERVER_SHUTDOWN, 4002 WITH_ERROR, 4003 FAILED_TO_RECONNECT,
 * 4010 MAY_TRY_RECONNECT) and 4217 for `ErrorCode.INVALID_PAYLOAD`. Before D5 the rooms used
 * 4000–4009, so a kick (4002) read as Colyseus's "closed with error" and a second-arena refusal
 * (4003) as "failed to reconnect". `close-codes.test.ts` (server) holds this table clear of both
 * Colyseus enums and free of duplicates.
 *
 * A join refusal (`ServerError` thrown from `onCreate`/`onJoin`) carries its code in the matchmaker
 * error the SDK rejects the join with; a `client.leave(code)` carries it as the socket's close code,
 * which `room.onLeave(code)` receives. The message TEXTS live beside each room, unchanged.
 */
export const CLOSE_CODES = {
  /** ArenaRoom: the name failed `validateName`. */
  NAME_INVALID: 4100,
  /** ArenaRoom: the name is already in the lobby. */
  NAME_TAKEN: 4101,
  /** ArenaRoom: the host kicked this player. */
  KICKED: 4102,
  /** ArenaRoom: a second arena room was refused (the arena is a singleton). */
  ARENA_SINGLETON: 4103,
  /** PlaygroundRoom: an arena has players in it. */
  PLAYGROUND_ARENA_BUSY: 4104,
  /** PlaygroundRoom: a playground or practice session is already live. */
  PLAYGROUND_BUSY: 4105,
  /** PracticeRoom: the session ended for want of input (PR25). */
  PRACTICE_IDLE: 4106,
  /** PracticeRoom: the host is at its practice-room cap. */
  PRACTICE_FULL: 4107,
  /** PracticeRoom: a playground is live. */
  PRACTICE_PLAYGROUND_BUSY: 4108,
  /** PracticeRoom: the join options failed `isPracticeSetup`. */
  PRACTICE_INVALID_SETUP: 4109,
  /** Any room: the client was over a message rate limit for `RATE_LIMIT_KICK_MS` straight (NR54). */
  RATE_LIMITED: 4110,
  /** Any room: the client's `protocol` join option is not this server's `PROTOCOL_VERSION` (NR55). */
  PROTOCOL_MISMATCH: 4111,
} as const;

/** The refusal text for a protocol mismatch (NR55); `undefined` when the join option matches. */
export function protocolRefusal(options: unknown): string | undefined {
  const given =
    options !== null && typeof options === "object" ? (options as Record<string, unknown>).protocol : undefined;
  if (given === PROTOCOL_VERSION) return undefined;
  const shown = typeof given === "number" && Number.isFinite(given) ? String(given) : "none";
  return `Client and server are different versions (client protocol ${shown}, server ${PROTOCOL_VERSION}). Refresh the page.`;
}
