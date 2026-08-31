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
 * `turnRate`'s ceiling is above 1 so a future buff can sharpen a car's cornering; nothing in the
 * table uses it in that direction today. `overheated` used to, and the reasoning did not survive
 * contact with the input model — see its row for why binary steering makes a raised `turnRate` a
 * gain rather than a penalty. The floor is the side that carries the roster now.
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
   * The handling debuff: a car that corners wide instead of one that is merely slow.
   *
   * `turnRate` goes DOWN. It was authored at 1.55 — deliberately above 1, on the theory that an
   * over-responsive car is harder to place than a sluggish one. That theory needs analog steering
   * to hold, and this game does not have it: `InputMessage.steer` is `-1 | 0 | 1`, so there is no
   * fine control to lose. You cannot oversteer when the only inputs are hard-left, hard-right and
   * centre, and releasing stops the turn on the same tick. Under binary steering a higher
   * `turnRate` is a strict gain — a tighter radius (`speed / turnRate`) and faster reorientation.
   *
   * Worse, `stepDrive` ADDS steering to injected spin rather than multiplying:
   * `angle += (steer * turnRate * authority + angVel) * dt`. Countersteering is free by
   * construction, so a raised `turnRate` also bought more authority to countersteer out of a ram —
   * a debuff handing out a defensive buff. And afterburner, the only applier, is a 220-unit
   * attached beam that has to stay glued to its target: making that target better at rotating out
   * of the cone works against the weapon applying it.
   *
   * 0.65 is the reciprocal of the old 1.55, so the turn radius widens by the factor it used to
   * narrow. The mirror value (0.45) was rejected: radius scales as `speed / turnRate`, so it nearly
   * doubles the radius, and stacked with brake fade a 1.5s window of it starts encroaching on
   * Stunned's territory — the roster's only hard CC, currently applied at `thumper`'s 450ms (see
   * `stunned`'s row below for why `reapply: "ignore"` does not by itself bound how strong that gets).
   * 0.65 also leaves headroom above `STATUS_LIMITS.turnRate.min` (0.4) for a harsher handling debuff
   * later.
   *
   * What would make this better is losing grip — a car that slides wide. The drive model cannot do
   * it: motion is welded to the heading (`x += cos(angle) * speed`), so there is no lateral velocity
   * to lose. That is a drive-model rewrite, not a status, and it is deliberately not attempted here.
   */
  overheated: {
    id: "overheated",
    name: "Overheated",
    kind: "debuff",
    color: "#d9480f",
    reapply: "refresh",
    modifiers: { turnRate: 0.65, brakeDecel: 0.65, topSpeed: 0.92 },
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
   * Engine, steering and trigger all dead. Speed is deliberately NOT zeroed: the car coasts down
   * through drag, because an instant stop at speed reads as hitting an invisible wall rather than as
   * being stunned. Injected ram spin still applies, so a stunned car that gets hit still tumbles.
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
    flags: ["immobilised", "steeringLocked", "disarmed"],
  },
  /**
   * Slow plus bleed. The pressure debuff: it costs you hp for staying in the fight and speed for
   * trying to leave, so it makes the decision rather than making it for you.
   *
   * 8 hp per 400 ms is 20 hp/s — over a 3 s application, 60 hp, about 12% of an average chassis.
   * Meaningful as a rider on a weapon that already dealt damage; never a kill on its own.
   */
  spiked: {
    id: "spiked",
    name: "Spiked",
    kind: "debuff",
    color: "#0c8599",
    reapply: "refresh",
    modifiers: { topSpeed: 0.82 },
    pulse: { intervalMs: 400, damage: 8 },
  },
  /**
   * The defensive buff, and the game's first source of healing of any kind.
   *
   * 12 hp per 500 ms is 24 hp/s — over a 4 s application, 96 hp. On the 700 hp chassis most likely
   * to carry it that is 14%, gated behind a 15 s weapon cooldown, so it is a reason to hold ground
   * rather than a second health bar. This is the number most likely to be wrong on first play.
   */
  fortified: {
    id: "fortified",
    name: "Fortified",
    kind: "buff",
    color: "#1971c2",
    reapply: "refresh",
    modifiers: { damageTaken: 0.7, ramMass: 1.25 },
    pulse: { intervalMs: 500, heal: 12 },
  },
  /**
   * Field repair: strips every debuff, and that is all it does.
   *
   * **It restores no hp.** Cleansing `spiked` stops the bleeding but does not give back what has
   * already bled — which is exactly what keeps a cleanse from being a heal wearing different words,
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
