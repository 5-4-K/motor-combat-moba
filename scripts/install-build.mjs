/**
 * `npm run install-build` — build a release and install it into a folder named by a file.
 *
 * The folder is read from `.install-target` (gitignored) rather than passed on the command line,
 * because the whole point is not to retype it. That makes the path invisible at the call site, which
 * is exactly why this script prints the resolved absolute path and waits for a typed "yes" before it
 * removes anything: the one thing worse than retyping a path is not noticing it changed.
 *
 * Order of operations is chosen so that a failure leaves the existing install playable:
 *
 *   read + validate target -> probe writability -> CONFIRM -> build release -> copy -> npm install
 *
 * The build runs *after* the prompt (the user asked for it that way) but *before* anything in the
 * target is touched, so a compile error costs a rebuild, not a working install. Validation and the
 * write probe run before the prompt so a typo'd path fails in a second rather than after a build.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where the target path is read from, and the committed file that documents its format. */
export const TARGET_FILE = ".install-target";
export const TARGET_EXAMPLE_FILE = ".install-target.example";

/**
 * What `scripts/build-release.mjs` writes into `dist-release/motor-combat-moba/` and this script
 * *replaces* in the target folder. Everything else there — `node_modules`, logs, whatever the user
 * keeps beside the game — is left alone.
 *
 * `packages` is removed wholesale rather than merged because Vite emits content-hashed filenames:
 * copying over the top would leave every previous build's `index-<hash>.js` behind forever, and the
 * folder would grow without bound while looking correct.
 */
export const MANAGED_ENTRIES = ["packages", "package.json", "start.bat", "start.sh", "README.md"];

/**
 * Released files copied in only when the target does not already have them.
 *
 * `.env` is the whole reason this category exists. A first install into an empty folder has to
 * arrive configured or the release's `PORT=80` silently does not apply and the server comes up on
 * 2567 — so it cannot simply be left out. But a folder that already has a `.env` has a host's own
 * edits in it, and an install is not the moment to throw those away — so it cannot be managed
 * either. Seeding is the only behaviour that is right in both folders.
 */
export const SEEDED_ENTRIES = [".env"];

/**
 * Read the one path out of the target file's text.
 *
 * Blank lines and `#` comments are skipped so the file can explain itself. Two real paths is an
 * error rather than "first one wins": a second line is far more likely to be an edit someone forgot
 * to finish than a deliberate list, and picking silently is how a build lands in last month's folder.
 */
