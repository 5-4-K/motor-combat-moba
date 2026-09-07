import { describe, expect, it } from "vitest";
import { deriveFxEvents, type FxWorldView } from "./events.js";
import { emitterSpecsForAll } from "./emitters.js";
import { eraserStampsFor } from "./occlusion.js";
import {
  asphaltTexture,
  DUST_A,
  DUST_B,
  fireTexture,
  puffTexture,
  scorchTexture,
  SOOT_A,
  SOOT_B,
  sparkTexture,
} from "./textures.js";

/**
 * Budgets for the FX system's *decision* work, following the precedent `packages/client/CLAUDE.md`
 * sets: *"the number to check a new authored beam against is not its fill count — it is `ms` to
 * build one frame's worth at the realistic ceiling."*
 *
 * Only the pure modules are timed. `fx/layer.ts` imports Phaser and cannot load in vitest's node
 * environment, and the GPU cost of what it draws is not something a node test can measure anyway —
 * that judgement belongs to `?dev=fx` and a person looking at the screen.
 *
 * **Both bounds below are measured, not guessed**, and both were tightened from the values this
 * task was drafted with (1 ms per frame, 800 ms at boot) once the real figures came in: a bound
 * fifty times above the observed cost cannot fail for any regression short of a rewrite, and a test
 * that cannot fail proves nothing. Each is now a small multiple of the measurement, with the
 * measurement recorded beside it so the next person can tell a real regression from a slow machine.
 */

/**
 * The realistic ceiling: six cars, and the ~60 live instances `packages/client/CLAUDE.md` names as
 * the cap `renderShots` is built against.
 */
function ceilingViews(): [FxWorldView, FxWorldView] {
  const cars = Array.from({ length: 6 }, (_, i) => ({
    sessionId: `p${i}`,
    x: i * 100,
    y: i * 80,
    angle: i,
    hp: 100 - i,
    alive: true,
    carId: "bastion",
    vx: 0,
    vy: 0,
  }));
  const instances = (offset: number) =>
    Array.from({ length: 60 }, (_, i) => ({
      id: `w${i + offset}`,
      weaponId: i % 3 === 0 ? "magmablast" : i % 3 === 1 ? "thumper" : "lance",
      x: i * 7,
      y: i * 5,
      angle: i * 0.1,
      alive: true,
    }));
  const prev: FxWorldView = { cars, instances: instances(0) };
  // Every instance replaced: 60 endings and 60 firings on one frame, plus six cars taking damage.
  const next: FxWorldView = {
    cars: cars.map((c) => ({ ...c, hp: c.hp - 5 })),
    instances: instances(1000),
  };
  return [prev, next];
}

describe("per-frame FX cost", () => {
  it("is the frame the ceiling actually produces — 126 events, capped to 64 specs", () => {
    // Pins what the timing below is timing. `MAX_SPECS_PER_FRAME` is the reason the mapping half
    // of the frame is bounded at all: without it a six-car simultaneous detonation queues
    // thousands of particles, and the per-frame number would be a function of the fight rather
    // than a constant.
    const [prev, next] = ceilingViews();
    const events = deriveFxEvents(prev, next);
    expect(events).toHaveLength(126);
    expect(emitterSpecsForAll(events)).toHaveLength(64);
  });

  it("derives and maps a worst-case frame well inside a 60fps budget", () => {
    const [prev, next] = ceilingViews();
    // Warmed first: an unwarmed first pass times the JIT, not the work, and the point of the bound
    // is the steady-state per-frame cost during a fight.
    for (let i = 0; i < 200; i++) {
      emitterSpecsForAll(deriveFxEvents(prev, next));
      eraserStampsFor(next.cars);
    }
    const started = performance.now();
    const iterations = 2000;
    for (let i = 0; i < iterations; i++) {
      const events = deriveFxEvents(prev, next);
      emitterSpecsForAll(events);
      eraserStampsFor(next.cars);
    }
    const perFrameMs = (performance.now() - started) / iterations;
    // MEASURED: 0.013-0.019 ms warm, 0.046 ms on a cold 200-iteration pass. That is 0.1% of a
    // 16.7 ms frame. The bound is 0.25 ms — ~5x the coldest observation, ~15x the warm one, and
    // still only 1.5% of a frame, so it leaves the renderer everything while remaining a bound a
    // real regression could cross: making the instance diff quadratic in `next.instances`, or
    // dropping `MAX_SPECS_PER_FRAME`, both land well past it.
    expect(perFrameMs).toBeLessThan(0.25);
  });
});

describe("boot texture cost", () => {
  it("generates the whole texture set in well under a second", () => {
    const started = performance.now();
    // The exact set `FxLayer.uploadTextures` builds, in its order — four puffs, two fires, a spark,
    // a scorch and the floor. Timing a subset would under-report the thing the bound is about.
    puffTexture(1, DUST_A);
    puffTexture(405, DUST_B);
    puffTexture(809, SOOT_A);
    puffTexture(913, SOOT_B);
    fireTexture(1);
    fireTexture(78);
    sparkTexture();
    scorchTexture(1);
    asphaltTexture(1);
    const elapsed = performance.now() - started;
    // MEASURED: 41-59 ms, of which `asphaltTexture` at 512x512 is ~36 ms on its own — the floor is
    // three quarters of boot. Deliberately NOT warmed: this runs cold exactly once per scene
    // create, so the cold number is the honest one. The bound is 250 ms, ~4x the slowest
    // observation. If it regresses, the octave counts in `asphaltTexture` are the first thing to
    // check, and its `size` argument the second.
    expect(elapsed).toBeLessThan(250);
  });
});
