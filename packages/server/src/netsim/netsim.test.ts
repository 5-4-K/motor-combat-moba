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
});
