import { beforeEach, describe, expect, it } from "vitest";
import { installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { MAX_PLAYERS } from "../constants.js";
import { WEAPON_SLOT_CONFIG } from "../config/weapon-slots.js";
import {
  BOT_SESSION_ID,
  MSG_PLAYGROUND_PAUSE,
  MSG_PLAYGROUND_SETUP,
  MSG_PLAYGROUND_TUNING,
  PLAYGROUND_ROOM_NAME,
  PLAYGROUND_SEATS,
  PLAYGROUND_SEAT_IDS,
  defaultPlaygroundSetup,
  isBotDebugPayload,
  isBotDifficulty,
  isPlaygroundSetup,
  type PlaygroundSetup,
} from "./playground-messages.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

describe("playground message constants", () => {
  it("exports the room name and bot session id", () => {
    expect(PLAYGROUND_ROOM_NAME).toBe("playground");
    expect(BOT_SESSION_ID).toBe("bot");
  });

  it("exports the message type strings", () => {
    expect(MSG_PLAYGROUND_PAUSE).toBe("pg_pause");
    expect(MSG_PLAYGROUND_TUNING).toBe("pg_tuning");
    expect(MSG_PLAYGROUND_SETUP).toBe("pg_setup");
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

describe("playground seats (PG56)", () => {
  it("has one seat per player the game allows", () => {
    expect(PLAYGROUND_SEATS).toBe(MAX_PLAYERS);
    expect(PLAYGROUND_SEAT_IDS).toHaveLength(PLAYGROUND_SEATS);
  });

  it("names them in seat order, and they are all distinct", () => {
    expect(PLAYGROUND_SEAT_IDS[0]).toBe("pg-0");
    expect(PLAYGROUND_SEAT_IDS[PLAYGROUND_SEATS - 1]).toBe(`pg-${PLAYGROUND_SEATS - 1}`);
    expect(new Set(PLAYGROUND_SEAT_IDS).size).toBe(PLAYGROUND_SEATS);
  });

  it("never collides with the practice room's bot id (PG59)", () => {
    expect(PLAYGROUND_SEAT_IDS).not.toContain(BOT_SESSION_ID);
  });
});

describe("defaultPlaygroundSetup (PG65)", () => {
  it("opens on two enabled seats, driving the first", () => {
    const setup = defaultPlaygroundSetup();
    expect(setup.cars).toHaveLength(PLAYGROUND_SEATS);
    expect(setup.cars.map((c) => c.enabled)).toEqual([true, true, false, false, false, false]);
    expect(setup.drivenSeat).toBe(0);
    expect(setup.botEnabled).toBe(false);
    expect(setup.botDifficulty).toBe("medium");
  });

  it("paints every seat a distinct colour", () => {
    const setup = defaultPlaygroundSetup();
    expect(new Set(setup.cars.map((c) => c.colorId)).size).toBe(PLAYGROUND_SEATS);
  });

  it("is itself valid", () => {
    expect(isPlaygroundSetup(defaultPlaygroundSetup())).toBe(true);
  });
});

describe("isPlaygroundSetup (PG63)", () => {
  /** A fresh, legal payload each call, so a mutation in one case cannot leak into the next. */
  const valid = (): PlaygroundSetup => defaultPlaygroundSetup();

  it("accepts a legal six-seat payload", () => {
    expect(isPlaygroundSetup(valid())).toBe(true);
  });

  it("accepts six enabled seats", () => {
    const setup = { ...valid(), cars: valid().cars.map((c) => ({ ...c, enabled: true })) };
    expect(isPlaygroundSetup(setup)).toBe(true);
  });

  it("rejects a cars list of the wrong length", () => {
    expect(isPlaygroundSetup({ ...valid(), cars: valid().cars.slice(0, 2) })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), cars: [...valid().cars, valid().cars[0]] })).toBe(false);
  });

  it("rejects a cars value that is not an array", () => {
    expect(isPlaygroundSetup({ ...valid(), cars: { 0: valid().cars[0] } })).toBe(false);
  });

  it("rejects a seat missing its enabled flag", () => {
    const cars = valid().cars.map((c, i) => (i === 3 ? { ...c, enabled: undefined } : c));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(false);
  });

  it("rejects a seat whose three weapons are not distinct (PG17)", () => {
    const cars = valid().cars.map((c, i) =>
      i === 0 ? { ...c, weapons: [c.weapons[0], c.weapons[0], c.weapons[2]] } : c,
    );
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(false);
  });

  it("accepts the same weapon on two DIFFERENT seats (PG17)", () => {
    const base = valid();
    const cars = base.cars.map((c, i) => (i === 1 ? { ...c, weapons: base.cars[0]!.weapons } : c));
    expect(isPlaygroundSetup({ ...base, cars })).toBe(true);
  });

  it("accepts a seat with fewer than N distinct weapons (VS34)", () => {
    const cars = valid().cars.map((c, i) => (i === 0 ? { ...c, weapons: [c.weapons[0]!] } : c));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(true);
  });

  it("rejects a seat with no weapons at all", () => {
    const cars = valid().cars.map((c, i) => (i === 0 ? { ...c, weapons: [] } : c));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(false);
  });

  it("rejects a seat with more weapons than this build's N ability slots", () => {
    const over = Array.from(
      { length: WEAPON_SLOT_CONFIG.maxAbilitySlots + 1 },
      (_, i) => (["lance", "predator", "pepperbox", "tremor", "thumper"] as const)[i]!,
    );
    const cars = valid().cars.map((c, i) => (i === 0 ? { ...c, weapons: over } : c));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(false);
  });

  it("still loads a three-entry setup written by an older build (VS34)", () => {
    // No length field was ever persisted; three distinct weapons is legal at any N >= 3.
    const cars = valid().cars.map((c, i) =>
      i === 0 ? { ...c, weapons: ["thumper", "roadblock", "wildcharge"] } : c,
    );
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(true);
  });

  it("accepts the same colour on two seats (PG31)", () => {
    const cars = valid().cars.map((c) => ({ ...c, colorId: 0 }));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(true);
  });

  it("rejects a payload with no enabled seat", () => {
    const cars = valid().cars.map((c) => ({ ...c, enabled: false }));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(false);
  });

  it("rejects a drivenSeat out of range", () => {
    expect(isPlaygroundSetup({ ...valid(), drivenSeat: -1 })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), drivenSeat: PLAYGROUND_SEATS })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), drivenSeat: 0.5 })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), drivenSeat: "0" })).toBe(false);
  });

  it("rejects a drivenSeat naming a DISABLED seat", () => {
    // Seat 2 is off in the default setup, so this is the whole rule in one line.
    expect(isPlaygroundSetup({ ...valid(), drivenSeat: 2 })).toBe(false);
  });

  it("still rejects a bad arena, difficulty or bot flag", () => {
    expect(isPlaygroundSetup({ ...valid(), arenaId: "arena-99" })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), botDifficulty: "nightmare" })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), botEnabled: "yes" })).toBe(false);
  });

  it("rejects a prototype-chain id rather than resolving it", () => {
    const cars = valid().cars.map((c, i) => (i === 0 ? { ...c, carId: "toString" } : c));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(false);
  });
});

