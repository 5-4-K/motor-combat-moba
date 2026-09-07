# Car Physics Rework — Execution State

**This is the state file. Read it before touching this work in any session.** It is updated in the
same commit as the work it describes, so a session can stop anywhere and the next one resumes
exactly. Same convention as the netcode rewrite's `EXECUTION.md`.

**Last updated:** 2026-09-07, after the user drove the merged build for the first time. Earlier the
same day: stage 3b (`reeling` plus per-victim ram falloff) executed, its four task reviews fixed, its
stage-closing pass landed, and spec P21/P24 amended to the `refresh` semantics that actually ship.
**That drive is the most important line in this file** — it parked the restitution stage and made
stage 4 next.

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

**Stage 3b has landed on top of it**, giving ramming back the control loss stage 1 deleted, as the
`reeling` status plus a per-victim falloff stack — see "What stage 3b actually changed". The stage
after it is the approved restitution fix, which has no plan document yet.

---

## Where things stand

| | state |
|---|---|
| Branch | Stage 3b was executed on `claude/car-physics-rework-continue-1e0282`, which already carried stage 3 (executed on `claude/car-physics-stage-3-e06290`, fast-forwarded from `claude/car-physics-implementation-283ddf` at `925b788`, itself branched from `feature/car-physics-rework` at `02f5a89`). **Work on this line has been handed between branches before, so a branch name may no longer be where it lives.** The durable anchor is **`8608bd0`**, stage 3b's last code commit — if it is an ancestor of your HEAD, you have this state, plus the documentation-only commits that close the stage after it. If it is not (a squash-merge would do that), verify against this file's content rather than its SHAs, and treat every SHA below as historical. |
| Commits | 64 ahead of `development/main`. Stage 3b and its aftermath are the 14 commits after `1d6342e` (which itself only recorded two scoping decisions in this file): 10 for the stage, then the spec amendment, the first-drive state update, the `.superpowers/` ignore rule, and the `EXECUTED` banners on the plan documents. |
| Root `npm test` | GREEN |
| Root `npm run typecheck` | GREEN |
| Root `npm run build` | GREEN |
| Merged anywhere | **Into `feature/car-physics-rework`, yes** — the user fast-forwarded it there on 2026-09-07, so that branch now carries stages 1-3b complete. **Nothing has gone near `development/main`.** |
| Played by a human | **Partly, as of 2026-09-07 — and only just.** ~5 minutes on the merged `feature/car-physics-rework` build, checking **collision impact and restitution only**. Verdict: no problem with how collisions are working. **Nothing else was exercised** — not drive feel, not `reeling`, not falloff, not ram throw magnitudes. See "What has never been verified", which is still most of it. |

