import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { basicAttackOf } from "../../config/car-config.js";
import { BASIC_ATTACK_CONFIG } from "../../config/weapon-config.js";
import { WEAPON_SLOT_CONFIG } from "../../config/weapon-slots.js";
import type { WeaponId } from "../../config/weapon-types.js";
import { beginFire, cancelPending, newFireState, releaseShots, tickRecharge, type FireState } from "./fire.js";
import type { ShotOrder } from "./instances.js";
import { turnTurret } from "./turret.js";

/**
 * Bits addressing the FIRST and SECOND entry of whatever slot array a fixture carries. The
 * hand-built fixtures below (`stocked`, `twoSlots`, `duplicate`) list their weapons directly, so
 * these are what press them.
 */
const SLOT_1 = 0b001;
const SLOT_2 = 0b010;

/**
 * Bits addressing ability 1 and ability 2 of a ROSTER-built state. `newFireState` returns
 * `[basicAttack, ...kit]` (VS6), so an ability's bit sits one left of its place in the kit —
 * pressing `0b001` on a roster car fires its basic attack, not its opener.
 */
const ABILITY_1 = 0b010;

/**
 * Pins `BASIC_ATTACK_CONFIG.enabled` ON for the enclosing `describe`, restoring whatever the build
 * ships afterwards.
 *
 * Needed because `beginFire` refuses fire slot 0 outright while the toggle is off (VS6: slot 0 IS
 * the basic-attack slot, whatever weapon a fixture happens to put there), so any block that presses
 * bit 0 — including the hand-built fixtures below, whose first entry is an ordinary ability —
 * measures nothing in a build shipping `enabled: false`. Blocks that test the TOGGLE set the flag
 * themselves and do not call this.
 */
function pinBasicAttackEnabled(): void {
  const shipped = BASIC_ATTACK_CONFIG.enabled;
  beforeEach(() => {
    BASIC_ATTACK_CONFIG.enabled = true;
  });
  afterEach(() => {
    BASIC_ATTACK_CONFIG.enabled = shipped;
  });
}

/** Bullseye, as shipped since the 2026-09-02 loadout swap: slot 1 predator, slot 2 pepperbox, slot 3 lance. */
const fresh = () => newFireState("bullseye", 1);

/** Drive a state forward n ticks of pure recharge. */
function idle(state: FireState, from: number, ticks: number): FireState {
  let next = state;
  for (let t = from; t < from + ticks; t++) next = tickRecharge(next, t);
  return next;
}

describe("slots", () => {
  it("starts with one stock in every slot", () => {
    const state = fresh();
    expect(state.slots).toHaveLength(4);
    expect(state.slots.map((s) => s.weaponId)).toEqual([
      "basic-attack-bullseye",
      "predator",
      "pepperbox",
      "lance",
    ]);
    expect(state.slots.every((s) => s.stocks === 1)).toBe(true);
  });

  it("gives a player with no car no slots at all", () => {
    expect(newFireState("", 1).slots).toEqual([]);
  });

  it("takes an explicit weaponIds loadout in place of the roster's, for the playground (PG13)", () => {
    const state = newFireState("mirage", 1, ["lance", "pepperbox", "thumper"]);
    expect(state.slots.map((s) => s.weaponId)).toEqual([
      "basic-attack-mirage",
      "lance",
      "pepperbox",
      "thumper",
    ]);
  });

  it("falls back to the roster's slots when weaponIds is omitted, matching a plain call", () => {
    expect(newFireState("mirage", 1, undefined)).toEqual(newFireState("mirage", 1));
  });

  it("lets a short kit fire every slot it has, and ignores bits past it", () => {
    // VS7. The fire-slot array is DENSE at every kit length — a short kit produces a short array,
    // not holes — so `usable = min(slots.length, maxFireSlots)` handles it with no special case.
    const state = newFireState("bullseye", 1, ["predator"]);
    expect(state.slots).toHaveLength(2);
    expect(beginFire("s1", state, 0b0010, 0).pending?.weaponId).toBe("predator");
    // Bit 3 is ability 3, which this chassis does not carry: dropped, not crashed.
    expect(beginFire("s1", state, 0b1000, 0).pending).toBeNull();
  });
});

