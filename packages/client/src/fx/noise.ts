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
