// GENERATED then hand-maintained: seeded verbatim from today's live config by
// scripts/seed-mode-folders.mjs (deleted after use), then committed as ordinary source.

import type { RamConfig } from "../../config/ram-config.js";

export const BRAWL_RAM = {
  contactPad: 1,
  minRamSpeed: 39,
  headOnAngleDeg: 45,
  cornerBandUnits: 4,
  headOnScale: 0.2,
  flankScale: 1.5,
  rearScale: 1.2,
  globalScale: 0.6,
  spinScale: 0.3,
  spinMaxRate: 6,
  spinEpsilon: 0.01,
  reelingSpinDecayRate: 2,
  attackerLockMs: 500,
  ramUncontrolMs: 1000,
  drWindowMs: 2000,
  durationDrScale: 0.5,
  durationDrFloorMs: 150,
  impulseDrScale: 0.5,
  impulseDrFloor: 0.25,
} as const satisfies RamConfig;
