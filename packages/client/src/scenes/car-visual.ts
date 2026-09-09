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
 * The chassis silhouette as a closed convex polygon in the car's local frame, +x forward.
 *
 * The same outline three things now need to agree on: the fallback silhouette's fill, the shadow
 * cast on the floor, and the edge stroke the rim light rides. Deriving all three from one function
 * is what stops a car without art wearing a rim that does not fit the shape underneath it.
 *
 * An ellipse is approximated rather than drawn, because a rim has to be stroked segment by segment
 * to vary along its length and a true ellipse has no segments. `ELLIPSE_SEGMENTS` is a look
 * decision, not a tolerance: enough that the hull reads as smooth at the scale a car is drawn.
 *
 * Every point sits ON the hull, never outside it — the same rule the projectile marks obey, for the
 * same reason: what is drawn may not claim more space than what collides.
 */
export function carOutlinePoints(
  carId: string,
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const hw = width / 2;
  const hh = height / 2;
  switch (carShapeOf(carId)) {
    case "rect":
      return [
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
        { x: -hw, y: -hh },
      ];
    case "hex":
      return hexagonPoints(width, height);
    case "ellipse":
      return ellipsePoints(width, height);
  }
}

/**
 * An ellipse as a closed polygon, centred on the origin.
 *
 * Phaser's `fillEllipse` draws axis-aligned only, so anything elliptical that has to turn with a car
 * — the ellipse chassis, and every car's shadow — needs real points to rotate.
 *
 * `ELLIPSE_SEGMENTS` is a look decision rather than a tolerance: enough that the curve reads as
 * smooth at the size a car is drawn, and no more, since the shadow pass walks these points once per
 * band per car per frame.
 */
export function ellipsePoints(width: number, height: number): Array<{ x: number; y: number }> {
  const hw = width / 2;
  const hh = height / 2;
  return Array.from({ length: ELLIPSE_SEGMENTS }, (_, i) => {
    const t = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
    return { x: hw * Math.cos(t), y: hh * Math.sin(t) };
  });
}

/** How many segments an ellipse is drawn as. See `ellipsePoints`. */
const ELLIPSE_SEGMENTS = 20;

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
