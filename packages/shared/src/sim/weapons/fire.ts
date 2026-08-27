import { isCarId } from "../../config/car-config.js";
import type { CarId } from "../../config/types.js";
import { weaponDefOf } from "../../config/weapon-config.js";
import { WEAPON_SLOT_CONFIG, slotsOf } from "../../config/weapon-slots.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import type { WeaponId } from "../../config/weapon-types.js";
import type { ShotOrder } from "./instances.js";

export interface SlotState {
  weaponId: WeaponId;
  stocks: number;
  /** Tick the running recharge completes. 0 = not recharging (at max, or nothing to recharge). */
  rechargeEndsTick: number;
  /** Tick this weapon may fire again. Only ever set by a weapon with a `stock` block. */
  refireLockUntilTick: number;
}

/** A committed press: the wind-up, then one order per remaining volley. */
export interface PendingFire {
  weaponId: WeaponId;
  slot: number;
  shotsLeft: number;
  nextShotTick: number;
}

export interface FireState {
  slots: SlotState[];
  /** Tick a DIFFERENT weapon may fire. */
  switchLockUntilTick: number;
  lastFiredWeaponId: string;
  pending: PendingFire | null;
  /** In-match level. Pinned to 1 until the level system exists (D14). */
  level: number;
}

/**
 * A car's slots at spawn: one stock each, no locks. A player with no chassis — pre-reveal, or an
 * unrecognised `carId` on the wire — gets no slots and can fire nothing, the same gate the old
 * `carId === ""` check applied.
 */
export function newFireState(carId: CarId | "", level: number): FireState {
  const weapons = isCarId(carId) ? slotsOf(carId) : [];
  return {
    slots: weapons.map((weaponId) => ({
      weaponId,
      stocks: 1,
      rechargeEndsTick: 0,
      refireLockUntilTick: 0,
    })),
    switchLockUntilTick: 0,
    lastFiredWeaponId: "",
    pending: null,
    level,
  };
}

/**
 * Stock recharge, run first each tick so a slot whose timer completes on this tick may fire on it.
 *
 * At max stocks the timer is CLEARED rather than left running: no progress is banked, so firing
 * from max always costs a whole fresh cooldown however long the weapon sat full.
 */
export function tickRecharge(state: FireState, tick: number): FireState {
  return {
    ...state,
    slots: state.slots.map((slot) => {
      const def = weaponDefOf(slot.weaponId);
      const max = def.stock?.max ?? 1;
      if (slot.stocks >= max) return slot.rechargeEndsTick === 0 ? slot : { ...slot, rechargeEndsTick: 0 };
      if (slot.rechargeEndsTick === 0) {
        return { ...slot, rechargeEndsTick: tick + weaponTicksOf(slot.weaponId).cooldown };
      }
      if (tick < slot.rechargeEndsTick) return slot;

      const stocks = slot.stocks + 1;
      return {
        ...slot,
        stocks,
        rechargeEndsTick: stocks >= max ? 0 : tick + weaponTicksOf(slot.weaponId).cooldown,
      };
    }),
  };
}

/**
 * Emit whatever is scheduled for this tick. Returns the orders for the caller to turn into
 * instances from the car's pose AT THIS TICK, which is what makes a burst steerable.
 *
 * The recharge and both locks are set from the LAST shot of a volley, so `cooldownMs` keeps meaning
 * "time until another stock" rather than partly serving its own burst.
 */
export function releaseShots(state: FireState, tick: number): { state: FireState; orders: ShotOrder[] } {
  const pending = state.pending;
  if (!pending || pending.nextShotTick !== tick) return { state, orders: [] };

  const ticks = weaponTicksOf(pending.weaponId);
  const orders: ShotOrder[] = [{ weaponId: pending.weaponId, slot: pending.slot }];
  const shotsLeft = pending.shotsLeft - 1;

  if (shotsLeft > 0) {
    return {
      state: {
        ...state,
        pending: { ...pending, shotsLeft, nextShotTick: tick + Math.max(1, ticks.volleyInterval) },
      },
      orders,
    };
  }

  const slots = state.slots.map((slot, index) => {
    if (index !== pending.slot) return slot;
    const max = weaponDefOf(slot.weaponId).stock?.max ?? 1;
    return {
      ...slot,
      // Only start a timer that is not already running: a shot fired below max leaves the in-flight
      // recharge alone rather than restarting it.
      rechargeEndsTick:
        slot.stocks >= max ? 0 : slot.rechargeEndsTick === 0 ? tick + ticks.cooldown : slot.rechargeEndsTick,
      refireLockUntilTick: tick + ticks.refireDelay,
    };
  });

  return {
    state: {
      ...state,
      slots,
      pending: null,
      lastFiredWeaponId: pending.weaponId,
      switchLockUntilTick: tick + ticks.recovery,
    },
    orders,
  };
}

/**
 * Resolve this tick's presses. `mask` is the slot bitmask from the wire (bit 0 = slot 1); the
 * lowest set bit the car can actually use wins.
 *
 * A press is a commitment: the stock is spent here, at press time, because a wind-up cannot be
 * cancelled. Nothing is queued — a press that cannot fire is dropped.
 */
export function beginFire(state: FireState, mask: number, tick: number): FireState {
  if (state.pending) return state;
  if (mask <= 0) return state;

  const usable = Math.min(state.slots.length, WEAPON_SLOT_CONFIG.maxWeaponSlots);
  for (let index = 0; index < usable; index++) {
    if ((mask & (1 << index)) === 0) continue;

    const slot = state.slots[index]!;
    const def = weaponDefOf(slot.weaponId);
    if (def.unlocksAt > state.level) continue;
    if (slot.stocks < 1) continue;

    const sameWeapon = state.lastFiredWeaponId === slot.weaponId;
    if (sameWeapon && tick < slot.refireLockUntilTick) continue;
    if (!sameWeapon && tick < state.switchLockUntilTick) continue;

    const volleys = def.kind === "projectile" ? def.volley.volleys : 1;
    return {
      ...state,
      slots: state.slots.map((s, i) => (i === index ? { ...s, stocks: s.stocks - 1 } : s)),
      pending: {
        weaponId: slot.weaponId,
        slot: index,
        shotsLeft: volleys,
        nextShotTick: tick + weaponTicksOf(slot.weaponId).startUp,
      },
    };
  }
  return state;
}

/** Drop a scheduled burst — a wreck does not finish firing. */
export function cancelPending(state: FireState): FireState {
  return state.pending === null ? state : { ...state, pending: null };
}
