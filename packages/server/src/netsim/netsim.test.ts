import { describe, expect, it } from "vitest";
import { LINKS } from "./link.js";
import { runNetsim, runNetsimDetailed } from "./run.js";

// Fast smoke. The full link sweep (four links at 20 s, longer seeds, FOV determinism) is in
// netsim.sweep.test.ts, which runs under the slow group.
describe("netsim smoke — tick client", () => {
  it("net150, 3 s: every car steps once per tick, metrics finite, shots end cleanly (NR17, G5)", () => {
    const { metrics: m, diagnostics } = runNetsimDetailed({ link: LINKS.net150, model: "tick", seconds: 3, seed: 1 });
    for (const v of Object.values(m)) if (v !== null) expect(Number.isFinite(v)).toBe(true);
    // NR17: every car steps exactly once per tick, however its frames arrived.
    expect(m.stepsPerTickMax).toBe(1);
    expect(m.repeatedInputRate).not.toBeNull();
    expect(diagnostics.shotEndings).toBeGreaterThan(0);
    expect(diagnostics.phantomShotEndings).toBe(0);
  });

  it("is deterministic for a seed", () => {
    const a = runNetsim({ link: LINKS.net80, model: "tick", seconds: 2, seed: 3 });
    const b = runNetsim({ link: LINKS.net80, model: "tick", seconds: 2, seed: 3 });
    expect(a).toEqual(b);
  });

  it("FOV on, 3 s: no hidden enemy reaches a client, no phantom impact (G5)", () => {
    const run = runNetsimDetailed({ link: LINKS.net80, model: "tick", seconds: 3, seed: 1, fov: true });
    expect(run.fov).toBeDefined();
    // Cars do go out of view and come back, so the check is not vacuous.
    expect(run.fov!.carReveals).toBeGreaterThan(0);
    expect(run.fov!.hiddenLeakSnapshots).toBe(0);
    expect(run.fov!.hiddenLeakFrames).toBe(0);
    expect(run.diagnostics.shotEndings).toBeGreaterThan(0);
    expect(run.diagnostics.phantomShotEndings).toBe(0);
  });
});
