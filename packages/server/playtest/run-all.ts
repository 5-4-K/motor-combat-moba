/**
 * Run every offline probe into ONE dated report folder.
 *
 * `lan.ts` is deliberately not in this list: it needs a server already listening, and a runner that
 * silently skipped it when the port was closed would be worse than one that never claimed to run it.
 * Run it yourself — see `playtest/README.md`.
 *
 * Each probe is spawned as its own process rather than imported. Probes are top-level scripts that
 * execute on import, and several of them mutate module-level tables through the sim; separate
 * processes mean one probe can never leave state behind that changes the next one's numbers.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunDir } from "./reporter.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** In run order. Cheapest first, so a broken harness fails fast. */
const PROBES = ["collision", "ram", "geometry", "weapons", "weapons2", "prediction"] as const;

const runDir = createRunDir();
console.log(`playtest run -> ${path.relative(process.cwd(), runDir)}\n`);

const started = Date.now();
const results: { probe: string; ok: boolean; seconds: number }[] = [];

for (const probe of PROBES) {
  const at = Date.now();
  console.log(`${"=".repeat(78)}\n  ${probe}\n${"=".repeat(78)}`);
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", path.join(HERE, `${probe}.ts`)],
    { stdio: "inherit", env: { ...process.env, PLAYTEST_RUN_DIR: runDir } },
  );
  const seconds = (Date.now() - at) / 1000;
  results.push({ probe, ok: run.status === 0, seconds });
  if (run.status !== 0) console.error(`\n!! ${probe} exited with status ${run.status}\n`);
}

/* -------------------------------------------------------------------------- summary.md */
const totalSeconds = (Date.now() - started) / 1000;

/**
 * Pull each probe's verdict table out of the Markdown it just wrote, so the summary is built from
 * what actually landed on disk rather than from a second in-memory tally that could disagree with it.
 */
function verdictRows(probe: string): string[] {
  const file = path.join(runDir, `${probe}.md`);
  if (!fs.existsSync(file)) return [`| ${probe} | (no report written) | — |`];
  const rows: string[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^\| (.+?) \| (.+?) \|$/.exec(line.trim());
    if (!match || match[1] === "Verdict" || match[1]?.startsWith("-")) continue;
    rows.push(`| ${probe} | ${match[1]} | ${match[2]} |`);
  }
  return rows;
}

const allRows = PROBES.flatMap(verdictRows);
const findings = allRows.filter((r) => r.includes("| FINDING |"));

const summary = [
  "# Playtest run",
  "",
  `${new Date().toISOString()} · ${PROBES.length} probes · ${totalSeconds.toFixed(1)}s`,
  "",
  `**${findings.length} FINDING${findings.length === 1 ? "" : "s"}** across ${allRows.length} probes.`,
  "",
  "## Probes run",
  "",
  "| Probe file | Status | Seconds |",
  "|---|---|---|",
  ...results.map((r) => `| ${r.probe} | ${r.ok ? "completed" : "FAILED"} | ${r.seconds.toFixed(1)} |`),
  "",
  "## All verdicts",
  "",
  "| File | Verdict | Probe |",
  "|---|---|---|",
  ...allRows,
  "",
].join("\n");

fs.writeFileSync(path.join(runDir, "summary.md"), summary, "utf8");

console.log(`\n${"=".repeat(78)}`);
for (const r of results) {
  console.log(`${r.ok ? "completed" : "FAILED  "}  ${r.probe.padEnd(12)} ${r.seconds.toFixed(1)}s`);
}
console.log(
  `\n${findings.length} FINDING(s) across ${allRows.length} probes in ${totalSeconds.toFixed(1)}s.`,
);
console.log(`reports in ${path.relative(process.cwd(), runDir)}/ (summary.md first)`);

// A probe that crashed is a broken harness and must not look like a clean run. A FINDING is not a
// failure — the whole point is to surface them — so only a non-zero child exit fails this process.
process.exit(results.every((r) => r.ok) ? 0 : 1);
