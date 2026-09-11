/**
 * The phase's ONE closed-loop duel harness: a `HumanController` flown against a stationary,
 * non-firing target, with the bot's own steering fed back into its own pose through the real
 * `stepDrive`.
 *
 * Test-only. Nothing under `src/index.ts` imports it, so it is never bundled into the server; it
 * lives beside the brain rather than inside a `.test.ts` because two suites need the same fixture
 * and a second hand-rolled copy is how two "identical" harnesses quietly drift apart.
 * `controller.test.ts` (aim-line quality, press willingness) and `tiers.test.ts` (the reported
 * symptoms and the tier ladder) are its two callers.
 *
 * THE `.fixture.ts` SUFFIX IS WHAT SAYS THAT AT THE IMPORT SITE (ruling R-K3, 2026-09-07). This is
 * the only non-shipped module under `packages/server/src/`, and the repo's convention for
 * non-shipped code is a sibling directory (`balance/`, `playtest/`) — but those are runnable
 * harnesses with their own entry points, and this is a helper two test files import. Moving it out
 * of `src/` would put the tsconfig and vitest include paths at risk and buy nothing, since `tsup`'s
 * entry is `src/index.ts` alone and it already never bundles this. The suffix costs nothing and
 * makes the status legible exactly where a future production import would be written.
 *
 * It has two modes, and the difference between them is the whole reason it is one function rather
 * than two:
 *
 * - **Open mode** (`resolveCombat: false`, the default). Nothing is fired for real. The bot's slot
 *   view is held permanently ready, so a press is limited only by the brain's own cadence
 *   (`burstGapTicks`) and never by a weapon cooldown. That is what makes `fireTicks` a measurement
 *   of WILLINGNESS to shoot — the symptom this phase was opened for — uncontaminated by how long
 *   `predator` takes to recharge. `controller.test.ts`'s two canary duels run here.
 * - **Resolved mode** (`resolveCombat: true`). Every press goes through `runCombat` — the same
 *   function `ArenaRoom.tick` calls — so cooldowns, switch locks, volleys, instance flight, hull
 *   tests and damage are the game's own. `presses`, `hits` and `ticks` are only meaningful here,
 *   because only here is there a real shot to land and a real hp bar to empty.
 *
 * TWO COUNTS, NEVER ONE (spec P50's first measurement trap). `HumanController.held` is reused
 * between recomputes, so ONE press decision re-emits its fire bit for up to `recomputeTicks` output
 * ticks — twelve of them on easy against two on hard. Counting ticks that carry a fire bit is
 * therefore counting how long a tier holds the button down, not how often it presses, and comparing
 * that across tiers inflates easy against hard roughly six-fold. `fireTicks` is that occupancy count
 * and is only ever compared WITHIN one tier; `intentPresses` counts rising edges; `presses` counts
 * the `FiredEvent`s combat actually committed. No field ever changes meaning between modes.
 */
import {
  NEUTRAL_MODIFIERS, TICK_RATE_HZ, boundsOf, driveOf, expireStatuses, hasStatus, hpOf,
  newCombatEvents, newFireState, newLockState, runCombat, slotsOf, stepDrive, weaponDamageOf,
  weaponDefOf, type CarId, type CombatEvents, type CombatPlayer, type SimBody, type WeaponInstance,
} from "@motor-combat-moba/shared";
import type { BotCarView, BotInstanceView, BotSlotView, BotView } from "../types.js";
import { makeRng } from "../rng.js";
import { HumanController } from "./controller.js";

const ARENA = { width: 1280, height: 720, obstacles: [] as const };

/** Where the bot starts every duel: mid-arena height, well clear of the far wall, already rolling. */
// `vx: 300, vy: 0` is the car-physics rework's spelling of the old `speed: 300` at `angle: 0` —
// heading +x, so the whole 300 u/s is forward and none of it lateral. Same body, same fixture.
const BOT_START = { x: 200, y: 360, angle: 0, vx: 300, vy: 0 };

