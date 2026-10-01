/**
 * The dev-only latency injector (NR56). Off unless `SIM_LATENCY_MS` or `SIM_JITTER_MS` is set; a
 * release build leaves both unset and every function here hands back what it was given.
 *
 * Both directions ride a `DelayLine`, which is what a WebSocket is: in order and reliable. Each
 * message is delayed by `latencyMs` plus a uniform `±jitterMs`; with probability `lossPct` % it is
 * "lost" and retransmitted one round trip (`2 × latencyMs`) later, and because delivery is in order
 * everything sent after it waits too — the netsim harness's `Link` model, on real timers.
 */
export interface LatencyConfig {
  latencyMs: number;
  jitterMs: number;
  /** Chance, in percent, that a message is lost and retransmitted one round trip later. */
  lossPct: number;
}

/** Whether a config delays anything. Loss alone, with no latency to retransmit over, is nothing. */
export function latencyActive(cfg: LatencyConfig): boolean {
  return cfg.latencyMs > 0 || cfg.jitterMs > 0;
}

/** One direction of one simulated socket: in order, jittered, with loss as a retransmit delay. */
export class DelayLine {
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly cfg: LatencyConfig,
    private readonly rand: () => number = Math.random,
  ) {}

  schedule(fn: () => void): void {
    const now = Date.now();
    let at = now + this.cfg.latencyMs;
    if (this.cfg.jitterMs > 0) at += (this.rand() * 2 - 1) * this.cfg.jitterMs;
    if (this.cfg.lossPct > 0 && this.rand() < this.cfg.lossPct / 100) at += 2 * this.cfg.latencyMs;
    at = Math.max(at, this.lastAt, now);
    this.lastAt = at;
    setTimeout(fn, at - now);
  }
}

/**
 * Client → server: wraps a room's input delivery. `keyOf` names the socket a message came in on (the
 * session id), so each client's inputs keep their own order and one client's loss does not hold
 * another's; without it the whole room shares one line.
 */
export function withSimulatedLatency<T>(
  deliver: (msg: T) => void,
  cfg: LatencyConfig,
  keyOf: (msg: T) => string = () => "",
): (msg: T) => void {
  if (!latencyActive(cfg)) return deliver;
  const lines = new Map<string, DelayLine>();
  return (msg: T) => {
    const key = keyOf(msg);
    let line = lines.get(key);
    if (line === undefined) {
      line = new DelayLine(cfg);
      lines.set(key, line);
    }
    line.schedule(() => deliver(msg));
  };
}

/** The part of a Colyseus `Client` every outgoing frame goes through. */
export interface RawClient {
  readonly sessionId: string;
  raw(data: Uint8Array | Buffer, options?: unknown, cb?: (err?: Error) => void): void;
}

/**
 * Server → client (NR56): each client gets its own `DelayLine`, and `wrapClient` routes EVERY frame
 * to that client through it — snapshots (`broadcastPatch`), `client.send` replies (the `MSG_TIME`
 * pong, `MSG_PING`), errors — because in Colyseus 0.18 all of them leave through the one per-client
 * `client.raw`. The bytes are copied at send time: the serializer reuses one encode buffer, and a
 * delayed frame must be the tick it was encoded at, not whatever that buffer holds later.
 *
 * Wrapping `client.raw` is the per-client seam D5 ruling F asked about. It is one method on the
 * transport's client object, not the room's patch internals, and it is only ever installed when
 * `latencyActive` — so a release build, or a dev server without `SIM_LATENCY_MS`, never touches it.
 */
export class OutgoingDelay {
  private readonly lines = new Map<string, DelayLine>();

  constructor(
    private readonly cfg: LatencyConfig,
    private readonly rand: () => number = Math.random,
  ) {}

  get active(): boolean {
    return latencyActive(this.cfg);
  }

  /** Run `send` on this client's line: after its simulated one-way delay, in order with its frames. */
  delayOutgoing(client: { readonly sessionId: string }, send: () => void): void {
    if (!this.active) {
      send();
      return;
    }
    let line = this.lines.get(client.sessionId);
    if (line === undefined) {
      line = new DelayLine(this.cfg, this.rand);
      this.lines.set(client.sessionId, line);
    }
    line.schedule(send);
  }

  /** Route every frame this client is sent through its line. A no-op when inactive. */
  wrapClient(client: RawClient): void {
    if (!this.active) return;
    const raw = client.raw.bind(client);
    client.raw = (data, options, cb) => {
      const copy = Buffer.from(data);
      this.delayOutgoing(client, () => raw(copy, options, cb));
    };
  }

  drop(sessionId: string): void {
    this.lines.delete(sessionId);
  }
}
