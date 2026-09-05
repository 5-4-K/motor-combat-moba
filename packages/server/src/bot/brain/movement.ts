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
 * (R9/R10, 2026-09-05; deadzone floor corrected R12, review round 1, 2026-09-05).
 *
 * `reduceToIntent`'s `steer` is only ever -1/0/1 — there is no proportional term — and a bang-bang
 * controller with decision lag is a textbook limit cycle: hard/bullseye's stopped turn rate alone
 * (turnRateOf("bullseye") * DRIVE_CONFIG.stopTurnRatio = 3.555 rad/s = 0.1185 rad/tick) already
 * exceeds hard's `aimToleranceRad` (0.07 rad) in a single tick, so the controller could never settle
 * inside its own deadzone; stacking `reactionDelayTicks`(4) + `recomputeTicks`(2) = 6 ticks of lag
 * on top adds ~0.71 rad of rotation that lands AFTER a correction is decided, which is what actually
 * drove the observed oscillation amplitude (measured: 62 fires/300 unfixed by orbit removal alone,
 * only 80/300 after it — orbit was real but partial; mean offset 0.459 rad, worse than hard's
 * `fireConeRad` of 0.2 at the time). Forcing lag to zero collapsed mean offset to 0 and fires to
 * 99/300, isolating this as the dominant mechanism. (`fireConeRad` itself was retired 2026-09-05 by
 * Task 7's EV firing gate — the historical figures above are unchanged by that, since they predate
 * it, but nothing in this file compares against it anymore; see `BRAIN_CONSTANTS.deadzoneCapMultiplier`.)
 *
 * This is TWO different quantities, and conflating them is what review round 1 caught:
 *
 * - `effectiveDeadzone` is about ACTUATOR RESOLUTION, not lag: do not chase a precision finer than
 *   the smallest step the car can take in a single tick (`rotationPerTick = floorTurnRate /
 *   TICK_RATE_HZ`). It floors at half a tick's rotation (`deadzoneFloorFraction`), and is hard-
 *   capped at a multiple of `aimToleranceRad` (`deadzoneCapMultiplier` — a multiple of `fireConeRad`
 *   before Task 7 retired that field) so a future chassis's turn rate can never push it past the
 *   point where the bot settles too far off the target for the EV solver to find a shot. `lagSeconds`
 *   (the full `reactionDelayTicks + recomputeTicks` window) has NO business here — an earlier version of
 *   this function floored on `turnRate * lagSeconds * deadzoneFloorFraction` (several ticks' worth
 *   of rotation, not one), producing a 0.711 rad deadzone on hard — 41 degrees, 3.5x `fireConeRad`
 *   — that made steering nearly inert the moment the target was off-axis. The on-axis duel in
 *   `controller.test.ts` (heading error 0 from tick 0) could not catch that; the off-axis one added
 *   in review round 1 can.
 *
 *   `floorTurnRate` is deliberately a SEPARATE argument from `turnRate`, always the car's moving
 *   rate (`turnRateOf`, never `turnRateAtStopOf`) regardless of whether it is currently rolling.
 *   The floor represents the finest correction step the car can EVER take, not the step it happens
 *   to be capable of on this particular tick — using the speed-dependent `turnRate` here (as an
 *   earlier draft of this fix did) let the floor collapse to ~0.059 rad the instant the car came to
 *   rest at its standoff range (its stopped rate is roughly half its moving one), which is BELOW
 *   `aimToleranceRad` (0.07) and so the `Math.max` silently discarded it — reproducing the original
 *   defect's symptom (an oscillation that never settles) at the exact moment `fight` most needs it
 *   to hold still: parked at range, facing the target. Confirmed by measurement: with `turnRate`
 *   also driving the floor, the off-axis duel plateaued at 68/300 fires (never settling into a
 *   steer-0 rest state); with `floorTurnRate` fixed to the moving rate, it reaches the same 146/300,
 *   0-mean-offset ceiling the on-axis duel does.
 *
 *   One more wrinkle review round 2 found (R15, fix round 3, 2026-09-05): actuator resolution is
 *   not the only thing the floor has to respect. The bot also cannot correct itself within its own
 *   `recomputeTicks` window — it re-decides only that often, holding the previous steer the whole
 *   time — and for a tier whose `recomputeTicks` is large (medium: 6 ticks = 1.42 rad of
 *   uncorrectable rotation) that window's rotation dwarfs one tick's, so a floor keyed to one tick
 *   alone left medium's off-axis deadzone (0.16) far too small to let it settle, and it aimed
 *   *worse* off-axis than easy despite outranking it on every other axis. `rotationPerDecision =
 *   rotationPerTick * recomputeTicks` is now floored alongside `rotationPerTick`, and the floor
 *   takes whichever rotation is larger before applying `deadzoneFloorFraction` once — this is what
 *   "half the rotation the bot cannot correct during one decision window, but never less than half
 *   a tick's rotation" means arithmetically: `deadzoneFloorFraction` must be applied exactly once,
 *   to the larger of the two raw rotations, not to each separately and not doubled. The existing
 *   `deadzoneCapMultiplier` clamp is what keeps this safe: taking the larger candidate can only raise
 *   the floor, and the cap is what stops a high-`recomputeTicks` tier's floor from swallowing its
 *   own `aimToleranceRad` many times over.
 * - `projectedError` IS about lag: it subtracts the rotation already committed to (the steer this
 *   controller most recently emitted, held for the full `lagSeconds` window) from the raw heading
 *   error before the bang-bang test runs — a person with a real reaction delay does not oscillate,
 *   because they anticipate it. This still uses the speed-dependent `turnRate` (R10) because it
 *   predicts REAL future rotation, which genuinely does depend on whether the car is currently
 *   rolling or stopped.
 *
 *   The in-flight rotation is CLAMPED to the magnitude of `headingError` (R14, fix round 2,
 *   2026-09-05). Easy's lag window is 9 + 12 = 21 ticks = 0.7 s; against bullseye's 7.11 rad/s turn
 *   rate that projects `lastSteer * turnRate * lagSeconds` = 4.98 rad of in-flight rotation — a
 *   285-degree turn, dwarfing any real heading error (which cannot exceed pi). An unclamped
 *   projection subtracts that whole 4.98 rad from `headingError` regardless of sign, which flips
 *   `projectedError` to the OPPOSITE sign of `lastSteer` on every single decision: the bot steers
 *   +1, then -1, then +1 forever, net rotation ~0, and it never turns to face anything. Measured:
 *   easy went from 108 on-axis fires (before lag compensation existed at all) to 0 once the
 *   unclamped projection landed. The physical fix is that you stop steering once you arrive — the
 *   rotation that actually lands from holding a steer input can never exceed the error that called
 *   for it in the first place, so projecting past the target projects a turn the car would never
 *   make. Capping `inFlight` at `[-|headingError|, |headingError|]` before subtracting enforces
 *   that: the projection can zero out the error (full correction, if the lag window is long enough)
 *   but never invert its sign. Behaviourally this duty-cycles the bang-bang actuator — steer, coast,
 *   steer — which is how a controller with no proportional term approximates one; duty cycling
 *   converges, sign alternation does not. Hard's lag (0.2 s, 1.42 rad) was always small enough not
 *   to invert, which is why this defect was invisible until easy was measured.
 *
 * Deleting either the deadzone floor or the projection clamp without also giving `reduceToIntent` a
 * proportional term reintroduces a limit cycle — see
 * `.superpowers/sdd/2026-09-05-bot-brain-1-firing-solutions/task-2-report.md`, Round 2, "Fix round 1",
 * and "Fix round 2". DO NOT DELETE THIS.
 */
