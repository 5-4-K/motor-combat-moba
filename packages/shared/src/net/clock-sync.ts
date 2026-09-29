import { MS_PER_TICK } from "../constants.js";

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
const SLEW_MS = 2;

/**
 * The client's estimate of the server's clock (NR18). Each pong gives one offset sample; the estimate
 * is the median offset of the lowest-RTT third of the last 16, so one delayed pong cannot drag it.
 * After the first sample it slews by at most 2 ms per pong, so the tick estimate never jumps —
 * unless it is more than 50 ms off, which only happens on join or after a long stall.
 */
export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];
  private offsetMs = Number.NaN;

  onPong(nowMs: number, pong: TimePong): void {
    const rtt = Math.max(0, nowMs - pong.c);
    const serverMs = pong.t * MS_PER_TICK + pong.p + rtt / 2;
    this.samples.push({ rtt, offset: serverMs - nowMs });
    if (this.samples.length > WINDOW) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.floor(this.samples.length / 3)));
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
    const target = offsets[Math.floor(offsets.length / 2)]!;
    if (Number.isNaN(this.offsetMs) || Math.abs(target - this.offsetMs) > SNAP_MS) this.offsetMs = target;
    else this.offsetMs += Math.max(-SLEW_MS, Math.min(SLEW_MS, target - this.offsetMs));
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
