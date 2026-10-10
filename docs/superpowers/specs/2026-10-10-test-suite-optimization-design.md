# Test suite optimization — design

**Date:** 2026-10-10 · **Scope:** A (hotspots + routing) and C (redundancy and staleness). B (one
vitest projects config, a shared mode-setup file, `isolate: false`) is deliberately **out of scope**
and is a follow-up. Requirement ids are `TS1`…`TS40`.

## 1. Why, in one paragraph

The suite is not slow because it has many tests. On `882d4e6` (4 cores, this container), `npm test`
is about 190 s and almost all of it is two tests: `packages/server/src/netsim/netsim.test.ts`
(112 s, eight tests running 20 s six-car network simulations at ~1x real time) and one flame
containment test in `packages/client/src/scenes/combat-visual.test.ts` (14 s, three `expect()` calls
per vertex). The other ~4,000 tests cost ~35 s of CPU together. Meanwhile `npm run test:slow` (55 s)
is now *faster* than the server part of `npm test`, it holds ~15 pure bot unit-test files that cost
~1.5 s and never run in `npm test`, and it holds calibration checks that the user has decided must
**report, not fail**. Routing is binary — one mode, or everything — so a client-only diff (a third of
recent commits) still runs shared and server.

## 2. Measured baseline (keep for the before/after)

| Suite | Wall | Dominant cost |
|---|---|---|
| `npm test` total | ~190 s | serial: build 3, typecheck ~25, shared 28, server 128, client 31, scripts 2 |
| server | 128 s | `netsim.test.ts` 112 s (net150 24.5, net80 22.0, net80clean 20.2, G5 11.5, lan ~10, determinism ~2×5) |
| client | 31 s | `combat-visual.test.ts` "never draws past the cone hitbox…" 14.4 s; `fx/perf.test.ts` 2.0 s (a timing test) |
| shared | 28 s | `net/input-scheduler.test.ts` 5.5 s (a 90-cell × 2-seed × 60 s grid) |
| `test:slow` | 55 s | `balance/runner.test.ts` 40.7 s (19.1 s of it a duplicate), `balance/match.test.ts` 20.5 s, `occupancy.test.ts` 12 s, `brain.bench.test.ts` 6.1 s, `tiers.test.ts` 5.4 s |

**Measured non-vacuity of short netsim runs** (seed 1, `model: "tick"`): at 3 s every link has
`stepsPerTickMax` 1, no null metric, and `shotEndings` 42/24/24/6 (lan/net80clean/net80/net150); the
FOV run at 3 s has 24 car reveals and 19 shot endings; the G5 run (seed 2) has 12 shot endings at
3 s. Cost is ~1 s wall per simulated second.

**Targets:** `npm test` ≤ 90 s on this box (≈ −50 %); `test:slow` ≤ 30 s; nothing that gates today
stops gating except what §5 names as calibration.

## 3. Test groups after this change

| Group | Command | Gates? | What is in it |
|---|---|---|---|
| **fast** | `npm test` (and per-package `npm run test:shared` / `test:server` / `test:client`) | yes | every correctness test that runs in well under a second per file, now **including the pure bot unit tests** |
| **slow** | `npm run test:slow` | yes | real headless matches and long simulations: `balance/match.test.ts`, `balance/runner.test.ts`, `tiers.test.ts`'s determinism block, the full netsim link sweep, the full input-scheduler grid |
| **bench** | `npm run test:bench` | yes, on a ratio/budget | CPU timing checks: `brain.bench.test.ts`, client `fx/perf.test.ts` |
| **bot report** | `npm run bot:report` | **no — report only** | the calibration checks moved out of the suites (§5), with `OK` / `FINDING` / `KNOWN-BY-DESIGN` verdicts, written beside the playtest reports |
| scripts | `npm run test:scripts` | yes | unchanged (2 s) |
| playtest / balance / ttk | unchanged | no | unchanged |

- **TS1** `npm test` runs the fast group of every package, then `test:scripts`. It no longer runs
  netsim's long sweep, the full scheduler grid, or any timing test.
