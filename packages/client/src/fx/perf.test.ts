import { describe, expect, it } from "vitest";
import { deriveFxEvents, type FxWorldView } from "./events.js";
import { emitterSpecsForAll } from "./emitters.js";
import { eraserStampsFor } from "./occlusion.js";
import {
  asphaltTexture,
  crackedCrustTexture,
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
      isExplosion: false,
      extent: 0,
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
    // real regression could cross: dropping `MAX_SPECS_PER_FRAME`, or a heavy synchronous op —
    // an added allocation, an extra pass over the instance list — landing on the hot path.
    //
    // What this bound does NOT catch: algorithmic complexity. At this input size (six cars, sixty
    // instances) O(n) and O(n^2) are not far enough apart in wall-clock terms to trip a millisecond
    // budget — replacing `deriveFxEvents`' O(1) Map lookup with a naive `array.find()` measured
    // 0.014 ms here, indistinguishable from the baseline. The "scales linearly" test below is what
    // actually guards the instance diff's complexity, by comparing cost at two input sizes instead
    // of against an absolute bound.
    expect(perFrameMs).toBeLessThan(0.25);
  });

  it("scales linearly with instance count, not quadratically", () => {
    // A direct regression test for the instance diff's Map lookup: swapping it for a naive
    // `array.find()` (O(n) per lookup, so O(n^2) overall) is invisible to the absolute-time bound
    // above at 60 instances, but shows up clearly once the count is compared across an order of
    // magnitude — see the measurement in the comment on that test.
    const viewsAt = (n: number): [FxWorldView, FxWorldView] => {
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
        Array.from({ length: n }, (_, i) => ({
          id: `w${i + offset}`,
          weaponId: i % 3 === 0 ? "magmablast" : i % 3 === 1 ? "thumper" : "lance",
          x: i * 7,
          y: i * 5,
          angle: i * 0.1,
          alive: true,
          isExplosion: false,
          extent: 0,
        }));
      const prev: FxWorldView = { cars, instances: instances(0) };
      const next: FxWorldView = { cars: cars.map((c) => ({ ...c, hp: c.hp - 5 })), instances: instances(1000) };
      return [prev, next];
    };
    const at = (n: number): number => {
      const [prev, next] = viewsAt(n);
      for (let i = 0; i < 200; i++) deriveFxEvents(prev, next); // warm, same reasoning as above
      const iterations = 2000;
      const started = performance.now();
      for (let i = 0; i < iterations; i++) deriveFxEvents(prev, next);
      return (performance.now() - started) / iterations;
    };
    const small = at(60);
    const large = at(600);
    // MEASURED (current O(1) Map lookup): ratio 8.3-9.0 across repeated runs — close to the 10x
    // linear expectation. MEASURED with the Map swapped for `array.find()` (verified on a throwaway
    // copy, never landed in fx/events.ts): ratio 56-58. Linear work gives a ratio near 10; quadratic
    // gives ~100 in theory, and ~57 here because the fixed per-car half of the diff stays O(1) and
    // dilutes it — either way it clears this bound by a wide margin. 30 sits comfortably above the
    // linear noise ceiling seen across runs and comfortably below the quadratic floor.
    expect(large / small).toBeLessThan(30);
  });
});

describe("boot texture cost", () => {
  it("generates the whole texture set in well under a second", () => {
    const started = performance.now();
    // The exact set `FxLayer.uploadTextures` builds, in its order — four puffs, two fires, a spark,
    // a scorch, the floor, and three lava crust/seam variants. Timing a subset would under-report
    // the thing the bound is about.
    puffTexture(1, DUST_A);
    puffTexture(405, DUST_B);
    puffTexture(809, SOOT_A);
    puffTexture(913, SOOT_B);
    fireTexture(1);
    fireTexture(78);
    sparkTexture();
    scorchTexture(1);
    asphaltTexture(1);
    crackedCrustTexture(1 + 1301, 192);
    crackedCrustTexture(1 + 1301 + 97, 192);
    crackedCrustTexture(1 + 1301 + 194, 192);
    const elapsed = performance.now() - started;
    // MEASURED: 66-76 ms cold, of which `asphaltTexture` at 512x512 is 43-51 ms on its own — the
    // floor is still about two thirds of boot. It was 41-59 ms total / ~36 ms asphalt before the
    // floor was made genuinely tileable: `tileableFbm` pays two integer modulos per lattice lookup
    // that `fbm` does not, which is a real ~25% on the whole set and is the price of not drawing a
    // seam grid over the entire arena. The bound is UNCHANGED at 250 ms — still ~3x the slowest
    // observation, and raising it to accommodate the new cost would have thrown away the headroom
    // rather than reported it. Deliberately NOT warmed: this runs cold exactly once per scene
    // create, so the cold number is the honest one. If it regresses, the octave counts in
    // `asphaltTexture` are the first thing to check, and its `size` argument the second.
    expect(elapsed).toBeLessThan(250);
  });
});
