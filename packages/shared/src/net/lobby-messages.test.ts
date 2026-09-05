import { describe, expect, it } from "vitest";
import { MSG_RETURN_TO_LOBBY, MSG_SELECT_CAR, MSG_CHAT, isChatPayload } from "./lobby-messages.js";

describe("P3 lobby messages", () => {
  it("exports select_car and return_to_lobby type strings", () => {
    expect(MSG_SELECT_CAR).toBe("select_car");
    expect(MSG_RETURN_TO_LOBBY).toBe("return_to_lobby");
  });
});

describe("P5 removals", () => {
  it("no longer exports a stub end-match message", async () => {
    // The stub was P3's placeholder for "someone won". Real elimination replaced it, and the whole
    // handler is gone server-side: a client that still sent it would be talking to nothing.
    const messages = await import("./lobby-messages.js");
    expect(Object.keys(messages)).not.toContain("MSG_STUB_END_MATCH");
  });
});

describe("MSG_CHAT (LC15)", () => {
  it("exports the chat message type string", () => {
    expect(MSG_CHAT).toBe("chat");
  });
});

describe("isChatPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(isChatPayload({ text: "gl hf" })).toBe(true);
  });

  it("accepts an empty string — length is the validator's job, not the guard's", () => {
    expect(isChatPayload({ text: "" })).toBe(true);
  });

  it("rejects a missing text field", () => {
    expect(isChatPayload({})).toBe(false);
  });

  it("rejects a non-string text field", () => {
    expect(isChatPayload({ text: 42 })).toBe(false);
    expect(isChatPayload({ text: null })).toBe(false);
    expect(isChatPayload({ text: ["gl"] })).toBe(false);
  });

  it("rejects text reaching in through the prototype chain", () => {
    expect(isChatPayload(Object.create({ text: "gl hf" }))).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isChatPayload(null)).toBe(false);
    expect(isChatPayload(undefined)).toBe(false);
    expect(isChatPayload("gl hf")).toBe(false);
    expect(isChatPayload(42)).toBe(false);
  });
});
