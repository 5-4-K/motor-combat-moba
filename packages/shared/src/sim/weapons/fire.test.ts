import { describe, expect, it } from "vitest";
import { beginFire, cancelPending, newFireState, releaseShots, tickRecharge, type FireState } from "./fire.js";
import type { ShotOrder } from "./instances.js";

const SLOT_1 = 0b001;
const SLOT_2 = 0b010;

/** A cannon-only car, as shipped. */
const fresh = () => newFireState("rectangle", 1);

/** Drive a state forward n ticks of pure recharge. */
function idle(state: FireState, from: number, ticks: number): FireState {
  let next = state;
  for (let t = from; t < from + ticks; t++) next = tickRecharge(next, t);
  return next;
}

describe("slots", () => {
  it("starts with one stock in every slot", () => {
    const state = fresh();
    expect(state.slots).toHaveLength(1);
    expect(state.slots[0]!.weaponId).toBe("cannon");
    expect(state.slots[0]!.stocks).toBe(1);
  });

  it("gives a player with no car no slots at all", () => {
    expect(newFireState("", 1).slots).toEqual([]);
  });
});

describe("pressing", () => {
  it("schedules a shot and spends a stock immediately", () => {
    const state = beginFire(fresh(), SLOT_1, 100);
    expect(state.pending).toEqual({ weaponId: "cannon", slot: 0, shotsLeft: 1, nextShotTick: 100 });
    expect(state.slots[0]!.stocks).toBe(0);
  });

  it("ignores a press for a slot the car does not have", () => {
    expect(beginFire(fresh(), SLOT_2, 100).pending).toBeNull();
  });

  it("ignores a press with no stock left", () => {
    const spent = beginFire(fresh(), SLOT_1, 100);
    const released = releaseShots(spent, 100).state;
    expect(beginFire(released, SLOT_1, 101).pending).toBeNull();
  });

  it("fires the lowest pressed slot when two arrive on one tick", () => {
    const twoSlot = newFireState("rectangle", 1);
    twoSlot.slots.push({ ...twoSlot.slots[0]!, weaponId: "cannon" });
    const state = beginFire(twoSlot, SLOT_1 | SLOT_2, 100);
    expect(state.pending!.slot).toBe(0);
  });

  it("refuses a weapon whose unlocksAt is above the player's level", () => {
    const locked = newFireState("rectangle", 0); // level below every weapon's unlocksAt
    expect(beginFire(locked, SLOT_1, 100).pending).toBeNull();
  });

  it("ignores every press while a shot is already pending", () => {
    const winding: FireState = { ...fresh(), pending: { weaponId: "cannon", slot: 0, shotsLeft: 1, nextShotTick: 105 } };
    expect(beginFire(winding, SLOT_1, 100).pending!.nextShotTick).toBe(105);
  });
});

describe("releasing", () => {
  it("emits the order on the scheduled tick and starts the recharge", () => {
    const pressed = beginFire(fresh(), SLOT_1, 100);
    const { state, orders } = releaseShots(pressed, 100);
    expect(orders).toEqual([{ weaponId: "cannon", slot: 0 }]);
    expect(state.pending).toBeNull();
    expect(state.slots[0]!.rechargeEndsTick).toBe(115); // 500ms == 15 ticks
    expect(state.lastFiredWeaponId).toBe("cannon");
  });

  it("emits nothing before the scheduled tick", () => {
    const pressed = beginFire(fresh(), SLOT_1, 100);
    expect(releaseShots(pressed, 99).orders).toEqual([]);
  });
});

