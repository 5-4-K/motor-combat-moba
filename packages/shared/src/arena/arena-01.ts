import type { ArenaDef } from "./types.js";
import { compileTileArena } from "./tiles/compile.js";

/**
 * The arena the game plays: a walled rectangle with fourteen spike runs set into the walls, small
 * enough that the whole of it is on screen. Authored as tiles since 2026-10-09 (spec tile arenas,
 * TA9): `#` wall, `^` spike, `.` floor — the walls and spikes are compiled into `obstacles`.
 *
 * 1280x720 (32 x 18 tiles) is not a taste call — it is the client's logical canvas, so at
 * `CAMERA_CONFIG.zoom` of 1 the camera covers the arena exactly and every car is always visible.
 * Rescaling this arena without rescaling the zoom to match breaks that.
 *
 * The playable floor is x 40..1240, y 40..680 (1200 x 640): a one-tile wall on every side. The
 * spike runs sit in the wall row, so they take no floor; they are the old strips' spans rounded to
 * the 40 u grid and are mirrored about both centre lines. The corners are square — the octagon's
 * chamfers wait for diagonal tiles (TA2).
 *
 * The look is drawn metal (2026-10-09): the wall art is turned per side so its grain runs along the
 * wall — top row (corners included) 90° clockwise, bottom row 90° counter-clockwise, right column
 * 180°, left column as authored. Only the ART turns (`artOrientation`); every spike here hurts from
 * all sides, so behaviour is the same on every edge. The upper-case key is the wall, the lower-case
 * one the spike, on each turned edge.
 *
 * The spawn tables are symmetric to the unit, because with no cover to duck behind, position is the
 * only advantage a spawn can confer.
 */
const WALL = "metal-wall-drawn";
const EDGE = "###^^^^^###^^^####^^^###^^^^^###";
const TOP = EDGE.replace(/#/g, "T").replace(/\^/g, "t");
const BOTTOM = EDGE.replace(/#/g, "B").replace(/\^/g, "b");
const PLAIN = "#" + ".".repeat(30) + "R";
const SPIKED = "^" + ".".repeat(30) + "r";

export const ARENA_01: ArenaDef = compileTileArena({
  id: "arena-01",
  displayName: "Arena 01",
  legend: {
    ".": { tile: "floor", art: "metal-floor-drawn" },
    "#": { tile: "wall", art: WALL },
    "^": { tile: "spike", art: WALL },
    T: { tile: "wall", art: WALL, artOrientation: 90 },
    t: { tile: "spike", art: WALL, artOrientation: 90 },
    B: { tile: "wall", art: WALL, artOrientation: 270 },
    b: { tile: "spike", art: WALL, artOrientation: 270 },
    R: { tile: "wall", art: WALL, artOrientation: 180 },
    r: { tile: "spike", art: WALL, artOrientation: 180 },
  },
  rows: [
    TOP, //     0
    PLAIN, //   1
    PLAIN, //   2
    SPIKED, //  3
    SPIKED, //  4
    PLAIN, //   5
    PLAIN, //   6
    PLAIN, //   7
    SPIKED, //  8
    SPIKED, //  9
    PLAIN, //  10
    PLAIN, //  11
    PLAIN, //  12
    SPIKED, // 13
    SPIKED, // 14
    PLAIN, //  15
    PLAIN, //  16
    BOTTOM, // 17
  ],
  /** What the procedural fallback paints until tile art is imported, and the background beneath. */
  palette: { floor: "#3b4747", obstacle: "#4a5568", border: "#2d3436" },
  /**
   * The four corners and the midpoint of each long wall. Corner cars face across the arena and the
   * two midpoint cars face each other, so wherever `assignSpawns` puts you, you open the match looking
   * at the fight. Every spawn sits at least 140 u off every wall.
   */
  ffaSpawns: [
    { x: 200, y: 180, angle: 0 },
    { x: 1080, y: 180, angle: Math.PI },
    { x: 200, y: 540, angle: 0 },
    { x: 1080, y: 540, angle: Math.PI },
    { x: 640, y: 180, angle: Math.PI / 2 },
    { x: 640, y: 540, angle: -Math.PI / 2 },
  ],
  /**
   * A line down each side, facing the other team. The y values divide the playable height (40..680)
   * into four equal parts, so the gap between two team-mates equals the gap from the end car to the
   * wall — no seat on the line is more exposed than another.
   */
  teamASpawns: [
    { x: 200, y: 200, angle: 0 },
    { x: 200, y: 360, angle: 0 },
    { x: 200, y: 520, angle: 0 },
  ],
  teamBSpawns: [
    { x: 1080, y: 200, angle: Math.PI },
    { x: 1080, y: 360, angle: Math.PI },
    { x: 1080, y: 520, angle: Math.PI },
  ],
});
