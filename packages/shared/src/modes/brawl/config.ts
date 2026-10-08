import type { ModeOverrides } from "../merge.js";

/**
 * Brawl's differences from the base (`modes/base.ts`). Add only the values Brawl changes; the
 * snapshot `__snapshots__/brawl.tables.json` shows the resolved result.
 *
 * Brawl turns the basic attack (fire slot 0, LMB) ON — the base ships it off. This also turns on
 * turret drawing, pointer lock and the crosshair for Brawl, since the nine basic-attack rows are
 * the build's only turret-carrying weapons.
 */
export const BRAWL_OVERRIDES: ModeOverrides = {
  slots: { basicAttackEnabled: true },
};
