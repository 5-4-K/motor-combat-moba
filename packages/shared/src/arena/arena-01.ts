import type { ArenaDef } from "./types.js";
import { compileTileArena } from "./tiles/compile.js";

/**
 * The arena the game plays: a walled rectangle with fourteen spike runs set into the walls, small
 * enough that the whole of it is on screen. Authored as tiles since 2026-10-09 (spec tile arenas,
 * TA9): `#` wall, `^` spike, `.` floor — the walls and spikes are compiled into `obstacles`.
 *
 * 1600x880 (40 x 22 tiles), sized so the default camera zoom of 0.8 (a 1600 x 900 view) shows it
 * whole and every car is always visible. Rescaling this arena without rescaling the zoom to match
 * breaks that.
 *
 * The playable floor is x 40..1560, y 40..840 (1520 x 800): a one-tile wall on every side. The
 * spike runs sit in the wall row, so they take no floor; they are the old 32 x 18 strips' spans
 * scaled by 1.25 across and 22/18 down, rounded to the 40 u grid, and mirrored about both centre
 * lines. The corners are square — the octagon's chamfers wait for diagonal tiles (TA2).
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
const EDGE = "####^^^^^^####^^^^####^^^^####^^^^^^####";
const TOP = EDGE.replace(/#/g, "T").replace(/\^/g, "t");
const BOTTOM = EDGE.replace(/#/g, "B").replace(/\^/g, "b");
const PLAIN = "#" + ".".repeat(38) + "R";
const SPIKED = "^" + ".".repeat(38) + "r";

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
    PLAIN, // 1
    PLAIN, // 2
    PLAIN, // 3
    SPIKED, // 4
    SPIKED, // 5
    PLAIN, // 6
    PLAIN, // 7
    PLAIN, // 8
    PLAIN, // 9
    SPIKED, // 10
    SPIKED, // 11
    PLAIN, // 12
    PLAIN, // 13
    PLAIN, // 14
    PLAIN, // 15
    SPIKED, // 16
    SPIKED, // 17
    PLAIN, // 18
    PLAIN, // 19
    PLAIN, // 20
    BOTTOM, // 21
  ],
  /** What the procedural fallback paints until tile art is imported, and the background beneath. */
  palette: { floor: "#3b4747", obstacle: "#4a5568", border: "#2d3436" },
  /**
   * The four corners and the midpoint of each long wall. Corner cars face across the arena and the
   * two midpoint cars face each other, so wherever `assignSpawns` puts you, you open the match looking
   * at the fight. Every spawn sits at least 175 u off every wall.
   */
  ffaSpawns: [
    { x: 243, y: 215, angle: 0 },
    { x: 1357, y: 215, angle: Math.PI },
    { x: 243, y: 665, angle: 0 },
    { x: 1357, y: 665, angle: Math.PI },
    { x: 800, y: 215, angle: Math.PI / 2 },
    { x: 800, y: 665, angle: -Math.PI / 2 },
  ],
  /**
   * A line down each side, facing the other team. The y values divide the playable height (40..840)
   * into four equal parts, so the gap between two team-mates equals the gap from the end car to the
   * wall — no seat on the line is more exposed than another.
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
