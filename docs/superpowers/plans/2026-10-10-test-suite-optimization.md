# Test Suite Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `npm test` from ~190 s to ≤ 90 s and `test:slow` from 55 s to ≤ 30 s on the measuring box, group tests into fast / slow / bench / report-only, route diffs per package, and remove redundant and stale tests and probe text — without un-gating any invariant.

**Architecture:** One `vitest.groups.ts` per package lists its SLOW and BENCH files; the default config excludes both, the group configs include only theirs. Calibration assertions move out of vitest into a report-only playtest entry (`npm run bot:report`) using the existing `Reporter`. `scripts/test-scope.mjs` gains a `"packages"` scope and wider slow/bench/report triggers.

**Tech Stack:** npm workspaces, vitest 2.1.9 (forks pool, default isolation), tsx, `node --test` for `scripts/*.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-10-test-suite-optimization-design.md` (TS1–TS40). Read it before any task; requirement ids below refer to it.

## Global Constraints

- Branch: `test/suite-optimization`. Never push to another branch.
- Shared is consumed as built `dist`: after touching `packages/shared/src`, run `npm run build -w @motor-combat-moba/shared` before running server or client tests.
- Never run a blanket `vitest -u`. No snapshot file should move in this plan at all.
- Never weaken an assertion silently: a deleted assertion names (in the commit message) the test that still catches the same failure.
- Probes report, never assert; verdicts are `OK` / `FINDING` / `KNOWN-BY-DESIGN`; contact scenarios keep their sub-tick phase sweep.
- `docs/ideas/` and `docs/invariants/` are off limits — exclude them from every grep.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FpTG1i9jegqdyvnuNVq9cB
  ```

## Review Focus

1. **A test file in neither or both groups.** Moving a file into `SLOW_TESTS`/`BENCH_TESTS` with a typo'd path silently drops it from every run. Task 1 adds a guard test that every listed path exists and no path is in both lists.
2. **A shortened run that measures nothing.** Each shortened netsim/scheduler run asserts an event count > 0 (Task 2, Task 3).
3. **A report scenario that throws.** One crashing scenario must not stop the others; the runner reports it as `FINDING` with the error message and continues (Task 5).
4. **A client-only diff routed to too little.** `test-scope.test.mjs` pins that client-only owes `test:client` + `test:scripts` + the playtest commands, and that any shared path still escalates to full (Task 6).
5. **A deleted "duplicate" that guarded something distinct.** Before deleting a pin (Task 7) the implementer finds the value in the snapshot JSON; derived/relational assertions stay.

---

### Task 1: Test groups infrastructure (TS1–TS3, TS10)

**Files:**
- Create: `packages/server/vitest.groups.ts` (replaces `packages/server/vitest.slow-tests.ts`, delete that file), `packages/shared/vitest.groups.ts`, `packages/client/vitest.groups.ts`
- Create: `packages/shared/vitest.slow.config.ts`, `packages/server/vitest.bench.config.ts`, `packages/client/vitest.bench.config.ts`
- Modify: `packages/{shared,server,client}/vitest.config.ts`, `packages/server/vitest.slow.config.ts`, `packages/{shared,server,client}/package.json` scripts, root `package.json` scripts
- Test: `packages/{shared,server,client}/src/vitest-groups.test.ts` (one guard per package, each importing only its own `../vitest.groups.ts`, so no test reaches outside its package's tree)

**Interfaces:**
- Produces: each `vitest.groups.ts` exports `SLOW_TESTS: string[]` and `BENCH_TESTS: string[]` (globs relative to the package root). Package scripts `test:slow` (shared, server) and `test:bench` (server, client). Root scripts `test:slow`, `test:bench`, `test:shared`, `test:server`, `test:client`.
- Initial lists (later tasks edit them):
  - server `SLOW_TESTS`: `src/bot/**/*.test.ts` minus nothing yet (kept as today until Task 5), `balance/match.test.ts`, `balance/runner.test.ts`; server `BENCH_TESTS`: `src/bot/brain/brain.bench.test.ts`. Because `src/bot/**` would also match the bench file, write SLOW as the glob plus vitest `exclude` of BENCH in the slow config.
  - shared: both empty for now.
  - client `BENCH_TESTS`: `src/fx/perf.test.ts`.

- [ ] **Step 1: Write the guard test** `src/vitest-groups.test.ts` in each package: import `../vitest.groups.ts`; assert every non-glob path exists on disk (`fs.existsSync`), every glob matches ≥ 1 file (use `fast-glob` if present in node_modules, else `fs.globSync` on Node 22), and `SLOW_TESTS ∩ BENCH_TESTS` resolved to files is empty.
- [ ] **Step 2:** Run `npx vitest run src/vitest-groups.test.ts` in each package — expect FAIL (module not found). If a package's `tsconfig.json` does not include the package root's `vitest.groups.ts` and `tsc --noEmit` complains, add it to that tsconfig's `include` rather than moving the file.
- [ ] **Step 3:** Create the three `vitest.groups.ts`, the configs (default: `exclude: [...configDefaults.exclude, ...SLOW_TESTS, ...BENCH_TESTS]`; slow: `include: SLOW_TESTS, exclude: [...configDefaults.exclude, ...BENCH_TESTS]`; bench: `include: BENCH_TESTS`), package scripts (`"test:slow": "vitest run -c vitest.slow.config.ts --passWithNoTests"`, `"test:bench": "vitest run -c vitest.bench.config.ts"`), and root scripts:
  - `test:slow`: build shared, then `npm run test:slow -w @motor-combat-moba/shared && npm run test:slow -w @motor-combat-moba/server`
  - `test:bench`: build shared, then server then client `test:bench`
  - `test:<pkg>`: build shared, then `npm run typecheck -w <pkg> && npm run test -w <pkg>`
  Update the doc comment that lived in `vitest.slow-tests.ts` into `vitest.groups.ts`, and fix every reference to `vitest.slow-tests.ts` (grep `scripts/`, `docs/`, `packages/`).
- [ ] **Step 4:** Run the three guard tests — PASS. Then `npx vitest list` (or `vitest run --reporter=json`) in client to confirm `fx/perf.test.ts` is absent from the default run and present under `-c vitest.bench.config.ts`; same for server's `brain.bench.test.ts`.
- [ ] **Step 5:** `npm run test:bench` and `npm run test:slow` both pass.
- [ ] **Step 6: Commit** `test: one group list per package; bench group for timing tests`.

### Task 2: netsim split (TS4, TS5)

**Files:**
- Modify: `packages/server/src/netsim/netsim.test.ts`
- Create: `packages/server/src/netsim/netsim.sweep.test.ts`
- Modify: `packages/server/vitest.groups.ts` (add `src/netsim/netsim.sweep.test.ts` to `SLOW_TESTS`)

**Interfaces:** Consumes `runNetsim`, `runNetsimDetailed`, `LINKS` (`src/netsim/run.ts`, `link.ts`) unchanged.

- [ ] **Step 1:** Move the current file's contents verbatim into `netsim.sweep.test.ts` (four links at 20 s, G5 seed 2 at 10 s, FOV run, both determinism pairs) and add it to `SLOW_TESTS`.
- [ ] **Step 2:** Rewrite `netsim.test.ts` to exactly three tests:
  - `"net150, 3 s: every car steps once per tick, metrics finite, shots end cleanly (NR17, G5)"` — `runNetsimDetailed({ link: LINKS.net150, model: "tick", seconds: 3, seed: 1 })`; assert every non-null metric finite, `stepsPerTickMax === 1`, `repeatedInputRate !== null`, `diagnostics.shotEndings > 0`, `diagnostics.phantomShotEndings === 0`.
  - `"is deterministic for a seed"` — two `runNetsim({ link: LINKS.net80, model: "tick", seconds: 2, seed: 3 })`, `toEqual`.
  - `"FOV on, 3 s: no hidden enemy reaches a client, no phantom impact (G5)"` — the existing FOV assertions at `seconds: 3`, keeping `carReveals > 0` and `shotEndings > 0`.
- [ ] **Step 3:** Run `npx vitest run src/netsim/netsim.test.ts` — PASS, file under 12 s.
- [ ] **Step 4: Prove it can fail:** temporarily change the net150 assertion to `stepsPerTickMax` `toBe(0)`, see FAIL, revert.
- [ ] **Step 5:** `npx vitest run -c vitest.slow.config.ts src/netsim/netsim.sweep.test.ts` — PASS.
- [ ] **Step 6: Commit** `test(netsim): 3 s smoke in the fast suite, full link sweep in slow`.

### Task 3: Flame containment and scheduler grid (TS6, TS7)

**Files:**
- Modify: `packages/client/src/scenes/combat-visual.test.ts:501-526`
- Modify: `packages/shared/src/net/input-scheduler.test.ts` (the `cells` grid, ~line 191)
- Create: `packages/shared/src/net/input-scheduler.envelope.test.ts`
- Modify: `packages/shared/vitest.groups.ts` (add the envelope file to `SLOW_TESTS`)

- [ ] **Step 1:** In both containment loops, push a string per violation (`t=<ms> layer=<i> point=<j> x=<x> y=<y>`) into `violations` using the same three bounds and `1e-9` tolerance, then `expect(violations).toEqual([])`. Same `FRAMES`, `EXTENT`, step of 7.
- [ ] **Step 2:** Run `cd packages/client && npx vitest run src/scenes/combat-visual.test.ts` — PASS, the flame test under 0.5 s (read the JSON reporter duration).
- [ ] **Step 3: Prove it can fail:** temporarily drop `tanHalf` to `tanHalf * 0.5`, see FAIL listing violations, revert.
- [ ] **Step 4:** Move the full grid and its `it.each` block verbatim into `input-scheduler.envelope.test.ts` (copy the helpers it needs — `simulate`, `meanSlack`, `WARMUP_MS` — by exporting them from a small `src/net/input-scheduler.fixture.ts` that both test files import, rather than duplicating). In the fast file, the grid becomes fps `[60, 144]` × jitter `[0, 30]` × drift `[0, 0.01, -0.01]` × spike `[0, 0.2]`, seed `[1]` only.
- [ ] **Step 5:** Run both files (fast with default config, envelope with `-c vitest.slow.config.ts`) — PASS; fast file under 2 s.
- [ ] **Step 6: Commit** `test: one assertion per containment sweep; scheduler corners fast, full grid slow`.

### Task 4: Balance duplicates and seed-free invariants (TS8, TS9, TS13 match parts)

**Files:**
- Modify: `packages/server/balance/match.ts` (extract and export the deathmatch ranking)
- Modify: `packages/server/balance/match.test.ts`, `packages/server/balance/runner.test.ts`

**Interfaces:**
- Produces: `export function rankDeathmatch(players: readonly { sessionId: string; kills: number; deaths: number }[]): Map<string, number>` in `balance/match.ts`; `placementsFor`'s `respawns` branch calls it. Task 5 does not use it.

- [ ] **Step 1: Write the failing test** `describe("rankDeathmatch")` in `match.test.ts`: `[a 2k/1d, b 1k/0d]` → a 1, b 2 (kills beat deaths); `[a 1k/2d, b 1k/1d]` → b 1, a 2; `[a 0/0, b 0/0]` → both 1; the same three inputs reversed give the same map (seat order never breaks a tie); `[a 2/0, b 1/0, c 1/0, d 0/0]` → 1, 2, 2, 4 (competition ranking).
- [ ] **Step 2:** Run — FAIL (`rankDeathmatch` not exported).
- [ ] **Step 3:** Extract `rankDeathmatch` from `placementsFor` (same comparator, same `competitionRank`).
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Replace "ranks placement by kills then fewest deaths in deathmatch" (the 8-seed spread) with nothing in this file — Task 5 reports the spread. Keep its history comment block out of the test file; Task 5 carries the gist into the report scenario's doc comment.
- [ ] **Step 6:** Rewrite "shortening matchSeconds still lets the deathmatch clock fire…" seed-free: a `FFA_DEATHMATCH` run at `matchSeconds` 30 (whatever field the current test uses to set it) on seed 1; assert `hitClock === false` and `|ticks − 30 × TICK_RATE_HZ| ≤ 1`. Drop the seed-history comment; keep two lines saying what the defect was. **Verify the semantics first:** confirm in `match.ts` that a match ended by the deathmatch clock sets `concluded`; if not, stop and report.
- [ ] **Step 7: Prove it can fail:** in `match.ts`, temporarily pin `matchEndsTick` to the 180 s default (the original defect), see the new test FAIL, revert.
- [ ] **Step 8:** Delete "is deterministic for a seed (B43)" (subsumed by the byte-identical digest test). Tests that only need a finished `runMatch(SETUP)` read one `beforeAll` result.
- [ ] **Step 9:** In `runner.test.ts`: confirm `digest(aggregate(...))` covers per-match tick counts (read `stats.ts` `pace`); if it does not, add `ticks` comparison into the digest test first. Then delete "replays identically for a seed" and set "runs matches x pairs in duel" to `matchSeconds: 1`.
- [ ] **Step 10:** `npm run test:slow` — PASS; `match.test.ts` + `runner.test.ts` together under 25 s.
- [ ] **Step 11: Commit** `test(balance): ranking as a unit test, clock defect seed-free, drop duplicate replays`.

### Task 5: Bot report and the calibration move (TS11–TS14)

**Files:**
- Create: `packages/server/playtest/bot/run.ts` (entry), `packages/server/playtest/bot/occupancy.ts`, `packages/server/playtest/bot/tiers.ts`, `packages/server/playtest/bot/placement.ts`
- Modify: `packages/server/playtest/common/reporter.ts` (export `createRunDirIn`)
- Modify: `packages/server/package.json` (`"bot:report": "tsx playtest/bot/run.ts"`), root `package.json` (`"bot:report": "npm run build -w @motor-combat-moba/shared && npm run bot:report -w @motor-combat-moba/server"`)
- Delete: `packages/server/src/bot/brain/occupancy.test.ts`
- Modify: `packages/server/src/bot/brain/tiers.test.ts` (keep only "whole-brain determinism (BB63)" and the helpers it needs)
- Modify: `packages/server/vitest.groups.ts`: `SLOW_TESTS` becomes `["balance/match.test.ts", "balance/runner.test.ts", "src/bot/brain/tiers.test.ts", "src/netsim/netsim.sweep.test.ts"]` (no `src/bot/**` glob)

**Interfaces:**
- Each scenario module exports `run(report: (probe: string, verdict: string, detail: string) => void): void`.
- `run.ts`: `const dir = createRunDirIn(REPORTS_ROOT, "bot")`; one `Reporter("bot", "<one line>")`; calls each module's `run` inside `try/catch`, a throw becomes `report(<module>, VERDICT.FINDING, "threw: " + message)`; writes the report; exit code 0 always.

- [ ] **Step 1:** Port `occupancy.test.ts`'s three cases into `occupancy.ts`: same setup (seed 7, 60 s, arenas), same tallies, same bounds as named constants. `OK` when every bound holds; `FINDING` naming each breached bound with measured vs bound otherwise. Keep the file's header doc comment as the module's doc.
- [ ] **Step 2:** Port `tiers.test.ts`'s "tier characterisation (BB60)" (7 cases) and "the reported symptoms stay fixed (BB3)" (3 cases) into `tiers.ts`, one `report` per former `it`, its title as the probe name, verdict from the former assertion(s), detail printing the measured values.
- [ ] **Step 3:** Port the 8-seed placement spread into `placement.ts`: for each seed report the placements; verdict `OK` if the ranking rule holds on every outcome (same check as the old test) and at least one outcome was decisive; `FINDING` naming which part failed. Detail lists decisive seeds count, e.g. `decisive 4/8`.
- [ ] **Step 4:** Delete `occupancy.test.ts`; strip the moved blocks from `tiers.test.ts`; update `SLOW_TESTS` as above. Every other `src/bot/**` test now runs in `npm test`.
- [ ] **Step 5:** Run `npm run bot:report` — completes, prints a report path ending in `-bot/bot.md`, every verdict `OK` (they all passed as tests on this tree). If any reads `FINDING`, compare against running the original test at `HEAD~` before deciding — do not loosen a bound.
- [ ] **Step 6: Prove the guard:** temporarily `throw` inside `placement.ts`'s `run`; the report still contains occupancy and tiers results plus a `FINDING … threw:` row; revert.
- [ ] **Step 7:** `cd packages/server && npm run typecheck && npx vitest run` (default config: now includes the bot unit tests) — PASS; `npm run test:slow` — PASS.
- [ ] **Step 8: Commit** `test(bot): calibration checks report through npm run bot:report; bot unit tests join npm test`.

### Task 6: Routing (TS15–TS19)

**Files:**
- Modify: `scripts/test-scope.mjs`, `scripts/test-scope.test.mjs`

**Interfaces:**
- `scopeOf(paths)` returns `{scope:"none"} | {scope:"mode", modes, commonProbes} | {scope:"packages", packages: ("server"|"client")[], modes: string[], commonProbes: boolean} | {scope:"full"}`.
- `owesSlowTests(paths)`, new `owesBench(paths)`, `owesBotReport(paths)`; `commandsFor(scope, { slowTests, bench, botReport })`.

- [ ] **Step 1: Write the failing tests** in `test-scope.test.mjs`:
  - `["packages/client/src/scenes/hud.ts"]` → `{scope:"packages", packages:["client"], modes:[], commonProbes:false}`; commands start `npm run test:client`, then `npm run test:scripts`, then the per-active-mode `playtest --scope=all` lines.
  - `["packages/server/src/rooms/x.ts","packages/client/src/a.ts"]` → packages `["client","server"]` (sorted).
  - `packages/server/playtest/common/ram.ts` and `packages/server/balance/stats.ts` → server; `packages/client/public/manual.html` → client.
  - Any of `packages/shared/src/sim/drive.ts`, `scripts/ttk.mjs`, `package.json`, `packages/server/vitest.config.ts` → `"full"`.
  - `["packages/client/src/a.ts","packages/client/src/modes/brawl/hud.ts"]` → packages `["client"]`, modes `["brawl"]`; commands include `npm run test:mode -- brawl`.
  - `owesSlowTests(["packages/server/src/config/bot-profiles.ts"])`, `(["packages/shared/src/config/drive-config.ts"])`, `(["packages/shared/src/net/clock-sync.ts"])`, `(["packages/server/src/netsim/run.ts"])` → true; `(["packages/client/src/a.ts"])` → false.
  - `owesBench(["packages/client/src/fx/emitters.ts"])` → true; `owesBotReport(["packages/server/src/config/bot-profiles.ts"])` → true; `owesBotReport(["packages/client/src/a.ts"])` → false.
  - `commandsFor` order: scope commands, then `npm run test:slow`, `npm run test:bench`, `npm run bot:report` when each is owed.
- [ ] **Step 2:** `npm run test:scripts` — new cases FAIL.
- [ ] **Step 3:** Implement per spec TS15–TS18. In `main`, a command ending in `bot:report` runs but its failure never sets `process.exitCode`; print it as `npm run bot:report   (report only)`.
- [ ] **Step 4:** `npm run test:scripts` — PASS. `node scripts/test-scope.mjs` on this branch prints a sensible scope.
- [ ] **Step 5: Commit** `feat(test-scope): package scope; slow, bench and bot-report triggers`.

### Task 7: Snapshot-duplicate pins and base duplicates (TS20, TS25)

**Files:** `packages/shared/src/config/{config,status-config,weapon-config,ram-config,spike-config,weapon-slots}.test.ts`

- [ ] **Step 1:** For each candidate assertion (`expect(<RAW_TABLE>.<path>).toBe(<literal>)` or `toEqual` on a raw table subtree), find the same path and value in `packages/shared/src/modes/__snapshots__/brawl.tables.json`. Delete only matches. Keep: anything reading `derived()`, `*_TICKS`, a computed helper, a comparison between two values, or a mode's resolved value. A test left with no assertions is deleted whole.
- [ ] **Step 2:** Delete the exclusivity and truncation checks in `weapon-slots.test.ts` that `modes/invariants.test.ts` runs per mode (read both; delete only if the invariant test asserts the same property).
- [ ] **Step 3: Prove the snapshot still catches it:** change one deleted pin's value in `config/` (e.g. a `SPIKE_CONFIG` number), run `npx vitest run src/modes/snapshots.test.ts` — FAIL; revert.
- [ ] **Step 4:** `cd packages/shared && npx vitest run` — PASS. Count removed assertions for the commit message.
- [ ] **Step 5: Commit** `test(shared): drop raw-table pins the per-mode snapshots already lock`.

### Task 8: Source guards share one walker; orphan fixture (TS21, TS22)

**Files:**
- Create: `packages/shared/src/test-support/source-walk.ts`
- Modify: `packages/shared/src/modes/no-raw-config-in-sim.test.ts`, `packages/shared/src/modes/no-mode-branching.test.ts`, `packages/shared/src/config/weapon-slots-readers.test.ts`
- Delete: `packages/shared/src/modes/__fixtures__/shipped-tables.json`

**Interfaces:** `walkSource(root: string, opts?: { exts?: string[]; skipTests?: boolean }): string[]` (posix-relative paths, sorted); `readSource(absPath: string): string` (cached per process); `stripComments(src: string): string`. Signatures must cover what the three files do today — read all three first and match their behaviour exactly (extensions, test-file skipping, comment-stripping rules).

- [ ] **Step 1:** Build the helper; switch the three files to it without changing a rule, allow-list or tripwire test.
- [ ] **Step 2:** Delete the `sim/` walk in `no-raw-config-in-sim.test.ts` that the whole-`shared/src` walk already covers (confirm `sim` is not in its `ALLOWED_DIRS`).
- [ ] **Step 3: Prove each guard still fires:** add a raw `CAR_TABLE` read to a scratch file under `packages/shared/src/sim/`, run the three files — `no-raw-config-in-sim` FAILS; delete the scratch file. The tripwire tests inside each file must still pass.
- [ ] **Step 4:** Grep for `shipped-tables` (repo-wide, excluding `docs/superpowers/plans/`, `docs/ideas/`, `docs/invariants/`); if no reader, delete the fixture.
- [ ] **Step 5:** `cd packages/shared && npx tsc --noEmit -p tsconfig.json && npx vitest run` — PASS. Make sure `test-support/` is not emitted into `dist` in a way that breaks the build (`npm run build -w @motor-combat-moba/shared`).
- [ ] **Step 6: Commit** `test(shared): one source walker for the three source guards; drop unread fixture`.

### Task 9: Dash sweep and stale titles (TS23, TS24)

**Files:** `packages/shared/src/sim/step.test.ts:199-260`, `packages/shared/src/sim/combat.test.ts` (tremor titles), `packages/shared/src/sim/weapons/fire.test.ts`, `packages/shared/src/sim/status/combat.test.ts`

- [ ] **Step 1:** Replace the dasher axis of the sweep with the chassis whose kit carries a dash maneuver, computed at test time from `cars()`/`weapons()` (filter kit weapons with `kind: "maneuver"` and the dash maneuver kind — read `ManeuverKind` and today's sweep comment at lines 203-206). Assert the derived list is non-empty. Victims stay every pairing; headings, target angles, 24 phases and 8 ticks unchanged.
- [ ] **Step 2:** Run `npx vitest run src/sim/step.test.ts` — PASS, faster than 0.8 s.
- [ ] **Step 3:** Retitle tests describing `tremor` as unassigned/unused (it is Bastion's); delete comment-only tombstone blocks for deleted suites in the two files named. No assertion changes.
- [ ] **Step 4:** `cd packages/shared && npx vitest run` — PASS.
- [ ] **Step 5: Commit** `test(shared): sweep only chassis that dash; fix stale tremor titles`.

### Task 10: Probe maintenance (TS26–TS28)

**Files:** `packages/server/playtest/common/collision.ts` (scenario 9, ~lines 538-575), `packages/server/playtest/common/ram.ts` (R5, ~lines 330-415), `packages/server/playtest/common/geometry.ts:37`

**Interfaces:** Consumes `statusesOf` from `playtest/common/world.ts`; `reeling` duration from the installed mode (`ram()` accessor — find the field that sets reeling's ms, read `sim/ram-bridge.ts`), converted to ticks the same way the sim does.

- [ ] **Step 1:** Scenario 9: keep the chain-ram loop; each tick record whether the victim's statuses include a row whose flags contain `steeringLocked`. Report control-loss share (%) and longest uninterrupted locked run (ticks and ms). `OK` if longest run ≤ reeling-duration ticks + 1, else `FINDING` with both numbers. Replace the "Not measured" text and the placeholder comment.
- [ ] **Step 2:** R5: count a ram as an edge where the attacker gains `ramLock`; remove the "no longer trusts" caveat and the dead "authority dip" sentence. Keep the 63-run phase sweep.
- [ ] **Step 3:** geometry header: drop "aim-assist LOS".
- [ ] **Step 4:** `cd packages/server && npx tsc --noEmit -p playtest/tsconfig.json` — clean; `npm run playtest -- --scope=common` from root — completes; record scenario 9's share/longest-lock and R5's ram counts for the summary.
- [ ] **Step 5: Commit** `playtest: ram-chain probe measures reeling; R5 counts rams by ramLock onset`.

### Task 11: Docs and the before/after measurement (TS33–TS39)

**Files:** `docs/testing.md`, `CLAUDE.md` ("Which tests to run", "Commands"), `packages/server/playtest/README.md`, `docs/bot-behavior.md`, `.claude/skills/bot-tuner/SKILL.md`, the spec's §2 (append an "After" column)

- [ ] **Step 1:** `docs/testing.md`: groups table (spec §3), package scope with examples, new triggers, the calibration rule (spec §5), where each moved check now lives. Remove references to `vitest.slow-tests.ts`.
- [ ] **Step 2:** `CLAUDE.md`: update the slow-tests bullet and the commands block (`test:shared|server|client`, `test:bench`, `bot:report`); state calibration is report-only. Describe current state only — no changelog prose.
- [ ] **Step 3:** Playtest README: a "Bot report" section — command, scenarios, that bounds are the former test bounds, that it never fails.
- [ ] **Step 4:** `bot-behavior.md` and the bot-tuner skill: wherever they tell the reader a tier/occupancy/P50 *test* will fail, point to `npm run bot:report` instead (grep `tiers.test`, `occupancy`, `P50`).
- [ ] **Step 5:** Measure on one box back to back: `time npm test`, `time npm run test:slow`, `time npm run test:bench`, `time npm run bot:report`. Record in the spec §2 table. All green.
- [ ] **Step 6: Commit** `docs: test groups, package scope, report-only calibration`.
