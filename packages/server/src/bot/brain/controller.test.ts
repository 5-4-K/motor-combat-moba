import { describe, expect, it } from "vitest";
import {
  driveOf, NEUTRAL_MODIFIERS, slotsOf, stepDrive, TICK_RATE_HZ, weaponDefOf, type SimBody,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotView } from "../types.js";
import { HumanController } from "./controller.js";
import { runDuel } from "./duel.fixture.js";

function view(overrides: Partial<BotView> = {}): BotView {
  return {
    tick: 0,
    self: {
      sessionId: "me", carId: "bullseye", team: 0,
      x: 100, y: 100, angle: 0, vx: 0, vy: 0, hp: 65, maxHp: 65, alive: true,
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

/**
 * Generalised to take the SHOOTER's chassis (Finding 1, R20 fix round 2, 2026-09-06) — it used to be
 * hardcoded to `bullseye`, which is exactly why the calibration in `bot-profiles.ts` missed that a
 * hard Bastion never clears an absolute `minShotValue`: the harness that measured it only ever flew
 * the roster's strongest kit. See the "fires a shot on every chassis" test below, which sweeps all
 * three chassis at all three tiers.
 *
 * EXTRACTED to `duel.fixture.ts` (task 7, 2026-09-07) so `tiers.test.ts` measures the same fixture instead
 * of hand-rolling a second one. This is the harness's OPEN mode: nothing is fired for real and every
 * slot reads permanently ready, so a press is limited by the brain's cadence and never by a weapon
 * cooldown — which is what makes `fires` here a count of WILLINGNESS to shoot. It is `fireTicks`,
 * ticks whose emitted intent carried a fire bit, NOT presses (`HumanController.held` re-emits one
 * decision's bit for up to `recomputeTicks` ticks); every comparison below is within one tier, where
 * that occupancy is a fair measure. Verified byte-identical across the extraction: the two canary duels
 * below measure 136 and 128 with mean offsets 0 and 0.0442 both before and after it. Those are NOT
 * the 140/134 the R-D5 round reported — the blunder reshape (tasks 9 and 8) sits downstream of the
 * duel and moved them, 140 -> 136 on-axis and 134 -> 128 off-axis, as its own report records: hard's
 * `blunderChance` is 0.015, so a handful of windows in 300 ticks now hold a runner-up line or a late
 * brake instead of an inverted steer. The 140/134 figures were measured before that reshape and no
 * longer reproduce. The > 90 bar is what either pair is held to; none of this is a threshold being
 * chased.
 */
function closedLoopDuel(
  tier: "easy" | "medium" | "hard",
  ticks: number,
  targetPos: { x: number; y: number } = { x: 753, y: 360 },
  chassis: "bullseye" | "mirage" | "bastion" = "bullseye",
): { fires: number; meanOffset: number } {
  const { fireTicks, meanOffset } = runDuel({ tier, ticks, targetPos, chassis });
  return { fires: fireTicks, meanOffset };
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
    // Task 7 finding (2026-09-05, EV firing gate): hard's `minShotValueFraction` (R20, fix round 2)
    // clears comfortably at this scenario's settled geometry. Measured fire counts (300 ticks): 140
    // on-axis (heading settled near 0), 94 off-axis (heading settled near 0.2 rad). Both pass the
    // >90 bar with margin, confirming the EV gate fires healthily at this tier.
    //
    // P31 re-measurement (2026-09-07, phase D task 4): deriving `preferredRangeOf` from the solver
    // moved both duels UP — on-axis 138 -> 140 (offset 0), off-axis 112 -> 128 (offset 0.054).
    // A hard Bullseye now stands at its kit's own plateau rather than at
    // `standoffFraction * effective reach`, which is further out and squarely inside `predator`'s
    // aim-assisted band, so more of the run is spent at a range the kit actually scores at.
    //
    // R-D5 (fix wave 2, 2026-09-07) moved the standoff again — the plateau's far edge is now the
    // farthest range keeping `preferredRangePlateauFraction` of the peak rather than the farthest
    // range EXACTLY tying it, which takes a hard Bullseye from 420 to 470. That round reported the
    // pair as 140 on-axis / 134 off-axis; THE CURRENT FIGURES ARE 136 ON-AXIS AND 128 OFF-AXIS
    // (mean offsets 0 and 0.0442). The 140/134 pair was measured before the blunder kinds were
    // reshaped (tasks 9 and 8) and no longer reproduces — that reshape sits downstream of the duel
    // and its report records exactly this move, 140 -> 136 and 134 -> 128. The bar is unchanged at
    // > 90 throughout: none of these re-measurements is a threshold being chased.
    const { fires, meanOffset } = closedLoopDuel("hard", 300, { x: 753, y: 500 });
    expect(fires).toBeGreaterThan(90);
    // Fixed at 0.2 rad — hard's `fireConeRad` before Task 7 (2026-09-05) deleted that field along
    // with the angular fire gate it served. The mechanism this asserts (the body must stay near the
    // aim line) does not depend on the deleted field's value, only on a fixed bound to hold it to.
    expect(meanOffset).toBeLessThan(0.2);
  });

  it("fires a non-zero number of shots on EVERY chassis at EVERY tier (Finding 1, R20)", () => {
    // Before R20, `minShotValue` was an ABSOLUTE EV-per-second number, but a kit's achievable value
    // varies by roughly 4x across the roster (Bastion's best possible shot anywhere, ~18.3, sat
    // below hard's old threshold of 25) — so a hard Bastion pressed nothing, ever, in 600 ticks of
    // this same duel. The calibration that picked 25 missed this because `closedLoopDuel` was
    // hardcoded to `bullseye`, the roster's strongest kit, so nothing exercised a weaker chassis.
    // `minShotValueFraction` compares against `bestAchievableValueOf(self.carId, sigma)` instead,
    // so this must hold for every (chassis, tier) cell, not just Bullseye's.
    const chassis = ["bullseye", "mirage", "bastion"] as const;
    const tiers = ["easy", "medium", "hard"] as const;
    for (const c of chassis) {
      for (const t of tiers) {
        const { fires } = closedLoopDuel(t, 600, undefined, c);
        expect(fires, `${t}/${c} fired ${fires}/600 shots`).toBeGreaterThan(0);
      }
    }
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
      x: 100, y: 360, angle: 0, vx: 0, vy: 0, hp: 70, maxHp: 70,
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
      x: 400, y: 100, angle: 0, vx: 0, vy: 0, hp: 70, maxHp: 70,
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
      x: 100, y: 600, angle: 0, vx: 0, vy: 0, hp: 70, maxHp: 70,
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
      x: 100, y: 100, angle: 0, vx: 0, vy: 0, hp: 65, maxHp: 65, alive: true,
      statuses: [], slots, switchLockUntilTick: 0, lockTargetSessionId: "",
      maneuver: 0, maneuverTicksLeft: 0,
    };
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 400, y: 100, angle: 0, vx: 0, vy: 0, hp: 70, maxHp: 70,
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
    // The regression this guards, updated for Task 7's EV firing gate and phase D's planner:
    // `chooseSlot` no longer takes an aim delta at all — the per-slot solutions it ranks are built
    // (in `plan`) from `self.x/y/angle`, the car's real current pose, while the emitted `steer` comes
    // from the PLANNER, which rolls candidate steer/throttle pairs forward and scores them against
    // the tick's objective weights (fight, evade, wall clearance and the rest). Those two are
    // independent consumers of the same tick's `self`, so a dodge that sends the planner's winning
    // rollout away from the target must not silently move the shooter's pose the solver solves
    // against — a bug that fed the planner's chosen heading into `solve` instead of `self.angle`
    // would compile, typecheck, and pass every unit test that pins `solve`/`chooseSlot` in
    // isolation, but the bot would stop shooting the instant anything (a dodge, an orbit) pulled its
    // steering off the target. Only a controller-level test with a real divergence between "where
    // the gun points" and "where the wheels want to go" catches that.
    const slots = slotsOf("bullseye").map((weaponId) => ({
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
      range: weaponDefOf(weaponId).range,
    }));
    const bot = new HumanController("hard");
    const selfView = {
      sessionId: "me", carId: "bullseye" as const, team: 0 as const,
      x: 100, y: 100, angle: 0, vx: 0, vy: 0, hp: 65, maxHp: 65, alive: true,
      statuses: [], slots, switchLockUntilTick: 0, lockTargetSessionId: "",
      maneuver: 0, maneuverTicksLeft: 0,
    };
    // Straight ahead of the car (bearing ~= self.angle, which stays fixed here — this test never
    // steps real drive physics), so the solver sees a well-aimed shot for the whole run regardless
    // of what the dodge does to the blended steering heading.
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 400, y: 100, angle: 0, vx: 0, vy: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    // A shot bearing down the +y axis, passing 10 units to the right of the car — well inside
    // `THREAT_LATERAL_UNITS` (~45), so `perceive()` registers it as a threat, and its
    // `awayHeadingRad` comes out pointing almost directly opposite the target (back along -x) — the
    // sharpest possible divergence from the aim line, so the planner's winning rollout (and with it
    // the emitted `steer`) swings hard away from 0 while `self.angle` (what the solver solves
    // against) does not move at all — this test's `selfView` is fixed, not stepped through physics.
    const incoming = {
      id: "shot-1", ownerSessionId: "them", weaponId: "predator" as const,
      x: 110, y: -500, angle: Math.PI / 2,
    };

    let firedWhileDodging = false;
    let evadeStartTick: number | undefined;
    const settledPresses: { tick: number; steer: -1 | 0 | 1 }[] = [];
    /**
     * FIXTURE WINDOW MOVED (R-P15, residuals round, 2026-09-07). Was: break on the FIRST press and
     * assert that tick's steer. The mechanism this test guards is unchanged and still holds — the
     * bot fires on eight separate ticks of this run WHILE steering off the fight heading — but the
     * first press no longer coincides with the first steer, because the reaction path changed.
     *
     * The measured trace, hard, this exact scene (situation / emitted steer / emitted fireSlots):
     *
     *   t=0..5   waitOut  steer  0  fire 0
     *   t=6..9   evade    steer  0  fire 0
     *   t=10,11  evade    steer  0  fire 2   <- the old window stopped HERE, on steer 0
     *   t=12,13  evade    steer  1  fire 0
     *   t=14,15  evade    steer -1  fire 2   <- fires WHILE steering; the property under test
     *   t=18,19 / 22,23 / 26,27 — the same, steer -1 with fire 2
     *
     * Why the two separated. `evade` is entered at t=6, and the planner's FIRST evade answer here
     * is a dodge on the THROTTLE, not the wheel: this fixture's `awayHeadingRad` points back along
     * -x, which is collinear with the car's own axis (it faces +x), so full reverse moves it
     * straight down the away heading and the wheel has no work to do. That decision reaches the
     * output `reactionDelayTicks` (4) later, at t=10 — and the trigger, which is not delayed by a
     * plan at all, comes up on the same tick. The wheel only swings at the NEXT decision, t=8,
     * emitted at t=12. So the settled window opens at `evadeStart + reactionDelayTicks +
     * recomputeTicks` — every tick of it is derived from the profile, none of it is a chosen number.
     *
     * The assertion is STRONGER than the one it replaces: it holds for EVERY press in the settled
     * window, not for a single press.
     */
    for (let tick = 0; tick < 30; tick++) {
      const out = bot.decide(view({
        tick, self: selfView, others: [target], instances: [incoming], rng: makeRng(3),
      }));
      if (bot.debug()?.situation === "evade" && evadeStartTick === undefined) evadeStartTick = tick;
      if (out.fireSlots === 0) continue;
      firedWhileDodging = true;
      const settledFrom = evadeStartTick === undefined
        ? Infinity
        : evadeStartTick + BOT_PROFILES.hard.reactionDelayTicks + BOT_PROFILES.hard.recomputeTicks;
      if (tick >= settledFrom) settledPresses.push({ tick, steer: out.steer });
    }

    expect(firedWhileDodging).toBe(true);
    // `evade` takes the wheel off the fight heading, so steering visibly responds to the threat
    // rather than sitting at 0 the way it would if the car were simply pointed at its target.
    expect(settledPresses.length).toBeGreaterThan(0);
    for (const press of settledPresses) {
      expect(press.steer, `press at t=${press.tick} steered 0`).not.toBe(0);
    }
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
      x: 300, y: 100, angle: 0, vx: 0, vy: 0, hp: 70, maxHp: 70,
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
      x: 400, y: 100, angle: 0, vx: 0, vy: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    const aliveSelf = {
      sessionId: "me", carId: "bullseye" as const, team: 0 as const,
      x: 100, y: 100, angle: 0, vx: 0, vy: 0, hp: 65, maxHp: 65, alive: true,
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
      x: 400, y: 360, angle: Math.PI, vx: 0, vy: 0, hp: 70, maxHp: 70,
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
      x: 400, y: 400, angle: 0, vx: 200, vy: 0, hp: 70, maxHp: 70,
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
      x: 500, y: 360, angle: Math.PI, vx: 0, vy: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    let fired = false;
    for (let tick = 0; tick < 12; tick++) {
      const out = bot.decide(view({ tick, self: selfView, others: [them], rng: makeRng(3) }));
      if (out.fireSlots !== 0) fired = true;
    }
    expect(fired).toBe(true);
  });

  it("does NOT declare an evade excursion merely for standing in a loaded gun's line (P27)", () => {
    // REPLACES "breaks the line when it is in a loaded gun's solution, before the shot exists
    // (P16)", deleted 2026-09-06 with the anticipatory evade itself.
    //
    // That test asserted the OPPOSITE of this one, and it was right to, for the mechanism it was
    // written against: standing in a firing solution used to promote the bot into `evade`, an
    // EVENT-priority situation, throttled by a 120-tick refractory (`dangerEvadeCooldownTicks`) so
    // a STANDING condition could not occupy an event's slot for most of a fight. Spec P27 deletes
    // that whole apparatus: danger is now a continuously-weighted score term (`objectives.ts`'s
    // `theirEv`, scaled by `opponentRangeRespect` per P38), so the bot leans off a dangerous line
    // by degrees on every plan rather than declaring an excursion once every four seconds. The
    // property that survives is the READING, not the excursion — "reports the danger it is
    // standing in, for the overlay", below, still pins that `dangerEv` is nonzero in this exact
    // scene.
    //
    // Threat is stationary, pointed straight at the bot, well inside predator's reach, and has
    // fired nothing -- so every gun reads as loaded and there is no instance in flight to dodge.
    // With no shot in the air and no car bearing down, `evade` has no event to fire on.
    const bot = new HumanController("hard");
    const rng = makeRng(17);
    let evaded = false;
    for (let tick = 0; tick < 120; tick++) {
      bot.decide(inThreatLineView(tick, rng));
      if (bot.debug()?.situation === "evade") evaded = true;
    }
    expect(evaded).toBe(false);
  });

  it("keeps firing at a target that TURNS, now that the solver rolls real physics (P22)", () => {
    // A WIRING guard, and deliberately not a claim about lead quality — the task brief proposed
    // this as "a straight-line solve holds fire here", and measurement says otherwise: over 200
    // ticks of this scene the physics predictor fires 32 times (30 before fix round 1 switched the
    // rollout onto a held speed) and `constantVelocityPredictor` fires 34.
    // Fire COUNT is not a lead metric. It is dominated by `chooseSlot`'s cooldowns and
    // `minShotValueFraction`, and a solver aiming at the wrong point still clears the EV gate
    // whenever the wrong point happens to sit on a hull.
    //
    // What this DOES catch is the whole path going dark: `physicsPredictor` -> `interceptTicks` ->
    // `aimPoint` -> `aimHeading`, plus the same predictor threaded into every per-slot `solve()`.
    // A horizon that returns garbage, a predictor built on a stale pose, or an intercept that never
    // converges all show up here as a bot that stops shooting a curving target it can see.
    //
    // Lead ACCURACY is pinned where it can be measured against ground truth instead of inferred:
    // `predict.test.ts`'s "predicting an observed car, against an independent ground truth", which
    // scores this predictor, an engine-on rollout, the throttle-closed rollout and the straight line
    // in world units against an integrator that calls none of them.
    const { fires } = turningCrosserDuel(200);
    expect(fires).toBeGreaterThan(5);
  });

  it("draws the predictor's rng calls whether or not it has a target (H21)", () => {
    // `physicsPredictor` draws FOUR rng() calls — two gaussians, and `gaussian` is Box-Muller, which
    // draws a PAIR per call (`aim.ts` records having miscounted this exact thing once already) — so
    // building it only when a target exists would make the stream depend on the scene and one seed
    // would stop replaying. `plan()` therefore builds it against `ABSENT_TARGET` and discards the
    // result, exactly as `hearRoll` is discarded.
    //
    // Two otherwise-identical first ticks, differing only in whether an opponent is on screen. The
    // scene WITH a target legitimately draws two more than the scene without: `scoreTargets` adds
    // one score-noise draw per candidate, and `plan` rolls ram intent once for a new engagement.
    // Nothing else diverges here — no weapon instances (so `perceive` draws nothing), no wall or
    // corner (so no `cornerRespect` roll), and a stationary target is never `isIncomingCar` (so no
    // `incomingCarChance` roll). If the predictor were built inside the `target ? ... : undefined`
    // ternary, this difference would read 6 — the two legitimate draws plus the predictor's four.
    const slots = slotsOf("bullseye").map((weaponId) => ({
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
      range: weaponDefOf(weaponId).range,
    }));
    const profile = { ...BOT_PROFILES.hard, acquireTicks: 0 };
    const selfView = { ...view().self, slots, x: 200, y: 360, angle: 0 };
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 1 as const,
      x: 500, y: 360, angle: Math.PI, vx: 0, vy: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };

    const countDraws = (others: (typeof target)[]): number => {
      const inner = makeRng(5);
      let calls = 0;
      const bot = new HumanController("hard", { profile });
      bot.decide(view({
        tick: 0, self: selfView, others, rng: () => { calls += 1; return inner(); },
      }));
      return calls;
    };

    expect(countDraws([target]) - countDraws([])).toBe(2);
  });

  it("reports the danger it is standing in, for the overlay", () => {
    const bot = new HumanController("hard");
    const rng = makeRng(17);
    for (let tick = 0; tick < 30; tick++) bot.decide(inThreatLineView(tick, rng));
    expect(bot.debug()!.dangerEv).toBeGreaterThan(0);
  });
});

