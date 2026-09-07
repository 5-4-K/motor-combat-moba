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
