import { describe, expect, it } from "vitest";
import { botFingerprint, configFingerprint } from "./fingerprint.js";

describe("fingerprints (B39)", () => {
  it("is stable across calls", () => {
    expect(configFingerprint()).toBe(configFingerprint());
  });

  it("is a short hex string, readable in a header", () => {
    expect(configFingerprint()).toMatch(/^[0-9a-f]{8,16}$/);
  });

  it("distinguishes the config and bot hashes", () => {
    expect(configFingerprint()).not.toBe(botFingerprint());
  });

  it("botFingerprint is also stable and short", () => {
    expect(botFingerprint()).toBe(botFingerprint());
    expect(botFingerprint()).toMatch(/^[0-9a-f]{8,16}$/);
  });
});
