# Tile cells — design

**Date:** 2026-10-09
**Status:** approved for implementation
**Clause prefix:** TC
**Supersedes:** tile arenas TA5, TA6, TA8, TA13, TA21 and the art half of TA4
([`2026-10-09-tile-arenas-design.md`](2026-10-09-tile-arenas-design.md)). Every other TA clause
stands.

## 1. Why

The first tile pass ties three things to one `TILE_TABLE` row: the character an author types, what
the tile **does**, and what it **looks like**. A metal floor, a dirt floor and a grass floor behave
identically but would each need a new global row and a new global character. And a hazard cannot
hurt from one side only — every spike tile damages from every open side.

The replacement separates the three:

- a **tile definition** says what a tile does (collision, hazard, later driving modifiers);
- a **cell** places one definition in the grid, with its own orientation, art and overlay;
- a per-arena **legend** maps the short keys an author types to cells, so characters mean nothing
  globally.

## 2. Decisions taken in the brainstorm

| # | Decision |
|---|---|
| TC1 | Behaviour and look are separate. A **tile definition** (`TILE_DEFS`, global, keyed by id) carries behaviour only; **art is chosen per cell**. Two cells with the same definition and different art behave identically. |
| TC2 | A cell is `{ tile, orientation?, art?, artOrientation?, overlay? }` — `tile` names a definition id. |
| TC3 | **Orientation** is `0 | 90 | 180 | 270`, clockwise degrees. At 0 a definition's `front` side faces **north** (−y). `right`, `back`, `left` follow clockwise. |
| TC4 | A hazard may damage from **some sides only**: `hazard.sides` is `"all"` or a list of `front`/`right`/`back`/`left`, in the definition's own frame. The cell's orientation rotates them into world faces. |
| TC5 | `artOrientation` defaults to `orientation`; it is written only when the art must face differently from the behaviour. |
| TC6 | **Overlay** (spike teeth): automatic by default — a definition may declare an overlay art drawn on each **damaging side that borders a non-solid cell**. A cell may override with an explicit `{ art, orientation }` or suppress with `"none"`. |
| TC7 | Authoring is **hand-written now, a visual editor later**. The format is a per-arena **legend** (one-character key → cell) plus **character rows**. Keys are local to the arena. |
| TC8 | A global **`DEFAULT_LEGEND`** (`.` floor, `#` wall, `^` spike, space void) applies to every arena; an arena's own legend adds keys and may **override** any default key. |
| TC9 | The compiler expands rows + legend into a **fully resolved cell grid** in memory. That grid — not the legend — is what the sim, the bake, the bot and a future editor read. |
| TC10 | Merged collision rectangles group cells by **identical behaviour** (same collision class, same hazard kind, same world damage faces). Art never splits a merge. |

## 3. Data model (shared, `packages/shared/src/arena/tiles/`)

### 3.1 Tile definitions — `tile-config.ts`

```ts
export const TILE_SIZE = 40;                     // TA3, unchanged

export type TileRotation = 0 | 90 | 180 | 270;   // TC3
export type TileSide = "front" | "right" | "back" | "left";
export type WorldFace = "n" | "e" | "s" | "w";

export interface TileHazard {
  readonly kind: "spike";                        // numbers stay in the mode's spike() table
  readonly sides: "all" | readonly TileSide[];   // TC4
}

export interface TileOverlayRule {
  readonly art: string;                          // authored for the TOP edge (as today)
}

export interface TileDef {
  readonly collision: "none" | "solid";
  readonly shape: "full";                        // TA2, diagonals later
  readonly hazard?: TileHazard;
  readonly surface?: TileSurface;                // reserved, refused by test (TA12 stands)
  readonly draw?: "none";                        // void: no art, the backdrop shows
  readonly defaultArt?: string;                  // used when a cell names no art
  readonly overlay?: TileOverlayRule;            // TC6 automatic overlay
}

export const TILE_DEFS = {
  floor: { collision: "none",  shape: "full", defaultArt: "metal-plate" },
  wall:  { collision: "solid", shape: "full", defaultArt: "checker-plate" },
  spike: { collision: "solid", shape: "full", defaultArt: "checker-plate",
           hazard: { kind: "spike", sides: "all" }, overlay: { art: "spike-teeth" } },
  void:  { collision: "solid", shape: "full", draw: "none" },
} as const satisfies Record<string, TileDef>;

export type TileDefId = keyof typeof TILE_DEFS;
```

