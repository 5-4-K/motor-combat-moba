import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { installMode } from "../modes/active.js";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { DEFAULT_CAR_ID, ramDefenceOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { NEUTRAL_MODIFIERS } from "../sim/status/modifiers.js";
import { PlayerStatus } from "../constants.js";
import { boundsOf } from "../arena/bounds.js";
import { getArena } from "../arena/registry.js";
import { modifiersFromRows } from "../sim/status/statuses.js";
import {
  buildStepContext,
  localModifiers,
  remotePoseTickFor,
  type ContextPlayer,
  type ContextState,
} from "./step-context.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

function player(over: Partial<ContextPlayer> = {}): ContextPlayer {
  return {
    x: 0,
    y: 0,
    angle: 0,
    status: PlayerStatus.IN_MATCH,
    carId: "mirage",
    alive: true,
    statuses: [],
    ...over,
  };
}

const ARENA = getArena(ACTIVE_ARENA_ID);

function state(players: Record<string, ContextPlayer>): ContextState {
  return {
    players: {
      forEach(callback) {
        for (const [sessionId, value] of Object.entries(players)) callback(value, sessionId);
      },
    },
  };
}

describe("buildStepContext", () => {
  it("takes obstacles and bounds from the state's arena", () => {
    const ctx = buildStepContext(ARENA, state({ me: player() }), "me", 0, NEUTRAL_MODIFIERS);
    expect(ctx.obstacles).toEqual(ARENA.obstacles);
    // `boundsOf` is the one place a `Bounds` is built from an arena — a polygon arena's carries
    // `planes`, a tile arena's (arena-01 today) does not — so the expectation goes through the same
    // function `buildStepContext` does rather than hand-building either shape.
    expect(ctx.bounds).toEqual(boundsOf(ARENA));
  });

  it("omits the local player from others", () => {
    const ctx = buildStepContext(
      ARENA,
      state({ me: player({ x: 10 }), other: player({ x: 20 }) }),
      "me",
      0,
      NEUTRAL_MODIFIERS,
    );
    expect(ctx.others.map((o) => o.hull.x)).toEqual([20]);
  });

  it("omits players who are not in the match, matching the server's wall gate (isSolid)", () => {
    const ctx = buildStepContext(
      ARENA,
      state({
        me: player(),
        lobby: player({ x: 30, status: PlayerStatus.READY }),
        dead: player({ x: 40, status: PlayerStatus.POST_MATCH }),
        rival: player({ x: 50 }),
      }),
      "me",
      0,
      NEUTRAL_MODIFIERS,
    );
    expect(ctx.others.map((o) => o.hull.x)).toEqual([50]);
  });

  it("orders others by sorted sessionId, exactly like serverTick", () => {
    // `resolveWorld` applies contacts sequentially, so a different order can settle a squeezed car
    // on a different pose. Insertion order is not stable between server and client.
    const ctx = buildStepContext(
      ARENA,
      state({
        me: player(),
        zulu: player({ x: 1 }),
        alpha: player({ x: 2 }),
        mike: player({ x: 3 }),
      }),
      "me",
      0,
      NEUTRAL_MODIFIERS,
    );
    expect(ctx.others.map((o) => o.hull.x)).toEqual([2, 3, 1]);
  });

  it("sizes hulls from DRIVE_CONFIG and carries the other car's angle", () => {
    const ctx = buildStepContext(
      ARENA,
      state({ me: player(), them: player({ angle: 1.25 }) }),
      "me",
      0,
      NEUTRAL_MODIFIERS,
    );
    expect(ctx.others[0]).toEqual({
      hull: {
        x: 0,
        y: 0,
        angle: 1.25,
        w: DRIVE_CONFIG.carWidth,
        h: DRIVE_CONFIG.carHeight,
      },
      ramDefence: ramDefenceOf("mirage"),
    });
  });

  it("carries each other car's ramDefence, not just its hull (stage 2 Task 2)", () => {
    const ctx = buildStepContext(
      ARENA,
      state({ me: player(), them: player({ carId: "bastion" }) }),
      "me",
      0,
      NEUTRAL_MODIFIERS,
    );
    expect(ctx.others[0]!.ramDefence).toBe(ramDefenceOf("bastion"));
  });

  it("sets selfRamDefence from the local player's own car, distinct from any other car's ramDefence", () => {
    const ctx = buildStepContext(
      ARENA,
      state({ me: player({ carId: "bastion" }), them: player({ carId: "mirage" }) }),
      "me",
      0,
      NEUTRAL_MODIFIERS,
    );
    expect(ctx.selfRamDefence).toBe(ramDefenceOf("bastion"));
    expect(ctx.others[0]!.ramDefence).toBe(ramDefenceOf("mirage"));
  });

  it("uses the local player's chosen car", () => {
    expect(
      buildStepContext(ARENA, state({ me: player({ carId: "bastion" }) }), "me", 0, NEUTRAL_MODIFIERS).carId,
    ).toBe("bastion");
  });

  it("falls back to the shared default chassis for an unset or unknown carId", () => {
    expect(
      buildStepContext(ARENA, state({ me: player({ carId: "" }) }), "me", 0, NEUTRAL_MODIFIERS).carId,
    ).toBe(DEFAULT_CAR_ID);
    expect(
      buildStepContext(ARENA, state({ me: player({ carId: "constructor" }) }), "me", 0, NEUTRAL_MODIFIERS).carId,
    ).toBe(DEFAULT_CAR_ID);
  });

  it("falls back to the default chassis when the local player is missing entirely", () => {
    expect(buildStepContext(ARENA, state({ other: player() }), "me", 0, NEUTRAL_MODIFIERS).carId).toBe(
      DEFAULT_CAR_ID,
    );
  });
});

describe("localModifiers", () => {
  /** The wire shape `ArenaState.players` presents: rows with an `effects` list on each player. */
  function stateWith(rows: Iterable<{ statusId: string; startTick: number; endsTick: number }>) {
    return {
      players: {
        get: (id: string) => (id === "me" ? { statuses: rows } : undefined),
      },
    };
  }

  it("is neutral for a player who is not in the room yet", () => {
    expect(localModifiers(stateWith([]), "someone-else", 0)).toEqual(NEUTRAL_MODIFIERS);
  });

  it("is neutral for a player in no status", () => {
    expect(localModifiers(stateWith([]), "me", 0)).toEqual(NEUTRAL_MODIFIERS);
  });

  it("reads the rows through the same shared function the server uses", () => {
    const rows = [{ statusId: "fortified", startTick: 0, endsTick: 500 }];
    expect(localModifiers(stateWith(rows), "me", 0)).toEqual(modifiersFromRows(rows, 0));
  });

  it("stops applying an effect on its endsTick, so a stale patch cannot mispredict a slow", () => {
    const rows = [{ statusId: "spiked", startTick: 0, endsTick: 500 }];
    expect(localModifiers(stateWith(rows), "me", 499).topSpeed).toBeLessThan(1);
    expect(localModifiers(stateWith(rows), "me", 500)).toEqual(NEUTRAL_MODIFIERS);
  });

  it("ignores a row this build has no definition for", () => {
    const rows = [{ statusId: "from-a-newer-build", startTick: 0, endsTick: 500 }];
    expect(localModifiers(stateWith(rows), "me", 0)).toEqual(NEUTRAL_MODIFIERS);
  });
});

describe("buildStepContext carries the modifiers it is given", () => {
  it("puts them on the context, untouched", () => {
    const mods = modifiersFromRows([{ statusId: "fortified", startTick: 0, endsTick: 500 }], 0);
    const ctx = buildStepContext(ARENA, state({ me: player() }), "me", 0, mods);
    expect(ctx.modifiers).toBe(mods);
  });
});

describe("buildStepContext places remotes at their reckoned pose (NR32)", () => {
  const roster = (): ContextState =>
    state({ a: player({ x: 10, y: 20 }), b: player({ x: 300, y: 400, angle: 0.5 }) });

  it("puts a remote's hull where poseOf says it will be", () => {
    const ctx = buildStepContext(ARENA, roster(), "a", 0, NEUTRAL_MODIFIERS, (id) =>
      id === "b" ? { x: 999, y: 999, angle: 0 } : undefined,
    );
    expect(ctx.others.map((o) => [o.hull.x, o.hull.y, o.hull.angle])).toEqual([[999, 999, 0]]);
  });

  it("keeps a remote at its state pose without poseOf, or when poseOf has no answer for it", () => {
    for (const poseOf of [undefined, () => undefined]) {
      const ctx = buildStepContext(ARENA, roster(), "a", 0, NEUTRAL_MODIFIERS, poseOf);
      expect(ctx.others.map((o) => [o.hull.x, o.hull.y, o.hull.angle])).toEqual([[300, 400, 0.5]]);
    }
  });

  it("asks poseOf about remotes only, never the local car", () => {
    // The local car's pose is the predicted body stepSim is handed, not a hull from the roster.
    const asked: string[] = [];
    buildStepContext(ARENA, roster(), "b", 0, NEUTRAL_MODIFIERS, (id) => {
      asked.push(id);
      return undefined;
    });
    expect(asked).toEqual(["a"]);
  });

  it("asks about the tick serverTick has each remote at: stepped before the local car, or not yet (M1)", () => {
    // serverTick steps in sorted sessionId order against the others' CURRENT poses: on tick 50, "a"
    // has already been stepped when "b" is, "c" has not.
    const asked = new Map<string, number>();
    const three = state({ a: player(), b: player(), c: player() });
    buildStepContext(ARENA, three, "b", 50, NEUTRAL_MODIFIERS, (id, tick) => {
      asked.set(id, tick);
      return undefined;
    });
    expect(Object.fromEntries(asked)).toEqual({ a: 50, c: 49 });
    expect(remotePoseTickFor("a", "b", 50)).toBe(50);
    expect(remotePoseTickFor("c", "b", 50)).toBe(49);
  });
});
