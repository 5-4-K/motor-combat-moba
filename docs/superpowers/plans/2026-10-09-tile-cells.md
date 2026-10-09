# Tile Cells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate tile behaviour from tile look: global behaviour-only tile definitions, per-arena legends of cells (definition + orientation + art + overlay), a fully resolved cell grid, and one-sided spike hazards in the sim and bot.

**Architecture:** `compileTileArena` expands character rows through `{ ...DEFAULT_LEGEND, ...arena.legend }` into a resolved `TileGrid` of `TileCell`s (behaviour flags, world damage faces, base art stamp, overlay stamps) and greedy-merges solid cells by identical behaviour into `obstacles`, now carrying optional `damageFaces`. The sim's spike contact and the bot's `spikesAhead` filter by face; the client bake becomes a flat read of resolved stamps with a behaviour-keyed fallback.

**Tech Stack:** TypeScript, vitest, node:test (scripts), Phaser 4 (client bake), sharp (importer).

**Spec:** `docs/superpowers/specs/2026-10-09-tile-cells-design.md` (TC1–TC42). Read it first; this plan argues from it.

## Global Constraints

- `TILE_SIZE` stays 40 and global; `TILE_DEFS` is global, never per mode (TC11).
- Shared is consumed as built `dist`: after editing shared, `npm run build -w @motor-combat-moba/shared` before running server/client tests or scripts.
- Never read a mode accessor at module scope. `compileTileArena` reads no accessor and may run at module load.
- `arena-01`'s compiled `obstacles` must equal the frozen pre-change copy exactly (TC22, TC27, TC35). `BOT_BRAIN_VERSION` does NOT move.
- All tile data is plain JSON-able data (TC16).
- Do not read or touch `docs/ideas/` or `docs/invariants/`.
- Test runs: `npm test` at the root for full scope. **Never run** the slow bot test suite (`packages/server/src/bot/**`) or `balance/match.test.ts` / `balance/runner.test.ts` — except that Task 3 runs its ONE edited test file in `bot/brain/` directly by path (see `packages/server/vitest.slow-tests.ts` and the `test:slow` script for the config that includes it).
- The client's `src/fx/perf.test.ts` is timing-sensitive and known to fail under load; it is not a regression.
- Windows checkout (CRLF). Any test that regex-parses a checked-out text file normalises to LF.
- Commit after each task with a conventional message ending in a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

---

### Task 1: Shared tile model, compiler, bounds, and client bake (the grid change)

One task because `TileGrid.cells` changes shape: shared and client must move together or the client suite breaks.

**Files:**
- Create: `packages/shared/src/arena/tiles/__fixtures__/arena-01.obstacles.json` (frozen BEFORE any edit)
- Create: `packages/shared/src/arena/faces.ts` + `faces.test.ts` (`WorldFace`, `WORLD_FACES`, `facesOfNormal`) — in `arena/`, not `tiles/`, since the sim and bot use it for hand-written arenas too
- Modify: `packages/shared/src/arena/tiles/tile-config.ts` (replace `TILE_TABLE` with `TILE_DEFS`; add `rotateSides`) + `tile-config.test.ts`
- Create: `packages/shared/src/arena/tiles/legend.ts` + `legend.test.ts`
- Modify: `packages/shared/src/arena/tiles/compile.ts` + `compile.test.ts`; `tile-collision.test.ts` only if it uses removed names
- Modify: `packages/shared/src/arena/types.ts` (`TileStamp`, `TileCell`, `TileGrid`, `Obstacle.damageFaces`)
- Modify: `packages/shared/src/arena/bounds.ts` (`playableRectOf` reads `cell.solid`)
- Modify: `packages/shared/src/arena/arena-01.test.ts` (symmetry test compares `cells[i].tile`)
- Modify: `packages/shared/src/index.ts` (exports)
- Modify: `packages/client/src/scenes/tile-bake.ts` + `tile-bake.test.ts`, `packages/client/src/assets/tile-art.ts` (+ its test if one exists), `packages/client/src/scenes/ArenaScene.ts` (`bakeTileFloor` only)

