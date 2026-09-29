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

**C2 landed; Task 3 (C3) is next.** C3 worklist (failures at 60 Hz after C2), probed by temporarily
setting `TICK_RATE_HZ = 60` (reverted, not committed): shared 37 failed, server 26 failed (includes
the 2 G12 and possibly the P33 timing bench), client 7 failed, scripts 4 failed (manual-page stamp;
`docs/turn-tuning.md` derived values in Brawl, Deathmatch and Conquer sections). At 30 Hz `no-mode-branching.test.ts`
(shared) also fails, pre-existing and unrelated.

```
## shared
src/config/deathmatch-config.test.ts > DEATHMATCH_TICKS > derives whole ticks from the authored seconds
src/config/weapon-config.test.ts > WEAPON_TABLE > keeps the field alive long enough to be driven into and out of (LZ17)
src/config/weapon-ticks.test.ts > WEAPON_TICKS > derives flight ticks from range and speed
src/config/weapon-ticks.test.ts > WEAPON_TICKS > derives magmablast's clocks from its milliseconds
src/config/weapon-ticks.test.ts > WEAPON_TICKS > derives the roster's new-mechanic clocks for the rows that carry them (spec 2026-09-01)
src/config/weapon-ticks.test.ts > msToTicks > rounds up, so a duration is never shorter than authored
src/modes/no-mode-branching.test.ts > common code never branches on a specific game mode (GM2) > has no GameMode.X / winRuleOf / win-rule-string branch outside modes/ and the judged allow-list
src/sim/combat.test.ts > damaged and killed events (B4, B5) > records a 0-damage hit from a pure applicator without a killing blow
src/sim/combat.test.ts > damaged and killed events (B4, B5) > tags pulse damage with the status and who applied it
src/sim/combat.test.ts > damages a target with a real attached beam fired from a real loadout, once it has grown to reach
src/sim/combat.test.ts > magma blast detonation (spec P13-P21) > detonates at the PRE-step pose on a wall, never inside it (P14)
src/sim/combat.test.ts > magma blast detonation (spec P13-P21) > reaches a car on the far side of a wall, because a disc has no wall clip (P17)
src/sim/combat.test.ts > proximity homing (spec P1-P6) > commits: it does not re-acquire after its target is wrecked (P5)
src/sim/combat.test.ts > proximity homing (spec P1-P6) > does not pre-commit to a held lock at spawn (regression: acquire must gate on 'lock')
src/sim/combat.test.ts > proximity homing (spec P1-P6) > grabs a car that comes within acquireRadius and bends toward it
src/sim/combat.test.ts > proximity homing (spec P1-P6) > takes the nearer of two eligible cars
src/sim/combat.test.ts > pulses lance for its whole life, spending a full connect over four ticks instead of one
src/sim/combat.test.ts > real-row integration (2026-09-01 roster) > a wildcharge press opens the charge window and self-applies fortified
src/sim/combat.test.ts > real-row integration (2026-09-01 roster) > homes a proximity-acquired predator toward a moving target across real combat ticks
src/sim/combat.test.ts > startManeuver > starts a charge for its authored duration and refuses to stack maneuvers
src/sim/combat.test.ts > tremor (the unassigned row): presence effects > grants fortified only while the owner stands inside their own zone, and stops refreshing on exit
src/sim/combat.test.ts > tremor (the unassigned row): presence effects > ticks 25-base damage into a standing target and holds spiked exactly while they stay
src/sim/combat.test.ts > wall-piercing projectiles (`piercesWalls`, roadblock's row) > passes through an interior wall and lands on the camper behind it — where magmablast dies on it
src/sim/combat.test.ts > wall-piercing projectiles (`piercesWalls`, roadblock's row) > still dies by its own range clock, walls or no walls
src/sim/combat.test.ts > wall-piercing projectiles (`piercesWalls`, roadblock's row) > survives being born with a wingtip past the arena bounds, and still lands downrange
src/sim/drive.test.ts > dash substep helpers (spec C3 / C6) > derives the substep count from distance, so it survives a retune of speed or tick rate
src/sim/drive.test.ts > stepDrive > approaches forwardMaxSpeedOf(carId) after sustained throttle (asymptotic, not a clamp)
src/sim/drive.test.ts > stepDrive > brakes from a forward speed into reverse, settling near its own reverse equilibrium
src/sim/drive.test.ts > stepDrive > holding Up from reverse brings the car back through zero and on to accelerating forward
src/sim/status/channels.test.ts > topSpeed reaches the drive cap > caps forward speed at the scaled maximum
src/sim/status/channels.test.ts > topSpeed reaches the drive cap > caps reverse too, so backing away is not the way out of a slow
src/sim/status/combat.test.ts > weapons apply statuses > `disarmed` lets a press already committed finish
src/sim/step.test.ts > stepSim > stops the car at an obstacle it would otherwise have driven through
src/sim/weapons/fire.test.ts > the two lockouts > blocks a different slot for the firing weapon's recovery
src/sim/weapons/fire.test.ts > the two lockouts > holds the switch lock across two slots carrying the SAME weapon id
src/sim/weapons/fire.test.ts > the two lockouts > writes the recovery lockout from the weapon that fired, at the tick the shot exits
src/sim/weapons/instances.test.ts > bounce > expires on its clock, not at range
## server
balance/match.test.ts > runMatch > shortening matchSeconds still lets the deathmatch clock fire, so a winner can appear (fix round 2, defect 1)
src/bot/brain/aim.test.ts > stepAimError > holds its offset between resamples, so error drifts rather than jitters
src/bot/brain/controller.test.ts > HumanController > hunts a quadrant waypoint when it has never seen anyone, never the arena centre (G12)
src/bot/brain/controller.test.ts > HumanController > hunts toward a last-known pose, not the arena centre (G12)
src/bot/brain/humanize.test.ts > applyHumanize > emits the intent decided reactionDelayTicks ago
src/bot/brain/perception.test.ts > observedAngVelOf > takes the short way round the seam rather than reading a near-full turn
src/bot/brain/perception.test.ts > perceive > does not know a car until its acquire delay has passed
src/bot/brain/perception.test.ts > perceive > forgets a car once it has been out of sight for memoryTicks
src/bot/brain/planner.bench.test.ts > planner cost (P33) > costs no more than the shipped measurement allows, normalised (P33, R-PF2)
src/bot/brain/planner.test.ts > plan > commitWindowOf > is arithmetically unchanged at the depth every profile ships (depth 1)
src/bot/brain/planner.test.ts > plan > with horizon 0, the candidates are not all tied -- moving the scene changes the answer (P29, R-P6)
src/bot/brain/predict.test.ts > a car that is SLIDING, not driving (car-physics merge, 2026-09-07) > and the pre-rework scalar read would have been 62.68 units wrong — more than a car length
src/bot/brain/predict.test.ts > physicsPredictor > beats a straight line for a turning car
src/bot/brain/predict.test.ts > predicting an observed car, against an independent ground truth > beats a straight line wherever the target turns, and never loses where it does not
src/bot/brain/predict.test.ts > predicting an observed car, against an independent ground truth > still lands a throttle-closed rollout SHORT, which is why it is not the held input
src/bot/brain/predict.test.ts > state estimation noise (P20) > lets a sloppy read miss a curve entirely, and even read it backwards
src/bot/brain/predict.test.ts > state estimation noise (P20) > reads either side of the steering threshold, by how far the estimate falls short
src/bot/brain/solution.test.ts > solve — turret (TR26) > leads a crossing target, budgeting the turret's turn into the time to impact
src/sim/pipeline-order.test.ts > the real serverTick -> contactTick order > drives before it measures contact, so the ram is classified against the poses the tick ended at
src/sim/ram-bridge.test.ts > contactTick (diminishing returns, spec §7.3) > scales a chained ram's shove, spin and reel, and charges the attacker in full
src/sim/ram-bridge.test.ts > contactTick applies reeling to a ram victim, scaled by falloff > gives a re-rammed victim a shorter reeling duration than the first ram
src/sim/ram-bridge.test.ts > contactTick applies reeling to a ram victim, scaled by falloff > lands two slams on one victim at identical strength — falloff is ram-only
src/sim/tick.test.ts > serverTick > other cars as colliders > converges to a residual overlap that stays bounded across every roster ramDefence pairing, not just mirage/mirage
src/sim/tick.test.ts > serverTick > other cars as colliders > does not treat a player who is not in the match as a solid wall
src/sim/tick.test.ts > serverTick > ram knock state round-trip > carries angVel/vx/vy through bodyOf -> stepDrive -> writeBody: it moves the pose, and the fields round-trip decayed rather than dropped
src/sim/tick.test.ts > serverTick > steps each player against the updated poses of the players stepped before them
## client
src/fx/contact.test.ts > shotEndPoint — a projectile ends on the hull it struck > pulls a shot that OVERSHOT the car back to the entry face
src/modes/conquer/hud.test.ts > CONQUER_HUD.resultsLine (CQ33) > is viewer-relative: team B reads its own bar first
src/modes/conquer/hud.test.ts > CONQUER_HUD.resultsLine (CQ33) > reports both teams' control percentage
src/scenes/combat-visual.test.ts > chargeOrbBands > appears as a dot on the press tick rather than fading in from nothing
src/scenes/combat-visual.test.ts > chargeOrbBands > grows linearly, so the orb tells an opponent how long they have
src/scenes/combat-visual.test.ts > chargeOrbBands > ignores a pending longer than this weapon's own wind-up
src/scenes/impact-feedback.test.ts > freshImpacts > the velocity this pass must be given > loses most rams when given the rendered, post-collision velocity
## scripts
    not ok 5 - was rebuilt after the last change to the tables or the prose
not ok 38 - the generated manual page
--
        not ok 5 - prints derived values this mode's bundle actually computes
    not ok 3 - Brawl
        not ok 5 - prints derived values this mode's bundle actually computes
    not ok 4 - Deathmatch
        not ok 5 - prints derived values this mode's bundle actually computes
    not ok 5 - Conquer
not ok 67 - docs/turn-tuning.md
```

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
