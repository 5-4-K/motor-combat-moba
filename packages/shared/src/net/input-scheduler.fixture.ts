import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { ClockSync } from "./clock-sync.js";
import { InputScheduler } from "./input-scheduler.js";

/** A pong's tick and phase from ONE server time, so a tick boundary cannot round into an extra tick. */
export function pongFields(serverMs: number): { t: number; p: number } {
  const t = Math.floor(serverMs / MS_PER_TICK);
  return { t, p: serverMs - t * MS_PER_TICK };
}

/** Deterministic PRNG (mulberry32) so every run sees the same jitter. */
export function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Sim {
  inputs: { at: number; tick: number; arrival: number; next: number; slack: number }[];
  measured: { at: number; slack: number }[];
  /** Worst |estimated - true| server time, in ms, after the 10 s warm-up. */
  clockErrMs: number;
}

export interface SimOpts {
  fps?: number;
  /** Uniform +-jitter per pong leg, in ms. */
  jitter?: number;
  /** Probability each pong leg carries a 250 ms spike. */
  spike?: number;
  seed?: number;
}

export const WARMUP_MS = 10_000;

/**
 * Closed loop: real ClockSync + InputScheduler against a simulated server whose clock runs at `rate`
 * times the client's. Pongs go out every `timeSyncIntervalMs`, each leg `oneWay` plus the jitter and
 * spikes, and are delivered in arrival order. Inputs travel `oneWay` with no jitter. Once per 60 Hz
 * snapshot, whatever the render rate, the client sees the server's mean slack over the last 30 inputs
 * that had arrived one way earlier, so a sample describes inputs sent one RTT ago; at 144 fps most
 * frames pass `undefined`.
 */
export function simulate(rate: number, oneWay: (t: number) => number, seconds: number, opts: SimOpts = {}): Sim {
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

export const meanSlack = (sim: Sim, from: number) => {
  const xs = sim.inputs.filter((i) => i.at > from);
  return xs.reduce((a, i) => a + i.slack, 0) / xs.length;
};
