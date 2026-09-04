import { describe, expect, it } from "vitest";
import { botFingerprint, botFingerprintInput, configFingerprint } from "./fingerprint.js";

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

  it("includes BOT_BRAIN_VERSION in what it hashes (H46)", () => {
    // A hash of BOT_PROFILES alone cannot see a behaviour change made entirely in code, with every
    // tier's numbers left untouched — that is exactly what BOT_BRAIN_VERSION exists to catch, so it
    // has to be part of the hashed payload, not just a fact botFingerprint happens to be stable
    // under.
    expect(botFingerprintInput()).toHaveProperty("BOT_BRAIN_VERSION");
  });
});
