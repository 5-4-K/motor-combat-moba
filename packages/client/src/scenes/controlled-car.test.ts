import { describe, expect, it } from "vitest";
import { ArenaState, PlaygroundState, PRACTICE_ROOM_NAME, ROOM_NAME } from "@motor-combat-moba/shared";
import { controlledCarOf, isPracticeRoom, isSimPaused } from "./controlled-car.js";

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

// Placed here rather than in a `ui/screens/pause.test.ts` (spec PR22): the function these cases
// pin lives in this module, beside `controlledCarOf` and `isSimPaused`, not in the screen it gates.
describe("isPracticeRoom", () => {
  it("is true for a practice room", () => {
    expect(isPracticeRoom({ name: PRACTICE_ROOM_NAME })).toBe(true);
  });

  it("is false for the arena, so a real match can never open the menu", () => {
    expect(isPracticeRoom({ name: ROOM_NAME })).toBe(false);
  });

  it("is false for the playground, which mounts its own overlay", () => {
    expect(isPracticeRoom({ name: "playground" })).toBe(false);
  });

  it("is false when the room reports no name at all", () => {
    expect(isPracticeRoom({ name: undefined })).toBe(false);
  });
});
