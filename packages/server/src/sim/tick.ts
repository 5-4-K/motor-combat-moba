import {
  ArenaState,
  CAR_TABLE,
  DRIVE_CONFIG,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  getArena,
  stepSim,
  type ArenaDef,
  type CarId,
  type InputMessage,
  type Obb,
  type SimBody,
  type StepContext,
} from "@motor-arena/shared";

/** Pre-reveal (lobby / P0 sandbox) players have no car yet, so they drive the default chassis. */
const DEFAULT_CAR_ID: CarId = "rectangle";

/**
 * Advance every player by their queued inputs. `dt` is seconds and must match the room simulation
 * interval (1 / getTickRateHz(TICK_RATE_HZ)).
 *
 * Cars only move during `RoomPhase.MATCH`. Every other phase — countdown, car select, lobby — still
 * *drains* the queue and still advances `lastProcessedInputSeq`. Both halves matter: without the
 * drain the queue grows unbounded through the countdown and the car lurches the moment the gate
 * opens, and without the seq advance the client's pending-input buffer never clears, so
 * reconciliation replays stale inputs forever.
 *
 * Players are stepped in sorted `sessionId` order, and resolution is sequential: each player is
 * stepped against the *current* poses of the others, so a player stepped later already sees the
 * updated positions of the players stepped before it. Sorting is what makes that reproducible;
 * `MapSchema` insertion order is not.
 */
export function serverTick(
  state: ArenaState,
  queues: Map<string, InputMessage[]>,
  dt: number,
  phase: RoomPhase,
): void {
  const arena = getArena(state.arenaId);
  const moving = phase === RoomPhase.MATCH;

  for (const id of sortedSessionIds(state)) {
    const player = state.players.get(id);
    const queue = queues.get(id);
    if (!player || !queue || queue.length === 0) continue;

    // `null` context means "this phase does not move cars": drain only.
    const ctx = moving ? stepContextFor(state, arena, id, player) : null;

    while (queue.length) {
      const msg = queue.shift()!;
      if (ctx !== null) {
        writeBody(player, stepSim(bodyOf(player), msg, dt, ctx));
      }
      player.lastProcessedInputSeq = msg.seq;
    }
  }
}

/** Deterministic iteration order — `MapSchema` hands back insertion order, which the room controls. */
function sortedSessionIds(state: ArenaState): string[] {
  return [...state.players.keys()].sort();
}

function stepContextFor(
  state: ArenaState,
  arena: ArenaDef,
  selfId: string,
  player: PlayerState,
): StepContext {
  return {
    carId: carIdOf(player),
    others: otherCarHulls(state, selfId),
    obstacles: arena.obstacles,
    bounds: { width: arena.width, height: arena.height },
  };
}

/** `""` before the car reveal, and anything unrecognised, falls back to the default chassis. */
function carIdOf(player: PlayerState): CarId {
  return player.carId in CAR_TABLE ? (player.carId as CarId) : DEFAULT_CAR_ID;
}

/**
 * Hulls of every *other* player currently in the match. Lobby and post-match players are in the
 * room but not on the field, so they must not act as solid walls.
 */
function otherCarHulls(state: ArenaState, selfId: string): Obb[] {
  const hulls: Obb[] = [];
  for (const id of sortedSessionIds(state)) {
    if (id === selfId) continue;
    const other = state.players.get(id);
    if (!other || other.status !== PlayerStatus.IN_MATCH) continue;
    hulls.push({
      x: other.x,
      y: other.y,
      angle: other.angle,
      w: DRIVE_CONFIG.carWidth,
      h: DRIVE_CONFIG.carHeight,
    });
  }
  return hulls;
}

function bodyOf(player: PlayerState): SimBody {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    speed: player.speed,
    reverseHold: player.reverseHold,
  };
}

function writeBody(player: PlayerState, body: SimBody): void {
  player.x = body.x;
  player.y = body.y;
  player.angle = body.angle;
  player.speed = body.speed;
  player.reverseHold = body.reverseHold;
}
