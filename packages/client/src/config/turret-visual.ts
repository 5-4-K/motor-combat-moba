/**
 * How long the turret is drawn, world units, before the manifest row's numeric `scale` (spec TR42).
 * NOT the sim's spawn offset: `TURRET_CONFIG.defaultOffset` is tuned to put the shot on this length's
 * barrel tip, and `?dev=assets` draws the spawn dot to show whether the two still agree (TR45).
 */
export const TURRET_VISUAL = { lengthUnits: 36 } as const;

/**
 * The procedural turret a car draws when neither `turret.<carId>` nor `turret.default` resolves —
 * the turret's counterpart of the chassis silhouette, and permanent for the same reason. A rounded
 * block centred on the pivot plus a barrel running `TURRET_CONFIG.defaultOffset` along +x, so the
 * barrel tip sits exactly where a turret shot spawns. World units. The outline is what separates it
 * from a silhouette body painted the same player colour underneath it.
 */
export const TURRET_FALLBACK = {
  blockWidth: 16,
  blockHeight: 12,
  blockRadius: 3,
  barrelWidth: 4,
  outlineColor: 0x000000,
  outlineAlpha: 0.6,
  outlineWidth: 1,
} as const;
