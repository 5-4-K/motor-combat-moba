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
| C — 60 Hz and per-tick snapshots | [`C-sixty-hz.md`](C-sixty-hz.md) | NR11–NR16 | Landed | 60 Hz, one snapshot per tick; handling unchanged in closed form (radius 89.9 u, 90% top speed 1.79/2.21/2.59 s), slip −1.1 to −1.6°; TTK ±0.1 s; planner bench over its gate and the K=0 corner case open (see In flight) |
| D — time and inputs | [`D-time-and-inputs.md`](D-time-and-inputs.md) | NR17–NR28, NR54–NR56 | Not started | |
| E — remotes and prediction | [`E-remotes.md`](E-remotes.md) | NR29–NR34 | Not started | |
| F — combat under latency | [`F-combat.md`](F-combat.md) | NR35–NR41 | Not started | |
| G — interest management, docs | [`G-interest.md`](G-interest.md) | NR42–NR49, NR68 | Not started | |

## In flight

**Phase C landed; Phase D, Task 1 (D1) is next** — [`D-time-and-inputs.md`](D-time-and-inputs.md),
`InputFrame`, packet validation and `TickInputBuffer`.

Phase C landed 2026-09-29: the sim runs at **60 Hz** (`TICK_RATE_HZ`) and every room broadcasts
**one snapshot per snapshot tick** (`SNAPSHOT_RATE_HZ` 60, `patchRate = null`, `broadcastPatch()` at
the end of each tick `isSnapshotTick` names, `rooms/snapshot-cadence.ts`); `DEFAULT_PATCH_RATE_HZ`
is deleted and hard invariant 5 is reworded (NR11–NR13). The netsim harness sends a snapshot at the
end of each snapshot tick exactly as the rooms do. No drive-model rule changed (NR15); what the step
size moved, measured:

- **Handling (NR15).** Every closed-form figure in `docs/turn-tuning.md` is rate-independent and
  did not move — turn radius 89.9 u for all three shipped chassis at top speed, time to 90% of top
  speed Mirage 1.79 s / Bullseye 2.21 s / Bastion 2.59 s, before and after. Only the per-tick rows
  halved (turn per tick Mirage 0.1052 → 0.0526 rad, Bullseye 0.0883 → 0.0441, Bastion
  0.0756 → 0.0378; spin kept per reeling tick 0.9355 → 0.9672). Stepped through the real
  `stepDrive`, dt 1/30 → 1/60: measured time to 90% Mirage 1.800 → 1.800 s, Bullseye 2.233 →
  2.217 s (tick quantization), Bastion 2.600 → 2.600 s; the settled full-lock circle is unchanged
  (Mirage 39.75 → 39.74 u, Bullseye 39.39 → 39.39, Bastion 38.57 → 38.57, at ~125 / 107 / 95 u/s);
  the settled full-lock slip angle drops 1.1–1.6° (Mirage 39.5 → 37.9°, Bullseye 35.8 → 34.5°,
  Bastion 32.5 → 31.3°) — the discretization gap above the closed form roughly halving. Velocity
  at a given wall-clock time is identical at both rates (the command/drag integrator is closed
  form); positions differ by a fraction of a unit. `golden.test.ts` keeps its dt 1/30 block as the
  rate-independent integrator pin and gains a dt 1/60 block pinning the shipped rate.
- **TTK (`npm run ttk`).** Moves by tick rounding only, ≤ 0.1 s: Mirage→Bullseye 3.7 → 3.6 s,
  Bastion→Bullseye 6.7 → 6.6 s, Bastion→Bastion-class 11.5 → 11.4 s (weapons-only Bastion→Bullseye
  10.7 → 10.6 s); every other cell unchanged.
