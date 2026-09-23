import { describe, expect, it } from "vitest";
import { GameMode, TICK_RATE_HZ, modeConfigOf } from "@motor-combat-moba/shared";
import {
  botFingerprint,
  botFingerprintInput,
  configFingerprint,
  configFingerprintInput,
} from "./fingerprint.js";

const BRAWL = GameMode.FFA_LAST_STANDING;
const DEATHMATCH = GameMode.FFA_DEATHMATCH;

describe("fingerprints (B39)", () => {
  it("is stable across calls", () => {
    expect(configFingerprint(BRAWL)).toBe(configFingerprint(BRAWL));
  });

  it("is a short hex string, readable in a header", () => {
    expect(configFingerprint(BRAWL)).toMatch(/^[0-9a-f]{8,16}$/);
  });

  it("distinguishes the config and bot hashes", () => {
    expect(configFingerprint(BRAWL)).not.toBe(botFingerprint());
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

  it("gives two modes two fingerprints, even with byte-identical tables (MC41)", () => {
    // Brawl and Deathmatch ship identical tables today (`table-pinning.test.ts` enforces that), so
    // the hash this replaced — over the mode-blind raw globals — gave them the same value and let
    // `--baseline` compare a Brawl run against a Deathmatch one as though the two measured the
    // same game. Two things now carry the mode in, the top-level `mode` key and the bundle's own
    // `ModeConfig.id`; this asserts the PROPERTY, so it holds whichever of them survives a future
    // edit and fails only if both go.
    expect(configFingerprint(BRAWL)).not.toBe(configFingerprint(DEATHMATCH));
  });

  it("hashes the MODE'S BUNDLE, not the raw config globals (MC41)", () => {
    // The payload, not the hash: a hash is stable whatever it covers, so only this can say that a
    // per-mode-only table edit would move it. `spike`, `turret`, `statusConfig` and `statusLimits`
    // are named because the hand-written list this replaced read the sim's other tables and missed
    // those four outright.
    const input = configFingerprintInput(BRAWL) as { mode: unknown; bundle: Record<string, unknown> };
    expect(input.mode).toBe(BRAWL);
    expect(input.bundle).toBe(modeConfigOf(BRAWL));
    for (const table of ["cars", "weapons", "drive", "ram", "impulse", "combat", "turret",
      "statusConfig", "statusTable", "statusLimits", "spike", "slots", "deathmatch", "camera",
      "derived"]) {
      expect(input.bundle[table], `bundle.${table} must be part of what is hashed`).toBeDefined();
    }
  });

  it("hashes the globals no mode owns, which the bundle cannot carry", () => {
    const input = configFingerprintInput(BRAWL) as Record<string, unknown>;
    expect(input.TICK_RATE_HZ).toBe(TICK_RATE_HZ);
    expect(input.ARENAS).toBeDefined();
    expect(input.LOGICAL_CANVAS).toBeDefined();
  });
});
