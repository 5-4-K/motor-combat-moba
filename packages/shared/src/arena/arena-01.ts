import type { ArenaDef } from "./types.js";

export const ARENA_01 = {
  id: "arena-01",
  width: 2400,
  height: 1600,
  obstacles: [
    { x: 500, y: 350, w: 220, h: 80 },
    { x: 1680, y: 350, w: 220, h: 80 },
    { x: 500, y: 1170, w: 220, h: 80 },
    { x: 1680, y: 1170, w: 220, h: 80 },
    { x: 1080, y: 620, w: 240, h: 360 },
    { x: 360, y: 720, w: 80, h: 160 },
  ],
  ffaSpawns: [
    { x: 200, y: 200, angle: 0 },
    { x: 2200, y: 200, angle: Math.PI },
    { x: 200, y: 1400, angle: 0 },
    { x: 2200, y: 1400, angle: Math.PI },
    { x: 1200, y: 180, angle: Math.PI / 2 },
    { x: 1200, y: 1420, angle: -Math.PI / 2 },
  ],
  teamASpawns: [
    { x: 220, y: 400, angle: 0 },
    { x: 220, y: 800, angle: 0 },
    { x: 220, y: 1200, angle: 0 },
  ],
  teamBSpawns: [
    { x: 2180, y: 400, angle: Math.PI },
    { x: 2180, y: 800, angle: Math.PI },
    { x: 2180, y: 1200, angle: Math.PI },
  ],
} as const satisfies ArenaDef;
