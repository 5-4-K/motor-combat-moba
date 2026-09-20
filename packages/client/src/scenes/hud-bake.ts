/**
 * The slot bar is drawn into a texture, and re-drawn only when what it shows has changed.
 *
 * **Why.** Phaser re-tessellates a `Graphics` every frame it is on screen, whether or not its
 * commands moved: clearing and refilling it is cheap (0.05 ms for the whole slot bar), but turning
 * its circles, ring strokes and rounded pills into triangles is not — measured at ~0.5 ms of a
 * ~1.5 ms render pass, every frame of every match, for a picture that changes a few times a
 * second at most. Nothing on that layer reads a clock (`drawSlotRing` says so), so between a
 * cooldown starting and ending it is the same picture.
 *
 * **How, and why not a signature.** `renderWeaponHud` still builds the layer's commands every
 * frame, into a `Graphics` that is on no display list, and `sameCommands` compares them with the
 * commands last baked. The obvious alternative — hash the inputs (slot state, dim, blocked, status
 * fractions) and skip the build — needs a second description of what the HUD depends on, and the
 * day a draw call reads something the hash does not, the HUD silently stops updating. Comparing
 * the OUTPUT cannot drift from the draw code, and the build it does not skip is a tenth of what
 * the bake saves.
 *
 * The cooldown arc and the prohibition sign stay a live `Graphics` (`hudSweepGfx`): the arc really
 * does change every tick while it is up, and it is empty the rest of the time.
 */

/**
 * Texels per HUD pixel the slot bar is baked at, displayed back at `1 / HUD_BAKE_SCALE`.
 *
 * The HUD camera draws straight to the canvas, which is multisampled (`antialiasGL`), so a
 * `Graphics` there gets smooth ring edges for free. A render texture's framebuffer is not
 * multisampled; baking at 2x and letting linear filtering average it back down is what keeps a
 * 3 px ring from stair-stepping.
 */
export const HUD_BAKE_SCALE = 2;

/**
 * Whether two `Graphics` command buffers would draw the same picture.
 *
 * Phaser's buffer is a flat list of primitives — command ids, coordinates, colours, alphas, and
 * the booleans `arc` and `fillRoundedRect` carry — so strict equality per element is exact. Were
 * a future Phaser to push an object per command this would read `false` every frame, which costs
 * the optimisation and nothing else: the HUD would bake every frame and still be right.
 */
export function sameCommands(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