- **TS2** `test:slow` and `test:bench` each have their own vitest config per package that needs one
  (`vitest.slow.config.ts` exists for server; shared gains `vitest.slow.config.ts`; server and client
  gain `vitest.bench.config.ts`). The **lists** of what is slow or bench live in one file per package
  (`vitest.groups.ts`, replacing `packages/server/vitest.slow-tests.ts`) exporting `SLOW_TESTS` and
  `BENCH_TESTS`; the default config excludes both, the group configs include only theirs. One list,
  read by both sides, so a file can never be in neither or both.
- **TS3** Root scripts: `test:slow` runs shared's and server's slow configs; `test:bench` runs server's
  and client's bench configs; `test:shared|server|client` build shared, then typecheck and test that
  one workspace. Each builds shared first, because server and client consume shared's `dist`.

## 4. A — hotspots

- **TS4 netsim, fast group.** `netsim.test.ts` keeps, at **3 s** each: one `net150` run asserting
  finite metrics, `stepsPerTickMax === 1`, a non-null `repeatedInputRate`, `shotEndings > 0` and
  `phantomShotEndings === 0` (net150 is the harshest link, so this one run carries NR17 and G5); one
  determinism pair on `net80` (2 s each); the FOV leak run on `net80` (3 s, keeping
  `carReveals > 0`). Every shortened run asserts its own non-vacuity (an event count > 0) so a
  shorter window can never pass by measuring nothing. Target ≤ 12 s.
- **TS5 netsim, slow group.** A new `netsim.sweep.test.ts` holds what TS4 dropped: all four links at
  20 s, G5 on seed 2 at 10 s, and the FOV determinism pair — unchanged assertions. Listed in
  `SLOW_TESTS`.
- **TS6 flame containment.** The 300-frame test collects violations into an array and asserts once
  (`expect(violations).toEqual([])`, each violation naming frame, layer and vertex). Same frames,
  same layers, same bound, same tolerance. Target < 0.5 s. Apply the same shape to the sibling
  "holds containment as the beam grows" loop.
- **TS7 input-scheduler grid.** The fast group keeps the corners — fps {60, 144} × jitter {0, 30} ×
  drift {0, ±0.01} × spike {0, 0.2}, one seed — and a new `input-scheduler.envelope.test.ts` in
  shared's slow group runs the full 90-cell × 2-seed grid unchanged.
- **TS8 runner duplicates.** Delete `runner.test.ts` "replays identically for a seed": its claim is a
  strict subset of "produces an identical stats digest for the same seed twice", which the
  implementer verifies first by reading `digest`'s input (it must cover per-match ticks). "runs
  matches x pairs in duel" switches to `matchSeconds: 1`, since it only counts matches.
- **TS9 match duplicates.** Delete `match.test.ts` "is deterministic for a seed (B43)" (strict
  subset of the byte-identical digest test). Tests that only need *a* finished match share one
  `beforeAll` result instead of each calling `runMatch(SETUP)`.
- **TS10 timing tests leave correctness suites.** `brain.bench.test.ts` and `fx/perf.test.ts` move to
  the bench group unchanged.

## 5. Calibration becomes report-only (the user's decision)

**Rule:** an assertion is *calibration* when it pins what a particular seed, tier or tuned bot
happens to do (who wins, a hit-rate ordering, an occupancy share held to "measured worst plus a
margin"), and an *invariant* when it would be a bug on any seed (determinism, a ranking rule, a clock
firing, a status gate). Calibration moves to the bot report; invariants stay gating.

- **TS11 The bot report.** `packages/server/playtest/bot/` holds report-only scenarios run by
  `npm run bot:report` (one process, `tsx playtest/bot/run.ts`), writing `bot.md` through the
  existing `Reporter` into a dated run folder under `packages/server/playtest/reports/`, suffixed
  `-bot`. It follows the probe rules: report, never assert; one scenario's surprise never stops the
  next; each verdict compares the measurement with the bound the test used to assert, so a former
  failure reads `FINDING` naming the number and the bound. It is not part of `run-all.ts`.
- **TS12** Moves to the report, with today's bounds as its `FINDING` thresholds:
  - `occupancy.test.ts`, all three cases (the file is deleted from the suite).
  - `tiers.test.ts`: "tier characterisation (BB60)" (all seven cases) and "the reported symptoms
    stay fixed (BB3)" (all three, P50 included).
  - `match.test.ts`: the seed **spread** behind "ranks placement by kills then fewest deaths",
    reported as how many of the seeds were decisive.
