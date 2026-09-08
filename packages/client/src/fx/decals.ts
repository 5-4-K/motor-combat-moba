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

/**
 * A dab of rubber. Two per stamping — one per track — laid so faintly that only a sustained
 * line of them shows. How OFTEN a stamping happens is `tyreMarkSteps` below.
 */
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
 *
 * It is the binding limit for SCORCH, which has a buffer of its own and takes one mark per blast.
 * It is NOT the binding limit for rubber: at `TYRE_MARK_SPACING` a car at top speed fills its share
 * of the 480-mark tyre buffer in a few seconds, so a rubber trail is bounded by that buffer and by
 * how far the cars have driven, never by this. See `TYRE_MARK_SPACING` for the arithmetic.
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
 * How far a car travels between one pair of tyre marks and the next, in world units.
 *
 * **Distance, not time.** The first cut checked a 50 ms interval once per frame, which meant it
 * actually fired every ~66.7 ms at 60 fps and ~55 ms at 144 fps, and it stamped the clock rather
 * than advancing it by the interval, so the drift accumulated. At Mirage's 267 u/s that laid marks
 * 17.8 units apart against 5.4-unit dabs — a dotted line — and a different dotted line on every
 * machine. Spacing by distance removes both: the trail is one shape per unit of road at any frame
 * rate, and a slow or circling car produces rubber in proportion to how far it actually went.
 *
 * 4.5 units against a 5.4-unit dab, so consecutive marks overlap by about a sixth of their diameter
 * and the trail reads continuous. The trade-off is length: `MAX_TYRE_DECALS` is 480 marks laid two
 * at a time, so a lone car's trail runs 1080 world units — most of a crossing of a 1280-wide arena
 * — and six cars all skidding share that same 480. Widening the spacing buys length and breaks the
 * line back up; the cap itself is the per-frame redraw budget and is not the knob to reach for.
 */
export const TYRE_MARK_SPACING = 4.5;

/**
 * The longest single-frame move that still counts as driving.
 *
 * A respawn, a scene cut or a reconciliation snap moves a car hundreds of units between two frames,
 * and spacing by distance would faithfully draw a rubber line across the arena for it. Top speed is
 * 267 u/s and `wildcharge`'s impulse is 520, so even a 100 ms hitch covers ~52 units; anything past
 * 80 is a teleport, and the trail restarts rather than being drawn through.
 */
export const TYRE_MARK_MAX_STEP = 80;

/** Below this speed a car lays no rubber: a trail is a skid mark, not a record of parking. */
export const TYRE_MARK_SPEED_FLOOR = 40;

/** Half the distance between the two tracks, across the car. */
export const TYRE_TRACK_HALF_WIDTH = DRIVE_CONFIG.carHeight / 3;

/** Where along one frame's travel a car's tracks land, and what distance carries into the next. */
export interface TyreMarkSteps {
  /** Fractions along the segment, in `(0, 1]`, in order. */
  readonly fractions: number[];
  /** Distance travelled since the last mark, to hand back next frame. */
  readonly carry: number;
}

/**
 * Space one frame's travel into marks.
 *
 * Pure, and separated from `fx/layer.ts` on purpose: the layer is the one `fx/` file no test can
 * load, and "how often does rubber go down" is exactly the kind of decision `layer.ts` is not
 * supposed to be holding.
 *
 * Several marks may land in one frame — that is the point. A 30 fps frame covers twice the road a
 * 60 fps frame does and must lay twice the rubber, or the trail is frame-rate dependent again in
 * the other direction.
 */
export function tyreMarkSteps(carry: number, segmentLength: number): TyreMarkSteps {
  if (!(segmentLength > 0)) return { fractions: [], carry };
  // A teleport lays nothing AND drops the carry: resuming mid-interval on the far side of the
  // arena would put the first mark of the new trail in an arbitrary place.
  if (segmentLength > TYRE_MARK_MAX_STEP) return { fractions: [], carry: 0 };
  const fractions: number[] = [];
  let need = TYRE_MARK_SPACING - carry;
  while (need <= segmentLength) {
    fractions.push(need / segmentLength);
    need += TYRE_MARK_SPACING;
  }
  return { fractions, carry: carry + segmentLength - fractions.length * TYRE_MARK_SPACING };
}

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
 * The pair of marks for one stamping, at a pose along the car's path.
 *
 * Perpendicular to the heading so the tracks turn with the chassis. Each mark is stamped once per
 * frame from the ring buffer, so it must read on its own — but light, because marks laid every
 * `TYRE_MARK_SPACING` overlap along the path and a heavy value draws in ink. The spike's first cut
 * ran an accumulating layer at 0.05 and the mirage drew in permanent marker.
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
