import { describe, expect, it } from "vitest";
import { SCROLL_PIN_SLACK_PX, shouldPinToBottom } from "./chat.js";

describe("shouldPinToBottom (LC22)", () => {
  it("pins when the list is scrolled to the very bottom", () => {
    // 400 tall of content in a 200 tall box, scrolled the full 200 down.
    expect(shouldPinToBottom(200, 400, 200)).toBe(true);
  });

  it("pins when the list is shorter than its container", () => {
    expect(shouldPinToBottom(0, 120, 200)).toBe(true);
  });

  it("pins when within the slack of the bottom", () => {
    expect(shouldPinToBottom(200 - SCROLL_PIN_SLACK_PX, 400, 200)).toBe(true);
  });

  it("does not pin when the player has scrolled up to read history", () => {
    // Yanking them back down every time someone talks is the bug this prevents.
    expect(shouldPinToBottom(0, 400, 200)).toBe(false);
  });

  it("does not pin just past the slack", () => {
    expect(shouldPinToBottom(200 - SCROLL_PIN_SLACK_PX - 1, 400, 200)).toBe(false);
  });
});
