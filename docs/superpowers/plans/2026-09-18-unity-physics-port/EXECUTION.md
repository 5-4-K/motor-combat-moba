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

**Nothing is in flight.** Stage 4 (slam and effects) landed in full on 2026-09-19, all eight tasks
committed on `physics/stage2-and-3` — see "Stage 4 landed" and "Stage 4 exit: measured test state"
below. Start stage 5 next; its dependency (stage 4) is now `Landed`, and stage 5 inherits the
deferred items already on file (rulings **S3-p**, §7.4's `ramLock` argument, `spinScale`,
`ramDefence`'s changed effect, the `wildcharge.impulse` numbers, and the rest under "Deferred, and
who owns it") plus two more stage 4 added: the **`ramLock` status-source defect (controller ruling
S3-l / P5), explicitly moved from stage 4 to stage 5 by this commit**, and the playground call on
whether `wildcharge.impulse.speed` (520) still feels right now that `reeling` is a total loss of
control (spec §9.3).

Stage 3 (rams) landed in full on 2026-09-18 — see "Stage 3 exit: measured
test state" below — and a **whole-branch review of stages 2-3 has been swept**, one behavioural fix
(two rams on one victim in a tick lost a push) plus a documentation sweep; see "Stages 2-3
whole-branch review" below, and read controller ruling **S3-o** there before touching
`ram-bridge.ts`'s ram loop.

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

### Stages 2-3 whole-branch review, swept 2026-09-18

Ten task-scoped reviews had been clean; a review of the whole branch found what they structurally
could not — defects at the **seams between tasks**. One behavioural fix, the rest documentation.

**The behavioural one: two rams on one victim in a tick lost a push.** `applyRamResolution` ASSIGNED
each side's velocity from the same immutable `approachVelocities` entry, so a car named by two
`RamResolution`s in one tick was written twice from the same base and the second replaced the first.
`nextFalloff` still ran per shoved side, so the survivor was scaled: a victim rammed by two attackers
on one tick ended at `pre + 0.5 × shove_B`, **less than a single ram**, with A's push gone. Measured
on the new regression fixture: **123.75 u/s from two simultaneous rams against 356.4 u/s from one**;
it now reads 377.3 u/s. Spin was never affected — it read the live `player.angVel` and accumulated
correctly, which is what made the bug invisible in every existing test. Three `sim/contact.ts`
comments asserted the correct behaviour and were the stated justification for deleting the per-victim
`best` map; they now describe what ships.

**Controller ruling S3-o — the composition rule, and it is an implementation decision with no spec
backing.** A car can be an attacker in one resolution and a victim in another on the same tick (A
rams B while B rams C — `ramBlocked` comes from `statusMods`, computed before `serverTick`, so B is
not yet blocked). §7.2 answers what one ram does to one car and says nothing about this. The rule
adopted, and written into `flushRamWrites`' own doc comment so the next reader does not mistake it for
a ported Unity rule:

> Zero the base if **any** resolution for that car sets `replacesVelocity`, then add **every** shove.

It reads as the two statements composing — "your own ram stops you" and "the shove you took is
added". Falloff keeps its per-shoved-side behaviour (§7.3 is per victim and across attackers), so the
second push inside one tick is legitimately discounted; the sum is still more than one ram, which is
what `contact.ts` promises. The bridge accumulates into a `RamWrite` per car and `flushRamWrites`
lands it, which also means exactly one spin clamp per car per tick instead of one per resolution.

**The RULE is order-independent. The VELOCITY it produces is NOT** — read that distinction before
quoting either half. *Which* resolution is visited first cannot change how the pushes compose: a
replace anywhere zeroes the base, and addition commutes. It does change their MAGNITUDE, because
`nextFalloff` is a stateful counter — of two shoves landing on one car in one tick, the first visited
is scaled by 1 and the second by `RAM_CONFIG.impulseDrScale`. On this wave's own two-attacker
fixture, swapping the two resolutions moves the victim from **377.3 u/s** (`hypot(356.4, 123.75)`) to
**305.0** (`hypot(178.2, 247.5)` = 304.978; the re-review quoted 304.0 for this, which is the only
figure of its I could not reproduce — the two components, 356.4 and 247.5, are both measured). That
is the mechanic working, not a leak, and it is
**deterministic rather than arbitrary** because `resolveContacts` walks its pair loop over sorted
session ids. What the sequential write did before this fix was a different and worse thing: the
alphabetical order decided which pushes existed at all, not merely how they were weighted.

