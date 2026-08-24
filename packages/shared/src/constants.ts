export const TICK_RATE_HZ = 30;
export const MS_PER_TICK = 1000 / TICK_RATE_HZ;
export const MAX_PLAYERS = 6;
export const DEFAULT_PATCH_RATE_HZ = 20;
export const ROOM_NAME = "arena";

export enum RoomPhase {
  LOBBY = 0,
  CAR_SELECT = 1,
  COUNTDOWN = 2,
  MATCH = 3,
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

export type DeployMode = "lan" | "cloud";
