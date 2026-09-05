import { DRIVE_CONFIG, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import type { BotArenaView } from "../types.js";
import type { KnownThreat } from "./perception.js";

/** One thing the bot would like to point at, and how much it cares. */
export interface Desire {
  headingRad: number;
  weight: number;
}

/** How hard a wall pushes once it is inside the look-ahead. Above dodge: a wall does not miss. */
const WALL_WEIGHT = 3;
const GOAL_WEIGHT = 1;

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

/** One desire per shot worth leaning off (G16) — never a goal, so it composes with fighting. */
export function dodgeDesires(threats: readonly KnownThreat[], weight: number): Desire[] {
  if (weight <= 0) return [];
  return threats.map((threat) => ({ headingRad: threat.awayHeadingRad, weight }));
}

export function goalDesire(headingRad: number): Desire {
  return { headingRad, weight: GOAL_WEIGHT };
}

/** True when a point is within `lookaheadUnits` of an arena bound. */
export function nearBound(
  x: number,
  y: number,
  arena: BotArenaView,
  lookaheadUnits: number,
): boolean {
  return (
    x < lookaheadUnits ||
    y < lookaheadUnits ||
    x > arena.width - lookaheadUnits ||
    y > arena.height - lookaheadUnits
  );
}

/**
 * Anticipate the bot's own reaction lag so its bang-bang steering settles instead of oscillating
 * (R9/R10, 2026-09-05).
 *
 * `reduceToIntent`'s `steer` is only ever -1/0/1 — there is no proportional term — and a bang-bang
 * controller with decision lag is a textbook limit cycle: hard/bullseye's stopped turn rate alone
 * (turnRateOf("bullseye") * DRIVE_CONFIG.stopTurnRatio = 3.555 rad/s = 0.1185 rad/tick) already
 * exceeds hard's `aimToleranceRad` (0.07 rad) in a single tick, so the controller could never settle
 * inside its own deadzone; stacking `reactionDelayTicks`(4) + `recomputeTicks`(2) = 6 ticks of lag
 * on top adds ~0.71 rad of rotation that lands AFTER a correction is decided, which is what actually
 * drove the observed oscillation amplitude (measured: 62 fires/300 unfixed by orbit removal alone,
 * only 80/300 after it — orbit was real but partial; mean offset 0.459 rad, worse than fireConeRad
 * 0.2). Forcing lag to zero collapsed mean offset to 0 and fires to 99/300, isolating this as the
 * dominant mechanism.
 *
 * A person with a real reaction delay does not oscillate, because they anticipate it. This
 * reproduces that in two parts: `effectiveDeadzone` floors the tolerance at half a decision
 * interval's worth of rotation, so the controller stops chasing a precision the actuator cannot
 * deliver; `projectedError` subtracts the rotation already committed to (the steer this controller
 * most recently emitted, held for one lag window) before the bang-bang test runs. Deleting this
 * without also giving `reduceToIntent` a proportional term reintroduces the limit cycle — see
 * `.superpowers/sdd/2026-09-05-bot-brain-1-firing-solutions/task-2-report.md`, Round 2.
 */
export function compensateForLag(args: {
  headingError: number;
  lastSteer: -1 | 0 | 1;
  turnRate: number;
  aimToleranceRad: number;
  reactionDelayTicks: number;
  recomputeTicks: number;
}): { projectedError: number; effectiveDeadzone: number } {
  const lagSeconds = (args.reactionDelayTicks + args.recomputeTicks) / TICK_RATE_HZ;
  const rotationPerDecisionInterval = args.turnRate * lagSeconds;
  const effectiveDeadzone = Math.max(
    args.aimToleranceRad,
    rotationPerDecisionInterval * BRAIN_CONSTANTS.deadzoneFloorFraction,
  );
  const projectedError = args.headingError - args.lastSteer * args.turnRate * lagSeconds;
  return { projectedError, effectiveDeadzone };
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
  /** When set, a reverse that would drive into a bound becomes a coast (S13 fight). */
  reverseBlocked?: boolean;
}): { steer: -1 | 0 | 1; throttle: -1 | 0 | 1 } {
  const { headingError, distance, preferredRange, deadband, aimToleranceRad, closing } = args;

  const steer: -1 | 0 | 1 =
    headingError > aimToleranceRad ? 1 : headingError < -aimToleranceRad ? -1 : 0;

  if (!closing) return { steer, throttle: 1 };

  let throttle: -1 | 0 | 1 =
    Math.abs(distance - preferredRange) <= deadband ? 0 : distance > preferredRange ? 1 : -1;
  if (throttle === -1 && args.reverseBlocked) throttle = 0;

  return { steer, throttle };
}

/** Heading into open floor from the nearest bound. Never the arena centre (S13 unpin). */
export function openFloorHeading(
  self: { x: number; y: number },
  arena: BotArenaView,
): number {
  const distLeft = self.x;
  const distRight = arena.width - self.x;
  const distTop = self.y;
  const distBottom = arena.height - self.y;
  const nearest = Math.min(distLeft, distRight, distTop, distBottom);
  if (nearest === distLeft) return 0;
  if (nearest === distRight) return Math.PI;
  if (nearest === distTop) return Math.PI / 2;
  return -Math.PI / 2;
}

/** True when reversing along the current heading would close on a bound. */
export function reverseWouldHitBound(
  self: { x: number; y: number; angle: number },
  arena: BotArenaView,
  lookaheadUnits: number,
): boolean {
  const backX = self.x - Math.cos(self.angle) * lookaheadUnits;
  const backY = self.y - Math.sin(self.angle) * lookaheadUnits;
  const margin = Math.max(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2;
  return (
    backX < margin ||
    backY < margin ||
    backX > arena.width - margin ||
    backY > arena.height - margin
  );
}
