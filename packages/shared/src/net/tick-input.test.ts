// packages/shared/src/net/tick-input.test.ts
import { describe, expect, it } from "vitest";
import { NEUTRAL_KEYS, TickInputBuffer, isInputPacket, type InputFrame } from "./tick-input.js";

const f = (tick: number, over: Partial<InputFrame> = {}): InputFrame => ({ tick, steer: 0, throttle: 1, fireSlots: 0, ...over });

describe("isInputPacket", () => {
  it("accepts 1..4 valid frames", () => {
    expect(isInputPacket({ inputs: [f(10)] })).toBe(true);
    expect(isInputPacket({ inputs: [f(7), f(8), f(9), f(10, { aimAngle: 1.2, viewTick: 4 })] })).toBe(true);
  });
  it("rejects bad shapes", () => {
    expect(isInputPacket(null)).toBe(false);
    expect(isInputPacket({ inputs: [] })).toBe(false);
    expect(isInputPacket({ inputs: [f(1), f(2), f(3), f(4), f(5)] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), steer: 2 }] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), tick: -1 }] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), tick: 1.5 }] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), fireSlots: 1.5 }] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), aimAngle: Number.NaN }] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), viewTick: -3 }] })).toBe(false);
  });
});

describe("TickInputBuffer", () => {
  it("consumes the frame for its own tick, once", () => {
    const b = new TickInputBuffer(15, 15);
    expect(b.offer(f(11, { steer: 1 }), 10)).toBe("accepted");
    expect(b.offer(f(11, { steer: -1 }), 10)).toBe("duplicate");
    const got = b.take(11);
    expect(got.repeated).toBe(false);
    expect(got.keys.steer).toBe(1);
  });

  it("drops late and far-future frames", () => {
    const b = new TickInputBuffer(15, 15);
    expect(b.offer(f(10), 10)).toBe("late");
    expect(b.offer(f(11 + 16), 10)).toBe("early");
    expect(b.offer(f(11 + 15), 10)).toBe("accepted");
  });

  it("repeats the last real input while missing, then goes neutral", () => {
    const b = new TickInputBuffer(2, 15);
    b.offer(f(1, { steer: 1, fireSlots: 2 }), 0);
    b.take(1);
    expect(b.take(2)).toMatchObject({ repeated: true, keys: { steer: 1, fireSlots: 2 } });
    expect(b.take(3)).toMatchObject({ repeated: true, keys: { steer: 1 } });
    expect(b.take(4)).toMatchObject({ repeated: true, keys: NEUTRAL_KEYS });
  });

  it("discards frames at or below a taken tick", () => {
    const b = new TickInputBuffer(15, 15);
    b.offer(f(5), 3);
    b.take(6);
    expect(b.take(5).repeated).toBe(true); // already discarded
  });

  it("measures slack from accepted frames only", () => {
    const b = new TickInputBuffer(15, 15);
    b.offer(f(12), 10); // slack 1
    b.offer(f(14), 10); // slack 3
    b.offer(f(14), 10); // duplicate, ignored
    expect(b.slackMeanTicks()).toBe(2);
    expect(b.slackStdTicks()).toBe(1);
  });
});
