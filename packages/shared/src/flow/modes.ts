import { GameMode } from "../constants.js";

/**
 * Which side structure this mode uses.
 *
 * This is the axis every pre-existing rule already reads — friendly fire (`canDamage`), spawn
 * assignment (`assignSpawns`) and the living-side count (`livingSides`) all take `"ffa" | "team"`
 * and none of them changed when Deathmatch was added. That is the point of deriving it: Deathmatch
 * IS free-for-all, it just ends differently.
 *
 * Replaces the server-local `toFlowMode`, which answered the same question one package too far out.
 */
export function sidesOf(mode: GameMode): "ffa" | "team" {
  return mode === GameMode.TEAM ? "team" : "ffa";
}

/**
 * What ends the match.
 *
 * The new axis, and deliberately consumed in exactly ONE place — the room's end-of-match check — so
 * that a grep for this function answers "what does the win condition actually change?" completely.
 */
export function winRuleOf(mode: GameMode): "last_standing" | "deathmatch" {
  return mode === GameMode.FFA_DEATHMATCH ? "deathmatch" : "last_standing";
}
