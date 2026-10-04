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
 * `WeaponInstanceState.lifeOffsetTicks`, a compensated shot's age beyond its `spawnTick` (NR37). 5
 * gives `WeaponInstanceState.alive: false` a meaning: a shot that ended on its own birth tick (at the
 * muzzle or inside its fast-forward) is sent for `endedShotRowMs` as an ended row at its end pose. 6
 * tags the schema for interest management (NR42, NR52): car state, `statuses` and the instance map
 * are `@view()`, the owner-only fields and slot timers `@view(VIEW_OWNER)`, `PlayerState.inView` is
 * appended, and pose, velocity, the maneuver angle and speed and `turretAngle` go out as `float32`.
 * 7 adds `MSG_SPECTATE_TARGET` (a spectating wreck names the car it shows, NR45) and gives the view
 * tags their meaning: under a mode's FOV the server sends an enemy's car state and shots only while
 * the enemy is (nearly) in the viewer's vision (NR44–NR47); a server of 6 would kick the new message
 * as an unknown type. 8 makes `alive: false` the ONLY way a shot ends on the wire (G5): the server
 * writes every ending — not only a birth-tick one — onto the shot's row as an ENDED row for
 * `endedShotRowMs`, and a client draws an impact only from one (`isShotEnding`); a row that vanishes
 * has merely left the view, so a client of 7 would draw no impact for any shot that lived.
 */
export const PROTOCOL_VERSION = 8;

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
