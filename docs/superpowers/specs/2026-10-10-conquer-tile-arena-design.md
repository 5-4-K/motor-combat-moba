# Conquer on tiles — design

**Date:** 2026-10-10
**Status:** approved for implementation
**Clause prefix:** CT
**Supersedes:** Conquer CQ37–CQ40, CQ49 and CQ50 (arena-03's hand-written geometry, chamfers and
procedural look) and every clause that defines the zone as a circle — the centre-in-radius presence
test and the circular ring ([`2026-09-24-conquer-mode-design.md`](2026-09-24-conquer-mode-design.md)).
Every other CQ clause stands, CQ42 included.

## 1. Why

Arena-03 is the last hand-written arena. Every other shipped arena is a tile grid, drawn with tile
art, so Conquer looks unlike the rest of the game and cannot reuse the tile pipeline.

Moving it to tiles exposes a second problem: the capture zone is a circle of radius 150, and a tile
floor cannot draw a circle. If the zone stayed a circle under a stepped metal patch, a car could be
counted while visibly off the metal, or not counted while visibly on it. The owner's requirement is
that **what is drawn is what counts**: the capture area is the zone tiles, and nothing else.

## 2. Goals, non-goals, anti-goals

**Goals**

- Arena-03 becomes a tile arena: arena-02's dirt floor, wooden wall and wooden spikes; wall tiles for
  the obstacles; arena-01's metal floor for the capture zone.
- Same map as today, snapped to the 40 u grid.
- The zone is defined by its tiles. A car counts when its hull reaches a set distance into them.

**Non-goals**

- Redesigning Conquer's layout, timings, team sizes or respawn flow.
- Teaching bots to play the zone (they do not read it today; this change keeps that).
- Removing the hand-written-arena machinery (`ArenaDef.boundary`, `SPIKE_CONFIG.depth`). Nothing ships
  on it after this change, but it stays for future hand-drawn arenas.

**Anti-goals** — this fails, even if it technically works, if:

- any place a car can sit reads as "on the metal" but does not count, or "off the metal" but counts,
  beyond the documented edge inset (CT8);
- a hidden circle survives anywhere in scoring or drawing;
- the spawn-to-zone distance drops below CQ42's ~800 u.

## 3. Decisions taken in the brainstorm

| # | Decision | Whose |
|---|---|---|
| CT1 | Arena-03 is redrawn in place: same id `arena-03`, same `displayName`, still Conquer's only arena. | agent's call |
| CT2 | Same layout as today, snapped to the 40 u grid. Where a piece does not fit, it rounds **smaller**, except the diagonal zone cover (CT5). | owner |
| CT3 | The map grows one tile on every side: **34 × 56 tiles, 1360 × 2240**. A one-tile wall ring sits on the new outer tile, so the floor stays 1280 × 2160 and every interior point moves by (+40, +40). The 100 u chamfers become square corners. | owner (grow); square corners forced by the grid |
| CT4 | The ring is arena-02's `wooden-wall`, except two runs of spike on the side walls, 16 tiles long, level with the zone (today's strips, a full tile deep instead of 20 u). Spikes use arena-02's `wooden-spike` overlay; the automatic overlay already draws teeth only on the floor-facing side. Side-wall art is turned 90° as in arena-02. | owner |
| CT5 | Obstacles are `wooden-wall` tiles: lane pillars 2 × 2, midfield blocks 2 × 1, diagonal zone cover **3 × 2** (120 × 80, bigger than today's 120 × 60), each centred where today's piece is. The cover's closest gap to the zone metal is ≈ 57 u (today's cover is ≈ 105 u from the circle). | owner (bigger cover); placement agent's call |
| CT6 | The zone is a stepped patch of arena-01's `metal-floor-drawn`, 10 rows tall, row widths 4, 6, 8, 10, 10, 10, 10, 8, 6, 4, centred on the arena centre (680, 1120). | owner (kept) |
| CT7 | **The zone is its tiles.** A new tile definition marks capture cells; the compiler builds `ArenaDef.zone` from those cells. There is no circle and no radius anywhere. | owner (no mismatch); "it lives in the tile definition" agent's call |
| CT8 | **Presence:** a car is in the zone when its hull OBB overlaps the zone **eroded inward by `conquer().zoneEdgeInset`** — a new Conquer config field, initial value **20 u**. Driving straight in, the nose must be 20 u onto the metal before the car counts. | owner (rule and 20 u) |
| CT9 | The erosion is **square** (Chebyshev): every edge of the patch moves in by the inset and corners stay square, so the counting area is a union of rectangles tested with the existing OBB SAT. Counting area at 20 u ≈ 129 % of today's circle. | agent's call |
| CT10 | Spawns move 40 u further toward each team's back wall so CQ42 holds: team A at y = 2120, team B at y = 120, x = 500 / 680 / 860. Closest spawn to the counting area ≈ 821 u (today 810). | owner |
| CT11 | The client's zone tint is drawn over the zone tiles (filled rectangles) with its outline on the patch's outer cell edges — the metal's edge, not the inset core. | agent's call |
| CT12 | The arena is wider than the 1280 logical canvas; the camera, which always follows, scrolls up to 80 u sideways near the side walls. Accepted. | owner (accepted in the brainstorm) |

