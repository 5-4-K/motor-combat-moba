import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  assertNoDevOnlyCode,
  assertOnlyActiveArenaShipped,
  DEV_ONLY_MARKERS,
  mergeReleaseEnv,
  pruneArenaAssets,
  releaseOrigin,
  releasePackageJson,
  releasePort,
  releaseReadme,
  startBat,
  startSh,
} from "./build-release.mjs";

describe("startBat", () => {
  it("installs npm deps then starts the bundled server", () => {
    const bat = startBat();
    assert.match(bat, /npm install/);
    assert.match(bat, /node packages\\server\\dist\\index\.js/);
  });

  it("uses CRLF line endings for the written bat file", () => {
    const bat = startBat();
    assert.ok(bat.includes("\r\n"));
    assert.equal(bat.replaceAll("\r\n", "").includes("\n"), false);
  });
});

describe("startSh", () => {
  it("installs npm deps then starts the bundled server", () => {
    const sh = startSh();
    assert.match(sh, /npm install/);
    assert.match(sh, /node packages\/server\/dist\/index\.js/);
  });

  it("keeps LF line endings", () => {
    const sh = startSh();
    assert.equal(sh.includes("\r\n"), false);
    assert.ok(sh.includes("\n"));
  });
});

describe("releasePackageJson", () => {
  it("is a slim motor-combat-moba package without the shared workspace dep", () => {
    const pkg = releasePackageJson({
      "@motor-combat-moba/shared": "*",
      express: "^4.19.0",
      colyseus: "^0.15.0",
    });
    assert.equal(pkg.name, "motor-combat-moba");
    assert.equal(pkg.scripts.start, "node packages/server/dist/index.js");
    assert.ok(!Object.hasOwn(pkg.dependencies, "@motor-combat-moba/shared"));
    assert.equal(pkg.dependencies.express, "^4.19.0");
    assert.equal(pkg.dependencies.colyseus, "^0.15.0");
  });
});

