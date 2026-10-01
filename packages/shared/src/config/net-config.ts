export const NET_CONFIG = {
  /**
   * Most fixed sim steps a room runs in one wall-clock frame of its simulation interval
   * (`rooms/fixed-step.ts`). The rooms bank the measured frame time and run one tick per whole
   * `MS_PER_TICK` banked, so the long-run rate is exactly `TICK_RATE_HZ` even though Node truncates
   * the 16.67 ms interval to 16 ms. After a stall (GC, a blocked event loop) a frame runs at most
   * this many catch-up ticks and drops the rest of the backlog instead of spiralling; 5 ticks is
   * ~83 ms of catch-up at 60 Hz, which covers an ordinary hitch without a visible burst.
   */
  maxCatchUpTicks: 5,
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
  /**
   * How many ticks of target the client adds per tick of server-reported slack spread
   * (`PlayerState.inputSlackStd`) beyond integer quantisation's 0.5 (NR21, D5 ruling E; see
   * `SLACK_QUANTISATION_STD_TICKS`), so a jittery input path aims its mean further from the late edge
   * instead of landing its slow tail late. A steady path keeps the plain target.
   *
   * 1 until D6, which measured it (netsim, six cars, 60 s, mean of seeds 1-3) with the scheduler's
   * gain at 0.015: at 1, net80 repeated 3.7 % of car-ticks against a 2 % target — its 1 % loss holds
   * every input behind a lost one for 80 ms, and only spread tells that path from LAN, whose slack is
   * steady. At 8, net80 repeats 1.84 % (input-to-server 80 -> 112 ms) while LAN stays at 33.9 ms;
   * 10 and 12 buy 1.54 % and 1.32 % for 122 and 133 ms. `targetSlackTicks` cannot do this job: it
   * moves LAN as much as net80, and below 1.5 the clock-jitter acceptance envelope lands inputs late.
   */
  slackSpreadK: 8,
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