- **TC11** No definition carries a character. `TILE_DEFS` is global, not per mode (as TA); the
  root `CLAUDE.md`'s "what is NOT per-mode" list names `TILE_DEFS` in place of `TILE_TABLE`.
- **TC12** A definition with a `hazard` must be `collision: "solid"`; `draw: "none"` and
  `defaultArt` are mutually exclusive; a definition that is neither `draw: "none"` nor carries a
  `defaultArt` is legal (cells must then name art, else they draw the fallback); `surface` stays
  refused until the sim reads it.
- **TC13** A one-sided spike is authored when an arena first needs one — it is a data row, e.g.
  `"spike-front": { …spike, hazard: { kind: "spike", sides: ["front"] } }`. No shipped arena in
  this work places one, but the compiler, sim, bot and bake must all support it, tested with a
  fixture definition (TC19).
- **TC14** `defaultArt` is the house look. The shipped defaults are the art already imported on
  2026-10-09, renamed by what it looks like (TC29). An arena that uses only defaults needs no legend.

### 3.2 Cells and legends — `legend.ts`

```ts
export interface TileCellSpec {                  // what an author writes (TC2)
  readonly tile: string;                         // a definition id
  readonly orientation?: TileRotation;
  readonly art?: string;
  readonly artOrientation?: TileRotation;
  readonly overlay?: { readonly art: string; readonly orientation: TileRotation } | "none";
}

export type TileLegend = Readonly<Record<string, TileCellSpec>>;

export const DEFAULT_LEGEND: TileLegend = {
  ".": { tile: "floor" },
  "#": { tile: "wall" },
  "^": { tile: "spike" },
  " ": { tile: "void" },
};
```

- **TC15** A legend key is exactly one character. The effective legend is
  `{ ...DEFAULT_LEGEND, ...arena.legend }` — an arena key replaces a default key whole.
- **TC16** Everything is plain JSON-able data (no functions, no class instances), so an editor
  can read and write it.

### 3.3 The resolved grid — `ArenaDef.tiles` (`arena/types.ts`)

```ts
export interface TileStamp { readonly art: string; readonly rotation: TileRotation; }

export interface TileCell {
  readonly tile: string;                         // the definition id
  readonly solid: boolean;                       // def.collision === "solid"
  readonly hazard: "spike" | null;               // def.hazard?.kind ?? null
  readonly faces: readonly WorldFace[];          // damaging world faces, n-e-s-w order; [] if no hazard
  readonly drawn: boolean;                       // def.draw !== "none"
  readonly base: TileStamp | null;               // null when not drawn, or drawn with no art
  readonly overlays: readonly TileStamp[];       // resolved, edge-rotated, in draw order
}

export interface TileGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly TileCell[];           // row-major; was readonly TileId[]
}
```

- **TC17** Resolution, per cell:
  - `solid`, `hazard` are copied from the definition, so no reader of the grid needs the
    definition table (a fixture definition then flows through the bake and bounds unchanged).
  - `base.art` = `cell.art ?? def.defaultArt`; `base` is `null` when `drawn` is false, and also
    `null` when neither names an art — the bake then draws the behaviour fallback (TC33) for a
    drawn cell, and nothing for an undrawn one.
  - `base.rotation` = `cell.artOrientation ?? cell.orientation ?? 0`.
  - `faces` = the definition's hazard sides rotated by the cell's orientation, in `n e s w`
    order; `"all"` → `["n", "e", "s", "w"]`; no hazard → `[]`.
  - `overlays`: `"none"` → `[]`; an explicit `{ art, orientation }` → that one stamp; otherwise,
    if the definition has an `overlay` rule, one stamp per face in `faces` whose neighbour across
    that face is inside the grid and **not solid**, at rotation `n 0, e 90, s 180, w 270` — the
    rule today's `tileBakePlan` applies to spike teeth (TA6), now driven by `faces`.
