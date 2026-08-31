import archiver from "archiver";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// No `requireBuiltDist` guard for shared: this static import IS the guard. ESM resolves it before
// any code in this module runs, so a missing `packages/shared/dist` fails at load time and names
// the exact missing path — a runtime check here could never execute.
import {
  ACTIVE_ARENA_ID,
  ARENA_ART_COMMON,
  arenaIdFromArtKey,
} from "../packages/shared/dist/index.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distReleaseDir = path.join(rootDir, "dist-release");
const appDir = path.join(distReleaseDir, "motor-combat-moba");
const zipPath = path.join(distReleaseDir, "motor-combat-moba-release.zip");
const serverDist = path.join(rootDir, "packages", "server", "dist");
const clientDist = path.join(rootDir, "packages", "client", "dist");

export function startBat() {
  return `@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Install Node.js 20+ and try again.
    pause
    exit /b 1
  )
)
node packages\\server\\dist\\index.js
pause
`.replaceAll("\n", "\r\n");
}

export function startSh() {
  return `#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install || exit 1
fi
node packages/server/dist/index.js
`;
}

export function releasePackageJson(serverDependencies) {
  const dependencies = { ...serverDependencies };
  delete dependencies["@motor-combat-moba/shared"];
  return {
    name: "motor-combat-moba",
    private: true,
    type: "module",
    scripts: {
      start: "node packages/server/dist/index.js",
    },
    dependencies,
  };
}

/**
 * One line of an env file: a `key=value` assignment, or a raw passthrough (comment, blank line).
 *
 * Comments are kept as lines rather than discarded because `.env.release` is where the shipped
 * configuration is *documented*, not just declared — a merge that dropped its prose would hand the
 * LAN host a bare list of keys with no hint what any of them do.
 */
function parseEnvLines(text) {
  return text.split(/\r?\n/).map((raw) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(raw);
    return match ? { key: match[1], value: match[2].trim() } : { raw };
  });
}

/**
 * Overlay `.env.release.local` onto `.env.release`, key by key, and render the `.env` the release
 * ships. An overridden key is rewritten where it already sits so it keeps its explanatory comment;
 * a key only the override declares is appended.
 *
 * Merging rather than replacing is what makes the local file a one-line override: a host who only
 * wants a different port writes `PORT=2567` and keeps every other shipped value.
 */
export function mergeReleaseEnv(baseText, overrideText = "") {
  const overrides = new Map();
  for (const line of parseEnvLines(overrideText)) {
    if (line.key !== undefined) overrides.set(line.key, line.value);
  }

  const applied = new Set();
  const merged = parseEnvLines(baseText).map((line) => {
    if (line.key === undefined || !overrides.has(line.key)) return line;
    applied.add(line.key);
    return { key: line.key, value: overrides.get(line.key) };
  });
  // Trailing blank lines are trimmed before appending so the separator below is the same one line
  // whether the base file ended with none, one, or three — the shipped `.env` should not inherit
  // whitespace noise from how someone happened to save `.env.release`.
  const appended = [...overrides].filter(([key]) => !applied.has(key));
  if (appended.length > 0) {
    while (merged.length > 0 && merged.at(-1).key === undefined && !merged.at(-1).raw.trim()) {
      merged.pop();
    }
    if (merged.length > 0) merged.push({ raw: "" });
    for (const [key, value] of appended) merged.push({ key, value });
  }

  const body = merged
    .map((line) => (line.key === undefined ? line.raw : `${line.key}=${line.value}`))
    .join("\n")
    .replace(/\n+$/, "");
  return `${body}\n`;
}

/**
 * The port the shipped `.env` actually selects, so the release README can print URLs a player can
 * click. Last assignment wins, matching how dotenv folds a file into one object.
 *
 * The fallback must stay in step with `getPort()` in the server's `mode.ts`: a `.env` with no
 * usable `PORT` leaves the server on its own default, and a README naming a different number would
 * send every player to a closed port.
 */
export function releasePort(envText, fallback = 2567) {
  let port = fallback;
  for (const line of parseEnvLines(envText)) {
    if (line.key !== "PORT") continue;
    const n = Number(line.value);
    if (Number.isFinite(n) && n > 0) port = n;
  }
  return port;
}

/** `http://host` on port 80, `http://host:port` anywhere else — the whole point of shipping :80. */
export function releaseOrigin(host, port) {
  return port === 80 ? `http://${host}` : `http://${host}:${port}`;
}

export function releaseReadme(port) {
  const privileged = port < 1024;
  return `# Motor Combat MOBA (LAN)

Requires Node.js 20 or newer.

1. Double-click \`start.bat\` (Windows) or run \`./start.sh\` (macOS/Linux).
2. The first launch installs dependencies, then starts the server.
3. Open ${releaseOrigin("localhost", port)} on this machine.
4. Share ${releaseOrigin("<LAN-IP>", port)} with other players on the same network.

The port is \`PORT\` in \`.env\`, next to \`start.bat\`. Change it there and restart.
${
  privileged
    ? `
Port ${port} is a privileged port. Windows binds it without admin rights, but macOS and Linux do
not: run \`sudo setcap 'cap_net_bind_service=+ep' $(which node)\` once, or set a port above 1024 in
\`.env\`. If the port is already taken the server exits on startup — on Windows that is usually IIS
(\`net stop http /y\`).
`
    : ""
}`;
}

function requireBuiltDist(dir, label) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Missing ${label} at ${dir}. Run npm run build first.`);
  }
}

