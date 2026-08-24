import { describe, expect, it } from "vitest";
import { ArenaState, PlayerState, type InputMessage } from "@motor-arena/shared";
import { serverTick } from "./tick.js";

function makePlayer(sessionId: string, x: number, y: number, angle: number): PlayerState {
  const p = new PlayerState();
  p.sessionId = sessionId;
  p.x = x;
  p.y = y;
  p.angle = angle;
  p.lastProcessedInputSeq = 0;
  return p;
}

describe("serverTick", () => {
  it("applies queued input, leaves pose unchanged (identity stepSim), and empties the queue", () => {
    const state = new ArenaState();
    const player = makePlayer("p1", 10, 20, 0.3);
    state.players.set("p1", player);

    const msg: InputMessage = { seq: 7, steer: 1, throttle: 1, fire: false };
    const queues = new Map<string, InputMessage[]>([["p1", [msg]]]);

    serverTick(state, queues);

    expect(player.x).toBe(10);
    expect(player.y).toBe(20);
    expect(player.angle).toBe(0.3);
    expect(player.lastProcessedInputSeq).toBe(7);
    expect(queues.get("p1")).toEqual([]);
  });

  it("leaves a player with an empty or missing queue unchanged", () => {
    const state = new ArenaState();
    const emptyQ = makePlayer("empty", 1, 2, 0.1);
    emptyQ.lastProcessedInputSeq = 3;
    const missingQ = makePlayer("missing", 4, 5, 0.2);
    missingQ.lastProcessedInputSeq = 4;
    state.players.set("empty", emptyQ);
    state.players.set("missing", missingQ);

    const queues = new Map<string, InputMessage[]>([["empty", []]]);

    serverTick(state, queues);

    expect(emptyQ.x).toBe(1);
    expect(emptyQ.y).toBe(2);
    expect(emptyQ.angle).toBe(0.1);
    expect(emptyQ.lastProcessedInputSeq).toBe(3);
    expect(missingQ.x).toBe(4);
    expect(missingQ.y).toBe(5);
    expect(missingQ.angle).toBe(0.2);
    expect(missingQ.lastProcessedInputSeq).toBe(4);
  });

  it("sets lastProcessedInputSeq to the last seq applied when multiple messages are queued", () => {
    const state = new ArenaState();
    const player = makePlayer("p1", 0, 0, 0);
    state.players.set("p1", player);

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

    serverTick(state, queues);

    expect(player.lastProcessedInputSeq).toBe(5);
    expect(queues.get("p1")).toEqual([]);
  });
});