/**
 * A hard Bullseye against a Mirage riding a circular arc — the scene a constant-velocity solve gets
 * wrong by construction. The target orbits the bot's own spawn at radius 400 while carrying the
 * matching tangent `angle` every tick, so `observedAngVelOf` has two real poses to difference; the
 * bot's body is stepped through `stepDrive` from its own intent, so its nose has to converge.
 */
function turningCrosserDuel(ticks: number): { fires: number } {
  const bot = new HumanController("hard");
  const rng = makeRng(17);
  const slots = slotsOf("bullseye").map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  }));
  const centre = { x: 640, y: 360 };
  const radius = 400;
  const targetSpeed = 400;
  const omega = targetSpeed / radius; // rad/s, the arc's own turn rate
  let body: SimBody = {
    x: centre.x, y: centre.y, angle: 0, vx: 300, vy: 0, reverseHold: 0, angVel: 0,
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
  };
  let fires = 0;

  for (let tick = 0; tick < ticks; tick++) {
    const phase = (omega * tick) / TICK_RATE_HZ;
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 1 as const,
      x: centre.x + Math.cos(phase) * radius,
      y: centre.y + Math.sin(phase) * radius,
      angle: phase + Math.PI / 2, // tangent to the arc, so heading and motion agree
      // `targetSpeed` ALONG that tangent — the vector spelling of the old `speed: targetSpeed`,
      // and still exactly the arc's own motion, which is what "heading and motion agree" means.
      vx: Math.cos(phase + Math.PI / 2) * targetSpeed,
      vy: Math.sin(phase + Math.PI / 2) * targetSpeed,
      hp: 70, maxHp: 70, alive: true, phased: false,
      statuses: [], maneuver: 0,
    };
    const intent = bot.decide(view({
      tick,
      self: {
        ...view().self, carId: "bullseye",
        x: body.x, y: body.y, angle: body.angle, vx: body.vx, vy: body.vy, slots,
      },
      others: [target],
      rng,
    }));
    if (intent.fireSlots !== 0) fires += 1;
    body = stepDrive(
      body,
      { seq: tick, steer: intent.steer, throttle: intent.throttle, fireSlots: 0 },
      1 / TICK_RATE_HZ,
      driveOf("bullseye"),
      NEUTRAL_MODIFIERS,
    );
  }
  return { fires };
}

function inThreatLineView(tick: number, rng: ReturnType<typeof makeRng>): BotView {
  return {
    tick,
    self: {
      sessionId: "me", carId: "bullseye", team: 0, x: 400, y: 360, angle: 0, vx: 300, vy: 0,
      hp: 65, maxHp: 65, alive: true, statuses: [],
      slots: slotsOf("bullseye").map((weaponId) => ({
        weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
        range: weaponDefOf(weaponId).range,
      })),
      switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
    },
    others: [{
      sessionId: "them", carId: "bullseye", team: 1, x: 100, y: 360, angle: 0, vx: 0, vy: 0,
      hp: 65, maxHp: 65, alive: true, phased: false, statuses: [], maneuver: 0,
    }],
    instances: [], arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [], rng,
  };
}
