import { COLOR_TABLE, GameMode, PlayerStatus, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { modeLabel } from "./lobby-view.js";

/**
 * Room state to everything the post-match screen draws. Pure, for the same reason `lobby-view.ts` is.
 *
 * K/D/A render as zeroes on purpose. The columns are in the design and the table is built to carry
 * them, but nothing in `stepSim` attributes a kill to an attacker yet — inventing numbers here would
 * be worse than showing honest zeroes, and wiring real attribution touches the collision-damage
 * rules, which is its own conversation.
 */

const FALLBACK_HEX = "#888888";
const FALLBACK_CAR = "rectangle";

export interface StatRow {
  sessionId: string;
  name: string;
  hex: string;
  carImage: string;
  isYou: boolean;
  k: number;
  d: number;
  a: number;
}

export interface ResultsView {
  winnerLabel: string;
  modeLabel: string;
  durationLabel: string;
  statsA: StatRow[];
  statsB: StatRow[];
}

export interface ResultsViewPlayer {
  sessionId: string;
  name: string;
  colorId: number;
  team: number;
  carId: string;
  status: PlayerStatus;
}

export interface ResultsViewState {
  mode: GameMode;
  winnerSessionId: string;
  winnerTeam: number;
  tick: number;
  matchStartedAtTick: number;
  players: readonly ResultsViewPlayer[];
}

/**
 * `m:ss` between two ticks. Floors rather than rounds, so a clock stopped at 59.9s reads 0:59 and
 * never briefly claims a minute that did not elapse. A zero or future start stamp clamps to 0:00
 * instead of counting backwards.
 */
export function durationLabel(startTick: number, endTick: number): string {
  const ticks = Math.max(0, endTick - startTick);
  const total = Math.floor(ticks / TICK_RATE_HZ);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function resultsView(state: ResultsViewState, localSessionId: string): ResultsView {
  const played = state.players.filter(
    (p) => p.status === PlayerStatus.POST_MATCH || p.status === PlayerStatus.IN_MATCH,
  );

  return {
    winnerLabel: winnerLabel(state),
    modeLabel: modeLabel(state.mode),
    durationLabel: durationLabel(state.matchStartedAtTick, state.tick),
    statsA: rows(played.filter((p) => p.team !== 1), localSessionId),
    statsB: rows(played.filter((p) => p.team === 1), localSessionId),
  };
}

function rows(players: readonly ResultsViewPlayer[], localSessionId: string): StatRow[] {
  return players.map((p) => ({
    sessionId: p.sessionId,
    name: p.name || p.sessionId,
    hex: COLOR_TABLE[p.colorId]?.hex ?? FALLBACK_HEX,
    carImage: `url("art/cars/${p.carId || FALLBACK_CAR}.png")`,
    isYou: p.sessionId === localSessionId,
    k: 0,
    d: 0,
    a: 0,
  }));
}

/** Mirrors the old `ResultsScene.resultsTitle`: a player wins Brawl, a team wins everything else. */
function winnerLabel(state: ResultsViewState): string {
  if (state.winnerSessionId) {
    const winner = state.players.find((p) => p.sessionId === state.winnerSessionId);
    return `${winner?.name || state.winnerSessionId} wins`;
  }
  if (state.winnerTeam === 0) return "Team A wins";
  if (state.winnerTeam === 1) return "Team B wins";
  return "Draw";
}
