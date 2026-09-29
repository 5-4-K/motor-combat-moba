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

describe("hostile input", () => {
  const bad = (over: object) => isInputPacket({ inputs: [{ ...f(1), ...over }] });
  it("rejects out-of-range fireSlots", () => {
    for (const v of [-1, 2 ** 31, 1e300, Infinity, Number.NaN, 32]) expect(bad({ fireSlots: v })).toBe(false);
    expect(bad({ fireSlots: 31 })).toBe(true);
  });
  it("rejects non-finite tick, steer, throttle", () => {
    for (const k of ["tick", "steer", "throttle"]) for (const v of [Infinity, Number.NaN]) expect(bad({ [k]: v })).toBe(false);
  });
  it("rejects bad inputs containers", () => {
    expect(isInputPacket({ inputs: "x" })).toBe(false);
    expect(isInputPacket({ inputs: { 0: f(1), length: 1 } })).toBe(false);
    expect(isInputPacket({ inputs: Array.from({ length: 1000 }, (_, i) => f(i)) })).toBe(false);
    // eslint-disable-next-line no-sparse-arrays
    expect(isInputPacket({ inputs: [f(1), , f(3)] })).toBe(false);
  });
  it("survives a __proto__ own key", () => {
    const msg = JSON.parse('{"inputs":[{"tick":1,"steer":0,"throttle":1,"fireSlots":0,"__proto__":{"steer":1}}]}');
    expect(isInputPacket(msg)).toBe(true);
    const b = new TickInputBuffer(15, 15);
    b.offer(msg.inputs[0], 0);
    expect(Object.keys(b.take(1).keys)).not.toContain("__proto__");
    expect(({} as Record<string, unknown>).steer).toBeUndefined();
  });
  it("stores a whitelisted copy", () => {
    const b = new TickInputBuffer(15, 15);
    b.offer({ ...f(1), extra: 1 } as InputFrame, 0);
    expect(b.take(1).frame).toEqual(f(1));
  });
  it("5 duplicate packets yield one frame per tick", () => {
    const b = new TickInputBuffer(15, 15);
    const results: string[] = [];
    for (let n = 0; n < 5; n++) for (const t of [1, 2, 3]) results.push(b.offer(f(t), 0));
    expect(results.filter((r) => r === "accepted")).toHaveLength(3);
    for (const t of [1, 2, 3]) expect(b.take(t).repeated).toBe(false);
    expect(b.take(4).repeated).toBe(true);
  });
  it("drops frames 600 ticks ahead or behind", () => {
    const b = new TickInputBuffer(15, 15);
    expect(b.offer(f(601), 0)).toBe("early");
    expect(b.offer(f(1), 600)).toBe("late");
  });
});
