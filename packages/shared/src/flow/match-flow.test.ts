import { describe, expect, it } from "vitest";
import { reduceFlow } from "./match-flow.js";
import type { FlowPlayer, FlowState } from "./match-flow.js";

function player(overrides: Partial<FlowPlayer> & Pick<FlowPlayer, "sessionId">): FlowPlayer {
  return {
    team: 0,
    status: "ready",
    carId: "",
    selectLocked: false,
    alive: true,
    ...overrides,
  };
}

function lobbyState(players: FlowPlayer[], extra?: Partial<FlowState>): FlowState {
  return {
    phase: "lobby",
    mode: "ffa",
    tick: 0,
    carSelectDeadlineTick: 0,
    countdownEndsTick: 0,
    roster: [],
    postMatchIds: [],
    winnerSessionId: "",
    winnerTeam: -1,
    players,
    ...extra,
  };
}

function byId(state: FlowState, sessionId: string): FlowPlayer {
  const found = state.players.find((p) => p.sessionId === sessionId);
  if (!found) throw new Error(`missing player ${sessionId}`);
  return found;
}

describe("reduceFlow start", () => {
  it("pulls only ready players into roster and car_select", () => {
    const initial = lobbyState(
      [
        player({ sessionId: "a" }),
        player({ sessionId: "b", team: 1 }),
        player({ sessionId: "c", status: "post_match" }),
      ],
      { postMatchIds: ["c"], tick: 40 },
    );

    const next = reduceFlow(initial, {
      type: "start",
      readyIds: ["a", "b", "c"],
      nowTick: 100,
      carSelectTicks: 30,
    });

    expect(next.phase).toBe("car_select");
    expect(next.roster).toEqual(["a", "b"]);
    expect(next.carSelectDeadlineTick).toBe(130);
    expect(byId(next, "a").status).toBe("in_match");
    expect(byId(next, "b").status).toBe("in_match");
    expect(byId(next, "c").status).toBe("post_match");
    expect(next.postMatchIds).toEqual(["c"]);

    expect(initial.phase).toBe("lobby");
    expect(initial.roster).toEqual([]);
    expect(byId(initial, "a").status).toBe("ready");
  });
});

describe("reduceFlow lock_car", () => {
  it("locks a roster player and ignores a second lock on the same id", () => {
    const started = reduceFlow(
      lobbyState([player({ sessionId: "a" }), player({ sessionId: "b", team: 1 })]),
      { type: "start", readyIds: ["a", "b"], nowTick: 0, carSelectTicks: 60 },
    );

    const locked = reduceFlow(started, { type: "lock_car", sessionId: "a" });
    expect(byId(locked, "a").selectLocked).toBe(true);
    expect(byId(locked, "b").selectLocked).toBe(false);
    expect(started.players.find((p) => p.sessionId === "a")?.selectLocked).toBe(false);

    const again = reduceFlow(locked, { type: "lock_car", sessionId: "a" });
    expect(byId(again, "a").selectLocked).toBe(true);
    expect(again).toBe(locked);
  });

  it("ignores lock_car from a non-roster ready spectator", () => {
    const started = reduceFlow(
      lobbyState([
        player({ sessionId: "a" }),
        player({ sessionId: "b", team: 1 }),
        player({ sessionId: "spec" }),
      ]),
      { type: "start", readyIds: ["a", "b"], nowTick: 0, carSelectTicks: 60 },
    );

    const next = reduceFlow(started, { type: "lock_car", sessionId: "spec" });
    expect(next).toBe(started);
    expect(byId(started, "spec").status).toBe("ready");
    expect(byId(started, "spec").selectLocked).toBe(false);
  });
});

describe("reduceFlow reveal", () => {
  it("writes roster carIds from the map and does not change phase", () => {
    const started = reduceFlow(
      lobbyState([
        player({ sessionId: "a" }),
        player({ sessionId: "b", team: 1 }),
        player({ sessionId: "spec" }),
      ]),
      { type: "start", readyIds: ["a", "b"], nowTick: 0, carSelectTicks: 60 },
    );

    const next = reduceFlow(started, {
      type: "reveal",
      cars: { a: "rect", spec: "oval", ghost: "hex" },
    });

    expect(next.phase).toBe("car_select");
    expect(byId(next, "a").carId).toBe("rect");
    expect(byId(next, "b").carId).toBe("");
    expect(byId(next, "spec").carId).toBe("");
    expect(started.phase).toBe("car_select");
    expect(byId(started, "a").carId).toBe("");
  });
});

describe("reduceFlow begin_countdown", () => {
  it("sets phase countdown and countdownEndsTick", () => {
    const started = reduceFlow(
      lobbyState([player({ sessionId: "a" }), player({ sessionId: "b", team: 1 })]),
      { type: "start", readyIds: ["a", "b"], nowTick: 10, carSelectTicks: 20 },
    );

    const next = reduceFlow(started, {
      type: "begin_countdown",
      nowTick: 40,
      countdownTicks: 90,
    });

    expect(next.phase).toBe("countdown");
    expect(next.countdownEndsTick).toBe(130);
    expect(started.phase).toBe("car_select");
  });
});

