# P3 — Match Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Companion: `2026-08-24-motor-combat-moba-v1-master-index.md`. Spec: `docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md` §§8–9, 11.
>
> **After Validation passes:** update the Execution Tracker (P3 → Done).

**Goal:** Host Start (when `canStart` passes) pulls **only Ready** players into hidden car select (60s, lock-in final, timeout = random car), reveals, 3-2-1-GO with frozen inputs, then a stub match that the host (or a debug `end_match` used only in tests) can finish into results. Each participant has Back to lobby. Status badges update. A next match can start while others linger on results. Driving/combat still stub (`stepSim` identity) unless P4 already landed.

**Architecture:** Pure flow reducer in `shared/flow` so tests do not boot Colyseus. `ArenaRoom` applies reducer events and holds `pendingCarId` in a **server-only** `Map<string, CarId>`.

**Depends on:** P2 Done. **Blocks:** P5. **May run parallel with:** P4.

---

## Files

- Create: `packages/shared/src/flow/match-flow.ts`
- Create: `packages/shared/src/flow/match-flow.test.ts`
- Create: `packages/shared/src/flow/spawns.ts`
- Create: `packages/shared/src/flow/spawns.test.ts`
- Modify: `packages/shared/src/net/lobby-messages.ts` (add select/return messages)
- Modify: `packages/shared/src/lobby/status.ts` if `viewFor` needs a tweak
- Modify: `packages/server/src/rooms/ArenaRoom.ts`
- Create: `packages/client/src/scenes/CarSelectScene.ts`
- Create: `packages/client/src/scenes/ResultsScene.ts`
- Modify: `packages/client/src/scenes/LobbyScene.ts` (react to phase / status)
- Modify: `packages/client/src/scenes/ArenaScene.ts` (countdown overlay; ignore inputs until GO)
- Modify: `packages/client/src/main.ts`
- Modify: `docs/architecture.md` (lifecycle)

---

### Task 1: Match-flow reducer (TDD)

`packages/shared/src/flow/match-flow.ts` is **pure**. It does not import Colyseus.

```ts
export type FlowStatus = "ready" | "in_match" | "post_match";

export interface FlowPlayer {
  sessionId: string;
  team: 0 | 1;
  status: FlowStatus;
  carId: string;          // "" until reveal
  selectLocked: boolean;
  alive: boolean;
}

export interface FlowState {
  phase: "lobby" | "car_select" | "countdown" | "match";
  mode: "ffa" | "team";
  tick: number;
  carSelectDeadlineTick: number;
  countdownEndsTick: number;
  roster: string[];          // sessionIds pulled at start
  postMatchIds: string[];
  winnerSessionId: string;
  winnerTeam: number;        // -1 none/draw
  players: FlowPlayer[];
}

export type FlowEvent =
  | { type: "start"; readyIds: string[]; nowTick: number; carSelectTicks: number }
  | { type: "lock_car"; sessionId: string }
  | { type: "reveal"; cars: Record<string, string> }
  | { type: "begin_countdown"; nowTick: number; countdownTicks: number }
  | { type: "go" }
  | { type: "end"; winnerSessionId: string; winnerTeam: number }
  | { type: "return_to_lobby"; sessionId: string };
```

- [ ] **Step 1: Write `match-flow.test.ts` covering:**

1. `start` with two ready + one post_match: only the two ready go `in_match` and into `roster`; post_match unchanged; phase `car_select`; `carSelectDeadlineTick = now + carSelectTicks`.
2. `lock_car` on a roster player sets `selectLocked`. Second lock on same id is a no-op.
3. `lock_car` from a non-roster / ready spectator is a no-op.
4. After all roster locked, caller (room) will reveal — reducer `reveal` writes `carId` from the provided map and does not change phase (room then sends `begin_countdown`).
5. `begin_countdown` → phase `countdown`, `countdownEndsTick` set.
6. `go` → phase `match`.
7. `end` → phase `lobby`, every roster id (still in `players`) is added to `postMatchIds`, those players’ status `post_match`, `winner*` stored.
8. `return_to_lobby` removes that id from `postMatchIds` and sets status `ready`.
9. A second `start` while someone is still `post_match` only pulls current `ready` ids.

