# Phase 3 — Scopes installed

**Goal:** Every room runs inside its own mode's bundle, `cfg()` genuinely throws outside a scope,
and two modes tick correctly side by side in one process (G2).

**Precondition:** phase 2 complete, suite green.

---

### Task 1: The server scope helper and `ArenaRoom`

**Files:**
- Create: `packages/server/src/rooms/mode-scope.ts`
- Modify: `packages/server/src/rooms/ArenaRoom.ts`
- Test: `packages/server/src/rooms/mode-scope.test.ts`

**Interfaces:**
- Produces: `scoped<T>(config: ModeConfig, fn: () => T): T` — a re-export of shared's `withMode`
  with a server-side name, so a reader of a room file sees one obvious wrapper.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameMode, modeConfigOf } from "@motor-combat-moba/shared";
import { scoped } from "./mode-scope.js";

describe("scoped", () => {
  it("is synchronous and refuses a promise-returning callback", () => {
    assert.throws(() => scoped(modeConfigOf(GameMode.FFA_LAST_STANDING),
      (() => Promise.resolve(1)) as never), /synchronous/);
  });
});
```

`withMode` returning a promise would restore the pointer before the awaited work ran — the exact
interleaving MC11 forbids. Refuse it loudly rather than documenting it.

- [ ] **Step 2: Run — FAIL. Implement `scoped` with a `instanceof Promise` guard on the result.**

- [ ] **Step 3: Wrap every `ArenaRoom` entry point**

`onCreate`, `onJoin`, `onLeave`, every `onMessage` handler, and the `setSimulationInterval`
callback. `this.modeConfig` is resolved from `state.mode` and re-resolved on `MSG_SET_MODE`
**while `phase === RoomPhase.LOBBY`**, then frozen for the match (MC21) — car select must already
show that mode's roster.

- [ ] **Step 4: Build, run the server suite, commit**

```bash
npm run build && npm test -w @motor-combat-moba/server
git commit -am "feat(server): ArenaRoom runs inside its mode's bundle (MC15, MC21)"
```

---

### Task 2: `PracticeRoom` and `PlaygroundRoom`

**Files:**
- Modify: `packages/server/src/rooms/PracticeRoom.ts`, `PlaygroundRoom.ts`

- [ ] **Step 1: Resolve once at creation and wrap every entry point**

`PracticeRoom` keeps its `GameMode.FFA_DEATHMATCH` pin and `matchEndsTick` 0 (MC22) — do not change
the pin, it would change behaviour. `PlaygroundRoom` resolves `DEFAULT_GAME_MODE` for now; phase 5
gives it an ad-hoc bundle.

- [ ] **Step 2: Build, run the server suite, commit**

```bash
git commit -am "feat(server): practice and playground rooms carry their own bundle"
```

---

### Task 2b: Per-mode bot config, server-side (MC29)

**Files:**
- Create: `packages/server/src/config/mode-bot.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`, `view-ring.ts`, `bot/index.ts`
- Test: `packages/server/src/config/mode-bot.test.ts`

**Interfaces:**
- Produces: `BotModeConfig`, `MODE_BOT_CONFIG`, `botConfigOf(mode)` — exact shapes in
  `interfaces.md`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameMode } from "@motor-combat-moba/shared";
import { botConfigOf, MODE_BOT_CONFIG } from "./mode-bot.js";

describe("MODE_BOT_CONFIG", () => {
  it("carries a row for every game mode", () => {
    for (const mode of Object.values(GameMode).filter((v) => typeof v === "number")) {
      assert.ok(botConfigOf(mode as GameMode));
    }
  });

  it("seeds every mode identically for now (spec N2)", () => {
    const first = botConfigOf(GameMode.FFA_LAST_STANDING);
    for (const row of Object.values(MODE_BOT_CONFIG)) {
      assert.deepEqual(row.profiles, first.profiles);
      assert.equal(row.brainVersion, first.brainVersion);
    }
  });
});
```

- [ ] **Step 2: Run — FAIL, module missing.**

- [ ] **Step 3: Implement `mode-bot.ts`**

`BOT_PROFILES`, `BRAIN_CONSTANTS` and `BOT_BRAIN_VERSION` stay where they are in
`config/bot-profiles.ts` — this file wraps them into one row per `GameMode`, every row pointing at
the same values. **Do not move bot code into shared** (MC29): `ModeConfig` lives in shared and
dragging `BotProfile` across the package boundary would put server-only tuning in the client bundle.

- [ ] **Step 4: Thread the mode through the bot's construction**

`BotController` takes `botConfigOf(room.state.mode)` rather than importing `BOT_PROFILES` directly.
`view-ring.ts`'s `Math.max(...Object.values(BOT_PROFILES)...)` becomes a function of the passed
config rather than a module read.

