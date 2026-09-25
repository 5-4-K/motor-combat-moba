import type { ArenaState } from "@motor-combat-moba/shared";
import { matchClockLabel } from "../../scenes/deathmatch-hud.js";
import type { ModeHud } from "../types.js";

/** `TEAM`'s HUD — otherwise identical to Brawl's (`brawl/hud.ts`), only the card copy differs. */
export const TEAM_HUD: ModeHud = {
  lobbyCard: () => ({
    kicker: "Team",
    body: "Two teams, shared victory. Last team with a car standing wins.",
    meta: ["2v2 – 3v3", "Last team standing"],
  }),
  clockLabel: (state: ArenaState, tick: number) => matchClockLabel(tick, state.matchEndsTick),
  showsKills: false,
  resultsLine: () => undefined,
};
