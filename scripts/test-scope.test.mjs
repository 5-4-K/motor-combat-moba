import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeOf, commandsFor } from "./test-scope.mjs";

test("docs-only is none", () => assert.deepEqual(scopeOf(["docs/roadmap.md", "README.md"]), { scope: "none" }));
test("tested doc is full", () => assert.equal(scopeOf(["docs/turn-tuning.md"]).scope, "full"));
test("one mode's overrides → mode scope with common probes", () =>
  assert.deepEqual(scopeOf(["packages/shared/src/modes/conquer/config.ts", "packages/shared/src/modes/__snapshots__/conquer.tables.json"]),
    { scope: "mode", modes: ["conquer"], commonProbes: true }));
test("client hud only → mode scope without common probes", () =>
  assert.deepEqual(scopeOf(["packages/client/src/modes/deathmatch/hud.ts"]), { scope: "mode", modes: ["deathmatch"], commonProbes: false }));
test("family path expands to its modes", () =>
  assert.deepEqual(scopeOf(["packages/server/src/modes/last-standing/controller.ts"]), { scope: "mode", modes: ["brawl", "team-brawl"], commonProbes: false }));
test("two modes stay mode scope", () =>
  assert.deepEqual(scopeOf(["packages/client/src/modes/brawl/hud.ts", "packages/client/src/modes/conquer/hud.ts"]).modes, ["brawl", "conquer"]));
test("a common path makes it full", () =>
  assert.equal(scopeOf(["packages/client/src/modes/brawl/hud.ts", "packages/shared/src/sim/drive.ts"]).scope, "full"));
test("modes root files are common", () =>
  assert.equal(scopeOf(["packages/shared/src/modes/merge.ts"]).scope, "full"));
test("mode commands", () =>
  assert.deepEqual(commandsFor({ scope: "mode", modes: ["conquer"], commonProbes: false }),
    ["npm run test:mode -- conquer", "npm run playtest -- --mode=conquer --scope=mode"]));
