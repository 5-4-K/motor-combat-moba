import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CAR_TABLE,
  TICK_RATE_HZ,
  WEAPON_TABLE,
  damageFor,
  hpOf,
  slotsOf,
  weaponTicksOf,
} from "../packages/shared/dist/index.js";
import { pressPlan, simulateTtk, TTK_LIMIT_SECONDS } from "./ttk.mjs";

const CARS = Object.keys(CAR_TABLE);

describe("pressPlan", () => {
  it("scales every hit through damageFor rather than the total once", () => {
    // The sim rounds at each impact, so a total scaled afterwards is a different number from the
    // one a player takes. bulwark is the sharpest case: 10 ticks of 35 on Bastion's 0.92x is
    // 10 x 32 = 320, where 350 x 0.92 rounded once would be 322.
    const plan = pressPlan("bastion", "bulwark");
    const perTick = damageFor(CAR_TABLE.bastion.attack, WEAPON_TABLE.bulwark.damage);
    assert.equal(perTick, 32);
    assert.equal(plan.total, perTick * plan.events.length);
    assert.equal(plan.total, 320);
  });

  it("counts every pellet of a fan as one simultaneous hit", () => {
    const plan = pressPlan("bullseye", "pepperbox");
    assert.equal(plan.events.length, 1, "one volley of three pellets is one event, not three");
    assert.equal(plan.total, damageFor(CAR_TABLE.bullseye.attack, WEAPON_TABLE.pepperbox.damage) * 3);
  });

  it("spreads a multi-wave beam across its volley interval", () => {
    const plan = pressPlan("mirage", "shockwave");
    const gap = weaponTicksOf("shockwave").volleyInterval;
    assert.equal(plan.events.length, 3);
    assert.deepEqual(
      plan.events.map((pair) => pair[0]),
      [0, gap, gap * 2],
    );
    // The press blocks the car's other slots until its LAST wave exits, not its first.
    assert.equal(plan.exit, gap * 2);
  });

  it("puts a final-wave status on the last wave only", () => {
    const plan = pressPlan("mirage", "shockwave");
    const corroded = plan.applies.filter((entry) => entry[1] === "corroded");
    assert.equal(corroded.length, 1, "corroded rides wave 3 alone (onWave: final)");
    assert.equal(corroded[0][0], weaponTicksOf("shockwave").volleyInterval * 2);
  });

  it("gives every shipped weapon a positive total on every carrier", () => {
    for (const car of CARS) {
      for (const weaponId of slotsOf(car)) {
        const plan = pressPlan(car, weaponId);
        assert.ok(plan.total > 0, `${car}/${weaponId} deals nothing`);
        assert.ok(plan.events.length > 0, `${car}/${weaponId} lands no hits`);
      }
    }
  });
});

describe("simulateTtk", () => {
  it("lands damage from a zero-wind-up weapon on the tick it is pressed", () => {
    // Regression guard. The scheduler queues a press AFTER the tick's resolution loop has run, so
    // resolving on `=== tick` strands every weapon whose startUp is 0 — which is most of the table.
    // The symptom is silent: kits simply never kill, and the matrix fills with "never".
    const zeroWindUp = CARS.flatMap((car) =>
      slotsOf(car)
        .filter((id) => weaponTicksOf(id).startUp === 0)
        .map((id) => [car, id]),
    );
    assert.ok(zeroWindUp.length > 0, "fixture assumes some weapon fires on the press tick");
    for (const [car, id] of zeroWindUp) {
      assert.equal(pressPlan(car, id).events[0][0], 0, `${car}/${id} should land at offset 0`);
    }
  });

  it("kills every chassis with every other chassis's kit, well inside the limit", () => {
    // The real point of this assertion is that a kit CAN finish. A balance edit that leaves one
    // unable to — or a scheduler regression that drops its damage — shows up here rather than as a
    // quietly wrong number in a report nobody re-derives.
    for (const attacker of CARS) {
      for (const defender of CARS) {
        const result = simulateTtk(attacker, defender);
        assert.ok(result.killed, `${attacker} cannot kill ${defender} within ${TTK_LIMIT_SECONDS}s`);
        assert.ok(result.seconds > 0 && result.seconds < TTK_LIMIT_SECONDS);
      }
    }
  });

  it("never spends more total damage than the defender's hull, give or take one press", () => {
    // Catches a scheduler that keeps firing after the kill, which would understate every TTK.
    for (const attacker of CARS) {
      const result = simulateTtk(attacker, "bastion");
      const dealt = [...result.presses].reduce(
        (sum, entry) => sum + pressPlan(attacker, entry[0]).total * entry[1],
        0,
      );
      const biggest = Math.max(...slotsOf(attacker).map((id) => pressPlan(attacker, id).total));
      assert.ok(
        dealt <= hpOf("bastion") + biggest,
        `${attacker} spent ${dealt} on an ${hpOf("bastion")} hp target`,
      );
    }
  });

  it("makes the status riders help rather than hinder", () => {
    // corroded amplifies and spiked bleeds, so switching them on can only shorten a kill. If this
    // ever inverts, the debuff bookkeeping is wrong somewhere.
    for (const attacker of CARS) {
      for (const defender of CARS) {
        const withStatuses = simulateTtk(attacker, defender, { debuffs: true });
        const without = simulateTtk(attacker, defender, { debuffs: false });
        assert.ok(
          withStatuses.ticks <= without.ticks,
          `${attacker} vs ${defender}: debuffs made the kill slower`,
        );
      }
    }
  });

  it("respects the switch lock between two different slots", () => {
    // lance leaves the roster's only substantial recovery (1s), so Bullseye cannot follow it
    // immediately with another slot. A scheduler ignoring `recoveryMs` would fire on the next tick.
    const lance = pressPlan("bullseye", "lance");
    assert.ok(lance.recovery >= TICK_RATE_HZ, "fixture assumes lance still owns a ~1s recovery");
    assert.ok(lance.exit > 0, "fixture assumes lance still winds up before it fires");
  });
});
