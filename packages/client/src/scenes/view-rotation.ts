import type { ArenaDef } from "@motor-combat-moba/shared";

/**
 * The world camera's rotation for the local player (CQ46): team B is turned 180° on an arena that
 * asks for it, so each team sees its own base at the bottom. The HUD camera never rotates.
 *
 * Every world-space piece that is meant to read the same way on every screen — the self-arrow, the
 * car light, the crosshair's mouse path — takes this number and cancels it out (CQ47, CQ48). Driving
 * needs nothing: the keys are car-relative, so a rotated view turns nothing a player steers by.
 */
export function viewRotationFor(
  arena: Pick<ArenaDef, "flipForTeamB">,
  sides: "ffa" | "team",
  team: number,
): number {
  return arena.flipForTeamB === true && sides === "team" && team === 1 ? Math.PI : 0;
}
