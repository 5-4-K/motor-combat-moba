/**
 * The countdown arrow: the triangle that marks YOUR car in the seconds before the gun.
 *
 * Pure geometry in the shape `combat-visual.ts` and `weapon-hud.ts` already use — every number and
 * every rule about where the marker sits lives here, where a Node test reaches it without a canvas,
 * and `ArenaScene` only fills the points into a `Graphics`.
 *
 * It exists for the three seconds where you have not moved yet and so cannot find yourself by
 * wiggling; the instant the match starts it is gone, with no fade and no tween, because from that
 * tick on the car that answers your keys is the answer and an arrow still hanging over it teaches
 * the player to rely on clutter (D4).
 *
 * Deathmatch reopens that window every time you respawn — your car reappears somewhere you were not
 * looking, with the fight already running — so the same triangle is drawn again for the length of
 * spawn protection, blinking rather than bobbing ({@link arrowBlinkOn}). Same shape, same colour,
 * same sentence: "this one". It is drawn only for the local player, on their own client, so nobody
 * else is told where you came back.
 *
 * **It takes no car angle, on purpose.** A marker that turned with the chassis would be saying
 * something about heading, and heading is the car's own job — the arrow's only sentence is "this
 * one" (D4). That signature rests on one property of this game's camera: `splitCameras` never
 * rotates the world camera, so world-up is screen-up and a triangle built with a fixed `-y` apex
 * offset in world space is drawn pointing up on screen. A camera that ever gained a rotation would
 * have to hand this module an angle to cancel it out, and the missing parameter is where that
 * change would surface.
 */

/**
 * Peak deviation of the bob, world units. Small enough that the arrow reads as hovering over one
 * car rather than travelling, and spent against {@link ARROW_GAP_PX}: at the bottom of the bob the
 * apex is `ARROW_GAP_PX - ARROW_BOB_AMPLITUDE_PX` from the car's centre, which is what has to stay
 * clear of the hull.
 */
export const ARROW_BOB_AMPLITUDE_PX = 5;

/**
 * One full up-and-down, in milliseconds. Slow enough to read as breathing rather than as a warning
 * flash — the arrow is a "you are here", not an alert.
 */
export const ARROW_BOB_PERIOD_MS = 900;

/**
 * Where the arrow sits within its bob at a given wall-clock time, in world units, positive being
 * *toward* the car.
 *
 * Driven by the caller's clock (`performance.now()`) rather than by a tween or a frame counter, so
 * the motion is identical at 30 and at 144 fps and there is nothing to cancel when the phase flips:
 * the frame after the countdown ends simply does not call this (D14). Bounded by
 * {@link ARROW_BOB_AMPLITUDE_PX} for every input, including a clock that has been running all day.
 */
export function arrowBobOffset(nowMs: number): number {
  return (
    Math.sin((nowMs / ARROW_BOB_PERIOD_MS) * Math.PI * 2) *
    ARROW_BOB_AMPLITUDE_PX
  );
}

/** The triangle's base, world units. Read from across the arena, so wider than it is tall. */
export const ARROW_WIDTH_PX = 22;

/** Apex to base, world units. Kept under the width so the shape reads as an arrowhead, not a spike. */
export const ARROW_HEIGHT_PX = 16;

/**
 * Centre of the car to the apex, world units, at the middle of the bob.
 *
 * Measured from the *centre* rather than from the car's top edge, because the hull turns and its top
 * edge does not stay put: the worst case is the 48 x 32 hull's half-diagonal, 29 units. At the
 * bottom of the bob the apex is 33 units out, so the arrow never touches the car whichever way it
 * happens to be pointing when the countdown starts.
 */
export const ARROW_GAP_PX = 38;

/**
 * The three world-space corners of the arrow above the car at `(x, y)`, apex last.
 *
 * The apex points DOWN at the car and the base is above it: the marker's job is to end on the thing
 * it means, so the eye lands on the car rather than on the arrow. `bobOffset` moves the whole
 * triangle rigidly — the shape never stretches, only travels — so the silhouette a player learns in
 * the first countdown is the one they see in every later one.
 */
export function countdownArrowPoints(
  x: number,
  y: number,
  bobOffset: number,
): Array<{ x: number; y: number }> {
  const apexY = y - ARROW_GAP_PX + bobOffset;
  const baseY = apexY - ARROW_HEIGHT_PX;
  const half = ARROW_WIDTH_PX / 2;
  return [
    { x: x - half, y: baseY },
    { x: x + half, y: baseY },
    { x, y: apexY },
  ];
}

/**
 * One on-off cycle of the RESPAWN arrow, in milliseconds.
 *
 * The same triangle serves a second job in Deathmatch: after a respawn it marks where you came back,
 * for as long as spawn protection lasts. That arrow blinks where the countdown's only bobs, and the
 * difference is the whole point of having two. The countdown arrow is a label on a car that is
 * standing still and has your full attention — breathing suits it. The respawn arrow appears mid-
 * fight, on a car that has just teleported across the map, competing with everything else on screen;
 * it has to be *found*, and a hard on-off edge is what the eye catches. Fast enough to read as
 * urgent, slow enough not to strobe.
 */
export const ARROW_BLINK_PERIOD_MS = 360;

/**
 * Is the blinking arrow drawn this frame? A square wave — half the cycle on, half off.
 *
 * Driven by the caller's wall clock for the same reason {@link arrowBobOffset} is: the rhythm has to
 * be identical at 30 and at 144 fps, and there is nothing to cancel when spawn protection lapses
 * early because the player fired. The frame after simply does not ask.
 */
export function arrowBlinkOn(nowMs: number): boolean {
  return nowMs % ARROW_BLINK_PERIOD_MS < ARROW_BLINK_PERIOD_MS / 2;
}