| stage | plan | state |
|---|---|---|
| 1 | `01-vector-drive.md` | **Executed** (18 commits), against revision 1. Fully survives revision 2. |
| 2 | `02-contact-and-impulse.md` | **Executed** (9 commits), against revision 1. Plumbing survives; the mass-derived and equal-and-opposite parts are superseded. |
| 3 | `03-ram.md` | **Executed** (11 commits, `d29234b`..`1ee4b53`), against revision 2, including four post-landing fix rounds (`12b400d`, `737a9d5`, the whole-branch review's fix commit `ff9a720`, and the documentation follow-up `1ee4b53`) on top of the original 7 (`d29234b`..`7e5e1b4`). `mass` is gone from `packages/`; the ram contest (R1–R11) is what ships today. One exit criterion reads as NOT met on the arithmetic — see "The restitution stage, and why it is parked" below. It was escalated rather than fixed here; the fix was approved on 2026-09-07 and parked the same day, after the user drove the build and found collisions fine. |
| 3b | `03b-ram-feel.md` | **Executed**, against revision 2, in 10 commits from `3468716` onwards. Four implementation commits (`3468716` add `reeling`, `376433d` the falloff stack, `223ad37` apply `reeling` scaled by falloff, `9fc030b` delete the five dead knobs and pin R6's ratio), one incidental fixture reseed (`c8cbc7d`), two documentation reconciliations (`a10e71c`, `6335ed0`), then the stage-closing pass: `8608bd0` sweeps eleven deferred review findings, and the documentation commits after it write this file and the two `CLAUDE.md`s. |
| — | *the restitution stage* | **PARKED on 2026-09-07, later the same day it was approved — by play, not by argument.** It was approved that morning and sequenced here; the user then drove the merged build and reported no problem with collision impact or restitution, which is precisely what this stage would have changed. Not cancelled and not refuted — understood, cheap, and waiting for a complaint that has not arrived. See "The restitution stage, and why it is parked" below for the measurement that closed it. **Do not start it without a fresh reason from play.** |
| 4 | `04-impulse-def.md` | Revised for revision 2. Not started. ← next |
| 5 | `05-tune-and-reconcile.md` | Revised for revision 2. Not started. |

The 5 commits before `925b788` (`febd7b8`..`2c7f235`) are the redesign and replan — no code changed
in them. Stage 3 ran as four tasks (`d29234b` add the ratings, `49c9ec4` freeze `minApproachSpeed`
until the contest lands, `ac1fc5d`/`befc009` resolve rams as the contest and fix its review findings,
`625e38d`/`843e5bb` scale impulses by `ramDefence` and delete `reactionOf` and fix ITS review
findings, `7e5e1b4` remove `mass` and wire the bridge) plus THREE fix-round commits on top of that:
`12b400d` and `737a9d5` fixed Task 4's own review findings (the second correcting an error the first
introduced — its own commit message records what was wrong and why), and `ff9a720` is a
whole-branch review pass across all nine — comments, a dead import, and one test file, plus the one
real code fix named below.

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

## What stage 3b actually changed

- **`reeling` is a new `STATUS_TABLE` row** (`packages/shared/src/config/status-config.ts`): a debuff
  carrying `modifiers: { turnRate: 0.4, accel: 0.4 }` and, deliberately, `flags: []`. It is the
  successor to the `authority` mechanic stage 1 deleted — between the vector-drive rework and this
  stage, a rammed car kept full steering, and now it does not.
  - **`flags: []` is load-bearing.** `StatusDef` forces flag-carrying rows to `reapply: "ignore"` so
    hard CC can never be chained; carrying none is what lets this row be `"refresh"` and accept a
    second, already-reduced duration at all.
  - **Both multipliers sit exactly AT the `STATUS_LIMITS` floors, on purpose** (spec P22). Do not
    lower the floors to make it harsher: `modifiersOf` clamps, so an authored value below the floor
    is silently discarded, and the floors are documented guarantees. Severity is capped; duration and
    the physics are the levers.
  - What `refresh` does NOT do, learned in the closing pass: `applyStatus` takes
    `Math.max(existing.endsTick, endsTick)`, so a re-ram landing while `reeling` is still running can
    only EXTEND the window. A falloff-scaled duration is by construction the smaller value and is
    discarded on that path. The scaled duration is what lands once the previous instance has lapsed
    but the falloff window has not. The impulse half of falloff has no such caveat.
- **Per-victim ram falloff** — `FalloffEntry`/`FalloffStack`/`newFalloffStack`/`nextFalloff`/
  `sweepFalloff` in `packages/server/src/sim/ram-bridge.ts`, plus `ContactMemory.falloff`. Per victim
  and **global across attackers** (three cars taking turns is the exact case it defuses), a rolling
  window (each ram pushes the window out from itself, so protection cannot lapse under sustained
  pressure), multiplicative with a floor on each of its two channels, and **ram-only** — a slam does
  not participate and is not even counted into the stack.
  - **Server-side only, and deliberately NOT a schema field.** This is not an invariant-8 violation:
    `stepSim` never reads the stack. It is consumed once, at the moment a ram resolves, and what
    reaches the client is the already-scaled result — a velocity change and a `reeling` status with a
    concrete duration, both networked already. Same shape and same reasoning as `SlamRecord`.
- **`contactTick` applies `reeling` to ram victims**, with both the impulse magnitude and the status
  duration scaled by that victim's falloff, floored at `RAM_TICKS.durationFloor`.
  **Falloff scales the VICTIM's half only, never `entry.attackerImpulse`** — the attacker pays full
  cost for every punch, or chaining rams into a worn-down victim would get progressively safer for
  the aggressor. This is the decision already recorded under "Decisions taken, that still bind".
- **New `RAM_CONFIG` knobs**: `ramUncontrolMs` (1000), `drWindowMs` (2000), `durationDrScale` (0.5),
  `durationDrFloorMs` (150), `impulseDrScale` (0.5), `impulseDrFloor` (0.25). **`RAM_TICKS`** converts
  three of them to integer ticks once at module load, mirroring `SLAM_TICKS`/`WEAPON_TICKS`.
- **Five dead config fields deleted outright**: `RAM_CONFIG.authorityFloor`,
  `authorityHalfLifeSeconds`, `authorityEpsilon`, `shoveHalfLifeSeconds`, `shoveEpsilon`, along with
  `RamDecay.shove` and `RamDecay.authority`. They had TWO successors, not one — the three `authority`
  ones are `reeling`; the two `shove` ones are `DRIVE_CONFIG.impactGripDecel`. `SLAM_CONFIG`'s
  `victimAuthority` and `selfKeepFactor` survive, still inert, waiting on stage 4.
- **No re-tuning.** `globalScale`, `spinScale`, `spinMaxRate`, `defencePushScale` and the face bonuses
  are untouched by this stage; falloff and `reeling` do not move the first-ram magnitudes stage 3
  measured them against, which is exactly why the restitution stage was sequenced after this one.

## Resume here

**Stage 4** (`04-impulse-def.md`). The restitution stage that briefly sat here is parked — see the
stage table and "The restitution stage, and why it is parked" below. Do not pick it up without a
fresh reason from play.

Stage 4 inherits two things from 3b: `wildcharge`'s own `uncontrolTicks` (a slam's control-loss
duration is stage 4's to author — `contact.ts`'s slam branch still writes `0`), and the
`ImpulseEntry` `kind` discriminator named under "Open question" below.

