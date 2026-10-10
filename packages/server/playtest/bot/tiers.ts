/**
 * What each bot tier does in a fixed scene: the tier characterisation (BB60) and the reported
 * symptoms that must stay fixed (BB3).
 *
 * These were `src/bot/brain/tiers.test.ts`'s two calibration blocks until 2026-10-10 (TS11–TS14).
 * They pin what one seed and one tier happen to do, so a miss now reads `FINDING` here rather than
 * failing the build. The whole-brain determinism check (BB63) is an invariant and stays a test.
 *
 * One `report` per former `it`, titled as it was; every former assertion is a named check with the
 * same bound, and the detail prints the measured values whichever way it goes.
 */
import {
  DEFAULT_GAME_MODE, TICK_RATE_HZ, fireSlotsOf, hpOf, installMode, modeConfigOf,
  weaponDefOf,
} from "@motor-combat-moba/shared";
import { RESOLVED_BOT_PROFILES } from "../../src/config/bot-profiles.js";
import { makeRng } from "../../src/bot/rng.js";
import type { BotIntent, BotView } from "../../src/bot/types.js";
import { HumanController } from "../../src/bot/brain/controller.js";
import { bestSustainedDpsOf, pressCeilingOf, runDuel } from "../../src/bot/brain/duel.fixture.js";
import { enemy, fireSlotsFor, view } from "../../src/bot/brain/fixtures.js";
import { usableSlots } from "../../src/bot/brain/ranges.js";
import { weaponReachOf } from "../../src/bot/brain/reach.js";
import { constantVelocityPredictor, solve } from "../../src/bot/brain/solution.js";
import { VERDICT } from "../common/reporter.js";

type Report = (probe: string, verdict: string, detail: string) => void;

/** One probe's checks: each records its measured value; any miss makes the probe a FINDING. */
class Checks {
  private readonly lines: string[] = [];
  private failed = 0;

  /** `ok` is the former assertion; `what` names it and prints what was measured against what bound. */
  check(ok: boolean, what: string): boolean {
    if (!ok) this.failed += 1;
    this.lines.push(`${ok ? "ok  " : "MISS"} ${what}`);
    return ok;
  }

  note(line: string): void {
    this.lines.push(`     ${line}`);
  }

  emit(report: Report, probe: string): void {
    report(probe, this.failed === 0 ? VERDICT.OK : VERDICT.FINDING, this.lines.join("\n"));
  }
}

/**
 * Run a bot for `ticks` against a fixed scene and return every intent it produced.
 *
 * `rng` is created ONCE, outside the tick loop, and threaded into every tick's view — mirroring
 * production, where a bot's `Rng` is one persistent stream for the room's lifetime. v7 draws only in
 * the predictor and the aim-error drift, but a per-tick reseed would still freeze both into one
 * frozen draw for the whole run.
 */
