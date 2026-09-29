import { describe, expect, it } from "vitest";
import { LINKS } from "./link.js";
import { runNetsim } from "./run.js";

const report = (label: string, m: object) => {
  if (process.env.NETSIM_REPORT) console.log(label, JSON.stringify(m));
};

describe("netsim — legacy client (today's netcode)", () => {
  it("is deterministic for a seed", () => {
    const a = runNetsim({ link: LINKS.net80, model: "legacy", seconds: 5, seed: 3 });
    const b = runNetsim({ link: LINKS.net80, model: "legacy", seconds: 5, seed: 3 });
    expect(a).toEqual(b);
  });

  for (const link of [LINKS.lan, LINKS.net80, LINKS.net150]) {
    it(`produces finite metrics on ${link.name}`, () => {
      const m = runNetsim({ link, model: "legacy", seconds: 20, seed: 1 });
      report(`legacy/${link.name}`, m);
      for (const v of Object.values(m)) if (v !== null) expect(Number.isFinite(v)).toBe(true);
      expect(m.stepsPerTickMax).toBeGreaterThanOrEqual(1);
    });
  }
});
