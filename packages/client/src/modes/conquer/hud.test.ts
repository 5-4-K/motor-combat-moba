import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { ArenaState } from "@motor-combat-moba/shared";
import {
  DEFAULT_GAME_MODE,
  GameMode,
  PlayerStatus,
  installMode,
  modeConfigOf,
  withMode,
} from "@motor-combat-moba/shared";
import type { ResultsViewState } from "../../ui/results-view.js";
import { CONQUER_HUD } from "./hud.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const withConquerMode = <T>(fn: () => T): T => withMode(modeConfigOf(GameMode.CONQUER), fn);

const state = (matchEndsTick: number) => ({ matchEndsTick }) as unknown as ArenaState;

const roster = [
  { sessionId: "p1", name: "Vex", colorId: 0, team: 0, carId: "mirage", status: PlayerStatus.POST_MATCH, kills: 0, deaths: 0 },
  { sessionId: "p2", name: "Nyx", colorId: 2, team: 1, carId: "bullseye", status: PlayerStatus.POST_MATCH, kills: 0, deaths: 0 },
];

const resultsState = (over: Partial<ResultsViewState> = {}): ResultsViewState => ({
  mode: GameMode.CONQUER,
  winnerSessionId: "",
  winnerTeam: 0,
  tick: 0,
  matchStartedAtTick: 0,
  players: roster,
  controlTicksA: 0,
  controlTicksB: 0,
  ...over,
});

// CQ41, CQ58: Conquer's lobby card is published now that `isActive: true`.
describe("CONQUER_HUD lobby card (CQ41, CQ58)", () => {
  it("builds a Conquer card with 3v3 / clock / zone-control meta, from the mode's own accessors", () => {
    withConquerMode(() => {
      expect(CONQUER_HUD.lobbyCard().meta).toEqual(["3v3", "3:00", "zone control"]);
    });
  });

  it("reads Conquer's own bundle by GameMode, not the ambient installed mode", () => {
    // DEFAULT_GAME_MODE (Brawl) is installed above, not Conquer.
    const card = CONQUER_HUD.lobbyCard();
    const bundle = modeConfigOf(GameMode.CONQUER);
    expect(card.meta).toEqual([`${bundle.conquer.teamSize}v${bundle.conquer.teamSize}`, "3:00", "zone control"]);
    expect(card.body).not.toContain("Two teams of three");
  });

  it("never calls the ambient conquer()/deathmatch() accessors for the Conquer card's own numbers", () => {
    // Scoped to the `lobbyCard` function body, not the whole file — this module's own doc comment
    // names those two accessors in prose, which a whole-file match would trip on.
    const source = readFileSync(new URL("./hud.ts", import.meta.url), "utf8");
    const lobbyCardBlock = source.slice(source.indexOf("lobbyCard: () => {"), source.indexOf("clockLabel: () =>"));
    expect(lobbyCardBlock).not.toMatch(/\bconquer\(\)/);
    expect(lobbyCardBlock).not.toMatch(/\bdeathmatch\(\)/);
  });
});

describe("CONQUER_HUD.clockLabel", () => {
  it("is always empty — the clock lives in the gutter (CQ56)", () => {
    expect(CONQUER_HUD.clockLabel(state(90 * 30), 0)).toBe("");
    expect(CONQUER_HUD.clockLabel(state(0), 0)).toBe("");
  });
});

it("carries no kills column", () => {
  expect(CONQUER_HUD.showsKills).toBe(false);
});

// CQ33: the results screen's Conquer-only control line, built off the room's raw control ticks.
describe("CONQUER_HUD.resultsLine (CQ33)", () => {
  it("reports both teams' control percentage", () => {
    withConquerMode(() => {
      const line = CONQUER_HUD.resultsLine(
        resultsState({ controlTicksA: 765, controlTicksB: 325 }),
        "p1",
      );
      expect(line).toBe("Control — You 42.50% · Them 18.05%");
    });
  });

  it("is viewer-relative: team B reads its own bar first", () => {
    withConquerMode(() => {
      const line = CONQUER_HUD.resultsLine(
        resultsState({ controlTicksA: 765, controlTicksB: 325 }),
        "p2",
      );
      expect(line).toBe("Control — You 18.05% · Them 42.50%");
    });
  });
});

// Conquer's title is viewer-relative ("You win"), like its HUD's US/THEM.
describe("CONQUER_HUD.resultsHeadline", () => {
  it("reads You win / You lose from the viewer's team, Draw on a tie", () => {
    withConquerMode(() => {
      expect(CONQUER_HUD.resultsHeadline?.(resultsState({ winnerTeam: 0 }), "p1")).toBe("You win");
      expect(CONQUER_HUD.resultsHeadline?.(resultsState({ winnerTeam: 0 }), "p2")).toBe("You lose");
      expect(CONQUER_HUD.resultsHeadline?.(resultsState({ winnerTeam: 1 }), "p2")).toBe("You win");
      expect(CONQUER_HUD.resultsHeadline?.(resultsState({ winnerTeam: -1 }), "p1")).toBe("Draw");
    });
  });
});