- **Planner bench (NR16, P33).** Hard's horizon is ms-authored, so it doubles in ticks (K 22 → 44)
  while its replan cadence stays 15 Hz (`recomputeMs` 67 → 2 → 4 ticks). Per plan: best 0.326–0.338
  ms at 30 Hz → 0.400–0.415 ms at 60 Hz (~1.2x, not 2x); gated median 863–1006 → 1069–1368 drive
  ticks/plan against the gate of 1027, so **`planner.bench.test.ts` now fails its gate — a KNOWN,
  MEASURED FAILURE, put to the user**: 0.40 vs 0.33 ms/plan, six hard bots ~36–37 ms of CPU per
  simulated second against the 30 ms budget (was ~30). Budget not raised and planner not changed
  (P33's own remedy is "K and `planDepth` come down").
- **Bot-tuner cases, all passing at 60 Hz** (read by temporary logging, not committed). OFF-AXIS
  (`controller.test.ts`): 120 fires, mean offset **0.0414** (bar < 0.2; fires bar > 55). P49 kill
  (`tiers.test.ts`): killed at tick 399 = **6.65 s** against a cap of 44.7 s. P49 press rate: **7**
  presses against a bar of 3.59. P50 hit rate: easy 0.40, medium **0.833**, hard **1.00** — no longer
  inverted. These duels still run LITERAL tick counts (300 / 600 / 2400), which are half their old
  wall-clock span at 60 Hz; left as-is, a `bot-tuner` question. The two G12 failures in
  `controller.test.ts` still fail, unchanged.
- **Easy's K=0 plan (R-P6).** The floor on how far a plan rolls is now wall clock,
  `BRAIN_CONSTANTS.minRolledHorizonMs` 33 (1 tick at 30 Hz, 2 at 60 Hz). It did NOT restore
  `planner.test.ts`'s "cornered differs from open field" case, which is left failing: the CORNER's
  pick is {-1,-1} at both rates and at 1–3 rolled ticks; what flipped is the OPEN-FIELD reference
  (car facing directly away from the target), which picks {+1,-1} at 30 Hz and {-1,-1} at 60 Hz —
  a near-mirror-symmetric left/right tie that the step size decides. Open question for the user.
- **Input-count knobs.** `NET_CONFIG.maxInputsPerTick` 5 -> 10 and `pendingInputCap` 24 -> 48, so
  they cover the same wall-clock time as at 30 Hz (Phase D deletes both).
- **Netsim, legacy client at 60 Hz** — see the note under the baseline table below.

**Every playtest probe now measures a 60 Hz sim; run `npm run playtest -- --scope=all`.** Several
probes author durations as literal tick counts (e.g. `weapons.ts`'s `ticks: 90`, now 1.5 s rather
than 3 s) and `lan.ts` states "20 Hz against a 30 Hz sim" as a fact; they compile and were not
edited (`prediction.ts` was compile-fixed to `SNAPSHOT_RATE_HZ`).

Phase B landed 2026-09-29: the netsim harness
(`packages/server/src/netsim/`) runs the real tick pipeline against a headless model of today's
client, and the baseline is recorded below. Phase A landed 2026-09-29 (started after the user's go-ahead,
"start implementation with sdd"). The six decisions listed at the pause were accepted as written:
- Server FOV filtering uses `@view()` field tags on `PlayerState`, not a schema split (NR42).
- Hard invariant 5 reworded (NR13); invariant 8 gains a `@view` clause (G6).
- Bot timing authored in ms; `BOT_BRAIN_VERSION` 6.3.0 (C1).
- 60 Hz handling drift measured and reported in C3.
- D4 is one atomic commit.
- Baseline before A1: shared 1298 passed (6 skipped), server 833 passed / 2 failed (G12), client 1368 passed (5 skipped).
- All work lands directly on `development/main`.

Known gap until Phase D's `PROTOCOL_VERSION`: a client built on schema 2 joining a schema-5 server
is not refused cleanly.

Tooling notes for the executor:
- Plan task headings are numeric (`### Task 1 (A1): …`) so `task-brief PLAN_FILE N` finds them;
  each phase file is its own SDD plan with its own workspace under `.superpowers/sdd/<phase>/`.
- Phase A pre-flight ruling: if `npm run playtest:lan` (A2 Step 6 smoke) does not exit on its own,
  the implementer judges pass from its log (both clients joined and received state).
- Two failures in `packages/server/src/bot/brain/controller.test.ts` (G12) are pre-existing.

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
| Server steps per car per tick (max) | 1 | 4 (4–4) (net80; lan 1) | | | | |
| Repeated-input ticks, net80 | ≤ 2 % | n/a | | | | |
| Remote path error p95, net80 (u) | ≤ 12 | 0.13 (0.12–0.13) | | | | |
| Remote hold frames, net80 | ≤ 1 % | 3.62 % (2.75–4.73 %) | | | | |
| Local reconcile correction p95, net80 (u) | ≤ 4 | 0.86 (0.47–1.51) | | | | |
| Input-to-server delay, lan (ms) | ≤ 34 | 21.7 (20.7–23.3) | | | | |
| Remote display delay, lan (ms) | no worse than baseline; interpolation component ≤ 50 | 67.4 (66.8–67.9) | | | | |
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
| Remote hold frames | 0.018 % (0.007–0.026 %) | 5.65 % (5.33–6.11 %) | 10.88 % (10.47–11.48 %) |
| Local reconcile correction p95 (u) | 0.01 (0.00–0.02) | 0.30 (0.04–0.44) | 0.68 (0.34–1.01) |
| Input-to-server delay (ms) | 9.3 (9.3–9.4) | 51.3 (51.3–51.4) | 92.0 (91.9–92.2) |
| Remote display delay (ms) | 50.5 (50.5–50.6) | 87.8 (87.0–88.9) | 121.3 (120.2–122.5) |

Recorded with `maxInputsPerTick` 10 and `pendingInputCap` 48 (doubled with the flip, see In
flight). Dropped inputs per run: lan 1–2, net80 22–28 (30 Hz: 14–15), net150 82–124 (30 Hz: 77–85)
— back near the 30 Hz level; with the old caps of 5/24 they had risen to 172–202 and 975–1029, and
the steps-per-tick maximum rises with the cap (a catch-up burst now drains up to 10 inputs).

Read two rows with care: **reconcile p95 (one sample per reconcile) and hold frames (head-of-line
stalls, per message) shift with the message rate alone** — three times as many snapshots per second
means three times as many reconciles and three times as many losses to stall the stream behind — so
a move in those rows is not by itself a netcode change. Hold frames rose (net80 3.62 → 5.65 %,
net150 7.09 → 10.88 %) for exactly that reason. Input-to-server and display delay fell with the tick
quantum (lan 21.7 → 9.3 ms and 67.4 → 50.5 ms). Path error fell to float noise: a snapshot every
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
