import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE, TICK_RATE_HZ, fireSlotsOf, hpOf, installMode, modeConfigOf,
  weaponDefOf,
} from "@motor-combat-moba/shared";
import { RESOLVED_BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotIntent, BotView } from "../types.js";
import { HumanController } from "./controller.js";
import { bestSustainedDpsOf, pressCeilingOf, runDuel } from "./duel.fixture.js";
import { enemy, fireSlotsFor, view } from "./fixtures.js";
import { constantVelocityPredictor, solve } from "./solution.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/**
 * Run a bot for `ticks` against a fixed scene and return every intent it produced.
 *
 * `rng` is created ONCE, outside the tick loop, and threaded into every tick's view — mirroring
 * production, where a bot's `Rng` is one persistent stream for the room's lifetime. v7 draws only in
 * the predictor and the aim-error drift, but a per-tick reseed would still freeze both into one
 * frozen draw for the whole run.
 */
function run(tier: "easy" | "medium" | "hard", ticks: number, over: Partial<BotView>) {
  const bot = new HumanController(tier);
  const rng = makeRng(17);
  const out: BotIntent[] = [];
  for (let tick = 0; tick < ticks; tick++) out.push(bot.decide(view(tick, { ...over, rng })));
  return { bot, out };
}

/** Rising edges of the emitted fire mask: what the brain decided to press, not how long it held it. */
function risingEdges(out: readonly BotIntent[]): number {
  let n = 0;
  let prev = 0;
  for (const o of out) {
    if (o.fireSlots !== 0 && prev === 0) n += 1;
    prev = o.fireSlots;
  }
  return n;
}

