export const TICK_RATE_HZ = 30;
export const MS_PER_TICK = 1000 / TICK_RATE_HZ;
export const MAX_PLAYERS = 6;
/**
 * The most players one team may hold. Deliberately above half of `MAX_PLAYERS`: the spare seats are
 * swap headroom so a full lobby can still rearrange itself, not room for a bigger match. `canStart`
 * still refuses unequal teams, so team mode tops out at 3v3.
 */
export const MAX_TEAM_SIZE = 4;
export const DEFAULT_PATCH_RATE_HZ = 20;
export const ROOM_NAME = "arena";

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

export enum GameMode {
  FFA = 0,
  TEAM = 1,
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
