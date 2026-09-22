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
