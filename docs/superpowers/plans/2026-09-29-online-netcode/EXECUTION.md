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
| E — remotes and prediction | [`E-remotes.md`](E-remotes.md) | NR29–NR34 | Landed (final review clean, `bc3d2844`) | Remotes drawn at an adaptive tick-keyed delay (33–250 ms) with capped dead reckoning from `lastSteer`/`lastThrottle`, predicted against at their reckoned pose, contact-blended within 2 car lengths; `PROTOCOL_VERSION` 2; numbers in the table below |
| F — combat under latency | [`F-combat.md`](F-combat.md) | NR35–NR41 | Landed (final review pending) | `viewTick` per frame; per-press shot compensation `k = clamp(P − viewTick, 0, min(cap 9 ticks / 150 ms, allowedTicks))` priced from `min(app, ws)` RTT; fresh shots fast-forwarded `k` ticks and born `k` ticks old (`lifeOffsetTicks`, `PROTOCOL_VERSION` 4); every shot drawn at the local present (`ShotView`); your own shot drawn at once (`LocalFire`, `ProvisionalShots`, shared `pressPhase`); golden guard on `runCombat`'s press phase and fast-forward; numbers in the table below |
| G — interest management, docs | [`G-interest.md`](G-interest.md) | NR42–NR49, NR68 | Not started | |

## In flight

**Phase F is landed (F1–F5, each task reviewed); its whole-phase final review is pending. Next: the Phase F final review, then Phase G** (interest management, docs, NR42–NR49, NR68). Known failures: the two G12 bot tests only.

Phase F (F1–F4 each reviewed; F5 = numbers and docs):
- **F1** `InputFrame.viewTick` (NR35, `PROTOCOL_VERSION` 3); server `shotCompTicks` (`net/shot-comp.ts`): cap `shotCompCapMs` 150 ms = 9 ticks, sized from net80clean's measured p95 staleness; `allowedTicks` from the FULL RTT; the RTT is `NetSessions.compRttMs` = `min(app MSG_PING RTT, transport ws ping RTT)` (`net/ws-rtt.ts`, stamped before the simulated outgoing delay); playground prices the human's session, not the seat; netsim staleness metric.
- **F2** fast-forward inside `runCombat` (`advanceInstance`/`resolveInstance`, `runAhead`); a compensated shot born `k` ticks old (`bornOlder`: expiry/homing backdated, `WeaponInstanceState.lifeOffsetTicks`, `PROTOCOL_VERSION` 4); exact broadphases with a committed property test; `runCombat` clamps `k` to the cap.
- **F3** `ShotView` (`net/shot-view.ts`): every shot drawn at the local car's tick with the shared motion, straight shots in closed form, hidden from the server's own end tick (range, lifetime, wall); spectators at the cars' render tick; `extrapolateShot` and `shotExtrapolationCapMs` deleted.
- **F4** `LocalFire` + `ProvisionalShots` (`net/provisional-shots.ts`): own shots drawn at once, confirmed by owner/weapon/`spawnTick` ±2, eased hand-over, beams welded to the drawn car; the press sequence is ONE shared function, `pressPhase` (`sim/weapons/press.ts`), called by `runCombat` and `LocalFire`.
- **F5** netsim fire presses, pings and the shot rows below; `sim/combat-golden.test.ts` (seeded six-car scenario, random presses, `k` ∈ [0, 9], frozen fixture bundle `sim/__fixtures__/combat-golden.tables.json`, hashed per 100 ticks; planted faults — fast-forward one short, `turnTurret` before `beginFire`, a dropped disarmed gate — each fail it); docs (`networking.md` "Client — combat", `combat-model.md` "Latency", `config-reference.md` NET_CONFIG rows, `schema-reference.md` `InputFrame.viewTick`, spec §11).

**Loud: combat's per-tick resolution changed for pressed shots with `k > 0`** (a fresh shot is advanced `k` ticks and born `k` ticks old on its birth tick). Every bot, harness and probe press carries no `viewTick`, so `k = 0` there and the weapon probes (`weapons.ts`, `weapons2.ts`) measure the unchanged tick. **Recommended: `npm run playtest -- --scope=all`.**

