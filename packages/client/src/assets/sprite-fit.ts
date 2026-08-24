import type { SpriteEntry } from "./manifest-schema.js";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface SpriteFit {
  readonly scale: number;
  /** Radians to add to the body's `angle`. */
  readonly rotation: number;
  readonly originX: number;
  readonly originY: number;
}

/**
 * Contain the art inside the hull. Cover would let the drawing spill past the OBB the sim actually
 * collides with, so the picture would claim a reach the car does not have.
 *
 * The hull is measured against the texture's **rotated** axis-aligned bounding box, because
 * `rotationOffset` is applied before the sprite lands in hull space. Comparing the unrotated
 * dimensions would make `"fit"` fail at exactly the case it exists for — art drawn facing up, the
 * most common pack mismatch, which `public/art/README.md` documents as needing `1.5707963`. A
 * 64x128 up-facing sprite would contain 128 against the hull's 32 rather than against its 48 and
 * render at two thirds the size it should. At `rotationOffset: 0` the formula collapses back to
 * the plain texture dimensions.
 *
 * A zero-sized texture yields 1 rather than a division by zero: Phaser renders a NaN-scaled sprite
 * as nothing at all, which would look like a missing asset instead of a broken one. The guard is
 * written as `!(x > 0)` rather than `x <= 0` so a non-finite dimension is caught too — `NaN <= 0`
 * is `false`, so a `NaN` width would otherwise sail straight through into the very `setScale(NaN)`
 * this guard exists to prevent.
 */
function resolveScale(entry: SpriteEntry, texture: Size, hull: Size): number {
  if (typeof entry.scale === "number") return entry.scale;
  if (!(texture.width > 0) || !(texture.height > 0)) return 1;
  const c = Math.abs(Math.cos(entry.rotationOffset));
  const s = Math.abs(Math.sin(entry.rotationOffset));
  const rotatedWidth = texture.width * c + texture.height * s;
  const rotatedHeight = texture.width * s + texture.height * c;
  return Math.min(hull.width / rotatedWidth, hull.height / rotatedHeight);
}

/**
 * How to draw one manifest entry against a hull. Pure, so the fitting rules that make pack art from
 * unrelated sources line up are testable without a browser.
 */
export function fitSprite(entry: SpriteEntry, texture: Size, hull: Size): SpriteFit {
  return {
    scale: resolveScale(entry, texture, hull),
    rotation: entry.rotationOffset,
    originX: entry.origin[0],
    originY: entry.origin[1],
  };
}
