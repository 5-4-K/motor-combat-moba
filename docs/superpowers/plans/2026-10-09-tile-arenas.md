# Tile Arenas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arenas can be authored as a text grid of 40 u tiles (floor, wall, spike, void) that compiles to an ordinary `ArenaDef` and renders from small per-tile images baked once; `arena-01` is converted.

**Architecture:** A pure compiler in `packages/shared/src/arena/tiles/` turns a grid into `obstacles` (greedy-merged rectangles) plus an `ArenaDef.tiles` grid, so the sim, vision and shots are untouched. Two readers of the playable edge (the guide's extent, the bot's planes) learn tile arenas. The client bakes the grid into render-texture chunks through a pure, unit-tested stamp plan, with a procedural fallback for missing art.

**Tech Stack:** TypeScript, vitest (node env), Phaser 4.2.1 (`RenderTexture` / `DynamicTexture.stamp` / `fill` / `draw` / `render`), sharp (importer), npm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-09-tile-arenas-design.md` (TA1–TA31). Read it before any task.

## Global Constraints

- `TILE_SIZE = 40` world units, global (TA3, TA10). Art 80 × 80 px (TA4, TA21). `TILE_BAKE_SCALE = 2`, `TILE_BAKE_MAX_CHUNK_PX = 2048` (TA23, TA24).
- Tile chars: floor `.`, wall `#`, spike `^`, void ` ` (space) (TA5, §3.1).
- Art keys `arena.common.tile.<artId>`, files `arenas/common/tile-<artId>.png`, `colorMode: "none"`; art ids `floor`, `wall`, `spike`, `spike-teeth` (§5.1).
- **Never change collision resolution** (`resolveWorld`, `resolveAgainst`, `applyContact`, `clampIntoBounds` in `packages/shared/src/sim/collide.ts`). If a TA27/TA28 test fails, STOP and report — that is the user's call (root `CLAUDE.md`, "Stop and ask").
- Never read a mode accessor (`drive()`, `spike()`, …) at module scope. `TILE_SIZE`/`TILE_TABLE` are constants and are fine at module scope.
- Shared is consumed as built `dist`: after editing shared, run `npm run build -w @motor-combat-moba/shared` before server/client tests. Full builds use root `npm run build`, never `--workspaces`.
- Verify with **root** `npm test` (per-workspace runs skip suites). On this Windows machine `npm test` is already red on clean main (6 path-separator failures in 3 shared meta-test files, possibly some documented bot failures) — Task 0 records the baseline; later tasks compare against it.
- Do not create new playtest probe files or scenarios. Edit a probe only to keep it compiling.
- Do not read or touch `docs/ideas/` or `docs/invariants/`.
- Commit after every task with a conventional message whose body ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on `development/main` in the main checkout (no worktree).

---

### Task 0: Baseline

**Files:** none.

- [ ] **Step 1: Record the pre-existing test failures**

Run: `npm run build && npm test 2>&1 | tail -120`
Write down every failing test file and test name in the task report. That list is the baseline every later "run the full suite" step compares against.

---

### Task 1: Tile table and types

**Files:**
- Create: `packages/shared/src/arena/tiles/tile-config.ts`
- Create: `packages/shared/src/arena/tiles/tile-config.test.ts`
- Modify: `packages/shared/src/arena/types.ts` (add `TileGrid`, `ArenaDef.tiles`)
- Modify: `packages/shared/src/index.ts` (exports, near line 326)

**Interfaces:**
- Produces: `TILE_SIZE` (40), `TILE_TABLE`, `type TileId = "floor" | "wall" | "spike" | "void"`, `TileDef`, `TileSurface`, `TileCollision`, `TileShape`, `TileHazard`, `tileDefOf(id: TileId): TileDef`, `isSolidTile(id: TileId): boolean`, `interface TileGrid { cols: number; rows: number; cells: readonly TileId[] }`, `ArenaDef.tiles?: TileGrid`.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/arena/tiles/tile-config.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { TILE_SIZE, TILE_TABLE, isSolidTile, tileDefOf, type TileDef } from "./tile-config.js";

const rows = Object.entries(TILE_TABLE) as ReadonlyArray<[string, TileDef]>;

