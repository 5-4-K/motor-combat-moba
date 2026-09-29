# Online netcode redesign — execution state

> **Read this first in any session that executes this work.** It is the state file: which phase is
> in flight, what each finished phase measured, and what was decided along the way. It is updated
> **in the same commit** as the work it describes, so a session can stop anywhere and the next one
> resumes exactly.

**Spec:** [`docs/superpowers/specs/2026-09-29-online-netcode-redesign-design.md`](../../specs/2026-09-29-online-netcode-redesign-design.md) (NR1–NR68)
**Branch:** `development/main` (the user's instruction for this work; each task commits and pushes).
**Method:** superpowers:subagent-driven-development — one implementer subagent per task, one
reviewer per task, a whole-phase review at each phase's end.

## Phases

Each phase is its own plan file, runs in order, and ends green: `npm test` (the two G12 bot
failures in `controller.test.ts` are pre-existing, see `docs/testing.md`), `npm run build`, and the
phase's own acceptance lines.

| Phase | File | Spec | Status | Measured / notes |
|---|---|---|---|---|
| A — Colyseus 0.18, schema 5, Node 22, monitor gate | [`A-colyseus-upgrade.md`](A-colyseus-upgrade.md) | NR50, NR53 | Not started | |
| B — netsim harness and today's baseline | [`B-netsim-harness.md`](B-netsim-harness.md) | NR57–NR59 | Not started | |
| C — 60 Hz and per-tick snapshots | [`C-sixty-hz.md`](C-sixty-hz.md) | NR11–NR16 | Not started | |
| D — time and inputs | [`D-time-and-inputs.md`](D-time-and-inputs.md) | NR17–NR28, NR54–NR56 | Not started | |
| E — remotes and prediction | [`E-remotes.md`](E-remotes.md) | NR29–NR34 | Not started | |
| F — combat under latency | [`F-combat.md`](F-combat.md) | NR35–NR41 | Not started | |
| G — interest management, docs | [`G-interest.md`](G-interest.md) | NR42–NR49, NR68 | Not started | |

## In flight

**Paused before any implementation — waiting for the user's explicit go-ahead** (asked
2026-09-29). Spec (`d6f2f1a`) and plan (`b632b4c`, `b907659`) are committed; no code has changed.
A first dispatch of Task A1 was cancelled before it wrote anything. When the user says go:
Phase A, Task 1 (A1), via superpowers:subagent-driven-development, one implementer + one reviewer
per task, committing and pushing each task to `development/main`.

Decisions the user was asked to check before approving (unanswered at pause):
- Server FOV filtering uses `@view()` field tags on `PlayerState`, not a schema split (NR42,
  verified against `@colyseus/schema` 5.0.34 in a scratch test).
- Hard invariant 5 reworded (NR13); invariant 8 gains a `@view` clause (G6).
- Bot timing authored in ms, identical at 30 Hz, doubles in ticks at 60 Hz; `BOT_BRAIN_VERSION`
  6.3.0 (C1).
- 60 Hz moves handling slightly through the integration step only; measured and reported in C3.
- D4 is one atomic commit (server, bots, harnesses, client).
- All work lands directly on `development/main`.

Tooling notes for the executor:
- Plan task headings are numeric (`### Task 1 (A1): …`) so `task-brief PLAN_FILE N` finds them;
  each phase file is its own SDD plan with its own workspace under `.superpowers/sdd/<phase>/`.
- Phase A pre-flight ruling: if `npm run playtest:lan` (A2 Step 6 smoke) does not exit on its own,
  the implementer judges pass from its log (both clients joined and received state). Cost if
  wrong: a smoke that passed without a full match.
- Two failures in `packages/server/src/bot/brain/controller.test.ts` (G12) are pre-existing.

## Rules that bite mid-execution

- Build shared before anything reads it: `npm run build -w @motor-combat-moba/shared`. Server and
  client consume shared's `dist`; a stale `dist` looks like "my change did nothing".
- Build with root `npm run build`, never `--workspaces` (order matters: the server bundle inlines
  shared).
- Every config accessor is read inside a mode scope; never at module scope (root `CLAUDE.md`).
- A change to anything the playtest probes measure is reported loudly in the phase summary, with a
  recommendation to run `npm run playtest`; probes are only edited to keep them compiling.
- `docs/ideas/` and `docs/invariants/` are off limits.
- A task that finds the plan wrong stops and records the deviation here before working around it.

## Baseline and per-phase numbers (netsim, §10 of the spec)

Filled in by Phase B and after each later phase. Link profile names: `lan` (1 ms, 0 jitter, 0 %),
`net80` (80 ms RTT, ±10 ms, 1 %), `net150` (150 ms RTT, ±15 ms, 1 %).

| Metric | Target | Baseline | after D | after E | after F | after G |
|---|---|---|---|---|---|---|
| Server steps per car per tick (max) | 1 | | | | | |
| Repeated-input ticks, net80 | ≤ 2 % | n/a | | | | |
| Remote path error p95, net80 (u) | ≤ 12 | | | | | |
| Remote hold frames, net80 | ≤ 1 % | | | | | |
| Local reconcile correction p95, net80 (u) | ≤ 4 | | | | | |
| Input-to-server delay, lan (ms) | ≤ 34 | | | | | |
| Remote display delay, lan (ms) | ≤ 50 | | | | | |
| Hidden enemy present in decoded state | never | n/a | n/a | n/a | n/a | |

## Deviations from the plan

None yet.
