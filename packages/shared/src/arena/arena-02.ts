import type { ArenaDef } from "./types.js";
import { compileTileArena } from "./tiles/compile.js";

/**
 * A dusty rectangular pit: a continuous ring of wooden spikes for a wall, and a drawn dirt floor,
 * sized so the whole of it is on screen. Authored as tiles since 2026-10-09 (spec tile
 * cells, TC7): `#` wall, `^` spike, `.` floor, compiled into `obstacles`.
 *
 * 1600x880 (40 x 22 tiles), same as `ARENA_01`, sized so the default camera zoom of 0.8 (a
 * 1600 x 900 view) shows it whole.
 *
 * The edge is ONE tile thick, and every edge tile is a spike except the four corners, which are
 * wall since a corner spike could face no floor. So the playable floor is x 40..1560, y 40..840
 * (1520 x 800) — the same floor as `ARENA_01`, but spiked the whole way round instead of in runs.
 *
 * The art on the left and right sides is turned 90° clockwise so its grain runs along the wall; the
 * top and bottom rows (corners included) keep it as authored. Only the ART turns — the spikes hurt
 * from every side. Lower-case `l` is a turned spike.
 */
const WALL = "wooden-wall";
const EDGE = "#" + "^".repeat(38) + "#";
const FLOOR_ROW = "l" + ".".repeat(38) + "l";

export const ARENA_02: ArenaDef = compileTileArena({
  id: "arena-02",
  displayName: "Arena 02",
  legend: {
    ".": { tile: "floor", art: "dirt-floor-drawn", artOrientation: "random" },
    "#": { tile: "wall", art: WALL },
    "^": { tile: "spike", art: WALL, overlayArt: "wooden-spike" },
    l: { tile: "spike", art: WALL, artOrientation: 90, overlayArt: "wooden-spike" },
  },
  rows: [
    EDGE, //       0
    FLOOR_ROW, // 1
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
    FLOOR_ROW, // 16
    FLOOR_ROW, // 17
    FLOOR_ROW, // 18
    FLOOR_ROW, // 19
    FLOOR_ROW, // 20
    EDGE, //      21
  ],
  /**
   * Warm dust to match the floor art if a tile PNG is missing. Obstacle and border stay dark so a
   * procedural fallback still reads as a pit.
   */
  palette: { floor: "#9a7a58", obstacle: "#4a3e34", border: "#2a2420" },
  /**
   * Four corners and the midpoint of each long wall. Corner cars face across the arena and the two
   * midpoint cars face each other — the same facing rule `ARENA_01` uses. Every spawn clears the
   * spike ring (faces at x 40/1560, y 40/840) by at least 171 u, past a car diagonal (72.1).
   */
  ffaSpawns: [
    { x: 243, y: 224, angle: 0 },
    { x: 1357, y: 224, angle: Math.PI },
    { x: 243, y: 669, angle: 0 },
    { x: 1357, y: 669, angle: Math.PI },
    { x: 800, y: 224, angle: Math.PI / 2 },
    { x: 800, y: 669, angle: -Math.PI / 2 },
  ],
  /**
   * A line down each side, facing the other team. The y values divide the playable height
   * (40..840) into four equal parts, so no seat on the line is more exposed than another.
   */
  teamASpawns: [
    { x: 243, y: 240, angle: 0 },
    { x: 243, y: 440, angle: 0 },
    { x: 243, y: 640, angle: 0 },
  ],
  teamBSpawns: [
    { x: 1357, y: 240, angle: Math.PI },
    { x: 1357, y: 440, angle: Math.PI },
    { x: 1357, y: 640, angle: Math.PI },
  ],
});
