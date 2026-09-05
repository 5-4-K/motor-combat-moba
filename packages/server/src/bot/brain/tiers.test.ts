import { describe, expect, it } from "vitest";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";
import { makeRng } from "../rng.js";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import type { BotCarView, BotSlotView, BotView } from "../types.js";
import { HumanController } from "./controller.js";

function slotsFor(carId: "bullseye" | "bastion" | "mirage"): BotSlotView[] {
  return slotsOf(carId).map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  }));
}

function view(tick: number, over: Partial<BotView> = {}): BotView {
  return {
    tick,
    self: {
      sessionId: "me", carId: "bullseye", team: 0, x: 200, y: 360, angle: 0, speed: 200,
      hp: 65, maxHp: 65, alive: true, statuses: [], slots: slotsFor("bullseye"),
      switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
    },
    others: [], instances: [], arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [], rng: makeRng(17),
    ...over,
  };
}

const enemy: BotCarView = {
  sessionId: "them", carId: "mirage", team: 0, x: 700, y: 360, angle: Math.PI, speed: 400,
  hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
};

/**
 * Run a bot for `ticks` against a fixed scene and return every intent it produced.
 *
 * `rng` is created ONCE, outside the tick loop, and threaded into every tick's view — mirroring
 * production, where a bot's `Rng` is a single persistent stream for the room's lifetime
 * (`PracticeRoom`'s `botRng`), never a fresh generator per tick. Reseeding per tick would replay the
 * same draw at the same position in every tick's decision, which turns every probabilistic roll
 * (dodge, discipline, blunder, idle fidget) into a single frozen coin flip for the whole run instead
 * of a real stream — exactly the kind of bug this suite exists to catch, so the harness itself must
 * not commit it.
 */
function run(tier: "easy" | "medium" | "hard", ticks: number, over: Partial<BotView>) {
  const bot = new HumanController(tier);
  const rng = makeRng(17);
  const out = [];
  for (let tick = 0; tick < ticks; tick++) out.push(bot.decide(view(tick, { ...over, rng })));
  return { bot, out };
}