describe("TILE_TABLE", () => {
  it("is 40 world units a tile (TA3)", () => {
    expect(TILE_SIZE).toBe(40);
  });

  it("gives every row exactly one character, unique across the table (TA13)", () => {
    for (const [id, def] of rows) expect([...def.char], id).toHaveLength(1);
    const chars = rows.map(([, def]) => def.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it("makes every hazard tile solid (TA11)", () => {
    for (const [id, def] of rows) {
      if (def.hazard !== undefined) expect(def.collision, id).toBe("solid");
    }
  });

  it("lets no row author a surface until the sim reads one (TA12)", () => {
    const authored = rows.filter(([, def]) => def.surface !== undefined).map(([id]) => id);
    expect(authored, "tile surfaces are not wired into the sim yet").toEqual([]);
  });

  it("only uses the full shape (TA2)", () => {
    for (const [, def] of rows) expect(def.shape).toBe("full");
  });

  it("authors the four shipped tiles with their characters", () => {
    expect(tileDefOf("floor").char).toBe(".");
    expect(tileDefOf("wall").char).toBe("#");
    expect(tileDefOf("spike").char).toBe("^");
    expect(tileDefOf("void").char).toBe(" ");
  });

  it("knows which tiles are solid", () => {
    expect(isSolidTile("floor")).toBe(false);
    expect(isSolidTile("wall")).toBe(true);
    expect(isSolidTile("spike")).toBe(true);
    expect(isSolidTile("void")).toBe(true);
  });

  it("draws void as backdrop, with no art", () => {
    expect(tileDefOf("void").art).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/shared/src/arena/tiles/tile-config.test.ts`
Expected: FAIL — cannot resolve `./tile-config.js`.

- [ ] **Step 3: Write `tile-config.ts`**

```ts
/**
 * The tile vocabulary arenas are authored in (spec 2026-10-09 tile arenas, TA1–TA13).
 *
 * GLOBAL, not per mode: a tile type is a piece of level geometry, like an arena, and the art for one
 * is shared by every arena that uses it. Reading `TILE_SIZE`/`TILE_TABLE` at module scope is fine —
 * they are constants, not mode accessors.
 *
 * Each behaviour is its own optional field, so they combine freely. Only floor, solid and damaging
 * solid exist today; `surface` (grip, drag, accel — TA1's movement behaviour) is declared so the
 * shape is ready, and is refused by `tile-config.test.ts` until the sim reads it.
 */

/** World units per tile side (TA3). 1280 x 720 is a 32 x 18 grid. */
export const TILE_SIZE = 40;

export type TileCollision = "none" | "solid";
/** TA2: diagonal half-tiles arrive here later. */
export type TileShape = "full";
/** Damage numbers stay in the active mode's `spike()` table; the tile only says WHICH hazard. */
export type TileHazard = "spike";

/** Reserved for movement behaviour (TA1 "C"). Multipliers, 1 = neutral, like `Modifiers`. */
export interface TileSurface {
  readonly grip?: number;
  readonly drag?: number;
  readonly accel?: number;
}

export interface TileDef {
  /** The one character this tile is typed as in an arena grid (TA5). */
  readonly char: string;
  /** Tile art id (`arena.common.tile.<art>`), or null for a tile drawn as backdrop. */
  readonly art: string | null;
  readonly collision: TileCollision;
  readonly shape: TileShape;
  readonly hazard?: TileHazard;
  readonly surface?: TileSurface;
}

export const TILE_TABLE = {
  floor: { char: ".", art: "floor", collision: "none", shape: "full" },
  wall: { char: "#", art: "wall", collision: "solid", shape: "full" },
  spike: { char: "^", art: "spike", collision: "solid", shape: "full", hazard: "spike" },
  void: { char: " ", art: null, collision: "solid", shape: "full" },
} as const satisfies Record<string, TileDef>;

export type TileId = keyof typeof TILE_TABLE;

/** The row for a tile id, widened to `TileDef` so optional fields read as optional. */
export function tileDefOf(id: TileId): TileDef {
  return TILE_TABLE[id];
}

/** Whether a car, a shot or a sightline is stopped by this tile. */
export function isSolidTile(id: TileId): boolean {
  return tileDefOf(id).collision === "solid";
}
```

- [ ] **Step 4: Add `TileGrid` and `ArenaDef.tiles` to `packages/shared/src/arena/types.ts`**

Add at the top: `import type { TileId } from "./tiles/tile-config.js";`

Add before `export interface ArenaDef`:

```ts
/**
 * The grid a tile arena was compiled from (spec tile arenas, §3.2). Row-major: `cells[r * cols + c]`.
 * Static shared data like the rest of `ArenaDef` — never a schema field (invariant 8 untouched).
 */
export interface TileGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly TileId[];
}
```

Add as the last member of `ArenaDef`:

```ts
  /**
   * Present when this arena was compiled from a tile grid (`compileTileArena`). The client bakes its
   * floor from it; the sim never reads it — `obstacles` already carries the compiled solids.
   */
  readonly tiles?: TileGrid;
```

- [ ] **Step 5: Export from `packages/shared/src/index.ts`**

Extend line 326's type export with `TileGrid` (and `ArenaPalette` if it is not exported anywhere yet — grep first). Add after it:

```ts
export { TILE_SIZE, TILE_TABLE, isSolidTile, tileDefOf } from "./arena/tiles/tile-config.js";
export type {
  TileCollision,
  TileDef,
  TileHazard,
  TileId,
  TileShape,
  TileSurface,
} from "./arena/tiles/tile-config.js";
```

- [ ] **Step 6: Run the test and build**

Run: `npx vitest run packages/shared/src/arena/tiles/tile-config.test.ts && npm run build -w @motor-combat-moba/shared`
Expected: PASS, build clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/arena/tiles packages/shared/src/arena/types.ts packages/shared/src/index.ts
git commit -m "feat(arena): tile table and TileGrid type (TA1-TA13)"
```

---

### Task 2: `compileTileArena`

**Files:**
- Create: `packages/shared/src/arena/tiles/compile.ts`
- Create: `packages/shared/src/arena/tiles/compile.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: Task 1's `TILE_SIZE`, `TILE_TABLE`, `TileId`, `tileDefOf`, `TileGrid`.
- Produces: `interface TileArenaSource { id; rows: readonly string[]; ffaSpawns; teamASpawns; teamBSpawns; palette?; zone? }`, `compileTileArena(src: TileArenaSource): ArenaDef` (sets `tiles`, never `boundary`), `parseTileGrid(id: string, rows: readonly string[]): TileGrid`.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/arena/tiles/compile.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { Obstacle } from "../types.js";
import { compileTileArena, parseTileGrid, type TileArenaSource } from "./compile.js";
import { TILE_SIZE, isSolidTile } from "./tile-config.js";

const SPAWN = { x: 100, y: 100, angle: 0 };

function source(rows: readonly string[]): TileArenaSource {
  return { id: "test-arena", rows, ffaSpawns: [SPAWN], teamASpawns: [SPAWN], teamBSpawns: [SPAWN] };
}

/** How many obstacles cover each cell, and of which kind — the compile output rasterised back. */
function rasterise(obstacles: readonly Obstacle[], cols: number, rows: number) {
  const count = new Array<number>(cols * rows).fill(0);
  const kind = new Array<string>(cols * rows).fill("");
  for (const o of obstacles) {
    expect(o.x % TILE_SIZE).toBe(0);
    expect(o.y % TILE_SIZE).toBe(0);
    expect(o.w % TILE_SIZE).toBe(0);
    expect(o.h % TILE_SIZE).toBe(0);
    for (let r = o.y / TILE_SIZE; r < (o.y + o.h) / TILE_SIZE; r += 1) {
      for (let c = o.x / TILE_SIZE; c < (o.x + o.w) / TILE_SIZE; c += 1) {
        count[r * cols + c]! += 1;
        kind[r * cols + c] = o.kind ?? "solid";
      }
    }
  }
  return { count, kind };
}

const MIXED = [
  "##########",
  "#..^^....#",
  "#..^^.##.#",
  "#.....##.#",
  "  ^......#",
  "  ########",
];

describe("parseTileGrid", () => {
  it("reads one tile per character, row-major", () => {
    expect(parseTileGrid("a", ["#.", "^ "])).toEqual({
      cols: 2,
      rows: 2,
      cells: ["wall", "floor", "spike", "void"],
    });
  });

  it("throws on an unknown character, naming arena, row and column (TA17)", () => {
    expect(() => parseTileGrid("arena-x", ["##", "#?"])).toThrow(/arena-x.*row 1.*col 1.*"\?"/);
  });

  it("throws on ragged rows (TA17)", () => {
    expect(() => parseTileGrid("arena-x", ["###", "##"])).toThrow(/arena-x.*row 1/);
  });

  it("throws on an empty grid (TA17)", () => {
    expect(() => parseTileGrid("arena-x", [])).toThrow(/arena-x/);
    expect(() => parseTileGrid("arena-x", [""])).toThrow(/arena-x/);
  });
});

describe("compileTileArena", () => {
  it("sizes the arena from the grid and authors no polygon (TA14)", () => {
    const arena = compileTileArena(source(MIXED));
    expect(arena.width).toBe(10 * TILE_SIZE);
    expect(arena.height).toBe(6 * TILE_SIZE);
    expect(arena.boundary).toBeUndefined();
    expect(arena.tiles?.cols).toBe(10);
    expect(arena.tiles?.rows).toBe(6);
  });

  it("covers every solid cell exactly once and no floor cell (TA16)", () => {
    const arena = compileTileArena(source(MIXED));
    const grid = arena.tiles!;
    const { count, kind } = rasterise(arena.obstacles, grid.cols, grid.rows);
    grid.cells.forEach((id, i) => {
      expect(count[i], `cell ${i} (${id})`).toBe(isSolidTile(id) ? 1 : 0);
      if (id === "spike") expect(kind[i]).toBe("spike");
      if (id === "wall" || id === "void") expect(kind[i]).toBe("solid");
    });
  });

  it("merges wall and void together but never with spike (TA15)", () => {
    const arena = compileTileArena(source(["# ^", "# ^"]));
    expect(arena.obstacles).toEqual([
      { x: 0, y: 0, w: 2 * TILE_SIZE, h: 2 * TILE_SIZE },
      { x: 2 * TILE_SIZE, y: 0, w: TILE_SIZE, h: 2 * TILE_SIZE, kind: "spike" },
    ]);
  });

  it("emits no kind key at all on a plain solid", () => {
    const arena = compileTileArena(source(["#."]));
    expect(Object.keys(arena.obstacles[0]!)).toEqual(["x", "y", "w", "h"]);
  });

  it("is deterministic", () => {
    expect(compileTileArena(source(MIXED)).obstacles).toEqual(compileTileArena(source(MIXED)).obstacles);
  });

  it("passes spawns, palette and zone through", () => {
    const palette = { floor: "#111111", obstacle: "#222222", border: "#333333" };
    const zone = { x: 200, y: 120, radius: 50 };
    const arena = compileTileArena({ ...source(MIXED), palette, zone });
    expect(arena.palette).toEqual(palette);
    expect(arena.zone).toEqual(zone);
    expect(arena.ffaSpawns).toEqual([SPAWN]);
    expect(arena.id).toBe("test-arena");
  });

  it("leaves palette and zone absent when the source has none", () => {
    const arena = compileTileArena(source(MIXED));
    expect("palette" in arena).toBe(false);
    expect("zone" in arena).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/arena/tiles/compile.test.ts`
Expected: FAIL — cannot resolve `./compile.js`.

- [ ] **Step 3: Write `compile.ts`**

```ts
import type { ArenaDef, ArenaPalette, ArenaZone, Obstacle, Spawn, TileGrid } from "../types.js";
import { TILE_SIZE, TILE_TABLE, tileDefOf, type TileId } from "./tile-config.js";

/**
 * A tile arena as authored (spec TA5): one string per row, one character per tile, plus the things
 * that are points and circles rather than surfaces — spawns and the capture zone.
 */
export interface TileArenaSource {
  readonly id: string;
  readonly rows: readonly string[];
  readonly ffaSpawns: readonly Spawn[];
  readonly teamASpawns: readonly Spawn[];
  readonly teamBSpawns: readonly Spawn[];
  readonly palette?: ArenaPalette;
  readonly zone?: ArenaZone;
}

const TILE_BY_CHAR: ReadonlyMap<string, TileId> = new Map(
  (Object.keys(TILE_TABLE) as TileId[]).map((id) => [tileDefOf(id).char, id]),
);

/** Parse the authored rows into a grid, throwing with arena, row and column on bad input (TA17). */
export function parseTileGrid(id: string, rows: readonly string[]): TileGrid {
  const cols = rows[0]?.length ?? 0;
  if (rows.length === 0 || cols === 0) throw new Error(`Tile arena ${id}: the grid is empty`);
  const cells: TileId[] = [];
  rows.forEach((row, r) => {
    if (row.length !== cols) {
      throw new Error(`Tile arena ${id}: row ${r} is ${row.length} tiles wide, expected ${cols}`);
    }
    for (let c = 0; c < cols; c += 1) {
      const ch = row[c]!;
      const tile = TILE_BY_CHAR.get(ch);
      if (tile === undefined) {
        throw new Error(`Tile arena ${id}: row ${r}, col ${c} has unknown tile ${JSON.stringify(ch)}`);
      }
      cells.push(tile);
    }
  });
  return { cols, rows: rows.length, cells };
}

/**
 * What a solid cell merges with (TA15): `(collision, hazard)`. Wall and void are both plain solid and
 * merge together; a hazard is its own class so it can carry its `kind`. `null` is not solid.
 */
function classOf(id: TileId): string | null {
  const def = tileDefOf(id);
  if (def.collision !== "solid") return null;
  return def.hazard ?? "solid";
}

/**
 * Greedy rectangle merge (TA15): scan row-major; at the first unclaimed solid cell take the widest
 * run of its class to the right, then grow it downward while the next row's same span is that class
 * and unclaimed. Exact cover of the solid cells (TA16), and deterministic.
 */
function mergeSolids(grid: TileGrid): Obstacle[] {
  const { cols, rows, cells } = grid;
  const claimed = new Uint8Array(cols * rows);
  const free = (i: number, cls: string): boolean => claimed[i] === 0 && classOf(cells[i]!) === cls;
  const out: Obstacle[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const start = r * cols + c;
      const cls = classOf(cells[start]!);
      if (cls === null || claimed[start] !== 0) continue;
      let w = 1;
      while (c + w < cols && free(start + w, cls)) w += 1;
      let h = 1;
      grow: while (r + h < rows) {
        for (let k = 0; k < w; k += 1) if (!free((r + h) * cols + c + k, cls)) break grow;
        h += 1;
      }
      for (let dr = 0; dr < h; dr += 1) {
        for (let k = 0; k < w; k += 1) claimed[(r + dr) * cols + c + k] = 1;
      }
      const rect = { x: c * TILE_SIZE, y: r * TILE_SIZE, w: w * TILE_SIZE, h: h * TILE_SIZE };
      out.push(cls === "spike" ? { ...rect, kind: "spike" as const } : rect);
    }
  }
  return out;
}

/**
 * A tile grid as an ordinary `ArenaDef` (TA14–TA17). The sim, vision and shots read the compiled
 * `obstacles` exactly as they read a hand-written arena's; `tiles` is for the client's bake. Reads no
 * mode accessor, so it may run at module load.
 */
export function compileTileArena(src: TileArenaSource): ArenaDef {
  const tiles = parseTileGrid(src.id, src.rows);
  return {
    id: src.id,
    width: tiles.cols * TILE_SIZE,
    height: tiles.rows * TILE_SIZE,
    obstacles: mergeSolids(tiles),
    ffaSpawns: src.ffaSpawns,
    teamASpawns: src.teamASpawns,
    teamBSpawns: src.teamBSpawns,
    ...(src.palette ? { palette: src.palette } : {}),
    ...(src.zone ? { zone: src.zone } : {}),
    tiles,
  };
}
```

- [ ] **Step 4: Export** — in `packages/shared/src/index.ts` beside the Task 1 exports:

```ts
export { compileTileArena, parseTileGrid } from "./arena/tiles/compile.js";
export type { TileArenaSource } from "./arena/tiles/compile.js";
```

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run packages/shared/src/arena/tiles && npm run build -w @motor-combat-moba/shared`
Expected: PASS, build clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/arena/tiles packages/shared/src/index.ts
git commit -m "feat(arena): compile a tile grid into an ArenaDef (TA14-TA17)"
```

---

### Task 3: Playable rect, extent and planes for tile arenas

**Files:**
- Modify: `packages/shared/src/arena/bounds.ts`
- Modify: `packages/shared/src/arena/bounds.test.ts`
- Modify: `packages/shared/src/index.ts` (line 334: add `playableRectOf`, `playablePlanesOf`)

**Interfaces:**
- Consumes: `compileTileArena` (Task 2); `isSolidTile`, `TILE_SIZE` (Task 1); `planesOf` and the plane type from `packages/shared/src/sim/boundary.ts` (read the file for the type's exact exported name — `planner.ts` imports it as `BoundaryPlane`).
- Produces: `playableRectOf(arena: Pick<ArenaDef,"width"|"height"|"boundary"|"tiles">): { x: number; y: number; w: number; h: number }`; `playableExtentOf` handling `tiles`; `playablePlanesOf(arena: Pick<ArenaDef,"width"|"height"|"boundary"|"tiles">): BoundaryPlane[] | undefined`.

- [ ] **Step 1: Write the failing tests** — append to `packages/shared/src/arena/bounds.test.ts` (import `compileTileArena` from `./tiles/compile.js`, `TILE_SIZE` from `./tiles/tile-config.js`, `playableRectOf`/`playablePlanesOf` from `./bounds.js`, and `ARENA_02` from `./arena-02.js`):

```ts
describe("tile arenas (TA30, TA31)", () => {
  const SPAWN = { x: 120, y: 100, angle: 0 };
  const tile = compileTileArena({
    id: "t",
    rows: ["######", "##...#", "##...#", "######"],
    ffaSpawns: [SPAWN],
    teamASpawns: [SPAWN],
    teamBSpawns: [SPAWN],
  });

  it("measures the playable rect as the bounding box of the non-solid cells", () => {
    expect(playableRectOf(tile)).toEqual({ x: 2 * TILE_SIZE, y: TILE_SIZE, w: 3 * TILE_SIZE, h: 2 * TILE_SIZE });
    expect(playableExtentOf(tile)).toEqual({ width: 3 * TILE_SIZE, height: 2 * TILE_SIZE });
  });

  it("gives the bot the four planes of that rect, every normal pointing inward", () => {
    const planes = playablePlanesOf(tile)!;
    expect(planes).toHaveLength(4);
    const cx = 3.5 * TILE_SIZE;
    const cy = 2 * TILE_SIZE;
    for (const p of planes) expect(p.nx * cx + p.ny * cy - p.d).toBeGreaterThan(0);
    const onSomePlane = (x: number, y: number) =>
      planes.some((p) => Math.abs(p.nx * x + p.ny * y - p.d) < 1e-9);
    expect(onSomePlane(2 * TILE_SIZE, cy)).toBe(true);
    expect(onSomePlane(5 * TILE_SIZE, cy)).toBe(true);
    expect(onSomePlane(cx, TILE_SIZE)).toBe(true);
    expect(onSomePlane(cx, 3 * TILE_SIZE)).toBe(true);
  });

  it("keeps a plain rectangle plane-less, and a polygon arena on its own planes", () => {
    expect(playablePlanesOf({ width: 100, height: 50 })).toBeUndefined();
    expect(playablePlanesOf(ARENA_02)).toEqual(boundsOf(ARENA_02).planes);
    expect(playableRectOf({ width: 100, height: 50 })).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
});
```

(`ARENA_02` authors a `boundary`; if it does not, use `ARENA_03`, which does.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/shared/src/arena/bounds.test.ts`
Expected: FAIL — `playableRectOf` is not exported.

- [ ] **Step 3: Implement in `bounds.ts`** — add imports and replace `playableExtentOf`:

```ts
import { planesOf, type BoundaryPlane } from "../sim/boundary.js";
import { isSolidTile, TILE_SIZE } from "./tiles/tile-config.js";

type PlayableSource = Pick<ArenaDef, "width" | "height" | "boundary" | "tiles">;

/**
 * The PLAYABLE floor's bounding rectangle in world units (TA30). A polygon arena answers its
 * polygon's box; a tile arena the box of its non-solid cells — its grid frame includes the wall band,
 * the same frame-vs-floor mistake the octagon once caused; a plain arena its frame.
 */
export function playableRectOf(arena: PlayableSource): { x: number; y: number; w: number; h: number } {
  if (arena.boundary !== undefined && arena.boundary.length > 0) {
    const xs = arena.boundary.map((v) => v.x);
    const ys = arena.boundary.map((v) => v.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  const grid = arena.tiles;
  if (grid !== undefined) {
    let minC = Infinity;
    let minR = Infinity;
    let maxC = -Infinity;
    let maxR = -Infinity;
    grid.cells.forEach((id, i) => {
      if (isSolidTile(id)) return;
      const c = i % grid.cols;
      const r = Math.floor(i / grid.cols);
      minC = Math.min(minC, c);
      minR = Math.min(minR, r);
      maxC = Math.max(maxC, c);
      maxR = Math.max(maxR, r);
    });
    if (minC !== Infinity) {
      return {
        x: minC * TILE_SIZE,
        y: minR * TILE_SIZE,
        w: (maxC - minC + 1) * TILE_SIZE,
        h: (maxR - minR + 1) * TILE_SIZE,
      };
    }
  }
  return { x: 0, y: 0, w: arena.width, h: arena.height };
}

// (keep playableExtentOf's existing doc comment, adding one sentence: a tile arena answers the box
// of its non-solid cells, TA30)
export function playableExtentOf(arena: PlayableSource): { width: number; height: number } {
  const rect = playableRectOf(arena);
  return { width: rect.w, height: rect.h };
}

/**
 * The planes a bot should treat as the playable edge (TA31): the polygon's own, or for a tile arena
 * the four planes of its floor rect (wound clockwise in screen coordinates, so `planesOf` points them
 * inward), or `undefined` for a plain rectangle — which keeps every caller on its `rectPlanes`
 * fallback exactly as before.
 */
export function playablePlanesOf(arena: PlayableSource): BoundaryPlane[] | undefined {
  if (arena.boundary !== undefined) return boundsOf(arena).planes;
  if (arena.tiles === undefined) return undefined;
  const { x, y, w, h } = playableRectOf(arena);
  return planesOf([
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]);
}
```

If `planesOf` is already imported in `bounds.ts`, merge the imports. If `planesOf` returns a `readonly` array, match the return type to it.

- [ ] **Step 4: Export** `playableRectOf, playablePlanesOf` from `index.ts` beside `boundsOf, playableExtentOf`.

- [ ] **Step 5: Run and build**

Run: `npx vitest run packages/shared/src/arena && npm run build -w @motor-combat-moba/shared`
Expected: PASS — the existing `playableExtentOf(ARENA_01)` expectation of 1132 × 612 still passes; arena-01 is not converted until Task 5.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/arena/bounds.ts packages/shared/src/arena/bounds.test.ts packages/shared/src/index.ts
git commit -m "feat(arena): playable rect, extent and planes for tile arenas (TA30, TA31)"
```

---

### Task 4: Collision risk tests (TA27, TA28) — a gate

**Files:**
- Create: `packages/shared/src/arena/tiles/tile-collision.test.ts`

**Interfaces:**
- Consumes: `compileTileArena`, `TILE_SIZE`; `resolveWorld`, `obbCorners` from `sim/collide.ts` (read `resolveWorld`'s signature at `collide.ts:122`: `(body, others, obstacles, bounds, selfRamDefence)`); `boundsOf`; `installMode`, `modeConfigOf`, `DEFAULT_GAME_MODE`; `DRIVE_CONFIG`; `TICK_RATE_HZ`; `SimBody`.
- Produces: nothing later tasks use. **This task is a gate**: if a correctly written test fails, STOP, do not touch `collide.ts`, and report the measured numbers.

- [ ] **Step 1: Write the tests**

```ts
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
  return compileTileArena({ id: "t", rows, ffaSpawns: [SPAWN], teamASpawns: [SPAWN], teamBSpawns: [SPAWN] });
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
```

Velocity is re-imposed after each tick (a held throttle), and both measurements are read right after resolution — where a seam's sideways push, or an embedding, would show.

- [ ] **Step 2: Run**

Run: `npx vitest run packages/shared/src/arena/tiles/tile-collision.test.ts`
Expected: PASS. If something fails, first check the test is right (the car reaches the wall; `resolveWorld`'s argument order; `obbCorners` takes a centre-based `Obb`). If a correct test still fails: **STOP. Do not modify collision code.** Report the failing case and the measured penetration or speed ratio, and halt the plan.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/arena/tiles/tile-collision.test.ts
git commit -m "test(arena): tile walls neither embed nor snag a car (TA27, TA28)"
```

---

### Task 5: Convert arena-01, and the arena rules for tile arenas

**Files:**
- Modify: `packages/shared/src/arena/arena-01.ts` (rewrite)
- Modify: `packages/shared/src/arena/arena-01.test.ts` (rewrite)
- Modify: `packages/shared/src/arena/arena.test.ts` (tile rules TA18–TA20, exemptions)
- Modify: `packages/shared/src/arena/bounds.test.ts` (arena-01 extent expectation)
- Modify: `packages/shared/src/config/spike-config.ts` (doc of `depth`)
- Modify: `packages/client/src/dev/FxPreviewScene.ts:94`
- Delete: `packages/client/public/art/arenas/arena-01/floor.png`, and the `arena.arena-01.floor` row in `packages/client/public/art/manifest.json`
- Modify: any other test that breaks for an octagon-specific reason (Step 7)

**Interfaces:**
- Consumes: `compileTileArena`, `TILE_SIZE`, `isSolidTile`, `playableRectOf`.
- Produces: `ARENA_01: ArenaDef` with `tiles` (32 × 18), 14 spike obstacles, no `boundary`, team spawns at y 200/360/520.

- [ ] **Step 1: Rewrite `arena-01.ts`**

```ts
import type { ArenaDef } from "./types.js";
import { compileTileArena } from "./tiles/compile.js";

/**
 * The arena the game plays: a walled rectangle with fourteen spike runs set into the walls, small
 * enough that the whole of it is on screen. Authored as tiles since 2026-10-09 (spec tile arenas,
 * TA9): `#` wall, `^` spike, `.` floor — the walls and spikes are compiled into `obstacles`.
 *
 * 1280x720 (32 x 18 tiles) is not a taste call — it is the client's logical canvas, so at
 * `CAMERA_CONFIG.zoom` of 1 the camera covers the arena exactly and every car is always visible.
 * Rescaling this arena without rescaling the zoom to match breaks that.
 *
 * The playable floor is x 80..1200, y 40..680 (1120 x 640). The spike runs sit in the innermost wall
 * row, so they take no floor; they are the old strips' spans rounded to the 40 u grid and are
 * mirrored about both centre lines. The corners are square — the octagon's chamfers wait for
 * diagonal tiles (TA2).
 *
 * The spawn tables are symmetric to the unit, because with no cover to duck behind, position is the
 * only advantage a spawn can confer.
 */
const EDGE = "###^^^^^###^^^####^^^###^^^^^###";
const PLAIN = "##" + ".".repeat(28) + "##";
const SPIKED = "#^" + ".".repeat(28) + "^#";

export const ARENA_01: ArenaDef = compileTileArena({
  id: "arena-01",
  rows: [
    EDGE, //    0
    PLAIN, //   1
    PLAIN, //   2
    SPIKED, //  3
    SPIKED, //  4
    PLAIN, //   5
    PLAIN, //   6
    PLAIN, //   7
    SPIKED, //  8
    SPIKED, //  9
    PLAIN, //  10
    PLAIN, //  11
    PLAIN, //  12
    SPIKED, // 13
    SPIKED, // 14
    PLAIN, //  15
    PLAIN, //  16
    EDGE, //   17
  ],
  /** What the procedural fallback paints until tile art is imported, and the background beneath. */
  palette: { floor: "#3b4747", obstacle: "#4a5568", border: "#2d3436" },
  /**
   * The four corners and the midpoint of each long wall. Corner cars face across the arena and the
   * two midpoint cars face each other, so wherever `assignSpawns` puts you, you open the match looking
   * at the fight. Every spawn sits at least 140 u off every wall.
   */
  ffaSpawns: [
    { x: 200, y: 180, angle: 0 },
    { x: 1080, y: 180, angle: Math.PI },
    { x: 200, y: 540, angle: 0 },
    { x: 1080, y: 540, angle: Math.PI },
    { x: 640, y: 180, angle: Math.PI / 2 },
    { x: 640, y: 540, angle: -Math.PI / 2 },
  ],
  /**
   * A line down each side, facing the other team. The y values divide the playable height (40..680)
   * into four equal parts, so the gap between two team-mates equals the gap from the end car to the
   * wall — no seat on the line is more exposed than another.
   */
  teamASpawns: [
    { x: 200, y: 200, angle: 0 },
    { x: 200, y: 360, angle: 0 },
    { x: 200, y: 520, angle: 0 },
  ],
  teamBSpawns: [
    { x: 1080, y: 200, angle: Math.PI },
    { x: 1080, y: 360, angle: Math.PI },
    { x: 1080, y: 520, angle: Math.PI },
  ],
});
```

All three row strings are 32 characters. A consumer that relied on `ARENA_01` being `as const` (e.g. reading `ARENA_01.palette.floor` with no `?`) is fixed at the consumer, not by re-narrowing the type.

- [ ] **Step 2: Rewrite `arena-01.test.ts`**

Replace the "ARENA_01 boundary" and "ARENA_01 spike strips" describes with grid-based ones, and re-base the spawn tests on the floor rect:

```ts
import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { ARENA_01 } from "./arena-01.js";
import { playableRectOf } from "./bounds.js";
import { TILE_SIZE } from "./tiles/tile-config.js";
import type { Spawn } from "./types.js";

const spikes = ARENA_01.obstacles.filter((o) => o.kind === "spike");
const CENTRE_X = ARENA_01.width / 2;
const CENTRE_Y = ARENA_01.height / 2;
const floor = playableRectOf(ARENA_01);

/** Gaps between consecutive values, used to prove even spacing without naming the spacing. */
function gaps(values: readonly number[]): number[] {
  return values.slice(1).map((v, i) => v - values[i]!);
}

function sortedY(spawns: readonly Spawn[]): number[] {
  return spawns.map((s) => s.y).sort((a, b) => a - b);
}

describe("ARENA_01 grid", () => {
  it("is a 32 x 18 tile arena with no polygon", () => {
    expect(ARENA_01.tiles?.cols).toBe(32);
    expect(ARENA_01.tiles?.rows).toBe(18);
    expect(ARENA_01.boundary).toBeUndefined();
  });

  it("plays on the 1120 x 640 floor inside a 2-tile side band and a 1-tile end band", () => {
    expect(floor).toEqual({ x: 2 * TILE_SIZE, y: TILE_SIZE, w: 28 * TILE_SIZE, h: 16 * TILE_SIZE });
  });

  it("is mirror-symmetric about both centre lines, tile for tile", () => {
    const g = ARENA_01.tiles!;
    const at = (c: number, r: number) => g.cells[r * g.cols + c];
    for (let r = 0; r < g.rows; r += 1) {
      for (let c = 0; c < g.cols; c += 1) {
        expect(at(c, r)).toBe(at(g.cols - 1 - c, r));
        expect(at(c, r)).toBe(at(c, g.rows - 1 - r));
      }
    }
  });
});

describe("ARENA_01 spike runs", () => {
  const top = spikes.filter((s) => s.y === 0);
  const bottom = spikes.filter((s) => s.y + s.h === ARENA_01.height);
  const left = spikes.filter((s) => s.x === TILE_SIZE && s.w === TILE_SIZE);
  const right = spikes.filter((s) => s.x === 30 * TILE_SIZE && s.w === TILE_SIZE);

  it("has fourteen of them, each on exactly one wall", () => {
    expect(spikes).toHaveLength(14);
    expect(top).toHaveLength(4);
    expect(bottom).toHaveLength(4);
    expect(left).toHaveLength(3);
    expect(right).toHaveLength(3);
  });

  it("is one tile deep", () => {
    for (const s of spikes) expect(Math.min(s.w, s.h)).toBe(TILE_SIZE);
  });
});

describe("ARENA_01 shape", () => {
  it("is 1280x720, the client's logical canvas", () => {
    // Not a taste call — at `CAMERA_CONFIG.zoom` of 1 the camera covers exactly this rect.
    expect(ARENA_01.width).toBe(1280);
    expect(ARENA_01.height).toBe(720);
  });
});
```

Then carry over, unchanged, the existing describes "ARENA_01 team spawns" and "ARENA_01 FFA spawns", except: in "leaves an equal gap between each car and its neighbour and the playable edge", replace the `boundaryYs`/`topY`/`bottomY` lines with `const topY = floor.y; const bottomY = floor.y + floor.h;`. Carry over "ARENA_01 spawns" → "clears every spike strip by more than a car diagonal" unchanged, and replace "puts every spawn inside the polygon" with:

```ts
  it("puts every spawn on the floor", () => {
    for (const s of all) {
      expect(s.x).toBeGreaterThan(floor.x);
      expect(s.x).toBeLessThan(floor.x + floor.w);
      expect(s.y).toBeGreaterThan(floor.y);
      expect(s.y).toBeLessThan(floor.y + floor.h);
    }
  });
```

Remove imports that become unused (`SPIKE_CONFIG`, `pointOutsideBounds`, `boundsOf`).

- [ ] **Step 3: Tile rules in `arena.test.ts`**

Inside `describe.each(entries)`:
1. As the first line of "keeps every ordinary obstacle at least a car diagonal clear of the arena boundary", "sits every spike strip flush against a boundary plane, exactly one depth deep" and "leaves no corridor between obstacles too narrow for a car", add:
   `if (arena.tiles) return; // replaced for tile arenas by the grid rules below (TA18, TA19)`
2. Add (importing `isSolidTile` and `TILE_SIZE` from `./tiles/tile-config.js`):

```ts
  it("leaves no tile passage narrower than a car (TA18)", () => {
    const g = arena.tiles;
    if (!g) return;
    const open = (c: number, r: number) =>
      c >= 0 && r >= 0 && c < g.cols && r < g.rows && !isSolidTile(g.cells[r * g.cols + c]!);
    const block = (c: number, r: number) => open(c, r) && open(c + 1, r) && open(c, r + 1) && open(c + 1, r + 1);
    const pinched: string[] = [];
    for (let r = 0; r < g.rows; r += 1) {
      for (let c = 0; c < g.cols; c += 1) {
        if (!open(c, r)) continue;
        if (!(block(c, r) || block(c - 1, r) || block(c, r - 1) || block(c - 1, r - 1))) {
          pinched.push(`floor at col ${c}, row ${r} is in no 2x2 open block`);
        }
      }
    }
    expect(pinched).toEqual([]);
  });

  it("lets every spike tile be touched from somewhere (TA19)", () => {
    const g = arena.tiles;
    if (!g) return;
    const untouchable: string[] = [];
    g.cells.forEach((id, i) => {
      if (id !== "spike") return;
      const c = i % g.cols;
      const r = Math.floor(i / g.cols);
      const reachable = [
        [c, r - 1],
        [c + 1, r],
        [c, r + 1],
        [c - 1, r],
      ].some(([nc, nr]) => nc! >= 0 && nr! >= 0 && nc! < g.cols && nr! < g.rows && !isSolidTile(g.cells[nr! * g.cols + nc!]!));
      if (!reachable) untouchable.push(`spike at col ${c}, row ${r}`);
    });
    expect(untouchable).toEqual([]);
  });

  it("puts every spawn on a floor tile (TA20)", () => {
    const g = arena.tiles;
    if (!g) return;
    for (const s of [...arena.ffaSpawns, ...arena.teamASpawns, ...arena.teamBSpawns]) {
      const id = g.cells[Math.floor(s.y / TILE_SIZE) * g.cols + Math.floor(s.x / TILE_SIZE)];
      expect(id, `spawn ${s.x},${s.y}`).toBe("floor");
    }
  });
```

- [ ] **Step 4: `bounds.test.ts`** — change the `playableExtentOf(ARENA_01)` expectation to `{ width: 1120, height: 640 }`; the next line (`.not.toBe(ARENA_01.width)`) still holds. Any assertion there that `ARENA_01` has `planes` moves to `ARENA_02`/`ARENA_03`.

- [ ] **Step 5: `spike-config.ts`** — reword the `depth` doc: it is the depth of the strips the hand-written arenas (`arena-02`, `arena-03`) author; a tile arena's spikes are one `TILE_SIZE` deep (TA19). Value stays 20.

- [ ] **Step 6: Client and art**
  - `packages/client/src/dev/FxPreviewScene.ts:94`: `ARENA_01.palette.floor` → `ARENA_01.palette?.floor ?? "#3b4747"`.
  - Delete `packages/client/public/art/arenas/arena-01/floor.png` (and the then-empty folder) with `git rm`, and remove the `"arena.arena-01.floor"` row from `packages/client/public/art/manifest.json`, keeping the file's formatting otherwise byte-identical.
  - Client tests that use the string `"arena-01"` only as an id for a pure key function stay as they are.

- [ ] **Step 7: Build and run the full suite**

Run: `npm run build && npm test 2>&1 | tail -150`
Compare with the Task 0 baseline. For each NEW failure:
- Encoded octagon geometry (chamfers, `boundary!`, 74/54 bands, 20 u spikes on arena-01, extent 1132): update it to the tile geometry, or repoint it at `ARENA_02`/`ARENA_03` when it was testing polygon behaviour rather than arena-01.
- A bot or balance behaviour number moved (`controller.test.ts`, `tiers.test.ts`, `planner*.test.ts`, `movement.test.ts`, `balance/*.test.ts`): do NOT retune `BOT_PROFILES` or loosen a bar. If it is a coordinate that is now inside a wall, move it onto the new floor. If it is a behaviour figure, leave it red and list it in the report with before/after values.
- `scripts/manual-page.test.mjs` asking for `npm run build:manual`: expected; Task 11 rebuilds the guide. Note and continue.

- [ ] **Step 8: Commit**

```bash
git add -A packages/shared packages/client/public/art packages/client/src/dev/FxPreviewScene.ts
git commit -m "feat(arena): author arena-01 as tiles (TA9, TA18-TA20)"
```

---

### Task 6: The bot sees a tile arena's floor edge

**Files:**
- Modify: `packages/server/src/bot/view.ts` (~line 101)
- Modify: `packages/server/src/config/bot-profiles.ts:826` (`BOT_BRAIN_VERSION` "6.4.0" → "6.5.0")
- Test: the test file that covers `buildBotView` (find it with `grep -rln buildBotView packages/server/src --include=*.test.ts`)

**Interfaces:**
- Consumes: `playablePlanesOf` (Task 3), `ARENA_01` (Task 5).

- [ ] **Step 1: Write the failing test** — copy the setup of the nearest existing `buildBotView` test that runs on `arena-01`, then assert:

```ts
expect(view.arena.planes).toEqual(playablePlanesOf(ARENA_01));
expect(view.arena.planes).toHaveLength(4);
```

- [ ] **Step 2: Run to verify it fails** — `planes` is `undefined` for a tile arena today.

Run: `npm run build -w @motor-combat-moba/shared && npx vitest run <that test file>`

- [ ] **Step 3: Implement** — in `view.ts` replace `planes: boundsOf(arena).planes,` with `planes: playablePlanesOf(arena),`, and update the comment above it: the view carries the playable edge's planes — the polygon's, or a tile arena's floor rect (TA31) — and is absent only for a plain rectangle, which is what lets `wallAhead` fall back to `rectPlanes`. Import `playablePlanesOf` from `@motor-combat-moba/shared`; drop `boundsOf` from the import if unused.

- [ ] **Step 4: Bump `BOT_BRAIN_VERSION`** to `"6.5.0"`, following the changelog style of the lines above it in `bot-profiles.ts`, with the reason: tile arenas hand the bot their floor-rect planes (TA31).

- [ ] **Step 5: Run** `npx vitest run packages/server/src/bot` — the new test passes; report any change in the remaining bot failures versus the Task 0/Task 5 lists.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/bot packages/server/src/config/bot-profiles.ts
git commit -m "feat(bot): tile arenas give the bot their floor-rect planes (TA31)"
```

---

### Task 7: The bake plan (client, pure)

**Files:**
- Create: `packages/client/src/scenes/tile-bake.ts`
- Create: `packages/client/src/scenes/tile-bake.test.ts`

**Interfaces:**
- Consumes: `TileGrid`, `TileId`, `tileDefOf`, `isSolidTile` from `@motor-combat-moba/shared`.
- Produces: `TILE_BAKE_SCALE` (2), `TILE_BAKE_MAX_CHUNK_PX` (2048), `SPIKE_TEETH_ART` ("spike-teeth"), `type TileRotation = 0 | 90 | 180 | 270`, `interface TileStamp { art; col; row; rotation }`, `tileBakePlan(grid: TileGrid): TileStamp[]`, `interface BakeChunk { col; row; cols; rows }` (in tiles), `bakeChunks(cols, rows, tilePx, maxPx): BakeChunk[]`, `type ToothTriangle = [number×6]`, `fallbackTeeth(rotation, x, y, size): ToothTriangle[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { TileGrid, TileId } from "@motor-combat-moba/shared";
import { bakeChunks, fallbackTeeth, tileBakePlan, type TileStamp } from "./tile-bake.js";

function grid(rows: string[]): TileGrid {
  const map: Record<string, TileId> = { ".": "floor", "#": "wall", "^": "spike", " ": "void" };
  return { cols: rows[0]!.length, rows: rows.length, cells: rows.flatMap((r) => [...r].map((ch) => map[ch]!)) };
}
const teeth = (plan: TileStamp[]) => plan.filter((s) => s.art === "spike-teeth");

describe("tileBakePlan (TA22)", () => {
  it("stamps one base per cell with art, and nothing for void", () => {
    expect(tileBakePlan(grid(["#. "]))).toEqual([
      { art: "wall", col: 0, row: 0, rotation: 0 },
      { art: "floor", col: 1, row: 0, rotation: 0 },
    ]);
  });

  it("gives a mid-arena spike pillar teeth on all four sides", () => {
    const plan = tileBakePlan(grid(["...", ".^.", "..."]));
    expect(teeth(plan).map((s) => s.rotation).sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    expect(teeth(plan).every((s) => s.col === 1 && s.row === 1)).toBe(true);
  });

  it("gives a wall-row spike teeth only on its floor side", () => {
    expect(teeth(tileBakePlan(grid(["#^#", "..."])))).toEqual([
      { art: "spike-teeth", col: 1, row: 0, rotation: 180 },
    ]);
  });

  it("puts no teeth on a grid edge or against void", () => {
    expect(teeth(tileBakePlan(grid([" ^ "])))).toEqual([]);
  });

  it("stamps every base before any teeth", () => {
    const plan = tileBakePlan(grid(["...", ".^.", "..."]));
    const firstTooth = plan.findIndex((s) => s.art === "spike-teeth");
    expect(firstTooth).toBe(9);
    expect(plan.slice(firstTooth).every((s) => s.art === "spike-teeth")).toBe(true);
  });
});

describe("bakeChunks (TA23)", () => {
  it("splits arena-01 (32 x 18 at 80 px) into two whole-tile chunks", () => {
    expect(bakeChunks(32, 18, 80, 2048)).toEqual([
      { col: 0, row: 0, cols: 25, rows: 18 },
      { col: 25, row: 0, cols: 7, rows: 18 },
    ]);
  });

  it("covers the grid exactly with chunks no larger than the cap", () => {
    const chunks = bakeChunks(60, 70, 80, 2048);
    let area = 0;
    for (const c of chunks) {
      expect(c.cols * 80).toBeLessThanOrEqual(2048);
      expect(c.rows * 80).toBeLessThanOrEqual(2048);
      area += c.cols * c.rows;
    }
    expect(area).toBe(60 * 70);
  });
});

describe("fallbackTeeth", () => {
  it("keeps every tooth inside its own tile", () => {
    for (const rot of [0, 90, 180, 270] as const) {
      const tris = fallbackTeeth(rot, 100, 200, 40);
      expect(tris.length).toBeGreaterThan(0);
      for (const t of tris) {
        for (let i = 0; i < 6; i += 2) {
          expect(t[i]!).toBeGreaterThanOrEqual(100);
          expect(t[i]!).toBeLessThanOrEqual(140);
          expect(t[i + 1]!).toBeGreaterThanOrEqual(200);
          expect(t[i + 1]!).toBeLessThanOrEqual(240);
        }
      }
    }
  });

  it("puts each point on the open edge", () => {
    for (const t of fallbackTeeth(0, 100, 200, 40)) expect(t[5]).toBe(200);
    for (const t of fallbackTeeth(90, 100, 200, 40)) expect(t[4]).toBe(140);
    for (const t of fallbackTeeth(180, 100, 200, 40)) expect(t[5]).toBe(240);
    for (const t of fallbackTeeth(270, 100, 200, 40)) expect(t[4]).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/client/src/scenes/tile-bake.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `tile-bake.ts`**

```ts
import { isSolidTile, tileDefOf, type TileGrid } from "@motor-combat-moba/shared";

/**
 * How a tile arena's floor is baked (spec tile arenas, TA22–TA25). Pure, so it is tested in node;
 * `ArenaScene.bakeTileFloor` only executes the plan into render textures.
 */

/** Baked pixels per world unit: tile art is 80 px for a 40 u tile (TA4). */
export const TILE_BAKE_SCALE = 2;
/** Largest chunk side, in px — a safe texture size on every WebGL target (TA23). */
export const TILE_BAKE_MAX_CHUNK_PX = 2048;
/** The edge overlay a spike tile wears on each side that borders open floor (TA6). */
export const SPIKE_TEETH_ART = "spike-teeth";

export type TileRotation = 0 | 90 | 180 | 270;

export interface TileStamp {
  readonly art: string;
  readonly col: number;
  readonly row: number;
  /** Clockwise degrees. Teeth art is authored for the TOP edge; 90 right, 180 bottom, 270 left. */
  readonly rotation: TileRotation;
}

/** Edge neighbours in rotation order: top, right, bottom, left. */
const EDGES: ReadonlyArray<readonly [number, number, TileRotation]> = [
  [0, -1, 0],
  [1, 0, 90],
  [0, 1, 180],
  [-1, 0, 270],
];

/** Every stamp the bake draws, bases first, then teeth (TA22). */
export function tileBakePlan(grid: TileGrid): TileStamp[] {
  const bases: TileStamp[] = [];
  const teeth: TileStamp[] = [];
  const { cols, rows, cells } = grid;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const def = tileDefOf(cells[row * cols + col]!);
      if (def.art !== null) bases.push({ art: def.art, col, row, rotation: 0 });
      if (def.hazard !== "spike") continue;
      for (const [dc, dr, rotation] of EDGES) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (isSolidTile(cells[nr * cols + nc]!)) continue;
        teeth.push({ art: SPIKE_TEETH_ART, col, row, rotation });
      }
    }
  }
  return [...bases, ...teeth];
}

/** A chunk of the bake, in tiles. */
export interface BakeChunk {
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
}

/** Split the grid into whole-tile chunks no larger than `maxPx` a side (TA23). */
export function bakeChunks(cols: number, rows: number, tilePx: number, maxPx: number): BakeChunk[] {
  const step = Math.max(1, Math.floor(maxPx / tilePx));
  const out: BakeChunk[] = [];
  for (let row = 0; row < rows; row += step) {
    for (let col = 0; col < cols; col += step) {
      out.push({ col, row, cols: Math.min(step, cols - col), rows: Math.min(step, rows - row) });
    }
  }
  return out;
}

export type ToothTriangle = [number, number, number, number, number, number];

/** Teeth per tile edge in the procedural fallback, and how far into the tile their bases sit. */
const FALLBACK_TEETH = 4;
const FALLBACK_DEPTH = 0.45;

/**
 * The procedural teeth for one edge of the tile whose top-left is `(x, y)` (TA25): bases inside the
 * tile, points ON the open edge, never past it — the tile is the hitbox. Each triangle is base, base,
 * point, the order `Graphics.fillTriangle` takes.
 */
export function fallbackTeeth(rotation: TileRotation, x: number, y: number, size: number): ToothTriangle[] {
  const width = size / FALLBACK_TEETH;
  const depth = size * FALLBACK_DEPTH;
  const out: ToothTriangle[] = [];
  for (let i = 0; i < FALLBACK_TEETH; i += 1) {
    const a = i * width;
    const b = a + width;
    const m = a + width / 2;
    if (rotation === 0) out.push([x + a, y + depth, x + b, y + depth, x + m, y]);
    else if (rotation === 90) out.push([x + size - depth, y + a, x + size - depth, y + b, x + size, y + m]);
    else if (rotation === 180) out.push([x + a, y + size - depth, x + b, y + size - depth, x + m, y + size]);
    else out.push([x + depth, y + a, x + depth, y + b, x, y + m]);
  }
  return out;
}
```

- [ ] **Step 4: Run** `npx vitest run packages/client/src/scenes/tile-bake.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/scenes/tile-bake.ts packages/client/src/scenes/tile-bake.test.ts
git commit -m "feat(client): tile bake plan, chunks and fallback teeth (TA22, TA23, TA25)"
```

---

### Task 8: Tile art keys and the texture-or-fallback decision

**Files:**
- Modify: `packages/client/src/assets/asset-keys.ts` (add `tileArtKey`)
- Modify: `packages/client/src/assets/asset-keys.test.ts`
- Create: `packages/client/src/assets/tile-art.ts`
- Create: `packages/client/src/assets/tile-art.test.ts`

**Interfaces:**
- Consumes: `FloorTextureLookup` (`./arena-floor.js`); `ArenaColors` and `SPIKE_STRIP_COLOR` (`../scenes/arena-visual.js` — read `ArenaColors` at line ~36 for its exact fields); `SPIKE_TEETH_ART` (Task 7).
- Produces: `tileArtKey(artId: string): string`; `type TileDraw = { kind: "texture"; key: string } | { kind: "fill"; color: number } | { kind: "teeth" }`; `resolveTileDraw(textures: FloorTextureLookup, art: string, colors: ArenaColors): TileDraw`.

- [ ] **Step 1: Failing tests**

In `asset-keys.test.ts` (import `tileArtKey`):

```ts
  it("keys tile art in the never-pruned common arena namespace", () => {
    expect(tileArtKey("floor")).toBe("arena.common.tile.floor");
    expect(shouldLoadAssetKey(tileArtKey("spike-teeth"), ["arena-02"])).toBe(true);
  });
```

`tile-art.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SPIKE_STRIP_COLOR, type ArenaColors } from "../scenes/arena-visual.js";
import { resolveTileDraw } from "./tile-art.js";

const colors = { floor: 0x111111, obstacle: 0x222222, border: 0x333333 } as ArenaColors;
const none = { exists: () => false };
const all = { exists: () => true };

describe("resolveTileDraw (TA25)", () => {
  it("draws the texture when it loaded", () => {
    expect(resolveTileDraw(all, "wall", colors)).toEqual({ kind: "texture", key: "arena.common.tile.wall" });
  });

  it("falls back to the palette when it did not", () => {
    expect(resolveTileDraw(none, "floor", colors)).toEqual({ kind: "fill", color: 0x111111 });
    expect(resolveTileDraw(none, "wall", colors)).toEqual({ kind: "fill", color: 0x222222 });
    expect(resolveTileDraw(none, "spike", colors)).toEqual({ kind: "fill", color: SPIKE_STRIP_COLOR });
    expect(resolveTileDraw(none, "spike-teeth", colors)).toEqual({ kind: "teeth" });
  });

  it("falls back to the obstacle colour for an art id it does not know", () => {
    expect(resolveTileDraw(none, "mystery", colors)).toEqual({ kind: "fill", color: 0x222222 });
  });
});
```

(If `ArenaColors` has more fields, add them to `colors` rather than casting away a real mismatch.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run packages/client/src/assets`

- [ ] **Step 3: Implement**

In `asset-keys.ts`, after `arenaFloorKey`:

```ts
/**
 * The manifest key for one tile type's art (spec tile arenas, §5.1). In the `arena.common.*`
 * namespace, which is never pruned, because every tile arena shares the same tile art.
 */
export function tileArtKey(artId: string): string {
  return `arena.${ARENA_ART_COMMON}.tile.${artId}`;
}
```

`tile-art.ts`:

```ts
import { SPIKE_STRIP_COLOR, type ArenaColors } from "../scenes/arena-visual.js";
import { SPIKE_TEETH_ART } from "../scenes/tile-bake.js";
import type { FloorTextureLookup } from "./arena-floor.js";
import { tileArtKey } from "./asset-keys.js";

/** How one stamp of the tile bake is drawn: its art, or the procedural stand-in (TA25). */
export type TileDraw =
  | { readonly kind: "texture"; readonly key: string }
  | { readonly kind: "fill"; readonly color: number }
  | { readonly kind: "teeth" };

/**
 * Texture when the tile art loaded, procedural fallback when it did not — the AS23 property for
 * tiles: a missing PNG or a bad manifest row is never a black floor. Pure, like `resolveArenaFloor`,
 * so the scene has nothing left to get wrong but calling it.
 */
export function resolveTileDraw(textures: FloorTextureLookup, art: string, colors: ArenaColors): TileDraw {
  const key = tileArtKey(art);
  if (textures.exists(key)) return { kind: "texture", key };
  if (art === SPIKE_TEETH_ART) return { kind: "teeth" };
  if (art === "floor") return { kind: "fill", color: colors.floor };
  if (art === "spike") return { kind: "fill", color: SPIKE_STRIP_COLOR };
  return { kind: "fill", color: colors.obstacle };
}
```

If `arena-visual.ts` turns out to import from `assets/` in a way that makes this a cycle the build rejects, break it by passing the spike colour in from the caller instead; otherwise keep the straight import.

- [ ] **Step 4: Run** `npx vitest run packages/client/src/assets packages/client/src/scenes/tile-bake.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/assets
git commit -m "feat(client): tile art keys and texture-or-fallback resolution (TA25)"
```

---

### Task 9: Bake the tile floor in `ArenaScene`

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`drawArena` ~1482, `applyEnvironment` ~1569, `redrawArenaGraphics` ~1626, the `splitCameras` ignore list ~1802, teardown ~1960, field declarations ~843–860)
- Modify: `packages/client/src/scenes/arena-visual.ts` (`arenaDecoration`)
- Modify: the test file covering `arenaDecoration` (grep for it)

**Interfaces:**
- Consumes: `tileBakePlan`, `bakeChunks`, `fallbackTeeth`, `TILE_BAKE_SCALE`, `TILE_BAKE_MAX_CHUNK_PX` (Task 7); `resolveTileDraw` (Task 8); `phaserFloorTextures`, `floorTintOf` (existing); `TILE_SIZE` (shared); `arenaColorsOf`, `ArenaColors`, `SPIKE_TOOTH_COLOR` (existing).
- Produces: `arenaDecoration(hasFloorArt: boolean, isTileArena: boolean): { drawMarkings: boolean; drawBorder: boolean; drawObstacles: boolean }`.

- [ ] **Step 1: Failing test for `arenaDecoration`** — add, and update every existing `arenaDecoration(x)` call in tests to `arenaDecoration(x, false)`:

```ts
  it("draws nothing procedural over a tile arena's bake (TA26)", () => {
    expect(arenaDecoration(true, true)).toEqual({ drawMarkings: false, drawBorder: false, drawObstacles: false });
  });

  it("still fills ordinary obstacles on a non-tile arena, art or not", () => {
    expect(arenaDecoration(true, false).drawObstacles).toBe(true);
    expect(arenaDecoration(false, false)).toEqual({ drawMarkings: true, drawBorder: true, drawObstacles: true });
  });
```

- [ ] **Step 2: Implement `arenaDecoration`**

```ts
export function arenaDecoration(hasFloorArt: boolean, isTileArena: boolean): {
  drawMarkings: boolean;
  drawBorder: boolean;
  drawObstacles: boolean;
} {
  return { drawMarkings: !hasFloorArt, drawBorder: !hasFloorArt, drawObstacles: !isTileArena };
}
```

Extend its doc comment: a tile arena's bake already holds its walls and spikes, so not even its ordinary obstacles are filled (TA26). Run its test file — PASS.

- [ ] **Step 3: Scene field** — beside `floorImage`:

```ts
  /**
   * A tile arena's baked floor (TA24): one render texture per `bakeChunks` chunk, drawn at
   * `FLOOR_DEPTH` instead of `floorTile`/`floorImage`. Empty for every other arena.
   */
  private tileChunks: Phaser.GameObjects.RenderTexture[] = [];
```

- [ ] **Step 4: `drawArena`** — wrap the existing floor-source code so the three sources are a genuine either/or:

```ts
    if (arena.tiles) {
      this.bakeTileFloor(arena, colors);
      // A tile arena is a floor-ART arena everywhere the scene asks (TA26): no asphalt, no markings,
      // no border, and the environment panel marks `floor.*` inert and `floorArt.*` live.
      this.hasFloorSprite = true;
    } else {
      // the existing resolveArenaFloor / floorImage / floorTile block, unchanged
    }
```

Add the method:

```ts
  /**
   * Bake a tile arena's floor once (TA24, TA25): every stamp of `tileBakePlan`, chunked by
   * `bakeChunks`, at `TILE_BAKE_SCALE` px per world unit and displayed at its inverse. A stamp whose
   * art never loaded is drawn procedurally into the same chunk, so missing art is never a black floor.
   * Void cells get no stamp; the border colour filled first is what shows through them.
   */
  private bakeTileFloor(arena: ArenaDef, colors: ArenaColors): void {
    const grid = arena.tiles!;
    const tilePx = TILE_SIZE * TILE_BAKE_SCALE;
    const textures = phaserFloorTextures(this.textures);
    const plan = tileBakePlan(grid);
    for (const chunk of bakeChunks(grid.cols, grid.rows, tilePx, TILE_BAKE_MAX_CHUNK_PX)) {
      const rt = this.add
        .renderTexture(chunk.col * TILE_SIZE, chunk.row * TILE_SIZE, chunk.cols * tilePx, chunk.rows * tilePx)
        .setOrigin(0, 0)
        .setScale(1 / TILE_BAKE_SCALE)
        .setDepth(FLOOR_DEPTH);
      // Same mode the HUD bake runs in: the texture shows itself, `render()` is called by hand.
      rt.setRenderMode("render");
      rt.fill(colors.border, 1);
      const teeth = this.make.graphics({}, false);
      teeth.fillStyle(SPIKE_TOOTH_COLOR, 1);
      for (const stamp of plan) {
        if (stamp.col < chunk.col || stamp.col >= chunk.col + chunk.cols) continue;
        if (stamp.row < chunk.row || stamp.row >= chunk.row + chunk.rows) continue;
        const x = (stamp.col - chunk.col) * tilePx;
        const y = (stamp.row - chunk.row) * tilePx;
        const draw = resolveTileDraw(textures, stamp.art, colors);
        if (draw.kind === "texture") {
          const frame = this.textures.getFrame(draw.key);
          rt.stamp(draw.key, undefined, x + tilePx / 2, y + tilePx / 2, {
            angle: stamp.rotation,
            scaleX: tilePx / frame.width,
            scaleY: tilePx / frame.height,
          });
        } else if (draw.kind === "fill") {
          rt.fill(draw.color, 1, x, y, tilePx, tilePx);
        } else {
          for (const t of fallbackTeeth(stamp.rotation, x, y, tilePx)) teeth.fillTriangle(...t);
        }
      }
      // Fallback teeth go on after every base in the chunk; a real teeth texture was already stamped
      // in plan order, which also puts it after every base (TA22).
      rt.draw(teeth);
      rt.render();
      teeth.destroy();
      this.tileChunks.push(rt);
    }
  }
```

Before relying on it, verify the installed Phaser 4.2.1 API in `node_modules/phaser/src/textures/DynamicTexture.js` and `src/gameobjects/rendertexture/RenderTexture.js`: `fill(rgb, alpha, x, y, width, height)`, `stamp(key, frame, x, y, config)` (`config.angle` in degrees, origin defaulting to 0.5), `draw(entries, x, y)`, `render()`, and whether `RenderTexture` forwards them or they must be called on `rt.texture`. Adjust to what exists. Make sure the `colors` passed in is the `arenaColorsOf(arena)` value `drawArena` already computes and that its fields are Phaser colour ints. Import what is new.

- [ ] **Step 5: `applyEnvironment`** — after `this.floorImage?.setTint(floorTintOf(env.floorArt));` add:

```ts
    for (const chunk of this.tileChunks) chunk.setTint(floorTintOf(env.floorArt));
```

- [ ] **Step 6: `redrawArenaGraphics`** — `const decoration = arenaDecoration(this.hasFloorSprite, arena.tiles !== undefined);`, and wrap the obstacle fill loop in `if (decoration.drawObstacles) { … }`.

- [ ] **Step 7: Cameras and teardown**
  - In the `splitCameras` list (~line 1802, where `floorTile`/`floorImage` are spread in), add `...this.tileChunks`.
  - In teardown (~line 1960, beside `this.floorImage?.destroy()`), add:
    ```ts
    for (const chunk of this.tileChunks) chunk.destroy();
    this.tileChunks = [];
    ```
  - `rebuildFloor` already no-ops the asphalt when `hasFloorSprite` is true; leave it.

- [ ] **Step 8: Build and run the client suite**

Run: `npm run build && npx vitest run packages/client`
Expected: PASS relative to baseline.

- [ ] **Step 9: Verify in the browser**

Use the dev preview (`.claude/launch.json`; if absent, create an entry running `npm run dev` with port 5173 — only one checkout may run `npm run dev` at a time). Open `http://localhost:5173/?dev=playground` (seats cars with no lobby) and confirm, with screenshots:
1. The floor is the procedural fallback: slate floor, grey wall band 2 tiles wide at the sides and 1 at the ends, square corners.
2. Spike runs show dark strips with red teeth whose points sit on the floor edge, on the floor side only.
3. No asphalt, markings or border rectangle are drawn over it.
4. A car driven into a spike run takes damage; a car driven into a wall stops at it.
5. `read_console_messages` shows no errors.
6. The environment panel shows `floor.*` inert and `floorArt.*` live.

- [ ] **Step 10: Commit**

```bash
git add packages/client/src/scenes
git commit -m "feat(client): bake tile arenas into render-texture chunks (TA24-TA26)"
```

---

### Task 10: Tile art importer and `check:art` coverage

**Files:**
- Create: `scripts/import-tile-art.mjs`
- Create: `scripts/import-tile-art.test.mjs`
- Modify: `scripts/check-art.mjs`, `scripts/check-art.test.mjs`
- Modify: `packages/client/public/art/README.md` (a "Tile art" section)

**Interfaces:**
- Consumes: `formatManifest` from `scripts/import-art.mjs`; `TILE_TABLE` from `packages/shared/dist/index.js`; `finding(...)` and the sharp metadata gathering in `check-art.mjs`.
- Produces: `TILE_PX` (80), `TILE_ART_IDS`, `tileArtKeyOf(artId)`, `tileManifestRow(artId, existing?)`; `checkTileArt({ artId, row, image })`.

- [ ] **Step 1: Failing tests** — read `scripts/import-weapon-icon.test.mjs` and `scripts/check-art.test.mjs` first and match their style.

`scripts/import-tile-art.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { TILE_ART_IDS, TILE_PX, tileArtKeyOf, tileManifestRow } from "./import-tile-art.mjs";

describe("import-tile-art", () => {
  it("imports at 80 px, twice the 40 u tile", () => {
    expect(TILE_PX).toBe(80);
  });
  it("knows the four tile art ids", () => {
    expect([...TILE_ART_IDS].sort()).toEqual(["floor", "spike", "spike-teeth", "wall"]);
  });
  it("keys and files art in the common arena namespace", () => {
    expect(tileArtKeyOf("wall")).toBe("arena.common.tile.wall");
    expect(tileManifestRow("wall")).toEqual({ file: "arenas/common/tile-wall.png", colorMode: "none" });
  });
  it("keeps hand-set fields on re-import", () => {
    expect(tileManifestRow("wall", { origin: [0.5, 0.5] })).toEqual({
      origin: [0.5, 0.5],
      file: "arenas/common/tile-wall.png",
      colorMode: "none",
    });
  });
});
```

`scripts/check-art.test.mjs` — add (import `checkTileArt`):

```js
describe("checkTileArt", () => {
  const row = { file: "arenas/common/tile-x.png" };
  it("blocks a missing file", () => {
    expect(checkTileArt({ artId: "wall", row, image: undefined })[0].level).toBe("blocker");
  });
  it("blocks teeth with no alpha — they would paint an opaque square", () => {
    const image = { width: 80, height: 80, hasAlpha: false, channels: 3 };
    expect(checkTileArt({ artId: "spike-teeth", row, image }).some((f) => f.level === "blocker")).toBe(true);
  });
  it("lets an opaque floor through", () => {
    const image = { width: 80, height: 80, hasAlpha: false, channels: 3 };
    expect(checkTileArt({ artId: "floor", row, image })).toEqual([]);
  });
  it("warns on any size but 80 x 80", () => {
    const image = { width: 128, height: 128, hasAlpha: true, channels: 4 };
    expect(checkTileArt({ artId: "floor", row, image }).map((f) => f.level)).toEqual(["warning"]);
  });
});
```

Match the `image` fact shape to what `checkTurretSprite` receives in `check-art.mjs` (rename fields in the test if they differ).

- [ ] **Step 2: Run to verify failure** — `npx vitest run scripts/import-tile-art.test.mjs scripts/check-art.test.mjs`

- [ ] **Step 3: Implement `scripts/import-tile-art.mjs`**, structured like `import-weapon-icon.mjs` (header, exported pure helpers, CLI shell, `formatManifest` for the write):

```js
/**
 * Import an image as one tile type's art (spec tile arenas, §5.1, TA21): resize to exactly
 * TILE_PX x TILE_PX — no trim, tiles are full-bleed — write it under arenas/common/, and wire the
 * manifest row. `spike-teeth` is the edge overlay: author it for the tile's TOP edge, transparent
 * elsewhere, with the points on the edge and nothing past it. Follows import-weapon-icon.mjs's CLI
 * and manifest handling.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { TILE_TABLE } from "../packages/shared/dist/index.js";
import { formatManifest } from "./import-art.mjs";

/** Twice the 40 u tile, so a tile is sharp at the bake's 2 px per unit (TA4). */
export const TILE_PX = 80;

/** Every art id a tile row names, plus the spike edge overlay. */
export const TILE_ART_IDS = [
  ...Object.values(TILE_TABLE)
    .map((t) => t.art)
    .filter((a) => a !== null),
  "spike-teeth",
];

export function tileArtKeyOf(artId) {
  return `arena.common.tile.${artId}`;
}

/** Any field already present survives a re-import, the contract the other importers keep. */
export function tileManifestRow(artId, existing = {}) {
  return { ...existing, file: `arenas/common/tile-${artId}.png`, colorMode: "none" };
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");
const manifestPath = path.join(artDir, "manifest.json");

function parseArgs(argv) {
  let tile;
  let src;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tile") tile = argv[++i];
    else if (argv[i] === "--src") src = argv[++i];
  }
  return { tile, src };
}

export async function main(argv = process.argv.slice(2)) {
  const { tile, src } = parseArgs(argv);
  if (!tile || !src) throw new Error("usage: node scripts/import-tile-art.mjs --tile <id> --src <path>");
  if (!TILE_ART_IDS.includes(tile)) {
    throw new Error(`unknown tile art "${tile}". Known: ${TILE_ART_IDS.join(", ")}`);
  }
  if (!fs.existsSync(src)) throw new Error(`no such image: ${src}`);

  const meta = await sharp(src).metadata();
  const row = tileManifestRow(tile);
  const dest = path.join(artDir, row.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await sharp(src).resize(TILE_PX, TILE_PX, { fit: "fill" }).png().toFile(dest);

  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { sprites: {} };
  const key = tileArtKeyOf(tile);
  manifest.sprites ??= {};
  manifest.sprites[key] = tileManifestRow(tile, manifest.sprites[key]);
  fs.writeFileSync(manifestPath, formatManifest(manifest));

  console.log(`source        ${meta.width} x ${meta.height}  (${meta.format}${meta.hasAlpha ? ", alpha" : ", no alpha"})`);
  console.log(`wrote         ${path.relative(rootDir, dest)}  ${TILE_PX}x${TILE_PX}`);
  console.log(`manifest      ${key} -> ${row.file}`);
  console.log("next          npm run dev and play arena-01 — the floor is baked from tile art at load");
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
```

Add a `package.json` script only if the other importers have one (they do not appear to — `check:*` do; leave importers script-less to match).

- [ ] **Step 4: `check-art.mjs`** — add the pure check, and a `TILE ART` section in `main()` that runs it for every manifest key starting with `arena.common.tile.` and adds its blockers to the total:

```js
/** Every complaint about one tile image (TA21). Opaque is fine except for the teeth overlay. */
export function checkTileArt({ artId, row, image }) {
  const out = [];
  if (!image) {
    out.push(finding("blocker", "missing-file", `manifest names ${row.file}, which is not on disk`));
    return out;
  }
  if (artId === "spike-teeth" && (!image.hasAlpha || image.channels < 4)) {
    out.push(
      finding(
        "blocker",
        "no-alpha",
        `${row.file} has no alpha channel — the teeth overlay would paint an opaque square over its spike`,
      ),
    );
  }
  if (image.width !== 80 || image.height !== 80) {
    out.push(finding("warning", "tile-size", `${row.file} is ${image.width}x${image.height}; tile art is 80x80`));
  }
  return out;
}
```

Gather each image's facts the same way `checkTurrets` does. `artId` is the key's suffix after `arena.common.tile.`.

- [ ] **Step 5: README** — add a "Tile art" section to `packages/client/public/art/README.md`: the four ids, 80 × 80, the teeth convention (top edge, transparent elsewhere, points on the edge, never past the tile), `node scripts/import-tile-art.mjs --tile <id> --src <path>` (after `npm run build -w @motor-combat-moba/shared`), and that missing art falls back to procedural fills.

- [ ] **Step 6: Run** `npx vitest run scripts && npm run check:art` — tests PASS; `check:art` exits 0 (no tile rows exist yet).

- [ ] **Step 7: Commit**

```bash
git add scripts packages/client/public/art/README.md
git commit -m "feat(art): tile art importer and check:art coverage (TA21)"
```

---

### Task 11: Docs, the guide rebuild, final verification

**Files:**
- Modify: `CLAUDE.md` (root)
- Modify: `docs/config-reference.md`, `docs/asset-pipeline.md`, `docs/combat-model.md`, `docs/project-structure.md`
- Modify: `packages/client/public/manual.html` (regenerated)
- Modify: `docs/superpowers/specs/2026-10-09-tile-arenas-design.md` (status line)

- [ ] **Step 1: Root `CLAUDE.md`**
  - Add `TILE_SIZE` and `TILE_TABLE` to the "What is NOT per-mode, and why" list, noting tile arenas (2026-10-09).
  - Replace the paragraph beginning "**`arena-01` is no longer one open rectangle.**" with a shorter one: `arena-01` is a **tile arena** as of 2026-10-09 — a 32 × 18 text grid compiled by `compileTileArena` (`packages/shared/src/arena/tiles/`) into ordinary `obstacles`, playable floor 1120 × 640, square corners, fourteen spike runs set into the innermost wall row; `arena-02` keeps its rectangle-with-spike-ring and `arena-03` its chamfered polygon, both hand-written. Keep the still-true sentences about `boundsOf`, `boundary` polygons as a mechanism, and `kind: "spike"`; drop the octagon numbers. Link the spec.
  - In the paragraph "**`arena.arena-01.floor` and `arena.arena-02.floor` are the live keys…**": arena-01's floor key is gone; tile art lives under `arena.common.tile.<id>` and is baked at load.
  - Add a row to "Read the right doc": "Tile arenas: the tile table, the grid compiler, the bake, tile art (TA1–TA31)" → the spec.
- [ ] **Step 2: Other docs** — `docs/config-reference.md`: a "Tile arenas" subsection (`TILE_SIZE`, the `TILE_TABLE` rows, the grid syntax, the TA18–TA20 rules, the reserved `surface` field). `docs/asset-pipeline.md`: tile art keys, 80 px, the teeth convention, the bake and its fallback, the per-frame cost. `docs/combat-model.md`: where spikes are described, "flush against the boundary" (AS13) now holds only for hand-written arenas; a tile spike may sit anywhere and hurts from every open face (TA6, TA19). `docs/project-structure.md`: the `arena/tiles/` folder. Grep `docs/` (with `--exclude-dir=ideas --exclude-dir=invariants`) for `1132`, `octagon` and `chamfer` near `arena-01` and fix statements that are now false; leave dated history as history.
- [ ] **Step 3: Rebuild the players' guide** (TA30 moved arena-01's playable extent)

Run: `npm run build && npm run build:manual`
Expected: `packages/client/public/manual.html` rewritten; reach percentages move by about 1%.

- [ ] **Step 4: Full verification**

Run: `npm test 2>&1 | tail -150` and `node scripts/test-scope.mjs`
Expected: everything that passed at baseline passes, plus every test this plan added. List every remaining failure against the Task 0 baseline with a one-line cause.

- [ ] **Step 5: Spec status** — set the spec's `**Status:**` line to `implemented 2026-10-09 (plan docs/superpowers/plans/2026-10-09-tile-arenas.md)`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs packages/client/public/manual.html
git commit -m "docs: tile arenas; rebuild the players' guide for arena-01's new floor"
```

- [ ] **Step 7: Report** — for the controller's summary, state plainly: arena-01's geometry changed under the playtest probes (`playtest/common/collision.ts` reads it directly; `weapons.ts` and `world.ts` default to it; `geometry.ts` iterates it) and under every balance report for Brawl, Team brawl and Deathmatch; `BOT_BRAIN_VERSION` moved to 6.5.0. Recommend `npm run playtest -- --scope=all` and a fresh balance baseline. Do not run them.
