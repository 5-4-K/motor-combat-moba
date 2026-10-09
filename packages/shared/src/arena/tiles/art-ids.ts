import { ARENAS } from "../registry.js";
import type { ArenaDef } from "../types.js";
import { TILE_DEFS, type TileDef } from "./tile-config.js";

const defs = (): readonly TileDef[] => Object.values(TILE_DEFS) as readonly TileDef[];

const sortedUnique = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();

/**
 * Art ids drawn as an edge overlay: authored for the top edge and transparent elsewhere, so an
 * opaque image would paint a square over its tile (TC31). `check:art` blocks a no-alpha one.
 */
export function overlayArtIds(): string[] {
  const ids: string[] = [];
  for (const def of defs()) if (def.overlay !== undefined) ids.push(def.overlay.art);
  return sortedUnique(ids);
}

/**
 * Every art id a definition defaults to, or an overlay rule names, or a registered arena's resolved
 * cells actually carry (TC31). `check:art` warns on one with no manifest row.
 */
export function referencedTileArtIds(): string[] {
  const ids: string[] = [];
  for (const def of defs()) {
    if (def.defaultArt !== undefined) ids.push(def.defaultArt);
    if (def.overlay !== undefined) ids.push(def.overlay.art);
  }
  for (const arena of Object.values(ARENAS) as readonly ArenaDef[]) {
    for (const cell of arena.tiles?.cells ?? []) {
      if (cell.base !== null) ids.push(cell.base.art);
      for (const o of cell.overlays) ids.push(o.art);
    }
  }
  return sortedUnique(ids);
}