function runBot(tier: "easy" | "medium" | "hard", ticks: number, over: Partial<BotView>) {
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

// ---- tier characterisation (BB60) ----

function hardDodges(c: Checks): void {
  const speed = weaponDefOf("predator").speed;
  const hardP = RESOLVED_BOT_PROFILES.hard;
  const easyP = RESOLVED_BOT_PROFILES.easy;
  // A shot whose ETA at first sight sits halfway between hard's and easy's dodge reaction, closing
  // each tick. BB19: a shot is reacted to only when its ETA at notice exceeds the tier's own
  // `dodgeReactionTicks` — so this one is inside hard's window and below easy's.
  const etaTicks = (hardP.dodgeReactionTicks + easyP.dodgeReactionTicks) / 2;
  c.check(etaTicks > hardP.dodgeReactionTicks, `premise: ETA ${etaTicks} > hard reaction ${hardP.dodgeReactionTicks}`);
  c.check(etaTicks < easyP.dodgeReactionTicks, `premise: ETA ${etaTicks} < easy reaction ${easyP.dodgeReactionTicks}`);
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
  const hard = evadeTicks("hard");
  const easy = evadeTicks("easy");
  c.check(hard > 0, `hard evade ticks ${hard} > 0`);
  c.check(hard > easy, `hard evade ticks ${hard} > easy evade ticks ${easy}`);
}

function hardResets(c: Checks): void {
  const hurt = { ...view(0).self, hp: 10 };
  const { bot: hard } = runBot("hard", 90, { self: hurt, others: [{ ...enemy(), x: 500, vx: 0 }] });
  const { bot: easy } = runBot("easy", 90, { self: hurt, others: [{ ...enemy(), x: 500, vx: 0 }] });
  const hardSituation = hard.debug()?.situation;
  c.check(hardSituation === "reset", `hard situation ${hardSituation}, expected reset`);
  // Easy's `retreatHpFraction` is 0: it has noticed the car by now and is still fighting it.
  const easyTarget = easy.debug()?.targetSessionId;
  const easySituation = easy.debug()?.situation;
  c.check(easyTarget === "them", `easy target ${easyTarget}, expected them`);
  c.check(easySituation === "fight", `easy situation ${easySituation}, expected fight`);
}

function hardFocusesWounded(c: Checks): void {
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
  const hardTarget = runBot("hard", 120, {
    others: [{ ...enemy(), sessionId: "hurt", x: 900, y: 360, hp: 8 }, shooter],
    instances: incoming,
  }).bot.currentTargetSessionId;
  c.check(hardTarget === "hurt", `hard target ${hardTarget}, expected hurt`);

  // Easy's scene: BOTH cars inside its awareness, the wounded car the NEAR one (50 u) and the
  // shooter far (490 u, still shooting at us), so proximity and the wounded bias both argue for
  // the wounded car and only the grudge (`vengefulness`) argues for the shooter.
  const easyTarget = runBot("easy", 200, {
    others: [
      { ...enemy(), sessionId: "hurt", x: 250, y: 360, hp: 8 },
      { ...enemy(), sessionId: "shooter", x: 690, y: 360 },
    ],
    instances: incoming,
  }).bot.currentTargetSessionId;
  c.check(easyTarget === "shooter", `easy target ${easyTarget}, expected shooter`);
}

function usesRestOfKit(c: Checks): void {
  // The view holds slot state constant, so with the full kit loaded the bot presses the one slot
  // that tops this scene every time (measured: `lance`, fire slot 3 — dead ahead it out-damages
  // the others). Find that slot rather than assume it, then spend it for the whole run.
  const scene = { others: [{ ...enemy(), x: 400, vx: 0 }] };
  const pressedIn = (label: string, out: readonly BotIntent[]) => {
    const masks = out.filter((o) => o.fireSlots !== 0).map((o) => o.fireSlots);
    const multi = masks.filter((mask) => (mask & (mask - 1)) !== 0);
    c.check(multi.length === 0, `${label}: presses with more than one bit ${multi.length}, expected 0`); // exactly one bit per press
    return new Set(masks.map((m) => Math.log2(m)));
  };
  const full = pressedIn("full kit", runBot("hard", 120, scene).out);
  if (!c.check(full.size === 1, `full kit: distinct slots pressed ${full.size} [${[...full].join(", ")}], expected 1`)) return;
  const top = [...full][0]!;
  c.note(`top slot ${top}`);
  const slots = view(0).self.slots.map((s, i) => (i === top ? { ...s, stocks: 0, rechargeEndsTick: 10_000 } : s));
  const pressed = pressedIn("top slot spent", runBot("hard", 120, { ...scene, self: { ...view(0).self, slots } }).out);
  c.check(pressed.size > 0, `top slot spent: distinct slots pressed ${pressed.size} [${[...pressed].join(", ")}], expected > 0`);
  c.check(!pressed.has(top), `top slot spent: slot ${top} not pressed`);
}

function wallChangesHard(c: Checks): void {
  // Same tier, same seed, the enemy 540 u straight behind the bot on its line in both scenes; only
  // the wall in front of the nose differs.
  // The whole emitted input is compared, not one axis: which axis carries the answer is the
  // navigator's business.
  const nearWall = { ...view(0).self, x: 60, y: 360, angle: Math.PI };
  const walled = runBot("hard", 40, { self: nearWall, others: [{ ...enemy(), x: 600 }] });
  const open = runBot("hard", 40, { self: { ...nearWall, x: 640 }, others: [{ ...enemy(), x: 1180 }] });
  const walledSituation = walled.bot.debug()?.situation;
  const openSituation = open.bot.debug()?.situation;
  c.check(walledSituation === "unpin", `walled situation ${walledSituation}, expected unpin`);
  c.check(openSituation !== "unpin", `open situation ${openSituation}, expected not unpin`);
  const streamOf = (out: readonly BotIntent[]) => out.map((o) => `${o.steer}${o.throttle}`).join();
  c.check(streamOf(walled.out) !== streamOf(open.out), "walled and open input streams differ");
}

function easyCloses(c: Checks): void {
  // `close` is "hittable and out of raw reach of every usable slot, ready or not" (BB15, 7.1.0).
  // Every shipped kit reaches at least 900 u with some slot (Mirage's `magmablast`), past easy's
  // 600 u awareness, so a stock easy bot reads `close` only on a car it remembers beyond what it
  // can see. The scene widens awareness to isolate the rule: a Mirage 1000 u from its target is
  // seen and out of reach, arrives at 0.9 of its longest reach, nose first.
  const self = { ...view(0).self, carId: "mirage" as const, slots: fireSlotsFor("mirage") };
  const distance = 1000;
  const longest = Math.max(...usableSlots(self.slots).map(({ slot }) => weaponReachOf(slot.weaponId)));
  c.check(longest < distance, `premise: longest reach ${longest.toFixed(1)} < distance ${distance}`); // out of reach of the whole kit
  const profile = { ...RESOLVED_BOT_PROFILES.easy, awarenessRadiusUnits: 1500 };
  const bot = new HumanController("easy", { profile });
  const rng = makeRng(17);
  const out: BotIntent[] = [];
  for (let tick = 0; tick < 90; tick++) {
    out.push(bot.decide(view(tick, { self, others: [{ ...enemy(), x: self.x + distance, vx: 0 }], rng })));
  }
  const d = bot.debug();
  c.check(d?.targetSessionId === "them", `target ${d?.targetSessionId}, expected them`);
  c.check(d?.situation === "close", `situation ${d?.situation}, expected close`);
  // `toBeCloseTo(x, 6)`: |a - b| < 0.5e-6.
  const goal = d?.goalRange;
  c.check(goal !== undefined && Math.abs(goal - 0.9 * longest) < 0.5e-6,
    `goal range ${goal}, expected ${0.9 * longest} (0.9 x longest reach)`);
  const forward = out.slice(-30).filter((o) => o.throttle === 1).length;
  c.check(forward > 15, `throttle-forward ticks in the last 30: ${forward}, expected > 15`);
}

function bastionPunishes(c: Checks): void {
  const hard = RESOLVED_BOT_PROFILES.hard;
  const kit = fireSlotsOf("bastion");
  const roadblock = kit.indexOf("roadblock");
  if (!c.check(roadblock > 0, `premise: roadblock fire slot ${roadblock} > 0`)) return;
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
      c.check(debug.situation === "fight", `first press at tick ${tick} in situation ${debug.situation}, expected fight`);
      // The setup slot goes first (BB39).
      c.check(debug.firedSlot === roadblock, `first press slot ${debug.firedSlot}, expected roadblock (${roadblock})`);
      stunAt = tick;
    }
  }
  if (!c.check(stunAt !== undefined, `setup slot pressed within 300 ticks (at ${stunAt})`)) return;

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
  if (!c.check(punishedAt !== undefined, `reached punish (at ${punishedAt})`)) return;
  c.check(punishedAt! <= flipBy, `punish at tick ${punishedAt} <= flip-by tick ${flipBy}`);
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
  c.note(`expected damage by loaded slot: ${loaded.map((i) => `${i}=${damageOf(i).toFixed(1)}`).join(", ")}`);
  c.check(damageOf(highest) > 0, `highest loaded slot ${highest} damage ${damageOf(highest).toFixed(1)} > 0`);
  c.check(nextPress === highest, `punish press slot ${nextPress}, expected highest-damage slot ${highest}`);
}

