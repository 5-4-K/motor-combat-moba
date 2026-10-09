import { beforeEach, describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../../constants.js";
import { DRIVE_CONFIG } from "../../config/drive-config.js";
import { installMode } from "../../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../../modes/registry.js";
import { obbCorners, resolveWorld } from "../../sim/collide.js";
import type { SimBody } from "../../sim/step.js";
import { boundsOf } from "../bounds.js";
import type { Obstacle } from "../types.js";
import { compileTileArena } from "./compile.js";
import { TILE_SIZE } from "./tile-config.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const DT = 1 / TICK_RATE_HZ;
/** The slack a resolved contact may leave; the scale of `SPIKE_CONFIG.contactPad`. */
const PAD = 2;
const SPAWN = { x: 0, y: 0, angle: 0 };

function arenaOf(rows: string[]) {
  return compileTileArena({ id: "t", displayName: "T", rows, ffaSpawns: [SPAWN], teamASpawns: [SPAWN], teamBSpawns: [SPAWN] });
}

function body(patch: Partial<SimBody>): SimBody {
  return { x: 0, y: 0, angle: 0, vx: 0, vy: 0, angVel: 0, ...patch } as SimBody;
}

/** Deepest any hull corner sits inside any obstacle (0 when none does). */
function deepestPenetration(b: SimBody, obstacles: readonly Obstacle[]): number {
  const corners = obbCorners({
    x: b.x,
    y: b.y,
    angle: b.angle,
    w: DRIVE_CONFIG.carWidth,
    h: DRIVE_CONFIG.carHeight,
  });
  let worst = 0;
  for (const p of corners) {
    for (const o of obstacles) {
      const depth = Math.min(p.x - o.x, o.x + o.w - p.x, p.y - o.y, o.y + o.h - p.y);
      if (depth > worst) worst = depth;
    }
  }
  return worst;
}

/** One tick: integrate, then resolve against the world — the order the sim runs. */
function tick(b: SimBody, obstacles: readonly Obstacle[], bounds: ReturnType<typeof boundsOf>): SimBody {
  const moved = { ...b, x: b.x + b.vx * DT, y: b.y + b.vy * DT };
  return resolveWorld(moved, [], obstacles, bounds, 50);
}

describe("TA27 — no embedding in edge-flush walls", () => {
  // 2-tile wall on the left, 1-tile wall on top, both flush with the grid edge.
  const arena = arenaOf([
    "##########",
    "##........",
    "##........",
    "##........",
    "##........",
    "##........",
    "##........",
  ]);
  const bounds = boundsOf(arena);
  const dir = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };

  for (const speed of [300, 520]) {
    for (const heading of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        it(`drives into the corner at ${speed} u/s, heading ${heading.toFixed(2)}, phase ${phase}`, () => {
          let b = body({
            x: 6 * TILE_SIZE + dir.x * phase * speed * DT,
            y: 4 * TILE_SIZE + dir.y * phase * speed * DT,
            angle: heading,
            vx: dir.x * speed,
            vy: dir.y * speed,
          });
          for (let t = 0; t < 90; t += 1) {
            b = tick(b, arena.obstacles, bounds);
            expect(deepestPenetration(b, arena.obstacles), `tick ${t}`).toBeLessThanOrEqual(PAD);
            // Keep pushing into the corner every tick, as a held throttle or a slam would.
            b = { ...b, vx: dir.x * speed, vy: dir.y * speed };
          }
        });
      }
    }
  }
});

describe("TA28 — scraping a seamed wall keeps tangential speed", () => {
  const arena = arenaOf([
    "##^^^##^^##^^^##^^##^^^##^^##^^^",
    "................................",
    "................................",
    "................................",
    "................................",
  ]);
  const bounds = boundsOf(arena);

  for (const degrees of [15, 30]) {
    it(`keeps >= 95% of its along-wall speed scraping at ${degrees} degrees`, () => {
      const a = (-degrees * Math.PI) / 180; // heading +x, angled up into the top wall
      const speed = 250;
      let b = body({
        x: 3 * TILE_SIZE,
        y: 2.5 * TILE_SIZE,
        angle: a,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
      });
      const vx0 = b.vx;
      let minVx = Infinity;
      let touched = false;
      for (let t = 0; t < 120 && b.x < arena.width - 3 * TILE_SIZE; t += 1) {
        b = tick(b, arena.obstacles, bounds);
        if (b.vy > Math.sin(a) * speed + 1e-6) touched = true; // the wall took some of vy
        minVx = Math.min(minVx, b.vx);
        b = { ...b, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
      }
      expect(touched, "the car must actually reach the wall").toBe(true);
      expect(minVx / vx0).toBeGreaterThanOrEqual(0.95);
    });
  }
});
