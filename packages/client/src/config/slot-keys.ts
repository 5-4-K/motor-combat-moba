import { BASIC_ATTACK_CONFIG, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";

/**
 * Which inputs fire which FIRE SLOT, indexed by slot: 0-2 are the ability kit, 3 is the basic
 * attack (BA13, BA16).
 *
 * Client-only on purpose: the server never sees a key or a mouse button, only a slot index, so a
 * re-bind is a local change with no protocol consequence. Must be at least `maxFireSlots` long.
 *
 * Each ability slot has TWO bindings: a home-row key under the right hand (J-K-L, for driving on
 * WASD), and a mouse-hand alternate (LMB / RMB / SPACE). The three abilities own the mouse hand
 * outright — **the basic attack gave LMB up when it was switched off**
 * (`BASIC_ATTACK_CONFIG.enabled`), and SHIFT left the scheme with it. Slot 3 keeps `H` and nothing
 * else, so no two slots can claim one input; re-enabling the basic attack means DECIDING a mouse
 * binding for it again (there is no free button left) or shipping it keyboard-only as it stands.
 *
 * The rule from the 2026-08-30 controls pass still stands — a binding nobody printed is a thing
 * that breaks quietly later — but the basic attack BENDS it and the spec says so (BA19): it has no
 * gutter pill, because hiding it from the panel is the feature, so the countdown action hint is the
 * only place either of its bindings is taught. Do not remove that hint. While the toggle is off the
 * hint drops slot 3 entirely, which is why `H` is currently printed nowhere: an unpressable key
 * needs no teaching.
 *
 * `codes` are standard DOM `KeyboardEvent.keyCode` values — the same numbers `Phaser.Input.
 * Keyboard.KeyCodes` exposes (`H` 72, `J` 74, `K` 75, `L` 76, `SPACE` 32) — spelled out here rather
 * than imported from `phaser`, because importing the `phaser` package runs its browser
 * device-detection code at module load and crashes under this project's node-environment tests.
 *
 * `buttonsMask` is a DOM `MouseEvent.buttons` bitmask (1 left, 2 right) — the same value Phaser's
 * `Pointer.buttons` carries — so a slot fires while any of its bits is held. 0 means the slot has
 * no mouse binding.
 *
 * "SPACE" is five characters, the width budget `SLOT_KEY_COLUMN_PX` was measured against — a longer
 * pill label overflows the gutter's right edge, so re-measure before wording one differently.
 */
export const SLOT_KEYS = [
  { codes: [74], buttonsMask: 1, glyph: "LMB", keyGlyph: "J" },
  { codes: [75], buttonsMask: 2, glyph: "RMB", keyGlyph: "K" },
  { codes: [76, 32], buttonsMask: 0, glyph: "SPACE", keyGlyph: "L" },
  { codes: [72], buttonsMask: 0, glyph: "H", keyGlyph: "H" },
] as const;

/**
 * Fire slots in the order the countdown hint teaches them: basic attack first when it can fire at
 * all (BA19), dropped from the row entirely rather than merely unpressable when
 * `BASIC_ATTACK_CONFIG.enabled` is false — the hint is the only place its binding is taught, so
 * disabling the weapon must remove the pill, not just the effect of pressing it.
 *
 * Takes an explicit `enabled` rather than reading the config directly so it stays a pure function —
 * `HINT_SLOT_ORDER` below is what production code reads, resolved once from the live flag.
 */
export function hintSlotOrder(enabled: boolean): readonly number[] {
  return enabled ? [3, 0, 1, 2] : [0, 1, 2];
}

/** The countdown hint's slot order, resolved from the toggle's current (build-time) value. */
export const HINT_SLOT_ORDER = hintSlotOrder(BASIC_ATTACK_CONFIG.enabled);

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
