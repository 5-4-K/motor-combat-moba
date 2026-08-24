import { describe, expect, it } from "vitest";
import { GameMode, PlayerStatus, RoomPhase } from "@motor-combat-moba/shared";
import {
  fromFlowPhase,
  fromFlowStatus,
  toFlowMode,
  toFlowPhase,
  toFlowStatus,
} from "./flow-map.js";

describe("toFlowMode / fromFlowPhase", () => {
  it("maps GameMode to flow mode strings", () => {
    expect(toFlowMode(GameMode.FFA)).toBe("ffa");
    expect(toFlowMode(GameMode.TEAM)).toBe("team");
  });

  it("maps RoomPhase to flow phase strings and back", () => {
    expect(toFlowPhase(RoomPhase.LOBBY)).toBe("lobby");
    expect(toFlowPhase(RoomPhase.CAR_SELECT)).toBe("car_select");
    expect(toFlowPhase(RoomPhase.COUNTDOWN)).toBe("countdown");
    expect(toFlowPhase(RoomPhase.MATCH)).toBe("match");
    expect(fromFlowPhase("lobby")).toBe(RoomPhase.LOBBY);
    expect(fromFlowPhase("car_select")).toBe(RoomPhase.CAR_SELECT);
    expect(fromFlowPhase("countdown")).toBe(RoomPhase.COUNTDOWN);
    expect(fromFlowPhase("match")).toBe(RoomPhase.MATCH);
  });

  it("maps PlayerStatus to flow status strings and back", () => {
    expect(toFlowStatus(PlayerStatus.READY)).toBe("ready");
    expect(toFlowStatus(PlayerStatus.IN_MATCH)).toBe("in_match");
    expect(toFlowStatus(PlayerStatus.POST_MATCH)).toBe("post_match");
    expect(fromFlowStatus("ready")).toBe(PlayerStatus.READY);
    expect(fromFlowStatus("in_match")).toBe(PlayerStatus.IN_MATCH);
    expect(fromFlowStatus("post_match")).toBe(PlayerStatus.POST_MATCH);
  });
});
