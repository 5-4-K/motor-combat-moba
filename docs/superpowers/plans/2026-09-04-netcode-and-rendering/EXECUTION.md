# Execution tracker — netcode and rendering

> **Read this first in any session that executes one of these plans, before the execution guide and
> before the plan itself.** It is the state file: where the work got to, what was measured, what was
> decided along the way, and which task is in flight right now. [`00-execution-guide.md`](00-execution-guide.md)
> says *how* to run a phase; this file says *where you are*. [`PROGRESS.md`](PROGRESS.md) is a
> different thing again — it logged the writing of these plans, which finished on 2026-09-05, and it
> has nothing to say about execution.
>
> **The update rule, which is the whole point of this file (do not skip):** update it **in the same
> commit** as the work it describes. A task's commit ticks that task's checkboxes in its plan file
> *and* moves the in-flight block below. A phase's merge fills its tracker row and its measured
> numbers. Nothing here is written from memory at the end of a session — a session can stop at any
> moment, and the last commit must already say where it stopped.

**Status as of 2026-09-05: nothing is executed.** All fourteen plans are written; no code has
changed. The next thing to run is the preparation plan.

---

## Starting a session: the first five minutes

1. **Read the in-flight block** (§2). It names the phase, the branch, the worktree, the last
   completed task and the next one. If it says *nothing in flight*, start at §3's first
   `Not started` row that has its dependencies `Landed`.
2. **Verify it against git**, because this file is a claim and git is the fact:
   ```bash
   git -C <repo> log --oneline -8 development/main
   git -C <repo> worktree list
   git -C <repo> branch --list 'netcode/*' 'render/*'
   ```
   The last merge into `development/main` should match the newest `Landed` row. If it does not,
   **trust git and fix this file first** — a phase whose merge commit exists but whose row is empty
   was interrupted between the merge and the tracker update.
3. **Open the phase's plan and find the first unticked `- [ ]`.** That is the resume point, exact to
   the step. The plans are executed with superpowers:subagent-driven-development, one task per
   subagent, and the checkboxes are the handover between sessions as much as between agents.
4. **Check the gate of the phase before yours** (§3's Gate column, or the guide's §5). *"The previous
   phase's acceptance is recorded in its merge commit. If it is not, the previous phase is not
   done."*
5. **Re-read the plan's Interfaces blocks against [`interfaces.md`](interfaces.md)** if the ledger
   moved since the plan was written (guide §8). §5 below lists every ledger edit made during
   execution, with the phase that made it.

## 1. What "done" means, and the four rules that bite mid-execution

A phase is done when its plan's `## Acceptance` commands print numbers inside the guide's §5 gate
**and** the three ground-truth commands are green:

```bash
npm run build -w @motor-combat-moba/shared && npm test
npm run build
npm run smoke:arena
```

Four rules that cost a day each when forgotten, all from the root `CLAUDE.md` and repeated here
because a fresh worktree is exactly when they bite:

- **`npm install` in every new worktree before the first build.** Without it the build inlines the
  *main checkout's* shared `dist` and the server silently runs the wrong sim while all three suites
  pass. Tell them apart by the inlined path in `packages/server/dist/index.js`: `// ../shared/dist/…`
  is right, `// ../../../../../packages/shared/dist/…` has escaped the worktree.
- **Build with root `npm run build`, never `npm run build --workspaces`.** The server bundle inlines
  shared's `dist` and only the root script enforces the order.
- **Rebuild shared before every test run.** Stale `dist` looks like "I changed constants and nothing
  happened".
- **Never run two phases of the same stream at once.** Each plan assumes the previous one merged.
  The two *streams* may run at the same time in separate sessions; that is the design.

## 2. In flight

Two blocks, one per stream, so two sessions editing this file at once touch different lines. Keep
each to the five fields. **Update in the same commit as the task.**

### Netcode stream

```
Phase:      —
Branch:     —
Worktree:   —
Last done:  —
Next:       —
```

### Rendering stream

```
Phase:      —
Branch:     —
Worktree:   —
Last done:  —
Next:       —
```

