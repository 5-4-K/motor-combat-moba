import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { ClockSync } from "./clock-sync.js";
import { InputScheduler } from "./input-scheduler.js";

/** A pong's tick and phase from ONE server time, so a tick boundary cannot round into an extra tick. */
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

function syncedClock(oneWay: number): ClockSync {
  const c = new ClockSync();
  for (let i = 0; i < 16; i++) {
    const sendAt = i * 100;
    c.onPong(sendAt + 2 * oneWay, { c: sendAt, ...pongFields(sendAt + oneWay) });
  }
  return c;
}

describe("InputScheduler", () => {
  it("produces each tick exactly once, ahead of the server by about half an RTT", () => {
    const s = new InputScheduler(syncedClock(40));
    const seen: number[] = [];
    for (let now = 2000; now < 4000; now += 1000 / 60) seen.push(...s.due(now, 1000 / 60, 1.5));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBe(seen[i - 1]! + 1);
    const lastServerTick = (4000 - 1000 / 60) / MS_PER_TICK;
    expect(seen.at(-1)! - lastServerTick).toBeGreaterThan(40 / MS_PER_TICK);
  });

  it("resyncs instead of flooding after a long stall", () => {
    const s = new InputScheduler(syncedClock(40));
    s.due(2000, 1000 / 60, 1.5);
    const burst = s.due(4000, 2000, 1.5); // 2 s stall
    expect(burst.length).toBeLessThanOrEqual(8);
  });

  it("moves its lead by at most maxDilation of elapsed time per call", () => {
    const s = new InputScheduler(syncedClock(40));
    s.due(2000, 1000 / 60, 1.5);
    const before = s.leadMs;
    s.due(2000 + 1000 / 60, 1000 / 60, -10); // slack says 'way too late'
    expect(Math.abs(s.leadMs - before)).toBeLessThanOrEqual(0.04 * (1000 / 60) + 1e-9);
  });
});

interface Sim {
  inputs: { at: number; tick: number; arrival: number; next: number; slack: number }[];
  measured: { at: number; slack: number }[];
  /** Worst |estimated - true| server time, in ms, after the 10 s warm-up. */
  clockErrMs: number;
}

interface SimOpts {
  fps?: number;
  /** Uniform +-jitter per pong leg, in ms. */
  jitter?: number;
  /** Probability each pong leg carries a 250 ms spike. */
  spike?: number;
  seed?: number;
}

const WARMUP_MS = 10_000;

/**
 * Closed loop: real ClockSync + InputScheduler against a simulated server whose clock runs at `rate`
 * times the client's. Pongs go out every `timeSyncIntervalMs`, each leg `oneWay` plus the jitter and
 * spikes, and are delivered in arrival order. Inputs travel `oneWay` with no jitter. Once per 60 Hz
 * snapshot, whatever the render rate, the client sees the server's mean slack over the last 30 inputs
 * that had arrived one way earlier, so a sample describes inputs sent one RTT ago; at 144 fps most
 * frames pass `undefined`.
 */
function simulate(rate: number, oneWay: (t: number) => number, seconds: number, opts: SimOpts = {}): Sim {
  const rand = rng(opts.seed ?? 7);
  const jitter = opts.jitter ?? 0;
  const spike = opts.spike ?? 0;
  const leg = (t: number) => oneWay(t) + (rand() * 2 - 1) * jitter + (rand() < spike ? 250 : 0);
  const clock = new ClockSync();
  const sched = new InputScheduler(clock);
  const frame = 1000 / (opts.fps ?? 60);
  const sim: Sim = { inputs: [], measured: [], clockErrMs: 0 };
  const pongs: { at: number; c: number; serverMs: number }[] = [];
  const window: number[] = [];
  let seen = 0;
  let nextPing = 0;
  let nextSnapshot = 0;
  for (let now = 0; now < seconds * 1000; now += frame) {
    if (now >= nextPing) {
      const up = leg(now);
      pongs.push({ at: now + up + leg(now), c: now, serverMs: (now + up) * rate });
      pongs.sort((a, b) => a.at - b.at);
      nextPing += NET_CONFIG.timeSyncIntervalMs;
    }
    while (pongs.length && pongs[0]!.at <= now) {
      const p = pongs.shift()!;
      clock.onPong(p.at, { c: p.c, ...pongFields(p.serverMs) });
    }
    if (now > WARMUP_MS && clock.ready) {
      sim.clockErrMs = Math.max(sim.clockErrMs, Math.abs(clock.serverTick(now) * MS_PER_TICK - now * rate));
    }
    let slack: number | undefined;
    if (now >= nextSnapshot) {
      nextSnapshot += 1000 / 60;
      while (seen < sim.inputs.length && sim.inputs[seen]!.arrival <= now - oneWay(now)) {
        window.push(sim.inputs[seen]!.slack);
        if (window.length > 30) window.shift();
        seen++;
      }
      if (window.length > 0) {
        slack = window.reduce((a, x) => a + x, 0) / window.length;
        sim.measured.push({ at: now, slack });
      }
    }
    for (const tick of sched.due(now, frame, slack)) {
      const arrival = now + oneWay(now);
      const next = Math.floor((arrival * rate) / MS_PER_TICK) + 1;
      sim.inputs.push({ at: now, tick, arrival, next, slack: tick - next });
    }
  }
  return sim;
}

