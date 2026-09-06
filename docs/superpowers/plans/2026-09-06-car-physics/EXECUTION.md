# Car Physics Rework — Execution State

**This is the state file. Read it before touching this work in any session.** It is updated in the
same commit as the work it describes, so a session can stop anywhere and the next one resumes
exactly. Same convention as the netcode rewrite's `EXECUTION.md`.

**Last updated:** 2026-09-07, after stage 3 (the ram contest) executed and its Task 4 review fixed.

---

## The one thing that will confuse you if you miss it

**The spec changed models mid-rework.** Stages 1 and 2 were executed against **revision 1**, which
derived ram outcomes from `mass` and made contact impulses equal and opposite. Measuring the result
showed every chassis is thrown backwards *faster than its own top speed* for landing a ram.

**Revision 2 removes `mass` from the game entirely** and replaces equal-and-opposite impulses with a
contest between each car's `ramAttack` and `ramDefence`.

**Stage 3 has now landed and replaced revision 1 with the contest.** `sim/ram.ts` and `sim/impulse.ts`
implement R1–R11 today; `mass` is gone from `packages/`. If you are reading an OLDER commit on this
branch (anything before `d29234b`) or diffing against `feature/car-physics-rework`, the note above
still explains why that code looks like it contradicts the current spec — it does, deliberately, for
history stages 1 and 2 were executed against. Read the spec's **Changelog** and **R1–R11** first
regardless; stage 3's own section below assumes you have.

---

## Where things stand

| | state |
|---|---|
| Branch | `claude/car-physics-stage-3-e06290` — fast-forwarded from `claude/car-physics-implementation-283ddf` at `925b788` (itself branched from `feature/car-physics-rework` at `02f5a89`) |
| Commits | 44 ahead of `development/main`; stage 3 alone is 7 (`925b788`..`7e5e1b4`) |
| Root `npm test` | GREEN |
| Root `npm run typecheck` | GREEN |
| Root `npm run build` | GREEN |
| Merged anywhere | **No.** Nothing has gone near `development/main`. |
| Played by a human | **No.** See "What has never been verified". |

| stage | plan | state |
|---|---|---|
| 1 | `01-vector-drive.md` | **Executed** (18 commits), against revision 1. Fully survives revision 2. |
| 2 | `02-contact-and-impulse.md` | **Executed** (9 commits), against revision 1. Plumbing survives; the mass-derived and equal-and-opposite parts are superseded. |
| 3 | `03-ram.md` | **Executed** (7 commits, `d29234b`..`7e5e1b4`), against revision 2. `mass` is gone from `packages/`; the ram contest (R1–R11) is what ships today. One exit criterion is NOT met — see "Stage 3's exit criterion... is NOT met" below, escalated to the user rather than fixed here. |
| 3b | `03b-ram-feel.md` | Written. Not started. ← next |
| 4 | `04-impulse-def.md` | Revised for revision 2. Not started. |
| 5 | `05-tune-and-reconcile.md` | Revised for revision 2. Not started. |

The 5 commits before `925b788` (`febd7b8`..`2c7f235`) are the redesign and replan — no code changed
in them. Stage 3 ran as four tasks (`d29234b` add the ratings, `49c9ec4` freeze `minApproachSpeed`
until the contest lands, `ac1fc5d`/`befc009` resolve rams as the contest and fix its review findings,
`625e38d`/`843e5bb` scale impulses by `ramDefence` and delete `reactionOf` and fix ITS review
findings, `7e5e1b4` remove `mass` and wire the bridge) plus this doc's own fix-round commit for
Task 4's review.

## What stage 3 actually changed

- **`mass` is gone from the game entirely.** `CarDef.mass`, `massOf`, `massPerRating`,
  `REFERENCE_MASS_RATING`, `resolveRamReferenceMass`, `resolveRamReference`, `RAM_REFERENCE_MASS`,
  `RAM_REFERENCE` and the `ramReference()`/`ramReferenceMass()` helpers are all deleted — not deprecated,
  not left as unread fields. `mass` does not appear anywhere in `packages/`.
- **Ramming resolves as a contest (R1–R7).** Each car brings a `push` — `ramAttack × driveIn` plus a
  `ramDefence`-scaled standing term (`pushOf`) — and what each car TAKES is the OTHER car's push,
  scaled by its own share of the contest and its own struck-face bonus, divided by its own
  `ramDefence` (`impactOn`). Both outcomes are computed independently: there is no `reactionOf` and no
  negation. `reactionOf` itself was deleted outright in stage 3 Task 3 (`625e38d`).
