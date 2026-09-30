import type { Client, Room } from "@colyseus/core";
import {
  MS_PER_TICK,
  MSG_PING,
  MSG_TIME,
  isPingEcho,
  isTimeRequest,
  type TimePong,
} from "@motor-combat-moba/shared";

/** How many echoed pings a session's RTT median spans (NR19). */
const RTT_SAMPLES = 8;
/** How often the server probes every client for its RTT (NR19). */
const PING_INTERVAL_MS = 1000;

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

  markTick(tick: number, dueWallMs: number): void {
    this.lastTick = tick;
    this.lastDueMs = dueWallMs;
  }

  pong(c: number, wallMs: number): TimePong {
    if (Number.isNaN(this.lastDueMs)) return { c, t: this.lastTick, p: 0 };
    const p = Math.min(MS_PER_TICK - 0.001, Math.max(0, wallMs - this.lastDueMs));
    return { c, t: this.lastTick, p };
  }

  pingPayload(wallMs: number): { s: number } {
    return { s: wallMs };
  }

  onPingEcho(sessionId: string, s: number, wallMs: number): void {
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
  }
}

/**
 * Registers the time-sync handlers on a room: `MSG_TIME` is answered with a pong, `MSG_PING` records an
 * echo, and a 1 s room interval probes every client. Handler bodies run inside `scope` (the room's own
 * mode scope). Both handlers validate with the wire guards and silently ignore anything else.
 */
export function installNetHandlers(
  room: Room,
  sessions: NetSessions,
  scope: <T>(fn: () => T) => T,
): void {
  room.onMessage(MSG_TIME, (client: Client, msg: unknown) =>
    scope(() => {
      if (!isTimeRequest(msg)) return;
      client.send(MSG_TIME, sessions.pong(msg.c, Date.now()));
    }),
  );
  room.onMessage(MSG_PING, (client: Client, msg: unknown) =>
    scope(() => {
      if (!isPingEcho(msg)) return;
      sessions.onPingEcho(client.sessionId, msg.s, Date.now());
    }),
  );
  room.clock.setInterval(() => {
    scope(() => {
      const payload = sessions.pingPayload(Date.now());
      for (const client of room.clients) client.send(MSG_PING, payload);
    });
  }, PING_INTERVAL_MS);
}
