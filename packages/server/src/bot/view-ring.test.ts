import { describe, expect, it } from "vitest";
import { ViewRing, type WorldSnapshot } from "./view-ring.js";

function snap(tick: number): WorldSnapshot {
  return { tick, cars: [], instances: [] };
}

describe("ViewRing (B19)", () => {
  it("returns what was pushed for that exact tick", () => {
    const ring = new ViewRing(4);
    ring.push(snap(10));
    expect(ring.at(10)).toEqual(snap(10));
  });

  it("returns undefined for a tick never pushed", () => {
    const ring = new ViewRing(4);
    ring.push(snap(10));
    expect(ring.at(11)).toBeUndefined();
  });

  it("returns undefined for a negative tick", () => {
    const ring = new ViewRing(4);
    expect(ring.at(-1)).toBeUndefined();
  });

  it("never answers a wrapped-around slot as if it were the tick asked for", () => {
    // Capacity 3: pushing ticks 0,1,2,3 wraps tick 3 into tick 0's slot. Asking for tick 0 again
    // must report "gone", not silently hand back tick 3's snapshot from the same slot.
    const ring = new ViewRing(3);
    ring.push(snap(0));
    ring.push(snap(1));
    ring.push(snap(2));
    ring.push(snap(3));
    expect(ring.at(0)).toBeUndefined();
    expect(ring.at(3)).toEqual(snap(3));
  });

  it("rejects a non-positive or non-integer capacity", () => {
    expect(() => new ViewRing(0)).toThrow();
    expect(() => new ViewRing(-1)).toThrow();
    expect(() => new ViewRing(1.5)).toThrow();
  });
});
