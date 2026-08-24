import { describe, expect, it } from "vitest";
import {
  ArenaState,
  DRIVE_CONFIG,
  MS_PER_TICK,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  type InputMessage,
  type SimBody,
} from "@motor-arena/shared";
import { serverTick } from "./tick.js";

const DT = MS_PER_TICK / 1000;
const UP: InputMessage = { seq: 1, steer: 0, throttle: 1, fire: false };

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
  return seqs.map((seq) => ({ seq, steer: 0, throttle: 1, fire: false }));
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
          { seq: 1, steer: 0, throttle: 0, fire: false },
          { seq: 2, steer: 1, throttle: 0, fire: false },
          { seq: 5, steer: 0, throttle: 1, fire: true },
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

    expect(serverTick.length).toBe(4);
    expect(fast.speed).toBeCloseTo(slow.speed * 2, 6);
    expect(fast.x - 300).toBeGreaterThan(slow.x - 300);
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

  it("drains a not-in-match player's queue during MATCH without moving them", () => {
    // A mid-match joiner is READY, not IN_MATCH. Stepping them would drive an off-field car around
    // the arena that real players cannot see in their own collision checks.
    const joiner = makePlayer("p1", 300, CORRIDOR_Y, 0, PlayerStatus.READY);
    const state = stateWith(joiner);
    const queues = new Map<string, InputMessage[]>([["p1", ups(1, 2, 9)]]);

    serverTick(state, queues, DT, RoomPhase.MATCH);

    expect(poseOf(joiner)).toEqual({ x: 300, y: CORRIDOR_Y, angle: 0, speed: 0, reverseHold: 0 });
    expect(joiner.lastProcessedInputSeq).toBe(9);
    expect(queues.get("p1")).toEqual([]);
  });

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
});
