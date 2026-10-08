import type { ModeOverrides } from "../merge.js";

/**
 * Brawl's differences from the base (`modes/base.ts`). It hides the turret: the carried turret
 * weapons (each chassis's slot-1 weapon, plus roadblock) still aim with the mouse, but no turret is
 * drawn and it turns instantly. The snapshot `__snapshots__/brawl.tables.json` shows the result.
 */
export const BRAWL_OVERRIDES: ModeOverrides = {
  // No turret drawn and no turret turn delay; turret weapons still aim with the mouse.
  turret: { visible: false },
};
