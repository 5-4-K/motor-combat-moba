export interface LinkProfile {
  name: string;
  oneWayMs: number;
  jitterMs: number;
  lossPct: number;
}

/** Spec NR1's link and the two it is judged beside. RTT = 2 × oneWayMs. */
export const LINKS = {
  lan: { name: "lan", oneWayMs: 0.5, jitterMs: 0, lossPct: 0 },
  net80: { name: "net80", oneWayMs: 40, jitterMs: 10, lossPct: 1 },
  net150: { name: "net150", oneWayMs: 75, jitterMs: 15, lossPct: 1 },
} as const satisfies Record<string, LinkProfile>;

/**
 * One direction of a WebSocket: in-order, reliable. Jitter varies each message's delay; a "lost"
 * message is retransmitted one round trip later, and because delivery is in order, everything sent
 * after it waits too — which is what TCP does to a game stream.
 */
export class Link<T> {
  private queue: { at: number; msg: T }[] = [];
  private lastAt = -Infinity;

  constructor(readonly profile: LinkProfile, private readonly rng: () => number) {}

  send(nowMs: number, msg: T): void {
    const { oneWayMs, jitterMs, lossPct } = this.profile;
    let at = nowMs + oneWayMs + (this.rng() * 2 - 1) * jitterMs;
    if (this.rng() < lossPct / 100) at += 2 * oneWayMs;
    at = Math.max(at, this.lastAt, nowMs);
    this.lastAt = at;
    this.queue.push({ at, msg });
  }

  receive(nowMs: number): T[] {
    let n = 0;
    while (n < this.queue.length && this.queue[n]!.at <= nowMs) n++;
    return this.queue.splice(0, n).map((e) => e.msg);
  }
}
