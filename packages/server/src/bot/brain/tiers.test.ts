import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, TICK_RATE_HZ, installMode, modeConfigOf, weaponDefOf } from "@motor-combat-moba/shared";
import { makeRng } from "../rng.js";
import { HumanController } from "./controller.js";
import { enemy, view } from "./fixtures.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

// The tier characterisation (BB60) and the reported symptoms (BB3) are calibration — what one seed
// and one tier happen to do — and report through `npm run bot:report` (`playtest/bot/tiers.ts`).
// Whole-brain determinism is an invariant and stays here.

describe("whole-brain determinism (BB63)", () => {
  // One seed replays the ENTIRE brain, every tier, with and without a target and with and without a
  // threat, so every branch family runs: the fight path, the evade path, and the no-target path (the
  // predictor at horizon 0 over the stand-in car, the hunt navigator). It compares a run against
  // ITSELF, so it catches nondeterminism leaking outside `(controller, rng)` — module-level mutable
  // state carried between replays, a stray `Math.random`/`Date.now`, an unstable Map/Set iteration
  // order — not a branch-dependent draw.
  const SHOT_PERIOD_TICKS = 60;
  /**
   * A `predator` shot fired at the bot every `SHOT_PERIOD_TICKS`, born 600 u dead ahead on its line
   * and flying straight at it. It closes through every tier's reaction window (BB19) on the way in,
   * so every tier tracks it and medium and hard reach `evade`. Easy notices it with an ETA just over
   * its 24-tick reaction, and the shot lands before a 24-tick recompute can act on it: easy
   * practically never dodges, by design (see "hard dodges a shot that easy ignores" in
   * `playtest/bot/tiers.ts`).
   */
  const shotAt = (tick: number) => {
    const speed = weaponDefOf("predator").speed;
    const age = tick % SHOT_PERIOD_TICKS;
    return {
      id: `shot-${Math.floor(tick / SHOT_PERIOD_TICKS)}`, ownerSessionId: "them", weaponId: "predator" as const,
      x: 200 + 600 - (speed * age) / TICK_RATE_HZ, y: 360, angle: Math.PI,
    };
  };
  const scenes = {
    quiet: (_tick: number) => ({ others: [enemy()], instances: [] }),
    "under fire": (tick: number) => ({ others: [enemy()], instances: [shotAt(tick)] }),
    "no target": (_tick: number) => ({ others: [], instances: [] }),
  } as const;
  for (const tier of ["easy", "medium", "hard"] as const) {
    for (const label of Object.keys(scenes) as (keyof typeof scenes)[]) {
      it(`${tier} replays identically from one seed, ${label}`, () => {
        const replay = () => {
          const bot = new HumanController(tier);
          const rng = makeRng(4242);
          const out: string[] = [];
          const situations = new Set<string>();
          for (let tick = 0; tick < 400; tick++) {
            const intent = bot.decide(view(tick, { ...scenes[label](tick), rng }));
            situations.add(bot.debug()!.situation);
            out.push(`${intent.steer}:${intent.throttle}:${intent.fireSlots}:${intent.aimAngle ?? ""}`);
          }
          return { stream: out.join("|"), situations };
        };
        const first = replay();
        expect(first.stream).toBe(replay().stream);
        // The scene reached the branch it is here to exercise.
        if (label === "under fire" && tier !== "easy") expect(first.situations.has("evade")).toBe(true);
        if (label === "no target") expect([...first.situations]).toEqual(["waitOut"]);
      });
    }
  }
});
