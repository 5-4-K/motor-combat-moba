# Bigger Default Arenas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow `arena-01`/`arena-02` to 40 × 22 tiles (1600 × 880) and pull the default camera back to zoom 0.8 so they still fill the 1280 × 720 view, centred, with the 10-unit bands painted the arena's border colour.

**Architecture:** Shared: two tile grids and their spawns change; `CAMERA_CONFIG.zoom` goes to 0.8 in the base with Conquer pinned to 1 by override. Client: one pure helper, `cameraBoundsOf`, replaces both `setBounds(0, 0, arena.width, arena.height)` calls so a view larger than the arena is centred instead of pinned top-left; tile arenas get the border colour as camera background.

**Tech Stack:** TypeScript, vitest, Phaser 4.2.1, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-10-bigger-default-arenas-design.md` (BAR1–BAR19). Read it before any task.

## Global Constraints

- `TILE_SIZE` 40, hull 60 × 40, `LOGICAL_CANVAS` 1280 × 720 — unchanged.
- One boundary tile on every side of both arenas; floor x 40..1560, y 40..840 (1520 × 800).
- Zoom read only through `camera().zoom`, never at module scope (CLAUDE.md).
- No literal 10, 880, 900 or 1600 in client logic — derive from arena size, viewport size and zoom.
- Conquer's resolved bundle must not move: `modes/__snapshots__/conquer.tables.json` unchanged.
- Re-snapshot with `vitest -u` scoped to the moved files only, never a blanket `-u`.
- Probes: never update an expectation silently (CLAUDE.md "Playtest"); compile breaks only.
- Commit messages end with the two attribution lines from the session (Co-Authored-By / Claude-Session). No model names in commits or code.

## Review Focus

1. **A view exactly as wide as the arena** (1280 at zoom 0.8 → 1600 world, arena 1600): bounds must equal the arena on that axis with no float sliver. `1280 / 0.8 === 1600` in JS today, but the helper must not depend on that — compare with a tolerance. Test in Task 1.
2. **Conquer's `arena-03` (1280 × 2160, zoom 1)** must get exactly `(0, 0, 1280, 2160)` — it is taller than the view and scrolls. Test in Task 1.
3. **Heading-rotate modes** call `removeBounds()`; the helper must only change the *aligned* path. Covered by leaving `applyCameraBounds`'s `else` branch untouched (Task 1 review item).
4. **Non-tile arenas' background** (arena-03 draws a floor image/asphalt over its rect; whatever shows outside its chamfers today must not change): background switch is gated on `arena.tiles`. Test in Task 1.
5. **Spawn clearance** on the bigger arenas: every spawn on the floor and ≥ one car diagonal (72.1 u) from every spike face. Existing tests, kept and re-pointed in Task 2.

---

### Task 1: Centre the camera on an arena smaller than the view; border-colour band

**Files:**
- Create: `packages/client/src/camera/bounds.ts`
- Create: `packages/client/src/camera/bounds.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (~1559–1562 `setBackgroundColor`/`setBounds`; ~2268 `applyCameraBounds`)

**Interfaces:**
- Consumes: `Rect` from `packages/client/src/scenes/arena-visual.ts` (`{ x, y, w, h }`), `arenaColorsOf`.
- Produces: `export function cameraBoundsOf(arena: { width: number; height: number }, view: { width: number; height: number }, zoom: number): Rect` — `view` is the camera viewport in screen px (`ARENA_VIEW_WIDTH`, `VIEW_HEIGHT`); `export function cameraBackgroundOf(arena: ArenaDef, colors: ArenaColors): number`.

- [ ] **Step 1: Write the failing tests** in `bounds.test.ts`:
  - `"centres a 1600x880 arena in a 1280x720 view at zoom 0.8"` → `{ x: 0, y: -10, w: 1600, h: 900 }`.
  - `"keeps a view exactly the arena's width on the arena"` → width axis `x 0, w 1600` (use `toBeCloseTo` per field).
  - `"leaves an arena larger than the view as the arena rect (arena-03)"` → `cameraBoundsOf({ width: 1280, height: 2160 }, { width: 1280, height: 720 }, 1)` equals `{ x: 0, y: 0, w: 1280, h: 2160 }`.
  - `"centres both axes when the arena is smaller on both"` → `cameraBoundsOf({ width: 1280, height: 720 }, { width: 1280, height: 720 }, 0.8)` equals `{ x: -160, y: -90, w: 1600, h: 900 }`.
  - `"paints the border colour behind a tile arena"` / `"keeps the floor colour behind a non-tile arena"` for `cameraBackgroundOf` (use `ARENA_01` and `ARENA_03` from shared).

