import { DEATH_FADE_MS, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { COLOR_TABLE, DEFAULT_CAR_ID, isCarId, type CarId } from "@motor-combat-moba/shared";

/** How a chassis is drawn. One per `CAR_TABLE` entry — the table is the source of truth, not this. */
export type CarShape = "rect" | "ellipse" | "hex";

/**
 * The procedural silhouette each chassis falls back to when its sprite is missing.
 *
 * The shape is no longer what the car *is* — these were once named `rectangle`, `oval` and
 * `hexagon` — so this map is a rendering detail, not an identity. Each chassis keeps the outline it
 * shipped with so a missing texture still reads as the right car.
 */
const SHAPE_BY_CAR = {
  mirage: "rect",
  bullseye: "ellipse",
  bastion: "hex",
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

/**
 * How opaque a car should be drawn, from the tick it died.
 *
 * There is no wreck. A car is intangible and frozen the instant its hp reaches 0 (`isOnField` in
 * shared reads `alive`), and this is the only thing left of it: a linear fade to nothing over
 * `DEATH_FADE_MS`, after which it is not drawn at all.
 *
 * Driven by the networked `diedAtTick` rather than by a local timer started when the client first
 * notices `alive` go false. A spectator, or anyone who joined mid-fade, never saw that transition —
 * given a local timer they would draw a corpse parked on the field forever.
 *
 * Returns 1 for a living car, and 0 once the fade is spent. **0 means draw nothing**, not draw
 * something invisible: the caller is expected to skip the object entirely.
 */
export function deathFadeAlpha(alive: boolean, diedAtTick: number, tick: number): number {
  if (alive) return 1;
  const fadeTicks = Math.max(1, Math.ceil((DEATH_FADE_MS * TICK_RATE_HZ) / 1000));
  // A dead car with no stamp is one whose death this client never saw a patch for. Treat it as
  // fully faded rather than fully opaque, so a stale corpse errs toward being gone.
  if (diedAtTick <= 0) return 0;
  const elapsed = tick - diedAtTick;
  if (elapsed <= 0) return 1;
  if (elapsed >= fadeTicks) return 0;
  return 1 - elapsed / fadeTicks;
}
