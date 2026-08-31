import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  MANAGED_ENTRIES,
  describeExisting,
  friendlyFsError,
  installArgs,
  parseTargetFile,
  pathRelationError,
} from "./install-build.mjs";

const repoRoot = path.resolve("/home/dev/motor-combat-moba");
const home = path.resolve("/home/dev");

describe("parseTargetFile", () => {
  it("takes the one path, ignoring comments and blank lines", () => {
    assert.deepEqual(parseTargetFile("# where it goes\n\n/srv/game\n\n"), { target: "/srv/game" });
  });

  it("reports an empty file and a comments-only file the same way", () => {
    assert.equal(parseTargetFile("").error, "empty");
    assert.equal(parseTargetFile("   \n\t\n").error, "empty");
    assert.equal(parseTargetFile("# nothing but a note\n").error, "empty");
  });

  it("refuses two paths rather than picking one, so an unfinished edit cannot install silently", () => {
    const parsed = parseTargetFile("/srv/old\n/srv/new\n");
    assert.equal(parsed.error, "multiple");
    assert.deepEqual(parsed.found, ["/srv/old", "/srv/new"]);
  });

  it("strips quotes a Windows path copied from Explorer arrives wrapped in", () => {
    assert.deepEqual(parseTargetFile('"D:\\games\\mc"\n'), { target: "D:\\games\\mc" });
  });

  it("tolerates CRLF, which is what a file edited on Windows actually contains", () => {
    assert.deepEqual(parseTargetFile("# note\r\nD:\\games\\mc\r\n"), { target: "D:\\games\\mc" });
  });
});

describe("pathRelationError", () => {
  it("refuses the repo root — the script would delete the source tree", () => {
    const error = pathRelationError(repoRoot, repoRoot, home);
    assert.match(error, /repository itself/);
  });

  it("refuses a folder inside the repo", () => {
    const error = pathRelationError(path.join(repoRoot, "dist-release"), repoRoot, home);
    assert.match(error, /repository itself/);
  });

  it("refuses an ancestor of the repo, which would take the checkout with it", () => {
    const error = pathRelationError(path.resolve("/home/dev/projects"), path.resolve("/home/dev/projects/app"), home);
    assert.match(error, /repository lives inside it/);
  });

  it("refuses the filesystem root", () => {
    // Refused as an ancestor rather than by the root check, since every checkout is under it. The
    // root check earns its keep on Windows, where `D:\` is a root that no `C:\` checkout sits below.
    assert.match(pathRelationError(path.parse(repoRoot).root, repoRoot, home), /refusing to install/);
  });

  it("refuses the home directory when the checkout does not live under it", () => {
    // A checkout inside home makes home an ancestor, and that refusal fires first — also correct,
    // just differently worded. This is the case where the home check is the one doing the work.
    const repoElsewhere = path.resolve("/srv/code/app");
    assert.match(pathRelationError(home, repoElsewhere, home), /home directory/);
  });

  it("allows an ordinary sibling folder", () => {
    assert.equal(pathRelationError(path.resolve("/srv/game"), repoRoot, home), undefined);
  });

  it("does not mistake a sibling with a shared name prefix for a child", () => {
    assert.equal(pathRelationError(`${repoRoot}-install`, repoRoot, home), undefined);
  });
});

describe("friendlyFsError", () => {
  it("names the running server first for a lock, because that is the actionable cause", () => {
    const message = friendlyFsError({ code: "EBUSY" }, "/srv/game");
    assert.match(message, /locked by another process/);
    assert.match(message, /server is most likely still running/);
  });

  it("sends a permission error to permissions, not to the server", () => {
    const message = friendlyFsError({ code: "EACCES" }, "/srv/game");
    assert.match(message, /no permission to write/);
    assert.doesNotMatch(message, /still running/);
  });

  it("says out loud that a disk-full install is incomplete", () => {
    assert.match(friendlyFsError({ code: "ENOSPC" }, "/srv/game"), /INCOMPLETE/);
  });

  it("falls back to the raw message for an errno it has no advice for", () => {
    assert.match(friendlyFsError({ code: "EWEIRD", message: "boom" }, "/srv/game"), /boom/);
  });
});

describe("describeExisting", () => {
  it("splits a previous install into what is replaced and what survives", () => {
    const seen = describeExisting(["packages", "package.json", "node_modules", ".env", "server.log"]);
    assert.deepEqual(seen.managedPresent, ["packages", "package.json"]);
    assert.equal(seen.hasNodeModules, true);
    assert.deepEqual(seen.others, [".env", "server.log"]);
    assert.equal(seen.empty, false);
  });

  it("reports an empty folder as empty", () => {
    const seen = describeExisting([]);
    assert.equal(seen.empty, true);
    assert.deepEqual(seen.managedPresent, []);
    assert.equal(seen.hasNodeModules, false);
  });

  it("never counts node_modules as something the install replaces", () => {
    assert.equal(MANAGED_ENTRIES.includes("node_modules"), false);
    assert.deepEqual(describeExisting(["node_modules"]).others, []);
  });
});

describe("installArgs", () => {
  it("is npm install, not npm ci — the release ships no lockfile for ci to read", () => {
    const args = installArgs();
    assert.equal(args[0], "install");
    assert.equal(args.includes("ci"), false);
  });

  it("omits dev dependencies, so nothing dev-only reaches a play machine", () => {
    assert.ok(installArgs().includes("--omit=dev"));
  });

  it("does NOT pass --prefer-offline, which fails the first install against a stale packument", () => {
    // Observed: `ETARGET No matching version found for qs@~6.15.1` on a tree that installed fine
    // without the flag. Repeat installs are offline anyway via the lockfile npm leaves in the target.
    assert.equal(installArgs().includes("--prefer-offline"), false);
  });
});
