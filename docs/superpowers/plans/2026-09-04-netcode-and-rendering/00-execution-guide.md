# Executing the netcode and rendering plans

> **For agentic workers:** this is the plan for running the other plans in this folder. Each phase
> plan is executed with superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans, in the order and with the gates below. Read this file first in every
> session that touches this work.

**Goal:** Land the two approved architecture specs — online netcode and client rendering — as
fourteen shippable phases in two parallel streams, with every phase merged into
`development/main` before the next one starts and every acceptance number measured, not assumed.

**Specs:**
[`2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md)
and
[`2026-09-04-client-rendering-architecture-design.md`](../../specs/2026-09-04-client-rendering-architecture-design.md).
**Ledger:** [`interfaces.md`](interfaces.md) — every name the plans share. A plan that needs to
change a ledger entry edits the ledger in the same commit.

## 1. The plans

| # | File | Stream | Depends on | Can run in parallel with |
|---|---|---|---|---|
| P | `01-prep-arena-scene-split-and-render-frame.md` | shared | — | nothing: everything waits for it |
| N0 | `10-netcode-0-instrumentation.md` | netcode | P | V0 |
| V0 | `20-render-0-instrumentation.md` | rendering | P | N0 |
| N1 | `11-netcode-1-time.md` | netcode | N0 | V1 |
| V1 | `21-render-1-hud.md` | rendering | V0 | N1 |
| N2 | `12-netcode-2-wire.md` | netcode | N1 | V2 |
| V2 | `22-render-2-bake.md` | rendering | V1 | N2 |
| N3 | `13-netcode-3-world.md` | netcode | N2 | V3 |
| V3 | `23-render-3-beams.md` | rendering | V2 **and N1** | N3 |
| N4 | `14-netcode-4-feel.md` | netcode | N3 | V4 |
| V4 | `24-render-4-events.md` | rendering | V3 (real events need N4; synthetic ones do not) | N4 |
| N5 | `15-netcode-5-lifecycle.md` | netcode | N4 | V5 |
| V5 | `25-render-5-pixels.md` | rendering | V4 | N5 |
| N6 | `16-netcode-6-optional.md` | netcode | N5, and each task's own evidence gate | — |

Within a stream the order is fixed. Across streams, the pairs in the last column may run at the
same time in separate sessions. The three couplings that break the symmetry:

1. **N1 before V3.** The 60 Hz tick re-pins beam timings; V3 authors them once, at 60 Hz.
2. **V4 on synthetic events until N4 lands.** V4's bench scene fabricates `MatchEvent`s; the
   one-line switch to real events is in V4's plan and is applied when N4 has merged.
3. **Only the netcode stream edits `packages/shared`.** A rendering plan that needs a shared change
   says so in its header and lands that change as its own first commit, merged before the rest.

## 2. Sessions and worktrees

- **One session per stream, one worktree per phase.** Use superpowers:using-git-worktrees. Branch
  names: `netcode/<phase>` and `render/<phase>`, cut from `development/main` at the moment the
  phase starts. "main" always means `development/main` (root `CLAUDE.md`).
- **`npm install` in every new worktree before the first build.** Without it the build inlines the
  main checkout's shared `dist` and the server silently runs the wrong sim (root `CLAUDE.md`,
  "In a worktree, run `npm install` before the first build"). Check
  `packages/server/dist/index.js` for `// ../shared/dist/…`, not `// ../../../../../packages/…`.
- **Rebuild shared before every test run**: `npm run build -w @motor-combat-moba/shared`.
- **Merge after every phase**, never after every task: `development/main` receives one merge per
  plan, with the acceptance evidence in the merge commit's message. The other stream rebases on it
  before starting its next phase.
- **The preparation plan is executed alone**, in one session, and merged before either stream
  starts.

## 3. Executing one plan

For each plan, in order:

1. **Read**: this guide, the plan, the ledger, and the plan's `Spec` links. Read the previous
   phase's plan `## Handoff` section, which lists the exports this plan consumes.
2. **Check the gate** (section 5): the previous phase's acceptance is recorded in its merge
   commit. If it is not, the previous phase is not done.
3. **Execute task by task** with superpowers:subagent-driven-development: a fresh subagent per
   task, the two-stage review between tasks, TDD inside each task as the plan's steps require.
   Commit after every task with the plan's commit message.
4. **Run the plan's `## Acceptance` commands** and keep the printed numbers.
5. **Run the repo's ground truth**: `npm run build -w @motor-combat-moba/shared && npm test`, then
   root `npm run build`, then `npm run smoke:arena` (from the preparation plan). All three green.
6. **Playtest rule**: if the plan's tasks touched anything the probes measure (root `CLAUDE.md`
   lists the set: `sim/`, the tick order, the tables, `NET_CONFIG`, `TICK_RATE_HZ`, the client's
   prediction and step-context), say so in the merge commit message, name the probe and the
   number, and recommend `npm run playtest`. Do not update a probe unless the user asks, except a
   compile break, which is fixed on the spot and named.
7. **Finish the branch** with superpowers:finishing-a-development-branch: merge into
   `development/main` with the acceptance numbers in the message.
8. **Update the ledger** if the plan's Handoff added exports a later plan needs, in the same merge.

## 4. When a task fails

