import { describe, expect, it } from "vitest";
import { DEFAULT_ARENA_ID, getArena, type InputMessage, type StepContext } from "@motor-arena/shared";
import { PredictionBuffer } from "./prediction.js";

const pose = { x: 200, y: 200, angle: 0, speed: 0, reverseHold: 0 };
const input: InputMessage = { seq: 1, steer: 0, throttle: 1, fire: false };

// P4 Task 4: the scene will build this per frame from live room state; `others` stays empty here.
const arena = getArena(DEFAULT_ARENA_ID);
const ctx: StepContext = {
  carId: "rectangle",
  others: [],
  obstacles: arena.obstacles,
  bounds: { width: arena.width, height: arena.height },
};

describe("PredictionBuffer", () => {
  it("predict runs the shared stepSim, so Up from rest moves the pose forward", () => {
    const buf = new PredictionBuffer();
    const out = buf.predict(pose, input, 1 / 30, ctx);
    expect(out.x).toBeGreaterThan(pose.x);
    expect(out.speed).toBeGreaterThan(0);
  });

  it("reconcile returns the authoritative pose, not the predicted one", () => {
    const buf = new PredictionBuffer();
    const predicted = { x: 99, y: 99, angle: 9, speed: 50, reverseHold: 0 };
    const authoritative = { x: 1, y: 2, angle: 0.5, speed: 0, reverseHold: 0 };
    const out = buf.reconcile(predicted, authoritative);
    expect(out).toEqual(authoritative);
    expect(out).not.toEqual(predicted);
  });
});
