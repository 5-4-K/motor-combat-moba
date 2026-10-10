import { drive, facesOfNormal, rectPlanes } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import type { BotArenaView } from "../types.js";

/**
 * Wall and hazard sensing for the bot (BB31): `wallPush` and the hit-count predicates over the same
 * accumulators.
 *
 * `controller.ts` reads `wallPush` twice per decision: at the tier's `wallLookaheadUnits` for the
 * reactive wall layer (`navigate.ts`'s `avoidWalls`, BB32), and at `minEngageUnits` for the
 * contact half of `pinned`, the stuck test the `unpin` situation is classified from (BB33);
 * `inCorner` is the other half. `wallAhead` and `spikesAhead` answer the same accumulators as
 * booleans; nothing in the brain calls them, and their tests pin the geometry.
 *
 * The desire-vector model that used to live here (`blendHeading`, `wallDesire`, `reduceToIntent`
 * and friends) and the 6.x planner that replaced it are both deleted: the steering law in
 * `navigate.ts` turns a goal into `steer` and `throttle` directly.
 */

export interface Push { x: number; y: number }

/** A summed push plus how many planes/boxes contributed, so "something is there" survives cancellation. */
interface Accum extends Push { hits: number }

type Pose = { x: number; y: number; angle: number };
type Box = { x: number; y: number; w: number; h: number };

function hullMargin(): number {
  const d = drive();
  return Math.max(d.carWidth, d.carHeight) / 2;
}

function lookAheadPoint(self: Pose, lookaheadUnits: number): Push {
  return {
    x: self.x + Math.cos(self.angle) * lookaheadUnits,
    y: self.y + Math.sin(self.angle) * lookaheadUnits,
  };
}

function insideInflated(box: Box, p: Push, margin: number): boolean {
  return p.x > box.x - margin && p.x < box.x + box.w + margin &&
         p.y > box.y - margin && p.y < box.y + box.h + margin;
}

/**
 * Where a box pushes the car: `n` is `self - nearest point of the box` (the raw outward normal the
 * face test reads), `inside` says the car centre is in the box, and `unit` is the direction as a
 * unit vector — along `n`, or along `self - box centre` when the car centre is inside. `unit` is
 * `undefined` when that is zero too (the hit still counts; there is just no direction).
 */
function outwardOf(self: { x: number; y: number }, box: Box): { n: Push; inside: boolean; unit: Push | undefined } {
  const qx = Math.min(Math.max(self.x, box.x), box.x + box.w);
  const qy = Math.min(Math.max(self.y, box.y), box.y + box.h);
  const n = { x: self.x - qx, y: self.y - qy };
  const inside = n.x === 0 && n.y === 0;
  const vx = inside ? self.x - (box.x + box.w / 2) : n.x;
  const vy = inside ? self.y - (box.y + box.h / 2) : n.y;
  const len = Math.hypot(vx, vy);
  return { n, inside, unit: len > 0 ? { x: vx / len, y: vy / len } : undefined };
}

/**
 * Boundary planes and plain obstacles near the look-ahead point: `wallAhead`'s geometry, as a
 * vector. Spike strips are skipped here (`spikePush` owns them), so a spike is not counted twice.
 * Every contribution is a UNIT vector (a plane's normal, or an obstacle's outward direction), so a
 * long wall does not outweigh a short one.
 *
 * Every boundary plane, not two axes: a chamfer is neither, and a bot that only knows the
 * rectangle drives into one believing it is open floor.
 */
function aheadPush(self: Pose, arena: BotArenaView, lookaheadUnits: number): Accum {
  const ahead = lookAheadPoint(self, lookaheadUnits);
  const margin = hullMargin();
  let x = 0, y = 0, hits = 0;
  for (const plane of arena.planes ?? rectPlanes(arena.width, arena.height)) {
    if (plane.nx * ahead.x + plane.ny * ahead.y - plane.d < margin) {
      x += plane.nx; y += plane.ny; hits += 1;
    }
  }
  for (const box of arena.obstacles) {
    if (box.kind === "spike" || !insideInflated(box, ahead, margin)) continue;
    hits += 1;
    const u = outwardOf(self, box).unit;
    if (u !== undefined) { x += u.x; y += u.y; }
  }
  return { x, y, hits };
}

/**
 * Spike strips near any of the given look-ahead distances, honouring one-sided faces:
 * `spikesAhead`'s geometry. Each sampled point contributes independently, so a thin strip the
 * longer sample overshoots is still seen by the shorter one (a strip both samples hit counts once
 * per sample, which is fine for a direction). A one-sided spike (tile cells TC26) only counts when
 * the car is on a face that damages: the nearest point of the box to the car centre gives the
 * outward direction. A centre inside the box counts, since the car is already past any face.
 */
