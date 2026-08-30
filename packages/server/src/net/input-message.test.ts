import { describe, expect, it } from "vitest";
import { isInputMessage } from "./input-message.js";

const valid = { seq: 1, steer: 0 as const, throttle: 0 as const, fireSlots: 0 };

describe("isInputMessage", () => {
  it("accepts a valid InputMessage", () => {
    expect(isInputMessage({ seq: 7, steer: -1, throttle: 1, fireSlots: 0b101 })).toBe(true);
    expect(isInputMessage(valid)).toBe(true);
  });

  it("rejects null, non-objects, and empty objects", () => {
    expect(isInputMessage(null)).toBe(false);
    expect(isInputMessage(undefined)).toBe(false);
    expect(isInputMessage("input")).toBe(false);
    expect(isInputMessage(1)).toBe(false);
    expect(isInputMessage([])).toBe(false);
    expect(isInputMessage({})).toBe(false);
  });

  it("rejects a string seq", () => {
    expect(isInputMessage({ seq: "1", steer: 0, throttle: 0, fireSlots: 0 })).toBe(false);
  });

  it("rejects a missing fireSlots field", () => {
    expect(isInputMessage({ seq: 1, steer: 0, throttle: 0 })).toBe(false);
  });

  it("rejects steer or throttle outside -1 | 0 | 1", () => {
    expect(isInputMessage({ ...valid, steer: 2 })).toBe(false);
    expect(isInputMessage({ ...valid, throttle: 2 })).toBe(false);
    expect(isInputMessage({ ...valid, steer: -2 })).toBe(false);
    expect(isInputMessage({ ...valid, throttle: 0.5 })).toBe(false);
  });

  it("rejects a non-integer or non-finite seq", () => {
    expect(isInputMessage({ ...valid, seq: 1.5 })).toBe(false);
    expect(isInputMessage({ ...valid, seq: NaN })).toBe(false);
    expect(isInputMessage({ ...valid, seq: Infinity })).toBe(false);
  });

  it("rejects a non-numeric or non-integer fireSlots", () => {
    expect(isInputMessage({ ...valid, fireSlots: "0" })).toBe(false);
    expect(isInputMessage({ ...valid, fireSlots: true })).toBe(false);
    expect(isInputMessage({ ...valid, fireSlots: 1.5 })).toBe(false);
    expect(isInputMessage({ ...valid, fireSlots: NaN })).toBe(false);
  });

  // Structural validity only: a negative or over-wide mask is still a legal *shape* on the wire.
  // Sanitising it to what the car may actually use is `serverTick`'s job, not this guard's — it
  // needs `maxWeaponSlots`, which is a sim concern, not a wire-shape one.
  it("accepts a negative or oversized fireSlots as structurally valid", () => {
    expect(isInputMessage({ ...valid, fireSlots: -5 })).toBe(true);
    expect(isInputMessage({ ...valid, fireSlots: 0b1111_1111 })).toBe(true);
  });
});
