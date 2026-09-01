import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import {
  killedByText,
  matchClockLabel,
  respawnSeconds,
  showKilledBy,
} from "./deathmatch-hud.js";

describe("matchClockLabel", () => {
  it("counts down in m:ss", () => {
    expect(matchClockLabel(0, 90 * TICK_RATE_HZ)).toBe("1:30");
    expect(matchClockLabel(30 * TICK_RATE_HZ, 90 * TICK_RATE_HZ)).toBe("1:00");
  });

  it("floors, so it never briefly claims a second that has not elapsed", () => {
    expect(matchClockLabel(1, 90 * TICK_RATE_HZ)).toBe("1:29");
  });

  it("clamps at zero rather than counting backwards past the end", () => {
    expect(matchClockLabel(200 * TICK_RATE_HZ, 90 * TICK_RATE_HZ)).toBe("0:00");
  });

  it("is empty when there is no deathmatch clock to show", () => {
    expect(matchClockLabel(500, 0)).toBe("");
  });
});

describe("respawnSeconds", () => {
  it("counts whole seconds down from the delay, rounding up so it ends on 1 not 0", () => {
    expect(respawnSeconds(0, 0)).toBe(5);
    expect(respawnSeconds(0, TICK_RATE_HZ)).toBe(4);
    expect(respawnSeconds(0, 5 * TICK_RATE_HZ)).toBe(0);
  });

  it("is zero for a car that has not died", () => {
    expect(respawnSeconds(0, 900)).toBe(0);
  });
});

describe("the killed-you banner", () => {
  it("shows for three seconds after death, then stops", () => {
    expect(showKilledBy(false, 100, 100)).toBe(true);
    expect(showKilledBy(false, 100, 100 + 3 * TICK_RATE_HZ - 1)).toBe(true);
    expect(showKilledBy(false, 100, 100 + 3 * TICK_RATE_HZ)).toBe(false);
  });

  it("never shows for a living car, including one that just respawned", () => {
    expect(showKilledBy(true, 0, 10)).toBe(false);
    expect(showKilledBy(false, 0, 10)).toBe(false);
  });

  it("names the killer", () => {
    expect(killedByText("Rig")).toBe("Rig killed you");
  });

  it("falls back rather than printing an empty name", () => {
    expect(killedByText("")).toBe("You were destroyed");
  });
});
