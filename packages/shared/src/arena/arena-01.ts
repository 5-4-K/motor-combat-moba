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
 * The playable floor is x 80..1200, y 40..680 (1120 x 640). The spike runs sit in the innermost wall
 * row, so they take no floor; they are the old strips' spans rounded to the 40 u grid and are
 * mirrored about both centre lines. The corners are square — the octagon's chamfers wait for
 * diagonal tiles (TA2).
 *
 * The spawn tables are symmetric to the unit, because with no cover to duck behind, position is the
 * only advantage a spawn can confer.
 */
const EDGE = "###^^^^^###^^^####^^^###^^^^^###";
const PLAIN = "##" + ".".repeat(28) + "##";
const SPIKED = "#^" + ".".repeat(28) + "^#";

export const ARENA_01: ArenaDef = compileTileArena({
  id: "arena-01",
  rows: [
    EDGE, //    0
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
    EDGE, //   17
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
