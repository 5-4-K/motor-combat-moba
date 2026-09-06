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
  /**
   * Structurally typed on `forEach` alone, like `players` above — an ArraySchema and a plain array
   * both satisfy it, so tests need no schema instance.
   */
  chat: {
    forEach(callback: (message: { seq: number }) => void): void;
  };
};

export function lobbyRenderSignature(state: LobbySignatureState): string {
  const rows: string[] = [];
  state.players.forEach((player, sessionId) => {
    rows.push(`${sessionId}:${player.name}:${player.team}:${player.status}:${player.colorId}`);
  });
  rows.sort();
  // The last message's seq, not the buffer's length: at the cap an append plus a shift leaves the
  // length unchanged, and comparing text cannot tell two identical messages apart (LC12).
  let lastSeq = 0;
  state.chat.forEach((message) => {
    lastSeq = message.seq;
  });
  return `${state.mode}|${state.hostSessionId}|${rows.join(";")}|${lastSeq}`;
}
