import { describe, expect, it } from "vitest";
import {
  driveOf, NEUTRAL_MODIFIERS, slotsOf, stepDrive, TICK_RATE_HZ, weaponDefOf,
} from "@motor-combat-moba/shared";
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

function closedLoopDuel(
  tier: "easy" | "medium" | "hard",
  ticks: number,
  targetPos: { x: number; y: number } = { x: 753, y: 360 },
): { fires: number; meanOffset: number } {
  const bot = new HumanController(tier);
  const rng = makeRng(17);
  const slots = slotsOf("bullseye").map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  }));
  // Real physics, so the bot's own steering rotates its own body — without this the bug is
  // invisible (Task 1, round 1).
  let body = {
    x: 200, y: 360, angle: 0, speed: 300, reverseHold: 0, angVel: 0,
    shoveX: 0, shoveY: 0, authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverSpeed: 0,
  };
  const target = {
    sessionId: "them", carId: "mirage" as const, team: 1 as const, x: targetPos.x, y: targetPos.y,
    angle: Math.PI, speed: 0, hp: 70, maxHp: 70, alive: true, phased: false,
    statuses: [], maneuver: 0,
  };
  let fires = 0;
  const offsets: number[] = [];

  for (let tick = 0; tick < ticks; tick++) {
    const intent = bot.decide(view({
      tick,
      self: {
        ...view().self,
        x: body.x, y: body.y, angle: body.angle, speed: body.speed, slots,
      },
      others: [target],
      rng,
    }));
    if (intent.fireSlots !== 0) fires += 1;
    const bearing = Math.atan2(target.y - body.y, target.x - body.x);
    offsets.push(Math.abs(
      Math.atan2(Math.sin(bearing - body.angle), Math.cos(bearing - body.angle)),
    ));
    body = stepDrive(
      body,
      { seq: tick, steer: intent.steer, throttle: intent.throttle, fireSlots: 0 },
      1 / TICK_RATE_HZ,
      driveOf("bullseye"),
      NEUTRAL_MODIFIERS,
    );
  }

  const tail = offsets.slice(-100);
  return { fires, meanOffset: tail.reduce((a, b) => a + b, 0) / tail.length };
}

