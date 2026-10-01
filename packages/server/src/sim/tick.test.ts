import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import {
  ArenaState,
  DRIVE_CONFIG,
  ManeuverKind,
  MS_PER_TICK,
  TICK_RATE_HZ,
  NEUTRAL_MODIFIERS,
  NET_CONFIG,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  driveOf,
  forwardOf,
  lateralOf,
  toWorld,
  isInputPacket,
  msToTicks,
  newTickInputBuffer,
  stepSim,
  wrapAngle,
  boundsOf,
  getArena,
  ramDefenceOf,
  type CarId,
  type InputFrame,
  type InputKeys,
  type Modifiers,
  type SimBody,
  type TickInputBuffer,
} from "@motor-combat-moba/shared";
import { serverTick } from "./tick.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/**
 * No buffs or debuffs in play. Every expectation in this file is the unbuffed sim, and a
 * `NEUTRAL_MODIFIERS` lookup is what an empty map yields through `modifiersFor`.
 */
const NO_EFFECTS = new Map<string, Modifiers>();

const DT = MS_PER_TICK / 1000;
const UP: InputKeys = { steer: 0, throttle: 1, fireSlots: 0 };
/** Throttle-neutral: the car keeps whatever speed it already had, minus drag. */
const COAST: InputKeys = { steer: 0, throttle: 0, fireSlots: 0 };
const fire = (mask: number, aimAngle?: number): InputKeys =>
  aimAngle === undefined ? { steer: 0, throttle: 0, fireSlots: mask } : { steer: 0, throttle: 0, fireSlots: mask, aimAngle };

/** How many ticks a missing frame repeats the last real input before going neutral (NR22). */
const REPEAT_TICKS = msToTicks(NET_CONFIG.inputRepeatMs);

/** The brief's fixture: one buffer per id, every frame offered against `lastCompletedTick`. */
function buffers(entries: Record<string, InputFrame[]>, lastCompletedTick: number): Map<string, TickInputBuffer> {
  const map = new Map<string, TickInputBuffer>();
  for (const [id, frames] of Object.entries(entries)) {
    const b = newTickInputBuffer();
    for (const f of frames) b.offer(f, lastCompletedTick);
    map.set(id, b);
  }
  return map;
}

/**
 * A room slice across ticks: the state, one `TickInputBuffer` per player that has hands, and the
 * room-owned `prevFireMasks`. `tick` offers each given input for the tick about to run (lead 0, the
 * way a bot does), advances `state.tick`, and runs `serverTick` on it — `ArenaRoom.step`'s order.
 * A player given no input on a tick simply has no frame for it: the buffer's repeat-then-neutral
 * fill is what `serverTick` then runs.
 */
class Rig {
  readonly state: ArenaState;
  readonly buffers = new Map<string, TickInputBuffer>();
  readonly prev = new Map<string, number>();

  constructor(players: PlayerState[], withHands: readonly string[] = players.map((p) => p.sessionId)) {
    this.state = stateWith(...players);
    for (const id of withHands) this.buffers.set(id, newTickInputBuffer());
  }

  /** Offer a frame for `tick` as a client would, judged against the tick the room last completed. */
  offer(id: string, frame: InputFrame): void {
    this.buffers.get(id)!.offer(frame, this.state.tick);
  }

  tick(
    inputs: Record<string, InputKeys> = {},
    phase: RoomPhase = RoomPhase.MATCH,
    mods: ReadonlyMap<string, Modifiers> = NO_EFFECTS,
    dt: number = DT,
  ): ReturnType<typeof serverTick> {
    for (const [id, keys] of Object.entries(inputs)) this.offer(id, { tick: this.state.tick + 1, ...keys });
    this.state.tick += 1;
    return serverTick(this.state, this.buffers, dt, phase, mods, this.prev);
  }

  /** `n` ticks with no frame from anyone. */
  silent(n: number, phase: RoomPhase = RoomPhase.MATCH): void {
    for (let i = 0; i < n; i++) this.tick({}, phase);
  }
}

/** One `stepSim` of a copy of `player`, as `serverTick` would step it alone in `state`'s arena. */
function oneStep(state: ArenaState, player: PlayerState, keys: InputKeys): SimBody {
  const arena = getArena(state.arenaId);
  return stepSim(
    {
      x: player.x, y: player.y, angle: player.angle, vx: player.vx, vy: player.vy, angVel: player.angVel,
      maneuver: player.maneuver, maneuverTicksLeft: player.maneuverTicksLeft,
      maneuverAngle: player.maneuverAngle, maneuverSpeed: player.maneuverSpeed,
    },
    keys,
    DT,
    {
      obstacles: arena.obstacles,
      bounds: boundsOf(arena),
      carId: player.carId as CarId,
      others: [],
      modifiers: NEUTRAL_MODIFIERS,
      selfRamDefence: ramDefenceOf(player.carId as CarId),
    },
  );
}

/**
 * Forward speed after `ticks` of full throttle from rest, under the Unity drive-model port's exact
 * integrator (`stepDrive`'s `commandFactorOf`, drive.ts) — NOT `ticks * engineAccel * DT`. Drag now
 * acts every tick (`accel` is neutral here, so the effective rate is just `dragRate`), so the
 * accumulation is the geometric series `command*factor*(1 + drag + drag^2 + ... + drag^(ticks-1))`,
 * not a linear one; the two agree only in the limit `dragRate -> 0`.
 */
function forwardAfterThrottleTicks(carId: CarId, ticks: number): number {
  const chassis = driveOf(carId);
  const factor = (1 - chassis.dragPerTick) / chassis.dragRate;
  const command = chassis.engineAccel * factor;
  let forward = 0;
  for (let i = 0; i < ticks; i++) forward = forward * chassis.dragPerTick + command;
  return forward;
}