- **A failing test in the plan's own tests**: superpowers:systematic-debugging; fix the code, not
  the test. A test that pinned a number the plan deliberately moved (a golden fixture, the
  turn-tuning page, the manual fingerprint) is re-pinned by the step the plan names for it, never
  silently.
- **A step that turns out to need a ledger change**: stop, edit the ledger and the affected later
  plans in one commit, then continue. Do not work around it locally.
- **A step that cannot meet its acceptance number**: do not weaken the number. Record the measured
  value in the plan file under `## Acceptance` with the date, merge the phase as "landed, under
  target", and open the next phase only if its plan does not depend on the missed number. The
  approach-B checkpoint (section 6) is the one case where a missed number changes the design.
- **A rate limit or session cut mid-plan**: the last commit is the resume point; the plan's
  checkboxes say which task was in flight. Re-read this guide, then continue from that task.

## 5. Gates: what "done" means per phase

Each phase is done when its plan's `## Acceptance` commands print numbers inside these bounds and
the three ground-truth commands are green. The numbers are the specs' migration rows.

| Phase | Gate |
|---|---|
| P | every suite green; `ArenaScene.ts` under 700 lines; `npm run smoke:arena` moves the car with no browser errors |
| N0 | ping/RTT shown in `?debug=net`; baseline harness numbers recorded; frozen-remote frames under 1 % at 25 ms jitter after the 67 ms buffer fix; differ runs on Node, Chromium and Firefox with no contact-set divergence |
| V0 | bench scene prints p50/p95 on Chromium and Firefox; baseline recorded in `docs/render-bench.md` |
| N1 | repeated-input rate under 1 % at 25 ms jitter; free-driving correction stays 0; golden and turn-tuning suites green at 60 Hz; `npm run playtest` baseline captured before and after |
| V1 | HUD draws zero `Graphics` per frame; `Text` count in the arena is 0; bench p95 no worse than V0 |
| N2 | full snapshot ≤ 700 B, delta steady state ≤ 350 B; join refuses a mismatched build with a readable message |
| V2 | no per-frame `Graphics` on the world path except beams and debug; draw calls ≤ 16 at the ceiling |
| N3 | contact correction p95 < 12 u and no snap over 48 u at 90 ms ± 20 ms in the harness; remote extrapolation error p95 < 20 u; checkpoint (section 6) evaluated |
| V3 | no per-frame `Graphics` on the world path except debug; client JavaScript at the ceiling p95 < 5 ms on the reference machine |
| N4 | ghost-shot mismatch < 0.5 % of presses; press-to-flash within one frame; HUD readouts in tick time |
| V4 | particles capped per tier; every event kind drives an effect on synthetic events; decal service empty and tested |
| N5 | a pulled cable resumes within 15 s of being plugged back in (the seat itself is held for `reconnectSeconds` = 60 s — two different quantities, spec §8 phase 5 and N26); silence and flood detectors unit-tested; late join works |
| V5 | tiers auto-select and persist; dpr 1.5 sharp on a 150 % display; frame time at the ceiling p95 < 12 ms at High and < 8 ms at Low on the reference machine |
| N6 | each task's own gate, stated in its first step; skipped tasks are recorded as skipped with the measured value |

## 6. The approach-B checkpoint

Netcode spec §6.6, decided 2026-09-04: after N3 is measurable, if contact corrections exceed the
acceptance line (p95 over 12 u, any snap over 48 u at the design point) **with the window and
steer-hold levers exhausted** (lead at its floor for the link, `remoteSteerHoldTicks` tuned by the
harness over recorded logs), the fallback is approach B — remotes drawn in the interpolated past
with rewind hit testing. P, N0, N1 and N2 are identical under both approaches; N3 is where they
diverge. If the checkpoint fails:

1. Record the measured numbers in N3's plan under `## Acceptance`.
2. Stop the netcode stream. The rendering stream continues; nothing in V0–V5 depends on the
   remote timebase.
3. Write a new N3 plan for approach B against the same ledger (interpolation buffer with an
   adaptive delay, a server pose history, hit tests through the `PoseSnapshot` seam in `hits.ts`)
   and bring it to the user for approval before executing it.

## 7. Cadence and check-ins

- Each phase ends with a short written summary to the user: what landed, the acceptance numbers,
  what the probes say moved, and the next phase's first task. The summary goes in the merge
  commit and in the session's final message.
- After N3 and after V3, run `npm run playtest` and `npm run balance` and hand the reports to the
  user before continuing: both are the points where the sim's observable behaviour has moved most
  (60 Hz, world prediction; baked visuals do not touch the sim but V3 is where the beam
  measurements the playtest README quotes go stale).
- N6's tasks are not scheduled; each is run when its gate is observed true in a real match's
  netgraph or harness output, and the user says so.

## 8. What not to do

- Do not start a rendering phase that edits `packages/shared` without landing the shared change
  first (section 1).
- Do not run two phases of the same stream at once; their plans assume the previous one merged.
- Do not execute a later plan against an older ledger: if the ledger changed since the plan was
  written, re-read the plan's Interfaces blocks against it before the first task.
- Do not skip the preparation plan's smoke script; it is the only automated behaviour check for
  the Phaser-bound half until V0's bench exists.
- Do not read or plan against `docs/ideas/` or `docs/invariants/` (root `CLAUDE.md`).
