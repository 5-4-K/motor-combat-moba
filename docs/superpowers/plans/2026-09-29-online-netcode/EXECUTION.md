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
| A — Colyseus 0.18, schema 5, Node 22, monitor gate | [`A-colyseus-upgrade.md`](A-colyseus-upgrade.md) | NR50, NR53 | Landed | `playtest:lan` smoke passed in A2; lockfile on a single schema 5.0.34 |
| B — netsim harness and today's baseline | [`B-netsim-harness.md`](B-netsim-harness.md) | NR57–NR59 | Landed | Baseline recorded below (legacy client, 60 s, six cars, mean of seeds 1–3) |
| C — 60 Hz and per-tick snapshots | [`C-sixty-hz.md`](C-sixty-hz.md) | NR11–NR16 | Landed | 60 Hz, one snapshot per tick; handling unchanged in closed form (radius 89.9 u, 90% top speed 1.79/2.21/2.59 s), slip −1.1 to −1.6°; TTK ±0.1 s; planner bench: P33 budget raised to 37 ms by user decision 2026-09-30 (resolved, see In flight) |
| D — time and inputs | [`D-time-and-inputs.md`](D-time-and-inputs.md) | NR17–NR28, NR54–NR56 | Landed (final review clean, `648bf4a3`) | Tick-stamped inputs, one per car per tick (speed hack closed, steps/tick 1 on every link), `ClockSync` + slack-steered `InputScheduler`, hardening; numbers in the table below |
| E — remotes and prediction | [`E-remotes.md`](E-remotes.md) | NR29–NR34 | Landed (final review fixes landed) | Remotes drawn at an adaptive tick-keyed delay (33–250 ms) with capped dead reckoning from `lastSteer`/`lastThrottle`, predicted against at their reckoned pose, contact-blended within 2 car lengths; `PROTOCOL_VERSION` 2; numbers in the table below |
| F — combat under latency | [`F-combat.md`](F-combat.md) | NR35–NR41 | Not started | |
| G — interest management, docs | [`G-interest.md`](G-interest.md) | NR42–NR49, NR68 | Not started | |

## In flight

**Phase E is landed (E1–E5), and its whole-phase final review's findings are fixed** (I1–I3, M1–M5; M6 parked, below). **Next: Phase F** (combat under latency, NR35–NR41). Known failures: the two G12 bot tests only. Phase D is landed and its final review is clean (`648bf4a3`).

Phase E (E1–E4 each reviewed; E5 = numbers and docs):
- **E1** `PlayerState.lastSteer`/`lastThrottle` (int8, every car every tick), shared `RemoteReckoner` (stepSim dead reckoning cached per snapshot, capped `maxExtrapolateMs`), `PROTOCOL_VERSION` 2.
- **E2** `TickInterpolation`, `DisplayDelay` (p95 lateness + one snapshot interval, 33–250 ms, ≤ 1 ms/frame), shared `RemoteTimeline` used by `ArenaScene` and the netsim tick client, settle ease, `remoteTeleportCars`; `InterpolationBuffer` and `interpolationDelayMs` deleted.
- **E3** remotes at their reckoned pose in `StepContext.others` for prediction and replay; prediction uses each frame's own tick for statuses; prediction cleared on practice/playground resume; lateness samples deduped by tick.
- **E4** contact blend within `contactBlendRangeCars` (2): fractional-tick target, eased final pose, slewed weight.
- **E5** numbers (table below) and docs. API note for Phase G: forgetting a remote is `RemoteTimeline.forget(id)` (there is no `interp.reset()`).

- **Final-review fixes:** the contact blend's final settle arms only when its target is replaced (a snapshot rebasing the reckoning, or an anchor-tick jump of more than a tick), with the gap measured old-target − new-target at the same tick — this removed the standing ~15° heading lag on a turning remote within 2 car lengths only while the anchor sat inside the 6-tick reckoning cap (I1, i.e. on `lan`); past the cap (98 % of blend samples on `net80clean`) every snapshot still "rebased" by one tick of the car's own motion and the drawn remote trailed the collided pose by ~5 frames (re-review I4: 14.2 u p95 on net80clean). Fix round 2 measures the gap at a tick both reckonings reach (the cap advance of one snapshot interval is drawn, a longer one eased), sets `ANCHOR_JUMP_TICKS` to 0.5 (an anchor advance of zero to one frame is normal; anything more than half a tick outside it is eased), adds `RemoteTimeline.blendTarget` and the netsim blend-lag metric, and makes `jumpExcess` compare displacement vectors; a paused practice/playground room holds every remote at its newest snapshot and clamps the blend's anchor there (I2); the netsim client builds its anchor through the shared `localAnchorOf` exactly as `ArenaScene` does, and the netsim scores heading, per-frame jump beyond own motion, and the blend range separately (I3); a remote stepped after the local car on the server is reckoned to `tick − 1` for prediction (`remotePoseTickFor`, M1); a same-tick patch with a changed pose is drawn (M2); the clock-ready step eases (M3); docs (M4, M5).