describe("tier characterisation (BB60)", () => {
  it("hard dodges a shot that easy ignores", () => {
    const speed = weaponDefOf("predator").speed;
    const hardP = RESOLVED_BOT_PROFILES.hard;
    const easyP = RESOLVED_BOT_PROFILES.easy;
    // A shot whose ETA at first sight sits halfway between hard's and easy's dodge reaction, closing
    // each tick. BB19: a shot is reacted to only when its ETA at notice exceeds the tier's own
    // `dodgeReactionTicks` — so this one is inside hard's window and below easy's.
    const etaTicks = (hardP.dodgeReactionTicks + easyP.dodgeReactionTicks) / 2;
    expect(etaTicks).toBeGreaterThan(hardP.dodgeReactionTicks);
    expect(etaTicks).toBeLessThan(easyP.dodgeReactionTicks);
    const startX = 200 + (speed * etaTicks) / TICK_RATE_HZ;
    const evadeTicks = (tier: "easy" | "hard") => {
      const bot = new HumanController(tier);
      const rng = makeRng(17);
      let n = 0;
      for (let tick = 0; tick < 60; tick++) {
        const shot = {
          id: "s", ownerSessionId: "them", weaponId: "predator" as const,
          x: startX - (speed * tick) / TICK_RATE_HZ, y: 360, angle: Math.PI,
        };
        bot.decide(view(tick, { instances: [shot], others: [enemy()], rng }));
        if (bot.debug()?.situation === "evade") n += 1;
      }
      return n;
    };
    expect(evadeTicks("hard")).toBeGreaterThan(0);
    expect(evadeTicks("hard")).toBeGreaterThan(evadeTicks("easy"));
  });

  it("hard resets when badly hurt and easy fights on [H37]", () => {
    const hurt = { ...view(0).self, hp: 10 };
    const { bot: hard } = run("hard", 90, { self: hurt, others: [{ ...enemy(), x: 500, vx: 0 }] });
    const { bot: easy } = run("easy", 90, { self: hurt, others: [{ ...enemy(), x: 500, vx: 0 }] });
    expect(hard.debug()?.situation).toBe("reset");
    // Easy's `retreatHpFraction` is 0: it has noticed the car by now and is still fighting it.
    expect(easy.debug()?.targetSessionId).toBe("them");
    expect(easy.debug()?.situation).toBe("fight");
  });

  it("hard focuses the wounded car; easy chases whoever shot at it [H32, H33]", () => {
    // Two scenes, because the two halves are two different claims and a tier can only weigh
    // candidates it can SEE (`awarenessRadiusUnits`: hard 900, easy 600).
    //
    // Hard's scene: the wounded car is the FAR one (700 u) and the shooter the near one (220 u), so
    // proximity and the grudge argue for the shooter and only `woundedBias` argues for the wounded.
    const shooter = { ...enemy(), sessionId: "shooter", x: 420, y: 360 };
    // A shot of the shooter's, in flight near us: `perceive` blames a car for a shot only when
    // `threatHeading` says the shot is actually coming at us.
    const incoming = [
      { id: "s", ownerSessionId: "shooter", weaponId: "predator" as const, x: 400, y: 360, angle: Math.PI },
    ];
    expect(
      run("hard", 120, {
        others: [{ ...enemy(), sessionId: "hurt", x: 900, y: 360, hp: 8 }, shooter],
        instances: incoming,
      }).bot.currentTargetSessionId,
    ).toBe("hurt");

    // Easy's scene: BOTH cars inside its awareness, the wounded car the NEAR one (50 u) and the
    // shooter far (490 u, still shooting at us), so proximity and the wounded bias both argue for
    // the wounded car and only the grudge (`vengefulness`) argues for the shooter.
    expect(
      run("easy", 200, {
        others: [
          { ...enemy(), sessionId: "hurt", x: 250, y: 360, hp: 8 },
          { ...enemy(), sessionId: "shooter", x: 690, y: 360 },
        ],
        instances: incoming,
      }).bot.currentTargetSessionId,
    ).toBe("shooter");
  });

  it("uses the rest of the kit when the top slot is down [H27]", () => {
    // The view holds slot state constant, so with the full kit loaded the bot presses the one slot
    // that tops this scene every time (measured: `lance`, fire slot 3 — dead ahead it out-damages
    // the others). Find that slot rather than assume it, then spend it for the whole run.
    const scene = { others: [{ ...enemy(), x: 400, vx: 0 }] };
    const pressedIn = (out: readonly BotIntent[]) => {
      const masks = out.filter((o) => o.fireSlots !== 0).map((o) => o.fireSlots);
      for (const mask of masks) expect(mask & (mask - 1)).toBe(0); // exactly one bit per press
      return new Set(masks.map((m) => Math.log2(m)));
    };
    const full = pressedIn(run("hard", 120, scene).out);
    expect(full.size).toBe(1);
    const top = [...full][0]!;
    const slots = view(0).self.slots.map((s, i) => (i === top ? { ...s, stocks: 0, rechargeEndsTick: 10_000 } : s));
    const pressed = pressedIn(run("hard", 120, { ...scene, self: { ...view(0).self, slots } }).out);
    expect(pressed.size).toBeGreaterThan(0);
    expect(pressed.has(top)).toBe(false);
  });

  it("a wall changes what hard does [H39]", () => {
    // Same tier, same seed, the enemy 540 u straight behind the bot on its line in both scenes; only
    // the wall in front of the nose differs.
    // The whole emitted input is compared, not one axis: which axis carries the answer is the
    // navigator's business.
    const nearWall = { ...view(0).self, x: 60, y: 360, angle: Math.PI };
    const walled = run("hard", 40, { self: nearWall, others: [{ ...enemy(), x: 600 }] });
    const open = run("hard", 40, { self: { ...nearWall, x: 640 }, others: [{ ...enemy(), x: 1180 }] });
    expect(walled.bot.debug()?.situation).toBe("unpin");
    expect(open.bot.debug()?.situation).not.toBe("unpin");
    expect(walled.out.map((o) => `${o.steer}${o.throttle}`).join()).not.toBe(open.out.map((o) => `${o.steer}${o.throttle}`).join());
  });

  it("easy closes on a visible target, throttle forward [S13]", () => {
    // Visible means inside easy's `awarenessRadiusUnits` (600): a target 800 u out is never noticed
    // and the bot only hunts. And a Bullseye is in its own raw reach of anything it can see (`lance`
    // 1200, `predator` 1800), so it would `fight`, not close. A Mirage with `magmablast` spent has
    // `thunderclap`'s 400 as its longest ready reach, so a target 550 u out is seen and out of reach:
    // the `close` situation, arrive at 0.9 of that reach, nose first.
    const self = {
      ...view(0).self,
      carId: "mirage" as const,
      slots: fireSlotsFor("mirage").map((s) => (s.weaponId === "magmablast" ? { ...s, stocks: 0, rechargeEndsTick: 100_000 } : s)),
    };
    expect(RESOLVED_BOT_PROFILES.easy.awarenessRadiusUnits).toBeGreaterThan(550);
    const { bot, out } = run("easy", 90, { self, others: [{ ...enemy(), x: 750, vx: 0 }] });
    expect(bot.debug()?.targetSessionId).toBe("them");
    expect(bot.debug()?.situation).toBe("close");
    expect(out.slice(-30).filter((o) => o.throttle === 1).length).toBeGreaterThan(15);
  });

  it("hard Bastion fights then punishes once the stun lands [S13]", () => {
    const hard = RESOLVED_BOT_PROFILES.hard;
    const kit = fireSlotsOf("bastion");
    const roadblock = kit.indexOf("roadblock");
    expect(roadblock).toBeGreaterThan(0);
    // 20° off the nose, 300 u out: inside every turret arc and inside `roadblock`'s reach.
    const target = { ...enemy(), x: 200 + Math.cos(0.35) * 300, y: 360 + Math.sin(0.35) * 300, vx: 0 };
    const bot = new HumanController("hard");
    const rng = makeRng(17);
    let slots = fireSlotsFor("bastion");
    const bastion = () => ({ ...view(0).self, carId: "bastion" as const, slots });

    // Fight until the setup slot is pressed. Read off `debug()`, which reports the recompute's own
    // decision; the emitted intent trails it by `reactionDelayTicks` and is held between recomputes.
    let tick = 0;
    let stunAt: number | undefined;
    for (; tick < 300 && stunAt === undefined; tick++) {
      bot.decide(view(tick, { self: bastion(), others: [target], rng }));
      const debug = bot.debug()!;
      if (debug.firedSlot !== undefined) {
        expect(debug.situation).toBe("fight");
        expect(debug.firedSlot).toBe(roadblock); // the setup slot goes first (BB39)
        stunAt = tick;
      }
    }
    expect(stunAt).toBeDefined();

    // The stun lands: `roadblock` is spent and the target is stunned.
    slots = slots.map((s, i) => (i === roadblock ? { ...s, stocks: 0, rechargeEndsTick: 100_000 } : s));
    const stunned = {
      ...target,
      statuses: [{ statusId: "stunned" as const, startTick: tick, endsTick: tick + 10_000, sourceSessionId: "me" }],
    };
    const flipBy = tick + hard.situationCommitTicks + hard.recomputeTicks;
    let punishedAt: number | undefined;
    let nextPress: number | undefined;
    for (; tick < flipBy + 300 && nextPress === undefined; tick++) {
      bot.decide(view(tick, { self: bastion(), others: [stunned], rng }));
      const debug = bot.debug()!;
      if (punishedAt === undefined && debug.situation === "punish") punishedAt = tick;
      // The first press decided once punishing: the flip happens on a recompute, so from then on
      // `firedSlot` is a punish-era decision.
      if (punishedAt !== undefined && debug.firedSlot !== undefined) nextPress = debug.firedSlot;
    }
    expect(punishedAt).toBeDefined();
    expect(punishedAt!).toBeLessThanOrEqual(flipBy);
    // The highest-damage slot still loaded, by what a landed press deals (every pellet and pulse —
    // `tremor`'s pulses out-total `thumper`'s single shell): the solver at perfect aim on this pose.
    const self = bastion();
    const shooter = { sessionId: "me", carId: "bastion" as const, team: self.team, x: self.x, y: self.y, angle: self.angle, vx: self.vx, vy: self.vy };
    const damageOf = (i: number) => solve({
      shooter, slot: slots[i]!, slotIndex: i, target: stunned, targetAt: constantVelocityPredictor(stunned),
      aimSigmaRad: 0, tick, arena: view(0).arena,
    }).expectedDamage;
    const loaded = kit.map((_, i) => i).filter((i) => i !== 0 && i !== roadblock);
    const highest = loaded.reduce((a, b) => (damageOf(b) > damageOf(a) ? b : a));
    expect(damageOf(highest)).toBeGreaterThan(0);
    expect(nextPress).toBe(highest);
  });

  it("presses rise with tier at a good angle", () => {
    // Rising edges, not ticks with a fire bit: a decision is held until the next recompute, which
    // is 24 ticks at easy and 4 at hard, so counting occupied ticks would credit easy for holding
    // the button longer rather than for pressing more often.
    const presses = (tier: "easy" | "medium" | "hard") =>
      risingEdges(run(tier, 300, { others: [{ ...enemy(), x: 400, vx: 0 }] }).out);
    expect(presses("medium")).toBeGreaterThan(presses("easy"));
    expect(presses("hard")).toBeGreaterThan(presses("medium"));
  });
});

