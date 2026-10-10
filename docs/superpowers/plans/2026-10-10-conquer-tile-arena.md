# Conquer on Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw arena-03 (Conquer) as a tile arena and make the capture zone exactly its tiles, with
a car counting when its hull reaches `conquer().zoneEdgeInset` (20 u) into them.

**Architecture:** A new `zone` tile definition flags capture cells; the compiler turns them into
`ArenaZone.rects`. A pure `zoneCoreOf(rects, inset)` erodes the patch (square erosion) into the
counting rectangles, and `zonePresence` tests each car's OBB hull against them with the existing SAT.
The client tints the zone rects and outlines the patch's outer cell edges.

**Tech Stack:** TypeScript, Vitest, Colyseus (server), Phaser 4 (client), npm workspaces.

**Spec:** [`docs/superpowers/specs/2026-10-10-conquer-tile-arena-design.md`](../specs/2026-10-10-conquer-tile-arena-design.md) (CT1–CT12)

## Global Constraints

- Branch `feature/tile-cells`; commit per task; every commit message ends with the session's
  attribution lines.
- `TILE_SIZE` = 40. Arena-03: 34 × 56 tiles, 1360 × 2240; the grid and legend are verbatim from spec §4.1.
- Spawns: team A (500, 2120), (680, 2120), (860, 2120) angle −π/2; team B (860, 120), (680, 120),
  (500, 120) angle π/2; `ffaSpawns` = those six.
- `ConquerConfig.zoneEdgeInset` base value **20** (world units).
- Never read a mode accessor at module scope (`conquer()`, `drive()`); compute the core at call time.
- After editing shared, rebuild it (`npm run build -w @motor-combat-moba/shared`) before running
  server/client suites; build with root `npm run build`, never `--workspaces`.
- Snapshots: accept moved files with `vitest -u` scoped to the moved `__snapshots__/<slug>.tables.json`
  files by name, never a blanket `-u`.
- Playtest probes: never create a probe; fix a probe only where it stops compiling, and report it.
- `docs/ideas/` and `docs/invariants/` are off limits.

## Review Focus

1. **A car exactly on the core's edge** (hull touching, zero penetration) — must NOT count;
   `obbsOverlap` treats touching as separate. Pinned in Task 4's presence tests.
2. **A rotated car at a stepped corner** of the patch — counts only if some part of the hull
   overlaps the core; square erosion keeps notches at concave corners. Pinned in Task 2
   (concave-corner core) and Task 4 (45° car at a step).
3. **Inset ≥ half the patch's thinnest part** — the core must come back empty or smaller, never
   inverted or outside the patch. Pinned in Task 2 (large inset → empty; every core rect inside the patch).
4. **Team B's rotated camera** — the zone tint is world-space and must sit on the metal for both
   teams. Covered by the client test asserting the drawn rects equal `arena.zone.rects` (Task 4).
5. **A grid with no capture cells** — must compile with no `zone` (arena-01/02), and the Conquer
   invariant still refuses a conquer mode on a zoneless arena. Pinned in Task 1.

---

### Task 1: Capture cells in the tile layer

**Files:**
- Modify: `packages/shared/src/arena/tiles/tile-config.ts` (`TileDef`, `TILE_DEFS`)
- Modify: `packages/shared/src/arena/types.ts` (`TileCell`)
- Modify: `packages/shared/src/arena/tiles/compile.ts` (`resolveGrid`; new exported `captureRectsOf`)
- Test: `packages/shared/src/arena/tiles/tile-config.test.ts`, `packages/shared/src/arena/tiles/compile.test.ts`

**Interfaces:**
- Produces: `TileDef.capture?: true`; `TILE_DEFS.zone = { collision: "none", shape: "full", defaultArt: "metal-floor-drawn", capture: true }`;
  `TileCell.capture: boolean`; `captureRectsOf(grid: TileGrid): Aabb[]` — capture cells merged row-major into
  maximal rectangles in world units (same greedy merge as `mergeSolids`), `[]` when none.

- [ ] **Step 1: Write the failing tests**
  - `tile-config.test.ts` › "ships a zone floor that captures": `TILE_DEFS.zone` has `collision: "none"`,
    `capture: true`, `defaultArt: "metal-floor-drawn"`; and "only non-solid definitions capture": every def
    with `capture` has `collision: "none"`.
  - `compile.test.ts` › "flags capture cells": a 3 × 3 grid `["...", ".z.", "..."]` with legend
    `{ z: { tile: "zone" } }` → `cells[4].capture === true`, every other cell `false`.
  - `compile.test.ts` › "merges capture cells into rects": rows `["zz.", "zz.", "..z"]` →
    `captureRectsOf(grid)` equals `[{x:0,y:0,w:80,h:80},{x:80,y:80,w:40,h:40}]`.
  - `compile.test.ts` › "a grid without capture cells has no capture rects": `captureRectsOf` of an all-floor grid is `[]`.
