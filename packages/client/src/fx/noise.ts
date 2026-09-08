/**
 * Seeded value noise. Every texture in `fx/` is built from this and nothing else, which is what
 * lets the whole effect set ship as code rather than as image files (VFX4).
 *
 * Deliberately not a library. It has to run in vitest's node environment with no DOM, be
 * deterministic for a given seed so a texture can be asserted on, and vary across seeds so
 * "re-roll" is a real operation rather than a redraw of the same image (VFX8).
 */

/**
 * A hash of a lattice cell to `[0,1)`. Integer-mixing, so neighbouring cells decorrelate.
 *
 * Every step is `Math.imul` or a LOGICAL shift, and both choices are load-bearing.
 *
 * `Math.imul` because a plain `*` on these constants exceeds 2^53 and silently becomes float
 * arithmetic, losing the 32-bit wraparound the avalanche depends on.
 *
 * `>>>` and not `>>` because an arithmetic shift carries the sign bits down, and XORing those
 * back in can never set bit 31 — which caps the output at 0.5 and halves the contrast of every
 * texture built on this. Measured: `>>` gives mean 0.25 and chi2 60063 over ten buckets; `>>>`
 * gives mean 0.501 and chi2 12.
 */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
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

/**
 * Value noise on a lattice that **wraps every `period` cells**, so `x` and `x + period` sample the
 * same value exactly. `fbm`'s lattice does not wrap, and a texture built on it cannot be tiled
 * without a visible seam — see `tileableFbm`.
 *
 * `period` must be a positive integer, or the wrap lands mid-cell and the seam comes back.
 */
export function tileableValueNoise(x: number, y: number, seed: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  // A positive modulo — `%` keeps the sign in JS, and a negative lattice index would hash to a
  // cell the wrapped side never reaches — written out rather than through a `wrap` helper because
  // this is the hottest line in the whole texture set. Two modulos instead of four (the far cell
  // is the near one plus one, which can only wrap by landing exactly on `period`), and `| 0` on
  // the lattice indices so the remainder is an integer op rather than a float `fmod`. MEASURED on
  // the 512x512 asphalt: 85-100 ms with a closure and four unconditional double modulos, 43-51 ms
  // this way, against ~36 ms for the non-wrapping `fbm` it replaced.
  const mx = (xi | 0) % period;
  const my = (yi | 0) % period;
  const x0 = mx < 0 ? mx + period : mx;
  const y0 = my < 0 ? my + period : my;
  const x1 = x0 + 1 === period ? 0 : x0 + 1;
  const y1 = y0 + 1 === period ? 0 : y0 + 1;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/**
 * `fbm`'s tiling twin: a fractal sum whose every octave wraps at `period` base cells, so the whole
 * result is periodic in both axes and a texture built on it tiles without a seam.
 *
 * Two things differ from `fbm`, and both are forced by the wrap.
 *
 * The frequency step is an exact **2**, not 2.03. A wrap is only expressible when an octave's
 * period is a whole number of its own lattice cells, and 2.03 is not. That reintroduces the plaid
 * `fbm`'s comment warns about — every octave's lattice edges land on the same lines — so each
 * octave is instead **offset** by an irrational-looking fraction of a cell. An offset is a
 * translation, which periodicity is immune to, and it puts the octaves' zero-gradient lattice
 * points in different places, which is the whole of what the 2.03 was buying.
 *
 * `period` is in cells of the FIRST octave, and is multiplied by the frequency for later ones, so
 * the caller states it once: `tileableFbm(i / cell, …, size / cell)` tiles at `size` pixels.
 * It must be a positive integer, and `period * 2^(octaves-1)` must stay exact — trivially true for
 * the sizes this file uses.
 *
 * `fbm` itself is deliberately untouched: every other texture in `textures.ts` is built on it and
 * their tests pin its output.
 */
export function tileableFbm(
  x: number,
  y: number,
  seed: number,
  octaves: number,
  period: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum +=
      tileableValueNoise(x * freq + i * 0.37, y * freq + i * 0.61, seed + i * 17, period * freq) *
      amp;
    norm += amp;
    freq *= 2;
    amp *= 0.5;
  }
  return norm > 0 ? sum / norm : 0;
}
