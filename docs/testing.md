# Testing

How this repo's tests and playtest probes are laid out, the mechanical rule for scoping a diff to
what it owes, and the commands that implement it. See the root `CLAUDE.md`'s "Which tests to run"
section for the short version, and
[`docs/superpowers/specs/2026-09-25-game-mode-layer-design.md`](superpowers/specs/2026-09-25-game-mode-layer-design.md)
(GM27–GM36) and
[`docs/superpowers/specs/2026-10-10-test-suite-optimization-design.md`](superpowers/specs/2026-10-10-test-suite-optimization-design.md)
(TS1–TS40) for the designs this page documents.

## 1. Layout: common, mode folders, family folders, contract tests

**Common tests** sit beside the code they test, everywhere they always have — `sim/drive.test.ts`,
`ArenaRoom.test.ts`, and so on. This is most of the suite, and nothing about this refactor moved it.

**Mode-specific tests live inside the mode's own folder**, mirrored in each package:

| Package | Per-mode folder | Notes |
|---|---|---|
| `packages/shared/src/modes/<slug>/` | `brawl/`, `team-brawl/`, `deathmatch/`, `conquer/` | Config overrides, `rules.ts`, and that mode's own tests |
| `packages/server/src/modes/<family>/` | `last-standing/`, `deathmatch/`, `conquer/` | The server has no per-slug split — Brawl and Team brawl share one controller, so their tests live under the family |
| `packages/client/src/modes/<slug>/` | `brawl/`, `team-brawl/`, `deathmatch/`, `conquer/` | Each mode's `hud.ts` and tests; `last-standing/` holds the shared `lastStandingHud` factory |

**Family folders** hold a rule/controller/HUD implementation several slugs share. `last-standing`
covers Brawl and Team brawl today — a change there is mode scope for *every* slug in that family, not
just one.

**Contract tests** — `modes/contract.test.ts`, one per package — are common tests that run
`describe.each` over every `GameMode` and check the interface-level shape every mode must satisfy,
regardless of which slug it is: shared's asserts `ModeRules` is internally consistent
(`hasMatchClock === respawns`, an equality, not a one-way implication); server's checks that a fresh
match with every roster car alive and the clock not expired returns `undefined` from `afterTick`,
and that `onMatchStart` zeroes `matchEndsTick` iff `!rulesOf(mode).hasMatchClock`; client's checks its
`ModeHud` returns a lobby card with non-empty copy. **They do not check that a controller ends a
match on the condition it documents** — that a fresh, ongoing match reports no outcome is as far as
the shared contract goes. End conditions are covered by each family's own `controller.test.ts`
(`modes/last-standing/controller.test.ts`, `modes/deathmatch/controller.test.ts`,
`modes/conquer/controller.test.ts`), and a new mode must add its own. They sit at the `modes/` root,
not in any one mode's folder — a mode-scoped run still owes them (`test:mode` includes them
automatically).

**The `modes/` root itself is common code.** `merge.ts`, `registry.ts`, `rules-registry.ts`,
`active.ts`, `base.ts`, `snapshots.test.ts`, `no-mode-branching.test.ts`, `contract.test.ts` and
friends sit at the same directory depth as a mode's own folder but are not one — they can change
every mode's behaviour at once, so a diff that touches them is never mode-scoped.

## 2. The scoping rule

`scripts/test-scope.mjs` implements this exactly; treat it as the source of truth if this
description and its behaviour ever disagree.

