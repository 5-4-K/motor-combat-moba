import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE, NEUTRAL_MODIFIERS, TICK_RATE_HZ, fireSlotsOf, installMode, modeConfigOf,
  weaponDefOf, wrapAngle,
} from "@motor-combat-moba/shared";
import { RESOLVED_BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotIntent, BotView } from "../types.js";
import { signedDelta } from "./aim.js";
import { HumanController } from "./controller.js";
import { searchWaypoint } from "./perception.js";
import { bodyFromSelf, rollForward } from "./predict.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));
// Also installed at module scope: the helpers below read config while the suite is collected.
installMode(modeConfigOf(DEFAULT_GAME_MODE));

/** A hard Bullseye mid-arena, every fire slot (index 0 is the basic attack) ready. */
function view(tick: number, overrides: Partial<BotView> = {}): BotView {
  return {
    tick,
    self: {
      sessionId: "me", carId: "bullseye", team: 0,
      x: 200, y: 360, angle: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, alive: true,
      statuses: [],
      slots: fireSlotsOf("bullseye").map((weaponId) => ({
        weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0, range: weaponDefOf(weaponId).range,
      })),
      switchLockUntilTick: 0,
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

/** A stationary, unhurt opponent on the bot's own line, facing it. */
const enemy: BotCarView = {
  sessionId: "them", carId: "mirage", team: 1,
  x: 600, y: 360, angle: Math.PI, vx: 0, vy: 0, hp: 100, maxHp: 100,
  alive: true, phased: false, statuses: [], maneuver: 0,
};

const COAST = { steer: 0, throttle: 0, fireSlots: 0 } as const;

describe("HumanController v7", () => {
  it("coasts while recovering", () => {
    const bot = new HumanController("hard");
    const rng = makeRng(1);
    let out: BotIntent = COAST;
    for (let tick = 0; tick < 30; tick++) out = bot.decide(view(tick, { self: { ...view(0).self, alive: false }, rng }));
    expect(out).toEqual(COAST);
    expect(bot.debug()?.situation).toBe("recover");
  });

  it("hunts: turns toward a waypoint 150° behind it and drives (G12, BB62)", () => {
    const bot = new HumanController("hard");
    const rng = makeRng(1);
    const arena = view(0).arena;
    const waypoint = searchWaypoint(0, arena);
    // Start 400 u from the first search waypoint, on its arena-centre side, at rest, with the
    // waypoint 150° off the nose.
    const toCentre = Math.atan2(arena.height / 2 - waypoint.y, arena.width / 2 - waypoint.x);
    const bearing0 = toCentre + Math.PI;
    let self = {
      ...view(0).self,
      x: waypoint.x + Math.cos(toCentre) * 400, y: waypoint.y + Math.sin(toCentre) * 400,
      angle: wrapAngle(bearing0 + (5 * Math.PI) / 6), vx: 0, vy: 0,
    };
    expect(Math.abs(signedDelta(self.angle, bearing0))).toBeCloseTo((5 * Math.PI) / 6, 6);
    let body = bodyFromSelf(self);
    let last: BotIntent = COAST;
    for (let tick = 0; tick < 2 * TICK_RATE_HZ; tick++) {
      last = bot.decide(view(tick, { self, rng }));
      body = rollForward(body, "bullseye", { steer: last.steer, throttle: last.throttle }, 1, NEUTRAL_MODIFIERS).at(-1)!;
      self = { ...self, x: body.x, y: body.y, angle: body.angle, vx: body.vx, vy: body.vy };
    }
    const bearing = Math.atan2(waypoint.y - self.y, waypoint.x - self.x);
    expect(Math.abs(signedDelta(self.angle, bearing))).toBeLessThan(Math.PI / 6);
    expect(last.throttle).toBe(1);
    expect(bot.debug()?.situation).toBe("waitOut");
  });

  it("fights: fires a turret slot with a bearing at a target in reach", () => {
    const bot = new HumanController("hard");
    const rng = makeRng(1);
    // 20° off the nose, 250 u out: inside predator's turret arc, outside the fixed-muzzle lance's
    // line, so the press has to be the turret's (dead ahead, the lance outdamages it and wins).
    const off = { x: 200 + Math.cos(0.35) * 250, y: 360 + Math.sin(0.35) * 250 };
    let fired = 0;
    for (let tick = 0; tick < 120; tick++) {
      const out = bot.decide(view(tick, { others: [{ ...enemy, ...off, vx: 0 }], rng }));
      if (out.fireSlots !== 0) {
        fired += 1;
        expect(weaponDefOf(fireSlotsOf("bullseye")[Math.log2(out.fireSlots)]!).turret).toBeDefined();
        expect(out.aimAngle).toBeDefined();
      }
    }
    expect(fired).toBeGreaterThan(0);
    expect(bot.debug()?.situation).toBe("fight");
  });

  it("rams when the kit is dry inside ram range (BB21)", () => {
    const bot = new HumanController("hard");
    const rng = makeRng(1);
    const dry = view(0).self.slots.map((s) => ({ ...s, stocks: 0, rechargeEndsTick: 10_000 }));
    let out: BotIntent = COAST;
    for (let tick = 0; tick < 60; tick++) out = bot.decide(view(tick, { self: { ...view(0).self, slots: dry }, others: [{ ...enemy, x: 500, vx: 0 }], rng }));
    expect(bot.debug()?.situation).toBe("ram");
    expect(out.throttle).toBe(1);
  });

  it("draws rng only in the aim error and the predictor (BB14)", () => {
    const bot = new HumanController("hard");
    let draws = 0;
    const rng = () => { draws += 1; return 0.5; };
    const cadence = RESOLVED_BOT_PROFILES.hard.recomputeTicks;
    const ticks = cadence * 3;
    for (let tick = 0; tick < ticks; tick++) bot.decide(view(tick, { others: [{ ...enemy, x: 450, vx: 0 }], rng }));
    // 2 per tick (aim error, Box-Muller) + 4 per recompute (the predictor's two gaussians).
    expect(draws).toBe(2 * ticks + 4 * Math.ceil(ticks / cadence));
  });
});
