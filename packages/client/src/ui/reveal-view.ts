import {
  COLOR_TABLE,
  GameMode,
  MAX_PLAYERS,
  PlayerStatus,
  TICK_RATE_HZ,
} from "@motor-combat-moba/shared";
import { modeLabel } from "./lobby-view.js";

/**
 * Room state to the "cars locked in" grid. Pure, like the other view-models.
 *
 * The two modes read the panels differently, which is the whole reason this is worth a module:
 *
 * - **Team brawl** — the panels *are* the teams. Titled, with occupancy, split on `player.team`.
 * - **Brawl** — there are no teams to show. `player.team` still exists on the schema (the server
 *   assigns one on join regardless of mode) but it means nothing here, so the panels are untitled
 *   and are just two columns the roster is dealt into, three and three.
 */

/** Rows per panel. Three, because an even 3v3 is the largest match `canStart` will let through. */
export const REVEAL_SLOTS = 3;

const FALLBACK_HEX = "#888888";
const FALLBACK_CAR = "mirage";

/** Seconds still on the clock, rounded up so a fresh 10s dwell reads "10" rather than "9". */
export function secondsLeft(deadlineTick: number, tick: number): number {
  return Math.max(0, Math.ceil((deadlineTick - tick) / TICK_RATE_HZ));
}

export interface RevealRow {
  filled: boolean;
  name: string;
  hex: string;
  /** Empty for a driverless row: the design gives those no thumbnail well at all. */
  carImage: string;
  isHostRow: boolean;
  isYou: boolean;
}

export interface RevealPanel {
  title: string;
  count: string;
  rows: RevealRow[];
}

export interface RevealView {
  modeLabel: string;
  countLabel: string;
  secondsLeft: number;
  /** True in the last three seconds, when the design turns the clock accent. */
  urgent: boolean;
  showTeamHeadings: boolean;
  panelA: RevealPanel;
  panelB: RevealPanel;
}

export interface RevealViewPlayer {
  sessionId: string;
  name: string;
  colorId: number;
  team: number;
  carId: string;
  status: PlayerStatus;
}

export interface RevealViewState {
  mode: GameMode;
  hostSessionId: string;
  tick: number;
  revealEndsTick: number;
  players: readonly RevealViewPlayer[];
}

const URGENT_SECONDS = 3;

export function revealView(state: RevealViewState, localSessionId: string): RevealView {
  const drivers = state.players.filter((p) => p.status === PlayerStatus.IN_MATCH);
  const isTeam = state.mode === GameMode.TEAM;

  const [left, right] = isTeam
    ? [drivers.filter((p) => p.team !== 1), drivers.filter((p) => p.team === 1)]
    : [drivers.slice(0, REVEAL_SLOTS), drivers.slice(REVEAL_SLOTS)];

  const panel = (players: readonly RevealViewPlayer[], title: string): RevealPanel => ({
    title: isTeam ? title : "",
    count: isTeam ? `${players.length} / ${REVEAL_SLOTS}` : "",
    rows: rows(players, state.hostSessionId, localSessionId),
  });

  const remaining = secondsLeft(state.revealEndsTick, state.tick);

  return {
    modeLabel: modeLabel(state.mode),
    countLabel: `${drivers.length} / ${MAX_PLAYERS} players`,
    secondsLeft: remaining,
    urgent: remaining <= URGENT_SECONDS,
    showTeamHeadings: isTeam,
    panelA: panel(left, "Team A"),
    panelB: panel(right, "Team B"),
  };
}

function rows(
  players: readonly RevealViewPlayer[],
  hostSessionId: string,
  localSessionId: string,
): RevealRow[] {
  const out: RevealRow[] = players.map((p) => ({
    filled: true,
    name: p.name || p.sessionId,
    hex: COLOR_TABLE[p.colorId]?.hex ?? FALLBACK_HEX,
    carImage: `url("art/cars/${p.carId || FALLBACK_CAR}.png")`,
    isHostRow: p.sessionId === hostSessionId,
    isYou: p.sessionId === localSessionId,
  }));

  // Padding only adds. A Brawl team can hold four, and a player who somehow lands past the third
  // seat must still be shown driving rather than vanish from the grid.
  while (out.length < REVEAL_SLOTS) {
    out.push({
      filled: false,
      name: "No driver",
      hex: "var(--color-neutral-300)",
      carImage: "",
      isHostRow: false,
      isYou: false,
    });
  }
  return out;
}
