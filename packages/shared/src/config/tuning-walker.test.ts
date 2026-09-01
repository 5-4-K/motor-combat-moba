import { describe, expect, it } from "vitest";
import { setTuning } from "./tuning.js";
import { sanitizeStoredTuning, tunableFields, validateTuning } from "./tuning-walker.js";

describe("tuning walker", () => {
  it("every emitted path round-trips through setTuning without throwing", () => {
    for (const f of tunableFields()) {
      expect(() => setTuning({ [f.path]: f.shipped })).not.toThrow();
    }
    setTuning(null);
  });

  it("walks the six ratings per car and nothing else from CAR_TABLE", () => {
    const mirage = tunableFields().filter((f) => f.group === "car" && f.ownerId === "mirage");
    expect(mirage.map((f) => f.label).sort()).toEqual(["accel", "attack", "handling", "hp", "mass", "speed"]);
  });

  it("skips identity fields at any depth and never emits color or kind", () => {
    expect(tunableFields().some((f) => /(^|\.)(id|name|kind|color)$/.test(f.label))).toBe(false);
  });

  it("validateTuning rejects the whole blob on one bad entry", () => {
    expect(validateTuning({ "drive.baseTurnRate": 1, "drive.nope": 2 }).ok).toBe(false);
    expect(validateTuning({ "drive.baseTurnRate": Number.NaN }).ok).toBe(false);
    expect(validateTuning({ "car.mirage.speed": 101 }).ok).toBe(false); // above max
  });

  it("sanitizeStoredTuning drops stale paths silently and keeps good ones", () => {
    const clean = sanitizeStoredTuning({ "drive.baseTurnRate": 2, "weapon.retired.damage": 5 });
    expect(Object.keys(clean)).toEqual(["drive.baseTurnRate"]);
  });
});
