import { describe, expect, it } from "vitest";
import { ROOM_FULL_ERROR, shouldRejectSecondArena } from "./singleton-arena.js";

describe("shouldRejectSecondArena", () => {
  it("allows the room that is currently being created", () => {
    expect(shouldRejectSecondArena([{ roomId: "a" }], "a")).toBe(false);
  });

  it("rejects when another arena already exists", () => {
    expect(shouldRejectSecondArena([{ roomId: "a" }, { roomId: "b" }], "b")).toBe(true);
  });
});

describe("ROOM_FULL_ERROR", () => {
  it("is the JoinScene string", () => {
    expect(ROOM_FULL_ERROR).toBe("Room is full");
  });
});
