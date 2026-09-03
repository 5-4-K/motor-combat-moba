import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GameMode, type CarId, type WeaponId } from "@motor-combat-moba/shared";
import { configFingerprint, botFingerprint } from "./fingerprint.js";
import { writeReport, type RunRecord } from "./report.js";
import type { Shape } from "./runner.js";
import { wilson } from "./stats.js";

// ---- fixtures -----------------------------------------------------------------------------------
// Kept in this file, not in report.ts: they ARE the readability of the assertions below, and
// report.ts must not carry test-only helpers.

const carIds = ["bastion", "bullseye", "mirage"] as const satisfies readonly CarId[];
const weaponsOf: Record<(typeof carIds)[number], readonly WeaponId[]> = {
  bastion: ["roadblock", "thumper"],
  bullseye: ["predator", "lance"],
  mirage: ["thunderclap", "magmablast"],
};

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "balance-report-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** One plausible `RunRecord`: three cars, six weapons (one row derives its damage), and — for the
 * `duel` shape — the full 3x3 matchup grid including the three mirrors this shape's own noise-floor
 * section leads with. */
function record(opts: { shape?: Shape } = {}): RunRecord {
  const shape: Shape = opts.shape ?? "ffa";
  const totalMatches = shape === "duel" ? 9 : 30;

  const cars = carIds.map((carId, i) => ({
    carId,
    matches: totalMatches,
    wins: 10 + i,
    winRate: wilson(10 + i, totalMatches),
    meanPlacement: 2 - i * 0.2,
    kills: 20 + i,
    deaths: 15 + i,
    damageDealt: 500 + i * 10,
    damageTaken: 400 + i * 5,
    meanAliveSeconds: 30 + i,
    phasedFraction: 0.1,
  }));

  const weapons = carIds.flatMap((carId) =>
    weaponsOf[carId].map((weaponId, i) => ({
      weaponId,
      carId,
      presses: 40 + i,
      connectingPresses: 20 + i,
      hitRate: wilson(20 + i, 40 + i),
      damage: 300 + i * 10,
      // Only `magmablast` (mirage) derives any damage in this fixture, mirroring the real game's
      // "corroded's only source is an explosion" rule — it exercises the report's conditional
      // `Derived` column without every row needing one.
      derivedDamage: weaponId === "magmablast" ? 40 : 0,
      kills: 2 + i,
      damagePerPress: (300 + i * 10) / (40 + i),
      kitDamageShare: 0.5,
      pressesPerMinute: 12,
      meanFirstUseSeconds: 5 + i,
    })),
  );

  const matchups =
    shape === "duel"
      ? carIds.flatMap((attacker) =>
          carIds.map((defender) => ({
            attacker,
            defender,
            // Mirrors land exactly on 50% here, as they must in a rig with no positional bias —
            // the report's job is to SAY that plainly, not to fabricate a biased fixture.
            winRate: wilson(attacker === defender ? 5 : 6, 10),
            meanTicks: 250,
            meanWinnerHp: 40,
          })),
        )
      : [];

  return {
    config: {
      shape,
      matches: shape === "duel" ? 1 : totalMatches,
      mode: GameMode.FFA_DEATHMATCH,
      difficulty: "hard",
      seed: 7,
      arenaId: "arena-01",
      matchSeconds: 40,
    },
    fingerprints: { config: configFingerprint(), bot: botFingerprint() },
    gitCommit: "abc1234",
    startedAt: "2026-09-03T00:00:00.000Z",
    durationSeconds: 3.2,
    totalMatches,
    cars,
    weapons,
    matchups,
    pace: {
      meanMatchSeconds: 45,
      meanFirstBloodSeconds: 6.5,
      killsPerMinute: 4.2,
      clockFraction: 0.1,
    },
  };
}

function readSummary(opts: { shape?: Shape } = {}): string {
  const dir = tempDir();
  writeReport(dir, record(opts));
  return fs.readFileSync(path.join(dir, "summary.md"), "utf8");
}

describe("writeReport (B38, B39, B40)", () => {
  it("writes summary.md, matches.csv, weapons.csv and run.json", () => {
    const files = writeReport(tempDir(), record());
    expect(files.map((f) => path.basename(f)).sort())
      .toEqual(["matches.csv", "run.json", "summary.md", "weapons.csv"]);
  });

  it("prints every rate with its interval, never bare (B35)", () => {
    const md = readSummary();
    expect(md).toMatch(/\d+\.\d%\s*\(\s*\d+\.\d–\d+\.\d\s*\)/);
  });

  it("carries seed, shape, mode, commit and both fingerprints in the header", () => {
    const md = readSummary();
    for (const token of ["seed", "shape", "mode", "commit", "config fingerprint", "bot fingerprint"]) {
      expect(md.toLowerCase()).toContain(token);
    }
  });

  it("prints the bot profile values verbatim, so an old report stays interpretable", () => {
    expect(readSummary()).toContain("standoffUnits");
  });

  it("states its limitations in its own body (B40)", () => {
    const md = readSummary().toLowerCase();
    expect(md).toContain("model of skill");
    expect(md).toContain("run #1 validates the rig");
  });

  it("leads the duel table with the mirror noise floor (B26a)", () => {
    const md = readSummary({ shape: "duel" });
    expect(md.indexOf("Mirror")).toBeLessThan(md.indexOf("Matchup matrix"));
  });

  it("omits the mirror section and matchup matrix for an ffa run (no duel data to show)", () => {
    const md = readSummary({ shape: "ffa" });
    expect(md).not.toContain("Mirror noise floor");
    expect(md).not.toContain("Matchup matrix");
  });

  it("adds a Derived column to the weapon table when derivedDamage > 0, and omits it otherwise", () => {
    const md = readSummary();
    expect(md).toContain("Derived");
    expect(md).toContain("magmablast");
  });

  it("adds a deltas section only when a baseline is supplied", () => {
    const dirNoBaseline = tempDir();
    writeReport(dirNoBaseline, record());
    const withoutBaseline = fs.readFileSync(path.join(dirNoBaseline, "summary.md"), "utf8");
    expect(withoutBaseline).not.toContain("Deltas vs baseline");

    const dirWithBaseline = tempDir();
    writeReport(dirWithBaseline, record(), record());
    const withBaseline = fs.readFileSync(path.join(dirWithBaseline, "summary.md"), "utf8");
    expect(withBaseline).toContain("Deltas vs baseline");
  });

  it("round-trips run.json, so a baseline can be read back", () => {
    const dir = tempDir();
    writeReport(dir, record());
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
    expect(parsed.fingerprints.config).toBe(configFingerprint());
  });
});