- [ ] **Step 2: Implement `reduceFlow(state, event): FlowState` (immutable copy).**
- [ ] **Step 3: Tests pass.** Commit `feat: match flow reducer`

---

### Task 2: Spawn helper (TDD)

`assignSpawns(arena, mode, roster: { sessionId, team }[], random): Record<sessionId, {x,y,angle}>`

- FFA: shuffle `arena.ffaSpawns` and assign one per roster player (need ≤ 6).
- Team: assign `teamASpawns` / `teamBSpawns` in roster order within each team.

Test: FFA all positions unique; team A all `x < width/2`; team B all `x > width/2`. Inject shuffle via `random`.

- [ ] **Step 1: Tests then implementation.**
- [ ] **Step 2: Commit** `feat: spawn assignment for FFA and team`

---

### Task 3: Wire ArenaRoom

Server-only maps on the room class:

```ts
private pendingCarId = new Map<string, CarId>();
private matchRoster = new Set<string>();
private postMatchIds = new Set<string>();
```

Keep `PlayerState.status` in sync after every flow event (single `syncPlayerStatus()`).

**`start_match` (replace P2 no-op):**
1. Host + `canStart` or `start_error`.
2. Collect Ready sessionIds. `reduceFlow(start)`.
3. For each roster player: `status = IN_MATCH`, `selectLocked = false`, `carId = ""`, `alive = true`.
4. `state.phase = CAR_SELECT`, set `carSelectDeadlineTick`.
5. Clear `pendingCarId`.

**`select_car` message** `{ carId: CarId }`:
- Reject unknown carId / not in roster / already locked.
- Store `pendingCarId`, set `selectLocked = true` (still do **not** write `carId`).
- If every roster member is locked → `revealAndCountdown()`.

**Tick extra (phase-aware):**
- If `phase === CAR_SELECT` and `tick >= carSelectDeadlineTick`: for each unlocked roster player pick a random `CarId` from `Object.keys(CAR_TABLE)`, then `revealAndCountdown()`.
- If `phase === COUNTDOWN` and `tick >= countdownEndsTick`: `state.phase = MATCH`.

**`revealAndCountdown()`:** write each `pendingCarId` onto `PlayerState.carId`; `hp = hpOf(carId)`; `assignSpawns` onto `x,y,angle`; `speed = 0`; `state.phase = COUNTDOWN`; `countdownEndsTick = tick + countdownSeconds * TICK_RATE_HZ`.