function spikePush(self: Pose, arena: BotArenaView, lookaheads: readonly number[]): Accum {
  const margin = hullMargin();
  let x = 0, y = 0, hits = 0;
  for (const lookahead of lookaheads) {
    const ahead = lookAheadPoint(self, lookahead);
    for (const box of arena.obstacles) {
      if (box.kind !== "spike" || !insideInflated(box, ahead, margin)) continue;
      const o = outwardOf(self, box);
      const faces = box.damageFaces;
      if (!o.inside && faces !== undefined && !facesOfNormal(o.n.x, o.n.y).some((f) => faces.includes(f))) continue;
      hits += 1;
      if (o.unit !== undefined) { x += o.unit.x; y += o.unit.y; }
    }
  }
  return { x, y, hits };
}

/**
 * Two or more boundary planes within `minEngageUnits` of the car centre: a corner (AS28). An edge
 * puts you near one plane, a corner near two, and a chamfer near three. On a rectangle this is
 * exactly "near a left/right wall and near a top/bottom wall"; `rectPlanes` is the fallback.
 */
function cornerPush(self: { x: number; y: number }, arena: BotArenaView): Accum {
  const m = BRAIN_CONSTANTS.minEngageUnits;
  let x = 0, y = 0, near = 0;
  for (const plane of arena.planes ?? rectPlanes(arena.width, arena.height)) {
    if (plane.nx * self.x + plane.ny * self.y - plane.d < m) { near += 1; x += plane.nx; y += plane.ny; }
  }
  return near >= 2 ? { x, y, hits: near } : { x: 0, y: 0, hits: 0 };
}

/**
 * Would the car reach a wall or an obstacle within `lookaheadUnits` (H39)? The boolean form of
 * `wallPush`'s plane-and-obstacle accumulator, with no spike strips and no corner.
 *
 * It is deliberately NOT a current-position bound test, which ignores which way the nose is
 * pointed.
 *
 * It answers `true` when ANY plane or obstacle is within reach (BB31), not when the summed push
 * vector is non-zero: two pushes that cancel (a car between two walls) are still a wall ahead.
 * Spike strips are not counted here — they belong to `spikesAhead` (`spikePush`) — so a one-sided
 * spike's safe face does not read as a wall.
 *
 * `arena-01` is a square-cornered tile arena whose walls are compiled into obstacles, with fourteen
 * `kind: "spike"` strips (it was a chamfered octagon until 2026-10-09 — the plane loop is what
 * makes a chamfer register as a wall rather than open floor, and is still exercised on a legacy
 * octagon fixture).
 */
export function wallAhead(
  self: Pose,
  arena: BotArenaView,
  lookaheadUnits: number,
): boolean {
  return aheadPush(self, arena, lookaheadUnits).hits > 0;
}

/**
 * Is there a spike strip in front of this car? The hazard-aware half of wall awareness (Task 12).
 *
 * Separate from `wallAhead` because a spike bleeds HP where a plain wall is free human-likeness, so
 * the caller wants to notice spikes sooner: "avoid spikes harder" means passing a longer lookahead
 * (`BRAIN_CONSTANTS.spikeLookaheadFactor`, AS28). `wallPush` is the vector form of both.
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
  return spikePush(self, arena, [lookaheadUnits]).hits > 0;
}

/**
 * Is this car wedged where two walls meet? Counts the BOUNDARY PLANES the car sits within
 * `minEngageUnits` of (AS28); two or more is a corner. Moved here from `controller.ts` (BB31),
 * which re-exports it for its unit test. `pinned` ORs it with the contact `wallPush` (BB33), which
 * already counts the corner, so `inCorner` never decides `pinned` alone; the rule names it
 * explicitly, and it is tested directly.
 */
export function inCorner(self: { x: number; y: number }, arena: BotArenaView): boolean {
  return cornerPush(self, arena).hits > 0;
}

/**
 * Everything the car should move away from, summed (BB31): walls and obstacles near the look-ahead
 * point, spikes (damaging faces only) near both the plain and the longer spike look-ahead, and a
 * corner at the car's own position. `undefined` only when nothing contributed at all. When
 * something did but the pushes cancel (a car between two strips, or at a box's exact centre), the
 * result is a unit push opposite the heading, so a consumer backs up rather than reading "clear".
 */
export function wallPush(self: Pose, arena: BotArenaView, lookaheadUnits: number): Push | undefined {
  const a = aheadPush(self, arena, lookaheadUnits);
  const sp = spikePush(self, arena, [lookaheadUnits, lookaheadUnits * BRAIN_CONSTANTS.spikeLookaheadFactor]);
  const c = cornerPush(self, arena);
  if (a.hits + sp.hits + c.hits === 0) return undefined;
  const x = a.x + sp.x + c.x;
  const y = a.y + sp.y + c.y;
  if (Math.hypot(x, y) < 1e-9) return { x: -Math.cos(self.angle), y: -Math.sin(self.angle) };
  return { x, y };
}
