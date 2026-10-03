import { describe, expect, it } from "vitest";
import { SpectateReport } from "./spectate-report.js";

describe("SpectateReport (NR45: tell the server which car the wreck shows)", () => {
  it("reports on wreck start, on every change, and never twice for the same pick", () => {
    const r = new SpectateReport();
    expect(r.next(false, "")).toBeUndefined(); // alive: nothing to say
    expect(r.next(true, "b")).toBe("b"); // the wreck's first frame
    expect(r.next(true, "b")).toBeUndefined();
    expect(r.next(true, "c")).toBe("c"); // `]`
    expect(r.next(true, "c")).toBeUndefined();
  });

  it("says nothing for an empty pick (nobody to watch, or free roam)", () => {
    const r = new SpectateReport();
    expect(r.next(true, "")).toBeUndefined();
    expect(r.next(true, "b")).toBe("b");
    expect(r.next(true, "")).toBeUndefined();
    expect(r.next(true, "b")).toBe("b"); // a target came back: the server's pick may have moved
  });

  it("starts over after a respawn, so the next wreck reports its first pick again", () => {
    const r = new SpectateReport();
    expect(r.next(true, "b")).toBe("b");
    expect(r.next(false, "")).toBeUndefined();
    expect(r.next(true, "b")).toBe("b");
  });
});
