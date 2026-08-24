import { COLOR_TABLE, DEFAULT_CAR_ID, isCarId, type CarId } from "@motor-arena/shared";

/** How a chassis is drawn. One per `CAR_TABLE` entry — the table is the source of truth, not this. */
export type CarShape = "rect" | "ellipse" | "hex";

const SHAPE_BY_CAR = {
  rectangle: "rect",
  oval: "ellipse",
  hexagon: "hex",
} as const satisfies Record<CarId, CarShape>;

/**
 * The silhouette to draw for a wire `carId`. Anything unset or unrecognised draws the default
 * chassis — the same fallback the sim uses, so the picture never disagrees with the hitbox.
 */
export function carShapeOf(carId: string): CarShape {
  return SHAPE_BY_CAR[isCarId(carId) ? carId : DEFAULT_CAR_ID];
}

/**
 * `COLOR_TABLE`'s hex string as the 0xRRGGBB integer Phaser wants. `colorId` arrives as a wire
 * `uint8`, so an out-of-range value is possible; it falls back to the first colour rather than
 * producing `NaN`, which Phaser renders as an invisible car.
 */
export function carFillOf(colorId: number): number {
  const entry = COLOR_TABLE.find((color) => color.colorId === colorId) ?? COLOR_TABLE[0];
  return Number.parseInt(entry.hex.slice(1), 16);
}

/**
 * Hexagon in the car's local frame, centred on the origin with +x forward, so the same points can be
 * rotated by `angle` at draw time. Two points on the long axis and four shoulders — the widest span
 * matches the car's own dimensions, so the drawing sits inside its OBB.
 */
export function hexagonPoints(width: number, height: number): Array<{ x: number; y: number }> {
  const hw = width / 2;
  const hh = height / 2;
  return [
    { x: hw, y: 0 },
    { x: hw / 2, y: hh },
    { x: -hw / 2, y: hh },
    { x: -hw, y: 0 },
    { x: -hw / 2, y: -hh },
    { x: hw / 2, y: -hh },
  ];
}
