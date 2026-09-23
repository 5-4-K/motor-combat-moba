# Per-mode configuration — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan phase-by-phase, task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every configurable value per-game-mode, so modes can feel genuinely different, with
two rooms on different modes correct in one process.

**Architecture:** Each mode is a folder of full literal table copies assembled into one frozen
`ModeConfig` bundle (derived artifacts baked in). A module-level pointer holds the current bundle;
rooms install theirs with a synchronous `withMode(config, fn)` around every entry point; the sim
reads through accessors whose call sites do not change.

**Tech Stack:** TypeScript, npm workspaces, Colyseus, Phaser 4, `node:test`.

**Spec:** [`docs/superpowers/specs/2026-09-22-per-mode-config-design.md`](../../specs/2026-09-22-per-mode-config-design.md) (MC1–MC42)

## Global Constraints

- `TICK_RATE_HZ` stays 30 and stays global (MC30). `NET_CONFIG` and `DEFAULT_PATCH_RATE_HZ` stay global (MC31).
- Never renumber a `GameMode`, `RoomPhase`, `PlayerStatus` or `WeaponKind` value (MC32, invariant 7).
- `ABILITY_SLOT_CEILING` stays 4 and global (MC33). `MAX_PLAYERS` stays 6 and global (MC34).
- `DRIVE_CONFIG.carWidth` (60) and `carHeight` (40) stay global (MC35).
- `COLOR_TABLE`, `PRACTICE_CONFIG`, `CHAT_CONFIG`, `LOGICAL_CANVAS` stay global (MC36, MC37).
- Per-mode values must fit their wire type: `hp` <= 65535; `kills`, `deaths`, `level`, `team`,
  `colorId`, `maneuver` <= 255; `lastFiredSlot` within int8 (MC38).
- Mode tables are total `Record`s over the global id unions, never `Partial` (MC6).
- Types and ids are single-source in `config/`; only values are per-mode (MC4, MC5).
- Bot config stays in `packages/server` (MC29).
- Not one balance number moves in this work (spec N4).
- Build from the repo root with `npm run build`, never `npm run build --workspaces`.

## Review Focus

Five failure modes the spec implies that no task's happy path exercises. Each line's test is added
to the task named after it.

1. **A `state.mode` value with no `MODE_TABLE` row** — an old client, or a mode deleted between
   builds. `modeConfigOf` must refuse it at the room boundary and fall back to `DEFAULT_GAME_MODE`
   with a log, never throw inside a live tick. *(Phase 3, Task 4.)*
2. **A per-mode value that silently truncates on the wire** — `hp` above 65535 or `kills` above 255
   wraps rather than errors, producing a car that dies at the wrong HP. *(Phase 2, Task 5.)*
3. **A mode whose `arenas` set is empty or names an unregistered arena** — the room would pick
   `undefined` as its arena and `getArena` would throw mid-match. *(Phase 4, Task 2.)*
4. **A mode whose `maxAbilitySlots` is outside `[1, ABILITY_SLOT_CEILING]`, or whose car kit is
   longer than its own `N`** — the existing truncate-silently rule must hold per mode, and the
   out-of-range case must fail the suite naming the mode. *(Phase 2, Task 4.)*
5. **The client holding a stale bundle after the host changes mode in the lobby** — car select would
   offer the previous mode's roster and the prediction half of the lockstep would diverge from the
   server's. *(Phase 3, Task 5.)*

---

> **Read this first in any session that touches this work.** It names the phase in flight, the last
> completed task and the next one. **It is updated in the same commit as the work it describes**, so
> a session can stop anywhere and the next one resumes exactly.

**Spec:** [`docs/superpowers/specs/2026-09-22-per-mode-config-design.md`](../../specs/2026-09-22-per-mode-config-design.md) (MC1–MC42)
**Name ledger:** [`interfaces.md`](interfaces.md) — outranks any one phase plan, outranked by the spec.
**Branch:** `feature/game-wise-config`

## Status

