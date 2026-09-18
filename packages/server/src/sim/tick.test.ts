import { describe, expect, it } from "vitest";
import {
  ArenaState,
  DRIVE_CONFIG,
  ManeuverKind,
  MS_PER_TICK,
  NEUTRAL_MODIFIERS,
  NET_CONFIG,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  driveOf,
  forwardOf,
  lateralOf,
  toWorld,
  type CarId,
  type InputMessage,
  type Modifiers,
  type SimBody,
} from "@motor-combat-moba/shared";
import { serverTick } from "./tick.js";

/**
 * No buffs or debuffs in play. Every expectation in this file is the unbuffed sim, and a
 * `NEUTRAL_MODIFIERS` lookup is what an empty map yields through `modifiersFor`.
 */
const NO_EFFECTS = new Map<string, Modifiers>();

const DT = MS_PER_TICK / 1000;
const UP: InputMessage = { seq: 1, steer: 0, throttle: 1, fireSlots: 0 };

/**
 * How many consecutive empty-queue ticks `serverTick` waits out before it will coast a player.
 *
 * Derived the same way the production code derives it, from `dt` — a literal here would pin the
 * suite to 30 Hz and to today's grace at once.
 */
const GRACE_TICKS = Math.ceil(NET_CONFIG.silentCoastGraceMs / (DT * 1000));

/**
 * `n` ticks with no input at all for anyone, against ONE silence counter.
 *
 * The shared map is the whole point: `serverTick`'s silence run only accumulates because the room
 * owns that map across ticks, and a fresh one per call would mean the grace never elapses and no
 * coast ever happens. Every case in this file that does not care about the coast passes a throwaway
 * map inline, which is exactly equivalent to a player who has just spoken.
 */