Phase F parked items:
- **LAN input-to-server 34.05 ms with firing on** (target ≤ 34; 33.99 driving-only) — the first run of §1's "driving and firing" shape; not attributed. A USER/controller call whether the target binds this shape at 0.05 ms.
- **Remote drawn-jump max 24–48 u with combat in the run** (5–7 u driving-only), p99 unchanged — likely slams/dashes the contact-blend reckoning cannot foresee; unmeasured (Phase E metric).
- **A shot the server resolves inside its fast-forward is never sent**, so its provisional flies on through what it hit until `rtt + 100 ms` (17–30 % of provisional pellets). A "died unseen" signal (e.g. a short-lived removal record) would let the client hide it.
- **The provisional ttl `rtt + provisionalShotGraceMs` undershoots on net150** (5.3 % of its provisionals fade before their confirm; that player's own cost). A ttl from the measured input lead + downlink would fit.
- **Homing shots** hand over 26–170 u off (both drawings hold a heading; the server steers) and can pop at a wall removal (F3 review B); homing turn-rate extrapolation was parked in F3.
- Worst-case combat tick p99 13.6 / max 20.6 ms in a contrived six-`pepperbox` k = 9 bench (F2; `FixedStepper` catches up).
- A held beam's HOLD can outlast its compensated beam by up to `k` ticks (accepted: the lagging shooter's cost only, F2).
- Point-blank over-lead inside contact-blend range (F1 review M2, documented as a limitation).
- A non-browser client can delay ws pongs too and reach the cap on any link (documented; the cap is the guarantee).

**Phase E is landed (E1–E5) and its whole-phase final review is clean** after three fix rounds (I1–I5, M1–M5; M6 parked, below; `9818e500`).

Phase E (E1–E4 each reviewed; E5 = numbers and docs):
- **E1** `PlayerState.lastSteer`/`lastThrottle` (int8, every car every tick), shared `RemoteReckoner` (stepSim dead reckoning cached per snapshot, capped `maxExtrapolateMs`), `PROTOCOL_VERSION` 2.
- **E2** `TickInterpolation`, `DisplayDelay` (p95 lateness + one snapshot interval, 33–250 ms, ≤ 1 ms/frame), shared `RemoteTimeline` used by `ArenaScene` and the netsim tick client, settle ease, `remoteTeleportCars`; `InterpolationBuffer` and `interpolationDelayMs` deleted.
- **E3** remotes at their reckoned pose in `StepContext.others` for prediction and replay; prediction uses each frame's own tick for statuses; prediction cleared on practice/playground resume; lateness samples deduped by tick.
- **E4** contact blend within `contactBlendRangeCars` (2): fractional-tick target, eased final pose, slewed weight.
- **E5** numbers (table below) and docs. API note for Phase G: forgetting a remote is `RemoteTimeline.forget(id)` (there is no `interp.reset()`).

- **Final-review fixes:** the contact blend's final settle arms only when its target is replaced (a snapshot rebasing the reckoning, or an anchor-tick jump of more than a tick), with the gap measured old-target − new-target at the same tick — this removed the standing ~15° heading lag on a turning remote within 2 car lengths only while the anchor sat inside the 6-tick reckoning cap (I1, i.e. on `lan`); past the cap (98 % of blend samples on `net80clean`) every snapshot still "rebased" by one tick of the car's own motion and the drawn remote trailed the collided pose by ~5 frames (re-review I4: 14.2 u p95 on net80clean). Fix round 2 measures the gap at a tick both reckonings reach (the cap advance of one snapshot interval is drawn, a longer one eased), sets `ANCHOR_JUMP_TICKS` to 0.5 (an anchor advance of zero to one frame is normal; anything more than half a tick outside it is eased), adds `RemoteTimeline.blendTarget` and the netsim blend-lag metric, and makes `jumpExcess` compare displacement vectors; a paused practice/playground room holds every remote at its newest snapshot and clamps the blend's anchor there (I2); the netsim client builds its anchor through the shared `localAnchorOf` exactly as `ArenaScene` does, and the netsim scores heading, per-frame jump beyond own motion, and the blend range separately (I3); a remote stepped after the local car on the server is reckoned to `tick − 1` for prediction (`remotePoseTickFor`, M1); a same-tick patch with a changed pose is drawn (M2); the clock-ready step eases (M3); docs (M4, M5).

