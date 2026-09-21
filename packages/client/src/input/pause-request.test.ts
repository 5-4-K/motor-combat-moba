import { describe, expect, it } from "vitest";
import { PAUSE_REQUEST_TIMEOUT_MS } from "../config/pause-request.js";
import { pauseInFlight, settlePauseRequest } from "./pause-request.js";

describe("a pause request in flight (TR54)", () => {
  it("is nothing before any request", () => {
    expect(pauseInFlight(null, false, 5_000)).toBe(false);
  });

  it("ignores P while the request has not patched back yet", () => {
    // The double-P bug: a second toggle inside one patch interval un-pauses before the client ever
    // sees `paused` go true.
    expect(pauseInFlight(1_000, false, 1_000)).toBe(true);
    expect(pauseInFlight(1_000, false, 1_000 + PAUSE_REQUEST_TIMEOUT_MS - 1)).toBe(true);
    expect(settlePauseRequest(1_000, false, 1_200)).toBe(1_000);
  });

  it("clears the moment the paused patch lands", () => {
    expect(pauseInFlight(1_000, true, 1_050)).toBe(false);
    expect(settlePauseRequest(1_000, true, 1_050)).toBeNull();
  });

  it("clears on its own once the timeout passes with no patch", () => {
    const at = 1_000 + PAUSE_REQUEST_TIMEOUT_MS;
    expect(pauseInFlight(1_000, false, at)).toBe(false);
    expect(settlePauseRequest(1_000, false, at)).toBeNull();
  });

  it("takes the timeout as a seam", () => {
    expect(pauseInFlight(0, false, 50, 40)).toBe(false);
    expect(pauseInFlight(0, false, 30, 40)).toBe(true);
  });

  it("ships a one-second backstop", () => {
    expect(PAUSE_REQUEST_TIMEOUT_MS).toBe(1000);
  });
});
