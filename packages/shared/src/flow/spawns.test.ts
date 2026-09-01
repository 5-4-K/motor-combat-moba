import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../arena/arena-01.js";
import type { Spawn } from "../arena/types.js";
import { GameMode } from "../constants.js";
import { assignSpawns } from "./spawns.js";

const identityRandom = () => 0.999;

function spawnKey(spawn: Spawn): string {
  return `${spawn.x},${spawn.y},${spawn.angle}`;
}

describe("assignSpawns FFA", () => {
  it("assigns unique ffa spawn positions", () => {
    const roster = [
      { sessionId: "a", team: 0 as const },
      { sessionId: "b", team: 0 as const },
      { sessionId: "c", team: 1 as const },
      { sessionId: "d", team: 1 as const },
      { sessionId: "e", team: 0 as const },
      { sessionId: "f", team: 1 as const },
    ];

    const assigned = assignSpawns(ARENA_01, GameMode.FFA_LAST_STANDING, roster, identityRandom);
    const keys = roster.map((p) => spawnKey(assigned[p.sessionId]!));
    expect(new Set(keys).size).toBe(6);

    const ffaKeys = new Set(ARENA_01.ffaSpawns.map(spawnKey));
    for (const key of keys) {
      expect(ffaKeys.has(key)).toBe(true);
    }
  });

  it("shuffles using injected random", () => {
    const roster = [
      { sessionId: "a", team: 0 as const },
      { sessionId: "b", team: 0 as const },
      { sessionId: "c", team: 1 as const },
    ];

    const identity = assignSpawns(ARENA_01, GameMode.FFA_LAST_STANDING, roster, identityRandom);
    const shuffled = assignSpawns(ARENA_01, GameMode.FFA_LAST_STANDING, roster, () => 0);

    expect(identity.a).toEqual(ARENA_01.ffaSpawns[0]);
    expect(identity.b).toEqual(ARENA_01.ffaSpawns[1]);
    expect(identity.c).toEqual(ARENA_01.ffaSpawns[2]);
    expect(shuffled.a).not.toEqual(identity.a);
  });

  it("does not mutate ffaSpawns", () => {
    const before = ARENA_01.ffaSpawns.map((s) => ({ ...s }));
    assignSpawns(
      ARENA_01,
      GameMode.FFA_LAST_STANDING,
      [
        { sessionId: "a", team: 0 as const },
        { sessionId: "b", team: 1 as const },
      ],
      () => 0,
    );
    expect(ARENA_01.ffaSpawns).toEqual(before);
  });

  it("throws when roster is longer than ffa spawns", () => {
    const roster = Array.from({ length: 7 }, (_, i) => ({
      sessionId: `p${i}`,
      team: 0 as const,
    }));
    expect(() => assignSpawns(ARENA_01, GameMode.FFA_LAST_STANDING, roster, () => 0)).toThrow(/spawn/i);
  });
});

describe("assignSpawns TEAM", () => {
  it("puts team A on the left and team B on the right", () => {
    const assigned = assignSpawns(
      ARENA_01,
      GameMode.TEAM,
      [
        { sessionId: "a1", team: 0 },
        { sessionId: "b1", team: 1 },
        { sessionId: "a2", team: 0 },
        { sessionId: "b2", team: 1 },
      ],
      () => 0,
    );

    expect(assigned.a1!.x).toBeLessThan(ARENA_01.width / 2);
    expect(assigned.a2!.x).toBeLessThan(ARENA_01.width / 2);
    expect(assigned.b1!.x).toBeGreaterThan(ARENA_01.width / 2);
    expect(assigned.b2!.x).toBeGreaterThan(ARENA_01.width / 2);
  });

  it("assigns team spawns in roster order within each team", () => {
    const assigned = assignSpawns(
      ARENA_01,
      GameMode.TEAM,
      [
        { sessionId: "b-first", team: 1 },
        { sessionId: "a-first", team: 0 },
        { sessionId: "a-second", team: 0 },
      ],
      identityRandom,
    );

    expect(assigned["a-first"]).toEqual(ARENA_01.teamASpawns[0]);
    expect(assigned["a-second"]).toEqual(ARENA_01.teamASpawns[1]);
    expect(assigned["b-first"]).toEqual(ARENA_01.teamBSpawns[0]);
  });

  it("does not mutate team spawn arrays", () => {
    const aBefore = ARENA_01.teamASpawns.map((s) => ({ ...s }));
    const bBefore = ARENA_01.teamBSpawns.map((s) => ({ ...s }));
    assignSpawns(
      ARENA_01,
      GameMode.TEAM,
      [
        { sessionId: "a", team: 0 as const },
        { sessionId: "b", team: 1 as const },
      ],
      () => 0,
    );
    expect(ARENA_01.teamASpawns).toEqual(aBefore);
    expect(ARENA_01.teamBSpawns).toEqual(bBefore);
  });

  it("throws when a team has more players than spawns", () => {
    const roster = [
      { sessionId: "a1", team: 0 as const },
      { sessionId: "a2", team: 0 as const },
      { sessionId: "a3", team: 0 as const },
      { sessionId: "a4", team: 0 as const },
    ];
    expect(() => assignSpawns(ARENA_01, GameMode.TEAM, roster, () => 0)).toThrow(/spawn/i);
  });
});