- [ ] **Step 5: Run the test and the server suite — PASS, and `BOT_BRAIN_VERSION` does NOT change,
      because no behaviour moved. Commit.**

```bash
git commit -am "feat(server): per-mode bot config rows, all seeded identically (MC29)"
```

---

### Task 3: Remove the scaffolding; `cfg()` starts throwing

**Files:**
- Modify: `packages/shared/src/modes/registry.ts` — delete the `installMode(...)` call
- Create: `packages/shared/src/modes/test-setup.ts`
- Modify: every suite that now reads config outside a scope

**Interfaces:**
- Produces: `withDefaultMode<T>(fn: () => T): T` — a test helper wrapping `DEFAULT_GAME_MODE`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { cfg, hasMode } from "./active.js";

describe("cfg outside a scope (MC12)", () => {
  it("throws rather than serving a default mode's numbers", () => {
    expect(hasMode()).toBe(false);
    expect(() => cfg()).toThrow(/outside a mode scope/);
  });
});
```

This test must run in a file with no `installMode` in its setup — give it its own vitest file so no
sibling's setup leaks in.

- [ ] **Step 2: Delete the `installMode` call; run the full suite and expect many failures**

That is the expected intermediate state. Work through them: each failing test gains
`withDefaultMode(() => { ... })` around its body, or installs a specific mode where the test is
about a mode.

- [ ] **Step 3: Full suite green, commit**

```bash
npm run build && npm test
git commit -am "feat(shared): cfg() throws outside a mode scope (MC12)"
```

---

### Task 4: An unknown mode off the wire (Review Focus #1)

**Files:**
- Modify: `packages/shared/src/modes/registry.ts`
- Test: `packages/shared/src/modes/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("refuses an unknown mode at the boundary rather than throwing in a tick", () => {
  // An old client, or a mode deleted between builds, can put any uint8 in state.mode.
  expect(modeConfigOrDefault(99 as GameMode).id).toBe(DEFAULT_GAME_MODE);
  expect(modeConfigOrDefault(GameMode.FFA_DEATHMATCH).id).toBe(GameMode.FFA_DEATHMATCH);
});
```

- [ ] **Step 2: Run — FAIL. Add `modeConfigOrDefault(mode)`: returns the row's config when
      `isGameMode(mode)`, else logs once and returns `DEFAULT_GAME_MODE`'s.**

`modeConfigOf` keeps throwing — it is the programmer-facing accessor. `modeConfigOrDefault` is what
rooms call on a wire value. Using the throwing one at a room boundary is what would kill a live room.

- [ ] **Step 3: Repoint every room's resolution at `modeConfigOrDefault`. Build, suite, commit.**

```bash
git commit -am "fix(shared): an unknown wire mode falls back instead of killing the room"
```

---

### Task 5: The client installs its room's bundle (Review Focus #5)

**Files:**
- Create: `packages/client/src/net/mode-scope.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts`, the prediction path,
  `packages/client/src/config/slot-keys.ts`
- Test: `packages/client/src/net/mode-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("re-installs when the host changes mode in the lobby", () => {
  installRoomMode(GameMode.FFA_LAST_STANDING);
  const before = runInRoomMode(() => drive().baseMaxSpeed);
  installRoomMode(GameMode.FFA_DEATHMATCH);
  const after = runInRoomMode(() => drive().baseMaxSpeed);
  expect(after).toBe(modeConfigOf(GameMode.FFA_DEATHMATCH).drive.baseMaxSpeed);
  expect(before).toBe(modeConfigOf(GameMode.FFA_LAST_STANDING).drive.baseMaxSpeed);
});
```

A stale client bundle would offer the previous mode's roster in car select and diverge the
prediction half of the lockstep from the server's — a desync that reads as rubber-banding.

- [ ] **Step 2: Implement; subscribe to `state.mode` changes via Colyseus's `listen`.**

- [ ] **Step 3: Convert `HINT_SLOT_ORDER` from a module-load const to a function (MC8).**

- [ ] **Step 4: Build, run the client suite, commit**

```bash
git commit -am "feat(client): install the room's mode bundle, re-install on mode change (MC16)"
```

---

### Task 5b: Convert the 108 raw config reads outside `shared/src/sim`

**Added after phase 1, per controller Ruling 13. Without this, phase 3 delivers a scope that
nothing reads through — a no-op that looks like success.**

**The problem in one sentence:** once a room ticks inside `withMode(deathmatchConfig, …)`, a raw
`RAM_CONFIG.minRamSpeed` in `packages/server/src/sim/ram-bridge.ts` still returns the SHIPPED value,
so Deathmatch would run half its own numbers and half Brawl's, with nothing failing.

**Files:** 38 across two packages, 108 reads. The 36 that run inside the server tick are the
blocking ones and go first:
- `packages/server/src/sim/` — `ram-bridge.ts` (7), `tick.ts` (6), `spike-bridge.ts` (5)
- `packages/server/src/bot/brain/` — `planner.ts` (5), `objectives.ts` (2), `movement.ts` (2),
  `firing.ts` (2), `perception.ts` (1), `personality.ts` (1), `controller.ts` (1)
- `packages/server/src/rooms/` — `tick-pipeline.ts` (2), `ArenaRoom.ts` (1), `PracticeRoom.ts` (1)

The remaining 72 are client rendering, HUD and dev tooling — visual correctness rather than sim
correctness, but they must match the mode the player is in:
- `scenes/` — `ArenaScene.ts` (11), `combat-visual.ts` (8), `movement-hint.ts` (2),
  `impact-feedback.ts` (2), `weapon-hud.ts` (1), `status-hud.ts` (1), `deathmatch-hud.ts` (1)
- `ui/` — `car-select-view.ts` (5), `lobby-view.ts` (2), `screens/practice-setup.ts` (1)
- `fx/` — `occlusion.ts` (2), `table.ts` (1), `environment.ts` (1), `decals.ts` (1), `contact.ts` (1)
- `config/` — `slot-keys.ts` (4), `turret-visual.ts` (2), `aim-hud.ts` (1)
- `input/aim-offset.ts` (3)
- `dev/` — `FxPreviewScene.ts` (6), `AssetTuningScene.ts` (4), `playground/ui-model.ts` (5),
  `playground/turret-model.ts` (3), `playground/car-panel.ts` (3), `playground/storage.ts` (1)

- [ ] **Step 1: Convert the 36 server-tick reads first, and run the server suite.**

Same substitution table as phase 1 Task 4: `RAM_CONFIG.x` → `ram().x`, and so on, importing the
accessors from `@motor-combat-moba/shared`.

- [ ] **Step 2: Judge the `dev/playground/` reads separately — they are NOT all defects.**

Those panels BUILD the tuning UI: they read shipped defaults to populate sliders and to show what a
knob's un-overridden value is. A read there may be correct as a raw read. Decide each on its merits
and say which you kept and why. Converting one that should stay raw would make the panel display
the override as though it were the default.

- [ ] **Step 3: Extend the guard test to both packages.**

Generalise `packages/shared/src/modes/no-raw-config-in-sim.test.ts` to walk `packages/client/src`
and `packages/server/src` as well, with an explicit allow-list for the `dev/playground/` reads Step
2 judged legitimate. The allow-list is the record of that judgement — each entry carries a one-line
reason.

- [ ] **Step 4: Full root suite green, commit.**

---

### Task 6: Two modes in one process (G2)

**Files:**
- Test: `packages/shared/src/modes/concurrency.test.ts`

- [ ] **Step 1: Write the test — this is the phase's reason for existing**

```ts
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { stepSim } from "../sim/step.js";
import { withMode } from "./active.js";
import { modeConfigOf } from "./registry.js";

