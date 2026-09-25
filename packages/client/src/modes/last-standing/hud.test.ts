import { beforeEach, describe, expect, it } from "vitest";
import type { ArenaState } from "@motor-combat-moba/shared";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { lastStandingHud } from "./hud.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const state = (matchEndsTick: number) => ({ matchEndsTick }) as unknown as ArenaState;

const card = () => ({ kicker: "Kicker", body: "Body", meta: ["a", "b"] });

describe("lastStandingHud", () => {
  it("returns the given card verbatim from lobbyCard()", () => {
    expect(lastStandingHud(card).lobbyCard()).toEqual({ kicker: "Kicker", body: "Body", meta: ["a", "b"] });
  });

  it("calls the card function fresh on every lobbyCard() call, computing nothing at module scope", () => {
    let calls = 0;
    const hud = lastStandingHud(() => {
      calls += 1;
      return { kicker: "K", body: "B", meta: [] };
    });
    expect(calls).toBe(0);
    hud.lobbyCard();
    hud.lobbyCard();
    expect(calls).toBe(2);
  });

  it("has no clock when there is no match clock (matchEndsTick 0)", () => {
    expect(lastStandingHud(card).clockLabel(state(0), 100)).toBe("");
  });

  it("would still format a clock if matchEndsTick were ever set", () => {
    expect(lastStandingHud(card).clockLabel(state(90 * 30), 0)).toBe("1:30");
  });

  it("carries no kills column", () => {
    expect(lastStandingHud(card).showsKills).toBe(false);
  });

  it("has no results line", () => {
    expect(lastStandingHud(card).resultsLine({} as never, "p1")).toBeUndefined();
  });
});