const meanSlack = (sim: Sim, from: number) => {
  const xs = sim.inputs.filter((i) => i.at > from);
  return xs.reduce((a, i) => a + i.slack, 0) / xs.length;
};

describe("InputScheduler closed loop", () => {
  it("settles slack to the target after a one-way step from 40 to 70 ms, never late once settled", () => {
    const sim = simulate(1, (t) => (t < 5000 ? 40 : 70), 25);
    const tail = sim.measured.filter((m) => m.at > 15_000);
    for (const m of tail) expect(Math.abs(m.slack - NET_CONFIG.targetSlackTicks)).toBeLessThanOrEqual(0.5);
    for (const i of sim.inputs.filter((i) => i.at > 15_000)) expect(i.slack).toBeGreaterThanOrEqual(0);
  });

  it.each([0.99, 1.01])("a client clock at %s of the server's for a minute still lands inputs on time", (rate) => {
    const sim = simulate(rate, () => 40, 60);
    expect(sim.clockErrMs).toBeLessThan(25);
    for (const i of sim.inputs.filter((i) => i.at > 5000)) expect(i.tick).toBeGreaterThanOrEqual(i.next);
    for (let k = 1; k < sim.inputs.length; k++) expect(sim.inputs[k]!.tick).toBeGreaterThan(sim.inputs[k - 1]!.tick);
  });

  it("reaches the same steady state at 144 fps as at 60 (slack integrates per snapshot, not per frame)", () => {
    const a = simulate(1, () => 40, 40, { fps: 60 });
    const b = simulate(1, () => 40, 40, { fps: 144 });
    expect(Math.abs(meanSlack(b, 20_000) - NET_CONFIG.targetSlackTicks)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(meanSlack(b, 20_000) - meanSlack(a, 20_000))).toBeLessThanOrEqual(0.3);
  });
});

const cells = [60, 144].flatMap((fps) =>
  [0, 5, 10, 20, 30].flatMap((jitter) =>
    [0, 0.01, -0.01].flatMap((drift) => [0, 0.05, 0.2].map((spike) => ({ fps, jitter, drift, spike }))),
  ),
);

describe("InputScheduler closed-loop acceptance envelope (NR18, NR20, NR21)", () => {
  // 80 ms RTT; the jitter and spikes are on the clock-sync pongs, which is what the estimate has to
  // see through. Inputs themselves travel a steady 40 ms, so a late input is the clock's fault.
  it.each(cells)(
    "$fps fps, pong jitter +-$jitter ms, drift $drift, spiked legs $spike: no late input, slack 1.5 +- 0.5",
    ({ fps, jitter, drift, spike }) => {
      for (const seed of [1, 2]) {
        const sim = simulate(1 / (1 + drift), () => 40, 60, { fps, jitter, spike, seed });
        const late = sim.inputs.filter((i) => i.at > WARMUP_MS && i.slack < 0).length;
        expect(late, `seed ${seed}`).toBe(0);
        expect(Math.abs(meanSlack(sim, 30_000) - NET_CONFIG.targetSlackTicks), `seed ${seed}`).toBeLessThanOrEqual(0.5);
      }
    },
  );
});
