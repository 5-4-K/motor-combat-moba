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
  // Doubled with the 60 Hz flip (5 -> 10). Catch-up coverage in wall-clock ms is unchanged by the
  // doubling (10 ticks of 16.7 ms = 5 ticks of 33.3 ms), but the per-SECOND flood ceiling is not: a
  // flooder now applies up to 10x an honest car's steps per second where it was 5x, because the
  // cap is per tick and there are twice as many ticks. Accepted because the game is LAN-only, and
  // Phase D deletes this knob outright.
  maxInputsPerTick: 10,
  /**
   * Most fixed sim steps a room runs in one wall-clock frame of its simulation interval
   * (`rooms/fixed-step.ts`). The rooms bank the measured frame time and run one tick per whole
   * `MS_PER_TICK` banked, so the long-run rate is exactly `TICK_RATE_HZ` even though Node truncates
   * the 16.67 ms interval to 16 ms. After a stall (GC, a blocked event loop) a frame runs at most
   * this many catch-up ticks and drops the rest of the backlog instead of spiralling; 5 ticks is
   * ~83 ms of catch-up at 60 Hz, which covers an ordinary hitch without a visible burst.
   */
  maxCatchUpTicks: 5,
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
  /** Where the client's slack feedback steers the mean input lead, in ticks (NR21). */
  targetSlackTicks: 1.5,
  /** Most the client's tick clock may run faster or slower than nominal while steering slack (NR21). */
  maxDilation: 0.04,
  /** How long a missing input repeats the last real one before the car goes neutral (NR22). */
  inputRepeatMs: 250,
  /** Inputs stamped further ahead than this past the next tick are dropped, not buffered (NR22). */
  maxInputLeadMs: 250,
  /** Previous frames each input packet repeats alongside the newest, so a lost packet costs nothing (NR24). */
  inputRedundancy: 3,
  /** Most ticks the CLIENT scheduler runs in one frame after a stall before it resyncs and skips (NR20). */
  clientMaxCatchUpTicks: 8,
  /**
   * Fastest the client's server-clock estimate may slew, in ms of offset per second of wall time
   * (NR18). It also caps the fitted drift at +-clockSlewMsPerSec / 1000 (2 %).
   */
  clockSlewMsPerSec: 20,
  /**
   * A clock-estimate correction larger than this, in ms, snaps instead of slewing (NR18). Two pongs in
   * a row more than twice this off, beyond what their RTT explains, are taken as a server clock step.
   */
  clockSnapMs: 50,
  /**
   * How much pong history, in ms, the drift fit covers (NR18). Long, so jitter and spikes average out
   * of the slope; a route change biases the slope only while the old route's samples are in it.
   */
  clockFitWindowMs: 24_000,
  /** The drift fit keeps its previous slope until it has this many samples... (NR18) */
  clockMinFitSamples: 6,
  /** ...spanning at least this many ms, so a thin early window cannot fit a noisy slope (NR18). */
  clockMinFitSpanMs: 4_000,
  /**
   * The newest span, in ms, whose weighted samples set the clock offset (NR18). This is also how long
   * an asymmetric route change takes to be believed: until the old route's low-RTT samples age out of
   * it, the new, slower samples are outweighed.
   */
  clockOffsetWindowMs: 6_000,
  /**
   * A pong's weight in the clock fits is 1 / (clockWeightFloorMs + excess / 2)^2, where excess is its
   * RTT above the window's minimum (NR18). Half the excess bounds how far the pong's offset can be
   * wrong; the floor keeps near-minimum pongs weighted about equally, so jitter averages out, while a
   * 250 ms spike weighs about 0.5 % of a clean pong.
   */
  clockWeightFloorMs: 10,
  /** `ClockSync.rttMs()` is the median of per-bucket minimum RTTs over this many ms (NR18, NR20)... */
  clockRttWindowMs: 12_000,
  /** ...in buckets this many ms wide, so a streak of spiked pongs cannot move the lead (NR18, NR20). */
  clockRttBucketMs: 2_000,
  /** Steady-state interval between MSG_TIME clock-sync pings (NR18). */
  timeSyncIntervalMs: 500,
  /** Ping interval during the join burst (NR18). */
  timeSyncBurstMs: 100,
  /** How long after joining the burst interval applies (NR18). */
  timeSyncBurstWindowMs: 1000,
} as const;
