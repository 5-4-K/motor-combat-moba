import { isCarId } from "../../config/car-config.js";
import type { CarId } from "../../config/types.js";
import { weaponDefOf } from "../../config/weapon-config.js";
import { WEAPON_SLOT_CONFIG, slotsFrom, slotsOf } from "../../config/weapon-slots.js";
import { scaleTicks, weaponTicksOf } from "../../config/weapon-ticks.js";
import type { WeaponId } from "../../config/weapon-types.js";
import type { ShotOrder } from "./instances.js";

/**
 * Per-tick call order for this module, and callers must use exactly this order:
 *
 *     tickRecharge -> beginFire -> releaseShots
 *
 * `tickRecharge` and `releaseShots` both take the car's `weaponCooldown` multiplier (1 = unaffected).
 * It scales the three "when may I shoot again" clocks and nothing else — see `scaleTicks`. It is a
 * PARAMETER rather than a field on `FireState` on purpose: an effect can lapse mid-recharge, and a
 * multiplier baked into the state at press time would keep applying long after its clock ran out.
 * `beginFire` deliberately does not take one: wind-up is the shape of a press, not its rate.
 *
 * `beginFire` runs BEFORE `releaseShots` on the same tick, not after. With `startUpMs: 0` (every
 * weapon in the table today) a press schedules `nextShotTick = tick`, so its shot must be released
 * on that same tick — the pre-weapon-system weapon worked exactly this way, spawning its projectile
 * on the tick it was pressed, not the next one. Running `releaseShots` first would test a press that
 * has not been registered yet; the shot would then need `tick >= nextShotTick` to still be true on
 * a LATER tick to ever go out, which only happens to work here because `releaseShots` gates on
 * `tick >= pending.nextShotTick` rather than exact equality (see its doc comment) — but relying on
 * that instead of the documented order is fragile and not how `runCombat`'s tick loop is wired.
 */
export interface SlotState {
  weaponId: WeaponId;
  stocks: number;
  /** Tick the running recharge completes. 0 = not recharging (at max, or nothing to recharge). */
  rechargeEndsTick: number;
  /**
   * Tick this weapon may fire again. Set unconditionally by `releaseShots` from
   * `weaponTicksOf(weaponId).refireDelay`, which is 0 for a weapon with no `stock` block — so a
   * non-stock weapon's value is always the tick it last fired, not a sign that it has stocks.
   */
  refireLockUntilTick: number;
}

/** A committed press: the wind-up, then one order per remaining volley. */
export interface PendingFire {
  weaponId: WeaponId;
  slot: number;
  shotsLeft: number;
  nextShotTick: number;
  /**
   * Identity of the press this pending shot belongs to (B7). Sim-only, never networked.
   *
   * `sessionId#tick#slot`, and it needs no counter: `beginFire` returns early when a press is
   * already pending, so at most one press commits per player per tick. Frozen here and carried onto
   * every instance the press spawns, which is what makes press-to-damage attribution exact rather
   * than a correlation window — the difference that matters most for a lingering `lance` beam, an
   * attached `afterburner` cone, and a bursting `pepperbox`.
   */
  pressId: string;
}

export interface FireState {
  slots: SlotState[];
  /** Tick a DIFFERENT weapon may fire. */
  switchLockUntilTick: number;
  /**
   * The slot the car most recently committed to firing, or `-1` before its first shot. Slot
   * identity, deliberately NOT the weapon id: the refire lock lives on the SLOT, so deciding "same
   * weapon" by id let a loadout carrying one weapon twice (`["lance", "lance"]`) fire slot 1,
   * skip the switch lock on slot 2 as "the same weapon", and find slot 2's own `refireLockUntilTick`
   * still at 0 — a free double shot reachable from config alone.
   *
   * Set at press time by `beginFire`, not at release, so a wind-up or a mid-volley gap already
   * names the slot that is firing; the HUD reads it off the wire (`PlayerState.lastFiredSlot`).
   */
  lastFiredSlot: number;
  pending: PendingFire | null;
  /**
   * In-match level, gating `unlocksAt`. Mirrored from `PlayerState.level` on every tick by the
   * server bridge rather than owned here, so whatever eventually moves the schema field moves this
   * one with it (D14). Nothing moves it off 1 today.
   */
  level: number;
}

/**
 * A car's slots at spawn: one stock each, no locks. A player with no chassis — pre-reveal, or an
 * unrecognised `carId` on the wire — gets no slots and can fire nothing, the same gate the old
 * `carId === ""` check applied.
 *
 * `weaponIds` is an optional explicit loadout, in slot order, that overrides the roster's own kit —
 * the dev-only playground picks any car/weapon combination rather than the shipped pairing (PG13).
 * It still runs through `slotsFrom` so the 3-slot cap holds exactly as it does for a roster loadout.
 */
