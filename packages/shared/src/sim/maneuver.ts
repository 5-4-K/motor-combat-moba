/**
 * The maneuver a car is in — the sim state behind dash, hold and charge (spec S3).
 *
 * Values are EXPLICIT AND STABLE (invariant 7): `PlayerState.maneuver` networks them as uint8.
 * Never renumber. Mirrors how `WeaponKind`/`RoomPhase` declare theirs.
 */
export const ManeuverKind = {
  NONE: 0,
  DASH: 1,
  HOLD: 2,
  CHARGE: 3,
} as const;
export type ManeuverKindValue = (typeof ManeuverKind)[keyof typeof ManeuverKind];

/** The four neutral fields, for spreading into fixtures and resets. */
export const NO_MANEUVER = Object.freeze({
  maneuver: ManeuverKind.NONE as number,
  maneuverTicksLeft: 0,
  maneuverAngle: 0,
  maneuverSpeed: 0,
});
