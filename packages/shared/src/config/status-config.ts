import type { StatusChannel, StatusDef, StatusId } from "./status-types.js";

/**
 * Status system tuning. Every value here is read by the sim on both sides of the lockstep, so this
 * is networked balance rather than render preference — the same standing as `RAM_CONFIG`.
 */
export const STATUS_CONFIG = {
  /**
   * The most statuses one car may be in at once.
   *
   * A wire guard first: `PlayerState.statuses` is patched to every client, and an unbounded list is
   * an unbounded patch. It is also a design ceiling — a car wearing six simultaneous rule changes
   * cannot be read at a glance by the player driving it, let alone by the one shooting at it.
   *
   * At the cap a NEW status is dropped rather than evicting a running one. Rejecting is the
   * predictable half: an attacker can never use a cheap status to push a meaningful one off a
   * target. Re-applying a status already running is not a new id and is never dropped.
   */
  maxActive: 6,
  /**
   * Longest duration any applier may ask for. Bounds the ceiling of the design rather than any one
   * row: past roughly a fight's length a status stops being a window and becomes a state of the
   * match, and in a six-player free-for-all that is how one early engagement decides everything.
   *
   * Raised from 8000 for `wildcharge`'s 10 s fortified (spec); still bounds a status to roughly a
   * fight's length.
   */
  maxDurationMs: 10000,
} as const;

/**
 * The floor and ceiling each channel is clamped to AFTER every source has been multiplied together.
 *
 * Multiplication already diminishes each further source (see `StatusChannel`), so this is not the
 * balance lever — it is the guarantee. Whatever future weapons and pickups are authored, and however
 * many of them land on one car at once, a player keeps at least half their top speed, still steers,
 * still brakes, and still shoots. **A debuff may take the fight off you; it may not take the car off
 * you.**
 *
 * `topSpeed`'s floor is the load-bearing one. Below roughly half speed a car cannot disengage from
 * anything, so every slow past that point converts a fight into an execution — which is the ram
 * knock's job (bounded, ~1s, with countersteer as counterplay), never a status's.
 *
 * `turnRate`'s ceiling is above 1 so a future buff can sharpen a car's cornering; no row uses it in
 * either direction today — `overheated` carried a `turnRate` debuff until the 2026-09-01 overhaul
 * made it a pure burn (git history and the 2026-08-29 status spec have the reasoning: binary
 * steering makes a raised `turnRate` a gain rather than a penalty, which is why it never shipped
 * on the floor side either). The channel stays defined for whatever picks it up next.
 *
 * `brakeDecel`'s floor is not a free choice. Scaled braking must stay above `DRIVE_CONFIG.drag` or
 * the brake pedal becomes worse than lifting off, which reads as the control being broken rather
 * than degraded; `status-config.test.ts` asserts that against the live drive numbers.
 */
export const STATUS_LIMITS: Readonly<Record<StatusChannel, { min: number; max: number }>> =
  Object.freeze({
    topSpeed: Object.freeze({ min: 0.5, max: 2 }),
    accel: Object.freeze({ min: 0.4, max: 2.5 }),
    turnRate: Object.freeze({ min: 0.4, max: 2 }),
    brakeDecel: Object.freeze({ min: 0.6, max: 1.5 }),
    damageDealt: Object.freeze({ min: 0.5, max: 2 }),
    damageTaken: Object.freeze({ min: 0.4, max: 2.5 }),
    weaponCooldown: Object.freeze({ min: 0.4, max: 3 }),
    ramMass: Object.freeze({ min: 0.5, max: 2 }),
  });

/**
 * The status roster.
 *
 * Numbers here are first-pass and meant to be re-tuned from play, not defended. What is *not* a
 * tuning question is which channels a row touches — that is the row's identity, and changing it
 * changes what the status is.
 *
 * No row carries a duration: how long a status lasts is the applier's call (`WeaponDef.applies`).
 */
