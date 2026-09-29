import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { ClockSync } from "./clock-sync.js";

/** A server whose tick 0 began at client time `origin`, answering after `oneWay` each way. */
function pong(sendAt: number, oneWay: number, origin: number) {
  const serverMs = sendAt + oneWay - origin;
  return { at: sendAt + 2 * oneWay, pong: { c: sendAt, t: Math.floor(serverMs / MS_PER_TICK), p: serverMs % MS_PER_TICK } };
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

  it("ignores a late pong through the lowest-RTT filter", () => {
    const clock = new ClockSync();
    for (let i = 0; i < 12; i++) {
      const { at, pong: p } = pong(1000 + i * 100, 40, 500);
      clock.onPong(at, p);
    }
    const late = pong(3000, 40, 500);
    clock.onPong(late.at + 300, late.pong); // arrived 300 ms late
    expect(clock.serverTick(4000)).toBeCloseTo((4000 - 500) / MS_PER_TICK, 1);
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
      const serverMs = (send + oneWay) * rate;
      const at = send + 2 * oneWay;
      clock.onPong(at, { c: send, t: Math.floor(serverMs / MS_PER_TICK), p: serverMs % MS_PER_TICK });
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
});

/** Deterministic PRNG so the jitter is the same every run. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pongs whose two legs each carry +-5 ms of jitter, with a 250 ms spike on 1 in 20. */
function jitteredRun(rate: number, seconds: number, seed: number): { maxErr: number; snaps: number } {
  const clock = new ClockSync();
  const rand = rng(seed);
  const leg = () => 40 + (rand() * 10 - 5) + (rand() < 1 / 20 ? 250 : 0);
  const interval = NET_CONFIG.timeSyncIntervalMs;
  let maxErr = 0;
  let snaps = 0;
  let prev = Number.NaN;
  let prevAt = 0;
  for (let send = 0; send <= seconds * 1000; send += interval) {
    const up = leg();
    const down = leg();
    const serverMs = (send + up) * rate;
    const at = send + up + down;
    clock.onPong(at, { c: send, t: Math.floor(serverMs / MS_PER_TICK), p: serverMs % MS_PER_TICK });
    const est = clock.serverTick(at) * MS_PER_TICK;
    if (at > 10_000) {
      maxErr = Math.max(maxErr, Math.abs(est - at * rate));
      if (!Number.isNaN(prev) && Math.abs(est - prev - (at - prevAt) * rate) > 40) snaps++;
    }
    prev = est;
    prevAt = at;
  }
  return { maxErr, snaps };
}

describe("ClockSync with RTT jitter", () => {
  it.each([0.99, 1.01])("tracks %s drift through jitter and spikes over 120 s (max error < 25 ms, no snaps)", (rate) => {
    for (const seed of [1, 2, 3]) {
      const r = jitteredRun(rate, 120, seed);
      expect(r.maxErr).toBeLessThan(25);
      expect(r.snaps).toBe(0);
    }
  });

  it("holds a steady clock within 8 ms through the same jitter", () => {
    for (const seed of [1, 2, 3]) expect(jitteredRun(1, 120, seed).maxErr).toBeLessThan(8);
  });
});
