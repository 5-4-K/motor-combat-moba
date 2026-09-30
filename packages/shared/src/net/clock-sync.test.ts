import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { ClockSync, type TimePong } from "./clock-sync.js";

/**
 * A pong's tick and phase, both derived from ONE server time: `p` is the remainder after `t` whole
 * ticks, so `t * MS_PER_TICK + p` is `serverMs` again. (`Math.floor(x / MS)` and `x % MS` are two
 * roundings and can disagree at a tick boundary, which adds a whole tick.)
 */
function pongFields(serverMs: number): { t: number; p: number } {
  const t = Math.floor(serverMs / MS_PER_TICK);
  return { t, p: serverMs - t * MS_PER_TICK };
}

/** Deterministic PRNG (mulberry32) so every run sees the same jitter. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A server whose tick 0 began at client time `origin`, answering after `oneWay` each way. */
function pong(sendAt: number, oneWay: number, origin: number): { at: number; pong: TimePong } {
  return { at: sendAt + 2 * oneWay, pong: { c: sendAt, ...pongFields(sendAt + oneWay - origin) } };
}

describe("ClockSync", () => {
  it("recovers the server tick from symmetric pings", () => {
    const clock = new ClockSync();
    for (let i = 0; i < 10; i++) {
      const { at, pong: p } = pong(1000 + i * 100, 40, 500);
      clock.onPong(at, p);
    }
    expect(clock.rttMs()).toBeCloseTo(80, 5);
    expect(clock.serverTick(3000)).toBeCloseTo((3000 - 500) / MS_PER_TICK, 1);
  });

  it("ignores a late pong through the RTT weighting", () => {
    const clock = new ClockSync();
    for (let i = 0; i < 12; i++) {
      const { at, pong: p } = pong(1000 + i * 100, 40, 500);
      clock.onPong(at, p);
    }
    const late = pong(3000, 40, 500);
    clock.onPong(late.at + 300, late.pong); // arrived 300 ms late
    expect(clock.serverTick(4000)).toBeCloseTo((4000 - 500) / MS_PER_TICK, 1);
  });

  it("derives a pong's tick and phase from one server time, so a tick boundary cannot add a tick", () => {
    for (const serverMs of [MS_PER_TICK * 3, MS_PER_TICK * 1e5, 1000 / 60 * 7, 123_456.789]) {
      const { t, p } = pongFields(serverMs);
      expect(t * MS_PER_TICK + p).toBeCloseTo(serverMs, 6);
      expect(p).toBeGreaterThan(-1e-6);
      expect(p).toBeLessThan(MS_PER_TICK + 1e-6);
    }
  });
});

describe("ClockSync drift", () => {
  it.each([0.99, 1.01])("tracks a server clock running at %s of the client's for 60 s with no snaps", (rate) => {
    const clock = new ClockSync();
    const oneWay = 40;
    const interval = NET_CONFIG.timeSyncIntervalMs;
    let maxErr = 0;
    let snaps = 0;
    let prev = Number.NaN;
    // The server's clock reads (client time) x rate; it stamps the ping when it arrives.
    for (let send = 0; send <= 60_000; send += interval) {
      const at = send + 2 * oneWay;
      clock.onPong(at, { c: send, ...pongFields((send + oneWay) * rate) });
      const est = clock.serverTick(at) * MS_PER_TICK;
      const err = Math.abs(est - at * rate);
      if (send >= 5000) {
        maxErr = Math.max(maxErr, err);
        if (!Number.isNaN(prev) && Math.abs(est - prev - interval * rate) > 40) snaps++;
      }
      prev = est;
    }
    expect(maxErr).toBeLessThan(25);
    expect(snaps).toBe(0);
  });

  it("keeps its fitted drift through a gap that empties the window instead of falling back to 0", () => {
    const rate = 1.01;
    const clock = new ClockSync();
    for (let send = 0; send <= 20_000; send += NET_CONFIG.timeSyncIntervalMs) {
      clock.onPong(send + 80, { c: send, ...pongFields((send + 40) * rate) });
    }
    const resume = 20_000 + NET_CONFIG.clockFitWindowMs + 5000; // every earlier sample has aged out
    clock.onPong(resume + 80, { c: resume, ...pongFields((resume + 40) * rate) });
    const t0 = resume + 80;
    const advanced = (clock.serverTick(t0 + 2000) - clock.serverTick(t0)) * MS_PER_TICK;
    expect(advanced).toBeCloseTo(2000 * rate, 0);
  });
});

interface Run {
  /** Worst |estimate - truth| after the warm-up, at each pong and twice between pongs. */
  maxErr: number;
  /** Pongs after the warm-up where serverTick jumped more than the slew allows. */
  snaps: number;
  /** Largest jump at a non-snap pong, relative to the slew bound for its interval. */
  worstJumpOverBound: number;
  trace: { at: number; err: number }[];
}

interface RunOpts {
  /** Server ms per client ms: a client clock `drift` fast is `1 / (1 + drift)`. */
  rate: number;
  /** Uniform +-jitter per leg, in ms. */
  jitter: number;
  /** Probability each leg carries a 250 ms spike. */
  spike: number;
  seed: number;
  seconds?: number;
  /** One-way base delay per leg, in ms, before and after `routeAt`. */
  up?: (sendAt: number) => number;
  down?: (sendAt: number) => number;
}

const WARMUP_MS = 10_000;

/**
 * ClockSync against a server `origin` ms ahead whose clock runs at `rate`. Pongs go out every
 * `timeSyncIntervalMs` and are delivered in arrival order (a spike can reorder them).
 */
