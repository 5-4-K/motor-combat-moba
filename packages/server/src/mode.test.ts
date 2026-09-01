import { afterEach, describe, expect, it } from "vitest";
import { isDevToolsEnabled, parseCarSelectSeconds } from "./mode.js";

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
