# Netcode Phase 1: Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the game on a 60 Hz clock and replace the shipped input pipeline — seq-numbered queues drained per tick, `setSimulationInterval`, 20 Hz schema patches — with a drift-free `TickScheduler`, tick-stamped inputs read from a per-client `InputRing` (repeat, then neutral), a client that runs `lead` ticks ahead of a dilated clock, and one schema patch broadcast inside every tick.

**Architecture:** Time is owned by three small pure modules. On the server `TickScheduler` anchors tick `k` to `epoch + k × MS_PER_TICK` and the room's `tick()` broadcasts its patch before the wake returns; `InputRing` is the only input memory — it answers `inputFor(tick)` with a fresh, repeated or neutral frame and remembers what it answered last, so press edges need no separate `prevFireMasks` and every on-field car steps every tick. On the client `ClockSync` (N0) gives the server tick, `LeadController` decides how far ahead to run, and `TickLoop` turns frame deltas into whole local ticks at a period dilated by at most ±10 %. `stepSim` is untouched except that its input parameter widens to `InputFrame`; the 60 Hz change is a config edit plus the three hand retunes N1a names, with every fixture re-pinned in the same commit.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest (node environment) in every package, `node --test` for `scripts/*.test.mjs`, Colyseus 0.15.57 (`Room.setPatchRate`, `Room.broadcastPatch`), `tsx` for the playtest harness.