describe("variable kit length (Task 5)", () => {
  it("keeps the basic attack at slot 0 at every kit length", () => {
    // VS27. The invariant that was previously true only by coincidence, and the reason the
    // "exactly maxAbilitySlots" assertion in weapon-slots.test.ts could be relaxed at all.
    //
    // Bounded by `maxAbilitySlots` (Ruling 1) rather than the brief's fixed [1, 2, 3, 4]: an
    // explicit 4-weapon loadout is truncated to N (=3) by `slotsFrom`, so a loop that always went
    // up to 4 would fail at the shipped N instead of staying honest about what this build allows.
    const kits = Array.from({ length: WEAPON_SLOT_CONFIG.maxAbilitySlots }, (_, i) => i + 1);
    for (const kit of kits) {
      const weapons = ["predator", "pepperbox", "lance", "tremor"].slice(0, kit) as WeaponId[];
      const state = newFireState("bullseye", 1, weapons);
      expect(state.slots[0]!.weaponId).toBe(basicAttackOf("bullseye"));
      expect(state.slots).toHaveLength(kit + 1);
    }
  });
});

describe("pressing", () => {
  it("schedules a shot and spends a stock immediately", () => {
    // `predator` is a FIXED-MUZZLE row on this build (`development/main` returned it, `magmablast`
    // and `thumper` to fixed muzzles when the basic attack went off), so the press schedules its
    // shot immediately: `bearing` is null and `aligned` is true from `beginFire`. The `turnTurret`
    // call below is kept because it is the canonical per-tick order, and a no-op on a fixed-muzzle
    // press is part of what that order has to get right. `turret.test.ts` covers the turret phase.
    let state = beginFire("p1", fresh(), ABILITY_1, 100);
    expect(state.slots[1]!.stocks).toBe(0);
    state = turnTurret(state, 0, 100);
    expect(state.pending).toEqual({
      weaponId: "predator",
      slot: 1,
      shotsLeft: 1,
      nextShotTick: 100,
      pressId: "p1#100#1",
      bearing: null,
      aligned: true,
    });
  });

  it("ignores a press for a slot the car does not have", () => {
    // Every shipped chassis now fills all three slots (Task 5), so this constructs a car short one
    // slot rather than relying on a real `CarId` to be under-loaded.
    const oneSlot: FireState = { ...fresh(), slots: fresh().slots.slice(0, 1) };
    expect(beginFire("p1", oneSlot, SLOT_2, 100).pending).toBeNull();
  });

  it("ignores a press with no stock left", () => {
    let spent = beginFire("p1", fresh(), ABILITY_1, 100);
    spent = turnTurret(spent, 0, 100); // canonical order; a no-op for fixed-muzzle predator
    const released = releaseShots(spent, 100).state;
    expect(beginFire("p1", released, ABILITY_1, 101).pending).toBeNull();
  });

  it("fires the highest pressed slot when two arrive on one tick (VS12)", () => {
    const twoSlot = newFireState("mirage", 1);
    twoSlot.slots.push({ ...twoSlot.slots[0]!, weaponId: "predator" });
    const state = beginFire("p1", twoSlot, SLOT_1 | SLOT_2, 100);
    expect(state.pending!.slot).toBe(1);
  });

  it("refuses a weapon whose unlocksAt is above the player's level", () => {
    const locked = newFireState("mirage", 0); // level below every weapon's unlocksAt
    expect(beginFire("p1", locked, SLOT_1, 100).pending).toBeNull();
  });

  it("ignores every press while a shot is already pending", () => {
    const winding: FireState = {
      ...fresh(),
      pending: { weaponId: "predator", slot: 0, shotsLeft: 1, nextShotTick: 105, pressId: "p1#100#0" },
    };
    expect(beginFire("p1", winding, SLOT_1, 100).pending!.nextShotTick).toBe(105);
  });
});

describe("releasing", () => {
  it("emits the order on the scheduled tick and starts the recharge", () => {
    let pressed = beginFire("p1", fresh(), ABILITY_1, 100);
    pressed = turnTurret(pressed, 0, 100); // canonical order; a no-op for fixed-muzzle predator
    const { state, orders } = releaseShots(pressed, 100);
    expect(orders).toEqual([
      { weaponId: "predator", slot: 1, finalVolley: true, pressId: "p1#100#1", bearing: null },
    ]);
    expect(state.pending).toBeNull();
    expect(state.slots[1]!.rechargeEndsTick).toBe(130); // 1000ms == 30 ticks
    expect(state.lastFiredSlot).toBe(1);
  });

  it("emits nothing before the scheduled tick", () => {
    const pressed = beginFire("p1", fresh(), ABILITY_1, 100);
    expect(releaseShots(pressed, 99).orders).toEqual([]);
  });
});

