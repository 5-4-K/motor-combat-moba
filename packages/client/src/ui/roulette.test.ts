import { describe, expect, it } from "vitest";
import { rouletteFrames } from "./roulette.js";

describe("rouletteFrames (AR34)", () => {
  const BUDGET = 1500;
  for (let count = 2; count <= 5; count++) {
    for (let from = 0; from < count; from++) {
      for (let target = 0; target < count; target++) {
        it(`count ${count}, ${from} -> ${target}`, () => {
          const frames = rouletteFrames(count, from, target, BUDGET);
          expect(frames.at(-1)?.index).toBe(target);
          expect(frames.length).toBeGreaterThanOrEqual(2 * count);
          frames.forEach((f, i) => {
            const prev = i === 0 ? from : frames[i - 1].index;
            expect(f.index).toBe((prev + 1) % count);
            if (i > 0) expect(f.holdMs).toBeGreaterThanOrEqual(frames[i - 1].holdMs);
          });
          expect(frames.reduce((s, f) => s + f.holdMs, 0)).toBeLessThanOrEqual(BUDGET);
        });
      }
    }
  }
  it("with one card, shows only the target", () => {
    expect(rouletteFrames(1, 0, 0, BUDGET)).toEqual([{ index: 0, holdMs: 0 }]);
  });
});