/**
 * A clear east-west corridor in arena-01, for tests that drive straight and never turn far enough
 * to approach a wall or a spike strip. Not a claim that every point at this y is clear at every x —
 * arena-01's spikes (landed 2026-09-11) include a strip on the top wall spanning x 129-310, which a
 * test that curves or loops (see the dedicated centre-spawn spot below) must avoid instead. Moved
 * from 100 with the 2026-09-16 hull resize: it keeps a 10 u clearance under that strip (bottom edge
 * y 74) for a car half-width of 20 (74 + 20 + 10).
 */
const CORRIDOR_Y = 104;

/** Dead centre of arena-01, clear of every wall and every spike by a wide margin on both axes. */
const ARENA_CENTRE_X = 640;
const ARENA_CENTRE_Y = 360;

function makePlayer(
  sessionId: string,
  x: number,
  y: number,
  angle: number,
  status: PlayerStatus = PlayerStatus.IN_MATCH,
  carId: CarId = "mirage",
): PlayerState {
  const p = new PlayerState();
  p.sessionId = sessionId;
  p.x = x;
  p.y = y;
  p.angle = angle;
  p.status = status;
  p.carId = carId;
  return p;
}

/** Seed a state, honouring the given insertion order into the `MapSchema`. */
function stateWith(...players: PlayerState[]): ArenaState {
  const state = new ArenaState();
  for (const p of players) state.players.set(p.sessionId, p);
  return state;
}

function poseOf(player: PlayerState): SimBody {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    vx: player.vx,
    vy: player.vy,
    angVel: player.angVel,
  };
}