**`endMatch(winnerSessionId, winnerTeam)`** (called from P5 later; for P3 expose a host-only `debug_end_match` **only when `process.env.NODE_ENV !== "production"`** OR end automatically if roster living count is ≤ 1 because P0 squares never die — **do not auto-end**. P3 validation uses a **host Results skip**: after GO, host can press a "End match (stub)" button that sends `stub_end_match`. Implement `stub_end_match` host-only: winner = first alive roster player, then `endMatch`. Remove this message in P5 when real win detection exists — add a `// P5: delete stub_end_match` comment.

**`return_to_lobby`:** if sender in `postMatchIds`, remove, `status = READY`.

**`set_mode`:** still forbidden if anyone `IN_MATCH`.

New joiners during car_select/match/countdown: Ready, not in roster.

Disconnect of an In-match player: treat as not alive; if that would end the match under spec §5.6, call `endMatch` (implement living-sides check here — P5 will reuse it for HP deaths). Put the check in `shared/flow/win.ts`:

```ts
export function livingSides(
  mode: "ffa" | "team",
  players: { sessionId: string; team: 0 | 1; alive: boolean; inRoster: boolean }[],
): { sides: number; winnerSessionId: string; winnerTeam: number }
```

- FFA: count `inRoster && alive`. sides = that count. If 1, winnerSessionId = that player. If 0, winner empty, winnerTeam -1.
- Team: count teams with ≥ 1 living roster member.

Call after every in-match leave. Tests in `win.test.ts`.

- [ ] **Step 1: `win.test.ts` + `win.ts`.**
- [ ] **Step 2: Room wiring.**
- [ ] **Step 3: Commit** `feat: ArenaRoom car-select, countdown, stub end, win helper`

---

### Task 4: Client scenes and routing

Add `packages/client/src/net/view.ts` that reads `player.status` + `state.phase` and returns the scene key using `viewFor` from shared.

On `room.onStateChange`, if the local view scene ≠ current scene, `scene.start(...)`. This is how Ready players stay in Lobby while others are In match, and Post-match stays on Results when a new match starts.

**CarSelectScene:** three cards (Rectangle / Oval / Hexagon) showing `CAR_TABLE` ratings. Click → `room.send("select_car", { carId })` once. After lock, disable cards. Other players: name + "choosing…" until `carId !== ""`. Timer: `ceil((carSelectDeadlineTick - tick) / TICK_RATE_HZ)`.

**ArenaScene:** if `phase === COUNTDOWN`, draw remaining seconds (3-2-1) and do not send inputs. On GO (`phase === MATCH`) allow input sending (P4 fills real input; P3 may send zeros). After local `alive === false`, camera becomes spectate (P5 polish; P3 can keep follow on wreck).

**ResultsScene:** title Winner / Team A / Team B / Draw from `winnerSessionId` / `winnerTeam`. Roster list + `carId`. Button Back to lobby → `room.send("return_to_lobby")`. **Copy standings into `this.registry` / instance fields on scene create** so a later state wipe of winner fields does not blank the screen. Stay on this scene until local status becomes Ready, then the router starts Lobby.

**LobbyScene:** already shows badges; Start only enabled for host; Ready-only start still uses `canStart`.

- [ ] **Step 1: Implement router + scenes.**
- [ ] **Step 2: Commit** `feat: car select, countdown, results, per-player routing`

---

## Validation

1. `npm run test -w @motor-combat-moba/shared` — flow, spawn, win tests pass.
2. `npm run build --workspaces` exits 0.
3. Manual, 3 browsers A (host), B, C:
   - A starts FFA with A+B Ready, C stays out (C clicks nothing — actually all three join; C must not be pulled: **have C stay Ready by… wait, Start pulls all Ready.** To test linger/next-match: play A+B, C is not in the room yet. After A+B finish (host stub end), both see Results. C joins mid-results as Ready. A clicks Back to lobby (Ready). B still on Results. A cannot start (1 Ready). B Back to lobby. A starts — only A+B go to car select; if C is Ready too, C is also pulled. For the "linger" test: A+B finish; A returns; **C joins as Ready**; A starts with C (2 Ready) while B is still on Results. B’s results stay up. A+C see car select. B roster badge is Post-match.
   - Car select: A picks Rectangle, B does not. Wait 60s **or temporarily set `FLOW_CONFIG.carSelectSeconds` to 5 for this test** — do **not** commit a 5s default. Use env `CAR_SELECT_SECONDS` override read in the room from `process.env` falling back to config, documented in `deployment.md`. For validation, run server with `CAR_SELECT_SECONDS=8`.
   - B receives a random car after timeout; both see cars only at reveal.
   - 3-2-1 shows; cars are frozen until GO.
   - Host stub-end → both Results. Back to lobby independently.
   - Duplicate cars allowed (both Rectangle).
   - Team 1v1: opposite-half spawns (A on left, B on right).
   - FFA: mixed spawn points (not all on one side).
   - Mid-select join (3rd player): they appear Ready in lobby, not in car select.
   - Mid-match disconnect of one FFA player → other wins, Results.

Update the tracker: P3 Done.
