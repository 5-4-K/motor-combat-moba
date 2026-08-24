# Client Asset Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let car (and later power) art be added, replaced, or modified by dropping a PNG into a folder and adding one JSON line, without touching scene code, and without ever breaking the game when art is missing.

**Architecture:** A JSON manifest under `packages/client/public/art/` maps namespaced string keys (`car.rectangle`) to sprite entries. A TypeScript schema plus a non-throwing validator parses it at boot; bad or missing entries fall through to the existing procedural `Graphics` renderer, which stays permanently as the bottom of the resolution chain. Sprites are cosmetic skins fitted to the unchanged OBB hull — `CAR_TABLE`, `DRIVE_CONFIG`, and collision are untouched. A dev-only `?dev=assets` scene renders every manifest entry on its hull so per-sprite `rotationOffset` / `scale` / `origin` can be tuned without rejoining a match.

**Tech Stack:** TypeScript, Phaser 3, Vite, Vitest (node environment — never import Phaser in a test), npm workspaces.

**Design doc:** [`docs/superpowers/specs/2026-08-25-asset-pipeline-design.md`](../specs/2026-08-25-asset-pipeline-design.md)

---

## Before you start

**Do not start executing without an explicit go-ahead** — the master index sets that rule for every
plan in this directory, and this one is no exception. Confirm the tree is clean enough to branch from
first.

**Naming — already settled, no action needed.** This plan was drafted while the workspace was still
called `motor-arena`. The rename completed on **2026-08-25, before implementation began**, so the
shared package is `@motor-combat-moba/shared` and every code block below already says so. Nothing to
substitute.

If you are reading this much later and want to be sure, one command settles it:

```bash
node -p "require('./packages/shared/package.json').name"
```

Should that ever print something else, the specifier appears in exactly **two** files this plan
creates — Task 2's `asset-keys.ts` and Task 9's `AssetTuningScene.ts` — and nowhere else. Everything
else is name-proof by construction:

- **Every npm command targets a workspace *path*, not a name** — `npm test -w packages/client`. npm
  accepts a directory for `-w`, and a directory is not renamed by renaming a package.
- **No new directory, file, asset folder, manifest key, or config value embeds the project name.**
  `public/art/`, `MANIFEST_URL`, and the `car.*` key namespace are all name-free by design.

**Locate by symbol, never by line number.** Every `file.ts:123` reference in this plan was read on
2026-08-24 and the branch has moved since. Find `drawCar`, `syncCar`, `private debug`, and
`requireBuiltDist` by name; treat the line numbers as hints about roughly where to look.

**The colour marker shows player colour, not team colour — deliberately.** `PlayerState.team` exists
and `LobbyScene` draws team columns, but `ArenaScene` has never rendered team identity at all. Task 8
matches today's behaviour exactly: the marker uses `carFillOf(colorId)`, the same colour the car is
already filled with. Making it team-aware would be a readability change to the game, not an asset
change, and it does not belong in this plan. If team-in-arena is wanted, it is its own small piece of
work — and the marker is where it would go.

**Why `public/art/` and not `public/assets/`.** Vite's `build.assetsDir` defaults to `assets`, so bundled JS is emitted into `packages/client/dist/assets/`. Vite also copies `public/` contents to the `dist` root. Naming the art folder `assets` would merge source art into the same directory as hashed bundle output. `art/` keeps them separate and keeps the Task 10 grep unambiguous.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `packages/client/src/assets/manifest-schema.ts` | Types, defaults, and the non-throwing `parseManifest` validator. No I/O. |
| `packages/client/src/assets/manifest-schema.test.ts` | Validator tests. |
| `packages/client/src/assets/asset-keys.ts` | Sim id → manifest key convention. Nothing else. |
| `packages/client/src/assets/asset-keys.test.ts` | Key convention tests. |
| `packages/client/src/assets/sprite-fit.ts` | Pure math: entry + texture size + hull size → scale/rotation/origin. |
| `packages/client/src/assets/sprite-fit.test.ts` | Fit math tests. |
| `packages/client/src/assets/load-manifest.ts` | Fetches and parses the manifest. Injectable `fetch` so it is testable in node. |
| `packages/client/src/assets/load-manifest.test.ts` | Loader tests, including failure paths. |
| `packages/client/public/art/manifest.json` | The manifest data. The file you edit to add art. |
| `packages/client/src/dev/registry.ts` | `?dev=<id>` → dynamically imported tool scene. The single seam every dev tool goes through. |
| `packages/client/src/dev/registry.test.ts` | Registry lookup tests. |
| `packages/client/src/dev/AssetTuningScene.ts` | Dev-only `?dev=assets` scene. Never imported statically. |

**Modified**

| Path | Change |
|---|---|
| `packages/client/tsconfig.json` | Add `"types": ["vite/client"]` for `import.meta.env`. |
| `packages/client/src/config/client-mode.ts` | Add `devToolId`, alongside the existing `isDebugEnabled`. |
| `packages/client/src/config/client-mode.test.ts` | Tests for the above. |
| `packages/client/src/scenes/BootScene.ts` | Load manifest + textures without blocking first paint; route `?dev=assets`. |
| `packages/client/src/scenes/ArenaScene.ts` | `drawCar` gains a sprite path with procedural fallback, plus the colour marker. |
| `scripts/build-release.mjs` | Export + call `assertNoDevOnlyCode`, failing the release build if dev-only code shipped. |
| `scripts/build-release.test.mjs` | Tests for `assertNoDevOnlyCode`. |

**Deliberately untouched:** `packages/shared/**` and `packages/server/**`. Nothing in `stepSim` reads a sprite, the server must never parse an image path, and shared is consumed as built `dist` (a PNG swap must not require rebuilding shared).

---

## Task 1: Manifest schema and validator

**Files:**
- Create: `packages/client/src/assets/manifest-schema.ts`
- Test: `packages/client/src/assets/manifest-schema.test.ts`

The validator must **never throw and never reject the whole manifest over one bad row**. A malformed entry is dropped and reported; every other entry still loads. That is what makes incremental art addition safe.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/src/assets/manifest-schema.test.ts
import { describe, expect, it } from "vitest";
import { EMPTY_MANIFEST, parseManifest } from "./manifest-schema.js";

