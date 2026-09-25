import type { ArenaState } from "@motor-combat-moba/shared";
import { matchClockLabel } from "../../scenes/deathmatch-hud.js";
import type { ModeHud } from "../types.js";

/**
 * `FFA_LAST_STANDING`'s HUD. `clockLabel` still routes through `matchClockLabel` — it answers ""
 * whenever `matchEndsTick` is 0, which is every Brawl match — rather than hardcoding "", so a future
 * Brawl variant with a real clock would not need this file touched.
 */
export const BRAWL_HUD: ModeHud = {
  lobbyCard: () => ({
    kicker: "Free-for-all",
    body: "Everyone fights everyone. Last car driving takes the round.",
    meta: ["2-6 players", "Last one standing"],
  }),
  clockLabel: (state: ArenaState, tick: number) => matchClockLabel(tick, state.matchEndsTick),
  showsKills: false,
  resultsLine: () => undefined,
};
