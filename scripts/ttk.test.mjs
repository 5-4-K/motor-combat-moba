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
    // one a player takes. afterburner (the roster's held ticking beam, since the 2026-09-01 roster
    // cutover retired bulwark) is the sharpest remaining case: 5 pulses of 49 on Mirage's 1.13x is
    // 5 x 55 = 275, where 245 x 1.13 rounded once would be 277.
    const plan = pressPlan("mirage", "afterburner");
    const perTick = damageFor(CAR_TABLE.mirage.attack, WEAPON_TABLE.afterburner.damage);
    assert.equal(perTick, 55);
    assert.equal(plan.total, perTick * plan.events.length);
    assert.equal(plan.total, 275);
  });

  it("counts every pellet of a fan as one simultaneous hit", () => {
    const plan = pressPlan("bullseye", "pepperbox");
    assert.equal(plan.events.length, 1, "one volley of three pellets is one event, not three");
    assert.equal(plan.total, damageFor(CAR_TABLE.bullseye.attack, WEAPON_TABLE.pepperbox.damage) * 3);
  });

  // The 2026-09-01 roster cutover retired the last multi-wave row: shockwave was redefined from a
  // three-wave aura (Mirage's old slot 2) into a single-volley projectile (Bullseye's slot 1), and
  // no other WEAPON_TABLE row was ever authored with `volley.volleys > 1`. `pressPlan`'s multi-wave
  // loop and its `onWave: "final"` gate are still live code — nothing here proves they are correct
  // against real data, only that they exist for whichever future weapon lands with `volleys > 1`.
  // Skipped rather than deleted or faked against data that no longer describes any shipped weapon;
  // un-skip and point at that weapon's id once one exists.
  it.skip("spreads a multi-wave beam across its volley interval", () => {
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

  it.skip("puts a final-wave status on the last wave only", () => {
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

  it("keeps wildcharge out of the sustained rotation but leaves thunderclap in it", () => {
    // wildcharge is a 20s one-hit ultimate whose 250 damage is conditional on a hull contact inside
    // its 10s window; folding it into the greedy loop would read as free damage every cycle. It
    // still has to show up in pressPlan (asserted elsewhere), just never as a press here.
    for (const defender of CARS) {
      const result = simulateTtk("bastion", defender);
      assert.ok(
        !result.presses.has("wildcharge"),
        `wildcharge should never be pressed in a sustained rotation (vs ${defender})`,
      );
    }
    // thunderclap is an ordinary maneuver row by contrast — damage on a cooldown, same as any
    // projectile or beam — so it stays eligible and should actually get pressed.
    const mirageVsBastion = simulateTtk("mirage", "bastion");
    assert.ok(
      mirageVsBastion.presses.has("thunderclap"),
      "thunderclap should be pressed like any other row in a long enough fight",
    );
  });

  it("respects the switch lock between two different slots", () => {
    // lance leaves the roster's only substantial recovery (1s), so Bullseye cannot follow it
    // immediately with another slot. A scheduler ignoring `recoveryMs` would fire on the next tick.
    const lance = pressPlan("bullseye", "lance");
    assert.ok(lance.recovery >= TICK_RATE_HZ, "fixture assumes lance still owns a ~1s recovery");
    assert.ok(lance.exit > 0, "fixture assumes lance still winds up before it fires");
  });
});