function pressesRise(c: Checks): void {
  // Rising edges, not ticks with a fire bit: a decision is held until the next recompute, which
  // is 24 ticks at easy and 4 at hard, so counting occupied ticks would credit easy for holding
  // the button longer rather than for pressing more often.
  const presses = (tier: "easy" | "medium" | "hard") =>
    risingEdges(runBot(tier, 300, { others: [{ ...enemy(), x: 400, vx: 0 }] }).out);
  const easy = presses("easy");
  const medium = presses("medium");
  const hard = presses("hard");
  c.check(medium > easy, `medium presses ${medium} > easy presses ${easy}`);
  c.check(hard > medium, `hard presses ${hard} > medium presses ${medium}`);
}

// ---- the reported symptoms stay fixed (BB3) ----

/**
 * A duel against a sitting duck: a stationary, non-firing `mirage` 400 units dead ahead, with every
 * press marched through the REAL combat pass (`runCombat`). Cooldowns, switch locks, volleys,
 * instance flight, hull tests and damage are the game's own, so `fires` counts presses combat
 * actually committed and `hits` counts the ones that landed (`balance/stats.ts`'s definition).
 *
 * `immortalTarget` restores the dummy's hp after every combat tick, so a hit rate is measured over
 * the same window for every tier. The time-to-kill probe obviously does not use it.
 */
