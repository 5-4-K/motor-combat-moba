import { basicAttackOf } from "./car-config.js";
import type { CarId } from "./types.js";
import type { WeaponId } from "./weapon-types.js";
import { BASIC_ATTACK_CONFIG } from "./weapon-config.js";
import { cars } from "../modes/active.js";

/**
 * The STRUCTURAL ceiling: how many ability slots the game is BUILT for, as opposed to how many this
 * build turns on. It sizes `SLOT_KEYS`, bounds the wire mask's width, and is the upper bound
 * `maxAbilitySlots` is validated against. It is not a balance number and no skill edits it —
 * raising it is its own piece of work, because the HUD gutter has no room above 4 (VS21).
 */
export const ABILITY_SLOT_CEILING = 4;

/**
 * The BUILD-TIME ability-slot count, `N`. 1 to `ABILITY_SLOT_CEILING`, default 3.
 *
 * A chassis may author more weapons than this; the extras stay in `CAR_TABLE` and are simply not
 * reachable in this build — not fired, not drawn, not taught, not published (VS2). Flip it with the
 * `ability-slot-count` skill, which walks every step the change owes.
 */
const ABILITY_SLOTS = 3;

/**
 * The slot counts, and the difference between them.
 *
 * `maxAbilitySlots` is `N`: how many weapons a chassis's KIT may present in this build. The server
 * rejects an ability fire at or beyond this index and the HUD draws at most this many boxes.
 *
 * `maxFireSlots` is how many weapons a car can actually fire: the kit plus its basic attack (BA11).
 * `basicAttackSlotIndex` is 0. Both are derived rather than typed, so they cannot disagree with `N`.
 *
 * `basicAttackEnabled` mirrors `BASIC_ATTACK_CONFIG.enabled` (`config/weapon-config.ts`) into the
 * per-mode bundle so `sim/` never reaches for that global directly (MC13, MC27) — the flag itself
 * is still authored on `BASIC_ATTACK_CONFIG`, since readers outside `sim/` (the client HUD, the
 * manual builder, the bot) are not part of this migration yet; a test pins the two equal for the
 * installed mode so they cannot drift while both exist.
 */
export interface WeaponSlotConfig {
  readonly maxAbilitySlots: number;
  readonly maxFireSlots: number;
  readonly basicAttackSlotIndex: 0;
  readonly basicAttackEnabled: boolean;
}

export const WEAPON_SLOT_CONFIG: WeaponSlotConfig = {
  maxAbilitySlots: ABILITY_SLOTS,
  maxFireSlots: ABILITY_SLOTS + 1,
  /**
   * The basic attack is FIRST, so its index is 0 on every chassis at every kit length (VS6). It
   * used to be last, at `kit.length`, which was a constant only for as long as every active kit
   * was the same length — the moment kits vary, a last-placed basic attack answers to a different
   * key on each car.
   *
   * The literal 0 IS the derivation, not a typed constant standing in for one: the fire-slot array
   * is `[basicAttack, ...kit]`, so nothing about `N` can move it.
   */
  basicAttackSlotIndex: 0,
  basicAttackEnabled: BASIC_ATTACK_CONFIG.enabled,
} as const;

/** Cars already warned about, so an over-long loadout logs once rather than once per tick. */
const warned = new Set<string>();

/**
 * A car's loadout, capped at `max` (default: this build's `N`).
 *
 * Two different over-lengths, deliberately handled differently (VS11):
 *
 * - Longer than `ABILITY_SLOT_CEILING` — an authoring error. Warn once per car, naming it.
 * - Within the ceiling but longer than `max` — the DESIGNED case. A chassis may author four weapons
 *   and run in an `N = 3` build; warning on that would log on every boot for a configuration that
 *   is working exactly as intended. Truncate silently.
 *
 * `max` is a parameter rather than a direct config read so the rule is reachable at every `N`:
 * `maxAbilitySlots` is build-time and no test can move it.
 */
export function slotsFrom(
  carId: string,
  weapons: readonly WeaponId[],
  max: number = WEAPON_SLOT_CONFIG.maxAbilitySlots,
): readonly WeaponId[] {
  if (weapons.length > ABILITY_SLOT_CEILING && !warned.has(carId)) {
    warned.add(carId);
    console.warn(
      `[weapons] car "${carId}" lists ${weapons.length} weapons but the ceiling is ` +
        `${ABILITY_SLOT_CEILING}; ignoring: ${weapons.slice(ABILITY_SLOT_CEILING).join(", ")}`,
    );
  }
  return weapons.length <= max ? weapons : weapons.slice(0, max);
}

