import { MS_PER_TICK, NET_CONFIG, SNAPSHOT_RATE_HZ, msToTicks } from "@motor-combat-moba/shared";

/** What the server knows about one press when it prices its compensation (NR36). */
export interface CompInputs {
  /** The tick the pressing input frame is FOR (`P`). */
  pressTick: number;
  /** The render tick the client says it was drawing remotes at when it produced that frame (NR35). */
  viewTick: number | undefined;
  /**
   * The session's compensation RTT (`NetSessions.compRttMs`: NR19's app RTT bounded by the transport
   * ping RTT), or undefined before the first echo.
   */
  rttMs: number | undefined;
  /** The server-measured mean input slack of this session, ticks (NR21). */
  slackMeanTicks: number;
  /** The server-measured spread of that slack, ticks (D5 ruling E). */
  slackStdTicks: number;
}

/**
 * How many ticks a freshly born shot from this press is fast-forwarded (NR36, NR37):
 * `clamp(pressTick − viewTick, 0, min(capTicks, allowedTicks))`.
 *
 * `allowedTicks` is what an honest client on this measured link could be behind (from the server's
 * full RTT, slack mean and spread, and two snapshot intervals); `capTicks`
 * (`NET_CONFIG.shotCompCapMs`) is the most ANY link earns, sized from the honest good connection's
 * need, because the victim pays for every tick of it and a bad link must not buy more (D6 ruling).
 * A client that lies about `viewTick` gains at most the gap between its true staleness and that; the
 * RTT it is priced from is bounded by a WebSocket pong page JS cannot delay, and the cap bounds the rest.
 *
 * Without a `viewTick` (a bot, a harness, a frame from before the client's clock synced) or a
 * measured RTT, the press gets none.
 */
export function shotCompTicks(i: CompInputs): number {
  if (i.viewTick === undefined || i.rttMs === undefined) return 0;
  const capTicks = msToTicks(NET_CONFIG.shotCompCapMs);
  const snapshotMs = 1000 / SNAPSHOT_RATE_HZ;
  // The FULL round trip, not half: an honest client's staleness is its input lead (the uplink half
  // plus slack) AND its remote display delay, which carries the downlink half (`DisplayDelay`). With
  // rtt/2 an honest net80clean client measured 9 ticks stale but was allowed 7 (F1).
  const allowedMs =
    i.rttMs +
    i.slackMeanTicks * MS_PER_TICK +
    NET_CONFIG.shotCompDelaySnapshots * snapshotMs +
    NET_CONFIG.shotCompSlackStds * i.slackStdTicks * MS_PER_TICK;
  const allowedTicks = Math.ceil(allowedMs / MS_PER_TICK);
  const stale = i.pressTick - i.viewTick;
  return Math.max(0, Math.min(stale, capTicks, allowedTicks));
}
