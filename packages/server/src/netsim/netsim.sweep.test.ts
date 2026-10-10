import { describe, expect, it } from "vitest";
import { LINKS } from "./link.js";
import { runNetsim, runNetsimDetailed } from "./run.js";

const report = (label: string, m: object) => {
  if (process.env.NETSIM_REPORT) console.log(label, JSON.stringify(m));
};

describe("netsim — tick client (Phase D netcode)", () => {
  it("is deterministic for a seed", () => {
    const a = runNetsim({ link: LINKS.net80, model: "tick", seconds: 5, seed: 3 });
    const b = runNetsim({ link: LINKS.net80, model: "tick", seconds: 5, seed: 3 });
    expect(a).toEqual(b);
  });

  for (const link of [LINKS.lan, LINKS.net80clean, LINKS.net80, LINKS.net150]) {
    it(`produces finite metrics on ${link.name}`, () => {
      const { metrics: m, diagnostics } = runNetsimDetailed({ link, model: "tick", seconds: 20, seed: 1 });
      report(`tick/${link.name}`, m);
      report(`tick/${link.name} diagnostics`, diagnostics);
      for (const v of Object.values(m)) if (v !== null) expect(Number.isFinite(v)).toBe(true);
      // NR17: every car steps exactly once per tick, however its frames arrived.
      expect(m.stepsPerTickMax).toBe(1);
      expect(m.repeatedInputRate).not.toBeNull();
    });
  }

  it("never draws an impact for a shot the sim had not ended (G5, protocol 8)", () => {
    const { diagnostics } = runNetsimDetailed({ link: LINKS.net80, model: "tick", seconds: 10, seed: 2 });
    report("tick/net80 endings", diagnostics);
    expect(diagnostics.shotEndings).toBeGreaterThan(0);
    expect(diagnostics.phantomShotEndings).toBe(0);
  });
});

describe("netsim — FOV on, through the real wire (Phase G, G5)", () => {
  it("never lets a hidden enemy reach a client's decoded state, and draws no phantom impact", () => {
    const run = runNetsimDetailed({ link: LINKS.net80, model: "tick", seconds: 10, seed: 1, fov: true });
    report("fov/net80", run.fov!);
    expect(run.fov).toBeDefined();
    // Cars do go out of view and come back, so the check is not vacuous.
    expect(run.fov!.carReveals).toBeGreaterThan(0);
    expect(run.fov!.hiddenLeakSnapshots).toBe(0);
    expect(run.fov!.hiddenLeakFrames).toBe(0);
    expect(run.diagnostics.shotEndings).toBeGreaterThan(0);
    expect(run.diagnostics.phantomShotEndings).toBe(0);
  });

  it("is deterministic for a seed", () => {
    const a = runNetsimDetailed({ link: LINKS.net80, model: "tick", seconds: 4, seed: 3, fov: true });
    const b = runNetsimDetailed({ link: LINKS.net80, model: "tick", seconds: 4, seed: 3, fov: true });
    expect(a).toEqual(b);
  });
});
