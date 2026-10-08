import { SPIKE_STRIP_COLOR, type ArenaColors } from "../scenes/arena-visual.js";
import { SPIKE_TEETH_ART } from "../scenes/tile-bake.js";
import type { FloorTextureLookup } from "./arena-floor.js";
import { tileArtKey } from "./asset-keys.js";

/** How one stamp of the tile bake is drawn: its art, or the procedural stand-in (TA25). */
export type TileDraw =
  | { readonly kind: "texture"; readonly key: string }
  | { readonly kind: "fill"; readonly color: number }
  | { readonly kind: "teeth" };

/**
 * Texture when the tile art loaded, procedural fallback when it did not — the AS23 property for
 * tiles: a missing PNG or a bad manifest row is never a black floor. Pure, like `resolveArenaFloor`,
 * so the scene has nothing left to get wrong but calling it.
 */
export function resolveTileDraw(textures: FloorTextureLookup, art: string, colors: ArenaColors): TileDraw {
  const key = tileArtKey(art);
  if (textures.exists(key)) return { kind: "texture", key };
  if (art === SPIKE_TEETH_ART) return { kind: "teeth" };
  if (art === "floor") return { kind: "fill", color: colors.floor };
  if (art === "spike") return { kind: "fill", color: SPIKE_STRIP_COLOR };
  return { kind: "fill", color: colors.obstacle };
}
