/**
 * Where the FX layers sit in `ArenaScene`'s depth ladder (VFX23).
 *
 * The existing rungs are `ARENA -10`, `SHOT -5`, `CAR 0`, `MANEUVER 2`, `ARROW 52`, `LOCK 55`,
 * `HP_BAR 60`, `HUD 1000`. These four slot between them, and `depths.test.ts` holds the ordering.
 */

/**
 * The generated asphalt, beneath the arena's own obstacle and border graphics.
 *
 * Below `ARENA_DEPTH` rather than replacing it: the floor becomes a real object so it can carry a
 * texture at all, and the existing `drawArena` pass keeps drawing obstacles and the border on top.
 */
export const FLOOR_DEPTH = -11;

/** Rubber and scorch. Above the floor, below anything that moves. */
export const DECAL_DEPTH = -8;

/** Debris and ground sparks — on the deck rather than in the air. */
export const GROUND_FX_DEPTH = -6;

/**
 * Smoke and fire. Above the cars, because it is in the air.
 *
 * Deliberately far below `ARROW_DEPTH` (52): hp bars, lock brackets and off-screen arrows draw over
 * smoke, so a car inside a cloud keeps its information even if the eraser mask is later softened
 * (VFX24).
 */
export const AIR_FX_DEPTH = 10;
