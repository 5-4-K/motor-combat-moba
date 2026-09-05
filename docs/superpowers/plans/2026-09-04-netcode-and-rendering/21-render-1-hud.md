# Rendering Phase V1: HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the whole HUD into a parallel `HudScene` of retained sprites and `BitmapText`, drawn from baked textures, so the gutter costs a handful of transforms per frame instead of ~1,830 tessellated points and 54 canvas-backed `Text` textures — and delete `ArenaLayers` and its camera ignore lists on the way out.

**Architecture:** Three new seams. `render/fonts.ts` plus a generated, committed bitmap font retire every `Text` object in the arena. `render/bake.ts` runs once in `BootScene`, draws the slot ring, its wash, the two procedural glyphs, the key pill and a 90-frame cooldown sweep sheet into a `baked-atlas` `DynamicTexture` through the *same* pure builders the HUD draws with today, and registers a named frame per job. `scenes/HudScene.ts` is a second scene launched by `ArenaScene`, with its own full-canvas camera, reading the `RenderFrame` the arena publishes on the game registry; every HUD element is a long-lived object whose properties are set per frame and never re-created. With the HUD out of `ArenaScene`, the arena has one camera and `ArenaLayers` is deleted outright.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest in the node environment, Phaser 4.2.1 (`BitmapText`, `DynamicTexture`, `NineSlice`), `node --test` for `scripts/*.test.mjs`, Playwright 1.62.1 (the bitmap-font rasteriser and the bench runner).

**Spec:** [`../../specs/2026-09-04-client-rendering-architecture-design.md`](../../specs/2026-09-04-client-rendering-architecture-design.md) — §1 (what the shipped HUD costs), §2 (`BitmapText`, `DynamicTexture`, the quad batch), §3 R1/R3/R6, §4 (the render stack, rows H0–H2), §5 (the catalogue's HUD row), §6 R13 (`bake.ts`), §8 R20 (the HUD is its own scene), §9 R23/R25, §10 the V1 row, §11. Ledger: [`interfaces.md`](interfaces.md) — `scenes/HudScene.ts`, `render/fonts.ts`, `render/bake.ts`, `render/atlas.ts`. Prior plans, both assumed **landed**: [`01-prep-arena-scene-split-and-render-frame.md`](01-prep-arena-scene-split-and-render-frame.md) (the `ArenaScene` split, `RenderFrame`, `match/frame-builder.ts`, `scenes/arena/*`, `scripts/smoke-arena.mjs`) and [`20-render-0-instrumentation.md`](20-render-0-instrumentation.md) (`?debug=perf`, `PerfOverlay`, `dev/BenchScene.ts`, `scripts/bench-visual.mjs`, `scripts/bench-arena.mjs`, `docs/render-bench.md` and the recorded V0 baseline — **read its `## Handoff` section before starting**; every number V1 must beat is there, and the bench scene is where V1's numbers are measured).

## Global Constraints

- Rebuild shared before testing (`npm run build -w @motor-combat-moba/shared`).
- Verify with root `npm test`, never a per-workspace run alone.
- `.js` import specifiers on every local import; shared is imported as `@motor-combat-moba/shared` and consumed as built `dist`.
- Nothing under `packages/client/src/match/` imports Phaser and no test imports Phaser. This plan adds four more Phaser-free modules for the same reason — `render/fonts.ts`, `render/hud-feed.ts`, `scenes/hud/hud-style.ts` and `scenes/hud/slot-model.ts` — each with a vitest node test. `render/bake.ts` is split so its job list and its packer are Phaser-free and only `bakeAtlas` itself touches the scene.
- Do not touch `packages/server/playtest/` except to fix a compile break, and say loudly in the task's commit step which probe numbers your change moves. **This plan moves none:** it changes only how the client draws the gutter. No probe imports a client scene, and nothing here touches `sim/`, a table, the tick order, prediction, or step-context assembly.
- Do not edit `docs/ideas/` or `docs/invariants/`.
- Commit after every task on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch off it). In a fresh worktree run `npm install` before the first build.
- No magic numbers in logic: every colour, alpha, pad, frame count, sheet size and font size is a named constant in `scenes/hud/hud-style.ts`, `render/fonts.ts` or `render/bake.ts`. Two literals that exist today as *measured* numbers — `HUD_COUNTDOWN_KEY_OFFSET_PX` and the key pill's height — become derived from the font's own metrics in Task 4 and their hand-measured comments go with them.
- No balance table, drive constant, `TICK_RATE_HZ`, weapon row, status row, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `AIM_CONFIG.lockRange` or `ARENA_WIDTH` changes here, so neither `npm run build:manual` nor `docs/turn-tuning.md` is owed an edit. If a diff touches one by accident, stop.
- **Only the netcode stream edits `packages/shared`.** This plan edits none of it.
- The generated font pages (`packages/client/public/art/fonts/*.png`, `*.xml`) are **committed artefacts**, like `packages/client/public/manual.html`. They are rewritten only by `npm run build:font`, never by hand.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/build-bitmap-font.mjs` (create) | Rasterises the two font pages and writes `hud-font{,-bold}.{png,xml}`; exports the pure grid/XML helpers |
| `scripts/build-bitmap-font.test.mjs` (create) | `node --test` over those helpers |
| `packages/client/public/art/fonts/hud-font.png`, `.xml`, `hud-font-bold.png`, `.xml` (create) | The generated, committed font pages |
| `packages/client/src/render/fonts.ts` (create) | `HUD_FONT`, `HUD_FONT_BOLD`, the page paths, the charset, `hudSafeText`, `hudFontMetrics`, `textHeightFor` |
| `packages/client/src/scenes/BootScene.ts` (modify) | `preload()` loads both fonts; `create()` bakes the atlas before anything else runs |
| `packages/client/src/render/atlas.ts` (create) | `BAKED_ATLAS` — the texture key V2 extends with `ART_ATLAS` and the packer |
| `packages/client/src/render/bake.ts` (create) | `BakeTier`, `BakeGraphics`, `bakeJobs`, `packShelf`, `bakeAtlas`; the ring, wash, glyph, pill and 90-frame sweep jobs |
| `packages/client/src/render/bake.test.ts` (create) | Job list, job geometry and packer, against a recording stub |
| `packages/client/src/render/hud-feed.ts` (create) | The registry contract between the two scenes: `HUD_FRAME_KEY`, `HudView`, `publishHudFrame`, `readHudFrame`, `readHudView`, `readHudPerf` |
| `packages/client/src/scenes/HudScene.ts` (create) | The parallel scene: builds the views, reads the feed, updates them |
| `packages/client/src/scenes/hud/hud-style.ts` (create) | Every HUD paint constant, as numbers; moved out of `hud-renderer.ts` |
| `packages/client/src/scenes/hud/slot-model.ts` (create) | Pure: `SWEEP_FRAMES`, `sweepFrameIndex`, `washAlpha`, `ringAlpha`, `sweepAlpha`, `pillHeightFor`, `countdownKeyOffset` |
| `packages/client/src/scenes/hud/slot-bar.ts` (create) | `SlotBarView` / `SlotView`: the retained slot column |
| `packages/client/src/scenes/hud/status-strip.ts` (create) | `StatusStripView`: the retained badge strip |
| `packages/client/src/scenes/hud/roster-view.ts` (create) | `RosterView`: the retained roster panel |
| `packages/client/src/scenes/hud/match-banners.ts` (move) | `MatchBanners`, moved from `scenes/arena/` and converted to `BitmapText` + `NineSlice` |
| `packages/client/src/scenes/arena/hud-renderer.ts` (delete, Task 4) | Its constants move to `hud-style.ts`, its draw code to the views and the bake jobs |
| `packages/client/src/scenes/arena/arena-layers.ts` (delete, Task 3) | With one camera in the arena there is nothing to ignore |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | Launches `HudScene`, publishes the feed, loses `ArenaLayers`, `HudRenderer`, `MatchBanners` and `syncBanners` |
| `packages/client/src/scenes/arena/{car-renderer,shot-renderer,arena-floor}.ts` (modify) | Constructor and signature changes as `ArenaLayers` goes |
| `packages/client/src/render/perf-overlay.ts` (modify) | Its `Text` becomes a `BitmapText` on a baked plate |
| `packages/client/src/dev/BenchScene.ts` (modify) | Launches `HudScene`; marker becomes `BitmapText`; publishes the census |
| `packages/client/src/main.ts` (modify) | Registers `HudScene` after `ArenaScene` |
| `scripts/check-art.mjs`, `scripts/check-art.test.mjs` (modify) | The `fonts/` subtree is not manifest art |
| `scripts/bench-arena.mjs` (modify) | Prints and enforces the object census |
| `scripts/hud-retained.test.mjs` (create) | Source guard: no `Graphics` and no `Text` under the HUD |
| `docs/render-bench.md`, `CLAUDE.md`, `packages/client/CLAUDE.md`, `docs/project-structure.md` (modify) | The V1 numbers beside V0's, and the new seams |
| `package.json` (modify) | `build:font` |

---

### Task 1: The HUD bitmap font

**Files:**
- Create: `scripts/build-bitmap-font.mjs`
- Test: `scripts/build-bitmap-font.test.mjs`
- Create: `packages/client/public/art/fonts/hud-font.png`, `hud-font.xml`, `hud-font-bold.png`, `hud-font-bold.xml` (generated)
- Create: `packages/client/src/render/fonts.ts`
- Test: `packages/client/src/render/fonts.test.ts`
- Modify: `packages/client/src/scenes/BootScene.ts:30-33` (add `preload`)
- Modify: `scripts/check-art.mjs:99-109`, `scripts/check-art.test.mjs:241-254`
- Modify: `package.json` (root)

**Interfaces:**
- Produces: `HUD_FONT = "hud-font"`, `HUD_FONT_BOLD = "hud-font-bold"`, `HUD_FONT_PAGES`, `HUD_CHARSET`, `hudSafeText(text): string`, `hudFontMetrics(cache, key): HudFontMetrics`, `textHeightFor(fontPx, metrics): number`, `HudFontMetrics { size: number; lineHeight: number }`. Tasks 2–5 consume all of them.

Why a bitmap font at all: every `Text` owns a canvas-backed GL texture, and `setText` with a changed string re-rasterises and re-uploads it (spec §1). The arena carries **54** of them against 12 art PNGs. A `BitmapText` is glyph quads out of one page texture; `setText` rebuilds quads and uploads nothing (§2).

**Which font, and how it is produced.** The sheet is rasterised from the CSS stack `"DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace` by headless Chromium — Playwright is already a root dev dependency (the preparation plan's Task 10). Monospace is not taste: `roster-panel.ts:117` already prices the name column as `ROSTER_NAME_CHAR_PX = ROSTER_NAME_FONT_PX * 0.6`, and `weapon-hud.ts:45-47` reserves `SLOT_KEY_COLUMN_PX = 60` from a measured "space" at 14 px. DejaVu Sans Mono's advance is 0.602 em, so "SPACE" at `SLOT_KEY_FONT_PX` 14 is 42.1 px and the pill is 42.1 + 2 × `HUD_KEY_PILL_PAD_X` = 58.1 px — inside the 60 px the layout reserves. Every existing layout number survives the swap.

Two faces, because `HUD_NAME_FONT_STYLE` is `"bold"` and a bitmap font has one weight: `hud-font` at 96 px (its largest consumer is the countdown numeral, `ArenaScene.ts:807`, and everything else minifies from it) and `hud-font-bold` at 32 px (its only consumer is the weapon name at `SLOT_NAME_FONT_PX` 12).

**The charset.** Printable ASCII 32–126, plus the five non-ASCII code points the HUD actually prints: `—` (U+2014, the spectate banner) and `← ↑ → ↓` (U+2190–2193, `MOVEMENT_ARROWS` in `scenes/movement-hint.ts:22`). 100 glyphs. `BitmapText` silently drops a glyph it has no quad for, so `hudSafeText` maps anything else to `?` before a string reaches the HUD — a player name in a script the sheet does not carry degrades to question marks instead of vanishing.

- [ ] **Step 1: Write the failing test for the pure half of the generator**

```js
// scripts/build-bitmap-font.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  CELL_PAD_PX,
  HUD_CHARSET_CODES,
  charRecords,
  fontXml,
  sheetGrid,
} from "./build-bitmap-font.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDir = path.join(rootDir, "packages", "client", "public", "art", "fonts");

const GRID = { codes: HUD_CHARSET_CODES, cellWidth: 70, cellHeight: 124, columns: 14 };

describe("the sheet's arithmetic", () => {
  it("carries printable ASCII plus the five code points the HUD prints", () => {
    assert.equal(HUD_CHARSET_CODES.length, 100);
    assert.equal(HUD_CHARSET_CODES[0], 32);
    assert.equal(HUD_CHARSET_CODES[94], 126);
    assert.deepEqual(HUD_CHARSET_CODES.slice(95), [0x2014, 0x2190, 0x2191, 0x2192, 0x2193]);
  });

  it("fills rows left to right and reports whether the sheet holds them", () => {
    assert.deepEqual(sheetGrid({ glyphs: 100, cellWidth: 70, cellHeight: 124, sheetPx: 1024 }), {
      columns: 14,
      rows: 8,
      fits: true,
    });
    assert.equal(sheetGrid({ glyphs: 100, cellWidth: 70, cellHeight: 260, sheetPx: 1024 }).fits, false);
  });

  it("places the first glyph at the origin and wraps after a full row", () => {
    const records = charRecords({ ...GRID, advances: HUD_CHARSET_CODES.map(() => 58) });
    assert.equal(records.length, 100);
    assert.deepEqual(records[0], {
      id: 32, x: 0, y: 0, width: 70, height: 124,
      xoffset: -CELL_PAD_PX, yoffset: 0, xadvance: 58, page: 0, chnl: 15,
    });
    assert.equal(records[13].x, 13 * 70);
    assert.deepEqual(records[14], {
      id: 46, x: 0, y: 124, width: 70, height: 124,
      xoffset: -CELL_PAD_PX, yoffset: 0, xadvance: 58, page: 0, chnl: 15,
    });
  });

  it("declares the line height Phaser reads, and one row per char", () => {
    const xml = fontXml({
      face: "hud-font",
      sizePx: 96,
      lineHeight: 124,
      base: 92,
      sheetPx: 1024,
      pageFile: "hud-font.png",
      chars: charRecords({ ...GRID, codes: [65], advances: [58] }),
    });
    assert.match(xml, /<info face="hud-font" size="96"/);
    assert.match(xml, /<common lineHeight="124" base="92" scaleW="1024" scaleH="1024" pages="1"/);
    assert.match(xml, /<chars count="1">/);
    assert.match(xml, /<char id="65" x="0" y="0" width="70" height="124" xoffset="-4" yoffset="0" xadvance="58" page="0" chnl="15"\/>/);
  });
});

describe("the font pages this repo ships", () => {
  it("has both faces on disk with a page each", () => {
    for (const face of ["hud-font", "hud-font-bold"]) {
      const xml = fs.readFileSync(path.join(fontDir, `${face}.xml`), "utf8");
      assert.match(xml, new RegExp(`<page id="0" file="${face}.png"`));
      assert.match(xml, /<chars count="100">/);
      assert.ok(fs.statSync(path.join(fontDir, `${face}.png`)).size > 0);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/build-bitmap-font.test.mjs`
Expected: FAIL — cannot resolve `./build-bitmap-font.mjs`.

- [ ] **Step 3: Write the generator**

```js
// scripts/build-bitmap-font.mjs
//
// Writes the HUD's two bitmap-font pages: `packages/client/public/art/fonts/hud-font{,-bold}.png`
// and the matching AngelCode XML Phaser's `load.bitmapFont` parses.
//
// GENERATED AND COMMITTED, like `packages/client/public/manual.html`. Run `npm run build:font`
// after changing the charset, a face, or a bake size — never edit the four files by hand.
//
// Rasterising needs a text engine, and the repo already has exactly one, headless and installed:
// Chromium under Playwright (`scripts/smoke-arena.mjs`, `scripts/bench-arena.mjs`). It draws each
// glyph into a fixed cell and hands back the PNG and the advances; everything else is arithmetic
// and is unit-tested without a browser. The grid is uniform because the face is monospace, which is
// load-bearing: `roster-panel.ts` prices its name column at 0.6 em per character and
// `weapon-hud.ts` reserves the key column from a measured "space", so a proportional face would
// silently break two layouts no test can see.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Transparent margin around each glyph's ink, so an overhanging stroke is never clipped. */
export const CELL_PAD_PX = 4;

/** The sheet is square and a power of two, so V5 can turn on mipmaps for it (spec R17). */
export const SHEET_PX = { regular: 1024, bold: 512 };

/**
 * Every code point the HUD can print: printable ASCII, plus the em dash the spectate banner uses
 * and the four arrows `MOVEMENT_ARROWS` prints. Anything else is mapped to "?" by `hudSafeText`
 * before it reaches a `BitmapText`, because Phaser draws no quad for a glyph it does not have.
 */
export const HUD_CHARSET_CODES = (() => {
  const codes = [];
  for (let code = 32; code <= 126; code++) codes.push(code);
  return [...codes, 0x2014, 0x2190, 0x2191, 0x2192, 0x2193];
})();

export const FACES = [
  { face: "hud-font", sizePx: 96, weight: "normal", sheetPx: SHEET_PX.regular },
  { face: "hud-font-bold", sizePx: 32, weight: "bold", sheetPx: SHEET_PX.bold },
];

export const FONT_STACK = '"DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace';

/** How many glyphs fit across, how many rows that needs, and whether the sheet is tall enough. */
export function sheetGrid({ glyphs, cellWidth, cellHeight, sheetPx }) {
  const columns = Math.floor(sheetPx / cellWidth);
  const rows = columns > 0 ? Math.ceil(glyphs / columns) : 0;
  return { columns, rows, fits: columns > 0 && rows * cellHeight <= sheetPx };
}

/**
 * One `<char>` per code point, on the uniform grid.
 *
 * The quad is the whole cell rather than the glyph's ink box, which is why `xoffset` is
 * `-CELL_PAD_PX` and `yoffset` is 0: the pen sits `CELL_PAD_PX` inside the cell, and the cell's top
 * IS the line's top because `lineHeight` is written as the cell height. That equality makes
 * `BitmapText.height` for one line exactly `fontPx * lineHeight / size`, which is what
 * `slot-model.ts` derives the key pill's height from.
 */
export function charRecords({ codes, advances, cellWidth, cellHeight, columns }) {
  return codes.map((id, index) => ({
    id,
    x: (index % columns) * cellWidth,
    y: Math.floor(index / columns) * cellHeight,
    width: cellWidth,
    height: cellHeight,
    xoffset: -CELL_PAD_PX,
    yoffset: 0,
    xadvance: advances[index],
    page: 0,
    chnl: 15,
  }));
}

export function fontXml({ face, sizePx, lineHeight, base, sheetPx, pageFile, chars }) {
  const rows = chars
    .map(
      (c) =>
        `    <char id="${c.id}" x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}"` +
        ` xoffset="${c.xoffset}" yoffset="${c.yoffset}" xadvance="${c.xadvance}" page="0" chnl="15"/>`,
    )
    .join("\n");
  return [
    '<?xml version="1.0"?>',
    "<font>",
    `  <info face="${face}" size="${sizePx}" bold="0" italic="0" charset="" unicode="1" stretchH="100" smooth="1" aa="1" padding="0,0,0,0" spacing="0,0"/>`,
    `  <common lineHeight="${lineHeight}" base="${base}" scaleW="${sheetPx}" scaleH="${sheetPx}" pages="1" packed="0"/>`,
    "  <pages>",
    `    <page id="0" file="${pageFile}"/>`,
    "  </pages>",
    `  <chars count="${chars.length}">`,
    rows,
    "  </chars>",
    "</font>",
    "",
  ].join("\n");
}