- **TS13 Stays gating** (moved to the fast group unless noted):
  - `controller.test.ts` — every case is one constructed scene with one expected decision, not a
    calibration; it joins the fast group. *(This departs from the earlier "controller is
    calibration" framing: the v7 rewrite replaced its seed-pinned duels with single scenes.)*
  - `tiers.test.ts` "whole-brain determinism (BB63)" — slow group.
  - The ranking **rule** becomes a pure unit test of `placementsFor`/`competitionRank` over
    synthetic seats (more kills ahead; equal kills, fewer deaths ahead; equal on both share a
    place; never seat order), exported for test only — fast group, no match played.
  - "shortening matchSeconds still lets the deathmatch clock fire" becomes seed-free. The defect it
    was written for: `matchEndsTick` stayed pinned at the game's 180 s clock, so a shortened run hit
    `maxTicks` without the mode ever concluding. `MatchOutcome.hitClock` is `!concluded`
    (`balance/match.ts`), so the seed-free assertion is that a 30 s deathmatch **concludes**
    (`hitClock === false`) within one tick of the shortened clock, on any seed — draw or decisive.
    The implementer reverts the fix locally once to see this assertion fail (TS37).
  - "ties on kills/deaths place equally… regardless of seat order" stays as is.
- **TS14** Every other bot test file under `src/bot/**` joins the fast group: `SLOW_TESTS` names
  files, not `src/bot/**`.

## 6. A — routing

- **TS15 Package scope.** `scopeOf` returns `{ scope: "packages", packages: [...] }` for a diff
  whose code paths sit only in `packages/server/**` and/or `packages/client/**` (outside mode
  folders), and `"full"` as soon as any path is in `packages/shared/**` (outside mode folders),
  under `scripts/`, is a root build or test file (`package.json`, `package-lock.json`,
  `tsconfig*.json`, any `vitest.*.ts`), or is unrecognised. `packages/server/playtest/**` and
  `packages/server/balance/**` count as server; `packages/client/public/**` counts as client. Mode
  scope is unchanged, and a mixed mode-plus-package diff is `"packages"` with the mode commands
  appended.
- **TS16 Package commands.** A package scope emits `npm run test:<pkg>` per package, then
  `npm run test:scripts` (2 s; `scripts/` reads `packages/client/public/` and build paths, so always
  running it is cheaper than proving a diff cannot reach it), then the playtest commands today's full
  scope emits — the probe routing is not narrowed in this change.
- **TS17 Slow trigger gap.** `owesSlowTests` also matches `packages/(shared|server)/src/config/`,
  `packages/shared/src/arena/`, `packages/(shared|server)/src/net/`, `packages/server/src/netsim/`,
  and every `vitest.*.ts`. Today a `BOT_PROFILES` or `DRIVE_CONFIG` edit owes no slow test.
- **TS18 Bench and report triggers.** `owesBench` — `src/bot/**`, `bot-profiles.ts`, `client/src/fx/**`,
  the bench configs. `owesBotReport` — `src/bot/**`, `bot-profiles.ts`, `packages/server/balance/**`,
  `playtest/bot/**`. `commandsFor` appends `test:slow`, then `test:bench`, then `bot:report`, each
  when owed. The report is listed with a `(report only)` note and never sets a failing exit code.
- **TS19** `scripts/test-scope.test.mjs` gains a case per new rule, including the negative ones (a
  client-only diff owes no shared suite; a `bot-profiles.ts` diff owes `test:slow`).

## 7. C — redundancy and staleness

- **TS20 Snapshot-duplicate pins.** Delete assertions that compare a **raw** `config/` table value to a
  literal when the same value is in `packages/shared/src/modes/__snapshots__/*.tables.json`. Each
  deletion is checked against the snapshot JSON. **Keep** assertions on derived values (ticks, pulse
  counts, `derived()`), relational invariants (a value above a clamp floor, a ceiling covering a
  duration) and anything about a mode's *resolved* value that differs from the base. Candidates:
  `config/config.test.ts`, `status-config.test.ts`, `weapon-config.test.ts`, `ram-config.test.ts`,
  `spike-config.test.ts`, `weapon-slots.test.ts`.
- **TS21 Source guards share one walker.** `modes/no-raw-config-in-sim.test.ts`,
  `modes/no-mode-branching.test.ts` and `config/weapon-slots-readers.test.ts` import one helper
  (`packages/shared/src/test-support/source-walk.ts`: walk, posix paths, comment stripping, a
  per-process cache of file contents). Their rules, allow-lists and tripwire tests are unchanged.
  The `sim/` walk in `no-raw-config-in-sim.test.ts` that is strictly contained in its whole-`src`
  walk is deleted.
- **TS22** Delete the unread fixture `packages/shared/src/modes/__fixtures__/shipped-tables.json`
  after a repo-wide grep (code, scripts, docs except `docs/superpowers/plans/`) confirms no reader.
- **TS23 Dash sweep.** `sim/step.test.ts`'s dash-penetration sweep iterates only the chassis that
  can actually dash, derived from the roster at test time (cars whose kit carries a dash maneuver)
  rather than every `ramDefence` pairing. The sub-tick phase sweep stays whole.
- **TS24 Stale titles and tombstones.** Retitle tests that call `tremor` "the unassigned row" (Bastion
  carries it). Delete comment-only tombstone blocks for deleted suites
  (`sim/weapons/fire.test.ts`, `sim/status/combat.test.ts`).
- **TS25 Base duplicates of per-mode invariants.** Delete the exclusivity and truncation checks in
  `config/weapon-slots.test.ts` that `modes/invariants.test.ts` already runs over every mode.
- **TS26 Probe 9 (ram chain).** `playtest/common/collision.ts` scenario 9 measures `reeling` instead of
  printing "Not measured": the victim's control-loss share (ticks with `steeringLocked`) and its
  longest uninterrupted lock. `OK` when no lock outlasts one `reeling` duration plus one tick (a chain
  never refreshes the lock without a gap, which `reapply: "ignore"` promises); `FINDING` otherwise.
  The user asked for probes to be updated; this is that maintenance, on the scenario's own question.
- **TS27 Probe R5 ram counter.** Count a ram as the attacker's `ramLock` onset (an edge), replacing
  the counter its report says it no longer trusts, and drop the "no longer trusts" caveat.
- **TS28** `playtest/common/geometry.ts`'s header string drops "aim-assist LOS" (retired 2026-09-17).

## 8. What is deliberately NOT done

- **TS29** No `isolate: false`, no vitest projects config, no global setup file (that is B).
- **TS30** Not narrowing playtest routing for package scope, not running common probes once instead of
  once per mode: Brawl's `turret.visible: false` makes the turret turn instant, which the weapon
  probes can see, so the three runs are not identical inputs.
- **TS31** Not rewriting the client's source-regex tests in `scenes/weapon-hud.test.ts`; they guard
  real wiring, cost milliseconds, and a behavioural rewrite needs `ArenaScene` changes.
- **TS32** No new probe scenario beyond TS11–TS12's moved checks and TS26's re-derivation.

## 9. Docs owed

- **TS33** `docs/testing.md`: the groups table (§3), the package scope, the new triggers, the
  calibration rule (§5) and where calibration lives now.
- **TS34** Root `CLAUDE.md` "Which tests to run" and "Commands": the new groups and commands.
- **TS35** `packages/server/playtest/README.md`: the bot report, its scenarios and its bounds.
- **TS36** `docs/bot-behavior.md` and the `bot-tuner` skill, where they name `tiers.test.ts`,
  `occupancy.test.ts` or P50 as a test that fails: they now name the bot report.

## 10. Verification

- **TS37** Every fast-group change passes on its own: `npm test` green, and the moved or slimmed tests
  fail on purpose when the property is broken (check once by hand with a local mutation for TS4,
  TS6 and TS13's ranking unit test; revert before commit).
- **TS38** `npm run test:slow`, `npm run test:bench` and `npm run bot:report` all run green / produce a
  report on the final tree; the report's verdicts match what the deleted assertions said on the
  same tree (all `OK` today, since they all passed).
- **TS39** Before/after wall times for `npm test` and `npm run test:slow` are measured on one box,
  back to back, and recorded in the final summary.
- **TS40** Playtest probes changed by TS26–TS28 compile and run (`npm run playtest -- --scope=common`)
  and the summary names the probe and the new number, per the root `CLAUDE.md` playtest rule.
