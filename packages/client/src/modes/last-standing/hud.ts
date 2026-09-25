import type { ArenaState } from "@motor-combat-moba/shared";
import { matchClockLabel } from "../../scenes/match-hud.js";
import type { ModeCardCopy, ModeHud } from "../types.js";

/**
 * The HUD family shared by Brawl and Team brawl, mirroring shared's `lastStandingRules(sides)`
 * (`modes/last-standing/rules.ts`) and the server's `LAST_STANDING_CONTROLLER`: only the lobby
 * card's copy differs between the two modes, so that is the one thing a caller supplies.
 *
 * `card` is a FUNCTION, not the copy itself, so nothing is computed at module scope — `brawl/hud.ts`
 * and `team-brawl/hud.ts` each pass a closure that builds their `ModeCardCopy` fresh on every call.
 *
 * `clockLabel` still routes through `matchClockLabel` — it answers "" whenever `matchEndsTick` is 0,
 * which is every match in this family today — rather than hardcoding "", so a future variant with a
 * real clock would not need this file touched.
 */
export function lastStandingHud(card: () => ModeCardCopy): ModeHud {
  return {
    lobbyCard: card,
    clockLabel: (state: ArenaState, tick: number) => matchClockLabel(tick, state.matchEndsTick),
    showsKills: false,
    resultsLine: () => undefined,
  };
}
