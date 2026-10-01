import { type SimBody } from "../sim/step.js";

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/**
 * Angle blend through the unit circle rather than through the number line: lerp the sine and cosine
 * and read the result back with `atan2`. A plain lerp of 3 and -3 sweeps the long way through 0;
 * this takes the short way across the seam, which is what the eye expects. The result is normalised
 * to (-PI, PI], which is fine — it only ever feeds a render rotation, never `stepSim`.
 */
function lerpAngle(from: number, to: number, alpha: number): number {
  return Math.atan2(
    lerp(Math.sin(from), Math.sin(to), alpha),
    lerp(Math.cos(from), Math.cos(to), alpha),
  );
}

/**
 * A render pose part-way between two sim poses. Position and angle blend (angle the short way);
 * `vx`/`vy` come from `to` un-blended: a half-blended velocity must never flow back into a step.
 * Used to draw the local car between predicted ticks: prediction advances on the 60 Hz sim clock
 * while frames come at the display rate, so without this the local car holds for a frame and jumps a
 * whole tick while the camera and remotes glide — which the eye reads as a doubled, smeared sprite.
 *
 * **Whatever reads these `vx`/`vy` is reading a POST-collision velocity**, because `to` is a stepped
 * pose and `stepSim` resolves contacts before it returns. That matters to exactly one caller: the
 * impact-spark pass (`scenes/impact-feedback.ts`) asks `resolveRam` whether a contact is a ram, and
 * `RamCar.vx`/`vy` are contractually the PRE-collision values. It does NOT take them from here —
 * `ArenaScene` feeds the local car's `predictedPrev` instead, which is the tick-entry velocity. An
 * earlier revision of this comment claimed the newest velocity was the right input for that gate;
 * it is the wrong one, and measurably: the resolved number loses about three drive-in rams in four.
 */
export function blendPose(from: SimBody, to: SimBody, alpha: number): SimBody {
  return {
    ...to,
    x: lerp(from.x, to.x, alpha),
    y: lerp(from.y, to.y, alpha),
    angle: lerpAngle(from.angle, to.angle, alpha),
  };
}