- [ ] **Step 2: Run to verify failure:** `npx vitest run packages/client/src/camera/bounds.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** both functions in `bounds.ts`. Per axis: `seen = view / zoom`; if `seen > arena + 1e-6` the bounds span `seen` starting at `-(seen - arena) / 2`, else they are `0..arena`. `cameraBackgroundOf` returns `colors.border` when `arena.tiles` is set, else `colors.floor`. Doc comment cites BAR14/BAR15 and why (Phaser 4.2.1 `clampX`/`clampY` pin a too-small bounds to its origin).

- [ ] **Step 4: Wire into `ArenaScene`.** Replace `cam.setBackgroundColor(colors.floor)` with `cameraBackgroundOf(arena, colors)` and both `setBounds(0, 0, arena.width, arena.height)` calls with `cameraBoundsOf(arena, { width: ARENA_VIEW_WIDTH, height: VIEW_HEIGHT }, camera().zoom)` spread into `setBounds(x, y, w, h)`. Leave `removeBounds()` and `clampFreeCamFocus` as they are. Update the comment above `setBounds` ("Stops the soft follow from panning past the arena edge") to say it also centres an arena smaller than the view.

- [ ] **Step 5: BAR16 audit (read, don't change unless broken):** the FOV dim size (`ArenaScene` ~3295), `cssDeltaToWorld`/aim offset (`input/aim-offset.ts`), `clampFreeCamFocus` + `panCamera`, `syncRespawnCamera`, hit-stop. Each already reads zoom or the arena rect; confirm none assumes bounds start at 0 or equal the arena. Put one line per item in the task report.

- [ ] **Step 6: Verify:** `npx vitest run packages/client/src/camera/bounds.test.ts` PASS; `npm run test:client` PASS; `npm run test:guards` PASS (no raw config read introduced).

- [ ] **Step 7: Commit** `feat(client): centre an arena smaller than the camera view; border-colour band (BAR14, BAR15)`.

---

### Task 2: Resize arena-01 and arena-02 to 40 × 22

**Files:**
- Modify: `packages/shared/src/arena/arena-01.ts`, `packages/shared/src/arena/arena-02.ts`
- Modify: `packages/shared/src/arena/arena-01.test.ts`, `packages/shared/src/arena/arena-02.test.ts`
- Modify: `packages/server/src/bot/view.test.ts` (B17 block: corner positions 1240/680 → derived from the arena, e.g. `arena.width - 40`, `arena.height - 40`; test names drop "1280x720")

**Interfaces:**
- Consumes: nothing new. Produces: `ARENA_01`, `ARENA_02` with `width 1600`, `height 880`.

- [ ] **Step 1: Update the tests first** with the spec's values:
  - grid: `40 x 22`, no polygon; floor `1520 x 800` at x 40..1560, y 40..840 inside a one-tile ring; mirror-symmetric (existing assertions, new numbers).
  - arena-01 edge row exactly `####^^^^^^####^^^^####^^^^####^^^^^^####` (BAR8, by behaviour key), side spike rows exactly `[4, 5, 10, 11, 16, 17]` on both columns (BAR9). Spike run count: re-derive (top 4 + bottom 4 + left 3 + right 3 = 14 — unchanged).
  - shape test renamed `"is 1600x880, shown whole at zoom 0.8"` → `width 1600, height 880`.
  - arena-01 FFA spawns `[(243,215,0),(1357,215,π),(243,665,0),(1357,665,π),(800,215,π/2),(800,665,-π/2)]`; team A x 243 angle 0, team B x 1357 angle π, ys `[240, 440, 640]` (BAR10).
  - arena-02 FFA spawns `[(243,224,0),(1357,224,π),(243,669,0),(1357,669,π),(800,224,π/2),(800,669,-π/2)]`; team spawns as arena-01 (BAR13).
  - keep "every spawn on the floor" and "clears every spike strip by more than a car diagonal".

- [ ] **Step 2: Run to verify failure:** `npx vitest run packages/shared/src/arena/arena-0[12].test.ts` → FAIL on size/spawns.

- [ ] **Step 3: Implement** the grids per BAR8/BAR9/BAR12 (arena-01: new `EDGE`, `PLAIN`/`SPIKED` 38 interior cells, 22 rows with spike rows 4–5, 10–11, 16–17; arena-02: `EDGE`/`FLOOR_ROW` with 38 interior cells, 22 rows) and the spawn tables above. Rewrite header and spawn comments per BAR11/BAR13 (new floor rect, "sized so zoom 0.8 shows it whole", new clearance figures; drop "1280x720 is the client's logical canvas").

