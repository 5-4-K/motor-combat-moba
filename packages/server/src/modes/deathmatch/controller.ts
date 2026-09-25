import {
  deathmatchEnded,
  deathmatchOutcome,
  type DeathmatchPlayer,
} from "@motor-combat-moba/shared";
import type { MatchOutcome, ModeController, ModeRoomView } from "../types.js";
import { stampMatchClock } from "../match-clock.js";

/**
 * FFA Deathmatch (M25): never asks `livingSides`. With respawns every player can be dead at once
 * while their timers run, and that would read as a draw and end the match under everyone's feet.
 * `afterTick` and `afterLeave` run the identical check — a leaver just shrinks the roster the same
 * way a wreck does.
 */
export const DEATHMATCH_CONTROLLER: ModeController = {
  onStartRequested(): void {
    // Deathmatch owns no pre-match display state; nothing to clear.
  },

  onMatchStart(room: ModeRoomView): void {
    stampMatchClock(room);
  },

  afterTick(room: ModeRoomView): MatchOutcome | undefined {
    return checkEnd(room);
  },

  afterLeave(room: ModeRoomView): MatchOutcome | undefined {
    return checkEnd(room);
  },
};

function checkEnd(room: ModeRoomView): MatchOutcome | undefined {
  const players: DeathmatchPlayer[] = [];
  for (const id of room.roster) {
    const player = room.state.players.get(id);
    if (!player) continue;
    players.push({ sessionId: id, kills: player.kills, deaths: player.deaths, inRoster: true });
  }

  if (!deathmatchEnded(players.length, room.state.tick, room.state.matchEndsTick)) return undefined;
  const outcome = deathmatchOutcome(players);
  return { winnerSessionId: outcome.winnerSessionId, winnerTeam: outcome.winnerTeam };
}
