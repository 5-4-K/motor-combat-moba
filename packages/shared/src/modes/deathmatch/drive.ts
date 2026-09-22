// GENERATED then hand-maintained: seeded verbatim from today's live config by
// scripts/seed-mode-folders.mjs (deleted after use), then committed as ordinary source.

import type { DriveConfig } from "../../config/drive-config.js";

export const DEATHMATCH_DRIVE = {
  baseMaxSpeed: 90,
  speedPerRating: 2.277,
  baseTurnRate: 1.0005,
  turnRatePerRating: 0.02535,
  reverseAccelFactor: 0.6,
  stopEpsilon: 0.001,
  dashSubstepMaxUnits: 16,
  restitution: 0,
  baseDrag: 0.768,
  dragPerRating: 0.00608,
  lateralGripRate: 3,
  reverseEpsilon: 6,
  flipSteeringInReverse: false,
} as const satisfies Omit<DriveConfig, "carWidth" | "carHeight">;
