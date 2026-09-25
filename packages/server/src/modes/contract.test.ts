// GM26 (Task 9): one contract every mode's `ModeController` must satisfy, run once per row in
// `MODE_TABLE` (all four, not just the active ones) — a new mode fails this the moment it gets a
// registry row.
import { describe, expect, it } from "vitest";
import {
  ArenaState,
  MODE_TABLE,
  PlayerState,
  rulesOf,
  withMode,
} from "@motor-combat-moba/shared";
import { controllerOf } from "./registry.js";
import type { CombatPlayerView, ModeRoomView } from "./types.js";

const allModes = Object.keys(MODE_TABLE).map(Number);

/**
 * A fresh match: 2 cars on opposite teams, both alive, roster in sync with `state.players`, an
 * arena the mode actually plays (so a conquer-family controller finds a real zone), and every car
 * placed well outside that zone (arena-03's zone sits at its centre, radius 150 — (0, 0) never
 * overlaps it) so the zone reads uncontested/empty either way. Same construction shape as
 * each mode's own `controller.test.ts` (e.g. `modes/last-standing/controller.test.ts`)'s own
 * `stateWith`/`viewOf` helpers.
 */
function freshMatch(mode: number): { view: ModeRoomView; combatPlayers: CombatPlayerView[] } {
  const def = MODE_TABLE[mode as keyof typeof MODE_TABLE];
  const state = new ArenaState();
  state.mode = mode;
  state.arenaId = def.config.arenas[0];
  state.tick = 0;
  state.matchEndsTick = 1000;

  const roster = new Set<string>();
  const seats: Array<{ sessionId: string; team: 0 | 1 }> = [
    { sessionId: "a", team: 0 },
    { sessionId: "b", team: 1 },
  ];
  for (const seat of seats) {
    const player = new PlayerState();
    player.sessionId = seat.sessionId;
    player.team = seat.team;
    player.alive = true;
    player.x = 0;
    player.y = 0;
    state.players.set(seat.sessionId, player);
    roster.add(seat.sessionId);
  }

  const combatPlayers: CombatPlayerView[] = seats.map((seat) => ({
    sessionId: seat.sessionId,
    team: seat.team,
    alive: true,
    inRoster: true,
  }));

  return { view: { state, roster }, combatPlayers };
}

describe.each(allModes)("mode %i contract (server)", (mode) => {
  const def = MODE_TABLE[mode as keyof typeof MODE_TABLE];

  it("afterTick returns undefined for a fresh match with every roster car alive and the clock not expired", () => {
    const { view, combatPlayers } = freshMatch(mode);
    const outcome = withMode(def.config, () => controllerOf(mode).afterTick(view, combatPlayers));
    expect(outcome).toBeUndefined();
  });

  it("onMatchStart sets matchEndsTick to 0 iff !rulesOf(m).hasMatchClock", () => {
    const { view } = freshMatch(mode);
    view.state.matchEndsTick = 12345;
    withMode(def.config, () => controllerOf(mode).onMatchStart(view));
    if (rulesOf(mode).hasMatchClock) {
      expect(view.state.matchEndsTick).not.toBe(0);
    } else {
      expect(view.state.matchEndsTick).toBe(0);
    }
  });
});
