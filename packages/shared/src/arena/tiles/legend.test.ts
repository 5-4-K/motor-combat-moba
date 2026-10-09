import { describe, expect, it } from "vitest";
import { DEFAULT_LEGEND, effectiveLegend } from "./legend.js";

describe("effectiveLegend (TC15)", () => {
  it("is the default legend when the arena authors none", () => {
    expect(effectiveLegend("a", undefined)).toEqual(DEFAULT_LEGEND);
  });

  it("replaces a default key whole", () => {
    const legend = effectiveLegend("a", { ".": { tile: "wall", art: "grass" } });
    expect(legend["."]).toEqual({ tile: "wall", art: "grass" });
    expect(legend["#"]).toEqual(DEFAULT_LEGEND["#"]);
  });

  it("adds a new key", () => {
    const legend = effectiveLegend("a", { v: { tile: "spike", orientation: 180 } });
    expect(legend.v).toEqual({ tile: "spike", orientation: 180 });
    expect(Object.keys(legend).sort()).toEqual([...Object.keys(DEFAULT_LEGEND), "v"].sort());
  });

  it("throws on a key that is not one character, naming the arena and key (TC18)", () => {
    expect(() => effectiveLegend("arena-x", { ab: { tile: "floor" } })).toThrow(/arena-x.*"ab"/);
  });
});
