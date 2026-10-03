import { describe, expect, it } from "vitest";
import { NET_CONFIG } from "@motor-combat-moba/shared";
import { SpectateReport } from "./spectate-report.js";

describe("SpectateReport (NR45: tell the server which car the wreck shows)", () => {
  it("reports on wreck start, on every change, and not again for the same pick within the resend window", () => {
    const r = new SpectateReport();
    expect(r.next(false, "", 0)).toBeUndefined(); // alive: nothing to say
    expect(r.next(true, "b", 0)).toBe("b"); // the wreck's first frame
    expect(r.next(true, "b", 16)).toBeUndefined();
    expect(r.next(true, "c", 32)).toBe("c"); // `]`
    expect(r.next(true, "c", 48)).toBeUndefined();
  });

  it("says nothing for an empty pick (nobody to watch, or free roam)", () => {
    const r = new SpectateReport();
    expect(r.next(true, "", 0)).toBeUndefined();
    expect(r.next(true, "b", 16)).toBe("b");
    expect(r.next(true, "", 32)).toBeUndefined();
    expect(r.next(true, "b", 48)).toBe("b"); // a target came back: the server's pick may have moved
  });

  it("starts over after a respawn, so the next wreck reports its first pick again", () => {
    const r = new SpectateReport();
    expect(r.next(true, "b", 0)).toBe("b");
    expect(r.next(false, "", 16)).toBeUndefined();
    expect(r.next(true, "b", 32)).toBe("b");
  });

  it("re-sends an unchanged pick about once a second, so a dropped report does not strand the server", () => {
    const r = new SpectateReport();
    const every = NET_CONFIG.spectateResendMs;
    expect(r.next(true, "b", 1000)).toBe("b");
    expect(r.next(true, "b", 1000 + every - 1)).toBeUndefined();
    expect(r.next(true, "b", 1000 + every)).toBe("b");
    expect(r.next(true, "b", 1000 + every + 16)).toBeUndefined();
    // A change resets the clock: the new pick is sent now and repeated a full interval later.
    expect(r.next(true, "c", 1000 + every + 32)).toBe("c");
    expect(r.next(true, "c", 1000 + 2 * every + 31)).toBeUndefined();
    expect(r.next(true, "c", 1000 + 2 * every + 32)).toBe("c");
  });
});