function duelAgainstDummy(tier: "easy" | "medium" | "hard", ticks = 600, immortalTarget = false, seed = 17) {
  const { presses, hits, hitRate, ticks: elapsed, killed, hittableTicks, idleHittableTicks } = runDuel({
    tier, ticks, seed, resolveCombat: true, immortalTarget, targetPos: { x: 600, y: 360 },
  });
  const idleShare = hittableTicks > 0 ? idleHittableTicks / hittableTicks : 0;
  return { fires: presses, hits, hitRate, ticks: elapsed, killed, idleShare };
}

function hardKillsInsideFloor(c: Checks): void {
  // A RELATION, not an absolute: the floor is recomputed from the same tables `npm run ttk` reads
  // (best single slot, no flight time, no misses, no switching — deliberately unreachable), so a
  // weapon retune moves both sides of this check together instead of breaking it.
  const { ticks, killed } = duelAgainstDummy("hard", 2400);
  c.check(killed, `killed within 2400 ticks: ${killed}`);
  const floorSeconds = hpOf("mirage") / bestSustainedDpsOf("bullseye");
  const seconds = ticks / TICK_RATE_HZ;
  c.check(seconds < floorSeconds * 5,
    `time to kill ${seconds.toFixed(2)} s < 5 x floor ${floorSeconds.toFixed(2)} s = ${(floorSeconds * 5).toFixed(2)} s`);
}

function hardFiresAtRange(c: Checks): void {
  // The ceiling is the KIT's, not the cadence's: `pressCeilingOf` takes whichever of the brain's
  // `burstGapTicks` and the kit's cooldowns binds. `/4` is a floor with a wide margin, not a
  // quality bar; `> 0` is the regression guard for a bot that parked, wove and never pressed.
  // `immortalTarget` keeps the target at full hp so nothing but baseline willingness is counted.
  //
  // A press count alone says nothing about RANGE: a bot could spray from out of reach. Landed hits
  // do — combat only scores a press that reached the dummy — and the hit-rate floor says the bot
  // presses from where its kit lands, not merely somewhere it occasionally does. Measured over ten
  // seeds (17, 3, 7, 42, 99, 1, 2, 5, 2026, 11): 6 presses each, 4-5 hits, rate 0.667-0.833.
  //
  // Presses cannot see a bot that parks between them (C1, the final review): the share of ticks it
  // held the throttle at 0 with a target in hand must stay small.
  const { fires, hits, hitRate, idleShare } = duelAgainstDummy("hard", 300, true);
  const ceiling = pressCeilingOf("bullseye", 300, RESOLVED_BOT_PROFILES.hard.burstGapTicks);
  c.check(idleShare < 0.05, `idle-while-hittable share ${idleShare.toFixed(3)} < 0.05`);
  c.check(fires > 0, `presses ${fires} > 0`);
  c.check(fires > ceiling / 4, `presses ${fires} > press ceiling ${ceiling.toFixed(2)} / 4 = ${(ceiling / 4).toFixed(2)}`);
  c.check(hits > 0, `hits ${hits} > 0`);
  c.check(hitRate >= 0.5, `hit rate ${hitRate.toFixed(3)} >= 0.5`);
}

