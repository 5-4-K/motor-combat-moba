# Car Physics Rework — Execution State

**This is the state file. Read it before touching this work in any session.** It is updated in the
same commit as the work it describes, so a session can stop anywhere and the next one resumes
exactly. Same convention as the netcode rewrite's `EXECUTION.md`.

**Last updated:** 2026-09-06, after the revision-2 replan.

---

## The one thing that will confuse you if you miss it

**The spec changed models mid-rework.** Stages 1 and 2 were executed against **revision 1**, which
derived ram outcomes from `mass` and made contact impulses equal and opposite. Measuring the result
showed every chassis is thrown backwards *faster than its own top speed* for landing a ram.

**Revision 2 removes `mass` from the game entirely** and replaces equal-and-opposite impulses with a
contest between each car's `ramAttack` and `ramDefence`.

So: **the code currently in the branch implements a ram model the spec now marks superseded.** That
is expected, it is marked in place rather than reverted, and stage 3 is what replaces it. Read the
spec's **Changelog** and **R1–R11** before reading any code in `sim/ram.ts` or `sim/impulse.ts`, or
the code will look like it contradicts the design — because it does, deliberately, until stage 3
lands.

---

## Where things stand

| | state |
|---|---|
| Branch | `claude/car-physics-implementation-283ddf` (branched from `feature/car-physics-rework` at `02f5a89`) |
| Commits | 32 |
| Root `npm test` | GREEN |
| Root `npm run typecheck` | GREEN |
| Root `npm run build` | GREEN |
| Merged anywhere | **No.** Nothing has gone near `development/main`. |
| Played by a human | **No.** See "What has never been verified". |

| stage | plan | state |
|---|---|---|
| 1 | `01-vector-drive.md` | **Executed** (18 commits), against revision 1. Fully survives revision 2. |
| 2 | `02-contact-and-impulse.md` | **Executed** (9 commits), against revision 1. Plumbing survives; the mass-derived and equal-and-opposite parts are superseded. |
| 3 | `03-ram.md` | **Rewritten for revision 2. Not started.** ← next |
| 3b | `03b-ram-feel.md` | Written. Not started. |
| 4 | `04-impulse-def.md` | Revised for revision 2. Not started. |
| 5 | `05-tune-and-reconcile.md` | Revised for revision 2. Not started. |

The last 5 commits (`febd7b8`..`2c7f235`) are the redesign and replan — no code changed in them.

## Resume here

**Stage 3, Task 1.** Execute `03-ram.md` with `superpowers:subagent-driven-development`.

Stage 3's four tasks are ordered so **every task compiles**: `mass` is added *alongside* the new
ratings first and removed last, when nothing reads it. Stage 1 landed a deliberately non-compiling
window and it cost three fix rounds — do not reorder this to "clean up first".

## What survives revision 2, and what does not

Do not re-litigate these; they are settled and recorded in the spec.

**Survives** — build on it: the `vx`/`vy` velocity vector and everything in stage 1; wall deflection
and `restitution: 0.15`; the `Impulse` struct and its single-applier seam; edge-triggered contact;
`resolveWorld`'s fifth parameter and the `CarObstacle` plumbing (only the *stat* feeding it changes).

**Superseded** — stage 3 replaces it: `mass` and everything derived from it (`massOf`,
`massFactorMin`/`massFactorMax`, `ramReference*`); `reactionOf` and equal-and-opposite reactions;
the 0–1 severity grade.

## Per-machine setup

```bash
npm install
npm run build -w @motor-combat-moba/shared
npm test
```

**`npm install` is not optional in a worktree.** Without it Node walks up to the parent checkout's
`node_modules`, and every build inlines the *wrong* `shared` dist while all three suites still pass.
Tell the two apart by the inlined path in `packages/server/dist/index.js`: a comment reading
`// ../shared/dist/…` is correct, `// ../../../../../packages/shared/dist/…` has escaped the
worktree.

The code-review-graph needs its own build per checkout (`uvx code-review-graph@2.3.8 build`, or the
`code-graph-install` skill). `uv` is the only per-machine prerequisite.

**The gate is root `npm test` *plus* `npm run typecheck`.** The typecheck gate covers `playtest/` and
`balance/`, which `npm test` and `npm run build` do not. Stage 1 repaired it after finding 37 errors
hidden behind a pre-existing failure that aborted the chain; do not let it rot.

## What has never been verified

**Nobody has driven any of this.** All 32 commits are gated by tests and arithmetic only.

