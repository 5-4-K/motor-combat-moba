# Gritty Visual FX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the game a gritty, grounded look — procedurally generated smoke, fire, sparks, debris, persistent rubber and scorch, a textured floor, and a camera that reacts to impact — without adding a single image file, schema field, or shared-config change.

**Architecture:** A new `packages/client/src/fx/` module set. Six pure modules (no Phaser, no DOM) hold every decision and are unit-tested in vitest's node environment; one Phaser shell, `fx/layer.ts`, owns the `RenderTexture`s and particle emitters and is the only file that touches the renderer. `ArenaScene` gains one hook in `update` and one line in `splitCameras`. FX events are derived by diffing two consecutive world views, so nothing goes on the wire.

**Tech Stack:** TypeScript, Phaser 4.2.1 (`Phaser.AUTO` → WebGL), vitest (node environment), Vite.

**Spec:** [`docs/superpowers/specs/2026-09-07-gritty-visual-fx-design.md`](../specs/2026-09-07-gritty-visual-fx-design.md) — decisions VFX1–VFX36. The plan argues from the spec; read both.

## Global Constraints

- **Never import Phaser from a test.** Client tests are vitest in the **node** environment (`packages/client/vitest.config.ts` sets `environment: "node"`). There is no `document`, no `canvas`, no `Image`. Only `fx/layer.ts` may import Phaser, and it has no test.
- **Relative imports carry a `.js` extension** — `import { fbm } from "./noise.js"`. This is ESM; a missing extension fails the build.
- **Blend mode is a property of an emitter, never of a particle.** `packages/client/CLAUDE.md`: *"Stop and warn before a per-instance `setBlendMode` (flushes the batch — one draw call becomes one per shot)."* There are exactly four emitters, one per channel, and `EmitterSpec.channel` is what selects between them.
- **No new file in `packages/client/public/art/`.** Every texture is generated (VFX4).
- **No schema field, no change to any shared config table**, no change to `sim/`. If a task seems to need one, stop — it contradicts VFX9–VFX12 and VFX30.
- **Every object added to the scene must be registered in `splitCameras`'s `worldObjects` list.** Ignored by neither camera and it draws twice; ignored by both and it vanishes.
- **Phaser 4's `RenderTexture` is not Phaser 3's.** Verified against `node_modules/phaser/types/phaser.d.ts`, because three separate assumptions about this API turned out wrong while the spec was being written:
  - Draw commands are **buffered**. `render()` must be called or nothing appears — *"You must do this in order to see anything drawn to it."*
  - `setRenderMode(mode, preserve)`'s `preserve` preserves the **command buffer**, not the pixels — it repeats the same drawing commands each render. It is **not** how you accumulate a decal layer.
  - Pixels accumulate by simply **not calling `clear()`** — *"Make sure to call `clear()` at the start if you don't want to accumulate drawing detail over the top of itself."*
  - There is **no `setGlobalAlpha`**. Alpha, tint, rotation and scale go in `StampConfig`, per stamp.
  - `erase(entries, x, y)` takes **no alpha**, so a partial per-frame fade is not expressible through it.
  - `draw(entries, …)` draws every member of an **array** regardless of visibility, which is how an invisible emitter gets rendered into a texture.
- **Phaser 4 has no `Bloom` filter** and no `postFX`/`preFX`; it has a camera **Filters** system. See Task 14.
- Per-task iteration: `npm run test -w @motor-combat-moba/client`. **Final verification is root `npm test`** — a per-workspace run silently skips other suites.
- Type check with `npm run typecheck -w @motor-combat-moba/client`.

---

## File Structure

| File | Responsibility | Imports Phaser |
|---|---|---|
| `packages/client/src/fx/noise.ts` | seeded hash, value noise, fbm | no |
| `packages/client/src/fx/textures.ts` | pixel-data generators for every texture | no |
| `packages/client/src/fx/events.ts` | `deriveFxEvents(prev, next)` — the state-delta seam | no |
| `packages/client/src/fx/table.ts` | `WEAPON_FX`, one row per weapon id | no |
| `packages/client/src/fx/emitters.ts` | event + row → `EmitterSpec[]` | no |
| `packages/client/src/fx/decals.ts` | decal stamps and the fade rate | no |
| `packages/client/src/fx/occlusion.ts` | eraser stamps for a set of car poses | no |
| `packages/client/src/fx/depths.ts` | the three new depth constants | no |
| `packages/client/src/fx/layer.ts` | owns `RenderTexture`s and emitters; draws | **yes** |
| `packages/client/src/scenes/ArenaScene.ts` | modified: one `update` hook, one `splitCameras` line, `showImpact` rewrite | yes |

---

### Task 1: Seeded noise primitives

**Files:**
- Create: `packages/client/src/fx/noise.ts`
- Test: `packages/client/src/fx/noise.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `hash2(x: number, y: number, seed: number): number` in `[0,1)`; `valueNoise(x: number, y: number, seed: number): number` in `[0,1]`; `fbm(x: number, y: number, seed: number, octaves: number): number` in `[0,1]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/fx/noise.test.ts
import { describe, expect, it } from "vitest";
import { fbm, hash2, valueNoise } from "./noise.js";

