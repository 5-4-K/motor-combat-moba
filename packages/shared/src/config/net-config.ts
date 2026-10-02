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
  /** Where the client's slack feedback steers the mean input lead, in ticks (NR21). */
  targetSlackTicks: 1.5,
  /**
   * How many ticks of target the client adds per tick of server-reported slack spread
   * (`PlayerState.inputSlackStd`) beyond integer quantisation's 0.5 (NR21, D5 ruling E; see
   * `SLACK_QUANTISATION_STD_TICKS`), so a jittery input path aims its mean further from the late edge
   * instead of landing its slow tail late. A steady path keeps the plain target.
   *
   * D6 measured it (netsim, six cars, 60 s, mean of seeds 1–3; D5 baseline net80 3.53 % repeats at
   * 80.45 ms input-to-server). Raising it buys a lossy link fewer repeats with more latency: at K 8
   * with the gain halved to 0.015, net80 repeated 1.84 % at 112.35 ms. It stays 1 by ruling — latency
   * first, and a lossy link's repeats land only on that link's own player. At K 1 (gain 0.03, late
   * samples floored at -1): lan 33.99 ms, net80clean 74.32 ms / 0.39 %, net80 78.28 ms / 3.69 %,
   * net150 117.96 ms / 8.14 %.
   */
  slackSpreadK: 1,
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
  /** Floor of the adaptive remote render delay, ms (NR30). */
  minDelayMs: 33,
  /** Ceiling of the adaptive remote render delay, ms (NR30). */
  maxDelayMs: 250,
  /** Longest a remote is dead-reckoned past its newest snapshot before it holds, ms (NR31, NR32). */
  maxExtrapolateMs: 100,
  /**
   * The remote settle ease, ms. It times three things: the ease from an extrapolated (or held) drawn
   * pose onto the path once a fresh snapshot lands or the hold ends (NR31); the contact blend's
   * final-pose settle after a snapshot rebases the reckoning or the anchor tick jumps; and the
   * contact blend weight's slew, at most `frameMs / extrapolateSettleMs` per frame (NR34).
   */
  extrapolateSettleMs: 100,
  /**
   * Distance, in car lengths, within which a remote's DRAWN pose is blended toward its dead-reckoned
   * pose at the local car's predicted tick (full weight at one car length), so what you can hit is
   * what you see (NR34).
   */
  contactBlendRangeCars: 2,
  /**
   * A remote that moves more than this many car lengths between two snapshots has teleported (a
   * respawn, a reset): its interpolation and dead reckoning are dropped rather than blended across
   * the jump (NR29, NR31).
   */
  remoteTeleportCars: 3,
  /**
   * The most rewind any press may earn, in ms (NR36): a freshly born shot is fast-forwarded at most
   * `msToTicks(shotCompCapMs)` ticks, however the client's link measures. Compensation is paid by the
   * victim, so it is sized from what an HONEST client on the good connection needs and no link earns
   * more (the D6 ruling on NR36): `net80clean`'s measured p95 shot staleness (`tick − viewTick`),
   * rounded up to a whole tick.
   *
   * Measured at 27169355 + the F1 staleness metric (netsim baseline, six cars, 60 s, seeds 1–3), in
   * ticks p50 / p95 / max: lan 4 / 5 / 5, net80clean 9 / 9 / 9, net80 10 / 12 / 13–14, net150
   * 16–17 / 20–21 / 22–23. net80clean's p95 is 9 ticks = 150 ms.
   */
  shotCompCapMs: 150,
  /**
   * NR36's `allowedDelayMs` counts this many snapshot intervals of display delay an honest client may
   * draw remotes behind (the delay is a lateness p95 plus one interval; the second covers the floor of
   * `viewTick` and frame phase).
   */
  shotCompDelaySnapshots: 2,
  /**
   * ...plus this many standard deviations of the server-measured input slack (NR36's "2 × the
   * input-arrival jitter"), so a client whose lead wobbles is not clamped on its slow presses. The
   * cap, not this term, is what bounds a jittery link (D6 ruling).
   */
  shotCompSlackStds: 2,
} as const;