**Interfaces:**
- Produces (shared exports): `TILE_SIZE`, `TILE_DEFS`, `type TileDefId`, `type TileDef`, `type TileHazard`, `type TileOverlayRule`, `type TileSurface`, `type TileRotation`, `type TileSide`, `rotateSides(sides, orientation): WorldFace[]`, `DEFAULT_LEGEND`, `effectiveLegend(arenaId, legend)`, `type TileLegend`, `type TileCellSpec`, `type WorldFace`, `WORLD_FACES`, `facesOfNormal(nx, ny): WorldFace[]`, `compileTileArena(src, defs?)`, `type TileArenaSource`, `type TileGrid`, `type TileCell`, `type TileStamp`. **Removed:** `TILE_TABLE`, `isSolidTile`, `tileDefOf`, `parseTileGrid`, `TileId`, `TileCollision`, `TileShape` (grep the repo for each and move every reader).
- Produces (client): `tileBakePlan(grid): BakeStamp[]` where `BakeStamp = { col, row, art: string | null, rotation: TileRotation, overlay: boolean, solid: boolean, hazard: "spike" | null }`; `resolveTileDraw(textures, stamp: BakeStamp, colors): TileDraw`.

- [ ] **Step 1: Freeze arena-01's obstacles before touching anything**

```bash
npm run build -w @motor-combat-moba/shared
node -e "import('./packages/shared/dist/index.js').then(m=>{const fs=require('fs');const a=m.ARENA_01;if(!a)throw new Error('ARENA_01 not exported - read it via the arena registry export');fs.mkdirSync('packages/shared/src/arena/tiles/__fixtures__',{recursive:true});fs.writeFileSync('packages/shared/src/arena/tiles/__fixtures__/arena-01.obstacles.json',JSON.stringify(a.obstacles,null,2)+'\n')})"
```

Expected: a JSON array of 32 obstacles, 14 with `"kind": "spike"`.

- [ ] **Step 2: `faces.ts` + test**

```ts
/** A world-axis face of an axis-aligned box. `n` is −y (up on screen). */
export type WorldFace = "n" | "e" | "s" | "w";
export const WORLD_FACES: readonly WorldFace[] = ["n", "e", "s", "w"];

/**
 * Which face(s) of a box a vector pointing OUT of the box leaves through (tile cells TC23): the
 * dominant axis, both faces on an exact tie, every face for a zero vector. Order is n-e-s-w.
 */
export function facesOfNormal(nx: number, ny: number): WorldFace[] {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  if (ax === 0 && ay === 0) return [...WORLD_FACES];
  const vertical: WorldFace | null = ay >= ax ? (ny < 0 ? "n" : "s") : null;
  const horizontal: WorldFace | null = ax >= ay ? (nx > 0 ? "e" : "w") : null;
  return WORLD_FACES.filter((f) => f === vertical || f === horizontal);
}
```

Test: `(0,-1)→["n"]`, `(1,0)→["e"]`, `(0,1)→["s"]`, `(-1,0)→["w"]`, `(0.6,-0.8)→["n"]`, `(1,1)→["e","s"]`, `(0,0)→["n","e","s","w"]`.

- [ ] **Step 3: Rewrite `tile-config.ts` per spec §3.1, plus rotation**

`TILE_DEFS` exactly as spec §3.1 (`TileSurface` keeps its current shape). Rotation helper:

```ts
const SIDES: readonly TileSide[] = ["front", "right", "back", "left"];

/** A definition's hazard sides as world faces for a cell at `orientation` (TC3, TC4), in n-e-s-w order. */
export function rotateSides(sides: "all" | readonly TileSide[], orientation: TileRotation): WorldFace[] {
  if (sides === "all") return [...WORLD_FACES];
  const steps = orientation / 90;
  const hit = new Set(sides.map((s) => (SIDES.indexOf(s) + steps) % 4));
  return WORLD_FACES.filter((_, i) => hit.has(i));
}
```

