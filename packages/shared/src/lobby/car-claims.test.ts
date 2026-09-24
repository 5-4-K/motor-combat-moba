import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { chassisTakenByTeammate, pickDeadlineCar, uniqueChassisApplies } from "./car-claims.js";

const players = [
  { sessionId: "a1", team: 0, lockedCarId: "mirage" },
  { sessionId: "a2", team: 0, lockedCarId: "" },
  { sessionId: "b1", team: 1, lockedCarId: "bastion" },
];

describe("uniqueChassisApplies (CQ26, CQ29)", () => {
  it("is on for Conquer only", () => {
    expect(uniqueChassisApplies(GameMode.CONQUER)).toBe(true);
    expect(uniqueChassisApplies(GameMode.TEAM)).toBe(false);
    expect(uniqueChassisApplies(GameMode.FFA_DEATHMATCH)).toBe(false);
    expect(uniqueChassisApplies(GameMode.FFA_LAST_STANDING)).toBe(false);
  });
});

describe("chassisTakenByTeammate (CQ30)", () => {
  it("sees teammates' locks only, never your own and never the enemy's", () => {
    expect(chassisTakenByTeammate("mirage", 0, "a2", players)).toBe(true);
    expect(chassisTakenByTeammate("mirage", 0, "a1", players)).toBe(false);
    expect(chassisTakenByTeammate("bastion", 0, "a2", players)).toBe(false);
    expect(chassisTakenByTeammate("mirage", 1, "b1", players)).toBe(false);
  });
});

describe("pickDeadlineCar (CQ31)", () => {
  const active = ["bullseye", "mirage", "bastion"] as const;
  it("keeps an untaken preview", () => {
    expect(pickDeadlineCar("bastion", 0, "a2", players, active, "bullseye")).toBe("bastion");
  });
  it("replaces a preview a teammate has taken with the first untaken chassis", () => {
    expect(pickDeadlineCar("mirage", 0, "a2", players, active, "bullseye")).toBe("bullseye");
  });
  it("replaces no preview with the first untaken chassis, skipping a taken fallback", () => {
    const taken = [...players, { sessionId: "a3", team: 0, lockedCarId: "bullseye" }];
    expect(pickDeadlineCar(undefined, 0, "a2", taken, active, "bullseye")).toBe("bastion");
  });
});
