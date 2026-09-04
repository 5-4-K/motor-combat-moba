/**
 * Client-only view options: things that change what the arena DRAWS and nothing else.
 *
 * **Deliberately not part of `PlaygroundSetup`.** That type is sent to the server as join options,
 * and a render toggle has no business on the wire — invariant 3 (clients send inputs, never
 * authoritative state) and invariant 8 (if `stepSim` reads it, it is a schema field; the converse
 * being that what the sim cannot read should not travel). The server does not know or care whether
 * a hitbox is outlined on someone's screen.
 *
 * A module-level singleton rather than a value threaded through the scene tree, for the same reason
 * `setTuning` is one: the thing that SETS it is a DOM overlay with no handle on the Phaser scene,
 * and the thing that READS it is a draw call several layers down. Process-wide is exactly the scope
 * — one browser tab draws one arena.
 *
 * Nothing in ordinary play ever sets these. The playground is the only writer and it is stripped
 * from release builds, so in a shipped game every option here stays at its default forever. That is
 * what makes it safe for `ArenaScene` — production code — to read them.
 */

/** See `showHitboxes`. */
let hitboxes = false;

/**
 * Whether the arena outlines the shapes the sim actually collides with: each car's OBB, and every
 * live weapon instance's own hitbox.
 *
 * Worth having as a toggle rather than only as `?debug=1` because the two questions it answers are
 * asked mid-session, not at page load: "why did that ram connect" and "how much of that cone
 * actually burns". `afterburner` is the case that motivated it — the drawn flame deliberately
 * covers only about two thirds of its cone, and the only honest way to judge that trade is to see
 * both at once.
 */
export function showHitboxes(): boolean {
  return hitboxes;
}

/**
 * Turn the hitbox overlay on or off. Called by the playground's settings panel, and reset when the
 * playground shuts down — a dev toggle must never survive into whatever runs next in this process,
 * the same rule `PlaygroundScene` already follows for `setTuning`.
 */
export function setShowHitboxes(on: boolean): void {
  hitboxes = on;
}
