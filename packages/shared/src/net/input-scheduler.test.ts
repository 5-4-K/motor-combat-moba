import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
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

  it.each([0.99, 1.01])("a client clock at %s speed for a minute still lands inputs ahead of the server", (rate) => {
    const seen: number[] = [];
    // Client's wall clock drifts against the server's: frames arrive every 1000/60 client ms, and
    // the server clock (ClockSync offset) is re-estimated by fresh pongs every 100 ms.
    const clock = new ClockSync();
    const sched = new InputScheduler(clock);
    let minLead = Infinity;
    for (let now = 0; now < 60_000; now += 1000 / 60) {
      const serverMs = now * rate + 40; // true server time when the client believes it is `now`
      if (Math.floor(now / 100) !== Math.floor((now - 1000 / 60) / 100) || now === 0) {
        clock.onPong(now, { c: now - 80, t: Math.floor(serverMs / MS_PER_TICK), p: serverMs % MS_PER_TICK });
      }
      const out = sched.due(now, 1000 / 60, 1.5);
      seen.push(...out);
      if (out.length > 0) minLead = Math.min(minLead, out.at(-1)! - (now * rate) / MS_PER_TICK);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]!);
    expect(minLead).toBeGreaterThan(0);
  });
});