`tile-config.test.ts`: drop the character tests; keep TA3 (size 40), TA12 (no row authors `surface`), TA2 (shape `"full"`); add TC12 (hazard ⇒ solid; `draw: "none"` ⇒ no `defaultArt`); the shipped defaults (`floor.defaultArt === "metal-plate"`, `wall` and `spike` `"checker-plate"`, `spike.overlay.art === "spike-teeth"`, `void.draw === "none"`, `spike.hazard.sides === "all"`); `rotateSides(["front"], o)` for o = 0/90/180/270 → `["n"]`/`["e"]`/`["s"]`/`["w"]`; `rotateSides(["front","right"], 270)` → `["n","w"]`; `"all"` → all four.

- [ ] **Step 4: `legend.ts` + test** — `TileCellSpec`, `TileLegend`, `DEFAULT_LEGEND` exactly as spec §3.2, plus:

```ts
/** TC15: an arena key replaces a default key whole. Throws (TC18) on a key that is not exactly one character. */
export function effectiveLegend(arenaId: string, legend: TileLegend | undefined): TileLegend {
  for (const key of Object.keys(legend ?? {})) {
    if ([...key].length !== 1) throw new Error(`Tile arena ${arenaId}: legend key ${JSON.stringify(key)} must be one character`);
  }
  return { ...DEFAULT_LEGEND, ...legend };
}
```

Test: no legend → equals `DEFAULT_LEGEND`; an arena `"."` replaces the default `"."` whole (its `art` is present, nothing merged from the default); a new key is added; a two-character key throws naming the arena and key.

- [ ] **Step 5: Types** — in `types.ts` add `TileStamp`, `TileCell` (`tile: string`, `solid: boolean`, `hazard: "spike" | null`, `faces: readonly WorldFace[]`, `drawn: boolean`, `base: TileStamp | null`, `overlays: readonly TileStamp[]`), `TileGrid.cells: readonly TileCell[]`, `Obstacle.damageFaces?: readonly WorldFace[]` with a doc comment (absent = every face, the meaning every hand-written spike already has; only read on `kind: "spike"`). Remove the `TileId` import; import `WorldFace` from `./faces.js` and `TileRotation` from `./tiles/tile-config.js` (type-only imports; check for a cycle and break it by moving `TileRotation` into `faces.ts` if `tile-config.ts` imports `types.ts`).

- [ ] **Step 6: Rewrite `compile.ts`**

`TileArenaSource` gains `legend?: TileLegend`. `compileTileArena(src, defs: Readonly<Record<string, TileDef>> = TILE_DEFS)`:

