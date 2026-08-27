import { TICK_RATE_HZ, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import { weaponIconKey } from "../assets/asset-keys.js";
import type { TextureLookup } from "../assets/car-sprite.js";
import type { AssetManifest, SpriteEntry } from "../assets/manifest-schema.js";
import { fitSprite, type SpriteFit } from "../assets/sprite-fit.js";

export type SlotVisual = "ready" | "recharging" | "locked" | "car-locked";

/** Icon alpha per state. The locked dim is heavier AND static, so it cannot read as a cooldown. */
export const HUD_DIM = { ready: 1, recharging: 0.4, locked: 0.25, carLocked: 0.7 } as const;

const BOX_PX = 64;
const GAP_PX = 12;
const BOTTOM_MARGIN_PX = 72;
/** Below this, a number is more clutter than information — the sweep already says "nearly ready". */
const COUNTDOWN_FLOOR_TICKS = TICK_RATE_HZ;

/** How much of the cooldown wedge is still drawn: 1 the tick it starts, 0 the tick it ends. */
export function sweepFraction(rechargeEndsTick: number, cooldownTicks: number, tick: number): number {
  if (rechargeEndsTick === 0 || cooldownTicks <= 0) return 0;
  const remaining = rechargeEndsTick - tick;
  return Math.min(1, Math.max(0, remaining / cooldownTicks));
}

/** Seconds left, or `null` when the wait is short enough that the sweep alone reads better. */
export function countdownSeconds(endsTick: number, tick: number): number | null {
  if (endsTick === 0) return null;
  const remaining = endsTick - tick;
  if (remaining < COUNTDOWN_FLOOR_TICKS) return null;
  return remaining / TICK_RATE_HZ;
}

/**
 * Which of the four looks this slot wears. Precedence matters: a locked weapon reads as locked even
 * mid-recovery, because "you do not have this yet" outranks "you cannot act this instant".
 *
 * `pending` is the car's live wind-up/volley, derived by the caller from `PlayerState`'s
 * `pendingUntilTick` (`tick < pendingUntilTick`); `isLastFired` is `index === lastFiredSlot`. Both
 * are car-wide facts no slot row carries, which is why they arrive as arguments. Only whether
 * `pending` is present is read here — every slot is locked during a press, not just the firing one
 * (D3) — but it carries the slot so a future look can single that one out.
 */
export function slotVisualState(
  slot: { stocks: number; rechargeEndsTick: number },
  weapon: { unlocksAt: number },
  level: number,
  switchLockUntilTick: number,
  pending: { slot: number } | null,
  tick: number,
  isLastFired = false,
): SlotVisual {
  if (weapon.unlocksAt > level) return "locked";
  // A wind-up or volley locks every slot; recovery locks only the OTHER slots (D3).
  if (pending !== null) return "car-locked";
  if (!isLastFired && tick < switchLockUntilTick) return "car-locked";
  if (slot.stocks === 0 && slot.rechargeEndsTick !== 0) return "recharging";
  // Falls through to "ready" for `stocks === 0 && rechargeEndsTick === 0` as well, which is now
  // covered rather than merely rare: mid-volley `beginFire` (fire.ts) zeroes `stocks` immediately
  // while `rechargeEndsTick` stays 0 until the volley's last shot, so a `volleys > 1` weapon sits in
  // that combination for the whole burst — and every one of those ticks has a live `pending`, which
  // the "car-locked" branch above returns on first. The pending check must therefore keep
  // outranking the stock checks, and the caller must pass a REAL pending (`PlayerState`'s
  // `pendingUntilTick`), not `null`, or a slot with nothing left to fire draws full brightness.
  return "ready";
}

/** A slot's manifest icon, resolved and ready to draw. */
export interface ResolvedWeaponIcon {
  readonly key: string;
  readonly entry: SpriteEntry;
  readonly fit: SpriteFit;
}

/**
 * The manifest icon for a slot's weapon, or `undefined` when there is no entry or its texture never
 * loaded — the same two cases `resolveCarSprite` (`assets/car-sprite.ts`) falls through for a car,
 * and here they must both fall through to the procedural glyph `ArenaScene.drawWeaponGlyph` still
 * draws, which is what keeps a missing icon PNG from ever being a bug rather than a cosmetic gap.
 *
 * Fit against the square slot box, not the 48x32 car hull — an icon is not a chassis. Icons keep
 * their colour (`colorMode: "none"`, written by `scripts/import-weapon-icon.mjs`), so unlike a car
 * sprite this is never tinted by the player's colour.
 */
export function resolveWeaponIcon(
  manifest: AssetManifest,
  textures: TextureLookup,
  weaponId: string,
  boxSize: number,
): ResolvedWeaponIcon | undefined {
  const key = weaponIconKey(weaponId);
  const entry = manifest.sprites[key];
  if (!entry || !textures.exists(key)) return undefined;
  const hull = { width: boxSize, height: boxSize };
  return { key, entry, fit: fitSprite(entry, textures.sizeOf(key), hull) };
}

/** Camera-fixed boxes, centred horizontally and pinned above the bottom edge. */
export function slotBarLayout(
  count: number,
  viewWidth: number,
  viewHeight: number,
): { x: number; y: number; size: number }[] {
  const shown = Math.min(count, WEAPON_SLOT_CONFIG.maxWeaponSlots);
  if (shown <= 0) return [];
  const totalWidth = shown * BOX_PX + (shown - 1) * GAP_PX;
  const left = (viewWidth - totalWidth) / 2;
  const y = viewHeight - BOTTOM_MARGIN_PX;
  return Array.from({ length: shown }, (_, i) => ({
    x: left + i * (BOX_PX + GAP_PX),
    y,
    size: BOX_PX,
  }));
}
