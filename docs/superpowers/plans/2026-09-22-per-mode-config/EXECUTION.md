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
| 1. Accessor layer, one bundle | [`01-accessor-layer.md`](01-accessor-layer.md) | **tasks 1-5 landed; batch review in flight** |
| 2. Two mode folders | [`02-mode-folders.md`](02-mode-folders.md) | not started |
| 3. Scopes installed | [`03-room-scopes.md`](03-room-scopes.md) | not started |
| 4. Lobby and arena sets | [`04-lobby-and-arenas.md`](04-lobby-and-arenas.md) | not started |
| 5. `setTuning` retired | [`05-retire-set-tuning.md`](05-retire-set-tuning.md) | not started |
| 6. Tooling | [`06-tooling.md`](06-tooling.md) | not started |

**In flight:** Phase 1 — task review of the batched Tasks 4+5 (`review-4140d69..ea0a122.diff`).
**Next:** close Phase 1 Task 6, then Phase 2 Task 1.

### Phase 1, as landed (commits `fbe386a..ea0a122`, all pushed)

| Task | Commits | Outcome |
|---|---|---|
| 1. Bundle types + builder | `6a465ee`, `4116def` | complete, re-review clean |
| 2. `withMode` scope + 16 accessors | `8db8cd9` | complete, approved first pass |
| 3. Accessor bodies onto the bundle | `2b02145`, `2341010`, `4140d69` | complete after 2 fix rounds |
| 4+5. 66 sim dereferences (batched) | `66823d1`, `c381978`, `ea0a122` | review in flight |

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
