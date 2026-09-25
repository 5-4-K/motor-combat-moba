import { livingSides, rulesOf, type LivingPlayer } from "@motor-combat-moba/shared";
import type { CombatPlayerView, MatchOutcome, ModeController, ModeRoomView } from "../types.js";
import { livingAfterLeave } from "../../rooms/match-helpers.js";

/**
 * Last Standing (brawl + team, GM18): ends when `livingSides` drops to one side. Shared by both
 * `GameMode.FFA_LAST_STANDING` and `GameMode.TEAM` in the registry — `rulesOf(mode).sides` is what
 * tells the two apart.
 */
export const LAST_STANDING_CONTROLLER: ModeController = {
  onMatchStart(room: ModeRoomView): void {
    room.state.matchEndsTick = 0;
  },

  afterTick(room: ModeRoomView, combatPlayers: readonly CombatPlayerView[]): MatchOutcome | undefined {
    const result = livingSides(rulesOf(room.state.mode).sides, [...combatPlayers]);
    if (result.sides > 1) return undefined;
    return { winnerSessionId: result.winnerSessionId, winnerTeam: result.winnerTeam };
  },

  afterLeave(room: ModeRoomView): MatchOutcome | undefined {
    const remainingPlayers: { sessionId: string; team: 0 | 1; alive: boolean }[] = [];
    room.state.players.forEach((player) => {
      remainingPlayers.push({
        sessionId: player.sessionId,
        team: player.team === 1 ? 1 : 0,
        alive: player.alive,
      });
    });
    const living: LivingPlayer[] = livingAfterLeave(remainingPlayers, room.roster);
    const result = livingSides(rulesOf(room.state.mode).sides, living);
    if (result.sides > 1) return undefined;
    return { winnerSessionId: result.winnerSessionId, winnerTeam: result.winnerTeam };
  },
};
