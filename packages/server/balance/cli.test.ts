import { describe, expect, it } from "vitest";
import { DEATHMATCH_CONFIG, GameMode } from "@motor-combat-moba/shared";
import { parseArgs } from "./cli.js";

describe("parseArgs (B41, B42)", () => {
  it("defaults to ffa deathmatch at pro, 50 matches", () => {
    const c = parseArgs([]);
    expect(c).toMatchObject({ shape: "ffa", mode: GameMode.FFA_DEATHMATCH, difficulty: "hard", matches: 50 });
  });

  it("maps player types to difficulties (B42)", () => {
    expect(parseArgs(["--skill=amateur"]).difficulty).toBe("easy");
    expect(parseArgs(["--skill=casual"]).difficulty).toBe("medium");
    expect(parseArgs(["--skill=pro"]).difficulty).toBe("hard");
  });

  it("defaults duel to last-standing, since a duel wants one clean winner", () => {
    expect(parseArgs(["--shape=duel"]).mode).toBe(GameMode.FFA_LAST_STANDING);
  });

  it("lets --mode override the shape default", () => {
    expect(parseArgs(["--shape=duel", "--mode=deathmatch"]).mode).toBe(GameMode.FFA_DEATHMATCH);
  });

  it("generates a seed when none is given", () => {
    expect(Number.isInteger(parseArgs([]).seed)).toBe(true);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseArgs(["--matches=10", "--tyop=3"])).toThrow(/tyop/);
  });

  it("rejects a non-numeric match count", () => {
    expect(() => parseArgs(["--matches=lots"])).toThrow();
  });

  // The default `--match-seconds` changed after the original brief was written: Task 17 made
  // `match.ts` set `state.matchEndsTick = setup.maxTicks`, so this harness's clock IS the
  // deathmatch clock, not a mock of it. The default must be a REAL match length for deathmatch and
  // a generous safety cap (not a target) for last-standing, which ends by elimination.
  it("defaults --match-seconds to the real deathmatch clock for deathmatch", () => {
    expect(parseArgs([]).matchSeconds).toBe(DEATHMATCH_CONFIG.matchSeconds);
  });

  it("defaults --match-seconds to a generous safety cap for last-standing, not a target", () => {
    expect(parseArgs(["--shape=duel"]).matchSeconds).toBe(120);
  });

  it("lets --match-seconds override either default", () => {
    expect(parseArgs(["--match-seconds=30"]).matchSeconds).toBe(30);
  });

  it("carries the skill the flag was given in alongside the resolved difficulty (B42)", () => {
    const c = parseArgs(["--skill=casual"]);
    expect(c.skill).toBe("casual");
    expect(c.difficulty).toBe("medium");
  });

  it("rejects an unknown shape, skill, mode or arena", () => {
    expect(() => parseArgs(["--shape=melee"])).toThrow(/shape/);
    expect(() => parseArgs(["--skill=noob"])).toThrow(/skill/);
    expect(() => parseArgs(["--mode=ffa"])).toThrow(/mode/);
    expect(() => parseArgs(["--arena=arena-99"])).toThrow(/arena/);
  });

  it("passes through --baseline and --out untouched, undefined when absent", () => {
    expect(parseArgs([]).baseline).toBeUndefined();
    expect(parseArgs([]).out).toBeUndefined();
    expect(parseArgs(["--baseline=balance/reports/2026-09-01-01"]).baseline).toBe(
      "balance/reports/2026-09-01-01",
    );
    expect(parseArgs(["--out=/tmp/somewhere"]).out).toBe("/tmp/somewhere");
  });

  it("rejects a bare --baseline or --out rather than silently taking the value \"true\" (fix round 3, defect 7)", () => {
    // Before the fix, a bare `--baseline` (no `=value`) landed as the literal string "true" and
    // was passed straight through as a path — surfacing only much later as a confusing
    // "cannot read true/run.json" filesystem error with no hint the flag itself was the problem.
    expect(() => parseArgs(["--baseline"])).toThrow(/--baseline requires a value/);
    expect(() => parseArgs(["--out"])).toThrow(/--out requires a value/);
  });

  it("still accepts an explicit literal value of \"true\" for --baseline or --out", () => {
    // A directory or file literally named "true" is legal, if odd — only the BARE form (no "="
    // at all) is rejected, never an explicit "=true".
    expect(parseArgs(["--baseline=true"]).baseline).toBe("true");
    expect(parseArgs(["--out=true"]).out).toBe("true");
  });

  it("defaults --arena to arena-01", () => {
    expect(parseArgs([]).arenaId).toBe("arena-01");
  });

  it("parses a negative or zero --matches as an error rather than an empty run", () => {
    expect(() => parseArgs(["--matches=0"])).toThrow();
    expect(() => parseArgs(["--matches=-5"])).toThrow();
  });
});
