/**
 * Where the FX layers sit in `ArenaScene`'s depth ladder (VFX23).
 *
 * The existing rungs are `ARENA -10`, `SHOT -5`, `CAR 0`, `MANEUVER 2`, `ARROW 52`, `LOCK 55`,
 * `HP_BAR 60`, `HUD 1000`. The FX rungs slot between them, and `depths.test.ts` holds the ordering.
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

/**
 * Every car's additive underglow, on one shared layer beneath every car's shadows.
 *
 * **Below `CAR_SHADOW_DEPTH`, not above it, and that is the whole decision.** The glow ring and the
 * drop shadow cover almost exactly the same ground. Additive light drawn OVER the shadow cancels it
 * — and against a mid-value floor sprite that contact shadow is the cue doing the most work to sit
 * the car down. Under it, the shadow darkens on top of the glow, which is also what a real emissive
 * skirt does: it lights the floor around the car, not the shadow under it.
 *
 * Still above the decals and the lava crust, so the glow washes ACROSS the ground it lights rather
 * than being painted over by it, and below `SHOT_DEPTH` so a shot reads over a car's own glow.
 *
 * A shared layer for the same reason the shadows use one — see `CAR_SHADOW_DEPTH` — with one extra
 * pay-off: `ADD` blend is set once on this single `Graphics`, so the whole roster's glow costs one
 * batch flush a frame rather than one per car.
 */
export const CAR_GLOW_DEPTH = -6.6;

/**
 * Every car's drop and contact shadow, on one shared layer beneath every car.
 *
 * A shared layer rather than a child of each car's own container, and that is load-bearing: all six
 * cars sit at `CAR_DEPTH`, where Phaser breaks the tie by display-list insertion order. A shadow
 * parented to one car would therefore draw OVER another car's body whenever the two overlap — which
 * in a game about ramming is most of the time.
 *
 * Above the lava crust it darkens (so a field is still ground you cast onto) and below the ground
 * FX, so a spark still reads on top of a shadow. Not `-7`: that slot is `LAVA_DEPTH`.
 */
export const CAR_SHADOW_DEPTH = -6.5;

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
