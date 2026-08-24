import { describe, expect, it } from "vitest";
import { MSG_RETURN_TO_LOBBY, MSG_SELECT_CAR } from "./lobby-messages.js";

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
