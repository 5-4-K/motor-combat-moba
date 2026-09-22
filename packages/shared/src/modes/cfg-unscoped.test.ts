// Dedicated file, deliberately alone: this is the one test that must observe the UNSCOPED state,
// so it must never share a file (or import anything) that installs a mode as a side effect. See
// MC12 and the "cfg() has no default-mode fallback" rule in modes/active.ts.
import { describe, expect, it } from "vitest";
import { cfg, hasMode } from "./active.js";

describe("cfg outside a scope (MC12)", () => {
  it("throws rather than serving a default mode's numbers", () => {
    expect(hasMode()).toBe(false);
    expect(() => cfg()).toThrow(/outside a mode scope/);
  });
});