- **TC18** Load errors name the arena and say what is wrong: a row of the wrong width (row
  number), a key not in the effective legend (row, column and key), a legend entry naming an
  unknown `tile` (key), an orientation or art orientation outside the four values (key), a legend
  key that is not exactly one character, art on a `draw: "none"` cell (key).

### 3.4 Fixture definitions

- **TC19** `compileTileArena` takes an optional `defs` table (defaulting to `TILE_DEFS`) so tests
  can compile with a fixture `"spike-front"` without shipping one. Production code never passes it.

## 4. Compiling to the sim (`compile.ts`)

- **TC20** `compileTileArena({ id, rows, legend?, ffaSpawns, teamASpawns, teamBSpawns, palette?,
  zone? }, defs?)` returns an ordinary `ArenaDef` exactly as today (TA14), with `tiles` the
  resolved `TileGrid` of §3.3.
- **TC21** Merge class (TC10): non-solid cells do not merge; a solid cell's class is
  `hazard ?? "solid"` plus its `faces` joined. Walls and voids still merge together. Greedy
  rectangle merge and exact cover are unchanged (TA15, TA16).
- **TC22** `Obstacle` gains `damageFaces?: readonly WorldFace[]`. A merged spike rectangle whose
  faces are all four carries **no** `damageFaces` (absent means every face — the meaning every
  hand-written spike in `arena-02`/`arena-03` already has); otherwise it carries its faces.
  Consequence: a tile arena using only `sides: "all"` spikes compiles to obstacles **identical**
  to today's, field for field.

## 5. Sim and bot

### 5.1 Spike contact (`sim/contact.ts`)

- **TC23** The face a contact touches is read from the contact normal (which points out of the
  strip, toward the car): the dominant axis, `|nx| > |ny|` → `e`/`w` by sign of `nx`,
  `|ny| > |nx|` → `s`/`n` by sign of `ny`; on an exact tie both faces are candidates. One pure
  helper, `facesOfNormal(nx, ny)`, in `arena/` beside `WorldFace`, used by both sim and bot.
- **TC24** A contact with a spike obstacle counts only if a candidate face is in its
  `damageFaces` (absent = all). A non-damaging contact is **not** reported and the loop moves on
  to the next spike obstacle — so a car touching a safe face of one strip and a damaging face of
  another still reports the damaging one. Still at most one report per car per tick.
- **TC25** Nothing else changes: `triggerSpeed`, `retriggerMs`, shover credit and the damage
  number stay in the mode's `spike()` table, resolved by `spike-bridge.ts` as today.

### 5.2 Bot (`bot/brain/movement.ts`)

- **TC26** `spikesAhead` counts a spike obstacle only when the face the car centre lies outside
  of is in its `damageFaces` (absent = all). That face is `facesOfNormal` applied to the vector
  from the box's nearest point to the car centre (a car centre inside the box counts every face).
- **TC27** No shipped arena places a one-sided spike, so shipped bot behaviour is unchanged and
  `BOT_BRAIN_VERSION` does **not** move. A test pins that `arena-01`'s compiled obstacles equal a
  frozen copy of today's (TC22), which is what makes "unchanged" a checked claim.

## 6. Art and the client

### 6.1 Art ids

- **TC28** An art id is a free kebab-case name for a **look** (`/^[a-z0-9]+(-[a-z0-9]+)*$/`),
  no longer a tile-type id. The texture key stays `arena.common.tile.<art>` and the file
  `arenas/common/tile-<art>.png`.
- **TC29** The four images imported on 2026-10-09 are renamed by look, content unchanged:

  | old id | new id | used by |
  |---|---|---|
  | `floor` | `metal-plate` | `floor.defaultArt` |
  | `wall` | `checker-plate` | `wall.defaultArt`, `spike.defaultArt` |
  | `spike` | — (deleted) | — |
  | `spike-teeth` | `spike-teeth` | `spike.overlay.art` |

  `tile-spike.png` and `tile-wall.png` were imported from the same source file; dropping one
  changes no pixel.
- **TC30** `scripts/import-tile-art.mjs` takes `--art <id> --src <path>`; it accepts any id
  matching TC28 rather than a fixed list, and still resizes to 80 × 80 with no trim (TA21).
  `--tile` is removed.
