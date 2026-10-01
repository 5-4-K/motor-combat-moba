import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";

export interface TimePong {
  /** The client's send time, echoed. */
  c: number;
  /** The server's last completed tick when it answered. */
  t: number;
  /**
   * Milliseconds since tick `t`'s due time when the server answered, `>= 0`. Usually under one tick, but
   * not capped there: the server's interval can run late enough that tick `t + 1` is already due, and
   * `t * MS_PER_TICK + p` is the server time either way.
   */
  p: number;
}

interface Sample {
  rtt: number;
  /** Server clock minus client clock, in ms, as this pong measured it. */
  offset: number;
  at: number;
}

/**
 * A pong's weight: half its RTT above the window minimum bounds how wrong its offset can be, so a
 * spiked pong counts for almost nothing and near-minimum pongs count about equally.
 */
function weightOf(rtt: number, minRtt: number): number {
  return 1 / (NET_CONFIG.clockWeightFloorMs + (rtt - minRtt) / 2) ** 2;
}

function minRttOf(set: readonly Sample[]): number {
  let m = Infinity;
  for (const s of set) m = Math.min(m, s.rtt);
  return m;
}

/** Weighted least-squares slope of offset against time, or undefined when the samples cannot fix one. */
function driftOf(set: readonly Sample[]): number | undefined {
  const m = minRttOf(set);
  let sw = 0;
  let st = 0;
  let so = 0;
  for (const s of set) {
    const w = weightOf(s.rtt, m);
    sw += w;
    st += w * s.at;
    so += w * s.offset;
  }
  const meanAt = st / sw;
  const meanOff = so / sw;
  let num = 0;
  let den = 0;
  for (const s of set) {
    const w = weightOf(s.rtt, m);
    num += w * (s.at - meanAt) * (s.offset - meanOff);
    den += w * (s.at - meanAt) ** 2;
  }
  return den > 0 ? num / den : undefined;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/**
 * The client's estimate of the server's clock (NR18). Every pong is a sample of the offset between
 * the clocks, weighted by how close its RTT is to the minimum (a pong's offset can be wrong by at most
 * half its excess RTT, so spikes and bufferbloat weigh almost nothing). Two fits share those weights:
 *
 * - DRIFT: a weighted least-squares slope over `clockFitWindowMs` (24 s), clamped to
 *   +-`clockSlewMsPerSec` / 1000. With fewer than `clockMinFitSamples` samples spanning
 *   `clockMinFitSpanMs` it keeps its previous slope rather than falling back to 0.
 * - OFFSET: the weighted mean over the newest `clockOffsetWindowMs` (6 s), each sample carried to now
 *   along the drift. The short window is what lets a route change be believed within seconds.
 *
 * The estimate runs on at the drift between pongs. At each pong that running value is folded into the
 * stored offset first, and the correction toward the new fit is then slewed in continuously, at
 * `clockSlewMsPerSec`, until the next pong, so `serverTick` does not jump at a pong. It snaps instead
 * on join, on a correction over `clockSnapMs`, or when two pongs in a row sit more than twice that
 * further from the estimate than their RTT can explain (the server's clock stepped), which shifts the
 * whole history by that step. A snap passes straight through to the scheduler's target, as a burst of
 * ticks forward or a pause backward.
 *
 * After a gap of `clockOffsetWindowMs` or more with no pong (a throttled background tab, N7), the
 * offset window is empty and would otherwise be refilled by whatever pong arrives first, spiked or
 * not. For one `clockOffsetWindowMs` after the gap the weights and the clock-step test are taken
 * against the pre-gap minimum RTT, and the running estimate stays in the offset fit as one clean
 * pong's worth of evidence, so a spike neither snaps the estimate nor passes for a clock step.
 */
export class ClockSync {
  private samples: Sample[] = [];
  private offsetMs = Number.NaN;
  private slopeMsPerMs = 0;
  private lastPongAt = Number.NaN;
  /** Correction still being slewed in since the last pong, in ms (signed). */
  private pendingMs = 0;
  /** A pong too far off to be jitter, waiting for a second one to confirm a server clock step. */
  private suspect: { sample: Sample; miss: number } | undefined;
  /** Whether a drift has ever been fitted; before that a large miss is warm-up, not a clock step. */
  private fitted = false;
  /**
   * After a pong gap of at least `clockOffsetWindowMs` (N7), the offset window refills from nothing,
   * so its own minimum RTT means nothing yet and one spiked pong would be the whole weighted mean.
   * Until `gapUntil`, weights are taken against the pre-gap minimum RTT (`gapMinRtt`) and the
   * running estimate is kept in the fit as one clean pong's worth of evidence (`gapAnchor`).
   */
  private gapUntil = Number.NEGATIVE_INFINITY;
  private gapMinRtt = Infinity;

  onPong(nowMs: number, pong: TimePong): void {
    const rtt = Math.max(0, nowMs - pong.c);
    const serverMs = pong.t * MS_PER_TICK + pong.p + rtt / 2;
    const sample: Sample = { rtt, offset: serverMs - nowMs, at: nowMs };
    if (nowMs - this.lastPongAt >= NET_CONFIG.clockOffsetWindowMs && this.samples.length > 0) {
      this.gapMinRtt = minRttOf(this.samples);
      this.gapUntil = nowMs + NET_CONFIG.clockOffsetWindowMs;
    }
    if (this.fitted) {
      // A pong's offset can be wrong by at most half its RTT above the minimum. Once the drift is
      // fitted, one wrong by more than that plus 2 x clockSnapMs means the server's clock stepped:
      // hold it back until a second pong agrees, then shift the history by the step, keeping the drift.
      const miss = sample.offset - this.offsetAt(nowMs);
      // While the window refills after a gap (N7), a run of spiked pongs must not set its own minimum.
      const floor = nowMs < this.gapUntil ? Math.min(minRttOf(this.samples), this.gapMinRtt) : minRttOf(this.samples);
      const excess = Math.max(0, rtt - floor);
      if (Math.abs(miss) - excess / 2 > 2 * NET_CONFIG.clockSnapMs) {
        const held = this.suspect;
        if (held === undefined || Math.sign(held.miss) !== Math.sign(miss)) {
          this.suspect = { sample, miss };
          return;
        }
        const step = (held.miss + miss) / 2;
        for (const s of this.samples) s.offset += step;
        this.samples.push(held.sample);
        // A confirmed step is new truth; the running estimate is no longer evidence worth keeping.
        this.gapUntil = Number.NEGATIVE_INFINITY;
      }
    }
    this.suspect = undefined;
    this.samples.push(sample);
    while (this.samples[0]!.at < nowMs - NET_CONFIG.clockFitWindowMs) this.samples.shift();

    let slope = this.slopeMsPerMs;
    if (
      this.samples.length >= NET_CONFIG.clockMinFitSamples &&
      nowMs - this.samples[0]!.at >= NET_CONFIG.clockMinFitSpanMs
    ) {
      const fit = driftOf(this.samples);
      if (fit !== undefined) {
        slope = fit;
        this.fitted = true;
      }
    }
    const cap = NET_CONFIG.clockSlewMsPerSec / 1000;
    slope = Math.max(-cap, Math.min(cap, slope));

    const recent = this.samples.filter((s) => s.at >= nowMs - NET_CONFIG.clockOffsetWindowMs);
    const refilling = nowMs < this.gapUntil && !Number.isNaN(this.offsetMs);
    const m = refilling ? Math.min(minRttOf(recent), this.gapMinRtt) : minRttOf(recent);
    let sw = 0;
    let sx = 0;
    if (refilling) {
      // The drift-run estimate, weighted as one pong at the pre-gap minimum RTT (N7).
      const w = weightOf(m, m);
      sw += w;
      sx += w * this.offsetAt(nowMs);
    }
    for (const s of recent) {
      const w = weightOf(s.rtt, m);
      sw += w;
      sx += w * (s.offset + slope * (nowMs - s.at));
    }
    const target = sx / sw;

    if (Number.isNaN(this.offsetMs)) this.offsetMs = target;
    else {
      // Fold the running value (drift and any unfinished slew) in first, so serverTick does not jump
      // at a pong; the new correction is then slewed in continuously, at the slew rate, from here.
      const current = this.offsetAt(nowMs);
      this.offsetMs = current;
      this.pendingMs = 0;
      if (Math.abs(target - current) > NET_CONFIG.clockSnapMs) this.offsetMs = target;
      else this.pendingMs = target - current;
    }
    this.slopeMsPerMs = slope;
    this.lastPongAt = nowMs;
  }

  get ready(): boolean {
    return !Number.isNaN(this.offsetMs);
  }

  serverTick(nowMs: number): number {
    return (nowMs + this.offsetAt(nowMs)) / MS_PER_TICK;
  }

  /** Server minus client clock at `nowMs`: the stored offset, run on at the drift, plus the slewed-in correction. */
  private offsetAt(nowMs: number): number {
    const dt = Math.max(0, nowMs - this.lastPongAt);
    const slewed = Math.min(Math.abs(this.pendingMs), (NET_CONFIG.clockSlewMsPerSec * dt) / 1000);
    return this.offsetMs + this.slopeMsPerMs * dt + Math.sign(this.pendingMs) * slewed;
  }

  /**
   * The path's RTT without its spikes: the median, over the last `clockRttWindowMs`, of each
   * `clockRttBucketMs` bucket's lowest RTT. It sits near the low edge of the jitter band; the
   * scheduler's slack loop (NR21) supplies the margin above it.
   */
  rttMs(): number {
    if (Number.isNaN(this.lastPongAt)) return 0;
    const byBucket = new Map<number, number>();
    for (const s of this.samples) {
      if (s.at < this.lastPongAt - NET_CONFIG.clockRttWindowMs) continue;
      const k = Math.floor(s.at / NET_CONFIG.clockRttBucketMs);
      const b = byBucket.get(k);
      if (b === undefined || s.rtt < b) byBucket.set(k, s.rtt);
    }
    return median([...byBucket.values()]);
  }
}
