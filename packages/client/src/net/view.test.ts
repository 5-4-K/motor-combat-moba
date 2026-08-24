import { describe, expect, it, vi } from "vitest";
import { PlayerStatus, RoomPhase, viewFor } from "@motor-arena/shared";
import { VIEW_TO_SCENE, bindViewRouter, sceneKeyFor } from "./view.js";

describe("VIEW_TO_SCENE", () => {
  it("maps viewFor ids to Phaser scene keys (match → arena)", () => {
    expect(VIEW_TO_SCENE.lobby).toBe("lobby");
    expect(VIEW_TO_SCENE.car_select).toBe("car_select");
    expect(VIEW_TO_SCENE.match).toBe("arena");
    expect(VIEW_TO_SCENE.results).toBe("results");
  });
});

describe("sceneKeyFor", () => {
  it("maps ready + any phase to lobby", () => {
    expect(sceneKeyFor(PlayerStatus.READY, RoomPhase.LOBBY)).toBe("lobby");
    expect(sceneKeyFor(PlayerStatus.READY, RoomPhase.CAR_SELECT)).toBe("lobby");
    expect(sceneKeyFor("ready", RoomPhase.MATCH)).toBe("lobby");
    expect(VIEW_TO_SCENE[viewFor(PlayerStatus.READY, RoomPhase.COUNTDOWN)]).toBe("lobby");
  });

  it("maps in-match + car_select to car_select", () => {
    expect(viewFor(PlayerStatus.IN_MATCH, RoomPhase.CAR_SELECT)).toBe("car_select");
    expect(sceneKeyFor(PlayerStatus.IN_MATCH, RoomPhase.CAR_SELECT)).toBe("car_select");
    expect(sceneKeyFor("in_match", RoomPhase.CAR_SELECT)).toBe("car_select");
  });

  it("maps in-match + countdown or match to arena", () => {
    expect(viewFor(PlayerStatus.IN_MATCH, RoomPhase.COUNTDOWN)).toBe("match");
    expect(viewFor(PlayerStatus.IN_MATCH, RoomPhase.MATCH)).toBe("match");
    expect(sceneKeyFor(PlayerStatus.IN_MATCH, RoomPhase.COUNTDOWN)).toBe("arena");
    expect(sceneKeyFor(PlayerStatus.IN_MATCH, RoomPhase.MATCH)).toBe("arena");
    expect(sceneKeyFor("in_match", RoomPhase.COUNTDOWN)).toBe("arena");
  });

  it("maps in-match + lobby phase to lobby", () => {
    expect(sceneKeyFor(PlayerStatus.IN_MATCH, RoomPhase.LOBBY)).toBe("lobby");
  });

  it("maps post-match + any phase to results", () => {
    expect(viewFor(PlayerStatus.POST_MATCH, RoomPhase.MATCH)).toBe("results");
    expect(sceneKeyFor(PlayerStatus.POST_MATCH, RoomPhase.LOBBY)).toBe("results");
    expect(sceneKeyFor(PlayerStatus.POST_MATCH, RoomPhase.CAR_SELECT)).toBe("results");
    expect(sceneKeyFor("post_match", RoomPhase.COUNTDOWN)).toBe("results");
    expect(sceneKeyFor(PlayerStatus.POST_MATCH, RoomPhase.MATCH)).toBe("results");
  });
});

describe("bindViewRouter", () => {
  it("starts the mapped scene when it differs from the current key", () => {
    const room = mockRoom({
      phase: RoomPhase.CAR_SELECT,
      players: { me: { status: PlayerStatus.IN_MATCH } },
    });
    const start = vi.fn();
    bindViewRouter({ scene: { key: "lobby", start } }, room);

    expect(start).toHaveBeenCalledWith("car_select");
  });

  it("does not start when the mapped scene is already current", () => {
    const room = mockRoom({
      phase: RoomPhase.LOBBY,
      players: { me: { status: PlayerStatus.READY } },
    });
    const start = vi.fn();
    bindViewRouter({ scene: { key: "lobby", start } }, room);
    room.emit();

    expect(start).not.toHaveBeenCalled();
  });

  it("keeps results when a new match starts while local is post-match", () => {
    const room = mockRoom({
      phase: RoomPhase.CAR_SELECT,
      players: { me: { status: PlayerStatus.POST_MATCH } },
    });
    const start = vi.fn();
    bindViewRouter({ scene: { key: "results", start } }, room);
    room.emit();

    expect(start).not.toHaveBeenCalled();
  });

  it("does not start after unbind", () => {
    const room = mockRoom({
      phase: RoomPhase.LOBBY,
      players: { me: { status: PlayerStatus.READY } },
    });
    const start = vi.fn();
    const unbind = bindViewRouter({ scene: { key: "lobby", start } }, room);
    unbind();
    optsPhase(room, RoomPhase.CAR_SELECT);
    optsStatus(room, "me", PlayerStatus.IN_MATCH);
    room.emit();

    expect(start).not.toHaveBeenCalled();
  });
});

type MockPlayer = { status: PlayerStatus };

function mockRoom(opts: {
  phase: RoomPhase;
  players: Record<string, MockPlayer>;
  sessionId?: string;
}) {
  const listeners = new Set<() => void>();
  const onStateChange = (cb: () => void): void => {
    listeners.add(cb);
  };
  onStateChange.remove = (cb: () => void): void => {
    listeners.delete(cb);
  };
  return {
    sessionId: opts.sessionId ?? "me",
    _opts: opts,
    get state() {
      return {
        phase: opts.phase,
        players: {
          get(id: string) {
            return opts.players[id];
          },
        },
      };
    },
    onStateChange,
    emit() {
      for (const cb of listeners) cb();
    },
  };
}

function optsPhase(room: ReturnType<typeof mockRoom>, phase: RoomPhase): void {
  room._opts.phase = phase;
}

function optsStatus(room: ReturnType<typeof mockRoom>, id: string, status: PlayerStatus): void {
  room._opts.players[id].status = status;
}
