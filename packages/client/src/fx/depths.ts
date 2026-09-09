/**
 * Where the FX layers sit in `ArenaScene`'s depth ladder (VFX23).
 *
 * The existing rungs are `ARENA -10`, `SHOT -5`, `CAR 0`, `MANEUVER 2`, `ARROW 52`, `LOCK 55`,
 * `HP_BAR 60`, `HUD 1000`. These five slot between them, and `depths.test.ts` holds the ordering.
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

/**
 * A lingering lava field's cracked crust. Above the decals it is laid over, below the ground FX
 * thrown across it, and well below the cars — a field is ground, and you drive on it.
 */
export const LAVA_DEPTH = -7;

/** Debris and ground sparks — on the deck rather than in the air. */
export const GROUND_FX_DEPTH = -6;

/**
 * Additive glow: shell halos and a lava field's ring and seams.
 *
 * ABOVE `SHOT_DEPTH` (-5) and below `CAR_DEPTH` (0). Above the shots because additive light belongs
 * over the thing emitting it, and because an additive layer can only add — it cannot hide the shot
 * core it washes across, so drawing it on top costs no readability. Below the cars for the reason
 * VFX24 keeps air FX below the HUD: a glow drawn over a chassis drains the player colour that says
 * whose car it is.
 */
export const GLOW_DEPTH = -4;

/**
 * The smoke `RenderTexture`. Above the cars, because smoke is in the air — but BELOW `AIR_FX_DEPTH`.
 *
 * Fire and sparks have to read *over* the smoke they are co-located with: an additive fireball
 * drawn under an opaque smoke layer is simply not visible, which is the whole point of it being
 * additive. Phaser breaks a depth tie by display-list insertion order (`DisplayList.js` sorts
 * stably), so leaving the smoke tied to `AIR_FX_DEPTH` does not mean "undefined" — it means the
 * ordering is decided by which constructor line runs last, which nobody chose and nobody would
 * think to check when adding the next air-layer object.
 */
export const SMOKE_DEPTH = 9;

/**
 * Smoke and fire. Above the cars, because it is in the air.
 *
 * Deliberately far below `ARROW_DEPTH` (52): hp bars, lock brackets and off-screen arrows draw over
 * smoke, so a car inside a cloud keeps its information even if the eraser mask is later softened
 * (VFX24).
 */
export const AIR_FX_DEPTH = 10;
