import { describe, expect, it } from "vitest";
import { MS_PER_TICK, NET_CONFIG } from "@motor-combat-moba/shared";
import { axisOf, drainTicks } from "./arena-input.js";

describe("drainTicks", () => {
  it("emits nothing until a whole tick has elapsed, and carries the remainder", () => {
    const short = MS_PER_TICK / 3;
    const first = drainTicks(0, short);
    expect(first.ticks).toBe(0);
    expect(first.accMs).toBeCloseTo(short, 10);

    // Two more thirds complete the tick exactly, leaving nothing behind.
    const second = drainTicks(first.accMs, short * 2);
    expect(second.ticks).toBe(1);
    expect(second.accMs).toBeCloseTo(0, 10);
  });

  it("emits one tick per MS_PER_TICK regardless of frame rate", () => {
    // A slow 30 fps frame and three fast 120 fps frames cover the same wall time and must produce
    // the same number of inputs, or frame rate would become a movement-speed advantage.
    const slow = drainTicks(0, MS_PER_TICK);
    let acc = 0;
    let fast = 0;
    for (let i = 0; i < 4; i++) {
      const out = drainTicks(acc, MS_PER_TICK / 4);
      acc = out.accMs;
      fast += out.ticks;
    }
    expect(slow.ticks).toBe(1);
    expect(fast).toBe(1);
  });

  it("caps a catch-up burst at what the server will actually simulate", () => {
    // Ten ticks' worth of stall arrives in one frame; only maxInputsPerTick may be emitted.
    const out = drainTicks(0, MS_PER_TICK * 10);
    expect(out.ticks).toBe(NET_CONFIG.maxInputsPerTick);
  });

  it("clamps before draining, so a stall cannot bank time for later frames", () => {
    // The discarded overflow must be gone, not carried in accMs to be paid out next frame.
    const stalled = drainTicks(0, MS_PER_TICK * 100);
    expect(stalled.accMs).toBeLessThan(MS_PER_TICK);
    expect(drainTicks(stalled.accMs, 0).ticks).toBe(0);
  });

  it("always leaves a remainder below one tick", () => {
    for (const delta of [0, 1, MS_PER_TICK, MS_PER_TICK * 1.5, MS_PER_TICK * 7.25]) {
      const out = drainTicks(0, delta);
      expect(out.accMs).toBeGreaterThanOrEqual(0);
      expect(out.accMs).toBeLessThan(MS_PER_TICK);
    }
  });
});

describe("axisOf", () => {
  it("maps a single held key to its direction", () => {
    expect(axisOf(false, true)).toBe(1);
    expect(axisOf(true, false)).toBe(-1);
  });

  it("is neutral when neither or both keys are held", () => {
    expect(axisOf(false, false)).toBe(0);
    // Both down is deliberately 0, not last-key-wins.
    expect(axisOf(true, true)).toBe(0);
  });
});
