import type Phaser from "phaser";
import { carSpriteKey } from "./asset-keys.js";
import type { AssetManifest, SpriteEntry } from "./manifest-schema.js";
import { fitSprite, type Size, type SpriteFit } from "./sprite-fit.js";
import { ENVIRONMENT_FX, type EnvironmentFx } from "../fx/environment.js";
import { tintCornersFor } from "../scenes/car-lighting.js";

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
 *
 * `rotation` is the car's total WORLD rotation, which is what turns the flat tint into a lit one:
 * `tintCornersFor` needs it to keep the highlight on the same side of the screen as the car turns.
 * It defaults to 0 so a still picture of a car — the `?dev=assets` tool, the car-select preview —
 * gets the same lighting the arena gives a car pointing along +x, rather than no lighting at all.
 *
 * The gradient lives HERE rather than in `ArenaScene` deliberately. This helper is shared with the
 * asset tuning tool precisely so the tool cannot drift from what the arena draws, and tinting in the
 * scene instead would reintroduce that drift immediately: the tool would still be showing the flat
 * colour the arena had stopped using.
 */
export function applyCarSprite(
  image: Phaser.GameObjects.Image,
  resolved: ResolvedSprite,
  fill: number,
  look: EnvironmentFx["carLook"] = ENVIRONMENT_FX.carLook,
  rotation = 0,
): Phaser.GameObjects.Image {
  image.setOrigin(resolved.fit.originX, resolved.fit.originY);
  image.setScale(resolved.fit.scale);
  image.setRotation(resolved.fit.rotation);
  if (resolved.entry.colorMode === "tint") tintCarSprite(image, fill, look, rotation);
  return image;
}

/**
 * Re-light an already-placed sprite. The per-frame half of `applyCarSprite`'s tint.
 *
 * Split out because everything else that helper does is fixed at build time, while this has to run
 * every frame the car's heading changes — and because a caller that re-ran the whole of the above
 * per frame would be re-deriving the sprite's fit sixty times a second for nothing.
 *
 * The rotation handed on is the sprite's own local rotation ADDED to the car's, since `fitSprite`
 * may itself have turned the image inside its container; the lighting cares only about where the
 * pixels finally point in the world.
 */
export function tintCarSprite(
  image: Phaser.GameObjects.Image,
  fill: number,
  look: EnvironmentFx["carLook"],
  rotation: number,
): void {
  const corners = tintCornersFor(fill, rotation + image.rotation, look);
  image.setTint(corners.topLeft, corners.topRight, corners.bottomLeft, corners.bottomRight);
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