**Anything half-done that a `- [ ]` does not capture goes here as a sixth line**, in prose: a
migration half-applied, a test disabled on purpose, a decision waiting on the user. A blank block
means the working tree is clean and the last commit is a task boundary.

## 3. Phase tracker

Status values: `Not started` · `In progress` · `Landed` · `Landed, under target` · `Blocked` ·
`Skipped`. Branch names are the guide's: `netcode/<phase>` and `render/<phase>`, cut from
`development/main` when the phase starts.

| # | Plan | Depends on | Status | Branch | Merged (commit, date) |
|---|---|---|---|---|---|
| P | [`01-prep-arena-scene-split-and-render-frame.md`](01-prep-arena-scene-split-and-render-frame.md) | — | Not started | | |
| N0 | [`10-netcode-0-instrumentation.md`](10-netcode-0-instrumentation.md) | P | Not started | | |
| V0 | [`20-render-0-instrumentation.md`](20-render-0-instrumentation.md) | P | Not started | | |
| N1 | [`11-netcode-1-time.md`](11-netcode-1-time.md) | N0 | Not started | | |
| V1 | [`21-render-1-hud.md`](21-render-1-hud.md) | V0 | Not started | | |
| N2 | [`12-netcode-2-wire.md`](12-netcode-2-wire.md) | N1 | Not started | | |
| V2 | [`22-render-2-bake.md`](22-render-2-bake.md) | V1 | Not started | | |
| N3 | [`13-netcode-3-world.md`](13-netcode-3-world.md) | N2 | Not started | | |
| V3 | [`23-render-3-beams.md`](23-render-3-beams.md) | V2 **and N1** | Not started | | |
| N4 | [`14-netcode-4-feel.md`](14-netcode-4-feel.md) | N3 | Not started | | |
| V4 | [`24-render-4-events.md`](24-render-4-events.md) | V3 (real events need N4) | Not started | | |
| N5 | [`15-netcode-5-lifecycle.md`](15-netcode-5-lifecycle.md) | N4 | Not started | | |
| V5 | [`25-render-5-pixels.md`](25-render-5-pixels.md) | V4 | Not started | | |
| N6 | [`16-netcode-6-optional.md`](16-netcode-6-optional.md) | N5, **and each task's own gate** | Not scheduled | | |

**N6 is never `Not started`.** Its five tasks are gated on evidence and are not a phase in the sense
the others are; its state lives in its own gate ledger (§6).

## 4. Measured numbers

The gate, and what it actually read. **A row is filled when the phase merges**, and the merge commit
carries the same numbers — this table exists so a later reader can compare two phases without
`git log`. A phase that lands under target is recorded here with the measured value and merged as
`Landed, under target` (guide §4); the number is never weakened to fit.

| # | Gate (guide §5) | Measured | Verdict |
|---|---|---|---|
| P | every suite green; `ArenaScene.ts` under 700 lines; `smoke:arena` moves the car with no browser errors | | |
| N0 | ping/RTT in `?debug=net`; baseline harness numbers; frozen-remote frames < 1 % at 25 ms jitter; differ agrees on Node, Chromium and Firefox | | |
| V0 | bench p50/p95 on Chromium and Firefox; baseline in `docs/render-bench.md` | | |
| N1 | repeated-input rate < 1 % at 25 ms jitter; free-driving correction 0; golden and turn-tuning green at 60 Hz; `playtest` captured before and after | | |
| V1 | HUD draws zero `Graphics` per frame; `Text` count in the arena 0; bench p95 no worse than V0 | | |
| N2 | full snapshot ≤ 700 B; delta steady state ≤ 350 B; join refuses a mismatched build readably | | |
| V2 | no per-frame world `Graphics` except beams and debug; draw calls ≤ 16 at the ceiling | | |
| N3 | contact correction p95 < 12 u, no snap over 48 u at 90 ms ± 20 ms; remote extrapolation p95 < 20 u; **checkpoint evaluated (§7)** | | |
| V3 | no per-frame world `Graphics` except debug; client JS p95 < 5 ms at the ceiling | | |
| N4 | ghost-shot mismatch < 0.5 % of presses; press-to-flash within one frame; HUD readouts in tick time | | |
| V4 | particles capped per tier; every event kind drives an effect on synthetic events; decal service empty and tested | | |
| N5 | a pulled cable resumes within 15 s (the seat is held 60 s — two different numbers); silence and flood detectors unit-tested; late join works | | |
| V5 | tiers auto-select and persist; dpr 1.5 sharp on a 150 % display; ceiling p95 < 12 ms at High and < 8 ms at Low | | |
| N6 | per task, in its own gate ledger (§6) | | |

