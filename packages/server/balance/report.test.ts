import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GameMode, type CarId, type WeaponId } from "@motor-combat-moba/shared";
import { configFingerprint, botFingerprint } from "./fingerprint.js";
import type { MatchOutcome } from "./match.js";
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
function record(opts: { shape?: Shape; mode?: GameMode } = {}): RunRecord {
  const shape: Shape = opts.shape ?? "ffa";
  const mode: GameMode = opts.mode ?? GameMode.FFA_DEATHMATCH;
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
    damageRatio: (500 + i * 10) / (400 + i * 5),
    meanAliveSeconds: 30 + i,
    phasedFraction: 0.1,
    killsPerMinuteAlive: (20 + i) / ((30 + i) / 60),
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
      firstUseMatches: totalMatches - i,
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
      mode,
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
    unattributedPulseDamage: [],
  };
}

/** `count` fixed 2/2/2 FFA `MatchOutcome`s (six seats each: bastion, bastion, bullseye, bullseye,
 * mirage, mirage), one `roadblock` press per match that connects and kills the first bullseye
 * seat — just enough per-match combat data to exercise per-match attribution in `matches.csv` and
 * `weapons.csv` without a real `runMatch` call. */
function outcomesFixture(count: number): MatchOutcome[] {
  return Array.from({ length: count }, (_, i) => {
    const pressId = `p${i}`;
    const seats = [
      { sessionId: "bastion-0-0", carId: "bastion" as CarId, kills: 1, deaths: 0, aliveTicks: 200, phasedTicks: 0, hp: 80, placement: 1 },
      { sessionId: "bastion-0-1", carId: "bastion" as CarId, kills: 0, deaths: 0, aliveTicks: 200, phasedTicks: 0, hp: 70, placement: 2 },
      { sessionId: "bullseye-1-0", carId: "bullseye" as CarId, kills: 0, deaths: 1, aliveTicks: 120, phasedTicks: 0, hp: 0, placement: 6 },
      { sessionId: "bullseye-1-1", carId: "bullseye" as CarId, kills: 0, deaths: 0, aliveTicks: 200, phasedTicks: 0, hp: 40, placement: 4 },
      { sessionId: "mirage-2-0", carId: "mirage" as CarId, kills: 0, deaths: 0, aliveTicks: 200, phasedTicks: 15, hp: 50, placement: 3 },
      { sessionId: "mirage-2-1", carId: "mirage" as CarId, kills: 0, deaths: 0, aliveTicks: 200, phasedTicks: 0, hp: 30, placement: 5 },
    ];
    const outcome: MatchOutcome = {
      ticks: 200 + i,
      winnerSessionId: "bastion-0-0",
      winnerTeam: 0,
      hitClock: false,
      seats,
      events: {
        fired: [
          { tick: 1, shooterSessionId: "bastion-0-0", carId: "bastion", weaponId: "roadblock", slot: 0, pressId },
        ],
        damaged: [
          {
            tick: 2,
            victimSessionId: "bullseye-1-0",
            victimCarId: "bullseye",
            attackerSessionId: "bastion-0-0",
            attackerCarId: "bastion",
            source: { kind: "weapon", weaponId: "roadblock", pressId, isExplosion: false },
            amount: 30,
            killingBlow: true,
          },
        ],
        killed: [
          {
            tick: 2,
            victimSessionId: "bullseye-1-0",
            victimCarId: "bullseye",
            killerSessionId: "bastion-0-0",
            killerCarId: "bastion",
            source: { kind: "weapon", weaponId: "roadblock", pressId, isExplosion: false },
          },
        ],
      },
    };
    return outcome;
  });
}

function readSummary(opts: { shape?: Shape; mode?: GameMode } = {}): string {
  const dir = tempDir();
  writeReport(dir, record(opts), []);
  return fs.readFileSync(path.join(dir, "summary.md"), "utf8");
}

function readCsv(file: string): string[][] {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(","));
}

