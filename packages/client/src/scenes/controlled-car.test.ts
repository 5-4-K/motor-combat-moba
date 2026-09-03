import { describe, expect, it } from "vitest";
import { ArenaState, PlaygroundState } from "@motor-combat-moba/shared";
import { controlledCarOf, isSimPaused } from "./controlled-car.js";

describe("controlledCarOf", () => {
  it("resolves a real match to the client's own session", () => {
    // The property the whole seam rests on: `ArenaState` has no `controlledSessionId`, so every
    // shipped room answers exactly what `room.sessionId` answered before this module existed.
    expect(controlledCarOf(new ArenaState(), "abc")).toBe("abc");
  });

  it("resolves a playground with no controlled car set to the client's own session", () => {
    // `PlaygroundState` initialises the field to "" rather than leaving it absent, so the empty
    // string has to fall through to the same answer an absent field gives.
    expect(controlledCarOf(new PlaygroundState(), "abc")).toBe("abc");
  });

  it("resolves a playground to the controlled car, not the connection", () => {
    const state = new PlaygroundState();
    state.controlledSessionId = "bot";
    expect(controlledCarOf(state, "abc")).toBe("bot");
  });

  it("still answers the controlled car when it IS the client's own session", () => {
    const state = new PlaygroundState();
    state.controlledSessionId = "abc";
    expect(controlledCarOf(state, "abc")).toBe("abc");
  });
});

describe("isSimPaused", () => {
  it("is false on a real match state", () => {
    expect(isSimPaused(new ArenaState())).toBe(false);
  });

  it("is false on an unpaused playground", () => {
    expect(isSimPaused(new PlaygroundState())).toBe(false);
  });

  it("is true on a paused playground", () => {
    const state = new PlaygroundState();
    state.paused = true;
    expect(isSimPaused(state)).toBe(true);
  });
});
