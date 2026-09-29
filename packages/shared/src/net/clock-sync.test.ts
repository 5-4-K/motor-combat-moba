import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
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
