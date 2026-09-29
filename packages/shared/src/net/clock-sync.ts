import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";

export interface TimePong {
  /** The client's send time, echoed. */
  c: number;
  /** The server's last completed tick when it answered. */
  t: number;
  /** Milliseconds the server was into the next tick when it answered, in [0, MS_PER_TICK). */
  p: number;
}

const WINDOW = 16;
const SNAP_MS = 50;

interface Sample {
  rtt: number;
  offset: number;
  at: number;
}

/**
 * Least-squares line offset(t) = a + b*t through `set`, evaluated at `nowMs`. The slope is the two
 * clocks' relative drift, clamped to the slew rate; with fewer than 3 samples it is 0 (the mean).
 * Fitting the drift is what keeps the estimate current when the chosen low-RTT samples are old.
 */
function fitAt(set: Sample[], nowMs: number): number {
  const n = set.length;
  const meanAt = set.reduce((s, p) => s + p.at, 0) / n;
  const meanOff = set.reduce((s, p) => s + p.offset, 0) / n;
  let slope = 0;
  if (n >= 3) {
    let num = 0;
    let den = 0;
    for (const p of set) {
      num += (p.at - meanAt) * (p.offset - meanOff);
      den += (p.at - meanAt) ** 2;
    }
    const cap = NET_CONFIG.clockSlewMsPerSec / 1000;
    if (den > 0) slope = Math.max(-cap, Math.min(cap, num / den));
  }
  return meanOff + slope * (nowMs - meanAt);
}

/**
 * The client's estimate of the server's clock (NR18). Each pong gives one offset sample; the estimate
 * is a least-squares fit of offset and drift over the lowest-RTT half of the last 16, evaluated now, so one delayed pong cannot drag it and old samples do not leave it stale.
 * Ties in RTT go to the newest sample. After the first sample the offset slews at most
 * `NET_CONFIG.clockSlewMsPerSec` (a RATE, times the time since the previous pong, so it tracks a 1 %
 * clock drift at any ping interval) and the tick estimate never jumps — unless it is more than 50 ms
 * off, which only happens on join or after a long stall. A snap passes straight through to the
 * scheduler's target: a burst of ticks forward, or a pause backward.
 */
export class ClockSync {
  private samples: Sample[] = [];
  private offsetMs = Number.NaN;
  private lastPongAt = Number.NaN;

  onPong(nowMs: number, pong: TimePong): void {
    const rtt = Math.max(0, nowMs - pong.c);
    const serverMs = pong.t * MS_PER_TICK + pong.p + rtt / 2;
    this.samples.push({ rtt, offset: serverMs - nowMs, at: nowMs });
    if (this.samples.length > WINDOW) this.samples.shift();
    // Lowest-RTT half; equal RTTs newest first (index order is arrival order).
    const best = this.samples
      .map((s, i) => ({ s, i }))
      .sort((a, b) => a.s.rtt - b.s.rtt || b.i - a.i)
      .slice(0, Math.max(1, Math.floor(this.samples.length / 2)))
      .map((e) => e.s);
    const target = fitAt(best, nowMs);
    if (Number.isNaN(this.offsetMs) || Math.abs(target - this.offsetMs) > SNAP_MS) this.offsetMs = target;
    else {
      const slew = (NET_CONFIG.clockSlewMsPerSec * Math.max(0, nowMs - this.lastPongAt)) / 1000;
      this.offsetMs += Math.max(-slew, Math.min(slew, target - this.offsetMs));
    }
    this.lastPongAt = nowMs;
  }

  get ready(): boolean {
    return !Number.isNaN(this.offsetMs);
  }

  serverTick(nowMs: number): number {
    return (nowMs + this.offsetMs) / MS_PER_TICK;
  }

  rttMs(): number {
    const r = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    return r.length === 0 ? 0 : r[Math.floor(r.length / 2)]!;
  }

  jitterMs(): number {
    const r = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    if (r.length < 2) return 0;
    const at = (q: number) => r[Math.min(r.length - 1, Math.floor(q * (r.length - 1)))]!;
    return (at(0.9) - at(0.1)) / 2;
  }
}