function clockRun(o: RunOpts): Run {
  const rand = rng(o.seed);
  const origin = 5432.1;
  const up = o.up ?? (() => 40);
  const down = o.down ?? (() => 40);
  const pongs: { at: number; pong: TimePong }[] = [];
  for (let send = 0; send <= (o.seconds ?? 120) * 1000; send += NET_CONFIG.timeSyncIntervalMs) {
    let u = up(send) + (rand() * 2 - 1) * o.jitter;
    let d = down(send) + (rand() * 2 - 1) * o.jitter;
    if (rand() < o.spike) u += 250;
    if (rand() < o.spike) d += 250;
    pongs.push({ at: send + u + d, pong: { c: send, ...pongFields((send + u) * o.rate + origin) } });
  }
  pongs.sort((a, b) => a.at - b.at);
  const truth = (q: number) => q * o.rate + origin;
  const clock = new ClockSync();
  const run: Run = { maxErr: 0, snaps: 0, worstJumpOverBound: -Infinity, trace: [] };
  let prevAt = Number.NaN;
  pongs.forEach(({ at, pong: p }, i) => {
    const before = clock.ready ? clock.serverTick(at) * MS_PER_TICK : Number.NaN;
    clock.onPong(at, p);
    if (at > WARMUP_MS && !Number.isNaN(before)) {
      const jump = Math.abs(clock.serverTick(at) * MS_PER_TICK - before);
      const bound = (NET_CONFIG.clockSlewMsPerSec * (at - prevAt)) / 1000 + 1;
      if (jump > bound) run.snaps++;
      else run.worstJumpOverBound = Math.max(run.worstJumpOverBound, jump - bound);
    }
    prevAt = at;
    const next = pongs[i + 1]?.at ?? at;
    for (const q of [at, (at + next) / 2, next - 0.01]) {
      const err = clock.serverTick(q) * MS_PER_TICK - truth(q);
      if (q > WARMUP_MS) run.maxErr = Math.max(run.maxErr, Math.abs(err));
      run.trace.push({ at: q, err });
    }
  });
  return run;
}

const JITTERS = [0, 5, 10, 20, 30];
const DRIFTS = [0, 0.01, -0.01];
const SPIKES = [0, 0.05, 0.2];
const SEEDS = [1, 2, 3];
const cells = JITTERS.flatMap((jitter) => DRIFTS.flatMap((drift) => SPIKES.map((spike) => ({ jitter, drift, spike }))));

describe("ClockSync acceptance envelope (NR18)", () => {
  it.each(cells)(
    "jitter +-$jitter ms, drift $drift, spiked legs $spike: bounded error, no snaps, continuous at pongs",
    ({ jitter, drift, spike }) => {
      const limit = jitter >= 20 ? 40 : 25;
      for (const seed of SEEDS) {
        const r = clockRun({ rate: 1 / (1 + drift), jitter, spike, seed });
        expect(r.maxErr, `seed ${seed}`).toBeLessThanOrEqual(limit);
        expect(r.snaps, `seed ${seed}`).toBe(0);
        expect(r.worstJumpOverBound, `seed ${seed}`).toBeLessThanOrEqual(0);
      }
    },
  );

  it("still snaps on a genuine clock step (a stalled or restarted server clock)", () => {
    const clock = new ClockSync();
    let jumped = 0;
    for (let send = 0; send <= 30_000; send += NET_CONFIG.timeSyncIntervalMs) {
      const serverMs = send + 40 + (send >= 20_000 ? 400 : 0);
      const before = clock.ready ? clock.serverTick(send + 80) : Number.NaN;
      clock.onPong(send + 80, { c: send, ...pongFields(serverMs) });
      if (Math.abs(clock.serverTick(send + 80) - before) * MS_PER_TICK > NET_CONFIG.clockSnapMs) jumped++;
    }
    expect(jumped).toBe(1);
    expect(clock.serverTick(30_080) * MS_PER_TICK).toBeCloseTo(30_080 + 400, 0);
  });
});

describe("ClockSync route changes", () => {
  const STEP_AT = 40_000;
  const routes = [
    { name: "symmetric 80 -> 140 ms RTT", up: 30, down: 30 },
    { name: "+60 ms on the up leg", up: 60, down: 0 },
    { name: "+60 ms on the down leg", up: 0, down: 60 },
  ];
  const cases = routes.flatMap((r) => [0.01, -0.01].flatMap((drift) => [0, 5].map((jitter) => ({ ...r, drift, jitter }))));

  it.each(cases)("$name at drift $drift, jitter +-$jitter: <= 1 snap, <= 40 ms past the bias, settled in 10 s", (c) => {
    // Half the added one-way asymmetry is invisible to any RTT-based clock; the estimate settles onto it.
    const bias = (c.up - c.down) / 2;
    for (const seed of [1, 2]) {
      const r = clockRun({
        rate: 1 / (1 + c.drift),
        jitter: c.jitter,
        spike: 0,
        seed,
        seconds: 80,
        up: (s) => 40 + (s >= STEP_AT ? c.up : 0),
        down: (s) => 40 + (s >= STEP_AT ? c.down : 0),
      });
      expect(r.snaps).toBeLessThanOrEqual(1);
      for (const t of r.trace.filter((x) => x.at > WARMUP_MS)) {
        expect(Math.abs(t.err)).toBeLessThanOrEqual(Math.abs(t.at > STEP_AT ? bias : 0) + 40);
      }
      for (const t of r.trace.filter((x) => x.at > STEP_AT + 10_000)) expect(Math.abs(t.err - bias)).toBeLessThanOrEqual(10);
    }
  });
});
