import {
  DEFAULT_CAR_ID,
  DRIVE_CONFIG,
  PlayerStatus,
  getArena,
  isCarId,
  type CarId,
  type Obb,
  type StepContext,
} from "@motor-arena/shared";

/** The fields of `PlayerState` this needs, kept structural so tests need no Colyseus schema. */
export interface ContextPlayer {
  x: number;
  y: number;
  angle: number;
  status: number;
  carId: string;
}

export interface ContextState {
  arenaId: string;
  players: {
    forEach(callback: (player: ContextPlayer, sessionId: string) => void): void;
  };
}

/**
 * The `StepContext` the local car is predicted through. This is the client's half of the lockstep:
 * it must describe the same world `serverTick` will describe for the same tick, or prediction
 * diverges and reconciliation spends the match snapping the car back.
 *
 * Three things are deliberately copied from `serverTick` rather than reinvented:
 *
 *  - only `PlayerStatus.IN_MATCH` players are solid, the same gate the server uses to decide who
 *    moves and who is a wall;
 *  - hulls are emitted in **sorted sessionId order**, because `resolveWorld` applies contacts
 *    sequentially and the last one resolved is the one guaranteed to end separated;
 *  - an unset or unrecognised `carId` falls back to the shared `DEFAULT_CAR_ID`.
 *
 * Remotes are taken at their last-known *server* pose. The client predicts only itself, so there is
 * nothing better to use, and it is also what the server saw when it built its own `others`.
 */
export function buildStepContext(state: ContextState, selfSessionId: string): StepContext {
  const arena = getArena(state.arenaId);

  const entries: Array<[string, ContextPlayer]> = [];
  state.players.forEach((player, sessionId) => {
    entries.push([sessionId, player]);
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const others: Obb[] = [];
  let carId: CarId = DEFAULT_CAR_ID;
  for (const [sessionId, player] of entries) {
    if (sessionId === selfSessionId) {
      carId = isCarId(player.carId) ? player.carId : DEFAULT_CAR_ID;
      continue;
    }
    if (player.status !== PlayerStatus.IN_MATCH) continue;
    others.push({
      x: player.x,
      y: player.y,
      angle: player.angle,
      w: DRIVE_CONFIG.carWidth,
      h: DRIVE_CONFIG.carHeight,
    });
  }

  return {
    carId,
    others,
    obstacles: arena.obstacles,
    bounds: { width: arena.width, height: arena.height },
  };
}
