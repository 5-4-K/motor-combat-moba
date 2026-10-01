import { describe, expect, it } from "vitest";
import { type SimBody } from "../sim/step.js";
import { blendPose } from "./interpolation.js";

function pose(x: number, y: number, angle = 0): SimBody {
  return {
    x,
    y,
    angle,
    vx: 0,
    vy: 0,
    angVel: 0,
    maneuver: 0,
    maneuverTicksLeft: 0,
    maneuverAngle: 0,
    maneuverSpeed: 0,
  };
}

describe("blendPose", () => {
  it("lerps position by alpha and carries the newer pose's sim fields", () => {
    const from = pose(0, 0);
    const to: SimBody = {
      x: 100,
      y: 200,
      angle: 0,
      vx: 7,
      vy: -2,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    expect(blendPose(from, to, 0.25)).toEqual({
      x: 25,
      y: 50,
      angle: 0,
      vx: 7,
      vy: -2,
      angVel: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    });
  });

  it("returns the endpoints exactly at alpha 0 and 1", () => {
    const from = pose(1, 2, 0.5);
    const to = pose(3, 4, 1.5);
    expect(blendPose(from, to, 0)).toMatchObject({ x: 1, y: 2, angle: 0.5 });
    expect(blendPose(from, to, 1)).toMatchObject({ x: 3, y: 4 });
    expect(blendPose(from, to, 1).angle).toBeCloseTo(1.5);
  });

  it("blends angle the short way across the +/-PI seam", () => {
    const blended = blendPose(pose(0, 0, 3), pose(0, 0, -3), 0.5);
    // Halfway between 3 and -3 the short way is PI, not 0.
    expect(Math.abs(Math.abs(blended.angle) - Math.PI)).toBeLessThan(1e-9);
  });
});
