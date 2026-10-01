import type { Client } from "@colyseus/core";
import { CLOSE_CODES, TICK_RATE_HZ } from "@motor-combat-moba/shared";

/**
 * A token bucket: `burst` tokens to start, refilled at `ratePerSec`, never above `burst`. A message
 * costs one token; with none left it is refused.
 */
export class TokenBucket {
  private tokens: number;
  private lastMs = Number.NaN;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }

  take(nowMs: number): boolean {
    if (!Number.isNaN(this.lastMs) && nowMs > this.lastMs) {
      this.tokens = Math.min(this.burst, this.tokens + ((nowMs - this.lastMs) * this.ratePerSec) / 1000);
    }
    if (Number.isNaN(this.lastMs) || nowMs > this.lastMs) this.lastMs = nowMs;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Whole tokens left after the last `take`. */
  get available(): number {
    return Math.floor(this.tokens);
  }
}

/** Which budget a message is charged to (NR54). */
export type MessageKind = "input" | "time" | "lobby";

/**
 * NR54's budgets, per client. `input` is twice the tick rate — an honest client sends one packet per
 * tick, and the burst of 30 (half a second of them) covers a scheduler catch-up after a frame stall and
 * a TCP retransmit releasing a held run of packets at once. `time` covers `MSG_TIME` requests (10/s at
 * most, during the join burst) plus the 1/s `MSG_PING` echo. `lobby` is every other message: clicks.
 */
export const RATE_BUDGETS: Readonly<Record<MessageKind, { ratePerSec: number; burst: number }>> = {
  input: { ratePerSec: 2 * TICK_RATE_HZ, burst: 30 },
  time: { ratePerSec: 20, burst: 20 },
  lobby: { ratePerSec: 10, burst: 10 },
};

/** A client continuously over any one limit for longer than this is disconnected (NR54). */
export const RATE_LIMIT_KICK_MS = 5000;
/**
 * A run of refusals is "continuous" while refusals keep coming at least this often. A client that
 * went over once and then stopped sending that kind is not still over the limit seconds later.
 */
const RUN_GAP_MS = 1000;

interface KindState {
  bucket: TokenBucket;
  /** Start of the current run of refusals, or NaN when not in one. */
  runStart: number;
  lastRefusalMs: number;
}

/**
 * Per-client message budgets (NR54): a token bucket per client per `MessageKind`. Over-limit messages
 * are refused and counted. `overLimitFor` says how long the client has been over its worst limit
 * without a break, which the rooms turn into a disconnect past `RATE_LIMIT_KICK_MS`.
 *
 * A run of refusals is broken by an allowed call that leaves the bucket with tokens to spare (the
 * client is back under its rate), or by `RUN_GAP_MS` without a refusal. An allowed call on an EMPTY
 * bucket does not break it: a flood is let through at exactly the refill rate, and those trickled
 * messages are the flood, not a pause in it.
 */
export class ClientLimits {
  private readonly sessions = new Map<string, Record<MessageKind, KindState>>();
  private readonly dropped = new Map<string, number>();
  private readonly kicked = new Set<string>();