**One deferred obligation the user set on 2026-09-07, which stage 5 inherits.** The hands-on exit
criteria for stage 3b — ram side-on and watch for a spin the victim can still shoot through, ram a
fleeing car versus one closing on you, chain three rams and check the third barely registers, wait
three seconds and check full strength returns, wildcharge and check the victim does NOT gain
`reeling` — **are impractical to reproduce by hand against a bot.** The user tried and said so. They
want them covered by playtest probes instead, and they want that probe-writing done **after the
physics rework is complete**, not piecemeal alongside it. So: do not write them now, and do not treat
3b's unticked hands-on boxes as something a session can close by driving. Existing coverage in
`packages/server/playtest/ram.ts` is R1-R5; **R5 (ram-lock) is the only one anywhere near this list**,
and it now measures a mechanic that has a countermeasure it does not know about. Nothing measures
`reeling` at all, the fleeing-versus-closing contrast, falloff window recovery, or the slam
exclusion. That is the gap the eventual probes fill.

## Two questions the user answered on 2026-09-07 — both binding

Both were escalated by the previous session (see the two sections below) and both now have an
answer. They are the user's decisions, not an agent's rulings: do not re-open either without asking.

- **The restitution fix was approved as its own stage after 3b — then PARKED the same day, by the
  same user, after driving it.** Both facts are real and the second supersedes the first: the
  approval was given on the arithmetic, and the drive that followed found nothing wrong with
  collision impact or restitution. **Do not treat the morning's approval as a standing mandate.** See
  "The restitution stage, and why it is parked" for the measurement that closed it and for the one
  complaint that should revive it. The conditions attached to the original approval still apply if it
  ever is revived — its own spec clause first, and a re-measurement of `RAM_CONFIG.globalScale` plus
  a re-check of `spinScale` through the composed `serverTick` -> `contactTick` order.
- **`npm run playtest` was NOT run, by decision.** The user declined for now: ramming moves again in
  3b, so anything measured beforehand goes stale immediately. **Do not run the probes and do not
  change a threshold** — that is still stage 5's job and the user's call. The two drifted bounds
  named under "What has never been verified" stay flagged in place, unchanged.

## What survives revision 2, and what does not

Do not re-litigate these; they are settled and recorded in the spec.

