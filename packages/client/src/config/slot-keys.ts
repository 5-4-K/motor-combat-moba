import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";

/**
 * Which inputs fire which FIRE SLOT, indexed by slot: 0-2 are the ability kit, 3 is the basic
 * attack (BA13, BA16).
 *
 * Client-only on purpose: the server never sees a key or a mouse button, only a slot index, so a
 * re-bind is a local change with no protocol consequence. Must be at least `maxFireSlots` long.
 *
 * Each slot has TWO bindings: a home-row key under the right hand (H-J-K-L, for driving on WASD),
 * and a mouse-hand alternate. The basic attack takes LMB — the button a player holding a mouse
 * reaches for first, for the weapon they press most — which is why the abilities' mouse bindings
 * shifted to RMB / SHIFT / SPACE. SHIFT is a second `keyCode` (16) rather than a mouse button, the
 * same way SPACE (32) already is on slot 2; only the basic attack and ability 1 carry a
 * `buttonsMask`.
 *
 * The rule from the 2026-08-30 controls pass still stands — a binding nobody printed is a thing
 * that breaks quietly later — but the basic attack BENDS it and the spec says so (BA19): it has no
 * gutter pill, because hiding it from the panel is the feature, so the countdown action hint is the
 * only place either of its bindings is taught. Do not remove that hint.
 *
 * `codes` are standard DOM `KeyboardEvent.keyCode` values — the same numbers `Phaser.Input.
 * Keyboard.KeyCodes` exposes (`H` 72, `J` 74, `K` 75, `L` 76, `SHIFT` 16, `SPACE` 32) — spelled out
 * here rather than imported from `phaser`, because importing the `phaser` package runs its browser
 * device-detection code at module load and crashes under this project's node-environment tests.
 *
 * `buttonsMask` is a DOM `MouseEvent.buttons` bitmask (1 left, 2 right) — the same value Phaser's
 * `Pointer.buttons` carries — so a slot fires while any of its bits is held. 0 means the slot has
 * no mouse binding.
 *
 * "SHIFT" is five characters, the same width budget `SLOT_KEY_COLUMN_PX` was measured against for
 * "SPACE" — a longer pill label overflows the gutter's right edge, so re-measure before wording one
 * differently.
 */
export const SLOT_KEYS = [
  { codes: [74], buttonsMask: 2, glyph: "RMB", keyGlyph: "J" },
  { codes: [75, 16], buttonsMask: 0, glyph: "SHIFT", keyGlyph: "K" },
  { codes: [76, 32], buttonsMask: 0, glyph: "SPACE", keyGlyph: "L" },
  { codes: [72], buttonsMask: 1, glyph: "LMB", keyGlyph: "H" },
] as const;

/** Fire slots in the order the countdown hint teaches them: basic attack first (BA19). */
export const HINT_SLOT_ORDER = [3, 0, 1, 2] as const;

/**
 * Held slot inputs as the wire's bitmask. Bit 0 is slot 1; anything past the limit is dropped.
 * `down` is one boolean per slot (all of that slot's keys ORed together by the caller);
 * `mouseButtons` is the pointer's `buttons` bitmask, matched against each slot's `buttonsMask`.
 */
export function slotMaskFrom(down: readonly boolean[], mouseButtons = 0): number {
  let mask = 0;
  const limit = Math.min(SLOT_KEYS.length, WEAPON_SLOT_CONFIG.maxFireSlots);
  for (let i = 0; i < limit; i++) {
    const held = (down[i] ?? false) || (mouseButtons & SLOT_KEYS[i]!.buttonsMask) !== 0;
    if (held) mask |= 1 << i;
  }
  return mask;
}
