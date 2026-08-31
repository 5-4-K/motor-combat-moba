import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_RELEASE_PORT,
  parsePortArg,
  releaseEnvFile,
  releaseOrigin,
  releasePort,
  releaseReadme,
  setEnvPort,
} from "./release-env.mjs";

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

describe("parsePortArg", () => {
  it("is absent when no --port is given, so the caller falls back to the default", () => {
    assert.deepEqual(parsePortArg([]), { port: undefined });
    assert.deepEqual(parsePortArg(["--yes"]), { port: undefined });
  });

  it("reads both --port 80 and --port=80", () => {
    assert.deepEqual(parsePortArg(["--port", "80"]), { port: 80 });
    assert.deepEqual(parsePortArg(["--port=80"]), { port: 80 });
  });

  it("finds the flag among other arguments in either order", () => {
    assert.deepEqual(parsePortArg(["--yes", "--port", "8080"]), { port: 8080 });
    assert.deepEqual(parsePortArg(["--port", "8080", "--yes"]), { port: 8080 });
  });

  it("rejects a missing value rather than swallowing the next flag", () => {
    assert.match(parsePortArg(["--port"]).error, /needs a number/);
    assert.match(parsePortArg(["--port", "--yes"]).error, /needs a number/);
  });

  it("rejects values TCP cannot express, or that are not whole numbers", () => {
    for (const bad of ["0", "-1", "65536", "abc", "80.5", ""]) {
      assert.ok(parsePortArg(["--port", bad]).error, `expected "${bad}" to be rejected`);
    }
  });
});

describe("DEFAULT_RELEASE_PORT", () => {
  // Must stay in step with getPort() in packages/server/src/mode.ts. A release whose .env disagreed
  // with the server's own fallback would send every player to a closed port.
  it("is the server's own fallback, not a privileged port", () => {
    assert.equal(DEFAULT_RELEASE_PORT, 2567);
    assert.ok(DEFAULT_RELEASE_PORT > 1024);
  });
});

describe("releaseEnvFile", () => {
  it("writes the requested port, and reads back as that port", () => {
    assert.match(releaseEnvFile(80), /^PORT=80$/m);
    assert.equal(releasePort(releaseEnvFile(80)), 80);
    assert.equal(releasePort(releaseEnvFile(DEFAULT_RELEASE_PORT)), DEFAULT_RELEASE_PORT);
  });

  it("keeps DEPLOY_MODE=lan and documents the other knobs", () => {
    const env = releaseEnvFile(2567);
    assert.match(env, /^DEPLOY_MODE=lan$/m);
    assert.match(env, /^TICK_RATE_HZ=$/m);
    assert.ok(env.startsWith("#"));
  });
});

describe("setEnvPort", () => {
  it("rewrites PORT in place, keeping every other key and its comments", () => {
    const before = "# why this port\nPORT=2567\n\n# tuning\nTICK_RATE_HZ=60\n";
    assert.equal(setEnvPort(before, 80), "# why this port\nPORT=80\n\n# tuning\nTICK_RATE_HZ=60\n");
  });

  it("appends PORT to a file that has none rather than silently doing nothing", () => {
    assert.equal(setEnvPort("DEPLOY_MODE=lan\n", 80), "DEPLOY_MODE=lan\n\nPORT=80\n");
  });

  it("rewrites every PORT line, so the last-wins read cannot see a stale one", () => {
    assert.equal(releasePort(setEnvPort("PORT=1\nPORT=2\n", 80)), 80);
  });
});
