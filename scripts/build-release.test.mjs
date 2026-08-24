import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  releasePackageJson,
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertNoDevOnlyCode, DEV_ONLY_MARKERS } from "./build-release.mjs";

describe("assertNoDevOnlyCode", () => {
  function tempDist(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motor-dist-"));
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