function goSilent(
  state: ArenaState,
  n: number,
  silence: Map<string, number> = new Map<string, number>(),
  phase: RoomPhase = RoomPhase.MATCH,
): Map<string, number> {
  for (let i = 0; i < n; i++) serverTick(state, new Map(), DT, phase, NO_EFFECTS, new Map(), silence);
  return silence;
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
  p.lastProcessedInputSeq = 0;
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

function ups(...seqs: number[]): InputMessage[] {
  return seqs.map((seq) => ({ seq, steer: 0, throttle: 1, fireSlots: 0 }));
}

/** Throttle-neutral inputs: the car keeps whatever speed it already had, minus drag. */
function coasts(...seqs: number[]): InputMessage[] {
  return seqs.map((seq) => ({ seq, steer: 0, throttle: 0, fireSlots: 0 }));
}

describe("serverTick", () => {
  it("drives the car forward and empties the queue", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const state = stateWith(player);
    const queues = new Map<string, InputMessage[]>([["p1", [{ ...UP, seq: 7 }]]]);

    serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());

    expect(player.x).toBeGreaterThan(300);
    expect(player.y).toBe(CORRIDOR_Y);
    // RE-PINNED for the Unity drive-model port: `driveOf("mirage").accel` is gone, and the
    // command's contribution is no longer a flat `* DT` — see `forwardAfterThrottleTicks`.
    expect(forwardOf(player.vx, player.vy, player.angle)).toBeCloseTo(forwardAfterThrottleTicks("mirage", 1), 6);
    expect(player.lastProcessedInputSeq).toBe(7);
    expect(queues.get("p1")).toEqual([]);
  });

  it("carries speed forward between inputs, so N queued inputs accelerate N times", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const state = stateWith(player);
    const queues = new Map<string, InputMessage[]>([["p1", ups(1, 2, 3)]]);

    serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());

    // Would be a single tick's worth if `vx`/`vy` were only written back after the last input —
    // and, since the Unity drive-model port, "3 ticks' worth" is the GEOMETRIC accumulation
    // `forwardAfterThrottleTicks` computes, not `3 * (one tick's worth)`: drag now acts every
    // tick, so the series is sublinear (each tick's drag-decay makes the previous ticks' gains
    // worth slightly less), and `toEqual`-checking against a literal `3x` would be re-asserting
    // the pre-port flat-Euler model this whole task replaced.
    expect(forwardOf(player.vx, player.vy, player.angle))
      .toBeCloseTo(forwardAfterThrottleTicks("mirage", 3), 6);
  });

  it("leaves a player with an empty or missing queue unchanged", () => {
    const emptyQ = makePlayer("empty", 1, 2, 0.1);
    emptyQ.lastProcessedInputSeq = 3;
    const missingQ = makePlayer("missing", 4, 5, 0.2);
    missingQ.lastProcessedInputSeq = 4;
    const state = stateWith(emptyQ, missingQ);

    const queues = new Map<string, InputMessage[]>([["empty", []]]);

    serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());

    expect(poseOf(emptyQ)).toEqual({
      x: 1,
      y: 2,
      angle: 0.1,
      vx: 0,
      vy: 0,
      angVel: 0,
    });
    expect(emptyQ.lastProcessedInputSeq).toBe(3);
    expect(poseOf(missingQ)).toEqual({
      x: 4,
      y: 5,
      angle: 0.2,
      vx: 0,
      vy: 0,
      angVel: 0,
    });
    expect(missingQ.lastProcessedInputSeq).toBe(4);
  });

  it("sets lastProcessedInputSeq to the last seq applied when multiple messages are queued", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const state = stateWith(player);
    const queues = new Map<string, InputMessage[]>([
      [
        "p1",
        [
          { seq: 1, steer: 0, throttle: 0, fireSlots: 0 },
          { seq: 2, steer: 1, throttle: 0, fireSlots: 0 },
          { seq: 5, steer: 0, throttle: 1, fireSlots: 0b001 },
        ],
      ],
    ]);

    serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());

    expect(player.lastProcessedInputSeq).toBe(5);
    expect(queues.get("p1")).toEqual([]);
  });

  it("integrates with the dt it is given", () => {
    // CHANGED by the Unity drive-model port's exact-integrator ruling, and in a more structural
    // way than "the numbers moved": `chassis.dragPerTick`/`gripPerTick`/`spinPerTick` are baked as
    // PER-TICK factors (`perTickDecay`, at module load, against `TICK_RATE_HZ`) rather than
    // per-second rates re-applied against whatever `dt` a caller passes — that is the whole point
    // of resolving them onto `ChassisDrive` once (Task 8's 30-vs-60Hz proof rebuilds a NEW chassis
    // for the other rate; it does not feed one chassis a different `dt`). One consequence: the
    // velocity `stepDrive` produces from a throttle press is now IDENTICAL regardless of the `dt`
    // argument (measured: bit-identical `forwardOf` for `DT` and `DT * 2` here) — `dt` only still
    // matters for turning THAT velocity into a position (`x += v.vx * dt`), which is what this case
    // now checks: `serverTick`'s own `dt` parameter really does reach that integration step, via
    // the position delta scaling with it, rather than via the old (and now false) claim that the
    // velocity itself scales with `dt`.
    const slow = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const fast = makePlayer("p1", 300, CORRIDOR_Y, 0);

    serverTick(stateWith(slow), new Map([["p1", ups(1)]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());
    serverTick(stateWith(fast), new Map([["p1", ups(1)]]), DT * 2, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());

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

    const at = (body: number, seq: number): InputMessage => ({ ...BODIES[body]!, seq, fireSlots: 0 });

    function runWith(queue: InputMessage[]): PlayerState {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      serverTick(stateWith(player), new Map([["p1", queue]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());
      return player;
    }

    it("applies inputs in seq order regardless of the order they arrived in", () => {
      // Simulated latency gives every packet its own jittered delay, so this is routine, not exotic.
      const inOrder = runWith([at(0, 1), at(1, 2), at(2, 3)]);
      const arrivedShuffled = runWith([at(2, 3), at(0, 1), at(1, 2)]);

      // Precondition: the fixture really is order-sensitive, so the equality below has teeth.
      const seqsReversed = runWith([at(2, 1), at(1, 2), at(0, 3)]);
      expect(poseOf(seqsReversed)).not.toEqual(poseOf(inOrder));

      expect(poseOf(arrivedShuffled)).toEqual(poseOf(inOrder));
      // Acking the last *arrival* would leave this at 2 while seq 3 had already been applied, and
      // Task 4's reconcile would then replay inputs the server has already integrated.
      expect(arrivedShuffled.lastProcessedInputSeq).toBe(3);
    });
  });

  it("applies at most maxInputsPerTick inputs, but still drains and acks the whole burst", () => {
    const cap = NET_CONFIG.maxInputsPerTick;
    const burst = cap * 4;

    const flooder = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const floodQueue = ups(...Array.from({ length: burst }, (_, i) => i + 1));
    serverTick(stateWith(flooder), new Map([["p1", floodQueue]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());

    const honest = makePlayer("p1", 300, CORRIDOR_Y, 0);
    serverTick(
      stateWith(honest),
      new Map([["p1", ups(...Array.from({ length: cap }, (_, i) => i + 1))]]),
      DT,
      RoomPhase.MATCH,
      NO_EFFECTS,
      new Map(),
      new Map(),
    );

    // Flooding buys no distance *beyond the cap*: both clients here send `maxInputsPerTick`, so
    // this pins the ceiling rather than comparing a flooder against an honest client.
    expect(poseOf(flooder)).toEqual(poseOf(honest));
    expect(flooder.x).toBeGreaterThan(300);
    // ...but the whole burst is drained and acked, so the queue cannot grow and the client's
    // pending-input buffer still clears.
    expect(floodQueue).toEqual([]);
    expect(flooder.lastProcessedInputSeq).toBe(burst);
  });

  describe("phase gating", () => {
    for (const phase of [RoomPhase.LOBBY, RoomPhase.CAR_SELECT, RoomPhase.COUNTDOWN] as const) {
      it(`drains the queue and advances the seq without moving in phase ${RoomPhase[phase]}`, () => {
        const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
        const state = stateWith(player);
        const queues = new Map<string, InputMessage[]>([["p1", ups(1, 2, 9)]]);

        serverTick(state, queues, DT, phase, NO_EFFECTS, new Map(), new Map());

        expect(poseOf(player)).toEqual({ x: 300, y: CORRIDOR_Y, angle: 0, vx: 0, vy: 0, angVel: 0 });
        expect(player.lastProcessedInputSeq).toBe(9);
        expect(queues.get("p1")).toEqual([]);
      });
    }
  });

  // A mid-match joiner is READY and a knocked-out player is POST_MATCH. Stepping either would drive
  // an off-field car around the arena that real players cannot see in their own collision checks.
  for (const status of [PlayerStatus.READY, PlayerStatus.POST_MATCH] as const) {
    it(`drains a ${PlayerStatus[status]} player's queue during MATCH without moving them`, () => {
      const offField = makePlayer("p1", 300, CORRIDOR_Y, 0, status);
      const state = stateWith(offField);
      const queues = new Map<string, InputMessage[]>([["p1", ups(1, 2, 9)]]);

      serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());

      expect(poseOf(offField)).toEqual({ x: 300, y: CORRIDOR_Y, angle: 0, vx: 0, vy: 0, angVel: 0 });
      expect(offField.lastProcessedInputSeq).toBe(9);
      expect(queues.get("p1")).toEqual([]);
    });
  }

  describe("other cars as colliders", () => {
    /**
     * Far enough for the driver to reach the blocker, not far enough to be near a wall. 60, not 40:
     * the 2026-09-06 vector-drive rework's heavy-car pass cut mirage's accel/top speed (420/7.2 base
     * pair -> 60/1.4, 135/3.7 -> 80/2.2), so 40 ticks (1.33 s) no longer covers the 200 u to the
     * blocker at x=500 — mirage needs ~1.5 s just to reach its new 267 u/s top speed. 60 ticks (2 s)
     * clears 500 with room to spare while still resolving well short of the arena wall.
     */
    const TICKS = 60;

    function driveIntoBlocker(
      blockerStatus: PlayerStatus,
      driverCar: CarId = "mirage",
      blockerCar: CarId = "mirage",
    ): PlayerState {
      const driver = makePlayer("a-driver", 300, CORRIDOR_Y, 0, PlayerStatus.IN_MATCH, driverCar);
      const blocker = makePlayer("b-blocker", 500, CORRIDOR_Y, 0, blockerStatus, blockerCar);
      const state = stateWith(driver, blocker);
      for (let i = 0; i < TICKS; i++) {
        serverTick(state, new Map([["a-driver", ups(i + 1)]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());
      }
      return driver;
    }

    it("stops a driver short of another player who is in the match", () => {
      const driver = driveIntoBlocker(PlayerStatus.IN_MATCH);
      expect(driver.x).toBeGreaterThan(300);
      // REPINNED for stage 2 Task 2 (ramDefence-weighted separation): a lone `IN_MATCH` blocker with an
      // empty queue and no knock is never itself stepped (`serverTick` drains only queued or
      // knocked players), so its own `resolveWorld` call -- and its own half of the ramDefence split --
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
      // straight-line scenario (`ups()` never steers), so the mover is `stepDrive`'s new closed-form
      // drag/engine integrator (Task 3) hitting its own equilibrium differently -- the old model's
      // `engineAccel` was a flat clamp-anchored acceleration; the new one is DERIVED so
      // `engineAccel === maxSpeed * dragRate` at the balance point, and the tick-by-tick push profile
      // on the way there is no longer the same shape as the old accel-clamp-and-coast trio. Re-run
      // (this exact scenario, `driveIntoBlocker(IN_MATCH)`, mirage/mirage): traced residual moved
      // 0.0663u -> 0.230962u. 0.35 (~1.5x headroom above the new traced value, same ratio as before)
      // still catches a doubled residual (~0.462u) while giving the new steady state comfortable
      // room.
      //
      // This is the mirage/mirage case only -- see "converges to a residual overlap ..." below for
      // how much worse other roster pairings get, and why that matters for Task 4.
      expect(driver.x + DRIVE_CONFIG.carWidth).toBeLessThanOrEqual(500.35);
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
      const state = insertionOrder === "sorted" ? stateWith(a, b) : stateWith(b, a);
      const queues = new Map<string, InputMessage[]>([
        ["aaa", ups(1)],
        ["bbb", ups(1)],
      ]);
      serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());
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
    const CLEARING_SPEED = 375; // enough to open a gap in a single tick

    const leader = makePlayer("aaa", LEADER_X, CORRIDOR_Y, Math.PI);
    Object.assign(leader, toWorld(Math.PI, CLEARING_SPEED, 0));
    const follower = makePlayer("bbb", FOLLOWER_X, CORRIDOR_Y, 0);
    const state = stateWith(leader, follower);
    const queues = new Map<string, InputMessage[]>([
      ["aaa", coasts(1)],
      ["bbb", coasts(1)],
    ]);

    serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());

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
      const state = stateWith(player);
      // No steer, no throttle: any rotation or translation below comes solely from the knock state,
      // not from ordinary driving.
      const queues = new Map<string, InputMessage[]>([["p1", coasts(1)]]);
      // RESTORED at stage 3 Task 6. Between stage 1 Task 8 and here, `angVel`'s half of this test was
      // pinned at a degenerate value: under U16 ("steering SETS the yaw rate"), the ordinary
      // `stepDrive` branch computes `angVel` entirely from `steer * turnRate * ...` every tick, and
      // reads the incoming `body.angVel` only while a status sets `spinFree` — a flag nothing set
      // until this stage's Task 4 put it on `reeling`. So the round trip needs `reeling` in play to
      // reach the branch that reads `body.angVel` at all; `NO_EFFECTS` can no longer exercise it.
      const reeling: ReadonlyMap<string, Modifiers> = new Map([
        ["p1", { ...NEUTRAL_MODIFIERS, spinFree: true, grip: 0.6, immobilised: true, steeringLocked: true, ramBlocked: true }],
      ]);

      serverTick(state, queues, DT, RoomPhase.MATCH, reeling, new Map(), new Map());

      // angle/angVel: survive the round trip and decay rather than being dropped. `spinFree` reads
      // the incoming `body.angVel` (2) and decays it by `chassis.spinPerTick` (`nextSpinOf`,
      // drive.ts) — `RAM_CONFIG.reelingSpinDecayRate` wired to a real per-chassis rate by this
      // stage's Task 4, where stage 1 left `spinPerTick` at the identity placeholder. `angle`
      // integrates from the DECAYED `angVel`, so it moves off 0 too.
      const chassis = driveOf("mirage");
      expect(player.angVel).toBeCloseTo(2 * chassis.spinPerTick, 6);
      expect(player.angVel).toBeGreaterThan(0);
      expect(player.angVel).toBeLessThan(2);
      expect(player.angle).not.toBe(0);
      expect(player.x).toBeGreaterThan(300);
      expect(player.y).toBeLessThan(CORRIDOR_Y);

      // vx/vy: round-trip through drag (and, for the lateral half, grip) exactly as before. `vx` is
      // unaffected by `reeling`'s `grip` channel (it only scales the LATERAL bleed, and `immobilised`
      // costs nothing here since `coasts(1)` already sends `throttle: 0`), so it lands on the same
      // traced figure as the neutral case: 120 -> 114.969. `vy`'s decay is slower than the neutral
      // case (grip: 0.6 loosens the lateral bleed, per spec §5 — that is the whole point of the
      // channel), but the loose bounds below hold either way.
      expect(player.vx).toBeCloseTo(114.969, 3);
      expect(player.vy).toBeLessThan(0);
      expect(player.vy).toBeGreaterThan(-60);
    });
  });

  describe("maneuver state keeps a silent player moving", () => {
    // `hasMotionToResolve` gates the same silent-coast step that rescues a knocked player who
    // stopped sending input (see the `serverTick coasts a player whose client has gone quiet...`
    // block below). A DASH is the same shape of problem: motion applied from OUTSIDE the player's
    // own inputs, via `maneuverAngle`/`maneuverSpeed` rather than a shove. Unless
    // `hasMotionToResolve` also checks `player.maneuver`, a dashing player who goes silent mid-dash
    // freezes holding the whole state instead of finishing the dash the status/ram system already
    // committed them to.
    it("keeps stepping a silent player mid-dash — a dash is motion applied from outside", () => {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      player.maneuver = ManeuverKind.DASH;
      player.maneuverTicksLeft = 8;
      player.maneuverAngle = 0;
      player.maneuverSpeed = 1600;
      const before = player.x;

      goSilent(stateWith(player), GRACE_TICKS + 1);

      expect(player.x).toBeGreaterThan(before);
      // Only the tick past the grace stepped: the grace ticks do not burn the dash either.
      expect(player.maneuverTicksLeft).toBe(7);
    });

    it("does not step it during the grace, so a mid-dash jitter tick stays in lockstep", () => {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      player.maneuver = ManeuverKind.DASH;
      player.maneuverTicksLeft = 8;
      player.maneuverSpeed = 1600;

      goSilent(stateWith(player), GRACE_TICKS);

      expect(player.x).toBe(300);
      expect(player.maneuverTicksLeft).toBe(8);
    });
  });

  describe("carId fallback", () => {
    function driveOneTickAs(carId: string): PlayerState {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      player.carId = carId;
      serverTick(stateWith(player), new Map([["p1", ups(1)]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());
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
  function fires(seq: number, mask: number = 0b001): InputMessage {
    return { seq, steer: 0, throttle: 0, fireSlots: mask };
  }

  function tickWith(
    player: PlayerState,
    queue: InputMessage[],
    phase: RoomPhase = RoomPhase.MATCH,
  ): Map<string, number> {
    return serverTick(stateWith(player), new Map([[player.sessionId, queue]]), DT, phase, NO_EFFECTS, new Map(), new Map())
      .masks;
  }

  it("reports a HELD trigger as exactly one press, not one per tick", () => {
    // The whole point of edge detection: `fireSlots` is raw key state, so a player holding the
    // trigger sets the same bit on every input. Only the transition counts.
    const prev = new Map<string, number>();
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const tick = (mask: number) =>
      serverTick(stateWith(player), new Map([["p1", [{ seq: 1, steer: 0, throttle: 0, fireSlots: mask }]]]),
        DT, RoomPhase.MATCH, NO_EFFECTS, prev, new Map(), new Map()).masks.get("p1");

    expect(tick(0b001)).toBe(0b001); // key goes down: a press
    expect(tick(0b001)).toBeUndefined(); // still held: nothing
    expect(tick(0b001)).toBeUndefined(); // still held: still nothing
    expect(tick(0b000)).toBeUndefined(); // released
    expect(tick(0b001)).toBe(0b001); // pressed again: a second press
  });

  it("sees a release and re-press INSIDE one tick's batch, from an already-held key", () => {
    // `prev` advances per input, not once per tick. Seeded as already-held, the first input is not a
    // press — so the only way a press is reported here is if the release in the middle of the batch
    // was seen. Advancing `prev` once per tick instead would report nothing at all.
    const prev = new Map<string, number>([["p1", 0b001]]);
    const masks = serverTick(
      stateWith(makePlayer("p1", 300, CORRIDOR_Y, 0)),
      new Map([["p1", [fires(1, 0b001), fires(2, 0b000), fires(3, 0b001)]]]),
      DT, RoomPhase.MATCH, NO_EFFECTS, prev, new Map(),
    ).masks;
    expect(masks.get("p1")).toBe(0b001);
    expect(prev.get("p1")).toBe(0b001); // the batch ended with the key down again
  });

  it("counts a second slot pressed while the first is held", () => {
    // Edge detection is per BIT, not per mask: holding slot 1 must not swallow a slot 2 press.
    const prev = new Map<string, number>();
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const tick = (mask: number) =>
      serverTick(stateWith(player), new Map([["p1", [{ seq: 1, steer: 0, throttle: 0, fireSlots: mask }]]]),
        DT, RoomPhase.MATCH, NO_EFFECTS, prev, new Map(), new Map()).masks.get("p1");

    expect(tick(0b001)).toBe(0b001);
    expect(tick(0b011)).toBe(0b010); // slot 1 still held, slot 2 newly down
  });

  it("reports the slot mask from an input it actually simulated", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b001)]);
    expect(masks.get("p1")).toBe(0b001);
  });

  it("masks off bits beyond maxFireSlots", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b1111_1111)]);
    expect(masks.get("p1")).toBe(0b1111); // three ability slots plus the basic attack (BA15)
  });

  it("lets a press through on the basic attack's bit, and still strips everything above it (BA15)", () => {
    // Hand-rolled wire data: bit 3 is a real slot now, bit 4 never is.
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, (1 << 3) | (1 << 4))]);
    expect(masks.get("p1")).toBe(1 << 3);
  });

  it("ors the masks of every input simulated this tick", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b001), fires(2, 0b010)]);
    expect(masks.get("p1")).toBe(0b011);
  });

  it("reports nothing for a player outside the match", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b001)], RoomPhase.COUNTDOWN);
    expect(masks.size).toBe(0);
  });

  it("ignores a negative or non-integer mask", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, -5 as number)]);
    expect(masks.get("p1") ?? 0).toBe(0);
  });

  it("reports nothing when no input carries a fire mask", () => {
    expect(tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), ups(1)).size).toBe(0);
  });

  it("reports nothing when the queue is empty", () => {
    expect(tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), []).size).toBe(0);
  });

  it("ignores fire from a player who is not on the field", () => {
    const bystander = makePlayer("p1", 300, CORRIDOR_Y, 0, PlayerStatus.READY);
    expect(tickWith(bystander, [fires(1)]).size).toBe(0);
  });

  it("does not credit a shot to an input past the per-tick simulate cap", () => {
    // The first `maxInputsPerTick` inputs are plain drives; only the one past the cap asks to fire,
    // and it is drained and acked but never simulated.
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const queue: InputMessage[] = [
      ...ups(1, 2, 3, 4, 5).slice(0, NET_CONFIG.maxInputsPerTick),
      fires(NET_CONFIG.maxInputsPerTick + 1),
    ];
    const masks = tickWith(player, queue);
    expect(masks.size).toBe(0);
    expect(player.lastProcessedInputSeq).toBe(NET_CONFIG.maxInputsPerTick + 1);
  });

  it("names every player who fired, not just the first", () => {
    const a = makePlayer("aaa", 300, CORRIDOR_Y, 0);
    const b = makePlayer("bbb", 900, CORRIDOR_Y, 0);
    const { masks } = serverTick(
      stateWith(a, b),
      new Map([
        ["aaa", [fires(1)]],
        ["bbb", [fires(1)]],
      ]),
      DT,
      RoomPhase.MATCH,
      NO_EFFECTS,
      new Map(),
      new Map(),
    );
    expect([...masks.keys()].sort()).toEqual(["aaa", "bbb"]);
  });
});

