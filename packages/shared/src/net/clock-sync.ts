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

/**
 * The client's estimate of the server's clock (NR18). Each pong gives one offset sample; the estimate
 * is the median offset of the lowest-RTT third of the last 16, so one delayed pong cannot drag it.
 * Ties in RTT go to the newest sample. After the first sample the offset slews at most
 * `NET_CONFIG.clockSlewMsPerSec` (a RATE, times the time since the previous pong, so it tracks a 1 %
 * clock drift at any ping interval) and the tick estimate never jumps — unless it is more than 50 ms
 * off, which only happens on join or after a long stall. A snap passes straight through to the
 * scheduler's target: a burst of ticks forward, or a pause backward.
 */
export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];
  private offsetMs = Number.NaN;
  private lastPongAt = Number.NaN;

  onPong(nowMs: number, pong: TimePong): void {
    const rtt = Math.max(0, nowMs - pong.c);
    const serverMs = pong.t * MS_PER_TICK + pong.p + rtt / 2;
    this.samples.push({ rtt, offset: serverMs - nowMs });
    if (this.samples.length > WINDOW) this.samples.shift();
    // Lowest RTT first; equal RTTs newest first (index order is arrival order).
    const best = this.samples
      .map((s, i) => ({ s, i }))
      .sort((a, b) => a.s.rtt - b.s.rtt || b.i - a.i)
      .map((e) => e.s).slice(0, Math.max(1, Math.floor(this.samples.length / 3)));
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
    const target = offsets[Math.floor(offsets.length / 2)]!;
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