**Spec:** [`../../specs/2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) — §6.1 N1, N1a, N2, N3 (the dilation half), N4, N5; §6.2 N6, N7, N8; §6.3 N9 ("snapshot on tick", still schema in this phase); §6.11 N28; §8 phase 1 row; §11 (the drive-model authorisation and its three retunes); §13 ("Tick rate"). Ledger: [`interfaces.md`](interfaces.md). Prior plans: [`10-netcode-0-instrumentation.md`](10-netcode-0-instrumentation.md) — landed; this plan consumes its `InputFrame`, `ClockSync`, `NetStats`, `PoseHistory`, `bindPing`, `InputLog`, `playtest/netcode.ts` and `scripts/differ-replay.mjs` by name and never re-specifies them; [`01-prep-arena-scene-split-and-render-frame.md`](01-prep-arena-scene-split-and-render-frame.md) — landed; `match/arena-net.ts` and the composer `ArenaScene.ts` exist with the shapes it defines.

## Global Constraints

- Rebuild shared before testing (`npm run build -w @motor-combat-moba/shared`); tests import `src` but consume shared's built `dist`.
- Verify with root `npm test`, never a per-workspace run alone; then root `npm run typecheck` and root `npm run build`.
- `.js` import specifiers on every local import; shared is imported as `@motor-combat-moba/shared` from server and client `src`, and by deep `dist` path only from `scripts/*.mjs`.
- Nothing under `packages/client/src/match/` imports Phaser and no test imports Phaser.
- Do not touch `packages/server/playtest/` except to fix a compile break, and say loudly in the task's commit step which probe numbers your change moves. This plan fixes four compile breaks there (`world.ts`, `prediction.ts`, `netcode.ts`, `run-all.ts` is untouched) and edits no expectation, threshold or verdict.
- Do not edit `docs/ideas/` or `docs/invariants/`.
- Commit after every task on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch off it).
- No magic numbers in logic: every threshold is a named constant with a comment, and every balance-flavoured number lives in shared config.
- Task 1 changes `TICK_RATE_HZ` and `DRIVE_CONFIG`, so it carries the `npm run build:manual` + commit-the-page step and the `docs/turn-tuning.md` update the root `CLAUDE.md` requires. No other task touches a balance table.
- The drive-model fence (root `CLAUDE.md` "Stop and ask") is crossed exactly where spec §11 authorises it: the 60 Hz tick and the three named retunes. `stepDrive`, `stepSim`, `resolveWorld` and `resolveContacts` are not edited in code; where this plan finds a retune the knob cannot deliver (Task 1, `restitution`) it records the measurement and stops rather than editing the resolver.

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/constants.ts` (modify) | `TICK_RATE_HZ = 60`; `DEFAULT_PATCH_RATE_HZ` deleted (Task 2) |
| `packages/shared/src/config/drive-config.ts` (modify) | `reverseHoldTicks: 4` |
| `packages/shared/src/config/net-config.ts` (modify) | the N1 keys; `maxInputsPerTick`, `pendingInputCap` deleted |
| `packages/shared/src/sim/collide-rate.test.ts` (create) | the recorded 30 Hz vs 60 Hz contact traces (Task 1) |
| `packages/shared/src/sim/golden.test.ts` (modify) | re-pinned at `DT = 1 / 60` |
| `packages/shared/src/net/input.ts` (modify) | `InputMessage { tick }`, `NEUTRAL_INPUT` |
| `packages/shared/src/sim/step.ts`, `sim/drive.ts` (modify) | input parameter widened to `InputFrame` |
| `packages/shared/src/schema/PlayerState.ts` (modify) | `ackTick`, `slackTicks` replace `lastProcessedInputSeq` |
| `packages/server/src/config/bot-profiles.ts` (modify) | every `*Ticks` field doubled (N28) |
| `packages/server/src/net/tick-scheduler.ts` (create) | `TickScheduler` |
| `packages/server/src/net/input-ring.ts` (create) | `InputRing`, `AcceptResult`, `RingRead` |
| `packages/server/src/net/input-message.ts` (modify) | validates `tick` |
| `packages/server/src/sim/tick.ts` (modify) | `serverTick` reads rings; no coast, no `prevFireMasks` |
| `packages/server/src/rooms/tick-pipeline.ts` (modify) | `PipelineCtx.rings`; `runPipeline` returns the reads |
| `packages/server/src/rooms/{ArenaRoom,PracticeRoom,PlaygroundRoom}.ts` (modify) | scheduler, patch-on-tick, rings, bots writing into the ring |
| `packages/server/src/mode.ts` (modify) | `getTickRateHz` deleted |
| `packages/server/balance/match.ts`, `packages/server/playtest/{world,prediction,netcode}.ts` (modify) | rings and tick stamps |
| `packages/client/src/match/lead.ts` (create) | `LeadController` |
| `packages/client/src/match/tick-loop.ts` (create) | `TickLoop` |
| `packages/client/src/net/prediction.ts` (modify) | pending entries keyed by tick; `reconcile(…, ackTick, …)` |
| `packages/client/src/scenes/arena-input.ts` (modify) | `drainTicks` deleted; `axisOf` stays |
| `packages/client/src/match/arena-net.ts` (modify) | `attachClock`, `localTick`, `lead`; tick-stamped sends through `TickLoop` |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | passes the N0 `ClockSync` to `ArenaNet`; netgraph `D` suggestion uses `lead` |
| `scripts/differ-replay.mjs`, `scripts/release-env.mjs` (+ `.test.mjs`) (modify) | plain `InputFrame` literals; the `TICK_RATE_HZ=` env line removed |
| `docs/turn-tuning.md`, `docs/bot-behavior.md`, `docs/config-reference.md`, `docs/networking.md`, `docs/architecture.md`, `docs/schema-reference.md`, `docs/glossary.md`, root and package `CLAUDE.md` (modify) | the numbers and the rules that moved |

---

### Task 1: The sim runs at 60 Hz (N1a) — three hand retunes, every fixture re-pinned

**Files:**
- Modify: `packages/shared/src/constants.ts:1`, `packages/shared/src/config/drive-config.ts:152-156`, `packages/shared/src/sim/golden.test.ts:9-113`, `packages/server/src/config/bot-profiles.ts:126-162`, `docs/turn-tuning.md:101-102`, `docs/bot-behavior.md:39-106`, `docs/config-reference.md:366`, the test files in the table under Step 5, `packages/client/public/manual.html` (regenerated)
- Create: `packages/shared/src/sim/collide-rate.test.ts`

**Interfaces:**
- Produces: `TICK_RATE_HZ = 60`, `MS_PER_TICK = 16.666…`, `DRIVE_CONFIG.reverseHoldTicks = 4`. Every later task and every tick-derived table (`WEAPON_TICKS`, `STATUS_PULSE_TICKS`, `DEATHMATCH_TICKS`, `SLAM_TICKS`, `AIM_TICKS`, `RAM_DECAY`) follows automatically.

- [ ] **Step 1: Capture the 30 Hz playtest baseline**

Run: `npm run playtest`
Expected: a folder `packages/server/playtest/reports/<date-NN>/` with `summary.md`. Note its name in the commit message — spec §8's phase 1 acceptance is "`npm run playtest` baseline captured before and after", and this is the "before".

- [ ] **Step 2: Write the failing tests — the contact traces and the re-pinned golden fixture**

```ts
// packages/shared/src/sim/collide-rate.test.ts
import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { forwardMaxSpeedOf } from "../config/car-config.js";
import { resolveWorld } from "./collide.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import { stepSim, type SimBody, type StepContext } from "./step.js";

/**
 * The recorded 30 Hz contact traces, kept beside the 60 Hz ones (netcode spec N1a, §11).
 *
 * `resolveWorld` has no `dt` and `stepSim` takes it as a parameter, so both rates are computable
 * from the shipped code at once. The head-on rebound is one event per impact and does not move.
 * The wall grind — a car pushing into a wall at a shallow angle, reflected once per tick while its
 * engine re-accelerates it — is the case N1a warns about: the loss is per tick and the push per
 * second, so the equilibrium grind speed halves at 60 Hz. No `restitution` value restores it: the
 * per-tick loss is dominated by the "1" in `(1 + restitution)`, not by `restitution`, and the value
 * that would (0.74 at 25°) doubles the head-on rebound. So the knob stays at 0.35 and these traces
 * are the record; a dt-aware grind term would be a `resolveWorld` edit and is a stop-and-ask item.
 */
const BOUNDS = { width: 4000, height: 4000 };
const body = (over: Partial<SimBody> = {}): SimBody => ({
  x: 0, y: 0, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0, authority: 1,
  maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0, ...over,
});
const ctx: StepContext = { carId: "mirage", others: [], obstacles: [], bounds: BOUNDS, modifiers: NEUTRAL_MODIFIERS };
const UP = { steer: 0, throttle: 1, fireSlots: 0 } as const;
const TOP = forwardMaxSpeedOf("mirage");

/** Two seconds of full throttle into the y = 0 wall at `deg` off the wall, at `hz`. */
function grind(deg: number, hz: number): SimBody {
  let b = body({ x: 200, y: 16, angle: (-deg * Math.PI) / 180, speed: TOP });
  for (let i = 0; i < hz * 2; i++) b = stepSim(b, UP, 1 / hz, ctx);
  return b;
}

describe("contact damping across the tick rate", () => {
  it("rebounds a head-on wall hit at restitution x impact speed — one event, no rate in it", () => {
    const out = resolveWorld(body({ x: 200, y: -5, angle: -Math.PI / 2, speed: TOP }), [], [], BOUNDS);
    expect(out.speed).toBeCloseTo(-TOP * DRIVE_CONFIG.restitution, 9);
    expect(DRIVE_CONFIG.restitution).toBe(0.35);
  });
  it("records the 25-degree wall grind: 386.8 u/s after 2 s at 30 Hz, 193.3 u/s at 60 Hz", () => {
    expect(grind(25, 30).speed).toBeCloseTo(386.8, 1);
    expect(grind(25, 60).speed).toBeCloseTo(193.3, 1);
  });
  it("leaves a 10-degree grind at the speed cap at both rates — the shift lives in the 17-31 degree band", () => {
    expect(grind(10, 30).speed).toBeCloseTo(443.5, 1);
    expect(grind(10, 60).speed).toBeCloseTo(443.5, 1);
  });
});
```

In `golden.test.ts` replace the header comment (lines 9–23), `DT` (24) and the seven `stepDrive` expectations (83–113) with:

```ts
/**
 * Behaviour frozen from the implementation as it stood on 2026-09-04, re-pinned at the 60 Hz step
 * (netcode spec N1a). Before that date these numbers were recorded at `DT = 1 / 30`; the Euler
 * step halved, so every position below moved by a few units while every speed and every cap held.
 * That is the one re-record this file has ever had, and it was a deliberate tick-rate change, not
 * a drift.
 *
 * What is still frozen: the ram fields (`angVel`, `shoveX`, `shoveY`, `authority`) are ADDED terms
 * that contribute exactly zero at neutral, and `NEUTRAL_MODIFIERS` multiplies every constant by 1.
 * If one of these moves without `TICK_RATE_HZ` moving, the additive or multiplicative property has
 * been broken and the change is wrong — do not re-record them.
 *
 * Pinned against `GOLDEN_CHASSIS`, a frozen fixture, not a car in `CAR_TABLE`: retuning the roster
 * cannot move them. `reverseHoldTicks` is read live (4 at 60 Hz), which the reverse case pins.
 */
const DT = 1 / 60;
```

```ts
describe("golden: stepDrive at the 60 Hz step", () => {
  it("accelerates straight for 20 ticks", () => {
    expectPose(drive(body(), input(0, 1), 20), 45.5, 0, 0, 260);
  });
  it("accelerates while turning right for 20 ticks", () => {
    expectPose(drive(body(), input(1, 1), 20), 25.8472632944, 34.3263205011, 1.365, 260);
  });
  it("turns left under throttle for 50 ticks, capped at top speed", () => {
    expectPose(drive(body(), input(-1, 1), 50), -131.9386895842, -133.7190687246, -3.465, 540);
  });
  it("coasts from 300 for 16 ticks", () => {
    expectPose(drive(body({ speed: 300 }), input(0, 0), 16), 46, 0, 0, 60);
  });
  it("brakes from 300 to rest in 12 ticks", () => {
    expectPose(drive(body({ speed: 300 }), input(0, -1), 12), 25.6666666667, 0, 0, 0);
  });
  it("engages reverse from rest after the hold delay", () => {
    const out = drive(body(), input(0, -1), 24);
    expectPose(out, -69.7555555556, 0, 0, -351);
    expect(out.reverseHold).toBe(4);
  });
  it("accelerates and turns from a non-zero heading", () => {
    expectPose(drive(body({ angle: 0.7 }), input(1, 1), 30), -44.8333005098, 76.4817429979, 2.765, 390);
  });
});
```

The `resolveWorld` block (115–144) is untouched: it has no `dt`. `input()` at line 43 keeps `seq: 0` until Task 4 removes it.

- [ ] **Step 3: Run them to verify they fail**

Run: `cd packages/shared && npx vitest run src/sim/collide-rate.test.ts src/sim/golden.test.ts`
Expected: `collide-rate` passes (both rates are computable today); `golden` FAILS on every `stepDrive` case — `45.5` vs `47.67…` on the first, and `reverseHold` 2 vs 4.

- [ ] **Step 4: The two config edits**

`constants.ts:1` → `export const TICK_RATE_HZ = 60;`. In `drive-config.ts` replace the `reverseHoldTicks` block (152–156) with:

```ts
  /**
   * Ticks Down must be held *at rest* before reverse engages, guarding against a tap of the brake
   * flinging you backward. Authored in ticks because the sim compares `reverseHold` (a networked
   * uint16) against it directly; 2 -> 4 with the 60 Hz tick on 2026-09-04 (netcode spec N1a), so
   * it is still 67 ms of held brake. Double it again if the tick rate ever doubles again.
   */
  reverseHoldTicks: 4,
```

`restitution` stays `0.35` — the reason is the header of `collide-rate.test.ts`. Add one line to its comment in `drive-config.ts` (line 182): `/** Rebound fraction per impact; rate-independent by construction — see `sim/collide-rate.test.ts` before retuning. */`.

- [ ] **Step 5: Re-pin every test that spelled a 30 Hz tick count**

Rebuild shared (`npm run build -w @motor-combat-moba/shared`), run `npm test`, and fix each failure from this table. Every value is `msToTicks(ms)` at 60 Hz or `ceil(range / speed × 60)`; the comments beside them say "at 60 Hz".

| File | Old → new |
|---|---|
| `shared/src/config/weapon-ticks.test.ts` | `msToTicks(500)` 15 → 30; `msToTicks(250)` 8 → 15; magmablast `cooldown` 48 → 96, `flight` 45 → 90; thumper `projectileLifetime` 87 → 174; wildcharge `maneuverDuration` 300 → 600; predator `homingDuration` 60 → 120 |
| `shared/src/config/aim-config.test.ts:54-59` | test name "at 60 Hz"; `TICK_RATE_HZ` 30 → 60; `commit` 12 → 24; `lockTimeout` 24 → 48; `losGrace` 9 → 18 |
| `shared/src/config/deathmatch-config.test.ts:10` | `phase` 45 → 90 |
| `shared/src/sim/weapons/instances.test.ts` | `dt: 1 / 30` (334, 358) → `1 / 60`; `(300 * Math.PI / 180) / 30` (370) → `/ 60`; `10 + 60` (377, 389) → `10 + 120`; `100 + 87` (418) → `100 + 174` and `instanceExpired(shot, 187, …)` → `274` |
| `shared/src/sim/weapons/fire.test.ts` | `rechargeEndsTick` 130 → 160 (95); the loop `tick < 130` / `step(state, 130, …)` / `"p1#130#0"` (217–232) → 160; `LANCE_EXIT` 221 → 242 (700 ms = 42 ticks); `switchLockUntilTick` 251 → 302 (305) |
| `shared/src/sim/combat.test.ts` | `Math.ceil((400 / 1600) * 30)` (951) → `* TICK_RATE_HZ`; `toBe(8)` (1189) → 15 |
| `shared/src/sim/step.test.ts:119` | `DASH_TICKS = 8` → `15; // 400u of range at 26.7u per tick` |
| `client/src/scenes/combat-visual.test.ts:736-737` | `WINDUP` 21 → 42 |

`drive.test.ts`, `hits.test.ts` and `collide.test.ts` keep their local `DT = 1 / 30`: they pin equations that take `dt` as a parameter, not the rate; only update `drive.test.ts:529`'s comment to "at 60 Hz that is 26.7u against a 16u bound -> 2 substeps" if the assertion there reads `dashSubstepCount` with the file's own DT (it does, so the number it asserts is unchanged).

`BOT_PROFILES` (`bot-profiles.ts:126-162`) is authored in ticks and is not covered by `msToTicks`; spec N28 requires no bot behaviour change and says the staleness parameter is "re-expressed in snapshot ticks". Double every `*Ticks` field, all thirteen, in all three tiers: `viewStalenessTicks` 8/6/4, `reactionDelayTicks` 18/12/8, `recomputeTicks` 24/12/4, `acquireTicks` 30/18/10, `memoryTicks` 30/90/180, `aimErrorDriftTicks` 40/28/18, `burstGapTicks` 28/14/6, `targetCommitTicks` 300/120/50, `dodgeReactionTicks` 24/16/8, `dodgeHorizonTicks` 24/36/48, `blunderTicks` 20/20/20, `stanceCommitTicks` 90/60/36. The header's "433 / 300 / 200 ms" stays true. `BOT_BRAIN_VERSION` is not bumped — the brain did not change, the table did, and `botFingerprint` sees the table. Mirror the same thirteen rows in `docs/bot-behavior.md:39-106`.

- [ ] **Step 6: The hand-maintained turn page**

In `docs/turn-tuning.md` replace lines 101–102 with:

```
| — per tick | ÷ `TICK_RATE_HZ` (60) | 0.1185 rad | 0.1365 rad | 0.105 rad |
| — degrees per tick | ″ | 6.79° | 7.82° | 6.02° |
```

Then `node --test scripts/turn-tuning-doc.test.mjs` (after the shared rebuild) — Expected: PASS. Re-read the prose: no sentence on that page quotes a per-tick figure, so nothing else moves.

- [ ] **Step 7: Config reference and the manual**

`docs/config-reference.md:366` → `| \`reverseHoldTicks\` | 4 (67ms at \`TICK_RATE_HZ\` 60) |`. Then `npm run build:manual` and stage `packages/client/public/manual.html` — the page quotes `TICK_RATE_HZ` in its rounding note and every tick-derived cell, and `scripts/manual-page.test.mjs` fails until it is rebuilt.

- [ ] **Step 8: Full verification, and the "after" baseline**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run playtest`
Expected: every suite green including `golden`, `turn-tuning-doc`, `manual-page`, `check-art`; a second report folder.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/config/drive-config.ts packages/shared/src/sim/collide-rate.test.ts packages/shared/src/sim/golden.test.ts packages/shared/src/config/weapon-ticks.test.ts packages/shared/src/config/aim-config.test.ts packages/shared/src/config/deathmatch-config.test.ts packages/shared/src/sim/weapons/instances.test.ts packages/shared/src/sim/weapons/fire.test.ts packages/shared/src/sim/combat.test.ts packages/shared/src/sim/step.test.ts packages/shared/src/sim/drive.test.ts packages/client/src/scenes/combat-visual.test.ts packages/server/src/config/bot-profiles.ts docs/turn-tuning.md docs/bot-behavior.md docs/config-reference.md packages/client/public/manual.html
git commit -m "feat(sim)!: 60 Hz tick (N1a) — reverseHoldTicks 4, golden re-pinned, bot ticks doubled, restitution held at 0.35 (grind trace recorded); playtest baselines <before-dir> -> <after-dir>"
```

**Say it loudly.** This task moves what every probe measures. The balance `configFingerprint` and `botFingerprint` both change, so `npm run balance -- --baseline` refuses any report from before this commit — expected, and the reason the fingerprints exist. Probe numbers that move, none of them edited here: `collision.ts` quotes "19.2 u/tick" and "38.4 u/tick" (now 9.6 and 19.2) in its header and report string, and its `/ 30` at line 50 now prints the wrong per-tick figure; `weapons.ts:202` and `weapons2.ts:133` divide by a literal 30 the same way; `weapons.ts:355` "300 ticks = 10s" is now 5 s, `:379` `total = 900 // 30 seconds` is now 15 s, `:394` "(30s)", `:512` "~5 ticks" is ~9; `weapons2.ts:271` "400 ticks" is 6.7 s; `collision.ts:365,394` "300 ticks (10 s)" is 5 s; `ram.ts` and the pile-up scenarios run half as long in wall time; `prediction.ts` and `netcode.ts` change again in Tasks 2 and 4. Recommend `npm run playtest` and a read of both baselines before asking for any probe edit.

---

### Task 2: `TickScheduler`, the patch inside the tick, and the `NET_CONFIG` keys

**Files:**
- Create: `packages/server/src/net/tick-scheduler.ts`, `packages/server/src/net/tick-scheduler.test.ts`
- Modify: `packages/shared/src/constants.ts:10`, `packages/shared/src/index.ts:6`, `packages/shared/src/config/net-config.ts`, `packages/shared/src/config/config.test.ts:264-269`, `packages/server/src/mode.ts:633-636`, `packages/server/src/rooms/ArenaRoom.ts:111-120, 300-301`, `PracticeRoom.ts:182-184, 330-338`, `PlaygroundRoom.ts:188-193, 337-341`, `packages/server/playtest/prediction.ts:54, 201, 213`, `packages/server/playtest/netcode.ts` (`PATCH_EVERY` and the N1 report line), `scripts/release-env.mjs:77`, `scripts/release-env.test.mjs:102,109-110`, `docs/config-reference.md:17,23`

**Interfaces:**
- Produces: `class TickScheduler` (ledger, plus `opts.clearTimeout`, `opts.onReanchor(droppedTicks)`, `opts.onError(error)`); `NET_CONFIG.snapshotEvery = 1`, `ringSize = 128`, `repeatMaxTicks = 12`, `maxCatchUpTicks = 6`, `leadMin = 2`, `leadMax = 16`, `slackTargetMin = 2`, `slackTargetMax = 3`, `slackWindowTicks = 120`, `leadLowerHoldMs = 5000`, `dilationMax = 0.1`, `reanchorTicks = 4`; `DEFAULT_PATCH_RATE_HZ` and `getTickRateHz` deleted. Tasks 3 and 4 consume the keys.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/server/src/net/tick-scheduler.test.ts
import { describe, expect, it } from "vitest";
import { TickScheduler } from "./tick-scheduler.js";

/** A clock and a timer queue the test advances by hand; timers fire in due order as time passes. */
function fakeTime() {
  let now = 0;
  const timers: { at: number; cb: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    now: () => now,
    setTimeout: (cb: () => void, ms: number) => { const id = nextId++; timers.push({ at: now + ms, cb, id }); return id; },
    clearTimeout: (handle: unknown) => { const i = timers.findIndex((t) => t.id === handle); if (i >= 0) timers.splice(i, 1); },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.cb();
      }
      now = end;
    },
  };
}

function scheduler(time: ReturnType<typeof fakeTime>, periodMs: number, ticks: number[], opts: { maxCatchUpTicks?: number; onReanchor?: (n: number) => void } = {}) {
  return new TickScheduler(periodMs, (tick) => ticks.push(tick), { ...opts, now: time.now, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout });
}