- Every changed path is under one mode's own folder (`packages/{shared,client}/src/modes/<slug>/`,
  that mode's snapshot file, or — via its rule family — `packages/{server,shared,client}/src/modes/<family>/`
  and `packages/server/playtest/modes/<family>/`) → **mode scope**. You owe `test:mode -- <slug>`
  (shared's run always ALSO includes `src/modes/snapshots.test.ts` and `src/modes/invariants.test.ts`
  — the two guards a `config.ts` edit can break — regardless of which slug's folder moved) plus
  `playtest --mode=<slug> --scope=mode` for every affected slug (a family diff owes this for every
  slug in that family), and `--scope=common` too if the mode's `config.ts` changed — overrides moving
  is exactly what the common probes measure differently. A `config.ts` or snapshot change also owes
  `npm run test:scripts` (the manual-page stamp and the turn-tuning doc), which `commandsFor` emits
  whenever `commonProbes` is true.
- Every non-mode path sits in `packages/server/**` and/or `packages/client/**` (outside mode
  folders; `packages/server/playtest/**` and `packages/server/balance/**` count as server,
  `packages/client/public/**` as client) → **package scope**. You owe `npm run test:<pkg>` for each
  package touched, then `npm run test:scripts` (`scripts/` reads `packages/client/public/` and build
  paths, and it costs 2 s), then the same `playtest --scope=all` runs the full scope emits — probe
  routing is not narrowed by package. A diff that mixes mode folders with package paths is package
  scope with the mode commands appended.
- Any other changed path — anything in `packages/shared/**` outside a mode folder (including a
  `modes/` ROOT file), anything under `scripts/`, a build or test file (`package.json`,
  `package-lock.json`, `tsconfig*.json`, any `vitest.*.ts`), or an unrecognised shape → **full
  scope**: `npm test` plus `playtest --scope=all` for every active mode.
- Docs-only changes → nothing to run, except `docs/turn-tuning.md`, which
  `scripts/turn-tuning-doc.test.mjs` reads values out of — a change there is full scope, not none.

**Independently of the scope**, four extras are owed by path (§3 says what each group holds).
`commandsFor` appends them after the scope's commands, in this order:

| Extra | Owed when a changed path is under (`scripts/test-scope.mjs`) |
|---|---|
| `npm run test:slow` (`owesSlowTests`) | a `sim/`, `rooms/`, `modes/`, `bot/` or `config/` folder anywhere in `packages/{shared,server}/src/`; `packages/shared/src/arena/`; `packages/server/balance/`; any `packages/*/vitest.*.ts` |
| `npm run test:net` (`owesNet`) | `packages/{shared,server}/src/net/`; `packages/server/src/netsim/`; `packages/shared/src/config/net-config.ts`; `packages/server/src/rooms/tick-pipeline.ts` or `snapshot-cadence.ts` (the two room modules the sweep imports, not the rest of `rooms/`); a `vitest.net.config.ts`; shared's or server's `vitest.groups.ts`. Not `sim/`: the 3 s netsim smoke in `npm test` covers the sim |
| `npm run test:bench` (`owesBench`) | any `packages/*/src/bot/`; `packages/server/src/config/bot-profiles.ts`; `packages/client/src/fx/`; a `vitest.bench.config.ts`; server's or client's `vitest.groups.ts` |
| `npm run bot:report` (`owesBotReport`) — **report only** | any `packages/*/src/bot/`; `bot-profiles.ts`; `packages/server/balance/`; `packages/server/playtest/bot/` |

`test-scope.mjs` prints the report with `(report only)` beside it, and `--run` never fails on it.
Client code owes no slow or net group: none of it runs in those matches or sweeps.

| Example diff | Scope | Commands |
|---|---|---|
| `packages/shared/src/modes/conquer/config.ts` | mode: `conquer` | `test:mode -- conquer`; `playtest --mode=conquer --scope=mode`; `playtest --mode=conquer --scope=common` (config changed); `npm run test:scripts` (config changed); `npm run test:slow` |
| `packages/client/src/modes/brawl/hud.ts` | mode: `brawl` | `test:mode -- brawl`; `playtest --mode=brawl --scope=mode` |
| `packages/server/src/modes/last-standing/controller.ts` | mode: `brawl` **and** `team-brawl` (the family) | `test:mode -- brawl`; `test:mode -- team-brawl`; a `--scope=mode` playtest run for each; `npm run test:slow` |
| `packages/client/src/scenes/ArenaScene.ts` | packages: client | `npm run test:client`; `npm run test:scripts`; `playtest --scope=all` for every active mode |
| `packages/client/src/fx/decals.ts` | packages: client | as above, then `npm run test:bench` |
| `packages/server/src/config/bot-profiles.ts` | packages: server | `npm run test:server`; `npm run test:scripts`; `playtest --scope=all`; `npm run test:slow`; `npm run test:bench`; `npm run bot:report` (report only) |
| `packages/server/src/netsim/link.ts` | packages: server | `npm run test:server`; `npm run test:scripts`; `playtest --scope=all`; `npm run test:net` |
| `packages/server/src/rooms/ArenaRoom.ts` + `packages/client/src/modes/conquer/hud.ts` | packages: server (+ mode `conquer`) | `npm run test:server`; `npm run test:scripts`; `playtest --scope=all`; `test:mode -- conquer`; `playtest --mode=conquer --scope=mode`; `npm run test:slow` |
| `packages/shared/src/modes/registry.ts` | full (a `modes/` root file) | `npm test`; `playtest --scope=all` for every active mode; `npm run test:slow` |
| `packages/shared/src/sim/drive.ts` | full (common shared code) | `npm test`; `playtest --scope=all`; `npm run test:slow` |
| `packages/shared/src/net/input-scheduler.ts` | full | `npm test`; `playtest --scope=all`; `npm run test:net` |
| `docs/turn-tuning.md` | full (a tested doc) | `npm test` |
| `docs/config-reference.md` | none | — |

## 3. Test groups and commands

Each package's `vitest.groups.ts` holds its group lists (`SLOW_TESTS`, `NET_TESTS`,
`BENCH_TESTS`). The default `vitest.config.ts` excludes every list; `vitest.slow.config.ts`,
`vitest.net.config.ts` and `vitest.bench.config.ts` each include only their own. One list read by
both sides, so a file can never be in neither group or in two. `src/vitest-groups.test.ts` (one per
package, in the fast group) fails if an entry names no real file or a file sits in two lists.