1. `legend = effectiveLegend(src.id, src.legend)`; validate every legend entry against `defs` — unknown `tile`, `orientation`/`artOrientation` not in `[0, 90, 180, 270]`, an explicit overlay with a bad orientation, `art` on a `draw: "none"` def. Each error names the arena and the key (TC18).
2. Validate rows: empty grid; ragged row (name the row); map each character through the legend — unknown key names row, column and `JSON.stringify(ch)`.
3. First pass, per cell: `solid = def.collision === "solid"`, `hazard = def.hazard?.kind ?? null`, `drawn = def.draw !== "none"`, `orientation = spec.orientation ?? 0`, `faces = def.hazard ? rotateSides(def.hazard.sides, orientation) : []`, `base` per TC17 (`art = spec.art ?? def.defaultArt`; `null` if not drawn or no art; `rotation = spec.artOrientation ?? orientation`).
4. Second pass (needs neighbours' `solid`): `overlays` — `spec.overlay === "none"` → `[]`; explicit `{ art, orientation }` → `[{ art, rotation: orientation }]`; else if `def.overlay`, one stamp `{ art: def.overlay.art, rotation }` per face in `faces` (n-e-s-w order) whose neighbour across it is in-grid and not solid, rotation `n:0, e:90, s:180, w:270`. Out-of-grid neighbours get no overlay (the grid edge is a wall).
5. Merge (TC21): class = `null` if not solid, else `` `${cell.hazard ?? "solid"}|${cell.faces.join("")}` ``. Greedy scan unchanged. Emit `kind: "spike"` when the class's hazard is `"spike"`; add `damageFaces` only when the cells' `faces.length < 4` (TC22).

`compile.test.ts`: replace the `parseTileGrid` tests with TC18 error tests through `compileTileArena` (each error message names the arena, plus row/column/key as the spec says); keep the rasterise exact-cover tests; add, with fixture defs `{ ...TILE_DEFS, "spike-front": { ...TILE_DEFS.spike, hazard: { kind: "spike", sides: ["front"] } } }`:
- legend `{ v: { tile: "spike-front", orientation: 180 } }` → the cell's `faces` is `["s"]` and its obstacle has `damageFaces: ["s"]`, `kind: "spike"`;
- two horizontally adjacent `spike-front` cells at orientations 0 and 180 do NOT merge (two obstacles); two adjacent `spike-front` at the same orientation DO;
- two adjacent walls with different `art` DO merge;
- a `spike-front` at 180 with floor on all four sides gets exactly one overlay, rotation 180; a plain `spike` mid-floor gets four (0, 90, 180, 270); explicit overlay wins; `"none"` gives none;
- `base.rotation` defaults to the orientation, and `artOrientation` overrides it;
- a `void` cell has `drawn: false`, `base: null`, no overlays;
- the TC35 pin:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const frozen = JSON.parse(readFileSync(fileURLToPath(new URL("./__fixtures__/arena-01.obstacles.json", import.meta.url)), "utf8"));
it("compiles arena-01 to exactly the pre-change obstacles (TC22, TC35)", () => {
  expect(ARENA_01.obstacles).toEqual(frozen);
});
```

- [ ] **Step 7: `bounds.ts`** — `grid.cells.forEach((cell, i) => { if (cell.solid) return; … })`; drop the `isSolidTile` import. `arena-01.ts` needs no change (TC35). In `arena-01.test.ts` the symmetry test compares `at(c, r)?.tile` (arena-01 is all orientation 0).

- [ ] **Step 8: `index.ts`** per the Interfaces block. `npx vitest run --root packages/shared` — green. `npm run build -w @motor-combat-moba/shared`.

- [ ] **Step 9: Client bake.**

`tile-bake.ts`: delete `SPIKE_TEETH_ART`, `EDGES` and the edge loop; import `TileRotation` from shared instead of declaring it. New:

```ts
export interface BakeStamp {
  readonly col: number;
  readonly row: number;
  readonly art: string | null;
  readonly rotation: TileRotation;
  readonly overlay: boolean;
  readonly solid: boolean;
  readonly hazard: "spike" | null;
}

/** Every stamp the bake draws (TA22, TC32): every drawn cell's base row-major, then every overlay row-major. */
export function tileBakePlan(grid: TileGrid): BakeStamp[] {
  const bases: BakeStamp[] = [];
  const overlays: BakeStamp[] = [];
  grid.cells.forEach((cell, i) => {
    const col = i % grid.cols;
    const row = Math.floor(i / grid.cols);
    const facts = { col, row, solid: cell.solid, hazard: cell.hazard };
    if (cell.drawn) bases.push({ ...facts, art: cell.base?.art ?? null, rotation: cell.base?.rotation ?? 0, overlay: false });
    for (const o of cell.overlays) overlays.push({ ...facts, art: o.art, rotation: o.rotation, overlay: true });
  });
  return [...bases, ...overlays];
}
```

Keep `bakeChunks`, `fallbackTeeth`, `TILE_BAKE_SCALE`, `TILE_BAKE_MAX_CHUNK_PX`.

`tile-art.ts`, `resolveTileDraw(textures, stamp: BakeStamp, colors)` (TC33):

```ts
if (stamp.art !== null && textures.exists(tileArtKey(stamp.art))) return { kind: "texture", key: tileArtKey(stamp.art) };
if (stamp.overlay) return { kind: "teeth" };
if (!stamp.solid) return { kind: "fill", color: colors.floor };
if (stamp.hazard !== null) return { kind: "fill", color: SPIKE_STRIP_COLOR };
return { kind: "fill", color: colors.obstacle };
```

`ArenaScene.bakeTileFloor`: pass the stamp to `resolveTileDraw`; everything else unchanged.

`tile-bake.test.ts`: build grids with shared's `compileTileArena` from a tiny source (rows only) instead of hand-mapping ids; assert all bases precede all overlays; a void cell yields no stamp; a wall-row spike (`["#^#", "..."]`) yields exactly one overlay stamp at rotation 180; a mid-floor spike pillar yields four overlay rotations. Add `resolveTileDraw` tests with a fake `textures.exists`: texture present wins; missing floor/spike/wall/overlay → floor fill / spike fill / obstacle fill / teeth; a non-solid stamp with `art: null` → floor fill.

- [ ] **Step 10: Verify and commit.** `npm test` at the root — all green except possibly `fx/perf.test.ts`. `npm run build` (root) succeeds.

```bash
git add -A packages/shared/src packages/client/src
git commit -m "feat(arena): tile cells - behaviour-only tile defs, per-arena legends, resolved cell grid"
```

---

### Task 2: One-sided spikes in the sim contact pass

**Files:**
- Modify: `packages/shared/src/sim/contact.ts` (spike detection loop, ~lines 236–258)
- Test: the existing shared test that covers `spikeContacts` (`grep -ln spikeContacts packages/shared/src/sim/*.test.ts`); add a `describe("one-sided spikes (TC39)")`

**Interfaces:** Consumes `facesOfNormal` and `Obstacle.damageFaces` from Task 1.

- [ ] **Step 1: Failing tests (TC39).** Using that file's existing helpers for building cars and calling the contact pass: one spike box with `damageFaces: ["s"]`; a car overlapping its south face, moving north into it → one `spikeContacts` entry; the same car overlapping its north face, moving south → none; two spike boxes where the car touches the safe face of the first (in obstacle order) and the damaging face of the second → exactly one entry, carrying the second box's normal; a box with no `damageFaces` → reported from every face (unchanged).
- [ ] **Step 2: Run them; see the one-sided cases fail.**
- [ ] **Step 3: Implement (TC23, TC24).**

```ts
for (const box of obstacles) {
  if (box.kind !== "spike") continue;
  const n = contactNormalBetween(hull, aabbToObb(box), spike().contactPad);
  if (n === null) continue;
  // A safe face (tile cells TC24) is not reported, and the loop keeps looking: a car on the safe
  // face of one strip and the damaging face of another is still hit by the second.
  const faces = box.damageFaces;
  if (faces !== undefined && !facesOfNormal(n.x, n.y).some((f) => faces.includes(f))) continue;
  spikeContacts.push({ /* unchanged */ });
  break;
}
```

Update the comment above the loop to match.

- [ ] **Step 4:** `npx vitest run --root packages/shared` — green. Rebuild shared. `npx vitest run --root packages/server src/sim` — green.
- [ ] **Step 5: Commit** `feat(sim): spikes damage only from their authored faces`.

---

### Task 3: One-sided spikes in the bot's spike check

**Files:**
- Modify: `packages/server/src/bot/brain/movement.ts` (`spikesAhead`)
- Test: `packages/server/src/bot/brain/movement.test.ts`

**Interfaces:** Consumes `facesOfNormal`, `Obstacle.damageFaces`.

- [ ] **Step 1: Failing tests (TC40).** A `BotArenaView` with one spike box `damageFaces: ["s"]`: a car south of it facing north within lookahead → `true`; a car north of it facing south within lookahead → `false`; with no `damageFaces`, both → `true`.
- [ ] **Step 2: Implement (TC26).** In the `some` predicate, after the existing ahead-point test passes: if `box.damageFaces` is undefined, count it; else take the nearest point of the box to the car centre (`qx = clamp(self.x, box.x, box.x + box.w)`, same for `qy`); a car centre inside the box counts; otherwise count it only if `facesOfNormal(self.x - qx, self.y - qy).some((f) => box.damageFaces.includes(f))`.
- [ ] **Step 3: Run only `movement.test.ts`**, by path, with the server's slow-test config (check `packages/server/package.json` `test:slow` and `vitest.slow-tests.ts` for how it is included). Green. Do not run the rest of the bot suite.
- [ ] **Step 4: Commit** `feat(bot): spikesAhead ignores a spike's safe faces` — body: no shipped arena places a one-sided spike and arena-01's obstacles are pinned identical, so shipped behaviour is unchanged and `BOT_BRAIN_VERSION` does not move (TC27).