/**
 * This chassis's ABILITY kit, in slot order — 1 to `WEAPON_SLOT_CONFIG.maxAbilitySlots` weapons as
 * of Task 5's variable-length kits, never a fixed count. An inactive chassis may return an empty
 * list (VS25); the three shipped chassis each return a full kit today because that is what they
 * happen to be authored with, not because this function enforces it.
 */
export function slotsOf(carId: CarId): readonly WeaponId[] {
  return slotsFrom(carId, cars()[carId].weapons);
}

/**
 * Everything this chassis can fire, in fire-slot order: its basic attack, then its kit (VS6).
 *
 * **The answer is PER MODE.** `slotsOf` and `basicAttackOf` both read `cars()` — the ACTIVE mode's
 * roster — so this returns whatever the bundle installed at the moment of the call says, and two
 * modes may legitimately give a chassis different kits. Every reader below therefore runs inside a
 * `withMode`/`installMode` scope and its answer is only true for THAT mode; a reader that cached
 * one mode's list at module scope would freeze whichever bundle happened to be installed first
 * (MC12), which is the failure this whole layer exists to prevent. Outside a scope this throws
 * rather than serving a default.
 *
 * **The readers, named so a new one is a deliberate act rather than a habit** — each verified
 * (2026-09-23) to run inside a mode scope, and named with the entry point that installs it:
 *
 * 1. `packages/server/balance/stats.ts` — the per-weapon accumulator seeding, inside `aggregate`,
 *    reached from `balance/run.ts`'s one `withMode(modeConfigOf(args.mode), ...)` at the CLI entry.
 *    A weapon the bots press but nobody seeded is silently absent from the report.
 * 2. `scripts/ttk.mjs` — THREE call sites, all under that file's own
 *    `withMode(modeConfigOf(mode), ...)` entry guard: the rotation (`simulateTtk`), `carrierOf`
 *    (which chassis can fire a given row), and the per-weapon breakdown loop. `--mode` selects the
 *    bundle (MC41), so the matrix's kits are that mode's kits. (This entry read "two call sites"
 *    through two rounds of review; it was wrong both times. Count them with a grep before editing
 *    this list, not from the previous version of it.)
 * 2b. `scripts/mode-rosters.mjs` — `weaponRoster`, the union `npm run check:art` sweeps, which asks
 *    every mode in turn inside its own `withMode(modeConfigOf(mode), ...)`. This is what stops a
 *    weapon carried only in one mode's kit reading as unreleased.
 * 3. `packages/server/src/bot/brain/duel.fixture.ts` — two call sites, `pressCeilingOf` and
 *    `bestSustainedDpsOf`; its callers (`tiers.test.ts`, `controller.test.ts`) `installMode` the
 *    default bundle in a `beforeEach`. `bestSustainedDpsOf` counting the basic attack is
 *    deliberate, not an oversight: a sustained-DPS ceiling should count every trigger a car can
 *    pull, and including it moved Bastion's figure from 18.3 (thumper alone) to 22.5.
 * 4. `packages/server/playtest/` — `carrierOf`, `hasCarrier`, `skipReasonFor` and `slotBitFor` in
 *    `weapons.ts` and `weapons2.ts`, and `carrierOf`/`slotBitFor` in `geometry.ts`; every probe is
 *    a one-shot process that calls `installPlaytestMode()` on its first line (MC41). Those probes
 *    sweep the mode's weapon table whole and press each row through the real slot pipeline, so "who
 *    can fire this, and on which slot" is exactly their question; asking `slotsOf` threw on the
 *    first basic-attack row and killed the run.
 * 5. `packages/client/src/dev/AssetTuningScene.ts` — `drawTurret`'s `carHasTurretWeapon` test
 *    (TR53), so `?dev=assets` draws a turret for exactly the chassis the arena would. `BootScene`
 *    calls `installRoomMode` unconditionally before launching any dev tool, so this reads the
 *    client tab's installed bundle.
 *
 * `newFireState` (`sim/weapons/fire.ts`) does **not** call this — its explicit-loadout path builds
 * the same `[basicAttackOf(carId), ...kit]` list inline, because it also has to accept a caller-given
 * `weaponIds` override that this function has no parameter for.
 *
 * Everything else wants `slotsOf`. The rule: **`fireSlotsOf` answers "what can this car fire",
 * `slotsOf` answers "what kit was this chassis designed around".** The HUD, the guide, the
 * playground's loadout editor, the balance seat filter, ttk's attacker axis and the bot's reach
 * model all ask the second question.
 */
export function fireSlotsOf(carId: CarId): readonly WeaponId[] {
  return [basicAttackOf(carId), ...slotsOf(carId)];
}
