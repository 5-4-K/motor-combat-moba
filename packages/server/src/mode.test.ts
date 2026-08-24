import { describe, expect, it } from "vitest";
import { parseCarSelectSeconds } from "./mode.js";

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
