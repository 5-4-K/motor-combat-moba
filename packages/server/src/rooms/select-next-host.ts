export function selectNextHost(
  players: { sessionId: string; joinedAtTick: number }[],
): string {
  if (players.length === 0) return "";
  return [...players].sort((a, b) => {
    if (a.joinedAtTick !== b.joinedAtTick) return a.joinedAtTick - b.joinedAtTick;
    return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
  })[0]!.sessionId;
}