/**
 * Strings that must only ever exist in dev-only code. `import.meta.env.DEV` is replaced with the
 * literal `false` by `vite build`, so the branch importing the dev tool is dead code and its
 * chunk is never emitted. This asserts that rather than trusting it — a static import added by
 * accident, or the scene wired into main.ts's scene list, would silently ship it.
 */
export const DEV_ONLY_MARKERS = ["MOTOR DEV TOOL"];

function javascriptFilesIn(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...javascriptFilesIn(full));
    // `.mjs`/`.cjs` as well as `.js`: Vite emits `.js` today, but a future `entryFileNames` change
    // would otherwise make this whole check pass vacuously, which is the worst way for a guard to fail.
    else if (/\.[cm]?js$/.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * Throw if any dev-only marker reached the built client. Only JavaScript is scanned: Vite copies
 * `public/` straight to the `dist` root, so Markdown and other prose sit right next to the bundle,
 * and a check that could trip on prose would train whoever hits it to ignore it.
 */
export function assertNoDevOnlyCode(clientDistDir) {
  for (const file of javascriptFilesIn(clientDistDir)) {
    const body = fs.readFileSync(file, "utf8");
    for (const marker of DEV_ONLY_MARKERS) {
      if (body.includes(marker)) {
        throw new Error(
          `dev-only code shipped: "${marker}" found in ${path.relative(clientDistDir, file)}. ` +
            `Check that AssetTuningScene is imported dynamically behind import.meta.env.DEV and is not ` +
            `listed in main.ts's scene array.`,
        );
      }
    }
  }
}

/**
 * The faces `src/ui/organic.css` declares with `@font-face`. Vendored rather than pulled from
 * fonts.googleapis.com because this zip is played on LANs with no route to the internet, where a
 * remote font does not fail loudly — it falls back to system-ui and quietly wrecks the type.
 */
export const REQUIRED_FONTS = [
  "caprasimo-v6-latin-regular.woff2",
  "figtree-v9-latin-regular.woff2",
  "figtree-v9-latin-600.woff2",
  "figtree-v9-latin-700.woff2",
];

/** Throw if a vendored face did not reach the release, or if the CSS reaches for the network again. */
export function assertFontsVendored(clientDistDir) {
  const missing = REQUIRED_FONTS.filter(
    (name) => !fs.existsSync(path.join(clientDistDir, "fonts", name)),
  );
  if (missing.length > 0) {
    throw new Error(
      `fonts missing from the release: ${missing.join(", ")}. They belong in ` +
        `packages/client/public/fonts/ so Vite copies them to dist/fonts/. Without them the LAN ` +
        `build falls back to system-ui.`,
    );
  }

  for (const file of fs.readdirSync(clientDistDir, { recursive: true, withFileTypes: true })) {
    if (!file.name.endsWith(".css")) continue;
    const body = fs.readFileSync(path.join(file.parentPath ?? file.path, file.name), "utf8");
    if (body.includes("fonts.googleapis.com") || body.includes("fonts.gstatic.com")) {
      throw new Error(
        `remote font reference shipped in ${file.name}. organic.css must declare @font-face against ` +
          `the vendored /fonts/*.woff2, never an @import from Google Fonts.`,
      );
    }
  }
}

function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return undefined;
  const text = fs.readFileSync(manifestPath, "utf8");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `could not parse manifest at ${manifestPath}: ${err.message}. The release cannot prune ` +
        `arena art from a manifest it cannot read — fix the JSON and rebuild the client.`,
    );
  }
  if (!raw || typeof raw !== "object") return undefined;
  if (!raw.sprites || typeof raw.sprites !== "object") return undefined;
  return raw;
}

/**
 * Strip every arena's art but the active one's from a built client tree.
 *
 * Two namespaces always survive: `arena.common.*`, for art several arenas share, and every key
 * outside the `arena.` prefix. `arenaIdFromArtKey` is imported from shared rather than reimplemented
 * here so the file-level rule and the client's boot-time load filter cannot drift apart.
 *
 * Call this on the **copied** release tree, never on `packages/client/dist`: the source dist stays
 * complete and reusable, and running a release twice in a row does the same thing as running it once.
 */
