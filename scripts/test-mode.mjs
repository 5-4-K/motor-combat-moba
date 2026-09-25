#!/usr/bin/env node
/**
 * `npm run test:mode -- <slug>`: run one mode's own tests across whichever packages carry a folder
 * for it, plus that package's `modes/contract.test.ts` (the common contract every mode's bundle
 * must satisfy — GM26/GM28 — which sits at the `modes/` root rather than in any one mode's folder,
 * so a mode-scoped run still owes it).
 *
 * Resolves the mode's rule/controller FAMILY through `MODE_FAMILY` (`brawl`/`team-brawl` both run
 * `last-standing`) so `test:mode -- brawl` also runs the shared `modes/last-standing/` and server
 * `modes/last-standing/` suites, even though `brawl`'s OWN folder lives at `modes/brawl/` in shared
 * and client. A package with none of the slug's folder, the family's folder, or a contract test is
 * skipped entirely — the server today, for instance, has no `modes/brawl/` (its rules live only
 * under the `last-standing` family), so it still runs with just the family and contract filters.
 *
 * Builds shared first: the mode's tests read config through built shared's accessors, same as every
 * other test run in this repo. Each package's own `"test:mode"` script (`vitest run`) receives the
 * filters as plain path arguments.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MODE_FAMILY } from "./test-scope.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PACKAGES = ["shared", "server", "client"];

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("test:mode: usage: npm run test:mode -- <slug>");
    process.exitCode = 1;
    return;
  }

  const family = MODE_FAMILY[slug];
  if (family === undefined) {
    console.error(`test:mode: unknown mode "${slug}" — expected one of: ${Object.keys(MODE_FAMILY).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log("test:mode: building shared");
  run("npm", ["run", "build", "-w", "@motor-combat-moba/shared"], ROOT);

  for (const pkg of PACKAGES) {
    const pkgDir = path.join(ROOT, "packages", pkg);
    const modesDir = path.join(pkgDir, "src", "modes");

    const filters = [];
    if (existsSync(path.join(modesDir, slug))) filters.push(`src/modes/${slug}/`);
    if (family !== slug && existsSync(path.join(modesDir, family))) filters.push(`src/modes/${family}/`);
    if (existsSync(path.join(modesDir, "contract.test.ts"))) filters.push("src/modes/contract.test.ts");

    if (filters.length === 0) {
      console.log(`test:mode: skipping @motor-combat-moba/${pkg} — no modes/${slug}/, modes/${family}/ or contract test`);
      continue;
    }

    console.log(`test:mode: @motor-combat-moba/${pkg} -> ${filters.join(" ")}`);
    run("npm", ["run", "test:mode", "-w", `@motor-combat-moba/${pkg}`, "--", ...filters], ROOT);
  }
}

main();