export const STATUS_TABLE = {
  /**
   * Overheated is a pure burn now (O4): 8 hp per 400 ms is 20 hp/s — 30 hp over afterburner's
   * 1.5 s application, topped up while the target stays in the flame. The handling-debuff identity
   * this row shipped with left the game with the overhaul; the long comment arguing turnRate 0.65
   * vs 1.55 went with it (see git history and the 2026-08-29 status spec for the record).
   */
  overheated: {
    id: "overheated",
    name: "Overheated",
    kind: "debuff",
    color: "#d9480f",
    reapply: "refresh",
    modifiers: {},
    pulse: { intervalMs: 400, damage: 8 },
  },
  /** The pure "you are easier to kill" debuff. Sets up a focus, does nothing on its own. */
  corroded: {
    id: "corroded",
    name: "Corroded",
    kind: "debuff",
    color: "#74b816",
    reapply: "refresh",
    modifiers: { damageTaken: 1.3 },
  },
  /**
   * Hard CC, and the only row in the table that takes the car away rather than degrading it.
   *
   * Engine, steering and trigger all dead. Total stop (O6): `fullStop` zeroes speed each tick while
   * shove and injected spin still resolve, so a slammed car still slides into the wall. Landing it
   * also triggers the interrupt sweep — see `runCombat`.
   *
   * Kept short, and `ignore` on top of that — but `ignore` only blocks EXTENSION: a running stun
   * cannot be refreshed or re-timed by a second landing hit, it just runs its course. It says
   * nothing about how often a stun can restart. The real bound on a lock is the ratio of the
   * applier's duration to its own cooldown, and that is the applier's responsibility, not this row's
   * — `thumper` is the shipped example, at 450 ms against a 1000 ms cooldown (a 47% duty cycle,
   * under the W7 playtest probe's 60% threshold). A duration long enough relative to its own
   * cooldown can still hold a target parked solo; `ignore` does not prevent that on its own.
   * If this ever needs to be stronger, the answer is a different status, not a longer stun.
   */
  stunned: {
    id: "stunned",
    name: "Stunned",
    kind: "debuff",
    color: "#4263eb",
    reapply: "ignore",
    modifiers: {},
    flags: ["immobilised", "steeringLocked", "disarmed", "fullStop"],
  },
  /**
   * Pure harsh slow (spec table): 0.6 topSpeed, no bleed — the bleed moved to `overheated`.
   * Above the 0.5 clamp floor, deliberately: the floor is the guarantee a car can always leave.
   */
  spiked: {
    id: "spiked",
    name: "Spiked",
    kind: "debuff",
    color: "#0c8599",
    reapply: "refresh",
    modifiers: { topSpeed: 0.6 },
  },
  /** Pure damage reduction (O5): 0.7x incoming. The heal and ramMass left with the overhaul. */
  fortified: {
    id: "fortified",
    name: "Fortified",
    kind: "buff",
    color: "#1971c2",
    reapply: "refresh",
    modifiers: { damageTaken: 0.7 },
  },
  /**
   * Field repair: strips every debuff, and that is all it does.
   *
   * **It restores no hp.** Cleansing `overheated` stops the burn but does not give back what has
   * already burned — which is exactly what keeps a cleanse from being a heal wearing different words,
   * and what lets it be generous without being oppressive.
   *
   * It carries no ongoing rules at all, so its duration only decides how long the badge shows. It is
   * the one row nothing applies yet: it is the pickup status, and pickups are future work. The
   * room's `statusRequests` queue can already deliver it the day one exists.
   */
  overhauled: {
    id: "overhauled",
    name: "Overhauled",
    kind: "buff",
    color: "#f1f3f5",
    reapply: "ignore",
    modifiers: {},
    onApply: { cleanse: "debuff" },
  },
  /**
   * Takes 0 damage (O7). No applier yet — the second pickup-tier row beside `overhauled`,
   * reachable through `statusRequests` the day something grants it. `refresh` on a flag row is
   * only legal because the row declares itself `chainable` — a buff-only escape hatch — and the
   * risk of a refreshed invulnerability belongs to its future applier.
   */
  armored: {
    id: "armored",
    name: "Armored",
    kind: "buff",
    color: "#868e96",
    reapply: "refresh",
    chainable: true,
    modifiers: {},
    flags: ["invulnerable"],
  },
  /**
   * Spawn protection: the car is not in the world (M13, M18).
   *
   * Not a new mechanic — the game already had this. `isOnField` reads `alive`, so a wreck is already
   * dropped from every collision list, every ram pair and every target list; this is that same
   * condition held a moment past the respawn.
   *
   * It scales nothing. Its whole effect is the flag, and its duration is the applier's as always —
   * the room's, from `DEATHMATCH_TICKS`. `refresh` because the phase must be extendable while the
   * car is still overlapping someone, which is what `chainable` exists to permit.
   */
  phased: {
    id: "phased",
    name: "Phasing",
    kind: "buff",
    color: "#4dabf7",
    reapply: "refresh",
    chainable: true,
    modifiers: {},
    flags: ["phased"],
  },
} as const satisfies Record<StatusId, StatusDef>;

/**
 * Own-property check, deliberately not `value in STATUS_TABLE`: `in` walks the prototype chain, so
 * inherited names like `"constructor"` would pass as status ids and then resolve to an undefined
 * def, NaN-ing every modifier derived from it. Same reasoning as `isCarId`.
 *
 * This is also the wire guard. `PlayerState.statuses` carries `statusId` as a string, so anything
 * reading that list back — the client's own prediction included — validates through here first.
 */
export function isStatusId(value: unknown): value is StatusId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STATUS_TABLE, value);
}

export function statusDefOf(id: StatusId): StatusDef {
  return STATUS_TABLE[id];
}

export const STATUS_IDS: readonly StatusId[] = Object.freeze(
  Object.keys(STATUS_TABLE) as StatusId[],
);
