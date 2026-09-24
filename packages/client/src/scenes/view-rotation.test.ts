import { describe, expect, it } from "vitest";
import { viewRotationFor } from "./view-rotation.js";

describe("viewRotationFor (CQ46)", () => {
  it("rotates team B only, only in a team mode, only on a flip arena", () => {
    expect(viewRotationFor({ flipForTeamB: true }, "team", 1)).toBe(Math.PI);
    expect(viewRotationFor({ flipForTeamB: true }, "team", 0)).toBe(0);
    expect(viewRotationFor({ flipForTeamB: true }, "ffa", 1)).toBe(0);
    expect(viewRotationFor({}, "team", 1)).toBe(0);
  });
});