**Name the machine beside any frame-time or latency number.** The rendering spec's R25 is stated for
a specific reference machine (2019 integrated-graphics laptop class), and a number from anything else
is a different measurement wearing the same units.

## 5. Ledger edits made during execution

The plans were written against [`interfaces.md`](interfaces.md) as it stood on 2026-09-05. When a
task finds the ledger wrong, the guide's §4 says: **stop, edit the ledger and the affected later
plans in one commit, then continue.** Record each one here, because the next session reads the
ledger, not the commit that changed it.

| Date | Phase | What changed | Why |
|---|---|---|---|
| — | — | — | — |

(Nine ledger defects were found and fixed during plan-*writing*; those are in
[`PROGRESS.md`](PROGRESS.md) §3 and are already reflected in the ledger. This table is for what
execution finds.)

## 6. N6's gates

**The gate ledger lives in [`16-netcode-6-optional.md`](16-netcode-6-optional.md)'s own header**, not
here — one copy, in the file whose tasks it governs. Fill a row there when a gate is read, whatever
the answer, and add a line to §8 below saying it was read.

The two gates worth reading early, long before N6 would otherwise come up:

- **`telegraphAudit()`** — already known to be non-empty (it names `thunderclap`). It is shipped by
  N4 and is readable the moment N4 lands.
- **The harness's snapshot-bytes-under-volley row** — readable as soon as N2's codec exists, and
  expected to sit far under its 1.2 KB line.

## 7. The approach-B checkpoint

Netcode spec §6.6, guide §6. **This is the one place where a measurement can change the design**, and
it is evaluated once, after N3 is measurable.

```
Evaluated:            not yet
Contact correction p95:   —      (line: < 12 u)
Snaps:                    —      (line: 0)
Remote extrapolation p95: —      (line: < 20 u)
Lead at evaluation:       —
remoteSteerHoldTicks:     —      (both levers exhausted? —)
Decision:                 —
```

If it fails with both levers exhausted (lead at its floor for the link, `remoteSteerHoldTicks` tuned
by the harness over recorded logs — which is N6's Task 5, and is worth pulling forward to here):
record the numbers in N3's plan under `## Acceptance`, **stop the netcode stream**, let the rendering
stream continue (nothing in V0–V5 depends on the remote timebase), and write a new N3 for approach B
against the same ledger — **for the user to approve before it is executed.**

## 8. Log

Newest last. One line per session, per phase merge, per gate read, per decision that a future reader
would otherwise have to reconstruct. This is the file's memory: the tables above say *what*, and this
says *why* and *what it cost*.

- **2026-09-05** — plan-writing finished (all fourteen); this tracker created. Nothing executed.

## 9. When a session ends, expectedly or not

- **The last commit is the resume point.** Because the update rule puts this file's in-flight block in
  the same commit as each task, an interruption loses at most one task's worth of context, and §2
  already says which one was next.
- **Leave nothing half-written under a final name.** The rule that saved the V2 plan draft applies to
  code too: a partly-migrated module under its final path looks finished to the next session.
- **A rate limit or a hard stop mid-task** needs no cleanup beyond that. Re-read this file's §"first
  five minutes", then the plan's first unticked box.
- **Do not update this file "later".** A tracker written from memory at the end of a session records
  what somebody remembers, which is the failure this file exists to prevent.
