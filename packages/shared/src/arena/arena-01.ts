import type { ArenaDef } from "./types.js";

/**
 * The arena the game plays: an octagon with cut corners and fourteen wall-mounted spike strips,
 * small enough that the whole of it is on screen.
 *
 * 1280x720 is not a taste call — it is the client's logical canvas, so at `CAMERA_CONFIG.zoom` of 1
 * the camera covers the arena exactly and every car is always visible. Rescaling this arena without
 * rescaling the zoom to match breaks that; `arena-camera.test.ts` on the client is what fails.
 *
 * The spawn tables below are symmetric to the unit rather than merely spread out, because with no
 * cover to duck behind, position is the only advantage a spawn can confer.
 */

/** Where a spike strip sits on each wall — the inward 20 units of the wall band (AS11). */
const TOP = { y: 54, h: 20 };
const BOTTOM = { y: 646, h: 20 };
const LEFT = { x: 74, w: 20 };
const RIGHT = { x: 1186, w: 20 };

/** Spans along the top and bottom walls, mirrored about x = 640. */
const X_SPANS = [
  [129, 310],
  [452, 565],
  [715, 828],
  [970, 1151],
] as const;

/** Spans along the left and right walls, mirrored about y = 360. */
const Y_SPANS = [
  [105, 200],
  [305, 415],
  [520, 615],
] as const;

const SPIKES = [
  ...X_SPANS.flatMap(([a, b]) => [
    { x: a, y: TOP.y, w: b - a, h: TOP.h, kind: "spike" as const },
    { x: a, y: BOTTOM.y, w: b - a, h: BOTTOM.h, kind: "spike" as const },
  ]),
  ...Y_SPANS.flatMap(([a, b]) => [
    { x: LEFT.x, y: a, w: LEFT.w, h: b - a, kind: "spike" as const },
    { x: RIGHT.x, y: a, w: RIGHT.w, h: b - a, kind: "spike" as const },
  ]),
];

export const ARENA_01 = {
  id: "arena-01",
  width: 1280,
  height: 720,
  /**
   * A slate floor, dark enough that the light car sprites and the HUD's white text read as figures
   * on a ground rather than as marks on paper. Obstacle and border keep the values
   * `ARENA_COLOR_DEFAULTS` gave this arena before it declared a palette.
   */
  palette: { floor: "#3b4747", obstacle: "#4a5568", border: "#2d3436" },
  /**
   * The playable floor the art draws: the wall band inset on every side, with 50-unit 45-degree
   * chamfers at the corners (AS3, AS6). Clockwise from the top-left chamfer, `+y` down.
   *
   * `width`/`height` above stay 1280x720 — the image frame and the camera bounds. This polygon is
   * inset INSIDE them, which is what lets the painted walls be visible and unreachable at once.
   */
  boundary: [
    { x: 124, y: 54 },
    { x: 1156, y: 54 },
    { x: 1206, y: 104 },
    { x: 1206, y: 616 },
    { x: 1156, y: 666 },
    { x: 124, y: 666 },
    { x: 74, y: 616 },
    { x: 74, y: 104 },
  ],
  /**
   * The fourteen spike strips, flush against the four straight walls. Ordinary solids that also
   * hurt (AS10, AS11); the chamfers carry none, matching the art.
   */
  obstacles: SPIKES,
  /**
   * The four corners and the midpoint of each long wall, one margin off the playable edge. Corner
   * cars face across the arena and the two midpoint cars face each other, so wherever the shuffle
   * in `assignSpawns` puts you, you open the match looking at the fight rather than at a wall.
   * Re-measured against the octagon in 2026-09-11 (AS27); the facing rule is unchanged.
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
   * A line down each side, facing the other team. The y values divide the playable height into four
   * equal parts, so the gap between two team-mates is the same as the gap from the end car to the
   * wall — no seat on the line is more exposed than another.
   */
  teamASpawns: [
    { x: 200, y: 207, angle: 0 },
    { x: 200, y: 360, angle: 0 },
    { x: 200, y: 513, angle: 0 },
  ],
  teamBSpawns: [
    { x: 1080, y: 207, angle: Math.PI },
    { x: 1080, y: 360, angle: Math.PI },
    { x: 1080, y: 513, angle: Math.PI },
  ],
} as const satisfies ArenaDef;