| Group | Command | Gates? | What is in it |
|---|---|---|---|
| **fast** | `npm test`, or one package: `npm run test:shared` / `test:server` / `test:client` | yes | every other test, the pure bot unit tests and `bot/brain/controller.test.ts` included; netsim's 3 s smoke (`netsim.test.ts`) and the scheduler's corner cases (`input-scheduler.test.ts`) |
| **slow** | `npm run test:slow` | yes | server only: `balance/match.test.ts`, `balance/runner.test.ts` (real headless matches) and `src/bot/brain/tiers.test.ts` (whole-brain determinism, BB63). Shared's list is empty |
| **net** | `npm run test:net` (~2 min) | yes | shared's full input-scheduler grid (`src/net/input-scheduler.envelope.test.ts`) and server's full netsim link sweep (`src/netsim/netsim.sweep.test.ts`) |
| **bench** | `npm run test:bench` | yes, on a ratio or budget | wall-clock timing checks: server `src/bot/brain/brain.bench.test.ts`, client `src/fx/perf.test.ts` |
| **bot report** | `npm run bot:report` | **no — report only** | the bot calibration checks (§7), written to `packages/server/playtest/reports/<yyyy-MM-dd-NN>-bot/bot.md` |
| scripts | `npm run test:scripts` | yes | `scripts/*.test.mjs` (manual stamp, turn-tuning doc, art, test scope); also the last step of `npm test` |
| playtest / balance / ttk | `npm run playtest` / `balance` / `ttk` | no | measurement harnesses, unchanged |

```bash
npm test                    # shared build, typecheck, every package's fast group, test:scripts
npm run test:shared         # shared build, then typecheck + fast group of that one package
npm run test:server         #   (likewise; each builds shared first, since server and client read its dist)
npm run test:client
npm run test:slow           # balance/match, balance/runner, bot/brain/tiers (BB63)
npm run test:net            # full scheduler grid + full netsim link sweep (~2 min)
npm run test:bench          # timing checks (brain bench, client fx perf)
npm run bot:report          # bot calibration report; always exits 0
npm run test:common         # every package's common tests + contract tests (excludes **/modes/*/**)
npm run test:mode -- <slug> # that mode's folders (+ its family's) in every package, + contract tests
npm run test:affected       # scripts/test-scope.mjs --run: prints the scope for the current diff, then runs it
node scripts/test-scope.mjs # print the scope and commands without running anything
npm run playtest -- --mode=<id|name> --scope=<common|mode|all>   # default scope is "all"
```

`test:affected` diffs `origin/development/main...HEAD` plus your working tree (staged, unstaged and
untracked) — run it before committing to see what a change actually owes.

## 4. What the contract tests guarantee

