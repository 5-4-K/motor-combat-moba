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
| C — 60 Hz and per-tick snapshots | [`C-sixty-hz.md`](C-sixty-hz.md) | NR11–NR16 | Landed | 60 Hz, one snapshot per tick; handling unchanged in closed form (radius 89.9 u, 90% top speed 1.79/2.21/2.59 s), slip −1.1 to −1.6°; TTK ±0.1 s; planner bench over its gate (see In flight) |
| D — time and inputs | [`D-time-and-inputs.md`](D-time-and-inputs.md) | NR17–NR28, NR54–NR56 | In progress — D1–D3 landed; D4 parked on local `wip/d4-input-switch` | see In flight |
| E — remotes and prediction | [`E-remotes.md`](E-remotes.md) | NR29–NR34 | Not started | |
| F — combat under latency | [`F-combat.md`](F-combat.md) | NR35–NR41 | Not started | |
| G — interest management, docs | [`G-interest.md`](G-interest.md) | NR42–NR49, NR68 | Not started | |

## In flight

**CHECKPOINT (2026-09-30, stopped at the user's request).** `development/main` is at D3
(`32352125`), clean and green except the known failures (two G12 bot tests, planner bench P33).

Landed in Phase D, each reviewed:
- **D1** `tick-input.ts`: `InputFrame`, hardened `isInputPacket` (fire mask bounded to the wire mask,
  whitelisted copies, sparse arrays rejected) and `TickInputBuffer`.
- **D2** `ClockSync`, `InputScheduler`, `TickPrediction`. After four review rounds ClockSync is a
  weighted offset+drift fit held to an acceptance envelope (≤ 25 ms error, zero snaps across
  jitter 0–30 ms × drift ±1 % × spikes 0–20 %; route steps ≤ 1 snap; 0 late inputs at 60/144 fps).
  Spec NR18/NR20/NR21 were rewritten to match. `NET_CONFIG.clientMaxCatchUpTicks: 8` is the client
  knob (the plan's `maxCatchUpTicks` name belongs to the server stepper, 5). `ClockSync.rttMs()`
  is ≈ min RTT, not a median — never show it as "ping".
- **D3** time-sync (`MSG_TIME`) and server-measured RTT (`MSG_PING`) on every room; pongs describe
  the steady tick grid (`markTick(tick, wallNow − stepper.remainderMs)`).

**D4 (the one-input-per-tick switch) is parked on the LOCAL branch `wip/d4-input-switch`
(`12d974d7`, not pushed, not green).** Brief steps 1–5 are coded; shared/client suites, the server
rooms/sim/net subset and netsim pass; `stepsPerTickMax` reads 1 on every link. Still to do before it
may land (it lands as one reviewed set, never piecemeal):
1. root `npm run build`, `npm run typecheck`, full server suite (~11 min), `npm run test:scripts`;
2. the live `npm run playtest:lan` smoke;
3. task review, then squash into the real D4 commit(s) and push.
Known from the WIP: net80 repeated-input ticks 3.93 % (target ≤ 2 %, loss-driven; slack tuning is
D6's); lan input-to-server 34.0 ms (on the limit); playtest probe W6's input-flood arm no longer
exercises its exploit (one frame per tick now) and `common/collision`'s silent-coast scenarios cite a
deleted knob — recommend `npm run playtest -- --scope=all` after D4.
If the container was reclaimed and the branch is gone, redo D4 from its brief.

**Queued, in order:**
- **User decision (2026-09-30): raise the P33 planner budget to 37 ms** of CPU per simulated second
  (`BUDGET_MS` 30/90 → 37/90 in `planner.bench.test.ts`), re-measure its `MEASURED_RATIO` at 60 Hz
  per the file's own procedure, update the comments/docs citing 30 ms.
- **D5 hardening**, plus carried rulings: ClockSync must not trust one spiked pong after a ≥ 6 s
  pong gap; NR21's slack target gains a spread term (≈ mean + 1·`slackStdTicks()`) so a jittery
  input path stops landing late; `onPingEcho` accepts only server-issued stamps (server RTT will feed
  F1's shot-compensation cap); move `ServerError(4003)` off `CloseCode.FAILED_TO_RECONNECT`; restrict
  matchmaker CORS to `CLIENT_ORIGIN` when set.
- **D6** measure and document.
- Then phases E, F, G.

Tooling notes for the executor:
- Plan task headings are numeric (`### Task 1 (A1): …`) so `task-brief PLAN_FILE N` finds them;
  each phase file is its own SDD plan with its own workspace under `.superpowers/sdd/<phase>/`
  (git-ignored — the D ledger and reports live there and are lost if the container is reclaimed;
  this block is the durable record).
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
| Server steps per car per tick (max) | 1 | 4 (4–4) (net80; lan 1) | 1 (1–1) (lan, net80, net150) | | | |
| Repeated-input ticks, net80 | ≤ 2 % | n/a | 3.93 % (3.66–4.21 %) | | | |
| Remote path error p95, net80 (u) | ≤ 12 | 0.13 (0.12–0.13) | 0.00 | | | |
| Remote hold frames, net80 | ≤ 1 % | 3.62 % (2.75–4.73 %) | 1.23 % (1.11–1.39 %) | | | |
| Local reconcile correction p95, net80 (u) | ≤ 4 | 0.86 (0.47–1.51) | 1.23 (0.75–2.05) | | | |
| Input-to-server delay, lan (ms) | ≤ 34 | 21.7 (20.7–23.3) | 34.0 (33.9–34.0) | | | |
| Remote display delay, lan (ms) | no worse than baseline; interpolation component ≤ 50 | 67.4 (66.8–67.9) | 50.4 (49.9–50.8) | | | |
| Hidden enemy present in decoded state | never | n/a | n/a | n/a | n/a | |

Each Baseline cell is the MEAN over seeds 1–3, with the min–max across the three seeds in
brackets. **Phases C–G compare on this shape: `NETSIM_BASELINE=1`, 60 s, six cars, seeds 1–3,
mean.** (The 20 s seed-1 runs in `netsim.test.ts` are a smoke test, not a comparison point.)

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
