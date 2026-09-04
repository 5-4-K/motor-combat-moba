# ArenaScene Split and RenderFrame Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 2,788-line `ArenaScene.ts` into a headless net half (`ArenaNet`) and Phaser-bound render halves that communicate only through a `RenderFrame`, with no behaviour change, so the netcode stream and the rendering stream can proceed in parallel sessions.

**Architecture:** `ArenaScene` becomes a thin composer. `match/arena-net.ts` owns everything that decides *where things are* (input pacing, prediction, reconciliation, interpolation) and builds one `RenderFrame` per frame through `match/frame-builder.ts`, which fills the frame from today's Colyseus schema. Five renderer classes under `scenes/arena/` own the Phaser objects and draw the frame. A tiny `ArenaLayers` replaces the two hand-maintained camera ignore lists with per-object registration. Every moved method keeps its body verbatim; only its `this.` bindings change.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest in the node environment, Phaser 4.2.1, colyseus.js 0.15, Playwright 1.62.1 for the browser smoke check.

**Spec:** [`docs/superpowers/specs/2026-09-04-online-netcode-and-client-architecture-design.md`](../specs/2026-09-04-online-netcode-and-client-architecture-design.md) §10 decision 10 and N23/N23a; companion [`2026-09-04-client-rendering-architecture-design.md`](../specs/2026-09-04-client-rendering-architecture-design.md) §4 (layers) and R20 (the HUD later becomes its own scene — this plan does not do that).

## Global Constraints

- **No behaviour change.** Every method moved out of `ArenaScene` keeps its body verbatim except for the substitutions each task lists. The one deliberate reorder is named in Task 9 (camera follow moves from inside the car loop to after it, within the same frame).
- **Nothing under `packages/client/src/match/` imports Phaser**, directly or transitively, and neither does any test. Client tests run under vitest's **node** environment (`packages/client/vitest.config.ts`); importing Phaser from a test fails the suite.
- **`.js` import specifiers** on every local import; shared is imported as `@motor-combat-moba/shared`.
- **Rebuild shared before testing**: `npm run build -w @motor-combat-moba/shared`. Tests import client `src` but consume shared's built `dist`.
- **Verify with root `npm test`**, never a per-workspace run alone; then `npm run typecheck -w @motor-combat-moba/client` and root `npm run build`.
- **`inputSeq` stays monotonic for the page lifetime** (it moves from a scene field to a module-level counter; the server never resets `lastProcessedInputSeq`).
- **Do not touch `packages/server/playtest/`**; nothing there imports the client scene.
- **Do not edit `docs/ideas/` or `docs/invariants/`.**
- Commit after every task with the message given; the branch is `claude/gameplay-netcode-architecture-bgp8f6`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/client/src/match/render-frame.ts` (create) | The `RenderFrame`, `RenderCar`, `RenderInstance`, `RenderSlot` and `MatchEvent` types; `emptyRenderFrame`, `carOf` |
| `packages/client/src/match/frame-builder.ts` (create) | `bodyOf` (moved from the scene) and `buildRenderFrame`, the stub that fills a frame from today's schema |
| `packages/client/src/match/arena-net.ts` (create) | `ArenaNet`: input pacing, prediction, reconcile, interpolation, page-monotonic input seq, `frame()` |
| `packages/client/src/scenes/arena/arena-layers.ts` (create) | `ArenaLayers`: the HUD camera plus `world(obj)` / `hud(obj)` registration |
| `packages/client/src/scenes/arena/hitbox-toggle.ts` (create) | `hitboxesVisible(debug)` shared by the car and shot renderers |
| `packages/client/src/scenes/arena/car-renderer.ts` (create) | `CarRenderer`: car containers, hp bars, lock bracket, countdown arrow, maneuver visuals, impact spark |
| `packages/client/src/scenes/arena/shot-renderer.ts` (create) | `ShotRenderer`: weapon instances and charge orbs |
| `packages/client/src/scenes/arena/hud-renderer.ts` (create) | `HudRenderer`: slot bar, status strip, roster panel, and every HUD constant |
| `packages/client/src/scenes/arena/match-banners.ts` (create) | `MatchBanners`: countdown, spectate, clock, killed-by, respawn, idle-warning texts and the movement hint |
| `packages/client/src/scenes/arena/spectate-camera.ts` (create) | `SpectateCamera`: spectate target, free roam, camera follow and pan |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | Composer: keys, room binding, pause menu, arena floor, `create`/`update`/teardown |
| `scripts/smoke-arena.mjs` (create) | Playwright smoke check: build, start a server, play practice for a few seconds, assert the car moved and no errors |
| `package.json` (modify) | `smoke:arena` script and the `playwright` dev dependency |
| `packages/client/CLAUDE.md`, `docs/project-structure.md`, `docs/networking.md`, `docs/architecture.md` (modify) | Name the new files and the seam |

---

### Task 1: The `RenderFrame` contract

**Files:**
- Create: `packages/client/src/match/render-frame.ts`
- Test: `packages/client/src/match/render-frame.test.ts`

**Interfaces:**
- Produces: every type below; `emptyRenderFrame(nowMs?: number): RenderFrame`; `carOf(frame: RenderFrame, sessionId: string): RenderCar | undefined`. Tasks 2, 3, 5–9 consume them.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/match/render-frame.test.ts
import { describe, expect, it } from "vitest";
import { PlayerStatus } from "@motor-combat-moba/shared";
import { carOf, emptyRenderFrame, type RenderCar } from "./render-frame.js";

const NEUTRAL = {
  x: 0, y: 0, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0,
  authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
};

function car(sessionId: string): RenderCar {
  return {
    sessionId, isLocal: false, status: PlayerStatus.IN_MATCH, onField: true, alive: true, phased: false,
    pose: { ...NEUTRAL }, serverPose: { ...NEUTRAL },
    carId: "mirage", colorId: 0, name: sessionId, team: 0, joinedAtTick: 0,
    hp: 700, diedAtTick: 0, kills: 0, deaths: 0, killedBySessionId: "",
    lockTargetSessionId: "", statuses: [], weapons: [],
    level: 1, switchLockUntilTick: 0, pendingUntilTick: 0, lastFiredSlot: -1,
    lastProcessedInputSeq: 0,
  };
}

describe("emptyRenderFrame", () => {
  it("carries no cars, instances or events and the clock it was given", () => {
    const frame = emptyRenderFrame(1234);
    expect(frame.cars).toEqual([]);
    expect(frame.instances).toEqual([]);
    expect(frame.events).toEqual([]);
    expect(frame.nowMs).toBe(1234);
    expect(frame.tick).toBe(0);
    expect(frame.localSessionId).toBe("");
  });
});

describe("carOf", () => {
  it("finds a car by session id and answers undefined for a stranger", () => {
    const frame = { ...emptyRenderFrame(), cars: [car("a"), car("b")] };
    expect(carOf(frame, "b")?.name).toBe("b");
    expect(carOf(frame, "zz")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/client && npx vitest run src/match/render-frame.test.ts`
Expected: FAIL — cannot resolve `./render-frame.js`.

- [ ] **Step 3: Write the contract**

```ts
// packages/client/src/match/render-frame.ts
import type { PlayerStatus, SimBody, StatusRow } from "@motor-combat-moba/shared";

/**
 * Everything the renderer is handed for one frame, and nothing else.
 *
 * This is the seam between the two halves of the client (netcode spec N23): `ArenaNet` builds one
 * of these per frame and the renderers under `scenes/arena/` draw it. Today the fields are filled
 * from the Colyseus schema by `frame-builder.ts`; the netcode work later fills the same shape from
 * binary snapshots, and the rendering work draws the same shape with baked sprites. Neither side
 * may reach past it: a renderer never reads the schema, and the net half never touches a Phaser
 * object.
 *
 * Poses are *render* poses — predicted for the driven car, interpolated for a remote, raw for a
 * wreck — chosen by `ArenaNet.poseFor`. `serverPose` is the last authoritative one, kept so a
 * renderer that needs the truth (the debug overlay) has it without a second source.
 */
export interface RenderFrame {
  /** The newest authoritative tick — today the last patched `ArenaState.tick`. */
  tick: number;
  /** `RoomPhase` value. */
  phase: number;
  /** `GameMode` value. */
  mode: number;
  arenaId: string;
  countdownEndsTick: number;
  matchStartedAtTick: number;
  matchEndsTick: number;
  winnerTeam: number;
  winnerSessionId: string;
  /** `PracticeState.paused` / `PlaygroundState.paused`; false for a plain `ArenaState`. */
  paused: boolean;
  /** The driven car — the connection's own seat outside the playground. */
  localSessionId: string;
  /** `performance.now()` when the frame was built. */
  nowMs: number;
  /** Milliseconds since the newest snapshot arrived — today, since the last patch. */
  sinceSnapshotMs: number;
  /** How far the input accumulator is through the current tick, in [0, 1). Render-only. */
  tickFraction: number;
  /** Every player in the room, sorted by session id. */
  cars: RenderCar[];
  instances: RenderInstance[];
  /** Server events since the previous frame. Empty until the netcode work's phase 4 (N23a). */
  events: MatchEvent[];
}

export interface RenderCar {
  sessionId: string;
  isLocal: boolean;
  /** Kept raw for the roster derivations (`rosterRows` reads it). */
  status: PlayerStatus;
  /** `status === PlayerStatus.IN_MATCH` — the mover gate. */
  onField: boolean;
  alive: boolean;
  /** `isPhasedAt(statuses, tick)` — drawn as a ghost. */
  phased: boolean;
  pose: SimBody;
  serverPose: SimBody;
  carId: string;
  colorId: number;
  name: string;
  team: 0 | 1;
  /** Host-succession order; `rosterRows` sorts by it. */
  joinedAtTick: number;
  hp: number;
  diedAtTick: number;
  kills: number;
  deaths: number;
  killedBySessionId: string;
  lockTargetSessionId: string;
  statuses: readonly StatusRow[];
  weapons: readonly RenderSlot[];
  level: number;
  switchLockUntilTick: number;
  pendingUntilTick: number;
  lastFiredSlot: number;
  lastProcessedInputSeq: number;
}

export interface RenderSlot {
  weaponId: string;
  stocks: number;
  rechargeEndsTick: number;
  refireLockUntilTick: number;
}

export interface RenderInstance {
  id: string;
  ownerSessionId: string;
  weaponId: string;
  /** `WeaponKind` value. */
  kind: number;
  x: number;
  y: number;
  angle: number;
  extent: number;
  spawnTick: number;
  alive: boolean;
  isExplosion: boolean;
}

/**
 * Reliable game events (netcode spec N23a). Defined now so both streams build against the same
 * shape; nothing produces them until the netcode work's phase 4, and every renderer must behave
 * correctly on an empty list.
 */
export type MatchEvent =
  | { kind: "hit"; tick: number; attacker: string; victim: string; weaponId: string; x: number; y: number; damage: number }
  | { kind: "kill"; tick: number; killer: string; victim: string }
  | { kind: "ram"; tick: number; attacker: string; victim: string; x: number; y: number; severity: number }
  | { kind: "slam"; tick: number; car: string; x: number; y: number }
  | { kind: "respawn"; tick: number; car: string }
  | { kind: "refused"; tick: number; car: string; slot: number };

export function emptyRenderFrame(nowMs = 0): RenderFrame {
  return {
    tick: 0,
    phase: 0,
    mode: 0,
    arenaId: "",
    countdownEndsTick: 0,
    matchStartedAtTick: 0,
    matchEndsTick: 0,
    winnerTeam: -1,
    winnerSessionId: "",
    paused: false,
    localSessionId: "",
    nowMs,
    sinceSnapshotMs: 0,
    tickFraction: 0,
    cars: [],
    instances: [],
    events: [],
  };
}

export function carOf(frame: RenderFrame, sessionId: string): RenderCar | undefined {
  for (const car of frame.cars) if (car.sessionId === sessionId) return car;
  return undefined;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/client && npx vitest run src/match/render-frame.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/match/render-frame.ts packages/client/src/match/render-frame.test.ts
git commit -m "feat(client): define the RenderFrame contract between the net and render halves"
```

