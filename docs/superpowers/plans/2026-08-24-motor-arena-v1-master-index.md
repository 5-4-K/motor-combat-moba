# Motor Arena v1 — Master Index, Execution Strategy, Tracker

> **For agentic workers:** This file is **not** executed directly. Execute one plan file at a time, in the order given by the strategy. Source design: `docs/superpowers/specs/2026-08-24-motor-arena-v1-design.md`.
>
> **Completion rule (do not skip):** Whenever a plan is **implemented and its Validation section has been run successfully**, update the **Execution Tracker** in this file in the same change (status → Done, date, short note). Do not mark a plan Done without that Validation evidence. Do not start executing plans unless the human explicitly asks.

**Goal:** Ship Motor Arena v1 — LAN-hosted top-down 2D car combat, max 6, FFA + team, last standing.

**Architecture:** Fresh npm-workspaces monorepo (`shared` / `server` / `client`). Colyseus 30Hz server-authoritative + Phaser 3. Canonical state `{x, y, angle}`. Netcode *logic* matches motor-combat (prediction, reconcile-by-replay, interpolation, latency injector); models are new.

**Environment:** Windows 10, PowerShell. Working directory `E:\Work\motor-combat-MOBA`.

---

## Plan list

| ID | Plan file | What you get after Validation |
|---|---|---|
| P0 | `2026-08-24-p0-walking-skeleton.md` | Monorepo boots. Two browsers join an empty `arena` room and see placeholder squares from server state. LAN zip + `start.bat` (npm i if needed) works. |
| P1 | `2026-08-24-p1-data-model.md` | Cars, colors, weapon, arena, HP math, schemas, and config tables exist and are tested. No gameplay yet. |
| P2 | `2026-08-24-p2-lobby.md` | Join with unique names, colors, two team panels, switch, start rules, kick, host transfer, Ready / In match / Post-match badges. |
| P3 | `2026-08-24-p3-match-flow.md` | Start → hidden car select + 60s timeout → reveal → 3-2-1-GO → stub match → results → per-player Back to lobby. Next match can start while others linger. |
| P4 | `2026-08-24-p4-driving-netcode.md` | Arcade driving, wall/obstacle/car bounce, prediction + interpolation. Drive online in the arena. |
| P5 | `2026-08-24-p5-combat.md` | Projectiles, collision damage, HP, elimination, spectate, last-standing win. v1 playable. |

---

## Execution strategy

### Required sequence

```
P0  →  P1  →  P2  →  P3 ─┐
              └→  P4 ────┴→  P5
```

1. **P0 first.** Nothing else compiles or connects without the monorepo, room, and client shell.
2. **P1 second.** Lobby, flow, driving, and combat all read the same tables and schemas. Do not invent parallel config in later plans.
3. **P2 after P1.** Lobby writes `PlayerState` fields defined in P1.
4. **P3 after P2.** Match flow starts from a working lobby (Ready-only start, statuses).
5. **P4 after P1.** Driving does **not** need P2/P3 if you use P0’s auto-join sandbox, but it **must** use P1’s movement fields, car table, and arena. Prefer executing P4 after P1; it may run in parallel with P2/P3 (see below).
6. **P5 last.** Needs P3 (roster / countdown / results / win plumbing) **and** P4 (positions to shoot and ram).

### What may run in parallel (independent after their deps)

| Parallel set | Condition | Why it is safe |
|---|---|---|
| **P2 ∥ P4** | Both after P1 is Done | P2 is lobby messages + UI. P4 is `stepSim` movement + client prediction. Different files if P1 left the seams. |
| **P3 ∥ P4** | P2 Done for P3; P1 Done for P4 | P3 is phase machine / car select / results. P4 is physics/netcode. Merge carefully: both touch `ArenaRoom` tick — P3 owns phase transitions, P4 owns `stepSim` during `match`/`countdown`. |

**Do not parallel:** P0 with anything; P1 with anything; P5 with anything; P3 with P2.

