import type { ArenaId } from "../../arena/registry.js";
import type { ModeOverrides } from "../merge.js";

/**
 * Conquer's differences from the base. It plays its own arena (CQ20); every number is the base's.
 *
 * CQ42: with arena-03's ~810 u spawn-to-zone distance, the base `deathmatch.phaseMaxSeconds`
 * ceiling is what keeps a freshly respawned (phased) car from arriving at the zone still
 * untouchable. Phased enemies DO contest (CQ10), so raising it, or moving spawns toward the zone,
 * lets a car stall a capture while immune. Re-check that before tuning it.
 */
export const CONQUER_OVERRIDES: ModeOverrides = {
  arenas: ["arena-03"] as readonly ArenaId[],
};
