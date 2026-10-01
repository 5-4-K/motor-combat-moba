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

/**
 * One direction of one simulated socket: in order, jittered, with loss as a retransmit delay.
 *
 * A FIFO with ONE timer, armed for its head — never a `setTimeout` per message. Node arms each timer
 * from its cached loop time, so two timers with the same absolute due time armed in different loop
 * iterations can fire inverted (measured: 1–5 inversions per 600 messages), and an out-of-order
 * schema patch breaks the client's decoder. When the timer fires it drains every entry already due,
 * in order, then re-arms for the new head.
 */
export class DelayLine {
  private lastAt = Number.NEGATIVE_INFINITY;
  private readonly queue: { at: number; fn: () => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

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
    this.queue.push({ at, fn });
    if (this.timer === undefined) this.arm(now);
  }

  /** Drops everything still queued (the socket closed). */
  clear(): void {
    this.queue.length = 0;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(now: number): void {
    const head = this.queue[0];
    if (head === undefined) return;
    this.timer = setTimeout(() => this.drain(), Math.max(0, head.at - now));
  }

  private drain(): void {
    this.timer = undefined;
    const now = Date.now();
    try {
      while (this.queue.length > 0 && this.queue[0]!.at <= now) this.queue.shift()!.fn();
    } finally {
      // Re-armed even if a delivery threw, so one bad message cannot stall the rest of the line.
      this.arm(now);
    }
  }
}

/**
 * Client → server: a room's input delivery, delayed. `keyOf` names the socket a message came in on
 * (the session id), so each client's inputs keep their own order and one client's loss does not hold
 * another's. `drop(key)` forgets a departed client's line and anything still queued on it.
 */
export class InputDelay<T> {
  private readonly lines = new Map<string, DelayLine>();

  constructor(
    private readonly deliver: (msg: T) => void,
    private readonly cfg: LatencyConfig,
    private readonly keyOf: (msg: T) => string = () => "",
  ) {}

  offer(msg: T): void {
    if (!latencyActive(this.cfg)) {
      this.deliver(msg);
      return;
    }
    const key = this.keyOf(msg);
    let line = this.lines.get(key);
    if (line === undefined) {
      line = new DelayLine(this.cfg);
      this.lines.set(key, line);
    }
    line.schedule(() => this.deliver(msg));
  }

  drop(key: string): void {
    this.lines.get(key)?.clear();
    this.lines.delete(key);
  }
}

/** `InputDelay` as a bare function: `deliver` itself, unwrapped, when no latency is configured. */
export function withSimulatedLatency<T>(
  deliver: (msg: T) => void,
  cfg: LatencyConfig,
  keyOf: (msg: T) => string = () => "",
): (msg: T) => void {
  if (!latencyActive(cfg)) return deliver;
  const delay = new InputDelay(deliver, cfg, keyOf);
  return (msg: T) => delay.offer(msg);
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
    this.lines.get(sessionId)?.clear();
    this.lines.delete(sessionId);
  }
}
