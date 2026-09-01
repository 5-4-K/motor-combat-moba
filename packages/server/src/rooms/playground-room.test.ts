import { describe, expect, it } from "vitest";
import { BOT_SESSION_ID, WEAPON_TABLE } from "@motor-combat-moba/shared";
import {
  ARENA_BUSY_ERROR,
  PLAYGROUND_LEVEL,
  otherPlaygroundId,
  shouldRefusePlayground,
} from "./PlaygroundRoom.js";

describe("shouldRefusePlayground", () => {
  it("allows an empty arena listing", () => {
    expect(shouldRefusePlayground([])).toBe(false);
  });

  it("allows an arena room that nobody has joined", () => {
    expect(shouldRefusePlayground([{ clients: 0 }])).toBe(false);
  });

  it("refuses while anyone is in the arena — the tuning store is process-wide", () => {
    expect(shouldRefusePlayground([{ clients: 2 }])).toBe(true);
    expect(shouldRefusePlayground([{ clients: 0 }, { clients: 1 }])).toBe(true);
  });
});

describe("PLAYGROUND_LEVEL", () => {
  it("unlocks every weapon on the roster, so no slot is dead in the sandbox", () => {
    for (const [id, def] of Object.entries(WEAPON_TABLE)) {
      expect(`${id}:${def.unlocksAt <= PLAYGROUND_LEVEL}`).toBe(`${id}:true`);
    }
  });
});

describe("otherPlaygroundId", () => {
  it("flips the human session to the bot and back", () => {
    expect(otherPlaygroundId("abc", "abc")).toBe(BOT_SESSION_ID);
    expect(otherPlaygroundId(BOT_SESSION_ID, "abc")).toBe("abc");
  });

  it("resolves anything else to the human — an unset control field is not a third car", () => {
    expect(otherPlaygroundId("", "abc")).toBe("abc");
  });
});

describe("ARENA_BUSY_ERROR", () => {
  it("names the fix, not the rule", () => {
    expect(ARENA_BUSY_ERROR).toContain("Close the arena first");
  });
});
