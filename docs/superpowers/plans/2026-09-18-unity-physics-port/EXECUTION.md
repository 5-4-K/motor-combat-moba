# Unity Physics Port — Execution State

> **Read this first in any session that executes one of these plans**, before the stage plan itself.
> It is the state file: where the work got to, what was measured, and which task is in flight.
>
> **The update rule, which is the whole point of this file:** update it **in the same commit** as the
> work it describes. A task's commit ticks that task's checkboxes in its plan *and* moves the block
> below. Nothing here is written from memory at the end of a session — a session can stop at any
> moment, and the last commit must already say where it stopped.

**Status as of 2026-09-18: stage 1 (the drive model), stage 2 (walls and bumps) and stage 3 (rams)
have all landed.** The spec and all five stage plans were written first; stage 1's eight tasks,
stage 2's four tasks and stage 3's six tasks are all committed, on **`physics/stage2-and-3`** — a
worktree cut from `feature/movement` after the user merged stage 1 there. Stages 4-5 have not
started.

**Spec:** [`docs/superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`](../../specs/2026-09-18-unity-driving-and-ram-physics-port-design.md)
**Ledger:** [`interfaces.md`](interfaces.md) — outranks any one plan, is outranked by the spec.

## Starting a session

1. Read the in-flight block below. If it says *nothing in flight*, start at the first `Not started`
   row whose dependency is `Landed`.
2. **Verify it against git**, because this file is a claim and git is the fact:
   ```bash
   git log --oneline -8
   git status
   ```
3. Open that stage's plan and find the first unticked `- [ ]`. That is the resume point.
4. In a fresh worktree, `npm install` before the first build, or the build inlines the **main
   checkout's** shared `dist` and the server silently runs the wrong sim while every suite passes.

## In flight

**Nothing is in flight.** Stage 3 (rams) landed in full on 2026-09-18 — see "Stage 3 exit: measured
test state" below. Start stage 4 next; its dependency (stage 3) is now `Landed`.

Stage 1 landed (all eight tasks committed, `test(drive): pin tick-rate
independence; rebuild the guide` closing it) and a **whole-branch review of stage 1 has been swept**
— see below. **Stage 2 landed in full, on `physics/stage2-and-3`** — a worktree cut
from `feature/movement` after the user merged stage 1 there. Its four tasks: Task 1, restitution
0.15 → 0 (`59c5bcc` on this branch — the whole-branch-review section just below measured this same
change as `bb69f26`, the commit it carried on the abandoned branch this work was cut from before the
recut; treat the two hashes as the same content, not two different changes); Task 2, re-pinning the
contact expectations at zero restitution (`1dca2c7`); Task 3, re-measuring the spike self-trigger
(`c74f46e`); and Task 4, this tracker update. See "Stage 2 exit: measured test state" below for the
post-landing numbers.

### Stage 3 landed on 2026-09-18, all six tasks committed

Same branch, `physics/stage2-and-3`.

