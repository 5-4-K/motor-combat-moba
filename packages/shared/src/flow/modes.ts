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
 *
 * **An exhaustive `switch`, not an `if` (2026-09-23).** Neither this nor `winRuleOf` below is part
 * of a mode's bundle — they are the two mode-shaped facts that live in code — so an `if` chain made
 * a new `GameMode` value default to FFA last-standing SILENTLY, with no compile error and no test.
 * `GameMode` is a plain numeric TS enum, so the `never` assignment in `default` is a real
 * exhaustiveness check: adding an enum value stops this file compiling until someone decides which
 * side structure and which win rule it plays under. See `.claude/skills/game-mode/SKILL.md` step 4.
 *
 * **Why `default` still RETURNS a value rather than returning `_never`.** `mode` is not always a
 * value this build authored: the client reads `room.state.mode` as a uint8 off the wire, and
 * `balance/report.ts` reads one out of a baseline `run.json` off disk. Both can hold a byte naming
 * a mode this build does not have. Returning `_never` would hand that byte straight back as the
 * answer (it is the same variable), so the default keeps the fallback these two functions have
 * always served — the `never` assignment above it is what makes the AUTHORED case a compile error,
 * which is all it was ever there to do.
 */
export function sidesOf(mode: GameMode): "ffa" | "team" {
  switch (mode) {
    case GameMode.FFA_LAST_STANDING:
      return "ffa";
    case GameMode.FFA_DEATHMATCH:
      return "ffa";
    case GameMode.TEAM:
      return "team";
    case GameMode.CONQUER:
      return "team";
    default: {
      const _never: never = mode;
      void _never;
      return "ffa";
    }
  }
}

/**
 * What ends the match.
 *
 * The new axis, and deliberately consumed in exactly ONE place — the room's end-of-match check — so
 * that a grep for this function answers "what does the win condition actually change?" completely.
 *
 * Exhaustive for the same reason `sidesOf` is, and with the same wire-byte fallback — see above.
 */
export function winRuleOf(mode: GameMode): "last_standing" | "deathmatch" | "conquer" {
  switch (mode) {
    case GameMode.FFA_DEATHMATCH:
      return "deathmatch";
    case GameMode.FFA_LAST_STANDING:
      return "last_standing";
    case GameMode.TEAM:
      return "last_standing";
    case GameMode.CONQUER:
      return "conquer";
    default: {
      const _never: never = mode;
      void _never;
      return "last_standing";
    }
  }
}

/**
 * Whether a dead car comes back (CQ15). The question every "=== 'deathmatch'" check that gated
 * respawning, the phase sweep, the match clock, the no-spectate rule or the "Respawning in N" text
 * was really asking. Sites that mean "kills decide the match" keep asking `winRuleOf` instead.
 *
 * Exhaustive for the same reason `sidesOf` is, and with the same wire-byte fallback.
 */
export function respawnsIn(mode: GameMode): boolean {
  switch (mode) {
    case GameMode.FFA_DEATHMATCH:
      return true;
    case GameMode.CONQUER:
      return true;
    case GameMode.FFA_LAST_STANDING:
      return false;
    case GameMode.TEAM:
      return false;
    default: {
      const _never: never = mode;
      void _never;
      return false;
    }
  }
}
