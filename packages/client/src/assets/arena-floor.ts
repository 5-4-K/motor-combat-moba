import type Phaser from "phaser";
import type { EnvironmentFx } from "../fx/environment.js";
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

/**
 * The multiply colour an arena's floor art is drawn with — `ENVIRONMENT_FX.floorArt` resolved into
 * the single number `Image.setTint` wants.
 *
 * **Why the floor gets knocked back at all.** Floor art is authored as a picture: it uses the middle
 * of the value range and fills it with detail. A car is a small, mid-value, desaturated sprite, and
 * the camera grade cannot help — it is applied to the whole world camera, so it moves the cars and
 * the floor together and creates no separation by construction. Taking light OFF the ground is what
 * puts the cars back on top of it, and it does the same for shots, spikes and lava in one move.
 *
 * Two knobs with distinct jobs, multiplied: `tint` picks the deck's temperature, `darken` picks its
 * value. `darken: 0` with a white `tint` returns `0xffffff`, which multiplies by one — pixel-
 * identical to the untinted draw this shipped without, so the panel can switch it fully off.
 *
 * `darken` is clamped rather than trusted: a negative value would otherwise scale channels past 255
 * and carry into the next byte, turning "too bright" into a hue shift that reads as a rendering bug.
 *
 * Pure, and in this module rather than in `ArenaScene`, for the reason the whole file exists — the
 * scene cannot be unit-tested without a browser (`packages/client/CLAUDE.md`).
 */
export function floorTintOf(floorArt: EnvironmentFx["floorArt"]): number {
  const keep = 1 - Math.min(1, Math.max(0, floorArt.darken));
  let out = 0;
  for (let shift = 16; shift >= 0; shift -= 8) {
    const channel = (floorArt.tint >> shift) & 0xff;
    out |= Math.min(255, Math.max(0, Math.round(channel * keep))) << shift;
  }
  // `|=` on a value with bit 23 set can yield a negative int32; `>>> 0` puts it back in 0..0xffffff.
  return out >>> 0;
}
