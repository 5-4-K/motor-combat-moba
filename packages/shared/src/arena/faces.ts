/**
 * World-axis faces of an axis-aligned box (spec tile cells, TC23). Lives in `arena/` rather than
 * `arena/tiles/` because the sim and the bot read it for hand-written arenas' spikes too.
 */

/** A world-axis face of an axis-aligned box. `n` is −y (up on screen). */
export type WorldFace = "n" | "e" | "s" | "w";
export const WORLD_FACES: readonly WorldFace[] = ["n", "e", "s", "w"];

/**
 * Which face(s) of a box a vector pointing OUT of the box leaves through (tile cells TC23): the
 * dominant axis, both faces on an exact tie, every face for a zero vector. Order is n-e-s-w.
 */
export function facesOfNormal(nx: number, ny: number): WorldFace[] {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  if (ax === 0 && ay === 0) return [...WORLD_FACES];
  const vertical: WorldFace | null = ay >= ax ? (ny < 0 ? "n" : "s") : null;
  const horizontal: WorldFace | null = ax >= ay ? (nx > 0 ? "e" : "w") : null;
  return WORLD_FACES.filter((f) => f === vertical || f === horizontal);
}
