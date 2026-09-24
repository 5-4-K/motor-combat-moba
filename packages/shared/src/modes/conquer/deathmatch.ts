// GENERATED then hand-maintained: seeded verbatim from today's live config by
// scripts/seed-mode-folders.mjs (deleted after use), then committed as ordinary source.

import type { DeathmatchConfig } from "../../config/deathmatch-config.js";

export const CONQUER_DEATHMATCH = {
  matchSeconds: 180,
  respawnDelaySeconds: 5,
  phaseSeconds: 1.5,
  /**
   * CQ42: with arena-03's ~810 u spawn-to-zone distance, this ceiling is what keeps a freshly
   * respawned (phased) car from arriving at the zone still untouchable. Phased enemies DO contest
   * (CQ10), so raising this, or moving spawns toward the zone, lets a car stall a capture while
   * immune. Re-check that before tuning it.
   */
  phaseMaxSeconds: 3,
} as const satisfies DeathmatchConfig;
