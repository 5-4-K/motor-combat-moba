import { GameMode } from "../constants.js";

/**
 * What ends the match.
 *
 * Deliberately consumed in exactly ONE place — the room's end-of-match check — so that a grep for
 * this function answers "what does the win condition actually change?" completely.
 *
 * **An exhaustive `switch`, not an `if` (2026-09-23).** This is a mode-shaped fact that lives in
 * code — not part of a mode's bundle — so an `if` chain made a new `GameMode` value default to
 * last-standing SILENTLY, with no compile error and no test. `GameMode` is a plain numeric TS enum,
 * so the `never` assignment in `default` is a real exhaustiveness check: adding an enum value stops
 * this file compiling until someone decides which win rule it plays under. See
 * `.claude/skills/game-mode/SKILL.md` step 4.
 *
 * `sidesOf` and `respawnsIn`, the two axes this function used to sit beside, moved into
 * `ModeRules` (GM14) — `rulesOf(mode).sides` and `rulesOf(mode).respawns`. `winRuleOf` stays here
 * because it still has server/client callers that read it directly.
 *
 * **Why `default` still RETURNS a value rather than returning `_never`.** `mode` is not always a
 * value this build authored: the client reads `room.state.mode` as a uint8 off the wire, and
 * `balance/report.ts` reads one out of a baseline `run.json` off disk. Both can hold a byte naming
 * a mode this build does not have. Returning `_never` would hand that byte straight back as the
 * answer (it is the same variable), so the default keeps the fallback this function has always
 * served — the `never` assignment above it is what makes the AUTHORED case a compile error, which
 * is all it was ever there to do.
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
