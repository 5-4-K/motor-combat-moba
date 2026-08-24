import { describe, expect, it } from "vitest";
import { badgeColor, viewFor } from "./status.js";
import { PlayerStatus, RoomPhase } from "../constants.js";

describe("badgeColor", () => {
  it("maps ready to green", () => {
    expect(badgeColor("ready")).toBe("#2ECC71");
    expect(badgeColor(PlayerStatus.READY)).toBe("#2ECC71");
  });
  it("maps in_match to yellow", () => {
    expect(badgeColor("in_match")).toBe("#F1C40F");
    expect(badgeColor(PlayerStatus.IN_MATCH)).toBe("#F1C40F");
  });
  it("maps post_match to red", () => {
    expect(badgeColor("post_match")).toBe("#E74C3C");
    expect(badgeColor(PlayerStatus.POST_MATCH)).toBe("#E74C3C");
  });
});

describe("viewFor", () => {
  it("returns results for post-match in any phase", () => {
    expect(viewFor("post_match", RoomPhase.LOBBY)).toBe("results");
    expect(viewFor("post_match", RoomPhase.CAR_SELECT)).toBe("results");
    expect(viewFor("post_match", RoomPhase.COUNTDOWN)).toBe("results");
    expect(viewFor("post_match", RoomPhase.MATCH)).toBe("results");
    expect(viewFor(PlayerStatus.POST_MATCH, RoomPhase.LOBBY)).toBe("results");
    expect(viewFor(PlayerStatus.POST_MATCH, RoomPhase.CAR_SELECT)).toBe("results");
    expect(viewFor(PlayerStatus.POST_MATCH, RoomPhase.COUNTDOWN)).toBe("results");
    expect(viewFor(PlayerStatus.POST_MATCH, RoomPhase.MATCH)).toBe("results");
  });

  it("returns lobby for ready in any phase", () => {
    expect(viewFor("ready", RoomPhase.LOBBY)).toBe("lobby");
    expect(viewFor("ready", RoomPhase.CAR_SELECT)).toBe("lobby");
    expect(viewFor("ready", RoomPhase.COUNTDOWN)).toBe("lobby");
    expect(viewFor("ready", RoomPhase.MATCH)).toBe("lobby");
    expect(viewFor(PlayerStatus.READY, RoomPhase.LOBBY)).toBe("lobby");
    expect(viewFor(PlayerStatus.READY, RoomPhase.CAR_SELECT)).toBe("lobby");
    expect(viewFor(PlayerStatus.READY, RoomPhase.COUNTDOWN)).toBe("lobby");
    expect(viewFor(PlayerStatus.READY, RoomPhase.MATCH)).toBe("lobby");
  });

  it("returns lobby for in-match during lobby phase", () => {
    expect(viewFor("in_match", RoomPhase.LOBBY)).toBe("lobby");
    expect(viewFor(PlayerStatus.IN_MATCH, RoomPhase.LOBBY)).toBe("lobby");
  });

  it("returns car_select for in-match during car select", () => {
    expect(viewFor("in_match", RoomPhase.CAR_SELECT)).toBe("car_select");
    expect(viewFor(PlayerStatus.IN_MATCH, RoomPhase.CAR_SELECT)).toBe("car_select");
  });

  it("returns match for in-match during countdown or match", () => {
    expect(viewFor("in_match", RoomPhase.COUNTDOWN)).toBe("match");
    expect(viewFor("in_match", RoomPhase.MATCH)).toBe("match");
    expect(viewFor(PlayerStatus.IN_MATCH, RoomPhase.COUNTDOWN)).toBe("match");
    expect(viewFor(PlayerStatus.IN_MATCH, RoomPhase.MATCH)).toBe("match");
  });
});