**Survives** — build on it: the `vx`/`vy` velocity vector and everything in stage 1; wall deflection
and `restitution: 0.15`; the `Impulse` struct and its single-applier seam; edge-triggered contact;
`resolveWorld`'s fifth parameter and the `CarObstacle` plumbing (only the *stat* feeding it changes).

**Superseded, and gone as of stage 3**: `mass` and everything derived from it (`massOf`,
`massFactorMin`/`massFactorMax`, `ramReference*`); `reactionOf` and equal-and-opposite reactions;
the 0–1 severity grade. None of these names exist in `packages/` any more.

## Per-machine setup

**Which branch.** The work lives on **`feature/car-physics-rework`** as of 2026-09-07 — that is the
one to check out. `claude/car-physics-rework-continue-1e0282` is the worktree branch stage 3b was
executed on and is an ancestor of it; treat it as historical. **`development/main` does not have any
of this**, and neither does `master`.

```bash
git checkout feature/car-physics-rework
npm install
npm run build -w @motor-combat-moba/shared
npm test
npm run typecheck
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

## The restitution stage, and why it is parked

**Read this before reviving the fix diagnosed below. It was approved on 2026-09-07 and parked the
same day, by play.**

The user drove the merged `feature/car-physics-rework` build for ~5 minutes, checking collision
impact and restitution specifically, and reported no problem with how collisions work. That is
exactly the behaviour this stage would have changed, so the stage lost its justification before it
started.

**What the criterion actually failed on.** "The Bastion keeps moving forwards" is phrased as a
binary, and it was evaluated by arithmetic against a build nobody had played. It came out false on
**−28.5 u/s** against a Bastion top speed of 190 — 15% of top speed, backwards, erased by that
chassis's own acceleration in about **0.2 seconds**. The previous session described that using
revision 1's language ("thrown backwards for landing a ram"), but revision 1's number was **−184.5**,
near top speed. The contest had already removed 84% of the problem; what remained is a brief
bounce-back on contact, which is arguably what stage 2 deliberately built when it made a car-to-car
contact "read as a bounce." Changing the collision model to satisfy the sentence would not have been
fixing a symptom.

**What the investigation did establish, which is true regardless and should not be re-derived.**
Measured through `resolveWorld` alone (the attacker's velocity in, and out, before `contactTick`'s
contest sees the pair):

| case | vx in | vx out |
|---|---|---|
| Bastion → Bullseye, **head-on** | 190.0 | −28.5 |
| Bastion → Bullseye, **flank** | 190.0 | −28.5 |
| Bastion → Bullseye, **rear-end** | 190.0 | −28.5 |
| Bastion → **Bastion**, flank (equal `ramDefence`) | 190.0 | −28.5 |
| Bastion → **a concrete wall** | 190.0 | −28.5 |
| Bullseye → Bastion, flank | 223.0 | −33.4 |
| Bullseye → **a concrete wall** | 223.0 | −33.4 |

The expression collapses to **`v_out = −restitution × v_in`**. The attacker's exit velocity is a
single global bounce coefficient on its own entry speed and **nothing else is an input** — not the
struck face, not the victim's `ramDefence`, not the victim's motion, not whether the thing it hit is
even a car. The equal-`ramDefence` row is the one that proves the point: the term is not
*mis*-weighted by solidity, solidity does not enter it at all, so there is no ratio to correct — only
a factor to introduce. `shareOf` looks like it should already do this and does not: `resolveAgainst`
scales the MTV by `share`, then `applyContact` normalises that push to get the surface normal, which
annihilates the scalar. `shareOf` reaches position and is erased from velocity.

**The consequence to watch for in play, and the one complaint that should revive this stage.** Because
the term is face-blind and ~285× larger than the contest's contribution to the attacker's outcome, the
contest's face bonuses (`bonusFront` 0.3 / `bonusFlank` 1.0 / `bonusRear` 1.3, a 4.3× spread built
deliberately by R6) barely show on the attacker's side. **If someone reports that head-on, flank and
rear-end ramming all feel the same from the driver's seat, that is this.** Start from the table above.

**If it is revived**, the conditions from the original approval still stand: it needs its own spec
clause first (nothing in R1–R11 authorizes touching `applyContact`, and this project's "stop and ask
before changing the collision model" rule applies), and it obliges re-measuring `RAM_CONFIG.globalScale`
and re-checking `spinScale` through the composed `serverTick` → `contactTick` order, because both were
measured through a pipeline this term dominates. Note also that the obvious fix is not small in effect:
scaling the reflection by `shareOf(90, 30) = 0.25` leaves a Bastion still travelling ~135 u/s *into* the
victim rather than rebounding — ploughing through rather than bouncing, which reverses a stage-2
decision. That is a design question, not a coefficient.

---

## The original diagnosis, kept for the record

**Superseded by the section above as the reason to act; still correct as analysis.** Everything below
is the diagnosis that
earned it, kept verbatim as the record of WHY; it is not a live escalation any more, and nothing in
it should be re-derived. The criterion is still unmet in the code today.

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

**The fix — written here as a candidate, APPROVED on 2026-09-07 as its own stage.** Scale a car-car
contact's restitution response by the same
`shareOf(selfRamDefence, otherRamDefence)` that already weights the positional correction (R8) —
walls and obstacles untouched, since solidity has no meaning for something that cannot move. This
needs a new spec clause (nothing in R1-R11 authorizes touching `applyContact`) and falls under this
project's "stop and ask before changing the collision model" rule. **It was escalated to the user
rather than implemented, and the answer came back yes** — the ruling, including the re-measurement
obligation and why it is sequenced after 3b rather than before, is recorded once under "Two questions
the user answered on 2026-09-07" above and is not restated here. `globalScale` was measured against a
pipeline whose attacker-side outcome is dominated by the term that fix moves.

## What has never been verified

**Almost nobody has driven any of this.** As of 2026-09-07 the branch has had **one ~5-minute drive**
on the merged `feature/car-physics-rework` build, scoped deliberately to **collision impact and
restitution**, which came back clean and parked the restitution stage (see that section). Everything
else below is still gated by tests and arithmetic only — and "everything else" is drive feel, the
whole of 3b, and every ram magnitude.

**The hands-on criteria cannot be closed by more driving, and that is now a recorded decision.** The
user tried and found stage 3b's five checks impractical to reproduce by hand against a bot: you
cannot reliably make a bot flee at exactly your own speed, or take three clean rams inside two
seconds, or hold still for a fourth after a three-second pause. They are to be covered by **playtest
probes instead, written after the physics rework is complete** — not now, and not piecemeal. Until
then 3b's boxes stay unticked, and a session should not tick them by driving.

- Stage 1's exit criteria 3 and 4, and all of stage 2's, are hands-on checks that remain unticked.
  Stage 3's own hands-on checks are unticked too, and one of them — see above — is now known to fail
  even once someone does drive it. **Stage 3b's are unticked as well, and they are the ones a suite
  can least stand in for**: whether a 1000 ms `reeling` at 0.4/0.4 reads as "flung and fighting for
  grip" rather than as a stun, and whether the falloff curve actually stops a ram chain feeling like
  a lock, are feel questions no test in this repo can answer.
- `npm run playtest` has **not** been run since stage 1 began, and was **not** run for stage 3b
  either — by the user's explicit decision this session (recorded under "Two questions the user
  answered on 2026-09-07"), not by omission. Every probe measuring ramming, collision depth or
  prediction error reads code that has now been rewritten four times (revision 1's stage 2, stage 3's
  contest, then 3b). Compile breaks were fixed on the spot; **no threshold or expectation was
  changed** — those are the user's call and stage 5 owns them.
- **Stage 3b moved what the ram probes measure, in a way stage 3 did not.** Stage 3 changed the
  magnitude of a knock; 3b changed what a landed ram *does* — every ram now opens a control-loss
  window on its victim (`reeling`, up to 1000 ms), and a victim's second and later rams inside a
  2000 ms window land at a reduced impulse and a reduced duration. Anything in `playtest/ram.ts` that
  drives repeated contact and reads back a knock is now reading a *discounted* one, and nothing in
  the probes knows the falloff stack exists. Trigger rates should still be unaffected (a ram fires on
  contact and drive-in sign, which neither `reeling` nor falloff touches).
- Two probes carry the largest known drift from stage 3, each flagged in place at the source:
  - `playtest/collision.ts`'s probe 1 ("Car-car tunneling") bounds a shove at `maxRamShove = 416 u/s`
    (`260 * 1.6`). The real roster maximum a ram can now write is **268.0 u/s** (measured, stage 3) —
    the bound is ~64% too high, so the probe reads MORE conservatively than the game actually behaves,
    not less; it can call a tunnel a FINDING for shoves the ram can no longer produce.
  - `playtest/ram.ts`'s trigger-rate floors (R1/R2) should be unaffected — a ram fires on contact and
    drive-in sign, which neither `globalScale` nor `spinScale` touches — but every KNOCK MAGNITUDE and
    every INJECTED SPIN this file observes moved with those two constants, R5 (ram-lock) included.
    R5 in particular is now measuring a mechanic that has an actual countermeasure: stage 3b's
    falloff exists precisely to make repeated ramming stop reading as a lock, so whatever that probe
    reports next is a report on the new mechanic, not a re-run of the old measurement. Its
    expectation is stage 5's to reconsider, with the user, not an agent's to quietly retune.
- Balance baselines from before this branch are not comparable: the config fingerprint moved, and
  `BOT_BRAIN_VERSION` went 3.0.0 → 3.1.0.

Driving stage 1 (and now stages 3 and 3b) is the cheapest thing that de-risks the most: every number in the
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
  safer for the aggressor. **Shipped that way**, and commented at the write site in `ram-bridge.ts`.
- **`reeling` sits AT the `STATUS_LIMITS` floors and stays there** (stage 3b, spec P22). Do not widen
  a floor to make it harsher — `modifiersOf` clamps, so an authored value below the floor is silently
  discarded, and the floors are documented guarantees that stop guaranteeing the moment one row gets
  an exception. `status-config.ts` says so on the row; `docs/turn-tuning.md`'s tuning table says so to
  whoever reaches for the knob.
- **`reeling` must keep `flags: []`.** `StatusDef` forces a flag-carrying row to `reapply: "ignore"`,
  which would stop a second ram writing a duration at all and silently kill duration falloff. The
  helplessness is meant to come from the physics, not from a flag.

## Open question, ANSWERED in stage 3b — with one residual risk that is stage 4's to close

**Telling a ram from a slam inside `contactTick`'s impulses loop.** Spec P24 makes falloff ram-only,
but `ImpulseEntry`'s map mixes both. `03b-ram-feel.md` inferred the disambiguation from
`events.slams` — the plan's inference, not the spec's, so it was flagged for checking rather than
trusting.

**It was checked against `contact.ts`, ruled sound, and implemented**; a reviewer then independently
re-derived it from the same source. `resolvePair` resolves each PAIR as exactly one of dash/slam/ram,
so "this victim is in `events.slams`" is equivalent to "this victim's impulse entry came from the slam
branch". There is no third case.

**The residual risk, recorded rather than fixed.** `resolveContacts` keys its impulse map by VICTIM
across ALL pairs and keeps only the largest `impulse.speed`, so a car slammed by A and rammed by B on
the **same tick** has both competing for one slot. The slam wins — and the predicate is therefore
still right — only because `SLAM_CONFIG.knockSpeed` (520) exceeds the roster's hardest measured ram
(268 u/s). That ordering is an observed fact about today's tuning, not a structural guarantee:
`resolveContacts`'s own doc comment says outright that nothing enforces it (spec R9 forbids re-adding
the severity ceiling that once did).

**Which direction it fails, corrected.** An earlier version of this note (and of the code comment,
and of the stage-close report) said a retune would make `isRam` treat a slam victim as a ram victim.
That failure is impossible: `contact.ts`'s slam branch pushes to `events.slams` **unconditionally**,
before the `best` magnitude comparison it then runs, so a slam victim is in `slammedVictims` whichever
impulse wins the slot. The real failure is the mirror image — **a victim slammed by A *and* rammed by
B on the same tick, where the ram's `impulse.speed` wins the slot, gets a RAM impulse applied at full
strength with no falloff and no `reeling`**, because that victim is in `slammedVictims` from A's slam
and so is classified `isRam === false`. A ram that should have been diminished lands undiminished and
its victim keeps full steering. **The fix is a `kind` discriminator on `ImpulseEntry`** so the branch
reads the classification instead of inferring it. Stage 4 is its natural home: it is already the stage
that touches `ImpulseDef` and authors `wildcharge`'s own `uncontrolTicks`. The dependency is commented
in place at `ram-bridge.ts`'s `isRam` line. **Test for the corrected direction, not the old one.**

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
| 7 | `docs/schema-reference.md` still calls the ram bridge a "temporary shim". That is stage-1 wording which stage 2 superseded — the bridge routes every push through `Impulse` now. Left alone in 3b's closing pass as out of its scope. |
| 8 | The `ImpulseEntry` `kind` discriminator described under "Open question" above. Stage 4's natural home. |
| 9 | **`hasKnock` (`packages/server/src/sim/tick.ts`) still does not see a dead-on rear-end knock.** It tests `lateralOf`, `angVel` and `maneuver` only, so a silent or disconnected player rammed straight up the back freezes holding the knock instead of coasting it off. Stage 3b did NOT close this, contrary to what that function's comment used to claim — it only supplied the signal that could: `reeling` now marks every ram victim. Widening the predicate to read it is a **behaviour change** (it grows the set of silent-player ticks the server steps, which must stay in lockstep with what the client predicts), and `hasKnock` carries a recorded decision — two earlier versions of it were netcode bugs — so it is the user's call, not a fix-wave one. Candidate only. |
| ~~10~~ | **RESOLVED 2026-09-07 by the user: the SPEC was amended, the code stands.** P21 and P24 now record that `applyStatus` implements `refresh` as `Math.max(existing.endsTick, endsTick)` — the status-mechanism spec's **D4** rule (2026-08-29), "the clock is extended, never shortened", written so a weak short source cannot cut a long one down. Falloff's duration half wants exactly what D4 forbids, so the two cannot both hold, and D4 is what ships. Accepted rather than fixed because the measured difference is two ticks (~67 ms at the shipped knobs) in the victim's favour, P24's anti-lock goal is met by a different mechanism than the clause named (no ram after the first can re-arm a full window), and closing it properly needs a third `StatusReapply` mode — a status-system change reopening the interaction D4 exists to close. `durationDrScale`'s own doc comment now warns that it does less than it reads and names `impulseDrScale`/`ramUncontrolMs` as the levers to use instead. |

The eleven minor findings deferred out of stage 3b's four task reviews are **not** on this list: they
were all swept in the stage-closing pass (`8608bd0`) rather than carried. Two of them turned out to be
worth more than "minor" and are recorded above instead — the `refresh`/`Math.max` interaction under
"What stage 3b actually changed", and the slam-outranks-ram ordering under "Open question".

## Housekeeping

- **`feature/car-physics-rework` IS pushed** to `origin`
  (`git@github.com:5-4-K/motor-combat-moba.git`) and carries stages 1-3b, so a second machine can
  simply clone or fetch. Verify rather than assume before starting work — `git rev-parse
  origin/feature/car-physics-rework` against this file's own commit trail — because an earlier
  version of this note claimed the opposite for several stages and was wrong. **`development/main`
  and `master` on the remote have none of this.** If the branch ever is missing where you expect it,
  the answer is to move it across, never to re-implement from the plan documents: that produces a
  divergent second copy of finished work.
- `.superpowers/` held the working ledgers, task briefs and review packages for stages 1-3b. It is
  gitignored as of 2026-09-07 and never travelled between checkouts, so **assume it is absent** —
  every ledger was deleted when its stage finished. Treat any pointer to a file under it as dead
  rather than as something to chase. Everything from it that matters was written into the constants'
  own doc comments, into this file, or into the plan documents before it went.
- **The four executed plan documents carry `EXECUTED` banners as of 2026-09-07** and their unchecked
  `- [ ]` boxes are historical. `03b-ram-feel.md`'s banner additionally lists the passages in it that
  are known-wrong — a stale function name, a test helper that already exists, a fixture geometry that
  does not fire, and three too-short file lists. It was deliberately not retro-edited, so read the
  banner before following any step in it.
- **The plan documents are not the source of truth; this file and the code are.** Where a plan and
  the shipped code disagree, the code won and the disagreement is recorded rather than erased.
