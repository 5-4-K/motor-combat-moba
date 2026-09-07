import { DRIVE_CONFIG } from "@motor-combat-moba/shared";
import type { FxEvent } from "./events.js";

/** A stain to stamp into the decal layer. */
export interface DecalStamp {
  readonly kind: "scorch";
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly alpha: number;
}

/** A dab of rubber. Two per car per frame, laid so faintly that only a sustained line shows. */
export interface TyreMark {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
}

/**
 * How long a decal takes to lose half its alpha.
 *
 * Decals **must** fade. Rubber that never lifts turns the floor black over a match — measured at
 * roughly twenty seconds in the spike before this was added. Forty seconds is long enough that a
 * fight leaves a readable history and short enough that the arena recovers.
 */
export const DECAL_HALF_LIFE_MS = 40_000;

/**
 * The most decals held at once. Older ones are dropped.
 *
 * This is a hard bound on the decal layer's per-frame cost: it is redrawn from scratch each frame
 * (Phaser 4's `erase` takes no alpha, so an in-place partial fade is not expressible), which makes
 * the cost proportional to this number rather than to how long the match has run.
 */
export const MAX_DECALS = 600;

/**
 * How often one car lays rubber.
 *
 * Per interval rather than per frame, so the trail is the same length at 30fps and 144fps — and so
 * `MAX_DECALS` buys a predictable number of seconds of history rather than a number that collapses
 * on a fast machine.
 */
export const TYRE_MARK_INTERVAL_MS = 50;

/** Below this speed a car lays no rubber, or a parked car burns a hole in the floor. */
export const TYRE_MARK_SPEED_FLOOR = 40;

/** Half the distance between the two tracks, across the car. */
export const TYRE_TRACK_HALF_WIDTH = DRIVE_CONFIG.carHeight / 3;

const SCORCH_SCALE: Record<string, number> = {
  magmablast: 1.25,
  predator: 1.0,
  thumper: 0.5,
};

/**
 * The stains one event leaves.
 *
 * Only a shot ending and a death mark the ground. A muzzle flash and an ordinary hit deliberately
 * leave nothing: they happen constantly, and a floor that records every one of them is noise rather
 * than history.
 */
export function decalStampsFor(event: FxEvent): DecalStamp[] {
  if (event.kind === "shotEnded") {
    return [
      {
        kind: "scorch",
        x: event.x,
        y: event.y,
        scale: SCORCH_SCALE[event.weaponId] ?? 0.35,
        alpha: 0.55,
      },
    ];
  }
  if (event.kind === "died") {
    return [{ kind: "scorch", x: event.x, y: event.y, scale: 1.4, alpha: 0.7 }];
  }
  return [];
}

/**
 * The rubber a car lays this frame.
 *
 * Perpendicular to the heading so the tracks turn with the chassis. Each mark is stamped once per
 * frame from the ring buffer, so it must read on its own — but light, because marks laid every
 * `TYRE_MARK_INTERVAL_MS` overlap heavily along the path and a heavy value draws in ink. The spike's
 * first cut ran an accumulating layer at 0.05 and the mirage drew in permanent marker.
 */
export function tyreMarksFor(
  pose: { x: number; y: number; angle: number },
  speed: number,
): TyreMark[] {
  if (speed < TYRE_MARK_SPEED_FLOOR) return [];
  const px = -Math.sin(pose.angle);
  const py = Math.cos(pose.angle);
  const d = TYRE_TRACK_HALF_WIDTH;
  return [
    { x: pose.x + px * d, y: pose.y + py * d, radius: 2.7, alpha: 0.18 },
    { x: pose.x - px * d, y: pose.y - py * d, radius: 2.7, alpha: 0.18 },
  ];
}

/**
 * The alpha a decal is drawn at, given how long ago it was laid. `1` when fresh, `0` once spent.
 *
 * Age rather than a frame delta, because the layer is redrawn from its ring buffer each frame
 * rather than faded in place — Phaser 4's `erase` takes no alpha, so a partial in-place fade is not
 * expressible. Redrawing also makes the curve exact instead of an accumulation of per-frame
 * rounding, and makes the result independent of frame rate.
 */
export function decalFadeAlpha(ageMs: number): number {
  if (ageMs <= 0) return 1;
  const alpha = Math.pow(0.5, ageMs / DECAL_HALF_LIFE_MS);
  // Snap the long tail to zero rather than leaving thousands of invisible decals in the buffer
  // crowding out live ones.
  return alpha < 0.02 ? 0 : alpha;
}
