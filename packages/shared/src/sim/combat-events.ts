import type { CarId } from "../config/types.js";
import type { StatusId } from "../config/status-types.js";
import type { WeaponId } from "../config/weapon-types.js";

/**
 * What a balance run observes, and the ONLY thing the sim ever tells it (B3).
 *
 * Opt-in: `runCombat` takes this bag on its input and pushes into it. A caller that passes nothing
 * — every live room — allocates nothing and behaves identically. The seam is observation, never
 * behaviour: nothing in the sim may read an event back (B1).
 *
 * Server-only. `stepSim` never reads these, so invariant 8 does not apply and none of it is
 * networked. Putting a damage breakdown on a results screen is additive work, not implied by this.
 */
export interface CombatEvents {
  fired: FiredEvent[];
  damaged: DamagedEvent[];
  killed: KilledEvent[];
}

/**
 * One committed press (B7). NOT one projectile: a `pepperbox` fan and a multi-volley burst are each
 * one press, which is what makes hit rate comparable across weapon kinds (B30).
 */
export interface FiredEvent {
  tick: number;
  shooterSessionId: string;
  carId: CarId;
  weaponId: WeaponId;
  slot: number;
  pressId: string;
}

/**
 * Where a point of damage came from. Every path into `dealDamageTo` has a tag (B4).
 *
 * There is no ram case: a plain ram deals no damage (`sim/ram.ts` never calls `applyDamage`), so
 * every contact hit is a dash or a hard slam and always names its maneuver weapon (B5).
 */
export type DamageSource =
  | { kind: "weapon"; weaponId: WeaponId; pressId: string; isExplosion: boolean }
  | { kind: "contact"; weaponId: WeaponId; pressId: string }
  | { kind: "pulse"; statusId: StatusId; sourceSessionId: string };

export interface DamagedEvent {
  tick: number;
  victimSessionId: string;
  victimCarId: CarId;
  /** `""` when nothing owned the damage — a room-level grant or a pickup. */
  attackerSessionId: string;
  /** The attacker's chassis, or `null` when the attacker has left the room. */
  attackerCarId: CarId | null;
  source: DamageSource;
  /** Hp actually removed, after every multiplier. 0 is legal: a pure applicator still registers. */
  amount: number;
  /** Whether this is the hit that took the victim to 0. */
  killingBlow: boolean;
}

/**
 * Duplicates what `killingBlow` already marks, deliberately: the kill table wants victim and killer
 * without joining two logs, and the weapon table wants credited kills without joining either.
 */
export interface KilledEvent {
  tick: number;
  victimSessionId: string;
  victimCarId: CarId;
  killerSessionId: string;
  killerCarId: CarId | null;
  source: DamageSource;
}

/** A fresh, empty log. One per match — never shared, or two matches pool their statistics. */
export function newCombatEvents(): CombatEvents {
  return { fired: [], damaged: [], killed: [] };
}
