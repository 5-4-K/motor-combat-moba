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
  maxInputsPerTick: 5,
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
   * An honest client sends one input per tick (33 ms at 30 Hz), so this is roughly eight missed
   * ticks — far beyond the reordering and jitter `withSimulatedLatency` produces at the 80–130 ms
   * RTTs this project targets, and short enough that a rammed player who really has gone away is
   * not an immovable wall for long. Raising it makes a disconnected victim freeze for longer;
   * lowering it eventually starts stealing steps from clients that are merely lagging, which
   * reconciliation then has to ease or snap away.
   */
  silentCoastGraceMs: 250,
  pendingInputCap: 24,
  reconcileSnapPos: 24,
  reconcileSnapAngle: 0.6,
  reconcileEaseRate: 0.25,
  interpolationDelayMs: 50,
} as const;
