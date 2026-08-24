import { describe, expect, it } from "vitest";
import { stepSim } from "./step.js";

describe("stepSim (P0 stub)", () => {
  it("returns the same pose", () => {
    const out = stepSim(
      { x: 1, y: 2, angle: 0.5, speed: 3, reverseHold: 0 },
      { seq: 1, steer: 0, throttle: 0, fire: false },
      1 / 30,
    );
    expect(out).toEqual({ x: 1, y: 2, angle: 0.5, speed: 3, reverseHold: 0 });
  });
});
