# Stage 5: Tune and Reconcile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn a working rework into a shipped one — tuned values, honest docs, honest probes, and a
balance baseline that means something.

**Architecture:** No new mechanisms. This stage discharges the obligations the previous four
incurred, and it is the stage most likely to be skipped, because **almost nothing in it fails a
test if left undone.**

**Spec:** [`docs/superpowers/specs/2026-09-06-car-physics-rework-design.md`](../../specs/2026-09-06-car-physics-rework-design.md) ("Obligations this work incurs")

**Depends on:** Stages 1–4 complete, `npm test` green.

## Global Constraints

Identical to stage 1 — see [`01-vector-drive.md`](01-vector-drive.md#global-constraints). Plus:

- **Never create a new playtest probe or scenario.** Keeping an existing one honest is maintenance;
  inventing coverage is not, and the user adds scenarios explicitly.
- Probes **report**, they do not assert. Verdicts are `OK`, `FINDING`, `KNOWN-BY-DESIGN`.
- Anything involving contact must sweep the sub-tick phase. A car covers world units per tick, so a
  single placement measures one arbitrary point on the tick grid.
- Running `npm run playtest` and `npm run balance` and deciding what the numbers mean is **the
  user's call**, not a step taken on their behalf.

---

## Task 1: Playground tuning pass

**Files:** none committed until Step 4.

**Interfaces:** consumes everything; produces the final values for `DRIVE_CONFIG`, `CAR_TABLE`
(including the revision-2 `ramAttack`/`ramDefence` ratings), `RAM_CONFIG` (including
`defencePushScale` and `globalScale`) and `wildcharge.impulse.speed`.

- [ ] **Step 1: Open the playground**

```bash
npm run dev
```

Then `http://localhost:5173/?dev=playground`. `DRIVE_CONFIG`, `RAM_CONFIG` and `CAR_TABLE` are all
covered by the runtime tuning store, so every number below is dialable live with no rebuild.

- [ ] **Step 2: Judge the driving, in this order**

Tune one axis at a time; they interact and a simultaneous change tells you nothing.

1. **Top speed** — `drive.baseMaxSpeed`, `drive.speedPerRating`. Does a car feel heavy or merely
   slow? Slow-and-light is the failure mode; it means speed came down but coast did not.
2. **Wind-up** — `drive.baseAccel`, `drive.accelPerRating`. Target roughly 1.5 s for Mirage and
   2.2 s for Bastion.
3. **Coast** — `car.<id>.coastHalfLifeSeconds`. This is the single biggest "heavy" lever. If the
   cars still feel like race cars after the speed cut, this is why.
4. **Turn** — leave `baseTurnRate` alone unless aiming still feels wrong *after* the three above are
   settled. The speed cut has already tightened every radius; touching turn rate first will
   over-correct and you will not know which change did it.

- [ ] **Step 3: Judge the ramming**

1. Ram a stationary bot side-on at full speed. Does it read as an impact?
2. Ram a bot fleeing at your own speed. It should barely move — that is P17 working.
3. Ram a bot head-on. Both of you should pay.
4. Chain three rams. The third should barely register; three seconds later, full strength.
5. As Bastion, wildcharge a bot. **Compare it directly against your best ordinary ram.** If the ult
   is not clearly harder, `wildcharge.impulse.speed` is the number to raise — this is the re-pitch
   stage 4 deferred, and it is the single most likely thing in this whole rework to ship wrong.
6. **`defencePushScale`** (spec R2) — dial this while parked. A stationary Bastion should absorb a
   meaningfully bigger hit than a stationary Bullseye, but neither should feel like a free pass or an
   immovable wall. The config's own comment calls this "the first knob to reach for when contact
   feels wrong" — start here if anything about ramming reads off.
7. **`globalScale`** (spec R5) — this was **measured**, not guessed, in stage 3's Task 4. Re-check it
   here: if this pass changes the roster's `ramAttack`/`ramDefence` spread, the whole contest's output
   moves with it, and a spread change can quietly re-open the "attacker thrown backwards" failure
   revision 2 exists to close. Re-run the same measurement stage 3 used if the spread moved
   meaningfully.
8. **`ramAttack`/`ramDefence` per car** (spec R1, "Starting values") — the roster's starting spread
   (flatter attack, defence inheriting the old `mass` ordering) is an explicit placeholder, not a
   balance pass. Feel whether the flatter attack spread reads as intended, and whether defence's
   double duty — it both adds to a car's own push *and* divides its received impact (spec R5) — makes
   a maxed-out car read as genuinely hard to kill rather than merely tanky. If a chassis proves
   unkillable, the spec's own recorded view is that the fix is pricing the roster, not weakening the
   compounding itself.
9. **The two gates that ship inactive** (spec R9) — confirm `minApproachSpeed` (0) and the (absent)
   impact ceiling are still not binding after this pass's retune. **Neither may ever be re-clamped to
   a normalised 0–1 fraction** — that is the exact defect revision 1 shipped. If a ceiling starts
   feeling necessary, that is a `globalScale` or roster problem to fix at the source, not a reason to
   reintroduce the old saturating model.

- [ ] **Step 4: Write the settled values into the tables and commit**

Export from the playground or transcribe. Then:

```bash
npm test
git add packages/shared/src/config/
git commit -m "balance: tuned car physics values from playground"
```

---

## Task 2: Rebuild the players' guide

**Files:**
- Modify: `packages/client/public/manual.html` (generated — never hand-edited)
- Possibly modify: `scripts/cars-and-weapons-copy.mjs`

- [ ] **Step 1: Rebuild**

```bash
npm run build:manual
```

`CAR_TABLE` gained two fields and `WEAPON_TABLE` gained `impulse`, so `balanceStamp` has moved and
`scripts/manual-page.test.mjs` has been failing since stage 1 unless someone rebuilt early. Stage 3
moved it again on its own: `mass` left `CAR_TABLE` and `ramAttack`/`ramDefence` arrived (spec R1,
R11) — every field of a row counts toward `balanceStamp`, so this is a second, independent reason the
guide is stale even if it was rebuilt right after stage 1.

**`docs/turn-tuning.md` owes a pass too, for a related but different reason.** It carries no
`balanceStamp` of its own — `scripts/turn-tuning-doc.test.mjs` recomputes its tables directly from
built shared rather than hashing anything — and its tables never carried a `mass` column, so removing
`mass` does not fail that test. But the page's *prose* argues from figures inside sentences the test
cannot see (the same limitation the manual's copy has), and at least one sentence names `mass` by
name — the spec's own changelog quotes Bastion's "tank identity now rests on hp and mass alone" as the
pre-revision-2 framing. Reread `docs/turn-tuning.md` for any prose that still credits `mass` with
something `ramAttack`/`ramDefence` now does, even though the suite stays green regardless.

- [ ] **Step 2: Read the prose for rotted figures**

The copy quotes numbers through placeholders (`{predator.acquireRadius}`), and
`scripts/manual-facts.test.mjs` fails if a token's value is typed as digits. But **it cannot catch a
sentence that is now merely wrong** — a claim about how a car handles, or how ramming works, that no
token covers.

Read `scripts/cars-and-weapons-copy.mjs` for:
- Any claim about acceleration, top speed, braking or cornering. Every one of those changed.
- Any description of ramming that says the victim is pushed but not that they lose control.
- Bastion's chassis copy, if it argues from a handling edge — the 2026-09-02 pass already removed
  that edge and this rework changes the framing again.

- [ ] **Step 3: Verify and commit**

```bash
npm test
git add packages/client/public/manual.html scripts/cars-and-weapons-copy.mjs
git commit -m "docs(manual): rebuild the cars and weapons guide for the physics rework"
```

---

## Task 3: Make the playtest probes honest

**Files:**
- Modify: `packages/server/playtest/*.ts` as needed.

> **This task is why the rework does not quietly rot.** `packages/server/playtest/` measures ram
> trigger rates, weapon reach, collision depth and prediction error against the real pipeline. Every
> one of those is invalidated by this work. The probes are not part of `npm test` and not part of the
> release build, so **none of this fails anything.**

- [ ] **Step 1: Make them compile**

```bash
npm run playtest
```

Anything still referencing `speed`, `shoveX`, `shoveY`, `authority`, `RamKnock`, `SLAM_TICKS` or the
removed `SLAM_CONFIG` fields will not build. **Fix compile breaks on the spot** — a probe that does
not build measures nothing, and leaving it broken is worse than leaving it stale.

- [ ] **Step 2: Read every report and classify each moved number**

For each probe whose output changed, decide which it is:

- **The rework fixed what it measured.** Update the expectation so the fix now reads `OK`. The ram
  trigger-rate probe is the likely case here: it exists because passing post-collision speed cost
  80–90% of rams, and stage 3 changed what "approach" means entirely.
- **The rework moved a number the probe quotes.** Update the comment or report string. Collision
  depth and prediction error both quote figures that have changed.
- **The rework broke something.** Leave it as a `FINDING` and fix the code, not the probe.

Do **not** update a threshold merely to make a probe green. Do **not** delete a probe.

- [ ] **Step 3: Flag what needs the user**

Any threshold change that is a *judgement* rather than a mechanical consequence goes to the user with
the probe named and the number named. Do not decide it silently.

- [ ] **Step 4: Commit**

```bash
git add packages/server/playtest/
git commit -m "test(playtest): update probes for the physics rework"
```

---

## Task 4: Re-baseline the balance harness

- [ ] **Step 1: Run a fresh baseline**

```bash
npm run balance -- --shape=duel --matches=200
```

Every prior report is incomparable: the config fingerprint has moved, and `BOT_BRAIN_VERSION` was
bumped in stage 1 so the bot fingerprint has too. The harness's `--baseline` flag will refuse the
comparison rather than trusting a reader to remember — that refusal is correct, not a bug.

- [ ] **Step 2: Read the win rates against a known distortion**

The harness cannot press `wildcharge`. Bastion's numbers therefore **exclude its ult entirely**, and
this rework made that ult's impulse the thing most likely to be mis-pitched. Do not conclude Bastion
is weak from this report alone.

- [ ] **Step 3: Hand the report to the user**

Balance decisions are theirs. Report what moved and what the intervals are; do not retune off one
run.

---

## Task 5: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

The project file describes a drive model that no longer exists. Sections that are now wrong:

- [ ] **Step 1: The statuses paragraph** — add `reeling` and say plainly that it is not a stun.
- [ ] **Step 2: Hard invariant 6** — "`{x, y, angle}` is canonical world state" now understates it;
      velocity is `{vx, vy}` and is canonical too.
- [ ] **Step 3: The chassis-ratings paragraph — `mass` is gone, not merely reworded.** `CLAUDE.md`
      currently lists "six independent 0-100 values: speed, accel, handling, attack, hp, mass."
      `mass` no longer exists (spec R1); replace it with `ramAttack` and `ramDefence` — **seven**
      ratings now, not six — and say why two replaced one: `mass` used to drive ram severity, impulse
      scaling, positional separation, the status channel and a displayed stat all at once, so no
      aspect of ramming could be tuned without moving the others. Also drop any description of an
      equal-and-opposite reaction: there is no `reactionOf` any more (spec R7). What replaces it —
      each car brings a push into a contest (`ramAttack` × its own drive-in, plus a standing
      `ramDefence` contribution), and each car's outcome is computed directly from that contest, not
      derived by negating the other's. Positional separation is `ramDefence`-weighted (spec R8,
      unchanged in mechanism from the old mass-weighted version). `ramAttack`/`ramDefence` are still
      out of the drive model, exactly as `mass` was — say that part too.
- [ ] **Step 4: The turn-tuning field list** — it names `DRIVE_CONFIG.drag` and
      `DRIVE_CONFIG.brakeDecel`, neither of which exists. Replace with the per-car fields plus
      `steeringGrip` and `impactGripDecel`.
- [ ] **Step 5: The netcode rewrite section** — note that this rework landed and that phase 2's
      snapshot work now carries `vx`/`vy` rather than `speed` + `shove` + `authority`.
- [ ] **Step 6: The "Read the right doc" table** — add a row pointing at this spec.
- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for the car physics rework"
```

---

## Stage 5 exit criteria

- [ ] `npm test` passes from the repo root.
- [ ] `npm run build` (root) succeeds, and `packages/server/dist/index.js` inlines the shared dist
      from `// ../shared/dist/…`, not from an escaped worktree path.
- [ ] `npm run playtest` completes with no compile errors and every remaining `FINDING` is either
      understood or handed to the user.
- [ ] A fresh balance baseline exists and has been handed over.
- [ ] `CLAUDE.md` describes the model the code actually has.

## Rework exit criteria

- [ ] Cars take over a second to reach speed and roll a long way off the throttle.
- [ ] Turning is precise at any speed — no wash, no fighting your own momentum.
- [ ] A side-on ram at speed throws the victim, spins it, and takes its control for about a second.
- [ ] The attacker pays too, and how much depends on the contest — its own `ramAttack`/`ramDefence`
      against the victim's, not on a `mass` figure (spec R1, R4/R5).
- [ ] Chained rams fall off; three seconds later they do not.
- [ ] A Bastion cannot be shouldered aside; a Bullseye can.
- [ ] `thunderclap` is untouched.

---

## Carried in from stage 2: deferred `dashSubstepMaxUnits` tuning

Stage 2's mass-weighted car-car separation (each side now conceding only `shareOf(selfMass,
otherMass)` instead of the pre-rework always-full-push) made `DRIVE_CONFIG.dashSubstepMaxUnits`'s
13.3u arrival gap at the current value of 16 **visible** as momentary penetration for the first
time — a dashing car can end up briefly embedded in what it hits. `thunderclap` is the only dash in
the game, so this is Mirage-only; worst measured case is Mirage into a Bullseye at **17.96u**, and it
clears in about three ticks with both cars resolving. Full measurement table and reasoning are on the
constant's own doc comment (`packages/shared/src/config/drive-config.ts`, `dashSubstepMaxUnits`) —
read that first if picking this up.

Recommended change: `dashSubstepMaxUnits` **16 → 8**, which drops the measured worst case to
**11.71u** for double the collision checks per dash tick. This was deliberately left undone in stage
2 rather than folded into that stage's mass-split work, so it belongs in this stage's tuning pass
(Task 1) alongside the other playground-dialable numbers — judge it against how a dash actually
feels before committing to 8 over the current 16 or another point on the table.
