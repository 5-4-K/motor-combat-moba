/**
 * The open-loop scene `tiers.test.ts`, `playtest/bot/tiers.ts`, `brain.bench.test.ts` and
 * `controller.test.ts` share (the last
 * starts the car at rest): a Bullseye mid-arena with every fire slot ready, and a Mirage opponent on
 * its line. "Open loop" means nothing moves — the
 * caller hands the bot the same pose every tick — so a test controls the geometry exactly.
 *
 * Test-only. Not imported by anything the server ships.
 */
import {
  fireSlotsOf, forwardMaxSpeedOf, weaponDefOf, type CarId,
} from "@motor-combat-moba/shared";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSlotView, BotView } from "../types.js";

/**
 * Every FIRE slot of a chassis, loaded and ready: index 0 is the basic attack (disabled in every
 * shipped mode, so the bot never presses it), abilities at 1..3.
 */
export function fireSlotsFor(carId: CarId): BotSlotView[] {
  return fireSlotsOf(carId).map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0, range: weaponDefOf(weaponId).range,
  }));
}

/** A Bullseye at (200, 360) facing +x at its own top speed, unhurt, every fire slot ready. */
export function view(tick: number, over: Partial<BotView> = {}): BotView {
  return {
    tick,
    self: {
      sessionId: "me",
      carId: "bullseye",
      team: 0,
      x: 200,
      y: 360,
      angle: 0,
      vx: forwardMaxSpeedOf("bullseye"),
      vy: 0,
      hp: 65,
      maxHp: 65,
      alive: true,
      statuses: [],
      slots: fireSlotsFor("bullseye"),
      switchLockUntilTick: 0,
      maneuver: 0,
      maneuverTicksLeft: 0,
    },
    others: [],
    instances: [],
    arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [],
    rng: makeRng(17),
    ...over,
  };
}

/**
 * A Mirage 500 u dead ahead, facing the bot and drawn at its own top speed toward it. Callers that
 * want a stationary car override `vx: 0`. The open-loop view never moves it, so the velocity is
 * only what the bot's predictor reads. A factory, not a constant: the speed is a config read, and
 * a module-scope read would run before any mode is installed.
 */
export function enemy(): BotCarView {
  return {
    sessionId: "them",
    carId: "mirage",
    team: 1,
    x: 700,
    y: 360,
    angle: Math.PI,
    vx: -forwardMaxSpeedOf("mirage"),
    vy: 0,
    hp: 70,
    maxHp: 70,
    alive: true,
    phased: false,
    statuses: [],
    maneuver: 0,
  };
}
