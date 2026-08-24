import { describe, expect, it } from "vitest";
import { MSG_RETURN_TO_LOBBY, MSG_SELECT_CAR, MSG_STUB_END_MATCH } from "./lobby-messages.js";

describe("P3 lobby messages", () => {
  it("exports select_car, return_to_lobby, and stub_end_match type strings", () => {
    expect(MSG_SELECT_CAR).toBe("select_car");
    expect(MSG_RETURN_TO_LOBBY).toBe("return_to_lobby");
    expect(MSG_STUB_END_MATCH).toBe("stub_end_match");
  });
});