### Session / machine handoff

Each plan file is self-contained: files, tasks, commands, Validation. An agent on another machine should:

1. Read this index (tracker + strategy).
2. Read the spec.
3. Read **only** the next Allowed plan.
4. Implement + run that plan’s Validation.
5. Update the tracker in this file.
6. Commit.

If two people run P2 and P4 in parallel, merge P4 first (shared sim), then P2 (room messages), or rebase and resolve `ArenaRoom.ts` by keeping both: P2 messages in `onCreate`/`onMessage`, P4 in the tick path.

---

## Execution tracker

Update this table when a plan’s Validation section has passed. Status values: `Not started` | `In progress` | `Done` | `Blocked`.

| ID | Status | Started | Completed | Validated by | Notes |
|---|---|---|---|---|---|
| P0 | Done | 2026-08-24 | 2026-08-24 | agent: `npm test`, `npm run build --workspaces`, two-tab `npm run dev`, `build:release` unzip + `start.bat`, `GET /health` | Walking skeleton: two squares (green self, red other) at server poses; zip prints Installing dependencies then listens. |
| P1 | Done | 2026-08-24 | 2026-08-24 | agent: `npm run test -w @motor-arena/shared` (23), `npm run build --workspaces`, `npm run test --workspaces` | Config tables, arena-01 (team A mid spawn y=960 to miss obstacle), full v1 schema + ProjectileState. No gameplay. |
| P2 | Done | 2026-08-24 | 2026-08-24 | agent: shared tests 47, `npm run build --workspaces`, live two-client protocol + two Chrome contexts on `npm run dev` | Unique names/colors, team panels, switch, start errors, kick 4002, host transfer, 7th `"Room is full"` (singleton arena; joinOrCreate no longer opens a second room). |
| P3 | Done | 2026-08-24 | 2026-08-24 | agent: shared tests 74, `npm run build --workspaces`, live 3-client protocol + 2 Chrome contexts on `npm run dev` with `CAR_SELECT_SECONDS=8` | Car select, timeout random car, 3-2-1, stub results, linger next match, team/FFA spawns, mid-select Ready join, FFA disconnect win. |
| P4 | Done | 2026-08-24 | 2026-08-24 | agent, automated: `npm run test --workspaces` (242: shared 138, server 44, client 60), `npm run build --workspaces`. agent, live two-tab browser runs at 0ms and at `SIM_LATENCY_MS=80 SIM_JITTER_MS=20` (injector confirmed active by measured ack RTT: 92ms avg, 53-116ms, 63ms spread). Human: signed off on feel without a hands-on playtest. | Driving, SAT bounce, prediction, interpolation, follow-cam, car shapes. Measured: collision stops at exact geometry (wall x=24=carWidth/2; obstacle y=596=620-carWidth/2), speed caps match CAR_TABLE (hexagon 210, rectangle 360), restitution 295->-105 (=0.35), remote interpolation rendered-moved 72% of frames vs server 9%, match-2 prediction 12u ahead, latency lead bounded (avg 15.8u max 35.9u, pending max 3 of 24), 566u injected error snapped to 0 with no oscillation, ack monotonic over 340 patches, three shapes distinct (15/33/111 draw ops). **Not verified:** subjective feel — camLerp responsiveness, and the two documented locked-rule quirks (wall grind at shallow angles; bounce sign flip at 30.6 degrees off-normal). Deviations from plan text: contact order is bounds-others-obstacles-bounds (arena boundary inviolable), and the trailing bounds pass is position-only (one restitution per surface). |
| P5 | Done | 2026-08-24 | 2026-08-24 | agent, automated: `npm test` (408: shared 242, server 63, client 98, release scripts 5), ordered root `npm run build`, `npm run build:release` (zip + `start.bat` still npm-installs). agent, live: a scripted 4-client protocol harness driving a real `ArenaRoom` over the wire — **40/40 checks**, repeated clean, self-diagnosing (staging failures are reported separately from rule failures). agent, live browser: the real Phaser client driven end to end at `http://localhost:2599`, no console errors. Human: no hands-on playtest. | Projectiles, ram damage, elimination, spectate, last standing. `stub_end_match` deleted (message constant, handler, and `firstAliveRosterWinner` all gone; a test asserts the export is absent). **Two bugs found that the unit tests could not see, both fixed and pinned:** (1) ram detection used `obbsOverlap`, but `resolveWorld` runs first and pushes cars to *exactly* the separation boundary — measured gap 0 — so a strict overlap test was false on every tick of a real ram and ramming dealt no damage live while every hand-placed unit test passed; now `obbsInContact` + `COMBAT_CONFIG.ramContactPad`, with a new suite that drives real cars together through `stepSim`. (2) the arena camera gated spectating on `canDrive`, false during the countdown too, so the 3-2-1 followed whichever car sorted first by session id; rule extracted to `spectate.ts` as `isSpectating` and tested. **A third hazard, documented not coded around:** the server bundle inlines shared's `dist`, and `npm run build --workspaces` has no ordering guarantee — it was observed building the server one second *before* shared, shipping a stale sim while every unit test passed (tests import `src`). Use the ordered root `npm run build`; see the root and server `CLAUDE.md`. Measured live: 8 damage per hit from a 174-unit standstill, self-immunity over 45 held fire ticks, rear-end one-sided (b −3, a −0), head-on both (−3/−3), pair cooldown 6 hp over 30 held ticks vs 90 uncapped, team friendly-fire nil from 391 units while an enemy took 16, 2v2 won on `winnerTeam` with `winnerSessionId` empty, disconnect handed the win over, fresh match reset hp and cleared projectiles. Browser: hp bars drawn every frame, shots drawn on the frames they exist, wreck → spectate banner, `[`/`]`/arrows cycle, `V` toggles free roam, WASD pans 80u, results scene on match end. **Deviations from plan text:** `step.ts` was left alone — weapon cooldown and projectile integration live in the new pure `shared/src/sim/combat.ts` (`runCombat`), which the plan itself prefers, keeping `stepSim` the single-body drive lockstep; `server/src/sim/combat-bridge.ts` holds the schema↔POJO mapping and no rules. **Friendly fire resolved by the human:** off for rams as well as shots. Spec §5.3 has no team clause, so the first pass let teammates ram each other; the human confirmed the intent is no friendly damage at all. Ram damage now runs through the same `canDamage` predicate as the weapon, and a friendly bump does not burn the pair cooldown either. Live 2v2: teammate ram 50->50 both ways and 50->50 again after 30 more held ticks, with an enemy ram 31->28 on the same manoeuvre as the positive control (40/40 checks). |

**When a plan is completed:** set Status to `Done`, fill Completed (YYYY-MM-DD), name who/what validated (human playtest, `npm run test --workspaces`, zip smoke, etc.), and one line in Notes. Commit the tracker update with the plan’s last commit or immediately after.

---

## Docs each plan must keep current

Do not wait until P5. After the plan that first introduces a system, update the matching doc:

| Doc | First written | Kept current by |
|---|---|---|
| `CLAUDE.md` (root, brief) | P0 | every plan |
| `docs/architecture.md` | P0 | P1–P5 as systems land |
| `docs/project-structure.md` | P0 | P0 (layout), later if files move |
| `docs/networking.md` | P0 (seams) | P4 (real prediction) |
| `docs/schema-reference.md` | P1 | P2–P5 field adds |
| `docs/config-reference.md` | P1 | any new knob |
| `docs/deployment.md` | P0 | if start.bat / zip changes |
| `docs/conventions.md` | P0 | invariants |
| `docs/roadmap.md` | P0 | tracker pointer |
| `docs/glossary.md` | P0 | new terms |
| `packages/*/CLAUDE.md` | P0 | local invariants |
