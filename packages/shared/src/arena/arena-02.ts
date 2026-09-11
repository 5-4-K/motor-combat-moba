import type { ArenaDef } from "./types.js";

/**
 * A dusty rectangular pit: inset wall faces, a continuous spike ring, small enough that the whole
 * of it is on screen.
 *
 * 1280x720 is the client's logical canvas, same as `ARENA_01`, so at `CAMERA_CONFIG.zoom` of 1 the
 * camera covers the arena exactly. The painted walls live in the band between that frame and the
 * `boundary` rect; the four spike strips occupy the inward 20 units of that wall, matching
 * `SPIKE_CONFIG.depth`.
 *
 * Unlike `ARENA_01`'s octagon and fourteen gapped strips, this floor is a rectangle and the spikes
 * run the full length of every wall (top and bottom take the corners; left and right sit between
 * them so each strip maps to exactly one wall).
 */

const WALL_L = 61;
const WALL_T = 61;
const WALL_R = 1222;
const WALL_B = 668;
const DEPTH = 20;

export const ARENA_02 = {
  id: "arena-02",
  width: 1280,
  height: 720,
  /**
   * Warm dust to match the floor art if the PNG is missing. Obstacle and border stay dark so a
   * procedural fallback still reads as a pit, not as the old cream Crossroads.
   */
  palette: { floor: "#9a7a58", obstacle: "#4a3e34", border: "#2a2420" },
  /**
   * Inner wall faces the art draws, clockwise from top-left, `+y` down. `width`/`height` stay
   * 1280x720 — the image frame and the camera bounds. This rect is inset INSIDE them.
   */
  boundary: [
    { x: WALL_L, y: WALL_T },
    { x: WALL_R, y: WALL_T },
    { x: WALL_R, y: WALL_B },
    { x: WALL_L, y: WALL_B },
  ],
  /**
   * One continuous strip per wall, flush to the boundary, `DEPTH` inward. Top and bottom span the
   * full wall so the corners are covered; left and right start inside those so the four rects do
   * not overlap.
   */
  obstacles: [
    { x: WALL_L, y: WALL_T, w: WALL_R - WALL_L, h: DEPTH, kind: "spike" as const },
    { x: WALL_L, y: WALL_B - DEPTH, w: WALL_R - WALL_L, h: DEPTH, kind: "spike" as const },
    { x: WALL_L, y: WALL_T + DEPTH, w: DEPTH, h: WALL_B - WALL_T - 2 * DEPTH, kind: "spike" as const },
    { x: WALL_R - DEPTH, y: WALL_T + DEPTH, w: DEPTH, h: WALL_B - WALL_T - 2 * DEPTH, kind: "spike" as const },
  ],
  /**
   * Four corners and the midpoint of each long wall, one margin off the spiked edge. Corner cars
   * face across the arena and the two midpoint cars face each other — the same facing rule
   * `ARENA_01` uses, re-seated in this rect.
   */
  ffaSpawns: [
    { x: 200, y: 150, angle: 0 },
    { x: 1080, y: 150, angle: Math.PI },
    { x: 200, y: 570, angle: 0 },
    { x: 1080, y: 570, angle: Math.PI },
    { x: 640, y: 150, angle: Math.PI / 2 },
    { x: 640, y: 570, angle: -Math.PI / 2 },
  ],
  /**
   * A line down each side, facing the other team, spread through the playable height.
   */
  teamASpawns: [
    { x: 200, y: 213, angle: 0 },
    { x: 200, y: 365, angle: 0 },
    { x: 200, y: 517, angle: 0 },
  ],
  teamBSpawns: [
    { x: 1080, y: 213, angle: Math.PI },
    { x: 1080, y: 365, angle: Math.PI },
    { x: 1080, y: 517, angle: Math.PI },
  ],
} as const satisfies ArenaDef;
