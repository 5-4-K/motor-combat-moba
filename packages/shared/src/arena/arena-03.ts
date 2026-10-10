import type { ArenaDef } from "./types.js";
import { compileTileArena } from "./tiles/compile.js";

/**
 * Conquer's arena (spec Conquer on tiles, CT1–CT6, CT10): a 34 × 56 tile pitch (1360 × 2240), one
 * screen wide and three tall, the capture patch at its centre and each team's base at an end.
 * Symmetric under a 180° turn about (680, 1120), so each team's view — derived from its spawn
 * heading by the mode's `camera.rotate: "teamFacing"` (2026-09-28 camera spec, CB10) — shows the
 * same map with its own base at the bottom. It replaces the hand-written chamfered polygon of
 * CQ37–CQ40.
 *
 * Keys: `#` wall (top and bottom rows, interior blocks), `|` wall turned 90° (side walls),
 * `l` spike run on the side wall, rows 20–35, `.` dirt floor, `z` the capture patch (76 cells, drawn
 * as metal floor). Only the ART turns on a side wall; the spikes hurt from every side. The playable
 * floor is x 40..1320, y 40..2200.
 *
 * Spawns sit 40 u further back than the pre-tile map (y 2120 / 120, not 2040 / 120 around a 2160
 * frame), which keeps every spawn more than 800 u from the zone's counting core. CQ42: that
 * distance plus the 3 s `phaseMaxSeconds` ceiling is what keeps a freshly respawned (phased) car
 * from contesting the zone while untouchable. Moving these spawns toward the zone weakens that.
 *
 * The scoring zone is the `z` cells themselves (CT7): the compiler merges them into `zone.rects`,
 * and a car counts once its hull reaches `zoneEdgeInset` into them (CT8, CT9).
 */
const WALL = "wooden-wall";

export const ARENA_03: ArenaDef = compileTileArena({
  id: "arena-03",
  displayName: "Arena 03",
  legend: {
    ".": { tile: "floor", art: "dirt-floor-drawn" },
    "#": { tile: "wall", art: WALL },
    "|": { tile: "wall", art: WALL, artOrientation: 90 },
    l: { tile: "spike", art: WALL, artOrientation: 90, overlayArt: "wooden-spike" },
    z: { tile: "zone", art: "metal-floor-drawn" },
  },
  rows: [
    "##################################", //  0
    "|................................|", //  1
    "|................................|", //  2
    "|................................|", //  3
    "|................................|", //  4
    "|................................|", //  5
    "|................................|", //  6
    "|................................|", //  7
    "|................................|", //  8
    "|................................|", //  9
    "|................................|", // 10
    "|................................|", // 11
    "|................................|", // 12
    "|.....##..................##.....|", // 13
    "|.....##..................##.....|", // 14
    "|................................|", // 15
    "|................................|", // 16
    "|................................|", // 17
    "|...............##...............|", // 18
    "|................................|", // 19
    "l................................l", // 20
    "l................................l", // 21
    "l........###..........###........l", // 22
    "l........###...zzzz...###........l", // 23
    "l.............zzzzzz.............l", // 24
    "l............zzzzzzzz............l", // 25
    "l...........zzzzzzzzzz...........l", // 26
    "l...........zzzzzzzzzz...........l", // 27
    "l...........zzzzzzzzzz...........l", // 28
    "l...........zzzzzzzzzz...........l", // 29
    "l............zzzzzzzz............l", // 30
    "l.............zzzzzz.............l", // 31
    "l........###...zzzz...###........l", // 32
    "l........###..........###........l", // 33
    "l................................l", // 34
    "l................................l", // 35
    "|................................|", // 36
    "|...............##...............|", // 37
    "|................................|", // 38
    "|................................|", // 39
    "|................................|", // 40
    "|.....##..................##.....|", // 41
    "|.....##..................##.....|", // 42
    "|................................|", // 43
    "|................................|", // 44
    "|................................|", // 45
    "|................................|", // 46
    "|................................|", // 47
    "|................................|", // 48
    "|................................|", // 49
    "|................................|", // 50
    "|................................|", // 51
    "|................................|", // 52
    "|................................|", // 53
    "|................................|", // 54
    "##################################", // 55
  ],
  palette: { floor: "#2b2f35", obstacle: "#4b5362", border: "#1a1d22" },
  /** Unused by Conquer (a team mode); required by the type and by the ≥ MAX_PLAYERS test. */
  ffaSpawns: [
    { x: 500, y: 2120, angle: -Math.PI / 2 },
    { x: 680, y: 2120, angle: -Math.PI / 2 },
    { x: 860, y: 2120, angle: -Math.PI / 2 },
    { x: 860, y: 120, angle: Math.PI / 2 },
    { x: 680, y: 120, angle: Math.PI / 2 },
    { x: 500, y: 120, angle: Math.PI / 2 },
  ],
  /** Team A (team 0): the bottom base, facing up the map. */
  teamASpawns: [
    { x: 500, y: 2120, angle: -Math.PI / 2 },
    { x: 680, y: 2120, angle: -Math.PI / 2 },
    { x: 860, y: 2120, angle: -Math.PI / 2 },
  ],
  /** Team B (team 1): the top base, facing down the map. */
  teamBSpawns: [
    { x: 860, y: 120, angle: Math.PI / 2 },
    { x: 680, y: 120, angle: Math.PI / 2 },
    { x: 500, y: 120, angle: Math.PI / 2 },
  ],
});