describe("serverTick", () => {
  it("drives the car forward on this tick's frame", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const rig = new Rig([player]);

    const { steps } = rig.tick({ p1: UP });

    expect(player.x).toBeGreaterThan(300);
    expect(player.y).toBe(CORRIDOR_Y);
    // RE-PINNED for the Unity drive-model port: `driveOf("mirage").accel` is gone, and the
    // command's contribution is no longer a flat `* DT` — see `forwardAfterThrottleTicks`.
    expect(forwardOf(player.vx, player.vy, player.angle)).toBeCloseTo(forwardAfterThrottleTicks("mirage", 1), 6);
    expect(player.ackRepeated).toBe(false);
    expect(steps.get("p1")).toBe(1);
  });

  it("carries speed forward between ticks, so N ticks of throttle accelerate N times", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const rig = new Rig([player]);

    for (let i = 0; i < 3; i++) rig.tick({ p1: UP });

    // "3 ticks' worth" is the GEOMETRIC accumulation `forwardAfterThrottleTicks` computes, not
    // `3 * (one tick's worth)`: drag acts every tick, so the series is sublinear.
    expect(forwardOf(player.vx, player.vy, player.angle))
      .toBeCloseTo(forwardAfterThrottleTicks("mirage", 3), 6);
  });

  it("steps every car exactly once per tick, however many frames arrived (F1)", () => {
    // state.tick is the tick being simulated; frames for it and five future ticks are buffered.
    const frames = [1, 2, 3, 4, 5, 6].map((t) => ({ tick: t, steer: 0 as const, throttle: 1 as const, fireSlots: 0 }));
    const player = makePlayer("a", 300, CORRIDOR_Y, 0);
    const state = stateWith(player);
    const expected = oneStep(state, player, frames[0]!);
    state.tick = 1;
    const { steps } = serverTick(state, buffers({ a: frames }, 0), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(state.players.get("a")!.x).toBeCloseTo(expected.x, 9);
    expect(state.players.get("a")!.vx).toBeCloseTo(expected.vx, 9);
    expect(steps.get("a")).toBe(1);
  });

  it("a hostile client flooding duplicate and far-future frames still steps exactly once per tick", () => {
    // Five packets a tick, each carrying six frames for the same run of ticks, plus a frame 600
    // ticks ahead. The wire guard refuses a six-frame packet outright; offered straight into the
    // buffer anyway, the duplicates are dropped and the far-future frame is beyond `maxInputLeadMs`,
    // so the car moves exactly as far as an honest client sending one frame a tick.
    const TICKS = 40;
    const flooder = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const honest = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const hostile = new Rig([flooder]);
    const fair = new Rig([honest]);
    for (let i = 0; i < TICKS; i++) {
      const next = hostile.state.tick + 1;
      const packet = { inputs: [0, 1, 2, 3, 4, 5].map((k) => ({ tick: next + k, ...UP })) };
      expect(isInputPacket(packet)).toBe(false);
      for (let p = 0; p < 5; p++) for (const frame of packet.inputs) hostile.offer("p1", frame);
      hostile.offer("p1", { tick: next + 600, ...UP });
      const { steps } = hostile.tick();
      fair.tick({ p1: UP });
      expect(steps.get("p1")).toBe(1);
    }
    expect(poseOf(flooder)).toEqual(poseOf(honest));
    expect(flooder.x).toBeGreaterThan(300);
  });

  it("a car with no input for the tick still steps, on the repeated input, and says so", () => {
    const state = stateWith(makePlayer("a", 300, CORRIDOR_Y, 0));
    state.tick = 1;
    const b = buffers({ a: [] }, 0);
    const { steps } = serverTick(state, b, DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(state.players.get("a")!.ackRepeated).toBe(true);
    expect(steps.get("a")).toBe(1);
  });

  it("leaves a player with no input buffer unchanged and unstepped", () => {
    const handless = makePlayer("missing", 4, 5, 0.2);
    const rig = new Rig([handless], []);

    const { steps } = rig.tick();

    expect(poseOf(handless)).toEqual({ x: 4, y: 5, angle: 0.2, vx: 0, vy: 0, angVel: 0 });
    expect(steps.get("missing")).toBe(0);
  });

  it("takes only this tick's frame, and a later tick's frame waits for its own tick", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const rig = new Rig([player]);
    rig.offer("p1", { tick: 1, ...UP });
    rig.offer("p1", { tick: 2, steer: 1, throttle: 1, fireSlots: 0 });

    const twin = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const twinRig = new Rig([twin]);
    rig.tick();
    twinRig.tick({ p1: UP });
    expect(poseOf(player)).toEqual(poseOf(twin));

    rig.tick();
    twinRig.tick({ p1: { steer: 1, throttle: 1, fireSlots: 0 } });
    expect(poseOf(player)).toEqual(poseOf(twin));
    expect(player.ackRepeated).toBe(false);
  });

  it("reports the buffer's mean input slack on the car (NR21)", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const rig = new Rig([player]);
    // Offered while the room has completed tick 0: frames for ticks 3 and 5 sit 2 and 4 ahead of
    // the next tick to run.
    rig.offer("p1", { tick: 3, ...UP });
    rig.offer("p1", { tick: 5, ...UP });
    rig.tick();
    expect(player.inputSlack).toBeCloseTo(3, 9);
    // ...and their spread (D5 ruling E): slacks 2 and 4, population std 1.
    expect(player.inputSlackStd).toBeCloseTo(1, 6);
  });

  it("integrates with the dt it is given", () => {
    // `chassis.dragPerTick`/`gripPerTick`/`spinPerTick` are baked as PER-TICK factors, so the
    // velocity a throttle press produces is identical whatever `dt` a caller passes; `dt` only turns
    // that velocity into a position. So this checks `serverTick`'s own `dt` reaches the position
    // integration: the position delta scales with it.
    const slow = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const fast = makePlayer("p1", 300, CORRIDOR_Y, 0);

    new Rig([slow]).tick({ p1: UP }, RoomPhase.MATCH, NO_EFFECTS, DT);
    new Rig([fast]).tick({ p1: UP }, RoomPhase.MATCH, NO_EFFECTS, DT * 2);

    expect(forwardOf(fast.vx, fast.vy, fast.angle)).toBeCloseTo(forwardOf(slow.vx, slow.vy, slow.angle), 9);
    expect(fast.x - 300).toBeCloseTo((slow.x - 300) * 2, 6);
  });

  describe("input ordering", () => {
    // Bodies chosen so the order they integrate in genuinely changes the outcome: accelerating and
    // turning before braking does not land where braking first does.
    const BODIES = [
      { steer: 0, throttle: 1 },
      { steer: 1, throttle: 1 },
      { steer: 1, throttle: -1 },
    ] as const;

    function runWith(arrivals: Array<{ body: number; tick: number }>): PlayerState {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      const rig = new Rig([player]);
      for (const { body, tick } of arrivals) rig.offer("p1", { tick, ...BODIES[body]!, fireSlots: 0 });
      for (let i = 0; i < 3; i++) rig.tick();
      return player;
    }

    it("applies frames by the tick they are for, regardless of the order they arrived in", () => {
      // Simulated latency gives every packet its own jittered delay, so this is routine, not exotic.
      const inOrder = runWith([{ body: 0, tick: 1 }, { body: 1, tick: 2 }, { body: 2, tick: 3 }]);
      const arrivedShuffled = runWith([{ body: 2, tick: 3 }, { body: 0, tick: 1 }, { body: 1, tick: 2 }]);

      // Precondition: the fixture really is order-sensitive, so the equality below has teeth.
      const ticksReversed = runWith([{ body: 2, tick: 1 }, { body: 1, tick: 2 }, { body: 0, tick: 3 }]);
      expect(poseOf(ticksReversed)).not.toEqual(poseOf(inOrder));

      expect(poseOf(arrivedShuffled)).toEqual(poseOf(inOrder));
    });
  });

  describe("phase gating", () => {
    for (const phase of [RoomPhase.LOBBY, RoomPhase.CAR_SELECT, RoomPhase.COUNTDOWN] as const) {
      it(`takes the tick's frame without moving in phase ${RoomPhase[phase]}`, () => {
        const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
        const rig = new Rig([player]);

        const { steps } = rig.tick({ p1: UP }, phase);

        expect(poseOf(player)).toEqual({ x: 300, y: CORRIDOR_Y, angle: 0, vx: 0, vy: 0, angVel: 0 });
        expect(player.ackRepeated).toBe(false);
        expect(steps.get("p1")).toBe(0);
      });
    }
  });

  describe("lastSteer / lastThrottle (NR33)", () => {
    it("records the consumed keys for a stepped car", () => {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      new Rig([player]).tick({ p1: { steer: -1, throttle: 1, fireSlots: 0 } });
      expect([player.lastSteer, player.lastThrottle]).toEqual([-1, 1]);
    });

    it("records them for a car that is not stepped, and neutral for a car with no hands", () => {
      const frozen = makePlayer("p1", 300, CORRIDOR_Y, 0);
      new Rig([frozen]).tick({ p1: { steer: 1, throttle: -1, fireSlots: 0 } }, RoomPhase.COUNTDOWN);
      expect([frozen.lastSteer, frozen.lastThrottle]).toEqual([1, -1]);

      const idle = makePlayer("p2", 300, CORRIDOR_Y, 0);
      idle.lastSteer = 1;
      new Rig([idle]).tick({});
      expect([idle.lastSteer, idle.lastThrottle]).toEqual([0, 0]);
    });
  });

  // A mid-match joiner is READY and a knocked-out player is POST_MATCH. Stepping either would drive
  // an off-field car around the arena that real players cannot see in their own collision checks.
  for (const status of [PlayerStatus.READY, PlayerStatus.POST_MATCH] as const) {
    it(`takes a ${PlayerStatus[status]} player's frame during MATCH without moving them`, () => {
      const offField = makePlayer("p1", 300, CORRIDOR_Y, 0, status);
      const rig = new Rig([offField]);

      const { steps } = rig.tick({ p1: UP });

      expect(poseOf(offField)).toEqual({ x: 300, y: CORRIDOR_Y, angle: 0, vx: 0, vy: 0, angVel: 0 });
      expect(offField.ackRepeated).toBe(false);
      expect(steps.get("p1")).toBe(0);
    });
  }

  describe("other cars as colliders", () => {
    /**
     * Far enough for the driver to reach the blocker, not far enough to be near a wall. 60, not 40:
     * the 2026-09-06 vector-drive rework's heavy-car pass cut mirage's accel/top speed (420/7.2 base
     * pair -> 60/1.4, 135/3.7 -> 80/2.2), so 40 ticks (1.33 s) no longer covers the 200 u to the
     * blocker at x=500 — mirage needs ~1.5 s just to reach its new 267 u/s top speed. 60 ticks (2 s)
     * clears 500 with room to spare while still resolving well short of the arena wall. Authored as
     * 2 s of ticks since the 60 Hz flip (a literal 60 was only 1 s there).
     */
    const TICKS = 2 * TICK_RATE_HZ;

    function driveIntoBlocker(
      blockerStatus: PlayerStatus,
      driverCar: CarId = "mirage",
      blockerCar: CarId = "mirage",
    ): PlayerState {
      const driver = makePlayer("a-driver", 300, CORRIDOR_Y, 0, PlayerStatus.IN_MATCH, driverCar);
      const blocker = makePlayer("b-blocker", 500, CORRIDOR_Y, 0, blockerStatus, blockerCar);
      // Only the driver has hands: the blocker has no input buffer at all, so it is never stepped —
      // the "idle blocker" every residual below is measured against.
      const rig = new Rig([driver, blocker], ["a-driver"]);
      for (let i = 0; i < TICKS; i++) rig.tick({ "a-driver": UP });
      return driver;
    }

    it("stops a driver short of another player who is in the match", () => {
      const driver = driveIntoBlocker(PlayerStatus.IN_MATCH);
      expect(driver.x).toBeGreaterThan(300);
      // REPINNED for stage 2 Task 2 (ramDefence-weighted separation): a lone `IN_MATCH` blocker with no
      // input buffer is never itself stepped (`serverTick` takes an input only for a player that has
      // one), so its own `resolveWorld` call -- and its own half of the ramDefence split --
      // never runs. Only the driver's side concedes its `shareOf` the overlap each tick, so the
      // pair's damped steady state (throttle re-driving it in, restitution pushing it back out,
      // exactly the wall equilibrium `step.test.ts`'s "single-step path" case documents) settles a
      // fraction of a unit inside the exact boundary rather than pinned flush to it -- traced at
      // ~452.0663 here, oscillating tick to tick, against the exact-separation value of 452.
      //
      // FINDING 2 fix (stage 2 review): this margin used to be a flat 1 unit, borrowed from
      // `combat.test.ts`'s identically-shaped steady state without re-deriving it for THIS pairing
      // (both cars default to mirage/mirage here) -- 1 unit is ~15x the traced ~0.0663u residual, so
      // it would not have caught a regression that doubled or even quintupled the residual. Pinned
      // here to 0.1 (~1.5x headroom above the traced value): still comfortably clear of floating
      // point noise, but a doubled residual (~0.1326u) now fails.
      //
      // RE-PINNED for stage 1 Task 8 (Unity drive-model port + Task 6's final anchors): this is a
      // straight-line scenario (`UP` never steers), so the mover is `stepDrive`'s new closed-form
      // drag/engine integrator (Task 3) hitting its own equilibrium differently -- the old model's
      // `engineAccel` was a flat clamp-anchored acceleration; the new one is DERIVED so
      // `engineAccel === maxSpeed * dragRate` at the balance point, and the tick-by-tick push profile
      // on the way there is no longer the same shape as the old accel-clamp-and-coast trio. Re-run
      // (this exact scenario, `driveIntoBlocker(IN_MATCH)`, mirage/mirage): traced residual moved
      // 0.0663u -> 0.230962u. 0.35 (~1.5x headroom above the new traced value, same ratio as before)
      // still catches a doubled residual (~0.462u) while giving the new steady state comfortable
      // room.
      //
      // RE-PINNED again for stage 5 Task 5 (2026-09-19, fix round 1, finding 2): the settled 1.5x
      // raise on `baseMaxSpeed`/`speedPerRating` moved the mirage/mirage residual again, to
      // 0.396231u -- NOT a clean 1.5x of the prior 0.230962u (it would be 0.346443u; the actual
      // growth ratio is ~1.716x). That non-uniform growth is the tell that **this residual has no
      // closed-form expression in named `DRIVE_CONFIG`/`RAM_CONFIG` constants to fall back on** --
      // it was checked and rejected, not assumed. What produces it is four things composing through
      // an iterated, discrete-time loop with no algebraic fixed point: `RAM_CONFIG.contactPad` (1)
      // inflating the hull test so contact fires before the hulls geometrically touch;
      // `DRIVE_CONFIG.restitution` (0) making `applyContact` an idempotent velocity projection
      // rather than a bounce, so the "wall equilibrium" `step.test.ts`'s "single-step path" case
      // documents is a damped push-in/push-out balance, not a spring; the ramDefence-weighted
      // `shareOf` split in `resolveWorld`, which here only ever runs on the DRIVER's side (the idle
      // `IN_MATCH` blocker has no input buffer and is never itself stepped, so it never concedes its
      // own half); and `stepDrive`'s drag/engine integrator, which is itself an asymptotic
      // (non-linear) approach to `maxSpeed` rather than a constant closing speed. None of the four
      // reduces this residual to a formula in isolation -- it is a genuinely traced, empirical fixed
      // point of the whole loop, the same as every prior re-pin of this exact line was. Pinned to
      // 0.6, keeping the same ~1.5x headroom ratio this bound has used at every prior retune
      // (0.594347 rounds to 0.6): still comfortably clear of the traced value, but a doubled
      // residual (~0.792u) still fails it.
      //
      // This is the mirage/mirage case only -- see "converges to a residual overlap ..." below for
      // how much worse other roster pairings get, and why that matters for Task 4.
      expect(driver.x + DRIVE_CONFIG.carWidth).toBeLessThanOrEqual(500.6);
    });

    it("converges to a residual overlap that stays bounded across every roster ramDefence pairing, not just mirage/mirage", () => {
      // FINDING 2 (stage 2 review): the test above only ever drives mirage into mirage. The residual
      // this idle-blocker steady state settles at is NOT a constant -- the idle blocker never runs
      // its own `resolveWorld` (see the comment above), so only the driver ever concedes its
      // `shareOf(selfRamDefence, otherRamDefence)`; the smaller that share, the deeper the driver ends up
      // past the exact boundary. Swept here across all 9 ordered chassis pairings so the real worst
      // case is measured, not assumed -- a bastion (900) driving into an idle bullseye (300) takes
      // only `shareOf(900, 300) = 0.25` of the correction each tick and sits roughly 14x deeper than
      // the symmetric mirage/mirage case above.
      //
      // TASK 4 NOTE: under the pre-split full push, a resting/pinned pair ended flush and
      // `mtvBetween` returned `null` on the next tick (touching is not overlap) -- an edge-triggered
      // contact. Under this ramDefence split, a pinned pair like this one holds a NON-NULL MTV every tick
      // while a throttle is held, for as long as the residual below persists (tens of ticks, or
      // indefinitely against a truly idle blocker). Any Task-4 contact detector keyed on "is there
      // currently an overlap" will now fire continuously against a pair that used to report contact
      // once -- this is not a bug in this test, it is a real, documented behaviour change.
      const CARS: readonly CarId[] = ["mirage", "bullseye", "bastion"];
      // Measured worst case (this exact sweep): bastion into bullseye at ~0.9082u. 1.2 leaves
      // headroom without being loose enough to hide a doubled residual (~1.82u).
      //
      // RE-PINNED for stage 1 Task 8, same cause as the mirage/mirage case above (`stepDrive`'s new
      // closed-form drag/engine integrator settles this steady state at a different depth than the
      // old accel-clamp-and-coast model did). Re-swept across all 9 pairings: the worst case is
      // still bastion driving into an idle bullseye, now ~1.336055u (was ~0.9082u). 1.8 keeps the
      // same ~1.35x headroom ratio as the old bound while still failing a doubled residual (~2.67u).
      //
      // RE-SWEPT for stage 5 Task 5 (2026-09-19, fix round 1): the settled 1.5x speed/turn-rate raise
      // moved every pairing's residual again, and NOT proportionally -- the worst case is now mirage
      // driving into an idle bullseye at ~0.660385u (was bastion-into-bullseye at ~1.336055u; that
      // pairing is now ~0.645318u, close behind but no longer the max). 1.8 still comfortably covers
      // it (headroom widened to ~2.7x rather than narrowing), so it is left unchanged rather than
      // tightened -- this test's job is the roster-wide worst case, not per-pairing sensitivity,
      // which is what the mirage/mirage-specific test above is for.
      const MAX_RESIDUAL = 1.8;

      for (const driverCar of CARS) {
        for (const blockerCar of CARS) {
          const driver = driveIntoBlocker(PlayerStatus.IN_MATCH, driverCar, blockerCar);
          const overlap = driver.x + DRIVE_CONFIG.carWidth - 500;
          expect(overlap, `driver=${driverCar} blocker=${blockerCar}`).toBeGreaterThanOrEqual(0);
          expect(overlap, `driver=${driverCar} blocker=${blockerCar}`).toBeLessThan(MAX_RESIDUAL);
        }
      }
    });

    it("does not treat a player who is not in the match as a solid wall", () => {
      const driver = driveIntoBlocker(PlayerStatus.READY);
      expect(driver.x).toBeGreaterThan(500);
    });
  });

  it("steps players in sorted sessionId order, not MapSchema insertion order", () => {
    // Two overlapping cars: resolution is sequential, so who is stepped first changes both poses.
    function run(insertionOrder: "sorted" | "reversed"): SimBody[] {
      const a = makePlayer("aaa", 400, CORRIDOR_Y, 0);
      const b = makePlayer("bbb", 440, CORRIDOR_Y, 0);
      const rig = new Rig(insertionOrder === "sorted" ? [a, b] : [b, a]);
      rig.tick({ aaa: UP, bbb: UP });
      return [poseOf(a), poseOf(b)];
    }

    expect(run("reversed")).toEqual(run("sorted"));
  });

  it("steps each player against the updated poses of the players stepped before them", () => {
    // "aaa" sorts first, so it is stepped while "bbb" still sits at its start pose. It begins
    // overlapping "bbb" and coasts away hard enough to clear it in one tick. "bbb" is then resolved
    // against that *updated* pose, finds nothing in contact, and is never pushed. Resolving
    // everyone against a single pre-loop snapshot would still see "aaa" back at LEADER_X, overlap
    // "bbb", and shove it clear of the stale pose instead.
    const LEADER_X = 400;
    const FOLLOWER_X = 450; // < LEADER_X + carWidth, so the two start overlapping
    // Enough to open a gap in a single tick: 12.5 u of travel per tick (375 u/s at 30 Hz, 750 at
    // 60 Hz), against the 10 u the two start overlapping by.
    const CLEARING_SPEED = 12.5 * TICK_RATE_HZ;

    const leader = makePlayer("aaa", LEADER_X, CORRIDOR_Y, Math.PI);
    Object.assign(leader, toWorld(Math.PI, CLEARING_SPEED, 0));
    const follower = makePlayer("bbb", FOLLOWER_X, CORRIDOR_Y, 0);
    const rig = new Rig([leader, follower]);

    rig.tick({ aaa: COAST, bbb: COAST });

    // The leader really did drive clear, so the follower's contact genuinely depends on which pose
    // it was tested against.
    expect(FOLLOWER_X - LEADER_X).toBeLessThan(DRIVE_CONFIG.carWidth);
    expect(follower.x - leader.x).toBeGreaterThan(DRIVE_CONFIG.carWidth);
    // Untouched: no drive input, and no contact once the leader's updated pose is used.
    expect(follower.x).toBe(FOLLOWER_X);
  });

  describe("ram knock state round-trip", () => {
    // `ram-bridge.test.ts` proves `ramTick` WRITES a knock onto `PlayerState`. Nothing proves the
    // NEXT `serverTick` actually READS it back: `bodyOf`/`writeBody` are the only bridge between the
    // two, and dropping a field from either (e.g. forgetting `vy` in `writeBody`) would be invisible
    // to every other test in this file, all of which use neutral knock state.
    it("carries angVel/vx/vy through bodyOf -> stepDrive -> writeBody: it moves the pose, and the fields round-trip decayed rather than dropped", () => {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      player.angVel = 2;
      player.vx = 120;
      player.vy = -60;
      const rig = new Rig([player]);
      // The round trip needs `reeling` in play to reach the branch that reads `body.angVel` at all:
      // under U16 the ordinary `stepDrive` branch computes `angVel` from steering and reads the
      // incoming value only while a status sets `spinFree`.
      const reeling: ReadonlyMap<string, Modifiers> = new Map([
        ["p1", { ...NEUTRAL_MODIFIERS, spinFree: true, grip: 0.6, immobilised: true, steeringLocked: true, ramBlocked: true }],
      ]);

      // No steer, no throttle: any rotation or translation below comes solely from the knock state.
      rig.tick({ p1: COAST }, RoomPhase.MATCH, reeling);

      const chassis = driveOf("mirage");
      expect(player.angVel).toBeCloseTo(2 * chassis.spinPerTick, 6);
      expect(player.angVel).toBeGreaterThan(0);
      expect(player.angVel).toBeLessThan(2);
      expect(player.angle).not.toBe(0);
      expect(player.x).toBeGreaterThan(300);
      expect(player.y).toBeLessThan(CORRIDOR_Y);

      // vx: one tick of mirage's drag (`reeling`'s grip only scales the LATERAL bleed). vy decays
      // slower than neutral under grip 0.6, but the loose bounds hold either way.
      expect(player.vx).toBeCloseTo(120 * chassis.dragPerTick, 3);
      expect(player.vy).toBeLessThan(0);
      expect(player.vy).toBeGreaterThan(-60);
    });
  });

  describe("maneuver state keeps a silent player moving", () => {
    // A dash is motion applied from OUTSIDE the player's own inputs. A dashing player whose frames
    // stop arriving still steps every tick on the buffer's fill (NR22), so it finishes the dash one
    // tick per tick — never frozen holding it, and never burning more than one tick of it per tick.
    it("keeps stepping a silent player mid-dash, one dash tick per server tick", () => {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      player.maneuver = ManeuverKind.DASH;
      player.maneuverTicksLeft = 8;
      player.maneuverAngle = 0;
      player.maneuverSpeed = 1600;
      const before = player.x;
      const rig = new Rig([player]);

      rig.silent(1);
      expect(player.x).toBeGreaterThan(before);
      expect(player.maneuverTicksLeft).toBe(7);

      rig.silent(2);
      expect(player.maneuverTicksLeft).toBe(5);
    });
  });

  describe("carId fallback", () => {
    function driveOneTickAs(carId: string): PlayerState {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      player.carId = carId;
      new Rig([player]).tick({ p1: UP });
      return player;
    }

    it("drives a pre-reveal player (carId \"\") as the default chassis", () => {
      expect(poseOf(driveOneTickAs(""))).toEqual(poseOf(driveOneTickAs("mirage")));
    });

    it("does not mistake an inherited Object property for a car id", () => {
      // `"constructor" in CAR_TABLE` is true via the prototype chain; looking its stats up yields
      // undefined and NaNs the whole drive step.
      const inherited = driveOneTickAs("constructor");
      expect(Number.isFinite(inherited.x)).toBe(true);
      expect(poseOf(inherited)).toEqual(poseOf(driveOneTickAs("mirage")));
    });
  });
});

