import { describe, expect, it } from "vitest";
import { blendHeading, dodgeDesires, goalDesire, orbitDesire, reduceToIntent, wallDesire } from "./movement.js";

const arena = { width: 1280, height: 720, obstacles: [] };

describe("blendHeading", () => {
  it("returns the fallback when there is nothing to want (H14)", () => {
    expect(blendHeading([], 1.23)).toBe(1.23);
    expect(blendHeading([{ headingRad: 0.5, weight: 0 }], 1.23)).toBe(1.23);
  });

  it("returns the only desire when there is one", () => {
    expect(blendHeading([{ headingRad: 0.5, weight: 2 }], 0)).toBeCloseTo(0.5, 6);
  });

  it("lands between two desires, nearer the heavier one", () => {
    const out = blendHeading(
      [{ headingRad: 0, weight: 3 }, { headingRad: Math.PI / 2, weight: 1 }],
      0,
    );
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(Math.PI / 4);
  });

  it("averages across the +-pi seam without swinging the long way", () => {
    const out = blendHeading(
      [{ headingRad: 3.1, weight: 1 }, { headingRad: -3.1, weight: 1 }],
      0,
    );
    expect(Math.abs(out)).toBeGreaterThan(3.0);
  });
});

describe("wallDesire", () => {
  it("is silent in open floor", () => {
    expect(wallDesire({ x: 640, y: 360, angle: 0 }, arena, 150)).toBeUndefined();
  });

  it("pushes away from a wall the car is driving at", () => {
    const desire = wallDesire({ x: 1200, y: 360, angle: 0 }, arena, 150);
    expect(desire).toBeDefined();
    expect(Math.abs(desire!.headingRad)).toBeGreaterThan(Math.PI / 2);
  });

  it("sees less of the wall with a shorter look-ahead", () => {
    expect(wallDesire({ x: 1180, y: 360, angle: 0 }, arena, 40)).toBeUndefined();
    expect(wallDesire({ x: 1180, y: 360, angle: 0 }, arena, 150)).toBeDefined();
  });
});

describe("orbitDesire", () => {
  it("is silent at orbitBias 0", () => {
    expect(orbitDesire(0, 0, 1)).toBeUndefined();
  });

  it("aims across the target rather than at it", () => {
    const desire = orbitDesire(0, 0.75, 1);
    expect(desire).toBeDefined();
    expect(Math.abs(desire!.headingRad)).toBeCloseTo(Math.PI / 2, 2);
  });

  it("circles the other way when side is -1", () => {
    // Same bearing and bias as the test above, opposite `side` — the two must land on opposite
    // sides of the target bearing, not merely both be +-pi/2 off it (which the `toBeCloseTo` above
    // alone would not catch, since it takes the absolute value).
    const left = orbitDesire(0, 0.75, 1);
    const right = orbitDesire(0, 0.75, -1);
    expect(left!.headingRad).toBeCloseTo(Math.PI / 2, 6);
    expect(right!.headingRad).toBeCloseTo(-Math.PI / 2, 6);
  });
});

describe("dodgeDesires", () => {
  const threat = {
    id: "a", ownerSessionId: "x", weaponId: "predator" as const, noticedAtTick: 0,
    reactAtTick: 0, reacting: true, awayHeadingRad: 1,
  };

  it("carries one desire per active threat at the given weight (G16)", () => {
    const out = dodgeDesires([threat], 0.8);
    expect(out).toHaveLength(1);
    expect(out[0]!.headingRad).toBe(1);
    expect(out[0]!.weight).toBe(0.8);
  });

  it("carries one desire per threat when there is more than one", () => {
    const out = dodgeDesires([
      threat,
      { ...threat, id: "b", ownerSessionId: "y", weaponId: "thumper", awayHeadingRad: -2 },
    ], 0.8);
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.headingRad)).toEqual([1, -2]);
    expect(out.every((d) => d.weight === 0.8)).toBe(true);
  });

  it("lets the goal heading win a blend against a hard dodge (G16)", () => {
    const heading = blendHeading(
      [goalDesire(0), ...dodgeDesires([threat], 0.8)],
      0,
    );
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBeLessThan(1);
  });
});

describe("reduceToIntent", () => {
  it("coasts inside the deadband", () => {
    const out = reduceToIntent({
      headingError: 0, distance: 300, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    expect(out.throttle).toBe(0);
  });

  it("drives forward when too far and reverses when too close", () => {
    const far = reduceToIntent({
      headingError: 0, distance: 600, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    const near = reduceToIntent({
      headingError: 0, distance: 100, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    expect(far.throttle).toBe(1);
    expect(near.throttle).toBe(-1);
  });

  it("does not steer inside the aim tolerance", () => {
    const out = reduceToIntent({
      headingError: 0.05, distance: 300, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    expect(out.steer).toBe(0);
  });

  it("steers toward a heading error outside the tolerance", () => {
    const left = reduceToIntent({
      headingError: 0.8, distance: 300, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    const right = reduceToIntent({
      headingError: -0.8, distance: 300, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    expect(left.steer).toBe(1);
    expect(right.steer).toBe(-1);
  });

  it("drives forward regardless of range when the heading is a break-away", () => {
    const out = reduceToIntent({
      headingError: 0, distance: 100, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: false,
    });
    expect(out.throttle).toBe(1);
  });

  it("still steers toward a heading error on the break-away path", () => {
    // `closing: false` only frees the THROTTLE from range — it must not also silence `steer`, or a
    // break-away would drive blindly straight ahead regardless of which way the chosen heading
    // actually points.
    const left = reduceToIntent({
      headingError: 0.8, distance: 100, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: false,
    });
    const right = reduceToIntent({
      headingError: -0.8, distance: 100, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: false,
    });
    expect(left.steer).toBe(1);
    expect(left.throttle).toBe(1);
    expect(right.steer).toBe(-1);
    expect(right.throttle).toBe(1);
  });
});