Phase E parked items (Minor): per-frame `localAnchor`/`blendPose` allocations in the contact blend; a wreck snaps forward on death by the adaptive delay × speed (final review M6, predates E). (The anchor switching off and on with a reset tick is now eased as an anchor-tick jump.)

**Playtest note (a USER question):** the `prediction` probe (`packages/server/playtest/common/prediction.ts`) still models the pre-E3 client (remotes frozen at their snapshot pose, arrival-time interpolation). Update it? Not touched. **Recommended: `npm run playtest -- --scope=all`.**

Phase D (each task reviewed):
- **D1** tick-stamped `InputFrame`s, hardened `isInputPacket`, `TickInputBuffer`.
- **D2** `ClockSync` (weighted offset+drift fit, held to an acceptance envelope), `InputScheduler`, `TickPrediction`. Client knob is `NET_CONFIG.clientMaxCatchUpTicks: 8`; the server stepper's is `maxCatchUpTicks: 5`. `ClockSync.rttMs()` ≈ min RTT — never show it as "ping".
- **D3** `MSG_TIME`/`MSG_PING` on every room; pongs describe the steady tick grid.
- **D4** one input per car per tick — the speed hack is closed; client blends on the server tick phase; clock and scheduler rebuilt on a practice/playground resume.
- **D5** hardening: per-kind token buckets (kick after 5 s over), 4 KiB `maxPayload`, `maxMessagesPerSecond` 1000, unknown message types disconnect, `PROTOCOL_VERSION` 1, close codes 4100–4112, matchmaker CORS pinned to `CLIENT_ORIGIN`, ping echo validation, two-way in-order latency/loss injector.
- **D6** (a) tuning: late slack samples floored at `LATE_SLACK_FLOOR_TICKS` (-1), `SAFETY_GAIN` 0.03, `slackSpreadK` 1 — the user ruled **latency over repeats** on a lossy link — and the `net80clean` link added; the spec's §1 targets were revised to match (strict on `lan` and `net80clean`; a lossy link degrades at its own player's cost; targets bind the mean over seeds 1–3). (b) docs: `networking.md`, `config-reference.md` (`NET_CONFIG` table, env knobs), `schema-reference.md` and the stale `InputMessage`/`seq` mentions rewritten.

