/**
 * The aim HUD: the three white indicators drawn under YOUR car and nobody else's — the ring at the
 * crosshair's reach, the two turret swing limits, and the four muzzle-direction arrows.
 *
 * Entirely a picture. Nothing here is a schema field, nothing crosses the wire, and the sim never
 * reads it: every number the HUD draws is one the local client already holds (`CROSSHAIR_CONFIG`,
 * `TURRET_CONFIG`, the hull). Drawing it for the driven car alone is a rendering decision, not a
 * networked one, so no other client is told what your HUD shows.
 */

/**
 * The in-code switch (the user's, not the player's): the whole aim HUD on or off.
 *
 * Build-time, not a live setting and deliberately not exposed in any settings panel — a player
 * cannot turn these off, so everyone reads the same arena. A plain mutable object rather than
 * `as const` for the reason `CROSSHAIR_CONFIG` is one: read at use time, so flipping it here and
 * rebuilding the client is the whole procedure. `false` costs the scene one `setVisible(false)` per
 * frame and draws nothing; no other module branches on it.
 *
 * It owes NO rebuild of anything generated. `scripts/build-cars-and-weapons.mjs` never reads it and
 * `balanceStamp` never hashes it — unlike `BASIC_ATTACK_CONFIG.enabled`, which hides a real weapon
 * and therefore owes the manual, the bot and the hint. This flag hides a drawing.
 */
export const AIM_HUD_CONFIG: { enabled: boolean } = {
  enabled: true,
};

/**
 * How the aim HUD is painted. World units and Phaser colours, all of it white on purpose: the HUD
 * is a ruler laid on the floor, and a colour would put it in the same language as the player
 * colours, the hp bars and the weapon FX, all of which already mean something.
 *
 * Drawn UNDER the car (`AIM_HUD_DEPTH`), so the chassis sits on top of its own ring rather than
 * inside a cage — which is also why the alpha can stay this low and still read: nothing has to be
 * legible through the car.
 */
export const AIM_HUD_STYLE = {
  color: 0xffffff,
  /** The ring and the swing lines. Low enough to read as a guide rather than as a weapon effect. */
  lineAlpha: 0.5,
  lineWidth: 2,
  /** One dash and the gap after it, world units. Applied to the ring and the swing lines alike, so
   *  the three read as one instrument rather than three drawings that happen to be white. */
  dashLength: 6,
  dashGap: 9,
  /** The arrows are solid, so they sit slightly stronger than the dashed lines around them. */
  arrowAlpha: 0.7,
  /** Base to tip, along the direction the arrow points. */
  arrowLength: 10,
  /** Half the arrow's base, across that direction. */
  arrowHalfWidth: 5.5,
  /** How far the base's centre notch is pulled toward the tip. 0 would draw a plain triangle; a
   *  notch is what makes four small marks read as arrows at arena zoom rather than as blobs. */
  arrowNotch: 3,
  /**
   * Clearance between the hp bar's far edge and the base of the tail arrow, world units.
   *
   * The two AXIAL arrows (nose and tail) stand further out than the two lateral ones for exactly
   * this reason: at the muzzle's own standoff the tail arrow would be drawn underneath the hp bar.
   * `aim-hud.ts` derives the axial standoff from `HP_BAR_GEOMETRY` plus this, so moving the bar
   * moves the arrows with it and a test holds the two apart.
   */
  hpBarClearance: 4,
} as const;