describe("assertNoDevOnlyCode", () => {
  /** Every tree made here, removed once the suite ends so runs stop leaking into the OS temp dir. */
  const madeDirs = [];
  after(() => {
    for (const dir of madeDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  function tempDist(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motor-dist-"));
    madeDirs.push(dir);
    for (const [name, body] of Object.entries(files)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
    return dir;
  }

  it("passes for a build with no dev-only markers", () => {
    const dir = tempDist({ "assets/index-abc.js": "console.log('hello');" });
    assert.doesNotThrow(() => assertNoDevOnlyCode(dir));
  });

  it("throws when a marker survived into the bundle", () => {
    const dir = tempDist({ "assets/index-abc.js": 'const M = "MOTOR DEV TOOL";' });
    assert.throws(() => assertNoDevOnlyCode(dir), /MOTOR DEV TOOL/);
  });

  it("names the offending file", () => {
    const dir = tempDist({ "assets/chunk-xyz.js": 'x("MOTOR DEV TOOL")' });
    assert.throws(() => assertNoDevOnlyCode(dir), /chunk-xyz\.js/);
  });

  it("ignores non-javascript files so art and docs cannot trip it", () => {
    const dir = tempDist({
      "art/README.md": "MOTOR DEV TOOL is dev-only",
      "assets/index-abc.js": "console.log('hello');",
    });
    assert.doesNotThrow(() => assertNoDevOnlyCode(dir));
  });

  it("declares at least one marker", () => {
    assert.ok(DEV_ONLY_MARKERS.length > 0);
  });
});

describe("pruneArenaAssets", () => {
  const madeDirs = [];
  after(() => {
    for (const dir of madeDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A client dist holding three arenas' art plus a car and a shared wall, with a manifest naming all five. */
  function makeDist() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcm-arena-"));
    madeDirs.push(dir);
    const art = path.join(dir, "art");
    for (const arena of ["arena-01", "arena-02", "arena-03", "common"]) {
      fs.mkdirSync(path.join(art, "arenas", arena), { recursive: true });
      fs.writeFileSync(path.join(art, "arenas", arena, "floor.png"), "x".repeat(100));
    }
    fs.mkdirSync(path.join(art, "cars"), { recursive: true });
    fs.writeFileSync(path.join(art, "cars", "mirage.png"), "x");
    fs.writeFileSync(
      path.join(art, "manifest.json"),
      JSON.stringify({
        sprites: {
          "car.mirage": { file: "cars/mirage.png" },
          "arena.common.floor": { file: "arenas/common/floor.png" },
          "arena.arena-01.floor": { file: "arenas/arena-01/floor.png" },
          "arena.arena-02.floor": { file: "arenas/arena-02/floor.png" },
          "arena.arena-03.floor": { file: "arenas/arena-03/floor.png" },
        },
      }),
    );
    return dir;
  }

  it("keeps the active arena and common, removes the rest", () => {
    const dir = makeDist();
    const result = pruneArenaAssets(dir, "arena-01");
    assert.deepEqual(result.kept, ["arena-01", "common"]);
    assert.deepEqual(result.removed, ["arena-02", "arena-03"]);
    assert.ok(result.bytesRemoved >= 200);
    assert.ok(fs.existsSync(path.join(dir, "art", "arenas", "arena-01", "floor.png")));
    assert.ok(fs.existsSync(path.join(dir, "art", "arenas", "common", "floor.png")));
    assert.ok(!fs.existsSync(path.join(dir, "art", "arenas", "arena-02")));
    assert.ok(!fs.existsSync(path.join(dir, "art", "arenas", "arena-03")));
  });

  it("drops the pruned arenas' manifest keys and keeps every other key", () => {
    const dir = makeDist();
    pruneArenaAssets(dir, "arena-01");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "art", "manifest.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest.sprites).sort(), [
      "arena.arena-01.floor",
      "arena.common.floor",
      "car.mirage",
    ]);
  });

  it("is idempotent", () => {
    const dir = makeDist();
    pruneArenaAssets(dir, "arena-01");
    const second = pruneArenaAssets(dir, "arena-01");
    assert.deepEqual(second.removed, []);
    assert.equal(second.bytesRemoved, 0);
  });

  it("does nothing when there is no arena art at all", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcm-arena-"));
    madeDirs.push(dir);
    const result = pruneArenaAssets(dir, "arena-01");
    assert.deepEqual(result.kept, []);
    assert.deepEqual(result.removed, []);
  });

  it("passes its own assertion afterwards", () => {
    const dir = makeDist();
    pruneArenaAssets(dir, "arena-01");
    assert.doesNotThrow(() => assertOnlyActiveArenaShipped(dir, "arena-01"));
  });
});

describe("assertOnlyActiveArenaShipped", () => {
  const madeDirs = [];
  after(() => {
    for (const dir of madeDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcm-assert-"));
    madeDirs.push(dir);
    fs.mkdirSync(path.join(dir, "art", "arenas", "arena-01"), { recursive: true });
    fs.writeFileSync(path.join(dir, "art", "manifest.json"), JSON.stringify({ sprites: {} }));
    return dir;
  }

  it("throws when another arena's directory survived", () => {
    const dir = makeDir();
    fs.mkdirSync(path.join(dir, "art", "arenas", "arena-07"), { recursive: true });
    assert.throws(() => assertOnlyActiveArenaShipped(dir, "arena-01"), /arena-07/);
  });

  it("throws when another arena's manifest key survived", () => {
    const dir = makeDir();
    fs.writeFileSync(
      path.join(dir, "art", "manifest.json"),
      JSON.stringify({ sprites: { "arena.arena-07.floor": { file: "arenas/arena-07/floor.png" } } }),
    );
    assert.throws(() => assertOnlyActiveArenaShipped(dir, "arena-01"), /arena\.arena-07\.floor/);
  });
});

describe("mergeReleaseEnv", () => {
  it("keeps the base file verbatim when there is no local override", () => {
    const base = "# why this port\nPORT=80\n\nDEPLOY_MODE=lan\n";
    assert.equal(mergeReleaseEnv(base), base);
  });

  it("overrides a key in place so it keeps the comment above it", () => {
    const merged = mergeReleaseEnv("# why this port\nPORT=80\nDEPLOY_MODE=lan\n", "PORT=2567\n");
    assert.equal(merged, "# why this port\nPORT=2567\nDEPLOY_MODE=lan\n");
  });

  it("appends a key only the override declares, after one blank separator", () => {
    assert.equal(mergeReleaseEnv("PORT=80\n", "TICK_RATE_HZ=60\n"), "PORT=80\n\nTICK_RATE_HZ=60\n");
  });

  it("normalises trailing blank lines so the separator does not depend on the base file", () => {
    assert.equal(mergeReleaseEnv("PORT=80\n\n\n", "TICK_RATE_HZ=60\n"), "PORT=80\n\nTICK_RATE_HZ=60\n");
  });

  it("ignores comments in the override and ends with exactly one newline", () => {
    const merged = mergeReleaseEnv("PORT=80\n\n\n", "# just a note\n");
    assert.equal(merged, "PORT=80\n");
  });
});

describe("releasePort", () => {
  it("reads PORT out of the shipped env text", () => {
    assert.equal(releasePort("DEPLOY_MODE=lan\nPORT=80\n"), 80);
  });

  it("takes the last assignment, the way dotenv folds a file into one object", () => {
    assert.equal(releasePort("PORT=80\nPORT=3000\n"), 3000);
  });

  // Must stay in step with getPort() in packages/server/src/mode.ts.
  it("falls back to 2567 when PORT is absent, blank or not a positive number", () => {
    assert.equal(releasePort("DEPLOY_MODE=lan\n"), 2567);
    assert.equal(releasePort("PORT=\n"), 2567);
    assert.equal(releasePort("PORT=nope\n"), 2567);
    assert.equal(releasePort("PORT=0\n"), 2567);
  });
});

describe("releaseOrigin", () => {
  it("drops the port only for 80, which is the point of shipping it", () => {
    assert.equal(releaseOrigin("localhost", 80), "http://localhost");
    assert.equal(releaseOrigin("<LAN-IP>", 2567), "http://<LAN-IP>:2567");
  });
});

describe("releaseReadme", () => {
  it("prints port-less URLs and the privileged-port note on 80", () => {
    const readme = releaseReadme(80);
    assert.match(readme, /Open http:\/\/localhost on this machine/);
    assert.match(readme, /cap_net_bind_service/);
    assert.equal(readme.includes("http://localhost:80"), false);
  });

  it("prints the port and no privileged note above 1024", () => {
    const readme = releaseReadme(2567);
    assert.match(readme, /http:\/\/localhost:2567/);
    assert.match(readme, /http:\/\/<LAN-IP>:2567/);
    assert.equal(readme.includes("cap_net_bind_service"), false);
  });
});