They are the reason a new mode cannot ship half-wired: `MODE_RULES`, `MODE_CONTROLLERS` and
`MODE_HUDS` are each `satisfies Record<GameMode, …>`, so adding a `GameMode` value fails the build
until all three have a row, and the contract test then runs the same interface-level checks over
that row automatically. They do **not** replace a mode's own tests, and in particular do **not**
check that a controller ends a match on the condition it documents — only that a fresh, ongoing
match reports no outcome, plus the match-clock stamp. "Does Conquer's controller end the match
correctly" is answered by Conquer's own `controller.test.ts`, not by the contract test; a new mode
must write that case itself. A mode's own folder is where you test what makes it different.

## 5. Adding a mode's tests and probes

Write mode-specific tests inside the mode's own folder (or its family's, for a controller/HUD it
shares) — see the [`game-mode`](../.claude/skills/game-mode/SKILL.md) skill for the full checklist.
For a probe, add `packages/server/playtest/modes/<family>/`, following the existing ones
(`last-standing/elimination.ts`, `deathmatch/respawn.ts`, `conquer/zone.ts`) for shape: report, never
assert; verdicts `OK` / `FINDING` / `KNOWN-BY-DESIGN`; sweep the sub-tick phase where contact is
involved. **Never add a new probe scenario on your own initiative** — the user asks for new
coverage; keeping an existing probe honest after a change is maintenance, not invention. See
[`packages/server/playtest/README.md`](../packages/server/playtest/README.md).

## 6. Snapshots

`packages/shared/src/modes/__snapshots__/<slug>.tables.json` is each mode's resolved `ModeTables`
(not `derived()`), written by `modes/snapshots.test.ts`. A snapshot moving is information, not
automatically a failure to fix by regenerating it:

- **Your mode's file moved and nothing else's did** — expected, if you edited that mode's
  `config.ts`. Read the diff; if it matches what you intended to change, `vitest -u` scoped to that
  one snapshot file and commit it.
- **Several (or every) mode's files moved** — you edited `modes/base.ts` or a `config/` global.
  Expected for a roster-wide balance change; a red flag if you only meant to touch one mode — that
  means you edited the base when you meant to write an override.
- **Never run a blanket `vitest -u` across the whole repo to make a snapshot mismatch go away.**
  Regenerate only the file(s) the diff should have moved, and read what changed before committing.

## 7. Calibration is report-only

An assertion is **calibration** when it pins what a particular seed, tier or tuned bot happens to do
— who wins, a hit-rate ordering, an occupancy share held to "measured worst plus a margin". It is an
**invariant** when it would be a bug on any seed — determinism, a ranking rule, a clock firing, a
status gate. Invariants are tests and gate; calibration lives in `npm run bot:report`
(`packages/server/playtest/bot/`), which follows the probe rules: report, never assert, one
scenario's surprise never stops the next, exit code always 0. Each verdict compares the measurement
with the bound the test used to assert, so a former failure reads `FINDING` naming the number and the
bound. Do not write a new seed-pinned outcome as a test; write it as a bot-report scenario (when the
user asks for one).

Where the checks that left the suites live now:

| Check | Now |
|---|---|
| `bot/brain/occupancy.test.ts` (hard duel; six-bot easy FFA on both tile arenas) | bot report, `playtest/bot/occupancy.ts` |
| `tiers.test.ts` "tier characterisation (BB60)" (8 cases) and "the reported symptoms stay fixed (BB3)" (3 cases, P50 included) | bot report, `playtest/bot/tiers.ts`, one row per former `it` |
| `balance/match.test.ts`'s 8-seed deathmatch placement spread | bot report, `playtest/bot/placement.ts` (`OK` needs the rule to hold and at least one decisive seed) |
| the deathmatch ranking rule | fast group: a seed-free unit test of `rankDeathmatch` in `balance/match.test.ts` |
| "shortening matchSeconds still lets the deathmatch clock fire" | slow group, seed-free: a 30 s deathmatch concludes within one tick of its clock |
| `tiers.test.ts` whole-brain determinism (BB63) | slow group |
| `bot/brain/controller.test.ts` and every other `src/bot/**` unit test | fast group |
| the full netsim link sweep and the full input-scheduler grid | net group; a 3 s netsim smoke and the scheduler's corners stay fast |
| `brain.bench.test.ts`, client `fx/perf.test.ts` | bench group |
