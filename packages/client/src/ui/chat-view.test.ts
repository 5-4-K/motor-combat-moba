import { describe, expect, it } from "vitest";
import { COLOR_TABLE } from "@motor-combat-moba/shared";
import { chatView, type ChatViewRow } from "./chat-view.js";

function row(overrides: Partial<ChatViewRow> = {}): ChatViewRow {
  return {
    seq: 1,
    sessionId: "them",
    name: "Redline",
    colorId: 0,
    text: "gl hf",
    at: "14:32",
    ...overrides,
  };
}

describe("chatView", () => {
  it("returns nothing for an empty buffer", () => {
    expect(chatView([], "me")).toEqual([]);
  });

  it("labels another player by name", () => {
    expect(chatView([row()], "me")[0].label).toBe("Redline");
  });

  it("labels your own messages 'You'", () => {
    expect(chatView([row({ sessionId: "me" })], "me")[0].label).toBe("You");
  });

  it("paints the name in the sender's lobby colour", () => {
    expect(chatView([row({ colorId: 2 })], "me")[0].hex).toBe(COLOR_TABLE[2].hex);
  });

  it("falls back to grey for a colour id off the end of the table", () => {
    const view = chatView([row({ colorId: 99 })], "me");
    expect(view[0].hex).toBe("#888888");
  });

  it("keeps the sender's snapshotted name even when they are no longer in the room", () => {
    // Nothing here consults a player list, which is the whole point of LC1.
    expect(chatView([row({ name: "Ghost" })], "me")[0].label).toBe("Ghost");
  });

  it("passes text and time through untouched", () => {
    const view = chatView([row({ text: "no rush", at: "09:05" })], "me");
    expect(view[0].text).toBe("no rush");
    expect(view[0].at).toBe("09:05");
  });

  it("keys each message by its seq, which is unique across a shift", () => {
    const view = chatView([row({ seq: 21 }), row({ seq: 22 })], "me");
    expect(view.map((m) => m.key)).toEqual(["21", "22"]);
  });

  it("preserves buffer order — oldest first (LC2)", () => {
    const view = chatView([row({ seq: 1, text: "first" }), row({ seq: 2, text: "second" })], "me");
    expect(view.map((m) => m.text)).toEqual(["first", "second"]);
  });
});