/**
 * SKIPPED since 2026-08-30, and deliberately kept rather than deleted.
 *
 * `needler` was the table's only weapon with a `stock` block, and the 2026-08-30 tuning pass
 * removed it; the 2026-09-01 overhaul then retired the id itself, so `"needler"` below is no longer
 * even a valid `WeaponId` and is kept ONLY as a same-shaped placeholder literal — the specific
 * numbers in each test's comments are needler's historical ones, preserved as the record of what
 * `StockDef` was last proven against, not a claim about the placeholder id used to keep this
 * type-checking. The stock and refire-delay machinery in `fire.ts` is untouched and still correct,
 * but every test below drives it through `weaponDefOf`, a lookup into `WEAPON_TABLE` — so with no
 * stocked row in the table there is nothing for these to exercise, and they assert against a
 * `stock?.max ?? 1` fallback instead of against a magazine.
 *
 * **Un-skip these the moment any weapon authors a `stock` block again**, and re-point the fixtures
 * at that weapon's real id and its real recharge/refire tick counts. They are the only coverage
 * `StockDef` has.
 */
describe.skip("stocks", () => {
  /**
   * needler's historical shape: 3 stocks, a 300ms == 9-tick recharge, and a 110ms refire that
   * rounds up to 4 ticks at 30Hz. `weaponId` below is a placeholder (see the block comment above).
   */
  const stocked = (): FireState => ({
    slots: [{ weaponId: "magmablast", stocks: 1, rechargeEndsTick: 190, refireLockUntilTick: 0 }],
    switchLockUntilTick: 0,
    lastFiredSlot: -1,
    pending: null,
    level: 1,
  });

  it("adds a stock when the timer completes and restarts while below max", () => {
    const state = tickRecharge({ ...stocked() }, 190);
    expect(state.slots[0]!.stocks).toBe(2);
    expect(state.slots[0]!.rechargeEndsTick).toBe(199); // 190 + 9
  });

  it("clears the timer at max stocks rather than banking progress", () => {
    const nearlyFull: FireState = {
      ...stocked(),
      slots: [{ weaponId: "magmablast", stocks: 2, rechargeEndsTick: 190, refireLockUntilTick: 0 }],
    };
    const full = tickRecharge(nearlyFull, 190);
    expect(full.slots[0]!.stocks).toBe(3);
    expect(full.slots[0]!.rechargeEndsTick).toBe(0);
  });

  it("starts a fresh full timer when firing from max, however long it sat full", () => {
    const full: FireState = {
      ...stocked(),
      slots: [{ weaponId: "magmablast", stocks: 3, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
    };
    const waited = idle(full, 200, 500);
    const fired = releaseShots(beginFire("p1", waited, SLOT_1, 700), 700).state;
    expect(fired.slots[0]!.rechargeEndsTick).toBe(709); // 700 + 9, a whole cooldown, not a shortened one
  });

  it("leaves a running timer untouched when firing below max", () => {
    const running = stocked();
    const fired = releaseShots(beginFire("p1", running, SLOT_1, 100), 100).state;
    expect(fired.slots[0]!.rechargeEndsTick).toBe(190); // the in-flight timer keeps its remaining time
  });
});

/**
 * SKIPPED since 2026-08-30, and deliberately kept rather than deleted. See the "stocks" block above
 * for why `"needler"` survives here only as a type-valid placeholder, not a real weapon reference.
 */
describe.skip("refire delay", () => {
  it("refuses a second shot of the same weapon before its refire delay, and allows it once the lock elapses", () => {
    // needler's historical refireDelayMs is 110ms, which rounds UP to 4 ticks (133ms) at 30Hz. Two
    // stocks banked so a second press has ammo to spend; only the refire lock, not stock count, is
    // under test here.
    const twoStocks: FireState = {
      slots: [{ weaponId: "magmablast", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
      switchLockUntilTick: 0,
      lastFiredSlot: -1,
      pending: null,
      level: 1,
    };
    const firstShot = releaseShots(beginFire("p1", twoStocks, SLOT_1, 100), 100).state;
    expect(firstShot.slots[0]!.refireLockUntilTick).toBe(104); // 100 + 4

    expect(beginFire("p1", firstShot, SLOT_1, 103).pending).toBeNull(); // still locked
    expect(beginFire("p1", firstShot, SLOT_1, 104).pending).not.toBeNull(); // lock has elapsed
  });
});

describe("per-tick order", () => {
  /**
   * Every function call below uses the SAME tick number, exactly as a real per-tick loop would.
   * `turnTurret` sits between `beginFire` and `releaseShots` per the canonical order (fire.ts's
   * module doc). `predator` is fixed-muzzle on this build, so that call is a no-op here and the
   * timing is the plain zero-start-up one — which is what makes this a test of the ORDER rather
   * than of the turret. `turret.test.ts` runs the same order against a real turret row.
   */
  function step(state: FireState, tick: number, mask: number): { state: FireState; orders: ShotOrder[] } {
    const recharged = tickRecharge(state, tick);
    const pressed = beginFire("p1", recharged, mask, tick);
    const turned = turnTurret(pressed, 0, tick);
    return releaseShots(turned, tick);
  }

  it("fires a zero-start-up weapon on the tick it is pressed, in the canonical recharge -> beginFire -> turnTurret -> releaseShots order", () => {
    let state = fresh(); // predator: startUpMs 0, cooldownMs 1000ms == 30 ticks, single stock
    const seen: ShotOrder[] = [];

    // Tick 100: press and fire must both land on this SAME tick — not the next one. Under the
    // plan's old order (recharge -> releaseShots -> beginFire), releaseShots would run before this
    // press was registered, and the shot would never go out at all (see the regression case below).
    let step1 = step(state, 100, ABILITY_1);
    state = step1.state;
    seen.push(...step1.orders);
    expect(seen).toEqual([
      { weaponId: "predator", slot: 1, finalVolley: true, pressId: "p1#100#1", bearing: null },
    ]);
    expect(state.pending).toBeNull();
    expect(state.slots[1]!.stocks).toBe(0);

    // Ticks 101-129: idle, no stock yet, nothing fires.
    for (let tick = 101; tick < 130; tick++) {
      const idled = step(state, tick, 0);
      state = idled.state;
      seen.push(...idled.orders);
    }
    expect(seen).toHaveLength(1);
    expect(state.slots[1]!.stocks).toBe(0);

    // Tick 130: the stock lands on this exact tick (100 + 30). A second press must fire again, same
    // tick, proving the cycle repeats rather than being a one-shot fluke.
    const step2 = step(state, 130, ABILITY_1);
    state = step2.state;
    seen.push(...step2.orders);
    expect(seen).toEqual([
      { weaponId: "predator", slot: 1, finalVolley: true, pressId: "p1#100#1", bearing: null },
      { weaponId: "predator", slot: 1, finalVolley: true, pressId: "p1#130#1", bearing: null },
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
    state = beginFire("p1", state, ABILITY_1, 100); // press registers AFTER release already ran this tick
    state = turnTurret(state, 0, 100); // canonical order; a no-op for fixed-muzzle predator
    expect(state.pending).toEqual({
      weaponId: "predator",
      slot: 1,
      shotsLeft: 1,
      nextShotTick: 100,
      pressId: "p1#100#1",
      bearing: null,
      aligned: true,
    });

    // The next call to releaseShots happens on the NEXT tick, 101 — one tick after nextShotTick.
    const releasedNextTick = releaseShots(state, 101);
    expect(releasedNextTick.orders).toEqual([
      { weaponId: "predator", slot: 1, finalVolley: true, pressId: "p1#100#1", bearing: null },
    ]); // late, but not lost
    expect(releasedNextTick.state.pending).toBeNull();
  });
});

describe("the two lockouts", () => {
  pinBasicAttackEnabled();

  /**
   * The roster splits the two clocks across two weapons, so the fixture carries both. `lance` in
   * slot 2 owns the recovery (1000ms == 30 ticks) — it is the only row with a substantial one, and
   * most other rows' is 0, so a zero-recovery fixture can only prove the gate by hand-setting
   * `switchLockUntilTick`, never that `releaseShots` WRITES it. Slot 1 below carries `magmablast`
   * (`recoveryMs: 0`), which is itself worth asserting: a go-to must never gate another slot. It was
   * `needler` historically, retired 2026-09-01 — see the "stocks" block above for why a retired id
   * cannot stand in a live fixture any more, even one that never dereferences its `stock` block.
   *
   * BOTH clocks are written by `releaseShots` at the tick the shot EXITS — never by `beginFire` at
   * press time (`fire.ts:165,174`). `repeater` hid that distinction because its `startUpMs` was 0,
   * so press and release fell on the same tick. `lance` winds up for 700ms == 21 ticks, so a press
   * at 200 does not release, and does not write the switch lock, until 221. `fireAt` drives that.
   */
  const twoSlots = (): FireState => ({
    slots: [
      { weaponId: "magmablast", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 },
      { weaponId: "lance", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
    ],
    switchLockUntilTick: 0,
    lastFiredSlot: -1,
    pending: null,
    level: 1,
    turretAngle: 0,
  });

  /** Press `mask` at `pressTick`, then run ticks until the shot actually exits. */
  function fireAt(state: FireState, mask: number, pressTick: number, throughTick: number): FireState {
    let next = beginFire("p1", state, mask, pressTick);
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
    expect(beginFire("p1", fired, SLOT_1, 250).pending).toBeNull();
    expect(beginFire("p1", fired, SLOT_1, 251).pending).not.toBeNull();
  });

  // SKIPPED with the stock suites above: the refire-delay half of this needs a stocked weapon.
  // Numbers below are needler's historical ones (retired 2026-09-01); slot 0 above is a type-valid
  // placeholder, not a claim that `magmablast` itself has a 4-tick refire delay.
  it.skip("gates the same slot on its own refire delay, and gates no other slot at zero recovery", () => {
    // needler's startUpMs was 0, so its shot exited on the press tick and both clocks landed at 200.
    const fired = releaseShots(beginFire("p1", twoSlots(), SLOT_1, 200), 200).state;
    expect(fired.slots[0]!.refireLockUntilTick).toBe(204); // 200 + 4
    expect(beginFire("p1", fired, SLOT_1, 203).pending).toBeNull(); // same slot, still inside the lock
    expect(beginFire("p1", fired, SLOT_1, 204).pending).not.toBeNull(); // its own refire delay elapsed
    expect(fired.switchLockUntilTick).toBe(200); // recoveryMs 0 on this slot: no switch lock at all
    expect(beginFire("p1", fired, SLOT_2, 201).pending).not.toBeNull(); // so the other slot is free
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
    expect(beginFire("p1", fired, SLOT_2, 250).pending).toBeNull(); // a different SLOT, so the switch lock
    expect(beginFire("p1", fired, SLOT_2, 251).pending).not.toBeNull();
  });
});

// A whole "volleys and wind-up" suite drove `shockwave`'s old three-wave burst (a beam, 250ms
// interval, `onWave: "final"`) through this real fire-state machinery — the load-bearing proof that
// `beginFire` reads `def.volley.volleys` for a beam rather than hardcoding 1. As of the 2026-09-01
// overhaul that row (`magmablast`, née `shockwave`) is a plain single-volley dart, and the
// 2026-09-02 pass gave it an on-death explosion instead of a second identity change — no shipped
// row is multi-wave any more:
// multi-wave volleys and `onWave` are dormant machinery — `VolleyDef` and `beginFire`'s kind-agnostic
// read of it are still exercised generically elsewhere in this file (see "per-tick order"), just not
// against a real multi-wave row. Deleted rather than retargeted: `fire.ts` has no `def` override
// seam (unlike `instances.ts`), so there is no way to drive a synthetic multi-wave def through it —
// only a real `WEAPON_TABLE` row, and none is one. The `disc`/`origin: "center"` aura itself is NOT
// dormant, unlike the claim this comment used to make: `magmablast`'s explosion is a real
// detached, centre-origin `disc` instance (see `combat.ts`'s "magma blast detonation" tests) — it
// is just spawned by `runCombat`'s detonation path, never by this file's fire-state machinery.

describe("cancelling", () => {
  it("drops a pending burst, as a wreck does mid-volley", () => {
    const pressed = beginFire("p1", fresh(), ABILITY_1, 100);
    expect(cancelPending(pressed).pending).toBeNull();
  });
});

describe("beginFire pressId (B7)", () => {
  pinBasicAttackEnabled();

  it("mints sessionId#tick#slot on the committed press", () => {
    const state = newFireState("mirage", 1);
    const next = beginFire("p1", state, 0b1, 10);
    expect(next.pending?.pressId).toBe("p1#10#0");
  });

  it("gives two players pressing the same slot on the same tick different ids", () => {
    const a = beginFire("p1", newFireState("mirage", 1), 0b1, 10);
    const b = beginFire("p2", newFireState("mirage", 1), 0b1, 10);
    expect(a.pending?.pressId).not.toBe(b.pending?.pressId);
  });

  it("gives the same player different ids on different ticks", () => {
    const a = beginFire("p1", newFireState("mirage", 1), 0b1, 10);
    const b = beginFire("p1", newFireState("mirage", 1), 0b1, 11);
    expect(a.pending?.pressId).not.toBe(b.pending?.pressId);
  });
});

describe("the basic attack slot", () => {
  // These cover the MECHANIC, which `BASIC_ATTACK_CONFIG.enabled` switches off without deleting —
  // so they pin the flag on rather than lean on however the build happens to ship it. Without this
  // the block silently stops testing anything the day the toggle goes off, which is exactly when a
  // regression in it would go unnoticed. The toggle's own behaviour is covered further down.
  pinBasicAttackEnabled();

  it("builds its slots with the basic attack FIRST, ahead of an unmoved kit (VS6)", () => {
    // VS6/VS9. `newFireState`'s explicit-loadout path builds this order inline rather than calling
    // `fireSlotsOf`, so it needs its own assertion or the two can silently diverge. This replaces
    // BA13's "sits last": the basic attack moved to slot 0, the kit order behind it did not move.
    const state = newFireState("bastion", 1);
    expect(state.slots.map((s) => s.weaponId)).toEqual([
      basicAttackOf("bastion"),
      "thumper",
      "roadblock",
      "wildcharge",
    ]);
  });

  it("puts the basic attack first on an explicit playground loadout too", () => {
    const state = newFireState("bastion", 1, ["lance", "predator"]);
    expect(state.slots.map((s) => s.weaponId)).toEqual([
      basicAttackOf("bastion"),
      "lance",
      "predator",
    ]);
  });

  it("fires on bit 0 (VS6)", () => {
    const fired = beginFire("p1", newFireState("bastion", 1), 1 << 0, 0);
    expect(fired.pending?.weaponId).toBe("basic-attack-bastion");
    expect(fired.pending?.slot).toBe(0);
  });

  it("loses a same-tick tie to an ability, because the scan is now descending (VS12)", () => {
    // BA21 says the basic attack loses a tie to an ability, and it did so by being the HIGHEST
    // index under an ascending scan. Moving it to index 0 inverted that for one commit; this task
    // reverses `beginFire`'s scan to highest-wins (VS12), which restores BA21 through the index
    // that moved — the basic attack is scanned last again and loses.
    const fired = beginFire("p1", newFireState("bastion", 1), (1 << 0) | (1 << 1), 0);
    expect(fired.pending?.weaponId).toBe("thumper");
  });

  it("rides an explicit playground loadout too, and is not overridable by it (BA14)", () => {
    const state = newFireState("mirage", 1, ["predator", "lance", "thumper"]);
    expect(state.slots.map((s) => s.weaponId)).toEqual([
      "basic-attack-mirage",
      "predator",
      "lance",
      "thumper",
    ]);
  });

  it("leaves no switch lock behind, so pressing it never locks an ability out (BA20)", () => {
    // The basic attack carries a turret mount (Task 1) too, so the press must align before
    // `releaseShots` will actually let it go — otherwise `pending.aligned === false` early-returns
    // the unmodified state and `switchLockUntilTick === 0` would pass for the wrong reason (the
    // release never ran at all). Confirm the release actually happened before trusting the lock.
    let pressed = beginFire("p1", newFireState("bastion", 1), 1 << 0, 0);
    pressed = turnTurret(pressed, 0, 0);
    const { state, orders } = releaseShots(pressed, 0);
    expect(orders).toHaveLength(1);
    expect(state.pending).toBeNull();
    expect(state.switchLockUntilTick).toBe(0);
  });

  it("is blocked by an ability's own recovery, because the lock is not per slot (BA22)", () => {
    // `afterburner` authors `recoveryMs: 200` == 6 ticks at 30 Hz. This is the shared machinery
    // doing its job, not a bug: a future reader tempted to carve the basic attack out of the switch
    // lock should change the spec first, because that carve-out is a second press pipeline (BA22).
    // `afterburner` is Mirage's ability 3, which is FIRE SLOT 3 now (slot 0 is the basic attack).
    const pressed = beginFire("p1", newFireState("mirage", 1), 1 << 3, 0);
    const { state } = releaseShots(pressed, 0);
    expect(state.switchLockUntilTick).toBeGreaterThan(0);
    expect(beginFire("p1", state, 1 << 0, 1).pending).toBeNull();
    // ...and it is free again the moment that recovery lapses.
    expect(beginFire("p1", state, 1 << 0, state.switchLockUntilTick).pending?.weaponId).toBe(
      "basic-attack-mirage",
    );
  });
});

describe("the basic-attack toggle (BASIC_ATTACK_CONFIG.enabled)", () => {
  // Captured, never hard-coded to `true`: this flag is edited per build, and a restore that typed
  // one position would leak the wrong value into every later test the day the other one ships.
  const shipped = BASIC_ATTACK_CONFIG.enabled;
  afterEach(() => {
    BASIC_ATTACK_CONFIG.enabled = shipped;
  });

  it("drops a basic-attack-only press when disabled — the key does nothing", () => {
    BASIC_ATTACK_CONFIG.enabled = false;
    const fired = beginFire("p1", newFireState("bastion", 1), 1 << 0, 0);
    expect(fired.pending).toBeNull();
  });

  it("still lets an ability fire on the same tick, since a skipped slot is not a stopped scan", () => {
    BASIC_ATTACK_CONFIG.enabled = false;
    const fired = beginFire("p1", newFireState("bastion", 1), (1 << 0) | (1 << 1), 0);
    expect(fired.pending?.weaponId).toBe("thumper");
  });

  it("fires again once the flag is re-enabled", () => {
    BASIC_ATTACK_CONFIG.enabled = false;
    expect(beginFire("p1", newFireState("bastion", 1), 1 << 0, 0).pending).toBeNull();
    BASIC_ATTACK_CONFIG.enabled = true;
    expect(beginFire("p1", newFireState("bastion", 1), 1 << 0, 0).pending?.weaponId).toBe(
      "basic-attack-bastion",
    );
  });
});

describe("same-tick tie-breaking", () => {
  pinBasicAttackEnabled();

  it("lets the basic attack lose a tie to an ability, from index 0", () => {
    // VS12. The rule is unchanged from the build where the basic attack sat LAST and lost by being
    // the highest index; at index 0 it loses by being the lowest, which is why the scan reversed.
    const state = newFireState("bastion", 1);
    const mask = 0b0011; // basic attack (slot 0) + ability 1 (slot 1)
    const after = beginFire("s1", state, mask, 0);
    expect(after.pending?.slot).toBe(1);
    expect(after.pending?.weaponId).toBe("thumper");
  });

  it("fires the basic attack when it is the only bit set", () => {
    const state = newFireState("bastion", 1);
    const after = beginFire("s1", state, 0b0001, 0);
    expect(after.pending?.slot).toBe(0);
    expect(after.pending?.weaponId).toBe(basicAttackOf("bastion"));
  });

  it("gives the HIGHEST ability the tie, not the lowest", () => {
    // VS13. Accepted consequence of VS12, asserted rather than discovered: a player mashing every
    // key burns their largest cooldown instead of their smallest. Recorded here so a future reader
    // finds a decision, not a bug.
    const state = newFireState("bastion", 1);
    const after = beginFire("s1", state, 0b1111, 0);
    expect(after.pending?.weaponId).toBe("wildcharge");
  });

  it("gives the HIGHEST ability the tie among abilities alone, with no basic-attack bit set", () => {
    // VS13, isolated from VS12: the mask below carries no bit 0, so this pins the among-abilities
    // ordering on its own rather than inferring it from a mask that also exercises the basic
    // attack's tie against the kit.
    const state = newFireState("bastion", 1);
    const mask = 0b0110; // ability 1 (slot 1, thumper) + ability 2 (slot 2, roadblock)
    const after = beginFire("s1", state, mask, 0);
    expect(after.pending?.slot).toBe(2);
    expect(after.pending?.weaponId).toBe("roadblock");
  });
});
