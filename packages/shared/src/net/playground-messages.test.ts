import { describe, expect, it } from "vitest";
import {
  BOT_SESSION_ID,
  MSG_PLAYGROUND_PAUSE,
  MSG_PLAYGROUND_SETUP,
  MSG_PLAYGROUND_SWITCH,
  MSG_PLAYGROUND_TUNING,
  PLAYGROUND_ROOM_NAME,
  defaultPlaygroundSetup,
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
  it("uses the default car's shipped loadout for both cars, the active arena, and bot on", () => {
    const setup = defaultPlaygroundSetup();
    expect(setup.arenaId).toBe("arena-01");
    expect(setup.botEnabled).toBe(true);
    expect(setup.me).toEqual({ carId: "mirage", weapons: ["predator", "thunderclap", "afterburner"] });
    expect(setup.opponent).toEqual({ carId: "mirage", weapons: ["predator", "thunderclap", "afterburner"] });
  });

  it("passes its own validator", () => {
    expect(isPlaygroundSetup(defaultPlaygroundSetup())).toBe(true);
  });
});

describe("isPlaygroundSetup", () => {
  const valid = (): PlaygroundSetup => ({
    botEnabled: true,
    arenaId: "arena-01",
    me: { carId: "bullseye", weapons: ["shockwave", "pepperbox", "lance"] },
    opponent: { carId: "bastion", weapons: ["thumper", "roadblock", "wildcharge"] },
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
