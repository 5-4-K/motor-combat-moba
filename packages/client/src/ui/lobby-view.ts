import {
  COLOR_TABLE,
  GameMode,
  MAX_PLAYERS,
  MAX_TEAM_SIZE,
  PlayerStatus,
  canSwitchTeam,
} from "@motor-combat-moba/shared";

/**
 * Room state to everything the lobby screen draws. Pure and Phaser-free so the rules that actually
 * matter — who may be kicked, when the switch is dead, how many open slots to show — are unit
 * tested, leaving `LobbyScene` with nothing but mounting and room wiring.
 */

/** Open seats drawn per column. The extra seats over a 3v3 ceiling are swap headroom, not capacity. */
export const TEAM_SLOTS = MAX_TEAM_SIZE;

const FALLBACK_HEX = "#888888";

export interface StatusStyle {
  label: string;
  bg: string;
  fg: string;
}

export const STATUS_STYLES: Record<PlayerStatus, StatusStyle> = {
  [PlayerStatus.READY]: {
    label: "Ready",
    bg: "var(--color-accent-2-200)",
    fg: "var(--color-accent-2-800)",
  },
  [PlayerStatus.IN_MATCH]: {
    label: "In match",
    bg: "var(--color-accent-200)",
    fg: "var(--color-accent-700)",
  },
  [PlayerStatus.POST_MATCH]: {
    label: "Post-match",
    bg: "var(--color-neutral-200)",
    fg: "var(--color-neutral-700)",
  },
};

export interface LobbySlot {
  filled: boolean;
  sessionId: string;
  name: string;
  hex: string;
  isHostRow: boolean;
  isYou: boolean;
  canKick: boolean;
  status: StatusStyle;
}

export interface LobbyView {
  modeLabel: string;
  countLabel: string;
  teamACount: string;
  teamBCount: string;
  isHost: boolean;
  canSwitchTeam: boolean;
  startError: string;
  teamA: LobbySlot[];
  teamB: LobbySlot[];
}

export interface LobbyViewPlayer {
  sessionId: string;
  name: string;
  colorId: number;
  team: number;
  status: PlayerStatus;
}

export interface LobbyViewState {
  mode: GameMode;
  hostSessionId: string;
  players: readonly LobbyViewPlayer[];
}

export function modeLabel(mode: GameMode): string {
  return mode === GameMode.TEAM ? "Team brawl" : "Brawl";
}

export function lobbyView(
  state: LobbyViewState,
  localSessionId: string,
  startError: string,
): LobbyView {
  const isHost = localSessionId === state.hostSessionId;
  const teamA = state.players.filter((p) => p.team !== 1);
  const teamB = state.players.filter((p) => p.team === 1);
  const local = state.players.find((p) => p.sessionId === localSessionId);

  return {
    modeLabel: modeLabel(state.mode),
    countLabel: `${state.players.length} / ${MAX_PLAYERS} players`,
    teamACount: `${teamA.length} / ${TEAM_SLOTS}`,
    teamBCount: `${teamB.length} / ${TEAM_SLOTS}`,
    isHost,
    canSwitchTeam: local
      ? canSwitchTeam(
          { status: switchStatus(local.status), team: local.team },
          state.players.map((p) => p.team),
        )
      : false,
    startError,
    teamA: column(teamA, state.hostSessionId, localSessionId, isHost),
    teamB: column(teamB, state.hostSessionId, localSessionId, isHost),
  };
}

/**
 * One team's rows, padded out to `TEAM_SLOTS`. Padding only ever *adds*: a team that somehow holds
 * more than the cap still renders every player, because dropping a row would hide a person from the
 * lobby they are standing in.
 */
function column(
  players: readonly LobbyViewPlayer[],
  hostSessionId: string,
  localSessionId: string,
  isHost: boolean,
): LobbySlot[] {
  const slots: LobbySlot[] = players.map((p) => ({
    filled: true,
    sessionId: p.sessionId,
    name: p.name || p.sessionId,
    hex: COLOR_TABLE[p.colorId]?.hex ?? FALLBACK_HEX,
    isHostRow: p.sessionId === hostSessionId,
    isYou: p.sessionId === localSessionId,
    // Mirrors the server's rule in ArenaRoom: the host cannot kick themselves, and a player who is
    // mid-match is not in the lobby to be removed from it.
    canKick:
      isHost &&
      p.sessionId !== localSessionId &&
      (p.status === PlayerStatus.READY || p.status === PlayerStatus.POST_MATCH),
    status: STATUS_STYLES[p.status] ?? STATUS_STYLES[PlayerStatus.READY],
  }));

  while (slots.length < TEAM_SLOTS) {
    slots.push({
      filled: false,
      sessionId: "",
      name: "Open slot",
      hex: "var(--color-neutral-300)",
      isHostRow: false,
      isYou: false,
      canKick: false,
      status: { label: "", bg: "transparent", fg: "transparent" },
    });
  }
  return slots;
}

function switchStatus(status: PlayerStatus): "ready" | "in_match" | "post_match" {
  if (status === PlayerStatus.IN_MATCH) return "in_match";
  if (status === PlayerStatus.POST_MATCH) return "post_match";
  return "ready";
}
