import { describe, expect, it } from "vitest";
import { boundsOf } from "./bounds.js";
import { ARENA_01 } from "./arena-01.js";
import { ARENA_02 } from "./arena-02.js";

describe("boundsOf", () => {
  it("gives a rectangular arena no planes at all", () => {
    const bounds = boundsOf(ARENA_02);
    expect(bounds).toEqual({ width: ARENA_02.width, height: ARENA_02.height });
    expect(bounds.planes).toBeUndefined();
  });

  it("carries the width and height of a polygon arena unchanged", () => {
    const bounds = boundsOf(ARENA_01);
    expect(bounds.width).toBe(ARENA_01.width);
    expect(bounds.height).toBe(ARENA_01.height);
  });
});