const SLOW = modeConfigOf(GameMode.FFA_LAST_STANDING);
const FAST = modeConfigOf(GameMode.FFA_DEATHMATCH);

function run(config, ticks: number) {
  return withMode(config, () => {
    let body = { x: 100, y: 100, angle: 0, vx: 0, vy: 0, angVel: 0,
                 maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0 };
    for (let i = 0; i < ticks; i += 1) body = stepSim(body, THROTTLE_INPUT, CONTEXT);
    return body;
  });
}

describe("two modes in one process (G2)", () => {
  it("gives each mode the same result interleaved as it does alone", () => {
    const aloneSlow = run(SLOW, 30);
    const aloneFast = run(FAST, 30);

    // Interleave one tick at a time, the way two rooms on one server actually run.
    let slow = FRESH_BODY, fast = FRESH_BODY;
    for (let i = 0; i < 30; i += 1) {
      slow = withMode(SLOW, () => stepSim(slow, THROTTLE_INPUT, CONTEXT));
      fast = withMode(FAST, () => stepSim(fast, THROTTLE_INPUT, CONTEXT));
    }
    expect(slow).toEqual(aloneSlow);
    expect(fast).toEqual(aloneFast);
  });
});
```

Give `FAST` a distinctly different `baseMaxSpeed` via a local `assembleModeConfig` if both shipped
modes still carry identical drive numbers — the test is worthless if the two bundles agree.

- [ ] **Step 2: Run — expect PASS. Commit.**

```bash
git commit -am "test(shared): two modes interleave correctly in one process (G2)"
```

- [ ] **Step 3: Mark phase 3 done in `EXECUTION.md`, set Next to Phase 4 Task 1, commit.**
