import { describe, expect, it } from "vitest";
import { LINKS } from "./link.js";
import type { NetsimMetrics } from "./metrics.js";
import { runNetsimDetailed } from "./run.js";

/**
 * The recorded baseline's run shape (spec §1: six cars, one minute), over three seeds. Skipped unless
 * `NETSIM_BASELINE=1`; Phases C–G record their numbers from this, not from the 20 s default tests:
 *
 *     NETSIM_BASELINE=1 npx vitest run --root packages/server src/netsim/netsim.baseline.test.ts
 *
 * Since Phase F (F5) every car also presses an ability slot every 1–3 s; `NETSIM_NO_FIRE=1` runs the
 * pre-F driving-only shape, which the "after E" column was recorded with.
 */
const FIRE = !process.env.NETSIM_NO_FIRE;
/**
 * `NETSIM_FOV=1` runs the same shape with the mode's FOV on, every snapshot through the real wire
 * (Phase G, G5); `NETSIM_SHOT_MARGIN=<u>` overrides the server's shot margin for a before/after.
 */
const FOV = !!process.env.NETSIM_FOV;
const SHOT_MARGIN = process.env.NETSIM_SHOT_MARGIN ? Number(process.env.NETSIM_SHOT_MARGIN) : undefined;
/** `NETSIM_NO_SWEEP=1`: the FOV run without the swept cone (G5b's before). */
const NO_SWEEP = !!process.env.NETSIM_NO_SWEEP;
const BASELINE_SECONDS = 60;
const BASELINE_CARS = 6;
const BASELINE_SEEDS = [1, 2, 3] as const;
/** Three 60 s six-car runs; each takes a few to ~12 seconds, so this is generous. */
const BASELINE_TIMEOUT_MS = 180_000;

const title = `netsim baseline — tick client, 60 s, six cars, seeds 1–3${FIRE ? ", firing" : ", no firing"}${FOV ? ", FOV on" : ""}`;

describe.skipIf(!process.env.NETSIM_BASELINE)(title, () => {
  for (const link of [LINKS.lan, LINKS.net80clean, LINKS.net80, LINKS.net150]) {
    it(
      `records ${link.name}`,
      () => {
        const runs = BASELINE_SEEDS.map((seed) => {
          const run = runNetsimDetailed({
            link,
            model: "tick",
            seconds: BASELINE_SECONDS,
            seed,
            cars: BASELINE_CARS,
            fire: FIRE,
            fov: FOV,
            shotMarginUnits: SHOT_MARGIN,
            noSweep: NO_SWEEP,
          });
          console.log(`baseline/${link.name}/seed${seed}`, JSON.stringify(run.metrics));
          console.log(`baseline/${link.name}/seed${seed} diagnostics`, JSON.stringify(run.diagnostics));
          if (run.fov) console.log(`baseline/${link.name}/seed${seed} fov`, JSON.stringify(run.fov));
          return run.metrics;
        });
        const summary: Record<string, { mean: number; min: number; max: number } | null> = {};
        for (const key of Object.keys(runs[0]!) as (keyof NetsimMetrics)[]) {
          const values = runs.map((m) => m[key]);
          if (values.some((v) => v === null)) {
            summary[key] = null;
            continue;
          }
          const nums = values as number[];
          summary[key] = {
            mean: nums.reduce((s, v) => s + v, 0) / nums.length,
            min: Math.min(...nums),
            max: Math.max(...nums),
          };
          for (const v of nums) expect(Number.isFinite(v)).toBe(true);
        }
        console.log(`baseline/${link.name}/mean`, JSON.stringify(summary));
      },
      BASELINE_TIMEOUT_MS,
    );
  }
});