- **TC31** `npm run check:art`'s TILE ART section keeps scanning every `arena.common.tile.*`
  row. The "an overlay must keep its alpha" blocker applies to every art id used as an overlay,
  read from built shared through an exported `overlayArtIds()` (every definition's
  `overlay.art` plus every explicit cell overlay in every arena in `ARENAS`). It also **warns**
  on an art id a definition or a shipped arena references with no manifest row
  (`referencedTileArtIds()`), since that cell will draw the fallback.

### 6.2 Bake and fallback (`tile-bake.ts`, `tile-art.ts`, `ArenaScene.ts`)

- **TC32** `tileBakePlan(grid)` becomes a flat read of the resolved cells: every base first
  (row-major), then every overlay (row-major) — the TA22 order. It no longer computes edges. A
  plan entry carries the art (or `null` for a drawn cell with no art), the rotation, the cell's
  `solid`/`hazard`, and whether it is an overlay.
- **TC33** The procedural fallback is chosen by **behaviour, not art id**: a missing base
  texture fills with `colors.floor` for a non-solid cell, `SPIKE_STRIP_COLOR` for a hazard cell,
  and `colors.obstacle` for any other solid; a missing overlay texture draws the procedural
  teeth. So a new floor look with no art yet draws as floor, not as wall.
- **TC34** Chunking, `TILE_BAKE_SCALE`, the floor-art tint and `arenaDecoration` are unchanged.
  The texture keys the client preloads come from the manifest as today.

## 7. Migration

- **TC35** `arena-01` keeps its `rows` and needs **no legend** (every key is a default; its art
  is the defaults). Its compiled `obstacles` must equal the pre-change list exactly (TC22, TC27).
- **TC36** `parseTileGrid`, `TILE_TABLE`, `TileDef.char`, `TileId`, `tileDefOf` and
  `isSolidTile` are replaced; every reader moves to `TILE_DEFS` / `TileCell`. `playableRectOf`
  reads `cell.solid`. The readers today are the tile folder, `arena/types.ts`, `arena/bounds.ts`,
  `index.ts`, the client bake (`tile-bake.ts`, `tile-art.ts`, `ArenaScene.ts`), the importer and
  check-art.
- **TC37** Docs: the root `CLAUDE.md` arena paragraph and per-mode exclusion list,
  `docs/asset-pipeline.md` (tile art section), `docs/config-reference.md`,
  `docs/project-structure.md` if it lists the tile files, and a "superseded in part by TC" line
  at the top of the tile-arenas spec.

## 8. Testing

- **TC38** Shared: legend merge and override; every TC18 error; orientation rotation of sides
  (all four orientations of a fixture `spike-front`); auto overlays only on damaging, exposed
  faces; merge grouping by faces (two adjacent one-sided spikes facing different ways do not
  merge; walls with different art do); `arena-01` obstacles equal a frozen copy of today's.
- **TC39** Sim: a car driven into a fixture one-sided spike's damaging face is reported; into its
  safe face is not; touching a safe face of one and a damaging face of another reports once.
- **TC40** Bot: `spikesAhead` is true facing a damaging face, false facing a safe face.
- **TC41** Client and scripts: `tileBakePlan` order; fallback by behaviour; importer id
  validation; check-art overlay-alpha and missing-art warning.
- **TC42** Scope owed: full (`npm test`). The slow bot and balance tests are skipped by the
  user's standing instruction; `playtest` is not owed, since no shipped geometry or rule moves —
  say so in the summary.

## 8a. Addendum — per-arena overlay art (2026-10-09, after the arena-02 conversion)

- **TC43** A legend entry may carry `overlayArt`: the art the definition's AUTOMATIC overlay wears
  on that cell, placed on exactly the edges TC17 already picks. It exists because previewing arena
  looks showed one arena could not have wooden teeth without a second spike definition that differs
  only in look, which TC1 forbids. Refused (TC18 style, naming arena and key) on a definition with no
  overlay rule, and beside an explicit `overlay`. `overlayArtIds()` sees it through the resolved
  cells, so `check:art`'s alpha blocker covers it with no change.

## 9. Out of scope

Driving surfaces (TA12); diagonal shapes (TA2); random per-cell art variants; the visual editor.
(`arena-02` was converted to tiles on 2026-10-09, after this spec — see the root `CLAUDE.md`.)
