import { describe, expect, it } from "vitest";
import { beginFire, cancelPending, newFireState, releaseShots, tickRecharge, type FireState } from "./fire.js";
import type { ShotOrder } from "./instances.js";

const SLOT_1 = 0b001;
const SLOT_2 = 0b010;

/** A fireball-only car, as shipped. */
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
    expect(state.slots[0]!.weaponId).toBe("fireball");
    expect(state.slots[0]!.stocks).toBe(1);
  });

  it("gives a player with no car no slots at all", () => {
    expect(newFireState("", 1).slots).toEqual([]);
  });
});

describe("pressing", () => {
  it("schedules a shot and spends a stock immediately", () => {
    const state = beginFire(fresh(), SLOT_1, 100);
    expect(state.pending).toEqual({ weaponId: "fireball", slot: 0, shotsLeft: 1, nextShotTick: 100 });
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
    twoSlot.slots.push({ ...twoSlot.slots[0]!, weaponId: "fireball" });
    const state = beginFire(twoSlot, SLOT_1 | SLOT_2, 100);
    expect(state.pending!.slot).toBe(0);
  });

  it("refuses a weapon whose unlocksAt is above the player's level", () => {
    const locked = newFireState("rectangle", 0); // level below every weapon's unlocksAt
    expect(beginFire(locked, SLOT_1, 100).pending).toBeNull();
  });

  it("ignores every press while a shot is already pending", () => {
    const winding: FireState = { ...fresh(), pending: { weaponId: "fireball", slot: 0, shotsLeft: 1, nextShotTick: 105 } };
    expect(beginFire(winding, SLOT_1, 100).pending!.nextShotTick).toBe(105);
  });
});

describe("releasing", () => {
  it("emits the order on the scheduled tick and starts the recharge", () => {
    const pressed = beginFire(fresh(), SLOT_1, 100);
    const { state, orders } = releaseShots(pressed, 100);
    expect(orders).toEqual([{ weaponId: "fireball", slot: 0 }]);
    expect(state.pending).toBeNull();
    expect(state.slots[0]!.rechargeEndsTick).toBe(115); // 500ms == 15 ticks
    expect(state.lastFiredSlot).toBe(0);
  });

  it("emits nothing before the scheduled tick", () => {
    const pressed = beginFire(fresh(), SLOT_1, 100);
    expect(releaseShots(pressed, 99).orders).toEqual([]);
  });
});

