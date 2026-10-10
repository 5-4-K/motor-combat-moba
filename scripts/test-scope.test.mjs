import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeOf, commandsFor, owesSlowTests, owesNet, owesBench, owesBotReport, MODE_FAMILY } from "./test-scope.mjs";
import { MODE_TABLE, activeGameModes, modeSlug } from "../packages/shared/dist/index.js";

test("docs-only is none", () => assert.deepEqual(scopeOf(["docs/roadmap.md", "README.md"]), { scope: "none" }));
test("tested doc is full", () => assert.equal(scopeOf(["docs/turn-tuning.md"]).scope, "full"));
test("one mode's overrides → mode scope with common probes", () =>
  assert.deepEqual(scopeOf(["packages/shared/src/modes/conquer/config.ts", "packages/shared/src/modes/__snapshots__/conquer.tables.json"]),
    { scope: "mode", modes: ["conquer"], commonProbes: true, guards: false }));
test("client hud only → mode scope without common probes", () =>
  assert.deepEqual(scopeOf(["packages/client/src/modes/deathmatch/hud.ts"]), { scope: "mode", modes: ["deathmatch"], commonProbes: false, guards: true }));
test("family path expands to its modes", () =>
  assert.deepEqual(scopeOf(["packages/server/src/modes/last-standing/controller.ts"]), { scope: "mode", modes: ["brawl", "team-brawl"], commonProbes: false, guards: true }));
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
    { scope: "mode", modes: ["brawl", "team-brawl"], commonProbes: false, guards: false }));
test("client family folder expands to its modes", () =>
  assert.deepEqual(scopeOf(["packages/client/src/modes/last-standing/hud.ts"]),
    { scope: "mode", modes: ["brawl", "team-brawl"], commonProbes: false, guards: true }));
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

// The slow tests (`balance/match`, `balance/runner`, the bot tiers — `vitest.groups.ts`) are out of
// `npm test` and owed only when the diff touches what they exercise: a `sim/`, `rooms/`, `modes/`,
// `bot/`, `config/` or `arena/` folder in shared or server, the `balance/` harness, or a vitest
// config/group file. Client code never reaches them.
test("shared sim owes the slow tests", () => assert.equal(owesSlowTests(["packages/shared/src/sim/drive.ts"]), true));
test("server rooms owes the slow tests", () => assert.equal(owesSlowTests(["packages/server/src/rooms/ArenaRoom.ts"]), true));
test("a mode folder owes the slow tests", () => assert.equal(owesSlowTests(["packages/shared/src/modes/conquer/config.ts"]), true));
test("a modes root file owes the slow tests", () => assert.equal(owesSlowTests(["packages/shared/src/modes/merge.ts"]), true));
test("the bot owes the slow tests", () => assert.equal(owesSlowTests(["packages/server/src/bot/brain/solution.ts"]), true));
test("the balance harness owes the slow tests", () => assert.equal(owesSlowTests(["packages/server/balance/match.ts"]), true));
test("the slow-test list itself owes the slow tests", () =>
  assert.equal(owesSlowTests(["packages/server/vitest.groups.ts"]), true));
test("client modes do not owe the slow tests", () => assert.equal(owesSlowTests(["packages/client/src/modes/brawl/hud.ts"]), false));
test("client sim-named folders do not owe the slow tests", () =>
  assert.equal(owesSlowTests(["packages/client/src/net/prediction.ts", "packages/client/src/sim/x.ts"]), false));
test("other shared code does not owe the slow tests", () =>
  assert.equal(owesSlowTests(["packages/shared/src/lobby/x.ts", "docs/testing.md"]), false));
test("playtest probes do not owe the slow tests", () =>
  assert.equal(owesSlowTests(["packages/server/playtest/modes/conquer/zone.ts"]), false));
test("slow tests append npm run test:slow", () =>
  assert.deepEqual(commandsFor({ scope: "mode", modes: ["conquer"], commonProbes: false }, { slowTests: true }),
    ["npm run test:mode -- conquer", "npm run playtest -- --mode=conquer --scope=mode", "npm run test:slow"]));
test("no slowTests option leaves the commands as they were", () =>
  assert.deepEqual(commandsFor({ scope: "none" }), []));

// TS15 — package scope: server/client-only diffs owe their own package suite, not shared's.
const fullPlaytests = () => activeGameModes().map((mode) => `npm run playtest -- --mode=${modeSlug(mode)} --scope=all`);
test("a client-only diff is client package scope", () =>
  assert.deepEqual(scopeOf(["packages/client/src/scenes/hud.ts"]),
    { scope: "packages", packages: ["client"], modes: [], commonProbes: false }));
test("package scope commands: package suite, scripts, then every active mode's playtest", () =>
  assert.deepEqual(commandsFor(scopeOf(["packages/client/src/scenes/hud.ts"])),
    ["npm run test:client", "npm run test:guards", "npm run test:scripts", ...fullPlaytests()]));
test("a client-only diff owes no shared suite", () =>
  assert.ok(!commandsFor(scopeOf(["packages/client/src/scenes/hud.ts"])).some((c) => c === "npm test" || c.includes("test:shared"))));
test("server plus client is both packages, sorted", () =>
  assert.deepEqual(scopeOf(["packages/server/src/rooms/x.ts", "packages/client/src/a.ts"]).packages, ["client", "server"]));
test("playtest and balance count as server", () => {
  assert.deepEqual(scopeOf(["packages/server/playtest/common/ram.ts"]).packages, ["server"]);
  assert.deepEqual(scopeOf(["packages/server/balance/stats.ts"]).packages, ["server"]);
});
test("client public counts as client", () =>
  assert.deepEqual(scopeOf(["packages/client/public/manual.html"]).packages, ["client"]));
