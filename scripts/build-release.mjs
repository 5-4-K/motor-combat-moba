import archiver from "archiver";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const sharedDist = path.join(rootDir, "packages", "shared", "dist");

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

export function releaseReadme() {
  return `# Motor Combat MOBA (LAN)

Requires Node.js 20 or newer.

1. Double-click \`start.bat\` (Windows) or run \`./start.sh\` (macOS/Linux).
2. The first launch installs dependencies, then starts the server.
3. Open http://localhost:2567 on this machine.
4. Share http://<LAN-IP>:2567 with other players on the same network.
`;
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
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
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
  requireBuiltDist(sharedDist, "packages/shared/dist");
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

  const envExample = path.join(rootDir, ".env.example");
  if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, path.join(appDir, ".env.example"));
  }

  fs.writeFileSync(path.join(appDir, "start.bat"), startBat());
  const startShPath = path.join(appDir, "start.sh");
  fs.writeFileSync(startShPath, startSh());
  fs.chmodSync(startShPath, 0o755);
  fs.writeFileSync(path.join(appDir, "README.md"), releaseReadme());

  await writeZip(appDir, zipPath);

  console.log(`Release folder: ${appDir}`);
  console.log(`Release zip: ${zipPath}`);
  console.log(`Arena: ${ACTIVE_ARENA_ID}`);
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
