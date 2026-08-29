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
   */
  maxDurationMs: 8000,
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
 * `turnRate`'s ceiling is the odd one out: it is above 1 because a twitchy car is genuinely harder
 * to place than a sluggish one, and `overheated` uses it in that direction. Its own floor still
 * exists so a future status can go the other way.
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
   * The control debuff, and the only one that makes a car harder to *place* rather than slower.
   *
   * `turnRate` goes UP, not down. That is the whole design and it looks like a typo unless you have
   * driven it: a sluggish car is easy to control and merely slow, whereas an over-responsive one
   * oversteers on every input and punts you into walls you meant to graze. Paired with brake fade,
   * an overheated car arrives at corners it cannot slow for and turns further into them than the
   * driver asked.
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
    modifiers: { turnRate: 1.55, brakeDecel: 0.65, topSpeed: 0.92 },
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
   * Kept short, and `ignore` on top of that so it cannot be chained — it must run out before another
   * can land, so two attackers cannot hold one car parked between them. Both of those are the price
   * of a debuff with no counterplay gradient; if it ever needs to be stronger, the answer is a
   * different status, not a longer stun.
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