/**
 * A duel against a sitting duck: a stationary, non-firing `mirage` 400 units dead ahead, with every
 * press marched through the REAL combat pass (`runCombat`). Cooldowns, switch locks, volleys,
 * instance flight, hull tests and damage are the game's own, so `fires` counts presses combat
 * actually committed and `hits` counts the ones that landed (`balance/stats.ts`'s definition).
 *
 * `immortalTarget` restores the dummy's hp after every combat tick, so a hit rate is measured over
 * the same window for every tier. The time-to-kill test obviously does not use it.
 */
function duelAgainstDummy(tier: "easy" | "medium" | "hard", ticks = 600, immortalTarget = false) {
  const { presses, hits, hitRate, ticks: elapsed, killed } = runDuel({
    tier, ticks, resolveCombat: true, immortalTarget, targetPos: { x: 600, y: 360 },
  });
  return { fires: presses, hits, hitRate, ticks: elapsed, killed };
}

describe("the reported symptoms stay fixed (BB3)", () => {
  it("hard kills a stationary target inside five times its kit's theoretical floor", () => {
    // A RELATION, not an absolute: the floor is recomputed from the same tables `npm run ttk` reads
    // (best single slot, no flight time, no misses, no switching — deliberately unreachable), so a
    // weapon retune moves both sides of this assertion together instead of breaking it.
    const { ticks, killed } = duelAgainstDummy("hard", 2400);
    expect(killed).toBe(true);
    const floorSeconds = hpOf("mirage") / bestSustainedDpsOf("bullseye");
    expect(ticks / TICK_RATE_HZ).toBeLessThan(floorSeconds * 5);
  });

  it("hard fires at its preferred range rather than parking and weaving", () => {
    // The ceiling is the KIT's, not the cadence's: `pressCeilingOf` takes whichever of the brain's
    // `burstGapTicks` and the kit's cooldowns binds. `/4` is a floor with a wide margin, not a
    // quality bar; `> 0` is the regression guard for a bot that parked, wove and never pressed.
    // `immortalTarget` keeps the target at full hp so nothing but baseline willingness is counted.
    //
    // A press count alone says nothing about RANGE: a bot could spray from out of reach. Landed hits
    // do — combat only scores a press that reached the dummy — and the hit-rate floor says the bot
    // presses from where its kit lands, not merely somewhere it occasionally does. Measured over ten
    // seeds (17, 3, 7, 42, 99, 1, 2, 5, 2026, 11): 6 presses each, 4-5 hits, rate 0.667-0.833.
    const { fires, hits, hitRate } = duelAgainstDummy("hard", 300, true);
    expect(fires).toBeGreaterThan(0);
    expect(fires).toBeGreaterThan(pressCeilingOf("bullseye", 300, RESOLVED_BOT_PROFILES.hard.burstGapTicks) / 4);
    expect(hits).toBeGreaterThan(0);
    expect(hitRate).toBeGreaterThanOrEqual(0.5);
  });

  it("hits far more often above the easy tier [P50]", () => {
    // Accuracy only: volume is a separate ladder ("presses rise with tier"). `fires` is combat's own
    // committed-press count, so a held fire bit cannot inflate it.
    const easy = duelAgainstDummy("easy", 600, true);
    const medium = duelAgainstDummy("medium", 600, true);
    const hard = duelAgainstDummy("hard", 600, true);
    expect(medium.hitRate).toBeGreaterThan(easy.hitRate);
    expect(hard.hitRate).toBeGreaterThan(easy.hitRate);
  });
});

