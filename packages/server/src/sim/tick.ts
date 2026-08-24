import {
  ArenaState,
  NET_CONFIG,
  PlayerState,
  RoomPhase,
  carIdOf,
  getArena,
  isOnField,
  otherCarHulls,
  stepSim,
  type ArenaDef,
  type ContextEntry,
  type InputMessage,
  type SimBody,
  type StepContext,
} from "@motor-arena/shared";

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
 * The mover gate is deliberately the same predicate as the `others` filter — both are shared
 * `isOnField`. If they diverged, a player who is not in the match would be driven around the arena
 * and would collide with real players while staying invisible to *their* collision checks.
 *
 * `carIdOf` and `otherCarHulls` live in `@motor-arena/shared` because the client's prediction
 * assembles the *same* `StepContext` (see `buildStepContext` in the client's `net/step-context.ts`).
 * `stepSim` is the single lockstep and this is its input, so anything that changes how a hull is
 * sized or which players are solid must change for both sides at once. Edit them there, not here.
 *
 * Players are stepped in sorted `sessionId` order, and resolution is sequential: each player is
 * stepped against the *current* poses of the others, so a player stepped later already sees the
 * updated positions of the players stepped before it. Sorting is what makes that reproducible;
 * `MapSchema` insertion order is not.
 *
 * Within one player, inputs are applied in *seq* order rather than arrival order, and at most
 * `NET_CONFIG.maxInputsPerTick` of them actually reach `stepSim`. See the comments in the drain
 * loop for why each of those matters.
 *
 * Returns the session ids that asked to fire on an input this tick actually **simulated**. Firing
 * rides the same gate as movement rather than the raw key state, so an input past the per-tick cap
 * cannot buy a shot the sim never ran, and a lobby player spamming `fire` never spawns anything.
 * The weapon cooldown in `runCombat`, not this set, is what limits the rate — several fire inputs
 * in one tick still yield at most one shot.
 */
export function serverTick(
  state: ArenaState,
  queues: Map<string, InputMessage[]>,
  dt: number,
  phase: RoomPhase,
): Set<string> {
  const world = tickWorldOf(getArena(state.arenaId));
  const moving = phase === RoomPhase.MATCH;
  // Sorted once per tick. This same array fixes both the order players are stepped in and the order
  // of the hulls built from it, so it is threaded through rather than recomputed.
  const entries = sortedEntries(state);
  const fired = new Set<string>();

  for (const { sessionId, player } of entries) {
    const queue = queues.get(sessionId);
    if (!queue || queue.length === 0) continue;

    // Only `carId` and `others` vary per player; `world` is fixed for the whole tick.
    // A `null` context means "nothing about this player moves right now": drain only.
    const ctx: StepContext | null =
      moving && isOnField(player)
        ? { ...world, carId: carIdOf(player), others: otherCarHulls(entries, sessionId) }
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
        if (msg.fire) fired.add(sessionId);
      }
      player.lastProcessedInputSeq = msg.seq;
    }
  }

  return fired;
}

function bySeq(a: InputMessage, b: InputMessage): number {
  return a.seq - b.seq;
}

/**
 * Players paired with their session id, sorted by it. Deterministic iteration order — `MapSchema`
 * hands back insertion order, which the room controls. The `PlayerState` values ride along so the
 * drain loop can write back to them, and the array doubles as the `ContextEntry[]` that
 * `otherCarHulls` orders its output by.
 */
function sortedEntries(state: ArenaState): Array<ContextEntry & { player: PlayerState }> {
  return [...state.players.entries()]
    .map(([sessionId, player]) => ({ sessionId, player }))
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
}

/** The parts of a `StepContext` that are identical for every player on this tick. */
type TickWorld = Pick<StepContext, "obstacles" | "bounds">;

function tickWorldOf(arena: ArenaDef): TickWorld {
  return { obstacles: arena.obstacles, bounds: { width: arena.width, height: arena.height } };
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