- [ ] **Step 2: Run** `npx vitest run packages/shared/src/arena/tiles` — expect FAIL (no `zone` def, no `capture`, no `captureRectsOf`).
- [ ] **Step 3: Implement.** Add the flag and definition; `resolveGrid` copies `capture: def.capture === true`;
  `captureRectsOf` shares the greedy merge with `mergeSolids` (extract the loop over a cell predicate rather
  than copying it). Export `captureRectsOf` from `packages/shared/src/index.ts`.
- [ ] **Step 4: Run** `npx vitest run packages/shared/src/arena` — expect PASS (existing compile tests that
  `toEqual` whole cells gain `capture: false`; update those literals).
- [ ] **Step 5: Commit** `feat(shared): zone tile definition and capture cells (CT7)`.

### Task 2: The counting core

**Files:**
- Create: `packages/shared/src/arena/zone.ts`
- Test: `packages/shared/src/arena/zone.test.ts`

**Interfaces:**
- Consumes: `Aabb` (`sim/collide.ts`).
- Produces: `zoneCoreOf(rects: readonly Aabb[], inset: number): Aabb[]` — the square (Chebyshev) erosion of the
  union of `rects` by `inset`, as disjoint merged rectangles; `inset <= 0` returns the rects' union unchanged.
  `zoneCentreOf(rects: readonly Aabb[]): { x: number; y: number }` — centre of the rects' bounding box.
  Both exported from `packages/shared/src/index.ts`.

- [ ] **Step 1: Write the failing tests** (areas compared as sums of `w*h`; "inside" = every core rect within the union)
  - "a single 80×80 square shrinks by the inset on every side": `zoneCoreOf([{x:0,y:0,w:80,h:80}], 20)` covers exactly `{x:20,y:20,w:40,h:40}` (area 1600).
  - "an inset of 0 is the patch": area equals the input's.
  - "a concave corner keeps a notch": L-shape `[{x:0,y:0,w:80,h:40},{x:0,y:40,w:40,h:40}]` with inset 10 — the concave corner is (40, 40), so the core excludes every point with x > 30 and y > 30: (25, 35) and (35, 25) are in the core, (35, 35) is not.
  - "a large inset empties the core": `zoneCoreOf([{x:0,y:0,w:80,h:80}], 40)` → `[]`.
  - "every core rect lies inside the patch": for the CT6 patch (build its rects from widths 4,6,8,10,10,10,10,8,6,4 centred on x 680, rows from y 920) at inset 20, each core rect's four corners are inside the union, and total area is within 1 % of 91 200 u² (≈ 129 % of π·150²).
  - "zoneCentreOf is the bounding-box centre": CT6 patch → `{ x: 680, y: 1120 }`.
- [ ] **Step 2: Run** `npx vitest run packages/shared/src/arena/zone.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `zoneCoreOf`: collect x-breakpoints `{edge, edge ± inset}` and y-breakpoints likewise for
  every rect edge, clipped to the bounding box; for each sub-rectangle of that grid keep it when its centre `(cx, cy)`
  satisfies "the square `[cx−inset, cx+inset] × [cy−inset, cy+inset]` lies inside the union" (check by the same
  sub-grid: every sub-cell overlapping that square is inside a rect); merge kept sub-rectangles greedily. Pure; no
  config reads.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat(shared): zoneCoreOf — the zone eroded by its edge inset (CT9)`.

### Task 3: Arena-03 as a tile arena (zone still a circle)

Lands the map with today's scoring so the visual change is reviewable on its own. The zone stays the
CQ circle, recentred on (680, 1120); Task 4 replaces it.

**Files:**
- Modify: `packages/shared/src/arena/arena-03.ts` (rewrite as `compileTileArena` source; spec §4.1 grid and legend, §4.2 spawns, `zone: { x: 680, y: 1120, radius: 150 }` for now, keep `palette`)
- Modify: `packages/shared/src/arena/arena-03.test.ts`
- Modify tests that used arena-03 as a polygon/chamfer fixture: `packages/shared/src/arena/bounds.test.ts`,
  `packages/client/src/scenes/arena-visual.test.ts`, `packages/server/src/net/view-manager.test.ts`,
  `packages/client/src/camera/rotation.test.ts`, `packages/shared/src/flow/spawns.test.ts` (and any other the suites name)
- Modify: `packages/shared/src/config/spike-config.ts` (comment only: no shipped arena authors strips now)
- Modify: `CLAUDE.md` (Arenas section: arena-03 is a tile arena, 34 × 56; no shipped arena uses `boundary`)

