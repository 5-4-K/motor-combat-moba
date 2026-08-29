import type {
  EffectChannel,
  EffectDef,
  EffectId,
} from "./effect-types.js";

/**
 * Effect system tuning. Every value here is read by the sim on both sides of the lockstep, so this
 * is networked balance rather than render preference — the same standing as `RAM_CONFIG`.
 */
export const EFFECT_CONFIG = {
  /**
   * The most effects one car may carry at once.
   *
   * A wire guard first: `PlayerState.effects` is patched to every client, and an unbounded list is
   * an unbounded patch. It is also a design ceiling — a car wearing six simultaneous rule changes
   * cannot be read at a glance by the player driving it, let alone by the one shooting at it.
   *
   * At the cap a NEW effect id is dropped rather than evicting a running one. Rejecting is the
   * predictable half: an attacker can never use a cheap effect to push a meaningful one off a
   * target. Re-applying an effect that is already running is not a new id and is never dropped.
   */
  maxActive: 6,
  /** Upper bound on any row's `maxStacks`, so one row cannot make the cap above meaningless. */
  maxStacksCap: 4,
} as const;

/**
 * The floor and ceiling each channel is clamped to AFTER every source has been multiplied together.
 *
 * Multiplication already diminishes each further source (see `EffectChannel`), so this is not the
 * balance lever — it is the guarantee. Whatever future weapons and pickups are authored, and however
 * many of them land on one car at once, a player keeps at least half their top speed, still steers,
 * and still shoots. A debuff may take the fight off you; it may not take the car off you.
 *
 * `topSpeed`'s floor is the load-bearing one. Below roughly half speed a car cannot disengage from
 * anything, so every slow past that point converts a fight into an execution — which is the ram
 * knock's job (bounded, ~1s, with countersteer as counterplay), never a debuff's.
 */
export const EFFECT_LIMITS: Readonly<Record<EffectChannel, { min: number; max: number }>> =
  Object.freeze({
    topSpeed: Object.freeze({ min: 0.5, max: 2 }),
    accel: Object.freeze({ min: 0.4, max: 2.5 }),
    turnRate: Object.freeze({ min: 0.4, max: 2 }),
    damageDealt: Object.freeze({ min: 0.5, max: 2 }),
    damageTaken: Object.freeze({ min: 0.4, max: 2.5 }),
    weaponCooldown: Object.freeze({ min: 0.4, max: 3 }),
    ramMass: Object.freeze({ min: 0.5, max: 2 }),
  });

/**
 * The roster of effects.
 *
 * **Nothing applies any of these yet.** They exist so the mechanism has real rows to be tested and
 * balanced against, and so that authoring a future weapon or pickup is "name an effect" rather than
 * "design an effect system". Every row is cheap to retune or delete while that stays true.
 *
 * Durations are short on purpose — 1.5 to 5 seconds. An effect has to outlive the moment that
 * applied it or it is just damage with extra steps, and it has to expire inside one engagement or
 * it stops being a window and becomes a state of the match.
 *
 * The one deliberate omission is a row using the `immobilised` flag. A car that cannot move is a
 * car whose driver is watching, and this game already has its answer for "take control away": the
 * ram knock, which is bounded, decays visibly, and can be fought with countersteer. A debuff that
 * merely zeroes the throttle has none of that. The flag exists so the sim honours it if a future
 * design earns one; no row spends it today.
 */
export const EFFECT_TABLE = {
  overdrive: {
    id: "overdrive",
    name: "Overdrive",
    kind: "buff",
    color: "#f2a63b",
    durationMs: 4000,
    stacking: "refresh",
    maxStacks: 1,
    modifiers: { topSpeed: 1.25, accel: 1.2 },
  },
  tarred: {
    id: "tarred",
    name: "Tarred",
    kind: "debuff",
    color: "#4a4a52",
    durationMs: 3000,
    stacking: "stack",
    maxStacks: 2,
    modifiers: { topSpeed: 0.78, accel: 0.75 },
  },
  rattled: {
    id: "rattled",
    name: "Rattled",
    kind: "debuff",
    color: "#8f6bbf",
    durationMs: 2500,
    stacking: "refresh",
    maxStacks: 1,
    modifiers: { turnRate: 0.6 },
  },
  primed: {
    id: "primed",
    name: "Primed",
    kind: "buff",
    color: "#d4453c",
    durationMs: 5000,
    stacking: "refresh",
    maxStacks: 1,
    modifiers: { damageDealt: 1.25 },
  },
  exposed: {
    id: "exposed",
    name: "Exposed",
    kind: "debuff",
    color: "#c9762e",
    durationMs: 3000,
    stacking: "refresh",
    maxStacks: 1,
    modifiers: { damageTaken: 1.3 },
  },
  hardened: {
    id: "hardened",
    name: "Hardened",
    kind: "buff",
    color: "#3f7f9c",
    durationMs: 4000,
    stacking: "refresh",
    maxStacks: 1,
    modifiers: { damageTaken: 0.75, ramMass: 1.3 },
  },
  stoked: {
    id: "stoked",
    name: "Stoked",
    kind: "buff",
    color: "#c0532f",
    durationMs: 4000,
    stacking: "refresh",
    maxStacks: 1,
    modifiers: { weaponCooldown: 0.7 },
  },
  jammed: {
    id: "jammed",
    name: "Jammed",
    kind: "debuff",
    color: "#6b7a5a",
    /**
     * The shortest row in the table, and it stays that way. `disarmed` is the one flag anything
     * uses, and a flag has no counterplay gradient: the only dial left is how long it lasts.
     * `ignore` on top of that means a jam cannot be chained — it must run out before another can
     * land, so two attackers cannot hold one car silent between them.
     */
    durationMs: 1500,
    stacking: "ignore",
    maxStacks: 1,
    modifiers: {},
    flags: ["disarmed"],
  },
} as const satisfies Record<EffectId, EffectDef>;

/**
 * Own-property check, deliberately not `value in EFFECT_TABLE`: `in` walks the prototype chain, so
 * inherited names like `"constructor"` would pass as effect ids and then resolve to an undefined
 * def, NaN-ing every modifier derived from it. Same reasoning as `isCarId`.
 *
 * This is also the wire guard. `PlayerState.effects` carries `effectId` as a string, so anything
 * reading that list back — the client's own prediction included — validates through here first.
 */
export function isEffectId(value: unknown): value is EffectId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EFFECT_TABLE, value);
}

export function effectDefOf(id: EffectId): EffectDef {
  return EFFECT_TABLE[id];
}

export const EFFECT_IDS: readonly EffectId[] = Object.freeze(
  Object.keys(EFFECT_TABLE) as EffectId[],
);