describe("hash2", () => {
  it("stays inside [0,1)", () => {
    for (let i = 0; i < 200; i++) {
      const v = hash2(i, i * 7, 1337);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for the same inputs", () => {
    expect(hash2(12, 34, 99)).toBe(hash2(12, 34, 99));
  });

  it("decorrelates neighbours — an adjacent cell is not an adjacent value", () => {
    const a = hash2(10, 10, 5);
    const b = hash2(11, 10, 5);
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
  });
});

describe("valueNoise", () => {
  it("interpolates smoothly between lattice points", () => {
    // Two samples a hundredth of a cell apart must not jump.
    const a = valueNoise(4.50, 4.5, 3);
    const b = valueNoise(4.51, 4.5, 3);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it("reproduces the lattice value exactly at integer coordinates", () => {
    expect(valueNoise(6, 9, 2)).toBeCloseTo(hash2(6, 9, 2), 10);
  });
});

describe("fbm", () => {
  it("stays inside [0,1]", () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 0.37, i * 0.11, 7, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("varies with the seed — this is what makes a re-roll a re-roll (VFX8)", () => {
    expect(fbm(3.3, 4.4, 1, 4)).not.toBe(fbm(3.3, 4.4, 2, 4));
  });

  it("adds detail with each octave rather than repeating one", () => {
    expect(fbm(3.3, 4.4, 1, 1)).not.toBe(fbm(3.3, 4.4, 1, 4));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- noise`
Expected: FAIL — `Failed to resolve import "./noise.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/fx/noise.ts
/**
 * Seeded value noise. Every texture in `fx/` is built from this and nothing else, which is what
 * lets the whole effect set ship as code rather than as image files (VFX4).
 *
 * Deliberately not a library. It has to run in vitest's node environment with no DOM, be
 * deterministic for a given seed so a texture can be asserted on, and vary across seeds so
 * "re-roll" is a real operation rather than a redraw of the same image (VFX8).
 */

/** A hash of a lattice cell to `[0,1)`. Integer-mixing, so neighbouring cells decorrelate. */
export function hash2(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/** Smoothstep between the four lattice values around `(x, y)`. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/**
 * Fractal sum of `octaves` value-noise layers, each at twice the frequency and half the amplitude.
 *
 * The frequency step is 2.03 rather than 2 on purpose: an exact doubling lines every octave's
 * lattice up on the same integer grid, and the repeated seams read as a faint plaid in the finished
 * texture.
 */
export function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return norm > 0 ? sum / norm : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- noise`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/noise.ts packages/client/src/fx/noise.test.ts
git commit -m "feat(fx): seeded value noise, the basis of every generated texture"
```

---

### Task 2: Texture generators

**Files:**
- Create: `packages/client/src/fx/textures.ts`
- Test: `packages/client/src/fx/textures.test.ts`

**Interfaces:**
- Consumes: `fbm` from `./noise.js`.
- Produces:
  - `interface TexturePixels { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }` — RGBA, 4 bytes per pixel, row-major.
  - `puffTexture(seed: number, opts: PuffOptions): TexturePixels`
  - `interface PuffOptions { readonly size: number; readonly octaves: number; readonly bite: number; readonly base: number; readonly span: number; readonly warm: number }`
  - `fireTexture(seed: number, size?: number): TexturePixels`
  - `sparkTexture(size?: number): TexturePixels`
  - `scorchTexture(seed: number, size?: number): TexturePixels`
  - `asphaltTexture(seed: number, size?: number): TexturePixels`
  - `DUST_A`, `DUST_B`, `SOOT_A`, `SOOT_B`: `PuffOptions` presets.
  - `alphaAt(tex: TexturePixels, x: number, y: number): number` — test helper, exported so tests do not re-derive the stride.

**Why pixel data and not a canvas:** the node test environment has no `document`. The generators return bytes; `fx/layer.ts` (Task 9) is what turns them into a Phaser texture. This is also the only reason the acceptance criteria in VFX5, VFX7 and VFX8 are assertable at all.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/fx/textures.test.ts
import { describe, expect, it } from "vitest";
import {
  alphaAt,
  asphaltTexture,
  DUST_A,
  fireTexture,
  puffTexture,
  scorchTexture,
  SOOT_A,
  sparkTexture,
} from "./textures.js";

/** Mean alpha on a ring of radius `r` (in pixels) around the centre, and its spread. */
function ring(tex: ReturnType<typeof puffTexture>, r: number): { mean: number; spread: number } {
  const c = tex.width / 2;
  const samples: number[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    samples.push(alphaAt(tex, Math.round(c + Math.cos(a) * r), Math.round(c + Math.sin(a) * r)));
  }
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const spread = Math.sqrt(samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length);
  return { mean, spread };
}

describe("puffTexture", () => {
  it("produces RGBA bytes of the requested size", () => {
    const tex = puffTexture(1, DUST_A);
    expect(tex.width).toBe(DUST_A.size);
    expect(tex.height).toBe(DUST_A.size);
    expect(tex.data.length).toBe(DUST_A.size * DUST_A.size * 4);
  });

  it("is fully transparent outside its radius, so a puff never draws a square", () => {
    const tex = puffTexture(1, DUST_A);
    expect(alphaAt(tex, 0, 0)).toBe(0);
    expect(alphaAt(tex, tex.width - 1, 0)).toBe(0);
    expect(alphaAt(tex, 0, tex.height - 1)).toBe(0);
    expect(alphaAt(tex, tex.width - 1, tex.height - 1)).toBe(0);
  });

  it("has a RAGGED edge, not a circular one — this is VFX5, the whole point", () => {
    const tex = puffTexture(1, DUST_A);
    // At 70% of the radius the alpha must vary substantially around the ring. A smooth radial
    // gradient would give a spread near zero, and would read as a grey blob rather than smoke.
    const { spread } = ring(tex, tex.width * 0.35);
    expect(spread).toBeGreaterThan(18);
  });

  it("is opaque near the centre", () => {
    const tex = puffTexture(1, DUST_A);
    expect(ring(tex, 4).mean).toBeGreaterThan(120);
  });

  it("is deterministic for a seed and different across seeds (VFX8)", () => {
    expect(Array.from(puffTexture(5, DUST_A).data)).toEqual(Array.from(puffTexture(5, DUST_A).data));
    expect(Array.from(puffTexture(5, DUST_A).data)).not.toEqual(
      Array.from(puffTexture(6, DUST_A).data),
    );
  });

  it("makes soot a WARM MID-grey, never near-black (VFX7)", () => {
    const tex = puffTexture(9, SOOT_A);
    const c = tex.width / 2;
    const i = (c * tex.width + c) * 4;
    const [r, g, b] = [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
    // Warm: red leads, blue trails. Near-black soot on dark asphalt has no contrast and swallows
    // whatever it lands on, which is the failure VFX7 records.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r).toBeGreaterThan(70);
  });

  it("keeps soot darker than dust, or the two channels read the same", () => {
    const sootMid = puffTexture(9, SOOT_A).data[(64 * 128 + 64) * 4];
    const dustMid = puffTexture(9, DUST_A).data[(64 * 128 + 64) * 4];
    expect(sootMid).toBeLessThan(dustMid);
  });
});

describe("fireTexture", () => {
  it("has a white-hot core grading out to orange", () => {
    const tex = fireTexture(3);
    const c = tex.width / 2;
    const core = (c * tex.width + c) * 4;
    const edge = (c * tex.width + Math.floor(c * 1.7)) * 4;
    // Core: blue channel lifted toward white. Edge: blue gone, so it reads orange.
    expect(tex.data[core + 2]).toBeGreaterThan(tex.data[edge + 2]);
    expect(tex.data[core]).toBeGreaterThan(200);
  });

  it("is transparent in its corners", () => {
    const tex = fireTexture(3);
    expect(alphaAt(tex, 0, 0)).toBe(0);
  });
});

describe("sparkTexture", () => {
  it("is sharp — alpha collapses fast, or a spark reads as dust", () => {
    const tex = sparkTexture();
    const c = tex.width / 2;
    const centre = alphaAt(tex, c, c);
    const half = alphaAt(tex, Math.round(c * 1.5), c);
    expect(centre).toBeGreaterThan(200);
    expect(half).toBeLessThan(centre * 0.25);
  });
});

describe("scorchTexture", () => {
  it("is dark and never fully opaque, so a stain tints the floor instead of replacing it", () => {
    const tex = scorchTexture(2);
    const c = tex.width / 2;
    const i = (c * tex.width + c) * 4;
    expect(tex.data[i]).toBeLessThan(60);
    expect(tex.data[i + 3]).toBeLessThanOrEqual(210);
  });
});

describe("asphaltTexture", () => {
  it("is fully opaque — it is a ground, not an overlay", () => {
    const tex = asphaltTexture(4, 64);
    for (let i = 3; i < tex.data.length; i += 4) expect(tex.data[i]).toBe(255);
  });

  it("varies in value, or it is just a flat fill with extra steps", () => {
    const tex = asphaltTexture(4, 64);
    let min = 255;
    let max = 0;
    for (let i = 0; i < tex.data.length; i += 4) {
      min = Math.min(min, tex.data[i]);
      max = Math.max(max, tex.data[i]);
    }
    expect(max - min).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- textures`
Expected: FAIL — `Failed to resolve import "./textures.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/fx/textures.ts
import { fbm } from "./noise.js";

/**
 * A generated texture as raw RGBA bytes.
 *
 * Bytes rather than a canvas because client tests run in vitest's **node** environment, where there
 * is no `document` — see `packages/client/CLAUDE.md`. `fx/layer.ts` is what uploads these to Phaser.
 * The upside is that every acceptance criterion in VFX5, VFX7 and VFX8 is assertable.
 */
export interface TexturePixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  readonly data: Uint8ClampedArray;
}

/** Alpha at a pixel. Exported so tests never re-derive the stride. Out of bounds reads as 0. */
export function alphaAt(tex: TexturePixels, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= tex.width || y >= tex.height) return 0;
  return tex.data[(y * tex.width + x) * 4 + 3];
}

/** How one smoke puff is shaped and coloured. */
export interface PuffOptions {
  readonly size: number;
  readonly octaves: number;
  /** How much of the radial falloff the noise is allowed to eat. This is the VFX5 knob. */
  readonly bite: number;
  /** Grey value floor. */
  readonly base: number;
  /** Grey value range added by noise. */
  readonly span: number;
  /** >1 pushes red up and blue down. Soot is warm because its own fire lights it (VFX7). */
  readonly warm: number;
}

/** Light airborne dust — tyre kick, muzzle wash, slam debris cloud. */
export const DUST_A: PuffOptions = { size: 128, octaves: 5, bite: 0.85, base: 168, span: 84, warm: 1 };
export const DUST_B: PuffOptions = { size: 128, octaves: 4, bite: 0.7, base: 176, span: 76, warm: 1 };
/** Explosion smoke. Mid-grey and warm — see the VFX7 test. */
export const SOOT_A: PuffOptions = { size: 128, octaves: 5, bite: 0.9, base: 96, span: 74, warm: 1.14 };
export const SOOT_B: PuffOptions = { size: 128, octaves: 4, bite: 0.78, base: 82, span: 66, warm: 1.18 };

function blank(size: number): { data: Uint8ClampedArray; half: number } {
  return { data: new Uint8ClampedArray(size * size * 4), half: size / 2 };
}

/**
 * One smoke puff: a radial falloff **eaten into by fbm**, so the silhouette is ragged.
 *
 * The bite is the entire difference between smoke and a grey blob (VFX5). A smooth radial gradient
 * with no noise term produces a circle, and a cloud of circles reads as a cloud of circles no
 * matter how many you overlap.
 */
export function puffTexture(seed: number, opts: PuffOptions): TexturePixels {
  const { size, octaves, bite, base, span, warm } = opts;
  const { data, half } = blank(size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot((i - half) / half, (j - half) / half);
      const k = (j * size + i) * 4;
      if (r > 1) continue;
      const n = fbm(i / 16, j / 16, seed, octaves);
      let a = (1 - r * r) * ((1 - bite) + bite * n * 1.9) - r * 0.35;
      if (a <= 0) continue;
      const v = base + n * span;
      data[k] = Math.min(255, v * warm);
      data[k + 1] = v;
      data[k + 2] = v / warm;
      data[k + 3] = Math.min(255, a * 255);
    }
  }
  return { width: size, height: size, data };
}

/**
 * Fire: a white-hot core grading through orange, with the same noise bite so the flame edge
 * flickers instead of ringing.
 */
export function fireTexture(seed: number, size = 128): TexturePixels {
  const { data, half } = blank(size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot((i - half) / half, (j - half) / half);
      const k = (j * size + i) * 4;
      if (r > 1) continue;
      const n = fbm(i / 13, j / 13, seed + 91, 4);
      const a = Math.pow(1 - r, 1.7) * (0.55 + 0.75 * n);
      if (a <= 0) continue;
      const t = Math.min(1, Math.pow(1 - r, 1.1) * (0.6 + 0.7 * n));
      data[k] = 255;
      data[k + 1] = Math.min(255, 70 + t * 195);
      // Blue only enters at the very hottest part, which is what makes the core read as white
      // rather than as a brighter orange.
      data[k + 2] = t > 0.72 ? Math.min(255, (t - 0.72) * 790) : 0;
      data[k + 3] = Math.min(255, a * 255);
    }
  }
  return { width: size, height: size, data };
}

/** A spark. Deliberately noise-free and sharp: a soft spark reads as dust. */
export function sparkTexture(size = 32): TexturePixels {
  const { data, half } = blank(size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot((i - half) / half, (j - half) / half);
      const k = (j * size + i) * 4;
      if (r > 1) continue;
      data[k] = 255;
      data[k + 1] = 200 + 55 * (1 - r);
      data[k + 2] = 140 + 80 * (1 - r);
      data[k + 3] = Math.min(255, Math.pow(1 - r, 3.2) * 255);
    }
  }
  return { width: size, height: size, data };
}

/** A scorch stain for the decal layer. Dark, irregular, and never fully opaque. */
export function scorchTexture(seed: number, size = 160): TexturePixels {
  const { data, half } = blank(size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot((i - half) / half, (j - half) / half);
      const k = (j * size + i) * 4;
      if (r > 1) continue;
      const n = fbm(i / 20, j / 20, seed + 301, 4);
      const a = (1 - r) * (0.35 + 0.9 * n) - r * 0.25;
      if (a <= 0) continue;
      const v = 14 + n * 22;
      data[k] = v;
      data[k + 1] = Math.max(0, v - 2);
      data[k + 2] = Math.max(0, v - 4);
      data[k + 3] = Math.min(210, a * 235);
    }
  }
  return { width: size, height: size, data };
}

/** Tileable asphalt: a coarse octave for patches, a fine one for grain. Always fully opaque. */
export function asphaltTexture(seed: number, size = 512): TexturePixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const n = fbm(i / 9, j / 9, seed + 7, 3) * 0.62 + fbm(i / 48, j / 48, seed + 55, 2) * 0.38;
      const g = 50 + n * 46;
      const k = (j * size + i) * 4;
      data[k] = g + 2;
      data[k + 1] = g + 1;
      data[k + 2] = Math.max(0, g - 2);
      data[k + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- textures`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/textures.ts packages/client/src/fx/textures.test.ts
git commit -m "feat(fx): procedural texture generators, no image files (VFX4-VFX8)"
```

---

### Task 3: The FX event seam

**Files:**
- Create: `packages/client/src/fx/events.ts`
- Test: `packages/client/src/fx/events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface FxCarView { readonly sessionId: string; readonly x: number; readonly y: number; readonly angle: number; readonly hp: number; readonly alive: boolean; readonly carId: string }`
  - `interface FxInstanceView { readonly id: string; readonly weaponId: string; readonly x: number; readonly y: number; readonly angle: number }`
  - `interface FxWorldView { readonly cars: readonly FxCarView[]; readonly instances: readonly FxInstanceView[] }`
  - `type FxEvent = { kind: "shotFired"; weaponId: string; x: number; y: number; angle: number } | { kind: "shotEnded"; weaponId: string; x: number; y: number; angle: number } | { kind: "damaged"; sessionId: string; x: number; y: number; amount: number } | { kind: "died"; sessionId: string; x: number; y: number }`
  - `deriveFxEvents(prev: FxWorldView | undefined, next: FxWorldView): FxEvent[]`

**Why a structural view rather than the schema types (VFX9–VFX12):** `fx/` never imports a schema class. `ArenaScene` adapts whatever it holds into `FxWorldView`. That keeps the modules testable with plain objects, and — the reason that matters — it means netcode phase 2 swapping the Colyseus schema for a binary snapshot changes the adapter and nothing in `fx/`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/fx/events.test.ts
import { describe, expect, it } from "vitest";
import { deriveFxEvents, type FxWorldView } from "./events.js";

const car = (sessionId: string, hp: number, alive = true) => ({
  sessionId,
  x: 100,
  y: 200,
  angle: 0,
  hp,
  alive,
  carId: "mirage",
});
const shot = (id: string, weaponId: string, x = 300, y = 400) => ({ id, weaponId, x, y, angle: 0.5 });
const view = (
  cars: FxWorldView["cars"],
  instances: FxWorldView["instances"] = [],
): FxWorldView => ({ cars, instances });

describe("deriveFxEvents", () => {
  it("reports nothing when nothing changed", () => {
    const v = view([car("a", 100)], [shot("s1", "thumper")]);
    expect(deriveFxEvents(v, v)).toEqual([]);
  });

  it("reports nothing on the very first view — there is no delta to read yet", () => {
    expect(deriveFxEvents(undefined, view([car("a", 100)], [shot("s1", "thumper")]))).toEqual([]);
  });

  it("fires a shotFired when an instance id appears", () => {
    const events = deriveFxEvents(view([car("a", 100)]), view([car("a", 100)], [shot("s1", "lance", 10, 20)]));
    expect(events).toEqual([{ kind: "shotFired", weaponId: "lance", x: 10, y: 20, angle: 0.5 }]);
  });

  it("fires a shotEnded at the instance's LAST KNOWN pose when its id leaves", () => {
    const events = deriveFxEvents(
      view([car("a", 100)], [shot("s1", "magmablast", 700, 800)]),
      view([car("a", 100)]),
    );
    // The pose comes from the previous view: the instance is gone from the next one, so there is
    // nowhere else to read it from (VFX12).
    expect(events).toEqual([{ kind: "shotEnded", weaponId: "magmablast", x: 700, y: 800, angle: 0.5 }]);
  });

  it("fires a damaged event carrying the amount when hp drops", () => {
    const events = deriveFxEvents(view([car("a", 100)]), view([car("a", 72)]));
    expect(events).toEqual([{ kind: "damaged", sessionId: "a", x: 100, y: 200, amount: 28 }]);
  });

  it("ignores hp going UP, so a repair pulse is not an impact", () => {
    expect(deriveFxEvents(view([car("a", 40)]), view([car("a", 90)]))).toEqual([]);
  });

  it("fires died when alive goes false, and no damaged alongside it", () => {
    const events = deriveFxEvents(view([car("a", 10)]), view([car("a", 0, false)]));
    expect(events).toEqual([{ kind: "died", sessionId: "a", x: 100, y: 200 }]);
  });

  it("ignores a car that was not in the previous view — a joiner is not a spawn effect", () => {
    expect(deriveFxEvents(view([]), view([car("b", 50)]))).toEqual([]);
  });

  it("ignores a car that left, so a disconnect does not read as a death", () => {
    expect(deriveFxEvents(view([car("a", 50)]), view([]))).toEqual([]);
  });

  it("reads several changes in one step", () => {
    const events = deriveFxEvents(
      view([car("a", 100), car("b", 100)], [shot("s1", "thumper")]),
      view([car("a", 80), car("b", 100)], [shot("s2", "lance")]),
    );
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind).sort()).toEqual(["damaged", "shotEnded", "shotFired"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- events`
Expected: FAIL — `Failed to resolve import "./events.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/fx/events.ts
/**
 * The FX event seam: what to spawn an effect for, derived by diffing two consecutive world views.
 *
 * **Nothing here goes on the wire (VFX9–VFX12).** Every event is recovered from state a client
 * already has, which keeps hard invariant 8 intact — `stepSim` reads none of it — and, the reason
 * that actually decides the design, means netcode phase 2 replacing the Colyseus schema with a
 * hand-packed binary snapshot cannot throw this work away. A schema field added here would be.
 *
 * The views are **structural**, not schema classes. `ArenaScene` adapts whatever it is holding into
 * `FxWorldView`, so this module is testable with plain objects and the adapter is the only thing
 * phase 2 touches.
 */

export interface FxCarView {
  readonly sessionId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly hp: number;
  readonly alive: boolean;
  readonly carId: string;
}

export interface FxInstanceView {
  readonly id: string;
  readonly weaponId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface FxWorldView {
  readonly cars: readonly FxCarView[];
  readonly instances: readonly FxInstanceView[];
}

export type FxEvent =
  | { kind: "shotFired"; weaponId: string; x: number; y: number; angle: number }
  | { kind: "shotEnded"; weaponId: string; x: number; y: number; angle: number }
  | { kind: "damaged"; sessionId: string; x: number; y: number; amount: number }
  | { kind: "died"; sessionId: string; x: number; y: number };

/**
 * Every effect worth firing between `prev` and `next`.
 *
 * A missing `prev` yields nothing rather than treating the whole world as new: the first view a
 * client sees would otherwise detonate every instance already in flight and spawn a muzzle flash
 * for each, which is exactly what a late joiner must not see.
 *
 * A car present in only one of the two views is skipped entirely. Joining is not a spawn effect and
 * leaving is not a death — a disconnect would otherwise blow up the car of whoever closed their
 * laptop.
 */
export function deriveFxEvents(prev: FxWorldView | undefined, next: FxWorldView): FxEvent[] {
  if (!prev) return [];
  const events: FxEvent[] = [];

  const prevInstances = new Map(prev.instances.map((i) => [i.id, i]));
  const nextInstances = new Map(next.instances.map((i) => [i.id, i]));

  for (const [id, instance] of nextInstances) {
    if (prevInstances.has(id)) continue;
    events.push({
      kind: "shotFired",
      weaponId: instance.weaponId,
      x: instance.x,
      y: instance.y,
      angle: instance.angle,
    });
  }
  for (const [id, instance] of prevInstances) {
    if (nextInstances.has(id)) continue;
    // The pose is the previous view's: the instance is not in the next one, so this is the last
    // place it was ever seen (VFX12).
    events.push({
      kind: "shotEnded",
      weaponId: instance.weaponId,
      x: instance.x,
      y: instance.y,
      angle: instance.angle,
    });
  }

  const prevCars = new Map(prev.cars.map((c) => [c.sessionId, c]));
  for (const car of next.cars) {
    const before = prevCars.get(car.sessionId);
    if (!before) continue;
    if (before.alive && !car.alive) {
      // A death subsumes its own killing blow: one event, not a damaged plus a died.
      events.push({ kind: "died", sessionId: car.sessionId, x: car.x, y: car.y });
      continue;
    }
    const lost = before.hp - car.hp;
    // Strictly greater than zero, so a repair pulse — hp going up — is never an impact.
    if (lost > 0) {
      events.push({ kind: "damaged", sessionId: car.sessionId, x: car.x, y: car.y, amount: lost });
    }
  }

  return events;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- events`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/events.ts packages/client/src/fx/events.test.ts
git commit -m "feat(fx): derive FX events from state deltas, no wire change (VFX9-VFX12)"
```

---

### Task 4: The `WEAPON_FX` table

**Files:**
- Create: `packages/client/src/fx/table.ts`
- Test: `packages/client/src/fx/table.test.ts`

**Interfaces:**
- Consumes: `WEAPON_TABLE`, `type WeaponId` from `@motor-combat-moba/shared`.
- Produces:
  - `type FxChannel = "smoke" | "fire" | "spark" | "debris"`
  - `interface FxBurst { readonly channel: FxChannel; readonly count: number; readonly speed: number; readonly lifeMs: number; readonly size: number; readonly growPerSec: number; readonly alpha: number; readonly soot: boolean; readonly coneRad: number }`
  - `interface WeaponFxRow { readonly muzzle: readonly FxBurst[]; readonly impact: readonly FxBurst[] }`
  - `WEAPON_FX: Partial<Record<WeaponId, WeaponFxRow>>`
  - `DEFAULT_WEAPON_FX: WeaponFxRow`
  - `weaponFxOf(weaponId: string): WeaponFxRow`

**Why client-side (VFX30):** `balanceStamp` hashes the shared tables **whole**, including purely visual fields — `WEAPON_TABLE.color` is the known example. A table in shared would make every effect tweak fail `scripts/manual-page.test.ts` and owe a `npm run build:manual`. Here, it owes nothing.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/fx/table.test.ts
import { describe, expect, it } from "vitest";
import { WEAPON_TABLE } from "@motor-combat-moba/shared";
import { DEFAULT_WEAPON_FX, WEAPON_FX, weaponFxOf } from "./table.js";

describe("WEAPON_FX", () => {
  it("only names weapons that exist, so a rename cannot leave a dead row", () => {
    const ids = new Set(Object.keys(WEAPON_TABLE));
    for (const id of Object.keys(WEAPON_FX)) expect(ids.has(id)).toBe(true);
  });

  it("falls back for a weapon with no row, so a new weapon still has effects", () => {
    expect(weaponFxOf("no-such-weapon")).toBe(DEFAULT_WEAPON_FX);
  });

  it("returns the authored row when there is one", () => {
    expect(weaponFxOf("magmablast")).toBe(WEAPON_FX.magmablast);
  });

  it("gives magmablast a four-channel detonation — it is the roster's one explosion", () => {
    const channels = new Set(WEAPON_FX.magmablast?.impact.map((b) => b.channel));
    expect(channels).toEqual(new Set(["fire", "smoke", "spark", "debris"]));
  });

  it("uses soot for explosion smoke and dust everywhere else (VFX7)", () => {
    const blast = WEAPON_FX.magmablast?.impact.find((b) => b.channel === "smoke");
    expect(blast?.soot).toBe(true);
    const muzzle = WEAPON_FX.magmablast?.muzzle.find((b) => b.channel === "smoke");
    expect(muzzle?.soot).toBe(false);
  });

  it("keeps every burst's numbers sane, so one bad row cannot flood the emitters", () => {
    const rows = [DEFAULT_WEAPON_FX, ...Object.values(WEAPON_FX)];
    for (const row of rows) {
      for (const burst of [...row.muzzle, ...row.impact]) {
        expect(burst.count).toBeGreaterThan(0);
        expect(burst.count).toBeLessThanOrEqual(80);
        expect(burst.lifeMs).toBeGreaterThan(0);
        expect(burst.alpha).toBeGreaterThan(0);
        expect(burst.alpha).toBeLessThanOrEqual(1);
        expect(burst.size).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- table`
Expected: FAIL — `Failed to resolve import "./table.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/fx/table.ts
import type { WeaponId } from "@motor-combat-moba/shared";

/**
 * How every weapon looks when it fires and when it lands.
 *
 * **Client-side on purpose (VFX30).** `balanceStamp` hashes the shared tables whole — including
 * purely visual fields, which is why changing `WEAPON_TABLE.color` fails the manual test — so a
 * table like this one living in shared would make every effect tweak owe a `npm run build:manual`
 * and a stamp update. Here it owes nothing: no playtest probe is invalidated, no balance number
 * moves, no doc falls out of date.
 */

/**
 * Which emitter a burst goes to.
 *
 * The channel IS the emitter. There are four emitters and each has its blend mode set once at
 * construction, because `packages/client/CLAUDE.md` warns that a per-instance `setBlendMode`
 * flushes the batch and turns one draw call into one per particle. Making the channel part of the
 * type is what makes per-particle blending unrepresentable rather than merely discouraged.
 */
export type FxChannel = "smoke" | "fire" | "spark" | "debris";

export interface FxBurst {
  readonly channel: FxChannel;
  readonly count: number;
  /** Peak launch speed, world units per second. Each particle takes a random fraction of it. */
  readonly speed: number;
  readonly lifeMs: number;
  readonly size: number;
  readonly growPerSec: number;
  readonly alpha: number;
  /** Smoke only: warm mid-grey soot rather than light dust (VFX7). Ignored on other channels. */
  readonly soot: boolean;
  /** Spread in radians. `Math.PI * 2` is an even sphere; a small cone aims along the event angle. */
  readonly coneRad: number;
}

export interface WeaponFxRow {
  readonly muzzle: readonly FxBurst[];
  readonly impact: readonly FxBurst[];
}

const TAU = Math.PI * 2;

/**
 * What a weapon with no authored row does. Deliberately modest: a new weapon should look
 * plausible on the day it lands and be authored properly later, never look like an explosion by
 * accident.
 */
export const DEFAULT_WEAPON_FX: WeaponFxRow = {
  muzzle: [
    { channel: "fire", count: 6, speed: 60, lifeMs: 160, size: 30, growPerSec: 14, alpha: 0.9, soot: false, coneRad: 0.9 },
    { channel: "spark", count: 10, speed: 280, lifeMs: 260, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: 0.8 },
  ],
  impact: [
    { channel: "spark", count: 14, speed: 250, lifeMs: 320, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
    { channel: "smoke", count: 5, speed: 40, lifeMs: 700, size: 22, growPerSec: 24, alpha: 0.24, soot: false, coneRad: TAU },
  ],
};

export const WEAPON_FX: Partial<Record<WeaponId, WeaponFxRow>> = {
  /** The roster's one explosion — the only row that spends all four channels (VFX6). */
  magmablast: {
    muzzle: [
      { channel: "fire", count: 8, speed: 70, lifeMs: 180, size: 34, growPerSec: 16, alpha: 0.9, soot: false, coneRad: 1 },
      { channel: "smoke", count: 6, speed: 34, lifeMs: 900, size: 26, growPerSec: 26, alpha: 0.3, soot: false, coneRad: 1.2 },
    ],
    impact: [
      { channel: "fire", count: 46, speed: 150, lifeMs: 500, size: 82, growPerSec: 20, alpha: 1, soot: false, coneRad: TAU },
      { channel: "smoke", count: 40, speed: 120, lifeMs: 3000, size: 78, growPerSec: 80, alpha: 0.72, soot: true, coneRad: TAU },
      { channel: "spark", count: 64, speed: 420, lifeMs: 800, size: 8, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
      { channel: "debris", count: 30, speed: 150, lifeMs: 900, size: 5, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
    ],
  },
  /** A heavy shell: muzzle smoke, and an impact that throws grit rather than fire. */
  thumper: {
    muzzle: [
      { channel: "fire", count: 10, speed: 60, lifeMs: 180, size: 34, growPerSec: 14, alpha: 0.95, soot: false, coneRad: 0.9 },
      { channel: "spark", count: 16, speed: 300, lifeMs: 300, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: 0.9 },
      { channel: "smoke", count: 7, speed: 34, lifeMs: 900, size: 26, growPerSec: 26, alpha: 0.3, soot: false, coneRad: 1.1 },
    ],
    impact: [
      { channel: "fire", count: 10, speed: 80, lifeMs: 300, size: 44, growPerSec: 18, alpha: 0.9, soot: false, coneRad: TAU },
      { channel: "spark", count: 22, speed: 280, lifeMs: 400, size: 6, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
      { channel: "debris", count: 10, speed: 130, lifeMs: 700, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
    ],
  },
  /** A beam: a bright muzzle and almost nothing at the far end. */
  lance: {
    muzzle: [
      { channel: "fire", count: 12, speed: 50, lifeMs: 140, size: 30, growPerSec: 10, alpha: 1, soot: false, coneRad: 0.7 },
      { channel: "spark", count: 18, speed: 320, lifeMs: 280, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: 0.6 },
    ],
    impact: [
      { channel: "spark", count: 12, speed: 240, lifeMs: 260, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
    ],
  },
  /** A missile: a smoky launch and a real detonation, one step down from magmablast. */
  predator: {
    muzzle: [
      { channel: "smoke", count: 10, speed: 40, lifeMs: 1100, size: 24, growPerSec: 28, alpha: 0.32, soot: false, coneRad: 1.3 },
      { channel: "fire", count: 8, speed: 66, lifeMs: 190, size: 30, growPerSec: 14, alpha: 0.9, soot: false, coneRad: 0.9 },
    ],
    impact: [
      { channel: "fire", count: 30, speed: 130, lifeMs: 430, size: 66, growPerSec: 18, alpha: 1, soot: false, coneRad: TAU },
      { channel: "smoke", count: 24, speed: 90, lifeMs: 2200, size: 60, growPerSec: 64, alpha: 0.6, soot: true, coneRad: TAU },
      { channel: "spark", count: 40, speed: 360, lifeMs: 620, size: 7, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
      { channel: "debris", count: 18, speed: 140, lifeMs: 800, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
    ],
  },
};

/** The row for a weapon, or the modest default. Never throws on an unknown id. */
export function weaponFxOf(weaponId: string): WeaponFxRow {
  return WEAPON_FX[weaponId as WeaponId] ?? DEFAULT_WEAPON_FX;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- table`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/table.ts packages/client/src/fx/table.test.ts
git commit -m "feat(fx): WEAPON_FX table, client-side so balanceStamp never sees it (VFX30)"
```

---

### Task 5: Emitter specs

**Files:**
- Create: `packages/client/src/fx/emitters.ts`
- Test: `packages/client/src/fx/emitters.test.ts`

**Interfaces:**
- Consumes: `FxEvent` from `./events.js`; `FxBurst`, `FxChannel`, `weaponFxOf` from `./table.js`.
- Produces:
  - `interface EmitterSpec { readonly channel: FxChannel; readonly x: number; readonly y: number; readonly angle: number; readonly burst: FxBurst }`
  - `emitterSpecsFor(event: FxEvent): EmitterSpec[]`
  - `emitterSpecsForAll(events: readonly FxEvent[]): EmitterSpec[]`
  - `DAMAGE_SPARK_SCALE: number` — sparks per hp lost.
  - `MAX_SPECS_PER_FRAME: number`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/fx/emitters.test.ts
import { describe, expect, it } from "vitest";
import { emitterSpecsFor, emitterSpecsForAll, MAX_SPECS_PER_FRAME } from "./emitters.js";
import { WEAPON_FX } from "./table.js";

describe("emitterSpecsFor", () => {
  it("turns a shotFired into that weapon's muzzle bursts, at the event pose", () => {
    const specs = emitterSpecsFor({ kind: "shotFired", weaponId: "lance", x: 5, y: 6, angle: 1.2 });
    expect(specs).toHaveLength(WEAPON_FX.lance!.muzzle.length);
    for (const spec of specs) {
      expect(spec.x).toBe(5);
      expect(spec.y).toBe(6);
      expect(spec.angle).toBe(1.2);
    }
  });

  it("turns a shotEnded into that weapon's impact bursts", () => {
    const specs = emitterSpecsFor({ kind: "shotEnded", weaponId: "magmablast", x: 9, y: 9, angle: 0 });
    expect(specs.map((s) => s.channel).sort()).toEqual(["debris", "fire", "smoke", "spark"]);
  });

  it("uses the default row for an unauthored weapon rather than emitting nothing", () => {
    expect(emitterSpecsFor({ kind: "shotFired", weaponId: "tremor", x: 0, y: 0, angle: 0 }).length)
      .toBeGreaterThan(0);
  });

  it("scales a damaged event's sparks with the hp actually lost", () => {
    const light = emitterSpecsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 4 });
    const heavy = emitterSpecsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 40 });
    expect(heavy[0].burst.count).toBeGreaterThan(light[0].burst.count);
  });

  it("always emits at least one spark for a scratch, so a hit is never silent", () => {
    const specs = emitterSpecsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 0.5 });
    expect(specs[0].burst.count).toBeGreaterThanOrEqual(1);
  });

  it("gives a death fire, soot and debris — bigger than any single hit", () => {
    const specs = emitterSpecsFor({ kind: "died", sessionId: "a", x: 0, y: 0 });
    const channels = specs.map((s) => s.channel);
    expect(channels).toContain("fire");
    expect(channels).toContain("smoke");
    expect(channels).toContain("debris");
    expect(specs.find((s) => s.channel === "smoke")?.burst.soot).toBe(true);
  });
});

describe("emitterSpecsForAll", () => {
  it("flattens every event's specs", () => {
    const specs = emitterSpecsForAll([
      { kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 },
      { kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 },
    ]);
    expect(specs).toHaveLength(WEAPON_FX.lance!.muzzle.length * 2);
  });

  it("caps the frame, so a pile-up degrades instead of stalling the renderer", () => {
    const many = Array.from({ length: 400 }, () => ({
      kind: "shotEnded" as const,
      weaponId: "magmablast",
      x: 0,
      y: 0,
      angle: 0,
    }));
    expect(emitterSpecsForAll(many).length).toBeLessThanOrEqual(MAX_SPECS_PER_FRAME);
  });

  it("keeps the EARLIEST specs when it caps, so the first explosion is the one you see", () => {
    const specs = emitterSpecsForAll([
      { kind: "shotFired", weaponId: "lance", x: 111, y: 0, angle: 0 },
      ...Array.from({ length: 400 }, () => ({
        kind: "shotEnded" as const,
        weaponId: "magmablast",
        x: 0,
        y: 0,
        angle: 0,
      })),
    ]);
    expect(specs[0].x).toBe(111);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- emitters`
Expected: FAIL — `Failed to resolve import "./emitters.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/fx/emitters.ts
import type { FxEvent } from "./events.js";
import { weaponFxOf, type FxBurst, type FxChannel } from "./table.js";

/** One burst, placed in the world. The unit `fx/layer.ts` consumes. */
export interface EmitterSpec {
  readonly channel: FxChannel;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly burst: FxBurst;
}

/** Sparks per point of hp lost. */
export const DAMAGE_SPARK_SCALE = 0.5;

/**
 * The most specs one frame may produce.
 *
 * A cap, not a budget guess: six cars detonating on the same tick would otherwise queue thousands
 * of particles and stall a frame. Degrading — dropping the tail — is always better than a hitch,
 * and the earliest specs are kept so the first explosion is the one the player sees.
 */
export const MAX_SPECS_PER_FRAME = 64;

const TAU = Math.PI * 2;

/** An impact spatter whose size follows the damage. */
function damageBursts(amount: number): FxBurst[] {
  return [
    {
      channel: "spark",
      // At least one: a scratch that produces nothing reads as a hit that did not register.
      count: Math.max(1, Math.min(30, Math.round(amount * DAMAGE_SPARK_SCALE))),
      speed: 240,
      lifeMs: 300,
      size: 5,
      growPerSec: -3,
      alpha: 1,
      soot: false,
      coneRad: TAU,
    },
  ];
}

/** A death. Bigger than any single hit, and the only non-weapon source of soot. */
function deathBursts(): FxBurst[] {
  return [
    { channel: "fire", count: 26, speed: 120, lifeMs: 460, size: 60, growPerSec: 18, alpha: 1, soot: false, coneRad: TAU },
    { channel: "smoke", count: 26, speed: 90, lifeMs: 2600, size: 64, growPerSec: 70, alpha: 0.66, soot: true, coneRad: TAU },
    { channel: "spark", count: 34, speed: 340, lifeMs: 620, size: 7, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
    { channel: "debris", count: 20, speed: 150, lifeMs: 900, size: 5, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
  ];
}

/** Every burst one event asks for, placed at its pose. */
export function emitterSpecsFor(event: FxEvent): EmitterSpec[] {
  const place = (bursts: readonly FxBurst[], angle: number): EmitterSpec[] =>
    bursts.map((burst) => ({ channel: burst.channel, x: event.x, y: event.y, angle, burst }));

  switch (event.kind) {
    case "shotFired":
      return place(weaponFxOf(event.weaponId).muzzle, event.angle);
    case "shotEnded":
      return place(weaponFxOf(event.weaponId).impact, event.angle);
    case "damaged":
      return place(damageBursts(event.amount), 0);
    case "died":
      return place(deathBursts(), 0);
  }
}

/** Every event's specs, flattened and capped at `MAX_SPECS_PER_FRAME`. */
export function emitterSpecsForAll(events: readonly FxEvent[]): EmitterSpec[] {
  const specs: EmitterSpec[] = [];
  for (const event of events) {
    for (const spec of emitterSpecsFor(event)) {
      if (specs.length >= MAX_SPECS_PER_FRAME) return specs;
      specs.push(spec);
    }
  }
  return specs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- emitters`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/emitters.ts packages/client/src/fx/emitters.test.ts
git commit -m "feat(fx): event to emitter-spec mapping, capped per frame"
```

---

### Task 6: Decals

**Files:**
- Create: `packages/client/src/fx/decals.ts`
- Test: `packages/client/src/fx/decals.test.ts`

**Interfaces:**
- Consumes: `FxEvent` from `./events.js`.
- Produces:
  - `interface DecalStamp { readonly kind: "scorch"; readonly x: number; readonly y: number; readonly scale: number; readonly alpha: number }`
  - `interface TyreMark { readonly x: number; readonly y: number; readonly radius: number; readonly alpha: number }`
  - `decalStampsFor(event: FxEvent): DecalStamp[]`
  - `tyreMarksFor(pose: { x: number; y: number; angle: number }, speed: number): TyreMark[]`
  - `decalFadeAlpha(ageMs: number): number` — **age**, not a frame delta.
  - `DECAL_HALF_LIFE_MS: number`, `MAX_DECALS: number`, `TYRE_MARK_INTERVAL_MS: number`, `TYRE_MARK_SPEED_FLOOR: number`, `TYRE_TRACK_HALF_WIDTH: number`

**Why age and not a per-frame erase:** the obvious design fades the layer in place each frame, but Phaser 4's `erase()` takes no alpha, so a *partial* erase is not expressible. Decals are therefore a **capped ring buffer redrawn each frame** with an alpha derived from each entry's age — `clear()`, stamp the live entries, `render()`. Every call in that sequence is documented, the fade is exact rather than an accumulation of rounding, and the cost is bounded by `MAX_DECALS` instead of by how long the match has run.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/fx/decals.test.ts
import { describe, expect, it } from "vitest";
import {
  decalFadeAlpha,
  decalStampsFor,
  DECAL_HALF_LIFE_MS,
  TYRE_MARK_SPEED_FLOOR,
  tyreMarksFor,
} from "./decals.js";

describe("decalStampsFor", () => {
  it("scorches the ground where a shot ended", () => {
    const stamps = decalStampsFor({ kind: "shotEnded", weaponId: "magmablast", x: 40, y: 50, angle: 0 });
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toMatchObject({ kind: "scorch", x: 40, y: 50 });
  });

  it("scorches harder for an explosion than for a beam's far end", () => {
    const blast = decalStampsFor({ kind: "shotEnded", weaponId: "magmablast", x: 0, y: 0, angle: 0 });
    const beam = decalStampsFor({ kind: "shotEnded", weaponId: "lance", x: 0, y: 0, angle: 0 });
    expect(blast[0].scale).toBeGreaterThan(beam[0].scale);
  });

  it("scorches a death site", () => {
    expect(decalStampsFor({ kind: "died", sessionId: "a", x: 1, y: 2 })).toHaveLength(1);
  });

  it("leaves nothing for a muzzle flash or a scratch — the floor would fill with noise", () => {
    expect(decalStampsFor({ kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 })).toEqual([]);
    expect(decalStampsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 9 })).toEqual([]);
  });
});

describe("tyreMarksFor", () => {
  it("lays two marks, one per side of the car", () => {
    const marks = tyreMarksFor({ x: 100, y: 100, angle: 0 }, 200);
    expect(marks).toHaveLength(2);
    // Angle 0 means facing +x, so the two tracks straddle the car in y.
    expect(marks[0].y).not.toBe(marks[1].y);
    expect(marks[0].x).toBeCloseTo(100, 6);
  });

  it("puts the marks perpendicular to the heading, so they turn with the car", () => {
    const marks = tyreMarksFor({ x: 0, y: 0, angle: Math.PI / 2 }, 200);
    // Facing +y now, so the tracks straddle in x instead.
    expect(marks[0].x).not.toBe(marks[1].x);
    expect(marks[0].y).toBeCloseTo(0, 6);
  });

  it("lays nothing below the speed floor, so a parked car does not burn a hole", () => {
    expect(tyreMarksFor({ x: 0, y: 0, angle: 0 }, TYRE_MARK_SPEED_FLOOR - 1)).toEqual([]);
  });

  it("keeps a mark light but individually visible", () => {
    // Each mark is stamped ONCE per frame from the ring buffer, so unlike an accumulating layer it
    // has to read on its own — but a trail must still say rubber rather than ink.
    for (const mark of tyreMarksFor({ x: 0, y: 0, angle: 0 }, 300)) {
      expect(mark.alpha).toBeGreaterThan(0.05);
      expect(mark.alpha).toBeLessThan(0.35);
    }
  });
});

describe("decalFadeAlpha", () => {
  it("is fully opaque the moment it is laid", () => {
    expect(decalFadeAlpha(0)).toBe(1);
  });

  it("is half faded after one half-life", () => {
    expect(decalFadeAlpha(DECAL_HALF_LIFE_MS)).toBeCloseTo(0.5, 5);
  });

  it("decays monotonically", () => {
    expect(decalFadeAlpha(1000)).toBeGreaterThan(decalFadeAlpha(2000));
  });

  it("reaches zero rather than lingering forever at a hair above it", () => {
    expect(decalFadeAlpha(10 * 60 * 1000)).toBe(0);
  });

  it("never returns a negative alpha for a nonsense age", () => {
    expect(decalFadeAlpha(-500)).toBeLessThanOrEqual(1);
    expect(decalFadeAlpha(-500)).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- decals`
Expected: FAIL — `Failed to resolve import "./decals.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/fx/decals.ts
import { DRIVE_CONFIG } from "@motor-combat-moba/shared";
import type { FxEvent } from "./events.js";

/** A stain to stamp into the decal layer. */
export interface DecalStamp {
  readonly kind: "scorch";
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly alpha: number;
}

/** A dab of rubber. Two per car per frame, laid so faintly that only a sustained line shows. */
export interface TyreMark {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
}

/**
 * How long a decal takes to lose half its alpha.
 *
 * Decals **must** fade. Rubber that never lifts turns the floor black over a match — measured at
 * roughly twenty seconds in the spike before this was added. Forty seconds is long enough that a
 * fight leaves a readable history and short enough that the arena recovers.
 */
export const DECAL_HALF_LIFE_MS = 40_000;

/**
 * The most decals held at once. Older ones are dropped.
 *
 * This is a hard bound on the decal layer's per-frame cost: it is redrawn from scratch each frame
 * (Phaser 4's `erase` takes no alpha, so an in-place partial fade is not expressible), which makes
 * the cost proportional to this number rather than to how long the match has run.
 */
export const MAX_DECALS = 600;

/**
 * How often one car lays rubber.
 *
 * Per interval rather than per frame, so the trail is the same length at 30fps and 144fps — and so
 * `MAX_DECALS` buys a predictable number of seconds of history rather than a number that collapses
 * on a fast machine.
 */
export const TYRE_MARK_INTERVAL_MS = 50;

/** Below this speed a car lays no rubber, or a parked car burns a hole in the floor. */
export const TYRE_MARK_SPEED_FLOOR = 40;

/** Half the distance between the two tracks, across the car. */
export const TYRE_TRACK_HALF_WIDTH = DRIVE_CONFIG.carHeight / 3;

const SCORCH_SCALE: Record<string, number> = {
  magmablast: 1.25,
  predator: 1.0,
  thumper: 0.5,
};

/**
 * The stains one event leaves.
 *
 * Only a shot ending and a death mark the ground. A muzzle flash and an ordinary hit deliberately
 * leave nothing: they happen constantly, and a floor that records every one of them is noise rather
 * than history.
 */
export function decalStampsFor(event: FxEvent): DecalStamp[] {
  if (event.kind === "shotEnded") {
    return [
      {
        kind: "scorch",
        x: event.x,
        y: event.y,
        scale: SCORCH_SCALE[event.weaponId] ?? 0.35,
        alpha: 0.55,
      },
    ];
  }
  if (event.kind === "died") {
    return [{ kind: "scorch", x: event.x, y: event.y, scale: 1.4, alpha: 0.7 }];
  }
  return [];
}

/**
 * The rubber a car lays this frame.
 *
 * Perpendicular to the heading so the tracks turn with the chassis. Each mark is stamped once per
 * frame from the ring buffer, so it must read on its own — but light, because marks laid every
 * `TYRE_MARK_INTERVAL_MS` overlap heavily along the path and a heavy value draws in ink. The spike's
 * first cut ran an accumulating layer at 0.05 and the mirage drew in permanent marker.
 */
export function tyreMarksFor(
  pose: { x: number; y: number; angle: number },
  speed: number,
): TyreMark[] {
  if (speed < TYRE_MARK_SPEED_FLOOR) return [];
  const px = -Math.sin(pose.angle);
  const py = Math.cos(pose.angle);
  const d = TYRE_TRACK_HALF_WIDTH;
  return [
    { x: pose.x + px * d, y: pose.y + py * d, radius: 2.7, alpha: 0.18 },
    { x: pose.x - px * d, y: pose.y - py * d, radius: 2.7, alpha: 0.18 },
  ];
}

/**
 * The alpha a decal is drawn at, given how long ago it was laid. `1` when fresh, `0` once spent.
 *
 * Age rather than a frame delta, because the layer is redrawn from its ring buffer each frame
 * rather than faded in place — Phaser 4's `erase` takes no alpha, so a partial in-place fade is not
 * expressible. Redrawing also makes the curve exact instead of an accumulation of per-frame
 * rounding, and makes the result independent of frame rate.
 */
export function decalFadeAlpha(ageMs: number): number {
  if (ageMs <= 0) return 1;
  const alpha = Math.pow(0.5, ageMs / DECAL_HALF_LIFE_MS);
  // Snap the long tail to zero rather than leaving thousands of invisible decals in the buffer
  // crowding out live ones.
  return alpha < 0.02 ? 0 : alpha;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- decals`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/decals.ts packages/client/src/fx/decals.test.ts
git commit -m "feat(fx): decal stamps, tyre marks and the fade that keeps the floor from going black"
```

---

### Task 7: Occlusion stamps

**Files:**
- Create: `packages/client/src/fx/occlusion.ts`
- Test: `packages/client/src/fx/occlusion.test.ts`

**Interfaces:**
- Consumes: `FxCarView` from `./events.js`; `DRIVE_CONFIG` from `@motor-combat-moba/shared`.
- Produces:
  - `interface EraserStamp { readonly x: number; readonly y: number; readonly angle: number; readonly width: number; readonly height: number; readonly carId: string }`
  - `eraserStampsFor(cars: readonly FxCarView[]): EraserStamp[]`
  - `ERASER_HALO: number`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/fx/occlusion.test.ts
import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "@motor-combat-moba/shared";
import { ERASER_HALO, eraserStampsFor } from "./occlusion.js";

const car = (sessionId: string, alive = true) => ({
  sessionId,
  x: 300,
  y: 400,
  angle: 0.7,
  hp: 50,
  alive,
  carId: "bastion",
});

describe("eraserStampsFor", () => {
  it("stamps once per living car, at its pose", () => {
    const stamps = eraserStampsFor([car("a"), car("b")]);
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toMatchObject({ x: 300, y: 400, angle: 0.7, carId: "bastion" });
  });

  it("stamps BIGGER than the hull, so the halo clears the car rather than tracing it", () => {
    const [stamp] = eraserStampsFor([car("a")]);
    expect(stamp.width).toBeGreaterThan(DRIVE_CONFIG.carWidth);
    expect(stamp.height).toBeGreaterThan(DRIVE_CONFIG.carHeight);
    expect(stamp.width).toBe(DRIVE_CONFIG.carWidth + ERASER_HALO * 2);
  });

  it("skips a dead car — a wreck is gone, and smoke should close over where it was", () => {
    expect(eraserStampsFor([car("a", false)])).toEqual([]);
  });

  it("returns nothing for an empty field rather than throwing", () => {
    expect(eraserStampsFor([])).toEqual([]);
  });

  it("keeps each car's own carId, so the mask uses that chassis's silhouette", () => {
    const stamps = eraserStampsFor([{ ...car("a"), carId: "mirage" }, { ...car("b"), carId: "bullseye" }]);
    expect(stamps.map((s) => s.carId)).toEqual(["mirage", "bullseye"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- occlusion`
Expected: FAIL — `Failed to resolve import "./occlusion.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/fx/occlusion.ts
import { DRIVE_CONFIG } from "@motor-combat-moba/shared";
import type { FxCarView } from "./events.js";

/**
 * Where to punch a hole in the smoke layer so a car stays visible inside a cloud (VFX18–VFX22).
 *
 * Smoke must never hide a car. In a last-player-standing game, losing sight of an opponent to your
 * own weapon effect costs information the player needs to play, and it is reported as a bug — so
 * this is a gameplay constraint wearing an art costume.
 *
 * The stamp is the car's **sprite-alpha silhouette**, blurred once at boot per chassis by
 * `fx/layer.ts` and erased from the smoke `RenderTexture` each frame. That keeps the smoke at full
 * thickness everywhere except a soft halo around each car, rather than fading whole puffs (which
 * reads as timid smoke) or ordering cars above smoke (which removes every interaction between the
 * two).
 */
export interface EraserStamp {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly width: number;
  readonly height: number;
  /** Which chassis's silhouette to erase with. */
  readonly carId: string;
}

/**
 * How far past the hull the erased halo reaches, in world units.
 *
 * Bigger than the hull on purpose: a stamp exactly the car's size traces its outline in smoke and
 * reads as a sticker. The halo has to clear the car for the hole to look like the car is displacing
 * the cloud.
 */
export const ERASER_HALO = 6;

/**
 * One stamp per living car.
 *
 * Dead cars are skipped: a wreck is intangible from the tick it dies and fades out entirely, so the
 * smoke should close over where it was rather than hold a hole open around a car that is gone.
 */
export function eraserStampsFor(cars: readonly FxCarView[]): EraserStamp[] {
  const stamps: EraserStamp[] = [];
  for (const car of cars) {
    if (!car.alive) continue;
    stamps.push({
      x: car.x,
      y: car.y,
      angle: car.angle,
      width: DRIVE_CONFIG.carWidth + ERASER_HALO * 2,
      height: DRIVE_CONFIG.carHeight + ERASER_HALO * 2,
      carId: car.carId,
    });
  }
  return stamps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- occlusion`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/occlusion.ts packages/client/src/fx/occlusion.test.ts
git commit -m "feat(fx): eraser stamps so smoke never hides a car (VFX18-VFX22)"
```

---

### Task 8: Depth constants

**Files:**
- Create: `packages/client/src/fx/depths.ts`
- Test: `packages/client/src/fx/depths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DECAL_DEPTH = -8`, `GROUND_FX_DEPTH = -6`, `AIR_FX_DEPTH = 10`, and `FLOOR_DEPTH = -11`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/fx/depths.test.ts
import { describe, expect, it } from "vitest";
import { AIR_FX_DEPTH, DECAL_DEPTH, FLOOR_DEPTH, GROUND_FX_DEPTH } from "./depths.js";

// Mirrors the ladder in ArenaScene.ts. Duplicated as literals on purpose: if someone moves one of
// those constants, this test is what says the FX layers moved with it or need to.
const ARENA_DEPTH = -10;
const SHOT_DEPTH = -5;
const CAR_DEPTH = 0;
const MANEUVER_DEPTH = 2;
const ARROW_DEPTH = 52;
const HP_BAR_DEPTH = 60;

describe("fx depth constants", () => {
  it("puts the generated floor beneath the arena's own graphics", () => {
    expect(FLOOR_DEPTH).toBeLessThan(ARENA_DEPTH);
  });

  it("puts decals above the arena and below the shots", () => {
    expect(DECAL_DEPTH).toBeGreaterThan(ARENA_DEPTH);
    expect(DECAL_DEPTH).toBeLessThan(SHOT_DEPTH);
  });

  it("puts ground FX above decals and still below the shots", () => {
    expect(GROUND_FX_DEPTH).toBeGreaterThan(DECAL_DEPTH);
    expect(GROUND_FX_DEPTH).toBeLessThan(SHOT_DEPTH);
  });

  it("puts air FX above the cars, because smoke is in the air", () => {
    expect(AIR_FX_DEPTH).toBeGreaterThan(CAR_DEPTH);
    expect(AIR_FX_DEPTH).toBeGreaterThan(MANEUVER_DEPTH);
  });

  it("keeps air FX BELOW every HUD marker (VFX24) — the second readability guarantee", () => {
    // A car inside a smoke cloud keeps its hp bar, lock bracket and off-screen arrow. The eraser
    // mask keeps the car readable; this keeps its information readable regardless of how that mask
    // is later tuned.
    expect(AIR_FX_DEPTH).toBeLessThan(ARROW_DEPTH);
    expect(AIR_FX_DEPTH).toBeLessThan(HP_BAR_DEPTH);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- depths`
Expected: FAIL — `Failed to resolve import "./depths.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/fx/depths.ts
/**
 * Where the FX layers sit in `ArenaScene`'s depth ladder (VFX23).
 *
 * The existing rungs are `ARENA -10`, `SHOT -5`, `CAR 0`, `MANEUVER 2`, `ARROW 52`, `LOCK 55`,
 * `HP_BAR 60`, `HUD 1000`. These four slot between them, and `depths.test.ts` holds the ordering.
 */

/**
 * The generated asphalt, beneath the arena's own obstacle and border graphics.
 *
 * Below `ARENA_DEPTH` rather than replacing it: the floor becomes a real object so it can carry a
 * texture at all, and the existing `drawArena` pass keeps drawing obstacles and the border on top.
 */
export const FLOOR_DEPTH = -11;

/** Rubber and scorch. Above the floor, below anything that moves. */
export const DECAL_DEPTH = -8;

/** Debris and ground sparks — on the deck rather than in the air. */
export const GROUND_FX_DEPTH = -6;

/**
 * Smoke and fire. Above the cars, because it is in the air.
 *
 * Deliberately far below `ARROW_DEPTH` (52): hp bars, lock brackets and off-screen arrows draw over
 * smoke, so a car inside a cloud keeps its information even if the eraser mask is later softened
 * (VFX24).
 */
export const AIR_FX_DEPTH = 10;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- depths`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/depths.ts packages/client/src/fx/depths.test.ts
git commit -m "feat(fx): depth constants, with the HUD kept above smoke (VFX23-VFX24)"
```

---

### Task 9: `FxLayer` — textures, emitters, first pixels

**Files:**
- Create: `packages/client/src/fx/layer.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` — import `FxLayer`, construct it in `create`, spread `displayObjects()` into `splitCameras`'s `worldObjects`, call it from `update`.

**Interfaces:**
- Consumes: `TexturePixels` and the generators from `./textures.js`; `EmitterSpec` from `./emitters.js`; `deriveFxEvents`, `FxWorldView` from `./events.js`; `emitterSpecsForAll` from `./emitters.js`; the depth constants from `./depths.js`.
- Produces:
  - `class FxLayer` with `constructor(scene: Phaser.Scene, seed: number)`, `displayObjects(): Phaser.GameObjects.GameObject[]`, `spawn(specs: readonly EmitterSpec[]): void`, `update(view: FxWorldView, dtMs: number): void`, `destroy(): void`.
  - `FX_TEXTURE_KEYS`: `{ dustA, dustB, sootA, sootB, fireA, fireB, spark, scorch, asphalt }` — the Phaser texture keys.

**This is the only file in `fx/` that imports Phaser, and it has no test** (Global Constraints). Keep it thin: it holds no decisions, only wiring.

- [ ] **Step 1: Write the texture-upload helper and the emitters**

```ts
// packages/client/src/fx/layer.ts
import Phaser from "phaser";
import { AIR_FX_DEPTH, GROUND_FX_DEPTH } from "./depths.js";
import { deriveFxEvents, type FxWorldView } from "./events.js";
import { emitterSpecsForAll, type EmitterSpec } from "./emitters.js";
import {
  asphaltTexture,
  DUST_A,
  DUST_B,
  fireTexture,
  puffTexture,
  scorchTexture,
  SOOT_A,
  SOOT_B,
  sparkTexture,
  type TexturePixels,
} from "./textures.js";

/** Phaser texture keys for the generated set. Namespaced so nothing collides with the manifest. */
export const FX_TEXTURE_KEYS = {
  dustA: "fx.dust.a",
  dustB: "fx.dust.b",
  sootA: "fx.soot.a",
  sootB: "fx.soot.b",
  fireA: "fx.fire.a",
  fireB: "fx.fire.b",
  spark: "fx.spark",
  scorch: "fx.scorch",
  asphalt: "fx.asphalt",
} as const;

/**
 * The Phaser half of the FX system, and the only part of `fx/` that touches the renderer.
 *
 * It holds **no decisions** — what to spawn, where, how big and for how long are all answered by
 * the pure modules beside it, which are unit-tested in vitest's node environment. This file is
 * wiring, and is kept thin enough to review by eye because no test can load it.
 */
export class FxLayer {
  private readonly scene: Phaser.Scene;
  private prevView: FxWorldView | undefined;
  /**
   * One emitter per channel, each with its blend mode set ONCE here.
   *
   * `packages/client/CLAUDE.md`: *"Stop and warn before a per-instance `setBlendMode` (flushes the
   * batch — one draw call becomes one per shot)."* Grouping by channel is what keeps this to four
   * batches however many particles are alive.
   */
  private readonly emitters: Record<string, Phaser.GameObjects.Particles.ParticleEmitter>;

  constructor(scene: Phaser.Scene, seed: number) {
    this.scene = scene;
    this.uploadTextures(seed);

    const air = (key: string, additive: boolean) =>
      scene.add
        .particles(0, 0, key, { emitting: false })
        .setDepth(AIR_FX_DEPTH)
        .setBlendMode(additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);

    this.emitters = {
      smoke: air(FX_TEXTURE_KEYS.dustA, false),
      fire: air(FX_TEXTURE_KEYS.fireA, true),
      spark: scene.add
        .particles(0, 0, FX_TEXTURE_KEYS.spark, { emitting: false })
        .setDepth(GROUND_FX_DEPTH)
        .setBlendMode(Phaser.BlendModes.ADD),
      debris: scene.add
        .particles(0, 0, FX_TEXTURE_KEYS.spark, { emitting: false })
        .setDepth(GROUND_FX_DEPTH)
        .setBlendMode(Phaser.BlendModes.NORMAL),
    };
  }

  /** Turn generated pixel data into Phaser textures. The one place `fx/` needs a DOM canvas. */
  private uploadTextures(seed: number): void {
    const add = (key: string, tex: TexturePixels): void => {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      const canvasTexture = this.scene.textures.createCanvas(key, tex.width, tex.height);
      if (!canvasTexture) return;
      const ctx = canvasTexture.getContext();
      const image = ctx.createImageData(tex.width, tex.height);
      image.data.set(tex.data);
      ctx.putImageData(image, 0, 0);
      canvasTexture.refresh();
    };

    add(FX_TEXTURE_KEYS.dustA, puffTexture(seed, DUST_A));
    add(FX_TEXTURE_KEYS.dustB, puffTexture(seed + 404, DUST_B));
    add(FX_TEXTURE_KEYS.sootA, puffTexture(seed + 808, SOOT_A));
    add(FX_TEXTURE_KEYS.sootB, puffTexture(seed + 912, SOOT_B));
    add(FX_TEXTURE_KEYS.fireA, fireTexture(seed));
    add(FX_TEXTURE_KEYS.fireB, fireTexture(seed + 77));
    add(FX_TEXTURE_KEYS.spark, sparkTexture());
    add(FX_TEXTURE_KEYS.scorch, scorchTexture(seed));
    add(FX_TEXTURE_KEYS.asphalt, asphaltTexture(seed));
  }

  /**
   * Every object this layer puts in the scene.
   *
   * One accessor rather than one registration per emitter, because `splitCameras` requires every
   * display object to be ignored by exactly one camera — ignored by neither and it draws twice,
   * ignored by both and it vanishes (VFX25). One list is one place to get that right.
   */
  displayObjects(): Phaser.GameObjects.GameObject[] {
    return Object.values(this.emitters);
  }

  /** Fire one frame's worth of bursts. */
  spawn(specs: readonly EmitterSpec[]): void {
    for (const spec of specs) {
      const emitter = this.emitters[spec.channel];
      if (!emitter) continue;
      const { burst } = spec;
      const texture =
        spec.channel === "smoke"
          ? burst.soot
            ? FX_TEXTURE_KEYS.sootA
            : FX_TEXTURE_KEYS.dustA
          : undefined;
      if (texture) emitter.setTexture(texture);
      emitter.setParticleLifespan(burst.lifeMs);
      emitter.setParticleAlpha({ start: burst.alpha, end: 0 });
      emitter.setParticleSpeed(burst.speed * 0.25, burst.speed);
      emitter.setParticleScale(
        burst.size / 128,
        (burst.size + (burst.growPerSec * burst.lifeMs) / 1000) / 128,
      );
      emitter.setEmitterAngle({
        min: Phaser.Math.RadToDeg(spec.angle - burst.coneRad / 2),
        max: Phaser.Math.RadToDeg(spec.angle + burst.coneRad / 2),
      });
      emitter.emitParticleAt(spec.x, spec.y, burst.count);
    }
  }

  /** One frame: derive events from the view delta and spawn what they ask for. */
  update(view: FxWorldView, _dtMs: number): void {
    this.spawn(emitterSpecsForAll(deriveFxEvents(this.prevView, view)));
    this.prevView = view;
  }

  destroy(): void {
    for (const emitter of Object.values(this.emitters)) emitter.destroy();
  }
}
```

- [ ] **Step 2: Wire it into `ArenaScene`**

Four edits, all small.

Add the import beside the other scene-local imports:

```ts
import { FxLayer } from "../fx/layer.js";
```

Add the field beside `private impacts: ImpactTracker = newImpactTracker();`:

```ts
  /** The FX system. Null until `create` runs, and destroyed on shutdown with the rest of the scene. */
  private fx: FxLayer | undefined;
```

Construct it in `create`, immediately after `this.drawArena(this.arena);`:

```ts
    // Seeded per match so two players in the same room see the same textures, and a new match
    // re-rolls them. `arenaId` alone would freeze the seed forever.
    this.fx = new FxLayer(this, this.arena.width * 31 + this.arena.height);
```

Register with the cameras — inside `splitCameras`, add to the `worldObjects` array, after `...(this.maneuverGfx ? [this.maneuverGfx] : []),`:

```ts
      // Every FX object in one spread, because this list is the only thing standing between an
      // emitter and drawing twice across the gutter (VFX25).
      ...(this.fx ? this.fx.displayObjects() : []),
```

- [ ] **Step 3: Call it from `update`**

In `ArenaScene.update`, immediately after `this.renderShots(room);` and before the `panelHeight` line:

```ts
    this.renderFx(room, delta);
```

And add the method beside `renderShots`:

```ts
  /**
   * One FX frame. Adapts whatever the room is holding into the structural `FxWorldView` that `fx/`
   * consumes, so nothing in `fx/` imports a schema class — which is what lets netcode phase 2 swap
   * the schema for a binary snapshot by changing this method and nothing else (VFX11).
   */
  private renderFx(room: Room<ArenaState>, delta: number): void {
    if (!this.fx) return;
    const cars = [...room.state.players.entries()]
      .filter(([, player]) => player.status === PlayerStatus.IN_MATCH)
      .map(([sessionId, player]) => ({
        sessionId,
        x: player.x,
        y: player.y,
        angle: player.angle,
        hp: player.hp,
        alive: player.alive,
        carId: player.carId,
      }));
    const instances = [...room.state.weapons.entries()].map(([id, instance]) => ({
      id,
      weaponId: instance.weaponId,
      x: instance.x,
      y: instance.y,
      angle: instance.angle,
    }));
    this.fx.update({ cars, instances }, delta);
  }
```

Destroy it in `onShutdown`, beside the other teardown:

```ts
    this.fx?.destroy();
    this.fx = undefined;
```

- [ ] **Step 4: Verify by eye in the running game**

Run: `npm run dev`, open `http://localhost:5173`, start a practice match, and fire each weapon.
Expected: muzzle flashes and impact sparks appear; nothing draws twice; the weapon gutter down the right stays clear of particles. If particles appear over the gutter, the `splitCameras` registration in Step 2 was missed.

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/layer.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(fx): FxLayer with four blend-grouped emitters, wired into ArenaScene"
```

---

### Task 10: The decal `RenderTexture`

**Files:**
- Modify: `packages/client/src/fx/layer.ts`

**Interfaces:**
- Consumes: `decalFadeAlpha`, `decalStampsFor`, `tyreMarksFor`, `MAX_DECALS`, `TYRE_MARK_INTERVAL_MS` from `./decals.js`; `DECAL_DEPTH` from `./depths.js`.
- Produces: `FxLayer.update` now also lays and fades decals, and the constructor takes the arena size. Speed is derived from the pose delta — **not** from shared's `speedOf`, because `fx/` never reads a schema body and a threshold test needs no more accuracy than a delta gives.

- [ ] **Step 1: Add the decal texture to the constructor**

```ts
  private readonly decals: Phaser.GameObjects.RenderTexture;
```

In the constructor, after the emitters:

```ts
    this.decals = scene.add
      .renderTexture(0, 0, arenaWidth, arenaHeight)
      .setOrigin(0, 0)
      .setDepth(DECAL_DEPTH);
    // 'render' mode: the texture displays itself, and `render()` is called by hand once the frame's
    // stamps are queued. Deliberately NOT `setRenderMode(mode, preserve)` — `preserve` keeps the
    // COMMAND BUFFER so the same commands repeat, which is not how pixels accumulate and is not
    // what this layer wants.
    this.decals.setRenderMode("render");
```

Widen the constructor to take the arena size, since a `RenderTexture` needs one:

```ts
  constructor(scene: Phaser.Scene, seed: number, arenaWidth: number, arenaHeight: number) {
```

Update the `ArenaScene` call site accordingly:

```ts
    this.fx = new FxLayer(
      this,
      this.arena.width * 31 + this.arena.height,
      this.arena.width,
      this.arena.height,
    );
```

Add it to `displayObjects` so it is registered with exactly one camera:

```ts
  displayObjects(): Phaser.GameObjects.GameObject[] {
    return [...Object.values(this.emitters), this.decals];
  }
```

- [ ] **Step 2: Hold decals in a ring buffer and redraw them each frame**

Add the buffer and its entry type:

```ts
/** One decal, alive until it fades out or is pushed out of the ring buffer. */
interface LiveDecal {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly baseAlpha: number;
  readonly rotation: number;
  readonly tint: number;
  bornAtMs: number;
}
```

and the fields:

```ts
  private liveDecals: LiveDecal[] = [];
  private clockMs = 0;
  /** When each car last laid rubber, so marks go down on a clock rather than per frame. */
  private lastTyreMs = new Map<string, number>();
```

Replace `FxLayer.update` with:

```ts
  update(view: FxWorldView, dtMs: number): void {
    this.clockMs += dtMs;
    const events = deriveFxEvents(this.prevView, view);
    this.spawn(emitterSpecsForAll(events));

    for (const event of events) {
      for (const stamp of decalStampsFor(event)) {
        this.pushDecal({
          key: FX_TEXTURE_KEYS.scorch,
          x: stamp.x,
          y: stamp.y,
          scale: stamp.scale,
          baseAlpha: stamp.alpha,
          rotation: Math.random() * Math.PI * 2,
          tint: 0xffffff,
          bornAtMs: this.clockMs,
        });
      }
    }

    this.layTyreMarks(view);
    this.redrawDecals();
    this.prevView = view;
  }

  /** Add a decal, dropping the oldest once the buffer is full. */
  private pushDecal(decal: LiveDecal): void {
    this.liveDecals.push(decal);
    if (this.liveDecals.length > MAX_DECALS) {
      this.liveDecals.splice(0, this.liveDecals.length - MAX_DECALS);
    }
  }

  /** Rubber under every moving car, laid on a clock so the trail is frame-rate independent. */
  private layTyreMarks(view: FxWorldView): void {
    const before = new Map((this.prevView?.cars ?? []).map((c) => [c.sessionId, c]));
    for (const car of view.cars) {
      const previous = before.get(car.sessionId);
      if (!previous || !car.alive) continue;
      const since = this.clockMs - (this.lastTyreMs.get(car.sessionId) ?? -Infinity);
      if (since < TYRE_MARK_INTERVAL_MS) continue;
      // Speed from the pose delta rather than a velocity field: `fx/` never reads the schema, and
      // this is exactly as accurate as a threshold test needs.
      const dt = Math.max(1, since) / 1000;
      const speed = Math.hypot(car.x - previous.x, car.y - previous.y) / dt;
      const marks = tyreMarksFor(car, speed);
      if (marks.length === 0) continue;
      this.lastTyreMs.set(car.sessionId, this.clockMs);
      for (const mark of marks) {
        this.pushDecal({
          key: FX_TEXTURE_KEYS.spark,
          x: mark.x,
          y: mark.y,
          scale: (mark.radius * 2) / 32,
          baseAlpha: mark.alpha,
          rotation: 0,
          tint: 0x141210,
          bornAtMs: this.clockMs,
        });
      }
    }
    // A car that left keeps no timer, or the map grows for the life of the room.
    const present = new Set(view.cars.map((c) => c.sessionId));
    for (const id of [...this.lastTyreMs.keys()]) if (!present.has(id)) this.lastTyreMs.delete(id);
  }

  /**
   * Redraw the whole decal layer from the buffer.
   *
   * `clear()` then stamp then `render()`, every call documented. The layer is NOT faded in place,
   * because Phaser 4's `erase()` takes no alpha and cannot express a partial fade; redrawing also
   * makes the curve exact rather than an accumulation of per-frame rounding, and bounds the cost by
   * `MAX_DECALS` instead of by match length.
   */
  private redrawDecals(): void {
    this.decals.clear();
    const survivors: LiveDecal[] = [];
    for (const decal of this.liveDecals) {
      const alpha = decal.baseAlpha * decalFadeAlpha(this.clockMs - decal.bornAtMs);
      if (alpha <= 0) continue;
      survivors.push(decal);
      this.decals.stamp(decal.key, undefined, decal.x, decal.y, {
        alpha,
        tint: decal.tint,
        rotation: decal.rotation,
        scale: decal.scale,
      });
    }
    this.liveDecals = survivors;
    // Buffered until this call — without it nothing appears, which is the Phaser 4 change most
    // likely to be missed when porting any Phaser 3 RenderTexture snippet.
    this.decals.render();
  }
```

Add the imports:

```ts
import {
  decalFadeAlpha,
  decalStampsFor,
  MAX_DECALS,
  TYRE_MARK_INTERVAL_MS,
  tyreMarksFor,
} from "./decals.js";
import { AIR_FX_DEPTH, DECAL_DEPTH, GROUND_FX_DEPTH } from "./depths.js";
```

- [ ] **Step 3: Verify by eye**

Run: `npm run dev`, start a practice match, drive in a circle for ten seconds, then fire `magmablast` at a wall.
Expected: two tyre tracks trail the car and curve with it; a dark scorch appears where the shell detonates; both fade noticeably over about forty seconds and the floor never trends toward black.

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/fx/layer.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(fx): persistent decal layer with rubber, scorch and a real fade"
```

---

### Task 11: The smoke layer and its eraser mask

**Files:**
- Modify: `packages/client/src/fx/layer.ts`

**Interfaces:**
- Consumes: `eraserStampsFor` from `./occlusion.js`; `carShapeOf` from `../scenes/car-visual.js`.
- Produces: smoke renders through a `RenderTexture` with car silhouettes erased from it. No signature change.

**How the silhouette is obtained without new art:** the car sprite already loaded from the manifest is drawn into an offscreen canvas texture, filled solid via `source-in`, and blurred once — at boot, per chassis, never per frame (VFX21). A chassis with no sprite falls back to a filled rounded rect at the hull size, which is the same fallback `drawCar` already takes.

- [ ] **Step 1: Build the blurred silhouette textures at boot**

Add to the constructor, after `uploadTextures`:

```ts
    this.buildEraserTextures();
```

And the method:

```ts
  /**
   * A soft, solid stamp of each chassis's silhouette, built once.
   *
   * Derived from the car sprite's own ALPHA channel, so it needs no new art and is automatically
   * right for any chassis added later — the same derivation the gritty contact shadow uses (VFX3,
   * VFX21). Blurred here rather than per frame because it is static: blurring it every frame was
   * pure waste in the spike.
   */
  private buildEraserTextures(): void {
    for (const carId of ["mirage", "bullseye", "bastion"]) {
      const key = `fx.eraser.${carId}`;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      const source = this.scene.textures.exists(`car.${carId}`)
        ? this.scene.textures.get(`car.${carId}`).getSourceImage()
        : undefined;
      const size = 128;
      const canvasTexture = this.scene.textures.createCanvas(key, size, size);
      if (!canvasTexture) continue;
      const ctx = canvasTexture.getContext();
      ctx.clearRect(0, 0, size, size);
      // A generous blur: the hole has to read as the car displacing the cloud, not as its outline
      // traced in smoke.
      ctx.filter = "blur(7px)";
      if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
        ctx.drawImage(source, 12, 12, size - 24, size - 24);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, size, size);
      } else {
        // No sprite for this chassis: fall back to the hull rectangle, the same fallback `drawCar`
        // takes when a manifest entry is missing.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(20, 34, size - 40, size - 68);
      }
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      canvasTexture.refresh();
    }
  }
```

- [ ] **Step 2: Route smoke through its own `RenderTexture`**

Add the field:

```ts
  private readonly smoke: Phaser.GameObjects.RenderTexture;
```

In the constructor, replace the `smoke` emitter's depth so it renders into the texture rather than the scene, and add the texture:

```ts
    this.smoke = scene.add
      .renderTexture(0, 0, arenaWidth, arenaHeight)
      .setOrigin(0, 0)
      .setDepth(AIR_FX_DEPTH);
    this.smoke.setRenderMode("render");
    // The smoke emitter draws into `this.smoke`, never straight to the scene, so the mask in
    // `maskSmoke` has something to erase from. Invisible for that reason — and `draw` is handed an
    // ARRAY, which renders it anyway.
    this.emitters.smoke.setVisible(false);
```

Add `this.smoke` to `displayObjects`:

```ts
  displayObjects(): Phaser.GameObjects.GameObject[] {
    return [...Object.values(this.emitters), this.decals, this.smoke];
  }
```

- [ ] **Step 3: Draw and mask each frame**

Add at the end of `update`, before `this.prevView = view;`:

```ts
    this.maskSmoke(view);
```

And the method:

```ts
  /**
   * Draw the smoke, then punch a soft hole around every living car (VFX18–VFX22).
   *
   * Smoke must never hide a car: losing sight of an opponent to your own weapon effect costs
   * information the player needs, and gets reported as a bug rather than admired as atmosphere.
   * Only smoke is masked — fire and sparks are additive and live a few hundred milliseconds, so
   * they brighten a car rather than hiding it and a mask on them would buy nothing.
   */
  private maskSmoke(view: FxWorldView): void {
    this.smoke.clear();
    // An ARRAY, which `draw` renders regardless of visibility — the emitter is invisible precisely
    // so it does not also draw straight to the scene. Passing it bare would depend on its `visible`
    // flag and render nothing.
    this.smoke.draw([this.emitters.smoke]);

    for (const stamp of eraserStampsFor(view.cars)) {
      const key = `fx.eraser.${stamp.carId}`;
      if (!this.scene.textures.exists(key)) continue;
      // One reusable image, moved and re-erased per car. Creating a Game Object per car per frame
      // would allocate six objects a frame for the life of the match.
      this.eraser
        .setTexture(key)
        .setDisplaySize(stamp.width * 2.2, stamp.height * 2.6)
        .setRotation(stamp.angle)
        .setPosition(stamp.x, stamp.y);
      this.smoke.erase([this.eraser]);
    }

    // Buffered until here, same as the decal layer.
    this.smoke.render();
  }
```

Add the reusable eraser image as a field, created in the constructor and kept out of the scene's own rendering:

```ts
  private readonly eraser: Phaser.GameObjects.Image;
```

```ts
    // Never drawn to the scene — it exists only to be handed to `RenderTexture.erase`, which is why
    // it is invisible AND absent from `displayObjects()`.
    this.eraser = scene.add.image(0, 0, FX_TEXTURE_KEYS.spark).setVisible(false);
```

Add the import:

```ts
import { eraserStampsFor } from "./occlusion.js";
```

- [ ] **Step 4: Verify by eye — this is the acceptance test for VFX18**

Run: `npm run dev`, start a practice match, and detonate `magmablast` directly on the bot.
Expected: a thick smoke column forms, and the bot stays visible inside it through a soft hole that follows it as it drives. The smoke keeps full thickness everywhere else. Its hp bar is legible throughout.

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/layer.ts
git commit -m "feat(fx): smoke render texture with a per-car eraser mask (VFX18-VFX22)"
```

---

### Task 12: The generated arena floor

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts` — `drawArena`
- Modify: `packages/client/src/fx/layer.ts` — expose the asphalt key

**Interfaces:**
- Consumes: `FX_TEXTURE_KEYS.asphalt`, `FLOOR_DEPTH`.
- Produces: `ArenaScene` draws a `TileSprite` floor beneath the arena graphics.

- [ ] **Step 1: Draw the floor**

In `drawArena`, immediately before `const gfx = this.add.graphics().setDepth(ARENA_DEPTH);`:

```ts
    // A real object rather than `cam.setBackgroundColor`, which is what makes a texture possible at
    // all (VFX36). The background colour stays set below as the ground beneath it, so a frame drawn
    // before this tile sprite exists is never bare canvas.
    this.floorTile = this.add
      .tileSprite(0, 0, arena.width, arena.height, FX_TEXTURE_KEYS.asphalt)
      .setOrigin(0, 0)
      .setDepth(FLOOR_DEPTH);
```

Add the field beside `private arenaGfx`:

```ts
  private floorTile: Phaser.GameObjects.TileSprite | undefined;
```

And register it in `splitCameras`'s `worldObjects`, beside `arenaGfx`:

```ts
      ...(this.floorTile ? [this.floorTile] : []),
```

**Ordering note:** `drawArena` runs before the `FxLayer` is constructed in the current `create` order, and the asphalt texture is uploaded by `FxLayer`. Move the `FxLayer` construction from Task 9 Step 2 to **before** `this.drawArena(this.arena);` so the texture exists when the tile sprite asks for it.

- [ ] **Step 2: Add the markings**

Still in `drawArena`, after the obstacle fills and before the border stroke:

```ts
    // Painted markings, drawn on the same Graphics as the obstacles so they cost no extra object.
    gfx.lineStyle(6, 0xdccd96, 0.13);
    for (let y = 40; y < arena.height - 40; y += 46) {
      gfx.lineBetween(arena.width / 2, y, arena.width / 2, Math.min(y + 26, arena.height - 40));
    }
    gfx.lineStyle(4, 0xdccd96, 0.1);
    gfx.strokeCircle(arena.width / 2, arena.height / 2, 130);
```

- [ ] **Step 3: Verify by eye**

Run: `npm run dev`, start a practice match.
Expected: the floor reads as asphalt with visible grain rather than a flat fill; a dashed centre line and a centre circle are faintly visible; obstacles and the border still draw over it; the HUD gutter down the right is unaffected.

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/scenes/ArenaScene.ts packages/client/src/fx/layer.ts
git commit -m "feat(fx): generated asphalt floor with painted markings (VFX36)"
```

---

### Task 13: Camera language

**Files:**
- Create: `packages/client/src/fx/camera.ts`
- Test: `packages/client/src/fx/camera.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` — `showImpact`, and a hit-stop call in `renderFx`

**Interfaces:**
- Consumes: `FxEvent` from `./events.js`.
- Produces:
  - `interface ShakeSpec { readonly durationMs: number; readonly intensity: number }`
  - `shakeFor(event: FxEvent): ShakeSpec | undefined`
  - `ramShake(closingSpeed: number): ShakeSpec`
  - `HIT_STOP_MS: number`, `HIT_STOP_SCALE: number`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/fx/camera.test.ts
import { describe, expect, it } from "vitest";
import { HIT_STOP_MS, HIT_STOP_SCALE, ramShake, shakeFor } from "./camera.js";

describe("shakeFor", () => {
  it("shakes harder for a death than for a hit", () => {
    const death = shakeFor({ kind: "died", sessionId: "a", x: 0, y: 0 })!;
    const hit = shakeFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 20 })!;
    expect(death.intensity).toBeGreaterThan(hit.intensity);
  });

  it("scales a hit's shake with the damage taken", () => {
    const light = shakeFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 3 })!;
    const heavy = shakeFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 45 })!;
    expect(heavy.intensity).toBeGreaterThan(light.intensity);
  });

  it("caps the shake, so a burst of damage cannot make the camera unusable", () => {
    const huge = shakeFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 100_000 })!;
    expect(huge.intensity).toBeLessThanOrEqual(0.02);
  });

  it("never shakes for a muzzle flash — the camera would tremble constantly", () => {
    expect(shakeFor({ kind: "shotFired", weaponId: "pepperbox", x: 0, y: 0, angle: 0 })).toBeUndefined();
  });

  it("shakes for an explosion ending but not for a beam ending", () => {
    expect(shakeFor({ kind: "shotEnded", weaponId: "magmablast", x: 0, y: 0, angle: 0 })).toBeDefined();
    expect(shakeFor({ kind: "shotEnded", weaponId: "lance", x: 0, y: 0, angle: 0 })).toBeUndefined();
  });
});

describe("ramShake", () => {
  it("scales with the closing speed", () => {
    expect(ramShake(300).intensity).toBeGreaterThan(ramShake(60).intensity);
  });

  it("still produces something for a gentle nudge, so contact is never silent", () => {
    expect(ramShake(1).intensity).toBeGreaterThan(0);
  });
});

describe("hit stop", () => {
  it("is brief and partial — a full freeze reads as a dropped frame", () => {
    expect(HIT_STOP_MS).toBeGreaterThan(0);
    expect(HIT_STOP_MS).toBeLessThanOrEqual(120);
    expect(HIT_STOP_SCALE).toBeGreaterThan(0);
    expect(HIT_STOP_SCALE).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- camera`
Expected: FAIL — `Failed to resolve import "./camera.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/fx/camera.ts
import type { FxEvent } from "./events.js";

/** A camera shake, in the units `Phaser.Cameras.Scene2D.Camera.shake` takes. */
export interface ShakeSpec {
  readonly durationMs: number;
  readonly intensity: number;
}

/**
 * How long the world runs slow after a kill, and how slow.
 *
 * Partial and brief on purpose. A full freeze reads as a dropped frame or a stutter, which is the
 * opposite of the weight it is meant to add.
 */
export const HIT_STOP_MS = 90;
export const HIT_STOP_SCALE = 0.25;

/** Beyond this, more damage buys no more shake. */
const MAX_SHAKE = 0.02;

/** Weapons whose ending is an explosion worth feeling. */
const EXPLOSIVE = new Set(["magmablast", "predator"]);

/**
 * The shake one event earns, or `undefined` for events that must not move the camera.
 *
 * A muzzle flash never shakes: `pepperbox` alone would leave the camera permanently trembling, and
 * a camera that reacts to everything reads as reacting to nothing.
 */
export function shakeFor(event: FxEvent): ShakeSpec | undefined {
  switch (event.kind) {
    case "died":
      return { durationMs: 260, intensity: MAX_SHAKE };
    case "damaged":
      return {
        durationMs: 120,
        intensity: Math.min(MAX_SHAKE * 0.6, 0.0015 + event.amount * 0.00018),
      };
    case "shotEnded":
      return EXPLOSIVE.has(event.weaponId)
        ? { durationMs: 200, intensity: MAX_SHAKE * 0.75 }
        : undefined;
    case "shotFired":
      return undefined;
  }
}

/**
 * The shake for a ram, from the closing speed.
 *
 * Separate from `shakeFor` because contact is observed locally by `impact-feedback.ts` rather than
 * derived from a state delta — it has to react before the authoritative knock arrives, which is the
 * whole reason that module exists.
 */
export function ramShake(closingSpeed: number): ShakeSpec {
  return {
    durationMs: 120,
    // A floor, so the gentlest nudge still registers: contact with no feedback reads as the car
    // catching on nothing.
    intensity: Math.min(MAX_SHAKE * 0.5, 0.002 + Math.abs(closingSpeed) * 0.00002),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- camera`
Expected: PASS, 8 tests.

- [ ] **Step 5: Wire it into `ArenaScene`**

Replace `showImpact`'s fixed shake. The method keeps its render-only contract — it reacts to locally observed contact and must never change anything the sim or schema can see.

```ts
  private showImpact(x: number, y: number, closingSpeed = 0): void {
    const shake = ramShake(closingSpeed);
    this.cameras.main.shake(shake.durationMs, shake.intensity);
    const spark = this.add.circle(x, y, 10, 0xffffff, 0.9);
    this.hudCamera?.ignore(spark);
    this.tweens.add({
      targets: spark,
      alpha: 0,
      scale: 2.2,
      duration: 180,
      onComplete: () => spark.destroy(),
    });
  }
```

In `renderFx`, after `this.fx.update(...)`, apply the shakes and hit-stop:

```ts
    for (const event of this.fx.lastEvents()) {
      const shake = shakeFor(event);
      if (shake) this.cameras.main.shake(shake.durationMs, shake.intensity);
      if (event.kind === "died") {
        this.time.timeScale = HIT_STOP_SCALE;
        this.time.delayedCall(HIT_STOP_MS * HIT_STOP_SCALE, () => {
          this.time.timeScale = 1;
        });
      }
    }
```

Expose the frame's events from `FxLayer` — add the field and accessor:

```ts
  private frameEvents: FxEvent[] = [];

  /** The events this layer derived on the last `update`. Read by `ArenaScene` for camera work. */
  lastEvents(): readonly FxEvent[] {
    return this.frameEvents;
  }
```

and assign it in `update`, replacing `const events = deriveFxEvents(...)`:

```ts
    const events = deriveFxEvents(this.prevView, view);
    this.frameEvents = events;
```

Add the imports to `ArenaScene`:

```ts
import { HIT_STOP_MS, HIT_STOP_SCALE, ramShake, shakeFor } from "../fx/camera.js";
```

and to `layer.ts`:

```ts
import { deriveFxEvents, type FxEvent, type FxWorldView } from "./events.js";
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck -w @motor-combat-moba/client` — no errors.
Run: `npm run dev`, take a big hit and then a kill.
Expected: the camera kicks proportionally to damage, kicks hardest on a kill, and the world dips briefly on the kill before resuming. Firing `pepperbox` produces no shake at all.

```bash
git add packages/client/src/fx/camera.ts packages/client/src/fx/camera.test.ts packages/client/src/fx/layer.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(fx): severity-driven shake and hit-stop on kills (VFX26)"
```

---

### Task 14: Grade and vignette

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts` — `drawArena`

**Interfaces:**
- Consumes: Phaser 4's camera **Filters** API.
- Produces: a warm-desaturated grade and a vignette on the world camera.

**Phaser 4 has no `Bloom` filter (VFX28).** It replaced Phaser 3's `postFX`/`preFX` with `camera.filters.internal` / `camera.filters.external`, and 4.2.1 ships `Barrel, Blend, Blocky, Blur, Bokeh, ColorMatrix, CombineColorMatrix, Displacement, Glow, GradientMap, ImageLight, Key, Mask, NormalTools, PanoramaBlur, ParallelFilters, Pixelate, Quantize, Sampler, Shadow, Threshold, TiltShift, Vignette, Wipe`. Do not reach for `addBloom`; it does not exist.

- [ ] **Step 1: Add the filters**

In `drawArena`, after `cam.setBounds(0, 0, arena.width, arena.height);`:

```ts
    // Applied to the world camera only, so the HUD camera's text and icons keep their authored
    // colours — a graded HUD reads as a rendering bug rather than as atmosphere.
    const grade = cam.filters.internal.addColorMatrix();
    // Order matters: desaturate first, then push warmth back in, or the warmth is what gets
    // desaturated away.
    grade.saturate(-0.22);
    grade.brightness(0.96);
    cam.filters.internal.addVignette(0.5, 0.5, 0.78, 0.42);
```

- [ ] **Step 2: Verify by eye**

Run: `npm run dev`, start a practice match.
Expected: the arena reads warmer and slightly desaturated with darkened corners; the weapon gutter, hp bars and roster panel down the right are **unaffected**. If the HUD is graded too, the filters were added to the wrong camera.

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(fx): warm-desaturated grade and vignette on the world camera (VFX27-VFX28)"
```

---

### Task 15: Performance budget

**Files:**
- Create: `packages/client/src/fx/perf.test.ts`

**Interfaces:**
- Consumes: everything pure in `fx/`.
- Produces: a budget test, following the precedent `packages/client/CLAUDE.md` sets — *"the number to check a new authored beam against is not its fill count — it is `ms` to build one frame's worth at the realistic ceiling."*

- [ ] **Step 1: Write the test**

```ts
// packages/client/src/fx/perf.test.ts
import { describe, expect, it } from "vitest";
import { deriveFxEvents, type FxWorldView } from "./events.js";
import { emitterSpecsForAll } from "./emitters.js";
import { eraserStampsFor } from "./occlusion.js";
import { asphaltTexture, DUST_A, puffTexture } from "./textures.js";

/**
 * The realistic ceiling: six cars, and the ~60 live instances `packages/client/CLAUDE.md` names as
 * the cap `renderShots` is built against.
 */
function ceilingViews(): [FxWorldView, FxWorldView] {
  const cars = Array.from({ length: 6 }, (_, i) => ({
    sessionId: `p${i}`,
    x: i * 100,
    y: i * 80,
    angle: i,
    hp: 100 - i,
    alive: true,
    carId: "bastion",
  }));
  const instances = (offset: number) =>
    Array.from({ length: 60 }, (_, i) => ({
      id: `w${i + offset}`,
      weaponId: i % 3 === 0 ? "magmablast" : i % 3 === 1 ? "thumper" : "lance",
      x: i * 7,
      y: i * 5,
      angle: i * 0.1,
    }));
  const prev: FxWorldView = { cars, instances: instances(0) };
  // Every instance replaced: 60 endings and 60 firings on one frame, plus six cars taking damage.
  const next: FxWorldView = {
    cars: cars.map((c) => ({ ...c, hp: c.hp - 5 })),
    instances: instances(1000),
  };
  return [prev, next];
}

describe("per-frame FX cost", () => {
  it("derives and maps a worst-case frame well inside a 60fps budget", () => {
    const [prev, next] = ceilingViews();
    const started = performance.now();
    const iterations = 200;
    for (let i = 0; i < iterations; i++) {
      const events = deriveFxEvents(prev, next);
      emitterSpecsForAll(events);
      eraserStampsFor(next.cars);
    }
    const perFrameMs = (performance.now() - started) / iterations;
    // A 60fps frame is 16.7ms. One millisecond is 6% of it for all of the FX decision work, which
    // leaves the renderer the rest. If this fails, profile before raising it.
    expect(perFrameMs).toBeLessThan(1);
  });
});

describe("boot texture cost", () => {
  it("generates the whole texture set in well under a second", () => {
    const started = performance.now();
    for (let i = 0; i < 6; i++) puffTexture(i, DUST_A);
    asphaltTexture(1);
    const elapsed = performance.now() - started;
    // Generated once at scene create. Asphalt at 512x512 dominates; if this regresses, the octave
    // counts in `asphaltTexture` are the first thing to check.
    expect(elapsed).toBeLessThan(800);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test -w @motor-combat-moba/client -- perf`
Expected: PASS, 2 tests. If either fails, profile before relaxing the bound — the numbers are budgets, not observations.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/fx/perf.test.ts
git commit -m "test(fx): per-frame and boot budgets for the FX decision work"
```

---

### Task 16: Previewer, and full verification

**Files:**
- Create: `packages/client/src/dev/FxPreviewScene.ts`
- Modify: `packages/client/src/dev/registry.ts` — register `?dev=fx`

**Interfaces:**
- Consumes: `FxLayer`, the texture generators, and every pure module.
- Produces: a dev-only scene, gated behind `DEV_TOOLS` exactly as `?dev=playground` and `?dev=assets` are.

**Built off the shipped `fx/` functions, never a parallel mockup (VFX32)** — so what is approved is what ships.

- [ ] **Step 1: Write the scene**

```ts
// packages/client/src/dev/FxPreviewScene.ts
import Phaser from "phaser";
import { ARENA_01 } from "@motor-combat-moba/shared";
import { FxLayer } from "../fx/layer.js";
import type { FxWorldView } from "../fx/events.js";
import { DEV_TOOL_MARKER } from "./registry.js";

/**
 * `?dev=fx` — the FX system driven by a scripted loop instead of a match.
 *
 * Built on the shipped `FxLayer` and the real `fx/` modules rather than a parallel mockup (VFX32),
 * so what is approved here is what ships. Judged at true 1:1 on the real arena floor.
 *
 * Every channel is independently switchable, which is the mitigation VFX33 names for the one
 * residual risk: a screen busy enough to be tiring in a six-car fight is a question only a person
 * looking at it can answer, and answering it means being able to turn each layer off.
 */
export class FxPreviewScene extends Phaser.Scene {
  private fx: FxLayer | undefined;
  private elapsed = 0;
  private view: FxWorldView = { cars: [], instances: [] };

  constructor() {
    super("FxPreview");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#33322f");
    this.fx = new FxLayer(this, 1337, ARENA_01.width, ARENA_01.height);

    // Rendered by every dev tool so a build that reached a release by any route is still caught by
    // `assertNoDevOnlyCode` in `scripts/build-release.mjs`.
    this.add.text(12, 10, `${DEV_TOOL_MARKER} — FX PREVIEW`, {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#e6e4e1",
    });
    this.add.text(12, 30, "1 smoke  2 fire  3 sparks  4 debris  5 decals  6 mask", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#9a9aa3",
    });

    // One key per channel. `setChannelEnabled` is added to FxLayer in Step 2.
    const keys = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"] as const;
    const channels = ["smoke", "fire", "spark", "debris", "decals", "mask"] as const;
    keys.forEach((key, i) => {
      this.input.keyboard?.on(`keydown-${key}`, () => this.fx?.toggleChannel(channels[i]));
    });
  }

  update(_time: number, delta: number): void {
    if (!this.fx) return;
    this.elapsed = (this.elapsed + delta) % 6000;
    const t = this.elapsed / 1000;

    // One car driving an arc, so the decal layer is exercised; two parked, so the eraser mask has
    // something to hold a hole open around.
    const angle = t * 0.62 - 1.2;
    const cars = [
      { sessionId: "drive", x: 470 + Math.cos(angle) * 190, y: 400 + Math.sin(angle) * 190, angle: angle + Math.PI / 2, hp: 85, alive: true, carId: "mirage" },
      { sessionId: "park", x: 742, y: 452, angle: 2.55, hp: 40, alive: true, carId: "bullseye" },
      { sessionId: "blast", x: 966, y: 214, angle: 3.55, hp: 62, alive: true, carId: "bastion" },
    ];
    // A shell that exists for the first 1.25s of the loop and then is gone, which the event seam
    // reads as a fire followed by a detonation.
    const instances = t < 1.25 ? [{ id: "shell", weaponId: "magmablast", x: 952, y: 222, angle: 0 }] : [];

    this.view = { cars, instances };
    this.fx.update(this.view, delta);
  }
}
```

- [ ] **Step 2: Add the channel toggles to `FxLayer`**

```ts
  private readonly disabled = new Set<string>();

  /**
   * Turn one channel on or off. Dev-tool only — nothing in a match calls this.
   *
   * `"mask"` toggles the smoke occlusion pass rather than a particle channel, because the question
   * VFX33 leaves open ("is a busy screen tiring?") is partly a question about how much the mask is
   * actually doing, and the only way to see that is to switch it off and compare.
   */
  toggleChannel(channel: "smoke" | "fire" | "spark" | "debris" | "decals" | "mask"): void {
    if (this.disabled.has(channel)) this.disabled.delete(channel);
    else this.disabled.add(channel);
  }
```

Then gate the three places it applies. In `spawn`, skip a disabled particle channel:

```ts
      if (this.disabled.has(spec.channel)) continue;
```

In `redrawDecals`, clear and return early when decals are off:

```ts
    if (this.disabled.has("decals")) {
      this.decals.clear();
      this.decals.render();
      return;
    }
```

In `maskSmoke`, skip the erase loop when the mask is off — draw the smoke, then render:

```ts
    if (!this.disabled.has("mask")) {
      for (const stamp of eraserStampsFor(view.cars)) {
        // ...the loop from Task 11...
      }
    }
```

- [ ] **Step 3: Register it**

In `packages/client/src/dev/registry.ts`, add one line to `DEV_TOOLS`, keeping the existing dynamic-import shape so the tool is fetched only when asked for and stays behind the single `import.meta.env.DEV` branch in `BootScene`:

```ts
export const DEV_TOOLS: Record<string, () => Promise<SceneCtor>> = {
  assets: async () => (await import("./AssetTuningScene.js")).AssetTuningScene,
  fx: async () => (await import("./FxPreviewScene.js")).FxPreviewScene,
  playground: async () => (await import("./PlaygroundScene.js")).PlaygroundScene,
};
```

**Do not touch `main.ts`.** Dev tools are dynamically imported through this registry, never added to the game's static `scene` array — that is what keeps them out of the release bundle and what `assertNoDevOnlyCode` in `scripts/build-release.mjs` checks.

- [ ] **Step 4: Verify the whole thing**

Run: `npm run dev`, open `http://localhost:5173/?dev=fx`.
Expected: the six-second loop runs — the mirage lays rubber round its arc, the shell detonates on the bastion at 1.25s with fire, soot, sparks and debris, a scorch stays on the ground and fades, and the bastion stays visible through the smoke. Keys `1`–`6` switch each channel off and on.

Press `6` to disable the mask and watch the same detonation.
Expected: with the mask off the bastion **disappears** into the smoke column. This is the before/after that shows VFX18's mask is doing real work, and it is the comparison to put in front of the user.

Run: `npm run build:release` then confirm the dev scene is absent.
Expected: the release build succeeds and its own assertion that dev tools are stripped passes.

Run: **`npm test`** from the repo root — not the client workspace alone, which silently skips the other suites.
Expected: all suites pass.

Run: `npm run typecheck`
Expected: no errors across workspaces.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/FxPreviewScene.ts packages/client/src/dev/registry.ts packages/client/src/main.ts
git commit -m "feat(fx): ?dev=fx previewer built on the shipped fx modules (VFX32)"
```

---

## Verification Checklist

Run from the repo root when every task is done:

- [ ] `npm test` — all suites, all workspaces, plus `scripts/*.test.mjs`.
- [ ] `npm run typecheck` — no errors.
- [ ] `npm run build` — the root script, never `--workspaces`, which does not enforce shared-first ordering.
- [ ] `npm run build:release` — succeeds, and its dev-tool-absence assertion passes.
- [ ] `git grep -n "setBlendMode" packages/client/src/fx/` — every hit is in a constructor, none in a per-particle path.
- [ ] `git status packages/client/public/art/` — clean. No image file was added (VFX4).
- [ ] `git diff --stat development/main -- packages/shared packages/server` — empty. No shared table, schema field or sim change (VFX30).
- [ ] `npm run playtest` is **not** required — nothing this plan touches is measured by a probe. Say so in the summary rather than running it silently.