**Interfaces:**
- Consumes: `TILE_DEFS.zone` (Task 1).
- Produces: `ARENA_03` with `width` 1360, `height` 2240, `tiles` set, 76 capture cells.

- [ ] **Step 1: Write the failing tests** in `arena-03.test.ts`
  - "is a 34 × 56 tile arena": `[width, height]` = `[1360, 2240]`, `tiles.cols` 34, `tiles.rows` 56.
  - "has 76 capture cells drawn in metal-floor-drawn": count of `cells` with `capture` = 76; each has `base.art` `"metal-floor-drawn"`.
  - "spikes only on the side walls, rows 20–35": every `kind: "spike"` obstacle has x 0 or 1320, y 800, h 640, w 40.
  - Keep "maps onto itself under 180°" (rotation about the arena centre; zone centre maps to itself), "team A bottom facing up / team B top facing down".
  - Update "keeps every spawn at least ~800 u from the zone edge" to the recentred circle (passes at 850).
  - Spawns equal the Global Constraints values exactly.
- [ ] **Step 2: Run** `npx vitest run packages/shared/src/arena/arena-03.test.ts` — expect FAIL (still the polygon).
- [ ] **Step 3: Implement** the rewrite. Legend keys and rows verbatim from spec §4.1.
- [ ] **Step 4: Fix fixtures.** Rebuild shared, run `npm test`. Where a test used `ARENA_03` for its **polygon or
  chamfer** behaviour (`boundsOf` planes, `boundaryGaps`, `spikeStrips`), give it a local hand-written fixture that
  reproduces today's literal (1280 × 2160, the eight-point `boundary`, the two 20 u spike strips) so coverage is
  kept, not deleted. Where a test used it **as Conquer's arena** (spawns, team-facing rotation, view-manager
  geometry), update its numbers to the new map. Expected: `npm test` green.
- [ ] **Step 5: Run** `npm run test:slow` (shared `arena/` changed) — expect PASS.
- [ ] **Step 6: Commit** `feat(shared): arena-03 redrawn as a tile arena (CT1–CT6, CT10)`.

### Task 4: The zone is its tiles