- **Fix round 3 (I5):** past the reckoning cap the drawn cap is extended by up to one snapshot interval from each snapshot's earliest expected arrival (tick + slewed min lateness), so a remote near you glides at > 60 fps instead of stair-stepping; prediction's whole-tick cap (NR32) is unchanged, and the drawn remote leads the collided pose by ≤ 1 tick.

Phase E parked items (Minor): past-cap `poseAt` allocates one `blendPose` per nearby remote per frame (fix-3 M-e); a single anomalously early snapshot pins the min-lateness clock for 120 snapshots (≈ 2.7 s of 1-tick staircase; a low percentile instead of the min would fix it, fix-3 M-c); per-frame `localAnchor`/`blendPose` allocations in the contact blend; a wreck snaps forward on death by the adaptive delay × speed (final review M6, predates E). (The anchor switching off and on with a reset tick is now eased as an anchor-tick jump.)

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
- ~~**NR36's compensation cap** must be sized in Phase F from an honest `net80clean` client~~ — done in F1: 150 ms (9 ticks) from net80clean's p95 staleness; no link earns more.

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
| Server steps per car per tick (max) | 1 | 4 (4–4) (net80; lan 1) | 1 (1–1) (lan, net80clean, net80, net150) | 1 (1–1) (lan, net80clean, net80, net150) | 1 (1–1) (lan, net80clean, net80, net150) | |
| Repeated-input ticks | `lan`, `net80clean` ≤ 2 %; `net80` ≤ 4 % (its own player's cost) | n/a | lan 0.11 % (0.11–0.11); net80clean 0.39 % (0.37–0.42); net80 3.69 % (3.46–3.93); net150 8.14 % (7.83–8.44) | lan 0.11 % (0.11–0.11); net80clean 0.39 % (0.37–0.42); net80 3.69 % (3.46–3.93); net150 8.14 % (7.83–8.44) | lan 0.19 % (0.18–0.20); net80clean 0.59 % (0.52–0.64); net80 3.96 % (3.83–4.10); net150 8.66 % (8.36–9.08) | |
| Remote path error p95, net80 (u) | ≤ 12 | 0.13 (0.12–0.13) | 0.00 (0.00–0.00) | 0.03 (0.01–0.08) (lan 0.00 (0.00–0.00); net80clean 0.04 (0.00–0.13); net150 0.04 (0.00–0.06)) | 0.01 (0.00–0.01) (lan 0.00 (0.00–0.00); net80clean 0.00 (0.00–0.00); net150 0.02 (0.01–0.05)) | |
| Remote hold frames, net80 | ≤ 1 % | 3.62 % (2.75–4.73 %) | 1.28 % (1.21–1.39 %) | 0.010 % (0.003–0.017 %) (lan 0.005 % (0.001–0.010 %); net80clean 0.006 % (0–0.017 %); net150 0.21 % (0.19–0.22 %)) | 0.056 % (0.015–0.090 %) (lan 0.012 % (0.007–0.017 %); net80clean 0.026 % (0.008–0.039 %); net150 0.30 % (0.24–0.37 %)) | |
| Local reconcile correction p95 (u) | ≤ 4 on `lan` and `net80clean`; lossy links reported | net80 0.86 (0.47–1.51) | lan 0.28 (0.13–0.49); net80clean 1.07 (0.45–1.85); net80 1.22 (0.60–2.15); net150 2.01 (1.18–2.63) | lan 0.22 (0.03–0.46); net80clean 0.77 (0.22–1.54); net80 0.76 (0.35–1.51); net150 1.46 (0.86–1.84) | lan 0.20 (0.15–0.25); net80clean 0.75 (0.34–1.33); net80 0.92 (0.71–1.16); net150 1.60 (1.39–1.97) | |
| Input-to-server delay, lan (ms) | ≤ 34 | 21.7 (20.7–23.3) | 33.99 (33.95–34.02) | 33.99 (33.95–34.02) | **34.05 (33.99–34.13)** — 0.05 ms over the target with firing on; 33.99 (33.95–34.02) driving-only | |
| Input-to-server delay, net80clean (ms) | ≤ 91 (lan's 34 + half RTT + 1 tick) | n/a | 74.3 (74.2–74.4) | 74.3 (74.2–74.4) | 74.3 (74.25–74.33) | |
| Remote display delay, lan (ms) | no worse than baseline; interpolation component ≤ 50 | 67.4 (66.8–67.9) | 50.4 (49.9–50.8) | 30.9 (30.0–31.7) | 31.5 (31.0–32.1) | |
| Remote heading error p95, all samples (deg) | reported, no target | n/a | n/a | lan 0.00 (0.00–0.00); net80clean 0.02 (0.00–0.06); net80 0.02 (0.00–0.06); net150 0.02 (0.00–0.04) | lan 0.00 (0.00–0.00); net80clean 0.00 (0.00–0.00); net80 0.00 (0.00–0.01); net150 0.02 (0.00–0.04) | |
| Remote path error p95 within blend range (u) | reported, no target | n/a | n/a | lan 0.94 (0.52–1.45); net80clean 3.12 (2.17–4.12); net80 2.90 (2.77–3.15); net150 2.34 (2.07–2.54) | lan 0.72 (0.48–0.88); net80clean 3.31 (2.25–4.10); net80 3.60 (2.37–4.31); net150 3.10 (2.54–3.86) | |
| Remote heading error p95 within blend range (deg) | reported, no target | n/a | n/a | lan 2.93 (2.29–3.79); net80clean 8.82 (6.42–12.19); net80 7.18 (6.38–8.17); net150 6.85 (5.67–7.59) | lan 2.43 (1.81–3.36); net80clean 8.96 (6.48–12.40); net80 7.94 (6.96–8.50); net150 11.27 (10.30–12.89) | |
| Remote blend lag p95 — drawn vs the blend's own target (u / deg) | reported, no target | n/a | n/a | lan 1.31 (1.09–1.61) / 1.57; net80clean 2.13 (1.39–2.97) / 4.87; net80 2.87 (2.74–2.95) / 5.24; net150 3.58 (3.02–4.39) / 5.78 | lan 1.23 (0.87–1.55) / 1.37; net80clean 2.56 (2.17–3.28) / 4.15; net80 3.38 (2.84–3.73) / 4.45; net150 3.99 (3.24–5.15) / 6.31 | |
| Remote drawn jump, \|Δdrawn − Δtrue\| max / p99 (u) | reported, no target | n/a | n/a | lan 4.73 (4.21–5.62) / 0.33; net80clean 5.25 (3.52–6.12) / 0.65; net80 7.25 (5.48–10.38) / 0.82; net150 7.90 (6.44–9.56) / 1.12 | lan 23.81 (21.28–25.08) / 0.21; net80clean 43.15 (36.21–47.31) / 0.43; net80 48.05 (34.25–68.96) / 0.75; net150 39.19 (27.20–60.56) / 1.36 — the max rose with combat in the run (driving-only: 4.73 / 5.51 / 6.73 / 6.73), see below | |
| Shot staleness `P − viewTick` p50 / p95 / max (ticks) | reported; sizes `shotCompCapMs` (net80clean p95) | n/a | n/a | n/a | lan 4.3 / 5 / 5; net80clean 9 / 9 / 9; net80 9.7 / 12 / 13; net150 16 / 20.3 / 22.3 | |
| Shot compensation `k` per committed press, mean / p95 / max (ticks); share at the 9-tick cap | reported, no target | n/a | n/a | n/a | lan 4.45 (4.37–4.52) / 5 / 5, 0 %; net80clean 8.53 (8.48–8.57) / 9 / 9, 54 % (48–57 %); net80 8.98 (8.97–8.98) / 9 / 9, 98 % (97–98 %); net150 8.94 (8.91–9.00) / 9 / 9, 99 % (99–100 %) | |
| Own shot delay — press to first drawn frame, less wind-up, mean / p95 (ms) | reported, no target (NR39: drawn at once) | n/a | n/a | n/a | lan 0.15 (−0.21–0.67) / 0; net80clean 1.17 (0.20–1.75) / 11 (0–17); net80 −0.14 (−0.43–0.23) / 0; net150 −0.23 (−0.25 – −0.21) / 0 | |
| Shot confirm jump p95 — provisional vs confirming instance at hand-over, non-homing / homing (u) | reported, no target | n/a | n/a | n/a | lan 4.45 (0.00–13.33) / 26.1 (24.5–27.0); net80clean 0.50 (0.00–1.46) / 125.2 (125.1–125.2); net80 4.28 (0.03–11.40) / 128.1 (121.5–133.8); net150 14.21 (0.06–39.80) / 116.5 (13.5–172.6) | |
| Provisionals expired unconfirmed — all = late confirm + server shot never sent + refused (share of provisional pellets) | reported, no target | n/a | n/a | n/a | lan 17.1 % = 0 + 17.1 + 0; net80clean 27.8 % = 0 + 27.4 + 0.4; net80 27.7 % = 0.4 + 26.7 + 0.6; net150 38.8 % = 5.3 + 30.2 + 3.4 | |
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

The "after E" column is the Phase E close build after its final-review fixes (`development/main` at `f6374c9f` plus the commit `fix(net): phase E final review — contact-blend heading, paused render tick, honest netsim`, the commit that records this paragraph), measured 2026-10-01 with the same command, and re-measured after fix round 2 (`c4d73cad` plus the commit `fix(net): contact blend past the reckoning cap (phase E re-review I4)`, the commit that records this sentence) — then again after fix round 3 (`59f5c090` plus the commit `fix(net): smooth the drawn contact-blend cap past the reckoning cap (phase E re-review I5)`) — the column now holds the round-3 figures (round 3 extended only the drawn cap, so `lan`, inside the cap, did not move; past the cap the drawn remote now leads the whole-tick hit pose by up to one tick, which the nearest-point blend rows read as a little farther from the true path); it replaces the first "after E" figures, taken at `b21a7974`. Round 2 moved (round-2 figures): net80 hold 0.005 % → 0.013 %, net80clean display delay 57.4 → 55.3 ms, net80 74.3 → 72.7, net150 144.2 → 143.0, and the blend-range rows (the drawn remote now sits on the capped reckoned pose prediction collides with, which the nearest-point path/heading scores read as farther from the true path on links past the cap — the blend-lag row is the one that reads a drawn pose trailing its own target, 14.2 u p95 on net80clean at `c4d73cad` per the re-review, 1.92 after round 2 and 2.13 after round 3). The jump row is now a vector difference and skips spans touching a death or respawn. The cells the fixes moved: path error p95 (net80 0.08 → 0.03, lan 0.03 → 0.00, net80clean 0.14 → 0.04, net150 0.07 → 0.04), reconcile p95 (lan 0.25 → 0.22, net80clean 0.81 → 0.77, net80 0.77 → 0.76, net150 1.47 → 1.46), lan display delay 31.1 → 30.9 ms; steps, repeats, holds and input-to-server did not move. The "reported, no target" rows are new with the fixes (final review I3; the blend-lag row with fix round 2); the blend-range rows cover the 2–9 % of samples drawn within `contactBlendRangeCars` of the local car (`NetsimDiagnostics.blendSamples`). For scale, the same 20 s seed-1 run with the pre-fix `RemoteTimeline` reads 12.3–14.6° blend-range heading p95 on every link (after: 1.4–2.9°) — the I1 lag the old metrics could not see. The lan display delay sits below the 33 ms `minDelayMs` floor because it includes the contact-blended samples, which are drawn AHEAD of the render tick (at the local car's predicted tick) and read as negative delay — the cell mixes the interpolation path with the contact blend; the interpolation component alone is bounded by `minDelayMs`. Other "after E" rows not in the table: net80clean display delay 55.3 ms (53.0–57.1); net80 input-to-server 78.3 ms (78.1–78.6), display delay 72.4 ms (69.8–74.3); net150 input-to-server 118.0 ms (117.8–118.2), display delay 142.7 ms (141.3–143.7) — net150's display delay rose from D's 131.4 ms because the adaptive delay (p95 lateness + one snapshot interval) widens on a lossy link, which is its design and that player's cost. **Targets, all met:** `lan`/`net80clean` path error p95 ≤ 12 u (0.00 / 0.04), hold ≤ 1 % (0.005 % / 0.006 %), reconcile p95 ≤ 4 u (0.22 / 0.77), repeats ≤ 2 % (0.11 % / 0.39 %), input-to-server unchanged from D, LAN display delay 30.9 ms against the baseline's 67.4 (and D's 50.4), its interpolation component bounded by `minDelayMs` 33 ms ≤ 50. No deviations. Dropped inputs net80 667–729 per run, net150 1532–1642 (a lossy link's own cost).

The "after F" column is the Phase F close build (`development/main` at `0e602b6e` plus the F5 commits `test(sim): golden runCombat fire/fast-forward regression guard` and `docs(net): phase F numbers and docs`), measured 2026-10-03 with the same command — **and, for the first time, the run shape §1 describes: scripted driving AND firing.** F5 gave the netsim drivers an ability press each (a random slot of 1–3 every 1–3 s, held 80–250 ms, from a fire stream seeded beside each driver's, so the driving draws are unchanged), the server world the room's 1 s `MSG_PING` probe over the links (so presses are priced from a measured RTT — the netsim has no transport ping, and an honest client's would read the same), `runCombat`'s `fired` events with each press's `k`, and the tick client a headless `LocalFire` + `ProvisionalShots` + own-shot `ShotView` exactly as `ArenaScene` wires them. `NETSIM_NO_FIRE=1` runs the pre-F driving-only shape: **it reproduces the "after E" column exactly on `lan` and `net80clean`** (lan 33.99 ms / 0.11 % / 0.22 u / 30.9 ms; net80clean 74.3 ms / 0.39 % / 0.78 u), so Phase F changed nothing on the driving path; on `net80`/`net150` it moves by a hair (net80 repeats 3.69 → 3.74 %, hold 0.010 → 0.016 %) because the ping messages now share the ordered stream and shift every later link draw. Every move in the "after F" column against "after E" is therefore **combat in the run**: shots, stuns, slams and dashes, and about twice the deaths (lan 10/9/10 against 5/5/3). Two of those moves matter: **(1) LAN input-to-server reads 34.05 ms (33.99–34.13), 0.05 ms over its ≤ 34 target**, with firing on; driving-only it is 33.99 — not attributed (more deaths and respawns, each restarting the scheduler, is the likely cause, unmeasured). **(2) The remote drawn-jump max rose from ~5 u to 24–48 u** with p99 unchanged — single frames where a remote's drawn displacement departs from the truth, most likely a slam or dash knock the contact blend's reckoning cannot foresee (unmeasured; the jump metric is Phase E's and reports with no target). Every other strict target is met on `lan` and `net80clean`: steps 1, repeats 0.19 % / 0.59 %, path error p95 0.00 / 0.00 u, hold 0.012 % / 0.026 %, reconcile p95 0.20 / 0.75 u, net80clean input-to-server 74.3 ms ≤ 91, LAN display delay 31.5 ms against the baseline's 67.4. The new rows: **shot compensation** — LAN presses are bounded by the link allowance (mean 4.5 ticks, never the cap), net80clean's honest staleness sits at the 9-tick cap about half the time, and the lossy links are clamped to it on 98–99 % of presses, which is the D6 ruling working (no bad link earns more than the good connection). **Own shot delay** ~0: `LocalFire` predicted every committed press it could draw (`unpredictedShots` 0 on lan and net80clean, 0–11 per run on the lossy links). **Hand-over jump** (non-homing) p95 0.5 u on net80clean, 4.4 on lan (the server's allowance granting a tick fewer than the client's own `k` on some LAN presses: one tick of a pellet's travel, 13.3 u), 14.2 on net150; homing shots (`predator`) hand over 26–128 u off, both drawings holding a heading while the server's shot steers (a known limitation, eased over 100 ms). **Expired provisionals**, 17–39 % of provisional pellets: almost all are shots the server resolved inside their own fast-forward (a close hit, a pepperbox pellet into a wall) and never sent — the provisional then flies on through what it hit until it fades; refusals are ≤ 0.6 % except net150's 3.4 %; and 5.3 % of net150's provisionals fade before their confirm arrives, `rtt + 100 ms` undershooting that link's own press-to-snapshot time. Diagnostics per run: 154–166 presses, 93–107 committed, 214–255 provisional pellets; 3–12 committed shot presses per run never drawn, all but one of them predicted (a compensated shot whose first `k` ticks end it at a wall is hidden from its birth, as the server's is never sent). The baseline now takes ~5 min (60 s × 3 seeds × 4 links, firing), not ~30 s.

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
metric; about 5 min in all since F5; `NETSIM_NO_FIRE=1` for the driving-only shape). `NETSIM_REPORT` also prints each run's diagnostics — inputs produced,
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
