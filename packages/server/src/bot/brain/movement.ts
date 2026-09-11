import { DRIVE_CONFIG, rectPlanes } from "@motor-combat-moba/shared";
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
 *
 * `arena-01` is the octagon its art draws, with fourteen `kind: "spike"` wall strips (Task 5) — this
 * is no longer only about bounds and corners on the shipped arena, and the plane loop below is what
 * makes a chamfer register as a wall rather than open floor. A short look-ahead is not a bug: an
 * easy bot at 40 units and 190-267 u/s (as of the 2026-09-06 heavy-car pass) pins itself on walls,
 * which is free human-likeness. That is exactly why `spikesAhead` (below) must fire earlier than
 * this function does: pinning on a plain wall is free human-likeness, pinning on a spiked one bleeds
 * HP.
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
  // Every boundary plane, not two axes: a chamfer is neither, and a bot that only knows the
  // rectangle drives into one believing it is open floor. Accumulating rather than short-circuiting
  // is deliberate and pre-existing — see this function's own note about R-O2, above.
  for (const plane of arena.planes ?? rectPlanes(arena.width, arena.height)) {
    if (plane.nx * aheadX + plane.ny * aheadY - plane.d < margin) {
      pushX += plane.nx;
      pushY += plane.ny;
    }
  }

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

/**
 * Is there a spike strip in front of this car? The hazard-aware half of wall awareness (Task 12).
 *
 * Separate from `wallAhead` rather than a weight inside it, because that function answers a
 * BOOLEAN — there is no push vector here to scale. `wallAhead`'s own push vector is discarded down
 * to a yes/no by its final `!== 0` check, so there is nothing to make "stronger" for a spike; "avoid
 * spikes harder" therefore means "notice them sooner", which is what the caller expresses by passing
 * a longer lookahead (`BRAIN_CONSTANTS.spikeLookaheadFactor`, AS28).
 *
 * Every tier gets this, uniformly. How well a tier acts on it is already governed by the reaction
 * and execution knobs it carries; a Hard-only awareness of spikes would be exactly the branch the
 * `bot-tuner` skill exists to prevent.
 */
export function spikesAhead(
  self: { x: number; y: number; angle: number },
  arena: BotArenaView,
  lookaheadUnits: number,
): boolean {
  const aheadX = self.x + Math.cos(self.angle) * lookaheadUnits;
  const aheadY = self.y + Math.sin(self.angle) * lookaheadUnits;
  const margin = Math.max(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2;
  return arena.obstacles.some(
    (box) =>
      box.kind === "spike" &&
      aheadX > box.x - margin && aheadX < box.x + box.w + margin &&
      aheadY > box.y - margin && aheadY < box.y + box.h + margin,
  );
}
