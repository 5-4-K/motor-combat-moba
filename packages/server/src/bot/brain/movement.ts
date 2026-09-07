import { DRIVE_CONFIG } from "@motor-combat-moba/shared";
import type { BotArenaView } from "../types.js";

/**
 * What is left of the movement layer after the planner took it over (spec P6, P27).
 *
 * This file used to hold the desire-vector model — `blendHeading`, `goalDesire`, `dodgeDesires`,
 * `wallDesire`, `reduceToIntent` — plus `compensateForLag`, `nearBound`, `openFloorHeading` and
 * `reverseWouldHitBound`. `planner.ts` emits `steer`/`throttle` directly now, so every one of them
 * lost its last production caller and went in phase D's task 4. Spec P6 is explicit that the
 * blend is not repairable — "the averaging IS spec section 1.1; there is no variant of it without
 * that failure mode" — so it was deleted rather than kept behind a flag.
 *
 * `wallAhead` is the survivor, and it is not a leftover: `controller.ts` reads it as the `pinned`
 * predicate the `unpin` situation is classified from. The FILE KEEPS ITS NAME on purpose. It still
 * answers exactly one question and that question is a movement question — may the car go this way —
 * and the name is what the R-O2 provenance comments in `controller.ts` and `bot-profiles.ts` point
 * at. Renaming it to `walls.ts` would buy accuracy today and cost that thread, on a seam the
 * netcode/rendering rewrite is expected to add movement helpers back to.
 */

/**
 * Would the car reach a wall or an obstacle within `lookaheadUnits` (H39)?
 *
 * R-O2. `controller.ts`'s `pinned` — the input the `unpin` situation is classified from — used to
 * be `wallDesire(...) !== undefined`, which is a PREDICATE that happened to be spelled as a
 * heading. P27 deleted the heading half of the movement layer; the predicate is not part of that
 * and must keep answering on exactly the same ticks, or `unpin` fires somewhere else than it used
 * to and `tiers.test.ts`'s H39 wall test is measuring a different bot.
 *
 * It is deliberately NOT a current-position bound test, which ignores which way the nose is
 * pointed — that would be a different predicate firing on different ticks.
 *
 * The push VECTOR is still accumulated and only then tested for zero, rather than short-circuiting
 * on the first wall found, because that is what `wallDesire` did and R-O2's whole promise is "the
 * same ticks". A short-circuit would answer `true` on the (arena-degenerate, but constructible in a
 * test) scenes where two pushes cancelled and the old predicate answered `false`.
 */
export function wallAhead(
  self: { x: number; y: number; angle: number },
  arena: BotArenaView,
  lookaheadUnits: number,
): boolean {
  const aheadX = self.x + Math.cos(self.angle) * lookaheadUnits;
  const aheadY = self.y + Math.sin(self.angle) * lookaheadUnits;
  const margin = Math.max(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2;

  let pushX = 0;
  let pushY = 0;
  if (aheadX < margin) pushX += 1;
  if (aheadX > arena.width - margin) pushX -= 1;
  if (aheadY < margin) pushY += 1;
  if (aheadY > arena.height - margin) pushY -= 1;

  for (const box of arena.obstacles) {
    if (
      aheadX > box.x - margin && aheadX < box.x + box.w + margin &&
      aheadY > box.y - margin && aheadY < box.y + box.h + margin
    ) {
      pushX += self.x - (box.x + box.w / 2);
      pushY += self.y - (box.y + box.h / 2);
    }
  }

  return pushX !== 0 || pushY !== 0;
}
