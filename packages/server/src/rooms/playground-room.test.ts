import { describe, expect, it } from "vitest";
import { BOT_SESSION_ID, WEAPON_TABLE } from "@motor-combat-moba/shared";
import {
  ARENA_BUSY_ERROR,
  PLAYGROUND_BUSY_ERROR,
  PLAYGROUND_LEVEL,
  loadoutOrChassisChanged,
  otherPlaygroundId,
  pulsedFireSlots,
  shouldRecomputeIntent,
  shouldRefusePlayground,
} from "./PlaygroundRoom.js";
import { shouldRejectSecondArena } from "./singleton-arena.js";

describe("shouldRefusePlayground", () => {
  it("allows an empty arena listing", () => {
    expect(shouldRefusePlayground([])).toBe(false);
  });

  it("allows an arena room that nobody has joined", () => {
    expect(shouldRefusePlayground([{ clients: 0 }])).toBe(false);
  });

  it("refuses while anyone is in the arena — the tuning store is process-wide", () => {
    expect(shouldRefusePlayground([{ clients: 2 }])).toBe(true);
    expect(shouldRefusePlayground([{ clients: 0 }, { clients: 1 }])).toBe(true);
  });
});

// `PlaygroundRoom.onCreate` reuses `shouldRejectSecondArena` unchanged to refuse a SECOND playground
// room (PG15): `maxClients = 1` only rejects a second client, so a full room makes `joinOrCreate`
// spin up another one, and the tuning store `setTuning` writes through is process-wide — two
// playground rooms alive at once fight over it, and either closing wipes the survivor's tables.
describe("shouldRejectSecondArena (reused for the second-playground guard)", () => {
  it("refuses when another playground room is already listed", () => {
    expect(shouldRejectSecondArena([{ roomId: "old" }], "new")).toBe(true);
  });

  it("allows when only this room (about to finish creating) is listed", () => {
    expect(shouldRejectSecondArena([{ roomId: "self" }], "self")).toBe(false);
  });

  it("allows an empty listing", () => {
    expect(shouldRejectSecondArena([], "self")).toBe(false);
  });
});

describe("PLAYGROUND_BUSY_ERROR", () => {
  it("names what happened, not the mechanism", () => {
    expect(PLAYGROUND_BUSY_ERROR).toContain("already open");
  });
});

describe("PLAYGROUND_LEVEL", () => {
  it("unlocks every weapon on the roster, so no slot is dead in the sandbox", () => {
    for (const [id, def] of Object.entries(WEAPON_TABLE)) {
      expect(`${id}:${def.unlocksAt <= PLAYGROUND_LEVEL}`).toBe(`${id}:true`);
    }
  });
});

describe("otherPlaygroundId", () => {
  it("flips the human session to the bot and back", () => {
    expect(otherPlaygroundId("abc", "abc")).toBe(BOT_SESSION_ID);
    expect(otherPlaygroundId(BOT_SESSION_ID, "abc")).toBe("abc");
  });

  it("resolves anything else to the human — an unset control field is not a third car", () => {
    expect(otherPlaygroundId("", "abc")).toBe("abc");
  });
});

describe("ARENA_BUSY_ERROR", () => {
  it("names the fix, not the rule", () => {
    expect(ARENA_BUSY_ERROR).toContain("Close the arena first");
  });
});

describe("loadoutOrChassisChanged (PG32)", () => {
  const setup = {
    carId: "bastion",
    colorId: 3,
    weapons: ["thumper", "roadblock", "wildcharge"],
  } as const;

  it("is false when chassis and loadout both already match", () => {
    expect(loadoutOrChassisChanged("bastion", ["thumper", "roadblock", "wildcharge"], setup)).toBe(
      false,
    );
  });

  it("is true on a chassis change", () => {
    expect(loadoutOrChassisChanged("mirage", ["thumper", "roadblock", "wildcharge"], setup)).toBe(
      true,
    );
  });

  it("is true on a loadout change, including a reorder", () => {
    expect(loadoutOrChassisChanged("bastion", ["thumper", "roadblock", "lance"], setup)).toBe(true);
    expect(loadoutOrChassisChanged("bastion", ["roadblock", "thumper", "wildcharge"], setup)).toBe(
      true,
    );
  });

  it("is true when the room has no loadout recorded yet", () => {
    expect(loadoutOrChassisChanged("bastion", [], setup)).toBe(true);
  });

  it("IGNORES colour — a repaint must not cost hp, cooldowns and a pose (PG32)", () => {
    const repainted = { ...setup, colorId: 5 } as const;
    expect(
      loadoutOrChassisChanged("bastion", ["thumper", "roadblock", "wildcharge"], repainted),
    ).toBe(false);
  });
});

describe("shouldRecomputeIntent (PG29)", () => {
  it("recomputes every tick at reactionTicks 1 — hard is unchanged", () => {
    for (const tick of [0, 1, 2, 3, 97]) {
      expect(shouldRecomputeIntent(tick, 1, true)).toBe(true);
    }
  });

  it("recomputes on the cadence and holds in between", () => {
    expect(shouldRecomputeIntent(9, 3, true)).toBe(true);
    expect(shouldRecomputeIntent(10, 3, true)).toBe(false);
    expect(shouldRecomputeIntent(11, 3, true)).toBe(false);
    expect(shouldRecomputeIntent(12, 3, true)).toBe(true);
  });

  it("recomputes regardless of cadence when there is nothing held", () => {
    // A cleared hold — a setup change, the bot toggled off and back on, a dead target — must not
    // wait out the rest of the interval enqueueing an intent that no longer exists.
    expect(shouldRecomputeIntent(10, 3, false)).toBe(true);
    expect(shouldRecomputeIntent(11, 6, false)).toBe(true);
  });

  it("never divides by zero on a malformed cadence", () => {
    expect(shouldRecomputeIntent(10, 0, true)).toBe(true);
    expect(shouldRecomputeIntent(10, -1, true)).toBe(true);
  });
});

describe("pulsedFireSlots (PG29)", () => {
  it("passes the mask through on a pulse tick and zeroes it otherwise", () => {
    expect(pulsedFireSlots(4, 2, 0b101)).toBe(0b101);
    expect(pulsedFireSlots(5, 2, 0b101)).toBe(0);
  });

  it("pulses a tenth as often on easy as hard", () => {
    expect(pulsedFireSlots(10, 10, 0b1)).toBe(0b1);
    for (const tick of [11, 12, 13, 19]) expect(pulsedFireSlots(tick, 10, 0b1)).toBe(0);
    expect(pulsedFireSlots(20, 10, 0b1)).toBe(0b1);
  });

  it("never divides by zero on a malformed cadence", () => {
    expect(pulsedFireSlots(7, 0, 0b11)).toBe(0b11);
  });
});
