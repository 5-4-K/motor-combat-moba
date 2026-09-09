import type { EnvironmentFx } from "./environment.js";
import { ENVIRONMENT_FX } from "./environment.js";

/**
 * The playground's environment tuning model (spec EV13-EV19).
 *
 * Pure and Phaser-free, so it runs under vitest's node environment beside the rest of `fx/`. It is
 * deliberately FLAT where `fx/tuning.ts` is a grid (EV14): a weapon row is rectangular — two phases
 * by four channels — and the environment is ten sections of heterogeneous scalars, so a grid here
 * would be mostly holes.
 */
export type EnvSection = keyof EnvironmentFx;

export interface EnvFieldDef {
  readonly section: EnvSection;
  readonly name: string;
  readonly label: string;
  /**
   * `integer` is not cosmetic: `floor.grainCells` and `floor.patchCells` are `tileableFbm`'s period
   * in cells, and a fractional period stops the lattice closing — the seam bug the tiling test in
   * `textures.test.ts` exists to catch (EV15). `color` is edited as hex rather than dragged.
   */
  readonly kind: "number" | "integer" | "color";
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const c = (
  section: EnvSection,
  name: string,
  label: string,
  min: number,
  max: number,
  step: number,
  kind: EnvFieldDef["kind"] = "number",
): EnvFieldDef => ({ section, name, label, kind, min, max, step });

/**
 * Every editable field, with the range its control spans.
 *
 * Ranges contain every shipped value with headroom and are deliberately NOT a budget guard, the
 * same rule `FX_FIELDS` states: a panel that refuses an extreme is a panel that cannot answer "is
 * this too much". The reachability test in `env-tuning.test.ts` holds this list to
 * `EnvironmentFx` in both directions, so a knob added to the table without a row here fails the
 * suite rather than silently not appearing in the panel.
 */
export const ENV_FIELDS: readonly EnvFieldDef[] = [
  c("grade", "saturate", "Saturate", -1, 1, 0.01),
  c("grade", "warmR", "Warm R", 0.5, 1.5, 0.01),
  c("grade", "warmB", "Warm B", 0.5, 1.5, 0.01),
  c("grade", "brightness", "Brightness", 0.5, 1.5, 0.01),

  c("vignette", "x", "Centre X", 0, 1, 0.01),
  c("vignette", "y", "Centre Y", 0, 1, 0.01),
  c("vignette", "radius", "Radius", 0, 1.5, 0.01),
  c("vignette", "strength", "Strength", 0, 1, 0.01),

  c("shake", "max", "Max intensity", 0, 0.1, 0.001),
  c("shake", "diedMs", "Kill (ms)", 0, 1000, 10),
  c("shake", "damagedMs", "Hit (ms)", 0, 1000, 10),
  c("shake", "damagedBase", "Hit floor", 0, 0.02, 0.0005),
  c("shake", "damagedPerHp", "Hit per hp", 0, 0.001, 0.00001),
  c("shake", "damagedCap", "Hit cap x max", 0, 1, 0.01),
  c("shake", "explosionMs", "Explosion (ms)", 0, 1000, 10),
  c("shake", "explosionCap", "Explosion cap x max", 0, 1, 0.01),
  c("shake", "ramMs", "Ram (ms)", 0, 1000, 10),
  c("shake", "ramFloor", "Ram floor", 0, 0.02, 0.0005),
  c("shake", "ramPerSpeed", "Ram per speed", 0, 0.0002, 0.000005),
  c("shake", "ramCap", "Ram cap x max", 0, 1, 0.01),

  c("hitStop", "ms", "Duration (ms)", 0, 500, 10),
  c("hitStop", "scale", "Time scale", 0, 1, 0.01),

  c("decals", "halfLifeMs", "Half-life (ms)", 1000, 120000, 1000),
  c("decals", "maxTotal", "Max decals", 0, 2000, 10, "integer"),
  c("decals", "maxScorch", "Max scorch", 0, 1000, 10, "integer"),
  c("decals", "fadeCutoff", "Fade cutoff", 0, 0.2, 0.005),
  c("decals", "tyreSpacing", "Tyre spacing", 1, 40, 0.5),
  c("decals", "tyreMaxStep", "Tyre max step", 10, 300, 5),
  c("decals", "tyreSpeedFloor", "Tyre speed floor", 0, 300, 5),
  c("decals", "tyreTrackRatio", "Track ratio x hull", 0, 1, 0.01),
  c("decals", "tyreRadius", "Tyre radius", 0.5, 12, 0.1),
  c("decals", "tyreAlpha", "Tyre alpha", 0, 1, 0.01),
  c("decals", "tyreTint", "Tyre tint", 0, 0xffffff, 1, "color"),
  c("decals", "scorchAlphaShot", "Scorch alpha (shot)", 0, 1, 0.01),
  c("decals", "scorchAlphaDeath", "Scorch alpha (death)", 0, 1, 0.01),
  c("decals", "scorchScaleDeath", "Scorch scale (death)", 0, 4, 0.05),
  c("decals", "scorchScaleDefault", "Scorch scale (default)", 0, 4, 0.05),

  c("occlusion", "halo", "Smoke hole halo", 0, 60, 1),

  c("floor", "grainCells", "Grain cells", 4, 256, 4, "integer"),
  c("floor", "patchCells", "Patch cells", 1, 64, 1, "integer"),
  c("floor", "grainOctaves", "Grain octaves", 1, 6, 1, "integer"),
  c("floor", "patchOctaves", "Patch octaves", 1, 6, 1, "integer"),
  c("floor", "grainWeight", "Grain weight", 0, 1, 0.01),
  c("floor", "patchWeight", "Patch weight", 0, 1, 0.01),
  c("floor", "baseGrey", "Base grey", 0, 255, 1),
  c("floor", "greySpan", "Grey span", 0, 200, 1),
  c("floor", "warmR", "Warm R offset", -20, 20, 1),
  c("floor", "warmG", "Warm G offset", -20, 20, 1),
  c("floor", "warmB", "Warm B offset", -20, 20, 1),

  c("markings", "laneColor", "Paint colour", 0, 0xffffff, 1, "color"),
  c("markings", "laneAlpha", "Lane alpha", 0, 1, 0.01),
  c("markings", "laneWidth", "Lane width", 0, 20, 1),
  c("markings", "laneSpacing", "Lane spacing", 10, 200, 2),
  c("markings", "laneDash", "Lane dash", 0, 200, 2),
  c("markings", "laneMargin", "Lane margin", 0, 200, 5),
  c("markings", "circleAlpha", "Circle alpha", 0, 1, 0.01),
  c("markings", "circleWidth", "Circle width", 0, 20, 1),
  c("markings", "circleRadius", "Circle radius", 0, 600, 5),

  c("carBursts", "sparkPerHp", "Sparks per hp", 0, 3, 0.05),
  c("carBursts", "countFloor", "Count floor", 0, 10, 1, "integer"),

  // Baked into the texture — these four need the panel's Regenerate button (EV27, LZ38).
  c("lava", "cells", "Plates across", 3, 20, 1, "integer"),
  c("lava", "octaves", "Grain octaves", 1, 6, 1, "integer"),
  c("lava", "seamWidth", "Seam width", 0.02, 0.5, 0.01),
  c("lava", "featherStart", "Feather start", 0.3, 1, 0.01),
  // Live.
  c("lava", "crustTint", "Crust tint", 0, 0xffffff, 1, "color"),
  c("lava", "crustAlpha", "Crust alpha", 0, 1, 0.01),
  c("lava", "seamTint", "Seam tint", 0, 0xffffff, 1, "color"),
  c("lava", "seamAlpha", "Seam alpha", 0, 1, 0.01),
  c("lava", "pulseHz", "Pulse (Hz)", 0, 4, 0.05),
  c("lava", "pulseDepth", "Pulse depth", 0, 1, 0.01),
];

export function envKey(section: EnvSection, field: string): string {
  return `${section}.${field}`;
}

/** A sparse map of `"<section>.<field>"` to its value. Colours are stored as integers (EV17). */
export type EnvOverrides = Record<string, number>;

/** How a consumer asks for the live table. `() => ENVIRONMENT_FX` is the shipped implementation. */
export type EnvResolver = () => EnvironmentFx;

export function shippedEnvValue(field: EnvFieldDef): number {
  return (ENVIRONMENT_FX as unknown as Record<string, Record<string, number>>)[field.section]![
    field.name
  ]!;
}

/**
 * Is `value` acceptable for `field` — finite, in range, and (for an `integer` field) whole?
 *
 * Exported so `storage.ts`'s `sanitizeStoredEnv` can share this exact rule rather than re-implement
 * it: the two used to be two copies of the same three checks, free to drift the moment either side
 * was edited alone.
 */
export function isAcceptableEnvValue(field: EnvFieldDef, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value < field.min || value > field.max) return false;
  // A fractional cell count reopens the tiling seam, and a fractional decal cap is meaningless.
  if (field.kind !== "number" && !Number.isInteger(value)) return false;
  return true;
}