| Phase | Plan | State |
|---|---|---|
| 1. Accessor layer, one bundle | [`01-accessor-layer.md`](01-accessor-layer.md) | **DONE** (`fbe386a..f0f0112`) |
| 2. Two mode folders | [`02-mode-folders.md`](02-mode-folders.md) | **DONE** (`1da2c85..74b8320`) |
| 3. Scopes installed | [`03-room-scopes.md`](03-room-scopes.md) | **DONE** (`eb8b9cc..b78ad38`) |
| 4. Lobby and arena sets | [`04-lobby-and-arenas.md`](04-lobby-and-arenas.md) | **DONE** (`b5c868a..9c169a9`) |
| 5. `setTuning` retired | [`05-retire-set-tuning.md`](05-retire-set-tuning.md) | **DONE** (`b633120..4814dbf`) |
| 6. Tooling | [`06-tooling.md`](06-tooling.md) | not started |

**Next:** Phase 6, Task 1.

### Phase 5, as landed (commits `b633120..4814dbf`)

**Nothing in `packages/server/src/` installs a bundle process-wide any more.** `setTuning` —
which assembled a bundle and `installMode`d it for the whole process, so a playground holding
overrides re-balanced every other room in it — is deleted, along with `activeTuning`, `ROOTS`,
`DEFAULTS` and the private path-walking helpers. `config/tuning.ts` is now a types-only module;
`TuningValue`, `TuningOverrides` and the whole of `tuning-walker.ts` survive.

Its successor is `applyOverrides(base: ModeConfig, overrides): ModeConfig` in
[`modes/overlay.ts`](../../../../packages/shared/src/modes/overlay.ts): pure, validates the whole
batch against the BASE BUNDLE before writing a byte, returns a new deep-frozen bundle, installs
nothing. `PlaygroundRoom` holds its own tuned bundle and every entry point reads it through
`scoped(this.modeConfig, ...)`; the `onLeave`/`onDispose` resets are gone because there is nothing
process-wide left to reset. The client's `PlaygroundScene` installs process-wide and legitimately
so — a browser tab runs exactly one room for its life.

A final sweep classified every remaining `installMode` call: the client scene and client
mode-scope, six one-shot playtest harness scripts, and the test suites. **Zero in the server's
production tree.** MC39 and MC40 are met.

**The plan did not mention the client at all.** It named only `PlaygroundRoom`, but
`PlaygroundScene.ts` called `setTuning` three times to keep the prediction half of the lockstep on
the server's tuned numbers. Following the plan literally would have deleted the symbol and broken
the playground's client half with no server test noticing — the same shape as phase 3's Ruling 13.
A third task was added for it.

**Two things the plan claimed were already true.** The five `rebuild*` stubs and `restoreInPlace`
were deleted in phase 1's fix round; only comments mentioned them.

### Root `npm test` runs again, and the reason it did not is ours

Root `npm test` is `build shared && typecheck --workspaces && test --workspaces && test:scripts`.
It had been dying at step 2 — before ANY suite ran — since 2026-09-22, and the cause was this
branch's own phase 3. `PracticeRoom.onCreate` read `if (!isPracticeSetup(options)) { throw }`, a
TYPE PREDICATE that narrowed `options` from `unknown` for the rest of the method. Phase 3's fix for
a real unscoped-read crash wrapped it as
`if (!scoped(this.modeConfig, () => isPracticeSetup(options))) { throw }`, burying the predicate in
a callback where it narrows nothing — two `tsc` errors, invisible to vitest, which does not
typecheck. Every "suite green" claim in phases 3-5 came from per-package runs.

Commit `52b6e24` restores the narrowing by returning the value out of the callback rather than a
boolean. No cast, no `!`, scope wrapper intact. Root `npm test` now clears typecheck on all three
workspaces, runs every suite, and exits 1 on exactly the two pre-existing
`bot/brain/controller.test.ts` G12 failures (bisected to 2026-09-19, before this plan began).

### Phase 4, as landed (commits `b5c868a..9c169a9`)