describe("isBotDebugPayload", () => {
  const payload = {
    tick: 10, situation: "fight", targetSessionId: "them",
    goalRange: 300, goalFacing: "orbit", firedSlot: 1,
    bestHitChance: 0.72, hitChanceBar: 0.7, steer: 1, throttle: -1,
  };

  it("accepts a well-formed payload", () => {
    expect(isBotDebugPayload(payload)).toBe(true);
  });

  it("accepts the ram situation and the no-goal facing (BB54)", () => {
    expect(isBotDebugPayload({ ...payload, situation: "ram", goalFacing: "none" })).toBe(true);
  });

  it("rejects a payload with an unknown situation or facing", () => {
    expect(isBotDebugPayload({ ...payload, situation: "vibing" })).toBe(false);
    expect(isBotDebugPayload({ ...payload, goalFacing: "sideways" })).toBe(false);
  });

  it("rejects a payload missing any field", () => {
    for (const key of Object.keys(payload)) {
      const partial: Record<string, unknown> = { ...payload };
      delete partial[key];
      expect(isBotDebugPayload(partial), `missing ${key}`).toBe(false);
    }
  });

  it("rejects a non-finite number and a slot below the -1 sentinel", () => {
    expect(isBotDebugPayload({ ...payload, goalRange: NaN })).toBe(false);
    expect(isBotDebugPayload({ ...payload, firedSlot: -2 })).toBe(false);
  });

  it("rejects a steer/throttle outside -1|0|1", () => {
    expect(isBotDebugPayload({ ...payload, steer: 2 })).toBe(false);
    expect(isBotDebugPayload({ ...payload, throttle: 0.5 })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isBotDebugPayload(null)).toBe(false);
    expect(isBotDebugPayload("fight")).toBe(false);
  });
});
