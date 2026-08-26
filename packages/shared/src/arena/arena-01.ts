import type { ArenaDef } from "./types.js";

/**
 * The arena the game plays: one open rectangle, small enough that the whole of it is on screen.
 *
 * 1280x720 is not a taste call — it is the client's logical canvas, so at `CAMERA_CONFIG.zoom` of 1
 * the camera covers the arena exactly and every car is always visible. Rescaling this arena without
 * rescaling the zoom to match breaks that; `arena-camera.test.ts` on the client is what fails.
 *
 * Empty rather than sparsely furnished. With no cover to duck behind, position is the only
 * advantage a spawn can confer, which is why the spawn tables below are symmetric to the unit
 * rather than merely spread out.
 */
export const ARENA_01 = {
  id: "arena-01",
  width: 1280,
  height: 720,
  obstacles: [],
  /**
   * The four corners and the midpoint of each long wall, all one margin off the wall. Corner cars
   * face across the arena, and the two midpoint cars face each other — so wherever the shuffle in
   * `assignSpawns` puts you, you open the match looking at the fight rather than at a wall.
   */
  ffaSpawns: [
    { x: 160, y: 160, angle: 0 },
    { x: 1120, y: 160, angle: Math.PI },
    { x: 160, y: 560, angle: 0 },
    { x: 1120, y: 560, angle: Math.PI },
    { x: 640, y: 160, angle: Math.PI / 2 },
    { x: 640, y: 560, angle: -Math.PI / 2 },
  ],
  /**
   * A line down each side, facing the other team. The y values divide the height into four equal
   * parts, so the gap between two team-mates is the same as the gap from the end car to the wall —
   * no seat on the line is more exposed than another.
   */
  teamASpawns: [
    { x: 160, y: 180, angle: 0 },
    { x: 160, y: 360, angle: 0 },
    { x: 160, y: 540, angle: 0 },
  ],
  teamBSpawns: [
    { x: 1120, y: 180, angle: Math.PI },
    { x: 1120, y: 360, angle: Math.PI },
    { x: 1120, y: 540, angle: Math.PI },
  ],
} as const satisfies ArenaDef;
