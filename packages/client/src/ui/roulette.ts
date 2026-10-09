/**
 * The roulette Select random plays before the reveal (AR34): the highlight steps one card at a time,
 * slowing down, and always stops on the arena the server already drew. Pure, so every client plays
 * the same spin and a test can hold the "always ends on the target" promise.
 */
export interface RouletteFrame {
  index: number;
  holdMs: number;
}

/** Each step holds this much longer than the one before it. */
const SLOWDOWN = 1.12;
/** Leaves headroom inside the budget so a late frame never runs into the reveal. */
const BUDGET_SHARE = 0.9;

export function rouletteFrames(
  count: number,
  fromIndex: number,
  targetIndex: number,
  budgetMs: number,
): RouletteFrame[] {
  if (count < 2) return [{ index: targetIndex, holdMs: 0 }];
  const steps = 2 * count + ((targetIndex - fromIndex + count) % count);
  const geometric = (SLOWDOWN ** steps - 1) / (SLOWDOWN - 1);
  const first = (budgetMs * BUDGET_SHARE) / geometric;
  const frames: RouletteFrame[] = [];
  for (let i = 1; i <= steps; i++) {
    frames.push({ index: (fromIndex + i) % count, holdMs: Math.floor(first * SLOWDOWN ** (i - 1)) });
  }
  return frames;
}