describe("tier characterisation", () => {
  /**
   * Within-tier, not across tiers. A harder tier has a tighter `aimToleranceRad` and therefore
   * steers more in ANY scene, so comparing steer counts between tiers would pass whether or not
   * dodging exists. The question is whether the shot changes what THIS tier does.
   *
   * TEST FIX (was: compare `instances: [shot]` against `instances: []`). `perceive` draws its
   * `dodgeChance` roll UNCONDITIONALLY for every tracked threat, every tick, whether or not it is
   * new (H21 — the draw must not depend on the branch, or one seed stops replaying). That means
   * merely tracking a threat consumes one extra `rng()` call per tick versus not tracking one at
   * all, which shifts every OTHER draw that tick (aim error, blunder, idle fidget, discipline) —
   * so "shot present" vs "shot absent" differs for nearly every seed regardless of whether the
   * dodge mechanism itself ever fires (verified: 60/60 sampled seeds showed a difference either
   * way). That confound would make this assertion pass or fail on an artifact unrelated to
   * dodging. Holding `instances` CONSTANT and instead swapping only `dodgeChance` (real tier value
   * vs a forced 0) keeps every draw aligned tick-for-tick between the two runs, so the ONLY
   * possible source of a difference is the dodge roll itself — the property this test claims to
   * check.
   */
  it("hard changes course for an incoming shot and easy ignores it (H25)", () => {
    const incoming = [{
      id: "shot", ownerSessionId: "them", weaponId: "predator" as const,
      x: 210, y: -400, angle: Math.PI / 2,
    }];
    const steers = (tier: "easy" | "hard", dodgeChance: number) => {
      const profile = {
        ...BOT_PROFILES[tier], dodgeChance, incomingCarChance: 0,
        blunderChance: 0, idleFidgetChance: 0, aimErrorSigmaRad: 0,
      };
      const bot = new HumanController(tier, { profile });
      const rng = makeRng(17);
      const out: number[] = [];
      const still = { ...enemy, speed: 0 };
      for (let tick = 0; tick < 90; tick++) {
        out.push(bot.decide(view(tick, { others: [still], instances: incoming, rng })).steer);
      }
      return out.join(",");
    };

    expect(steers("hard", 1)).not.toBe(steers("hard", 0));
    expect(steers("easy", 0.05)).toBe(steers("easy", 0));
  });

  it("easy burns its ult on a full-hp target and hard does not (H30)", () => {
    // ONE scene, ONE distance, both tiers — which is what makes this measure discipline and nothing
    // else. Read `chooseSlot`'s good-moment test: an ult fires freely when the target is under
    // `ultWindowHpFraction`, stunned, OR inside half its reach, and only the third of those is
    // geometry. So the scene has to hold the bot in the band `(reach/2, reach]` — close enough to
    // shoot, too far to be a good moment — for BOTH tiers at once.
    //
    // TEST FIX (was: Bullseye's `lance` at 450 u for easy and 900 u for hard). `lance` reaches
    // 1200, so its bad-moment band starts at 600 — past easy's 520 u awareness radius, which means
    // no distance exists that easy can both see and treat as a bad moment. The easy half therefore
    // ran at 450 u, INSIDE half-reach: a good moment, where `ULT_WINDOW_BONUS` fires the ult
    // regardless of discipline. Setting easy's `ultDisciplineChance` to hard's 0.9 left the test
    // green — the confound the hard half's own comment names, walked into on the easy half.
    //
    // Mirage's slot 2 (`afterburner`) is the row that fits: an ult by `ultCooldownMs` (13000 ms)
    // with a reach of only 220, so its bad-moment band is (110, 220] — a band every tier can see
    // into. At 200 u both tiers are in range, at full target hp, unstunned, in a bad moment.
    // Verified by mutation, both ways: easy at medium's `ultDisciplineChance` 0.5 stops pressing,
    // and hard at medium's 0.5 starts.
    const ultOnly = (base: BotView["self"]): BotView["self"] => ({
      ...base,
      carId: "mirage",
      slots: slotsFor("mirage").map((slot, i) => (i === 2 ? slot : { ...slot, stocks: 0 })),
    });
    // Seed 12, not the file's usual 17: 17 rolls the `grudge` archetype, which is fine here, but 12
    // (`kiter`, which shifts no firing knob) is the seed under which BOTH halves are sensitive to
    // their own tier's `ultDisciplineChance` moving one rung. Seed choice cannot make a bot press an
    // ult it decided to hold — it only decides which side of a single 0-to-1 roll this run lands.
    //
    // MECHANISM FIX, not a test workaround: `chooseSlot` used to redraw `ultRoll` on EVERY
    // recompute tick rather than once per (target, ready) episode — so "discipline" decayed
    // geometrically (P(never fires) = 0.9^n keeps falling with every extra evaluation; over a real
    // fight's worth of recomputes it is indistinguishable from zero) and hard was CERTAIN to burn
    // the ult eventually no matter how long it took, which is not what "holds it for a stunned or
    // wounded target" means. `chooseSlot` now rolls once when a slot enters a bad-moment episode
    // and reuses that decision — held in `ultHold`, keyed per slot, on the controller — until the
    // moment turns good (fires), the target changes, or the slot is spent and recharges (see the
    // doc on `UltHoldEntry` in firing.ts, and firing.test.ts's own persisted-episode unit test).
    // With that fixed, this can honestly ask the real question over a LONG engagement.
    const BAD_MOMENT_X = 400; // 200 u from the bot at x=200: inside 220, outside 110.
    const ultPressed = (tier: "easy" | "hard", ticks: number) => {
      const bot = new HumanController(tier);
      const rng = makeRng(12);
      let fired = false;
      for (let tick = 0; tick < ticks; tick++) {
        const scene = view(tick, { others: [{ ...enemy, x: BAD_MOMENT_X }], rng });
        const intent = bot.decide({ ...scene, self: ultOnly(scene.self) });
        if (intent.fireSlots === 1 << 2) fired = true;
      }
      return fired;
    };
    expect(ultPressed("easy", 300)).toBe(true);
    expect(ultPressed("hard", 600)).toBe(false);
  });

  it("hard resets when badly hurt and easy fights on (H37)", () => {
    const hurt = (tier: "easy" | "hard") => {
      const bot = new HumanController(tier);
      const rng = makeRng(17);
      for (let tick = 0; tick < 90; tick++) {
        bot.decide(view(tick, {
          others: [enemy],
          self: { ...view(tick).self, hp: 5 },
          rng,
        }));
      }
      return bot.debug()?.situation;
    };
    expect(hurt("hard")).toBe("reset");
    expect(hurt("easy")).not.toBe("reset");
  });

  it("hard focuses the wounded car and easy chases whoever shot at it (H32, H33)", () => {
    // Two scenes, because the two halves are two different claims and a tier can only weigh
    // candidates it can SEE. `awarenessRadiusUnits` is 900 for hard and 520 for easy.
    //
    // Hard's scene: the wounded car is the FAR one (700 u) and the shooter the near one (220 u), so
    // proximity argues for the shooter and only `woundedBias` argues for the wounded — which is the
    // property. Verified by mutation: at medium's `woundedBias` 0.5, hard switches to the shooter.
    const shooter = { ...enemy, sessionId: "shooter", x: 420, y: 360 };
    // A shot of the shooter's, in flight NEAR US: `perceive` blames a car for a shot only when
    // `threatHeading` says the shot is actually coming at us, so a bolt parked next to its owner
    // out at the edge of the arena earns no grudge at all. Its owner is what matters, not where the
    // owner now is.
    const incoming = [{
      id: "s", ownerSessionId: "shooter", weaponId: "predator" as const,
      x: 400, y: 360, angle: Math.PI,
    }];
    expect(run("hard", 120, {
      others: [{ ...enemy, sessionId: "hurt", x: 900, y: 360, hp: 8 }, shooter],
      instances: incoming,
    }).bot.currentTargetSessionId).toBe("hurt");

    // TEST FIX for the easy half. It used to share hard's scene, where the wounded car sits 700 u
    // out — outside easy's 520 u awareness, so easy had exactly ONE candidate and "picked the
    // shooter" no matter what it valued. Mutating easy's `woundedBias` all the way to hard's 0.9
    // left it green. Easy needs its own geometry: BOTH cars inside 520 u, with the wounded car the
    // NEAR one (50 u) and the shooter far (490 u, still shooting at us), so proximity and the
    // wounded bias both argue for the wounded car and only the grudge argues for the shooter.
    // Choosing the shooter there is `vengefulness` and nothing else — verified by mutation: at
    // hard's `vengefulness` 0.25 easy switches to the wounded car.
    //
    // Medium's 0.5 does NOT flip it, and no geometry inside easy's own awareness radius makes it:
    // easy's `woundedBias` of 0.1 caps the wounded term at 0.2 on a score whose proximity and
    // grudge terms span 1.0 and 1.6, so the 0.6-wide gap between easy's 0.8 and medium's 0.5 can
    // only be straddled inside a margin narrower than easy's own `scoreNoiseSigma` of 0.3. A
    // knife-edge scene would pass or fail on which seed it was handed. This is the honest limit of
    // what this assertion covers, stated rather than papered over.
    expect(run("easy", 200, {
      others: [{ ...enemy, sessionId: "hurt", x: 250, y: 360, hp: 8 }, { ...enemy, sessionId: "shooter", x: 690, y: 360 }],
      instances: incoming,
    }).bot.currentTargetSessionId).toBe("shooter");
  });

  it("uses the rest of the kit when the top-value slot is unavailable (H27)", () => {
    // The real property: one bit per press, and the kit actually gets used. The test view holds slot
    // state constant, so with `predator` always loaded it would always out-rank the others and this
    // would prove nothing -- hence taking it out of the bot's hands.
    const withoutPredator = (base: BotView["self"]): BotView["self"] => ({
      ...base,
      slots: base.slots.map((slot, i) => (i === 0 ? { ...slot, stocks: 0 } : slot)),
    });
    const bot = new HumanController("hard");
    const rng = makeRng(17);
    const pressed = new Set<number>();
    for (let tick = 0; tick < 400; tick++) {
      const scene = view(tick, { others: [{ ...enemy, x: 500 }], rng });
      const intent = bot.decide({ ...scene, self: withoutPredator(scene.self) });
      if (intent.fireSlots !== 0) pressed.add(intent.fireSlots);
    }
    expect(pressed.size).toBeGreaterThan(0);
    expect(pressed.has(1 << 0)).toBe(false);
    // Exactly one bit per press, always (H27).
    for (const mask of pressed) expect(mask & (mask - 1)).toBe(0);
  });

  it("a wall changes what hard does and never reaches easy (H39)", () => {
    // Within-tier, and the SCENE is controlled: the enemy sits 200 units directly ahead in both
    // runs, so the relative geometry the bot is fighting is identical and the only thing that
    // differs is how close the wall is. Comparing steer counts across tiers instead would just be
    // measuring `aimToleranceRad`, and comparing two different self positions would just be
    // measuring two different fights.
    //
    // Tail slice, not the full stream: acquire, `situationCommitTicks`, and `reactionDelayTicks`
    // eat the first several dozen output ticks, so an exact-equality comparison over the full 90
    // fails on warm-up even when the wall mechanism itself never fires for easy.
    //
    // `unpin` fires when the wall is inside `wallLookaheadUnits` — hard settles into `"unpin"`
    // near the wall (x=1200) and a fight situation away from it (x=640); easy's 40-unit
    // look-ahead never reaches the wall at either position. `unpin` then steers toward open floor.
    const run2 = (tier: "easy" | "hard", x: number) => {
      const bot = new HumanController(tier);
      const rng = makeRng(17);
      const steer: number[] = [];
      let tailGoal: string | undefined;
      for (let tick = 0; tick < 90; tick++) {
        const scene = view(tick, { others: [{ ...enemy, x: x + 200, y: 360, speed: 0 }], rng });
        steer.push(bot.decide({ ...scene, self: { ...scene.self, x, y: 360, angle: 0 } }).steer);
        if (tick >= 60) tailGoal = bot.debug()?.situation;
      }
      return { steer: steer.slice(60).join(","), tailGoal };
    };
    // Driving at x=1200 puts the far wall (1280) inside hard's 150-unit look-ahead and outside
    // easy's 40-unit one; x=640 is open floor for both.
    const hardNearWall = run2("hard", 1200);
    const hardOpenFloor = run2("hard", 640);
    const easyNearWall = run2("easy", 1200);
    const easyOpenFloor = run2("easy", 640);

    expect(hardNearWall.tailGoal).toBe("unpin");
    expect(hardOpenFloor.tailGoal).not.toBe("unpin");
    expect(easyNearWall.tailGoal).not.toBe("unpin");
    expect(easyOpenFloor.tailGoal).not.toBe("unpin");

    expect(hardNearWall.steer).not.toBe(hardOpenFloor.steer);
    expect(easyNearWall.steer).toBe(easyOpenFloor.steer);
  });

  it("easy closes on a visible target, throttle forward (S13)", () => {
    const { bot, out } = run("easy", 90, { others: [enemy] });
    expect(["close", "fight", "punish", "evade"]).toContain(bot.debug()?.situation);
    const late = out.slice(60);
    expect(late.filter((i) => i.throttle === 1).length).toBeGreaterThan(late.length / 2);
  });

  it("hard Bastion fights then punishes once the stun lands (S13)", () => {
    const bastionOf = (base: BotView["self"]): BotView["self"] => ({
      ...base, carId: "bastion", slots: slotsFor("bastion"),
    });
    const bot = new HumanController("hard");
    const rng = makeRng(17);
    for (let tick = 0; tick < 90; tick++) {
      const scene = view(tick, { others: [enemy], rng });
      bot.decide({ ...scene, self: bastionOf(scene.self) });
    }
    expect(["fight", "close", "unpin", "evade", "punish"]).toContain(bot.debug()?.situation);

    const stunned = {
      ...enemy,
      statuses: [{ statusId: "stunned" as const, startTick: 0, endsTick: 999, sourceSessionId: "me" }],
    };
    for (let tick = 90; tick < 180; tick++) {
      const scene = view(tick, { others: [stunned], rng });
      bot.decide({ ...scene, self: bastionOf(scene.self) });
    }
    expect(bot.debug()?.situation).toBe("punish");
  });

  it("hard sidesteps an incoming shot (S13 evade) compared to dodgeChance 0", () => {
    const incoming = [{
      id: "shot", ownerSessionId: "them", weaponId: "predator" as const,
      x: 210, y: -400, angle: Math.PI / 2,
    }];
    const runDodge = (dodgeChance: number) => {
      const profile = {
        ...BOT_PROFILES.hard, dodgeChance, incomingCarChance: 0,
        blunderChance: 0, idleFidgetChance: 0, aimErrorSigmaRad: 0,
      };
      const bot = new HumanController("hard", { profile });
      const rng = makeRng(17);
      const steer: number[] = [];
      const still = { ...enemy, speed: 0 };
      for (let tick = 0; tick < 90; tick++) {
        const out = bot.decide(view(tick, { others: [still], instances: incoming, rng }));
        steer.push(out.steer);
      }
      return steer.slice(30).join(",");
    };

    expect(runDodge(1)).not.toBe(runDodge(0));
  });

  it("hard fires predator without a HUD lock (S20)", () => {
    const predatorOnly = (base: BotView["self"]): BotView["self"] => ({
      ...base,
      lockTargetSessionId: "",
      slots: slotsFor("bullseye").map((slot, i) => (i === 0 ? slot : { ...slot, stocks: 0 })),
    });
    const fired = (tier: "easy" | "hard") => {
      const bot = new HumanController(tier);
      const rng = makeRng(12);
      let presses = 0;
      for (let tick = 0; tick < 200; tick++) {
        const scene = view(tick, { others: [{ ...enemy, x: 500 }], rng });
        const intent = bot.decide({ ...scene, self: predatorOnly(scene.self) });
        if (intent.fireSlots === 1 << 0) presses++;
      }
      return presses;
    };
    expect(fired("easy")).toBeGreaterThan(0);
    expect(fired("hard")).toBeGreaterThan(0);
  });
});

describe("ladder monotonicity", () => {
  it("presses more shots at a good angle as the tier rises", () => {
    // Count rising edges, not ticks the held mask is still set: Hard's cadence is 2 so a press
    // occupies 2 output ticks, Medium's is 6, and comparing occupancy would credit Medium for
    // holding the button down longer rather than for shooting more often. Stationary target,
    // HUD lock already on — burst gap is the limiter, not a lock-wait veto (S20).
    const sitting = { ...enemy, speed: 0 };
    const presses = (tier: "easy" | "medium" | "hard") => {
      const bot = new HumanController(tier);
      const rng = makeRng(17);
      let n = 0;
      let prev = 0;
      for (let tick = 0; tick < 600; tick++) {
        const scene = view(tick, { others: [sitting], rng });
        const intent = bot.decide({
          ...scene,
          self: { ...scene.self, lockTargetSessionId: "them" },
        });
        if (intent.fireSlots !== 0 && prev === 0) n++;
        prev = intent.fireSlots;
      }
      return n;
    };
    expect(presses("hard")).toBeGreaterThan(presses("medium"));
    expect(presses("medium")).toBeGreaterThan(presses("easy"));
  });
});