- **The status channel is `ramDefence`, not `ramMass`** (a pure rename — no `STATUS_TABLE` row
  authors it either way, so behaviour did not move).
- **`TickResult.approachVelocities`** (`Map<string, {vx, vy}>`) replaced `approachSpeeds`
  (`Map<string, number>`) — the pre-collision velocity cache the contest reads is now the whole
  vector, not a forward-only shim, cached in the same place (before `resolveWorld` runs each tick).
- **Two constants were MEASURED, not derived**, through the composed `serverTick` → `contactTick`
  order (`pipeline-order.test.ts`'s sequence), swept across 24 sub-tick phases per scenario:
  - `RAM_CONFIG.globalScale`: **1 → 0.4**. Headline measured outcomes (attacker at its own top speed
    against a parked victim): a Bastion flanking a parked Bullseye throws it 206.2 u/s (92% of its own
    top speed) and costs the Bastion 0.1 u/s; the roster maximum any ram writes is 268.0 u/s (Bastion
    rear-ending a parked Bullseye); the roster maximum any attacker pays the contest, across the five
    scenarios measured, is 39.3 u/s (Bullseye, hitting a much tankier Bastion nose-first at full
    closing speed — the head-on victim, Bastion, only takes 5.95 u/s there, since Bastion's larger
    push wins that contest despite being the car driven into. See `RAM_CONFIG.globalScale`'s doc
    comment in `ram-config.ts` for the full table and for which car `resolveRam` calls the attacker in
    each row, which is not always the one a plain-English description would name first).
  - `RAM_CONFIG.spinScale`: **100 → 10** (`spinMaxRate` left at **6.0**, unchanged — it is the target
    `spinScale` was solved against). The hardest ram the roster can produce (Bastion flanking a
    Bullseye at the 24 u lever-arm clamp) reaches 5.95 rad/s, 99% of the ceiling without pinning it.
    10 is a coincidence, not "100 divided by the ~10x inertia drop" — `globalScale` moved the impulse
    feeding the torque at the same time, in the opposite direction, so neither ratio alone predicts
    the answer.

## Resume here

**Stage 3b.** Execute `03b-ram-feel.md` with `superpowers:subagent-driven-development`. Its own
Task 4 no longer needs to re-pitch `spinScale`/`spinMaxRate` — stage 3 Task 4 already did that (see
above and the doc's own updated note) — so start from its Task 1 (`reeling`) and treat Task 4 as
"delete the five dead fields and pin the face bonuses" only.

## What survives revision 2, and what does not

Do not re-litigate these; they are settled and recorded in the spec.

**Survives** — build on it: the `vx`/`vy` velocity vector and everything in stage 1; wall deflection
and `restitution: 0.15`; the `Impulse` struct and its single-applier seam; edge-triggered contact;
`resolveWorld`'s fifth parameter and the `CarObstacle` plumbing (only the *stat* feeding it changes).

**Superseded, and gone as of stage 3**: `mass` and everything derived from it (`massOf`,
`massFactorMin`/`massFactorMax`, `ramReference*`); `reactionOf` and equal-and-opposite reactions;
the 0–1 severity grade. None of these names exist in `packages/` any more.

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

## Stage 3's exit criterion "the Bastion keeps moving forwards" is NOT met — escalated, not fixed

**This is the point of the whole stage, and `globalScale` cannot deliver it.** Measured, a Bastion
ends a full-speed dead-on flank ram at **-28.6 u/s** — still moving, but backwards, not forwards.

**Diagnosis.** Of that -28.6, **-28.5 comes from `resolveWorld`'s restitution reflection**
(`v' = v - (1+e)(v·n)n`, `e = DRIVE_CONFIG.restitution = 0.15`), which runs INSIDE `serverTick`,
BEFORE `contactTick` (and therefore the contest) ever sees the contact. Only **-0.1 u/s** is the
contest's own contribution. This is exactly **cause 1** from the design spec's Changelog —
`applyContact`'s restitution reflection treats another car as immovable geometry, mass-blind by
construction, so an attacker rebounds off a car it outweighs exactly as it would off a wall — and
**no clause in R1–R11 touches it**: R8 is explicit that it is "otherwise identical to P12" (only the
*positional* correction was reweighted by `ramDefence`, not the *velocity* reflection), and the
Changelog lists `restitution: 0.15` among what survives revision 2 unchanged. Stage 3 could only ever
remove the CONTEST's share of the attacker's cost — and it did, hard: revision 1's 156-271 u/s down to
a roster maximum of 39.3 u/s (see "What stage 3 actually changed" above) — but that share was never
where most of the backwards travel came from.

**Candidate fix, NOT taken here.** Scale a car-car contact's restitution response by the same
`shareOf(selfRamDefence, otherRamDefence)` that already weights the positional correction (R8) —
walls and obstacles untouched, since solidity has no meaning for something that cannot move. This
needs a new spec clause (nothing in R1-R11 authorizes touching `applyContact`) and falls under this
project's "stop and ask before changing the collision model" rule. **It is escalated to the user, not
implemented.** If it is taken later, note that `globalScale` was measured against a pipeline whose
attacker-side outcome is dominated by a term that fix would move — re-measure `globalScale` (and
re-check `spinScale`) against the new composed order rather than assuming either still holds.

## What has never been verified

**Nobody has driven any of this.** All 44 commits are gated by tests and arithmetic only.

- Stage 1's exit criteria 3 and 4, and all of stage 2's, are hands-on checks that remain unticked.
  Stage 3's own hands-on checks are unticked too, and one of them — see above — is now known to fail
  even once someone does drive it.
- `npm run playtest` has **not** been run since stage 1 began. Every probe measuring ramming,
  collision depth or prediction error reads code that has been rewritten three times now (revision 1's
  stage 2, then stage 3's contest). Compile breaks were fixed on the spot; **no threshold or
  expectation was changed** — those are the user's call and stage 5 owns them. Two probes carry the
  largest known drift, each flagged in place at the source:
  - `playtest/collision.ts`'s probe 1 ("Car-car tunneling") bounds a shove at `maxRamShove = 416 u/s`
    (`260 * 1.6`). The real roster maximum a ram can now write is **268.0 u/s** (measured, stage 3) —
    the bound is ~64% too high, so the probe reads MORE conservatively than the game actually behaves,
    not less; it can call a tunnel a FINDING for shoves the ram can no longer produce.
  - `playtest/ram.ts`'s trigger-rate floors (R1/R2) should be unaffected — a ram fires on contact and
    drive-in sign, which neither `globalScale` nor `spinScale` touches — but every KNOCK MAGNITUDE and
    every INJECTED SPIN this file observes moved with those two constants, R5 (ram-lock) included.
- Balance baselines from before this branch are not comparable: the config fingerprint moved, and
  `BOT_BRAIN_VERSION` went 3.0.0 → 3.1.0.

Driving stage 1 (and now stage 3) is the cheapest thing that de-risks the most: every number in the
ram model gets tuned against how the cars actually feel, so if the heavy-car speeds are wrong, the ram
numbers move with them — and the unmet exit criterion above is exactly the kind of thing that only
shows up by driving it.

## Decisions taken, that still bind

Recorded here because they were made across sessions and are easy to accidentally undo.

- **`globalScale` must be MEASURED, not derived — and it now HAS BEEN** (stage 3 Task 4, `7e5e1b4`):
  0.4, through the composed `serverTick` → `contactTick` order, `pipeline-order.test.ts`'s sequence,
  swept across 24 sub-tick phases per scenario. See "What stage 3 actually changed" above for the
  headline numbers, and the doc comment on `RAM_CONFIG.globalScale` in `ram-config.ts` for the full
  table. Deriving revision 1's equivalent from arithmetic instead is exactly what shipped attackers
  flying backwards at 97% of top speed — do not revert to deriving it on a future re-tune. If the
  restitution fix discussed above is ever taken, re-measure through the same composed order rather
  than assuming 0.4 still holds; the pipeline it was measured against changes underneath it.
- **`spinScale`/`spinMaxRate` are also measured, not derived** (stage 3 Task 4): `spinScale` 100 → 10,
  `spinMaxRate` left at 6.0 as the target the other value was solved against. `03b-ram-feel.md`'s
  Task 4 originally planned this re-pitch; it is done and that plan has been annotated accordingly —
  do not redo it there.
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