/**
 * The table with the override map applied.
 *
 * Rebuilt rather than mutated, and section-by-section rather than deep-cloned, because the result is
 * handed to consumers that may hold it for a frame. `liveEnvResolver` is what stops this running per
 * particle — see `fx/env-store.ts` (EV19).
 */
export function resolveEnvironment(overrides: EnvOverrides): EnvironmentFx {
  const out = {} as Record<string, Record<string, number>>;
  for (const [section, values] of Object.entries(ENVIRONMENT_FX)) {
    out[section] = { ...(values as Record<string, number>) };
  }
  for (const field of ENV_FIELDS) {
    const value = overrides[envKey(field.section, field.name)];
    if (value === undefined) continue;
    if (!isAcceptableEnvValue(field, value)) continue;
    out[field.section]![field.name] = value;
  }
  return out as unknown as EnvironmentFx;
}

/**
 * Should this control's value be treated as shipped, i.e. should its override entry be DELETED?
 *
 * The half-step rule `isFxAtShipped` and `isAtShipped` already share, and for the same reason: a
 * range input snaps to its `min`/`step` grid and a shipped value very often does not sit on it, so a
 * strict comparison would leave a phantom override behind every time a slider was dragged back.
 * `integer` and `color` compare exactly — there is no grid to miss (EV16).
 */