---

### Task 2: The schema-backed frame builder

**Files:**
- Create: `packages/client/src/match/frame-builder.ts`
- Test: `packages/client/src/match/frame-builder.test.ts`

**Interfaces:**
- Consumes: Task 1's types.
- Produces: `bodyOf(player: BodyFields): SimBody` (moved verbatim from `ArenaScene.ts:546-567`); `buildRenderFrame(state: FrameSource, inputs: FrameInputs): RenderFrame`; the `FrameSource`, `BodyFields`, `FrameInputs` types. Task 3 consumes all three.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/match/frame-builder.test.ts
import { describe, expect, it } from "vitest";
import {
  ArenaState,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  StatusState,
  WeaponInstanceState,
  WeaponSlotState,
  type SimBody,
} from "@motor-combat-moba/shared";
import { bodyOf, buildRenderFrame } from "./frame-builder.js";

function player(sessionId: string, x: number): PlayerState {
  const p = new PlayerState();
  p.sessionId = sessionId;
  p.name = sessionId.toUpperCase();
  p.status = PlayerStatus.IN_MATCH;
  p.alive = true;
  p.carId = "mirage";
  p.x = x;
  p.y = 100;
  p.angle = 0.5;
  p.speed = 12;
  p.hp = 700;
  return p;
}

function state(): ArenaState {
  const s = new ArenaState();
  s.tick = 300;
  s.phase = RoomPhase.MATCH;
  s.arenaId = "arena-01";
  // Inserted out of order on purpose: the frame must sort by session id.
  s.players.set("zed", player("zed", 500));
  s.players.set("amy", player("amy", 200));
  return s;
}

const shifted = (pose: SimBody): SimBody => ({ ...pose, x: pose.x + 1000 });

describe("bodyOf", () => {
  it("copies the thirteen integration fields and nothing else", () => {
    const p = player("amy", 200);
    p.reverseHold = 2;
    p.angVel = 0.25;
    expect(bodyOf(p)).toEqual({
      x: 200, y: 100, angle: 0.5, speed: 12, reverseHold: 2, angVel: 0.25,
      shoveX: 0, shoveY: 0, authority: 1, maneuver: 0, maneuverTicksLeft: 0,
      maneuverAngle: 0, maneuverSpeed: 0,
    });
  });
});

