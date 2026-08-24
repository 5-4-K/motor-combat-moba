import { ARENA_01 } from "./arena-01.js";
import type { ArenaDef } from "./types.js";

export const DEFAULT_ARENA_ID = "arena-01";

export function getArena(id: string): ArenaDef {
  if (id === DEFAULT_ARENA_ID) {
    return ARENA_01;
  }
  throw new Error(`Unknown arena: ${id}`);
}