describe("reduceFlow go", () => {
  it("sets phase match", () => {
    const countdown = reduceFlow(
      reduceFlow(
        lobbyState([player({ sessionId: "a" }), player({ sessionId: "b", team: 1 })]),
        { type: "start", readyIds: ["a", "b"], nowTick: 0, carSelectTicks: 10 },
      ),
      { type: "begin_countdown", nowTick: 10, countdownTicks: 90 },
    );

    const next = reduceFlow(countdown, { type: "go" });
    expect(next.phase).toBe("match");
    expect(countdown.phase).toBe("countdown");
  });
});

describe("reduceFlow end", () => {
  it("returns to lobby, marks remaining roster post_match, and stores winners", () => {
    const matching = reduceFlow(
      reduceFlow(
        reduceFlow(
          lobbyState(
            [
              player({ sessionId: "a" }),
              player({ sessionId: "b", team: 1 }),
              player({ sessionId: "gone" }),
            ],
            { postMatchIds: ["linger"] },
          ),
          { type: "start", readyIds: ["a", "b", "gone"], nowTick: 0, carSelectTicks: 10 },
        ),
        { type: "begin_countdown", nowTick: 10, countdownTicks: 5 },
      ),
      { type: "go" },
    );
    const withoutGone: FlowState = {
      ...matching,
      players: matching.players.filter((p) => p.sessionId !== "gone"),
    };

    const next = reduceFlow(withoutGone, {
      type: "end",
      winnerSessionId: "a",
      winnerTeam: 0,
    });

    expect(next.phase).toBe("lobby");
    expect(next.winnerSessionId).toBe("a");
    expect(next.winnerTeam).toBe(0);
    expect(next.postMatchIds).toEqual(["linger", "a", "b"]);
    expect(byId(next, "a").status).toBe("post_match");
    expect(byId(next, "b").status).toBe("post_match");
    expect(next.players.some((p) => p.sessionId === "gone")).toBe(false);
    expect(withoutGone.phase).toBe("match");
    expect(byId(withoutGone, "a").status).toBe("in_match");
  });
});

describe("reduceFlow return_to_lobby", () => {
  it("removes the id from postMatchIds and sets status ready", () => {
    const ended = reduceFlow(
      reduceFlow(
        reduceFlow(
          reduceFlow(
            lobbyState([player({ sessionId: "a" }), player({ sessionId: "b", team: 1 })]),
            { type: "start", readyIds: ["a", "b"], nowTick: 0, carSelectTicks: 10 },
          ),
          { type: "begin_countdown", nowTick: 10, countdownTicks: 5 },
        ),
        { type: "go" },
      ),
      { type: "end", winnerSessionId: "a", winnerTeam: -1 },
    );

    const next = reduceFlow(ended, { type: "return_to_lobby", sessionId: "a" });
    expect(next.postMatchIds).toEqual(["b"]);
    expect(byId(next, "a").status).toBe("ready");
    expect(byId(next, "b").status).toBe("post_match");
    expect(ended.postMatchIds).toEqual(["a", "b"]);

    const ignored = reduceFlow(next, { type: "return_to_lobby", sessionId: "spec" });
    expect(ignored).toBe(next);
  });
});

describe("reduceFlow second start", () => {
  it("pulls only current ready ids while someone is still post_match", () => {
    const ended = reduceFlow(
      reduceFlow(
        reduceFlow(
          reduceFlow(
            lobbyState([player({ sessionId: "a" }), player({ sessionId: "b", team: 1 })]),
            { type: "start", readyIds: ["a", "b"], nowTick: 0, carSelectTicks: 10 },
          ),
          { type: "begin_countdown", nowTick: 10, countdownTicks: 5 },
        ),
        { type: "go" },
      ),
      { type: "end", winnerSessionId: "b", winnerTeam: 1 },
    );
    const aReady = reduceFlow(ended, { type: "return_to_lobby", sessionId: "a" });
    const withJoiner: FlowState = {
      ...aReady,
      players: [...aReady.players, player({ sessionId: "d", team: 1 })],
    };

    const next = reduceFlow(withJoiner, {
      type: "start",
      readyIds: ["a", "b", "d"],
      nowTick: 200,
      carSelectTicks: 15,
    });

    expect(next.phase).toBe("car_select");
    expect(next.roster).toEqual(["a", "d"]);
    expect(next.carSelectDeadlineTick).toBe(215);
    expect(byId(next, "a").status).toBe("in_match");
    expect(byId(next, "d").status).toBe("in_match");
    expect(byId(next, "b").status).toBe("post_match");
    expect(next.postMatchIds).toEqual(["b"]);
  });
});
