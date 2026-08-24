import { describe, expect, it } from "vitest";
import { isInputMessage } from "./input-message.js";

const valid = { seq: 1, steer: 0 as const, throttle: 0 as const, fire: false };

describe("isInputMessage", () => {
  it("accepts a valid InputMessage", () => {
    expect(isInputMessage({ seq: 7, steer: -1, throttle: 1, fire: true })).toBe(true);
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
    expect(isInputMessage({ seq: "1", steer: 0, throttle: 0, fire: false })).toBe(false);
  });

  it("rejects a missing fire field", () => {
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

  it("rejects a non-boolean fire", () => {
    expect(isInputMessage({ ...valid, fire: "false" })).toBe(false);
    expect(isInputMessage({ ...valid, fire: 0 })).toBe(false);
  });
});
