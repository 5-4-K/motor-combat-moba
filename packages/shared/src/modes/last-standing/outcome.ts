export interface LivingPlayer {
  sessionId: string;
  team: 0 | 1;
  alive: boolean;
  inRoster: boolean;
}

export interface LivingSidesResult {
  sides: number;
  winnerSessionId: string;
  winnerTeam: number;
}

const DRAW: LivingSidesResult = {
  sides: 0,
  winnerSessionId: "",
  winnerTeam: -1,
};

export function livingSides(
  mode: "ffa" | "team",
  players: LivingPlayer[],
): LivingSidesResult {
  const living = players.filter((p) => p.inRoster && p.alive);

  if (mode === "ffa") {
    if (living.length === 1) {
      return {
        sides: 1,
        winnerSessionId: living[0]!.sessionId,
        winnerTeam: -1,
      };
    }
    if (living.length === 0) return DRAW;
    return { sides: living.length, winnerSessionId: "", winnerTeam: -1 };
  }

  const teams = new Set(living.map((p) => p.team));
  if (teams.size === 1) {
    return {
      sides: 1,
      winnerSessionId: "",
      winnerTeam: [...teams][0]!,
    };
  }
  if (teams.size === 0) return DRAW;
  return { sides: teams.size, winnerSessionId: "", winnerTeam: -1 };
}