  private stateOf(sessionId: string): Record<MessageKind, KindState> {
    let s = this.sessions.get(sessionId);
    if (s === undefined) {
      const kind = (k: MessageKind): KindState => ({
        bucket: new TokenBucket(RATE_BUDGETS[k].ratePerSec, RATE_BUDGETS[k].burst),
        runStart: Number.NaN,
        lastRefusalMs: Number.NaN,
      });
      s = { input: kind("input"), time: kind("time"), lobby: kind("lobby") };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  allow(sessionId: string, kind: MessageKind, nowMs: number): boolean {
    const k = this.stateOf(sessionId)[kind];
    if (k.bucket.take(nowMs)) {
      if (k.bucket.available >= 1) k.runStart = Number.NaN;
      return true;
    }
    this.dropped.set(sessionId, (this.dropped.get(sessionId) ?? 0) + 1);
    if (Number.isNaN(k.runStart) || nowMs - k.lastRefusalMs > RUN_GAP_MS) k.runStart = nowMs;
    k.lastRefusalMs = nowMs;
    return false;
  }

  /** Milliseconds this client has been continuously over its worst limit; 0 when it is not over one. */
  overLimitFor(sessionId: string, nowMs: number): number {
    const s = this.sessions.get(sessionId);
    if (s === undefined) return 0;
    let worst = 0;
    for (const k of [s.input, s.time, s.lobby]) {
      if (Number.isNaN(k.runStart) || nowMs - k.lastRefusalMs > RUN_GAP_MS) continue;
      worst = Math.max(worst, nowMs - k.runStart);
    }
    return worst;
  }

  /** How many of this client's messages have been refused (NR54: dropped and counted). */
  droppedFor(sessionId: string): number {
    return this.dropped.get(sessionId) ?? 0;
  }

  /** True the first time it is called for a session, so a disconnect is issued (and logged) once. */
  markKicked(sessionId: string): boolean {
    if (this.kicked.has(sessionId)) return false;
    this.kicked.add(sessionId);
    return true;
  }

  drop(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.dropped.delete(sessionId);
    this.kicked.delete(sessionId);
  }
}

/** The part of a Colyseus `Client` the gate needs. */
export interface LimitedClient {
  readonly sessionId: string;
  leave(code?: number, reason?: string): void;
}

/**
 * The gate every room message handler runs first (NR54): charge the message to its budget, and
 * refuse it when over. A client that has been over any limit for more than `RATE_LIMIT_KICK_MS`
 * straight is disconnected with `CLOSE_CODES.RATE_LIMITED`.
 */
export function admit(limits: ClientLimits, client: LimitedClient, kind: MessageKind, nowMs: number): boolean {
  if (limits.allow(client.sessionId, kind, nowMs)) return true;
  if (limits.overLimitFor(client.sessionId, nowMs) > RATE_LIMIT_KICK_MS && limits.markKicked(client.sessionId)) {
    console.warn(
      `[net] disconnecting ${client.sessionId}: over a message rate limit for ${RATE_LIMIT_KICK_MS} ms ` +
        `(${limits.droppedFor(client.sessionId)} messages dropped)`,
    );
    client.leave(CLOSE_CODES.RATE_LIMITED, "Too many messages");
  }
  return false;
}

/** Wraps a room message handler in `admit`, charged to `kind`, reading the wall clock. */
export function limited<M = unknown>(
  limits: ClientLimits,
  kind: MessageKind,
  handler: (client: Client, msg: M) => void,
): (client: Client, msg: M) => void {
  return (client, msg) => {
    if (!admit(limits, client, kind, Date.now())) return;
    handler(client, msg);
  };
}

/**
 * Fail-closed on a message type the room never registered: disconnect at once with
 * `CLOSE_CODES.UNKNOWN_MESSAGE`. That is Colyseus 0.18's own production default for an unhandled
 * type; registering `"*"` only puts our code on it. No client of this build ever sends one.
 * Colyseus routes a message to `"*"` only when no handler for its type exists.
 */
export function refuseUnknownMessages(
  room: { onMessage(type: "*", handler: (client: Client, type: string | number, message: unknown) => void): unknown },
): void {
  room.onMessage("*", (client, type) => {
    console.warn(`[net] disconnecting ${client.sessionId}: unregistered message type ${JSON.stringify(type)}`);
    client.leave(CLOSE_CODES.UNKNOWN_MESSAGE, "Unknown message type");
  });
}

/**
 * Colyseus's own pre-decode backstop (`Room.maxMessagesPerSecond`): a client past this many messages
 * in one second is dropped before any message is decoded, with Colyseus's WITH_ERROR. It must sit
 * above anything the token buckets above could ever admit, so it only ever fires on a client they are
 * already refusing: the sum of the three refill rates (120 + 20 + 10 = 150/s) plus all three full
 * bursts (30 + 20 + 10 = 60) is 210 admitted in any one second. An honest client sends ~60 inputs,
 * at most ~11 time messages and a handful of clicks a second (~80), so 240 leaves it 3x headroom and
 * still bounds a flooder's decode cost.
 */
export const MAX_MESSAGES_PER_SECOND = 240;
