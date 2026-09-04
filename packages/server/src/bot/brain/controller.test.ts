import { describe, expect, it } from "vitest";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotView } from "../types.js";
import { HumanController } from "./controller.js";

function view(overrides: Partial<BotView> = {}): BotView {
  return {
    tick: 0,
    self: {
      sessionId: "me", carId: "bullseye", team: 0,
      x: 100, y: 100, angle: 0, speed: 0, hp: 65, maxHp: 65, alive: true,
      statuses: [], slots: [], switchLockUntilTick: 0, lockTargetSessionId: "",
      maneuver: 0, maneuverTicksLeft: 0,
    },
    others: [],
    instances: [],
    arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [],
    rng: makeRng(1),
    ...overrides,
  };
}

describe("HumanController", () => {
  it("hunts toward the arena centre rather than coasting when there is no target (Task 6)", () => {
    // Pre-Task-6 this bot coasted with no target — a placeholder, per the removed `chase()`
    // docstring. Task 6 gives the no-target case a real stance (`hunt`, H9), which is the default
    // stance from `newStanceState()` and drives the bot toward the arena centre to go looking
    // rather than sitting still, while never firing (no target to aim `chooseSlot` at).
    const bot = new HumanController("hard");
    const out = bot.decide(view());
    expect(out.throttle).toBe(1);
    expect(out.steer).not.toBe(0);
    expect(out.fireSlots).toBe(0);
  });

  it("is deterministic for the same seed (H21)", () => {
    const run = () => {
      const bot = new HumanController("medium");
      const out = [];
      for (let tick = 0; tick < 90; tick++) {
        out.push(bot.decide(view({ tick, rng: makeRng(99) })));
      }
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });

  it("steers toward a target that is off to one side", () => {
    const bot = new HumanController("hard");
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 100, y: 600, angle: 0, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    let last = { steer: 0, throttle: 0, fireSlots: 0 };
    for (let tick = 0; tick < 30; tick++) {
      last = bot.decide(view({ tick, others: [target] }));
    }
    expect(last.steer).not.toBe(0);
  });

  it("reports debug state once it has decided", () => {
    const bot = new HumanController("hard");
    bot.decide(view());
    expect(bot.debug()?.stance).toBeDefined();
  });

  it("clears firedSlot and preferredRange once the target is lost (review fix)", () => {
    // A car with a real kit, close enough and aligned enough to actually fire, so `firedSlot` has
    // something non-`undefined` to go stale FROM. `memoryTicks: 0` makes perception forget a car
    // the instant it stops appearing in `others`, so losing the target is one tick away rather than
    // however many ticks `hard`'s real memory would hold onto it.
    const slots = slotsOf("bullseye").map((weaponId) => ({
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
      range: weaponDefOf(weaponId).range,
    }));
    const profile = { ...BOT_PROFILES.hard, memoryTicks: 0 };
    const bot = new HumanController("hard", { profile });
    const selfView = {
      sessionId: "me", carId: "bullseye" as const, team: 0 as const,
      x: 100, y: 100, angle: 0, speed: 0, hp: 65, maxHp: 65, alive: true,
      statuses: [], slots, switchLockUntilTick: 0, lockTargetSessionId: "",
      maneuver: 0, maneuverTicksLeft: 0,
    };
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 400, y: 100, angle: 0, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };

    let tick = 0;
    let fired = false;
    while (!fired && tick < 60) {
      bot.decide(view({ tick, self: selfView, others: [target], rng: makeRng(7) }));
      if (bot.debug()?.firedSlot !== undefined) fired = true;
      tick++;
    }
    expect(fired).toBe(true);
    expect(bot.debug()!.preferredRange).toBeGreaterThan(0);

    // Now the target is gone. `targetSessionId` clears the very next tick (perception forgets after
    // one sightless tick, courtesy of `memoryTicks: 0` above), but `held`/`firedSlot`/
    // `preferredRange` only update on a RECOMPUTE tick (`hard`'s cadence is every 2 ticks) — so keep
    // ticking well past one full cadence before asserting, rather than stopping the instant
    // `targetSessionId` clears, which could land on a non-recompute tick and read stale state for a
    // reason that has nothing to do with the bug this test covers.
    for (let i = 0; i < 10; i++) {
      bot.decide(view({ tick, self: selfView, others: [], rng: makeRng(7) }));
      tick++;
    }
    const debug = bot.debug();
    expect(debug?.targetSessionId).toBeUndefined();
    // Before the fix: `decide()` set `this.held = COAST` directly on the no-target recompute path,
    // bypassing `chase()` entirely, so neither `lastFiredSlot` nor `lastPreferredRange` was ever
    // reset and both kept reporting the values from the last tick the bot actually had a target.
    expect(debug?.firedSlot).toBeUndefined();
    expect(debug?.preferredRange).toBe(0);
  });

  it("still fires while dodging, because chooseSlot reads the delta to the TARGET, not the blended steering delta (ordering trap)", () => {
    // The regression this guards: `chase()` computes two different deltas — `aimDelta` (to the
    // target's aim point, for `chooseSlot`) and `delta` (to the BLENDED steering heading, for
    // `reduceToIntent`). Swap which one goes where and this compiles, typechecks, and every OTHER
    // test in this file and in movement.test.ts still passes — but the bot stops shooting the
    // instant anything (a dodge, an orbit) pulls its steering off the target, which is exactly the
    // behaviour the movement layer exists to prevent. Nothing but a controller-level test with a
    // real divergence between "where the gun points" and "where the wheels want to go" can catch
    // that, because the unit tests below pin `chooseSlot`/`reduceToIntent` in isolation and never
    // see them wired together.
    const slots = slotsOf("bullseye").map((weaponId) => ({
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
      range: weaponDefOf(weaponId).range,
    }));
    const bot = new HumanController("hard");
    const selfView = {
      sessionId: "me", carId: "bullseye" as const, team: 0 as const,
      x: 100, y: 100, angle: 0, speed: 0, hp: 65, maxHp: 65, alive: true,
      statuses: [], slots, switchLockUntilTick: 0, lockTargetSessionId: "",
      maneuver: 0, maneuverTicksLeft: 0,
    };
    // Straight ahead of the car (bearing/aim delta ~0), so `aimDelta` stays comfortably inside
    // `hard`'s `fireConeRad` (0.2) for the whole run.
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 400, y: 100, angle: 0, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    // A shot bearing down the +y axis, passing 10 units to the right of the car — well inside
    // `THREAT_LATERAL_UNITS` (~45), so `perceive()` registers it as a threat, and its
    // `awayHeadingRad` comes out pointing almost directly opposite the target (back along -x) — the
    // sharpest possible divergence from `aimHeading`, so `delta` (the BLENDED heading `reduceToIntent`
    // reads) swings hard away from 0 while `aimDelta` (what `chooseSlot` reads) does not move at all.
    const incoming = {
      id: "shot-1", ownerSessionId: "them", weaponId: "predator" as const,
      x: 110, y: -500, angle: Math.PI / 2,
    };

    let firedWhileDodging = false;
    let steerWhileDodging: -1 | 0 | 1 | undefined;
    // `hard`'s `dodgeReactionTicks` is 4 and `acquireTicks` is 5, so the threat is reactable and the
    // target is noticed by tick 5; `recomputeTicks` is 2, so plenty of runway below covers a
    // recompute tick past both.
    for (let tick = 0; tick < 20; tick++) {
      const out = bot.decide(view({
        tick, self: selfView, others: [target], instances: [incoming], rng: makeRng(3),
      }));
      if (out.fireSlots !== 0) {
        firedWhileDodging = true;
        steerWhileDodging = out.steer;
        break;
      }
    }

    expect(firedWhileDodging).toBe(true);
    // The dodge desire outweighs the aim desire (`DODGE_WEIGHT` 2.5 vs the aim desire's weight 1),
    // so the blended heading is pulled well off the target — steering visibly responds to the
    // threat rather than sitting at 0 the way it would if the car were simply pointed at its target.
    expect(steerWhileDodging).not.toBe(0);
  });

  it("draws the same number of random numbers on a recover tick as on a comparable alive tick, and reports no firedSlot (review fix round 2, defect 1)", () => {
    // Before the fix, `plan()` early-returned COAST the instant the stance was "recover" — BEFORE
    // the `chooseSlot` call, which draws two random numbers unconditionally (its own comment says
    // so, precisely so the stream stays aligned, H21). Skipping the call on a recover tick dropped
    // those two draws, desyncing a seeded replay from that point on. This is not a corner case:
    // `scoreStances` treats `phased` as lost control, and every FFA_DEATHMATCH respawn (which is
    // what practice mode is pinned to) grants `phased` for `phaseSeconds` — so this fired on every
    // respawn of every practice match. Counting actual rng invocations (not inspecting the code) is
    // what catches a draw silently dropped anywhere in the call chain, not just in `plan()` itself.
    const slots = slotsOf("bullseye").map((weaponId) => ({
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
      range: weaponDefOf(weaponId).range,
    }));
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 400, y: 100, angle: 0, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    const aliveSelf = {
      sessionId: "me", carId: "bullseye" as const, team: 0 as const,
      x: 100, y: 100, angle: 0, speed: 0, hp: 65, maxHp: 65, alive: true,
      statuses: [], slots, switchLockUntilTick: 0, lockTargetSessionId: "",
      maneuver: 0, maneuverTicksLeft: 0,
    };
    // Same car, same tick, same target and slots — the ONLY difference is a live `phased` status,
    // which is exactly the condition `scoreStances`'s `controlLost` (and now `preemption`'s) checks.
    const phasedSelf = {
      ...aliveSelf,
      statuses: [{ statusId: "phased" as const, startTick: 0, endsTick: 999, sourceSessionId: "" }],
    };

    function countingRng(seed: number): { rng: () => number; callCount: () => number } {
      const inner = makeRng(seed);
      let calls = 0;
      return { rng: () => { calls++; return inner(); }, callCount: () => calls };
    }

    const aliveCounter = countingRng(3);
    const aliveBot = new HumanController("hard");
    aliveBot.decide(view({ tick: 0, self: aliveSelf, others: [target], rng: aliveCounter.rng }));

    const phasedCounter = countingRng(3);
    const phasedBot = new HumanController("hard");
    const phasedOut = phasedBot.decide(view({
      tick: 0, self: phasedSelf, others: [target], rng: phasedCounter.rng,
    }));

    expect(phasedBot.debug()?.stance).toBe("recover");
    expect(phasedCounter.callCount()).toBe(aliveCounter.callCount());
    expect(phasedOut).toEqual({ steer: 0, throttle: 0, fireSlots: 0 });
    expect(phasedBot.debug()?.firedSlot).toBeUndefined();
  });
});
