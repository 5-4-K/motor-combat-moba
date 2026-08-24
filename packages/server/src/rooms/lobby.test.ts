import { describe, expect, it } from "vitest";
import { selectNextHost } from "./select-next-host.js";

describe("selectNextHost", () => {
  it("returns empty string when no players remain", () => {
    expect(selectNextHost([])).toBe("");
  });

  it("picks the player with the smallest joinedAtTick", () => {
    expect(
      selectNextHost([
        { sessionId: "b", joinedAtTick: 10 },
        { sessionId: "a", joinedAtTick: 3 },
        { sessionId: "c", joinedAtTick: 7 },
      ]),
    ).toBe("a");
  });

  it("tiebreaks equal joinedAtTick with the smallest sessionId", () => {
    expect(
      selectNextHost([
        { sessionId: "zeta", joinedAtTick: 4 },
        { sessionId: "alpha", joinedAtTick: 4 },
        { sessionId: "mu", joinedAtTick: 4 },
      ]),
    ).toBe("alpha");
  });
});
