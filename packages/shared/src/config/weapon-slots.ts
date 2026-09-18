import { CAR_TABLE, basicAttackOf } from "./car-config.js";
import type { CarId } from "./types.js";
import type { WeaponId } from "./weapon-types.js";

/**
 * The slot counts, and the difference between them.
 *
 * `maxAbilitySlots` is how many weapons a chassis's KIT may present: the server rejects an ability
 * fire at or beyond this index, and the HUD draws at most this many boxes. It was called
 * `maxWeaponSlots` until 2026-09-17, and the rename is the point — every car carries four weapons
 * now, and a constant called "max weapon slots" reading 3 would be a quiet lie.
 *
 * `maxFireSlots` is how many weapons a car can actually fire: the kit plus its basic attack (BA11).
 * It is what the wire mask is masked to and what the client's key table runs to. Derived, never
 * typed, so the two can never disagree.
 */
/** The ability-slot count, hoisted so the two counts below are expressions rather than a promise. */
const MAX_ABILITY_SLOTS = 3;

export const WEAPON_SLOT_CONFIG = {
  maxAbilitySlots: MAX_ABILITY_SLOTS,
  maxFireSlots: MAX_ABILITY_SLOTS + 1,
  /**
   * The basic attack is always last, so the three ability indices never move (BA13). "Always" is
   * enforced, not assumed: `weapon-slots.test.ts`'s "gives every ACTIVE car exactly a full kit"
   * pins every active chassis's `weapons.length` to `maxAbilitySlots`, which is what keeps this
   * index the one `fireSlotsOf` actually produces rather than a claim that a short kit would quietly
   * falsify.
   */
  basicAttackSlotIndex: MAX_ABILITY_SLOTS,
} as const;

/** Cars already warned about, so an over-long loadout logs once rather than once per tick. */
const warned = new Set<string>();

/**
 * A car's loadout, capped at the slot limit. A car listing more weapons than slots is a config
 * mistake worth surfacing but not worth crashing over: the extras can never be selected or drawn,
 * so they are dropped with one warning naming the car.
 */
export function slotsFrom(carId: string, weapons: readonly WeaponId[]): readonly WeaponId[] {
  const max = WEAPON_SLOT_CONFIG.maxAbilitySlots;
  if (weapons.length <= max) return weapons;
  if (!warned.has(carId)) {
    warned.add(carId);
    console.warn(
      `[weapons] car "${carId}" lists ${weapons.length} weapons but maxAbilitySlots is ${max}; ` +
        `ignoring: ${weapons.slice(max).join(", ")}`,
    );
  }
  return weapons.slice(0, max);
}

export function slotsOf(carId: CarId): readonly WeaponId[] {
  return slotsFrom(carId, CAR_TABLE[carId].weapons);
}

/**
 * Everything this chassis can fire, in fire-slot order: its kit, then its basic attack (BA12).
 *
 * **The readers, named so a new one is a deliberate act rather than a habit:**
 *
 * 1. `packages/server/balance/stats.ts` — the per-weapon accumulator seeding. A weapon the bots
 *    press but nobody seeded is silently absent from the report.
 * 2. `scripts/ttk.mjs` — two call sites, the rotation and the one-press input table.
 * 3. `packages/server/src/bot/brain/duel.fixture.ts` — two call sites, `pressCeilingOf` and
 *    `bestSustainedDpsOf`. The latter is deliberate, not an oversight: a sustained-DPS ceiling
 *    should count every trigger a car can pull, and including the basic attack moved Bastion's
 *    figure from 18.3 (thumper alone) to 22.5.
 * 4. `packages/server/playtest/` — `carrierOf` and `slotBitFor` in `weapons.ts`, `weapons2.ts` and
 *    `geometry.ts`. Those probes sweep `WEAPON_TABLE` whole and press each row through the real
 *    slot pipeline, so "who can fire this, and on which slot" is exactly their question; asking
 *    `slotsOf` threw on the first basic-attack row and killed the run.
 *
 * `newFireState` (`sim/weapons/fire.ts`) does **not** call this — its explicit-loadout path builds
 * the same `[...kit, basicAttackOf(carId)]` list inline, because it also has to accept a caller-given
 * `weaponIds` override that this function has no parameter for.
 *
 * Everything else wants `slotsOf`. The rule: **`fireSlotsOf` answers "what can this car fire",
 * `slotsOf` answers "what kit was this chassis designed around".** The HUD, the guide, the
 * playground's loadout editor, the balance seat filter, ttk's attacker axis and the bot's reach
 * model all ask the second question.
 */
export function fireSlotsOf(carId: CarId): readonly WeaponId[] {
  return [...slotsOf(carId), basicAttackOf(carId)];
}
