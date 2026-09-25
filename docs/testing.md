# Testing

How this repo's tests and playtest probes are laid out, the mechanical rule for scoping a diff to
what it owes, and the commands that implement it. See the root `CLAUDE.md`'s "Which tests to run"
section for the short version, and
[`docs/superpowers/specs/2026-09-25-game-mode-layer-design.md`](superpowers/specs/2026-09-25-game-mode-layer-design.md)
(GM27–GM36) for the design this page documents.

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
- Any other changed path under `packages/` or `scripts/` — including a `modes/` ROOT file — →
  **full scope**: `npm test` plus `playtest --scope=all` for every active mode.
- Docs-only changes → nothing to run, except `docs/turn-tuning.md`, which
  `scripts/turn-tuning-doc.test.mjs` reads values out of — a change there is full scope, not none.

| Example diff | Scope | Commands |
|---|---|---|
| `packages/shared/src/modes/conquer/config.ts` | mode: `conquer` | `test:mode -- conquer`; `playtest --mode=conquer --scope=mode`; `playtest --mode=conquer --scope=common` (config changed); `npm run test:scripts` (config changed) |
| `packages/client/src/modes/brawl/hud.ts` | mode: `brawl` | `test:mode -- brawl`; `playtest --mode=brawl --scope=mode` |
| `packages/server/src/modes/last-standing/controller.ts` | mode: `brawl` **and** `team-brawl` (the family) | `test:mode -- brawl`; `test:mode -- team-brawl`; a `--scope=mode` playtest run for each |
| `packages/shared/src/modes/registry.ts` | full (a `modes/` root file) | `npm test`; `playtest --scope=all` for every active mode |
| `packages/shared/src/sim/drive.ts` | full (common sim code) | `npm test`; `playtest --scope=all` |
| `docs/turn-tuning.md` | full (a tested doc) | `npm test` |
| `docs/config-reference.md` | none | — |

## 3. Commands

```bash
npm test                    # everything: shared build, typecheck, every package's full suite, scripts
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

## 7. The pre-existing G12 failures

`packages/server/src/bot/brain/controller.test.ts` has two failing-or-flaky cases today — the "hunts a
quadrant waypoint…" and "hunts toward a last-known pose…" cases (both tagged `G12`; one has been
observed to pass on an individual run) — a bot-tuner
question, not something this refactor introduced or is expected to fix. Because root `npm test` runs
`npm run test --workspaces --if-present` and **stops at the first failing workspace**, the server's
two failures currently prevent the client and `scripts` suites from running under root `npm test`.
Until they are fixed, run those two separately to get a real answer from them:

```bash
cd packages/client && npx vitest run
npm run test:scripts        # node --test "scripts/*.test.mjs" — covers manual-page, turn-tuning-doc, manual-facts, test-scope, etc.
```