export function newFireState(carId: CarId | "", level: number, weaponIds?: readonly WeaponId[]): FireState {
  const weapons = weaponIds ? slotsFrom(carId, weaponIds) : isCarId(carId) ? slotsOf(carId) : [];
  return {
    slots: weapons.map((weaponId) => ({
      weaponId,
      stocks: 1,
      rechargeEndsTick: 0,
      refireLockUntilTick: 0,
    })),
    switchLockUntilTick: 0,
    lastFiredSlot: -1,
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
export function tickRecharge(state: FireState, tick: number, cooldownMult = 1): FireState {
  return {
    ...state,
    slots: state.slots.map((slot, index) => {
      const def = weaponDefOf(slot.weaponId);
      const max = def.stock?.max ?? 1;
      if (slot.stocks >= max) return slot.rechargeEndsTick === 0 ? slot : { ...slot, rechargeEndsTick: 0 };
      if (slot.rechargeEndsTick === 0) {
        // NOT for the slot a committed press is still resolving. `beginFire` spends the stock at
        // press time while `releaseShots` starts the recharge at the LAST shot of the volley, so
        // every tick in between finds `stocks < max` with no timer running. Auto-starting one here
        // would anchor the cooldown to the tick after the press instead of to the last shot, and
        // `releaseShots` — which deliberately never restarts a running timer — would then leave it
        // alone: a 3-volley/80ms weapon on a 3s cooldown would come back at T+91 rather than the
        // authored T+96, and a `startUpMs: 500` weapon a whole 14 ticks early. The error grows with
        // burst length and wind-up, so it must be blocked here rather than papered over downstream.
        if (state.pending?.slot === index) return slot;
        return {
          ...slot,
          rechargeEndsTick: tick + scaleTicks(weaponTicksOf(slot.weaponId).cooldown, cooldownMult),
        };
      }
      if (tick < slot.rechargeEndsTick) return slot;

      const stocks = slot.stocks + 1;
      return {
        ...slot,
        stocks,
        rechargeEndsTick:
          stocks >= max ? 0 : tick + scaleTicks(weaponTicksOf(slot.weaponId).cooldown, cooldownMult),
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
 *
 * Gates on `tick >= pending.nextShotTick`, not exact equality: a pending shot must never be
 * strandable by an ordering choice or a skipped tick. Called in the documented order (see the
 * module comment above), this fires on exactly the scheduled tick every time; the `>=` is the
 * safety margin, not the mechanism.
 */
export function releaseShots(
  state: FireState,
  tick: number,
  cooldownMult = 1,
): { state: FireState; orders: ShotOrder[] } {
  const pending = state.pending;
  if (!pending || tick < pending.nextShotTick) return { state, orders: [] };

  const ticks = weaponTicksOf(pending.weaponId);
  const cooldown = scaleTicks(ticks.cooldown, cooldownMult);
  const refireDelay = scaleTicks(ticks.refireDelay, cooldownMult);
  const recovery = scaleTicks(ticks.recovery, cooldownMult);
  const orders: ShotOrder[] = [
    {
      weaponId: pending.weaponId,
      slot: pending.slot,
      finalVolley: pending.shotsLeft === 1,
      pressId: pending.pressId,
    },
  ];
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
        slot.stocks >= max ? 0 : slot.rechargeEndsTick === 0 ? tick + cooldown : slot.rechargeEndsTick,
      refireLockUntilTick: tick + refireDelay,
    };
  });

  return {
    state: {
      ...state,
      slots,
      pending: null,
      switchLockUntilTick: tick + recovery,
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
export function beginFire(
  sessionId: string,
  state: FireState,
  mask: number,
  tick: number,
): FireState {
  if (state.pending) return state;
  if (mask <= 0) return state;

  const usable = Math.min(state.slots.length, WEAPON_SLOT_CONFIG.maxWeaponSlots);
  for (let index = 0; index < usable; index++) {
    if ((mask & (1 << index)) === 0) continue;

    const slot = state.slots[index]!;
    const def = weaponDefOf(slot.weaponId);
    if (def.unlocksAt > state.level) continue;
    if (slot.stocks < 1) continue;

    // "The same weapon" means THIS SLOT, not this weapon id: the refire lock is per slot, so a
    // loadout carrying one weapon twice would otherwise skip the switch lock on the second slot
    // (same id) and find that slot's own refire lock still at 0. See `FireState.lastFiredSlot`.
    const sameSlot = state.lastFiredSlot === index;
    if (sameSlot && tick < slot.refireLockUntilTick) continue;
    if (!sameSlot && tick < state.switchLockUntilTick) continue;

    const volleys = def.volley.volleys;
    return {
      ...state,
      slots: state.slots.map((s, i) => (i === index ? { ...s, stocks: s.stocks - 1 } : s)),
      lastFiredSlot: index,
      pending: {
        weaponId: slot.weaponId,
        slot: index,
        shotsLeft: volleys,
        nextShotTick: tick + weaponTicksOf(slot.weaponId).startUp,
        pressId: `${sessionId}#${tick}#${index}`,
      },
    };
  }
  return state;
}

/** Drop a scheduled burst — a wreck does not finish firing. */
export function cancelPending(state: FireState): FireState {
  return state.pending === null ? state : { ...state, pending: null };
}
