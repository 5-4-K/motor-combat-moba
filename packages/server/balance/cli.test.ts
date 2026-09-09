import { describe, expect, it } from "vitest";
import { DEATHMATCH_CONFIG, GameMode } from "@motor-combat-moba/shared";
import { helpText, KNOWN_FLAGS, parseArgs, wantsHelp } from "./cli.js";

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
    expect(parseArgs(["--shape=duel"]).matchSeconds).toBe(300);
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

  it("defaults --force to false, and a bare --force (no value) sets it (B37)", () => {
    // Unlike --baseline/--out, --force takes no value — it must NOT be in REQUIRES_EXPLICIT_VALUE,
    // so the bare form (the only form anyone would actually type) is the one that has to work.
    expect(parseArgs([]).force).toBe(false);
    expect(parseArgs(["--force"]).force).toBe(true);
    expect(() => parseArgs(["--force"])).not.toThrow();
  });

  it("also accepts --force=true, since a boolean flag's explicit form should not be an error", () => {
    expect(parseArgs(["--force=true"]).force).toBe(true);
  });

  it("defaults --arena to arena-01", () => {
    expect(parseArgs([]).arenaId).toBe("arena-01");
  });

  it("parses a negative or zero --matches as an error rather than an empty run", () => {
    expect(() => parseArgs(["--matches=0"])).toThrow();
    expect(() => parseArgs(["--matches=-5"])).toThrow();
  });
});

describe("--help", () => {
  it("recognises --help, -h and a bare --help among other flags", () => {
    expect(wantsHelp(["--help"])).toBe(true);
    expect(wantsHelp(["-h"])).toBe(true);
    // Beside the very typo the reader is looking up — help must still win, since `run.ts` checks
    // this BEFORE parseArgs (which would throw on `--matchs`).
    expect(wantsHelp(["--matchs=10", "--help"])).toBe(true);
  });

  it("does not mistake an ordinary run for a help request", () => {
    expect(wantsHelp([])).toBe(false);
    expect(wantsHelp(["--matches=10", "--shape=duel"])).toBe(false);
    // A path that merely contains the word, not the flag.
    expect(wantsHelp(["--out=reports/help"])).toBe(false);
  });

  it("documents every flag the CLI accepts, so the page cannot silently go short", () => {
    const text = helpText();
    for (const flag of KNOWN_FLAGS) {
      expect(text, `--${flag} is missing from helpText()`).toContain(`--${flag}`);
    }
  });

  it("prints the same defaults parseArgs actually applies", () => {
    const text = helpText();
    const d = parseArgs([]);
    expect(text).toContain(`(default ${d.matches})`);
    expect(text).toContain(`(default ${d.arenaId})`);
    expect(text).toContain(`(default ${d.skill})`);
    expect(text).toContain(`(default ${d.shape}`);
    expect(text).toContain(`${d.matchSeconds} for deathmatch`);
    expect(text).toContain(`${parseArgs(["--shape=duel"]).matchSeconds} for last-standing`);
  });

  it("still parses --help as a known flag, so it never reads as a typo", () => {
    // `run.ts` short-circuits before this, but the unknown-flag error points readers AT --help;
    // that message must not be the thing that rejects it.
    expect(() => parseArgs(["--help"])).not.toThrow();
  });
});