export function pruneArenaAssets(clientDistDir, activeArenaId) {
  const arenasDir = path.join(clientDistDir, "art", "arenas");
  const kept = [];
  const removed = [];
  let bytesRemoved = 0;

  if (fs.existsSync(arenasDir)) {
    for (const entry of fs.readdirSync(arenasDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ARENA_ART_COMMON || entry.name === activeArenaId) {
        kept.push(entry.name);
        continue;
      }
      const full = path.join(arenasDir, entry.name);
      bytesRemoved += directorySize(full);
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(entry.name);
    }
  }

  const manifestPath = path.join(clientDistDir, "art", "manifest.json");
  const manifest = readManifest(manifestPath);
  if (manifest) {
    for (const key of Object.keys(manifest.sprites)) {
      const arenaId = arenaIdFromArtKey(key);
      if (arenaId === undefined) continue;
      if (arenaId === ARENA_ART_COMMON || arenaId === activeArenaId) continue;
      delete manifest.sprites[key];
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return { kept: kept.sort(), removed: removed.sort(), bytesRemoved };
}

/**
 * Throw if any non-active arena's art or manifest key reached the release. Checks the condition the
 * player would actually suffer — a file in the zip — rather than trusting that the prune ran, the
 * same way `assertFontsVendored` checks the file rather than the copy step.
 */
export function assertOnlyActiveArenaShipped(clientDistDir, activeArenaId) {
  const offenders = [];
  const arenasDir = path.join(clientDistDir, "art", "arenas");
  if (fs.existsSync(arenasDir)) {
    for (const entry of fs.readdirSync(arenasDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ARENA_ART_COMMON || entry.name === activeArenaId) continue;
      offenders.push(`art/arenas/${entry.name}/`);
    }
  }

  const manifest = readManifest(path.join(clientDistDir, "art", "manifest.json"));
  if (manifest) {
    for (const key of Object.keys(manifest.sprites)) {
      const arenaId = arenaIdFromArtKey(key);
      if (arenaId === undefined) continue;
      if (arenaId === ARENA_ART_COMMON || arenaId === activeArenaId) continue;
      offenders.push(`manifest key ${key}`);
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      `non-active arena art shipped (ACTIVE_ARENA_ID is "${activeArenaId}"): ${offenders.join(", ")}. ` +
        `pruneArenaAssets should have removed these from the copied client dist.`,
    );
  }
}

function writeZip(sourceDir, destination) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(sourceDir, "motor-combat-moba");
    archive.finalize();
  });
}

export async function main() {
  requireBuiltDist(serverDist, "packages/server/dist");
  requireBuiltDist(clientDist, "packages/client/dist");
  assertNoDevOnlyCode(clientDist);
  assertFontsVendored(clientDist);

  fs.rmSync(distReleaseDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  fs.cpSync(serverDist, path.join(appDir, "packages", "server", "dist"), {
    recursive: true,
  });
  fs.cpSync(clientDist, path.join(appDir, "packages", "client", "dist"), {
    recursive: true,
  });

  const releaseClientDist = path.join(appDir, "packages", "client", "dist");
  const pruned = pruneArenaAssets(releaseClientDist, ACTIVE_ARENA_ID);
  assertOnlyActiveArenaShipped(releaseClientDist, ACTIVE_ARENA_ID);

  const serverPkg = JSON.parse(
    fs.readFileSync(path.join(rootDir, "packages", "server", "package.json"), "utf8"),
  );
  const pkg = releasePackageJson(serverPkg.dependencies);
  fs.writeFileSync(path.join(appDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  // A real `.env`, not a `.env.example` the host has to notice and rename. `.env.example` is
  // deliberately NOT copied alongside it: two env files disagreeing about PORT in one folder is how
  // someone edits the one dotenv never reads.
  const envSources = [];
  let baseEnvText = "";
  for (const candidate of [".env.release", ".env.example"]) {
    const full = path.join(rootDir, candidate);
    if (!fs.existsSync(full)) continue;
    baseEnvText = fs.readFileSync(full, "utf8");
    envSources.push(candidate);
    break;
  }
  const localEnvPath = path.join(rootDir, ".env.release.local");
  const localEnvText = fs.existsSync(localEnvPath) ? fs.readFileSync(localEnvPath, "utf8") : "";
  if (localEnvText) envSources.push(".env.release.local");
  const envText = mergeReleaseEnv(baseEnvText, localEnvText);
  fs.writeFileSync(path.join(appDir, ".env"), envText);
  const port = releasePort(envText);

  fs.writeFileSync(path.join(appDir, "start.bat"), startBat());
  const startShPath = path.join(appDir, "start.sh");
  fs.writeFileSync(startShPath, startSh());
  fs.chmodSync(startShPath, 0o755);
  fs.writeFileSync(path.join(appDir, "README.md"), releaseReadme(port));

  await writeZip(appDir, zipPath);

  console.log(`Release folder: ${appDir}`);
  console.log(`Release zip: ${zipPath}`);
  console.log(`Arena: ${ACTIVE_ARENA_ID}`);
  console.log(
    `Port: ${port} (from ${envSources.join(" + ") || "built-in default"})` +
      `${port < 1024 ? " — privileged on macOS/Linux" : ""}`,
  );
  if (pruned.removed.length > 0) {
    const kb = Math.round(pruned.bytesRemoved / 1024);
    console.log(`Pruned arena art: ${pruned.removed.join(", ")} (${kb} KB)`);
  }
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
