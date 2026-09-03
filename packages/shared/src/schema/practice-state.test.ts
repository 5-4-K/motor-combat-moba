import { describe, expect, it } from "vitest";
import { ArenaState } from "./ArenaState.js";
import { PracticeState } from "./PracticeState.js";

describe("PracticeState", () => {
  it("is an ArenaState, so a plain arena client decodes it", () => {
    expect(new PracticeState()).toBeInstanceOf(ArenaState);
  });

  it("starts unpaused", () => {
    expect(new PracticeState().paused).toBe(false);
  });

  it("adds exactly one field over ArenaState (PR6)", () => {
    const added = Object.keys(new PracticeState()).filter(
      (key) => !Object.keys(new ArenaState()).includes(key),
    );
    expect(added).toEqual(["paused"]);
  });
});
