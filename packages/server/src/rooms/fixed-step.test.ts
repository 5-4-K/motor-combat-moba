import { describe, expect, it } from "vitest";
import { FixedStepper } from "./fixed-step.js";

const STEP_MS = 1000 / 60;

describe("FixedStepper (Phase C I1)", () => {
  it("averages exactly one step per stepMs over many truncated 16 ms callbacks", () => {
    // Node truncates a 16.67 ms interval to 16 ms; the stepper must not inherit that.
    const stepper = new FixedStepper(STEP_MS, 5);
    let steps = 0;
    for (let i = 0; i < 6000; i++) stepper.advance(16, () => steps++);
    const expected = Math.floor((6000 * 16) / STEP_MS); // 5760
    expect(Math.abs(steps - expected)).toBeLessThanOrEqual(1);
    expect(stepper.droppedMs).toBe(0);
  });

  it("returns how many steps it ran", () => {
    const stepper = new FixedStepper(10, 5);
    let steps = 0;
    expect(stepper.advance(25, () => steps++)).toBe(2);
    expect(steps).toBe(2);
    // The 5 ms left over carries into the next call.
    expect(stepper.advance(5, () => steps++)).toBe(1);
    expect(steps).toBe(3);
  });

  it("runs at most maxCatchUp steps after a stall, and drops the rest instead of spiralling", () => {
    const stepper = new FixedStepper(STEP_MS, 5);
    let steps = 0;
    expect(stepper.advance(500, () => steps++)).toBe(5);
    expect(steps).toBe(5);
    // 500 ms is 30 whole steps; 5 ran, 25 were dropped. The fraction is kept, not dropped.
    expect(stepper.droppedMs).toBeCloseTo(25 * STEP_MS, 6);
    // The next ordinary frame runs one step, not the backlog.
    expect(stepper.advance(STEP_MS, () => steps++)).toBe(1);
  });

  it("runs nothing on a zero or negative elapsed time", () => {
    const stepper = new FixedStepper(STEP_MS, 5);
    let steps = 0;
    expect(stepper.advance(0, () => steps++)).toBe(0);
    expect(stepper.advance(-40, () => steps++)).toBe(0);
    expect(steps).toBe(0);
    // A negative elapsed does not bank a debt against the next frame.
    expect(stepper.advance(STEP_MS, () => steps++)).toBe(1);
  });

  it("rejects a non-positive step or catch-up bound", () => {
    expect(() => new FixedStepper(0, 5)).toThrow();
    expect(() => new FixedStepper(STEP_MS, 0)).toThrow();
  });
});
