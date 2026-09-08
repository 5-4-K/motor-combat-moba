import { DRIVE_CONFIG } from "@motor-combat-moba/shared";
import type { FxEvent } from "./events.js";
import type { EnvironmentFx } from "./environment.js";
import { ENVIRONMENT_FX } from "./environment.js";
import { weaponFxOf } from "./table.js";
import type { WeaponFxResolver } from "./tuning.js";

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
 * Half the distance between the two tracks, as a fraction of the hull rather than a frozen pixel
 * value (EV8) — a chassis retune must still move the tracks.
 */
export function tyreTrackHalfWidth(env: EnvironmentFx = ENVIRONMENT_FX): number {
  return DRIVE_CONFIG.carHeight * env.decals.tyreTrackRatio;
}

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
 *
 * `tyreSpacing` is how far a car travels between one pair of tyre marks and the next, in world
 * units. **Distance, not time.** The first cut checked a 50 ms interval once per frame, which meant
 * it actually fired every ~66.7 ms at 60 fps and ~55 ms at 144 fps, and it stamped the clock rather
 * than advancing it by the interval, so the drift accumulated. At Mirage's 267 u/s that laid marks
 * 17.8 units apart against 5.4-unit dabs — a dotted line — and a different dotted line on every
 * machine. Spacing by distance removes both: the trail is one shape per unit of road at any frame
 * rate, and a slow or circling car produces rubber in proportion to how far it actually went.
 *
 * 4.5 units against a 5.4-unit dab, so consecutive marks overlap by about a sixth of their diameter
 * and the trail reads continuous. The trade-off is length: `maxTotal - maxScorch` marks laid two
 * at a time, so a lone car's trail runs 1080 world units — most of a crossing of a 1280-wide arena
 * — and six cars all skidding share that same pool. Widening the spacing buys length and breaks the
 * line back up; the cap itself is the per-frame redraw budget and is not the knob to reach for.
 *
 * `tyreMaxStep` is the longest single-frame move that still counts as driving. A respawn, a scene
 * cut or a reconciliation snap moves a car hundreds of units between two frames, and spacing by
 * distance would faithfully draw a rubber line across the arena for it. Top speed is 267 u/s and
 * `wildcharge`'s impulse is 520, so even a 100 ms hitch covers ~52 units; anything past 80 is a
 * teleport, and the trail restarts rather than being drawn through.
 */
export function tyreMarkSteps(
  carry: number,
  segmentLength: number,
  env: EnvironmentFx = ENVIRONMENT_FX,
): TyreMarkSteps {
  const { tyreSpacing, tyreMaxStep } = env.decals;
  if (!(segmentLength > 0)) return { fractions: [], carry };
  // A teleport lays nothing AND drops the carry: resuming mid-interval on the far side of the
  // arena would put the first mark of the new trail in an arbitrary place.
  if (segmentLength > tyreMaxStep) return { fractions: [], carry: 0 };
  const fractions: number[] = [];
  let need = tyreSpacing - carry;
  while (need <= segmentLength) {
    fractions.push(need / segmentLength);
    need += tyreSpacing;
  }
  return { fractions, carry: carry + segmentLength - fractions.length * tyreSpacing };
}

/**
 * The stains one event leaves.
 *
 * Only a shot ending and a death mark the ground. A muzzle flash and an ordinary hit deliberately
 * leave nothing: they happen constantly, and a floor that records every one of them is noise rather
 * than history.
 *
 * `resolve` defaults to the shipped weapon table for the same reason `emitterSpecsFor`'s does: a
 * scorch mark's width is now the weapon's own `scorchScale` (EV10a), so this needs the same
 * resolver the playground already injects for bursts.
 */
export function decalStampsFor(
  event: FxEvent,
  env: EnvironmentFx = ENVIRONMENT_FX,
  resolve: WeaponFxResolver = weaponFxOf,
): DecalStamp[] {
  const d = env.decals;
  if (event.kind === "shotEnded") {
    return [
      {
        kind: "scorch",
        x: event.x,
        y: event.y,
        scale: resolve(event.weaponId).scorchScale ?? d.scorchScaleDefault,
        alpha: d.scorchAlphaShot,
      },
    ];
  }
  if (event.kind === "died") {
    return [
      { kind: "scorch", x: event.x, y: event.y, scale: d.scorchScaleDeath, alpha: d.scorchAlphaDeath },
    ];
  }
  return [];
}

/**
 * The pair of marks for one stamping, at a pose along the car's path.
 *
 * Perpendicular to the heading so the tracks turn with the chassis. Each mark is stamped once per
 * frame from the ring buffer, so it must read on its own — but light, because marks laid every
 * `tyreSpacing` overlap along the path and a heavy value draws in ink. The spike's first cut
 * ran an accumulating layer at 0.05 and the mirage drew in permanent marker.
 */
export function tyreMarksFor(
  pose: { x: number; y: number; angle: number },
  speed: number,
  env: EnvironmentFx = ENVIRONMENT_FX,
): TyreMark[] {
  const d = env.decals;
  if (speed < d.tyreSpeedFloor) return [];
  const px = -Math.sin(pose.angle);
  const py = Math.cos(pose.angle);
  const half = tyreTrackHalfWidth(env);
  return [
    { x: pose.x + px * half, y: pose.y + py * half, radius: d.tyreRadius, alpha: d.tyreAlpha },
    { x: pose.x - px * half, y: pose.y - py * half, radius: d.tyreRadius, alpha: d.tyreAlpha },
  ];
}

/**
 * The alpha a decal is drawn at, given how long ago it was laid. `1` when fresh, `0` once spent.
 *
 * Age rather than a frame delta, because the layer is redrawn from its ring buffer each frame
 * rather than faded in place — Phaser 4's `erase` takes no alpha, so a partial in-place fade is not
 * expressible. Redrawing also makes the curve exact instead of an accumulation of per-frame
 * rounding, and makes the result independent of frame rate.
 *
 * `halfLifeMs` is how long a decal takes to lose half its alpha. Decals **must** fade. Rubber that
 * never lifts turns the floor black over a match — measured at roughly twenty seconds in the spike
 * before this was added. Forty seconds is long enough that a fight leaves a readable history and
 * short enough that the arena recovers.
 *
 * It is the binding limit for SCORCH, which has a buffer of its own and takes one mark per blast.
 * It is NOT the binding limit for rubber: at `tyreSpacing` a car at top speed fills its share of the
 * tyre buffer in a few seconds, so a rubber trail is bounded by that buffer and by how far the cars
 * have driven, never by this. See `tyreMarkSteps` for the arithmetic.
 */
export function decalFadeAlpha(ageMs: number, env: EnvironmentFx = ENVIRONMENT_FX): number {
  if (ageMs <= 0) return 1;
  const alpha = Math.pow(0.5, ageMs / env.decals.halfLifeMs);
  // Snap the long tail to zero rather than leaving thousands of invisible decals in the buffer
  // crowding out live ones.
  return alpha < env.decals.fadeCutoff ? 0 : alpha;
}
