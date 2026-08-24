import { describe, expect, it } from "vitest";
import { ArenaState } from "./ArenaState.js";
import { PlayerState } from "./PlayerState.js";

describe("ArenaState", () => {
  it("constructs with tick 0 and empty players", () => {
    const s = new ArenaState();
    expect(s.tick).toBe(0);
    expect(s.hostSessionId).toBe("");
    expect(s.players.size).toBe(0);
  });

  it("stores a PlayerState in the map", () => {
    const s = new ArenaState();
    const p = new PlayerState();
    p.sessionId = "abc";
    p.x = 100;
    p.y = 80;
    s.players.set("abc", p);
    expect(s.players.get("abc")?.x).toBe(100);
  });
});
