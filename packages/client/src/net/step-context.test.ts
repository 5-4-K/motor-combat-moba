import { describe, expect, it } from "vitest";
import {
  ACTIVE_ARENA_ID,
  DEFAULT_CAR_ID,
  DRIVE_CONFIG,
  NEUTRAL_MODIFIERS,
  PlayerStatus,
  getArena,
  modifiersFromRows,
} from "@motor-combat-moba/shared";
import {
  buildStepContext,
  localModifiers,
  type ContextPlayer,
  type ContextState,
} from "./step-context.js";

function player(over: Partial<ContextPlayer> = {}): ContextPlayer {
  return {
    x: 0,
    y: 0,
    angle: 0,
    status: PlayerStatus.IN_MATCH,
    carId: "mirage",
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
    const ctx = buildStepContext(ARENA, state({ me: player() }), "me", NEUTRAL_MODIFIERS);
    expect(ctx.obstacles).toEqual(ARENA.obstacles);
    expect(ctx.bounds).toEqual({ width: ARENA.width, height: ARENA.height });
  });

  it("omits the local player from others", () => {
    const ctx = buildStepContext(
      ARENA,
      state({ me: player({ x: 10 }), other: player({ x: 20 }) }),
      "me",
      NEUTRAL_MODIFIERS,
    );
    expect(ctx.others.map((hull) => hull.x)).toEqual([20]);
  });

  it("omits players who are not in the match, matching the server's mover gate", () => {
    const ctx = buildStepContext(
      ARENA,
      state({
        me: player(),
        lobby: player({ x: 30, status: PlayerStatus.READY }),
        dead: player({ x: 40, status: PlayerStatus.POST_MATCH }),
        rival: player({ x: 50 }),
      }),
      "me",
      NEUTRAL_MODIFIERS,
    );
    expect(ctx.others.map((hull) => hull.x)).toEqual([50]);
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
      NEUTRAL_MODIFIERS,
    );
    expect(ctx.others.map((hull) => hull.x)).toEqual([2, 3, 1]);
  });

  it("sizes hulls from DRIVE_CONFIG and carries the other car's angle", () => {
    const ctx = buildStepContext(ARENA, state({ me: player(), them: player({ angle: 1.25 }) }), "me", NEUTRAL_MODIFIERS);
    expect(ctx.others[0]).toEqual({
      x: 0,
      y: 0,
      angle: 1.25,
      w: DRIVE_CONFIG.carWidth,
      h: DRIVE_CONFIG.carHeight,
    });
  });

  it("uses the local player's chosen car", () => {
    expect(buildStepContext(ARENA, state({ me: player({ carId: "bastion" }) }), "me", NEUTRAL_MODIFIERS).carId).toBe("bastion");
  });

  it("falls back to the shared default chassis for an unset or unknown carId", () => {
    expect(buildStepContext(ARENA, state({ me: player({ carId: "" }) }), "me", NEUTRAL_MODIFIERS).carId).toBe(DEFAULT_CAR_ID);
    expect(buildStepContext(ARENA, state({ me: player({ carId: "constructor" }) }), "me", NEUTRAL_MODIFIERS).carId).toBe(
      DEFAULT_CAR_ID,
    );
  });

  it("falls back to the default chassis when the local player is missing entirely", () => {
    expect(buildStepContext(ARENA, state({ other: player() }), "me", NEUTRAL_MODIFIERS).carId).toBe(DEFAULT_CAR_ID);
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
    const ctx = buildStepContext(ARENA, state({ me: player() }), "me", mods);
    expect(ctx.modifiers).toBe(mods);
  });
});
