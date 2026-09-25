import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeOf, commandsFor, MODE_FAMILY } from "./test-scope.mjs";
import { MODE_TABLE, modeSlug } from "../packages/shared/dist/index.js";

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

// Review round 1: a shared/client path under a FAMILY name (e.g. `modes/last-standing/`) must
// expand to that family's slugs, not be mistaken for a slug of its own — `last-standing` is a
// family name, never a mode slug.
test("shared family folder expands to its modes", () =>
  assert.deepEqual(scopeOf(["packages/shared/src/modes/last-standing/rules.ts"]),
    { scope: "mode", modes: ["brawl", "team-brawl"], commonProbes: false }));
test("client family folder expands to its modes", () =>
  assert.deepEqual(scopeOf(["packages/client/src/modes/last-standing/hud.ts"]),
    { scope: "mode", modes: ["brawl", "team-brawl"], commonProbes: false }));
test("an unknown modes folder is full", () =>
  assert.equal(scopeOf(["packages/shared/src/modes/bogus/x.ts"]).scope, "full"));

// Finding 2: a `config.ts`/snapshot change also owes `npm run test:scripts` (the manual-page stamp
// and the turn-tuning doc), since a mode-scoped table edit can move both without any mode-scoped
// test suite noticing.
test("commonProbes also owes npm run test:scripts", () =>
  assert.deepEqual(commandsFor({ scope: "mode", modes: ["conquer"], commonProbes: true }), [
    "npm run test:mode -- conquer",
    "npm run playtest -- --mode=conquer --scope=mode",
    "npm run playtest -- --mode=conquer --scope=common",
    "npm run test:scripts",
  ]));

// Finding 13: `MODE_FAMILY`'s keys must equal every mode slug `MODE_TABLE` actually carries — a new
// mode with no `MODE_FAMILY` entry would silently fall through `resolveSegment` as "unknown", which
// this repo treats as common-code (safe but noisy) rather than a real gap in the map.
test("MODE_FAMILY covers exactly the slugs in MODE_TABLE", () =>
  assert.deepEqual(
    Object.keys(MODE_FAMILY).sort(),
    Object.keys(MODE_TABLE).map((mode) => modeSlug(Number(mode))).sort(),
  ));
