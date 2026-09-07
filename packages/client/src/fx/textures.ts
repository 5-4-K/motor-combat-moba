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
