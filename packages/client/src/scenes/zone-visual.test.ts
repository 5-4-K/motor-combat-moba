import { describe, expect, it } from "vitest";
import { zoneTint } from "./zone-visual.js";

describe("zoneTint (CQ52)", () => {
  it("is viewer-relative", () => {
    expect(zoneTint(0, 0, false)).toBe("ally");
    expect(zoneTint(1, 0, false)).toBe("enemy");
    expect(zoneTint(1, 1, false)).toBe("ally");
    expect(zoneTint(0, -1, true)).toBe("neutral");
    expect(zoneTint(0, -1, false)).toBe("neutral");
  });
});
