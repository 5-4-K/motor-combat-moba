import { BASIC_ATTACK_CONFIG, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";

/**
 * Which inputs fire which FIRE SLOT, indexed by slot: 0 is the basic attack, 1..N are the ability
 * kit (VS15).
 *
 * Client-only on purpose: the server never sees a key or a mouse button, only a slot index, so a
 * re-bind is a local change with no protocol consequence. It is `ABILITY_SLOT_CEILING + 1` rows
 * long — the most fire slots the game is BUILT for, not the number this build turns on — so raising
 * `maxAbilitySlots` never has to grow it (VS16). `slotMaskFrom` caps its own scan at
 * `maxFireSlots`, so a row past this build's N is simply never read.
 *
 * Each ability slot has TWO bindings: a home-row key under the right hand (J-K-L-;, for driving on
 * WASD), and a mouse-hand alternate (LMB / RMB / SPACE / MMB). The abilities own the mouse hand
 * outright — **the basic attack gave LMB up when it was switched off**
 * (`BASIC_ATTACK_CONFIG.enabled`), and SHIFT left the scheme with it. Slot 0 keeps `H` and nothing
 * else, so no two slots can claim one input; re-enabling the basic attack means DECIDING a mouse
 * binding for it again (there is no free button left — ability 4 holds the last one) or shipping it
 * keyboard-only as it stands.
 *
 * The slot INDICES are not the binding order. The basic attack is fire slot 0 on every chassis at
 * every kit length (VS6), but it is bound to the key furthest left in the run; the abilities keep
 * exactly the inputs the 2026-09-19 controls pass gave them — `J`/LMB, `K`/RMB, `L`/SPACE — so
 * moving the basic attack to slot 0 changed no player-facing binding at all.
 *
 * The rule from the 2026-08-30 controls pass still stands — a binding nobody printed is a thing
 * that breaks quietly later — but the basic attack BENDS it and the spec says so (BA19): it has no
 * gutter pill, because hiding it from the panel is the feature, so the countdown action hint is the
 * only place either of its bindings is taught. Do not remove that hint. While the toggle is off the
 * hint drops slot 0 entirely, which is why `H` is currently printed nowhere: an unpressable key
 * needs no teaching.
 *
 * `codes` are standard DOM `KeyboardEvent.keyCode` values — the same numbers `Phaser.Input.
 * Keyboard.KeyCodes` exposes (`H` 72, `J` 74, `K` 75, `L` 76, `;` 186, `SPACE` 32) — spelled out
 * here rather than imported from `phaser`, because importing the `phaser` package runs its browser
 * device-detection code at module load and crashes under this project's node-environment tests.
 * `;` extends the `H J K L` home-row run exactly one key to the right, so ability 4 costs the right
 * hand no reach it did not already have.
 *
 * `buttonsMask` is a DOM `MouseEvent.buttons` bitmask (1 left, 2 right, 4 middle) — the same value
 * Phaser's `Pointer.buttons` carries — so a slot fires while any of its bits is held. 0 means the
 * slot has no mouse binding. MMB is the only mouse button still free, which is why ability 4 takes
 * it; `ArenaScene` suppresses the browser's autoscroll on it the way it already suppresses the
 * context menu on RMB (VS17).
 *
 * "SPACE" is five characters, the width budget `SLOT_KEY_COLUMN_PX` was measured against — a longer
 * pill label overflows the gutter's right edge, so re-measure before wording one differently.
 * "MMB" is three, so the fifth row needs no re-measuring.
 */
export const SLOT_KEYS = [
  { codes: [72], buttonsMask: 0, glyph: "H", keyGlyph: "H" },
  { codes: [74], buttonsMask: 1, glyph: "LMB", keyGlyph: "J" },
  { codes: [75], buttonsMask: 2, glyph: "RMB", keyGlyph: "K" },
  { codes: [76, 32], buttonsMask: 0, glyph: "SPACE", keyGlyph: "L" },
  { codes: [186], buttonsMask: 4, glyph: "MMB", keyGlyph: ";" },
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
export function hintSlotOrder(
  enabled: boolean,
  // `: number`, not the inferred literal `3`: `maxAbilitySlots` is `as const`, so without the
  // annotation no test could pass any other N through this parameter — the whole reason it exists.
  abilities: number = WEAPON_SLOT_CONFIG.maxAbilitySlots,
): readonly number[] {
  const slots = Array.from({ length: abilities }, (_, i) => i + 1);
  return enabled ? [0, ...slots] : slots;
}

/** The countdown hint's slot order, resolved from the toggle's current (build-time) value. */
export const HINT_SLOT_ORDER = hintSlotOrder(BASIC_ATTACK_CONFIG.enabled);

/**
 * Held slot inputs as the wire's bitmask. Bit 0 is fire slot 0 — the basic attack (VS15) — and
 * anything at or past `maxFireSlots` is dropped, so a `SLOT_KEYS` row this build has no slot for
 * can never reach the wire (VS18).
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