## 4. The arena

### 4.1 Grid

Rows 0–55, 34 characters each. Keys:

| Key | Cell |
|---|---|
| `#` | `{ tile: "wall", art: "wooden-wall" }` — the top and bottom rows (corners included) and every interior obstacle |
| `\|` | `{ tile: "wall", art: "wooden-wall", artOrientation: 90 }` — the side walls outside the spike runs |
| `l` | `{ tile: "spike", art: "wooden-wall", artOrientation: 90, overlayArt: "wooden-spike" }` — the side-wall spike runs |
| `.` | `{ tile: "floor", art: "dirt-floor-drawn" }` |
| `z` | `{ tile: "zone", art: "metal-floor-drawn" }` |

```
 0 ##################################
 1 |................................|
 2 |................................|
 3 |................................|
 4 |................................|
 5 |................................|
 6 |................................|
 7 |................................|
 8 |................................|
 9 |................................|
10 |................................|
11 |................................|
12 |................................|
13 |.....##..................##.....|
14 |.....##..................##.....|
15 |................................|
16 |................................|
17 |................................|
18 |...............##...............|
19 |................................|
20 l................................l
21 l................................l
22 l........###..........###........l
23 l........###...zzzz...###........l
24 l.............zzzzzz.............l
25 l............zzzzzzzz............l
26 l...........zzzzzzzzzz...........l
27 l...........zzzzzzzzzz...........l
28 l...........zzzzzzzzzz...........l
29 l...........zzzzzzzzzz...........l
30 l............zzzzzzzz............l
31 l.............zzzzzz.............l
32 l........###...zzzz...###........l
33 l........###..........###........l
34 l................................l
35 l................................l
36 |................................|
37 |...............##...............|
38 |................................|
39 |................................|
40 |................................|
41 |.....##..................##.....|
42 |.....##..................##.....|
43 |................................|
44 |................................|
45 |................................|
46 |................................|
47 |................................|
48 |................................|
49 |................................|
50 |................................|
51 |................................|
52 |................................|
53 |................................|
54 |................................|
55 ##################################
```

The leading numbers are row indices for the reader; the source carries only the strings. The grid
maps onto itself under a 180° rotation about (680, 1120), and arena-03's existing test for that
symmetry carries over to the compiled obstacles, the spawns and the zone.

### 4.2 Spawns (CT10)

- `teamASpawns`: (500, 2120), (680, 2120), (860, 2120), angle −π/2.
- `teamBSpawns`: (860, 120), (680, 120), (500, 120), angle π/2.
- `ffaSpawns`: those six (required by the type and the ≥ `MAX_PLAYERS` test; unused by Conquer).

### 4.3 Palette

Arena-03 keeps `palette` (`obstacle` and `border` still feed anything that reads them); the floor is
now drawn by tiles, so `palette.floor` is the background behind the bake, as on the other tile
arenas.

## 5. The zone as data (CT7)

- **Tile definition.** `TILE_DEFS` gains `zone: { collision: "none", shape: "full", defaultArt:
  "metal-floor-drawn", capture: true }`. `TileDef` gains an optional behaviour flag
  `capture?: true` ("this cell is part of the capture zone"). A zone cell drives exactly like floor.
- **Resolved cell.** `TileCell` carries the flag (`capture: boolean`) so the client and the
  compiler can read it from the grid.
- **`ArenaZone`** stops being `{ x, y, radius }`. It becomes the patch as world rectangles:
  `{ rects: readonly Aabb[] }` — the capture cells merged into rectangles (the same merge
  `mergeSolids` does for solids). A hand-written arena could still author `rects` directly.
- **Compiler.** `compileTileArena` emits `zone` when the grid has at least one capture cell, and
  omits it otherwise. `TileArenaSource.zone` is removed: a tile arena's zone comes only from its
  cells, so art and zone cannot disagree.
