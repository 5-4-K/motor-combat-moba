import { describe, expect, it } from "vitest";
import { ACTIVE_ARENA_ID, DEFAULT_CAR_ID, DRIVE_CONFIG, PlayerStatus, getArena } from "@motor-combat-moba/shared";
import { buildStepContext, type ContextPlayer, type ContextState } from "./step-context.js";

function player(over: Partial<ContextPlayer> = {}): ContextPlayer {
  return {
    x: 0,
    y: 0,
    angle: 0,
    status: PlayerStatus.IN_MATCH,
    carId: "rectangle",
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
    const ctx = buildStepContext(ARENA, state({ me: player() }), "me");
    expect(ctx.obstacles).toEqual(ARENA.obstacles);
    expect(ctx.bounds).toEqual({ width: ARENA.width, height: ARENA.height });
  });

  it("omits the local player from others", () => {
    const ctx = buildStepContext(
      ARENA,
      state({ me: player({ x: 10 }), other: player({ x: 20 }) }),
      "me",
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
    );
    expect(ctx.others.map((hull) => hull.x)).toEqual([2, 3, 1]);
  });

  it("sizes hulls from DRIVE_CONFIG and carries the other car's angle", () => {
    const ctx = buildStepContext(ARENA, state({ me: player(), them: player({ angle: 1.25 }) }), "me");
    expect(ctx.others[0]).toEqual({
      x: 0,
      y: 0,
      angle: 1.25,
      w: DRIVE_CONFIG.carWidth,
      h: DRIVE_CONFIG.carHeight,
    });
  });

  it("uses the local player's chosen car", () => {
    expect(buildStepContext(ARENA, state({ me: player({ carId: "hexagon" }) }), "me").carId).toBe("hexagon");
  });

  it("falls back to the shared default chassis for an unset or unknown carId", () => {
    expect(buildStepContext(ARENA, state({ me: player({ carId: "" }) }), "me").carId).toBe(DEFAULT_CAR_ID);
    expect(buildStepContext(ARENA, state({ me: player({ carId: "constructor" }) }), "me").carId).toBe(
      DEFAULT_CAR_ID,
    );
  });

  it("falls back to the default chassis when the local player is missing entirely", () => {
    expect(buildStepContext(ARENA, state({ other: player() }), "me").carId).toBe(DEFAULT_CAR_ID);
  });
});
