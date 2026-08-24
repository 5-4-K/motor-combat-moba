import archiver from "archiver";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

  fs.rmSync(distReleaseDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  fs.cpSync(serverDist, path.join(appDir, "packages", "server", "dist"), {
    recursive: true,
  });
  fs.cpSync(clientDist, path.join(appDir, "packages", "client", "dist"), {
    recursive: true,
  });

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
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