describe("whole-brain determinism (BB63)", () => {
  // One seed replays the ENTIRE brain, every tier, with and without a target and with and without a
  // threat, so every branch family runs: the fight path, the evade path, and the no-target path (the
  // predictor at horizon 0 over the stand-in car, the hunt navigator). It compares a run against
  // ITSELF, so it catches nondeterminism leaking outside `(controller, rng)` — module-level mutable
  // state carried between replays, a stray `Math.random`/`Date.now`, an unstable Map/Set iteration
  // order — not a branch-dependent draw.
  const SHOT_PERIOD_TICKS = 60;
  /**
   * A `predator` shot fired at the bot every `SHOT_PERIOD_TICKS`, born 600 u dead ahead on its line
   * and flying straight at it. It closes through every tier's reaction window (BB19) on the way in,
   * so every tier tracks it and medium and hard reach `evade`. Easy notices it with an ETA just over
   * its 24-tick reaction, and the shot lands before a 24-tick recompute can act on it: easy
   * practically never dodges, by design (see "hard dodges a shot that easy ignores").
   */
  const shotAt = (tick: number) => {
    const speed = weaponDefOf("predator").speed;
    const age = tick % SHOT_PERIOD_TICKS;
    return {
      id: `shot-${Math.floor(tick / SHOT_PERIOD_TICKS)}`, ownerSessionId: "them", weaponId: "predator" as const,
      x: 200 + 600 - (speed * age) / TICK_RATE_HZ, y: 360, angle: Math.PI,
    };
  };
  const scenes = {
    quiet: (_tick: number) => ({ others: [enemy()], instances: [] }),
    "under fire": (tick: number) => ({ others: [enemy()], instances: [shotAt(tick)] }),
    "no target": (_tick: number) => ({ others: [], instances: [] }),
  } as const;
  for (const tier of ["easy", "medium", "hard"] as const) {
    for (const label of Object.keys(scenes) as (keyof typeof scenes)[]) {
      it(`${tier} replays identically from one seed, ${label}`, () => {
        const replay = () => {
          const bot = new HumanController(tier);
          const rng = makeRng(4242);
          const out: string[] = [];
          const situations = new Set<string>();
          for (let tick = 0; tick < 400; tick++) {
            const intent = bot.decide(view(tick, { ...scenes[label](tick), rng }));
            situations.add(bot.debug()!.situation);
            out.push(`${intent.steer}:${intent.throttle}:${intent.fireSlots}:${intent.aimAngle ?? ""}`);
          }
          return { stream: out.join("|"), situations };
        };
        const first = replay();
        expect(first.stream).toBe(replay().stream);
        // The scene reached the branch it is here to exercise.
        if (label === "under fire" && tier !== "easy") expect(first.situations.has("evade")).toBe(true);
        if (label === "no target") expect([...first.situations]).toEqual(["waitOut"]);
      });
    }
  }
});