Two tests cover it in `ram-bridge.test.ts`, both verified red against `f404bb7`: two attackers
converging on one stationary victim, and the A-rams-B-rams-C composition. Note that the first test's
exact-composition pair (`expect(both.victim.vx).toBeCloseTo(aOnly.victim.vx)` and its `vy` partner,
`ram-bridge.test.ts:1116-1117`) pins the a-before-z VISIT ORDER — that is the falloff weighting
above, not the composition rule — so do not read it as evidence the order does not matter. See also
the coverage note under "Deferred, and who owns it".

The rest were documentation: `docs/combat-model.md`'s ram banner (it still named
`restitution: 0.15` and pointed at the deleted `pushOf`/`impactOn` as the current authority); five
places still saying ram spin decay is inert (`drive.ts` ×2 — the worst of them sitting on
`nextSpinOf` itself — `packages/shared/CLAUDE.md` ×2, `tick.test.ts`'s justification, and
`channels.test.ts`, which the review had not listed); `ram-config.ts`'s `durationDrScale` doc still
calling `reeling` `reapply: "refresh"`; the players' guide under-describing `reeling` (no `spinFree`
or `ramBlocked` wording, and the raw channel id `grip` printed at a player); `docs/turn-tuning.md`
owing a row for `RAM_CONFIG.reelingSpinDecayRate` and `ChassisDrive.spinPerTick`, with
`turn-tuning-doc.test.mjs` extended to recompute both; and `status-config.ts`'s `ramLock` comment
("a rammer stops, it does not slide") being false on a head-on, where both cars are replaced with a
small non-zero shove and slide at full grip.

Three findings were recorded rather than fixed — see "Deferred, and who owns it": ruling S3-p
(`reeling`'s `"ignore"` deletes `wildcharge`'s control loss), §7.4's unsound `ramLock` safety
argument, and the zero-restitution × edge-triggered-contact re-ram feel.

**Measured test state after the wave** (root `npm run build`, `npm test`, `npm run test:scripts`):
unchanged from stage 3's exit in every workspace, with the server at exactly the same 15 red across
the same five files. See the run recorded in that fix wave's commit message.

### Stage 4 landed on 2026-09-19, all eight tasks committed

Same branch, `physics/stage2-and-3`.

| Task | State | Commits |
|---|---|---|
| 1 — `ImpulseDef` declares its statuses, `SLAM_CONFIG` -> `IMPULSE_CONFIG` | Landed, reviewed, fixed | `5076476`..`790ad4b` |
| 2 — one contact event, and a real contact point | Landed, reviewed clean | `790ad4b`..`38db216` |
| 3 — the bridge applies what the row declared | Landed, reviewed clean | `38db216`..`7f3566c` |
| 4 — re-pitch `wildcharge`'s `ImpulseDef` against the new ram scale | Landed, reviewed clean | `7f3566c`..`636702f` |
| 5 — publish `ramLock` in the players' guide | Landed, reviewed clean | `636702f`..`af0222b` |
| 6 — the HUD status chips: verify, then pin what the verification found | Landed, reviewed, fixed | `af0222b`..`2d266ac` |
| 7 — make the impact spark agree with the new ram rule | Landed, reviewed, fixed | `2d266ac`..`34bf7f7` |
| 8 — rebuild the guide, verify the stage, update the tracker | Landed (this commit) | — |

The controller's full record — a pre-flight conflict scan against Tasks 1-8, twelve rulings
(P1-P12), and every per-task review outcome — is in `.superpowers/sdd/04-slam-and-effects/progress.md`,
which `git clean -fdx` would destroy. Seven of those rulings changed what shipped and are worth
repeating here because their home is git-ignored:

- **P2 — the word "slam" is renamed out of the sim seam, but `WEAPON_TABLE`'s authored
  `maneuver.slamsStunned` field stays.** `ContactCar.slamsStunned` became `pushesStunned` and
  `ram-bridge.ts`'s `slamsStunnedOf` became `pushesStunnedOf` (the sim seam, ~8 sites), but
  `def.maneuver.slamsStunned` (`weapon-types.ts:458`, `weapon-config.ts:458`,
  `weapon-config.test.ts:24`, `tuning-walker.ts:53`) is the project owner's authored config surface
  describing a genuinely slam-specific rule (O3), and no spec clause touches it. It is the one
  surviving "slam" in authored config, named explicitly rather than silently exempted. **Cost if
  wrong:** one field name, one commit to rename.
- **P5 — the `ramLock` status-source defect (stage 3's ruling S3-l) is deferred to stage 5, not
  fixed in stage 4, overriding this file's own line that had assigned it to stage 4** (now corrected
  in place under "Deferred, and who owns it"). No spec clause covers a status's source, so fixing it
  means inventing a rule stage 4's implementer and reviewer both declined to invent mid-restructure.
  **Cost if wrong:** a rare self-shortening of the rammer's own 500 ms lock survives one more stage.
