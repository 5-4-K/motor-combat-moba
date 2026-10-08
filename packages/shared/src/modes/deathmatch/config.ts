import type { ModeOverrides } from "../merge.js";

/**
 * Deathmatch's differences from the base (`modes/base.ts`). Empty: Deathmatch plays the common
 * defaults. Add only the values Deathmatch changes; the snapshot
 * `__snapshots__/deathmatch.tables.json` shows the resolved result.
 */
export const DEATHMATCH_OVERRIDES: ModeOverrides = {
  // A wreck comes back, so it watches nobody and holds where it died (was `rulesOf().respawns`).
  camera: { spectate: { target: "none" } },
  // Basic attack (fire slot 0, LMB) ON — the base ships it off. Also turns on turret drawing,
  // pointer lock and the crosshair for Deathmatch (the basic-attack rows are the only turret rows).
  slots: { basicAttackEnabled: true },
};
