import { ARENA_01 } from "./arena-01.js";
import type { ArenaDef } from "./types.js";

/**
 * Every arena the build knows about. Adding one is a new `arena-0N.ts` plus a row here; which of
 * them the game actually plays is `ACTIVE_ARENA_ID` in `config/arena-config.ts`.
 *
 * Registered arenas that are not active still cost the bundle their layout data — a few hundred
 * bytes of rects. Their *art* is what the release prunes, which is where the weight is.
 */
export const ARENAS = {
  "arena-01": ARENA_01,
} as const;

export type ArenaId = keyof typeof ARENAS;

/** Registered ids, for error messages and for iterating the registry. */
export const ARENA_IDS: readonly string[] = Object.keys(ARENAS);

/**
 * `Object.hasOwn` rather than `id in ARENAS`: `arenaId` arrives off the wire, so `"toString"` and
 * `"__proto__"` are reachable strings, and `in` would answer true for both. Same caution `isCarId`
 * and the manifest parser already take.
 */
export function isArenaId(id: string): id is ArenaId {
  return Object.hasOwn(ARENAS, id);
}

/**
 * Throws on an unknown id rather than falling back. This is called from the server's sim path, where
 * an unresolvable arena is a programming error with no sane default — silently simulating a
 * different arena than the one in state is strictly worse than stopping. The client checks
 * `isArenaId` first and renders a mismatch message instead of calling this.
 */
export function getArena(id: string): ArenaDef {
  if (!isArenaId(id)) {
    throw new Error(`Unknown arena: ${id}. Registered: ${ARENA_IDS.join(", ")}`);
  }
  return ARENAS[id];
}