for (const path of ["packages/shared/src/sim/drive.ts", "scripts/ttk.mjs", "package.json", "packages/server/vitest.config.ts"]) {
  test(`${path} is full`, () => assert.equal(scopeOf([path, "packages/client/src/a.ts"]).scope, "full"));
}
test("mode plus package is package scope with the mode commands appended", () => {
  const scope = scopeOf(["packages/client/src/a.ts", "packages/client/src/modes/brawl/hud.ts"]);
  assert.deepEqual(scope, { scope: "packages", packages: ["client"], modes: ["brawl"], commonProbes: false });
  assert.ok(commandsFor(scope).includes("npm run test:mode -- brawl"));
});

// Final review 1 — shared's source guards (raw config, mode branching, weapon-slot readers) walk
// server and client source, so a server- or client-only diff must still run them.
test("a server-only diff runs the shared source guards", () =>
  assert.ok(commandsFor(scopeOf(["packages/server/src/rooms/ArenaRoom.ts"])).includes("npm run test:guards")));
test("a server and client diff runs the source guards once", () =>
  assert.equal(commandsFor(scopeOf(["packages/server/src/rooms/x.ts", "packages/client/src/a.ts"]))
    .filter((c) => c === "npm run test:guards").length, 1));
test("a server mode folder runs the source guards", () =>
  assert.deepEqual(commandsFor(scopeOf(["packages/server/src/modes/conquer/controller.ts"])), [
    "npm run test:mode -- conquer",
    "npm run playtest -- --mode=conquer --scope=mode",
    "npm run test:guards",
  ]));
test("a client mode folder runs the source guards", () =>
  assert.ok(commandsFor(scopeOf(["packages/client/src/modes/deathmatch/hud.ts"])).includes("npm run test:guards")));
test("a playtest mode folder runs the source guards", () =>
  assert.ok(commandsFor(scopeOf(["packages/server/playtest/modes/conquer/zone.ts"])).includes("npm run test:guards")));
test("a shared-only mode folder owes no source guards", () =>
  assert.ok(!commandsFor(scopeOf(["packages/shared/src/modes/conquer/config.ts"])).includes("npm run test:guards")));
test("package plus mode diff runs the source guards once", () =>
  assert.equal(commandsFor(scopeOf(["packages/client/src/a.ts", "packages/client/src/modes/brawl/hud.ts"]))
    .filter((c) => c === "npm run test:guards").length, 1));

// TS17 — the slow-trigger gap: config and arena edits change what a real match plays.
test("bot profiles owe the slow tests", () => assert.equal(owesSlowTests(["packages/server/src/config/bot-profiles.ts"]), true));
test("shared config owes the slow tests", () => assert.equal(owesSlowTests(["packages/shared/src/config/drive-config.ts"]), true));
test("shared arena owes the slow tests", () => assert.equal(owesSlowTests(["packages/shared/src/arena/arena-01.ts"]), true));
test("client code does not owe the slow tests", () => assert.equal(owesSlowTests(["packages/client/src/a.ts"]), false));

// Controller ruling — the net group (netsim sweep, scheduler grid) is its own gate, not slow.
test("shared net owes the net tests", () => assert.equal(owesNet(["packages/shared/src/net/clock-sync.ts"]), true));
test("server net owes the net tests", () => assert.equal(owesNet(["packages/server/src/net/shot-comp.ts"]), true));
test("server netsim owes the net tests", () => assert.equal(owesNet(["packages/server/src/netsim/run.ts"]), true));
test("a net config owes the net tests", () => assert.equal(owesNet(["packages/server/vitest.net.config.ts"]), true));
test("NET_CONFIG owes the net tests", () => assert.equal(owesNet(["packages/shared/src/config/net-config.ts"]), true));
test("the tick pipeline owes the net tests", () => assert.equal(owesNet(["packages/server/src/rooms/tick-pipeline.ts"]), true));
test("the snapshot cadence owes the net tests", () => assert.equal(owesNet(["packages/server/src/rooms/snapshot-cadence.ts"]), true));
test("other rooms code does not owe the net tests", () => assert.equal(owesNet(["packages/server/src/rooms/ArenaRoom.ts"]), false));
test("client net does not owe the net tests", () => assert.equal(owesNet(["packages/client/src/net/prediction.ts"]), false));
test("net paths do not owe the slow tests", () =>
  assert.equal(owesSlowTests(["packages/shared/src/net/clock-sync.ts", "packages/server/src/netsim/run.ts"]), false));

// TS18 — bench and bot report.
test("client fx owes the bench", () => assert.equal(owesBench(["packages/client/src/fx/emitters.ts"]), true));
test("the bot owes the bench", () => assert.equal(owesBench(["packages/server/src/bot/brain/solution.ts"]), true));
test("client hud does not owe the bench", () => assert.equal(owesBench(["packages/client/src/scenes/hud.ts"]), false));
test("bot profiles owe the bot report", () => assert.equal(owesBotReport(["packages/server/src/config/bot-profiles.ts"]), true));
test("playtest bot owes the bot report", () => assert.equal(owesBotReport(["packages/server/playtest/bot/report.ts"]), true));
test("client code does not owe the bot report", () => assert.equal(owesBotReport(["packages/client/src/a.ts"]), false));
test("extra commands append in order: slow, net, bench, bot report", () =>
  assert.deepEqual(commandsFor({ scope: "none" }, { slowTests: true, net: true, bench: true, botReport: true }),
    ["npm run test:slow", "npm run test:net", "npm run test:bench", "npm run bot:report"]));
