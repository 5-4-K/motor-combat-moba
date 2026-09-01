import type { CarId, PlaygroundSetup, TunableField, TuningValue, WeaponId } from "@motor-combat-moba/shared";
import { ARENAS, CAR_TABLE, WEAPON_TABLE, tunableFields } from "@motor-combat-moba/shared";

/**
 * Pure derivations for the playground overlay (Task 10, spec PG16/PG19). `overlay.ts` is the thin,
 * untested DOM shell that wires these onto the actual panel; everything here is a plain function over
 * plain data so it can run under vitest's node environment.
 */

/** `"hidden"` while the sim is unpaused; `"menu"` and `"settings"` are the two paused sub-screens. */
export type OverlayView = "hidden" | "menu" | "settings";

/** Tag names that mean "the user is typing/selecting", where P must not be treated as the pause key. */
const FORM_CONTROL_TAGS: ReadonlySet<string> = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/**
 * What pressing P should do, given the overlay's current view and where keyboard focus is.
 *
 * A keystroke landing in a form control (typing in nothing here today, but a `<select>` still takes
 * focus) is never the pause key — otherwise picking a car from a dropdown with the letter "p" in its
 * name, or just tabbing through the settings panel, could toggle pause out from under the user.
 * Outside a form control: settings backs out to the menu without touching pause (the sim stays
 * frozen); hidden or menu both send the toggle (P opens the menu from gameplay, and doubles for the
 * menu's own Resume while it is up).
 */
export function pauseKeyAction(
  view: OverlayView,
  targetTag: string,
): "toggle" | "back-to-menu" | "ignore" {
  if (FORM_CONTROL_TAGS.has(targetTag.toUpperCase())) return "ignore";
  if (view === "settings") return "back-to-menu";
  return "toggle";
}

/** All cars, active or not — the playground can drive a retired/unreleased chassis (PG18/PG20). */
export function carOptions(): { id: CarId; name: string }[] {
  return Object.values(CAR_TABLE).map((row) => ({ id: row.id, name: row.name }));
}

/** Every weapon row, for the six loadout `<select>`s. */
export function weaponOptions(): { id: WeaponId; name: string }[] {
  return Object.values(WEAPON_TABLE).map((row) => ({ id: row.id, name: row.name }));
}

/** Registered arena ids, for the arena `<select>`. */
export function arenaOptions(): string[] {
  return Object.keys(ARENAS);
}

/**
 * A car's three slot picks are legal iff there are exactly three and they are pairwise distinct
 * (spec PG17 — the same weapon on the OTHER car is fine, only a dupe within one car is rejected).
 * Mirrors `isPlaygroundSetup`'s own per-car check so the overlay can catch an illegal pick locally,
 * before ever building a payload the server would silently reject.
 */
export function isLoadoutLegal(
  weapons: readonly WeaponId[],
): weapons is [WeaponId, WeaponId, WeaponId] {
  return weapons.length === 3 && new Set(weapons).size === 3;
}

/**
 * Groups `tunableFields()`'s flat list into the sections the Task 11 Stats area draws (spec PG13):
 * one section per SELECTED chassis (`setup.me.carId`/`setup.opponent.carId`, deduped when both cars
 * picked the same one), a single "Global" section holding every drive/ram/combat field, and one
 * section per SELECTED weapon (the union of both loadouts, deduped). Every other field --
 * an unselected car's or weapon's rows -- is filtered out entirely; the playground only ever tunes
 * what's actually on the field. Row order within a section, and section order overall (car, Global,
 * weapon), follows `tunableFields()`'s own order since this only filters, never re-sorts.
 */
export function sliderGroups(setup: PlaygroundSetup): { title: string; fields: TunableField[] }[] {
  const fields = tunableFields();
  const groups: { title: string; fields: TunableField[] }[] = [];

  const carIds = [...new Set([setup.me.carId, setup.opponent.carId])];
  for (const carId of carIds) {
    const carFields = fields.filter((f) => f.group === "car" && f.ownerId === carId);
    if (carFields.length > 0) groups.push({ title: CAR_TABLE[carId].name, fields: carFields });
  }

  groups.push({
    title: "Global",
    fields: fields.filter((f) => f.group === "drive" || f.group === "ram" || f.group === "combat"),
  });

  const weaponIds = [...new Set([...setup.me.weapons, ...setup.opponent.weapons])];
  for (const weaponId of weaponIds) {
    const weaponFields = fields.filter((f) => f.group === "weapon" && f.ownerId === weaponId);
    if (weaponFields.length > 0) groups.push({ title: WEAPON_TABLE[weaponId].name, fields: weaponFields });
  }

  return groups;
}

/**
 * Whether `value` should count as "shipped" for `field` -- i.e. whether the overrides map should
 * hold NO entry for this row (Task 11 review finding). A `number` field's `<input type=range>` snaps
 * to a `min`/`step` grid, and `numberRange` (`tuning-walker.ts`) sets `step = max/100` with
 * `max = shipped * 3` for most rows: `shipped` then sits at `33.33` steps from `min`, off the grid
 * the control can actually land on. Exact `===` against `shipped` is therefore false for ~70% of the
 * numeric fields even when the user dragged the slider all the way back to the shipped position, and
 * the map would keep a phantom entry Copy overrides exports and the sim runs under. A number counts
 * as shipped when it lands within half a step of it -- the same tolerance a snapped grid position
 * would land within -- so dragging back to shipped always clears the override. `boolean`/`enum`
 * fields have no grid to snap to and keep strict equality.
 */
export function isAtShipped(field: TunableField, value: TuningValue): boolean {
  if (field.kind !== "number" || typeof value !== "number" || typeof field.shipped !== "number") {
    return value === field.shipped;
  }
  const step = field.step ?? 0;
  if (step <= 0) return value === field.shipped;
  return Math.abs(value - field.shipped) < step / 2;
}