/**
 * A ram writes motion onto its victim from OUTSIDE. It has to integrate whether or not that victim
 * is still sending inputs — otherwise an alt-tabbed, AFK or disconnected player is an immovable wall
 * that no amount of ramming can shift, and the knock written onto them never decays either.
 *
 * Found in playtest: a second browser tab in the background stops sending (rAF throttles hard when
 * hidden), so the victim was skipped entirely and sat frozen with a full-strength shove on it.
 *
 * **What decides the coast is elapsed SILENCE, not what the body looks like.** The client produces
 * exactly one input per sim tick and predicts exactly one `stepSim` for it
 * (`packages/client/src/net/prediction.ts` — there is no coast path in that file), so a running
 * client never steps a tick it did not send an input for. Any extra server step while the client is
 * running is therefore a desync; no extra server step is observable once it has stopped. That is why
 * every case below either waits out `GRACE_TICKS` or deliberately stops short of it, and why they
 * all share ONE silence counter through `goSilent`. See `hasMotionToResolve` in `tick.ts`.
 */
describe("serverTick coasts a player whose client has gone quiet", () => {
  /**
   * A rammed car: shoved along its own heading, with spin on it.
   *
   * The shove is `vx = 300` at `angle = 0` — aligned with the nose, the "dead-on rear-end" case the
   * old `lateralOf`-based predicate could not see at all. Under silence gating the direction of the
   * push is simply not part of the question any more, which is the point of the case two blocks
   * down that drives this fixture all the way to rest.
   */
  function knocked(over: Partial<PlayerState> = {}): PlayerState {
    const p = makePlayer("v", 500, 400, 0);
    p.vx = 300;
    p.angVel = 2;
    Object.assign(p, over);
    return p;
  }

  it("leaves a knocked player alone for the whole grace window", () => {
    // The lockstep half. One empty tick — or eight — is jitter, and the client predicted every one
    // of them from an input still in flight. Stepping here is a step the client never took.
    const player = knocked();
    goSilent(stateWith(player), GRACE_TICKS);
    expect(player.x).toBe(500);
    expect(player.vx).toBe(300);
  });

  it("moves a knocked player once the grace has elapsed", () => {
    const player = knocked();
    goSilent(stateWith(player), GRACE_TICKS + 1);
    expect(player.x).toBeGreaterThan(500);
  });

  it("moves a knocked player whose queue is present but empty, not only one absent from the map", () => {
    // `goSilent` passes no queue at all; this passes an empty one. Both are silence.
    const player = knocked();
    const state = stateWith(player);
    const silence = new Map<string, number>();
    for (let i = 0; i < GRACE_TICKS + 1; i++) {
      serverTick(state, new Map([["v", []]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), silence);
    }
    expect(player.x).toBeGreaterThan(500);
  });

  it("decays the knock rather than freezing it at full strength", () => {
    const player = knocked();
    goSilent(stateWith(player), GRACE_TICKS + 1);
    expect(player.vx).toBeLessThan(300);
    expect(player.vx).toBeGreaterThan(0);
  });

  it("resets the silence run on any drained input, so steady jitter never accumulates into a coast", () => {
    // The failure this guards: counting empty ticks without resetting would let a player who drops
    // one packet in two reach the threshold anyway, and every coast past it is a step their client
    // did take on its own — the desync, arrived at the long way round. Asserted on the counter
    // itself rather than on the pose, because the pose also moves on the ticks that DO carry input.
    const player = makePlayer("v", ARENA_CENTRE_X, ARENA_CENTRE_Y, 0);
    const state = stateWith(player);
    const silence = new Map<string, number>();
    for (let i = 0; i < GRACE_TICKS * 4; i++) {
      const queues = i % 2 === 0 ? new Map<string, InputMessage[]>() : new Map([["v", [UP]]]);
      serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), silence);
    }
    expect(silence.get("v")).toBeLessThanOrEqual(1);
  });

  it("zeroes a coasting car's angVel on its first stepped tick, and never rotates it", () => {
    // RENAMED. This was "carries every knock component, not just shove", which by the end of the
    // drive-model port asserted `angVel` lands on exactly 0 — the negation of its own name. The
    // behaviour is real and is stage 3's to change, not this file's to hide: under U16 the ordinary
    // `stepDrive` branch computes `angVel` entirely from steering input and never reads the incoming
    // `body.angVel` unless a status sets `spinFree`, which nothing does yet (`sim/impulse.ts` still
    // writes ram spin into the field, and the next ordinary tick overwrites it). `COAST_INPUT` has
    // `steer: 0`, so an injected spin resolves to 0 on the first stepped tick rather than decaying,
    // and with `angVel` 0 the `angle` never moves off its start either. Recorded in the port's
    // EXECUTION.md as "ram spin is inert", owned by stage 3.
    const player = knocked({ vx: 0, vy: 0, angVel: 3 });
    goSilent(stateWith(player), GRACE_TICKS + 1);
    expect(player.angVel).toBe(0);
    expect(player.angle).toBe(0);
  });

  it("coasts a dead-on shove all the way to rest, not to 96% of it", () => {
    // The false NEGATIVE the silence gate closes. The predicate this replaced read
    // `lateralOf(vx, vy, angle)`, so a shove along the victim's own heading was invisible to it: a
    // silent victim was stepped exactly once (`angVel` was nonzero on that first tick and 0 after),
    // then froze holding 300 * dragPerTick = 287.423 u/s — 96% of the shove — for the rest of the
    // match. Silence does not care which way the push pointed, so the same fixture now rolls out.
    const player = knocked({ angVel: 3 });
    const state = stateWith(player);
    const silence = goSilent(state, GRACE_TICKS + 1);
    expect(Math.hypot(player.vx, player.vy)).toBeLessThan(300);
    expect(player.x).toBeGreaterThan(500);

    goSilent(state, 600, silence);
    // Exactly 0, not merely small: `stepDrive`'s `atRest` snaps a throttle-free car below
    // `stopEpsilon` to rest, and the car then drops out of `hasMotionToResolve` and stops being
    // stepped at all.
    expect(player.vx).toBe(0);
    expect(player.vy).toBe(0);
    expect(player.angVel).toBe(0);
    const restingX = player.x;
    goSilent(state, 1, silence);
    expect(player.x).toBe(restingX);
  });

  it("leaves a truly resting, unknocked player exactly where it is, however long it is silent", () => {
    // Zero velocity, zero spin, no maneuver: `hasMotionToResolve` is false, so the grace elapsing
    // changes nothing. A parked car is not stepped at all.
    const player = makePlayer("v", 500, 400, 0);
    goSilent(stateWith(player), GRACE_TICKS * 3);
    expect(player.x).toBe(500);
    expect(player.vx).toBe(0);
  });

  it("leaves a merely-driving silent player frozen for the whole grace window", () => {
    // This is the property client prediction depends on, and it is now unconditional on what the
    // body carries: for `GRACE_TICKS` the server takes zero steps for a player with an empty queue,
    // full stop. Before the silence gate this rested on "a car never drives itself sideways", which
    // the drive-model port falsified by deleting `steeringGrip` — see `hasMotionToResolve`'s doc.
    const player = makePlayer("v", 500, 400, 0);
    player.vx = 200;
    goSilent(stateWith(player), GRACE_TICKS);
    expect(player.x).toBe(500);
    expect(player.vx).toBe(200);
  });

  it("leaves a CORNERING silent player frozen for the whole grace window, drift and steering rate and all", () => {
    // Regression for the Critical finding on the old `hasKnock`. A car at full lock under this model
    // carries BOTH things that predicate tested as evidence of an external knock: real lateral
    // velocity (the drift — tens of u/s, against a `stopEpsilon` of 1e-3) and a nonzero `angVel`
    // (which under U16 is just "this player is steering"). So the old predicate fired for every
    // cornering player on every jittered tick — an event its own comment called routine at these
    // latencies — and each firing cost a server-only coast step the client never predicted.
    const player = makePlayer("v", ARENA_CENTRE_X, ARENA_CENTRE_Y, 0);
    const state = stateWith(player);
    let seq = 1;
    for (let i = 0; i < 30; i++) {
      const queue = [{ seq: seq++, steer: 1 as const, throttle: 1 as const, fireSlots: 0 }];
      serverTick(state, new Map([["v", queue]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), new Map());
    }
    // Both of the old predicate's signals are live on an ordinary cornering car.
    expect(Math.abs(lateralOf(player.vx, player.vy, player.angle))).toBeGreaterThan(DRIVE_CONFIG.stopEpsilon);
    expect(player.angVel).not.toBe(0);

    const restingX = player.x;
    const restingY = player.y;
    const restingVx = player.vx;
    const restingVy = player.vy;
    goSilent(state, GRACE_TICKS);
    expect(player.x).toBe(restingX);
    expect(player.y).toBe(restingY);
    expect(player.vx).toBe(restingVx);
    expect(player.vy).toBe(restingVy);
  });

  it("does not advance the input ack — a coast step acknowledges nothing", () => {
    const player = knocked({ lastProcessedInputSeq: 7 });
    goSilent(stateWith(player), GRACE_TICKS + 1);
    expect(player.lastProcessedInputSeq).toBe(7);
  });

  it("reports no fire mask for a coast step", () => {
    const state = stateWith(knocked());
    const silence = goSilent(state, GRACE_TICKS);
    const result = serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map(), silence);
    expect(result.masks.size).toBe(0);
  });

  it("does not coast outside MATCH, however long the silence runs", () => {
    const player = knocked();
    goSilent(stateWith(player), GRACE_TICKS * 3, new Map(), RoomPhase.COUNTDOWN);
    expect(player.x).toBe(500);
  });

  it("does not coast a player who is not on the field, however long the silence runs", () => {
    const player = knocked({ status: PlayerStatus.POST_MATCH });
    goSilent(stateWith(player), GRACE_TICKS * 3);
    expect(player.x).toBe(500);
  });

  it("still resolves the coasting car against other cars", () => {
    // Shoved straight into a stationary neighbour: it must be pushed clear, not driven through.
    const victim = knocked({ vx: 600 });
    const wall = makePlayer("w", 560, 400, 0);
    goSilent(stateWith(victim, wall), GRACE_TICKS + 5);
    expect(victim.x).toBeLessThan(560 - 40);
  });
});
