/**
 * The aim HUD: the three white indicators drawn under YOUR car and nobody else's — the ring at the
 * crosshair's reach, the two turret swing limits, and the four muzzle-direction arrows.
 *
 * Entirely a picture. Nothing here is a schema field, nothing crosses the wire, and the sim never
 * reads it: every number the HUD draws is one the local client already holds (`CROSSHAIR_CONFIG`,
 * `turret()`, the hull). Drawing it for the driven car alone is a rendering decision, not a
 * networked one, so no other client is told what your HUD shows.
 */

/**
 * The aim HUD comes in TWO groups, because they answer different questions and one of them can stop
 * applying to a car mid-match.
 *
 * - **Turret HUD** — the crosshair, the ring at its reach, and the turret's swing limits. Every one
 *   of these is about a weapon that fires along a bearing the player chose. A car with no turret
 *   weapon in its fire slots (`carHasTurretWeapon`, TR53) draws no turret at all, and the whole
 *   group goes with it: `ArenaScene.wantsPointerLock` hides all three AND stops asking the browser
 *   for pointer lock, since a crosshair nobody can see is not worth a captured cursor.
 * - **Muzzle HUD** — the four arrows at the fixed muzzle directions. These are about the car's own
 *   heading, which every chassis has, so they are drawn whatever the loadout is.
 *
 * The two switches below are the developer's, above that gate: they hide a group that a car is
 * otherwise entitled to. The gate is a capability, the switch is a preference, and they are separate
 * so that turning the HUD off never changes how the car is controlled.
 */

/**
 * The in-code switch (the user's, not the player's): the aim HUD on or off, by group.
 *
 * Build-time, not a live setting and deliberately not exposed in any settings panel — a player
 * cannot turn these off, so everyone reads the same arena. A plain mutable object rather than
 * `as const` for the reason `CROSSHAIR_CONFIG` is one: read at use time, so flipping a field here
 * and rebuilding the client is the whole procedure.
 *
 * `enabled` is the master; the two group flags sit under it. **`turretHud` covers the ring and the
 * swing limits only — it does NOT hide the crosshair**, which is shipped turret behaviour (TR32)
 * with its own spec and is not this switch's to take away. What hides the crosshair is the
 * capability gate above, where hiding it is the point.
 *
 * None of it owes a rebuild of anything generated. `scripts/build-cars-and-weapons.mjs` never reads
 * these and `balanceStamp` never hashes them — unlike `slots().basicAttackEnabled`, which hides a
 * real weapon and therefore owes the manual, the bot and the hint. These hide a drawing.
 */
export const AIM_HUD_CONFIG: { enabled: boolean; turretHud: boolean; muzzleHud: boolean } = {
  enabled: true,
  turretHud: true,
  muzzleHud: true,
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
   * `aim-hud.ts` derives the axial standoff from `hpBarGeometry()` plus this, so moving the bar
   * moves the arrows with it and a test holds the two apart.
   */
  hpBarClearance: 4,
} as const;
