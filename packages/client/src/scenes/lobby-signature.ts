export type LobbySignaturePlayer = {
  name: string;
  team: number;
  status: number;
  colorId: number;
};

export type LobbySignatureState = {
  mode: number;
  hostSessionId: string;
  players: {
    forEach(callback: (player: LobbySignaturePlayer, sessionId: string) => void): void;
  };
};

export function lobbyRenderSignature(state: LobbySignatureState): string {
  const rows: string[] = [];
  state.players.forEach((player, sessionId) => {
    rows.push(`${sessionId}:${player.name}:${player.team}:${player.status}:${player.colorId}`);
  });
  rows.sort();
  return `${state.mode}|${state.hostSessionId}|${rows.join(";")}`;
}
