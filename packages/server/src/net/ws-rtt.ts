/**
 * The transport-level RTT of each client (NR36 fix round 1): a WebSocket PING control frame per probe,
 * timed to its PONG. It bounds the RTT shot compensation is priced from, and nothing else — clock sync
 * (NR18) and the app-level `MSG_PING` RTT (NR19) never read it.
 *
 * Why a second RTT: an app-level `MSG_PING` echo is sent by page JavaScript, so a modified client can
 * hold its echoes back and inflate the server's `rttMs` for free — the echo path is separate from its
 * inputs, so it pays no latency — and so buy compensation up to `shotCompCapMs` on a LAN link. A
 * browser answers a ping control frame in its network stack; page JS never sees it and cannot delay
 * it. `min(appRtt, wsRtt)` therefore holds an inflated echo down to the real link.
 *
 * Each probe's payload is a per-session sequence number, and only a pong carrying one of the session's
 * `OUTSTANDING_WS_PINGS` most recent numbers counts, once. The transport's own heartbeat pings (empty
 * payload) and an unsolicited pong a non-browser client invents are ignored.
 */

/** The part of a `ws` WebSocket this module uses: what `WebSocketClient.ref` is in Colyseus 0.18. */
export interface PingSocket {
  ping(data?: unknown, mask?: boolean, cb?: (err?: Error) => void): void;
  on(event: "pong", listener: (data: Buffer) => void): unknown;
  off(event: "pong", listener: (data: Buffer) => void): unknown;
}

/** How many pongs a session's median spans: the app RTT's own window (`net-session.ts`). */
const WS_RTT_SAMPLES = 8;
/** How many of a session's most recent probes a pong may answer (the app pings' own rule). */
const OUTSTANDING_WS_PINGS = 4;

const isFn = (v: unknown): boolean => typeof v === "function";

/**
 * The ping-capable socket under a Colyseus client, or undefined when the transport does not expose
 * one (a test double, a future transport). `WebSocketTransport`'s `WebSocketClient` keeps the `ws`
 * socket on `ref`.
 */
export function pingSocketOf(client: unknown): PingSocket | undefined {
  const ref = (client as { ref?: unknown } | null)?.ref as Record<string, unknown> | undefined;
  if (ref === undefined || ref === null || typeof ref !== "object") return undefined;
  return isFn(ref.ping) && isFn(ref.on) && isFn(ref.off) ? (ref as unknown as PingSocket) : undefined;
}

interface Session {
  socket: PingSocket;
  listener: (data: Buffer) => void;
  nextSeq: number;
  /** Outstanding probes, oldest first: sequence number and send time. */
  sent: { seq: number; at: number }[];
  rtts: number[];
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export class WsRtt {
  private readonly sessions = new Map<string, Session>();

  /** `now` is the monotonic clock pongs are timed on (`netNowMs`). */
  constructor(private readonly now: () => number) {}

  /** Starts timing `socket`'s pongs for `sessionId`; a session already attached is left as is. */
  attach(sessionId: string, socket: PingSocket): void {
    if (this.sessions.has(sessionId)) return;
    const session: Session = { socket, listener: () => {}, nextSeq: 0, sent: [], rtts: [] };
    session.listener = (data) => this.onPong(session, data);
    socket.on("pong", session.listener);
    this.sessions.set(sessionId, session);
  }

  attached(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Sends one probe to `sessionId`. `send` runs the actual `ping` — immediately, or on the room's
   * simulated outgoing delay (NR56), so an injected link delays this probe exactly as it delays the
   * app ping it is compared with. The stamp is taken NOW, before that delay, exactly as the app ping
   * is stamped (`pingPayload` before `client.send`): stamping when the delayed frame left would drop
   * the injected outgoing leg from the ws RTT and make `min(appRtt, wsRtt)` under-price compensation.
   */
  probe(sessionId: string, send: (fn: () => void) => void = (fn) => fn()): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    const seq = session.nextSeq++;
    session.sent.push({ seq, at: this.now() });
    if (session.sent.length > OUTSTANDING_WS_PINGS) session.sent.shift();
    send(() => {
      if (this.sessions.get(sessionId) !== session) return;
      try {
        session.socket.ping(Buffer.from(String(seq)));
      } catch {
        // A socket closing under us: the leave handler drops the session.
      }
    });
  }

  private onPong(session: Session, data: Buffer): void {
    const text = Buffer.isBuffer(data) ? data.toString() : "";
    if (!/^\d+$/.test(text)) return;
    const seq = Number(text);
    const at = session.sent.findIndex((s) => s.seq === seq);
    if (at < 0) return;
    const rtt = this.now() - session.sent[at]!.at;
    session.sent.splice(at, 1);
    if (!Number.isFinite(rtt) || rtt < 0) return;
    session.rtts.push(rtt);
    if (session.rtts.length > WS_RTT_SAMPLES) session.rtts.shift();
  }

  /** Median of the session's recent pong RTTs, or undefined before the first. */
  rttMs(sessionId: string): number | undefined {
    const rtts = this.sessions.get(sessionId)?.rtts;
    return rtts === undefined || rtts.length === 0 ? undefined : median(rtts);
  }

  drop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    session.socket.off("pong", session.listener);
    this.sessions.delete(sessionId);
  }
}