describe("serverTick fire mask reporting", () => {
  /** One tick for a fresh player, with `keys` as its frame (or no frame at all when undefined). */
  function tickWith(
    player: PlayerState,
    keys: InputKeys | undefined,
    phase: RoomPhase = RoomPhase.MATCH,
  ): ReturnType<typeof serverTick> {
    return new Rig([player]).tick(keys ? { [player.sessionId]: keys } : {}, phase);
  }

  it("reports a HELD trigger as exactly one press, not one per tick", () => {
    // The whole point of edge detection: `fireSlots` is raw key state, so a player holding the
    // trigger sets the same bit on every input. Only the transition counts.
    const rig = new Rig([makePlayer("p1", 300, CORRIDOR_Y, 0)]);
    const tick = (mask: number) => rig.tick({ p1: fire(mask) }).masks.get("p1");

    expect(tick(0b001)).toBe(0b001); // key goes down: a press
    expect(tick(0b001)).toBeUndefined(); // still held: nothing
    expect(tick(0b001)).toBeUndefined(); // still held: still nothing
    expect(tick(0b000)).toBeUndefined(); // released
    expect(tick(0b001)).toBe(0b001); // pressed again: a second press
  });

  it("a held fire key across a repeated tick fires once", () => {
    const prev = new Map<string, number>();
    const state = stateWith(makePlayer("a", 300, CORRIDOR_Y, 0));
    state.tick = 1;
    const b = buffers({ a: [{ tick: 1, steer: 0, throttle: 0, fireSlots: 2 }] }, 0);
    const r1 = serverTick(state, b, DT, RoomPhase.MATCH, NO_EFFECTS, prev);
    state.tick = 2;
    const r2 = serverTick(state, b, DT, RoomPhase.MATCH, NO_EFFECTS, prev); // tick 2 missing → repeat
    expect(r1.masks.get("a")).toBe(2);
    expect(r2.masks.get("a")).toBeUndefined();
    expect(state.players.get("a")!.ackRepeated).toBe(true);
  });

  it("reads a release that arrives after a repeated tick as a release, so the next press fires", () => {
    const rig = new Rig([makePlayer("p1", 300, CORRIDOR_Y, 0)]);
    expect(rig.tick({ p1: fire(0b010) }).masks.get("p1")).toBe(0b010);
    expect(rig.tick().masks.get("p1")).toBeUndefined(); // missing frame: held key repeated
    expect(rig.tick({ p1: fire(0) }).masks.get("p1")).toBeUndefined(); // the release lands
    expect(rig.tick({ p1: fire(0b010) }).masks.get("p1")).toBe(0b010);
  });

  it("goes neutral after inputRepeatMs of missing frames, releasing a held trigger", () => {
    const rig = new Rig([makePlayer("p1", 300, CORRIDOR_Y, 0)]);
    expect(rig.tick({ p1: fire(0b001) }).masks.get("p1")).toBe(0b001);
    rig.silent(REPEAT_TICKS + 1);
    expect(rig.prev.get("p1")).toBe(0);
    // The owner comes back still holding the key: after the neutral fill that is a new press.
    expect(rig.tick({ p1: fire(0b001) }).masks.get("p1")).toBe(0b001);
  });

  it("counts a second slot pressed while the first is held", () => {
    // Edge detection is per BIT, not per mask: holding slot 1 must not swallow a slot 2 press.
    const rig = new Rig([makePlayer("p1", 300, CORRIDOR_Y, 0)]);
    const tick = (mask: number) => rig.tick({ p1: fire(mask) }).masks.get("p1");

    expect(tick(0b001)).toBe(0b001);
    expect(tick(0b011)).toBe(0b010); // slot 1 still held, slot 2 newly down
  });

  it("reports the slot mask from an input it actually simulated", () => {
    expect(tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), fire(0b001)).masks.get("p1")).toBe(0b001);
  });

  it("masks off bits beyond maxFireSlots", () => {
    // Offered straight into the buffer (the wire guard would refuse this mask): the sim still masks.
    const rig = new Rig([makePlayer("p1", 300, CORRIDOR_Y, 0)]);
    rig.buffers.set("p1", buffers({ p1: [{ tick: 1, ...fire(0b1111_1111) }] }, 0).get("p1")!);
    expect(rig.tick().masks.get("p1")).toBe(0b1111); // three ability slots plus the basic attack (BA15)
  });

  it("lets a press through on the basic attack's bit, and still strips everything above it (BA15)", () => {
    // Hand-rolled wire data: bit 3 is a real slot now, bit 4 never is.
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), fire((1 << 3) | (1 << 4))).masks;
    expect(masks.get("p1")).toBe(1 << 3);
  });

  it("credits only this tick's frame's press, never a later tick's (NR23: no OR-ing across frames)", () => {
    const rig = new Rig([makePlayer("p1", 300, CORRIDOR_Y, 0)]);
    rig.offer("p1", { tick: 1, ...fire(0b001) });
    rig.offer("p1", { tick: 2, ...fire(0b011) });
    expect(rig.tick().masks.get("p1")).toBe(0b001);
    expect(rig.tick().masks.get("p1")).toBe(0b010);
  });

  it("reports nothing for a player outside the match", () => {
    expect(tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), fire(0b001), RoomPhase.COUNTDOWN).masks.size).toBe(0);
  });

  it("ignores a negative or non-integer mask", () => {
    // Below the wire guard, which would refuse both: the sim's own clamp still holds.
    for (const bad of [-5, 1.5]) {
      const rig = new Rig([makePlayer("p1", 300, CORRIDOR_Y, 0)]);
      rig.buffers.set("p1", buffers({ p1: [{ tick: 1, ...fire(bad) }] }, 0).get("p1")!);
      expect(rig.tick().masks.get("p1") ?? 0).toBe(0);
    }
  });

  it("reports nothing when no input carries a fire mask", () => {
    expect(tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), UP).masks.size).toBe(0);
  });

  it("reports nothing when the frame is missing and nothing was held", () => {
    expect(tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), undefined).masks.size).toBe(0);
  });

  it("ignores fire from a player who is not on the field", () => {
    const bystander = makePlayer("p1", 300, CORRIDOR_Y, 0, PlayerStatus.READY);
    expect(tickWith(bystander, fire(0b001)).masks.size).toBe(0);
  });

  it("reports the aimAngle of this tick's input only when it carried a new press", () => {
    const rig = new Rig([makePlayer("p1", 300, CORRIDOR_Y, 0)]);
    expect(rig.tick({ p1: fire(0, 0.1) }).aims.has("p1")).toBe(false); // no press
    expect(rig.tick({ p1: fire(0b010, 0.2) }).aims.get("p1")).toBe(0.2); // the press
    expect(rig.tick({ p1: fire(0b010, 0.3) }).aims.has("p1")).toBe(false); // only held
  });

  it("normalises an absurd finite aimAngle before storing it (final-fixes item 4)", () => {
    // A malformed or hostile client could send anything finite; `wrapAngle` is the one place the
    // sim/client turret code agrees an angle is normalised, so the captured aim must go through it
    // too rather than reach `PlayerState.aimBearing` (and the turret/lead math built on it) raw.
    const { aims } = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), fire(0b010, 1e300));
    const aim = aims.get("p1");
    expect(aim).toBeDefined();
    expect(aim).toBeCloseTo(wrapAngle(1e300), 10);
    expect(aim!).toBeGreaterThan(-Math.PI);
    expect(aim!).toBeLessThanOrEqual(Math.PI);
  });

  it("reports no aim when the pressing input carried none", () => {
    expect(tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), fire(0b010)).aims.has("p1")).toBe(false);
  });

  it("does not carry an earlier press's aim onto a later press that carries none (TR23)", () => {
    const rig = new Rig([makePlayer("p1", 300, CORRIDOR_Y, 0)]);
    expect(rig.tick({ p1: fire(0b010, 0.5) }).aims.get("p1")).toBe(0.5);
    expect(rig.tick({ p1: fire(0b110) }).aims.has("p1")).toBe(false);
  });

  it("names every player who fired, not just the first", () => {
    const rig = new Rig([makePlayer("aaa", 300, CORRIDOR_Y, 0), makePlayer("bbb", 900, CORRIDOR_Y, 0)]);
    const { masks } = rig.tick({ aaa: fire(0b001), bbb: fire(0b001) });
    expect([...masks.keys()].sort()).toEqual(["aaa", "bbb"]);
  });
});