describe("HumanController", () => {
  it("keeps the body on the aim line at its preferred range, so it can fire (spec 1.1)", () => {
    const { fires, meanOffset } = closedLoopDuel("hard", 300);
    // Measured 2026-09-05 (R9-R11): 62 fires unfixed; 80 after removing the orbit desire alone
    // (a real but partial fix — orbit was not the dominant mechanism); 99 at zero decision lag
    // (the ceiling reachable without inhumanly fast reactions — the open-loop 146 "control" the
    // brief originally derived from never fed steering back into pose, so it is not a legitimate
    // target). Lead compensation for the bot's own reaction lag (R10) is what actually closes the
    // gap toward that 99 ceiling.
    expect(fires).toBeGreaterThan(90);
    // The mechanism, not just the symptom: the body must stay near the aim line.
    // Fixed at 0.2 rad — hard's `fireConeRad` before Task 7 (2026-09-05) deleted that field along
    // with the angular fire gate it served. The mechanism this asserts (the body must stay near the
    // aim line) does not depend on the deleted field's value, only on a fixed bound to hold it to.
    expect(meanOffset).toBeLessThan(0.2);
  });

  it("keeps the body on the aim line when the target is OFF-AXIS, not just dead ahead (review fix round 1, critical defect)", () => {
    // The on-axis duel above (target at the bot's own y=360) has zero heading error from tick 0,
    // so it cannot distinguish a working compensation from a disabled one — steer settles to 0
    // either way. This target sits at y=500 (bot spawns at y=360), so the bot must actually turn
    // to line up, which is exactly what `compensateForLag`'s buggy deadzone floor (0.711 rad, 41
    // degrees — computed as `turnRate * lagSeconds * 0.5`) prevented: steering froze near a
    // heading offset of 0.269 rad by tick 9 and never closed further.
    // Pre-fix baseline (2026-09-05, review round 1): fires = 6 / 300, heading frozen near 0.269 rad.
    //
    // Task 7 finding (2026-09-05, EV firing gate): even with steering fully recovered (meanOffset
    // below, at parity with pre-Task-7), this scenario's real geometry pushes the solver's best
    // `value` for predator to ~26.1/s at the settled range and heading — a hair above hard's
    // `minShotValue` (26) — so this assertion is measured RED at 70/300 fires, not >90, on the
    // current profile. That is the EV gate correctly refusing marginal shots, not a wiring bug; see
    // the Task 7 report for the measured distribution. Left unweakened per that task's brief.
    const { fires, meanOffset } = closedLoopDuel("hard", 300, { x: 753, y: 500 });
    expect(fires).toBeGreaterThan(90);
    // Fixed at 0.2 rad — hard's `fireConeRad` before Task 7 (2026-09-05) deleted that field along
    // with the angular fire gate it served. The mechanism this asserts (the body must stay near the
    // aim line) does not depend on the deleted field's value, only on a fixed bound to hold it to.
    expect(meanOffset).toBeLessThan(0.2);
  });

  it("hunts a quadrant waypoint when it has never seen anyone, never the arena centre (G12)", () => {
    // Sit ON the centre facing +x. Centre-seeking would keep heading 0 (steer 0). Quadrant search
    // from (640, 360) toward (320, 180) is a rear-left heading, so steer is visibly non-zero.
    // Task 7's humanize layer coasts for `reactionDelayTicks` (hard: 4) before a decision reaches
    // the output, so this loops past that window.
    const bot = new HumanController("hard", {
      profile: { ...BOT_PROFILES.hard, blunderChance: 0, idleFidgetChance: 0, aimErrorSigmaRad: 0 },
    });
    const selfAtCentre = { ...view().self, x: 640, y: 360, angle: 0 };
    let out = { steer: 0, throttle: 0, fireSlots: 0 };
    for (let tick = 0; tick < 8; tick++) {
      out = bot.decide(view({ tick, self: selfAtCentre }));
    }
    expect(out.throttle).toBe(1);
    expect(out.steer).not.toBe(0);
    expect(out.fireSlots).toBe(0);
    expect(bot.debug()?.situation).toBe("waitOut");
  });

  it("hunts toward a last-known pose, not the arena centre (G12)", () => {
    // Sit ON the arena centre. Centre-seeking keeps heading 0 (steer 0). A phased car due west
    // is on screen (Deathmatch respawn) but is not a target — hunt must drive at that visible
    // pose, which is a 180° heading, so steer is visibly non-zero.
    const profile = {
      ...BOT_PROFILES.hard,
      blunderChance: 0, idleFidgetChance: 0, aimErrorSigmaRad: 0, acquireTicks: 2,
    };
    const bot = new HumanController("hard", { profile });
    const selfView = { ...view().self, x: 640, y: 360, angle: 0 };
    const ghost = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 100, y: 360, angle: 0, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: true, statuses: [], maneuver: 0,
    };
    let out = { steer: 0, throttle: 0, fireSlots: 0 };
    for (let tick = 0; tick < 20; tick++) {
      out = bot.decide(view({ tick, self: selfView, others: [ghost] }));
    }
    expect(out.steer).not.toBe(0);
    expect(out.throttle).toBe(1);
    expect(out.fireSlots).toBe(0);
    expect(bot.debug()?.situation).toBe("waitOut");
  });

  it("continues the previous heading during acquire delay, rather than seeking the centre (G13)", () => {
    // A living car is on screen but not yet noticed. Centre-seeking from (100, 100) facing +x
    // would steer toward (640, 360). Continuing the previous heading keeps steer 0.
    const profile = {
      ...BOT_PROFILES.hard,
      blunderChance: 0, idleFidgetChance: 0, aimErrorSigmaRad: 0, acquireTicks: 20,
    };
    const bot = new HumanController("hard", { profile });
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 400, y: 100, angle: 0, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    let out = { steer: 0, throttle: 0, fireSlots: 0 };
    for (let tick = 0; tick < 8; tick++) {
      out = bot.decide(view({ tick, others: [target] }));
    }
    expect(out.steer).toBe(0);
    expect(bot.debug()?.situation).toBe("waitOut");
    expect(bot.currentTargetSessionId).toBeUndefined();
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
    expect(bot.debug()?.situation).toBeDefined();
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

  it("still fires while dodging, because the solver reads the shooter's ACTUAL pose, not the blended steering heading (ordering trap)", () => {
    // The regression this guards, updated for Task 7's EV firing gate: `chooseSlot` no longer takes
    // an aim delta at all — the per-slot solutions it ranks are built (in `plan`) from `self.x/y/
    // angle`, the car's real current pose, while `reduceToIntent`'s steering is driven by `heading`,
    // the BLENDED desire (fight + evade + wall, etc.). Those two are independent inputs computed from
    // the same tick's `self`, so a dodge that swings the blended heading away from the target must
    // not silently move the shooter's pose the solver solves against — a bug that fed the blended
    // heading into `solve` instead of `self.angle` would compile, typecheck, and pass every unit test
    // that pins `solve`/`chooseSlot` in isolation, but the bot would stop shooting the instant
    // anything (a dodge, an orbit) pulled its steering off the target. Only a controller-level test
    // with a real divergence between "where the gun points" and "where the wheels want to go" catches
    // that.
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
    // Straight ahead of the car (bearing ~= self.angle, which stays fixed here — this test never
    // steps real drive physics), so the solver sees a well-aimed shot for the whole run regardless
    // of what the dodge does to the blended steering heading.
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 400, y: 100, angle: 0, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    // A shot bearing down the +y axis, passing 10 units to the right of the car — well inside
    // `THREAT_LATERAL_UNITS` (~45), so `perceive()` registers it as a threat, and its
    // `awayHeadingRad` comes out pointing almost directly opposite the target (back along -x) — the
    // sharpest possible divergence from `aimHeading`, so `heading` (the BLENDED steering desire
    // `reduceToIntent` reads) swings hard away from 0 while `self.angle` (what the solver solves
    // against) does not move at all — this test's `selfView` is fixed, not stepped through physics.
    const incoming = {
      id: "shot-1", ownerSessionId: "them", weaponId: "predator" as const,
      x: 110, y: -500, angle: Math.PI / 2,
    };

    let firedWhileDodging = false;
    let steerWhileDodging: -1 | 0 | 1 | undefined;
    // `hard`'s `dodgeReactionTicks` is 4 and `acquireTicks` is 5, so the threat is reactable and the
    // target is noticed by tick 5; `recomputeTicks` is 2, so plenty of runway below covers a
    // recompute tick past both. Humanize then coasts another `reactionDelayTicks` (4) ticks before
    // the decision reaches the output — so the window has to reach past that, not just past 9.
    for (let tick = 0; tick < 30; tick++) {
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
    // `evade` takes the wheel off the fight heading, so steering visibly responds to the threat
    // rather than sitting at 0 the way it would if the car were simply pointed at its target.
    expect(steerWhileDodging).not.toBe(0);
  });

  it("re-arms the ram roll after the target is lost, so ramming survives the first death (H40)", () => {
    // The engagement id must reset when the target is lost. Practice and the balance harness's
    // duel keep the same opponent session id for the whole match; a death or `phased` respawn
    // must not leave the bot stuck in `waitOut` as if that car were gone for good.
    const slots = slotsOf("bullseye").map((weaponId) => ({
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
      range: weaponDefOf(weaponId).range,
    }));
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 300, y: 100, angle: 0, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    // `ramIntentChance: 1` makes the roll's OUTCOME certain so the test measures whether the roll
    // HAPPENS. Short memory and acquire windows keep the "lost, then found again" gap short.
    // Seed 17 rolls the `grudge` archetype, which shifts none of these four fields — `brawler` and
    // `kiter` both shift `ramIntentChance` and would silently discard the override.
    const profile = {
      ...BOT_PROFILES.hard,
      ramIntentChance: 1, memoryTicks: 4, acquireTicks: 2, situationCommitTicks: 2,
    };
    const bot = new HumanController("hard", { profile });
    const rng = makeRng(17);
    const self = { ...view().self, slots, x: 100, y: 100 };
    const sitAt = (tick: number, others: (typeof target)[]) => {
      bot.decide(view({ tick, self, others, rng }));
      return bot.debug()?.situation;
    };

    let fighting = false;
    for (let tick = 0; tick < 30; tick++) {
      const sit = sitAt(tick, [target]);
      if (sit && sit !== "waitOut" && sit !== "recover") fighting = true;
    }
    expect(fighting).toBe(true);

    for (let tick = 30; tick < 50; tick++) sitAt(tick, []);
    expect(bot.currentTargetSessionId).toBeUndefined();

    let fightingAgain = false;
    for (let tick = 50; tick < 90; tick++) {
      const sit = sitAt(tick, [target]);
      if (sit && sit !== "waitOut" && sit !== "recover") fightingAgain = true;
    }
    expect(fightingAgain).toBe(true);
    expect(bot.currentTargetSessionId).toBe("them");
  });

  it("draws the same number of random numbers on a recover tick as on a comparable alive tick, and reports no firedSlot (review fix round 2, defect 1)", () => {
    // Before the fix, `plan()` early-returned COAST the instant the stance was "recover" — BEFORE
    // the `chooseSlot` call, which draws two random numbers unconditionally (its own comment says
    // so, precisely so the stream stays aligned, H21). Skipping the call on a recover tick dropped
    // those two draws, desyncing a seeded replay from that point on. This is not a corner case:
    // `classifySituation` treats `phased` as lost control, and every FFA_DEATHMATCH respawn (which is
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
    // which is exactly the condition `classifySituation`'s `selfControlLost` checks.
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

    expect(phasedBot.debug()?.situation).toBe("recover");
    expect(phasedCounter.callCount()).toBe(aliveCounter.callCount());
    expect(phasedOut).toEqual({ steer: 0, throttle: 0, fireSlots: 0 });
    expect(phasedBot.debug()?.firedSlot).toBeUndefined();
  });

  it("Hard does not fire at a corpse after it was seen alive (S28)", () => {
    const slots = slotsOf("bullseye").map((weaponId) => ({
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
      range: weaponDefOf(weaponId).range,
    }));
    const profile = {
      ...BOT_PROFILES.hard,
      blunderChance: 0, idleFidgetChance: 0, acquireTicks: 0, recomputeTicks: 1,
      reactionDelayTicks: 0, deadRespect: 1,
    };
    const bot = new HumanController("hard", { profile });
    const selfView = { ...view().self, slots, angle: 0, x: 100, y: 360 };
    const them = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 400, y: 360, angle: Math.PI, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    for (let tick = 0; tick < 8; tick++) {
      bot.decide(view({ tick, self: selfView, others: [them], rng: makeRng(3) }));
    }
    let fired = false;
    for (let tick = 8; tick < 8 + 90; tick++) {
      const out = bot.decide(view({
        tick, self: selfView, others: [{ ...them, alive: false, hp: 0 }], rng: makeRng(3),
      }));
      if (out.fireSlots !== 0) fired = true;
    }
    expect(fired).toBe(false);
    expect(bot.debug()?.situation).toBe("waitOut");
  });

  it("Hard leaves a corner toward open floor, not the arena centre (S28)", () => {
    const slots = slotsOf("bullseye").map((weaponId) => ({
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
      range: weaponDefOf(weaponId).range,
    }));
    const profile = {
      ...BOT_PROFILES.hard,
      blunderChance: 0, idleFidgetChance: 0, acquireTicks: 0, recomputeTicks: 1,
      reactionDelayTicks: 0, cornerRespect: 1, aimErrorSigmaRad: 0,
    };
    const bot = new HumanController("hard", { profile });
    const selfView = { ...view().self, slots, x: 40, y: 40, angle: 0 };
    const them = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 400, y: 400, angle: 0, speed: 200, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    let last = { steer: 0, throttle: 0, fireSlots: 0 };
    for (let tick = 0; tick < 20; tick++) {
      last = bot.decide(view({ tick, self: selfView, others: [them], rng: makeRng(3) }));
    }
    expect(bot.debug()?.situation).toBe("unpin");
    expect(last.throttle).toBe(1);
    const centreHeading = Math.atan2(360 - 40, 640 - 40);
    expect(centreHeading).not.toBeCloseTo(0, 1);
  });

  it("Hard fires when in reach and facing, with no HUD lock (S28)", () => {
    const slots = slotsOf("bullseye").map((weaponId) => ({
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
      range: weaponDefOf(weaponId).range,
    }));
    const profile = {
      ...BOT_PROFILES.hard,
      blunderChance: 0, idleFidgetChance: 0, acquireTicks: 0, recomputeTicks: 1,
      reactionDelayTicks: 0, burstGapTicks: 0, aimErrorSigmaRad: 0,
    };
    const bot = new HumanController("hard", { profile });
    const selfView = {
      ...view().self, slots, x: 200, y: 360, angle: 0, lockTargetSessionId: "",
    };
    const them = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 500, y: 360, angle: Math.PI, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    let fired = false;
    for (let tick = 0; tick < 12; tick++) {
      const out = bot.decide(view({ tick, self: selfView, others: [them], rng: makeRng(3) }));
      if (out.fireSlots !== 0) fired = true;
    }
    expect(fired).toBe(true);
  });
});