/** Draws one face in the browser and returns its PNG bytes plus the metrics the XML needs. */
async function rasterise(page, { sizePx, weight, sheetPx }) {
  return page.evaluate(
    ({ codes, sizePx, weight, sheetPx, pad, stack }) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = sheetPx;
      const ctx = canvas.getContext("2d");
      ctx.font = `${weight} ${sizePx}px ${stack}`;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";

      const chars = codes.map((code) => String.fromCodePoint(code));
      const advances = chars.map((ch) => ctx.measureText(ch).width);
      const probe = ctx.measureText("M");
      const ascent = Math.ceil(probe.fontBoundingBoxAscent);
      const cellWidth = Math.ceil(Math.max(...advances)) + pad * 2;
      const cellHeight = ascent + Math.ceil(probe.fontBoundingBoxDescent) + pad * 2;
      const columns = Math.floor(sheetPx / cellWidth);
      chars.forEach((ch, i) => {
        ctx.fillText(ch, (i % columns) * cellWidth + pad, Math.floor(i / columns) * cellHeight + pad + ascent);
      });
      return {
        png: canvas.toDataURL("image/png").split(",")[1],
        advances: advances.map((a) => Math.round(a)),
        cellWidth,
        cellHeight,
        base: pad + ascent,
      };
    },
    { codes: HUD_CHARSET_CODES, sizePx, weight, sheetPx, pad: CELL_PAD_PX, stack: FONT_STACK },
  );
}