export function parseTargetFile(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length === 0) return { error: "empty" };
  if (lines.length > 1) return { error: "multiple", found: lines };
  return { target: lines[0].replace(/^["']|["']$/g, "") };
}

/**
 * Refuse targets that would make this script destroy something it must not.
 *
 * The first two cases are the dangerous ones and the reason this function exists: the script deletes
 * `packages/` inside the target, so a target of the repo root — or any ancestor of it — would delete
 * the source tree. A target *inside* the repo is refused for the same reason plus a subtler one: the
 * release build writes into `dist-release/`, and installing into the repo invites a run that copies
 * a tree onto itself.
 */
export function pathRelationError(target, repoRoot, homeDir) {
  const rel = path.relative(repoRoot, target);
  const insideRepo = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (insideRepo) {
    return (
      `refusing to install into the repository itself (${target}).\n` +
      `This script deletes ${MANAGED_ENTRIES.join(", ")} inside the target — pointed here it would ` +
      `delete the source tree. Choose a folder outside ${repoRoot}.`
    );
  }

  const relFromTarget = path.relative(target, repoRoot);
  const targetIsAncestor =
    relFromTarget !== "" && !relFromTarget.startsWith("..") && !path.isAbsolute(relFromTarget);
  if (targetIsAncestor) {
    return (
      `refusing to install into ${target}: the repository lives inside it.\n` +
      `Removing this folder's packages/ would take the checkout with it.`
    );
  }

  if (path.dirname(target) === target) {
    return `refusing to install into the filesystem root (${target}).`;
  }

  if (homeDir && path.resolve(target) === path.resolve(homeDir)) {
    return (
      `refusing to install into your home directory (${target}).\n` +
      `Use a dedicated folder — this script removes package.json and README.md from the target.`
    );
  }

  return undefined;
}

/**
 * Turn a filesystem errno into something that names the likely cause.
 *
 * `EBUSY`/`EPERM` on Windows almost always means the server is still running out of the folder being
 * replaced, and "operation not permitted" sends people to check permissions they have not lost. The
 * cause worth naming first is the one they can act on.
 */
export function friendlyFsError(err, targetDir) {
  const code = err?.code;
  if (code === "EACCES" || code === "EROFS") {
    return (
      `no permission to write to ${targetDir} (${code}).\n` +
      `Check the folder's permissions, or that it is not on a read-only mount or share.`
    );
  }
  if (code === "EPERM" || code === "EBUSY") {
    return (
      `${targetDir} is locked by another process (${code}).\n` +
      `The game server is most likely still running from that folder — stop it and re-run. ` +
      `A file explorer or antivirus scan holding a file open does this too.`
    );
  }
  if (code === "ENOSPC") {
    return (
      `ran out of disk space writing to ${targetDir}.\n` +
      `The install is now INCOMPLETE — free space and re-run before starting the server.`
    );
  }
  if (code === "ENOENT") {
    return `${targetDir} disappeared while installing. Re-run.`;
  }
  return `${err?.message ?? String(err)} (writing to ${targetDir})`;
}

/** A one-line inventory of what is already in the target, for the confirmation prompt to show. */
export function describeExisting(entries) {
  const set = new Set(entries);
  const managedPresent = MANAGED_ENTRIES.filter((name) => set.has(name));
  const hasNodeModules = set.has("node_modules");
  const others = entries.filter(
    (name) => !MANAGED_ENTRIES.includes(name) && name !== "node_modules",
  );
  return { empty: entries.length === 0, managedPresent, hasNodeModules, others };
}

/**
 * `npm install`, not `npm ci`: the release ships no `package-lock.json`, so `npm ci` would fail
 * outright. `--omit=dev` because the generated release package.json should carry no dev deps and a
 * stray one must not reach a play machine.
 *
 * **No `--prefer-offline`**, which is the obvious-looking flag here and is a trap: it resolves
 * ranges against whatever packument is already cached, so a cache that predates a dependency's
 * latest release fails the *first* install outright with `ETARGET` — observed here as
 * `No matching version found for qs@~6.15.1` while a plain install of the same tree succeeded. It
 * also buys nothing. npm writes a `package-lock.json` into the target during that first install, and
 * that file is deliberately not in `MANAGED_ENTRIES`, so it survives every later run: with the lock
 * plus a complete `node_modules`, a repeat install needs no registry at all and finishes in under a
 * second. The offline case is covered by the lockfile, not by the flag.
 */
export function installArgs() {
  return ["install", "--omit=dev", "--no-audit", "--no-fund"];
}

function fail(message) {
  console.error(`\ninstall-build: ${message}\n`);
  process.exit(1);
}

function readTarget() {
  const targetFilePath = path.join(rootDir, TARGET_FILE);

  if (!fs.existsSync(targetFilePath)) {
    fail(
      `no ${TARGET_FILE} file.\n\n` +
        `Create ${targetFilePath} containing the folder to install into, one line:\n\n` +
        `    D:\\games\\motor-combat-moba\n\n` +
        `See ${TARGET_EXAMPLE_FILE} for the format. The file is gitignored — it is yours, not the repo's.`,
    );
  }

  let text;
  try {
    text = fs.readFileSync(targetFilePath, "utf8");
  } catch (err) {
    fail(`could not read ${targetFilePath}: ${err.message}`);
  }

  const parsed = parseTargetFile(text);
  if (parsed.error === "empty") {
    fail(
      `${targetFilePath} has no path in it.\n\n` +
        `Put the install folder on one line, e.g.\n\n    D:\\games\\motor-combat-moba`,
    );
  }
  if (parsed.error === "multiple") {
    fail(
      `${targetFilePath} names ${parsed.found.length} paths, and this script installs to one:\n\n` +
        parsed.found.map((line) => `    ${line}`).join("\n") +
        `\n\nLeave exactly one line uncommented (prefix the others with #).`,
    );
  }

  return { targetFilePath, raw: parsed.target };
}

function resolveAndValidate(raw, targetFilePath) {
  // Relative paths resolve against the repo root, not the shell's cwd, so the meaning of the file
  // does not depend on where npm happened to be invoked from.
  const resolved = path.resolve(rootDir, raw);

  const relationError = pathRelationError(resolved, rootDir, os.homedir());
  if (relationError) fail(relationError);

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    if (err.code === "ENOENT") {
      fail(
        `the folder named in ${targetFilePath} does not exist:\n\n    ${resolved}\n\n` +
          `Create it first, or fix the path. This script will not create it — a typo that silently ` +
          `makes a new folder is how a build lands somewhere nobody looks.`,
      );
    }
    if (err.code === "EACCES") {
      fail(`no permission to even look at ${resolved} (EACCES). Check the folder's permissions.`);
    }
    fail(`could not inspect ${resolved}: ${err.message}`);
  }

  if (!stat.isDirectory()) {
    fail(`${resolved} is a file, not a folder. ${targetFilePath} must name a directory.`);
  }

  // Follow symlinks so the confirmation shows where the files really land, not the alias.
  let real = resolved;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    // A broken link cannot get past statSync above; anything else here is not worth failing over.
  }
  if (real !== resolved) {
    const linkError = pathRelationError(real, rootDir, os.homedir());
    if (linkError) fail(`${resolved} resolves to ${real}, and ${linkError}`);
  }

  return real;
}

