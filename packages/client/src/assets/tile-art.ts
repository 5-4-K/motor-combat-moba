import { SPIKE_STRIP_COLOR, type ArenaColors } from "../scenes/arena-visual.js";
import type { BakeStamp } from "../scenes/tile-bake.js";
import type { FloorTextureLookup } from "./arena-floor.js";
import { tileArtKey } from "./asset-keys.js";

/** How one stamp of the tile bake is drawn: its art, or the procedural stand-in (TA25). */
export type TileDraw =
  | { readonly kind: "texture"; readonly key: string }
  | { readonly kind: "fill"; readonly color: number }
  | { readonly kind: "teeth" };

/**
 * Texture when the tile art loaded, procedural fallback when it did not — the AS23 property for
 * tiles: a missing PNG or a bad manifest row is never a black floor. The fallback is chosen by the
 * cell's BEHAVIOUR, never its art id (TC33), so a new floor look with no art yet draws as floor, not
 * as wall. Pure, like `resolveArenaFloor`, so the scene has nothing left to get wrong but calling it.
 */
export function resolveTileDraw(textures: FloorTextureLookup, stamp: BakeStamp, colors: ArenaColors): TileDraw {
  if (stamp.art !== null && textures.exists(tileArtKey(stamp.art))) return { kind: "texture", key: tileArtKey(stamp.art) };
  if (stamp.overlay) return { kind: "teeth" };
  if (!stamp.solid) return { kind: "fill", color: colors.floor };
  if (stamp.hazard !== null) return { kind: "fill", color: SPIKE_STRIP_COLOR };
  return { kind: "fill", color: colors.obstacle };
}
