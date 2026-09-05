# Plan-writing progress

> **Read this first if you are continuing the plan-writing work from a new session.** It says what
> is written, what is left, exactly how to write each remaining plan, and every decision made while
> writing the finished ones. Nothing here is needed to *execute* a plan — for that, read
> [`00-execution-guide.md`](00-execution-guide.md).

**Last updated:** 2026-09-05 (N6 and V5 written — **the folder is complete**). **Branch:** `claude/gameplay-netcode-architecture-bgp8f6`.

The two approved specs this folder implements:
[netcode](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) and
[rendering](../../specs/2026-09-04-client-rendering-architecture-design.md).

## 1. Status

Fourteen plans, two streams. **All fourteen are written. Nothing is left to write.** (Count the table, not this line: earlier revisions of it said nine and then ten while eight were written, both wrong.)

| # | File | Lines | State |
|---|---|---|---|
| P | `01-prep-arena-scene-split-and-render-frame.md` | 1778 | written |
| N0 | `10-netcode-0-instrumentation.md` | 2126 | written |
| N1 | `11-netcode-1-time.md` | 1415 | written |
| N2 | `12-netcode-2-wire.md` | 2825 | written |
| N3 | `13-netcode-3-world.md` | 3795 | written |
| N4 | `14-netcode-4-feel.md` | 3177 | written |
| N5 | `15-netcode-5-lifecycle.md` | 1781 | written |
| N6 | `16-netcode-6-optional.md` | 1749 | written |
| V0 | `20-render-0-instrumentation.md` | 1853 | written |
| V1 | `21-render-1-hud.md` | 2704 | written |
| V2 | `22-render-2-bake.md` | 4170 | written |
| V3 | `23-render-3-beams.md` | 1609 | written |
| V4 | `24-render-4-events.md` | 2165 | written |
| V5 | `25-render-5-pixels.md` | 2009 | written |

Supporting files, all written: [`interfaces.md`](interfaces.md) (the ledger),
[`00-execution-guide.md`](00-execution-guide.md), [`plan-authoring-brief.md`](plan-authoring-brief.md).

**`22-render-2-bake.md` was finished on 2026-09-05 from an 85 %-written draft**, not restarted. The
draft had stopped at a clean task boundary with Tasks 1-6 complete; the finishing pass added Task 7
(the measurement-and-guard task: draw calls ≤ 16 at the ceiling, `sceneCensus` and `bench-arena.mjs`
extended to *fail* on a stray world `Graphics` or one that clears itself, `world-retained.test.mjs`,
the `docs/render-bench.md` V2 row and the remaining doc edits) plus `## Acceptance`, `## Handoff` and
`## Self-review`. Tasks 1-6 were re-checked against the current ledger and needed no change.

