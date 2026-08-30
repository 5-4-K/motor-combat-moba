import { describe, expect, it } from "vitest";
import { arenaMismatchMessage } from "./arena-mismatch.js";

describe("arenaMismatchMessage", () => {
  it("names the server's arena and the ones this build has", () => {
    const message = arenaMismatchMessage("arena-03", ["arena-01", "arena-02"]);
    expect(message).toContain("arena-03");
    expect(message).toContain("arena-01, arena-02");
  });

  it("tells the reader what to actually do about it", () => {
    const message = arenaMismatchMessage("arena-03", ["arena-01"]);
    expect(message).toMatch(/rebuild/i);
    expect(message).toMatch(/refresh/i);
  });

  it("handles a build with no arenas registered without producing a dangling list", () => {
    const message = arenaMismatchMessage("arena-03", []);
    expect(message).toContain("(none)");
  });
});