---

### Task 4: Art named by look, importer, check-art

**Files:**
- `git mv` `packages/client/public/art/arenas/common/tile-floor.png` → `tile-metal-plate.png`, `tile-wall.png` → `tile-checker-plate.png`; `git rm` `tile-spike.png`; keep `tile-spike-teeth.png` (TC29)
- Modify: `packages/client/public/art/manifest.json` (rows `arena.common.tile.metal-plate`, `.checker-plate`, `.spike-teeth`; remove `.floor`, `.wall`, `.spike`). Preserve the file's existing formatting and line endings (use the importer's `formatManifest` or edit by hand).
- Create: `packages/shared/src/arena/tiles/art-ids.ts` + test: `overlayArtIds()` and `referencedTileArtIds()` (sorted, unique) — from `TILE_DEFS` (`defaultArt`, `overlay.art`) plus every registered arena's `tiles.cells` (`base.art`, `overlays[].art`; overlays count as overlay ids only when they came from a def rule or an explicit cell overlay — i.e. every `overlays[].art`); export from `index.ts`
- Modify: `scripts/import-tile-art.mjs` + `.test.mjs` (TC30)
- Modify: `scripts/check-art.mjs` + its test (TC31)

- [ ] **Step 1:** shared helpers + tests (`overlayArtIds()` → `["spike-teeth"]`; `referencedTileArtIds()` → `["checker-plate", "metal-plate", "spike-teeth"]`). Rebuild shared.
- [ ] **Step 2:** importer: remove `TILE_ART_IDS` and `--tile`; add `--art <id>` validated by exported `isTileArtId(id)` = `/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)`; the usage error names `--art` and `--src`. Test: `isTileArtId` accepts `metal-plate`, `grass`, `spike-teeth`, `a1`; rejects `Floor`, `a--b`, `-a`, `a-`, `a_b`, `""`. Keep `TILE_PX`, `tileArtKeyOf`, `tileManifestRow` and their tests.
- [ ] **Step 3:** check-art: the no-alpha blocker fires when `overlayArtIds().includes(artId)` (imported from built shared) instead of `artId === "spike-teeth"`; `checkTiles` additionally emits one warning per `referencedTileArtIds()` id that has no `arena.common.tile.<id>` manifest row (message names the id and says the cell will draw the procedural fallback). Pass the id lists in as parameters so the test can use fixtures; the CLI passes shared's.
- [ ] **Step 4:** rename files and manifest rows. `npm run check:art` → TILE ART shows `checker-plate`, `metal-plate`, `spike-teeth` as `ok`, no tile warnings.
- [ ] **Step 5:** `npm test` root — green (except known perf). Commit `feat(art): tile art named by look; importer takes --art; check-art knows overlays`.

---

### Task 5: Docs

**Files:** root `CLAUDE.md` (the "`arena-01` is a tile arena" paragraph → cells, legends, defs; the "What is NOT per-mode" list `TILE_TABLE` → `TILE_DEFS`), `docs/asset-pipeline.md` (tile art: named by look, `--art`, overlay alpha rule, missing-art warning), `docs/config-reference.md` (tile table references), `docs/project-structure.md` (new files), and directly under the header of `docs/superpowers/specs/2026-10-09-tile-arenas-design.md`: `**Superseded in part** by [tile cells](2026-10-09-tile-cells-design.md): TA5, TA6, TA8, TA13, TA21 and the art half of TA4.`

- [ ] **Step 1:** find every live stale mention:

```bash
grep -rn "TILE_TABLE\|isSolidTile\|tileDefOf\|parseTileGrid\|--tile \|tile-floor\|tile-wall\|tile\.floor\|tile\.wall\|TILE_ART_IDS" --include=*.md . | grep -v "node_modules\|docs/ideas\|docs/invariants\|docs/superpowers"
```

Fix each. Keep prose claim-first and short.
- [ ] **Step 2:** commit `docs: tile cells`.
