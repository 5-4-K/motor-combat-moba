import { slots } from "@motor-combat-moba/shared";

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
 * **One layout now (TR29), replacing the old two-binding scheme** (a home-row letter under the
 * right hand plus a mouse-hand alternate). Every slot has exactly one input: the basic attack takes
 * LMB back now that it is switched on, ability 1 sits on RMB, abilities 2 and 3 sit on `Q`/`E`, and
 * ability 4 is bound to `SPACE` — inert while this build's `N` is 3. `glyph` is the only label a
 * slot has; there is no separate home-row glyph to keep in step with it.
 *
 * The rule from the 2026-08-30 controls pass still stands — a binding nobody printed is a thing
 * that breaks quietly later — but the basic attack BENDS it and the spec says so (BA19): it has no
 * gutter pill, because hiding it from the panel is the feature, so the countdown action hint is the
 * only place its binding is taught. Do not remove that hint.
 *
 * `codes` are standard DOM `KeyboardEvent.keyCode` values — the same numbers `Phaser.Input.
 * Keyboard.KeyCodes` exposes (`Q` 81, `E` 69, `SPACE` 32) — spelled out here rather than imported
 * from `phaser`, because importing the `phaser` package runs its browser device-detection code at
 * module load and crashes under this project's node-environment tests.
 *
 * `buttonsMask` is a DOM `MouseEvent.buttons` bitmask (1 left, 2 right, 4 middle) — the same value
 * Phaser's `Pointer.buttons` carries — so a slot fires while any of its bits is held. 0 means the
 * slot has no mouse binding.
 *
 * "SPACE" is five characters, the width budget `SLOT_KEY_COLUMN_PX` was measured against — a longer
 * pill label overflows the gutter's right edge, so re-measure before wording one differently.
 */
export const SLOT_KEYS: readonly {
  readonly codes: readonly number[];
  readonly buttonsMask: number;
  readonly glyph: string;
}[] = [
  { codes: [], buttonsMask: 1, glyph: "LMB" },
  { codes: [], buttonsMask: 2, glyph: "RMB" },
  { codes: [81], buttonsMask: 0, glyph: "Q" },
  { codes: [69], buttonsMask: 0, glyph: "E" },
  { codes: [32], buttonsMask: 0, glyph: "SPACE" },
];

/**
 * Fire slots in the order the countdown hint teaches them: basic attack first when it can fire at
 * all (BA19), dropped from the row entirely rather than merely unpressable when
 * `slots().basicAttackEnabled` is false — the hint is the only place its binding is taught, so
 * disabling the weapon must remove the pill, not just the effect of pressing it.
 *
 * Takes an explicit `enabled` rather than reading the config directly so it stays a pure function —
 * `hintSlotOrderDefault()` below is what a caller with no chassis in hand reads, resolved fresh from
 * the live bundle on every call.
 */
export function hintSlotOrder(
  enabled: boolean,
  // `: number`, not the inferred literal `3`: `maxAbilitySlots` is `as const`, so without the
  // annotation no test could pass any other N through this parameter — the whole reason it exists.
  abilities: number = slots().maxAbilitySlots,
): readonly number[] {
  const slotList = Array.from({ length: abilities }, (_, i) => i + 1);
  return enabled ? [0, ...slotList] : slotList;
}

/**
 * The countdown hint's slot order, resolved from the toggle's current (build-time) value and the
 * ACTIVE mode bundle's ability count. A FUNCTION, not a module-level constant: a `const` computed at
 * import time would freeze `maxAbilitySlots` at whichever mode happened to be installed first and
 * never see a later `withMode` scope or a playground retune (the exact bug this task exists to
 * remove) — see production callers such as `ArenaScene`, which pass the driven car's own ability
 * count instead of relying on this default.
 */
export function hintSlotOrderDefault(): readonly number[] {
  return hintSlotOrder(slots().basicAttackEnabled);
}

/**
 * Held slot inputs as the wire's bitmask. Bit 0 is fire slot 0 — the basic attack (VS15) — and
 * anything at or past `maxFireSlots` is dropped, so a `SLOT_KEYS` row this build has no slot for
 * can never reach the wire (VS18).
 * `down` is one boolean per slot (all of that slot's keys ORed together by the caller);
 * `mouseButtons` is the pointer's `buttons` bitmask, matched against each slot's `buttonsMask`.
 */
export function slotMaskFrom(down: readonly boolean[], mouseButtons = 0): number {
  let mask = 0;
  const limit = Math.min(SLOT_KEYS.length, slots().maxFireSlots);
  for (let i = 0; i < limit; i++) {
    const held = (down[i] ?? false) || (mouseButtons & SLOT_KEYS[i]!.buttonsMask) !== 0;
    if (held) mask |= 1 << i;
  }
  return mask;
}
