import type { ArenaDef } from "./types.js";
import { compileTileArena } from "./tiles/compile.js";

/**
 * A dusty rectangular pit: a wooden wall, a continuous ring of wooden spikes inside it, and a drawn
 * dirt floor, small enough that the whole of it is on screen. Authored as tiles since 2026-10-09
 * (spec tile cells, TC7): `#` wall, `^` spike, `.` floor, compiled into `obstacles`.
 *
 * 1280x720 (32 x 18 tiles) is the client's logical canvas, same as `ARENA_01`, so at
 * `CAMERA_CONFIG.zoom` of 1 the camera covers the arena exactly.
 *
 * The hand-written pit this replaced had a ~61 u painted wall band and a 20 u spike strip inside it;
 * in 40 u tiles that is one ring of wall and one ring of spikes, so the playable floor is
 * x 80..1200, y 80..640 (1120 x 560) against the old 1121 x 567 inside the strips. The spike ring
 * runs the full length of every wall; its four corners are wall, since a corner spike could face no
 * floor.
 *
 * The wall and spike art on the left and right sides is turned 90° clockwise so its grain runs along
 * the wall; the top and bottom rows (corners included) keep it as authored. Only the ART turns — the
 * spikes hurt from every side. Upper-case `L` is a turned wall, lower-case `l` a turned spike.
 */
const WALL = "wooden-wall";
const RIM = "#".repeat(32);
const SPIKE_ROW = "LL" + "^".repeat(28) + "LL";
const FLOOR_ROW = "Ll" + ".".repeat(28) + "lL";

export const ARENA_02: ArenaDef = compileTileArena({
  id: "arena-02",
  legend: {
    ".": { tile: "floor", art: "dirt-floor-drawn" },
    "#": { tile: "wall", art: WALL },
    "^": { tile: "spike", art: WALL, overlayArt: "wooden-spike" },
    L: { tile: "wall", art: WALL, artOrientation: 90 },
    l: { tile: "spike", art: WALL, artOrientation: 90, overlayArt: "wooden-spike" },
  },
  rows: [
    RIM, //       0
    SPIKE_ROW, // 1
    FLOOR_ROW, // 2
    FLOOR_ROW, // 3
    FLOOR_ROW, // 4
    FLOOR_ROW, // 5
    FLOOR_ROW, // 6
    FLOOR_ROW, // 7
    FLOOR_ROW, // 8
    FLOOR_ROW, // 9
    FLOOR_ROW, // 10
    FLOOR_ROW, // 11
    FLOOR_ROW, // 12
    FLOOR_ROW, // 13
    FLOOR_ROW, // 14
    FLOOR_ROW, // 15
    SPIKE_ROW, // 16
    RIM, //      17
  ],
  /**
   * Warm dust to match the floor art if a tile PNG is missing. Obstacle and border stay dark so a
   * procedural fallback still reads as a pit.
   */
  palette: { floor: "#9a7a58", obstacle: "#4a3e34", border: "#2a2420" },
  /**
   * Four corners and the midpoint of each long wall. Corner cars face across the arena and the two
   * midpoint cars face each other — the same facing rule `ARENA_01` uses. Unchanged by the tile
   * conversion: every spawn still clears the spike ring (faces at x 80/1200, y 80/640) by at least
   * 97 u, past a car diagonal (72.1).
   */
  ffaSpawns: [
    { x: 200, y: 187, angle: 0 },
    { x: 1080, y: 187, angle: Math.PI },
    { x: 200, y: 543, angle: 0 },
    { x: 1080, y: 543, angle: Math.PI },
    { x: 640, y: 187, angle: Math.PI / 2 },
    { x: 640, y: 543, angle: -Math.PI / 2 },
  ],
  /**
   * A line down each side, facing the other team. The y values divide the playable height
   * (80..640) into four equal parts, so no seat on the line is more exposed than another.
   */
  teamASpawns: [
    { x: 200, y: 220, angle: 0 },
    { x: 200, y: 360, angle: 0 },
    { x: 200, y: 500, angle: 0 },
  ],
  teamBSpawns: [
    { x: 1080, y: 220, angle: Math.PI },
    { x: 1080, y: 360, angle: Math.PI },
    { x: 1080, y: 500, angle: Math.PI },
  ],
});
