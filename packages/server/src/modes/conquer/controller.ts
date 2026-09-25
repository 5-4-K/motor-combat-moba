import {
  conquerLeaveOutcome,
  derived,
  getArena,
  type ZonePresenceCar,
} from "@motor-combat-moba/shared";
import type { MatchOutcome, ModeController, ModeRoomView } from "../types.js";
import { stampMatchClock } from "../match-clock.js";
import { advanceConquer, resetZone } from "./zone-fields.js";

/**
 * Conquer (CQ44): the respawn-on-death flow of Deathmatch, but the win test is the zone's control
 * bar, not kills. Zone fields are reset TWICE, deliberately, at two different edges: `onStartRequested`
 * clears them the moment the host starts a match (CQ29) so the CAR_SELECT / REVEAL / COUNTDOWN
 * screens that follow never show the previous match's bars, holder, streak, contested or overtime;
 * `onMatchStart` clears them again (a no-op unless something wrote to them in between, which nothing
 * does) alongside stamping the same clock Deathmatch does, on the actual edge into MATCH.
 */
export const CONQUER_CONTROLLER: ModeController = {
  onStartRequested(room: ModeRoomView): void {
    resetZone(room.state);
  },

  onMatchStart(room: ModeRoomView): void {
    stampMatchClock(room);
    resetZone(room.state);
  },

  afterTick(room: ModeRoomView): MatchOutcome | undefined {
    const zone = getArena(room.state.arenaId).zone;
    if (!zone) return undefined; // unreachable: invariants.test.ts holds every conquer arena to a zone
    const cars: ZonePresenceCar[] = [];
    room.state.players.forEach((p) => {
      cars.push({ x: p.x, y: p.y, team: p.team, alive: p.alive, inRoster: room.roster.has(p.sessionId) });
    });
    const ticks = derived().conquerTicks;
    const result = advanceConquer(room.state, zone, cars, ticks.captureDelay, ticks.controlTarget);
    if (!result.ended) return undefined;
    return { winnerSessionId: "", winnerTeam: result.winnerTeam };
  },

  afterLeave(room: ModeRoomView): MatchOutcome | undefined {
    const counts: [number, number] = [0, 0];
    for (const id of room.roster) {
      const p = room.state.players.get(id);
      if (p) counts[p.team === 1 ? 1 : 0] += 1;
    }
    const left = conquerLeaveOutcome(counts);
    if (!left.ended) return undefined;
    return { winnerSessionId: "", winnerTeam: left.winnerTeam };
  },
};
