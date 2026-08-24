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