- Stage 1's exit criteria 3 and 4, and all of stage 2's, are hands-on checks that remain unticked.
- `npm run playtest` has **not** been run since stage 1 began. Every probe measuring ramming,
  collision depth or prediction error reads code that has been rewritten twice. Compile breaks were
  fixed on the spot; **no threshold or expectation was changed** — those are the user's call and
  stage 5 owns them. Each stale threshold carries a comment saying what moved.
- Balance baselines from before this branch are not comparable: the config fingerprint moved, and
  `BOT_BRAIN_VERSION` went 3.0.0 → 3.1.0.

Driving stage 1 is the cheapest thing that de-risks the most: every number in the revision-2 ram
model gets tuned against how the cars actually feel, so if the heavy-car speeds are wrong, the ram
numbers move with them.

## Decisions taken, that still bind

Recorded here because they were made across sessions and are easy to accidentally undo.

- **`globalScale` must be MEASURED, not derived** (stage 3 Task 4). Deriving revision 1's equivalent
  from arithmetic is exactly what shipped attackers flying backwards at 97% of top speed.
- **`hasKnock` gates on the lateral component against `DRIVE_CONFIG.stopEpsilon`, not exact zero.**
  Two earlier versions of that predicate were netcode bugs — one fired for every moving car, the next
  for ~30% of ticks on float residue. Its comment names both. Do not "simplify" it.
- **Edge-triggered contact must stay keyed off the `previous` set**, never off "is there an overlap
  now". Since stage 2's mass-weighted separation, a pinned pair holds a non-null MTV *every tick*, so
  an overlap-keyed trigger would fire continuously and reintroduce ram-locking.
- **The ram stats are `ramAttack`/`ramDefence`, never `attack`/`defence`.** `CarDef.attack` already
  exists and scales weapon damage; reusing it would couple ramming to gun damage.
- **The dash-substep fix is deferred to stage 5** by explicit user decision. A thunderclap dasher
  momentarily embeds up to 17.96u into what it hits (Mirage is the only chassis with a dash). Cause
  is substep granularity, not the mass split. Recorded at `DRIVE_CONFIG.dashSubstepMaxUnits` with a
  measured trade table.
- **Falloff (stage 3b) applies to the victim's impulse only**, not the attacker's — it exists to stop
  a victim being ram-locked, and discounting the attacker would make repeated ramming progressively
  safer for the aggressor.

## Open question, flagged not answered

**Telling a ram from a slam inside `contactTick`'s impulses loop.** Spec P24 makes falloff ram-only,
but `ImpulseEntry`'s map mixes both. `03b-ram-feel.md` infers the disambiguation from
`events.slams`. That inference is reasonable but it is the plan's, not the spec's — check it when
implementing rather than trusting it.

## Deferred findings

Real, non-blocking, each found once by a reviewer already. Fix opportunistically or in stage 5.

| # | finding |
|---|---|
| 1 | Frozen test fixtures hardcode 30 Hz as `0.5 ** (1 / (X * 30))` in `golden.test.ts`, `drive.test.ts` and `drive-vector.test.ts`. Self-consistent today, but the comments go stale when a netcode phase moves `TICK_RATE_HZ` to 60. |
| 2 | `DRIVE_CONFIG.steeringGrip`'s blend is only ever exercised at `1.0`, where it is indistinguishable from writing the new angle directly. Nothing pins the blend itself. |
| 3 | `packages/shared/tsconfig.json` excludes `**/*.test.ts`, so `tsc --noEmit` covers production files only; migrated test files are validated by vitest execution alone. |
| 4 | Two pre-existing TypeScript errors were fixed in stage 1 (`perception.ts`, `movement-hint.test.ts`) — noted because the *first* of them was aborting the typecheck chain and hiding 37 real errors. Watch for the pattern recurring. |
| 5 | Two `ram-bridge.test.ts` "no precedence" tests assert direction and non-zero-ness rather than the second knock's actual magnitude. |
| 6 | `docs/config-reference.md` claims the camera's trailing offset is "12% of the half-view"; the `smoothFollow` steady-state formula gives ~3.9% at 267 u/s. Predates this branch. |

## Housekeeping

- The branch has **not been pushed**. Push before switching machines — it is also the only backup.
- `.superpowers/sdd/` holds the working ledgers and is **gitignored**, so it does not travel. Everything
  from it that matters is in this file, the spec, the plan documents, or code comments.
