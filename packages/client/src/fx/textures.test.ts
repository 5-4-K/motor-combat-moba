import { describe, expect, it } from "vitest";
import { ENVIRONMENT_FX } from "./environment.js";
import {
  alphaAt,
  asphaltTexture,
  crackedCrustTexture,
  DUST_A,
  fireTexture,
  puffTexture,
  scorchTexture,
  SOOT_A,
  sparkTexture,
  type TexturePixels,
} from "./textures.js";

/**
 * Mean absolute delta of the red channel between two columns, across every row — the same
 * seam-vs-interior measure the tiling case below uses, factored out so a second test case can
 * reuse it instead of writing a second measure.
 */
function meanChannelDelta(tex: TexturePixels, colA: number, colB: number): number {
  const red = (x: number, y: number): number => tex.data[(y * tex.width + x) * 4];
  let total = 0;
  for (let j = 0; j < tex.height; j++) total += Math.abs(red(colA, j) - red(colB, j));
  return total / tex.height;
}

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

  /**
   * The floor is one `tileSprite` repeated across the arena, so a discontinuity across the wrap is
   * a grid of straight lines over the whole screen — the most visible bug this file can ship.
   *
   * Measured against the texture's own interior rather than against an absolute number, because the
   * only meaningful question is whether the seam looks like any other pair of neighbouring columns.
   * MEASURED at 512 with the non-wrapping `fbm` this replaced: seam 5.41 horizontal / 5.16 vertical
   * against 1.00 / 0.88 interior — a 5x discontinuity, and the reason this test exists. With
   * `tileableFbm`: 1.11 / 0.86 against 1.03 / 1.03, and a worst-case single-pixel jump of 5 levels
   * against the old 23. The bound is 2x the interior figure: comfortably above the noise in a
   * genuinely wrapped texture, and nowhere near the 5x a lattice that does not wrap produces.
   */
  it("tiles: the wrap seam is no worse than an ordinary interior edge", () => {
    const size = 128;
    const tex = asphaltTexture(4, size);
    const red = (x: number, y: number): number => tex.data[(y * size + x) * 4];

    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
    const acrossX: number[] = [];
    const insideX: number[] = [];
    const acrossY: number[] = [];
    const insideY: number[] = [];
    for (let j = 0; j < size; j++) {
      acrossX.push(Math.abs(red(size - 1, j) - red(0, j)));
      acrossY.push(Math.abs(red(j, size - 1) - red(j, 0)));
      for (let i = 0; i < size - 1; i++) {
        insideX.push(Math.abs(red(i, j) - red(i + 1, j)));
        insideY.push(Math.abs(red(j, i) - red(j, i + 1)));
      }
    }
    expect(mean(acrossX)).toBeLessThan(mean(insideX) * 2);
    expect(mean(acrossY)).toBeLessThan(mean(insideY) * 2);
  });
});

describe("asphaltTexture reads the environment table", () => {
  it("changes its pixels when the grey base moves", () => {
    const env = { ...ENVIRONMENT_FX, floor: { ...ENVIRONMENT_FX.floor, baseGrey: 120 } };
    const shipped = asphaltTexture(9, 64);
    const brighter = asphaltTexture(9, 64, env);
    expect(brighter.data[0]).toBeGreaterThan(shipped.data[0]!);
  });

  it("stays tileable at a different whole cell count", () => {
    const env = { ...ENVIRONMENT_FX, floor: { ...ENVIRONMENT_FX.floor, grainCells: 32, patchCells: 4 } };
    const tex = asphaltTexture(9, 64, env);
    // The same seam property the shipped tiling case pins: the wrap must be no worse than the
    // interior. Whole cell counts are what makes `tileableFbm`'s lattice close (EV15).
    const seam = meanChannelDelta(tex, tex.width - 1, 0);
    const interior = meanChannelDelta(tex, 10, 11);
    expect(seam).toBeLessThan(interior * 3);
  });

  it("defaults to the shipped floor values", () => {
    expect(asphaltTexture(9, 64)).toEqual(asphaltTexture(9, 64, ENVIRONMENT_FX));
  });
});

describe("cracked crust", () => {
  const env = ENVIRONMENT_FX;

  it("is transparent outside its radius and solid well inside it", () => {
    const { crust } = crackedCrustTexture(5, 128, env);
    // Corners are outside the inscribed circle.
    expect(alphaAt(crust, 1, 1)).toBe(0);
    expect(alphaAt(crust, 126, 126)).toBe(0);
    expect(alphaAt(crust, 64, 64)).toBeGreaterThan(0);
  });

  it("feathers its edge rather than cookie-cutting a circle (LZ34)", () => {
    // The ring states the damage boundary; the crust must not draw a second, competing one.
    const { crust } = crackedCrustTexture(5, 128, env);
    const mid = alphaAt(crust, 64 + 40, 64); // ~0.63r
    const near = alphaAt(crust, 64 + 62, 64); // ~0.97r
    expect(mid).toBeGreaterThan(near);
    expect(near).toBeLessThan(40);
  });

  it("draws seams that are a minority of the disc, and registered to the crust", () => {
    const { crust, seam } = crackedCrustTexture(5, 128, env);
    expect(seam.width).toBe(crust.width);
    let hot = 0;
    let inside = 0;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        if (alphaAt(crust, x, y) === 0) continue;
        inside++;
        if (alphaAt(seam, x, y) > 128) hot++;
      }
    }
    // Cracks between plates, not a sheet of fire. If this ever approaches 1 the cell size or the
    // seam width has run away and the field will read as a solid orange disc.
    expect(hot / inside).toBeGreaterThan(0.02);
    expect(hot / inside).toBeLessThan(0.35);
  });

  it("is greyscale, so every colour stays a live tint rather than a baked one", () => {
    const { seam } = crackedCrustTexture(5, 64, env);
    for (let i = 0; i < seam.data.length; i += 4) {
      if (seam.data[i + 3] === 0) continue;
      expect(seam.data[i]).toBe(seam.data[i + 1]);
      expect(seam.data[i + 1]).toBe(seam.data[i + 2]);
    }
  });

  it("gives different fields different plates", () => {
    const a = crackedCrustTexture(1, 64, env);
    const b = crackedCrustTexture(2, 64, env);
    expect(Array.from(a.seam.data)).not.toEqual(Array.from(b.seam.data));
  });
});