/**
 * A ram writes motion onto its victim from OUTSIDE. It has to integrate whether or not that victim
 * is still sending inputs — otherwise an alt-tabbed, AFK or disconnected player is an immovable wall
 * that no amount of ramming can shift, and the knock written onto them never decays either.
 *
 * Found in playtest: a second browser tab in the background stops sending (rAF throttles hard when
 * hidden). Under NR22 there is no silent-coast branch and no grace window any more: every car steps
 * every tick, and a missing frame is filled with the last real input for `inputRepeatMs`, then with
 * neutral keys. The client replays the same fill (`TickPrediction.replayTarget`), so the fill is
 * lockstep on both halves rather than a server-only step.
 */
describe("serverTick steps a car whose frames have stopped arriving (NR22)", () => {
  /** A rammed car: shoved along its own heading, with spin on it. */
  function knocked(over: Partial<PlayerState> = {}): PlayerState {
    const p = makePlayer("v", 500, 400, 0);
    p.vx = 300;
    p.angVel = 2;
    Object.assign(p, over);
    return p;
  }

  it("repeats the last real input for a missing frame, and flags the tick as repeated", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const twin = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const rig = new Rig([player]);
    const twinRig = new Rig([twin]);
    rig.tick({ p1: UP });
    twinRig.tick({ p1: UP });
    rig.tick();
    twinRig.tick({ p1: UP });
    expect(poseOf(player)).toEqual(poseOf(twin));
    expect(player.ackRepeated).toBe(true);
    expect(twin.ackRepeated).toBe(false);
  });

  it("goes neutral once the frames have been missing for longer than inputRepeatMs", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const twin = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const rig = new Rig([player]);
    const twinRig = new Rig([twin]);
    rig.tick({ p1: UP });
    twinRig.tick({ p1: UP });
    for (let i = 0; i < REPEAT_TICKS + 20; i++) {
      rig.tick();
      twinRig.tick({ p1: i < REPEAT_TICKS ? UP : COAST });
    }
    expect(poseOf(player)).toEqual(poseOf(twin));
  });

  it("moves a knocked silent player on the very first tick — there is no grace window", () => {
    const player = knocked();
    new Rig([player]).silent(1);
    expect(player.x).toBeGreaterThan(500);
    expect(player.ackRepeated).toBe(true);
  });

  it("decays the knock rather than freezing it at full strength", () => {
    const player = knocked();
    new Rig([player]).silent(1);
    expect(player.vx).toBeLessThan(300);
    expect(player.vx).toBeGreaterThan(0);
  });

  it("zeroes a coasting car's angVel on its first stepped tick, and never rotates it", () => {
    // The NO-STATUS case. Under U16 the ordinary `stepDrive` branch computes `angVel` entirely from
    // steering and never reads the incoming `body.angVel` unless a status sets `spinFree`. A player
    // who never sent a frame repeats neutral keys (`steer: 0`), so an injected spin resolves to 0 on
    // the first stepped tick, and `angle` never moves off its start.
    const player = knocked({ vx: 0, vy: 0, angVel: 3 });
    new Rig([player]).silent(1);
    expect(player.angVel).toBe(0);
    expect(player.angle).toBe(0);
  });

  it("coasts a dead-on shove all the way to rest, not to 96% of it", () => {
    const player = knocked({ angVel: 3 });
    const rig = new Rig([player]);
    rig.silent(1);
    expect(Math.hypot(player.vx, player.vy)).toBeLessThan(300);
    expect(player.x).toBeGreaterThan(500);

    rig.silent(600);
    // Exactly 0, not merely small: `stepDrive`'s `atRest` snaps a throttle-free car below
    // `stopEpsilon` to rest, and a resting car on neutral keys then stays put.
    expect(player.vx).toBe(0);
    expect(player.vy).toBe(0);
    expect(player.angVel).toBe(0);
    const restingX = player.x;
    rig.silent(1);
    expect(player.x).toBe(restingX);
  });

  it("leaves a truly resting, unknocked player exactly where it is, however long it is silent", () => {
    const player = makePlayer("v", 500, 400, 0);
    new Rig([player]).silent(REPEAT_TICKS * 3);
    expect(player.x).toBe(500);
    expect(player.vx).toBe(0);
  });

  it("reports no fire mask for a filled tick", () => {
    const rig = new Rig([knocked()]);
    expect(rig.tick().masks.size).toBe(0);
  });

  it("does not step outside MATCH, however long the silence runs", () => {
    const player = knocked();
    new Rig([player]).silent(REPEAT_TICKS * 3, RoomPhase.COUNTDOWN);
    expect(player.x).toBe(500);
  });

  it("does not step a player who is not on the field, however long the silence runs", () => {
    const player = knocked({ status: PlayerStatus.POST_MATCH });
    new Rig([player]).silent(REPEAT_TICKS * 3);
    expect(player.x).toBe(500);
  });

  it("still resolves the silent car against other cars", () => {
    // Shoved straight into a stationary neighbour: it must be pushed clear, not driven through.
    const victim = knocked({ vx: 600 });
    const wall = makePlayer("w", 560, 400, 0);
    new Rig([victim, wall]).silent(5);
    expect(victim.x).toBeLessThan(560 - 40);
  });
});