**`14-netcode-4-feel.md` was written on 2026-09-05**, in this session, along with its five ledger
edits (section 3's table). It resolved the ram question of section 4 **without** touching
`resolveContacts`: shared `sim/ram-events.ts` re-runs the exported, pure `resolveRam` on the pairs
that entered contact, which recovers the attacker, the victim, the side and the graded severity
exactly. The two limits that remain — a hull-centre midpoint instead of the contact manifold point,
and dash/slam pairs excluded rather than re-classified — are what section 4's open question is now
about, and it is narrower than it was.

**`23-render-3-beams.md` was written on 2026-09-05**, in the same session as N4. It found no ledger
defect — the `render/beams.ts` row fitted as written — but it **deviates from the rendering spec in
two places, both arithmetic**, and both are recorded in its own `## Handoff` under "Where this plan
departed from the spec": one flipbook length instead of R14's two (a cone's apex is at the muzzle,
so a uniform scale of one frame is exactly the shorter flame's silhouette, and the second length
would double the sheet's largest item), and twenty rope points instead of §5's "24 segments"
(a `Rope` emits two vertices per point, so 24 segments is 50 vertices against R2's ceiling of 40).
Neither needs the user's word: R2 is a numbered principle and §5's catalogue is descriptive, so the
more specific statement wins, which is the same rule that settled `PlayerState.level`.

**`15-netcode-5-lifecycle.md` was written on 2026-09-05**, same session. It found no ledger defect
either; its ledger edits are all additive (`PlayerState.connected` appended to the schema,
`ColyseusTransport.rebind`, `InputRing.reset`, `ClockSync.reset`, and a new block for
`net/reconnect.ts` / `match/link-health.ts` / `net/flood-detector.ts`). It takes the guide's warning
about the two reconnect numbers seriously: 15 s and 60 s are separated in six places, and the one
test that mentions both pins the *relationship* rather than either value.

**`24-render-4-events.md` was written on 2026-09-05**, same session, and it **discharges the
execution guide's coupling 2 by construction rather than leaving a switch to throw**: `ArenaScene`
passes `frame.events` and `BenchScene` passes `benchEvents(tick)` to the same
`EffectRouter.onEvents`, so nothing has to change when N4 merges — the arena simply starts receiving
a non-empty list. Its ledger edits are additive (the three service rows expanded, the census's fourth
group, `bakeJobs`' fourth job list). Its most unusual decision is a **bench failure that fires when a
decal is live**: `DECAL_DEFS` is empty by decision (R12a), not by omission, so the guard protects the
decision rather than a bug, and the day somebody authors the first decal that line is what makes them
say so out loud.

**`16-netcode-6-optional.md` and `25-render-5-pixels.md` were written on 2026-09-05**, in one session,
and they finish the folder. Neither found a ledger defect either, so **five plans in a row have now
found none** — V3, N5, V4, N6 and V5. That is a signal the ledger converged, not that the check was
skipped; each report says so explicitly. Their ledger edits are all additive: `net/volley.ts`,
`net/input-log-read.ts`, `match/webtransport.ts` + `match/transport-select.ts` (N6, all three
evidence-gated and possibly never built), and `render/tier-storage.ts`, `render/render-scale.ts`,
`render/filters.ts`, `bakedTier()` and two `EffectRouter` options (V5), plus the fifth and final
widening of `SceneCensus`.

**N6 is unlike every other plan in the folder and its header says so.** Its five tasks are gated on
evidence, not scheduled: each opens with the number that must be observed, where to read it, and what
it is expected to say — and four of the five are expected to read *false* on a LAN, which is the
phase working rather than failing. It carries a **gate ledger** table at the top that is filled in
when a gate is read, whatever the answer, plus a "Recording a skip" procedure, because the execution
guide's N6 row requires a skipped task to be recorded with its measured value. The one gate already
known to be true is `telegraphAudit()`'s, which N4 shipped non-empty on purpose.

**V5's most load-bearing decision is what a tier change may and may not do.** The atlas is baked once
at boot (R13) and the canvas size is fixed at module load, so a live tier change moves the particle
and decal caps, the camera filters and the floor ambience — and nothing else. Five of the seven tier
call sites read a new `bakedTier()` rather than the live tier, and the player is told to restart
through `MatchBanners.setTierNotice`. The alternative, re-baking mid-match, is a multi-hundred-
millisecond stall on the machine least able to afford one.

## 1a. Where this stopped, 2026-09-05 — read this before starting

**Six plans landed on 2026-09-05, in this order: N4, V3, N5, V4, then N6 and V5** — one commit each,
each carrying its own ledger edits, on worktree branches off
`claude/gameplay-netcode-architecture-bgp8f6`.

**Plan-writing is finished.** There is no next plan to write and section 5's assignments are now
history rather than instructions — they are kept because they record what each plan was asked for,
which is the only way to tell later whether it delivered.

**What happens next is execution, not writing.** Read
[`00-execution-guide.md`](00-execution-guide.md), start with the preparation plan
(`01-prep-arena-scene-split-and-render-frame.md`), and merge each phase into `development/main`
before the next one starts. The guide's §1 table gives the order and the three cross-stream
couplings; its §5 gives the gate each phase is done against.

Two things a first executor should know that are easy to miss:

- **N6 is not scheduled and must not be run in sequence with N5.** Its tasks wait for evidence and
  for the user to say go. Reading its gates costs a morning and is worth doing early — two of them
  (`telegraphAudit()`, and the harness's bytes-under-volley row) can be read before the phase they
  belong to has even started.
- **V5 is the last rendering phase but not the last measurement.** Its Task 6 is where
  `docs/render-bench.md` gets the whole V0→V5 arc filled in, on the reference machine as well as
  under software GL, and an unfilled `(record)` cell there means a phase that was not measured.

Nothing is half-written and no file is under a provisional name. The open question in section 4 is
unchanged in kind and narrower in scope than it was; it blocks nothing.

## 1b. Continuing from a different machine

**Everything the plan-writing produced is in git and nothing else is.** No scratch file, no local
note and no machine-local memory carries anything the repository does not.

The six plans written on 2026-09-05 landed on worktree branches off
`claude/gameplay-netcode-architecture-bgp8f6` — N4, V3, N5 and V4 on
`claude/netcode-rendering-plans-003970`, N6 and V5 on `claude/netcode-rendering-plans-1b2533`, each
cut from `development/main`. Both touch only `docs/`, so neither can conflict with code work in
flight; merge them whenever you like.

**Plan-writing needed nothing per-machine**: it reads markdown and source and writes markdown, with
no install, no build and no browser. If a plan is ever added to this folder, hand its writer
[`plan-authoring-brief.md`](plan-authoring-brief.md) — **the brief's paths are repo-relative as of
2026-09-05**, having previously hardcoded the first session's checkout (`/home/user/…`) and plugin
cache, which were wrong on every other machine.

**To *execute* a plan, three things are per-machine and none of them is in git** — all three are in
the root `CLAUDE.md` and are repeated here because a fresh machine is exactly when they bite:

1. **`npm install` in the worktree before the first build.** Without it the build inlines the *main
   checkout's* shared `dist` and the server silently runs the wrong sim while all three suites pass.
   Tell the two apart by the inlined path in `packages/server/dist/index.js`: `// ../shared/dist/…`
   is right, `// ../../../../../packages/shared/dist/…` has escaped the worktree.
2. **`uv`**, for the `code-review-graph` MCP server, and a graph built per worktree
   (`uvx code-review-graph@2.3.8 build`, or the `code-graph-install` skill). Optional — nothing in
   these plans depends on it.
3. **A Playwright browser**, for `npm run smoke:arena`, `npm run smoke:reconnect` (N5) and
   `scripts/bench-arena.mjs` (V0–V5): `npx playwright install chromium`, plus `firefox` for the
   bench's second row. **The preparation plan, N0 and V0 mention `/opt/pw-browsers` and "this
   container" — that is a description of the machine those plans were authored on, not a
   requirement.** Each of those sentences already names the portable command beside it; read them
   that way rather than as setup you are missing.

A general rule for any future interruption: a half-written plan must never be left under its final
name, because the next plan in that stream builds on its `## Handoff`. That rule is what made the V2
draft finishable rather than a rewrite.

## 2. How these plans were written (kept for any that are added later)

Each plan is written by one worker in its own context. Hand that worker:

1. [`plan-authoring-brief.md`](plan-authoring-brief.md) — the shared rules, read first and in full.
2. The plan's own assignment from section 5 below, verbatim.

**Nothing remains to be written**, so this section is now a record of how the fourteen were produced
rather than a procedure to follow. It is kept because the same method applies to any plan added to
this folder later — a second N3 under approach B (section 6's fallback), say.

**Order mattered.** Within a stream each plan reads the previous plan's `## Handoff`, so they were
written in order; across streams they are independent and were written in pairs.

**After each plan comes back:**

1. Check it: `wc -l`, the task headings, and a scan for `TODO|TBD|FIXME|omitted for brevity`. A hit
   inside the Self-review's own "Placeholder scan" paragraph is the paragraph saying there are none.
2. Read the worker's reported **ledger concerns**. Every plan so far has found at least one real
   defect in [`interfaces.md`](interfaces.md). Resolve each against the **spec**, which outranks the
   ledger, then edit the ledger yourself before writing the next plan in that stream — the next
   worker reads the ledger, not the report.
3. Commit with the ledger edit in the same commit, saying which row moved and why. Push.

**When to decide alone, and when to stop and ask the user.** Step 2 is yours to run — the user does
not adjudicate routine ledger defects. Resolve it yourself when *any* of these holds:

- **The spec answers it.** Including when a spec's own summary sentence and its explicit enumeration
  disagree: the more specific statement wins (this is exactly how `PlayerState.level` was settled).
- **It is purely additive** — a new field, parameter or export that nothing already written
  constrains, and that changes no behaviour.
- **It is a question of ordering or ownership between phases** — which phase creates a module, which
  module owns a type. Both of V1's concerns were this.

Stop and put it to the user when *any* of these holds:

- **It crosses a root `CLAUDE.md` "Stop and ask" fence** — the drive model, the hitbox/OBB model,
  collision-damage rules, friendly fire, cloud hosting, a physics engine. This is what kept the
  `resolveContacts` question in §4 rather than being decided in N3.
- **It would edit a balance table** (`WEAPON_TABLE`, `CAR_TABLE`, `DRIVE_CONFIG`, `STATUS_TABLE`,
  `COMBAT_CONFIG`, `TICK_RATE_HZ`, …). Those carry the `npm run build:manual` and
  `docs/turn-tuning.md` obligations and change what players feel. N4's assignment already says to
  name a violating weapon row rather than edit it.
- **It changes a number a player experiences** — a rate, a range, a duration, a time-to-kill.
- **Two approved specs genuinely conflict** with no more-specific statement to break the tie.

When you do escalate: keep writing every other plan that does not depend on the answer, record the
question in §4 with the same shape as the one already there, and carry on. Only the affected task
waits.

## 3. Decisions already made while writing these plans

Nine ledger defects have been found and fixed. They are recorded here because each was a judgement
call, not a typo, and a later reader will otherwise re-open them.

| Found by | Defect | Resolution |
|---|---|---|
| N2 | The ledger's schema-split row listed `PlayerState.level` among the fields leaving the schema, contradicting spec §6.9 N24's own enumeration, which keeps it | **Kept on the schema.** `applyCombatResult` (`packages/server/src/sim/combat-bridge.ts:246`) writes it back every tick, but the value only *changes* on a level-up, and `stepWorld` never reads it — combat is server-only per N14 — so invariant 8 does not claim it. The spec's summary sentence overstated; its enumeration is right. Byte budget re-derived: full 683 → 677 B, contact delta 336 → 330 B |
| V1 | `render/bake.ts` and `render/atlas.ts` were assigned to V2, but V1's baked cooldown rings need them a phase earlier | **Moved to V1**, HUD jobs only, with the ledger's exact names and signatures; V2 extends the same two files with the world jobs, `ART_ATLAS` and `pack-atlas.mjs` |
| V1 | `BakeTier` and V5's `Tier` are the same union with no stated owner | **`render/bake.ts` owns it**; V5's `render/tiers.ts` re-exports `export type Tier = BakeTier`, so V5 never becomes a dependency of V1 |
| N3 | `CarState` as typed cannot run `resolveContacts`, and the snapshot carried no contact memory | Added `CarState.team`, `CarState.maneuverWeaponId`, `WorldState.mode`, `SlamClocks.bySessionId`, `Snapshot.contactPairs` and `Snapshot.slams` — all additive. Full snapshot 677 → 686 B, steady-state delta 125 → 128 B, both still inside spec §8's lines |
| N4 | `WorldState.mode` was typed `GameMode`, but `resolveContacts` takes the SIDES string and N3's own `MatchClient.worldFrom` builds it with `sidesOf(lobby.mode)` | **`"ffa" \| "team"`.** The more specific statement — the function signature the field is passed to, and the code that fills it — beats the enum name in the summary row |
| N4 | `CarState.team: number`, but `RamCar.team` is `0 \| 1` and N3's `worldFrom` already narrows it | **`0 \| 1`.** Same rule; a widening nobody wanted |
| N4 | `FirePrediction`'s ledger constructor is `(cfg)`, which cannot reach an arena or the predicted world | **`attach(ctx: FireContext)` added**, plus `advance`, `clear` and `stats`. Every ledger-listed member keeps its declared signature; purely additive |
| N4 | `RenderOffsets` had no way to apply an offset without counting a snap, so a ghost-shot handover would pollute the `snaps` counter phase 3 is graded on | **An optional third constructor argument**, `{ countSnaps?: boolean }`, defaulting to the current behaviour. Purely additive |
| N4 | `ContactEvent`'s ram caveat had no answer | Still true, and now points at shared `sim/ram-events.ts` for what N4 actually did instead. Two narrower limits recorded in its place |

Two conventions settled the same way:

- **Plan length.** The brief asks for 500–1,400 lines; every plan has run 1,400–3,800. The
  No-Placeholders rule wins. Do not send a plan back for being long, and do not let a worker elide
  code to hit the number.
- **Byte-budget numbers are re-pinned by whichever later phase moves them**, in that phase's own
  tasks, rather than by editing the earlier plan. N3 re-pins N2's codec tests; that is the pattern.

## 4. Open question for the user — not blocking, but recorded so it is not lost

**`resolveContacts` cannot supply a ram event.** It returns only the knock vector: no attacker, no
impact point, no severity. The ledger's `ContactEvent` declares a `"ram"` kind that therefore
**cannot be emitted**, and filling it in is an additive (behaviour-free) change to that function's
return value — which sits behind the root `CLAUDE.md` "stop and ask before changing … collision-damage
rules" fence.

N3 did not widen it. It declares the kind, pins its absence with a test, and points N4 at the
**`contact.touching` transition** as the source for ram feedback instead. That is enough to trigger
an effect, but it carries no impact point and no severity, so a ram spark cannot be placed at the
contact point or scaled to the hit.

Nothing is blocked. If the user wants contact-point-accurate ram feedback, they authorise the
`resolveContacts` return-value change and N4 (or a later pass) fills the event in. The caveat is
recorded inline in [`interfaces.md`](interfaces.md) beside `ContactEvent`.

**Narrowed by N4 (2026-09-05), and still open.** N4 recovered the attacker, victim, side and graded
severity **exactly**, without touching `resolveContacts`, by re-running the exported pure
`resolveRam` on the pairs that entered contact (shared `sim/ram-events.ts`). So `MatchEvent.ram` is
filled and ram feedback works. Two things are still not available and still need the user's word:

1. **The impact point.** `x, y` is the midpoint of the two hull centres. The true contact manifold
   point is computed inside `resolveRam`'s private `spinOf` and is not returned, so a spark lands
   within half a car of where the hulls actually met rather than on it.
2. **Dash and slam pairs are excluded, not re-classified.** `resolveContacts`' dash and slam
   branches are not exported, so a pair one of them claimed is dropped from the ram derivation
   through a `claimedPairs` set rather than being told apart by the same logic the sim used.

Both would be fixed by the same additive change to `resolveContacts`' return value. Ask the user
before making it.

## 5. The assignments, verbatim — a record of what each plan was asked for

**Every one of these has been written**, so nothing here is an instruction any more. They are kept
because an assignment is the only record of what a plan was *asked* for, which is how a later reader
tells whether it delivered — N6 and V5's assignments in particular, since those two plans depart from
their sketch in ways their own Handoffs argue for. Each was handed to a worker together with
[`plan-authoring-brief.md`](plan-authoring-brief.md), and every one ends with the same closing rule: *no model or AI product names anywhere in the plan;
nothing under `packages/client/src/match/` imports Phaser and no test imports Phaser; end with
`## Acceptance` and `## Handoff`; the 500–1,400 line target is a guide, not a cap — siblings run
1,400–3,800 lines and the No-Placeholders rule wins; do not elide code to hit a number.*

### N4 — `14-netcode-4-feel.md`

Prior phases landed, consumed by name and never re-specified: P, N0, N1, N2, and **N3, whose
`## Handoff` must be read in full — this plan sits directly on it**. `ArenaNet`,
`PredictionBuffer` and `InterpolationBuffer` are deleted by N3; do not reference them.

**Critical constraint from N3** (section 4 above): `ContactEvent`'s `"ram"` kind is declared but not
emitted, and widening `resolveContacts` is unauthorised. Build the ram side of this phase on the
`contact.touching` transition. If some effect genuinely cannot be driven without the richer event,
say so as a question for the user rather than widening `resolveContacts` in the plan.

Spec sections to read in full: §6.7 "Combat under latency" (N21, N22), §6.8 "Events" (N23a), §6.9
N25, §6.6 N31, §6.12, §7, §8 phase 4 row, §9. Also the rendering spec's R18a — the same decision
seen from the render side; this plan owns the sim-side half.

Ships (spec §8 phase 4 row, verbatim): "predicted fire state, maneuvers and ghost shots; events;
tick-time HUD; hp easing and flashes". Fixes F6. Acceptance: "ghost-shot mismatch < 0.5 % of
presses; press-to-flash within one frame; HUD readouts in tick time".

Must cover: (1) predicted local fire state — which part of the fire path is replicated client-side,
`runCombat` staying server-only and unchanged per N14, and how it stays a prediction the snapshot
overrides; (2) ghost shots reconciled by `instanceId(ownerIndex, shotSeq)`, the match/mismatch rule,
what happens to a ghost with no authoritative twin and vice versa, and how the mismatch rate is
counted for the < 0.5 % line; (3) predicted maneuvers and N31's telegraph-or-commit rule — state it
as a constraint on `WEAPON_TABLE` rows, read the actual table and say which shipped rows satisfy it
and which do not, implement the late-reveal-as-its-own-effect path, and **name any violating row for
the user rather than editing the balance table**, since that carries the manual-rebuild and
turn-tuning obligations; (4) the events channel as the single source of all feedback, with the full
event kind list and payloads matched to the ledger's `MatchEvent`, removing the sim-side guesswork
(V4 removes the render-side path in `impact-feedback.ts`); (5) tick-time HUD — every countdown,
recharge and lock readout from tick numbers, with hp the one value eased visually while the number
snaps; (6) measurement in `playtest/netcode.ts` (the one authorised harness — never create a new
probe file) for the ghost-mismatch rate and press-to-flash latency.

### N5 — `15-netcode-5-lifecycle.md`

Prior: P, N0–N4; read N4's `## Handoff` in full.

Spec: §6.10 "Connection lifecycle" in full (N26, N27), §6.12 failure modes in full, §7, §8 phase 5
row, §9. Ships: "reconnect, silence handling, late join". Fixes F12. Acceptance (spec §8 phase 5):
"a pulled cable resumes within 15 s". **Do not confuse the two reconnect numbers**: 15 s is how
quickly play resumes once the cable is plugged back in; `reconnectSeconds` = 60 is how long the
server holds the seat before giving up on the client (N26's `allowReconnection(client, 60)`).
Both are correct and they measure different things.

Must cover: reconnect through Colyseus `allowReconnection` with the 60 s window and what the car
does meanwhile (N26: brakes to a stop, stays killable and targetable); the silence warning and the
flood throttle (N27), both unit-tested; late join — a client joining mid-match seeding from a full
snapshot; and what each failure mode in §6.12 does now that it has a defined response. Say what
happens to the input ring, the lead controller and the jitter buffer across a resume.

### N6 — `16-netcode-6-optional.md`

Prior: P, N0–N5. **This plan is different from every other one: its tasks are evidence-gated and
are not scheduled.** Each task begins with the gate that must be observed true — in a real match's
netgraph or the harness output — before it is worth running, and the execution guide says the user
decides when. Write it as a set of independent, individually-runnable tasks, not a sequence.

Spec: §8 phase 6 row, §13 (volley compression), N31 (`thunderclap` wind-up as a balance change),
N12 (`MatchTransport` as the seam a transport swap goes through), plus anything §6 marks as deferred.

Tasks, each with its own gate and its own acceptance: volley compression; the Colyseus 0.18 upgrade
and a WebTransport transport behind the `MatchTransport` seam; `thunderclap`'s wind-up as an N31
balance change — which **is** a `WEAPON_TABLE` edit and therefore carries the `npm run build:manual`
step, the `docs/turn-tuning.md` check and the balance-fingerprint consequences, all of which the
task must spell out; and `remoteSteerHoldTicks` tuning driven by the harness over recorded logs.
A skipped task is recorded as skipped with its measured value, never deleted.

### V2 — `22-render-2-bake.md`

Prior: P, V0, and **V1, whose `## Handoff` must be read in full**. V1 already created
`render/bake.ts` (`bakeAtlas`, `BakeTier`, `BakeJob`, `bakeJobs`, `packShelf`, `bakedFrame`,
`bakedAtlasReady`, the `BAKE_*` constants) and `render/atlas.ts` (`BAKED_ATLAS`), registering the
HUD jobs only; also `render/fonts.ts`, `scenes/HudScene.ts`, `render/hud-feed.ts`,
`scenes/hud/hud-style.ts`, `scenes/hud/slot-model.ts`, the retained `SlotBarView`/`StatusStripView`/
`RosterView`, `sceneCensus` on `window.__bench`, and `scripts/hud-retained.test.mjs`. `ArenaLayers`
is deleted and `MatchBanners` moved into the HUD scene. **Extend those two files; do not re-create
them.**

Spec: §1 (the measured cost of the shipped world path — the 101-point `fillCircle`, `FillPath`
running Earcut per fill per frame with no caching, the allocation count), §3 (R1, R2, R3, R4, R6),
§4 the render stack and layer plan, §5 the catalogue in full, §6 baking (R13, R15, R11), §9 (R25),
§10 the V2 row, §11.

Ships (spec §10 V2 row, verbatim): "`bake.ts`, `baked-atlas`, `pack-atlas.mjs`; projectiles, glows,
orbs, hp bars, brackets, ghosts, arrows as sprites". Deletes: "`shotGfx` for projectiles, `hpGfx`,
`lockGfx`, `arrowGfx`, `maneuverGfx`". Acceptance: "no per-frame `Graphics` on the world path except
beams and debug; draw calls ≤ 16 at the ceiling".

Must cover: (1) `scripts/pack-atlas.mjs` (R15) for the *authored* art, writing
`public/art/art-atlas.{png,json}` and `ART_ATLAS`, respecting the repo's art rules — read
`docs/asset-pipeline.md` and the `check:art` script first and say how the packer interacts with it,
whether the loose PNGs still ship, and how the release build gets the atlas; (2) the world bake jobs
added to `render/bake.ts`, reusing the *existing pure builders* per R13 — identify them, do not
write new art code; (3) projectiles, glows and orbs as sprites, with the current `shotGfx` path
cited by file:line and the retained pool that replaces it, saying which shot kinds convert here and
which defer to V3, leaving `beamDrawLayers` plus debug as the only surviving world `Graphics`;
(4) hp bars, lock brackets, ghosts and maneuver arrows as sprites — an hp bar at N discrete fill
steps is a frame swap, and the step count must be justified at the on-screen size the way V1 chose
its ring steps; (5) the layer plan (R4) — the final layer list and depth order, and how a sprite
needing additive lands on the additive layer rather than setting its own blend mode; (6) draw calls
≤ 16 measured in the bench scene, with `sceneCensus` and `bench-arena.mjs` extended so a per-frame
world `Graphics` outside beams and debug **fails** rather than being spotted by eye, and V2's
numbers recorded beside V0's and V1's in `docs/render-bench.md`.

Repo rule to honour: art the cars-and-weapons guide draws is not covered by the manual page's
fingerprint. If this phase changes what `public/art/` contains or how it is loaded, say so loudly in
the commit step and point at `manual.html` and `npm run check:art`. Do **not** run
`npm run build:manual` for an art-packing change.

### V3 — `23-render-3-beams.md`

Prior: P, V0, V1, V2 (read V2's `## Handoff` in full) **and N1** — the execution guide's coupling 1:
the 60 Hz tick re-pins beam timings, and V3 authors them once, at 60 Hz. Say in the header that N1
must have merged.

Spec: §5 the catalogue's beam rows, §6 (R14 flipbooks baked from the procedural authoring code),
§2 (`Rope`, `BatchHandlerQuad` vs `BatchHandlerTriFlat`), §3 (R2 — per-frame geometry only for
changing shapes, as textured strips of ≤ 40 vertices), §7, §9, §10 the V3 row, §11.

Ships (spec §10 V3 row, verbatim): "flame flipbook, lance rope, tremor and aura sprites". Deletes:
"the last per-frame `Graphics` in the world path; `beamDrawLayers` becomes bake-only". Acceptance:
"no per-frame `Graphics` on the world path except debug; client JavaScript at the ceiling p95 < 5 ms
on the reference machine".

Must cover: the flame flipbook baked from the existing procedural flame authoring code (name the
frame count and justify it from the on-screen size and the beam's tick cadence at 60 Hz); the lance
as a `Rope` with its vertex count inside R2's ≤ 40; `tremor` and the `disc`-hitbox aura
(`magmablast`'s detonation) as sprites — read `WEAPON_TABLE` and the combat model doc so the right
rows are covered; the deletion of the last world `Graphics` path and `beamDrawLayers` becoming
bake-only; and the p95 < 5 ms measurement in the bench scene at the ceiling, recorded in
`docs/render-bench.md`. Beam geometry cost is §1's largest single line item (2.65 ms geometry +
3.88 ms earcut = 6.5 ms CPU/frame at the ceiling) — show the before and after.

### V4 — `24-render-4-events.md`

Prior: P, V0–V3 (read V3's `## Handoff` in full). **Coupling 2 from the execution guide:** V4's
bench scene fabricates `MatchEvent`s and runs on synthetic events until N4 has merged; the one-line
switch to real events lives in this plan and is applied when N4 lands. Say that in the header.

Spec: §5 the catalogue's transient rows, §7 particles in full (R5, R16), §11 R12a (the decal
mechanism), R18 (native camera shake and zoom punch from an event table), R9 (informative visuals
seeded by instance and tick, or driven by events), §10 the V4 row.

Ships (spec §10 V4 row, verbatim): "particle service, decal mechanism with no decals authored
(R12a), event-driven feedback, status flipbooks, shadows, muzzle flash". Deletes:
"`impact-feedback.ts`'s local detection". Acceptance: "particles capped per tier; every event kind
drives an effect on synthetic events; decal service empty and tested".

Must cover: the particle service with tiered global caps and priorities (R16), pooled with zero
allocation on the frame path; **the decal mechanism with no decals authored** (R12a) — a pooled
fading ground sprite with a global fade time overridable per decal, the service present, empty and
unit-tested, and the plan must be explicit that authoring a decal is out of scope; the `EffectRouter`
mapping every `MatchEvent` kind to an effect, with the synthetic-event path for the bench and the
one-line switch to real events; status flipbooks, shadows and muzzle flash; camera shake and zoom
punch from an event table (R18); and the deletion of `impact-feedback.ts`'s local detection.

### V5 — `25-render-5-pixels.md`

Prior: P, V0–V4 (read V4's `## Handoff` in full). Last plan in the rendering stream.

Spec: §8 cameras, scenes and pixels in full (R17 device-pixel-ratio rendering capped by tier, R17a
the explicit `render` config block, R19 camera-level filters at tier High only), §9 tiers, governor
and measurement in full (R10, R21, R22, R23), §10 the V5 row, §11.

Ships (spec §10 V5 row, verbatim): "tiers, governor, dpr, bloom and vignette at High, floor
ambience". Acceptance: "tiers auto-select and persist; dpr 1.5 sharp on a 150 % display; frame time
at the ceiling p95 < 12 ms at High and < 8 ms at Low on the reference machine".

Must cover: `render/tiers.ts` with `TIER_TABLE` and `TierManager`, and `export type Tier = BakeTier`
re-exported from `render/bake.ts` per the ledger — **V5 must not become a dependency of V1**; the
auto-tier probe and how the choice persists across sessions; the per-frame governor and what it
sheds first; device-pixel-ratio rendering capped per tier and what "sharp at 150 %" means concretely;
bloom and vignette as camera-level filters at High only (Phaser 4 has Filters, not `preFX`/`postFX`);
floor ambience; and the final measurement pass recording every tier's numbers in
`docs/render-bench.md` on the three target browsers (Chrome, Edge, Firefox).

## 6. Reference

- The ledger: [`interfaces.md`](interfaces.md) — every name the plans share. **It outranks any
  plan; the specs outrank it.**
- Executing the plans once written: [`00-execution-guide.md`](00-execution-guide.md), including the
  per-phase gates and the approach-B checkpoint.
- The repo rules every plan must obey: root `CLAUDE.md` and the three package `CLAUDE.md` files.
- `docs/ideas/` and `docs/invariants/` are the user's private notes and are **out of scope** for
  plan-writing unless the user names a file in them in the request at hand.
