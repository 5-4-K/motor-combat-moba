import { describe, expect, it, vi } from "vitest";
import { practiceName } from "./join.js";

describe("practiceName", () => {
  it("uses the typed name", () => {
    expect(practiceName("Riku")).toBe("Riku");
  });

  it("trims surrounding whitespace", () => {
    expect(practiceName("  Riku  ")).toBe("Riku");
  });

  it("falls back to Player on an empty field (PR20)", () => {
    expect(practiceName("")).toBe("Player");
  });

  it("falls back to Player on a whitespace-only field", () => {
    expect(practiceName("   ")).toBe("Player");
  });
});