export interface DuelOptions {
  tier: "easy" | "medium" | "hard";
  ticks: number;
  /** The dummy's pose. Defaults to 553 units dead ahead, the fixture the canary duels were tuned on. */
  targetPos?: { x: number; y: number };
  /** The SHOOTER's chassis. The dummy is always a `mirage`. */
  chassis?: CarId;
  /** The bot's seeded stream. One `Rng` for the whole run, never one per tick (H21). */
  seed?: number;
  /** Run the real combat pass. See the module doc — this is what makes `presses`/`hits`/`ticks` real. */
  resolveCombat?: boolean;
  /**
   * Restore the dummy to full hp after every combat tick, so it never actually dies.
   *
   * Only meaningful with `resolveCombat`. A training dummy rather than an opponent: a hit-rate
   * comparison across tiers has to give every tier the SAME number of ticks of opportunity, and a
   * hard bot that kills the target at tick 449 would otherwise be measured over two thirds of the
   * window an easy bot got.
   */
  immortalTarget?: boolean;
}

export interface DuelResult {
  /**
   * Ticks whose emitted intent carried ANY fire bit. Occupancy, NOT presses — see the module doc.
   * Comparable within one tier and meaningless across tiers.
   */
  fireTicks: number;
  /** Rising edges of the emitted fire mask: what the brain actually decided to press. */
  intentPresses: number;
  /**
   * Presses combat committed (`FiredEvent`s, one per trigger regardless of weapon kind — B30).
   * 0 without `resolveCombat`, because nothing was fired for real.
   */
  presses: number;
  /** Committed presses that landed at least one point of damage. `stats.ts`'s own definition. */
  hits: number;
  /** `hits / presses`, or 0 when nothing was pressed. */
  hitRate: number;
  /**
   * Ticks the run took: the tick the dummy died on, plus one, or the full `ticks` if it lived.
   * Always the full `ticks` under `immortalTarget`, which has no death to end on.
   */
  ticks: number;
  /** Whether the dummy died. Always `false` under `immortalTarget` — see `runDuel`. */
  killed: boolean;
  /** Mean absolute heading error to the target over the last 100 ticks: is the body on the aim line. */
  meanOffset: number;
  /** Every combat event the run produced, for a caller that wants a breakdown. Empty in open mode. */
  events: CombatEvents;
}

/**
 * Best SUSTAINED single-slot damage per second this chassis can put on one target, read from the
 * same tables `npm run ttk` reads: `max over slots of (damage * pellets) / cooldownSeconds`.
 *
 * The denominator of a theoretical time-to-kill floor. Deliberately single-slot and deliberately
 * ignores flight time, hit chance, beam ticking and weapon switching — a floor is meant to be
 * unreachable, and pinning a measured kill as a MULTIPLE of it is what lets a weapon retune move
 * both sides of the assertion together instead of breaking it.
 */
export function bestSustainedDpsOf(carId: CarId): number {
  let best = 0;
  for (const weaponId of slotsOf(carId)) {
    const def = weaponDefOf(weaponId);
    const pellets = def.kind === "projectile" ? def.pellets.pelletsPerVolley : 1;
    best = Math.max(best, (weaponDamageOf(carId, weaponId) * pellets) / (def.cooldownMs / 1000));
  }
  return best;
}

/**
 * The most presses this kit could possibly commit in `ticks`, at this cadence.
 *
 * The binding constraint of TWO, whichever is smaller: the brain's own `burstGapTicks`, and the sum
 * over slots of how often each weapon comes back off cooldown. Which one binds depends on the tier
 * and the kit and is not a constant — at hard's cadence of 3 a Bullseye could press 100 times in
 * 300 ticks, but its three cooldowns between them only come back about 16 times, so the KIT is the
 * limiter and a bar derived from the cadence alone would be unreachable by a factor of six.
 *
 * FOR RESOLVED-MODE RUNS ONLY (R-D4). The cooldown limiter is unconditional here, and OPEN mode has
 * no cooldowns at all — it pins every slot permanently ready — so in that mode this returns a
 * ceiling below the real one whenever the kit half binds. Every caller today measures a resolved
 * run; a future open-mode caller wants `ticks / burstGapTicks` on its own.
 */