describe("stocks", () => {
  /**
   * `repeater`: the spec's D5 worked example (3 stocks, 3000ms == 90-tick cooldown at 30Hz) transcribed
   * literally. No car carries it — it exists purely so the stock mechanic has a real, multi-stock
   * weapon to prove itself against, since `cannon` is deliberately single-stock.
   */
  const stocked = (): FireState => ({
    slots: [{ weaponId: "repeater", stocks: 1, rechargeEndsTick: 190, refireLockUntilTick: 0 }],
    switchLockUntilTick: 0,
    lastFiredWeaponId: "",
    pending: null,
    level: 1,
  });

  it("adds a stock when the timer completes and restarts while below max", () => {
    const state = tickRecharge({ ...stocked() }, 190);
    expect(state.slots[0]!.stocks).toBe(2);
    expect(state.slots[0]!.rechargeEndsTick).toBe(280); // 190 + 90
  });

  it("clears the timer at max stocks rather than banking progress", () => {
    const nearlyFull: FireState = {
      ...stocked(),
      slots: [{ weaponId: "repeater", stocks: 2, rechargeEndsTick: 190, refireLockUntilTick: 0 }],
    };
    const full = tickRecharge(nearlyFull, 190);
    expect(full.slots[0]!.stocks).toBe(3);
    expect(full.slots[0]!.rechargeEndsTick).toBe(0);
  });

  it("starts a fresh full timer when firing from max, however long it sat full", () => {
    const full: FireState = {
      ...stocked(),
      slots: [{ weaponId: "repeater", stocks: 3, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
    };
    const waited = idle(full, 200, 500);
    const fired = releaseShots(beginFire(waited, SLOT_1, 700), 700).state;
    expect(fired.slots[0]!.rechargeEndsTick).toBe(790); // 700 + 90, a whole cooldown, not a shortened one
  });

  it("leaves a running timer untouched when firing below max", () => {
    const running = stocked();
    const fired = releaseShots(beginFire(running, SLOT_1, 100), 100).state;
    expect(fired.slots[0]!.rechargeEndsTick).toBe(190); // the in-flight timer keeps its remaining time
  });
});

describe("refire delay", () => {
  it("refuses a second shot of the same weapon before its refire delay, and allows it once the lock elapses", () => {
    // repeater's refireDelayMs is 100ms == 3 ticks at 30Hz. Two stocks banked so a second press has
    // ammo to spend; only the refire lock, not stock count, should be under test here.
    const twoStocks: FireState = {
      slots: [{ weaponId: "repeater", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
      switchLockUntilTick: 0,
      lastFiredWeaponId: "",
      pending: null,
      level: 1,
    };
    const firstShot = releaseShots(beginFire(twoStocks, SLOT_1, 100), 100).state;
    expect(firstShot.slots[0]!.refireLockUntilTick).toBe(103); // 100 + 3

    expect(beginFire(firstShot, SLOT_1, 102).pending).toBeNull(); // still locked
    expect(beginFire(firstShot, SLOT_1, 103).pending).not.toBeNull(); // lock has elapsed
  });
});

describe("per-tick order", () => {
  /** Every function call below uses the SAME tick number, exactly as a real per-tick loop would. */
  function step(state: FireState, tick: number, mask: number): { state: FireState; orders: ShotOrder[] } {
    const recharged = tickRecharge(state, tick);
    const pressed = beginFire(recharged, mask, tick);
    return releaseShots(pressed, tick);
  }

  it("fires a zero-start-up weapon on the tick it is pressed, in the canonical recharge -> beginFire -> releaseShots order", () => {
    let state = fresh(); // cannon: startUpMs 0, cooldownMs 500ms == 15 ticks, single stock
    const seen: ShotOrder[] = [];

    // Tick 100: press and fire must both land on this SAME tick — not the next one. Under the
    // plan's old order (recharge -> releaseShots -> beginFire), releaseShots would run before this
    // press was registered, and the shot would never go out at all (see the regression case below).
    let step1 = step(state, 100, SLOT_1);
    state = step1.state;
    seen.push(...step1.orders);
    expect(seen).toEqual([{ weaponId: "cannon", slot: 0 }]);
    expect(state.pending).toBeNull();
    expect(state.slots[0]!.stocks).toBe(0);

    // Ticks 101-114: idle, no stock yet, nothing fires.
    for (let tick = 101; tick < 115; tick++) {
      const idled = step(state, tick, 0);
      state = idled.state;
      seen.push(...idled.orders);
    }
    expect(seen).toHaveLength(1);
    expect(state.slots[0]!.stocks).toBe(0);

    // Tick 115: the stock lands on this exact tick (100 + 15). A second press must fire again, same
    // tick, proving the cycle repeats rather than being a one-shot fluke.
    const step2 = step(state, 115, SLOT_1);
    state = step2.state;
    seen.push(...step2.orders);
    expect(seen).toEqual([
      { weaponId: "cannon", slot: 0 },
      { weaponId: "cannon", slot: 0 },
    ]);
  });

  it("would strand a zero-start-up press forever under the plan's old recharge -> releaseShots -> beginFire order, on a strict-equality release gate", () => {
    // This reproduces the exact defect: releaseShots runs BEFORE the press it should be releasing is
    // even registered, so the shot schedule set by beginFire this tick is only ever checked again on
    // a LATER tick, and `releaseShots`'s current `tick >= pending.nextShotTick` gate (not exact
    // equality) is what keeps it from being lost forever — it fires one tick late instead. Read this
    // as documentation of why the order in the test above is the one callers must use: firing one
    // tick late, not on the pressed tick, would fail this suite's other timing assertions even though
    // it no longer jams.
    let state = fresh();
    state = tickRecharge(state, 100);
    const releasedBeforePress = releaseShots(state, 100); // nothing pending yet: no-op
    expect(releasedBeforePress.orders).toEqual([]);
    state = releasedBeforePress.state;
    state = beginFire(state, SLOT_1, 100); // press registers AFTER release already ran this tick
    expect(state.pending).toEqual({ weaponId: "cannon", slot: 0, shotsLeft: 1, nextShotTick: 100 });

    // The next call to releaseShots happens on the NEXT tick, 101 — one tick after nextShotTick.
    const releasedNextTick = releaseShots(state, 101);
    expect(releasedNextTick.orders).toEqual([{ weaponId: "cannon", slot: 0 }]); // late, but not lost
    expect(releasedNextTick.state.pending).toBeNull();
  });
});

describe("the two lockouts", () => {
  it("blocks a different weapon for recovery while allowing the same one after its refire delay", () => {
    // cooldown 3s (90 ticks), recovery 5s (150 ticks), refire delay 0, 2 stocks banked.
    const state: FireState = {
      slots: [
        { weaponId: "cannon", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 },
        { weaponId: "cannon", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
      ],
      switchLockUntilTick: 250,
      lastFiredWeaponId: "cannon",
      pending: null,
      level: 1,
    };
    // Slot 2 holds a different LAST-FIRED identity only via lastFiredWeaponId; the switch lock gates it.
    expect(beginFire(state, SLOT_1, 200).pending).not.toBeNull(); // same weapon: allowed
    expect(beginFire({ ...state, lastFiredWeaponId: "other" }, SLOT_1, 200).pending).toBeNull();
  });
});

describe("cancelling", () => {
  it("drops a pending burst, as a wreck does mid-volley", () => {
    const pressed = beginFire(fresh(), SLOT_1, 100);
    expect(cancelPending(pressed).pending).toBeNull();
  });
});
