import type Phaser from "phaser";
import { carSpriteKey } from "./asset-keys.js";
import type { AssetManifest, SpriteEntry } from "./manifest-schema.js";
import { fitSprite, type Size, type SpriteFit } from "./sprite-fit.js";

/**
 * The slice of Phaser's `TextureManager` the resolution chain needs. Narrowed to two methods so the
 * chain is a pure function of data and can be unit-tested in the node environment, where importing
 * Phaser is not allowed.
 */
export interface TextureLookup {
  exists(key: string): boolean;
  sizeOf(key: string): Size;
}

/** A chassis that has art: which key, which entry, and how to draw it against the hull. */
export interface ResolvedSprite {
  readonly key: string;
  readonly entry: SpriteEntry;
  readonly fit: SpriteFit;
}

/**
 * The manifest sprite for a chassis, or `undefined` when there is no entry or its texture never
 * loaded — the two cases that must both fall through to the procedural silhouette. `exists` is the
 * load check: `BootScene` warns on a file it could not load but carries on, so a named-but-missing
 * file reaches here as a simply absent texture, indistinguishable from having no entry at all.
 *
 * Shared by `ArenaScene.spriteFor` and the `?dev=assets` tuning tool on purpose. The tuner's whole
 * value is that what it shows is what the arena draws; with the decision in one place, a later
 * change to the composition cannot leave the two disagreeing and the tuner showing a lie.
 */
export function resolveCarSprite(
  manifest: AssetManifest,
  textures: TextureLookup,
  carId: string,
  hull: Size,
): ResolvedSprite | undefined {
  const key = carSpriteKey(carId);
  const entry = manifest.sprites[key];
  if (!entry || !textures.exists(key)) return undefined;
  return { key, entry, fit: fitSprite(entry, textures.sizeOf(key), hull) };
}

/**
 * Apply a resolved sprite to an image. The order — origin, then scale, then rotation, then tint —
 * lives here and nowhere else, for the same fidelity reason `resolveCarSprite` does.
 */
export function applyCarSprite(
  image: Phaser.GameObjects.Image,
  resolved: ResolvedSprite,
  fill: number,
): Phaser.GameObjects.Image {
  image.setOrigin(resolved.fit.originX, resolved.fit.originY);
  image.setScale(resolved.fit.scale);
  image.setRotation(resolved.fit.rotation);
  if (resolved.entry.colorMode === "tint") image.setTint(fill);
  return image;
}

/**
 * A `TextureLookup` backed by a real Phaser `TextureManager`. `import type` only, so this module
 * stays importable from a node test even though this function is only ever called from a scene.
 */
export function phaserTextures(manager: Phaser.Textures.TextureManager): TextureLookup {
  return {
    exists: (key) => manager.exists(key),
    sizeOf: (key) => {
      const source = manager.get(key).getSourceImage();
      return { width: source.width, height: source.height };
    },
  };
}