- **A centre, where one is needed.** Anything that wants "the middle of the zone" (the playtest
  probe's placements, the symmetry test) derives it from the rects' bounding box through one
  shared helper; no centre is stored.

## 6. Presence (CT8, CT9)

- **Counting area.** `zoneCoreOf(zone, inset)` returns the zone eroded by `inset` as rectangles:
  every point whose axis-aligned square of half-side `inset` lies inside the patch. Computed exactly
  — e.g. split the patch's bounding box at every patch edge ± `inset`, keep the sub-rectangles whose
  centres pass the predicate, and merge them. Pure and deterministic. The inset is a mode accessor
  read, so the core is computed at call time (memoised on arena + inset if needed), **never at module
  scope**.
- **Test.** A car counts when its hull (`carHullOf(x, y, angle)`) overlaps any core rectangle by
  `obbsOverlap` — strictly overlapping; merely touching does not count. `carHullOf` reads `drive()`,
  so `zonePresence` stays pure by taking the hull's `w`/`h` (or a hull function) as a parameter; the
  controller supplies the real hull inside its mode scope. The hull is not per-mode (it is excluded
  from `ModeTables` by type), so this is plumbing, not a balance read.
- **`zonePresence`** keeps its role and rules (living roster cars only; phased cars count, CQ10) but
  reads the core rectangles and each car's `angle`. `ZonePresenceCar` gains `angle`; the controller
  passes `p.angle`.
- **Config.** `ConquerConfig.zoneEdgeInset: number` (world units), base value 20. Every mode carries
  the `conquer` table, so every mode snapshot moves; only Conquer reads it. Valid range
  `0 ≤ inset`; a test holds that the shipped inset leaves arena-03 a non-empty core.
- **Not networked, not predicted.** The zone is static arena data and presence is server-side, in
  the Conquer controller's `afterTick`, as today. Nothing new crosses the wire.

## 7. Drawing (CT11)

- The metal patch is drawn by the tile bake like any other floor art.
- `ArenaScene.renderZone` fills each zone rectangle with the tint colour at `ZONE_FILL_ALPHA` and
  strokes the patch's outer edges (each capture cell's faces whose neighbour is not a capture cell)
  at `ZONE_RING_PX`. Same tint rule as today (CQ52), redrawn only when the tint changes. World-space
  graphics already turn with team B's rotated camera.
- `arena-visual.ts`'s "no centre circle under a zone" rule (CQ51) still keys on `arena.zone`.

## 8. Everything this touches

- **Shared:** `tile-config.ts` (definition + flag), `types.ts` (`ArenaZone`, `TileCell`),
  `compile.ts` (flag, zone from cells, drop `TileArenaSource.zone`), `arena-03.ts` (rewrite as a tile
  source), `config/conquer-config.ts` (`zoneEdgeInset`), `modes/conquer/outcome.ts` (core +
  presence), the zone helpers' exports in `index.ts`, and their tests (`arena-03.test.ts`,
  `compile.test.ts`, `tile-config.test.ts`, `outcome.test.ts`). Every mode's
  `__snapshots__/<slug>.tables.json` moves (new `conquer.zoneEdgeInset`); accept each moved file by
  name.
- **Server:** `modes/conquer/controller.ts` (pass `angle`), `zone-fields.ts` if its types move, and
  `controller.test.ts` / `zone-fields.test.ts` (both build circle zones today).
- **Client:** `ArenaScene.renderZone`; the floor bake needs no change (the zone cell is ordinary tile
  art).
- **Docs:** `CLAUDE.md` (arena-03 becomes a tile arena; no shipped arena uses `boundary` any more),
  the Conquer spec gets a dated pointer to this spec on the superseded clauses, `docs/config-reference.md`
  (the new field), and `SPIKE_CONFIG.depth`'s comment (no shipped arena authors strips now).
- **Playtest — say so loudly, do not silently edit.** Arena definitions and spawns change, so every
  probe that runs on arena-03 moves. `playtest/modes/conquer/zone.ts` reads `zone.x`/`zone.y` and
  assumes a radius ("well inside the radius"); it stops compiling and is the one probe edit owed on
  the spot (a compile break), made to the new centre helper, and reported. `playtest/common/weapons.ts`
  carries a comment about "arena-03's interior boxes": flag it.
- **Manual:** the guide's reach percentages use Conquer's `arenas[0]` playable width. The floor stays
  1280 wide, so no change is expected; `scripts/manual-page.test.mjs` is the judge.

## 9. Tests that must hold

- Arena-03 compiles; is 1360 × 2240; is 180°-symmetric (obstacles, spawns A↔B, zone rects).
- The compiled zone is exactly the 76 capture cells (sum of CT6's row widths), as merged rectangles.
- Every spawn is more than 800 u from the counting core (CQ42).
- Presence: a car whose hull only touches or barely enters the patch (less than the inset) does not
  count; a car whose nose is past the inset counts; a car fully inside counts; orientation matters
  (a sideways car needs its side, not its nose, past the inset); inset 0 reduces to "overlaps a zone
  tile".
- The core at the shipped inset is non-empty and lies inside the patch.
- `compileTileArena` emits no `zone` for a grid with no capture cells, and refuses nothing new.
- Scope owed: shared outside a mode folder → full `npm test`, plus `npm run test:slow` (shared
  `arena/`, `modes/`, `config/`), plus `npm run playtest -- --scope=all` for every active mode.

## 10. Left to the builder

- The exact shape of `zoneCoreOf`'s algorithm and its memoisation, within §6's contract.
- Whether the zone rect merge reuses `mergeSolids`' code path or a sibling.
- Names of new helpers, test layout, and the order of commits.