export function pressCeilingOf(carId: CarId, ticks: number, burstGapTicks: number): number {
  const seconds = ticks / TICK_RATE_HZ;
  let fromCooldowns = 0;
  for (const weaponId of slotsOf(carId)) fromCooldowns += seconds / (weaponDefOf(weaponId).cooldownMs / 1000);
  return Math.min(ticks / burstGapTicks, fromCooldowns);
}

function combatant(sessionId: string, carId: CarId, team: 0 | 1, x: number, y: number, angle: number): CombatPlayer {
  return {
    sessionId, x, y, angle, team, carId, hp: hpOf(carId), alive: true, inRoster: true,
    fireMask: 0, fireState: newFireState(carId, 1), lock: newLockState(), statuses: [],
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
    maneuverWeaponId: "", maneuverPressId: "", lastDamagerSessionId: "",
  };
}

function instanceView(instance: WeaponInstance): BotInstanceView {
  return {
    id: instance.id, ownerSessionId: instance.ownerSessionId, weaponId: instance.weaponId,
    x: instance.x, y: instance.y, angle: instance.angle,
  };
}

export function runDuel(opts: DuelOptions): DuelResult {
  const chassis = opts.chassis ?? "bullseye";
  const resolveCombat = opts.resolveCombat ?? false;
  const targetPos = opts.targetPos ?? { x: 753, y: 360 };
  const bot = new HumanController(opts.tier);
  // ONE `Rng` for the whole run, created outside the loop and threaded into every tick's view —
  // mirroring production, where a bot's stream is persistent for the room's lifetime. Reseeding per
  // tick replays the same draw at the same position every tick, freezing every probabilistic roll
  // into one coin flip (H21).
  const rng = makeRng(opts.seed ?? 17);
  const events = newCombatEvents();

  let body: SimBody = {
    ...BOT_START, reverseHold: 0, angVel: 0,
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
  };
  let me = combatant("me", chassis, 0, body.x, body.y, body.angle);
  let them = combatant("them", "mirage", 1, targetPos.x, targetPos.y, Math.PI);
  let instances: readonly WeaponInstance[] = [];
  let instanceSeq = 0;
  let killedAtTick = -1;

  let fireTicks = 0;
  let intentPresses = 0;
  let previousMask = 0;
  const offsets: number[] = [];

  for (let tick = 0; tick < opts.ticks; tick++) {
    // Open mode holds every slot permanently ready — see the module doc. Resolved mode reads the
    // real `FireState` back, exactly as `buildBotView` does in a live room.
    const slots: BotSlotView[] = me.fireState.slots.map((slot) => ({
      weaponId: slot.weaponId,
      stocks: resolveCombat ? slot.stocks : 1,
      rechargeEndsTick: resolveCombat ? slot.rechargeEndsTick : 0,
      refireLockUntilTick: resolveCombat ? slot.refireLockUntilTick : 0,
      range: weaponDefOf(slot.weaponId).range,
    }));
    const dummy: BotCarView = {
      sessionId: them.sessionId, carId: "mirage", team: 1,
      x: them.x, y: them.y, angle: them.angle, vx: 0, vy: 0,
      hp: them.hp, maxHp: hpOf("mirage"), alive: them.alive,
      phased: hasStatus(them.statuses, "phased", tick), statuses: them.statuses, maneuver: 0,
    };
    const view: BotView = {
      tick,
      self: {
        sessionId: "me", carId: chassis, team: 0,
        x: body.x, y: body.y, angle: body.angle, vx: body.vx, vy: body.vy,
        hp: me.hp, maxHp: hpOf(chassis), alive: me.alive, statuses: me.statuses, slots,
        switchLockUntilTick: resolveCombat ? me.fireState.switchLockUntilTick : 0,
        lockTargetSessionId: resolveCombat ? me.lock.targetSessionId : "",
        maneuver: 0, maneuverTicksLeft: 0,
      },
      others: them.alive ? [dummy] : [],
      instances: resolveCombat ? instances.map(instanceView) : [],
      arena: { ...ARENA, obstacles: [] },
      // The dummy never fires, so there is never anything to have heard.
      observedFires: [],
      rng,
    };
    const intent = bot.decide(view);

    if (intent.fireSlots !== 0) fireTicks += 1;
    if (intent.fireSlots !== 0 && previousMask === 0) intentPresses += 1;
    previousMask = intent.fireSlots;

    const bearing = Math.atan2(them.y - body.y, them.x - body.x);
    offsets.push(Math.abs(Math.atan2(Math.sin(bearing - body.angle), Math.cos(bearing - body.angle))));

    body = stepDrive(
      body,
      { seq: tick, steer: intent.steer, throttle: intent.throttle, fireSlots: 0 },
      1 / TICK_RATE_HZ,
      driveOf(chassis),
      NEUTRAL_MODIFIERS,
    );

    if (!resolveCombat) continue;

    // Drive first, then combat, exactly as `runPipeline` orders them: a hit test reads the pose the
    // car actually ended the tick at.
    me = {
      ...me, x: body.x, y: body.y, angle: body.angle, fireMask: intent.fireSlots,
      statuses: expireStatuses([...me.statuses], tick),
    };
    them = { ...them, fireMask: 0, statuses: expireStatuses([...them.statuses], tick) };
    const out = runCombat({
      world: {
        tick, dt: 1 / TICK_RATE_HZ, mode: "ffa", obstacles: [],
        bounds: boundsOf(ARENA),
      },
      players: [me, them],
      instances,
      instanceSeq,
      events,
    });
    instances = out.instances;
    instanceSeq = out.instanceSeq;
    me = out.players.find((p) => p.sessionId === "me") ?? me;
    them = out.players.find((p) => p.sessionId === "them") ?? them;
    // NOT RECORDED UNDER `immortalTarget` (R-D3). The restore below happens after `runCombat`, so a
    // dummy that hit zero hp on some tick would otherwise leave `killed: true` and a tick count
    // behind while the loop ran on to the full `ticks` — `DuelResult` documents both fields as
    // describing a run that ENDED, and an immortal run never does. No caller reads them in this
    // mode today; this is what keeps that from becoming a trap for one that does.
    if (!opts.immortalTarget && !them.alive && killedAtTick < 0) killedAtTick = tick;
    if (opts.immortalTarget) them = { ...them, hp: hpOf("mirage"), alive: true };
    else if (!them.alive) break;
  }

  // A press counts as connecting when ANY damage event names its `pressId` — the same definition
  // `balance/stats.ts` uses, which is what makes a pellet fan, a burst and a lingering beam each
  // count once (B30).
  const fired = events.fired.filter((event) => event.shooterSessionId === "me");
  const connected = new Set<string>();
  for (const event of events.damaged) {
    if (event.attackerSessionId !== "me") continue;
    if (event.source.kind === "weapon" || event.source.kind === "contact") connected.add(event.source.pressId);
  }
  const hits = fired.filter((event) => connected.has(event.pressId)).length;
  const tail = offsets.slice(-100);

  return {
    fireTicks,
    intentPresses,
    presses: fired.length,
    hits,
    hitRate: fired.length > 0 ? hits / fired.length : 0,
    ticks: killedAtTick >= 0 ? killedAtTick + 1 : opts.ticks,
    killed: killedAtTick >= 0,
    meanOffset: tail.length > 0 ? tail.reduce((a, b) => a + b, 0) / tail.length : 0,
    events,
  };
}