/**
 * Prove the folder is writable before building, by writing a file and deleting it.
 *
 * `fs.accessSync(W_OK)` is not enough on Windows, where a read-only attribute and a share permission
 * disagree with it often enough to be useless. This is TOCTOU by nature — permissions can change in
 * the seconds that follow — so the copy step handles the same errors again; the probe exists to fail
 * in one second instead of after a full release build.
 */
function probeWritable(targetDir) {
  const probe = path.join(targetDir, `.install-build-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, "");
    fs.rmSync(probe, { force: true });
  } catch (err) {
    fail(friendlyFsError(err, targetDir));
  }
}

function listEntries(targetDir) {
  try {
    return fs.readdirSync(targetDir);
  } catch (err) {
    fail(friendlyFsError(err, targetDir));
  }
}

async function confirm(targetDir, existing, autoYes) {
  const lines = [
    "",
    "  Install a release build into:",
    "",
    `      ${targetDir}`,
    "",
  ];

  if (existing.empty) {
    lines.push("  The folder is empty.");
  } else {
    if (existing.managedPresent.length > 0) {
      lines.push(`  REPLACE  ${existing.managedPresent.join(", ")}`);
    }
    const kept = [];
    if (existing.hasNodeModules) kept.push("node_modules (reused, not re-downloaded)");
    if (existing.others.length > 0) {
      const shown = existing.others.slice(0, 6).join(", ");
      const more = existing.others.length > 6 ? `, +${existing.others.length - 6} more` : "";
      kept.push(`${shown}${more}`);
    }
    if (kept.length > 0) lines.push(`  KEEP     ${kept.join("; ")}`);
  }

  lines.push("", "  Then: npm install --omit=dev in that folder.", "");
  console.log(lines.join("\n"));

  if (autoYes) {
    console.log("  --yes given, continuing.\n");
    return;
  }

  // A non-TTY stdin cannot answer, and defaulting to "yes" for a step that deletes files is not a
  // default anyone wants. `--yes` is the deliberate opt-in for scripted runs.
  if (!process.stdin.isTTY) {
    fail(
      "stdin is not a terminal, so the confirmation cannot be answered.\n" +
        "Re-run with --yes if you meant to install without confirming: npm run install-build -- --yes",
    );
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await rl.question('  Type "yes" to continue: ');
  } finally {
    rl.close();
  }

  if (answer.trim().toLowerCase() !== "yes") {
    console.log("\n  Cancelled. Nothing was changed.\n");
    process.exit(1);
  }
  console.log("");
}

function run(command, args, cwd, what) {
  // `shell: true` on Windows because npm is a `.cmd` there and Node refuses to spawn one without a
  // shell. No path of the user's ever reaches the command string — the target folder is passed as
  // `cwd` — so a folder name with spaces or quotes in it cannot be misparsed.
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) fail(`could not run ${what}: ${result.error.message}`);
  if (result.status !== 0) return result.status ?? 1;
  return 0;
}

/**
 * Remove one managed entry, retrying briefly on the errors Windows raises for a file another process
 * has open. `fs.rmSync`'s own `maxRetries` handles EBUSY/EPERM/ENOTEMPTY, which is precisely the
 * antivirus-just-scanned-it case; a server actually running from the folder outlives the retries and
 * gets the explanatory error instead.
 */
function removeManaged(targetDir, name) {
  const full = path.join(targetDir, name);
  try {
    fs.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    fail(friendlyFsError(err, full));
  }
}

export function copyInto(sourceDir, targetDir) {
  const kept = [];
  for (const name of fs.readdirSync(sourceDir)) {
    const from = path.join(sourceDir, name);
    const to = path.join(targetDir, name);
    // Seeded entries are copied only into a folder that lacks them. `cpSync` below passes
    // `force: true`, so without this check an install would silently overwrite the host's own
    // `.env` — the one file in the folder they are most likely to have edited by hand.
    if (SEEDED_ENTRIES.includes(name) && fs.existsSync(to)) {
      kept.push(name);
      continue;
    }
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.cpSync(from, to, { recursive: true, force: true });
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        if (err.code !== "EBUSY" && err.code !== "EPERM" && err.code !== "EACCES") break;
        // Busy-wait rather than await: this runs between a delete and an install, and a folder in a
        // half-copied state is not something to hand back to the event loop.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
    }
    if (lastErr) fail(friendlyFsError(lastErr, to));
  }
  return { kept };
}

export async function main(argv = process.argv.slice(2)) {
  const autoYes = argv.includes("--yes") || argv.includes("-y");

  const { targetFilePath, raw } = readTarget();
  const targetDir = resolveAndValidate(raw, targetFilePath);
  probeWritable(targetDir);

  const existing = describeExisting(listEntries(targetDir));
  await confirm(targetDir, existing, autoYes);

  // Build first, target untouched: a failed build must never cost a working install.
  console.log("Building release...\n");
  const buildStatus = run("npm", ["run", "build:release"], rootDir, "npm run build:release");
  if (buildStatus !== 0) {
    fail(
      `the release build failed, so ${targetDir} was left exactly as it was.\n` +
        `Fix the build and re-run — nothing was copied.`,
    );
  }

  const appDir = path.join(rootDir, "dist-release", "motor-combat-moba");
  if (!fs.existsSync(appDir)) {
    fail(`the build reported success but ${appDir} is missing. Run npm run build:release directly.`);
  }

  console.log(`\nInstalling into ${targetDir}\n`);
  for (const name of MANAGED_ENTRIES) removeManaged(targetDir, name);
  const { kept } = copyInto(appDir, targetDir);
  for (const name of kept) {
    console.log(`Kept the existing ${name} — delete it and re-run to take the released one.`);
  }

  console.log("Installing dependencies...\n");
  const installStatus = run("npm", installArgs(), targetDir, "npm install");
  if (installStatus !== 0) {
    fail(
      `the build was copied to ${targetDir}, but installing its dependencies failed.\n` +
        `The install is incomplete — the server will not start until this succeeds.\n` +
        `Most often this is no route to the npm registry. Retry in that folder with:\n\n` +
        `    npm install --omit=dev\n`,
    );
  }

  const serverEntry = path.join(targetDir, "packages", "server", "dist", "index.js");
  if (!fs.existsSync(serverEntry)) {
    fail(`installed, but ${serverEntry} is missing. The copy did not complete — re-run.`);
  }

  // Imported here rather than at the top of the file: `build-release.mjs` statically imports built
  // shared, so a top-level import would make this script fail to load whenever `packages/shared/dist`
  // is missing — including before the validation that is meant to fail in a second. By this line the
  // release build has run, so shared is guaranteed built.
  const { releaseOrigin, releasePort } = await import("./build-release.mjs");
  const installedEnv = path.join(targetDir, ".env");
  const port = releasePort(
    fs.existsSync(installedEnv) ? fs.readFileSync(installedEnv, "utf8") : "",
  );

  const startScript = process.platform === "win32" ? "start.bat" : "./start.sh";
  console.log(`\nDone. Installed to ${targetDir}`);
  console.log(
    `Start it with ${startScript} in that folder, then open ${releaseOrigin("localhost", port)}\n`,
  );
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