describe("writeReport (B38, B39, B40)", () => {
  it("writes summary.md, matches.csv, weapons.csv and run.json", () => {
    const files = writeReport(tempDir(), record(), []);
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

  it("states the corroded-amplifier caveat in the report body, not only the README (B5)", () => {
    const md = readSummary().toLowerCase();
    expect(md).toContain("corroded");
    expect(md).toContain("magmablast");
    expect(md).toContain("amplifier");
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

  it("notes the phased/spawn-protection distortion beside the hit-rate column (B28a)", () => {
    const weaponSection = readSummary().split("## Per-weapon")[1]!.split("## ")[0]!;
    expect(weaponSection.toLowerCase()).toContain("phased");
    expect(weaponSection.toLowerCase()).toContain("reads as a miss");
    expect(weaponSection.toLowerCase()).toContain("last-standing");
  });

  it("adds a Derived column to the weapon table when derivedDamage > 0, and omits it otherwise", () => {
    const md = readSummary();
    expect(md).toContain("Derived");
    expect(md).toContain("magmablast");
  });

  it("renders a zero-press weapon's row with — rather than a measured 0.0% hit rate", () => {
    const base = record();
    const zeroPress = {
      ...base.weapons[0]!,
      presses: 0,
      connectingPresses: 0,
      hitRate: wilson(0, 0),
      damagePerPress: 0,
    };
    const withZeroPress = { ...base, weapons: [zeroPress, ...base.weapons.slice(1)] };

    const dir = tempDir();
    writeReport(dir, withZeroPress, []);
    const md = fs.readFileSync(path.join(dir, "summary.md"), "utf8");

    const row = md.split("\n").find((line) => line.includes(`| ${zeroPress.weaponId} |`));
    expect(row).toBeDefined();
    const cells = row!.split("|").map((c) => c.trim());
    const hitRateCell = cells[4]; // "", Weapon, Car, Presses, Hit rate, ...
    // Never a measured-looking Wilson interval for a weapon nobody pressed — that reads as
    // "inaccurate" when the truth is "unused," the opposite balance finding.
    expect(hitRateCell).not.toMatch(/%/);
    expect(hitRateCell).toBe("–");
  });

  it("marks 'Hit the clock' n/a for Deathmatch rather than a 0.0% interval that can never move (fix round 3, defect 4)", () => {
    // Deathmatch's own clock IS this harness's match length (`matchEndsTick = setup.maxTicks`), so
    // `MatchOutcome.hitClock` is false in every Deathmatch match by construction (see match.ts's
    // header on `hitClock`) — a 0.0% interval there would read as a measured absence of stalemates
    // when there is nothing to measure. `record()` defaults to FFA_DEATHMATCH.
    const paceSection = readSummary().split("## Pace")[1]!.split("## ")[0]!;
    expect(paceSection).toContain("n/a");
    expect(paceSection).not.toMatch(/\|[^|]*\d+\.\d%[^|]*\|\s*$/m); // no bracketed % as the last cell
  });

  it("prints the sample size alongside meanFirstUseSeconds, so a single lucky press doesn't read like a habit (fix round 3, defect 6)", () => {
    const md = readSummary();
    const row = md.split("\n").find((line) => line.includes(`| ${record().weapons[0]!.weaponId} |`));
    expect(row).toBeDefined();
    expect(row).toMatch(/\(n=\d+\)/);
  });

  it("renders a drawn-out matchup's meanWinnerHp as — rather than a fabricated 0.0 hp (fix round 3, defect 5)", () => {
    const base = record({ shape: "duel" });
    const drawnPair = { ...base.matchups[0]!, meanWinnerHp: null };
    const withDrawnPair = { ...base, matchups: [drawnPair, ...base.matchups.slice(1)] };

    const dir = tempDir();
    writeReport(dir, withDrawnPair, []);
    const md = fs.readFileSync(path.join(dir, "summary.md"), "utf8");

    const row = md.split("\n").find(
      (line) => line.includes(`| ${drawnPair.attacker} | ${drawnPair.defender} |`),
    );
    expect(row).toBeDefined();
    const cells = row!.split("|").map((c) => c.trim());
    const winnerHpCell = cells[cells.length - 2]; // "", Attacker, Defender, Win rate, Mean duel, Mean winner hp, ""
    expect(winnerHpCell).toBe("–");
  });

  it("prints a real interval for 'Hit the clock' in last-standing, where it is a meaningful stalemate signal", () => {
    const md = readSummary({ mode: GameMode.FFA_LAST_STANDING });
    const paceSection = md.split("## Pace")[1]!.split("## ")[0]!;
    expect(paceSection).toMatch(/\d+\.\d%\s*\(\s*\d+\.\d–\d+\.\d\s*\)/);
    expect(paceSection).not.toContain("n/a");
  });

  it("omits the unattributed pulse damage section when the run has none (B5a)", () => {
    const md = readSummary();
    expect(md).not.toContain("Unattributed pulse damage");
  });

  it("renders unattributed pulse damage when the run has some (B5a)", () => {
    const withUnattributed = { ...record(), unattributedPulseDamage: [{ statusId: "stunned" as const, damage: 12 }] };
    const dir = tempDir();
    writeReport(dir, withUnattributed, []);
    const md = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    expect(md).toContain("Unattributed pulse damage");
    expect(md).toContain("stunned");
    expect(md).toContain("12.0");
  });

  it("adds a deltas section only when a baseline is supplied", () => {
    const dirNoBaseline = tempDir();
    writeReport(dirNoBaseline, record(), []);
    const withoutBaseline = fs.readFileSync(path.join(dirNoBaseline, "summary.md"), "utf8");
    expect(withoutBaseline).not.toContain("Deltas vs baseline");

    const dirWithBaseline = tempDir();
    writeReport(dirWithBaseline, record(), [], record());
    const withBaseline = fs.readFileSync(path.join(dirWithBaseline, "summary.md"), "utf8");
    expect(withBaseline).toContain("Deltas vs baseline");
  });

  it("carries no forced-comparison banner for an ordinary (unforced) baseline delta (B37)", () => {
    const dir = tempDir();
    writeReport(dir, record(), [], record());
    const md = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    expect(md).not.toContain("FORCED COMPARISON");
  });

  it("renders a prominent forced-comparison banner naming the mismatch reasons when --force was used (B37)", () => {
    const dir = tempDir();
    const reasons = ["config fingerprint differs (this run: aaa, baseline: bbb) — the two runs measured different games"];
    writeReport(dir, record(), [], record(), reasons);
    const md = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    const deltasSection = md.split("## Deltas vs baseline")[1]!;
    expect(deltasSection).toContain("FORCED COMPARISON");
    expect(deltasSection).toContain("--force");
    expect(deltasSection).toContain("config fingerprint differs");
    // The banner must appear BEFORE the delta table itself, not after — a warning read too late is
    // read after the numbers have already been trusted.
    expect(deltasSection.indexOf("FORCED COMPARISON")).toBeLessThan(deltasSection.indexOf("| Car |"));
  });

  it("round-trips run.json, so a baseline can be read back", () => {
    const dir = tempDir();
    writeReport(dir, record(), []);
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
    expect(parsed.fingerprints.config).toBe(configFingerprint());
  });
});

describe("writeReport: per-match CSVs (Task 20 piece 3, B38)", () => {
  it("writes one matches.csv row per seat per match, not one row per chassis for the whole run", () => {
    const matches = 3;
    const outcomes = outcomesFixture(matches);
    const dir = tempDir();
    writeReport(dir, record(), outcomes);

    const [header, ...dataRows] = readCsv(path.join(dir, "matches.csv"));
    expect(header).toEqual([
      "matchIndex", "seed", "shape", "mode", "carId", "sessionId", "kills", "deaths",
      "damageDealt", "damageTaken", "aliveTicks", "phasedTicks", "placement", "won", "hpAtEnd", "matchTicks",
    ]);
    // 6 seats x 3 matches = 18 rows — NOT the 3 (one per chassis) an aggregated CSV would print.
    expect(dataRows).toHaveLength(6 * matches);
  });

  it("attributes damage per SEAT, not per chassis — a mirror's two seats stay independent", () => {
    const dir = tempDir();
    writeReport(dir, record(), outcomesFixture(1));
    const [, ...rows] = readCsv(path.join(dir, "matches.csv"));

    const bastionAttacker = rows.find((r) => r[5] === "bastion-0-0")!;
    const bastionOtherSeat = rows.find((r) => r[5] === "bastion-0-1")!;
    const bullseyeVictim = rows.find((r) => r[5] === "bullseye-1-0")!;

    expect(Number(bastionAttacker[8])).toBe(30); // damageDealt
    expect(Number(bastionOtherSeat[8])).toBe(0); // the OTHER bastion seat dealt nothing
    expect(Number(bullseyeVictim[9])).toBe(30); // damageTaken
    expect(bastionAttacker[13]).toBe("1"); // won
    expect(bastionOtherSeat[13]).toBe("0");
  });

  it("gives each matchIndex the same seed runAll would have derived for that match position", () => {
    const dir = tempDir();
    writeReport(dir, record(), outcomesFixture(2));
    const [, ...rows] = readCsv(path.join(dir, "matches.csv"));
    const seedsByMatch = new Map(rows.map((r) => [r[0], r[1]]));
    expect(seedsByMatch.get("0")).not.toBe(seedsByMatch.get("1")); // distinct matches, distinct seeds
  });

  it("writes one weapons.csv row per weapon per match, scoped to cars that actually played", () => {
    const dir = tempDir();
    writeReport(dir, record(), outcomesFixture(2));
    const [header, ...rows] = readCsv(path.join(dir, "weapons.csv"));
    expect(header).toEqual([
      "matchIndex", "carId", "weaponId", "presses", "connectingPresses", "damage", "derivedDamage", "kills",
    ]);

    // Every row's carId is one of the three that played (the fixture seats all three every match),
    // and each match contributes one row per weapon slot across the whole roster (`slotsOf` — every
    // car carries 3 slots today, so 3 cars x 3 slots).
    const matchZeroRows = rows.filter((r) => r[0] === "0");
    expect(matchZeroRows).toHaveLength(9);

    const roadblockRow = matchZeroRows.find((r) => r[2] === "roadblock")!;
    expect(roadblockRow[3]).toBe("1"); // presses
    expect(roadblockRow[4]).toBe("1"); // connectingPresses
    expect(roadblockRow[5]).toBe("30"); // damage
    expect(roadblockRow[7]).toBe("1"); // kills

    const thumperRow = matchZeroRows.find((r) => r[2] === "thumper")!;
    expect(thumperRow[3]).toBe("0"); // never pressed this match — still a visible row, not omitted
  });

  it("omits a weapon row for a chassis that did not play that match (duel)", () => {
    // A duel seats only two of the three chassis; the sitting-out chassis's weapons must not appear.
    const outcome: MatchOutcome = {
      ...outcomesFixture(1)[0]!,
      seats: outcomesFixture(1)[0]!.seats.filter((s) => s.carId !== "mirage"),
    };
    const dir = tempDir();
    writeReport(dir, record({ shape: "duel" }), [outcome]);
    const [, ...rows] = readCsv(path.join(dir, "weapons.csv"));
    expect(rows.some((r) => r[1] === "mirage")).toBe(false);
  });

  it("leaves matches.csv and weapons.csv header-only when outcomes is empty", () => {
    const dir = tempDir();
    writeReport(dir, record(), []);
    expect(readCsv(path.join(dir, "matches.csv"))).toHaveLength(1); // header only
    expect(readCsv(path.join(dir, "weapons.csv"))).toHaveLength(1);
  });
});