- [ ] **Step 4: Verify:** `npm run build -w @motor-combat-moba/shared`; `npm run test:shared` PASS; `npx vitest run packages/server/src/bot/view.test.ts` PASS (note: at zoom 1 still, the 1600 × 880 arenas do NOT fit a 1280 × 720 viewport — if the B17 tests fail here, that is expected until Task 3; do the edits so they pass after Task 3 and say so in the commit).

- [ ] **Step 5: Commit** `feat(arena): grow arena-01 and arena-02 to 40x22 tiles (BAR1, BAR8–BAR13)`.

---

### Task 3: Zoom 0.8 in the base, Conquer pinned to 1, snapshots and comment drift

**Files:**
- Modify: `packages/shared/src/config/drive-config.ts` (`CAMERA_CONFIG.zoom`, its doc block ~341–345, `LOGICAL_CANVAS` doc ~430–446)
- Modify: `packages/shared/src/modes/conquer/config.ts` (`camera.zoom: 1`)
- Modify: `packages/shared/src/modes/__snapshots__/{brawl,deathmatch,team-brawl}.tables.json` (via scoped `-u`)
- Modify (comments only): `packages/server/src/bot/view.ts` (~64–81, ~91, ~108–113), `packages/client/src/scenes/combat-visual.ts` (`BOLT_VISIBLE_TEAR` doc), `packages/client/src/scenes/ribbon-fill.ts` (`DISC_SEGMENTS_PER_UNIT` doc)

**Interfaces:** Consumes Task 2's arenas. Produces `camera().zoom === 0.8` for Brawl/Deathmatch/Team brawl, `1` for Conquer.

- [ ] **Step 1: Make the edits** (BAR5, BAR6). Conquer comment: `arena-03` is 1280 × 2160, one screen wide at zoom 1, scrolling vertically. Comment-drift per BAR18: at 0.8 a world unit is 0.8 px, so the two client thresholds are now conservative — no value change.

- [ ] **Step 2: Verify the snapshot moves are exactly the expected ones:** `npx vitest run packages/shared/src/modes/snapshots.test.ts` → FAIL on brawl, deathmatch, team-brawl only (`zoom: 1 → 0.8`); conquer PASSES. If conquer fails, stop: the override is wrong.

- [ ] **Step 3: Accept the three:** `npx vitest run packages/shared/src/modes/snapshots.test.ts -u -t "<brawl|deathmatch|team-brawl test names>"` (scoped; never blanket). `git diff --stat` must show only those three JSON files moved, each by one line.

- [ ] **Step 4: Verify:** `npm run build -w @motor-combat-moba/shared`; `npm run test:mode -- conquer`; `npx vitest run packages/server/src/bot/view.test.ts` PASS (B17 fits again: viewport 1600 × 900).

- [ ] **Step 5: Commit** `feat(modes): default camera zoom 0.8; Conquer keeps 1 (BAR5–BAR7, BAR17, BAR18)`.

---

### Task 4: Owed regeneration, full verification, probe report

**Files:**
- Modify: `packages/client/public/manual.html` (generated)
- Possibly modify: probe files under `packages/server/playtest/` — **only** compile breaks or a probe that no longer reaches its code path; each named in the commit and the report.

- [ ] **Step 1:** `npm run build` (root; shared → server → client). Check the inlined path comment in `packages/server/dist/index.js` is `// ../shared/dist/…`.
- [ ] **Step 2:** `npm run build:manual`; `git diff --stat packages/client/public/manual.html` shows a change (reach percentages). Commit `docs(manual): rebuild for 1520-wide arena floor`.
- [ ] **Step 3:** `npm test` → PASS (includes turn-tuning doc test — expected unchanged; if it fails, the failure names the cell — fix the doc, don't touch the test).
- [ ] **Step 4:** `npm run test:slow` → PASS. A failure here that is a calibration bound moved by the bigger arena (not an invariant) is reported to the owner, not edited.
- [ ] **Step 5:** `npm run playtest -- --mode=brawl --scope=all`, then `--mode=deathmatch`, then `--mode=conquer`. Collect every verdict that differs from a run on the commit before Task 2 (`git stash`-free: run the baseline on `1fe6aef` in a temporary worktree if needed, after `npm install` there). List each moved probe and number.
- [ ] **Step 6:** Commit any compile-break fixes (`fix(playtest): …`), then push: `git push -u origin feature/bigger-brawl-arena`.
- [ ] **Step 7:** Report to the owner, loudly: probe numbers that moved; balance baselines now refused in all three active modes (BAR §6); sprite shimmer check pending in the browser at `http://localhost:5173`.