export function compensateForLag(args: {
  headingError: number;
  lastSteer: -1 | 0 | 1;
  /** The car's turn rate matching its CURRENT speed state (R10) — feeds the lag projection only. */
  turnRate: number;
  /** The car's moving turn rate, always — feeds the actuator-resolution floor only (R12). */
  floorTurnRate: number;
  aimToleranceRad: number;
  reactionDelayTicks: number;
  recomputeTicks: number;
}): { projectedError: number; effectiveDeadzone: number } {
  const lagSeconds = (args.reactionDelayTicks + args.recomputeTicks) / TICK_RATE_HZ;

  // Actuator resolution: floor at half the rotation the bot cannot correct within one DECISION
  // window — it re-decides only every `recomputeTicks`, holding the previous steer the whole time
  // — but never less than half a single TICK's rotation, the actuator's finest possible step
  // (R15, fix round 3). The two are different constraints (correction latency vs. actuator
  // resolution) and the floor is whichever rotation is larger, so a low-`recomputeTicks` tier
  // still floors on one tick (R12's original reasoning) while a high-`recomputeTicks` tier floors
  // on the longer window it is actually stuck coasting through.
  const rotationPerTick = args.floorTurnRate / TICK_RATE_HZ;
  const rotationPerDecision = rotationPerTick * args.recomputeTicks;
  const floor = Math.max(rotationPerTick, rotationPerDecision) * BRAIN_CONSTANTS.deadzoneFloorFraction;
  // The cap used to be a fraction of `fireConeRad` (R12) — retired 2026-09-05 when Task 7 deleted
  // that field along with the angular fire gate it served. `aimToleranceRad` is the one per-tier
  // angular knob left, and it is the right one to key off: a tier with a loose tolerance had a loose
  // fire cone too, so the cap still loosens and tightens in step with the tier. See
  // `BRAIN_CONSTANTS.deadzoneCapMultiplier`'s doc comment for why a multiplier of it rather than a
  // fixed radian value.
  const effectiveDeadzone = Math.min(
    Math.max(args.aimToleranceRad, floor),
    args.aimToleranceRad * BRAIN_CONSTANTS.deadzoneCapMultiplier,
  );

  // Lag projection: cancel the rotation already committed to (R10), but never project past the
  // target — the car stops turning once it arrives, so the rotation that lands can never exceed the
  // heading error that called for it (R14, fix round 2).
  const inFlight = args.lastSteer * args.turnRate * lagSeconds;
  const cappedInFlight = Math.max(
    -Math.abs(args.headingError),
    Math.min(Math.abs(args.headingError), inFlight),
  );
  const projectedError = args.headingError - cappedInFlight;

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