describe("buildRenderFrame", () => {
  const inputs = (local: string) => ({
    localSessionId: local,
    poseOf: (_sid: string, _p: PlayerState, serverPose: SimBody) => shifted(serverPose),
    nowMs: 5000,
    sinceSnapshotMs: 12,
    tickFraction: 0.4,
  });

  it("lists every player sorted by session id and flags the local one", () => {
    const frame = buildRenderFrame(state(), inputs("zed"));
    expect(frame.cars.map((c) => c.sessionId)).toEqual(["amy", "zed"]);
    expect(frame.cars.map((c) => c.isLocal)).toEqual([false, true]);
    expect(frame.localSessionId).toBe("zed");
  });

  it("asks poseOf for the render pose of an on-field car and keeps the server pose beside it", () => {
    const frame = buildRenderFrame(state(), inputs("zed"));
    const amy = frame.cars[0];
    expect(amy.serverPose.x).toBe(200);
    expect(amy.pose.x).toBe(1200);
  });

  it("uses the server pose for a player who is not on the field", () => {
    const s = state();
    s.players.get("amy")!.status = PlayerStatus.READY;
    const frame = buildRenderFrame(s, inputs("zed"));
    const amy = frame.cars[0];
    expect(amy.onField).toBe(false);
    expect(amy.pose.x).toBe(200);
  });

  it("carries the match clock, the timing inputs and an empty event list", () => {
    const frame = buildRenderFrame(state(), inputs("zed"));
    expect(frame.tick).toBe(300);
    expect(frame.phase).toBe(RoomPhase.MATCH);
    expect(frame.arenaId).toBe("arena-01");
    expect(frame.nowMs).toBe(5000);
    expect(frame.sinceSnapshotMs).toBe(12);
    expect(frame.tickFraction).toBe(0.4);
    expect(frame.events).toEqual([]);
    expect(frame.paused).toBe(false);
  });

  it("reads phased off the status rows at the frame's tick", () => {
    const s = state();
    const row = new StatusState();
    row.statusId = "phased";
    row.startTick = 290;
    row.endsTick = 320;
    s.players.get("amy")!.statuses.push(row);
    const frame = buildRenderFrame(s, inputs("zed"));
    expect(frame.cars[0].phased).toBe(true);
    expect(frame.cars[1].phased).toBe(false);
    expect(frame.cars[0].statuses).toHaveLength(1);
  });

  it("copies weapon slots and live instances", () => {
    const s = state();
    const slot = new WeaponSlotState();
    slot.weaponId = "magmablast";
    slot.stocks = 1;
    slot.rechargeEndsTick = 333;
    s.players.get("amy")!.weapons.push(slot);
    const inst = new WeaponInstanceState();
    inst.id = "amy-1";
    inst.ownerSessionId = "amy";
    inst.weaponId = "magmablast";
    inst.x = 50;
    inst.y = 60;
    inst.spawnTick = 299;
    s.weapons.set("amy-1", inst);
    const frame = buildRenderFrame(s, inputs("zed"));
    expect(frame.cars[0].weapons).toEqual([
      { weaponId: "magmablast", stocks: 1, rechargeEndsTick: 333, refireLockUntilTick: 0 },
    ]);
    expect(frame.instances).toEqual([
      {
        id: "amy-1", ownerSessionId: "amy", weaponId: "magmablast", kind: 0,
        x: 50, y: 60, angle: 0, extent: 0, spawnTick: 299, alive: true, isExplosion: false,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/client && npx vitest run src/match/frame-builder.test.ts`
Expected: FAIL — cannot resolve `./frame-builder.js`.

- [ ] **Step 3: Write the builder**

`bodyOf` is the function at `ArenaScene.ts:546-567`; copy its body exactly (thirteen fields, in that order).

```ts
// packages/client/src/match/frame-builder.ts
import {
  PlayerStatus,
  isPhasedAt,
  type PlayerState,
  type SimBody,
  type WeaponInstanceState,
} from "@motor-combat-moba/shared";
import { isSimPaused } from "../scenes/controlled-car.js";
import type { RenderCar, RenderFrame, RenderInstance, RenderSlot } from "./render-frame.js";

/** The thirteen fields `stepSim` integrates, as they sit on `PlayerState`. */
export interface BodyFields {
  x: number;
  y: number;
  angle: number;
  speed: number;
  reverseHold: number;
  angVel: number;
  shoveX: number;
  shoveY: number;
  authority: number;
  maneuver: number;
  maneuverTicksLeft: number;
  maneuverAngle: number;
  maneuverSpeed: number;
}

/** Moved verbatim from `ArenaScene`: a plain `SimBody` copied off a schema player. */
export function bodyOf(player: BodyFields): SimBody {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    speed: player.speed,
    reverseHold: player.reverseHold,
    angVel: player.angVel,
    shoveX: player.shoveX,
    shoveY: player.shoveY,
    authority: player.authority,
    maneuver: player.maneuver,
    maneuverTicksLeft: player.maneuverTicksLeft,
    maneuverAngle: player.maneuverAngle,
    maneuverSpeed: player.maneuverSpeed,
  };
}

/**
 * The slice of `ArenaState` the builder reads — structural, so a test can hand it a real schema
 * instance and the netcode work can later hand it something else.
 */
export interface FrameSource {
  tick: number;
  phase: number;
  mode: number;
  arenaId: string;
  countdownEndsTick: number;
  matchStartedAtTick: number;
  matchEndsTick: number;
  winnerTeam: number;
  winnerSessionId: string;
  players: { forEach(callback: (player: PlayerState, sessionId: string) => void): void };
  weapons: { forEach(callback: (instance: WeaponInstanceState, id: string) => void): void };
}

export interface FrameInputs {
  localSessionId: string;
  /**
   * The render pose for an on-field car: predicted for the driven car, interpolated for a remote,
   * raw for a wreck. `ArenaNet.poseFor` is the production answer. Not called for a player who is
   * not on the field — they draw nothing and keep the server pose.
   */
  poseOf: (sessionId: string, player: PlayerState, serverPose: SimBody) => SimBody;
  nowMs: number;
  sinceSnapshotMs: number;
  tickFraction: number;
}

export function buildRenderFrame(state: FrameSource, inputs: FrameInputs): RenderFrame {
  const cars: RenderCar[] = [];
  state.players.forEach((player, sessionId) => {
    const serverPose = bodyOf(player);
    const onField = player.status === PlayerStatus.IN_MATCH;
    const statuses = [...player.statuses];
    const weapons: RenderSlot[] = player.weapons.map((slot) => ({
      weaponId: slot.weaponId,
      stocks: slot.stocks,
      rechargeEndsTick: slot.rechargeEndsTick,
      refireLockUntilTick: slot.refireLockUntilTick,
    }));
    cars.push({
      sessionId,
      isLocal: sessionId === inputs.localSessionId,
      status: player.status,
      onField,
      alive: player.alive,
      phased: isPhasedAt(statuses, state.tick),
      pose: onField ? inputs.poseOf(sessionId, player, serverPose) : serverPose,
      serverPose,
      carId: player.carId,
      colorId: player.colorId,
      name: player.name,
      team: player.team === 1 ? 1 : 0,
      joinedAtTick: player.joinedAtTick,
      hp: player.hp,
      diedAtTick: player.diedAtTick,
      kills: player.kills,
      deaths: player.deaths,
      killedBySessionId: player.killedBySessionId,
      lockTargetSessionId: player.lockTargetSessionId,
      statuses,
      weapons,
      level: player.level,
      switchLockUntilTick: player.switchLockUntilTick,
      pendingUntilTick: player.pendingUntilTick,
      lastFiredSlot: player.lastFiredSlot,
      lastProcessedInputSeq: player.lastProcessedInputSeq,
    });
  });
  // The same order `buildStepContext` and `serverTick` use, so anything that walks the frame in
  // order agrees with the sim about which car came first.
  cars.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));

  const instances: RenderInstance[] = [];
  state.weapons.forEach((instance, id) => {
    instances.push({
      id,
      ownerSessionId: instance.ownerSessionId,
      weaponId: instance.weaponId,
      kind: instance.kind,
      x: instance.x,
      y: instance.y,
      angle: instance.angle,
      extent: instance.extent,
      spawnTick: instance.spawnTick,
      alive: instance.alive,
      isExplosion: instance.isExplosion,
    });
  });

  return {
    tick: state.tick,
    phase: state.phase,
    mode: state.mode,
    arenaId: state.arenaId,
    countdownEndsTick: state.countdownEndsTick,
    matchStartedAtTick: state.matchStartedAtTick,
    matchEndsTick: state.matchEndsTick,
    winnerTeam: state.winnerTeam,
    winnerSessionId: state.winnerSessionId,
    paused: isSimPaused(state),
    localSessionId: inputs.localSessionId,
    nowMs: inputs.nowMs,
    sinceSnapshotMs: inputs.sinceSnapshotMs,
    tickFraction: inputs.tickFraction,
    cars,
    instances,
    events: [],
  };
}
```

`isSimPaused` in `scenes/controlled-car.ts` is typed `(state: ArenaState)`, which a `FrameSource` does not satisfy. Change its signature to `isSimPaused(state: { tick: number; paused?: boolean }): boolean` — it already duck-types `paused`, and `tick` is the one property both `ArenaState` and `FrameSource` carry, which keeps TypeScript's weak-type check happy. Its body and its callers are unchanged; do not cast.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/client && npx vitest run src/match/frame-builder.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/match/frame-builder.ts packages/client/src/match/frame-builder.test.ts packages/client/src/scenes/controlled-car.ts
git commit -m "feat(client): build a RenderFrame from the Colyseus schema"
```

---

### Task 3: `ArenaNet`, the headless net half

**Files:**
- Create: `packages/client/src/match/arena-net.ts`
- Test: `packages/client/src/match/arena-net.test.ts`

**Interfaces:**
- Consumes: Task 2's `bodyOf`, `buildRenderFrame`; `PredictionBuffer` (`net/prediction.ts`), `InterpolationBuffer` and `blendPose` (`net/interpolation.ts`), `buildStepContext` and `localModifiers` (`net/step-context.ts`), `controlledCarOf` and `isSimPaused` (`scenes/controlled-car.ts`), `drainTicks` (`scenes/arena-input.ts`).
- Produces (Task 9 consumes every one):

```ts
export interface RawInput { steer: -1 | 0 | 1; throttle: -1 | 0 | 1; fireSlots: number }
export interface PumpResult { ticks: number; activeInput: boolean }
export function seedInputSeq(ack: number): void
export function currentInputSeq(): number
export class ArenaNet {
  constructor(arena: ArenaDef, sessionId: string)
  drivenSid(state: ArenaState): string
  seed(state: ArenaState): void
  syncDrivenCar(state: ArenaState): void
  canDrive(state: ArenaState): boolean
  pumpInput(state: ArenaState, deltaMs: number, sample: () => RawInput, send: (msg: InputMessage) => void): PumpResult
  onPatch(state: ArenaState, nowMs: number): void
  poseFor(sessionId: string, player: { alive: boolean }, serverPose: SimBody, sampleNowMs: number): SimBody
  forgetRemote(sessionId: string): void
  sinceLastPatchMs(nowMs: number): number
  frame(state: ArenaState, nowMs: number, sampleNowMs: number): RenderFrame
  get predictedPose(): SimBody | undefined
}
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/match/arena-net.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  ArenaState,
  MS_PER_TICK,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  getArena,
  type InputMessage,
} from "@motor-combat-moba/shared";
import { ArenaNet, currentInputSeq, seedInputSeq, type RawInput } from "./arena-net.js";

function player(sessionId: string, x: number): PlayerState {
  const p = new PlayerState();
  p.sessionId = sessionId;
  p.status = PlayerStatus.IN_MATCH;
  p.alive = true;
  p.carId = "mirage";
  p.x = x;
  p.y = 360;
  return p;
}

function matchState(): ArenaState {
  const s = new ArenaState();
  s.phase = RoomPhase.MATCH;
  s.arenaId = "arena-01";
  s.tick = 100;
  s.players.set("me", player("me", 300));
  s.players.set("them", player("them", 900));
  return s;
}

const FORWARD: RawInput = { steer: 0, throttle: 1, fireSlots: 0 };
const IDLE: RawInput = { steer: 0, throttle: 0, fireSlots: 0 };

describe("ArenaNet", () => {
  let state: ArenaState;
  let net: ArenaNet;
  let sent: InputMessage[];

  beforeEach(() => {
    state = matchState();
    net = new ArenaNet(getArena("arena-01"), "me");
    net.seed(state);
    sent = [];
  });

  it("drives the connection's own seat outside the playground", () => {
    expect(net.drivenSid(state)).toBe("me");
  });

  it("sends exactly one input per tick of accumulated delta and predicts forward", () => {
    const before = net.predictedPose;
    const result = net.pumpInput(state, MS_PER_TICK, () => FORWARD, (msg) => sent.push(msg));
    expect(result.ticks).toBe(1);
    expect(result.activeInput).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].throttle).toBe(1);
    expect(net.predictedPose).toBeDefined();
    expect(net.predictedPose!.x).toBeGreaterThan(before?.x ?? 300);
  });

  it("carries the remainder of a delta into the next pump", () => {
    net.pumpInput(state, MS_PER_TICK * 0.75, () => IDLE, (msg) => sent.push(msg));
    expect(sent).toHaveLength(0);
    net.pumpInput(state, MS_PER_TICK * 0.5, () => IDLE, (msg) => sent.push(msg));
    expect(sent).toHaveLength(1);
  });

  it("reports a neutral input as inactive", () => {
    const result = net.pumpInput(state, MS_PER_TICK, () => IDLE, (msg) => sent.push(msg));
    expect(result.activeInput).toBe(false);
  });

  it("sends nothing outside the match and zeroes the accumulator", () => {
    state.phase = RoomPhase.LOBBY;
    const result = net.pumpInput(state, MS_PER_TICK * 3, () => FORWARD, (msg) => sent.push(msg));
    expect(result.ticks).toBe(0);
    expect(sent).toHaveLength(0);
    state.phase = RoomPhase.MATCH;
    net.pumpInput(state, MS_PER_TICK * 0.5, () => FORWARD, (msg) => sent.push(msg));
    expect(sent).toHaveLength(0);
  });

  it("sends nothing for a wreck", () => {
    state.players.get("me")!.alive = false;
    const result = net.pumpInput(state, MS_PER_TICK, () => FORWARD, (msg) => sent.push(msg));
    expect(result.ticks).toBe(0);
  });

  it("numbers inputs with a page-monotonic seq that a seed can only raise", () => {
    net.pumpInput(state, MS_PER_TICK, () => IDLE, (msg) => sent.push(msg));
    const first = sent[0].seq;
    seedInputSeq(first - 5);
    expect(currentInputSeq()).toBe(first);
    seedInputSeq(first + 40);
    net.pumpInput(state, MS_PER_TICK, () => IDLE, (msg) => sent.push(msg));
    expect(sent[1].seq).toBe(first + 41);
  });

  it("reconciles the driven car against a patch and drops acked inputs", () => {
    net.pumpInput(state, MS_PER_TICK * 2, () => FORWARD, (msg) => sent.push(msg));
    const me = state.players.get("me")!;
    me.lastProcessedInputSeq = sent[1].seq;
    me.x = net.predictedPose!.x;
    me.speed = net.predictedPose!.speed;
    net.onPatch(state, 1000);
    expect(net.predictedPose!.x).toBeCloseTo(me.x, 5);
  });

  it("stops predicting once the driven car is a wreck", () => {
    net.pumpInput(state, MS_PER_TICK, () => FORWARD, (msg) => sent.push(msg));
    state.players.get("me")!.alive = false;
    net.onPatch(state, 1000);
    expect(net.predictedPose).toBeUndefined();
  });

  it("interpolates a remote from its patches and never the driven car", () => {
    net.onPatch(state, 1000);
    state.players.get("them")!.x = 960;
    net.onPatch(state, 1050);
    const them = state.players.get("them")!;
    const pose = net.poseFor("them", them, { ...net.frame(state, 1100, 1100).cars[1].serverPose }, 1100);
    expect(pose.x).toBeGreaterThanOrEqual(900);
    expect(pose.x).toBeLessThanOrEqual(960);
  });

  it("draws a wreck at its server pose", () => {
    const them = state.players.get("them")!;
    them.alive = false;
    const server = { ...net.frame(state, 0, 0).cars[1].serverPose };
    expect(net.poseFor("them", them, server, 0)).toEqual(server);
  });

  it("builds a frame with the driven car flagged and the patch age filled in", () => {
    net.onPatch(state, 2000);
    const frame = net.frame(state, 2030, 2030);
    expect(frame.localSessionId).toBe("me");
    expect(frame.cars.map((c) => c.sessionId)).toEqual(["me", "them"]);
    expect(frame.cars[0].isLocal).toBe(true);
    expect(frame.sinceSnapshotMs).toBe(30);
  });

  it("rebuilds prediction when the driven car changes", () => {
    net.pumpInput(state, MS_PER_TICK, () => FORWARD, (msg) => sent.push(msg));
    const other = new ArenaNet(getArena("arena-01"), "them");
    expect(other.drivenSid(state)).toBe("them");
    // No `seed` first: the first `syncDrivenCar` is the switch that adopts the car's pose.
    other.syncDrivenCar(state);
    expect(other.predictedPose?.x).toBe(900);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/client && npx vitest run src/match/arena-net.test.ts`
Expected: FAIL — cannot resolve `./arena-net.js`.

- [ ] **Step 3: Write `ArenaNet`**

The method bodies are the ones at `ArenaScene.ts:1285-1407` and `1560-1597`. Copy each body and apply only these substitutions:

| In the scene | In `ArenaNet` |
|---|---|
| `room.state` | `state` |
| `room.sessionId` | `this.sessionId` |
| `room.send(INPUT_MESSAGE, input)` | `send(input)` |
| `this.inputSeq += 1` / `seq: this.inputSeq` | `nextInputSeq += 1` / `seq: nextInputSeq` |
| the `axisOf(...)` / `slotMaskFrom(...)` block building `steer`, `throttle`, `fireSlots` | `const raw = sample();` then `steer: raw.steer, throttle: raw.throttle, fireSlots: raw.fireSlots` |
| `this.idleWarningText?.setVisible(false)` | return `true` from `sendInputTick` (the scene hides the banner) |
| `this.arena ?? getArena(room.state.arenaId)` | `this.arena` |
| `performance.now()` in `pushRemoteSnapshots` | the `nowMs` parameter |
| `this.time.now` in `remotePose` | the `sampleNowMs` parameter |
| `isSimPaused(room.state)` | `isSimPaused(state)` |

```ts
// packages/client/src/match/arena-net.ts
import {
  MS_PER_TICK,
  PlayerStatus,
  RoomPhase,
  type ArenaDef,
  type ArenaState,
  type InputMessage,
  type SimBody,
  type StepContext,
} from "@motor-combat-moba/shared";
import { InterpolationBuffer, blendPose } from "../net/interpolation.js";
import { PredictionBuffer } from "../net/prediction.js";
import { buildStepContext, localModifiers } from "../net/step-context.js";
import { drainTicks } from "../scenes/arena-input.js";
import { controlledCarOf, isSimPaused } from "../scenes/controlled-car.js";
import { bodyOf, buildRenderFrame } from "./frame-builder.js";
import type { RenderFrame } from "./render-frame.js";

/** Raw key state for one input tick, sampled by the scene from Phaser keys. */
export interface RawInput {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fireSlots: number;
}

export interface PumpResult {
  /** Inputs sent this pump. */
  ticks: number;
  /** Whether any of them carried a real steer, throttle or fire — what clears the idle warning. */
  activeInput: boolean;
}

/**
 * Monotonic for the lifetime of the page, deliberately module-level rather than per `ArenaNet`.
 * The server never resets `PlayerState.lastProcessedInputSeq`, so a seq that restarted at 1 for a
 * second match would sit below the standing ack and reconciliation would discard every pending
 * input. It is only ever nudged forward, never back. (Moved from `ArenaScene.inputSeq`, which had
 * the same contract by virtue of Phaser reusing the scene instance.)
 */
let nextInputSeq = 0;

export function seedInputSeq(ack: number): void {
  nextInputSeq = Math.max(nextInputSeq, ack);
}

export function currentInputSeq(): number {
  return nextInputSeq;
}

/**
 * The client's net half: everything that decides where a car is drawn, with no Phaser in it.
 *
 * Owns the prediction buffer for the driven car, one interpolation buffer per remote, the input
 * accumulator that paces sends to the sim clock, and the patch clock the shot layer extrapolates
 * from. `ArenaScene` feeds it frame deltas, key samples and patches, and asks it for one
 * `RenderFrame` per frame. Moved out of the scene method-for-method (netcode spec §10 decision 10)
 * so that it can be unit tested and so the netcode work can replace it behind the same surface.
 */
export class ArenaNet {
  private prediction = new PredictionBuffer();
  private readonly interps = new Map<string, InterpolationBuffer>();
  private predicted: SimBody | undefined;
  private predictedPrev: SimBody | undefined;
  private lastDrivenSid: string | undefined;
  private inputAccumulatorMs = 0;
  private lastPatchMs = 0;

  constructor(
    private readonly arena: ArenaDef,
    private readonly sessionId: string,
  ) {}

  get predictedPose(): SimBody | undefined {
    return this.predicted;
  }

  drivenSid(state: ArenaState): string {
    return controlledCarOf(state, this.sessionId);
  }

  /**
   * What `ArenaScene.create` did before its first frame: raise the seq past the server's standing
   * ack and remember the driven car so the first `update` is not itself a "switch".
   */
  seed(state: ArenaState): void {
    seedInputSeq(state.players.get(this.drivenSid(state))?.lastProcessedInputSeq ?? 0);
    this.lastDrivenSid = this.drivenSid(state);
  }

  syncDrivenCar(state: ArenaState): void {
    // body of ArenaScene.syncDrivenCar (1302-1318), substituted per the table
  }

  canDrive(state: ArenaState): boolean {
    // body of ArenaScene.canDrive (1319-1324)
  }

  pumpInput(
    state: ArenaState,
    deltaMs: number,
    sample: () => RawInput,
    send: (msg: InputMessage) => void,
  ): PumpResult {
    this.syncDrivenCar(state);
    if (!this.canDrive(state) || isSimPaused(state)) {
      this.inputAccumulatorMs = 0;
      return { ticks: 0, activeInput: false };
    }
    const { accMs, ticks } = drainTicks(this.inputAccumulatorMs, deltaMs);
    this.inputAccumulatorMs = accMs;
    let activeInput = false;
    for (let i = 0; i < ticks; i++) {
      if (this.sendInputTick(state, sample, send)) activeInput = true;
    }
    return { ticks, activeInput };
  }

  /** Returns whether the input carried a real steer, throttle or fire. */
  private sendInputTick(
    state: ArenaState,
    sample: () => RawInput,
    send: (msg: InputMessage) => void,
  ): boolean {
    // body of ArenaScene.sendInputTick (1325-1364), substituted per the table; the idle-warning
    // branch becomes `const active = input.steer !== 0 || input.throttle !== 0 || input.fireSlots !== 0;`
    // and the method returns `active` after predicting.
  }

  private stepContext(state: ArenaState): StepContext {
    // body of ArenaScene.stepContext (1365-1378) with `this.arena` in place of the fallback
  }

  /** What `bindRoom`'s `onState` did for the net half, in the same order. */
  onPatch(state: ArenaState, nowMs: number): void {
    this.lastPatchMs = nowMs;
    this.reconcileLocal(state);
    this.pushRemoteSnapshots(state, nowMs);
  }

  private reconcileLocal(state: ArenaState): void {
    // body of ArenaScene.reconcileLocal (1379-1407)
  }

  private pushRemoteSnapshots(state: ArenaState, nowMs: number): void {
    // body of ArenaScene.pushRemoteSnapshots (1560-1587) with `nowMs` in place of performance.now()
  }

  private localRenderPose(serverPose: SimBody): SimBody {
    // body of ArenaScene.localRenderPose (1588-1593)
  }

  private remotePose(sessionId: string, pose: SimBody, sampleNowMs: number): SimBody {
    return this.interps.get(sessionId)?.sample(sampleNowMs) ?? pose;
  }

  /**
   * The ternary `renderCars` used: a wreck draws the raw server pose, the driven car its predicted
   * one, a remote its interpolated one.
   */
  poseFor(
    sessionId: string,
    player: { alive: boolean },
    serverPose: SimBody,
    sampleNowMs: number,
  ): SimBody {
    if (!player.alive) return serverPose;
    if (sessionId === this.lastDrivenSid) return this.localRenderPose(serverPose);
    return this.remotePose(sessionId, serverPose, sampleNowMs);
  }

  /** `renderCars` deleted a departed car's buffer; the car renderer reports the departure here. */
  forgetRemote(sessionId: string): void {
    this.interps.delete(sessionId);
  }

  sinceLastPatchMs(nowMs: number): number {
    return nowMs - this.lastPatchMs;
  }

  frame(state: ArenaState, nowMs: number, sampleNowMs: number): RenderFrame {
    return buildRenderFrame(state, {
      localSessionId: this.drivenSid(state),
      poseOf: (sessionId, player, serverPose) =>
        this.poseFor(sessionId, player, serverPose, sampleNowMs),
      nowMs,
      sinceSnapshotMs: this.sinceLastPatchMs(nowMs),
      tickFraction: this.inputAccumulatorMs / MS_PER_TICK,
    });
  }
}
```

Two details to preserve while copying:

- `poseFor` compares against `this.lastDrivenSid`, which `syncDrivenCar` keeps equal to `drivenSid(state)`; in the scene the comparison was `sessionId === this.drivenSid(room)`. They are the same value on every frame after `seed`, and using the field avoids a `controlledCarOf` call per car per frame.
- `remotePose` in the scene was called only for living remotes; `poseFor` reproduces that gate with the `alive` check first, exactly as the scene's ternary did.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/client && npx vitest run src/match/arena-net.test.ts`
Expected: PASS (12 tests). If "interpolates a remote" fails on the upper bound, the interpolation delay (50 ms) is holding the first snapshot: that is correct behaviour — relax the assertion to `toBeGreaterThanOrEqual(900)` only and keep going.

- [ ] **Step 5: Run the whole client suite**

Run: `cd packages/client && npx vitest run`
Expected: PASS, no test imports Phaser.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/match/arena-net.ts packages/client/src/match/arena-net.test.ts
git commit -m "feat(client): extract ArenaNet, the headless net half of the arena scene"
```

---

### Task 4: `ArenaLayers` and the hitbox toggle

**Files:**
- Create: `packages/client/src/scenes/arena/arena-layers.ts`
- Create: `packages/client/src/scenes/arena/hitbox-toggle.ts`
- Test: `packages/client/src/scenes/arena/hitbox-toggle.test.ts`

**Interfaces:**
- Produces: `class ArenaLayers { readonly hudCamera; constructor(scene: Phaser.Scene); world<T>(obj: T): T; hud<T>(obj: T): T }`; `hitboxesVisible(debug: boolean): boolean`. Tasks 5–9 consume them.

- [ ] **Step 1: Write the failing test for the toggle**

```ts
// packages/client/src/scenes/arena/hitbox-toggle.test.ts
import { describe, expect, it } from "vitest";
import { hitboxesVisible } from "./hitbox-toggle.js";

describe("hitboxesVisible", () => {
  it("is on when the debug flag is on, whatever the live toggle says", () => {
    expect(hitboxesVisible(true, () => false)).toBe(true);
  });
  it("follows the live toggle when debug is off", () => {
    expect(hitboxesVisible(false, () => true)).toBe(true);
    expect(hitboxesVisible(false, () => false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/scenes/arena/hitbox-toggle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the toggle and the layers**

```ts
// packages/client/src/scenes/arena/hitbox-toggle.ts
import { showHitboxes } from "../../config/view-options.js";

/**
 * Whether hitbox outlines are drawn: the load-time `?debug=1` flag, or the playground's live
 * "Show hitboxes" toggle. Either alone is enough, so turning the checkbox off does not override
 * someone who asked for debug in the URL. (Moved from `ArenaScene.hitboxesVisible`; the toggle is
 * injectable so the rule is testable without the view-options module's globals.)
 */
export function hitboxesVisible(debug: boolean, liveToggle: () => boolean = showHitboxes): boolean {
  return debug || liveToggle();
}
```

```ts
// packages/client/src/scenes/arena/arena-layers.ts
import Phaser from "phaser";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../../config/display.js";

/**
 * The two-camera split, as a registry instead of two hand-maintained lists.
 *
 * Phaser renders the whole display list once per camera, so every object must be ignored by
 * exactly one of the two: ignored by neither and it double-draws, by both and it vanishes.
 * `ArenaScene.splitCameras` used to build two arrays after every object existed, and anything born
 * later (a car container, an impact spark) had to opt out by hand — the bug at the old
 * `:1007-1009` was a `lockGfx` in neither list. Here a renderer registers each object as it creates
 * it: `world(obj)` hides it from the HUD camera, `hud(obj)` hides it from the world camera. Same
 * ignore calls, same cameras, no list to forget.
 *
 * Construct this before any object is created, so the HUD camera exists to be registered against.
 */
export class ArenaLayers {
  readonly hudCamera: Phaser.Cameras.Scene2D.Camera;

  constructor(private readonly scene: Phaser.Scene) {
    // Copy every camera-configuration line from the old `splitCameras` (`ArenaScene.ts:975-1022`)
    // that touches `hudCamera` — the `cameras.add(0, 0, VIEW_WIDTH, VIEW_HEIGHT)` call and any
    // scroll, zoom or background it sets — here, verbatim. Only the two `ignore(list)` calls are
    // replaced by the methods below.
    this.hudCamera = scene.cameras.add(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  }

  /** A world-space object: drawn by the main camera only. */
  world<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.hudCamera.ignore(obj);
    return obj;
  }

  /** A screen-space object: drawn by the HUD camera only. */
  hud<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.scene.cameras.main.ignore(obj);
    return obj;
  }
}
```

- [ ] **Step 4: Run the toggle test and the typecheck**

Run: `cd packages/client && npx vitest run src/scenes/arena/hitbox-toggle.test.ts && npm run typecheck`
Expected: PASS; typecheck clean (the layers file compiles even though nothing uses it yet).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/scenes/arena/arena-layers.ts packages/client/src/scenes/arena/hitbox-toggle.ts packages/client/src/scenes/arena/hitbox-toggle.test.ts
git commit -m "feat(client): ArenaLayers camera registry and a testable hitbox toggle"
```

---

### Task 5: `CarRenderer`

**Files:**
- Create: `packages/client/src/scenes/arena/car-renderer.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (nothing yet — the scene is rewired in Task 9; until then the new class is compiled but unused)

**Interfaces:**
- Consumes: `RenderFrame`, `RenderCar`, `carOf` (Task 1); `ArenaLayers`, `hitboxesVisible` (Task 4).
- Produces:

```ts
export class CarRenderer {
  constructor(scene: Phaser.Scene, layers: ArenaLayers, debug: boolean)
  /** Draws every car; returns the session ids whose buffers the net half should forget. */
  render(frame: RenderFrame, cameraTargetSid: string): string[]
  /** Forces every car to be redrawn once — what `create` did with `visualKeys.clear()` when art loaded. */
  invalidateVisuals(): void
  destroy(): void
}
```

- [ ] **Step 1: Create the class with the moved members**

Move these members out of `ArenaScene` into `CarRenderer`, bodies verbatim, with the substitutions in the table below:

| Moved | From (old lines) |
|---|---|
| constants `HITBOX_STROKE`, `HITBOX_PX`, `HITBOX_NAME`, `HP_BAR_DEPTH`, `LOCK_DEPTH`, `ARROW_DEPTH`, `CAR_DEPTH`, `MANEUVER_DEPTH`, `DASH_GHOST_WIDTH`, `HP_BAR_GEOMETRY`, `HP_BAR_BACK`, `LOCK_COLOR`, `LOCK_WIDTH`, `ARROW_COLOR`, `ARROW_ALPHA`, `PHASED_ALPHA` and their comments | 149–341 |
| `visualKeyOf` (now taking a `RenderCar`) | 569–572 |
| fields `cars`, `visualKeys`, `hpGfx`, `lockGfx`, `arrowGfx`, `maneuverGfx`, `impacts`, `debug` | 577–578, 614–618, 726 |
| the four `this.add.graphics().setDepth(...)` lines for hp, lock, arrow, maneuver | 793–797 → the constructor, each wrapped in `layers.world(...)` |
| `renderCars` → `render` | 1408–1559 |
| `syncCar`, `showImpact`, `drawCar`, `spriteFor`, `silhouette`, `drawCountdownArrow`, `drawHpBar`, `drawManeuverVisuals` | 1598–1844 |
| the car-related lines of `resetMatchState` (destroy the four Graphics, the car containers, clear the maps, `impacts = newImpactTracker()`) | 1085–1169 → `destroy()` |

Substitutions inside the moved bodies:

| In the scene | In `CarRenderer` |
|---|---|
| `this.add`, `this.tweens`, `this.cameras.main`, `this.textures` | `this.scene.add`, `this.scene.tweens`, `this.scene.cameras.main`, `this.scene.textures` |
| `this.hudCamera?.ignore(gfx)` (in `syncCar` and `showImpact`) | `this.layers.world(gfx)` |
| `this.hitboxesVisible()` | `hitboxesVisible(this.debug)` |
| `room.state.players.forEach((player, sessionId) => { if (player.status !== PlayerStatus.IN_MATCH) return; ...` | `for (const car of frame.cars) { if (!car.onField) continue; const sessionId = car.sessionId; const player = car;` |
| `bodyOf(player)` / the `pose` ternary | `car.serverPose` / `car.pose` (the ternary now lives in `ArenaNet.poseFor`) |
| `this.drivenSid(room)` | `frame.localSessionId` |
| `room.state.tick` | `frame.tick` |
| `room.state.mode === GameMode.TEAM ? "team" : "ffa"` | `frame.mode === GameMode.TEAM ? "team" : "ffa"` |
| `isPhasedAt(player.statuses, room.state.tick)` | `car.phased` |
| `room.state.players.get(this.drivenSid(room))` (the `viewer`) | `carOf(frame, frame.localSessionId)` |
| `this.cameraTarget(room)` | `cameraTargetSid` |
| `if (sessionId === this.cameraTarget(room)) this.followCamera(pose, delta);` | **delete** — the scene follows the camera from the frame after `render` (Task 9; the one deliberate reorder) |
| `room.state.players.get(this.cameraTarget(room))` (the lock-bracket subject) | `carOf(frame, cameraTargetSid)` |
| `this.drawCountdownArrow(arrow, room, selfPose)` | `this.drawCountdownArrow(arrow, frame, selfPose)`; inside, `room.state.phase`, `room.state.countdownEndsTick`, `room.state.tick` become `frame.phase`, `frame.countdownEndsTick`, `frame.tick` |
| `this.drawHpBar(hp, player, pose, allegiance)` and `this.drawManeuverVisuals(maneuver, player, pose)` | unchanged calls; their parameter type `ArenaPlayer` becomes `RenderCar` (every field they read exists on it, `maneuver*` through `car.pose`) — where a body reads `player.maneuver`, `player.maneuverAngle`, read `player.pose.maneuver`, `player.pose.maneuverAngle` |
| `this.interps.delete(sessionId)` in the departed-car sweep | push `sessionId` onto a local `departed: string[]` that `render` returns |

Keep `allegianceOf(viewer, { sessionId, team: player.team }, mode)` exactly; `viewer` is now a `RenderCar`, which has `sessionId` and `team`.

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npm run typecheck`
Expected: clean. `ArenaScene` still compiles unchanged because nothing was removed from it yet; unused-import warnings are not errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/scenes/arena/car-renderer.ts
git commit -m "refactor(client): CarRenderer draws cars, bars, bracket, arrow and sparks from a RenderFrame"
```

---

### Task 6: `ShotRenderer`

**Files:**
- Create: `packages/client/src/scenes/arena/shot-renderer.ts`

**Interfaces:**
- Consumes: `RenderFrame` (Task 1), `ArenaLayers`, `hitboxesVisible` (Task 4).
- Produces: `class ShotRenderer { constructor(scene: Phaser.Scene, layers: ArenaLayers, debug: boolean); render(frame: RenderFrame): void; destroy(): void }`.

- [ ] **Step 1: Create the class with the moved members**

| Moved | From (old lines) |
|---|---|
| constants `SHOT_DEPTH` and its comment | 192–202 |
| field `shotGfx`; its `this.add.graphics().setDepth(SHOT_DEPTH)` line | 613, 793 → constructor, wrapped in `layers.world(...)` |
| `renderShots` → `render` | 1845–1959 |
| `renderChargeOrbs` | 1960–1985 |
| the `shotGfx?.destroy()` lines of `resetMatchState` | → `destroy()` |

Substitutions:

| In the scene | In `ShotRenderer` |
|---|---|
| `this.add` | `this.scene.add` |
| `const nowMs = performance.now();` and `const elapsedMs = nowMs - this.lastPatchMs;` | `const nowMs = frame.nowMs;` and `const elapsedMs = frame.sinceSnapshotMs;` |
| `room.state.weapons.forEach((instance) => ...)` (both passes) | `for (const instance of frame.instances)` — `RenderInstance` has every field `DrawableInstance` needs |
| `room.state.tick` | `frame.tick` |
| `this.hitboxesVisible()` | `hitboxesVisible(this.debug)` |
| `this.renderChargeOrbs(room, gfx)` | `this.renderChargeOrbs(frame, gfx)`; inside, `room.state.players.forEach((player) => ...)` becomes `for (const car of frame.cars)`, and `player.weapons[slot]`, `player.pendingUntilTick`, `player.lastFiredSlot`, `player.x/y/angle` read from `car.weapons`, `car.pendingUntilTick`, `car.lastFiredSlot`, `car.pose` |

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/scenes/arena/shot-renderer.ts
git commit -m "refactor(client): ShotRenderer draws weapon instances and charge orbs from a RenderFrame"
```

---

### Task 7: `HudRenderer`

**Files:**
- Create: `packages/client/src/scenes/arena/hud-renderer.ts`

**Interfaces:**
- Consumes: `RenderFrame`, `RenderCar`, `carOf` (Task 1); `ArenaLayers` (Task 4).
- Produces: `class HudRenderer { constructor(scene: Phaser.Scene, layers: ArenaLayers); render(frame: RenderFrame, hudTargetSid: string): void; destroy(): void }`.

- [ ] **Step 1: Create the class with the moved members**

| Moved | From (old lines) |
|---|---|
| every `HUD_*`, `ROSTER_*` constant, `FLAME_UNIT_POINTS`, `flameScratch`, and their comments (`HUD_TEXT` is also needed by the banners — export it from here and import it there) | 148, 244–437, 451–491 |
| fields `hudGfx`, `hudSweepGfx`, `hudKeyTexts`, `hudNameTexts`, `hudCountdownTexts`, `hudStockTexts`, `hudIconImages`, `hudStatusTexts`, `rosterGfx`, `rosterNameTexts`, `rosterKillTexts` | 689–719 |
| the three `this.add.graphics().setScrollFactor(0).setDepth(...)` lines for `hudGfx`, `hudSweepGfx`, `rosterGfx`, and `this.buildHudTextPool()` | 798–801 → the constructor; every created object wrapped in `layers.hud(...)`, including each pooled Text and Image inside `buildHudTextPool` |
| `buildHudTextPool`, `makeHudText`, `renderRosterPanel`, `renderWeaponHud`, `drawStatusStrip`, `drawHudSlot`, `hudDimFor`, `applyWeaponIcon`, `drawWeaponGlyph`, `flamePoints`, `drawSlotRing`, `drawSweepArc`, `slotRingRadius` | 1986–2046, 2069–2503 |
| the HUD lines of `resetMatchState` (three Graphics, eight pools) | → `destroy()` |

`render(frame, hudTargetSid)` is the old two-line sequence from `update`:

```ts
render(frame: RenderFrame, hudTargetSid: string): void {
  const panelHeight = this.renderRosterPanel(frame);
  this.renderWeaponHud(frame, hudTargetSid, panelHeight);
}
```

Substitutions:

| In the scene | In `HudRenderer` |
|---|---|
| `this.add`, `this.textures` | `this.scene.add`, `this.scene.textures` |
| `[...room.state.players.values()]` in `renderRosterPanel` | `frame.cars` (a `RenderCar` has every field `rosterRows` reads: `status`, `alive`, `name`, `colorId`, `kills`, `sessionId`) |
| `room.state.mode` | `frame.mode` |
| `this.hudTargetPlayer(room)` in `renderWeaponHud` | `carOf(frame, hudTargetSid)` — `hudTargetPlayer` itself is **not** moved; the scene computes the target through `SpectateCamera` (Task 8) and passes the id |
| `room.state.tick` | `frame.tick` |
| `player.weapons` (a `WeaponSlotState[]`), `player.statuses`, `player.level`, `player.switchLockUntilTick`, `player.pendingUntilTick`, `player.lastFiredSlot` | the same names on `RenderCar`; `drawHudSlot`'s parameter typed `WeaponSlotState` becomes `RenderSlot` |

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/scenes/arena/hud-renderer.ts
git commit -m "refactor(client): HudRenderer draws the slot bar, status strip and roster from a RenderFrame"
```

---

### Task 8: `MatchBanners` and `SpectateCamera`

**Files:**
- Create: `packages/client/src/scenes/arena/match-banners.ts`
- Create: `packages/client/src/scenes/arena/spectate-camera.ts`

**Interfaces:**
- Consumes: `RenderFrame`, `carOf` (Task 1); `ArenaLayers` (Task 4); `HUD_TEXT` (Task 7).
- Produces:

```ts
export interface SpectateView { spectating: boolean; freeRoam: boolean; targetSid: string }
export class SpectateCamera {
  constructor(scene: Phaser.Scene, keys: SpectateKeys | undefined, cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined)
  /** What `drawArena` set: the camera is parked when the arena fits the viewport. */
  setStatic(staticCamera: boolean): void
  isSpectating(frame: RenderFrame): boolean
  cameraTarget(frame: RenderFrame): string
  hudTarget(frame: RenderFrame): string
  update(frame: RenderFrame, delta: number): void
  follow(pose: SimBody, delta: number): void
  view(frame: RenderFrame): SpectateView
}
export class MatchBanners {
  constructor(scene: Phaser.Scene, layers: ArenaLayers)
  sync(frame: RenderFrame, spectate: SpectateView): void
  showIdleWarning(seconds: number): void
  hideIdleWarning(): void
  destroy(): void
}
```

- [ ] **Step 1: Create `SpectateCamera`**

| Moved | From (old lines) |
|---|---|
| interface `SpectateKeys` (exported) | 536–544 |
| fields `camFocus`, `spectateTarget`, `freeRoam`, `staticCamera` | 595, 649–660 |
| `isSpectating`, `cameraTarget`, `updateSpectate` → `update`, `panCamera`, `spectateCandidates`, `justDown`, `followCamera` → `follow` | 2504–2605 |
| `hudTargetPlayer`'s *selection* logic (which session id the HUD follows) → `hudTarget(frame): string`, returning the id instead of the `PlayerState` | 2047–2068 |

Substitutions: `room.state` → `frame`; `this.drivenSid(room)` → `frame.localSessionId`; `room.state.players.get(x)` → `carOf(frame, x)`; `room.state.players.forEach` / `[...room.state.players.values()]` in `spectateCandidates` → `frame.cars`; `this.cameras.main` → `this.scene.cameras.main`; `this.cursors` and `this.keys` → the constructor parameters stored as fields. `view(frame)` returns `{ spectating: this.isSpectating(frame), freeRoam: this.freeRoam, targetSid: this.spectateTarget }`.

- [ ] **Step 2: Create `MatchBanners`**

| Moved | From (old lines) |
|---|---|
| constants `MATCH_CLOCK_*`, `KILLED_BY_*`, `RESPAWN_*`, `IDLE_WARNING_*`, `MOVEMENT_HINT_*`, `ACTION_HINT_Y` and comments | 342–420 |
| fields `countdownText`, `spectateText`, `matchClockText`, `killedByBanner`, `respawnText`, `idleWarningText`, `movementHintGfx`, `movementHintTexts` | 612, 619–647 |
| the six `this.add.text(...)` blocks and `this.buildMovementHint()` from `create` | 806–860, 862 → the constructor, each object wrapped in `layers.hud(...)`, including every object `buildHintRow` creates |
| `syncMatchHud` → `sync`, `syncDeathmatchHud`, `buildMovementHint`, `buildHintRow`, `syncMovementHint`, `syncSpectateHud` | 2606–2789 |
| the banner lines of `resetMatchState` | → `destroy()` |

Substitutions: `const room = this.room; if (!room) return;` at the top of `syncMatchHud` → delete (the frame is the argument); `room.state.phase/countdownEndsTick/tick/matchEndsTick/matchStartedAtTick` → the same names on `frame`; `this.drivenSid(room)` → `frame.localSessionId`; `room.state.players.get(x)` → `carOf(frame, x)`; in `syncSpectateHud`, `this.isSpectating(room)` → `spectate.spectating`, `this.freeRoam` → `spectate.freeRoam`, `room.state.players.get(this.spectateTarget)?.name` → `carOf(frame, spectate.targetSid)?.name`. `showIdleWarning(seconds)` is the body of `bindRoom`'s `onIdleWarning` (`setText(\`No input — session ending in ${seconds}s\`).setVisible(true)`); `hideIdleWarning()` is `this.idleWarningText?.setVisible(false)`.

- [ ] **Step 3: Typecheck**

Run: `cd packages/client && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/scenes/arena/match-banners.ts packages/client/src/scenes/arena/spectate-camera.ts
git commit -m "refactor(client): MatchBanners and SpectateCamera own the banners and the spectate camera"
```

---

### Task 9: Rewire `ArenaScene` as the composer

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: everything Tasks 1–8 produce.
- Produces: an `ArenaScene` under 700 lines whose private field `net: ArenaNet | undefined` the smoke script (Task 10) reads.

- [ ] **Step 1: Delete every member that moved**

Remove from `ArenaScene.ts` all constants, fields and methods listed in the "Moved" tables of Tasks 3, 5, 6, 7 and 8, and `bodyOf`, `ArenaPlayer`, `visualKeyOf`, `splitCameras`, `hitboxesVisible`, `pumpInput`, `drivenSid`, `syncDrivenCar`, `canDrive`, `sendInputTick`, `stepContext`, `reconcileLocal`, `pushRemoteSnapshots`, `localRenderPose`, `remotePose`, `hudTargetPlayer`. Remove the imports that become unused. What stays: `ARENA_BORDER_PX`, `DriveKeys`, the constructor, `create`, `bindKeys`, `bindDriveKeys`, `bindSlotKeys`, `bindPauseKey`, `drawArena`, `bindRoom`, `unbindAll`, `onShutdown`, `resetMatchState`, `update`, `pumpPauseKey`, `syncPauseOverlay`, `exitPractice`.

- [ ] **Step 2: Add the new fields**

```ts
private net: ArenaNet | undefined;
private layers: ArenaLayers | undefined;
private carRenderer: CarRenderer | undefined;
private shotRenderer: ShotRenderer | undefined;
private hudRenderer: HudRenderer | undefined;
private banners: MatchBanners | undefined;
private spectate: SpectateCamera | undefined;
private lastFrame: RenderFrame = emptyRenderFrame();
```

Keep `room`, `arena`, `arenaGfx`, `cursors`, `driveKeys`, `slotKeys`, `keys`, `pauseKey`, `debug`, `artPending`, `unbind`, `mismatchOverlay`, `pauseOverlay`, `pauseMenuShown`, `exitTarget`.

- [ ] **Step 3: Rewrite `create` in the same order as before**

```ts
create(): void {
  this.resetMatchState();
  this.debug = isDebugEnabled();
  void assetsReady()
    .then(() => {
      this.artPending = false;
      this.carRenderer?.invalidateVisuals();
    })
    .catch((error: unknown) => console.warn(`[art] asset load rejected: ${String(error)}`));
  this.room = this.registry.get("room") as Room<ArenaState> | undefined;
  this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

  if (!this.room) {
    this.scene.start("join");
    return;
  }

  this.cursors = this.input.keyboard?.createCursorKeys();
  this.driveKeys = this.bindDriveKeys();
  this.keys = this.bindKeys();
  this.slotKeys = this.bindSlotKeys();
  this.pauseKey = this.bindPauseKey();
  this.input.mouse?.disableContextMenu();

  const arenaId = this.room.state.arenaId;
  if (!isArenaId(arenaId)) {
    const message = arenaMismatchMessage(arenaId, ARENA_IDS);
    this.mismatchOverlay = new ScreenOverlay(this);
    this.mismatchOverlay.render(renderArenaMismatch(message));
    console.error(`[arena] ${message}`);
    return;
  }

  this.arena = getArena(arenaId);
  this.net = new ArenaNet(this.arena, this.room.sessionId);
  this.net.seed(this.room.state);

  // Before any object exists, so every renderer can register against the HUD camera.
  this.layers = new ArenaLayers(this);
  const staticCamera = this.drawArena(this.arena);
  this.spectate = new SpectateCamera(this, this.keys, this.cursors);
  this.spectate.setStatic(staticCamera);
  this.carRenderer = new CarRenderer(this, this.layers, this.debug);
  this.shotRenderer = new ShotRenderer(this, this.layers, this.debug);
  this.hudRenderer = new HudRenderer(this, this.layers);
  this.banners = new MatchBanners(this, this.layers);

  this.bindRoom(this.room);
  this.syncBanners(this.room);
}
```

`drawArena` keeps its body (`ArenaScene.ts:927-960`) and now returns the boolean it used to store: replace `this.staticCamera = fitsViewport(arena, { width: ARENA_VIEW_WIDTH, height: VIEW_HEIGHT }, CAMERA_CONFIG.zoom);` with `const staticCamera = fitsViewport(arena, { width: ARENA_VIEW_WIDTH, height: VIEW_HEIGHT }, CAMERA_CONFIG.zoom);`, keep the following `if (staticCamera) cam.centerOn(...)`, end with `return staticCamera;`, change the signature to `private drawArena(arena: ArenaDef): boolean`, and wrap the `this.add.graphics()` call in `this.layers!.world(...)` (the layers exist by then; throw if not, since `create` constructs them first).

- [ ] **Step 4: Rewrite `update`**

```ts
update(_time: number, delta: number): void {
  const room = this.room;
  const net = this.net;
  if (!room || !this.arena || !net) return;

  this.syncBanners(room);
  this.pumpPauseKey(room);
  const pumped = net.pumpInput(room.state, delta, () => this.sampleInput(), (msg) =>
    room.send(INPUT_MESSAGE, msg),
  );
  if (pumped.activeInput) this.banners?.hideIdleWarning();

  const frame = net.frame(room.state, performance.now(), this.time.now);
  this.lastFrame = frame;
  this.spectate?.update(frame, delta);
  const cameraTarget = this.spectate?.cameraTarget(frame) ?? frame.localSessionId;
  const departed = this.carRenderer?.render(frame, cameraTarget) ?? [];
  for (const sid of departed) net.forgetRemote(sid);
  // Deliberate reorder: the old `renderCars` followed the camera from inside its car loop; the
  // frame already holds every render pose, so the follow happens once, after the loop, in the
  // same frame. `centerOn` before the render submit is what the camera sees either way.
  const target = carOf(frame, cameraTarget);
  if (target) this.spectate?.follow(target.pose, delta);
  this.shotRenderer?.render(frame);
  this.hudRenderer?.render(frame, this.spectate?.hudTarget(frame) ?? frame.localSessionId);
}

private sampleInput(): RawInput {
  return {
    steer: axisOf(
      (this.cursors?.left.isDown ?? false) || (this.driveKeys?.left.isDown ?? false),
      (this.cursors?.right.isDown ?? false) || (this.driveKeys?.right.isDown ?? false),
    ),
    throttle: axisOf(
      (this.cursors?.down.isDown ?? false) || (this.driveKeys?.down.isDown ?? false),
      (this.cursors?.up.isDown ?? false) || (this.driveKeys?.up.isDown ?? false),
    ),
    fireSlots: slotMaskFrom(
      this.slotKeys?.map((keys) => keys.some((key) => key.isDown)) ?? [],
      this.input.mousePointer?.buttons ?? 0,
    ),
  };
}

private syncBanners(room: Room<ArenaState>): void {
  const net = this.net;
  if (!net || !this.banners || !this.spectate) return;
  const frame = net.frame(room.state, performance.now(), this.time.now);
  this.banners.sync(frame, this.spectate.view(frame));
}
```

Copy the three `axisOf`/`slotMaskFrom` expressions and their comments from the old `sendInputTick` (`1325-1364`) into `sampleInput` unchanged.

- [ ] **Step 5: Rewrite `bindRoom`'s `onState` and the idle warning**

```ts
const onState = (): void => {
  this.net?.onPatch(room.state, performance.now());
  this.syncBanners(room);
  this.syncPauseOverlay(room);
};
```

The old order was banners, reconcile, snapshots, pause overlay; the banners read only `room.state`, which the reconcile does not change, so syncing them after `onPatch` draws the same thing. `onIdleWarning` becomes `this.banners?.showIdleWarning(PRACTICE_CONFIG.idleWarningSeconds)`.

- [ ] **Step 6: Rewrite `resetMatchState`**

Keep `unbindAll()`, `arenaGfx`, `arena`, the key fields, `mismatchOverlay`, `pauseOverlay`, `pauseMenuShown`, `exitTarget` exactly as they were, and replace every moved line with:

```ts
this.carRenderer?.destroy();
this.carRenderer = undefined;
this.shotRenderer?.destroy();
this.shotRenderer = undefined;
this.hudRenderer?.destroy();
this.hudRenderer = undefined;
this.banners?.destroy();
this.banners = undefined;
this.spectate = undefined;
this.layers = undefined;
this.net = undefined;
this.lastFrame = emptyRenderFrame();
```

- [ ] **Step 7: Typecheck, test, build**

Run:

```bash
cd packages/client && npm run typecheck
cd ../.. && npm run build -w @motor-combat-moba/shared && npm test
npm run build
wc -l packages/client/src/scenes/ArenaScene.ts
```

Expected: typecheck clean; every suite green; the build succeeds; `ArenaScene.ts` under 700 lines.

- [ ] **Step 8: Manual smoke in the browser**

Run `npm run dev`, open `http://localhost:5173`, click Practice, click Start, drive for ten seconds, fire each slot, die or let the bot die, and confirm: the car moves on the key press, the bot glides, shots draw, the HUD ring sweeps, the roster shows both names, the countdown and banners appear, `?debug=1` shows hitboxes, and the browser console shows no errors. Task 10 automates the first and last of these.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/scenes/ArenaScene.ts
git commit -m "refactor(client): ArenaScene composes ArenaNet and the renderers through a RenderFrame"
```

---

### Task 10: Browser smoke check

**Files:**
- Create: `scripts/smoke-arena.mjs`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: the built client and server; `ArenaScene.net.predictedPose` (Task 3, Task 9) via `window.game`.
- Produces: `npm run smoke:arena`, exit 0 on success.

- [ ] **Step 1: Add the dependency and the script**

In root `package.json`, add `"playwright": "1.62.1"` to `devDependencies` and `"smoke:arena": "npm run build && node scripts/smoke-arena.mjs"` to `scripts`. Run `npm install`. In this environment `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` are preset; on another machine run `npx playwright install chromium` once.

- [ ] **Step 2: Write the script**

```js
// scripts/smoke-arena.mjs
// Boots the built server, opens the built client in headless Chromium, starts a practice match,
// holds the throttle, and asserts the local car moved and no error reached the console. This is
// the only automated behaviour check for `ArenaScene`, which vitest cannot load (it imports
// Phaser). Run with `npm run smoke:arena`; set SMOKE_CHROMIUM to a browser path if Playwright's
// bundled one is missing.
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 2599;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function fail(message) {
  console.error(`[smoke] ${message}`);
  process.exitCode = 1;
}

const server = spawn(process.execPath, ["packages/server/dist/index.js"], {
  env: { ...process.env, DEPLOY_MODE: "lan", PORT: String(PORT), CLIENT_ORIGIN: ORIGIN },
  stdio: ["ignore", "inherit", "inherit"],
});

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${ORIGIN}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not answer /health within 10 s");
}

try {
  await waitForHealth();
  const browser = await chromium.launch({
    executablePath: process.env.SMOKE_CHROMIUM,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });

  await page.goto(`${ORIGIN}/`);
  await page.getByRole("button", { name: "Practice" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(() => window.game?.scene.isActive("arena") === true, null, {
    timeout: 30_000,
  });
  // Let the first patches land so prediction has a car to seed from.
  await page.waitForTimeout(1_000);

  const poseOf = () =>
    page.evaluate(() => {
      const scene = window.game.scene.getScene("arena");
      const pose = scene.net?.predictedPose;
      return pose ? { x: pose.x, y: pose.y } : null;
    });

  const before = await poseOf();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1_500);
  await page.keyboard.up("ArrowUp");
  const after = await poseOf();

  if (!before || !after) fail(`no predicted pose (before=${JSON.stringify(before)}, after=${JSON.stringify(after)})`);
  else {
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    if (moved < 20) fail(`car moved only ${moved.toFixed(1)} u under throttle`);
    else console.log(`[smoke] car moved ${moved.toFixed(1)} u under throttle`);
  }
  if (errors.length > 0) fail(`browser errors:\n  ${errors.join("\n  ")}`);
  else console.log("[smoke] no browser errors");

  await browser.close();
} catch (error) {
  fail(String(error));
} finally {
  server.kill();
}
```

- [ ] **Step 3: Run it**

Run: `npm run smoke:arena`
Expected: `[smoke] car moved ... u under throttle` and `[smoke] no browser errors`, exit 0. If Chromium cannot create a WebGL context under software rendering, Phaser's `AUTO` falls back to Canvas and the check still runs; if it cannot launch at all, set `SMOKE_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (or the path `ls /opt/pw-browsers` shows).

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-arena.mjs package.json package-lock.json
git commit -m "test(client): Playwright smoke check drives a practice match in the built client"
```

---

### Task 11: Documentation

**Files:**
- Modify: `packages/client/CLAUDE.md`
- Modify: `docs/project-structure.md`
- Modify: `docs/networking.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: `packages/client/CLAUDE.md`**

Replace the paragraph beginning "`ArenaScene` emits one `InputMessage` per `MS_PER_TICK`" with:

```markdown
`ArenaScene` is a composer. Its net half is `match/arena-net.ts` (`ArenaNet`): it emits one
`InputMessage` per `MS_PER_TICK` (not per frame), predicts the driven car through shared `stepSim`
via `PredictionBuffer`, reconciles against each state patch, interpolates remotes through
`InterpolationBuffer`, and builds one `RenderFrame` (`match/render-frame.ts`) per frame through
`match/frame-builder.ts`. Its render half is the classes under `scenes/arena/` — `CarRenderer`,
`ShotRenderer`, `HudRenderer`, `MatchBanners`, `SpectateCamera` — which draw that frame and
never read the schema. `ArenaLayers` is the two-camera split as a registry: every object a
renderer creates goes through `layers.world(obj)` or `layers.hud(obj)`. See
[`docs/networking.md`](../../docs/networking.md). Nothing under `match/` may import Phaser;
`npm run smoke:arena` is the behaviour check for the Phaser-bound half.
```

- [ ] **Step 2: `docs/project-structure.md`**

Under `packages/client/src/`, add a `match/` entry before `net/` and an `arena/` entry under `scenes/`:

```text
        ├── match/
        │   ├── render-frame.ts     # the RenderFrame contract between the net and render halves (N23/N23a)
        │   ├── frame-builder.ts    # bodyOf + buildRenderFrame: fills a frame from the Colyseus schema
        │   └── arena-net.ts        # ArenaNet: input pacing, prediction, reconcile, interpolation; no Phaser
```

```text
        │   ├── arena/
        │   │   ├── arena-layers.ts     # the two-camera split as a per-object registry
        │   │   ├── hitbox-toggle.ts    # debug flag OR the playground's live toggle
        │   │   ├── car-renderer.ts     # cars, hp bars, lock bracket, countdown arrow, maneuver ghosts, sparks
        │   │   ├── shot-renderer.ts    # weapon instances and charge orbs
        │   │   ├── hud-renderer.ts     # slot bar, status strip, roster panel, every HUD constant
        │   │   ├── match-banners.ts    # countdown, spectate, clock, killed-by, respawn, idle-warning, movement hint
        │   │   └── spectate-camera.ts  # spectate target, free roam, camera follow and pan
```

- [ ] **Step 3: `docs/networking.md` and `docs/architecture.md`**

Apply these replacements, then grep both files for any remaining `ArenaScene.` member reference and rename it to the class that owns it now:

| Old text | New text |
|---|---|
| `` `ArenaScene` accumulates frame `delta` and emits exactly one input per `MS_PER_TICK` `` | `` `ArenaNet.pumpInput` (owned by `ArenaScene`) accumulates frame `delta` and emits exactly one input per `MS_PER_TICK` `` |
| `` `ArenaScene.localRenderPose` therefore draws `` | `` `ArenaNet.localRenderPose` therefore draws `` |
| `` The **mover** half — whether the local player's inputs move anything — is `ArenaScene.canDrive` `` | `` The **mover** half — whether the local player's inputs move anything — is `ArenaNet.canDrive` `` |
| `` `ArenaScene` draws `state.weapons` (projectile and beam instances alike) `` | `` `ShotRenderer` draws the frame's instances (projectile and beam instances alike) `` |
| architecture.md: `` `ArenaScene` emits one `InputMessage` per `MS_PER_TICK`, predicts the local car through the *same* `stepSim`, reconciles against each patch by replay, and interpolates remotes. `` | `` `ArenaScene` owns an `ArenaNet` that emits one `InputMessage` per `MS_PER_TICK`, predicts the local car through the *same* `stepSim`, reconciles against each patch by replay, interpolates remotes, and hands the renderers one `RenderFrame` per frame. `` |

- [ ] **Step 4: Run the doc-backed tests and commit**

Run: `npm run test:scripts`
Expected: PASS (no script test parses these pages, so this confirms nothing else broke).

```bash
git add packages/client/CLAUDE.md docs/project-structure.md docs/networking.md docs/architecture.md
git commit -m "docs(client): describe the ArenaNet / RenderFrame / renderer split"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

---

## Self-review

**Spec coverage.** Decision 10 asks for three things: the mechanical split (Tasks 3, 5–9), the `RenderFrame` and event interfaces (Task 1), and a stub that fills them from today's schema (Task 2). N23's module list names `frame.ts` producing a `RenderFrame` — here that is `ArenaNet.frame` over `frame-builder.ts`, and the remaining N23 modules (clock, lead, codec, resim) belong to later netcode phases, not this plan. The rendering spec's R20 (HUD as its own scene) is deliberately not done here; `HudRenderer` and `MatchBanners` are the units that scene will absorb.

**Placeholder scan.** Tasks 5–8 move bodies by line range with substitution tables rather than reprinting two thousand lines; every substitution names the exact old and new expression. No "TBD", no "handle edge cases".

**Type consistency.** `RenderCar.pose`/`serverPose` (Task 1) are what `CarRenderer` (Task 5) and `ShotRenderer` (Task 6) read; `poseFor`'s signature in Task 3 matches the `poseOf` callback in Task 2; `PumpResult.activeInput` (Task 3) is what Task 9's `update` checks; `SpectateView` (Task 8) is what `MatchBanners.sync` takes; `carOf` (Task 1) is used by Tasks 5, 7, 8 and 9 with the same signature; `hitboxesVisible(debug)` (Task 4) is called that way in Tasks 5 and 6; `scene.net.predictedPose` (Task 10) is the getter defined in Task 3 on the field named in Task 9.
