import { describe, expect, it } from "vitest";
import { normalizeName, validateName, isNameTaken } from "./names.js";

describe("normalizeName", () => {
  it("trims whitespace", () => {
    expect(normalizeName("  Ada  ")).toBe("Ada");
  });
});

describe("validateName", () => {
  it("rejects empty after trim", () => {
    expect(validateName("   ")).toEqual({ ok: false, error: "Name must be 1–16 characters" });
  });
  it("rejects longer than 16", () => {
    expect(validateName("a".repeat(17)).ok).toBe(false);
  });
  it("accepts 1–16", () => {
    expect(validateName("A")).toEqual({ ok: true, name: "A" });
    expect(validateName("abcdefghijklmnop")).toEqual({ ok: true, name: "abcdefghijklmnop" });
  });
});

describe("isNameTaken", () => {
  const existing = ["Ada", "bob"];
  it("is case-insensitive", () => {
    expect(isNameTaken(existing, "ada")).toBe(true);
    expect(isNameTaken(existing, "BOB")).toBe(true);
    expect(isNameTaken(existing, "Cam")).toBe(false);
  });
});
