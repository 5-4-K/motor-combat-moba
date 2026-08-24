import { describe, expect, it } from "vitest";
import { InterpolationBuffer } from "./interpolation.js";

describe("InterpolationBuffer (P0 stub)", () => {
  it("sample on empty buffer returns undefined", () => {
    const buf = new InterpolationBuffer();
    expect(buf.sample(0)).toBeUndefined();
  });

  it("after two pushes, sample returns the second pose", () => {
    const buf = new InterpolationBuffer();
    const first = { x: 1, y: 1, angle: 0, speed: 0, reverseHold: 0 };
    const second = { x: 5, y: 7, angle: 1.2, speed: 10, reverseHold: 0 };
    buf.push(100, first);
    buf.push(200, second);
    expect(buf.sample(250)).toEqual(second);
  });
});
