import {
  COLOR_TABLE,
  DEATHMATCH_CONFIG,
  DEFAULT_GAME_MODE,
  GameMode,
  MAX_PLAYERS,
  MAX_TEAM_SIZE,
  MODE_TABLE,
  PlayerStatus,
  activeGameModes,
  canSwitchTeam,
  isActiveGameMode,
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
  /**
   * Whether the two columns are teams. False in Brawl, where `pickTeam` still seats players 0/1 to
   * keep the columns even but nothing in the match reads the value — so calling them Team A and
   * Team B would name a division the mode does not have. Mirrors `RevealView.showTeamHeadings`.
   */
  showTeamHeadings: boolean;
  teamACount: string;
  teamBCount: string;
  isHost: boolean;
  canSwitchTeam: boolean;
  /** Host Settings → Game modes. Hidden when only one mode is published — nothing to pick. */
  canChangeMode: boolean;
  /**
   * Whether the settings menu carries its Game modes entry. The menu itself is always shown — it is
   * where Exit lives, and every player needs a way out of a lobby — so this is what keeps re-moding
   * the room to the host, rather than the presence of the button.
   */
  canOpenModes: boolean;
  /** Whether every seated player is `PlayerStatus.READY`. Gates the Start Match confirmation. */
  allReady: boolean;
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
  return MODE_TABLE[mode]?.name ?? MODE_TABLE[DEFAULT_GAME_MODE].name;
}

/**
 * The host's Game modes catalog. Copy stays here (it is render-only); the id list is `activeGameModes`
 * so flipping `MODE_TABLE.isActive` drops a card without a second edit.
 */
const MODE_CARDS = [
  {
    id: GameMode.FFA_LAST_STANDING,
    kicker: "Free-for-all",
    body: "Everyone fights everyone. Last car driving takes the round.",
    metaA: "2-6 players",
    metaB: "Last one standing",
  },
  {
    id: GameMode.TEAM,
    kicker: "Team",
    body: "Two teams, shared victory. Last team with a car standing wins.",
    metaA: "2v2 – 3v3",
    metaB: "Last team standing",
  },
  {
    id: GameMode.FFA_DEATHMATCH,
    kicker: "Free-for-all",
    // Kept close in length to the two cards beside it: all three sit in one grid row, so the longest
    // body sets the height of the row and this one is the only card that can make it tall. The
    // respawn delay is read rather than spelled out, so retuning `respawnDelaySeconds` cannot leave
    // the host reading a number the room no longer plays by.
    body: `Everyone fights everyone. Dying costs ${DEATHMATCH_CONFIG.respawnDelaySeconds} seconds, not the round. Most kills on the clock wins.`,
    metaA: "2-6 players",
    metaB: `${DEATHMATCH_CONFIG.matchSeconds / 60} minutes`,
  },
] as const;

export function modeCards(): Array<(typeof MODE_CARDS)[number] & { name: string }> {
  return MODE_CARDS.filter((card) => isActiveGameMode(card.id)).map((card) => ({
    ...card,
    name: MODE_TABLE[card.id].name,
  }));
}

export function lobbyView(
  state: LobbyViewState,
  localSessionId: string,
  startError: string,
): LobbyView {
  const isHost = localSessionId === state.hostSessionId;
  const isTeam = state.mode === GameMode.TEAM;
  const teamA = state.players.filter((p) => p.team !== 1);
  const teamB = state.players.filter((p) => p.team === 1);
  const local = state.players.find((p) => p.sessionId === localSessionId);

  return {
    modeLabel: modeLabel(state.mode),
    countLabel: `${state.players.length} / ${MAX_PLAYERS} players`,
    showTeamHeadings: isTeam,
    // Blank rather than absent in Brawl: the heading row is dropped whole, so an occupancy that
    // counts seats on a team nobody is on never reaches the screen and never reaches a reader of
    // this model either. The lobby still splits on `team` — that is seating, not sides.
    teamACount: isTeam ? `${teamA.length} / ${TEAM_SLOTS}` : "",
    teamBCount: isTeam ? `${teamB.length} / ${TEAM_SLOTS}` : "",
    isHost,
    canSwitchTeam: local
      ? canSwitchTeam(
          { status: switchStatus(local.status), team: local.team },
          state.players.map((p) => p.team),
        )
      : false,
    canChangeMode: activeGameModes().length >= 2,
    canOpenModes: isHost && activeGameModes().length >= 2,
    allReady: state.players.every((p) => p.status === PlayerStatus.READY),
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
