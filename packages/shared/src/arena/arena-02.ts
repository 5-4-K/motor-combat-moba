import type { ArenaDef } from "./types.js";

/**
 * "Crossroads" — a square arena built around a central plus-shaped block with four corner bunkers.
 *
 * Deliberately a different shape from `ARENA_01`: square rather than 3:2, with one large central
 * mass instead of scattered cover, so the two read as different places rather than as two
 * rearrangements of the same one. The plus is authored as two overlapping rects; overlapping pairs
 * form one compound solid and are exempt from the corridor rule, which only fires on a positive gap.
 */
export const ARENA_02 = {
  id: "arena-02",
  width: 2000,
  height: 2000,
  palette: { floor: "#d8cfc4", obstacle: "#6b5b4b", border: "#2f2a26" },
  obstacles: [
    { x: 940, y: 700, w: 120, h: 600 },
    { x: 700, y: 940, w: 600, h: 120 },
    { x: 400, y: 400, w: 200, h: 200 },
    { x: 1400, y: 400, w: 200, h: 200 },
    { x: 400, y: 1400, w: 200, h: 200 },
    { x: 1400, y: 1400, w: 200, h: 200 },
  ],
  ffaSpawns: [
    { x: 200, y: 200, angle: 0 },
    { x: 1800, y: 200, angle: Math.PI },
    { x: 200, y: 1800, angle: 0 },
    { x: 1800, y: 1800, angle: Math.PI },
    { x: 1000, y: 200, angle: Math.PI / 2 },
    { x: 1000, y: 1800, angle: -Math.PI / 2 },
  ],
  teamASpawns: [
    { x: 200, y: 600, angle: 0 },
    { x: 200, y: 1000, angle: 0 },
    { x: 200, y: 1400, angle: 0 },
  ],
  teamBSpawns: [
    { x: 1800, y: 600, angle: Math.PI },
    { x: 1800, y: 1000, angle: Math.PI },
    { x: 1800, y: 1400, angle: Math.PI },
  ],
} as const satisfies ArenaDef;
