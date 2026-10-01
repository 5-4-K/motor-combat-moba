import type { Client, Room } from "@colyseus/core";
import {
  MS_PER_TICK,
  MSG_PING,
  MSG_TIME,
  isPingEcho,
  isTimeRequest,
  type TimePong,
} from "@motor-combat-moba/shared";
import { limited, type ClientLimits } from "./rate-limit.js";

/** How many echoed pings a session's RTT median spans (NR19). */
const RTT_SAMPLES = 8;
/** How often the server probes every client for its RTT (NR19). */
const PING_INTERVAL_MS = 1000;
/**
 * How many of a session's most recently sent ping stamps an echo may answer (D5 ruling C). Four
 * seconds of pings at `PING_INTERVAL_MS`: an echo older than that is not a round trip worth trusting.
 */
const OUTSTANDING_PINGS = 4;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/**
 * A room's time-sync state (NR18, NR19): the tick grid a pong describes and each session's measured RTT.
 *
 * The grid is set by `markTick(tick, dueWallMs)` with the DUE time of the last completed tick — not the
 * wall time the interval callback happened to run — so `t` and `p` in a pong describe the steady 60 Hz
 * grid and not the jitter of the timer. Both come from that one pair and the asking time, never from
 * separately rounded values.
 */
export class NetSessions {
  private lastTick = 0;
  private lastDueMs = Number.NaN;
  private readonly rtts = new Map<string, number[]>();
  /** Stamps sent to each session and not yet echoed, oldest first (D5 ruling C). */
  private readonly outstanding = new Map<string, number[]>();

  markTick(tick: number, dueWallMs: number): void {
    this.lastTick = tick;
    this.lastDueMs = dueWallMs;
  }

  pong(c: number, wallMs: number): TimePong {
    if (Number.isNaN(this.lastDueMs)) return { c, t: this.lastTick, p: 0 };
    const p = Math.min(MS_PER_TICK - 0.001, Math.max(0, wallMs - this.lastDueMs));
    return { c, t: this.lastTick, p };
  }

  /** The ping to send this session now; its stamp is remembered so only a real echo of it counts. */
  pingPayload(sessionId: string, wallMs: number): { s: number } {
    let sent = this.outstanding.get(sessionId);
    if (sent === undefined) {
      sent = [];
      this.outstanding.set(sessionId, sent);
    }
    sent.push(wallMs);
    if (sent.length > OUTSTANDING_PINGS) sent.shift();
    return { s: wallMs };
  }

  /**
   * Records an echo's RTT — only when `s` is one of the last `OUTSTANDING_PINGS` stamps sent to THIS
   * session, and only once per stamp (D5 ruling C). The server's RTT will cap shot compensation
   * (Phase F), so a client that could echo an invented old stamp could buy itself a longer window.
   */
  onPingEcho(sessionId: string, s: number, wallMs: number): void {
    const sent = this.outstanding.get(sessionId);
    const at = sent === undefined ? -1 : sent.indexOf(s);
    if (at < 0) return;
    sent!.splice(at, 1);
    const rtt = wallMs - s;
    if (!Number.isFinite(rtt) || rtt < 0) return;
    let ring = this.rtts.get(sessionId);
    if (ring === undefined) {
      ring = [];
      this.rtts.set(sessionId, ring);
    }
    ring.push(rtt);
    if (ring.length > RTT_SAMPLES) ring.shift();
  }

  /** Median of the session's last 8 echoes, or undefined before the first. */
  rttMs(sessionId: string): number | undefined {
    const ring = this.rtts.get(sessionId);
    return ring === undefined || ring.length === 0 ? undefined : median(ring);
  }

  drop(sessionId: string): void {
    this.rtts.delete(sessionId);
    this.outstanding.delete(sessionId);
  }
}

/**
 * Registers the time-sync handlers on a room: `MSG_TIME` is answered with a pong, `MSG_PING` records an
 * echo, and a 1 s room interval probes every client. Handler bodies run inside `scope` (the room's own
 * mode scope). Both handlers are charged to the `"time"` budget (NR54) first, then validate with the
 * wire guards and silently ignore anything else. Replies leave through `client.send`, which the
 * room's `OutgoingDelay` (NR56) delays when latency injection is on.
 */
export function installNetHandlers(
  room: Room,
  sessions: NetSessions,
  scope: <T>(fn: () => T) => T,
  limits: ClientLimits,
): void {
  room.onMessage(
    MSG_TIME,
    limited(limits, "time", (client: Client, msg: unknown) =>
      scope(() => {
        if (!isTimeRequest(msg)) return;
        client.send(MSG_TIME, sessions.pong(msg.c, Date.now()));
      }),
    ),
  );
  room.onMessage(
    MSG_PING,
    limited(limits, "time", (client: Client, msg: unknown) =>
      scope(() => {
        if (!isPingEcho(msg)) return;
        sessions.onPingEcho(client.sessionId, msg.s, Date.now());
      }),
    ),
  );
  room.clock.setInterval(() => {
    scope(() => {
      const now = Date.now();
      for (const client of room.clients) client.send(MSG_PING, sessions.pingPayload(client.sessionId, now));
    });
  }, PING_INTERVAL_MS);
}
