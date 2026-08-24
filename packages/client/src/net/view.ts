import { viewFor, type RoomPhase, type StatusInput, type ViewId } from "@motor-arena/shared";

export const VIEW_TO_SCENE: Record<ViewId, string> = {
  lobby: "lobby",
  car_select: "car_select",
  match: "arena",
  results: "results",
};

export function sceneKeyFor(status: StatusInput, phase: RoomPhase): string {
  return VIEW_TO_SCENE[viewFor(status, phase)];
}

export type ViewRouterScene = {
  scene: { key: string; start: (key: string) => void };
};

export type ViewRouterRoom = {
  sessionId: string;
  state: {
    phase: RoomPhase;
    players: { get(sessionId: string): { status: StatusInput } | undefined };
  };
  onStateChange: ((cb: () => void) => void) & { remove: (cb: () => void) => void };
};

export function bindViewRouter(scene: ViewRouterScene, room: ViewRouterRoom): () => void {
  const sync = (): void => {
    const player = room.state.players.get(room.sessionId);
    if (!player) return;
    const target = sceneKeyFor(player.status, room.state.phase);
    if (target === scene.scene.key) return;
    scene.scene.start(target);
  };
  room.onStateChange(sync);
  sync();
  return () => room.onStateChange.remove(sync);
}
