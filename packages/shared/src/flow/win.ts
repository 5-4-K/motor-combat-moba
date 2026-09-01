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

/** One player as the deathmatch scoreboard sees them. */
export interface DeathmatchPlayer {
  sessionId: string;
  kills: number;
  deaths: number;
  inRoster: boolean;
}

/**
 * Who won a deathmatch: most kills, then fewest deaths (M26).
 *
 * Fewest deaths is the tie-break because it is a real skill signal, it is deterministic, and it
 * needs no overtime phase. Sudden death was rejected: it would want a new phase, a networked
 * overtime flag, and a guard against two players simply hiding from each other.
 *
 * A top position still tied on both yields `winnerSessionId: ""`, which is the same shape
 * `livingSides` returns for a draw and which `ResultsScene` already renders. `winnerTeam` is always
 * -1 — deathmatch is FFA-only, so there is no team to win it.
 *
 * Unlike `livingSides`, this does NOT read `alive`. Every player waiting on a respawn timer is dead,
 * and in a mode with respawns that says nothing about who is winning.
 */
export function deathmatchOutcome(players: readonly DeathmatchPlayer[]): LivingSidesResult {
  const ranked = players
    .filter((p) => p.inRoster)
    .sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths));

  const leader = ranked[0];
  if (!leader) return DRAW;

  const runnerUp = ranked[1];
  const tied =
    runnerUp !== undefined &&
    runnerUp.kills === leader.kills &&
    runnerUp.deaths === leader.deaths;
  if (tied) return DRAW;

  return { sides: 1, winnerSessionId: leader.sessionId, winnerTeam: -1 };
}

/**
 * Is this deathmatch over?
 *
 * Two ways in, and neither is "one side is left standing" — with respawns every player can be dead
 * at once while their timers run, which says nothing at all about who is winning (M25).
 *
 * A `matchEndsTick` of 0 means the mode has no clock, and must never read as "already past the end":
 * that would end a last-standing match on its first tick.
 */
export function deathmatchEnded(
  rosterSize: number,
  tick: number,
  matchEndsTick: number,
): boolean {
  // Nobody left to fight. A lone survivor would otherwise drive in circles until the clock ran out.
  if (rosterSize < 2) return true;
  if (matchEndsTick <= 0) return false;
  return tick >= matchEndsTick;
}
