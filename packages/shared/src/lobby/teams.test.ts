import { describe, expect, it } from "vitest";
import { pickTeam, pickColor, canSwitchTeam } from "./teams.js";

describe("pickTeam", () => {
  it("joins the smaller team", () => {
    expect(pickTeam([0, 0, 1], () => 0)).toBe(1);
    expect(pickTeam([0, 1, 1], () => 0)).toBe(0);
  });
  it("uses random when equal", () => {
    expect(pickTeam([0, 1], () => 0)).toBe(0);
    expect(pickTeam([0, 1], () => 0.9)).toBe(1);
  });
});

describe("pickColor", () => {
  it("returns an unused colorId", () => {
    const id = pickColor([0, 1, 2], () => 0);
    expect([3, 4, 5]).toContain(id);
  });
});

describe("canSwitchTeam", () => {
  const ready = { status: "ready" as const };

  it("allows a switch into a team with room", () => {
    expect(canSwitchTeam({ ...ready, team: 0 }, [0, 0, 1])).toBe(true);
  });

  it("refuses a switch into a team already at MAX_TEAM_SIZE", () => {
    const full = [1, 1, 1, 1];
    expect(canSwitchTeam({ ...ready, team: 0 }, [0, ...full])).toBe(false);
  });

  it("counts only the destination team", () => {
    // Four on team 0 does not block a switch from 1 into... 0 is full, so refused;
    // the mirror case (into 1, which is empty) is allowed.
    expect(canSwitchTeam({ ...ready, team: 1 }, [0, 0, 0, 0, 1])).toBe(false);
    expect(canSwitchTeam({ ...ready, team: 0 }, [0, 0, 0, 0])).toBe(true);
  });

  it("refuses unless the player is ready", () => {
    expect(canSwitchTeam({ status: "in_match", team: 0 }, [0])).toBe(false);
    expect(canSwitchTeam({ status: "post_match", team: 0 }, [0])).toBe(false);
  });

  it("ignores the switching player's own seat on the team they are leaving", () => {
    // Player is on 0; team 1 holds three. Moving is fine and lands them fourth.
    expect(canSwitchTeam({ ...ready, team: 0 }, [0, 1, 1, 1])).toBe(true);
  });
});
