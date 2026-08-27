import { TICK_RATE_HZ, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";

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
  // Falls through to "ready" for `stocks === 0 && rechargeEndsTick === 0` too. Unreachable today
  // (every carried weapon resolves within one tick), but NOT unreachable in general: mid-volley,
  // `beginFire` (fire.ts) zeroes `stocks` immediately while `rechargeEndsTick` stays 0 until the
  // volley's last shot. A weapon with `volleys > 1` and a multi-tick `volleyInterval` would sit in
  // exactly that state for several ticks, and this fall-through would draw it full-brightness
  // "ready" while it has nothing left to fire. See the call site in ArenaScene.ts (`drawHudSlot`)
  // for the fix this needs alongside the car-locked wiring gap.
  return "ready";
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
