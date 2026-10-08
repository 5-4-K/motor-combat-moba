# Tile arenas — design

**Date:** 2026-10-09
**Status:** implemented 2026-10-09 (plan docs/superpowers/plans/2026-10-09-tile-arenas.md)
**Clause prefix:** TA

## 1. Why

An arena today is painted one of two ways: generated asphalt with procedural walls, or one
full-arena PNG (`arena.<id>.floor`, 2560 × 1440 for a 1280 × 720 arena). The PNG is the polished
look, but authoring one large image per arena does not scale to bigger or more numerous arenas.

The replacement: an arena is a **grid of square tiles**, and each tile TYPE has one small image.
An arena definition becomes a list of tile positions; the art is reused by every arena.

The grid is also the **source of truth for gameplay**, not a skin laid over hand-written geometry:
the sim's obstacles are compiled from it, so the art and the collision cannot drift apart.

## 2. Decisions taken in the brainstorm

| # | Decision |
|---|---|
| TA1 | Tiles define gameplay (approach "B"), and the structure must admit per-tile **movement behaviour** later (grip, slippery, slow — approach "C"). Only today's behaviours are authored now: **floor, solid, damaging solid**, plus **void**. |
| TA2 | Square tiles only. A tile carries a `shape` field whose only legal value is `"full"`; diagonal half-tiles are future work and arrive through that field. |
| TA3 | `TILE_SIZE = 40` world units, **one global constant**, not per arena and not per mode. 1280 × 720 is a 32 × 18 grid. |
| TA4 | Tile art is sourced at **80 px per tile (2× world units)** and **baked once** at arena load into render textures, so per-frame cost is independent of tile count. |
| TA5 | Arenas are authored as a **text grid** in the arena's `.ts` file, one character per tile. |
| TA6 | Spikes carry **no orientation**. Damage already keys off the contact normal (`contactNormalBetween` in `sim/contact.ts`); art stamps a "teeth" overlay on every edge that borders a non-solid tile. A spike tile may sit anywhere — a mid-arena spike pillar hurts from every open side. |
| TA7 | The grid's outer edge is an **implicit wall** (the arena `Bounds` rectangle). A **void** tile is solid and drawn as backdrop, so non-rectangular shapes need no ring of typed walls. |
| TA8 | Tile behaviour is a **row in `TILE_TABLE`** with independent optional behaviour fields (approach "1"), not a component list and not a hard-coded enum. |
| TA9 | **`arena-01` is converted** to a tile arena in this work. `arena-02` and `arena-03` stay hand-written; both kinds coexist because a tile arena compiles to an ordinary `ArenaDef`. |

## 3. Data model (shared)

New folder `packages/shared/src/arena/tiles/`.

### 3.1 `tile-config.ts`

```ts
export const TILE_SIZE = 40;

export type TileCollision = "none" | "solid";
export type TileShape = "full";            // TA2: diagonals arrive here later
export type TileHazard = "spike";          // damage numbers stay in the mode's spike() table

/** Reserved for TA1's movement behaviour. Declared, NOT wired: see TA12. */
export interface TileSurface {
  readonly grip?: number;    // multipliers, 1 = neutral, same convention as Modifiers
  readonly drag?: number;
  readonly accel?: number;
}

export interface TileDef {
  readonly char: string;               // exactly one character, unique across the table
  readonly art: string | null;         // tile art id (see §5), null = drawn as backdrop
  readonly collision: TileCollision;
  readonly shape: TileShape;
  readonly hazard?: TileHazard;
  readonly surface?: TileSurface;
}

export const TILE_TABLE = {
  floor: { char: ".", art: "floor", collision: "none",  shape: "full" },
  wall:  { char: "#", art: "wall",  collision: "solid", shape: "full" },
  spike: { char: "^", art: "spike", collision: "solid", shape: "full", hazard: "spike" },
  void:  { char: " ", art: null,    collision: "solid", shape: "full" },
} as const satisfies Record<string, TileDef>;

export type TileId = keyof typeof TILE_TABLE;
```

- **TA10** `TILE_SIZE` and `TILE_TABLE` are global and join the "not per-mode" list in the root
  `CLAUDE.md`. Reading them at module scope is allowed: they are constants, not mode accessors.
- **TA11** A hazard tile must be `collision: "solid"`; a test enforces it. (A damaging *floor* — lava
  — is future surface work, not a non-solid hazard.)
- **TA12** No row may author `surface` until the sim reads it. A config test fails naming the row
  with "tile surfaces are not wired into the sim yet" — the same pattern as `impulse` being legal
  only on maneuver rows, so a half-built behaviour cannot silently do nothing.
