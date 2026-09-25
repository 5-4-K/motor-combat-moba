import { COLOR_TABLE, GameMode, PlayerStatus, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { modeLabel } from "./lobby-view.js";
import { hudOf } from "../modes/registry.js";

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
  /** CQ58: "Control — You NN.NN% · Them NN.NN%", viewer-relative — Conquer's own `resultsLine`. */
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

  const hud = hudOf(state.mode);

  return {
    winnerLabel: hud.resultsHeadline?.(state, localSessionId) ?? defaultWinnerLabel(state),
    modeLabel: modeLabel(state.mode),
    durationLabel: durationLabel(state.matchStartedAtTick, state.tick),
    statsA: rows(played.filter((p) => p.team !== 1), localSessionId),
    statsB: rows(played.filter((p) => p.team === 1), localSessionId),
    controlLine: hud.resultsLine(state, localSessionId),
  };
}

/**
 * The viewer's team (0 when the viewer has no row, e.g. a late joiner watching the results).
 * Exported for `modes/conquer/hud.ts`'s `resultsLine`/`resultsHeadline`, the only other reader.
 */
export function localTeamOf(state: ResultsViewState, localSessionId: string): number {
  return state.players.find((p) => p.sessionId === localSessionId)?.team === 1 ? 1 : 0;
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
 * Conquer overrides this with its own viewer-relative headline ("You win") through
 * `hudOf(mode).resultsHeadline` (`modes/conquer/hud.ts`) — its whole HUD is US/THEM, and a team-B
 * player, whose base sat at the bottom of their screen, never saw "Team B" anywhere.
 */
function defaultWinnerLabel(state: ResultsViewState): string {
  if (state.winnerSessionId) {
    const winner = state.players.find((p) => p.sessionId === state.winnerSessionId);
    return `${winner?.name || state.winnerSessionId} wins`;
  }
  if (state.winnerTeam === 0) return "Team A wins";
  if (state.winnerTeam === 1) return "Team B wins";
  return "Draw";
}
