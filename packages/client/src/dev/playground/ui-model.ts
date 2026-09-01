import type { CarId, WeaponId } from "@motor-combat-moba/shared";
import { ARENAS, CAR_TABLE, WEAPON_TABLE } from "@motor-combat-moba/shared";

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
