import type { ArenaDef } from "./types.js";

/**
 * Conquer's arena (spec CQ37–CQ40): a tall pitch, one screen wide and three tall, the capture zone at
 * its centre and each team's base at an end. Symmetric about both centre lines, so a 180° rotation
 * maps it onto itself. That is what lets team B's view be rotated (CQ46) and still show the same map
 * with its own base at the bottom.
 *
 * No floor art: it renders procedurally, spikes and chamfer corners included (CQ49, CQ50). The
 * boundary is the frame itself with 100 u chamfers, since there is no painted wall band to inset.
 *
 * Distances: spawn row to zone edge ≈ 810 u (about 3 s for Mirage at top speed). CQ42: that
 * distance plus the 3 s `phaseMaxSeconds` ceiling is what keeps a freshly respawned (phased) car
 * from contesting the zone while untouchable. Moving these spawns toward the zone weakens that.
 */
const W = 1280;
const H = 2160;
const CHAMFER = 100;
const SPIKE_DEPTH = 20;
const SPIKE_TOP = 760;
const SPIKE_LENGTH = 640;

export const ARENA_03 = {
  id: "arena-03",
  width: W,
  height: H,
  palette: { floor: "#2b2f35", obstacle: "#4b5362", border: "#1a1d22" },
  /** Clockwise from top-left, `+y` down. */
  boundary: [
    { x: CHAMFER, y: 0 },
    { x: W - CHAMFER, y: 0 },
    { x: W, y: CHAMFER },
    { x: W, y: H - CHAMFER },
    { x: W - CHAMFER, y: H },
    { x: CHAMFER, y: H },
    { x: 0, y: H - CHAMFER },
    { x: 0, y: CHAMFER },
  ],
  zone: { x: W / 2, y: H / 2, radius: 150 },
  flipForTeamB: true,
  obstacles: [
    // B: lane pillars
    { x: 200, y: 480, w: 100, h: 100 },
    { x: 980, y: 480, w: 100, h: 100 },
    { x: 200, y: 1580, w: 100, h: 100 },
    { x: 980, y: 1580, w: 100, h: 100 },
    // C: midfield blocks, cutting the zone-to-base-exit sightline
    { x: 590, y: 660, w: 100, h: 60 },
    { x: 590, y: 1440, w: 100, h: 60 },
    // D: zone cover on the diagonals
    { x: 330, y: 850, w: 120, h: 60 },
    { x: 830, y: 850, w: 120, h: 60 },
    { x: 330, y: 1250, w: 120, h: 60 },
    { x: 830, y: 1250, w: 120, h: 60 },
    // F: side-wall spikes level with the zone
    { x: 0, y: SPIKE_TOP, w: SPIKE_DEPTH, h: SPIKE_LENGTH, kind: "spike" as const },
    { x: W - SPIKE_DEPTH, y: SPIKE_TOP, w: SPIKE_DEPTH, h: SPIKE_LENGTH, kind: "spike" as const },
  ],
  /** Unused by Conquer (a team mode); required by the type and by the ≥ MAX_PLAYERS test. */
  ffaSpawns: [
    { x: 460, y: 2040, angle: -Math.PI / 2 },
    { x: 640, y: 2040, angle: -Math.PI / 2 },
    { x: 820, y: 2040, angle: -Math.PI / 2 },
    { x: 460, y: 120, angle: Math.PI / 2 },
    { x: 640, y: 120, angle: Math.PI / 2 },
    { x: 820, y: 120, angle: Math.PI / 2 },
  ],
  /** Team A (team 0): the bottom base, facing up the map. */
  teamASpawns: [
    { x: 460, y: 2040, angle: -Math.PI / 2 },
    { x: 640, y: 2040, angle: -Math.PI / 2 },
    { x: 820, y: 2040, angle: -Math.PI / 2 },
  ],
  /** Team B (team 1): the top base, facing down the map. */
  teamBSpawns: [
    { x: 820, y: 120, angle: Math.PI / 2 },
    { x: 640, y: 120, angle: Math.PI / 2 },
    { x: 460, y: 120, angle: Math.PI / 2 },
  ],
} as const satisfies ArenaDef;