**Files:**
- Modify: `packages/shared/src/arena/types.ts` (`ArenaZone` → `{ readonly rects: readonly Aabb[] }`, doc comment per CT7)
- Modify: `packages/shared/src/arena/tiles/compile.ts` (emit `zone: { rects: captureRectsOf(tiles) }` when non-empty; delete `TileArenaSource.zone`)
- Modify: `packages/shared/src/arena/arena-03.ts` (drop the circle) and `arena-03.test.ts`
- Modify: `packages/shared/src/config/conquer-config.ts` (`zoneEdgeInset`, doc comment: CT8, units, "only Conquer reads it")
- Modify: `packages/shared/src/modes/conquer/outcome.ts` (`ZonePresenceCar`, `zonePresence`) and `outcome.test.ts`
- Modify: `packages/shared/src/modes/__snapshots__/*.tables.json` (all four move)
- Modify: `packages/server/src/modes/conquer/zone-fields.ts`, `controller.ts`, `zone-fields.test.ts`, `controller.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`renderZone`), plus a pure helper and its test in `packages/client/src/scenes/arena-visual.ts` / `arena-visual.test.ts`
- Modify: `packages/server/playtest/modes/conquer/zone.ts` (compile fix only: `zoneCentreOf`)
- Modify: `packages/shared/src/arena/tiles/compile.test.ts` (zone-pass-through tests become zone-from-cells tests)
- Modify: `CLAUDE.md` (Conquer bullet), `docs/config-reference.md` (new field), `docs/superpowers/specs/2026-09-24-conquer-mode-design.md` (dated pointer to CT on CQ18, CQ37–CQ40, CQ49, CQ50, CQ52's ring)

**Interfaces:**
- Consumes: `captureRectsOf` (Task 1), `zoneCoreOf`, `zoneCentreOf` (Task 2), `obbsOverlap`, `aabbToObb`, `carHullOf`, `Obb`.
- Produces:
  - `ArenaZone = { readonly rects: readonly Aabb[] }`.
  - `ZonePresenceCar = { readonly hull: Obb; readonly team: number; readonly alive: boolean; readonly inRoster: boolean }`.
  - `zonePresence(core: readonly Aabb[], cars: readonly ZonePresenceCar[]): readonly [number, number]` — a car counts when `alive && inRoster` and `obbsOverlap(car.hull, aabbToObb(r))` for some core rect.
  - `advanceConquer(f, core: readonly Aabb[], cars, delayTicks, targetTicks)` — `zone` parameter replaced by `core`.
  - `ConquerConfig.zoneEdgeInset: number`, `CONQUER_CONFIG.zoneEdgeInset = 20`.
  - Client: `zoneOutlineSegments(grid: TileGrid): Array<[number, number, number, number]>` — world-space segments on capture cells' faces whose neighbour is not a capture cell.

- [ ] **Step 1: Write the failing tests**
  - `outcome.test.ts` › "zonePresence (CT8)" with core `[{x:0,y:0,w:200,h:200}]` and hulls 60 × 40:
    a car at (−30, 100) angle 0 (right edge exactly on x 0, touching) → not counted;
    at (−29, 100) angle 0 → counted; centred inside → counted; at (100, −20) angle π/2 (nose along +y, hull
    spans y −50..10) → counted; a 45° car whose nearest corner stops 1 u short of the core → not counted;
    dead or out-of-roster cars → not counted; result per team `[a, b]`.
  - `compile.test.ts` › "builds the zone from capture cells": rows `["zz.", "zz.", "..z"]` → `arena.zone` equals
    `{ rects: [{x:0,y:0,w:80,h:80},{x:80,y:80,w:40,h:40}] }`; an all-floor grid has no `zone` key.
  - `arena-03.test.ts` › "the zone is the 76 metal cells": sum of `zone.rects` areas = 76 × 1600;
    "keeps every spawn more than 800 u from the counting core (CQ42)": distance from each spawn to the nearest
    point of `zoneCoreOf(zone.rects, CONQUER_CONFIG.zoneEdgeInset)` > 800; "the shipped inset leaves a core":
    non-empty. Symmetry test maps each zone rect onto a zone rect.
  - `arena-visual.test.ts` › "outlines only the patch's outer edges": for a 2 × 2 capture block in a 4 × 4 grid,
    `zoneOutlineSegments` returns exactly the 8 unit-tile segments of the block's perimeter.
  - `zone-fields.test.ts` / `controller.test.ts`: replace the circle with a one-rect core / a real arena-03 room;
    assertions unchanged in meaning.
- [ ] **Step 2: Run** `npx vitest run packages/shared` — expect FAIL (types and signatures not changed yet).
- [ ] **Step 3: Implement shared.** Type change, compile emission, config field, `zonePresence` per Interfaces.
  Rebuild shared. Re-snapshot only the four moved files:
  `npx vitest run packages/shared/src/modes/snapshots.test.ts -u` after confirming the diff in each file is exactly the
  added `"zoneEdgeInset": 20`.
- [ ] **Step 4: Implement server.** `controller.ts` builds `core = zoneCoreOf(zone.rects, conquer().zoneEdgeInset)` inside
  `afterTick` (call-time; memoise per arena id + inset if it shows in a profile, not before) and each car's
  `hull = carHullOf(p.x, p.y, p.angle)`; `advanceConquer` takes `core`.
- [ ] **Step 5: Implement client.** `renderZone` fills each `zone.rects` rect (`fillRect`) at `ZONE_FILL_ALPHA` and strokes
  `zoneOutlineSegments(arena.tiles)` at `ZONE_RING_PX`; same tint rule and redraw-on-change as today. Update the method's
  doc comment (no circle).
- [ ] **Step 6: Playtest compile fix.** In `playtest/modes/conquer/zone.ts` replace `zone.x`/`zone.y` with
  `zoneCentreOf(zone.rects)` and reword the "well inside the radius" comment; change nothing else. Note it for the
  final report.
- [ ] **Step 7: Docs.** `docs/config-reference.md` gets `zoneEdgeInset` in the Conquer table; `CLAUDE.md`'s Conquer bullet adds `zoneEdgeInset` to the `conquer()` field list and says presence is the hull reaching the inset into the zone tiles; the Conquer spec's
  superseded clauses each get one dated line pointing to this spec.
- [ ] **Step 8: Run** root `npm run build`, then `npm test` — expect PASS; `npm run test:slow` — expect PASS.
- [ ] **Step 9: Commit** `feat: the Conquer zone is its tiles, counted 20 u in (CT7–CT9, CT11)`.

### Task 5: Owed scope and report

**Files:** none (verification only).

- [ ] **Step 1: Run** `node scripts/test-scope.mjs` and run every command it names; expect each to pass.
- [ ] **Step 2: Run** `npm run playtest -- --scope=all` for every active mode (`--mode=brawl`, `--mode=deathmatch`,
  `--mode=conquer`); record each `FINDING` that names arena-03 or the zone. Do not edit probes.
- [ ] **Step 3: Run** `npm run build:manual` only if `scripts/manual-page.test.mjs` failed in Step 1; commit the page if it moved.
- [ ] **Step 4: Push** `git push -u origin feature/tile-cells`.
