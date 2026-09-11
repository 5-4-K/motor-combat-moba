import type Phaser from "phaser";
import { arenaFloorKey } from "./asset-keys.js";

/**
 * The slice of Phaser's `TextureManager` the floor's resolution needs. Narrower than car-sprite's
 * `TextureLookup` (`exists` and `sizeOf`): the floor sprite is drawn at a fixed world rect
 * (`setDisplaySize` to `arena.width`/`arena.height`), never fitted to a hull, so there is no
 * source-image size to read here.
 */
export interface FloorTextureLookup {
  exists(key: string): boolean;
}

/** An arena that has floor art: the manifest key to draw it from. */
export interface ResolvedFloor {
  readonly key: string;
}

/**
 * The floor art for an arena, or `undefined` when its texture never loaded — no manifest row, a
 * malformed row, or a file that failed to decode. All three converge on the same absent texture, and
 * all three must fall through to the procedural asphalt tile: that fallback is the property this
 * task exists to protect (AS23), and it is not automatically covered by anything else in the suite —
 * `ArenaScene` itself cannot be unit-tested without a browser (`packages/client/CLAUDE.md`). `exists`
 * is the load check: `BootScene` warns on a file it could not load but carries on, so a
 * named-but-missing file reaches here indistinguishable from having no row at all — the same
 * reasoning `resolveCarSprite` (`car-sprite.ts`) documents for cars.
 *
 * Pure, mirroring `resolveCarSprite`'s shape, so the decision can be unit-tested in the node
 * environment, where importing Phaser is not allowed, and so `ArenaScene.drawArena` has nothing left
 * to get wrong beyond calling this and branching on the result.
 */
export function resolveArenaFloor(
  textures: FloorTextureLookup,
  arenaId: string,
): ResolvedFloor | undefined {
  const key = arenaFloorKey(arenaId);
  return textures.exists(key) ? { key } : undefined;
}

/**
 * A `FloorTextureLookup` backed by a real Phaser `TextureManager`. `import type` only, so this
 * module stays importable from a node test even though this function is only ever called from a
 * scene — the same split `phaserTextures` in `car-sprite.ts` makes for cars.
 */
export function phaserFloorTextures(manager: Phaser.Textures.TextureManager): FloorTextureLookup {
  return { exists: (key) => manager.exists(key) };
}