| Task | State | Commits |
|---|---|---|
| 1 — reshape `RAM_CONFIG` (and U40's frozen tick table) | Landed, reviewed, fixed | `def93c0`, `19af13a` |
| 2 — `sim/ram.ts`, the Unity classifier | Landed, reviewed, fixed | `612cb9c`, `f1353c3`, `597b14a` |
| 3 — `ContactEvents.rams` replaces the impulse map | Landed, reviewed clean | `f9039f9` |
| 4 — `reeling` redefined, `ramLock` added | Landed, reviewed clean | `cd2db73` |
| 5 — the bridge writes ram velocities directly | Landed, reviewed, fixed | `3b2c99b`, `4a93f6e` |
| 6 — close the stage | Landed (this commit) | — |

**The tree typechecks and builds clean, and the server is back to exactly the pre-existing
bot/balance baseline** — see "Stage 3 exit: measured test state" below. The mid-stage typecheck
break Tasks 3-4 left open (`contactCarsOf` missing `ramBlocked`, `ram-bridge.ts:329`'s `impulses`
destructure) was closed by Task 5, along with the wider RUNTIME breakage that break implied (67 red
across 10 files at its worst, not just the two typecheck errors — see the correction to ruling S3-c
in `.superpowers/sdd/03-rams/progress.md`).

`applyImpulse` has exactly one production caller left: the slam path in `ram-bridge.ts`
(`applyImpulse` import at line 5, call at line 565) — a stage exit criterion.

**Two rulings made during execution changed what a later task had to do, and they are repeated here
because their home is git-ignored.** The controller's full record — a pre-flight conflict scan,
thirteen rulings (S3-a through S3-m), and every per-task review outcome — is in
`.superpowers/sdd/03-rams/progress.md`, which `git clean -fdx` would destroy. The two structural ones:

- **Task 4 owns the whole of `docs/turn-tuning.md`, its derived table as well as its prose**, and
  absorbed Task 6's own Step 2a. Dropping `reeling`'s `turnRate: 0.4` breaks
  `scripts/turn-tuning-doc.test.mjs:280`, which computes a "Rate while reeling" row from
  `modifiersOf([...reeling]).turnRate` — the plan scopes that page to "prose only, its tables are
  stage 5's" and so assigns the breakage to nobody. The row becomes **"Grip while reeling"**,
  `DRIVE_CONFIG.lateralGripRate × STATUS_TABLE.reeling.grip` = 1.8 /s, with the doc test's helper
  updated to match. Swapping rather than deleting because stage 1 restored this row after it was
  deleted on a false premise: the guard — a `STATUS_TABLE` multiplier that reaches the drive model
  must be tabulated and tested — is still live, just through `grip` now. Task 6 re-swept the whole
  page for any remaining `turnRate`/`accel` sentence about `reeling` and found none — Task 4's sweep
  held.
- **Task 5's spin line is `player.angVel + side.spin * scales.impulseScale`, clamped, with no
  `replacesVelocity` branch.** The plan's sketch writes
  `(side.replacesVelocity ? 0 : player.angVel) + …`, which zeroes an attacker's spin and contradicts
  spec §7.2's "Spin unchanged" for the attacker and "neither spins" for a head-on. `replacesVelocity`
  is scoped to velocity by its own doc comment. Since `spin` is 0 in both those cases, dropping the
  branch is both simpler and spec-correct. Pinned by a test that fails under the brief's version
  (`ram-bridge.test.ts:1000-1008` gives the attacker 1.5 rad/s and asserts 1.5 out).

**Task 6 also restored the `angVel` round-trip coverage stage 1 could not keep**
(`packages/server/src/sim/tick.test.ts`'s "carries angVel/vx/vy through bodyOf -> stepDrive ->
writeBody" case): it now runs under a `reeling`-shaped `Modifiers` map rather than `NO_EFFECTS`, so
the round trip reaches the `spinFree` branch `nextSpinOf` lives behind, and asserts the injected
`angVel` (2) decays to exactly `2 * chassis.spinPerTick` rather than being zeroed. This is the
coverage stage 1 Task 8's comment promised would come back once stage 3 wired `spinFree` onto a real
status — it now has, and the comment is rewritten to say so rather than to promise it.

### Stage 1's whole-branch review, swept 2026-09-18

Two Critical findings and seven of lesser severity, fixed in one wave on top of `bb69f26`. The two
that change shipped behaviour:

- **`stepHold` double-counted steering yaw** (`sim/drive.ts`). Under U16 steering SETS `angVel`, and
  the branch kept the pre-port `steer * turnRate * mods.turnRate + body.angVel`, so a held car turned
  at twice its rate for the whole hold and kept turning after the key was released or while
  `steeringLocked`. Reachable via `lance`, a ~2.2 s `holdsDuringFire` beam. It also rebuilt its
  imposed slide at the NEW angle (the "on rails" behaviour this port deletes) and ignored `fullStop`.
  The coverage hole was that every HOLD case entered with `angVel: 0`, where the two yaw rules are
  the same arithmetic; six cases were added that enter one already turning.
- **The server's silent-player coast** (`server/src/sim/tick.ts`), replaced with an elapsed-silence
  gate. See the two rows under "Deferred, and who owns it" below for the detail and the consequences.

The rest were documentation and coverage: the fired `steeringGrip` trip-wires in the bot's
`planner.ts`/`objectives.ts` (re-derivation still owed, still stage 5 Task 8 Step 1 — no weight
moved); the "Rate while reeling" guard restored to `docs/turn-tuning.md` and its doc test, deleted on
a false premise; the `accel` channel's real behaviour written down (it scales the drag exponent too,
so it cancels out of top speed and stretches the time constant in BOTH directions — `reeling`'s 0.4
makes a ram's own knockback carry 2.5x further, 368 u); `channels.test.ts` proving `grip` properly and
naming `spinFree`/`ramBlocked` as declared ahead of use; and the spec's Changelog, slip formula and
`ChassisDrive` field count.

**Measured test state after the sweep** (root `npm run build`, `npm test`, `npm run test:scripts`,
all from the repo root):

- **shared green** — 54 files, 981 passed, 6 skipped (up 11 from stage 1's exit: the new HOLD-yaw
  cases and the `grip` channel proof).
- **client green** — 69 files, 1019 passed, 5 skipped. Unchanged.
- **`npm run test:scripts`: 1 red of 155** — `manual-page.test.mjs`'s stale-guide fingerprint, which
  stage 2's rebuild owns. Its computed stamp is `104b5f3c9e9fa7a6` **before and after this wave**, so
  nothing here moved `balanceStamp`; the sweep changed comments and prose only.
- **server: 16 red of 711** — the same count as stage 1's exit and the **same 16 cases as this wave's
  own starting point (`bb69f26`)**. Nothing moved: the four bot suites below (`predict.test.ts` 9,
  `controller.test.ts` 2, `planner.test.ts` 2, `tiers.test.ts` 2), plus `pipeline-order.test.ts`'s
  "charges the attacker with restitution AND its own contest impulse, not the reflection alone".
- **The composition differs from stage 1's exit by one swap, and neither half of it is this wave's.**
  `balance/match.test.ts`'s seed-1 ranking tie is **green again** at `bb69f26` and stayed green;
  `pipeline-order.test.ts`'s attacker-restitution case went **red** in that same commit (stage 2's
  restitution → 0), and stage 2 owns it. Measured red at `bb69f26` before any of this wave ran.

### Stage 2 exit: measured test state (Tasks 3-4, 2026-09-18)

`npm run build` and `npm test` (root), then `npm run test:scripts` (root) separately — the combined
`npm test` script chains `&&`, so the server workspace's expected-red exit stops it before
`test:scripts` runs; that is a property of the chain, not a new failure. All three from the repo
root, against this stage's final commit:

- **shared: green.** 54 files, 981 passed, 6 skipped — unchanged from the whole-branch-review wave
  above.
- **client: green.** 69 files, 1019 passed, 5 skipped — unchanged.
- **`npm run test:scripts`: green.** 39 suites, 155 tests, 153 passed, 2 skipped, 0 failed — an
  improvement over the whole-branch-review wave's 1 red, not something Tasks 3-4 did: Task 2
  (`1dca2c7`) rebuilt `manual.html` and closed `manual-page.test.mjs`'s stale-fingerprint case before
  Task 3 started. Tasks 3-4 touched no table the stamp hashes, so they owed nothing here and kept it
  green.
- **server: 15 red of 711**, a **different count from the whole-branch-review wave's 16** — Task 2
  (`1dca2c7`, already landed before Task 3 started) re-pinned `pipeline-order.test.ts`'s
  attacker-restitution case, so it is green again here; that happened before this dispatch and is not
  something Tasks 3-4 did. All 15 are the same cases named in this dispatch's stated baseline, in the
  same five files:

  | Suite | Red count | Cases |
  |---|---|---|
  | `src/bot/brain/predict.test.ts` | 9 | same nine as the whole-branch-review wave |
  | `src/bot/brain/controller.test.ts` | 2 | both G12 |
  | `src/bot/brain/planner.test.ts` | 1 | R-P16 (this wave's other planner case, R-P7, is green here — a second consequence of the same re-pin) |
  | `src/bot/brain/tiers.test.ts` | 2 | H25, and S13 evade |
  | `balance/match.test.ts` | 1 | the seed-1 ranking tie, a legitimate outcome its own reseed history already describes |

  Tasks 3-4 touched no production code — `docs/combat-model.md`, the root `CLAUDE.md` and this file
  only — so an unchanged bot/balance baseline is exactly the expected outcome. Stage 5's `bot-tuner`
  pass still owns all five files; nothing here re-pins any of them.
- **The energy-gain sweep (scenario 7) and the glancing-sign-flip sweep (scenario 8) in
  `packages/server/playtest/collision.ts` both still typecheck** (`playtest/tsconfig.json`, part of
  `npm run typecheck` inside `npm test`) and still run — see the deferred note below for what
  scenario 8 no longer measures now that stage 2 has landed.

### Stage 3 exit: measured test state (Task 6, 2026-09-18)

`npm run build`, `npm run typecheck`, `npm test` and `npm run test:scripts` all from the repo root,
against this task's own closing commit (`npm test` chains shared → typecheck → `test --workspaces` →
`test:scripts` with `&&`, so the server workspace's expected-red exit stops that chain before
`test:scripts` runs — `test:scripts` and the client suite were run as their own commands to see past
it, exactly as stage 2's exit note above records):

- **`npm run build`: clean.** Shared, then server (`tsup`), then client (`vite build`).
- **`npm run typecheck`: clean.** All three workspaces, including `playtest/tsconfig.json` and
  `balance/tsconfig.json` inside the server workspace's script — the two errors Task 5 owed
  (`contactCarsOf`'s missing `ramBlocked`, `ram-bridge.ts:329`'s dead `impulses` destructure) are
  both gone.
- **shared: green.** 54 files, 991 passed, 6 skipped — unchanged from stage 2's exit; Task 4's
  `reeling`/`ramLock` work and Task 2's classifier both landed inside this count already.
- **client: green.** 69 files, 1019 passed, 5 skipped — unchanged.
- **`npm run test:scripts`: green.** 39 suites, 155 tests, 153 passed, 2 skipped, 0 failed —
  `scripts/turn-tuning-doc.test.mjs` included, against Task 4's "Grip while reeling" row.
- **server: 15 red of 725, in exactly the five pre-existing files, same cases as stage 2's exit —
  the stage-closing target, hit exactly:**

  | Suite | Red count | Cases |
  |---|---|---|
  | `src/bot/brain/predict.test.ts` | 9 | same nine as stage 2's exit |
  | `src/bot/brain/controller.test.ts` | 2 | both G12 |
  | `src/bot/brain/planner.test.ts` | 1 | R-P16 |
  | `src/bot/brain/tiers.test.ts` | 2 | H25, and S13 evade |
  | `balance/match.test.ts` | 1 | the seed-1 ranking tie |

  Stage 3 touched `sim/ram.ts`, `sim/contact.ts`, `sim/impulse.ts`, the ram/status/drive config
  files, `ram-bridge.ts` and `tick.test.ts` — no bot brain file and no balance seed — so an unchanged
  baseline is the expected outcome, not a coincidence. Stage 5's `bot-tuner` pass still owns all five
  files.
- **`applyImpulse` has exactly one production caller** (`grep -rn "applyImpulse" packages/server/src
  | grep -v test`): `ram-bridge.ts`'s slam path (import at line 5, call at line 565) — a stage exit
  criterion, met.
- **`packages/server/src/sim/tick.test.ts`'s angVel round-trip case is restored**, not just re-pinned
  (see Task 6's own paragraph above): 51/51 tests pass in that file.

## Stages

| # | Plan | State | Gate |
|---|---|---|---|
| 1 | [`01-drive-model.md`](01-drive-model.md) | **Landed** | Asymptotic top speed; measurable slip angle; `stepDrive` reads no module-level rate; 30/60 Hz equivalence test green |
| 2 | [`02-walls-and-bumps.md`](02-walls-and-bumps.md) | **Landed** | Restitution 0; a car slides along a wall and never gains speed; the spike self-trigger re-measured |
| 3 | [`03-rams.md`](03-rams.md) | **Landed** | Attacker stops and locks; victim flung, spun, reeling; head-on stops both; `applyImpulse` has one production caller |
| 4 | [`04-slam-and-effects.md`](04-slam-and-effects.md) | Not started | `wildcharge` still clearly harder than the best ordinary ram; `ramLock` published to players |
| 5 | [`05-tune-and-reconcile.md`](05-tune-and-reconcile.md) | Not started | Playground pass done with the user; probes honest; fresh balance baseline; docs true |

## What is known before any of it runs

- **CORRECTED by stage 1 Task 8 (2026-09-18): the "three already-red tests" list immediately below
  was stale on arrival and is history, not a baseline to re-derive from.** A stage 1 task checked out
  the pre-work commit (`139f6a1`) directly and confirmed only ONE of the three was actually red there
  — `src/bot/brain/controller.test.ts`'s OFF-AXIS case. The other two were GREEN at `139f6a1`:
  `tiers.test.ts` P49 and `balance/match.test.ts`'s deathmatch-clock canary. The original claim (kept
  verbatim below for the record, struck through in spirit) named the wrong pair as already-red; do
  not cite it as this port's starting point. See "Stage 1 exit: measured test state" below for what
  is red now, which is a different list again — the drive model moved the bot (as expected) and, not
  originally expected, moved `balance/match.test.ts` back into a tie at its currently-pinned seed.

  ~~Three tests are already red on this branch, measured on 2026-09-18 at `139f6a1`, before any of
  this work ran:~~

  | Suite | Failing case |
  |---|---|
  | `src/bot/brain/controller.test.ts` | "keeps the body on the aim line when the target is OFF-AXIS" |
  | `src/bot/brain/tiers.test.ts` | P49, "hard fires at its preferred range rather than parking and weaving" — **was actually green at `139f6a1`** |
  | `balance/match.test.ts` | "shortening matchSeconds still lets the deathmatch clock fire, so a winner can appear" — **was actually green at `139f6a1`** |

  Everything else passes: 985 shared tests (53 files), 704 server (46 of 49 files), 69 client files.
  **Note this differs from the root `CLAUDE.md`, which names `tiers.test.ts` P50 as the third.** P50
  passes here; the deathmatch-clock canary is red instead. Trust this measurement over that prose.
  **This work does not fix any of them and must not silently re-pin them** — stage 5's `bot-tuner`
  pass is where the bot ones are addressed. Re-run and compare at the end of stage 5.
- **The worktree is wired correctly**: the server bundle inlines `// ../shared/dist/…`, not an
  escaped path, so `npm install` has already been run here.

### Stage 1 exit: measured test state (Task 8, 2026-09-18)

`npm install`, `npm run build` (root), `npm test` (root), `npm run test:scripts`, all from the repo
root, against this stage's final commit:

- **shared: green.** 54 files, 970 passed, 6 skipped (unrelated) — includes the new
  `sim/drive-rate.test.ts` (U7's 30-vs-60 Hz proof) and the six `tick.test.ts` re-pins' upstream
  fixtures.
- **client: green.** 69 files, 1019 passed, 5 skipped (unrelated).
- **`npm run test:scripts`: green.** 39 suites, 153 passed, 2 skipped (unrelated), 0 failed —
  includes `scripts/turn-tuning-doc.test.mjs` and `scripts/manual-page.test.mjs` (the rebuilt guide's
  fingerprint check).
- **server: 44 of 49 files green, 692 of 708 tests passed, 16 red — all 16 in five files:**

  | Suite | Red count | Cases |
  |---|---|---|
  | `src/bot/brain/predict.test.ts` | 9 | "carries a straight-line car forward, coasting off only slowly"; "curves a car that was observed turning, without any input"; "and the pre-rework scalar read would have been 76 units wrong — more than a car length"; "holds the observed speed, landing on the true path at every horizon and every speed"; "beats an engine-on rollout, worst of all where the target cannot move"; "holds a REVERSING car's speed, which zeroing the engine alone does not"; "beats a straight line wherever the target turns, and never loses where it does not"; "lets a sloppy read miss a curve entirely, and even read it backwards" (P20); "reads either side of the steering threshold, by how far the estimate falls short" (P20) |
  | `src/bot/brain/controller.test.ts` | 2 | "hunts a quadrant waypoint when it has never seen anyone, never the arena centre" (G12); "hunts toward a last-known pose, not the arena centre" (G12) — note the ORIGINALLY-red OFF-AXIS case is GREEN again at this stage's exit; the drive model moved which case fails, not just how many |
  | `src/bot/brain/planner.test.ts` | 2 | "finds a shot the arc SWEEPS through, not only the one it ends on" (R-P7); "does not let one out-of-arena candidate turn commitPenalty into a latch" (R-P16) |
  | `src/bot/brain/tiers.test.ts` | 2 | "hard changes course for an incoming shot and easy ignores it" (H25); "hard sidesteps an incoming shot compared to dodgeChance 0" (S13 evade) — note this is a DIFFERENT pair from the corrected pre-work baseline's P49, which is green again here |
  | `balance/match.test.ts` | 1 | "shortening matchSeconds still lets the deathmatch clock fire, so a winner can appear" |

  The first four rows are the bot-behaviour suites this stage's plan and brief both name as expected
  fallout (matches the Task 6/7 prediction of `predict.test.ts` 9, `controller.test.ts` 2,
  `planner.test.ts` 2, `tiers.test.ts` 2 exactly in count, though not case-for-case against the
  original pre-work baseline — see above). **Stage 5's `bot-tuner` pass owns all four; Task 8 did
  not re-pin any of them.**

  **`balance/match.test.ts` is a fifth, unnamed-by-the-brief red file, and worth flagging clearly:**
  its currently-pinned seed (1) comes back a legitimate 1-1 kills/deaths ranking TIE under the
  retuned drive model — `out.seats.some(s => s.kills > 0)` passes, only `out.winnerSessionId` is
  empty, exactly the failure SHAPE this exact test's own multi-paragraph reseed history has recorded
  and re-pinned around more than a dozen times before (every ram, bot and drive change that moved
  this one Mirage/Bastion matchup's dynamics has landed here). It is deterministic (re-run in
  isolation: same single case fails every time) and is not a clock defect — `hitClock` is never even
  reached because the kills line already tells the story. Re-seeding it (that file's own established
  fix) needs the same kind of seed sweep its history shows, which is balance-tuning work outside
  Task 8's file list (`tick.test.ts`, `drive-rate.test.ts`, `manual.html`, this file) and outside
  stage 1's plan. Left untouched and reported here rather than silently re-pinned or ignored — next
  to pick this up should either reseed it now (stage 1 did move its outcome) or fold it into stage
  5's tuning pass alongside the four bot suites above.
- **Every balance report from before this work is incomparable.** `configFingerprint` hashes
  `CAR_TABLE`, `DRIVE_CONFIG` and `RAM_CONFIG` whole; `BOT_BRAIN_VERSION` moves to `6.0.0` in stage 1.
- **`balanceStamp` does NOT hash `RAM_CONFIG`** but does hash `DRIVE_CONFIG`, the active `CAR_TABLE`
  rows, `STATUS_TABLE` and the guide's copy — so stages 1, 3 and 4 each owe `npm run build:manual`,
  and a ram-only retune does not.

## Measurements

Filled in as each stage lands. Each row is a number a later stage tunes against, so record the
command as well as the figure.

| What | Value | Measured in |
|---|---|---|
| Time to 90% of top speed, per chassis | Mirage 1.79 s, Bullseye 2.21 s, Bastion 2.59 s (`ln(10) / dragRate`) | stage 1 |
| Roll distance from top speed, per chassis | Mirage 147.1 u, Bullseye 152.3 u, Bastion 152.8 u (`maxSpeed / dragRate`) | stage 1 |
| Slip angle at full lock, per chassis (target ~35° at `lateralGripRate` 3.0) | Mirage 26.1°, Bullseye 23.6°, Bastion 21.2° — below the ~35° target because the formula is `atan(turnRate / (dragRate + lateralGripRate))`, not `atan(turnRate / lateralGripRate)` alone: each car's own `dragRate` adds to the sideways bleed, so a car with more `accel` corners tighter as a side effect (see `docs/turn-tuning.md#grip-and-drift`) | stage 1 |
| U7 30-vs-60 Hz equivalence, one second of full-lock turn+throttle on a synthetic `ChassisDrive` (`sim/drive-rate.test.ts`) | position delta 0.87 u (bound: `carWidth`/10 = 6 u); angle delta ~2.9e-15 rad (bit-exact — `turnRate * 1s` sums identically regardless of tick count); speed delta 0.0014 u/s. A same-length straight-line run (no steer) shows speed match to ~14 digits but a position delta of ~1.04 u — velocity is exactly rate-independent under the closed-form integrator, position is a first-order accumulation of it and is not, though it stays well inside the test's tolerance | stage 1 |
| How far a ram's shove carries a reeling victim (`grip: 0.6`, target ~2.2 car lengths) | **~79.8 u ≈ 1.33 car lengths, measured by stepping the reference ram below to rest** (`stepDrive` in a loop under `reeling`'s modifiers, `dt = 1/30`, until `hypot(vx, vy) < 1e-3`: 130 ticks). Well clear of the ~240 u (four car length) flag threshold. The 237.8 u/s shove lands entirely on the victim's LATERAL axis in this geometry (attacker approaches dead-on along the victim's side-normal), so it decays under BOTH factors `stepDrive` applies to that component, not grip alone: the whole-vector drag `dragRateOf('bullseye')` (1.0416 /s, step 2) **and then** the reeling-scaled lateral grip `DRIVE_CONFIG.lateralGripRate × STATUS_TABLE.reeling.grip` = 3.0 × 0.6 = 1.8 /s (step 3). The continuous approximation `v0 / (dragRate + gripRate)` = 237.8 / 2.8416 ≈ 83.7 u agrees with the stepped simulation to within discretisation error. **This is measurably short of the ~2.2-car-length figure this row's own placeholder named**: 132.1 u = 237.8 / 1.8 is exactly what grip ALONE would give, which is the number a reader gets by reasoning from `grip` in isolation — the placeholder's implicit assumption. Drag also acting on the lateral component (not just forward) is what `stepDrive`'s own doc comment calls "the drift"; stage 5 should read the shipped ~1.3, not the ~2.2 guess, when it pitches `grip` or `globalScale` | stage 3 |
| Settled speed into a wall, self-driven, vs `SPIKE_CONFIG.triggerSpeed` | Steady-state pre-collision inward speed (`stepDrive`/`resolveWorld` from built shared, restitution 0, sampled the way `contactTick`'s `speedIn` actually samples it — before that tick's bounce resolves): mirage 7.92 u/s, bullseye 5.41 u/s, bastion 3.97 u/s. All three sit well under the 25 u/s trigger, so the documented "pays once, on arrival" behaviour holds unchanged | stage 2 |
| Reference flank ram: shove and spin (Bastion → parked Bullseye) | **shove 237.8 u/s, spin 0.00 rad/s** — `resolveRam(a, b, "ffa")` with `a` (bastion) at its own top speed (135.9 u/s) approaching `b` (bullseye, parked, rotated 90°) dead-on through its centreline. Spin reads ~1.5e-16 (floating-point noise, i.e. exactly 0) because this geometry — attacker approaching along the exact midline of the victim's side face — puts the contact point dead-centre on the victim's hull, so `contactPointOn`'s lever arm is 0. This is the brief's own reference scenario, not a bug in it: it is the "clean, centred" flank hit, and it is a legitimate ~0 data point (an OFF-CENTRE flank hit spins much harder — see the `spinScale` deferred item below for two independent off-centre derivations, ~0.86-3.24 rad/s, that stage 5 should read alongside this one rather than instead of it) | stage 3 |
| `wildcharge` slam against the best ordinary ram | — | stage 4 |

## Deferred, and who owns it

- **`DRIVE_CONFIG.flipSteeringInReverse` is OFF from 2026-09-18, and the predicate behind it is the
  thing to fix before it goes back on.** A playtest at `baseTurnRate` 1.0005 / `turnRatePerRating`
  0.02535 found the car juddering for about a second after releasing the throttle mid-corner — most
  of the time on Mirage, sometimes on Bullseye, never on Bastion. Cause: `steerSenseOf` asks "am I
  reversing?" by reading the car-frame FORWARD component of velocity, which was the car's speed
  before this port welded nothing to the nose, and is now `speed * cos(slip)`. A corner that swings
  the nose past sideways drives it negative at speed, it then sits on the `-reverseEpsilon`
  threshold, and the steering sense inverts and reverts several times a second. Reproduced exactly:
  **Mirage 12 sense flips, Bullseye 6, Bastion 0.** The shipped turn rates clear it by only 5 u/s, so
  this is latent rather than absent there, and any handling buff walks into it.
  **Candidates tested and REJECTED — do not re-propose these without new evidence:**
  - *Raise `lateralGripRate`* (3 → 4 clears it): a 5% turn-rate nudge brings it straight back, and
    the grip needed always lands steady-state slip at ~30°, so it silently caps the drift dial.
  - *A reverse-only drag knob*: needs ~50/s against a normal drag of 1.28, is non-monotonic (more
    drag sometimes made it worse, because it parks the value ON the threshold), and at that strength
    it destroys real reversing.
  - *An alignment test* (`|lateral| < |forward|`): still 8 flips — a spin-out sweeps the velocity all
    the way round, so it passes through aligned-backwards anyway.
  - *A speed gate*: spin-out and genuine reverse occupy the same speed range, and at higher turn
    rates the ranges cross over entirely. **No threshold on velocity MAGNITUDE can work.**
  **The fix that does work is intent:** `throttle === -1 && forward < -reverseEpsilon`. Stateless, no
  schema change, measured clean on the spin-out and correct on a genuine reverse. Its one cost is
  that releasing reverse while still rolling backwards un-flips the sense once — today that case
  chatters 7 times, so it is an improvement either way. A latched variant removes even that, but the
  latch must BE the sense: keeping `forward < -reverseEpsilon` as a live per-tick term re-inherits the
  chatter (measured worse than stateless), and the latch needs a networked schema field to satisfy
  invariant 8.
  **Also noticed while measuring, and NOT a bug:** pressing reverse while sliding backwards
  accelerates you backwards instead of stopping you. That is the intended control scheme — one pedal
  per direction, each doubling as the other's brake — confirmed by the project owner. What is worth a
  look in the tuning pass is that the two directions do not stop equally hard: forward braking uses
  the authored `CarDef.brakeDecel`, backward braking uses ordinary forward engine thrust, which is
  1.4x weaker on Mirage, 2.1x on Bullseye and 2.4x on Bastion — and that backward figure is
  `topSpeed * dragRate`, so nobody ever chose it and it moves every time top speed is tuned.
- **RESOLVED at stage 3 — ram spin was completely inert; it is not any more.** (Was: "a rammed car
  does not tumble at all. Stage 3 owns it.") Task 4 set `RAM_CONFIG.reelingSpinDecayRate: 2.0` and put
  `spinFree` on `reeling`'s flags, so `chassis.spinPerTick` (`car-config.ts`) now resolves to
  `reelingSpinPerTick()` instead of the identity placeholder, and a rammed car's injected `angVel`
  decays for real instead of being overwritten to 0 on the next tick. `tick.test.ts`'s "zeroes a
  coasting car's angVel on its first stepped tick, and never rotates it" and `drive-vector.test.ts`'s
  "keeps its spin while spinFree and erases it the moment control returns" both still pass and both
  still correctly describe the DEFAULT (no-status) case, which is unchanged. The round-trip coverage
  this loss of fidelity had cost — proving `bodyOf` → `stepDrive` → `writeBody` carries a REAL decay,
  not just the identity — is what Task 6 restored in `tick.test.ts`'s "carries angVel/vx/vy..." case
  (see this file's Task 6 paragraph above).
- **`ramLock` is applied with `ram.attackerId` as its status source, which for a flank or rear ram is
  the LOCKED CAR ITSELF — so the slam path can cut a car's own lock short (controller ruling S3-l).**
  There is exactly one `expireStatusesFromSource` production call site (`ram-bridge.ts:648`), invoked
  with the attacker's own id, so a car that rams at tick T and lands a `wildcharge` slam before T+15
  clears its own `ramLock` early. No clause in the spec covers a status's source, so fixing it means
  inventing a rule; the implementer and reviewer both declined to invent one. **Owner: stage 4**,
  which owns the slam path and `ramLock`'s publication.
- **`RAM_CONFIG.spinScale: 0.3` is un-validated, not a checked starting point.** Two independent
  derivations agree it undershoots spec §9's "~4 rad/s on a typical flank ram": a 150 u/s
  mirage-on-mirage flank shove with a 10 u lever gives 0.857 rad/s (`inertiaRadiusSquared()` =
  433.33), and even a maximum-lever (30 u) hit at Mirage's 189 u/s top speed reaches only ~3.24. This
  task's own OWN reference ram (see the Measurements table) landed a THIRD data point at the opposite
  extreme — a dead-centre hit, lever arm 0, spin 0.00 — which is not a counter-example to the above,
  it is the geometry that makes `spinScale` irrelevant: any off-centre flank ram is where the constant
  matters, and every off-centre measurement taken so far reads low against the spec's target.
  **Owner: stage 5.**
- **`ramDefence` no longer compounds, and that is a real balance change, not comment rot.** It used to
  scale the speed-independent term a car brought *into* the contest AND divide the push it took under
  the pushOf/impactOn contest; under the Unity model it has one effect, on the receiving side only,
  in `shoveOf`'s divisor. The roster's 30-90 `ramDefence` spread is priced against an effect that no
  longer exists. **Owner: stage 5.**
- **`SLAM_CONFIG.spinScale: 12.5` is a NEW knob**, added by this stage's Task 2 (controller ruling
  S3-i). `applyImpulse` used to read `RAM_CONFIG.spinScale` for both the ram and the slam; this stage
  retuned that constant 12.5 → 0.3 for a formula of a different shape (the ram divides by
  `inertiaRadiusSquared()` alone; the slam divides by `ramDefence × inertiaRadiusSquared()`). Sharing
  it would have cut `wildcharge`'s slam spin to 1/41.7 silently — instead the slam kept the shipped
  12.5 verbatim on its own constant, so its spin is bit-identical across this stage.
  `SLAM_CONFIG` is not a `tuning.ts` root (`ROOTS` is car/drive/ram/combat/weapon), so this knob is
  **not** a playground slider today — the playground's `ram.spinScale` slider no longer reaches the
  slam at all, and stage 5's tunable-field checklist does not currently ask for one. **Owner: stages
  4 and 5** — 4 if the slam's spin needs a playground slider of its own, 5 when it re-pitches the
  ram's `spinScale` and needs to remember the slam no longer shares it.
- **Two deferred minors, both test-quality, neither behavioural:**
  - `pipeline-order.test.ts:74-90` asserts the composition of `serverTick` then `contactTick` rather
    than production's `runPipeline` ordering — a pre-existing hole, but this stage's rewritten header
    comment now overstates what the assertions reach.
  - `ram-bridge.test.ts:709-730` ("also shrinks the shove on a re-ram") is largely subsumed by the
    stronger §7.3 test at `:1146`, which pins the scaled value rather than asserting `second < first`.
- **A silent knocked player used to freeze holding 96% of the shove; that is FIXED, and the fix is a
  behaviour change stages 2-5 should know about.** `serverTick`'s coast gate was `hasKnock`, which
  read `lateralOf(vx, vy, angle)` against `stopEpsilon` on the premise that `steeringGrip` was 1.0 —
  a constant this port deletes — so a shove along the victim's own heading was invisible to it and a
  re-pinned `tick.test.ts` case measured the residual moving from 8.06 u/s to **287.423 u/s** across
  stage 1 (300 u/s shove, one tick of drag, then frozen). The whole-branch review replaced the
  predicate with elapsed silence (`NET_CONFIG.silentCoastGraceMs`, `hasMotionToResolve` in
  `sim/tick.ts`), because the client never steps a tick it did not send an input for and no property
  of the body can distinguish imposed motion from drift under this model. **Consequences for later
  stages:** the server now steps a genuinely-absent player's car to rest whatever pushed it, and
  `packages/server/playtest/collision.ts`'s scenarios 4 and 5 both measure that path and will report
  different numbers — their comments say so, and stage 5's probe-honesty task should re-read them.
- **`packages/server/playtest/ram.ts` measures the wrong thing for its "R3" case, and every shove
  figure in the file comes from a different formula than the one shipping.** `packages/server/playtest/ram.ts`
  stopped compiling on `minApproachSpeed` mid-stage; Task 5 made the one permitted fix — the compile
  break only, leaving thresholds and verdicts alone, per this stage's instruction not to touch the
  probes. `speedBeforeAndAfterResolve` ("R3. The fix: ram reads the carried-in speed, not the
  post-resolve rebound") asserts `rebounded = afterResolve < 0` — the attacker ending the contact
  tick travelling BACKWARDS — which was true of the old contest (a mass-blind restitution reflection)
  and is now **impossible under the Unity rule**: `oneWayResolution` (`sim/ram.ts`) sets the
  attacker's velocity to exactly 0 (`replacesVelocity: true`, zero shove), never negative, whenever a
  ram actually fires. So R3 will read `FINDING` for intended design, not a regression, the next time
  it runs. More broadly: this stage moved the trigger rule itself (nose-first above `minRamSpeed`,
  not "whoever drives in harder") and the shove/spin formulas underneath every OTHER probe in the
  file (`drivenRam`, the knock-magnitude and collision-depth cases), so their reported numbers come
  from a genuinely different physics than whatever a prior report recorded — likely wrong rather
  than merely stale. **`npm run playtest` is recommended at this stage's exit, and running it is the
  user's call** (root `CLAUDE.md`'s rule); deferring the run until stage 5 has re-pitched
  `globalScale`/`spinScale` against this stage's measured reference ram is the sensible order, so the
  probes are read once against numbers worth keeping rather than twice.
- **`packages/server/playtest/collision.ts`'s scenario 8, "Reported speed sign flip on a glancing
  wall contact" (`glancingSignFlip`), is now confirmed to sweep nothing — stage 2 has landed.**
  `predictedFlipDeg` (line 410) computes `atan(sqrt(DRIVE_CONFIG.restitution))`, which is `atan(0)` =
  0 degrees now that restitution is 0. The probe still only sweeps 5-45 degrees, so the one angle
  where the sign could flip sits at the sweep's boundary rather than inside it, and every angle it
  actually samples now reports the same (non-negative) sign — confirmed by re-running it against
  built shared, not just derived. It still compiles and still runs (it is exercised by
  `npm run typecheck`'s `playtest/tsconfig.json` pass inside `npm test`, and that stayed green), it
  just no longer measures the discontinuity it was written to catch. **Not fixed here** — Task 4 was
  told explicitly not to touch the probes, and stage 5 owns rethinking this one rather than re-aiming
  it.
- **`DRIVE_CONFIG.dashSubstepMaxUnits` 16 → 8**, inherited from the 2026-09-06 car-physics rework's
  stage 2. Untouched by this port; stage 5 judges it with the user.
- **`wildcharge.impulse.speed` (520) and `uncontrolMs` (1400)** were provisional before this work and
  still are. Stage 4 makes their doc comments true; stage 5 pitches the numbers.
- **The netcode rewrite's phase 1 plan is stale** — its fixtures still name `speed`, `shoveX`,
  `shoveY` and `authority`, deleted by the car-physics rework's stage 1. Not this work's to fix, but
  whoever starts that rewrite must refresh it against the model this port leaves behind.

## Decisions that bind

- The spec's §2 decisions U1–U11 were put to the user and answered. **Do not re-litigate them**, in
  particular: pure Unity drag (launch and roll are one number), drift replacing the "no wash" rule,
  diminishing returns kept, the slam keeping its own rules, and 30 Hz now.
- **Grip is two knobs, not Unity's one** (U10 as revised, spec §5): `DRIVE_CONFIG.lateralGripRate`
  3.0 is the driver's drift, and `reeling`'s `grip: 0.6` multiplier is how far a shove carries a
  victim. The user chose this over a Unity-faithful single rate after seeing that one number could
  not serve both. **There is no `gripless` flag** — an earlier draft of the spec had one.
- **Turn radius is uniform across the roster on purpose, for now** (~89.9 u on all three). The user
  was shown two spreads and chose to revisit it in stage 5's tuning pass. Do not widen it silently.
- **The frozen `RAM_TICKS` table is fixed in stage 3** (U40), so stage 5's ram duration sliders are
  live. It was a real bug predating this work, not something the port introduced.
- **This work supersedes the 2026-09-06 car-physics rework's stage 5 and its parked restitution
  stage.** Stage 5 of THIS plan set records that in the rework's own `EXECUTION.md`.
- Tuning is the user's call. An agent proposes numbers and measures them; it does not decide what the
  game should feel like.
