import { afterEach, describe, expect, it } from "vitest";
import { getMaxPracticeRooms, isDevToolsEnabled, parseCarSelectSeconds } from "./mode.js";

describe("parseCarSelectSeconds", () => {
  it("uses a positive numeric env value", () => {
    expect(parseCarSelectSeconds("8", 60)).toBe(8);
  });

  it("falls back when unset, empty, zero, or invalid", () => {
    expect(parseCarSelectSeconds(undefined, 60)).toBe(60);
    expect(parseCarSelectSeconds("", 60)).toBe(60);
    expect(parseCarSelectSeconds("0", 60)).toBe(60);
    expect(parseCarSelectSeconds("-5", 60)).toBe(60);
    expect(parseCarSelectSeconds("nope", 60)).toBe(60);
  });
});

describe("isDevToolsEnabled", () => {
  const original = process.env.DEV_TOOLS;

  afterEach(() => {
    if (original === undefined) delete process.env.DEV_TOOLS;
    else process.env.DEV_TOOLS = original;
  });

  it("is on for the exact string \"1\"", () => {
    process.env.DEV_TOOLS = "1";
    expect(isDevToolsEnabled()).toBe(true);
  });

  // A release build must not register the playground on a near-miss value, so nothing truthy-ish
  // counts: the gate is one literal.
  it("is off for anything else, unset included", () => {
    delete process.env.DEV_TOOLS;
    expect(isDevToolsEnabled()).toBe(false);
    for (const value of ["", "0", "true", "yes", " 1", "1 ", "01"]) {
      process.env.DEV_TOOLS = value;
      expect(`${value}:${isDevToolsEnabled()}`).toBe(`${value}:false`);
    }
  });
});

describe("getMaxPracticeRooms", () => {
  const original = process.env.MAX_PRACTICE_ROOMS;

  afterEach(() => {
    if (original === undefined) delete process.env.MAX_PRACTICE_ROOMS;
    else process.env.MAX_PRACTICE_ROOMS = original;
  });

  it("uses a numeric env value", () => {
    process.env.MAX_PRACTICE_ROOMS = "2";
    expect(getMaxPracticeRooms(6)).toBe(2);
  });

  // Unlike the tick rate and the car-select clock, zero is meaningful here: it is how a host turns
  // practice off on a machine that only exists to run the arena.
  it("accepts zero — that is how a host disables practice", () => {
    process.env.MAX_PRACTICE_ROOMS = "0";
    expect(getMaxPracticeRooms(6)).toBe(0);
  });

  it("falls back when unset, empty, negative or invalid", () => {
    delete process.env.MAX_PRACTICE_ROOMS;
    expect(getMaxPracticeRooms(6)).toBe(6);
    for (const value of ["", "-1", "nope"]) {
      process.env.MAX_PRACTICE_ROOMS = value;
      expect(`${value}:${getMaxPracticeRooms(6)}`).toBe(`${value}:6`);
    }
  });
});
