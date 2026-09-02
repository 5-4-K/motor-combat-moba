import { describe, expect, it } from "vitest";
import { COLOR_TABLE, isColorId } from "../config/color-config.js";
import {
  BOT_SESSION_ID,
  MSG_PLAYGROUND_PAUSE,
  MSG_PLAYGROUND_SETUP,
  MSG_PLAYGROUND_SWITCH,
  MSG_PLAYGROUND_TUNING,
  PLAYGROUND_ROOM_NAME,
  defaultPlaygroundSetup,
  isBotDifficulty,
  isPlaygroundSetup,
  type PlaygroundSetup,
} from "./playground-messages.js";

describe("playground message constants", () => {
  it("exports the room name and bot session id", () => {
    expect(PLAYGROUND_ROOM_NAME).toBe("playground");
    expect(BOT_SESSION_ID).toBe("bot");
  });

  it("exports the four message type strings", () => {
    expect(MSG_PLAYGROUND_PAUSE).toBe("pg_pause");
    expect(MSG_PLAYGROUND_SWITCH).toBe("pg_switch");
    expect(MSG_PLAYGROUND_TUNING).toBe("pg_tuning");
    expect(MSG_PLAYGROUND_SETUP).toBe("pg_setup");
  });
});

describe("defaultPlaygroundSetup", () => {
  it("uses the default car's shipped loadout for both cars, the active arena, and bot off", () => {
    const setup = defaultPlaygroundSetup();
    expect(setup.arenaId).toBe("arena-01");
    expect(setup.botEnabled).toBe(false);
    expect(setup.me).toEqual({
      carId: "mirage",
      colorId: 0,
      weapons: ["magmablast", "thunderclap", "afterburner"],
    });
    expect(setup.opponent).toEqual({
      carId: "mirage",
      colorId: 1,
      weapons: ["magmablast", "thunderclap", "afterburner"],
    });
  });

  it("passes its own validator", () => {
    expect(isPlaygroundSetup(defaultPlaygroundSetup())).toBe(true);
  });
});

describe("isPlaygroundSetup", () => {
  const valid = (): PlaygroundSetup => ({
    botEnabled: true,
    botDifficulty: "medium",
    arenaId: "arena-01",
    me: { carId: "bullseye", colorId: 0, weapons: ["magmablast", "pepperbox", "lance"] },
    opponent: { carId: "bastion", colorId: 1, weapons: ["thumper", "roadblock", "wildcharge"] },
  });

  it("accepts a well-formed setup", () => {
    expect(isPlaygroundSetup(valid())).toBe(true);
  });

  it("accepts the same weapon on both cars (only within-car dupes are illegal)", () => {
    const setup = valid();
    // "lance" now appears on both `me` and `opponent` — legal (spec PG17).
    (setup.opponent.weapons as string[])[0] = "lance";
    expect(isPlaygroundSetup(setup)).toBe(true);
  });

  it("rejects a duplicate weapon within one car's own three slots", () => {
    const setup = valid();
    (setup.me.weapons as string[]) = ["lance", "lance", "pepperbox"];
    expect(isPlaygroundSetup(setup)).toBe(false);
  });

  it("rejects an unknown weapon id", () => {
    const setup = valid();
    (setup.me.weapons as string[]) = ["lance", "pepperbox", "not-a-real-weapon"];
    expect(isPlaygroundSetup(setup)).toBe(false);
  });

  it("rejects an inactive-format carId reaching in through the prototype chain", () => {
    const setup = valid();
    (setup.me as { carId: string }).carId = "toString";
    expect(isPlaygroundSetup(setup)).toBe(false);
  });

  it("rejects an unknown arenaId", () => {
    const setup = valid();
    (setup as { arenaId: string }).arenaId = "arena-99";
    expect(isPlaygroundSetup(setup)).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isPlaygroundSetup(null)).toBe(false);
    expect(isPlaygroundSetup(undefined)).toBe(false);
    expect(isPlaygroundSetup("nope")).toBe(false);
    expect(isPlaygroundSetup(42)).toBe(false);
  });
});

describe("isBotDifficulty", () => {
  it("accepts the three literals", () => {
    expect(isBotDifficulty("easy")).toBe(true);
    expect(isBotDifficulty("medium")).toBe(true);
    expect(isBotDifficulty("hard")).toBe(true);
  });

  it("rejects anything else, including prototype-chain names", () => {
    expect(isBotDifficulty("HARD")).toBe(false);
    expect(isBotDifficulty("")).toBe(false);
    expect(isBotDifficulty("toString")).toBe(false);
    expect(isBotDifficulty("constructor")).toBe(false);
    expect(isBotDifficulty(0)).toBe(false);
    expect(isBotDifficulty(null)).toBe(false);
    expect(isBotDifficulty(undefined)).toBe(false);
  });
});

describe("defaultPlaygroundSetup (PG26)", () => {
  it("opens alone, on medium, with two distinct colours", () => {
    const setup = defaultPlaygroundSetup();
    expect(setup.botEnabled).toBe(false);
    expect(setup.botDifficulty).toBe("medium");
    expect(setup.me.colorId).not.toBe(setup.opponent.colorId);
    expect(isColorId(setup.me.colorId)).toBe(true);
    expect(isColorId(setup.opponent.colorId)).toBe(true);
  });

  it("is itself a valid setup", () => {
    expect(isPlaygroundSetup(defaultPlaygroundSetup())).toBe(true);
  });
});

describe("isPlaygroundSetup (PG24 — the three new fields)", () => {
  /** A full, valid v2 payload. Each rejection case below mutates exactly one field of a clone. */
  function valid(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(defaultPlaygroundSetup())) as Record<string, unknown>;
  }

  it("accepts a full v2 payload", () => {
    expect(isPlaygroundSetup(valid())).toBe(true);
  });

  it("rejects a missing botDifficulty", () => {
    const msg = valid();
    delete msg.botDifficulty;
    expect(isPlaygroundSetup(msg)).toBe(false);
  });

  it("rejects an unknown botDifficulty", () => {
    expect(isPlaygroundSetup({ ...valid(), botDifficulty: "nightmare" })).toBe(false);
  });

  it("rejects a missing colorId on either car", () => {
    const noMine = valid();
    delete (noMine.me as Record<string, unknown>).colorId;
    expect(isPlaygroundSetup(noMine)).toBe(false);

    const noTheirs = valid();
    delete (noTheirs.opponent as Record<string, unknown>).colorId;
    expect(isPlaygroundSetup(noTheirs)).toBe(false);
  });

  it("rejects a colorId that is not an integer in COLOR_TABLE", () => {
    for (const bad of [-1, 1.5, COLOR_TABLE.length, "0", null, NaN]) {
      const msg = valid();
      (msg.me as Record<string, unknown>).colorId = bad;
      expect(isPlaygroundSetup(msg)).toBe(false);
    }
  });

  it("still accepts the SAME colour on both cars (PG31 — no guard)", () => {
    const msg = valid();
    (msg.opponent as Record<string, unknown>).colorId = (msg.me as Record<string, unknown>).colorId;
    expect(isPlaygroundSetup(msg)).toBe(true);
  });
});
