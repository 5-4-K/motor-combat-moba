import { drive, facesOfNormal, rectPlanes } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
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
 * predicate the `unpin` situation is classified from. Since BB31 it is a thin wrapper over
 * `wallPush`'s accumulators, beside `spikesAhead` and `inCorner`. The FILE KEEPS ITS NAME on purpose. It still
 * answers exactly one question and that question is a movement question — may the car go this way —
 * and the name is what the R-O2 provenance comments in `controller.ts` and `bot-profiles.ts` point
 * at. Renaming it to `walls.ts` would buy accuracy today and cost that thread, on a seam future
 * movement helpers are expected to land on.
 */

export interface Push { x: number; y: number }

type Pose = { x: number; y: number; angle: number };

function hullMargin(): number {
  const d = drive();
  return Math.max(d.carWidth, d.carHeight) / 2;
}

/**
 * Boundary planes and plain obstacles near the look-ahead point: `wallAhead`'s geometry, as a
 * vector. Spike strips are skipped here (`spikePush` owns them) so a spike is not counted twice.
 *
 * Every boundary plane, not two axes: a chamfer is neither, and a bot that only knows the
 * rectangle drives into one believing it is open floor. The push is accumulated rather than
 * short-circuited on the first wall found (R-O2): two pushes that cancel read as "nothing", as
 * `wallDesire` did.
 */
function aheadPush(self: Pose, arena: BotArenaView, lookaheadUnits: number): Push {
  const aheadX = self.x + Math.cos(self.angle) * lookaheadUnits;
  const aheadY = self.y + Math.sin(self.angle) * lookaheadUnits;
  const margin = hullMargin();
  let x = 0, y = 0;
  for (const plane of arena.planes ?? rectPlanes(arena.width, arena.height)) {
    if (plane.nx * aheadX + plane.ny * aheadY - plane.d < margin) { x += plane.nx; y += plane.ny; }
  }
  for (const box of arena.obstacles) {
    if (box.kind === "spike") continue;
    if (aheadX > box.x - margin && aheadX < box.x + box.w + margin &&
        aheadY > box.y - margin && aheadY < box.y + box.h + margin) {
      x += self.x - (box.x + box.w / 2);
      y += self.y - (box.y + box.h / 2);
    }
  }
  return { x, y };
}

/**
 * Spike strips near the look-ahead point, honouring one-sided faces: `spikesAhead`'s geometry.
 * A one-sided spike (tile cells TC26) only counts when the car is on a face that damages: the
 * nearest point of the box to the car centre gives the outward direction. A centre inside the box
 * counts, since the car is already past any face.
 */
function spikePush(self: Pose, arena: BotArenaView, lookaheadUnits: number): Push {
  const aheadX = self.x + Math.cos(self.angle) * lookaheadUnits;
  const aheadY = self.y + Math.sin(self.angle) * lookaheadUnits;
  const margin = hullMargin();
  let x = 0, y = 0;
  for (const box of arena.obstacles) {
    if (box.kind !== "spike") continue;
    if (!(aheadX > box.x - margin && aheadX < box.x + box.w + margin &&
          aheadY > box.y - margin && aheadY < box.y + box.h + margin)) continue;
    const qx = Math.min(Math.max(self.x, box.x), box.x + box.w);
    const qy = Math.min(Math.max(self.y, box.y), box.y + box.h);
    const nx = self.x - qx, ny = self.y - qy;
    const inside = qx === self.x && qy === self.y;
    const faces = box.damageFaces;
    if (!inside && faces !== undefined && !facesOfNormal(nx, ny).some((f) => faces.includes(f))) continue;
    if (inside) { x += self.x - (box.x + box.w / 2); y += self.y - (box.y + box.h / 2); }
    else { x += nx; y += ny; }
  }
  return { x, y };
}

/**
 * Two or more boundary planes within `minEngageUnits` of the car centre: a corner (AS28). An edge
 * puts you near one plane, a corner near two, and a chamfer near three. On a rectangle this is
 * exactly "near a left/right wall and near a top/bottom wall"; `rectPlanes` is the fallback.
 */
function cornerPush(self: { x: number; y: number }, arena: BotArenaView): Push {
  const m = BRAIN_CONSTANTS.minEngageUnits;
  let x = 0, y = 0, near = 0;
  for (const plane of arena.planes ?? rectPlanes(arena.width, arena.height)) {
    if (plane.nx * self.x + plane.ny * self.y - plane.d < m) { near += 1; x += plane.nx; y += plane.ny; }
  }
  return near >= 2 ? { x, y } : { x: 0, y: 0 };
}

function nonZero(p: Push): Push | undefined {
  return p.x !== 0 || p.y !== 0 ? p : undefined;
}

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
 * `arena-01` is a square-cornered tile arena whose walls are compiled into obstacles, with fourteen
 * `kind: "spike"` strips (it was a chamfered octagon until 2026-10-09 — the plane loop below is what
 * makes a chamfer register as a wall rather than open floor, and is still exercised on a legacy
 * octagon fixture). This is no longer only about bounds and corners on the shipped arena. A short look-ahead is not a bug: an
 * easy bot at 40 units and 190-267 u/s (as of the 2026-09-06 heavy-car pass) pins itself on walls,
 * which is free human-likeness. That is exactly why `spikesAhead` (below) must fire earlier than
 * this function does: pinning on a plain wall is free human-likeness, pinning on a spiked one bleeds
 * HP.
 */
export function wallAhead(
  self: Pose,
  arena: BotArenaView,
  lookaheadUnits: number,
): boolean {
  return nonZero(aheadPush(self, arena, lookaheadUnits)) !== undefined;
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
  self: Pose,
  arena: BotArenaView,
  lookaheadUnits: number,
): boolean {
  return nonZero(spikePush(self, arena, lookaheadUnits)) !== undefined;
}

/**
 * Is this car wedged where two walls meet? Counts the BOUNDARY PLANES the car sits within
 * `minEngageUnits` of (AS28); two or more is a corner. Moved here from `controller.ts` (BB31),
 * which re-exports it for its unit test. `pinned` ORs it with `wallAhead` and `spikesAhead`,
 * either of which would mask it in most corner poses, so test it directly.
 */
export function inCorner(self: { x: number; y: number }, arena: BotArenaView): boolean {
  return nonZero(cornerPush(self, arena)) !== undefined;
}

/**
 * Everything the car should move away from, summed (BB31): walls and obstacles near the look-ahead
 * point, spikes (damaging faces only) near the longer spike look-ahead, and a corner at the car's
 * own position. `undefined` when there is nothing.
 */
export function wallPush(self: Pose, arena: BotArenaView, lookaheadUnits: number): Push | undefined {
  const a = aheadPush(self, arena, lookaheadUnits);
  const sp = spikePush(self, arena, lookaheadUnits * BRAIN_CONSTANTS.spikeLookaheadFactor);
  const c = cornerPush(self, arena);
  return nonZero({ x: a.x + sp.x + c.x, y: a.y + sp.y + c.y });
}
