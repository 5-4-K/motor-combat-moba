import type { ArenaDef, CameraRotate } from "@motor-combat-moba/shared";

/**
 * The world camera's angle, one place (spec 2026-09-28-camera-behaviors-design.md, CB10–CB16).
 * Phaser turns world into screen by `+rotation` (see `input/aim-offset.ts`), and a car's heading 0
 * points along world +x, so the rotation that puts heading `h` at the top of the screen is
 * `-π/2 - h`. Every rotation the arena camera takes goes through `viewRotationForHeading`.
 */

const TAU = Math.PI * 2;
const REFERENCE_FRAME_MS = 1000 / 60;
const AXIS_EPSILON = 1e-6;

/** Into `(-π, π]`. */
export function normalizeAngle(a: number): number {
  return a - TAU * Math.ceil((a - Math.PI) / TAU);
}

/** The camera rotation that draws `heading` pointing straight up the screen (CB13). */
export function viewRotationForHeading(heading: number): number {
  return normalizeAngle(-Math.PI / 2 - heading);
}

/**
 * The rotation for a team's own spawn heading (CB10). Every spawn of a team shares one angle —
 * `modes/invariants.test.ts` holds any `teamFacing` mode's arenas to that (CB30) — so the first
 * spawn speaks for the team. An arena with no spawns for the team reads 0.
 */
export function teamFacingRotation(
  arena: Pick<ArenaDef, "teamASpawns" | "teamBSpawns">,
  team: number,
): number {
  const spawn = (team === 1 ? arena.teamBSpawns : arena.teamASpawns)[0];
  return spawn ? viewRotationForHeading(spawn.angle) : 0;
}

/**
 * Ease `current` toward `target` along the shorter arc, closing `lerp` of the gap per 60 Hz frame
 * and rescaled by the real frame time the same way `smoothFollow` rescales `camLerp`.
 */
export function easeAngle(current: number, target: number, lerp: number, deltaMs: number): number {
  const gap = normalizeAngle(target - current);
  const alpha = 1 - Math.pow(1 - lerp, deltaMs / REFERENCE_FRAME_MS);
  return normalizeAngle(current + gap * alpha);
}

/**
 * Whether Phaser's scroll clamp is still right at this rotation (CB15): it clamps an UNROTATED
 * rectangle, which matches the rotated view only at multiples of π.
 */
export function isAxisAligned(rotation: number): boolean {
  const m = Math.abs(normalizeAngle(rotation));
  return m < AXIS_EPSILON || Math.abs(m - Math.PI) < AXIS_EPSILON;
}

export interface ViewRotationInput {
  readonly rotate: CameraRotate;
  readonly arena: Pick<ArenaDef, "teamASpawns" | "teamBSpawns">;
  /** Undefined until the local player's row exists. */
  readonly localTeam: number | undefined;
  /** The camera target's heading ("heading" only); undefined while free-roaming or holding. */
  readonly followHeading: number | undefined;
  readonly current: number;
  readonly lerp: number;
  readonly deltaMs: number;
  /** Jump straight to the target: the first frame, and the respawn cut. */
  readonly snap: boolean;
}

/** This frame's world-camera rotation for the mode's `rotate` choice (CB10–CB16). */
export function resolveViewRotation(input: ViewRotationInput): number {
  switch (input.rotate) {
    case "none":
      return 0;
    case "teamFacing":
      return input.localTeam === undefined ? 0 : teamFacingRotation(input.arena, input.localTeam);
    case "heading": {
      if (input.followHeading === undefined) return input.current;
      const target = viewRotationForHeading(input.followHeading);
      return input.snap ? target : easeAngle(input.current, target, input.lerp, input.deltaMs);
    }
  }
}