function hitsMoreAboveEasy(c: Checks): void {
  // Accuracy only: volume is a separate ladder ("presses rise with tier"). `fires` is combat's own
  // committed-press count, so a held fire bit cannot inflate it.
  //
  // Pooled over five seeds: easy presses 5-7 times in 600 ticks, so one landed shot moves a single
  // seed's rate by 15-20 points. Seed 17 alone reads easy 4/5 against medium 7/9 on 7.1.0, the one
  // outlier in ten seeds (17, 3, 7, 42, 99, 1, 2, 5, 2026, 11 pooled: easy 31/68 = 0.456, medium
  // 60/90 = 0.667, hard 90/121 = 0.744). These five pool to 14/33, 29/45 and 45/61.
  const pooled = (tier: "easy" | "medium" | "hard") => {
    let hits = 0;
    let fires = 0;
    for (const seed of [17, 3, 7, 42, 99]) {
      const r = duelAgainstDummy(tier, 600, true, seed);
      hits += r.hits;
      fires += r.fires;
    }
    return { hits, fires, rate: hits / fires };
  };
  const easy = pooled("easy");
  const medium = pooled("medium");
  const hard = pooled("hard");
  const show = (p: { hits: number; fires: number; rate: number }) => `${p.hits}/${p.fires} = ${p.rate.toFixed(3)}`;
  c.check(medium.rate > easy.rate, `medium pooled hit rate ${show(medium)} > easy ${show(easy)}`);
  c.check(hard.rate > easy.rate, `hard pooled hit rate ${show(hard)} > easy ${show(easy)}`);
}

const PROBES: readonly (readonly [string, (c: Checks) => void])[] = [
  ["tier characterisation (BB60): hard dodges a shot that easy ignores", hardDodges],
  ["tier characterisation (BB60): hard resets when badly hurt and easy fights on [H37]", hardResets],
  ["tier characterisation (BB60): hard focuses the wounded car; easy chases whoever shot at it [H32, H33]", hardFocusesWounded],
  ["tier characterisation (BB60): uses the rest of the kit when the top slot is down [H27]", usesRestOfKit],
  ["tier characterisation (BB60): a wall changes what hard does [H39]", wallChangesHard],
  ["tier characterisation (BB60): easy closes on a visible target, throttle forward [S13]", easyCloses],
  ["tier characterisation (BB60): hard Bastion fights then punishes once the stun lands [S13]", bastionPunishes],
  ["tier characterisation (BB60): presses rise with tier at a good angle", pressesRise],
  ["the reported symptoms stay fixed (BB3): hard kills a stationary target inside five times its kit's theoretical floor", hardKillsInsideFloor],
  ["the reported symptoms stay fixed (BB3): hard fires at its preferred range rather than parking and weaving", hardFiresAtRange],
  ["the reported symptoms stay fixed (BB3): hits far more often above the easy tier [P50]", hitsMoreAboveEasy],
];

export function run(report: Report): void {
  for (const [probe, body] of PROBES) {
    // Each former `it` ran under a fresh `beforeEach` install of the default mode.
    installMode(modeConfigOf(DEFAULT_GAME_MODE));
    const c = new Checks();
    body(c);
    c.emit(report, probe);
  }
}
