export const TICK_RATE_HZ = 60;
export const MS_PER_TICK = 1000 / TICK_RATE_HZ;
/**
 * How often the server broadcasts a snapshot (NR12). Must divide `TICK_RATE_HZ`. A snapshot is the
 * state of exactly one tick and carries that tick; no client code may assume one per tick (hard
 * invariant 5).
 */
export const SNAPSHOT_RATE_HZ = 60;
export const MAX_PLAYERS = 6;
/**
 * The most players one team may hold. Deliberately above half of `MAX_PLAYERS`: the spare seats are
 * swap headroom so a full lobby can still rearrange itself, not room for a bigger match. `canStart`
 * still refuses unequal teams, so team mode tops out at 3v3.
 */
export const MAX_TEAM_SIZE = 4;
export const ROOM_NAME = "arena";
/**
 * The wire protocol's version (NR55), sent by every client as the `protocol` join option and refused
 * on mismatch. Bumped by every wire change: a new or changed message, a schema field, or a changed
 * meaning of one. 1 is the Phase D wire (tick-stamped input frames, `MSG_TIME`/`MSG_PING`,
 * `inputSlack` and `inputSlackStd`); a client older than it sends no `protocol` at all. 2 adds
 * `PlayerState.lastSteer`/`lastThrottle` (NR33). 3 gives every input frame's `viewTick` a meaning:
 * the server prices a press's shot compensation from it (NR35, NR36). 4 appends
 * `WeaponInstanceState.lifeOffsetTicks`, a compensated shot's age beyond its `spawnTick` (NR37).
 */
export const PROTOCOL_VERSION = 4;

export enum RoomPhase {
  LOBBY = 0,
  CAR_SELECT = 1,
  COUNTDOWN = 2,
  MATCH = 3,
  /**
   * The "cars locked in" grid, between car select and the countdown. Appended with an explicit 4
   * rather than slotted in after CAR_SELECT: these values are wire format, and renumbering COUNTDOWN
   * or MATCH would silently repoint every client that had not been rebuilt.
   */
  REVEAL = 4,
}

/**
 * What kind of match this is. Two axes flattened into one list, because Deathmatch is FFA-only:
 * `rulesOf(mode).sides` answers "who is on whose side" and `rulesOf(mode).winRuleLabel` answers
 * "what ends the match" (M1, GM14).
 *
 * `FFA_LAST_STANDING` was called `FFA` before 2026-09-01. That was a source rename and the wire
 * value is unchanged — renumbering would silently repoint every client that had not been rebuilt.
 */
export enum GameMode {
  FFA_LAST_STANDING = 0,
  TEAM = 1,
  FFA_DEATHMATCH = 2,
  CONQUER = 3,
}

export enum PlayerStatus {
  READY = 0,
  IN_MATCH = 1,
  POST_MATCH = 2,
}

/** Wire discriminant for a live weapon instance. Explicit and stable — never renumber. */
export enum WeaponKind {
  PROJECTILE = 0,
  BEAM = 1,
}

export type DeployMode = "lan" | "cloud";
