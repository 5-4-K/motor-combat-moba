import { describe, expect, it } from "vitest";
import type { InputMessage } from "@motor-arena/shared";
import { PredictionBuffer } from "./prediction.js";

const pose = { x: 10, y: 20, angle: 0.3 };
const input: InputMessage = { seq: 1, steer: 1, throttle: 1, fire: false };

describe("PredictionBuffer (P0 stub)", () => {
  it("predict returns identity pose given any input", () => {
    const buf = new PredictionBuffer();
    const out = buf.predict(pose, input, 1 / 30);
    expect(out).toEqual(pose);
  });

  it("reconcile returns the authoritative pose, not the predicted one", () => {
    const buf = new PredictionBuffer();
    const predicted = { x: 99, y: 99, angle: 9 };
    const authoritative = { x: 1, y: 2, angle: 0.5 };
    const out = buf.reconcile(predicted, authoritative);
    expect(out).toEqual(authoritative);
    expect(out).not.toEqual(predicted);
  });
});
