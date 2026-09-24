import {
  COLOR_TABLE,
  GameMode,
  PlayerStatus,
  TICK_RATE_HZ,
  controlPercentText,
  derived,
  winRuleOf,
} from "@motor-combat-moba/shared";
import { modeLabel } from "./lobby-view.js";

/**
 * Room state to everything the post-match screen draws. Pure, for the same reason `lobby-view.ts` is.
 *
 * K and D are real as of 2026-09-01. A stays zero on purpose: the game attributes a kill to whoever
 * dealt damage last and tracks no assists at all, so an assist column would be inventing a number.
 */

const FALLBACK_HEX = "#888888";
const FALLBACK_CAR = "mirage";

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
  /** CQ58: "Control — You NN.NN% · Them NN.NN%", viewer-relative, only when `winRuleOf(mode) === "conquer"`. */
  controlLine?: string;
}

export interface ResultsViewPlayer {
  sessionId: string;
  name: string;
  colorId: number;
  team: number;
  carId: string;
  status: PlayerStatus;
  kills: number;
  deaths: number;
}

export interface ResultsViewState {
  mode: GameMode;
  winnerSessionId: string;
  winnerTeam: number;
  tick: number;
  matchStartedAtTick: number;
  players: readonly ResultsViewPlayer[];
  /** CQ33: the room's own control ticks — the view never re-derives them. */
  controlTicksA: number;
  controlTicksB: number;
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
    winnerLabel: winnerLabel(state, localSessionId),
    modeLabel: modeLabel(state.mode),
    durationLabel: durationLabel(state.matchStartedAtTick, state.tick),
    statsA: rows(played.filter((p) => p.team !== 1), localSessionId),
    statsB: rows(played.filter((p) => p.team === 1), localSessionId),
    controlLine: winRuleOf(state.mode) === "conquer" ? controlLine(state, localSessionId) : undefined,
  };
}

/** The viewer's team (0 when the viewer has no row, e.g. a late joiner watching the results). */
function localTeamOf(state: ResultsViewState, localSessionId: string): number {
  return state.players.find((p) => p.sessionId === localSessionId)?.team === 1 ? 1 : 0;
}

/** Viewer-relative, like the match HUD's US/THEM: the viewer's own team is always read first. */
function controlLine(state: ResultsViewState, localSessionId: string): string {
  const target = derived().conquerTicks.controlTarget;
  const a = controlPercentText(state.controlTicksA, target);
  const b = controlPercentText(state.controlTicksB, target);
  const [ours, theirs] = localTeamOf(state, localSessionId) === 1 ? [b, a] : [a, b];
  return `Control — You ${ours} · Them ${theirs}`;
}

function rows(players: readonly ResultsViewPlayer[], localSessionId: string): StatRow[] {
  return players.map((p) => ({
    sessionId: p.sessionId,
    name: p.name || p.sessionId,
    hex: COLOR_TABLE[p.colorId]?.hex ?? FALLBACK_HEX,
    carImage: `url("art/cars/${p.carId || FALLBACK_CAR}.png")`,
    isYou: p.sessionId === localSessionId,
    k: p.kills,
    d: p.deaths,
    a: 0,
  }));
}

/**
 * Mirrors the old `ResultsScene.resultsTitle`: a player wins Brawl, a team wins everything else.
 * Conquer names the outcome from the viewer's side ("You win"), because its whole HUD is US/THEM
 * and a team-B player, whose base sat at the bottom of their screen, never saw "Team B" anywhere.
 */
function winnerLabel(state: ResultsViewState, localSessionId: string): string {
  if (winRuleOf(state.mode) === "conquer") {
    if (state.winnerTeam !== 0 && state.winnerTeam !== 1) return "Draw";
    return state.winnerTeam === localTeamOf(state, localSessionId) ? "You win" : "You lose";
  }
  if (state.winnerSessionId) {
    const winner = state.players.find((p) => p.sessionId === state.winnerSessionId);
    return `${winner?.name || state.winnerSessionId} wins`;
  }
  if (state.winnerTeam === 0) return "Team A wins";
  if (state.winnerTeam === 1) return "Team B wins";
  return "Draw";
}
