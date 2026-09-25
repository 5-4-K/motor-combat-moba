import type { ArenaState } from "@motor-combat-moba/shared";
import { GameMode, modeConfigOf } from "@motor-combat-moba/shared";
import { matchClockLabel } from "../../scenes/match-hud.js";
import type { ModeHud } from "../types.js";

/**
 * `FFA_DEATHMATCH`'s HUD. The lobby card reads Deathmatch's OWN bundle through
 * `modeConfigOf(GameMode.FFA_DEATHMATCH)`, never the ambient `deathmatch()` accessor — the lobby's
 * installed mode need not be Deathmatch, so a `const` built from the ambient accessor would freeze
 * whichever mode happened to be installed first (same reasoning as the Conquer card, `conquer/hud.ts`).
 */
export const DEATHMATCH_HUD: ModeHud = {
  lobbyCard: () => {
    const { deathmatch } = modeConfigOf(GameMode.FFA_DEATHMATCH);
    return {
      kicker: "Free-for-all",
      // Kept close in length to the cards beside it: all published cards sit in one grid row, so the
      // longest body sets the row's height and this one is the only card that can make it tall. The
      // respawn delay is read rather than spelled out, so retuning `respawnDelaySeconds` cannot leave
      // the host reading a number the room no longer plays by.
      body: `Everyone fights everyone. Dying costs ${deathmatch.respawnDelaySeconds} seconds, not the round. Most kills on the clock wins.`,
      meta: ["2-6 players", `${deathmatch.matchSeconds / 60} minutes`],
    };
  },
  clockLabel: (state: ArenaState, tick: number) => matchClockLabel(tick, state.matchEndsTick),
  showsKills: true,
  resultsLine: () => undefined,
};
