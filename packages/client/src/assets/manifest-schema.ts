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
