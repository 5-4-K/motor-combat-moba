export const NET_CONFIG = {
  /**
   * Most inputs one player may have *applied* in a single server tick. An honest client sends one
   * per tick; the headroom absorbs a hitch and the catch-up burst that follows. Inputs past the cap
   * are still drained and still acked, never simulated.
   *
   * This *bounds* a flooder’s advantage at `maxInputsPerTick`x rather than eliminating it: the
   * translation step still runs this many times per tick even once `speed` saturates, so a flooder
   * covers that multiple of an honest client’s distance. Some multiple above 1x is inherent to any
   * per-tick cap, and a cap of 1 would strand honest clients after every network stall. Raising this
   * buys stall headroom and raises the flood ceiling by the same factor.
   */
  // Doubled with the 60 Hz flip (5 -> 10) to keep the same wall-clock coverage; Phase D deletes this.
  maxInputsPerTick: 10,
  /**
   * How long a player's input queue must stay empty before the server concludes their CLIENT has
   * stopped stepping, and starts integrating their car without them (`serverTick`'s silent-coast
   * branch).
   *
   * This is a liveness threshold, not a physics one, and it is the only honest discriminator the
   * server has. `PredictionBuffer.predict` is called once per input the client produces and the
   * client produces exactly one input per sim tick, so **the client never steps a tick it did not
   * send an input for**. Lockstep therefore says: while the client is running, the server must take
   * exactly zero extra steps on an empty-queue tick, whatever the car's velocity looks like. Only
   * once the client has stopped producing inputs at all is an extra server step unobservable to it —
   * and "has it stopped" is a question about elapsed silence, not about `vx`/`vy`/`angVel`.
   *
   * An honest client sends one input per tick (16.7 ms at 60 Hz), so this is roughly fifteen missed
   * ticks — far beyond the reordering and jitter `withSimulatedLatency` produces at the 80–130 ms
   * RTTs this project targets, and short enough that a rammed player who really has gone away is
   * not an immovable wall for long. Raising it makes a disconnected victim freeze for longer;
   * lowering it eventually starts stealing steps from clients that are merely lagging, which
   * reconciliation then has to ease or snap away.
   */
  silentCoastGraceMs: 250,
  // Doubled with the 60 Hz flip (24 -> 48) to keep the same wall-clock coverage (800 ms of inputs);
  // Phase D deletes this.
  pendingInputCap: 48,
  reconcileSnapPos: 24,
  reconcileSnapAngle: 0.6,
  /**
   * Fraction of the reconcile error eased away per `reconcileEaseReferenceMs` of snapshots — authored
   * as "per one 20 Hz snapshot" (50 ms), the rate it was tuned at. The client applies it per
   * snapshot through `reconcileEasePerSnapshot()`, which rescales it to `SNAPSHOT_RATE_HZ`, so
   * tripling the snapshot rate did not triple how fast the correction lands.
   */
  reconcileEaseRate: 0.25,
  /** The wall-clock span `reconcileEaseRate` is authored over, in ms (one 20 Hz snapshot). */
  reconcileEaseReferenceMs: 50,
  interpolationDelayMs: 50,
  /**
   * How far past its last snapshot the client may extrapolate a live weapon instance before it
   * freezes it in place, so a stalled connection cannot fling a stale shot across the arena while
   * the client waits for the delete that already happened.
   *
   * It was "one patch interval" (`1000 / DEFAULT_PATCH_RATE_HZ`, 50 ms) until NR12 deleted the patch
   * rate and made snapshots one per tick. It keeps its old wall-clock value rather than shrinking to
   * one snapshot interval (16.7 ms at 60 Hz): at that cap an ordinary jittered gap between two
   * snapshots would stall a shot on screen, which is the opposite of the cap's purpose.
   */
  shotExtrapolationCapMs: 50,
} as const;
