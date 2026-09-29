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
| C — 60 Hz and per-tick snapshots | [`C-sixty-hz.md`](C-sixty-hz.md) | NR11–NR16 | Not started | |
| D — time and inputs | [`D-time-and-inputs.md`](D-time-and-inputs.md) | NR17–NR28, NR54–NR56 | Not started | |
| E — remotes and prediction | [`E-remotes.md`](E-remotes.md) | NR29–NR34 | Not started | |
| F — combat under latency | [`F-combat.md`](F-combat.md) | NR35–NR41 | Not started | |
| G — interest management, docs | [`G-interest.md`](G-interest.md) | NR42–NR49, NR68 | Not started | |

## In flight

**Phase C, Task 1 (C1) is next.** Phase B landed 2026-09-29: the netsim harness
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
