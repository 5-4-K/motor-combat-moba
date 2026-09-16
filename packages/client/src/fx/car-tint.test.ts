import { beforeEach, describe, expect, it } from "vitest";
import { carTintOverrides, sanitizeCarTints, setCarTintOverrides } from "./car-tint.js";

describe("sanitizeCarTints", () => {
  it("keeps a real 0xRRGGBB value under a session id", () => {
    expect(sanitizeCarTints({ abc: 0xff2200 })).toEqual({ abc: 0xff2200 });
  });

  it("keeps black, which is a legal colour and not an absent one", () => {
    expect(sanitizeCarTints({ abc: 0x000000 })).toEqual({ abc: 0x000000 });
  });

  it("drops a value outside 0x000000..0xffffff rather than clamping it", () => {
    expect(sanitizeCarTints({ a: -1, b: 0x1000000 })).toEqual({});
  });

  it("drops a fractional value, which is not a colour", () => {
    expect(sanitizeCarTints({ a: 16.5 })).toEqual({});
  });

  it("drops a non-number, and costs only that entry", () => {
    expect(sanitizeCarTints({ a: "#ff2200", b: 0x123456 })).toEqual({ b: 0x123456 });
  });

  it("returns an empty map for anything that is not a plain object", () => {
    for (const bad of [null, undefined, 7, "x", [0x112233]]) {
      expect(sanitizeCarTints(bad)).toEqual({});
    }
  });
});

describe("car tint store", () => {
  beforeEach(() => setCarTintOverrides(null));

  it("starts empty", () => {
    expect(carTintOverrides()).toEqual({});
  });

  it("hands back the map it was given, so a panel can mutate it in place", () => {
    const map = { abc: 0x112233 };
    setCarTintOverrides(map);
    expect(carTintOverrides()).toBe(map);
  });

  it("clears back to empty on null, which is what scene shutdown calls", () => {
    setCarTintOverrides({ abc: 0x112233 });
    setCarTintOverrides(null);
    expect(carTintOverrides()).toEqual({});
  });
});
