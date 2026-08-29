/**
 * Where a playtest run's findings go.
 *
 * Every probe writes a Markdown report into `playtest/reports/<yyyy-MM-dd-NN>/`, one file per
 * probe, plus a `summary.md` when the whole suite is run through `run-all.ts`. The folder is
 * gitignored: a report is a record of one run on one machine, not source.
 *
 * The run folder is chosen ONCE per run. `run-all.ts` creates it and passes it down through
 * `PLAYTEST_RUN_DIR`, so all six probes land in the same folder; a probe run on its own creates its
 * own. That is the whole reason the directory is not simply derived per file — six probes each
 * minting `-01`, `-02`, `-03` would scatter one run across six folders.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPORTS_ROOT = path.join(HERE, "reports");

/** Local calendar date as `yyyy-MM-dd`. Local, not UTC: the folder names a person's day. */
function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Create the next run folder for today: `reports/2026-08-29-01`, then `-02`, and so on.
 *
 * The number is derived by scanning what is already on disk rather than held in a counter file,
 * so deleting old reports never makes a new run collide with a name that is still there.
 */
export function createRunDir(): string {
  fs.mkdirSync(REPORTS_ROOT, { recursive: true });
  const date = today();
  const pattern = new RegExp(`^${date}-(\\d+)$`);
  let highest = 0;
  for (const entry of fs.readdirSync(REPORTS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = pattern.exec(entry.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const dir = path.join(REPORTS_ROOT, `${date}-${String(highest + 1).padStart(2, "0")}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The folder this probe should write into: the run's shared one, or a fresh one of its own. */
export function resolveRunDir(): string {
  const shared = process.env.PLAYTEST_RUN_DIR;
  if (shared) {
    fs.mkdirSync(shared, { recursive: true });
    return shared;
  }
  return createRunDir();
}

export interface Finding {
  probe: string;
  verdict: string;
  detail: string;
}

/**
 * Collects a probe's findings, prints them as they happen, and writes the Markdown file at the end.
 *
 * Printing as it goes matters: a probe that sweeps thousands of scenarios takes a while, and
 * watching verdicts arrive is how you notice one is wrong before the run finishes.
 */
export class Reporter {
  readonly findings: Finding[] = [];
  private readonly runDir: string;

  constructor(
    /** Filename stem, matching the probe script: `collision`, `ram`, `weapons`, ... */
    readonly slug: string,
    /** One line describing what this probe file covers. Becomes the report's subtitle. */
    readonly description: string,
  ) {
    this.runDir = resolveRunDir();
  }

  report(probe: string, verdict: string, detail: string): void {
    this.findings.push({ probe, verdict, detail });
    console.log(`\n[${verdict}] ${probe}\n    ${detail.replace(/\n/g, "\n    ")}`);
  }

  /** Print the summary table and write `<runDir>/<slug>.md`. Returns the file written. */
  finish(): string {
    console.log(`\n${"=".repeat(78)}`);
    for (const f of this.findings) console.log(`${f.verdict.padEnd(24)} ${f.probe}`);

    const file = path.join(this.runDir, `${this.slug}.md`);
    fs.writeFileSync(file, this.toMarkdown(), "utf8");
    console.log(`\nreport written to ${path.relative(process.cwd(), file)}`);
    return file;
  }

  private toMarkdown(): string {
    const lines: string[] = [
      `# Playtest — ${this.slug}`,
      "",
      this.description,
      "",
      `Run at ${new Date().toISOString()} · ${this.findings.length} probes.`,
      "",
      "| Verdict | Probe |",
      "|---|---|",
      ...this.findings.map((f) => `| ${f.verdict} | ${f.probe} |`),
      "",
      "---",
      "",
    ];
    for (const f of this.findings) {
      lines.push(`## ${f.probe}`, "", `**${f.verdict}**`, "", "```", f.detail, "```", "");
    }
    return lines.join("\n");
  }
}

/**
 * Verdicts a probe may return. Deliberately not a pass/fail boolean — a playtest is for finding out
 * what happens, and "the code documents this as intentional but a player will still report it"
 * is a real and common answer that neither pass nor fail describes.
 */
export const VERDICT = {
  /** Nothing surprising. */
  OK: "OK",
  /** A real problem: unintended, and a player would notice. */
  FINDING: "FINDING",
  /** Intentional and documented, but worth re-reading with fresh eyes. */
  BY_DESIGN: "KNOWN-BY-DESIGN",
} as const;
