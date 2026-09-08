import { describe, expect, it } from "vitest";
import { ENVIRONMENT_FX } from "./environment.js";
import {
  ENV_FIELDS,
  envKey,
  envTableSource,
  isEnvAtShipped,
  resolveEnvironment,
  shippedEnvValue,
} from "./env-tuning.js";

describe("resolveEnvironment", () => {
  it("returns the shipped table for an empty map", () => {
    expect(resolveEnvironment({})).toEqual(ENVIRONMENT_FX);
  });

  it("applies one override and leaves its siblings alone", () => {
    const env = resolveEnvironment({ [envKey("grade", "saturate")]: -0.5 });
    expect(env.grade.saturate).toBe(-0.5);
    expect(env.grade.brightness).toBe(ENVIRONMENT_FX.grade.brightness);
    expect(env.decals).toEqual(ENVIRONMENT_FX.decals);
  });

  it("drops an entry naming an unknown section or field", () => {
    const env = resolveEnvironment({ "nope.thing": 1, "grade.nope": 1 });
    expect(env).toEqual(ENVIRONMENT_FX);
  });

  it("drops an out-of-range or non-finite entry rather than writing NaN into a shader", () => {
    const env = resolveEnvironment({
      [envKey("vignette", "strength")]: 99,
      [envKey("grade", "brightness")]: Number.NaN,
    });
    expect(env.vignette.strength).toBe(ENVIRONMENT_FX.vignette.strength);
    expect(env.grade.brightness).toBe(ENVIRONMENT_FX.grade.brightness);
  });

  it("drops a fractional value in an integer field, because a fractional cell count reopens the seam", () => {
    const env = resolveEnvironment({ [envKey("floor", "grainCells")]: 33.5 });
    expect(env.floor.grainCells).toBe(64);
  });

  it("never writes through to the shipped table", () => {
    resolveEnvironment({ [envKey("grade", "saturate")]: -0.9 });
    expect(ENVIRONMENT_FX.grade.saturate).toBe(-0.22);
  });
});

describe("ENV_FIELDS reachability (EV13)", () => {
  it("names a real path for every row", () => {
    for (const field of ENV_FIELDS) {
      const section = (ENVIRONMENT_FX as unknown as Record<string, Record<string, number>>)[field.section];
      expect(section, `unknown section ${field.section}`).toBeDefined();
      expect(typeof section![field.name], `unknown field ${field.section}.${field.name}`).toBe("number");
    }
  });

  it("has exactly one row for every leaf of EnvironmentFx", () => {
    const leaves: string[] = [];
    for (const [section, values] of Object.entries(ENVIRONMENT_FX)) {
      for (const name of Object.keys(values as Record<string, number>)) leaves.push(`${section}.${name}`);
    }
    const rows = ENV_FIELDS.map((f) => envKey(f.section, f.name));
    expect([...rows].sort()).toEqual([...leaves].sort());
  });

  it("contains every shipped value inside its own range", () => {
    for (const field of ENV_FIELDS) {
      const shipped = shippedEnvValue(field);
      expect(shipped, `${field.section}.${field.name} below min`).toBeGreaterThanOrEqual(field.min);
      expect(shipped, `${field.section}.${field.name} above max`).toBeLessThanOrEqual(field.max);
    }
  });
});

describe("isEnvAtShipped", () => {
  it("is half-step tolerant for a number", () => {
    const field = ENV_FIELDS.find((f) => f.section === "grade" && f.name === "saturate")!;
    expect(isEnvAtShipped(field, -0.222, -0.22)).toBe(true);
    expect(isEnvAtShipped(field, -0.3, -0.22)).toBe(false);
  });

  it("is exact for an integer and a colour", () => {
    const cells = ENV_FIELDS.find((f) => f.section === "floor" && f.name === "grainCells")!;
    expect(isEnvAtShipped(cells, 64, 64)).toBe(true);
    expect(isEnvAtShipped(cells, 65, 64)).toBe(false);
    const tint = ENV_FIELDS.find((f) => f.section === "decals" && f.name === "tyreTint")!;
    expect(isEnvAtShipped(tint, 0x141210, 0x141210)).toBe(true);
    expect(isEnvAtShipped(tint, 0x141211, 0x141210)).toBe(false);
  });
});

describe("envTableSource (EV33)", () => {
  it("is empty when nothing is overridden", () => {
    expect(envTableSource({})).toBe("");
  });

  it("emits only the touched sections, whole", () => {
    const source = envTableSource({ [envKey("grade", "saturate")]: -0.5 });
    expect(source).toContain("grade: {");
    expect(source).toContain("saturate: -0.5");
    expect(source).toContain("brightness: 0.96");
    expect(source).not.toContain("decals: {");
  });

  it("emits a colour as hex", () => {
    const source = envTableSource({ [envKey("decals", "tyreAlpha")]: 0.5 });
    expect(source).toContain("tyreTint: 0x141210");
  });

  it("does not emit a section whose only override was rejected", () => {
    // 33.5 is out of grid for an `integer` field (EV15) and so is dropped by `resolveEnvironment` —
    // the section it names must not be marked "touched" on the strength of a rejected entry alone.
    expect(envTableSource({ [envKey("floor", "grainCells")]: 33.5 })).toBe("");
  });

  it("round-trips a touched section back through resolveEnvironment to the same table", () => {
    // Same approach as `tuning.test.ts`'s `fxTableSource` round-trip case: evaluate the emitted
    // fragment as an object literal and compare it against what the resolver itself produces.
    const overrides = {
      [envKey("grade", "saturate")]: -0.5,
      [envKey("decals", "tyreTint")]: 0x203040,
    };
    const source = envTableSource(overrides);
    const parsed = new Function(`return {${source}};`)() as Record<string, Record<string, number>>;
    const resolved = resolveEnvironment(overrides) as unknown as Record<string, Record<string, number>>;
    for (const [section, fields] of Object.entries(parsed)) {
      for (const [name, value] of Object.entries(fields)) {
        // `decals.tyreTrackRatio` ships as 1/3 and is exported through `toFixed(6)` as "0.333333" —
        // an honest ~1e-6 truncation on a tyre-mark offset ratio, not worth changing the exporter's
        // number formatting for. Every other field round-trips exactly.
        if (section === "decals" && name === "tyreTrackRatio") {
          expect(value).toBeCloseTo(resolved[section]![name]!, 5);
        } else {
          expect(value).toBe(resolved[section]![name]);
        }
      }
    }
  });
});