- **TA13** `char` values are unique and exactly one character; a test enforces both.

### 3.2 `ArenaDef.tiles`

```ts
export interface TileGrid {
  readonly cols: number;
  readonly rows: number;
  /** Row-major, `cells[r * cols + c]`. */
  readonly cells: readonly TileId[];
}
```

`ArenaDef` gains `readonly tiles?: TileGrid`. Present means "this arena was compiled from tiles".
Render-only today (and the surface lookup's source later). It is static shared data keyed by arena
id, exactly like the rest of `ArenaDef`, so it is never a schema field and invariant 8 is untouched.

### 3.3 `compile.ts` — `compileTileArena`

```ts
export interface TileArenaSource {
  readonly id: string;
  readonly rows: readonly string[];      // TA5
  readonly ffaSpawns: readonly Spawn[];
  readonly teamASpawns: readonly Spawn[];
  readonly teamBSpawns: readonly Spawn[];
  readonly palette?: ArenaPalette;
  readonly zone?: ArenaZone;
}

export function compileTileArena(src: TileArenaSource): ArenaDef;
```

- **TA14** `width = cols × TILE_SIZE`, `height = rows × TILE_SIZE`. No `boundary`: the bounds are the
  grid rectangle (TA7), which `boundsOf` already builds for an arena without a polygon.
- **TA15** Obstacles are the solid tiles merged into rectangles by a deterministic greedy pass: scan
  row-major; at the first unclaimed solid cell take the widest run of the same *class* to its right,
  then extend it downward while every cell of the next row's same span is that class and unclaimed.
  A class is `(collision, hazard)`: `wall` and `void` share one (plain solid) and merge together;
  `spike` is its own and is emitted with `kind: "spike"`. Output order is scan order, so one grid
  always yields one list.
- **TA16** The merged rectangles tile the solid cells **exactly** — no cell covered twice, no solid
  cell uncovered, no floor cell covered. A unit test asserts this by rasterising the output back onto
  the grid.
- **TA17** Compile **throws**, naming the arena id, row and column, on: an unknown character; rows of
  unequal length; an empty grid.
- Spawns, zone and palette pass through unchanged. Compiling reads no mode accessor, so it may run at
  module load (`export const ARENA_01 = compileTileArena({...})`).

Downstream of compile **nothing in the sim, vision or shots changes**: they keep reading
`arena.obstacles` and `boundsOf(arena)`. Two readers of the *playable edge* do change:

- **TA30** `playableExtentOf` (the players' guide quotes every weapon's reach as a percentage of it)
  answers a tile arena's **bounding box of non-solid cells**, not the grid frame — the same class of
  error the octagon once caused (reading the frame understated reach by ~13%). It is built on a new
  `playableRectOf(arena): { x, y, w, h }` in `arena/bounds.ts`, which also answers the polygon's
  bounding box and, for a plain arena, the frame. arena-01's extent moves 1132 × 612 → 1120 × 640,
  so **`npm run build:manual` is owed**.
- **TA31** The bot's wall-avoidance (`boundsPenalty`, `wallAhead`) walks `BotArenaView.planes`, which
  `buildBotView` fills from `boundsOf(arena).planes` — absent for a tile arena, so the bot would see
  the grid frame as the wall and only a binary penalty off the wall rects. A new
  `playablePlanesOf(arena)` in `arena/bounds.ts` returns the polygon's planes, or for a tile arena
  the four planes of `playableRectOf`, or `undefined` for a plain rectangle; `buildBotView` uses it.
  This changes bot behaviour without moving `BOT_PROFILES`, so `BOT_BRAIN_VERSION` is bumped.

## 4. Arena rules for tile arenas

The per-arena rules in `arena.test.ts` assume hand-placed rectangles inside a polygon. A tile arena
replaces three of them with grid rules; the rest (spawn count, spawns inside bounds and clear of
obstacles, team halves, spawn spacing) apply unchanged to every arena.

- **TA18 (replaces "ordinary obstacle a car diagonal clear of the boundary" and "no corridor
  narrower than a car")** Every floor cell belongs to at least one 2 × 2 block of non-solid cells. Two
  tiles (80 u) exceed the car diagonal (72.1 u), so no passage narrower than a car can be authored.
  Hand-written arenas keep the old two rules.
- **TA19 (replaces AS13 "spikes flush against a boundary plane, one depth deep")** Every spike tile
  has at least one in-grid edge-neighbour that is non-solid — a spike nothing can touch is an
  authoring mistake. `SPIKE_CONFIG.depth` keeps describing the hand-written arenas only; a tile spike
  is one `TILE_SIZE` deep.
- **TA20** Every spawn sits on a floor cell, and its hull at its authored angle is clear of every
  solid cell (the existing hull-vs-obstacle and inside-bounds checks cover this once obstacles are
  compiled; the floor-cell check is new).

## 5. Rendering (client)

### 5.1 Art keys and the importer

Tile art lives in the never-pruned shared arena namespace: manifest key
`arena.common.tile.<artId>`, file `public/art/arenas/common/tile-<artId>.png`, `colorMode: "none"`.
`arenaIdFromArtKey` already returns `"common"` for it, so release pruning and boot loading need no
change. Four art ids: `floor`, `wall`, `spike` (the solid spike base), and `spike-teeth` (the edge
overlay, authored for the tile's **top** edge — teeth whose bases sit inside the tile and whose
points reach the top edge, transparent elsewhere). Teeth never draw past their own tile: the tile is
the hitbox, and a tooth over the floor would promise damage where there is none.

- **TA21** Source art is 80 × 80 px (TA4). An importer, `scripts/import-tile-art.mjs`, resizes to
  exactly 80 × 80 (no trim — tiles are full-bleed), writes the file and adds the manifest row, in the
  manner of the car and weapon-icon importers. `npm run check:art` covers the tile rows: a missing
  file is a blocker (as for every row), a `spike-teeth` without an alpha channel is a blocker (it
  would paint an opaque square over its neighbour), and any size other than 80 × 80 is a warning.
- No tile art ships with this work. arena-01 renders through the procedural fallback (TA25) until
  the user imports the four images.

### 5.2 The bake plan (pure, unit-tested)

`packages/client/src/scenes/tile-bake.ts`:

```ts
export interface TileStamp {
  readonly art: string;        // tile art id
  readonly col: number;
  readonly row: number;
  readonly rotation: 0 | 90 | 180 | 270;   // clockwise degrees
}
export function tileBakePlan(grid: TileGrid): TileStamp[];
export function bakeChunks(cols: number, rows: number, tilePx: number, maxPx: number): BakeChunk[];
```

- **TA22** For each cell: one stamp of its row's `art` at rotation 0 (none when `art` is `null`). For
  each spike cell, one extra `spike-teeth` stamp per edge whose neighbour is in-grid and non-solid:
  top 0°, right 90°, bottom 180°, left 270°. Every base precedes every teeth stamp, so no
  neighbouring base paints over teeth.
- **TA23** `bakeChunks` splits the grid into chunks of whole tiles no larger than `maxPx` on a side
  (`TILE_BAKE_MAX_CHUNK_PX = 2048`, safe on every WebGL target). arena-01 at 80 px/tile is
  2560 × 1440 → two chunks.

### 5.3 Drawing it

`ArenaScene.drawArena` gains a third floor source beside the floor image and the generated asphalt:

- **TA24** An arena with `tiles` bakes `tileBakePlan` into one render texture per chunk at
  `TILE_BAKE_SCALE = 2` px per world unit, displayed at 0.5 scale at `FLOOR_DEPTH`. Baked once in
  `drawArena`; never redrawn per frame.
- **TA25 (missing art never blacks the screen, as AS23)** A stamp whose texture did not load is drawn
  procedurally into the same bake instead: `floor` → palette floor, `wall` → palette obstacle, `spike`
  → `SPIKE_STRIP_COLOR`, `spike-teeth` → `SPIKE_TOOTH_COLOR` triangles along that edge, `void` (no
  stamp) → palette border. The texture-or-fallback decision is pure and lives in `assets/` beside
  `resolveArenaFloor`, so it is unit-testable.
- **TA26** A tile arena counts as a **floor-art arena** everywhere the scene asks: no generated
  asphalt, no markings, no procedural border, no procedural obstacle fill or spike strips (the bake
  holds all of them), and the playground environment panel marks `floor.*` inert and `floorArt.*`
  live. `floorArt`'s tint is applied to the baked chunk images.
- The camera background colour stays the palette floor colour.

### 5.4 Performance budget

Per frame: one image per chunk (two for arena-01), the draw cost of today's single floor image. At
load: one stamp per cell plus teeth — about 600 for arena-01 — once. Video memory: 2560 × 1440 × 4
bytes ≈ 14 MB for arena-01, matching the PNG it replaces.

## 6. Converting arena-01 (TA9)

32 × 18 tiles, still 1280 × 720, so the camera and zoom are untouched. The playable extent does move
(TA30), which owes a players' guide rebuild.

| | Before | After |
|---|---|---|
| Wall band | 74 u left/right, 54 u top/bottom | 2 tiles (80 u) left/right, 1 tile (40 u) top/bottom |
| Playable floor | 1132 × 612 octagon | 1120 × 640 rectangle, x 80..1200, y 40..680 |
| Corners | 50 u chamfers | square (TA2) |
| Spikes | 14 strips, 20 u, protruding into the floor | 14 spike runs **in the innermost wall row**, one tile deep, so no floor is lost |
| Floor art | `arena.arena-01.floor` | removed (manifest row and PNG); the bake replaces it |

Spike runs, mirrored about both centre lines (cols 0..31, rows 0..17):

- top row 0 and bottom row 17: cols 3–7, 11–13, 18–20, 24–28 (8 runs)
- left col 1 and right col 30: rows 3–4, 8–9, 13–14 (6 runs)

These are the old strips' spans rounded to the 40 u grid.

Spawns: the FFA rows (x 200/640/1080, y 180/540) are unchanged and sit ≥ 140 u off every wall. The
team lines keep their documented rule — four equal parts of the playable height — which now gives
**y 200 / 360 / 520** (was 207 / 360 / 513).

## 7. Risks

- **TA27 Embedding against edge-flush walls.** `arena.test.ts` forbids ordinary obstacles near the
  boundary because `resolveWorld` gives the bounds the last word: an obstacle pushing a car toward
  the wall and the clamp pushing it back can trap the car inside the block. Tile walls touch the edge
  everywhere. The analysis says it is safe here: an obstacle's minimum translation only points toward
  the wall once the car's centre passes the block's midline, and the bounds clamp keeps the centre at
  least a car half-extent (≥ 20 u) from the edge. For a 40 u band that is exactly the midline, which
  the centre can reach but not pass; for an 80 u band the centre would have to reach 40 u, which
  means at least 60 u of penetration into the block in one tick against a per-tick travel under
  10 u. **Verified by a unit test**: a car driven, and a
  car pushed at `wildcharge` impulse speed, diagonally into a corner of edge-flush wall rects across
  the sub-tick phases, never ends a tick overlapping a solid by more than `contactPad`. If it fails,
  the fix is the collision ranking, and that goes back to the user before any change (root
  `CLAUDE.md`: stop and ask before changing collision).
- **TA28 Seams along a wall.** Walls were seamless (polygon planes); a tile wall row with spike runs
  in it is several coplanar rectangles. `resolveAgainst` resolves by minimum translation, so a car
  entering the next rectangle at a steep angle can be pushed back *along* the wall for one tick. At
  shallow (scraping) angles the into-wall overlap is the smaller one and the push is the correct
  normal. **Verified by a unit test**: a car scraping a wall row of alternating wall/spike runs at
  15° and 30° keeps ≥ 95% of its tangential speed across the seams. If it fails, the remedy —
  compiling spikes as damage-only rectangles beside a seamless collision union — changes what the
  collision pass reads, and goes back to the user first.
- **TA29 Balance and playtest numbers move.** arena-01 is the default arena of Brawl, Team brawl and
  Deathmatch. The probe reading it directly is `playtest/common/collision.ts`
  (`getArena("arena-01")`), plus the scenarios defaulting to it in `weapons.ts` and `world.ts`, and
  `geometry.ts` iterates it. This work edits probes only to keep them compiling; the summary flags the
  run loudly.

## 8. Testing

Shared: `TILE_TABLE` rules (TA11–TA13); compile (TA14–TA17, including the rasterise-back exactness
check and each throw); arena rules (TA18–TA20) over every tile arena in `ARENAS`; arena-01's own test
rewritten for the grid (size, 14 spike runs, both mirror symmetries, spawn rows); TA27 and TA28
collision tests. `arena.test.ts` exempts tile arenas exactly where §4 replaces a rule.

Client: `tileBakePlan` (bases, teeth per open edge, rotations; a mid-arena pillar gets four, a
wall-row spike gets one, void stamps nothing); `bakeChunks` (whole tiles, ≤ max, covers exactly); the
texture-or-fallback decision; the asset-key tests gain a tile key.

Scripts: `check:art` tile rows; the importer's output size.

Visual verification in the browser (`npm run dev`): arena-01 renders from the bake through the
procedural fallback, spikes show teeth on the floor side only, and a match plays.

## 9. Out of scope

Surface behaviours (TA1's "C"), diagonal shapes (TA2), per-tile art variants or random rotation, an
in-game editor, converting arena-02/03, any probe or balance retune.