export async function main() {
  const { chromium } = await import("playwright");
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = path.join(rootDir, "packages", "client", "public", "art", "fonts");
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    for (const { face, sizePx, weight, sheetPx } of FACES) {
      const r = await rasterise(page, { sizePx, weight, sheetPx });
      const glyphs = HUD_CHARSET_CODES.length;
      const grid = sheetGrid({ glyphs, cellWidth: r.cellWidth, cellHeight: r.cellHeight, sheetPx });
      if (!grid.fits) {
        throw new Error(`${face}: ${glyphs} cells of ${r.cellWidth}x${r.cellHeight} do not fit a ${sheetPx}px sheet`);
      }
      // A second advance means a fallback face supplied a glyph and the sheet is no longer strictly
      // monospace — the two layouts that price themselves per character want re-checking.
      const spread = new Set(r.advances).size;
      if (spread !== 1) console.warn(`[font] ${face}: ${spread} distinct advances`);

      const chars = charRecords({
        codes: HUD_CHARSET_CODES,
        advances: r.advances,
        cellWidth: r.cellWidth,
        cellHeight: r.cellHeight,
        columns: grid.columns,
      });
      fs.writeFileSync(path.join(outDir, `${face}.png`), Buffer.from(r.png, "base64"));
      fs.writeFileSync(
        path.join(outDir, `${face}.xml`),
        fontXml({ face, sizePx, lineHeight: r.cellHeight, base: r.base, sheetPx, pageFile: `${face}.png`, chars }),
      );
      console.log(
        `${face}: ${glyphs} glyphs, cell ${r.cellWidth}x${r.cellHeight}, advance ${r.advances[0]}, ${grid.columns}x${grid.rows} on ${sheetPx}px`,
      );
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
```

- [ ] **Step 4: Generate and inspect the pages**

Add to root `package.json` scripts, after `build:manual`:

```json
"build:font": "node scripts/build-bitmap-font.mjs",
```

Run:

```bash
npm run build:font
ls -l packages/client/public/art/fonts/
```

Expected: two lines of output naming the cell size, the advance and the grid; four files on disk. Open `hud-font.png` and confirm a grid of white glyphs on transparency with no clipping at any cell edge. Record the printed cell height and advance — Task 4's derived pill height reads them back off the XML at runtime, so nothing is retyped, but the numbers are worth eyeballing once.

- [ ] **Step 5: Run the generator test**

Run: `node --test scripts/build-bitmap-font.test.mjs`
Expected: PASS, including the "the font pages this repo ships" case now that the files exist.

- [ ] **Step 6: Write the failing test for `render/fonts.ts`**

```ts
// packages/client/src/render/fonts.test.ts
import { describe, expect, it } from "vitest";
import { HUD_FONT, HUD_FONT_BOLD, hudFontMetrics, hudSafeText, textHeightFor } from "./fonts.js";

describe("hudSafeText", () => {
  it("returns the same string when every glyph is on the sheet", () => {
    const text = "Spectating Kaz — [ ] to switch";
    expect(hudSafeText(text)).toBe(text);
    expect(hudSafeText("↑ ← ↓ →")).toBe("↑ ← ↓ →");
  });

  it("replaces a glyph the sheet has no quad for, astral ones as one glyph", () => {
    expect(hudSafeText("Ярослав")).toBe("???????");
    expect(hudSafeText("a🚗b")).toBe("a?b");
  });
});

describe("font metrics", () => {
  it("scales the line height to the drawn size", () => {
    expect(textHeightFor(14, { size: 96, lineHeight: 124 })).toBeCloseTo(18.0833, 4);
    expect(textHeightFor(96, { size: 96, lineHeight: 124 })).toBe(124);
  });

  it("reads size and line height out of the loaded font", () => {
    const cache = { get: () => ({ data: { size: 96, lineHeight: 124, extra: 1 } }) };
    expect(hudFontMetrics(cache, HUD_FONT)).toEqual({ size: 96, lineHeight: 124 });
  });

  it("throws when the font was never loaded, rather than drawing at a guessed size", () => {
    expect(() => hudFontMetrics({ get: () => null }, HUD_FONT_BOLD)).toThrow(/hud-font-bold/);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/render/fonts.test.ts`
Expected: FAIL — cannot resolve `./fonts.js`.

- [ ] **Step 8: Write `render/fonts.ts`**

```ts
// packages/client/src/render/fonts.ts
/**
 * The HUD's two bitmap fonts, and the one rule for text that reaches them.
 *
 * Every `Text` object owns a canvas-backed GL texture and re-rasterises it on any changed string or
 * touched style (rendering spec §1); the arena carried 54 of them against 12 art PNGs. A
 * `BitmapText` is glyph quads out of one page texture, batched with every other quad, and `setText`
 * uploads nothing (§2). That is the whole reason these files exist.
 *
 * Both pages are GENERATED AND COMMITTED by `scripts/build-bitmap-font.mjs` (`npm run build:font`).
 * Nothing here may be edited to "fix" a glyph: fix the generator and regenerate.
 */

export const HUD_FONT = "hud-font";
/** One weight is all a bitmap font has, and the weapon name's bold needed a second one. */
export const HUD_FONT_BOLD = "hud-font-bold";

/** Loader paths, relative to the client's `public/` root, as `BootScene.preload` passes them. */
export const HUD_FONT_PAGES = [
  { key: HUD_FONT, png: "art/fonts/hud-font.png", xml: "art/fonts/hud-font.xml" },
  { key: HUD_FONT_BOLD, png: "art/fonts/hud-font-bold.png", xml: "art/fonts/hud-font-bold.xml" },
] as const;

/**
 * Every code point on the sheets: printable ASCII, the em dash the spectate banner sets its clauses
 * with, and the four arrows `MOVEMENT_ARROWS` prints. Kept in step with the generator's
 * `HUD_CHARSET_CODES` by hand; `hudSafeText` is what keeps a mismatch cosmetic rather than
 * invisible.
 */
const SHEET_CODES: ReadonlySet<number> = new Set([
  ...Array.from({ length: 95 }, (_, i) => 32 + i),
  0x2014, 0x2190, 0x2191, 0x2192, 0x2193,
]);

export const HUD_FALLBACK_GLYPH = "?";

/**
 * `text` with every code point the sheets do not carry replaced by `?`.
 *
 * Phaser draws no quad for a missing glyph, so an unsanitised name in a script the sheet lacks
 * would simply not appear — a blank roster row nobody could explain. A player name is the only
 * string reaching the HUD unfiltered. Allocation-free in the common case: the scan returns the
 * argument itself, and the frame path calls this only when a string has actually changed.
 */
export function hudSafeText(text: string): string {
  let safe = true;
  for (const glyph of text) {
    if (!SHEET_CODES.has(glyph.codePointAt(0)!)) {
      safe = false;
      break;
    }
  }
  if (safe) return text;
  let out = "";
  for (const glyph of text) {
    out += SHEET_CODES.has(glyph.codePointAt(0)!) ? glyph : HUD_FALLBACK_GLYPH;
  }
  return out;
}

/** The two numbers off a loaded page the HUD's layout derives from: its bake size and line box. */
export interface HudFontMetrics {
  readonly size: number;
  readonly lineHeight: number;
}

/** The structural shape of `Phaser.Cache.BaseCache` this needs, so no test imports Phaser. */
export interface BitmapFontCache {
  get(key: string): { data?: { size?: number; lineHeight?: number } } | null | undefined;
}

/**
 * The metrics of a loaded page. Throws rather than guessing: every caller runs after
 * `BootScene.preload`, so a miss means the page failed to load, and a guessed size would put the
 * whole gutter half a pill out of place with nothing to point at.
 */
export function hudFontMetrics(cache: BitmapFontCache, key: string): HudFontMetrics {
  const data = cache.get(key)?.data;
  if (!data || typeof data.size !== "number" || typeof data.lineHeight !== "number") {
    throw new Error(`bitmap font "${key}" is not loaded`);
  }
  return { size: data.size, lineHeight: data.lineHeight };
}

/**
 * What one line of `BitmapText` measures at `fontPx`. Exact, not an estimate: the generator writes
 * `lineHeight` as the cell height and gives every glyph the whole cell as its quad, so a single
 * line's bounds are the cell scaled by `fontPx / size`.
 */
export function textHeightFor(fontPx: number, metrics: HudFontMetrics): number {
  return (fontPx * metrics.lineHeight) / metrics.size;
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd packages/client && npx vitest run src/render/fonts.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 10: Load both pages in `BootScene`**

`BootScene` has no `preload` today (`packages/client/src/scenes/BootScene.ts:30-33`). Add one, so Phaser blocks on the two pages before *any* `create` runs and no later scene has to check whether a font arrived:

```ts
  /**
   * The HUD's bitmap fonts, loaded before anything draws.
   *
   * Deliberately `preload` rather than the manifest loader in `loadArt`: art may arrive late and
   * falls back to a procedural silhouette, but a missing font has no fallback — a `BitmapText`
   * with no page draws nothing at all. Phaser will not call any scene's `create` until this
   * finishes, which is the guarantee `bakeAtlas` and `HudScene` are written against.
   */
  preload(): void {
    for (const page of HUD_FONT_PAGES) this.load.bitmapFont(page.key, page.png, page.xml);
  }
```

Add `import { HUD_FONT_PAGES } from "../render/fonts.js";` to the file's imports.

- [ ] **Step 11: Keep `check:art` quiet about the font pages**

The font PNGs live under `public/art/` (the ledger's path) and are not manifest sprites, so `artFilesOnDisk` would report each as an `orphan-file` warning for ever. Exclude the subtree: in `scripts/check-art.mjs`, add above `artFilesOnDisk` (`:99`) and use it in that function's `walk` (`:104`):

```js
/**
 * Subtrees under the art directory that are not manifest art. `fonts/` holds the generated bitmap
 * font pages (`scripts/build-bitmap-font.mjs`), which no sprite row names and no importer touches.
 */
export const NON_SPRITE_DIRS = ["fonts"];

// replacing `if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel);` with:
      if (entry.isDirectory()) {
        if (rel === "" && NON_SPRITE_DIRS.includes(entry.name)) continue;
        walk(path.join(abs, entry.name), childRel);
      }
```

In `scripts/check-art.test.mjs`, extend the import on `:7` to `{ NON_SPRITE_DIRS, artFilesOnDisk, checkManifestShape, isKnownNamespace }` and add to the `"the art this repo actually ships"` block (`:241`):

```js
  it("does not treat the generated font pages as orphaned art", () => {
    assert.deepEqual(NON_SPRITE_DIRS, ["fonts"]);
    assert.equal(
      artFilesOnDisk(artDir).some((file) => file.startsWith("fonts/")),
      false,
    );
  });
```

- [ ] **Step 12: Verify and commit**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
cd packages/client && npm run typecheck && cd ../..
npm run check:art
```

Expected: every suite green; typecheck clean; `check:art` prints the same findings as before the change (no new orphan warnings).

```bash
git add scripts/build-bitmap-font.mjs scripts/build-bitmap-font.test.mjs \
  packages/client/public/art/fonts packages/client/src/render/fonts.ts \
  packages/client/src/render/fonts.test.ts packages/client/src/scenes/BootScene.ts \
  scripts/check-art.mjs scripts/check-art.test.mjs package.json
git commit -m "feat(client): generated HUD bitmap font, loaded in BootScene

Moves no playtest probe number: no sim, table, tick order or prediction code is touched."
```

---

### Task 2: `render/bake.ts` — the baked ring, glyphs, pill and the 90-frame sweep sheet

**Files:**
- Create: `packages/client/src/render/atlas.ts`
- Create: `packages/client/src/render/bake.ts`
- Test: `packages/client/src/render/bake.test.ts`
- Create: `packages/client/src/scenes/hud/hud-style.ts`
- Create: `packages/client/src/scenes/hud/slot-model.ts`
- Test: `packages/client/src/scenes/hud/slot-model.test.ts`
- Modify: `packages/client/src/scenes/BootScene.ts` (`create`)

**Interfaces:**
- Consumes: Task 1's `HUD_FONT`, `hudFontMetrics`, `textHeightFor`.
- Produces: `BAKED_ATLAS = "baked-atlas"` (`render/atlas.ts`); `BakeTier`, `BAKE_SUPERSAMPLE`, `BAKE_SHEET_PX`, `BakeGraphics`, `BakeJob`, `bakeJobs`, `packShelf`, `bakeAtlas(scene, tier?): Promise<void>`, `bakedFrame(name)` (`render/bake.ts`); every `HUD_*`/`ROSTER_*` paint constant and `FLAME_UNIT_POINTS` (`scenes/hud/hud-style.ts`); `SWEEP_FRAMES`, `SWEEP_FRAME_NAMES`, `sweepFrameIndex`, `washAlpha`, `ringAlpha`, `sweepAlpha`, `pillHeightFor`, `countdownKeyOffset` (`scenes/hud/slot-model.ts`). Tasks 3–5 consume them.

**Why baked, and what the step count is.** `fillCircle` is a 101-point path whatever its radius and `fillRoundedRect` is four of those, and Phaser re-transforms and re-triangulates every point every frame per camera (spec §1). The three slot rings with their key pills are about **1,830 points per frame for three static 64 px circles**. Baked, each is a quad.

The sweep is the one HUD shape that genuinely changes, and §12's second open question resolved it: **a baked sweep sheet, one frame per 6°, 90 frames at 4° if the stepping shows on a long cooldown.** It shows. `SLOT_BOX_PX` is 64 and the ring's centreline radius is `64 / 2 − HUD_RING_WIDTH_PX / 2 = 30.5` logical px; the game is `FIT`-scaled from 1424 × 720, so on a 1080p screen the radius is 30.5 × (1920 / 1424) = **41.1 device px**. At 6° the arc's end jumps 41.1 × 6° = 4.3 device px — wider than the 3 px stroke, so a step opens a visible notch. At 4° it jumps **2.9 px**, narrower than the stroke, so consecutive frames overlap and the arc reads as sliding. The rate matters as much as the size: the longest carried cooldown is `wildcharge` at 20 000 ms, which at 90 frames steps every 222 ms, and that is the case the 60-frame sheet fails. So **`SWEEP_FRAMES = 90`, 4° per frame**, and frame `i` is an arc of `(i + 1) × 4°` — frame 0 is the shortest arc the sheet can show and frame 89 the closed ring.

Tiles are `SLOT_BOX_PX × supersample` square, so every slot-sized frame packs on the same grid: 128 px at Medium/High, 64 px at Low. Ninety-four 128 px tiles plus two pills and an 8 px square shelve into six rows of a 2048 px sheet.

- [ ] **Step 1: Write `scenes/hud/hud-style.ts`**

This is a move, not new code: every constant below comes out of `scenes/arena/hud-renderer.ts`, where the preparation plan's Task 7 put it (originally `ArenaScene.ts:148, 244-437, 451-491`). Copy each with its comment verbatim, with these substitutions:

| In `hud-renderer.ts` | In `hud-style.ts` |
|---|---|
| `const HUD_TEXT = "#1d1f21";` | `export const HUD_TEXT_TINT = 0x1d1f21;` — a `BitmapText` takes a tint number, not a CSS string |
| `const HUD_STATUS_TEXT = "#ffffff";` | `export const HUD_STATUS_TEXT_TINT = 0xffffff;` |
| `const HUD_KEY_PILL_TEXT = "#ffffff";` | `export const HUD_KEY_PILL_TEXT_TINT = 0xffffff;` |
| `const ROSTER_DEAD_TEXT = "#8d9096";` / `ROSTER_LIVE_TEXT = HUD_TEXT` | `export const ROSTER_DEAD_TINT = 0x8d9096;` / `export const ROSTER_LIVE_TINT = HUD_TEXT_TINT;` |
| `const HUD_RING_CSS = ...` | **deleted** — it existed only to hand a `Text` the ring's colour as a string; the name label now takes `HUD_RING_COLOR` itself, and the two can no longer drift |
| `const HUD_NAME_FONT_STYLE = "bold"` | **deleted** — bold is `HUD_FONT_BOLD`, a second page |
| `const HUD_COUNTDOWN_KEY_OFFSET_PX = 24` and its two-paragraph measured comment | **deleted** — replaced by `countdownKeyOffset(metrics)` in `slot-model.ts`, which computes the same clearance from the font instead of from a reading taken off Courier |
| `FLAME_UNIT_POINTS` | exported unchanged (bake-only from now on) |
| `flameScratch` | **not moved** — it is `Phaser.Math.Vector2[]`, so it moves to `bake.ts` beside its only caller |
| every other `HUD_*`, `ROSTER_*` constant | `export const`, body and comment unchanged |
| `MOVEMENT_HINT_Y`, `MOVEMENT_HINT_FONT_PX`, `MOVEMENT_HINT_GAP`, `ACTION_HINT_Y` — in `match-banners.ts` after the preparation plan | moved here too, comments unchanged: `bake.ts` sizes the hint's pill from the font size, and importing it from `match-banners.ts` would make `bake.ts` and the banners circular |

Add at the top of the file:

```ts
// packages/client/src/scenes/hud/hud-style.ts
/**
 * Every colour, alpha, pad and proportion the HUD is painted with, as plain numbers.
 *
 * Phaser-free on purpose: `slot-model.ts` derives layout from these and is unit-tested in the node
 * environment, and `bake.ts` reads the same constants when it draws the frames at boot. One
 * definition, two consumers, no chance of the baked picture and the live layout disagreeing.
 *
 * Colours are numbers rather than CSS strings now that no `Text` object survives in the arena: a
 * `BitmapText` and a `Graphics` both take `0xrrggbb`, so the string twins (`HUD_RING_CSS`) that
 * existed only to feed `Text` are gone.
 */
```

Also add the two clearance knobs the deleted literal used to hide:

```ts
/** Air between the key pill's bottom edge and the countdown numeral hanging under it. */
export const HUD_COUNTDOWN_KEY_CLEAR_PX = 3;
```

- [ ] **Step 2: Write the failing test for `slot-model.ts`**

```ts
// packages/client/src/scenes/hud/slot-model.test.ts
import { describe, expect, it } from "vitest";
import { HUD_DIM } from "../weapon-hud.js";
import {
  HUD_RING_TRACK_ALPHA,
  HUD_RING_WASH_ALPHA,
  HUD_KEY_PILL_PAD_Y,
  HUD_KEY_FONT_PX,
} from "./hud-style.js";
import {
  SWEEP_FRAMES,
  SWEEP_FRAME_NAMES,
  countdownKeyOffset,
  pillHeightFor,
  ringAlpha,
  sweepAlpha,
  sweepFrameIndex,
  washAlpha,
} from "./slot-model.js";

/** The metrics `hud-font.xml` carries; the real ones are read off the loaded page at runtime. */
const METRICS = { size: 96, lineHeight: 124 };

describe("the sweep sheet", () => {
  it("is 90 frames of 4 degrees, named once at module load", () => {
    expect(SWEEP_FRAMES).toBe(90);
    expect(SWEEP_FRAME_NAMES).toHaveLength(90);
    expect(SWEEP_FRAME_NAMES[0]).toBe("baked.hud.sweep.00");
    expect(SWEEP_FRAME_NAMES[89]).toBe("baked.hud.sweep.89");
  });

  it("maps a full cooldown to the closed ring and the shortest arc to frame 0, clamping both ends", () => {
    expect(sweepFrameIndex(1)).toBe(89);
    expect(sweepFrameIndex(0.5)).toBe(44);
    expect(sweepFrameIndex(1 / SWEEP_FRAMES)).toBe(0);
    expect(sweepFrameIndex(0)).toBe(0);
    expect(sweepFrameIndex(-1)).toBe(0);
    expect(sweepFrameIndex(1.5)).toBe(89);
  });
});

describe("slot alphas", () => {
  it("washes the slot at its dim", () => {
    expect(washAlpha(1)).toBeCloseTo(HUD_RING_WASH_ALPHA, 10);
    expect(washAlpha(HUD_DIM.recharging)).toBeCloseTo(0.048, 10);
  });

  it("holds a draining ring's track and its arc at full brightness, and dims it otherwise", () => {
    expect(ringAlpha(HUD_DIM.recharging, true)).toBeCloseTo(HUD_RING_TRACK_ALPHA, 10);
    expect(sweepAlpha(HUD_DIM.recharging)).toBe(1);
    expect(ringAlpha(HUD_DIM.recharging, false)).toBe(HUD_DIM.recharging);
    expect(ringAlpha(HUD_DIM.locked, false)).toBe(HUD_DIM.locked);
  });
});

describe("pill and countdown geometry", () => {
  it("sizes the key pill from the font and hangs the countdown clear of it", () => {
    expect(pillHeightFor(HUD_KEY_FONT_PX, METRICS, HUD_KEY_PILL_PAD_Y)).toBe(24);
    expect(countdownKeyOffset(METRICS)).toBeCloseTo(26.625, 3);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/scenes/hud/slot-model.test.ts`
Expected: FAIL — cannot resolve `./slot-model.js`.

- [ ] **Step 4: Write `slot-model.ts`**

```ts
// packages/client/src/scenes/hud/slot-model.ts
import { textHeightFor, type HudFontMetrics } from "../../render/fonts.js";
import {
  HUD_COUNTDOWN_FONT_PX,
  HUD_COUNTDOWN_KEY_CLEAR_PX,
  HUD_KEY_FONT_PX,
  HUD_KEY_PILL_PAD_Y,
  HUD_RING_TRACK_ALPHA,
  HUD_RING_WASH_ALPHA,
  HUD_SWEEP_HOLDS_FULL,
} from "./hud-style.js";

/**
 * The cooldown sweep as a baked flipbook, and the two alphas the ring is drawn at. Pure and
 * Phaser-free so the arithmetic is testable; `bake.ts` draws the frames from the same numbers, so
 * the sheet and the lookup can never disagree about what frame 44 means.
 */

/**
 * How many frames the sweep sheet carries — 4 degrees each.
 *
 * The spec left this at "one frame per 6 degrees, 90 at 4 degrees if the stepping shows on a long
 * cooldown". It shows. The ring's centreline radius is 30.5 logical px, and the game FITs 1424x720
 * into the window, so on a 1080p screen that is 41.1 device px: a 6-degree step moves the arc's end
 * 4.3 px, wider than the 3 px stroke, which opens a visible notch. A 4-degree step moves it 2.9 px,
 * narrower than the stroke, so consecutive frames overlap and the arc slides. The step RATE decides
 * it as much as the size — `wildcharge` drains for 20 s, which is one step every 222 ms even at 90.
 */
export const SWEEP_FRAMES = 90;
export const SWEEP_STEP_RADIANS = (Math.PI * 2) / SWEEP_FRAMES;

/**
 * The sheet's frame names, built once at module load: a name built per frame would be a string
 * allocation on the render path for every drawn slot (spec R6).
 */
export const SWEEP_FRAME_NAMES: readonly string[] = Array.from(
  { length: SWEEP_FRAMES },
  (_, i) => `baked.hud.sweep.${String(i).padStart(2, "0")}`,
);

/**
 * Which frame shows `fraction` of the ring still to drain. Frame `i` is an arc of `(i + 1)` steps,
 * so the sheet has no empty frame: a slot whose fraction has reached 0 hides the sprite instead.
 */
export function sweepFrameIndex(fraction: number): number {
  const index = Math.ceil(fraction * SWEEP_FRAMES) - 1;
  return Math.min(SWEEP_FRAMES - 1, Math.max(0, index));
}

/** The wash inside the ring always dims with the slot. */
export function washAlpha(dim: number): number {
  return HUD_RING_WASH_ALPHA * dim;
}

/**
 * The ring: a solid frame at the slot's dim, or the dim TRACK under a draining arc.
 * `HUD_SWEEP_HOLDS_FULL` is what keeps a recharging slot's timer readable at `HUD_DIM.recharging`.
 */
export function ringAlpha(dim: number, draining: boolean): number {
  if (!draining) return dim;
  return HUD_RING_TRACK_ALPHA * (HUD_SWEEP_HOLDS_FULL ? 1 : dim);
}

/** The bright remaining arc over that track. */
export function sweepAlpha(dim: number): number {
  return HUD_SWEEP_HOLDS_FULL ? 1 : dim;
}

/**
 * The key pill's height: one line of `BitmapText` at `fontPx`, plus its padding.
 *
 * Derived, where it used to be measured off a rendered canvas (`keyText.height + pad * 2`). A
 * bitmap font's line box is exact arithmetic, so the pill can be baked at its final height and
 * drawn 1:1 — which is what lets it be a three-slice quad instead of a `fillRoundedRect`.
 */
export function pillHeightFor(fontPx: number, metrics: HudFontMetrics, padY: number): number {
  return Math.round(textHeightFor(fontPx, metrics)) + padY * 2;
}

/**
 * How far under the slot's centre the countdown numeral hangs: clear of the key pill above it by
 * `HUD_COUNTDOWN_KEY_CLEAR_PX`.
 *
 * This replaces a hand-measured 24 whose comment argued from Phaser's default Courier ("the key
 * pill is 22px tall and the 18px countdown 20px"). Both readings are now the font's own, so a
 * change of face or font size moves the numeral with it instead of quietly closing the gap.
 */
export function countdownKeyOffset(metrics: HudFontMetrics): number {
  return (
    pillHeightFor(HUD_KEY_FONT_PX, metrics, HUD_KEY_PILL_PAD_Y) / 2 +
    textHeightFor(HUD_COUNTDOWN_FONT_PX, metrics) / 2 +
    HUD_COUNTDOWN_KEY_CLEAR_PX
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/client && npx vitest run src/scenes/hud/slot-model.test.ts`
Expected: PASS (8 tests). `pillHeightFor(14, {96, 124}, 3)` is `round(14 × 124 / 96) + 6 = 18 + 6 = 24`; `countdownKeyOffset` is `12 + 18 × 124 / 96 / 2 + 3 = 12 + 11.625 + 3 = 26.625`.

- [ ] **Step 6: Write the failing test for the bake jobs and the packer**

```ts
// packages/client/src/render/bake.test.ts
import { describe, expect, it } from "vitest";
import { SLOT_BOX_PX } from "../scenes/weapon-hud.js";
import { SWEEP_FRAMES, SWEEP_STEP_RADIANS } from "../scenes/hud/slot-model.js";
import { HUD_RING_COLOR, HUD_RING_WIDTH_PX } from "../scenes/hud/hud-style.js";
import { BAKE_PILL_WIDTH_RATIO, type BakeGraphics, bakeJobs, packShelf } from "./bake.js";

/** Records the calls a job makes, the same trick `combat-visual.test.ts` uses for geometry. */
function recorder(): BakeGraphics & { calls: string[] } {
  const calls: string[] = [];
  const push =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => (typeof a === "number" ? a.toFixed(3) : String(a))).join(",")})`);
    };
  return {
    calls,
    clear: push("clear"),
    fillStyle: push("fillStyle"),
    lineStyle: push("lineStyle"),
    fillCircle: push("fillCircle"),
    strokeCircle: push("strokeCircle"),
    fillRect: push("fillRect"),
    strokeRect: push("strokeRect"),
    fillRoundedRect: push("fillRoundedRect"),
    fillPoints: push("fillPoints"),
    strokePoints: push("strokePoints"),
    beginPath: push("beginPath"),
    arc: push("arc"),
    strokePath: push("strokePath"),
  };
}

const PILL = { key: 24, hint: 29 };

describe("bakeJobs", () => {
  const jobs = bakeJobs(2, PILL);
  const byName = new Map(jobs.map((job) => [job.name, job]));
  const stroke = (HUD_RING_WIDTH_PX * 2).toFixed(3);

  it("bakes one frame per HUD shape plus the whole sweep sheet", () => {
    expect(jobs).toHaveLength(7 + SWEEP_FRAMES);
    expect(jobs.slice(0, 7).map((job) => job.name)).toEqual([
      "baked.hud.px",
      "baked.hud.wash",
      "baked.hud.ring",
      "baked.hud.glyph.projectile",
      "baked.hud.glyph.beam",
      "baked.hud.pill.key",
      "baked.hud.pill.hint",
    ]);
    expect(byName.has("baked.hud.sweep.00")).toBe(true);
    expect(byName.has("baked.hud.sweep.89")).toBe(true);
  });

  it("draws every slot shape into one supersampled tile, halved at supersample 1", () => {
    for (const name of ["baked.hud.wash", "baked.hud.ring", "baked.hud.sweep.00"]) {
      expect(byName.get(name)!.width).toBe(SLOT_BOX_PX * 2);
      expect(byName.get(name)!.height).toBe(SLOT_BOX_PX * 2);
    }
    expect(bakeJobs(1, PILL).find((job) => job.name === "baked.hud.ring")!.width).toBe(SLOT_BOX_PX);
  });

  it("strokes the ring on the same centreline the sweep sweeps", () => {
    const gfx = recorder();
    byName.get("baked.hud.ring")!.draw(gfx);
    expect(gfx.calls).toEqual([
      `lineStyle(${stroke},${HUD_RING_COLOR},1.000)`,
      "strokeCircle(64.000,64.000,61.000)",
    ]);
  });

  it("sweeps frame i through i+1 steps from twelve o'clock", () => {
    const gfx = recorder();
    byName.get("baked.hud.sweep.44")!.draw(gfx);
    const end = -Math.PI / 2 + 45 * SWEEP_STEP_RADIANS;
    expect(gfx.calls).toEqual([
      `lineStyle(${stroke},${HUD_RING_COLOR},1.000)`,
      "beginPath()",
      `arc(64.000,64.000,61.000,${(-Math.PI / 2).toFixed(3)},${end.toFixed(3)},false)`,
      "strokePath()",
    ]);
  });

  it("bakes each pill at its final height so it is drawn 1:1 vertically", () => {
    const key = byName.get("baked.hud.pill.key")!;
    const w = PILL.key * 2 * BAKE_PILL_WIDTH_RATIO;
    expect([key.width, key.height]).toEqual([w, PILL.key * 2]);
    const gfx = recorder();
    key.draw(gfx);
    expect(gfx.calls).toEqual([
      `fillStyle(${HUD_RING_COLOR},1.000)`,
      `fillRoundedRect(0.000,0.000,${w.toFixed(3)},${(PILL.key * 2).toFixed(3)},${PILL.key.toFixed(3)})`,
    ]);
  });
});

describe("packShelf", () => {
  const jobs = [
    { name: "a", width: 100, height: 50, draw: () => {} },
    { name: "b", width: 100, height: 50, draw: () => {} },
    { name: "c", width: 60, height: 20, draw: () => {} },
  ];

  it("fills a shelf left to right and starts a new one at the tallest job's height", () => {
    expect(packShelf(jobs, 220)).toEqual({
      placements: [
        { name: "a", x: 0, y: 0, width: 100, height: 50 },
        { name: "b", x: 100, y: 0, width: 100, height: 50 },
        { name: "c", x: 0, y: 50, width: 60, height: 20 },
      ],
      usedHeight: 70,
    });
  });

  it("throws when the sheet cannot hold the jobs, rather than dropping a frame", () => {
    expect(() => packShelf(jobs, 60)).toThrow(/does not fit/);
  });

  it("packs the real job list into a 2048px sheet", () => {
    expect(packShelf(bakeJobs(2, PILL), 2048).usedHeight).toBeLessThanOrEqual(2048);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/render/bake.test.ts`
Expected: FAIL — cannot resolve `./bake.js`.

- [ ] **Step 8: Write `render/atlas.ts` and `render/bake.ts`**

```ts
// packages/client/src/render/atlas.ts
/**
 * The renderer's texture atlases.
 *
 * `BAKED_ATLAS` is the `DynamicTexture` `render/bake.ts` fills at boot from the procedural builders
 * (spec R11). V2 adds `ART_ATLAS` and `scripts/pack-atlas.mjs` beside it for the authored art; the
 * key lives here rather than in `bake.ts` so both halves name it from one place.
 */
export const BAKED_ATLAS = "baked-atlas";
```

```ts
// packages/client/src/render/bake.ts
import Phaser from "phaser";
import { SLOT_BOX_PX } from "../scenes/weapon-hud.js";
import {
  FLAME_UNIT_POINTS,
  HUD_BEAM_WIDTH_SCALE,
  HUD_GLYPH_COLOR,
  HUD_GLYPH_CORE_COLOR,
  HUD_GLYPH_CORE_OFFSET_SCALE,
  HUD_GLYPH_CORE_SCALE,
  HUD_GLYPH_OUTLINE_COLOR,
  HUD_GLYPH_OUTLINE_PX,
  HUD_GLYPH_SCALE,
  HUD_KEY_FONT_PX,
  HUD_KEY_PILL_PAD_Y,
  HUD_RING_COLOR,
  HUD_RING_WIDTH_PX,
  HUD_SWEEP_START_ANGLE,
  MOVEMENT_HINT_FONT_PX,
} from "../scenes/hud/hud-style.js";
import { SWEEP_FRAMES, SWEEP_STEP_RADIANS, pillHeightFor } from "../scenes/hud/slot-model.js";
import { BAKED_ATLAS } from "./atlas.js";
import { HUD_FONT, hudFontMetrics } from "./fonts.js";

/**
 * Detail is paid once at boot; frames pay only for position (spec R1).
 *
 * `Graphics.fillCircle` is a 101-point path whatever its radius and `fillRoundedRect` is four of
 * them, and Phaser re-transforms and re-triangulates every point every frame per camera (spec §1) —
 * the three slot rings and their key pills cost about 1,830 points a frame to draw three static
 * circles. Every one of those shapes is drawn ONCE here, into a `DynamicTexture` with a named
 * frame, and is a quad from then on. `DynamicTexture`, not `Graphics.generateTexture`: the latter
 * renders through the Canvas 2D path (`Graphics.js:1583`) and cannot bake a blend mode or a
 * gradient, which V2 and V3 need (spec R13).
 *
 * The job list is pure and takes its supersample and pill heights as arguments, so `bake.test.ts`
 * runs every job against a recording stub with no browser — the trick `combat-visual.test.ts`
 * already uses for shot geometry. Only `bakeAtlas` touches a scene.
 */

export type BakeTier = "low" | "medium" | "high";

/** Textures are drawn at twice their on-screen size so a dpr of 2 draws them 1:1 (spec R17). */
export const BAKE_SUPERSAMPLE: Record<BakeTier, number> = { low: 1, medium: 2, high: 2 };
/** Power of two, so V5 can enable `mipmapFilter` for the atlas. */
export const BAKE_SHEET_PX: Record<BakeTier, number> = { low: 1024, medium: 2048, high: 2048 };
/** Until V5's `TierManager` measures one, everything bakes at Medium. */
export const BAKE_DEFAULT_TIER: BakeTier = "medium";

/** How much wider than tall a pill is baked, leaving a stretchable middle for the three-slice. */
export const BAKE_PILL_WIDTH_RATIO = 4;
/** The white square every solid rectangle in the HUD is a scaled, tinted copy of. */
export const BAKE_PX_SIZE = 8;

/** The subset of `Phaser.GameObjects.Graphics` a bake job may call. */
export interface BakeGraphics {
  clear(): unknown;
  fillStyle(color: number, alpha?: number): unknown;
  lineStyle(width: number, color: number, alpha?: number): unknown;
  fillCircle(x: number, y: number, radius: number): unknown;
  strokeCircle(x: number, y: number, radius: number): unknown;
  fillRect(x: number, y: number, width: number, height: number): unknown;
  strokeRect(x: number, y: number, width: number, height: number): unknown;
  fillRoundedRect(x: number, y: number, width: number, height: number, radius: number): unknown;
  fillPoints(points: Phaser.Math.Vector2[], closeShape?: boolean): unknown;
  strokePoints(points: Phaser.Math.Vector2[], closeShape?: boolean): unknown;
  beginPath(): unknown;
  arc(x: number, y: number, radius: number, start: number, end: number, anticlockwise?: boolean): unknown;
  strokePath(): unknown;
}

export interface BakeJob {
  /** The frame name, `baked.<name>` per the ledger. */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Draws the job into the top-left of a cleared scratch `Graphics`. */
  draw(gfx: BakeGraphics): void;
}

/** The pill heights the sheet is baked at, in on-screen pixels. */
export interface PillHeights {
  readonly key: number;
  readonly hint: number;
}

/**
 * Scratch buffer the flame glyph writes into, so baking it allocates nothing. Moved here from the
 * scene with `flamePoints`: the flame is bake-only now (spec R14 — the procedural authoring code is
 * kept and tested, and taken off the frame path).
 */
const flameScratch: Phaser.Math.Vector2[] = FLAME_UNIT_POINTS.map(() => new Phaser.Math.Vector2());

/** `FLAME_UNIT_POINTS` placed and scaled; returns the shared scratch, so read it before recalling. */
function flamePoints(cx: number, cy: number, r: number): Phaser.Math.Vector2[] {
  for (let i = 0; i < FLAME_UNIT_POINTS.length; i++) {
    const unit = FLAME_UNIT_POINTS[i]!;
    flameScratch[i]!.set(cx + unit.x * r, cy + unit.y * r);
  }
  return flameScratch;
}

/**
 * Every frame the HUD draws, at supersample `ss`.
 *
 * The bodies are the ones `hud-renderer.ts` ran per frame — `drawSlotRing`, `drawSweepArc`,
 * `drawWeaponGlyph` and the key pill's `fillRoundedRect` — with the slot's centre at the tile's
 * centre and every length multiplied by `ss`. Nothing about the picture changed; only how often it
 * is computed.
 */
export function bakeJobs(ss: number, pill: PillHeights): BakeJob[] {
  const tile = SLOT_BOX_PX * ss;
  const centre = tile / 2;
  const stroke = HUD_RING_WIDTH_PX * ss;
  // The ring's centreline, inset by half its stroke so its outer edge lands on the layout's box.
  const radius = tile / 2 - stroke / 2;
  const glyphRadius = (tile / 2) * HUD_GLYPH_SCALE;
  const outline = HUD_GLYPH_OUTLINE_PX * ss;
  const slotTile = { width: tile, height: tile };

  const jobs: BakeJob[] = [
    {
      // The one white square every solid rectangle in the HUD is a tinted, scaled copy of: the
      // roster swatches, the status pills and their drain bars.
      name: "baked.hud.px",
      width: BAKE_PX_SIZE,
      height: BAKE_PX_SIZE,
      draw: (gfx) => {
        gfx.fillStyle(0xffffff, 1);
        gfx.fillRect(0, 0, BAKE_PX_SIZE, BAKE_PX_SIZE);
      },
    },
    {
      // Baked opaque: the wash's alpha is the sprite's, so one frame serves every dim.
      name: "baked.hud.wash",
      ...slotTile,
      draw: (gfx) => {
        gfx.fillStyle(HUD_RING_COLOR, 1);
        gfx.fillCircle(centre, centre, radius);
      },
    },
    {
      name: "baked.hud.ring",
      ...slotTile,
      draw: (gfx) => {
        gfx.lineStyle(stroke, HUD_RING_COLOR, 1);
        gfx.strokeCircle(centre, centre, radius);
      },
    },
    {
      // Flame, outline and hot core in ONE frame: all three dim together and never move relative
      // to each other, so they are one picture rather than three sprites.
      name: "baked.hud.glyph.projectile",
      ...slotTile,
      draw: (gfx) => {
        const flame = flamePoints(centre, centre, glyphRadius);
        gfx.fillStyle(HUD_GLYPH_COLOR, 1);
        gfx.fillPoints(flame, true);
        gfx.lineStyle(outline, HUD_GLYPH_OUTLINE_COLOR, 1);
        gfx.strokePoints(flame, true);
        // Overwrites `flame` — safe only because both calls above have returned.
        const core = flamePoints(
          centre,
          centre + glyphRadius * HUD_GLYPH_CORE_OFFSET_SCALE,
          glyphRadius * HUD_GLYPH_CORE_SCALE,
        );
        gfx.fillStyle(HUD_GLYPH_CORE_COLOR, 1);
        gfx.fillPoints(core, true);
      },
    },
    {
      name: "baked.hud.glyph.beam",
      ...slotTile,
      draw: (gfx) => {
        const width = glyphRadius * 2 * HUD_BEAM_WIDTH_SCALE;
        gfx.fillStyle(HUD_GLYPH_COLOR, 1);
        gfx.fillRect(centre - width / 2, centre - glyphRadius, width, glyphRadius * 2);
        gfx.lineStyle(outline, HUD_GLYPH_OUTLINE_COLOR, 1);
        gfx.strokeRect(centre - width / 2, centre - glyphRadius, width, glyphRadius * 2);
      },
    },
  ];

  // Two pills, each baked at its FINAL height so it is drawn 1:1 vertically and three-sliced
  // horizontally: a capsule stretched vertically turns its caps into ellipses.
  for (const [suffix, height] of [
    ["key", pill.key],
    ["hint", pill.hint],
  ] as const) {
    const h = height * ss;
    const w = h * BAKE_PILL_WIDTH_RATIO;
    jobs.push({
      name: `baked.hud.pill.${suffix}`,
      width: w,
      height: h,
      draw: (gfx) => {
        gfx.fillStyle(HUD_RING_COLOR, 1);
        gfx.fillRoundedRect(0, 0, w, h, h / 2);
      },
    });
  }

  for (let i = 0; i < SWEEP_FRAMES; i++) {
    const end = HUD_SWEEP_START_ANGLE + (i + 1) * SWEEP_STEP_RADIANS;
    jobs.push({
      name: `baked.hud.sweep.${String(i).padStart(2, "0")}`,
      width: tile,
      height: tile,
      draw: (gfx) => {
        gfx.lineStyle(stroke, HUD_RING_COLOR, 1);
        gfx.beginPath();
        gfx.arc(centre, centre, radius, HUD_SWEEP_START_ANGLE, end, false);
        gfx.strokePath();
      },
    });
  }

  return jobs;
}

export interface Placement {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A shelf packer, in job order. Deterministic on purpose — the frame table is asserted by a unit
 * test, and a packer that sorted would move every frame when one job's size changed.
 */
export function packShelf(
  jobs: readonly BakeJob[],
  sheetPx: number,
): { placements: Placement[]; usedHeight: number } {
  const placements: Placement[] = [];
  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  for (const job of jobs) {
    if (job.width > sheetPx) {
      throw new Error(`bake job "${job.name}" does not fit a ${sheetPx}px sheet`);
    }
    if (x + job.width > sheetPx) {
      x = 0;
      y += shelfHeight;
      shelfHeight = 0;
    }
    if (y + job.height > sheetPx) {
      throw new Error(`bake job "${job.name}" does not fit a ${sheetPx}px sheet`);
    }
    placements.push({ name: job.name, x, y, width: job.width, height: job.height });
    x += job.width;
    shelfHeight = Math.max(shelfHeight, job.height);
  }
  return { placements, usedHeight: y + shelfHeight };
}

/** Whether the atlas has already been baked into this game's texture manager. */
export function bakedAtlasReady(scene: Phaser.Scene): boolean {
  return scene.textures.exists(BAKED_ATLAS);
}

/** A baked frame, for `scene.add.image(x, y, ...bakedFrame("hud.ring"))`. */
export function bakedFrame(name: string): [string, string] {
  return [BAKED_ATLAS, name];
}

/**
 * Fill the baked atlas. Called once, from `BootScene.create`, before any scene draws.
 *
 * `Promise<void>` is the ledger's signature and V2 needs it (its authored atlas is a loaded image);
 * V1's work is entirely synchronous and finishes before this returns, which is the guarantee
 * `HudScene` and `PerfOverlay` are written against. Idempotent: a second call on a game that
 * already has the texture is a no-op, so re-entering the arena never re-bakes.
 */
export async function bakeAtlas(scene: Phaser.Scene, tier: BakeTier = BAKE_DEFAULT_TIER): Promise<void> {
  if (bakedAtlasReady(scene)) return;
  const ss = BAKE_SUPERSAMPLE[tier];
  const sheetPx = BAKE_SHEET_PX[tier];
  const metrics = hudFontMetrics(scene.cache.bitmapFont, HUD_FONT);
  const jobs = bakeJobs(ss, {
    key: pillHeightFor(HUD_KEY_FONT_PX, metrics, HUD_KEY_PILL_PAD_Y),
    hint: pillHeightFor(MOVEMENT_HINT_FONT_PX, metrics, HUD_KEY_PILL_PAD_Y),
  });
  const { placements } = packShelf(jobs, sheetPx);

  const texture = scene.textures.addDynamicTexture(BAKED_ATLAS, sheetPx, sheetPx);
  if (!texture) throw new Error("could not create the baked atlas");
  // Not added to the display list: this is a stamp, not a visual.
  const gfx = scene.make.graphics({}, false);
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    const at = placements[i]!;
    gfx.clear();
    job.draw(gfx);
    texture.draw(gfx, at.x, at.y);
    texture.add(job.name, 0, at.x, at.y, at.width, at.height);
  }
  gfx.destroy();
}
```

- [ ] **Step 9: Run the bake test**

Run: `cd packages/client && npx vitest run src/render/bake.test.ts src/scenes/hud/slot-model.test.ts`
Expected: PASS. The ring's radius in the assertion is `128 / 2 − 6 / 2 = 61`, and the sweep's frame 44 ends at `−π/2 + 45 × 2π/90`.

- [ ] **Step 10: Bake at boot**

In `BootScene.create`, as the first statement of the method — before the dev-tool branch, so `?dev=bench` gets the atlas too:

```ts
    // Before anything can draw. `preload` has already delivered the font pages, which is what the
    // pill heights are derived from; the whole bake is a few milliseconds of `Graphics` fills into
    // one texture and replaces the same work done sixty times a second (spec R13).
    void bakeAtlas(this);
```

Add `import { bakeAtlas } from "../render/bake.js";`.

- [ ] **Step 11: Verify and commit**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
cd packages/client && npm run typecheck && cd ../..
npm run dev
```

In the browser open `http://localhost:5173`, then in the console: `game.textures.exists("baked-atlas")` is `true` and `game.textures.get("baked-atlas").getFrameNames().length` is `97`. Nothing looks different yet — nothing draws the frames until Task 3.

```bash
git add packages/client/src/render/atlas.ts packages/client/src/render/bake.ts \
  packages/client/src/render/bake.test.ts packages/client/src/scenes/hud/hud-style.ts \
  packages/client/src/scenes/hud/slot-model.ts packages/client/src/scenes/hud/slot-model.test.ts \
  packages/client/src/scenes/arena/hud-renderer.ts packages/client/src/scenes/BootScene.ts
git commit -m "feat(client): bake the HUD ring, glyphs, pills and a 90-frame sweep sheet at boot

Moves no playtest probe number: boot-time texture work only, no sim or table touched."
```

---

### Task 3: `HudScene`, and the death of the ignore lists

**Files:**
- Create: `packages/client/src/render/hud-feed.ts`
- Test: `packages/client/src/render/hud-feed.test.ts`
- Create: `packages/client/src/scenes/HudScene.ts`
- Move: `packages/client/src/scenes/arena/match-banners.ts` → `packages/client/src/scenes/hud/match-banners.ts` (and convert its text)
- Delete: `packages/client/src/scenes/arena/arena-layers.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts`, `packages/client/src/scenes/arena/{car-renderer,shot-renderer,arena-floor,hud-renderer}.ts`, `packages/client/src/render/perf-overlay.ts`, `packages/client/src/dev/BenchScene.ts`, `packages/client/src/main.ts`

**Interfaces:**
- Consumes: Task 1's `HUD_FONT`, `HUD_FONT_BOLD`, `hudSafeText`; Task 2's `bakedFrame`, `BAKE_PX_SIZE`, `hud-style.ts` tints; the preparation plan's `RenderFrame`, `SpectateView`, `HudRenderer`, `MatchBanners`; V0's `PerfOverlay`, `PerfMark`, `drawArenaFloor`.
- Produces:

```ts
// render/hud-feed.ts
export const HUD_FRAME_KEY = "frame";
export const HUD_VIEW_KEY = "hud-view";
export const HUD_PERF_KEY = "hud-perf";
export interface HudView { targetSid: string; spectate: SpectateView; idleWarningSeconds: number }
export interface HudMarks { mark(label: "draw"): void; frameEnd(): void }
export interface FeedStore { get(key: string): unknown; set(key: string, value: unknown): void }
export function newHudView(): HudView;
export function publishHudFrame(store: FeedStore, frame: RenderFrame, view: HudView): void;
export function readHudFrame(store: FeedStore): RenderFrame | undefined;
export function readHudView(store: FeedStore): HudView | undefined;
export function readHudPerf(store: FeedStore): HudMarks | undefined;

// scenes/HudScene.ts
export const HUD_SCENE_KEY = "hud";
export class HudScene extends Phaser.Scene { }
```

**What replaces `splitCameras`.** The preparation plan already turned the two hand-maintained ignore lists into `ArenaLayers`' `world(obj)` / `hud(obj)` registry (`ArenaScene.ts:975-1021` before it). R20 removes the mechanism itself: **Phaser renders the whole display list once per camera, so two cameras in one scene need every object ignored by exactly one of them; two scenes need nothing.** Every screen-space object — the slot bar, the roster, the badges, the six banners, the movement hint — moves to `HudScene`, whose camera is the whole canvas. `ArenaScene` is left with world objects and its single `cameras.main`, clipped to `ARENA_VIEW_WIDTH` exactly as before, so there is nothing to ignore and `ArenaLayers` is deleted.

**How the spectate and split view keeps working.** Nothing about the camera changes. `SpectateCamera` still owns `ArenaScene.cameras.main` — `follow`, `panCamera` and the free-roam keys are untouched, and `drawArenaFloor` still sets that camera's viewport, zoom, bounds and background. What used to be the *second* camera was never a spectate feature; it existed only so the gutter could be drawn outside the arena viewport. `HudScene`'s camera now is that gutter camera, and it never scrolls, so `setScrollFactor(0)` goes away with it. The two facts the HUD needs about spectating — which car the slot bar follows, and what the banner should say — already come from `SpectateCamera.hudTarget(frame)` and `SpectateCamera.view(frame)` in `ArenaScene.update`; they now travel to `HudScene` on the registry as `HudView.targetSid` and `HudView.spectate` instead of being passed as arguments. Free roam still shows no slot bar, because `hudTarget` still answers `""` for it and `carOf(frame, "")` is still `undefined`.

**Ordering.** `this.scene.launch(HUD_SCENE_KEY)` then `this.scene.bringToTop(HUD_SCENE_KEY)`: Phaser updates and renders scenes in list order, so this puts `HudScene`'s `update` after the arena's (it reads the frame the arena just published) and its draw over the arena's. `bringToTop` rather than relying on the order in `main.ts`, because `BenchScene` is added dynamically and lands at the end of the list.

- [ ] **Step 1: Write the failing test for the feed**

```ts
// packages/client/src/render/hud-feed.test.ts
import { describe, expect, it } from "vitest";
import { emptyRenderFrame } from "../match/render-frame.js";
import {
  HUD_FRAME_KEY,
  HUD_PERF_KEY,
  HUD_VIEW_KEY,
  newHudView,
  publishHudFrame,
  readHudFrame,
  readHudPerf,
  readHudView,
} from "./hud-feed.js";

function store() {
  const map = new Map<string, unknown>();
  return { get: (k: string) => map.get(k), set: (k: string, v: unknown) => void map.set(k, v) };
}

describe("the HUD feed", () => {
  it("hands the HUD scene the frame, the view and the overlay under the ledger's keys", () => {
    const s = store();
    const frame = { ...emptyRenderFrame(42), localSessionId: "me" };
    const view = newHudView();
    view.targetSid = "them";
    const marks = { mark: () => {}, frameEnd: () => {} };
    publishHudFrame(s, frame, view);
    s.set(HUD_PERF_KEY, marks);
    expect([s.get(HUD_FRAME_KEY), s.get(HUD_VIEW_KEY)]).toEqual([frame, view]);
    expect(readHudFrame(s)?.nowMs).toBe(42);
    expect(readHudView(s)?.targetSid).toBe("them");
    expect(readHudPerf(s)).toBe(marks);
  });

  it("answers undefined before the arena has published anything", () => {
    const s = store();
    expect([readHudFrame(s), readHudView(s), readHudPerf(s)]).toEqual([undefined, undefined, undefined]);
  });

  it("starts a view that is not spectating, not warning and following nobody", () => {
    expect(newHudView()).toEqual({
      targetSid: "",
      spectate: { spectating: false, freeRoam: false, targetSid: "" },
      idleWarningSeconds: 0,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/render/hud-feed.test.ts`
Expected: FAIL — cannot resolve `./hud-feed.js`.

- [ ] **Step 3: Write the feed**

```ts
// packages/client/src/render/hud-feed.ts
import type { RenderFrame } from "../match/render-frame.js";
import type { SpectateView } from "../scenes/arena/spectate-camera.js";

/**
 * The one channel between the arena scene and the HUD scene.
 *
 * Two Phaser scenes share the game's registry, so the arena publishes the frame it already built
 * and the HUD reads it — no second frame build, no scene reaching into another's fields. The frame
 * key is the ledger's (`registry.get("frame")`). `import type` on `SpectateView` is erased at
 * compile time, so nothing here — and nothing in its test — loads Phaser.
 */

export const HUD_FRAME_KEY = "frame";
export const HUD_VIEW_KEY = "hud-view";
export const HUD_PERF_KEY = "hud-perf";

/** The three things the HUD needs that are not in the frame. */
export interface HudView {
  /** Whose slots and badges the gutter shows: `SpectateCamera.hudTarget`, "" for free roam. */
  targetSid: string;
  spectate: SpectateView;
  /** Practice's idle warning countdown; 0 hides the banner. */
  idleWarningSeconds: number;
}

/** What `HudScene` needs off `PerfOverlay` to charge its own work to the `draw` bucket. */
export interface HudMarks {
  mark(label: "draw"): void;
  frameEnd(): void;
}

/** The structural shape of `Phaser.Data.DataManager` used here, so no test imports Phaser. */
export interface FeedStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/**
 * One view object per match, mutated in place by the arena and read by the HUD — allocating a fresh
 * one per frame would be an allocation on the frame path (spec R6).
 */
export function newHudView(): HudView {
  return {
    targetSid: "",
    spectate: { spectating: false, freeRoam: false, targetSid: "" },
    idleWarningSeconds: 0,
  };
}

export function publishHudFrame(store: FeedStore, frame: RenderFrame, view: HudView): void {
  store.set(HUD_FRAME_KEY, frame);
  store.set(HUD_VIEW_KEY, view);
}

export function readHudFrame(store: FeedStore): RenderFrame | undefined {
  return (store.get(HUD_FRAME_KEY) as RenderFrame | undefined) ?? undefined;
}

export function readHudView(store: FeedStore): HudView | undefined {
  return (store.get(HUD_VIEW_KEY) as HudView | undefined) ?? undefined;
}

export function readHudPerf(store: FeedStore): HudMarks | undefined {
  return (store.get(HUD_PERF_KEY) as HudMarks | undefined) ?? undefined;
}
```

- [ ] **Step 4: Run the feed test**

Run: `cd packages/client && npx vitest run src/render/hud-feed.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Move `MatchBanners` and take its `Text` out**

```bash
git mv packages/client/src/scenes/arena/match-banners.ts packages/client/src/scenes/hud/match-banners.ts
```

Then edit it, against the bodies the preparation plan's Task 8 moved there (originally `ArenaScene.ts:342-420, 612, 619-647, 806-862, 2606-2789`):

| In `match-banners.ts` today | After |
|---|---|
| `constructor(scene: Phaser.Scene, layers: ArenaLayers)` | `constructor(scene: Phaser.Scene, metrics: HudFontMetrics)` |
| every `layers.hud(obj)` wrap | the object itself — one camera, nothing to ignore |
| `this.scene.add.text(x, y, "", { fontSize: "96px", color: HUD_TEXT })` and the five like it | `this.scene.add.bitmapText(x, y, HUD_FONT, "", 96).setTint(HUD_TEXT_TINT)` — same `x`, `y`, same size, same `setOrigin`, same `setVisible(false)` |
| `.setScrollFactor(0)` on all of them | **deleted** — the HUD camera never scrolls |
| `import { HUD_TEXT } from "../arena/hud-renderer.js"` | `import { HUD_TEXT_TINT, HUD_KEY_PILL_TEXT_TINT, HUD_RING_COLOR, HUD_KEY_PILL_PAD_X, HUD_KEY_PILL_PAD_Y } from "./hud-style.js"` |
| every `text.setText(s)` | `this.say(text, s)` — see below |
| `buildMovementHint` / `buildHintRow`'s `this.add.graphics()` and its `gfx.fillRoundedRect(...)` per pill | a `NineSlice` per pill, see below |

Two substitutions worth writing out. First, the guard every banner's string goes through — a `BitmapText` rebuilds its quads on `setText`, which is cheap but not free, and a banner's string changes about once a match:

```ts
  /**
   * Set a banner's text only when it actually changed (spec R3). `hudSafeText` is applied here
   * rather than at every call site: a player name is the one string reaching the HUD that can carry
   * a glyph the font sheet has no quad for, and a dropped glyph would silently blank the banner.
   */
  private say(text: Phaser.GameObjects.BitmapText, value: string): void {
    const safe = hudSafeText(value);
    if (text.text !== safe) text.setText(safe);
  }
```

Second, the movement hint. Its comment says the block is built once because "a per-frame `clear()` and re-fill would repaint every plate every tick" — but a `Graphics` costs its whole command buffer *per frame per camera* whether or not it was re-filled (spec §1: "the countdown's movement hint is 14 rounded rects, ~5,700 points per frame, drawing a picture that never changes"). Static is not free; baked is. Replace the `gfx` parameter and the `fillRoundedRect` loop in `buildHintRow`:

```ts
  private buildHintRow(
    keys: readonly string[],
    alts: readonly string[],
    label: string,
    y: number,
  ): { texts: Phaser.GameObjects.BitmapText[]; pills: Phaser.GameObjects.NineSlice[] } {
    const glyphs = [...keys, MOVEMENT_JOINER, ...alts, label];
    // Pills carry the white-on-copper of the slot keys; the joiner and the trailing label are plain
    // HUD text on the floor, so the row reads as a sentence with keys set into it.
    const isPill = (index: number): boolean =>
      index < keys.length || (index > keys.length && index <= keys.length + alts.length);
    const texts = glyphs.map((glyph, index) =>
      this.scene.add
        .bitmapText(0, y, HUD_FONT, hudSafeText(glyph), MOVEMENT_HINT_FONT_PX)
        .setTint(isPill(index) ? HUD_KEY_PILL_TEXT_TINT : HUD_TEXT_TINT)
        .setOrigin(0.5)
        .setDepth(HUD_TEXT_DEPTH)
        .setVisible(false),
    );

    const width = (index: number): number => texts[index]!.width;
    const items = movementHintItems(
      keys.map((_, i) => width(i)),
      width(keys.length),
      alts.map((_, i) => width(keys.length + 1 + i)),
      width(glyphs.length - 1),
    );
    const { placements } = placeMovementHint(items, {
      padX: HUD_KEY_PILL_PAD_X,
      gap: MOVEMENT_HINT_GAP,
      centerX: ARENA_VIEW_WIDTH / 2,
    });

    // The plate under each key: a three-slice of the baked capsule, drawn at the height it was
    // baked at so the caps keep their radius and only the middle stretches.
    const pillHeight = pillHeightFor(MOVEMENT_HINT_FONT_PX, this.metrics, HUD_KEY_PILL_PAD_Y);
    const pills: Phaser.GameObjects.NineSlice[] = [];
    placements.forEach((placement, index) => {
      texts[index]!.setX(placement.x + placement.width / 2);
      if (!isPill(index)) return;
      pills.push(
        this.scene.add
          .nineslice(
            placement.x,
            y - pillHeight / 2,
            ...bakedFrame("baked.hud.pill.hint"),
            placement.width,
            pillHeight,
            pillHeight / 2,
            pillHeight / 2,
            0,
            0,
          )
          .setOrigin(0, 0)
          .setDepth(HUD_BOX_DEPTH)
          .setVisible(false),
      );
    });
    return { texts, pills };
  }
```

`buildMovementHint` keeps its two rows and stores both lists; `syncMovementHint` toggles `visible` on the texts and the pills together, exactly as it toggled the texts and the one `Graphics` before; `destroy` destroys both lists. Delete the `movementHintGfx` field.

- [ ] **Step 6: Write `HudScene`**

```ts
// packages/client/src/scenes/HudScene.ts
import Phaser from "phaser";
import { assetsReady } from "./BootScene.js";
import { HUD_FONT, hudFontMetrics } from "../render/fonts.js";
import { readHudFrame, readHudPerf, readHudView } from "../render/hud-feed.js";
import { HudRenderer } from "./arena/hud-renderer.js";
import { MatchBanners } from "./hud/match-banners.js";

export const HUD_SCENE_KEY = "hud";

/**
 * The HUD, in its own scene (spec R20).
 *
 * Phaser renders the whole display list once per camera, so the gutter used to need a second camera
 * inside `ArenaScene` and two `ignore` lists to stop everything drawing twice — the "born after
 * `splitCameras`" footgun the preparation plan turned into `ArenaLayers`. A second SCENE removes
 * the class of bug instead of managing it: a world object cannot leak into the HUD because it is
 * not in this display list at all, and `ArenaScene` is left with one camera and nothing to ignore.
 *
 * It reads the same `RenderFrame` the arena renderers draw (the ledger's `registry.get("frame")`).
 * The arena publishes it once per frame after building it, and `bringToTop` puts this scene after
 * the arena in the scene list, so `update` here always sees this frame rather than the last one.
 *
 * Everything it owns is retained (spec R3): built once in `create`, updated per frame, never
 * cleared and refilled and never re-created. Nothing in `update` allocates (spec R6).
 */
export class HudScene extends Phaser.Scene {
  private hud: HudRenderer | undefined;
  private banners: MatchBanners | undefined;

  constructor() {
    super({ key: HUD_SCENE_KEY });
  }

  create(): void {
    // Transparent: the arena scene renders underneath, and a camera with a background colour would
    // paint over it.
    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");
    const metrics = hudFontMetrics(this.cache.bitmapFont, HUD_FONT);
    this.hud = new HudRenderer(this, metrics);
    this.banners = new MatchBanners(this, metrics);
    void assetsReady()
      .then(() => this.hud?.invalidateIcons())
      .catch((error: unknown) => console.warn(`[art] asset load rejected: ${String(error)}`));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  update(): void {
    const frame = readHudFrame(this.registry);
    const view = readHudView(this.registry);
    if (!frame || !view || !this.hud || !this.banners) return;
    this.hud.render(frame, view.targetSid);
    this.banners.sync(frame, view.spectate);
    if (view.idleWarningSeconds > 0) this.banners.showIdleWarning(view.idleWarningSeconds);
    else this.banners.hideIdleWarning();
    // The HUD's own cost belongs in the overlay's `draw` bucket, not in `phaser`: this scene runs
    // immediately after the arena's `update`, so the interval since its last mark is this work.
    const perf = readHudPerf(this.registry);
    perf?.mark("draw");
    perf?.frameEnd();
  }

  private onShutdown(): void {
    this.hud?.destroy();
    this.banners?.destroy();
    this.hud = undefined;
    this.banners = undefined;
  }
}
```

`HudRenderer` keeps its `render(frame, hudTargetSid)` signature from the preparation plan; this task changes only its constructor (`(scene, metrics)` instead of `(scene, layers)`), drops every `layers.hud(...)` wrap and every `setScrollFactor(0)`, and adds an `invalidateIcons()` no-op that Task 4 gives a body. Its `Graphics` and `Text` pools are still there — Task 4 is what removes them. This step's deliverable is the identical picture drawn from the other scene.

- [ ] **Step 7: Rewire `ArenaScene`**

Against the composer the preparation plan's Task 9 produced:

| Change | Where |
|---|---|
| delete the fields `layers`, `hudRenderer`, `banners` | the field block |
| add `private readonly hudView = newHudView();` | the field block |
| replace `this.layers = new ArenaLayers(this);` with nothing; the renderers take `(this, this.debug)` | `create` |
| `const staticCamera = this.drawArena(this.arena);` — `drawArena` now calls `drawArenaFloor(this, arena)` | `create` |
| after the renderers are built: `this.scene.launch(HUD_SCENE_KEY); this.scene.bringToTop(HUD_SCENE_KEY);` | `create` |
| delete `this.hudRenderer = new HudRenderer(...)`, `this.banners = new MatchBanners(...)`, `this.syncBanners(this.room)` | `create` |
| in the `?debug=perf` branch, replace the `layers.hud(obj)` loop with `this.registry.set(HUD_PERF_KEY, this.perf);` | `create` |
| delete the whole `syncBanners` method, and its call from `bindRoom`'s `onState` | `update`, `bindRoom` |
| `onIdleWarning` becomes `this.hudView.idleWarningSeconds = PRACTICE_CONFIG.idleWarningSeconds;` | `bindRoom` |
| `if (pumped.activeInput) this.banners?.hideIdleWarning();` becomes `if (pumped.activeInput) this.hudView.idleWarningSeconds = 0;` | `update` |
| the last two lines of `update` (`this.hudRenderer?.render(...)`) become the publish below | `update` |
| in `resetMatchState`, replace the `hudRenderer`/`banners`/`layers` teardown with `this.scene.stop(HUD_SCENE_KEY);` and `this.registry.remove(HUD_PERF_KEY);` | `resetMatchState` |

The tail of `update`:

```ts
  this.shotRenderer?.render(frame);
  // The HUD reads the frame the arena already built; there is no second build and no second
  // camera. `HudScene` updates after this one (`bringToTop` in `create`), so it always draws this
  // frame. `hudView` is one object mutated in place — a fresh one per frame would allocate on the
  // frame path (spec R6).
  this.hudView.targetSid = this.spectate?.hudTarget(frame) ?? frame.localSessionId;
  this.hudView.spectate = this.spectate?.view(frame) ?? this.hudView.spectate;
  publishHudFrame(this.registry, frame, this.hudView);
  this.perf?.mark("draw");
  this.perf?.frameEnd();
```

Deleting `syncBanners` is a real saving, not tidying: V0's `docs/render-bench.md` records that it "builds a second frame before `pumpInput` runs, and that cost lands in `sim`". One frame per frame from here on. Note it in the commit message and in Task 5's doc update.

- [ ] **Step 8: Delete `ArenaLayers` and fix its callers**

```bash
git rm packages/client/src/scenes/arena/arena-layers.ts
```

| File | Change |
|---|---|
| `scenes/arena/car-renderer.ts` | `constructor(scene, layers, debug)` → `constructor(scene, debug)`; every `this.layers.world(x)` → `x`; drop the import |
| `scenes/arena/shot-renderer.ts` | same |
| `scenes/arena/arena-floor.ts` | `drawArenaFloor(scene, layers, arena)` → `drawArenaFloor(scene, arena)`; `layers.world(scene.add.graphics()...)` → `scene.add.graphics()...`; drop the import |
| `scenes/arena/hud-renderer.ts` | `constructor(scene, layers)` → `constructor(scene, metrics)`; every `layers.hud(x)` → `x`; every `.setScrollFactor(0)` → deleted; drop the import |
| `scenes/hud/match-banners.ts` | done in Step 5 |
| `dev/BenchScene.ts` | Step 10 |

`ArenaLayers`' doc comment explained why the registry existed; that reasoning now lives in `HudScene`'s class comment, so nothing is lost with the file.

- [ ] **Step 9: `PerfOverlay`'s `Text` becomes a `BitmapText`**

V0's own documentation promised this: "the overlay's own `Text` re-rasterises four times a second, which is inside the numbers it shows until V1 swaps it for `BitmapText`" (R23: "Both are `BitmapText`"). In `render/perf-overlay.ts`, replace the `this.text = scene.add.text(...)` block with:

```ts
    // A plate behind the text, because a `BitmapText` has no `backgroundColor`: one baked white
    // quad, tinted and resized only when the text block changes (four times a second).
    this.plate = scene.add
      .image(PERF_OVERLAY_CONFIG.x, PERF_OVERLAY_CONFIG.y, ...bakedFrame("baked.hud.px"))
      .setOrigin(0, 0)
      .setTint(PERF_OVERLAY_CONFIG.plateTint)
      .setAlpha(PERF_OVERLAY_CONFIG.plateAlpha)
      .setDepth(PERF_OVERLAY_CONFIG.depth);
    this.text = scene.add
      .bitmapText(PERF_OVERLAY_CONFIG.x, PERF_OVERLAY_CONFIG.y, HUD_FONT, "", PERF_OVERLAY_CONFIG.fontPx)
      .setTint(PERF_OVERLAY_CONFIG.textTint)
      .setDepth(PERF_OVERLAY_CONFIG.depth + 1);
```

and in `onPostRender`, after `this.text.setText(lines)`:

```ts
      this.plate.setDisplaySize(
        this.text.width + PERF_OVERLAY_CONFIG.platePadPx * 2,
        this.text.height + PERF_OVERLAY_CONFIG.platePadPx * 2,
      );
```

Nudge the text by `platePadPx` in both axes when it is created, add `plate` to `gameObjects()` and to `destroy()`, and add to `PERF_OVERLAY_CONFIG` in `render/perf-stats.ts`:

```ts
  /** The plate behind the overlay's text; `Text`'s `backgroundColor` has no `BitmapText` twin. */
  plateTint: 0x000000,
  plateAlpha: 0.69,
  platePadPx: 4,
  textTint: 0xffffff,
```

Delete the now-stale sentence in `refreshMs`'s comment ("V1 swaps it for `BitmapText`") and replace it with "The refresh rate now costs a quad rebuild rather than a texture upload; it stays at 4 Hz because a number that changes 60 times a second cannot be read."

- [ ] **Step 10: Register the scene and update `BenchScene`**

In `main.ts`, import `HudScene` and add it to the `scene:` array **after** `ArenaScene`. Only the first scene in that array auto-starts, so adding it is inert until something launches it.

In `dev/BenchScene.ts`: delete its own `HudRenderer` and `MatchBanners` fields and their construction, launch the real HUD instead, and publish the same feed the arena does:

```ts
    this.carRenderer = new CarRenderer(this, debug);
    this.shotRenderer = new ShotRenderer(this, debug);
    const perf = new PerfOverlay(this);
    this.perf = perf;
    this.registry.set(HUD_PERF_KEY, perf);
    this.scene.launch(HUD_SCENE_KEY);
    this.scene.bringToTop(HUD_SCENE_KEY);
```

and in `update`, after `this.shotRenderer.render(frame)`:

```ts
    this.hudView.targetSid = frame.localSessionId;
    publishHudFrame(this.registry, frame, this.hudView);
```

Delete `BENCH_VIEW` in favour of `newHudView()` stored in a field, delete the `perf.mark("draw")`/`perf.frameEnd()` pair from `BenchScene.update` (the HUD scene now makes both calls, after its own work), and in `onShutdown` add `this.scene.stop(HUD_SCENE_KEY); this.registry.remove(HUD_PERF_KEY);`. Replace the `DEV_TOOL_MARKER` `this.add.text(...)` with `this.add.bitmapText(..., HUD_FONT, DEV_TOOL_MARKER, MARKER_FONT_PX)` — the census in Task 5 counts every `Text` in the game, and the marker is one.

- [ ] **Step 11: Typecheck, test, look**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
cd packages/client && npm run typecheck && cd ../..
npm run build
npm run smoke:arena
```

Expected: every suite green; typecheck clean; the build succeeds; the smoke check exits 0.

Run `npm run dev`, open `http://localhost:5173`, Practice → Start. Expected, and this is the whole point of the step: **the picture is unchanged.** Slot bar, badges, roster, countdown numeral, movement hint, match clock, spectate banner all in the same places; nothing draws twice; nothing draws over the gutter; `?debug=1` still outlines hitboxes and `?debug=perf` still prints its three lines. Die and watch a bot: the spectate banner names the car, `[`/`]` still switches, `V` still enters free roam and the slot bar empties there.

- [ ] **Step 12: Commit**

```bash
git add -A packages/client/src packages/client/src/main.ts
git commit -m "refactor(client): the HUD is its own scene; ArenaLayers and the ignore lists are gone

Also removes ArenaScene.syncBanners, which built a second RenderFrame per frame and charged it
to the perf overlay's sim bucket (docs/render-bench.md, V0 baseline).

Moves no playtest probe number: no sim, table, tick order or prediction code is touched."
```

---

### Task 4: Retained HUD — sprites and `BitmapText` all the way down

**Files:**
- Create: `packages/client/src/scenes/hud/slot-bar.ts`
- Create: `packages/client/src/scenes/hud/status-strip.ts`
- Create: `packages/client/src/scenes/hud/roster-view.ts`
- Delete: `packages/client/src/scenes/arena/hud-renderer.ts`
- Modify: `packages/client/src/scenes/HudScene.ts`

**Interfaces:**
- Consumes: everything Tasks 1–3 produce; the pure derivations `slotBarLayout`, `slotVisualState`, `sweepFraction`, `countdownSeconds`, `resolveWeaponIcon`, `HUD_DIM`, `HUD_ICON_FIT_SCALE` (`scenes/weapon-hud.ts`), `statusBadges`, `statusStripLayout` (`scenes/status-hud.ts`), `rosterRows`, `rosterPanelLayout`, `truncateName` (`scenes/roster-panel.ts`) — all unchanged.
- Produces:

```ts
export class SlotBarView {
  constructor(scene: Phaser.Scene, metrics: HudFontMetrics);
  /** Draws the target's slots below `topInset`; returns the bar's top y for the badge strip. */
  update(frame: RenderFrame, targetSid: string, topInset: number): number;
  invalidateIcons(): void;
  destroy(): void;
}
export class StatusStripView {
  constructor(scene: Phaser.Scene);
  update(frame: RenderFrame, targetSid: string, slotBarTop: number): void;
  destroy(): void;
}
export class RosterView {
  constructor(scene: Phaser.Scene);
  /** Returns the panel's height, which is the slot bar's `topInset` (D12). */
  update(frame: RenderFrame): number;
  destroy(): void;
}
```

**The rule this task implements (R3 + R6).** Every element is built once and updated by property. Nothing is cleared, nothing is refilled, nothing is created or destroyed while the match runs, and the update path allocates nothing: no `map`, no spread, no template literal, no `String(n)` for a number that has not changed. Three per-frame allocations disappear with the old code — `resolveWeaponIcon` returned a fresh `{key, entry, fit}` plus a `SpriteFit` for every slot every frame (three slots × 60 Hz × 2 objects = 360/s), `rosterRows` and `statusBadges` still build arrays but only from data that changed, and the `Graphics` command buffers are gone entirely.

- [ ] **Step 1: Write `SlotBarView`**

```ts
// packages/client/src/scenes/hud/slot-bar.ts
import Phaser from "phaser";
import { WEAPON_SLOT_CONFIG, isWeaponId, weaponDefOf, weaponTicksOf } from "@motor-combat-moba/shared";
import { assetManifest } from "../BootScene.js";
import { phaserTextures } from "../../assets/car-sprite.js";
import { bakedFrame } from "../../render/bake.js";
import { HUD_FONT, HUD_FONT_BOLD, hudSafeText, type HudFontMetrics } from "../../render/fonts.js";
import { carOf, type RenderCar, type RenderFrame, type RenderSlot } from "../../match/render-frame.js";
import { HUD_GUTTER_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from "../../config/display.js";
import { SLOT_KEYS } from "../../config/slot-keys.js";
import { HUD_DIM, HUD_ICON_FIT_SCALE, countdownSeconds, resolveWeaponIcon, slotBarLayout,
  slotVisualState, sweepFraction, type SlotBox } from "../weapon-hud.js";
import { HUD_BOX_DEPTH, HUD_COUNTDOWN_FONT_PX, HUD_ICON_DEPTH, HUD_KEY_FONT_PX, HUD_KEY_PILL_PAD_X,
  HUD_KEY_PILL_PAD_Y, HUD_KEY_PILL_TEXT_TINT, HUD_NAME_FONT_PX, HUD_RING_COLOR, HUD_STOCK_FONT_PX,
  HUD_STOCK_RADIUS_SCALE, HUD_SWEEP_DEPTH, HUD_TEXT_DEPTH } from "./hud-style.js";
import { SWEEP_FRAME_NAMES, countdownKeyOffset, pillHeightFor, ringAlpha, sweepAlpha,
  sweepFrameIndex, washAlpha } from "./slot-model.js";

/**
 * The slot column, retained.
 *
 * Every rule about what a slot shows is still `weapon-hud.ts`'s — `slotVisualState`, `sweepFraction`
 * and `countdownSeconds` are untouched. What changed is what draws the answer: the ring, its wash,
 * the cooldown arc, the procedural glyph and the key pill were `Graphics` fills rebuilt sixty times
 * a second (about 1,830 tessellated points a frame for three static circles, spec §1) and are now
 * baked frames whose position, alpha, tint and frame index are set only when they change.
 */
export class SlotBarView {
  private readonly slots: SlotView[] = [];
  private topY = VIEW_HEIGHT / 2;

  constructor(scene: Phaser.Scene, metrics: HudFontMetrics) {
    for (let i = 0; i < WEAPON_SLOT_CONFIG.maxWeaponSlots; i++) {
      this.slots.push(new SlotView(scene, metrics, i));
    }
  }

  update(frame: RenderFrame, targetSid: string, topInset: number): number {
    const car = carOf(frame, targetSid);
    const boxes = car ? slotBarLayout(car.weapons.length, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, topInset) : EMPTY_BOXES;
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i]!.update(boxes[i], car?.weapons[i], car, frame.tick);
    }
    this.topY = boxes[0]?.y ?? VIEW_HEIGHT / 2;
    return this.topY;
  }

  /** Art finished loading: every slot re-asks for its manifest icon once, then caches again. */
  invalidateIcons(): void {
    for (const slot of this.slots) slot.invalidateIcon();
  }

  destroy(): void {
    for (const slot of this.slots) slot.destroy();
    this.slots.length = 0;
  }
}

/** Shared empty layout, so a frame with no target allocates nothing (spec R6). */
const EMPTY_BOXES: readonly SlotBox[] = [];

/** No icon resolved, and none to look for; distinct from "not looked up yet" (`undefined`). */
const NO_ICON = "";

class SlotView {
  private readonly wash: Phaser.GameObjects.Image;
  private readonly ring: Phaser.GameObjects.Image;
  private readonly sweep: Phaser.GameObjects.Image;
  private readonly glyph: Phaser.GameObjects.Image;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly pill: Phaser.GameObjects.NineSlice;
  private readonly key: Phaser.GameObjects.BitmapText;
  private readonly name: Phaser.GameObjects.BitmapText;
  private readonly countdown: Phaser.GameObjects.BitmapText;
  private readonly stock: Phaser.GameObjects.BitmapText;
  /** Every object this slot owns, for the two loops that touch all of them. */
  private readonly all: Phaser.GameObjects.GameObject[];

  // Last values written. A frame that changes none of them calls no setter at all (spec R3).
  private placedY = Number.NaN;
  private lastWeaponId = "";
  private lastIconKey: string | undefined;
  private lastDim = -1;
  private lastDraining = false;
  private lastSweep = -1;
  private lastSeconds = -1;
  private lastStocks = -1;
  private shown = true;

  private readonly countdownOffset: number;

  constructor(
    private readonly scene: Phaser.Scene,
    metrics: HudFontMetrics,
    private readonly index: number,
  ) {
    const pillHeight = pillHeightFor(HUD_KEY_FONT_PX, metrics, HUD_KEY_PILL_PAD_Y);
    this.countdownOffset = countdownKeyOffset(metrics);
    const image = (frame: string, depth: number): Phaser.GameObjects.Image =>
      scene.add.image(0, 0, ...bakedFrame(frame)).setDepth(depth).setVisible(false);

    this.wash = image("baked.hud.wash", HUD_BOX_DEPTH).setTint(HUD_RING_COLOR);
    this.ring = image("baked.hud.ring", HUD_BOX_DEPTH).setTint(HUD_RING_COLOR);
    this.glyph = image("baked.hud.glyph.projectile", HUD_BOX_DEPTH);
    this.icon = scene.add.image(0, 0, "__DEFAULT").setDepth(HUD_ICON_DEPTH).setVisible(false);
    // Above the icon pool, as `HUD_SWEEP_DEPTH`'s comment has always required: a resolved icon
    // overlapping the ring would otherwise cut the arc timing it.
    this.sweep = image(SWEEP_FRAME_NAMES[0]!, HUD_SWEEP_DEPTH).setTint(HUD_RING_COLOR);
    this.pill = scene.add
      .nineslice(0, 0, ...bakedFrame("baked.hud.pill.key"), pillHeight, pillHeight, pillHeight / 2, pillHeight / 2, 0, 0)
      .setOrigin(0, 0.5)
      .setDepth(HUD_BOX_DEPTH)
      .setVisible(false);

    const text = (font: string, px: number, originX: number, originY: number): Phaser.GameObjects.BitmapText =>
      scene.add.bitmapText(0, 0, font, "", px).setOrigin(originX, originY).setDepth(HUD_TEXT_DEPTH).setVisible(false);

    // Left-centre: the key sits `SLOT_KEY_GAP_PX` to the RIGHT of the slot and centred on it, so
    // `keyX` is the label's left edge and `cy` its middle (D18 wants the key outside the frame).
    this.key = text(HUD_FONT, HUD_KEY_FONT_PX, 0, 0.5).setTint(HUD_KEY_PILL_TEXT_TINT);
    // Top-centre under the slot, in the bold face: at 12px the name is the only word in the gutter
    // and the first thing to fall away against the cream.
    this.name = text(HUD_FONT_BOLD, HUD_NAME_FONT_PX, 0.5, 0).setTint(HUD_RING_COLOR);
    this.countdown = text(HUD_FONT, HUD_COUNTDOWN_FONT_PX, 0, 0.5);
    this.stock = text(HUD_FONT, HUD_STOCK_FONT_PX, 0.5, 0.5);
    // Set once: the key glyph is a binding, not a per-frame fact, and the pill is sized from it.
    this.key.setText(hudSafeText(SLOT_KEYS[index]?.glyph ?? ""));
    this.pill.setSize(this.key.width + HUD_KEY_PILL_PAD_X * 2, pillHeight);
    this.all = [this.wash, this.ring, this.sweep, this.glyph, this.icon, this.pill, this.key,
      this.name, this.countdown, this.stock];
  }

  update(box: SlotBox | undefined, slot: RenderSlot | undefined, car: RenderCar | undefined, tick: number): void {
    if (!box || !slot || !car) {
      this.hide();
      return;
    }
    if (!this.shown) this.show();

    const def = isWeaponId(slot.weaponId) ? weaponDefOf(slot.weaponId) : undefined;
    const state = slotVisualState(
      { stocks: slot.stocks, rechargeEndsTick: slot.rechargeEndsTick },
      { unlocksAt: def?.unlocksAt ?? 1 },
      car.level,
      car.switchLockUntilTick,
      tick < car.pendingUntilTick ? { slot: car.lastFiredSlot } : null,
      tick,
      this.index === car.lastFiredSlot,
    );
    const dim = state === "car-locked" ? HUD_DIM.carLocked : HUD_DIM[state];
    const cx = box.x + box.size / 2;
    const cy = box.y + box.size / 2;
    if (box.y !== this.placedY) this.place(box, cx, cy);

    // Ready-but-recharging is a stock weapon banking another charge; `locked` and `car-locked`
    // never show a sweep, so the two dims stay unambiguous.
    const recharging = slot.rechargeEndsTick !== 0 && (state === "recharging" || state === "ready");
    const fraction = recharging && def ? sweepFraction(slot.rechargeEndsTick, weaponTicksOf(def.id).cooldown, tick) : 0;
    const draining = fraction > 0;

    if (dim !== this.lastDim || draining !== this.lastDraining) {
      this.wash.setAlpha(washAlpha(dim));
      this.ring.setAlpha(ringAlpha(dim, draining));
      this.sweep.setAlpha(sweepAlpha(dim));
      this.glyph.setAlpha(dim);
      this.icon.setAlpha(dim);
      this.pill.setAlpha(dim);
      this.key.setAlpha(dim);
      this.name.setAlpha(dim);
      this.lastDim = dim;
      this.lastDraining = draining;
    }

    const sweepFrame = draining ? sweepFrameIndex(fraction) : -1;
    if (sweepFrame !== this.lastSweep) {
      if (sweepFrame >= 0) this.sweep.setFrame(SWEEP_FRAME_NAMES[sweepFrame]!);
      this.sweep.setVisible(sweepFrame >= 0);
      this.lastSweep = sweepFrame;
    }

    if (slot.weaponId !== this.lastWeaponId || this.lastIconKey === undefined) {
      this.applyWeapon(def, box, cx, cy);
      this.lastWeaponId = slot.weaponId;
    }

    // Only stringify a number that changed: `String(n)` on the frame path is an allocation per slot
    // per frame for a label that ticks once a second.
    const seconds = recharging ? countdownSeconds(slot.rechargeEndsTick, tick) : null;
    const whole = seconds === null ? -1 : Math.ceil(seconds);
    if (whole !== this.lastSeconds) {
      if (whole >= 0) this.countdown.setText(String(whole));
      this.countdown.setVisible(whole >= 0);
      this.lastSeconds = whole;
    }

    const stocks = def?.stock ? slot.stocks : -1;
    if (stocks !== this.lastStocks) {
      if (stocks >= 0) this.stock.setText(String(stocks));
      this.stock.setVisible(stocks >= 0);
      this.lastStocks = stocks;
    }
  }

  invalidateIcon(): void {
    this.lastIconKey = undefined;
  }

  private place(box: SlotBox, cx: number, cy: number): void {
    // The baked tiles are supersampled; `setDisplaySize` puts each back on the box the layout
    // reserved, whatever tier baked them.
    for (const obj of [this.wash, this.ring, this.sweep, this.glyph]) {
      obj.setPosition(cx, cy).setDisplaySize(box.size, box.size);
    }
    this.icon.setPosition(cx, cy);
    this.pill.setPosition(box.keyX, cy);
    this.key.setPosition(box.keyX + HUD_KEY_PILL_PAD_X, cy);
    this.name.setPosition(cx, box.nameY);
    this.countdown.setPosition(box.keyX, cy + this.countdownOffset);
    const inset = (box.size / 2) * HUD_STOCK_RADIUS_SCALE;
    this.stock.setPosition(cx + inset, cy + inset);
    this.placedY = box.y;
  }

  /**
   * Resolve this slot's manifest icon and its name, once per weapon rather than once per frame.
   *
   * `resolveWeaponIcon` allocates a `ResolvedWeaponIcon` and a `SpriteFit` on every call, and the
   * old HUD called it for every slot on every frame. A slot's weapon changes when the car changes;
   * `invalidateIcon` covers the one other case, art arriving after boot.
   *
   * The procedural glyph fallback is permanent, not a placeholder: a missing icon PNG must never be
   * a bug, only a slot that looks like it always has.
   */
  private applyWeapon(def: ReturnType<typeof weaponDefOf> | undefined, box: SlotBox, cx: number, cy: number): void {
    const resolved = def
      ? resolveWeaponIcon(assetManifest(), phaserTextures(this.scene.textures), def.id, box.size * HUD_ICON_FIT_SCALE)
      : undefined;
    if (resolved) {
      this.icon
        .setTexture(resolved.key)
        .setPosition(cx, cy)
        .setOrigin(resolved.fit.originX, resolved.fit.originY)
        .setScale(resolved.fit.scale)
        .setRotation(resolved.fit.rotation)
        // Weapon icons keep their colour (`colorMode: "none"`); dimming rides on alpha alone.
        .clearTint()
        .setVisible(true);
      this.glyph.setVisible(false);
    } else {
      this.icon.setVisible(false);
      this.glyph
        .setFrame(def?.kind === "beam" ? "baked.hud.glyph.beam" : "baked.hud.glyph.projectile")
        .setVisible(true);
    }
    this.lastIconKey = resolved?.key ?? NO_ICON;
    if (def) this.name.setText(hudSafeText(def.name));
    this.name.setVisible(!!def);
  }

  private show(): void {
    for (const obj of [this.wash, this.ring, this.pill, this.key]) obj.setVisible(true);
    this.shown = true;
    // Force every guarded setter to run once for the newly shown slot.
    this.lastDim = this.lastSweep = this.lastSeconds = this.lastStocks = -1;
    this.lastIconKey = undefined;
  }

  private hide(): void {
    if (!this.shown) return;
    for (const obj of this.all) obj.setVisible(false);
    this.shown = false;
  }

  destroy(): void {
    for (const obj of this.all) obj.destroy();
  }
}
```

- [ ] **Step 2: Write `StatusStripView`**

A move of `hud-renderer.ts`'s `drawStatusStrip` (originally `ArenaScene.ts:2167-2215`), keeping every
comment. Its rules stay in `status-hud.ts`: `statusBadges` and `statusStripLayout` are untouched.

```ts
// packages/client/src/scenes/hud/status-strip.ts
export class StatusStripView {
  private readonly pills: Phaser.GameObjects.Image[] = [];
  private readonly bars: Phaser.GameObjects.Image[] = [];
  private readonly labels: Phaser.GameObjects.BitmapText[] = [];
  private readonly lastLabel: string[] = [];

  constructor(scene: Phaser.Scene) {
    for (let i = 0; i < STATUS_CONFIG.maxActive; i++) {
      const box = (originY: number): Phaser.GameObjects.Image =>
        scene.add.image(0, 0, ...bakedFrame("baked.hud.px")).setOrigin(0, originY).setDepth(HUD_BOX_DEPTH).setVisible(false);
      this.pills.push(box(0));
      // Origin at the bottom edge: the drain bar shrinks upward from it (see below).
      this.bars.push(box(1));
      this.labels.push(
        scene.add
          .bitmapText(0, 0, HUD_FONT, "", STATUS_LABEL_FONT_PX)
          .setOrigin(0, 0.5)
          .setTint(HUD_STATUS_TEXT_TINT)
          .setDepth(HUD_TEXT_DEPTH)
          .setVisible(false),
      );
      this.lastLabel.push("");
    }
  }

  update(frame: RenderFrame, targetSid: string, slotBarTop: number): void {
    const car = carOf(frame, targetSid);
    const badges = car ? statusBadges(car.statuses, frame.tick) : EMPTY_BADGES;
    const boxes = statusStripLayout(badges.length, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, slotBarTop);

    for (let i = 0; i < this.labels.length; i++) {
      const badge = badges[i];
      const box = boxes[i];
      const [pill, bar, label] = [this.pills[i]!, this.bars[i]!, this.labels[i]!];
      if (!badge || !box) {
        pill.setVisible(false);
        bar.setVisible(false);
        label.setVisible(false);
        continue;
      }
      // The pill: a wash of the effect's own colour, so a debuff is told apart from a buff by
      // colour before the label is read at all.
      pill.setPosition(box.x, box.y).setDisplaySize(box.width, box.height)
        .setTint(badge.fill).setAlpha(HUD_STATUS_WASH_ALPHA).setVisible(true);
      // The drain bar down the left edge, at full alpha and shrinking from the bottom. Height, not
      // width: a strip of vertical bars all draining at once is legible at a glance in a way a row
      // of shrinking pills is not, and it leaves the label's own width alone.
      bar.setPosition(box.x, box.y + box.height)
        .setDisplaySize(STATUS_BAR_WIDTH_PX, box.height * badge.fraction)
        .setTint(badge.fill).setVisible(true);

      // Two labels a second at most: only the seconds figure moves.
      const text = `${badge.name}  ${badge.secondsLeft}s`;
      if (text !== this.lastLabel[i]) {
        label.setText(hudSafeText(text));
        this.lastLabel[i] = text;
      }
      label
        .setPosition(box.x + STATUS_BAR_WIDTH_PX + HUD_STATUS_LABEL_PAD_X, box.y + STATUS_BADGE_HEIGHT_PX / 2)
        .setVisible(true);
    }
  }

  destroy(): void {
    for (const obj of [...this.pills, ...this.bars, ...this.labels]) obj.destroy();
    this.pills.length = this.bars.length = this.labels.length = 0;
  }
}

/** Shared empty list, so a frame with no target allocates nothing (spec R6). */
const EMPTY_BADGES: readonly StatusBadge[] = [];
```

The substitutions against the old body: `gfx.fillStyle(badge.fill, HUD_STATUS_WASH_ALPHA); gfx.fillRect(box.x, box.y, box.width, box.height)` becomes the `pill` block; `gfx.fillStyle(badge.fill, 1); gfx.fillRect(box.x, box.y + box.height - barHeight, STATUS_BAR_WIDTH_PX, barHeight)` becomes the `bar` block, with the bottom-origin sprite doing the `- barHeight` arithmetic; `label.setPosition(...).setText(...).setVisible(true)` gains the changed-string guard. Imports: `STATUS_CONFIG` from shared; `bakedFrame`; `HUD_FONT`, `hudSafeText`; `carOf`, `RenderFrame`; `HUD_GUTTER_WIDTH`, `VIEW_HEIGHT`, `VIEW_WIDTH`; `STATUS_BADGE_HEIGHT_PX`, `STATUS_BAR_WIDTH_PX`, `STATUS_LABEL_FONT_PX`, `StatusBadge`, `statusBadges`, `statusStripLayout` from `../status-hud.js`; the four `HUD_*` constants from `./hud-style.js`.

- [ ] **Step 3: Write `RosterView`**

A move of `renderRosterPanel` (originally `ArenaScene.ts:2069-2113`), same shape. Its rules stay in
`roster-panel.ts`. The second `Graphics` that existed purely so the swatches could not be wiped by
whichever method `clear()`ed last goes with the `clear()`: each swatch is a tinted copy of one baked
square, and the ordering trap is gone with the object.

```ts
// packages/client/src/scenes/hud/roster-view.ts
export class RosterView {
  private readonly swatches: Phaser.GameObjects.Image[] = [];
  private readonly names: Phaser.GameObjects.BitmapText[] = [];
  private readonly kills: Phaser.GameObjects.BitmapText[] = [];
  private readonly lastName: string[] = [];
  private readonly lastKills: number[] = [];

  constructor(scene: Phaser.Scene) {
    const text = (originX: number): Phaser.GameObjects.BitmapText =>
      scene.add.bitmapText(0, 0, HUD_FONT, "", ROSTER_NAME_FONT_PX)
        .setOrigin(originX, 0.5).setDepth(HUD_TEXT_DEPTH).setVisible(false);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      this.swatches.push(
        scene.add.image(0, 0, ...bakedFrame("baked.hud.px")).setOrigin(0, 0).setDepth(HUD_BOX_DEPTH).setVisible(false),
      );
      // Left-centre, hung off the row's `labelX`; and its mirror, anchored to the panel's right
      // edge so one- and two-digit scores share a column rather than shifting it.
      this.names.push(text(0));
      this.kills.push(text(1));
      this.lastName.push("");
      this.lastKills.push(-1);
    }
  }

  update(frame: RenderFrame): number {
    // Asked through `winRuleOf` rather than by testing the enum, so the panel asks what the
    // server's win check asks.
    const showKills = winRuleOf(frame.mode) === "deathmatch";
    const rows = rosterRows(frame.cars);
    const panel = rosterPanelLayout(rows.length, VIEW_WIDTH, HUD_GUTTER_WIDTH, showKills);

    for (let i = 0; i < this.names.length; i++) {
      const row = rows[i];
      const box = panel.rows[i];
      const [swatch, name, kills] = [this.swatches[i]!, this.names[i]!, this.kills[i]!];
      if (!row || !box || !showKills) kills.setVisible(false);
      if (!row || !box) {
        swatch.setVisible(false);
        name.setVisible(false);
        continue;
      }
      // `carFillOf`, the same function that paints the car, so the panel can never disagree with
      // the field about who is who.
      swatch.setPosition(box.x, box.y).setDisplaySize(box.size, box.size)
        .setTint(carFillOf(row.colorId)).setAlpha(row.alive ? 1 : ROSTER_DEAD_SWATCH_ALPHA).setVisible(true);

      const tint = row.alive ? ROSTER_LIVE_TINT : ROSTER_DEAD_TINT;
      const label = truncateName(row.name, panel.nameMaxChars);
      if (label !== this.lastName[i]) {
        name.setText(hudSafeText(label));
        this.lastName[i] = label;
      }
      name.setPosition(box.labelX, box.centerY).setTint(tint).setVisible(true);

      if (!showKills) continue;
      if (row.kills !== this.lastKills[i]) {
        kills.setText(String(row.kills));
        this.lastKills[i] = row.kills;
      }
      // Greyed with its name rather than on its own rule: a score at full contrast beside a faded
      // name would read as the live half of a split player.
      kills.setPosition(panel.killsX, box.centerY).setTint(tint).setVisible(true);
    }

    return panel.height;
  }

  destroy(): void {
    for (const obj of [...this.swatches, ...this.names, ...this.kills]) obj.destroy();
    this.swatches.length = this.names.length = this.kills.length = 0;
  }
}
```

Substitutions against the old body: `[...room.state.players.values()]` is already `frame.cars` from
the preparation plan; `gfx.fillStyle(carFillOf(row.colorId), row.alive ? 1 : ROSTER_DEAD_SWATCH_ALPHA); gfx.fillRect(box.x, box.y, box.size, box.size)`
becomes the `swatch` block; the `if (label.style.color !== color) label.setColor(color)` guards — which
existed because touching a `Text`'s style re-rasterises its canvas — become plain `setTint` calls,
since a tint is a GPU uniform and costs nothing to re-assert. Imports: `MAX_PLAYERS`, `winRuleOf`
from shared; `bakedFrame`; `HUD_FONT`, `hudSafeText`; `RenderFrame`; `HUD_GUTTER_WIDTH`,
`VIEW_WIDTH`; `carFillOf` from `../car-visual.js`; `ROSTER_NAME_FONT_PX`, `rosterPanelLayout`,
`rosterRows`, `truncateName` from `../roster-panel.js`; the four constants from `./hud-style.js`.

- [ ] **Step 4: Point `HudScene` at the three views and delete `HudRenderer`**

In `HudScene`, replace the `hud: HudRenderer` field with the three views and the `render` call with the three-line sequence the old `HudRenderer.render` was:

```ts
  private roster: RosterView | undefined;
  private slots: SlotBarView | undefined;
  private status: StatusStripView | undefined;
```

```ts
    this.roster = new RosterView(this);
    this.slots = new SlotBarView(this, metrics);
    this.status = new StatusStripView(this);
```

```ts
    // The panel's height is the slot bar's `topInset`, and the badge strip is anchored to the bar's
    // own top: three things share one column and only the caller can hold the single answer (D12).
    const panelHeight = this.roster.update(frame);
    const slotBarTop = this.slots.update(frame, view.targetSid, panelHeight);
    this.status.update(frame, view.targetSid, slotBarTop);
```

`invalidateIcons` forwards to `this.slots`. Then:

```bash
git rm packages/client/src/scenes/arena/hud-renderer.ts
```

Everything in it is now either in `hud-style.ts` (the constants, Task 2), in `bake.ts` (`drawSlotRing`, `drawSweepArc`, `drawWeaponGlyph`, `flamePoints`, `flameScratch`, `slotRingRadius` — kept as the authoring source, run once, spec R14) or in the three views (`renderRosterPanel`, `renderWeaponHud`, `drawStatusStrip`, `drawHudSlot`, `hudDimFor`, `applyWeaponIcon`). `buildHudTextPool` and `makeHudText` are gone with the pools they built.

Grep for stragglers and fix each import: `grep -rn "hud-renderer" packages/client/src` must print nothing.

- [ ] **Step 5: Typecheck, test, look hard**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
cd packages/client && npm run typecheck && cd ../..
npm run build && npm run smoke:arena
```

Expected: green, clean, exit 0.

Run `npm run dev`, Practice → Start, and check every state the slot bar has:

- a ready slot: full-brightness ring, wash, icon, white key on a copper pill, bold copper name;
- fire it: the ring becomes a dim track, the bright arc drains clockwise from twelve o'clock, the countdown numeral appears under the key and clears the pill, and the other two slots dim to `HUD_DIM.carLocked` and come back;
- a stock weapon shows its count on the inner diagonal;
- `magmablast` (no manifest icon? check `?dev=assets`) or any weapon whose PNG is missing falls back to the flame glyph, and a beam weapon to the bar glyph;
- statuses: ram a bot until something applies `stunned` and watch the badge's bar drain;
- Deathmatch practice: the roster shows kills, and a dead row greys name, count and swatch together;
- the countdown numeral, the movement hint's pills and the spectate banner all draw as before.

Then in the console: `game.scene.getScene("hud").children.list.filter(o => o.type === "Graphics" || o.type === "Text").length` prints `0`.

- [ ] **Step 6: Commit**

```bash
git add -A packages/client/src
git commit -m "feat(client): retained HUD — baked ring, sweep sheet and BitmapText replace hudGfx, hudSweepGfx and rosterGfx

Moves no playtest probe number: no sim, table, tick order or prediction code is touched."
```

---

### Task 5: Measure it, guard it, write it down

**Files:**
- Create: `scripts/hud-retained.test.mjs`
- Modify: `packages/client/src/dev/BenchScene.ts` (the census on `window.__bench`)
- Modify: `scripts/bench-arena.mjs`
- Modify: `docs/render-bench.md`, `CLAUDE.md`, `packages/client/CLAUDE.md`, `docs/project-structure.md`

**Interfaces:**
- Consumes: V0's `BenchProbe`, `window.__bench`, `formatBenchRows`, `BENCH_ARENA_DEFAULTS`.
- Produces: `sceneCensus(game): SceneCensus`, `BenchProbe.census()`, `formatCensusRow`.

**How the two acceptance facts are checked without eyes.** "Zero `Graphics` per frame" and "`Text` count 0" are structural, not statistical, so they are checked twice and neither check is a p95:

1. **A source guard in `npm test`** (`scripts/hud-retained.test.mjs`) — the HUD's own files may not name a `Graphics`, a `Text` or an immediate-mode fill. It catches the regression at the moment it is typed, in the suite everyone runs.
2. **A live census in `npm run bench:arena`** — the bench walks every active scene's display list and counts objects by type. `Text` anywhere and `Graphics` in the HUD scene are hard failures that exit 1. This is the one that cannot be fooled: it counts what the renderer actually holds.

p95 stays a number a person reads off `docs/render-bench.md` against V0's baseline on the same machine, because a frame-time threshold asserted in CI on shared hardware fails for reasons that have nothing to do with the renderer.

- [ ] **Step 1: Write the failing source guard**

```js
// scripts/hud-retained.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientSrc = path.join(rootDir, "packages", "client", "src");

/**
 * The HUD's own sources. Everything drawn in the gutter is one of these files; if a fourth view
 * lands, add it here — a file this list does not name is a file the guard does not protect.
 */
const HUD_FILES = [
  "scenes/HudScene.ts",
  "scenes/hud/slot-bar.ts",
  "scenes/hud/status-strip.ts",
  "scenes/hud/roster-view.ts",
  "scenes/hud/match-banners.ts",
];

/**
 * Immediate-mode drawing and canvas text, both forbidden on the HUD's frame path.
 *
 * A `Graphics` is re-transformed and re-triangulated every frame per camera whether or not it was
 * refilled, and a `Text` owns a canvas-backed GL texture it re-uploads on every changed string
 * (rendering spec section 1). The HUD pays for its detail once, in `render/bake.ts`, and per frame
 * pays only for position (R1, R3).
 */
const FORBIDDEN = [
  [/\badd\.graphics\b/, "add.graphics — bake the shape in render/bake.ts and draw a sprite"],
  [/\badd\.text\b/, "add.text — use add.bitmapText with HUD_FONT"],
  [/\bGameObjects\.Graphics\b/, "a Graphics field — the HUD is retained sprites"],
  [/\bGameObjects\.Text\b/, "a Text field — use BitmapText"],
  [/\.fill(Circle|RoundedRect|Points|Triangle)\(/, "an immediate-mode fill"],
  [/\.stroke(Circle|Points|Path|Rect)\(/, "an immediate-mode stroke"],
];

describe("the HUD is retained", () => {
  for (const relative of HUD_FILES) {
    it(`${relative} draws no Graphics and no Text`, () => {
      const source = fs.readFileSync(path.join(clientSrc, relative), "utf8");
      const hits = FORBIDDEN.filter(([pattern]) => pattern.test(source)).map(([, why]) => why);
      assert.deepEqual(hits, []);
    });
  }

  it("names every HUD source that exists, so the guard cannot be sidestepped by a new file", () => {
    const onDisk = fs
      .readdirSync(path.join(clientSrc, "scenes", "hud"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => `scenes/hud/${f}`)
      // hud-style.ts and slot-model.ts are pure numbers, with their own vitest tests.
      .filter((f) => !f.endsWith("hud-style.ts") && !f.endsWith("slot-model.ts"));
    assert.deepEqual(onDisk.sort(), HUD_FILES.filter((f) => f.startsWith("scenes/hud/")).sort());
  });
});
```

- [ ] **Step 2: Run it**

Run: `node --test scripts/hud-retained.test.mjs`
Expected: PASS after Task 4. If it fails, the named file still holds a `Graphics` or a `Text` and Task 4 is not finished.

- [ ] **Step 3: Add the census to the bench probe**

In `dev/BenchScene.ts`:

```ts
/** What the renderer is actually holding, counted off the live display lists. */
export interface SceneCensus {
  /** Every `Text` in every active scene. The acceptance number: 0. */
  text: number;
  /** `Graphics` in the HUD scene. The other acceptance number: 0. */
  hudGraphics: number;
  /** `Graphics` in the world scene — the floor and the debug outlines; V2 and V3 own these. */
  worldGraphics: number;
  bitmapText: number;
  images: number;
  total: number;
}

/**
 * Counts display objects by type across every running scene.
 *
 * This is how "the HUD draws zero `Graphics` per frame" and "`Text` count in the arena is 0" are
 * checked: not by looking at the screen, and not by a frame-time threshold that a shared CI machine
 * would fail for unrelated reasons, but by counting what the scenes hold. The bench draws with the
 * SAME renderer classes a match does, so a census here is a census of the match.
 */
export function sceneCensus(game: Phaser.Game): SceneCensus {
  const out: SceneCensus = { text: 0, hudGraphics: 0, worldGraphics: 0, bitmapText: 0, images: 0, total: 0 };
  for (const scene of game.scene.getScenes(true)) {
    const hud = scene.scene.key === HUD_SCENE_KEY;
    for (const obj of scene.children.list) {
      out.total += 1;
      if (obj.type === "Text") out.text += 1;
      else if (obj.type === "Graphics") hud ? (out.hudGraphics += 1) : (out.worldGraphics += 1);
      else if (obj.type === "BitmapText") out.bitmapText += 1;
      else if (obj.type === "Image" || obj.type === "NineSlice") out.images += 1;
    }
  }
  return out;
}
```

Add `census: () => sceneCensus(this.game),` to the `window.__bench` object and `census(): SceneCensus;` to `BenchProbe`.

- [ ] **Step 4: Enforce it in `scripts/bench-arena.mjs`**

After the per-browser report is printed, add:

```js
/** One line per browser: what the renderer held while it was measured. */
export function formatCensusRow(browser, census) {
  return (
    `${browser.padEnd(9)} text ${String(census.text).padStart(3)}  hudGraphics ${String(census.hudGraphics).padStart(3)}` +
    `  worldGraphics ${String(census.worldGraphics).padStart(3)}  bitmapText ${String(census.bitmapText).padStart(4)}` +
    `  images ${String(census.images).padStart(4)}`
  );
}
```

and in the runner, read `await page.evaluate(() => window.__bench.census())` beside the report, print `formatCensusRow`, and collect failures:

```js
  // Structural, not statistical: these two are the V1 gate and they are exact on every machine.
  // Frame time is compared against docs/render-bench.md by a person, on the same hardware.
  if (census.text !== 0) failures.push(`${browser}: ${census.text} Text objects in the arena (must be 0)`);
  if (census.hudGraphics !== 0) failures.push(`${browser}: ${census.hudGraphics} Graphics in the HUD scene (must be 0)`);
```

with, at the end of `main`:

```js
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  }
```

- [ ] **Step 5: Record the numbers**

Run:

```bash
npm run bench:visual
npm run bench:arena
node -p "os.cpus()[0].model + ', ' + os.cpus().length + ' cores'"
git rev-parse --short HEAD
```

Expected: `bench:arena` prints its per-browser rows, then two census rows with `text 0` and `hudGraphics 0`, and exits 0.

- [ ] **Step 6: Write the V1 section of `docs/render-bench.md`**

Append after the `## Baseline` section, replacing each `(paste …)` with the real output — `grep -c "(paste" docs/render-bench.md` must print `0` before the commit:

````markdown
## V1 — HUD

The HUD moved to its own scene (`scenes/HudScene.ts`), its rings, glyphs, pills and cooldown sweep
became baked frames out of `baked-atlas`, and every string became a `BitmapText`. Deleted: `hudGfx`,
`hudSweepGfx`, `rosterGfx`, `movementHintGfx`, the eight `Text`/`Image` pools, `ArenaLayers` and its
ignore lists, and `ArenaScene.syncBanners` — which built a **second** `RenderFrame` every frame and
charged it to the `sim` bucket, so `sim` below is not comparable to V0's for that reason as well as
the intended ones.

| Metric (`npm run bench:arena`) | V0 baseline | V1 |
|---|---|---|
| frame p50 / p95, Chromium | (paste) | (paste) |
| js p50 / p95, Chromium | (paste) | (paste) |
| draws p50 / max, Chromium | (paste) | (paste) |
| frame p50 / p95, Firefox | (paste) | (paste) |
| js p50 / p95, Firefox | (paste) | (paste) |
| textures | (paste) | (paste) |

Full output, and `npm run bench:visual` — unchanged by this phase, which times the shot-layer
builders V2 and V3 own, and re-run only to confirm that:

```text
(paste both outputs)
```

### The census

`npm run bench:arena` now counts the display lists and **exits 1** if either acceptance number is
missed. These are exact on every machine, unlike a frame time:

```text
(paste the two census rows)
```

`scripts/hud-retained.test.mjs` is the same guarantee at the source level and runs in `npm test`: no
file under `scenes/hud/` may name a `Graphics`, a `Text` or an immediate-mode fill.

Machine: (paste). Commit: (paste).
````
- [ ] **Step 7: Update the prose that names the old code**

| File | Edit |
|---|---|
| `packages/client/CLAUDE.md` | In the statuses paragraph, `drawn by `ArenaScene.drawStatusStrip` on the slot bar's own `Graphics`` → ``drawn by `scenes/hud/status-strip.ts` as retained sprites in `HudScene``. In the weapon-slot paragraph, ``drawn by `ArenaScene.drawHudSlot``` → ``drawn by `scenes/hud/slot-bar.ts```. Append the new paragraph below. |
| `docs/project-structure.md` | Add `render/{fonts,atlas,bake,hud-feed}.ts`, `scenes/HudScene.ts`, the `scenes/hud/` directory, `public/art/fonts/`, `scripts/build-bitmap-font.mjs` and `scripts/hud-retained.test.mjs`; delete the `scenes/arena/arena-layers.ts` and `scenes/arena/hud-renderer.ts` lines. |
| `CLAUDE.md` (root) | In the Commands block, after `npm run build:manual`, add the `build:font` line below. |

For `packages/client/CLAUDE.md`:

```markdown
**The HUD is a second scene, and it draws no `Graphics` and no `Text`.** `HudScene` (`scenes/HudScene.ts`)
runs in parallel with `ArenaScene`, has its own full-canvas camera, and reads the same `RenderFrame`
off the registry that the arena publishes — which is why the arena has one camera and no `ignore`
lists. Every element under `scenes/hud/` is built once and updated by property: the slot ring, its
wash, the 90-frame cooldown sweep, the two procedural glyphs and the key pills are baked frames in
`baked-atlas` (`render/bake.ts`, run once in `BootScene`), every rectangle is a tinted copy of one
white square, and every string is a `BitmapText` in the generated `hud-font` (`render/fonts.ts`).
`scripts/hud-retained.test.mjs` fails the suite if a HUD source names a `Graphics`, a `Text` or an
immediate-mode fill, and `npm run bench:arena` counts the live display lists and exits non-zero if
either reaches the screen. The pure derivations are unchanged and still live beside the scene
(`scenes/weapon-hud.ts`, `scenes/status-hud.ts`, `scenes/roster-panel.ts`, `scenes/hud/slot-model.ts`).
```

For root `CLAUDE.md`:

```text
npm run build:font     # regenerates public/art/fonts/hud-font{,-bold}.{png,xml} (committed artefacts)
```

- [ ] **Step 8: Full verification and commit**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
npm run typecheck
npm run build
npm run smoke:arena
npm run build:release
```

Expected: every suite green, including `scripts/hud-retained.test.mjs`, `scripts/build-bitmap-font.test.mjs` and `scripts/check-art.test.mjs`; typecheck clean; the build and the release both succeed; `grep -l "MOTOR DEV TOOL" dist-release/motor-combat-moba/packages/client/dist/assets/*.js` prints nothing; the font pages are inside the release (`unzip -l motor-combat-moba-release.zip | grep fonts/` lists four files).

```bash
git add scripts/hud-retained.test.mjs scripts/bench-arena.mjs packages/client/src/dev/BenchScene.ts \
  docs/render-bench.md CLAUDE.md packages/client/CLAUDE.md docs/project-structure.md
git commit -m "test(client): guard the retained HUD and record the V1 render numbers

Moves no playtest probe number: instrumentation, guards and docs only."
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

---

## Self-review

**Spec coverage.** §1's three HUD costs: the `Text` textures (Task 1 and Tasks 3–4 replace all 54), the `fillCircle` 101-point path and the `fillRoundedRect` (Task 2 bakes the ring, wash, glyphs and both pills; Task 4 draws them as quads), and the per-frame allocation (Task 4's guarded setters, the cached `resolveWeaponIcon`, the pre-built `SWEEP_FRAME_NAMES`, the shared `EMPTY_BOXES`, the in-place `HudView`). §1's specific claim that "the countdown's movement hint is 14 rounded rects, ~5,700 points per frame, drawing a picture that never changes" is Task 3 Step 5's `NineSlice` pills. §2: `BitmapText` (Task 1), `DynamicTexture` (Task 2), the quad batch (every element is an `Image`, `NineSlice` or `BitmapText` off two textures). R1 is Task 2; R3 and R6 are Task 4's guards and Task 3's single published frame; R11's `baked-atlas` naming and R13's "`bake.ts` runs once in `BootScene` through `DynamicTexture`, jobs are pure functions beside the style tables, asserted by a unit test against a stub recorder" are Task 2 verbatim. R20 is Task 3, including the deletion of the ignore lists and the answer to what happens to spectate. §4's H0/H1/H2 rows are `HUD_BOX_DEPTH` / `HUD_SWEEP_DEPTH` / `HUD_TEXT_DEPTH`, unchanged. §5's HUD catalogue row ("baked ring frames; the sweep as a baked sweep sheet, frame chosen from the cooldown fraction; numbers and names as `BitmapText`") is Tasks 2 and 4. §12's second resolved question fixes the sweep at a sheet and leaves the step count to measurement; Task 2 measures it and takes 90 at 4°. R23's "Both are `BitmapText`" is Task 3 Step 9. §10's V1 row deletes `hudGfx`, `hudSweepGfx`, `rosterGfx`, the `Text` pools and `splitCameras` with its ignore lists — Tasks 3 and 4 delete all five plus `movementHintGfx` and `ArenaLayers`, the object the preparation plan left `splitCameras` as. Two spec items are deliberately **not** here: the atlas for authored art (`ART_ATLAS`, `pack-atlas.mjs`) is V2's row, so weapon icons stay loose textures and cost their own draw calls until then; the tier argument `bakeAtlas` takes is honoured but never varied, because V5 owns the `TierManager` that would choose one.

**Placeholder scan.** The `(paste …)` markers in Task 5 Step 6 are the only deferred content, they are measurements that cannot exist before the code does, and the step names the command that produces each and the `grep -c` that proves none survived — the same device V0's Task 8 used. No "TBD", no "handle edge cases", no "similar to Task N": every moved body has a substitution table and every new module is printed in full.

**Type consistency.** `HudFontMetrics` is produced by `hudFontMetrics` (Task 1) and consumed by `textHeightFor`, `pillHeightFor`, `countdownKeyOffset` (Task 2) and all three view constructors plus `MatchBanners` (Tasks 3–4). `BakeGraphics` is the interface the recorder in `bake.test.ts` implements and the one `Phaser.GameObjects.Graphics` structurally satisfies at the single call site in `bakeAtlas`. `bakedFrame(name)` returns the `[texture, frame]` pair every `add.image` and `add.nineslice` spreads. `SWEEP_FRAME_NAMES[sweepFrameIndex(f)]` is the only way a sweep frame is named, and `bakeJobs` builds the same names from the same `padStart(2, "0")` — `bake.test.ts` asserts both ends. `HudView` is created by `newHudView` (Task 3), mutated by `ArenaScene.update` and `BenchScene.update`, and read by `HudScene.update`; `HudMarks` is the two-method subset of `PerfOverlay` that `readHudPerf` returns, and `PerfMark` from V0 already includes `"draw"`. `RosterView.update` returns the panel height that `SlotBarView.update` takes as `topInset` and `SlotBarView.update` returns the bar top that `StatusStripView.update` takes as `slotBarTop` — the same three-way chain `HudRenderer.render` and `slotBarLayout`'s D12 comment describe. `SceneCensus` is produced by `sceneCensus`, exposed by `BenchProbe.census()` and read by `formatCensusRow` and the two failure checks in `scripts/bench-arena.mjs`.

## Acceptance

The spec's migration row (§10):

> | V1 HUD | `HudScene`, `BitmapText`, baked rings, baked sweep sheet, retained updates | `hudGfx`, `hudSweepGfx`, `rosterGfx`, the `Text` pools, `splitCameras` and its ignore lists |

and the execution guide's gate row:

> | V1 | HUD draws zero `Graphics` per frame; `Text` count in the arena is 0; bench p95 no worse than V0 |

| Number | How it is demonstrated |
|---|---|
| HUD draws zero `Graphics` per frame | `npm run bench:arena` → the census row's `hudGraphics 0`, checked in the runner and exiting 1 otherwise; and `npm test` → `scripts/hud-retained.test.mjs`, which fails if a HUD source so much as names one. Live: `game.scene.getScene("hud").children.list.filter(o => o.type === "Graphics").length` is `0`. |
| `Text` count in the arena is 0 | the same census row's `text 0`, counted across **every** active scene, so `ArenaScene`, `HudScene` and `BenchScene`'s dev marker are all in scope. The join, lobby, car-select, reveal, results, practice-setup and practice-summary screens and the `?dev=assets` and `?dev=playground` tools keep their `Text` objects and are out of scope: none of them is on screen during a match, and the census only counts running scenes. |
| bench p95 no worse than V0 | `npm run bench:arena` on the same machine, read against the V0 rows now printed beside the V1 rows in `docs/render-bench.md`. Deliberately not asserted by the runner: a frame-time threshold on shared hardware fails for reasons that are not the renderer's, and the two numbers that *are* exact are asserted instead. |
| Deletions actually happened | `git log --stat` shows `arena-layers.ts` and `hud-renderer.ts` removed; `grep -rn "hudGfx\|hudSweepGfx\|rosterGfx\|movementHintGfx\|splitCameras\|ArenaLayers" packages/client/src` prints nothing. |
| Nothing else changed | root `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke:arena`, `npm run build:release` all pass; `npm run check:art` reports what it reported before. |

Spec R25's acceptance table is still read off the instruments by a person on the reference machine; V1 moves the HUD's share of it and is judged as a delta from `docs/render-bench.md`'s V0 rows, exactly as V0's own Acceptance section said it would be.

## Handoff

Exports beyond the ledger, for V2–V5 and the netcode stream:

| Export | Where | For |
|---|---|---|
| `HUD_FONT_BOLD`, `HUD_FONT_PAGES`, `hudSafeText`, `hudFontMetrics`, `textHeightFor`, `HudFontMetrics`, `BitmapFontCache`, `HUD_FALLBACK_GLYPH` | `render/fonts.ts` | V4's floating combat numbers and V5's tier readout take the same font and the same sanitiser; anything drawing a player-supplied string must go through `hudSafeText` |
| `HUD_CHARSET_CODES`, `CELL_PAD_PX`, `SHEET_PX`, `FACES`, `FONT_STACK`, `sheetGrid`, `charRecords`, `fontXml`, `main` | `scripts/build-bitmap-font.mjs` | adding a glyph is a code point in `HUD_CHARSET_CODES` plus `SHEET_CODES` and a re-run of `npm run build:font` |
| `BakeTier`, `BAKE_SUPERSAMPLE`, `BAKE_SHEET_PX`, `BAKE_DEFAULT_TIER`, `BAKE_PILL_WIDTH_RATIO`, `BAKE_PX_SIZE`, `BakeGraphics`, `BakeJob`, `PillHeights`, `bakeJobs`, `packShelf`, `Placement`, `bakedAtlasReady`, `bakedFrame` | `render/bake.ts` | V2 appends the world jobs (glow discs, projectile bodies, orb bands, brackets, silhouettes) to `bakeJobs` and reuses `packShelf` unchanged; V3 appends the flame flipbook; V5 passes a measured `BakeTier` instead of the default. `BakeTier`'s three members are `render/tiers.ts`'s `Tier` by value, so V5 can alias one to the other without reshaping either. |
| `HUD_COUNTDOWN_KEY_CLEAR_PX` and every `HUD_*` / `ROSTER_*` constant, `FLAME_UNIT_POINTS` | `scenes/hud/hud-style.ts` | one Phaser-free home for HUD paint; V4's status flipbooks on the car read `statusFillOf`, not these |
| `SWEEP_FRAMES`, `SWEEP_STEP_RADIANS`, `SWEEP_FRAME_NAMES`, `sweepFrameIndex`, `washAlpha`, `ringAlpha`, `sweepAlpha`, `pillHeightFor`, `countdownKeyOffset` | `scenes/hud/slot-model.ts` | any second flipbook (V3's flame, V4's muzzle flash) copies the `SWEEP_FRAME_NAMES` pattern: names built once at module load, never per frame |
| `HUD_FRAME_KEY`, `HUD_VIEW_KEY`, `HUD_PERF_KEY`, `HudView`, `HudMarks`, `FeedStore`, `newHudView`, `publishHudFrame`, `readHudFrame`, `readHudView`, `readHudPerf` | `render/hud-feed.ts` | V4 adds nothing here — events ride the frame; N4's ghost shots reach the HUD the same way. Any future scene that needs the frame reads it from these keys rather than from `ArenaScene` |
| `HUD_SCENE_KEY`, `HudScene` | `scenes/HudScene.ts` | V5 attaches the tier readout and the governor's state to this scene, not the arena's |
| `SlotBarView`, `StatusStripView`, `RosterView` (with `invalidateIcons`) | `scenes/hud/` | V2 swaps each slot icon's loose texture for an `art-atlas` frame inside `SlotView.applyWeapon` and nowhere else |
| `MatchBanners` at its new path `scenes/hud/match-banners.ts`, constructor `(scene, metrics)` | `scenes/hud/match-banners.ts` | V4's kill feed and V5's tier notice belong beside the banners |
| `sceneCensus`, `SceneCensus`, `BenchProbe.census()` | `dev/BenchScene.ts` | V2 and V3 tighten `worldGraphics` to 0 the same way this phase tightened `hudGraphics`; the runner's failure list is where those checks go |
| `formatCensusRow` | `scripts/bench-arena.mjs` | CI wiring, alongside V0's `formatBenchRows` |
| `NON_SPRITE_DIRS` | `scripts/check-art.mjs` | V2's `art-atlas.png` is manifest-adjacent and will need its own decision here — it is *packed from* manifest rows rather than being one |
| `drawArenaFloor(scene, arena)` — the `layers` parameter is gone | `scenes/arena/arena-floor.ts` | **Corrected after V2 was written:** V2 does *not* bake the floor. It is drawn once and never cleared, so it is not on the frame path, and baking it would cost roughly 14 MB of VRAM to save re-walking forty points a single time. It stays a `Graphics` (named `arena.floor`, one of the two the V2 gate allows) and is left to V5's floor-ambience row |
| `CarRenderer(scene, debug)`, `ShotRenderer(scene, debug)` — the `layers` parameter is gone | `scenes/arena/` | V2 and V3 construct them unchanged |
| `npm run build:font` | root `package.json` | regenerating the committed font pages |
