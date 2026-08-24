import {
  ArenaState,
  DRIVE_CONFIG,
  NET_CONFIG,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  getArena,
  isCarId,
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
 * Cars only move during `RoomPhase.MATCH`, and only for players who are actually on the field
 * (`PlayerStatus.IN_MATCH`). Everything else — any other phase, or a lobby/post-match player who
 * keeps sending inputs mid-match — still *drains* the queue and still advances
 * `lastProcessedInputSeq`. Both halves matter: without the drain the queue grows unbounded through
 * the countdown and the car lurches the moment the gate opens, and without the seq advance the
 * client's pending-input buffer never clears, so reconciliation replays stale inputs forever.
 *
 * The mover gate is deliberately the same condition as the `others` filter below. If it were not,
 * a player who is not in the match would be driven around the arena and would collide with real
 * players while staying invisible to *their* collision checks.
 *
 * Players are stepped in sorted `sessionId` order, and resolution is sequential: each player is
 * stepped against the *current* poses of the others, so a player stepped later already sees the
 * updated positions of the players stepped before it. Sorting is what makes that reproducible;
 * `MapSchema` insertion order is not.
 *
 * Within one player, inputs are applied in *seq* order rather than arrival order, and at most
 * `NET_CONFIG.maxInputsPerTick` of them actually reach `stepSim`. See the comments in the drain
 * loop for why each of those matters.
 */
export function serverTick(
  state: ArenaState,
  queues: Map<string, InputMessage[]>,
  dt: number,
  phase: RoomPhase,
): void {
  const world = tickWorldOf(getArena(state.arenaId));
  const moving = phase === RoomPhase.MATCH;
  // Sorted once per tick. This same array fixes both the order players are stepped in and the order
  // of the hulls built from it, so it is threaded through rather than recomputed.
  const ids = sortedSessionIds(state);

  for (const id of ids) {
    const player = state.players.get(id);
    const queue = queues.get(id);
    if (!player || !queue || queue.length === 0) continue;

    // Only `carId` and `others` vary per player; `world` is fixed for the whole tick.
    // A `null` context means "nothing about this player moves right now": drain only.
    const ctx: StepContext | null =
      moving && isOnField(player)
        ? { ...world, carId: carIdOf(player), others: otherCarHulls(state, ids, id) }
        : null;

    // Arrival order is not seq order: `withSimulatedLatency` gives every message its own jittered
    // delay, so two inputs sent a tick apart reorder routinely at the latencies this project
    // simulates. Sorting makes the applied order a function of the client-assigned seq — which is
    // what client-side replay assumes — and guarantees the ack below ends on the highest seq drained
    // rather than on whichever packet happened to land last.
    const batch = queue.splice(0, queue.length).sort(bySeq);

    for (const [index, msg] of batch.entries()) {
      // Past the cap an input is still drained and still acked, but never simulated. Intake is
      // unbounded, so without this a client sending at 4x the tick rate would take 4x as many steps
      // per tick and simply move faster than everyone else. The cap bounds that advantage at
      // `maxInputsPerTick`x — it does not remove it — and the discarded inputs make a flooder
      // diverge from the server, so reconciliation snaps them back. See NET_CONFIG.
      if (ctx !== null && index < NET_CONFIG.maxInputsPerTick) {
        writeBody(player, stepSim(bodyOf(player), msg, dt, ctx));
      }
      player.lastProcessedInputSeq = msg.seq;
    }
  }
}

function bySeq(a: InputMessage, b: InputMessage): number {
  return a.seq - b.seq;
}

/** Only players actually on the field are simulated, and only they are solid to each other. */
function isOnField(player: PlayerState): boolean {
  return player.status === PlayerStatus.IN_MATCH;
}

/** Deterministic iteration order — `MapSchema` hands back insertion order, which the room controls. */
function sortedSessionIds(state: ArenaState): string[] {
  return [...state.players.keys()].sort();
}

/** The parts of a `StepContext` that are identical for every player on this tick. */
type TickWorld = Pick<StepContext, "obstacles" | "bounds">;

function tickWorldOf(arena: ArenaDef): TickWorld {
  return { obstacles: arena.obstacles, bounds: { width: arena.width, height: arena.height } };
}

/**
 * `""` before the car reveal, and anything unrecognised, falls back to the default chassis.
 * `isCarId` is an own-property check: a bare `in` would also accept inherited names like
 * `"constructor"`, whose stat lookup yields undefined and NaNs the whole drive step.
 */
function carIdOf(player: PlayerState): CarId {
  return isCarId(player.carId) ? player.carId : DEFAULT_CAR_ID;
}

/**
 * Hulls of every *other* player currently in the match. Lobby and post-match players are in the
 * room but not on the field, so they must not act as solid walls.
 *
 * `ids` must be sorted, and the resulting array's order is load-bearing rather than cosmetic:
 * `resolveWorld` applies contacts sequentially over `others`, and the last contact resolved is the
 * one guaranteed to end separated. Two hulls swapped here can settle a squeezed car on a different
 * pose, so this order is part of what makes the tick reproducible.
 */
function otherCarHulls(state: ArenaState, ids: readonly string[], selfId: string): Obb[] {
  const hulls: Obb[] = [];
  for (const id of ids) {
    if (id === selfId) continue;
    const other = state.players.get(id);
    if (!other || !isOnField(other)) continue;
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