A mode plays its **own** arena. `ArenaRoom` writes `state.arenaId = this.modeConfig.arenas[0]` in
`onCreate` and again when the host switches mode; `newPracticeState()` writes it from Deathmatch's
bundle. `ACTIVE_ARENA_ID` survives exactly where MC26 says it must — `ArenaState.arenaId`'s field
initializer, the playground's default, and `build-cars-and-weapons.mjs` — and nowhere else.
`BootScene` and `scripts/build-release.mjs` both cover `activeArenaIds()`, the union of every ACTIVE
mode's set, so a mode switch cannot land on art the client never loaded or the zip never shipped.
`golden.test.ts` is byte-identical: not one balance number moved.

**Task 1 (`activeArenaIds()`) was already done** — it landed with phase 2's registry work.

Two changes beyond the plan's five tasks, both made because the phase falsified something:

- **A docs task.** The change made six statements false across `asset-pipeline.md`,
  `config-reference.md`, `deployment.md` and `project-structure.md`. `config-reference.md`'s "Arena
  selection" section was a how-to that had become actively WRONG — it told the reader to set
  `ACTIVE_ARENA_ID`, which no longer changes what a match plays. Rewritten to point at the mode
  folder's `arenas` list.
- **`MSG_SET_MODE`'s guard asymmetry, fixed.** `state.mode` was written whenever nobody was
  `IN_MATCH`, while `modeConfig` and `arenaId` were written only in `RoomPhase.LOBBY` — so outside
  LOBBY the three diverged. Phase 3 introduced that for the bundle; phase 4 would have enlarged it
  to "dropped into the previous mode's arena". The decision is now the pure, tested
  `resolveSetMode(phase, hasPlayerInMatch, mode)` in `rooms/match-helpers.ts`, and the three values
  move together or not at all.

**Spec erratum, recorded under MC24.** The clause justified the union by claiming that otherwise a
mode switch reaches the client's "Arena mismatch" screen. That is false. The overlay fires on an
UNREGISTERED arena id (`ArenaScene.ts`); missing ART falls back to the procedurally generated
asphalt floor. The requirement stands — a correctly-playing arena drawn with the wrong floor is
still a bug — but it is a cosmetic failure, not a crash, and anyone weighing the union's cost
should weigh it against that and not against an error screen.

### Phase 2, as landed (commits `1da2c85..74b8320`)

