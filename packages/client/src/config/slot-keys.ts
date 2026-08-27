import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";

/**
 * Which key fires which slot, and what the HUD prints beside that slot's icon.
 *
 * Client-only on purpose: the server never sees a key, only a slot index, so a re-bind is a local
 * change with no protocol consequence. Must be at least `maxWeaponSlots` long.
 *
 * `code` is the standard DOM `KeyboardEvent.keyCode` value — the same numbers `Phaser.Input.
 * Keyboard.KeyCodes` exposes (`SPACE` 32, `Q` 81, `E` 69) — spelled out here rather than imported
 * from `phaser`, because importing the `phaser` package runs its browser device-detection code at
 * module load and crashes under this project's node-environment tests (see the client's
 * `car-sprite.ts` for the same rule applied to texture lookups). `Scene.input.keyboard.addKey`
 * accepts a bare numeric code, so `ArenaScene` never needs Phaser's enum to consume this table.
 */
export const SLOT_KEYS = [
  { code: 32, glyph: "␣" }, // SPACE
  { code: 81, glyph: "Q" },
  { code: 69, glyph: "E" },
] as const;

/** Held slot keys as the wire's bitmask. Bit 0 is slot 1; anything past the limit is dropped. */
export function slotMaskFrom(down: readonly boolean[]): number {
  let mask = 0;
  const limit = Math.min(down.length, WEAPON_SLOT_CONFIG.maxWeaponSlots);
  for (let i = 0; i < limit; i++) if (down[i]) mask |= 1 << i;
  return mask;
}
