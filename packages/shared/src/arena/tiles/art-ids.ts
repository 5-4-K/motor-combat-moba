import { ARENAS } from "../registry.js";
import type { ArenaDef } from "../types.js";
import { TILE_DEFS, type TileDef } from "./tile-config.js";

const defs = (): readonly TileDef[] => Object.values(TILE_DEFS) as readonly TileDef[];

const registeredArenas = (): readonly ArenaDef[] => Object.values(ARENAS) as readonly ArenaDef[];

const sortedUnique = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();

/**
 * Art ids drawn as an edge overlay: authored for the top edge and transparent elsewhere, so an
 * opaque image would paint a square over its tile (TC31). `check:art` blocks a no-alpha one. Covers
 * the definitions' overlay rules and every overlay a registered arena's cells carry.
 */
export function overlayArtIds(arenas: readonly ArenaDef[] = registeredArenas()): string[] {
  const ids: string[] = [];
  for (const def of defs()) if (def.overlay !== undefined) ids.push(def.overlay.art);
  for (const arena of arenas) for (const cell of arena.tiles?.cells ?? []) for (const o of cell.overlays) ids.push(o.art);
  return sortedUnique(ids);
}

/**
 * Every art id a definition defaults to, or an overlay rule names, or a registered arena's resolved
 * cells actually carry (TC31). `check:art` warns on one with no manifest row.
 */
export function referencedTileArtIds(arenas: readonly ArenaDef[] = registeredArenas()): string[] {
  const ids: string[] = [];
  for (const def of defs()) {
    if (def.defaultArt !== undefined) ids.push(def.defaultArt);
    if (def.overlay !== undefined) ids.push(def.overlay.art);
  }
  for (const arena of arenas) {
    for (const cell of arena.tiles?.cells ?? []) {
      if (cell.base !== null) ids.push(cell.base.art);
      for (const o of cell.overlays) ids.push(o.art);
    }
  }
  return sortedUnique(ids);
}
