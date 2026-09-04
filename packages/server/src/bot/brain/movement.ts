import { DRIVE_CONFIG } from "@motor-combat-moba/shared";
import type { BotArenaView } from "../types.js";
import type { KnownThreat } from "./perception.js";

/** One thing the bot would like to point at, and how much it cares. */
export interface Desire {
  headingRad: number;
  weight: number;
}

/** How hard dodging pulls relative to holding a range. Reactive, so it outweighs the plan. */
const DODGE_WEIGHT = 2.5;
/** How hard a wall pushes once it is inside the look-ahead. Above dodge: a wall does not miss. */
const WALL_WEIGHT = 3;

/**
 * Collapse the desires into one heading (H13).
 *
 * Summed as unit vectors so the +-pi seam cannot make two nearly-identical headings average to their
 * opposite. When nothing is wanted — every weight zero, or desires that cancel exactly — the
 * fallback is returned rather than an arbitrary angle (H14); a blend with no fallback dithers on the
 * tick everything cancels, which is this style's known failure mode.
 */
export function blendHeading(desires: readonly Desire[], fallbackHeading: number): number {
  let x = 0;
  let y = 0;
  for (const desire of desires) {
    if (desire.weight <= 0) continue;
    x += Math.cos(desire.headingRad) * desire.weight;
    y += Math.sin(desire.headingRad) * desire.weight;
  }
  if (Math.hypot(x, y) < 1e-6) return fallbackHeading;
  return Math.atan2(y, x);
}

/**
 * Push off a wall or obstacle the car would reach within `lookaheadUnits` (H39).
 *
 * `arena-01` has no obstacles, so on the shipped arena this is entirely about bounds and corners. A
 * short look-ahead is not a bug: an easy bot at 40 units and 320-450 u/s pins itself on walls, which
 * is free human-likeness.
 */
export function wallDesire(
  self: { x: number; y: number; angle: number },
  arena: BotArenaView,
  lookaheadUnits: number,
): Desire | undefined {
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

  if (pushX === 0 && pushY === 0) return undefined;
  return { headingRad: Math.atan2(pushY, pushX), weight: WALL_WEIGHT };
}

/** Circle the target instead of closing head-on (H13). `side` keeps the bot circling one way. */
export function orbitDesire(
  bearingToTarget: number,
  orbitBias: number,
  side: 1 | -1,
): Desire | undefined {
  if (orbitBias <= 0) return undefined;
  return { headingRad: bearingToTarget + (side * Math.PI) / 2, weight: orbitBias };
}

/** One desire per shot worth leaning off (H26) — never a stance, so it composes with fighting. */
export function dodgeDesires(threats: readonly KnownThreat[]): Desire[] {
  return threats.map((threat) => ({ headingRad: threat.awayHeadingRad, weight: DODGE_WEIGHT }));
}

/**
 * The ONE place a heading and a range become `steer` and `throttle` (H15).
 *
 * `closing` false means the blended heading is a break-away rather than an approach — disengaging or
 * dodging — so range no longer governs the throttle: the bot drives the heading it chose.
 */
export function reduceToIntent(args: {
  headingError: number;
  distance: number;
  preferredRange: number;
  deadband: number;
  aimToleranceRad: number;
  closing: boolean;
}): { steer: -1 | 0 | 1; throttle: -1 | 0 | 1 } {
  const { headingError, distance, preferredRange, deadband, aimToleranceRad, closing } = args;

  const steer: -1 | 0 | 1 =
    headingError > aimToleranceRad ? 1 : headingError < -aimToleranceRad ? -1 : 0;

  if (!closing) return { steer, throttle: 1 };

  const throttle: -1 | 0 | 1 =
    Math.abs(distance - preferredRange) <= deadband ? 0 : distance > preferredRange ? 1 : -1;

  return { steer, throttle };
}