describe("stocks", () => {
  /**
   * `splinter` is the table's only multi-stock weapon: 3 stocks, a 400ms == 12-tick recharge, and a
   * 130ms refire that rounds up to 4 ticks at 30Hz. Oval carries it, so unlike the `repeater` this
   * replaced, every number here is one a player actually experiences.
   */
  const stocked = (): FireState => ({
    slots: [{ weaponId: "splinter", stocks: 1, rechargeEndsTick: 190, refireLockUntilTick: 0 }],
    switchLockUntilTick: 0,
    lastFiredSlot: -1,
    pending: null,
    level: 1,
  });

  it("adds a stock when the timer completes and restarts while below max", () => {
    const state = tickRecharge({ ...stocked() }, 190);
    expect(state.slots[0]!.stocks).toBe(2);
    expect(state.slots[0]!.rechargeEndsTick).toBe(202); // 190 + 12
  });

  it("clears the timer at max stocks rather than banking progress", () => {
    const nearlyFull: FireState = {
      ...stocked(),
      slots: [{ weaponId: "splinter", stocks: 2, rechargeEndsTick: 190, refireLockUntilTick: 0 }],
    };
    const full = tickRecharge(nearlyFull, 190);
    expect(full.slots[0]!.stocks).toBe(3);
    expect(full.slots[0]!.rechargeEndsTick).toBe(0);
  });

  it("starts a fresh full timer when firing from max, however long it sat full", () => {
    const full: FireState = {
      ...stocked(),
      slots: [{ weaponId: "splinter", stocks: 3, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
    };
    const waited = idle(full, 200, 500);
    const fired = releaseShots(beginFire(waited, SLOT_1, 700), 700).state;
    expect(fired.slots[0]!.rechargeEndsTick).toBe(712); // 700 + 12, a whole cooldown, not a shortened one
  });

  it("leaves a running timer untouched when firing below max", () => {
    const running = stocked();
    const fired = releaseShots(beginFire(running, SLOT_1, 100), 100).state;
    expect(fired.slots[0]!.rechargeEndsTick).toBe(190); // the in-flight timer keeps its remaining time
  });
});

describe("refire delay", () => {
  it("refuses a second shot of the same weapon before its refire delay, and allows it once the lock elapses", () => {
    // splinter's refireDelayMs is 130ms, which rounds UP to 4 ticks (133ms) at 30Hz. Two stocks
    // banked so a second press has ammo to spend; only the refire lock, not stock count, is under
    // test here.
    const twoStocks: FireState = {
      slots: [{ weaponId: "splinter", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
      switchLockUntilTick: 0,
      lastFiredSlot: -1,
      pending: null,
      level: 1,
    };
    const firstShot = releaseShots(beginFire(twoStocks, SLOT_1, 100), 100).state;
    expect(firstShot.slots[0]!.refireLockUntilTick).toBe(104); // 100 + 4

    expect(beginFire(firstShot, SLOT_1, 103).pending).toBeNull(); // still locked
    expect(beginFire(firstShot, SLOT_1, 104).pending).not.toBeNull(); // lock has elapsed
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
    let state = fresh(); // fireball: startUpMs 0, cooldownMs 500ms == 15 ticks, single stock
    const seen: ShotOrder[] = [];

    // Tick 100: press and fire must both land on this SAME tick — not the next one. Under the
    // plan's old order (recharge -> releaseShots -> beginFire), releaseShots would run before this
    // press was registered, and the shot would never go out at all (see the regression case below).
    let step1 = step(state, 100, SLOT_1);
    state = step1.state;
    seen.push(...step1.orders);
    expect(seen).toEqual([{ weaponId: "fireball", slot: 0 }]);
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
      { weaponId: "fireball", slot: 0 },
      { weaponId: "fireball", slot: 0 },
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
    expect(state.pending).toEqual({ weaponId: "fireball", slot: 0, shotsLeft: 1, nextShotTick: 100 });

    // The next call to releaseShots happens on the NEXT tick, 101 — one tick after nextShotTick.
    const releasedNextTick = releaseShots(state, 101);
    expect(releasedNextTick.orders).toEqual([{ weaponId: "fireball", slot: 0 }]); // late, but not lost
    expect(releasedNextTick.state.pending).toBeNull();
  });
});

describe("the two lockouts", () => {
  /**
   * `repeater` in slot 1 is the only weapon in the table with a real `recoveryMs` (5000ms == 150
   * ticks) — `fireball`'s is 0, so a fireball fixture can only ever prove the gate by hand-setting
   * `switchLockUntilTick`, never that `releaseShots` WRITES it. Its cooldown is 90 ticks and its
   * refire delay 3, so all three clocks are distinguishable in one fixture. Two stocks in slot 1 so
   * only the locks, never the ammo, decide anything.
   */
  const twoSlots = (): FireState => ({
    slots: [
      { weaponId: "repeater", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 },
      { weaponId: "fireball", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
    ],
    switchLockUntilTick: 0,
    lastFiredSlot: -1,
    pending: null,
    level: 1,
  });

  it("writes the recovery lockout from the weapon that fired", () => {
    const fired = releaseShots(beginFire(twoSlots(), SLOT_1, 200), 200).state;
    expect(fired.switchLockUntilTick).toBe(350); // 200 + 150 ticks == repeater's 5000ms recovery
  });

  it("blocks a different slot for recovery while allowing the same slot after its refire delay", () => {
    const fired = releaseShots(beginFire(twoSlots(), SLOT_1, 200), 200).state;
    expect(beginFire(fired, SLOT_1, 202).pending).toBeNull(); // same slot, still inside 200 + 3
    expect(beginFire(fired, SLOT_1, 203).pending).not.toBeNull(); // its own refire delay has elapsed
    expect(beginFire(fired, SLOT_2, 349).pending).toBeNull(); // other slot: waits out the recovery
    expect(beginFire(fired, SLOT_2, 350).pending).not.toBeNull();
  });

  it("holds the switch lock across two slots carrying the SAME weapon id", () => {
    // Reachable from config alone: a car whose `weapons` list repeats an id. Deciding "same weapon"
    // by id would let slot 2 skip the switch lock as "the same weapon" and then find its OWN
    // refireLockUntilTick still at 0 — a free second shot inside the recovery window.
    const duplicate: FireState = {
      ...twoSlots(),
      slots: [
        { weaponId: "repeater", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
        { weaponId: "repeater", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
      ],
    };
    const fired = releaseShots(beginFire(duplicate, SLOT_1, 200), 200).state;
    expect(fired.lastFiredSlot).toBe(0);
    expect(beginFire(fired, SLOT_2, 203).pending).toBeNull(); // a different SLOT, so the switch lock
    expect(beginFire(fired, SLOT_2, 350).pending).not.toBeNull();
  });
});

describe("volleys and wind-up", () => {
  /**
   * No shipped weapon has `volleys > 1` or `startUpMs > 0` (D22 ships zero balance change), so a
   * burst is staged by hand-building the `pending` a press would have produced. `tickRecharge`,
   * `beginFire` and `releaseShots` then run in the canonical per-tick order exactly as `runCombat`
   * calls them. `repeater` supplies the real numbers: 90-tick cooldown, 3 stocks, and a
   * `volleyIntervalMs` of 0 that `releaseShots` floors at one tick.
   */
  const bursting = (nextShotTick: number, shotsLeft: number, rechargeEndsTick = 0): FireState => ({
    slots: [{ weaponId: "repeater", stocks: 0, rechargeEndsTick, refireLockUntilTick: 0 }],
    switchLockUntilTick: 0,
    lastFiredSlot: 0,
    pending: { weaponId: "repeater", slot: 0, shotsLeft, nextShotTick },
    level: 1,
  });

  function drive(state: FireState, from: number, ticks: number): { state: FireState; shots: number[] } {
    let next = state;
    const shots: number[] = [];
    for (let tick = from; tick < from + ticks; tick++) {
      next = tickRecharge(next, tick);
      next = beginFire(next, 0, tick);
      const released = releaseShots(next, tick);
      next = released.state;
      for (const _ of released.orders) shots.push(tick);
    }
    return { state: next, shots };
  }

  it("starts the recharge at the LAST shot of a burst, not on the tick after the press", () => {
    const { state, shots } = drive(bursting(100, 3), 100, 20);
    expect(shots).toEqual([100, 101, 102]); // volleyInterval floors at one tick
    expect(state.pending).toBeNull();
    // 102 + 90. An auto-started timer on tick 101 would have ended it at 191 — five ticks early, and
    // `releaseShots` would have left that running timer alone rather than correcting it.
    expect(state.slots[0]!.rechargeEndsTick).toBe(192);
  });

  it("does not start the recharge during a wind-up either", () => {
    const { state, shots } = drive(bursting(105, 1), 100, 20);
    expect(shots).toEqual([105]);
    expect(state.slots[0]!.rechargeEndsTick).toBe(195); // 105 + 90, not 190 from an auto-start at 100
  });

  it("still completes a recharge that was already running when the burst began", () => {
    // The guard is narrow on purpose: it skips the AUTO-START only. A timer already in flight (a
    // stock banked from an earlier shot) keeps counting down through the burst and lands its stock.
    const { state } = drive(bursting(100, 3, 101), 100, 20);
    expect(state.slots[0]!.stocks).toBe(1);
    expect(state.slots[0]!.rechargeEndsTick).toBe(191); // 101 + 90, restarted below max and untouched
  });
});

describe("cancelling", () => {
  it("drops a pending burst, as a wreck does mid-volley", () => {
    const pressed = beginFire(fresh(), SLOT_1, 100);
    expect(cancelPending(pressed).pending).toBeNull();
  });
});
