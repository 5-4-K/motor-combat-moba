import { describe, expect, it } from "vitest";
import { forwardOf, lateralOf, speedOf, toWorld } from "./velocity.js";

describe("velocity frame helpers", () => {
  it("reads pure forward motion as forward, with no lateral", () => {
    // Facing +x, moving +x at 100.
    expect(forwardOf(100, 0, 0)).toBeCloseTo(100);
    expect(lateralOf(100, 0, 0)).toBeCloseTo(0);
  });

  it("reads reversing as negative forward", () => {
    expect(forwardOf(-100, 0, 0)).toBeCloseTo(-100);
  });

  it("reads pure sideways motion as lateral, with no forward", () => {
    // Facing +x, moving +y. +y is to the car's LEFT in this coordinate system.
    expect(forwardOf(0, 100, 0)).toBeCloseTo(0);
    expect(lateralOf(0, 100, 0)).toBeCloseTo(100);
  });

  it("decomposes a 45-degree drift into equal parts", () => {
    const angle = 0;
    expect(forwardOf(70.71, 70.71, angle)).toBeCloseTo(70.71, 1);
    expect(lateralOf(70.71, 70.71, angle)).toBeCloseTo(70.71, 1);
  });

  it("respects the car's heading, not the world axes", () => {
    // Facing +y (90 degrees), moving +y at 100: that is pure forward.
    const angle = Math.PI / 2;
    expect(forwardOf(0, 100, angle)).toBeCloseTo(100);
    expect(lateralOf(0, 100, angle)).toBeCloseTo(0);
  });

  it("speedOf is direction-agnostic and never negative", () => {
    expect(speedOf(3, 4)).toBeCloseTo(5);
    expect(speedOf(-3, -4)).toBeCloseTo(5);
  });

  it("toWorld round-trips with forwardOf and lateralOf", () => {
    const angle = 1.234;
    const { vx, vy } = toWorld(angle, 210, -45);
    expect(forwardOf(vx, vy, angle)).toBeCloseTo(210);
    expect(lateralOf(vx, vy, angle)).toBeCloseTo(-45);
  });

  it("toWorld with zero lateral points exactly along the heading", () => {
    const angle = 0.7;
    const { vx, vy } = toWorld(angle, 100, 0);
    expect(vx).toBeCloseTo(Math.cos(angle) * 100);
    expect(vy).toBeCloseTo(Math.sin(angle) * 100);
  });
});
