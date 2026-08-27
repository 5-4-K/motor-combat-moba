import { describe, expect, it } from "vitest";
import {
  ArenaState,
  DRIVE_CONFIG,
  MS_PER_TICK,
  NET_CONFIG,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  type InputMessage,
  type SimBody,
} from "@motor-combat-moba/shared";
import { serverTick } from "./tick.js";

const DT = MS_PER_TICK / 1000;
const UP: InputMessage = { seq: 1, steer: 0, throttle: 1, fireSlots: 0 };

/** A clear east-west corridor in arena-01: every obstacle sits at y >= 350. */
const CORRIDOR_Y = 100;

function makePlayer(
  sessionId: string,
  x: number,
  y: number,
  angle: number,
  status: PlayerStatus = PlayerStatus.IN_MATCH,
): PlayerState {
  const p = new PlayerState();
  p.sessionId = sessionId;
  p.x = x;
  p.y = y;
  p.angle = angle;
  p.status = status;
  p.carId = "rectangle";
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
    speed: player.speed,
    reverseHold: player.reverseHold,
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

    serverTick(state, queues, DT, RoomPhase.MATCH);

    expect(player.x).toBeGreaterThan(300);
    expect(player.y).toBe(CORRIDOR_Y);
    expect(player.speed).toBeCloseTo(DRIVE_CONFIG.accel * DT, 6);
    expect(player.lastProcessedInputSeq).toBe(7);
    expect(queues.get("p1")).toEqual([]);
  });

  it("carries speed forward between inputs, so N queued inputs accelerate N times", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const state = stateWith(player);
    const queues = new Map<string, InputMessage[]>([["p1", ups(1, 2, 3)]]);

    serverTick(state, queues, DT, RoomPhase.MATCH);

    // Would be a single `accel * DT` if `speed` were only written back after the last input.
    expect(player.speed).toBeCloseTo(3 * DRIVE_CONFIG.accel * DT, 6);
  });

  it("leaves a player with an empty or missing queue unchanged", () => {
    const emptyQ = makePlayer("empty", 1, 2, 0.1);
    emptyQ.lastProcessedInputSeq = 3;
    const missingQ = makePlayer("missing", 4, 5, 0.2);
    missingQ.lastProcessedInputSeq = 4;
    const state = stateWith(emptyQ, missingQ);

    const queues = new Map<string, InputMessage[]>([["empty", []]]);

    serverTick(state, queues, DT, RoomPhase.MATCH);

    expect(poseOf(emptyQ)).toEqual({ x: 1, y: 2, angle: 0.1, speed: 0, reverseHold: 0 });
    expect(emptyQ.lastProcessedInputSeq).toBe(3);
    expect(poseOf(missingQ)).toEqual({ x: 4, y: 5, angle: 0.2, speed: 0, reverseHold: 0 });
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

    serverTick(state, queues, DT, RoomPhase.MATCH);

    expect(player.lastProcessedInputSeq).toBe(5);
    expect(queues.get("p1")).toEqual([]);
  });

  it("integrates with the dt it is given", () => {
    const slow = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const fast = makePlayer("p1", 300, CORRIDOR_Y, 0);

    serverTick(stateWith(slow), new Map([["p1", ups(1)]]), DT, RoomPhase.MATCH);
    serverTick(stateWith(fast), new Map([["p1", ups(1)]]), DT * 2, RoomPhase.MATCH);

    expect(fast.speed).toBeCloseTo(slow.speed * 2, 6);
    expect(fast.x - 300).toBeGreaterThan(slow.x - 300);
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
      serverTick(stateWith(player), new Map([["p1", queue]]), DT, RoomPhase.MATCH);
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
    serverTick(stateWith(flooder), new Map([["p1", floodQueue]]), DT, RoomPhase.MATCH);

    const honest = makePlayer("p1", 300, CORRIDOR_Y, 0);
    serverTick(
      stateWith(honest),
      new Map([["p1", ups(...Array.from({ length: cap }, (_, i) => i + 1))]]),
      DT,
      RoomPhase.MATCH,
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

        serverTick(state, queues, DT, phase);

        expect(poseOf(player)).toEqual({ x: 300, y: CORRIDOR_Y, angle: 0, speed: 0, reverseHold: 0 });
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

      serverTick(state, queues, DT, RoomPhase.MATCH);

      expect(poseOf(offField)).toEqual({ x: 300, y: CORRIDOR_Y, angle: 0, speed: 0, reverseHold: 0 });
      expect(offField.lastProcessedInputSeq).toBe(9);
      expect(queues.get("p1")).toEqual([]);
    });
  }

  describe("other cars as colliders", () => {
    /** Far enough for the driver to reach the blocker, not far enough to be near a wall. */
    const TICKS = 40;

    function driveIntoBlocker(blockerStatus: PlayerStatus): PlayerState {
      const driver = makePlayer("a-driver", 300, CORRIDOR_Y, 0);
      const blocker = makePlayer("b-blocker", 500, CORRIDOR_Y, 0, blockerStatus);
      const state = stateWith(driver, blocker);
      for (let i = 0; i < TICKS; i++) {
        serverTick(state, new Map([["a-driver", ups(i + 1)]]), DT, RoomPhase.MATCH);
      }
      return driver;
    }

    it("stops a driver short of another player who is in the match", () => {
      const driver = driveIntoBlocker(PlayerStatus.IN_MATCH);
      expect(driver.x).toBeGreaterThan(300);
      expect(driver.x + DRIVE_CONFIG.carWidth).toBeLessThanOrEqual(500);
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
      serverTick(state, queues, DT, RoomPhase.MATCH);
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
    const FOLLOWER_X = 440; // < LEADER_X + carWidth, so the two start overlapping
    const CLEARING_SPEED = 300; // enough to open a gap in a single tick

    const leader = makePlayer("aaa", LEADER_X, CORRIDOR_Y, Math.PI);
    leader.speed = CLEARING_SPEED;
    const follower = makePlayer("bbb", FOLLOWER_X, CORRIDOR_Y, 0);
    const state = stateWith(leader, follower);
    const queues = new Map<string, InputMessage[]>([
      ["aaa", coasts(1)],
      ["bbb", coasts(1)],
    ]);

    serverTick(state, queues, DT, RoomPhase.MATCH);

    // The leader really did drive clear, so the follower's contact genuinely depends on which pose
    // it was tested against.
    expect(FOLLOWER_X - LEADER_X).toBeLessThan(DRIVE_CONFIG.carWidth);
    expect(follower.x - leader.x).toBeGreaterThan(DRIVE_CONFIG.carWidth);
    // Untouched: no drive input, and no contact once the leader's updated pose is used.
    expect(follower.x).toBe(FOLLOWER_X);
  });

  describe("carId fallback", () => {
    function driveOneTickAs(carId: string): PlayerState {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      player.carId = carId;
      serverTick(stateWith(player), new Map([["p1", ups(1)]]), DT, RoomPhase.MATCH);
      return player;
    }

    it("drives a pre-reveal player (carId \"\") as the default chassis", () => {
      expect(poseOf(driveOneTickAs(""))).toEqual(poseOf(driveOneTickAs("rectangle")));
    });

    it("does not mistake an inherited Object property for a car id", () => {
      // `"constructor" in CAR_TABLE` is true via the prototype chain; looking its stats up yields
      // undefined and NaNs the whole drive step.
      const inherited = driveOneTickAs("constructor");
      expect(Number.isFinite(inherited.x)).toBe(true);
      expect(poseOf(inherited)).toEqual(poseOf(driveOneTickAs("rectangle")));
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
    return serverTick(stateWith(player), new Map([[player.sessionId, queue]]), DT, phase);
  }

  it("reports the slot mask from an input it actually simulated", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b001)]);
    expect(masks.get("p1")).toBe(0b001);
  });

  it("masks off bits beyond maxWeaponSlots", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b1111_1111)]);
    expect(masks.get("p1")).toBe(0b111); // maxWeaponSlots = 3
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
    const masks = serverTick(
      stateWith(a, b),
      new Map([
        ["aaa", [fires(1)]],
        ["bbb", [fires(1)]],
      ]),
      DT,
      RoomPhase.MATCH,
    );
    expect([...masks.keys()].sort()).toEqual(["aaa", "bbb"]);
  });
});