export function isEnvAtShipped(field: EnvFieldDef, value: number, shipped: number): boolean {
  if (field.kind !== "number") return value === shipped;
  return Math.abs(value - shipped) < field.step / 2;
}

function valueSource(field: EnvFieldDef, value: number): string {
  if (field.kind === "color") return `0x${value.toString(16).padStart(6, "0")}`;
  return String(Number(value.toFixed(6)));
}

/**
 * The overrides as a pasteable `ENVIRONMENT_FX` fragment (EV33).
 *
 * Whole sections, and only the touched ones. `fxTableSource` emits full weapon rows because there
 * are ten independent rows; there is exactly one environment table, so the useful granularity here
 * is the section — a paste replaces `grade` entirely and leaves `decals` alone.
 *
 * Empty string when nothing is overridden: there is nothing to paste.
 */
export function envTableSource(overrides: EnvOverrides): string {
  const resolved = resolveEnvironment(overrides) as unknown as Record<string, Record<string, number>>;
  const touched = new Set<string>();
  for (const field of ENV_FIELDS) {
    const value = overrides[envKey(field.section, field.name)];
    if (value !== undefined && isAcceptableEnvValue(field, value)) touched.add(field.section);
  }
  if (touched.size === 0) return "";

  const sections: string[] = [];
  for (const section of Object.keys(ENVIRONMENT_FX)) {
    if (!touched.has(section)) continue;
    const rows = ENV_FIELDS.filter((f) => f.section === section).map(
      (f) => `    ${f.name}: ${valueSource(f, resolved[section]![f.name]!)},`,
    );
    sections.push([`  ${section}: {`, ...rows, `  },`].join("\n"));
  }
  return sections.join("\n");
}
