import { beforeEach, describe, expect, it } from "vitest";
import { carTintOverrides, sanitizeCarTints, setCarTintOverrides } from "./car-tint.js";

describe("sanitizeCarTints", () => {
  it("keeps a switched-ON tint", () => {
    expect(sanitizeCarTints({ abc: { hex: 0xff2200, on: true } })).toEqual({
      abc: { hex: 0xff2200, on: true },
    });
  });

  it("keeps a switched-OFF tint, because that is a colour being remembered, not an absent one", () => {
    expect(sanitizeCarTints({ abc: { hex: 0xff2200, on: false } })).toEqual({
      abc: { hex: 0xff2200, on: false },
    });
  });

  it("keeps black, which is a legal colour", () => {
    expect(sanitizeCarTints({ abc: { hex: 0x000000, on: true } })).toEqual({
      abc: { hex: 0x000000, on: true },
    });
  });

  it("upgrades a bare number from a blob saved before the toggle existed", () => {
    expect(sanitizeCarTints({ abc: 0xff2200 })).toEqual({ abc: { hex: 0xff2200, on: true } });
  });

  it("drops a hex outside 0x000000..0xffffff rather than clamping it", () => {
    expect(sanitizeCarTints({ a: { hex: -1, on: true }, b: { hex: 0x1000000, on: true } })).toEqual({});
  });

  it("drops a fractional hex, which is not a colour", () => {
    expect(sanitizeCarTints({ a: { hex: 16.5, on: true } })).toEqual({});
  });

  it("drops an entry whose `on` is not a boolean, so a truthy string cannot switch a car", () => {
    expect(sanitizeCarTints({ a: { hex: 0x112233, on: "yes" } })).toEqual({});
  });

  it("drops a malformed entry, and costs only that entry", () => {
    expect(sanitizeCarTints({ a: { on: true }, b: { hex: 0x123456, on: true } })).toEqual({
      b: { hex: 0x123456, on: true },
    });
  });

  it("returns an empty map for anything that is not a plain object", () => {
    for (const bad of [null, undefined, 7, "x", [{ hex: 1, on: true }]]) {
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
    const map = { abc: { hex: 0x112233, on: true } };
    setCarTintOverrides(map);
    expect(carTintOverrides()).toBe(map);
  });

  it("clears back to empty on null, which is what scene shutdown calls", () => {
    setCarTintOverrides({ abc: { hex: 0x112233, on: true } });
    setCarTintOverrides(null);
    expect(carTintOverrides()).toEqual({});
  });
});
