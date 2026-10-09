import { getArena, modeConfigOrDefault } from "@motor-combat-moba/shared";
import { arenaPreviewKey } from "../assets/asset-keys.js";
import type { AssetManifest } from "../assets/manifest-schema.js";

/**
 * Everything the arena select screen knows about an arena (AR26). The screen draws these and
 * nothing else; this file is the only one on the client that turns an arena id into them.
 */
export interface ArenaCard {
  id: string;
  name: string;
  previewUrl: string | null;
}

/**
 * The room's mode's arenas, in list order. Read through `modeConfigOrDefault(mode)` rather than the
 * installed bundle: the host can switch mode in the lobby, and the screen must show THAT mode's list.
 */
export function arenaCards(mode: number, manifest: AssetManifest): ArenaCard[] {
  return modeConfigOrDefault(mode).arenas.map((id) => {
    const row = manifest.sprites[arenaPreviewKey(id)];
    return { id, name: getArena(id).displayName, previewUrl: row ? `art/${row.file}` : null };
  });
}
