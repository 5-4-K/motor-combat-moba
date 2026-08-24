import {
  CAR_TABLE,
  type CarId,
  type LivingPlayer,
  type Spawn,
} from "@motor-arena/shared";

export function pickRandomCarId(random: () => number): CarId {
  const keys = Object.keys(CAR_TABLE) as CarId[];
  return keys[Math.floor(random() * keys.length)]!;
}

export function copySpawnNumbers(spawn: Spawn): { x: number; y: number; angle: number } {
  return { x: spawn.x, y: spawn.y, angle: spawn.angle };
}

export function firstAliveRosterWinner(
  mode: "ffa" | "team",
  roster: readonly string[],
  players: ReadonlyMap<string, { alive: boolean; team: number }>,
): { sessionId: string; winnerTeam: number } {
  for (const sessionId of roster) {
    const player = players.get(sessionId);
    if (player?.alive) {
      if (mode === "ffa") {
        return { sessionId, winnerTeam: -1 };
      }
      return { sessionId: "", winnerTeam: player.team };
    }
  }
  return { sessionId: "", winnerTeam: -1 };
}

export function livingAfterLeave(
  remaining: readonly { sessionId: string; team: 0 | 1; alive: boolean }[],
  roster: ReadonlySet<string>,
): LivingPlayer[] {
  return remaining.map((p) => ({
    sessionId: p.sessionId,
    team: p.team,
    alive: p.alive,
    inRoster: roster.has(p.sessionId),
  }));
}
