import { describe, expect, it } from "vitest";
import { beginFire, cancelPending, newFireState, releaseShots, tickRecharge, type FireState } from "./fire.js";
import type { ShotOrder } from "./instances.js";

const SLOT_1 = 0b001;
const SLOT_2 = 0b010;

/** Rectangle, as shipped: slot 1 fireball, slot 2 pepperbox, slot 3 afterburner. */
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
    expect(state.slots).toHaveLength(3);
    expect(state.slots.map((s) => s.weaponId)).toEqual(["fireball", "pepperbox", "afterburner"]);
    expect(state.slots.every((s) => s.stocks === 1)).toBe(true);
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
    // Every shipped chassis now fills all three slots (Task 5), so this constructs a car short one
    // slot rather than relying on a real `CarId` to be under-loaded.
    const oneSlot: FireState = { ...fresh(), slots: fresh().slots.slice(0, 1) };
    expect(beginFire(oneSlot, SLOT_2, 100).pending).toBeNull();
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
   * The roster splits the two clocks across two weapons, so the fixture carries both. `lance` in
   * slot 2 owns the recovery (1000ms == 30 ticks) — it is the only row with a substantial one, and
   * `fireball`'s is 0, so a fireball fixture can only prove the gate by hand-setting
   * `switchLockUntilTick`, never that `releaseShots` WRITES it. `splinter` in slot 1 owns the
   * refire delay (130ms == 4 ticks) and has `recoveryMs: 0`, which is itself worth asserting: a
   * go-to must never gate another slot.
   *
   * BOTH clocks are written by `releaseShots` at the tick the shot EXITS — never by `beginFire` at
   * press time (`fire.ts:165,174`). `repeater` hid that distinction because its `startUpMs` was 0,
   * so press and release fell on the same tick. `lance` winds up for 700ms == 21 ticks, so a press
   * at 200 does not release, and does not write the switch lock, until 221. `fireAt` drives that.
   */
  const twoSlots = (): FireState => ({
    slots: [
      { weaponId: "splinter", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 },
      { weaponId: "lance", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
    ],
    switchLockUntilTick: 0,
    lastFiredSlot: -1,
    pending: null,
    level: 1,
  });

  /** Press `mask` at `pressTick`, then run ticks until the shot actually exits. */
  function fireAt(state: FireState, mask: number, pressTick: number, throughTick: number): FireState {
    let next = beginFire(state, mask, pressTick);
    for (let tick = pressTick; tick <= throughTick; tick++) next = releaseShots(next, tick).state;
    return next;
  }

  const LANCE_EXIT = 221; // pressed at 200; nextShotTick == tick + startUp == 200 + 21

  it("writes the recovery lockout from the weapon that fired, at the tick the shot exits", () => {
    const fired = fireAt(twoSlots(), SLOT_2, 200, LANCE_EXIT);
    expect(fired.pending).toBeNull(); // the wind-up has run out and the beam is away
    expect(fired.switchLockUntilTick).toBe(251); // 221 + 30 ticks == lance's 1000ms recovery
  });

  it("blocks a different slot for the firing weapon's recovery", () => {
    const fired = fireAt(twoSlots(), SLOT_2, 200, LANCE_EXIT);
    expect(beginFire(fired, SLOT_1, 250).pending).toBeNull();
    expect(beginFire(fired, SLOT_1, 251).pending).not.toBeNull();
  });

  it("gates the same slot on its own refire delay, and gates no other slot at zero recovery", () => {
    // splinter's startUpMs is 0, so its shot exits on the press tick and both clocks land at 200.
    const fired = releaseShots(beginFire(twoSlots(), SLOT_1, 200), 200).state;
    expect(fired.slots[0]!.refireLockUntilTick).toBe(204); // 200 + 4
    expect(beginFire(fired, SLOT_1, 203).pending).toBeNull(); // same slot, still inside the lock
    expect(beginFire(fired, SLOT_1, 204).pending).not.toBeNull(); // its own refire delay elapsed
    expect(fired.switchLockUntilTick).toBe(200); // splinter's recoveryMs is 0: no switch lock at all
    expect(beginFire(fired, SLOT_2, 201).pending).not.toBeNull(); // so the other slot is free
  });

  it("holds the switch lock across two slots carrying the SAME weapon id", () => {
    // Reachable from config alone: a car whose `weapons` list repeats an id. Deciding "same weapon"
    // by id would let slot 2 skip the switch lock as "the same weapon" and then find its OWN
    // refireLockUntilTick still at 0 — a free second shot inside the recovery window.
    const duplicate: FireState = {
      ...twoSlots(),
      slots: [
        { weaponId: "lance", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
        { weaponId: "lance", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
      ],
    };
    const fired = fireAt(duplicate, SLOT_1, 200, LANCE_EXIT);
    expect(fired.lastFiredSlot).toBe(0);
    expect(beginFire(fired, SLOT_2, 250).pending).toBeNull(); // a different SLOT, so the switch lock
    expect(beginFire(fired, SLOT_2, 251).pending).not.toBeNull();
  });
});

describe("volleys and wind-up", () => {
  /**
   * `pepperbox` is the table's first real burst: 3 volleys of 2 pellets at a 100ms == 3-tick
   * interval, on a 1800ms == 54-tick cooldown. Before it shipped this fixture had to hand-build the
   * `pending` a press would have produced; it no longer does, so the burst path is now exercised
   * with the numbers a player actually fires.
   */
  const bursting = (nextShotTick: number, shotsLeft: number, rechargeEndsTick = 0): FireState => ({
    slots: [{ weaponId: "pepperbox", stocks: 0, rechargeEndsTick, refireLockUntilTick: 0 }],
    switchLockUntilTick: 0,
    lastFiredSlot: 0,
    pending: { weaponId: "pepperbox", slot: 0, shotsLeft, nextShotTick },
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
    expect(shots).toEqual([100, 103, 106]); // 100ms == 3-tick volley interval
    expect(state.pending).toBeNull();
    // 106 + 54. An auto-started timer on tick 101 would have ended it at 155 — five ticks early, and
    // `releaseShots` would have left that running timer alone rather than correcting it.
    expect(state.slots[0]!.rechargeEndsTick).toBe(160);
  });

  it("does not start the recharge during a wind-up either", () => {
    const { state, shots } = drive(bursting(105, 1), 100, 20);
    expect(shots).toEqual([105]);
    expect(state.slots[0]!.rechargeEndsTick).toBe(159); // 105 + 54, not 154 from an auto-start at 100
  });

  it("still completes a recharge that was already running when the burst began", () => {
    // The guard is narrow on purpose: it skips the AUTO-START only. A timer already in flight (a
    // stock banked from an earlier shot) keeps counting down through the burst and lands its stock
    // exactly on schedule, at tick 101, regardless of the pending burst.
    const { state } = drive(bursting(100, 3, 101), 100, 20);
    expect(state.slots[0]!.stocks).toBe(1);
    // Unlike `repeater` (3 stocks), `pepperbox` ships with no `stock` block at all, so its cap is
    // the single-stock default of 1. Landing that one stock at tick 101 already puts it AT max, so
    // when the burst's LAST shot (tick 106) reaches the completion branch in `releaseShots`, it
    // finds `stocks >= max` and CLEARS the timer instead of restarting it — the "restarted below
    // max, untouched" case this test proved for `repeater` cannot happen for a single-stock weapon,
    // there is no room left to bank another stock. The guard itself is still proven here: the
    // in-flight timer was not frozen or reset early by the pending burst, it simply had nowhere
    // left to go once it landed.
    expect(state.slots[0]!.rechargeEndsTick).toBe(0);
  });
});

describe("cancelling", () => {
  it("drops a pending burst, as a wreck does mid-volley", () => {
    const pressed = beginFire(fresh(), SLOT_1, 100);
    expect(cancelPending(pressed).pending).toBeNull();
  });
});
