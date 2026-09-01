import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";

/**
 * Which inputs fire which slot, and what the HUD prints beside that slot's icon.
 *
 * Client-only on purpose: the server never sees a key or a mouse button, only a slot index, so a
 * re-bind is a local change with no protocol consequence. Must be at least `maxWeaponSlots` long.
 *
 * Each slot now has TWO bindings: the J / K / L home-row keys under the right hand (for driving on
 * WASD), and a mouse-hand alternate — left button, right button, Space — for players who rest that
 * hand on the mouse instead. The rule from the 2026-08-30 controls pass still stands: a binding
 * nobody printed is a thing that breaks quietly later. That is why every alternate appears in the
 * `glyph` the HUD prints ("J·LMB", not a hidden extra), and why Q and E stay unbound — they are
 * still reserved for a future feature, and nothing here may quietly take them.
 *
 * `codes` are standard DOM `KeyboardEvent.keyCode` values — the same numbers `Phaser.Input.
 * Keyboard.KeyCodes` exposes (`J` 74, `K` 75, `L` 76, `SPACE` 32) — spelled out here rather than
 * imported from `phaser`, because importing the `phaser` package runs its browser device-detection
 * code at module load and crashes under this project's node-environment tests (see the client's
 * `car-sprite.ts` for the same rule applied to texture lookups). `Scene.input.keyboard.addKey`
 * accepts a bare numeric code, so `ArenaScene` never needs Phaser's enum to consume this table.
 *
 * `buttonsMask` is a DOM `MouseEvent.buttons` bitmask (1 left, 2 right) — the same value Phaser's
 * `Pointer.buttons` carries — so a slot fires while any of its bits is held. 0 means the slot has
 * no mouse binding.
 *
 * The glyphs are five characters each, the same width budget as the word `"space"` that
 * `SLOT_KEY_COLUMN_PX` was measured against — a longer label overflows the gutter's right edge, so
 * re-measure before wording one differently.
 */
export const SLOT_KEYS = [
  { codes: [74], buttonsMask: 1, glyph: "J·LMB" },
  { codes: [75], buttonsMask: 2, glyph: "K·RMB" },
  { codes: [76, 32], buttonsMask: 0, glyph: "L·SPC" },
] as const;

/**
 * Held slot inputs as the wire's bitmask. Bit 0 is slot 1; anything past the limit is dropped.
 * `down` is one boolean per slot (all of that slot's keys ORed together by the caller);
 * `mouseButtons` is the pointer's `buttons` bitmask, matched against each slot's `buttonsMask`.
 */
export function slotMaskFrom(down: readonly boolean[], mouseButtons = 0): number {
  let mask = 0;
  const limit = Math.min(SLOT_KEYS.length, WEAPON_SLOT_CONFIG.maxWeaponSlots);
  for (let i = 0; i < limit; i++) {
    const held = (down[i] ?? false) || (mouseButtons & SLOT_KEYS[i]!.buttonsMask) !== 0;
    if (held) mask |= 1 << i;
  }
  return mask;
}
