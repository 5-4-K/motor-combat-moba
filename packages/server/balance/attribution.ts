/**
 * Which weapon a point of pulse damage belongs to (B5a).
 *
 * A `pulse` `DamageSource` names the status and who applied it, but not the weapon. `overheated`
 * is the game's only damaging pulse (8 damage every 400 ms) and `afterburner` is its only
 * applier — banking that burn under the status instead of the weapon would lose it from the
 * weapon that caused it. This module answers "which weapon caused this status" by scanning
 * `WEAPON_TABLE`, so the report can credit pulse damage to the weapon that earned it.
 */
import { WEAPON_TABLE, weaponDefOf, type DamageSource, type StatusId, type WeaponId } from "@motor-combat-moba/shared";

/**
 * Which weapons can apply each status, derived from `WEAPON_TABLE` rather than hand-written.
 *
 * Derived because a hardcoded status->weapon constant encodes what its author believed on the day
 * they wrote it — and this project's own spec got exactly that wrong (an earlier draft claimed
 * `corroded` was the game's only damaging pulse, dealing ~40 damage, applied by `magmablast`; the
 * spec was corrected, but by then it had already been copied into comments and tests elsewhere).
 * Both the status and the weapon were wrong: `corroded` deals no damage at all (it's a pure
 * `damageTaken` multiplier), and the real damaging pulse is `overheated`, applied only by
 * `afterburner`. A map built from the table cannot be wrong about the table; a constant goes stale
 * in the direction of a WRONG number, not a missing one, the moment a second weapon picks up an
 * existing status or a new one ships.
 *
 * Only `target: "opponents"` applications count. `self` (e.g. `wildcharge`'s `fortified`) and
 * `ownerInside` (e.g. `tremor`'s `fortified`) damage nobody the weapon fired at, so counting them
 * would make a weapon the "applier" of a pulse it can never actually inflict on an opponent.
 *
 * Scans both the row's top-level `applies` (most statuses: `thunderclap`, `afterburner`,
 * `thumper`, `roadblock`) and `explosion.applies` (`corroded`, which `magmablast` applies only
 * from inside its detonation, not from the direct hit — `corroded` deals no damage itself, it's
 * just the status that proves this scan has to descend into `explosion` at all). A scan that
 * skipped `explosion` would miss `corroded` entirely — CLAUDE.md's own maintenance note ("grep
 * `applies:.*corroded` if a second source ever needs checking") is exactly the kind of fact this
 * function makes ungreppable-because-unnecessary: the map answers it structurally, every time
 * `WEAPON_TABLE` changes.
 */
export function buildApplierMap(): ReadonlyMap<StatusId, readonly WeaponId[]> {
  const map = new Map<StatusId, WeaponId[]>();

  const add = (statusId: StatusId, weaponId: WeaponId): void => {
    const existing = map.get(statusId);
    if (existing) {
      if (!existing.includes(weaponId)) existing.push(weaponId);
    } else {
      map.set(statusId, [weaponId]);
    }
  };

  // `WEAPON_TABLE` itself is `as const satisfies Record<WeaponId, WeaponDef>`, so each row's
  // inferred literal type only carries the fields that row's author actually wrote — a row with no
  // `applies` has no such property at all, not merely `undefined`. `weaponDefOf` returns the
  // widened `WeaponDef` union instead, where `applies` is a real optional field on every variant.
  for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
    const def = weaponDefOf(id);
    for (const application of def.applies ?? []) {
      if (application.target === "opponents") add(application.statusId, id);
    }
    // An explosion is a real `WeaponInstance` with its own `applies` block (see `ExplosionDef`),
    // and it is the ONLY place `corroded` is applied — the top-level loop above never sees it.
    // Not every weapon shape has `explosion` (only `ProjectileWeaponDef` can), so narrow safely
    // rather than assuming the field exists on every row.
    const explosion = "explosion" in def ? def.explosion : undefined;
    for (const application of explosion?.applies ?? []) {
      if (application.target === "opponents") add(application.statusId, id);
    }
  }

  return map;
}

/**
 * Which weapon a point of damage belongs to.
 *
 * A `weapon` or `contact` source already names its weapon — that credit is a measurement off the
 * event and passes straight through with `derived: false`. A `pulse` source names only the status,
 * so the weapon has to be inferred through `appliers`; when that inference succeeds, `derived: true`
 * tells the report the number is an INFERENCE through a status rather than something read directly
 * off the event, so a reader knows which numbers in the report are which kind.
 *
 * When zero or more than one weapon can apply the status, attribution is genuinely ambiguous from
 * the event alone (e.g. `stunned`, appliable by both `thunderclap` and `roadblock`) — refusing to
 * guess and returning `{ weaponId: null, derived: false }` is the honest answer; picking one would
 * invent a number the report cannot defend. The caller banks that damage under the status instead.
 */
export function attributeSource(
  source: DamageSource,
  appliers: ReadonlyMap<StatusId, readonly WeaponId[]>,
): { weaponId: WeaponId | null; derived: boolean } {
  if (source.kind === "weapon" || source.kind === "contact") {
    return { weaponId: source.weaponId, derived: false };
  }

  const candidates = appliers.get(source.statusId) ?? [];
  if (candidates.length !== 1) return { weaponId: null, derived: false };
  return { weaponId: candidates[0]!, derived: true };
}