- **P7 — exit criterion 8 permits past-tense history, and three such references ship.** The
  criterion bars a comment in `wildcharge.impulse` from arguing FROM deleted machinery
  (`SLAM_CONFIG`, `knockMaxSpeed`, the ram contest, `pushOf`, `impactOn`, `victimAuthority`,
  `selfKeepFactor`) — but the plan's own mandated replacement prose (Task 4) narrates the number's
  history in past tense ("it **was** authored as…", "then **orphaned** twice", "the ram contest
  that replaced it **was** open-ended", "carried across from the **deleted** `SLAM_CONFIG`"), which
  its sibling exit criterion 2 explicitly permits ("comments describing history"). Inspected the
  shipped text (`weapon-config.ts:467-469`, `:514`): every hit narrates that the thing is gone,
  none presents it as live authority. **Cost if wrong:** three history sentences, one edit to
  delete, with the history then living only in git.
- **P8 — the guide now publishes a weapon's `impulse.applies` as chips, so Wild Charge shows
  `Reeling 1.4s` for the first time.** The restructure makes a weapon's applied statuses
  declarative; Wild Charge's most consequential property — 1.4 s of total control loss under U31 —
  was invisible on its stat card while the Effects section already credited it, so the page
  contradicted itself. Guarded against double-crediting Wild Charge in the Effects "From" line
  (verified clean: `effectSources()`/`EFFECT_SOURCE_MAP` untouched, so the authored sentence alone
  renders there). **Cost if wrong:** one extra true chip on one weapon card, one edit to remove.
- **P9 — `EFFECT_SOURCES.reeling` IS tightened, overriding the plan's own claim (spec §8) that the
  line "stays true and needs no edit".** Under §7.2 the old wording ("Every ram, and Wild Charge's
  slam.") is false — a head-on is a ram type that reels nobody. Shipped wording: **"Any ram but a
  head-on, and Wild Charge's slam."** A players' guide stating something false outweighs a spec
  clause being one revision stale. **Cost if wrong:** one sentence of prose, one rebuild to revert.
- **P10 — the Reeling card reads "low grip", not "no grip". SUPERSEDED BY P13 below; neither wording
  ships.** The plan's own brief contradicted itself (code sample vs. prose);
  `STATUS_TABLE.reeling` carries `modifiers: { grip: 0.6 }` — grip is REDUCED to 60%, not removed —
  so "no grip" would have been false on a page players read. Both options turned out to be worse
  than the one already in the builder.
- **P13 — the Reeling card renders the generic channel word, reversing the visible half of P10.**
  The final whole-branch review found that the `low grip` special case P10 settled on **shadowed a
  more precise renderer that was already there**: the card read `traction −40%` before stage 4,
  `CHANNEL_WORDS.grip` had become dead code, and a `grip > 1` buff would have printed nothing at
  all. P10 chose between two hand-written phrasings without knowing a third, better option was being
  suppressed. The special case was reverted and the page rebuilt. Shipped:
  `Reeling — no control · no steering · spins freely · cannot ram · traction −40%` — flags
  worst-first, then the channel percentage, which is how every other status card on the page is
  ordered. **Cost if wrong:** one line in `scripts/build-cars-and-weapons.mjs` and a rebuild.
- **P12 — the camera shake reads the larger of the two `RamSide` magnitudes, not "the other car's"
  side.** The plan's selector (`s.sessionId !== self.sessionId`) and the controller's first-proposed
  fix (`s.sessionId !== ram.attackerId`) both read zero on a head-on, where each side's shove is
  cross-attributed from the OTHER car's speed rather than split into a clean shoved/unshoved pair.
  The implementer proved this empirically against `resolveRam`'s real output and shipped
  `Math.max` across both sides' shove magnitudes instead, which is the only one of the three
  selectors that passes for both a one-way ram and a head-on. **Cost if wrong:** camera-shake
  intensity alone, visual, no sim effect.

### Stage 4 exit: measured test state (Task 8, 2026-09-19)

`npm install`, `npm run build`, `npm run typecheck`, `npm test` (root; backgrounded past the 120 s
foreground timeout — the bot-brain suites alone run several minutes), then `npm run test:scripts`
and `npm test -w @motor-combat-moba/client` as their own commands (the combined `npm test` chains
`build -w shared && typecheck --workspaces && test --workspaces && test:scripts` with `&&`, so the
server workspace's expected-red exit stops that chain before `test:scripts` runs — the same property
stage 2's and stage 3's exit notes already record, not a new failure):

- **`npm install`: up to date**, 370 packages audited — pre-existing advisories only.
- **`npm run build`: clean.** Shared (`tsc`), server (`tsup` → `dist/index.js` 376.68 KB), client
  (`vite build`, 219 modules, built in 6.02s).
- **`npm run typecheck`: clean.** All three workspaces, including `playtest/tsconfig.json` and
  `balance/tsconfig.json` inside the server workspace's script.
- **shared: green.** 54 files, 999 passed, 6 skipped.
- **client: green.** 69 files, 1028 passed, 5 skipped — matches the stage's stated target exactly.
- **`npm run test:scripts`: green.** 39 suites, 155 tests, 153 passed, 2 skipped, 0 failed —
  includes `manual-page.test.mjs`'s stamp check against the freshly rebuilt page.
- **server: 15 red of 730, in exactly the five pre-existing files — the stage's stated target, hit
  exactly:**

  | Suite | Red count | Cases |
  |---|---|---|
  | `src/bot/brain/predict.test.ts` | 9 | same nine as stage 3's exit |
  | `src/bot/brain/controller.test.ts` | 2 | both G12 |
  | `src/bot/brain/planner.test.ts` | 1 | R-P16 |
  | `src/bot/brain/tiers.test.ts` | 2 | H25, and S13 evade |
  | `balance/match.test.ts` | 1 | the seed-1 ranking tie |

  Tasks 1-7 touched `sim/impulse.ts`, the weapon/ram/status config files, `ram-bridge.ts`, the
  players' guide, the HUD status test and the client's impact-feedback module — no bot brain file
  and no balance seed — so an unchanged baseline is the expected outcome. Stage 5's `bot-tuner`
  pass still owns all five files; this task re-pins none of them. **No 16th failure — nothing to
  report as a defect.**
- **`grep -n "shared/dist" packages/server/dist/index.js | head -3`** reads `// ../shared/dist/…`
  three times (`constants.js`, `net/input.js`, `net/lobby-messages.js`) — the correct inlined path,
  not an escaped worktree path.
- **`npm run check:art`: the same set stage 3 recorded.** Ten `check:weapons` warnings (`tremor`
  plus the nine `basic-attack-<carId>` rows, none of which has an icon yet), no blockers.
- **`npm run build:manual`, then `git diff --stat packages/client/public/manual.html`: no diff at
  all.** Task 5 already rebuilt the page against Task 4's final `WEAPON_TABLE` and the builder's
  `statusBlurb` change; nothing moved. No weapon stat cell moved, so no investigation was owed.

**The Measurements table's `wildcharge` row is now filled** (see the table above): the guard's bar
is `hardestOrdinaryRam()` = 259.91625 u/s (Mirage flanking Bullseye at Mirage's own top speed), and
`wildcharge.impulse.speed` (520) is 2.00× it, 3.33× a mirror-match flank (155.95), and 8.00× the
hardest ram once diminishing returns bottom out (64.98). Measured by `hardestOrdinaryRam()` in
`packages/shared/src/config/weapon-config.test.ts`, derived from live `RAM_CONFIG` + `CAR_TABLE`,
proven non-vacuous during Task 4 (a temporary `speed: 300` fails the guard with "expected 300 to be
greater than 389.874375"; `520` restored and confirmed in the committed diff).

**`wildcharge.impulse.speed` is still provisional, in the one respect arithmetic cannot settle.**
Under the redefined `reeling` (U31: `immobilised`, `steeringLocked`, `spinFree`, `ramBlocked`,
`grip: 0.6`, no lateral grip left to fight), a 520 u/s punt carries its victim into walls — and
often the spikes — far more reliably than the same number did under the old `turnRate: 0.4,
accel: 0.4` version of `reeling`, where the victim still steered. The number did not move this
stage; whether it should is the playground call, and that belongs to stage 5, with the user in the
loop.

**The guard over `wildcharge.impulse.speed`, and why it exists as a guard rather than a typed
number:** `weapon-config.test.ts` pins the RELATIONSHIP (1.5× `hardestOrdinaryRam()`), not the
number, because **`RAM_CONFIG` is not hashed by `balanceStamp`** — a retune of `globalScale` or
`flankScale` moves every ram in the game with no page rebuild and nothing else in the suite failing
to say so. The guard bites once `globalScale` passes roughly 0.667 (at which point
`hardestOrdinaryRam()` alone would clear 520 without `wildcharge` changing at all).

**The HUD needed no change at all, proven rather than asserted.** Task 6 confirmed the status strip
is fully table-driven: both new `STATUS_TABLE` rows (`reeling`, `ramLock`) render correctly with no
client source file modified. Two regression tests in `packages/client/src/scenes/status-hud.test.ts`
say why — "draws a badge for each straight off the table, with no client-side branch" (asserts
`badge.kind === STATUS_TABLE[id].kind`, not a hardcoded literal, so a per-status branch returning a
wrong hardcoded kind would fail it) and "never shows 0s on a live half-second lock" (pins
`ramLock`'s single-digit-second display over its whole 500 ms life).

### Stage 5 is next

It inherits every item already listed under "Deferred, and who owns it" below, plus two stage 4
added: the **`ramLock` status-source defect** (ruling P5, moved from stage 4 to stage 5 in this
commit — see the corrected entry below) and the **playground call on `wildcharge.impulse.speed`**
under the redefined `reeling` (this section, above). Stage 5 is the reconcile-and-tune stage; both
are design calls for the project owner, not arithmetic this stage could settle on its own.

## Stages

| # | Plan | State | Gate |
|---|---|---|---|
| 1 | [`01-drive-model.md`](01-drive-model.md) | **Landed** | Asymptotic top speed; measurable slip angle; `stepDrive` reads no module-level rate; 30/60 Hz equivalence test green |
| 2 | [`02-walls-and-bumps.md`](02-walls-and-bumps.md) | **Landed** | Restitution 0; a car slides along a wall and never gains speed; the spike self-trigger re-measured |
| 3 | [`03-rams.md`](03-rams.md) | **Landed** | Attacker stops and locks; victim flung, spun, reeling; head-on stops both; `applyImpulse` has one production caller |
| 4 | [`04-slam-and-effects.md`](04-slam-and-effects.md) | **Landed** | `wildcharge` still clearly harder than the best ordinary ram; `ramLock` published to players |
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
| `wildcharge` slam against the best ordinary ram | **`hardestOrdinaryRam()` = 259.91625 u/s**, produced by Mirage flanking Bullseye at Mirage's own top speed (`forwardMaxSpeedOf("mirage")` × `RAM_CONFIG.flankScale` × `RAM_CONFIG.globalScale` × `ramAttackOf("mirage")` / `ramDefenceOf("bullseye")` = 189.03 × 1.5 × 0.5 × 55/30). `wildcharge.impulse.speed` (520) is **2.00×** that, 3.33× a mirror-match flank (155.95, 156.0 in the row's own rounded prose), and 8.00× the hardest ram once diminishing returns bottom out at `impulseDrFloor` (64.98, 64.979 unrounded) | stage 4 |

## Deferred, and who owns it

- **A ram landed by a REMOTE car never sparks or shakes on your screen, and no velocity the client
  can reach fixes it.** `packages/client/src/scenes/ArenaScene.ts` (the `impactCars` assembly) →
  `scenes/impact-feedback.ts`'s `freshImpacts` → shared `resolveRam`. Stage 4's final fix wave
  corrected the LOCAL half of this — the local car is now given `predictedPrev`'s tick-entry
  velocity instead of the rendered, post-`resolveWorld` one, taking a nose-first drive-in from 11 of
  40 sub-tick phases sparking to 40 of 40 — and deliberately left the remote half alone, because it
  is not a wiring mistake. A remote's pose is interpolated `NET_CONFIG.interpolationDelayMs` in the
  past, so by the time its POSITION is drawn at contact, every patch the buffer holds already
  describes the resolved ram: spec §7.2 stops the attacker dead, so it is published at zero velocity
  (`replacesVelocity` with a zero shove), and it is wearing `ramLock`, whose `ramBlocked` flag
  `resolveRam` refuses on the attacker side regardless of velocity. Measured over the same 40
  sub-tick phases with a 20 Hz patch model: **0 of 40 spark**, and feeding the older interpolation
  bracket's velocity instead recovers only 18 of 40 — and the status gate would still veto those.
  **What a player sees:** ramming someone yourself flashes and shakes correctly; being rammed by
  **any other car** does neither — this is a property of not being the local car, so a practice or
  playground BOT ramming you is just as silent as a remote human — and the only feedback is the knock
  itself arriving a round trip later. Note also that the client reads `ramBlocked` from
  `modifiersFromRows(player.statuses, room.state.tick)`, i.e. the newest patched tick rather than the
  render bracket, so the "18 of 40" an older-bracket velocity recovers is unreachable in any case:
  the status gate is evaluated against a tick where the attacker is already locked.
  Cosmetic only — nothing here reaches `stepSim`, the schema or the server. **Owner: stage 5.** A
  real fix needs a client-side pre-contact history per remote (velocity AND statuses, sampled before
  the patch that resolved the ram), which is a netcode-shaped change and is the same territory as
  `docs/superpowers/specs/2026-09-04-online-netcode-and-client-architecture-design.md` §9.1; it is
  not a `resolveRam` question. The divergence is written down at both ends —
  `ArenaScene`'s `approach` comment and `ImpactPose`'s doc — so the next reader meets it before the
  code.

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
  There is exactly one `expireStatusesFromSource` production call site (`ram-bridge.ts:815`), invoked
  with the attacker's own id, so a car that rams at tick T and lands a `wildcharge` slam before T+15
  clears its own `ramLock` early. No clause in the spec covers a status's source, so fixing it means
  inventing a rule; the implementer and reviewer both declined to invent one. **Owner: stage 5, not
  stage 4** (revised by stage 4's own controller ruling P5, `.superpowers/sdd/04-slam-and-effects/progress.md`
  — stage 4's plan never assigned any task to this defect, and stage 4's Task 3 explicitly kept the
  attacker's self-status expiry as it is, so landing stage 4 without a fix does not reopen it, it
  just confirms it). Fixing it means inventing a rule about a status's source, which is squarely
  stage 5's reconcile-and-tune territory, with the owner in the loop for the design call. Narrow: the
  same car must ram, then wind up and land a 20 s-cooldown charge, inside 15 ticks.
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
- **RESOLVED 2026-09-19 — `DRIVE_CONFIG.dashSubstepMaxUnits` STAYS 16.** (Was: "16 → 8, inherited
  from the 2026-09-06 car-physics rework's stage 2; stage 5 judges it with the user.") Stage 5 Task 4.
  **The project owner drove it and declined the change** — dashed `thunderclap` into a car at
  point-blank range in the playground and judged the momentary interpenetration acceptable. The trade
  they declined: 18.49 u of worst-case overlap at 16 (4 substeps of 13.3 u) against 12.14 u at 8
  (7 substeps of 7.6 u), for double the collision checks per dash tick — on a 60 u hull, clearing in
  about three ticks. Nothing in stage 5's settled tuning moves it: the dash is a fixed 1600 u/s and
  the knob is denominated in world units. `thunderclap` is the only dash in the game; `wildcharge` is
  a charge and never substeps this way.
  **The measurement table was verified, not assumed.** It was taken when collisions still carried
  restitution, which is now 0, so the plan required checking that the decay series had not gone stale.
  `packages/shared/src/sim/step.test.ts` passes with `MEASURED_WORST_REACHABLE` unchanged at
  18.49229600694457, so the table the owner judged against is still true. (The plan's own Task 4 text
  quotes that figure with one digit too many — a transcription slip in the plan, not a moved number.)
  **This judgement had survived two reworks undecided.** It is decided now, by someone driving.
- **PARTLY RESOLVED 2026-09-19 — `wildcharge.impulse.speed` STAYS 520; its reeling duration was never
  judged.** (Was: "both were provisional before this work and still are; stage 4 makes their doc
  comments true, stage 5 pitches the numbers.") Stage 5 Task 5, ruling T5-a.
  The owner's settled tuning raised every ram by 1.8x (top speed 1.5x plus `ram.globalScale` 0.5 →
  0.6), which made stage 4's guard fail: 520 fell from 2.00x to 1.11x the roster-maximum ram.
  **The owner challenged the framing and was right.** `hardestOrdinaryRam()` maximises over every
  attacker x victim pair, so it always lands on "fastest chassis hits the lowest `ramDefence`" — but
  `wildcharge` sets `defenceScaled: false` and ignores `ramDefence` entirely, so the guard compared a
  defence-blind constant against the one matchup where defence helps the ram most. Against the best
  ordinary ram on the SAME victim, 520 is still 1.85x vs Mirage and 3.33x vs Bastion, 4.45x against a
  falloff-worn target and 8.34x on a head-on. Raising `speed` to satisfy the old bar would have needed
  702 (minimum) or 936 (to restore 2.00x), taking the ult to 4.50x-6.00x against Bastion and extending
  its 500 ms wall-stun reach from 12% to 22% of the arena width — a design change dressed as a test
  fix. **The guard was re-aimed instead**, into two assertions: a floor (`speed >= hardestOrdinaryRam()`)
  and an identity check (`speed >= hardestMirrorRam() * 1.5`, attacker = victim so the defence spread
  drops out). The identity bar has only ~8% headroom, so a further ram-power increase trips it — that
  is a true positive, not a flaky test.
  **`applies[0].durationMs` (1400, formerly `uncontrolMs`) is still un-judged** and still provisional.
- **`reeling`'s `reapply: "ignore"` DELETES `wildcharge`'s entire 1.4 s control loss whenever the
  victim was rammed in the preceding second (whole-branch review, controller ruling S3-p). Owner:
  stage 4.** Not a discount — a total loss, and in the most common setup for the ult.
  - **The mechanism.** `applyStatus` returns the status list unchanged for an `"ignore"` row that is
    already running. `RAM_CONFIG.ramUncontrolMs` is 1000 and the slam authors 1400, so a slam landing
    at any point inside a live reel writes nothing and the victim keeps the ram's shorter window.
    Under the old `reapply: "refresh"` (`endsTick = max(existing, now + duration)`) the longer slam
    window would have extended it, so this is new as of stage 3 Task 4.
  - **Including on the same tick**, and that is the common case rather than a corner: `contactTick`'s
    ram loop runs before its slam loop, so ram-then-charge — drive in, then charge the stunned target
    — reliably lands the ram's reel first and throws the slam's away. `ram-bridge.test.ts`'s "applies
    a slam AND a concurrent ram to the same victim" already documents that whichever lands first owns
    the window; what nobody had noticed is that the ram always does.
  - **It is NOT fixable by editing the status system.** `"ignore"` is FORCED: `StatusDef` requires it
    of any flag-carrying debuff (`status-config.test.ts` polices it), and `reeling` carries four
    flags. The only fixes are a per-source reel or a new chaining variant — a design decision for the
    project owner, not a mid-stage patch, which is why the review recorded it rather than fixing it.
  - **Stage 4 owns it because stage 4 owns `wildcharge`'s impulse re-pitch** (spec P31) and cannot
    pitch a duration that is unreachable in the setup it is pitched for. `weapon-config.ts`'s
    `uncontrolMs` doc argued the exact opposite until the whole-branch fix wave corrected it; it now
    points here.
  - **Spec §8's rationale for `"ignore"` is INCOMPLETE and must not be read as clearing this.** It
    says the choice "costs exactly one behaviour: a re-ram landing while a reel is still running no
    longer extends it" — true of ram-on-ram, where both windows are `ramUncontrolMs` and falloff
    already discarded every scaled duration, so nothing is lost. It does not consider a SECOND,
    LONGER source of the same status, which is exactly what the slam is. The spec is not edited (this
    file is where an incomplete clause is recorded); the clause is not wrong, it is under-scoped.
- **Coverage note, not a risk: neither S3-o test separates "ANY resolution replaced" from "the LAST
  resolution replaced".** `resolveContacts` walks sorted session ids, so the a–b pair is always
  visited before b–c and the car that is both attacker and victim always takes its replace last. Both
  readings of the rule therefore produce the same number on both fixtures. The implementation is
  `write.replaced ||= side.replacesVelocity` and is unambiguous about which one it means, which is
  why this is recorded as a gap rather than fixed: a fixture that distinguishes them needs a pair
  ordering the sorted loop cannot produce. **Nobody should assume it is covered.**
- **The spin clamp moved from once-per-resolution to once-per-car-per-tick, and the re-review
  accepted it as strictly better. Recorded so it is not re-litigated.** Both forms leave
  `|angVel| <= RAM_CONFIG.spinMaxRate` after the write, which is all U26 asks, and **neither has spec
  backing** — nothing in §7.2 or §7.3 speaks to it. The tie breaks on the same one-write-per-car rule
  the rest of `flushRamWrites` rests on, and on this: the OLD per-resolution form was itself
  order-dependent whenever an intermediate total was clipped and a later opposite-signed addend would
  have pulled it back inside (`+8` then `−3` gave 3, `−3` then `+8` gave 5; the sum gives 5 either
  way). It is **deliberately untested in either direction** — pinning it would author a rule the spec
  does not have.
- **Spec §7.4's `ramLock` safety argument is unsound: a charging car CAN take `ramLock` mid-charge.
  Owner: stage 4**, which owns the slam path and `ramLock`. §7.4 asserts "a car in any maneuver
  therefore never reaches the ram arm, which is why `ramLock` can never strand a dashing or charging
  car". `sim/contact.ts` says otherwise in as many words: blocked slams fall through to an ordinary
  ram, and `resolvePair` only sets `anyEvent` when a slam is actually pushed — so a `CHARGE` car
  whose slam is refused by `slamImmuneUntil` reaches `resolveRam`, can qualify as an attacker
  (nose-first, above `minRamSpeed` — a charging car is both), and takes `ramLock` with its velocity
  zeroed while `tickCharge` counts the maneuver down underneath it. Narrow: it needs two chargers in
  one match, so the same victim is inside a live re-slam immunity. Self-limiting at
  `RAM_CONFIG.attackerLockMs` (500 ms). The spec is not edited.
- **Zero restitution plus edge-triggered contact makes "roll up, then floor it" harder to ram from —
  a stage-2 × stage-3 interaction neither plan anticipated. Owner: stage 5, and the playtest run.**
  `resolveWorld` pushes cars to exactly the separation boundary and `RAM_CONFIG.contactPad` is 1, so
  a pair that touches without ramming stays in `memory.contacts` indefinitely; stage 2 removed the
  rebound that used to break that contact apart. `applyRams`' own doc already says accelerating while
  already touching cannot re-trigger — this branch made that condition much easier to sit in, and a
  player who nudges into someone and then floors it gets nothing until they back off and re-approach.
  A feel/tuning question, not a defect: the edge trigger is the intended anti-stunlock rule and the
  knob is `contactPad`, not restitution.
- **The netcode rewrite's phase 1 plan is stale** — its fixtures still name `speed`, `shoveX`,
  `shoveY` and `authority`, deleted by the car-physics rework's stage 1. Not this work's to fix, but
  whoever starts that rewrite must refresh it against the model this port leaves behind.

- **The weapon module and the ram module are coupled at seven sites. The owner reviewed the audit on
  2026-09-19 and chose NOT to decouple them.** Recorded here so the next reader finds a decision
  rather than re-running the audit. The weapon *pipeline* is clean — `sim/weapons/*`, `combat.ts` and
  `damage.ts` import nothing from the ram module — so every site below is at the **push** seam:
  1. `sim/impulse.ts:1` imports `ram-config.js` directly, for `RAM_CONFIG.spinMaxRate` (the angular
     clamp, `:134`) and `inertiaRadiusSquared()` (the hull inertia denominator, `:132`).
  2. **`inertiaRadiusSquared()` is misplaced, and moving it would remove half of site 1 for free.**
     It is `(carWidth ** 2 + carHeight ** 2) / 12` — pure hull geometry with nothing ram-specific
     about it. It lives in `ram-config.ts` because stage 3's plan put it there.
  3. **A weapon's spin is scaled by the victim's `ramDefence`, and `defenceScaled: false` does not
     stop it.** `impulse.ts:132` computes `inertia = ramDefence * inertiaRadiusSquared()`
     unconditionally; `defenceScaled` gates only the LINEAR part. Inert today only because
     `wildcharge` authors `spin: 0` — but stage 4 makes `spin` live, so a future row that authors one
     would rotate a Bastion less than a Bullseye because of a ram rating, with the opt-out flag set.
  4. The weapon's push is applied inside `ram-bridge.ts`, sharing `ContactMemory` with the ram's
     falloff stack. There is no weapon-side bridge to move it to.
  5. `ImpulseDef.defenceScaled` means "divided by `ramDefence`" — a weapon knob whose unit is a ram
     rating, resolved through `ramDefenceFor` -> `ramDefenceOf`.
  6. `sim/contact.ts` imports `RAM_CONFIG`, `IMPULSE_CONFIG` and `resolveRam`. Defensible — it IS the
     contact pass — but the maneuver branch that produces weapon events sits in the same pair loop.
  7. The client's `impact-feedback.ts` imports `RAM_CONFIG`, and stage 4's Task 7 adds `resolveRam`.

  **Two that are correct and should stay:** `sim/ram.ts` importing `canDamage` from
  `weapons/targets.js` (friendly fire decided by the same predicate as shots, which the spec states
  deliberately), and `ram-config.ts` importing `msToTicks` from `weapon-ticks.js` (a shared unit
  conversion, not a behaviour).

  **If it is ever picked up**, the shape is: `inertiaRadiusSquared` and the angular clamp move to the
  drive/hull config, `IMPULSE_CONFIG`'s two members go with them or onto the impulse type,
  `impulse.ts` stops importing `ram-config` entirely, the push application moves out of
  `ram-bridge.ts`, and `defenceScaled` either names its rating honestly or gets a weapon-side one.
  That leaves `contact.ts` as the only shared seam, which is structural — both things genuinely
  happen on contact.

- **Branch state as stages 2 and 3 closed (2026-09-18/19).** `physics/stage2-and-3` carries 20
  commits. **It is no longer a fast-forward into `feature/movement`**, which moved 5 commits ahead
  after this branch was cut (the melee weapons spec, the basic-attack id refactor, a
  `development/main` merge, and the playtest basic-attack carrier fix). Six files changed on both
  sides and will need a real merge: `CLAUDE.md`, `docs/combat-model.md`,
  `packages/shared/src/config/car-config.ts`, `.../weapon-config.ts`, `.../weapon-types.ts` and
  `packages/shared/src/index.ts`. The abandoned branch `claude/motor-combat-physics-analysis-3e7a9a`
  holds nothing unique — verified with `git cherry` against both lines — and is safe to delete.

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
