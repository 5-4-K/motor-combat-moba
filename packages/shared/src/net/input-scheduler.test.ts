import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { ClockSync } from "./clock-sync.js";
import { InputScheduler } from "./input-scheduler.js";

function syncedClock(oneWay: number): ClockSync {
  const c = new ClockSync();
  for (let i = 0; i < 16; i++) {
    const sendAt = i * 100;
    const serverMs = sendAt + oneWay;
    c.onPong(sendAt + 2 * oneWay, { c: sendAt, t: Math.floor(serverMs / MS_PER_TICK), p: serverMs % MS_PER_TICK });
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
  /** Worst |estimated - true| server time, in ms, after the 5 s warm-up. */
  clockErrMs: number;
}

/**
 * Closed loop: real ClockSync + InputScheduler against a simulated server. The client's clock reads
 * `rate` x server time; pongs are self-consistent (server stamps at arrival, client receives one
 * RTT after sending); the slack the scheduler sees is the mean over the last 30 arrived inputs and
 * reaches the client one way later, once per frame (a snapshot per tick).
 */
interface SimOpts {
  fps?: number;
  /** +-5 ms per pong leg, plus a 250 ms spike on 1 in 20 legs. */
  jitter?: boolean;
}

function simulate(rate: number, oneWay: (t: number) => number, seconds: number, opts: SimOpts = {}): Sim {
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const leg = (t: number) => (opts.jitter ? oneWay(t) + (rand() * 10 - 5) + (rand() < 1 / 20 ? 250 : 0) : oneWay(t));
  const clock = new ClockSync();
  const sched = new InputScheduler(clock);
  const frame = 1000 / (opts.fps ?? 60);
  const snapshotMs = 1000 / 60;
  let nextSnapshot = 0;
  const sim: Sim = { inputs: [], measured: [], clockErrMs: 0 };
  const pongs: { at: number; c: number; serverMs: number }[] = [];
  let nextPing = 0;
  for (let now = 0; now < seconds * 1000; now += frame) {
    if (now >= nextPing) {
      const up = leg(now);
      const serverMs = (now + up) * rate;
      pongs.push({ at: now + up + leg(now), c: now, serverMs });
      nextPing += NET_CONFIG.timeSyncIntervalMs;
    }
    while (pongs.length && pongs[0]!.at <= now) {
      const p = pongs.shift()!;
      clock.onPong(p.at, { c: p.c, t: Math.floor(p.serverMs / MS_PER_TICK), p: p.serverMs % MS_PER_TICK });
    }
    if (now > 5000 && clock.ready) sim.clockErrMs = Math.max(sim.clockErrMs, Math.abs(clock.serverTick(now) * MS_PER_TICK - now * rate));
    const arrived = sim.inputs.filter((i) => i.arrival <= now - oneWay(now)).slice(-30);
    // A slack sample exists once per 60 Hz snapshot, whatever the render rate: at 144 fps most frames
    // pass `undefined`.
    let slack: number | undefined;
    if (now >= nextSnapshot) {
      nextSnapshot += snapshotMs;
      if (arrived.length > 0) {
        slack = arrived.reduce((a, i) => a + i.slack, 0) / arrived.length;
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

  const meanSlack = (sim: Sim, from: number) => {
    const xs = sim.inputs.filter((i) => i.at > from);
    return xs.reduce((a, i) => a + i.slack, 0) / xs.length;
  };

  it("a 1 % fast client clock through RTT jitter still settles true slack to 1.5 +- 0.5 ticks", () => {
    for (const rate of [0.99, 1.01]) {
      const sim = simulate(rate, () => 40, 90, { jitter: true });
      expect(Math.abs(meanSlack(sim, 30_000) - NET_CONFIG.targetSlackTicks)).toBeLessThanOrEqual(0.5);
    }
  });

  it("reaches the same steady state at 144 fps as at 60 (slack integrates per snapshot, not per frame)", () => {
    const a = simulate(1, () => 40, 40, { fps: 60 });
    const b = simulate(1, () => 40, 40, { fps: 144 });
    expect(Math.abs(meanSlack(b, 20_000) - NET_CONFIG.targetSlackTicks)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(meanSlack(b, 20_000) - meanSlack(a, 20_000))).toBeLessThanOrEqual(0.3);
  });
});
