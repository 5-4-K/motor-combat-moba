import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";

/**
 * Which key fires which slot, and what the HUD prints beside that slot's icon.
 *
 * Client-only on purpose: the server never sees a key, only a slot index, so a re-bind is a local
 * change with no protocol consequence. Must be at least `maxWeaponSlots` long.
 *
 * J / K / L sit under the right hand while the left one drives with WASD. They replaced Space / Q /
 * E outright rather than joining them as hidden alternates: a second binding nobody printed is a
 * thing that breaks quietly later, and Q and E in particular are keys a future feature will want.
 *
 * `code` is the standard DOM `KeyboardEvent.keyCode` value — the same numbers `Phaser.Input.
 * Keyboard.KeyCodes` exposes (`J` 74, `K` 75, `L` 76) — spelled out here rather than imported from
 * `phaser`, because importing the `phaser` package runs its browser device-detection code at module
 * load and crashes under this project's node-environment tests (see the client's `car-sprite.ts`
 * for the same rule applied to texture lookups). `Scene.input.keyboard.addKey` accepts a bare
 * numeric code, so `ArenaScene` never needs Phaser's enum to consume this table.
 *
 * The glyph column is now three single letters where it used to hold the word `"space"`, so
 * `SLOT_KEY_COLUMN_PX` — and `HUD_GUTTER_WIDTH` behind it — reserve more room than these labels
 * need. That spare width is left as slack deliberately: the gutter's budget is being spent
 * elsewhere, and narrowing it here would tangle a key rebind with a layout change.
 */
export const SLOT_KEYS = [
  { code: 74, glyph: "J" },
  { code: 75, glyph: "K" },
  { code: 76, glyph: "L" },
] as const;

/** Held slot keys as the wire's bitmask. Bit 0 is slot 1; anything past the limit is dropped. */
export function slotMaskFrom(down: readonly boolean[]): number {
  let mask = 0;
  const limit = Math.min(down.length, WEAPON_SLOT_CONFIG.maxWeaponSlots);
  for (let i = 0; i < limit; i++) if (down[i]) mask |= 1 << i;
  return mask;
}