describe("parseManifest", () => {
  it("applies defaults to a bare entry", () => {
    const { manifest, problems } = parseManifest({
      sprites: { "car.rectangle": { file: "cars/rectangle.png" } },
    });
    expect(problems).toEqual([]);
    expect(manifest.sprites["car.rectangle"]).toEqual({
      file: "cars/rectangle.png",
      rotationOffset: 0,
      scale: "fit",
      colorMode: "tint",
      origin: [0.5, 0.5],
    });
  });

  it("keeps explicit values over defaults", () => {
    const { manifest } = parseManifest({
      sprites: {
        "projectile.bullet": {
          file: "fx/shot.png",
          rotationOffset: 1.5,
          scale: 2,
          colorMode: "none",
          origin: [0.25, 0.75],
        },
      },
    });
    expect(manifest.sprites["projectile.bullet"]).toEqual({
      file: "fx/shot.png",
      rotationOffset: 1.5,
      scale: 2,
      colorMode: "none",
      origin: [0.25, 0.75],
    });
  });

  it("drops only the bad entry and keeps the good ones", () => {
    const { manifest, problems } = parseManifest({
      sprites: {
        "car.oval": { file: "cars/oval.png" },
        "car.hexagon": { file: "cars/hexagon.png", colorMode: "rainbow" },
      },
    });
    expect(Object.keys(manifest.sprites)).toEqual(["car.oval"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("car.hexagon");
  });

  it("rejects an entry with no file", () => {
    const { manifest, problems } = parseManifest({ sprites: { "car.oval": { scale: 2 } } });
    expect(manifest.sprites).toEqual({});
    expect(problems[0]).toContain("file");
  });

  it("rejects a non-positive or non-finite scale", () => {
    const { problems } = parseManifest({
      sprites: {
        a: { file: "a.png", scale: 0 },
        b: { file: "b.png", scale: Number.NaN },
        c: { file: "c.png", scale: "big" },
      },
    });
    expect(problems).toHaveLength(3);
  });

  it("refuses prototype-polluting keys", () => {
    const { manifest, problems } = parseManifest({
      sprites: { __proto__: { file: "evil.png" }, "car.oval": { file: "cars/oval.png" } },
    });
    expect(Object.keys(manifest.sprites)).toEqual(["car.oval"]);
    expect(problems).toHaveLength(1);
  });

  it("returns the empty manifest for junk input rather than throwing", () => {
    expect(parseManifest(null).manifest).toEqual(EMPTY_MANIFEST);
    expect(parseManifest("nope").manifest).toEqual(EMPTY_MANIFEST);
    expect(parseManifest({ sprites: 7 }).manifest).toEqual(EMPTY_MANIFEST);
  });

  it("treats a manifest with no sprites key as empty and unproblematic", () => {
    const { manifest, problems } = parseManifest({});
    expect(manifest).toEqual(EMPTY_MANIFEST);
    expect(problems).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client`
Expected: FAIL — `Cannot find module './manifest-schema.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/client/src/assets/manifest-schema.ts

/**
 * How player colour reaches a sprite. `"tint"` multiplies the texture by the player's colour and so
 * needs desaturated art; `"none"` leaves pre-coloured pack art alone and lets the procedural colour
 * marker carry identity by itself. Deliberately a two-member enum: `"overlay"` (a separate tintable
 * mask layer) can be added later without changing a single consumer.
 */
export type ColorMode = "tint" | "none";

const COLOR_MODES: readonly string[] = ["tint", "none"];

/**
 * Keys that would write through a plain object's prototype. The manifest is parsed from JSON on
 * disk, so a key like `__proto__` is reachable; the same caution `isCarId` takes in shared.
 */
const UNSAFE_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];

/** One drawable after defaults are applied. The on-disk JSON form is looser — only `file` is required. */
export interface SpriteEntry {
  readonly file: string;
  /** Radians added to the body's `angle`, reconciling art drawn facing up with the sim's +x forward. */
  readonly rotationOffset: number;
  /** `"fit"` contains the art inside the hull; a positive number is an explicit multiplier. */
  readonly scale: "fit" | number;
  readonly colorMode: ColorMode;
  /** Normalised origin. `[0.5, 0.5]` for art whose visual centre is its geometric centre. */
  readonly origin: readonly [number, number];
}

export interface AssetManifest {
  readonly sprites: Readonly<Record<string, SpriteEntry>>;
}

export const SPRITE_DEFAULTS = {
  rotationOffset: 0,
  scale: "fit",
  colorMode: "tint",
  origin: [0.5, 0.5],
} as const satisfies Omit<SpriteEntry, "file">;

export const EMPTY_MANIFEST: AssetManifest = { sprites: {} };

export interface ParseResult {
  readonly manifest: AssetManifest;
  readonly problems: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrigin(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function parseEntry(key: string, value: unknown, problems: string[]): SpriteEntry | undefined {
  if (!isRecord(value)) {
    problems.push(`${key}: entry is not an object`);
    return undefined;
  }
  if (typeof value.file !== "string" || value.file.length === 0) {
    problems.push(`${key}: missing or empty "file"`);
    return undefined;
  }

  const colorMode = value.colorMode ?? SPRITE_DEFAULTS.colorMode;
  if (typeof colorMode !== "string" || !COLOR_MODES.includes(colorMode)) {
    problems.push(`${key}: unknown colorMode ${JSON.stringify(colorMode)}`);
    return undefined;
  }

  const scale = value.scale ?? SPRITE_DEFAULTS.scale;
  const scaleOk = scale === "fit" || (typeof scale === "number" && Number.isFinite(scale) && scale > 0);
  if (!scaleOk) {
    problems.push(`${key}: scale must be "fit" or a positive finite number`);
    return undefined;
  }

  const rotationOffset = value.rotationOffset ?? SPRITE_DEFAULTS.rotationOffset;
  if (typeof rotationOffset !== "number" || !Number.isFinite(rotationOffset)) {
    problems.push(`${key}: rotationOffset must be a finite number`);
    return undefined;
  }

  const origin = value.origin ?? SPRITE_DEFAULTS.origin;
  if (!isOrigin(origin)) {
    problems.push(`${key}: origin must be a pair of finite numbers`);
    return undefined;
  }

  return {
    file: value.file,
    rotationOffset,
    scale: scale as "fit" | number,
    colorMode: colorMode as ColorMode,
    origin: [origin[0], origin[1]],
  };
}

/**
 * Parse a manifest, never throwing. A malformed entry is dropped and reported in `problems` while
 * every other entry still loads — art can then be added one file at a time, and a typo costs one
 * car its sprite rather than costing the game its render.
 */
export function parseManifest(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { manifest: EMPTY_MANIFEST, problems: ["manifest is not an object"] };

  const rawSprites = raw.sprites;
  if (rawSprites === undefined) return { manifest: EMPTY_MANIFEST, problems: [] };
  if (!isRecord(rawSprites)) {
    return { manifest: EMPTY_MANIFEST, problems: ['"sprites" is not an object'] };
  }

  const problems: string[] = [];
  const sprites: Record<string, SpriteEntry> = {};
  for (const key of Object.keys(rawSprites)) {
    if (UNSAFE_KEYS.includes(key)) {
      problems.push(`${key}: refused as an unsafe manifest key`);
      continue;
    }
    const entry = parseEntry(key, rawSprites[key], problems);
    if (entry) sprites[key] = entry;
  }
  return { manifest: { sprites }, problems };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client`
Expected: PASS, all 8 `parseManifest` tests green.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck -w packages/client
```

```bash
git add packages/client/src/assets/manifest-schema.ts packages/client/src/assets/manifest-schema.test.ts && git commit -m "feat: asset manifest schema and non-throwing validator" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Manifest key convention

**Files:**
- Create: `packages/client/src/assets/asset-keys.ts`
- Test: `packages/client/src/assets/asset-keys.test.ts`

The key convention is the seam: shared owns the ids, the client owns what they look like. Unrecognised ids must resolve through **the same fallback the sim uses** (`DEFAULT_CAR_ID`), exactly as `carShapeOf` already does — otherwise the picture disagrees with the hitbox.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/src/assets/asset-keys.test.ts
import { describe, expect, it } from "vitest";
import { carSpriteKey } from "./asset-keys.js";

describe("carSpriteKey", () => {
  it("namespaces a known car id", () => {
    expect(carSpriteKey("hexagon")).toBe("car.hexagon");
    expect(carSpriteKey("oval")).toBe("car.oval");
  });

  it("falls back to the default chassis for anything unrecognised", () => {
    expect(carSpriteKey("bogus")).toBe("car.rectangle");
    expect(carSpriteKey("")).toBe("car.rectangle");
  });

  it("does not treat inherited object properties as car ids", () => {
    expect(carSpriteKey("constructor")).toBe("car.rectangle");
    expect(carSpriteKey("toString")).toBe("car.rectangle");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client`
Expected: FAIL — `Cannot find module './asset-keys.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/client/src/assets/asset-keys.ts
import { DEFAULT_CAR_ID, isCarId } from "@motor-combat-moba/shared";

/**
 * The manifest key for a wire `carId`. Namespaced so that powers, projectiles, and effects can land
 * as new rows in the same flat map rather than as a new section of the schema.
 *
 * Unrecognised ids resolve to `DEFAULT_CAR_ID` — the same fallback `carShapeOf` and the sim take —
 * so a stale or hostile id draws the default chassis instead of silently drawing nothing.
 */
export function carSpriteKey(carId: string): string {
  return `car.${isCarId(carId) ? carId : DEFAULT_CAR_ID}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/assets/asset-keys.ts packages/client/src/assets/asset-keys.test.ts && git commit -m "feat: car sprite key convention" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Sprite fit math

**Files:**
- Create: `packages/client/src/assets/sprite-fit.ts`
- Test: `packages/client/src/assets/sprite-fit.test.ts`

`"fit"` uses **contain** semantics — the art is scaled so it fits entirely inside the hull. Contain rather than cover, because art that overflows its collision box makes the picture lie about the hitbox. A pack sprite with heavy transparent padding will look small; `scale` as an explicit number is the escape hatch for that.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/src/assets/sprite-fit.test.ts
import { describe, expect, it } from "vitest";
import type { SpriteEntry } from "./manifest-schema.js";
import { fitSprite } from "./sprite-fit.js";

const HULL = { width: 48, height: 32 };

function entry(over: Partial<SpriteEntry> = {}): SpriteEntry {
  return {
    file: "cars/x.png",
    rotationOffset: 0,
    scale: "fit",
    colorMode: "tint",
    origin: [0.5, 0.5],
    ...over,
  };
}

describe("fitSprite", () => {
  it("contains square art inside the hull using the tighter axis", () => {
    const fit = fitSprite(entry(), { width: 128, height: 128 }, HULL);
    expect(fit.scale).toBeCloseTo(32 / 128);
  });

  it("contains wide art using the width axis when that is tighter", () => {
    const fit = fitSprite(entry(), { width: 256, height: 32 }, HULL);
    expect(fit.scale).toBeCloseTo(48 / 256);
  });

  it("passes an explicit numeric scale straight through", () => {
    expect(fitSprite(entry({ scale: 2 }), { width: 128, height: 128 }, HULL).scale).toBe(2);
  });

  it("falls back to scale 1 for a zero-sized texture rather than producing NaN", () => {
    expect(fitSprite(entry(), { width: 0, height: 0 }, HULL).scale).toBe(1);
    expect(fitSprite(entry(), { width: 64, height: 0 }, HULL).scale).toBe(1);
  });

  it("reports rotationOffset and origin unchanged", () => {
    const fit = fitSprite(
      entry({ rotationOffset: Math.PI / 2, origin: [0.25, 0.75] }),
      { width: 64, height: 64 },
      HULL,
    );
    expect(fit.rotation).toBeCloseTo(Math.PI / 2);
    expect(fit.originX).toBe(0.25);
    expect(fit.originY).toBe(0.75);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client`
Expected: FAIL — `Cannot find module './sprite-fit.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/client/src/assets/sprite-fit.ts
import type { SpriteEntry } from "./manifest-schema.js";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface SpriteFit {
  readonly scale: number;
  /** Radians to add to the body's `angle`. */
  readonly rotation: number;
  readonly originX: number;
  readonly originY: number;
}

/**
 * Contain the art inside the hull. Cover would let the drawing spill past the OBB the sim actually
 * collides with, so the picture would claim a reach the car does not have.
 *
 * A zero-sized texture yields 1 rather than a division by zero: Phaser renders a NaN-scaled sprite
 * as nothing at all, which would look like a missing asset instead of a broken one.
 */
function resolveScale(entry: SpriteEntry, texture: Size, hull: Size): number {
  if (typeof entry.scale === "number") return entry.scale;
  if (texture.width <= 0 || texture.height <= 0) return 1;
  return Math.min(hull.width / texture.width, hull.height / texture.height);
}

/**
 * How to draw one manifest entry against a hull. Pure, so the fitting rules that make pack art from
 * unrelated sources line up are testable without a browser.
 */
export function fitSprite(entry: SpriteEntry, texture: Size, hull: Size): SpriteFit {
  return {
    scale: resolveScale(entry, texture, hull),
    rotation: entry.rotationOffset,
    originX: entry.origin[0],
    originY: entry.origin[1],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/assets/sprite-fit.ts packages/client/src/assets/sprite-fit.test.ts && git commit -m "feat: sprite fit math for hull-relative art" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Manifest loader

**Files:**
- Create: `packages/client/src/assets/load-manifest.ts`
- Test: `packages/client/src/assets/load-manifest.test.ts`

`fetch` is injected so the loader is testable in the node environment. Every failure path returns the empty manifest with a problem string — a missing or unreachable manifest must degrade to "all cars procedural", never to an exception during boot.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/src/assets/load-manifest.test.ts
import { describe, expect, it } from "vitest";
import { loadManifest } from "./load-manifest.js";

function respondWith(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("loadManifest", () => {
  it("parses a served manifest", async () => {
    const fetchImpl = respondWith({ sprites: { "car.oval": { file: "cars/oval.png" } } });
    const { manifest, problems } = await loadManifest("art/manifest.json", fetchImpl);
    expect(problems).toEqual([]);
    expect(manifest.sprites["car.oval"].file).toBe("cars/oval.png");
  });

  it("degrades to the empty manifest on a non-ok response", async () => {
    const { manifest, problems } = await loadManifest("art/manifest.json", respondWith({}, false, 404));
    expect(manifest.sprites).toEqual({});
    expect(problems[0]).toContain("404");
  });

  it("degrades to the empty manifest when fetch throws", async () => {
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const { manifest, problems } = await loadManifest("art/manifest.json", boom);
    expect(manifest.sprites).toEqual({});
    expect(problems[0]).toContain("offline");
  });

  it("degrades to the empty manifest on invalid JSON", async () => {
    const badJson = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    })) as unknown as typeof fetch;
    const { manifest, problems } = await loadManifest("art/manifest.json", badJson);
    expect(manifest.sprites).toEqual({});
    expect(problems).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client`
Expected: FAIL — `Cannot find module './load-manifest.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/client/src/assets/load-manifest.ts
import { EMPTY_MANIFEST, parseManifest, type ParseResult } from "./manifest-schema.js";

/**
 * Where the manifest is served from, relative to the page. `art/` and not `assets/`: Vite's
 * `build.assetsDir` defaults to `assets`, so bundled JS lands in `dist/assets/` and source art
 * placed there would merge into the same directory as hashed bundle output.
 *
 * Deliberately a single constant with no project name in it — the only thing a future theme feature
 * would need to change.
 */
export const MANIFEST_URL = "art/manifest.json";

/**
 * Fetch and parse the manifest, never throwing. Every failure — unreachable, 404, malformed JSON —
 * returns the empty manifest plus a problem string, so a broken manifest costs the game its art and
 * nothing else: all cars fall through to the procedural silhouettes they draw today.
 *
 * `fetchImpl` is injectable so this is testable in the node environment; the client's vitest config
 * has no DOM and no browser `fetch` guarantees.
 */
export async function loadManifest(
  url: string = MANIFEST_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ParseResult> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { manifest: EMPTY_MANIFEST, problems: [`manifest fetch failed: ${response.status}`] };
    }
    return parseManifest(await response.json());
  } catch (error) {
    return { manifest: EMPTY_MANIFEST, problems: [`manifest fetch threw: ${String(error)}`] };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/assets/load-manifest.ts packages/client/src/assets/load-manifest.test.ts && git commit -m "feat: manifest loader with degrade-to-empty failure paths" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: The manifest file and art folder

**Files:**
- Create: `packages/client/public/art/manifest.json`
- Create: `packages/client/public/art/README.md`

Ship the manifest **empty of sprites** at first. Everything falls back to procedural, the game is unchanged, and the pipeline is proven end-to-end before any art exists. This is the point of the fallback layer.

- [ ] **Step 1: Create the manifest**

```json
{
  "sprites": {}
}
```

- [ ] **Step 2: Create the folder README**

````markdown
# Art

Drop PNGs in here and name them in `manifest.json`. Nothing else is required — no code change,
no rebuild. A key with no entry, or an entry whose file is missing, falls back to the procedural
silhouette the game drew before any art existed.

## Adding a car sprite

1. Save the image as `cars/<carId>.png`, where `<carId>` is a key of `CAR_TABLE`
   (`rectangle`, `oval`, `hexagon`).
2. Add a row:

```json
{
  "sprites": {
    "car.hexagon": { "file": "cars/hexagon.png" }
  }
}
```

3. Reload with `?dev=assets` to check the fit against the hitbox.

## Fields

All optional except `file`.

| Field | Default | Meaning |
|---|---|---|
| `file` | required | Path relative to this folder. |
| `rotationOffset` | `0` | Radians added to the car's angle. The sim's forward is `+x`, i.e. pointing **right**. Art drawn facing **up** needs `1.5707963`. |
| `scale` | `"fit"` | `"fit"` contains the art inside the 48x32 hull. A positive number is an explicit multiplier — use it when pack art has heavy transparent padding and `"fit"` renders it too small. |
| `colorMode` | `"tint"` | `"tint"` multiplies the texture by the player colour and needs desaturated art. `"none"` leaves pre-coloured art alone; the coloured marker under the car still identifies the player. |
| `origin` | `[0.5, 0.5]` | Normalised origin, for art whose visual centre is not its geometric centre. |

## Size limits

**128x128 is the working size, 256x256 the ceiling.** VRAM cost is driven by dimensions, not file
size — a 40 KB PNG at 2048x2048 still occupies about 16 MB of VRAM. Downscale pack and
AI-generated art before committing it.

## Desaturating a pack for `"tint"`

```
mogrify -path out/ -colorspace Gray cars/*.png
```

Phaser's tint is multiplicative, so dark tyres and windows stay dark rather than becoming
coloured mush.
````

- [ ] **Step 3: Verify Vite serves it**

```bash
npm run dev -w packages/client
```

Open `http://localhost:5173/art/manifest.json`.
Expected: the browser shows `{ "sprites": {} }`. If it 404s, the file is in the wrong place —
it must be under `packages/client/public/`, not `packages/client/src/`.

- [ ] **Step 4: Commit**

```bash
git add packages/client/public/art && git commit -m "feat: art folder and empty manifest" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Dev tool selector, registry, and Vite env types

**Files:**
- Modify: `packages/client/tsconfig.json`
- Modify: `packages/client/src/config/client-mode.ts`
- Test: `packages/client/src/config/client-mode.test.ts`
- Create: `packages/client/src/dev/registry.ts`
- Test: `packages/client/src/dev/registry.test.ts`

**One selector `?dev=<tool>`, not a boolean per tool.** Three booleans (`?preview=1&balance=1`) would
need precedence rules; one namespaced value cannot be ambiguous. It also gives the whole dev suite a
single dynamic-import site, a single `import.meta.env.DEV` guard, and a single strip marker however
many tools accumulate — which is what stops one from eventually shipping.

**A query parameter, not a path like `/dev/asset-tuning`**, because the release server is
`express.static` with no SPA history fallback: a path would work under Vite's dev server and **404 in
the release build**, whereas an unknown query parameter is ignored and Join renders.

The registry starts **empty** — Task 9 adds the first tool. Same discipline as Task 5's empty
manifest: prove the plumbing before anything depends on it.

`import.meta.env` is used nowhere in the client today, so `vite/client` types are not yet pulled in
and `npm run typecheck` will fail on first use. That is fixed here, before Task 7 needs it.

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/src/config/client-mode.test.ts`, adding `devToolId` to the existing import
from `./client-mode.js` rather than writing a second import statement:

```typescript
describe("devToolId", () => {
  it("reads the requested tool id", () => {
    expect(devToolId("?dev=assets")).toBe("assets");
    expect(devToolId("?name=x&dev=balance")).toBe("balance");
  });

  it("is undefined when absent or empty", () => {
    expect(devToolId("")).toBeUndefined();
    expect(devToolId("?dev")).toBeUndefined();
    expect(devToolId("?dev=")).toBeUndefined();
  });

  it("does not judge whether the tool exists", () => {
    expect(devToolId("?dev=nonsense")).toBe("nonsense");
  });
});
```

Create `packages/client/src/dev/registry.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DEV_TOOLS, DEV_TOOL_MARKER, isDevToolId } from "./registry.js";

describe("dev tool registry", () => {
  it("recognises exactly its own ids", () => {
    for (const id of Object.keys(DEV_TOOLS)) expect(isDevToolId(id)).toBe(true);
    expect(isDevToolId("nonsense")).toBe(false);
    expect(isDevToolId(undefined)).toBe(false);
  });

  it("does not treat inherited object properties as tool ids", () => {
    expect(isDevToolId("constructor")).toBe(false);
    expect(isDevToolId("toString")).toBe(false);
  });

  it("declares the marker build-release.mjs asserts absent from releases", () => {
    expect(DEV_TOOL_MARKER).toBe("MOTOR DEV TOOL");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w packages/client`
Expected: FAIL — `devToolId is not a function`, and `Cannot find module './registry.js'`.

- [ ] **Step 3: Implement the selector**

Append to `packages/client/src/config/client-mode.ts`:

```typescript
/**
 * The dev tool requested by `?dev=<id>`, or `undefined` for ordinary play.
 *
 * One namespaced selector rather than a flag per tool: `?preview=1&balance=1` would need precedence
 * rules, `?dev=` cannot be ambiguous. Deliberately does *not* check whether the id names a real
 * tool — that is the registry's job, and keeping parsing separate from lookup keeps this testable
 * without importing the registry.
 *
 * The id alone is not enough: `BootScene` gates on `import.meta.env.DEV`, so in a release build no
 * value here can reach a tool, because no tool is in the bundle.
 */
export function devToolId(search: string = window.location.search): string | undefined {
  return new URLSearchParams(search).get("dev") || undefined;
}
```

- [ ] **Step 4: Implement the registry**

Create `packages/client/src/dev/registry.ts`:

```typescript
import type Phaser from "phaser";

/**
 * Asserted absent from release bundles by `assertNoDevOnlyCode` in `scripts/build-release.mjs`.
 * Every dev tool also renders this string as its heading, so it is physically present in each tool's
 * own module as well as here — a tool that reaches a release by some route bypassing this registry
 * is still caught.
 */
export const DEV_TOOL_MARKER = "MOTOR DEV TOOL";

type SceneCtor = new () => Phaser.Scene;

/**
 * Every dev tool, keyed by its `?dev=<id>` value. Values are dynamic imports, so a tool is fetched
 * only when asked for and the whole suite sits behind the one `import.meta.env.DEV` branch in
 * `BootScene` — one guard and one strip marker no matter how many tools accumulate.
 *
 * Empty until Task 9. `import type Phaser` is erased at compile time, so this module stays
 * importable from a node test.
 */
export const DEV_TOOLS: Record<string, () => Promise<SceneCtor>> = {};

/**
 * Own-property check, deliberately not `id in DEV_TOOLS`: `in` walks the prototype chain, so
 * `?dev=toString` would pass as a tool id and then resolve to something that is not a scene.
 */
export function isDevToolId(id: string | undefined): id is string {
  return id !== undefined && Object.prototype.hasOwnProperty.call(DEV_TOOLS, id);
}
```

- [ ] **Step 5: Add Vite client types**

Replace `packages/client/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["vite/client"] },
  "include": ["src/**/*"]
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w packages/client && npm run typecheck -w packages/client`
Expected: PASS both. The registry tests pass against an empty `DEV_TOOLS` — the `for` loop over its
keys is vacuous, which is correct: it asserts the registry recognises exactly what it contains.

- [ ] **Step 7: Commit**

```bash
git add packages/client/tsconfig.json packages/client/src/config packages/client/src/dev && git commit -m "feat: dev tool selector and registry" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Boot-time loading without blocking first paint

**Files:**
- Modify: `packages/client/src/scenes/BootScene.ts`

**This task has no unit tests.** The client's vitest runs in the node environment and must never import Phaser — see `packages/client/CLAUDE.md`. Verification is in the browser, with specific expected observations below.

Two rules from the design: nothing loads during a match (a mid-match texture upload stalls the GPU and reads as a frame spike), and the Join screen must render before the pack arrives. So Boot **launches** Join and keeps running as a background loader rather than `start`ing Join and shutting itself down — a stopped scene's loader does not reliably finish in flight.

**The dynamic import must sit lexically inside the `if (import.meta.env.DEV)` block.** Putting it in a
separate `private async startDevTool()` method looks tidier and silently defeats the whole scheme:
Rollup does not tree-shake class methods, so the method body — and the `import()` inside it — survives
into the bundle even when every call site is dead code, and the dev tool ships as its own chunk. Task
10's assertion would catch it, but the structure below avoids it by construction. An IIFE is the
price of that guarantee.

- [ ] **Step 1: Rewrite BootScene**

```typescript
// packages/client/src/scenes/BootScene.ts
import Phaser from "phaser";
import { devToolId } from "../config/client-mode.js";
import { loadManifest } from "../assets/load-manifest.js";
import { EMPTY_MANIFEST, type AssetManifest } from "../assets/manifest-schema.js";

/**
 * The parsed manifest, and a promise that settles when every texture it names has finished loading.
 * Module-level because textures live in Phaser's global `TextureManager` anyway: whichever scene
 * loads them, every scene can draw them.
 */
let manifest: AssetManifest = EMPTY_MANIFEST;
let ready: Promise<void> = Promise.resolve();

export function assetManifest(): AssetManifest {
  return manifest;
}

/** Awaited by `ArenaScene` before the first frame of a match, so no texture uploads mid-match. */
export function assetsReady(): Promise<void> {
  return ready;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "boot" });
  }

  create(): void {
    // Everything dev-only lives inside this block, imports included. Vite replaces
    // `import.meta.env.DEV` with the literal `false` in a production build, so Rollup drops the
    // whole branch and never emits a chunk for anything it names.
    if (import.meta.env.DEV) {
      const id = devToolId();
      if (id) {
        void (async () => {
          const { DEV_TOOLS, isDevToolId } = await import("../dev/registry.js");
          if (!isDevToolId(id)) {
            const known = Object.keys(DEV_TOOLS).join(", ") || "(none registered)";
            console.warn(`[dev] unknown tool "${id}". Known tools: ${known}`);
            this.scene.launch("join");
            ready = this.loadArt();
            return;
          }
          // Tools read the manifest directly, so the art must be in the TextureManager before the
          // scene's create() runs — unlike normal play, there is no lobby to hide the wait behind.
          ready = this.loadArt();
          await ready;
          const Scene = await DEV_TOOLS[id]!();
          this.scene.add(`dev.${id}`, Scene, true);
        })();
        return;
      }
    }

    // Launch, not start: Boot stays alive as the loader while Join renders immediately. Starting
    // Join would shut Boot down and take its in-flight loader with it.
    this.scene.launch("join");
    ready = this.loadArt();
  }

  private async loadArt(): Promise<void> {
    const { manifest: parsed, problems } = await loadManifest();
    manifest = parsed;
    for (const problem of problems) console.warn(`[art] ${problem}`);

    const entries = Object.entries(parsed.sprites);
    if (entries.length === 0) return;

    for (const [key, entry] of entries) {
      this.load.image(key, `art/${entry.file}`);
    }
    // A file named in the manifest but missing on disk must not stall boot: warn and carry on, and
    // the missing texture key then falls through to the procedural silhouette at draw time.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[art] failed to load "${file.key}" from ${file.url}`);
    });

    await new Promise<void>((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.start();
    });
  }
}
```

- [ ] **Step 2: Verify Join still renders immediately**

```bash
npm run dev
```

Open `http://localhost:5173`.
Expected: the Join screen appears as before, with no visible delay. The console shows no `[art]`
warnings, because the manifest is valid and empty.

- [ ] **Step 3: Verify a broken manifest degrades instead of breaking boot**

Temporarily set `packages/client/public/art/manifest.json` to `{ "sprites": { "car.oval": {} } }` and reload.
Expected: Join still renders; console shows `[art] car.oval: missing or empty "file"`.
Restore the file to `{ "sprites": {} }` afterwards.

- [ ] **Step 4: Verify a full match still plays**

Join, start a match, drive and fire.
Expected: unchanged behaviour — cars are still procedural silhouettes, since the manifest is empty.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/scenes/BootScene.ts && git commit -m "feat: load art at boot without blocking first paint" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Draw cars from the manifest, with fallback

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`drawCar` at ~`:462`, `syncCar` at ~`:445`, imports at `:1-29`)

**No unit tests** — Phaser again. The pure pieces this depends on were tested in Tasks 1–3.

`drawCar` currently returns `Phaser.GameObjects.Graphics` and `this.cars` is `Map<string, Phaser.GameObjects.Graphics>`. Both become `Phaser.GameObjects.Container`, which holds the colour marker plus either a sprite or the existing silhouette. `Container` supports `setPosition` / `setRotation` / `setAlpha`, so `syncCar`'s tail is unchanged.

- [ ] **Step 1: Widen the car map type**

Change the field declaration at `packages/client/src/scenes/ArenaScene.ts:105`:

```typescript
  private readonly cars = new Map<string, Phaser.GameObjects.Container>();
```

- [ ] **Step 2: Add the imports**

Add to the import block at the top of `ArenaScene.ts`:

```typescript
import { assetManifest, assetsReady } from "./BootScene.js";
import { carSpriteKey } from "../assets/asset-keys.js";
import { fitSprite } from "../assets/sprite-fit.js";
```

And add these constants beside the existing `HITBOX_STROKE` / `HITBOX_PX` block:

```typescript
/** The player-colour ring drawn under every car. Procedural, so it works with any pack — including
 * pre-coloured art that cannot be tinted. This is the identity layer; tint is the enhancement. */
const MARKER_RADIUS = 26;
const MARKER_PX = 3;
const MARKER_ALPHA = 0.9;
```

- [ ] **Step 3: Replace drawCar**

```typescript
  /**
   * The car's visual in its own local frame, centred on the origin with +x forward, so the whole
   * thing follows `angle` with a single `setRotation` on the container.
   *
   * A manifest sprite is drawn when one exists and its texture actually loaded; otherwise this falls
   * through to the silhouette the game has always drawn. The fallback is permanent, not legacy: it
   * is what lets art be added one file at a time and what keeps a missing or malformed entry from
   * costing the game its render.
   */
  private drawCar(carId: string, colorId: number, alive: boolean): Phaser.GameObjects.Container {
    const { carWidth: w, carHeight: h } = DRIVE_CONFIG;
    const fill = carFillOf(colorId);
    const container = this.add.container(0, 0);

    const marker = this.add.graphics();
    marker.lineStyle(MARKER_PX, fill, MARKER_ALPHA);
    marker.strokeCircle(0, 0, MARKER_RADIUS);
    container.add(marker);

    const body = this.spriteFor(carId, fill) ?? this.silhouette(carId, fill, w, h);
    container.add(body);

    if (this.debug) {
      const box = this.add.graphics();
      box.lineStyle(HITBOX_PX, HITBOX_STROKE, 1);
      box.strokeRect(-w / 2, -h / 2, w, h);
      container.add(box);
    }
    if (!alive) container.setAlpha(WRECK_ALPHA);
    return container;
  }

  /**
   * The manifest sprite for a chassis, or `undefined` when there is no entry or the texture never
   * loaded. `textures.exists` is the load check: `BootScene` warns on a failed file but carries on,
   * so a named-but-missing file reaches here as a simply absent texture.
   */
  private spriteFor(carId: string, fill: number): Phaser.GameObjects.Image | undefined {
    const key = carSpriteKey(carId);
    const entry = assetManifest().sprites[key];
    if (!entry || !this.textures.exists(key)) return undefined;

    const source = this.textures.get(key).getSourceImage();
    const fit = fitSprite(
      entry,
      { width: source.width, height: source.height },
      { width: DRIVE_CONFIG.carWidth, height: DRIVE_CONFIG.carHeight },
    );

    const image = this.add.image(0, 0, key);
    image.setOrigin(fit.originX, fit.originY);
    image.setScale(fit.scale);
    image.setRotation(fit.rotation);
    if (entry.colorMode === "tint") image.setTint(fill);
    return image;
  }

  /** The procedural chassis. Unchanged from what the game drew before any art existed. */
  private silhouette(
    carId: string,
    fill: number,
    w: number,
    h: number,
  ): Phaser.GameObjects.Graphics {
    const gfx = this.add.graphics();
    gfx.fillStyle(fill, 1);
    switch (carShapeOf(carId)) {
      case "rect":
        gfx.fillRect(-w / 2, -h / 2, w, h);
        break;
      case "ellipse":
        gfx.fillEllipse(0, 0, w, h);
        break;
      case "hex":
        gfx.fillPoints(hexagonPoints(w, h), true);
        break;
    }
    return gfx;
  }
```

`syncCar` needs no change: `gfx?.destroy()` on a `Container` destroys its children too, and
`setPosition` / `setRotation` behave identically.

- [ ] **Step 4: Rebuild cars if art lands after the match starts**

Without this, art that finishes loading *after* `ArenaScene` has drawn a car is never picked up:
`syncCar` only rebuilds when `visualKeyOf(player)` changes, and that key knows nothing about
textures. The car would stay procedural for the whole match. The lobby and car-select usually cover
the load, but "usually" is not a design.

Add the field beside `private debug = false;` (~`:120`):

```typescript
  /** Cleared once art finishes loading, so every car is rebuilt with its sprite on the next frame. */
  private artPending = true;
```

And in `create()`, beside `this.debug = isDebugEnabled();` (~`:142`):

```typescript
    // Reuses the existing rebuild path rather than adding a second one: dropping the cached visual
    // keys makes `syncCar` treat every car as changed, so each is redrawn once, now with its sprite.
    void assetsReady().then(() => {
      this.artPending = false;
      this.visualKeys.clear();
    });
```

`artPending` is not read by the renderer — it exists so the state is inspectable while debugging a
"why is my car still a hexagon" report. The `visualKeys.clear()` is what does the work.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w packages/client`
Expected: PASS. If `this.cars` is referenced with a `Graphics`-specific method anywhere else, fix it here.

- [ ] **Step 6: Verify nothing changed with an empty manifest**

```bash
npm run dev
```

Play a match.
Expected: cars look exactly as before, now with a coloured ring under each. Elimination still fades
the wreck. `?debug=1` still draws the hitbox.

- [ ] **Step 7: Verify a real sprite loads**

Put any PNG at `packages/client/public/art/cars/hexagon.png` and set the manifest to:

```json
{
  "sprites": {
    "car.hexagon": { "file": "cars/hexagon.png" }
  }
}
```

Play as Hexagon.
Expected: the sprite is drawn in place of the hexagon silhouette, tinted to the player colour,
contained inside the hitbox visible under `?debug=1`. Rectangle and Oval are unchanged.

- [ ] **Step 8: Verify a missing file falls back**

Point the manifest at `cars/does-not-exist.png` and reload.
Expected: console warns `[art] failed to load "car.hexagon" ...`, and the hexagon silhouette is drawn.
No crash, no invisible car.

- [ ] **Step 9: Restore and commit**

Reset the manifest to `{ "sprites": {} }` and delete the test PNG, then:

```bash
git add packages/client/src/scenes/ArenaScene.ts packages/client/public/art/manifest.json && git commit -m "feat: draw cars from the art manifest with procedural fallback" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: The asset tuning tool

**Files:**
- Create: `packages/client/src/dev/AssetTuningScene.ts`
- Modify: `packages/client/src/dev/registry.ts`

Three rules decide whether this actually strips from a release build. Two are already satisfied by
Task 7's `BootScene` — the import is **dynamic**, and it sits lexically inside the
`import.meta.env.DEV` block. The third is on you: `AssetTuningScene` must **not** be added to the
`scene:` array in `packages/client/src/main.ts`, and must be reachable **only** through the registry.
Do not import it from anywhere else.

`MOTOR DEV TOOL` is the marker string Task 10 greps for. Do not change its spelling.

- [ ] **Step 1: Write the scene**

```typescript
// packages/client/src/dev/AssetTuningScene.ts
import Phaser from "phaser";
import { CAR_TABLE, COLOR_TABLE, DRIVE_CONFIG } from "@motor-combat-moba/shared";
import { carSpriteKey } from "../assets/asset-keys.js";
import { fitSprite } from "../assets/sprite-fit.js";
import { assetManifest } from "../scenes/BootScene.js";

/**
 * Grepped by scripts/build-release.mjs to prove this scene is absent from a release build. A local
 * literal rather than an import of `DEV_TOOL_MARKER`, deliberately: the string must be physically
 * present in *this* module, so the check still fires if the scene ever reaches a bundle by a route
 * that bypasses the registry.
 */
const MARKER = "MOTOR DEV TOOL";

const CELL_W = 220;
const CELL_H = 190;
const COLUMNS = 3;
const HULL_STROKE = 0xffffff;

/**
 * Every manifest entry parked on its own hull, with no server connection.
 *
 * It exists because `rotationOffset`, `scale`, and `origin` have to be tuned by eye per sprite, and
 * the alternative loop is a full rejoin per attempt: the client has no reconnect or session
 * persistence, so a reload drops you back to the name prompt, the lobby, and car select before you
 * can look at one car again.
 *
 * Dev-only. `BootScene` gates the dynamic import behind `import.meta.env.DEV`, which Vite replaces
 * with the literal `false` in a production build, so this module is never emitted into `dist`.
 */
export class AssetTuningScene extends Phaser.Scene {
  constructor() {
    // `BootScene` registers this under `dev.assets`; the key here is overridden at `scene.add` time,
    // so it only matters that it is stable and does not collide with a game scene.
    super({ key: "dev.assets" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x1d1f21);
    this.add.text(16, 12, MARKER, { fontSize: "20px", color: "#ffffff" });

    const manifest = assetManifest();
    const keys = Object.keys(manifest.sprites);
    this.add.text(16, 38, this.summary(keys.length), {
      fontSize: "13px",
      color: "#9aa0a6",
    });

    const cars = Object.keys(CAR_TABLE);
    cars.forEach((carId, index) => this.drawCell(carId, index));
  }

  private summary(entryCount: number): string {
    const chassis = Object.keys(CAR_TABLE).length;
    return `${entryCount} manifest entr${entryCount === 1 ? "y" : "ies"} - ${chassis} chassis - white box is the OBB hitbox - reload after editing art`;
  }

  /** One chassis: its hull, its art (or the fact that it has none), and its manifest key. */
  private drawCell(carId: string, index: number): void {
    const x = 130 + (index % COLUMNS) * CELL_W;
    const y = 140 + Math.floor(index / COLUMNS) * CELL_H;
    const { carWidth: w, carHeight: h } = DRIVE_CONFIG;
    const key = carSpriteKey(carId);
    const entry = assetManifest().sprites[key];
    const fill = Number.parseInt(COLOR_TABLE[index % COLOR_TABLE.length].hex.slice(1), 16);

    if (entry && this.textures.exists(key)) {
      const source = this.textures.get(key).getSourceImage();
      const fit = fitSprite(
        entry,
        { width: source.width, height: source.height },
        { width: w, height: h },
      );
      const image = this.add.image(x, y, key);
      image.setOrigin(fit.originX, fit.originY);
      image.setScale(fit.scale);
      image.setRotation(fit.rotation);
      if (entry.colorMode === "tint") image.setTint(fill);
    } else {
      this.add.text(x, y - 8, "no art", { fontSize: "13px", color: "#d94040" }).setOrigin(0.5);
    }

    // Drawn on top of the art, so a sprite that overflows its collision box is obvious rather than
    // hidden underneath it.
    const box = this.add.graphics();
    box.lineStyle(1, HULL_STROKE, 1);
    box.strokeRect(x - w / 2, y - h / 2, w, h);

    // The sim's forward is +x. A sprite whose nose does not point along this needs a rotationOffset.
    box.lineStyle(1, HULL_STROKE, 0.5);
    box.lineBetween(x, y, x + w, y);

    this.add.text(x, y + 46, key, { fontSize: "12px", color: "#ffffff" }).setOrigin(0.5);
    this.add
      .text(x, y + 64, entry ? `scale ${String(entry.scale)} rot ${entry.rotationOffset}` : "-", {
        fontSize: "11px",
        color: "#9aa0a6",
      })
      .setOrigin(0.5);
  }
}
```

- [ ] **Step 2: Register it**

Add the one row to `packages/client/src/dev/registry.ts`, replacing the empty object:

```typescript
export const DEV_TOOLS: Record<string, () => Promise<SceneCtor>> = {
  assets: async () => (await import("./AssetTuningScene.js")).AssetTuningScene,
};
```

This is the entire cost of adding a dev tool. A balance calculator later is a second file plus a
second row — no new flag, no new `import.meta.env.DEV` guard, no new strip marker.

- [ ] **Step 3: Confirm AssetTuningScene is reachable only through the registry**

Run: `grep -rn "AssetTuningScene" packages/client/src --include=*.ts`
Expected: **exactly two hits** — its own declaration in `dev/AssetTuningScene.ts`, and the dynamic
import in `dev/registry.ts`. Any other reference, and especially anything in `main.ts`, is a static
reference that will ship the scene into the release bundle.

- [ ] **Step 4: Verify it runs in dev**

```bash
npm run dev
```

Open `http://localhost:5173/?dev=assets`.
Expected: a dark screen headed `MOTOR DEV TOOL`, three labelled cells reading `car.rectangle`,
`car.oval`, `car.hexagon`, each showing `no art` inside a white hitbox rectangle with a forward
tick pointing right. No name prompt, no lobby, no server connection.

- [ ] **Step 5: Verify it does not hijack normal play, and that a wrong id is survivable**

Open `http://localhost:5173` with no query string.
Expected: the ordinary Join screen.

Open `http://localhost:5173/?dev=balance` — a tool that does not exist yet.
Expected: console warns `[dev] unknown tool "balance". Known tools: assets`, and the ordinary Join
screen renders. A typo must not be a blank page.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/dev && git commit -m "feat: asset tuning dev tool" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Fail the release build if dev-only code ships

**Files:**
- Modify: `scripts/build-release.mjs`
- Test: `scripts/build-release.test.mjs`

This belongs in the build script rather than only in the test file. `scripts/build-release.test.mjs`
unit-tests exported pure functions and never inspects `dist`; a test that grepped `dist` would
silently pass whenever `dist` was absent, which is precisely when it should complain. So: an exported
pure-ish function, unit-tested against a temp directory, and **called** by the build.

- [ ] **Step 1: Write the failing test**

Append to `scripts/build-release.test.mjs`:

```javascript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertNoDevOnlyCode, DEV_ONLY_MARKERS } from "./build-release.mjs";

describe("assertNoDevOnlyCode", () => {
  function tempDist(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motor-dist-"));
    for (const [name, body] of Object.entries(files)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
    return dir;
  }

  it("passes for a build with no dev-only markers", () => {
    const dir = tempDist({ "assets/index-abc.js": "console.log('hello');" });
    assert.doesNotThrow(() => assertNoDevOnlyCode(dir));
  });

  it("throws when a marker survived into the bundle", () => {
    const dir = tempDist({ "assets/index-abc.js": 'const M = "MOTOR DEV TOOL";' });
    assert.throws(() => assertNoDevOnlyCode(dir), /MOTOR DEV TOOL/);
  });

  it("names the offending file", () => {
    const dir = tempDist({ "assets/chunk-xyz.js": 'x("MOTOR DEV TOOL")' });
    assert.throws(() => assertNoDevOnlyCode(dir), /chunk-xyz\.js/);
  });

  it("ignores non-javascript files so art and docs cannot trip it", () => {
    const dir = tempDist({
      "art/README.md": "MOTOR DEV TOOL is dev-only",
      "assets/index-abc.js": "console.log('hello');",
    });
    assert.doesNotThrow(() => assertNoDevOnlyCode(dir));
  });

  it("declares at least one marker", () => {
    assert.ok(DEV_ONLY_MARKERS.length > 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:scripts`
Expected: FAIL — `assertNoDevOnlyCode is not a function` / export missing.

- [ ] **Step 3: Implement in build-release.mjs**

Add near the other exported helpers in `scripts/build-release.mjs`:

```javascript
/**
 * Strings that must only ever exist in dev-only code. `import.meta.env.DEV` is replaced with the
 * literal `false` by `vite build`, so the branch importing the dev tool is dead code and its
 * chunk is never emitted. This asserts that rather than trusting it — a static import added by
 * accident, or the scene wired into main.ts's scene list, would silently ship it.
 */
export const DEV_ONLY_MARKERS = ["MOTOR DEV TOOL"];

function javascriptFilesIn(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...javascriptFilesIn(full));
    else if (entry.name.endsWith(".js")) found.push(full);
  }
  return found;
}

/**
 * Throw if any dev-only marker reached the built client. Only `.js` is scanned: the art folder and
 * its README legitimately mention the markers in prose, and tripping on those would train whoever
 * hits it to ignore the check.
 */
export function assertNoDevOnlyCode(clientDistDir) {
  for (const file of javascriptFilesIn(clientDistDir)) {
    const body = fs.readFileSync(file, "utf8");
    for (const marker of DEV_ONLY_MARKERS) {
      if (body.includes(marker)) {
        throw new Error(
          `dev-only code shipped: "${marker}" found in ${path.relative(clientDistDir, file)}. ` +
            `Check that AssetTuningScene is imported dynamically behind import.meta.env.DEV and is not ` +
            `listed in main.ts's scene array.`,
        );
      }
    }
  }
}
```

- [ ] **Step 4: Call it from the build**

In `scripts/build-release.mjs`, immediately after the existing
`requireBuiltDist(clientDist, "packages/client/dist");` line (~`:87`), add:

```javascript
  assertNoDevOnlyCode(clientDist);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:scripts`
Expected: PASS, 5 new `assertNoDevOnlyCode` tests green.

- [ ] **Step 6: Verify against a real release build**

```bash
npm run build:release
```

Expected: the build completes. Then confirm the marker really is absent:

```bash
grep -rl "MOTOR DEV TOOL" packages/client/dist --include=*.js || echo "stripped"
```

Expected: `stripped`.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-release.mjs scripts/build-release.test.mjs && git commit -m "feat: fail release build if dev-only code ships" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Documentation

**Files:**
- Modify: `packages/client/CLAUDE.md`
- Modify: `CLAUDE.md` (the "Read the right doc" table)
- Create: `docs/asset-pipeline.md`

- [ ] **Step 1: Write the doc**

Create `docs/asset-pipeline.md` covering, in this order: the `public/art/` layout; the manifest
schema table (copy the field table from `packages/client/public/art/README.md` rather than
paraphrasing it); the resolution chain `carId -> carSpriteKey -> manifest -> sprite | procedural
fallback`; the 128/256 size limits and why VRAM tracks dimensions rather than file size; `?dev=assets`
and its dev-only guarantee; and a "deferred" section naming the online build step, particle effects,
powers art, themes, and atlases as explicitly out of scope with the reasoning from the design doc.

- [ ] **Step 2: Add the doc to the root table**

Add a row to the "Read the right doc" table in `CLAUDE.md`:

```markdown
| Art, manifest, asset swapping | [`docs/asset-pipeline.md`](docs/asset-pipeline.md) |
```

- [ ] **Step 3: Note the pipeline in the client package doc**

Append to `packages/client/CLAUDE.md`:

```markdown
Art is data, not code. `public/art/manifest.json` maps namespaced keys (`car.rectangle`) to sprite
entries; `src/assets/` parses and fits them. A missing, malformed, or unloadable entry falls back to
the procedural silhouette in `drawCar` — that fallback is permanent, not legacy, and is what lets art
be added one file at a time. Sprites are cosmetic: they are fitted to the OBB hull and never change
it. `?dev=assets` opens the asset tuning tool, which is stripped from release builds and asserted
absent by `scripts/build-release.mjs`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/asset-pipeline.md CLAUDE.md packages/client/CLAUDE.md && git commit -m "docs: asset pipeline" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full suite: `npm test`
- [ ] Run typecheck across workspaces: `npm run typecheck`
- [ ] Build a release: `npm run build:release`
- [ ] Confirm the strip: `grep -rl "MOTOR DEV TOOL" packages/client/dist --include=*.js || echo "stripped"`
- [ ] Play one full LAN match with an empty manifest — everything procedural, unchanged from today
- [ ] Drop in one car PNG, confirm it appears, then confirm `?dev=assets` shows it on its hull

## Explicitly out of scope

Deferred by decision, not forgotten. Each would be its own spec and plan:

0. **A balance tuning tool.** Not designed, not decided — deliberately. It is named here only because
   it is why `src/dev/registry.ts` exists at all: a registry holding one tool looks like
   over-engineering until you know a second is expected, and the alternative (a boolean flag per
   tool) is what leads to a forgotten `import.meta.env.DEV` guard and dev code in a release.

   Whoever picks this up should know the two versions are not equally easy. A **read-only calculator**
   (time-to-kill tables across `CAR_TABLE` × `WEAPON_CONFIG`, speed curves, ram damage matrices) is a
   scene that imports shared and does arithmetic — one file plus one registry row, exactly like the
   asset tuner. A **live in-match tuner with sliders** is not: `stepSim` reads `DRIVE_CONFIG`,
   `COMBAT_CONFIG`, and `WEAPON_CONFIG` from shared's built `dist` on the server *and* the client, and
   the server is authoritative. Changing a value client-side would not make the car faster — it would
   make the client mispredict and get snapped back every patch. A real live tuner needs balance config
   to become mutable server state plus a dev-only server message, which collides with invariant 2 and
   is a change to the authoritative sim, not a client dev tool.

1. **The online build step** — WebP conversion, downscaling, content hashing, manifest rewriting.
   Needed when the game is hosted over the internet; v1 is LAN, and building it now is speculative.
   The manifest indirection is what makes it a later, additive change.
2. **Particle and spritesheet effects** — the `effects` half of the manifest. Note that particles are
   preferred for **modifiability, not performance**: a 16-frame sheet is one quad, a particle burst
   is 30-50. Emitters must be pre-created and pooled with `maxParticles` caps. Best designed once
   powers exist and there is something concrete to tune.
3. **Powers art** — no power exists in the sim yet. The flat key namespace absorbs them as new rows.
4. **Themes** — the only affordance kept is that `MANIFEST_URL` is a single constant with no project
   name in it.
5. **Texture atlas** — a build-step concern if the online request count ever justifies it.