**Carried into Phase E and later:**
- **Uplink-only stall defect (estimator).** When only the uplink stalls, the server keeps re-reporting a stale slack window (`inputSlack`/`inputSlackStd` are a 30-sample window refreshed every tick) and the client integrates it as if each snapshot carried a NEW sample. Needs a per-sample sequence / "new samples only" fix (e.g. a sample counter on the schema the client differences). Not fixed in D.
- **Phase D final-review parked items** (all Minor): prediction reads the snapshot tick's statuses rather than the frame's tick (→ E, prediction); `ArenaScene.prediction` is not cleared on a practice/playground resume, so the first 1–3 post-resume frames are refused as non-ascending and self-heal in < 50 ms (→ E3, call `prediction.clear()` on the resume edge); owner-only slack fields reach every client (→ G); Colyseus ROOM_REQUEST frames bypass the unknown-type disconnect; after a stall the input bucket keeps the oldest frames (that player's cost only); Colyseus times its frame delta with `Date.now()`, so a host clock step costs one 16 ms tick backward or a ≤ 5-tick catch-up forward; the slack gain/deadband/window are named consts outside `NET_CONFIG`.
- **NR36's compensation cap** must be sized in Phase F from an honest `net80clean` client (its measured input-to-server 74.3 ms), not from net80, and must not grow with a bad link.

**Open questions for the user (playtest probes are theirs to change):**
- Probe W6 (fire-rate exploit) no longer exercises its flood arm since D4 (one input per tick) — re-express or retire it? The `collision` probe's comments still cite the deleted silent-coast path.
- `playtest/lan.ts`'s `PHASE` table predates this work (prints "COUNTDOWN" during a live match and starts its trials during REVEAL) — fix it?
- **Recommended: `npm run playtest -- --scope=all`** — the input path every probe drives changed (one input per tick through `TickInputBuffer`) on top of Phase C's 60 Hz.

Tooling notes for the executor:
- Plan task headings are numeric (`### Task 1 (A1): …`) so `task-brief PLAN_FILE N` finds them;
  each phase file is its own SDD plan with a git-ignored workspace under `.superpowers/sdd/<phase>/`
  (lost if the container is reclaimed — this block is the durable record).
- The full server suite takes ~11 min at 60 Hz.

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
| Server steps per car per tick (max) | 1 | 4 (4–4) (net80; lan 1) | 1 (1–1) (lan, net80clean, net80, net150) | 1 (1–1) (lan, net80clean, net80, net150) | | |
| Repeated-input ticks | `lan`, `net80clean` ≤ 2 %; `net80` ≤ 4 % (its own player's cost) | n/a | lan 0.11 % (0.11–0.11); net80clean 0.39 % (0.37–0.42); net80 3.69 % (3.46–3.93); net150 8.14 % (7.83–8.44) | lan 0.11 % (0.11–0.11); net80clean 0.39 % (0.37–0.42); net80 3.69 % (3.46–3.93); net150 8.14 % (7.83–8.44) | | |
| Remote path error p95, net80 (u) | ≤ 12 | 0.13 (0.12–0.13) | 0.00 (0.00–0.00) | 0.03 (0.01–0.07) (lan 0.00 (0.00–0.00); net80clean 0.03 (0.00–0.09); net150 0.04 (0.00–0.06)) | | |
| Remote hold frames, net80 | ≤ 1 % | 3.62 % (2.75–4.73 %) | 1.28 % (1.21–1.39 %) | 0.013 % (0.009–0.018 %) (lan 0.005 % (0.001–0.010 %); net80clean 0.007 % (0–0.018 %); net150 0.21 % (0.20–0.23 %)) | | |
| Local reconcile correction p95 (u) | ≤ 4 on `lan` and `net80clean`; lossy links reported | net80 0.86 (0.47–1.51) | lan 0.28 (0.13–0.49); net80clean 1.07 (0.45–1.85); net80 1.22 (0.60–2.15); net150 2.01 (1.18–2.63) | lan 0.22 (0.03–0.46); net80clean 0.77 (0.22–1.54); net80 0.76 (0.35–1.51); net150 1.46 (0.86–1.84) | | |
| Input-to-server delay, lan (ms) | ≤ 34 | 21.7 (20.7–23.3) | 33.99 (33.95–34.02) | 33.99 (33.95–34.02) | | |
| Input-to-server delay, net80clean (ms) | ≤ 91 (lan's 34 + half RTT + 1 tick) | n/a | 74.3 (74.2–74.4) | 74.3 (74.2–74.4) | | |
| Remote display delay, lan (ms) | no worse than baseline; interpolation component ≤ 50 | 67.4 (66.8–67.9) | 50.4 (49.9–50.8) | 30.9 (30.0–31.7) | | |
| Remote heading error p95, all samples (deg) | reported, no target | n/a | n/a | lan 0.00 (0.00–0.00); net80clean 0.01 (0.00–0.03); net80 0.02 (0.00–0.05); net150 0.02 (0.00–0.03) | | |
| Remote path error p95 within blend range (u) | reported, no target | n/a | n/a | lan 0.94 (0.52–1.45); net80clean 2.69 (1.80–3.67); net80 2.22 (2.07–2.41); net150 1.92 (1.74–2.06) | | |
| Remote heading error p95 within blend range (deg) | reported, no target | n/a | n/a | lan 2.93 (2.29–3.79); net80clean 7.78 (5.28–10.96); net80 5.62 (4.96–6.88); net150 5.74 (4.96–6.34) | | |
| Remote blend lag p95 — drawn vs the blend's own target (u / deg) | reported, no target | n/a | n/a | lan 1.31 (1.09–1.61) / 1.57; net80clean 1.92 (1.27–2.73) / 3.53; net80 3.06 (2.81–3.31) / 4.93; net150 3.50 (3.04–4.07) / 5.40 | | |
| Remote drawn jump, \|Δdrawn − Δtrue\| max / p99 (u) | reported, no target | n/a | n/a | lan 4.73 (4.21–5.62) / 0.33; net80clean 5.43 (3.53–6.76) / 0.62; net80 6.75 (5.07–9.21) / 0.82; net150 7.53 (5.98–8.89) / 1.10 | | |
| Hidden enemy present in decoded state | never | n/a | n/a | n/a | n/a | |

Each Baseline cell is the MEAN over seeds 1–3, with the min–max across the three seeds in
brackets. The "after D" column is the Phase D close build, `development/main` at `76df1343`
(D6 tuning: late slack floor −1, gain 0.03, `slackSpreadK` 1, `targetSlackTicks` 1.5), measured
2026-10-01 with the command below. The Baseline column has no `net80clean` or per-link repeat data
(the link and the metric came later); the baseline's net80 is a 30 Hz legacy-client run, so its
reconcile and hold figures move with the message rate as explained below. `net80clean` is 80 ms RTT,
±2 ms jitter, 0 % loss (the good connection); the strict targets bind it and `lan`. Other "after D"
rows not in the table: net80 input-to-server 78.3 ms (78.1–78.6), display delay 91.6 ms; net150
input-to-server 118.0 ms (117.8–118.2), hold frames 3.88 % (3.73–4.06 %), display delay 131.4 ms.
Net150 and net80 repeated inputs, extra latency and corrections are the cost of that player's own
lossy link, by design (spec §1). **Phases C–G compare on this shape: `NETSIM_BASELINE=1`, 60 s, six
cars, seeds 1–3, mean.** (The 20 s seed-1 runs in `netsim.test.ts` are a smoke test, not a comparison point.)

The "after E" column is the Phase E close build after its final-review fixes (`development/main` at `f6374c9f` plus the commit `fix(net): phase E final review — contact-blend heading, paused render tick, honest netsim`, the commit that records this paragraph), measured 2026-10-01 with the same command, and re-measured after fix round 2 (`c4d73cad` plus the commit `fix(net): contact blend past the reckoning cap (phase E re-review I4)`, the commit that records this sentence) — the column now holds the round-2 figures; it replaces the first "after E" figures, taken at `b21a7974`. Round 2 moved: net80 hold 0.005 % → 0.013 %, net80clean display delay 57.4 → 55.3 ms, net80 74.3 → 72.7, net150 144.2 → 143.0, and the blend-range rows (the drawn remote now sits on the capped reckoned pose prediction collides with, which the nearest-point path/heading scores read as farther from the true path on links past the cap — the blend-lag row is the one that reads a drawn pose trailing its own target, 14.2 u p95 on net80clean at `c4d73cad` per the re-review, 1.92 now). The jump row is now a vector difference and skips spans touching a death or respawn. The cells the fixes moved: path error p95 (net80 0.08 → 0.03, lan 0.03 → 0.00, net80clean 0.14 → 0.04, net150 0.07 → 0.04), reconcile p95 (lan 0.25 → 0.22, net80clean 0.81 → 0.77, net80 0.77 → 0.76, net150 1.47 → 1.46), lan display delay 31.1 → 30.9 ms; steps, repeats, holds and input-to-server did not move. The "reported, no target" rows are new with the fixes (final review I3; the blend-lag row with fix round 2); the blend-range rows cover the 2–9 % of samples drawn within `contactBlendRangeCars` of the local car (`NetsimDiagnostics.blendSamples`). For scale, the same 20 s seed-1 run with the pre-fix `RemoteTimeline` reads 12.3–14.6° blend-range heading p95 on every link (after: 1.4–2.9°) — the I1 lag the old metrics could not see. The lan display delay sits below the 33 ms `minDelayMs` floor because it includes the contact-blended samples, which are drawn AHEAD of the render tick (at the local car's predicted tick) and read as negative delay — the cell mixes the interpolation path with the contact blend; the interpolation component alone is bounded by `minDelayMs`. Other "after E" rows not in the table: net80clean display delay 55.3 ms (53.1–57.0); net80 input-to-server 78.3 ms (78.1–78.6), display delay 72.7 ms (70.5–74.5); net150 input-to-server 118.0 ms (117.8–118.2), display delay 143.0 ms (141.5–144.2) — net150's display delay rose from D's 131.4 ms because the adaptive delay (p95 lateness + one snapshot interval) widens on a lossy link, which is its design and that player's cost. **Targets, all met:** `lan`/`net80clean` path error p95 ≤ 12 u (0.00 / 0.03), hold ≤ 1 % (0.005 % / 0.007 %), reconcile p95 ≤ 4 u (0.22 / 0.77), repeats ≤ 2 % (0.11 % / 0.39 %), input-to-server unchanged from D, LAN display delay 30.9 ms against the baseline's 67.4 (and D's 50.4), its interpolation component bounded by `minDelayMs` 33 ms ≤ 50. No deviations. Dropped inputs net80 667–729 per run, net150 1532–1642 (a lossy link's own cost).

Baseline at net150 (same run shape, mean and min–max): steps per tick max 5 (5–5), remote path error
p95 0.12 u (0.11–0.12), remote hold frames 7.09 % (6.15–8.06 %), local reconcile correction p95
2.71 u (2.05–3.28), input-to-server delay 96.5 ms (96.1–97.1), remote display delay 139.2 ms
(138.1–139.8). (For reference, net80's input-to-server delay is 57.3 ms (57.2–57.4) and display
delay 105.6 ms (103.7–106.6); lan's hold rate is 0.006 % (0–0.011 %), its reconcile p95 0.38 u
(0.34–0.44).)

**The same legacy client at 60 Hz (after Phase C, same run shape: 60 s, six cars, seeds 1–3,
mean and min–max).** This is the comparison point for Phases D–G; the Baseline column above stays
the 30 Hz record.

| Metric | lan | net80 | net150 |
|---|---|---|---|
| Server steps per car per tick (max) | 1 (1–1) | 7 (7–7) | 10 (10–10) |
| Remote path error p95 (u) | 0.00 | 0.00 | 0.00 |
| Remote hold frames | 0.008 % (0.003–0.011 %) | 6.40 % (5.93–6.93 %) | 12.00 % (11.58–12.82 %) |
| Local reconcile correction p95 (u) | 0.03 (0.01–0.06) | 0.49 (0.20–0.90) | 1.63 (0.90–2.63) |
| Input-to-server delay (ms) | 9.2 (9.2–9.3) | 51.3 (51.3–51.4) | 92.0 (91.8–92.2) |
| Remote display delay (ms) | 50.1 (49.0–50.7) | 88.3 (87.9–88.9) | 121.5 (120.7–122.7) |

Recorded with `maxInputsPerTick` 10 and `pendingInputCap` 48 (doubled with the flip, see In
flight), and — **re-recorded after the final review** — with two changes the first 60 Hz table did
not have: the netsim's scripted driver now holds each set of keys for a wall-clock span
(333–1667 ms, the 10–50-tick span at 30 Hz, converted with `TICK_RATE_HZ`) instead of a tick count
that had halved every hold at 60 Hz, and the reconcile ease is rescaled per snapshot (I2 above).
Attribution, measured by running the new driver with the old unscaled ease: hold frames move with
the driver alone (net80 6.40 %, net150 12.00 % either way), while the reconcile p95 rise is the
ease — new driver with the unscaled ease reads lan 0.01, net80 0.07, net150 0.52; with the rescaled
ease 0.03 / 0.49 / 1.63. That is the ease doing what it was fixed to do: a correction now takes the
same wall-clock time as at 20 Hz snapshots, so more of each correction is still outstanding at any
one reconcile sample. Dropped inputs per run: lan 1–2, net80 21–26 (30 Hz: 14–15), net150 83–103
(30 Hz: 77–85); deaths lan 4/4/5, net80 5/4/6, net150 6/3/5 for seeds 1/2/3. With the old caps of
5/24 dropped inputs had risen to 172–202 and 975–1029, and the steps-per-tick maximum rises with
the cap (a catch-up burst now drains up to 10 inputs).

Read two rows with care: **reconcile p95 (one sample per reconcile) and hold frames (head-of-line
stalls, per message) shift with the message rate alone** — three times as many snapshots per second
means three times as many reconciles and three times as many losses to stall the stream behind — so
a move in those rows is not by itself a netcode change. Hold frames rose (net80 3.62 → 6.40 %,
net150 7.09 → 12.00 %) for exactly that reason. Input-to-server and display delay fell with the tick
quantum (lan 21.7 → 9.2 ms and 67.4 → 50.1 ms). Path error fell to float noise: a snapshot every
tick leaves no chord between patches to cut.

The remote display delay row is the TOTAL delay the harness measures — interpolation delay plus
snapshot age plus link plus frame — so its LAN target is "no worse than today's" on that total; the
spec's ≤ 50 ms applies to the interpolation component alone (today's is 50 ms, `NET_CONFIG.interpolationDelayMs`).

Link model: single retransmit at +1 RTT on loss (optimistic vs real TCP RTO) — the netsim's loss
numbers are a floor, not a forecast. Reproduce with
`npm run build -w @motor-combat-moba/shared && NETSIM_BASELINE=1 NETSIM_REPORT=1 npx vitest run --root packages/server src/netsim`
(`netsim.baseline.test.ts` prints each seed's metrics and diagnostics, then the mean/min/max per
metric; about 30 s in all). `NETSIM_REPORT` also prints each run's diagnostics — inputs produced,
inputs acked but never simulated (`droppedInputs`: legacy's `maxInputsPerTick` cap discarding a
backlog, and inputs drained while a car is dead; 2–6 per 60 s run on lan, 14–15 on net80, 77–85 on
net150), inputs still unacked at the end, samples scored and deaths.

Remote path error measures distance to the true trajectory, not lag: today's interpolation only
ever draws poses the car really passed through, so its baseline is near zero by construction (the
residual is the chord between patches on a curve) and its delay shows up in the display-delay row
instead. The metric exists to bound later phases' extrapolation. The trajectory it is judged
against runs from 400 ms before to 100 ms after the frame (100 ms is NR31's dead-reckoning cap), so
a remote drawn ahead on its true path scores ~0 error, and display delay is signed (negative when
drawn ahead). An exact distance tie — a stationary car — resolves to the point nearest the frame's
time, so standing still reads as zero delay, not as drawn ahead. Widening the window did not move
the legacy path error; it moved legacy display delay by under 0.5 ms (20 s seed 1: lan 69.45 →
69.40, net80 107.92 → 107.85, net150 141.20 → 140.80). Checked on net80, all of it comes from a car
reversing back over its own track, where the drawn pose lies on both the past and the future path:
19 of 35 825 samples, each flipping from +90–118 ms to between −4 and −88 ms, at distance 0 either way.

Truth is the per-tick server pose linearly interpolated to each frame's time (and the truth window
has interpolated endpoints), so the path, delay and hold metrics do not move with the tick rate
when Phase C goes to 60 Hz. Remotes are sampled only while alive on the server AND drawn alive by
the client — a car the client still draws as a wreck is skipped and its hold history reset — so
the respawn mismatch between the two is not scored as holds or path error. A respawn teleport is
still scored as if the car travelled the straight segment between its death and spawn poses (the
client's interpolation buffer draws that segment too, for one patch interval). The 60 s baseline
runs had 3–6 deaths each (lan 5/5/3, net80 5/4/5, net150 5/4/6 for seeds 1/2/3) against ~100 000
remote samples per run, so the effect is negligible; the 20 s seed-1 runs had none. Server times
are stamped at exact tick times (`tick × MS_PER_TICK`) while the harness
runs on integer milliseconds, a ≤ 1 ms bias that is the same in every phase.

## Deviations from the plan

- **SDK auto-reconnect is switched off deliberately.** @colyseus/sdk 0.18 defaults `room.reconnection.enabled` to true, but the server never calls `allowReconnection`, so a killed server left the client never firing `onLeave`. `connection.ts` (and `playtest/lan.ts`) disable it after every join; reconnection is a future designed feature.
- **The monitor refuses cross-site requests.** Core 0.18 reflects any `Origin` with credentials on all HTTP routes, so `/colyseus` now 403s a cross-site `Sec-Fetch-Site` or a foreign `Origin` and strips the reflected CORS headers. Matchmaker CORS hardening is deferred to Phase D.
- **The release zip carries `engines: node >=22`, and the server exits with a clear message on older Node** (the check runs after hoisted imports evaluate, which is enough for a clear message).
- **`ServerError(4003)` in `ArenaRoom` collides with `CloseCode.FAILED_TO_RECONNECT`** — parked for Phase D's protocol work.
- **Carried to Phase B:** `watchRoomMode`'s immediate fire under the real SDK decoder is unit-tested only against a mocked `Callbacks.get` (the `playtest:lan` smoke never calls it); a live probe confirmed it works. A real-decoder check belongs with the netsim harness. Matchmaker CORS stays permissive (reflects any Origin) until Phase D.