`brawl/` and `deathmatch/` are real mode folders of thirteen literal table copies each;
`modes/registry.ts` assembles both into `MODE_TABLE`, keyed by `GameMode`, with `TEAM` pointed at
`BRAWL_TABLES` until a team-mode folder exists. `modeConfigOf` (throws) and `modeConfigOrDefault`
(wire-facing, falls back to `DEFAULT_GAME_MODE`) are the two ways to resolve a bundle from a
`GameMode`. `modes/legacy.ts` — the phase-1 scaffolding wrapping the live config tables — is gone;
the module-load bootstrap it carried (installing a bundle so `cfg()` has something to read before
phase 3's scopes exist) moved to `registry.ts`, which now installs `MODE_TABLE[DEFAULT_GAME_MODE]`
at load time. Both reach paths (`index.ts`'s side-effect import, `vitest.setup.ts`'s `setupFiles`
entry) point at `modes/registry.js`. `config/tuning.ts`'s `setTuning` and every test that used to
build ad-hoc bundles from `LEGACY_TABLES` (including the two `pinBasicAttackEnabled` helpers) now
build them from `BRAWL_TABLES` instead — the same values, since Brawl is `DEFAULT_GAME_MODE`.

`golden.test.ts` and `parity.test.ts` (the witness comparing both modes against a fixture captured
before this whole migration) both stayed green throughout — no balance number moved.

### Phase 1, as landed (commits `fbe386a..ea0a122`, all pushed)

| Task | Commits | Outcome |
|---|---|---|
| 1. Bundle types + builder | `6a465ee`, `4116def` | complete, re-review clean |
| 2. `withMode` scope + 16 accessors | `8db8cd9` | complete, approved first pass |
| 3. Accessor bodies onto the bundle | `2b02145`, `2341010`, `4140d69` | complete after 2 fix rounds |
| 4+5. 66 sim dereferences (batched) | `66823d1`, `c381978`, `ea0a122`, `f0f0112` | complete after 2 fix rounds |

**Three regressions were found and fixed at the cause, not at the test.** Two were initially
reported as "pre-existing" and were not — each was re-run against the true base `fbe386a` to settle
it. `golden.test.ts` stayed green and unchanged throughout, which is the phase's evidence that no
balance number moved.

**Known state on leaving phase 1:** 108 raw config reads remain across 38 files in client and
server (36 inside the server tick). Production behaviour is unaffected — with no tuning active the
raw globals and the bundle hold identical values — but live playground tuning does not reach the
client HUD/FX or the bot until phase 3 Task 5b converts them. See Ruling 13 in the ledger.

## Standing rules for every phase

1. **`npm run build` before any suite**, from the repo root, never `--workspaces` — the server's
   tsup step inlines shared's `dist`, and the root script is what enforces shared → server → client
   ordering. A rule that works in tests but not in a live room is this, every time.
2. **`golden.test.ts` must stay byte-identical through phases 1–3.** They are refactors. If the
   golden fixture moves, something changed behaviour and the task is wrong, not the fixture.
3. **Never renumber a `GameMode` enum value** (invariant 7, MC20).
4. **Do not retune.** Not one number moves in this work (spec N4).
5. **`npm run playtest` and `npm run balance` are the user's call, never yours** — but say loudly in
   any summary when a change reaches what the probes measure.

## Decisions that bind, restated

- The bundle is frozen and built once; switching mode is a pointer assignment (MC1, MC7).
- `cfg()` throws outside a scope. No default-mode fallback, ever (MC12).
- `withMode` never wraps anything asynchronous (MC11).
- Types and ids are single-source; only values are per-mode (MC4, MC5).
- Mode tables are total `Record`s, never `Partial` (MC6).
- Bot config stays in the server package (MC29).

## Deferred findings

None yet. Record anything found-but-not-fixed here with the phase that should own it.

---

# Handover — work stopped at end of Phase 3 (2026-09-23)

Branch `feature/game-wise-config`, `fbe386a..bcf8bcb`. Phases 1–3 done; **4, 5 and 6 unstarted.**

## Outstanding risks, highest first

These are live on the branch now. They are not Phase 4–6 features — they are things that will
mislead someone before those phases run.

1. **Every table exists in triplicate and the tooling reads the wrong copy.** The raw global in
   `config/` plus a literal in each mode folder. `modes/table-pinning.test.ts` asserts all three
   equal and is the only thing holding them together. Measured during review: changing raw
   `WEAPON_TABLE.thunderclap.damage` 90→777 left the sim reading 90. A tuning session that edits
   the global moves `balanceStamp`, the players' guide and `npm run ttk` while the game plays
   identically. The root `CLAUDE.md` now signposts this (commit `bcf8bcb`); the real fix is one
   source of truth, which is Phase 6's job.
2. **`ABILITY_SLOTS` no longer reaches the sim.** `sim/` reads `slots().maxAbilitySlots` from the
   mode folders' hand-typed literals. The `ability-slot-count` skill edits the dead global and
   mentions no `modes/` folder. Same shape as (1) but with a skill actively pointing the wrong way.
3. **`basicAttackEnabled` is pinned for the DEFAULT mode only.** `deathmatch/slots.ts` carries an
   independent literal. Running the `basic-attack-toggle` skill to `false` leaves Deathmatch rooms
   firing basic attacks with no HUD pill, suite green.
4. **`BotModeConfig.brainConstants` / `.brainVersion` have no consumers.** Every brain module still
   imports `BRAIN_CONSTANTS` raw and `botFingerprint` imports `BOT_BRAIN_VERSION` raw. MC29 is
   per-mode for one third of its surface — someone giving a mode its own brain constants would edit
   `MODE_BOT_CONFIG` and observe nothing.
5. **`PracticeRoom.onCreate`'s unscoped-read fix has no regression test.** It called
   `isPracticeSetup` unscoped as its first statement (would throw on a truly fresh process, masked
   by every test's setup). Fixed in the final wave; a test needs `matchMaker` mocking, which no room
   test in this repo does.
6. **`npm run playtest` reports 3 findings across 41 probes.** Not compared against a historical
   baseline. This work touched everything the probes measure — worth a read.

## Rulings made on the user's behalf

Any of these can be overturned. Ordered as made; the load-bearing ones are marked.

1. Work in the main checkout, not a worktree — this repo's documented worktree trap silently inlines
   the main checkout's shared `dist`.
2. `BASIC_ATTACK_CONFIG` kept alongside the per-mode flag until its non-sim readers migrate.
3. Parity fixture pinned to `fbe386a`, not a drifting `HEAD~N`.
4. Batched same-shape mechanical tasks into single dispatches.
5. **Not a defect** — `ModeConfig.maxPlayers` is per-mode by MC27; my reviewer brief conflated it
   with the global `MAX_PLAYERS` ceiling. My error, not the implementer's.
6. **LOAD-BEARING** — hull excluded from `ModeTables` by type (`Omit<DriveConfig, "carWidth" |
   "carHeight">`), so a mode folder physically cannot author car dimensions. Rejected the
   alternative (splitting the hull out of `DRIVE_CONFIG`): ~50 readers across 26 files.
7. Async guard placed in shared's `withMode`, not only the server's `scoped()` — the client and
   every harness call `withMode` directly.
8. **LOAD-BEARING, corrects an earlier note of mine** — the six drive formulas in
   `resolveChassisDrive` cannot be de-duplicated by delegating to the accessors: it runs inside
   `assembleModeConfig`, while the mode being assembled is not installed. Parameterised instead.
9. **LOAD-BEARING** — `setTuning` rebuilds and installs a bundle rather than mutating in place.
   Phase 5's design pulled forward four phases because my plan's "leave it compiling" killed its
   whole mechanism.
10. `turret-config.ts` deferred to the task that had an accessor to redirect its callers onto.
11. (see 4)
12. **A client test failure reported as "pre-existing" was ours** — verified at the true base. Led to
    the standing rule that every "pre-existing" claim is re-run against `fbe386a`.
13. **THE BIG ONE — my plan's worst defect.** Phase 3 installed scopes but never listed the 108 raw
    reads outside `shared/sim`. A mode would have run half its own numbers, silently. Phase 3 was
    widened with Task 5b.
14. **Not a defect** — `kills`/`deaths`/`team` have no per-mode ceiling to assert; my plan's snippet
    named a `killTarget` field that does not exist.
15. Squashed a non-compiling intermediate commit before pushing.
16. **Reversed my own task order** — convert the raw reads *before* making `cfg()` throw. A raw read
    never calls `cfg()`, so it would never trip the throw and verification would read falsely clean.
17. Thenable hardening folded into the task that already owned the scope.
18. **Partly wrong** — I folded `ttk` and `build:manual` into a fix round and missed `balance` and
    `playtest`, which the final review caught still crashing. I took an agent's list of three as the
    complete list instead of sweeping myself.
19. **Fixed the branch rather than stopping on it** — the final review found the client did not boot.
    "End of Phase 3" has to mean working software.

## The pattern worth carrying forward

Seven separate guards in this work looked protective and enforced nothing: compile-time invariants
in test files that `tsconfig` excludes from type-checking; two `pinBasicAttackEnabled` helpers
pinning a flag the code no longer read; an assertion comparing a value to itself; a fixture whose
correct order was coincidentally alphabetical; `test:scripts` passing while both scripts crashed;
`maneuver-visual.test.ts` documenting the module-load hazard and working around it while calling the
arrangement "scoped in real use"; and the playtest reporter printing "0 FINDING(s)" while all six
probes had crashed.

Every one passed CI. The only thing that found them was asking, of each guard, *what edit would make
this fail?* — and then making that edit. That question is worth applying to any new guard here.

---

# Handover addendum — phase 4 (2026-09-23)

`b5c868a..9c169a9`, all pushed. Phases **5 and 6 remain unstarted.**

## What phase 4 changed about the six outstanding risks above

Nothing. All six survive as written — they are about tables and tooling, and phase 4 touched
arenas. Risk 5 (`PracticeRoom.onCreate`'s unscoped-read fix has no regression test) now has a
sibling: `ArenaRoom`'s `MSG_SET_MODE` path is testable ONLY through the pure `resolveSetMode` helper
phase 4 extracted; the handler that calls it is still untested, for the same reason — no test in
this repo instantiates a room, because none mocks `matchMaker`. A room harness would close both at
once and is the single highest-value piece of test infrastructure this branch is missing.

## New, from phase 4

7. **The zip and every client now carry 5.8 MB of art for an arena nobody can play.**
   `public/art/arenas/arena-02/floor.png` is 5,836,906 bytes. MC24/MC25 ship the UNION of every
   active mode's `arenas`; MC23 makes a match play `arenas[0]`. Both shipped modes list
   `["arena-01", "arena-02"]`, so the reachable set is `{arena-01}` and the shipped set is both.
   Every LAN client downloads that file and uploads it to the GPU at boot, for nothing.
   **This was ruled deliberate, not fixed** — narrowing the prune to `unique(arenas[0])` would
   contradict MC24/MC25 as approved, and widening later is the harder direction. `asset-pipeline.md`
   now says so in as many words. **It is a live decision for the user**: the alternative is one
   line in `build-release.mjs` and one in `BootScene`, plus re-widening them when an arena picker
   or a second first-arena lands.
8. **A late-joining host can open the Game-modes menu mid-match, and the click now does nothing.**
   `lobby/status.ts` routes to the lobby SCREEN on `isReady(status)` regardless of room phase, and
   `ArenaRoom.onJoin` sets every joiner READY — so the menu is reachable outside `LOBBY`.
   `resolveSetMode` correctly refuses there, which is strictly safer than the divergence it
   replaced, but the host gets no feedback. The honest fix is client-side: hide or disable the menu
   when the room is not in `LOBBY`. Nobody has done it.
9. **One assertion in `asset-keys.test.ts` cannot fail on its own today.** The per-mode containment
   half of the MC24 test passes trivially while both modes carry identical arena lists; the
   `union.length > 1` assertion beside it is the live falsifier. Disclosed in the test's own comment.
   It becomes real the day a mode's list diverges — which is the point of the whole feature.

## Rulings made during phase 4

- **P1** — Task 1 (`activeArenaIds()`) was already landed in phase 2; skipped rather than re-done.
- **P2** — the plan's "repoint its three call sites" for `shouldLoadAssetKey` was wrong: one
  production site plus a test file.
- **P3** — `scripts/build-release.test.mjs` exists, so updating it was mandatory, not the plan's
  optional "if one exists".
- **P4** — tasks 4 and 5 batched into one dispatch; same shape, one review surface.
- **T3-A** — the phase-3 handover's failing-test baseline was stale. OFF-AXIS, P49 and P50 all pass
  now; the branch's two failures are `bot/brain/controller.test.ts`'s G12 pair, confirmed
  pre-existing twice over.
- **T3-B** — `ArenaRoom`'s untested `MSG_SET_MODE` write was parked rather than met with a
  matchMaker harness. The fix wave later made it partly moot by extracting `resolveSetMode`.
- **T45-A** — a docs task was added to the phase, because the change falsified six doc statements.
- **T6-A** — the docs task's review was folded into the final whole-branch review.
- **FR-1** — **the union stays; the 5.8 MB is surfaced, not silently removed.** See risk 7.
- **FR-2** — the `MSG_SET_MODE` guard asymmetry was fixed although it predates phase 4, because
  phase 4 raised its cost from "wrong win rule in the HUD" to "wrong arena under the player".
- **FR-3** — the final review's two load-bearing claims were verified in the source by hand before
  being acted on. One of them found that spec clause MC24's own justification is false; the clause
  now carries an erratum.

---

# Handover addendum — phase 5 (2026-09-23)

`b633120..4814dbf`, all pushed. **Phase 6 is the only one left**, and two of the items below are
directly its business.

## What phase 5 changed about the earlier risks

- **Risk 5 (no room test mocks `matchMaker`) is unchanged** and still the highest-value missing test
  infrastructure on this branch.
- **A NEW guard replaced an old one.** `practice-room.test.ts` asserted by source text that
  `PracticeRoom` never calls `setTuning`. That symbol no longer exists, so the assertion could not
  fail. It now watches `installMode` — the hazard that outlives `setTuning` — and the mirror
  assertion was added to `PlaygroundRoom`, which is the room that actually tunes and had none.
  Both were proven by adding the forbidden call and watching the test fail. Known limit, inherited
  from the original: a source-text scan cannot see a call made through a helper in another file.

## New, from phase 5

10. **The walker's cross-check quietly became a self-check, and phase 6 must repair it.**
    `setTuning` validated tuning paths against a snapshot of the RAW `config/` globals while
    writing into a clone of `BRAWL_TABLES` — so `tuning-walker.test.ts`'s round-trip transitively
    proved every emitted path existed in BOTH table sets. `applyOverrides` resolves both halves
    against the same bundle, while `tunableFields()`'s `shipped` values still come from the raw
    globals. The only thing bridging them now is `table-pinning.test.ts` — whose documented
    workflow is to DELETE a table's row the moment two modes intentionally diverge. The first time
    someone does that, a field present in `WEAPON_TABLE` but dropped from a mode's `weapons.ts`
    gives a slider whose range comes from the global and whose write `applyOverrides` rejects at
    runtime, with nothing red.
    **Phase 6 should make `tunableFields()` take a bundle.** That `shipped` read is the last
    raw-global read in the file.
11. **`applyOverrides` now refuses a hull override instead of silently eating it.** Its roots came
    from `base.drive`, which — unlike `ModeTables.drive`, whose TYPE omits them — carries
    `carWidth`/`carHeight` at runtime. So `{"drive.carWidth": 999}` validated, wrote, and was then
    overwritten by `assembleModeConfig` re-attaching the global hull: no error, no effect. Fixed
    (MC35). Worth knowing because the first attempt at the fix **silently broke every OTHER drive
    override** — the writes landed on a disconnected copy rather than `tables.drive` — which an
    existing test caught. The shipped shape keeps the real object for writes and a hull-free copy
    for validation.
12. **`shouldRefusePlayground` now rests on a weaker claim, and that is the user's call.** It
    refuses to open a playground while an arena or practice room has anyone in it, and part of its
    stated reason was the process-wide tuning store that no longer exists. Its comments and its
    player-facing refusal copy were corrected; its behaviour and condition were not touched. The
    final review's read, which I accept: `maxClients = 1`, the second-playground guard and this one
    are three expressions of "the sandbox is a singleton", and removing one on a comment-edit's
    authority leaves an incoherent set. The surviving reasons are real (shared CPU, shared
    matchmaker, a tester's six bots beside a live match).
13. **One deliberately unreachable check.** `overlay.ts`'s write loop re-checks the two hull paths,
    which validation can never let through. Kept as defence in depth, with a comment naming its own
    unreachability and the exact invariant it depends on (validate-whole-batch-then-write). Judged
    worth its lines on the grounds that this branch's nine bad guards were SILENT ones with false
    confidence, not documented redundancy. Reverse it freely if you disagree.

## Rulings made during phase 5

- **P1** — the path-walking machinery MOVED into `overlay.ts` rather than being imported from the
  file the phase then guts.
- **P2** — `applyOverrides` validates against the BASE BUNDLE, not a snapshot of the raw globals.
  More correct per mode, and one fewer raw-global dependency. This is also what produced risk 10.
- **P3** — a third task was added for the client half the plan never mentioned.
- **P4** — the `setTuning` absence guard was REPOINTED at `installMode`, not deleted.
- **P5** — `shouldRefusePlayground` stays; see 12.
- **P6** — task order T1 -> (T2+T3 batched) -> T4.
- **P7** — the phase-3 typecheck regression is fixed by restoring narrowing, never by a cast.
- **P8** — "the suites are green" stops being sayable from per-package runs alone. Root `npm test`,
  its exit code, and the step it reaches are the standard now.
- **FR5-1** — risk 10 is phase 6's, not a late addition to this one.
- **T1-A** — the plan's own misleading status-id test was re-titled rather than deleted. Which then
  exposed that its sibling was ALSO passing for the wrong reason: `isStatusId` read the INSTALLED
  bundle, so with nothing installed it threw a scope error, not a status-id error. Right message
  class, wrong mechanism. Now validated against `base.statusTable`.
