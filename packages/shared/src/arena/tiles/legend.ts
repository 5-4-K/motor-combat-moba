import type { TileRotation } from "./tile-config.js";

/**
 * How an arena is authored (spec tile cells TC2, TC7, TC8, TC15, TC16): a per-arena legend maps one
 * character to one cell, and the rows are written in those characters. Plain JSON-able data, so a
 * future editor can read and write it.
 */

/** What an author writes for one cell (TC2). `tile` names a `TILE_DEFS` id. */
export interface TileCellSpec {
  readonly tile: string;
  readonly orientation?: TileRotation;
  readonly art?: string;
  /**
   * Defaults to `orientation` (TC5); written only when the art must face differently. `"random"`
   * turns each cell's art by a quarter turn chosen per cell, deterministically from the arena id and
   * the cell's position, so a repeated floor tile does not read as a grid of identical squares.
   */
  readonly artOrientation?: TileRotation | "random";
  /** Automatic by default (TC6); an explicit stamp replaces it, `"none"` suppresses it. */
  readonly overlay?: { readonly art: string; readonly orientation: TileRotation } | "none";
  /**
   * The art the definition's AUTOMATIC overlay wears on this cell (TC43) — same edges, another look,
   * so one arena can have wooden teeth without a second spike definition. Only on a definition with
   * an overlay rule, and never beside an explicit `overlay`.
   */
  readonly overlayArt?: string;
}

export type TileLegend = Readonly<Record<string, TileCellSpec>>;

/** Applies to every arena (TC8). An arena that uses only these keys needs no legend. */
export const DEFAULT_LEGEND: TileLegend = {
  ".": { tile: "floor" },
  "#": { tile: "wall" },
  "^": { tile: "spike" },
  " ": { tile: "void" },
};

/** TC15: an arena key replaces a default key whole. Throws (TC18) on a key that is not exactly one character. */
export function effectiveLegend(arenaId: string, legend: TileLegend | undefined): TileLegend {
  for (const key of Object.keys(legend ?? {})) {
    if ([...key].length !== 1) throw new Error(`Tile arena ${arenaId}: legend key ${JSON.stringify(key)} must be one character`);
  }
  return { ...DEFAULT_LEGEND, ...legend };
}
