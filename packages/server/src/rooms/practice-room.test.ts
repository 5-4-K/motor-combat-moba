import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GameMode,
  PRACTICE_CONFIG,
  PlayerState,
  RoomPhase,
  activeCarIds,
  hpOf,
  newFireState,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../config/bot-profiles.js";
import { newPracticeState } from "./PracticeRoom.js";
import { isIdleWarningDue, isPracticeIdle } from "./practice-rules.js";

const ROOM_SOURCE = readFileSync(
  fileURLToPath(new URL("./PracticeRoom.ts", import.meta.url)),
  "utf8",
);

describe("newPracticeState (PR9)", () => {
  it("opens in MATCH — nothing in this room reduces a flow to get there", () => {
    expect(newPracticeState().phase).toBe(RoomPhase.MATCH);
  });

  it("runs deathmatch rules, so death respawns instead of eliminating", () => {
    expect(newPracticeState().mode).toBe(GameMode.FFA_DEATHMATCH);
  });

  // The whole point of practice: no clock, so no win condition can arrive. `matchClockLabel` reads
  // a non-positive value as "no clock", which is what drops the HUD timer with no client change.
  it("leaves matchEndsTick at 0 — a deathmatch with no deadline", () => {
    expect(newPracticeState().matchEndsTick).toBe(0);
  });

  it("starts unpaused", () => {
    expect(newPracticeState().paused).toBe(false);
  });
});

// The tuning store is a MODULE-LEVEL singleton, one per server process rather than one per room, so
// a practice room that wrote to it would silently re-balance every other room in the process —
// including a live arena match. There is no typed way to assert an absence, so this reads the source.
describe("the practice room never touches the tuning store (PR10)", () => {
  it("does not mention setTuning anywhere in its module", () => {
    expect(ROOM_SOURCE).not.toContain("setTuning");
  });
});

// Strict mirror (PR1): a practice car must be the car a real match gives you. Both of these are
// absences in `addCar`, and an absence is exactly what a later edit reinstates without noticing.
describe("practice cars are shipped cars, not sandbox cars", () => {
  it("never pins a level — PlayerState's own default is what an arena match starts you at", () => {
    expect(ROOM_SOURCE).not.toContain("player.level =");
  });

  it("never writes a loadout, so newFireState falls back to the chassis's shipped kit", () => {
    expect(ROOM_SOURCE).not.toContain("loadouts.set");
  });
});

describe("practice room rules", () => {
  it("warns before it closes, never after", () => {
    const { idleTimeoutSeconds: t, idleWarningSeconds: w } = PRACTICE_CONFIG;
    const warnAt = (t - w) * 1000;
    expect(isIdleWarningDue(0, warnAt, t, w)).toBe(true);
    expect(isPracticeIdle(0, warnAt, t)).toBe(false);
  });

  it("ships a profile for every difficulty the setup guard accepts", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      expect(BOT_PROFILES[difficulty]).toBeDefined();
    }
  });
});

// Not the room's own code, but what the two absences above rest on: a practice car is built by
// `respawnPlayer` from nothing but its chassis and `PlayerState`'s default level, so every chassis a
// setup can name must arrive with hp and a full kit at level 1 — no slot may be dead on arrival.
describe("every chassis practice can seat is armed at the default level", () => {
  const defaultLevel = new PlayerState().level;

  it("has hp and a shipped kit with no loadout written", () => {
    for (const carId of activeCarIds()) {
      const slots = newFireState(carId, defaultLevel).slots.length;
      expect(`${carId}:${hpOf(carId) > 0}:${slots}`).toBe(`${carId}:true:3`);
    }
  });
});
