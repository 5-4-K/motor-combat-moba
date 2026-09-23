import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GameMode } from "@motor-combat-moba/shared";
import { checkComparable, loadBaseline } from "./baseline.js";
import { botFingerprint, configFingerprint } from "./fingerprint.js";
import type { RunRecord } from "./report.js";

// ---- fixtures -----------------------------------------------------------------------------------
// A minimal but real `RunRecord` — only the fields `checkComparable`/`loadBaseline` actually read
// need to be plausible; the rest is filler that satisfies the type.

function record(): RunRecord {
  return {
    config: {
      shape: "ffa",
      matches: 30,
      mode: GameMode.FFA_DEATHMATCH,
      difficulty: "hard",
      seed: 7,
      arenaId: "arena-01",
      matchSeconds: 40,
      includeInactive: false,
    },
    fingerprints: { config: configFingerprint(GameMode.FFA_DEATHMATCH), bot: botFingerprint() },
    gitCommit: "abc1234",
    startedAt: "2026-09-03T00:00:00.000Z",
    durationSeconds: 3.2,
    totalMatches: 30,
    cars: [],
    weapons: [],
    matchups: [],
    pace: { meanMatchSeconds: 45, meanFirstBloodSeconds: 6.5, killsPerMinute: 4.2, clockFraction: 0.1 },
    unattributedPulseDamage: [],
  };
}

describe("checkComparable (B37)", () => {
  it("accepts two runs with matching fingerprints and shape", () => {
    expect(checkComparable(record(), record()).ok).toBe(true);
  });

  it("refuses when the bot changed, and says so", () => {
    const other = { ...record(), fingerprints: { ...record().fingerprints, bot: "deadbeef" } };
    const result = checkComparable(record(), other);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("bot");
  });

  it("refuses when the config changed, and says so", () => {
    const other = { ...record(), fingerprints: { ...record().fingerprints, config: "deadbeef" } };
    const result = checkComparable(record(), other);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("config fingerprint");
  });

  it("refuses when the shape differs, and says so", () => {
    const other = { ...record(), config: { ...record().config, shape: "duel" as const } };
    const result = checkComparable(record(), other);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("shape");
  });

  it("refuses when the mode differs, and says so", () => {
    const other = { ...record(), config: { ...record().config, mode: GameMode.FFA_LAST_STANDING } };
    const result = checkComparable(record(), other);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("mode");
  });

  it("names both modes by name, not by bare enum integer (MC41)", () => {
    // `mode differs (this run: 2, baseline: 0)` told a reader nothing they could act on.
    const other = { ...record(), config: { ...record().config, mode: GameMode.FFA_LAST_STANDING } };
    const reasons = checkComparable(record(), other).reasons.join(" ");
    expect(reasons).toContain("Deathmatch (mode 2)");
    expect(reasons).toContain("Brawl (mode 0)");
  });

  it("refuses a cross-mode comparison on the FINGERPRINT too, not only on config.mode (MC41)", () => {
    // The two guards are independent on purpose. This one survives a `run.json` whose `config.mode`
    // a reader edited by hand, and it is the one that would catch two modes whose TABLES diverged.
    // Built from real fingerprints of two real modes rather than a hand-typed hash.
    const thisRun = record();
    const baselineRun = {
      ...record(),
      config: { ...record().config, mode: GameMode.FFA_LAST_STANDING },
      fingerprints: {
        config: configFingerprint(GameMode.FFA_LAST_STANDING),
        bot: botFingerprint(),
      },
    };
    const result = checkComparable(thisRun, baselineRun);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("config fingerprint differs");
  });

  it("refuses when --include-inactive differs, and says so", () => {
    // The config FINGERPRINT cannot catch this either, and for a subtler reason than difficulty
    // below: it hashes `CAR_TABLE` whole, so it moves when a chassis is added or `isActive` flips —
    // but two runs over the SAME table under different flags hash identically while having seated
    // different rosters.
    const other = {
      ...record(),
      config: { ...record().config, includeInactive: true },
    };
    const result = checkComparable(record(), other);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("--include-inactive");
  });

  it("refuses when the difficulty differs, and says so", () => {
    // The bot FINGERPRINT cannot catch this: it hashes `BOT_PROFILES` whole, so `--skill=casual`,
    // `--skill=amateur` and `--skill=pro` all produce the same hash. Which tier flew the matches is
    // a property of the run, and it moves every number in the report.
    const other = { ...record(), config: { ...record().config, difficulty: "easy" as const } };
    const result = checkComparable(record(), other);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("difficulty");
  });

  it("still has the same bot fingerprint across tiers, which is why the check above is needed", () => {
    // Pins the reason the clause exists. If `botFingerprint` ever DOES vary by tier, this test fails
    // and the difficulty clause becomes belt-and-braces rather than the only guard — a fact worth
    // learning from a failing test rather than by re-deriving it.
    const pro = { ...record(), config: { ...record().config, difficulty: "hard" as const } };
    const casual = { ...record(), config: { ...record().config, difficulty: "medium" as const } };
    expect(pro.fingerprints.bot).toBe(casual.fingerprints.bot);
  });

  it("warns rather than refuses when only the seed differs, since that is just a different sample", () => {
    const other = { ...record(), config: { ...record().config, seed: 99 } };
    const result = checkComparable(record(), other);
    expect(result.ok).toBe(true);
    expect(result.reasons.join(" ")).toContain("seed");
  });

  it("carries every fatal reason at once, not just the first one found", () => {
    const other = {
      ...record(),
      fingerprints: { config: "deadbeef", bot: "deadbeef" },
      config: { ...record().config, shape: "duel" as const },
    };
    const result = checkComparable(record(), other);
    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(3); // config, bot, shape — all named, none swallowed
  });
});

describe("loadBaseline", () => {
  const tempDirs: string[] = [];
  function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "balance-baseline-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads run.json back into a RunRecord", () => {
    const dir = tempDir();
    const original = record();
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(original), "utf8");
    const loaded = loadBaseline(dir);
    expect(loaded.fingerprints.config).toBe(original.fingerprints.config);
    expect(loaded.config.seed).toBe(original.config.seed);
  });

  it("fails clearly, naming the path, when run.json is missing", () => {
    const dir = tempDir();
    expect(() => loadBaseline(dir)).toThrow(/run\.json/);
  });

  it("fails clearly, naming the path, when run.json is malformed", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "run.json"), "{ not valid json", "utf8");
    expect(() => loadBaseline(dir)).toThrow(/run\.json/);
  });
});