describe("TickScheduler", () => {
  it("runs tick k at epoch + k x period and reports how far into the current tick it is", () => {
    const time = fakeTime();
    const ticks: number[] = [];
    const s = scheduler(time, 10, ticks);
    s.start();
    time.advance(35);
    expect(ticks).toEqual([1, 2, 3]);
    expect(s.tick).toBe(3);
    expect(s.msIntoTick()).toBe(5);
  });
  it("does not drift: 1000 ms of 7 ms wakes is exactly 50 ticks at a 20 ms period", () => {
    const time = fakeTime();
    const ticks: number[] = [];
    scheduler(time, 20, ticks).start();
    for (let i = 0; i < 1000 / 7; i++) time.advance(7);
    time.advance(1000 - 7 * Math.floor(1000 / 7));
    expect(ticks.length).toBe(50);
  });
  it("catches up a late wake tick by tick, then re-anchors past the cap", () => {
    const time = fakeTime();
    const ticks: number[] = [];
    const dropped: number[] = [];
    const s = scheduler(time, 10, ticks, { maxCatchUpTicks: 6, onReanchor: (n) => dropped.push(n) });
    s.start();
    time.advance(100); // the first timer fires at 10 but the wake sees 100 ms elapsed
    expect(ticks).toEqual([1, 2, 3, 4, 5, 6]);
    expect(dropped).toEqual([4]);
    expect(s.msIntoTick()).toBe(0); // the epoch moved so tick 6 "began" now
    time.advance(10);
    expect(ticks.length).toBe(7);
  });
  it("stops cleanly", () => {
    const time = fakeTime();
    const ticks: number[] = [];
    const s = scheduler(time, 10, ticks);
    s.start();
    time.advance(15);
    s.stop();
    time.advance(50);
    expect(ticks).toEqual([1]);
  });
});
```

Append to the `NET_CONFIG` describe in `config.test.ts`, replacing the `maxInputsPerTick` case (264–269):

```ts
  it("carries the phase-1 time knobs (N1, N4, N5, N6)", () => {
    expect(NET_CONFIG.snapshotEvery).toBe(1);
    expect(NET_CONFIG.ringSize).toBe(128);
    expect(NET_CONFIG.repeatMaxTicks).toBe(12);
    expect(NET_CONFIG.maxCatchUpTicks).toBe(6);
    expect([NET_CONFIG.leadMin, NET_CONFIG.leadMax]).toEqual([2, 16]);
    expect([NET_CONFIG.slackTargetMin, NET_CONFIG.slackTargetMax]).toEqual([2, 3]);
    expect(NET_CONFIG.slackWindowTicks).toBe(120);
    expect(NET_CONFIG.leadLowerHoldMs).toBe(5000);
    expect(NET_CONFIG.dilationMax).toBe(0.1);
    expect(NET_CONFIG.reanchorTicks).toBe(4);
    // The ring must outlast the longest lead plus the longest repeat run, or a slow client's inputs
    // would be evicted before they were read.
    expect(NET_CONFIG.ringSize).toBeGreaterThan(NET_CONFIG.leadMax + NET_CONFIG.repeatMaxTicks);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/server && npx vitest run src/net/tick-scheduler.test.ts; cd ../shared && npx vitest run src/config/config.test.ts`
Expected: FAIL — module not found; `snapshotEvery` undefined.

- [ ] **Step 3: Write the scheduler and the knobs**

```ts
// packages/server/src/net/tick-scheduler.ts
import { NET_CONFIG } from "@motor-combat-moba/shared";

export interface TickSchedulerOpts {
  /** Ticks one wake may run before the epoch is moved instead (spec N1). Default `NET_CONFIG.maxCatchUpTicks`. */
  maxCatchUpTicks?: number;
  now?: () => number;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** A wake was more than the cap behind: `dropped` ticks were skipped and the epoch re-anchored. */
  onReanchor?: (dropped: number) => void;
  /** A tick threw. The loop keeps running; default logs to `console.error`. */
  onError?: (error: unknown) => void;
}

/**
 * Drift-free tick clock (netcode spec N1). Tick `k` is due at `epoch + k * periodMs` on the given
 * clock; each wake runs every tick that is due, up to `maxCatchUpTicks`, then re-arms for the next
 * boundary. `setInterval` (what `setSimulationInterval` wraps) accumulates its own lateness, so sim
 * time and wall time drift apart and a 180 s Deathmatch is not 180 s; this anchors every tick to
 * the epoch instead. A wake further behind than the cap moves the epoch rather than replaying a
 * burst — the room's clients would already have repeated their last inputs through the stall.
 */
export class TickScheduler {
  private readonly maxCatchUp: number;
  private readonly now: () => number;
  private readonly set: (cb: () => void, ms: number) => unknown;
  private readonly clear: (handle: unknown) => void;
  private readonly onReanchor: ((dropped: number) => void) | undefined;
  private readonly onError: (error: unknown) => void;
  private epochMs = 0;
  private count = 0;
  private handle: unknown;
  private running = false;

  constructor(
    private readonly periodMs: number,
    private readonly onTick: (tick: number) => void,
    opts: TickSchedulerOpts = {},
  ) {
    this.maxCatchUp = opts.maxCatchUpTicks ?? NET_CONFIG.maxCatchUpTicks;
    this.now = opts.now ?? (() => performance.now());
    this.set = opts.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
    this.clear = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onReanchor = opts.onReanchor;
    this.onError = opts.onError ?? ((error) => console.error("[tick] uncaught in tick:", error));
  }

  start(): void {
    this.running = true;
    this.count = 0;
    this.epochMs = this.now();
    this.arm();
  }

  stop(): void {
    this.running = false;
    if (this.handle !== undefined) this.clear(this.handle);
    this.handle = undefined;
  }

  /** Ticks run since `start`. The room's `state.tick` may lag it (a paused practice room skips wakes). */
  get tick(): number {
    return this.count;
  }

  /** Milliseconds since the newest tick's boundary, for pong (N3). Never negative. */
  msIntoTick(nowMs: number = this.now()): number {
    return Math.max(0, nowMs - (this.epochMs + this.count * this.periodMs));
  }

  private arm(): void {
    const next = this.epochMs + (this.count + 1) * this.periodMs;
    this.handle = this.set(() => this.wake(), Math.max(0, next - this.now()));
  }

  private wake(): void {
    this.handle = undefined;
    if (!this.running) return;
    const now = this.now();
    const due = Math.floor((now - this.epochMs) / this.periodMs);
    let ran = 0;
    while (this.count < due && ran < this.maxCatchUp) {
      this.count += 1;
      ran += 1;
      try {
        this.onTick(this.count);
      } catch (error) {
        this.onError(error);
      }
      if (!this.running) return;
    }
    if (this.count < due) {
      this.onReanchor?.(due - this.count);
      this.epochMs = now - this.count * this.periodMs;
    }
    this.arm();
  }
}
```

`net-config.ts` becomes (the four reconcile/interpolation keys and the two N0 keys keep their comments; `maxInputsPerTick` and `pendingInputCap` stay until Task 4 deletes their last readers):

```ts
export const NET_CONFIG = {
  maxInputsPerTick: 5,
  pendingInputCap: 24,
  reconcileSnapPos: 24,
  reconcileSnapAngle: 0.6,
  reconcileEaseRate: 0.25,
  interpolationDelayMs: 67,
  pingIntervalMs: 500,
  clockSamples: 8,
  /** Ticks between snapshots (N9). 1 = every tick; 2 is the fallback for a host whose upload cannot carry 60 Hz. */
  snapshotEvery: 1,
  /** Input ring length in ticks (N6): about two seconds. Must exceed `leadMax + repeatMaxTicks`. */
  ringSize: 128,
  /** Consecutive ticks a missing input is repeated before the ring falls back to neutral (N6): 200 ms. */
  repeatMaxTicks: 12,
  /** Ticks one server wake or one client frame may run before re-anchoring instead (N1, N5): 100 ms. */
  maxCatchUpTicks: 6,
  /** Lead clamp in ticks (N4): 33-267 ms. */
  leadMin: 2,
  leadMax: 16,
  /** The slack band the lead controller holds (N4): the measured 60 Hz floor of three ticks of buffer occupancy. */
  slackTargetMin: 2,
  slackTargetMax: 3,
  /** Window for the 5th-percentile slack test (N4): 2 s. */
  slackWindowTicks: 120,
  /** How long the median slack must sit above `slackTargetMax + 1` before lead drops by one (N4). */
  leadLowerHoldMs: 5000,
  /** The most the client tick period is stretched or squeezed to land on the server clock (N3): ±10 %. */
  dilationMax: 0.1,
  /** A clock target that moves by more than this many ticks jumps instead of dilating (N3). */
  reanchorTicks: 4,
} as const;
```

Delete `DEFAULT_PATCH_RATE_HZ` from `constants.ts:10` and `index.ts:6`. Delete `getTickRateHz` from `mode.ts` (lines 633–636) — there is no test for it; spec N11 retires the override and §8 lists it under phase 2, but nothing in this phase may run at a rate other than `TICK_RATE_HZ` once inputs are tick-stamped, so it goes now. In `release-env.mjs:77` delete the `TICK_RATE_HZ=` line; in `release-env.test.mjs` delete the assertion at 102 and change the fixture at 109–110 from `TICK_RATE_HZ=60` to `SIM_LATENCY_MS=60`. `docs/config-reference.md`: delete the env-table row at 17 and replace line 23 with "Canonical sim rate is `TICK_RATE_HZ` in `@motor-combat-moba/shared` (60). Snapshots go out on the tick, every `NET_CONFIG.snapshotEvery` ticks; there is no separate patch rate and no env override."

- [ ] **Step 4: Adopt the scheduler and broadcast the patch inside the tick, in all three rooms**

| Room | Old (line) | New |
|---|---|---|
| all three | `import { getTickRateHz, … } from "../mode.js"` | drop `getTickRateHz`; add `import { TickScheduler } from "../net/tick-scheduler.js";` and `MS_PER_TICK`, `NET_CONFIG` to the shared import (Practice already has `NET_CONFIG`) |
| all three | the N0 field `private lastTickAtMs = 0;` and the `performance.now()` stamp at the top of `tick()` | deleted; field `private readonly scheduler = new TickScheduler(MS_PER_TICK, () => this.wake(), { onReanchor: (n) => console.warn(\`[${ROOM}] ${n} ticks behind, re-anchored\`) });` |
| all three | `roomClock()` (N0) | `return { tick: this.state.tick, msIntoTick: this.scheduler.msIntoTick() };` |
| Arena 118–120 | `this.setPatchRate(1000 / DEFAULT_PATCH_RATE_HZ); const hz = …; this.setSimulationInterval(() => this.tick(), 1000 / hz);` | `this.setPatchRate(0); this.scheduler.start();` |
| Practice 183–184, Playground 192–193 | same pair | same replacement |
| all three, new method | — | `private wake(): void { this.tick(); if (this.state.tick % NET_CONFIG.snapshotEvery === 0) this.broadcastPatch(); }` |
| all three | `ctx()`'s `hz: getTickRateHz(TICK_RATE_HZ)` | `hz: TICK_RATE_HZ` (Task 4 removes the field) |
| Arena (N0 added `onDispose`), Practice, Playground `onDispose` | — | add `this.scheduler.stop();` as the first statement |

`setPatchRate(0)` rather than the spec's `null`: 0.15.57's `Room.setPatchRate` (`build/Room.js:177-185`) clears the interval and arms a new one only when `milliseconds !== null && milliseconds !== 0`, and the typed signature takes a `number`. `broadcastPatch()` is public and, with no simulation interval set, also ticks the room's own `clock` (line 271) — nothing here reads it. The practice room's `tick()` returns early while paused; the wake still broadcasts, and an unchanged state encodes to nothing.

`ArenaRoom.tick()`'s first statement is now `this.state.tick += 1;` again (the N0 stamp is gone); the same for the other two rooms.

- [ ] **Step 5: Fix the two probes that stop compiling**

`playtest/prediction.ts:54` and `:213` — `const patchEvery = Math.round(TICK_RATE_HZ / DEFAULT_PATCH_RATE_HZ);` → `const patchEvery = NET_CONFIG.snapshotEvery;` (`NET_CONFIG` joins the import, `DEFAULT_PATCH_RATE_HZ` leaves it); line 201's report string `patches ${DEFAULT_PATCH_RATE_HZ} Hz` → `a snapshot every ${NET_CONFIG.snapshotEvery} tick(s)`. `playtest/netcode.ts` — `PATCH_EVERY` and the N1 report line the same way. Both are compile breaks and nothing else in either file is touched in this task.

- [ ] **Step 6: Verify**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build`
Expected: green. Then `npm run dev`, Practice → Start: the car drives; `?debug=net` shows an RTT of a few ms and `bytes in` climbing about three times faster than before this task (a patch every 16.7 ms instead of every 50 ms — expected, and what N2's codec exists to fix).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/net/tick-scheduler.ts packages/server/src/net/tick-scheduler.test.ts packages/shared/src/constants.ts packages/shared/src/index.ts packages/shared/src/config/net-config.ts packages/shared/src/config/config.test.ts packages/server/src/mode.ts packages/server/src/rooms/ArenaRoom.ts packages/server/src/rooms/PracticeRoom.ts packages/server/src/rooms/PlaygroundRoom.ts packages/server/playtest/prediction.ts packages/server/playtest/netcode.ts scripts/release-env.mjs scripts/release-env.test.mjs docs/config-reference.md
git commit -m "feat(server): TickScheduler anchors ticks to the epoch and broadcasts the patch inside the tick; DEFAULT_PATCH_RATE_HZ and the TICK_RATE_HZ override deleted (N1, N9)"
```

**Say it loudly:** `prediction.ts` and `netcode.ts` now model a snapshot every tick — their correction and frozen-frame rows shrink for that reason alone, before any client change. The `DEFAULT_PATCH_RATE_HZ` compile break was fixed in both; no threshold moved.

---

### Task 3: `LeadController` and `TickLoop` — the client's two pure time modules

**Files:**
- Create: `packages/client/src/match/lead.ts`, `packages/client/src/match/lead.test.ts`, `packages/client/src/match/tick-loop.ts`, `packages/client/src/match/tick-loop.test.ts`

**Interfaces:**
- Consumes: `NET_CONFIG` (Task 2), `MS_PER_TICK`.
- Produces: `class LeadController` and `class TickLoop` exactly as the ledger types them, plus `LeadController.reset()` and `TickLoop.acc` (read-only, for tests). Task 4 consumes both.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/client/src/match/lead.test.ts
import { describe, expect, it } from "vitest";
import { NET_CONFIG } from "@motor-combat-moba/shared";
import { LeadController, RAISE_MIN_SAMPLES } from "./lead.js";

describe("LeadController", () => {
  it("derives the initial lead from RTT, jitter and one tick, clamped to [leadMin, leadMax] (N4)", () => {
    const c = new LeadController(NET_CONFIG);
    expect(c.initial(90, 20)).toBe(5); // (45 + 20 + 16.7) / 16.7 = 4.9 -> 5
    expect(c.initial(0, 0)).toBe(NET_CONFIG.leadMin);
    expect(c.initial(1000, 0)).toBe(NET_CONFIG.leadMax);
  });
  it("raises lead by one the moment the 5th-percentile slack drops below the target floor", () => {
    const c = new LeadController(NET_CONFIG);
    c.initial(90, 20);
    for (let i = 0; i < RAISE_MIN_SAMPLES - 2; i++) c.observe(3, 0);
    c.observe(1, 0);
    expect(c.lead).toBe(5);
    c.observe(1, 0); // the 20th sample: sorted[1] is now 1
    expect(c.lead).toBe(6);
  });
  it("lowers lead by one only after the median sits above slackTargetMax + 1 for leadLowerHoldMs", () => {
    const c = new LeadController(NET_CONFIG);
    c.initial(90, 20);
    for (let ms = 0; ms < NET_CONFIG.leadLowerHoldMs; ms += 100) c.observe(6, ms);
    expect(c.lead).toBe(5);
    c.observe(6, NET_CONFIG.leadLowerHoldMs);
    expect(c.lead).toBe(4);
  });
  it("restarts the hold when the median dips back into the band", () => {
    const c = new LeadController(NET_CONFIG);
    c.initial(90, 20);
    for (let ms = 0; ms < 4000; ms += 100) c.observe(6, ms);
    for (let ms = 4000; ms < 4600; ms += 100) c.observe(3, ms); // median falls to 3: hold resets
    for (let ms = 4600; ms < 9000; ms += 100) c.observe(6, ms);
    expect(c.lead).toBe(5);
  });
  it("never leaves the clamp", () => {
    const c = new LeadController(NET_CONFIG);
    c.initial(1000, 0);
    for (let i = 0; i < RAISE_MIN_SAMPLES; i++) c.observe(0, 0);
    expect(c.lead).toBe(NET_CONFIG.leadMax);
  });
});
```

```ts
// packages/client/src/match/tick-loop.test.ts
import { describe, expect, it } from "vitest";
import { MS_PER_TICK, NET_CONFIG } from "@motor-combat-moba/shared";
import { TickLoop } from "./tick-loop.js";

describe("TickLoop", () => {
  it("free-runs at MS_PER_TICK with no target, carrying the remainder", () => {
    const loop = new TickLoop(NET_CONFIG);
    expect(loop.advance(MS_PER_TICK, Number.NaN)).toBe(1);
    expect(loop.advance(MS_PER_TICK * 0.5, Number.NaN)).toBe(0);
    expect(loop.fraction).toBeCloseTo(0.5, 9);
    expect(loop.localTick).toBe(1);
  });
  it("squeezes the period by dilationMax when behind the target and stretches it when ahead (N3)", () => {
    const behind = new TickLoop(NET_CONFIG);
    behind.reanchor(100);
    expect(behind.advance(MS_PER_TICK, 102)).toBe(1);
    expect(behind.fraction).toBeCloseTo(NET_CONFIG.dilationMax, 6); // 16.67 ms at a 15.15 ms period
    const ahead = new TickLoop(NET_CONFIG);
    ahead.reanchor(100);
    expect(ahead.advance(MS_PER_TICK, 98)).toBe(0);
    expect(ahead.fraction).toBeCloseTo(1 - NET_CONFIG.dilationMax, 6); // 16.67 ms at an 18.52 ms period
  });
  it("lands on a target one tick ahead within a few seconds and stays there", () => {
    const loop = new TickLoop(NET_CONFIG);
    loop.reanchor(100);
    let now = 0;
    for (let f = 0; f < 600; f++) {
      now += MS_PER_TICK;
      loop.advance(MS_PER_TICK, 101 + now / MS_PER_TICK);
    }
    expect(Math.abs(101 + now / MS_PER_TICK - (loop.localTick + loop.fraction))).toBeLessThan(0.5);
  });
  it("jumps instead of dilating when the target moves by more than reanchorTicks", () => {
    const loop = new TickLoop(NET_CONFIG);
    loop.reanchor(100);
    expect(loop.advance(0, 100 + NET_CONFIG.reanchorTicks + 1)).toBe(0);
    expect(loop.localTick).toBe(105);
    expect(loop.fraction).toBe(0);
  });
  it("caps a catch-up burst at maxCatchUpTicks and re-anchors a longer stall (N5)", () => {
    const free = new TickLoop(NET_CONFIG);
    expect(free.advance(MS_PER_TICK * 10, Number.NaN)).toBe(NET_CONFIG.maxCatchUpTicks);
    expect(free.fraction).toBe(0);
    const targeted = new TickLoop(NET_CONFIG);
    targeted.reanchor(100);
    expect(targeted.advance(MS_PER_TICK * 30, 130)).toBe(0);
    expect(targeted.localTick).toBe(130);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/client && npx vitest run src/match/lead.test.ts src/match/tick-loop.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the two modules**

```ts
// packages/client/src/match/lead.ts
import { MS_PER_TICK, type NET_CONFIG } from "@motor-combat-moba/shared";

type LeadConfig = Pick<typeof NET_CONFIG, "leadMin" | "leadMax" | "slackTargetMin" | "slackTargetMax" | "slackWindowTicks" | "leadLowerHoldMs">;

/** Fewest slack samples before the 5th-percentile test may raise lead — one sample cannot be a percentile. */
export const RAISE_MIN_SAMPLES = 20;

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

/**
 * How many ticks the client runs ahead of the server (netcode spec N4). Raise fast: the moment the
 * 5th percentile of slack over the window falls below `slackTargetMin`, lead goes up by one and the
 * window restarts. Lower slowly: only after the median has sat above `slackTargetMax + 1` for
 * `leadLowerHoldMs` does it come down by one. Slack arrives from the server in every snapshot —
 * `PlayerState.slackTicks` — and a negative value means a repeat was used, so it counts against
 * the floor exactly as a late arrival should.
 */
export class LeadController {
  private current: number;
  private window: number[] = [];
  private aboveSinceMs: number | undefined;

  constructor(private readonly cfg: LeadConfig) {
    this.current = cfg.leadMin;
  }

  get lead(): number {
    return this.current;
  }

  /** `ceil((RTT/2 + jitter + one tick) / one tick)`, clamped. Sets the lead and clears the window. */
  initial(rttMs: number, jitterMs: number): number {
    const raw = Math.ceil((rttMs / 2 + jitterMs + MS_PER_TICK) / MS_PER_TICK);
    this.current = Math.min(this.cfg.leadMax, Math.max(this.cfg.leadMin, raw));
    this.reset();
    return this.current;
  }

  reset(): void {
    this.window = [];
    this.aboveSinceMs = undefined;
  }

  observe(slackTicks: number, nowMs: number): void {
    this.window.push(slackTicks);
    if (this.window.length > this.cfg.slackWindowTicks) this.window.shift();
    const sorted = [...this.window].sort((a, b) => a - b);
    if (this.window.length >= RAISE_MIN_SAMPLES && percentile(sorted, 0.05) < this.cfg.slackTargetMin) {
      this.current = Math.min(this.cfg.leadMax, this.current + 1);
      this.reset();
      return;
    }
    if (percentile(sorted, 0.5) > this.cfg.slackTargetMax + 1) {
      this.aboveSinceMs ??= nowMs;
      if (nowMs - this.aboveSinceMs >= this.cfg.leadLowerHoldMs) {
        this.current = Math.max(this.cfg.leadMin, this.current - 1);
        this.reset();
      }
      return;
    }
    this.aboveSinceMs = undefined;
  }
}
```

```ts
// packages/client/src/match/tick-loop.ts
import { MS_PER_TICK, type NET_CONFIG } from "@motor-combat-moba/shared";

type LoopConfig = Pick<typeof NET_CONFIG, "maxCatchUpTicks" | "dilationMax" | "reanchorTicks">;

/**
 * The client's fixed-step accumulator (netcode spec N5) with the clock applied by dilation (N3).
 * `advance` turns a frame's delta into whole local ticks at a period stretched or squeezed by up to
 * `dilationMax`, in proportion to how far `localTick + fraction` is from `targetTick` (one tick of
 * error is the full ±10 %). The target is `ClockSync.serverTickAt(now) + lead`; `NaN` means "no
 * target yet" and the loop free-runs. A target further away than `reanchorTicks` — a resumed tab, a
 * route change — jumps; a stall that would owe more than `maxCatchUpTicks` re-anchors to the target
 * (or drops the excess when there is none) rather than replaying it as a burst.
 */
export class TickLoop {
  private tick = 0;
  private accMs = 0;
  private periodMs = MS_PER_TICK;

  constructor(private readonly cfg: LoopConfig) {}

  get localTick(): number {
    return this.tick;
  }

  /** `[0, 1)` through the current tick at the dilated period, for the render blend. */
  get fraction(): number {
    return this.accMs / this.periodMs;
  }

  /** Time banked toward the next tick; exposed for tests. */
  get acc(): number {
    return this.accMs;
  }

  reanchor(tick: number): void {
    this.tick = Math.floor(tick);
    this.accMs = 0;
    this.periodMs = MS_PER_TICK;
  }

  /** Runs the ticks this frame owes and returns how many. */
  advance(deltaMs: number, targetTick: number): number {
    const hasTarget = Number.isFinite(targetTick);
    if (hasTarget) {
      const error = targetTick - (this.tick + this.fraction);
      if (Math.abs(error) > this.cfg.reanchorTicks) {
        this.reanchor(targetTick);
        return 0;
      }
      const rate = Math.max(-1, Math.min(1, error)) * this.cfg.dilationMax;
      this.periodMs = MS_PER_TICK / (1 + rate);
    } else {
      this.periodMs = MS_PER_TICK;
    }
    this.accMs += deltaMs;
    const due = Math.floor(this.accMs / this.periodMs);
    if (due > this.cfg.maxCatchUpTicks) {
      if (hasTarget) {
        this.reanchor(targetTick);
        return 0;
      }
      this.tick += this.cfg.maxCatchUpTicks;
      this.accMs = 0;
      return this.cfg.maxCatchUpTicks;
    }
    this.tick += due;
    this.accMs -= due * this.periodMs;
    return due;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/client && npx vitest run src/match/lead.test.ts src/match/tick-loop.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/match/lead.ts packages/client/src/match/lead.test.ts packages/client/src/match/tick-loop.ts packages/client/src/match/tick-loop.test.ts
git commit -m "feat(client): LeadController and TickLoop — the input lead and the dilated fixed-step clock (N3, N4, N5)"
```

---

### Task 4: Tick-stamped inputs end to end — the ring on the server, the lead on the client

This is one task because the wire shape is one decision: nothing that names `seq` compiles once `InputMessage` carries `tick`, so shared, server, harnesses and client change under one commit. It is grouped by package, each group with its own test run.

**Files:**
- Modify (shared): `net/input.ts`, `sim/step.ts:337,406`, `sim/drive.ts:4,30,166,207,237`, `schema/PlayerState.ts:156`, `schema/schema.test.ts:18`, `config/net-config.ts` (delete two keys), `index.ts:16`, `sim/golden.test.ts:43-45`, `sim/step.test.ts`, `sim/drive.test.ts`, `sim/status/channels.test.ts` (every `seq: 0` literal), `scripts/differ-replay.mjs`
- Create (server): `src/net/input-ring.ts`, `src/net/input-ring.test.ts`
- Modify (server): `src/net/input-message.ts`, `src/net/input-message.test.ts`, `src/sim/tick.ts`, `src/sim/tick.test.ts`, `src/rooms/tick-pipeline.ts:343-417`, `src/rooms/ArenaRoom.ts`, `src/rooms/PracticeRoom.ts`, `src/rooms/PlaygroundRoom.ts`, `balance/match.ts:142-143,163,186-188,258-282`, `playtest/world.ts`, `playtest/prediction.ts`, `playtest/netcode.ts`, `playtest/README.md` (the `netcode.ts` paragraph)
- Modify (client): `src/net/prediction.ts`, `src/net/prediction.test.ts`, `src/scenes/arena-input.ts`, `src/scenes/arena-input.test.ts`, `src/match/arena-net.ts`, `src/match/arena-net.test.ts`, `src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `InputFrame` (N0), `NEUTRAL_INPUT` (here), `ClockSync`, `NetStats` (N0), `LeadController`, `TickLoop` (Task 3), `InputLog` (N0), `NET_CONFIG` (Task 2).
- Produces: `InputMessage { tick; steer; throttle; fireSlots }`, `NEUTRAL_INPUT`, `stepSim(body, input: InputFrame, dt, ctx)`, `PlayerState.ackTick: uint32`, `PlayerState.slackTicks: int8`; `InputRing`, `AcceptResult`, `RingRead` (ledger, plus `RingRead.previous: InputFrame`); `serverTick(state, rings, dt, phase, statusMods): TickResult` with `TickResult.reads: Map<string, RingRead>`; `PipelineCtx.rings`; `runPipeline(...)` returning `{ masks, combatPlayers, reads }`; `PendingInput { tick; input: InputFrame }`, `PredictionBuffer.reconcile(authoritative, ackTick, current, ctx)`; on `ArenaNet`: `attachClock(clock: ClockSync)`, `get localTick(): number`, `get lead(): number`, `pumpInput(state, deltaMs, sample, send, nowMs?)`.

- [ ] **Step 1 (shared): the wire shape, the widening, the schema fields**

`net/input.ts`:

```ts
export const INPUT_MESSAGE = "input";

/** One tick's worth of intent, with no sequencing on it — what the ring, the log and the sim read. */
export interface InputFrame {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  /** Slot bitmask: bit 0 = slot 1. The server masks it to the car's real slots before simulating. */
  fireSlots: number;
}

/**
 * The wire message (netcode spec N2): the input for server tick `tick`, sent by a client running
 * `lead` ticks ahead of its estimate of the server clock. The tick IS the sequence: two messages
 * for one tick are a duplicate, a message for a tick already simulated is late, and neither is
 * ever applied twice.
 */
export interface InputMessage extends InputFrame {
  tick: number;
}

/** No steer, no throttle, no fire — what a silent client's car is driven on after `repeatMaxTicks`. */
export const NEUTRAL_INPUT: Readonly<InputFrame> = Object.freeze({ steer: 0, throttle: 0, fireSlots: 0 });
```

`index.ts:16` → `export { INPUT_MESSAGE, NEUTRAL_INPUT } from "./net/input.js";`. In `sim/step.ts` and `sim/drive.ts` replace every `InputMessage` (the import at `step.ts:337` / `drive.ts:4`, the parameter at `step.ts:406`, `drive.ts:30` and `:166`, and the `InputMessage["steer"]` / `["throttle"]` index types at `drive.ts:207` and `:237`) with `InputFrame`. `PlayerState.ts:156` becomes:

```ts
  /**
   * The server tick whose input this car was last driven on (netcode spec N4, N9). Every snapshot
   * carries it; the client drops pending inputs by `tick <= ackTick` and replays the rest. Equal to
   * `ArenaState.tick` for every player in every phase — the ring is read for everyone so the ack
   * never stalls — and kept per player because N2 moves it into a per-client snapshot header.
   */
  @type("uint32") ackTick = 0;
  /**
   * How many ticks early the input for `ackTick` arrived; negative when it was missing and a
   * repeat (or, past `repeatMaxTicks`, neutral) was used instead. The lead controller's only input.
   */
  @type("int8") slackTicks = 0;
```

`schema.test.ts:18` → `expect(p.ackTick).toBe(0); expect(p.slackTicks).toBe(0);`. Delete `maxInputsPerTick` and `pendingInputCap` from `net-config.ts` (their last readers go in this task). In `golden.test.ts:43-45`, `step.test.ts`, `drive.test.ts` and `status/channels.test.ts`, change every input literal from `{ seq: 0, steer, throttle, fireSlots }` typed `InputMessage` to the same object without `seq`, typed `InputFrame` (grep `seq:` in `packages/shared/src`; every hit is one of these). In `scripts/differ-replay.mjs` drop the `seq: 0,` from the `stepSim` call.

Run: `npm run build -w @motor-combat-moba/shared && cd packages/shared && npx vitest run && cd ../.. && node --test scripts/differ.test.mjs` — Expected: PASS.

- [ ] **Step 2 (server): the failing ring test**

```ts
// packages/server/src/net/input-ring.test.ts
import { describe, expect, it } from "vitest";
import { NET_CONFIG, NEUTRAL_INPUT } from "@motor-combat-moba/shared";
import { InputRing } from "./input-ring.js";

const up = (tick: number, fireSlots = 0) => ({ tick, steer: 0 as const, throttle: 1 as const, fireSlots });

describe("InputRing.accept", () => {
  it("accepts an input for a coming tick and refuses a duplicate, a late one and a malformed one", () => {
    const ring = new InputRing();
    expect(ring.accept(up(5), 2)).toBe("accepted");
    expect(ring.accept(up(5), 2)).toBe("duplicate");
    ring.inputFor(10);
    expect(ring.accept(up(10), 10)).toBe("late");
    expect(ring.accept({ ...up(11), tick: 11.5 }, 10)).toBe("malformed");
    expect(ring.stats).toEqual({ late: 1, duplicate: 1, future: 0, repeated: 0, neutral: 0 });
  });
  it("refuses a tick past the ring's horizon rather than evicting an unread slot", () => {
    const ring = new InputRing();
    expect(ring.accept(up(2 + NET_CONFIG.ringSize), 2)).toBe("accepted");
    expect(ring.accept(up(3 + NET_CONFIG.ringSize), 2)).toBe("future");
  });
});

describe("InputRing.inputFor", () => {
  it("serves a fresh input with slack = tick - arrival, and repeats the last fresh one when a tick is missing", () => {
    const ring = new InputRing();
    ring.accept(up(3), 0);
    const fresh = ring.inputFor(3);
    expect(fresh).toMatchObject({ source: "fresh", slackTicks: 3, input: { throttle: 1 } });
    expect(ring.inputFor(4)).toMatchObject({ source: "repeat", slackTicks: -1, input: { throttle: 1 } });
    expect(ring.inputFor(5)).toMatchObject({ source: "repeat", slackTicks: -2 });
  });
  it("falls back to neutral after repeatMaxTicks consecutive repeats, and a fresh read resets the count", () => {
    const ring = new InputRing();
    ring.accept(up(1), 0);
    ring.inputFor(1);
    for (let t = 2; t <= 1 + NET_CONFIG.repeatMaxTicks; t++) expect(ring.inputFor(t).source).toBe("repeat");
    const neutral = ring.inputFor(2 + NET_CONFIG.repeatMaxTicks);
    expect(neutral).toMatchObject({ source: "neutral", slackTicks: -(NET_CONFIG.repeatMaxTicks + 1), input: NEUTRAL_INPUT });
    ring.accept(up(20), 19);
    expect(ring.inputFor(20).source).toBe("fresh");
    expect(ring.inputFor(21)).toMatchObject({ source: "repeat", slackTicks: -1 });
    expect(ring.stats.repeated).toBe(NET_CONFIG.repeatMaxTicks + 1);
    expect(ring.stats.neutral).toBe(1);
  });
  it("is neutral, not a repeat, before any input has ever been served", () => {
    const ring = new InputRing();
    expect(ring.inputFor(1)).toMatchObject({ source: "neutral", input: NEUTRAL_INPUT });
  });
  it("remembers what it served last, so a press edge is fresh-vs-previous and a repeat can never be one (N7)", () => {
    const ring = new InputRing();
    ring.accept(up(1, 0b001), 0);
    const first = ring.inputFor(1);
    expect(first.previous).toEqual(NEUTRAL_INPUT);
    expect(first.input.fireSlots & ~first.previous.fireSlots).toBe(0b001);
    const held = ring.inputFor(2); // missing: repeated
    expect(held.input.fireSlots & ~held.previous.fireSlots).toBe(0);
    ring.accept(up(3, 0b001), 2);
    const stillHeld = ring.inputFor(3);
    expect(stillHeld.input.fireSlots & ~stillHeld.previous.fireSlots).toBe(0);
  });
  it("honours custom size and repeat limits", () => {
    const ring = new InputRing({ size: 4, repeatMaxTicks: 1 });
    expect(ring.accept(up(9), 4)).toBe("future");
    ring.accept(up(1), 0);
    ring.inputFor(1);
    expect(ring.inputFor(2).source).toBe("repeat");
    expect(ring.inputFor(3).source).toBe("neutral");
  });
});
```

Run: `cd packages/server && npx vitest run src/net/input-ring.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3 (server): the ring**

```ts
// packages/server/src/net/input-ring.ts
import { NET_CONFIG, NEUTRAL_INPUT, type InputFrame, type InputMessage } from "@motor-combat-moba/shared";

export type AcceptResult = "accepted" | "late" | "duplicate" | "future" | "malformed";

export interface RingRead {
  input: InputFrame;
  source: "fresh" | "repeat" | "neutral";
  /** Ticks between arrival and use; negative = the n-th consecutive tick served without a fresh input. */
  slackTicks: number;
  /** What the previous `inputFor` returned — the press-edge memory (N7). Neutral before the first read. */
  previous: InputFrame;
}

interface Slot {
  tick: number;
  arrivalTick: number;
  input: InputFrame;
}

/**
 * One client's inputs indexed by tick (netcode spec N6). `accept` files a message under its tick;
 * `inputFor(tick)` hands back the input stamped for that tick, else the most recent earlier one
 * (repeat), else — after `repeatMaxTicks` consecutive repeats — neutral, so a silent car brakes to
 * a stop under drag instead of driving into a wall. Nothing is ever applied twice: a tick already
 * served is `late`, a slot already filled is `duplicate`, a tick beyond the horizon is `future`.
 * The ring is the whole input memory — there is no queue and no separate press-edge map.
 */
export class InputRing {
  private readonly size: number;
  private readonly repeatMax: number;
  private readonly slots: (Slot | undefined)[];
  private servedThrough = -1;
  private last: InputFrame = NEUTRAL_INPUT;
  private lastFresh: InputFrame | undefined;
  private repeats = 0;
  readonly stats = { late: 0, duplicate: 0, future: 0, repeated: 0, neutral: 0 };

  constructor(opts: { size?: number; repeatMaxTicks?: number } = {}) {
    this.size = opts.size ?? NET_CONFIG.ringSize;
    this.repeatMax = opts.repeatMaxTicks ?? NET_CONFIG.repeatMaxTicks;
    this.slots = new Array<Slot | undefined>(this.size).fill(undefined);
  }

  accept(msg: InputMessage, arrivalTick: number): AcceptResult {
    if (!Number.isInteger(msg.tick) || msg.tick < 0) return "malformed";
    if (msg.tick <= this.servedThrough) {
      this.stats.late += 1;
      return "late";
    }
    if (msg.tick > arrivalTick + this.size) {
      this.stats.future += 1;
      return "future";
    }
    const index = msg.tick % this.size;
    if (this.slots[index]?.tick === msg.tick) {
      this.stats.duplicate += 1;
      return "duplicate";
    }
    this.slots[index] = {
      tick: msg.tick,
      arrivalTick,
      input: { steer: msg.steer, throttle: msg.throttle, fireSlots: msg.fireSlots },
    };
    return "accepted";
  }

  inputFor(tick: number): RingRead {
    const previous = this.last;
    this.servedThrough = Math.max(this.servedThrough, tick);
    const slot = this.slots[tick % this.size];
    let read: RingRead;
    if (slot && slot.tick === tick) {
      this.repeats = 0;
      this.lastFresh = slot.input;
      read = { input: slot.input, source: "fresh", slackTicks: tick - slot.arrivalTick, previous };
    } else {
      this.repeats += 1;
      if (this.lastFresh && this.repeats <= this.repeatMax) {
        this.stats.repeated += 1;
        read = { input: this.lastFresh, source: "repeat", slackTicks: -this.repeats, previous };
      } else {
        this.stats.neutral += 1;
        read = { input: NEUTRAL_INPUT, source: "neutral", slackTicks: -this.repeats, previous };
      }
    }
    this.last = read.input;
    return read;
  }
}
```

`input-message.ts` becomes:

```ts
import type { InputMessage } from "@motor-combat-moba/shared";

function isAxis(n: unknown): n is -1 | 0 | 1 {
  return n === -1 || n === 0 || n === 1;
}

/** Wire validation only; whether `tick` is late, duplicate or beyond the horizon is the ring's call. */
export function isInputMessage(msg: unknown): msg is InputMessage {
  if (msg === null || typeof msg !== "object") return false;
  const rec = msg as Record<string, unknown>;
  return (
    Number.isInteger(rec.tick) && (rec.tick as number) >= 0 &&
    isAxis(rec.steer) && isAxis(rec.throttle) && Number.isInteger(rec.fireSlots)
  );
}
```

In `input-message.test.ts` replace every `seq` with `tick`, and add `expect(isInputMessage({ tick: -1, steer: 0, throttle: 0, fireSlots: 0 })).toBe(false);`.

Run: `cd packages/server && npx vitest run src/net/input-ring.test.ts src/net/input-message.test.ts` — Expected: PASS.

- [ ] **Step 4 (server): `serverTick` reads the ring**

Rewrite `sim/tick.ts` from line 56 to 216. Keep `SLOT_MASK`, `TickResult.approachSpeeds` and its comment, `sortedEntries`, `TickWorld`, `tickWorldOf`, `bodyOf`, `writeBody` verbatim; delete `bySeq`, `COAST_INPUT`, `hasKnock` and the `ManeuverKind` / `NET_CONFIG` / `InputMessage` imports; add `import type { InputRing, RingRead } from "../net/input-ring.js";`. The new head of the file:

```ts
export interface TickResult {
  /** Per session id, the validated slot bitmask of the slots newly PRESSED on this tick's input. */
  masks: Map<string, number>;
  approachSpeeds: Map<string, number>;
  /** Per session id, what the ring served this tick — the input log and the netgraph read these. */
  reads: Map<string, RingRead>;
}

/** `PlayerState.slackTicks` is an int8; a stall longer than 127 ticks reads as 127 either way. */
const INT8_MIN = -128;
const INT8_MAX = 127;
const clampInt8 = (n: number): number => Math.max(INT8_MIN, Math.min(INT8_MAX, n));

/**
 * Advance every player by this tick's input (netcode spec N6, N7). `dt` is seconds and must be
 * `1 / TICK_RATE_HZ`.
 *
 * Every player's ring is read every tick, in every phase, so `ackTick` never stalls and a lobby
 * player's inputs are consumed rather than banked. Every on-field player in MATCH is then stepped —
 * on a fresh input, a repeated one, or neutral — so drag, knock decay and maneuver countdowns
 * always run; there is no coast branch and no silent player any more, which is the general form of
 * the `hasKnock` rule this replaced.
 *
 * The fire mask carries PRESSES: `clean(now) & ~clean(previous)`, where `previous` is what the ring
 * served last tick. A repeat is identical to its predecessor by definition, so silence never fires
 * a weapon, and nothing outside the ring remembers key state.
 *
 * Players are stepped in sorted `sessionId` order against the current poses of the others; the
 * mover gate is `isOnField` and the wall gate inside `otherCarHulls` is `isSolid` — unchanged.
 */
export function serverTick(
  state: ArenaState,
  rings: ReadonlyMap<string, InputRing>,
  dt: number,
  phase: RoomPhase,
  statusMods: ReadonlyMap<string, Modifiers>,
): TickResult {
  const world = tickWorldOf(getArena(state.arenaId));
  const moving = phase === RoomPhase.MATCH;
  const entries = sortedEntries(state);
  const masks = new Map<string, number>();
  const approachSpeeds = new Map<string, number>();
  const reads = new Map<string, RingRead>();

  for (const { sessionId, player } of entries) {
    approachSpeeds.set(sessionId, player.speed);
    const ring = rings.get(sessionId);
    if (!ring) continue;

    const read = ring.inputFor(state.tick);
    reads.set(sessionId, read);
    player.ackTick = state.tick;
    player.slackTicks = clampInt8(read.slackTicks);
    if (!moving || !isOnField(player)) continue;

    const ctx: StepContext = {
      ...world,
      carId: carIdOf(player),
      others: otherCarHulls(entries, sessionId, state.tick),
      modifiers: modifiersFor(statusMods, sessionId),
    };
    writeBody(player, stepSim(bodyOf(player), read.input, dt, ctx));

    const pressed = cleanMask(read.input.fireSlots) & ~cleanMask(read.previous.fireSlots);
    if (pressed !== 0) masks.set(sessionId, pressed);
  }

  return { masks, approachSpeeds, reads };
}

/** Attacker-controlled wire data: non-integers and non-positives collapse to 0, then masked to the real slots. */
function cleanMask(raw: number): number {
  return Number.isInteger(raw) && raw > 0 ? raw & SLOT_MASK : 0;
}
```

Rewrite `tick.test.ts` against the new signature. Its fixtures change from queues to rings; keep every scenario that still applies, with these replacements: `ups(...seqs)` → a helper `ringWith(...frames: { tick: number; input: InputFrame }[])` that `accept`s each at `arrivalTick = tick - 1`; every `lastProcessedInputSeq` assertion → `ackTick` equals `state.tick` and `slackTicks` equals the read's slack; the `maxInputsPerTick` flooder block (205–231) → "a second message for the same tick is a duplicate and moves nothing"; the "applies inputs in seq order regardless of arrival" block (181–203) → "an input for a later tick does not move the car until that tick" (accept ticks 3 and 2 in that order at arrival 1; `inputFor(2)` drives on tick 2's frame); the whole `serverTick coasts a knocked player` describe (550–644) → one test "steps a silent on-field car on neutral every tick, so a knock decays and the ack still advances" (a knocked player with an empty ring: after one tick `angVel`, `shoveX` are smaller, `ackTick === state.tick`, `masks` empty); the press-edge tests (418–521) keep their intent with `previous` coming from the ring — "holding fire across two fresh ticks fires once", "a press, release, press across three ticks fires twice", "a mask past `maxWeaponSlots` is stripped", "a repeated press is not a press". The drain-in-every-phase test (235–261) becomes "reads the ring and advances `ackTick` in every phase without moving".

Run: `cd packages/server && npx vitest run src/sim/tick.test.ts` — Expected: PASS.

- [ ] **Step 5 (server): the pipeline and the three rooms**

`tick-pipeline.ts`: `PipelineCtx` loses `inputQueues`, `prevFireMasks` and `hz`, gains `rings: ReadonlyMap<string, InputRing>`; `runPipeline` computes `const dt = MS_PER_TICK / 1000;` (import `MS_PER_TICK`), calls `serverTick(state, ctx.rings, dt, state.phase, statusMods)`, and returns `{ masks, combatPlayers, reads }`. Import `InputRing`/`RingRead` types from `../net/input-ring.js`; drop the `InputMessage` import.

Room substitutions (Arena / Practice / Playground):

| Old | New |
|---|---|
| `private inputQueues = new Map<string, InputMessage[]>();` (+ `readonly` in Practice) and the `prevFireMasks` field with its comment | `private readonly rings = new Map<string, InputRing>();` with `import { InputRing } from "../net/input-ring.js";` |
| `this.inputQueues.set(id, []); this.prevFireMasks.set(id, 0);` in `onJoin` / `addCar` | `this.rings.set(id, new InputRing());` |
| `this.inputQueues.delete(id); this.prevFireMasks.delete(id);` in `onLeave` | `this.rings.delete(id);` |
| Arena 122–133 / Practice 190–220: the `enqueue` closure body `const q = …; if (q) q.push(msg);` (Practice: `if (q && q.length < NET_CONFIG.pendingInputCap) q.push(msg);`, comment included) | `this.rings.get(sessionId)?.accept(msg, this.state.tick);` — the injector still wraps it; the ring is bounded by construction |
| Playground 197–200 | `this.rings.get(this.state.controlledSessionId)?.accept(msg, this.state.tick);` |
| `ctx()`: `inputQueues: this.inputQueues, prevFireMasks: this.prevFireMasks, … hz: …` | `rings: this.rings,` (no `hz`) |
| Practice `botSeq` field + comment (125–130); Playground `opponentSeq` (154–159) | deleted |
| Practice `tick()` 339–351: `respawnSweep; botRing.push(snapshotWorld); enqueueBotInput(); runPipeline; previousTickFires = …; drain` | `respawnSweep(this.ctx()); const { reads } = runPipeline(this.ctx()); this.logInputs(reads); this.previousTickFires = this.botEvents.fired.slice(); …drain…; this.botRing.push(snapshotWorld(this.state, this.combat)); this.writeBotInput();` |
| Playground `tick()` 342–379: the same shape (its debug broadcast block stays where it is, before `runPipeline`) | `respawnSweep; …debug…; runPipeline; previousTickFires; drain; botRing.push; this.writeOpponentInput();` |
| Practice `enqueueBotInput()` → `writeBotInput()`; Playground `enqueueOpponentInput()` → `writeOpponentInput()` | body unchanged except: no `seq`; `const ring = this.rings.get(id); if (!ring) return;`; the two `queue.push({ seq, ...})` calls become `ring.accept({ tick: this.state.tick + 1, ...frame }, this.state.tick);` where `frame` is `this.bot.decide(view)` or `NEUTRAL_INPUT`; the comment "A fresh `seq` every tick…" becomes "Written for the NEXT tick at the end of this one (N8): the ring is read at the top of tick T+1, and a decision made from the world after T is what a remote client would also be acting on." |
| Arena `tick()` 335: `const { combatPlayers } = runPipeline(this.ctx());` preceded by N0's `this.logInputsForTick();` | `const { combatPlayers, reads } = runPipeline(this.ctx()); this.logInputs(reads);` |

The bot's view-ring push moves from the top of the tick to the end: the entry labelled `T` now holds the world *after* `T` rather than before it, and the bot deciding for `T+1` reads `at(T - staleness)`, which is the same world the old top-of-`T+1` read reached through `at(T + 1 - staleness)`. No bot behaviour changes (N28); `BOT_BRAIN_VERSION` stays. The Playground's alone-mode neutral input now goes into the ring the same way — the reason it existed (a silent car frozen with its last speed) no longer exists either, since every on-field car steps every tick, but the write keeps the bot-off car on an explicit neutral rather than a 200 ms repeat of its last decision.

N0's `logInputsForTick()` in `ArenaRoom` and `PracticeRoom` becomes `logInputs(reads: ReadonlyMap<string, RingRead>)`: the header logic is unchanged; the body records `for (const id of [...reads.keys()].sort()) log.record(this.state.tick, id, reads.get(id)!.input);` — one line per player per tick, fresh, repeated or neutral, which is what the differ replays. Its comment now reads "what `serverTick` drove each car on this tick, recorded after the pipeline ran".

`balance/match.ts`: `inputQueues`/`prevFireMasks`/`seqs` (142–143, 163, 186–188) → `const rings = new Map<string, InputRing>()` filled with `new InputRing()` per seat; `ctx()` passes `rings` and no `hz`; the per-seat block (260–280) moves to *after* `runPipeline(ctx())` and the `previousTickFires` update, and pushes `ring.accept({ tick: state.tick + 1, ...bot.decide(view) }, state.tick)`; `ring.push(snapshotWorld(state, combat))` moves with it, so the harness keeps the rooms' order exactly.

`playtest/world.ts` (compile break): `queues` → `readonly rings = new Map<string, InputRing>()`; `prevFireMasks` and `seq` deleted; `IDLE: InputFrame = NEUTRAL_INPUT`; `add` sets `this.rings.set(spec.id, new InputRing())`; `input(id, msg: Partial<InputFrame> = {})` → `this.rings.get(id)?.accept({ tick: this.state.tick + 1, ...IDLE, ...msg }, this.state.tick);` with the doc "Queue one input for this player on the NEXT tick — the same contract as before, now through the ring"; `tick()` calls `serverTick(this.state, this.rings, DT, this.state.phase, statusMods)`. Every probe drives cars through `input()`, and none touched `queues` or `prevFireMasks` directly except the two below.

`playtest/prediction.ts` (compile break): the client stamps `tick: t + latencyTicks` (its lead equals the link latency, exactly); `world.queues.get("me")!.push(pending.msg)` → `world.rings.get("me")!.accept(pending.msg, world.state.tick)`; `buffer.predict(predicted, { tick, input }, ctx)`; the snapshot carries `ackTick: me.ackTick` in place of `lastProcessedInputSeq`; `reconcile(snap.self, snap.ackTick, …)`.

`playtest/netcode.ts` (compile break; the N0 harness, spec §7's named file). Exactly these changes: (1) the `up` link carries `InputMessage | { ping }` unchanged in type, but the harness now attaches its `ClockSync` to the net — `net.attachClock(clock)` after `net.attachStats(stats)` — and calls `net.pumpInput(view, MS_PER_TICK, () => FORWARD, send, nowMs)` so the sends are tick-stamped from the lead; nothing is sent until the first pong returns, so the first `NET_CONFIG.pingIntervalMs` of each trial has no local inputs (report it as `warmupTicks`, excluded from the correction rows); (2) server intake `world.queues.get("me")!.push(msg)` → `world.rings.get("me")!.accept(msg, world.state.tick)`, and `sawInput`/`starvedTicks` are replaced by the ring's own numbers read after each trial: `repeatedTicks = ring.stats.repeated + ring.stats.neutral`, `lateInputs = ring.stats.late`; (3) `predictedAfterSeq` is keyed by `msg.tick` and the patch carries `ackTick`/`slackTicks` in place of `lastProcessedInputSeq` (`PlayerSnap`, `writeBody` back-fill, the divergence lookup by `me.ackTick`); (4) `PATCH_EVERY` is `NET_CONFIG.snapshotEvery` (Task 2); (5) the N1 report gains the two numbers the spec's phase 1 acceptance names — `repeated-input rate = repeatedTicks / matchTicks` and `lead` (from `net.lead` at the end of the trial) — printed per latency row, and its verdict line becomes `worstP95 > 1 || worstRepeatRate >= 0.01 ? FINDING : OK` with the sentence "phase 1 acceptance: repeated-input rate < 1 %, free-driving correction stays 0" in the note. No other row, threshold or verdict changes. Update the `netcode.ts` paragraph in `playtest/README.md` to name "repeated-input rate and lead" where it names "starved ticks".

Run: `cd packages/server && npx vitest run && npm run typecheck && npx tsx playtest/netcode.ts` — Expected: server suite green (the practice-room source scan still finds no `setTuning`); typecheck clean; the harness N1 row reports `repeated 0.00 %` at every latency and `lead` 3–6.

- [ ] **Step 6 (client): prediction keyed by tick, and the failing `ArenaNet` tests**

`net/prediction.ts`: `PendingInput { tick: number; input: InputFrame }`; the cap in `predict` reads `NET_CONFIG.ringSize` (its comment: "the same bound as the server ring, so the client never holds an input the server could not"); `reconcile(authoritative, ackTick, currentPredicted, ctx)` filters `entry.tick > ackTick` and its comment says "by the predicate `tick <= ackTick`, never by position: `ackTick` is the tick the snapshot describes, so every pending input at or below it — fresh, repeated or replaced by neutral — has been consumed on the server and must not be replayed on top of it". `prediction.test.ts`: `up(tick)` builds an `InputFrame`, every `{ seq, input }` → `{ tick, input }`, every `pendingInputCap` → `ringSize`, `reconcile(…, ack, …)` reads as a tick.

`scenes/arena-input.ts`: delete `DrainResult` and `drainTicks` (the `TickLoop` replaced them); keep `axisOf`. Delete the `drainTicks` describe from `arena-input.test.ts`.

In `arena-net.test.ts`: delete "numbers inputs with a page-monotonic seq…"; add to `beforeEach` a ready clock — `clock = new ClockSync(); clock.onPong({ clientMs: 0, serverTick: 100, msIntoTick: 0 }, 0); net.attachClock(clock);` — and a pump helper `let now = 0; const pump = (delta: number, sample = FORWARD) => { now += delta; return net.pumpInput(state, delta, () => sample, (msg) => sent.push(msg), now); };`; rewrite every `net.pumpInput(state, X, () => S, …)` call as `pump(X, S)`; change `me.lastProcessedInputSeq = sent[1].seq` to `me.ackTick = sent[1].tick`. Add:

```ts
  it("sends nothing until the clock has a sample", () => {
    const cold = new ArenaNet(getArena("arena-01"), "me");
    cold.seed(state);
    expect(cold.pumpInput(state, MS_PER_TICK * 3, () => FORWARD, (msg) => sent.push(msg), 0).ticks).toBe(0);
  });

  it("stamps the first input lead ticks ahead of the server clock (N2, N4)", () => {
    // RTT 0 -> initial lead is leadMin (2); the server is at tick 100 -> local tick 102, first send 103.
    pump(MS_PER_TICK);
    expect(sent[0].tick).toBe(103);
    expect(net.lead).toBe(NET_CONFIG.leadMin);
    expect(net.localTick).toBe(103);
  });

  it("feeds each patch's slack to the lead controller and the netgraph", () => {
    const stats = new NetStats();
    net.attachStats(stats);
    pump(MS_PER_TICK);
    const me = state.players.get("me")!;
    me.ackTick = sent[0].tick;
    me.slackTicks = -1;
    net.onPatch(state, now);
    expect(stats.slack).toEqual([-1]);
    expect(stats.repeatedInputs).toBe(1);
    expect(stats.lead).toBe(NET_CONFIG.leadMin);
  });
```

Run: `cd packages/client && npx vitest run src/net/prediction.test.ts src/match/arena-net.test.ts src/scenes/arena-input.test.ts` — Expected: `prediction` and `arena-input` PASS; `arena-net` FAILS (`attachClock` is not a function).

- [ ] **Step 7 (client): `ArenaNet` runs on the tick loop**

In `match/arena-net.ts` (the preparation plan's class as extended by N0's Task 6):

| Where | Change |
|---|---|
| imports | add `NET_CONFIG`, `type InputFrame` from shared; `import type { ClockSync } from "./clock.js";`, `import { LeadController } from "./lead.js";`, `import { TickLoop } from "./tick-loop.js";`; drop `drainTicks` |
| module level | delete `nextInputSeq`, `seedInputSeq`, `currentInputSeq` and their comment |
| fields | replace `private inputAccumulatorMs = 0;` with `private readonly loop = new TickLoop(NET_CONFIG); private readonly leadCtl = new LeadController(NET_CONFIG); private clock: ClockSync \| undefined; private leadSeeded = false;` |
| after `attachStats` | `attachClock(clock: ClockSync): void { this.clock = clock; }` · `get localTick(): number { return this.loop.localTick; }` · `get lead(): number { return this.leadCtl.lead; }` |
| `seed` | drop the `seedInputSeq(...)` line; keep `this.lastDrivenSid = …` |
| `pumpInput` signature | `pumpInput(state, deltaMs, sample, send, nowMs: number = performance.now()): PumpResult` |
| `pumpInput` body | replace the `drainTicks` block with the code below |
| `sendInputTick(state, sample, send)` | becomes `sendInputFor(tick: number, state, sample, send): boolean`; the message is `{ tick, steer: raw.steer, throttle: raw.throttle, fireSlots: raw.fireSlots }` and `this.prediction.predict(…, { tick, input: msg }, …)` |
| `reconcileLocal` | `this.prediction.reconcile(authoritative, local.ackTick, before, ctx)`; before it: `this.leadCtl.observe(local.slackTicks, nowMs); if (this.stats) { this.stats.slack.push(local.slackTicks); if (this.stats.slack.length > NET_CONFIG.slackWindowTicks) this.stats.slack.shift(); if (local.slackTicks < 0) this.stats.repeatedInputs += 1; this.stats.lead = this.leadCtl.lead; }` — `onPatch` already receives `nowMs`; pass it through |
| `frame` | `tickFraction: this.loop.fraction` |

```ts
    // pumpInput, after the canDrive / isSimPaused guard (which now also calls this.loop.reanchor(this.loop.localTick)
    // so a pause does not bank time):
    const clock = this.clock;
    if (!clock?.ready) return { ticks: 0, activeInput: false };
    const serverTick = clock.serverTickAt(nowMs);
    if (!this.leadSeeded) {
      // First sample: derive the lead from the measured link and land the local clock on it (N4, N5).
      this.leadSeeded = true;
      this.leadCtl.initial(clock.rttMs, clock.jitterMs);
      this.loop.reanchor(serverTick + this.leadCtl.lead);
    }
    const ticks = this.loop.advance(deltaMs, serverTick + this.leadCtl.lead);
    let activeInput = false;
    for (let tick = this.loop.localTick - ticks + 1; tick <= this.loop.localTick; tick++) {
      if (this.sendInputFor(tick, state, sample, send)) activeInput = true;
    }
    return { ticks, activeInput };
```

In `ArenaScene.ts`, in `create` after N0's `this.clock = new ClockSync();` add `this.net.attachClock(this.clock);`; in `update` pass `performance.now()` as `pumpInput`'s fifth argument; in the netgraph render replace the `suggestedDelay` expression with `net.lead + Math.ceil(this.clock.rttMs / MS_PER_TICK)` and its comment with "N29: D = lead + RTT renders raw server state with prediction bypassed".

Run: `cd packages/client && npx vitest run && npm run typecheck` — Expected: PASS; no test imports Phaser.

- [ ] **Step 8: Full verification and the live check**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena`
Expected: every suite green; smoke passes. Then `npm run dev`, `http://localhost:5173/?debug=net`, Practice → Start: the car answers the keys as before; `lead` reads 2 on localhost; `slack p5` and `median` sit at 2–3 within a few seconds; `repeated` stays 0 while driving; alt-tab for three seconds and back — the car has braked to a stop for the bot (repeat then neutral) and resumes with one correction. Then `SIM_LATENCY_MS=45 SIM_JITTER_MS=10 npm run dev:server` in a second terminal with the Vite client: `lead` settles at 4–5 and `repeated` stays under 1 % of ticks after the first second.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src packages/server/src packages/server/balance/match.ts packages/server/playtest/world.ts packages/server/playtest/prediction.ts packages/server/playtest/netcode.ts packages/server/playtest/README.md packages/client/src scripts/differ-replay.mjs
git commit -m "feat(net)!: tick-stamped inputs — InputRing with repeat/neutral, press edges from the ring, every on-field car steps every tick, client lead + dilated tick loop, ackTick/slackTicks replace lastProcessedInputSeq (N2-N8)"
```

**Say it loudly:** three probes were edited, all to fix compile breaks — `world.ts` (rings), `prediction.ts` (tick stamps, `ackTick`), `netcode.ts` (tick stamps, ring stats, the two acceptance numbers on its N1 row). Their numbers move for a real reason: inputs no longer bunch, a silent car no longer freezes, and a snapshot lands every tick. `lan.ts` still compiles but sends `{ seq }` at a literal 30 Hz (`playtest/lan.ts:12,30`); after this commit the server's `isInputMessage` refuses every one of its inputs, so that probe no longer reaches the code path it was written for — flagged, not fixed; ask before editing it.

---

### Task 5: Documentation, the rewritten invariant, and the acceptance run

**Files:**
- Modify: root `CLAUDE.md:100, 286-287`, `packages/shared/CLAUDE.md:7`, `packages/server/CLAUDE.md:3`, `packages/client/CLAUDE.md:7`, `docs/networking.md:3-30, 54, 60, 64`, `docs/architecture.md:5, 9, 17`, `docs/schema-reference.md:58`, `docs/glossary.md:7-8`, `docs/config-reference.md` (NET_CONFIG table), `docs/project-structure.md` (four new files)

- [ ] **Step 1: The invariant and the package rules**

Root `CLAUDE.md` invariant 5 becomes: `5. The snapshot rate is the tick rate or an integer divisor of it (`NET_CONFIG.snapshotEvery`), and a snapshot always describes the end of one whole tick.` Lines 286–287's list drops `DEFAULT_PATCH_RATE_HZ`. `packages/shared/CLAUDE.md:7` drops `DEFAULT_PATCH_RATE_HZ` and names `NEUTRAL_INPUT`. `packages/server/CLAUDE.md:3` becomes "Authority: Express + Colyseus, `ArenaRoom`, a 60 Hz `TickScheduler` whose `serverTick` reads each client's `InputRing` into shared `stepSim` and broadcasts the schema patch inside the same tick." `packages/client/CLAUDE.md:7` becomes "`ArenaScene` hands `ArenaNet` the frame delta; `TickLoop` turns it into local ticks `lead` ahead of the `ClockSync` estimate of the server tick, one tick-stamped `InputMessage` per tick, predicted through shared `stepSim` via `PredictionBuffer` and reconciled against each patch by `ackTick`."

- [ ] **Step 2: `docs/networking.md`**

Replace lines 3–30 with:

```markdown
Clients must never send poses. The wire message is `INPUT_MESSAGE` (`"input"`): `{ tick, steer,
throttle, fireSlots }` (`InputMessage` in shared, an `InputFrame` plus the server tick it is for).
`fireSlots` is a uint8 bitmask, bit 0 = slot 1. Server `isInputMessage` validates the shape; the
client's `InputRing` decides whether the tick is usable. `withSimulatedLatency` delays delivery when
`SIM_LATENCY_MS` / `SIM_JITTER_MS` are set.

`ArenaRoom` ticks on a `TickScheduler` anchored to `epoch + k × MS_PER_TICK` (netcode spec N1) and
broadcasts its schema patch inside every tick (`NET_CONFIG.snapshotEvery`, N9). There is no separate
patch rate.

## Server

Per tick, per player, in sorted `sessionId` order (`serverTick`, N6, N7):

- the player's `InputRing.inputFor(tick)` is read in **every phase**, so `PlayerState.ackTick`
  (= `ArenaState.tick`) never stalls. It returns the input stamped `tick` (fresh, `slackTicks` ≥ 0),
  else the most recent earlier input (repeat, `slackTicks` −n), else — after
  `NET_CONFIG.repeatMaxTicks` consecutive repeats — `NEUTRAL_INPUT`;
- every on-field player in MATCH is stepped on that input, whatever its source: drag, knock decay
  and maneuver countdowns always run, and a silent car brakes to a stop;
- a press is `fireSlots & ~previous.fireSlots` where `previous` is what the ring served last tick.
  A repeat is identical to its predecessor, so silence never fires;
- a message for a tick already served is dropped as late, a second message for one tick as a
  duplicate, and one beyond the ring's horizon (`ringSize`) as future — nothing is applied twice.

The bot writes into the same ring: `PracticeRoom` and `PlaygroundRoom` accept its decision for
`T + 1` at the end of tick `T` (N8).

## Client — movement

`ClockSync` (N3) estimates the server tick from pongs. `LeadController` (N4) picks how many ticks
ahead to run — initially `ceil((RTT/2 + jitter + one tick) / one tick)`, then raised by one the
moment the 5th-percentile `slackTicks` over `slackWindowTicks` drops below `slackTargetMin`, and
lowered by one only after the median has sat above `slackTargetMax + 1` for `leadLowerHoldMs`.
`TickLoop` (N5) runs one local tick per `MS_PER_TICK`, dilated by up to ±`dilationMax` toward
`serverTick + lead`; a target more than `reanchorTicks` away jumps, and a stall owing more than
`maxCatchUpTicks` re-anchors instead of replaying a burst. Each local tick sends one input stamped
with that tick and predicts it.

**Prediction.** `PredictionBuffer.predict` pushes `{ tick, input }` onto a pending buffer capped at
`NET_CONFIG.ringSize` and advances the local pose through the same shared `stepSim`.

**Reconciliation.** On every patch, `PredictionBuffer.reconcile(authoritative, ackTick, currentPredicted, ctx)`:

1. drops pending inputs by the **predicate** `tick <= ackTick` — every input at or below the tick
   the snapshot describes has been consumed on the server, fresh, repeated or replaced;
2. replays the remaining tail from the authoritative pose to get the target;
3. if `hypot(dx, dy) > NET_CONFIG.reconcileSnapPos`, or the **wrapped** angle error exceeds `reconcileSnapAngle`, returns the target outright;
4. otherwise eases `x`, `y` and `angle` by `reconcileEaseRate` and **snaps** the derived sim fields.
```

Line 54's "Prediction advances on the sim clock (`drainTicks`)" → "(`TickLoop`)" and "`accMs / MS_PER_TICK`" → "`TickLoop.fraction`"; line 60's "its own `prevFireMasks`" → "the ring's previous read"; line 64's first sentence → "`serverTick` reports the slots newly pressed on the input it drove each car on, so a lobby player's press spawns nothing and a repeat never fires."

- [ ] **Step 3: The other pages**

`docs/architecture.md:5` "Simulation interval uses `TICK_RATE_HZ` (30); patches use `DEFAULT_PATCH_RATE_HZ` (20)." → "A `TickScheduler` runs `tick()` at `TICK_RATE_HZ` (60) and broadcasts the schema patch inside every tick."; line 9 → "`serverTick(state, rings, dt, phase, statusMods)` — reads each session's `InputRing` for this tick (fresh, repeat or neutral), steps every on-field car through shared `stepSim`, writes `{x, y, angle}`, `ackTick` and `slackTicks`, and returns each session's newly pressed slots."; line 17 "emits one `InputMessage` per `MS_PER_TICK`" → "emits one tick-stamped `InputMessage` per local tick, `lead` ticks ahead of the server". `docs/schema-reference.md:58` → two rows: `ackTick | uint32 | 0 | Tick whose input this car was last driven on (= ArenaState.tick)` and `slackTicks | int8 | 0 | Ticks early that input arrived; negative = repeat/neutral used`. `docs/glossary.md:7-8`: Tick "at `TICK_RATE_HZ` (60)"; Patch → "**Snapshot** — the schema patch broadcast inside every tick (`NET_CONFIG.snapshotEvery`)". `docs/config-reference.md` NET_CONFIG table: drop `pendingInputCap`; add the twelve Task 2 keys and `pingIntervalMs`/`clockSamples` if N0 did not. `docs/project-structure.md`: add `net/tick-scheduler.ts`, `net/input-ring.ts` under server `net/`, `match/lead.ts`, `match/tick-loop.ts` under client `match/`.

- [ ] **Step 4: The acceptance run**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && cd packages/server && npx tsx playtest/netcode.ts && cd ../.. && npm run playtest`
Expected: green; `netcode.md` N1 reads `OK` with `repeated 0.00 %` and `correction p95 0.00 u` at every latency; the third `playtest` report folder is the phase's "after".

- [ ] **Step 5: Commit and push**

```bash
git add CLAUDE.md packages/shared/CLAUDE.md packages/server/CLAUDE.md packages/client/CLAUDE.md docs/networking.md docs/architecture.md docs/schema-reference.md docs/glossary.md docs/config-reference.md docs/project-structure.md
git commit -m "docs: 60 Hz tick, snapshot on tick (invariant 5), the input ring and the client lead (netcode phase 1)"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

---

## Acceptance

Spec §8, phase 1 row: **Ships** — "60 Hz sim (N1a) with its three hand retunes and every fixture re-pinned, `TickScheduler`, tick-stamped inputs, input ring with repeat/neutral, lead controller, snapshot on tick (still schema, still floats)". **Fixes** — "F2, F3, F5, F4 (half)". **Acceptance** — "repeated-input rate < 1 %; free-driving correction stays 0; golden and turn-tuning suites green on the new rate; `npm run playtest` baseline captured before and after".

| Requirement | Demonstrated by |
|---|---|
| Repeated-input rate < 1 % | `cd packages/server && npx tsx playtest/netcode.ts` (Task 4 Step 5, Task 5 Step 4): the N1 row's `repeated` column at 0, 30, 45, 60, 75 ms; the row reads `OK` |
| Free-driving correction stays 0 | the same report's `correction p95 0.00 u`; and `?debug=net` in a practice match showing `corrections 0` while driving on a straight |
| Golden suite green on the new rate | `cd packages/shared && npx vitest run src/sim/golden.test.ts` (Task 1) |
| Turn-tuning suite green on the new rate | `node --test scripts/turn-tuning-doc.test.mjs` after `npm run build -w @motor-combat-moba/shared` (Task 1 Step 6) |
| `npm run playtest` baseline before and after | Task 1 Steps 1 and 8 (the 30 Hz and 60 Hz folders named in that commit) and Task 5 Step 4 (the phase's end) |
| The three hand retunes | `reverseHoldTicks` 4 (Task 1, pinned by golden); contact damping measured and held (`collide-rate.test.ts`); the Euler step re-pinned (golden, `turn-tuning.md`, the manual page, the balance fingerprints, the probe list in Task 1's commit) |
| `TickScheduler` | `cd packages/server && npx vitest run src/net/tick-scheduler.test.ts` |
| Tick-stamped inputs, ring, lead | `cd packages/server && npx vitest run src/net/input-ring.test.ts src/sim/tick.test.ts`; `cd packages/client && npx vitest run src/match/lead.test.ts src/match/tick-loop.test.ts src/match/arena-net.test.ts` |
| Snapshot on tick | `?debug=net` `bytes in` at roughly 60 patches/s; `grep -n "setPatchRate(0)" packages/server/src/rooms/*.ts` finds all three rooms |
| Everything else still green | `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena` |

## Handoff

Exports this plan produces **beyond** the ledger, for N2 and later to consume or retire:

- Shared: `NEUTRAL_INPUT` is `Object.freeze`d (the ledger types it `Readonly`). `PlayerState.ackTick` equals `ArenaState.tick` for every player; N2's per-client snapshot header is where it stops being redundant.
- Server: `TickScheduler` options `clearTimeout`, `onReanchor(dropped)`, `onError(error)`; each room's private `wake()` (tick + patch) and `roomClock()` (now `scheduler.msIntoTick`) — `SnapshotBroadcaster.afterTick` (N2) plugs in where `wake()` calls `broadcastPatch()`. `RingRead.previous`. `TickResult.reads` and `runPipeline(...).reads` (the input log and, later, the netgraph's late/repeat counters read them). `InputRing.stats` is the source for N2's `lateInputs`. `PipelineCtx` no longer carries `hz`, `inputQueues` or `prevFireMasks`. `PlaytestWorld.rings`; `PlaytestWorld.input(id, msg)` keeps its contract.
- Client: `ArenaNet.attachClock(clock)`, `localTick`, `lead`, and the optional `nowMs` argument on `pumpInput` — `MatchClient` (N3) takes the clock in its constructor and keeps `localTick`; `LeadController.reset()`, `RAISE_MIN_SAMPLES` (`match/lead.ts`); `TickLoop.acc` (`match/tick-loop.ts`). `NetStats.slack`, `lead` and `repeatedInputs` are now filled; `lateInputs` stays 0 until N2 carries the server's late count. Deleted: `seedInputSeq`, `currentInputSeq` (`match/arena-net.ts`), `drainTicks`, `DrainResult` (`scenes/arena-input.ts`).
- Bots: `BOT_PROFILES` tick fields are 60 Hz numbers; `botFingerprint` changed in Task 1 with no `BOT_BRAIN_VERSION` bump.
- Measured and recorded, not changed: the 25° wall-grind speed halves at 60 Hz (`sim/collide-rate.test.ts`); a dt-aware grind term in `applyContact` is a `resolveWorld` edit behind the stop-and-ask fence, listed for the user.
- Not done here, on purpose: `playtest/lan.ts` (sends `seq` at a literal 30 Hz, now refused by `isInputMessage`) and the six probe report strings that quote 30 Hz per-tick figures (Task 1's commit step) — existing probes, edited only on request.

## Self-review

**Spec coverage.** N1: Task 2 (scheduler, catch-up cap, re-anchor, patch inside the wake). N1a: Task 1 (60 Hz, `reverseHoldTicks`, contact damping measured, golden / turn page / fingerprints / manual / probes re-pinned or flagged; bot ticks doubled under N28). N2: Task 4 (`{ tick, … }`, `seq` gone). N3 dilation: Task 3 `TickLoop` (±`dilationMax`, jump past `reanchorTicks`). N4: Task 3 `LeadController` (initial formula, raise-fast/lower-slow, clamp). N5: Task 3 `TickLoop` (`maxCatchUpTicks`, re-anchor on a long stall) and Task 4 `ArenaNet` (one send and one predict per local tick). N6: Task 4 `InputRing` (repeat, neutral after `repeatMaxTicks`, late/duplicate/future counted) and `serverTick` (every on-field car every tick; `hasKnock` deleted). N7: `RingRead.previous`, `prevFireMasks` deleted. N8: bots write `T + 1` at the end of `T` in both bot rooms and the balance harness. N9 (this phase's half): `setPatchRate(0)` + `broadcastPatch` every `snapshotEvery` ticks. N28: `runPipeline` shared by all three rooms; `setTuning` rules untouched (the practice-room source scan still passes). §8 acceptance: the harness row and the two suites. §11: the fence is crossed only at the retunes; `resolveWorld` is unedited. §13: 60 Hz.

**Placeholder scan.** Every new module is printed in full; every edit to an existing file is a line-cited substitution table; the four tests-to-rewrite (`tick.test.ts`, `prediction.test.ts`, `arena-net.test.ts`, `input-message.test.ts`) name each scenario and its replacement rather than "update the tests".

**Type consistency.** `InputRing.accept(msg: InputMessage, arrivalTick)` / `inputFor(tick): RingRead` (Task 4 Step 3) are what `serverTick` (Step 4), the rooms and harnesses (Step 5) call. `TickResult.reads: Map<string, RingRead>` is what `runPipeline` returns and `logInputs(reads)` takes. `LeadController.initial/observe/lead` and `TickLoop.advance/reanchor/localTick/fraction` (Task 3) are the members `ArenaNet.pumpInput` uses (Task 4 Step 7). `PredictionBuffer.reconcile(authoritative, ackTick, current, ctx)` (Step 6) is what `reconcileLocal` calls with `local.ackTick` (Step 7) and what `prediction.ts` and `netcode.ts` call with `snap.ackTick` / `me.ackTick` (Step 5). `NET_CONFIG` keys named in Tasks 3 and 4 are exactly the twelve added in Task 2.
