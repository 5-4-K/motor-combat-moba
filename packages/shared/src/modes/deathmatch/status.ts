// GENERATED then hand-maintained: seeded verbatim from today's live config by
// scripts/seed-mode-folders.mjs (deleted after use), then committed as ordinary source.

import type { StatusConfig, StatusLimits } from "../../config/status-config.js";
import type { StatusDef, StatusId } from "../../config/status-types.js";

export const DEATHMATCH_STATUS_CONFIG = {
  maxActive: 6,
  maxDurationMs: 10000,
} as const satisfies StatusConfig;

export const DEATHMATCH_STATUS_TABLE = {
  overheated: {
    id: "overheated",
    name: "Overheated",
    kind: "debuff",
    color: "#d9480f",
    reapply: "refresh",
    modifiers: {},
    pulse: {
      intervalMs: 400,
      damage: 8,
    },
  },
  corroded: {
    id: "corroded",
    name: "Corroded",
    kind: "debuff",
    color: "#74b816",
    reapply: "refresh",
    modifiers: {
      damageTaken: 1.3,
    },
  },
  stunned: {
    id: "stunned",
    name: "Stunned",
    kind: "debuff",
    color: "#4263eb",
    reapply: "ignore",
    modifiers: {},
    flags: [
      "immobilised",
      "steeringLocked",
      "disarmed",
      "fullStop",
    ],
  },
  spiked: {
    id: "spiked",
    name: "Spiked",
    kind: "debuff",
    color: "#0c8599",
    reapply: "refresh",
    modifiers: {
      topSpeed: 0.6,
    },
  },
  fortified: {
    id: "fortified",
    name: "Fortified",
    kind: "buff",
    color: "#1971c2",
    reapply: "refresh",
    modifiers: {
      damageTaken: 0.7,
    },
  },
  overhauled: {
    id: "overhauled",
    name: "Overhauled",
    kind: "buff",
    color: "#f1f3f5",
    reapply: "ignore",
    modifiers: {},
    onApply: {
      cleanse: "debuff",
    },
  },
  armored: {
    id: "armored",
    name: "Armored",
    kind: "buff",
    color: "#868e96",
    reapply: "refresh",
    chainable: true,
    modifiers: {},
    flags: [
      "invulnerable",
    ],
  },
  phased: {
    id: "phased",
    name: "Phasing",
    kind: "buff",
    color: "#4dabf7",
    reapply: "refresh",
    chainable: true,
    modifiers: {},
    flags: [
      "phased",
    ],
  },
  reeling: {
    id: "reeling",
    name: "Reeling",
    kind: "debuff",
    color: "#e8590c",
    reapply: "ignore",
    modifiers: {
      grip: 0.6,
    },
    flags: [
      "immobilised",
      "steeringLocked",
      "spinFree",
      "ramBlocked",
    ],
  },
  ramLock: {
    id: "ramLock",
    name: "Ram Lock",
    kind: "debuff",
    color: "#adb5bd",
    reapply: "ignore",
    modifiers: {},
    flags: [
      "immobilised",
      "steeringLocked",
      "ramBlocked",
    ],
  },
} as const satisfies Record<StatusId, StatusDef>;

export const DEATHMATCH_STATUS_LIMITS = {
  topSpeed: {
    min: 0.5,
    max: 2,
  },
  accel: {
    min: 0.4,
    max: 2.5,
  },
  turnRate: {
    min: 0.4,
    max: 2,
  },
  brakeDecel: {
    min: 0.6,
    max: 1.5,
  },
  damageDealt: {
    min: 0.5,
    max: 2,
  },
  damageTaken: {
    min: 0.4,
    max: 2.5,
  },
  weaponCooldown: {
    min: 0.4,
    max: 3,
  },
  ramDefence: {
    min: 0.5,
    max: 2,
  },
  grip: {
    min: 0.25,
    max: 2,
  },
} as const satisfies StatusLimits;

