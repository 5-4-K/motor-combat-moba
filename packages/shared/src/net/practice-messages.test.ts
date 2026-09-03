import { describe, expect, it } from "vitest";
import { defaultPracticeSetup, isPracticeSetup } from "./practice-messages.js";

const valid = { name: "Riku", carId: "mirage", opponentCarId: "random", difficulty: "medium" };

describe("isPracticeSetup", () => {
  it("accepts a well-formed setup", () => {
    expect(isPracticeSetup(valid)).toBe(true);
  });

  it("accepts an explicit active opponent chassis", () => {
    expect(isPracticeSetup({ ...valid, opponentCarId: "bastion" })).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isPracticeSetup(null)).toBe(false);
    expect(isPracticeSetup("mirage")).toBe(false);
  });

  it("rejects an unknown or inactive chassis on either side", () => {
    expect(isPracticeSetup({ ...valid, carId: "nope" })).toBe(false);
    expect(isPracticeSetup({ ...valid, opponentCarId: "nope" })).toBe(false);
  });

  it("rejects a prototype-chain name as a chassis", () => {
    expect(isPracticeSetup({ ...valid, carId: "toString" })).toBe(false);
    expect(isPracticeSetup({ ...valid, opponentCarId: "constructor" })).toBe(false);
  });

  it("rejects an unknown difficulty", () => {
    expect(isPracticeSetup({ ...valid, difficulty: "nightmare" })).toBe(false);
  });

  it("rejects a non-string or over-long name", () => {
    expect(isPracticeSetup({ ...valid, name: 7 })).toBe(false);
    expect(isPracticeSetup({ ...valid, name: "x".repeat(17) })).toBe(false);
  });

  it("accepts an empty name — the client's 'Player' fallback is a client concern (PR20)", () => {
    expect(isPracticeSetup({ ...valid, name: "" })).toBe(true);
  });

  it("round-trips its own default", () => {
    expect(isPracticeSetup(defaultPracticeSetup())).toBe(true);
  });
});
