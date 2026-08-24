// packages/client/src/assets/sprite-fit.ts
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
 * A zero-sized texture yields 1 rather than a division by zero: Phaser renders a NaN-scaled sprite
 * as nothing at all, which would look like a missing asset instead of a broken one.
 */
function resolveScale(entry: SpriteEntry, texture: Size, hull: Size): number {
  if (typeof entry.scale === "number") return entry.scale;
  if (texture.width <= 0 || texture.height <= 0) return 1;
  return Math.min(hull.width / texture.width, hull.height / texture.height);
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
