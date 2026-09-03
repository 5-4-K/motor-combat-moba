# Practice Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player-facing Practice mode in the release build — a Practice button on the join screen, a settings page (my car, enemy car, difficulty), then the real game 1v1 against a bot with a pause menu and a session summary.

**Architecture:** A third Colyseus room type, `PracticeRoom`, registered unconditionally beside the singleton `arena`, running the already-extracted `runPipeline` and the deathmatch respawn helpers verbatim. `PracticeState extends ArenaState` adding one field (`paused`). Settings arrive as join options, not messages. `ArenaScene` renders it as an ordinary match because the state decodes as one; its only addition is a pause menu gated on the room name.

**Tech Stack:** TypeScript, Colyseus (server rooms + `@colyseus/schema`), Phaser 3 (client), vitest (node env — never import Phaser in a test).

**Spec:** `docs/superpowers/specs/2026-09-03-practice-mode-design.md` (decisions PR1–PR31 — read it first; every task cites it).

## Global Constraints

- **Run `npm install` at the repo root before the first build.** This checkout has no `node_modules`. In a worktree this is mandatory — see the worktree gotcha in `CLAUDE.md`; skipping it silently inlines the main checkout's shared `dist`.
- Verify with **root** `npm test` (per-workspace runs silently skip suites) and root `npm run build` (**never** `npm run build --workspaces` — the server's tsup step inlines shared's `dist`, so build order matters).
- After editing anything in `packages/shared/src`, rebuild shared (`npm run build -w @motor-combat-moba/shared`) before running server code. Unit tests import `src` and do not need it.
- Existing suites must stay green **without edits**, `golden.test.ts` above all. The single planned exception is the bot-profile test's `easy`/`medium` rows in Task 4. If a task breaks any other test, the task is wrong, not the test.
- **`PracticeRoom` never imports or calls `setTuning`** (PR10). This is the hard rule the design rests on.
- No magic numbers in logic (invariant 2) — new knobs go in `PRACTICE_CONFIG`.
- Enum uint8 wire values are never renumbered; no existing schema field changes (invariants 7, 8).
- Clients send inputs, never authoritative state (invariant 3).
- Do **not** create or modify anything in `packages/server/playtest/`. Do **not** run `npm run build:manual` — no table this plan touches is in `balanceStamp`.
- Do **not** read anything under `docs/ideas/` or `docs/invariants/`.
- Commit after every task. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VLH4CipnVq2P9v6zck9akC
  ```
- Working branch: `claude/brainstorm-idea-wgnwyy` (current). Never touch `master`. "main" means `development/main`.

## File Structure (locked in)

```
packages/shared/src/config/practice-config.ts        (new) PRACTICE_CONFIG: idle + cap knobs
packages/shared/src/net/practice-messages.ts         (new) PRACTICE_ROOM_NAME, MSG_PRACTICE_*, PracticeSetup + guard
packages/shared/src/schema/PracticeState.ts          (new) ArenaState + paused
packages/server/src/rooms/bot.ts                     (moved from playground-bot.ts) botInput + BotProfile
packages/server/src/config/bot-profiles.ts           (new) BOT_PROFILES table
packages/server/src/rooms/practice-rules.ts          (new) pure rules: cap, opponent resolution, idle
packages/server/src/rooms/PracticeRoom.ts            (new) the room
packages/client/src/practice/storage.ts              (new) localStorage codec for setup (tested)
packages/client/src/ui/screens/practice-setup.ts     (new) settings screen (tested)
packages/client/src/ui/screens/pause.ts              (new) pause menu screen (tested)
packages/client/src/ui/screens/practice-summary.ts   (new) session summary rows (tested)
packages/client/src/scenes/PracticeSetupScene.ts     (new) thin scene shell
packages/client/src/scenes/PracticeSummaryScene.ts   (new) thin scene shell
```

Modified: `shared/src/index.ts`, `server/src/index.ts`, `server/src/mode.ts`,
`server/src/rooms/PlaygroundRoom.ts`, `server/src/rooms/singleton-arena.ts`,
`client/src/net/connection.ts`, `client/src/ui/screens/join.ts`, `client/src/scenes/JoinScene.ts`,
`client/src/scenes/ArenaScene.ts`, `client/src/scenes/controlled-car.ts`, `client/src/main.ts`,
`CLAUDE.md`, `docs/project-structure.md`, `docs/schema-reference.md`, `docs/config-reference.md`.

---

### Task 1: `PRACTICE_CONFIG` and the practice message module (spec PR7, PR8, PR15, PR31)

**Files:**
- Create: `packages/shared/src/config/practice-config.ts`
- Create: `packages/shared/src/net/practice-messages.ts`
- Create: `packages/shared/src/net/practice-messages.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `isActiveCarId`, `activeCarIds`, `DEFAULT_CAR_ID` from `config/car-config.js`; `isBotDifficulty`, `BotDifficulty` from `net/playground-messages.js`.
- Produces:
  - `PRACTICE_CONFIG: { idleTimeoutSeconds: 300; idleWarningSeconds: 60; maxConcurrentRooms: 6 }`
  - `PRACTICE_ROOM_NAME = "practice"`
  - **Not** a new bot session id: reuse shared's existing `BOT_SESSION_ID`. Two constants with the
    same value is one too many. Note that `BOT_SESSION_ID`, `BotDifficulty` and `isBotDifficulty`
    still live in `net/playground-messages.ts` even though they are now shared bot vocabulary —
    renaming that module is explicitly **out of scope** for this plan.
  - `MSG_PRACTICE_PAUSE = "pr_pause"`, `MSG_PRACTICE_IDLE_WARNING = "pr_idle_warn"`
  - `PRACTICE_IDLE_CLOSE_CODE = 4006`, `PRACTICE_FULL_CLOSE_CODE = 4007`, `PRACTICE_FULL_ERROR`, `PRACTICE_IDLE_ERROR`
  - `type PracticeOpponent = CarId | "random"`
  - `interface PracticeSetup { name: string; carId: CarId; opponentCarId: PracticeOpponent; difficulty: BotDifficulty }`
  - `isPracticeSetup(msg: unknown): msg is PracticeSetup`
  - `defaultPracticeSetup(): PracticeSetup`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/net/practice-messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultPracticeSetup, isPracticeSetup } from "./practice-messages.js";

const valid = { name: "Riku", carId: "mirage", opponentCarId: "random", difficulty: "medium" };

describe("isPracticeSetup", () => {
  it("accepts a well-formed setup", () => {
    expect(isPracticeSetup(valid)).toBe(true);
  });

  it("accepts an explicit active opponent chassis", () => {
    expect(isPracticeSetup({ ...valid, opponentCarId: "bastion" })).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isPracticeSetup(null)).toBe(false);
    expect(isPracticeSetup("mirage")).toBe(false);
  });

  it("rejects an unknown or inactive chassis on either side", () => {
    expect(isPracticeSetup({ ...valid, carId: "nope" })).toBe(false);
    expect(isPracticeSetup({ ...valid, opponentCarId: "nope" })).toBe(false);
  });

  it("rejects a prototype-chain name as a chassis", () => {
    expect(isPracticeSetup({ ...valid, carId: "toString" })).toBe(false);
    expect(isPracticeSetup({ ...valid, opponentCarId: "constructor" })).toBe(false);
  });

  it("rejects an unknown difficulty", () => {
    expect(isPracticeSetup({ ...valid, difficulty: "nightmare" })).toBe(false);
  });

  it("rejects a non-string or over-long name", () => {
    expect(isPracticeSetup({ ...valid, name: 7 })).toBe(false);
    expect(isPracticeSetup({ ...valid, name: "x".repeat(17) })).toBe(false);
  });

  it("accepts an empty name — the client's 'Player' fallback is a client concern (PR20)", () => {
    expect(isPracticeSetup({ ...valid, name: "" })).toBe(true);
  });

  it("round-trips its own default", () => {
    expect(isPracticeSetup(defaultPracticeSetup())).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/shared/src/net/practice-messages.test.ts`
Expected: FAIL — cannot resolve `./practice-messages.js`.

- [ ] **Step 3: Write `practice-config.ts`**

```ts
/**
 * Practice-mode session limits (spec PR26–PR31). Not balance: these bound what one host PC spends
 * on sandboxes nobody is sitting at, and they live here rather than as literals in the room because
 * invariant 2 admits no exceptions for "it's only a timeout".
 */
export const PRACTICE_CONFIG = {
  /** Wall-clock seconds without an input before the room closes itself (PR27). */
  idleTimeoutSeconds: 300,
  /** Seconds of that timeout remaining when the player is warned (PR28). */
  idleWarningSeconds: 60,
  /**
   * How many practice rooms may exist at once on one process (PR29). Six is the game's own player
   * ceiling, so no LAN scenario has more practising humans than a match could seat. Overridable by
   * environment through `getMaxPracticeRooms` in the server's `mode.ts`.
   */
  maxConcurrentRooms: 6,
} as const;
```

- [ ] **Step 4: Write `practice-messages.ts`**

```ts
import { activeCarIds, isActiveCarId } from "../config/car-config.js";
import { FLOW_CONFIG } from "../config/flow-config.js";
import type { CarId } from "../config/types.js";
import { isBotDifficulty, type BotDifficulty } from "./playground-messages.js";

/** Room name, registered on EVERY process — practice ships (spec PR3). */
export const PRACTICE_ROOM_NAME = "practice";

export const MSG_PRACTICE_PAUSE = "pr_pause"; // no payload: toggle
export const MSG_PRACTICE_IDLE_WARNING = "pr_idle_warn"; // no payload: server -> client

/**
 * Close codes, continuing the room-defined 4000+ block (4000 bad name, 4001 taken name, 4002 kicked,
 * 4003 second arena, 4004 arena busy, 4005 playground busy). The two are NOT interchangeable —
 * 4007 refuses a join the player never left the setup screen for, 4006 ends a live session (PR25).
 */
export const PRACTICE_IDLE_CLOSE_CODE = 4006;
export const PRACTICE_FULL_CLOSE_CODE = 4007;

export const PRACTICE_IDLE_ERROR = "Practice session ended — no input for a while";
export const PRACTICE_FULL_ERROR = "Too many practice sessions are running right now";

/** An explicit active chassis, or "random" — resolved once, server-side, at room creation (PR15). */
export type PracticeOpponent = CarId | "random";

export interface PracticeSetup {
  name: string;
  carId: CarId;
  opponentCarId: PracticeOpponent;
  difficulty: BotDifficulty;
}

function isPracticeOpponent(value: unknown): value is PracticeOpponent {
  return value === "random" || isActiveCarId(value);
}

/**
 * Validates the join options off the wire (PR7).
 *
 * `isActiveCarId` rejects an id that exists only via the prototype chain ("toString"), and rejects
 * an inactive chassis — practice may never show one the live roster hides (PR15). An EMPTY name is
 * accepted on purpose: the "Player" fallback is applied client-side before the join (PR20), and the
 * server has no uniqueness rule to enforce here.
 */
export function isPracticeSetup(msg: unknown): msg is PracticeSetup {
  if (msg === null || typeof msg !== "object") return false;
  const rec = msg as Record<string, unknown>;
  return (
    typeof rec.name === "string" &&
    rec.name.length <= FLOW_CONFIG.nameMax &&
    isActiveCarId(rec.carId) &&
    isPracticeOpponent(rec.opponentCarId) &&
    isBotDifficulty(rec.difficulty)
  );
}

/** What the settings screen opens on before a player has ever chosen (PR21). */
export function defaultPracticeSetup(): PracticeSetup {
  return {
    name: "",
    carId: activeCarIds()[0]!,
    opponentCarId: "random",
    difficulty: "medium",
  };
}
```

- [ ] **Step 5: Export both from shared's barrel**

In `packages/shared/src/index.ts`, add beside the existing `playground-messages` and config exports:

```ts
export { PRACTICE_CONFIG } from "./config/practice-config.js";
export {
  MSG_PRACTICE_IDLE_WARNING,
  MSG_PRACTICE_PAUSE,
  BOT_SESSION_ID,
  PRACTICE_FULL_CLOSE_CODE,
  PRACTICE_FULL_ERROR,
  PRACTICE_IDLE_CLOSE_CODE,
  PRACTICE_IDLE_ERROR,
  PRACTICE_ROOM_NAME,
  defaultPracticeSetup,
  isPracticeSetup,
  type PracticeOpponent,
  type PracticeSetup,
} from "./net/practice-messages.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/shared/src/net/practice-messages.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Run the full suite and build**

Run: `npm test` then `npm run build`
Expected: both green. No existing test changes.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/config/practice-config.ts packages/shared/src/net/practice-messages.ts packages/shared/src/net/practice-messages.test.ts packages/shared/src/index.ts
git commit
```
Message: `feat(shared): practice mode config, room name and setup guard (PR7/PR31)`

---

### Task 2: `PracticeState` (spec PR6)

**Files:**
- Create: `packages/shared/src/schema/PracticeState.ts`
- Create: `packages/shared/src/schema/practice-state.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `ArenaState` from `schema/ArenaState.js`.
- Produces: `class PracticeState extends ArenaState { paused: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/schema/practice-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ArenaState } from "./ArenaState.js";
import { PracticeState } from "./PracticeState.js";

describe("PracticeState", () => {
  it("is an ArenaState, so a plain arena client decodes it", () => {
    expect(new PracticeState()).toBeInstanceOf(ArenaState);
  });

  it("starts unpaused", () => {
    expect(new PracticeState().paused).toBe(false);
  });

  it("adds exactly one field over ArenaState (PR6)", () => {
    const added = Object.keys(new PracticeState()).filter(
      (key) => !Object.keys(new ArenaState()).includes(key),
    );
    expect(added).toEqual(["paused"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/shared/src/schema/practice-state.test.ts`
Expected: FAIL — cannot resolve `./PracticeState.js`.

- [ ] **Step 3: Write `PracticeState.ts`**

```ts
import { type } from "@colyseus/schema";
import { ArenaState } from "./ArenaState.js";

/**
 * Practice-room state (spec PR6). Additive only: nothing here may renumber or touch a field
 * `ArenaState` already ships, because `ArenaScene` decodes this room with the ordinary arena schema
 * and rendering it as a normal match is the whole design.
 *
 * Exactly one field, and the omissions are deliberate. No `controlledSessionId` — the player always
 * drives their own car (PR12), so `controlledCarOf` resolves through its absent-field path. No
 * `tuningJson` (there is no tuning, PR10), no `botEnabled` (there is always a bot), no
 * `botDifficulty` — the client chose it and holds it, and networking it would be a second source of
 * a truth nothing on the wire reads.
 */
export class PracticeState extends ArenaState {
  /** The sim is frozen (PR13). `tick()` returns before incrementing `tick` while this is true. */
  @type("boolean") paused = false;
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, beside the `PlaygroundState` export:

```ts
export { PracticeState } from "./schema/PracticeState.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/shared/src/schema/practice-state.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Full suite + build**

Run: `npm test` then `npm run build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schema/PracticeState.ts packages/shared/src/schema/practice-state.test.ts packages/shared/src/index.ts
git commit
```
Message: `feat(shared): PracticeState extends ArenaState with one field (PR6)`

---

### Task 3: Promote the bot out of dev-only naming (spec PR17)

Pure refactor. No behaviour changes, no number changes. Every existing test stays green **unchanged** except for import paths.

**Files:**
- Create: `packages/server/src/config/bot-profiles.ts` (the `BOT_PROFILES` table + `BotProfile`)
- Rename: `packages/server/src/rooms/playground-bot.ts` → `packages/server/src/rooms/bot.ts` (keep `botInput`, `BotPose`, `pulsedFireSlots` and anything else it exports; re-export `BotProfile` from the new config module)
- Rename: `packages/server/src/rooms/playground-bot.test.ts` → `packages/server/src/rooms/bot.test.ts`
- Modify: `packages/server/src/rooms/PlaygroundRoom.ts` (import sites only)

**Interfaces:**
- Produces: `BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>>` from `../config/bot-profiles.js`; `botInput`, `type BotPose` from `./bot.js`. Task 6 imports both.

- [ ] **Step 1: Move the files with git so history follows**

```bash
git mv packages/server/src/rooms/playground-bot.ts packages/server/src/rooms/bot.ts
git mv packages/server/src/rooms/playground-bot.test.ts packages/server/src/rooms/bot.test.ts
```

- [ ] **Step 2: Extract the profile table into `packages/server/src/config/bot-profiles.ts`**

Move the `BotProfile` interface and the `BOT_PROFILES` object out of `bot.ts` into the new file **verbatim, doc comments included** — the comment explaining `aimToleranceRad < fireConeRad` is the reason the table is safe to edit and must travel with it. Add this above the table:

```ts
/**
 * The bot's difficulty tiers (spec PR17). These were a developer's tuning aid until practice mode
 * shipped; they are now balance a player judges, which is why they live in `config/` beside the rest
 * of the balance surface rather than inside a room helper.
 *
 * `hard` is frozen (PR18): it is EXACTLY the bot that shipped, and `bot.test.ts` pins its six numbers
 * by value. Only `easy` and `medium` may be retuned.
 */
```

- [ ] **Step 3: Re-point imports**

In `bot.ts`, import and re-export the profile types from the config module so existing consumers keep one import site:

```ts
import type { BotProfile } from "../config/bot-profiles.js";
export type { BotProfile } from "../config/bot-profiles.js";
export { BOT_PROFILES } from "../config/bot-profiles.js";
```

In `PlaygroundRoom.ts`, change `from "./playground-bot.js"` to `from "./bot.js"`. In `bot.test.ts`, change `from "./playground-bot.js"` to `from "./bot.js"`.

**Also move `shouldRecomputeIntent` and `pulsedFireSlots` out of `PlaygroundRoom.ts` into `bot.ts`**, with their doc comments and their tests. They are bot cadence, not room policy, and Task 6's `PracticeRoom` needs both — leaving them in the playground would make a shipped room import from a dev-only one. Re-point `PlaygroundRoom`'s own uses to `./bot.js`.

- [ ] **Step 4: Verify nothing else referenced the old path**

Run: `grep -rn "playground-bot" packages/ scripts/ docs/`
Expected: no hits in `packages/` or `scripts/`. Doc hits in `docs/superpowers/` are historical records of past plans — **leave them alone**; only `CLAUDE.md` and the live `docs/*.md` pages get updated, in Task 15.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: green, with no assertion changes anywhere. If a bot test fails, an import or a moved constant is wrong — not the test.

- [ ] **Step 6: Commit**

```bash
git add -A packages/server/src
git commit
```
Message: `refactor(server): promote the bot and its profiles out of dev-only naming (PR17)`

---

### Task 4: Retune the `easy` and `medium` bot tiers (spec PR18)

**Files:**
- Modify: `packages/server/src/config/bot-profiles.ts`
- Modify: `packages/server/src/rooms/bot.test.ts` (the `easy`/`medium` pinned values only)

**Interfaces:**
- Consumes: `BOT_PROFILES` from Task 3.
- Produces: no new symbols. `hard`'s six values are byte-identical to before.

> **Note for the implementer and the reviewer:** these numbers are a reasoned first pass, not a validated tune. Bot feel cannot be unit-tested — only played. The suite proves the invariant holds and that `hard` did not move; whether `easy` is actually beatable by a newcomer is a question for `npm run dev` and a human. Say so when reporting this task.

- [ ] **Step 1: Write the failing test**

In `packages/server/src/rooms/bot.test.ts`, update the pinned `easy` and `medium` rows and add the ordering assertions:

```ts
it("pins the easy profile (PR18 — retuned for players, not the developer)", () => {
  expect(BOT_PROFILES.easy).toEqual({
    standoffUnits: 200,
    deadbandUnits: 70,
    reactionTicks: 9,
    aimToleranceRad: 0.6,
    fireConeRad: 0.68,
    firePeriodTicks: 14,
  });
});

it("pins the medium profile (PR18)", () => {
  expect(BOT_PROFILES.medium).toEqual({
    standoffUnits: 130,
    deadbandUnits: 35,
    reactionTicks: 4,
    aimToleranceRad: 0.45,
    fireConeRad: 0.52,
    firePeriodTicks: 7,
  });
});

it("orders the tiers monotonically on every pressure lever (PR18)", () => {
  const { easy, medium, hard } = BOT_PROFILES;
  // Closer, quicker, tighter, faster-firing as difficulty rises.
  expect(easy.standoffUnits).toBeGreaterThan(medium.standoffUnits);
  expect(medium.standoffUnits).toBeGreaterThan(hard.standoffUnits);
  expect(easy.reactionTicks).toBeGreaterThan(medium.reactionTicks);
  expect(medium.reactionTicks).toBeGreaterThan(hard.reactionTicks);
  expect(easy.firePeriodTicks).toBeGreaterThan(medium.firePeriodTicks);
  expect(medium.firePeriodTicks).toBeGreaterThan(hard.firePeriodTicks);
  expect(easy.aimToleranceRad).toBeGreaterThan(medium.aimToleranceRad);
  expect(medium.aimToleranceRad).toBeGreaterThan(hard.aimToleranceRad);
});
```

Leave the existing `hard` pin **exactly as it is**, and leave the existing `aimToleranceRad < fireConeRad` assertion alone — it must keep passing for all three rows.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/server/src/rooms/bot.test.ts`
Expected: FAIL on the `easy` and `medium` pins with the old values.

- [ ] **Step 3: Apply the retune**

In `packages/server/src/config/bot-profiles.ts`, replace the `easy` and `medium` rows:

```ts
  easy: Object.freeze({
    standoffUnits: 200,
    deadbandUnits: 70,
    reactionTicks: 9,
    aimToleranceRad: 0.6,
    fireConeRad: 0.68,
    firePeriodTicks: 14,
  }),
  medium: Object.freeze({
    standoffUnits: 130,
    deadbandUnits: 35,
    reactionTicks: 4,
    aimToleranceRad: 0.45,
    fireConeRad: 0.52,
    firePeriodTicks: 7,
  }),
```

Add above them:

```ts
  // Retuned for a new player (PR18). `easy` hangs back two hundred units, takes 300 ms to react and
  // pulses a shot roughly twice a second, so a first-timer has room to learn the controls while
  // still being shot at. `medium` closes the gap to `hard` without matching its 1-tick reaction.
  // `hard` below is untouched and pinned by value — it is the bot that shipped.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/server/src/rooms/bot.test.ts`
Expected: PASS, including the untouched `hard` pin and the tolerance/cone invariant on all three rows.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: green. Nothing outside the bot test reads these numbers.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/config/bot-profiles.ts packages/server/src/rooms/bot.test.ts
git commit
```
Message: `balance(bot): retune easy and medium for players, hard untouched (PR18)`

---

### Task 5: The practice room's pure rules (spec PR15, PR27, PR28, PR29)

Pure functions first, with no room and no matchmaker, so every rule is a test rather than a comment inside a room method — the pattern `shouldRefusePlayground` and `loadoutOrChassisChanged` already follow.

**Files:**
- Create: `packages/server/src/rooms/practice-rules.ts`
- Create: `packages/server/src/rooms/practice-rules.test.ts`

**Interfaces:**
- Consumes: `PRACTICE_CONFIG`, `type PracticeOpponent` (Task 1); `activeCarIds`, `type CarId` from shared.
- Produces, all imported by Task 6:
  - `shouldRefusePractice(listings: readonly unknown[], cap: number): boolean`
  - `resolveOpponentCar(opponent: PracticeOpponent, rng: () => number): CarId`
  - `isPracticeIdle(lastInputAtMs: number, nowMs: number, timeoutSeconds: number): boolean`
  - `isIdleWarningDue(lastInputAtMs: number, nowMs: number, timeoutSeconds: number, warningSeconds: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/rooms/practice-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { activeCarIds } from "@motor-combat-moba/shared";
import {
  isIdleWarningDue,
  isPracticeIdle,
  resolveOpponentCar,
  shouldRefusePractice,
} from "./practice-rules.js";

describe("shouldRefusePractice", () => {
  it("admits a join while under the cap", () => {
    expect(shouldRefusePractice([{}, {}], 6)).toBe(false);
  });

  it("refuses at the cap, not one past it", () => {
    expect(shouldRefusePractice([{}, {}, {}, {}, {}, {}], 6)).toBe(true);
  });

  it("admits the first room", () => {
    expect(shouldRefusePractice([], 6)).toBe(false);
  });

  it("refuses everything at a cap of zero", () => {
    expect(shouldRefusePractice([], 0)).toBe(true);
  });
});

describe("resolveOpponentCar", () => {
  it("passes an explicit chassis through untouched", () => {
    expect(resolveOpponentCar("bastion", () => 0.99)).toBe("bastion");
  });

  it("resolves random to an ACTIVE chassis (PR15)", () => {
    const active = activeCarIds();
    for (const roll of [0, 0.34, 0.5, 0.99]) {
      expect(active).toContain(resolveOpponentCar("random", () => roll));
    }
  });

  it("never lands out of range on a roll of exactly 1", () => {
    expect(activeCarIds()).toContain(resolveOpponentCar("random", () => 1));
  });
});

describe("isPracticeIdle", () => {
  it("is not idle before the timeout", () => {
    expect(isPracticeIdle(0, 299_000, 300)).toBe(false);
  });

  it("is idle at the timeout", () => {
    expect(isPracticeIdle(0, 300_000, 300)).toBe(true);
  });

  it("measures wall clock, so a frozen sim still ages (PR27)", () => {
    // No sim tick is involved at all: this is the whole point of the wall-clock decision.
    expect(isPracticeIdle(1_000, 302_000, 300)).toBe(true);
  });
});

describe("isIdleWarningDue", () => {
  it("is not due with more than the warning window left", () => {
    expect(isIdleWarningDue(0, 239_000, 300, 60)).toBe(false);
  });

  it("is due once the remaining time drops to the warning window", () => {
    expect(isIdleWarningDue(0, 240_000, 300, 60)).toBe(true);
  });

  it("stays due right up to the close, so a late tick never skips it", () => {
    expect(isIdleWarningDue(0, 299_000, 300, 60)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/server/src/rooms/practice-rules.test.ts`
Expected: FAIL — cannot resolve `./practice-rules.js`.

- [ ] **Step 3: Write `practice-rules.ts`**

```ts
import { activeCarIds, type CarId, type PracticeOpponent } from "@motor-combat-moba/shared";

/**
 * May another practice room open right now (spec PR29)?
 *
 * Pure, and takes only the count it reads, so the rule is testable without a matchmaker. Refuses AT
 * the cap: a cap of 6 means six rooms exist, not seven.
 *
 * Known and accepted (PR29): two simultaneous `onCreate` calls can both pass this, the same race
 * `shouldRefusePlayground` already carries. Closing it needs a lock the rest of the server does not
 * have, for a failure mode requiring two people to press Start in the same millisecond.
 */
export function shouldRefusePractice(listings: readonly unknown[], cap: number): boolean {
  return listings.length >= cap;
}

/**
 * The bot's chassis, resolved ONCE at room creation and never re-rolled — not on respawn (PR15).
 * Cars do not change chassis mid-match, and neither does the bot.
 *
 * Draws only from ACTIVE chassis, so a car hidden from car select cannot appear in practice either.
 * `Math.min` guards a roll of exactly 1, which `Math.random` never returns but an injected rng in a
 * test does.
 */
export function resolveOpponentCar(opponent: PracticeOpponent, rng: () => number): CarId {
  if (opponent !== "random") return opponent;
  const active = activeCarIds();
  const index = Math.min(active.length - 1, Math.floor(rng() * active.length));
  return active[index]!;
}

/**
 * Has this session gone quiet long enough to close (PR27)?
 *
 * Wall clock, deliberately, and NOT sim ticks: pause freezes `state.tick`, so a tick-based counter
 * would never advance for a paused room — the exact case most worth reaping.
 */
export function isPracticeIdle(
  lastInputAtMs: number,
  nowMs: number,
  timeoutSeconds: number,
): boolean {
  return nowMs - lastInputAtMs >= timeoutSeconds * 1000;
}

/**
 * Is the player inside the warning window (PR28)? Stays true all the way to the close rather than
 * firing on one exact millisecond, so a tick that lands late cannot skip the warning entirely; the
 * room sends it once and latches (see `PracticeRoom.warnedOfIdle`).
 */
export function isIdleWarningDue(
  lastInputAtMs: number,
  nowMs: number,
  timeoutSeconds: number,
  warningSeconds: number,
): boolean {
  return nowMs - lastInputAtMs >= (timeoutSeconds - warningSeconds) * 1000;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/server/src/rooms/practice-rules.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/rooms/practice-rules.ts packages/server/src/rooms/practice-rules.test.ts
git commit
```
Message: `feat(server): pure practice-room rules for cap, opponent and idle (PR15/PR27/PR29)`

---

### Task 6: `PracticeRoom` (spec PR3, PR4, PR7–PR16, PR27–PR30)

The centrepiece. It calls `runPipeline` and the deathmatch respawn helpers — it never modifies them.

**Files:**
- Create: `packages/server/src/rooms/PracticeRoom.ts`
- Create: `packages/server/src/rooms/practice-room.test.ts`
- Modify: `packages/server/src/mode.ts` (add `getMaxPracticeRooms`)
- Modify: `packages/server/src/index.ts` (register the room)

**Interfaces:**
- Consumes: `runPipeline`, `respawnSweep`, `respawnPlayer`, `type PipelineCtx` from `./tick-pipeline.js`; `botInput`, `BOT_PROFILES`, `type BotPose` from `./bot.js`; the four rules from `./practice-rules.js`; `PracticeState`, `PRACTICE_*`, `isPracticeSetup` from shared.
- Produces: `class PracticeRoom extends Room<PracticeState>`; `getMaxPracticeRooms(fallback: number): number` in `mode.ts`.

- [ ] **Step 1: Add the env override to `mode.ts`**

Append, following the shape of `getCarSelectSeconds` directly above it:

```ts
/** Same shape as the other overrides: lets a host raise or lower the practice-room cap (PR29). */
export function getMaxPracticeRooms(fallback: number): number {
  const n = Number(process.env.MAX_PRACTICE_ROOMS);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/server/src/rooms/practice-room.test.ts`. It tests the room's own rules against a hand-built instance rather than a live matchmaker — read the top of `playground-room.test.ts` first and reuse its harness shape.

```ts
import { describe, expect, it } from "vitest";
import { PRACTICE_CONFIG } from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../config/bot-profiles.js";
import { isIdleWarningDue, isPracticeIdle } from "./practice-rules.js";

describe("practice room rules", () => {
  it("warns before it closes, never after", () => {
    const { idleTimeoutSeconds: t, idleWarningSeconds: w } = PRACTICE_CONFIG;
    const warnAt = (t - w) * 1000;
    expect(isIdleWarningDue(0, warnAt, t, w)).toBe(true);
    expect(isPracticeIdle(0, warnAt, t)).toBe(false);
  });

  it("ships a profile for every difficulty the setup guard accepts", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      expect(BOT_PROFILES[difficulty]).toBeDefined();
    }
  });
});
```

Then add the room-level tests below, driving a constructed `PracticeRoom` the way `playground-room.test.ts` drives a `PlaygroundRoom` (it stubs `setState`/`clock` rather than booting a server — mirror whatever it does, do not invent a second harness):

```ts
// Using playground-room.test.ts's harness, assert:
//  1. a paused room does not advance state.tick, and an unpaused one does
//  2. the idle sweep still runs while paused (the check sits ABOVE the pause return, PR27)
//  3. the bot's input lands in the bot's queue and never in the human's (PR14)
//  4. state.mode is FFA_DEATHMATCH and state.matchEndsTick stays 0 (PR9)
//  5. the room's module never imports setTuning (PR10) — assert on the source text:
//     expect(readFileSync(".../PracticeRoom.ts", "utf8")).not.toContain("setTuning")
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/server/src/rooms/practice-room.test.ts`
Expected: FAIL — cannot resolve `./PracticeRoom.js`.

- [ ] **Step 4: Write `PracticeRoom.ts`**

```ts
import { Room, ServerError, matchMaker, type Client } from "@colyseus/core";
import {
  DEFAULT_PATCH_RATE_HZ,
  GameMode,
  INPUT_MESSAGE,
  MSG_PRACTICE_IDLE_WARNING,
  MSG_PRACTICE_PAUSE,
  BOT_SESSION_ID,
  PRACTICE_CONFIG,
  PRACTICE_FULL_CLOSE_CODE,
  PRACTICE_FULL_ERROR,
  PRACTICE_IDLE_CLOSE_CODE,
  PRACTICE_ROOM_NAME,
  PlayerState,
  PlayerStatus,
  PracticeState,
  RoomPhase,
  TICK_RATE_HZ,
  isPracticeSetup,
  pickColor,
  weaponDefOf,
  type BotDifficulty,
  type CarId,
  type InputMessage,
  type PracticeSetup,
} from "@motor-combat-moba/shared";
import { getMaxPracticeRooms, getTickRateHz } from "../mode.js";
import { isInputMessage } from "../net/input-message.js";
import { newCombatMemory, type CombatMemory } from "../sim/combat-bridge.js";
import { newContactMemory, type ContactMemory } from "../sim/ram-bridge.js";
import { BOT_PROFILES, botInput, type BotPose } from "./bot.js";
import {
  isIdleWarningDue,
  isPracticeIdle,
  resolveOpponentCar,
  shouldRefusePractice,
} from "./practice-rules.js";
import { respawnPlayer, respawnSweep, runPipeline, type PipelineCtx } from "./tick-pipeline.js";

/**
 * Player-facing practice: the shipped game with one bot in it (spec PR1).
 *
 * Deliberately NOT a copy of `PlaygroundRoom`. There is no tuning store (PR10), no control routing
 * (PR12), no mid-session setup message (PR7) and no singleton guard (PR4) — Colyseus minting one
 * room per player is the feature here, not a bug to suppress.
 *
 * `setTuning` is never imported or called from this file. The store is process-wide, and a practice
 * room that touched it would re-balance every other room in the process.
 */
export class PracticeRoom extends Room<PracticeState> {
  maxClients = 1;

  private readonly inputQueues = new Map<string, InputMessage[]>();
  private readonly prevFireMasks = new Map<string, number>();
  private readonly matchRoster = new Set<string>();
  private readonly phaseCaps = new Map<string, number>();
  private readonly combat: CombatMemory = newCombatMemory();
  private readonly ram: ContactMemory = newContactMemory();

  private humanSessionId = "";
  private botSeq = 0;
  private heldBotIntent: InputMessage | undefined;
  /** Written once in `onCreate` and never again (PR19): a match's opponent does not get easier
   * halfway through, so neither does the bot. Changing it means exiting and starting again. */
  private difficulty: BotDifficulty = "medium";
  private setup: PracticeSetup | undefined;

  /** Wall-clock stamp of the last input received (PR27). Not a tick: a paused sim must still age. */
  private lastInputAtMs = Date.now();
  /** Latched so the warning is sent once per quiet stretch, not on every tick inside the window. */
  private warnedOfIdle = false;

  async onCreate(options?: unknown): Promise<void> {
    if (!isPracticeSetup(options)) {
      throw new ServerError(4000, "Invalid practice setup");
    }
    const listings = await matchMaker.query({ name: PRACTICE_ROOM_NAME });
    // Minus this room, which the matchmaker has already listed by the time onCreate runs.
    const others = listings.filter((entry) => entry.roomId !== this.roomId);
    if (shouldRefusePractice(others, getMaxPracticeRooms(PRACTICE_CONFIG.maxConcurrentRooms))) {
      throw new ServerError(PRACTICE_FULL_CLOSE_CODE, PRACTICE_FULL_ERROR);
    }

    this.setup = options;
    this.difficulty = options.difficulty;

    this.setState(new PracticeState());
    // Pinned here and never written again (PR9). Nothing in this room reduces a flow, so this is the
    // only thing that opens the gate `serverTick` and `runPipeline` both check.
    this.state.phase = RoomPhase.MATCH;
    // Deathmatch rules, and `matchEndsTick` deliberately left at 0: `matchClockLabel` returns "" for
    // a non-positive value, so the HUD drops the clock with no client conditional, while
    // `winRuleOf(mode) === "deathmatch"` keeps the kills panel lit. `runPipeline` reads the mode only
    // through `sidesOf`, which answers "ffa" for both FFA modes, so nothing else changes.
    this.state.mode = GameMode.FFA_DEATHMATCH;
    this.setPatchRate(1000 / DEFAULT_PATCH_RATE_HZ);
    this.setSimulationInterval(() => this.tick(), 1000 / getTickRateHz(TICK_RATE_HZ));

    // Mirrors ArenaRoom's injector (PR11). The playground deliberately skips it — simulated lag makes
    // a feel test lie — but practice takes the opposite decision for the reason it exists: strict
    // mirror means practice must feel like the arena on the same deploy. Off in a release build, so
    // this is a no-op there and matters only when a developer is testing with it on. Copy the
    // `withSimulatedLatency` / `getSimulatedLatency()` wiring from `ArenaRoom.onCreate` (~line 122).
    const enqueue = withSimulatedLatency<{ sessionId: string; msg: InputMessage }>(
      ({ sessionId, msg }) => this.inputQueues.get(sessionId)?.push(msg),
      this.clock,
      getSimulatedLatency(),
    );

    this.onMessage(INPUT_MESSAGE, (client, msg: unknown) => {
      if (!isInputMessage(msg)) return;
      // Stamped on every accepted input, and ONLY here: this is the definition of "not idle". Stamped
      // BEFORE the latency injector, so injected lag can never make a live player look idle.
      this.lastInputAtMs = Date.now();
      this.warnedOfIdle = false;
      enqueue({ sessionId: client.sessionId, msg });
    });

    this.onMessage(MSG_PRACTICE_PAUSE, () => {
      this.state.paused = !this.state.paused;
    });
  }

  onJoin(client: Client, options?: unknown): void {
    const setup = isPracticeSetup(options) ? options : this.setup!;
    this.humanSessionId = client.sessionId;
    this.lastInputAtMs = Date.now();

    const name = setup.name.trim() || "Player";
    const human = this.addCar(client.sessionId, name, setup.carId, [], 0);
    const opponentCarId = resolveOpponentCar(setup.opponentCarId, Math.random);
    this.addCar(BOT_SESSION_ID, "Bot", opponentCarId, [human.colorId], 1);

    // `respawnPlayer` is the whole of "this car is new": chassis hp, a fire state built from the
    // chassis's own kit, a spawn away from the other car, and the real `phased` protection (PR16).
    for (const id of this.matchRoster) {
      const player = this.state.players.get(id);
      if (player) respawnPlayer(this.ctx(), player);
    }
  }

  /**
   * `allowReconnection` is deliberately never called (PR30): a closed tab disposes the room
   * immediately rather than holding a 30 Hz sim through a grace window nobody is watching.
   */
  onLeave(): void {
    this.disconnect();
  }

  /**
   * One car. Both rows are schema-ordinary, so the client renders the bot exactly like a remote
   * player and no client change is needed to see it (PR14).
   *
   * `level` is deliberately NOT set: `PlayerState`'s own default is what a real match starts you at,
   * and strict mirror (PR1) means practice starts you there too. The playground pins level 3; this
   * room must not.
   *
   * No loadout is written into `combat.loadouts` either, which is what makes the car carry its
   * chassis's shipped kit — `newFireState` falls back to it when the map has no entry.
   */
  private addCar(
    sessionId: string,
    name: string,
    carId: CarId,
    usedColorIds: number[],
    team: number,
  ): PlayerState {
    const player = new PlayerState();
    player.sessionId = sessionId;
    player.name = name;
    player.carId = carId;
    player.colorId = pickColor(usedColorIds, Math.random);
    player.team = team;
    player.joinedAtTick = this.state.tick;
    player.status = PlayerStatus.IN_MATCH;
    player.alive = true;
    this.state.players.set(sessionId, player);
    this.inputQueues.set(sessionId, []);
    this.prevFireMasks.set(sessionId, 0);
    this.matchRoster.add(sessionId);
    return player;
  }

  private tick(): void {
    // ABOVE the pause return, and on wall clock (PR27). Both halves matter: a tick-based counter
    // would never advance while paused, and a check below the return would never run while paused —
    // and a player who walked away with the menu open is exactly the room worth reaping.
    if (this.sweepIdle()) return;
    if (this.state.paused) return;
    this.state.tick += 1;
    respawnSweep(this.ctx());
    this.enqueueBotInput();
    // No win check, ever (PR9) — `runPipeline`'s players are deliberately dropped.
    runPipeline(this.ctx());
  }

  /** Warns once, then closes. Returns true when the room is gone and the tick must stop. */
  private sweepIdle(): boolean {
    const now = Date.now();
    const { idleTimeoutSeconds, idleWarningSeconds } = PRACTICE_CONFIG;
    if (isPracticeIdle(this.lastInputAtMs, now, idleTimeoutSeconds)) {
      for (const client of this.clients) client.leave(PRACTICE_IDLE_CLOSE_CODE);
      this.disconnect();
      return true;
    }
    if (!this.warnedOfIdle && isIdleWarningDue(this.lastInputAtMs, now, idleTimeoutSeconds, idleWarningSeconds)) {
      this.warnedOfIdle = true;
      this.broadcast(MSG_PRACTICE_IDLE_WARNING);
    }
    return false;
  }

  /**
   * One input per tick for the bot's car, through the ordinary input queue — so "clients send
   * inputs, never state" holds: the bot is a client, just an in-process one.
   *
   * The fire mask is pulsed rather than passed straight through, for the reason spelled out in
   * `PlaygroundRoom.enqueueOpponentInput`: `serverTick` counts only newly-set bits as a press, so a
   * bot holding the same bits fires each slot once and then never again.
   */
  private enqueueBotInput(): void {
    const self = this.state.players.get(BOT_SESSION_ID);
    const queue = this.inputQueues.get(BOT_SESSION_ID);
    if (!self || !queue) return;

    this.botSeq += 1;
    const seq = this.botSeq;
    const profile = BOT_PROFILES[this.difficulty];

    const human = this.state.players.get(this.humanSessionId);
    // A dead target is no target: coast rather than chase the wreck's last pose, and drop the hold
    // so the bot reacts the instant the target respawns instead of waiting out its cadence.
    const target = human?.alive ? poseOf(human) : null;
    if (target === null) this.heldBotIntent = undefined;

    if (shouldRecomputeIntent(this.state.tick, profile.reactionTicks, this.heldBotIntent !== undefined)) {
      const slots = this.combat.fireStates.get(BOT_SESSION_ID)?.slots ?? [];
      this.heldBotIntent = botInput(
        seq,
        poseOf(self),
        target,
        slots.map((slot) => weaponDefOf(slot.weaponId).range),
        profile,
      );
    }

    const intent = this.heldBotIntent ?? { seq, steer: 0, throttle: 0, fireSlots: 0 };
    queue.push({
      ...intent,
      seq,
      fireSlots: pulsedFireSlots(this.state.tick, profile.firePeriodTicks, intent.fireSlots),
    });
  }

  /** Built fresh at every call, never cached — see the hazard note on `PipelineCtx`. */
  private ctx(): PipelineCtx {
    return {
      state: this.state,
      inputQueues: this.inputQueues,
      prevFireMasks: this.prevFireMasks,
      matchRoster: this.matchRoster,
      phaseCaps: this.phaseCaps,
      combat: this.combat,
      ram: this.ram,
      hz: getTickRateHz(TICK_RATE_HZ),
      runPhaseSweep: true,
    };
  }
}

function poseOf(player: PlayerState): BotPose {
  return { x: player.x, y: player.y, angle: player.angle };
}
```

- [ ] **Step 5: Verify `client.leave(code)` exists in the installed Colyseus**

Run: `grep -n "leave" node_modules/@colyseus/core/build/Transport.d.ts node_modules/@colyseus/core/build/Room.d.ts | head`
Expected: a `leave(code?: number, data?: string)` on the client and a `disconnect(closeCode?)` on the room. If `client.leave` takes no code in this version, drop the code argument and rely on the `MSG_PRACTICE_IDLE_WARNING` message plus a plain disconnect — the client can distinguish an idle close from a crash by having seen the warning. Note whichever you did in the commit message.

- [ ] **Step 6: Register the room**

In `packages/server/src/index.ts`, beside the arena registration and **outside** the `isDevToolsEnabled()` block (PR3):

```ts
import { PracticeRoom } from "./rooms/PracticeRoom.js";
// ...
gameServer.define(ROOM_NAME, ArenaRoom);
// Ships. Practice is a player-facing feature, so unlike the playground below it carries no gate.
gameServer.define(PRACTICE_ROOM_NAME, PracticeRoom);
```

Add `PRACTICE_ROOM_NAME` to the existing shared import at the top of the file.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run packages/server/src/rooms/practice-room.test.ts`
Expected: PASS.

- [ ] **Step 8: Full suite + build**

Run: `npm test` then `npm run build`
Expected: green. `golden.test.ts` untouched — no sim code changed.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src
git commit
```
Message: `feat(server): PracticeRoom, a shipped 1v1-vs-bot room beside the arena (PR3-PR16)`

---

### Task 7: Widen the playground's open-guard to see practice rooms (spec PR10)

A real hole, not a nicety: practice rooms are registered on **every** process including `npm run dev`'s, so without this a developer opening `?dev=playground` silently re-balances a friend's live practice session through the process-wide tuning store.

**Files:**
- Modify: `packages/server/src/rooms/PlaygroundRoom.ts` (`shouldRefusePlayground` and its `onCreate` caller)
- Modify: `packages/server/src/rooms/playground-room.test.ts`

**Interfaces:**
- Produces: `shouldRefusePlayground(arenaListings, practiceListings)` — signature changes from one argument to two. No other caller exists.

- [ ] **Step 1: Write the failing test**

In `packages/server/src/rooms/playground-room.test.ts`, replace the existing `shouldRefusePlayground` cases with:

```ts
describe("shouldRefusePlayground", () => {
  it("opens when nothing else is running", () => {
    expect(shouldRefusePlayground([], [])).toBe(false);
  });

  it("opens when the arena is listed but empty", () => {
    expect(shouldRefusePlayground([{ clients: 0 }], [])).toBe(false);
  });

  it("refuses while anyone sits in the arena", () => {
    expect(shouldRefusePlayground([{ clients: 1 }], [])).toBe(true);
  });

  it("refuses while a practice room is open (PR10)", () => {
    // The tuning store is process-wide: sliders here would re-balance that session next door.
    expect(shouldRefusePlayground([], [{ clients: 1 }])).toBe(true);
  });

  it("refuses when both are busy", () => {
    expect(shouldRefusePlayground([{ clients: 2 }], [{ clients: 1 }])).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/server/src/rooms/playground-room.test.ts`
Expected: FAIL — the practice-room case passes `false` where `true` is expected (and TypeScript complains about the second argument).

- [ ] **Step 3: Widen the function**

In `PlaygroundRoom.ts`:

```ts
/**
 * May a playground room open right now? No, if anyone at all is sitting in the arena OR in a
 * practice room (spec PG15, widened by PR10): the tuning store is a module-level singleton shared by
 * every room in the process, so overrides typed into the playground would silently re-balance a live
 * match — or a player's practice session — next door.
 *
 * Practice rooms are registered on EVERY process, the `npm run dev` one included, which is exactly
 * how a developer's sliders reach a friend's session.
 *
 * Pure, and takes only the field it reads, so the rule is testable without a matchmaker.
 */
export function shouldRefusePlayground(
  arenaListings: readonly { clients: number }[],
  practiceListings: readonly { clients: number }[],
): boolean {
  const busy = (listing: { clients: number }): boolean => listing.clients > 0;
  return arenaListings.some(busy) || practiceListings.some(busy);
}
```

And in `onCreate`, query both before the check:

```ts
const listings = await matchMaker.query({ name: ROOM_NAME });
const practice = await matchMaker.query({ name: PRACTICE_ROOM_NAME });
if (shouldRefusePlayground(listings, practice)) {
  throw new ServerError(ARENA_BUSY_CODE, ARENA_BUSY_ERROR);
}
```

Update `ARENA_BUSY_ERROR` to name the wider rule:

```ts
export const ARENA_BUSY_ERROR =
  "Close the arena and any practice session first: playground tuning is process-wide";
```

Add `PRACTICE_ROOM_NAME` to the file's existing shared import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/server/src/rooms/playground-room.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/rooms/PlaygroundRoom.ts packages/server/src/rooms/playground-room.test.ts
git commit
```
Message: `fix(playground): refuse to open while a practice session is live (PR10)`

---

### Task 8: Measure the concurrency cost, then set the cap from data (spec PR29, Risk 2)

The spec's default of 6 is a guess. This task replaces it with a number, or confirms it. The measurement script is **throwaway** — it lives in the scratchpad and is never committed.

**Files:**
- Create (throwaway, not committed): a script in the session scratchpad directory
- Modify (only if the data says so): `packages/shared/src/config/practice-config.ts`, `docs/superpowers/specs/2026-09-03-practice-mode-design.md` (PR29's number and Risk 2's status)

- [ ] **Step 1: Build, then start a server with the practice room registered**

```bash
npm run build
node packages/server/dist/index.js
```

- [ ] **Step 2: Write a throwaway load script in the scratchpad**

Open N `colyseus.js` clients against `PRACTICE_ROOM_NAME`, each sending an input at 30 Hz, and sample the server's actual simulation interval drift — the gap between successive `state.tick` increments against wall clock. Run it at N = 1, 3, 6, 12.

- [ ] **Step 3: Record the numbers**

For each N: mean and worst-case tick interval against the 33.3 ms target, and the server process's CPU share. The threshold that matters: **tick drift under a few milliseconds at the cap**, with the live arena also running.

- [ ] **Step 4: Set the cap**

If 6 rooms hold the tick steady, leave `maxConcurrentRooms: 6` and update Risk 2 in the spec from "estimated, not measured" to the measured figures. If drift appears earlier, lower the default and say so. If 12 is comfortable, note it in the spec but **leave the default at 6** — the cap is a safety rail, not a target.

- [ ] **Step 5: Commit only the doc and config change**

```bash
git add docs/superpowers/specs/2026-09-03-practice-mode-design.md packages/shared/src/config/practice-config.ts
git commit
```
Message: `docs(practice): record measured concurrency cost, set the room cap from data (PR29)`

Do **not** commit the script.

---

### Task 9: `joinPractice` and settings persistence (spec PR21)

**Files:**
- Create: `packages/client/src/practice/storage.ts`
- Create: `packages/client/src/practice/storage.test.ts`
- Modify: `packages/client/src/net/connection.ts`

**Interfaces:**
- Produces:
  - `joinPractice(setup: PracticeSetup): Promise<Room<PracticeState>>`
  - `PRACTICE_STORAGE_KEY = "motor-combat.practice.v1"`
  - `loadPracticeSetup(storage?: Storage): PracticeSetup`
  - `savePracticeSetup(setup: PracticeSetup, storage?: Storage): void`
- Consumed by Task 10's scene and Task 13's summary.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/practice/storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultPracticeSetup } from "@motor-combat-moba/shared";
import { PRACTICE_STORAGE_KEY, loadPracticeSetup, savePracticeSetup } from "./storage.js";

function fakeStorage(seed?: string): Storage {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(PRACTICE_STORAGE_KEY, seed);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("practice setup persistence", () => {
  it("falls back to the default when nothing is stored", () => {
    expect(loadPracticeSetup(fakeStorage())).toEqual(defaultPracticeSetup());
  });

  it("round-trips a saved setup", () => {
    const storage = fakeStorage();
    const setup = { ...defaultPracticeSetup(), carId: "bastion" as const, difficulty: "hard" as const };
    savePracticeSetup(setup, storage);
    expect(loadPracticeSetup(storage)).toEqual(setup);
  });

  it("falls back whole on malformed JSON", () => {
    expect(loadPracticeSetup(fakeStorage("{not json"))).toEqual(defaultPracticeSetup());
  });

  it("falls back whole on a structurally invalid blob", () => {
    const stored = JSON.stringify({ ...defaultPracticeSetup(), carId: "nope" });
    expect(loadPracticeSetup(fakeStorage(stored))).toEqual(defaultPracticeSetup());
  });

  it("falls back when a stored chassis has since been deactivated", () => {
    // isPracticeSetup rejects an inactive chassis, so retiring a car cannot strand a player on a
    // settings page that will not join.
    const stored = JSON.stringify({ ...defaultPracticeSetup(), opponentCarId: "retired-car" });
    expect(loadPracticeSetup(fakeStorage(stored))).toEqual(defaultPracticeSetup());
  });

  it("survives a storage that throws (private browsing)", () => {
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(loadPracticeSetup(hostile)).toEqual(defaultPracticeSetup());
    expect(() => savePracticeSetup(defaultPracticeSetup(), hostile)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/client/src/practice/storage.test.ts`
Expected: FAIL — cannot resolve `./storage.js`.

- [ ] **Step 3: Write `storage.ts`**

```ts
import { defaultPracticeSetup, isPracticeSetup, type PracticeSetup } from "@motor-combat-moba/shared";

/**
 * localStorage persistence for the practice settings screen (spec PR21). Pure codec plus a thin
 * `Storage` seam, so the test runs under vitest's node environment without a `window`.
 *
 * Validation is the SAME guard the server uses, which buys one thing worth having: a chassis that is
 * later deactivated fails `isPracticeSetup`, so the blob falls back whole rather than stranding a
 * player on a settings page whose Start button the server will refuse.
 */
export const PRACTICE_STORAGE_KEY = "motor-combat.practice.v1";

export function loadPracticeSetup(storage: Storage = window.localStorage): PracticeSetup {
  try {
    const raw = storage.getItem(PRACTICE_STORAGE_KEY);
    if (raw === null) return defaultPracticeSetup();
    const parsed: unknown = JSON.parse(raw);
    return isPracticeSetup(parsed) ? parsed : defaultPracticeSetup();
  } catch {
    // Malformed JSON, or a storage that throws on access (private browsing, blocked site data).
    return defaultPracticeSetup();
  }
}

export function savePracticeSetup(
  setup: PracticeSetup,
  storage: Storage = window.localStorage,
): void {
  try {
    storage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // A setting that cannot be remembered is not worth breaking the screen over.
  }
}
```

- [ ] **Step 4: Add `joinPractice` to `connection.ts`**

```ts
/**
 * Joins a practice room (spec PR7). Unlike `joinPlayground` this is a shipped path: the room is
 * registered on every server, and the setup rides as join options because practice settings are
 * fixed for the session and there is no mid-session message to change them.
 *
 * Rejects with the server's error — `PRACTICE_FULL_ERROR` when the host is at capacity — which
 * `PracticeSetupScene` turns into readable text without leaving the settings page.
 */
export async function joinPractice(setup: PracticeSetup): Promise<Room<PracticeState>> {
  const client = new Client(detectServerEndpoint());
  return client.joinOrCreate<PracticeState>(PRACTICE_ROOM_NAME, setup);
}
```

Extend the file's shared import with `PRACTICE_ROOM_NAME`, `PracticeState`, and `type PracticeSetup`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/client/src/practice/storage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/practice packages/client/src/net/connection.ts
git commit
```
Message: `feat(client): practice settings persistence and joinPractice (PR21)`

---

### Task 10: The practice settings screen and its scene (spec PR21)

**Files:**
- Create: `packages/client/src/ui/screens/practice-setup.ts`
- Create: `packages/client/src/ui/screens/practice-setup.test.ts`
- Create: `packages/client/src/scenes/PracticeSetupScene.ts`

**Interfaces:**
- Consumes: `loadPracticeSetup`/`savePracticeSetup` (Task 9), `joinPractice` (Task 9), `activeCarIds`/`CAR_TABLE` from shared.
- Produces:
  - `carOptions(): { value: string; label: string }[]` and `opponentOptions(): { value: string; label: string }[]` (pure, tested)
  - `renderPracticeSetup(handlers, initial): PracticeSetupScreen` with `{ root, setError, setBusy, value() }`
  - Scene key `"practice-setup"`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/ui/screens/practice-setup.test.ts`. Test only the pure option builders — the DOM render is a shell, like every other screen module here:

```ts
import { describe, expect, it } from "vitest";
import { activeCarIds } from "@motor-combat-moba/shared";
import { carOptions, opponentOptions } from "./practice-setup.js";

describe("practice setup options", () => {
  it("offers every active chassis and nothing else (PR15)", () => {
    expect(carOptions().map((o) => o.value)).toEqual(activeCarIds());
  });

  it("labels each chassis with its display name, not its id", () => {
    expect(carOptions().every((o) => o.label.length > 0 && o.label !== o.value)).toBe(true);
  });

  it("puts Random first in the opponent list", () => {
    expect(opponentOptions()[0]).toEqual({ value: "random", label: "Random" });
  });

  it("offers the same chassis set after Random", () => {
    expect(opponentOptions().slice(1).map((o) => o.value)).toEqual(activeCarIds());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/client/src/ui/screens/practice-setup.test.ts`
Expected: FAIL — cannot resolve `./practice-setup.js`.

- [ ] **Step 3: Write the screen module**

Create `packages/client/src/ui/screens/practice-setup.ts`. Read `packages/client/src/ui/screens/join.ts` first and follow its structure exactly — the same `h`/`button` helpers, the same `.btn btn-primary` / `.btn btn-secondary` classes, the same error-line and busy-state handling.

```ts
import { CAR_TABLE, activeCarIds, type PracticeSetup } from "@motor-combat-moba/shared";
import { button, h } from "../dom.js";

export interface SelectOption {
  value: string;
  label: string;
}

/** Active chassis only (PR15) — a car hidden from car select must not appear here either. */
export function carOptions(): SelectOption[] {
  return activeCarIds().map((id) => ({ value: id, label: CAR_TABLE[id].name }));
}

/** The opponent list: "Random" first, then the same active chassis (PR21). */
export function opponentOptions(): SelectOption[] {
  return [{ value: "random", label: "Random" }, ...carOptions()];
}

export const DIFFICULTY_OPTIONS: readonly SelectOption[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

export interface PracticeSetupHandlers {
  onStart(setup: Omit<PracticeSetup, "name">): void;
  onBack(): void;
}

export interface PracticeSetupScreen {
  root: HTMLElement;
  setError(message: string): void;
  setBusy(busy: boolean): void;
}

export function renderPracticeSetup(
  handlers: PracticeSetupHandlers,
  initial: PracticeSetup,
): PracticeSetupScreen {
  // Build three <select>s from the option builders above, seeded from `initial`, plus a Back
  // (btn-secondary) and a Start (btn-primary) on one baseline, and an error line under them —
  // the same three parts join.ts has, for the same reason: a capacity refusal and a dropped
  // connection are what a player on a LAN actually hits, and a screen that swallows them is a
  // screen you cannot get past.
  //
  // Start hands back { carId, opponentCarId, difficulty } read from the selects; the name is the
  // scene's to supply (PR20), which is why it is Omit-ed from the handler's type.
}
```

Implement the body following `join.ts`'s idiom. Keep it a shell: every rule is already in the tested builders above.

- [ ] **Step 4: Write the scene**

Create `packages/client/src/scenes/PracticeSetupScene.ts`, modelled on `JoinScene` (same `ScreenOverlay` lifecycle, same `SHUTDOWN` teardown, same busy/error handling):

```ts
import Phaser from "phaser";
import { PRACTICE_FULL_ERROR, type PracticeSetup } from "@motor-combat-moba/shared";
import { joinPractice } from "../net/connection.js";
import { loadPracticeSetup, savePracticeSetup } from "../practice/storage.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderPracticeSetup, type PracticeSetupScreen } from "../ui/screens/practice-setup.js";

/**
 * The practice settings page (spec PR21). Settings are chosen here and fixed for the session — there
 * is no mid-session reconfiguration (PR2), which is why they ride as join options rather than as a
 * message the room could accept later.
 *
 * A capacity refusal (PR25, code 4007) is an inline error on THIS screen: the player never left it,
 * and routing them somewhere else to read the reason would be a worse answer than re-enabling Start.
 */
export class PracticeSetupScene extends Phaser.Scene {
  private starting = false;
  private overlay: ScreenOverlay | undefined;
  private screen: PracticeSetupScreen | undefined;

  constructor() {
    super({ key: "practice-setup" });
  }

  create(): void {
    this.starting = false;
    this.overlay = new ScreenOverlay(this);
    this.screen = renderPracticeSetup(
      {
        onStart: (partial) => void this.onStart(partial),
        onBack: () => this.scene.start("join"),
      },
      loadPracticeSetup(),
    );
    this.overlay.render(this.screen.root);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  private async onStart(partial: Omit<PracticeSetup, "name">): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.screen?.setError("");
    this.screen?.setBusy(true);
    // The name was captured on the join screen and falls back to "Player" when blank (PR20).
    const name = (this.registry.get("playerName") as string | undefined) ?? "Player";
    const setup: PracticeSetup = { ...partial, name };
    savePracticeSetup(setup);
    try {
      const room = await joinPractice(setup);
      this.registry.set("room", room);
      this.scene.start("arena");
    } catch (err) {
      this.starting = false;
      this.screen?.setBusy(false);
      this.screen?.setError(err instanceof Error ? err.message : PRACTICE_FULL_ERROR);
    }
  }

  private onShutdown(): void {
    this.overlay?.destroy();
    this.overlay = undefined;
    this.screen = undefined;
    this.starting = false;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/client/src/ui/screens/practice-setup.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/ui/screens/practice-setup.ts packages/client/src/ui/screens/practice-setup.test.ts packages/client/src/scenes/PracticeSetupScene.ts
git commit
```
Message: `feat(client): practice settings screen and scene (PR21)`

---

### Task 11: Rename `isPlaygroundPaused` to `isSimPaused` (spec PR22)

Mechanical, and worth its own commit so the next task's diff is only the pause menu.

**Files:**
- Modify: `packages/client/src/scenes/controlled-car.ts`
- Modify: `packages/client/src/scenes/controlled-car.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (2 sites: the import and the `pumpInput` call)

- [ ] **Step 1: Rename the export and update its doc comment**

```ts
/**
 * Is this room's sim frozen? True for a paused playground AND a paused practice session (spec PR22).
 *
 * Duck-typed off a bare `ArenaState` rather than off either subclass, which is why one predicate
 * covers both rooms: a real match's state has no `paused` field, so this is always false there.
 */
export function isSimPaused(state: ArenaState): boolean {
  return (state as { paused?: boolean }).paused === true;
}
```

- [ ] **Step 2: Update the two call sites and the test**

Run: `grep -rn "isPlaygroundPaused" packages/`
Expected after editing: no hits.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: green, with only the renamed identifier changed — no assertion logic moves.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/scenes/controlled-car.ts packages/client/src/scenes/controlled-car.test.ts packages/client/src/scenes/ArenaScene.ts
git commit
```
Message: `refactor(client): isPlaygroundPaused -> isSimPaused, it covers practice too (PR22)`

---

### Task 12: The pause menu (spec PR22, PR23)

**Files:**
- Create: `packages/client/src/ui/screens/pause.ts`
- Create: `packages/client/src/ui/screens/pause.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts`

**Interfaces:**
- Produces: `renderPause(handlers: { onResume(): void; onExit(): void }): { root: HTMLElement }`; `isPracticeRoom(room): boolean` exported from `packages/client/src/scenes/controlled-car.ts`.

- [ ] **Step 1: Verify how the room's identity is available on the client**

Run: `grep -n "name" node_modules/colyseus.js/lib/Room.d.ts`
Expected: a `name: string` property.

**This gate must be derived from the room, not from a flag a scene sets** (PR22): a registry flag can go stale — practice, exit, then join a real match, and a flag nobody cleared puts a pause menu in a live match. If `Room` has no `name`, fall back to a registry flag cleared in **both** `PracticeSummaryScene` and `ArenaScene`'s `SHUTDOWN` handler, and add a test for the stale case. Record which you did in the commit message.

Do **not** gate on the presence of `paused` in the state: `PlaygroundState` carries it too and mounts its own overlay, so a duck-typed gate would stack the practice menu on the playground's.

- [ ] **Step 2: Write the failing test**

Create `packages/client/src/ui/screens/pause.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PRACTICE_ROOM_NAME, ROOM_NAME } from "@motor-combat-moba/shared";
import { isPracticeRoom } from "../../scenes/controlled-car.js";

describe("isPracticeRoom", () => {
  it("is true for a practice room", () => {
    expect(isPracticeRoom({ name: PRACTICE_ROOM_NAME })).toBe(true);
  });

  it("is false for the arena, so a real match can never open the menu", () => {
    expect(isPracticeRoom({ name: ROOM_NAME })).toBe(false);
  });

  it("is false for the playground, which mounts its own overlay", () => {
    expect(isPracticeRoom({ name: "playground" })).toBe(false);
  });

  it("is false when the room reports no name at all", () => {
    expect(isPracticeRoom({ name: undefined })).toBe(false);
  });
});
```

Then, in the same file, cover the pause screen's wiring:

```ts
describe("renderPause", () => {
  it("calls onResume when Resume is clicked", async () => {
    const { renderPause } = await import("./pause.js");
    const onResume = vi.fn();
    const screen = renderPause({ onResume, onExit: vi.fn() });
    screen.root.querySelectorAll("button")[0]!.click();
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("calls onExit when Exit is clicked", async () => {
    const { renderPause } = await import("./pause.js");
    const onExit = vi.fn();
    const screen = renderPause({ onResume: vi.fn(), onExit });
    screen.root.querySelectorAll("button")[1]!.click();
    expect(onExit).toHaveBeenCalledOnce();
  });
});
```

If the client's vitest config runs the node environment with no DOM, put the two `renderPause` cases in a file configured for `jsdom` — check `packages/client/vitest.config.ts` first and follow whatever the existing screen tests do. If no screen module is DOM-tested today, keep only the `isPracticeRoom` cases and leave `renderPause` untested, like its sibling screens.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/client/src/ui/screens/pause.test.ts`
Expected: FAIL — `isPracticeRoom` is not exported.

- [ ] **Step 4: Add `isPracticeRoom` to `controlled-car.ts`**

```ts
/**
 * Is this a practice room (spec PR22)? Read off the room itself rather than a scene-set flag, which
 * can go stale: practice, exit, then join a real match, and a flag nobody cleared would put a pause
 * menu in a live match. The room's name cannot go stale.
 */
export function isPracticeRoom(room: { name?: string }): boolean {
  return room.name === PRACTICE_ROOM_NAME;
}
```

- [ ] **Step 5: Write `pause.ts`**

Two buttons over a dimmed panel, following `join.ts`'s idiom and classes:

```ts
import { button, h } from "../dom.js";

export interface PauseHandlers {
  onResume(): void;
  onExit(): void;
}

/**
 * The practice pause menu (spec PR22). Two actions only: Resume, and Exit to the session summary.
 *
 * Rendered by `ArenaScene` when `state.paused` turns true — never optimistically on the keypress
 * (PR23). The alternative shows this menu while the sim is still running, which means the player is
 * being shot at by a bot they cannot see.
 */
export function renderPause(handlers: PauseHandlers): { root: HTMLElement } {
  const resume = button({ class: "btn btn-primary" }, ["Resume"], handlers.onResume);
  const exit = button({ class: "btn btn-secondary" }, ["Exit"], handlers.onExit);
  const root = h("div", { class: "screen screen-center" }, [
    h("h2", {}, ["Paused"]),
    h("div", { class: "row" }, [resume, exit]),
  ]);
  return { root };
}
```

- [ ] **Step 6: Wire it into `ArenaScene`**

Three edits, all guarded by `isPracticeRoom(room)`:

1. Beside the other `keyboard.addKey` calls (around line 823–857), add `pause: keyboard.addKey(Codes.P)`. **First confirm `P` is not already taken** by `SLOT_KEYS` — run `grep -n "SLOT_KEYS" -A 10 packages/client/src/scenes/ArenaScene.ts` and check the codes. If it is taken, use `Codes.ESC` instead and say so in the commit message.
2. In the scene's update loop, on a `JustDown` of that key, send `MSG_PRACTICE_PAUSE`. Nothing else — do not touch local state.
3. In the `onStateChange` handler bound by `bindRoom` (around line 955), when `isPracticeRoom(room)` and `state.paused` has changed, either render `renderPause` into the scene's overlay or clear it. Exit calls the snapshot-then-leave path from Task 13.

Input suppression while paused already works: `pumpInput` bails on `isSimPaused(room.state)`.

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run packages/client/src/ui/screens/pause.test.ts` then `npm run typecheck -w @motor-combat-moba/client`
Expected: PASS and clean.

- [ ] **Step 8: Full suite**

Run: `npm test`
Expected: green. No existing `ArenaScene`-adjacent test changes — the additions are behind a gate a real match never satisfies.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/ui/screens/pause.ts packages/client/src/ui/screens/pause.test.ts packages/client/src/scenes/ArenaScene.ts packages/client/src/scenes/controlled-car.ts
git commit
```
Message: `feat(client): practice pause menu, gated on the room name (PR22/PR23)`

---

### Task 13: The session summary (spec PR24)

**Files:**
- Create: `packages/client/src/ui/screens/practice-summary.ts`
- Create: `packages/client/src/ui/screens/practice-summary.test.ts`
- Create: `packages/client/src/scenes/PracticeSummaryScene.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (Exit wiring)

**Interfaces:**
- Produces:
  - `interface PracticeSummaryRow { name: string; carId: string; colorId: number; kills: number; deaths: number; isYou: boolean }`
  - `practiceSummaryRows(players, humanSessionId): PracticeSummaryRow[]` (pure, tested)
  - `renderPracticeSummary(rows, handlers: { onBack(): void }): { root: HTMLElement }`
  - Scene key `"practice-summary"`, reading `registry.get("practiceSummary")`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/ui/screens/practice-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { practiceSummaryRows } from "./practice-summary.js";

const players = [
  { sessionId: "abc", name: "Riku", carId: "mirage", colorId: 0, kills: 3, deaths: 1 },
  { sessionId: "bot", name: "Bot", carId: "bastion", colorId: 1, kills: 1, deaths: 3 },
];

describe("practiceSummaryRows", () => {
  it("puts the human first, whatever the map order", () => {
    expect(practiceSummaryRows([...players].reverse(), "abc")[0]!.name).toBe("Riku");
  });

  it("marks exactly one row as you", () => {
    expect(practiceSummaryRows(players, "abc").filter((r) => r.isYou)).toHaveLength(1);
  });

  it("carries kills and deaths through untouched", () => {
    const [you] = practiceSummaryRows(players, "abc");
    expect(you).toMatchObject({ kills: 3, deaths: 1 });
  });

  it("declares no winner — a practice session has no win condition (PR9)", () => {
    const rows = practiceSummaryRows(players, "abc");
    expect(rows.every((row) => !("winner" in row))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/client/src/ui/screens/practice-summary.test.ts`
Expected: FAIL — cannot resolve `./practice-summary.js`.

- [ ] **Step 3: Write the screen module**

```ts
/**
 * The practice session summary (spec PR24).
 *
 * `resultsView()` is NOT reused and NOT modified: a practice session has no winner, no match length
 * and no ranking, and teaching the match's results view about a mode that never ends is the same
 * mistake as reusing `ResultsScene` itself — which would run `bindViewRouter`, route on a `phase`
 * this room pins to MATCH forever, and bounce straight back into the arena.
 *
 * The ROW rendering is shared with `ui/screens/results.ts` — read it first and reuse its row markup
 * and classes so the two screens read as one design.
 */
export interface PracticeSummaryPlayer {
  sessionId: string;
  name: string;
  carId: string;
  colorId: number;
  kills: number;
  deaths: number;
}

export interface PracticeSummaryRow {
  name: string;
  carId: string;
  colorId: number;
  kills: number;
  deaths: number;
  isYou: boolean;
}

/** The human first, then the bot. Two rows, so this is an ordering rule rather than a sort. */
export function practiceSummaryRows(
  players: readonly PracticeSummaryPlayer[],
  humanSessionId: string,
): PracticeSummaryRow[] {
  return players
    .map((p) => ({
      name: p.name,
      carId: p.carId,
      colorId: p.colorId,
      kills: p.kills,
      deaths: p.deaths,
      isYou: p.sessionId === humanSessionId,
    }))
    .sort((a, b) => Number(b.isYou) - Number(a.isYou));
}

export function renderPracticeSummary(
  rows: readonly PracticeSummaryRow[],
  handlers: { onBack(): void },
): { root: HTMLElement } {
  // Header ("Practice session"), the rows, and one btn-primary "Back to practice settings".
  // Reuse results.ts's row markup; no winner banner.
}
```

- [ ] **Step 4: Wire Exit in `ArenaScene`**

The snapshot must be taken **before** `room.leave()` — the state is gone the moment the room is left, the same discipline `ResultsScene.snapshot()` follows:

```ts
private exitPractice(room: Room<ArenaState>): void {
  const players: PracticeSummaryPlayer[] = [];
  room.state.players.forEach((player, sessionId) => {
    players.push({
      sessionId,
      name: player.name,
      carId: player.carId,
      colorId: player.colorId,
      kills: player.kills,
      deaths: player.deaths,
    });
  });
  // Snapshot FIRST, leave SECOND. Reversing these two lines yields an empty summary.
  this.registry.set("practiceSummary", { players, humanSessionId: room.sessionId });
  void room.leave();
  this.registry.remove("room");
  this.scene.start("practice-summary");
}
```

- [ ] **Step 5: Write `PracticeSummaryScene.ts`**

Model it on `JoinScene`'s lifecycle (overlay, `SHUTDOWN` teardown). It reads `registry.get("practiceSummary")`, renders the rows, and its one action starts `"practice-setup"`. If the registry entry is missing — a scene started out of order — fall back to starting `"practice-setup"` immediately rather than rendering an empty table.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run packages/client/src/ui/screens/practice-summary.test.ts` then `npm run typecheck -w @motor-combat-moba/client`
Expected: PASS and clean.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/ui/screens/practice-summary.ts packages/client/src/ui/screens/practice-summary.test.ts packages/client/src/scenes/PracticeSummaryScene.ts packages/client/src/scenes/ArenaScene.ts
git commit
```
Message: `feat(client): practice session summary, snapshot before leave (PR24)`

---

### Task 14: The Practice button, close-code routing, and scene registration (spec PR20, PR25)

The task that makes the feature reachable.

**Files:**
- Modify: `packages/client/src/ui/screens/join.ts`
- Modify: `packages/client/src/ui/screens/join.test.ts` (if one exists; create it if not)
- Modify: `packages/client/src/scenes/JoinScene.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (close-code routing)
- Modify: `packages/client/src/main.ts`

**Interfaces:**
- Consumes: everything from Tasks 9–13.
- Produces: `JoinHandlers` gains `onPractice(name: string): void`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { practiceName } from "./join.js";

describe("practiceName", () => {
  it("uses the typed name", () => {
    expect(practiceName("Riku")).toBe("Riku");
  });

  it("trims surrounding whitespace", () => {
    expect(practiceName("  Riku  ")).toBe("Riku");
  });

  it("falls back to Player on an empty field (PR20)", () => {
    expect(practiceName("")).toBe("Player");
  });

  it("falls back to Player on a whitespace-only field", () => {
    expect(practiceName("   ")).toBe("Player");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/client/src/ui/screens/join.test.ts`
Expected: FAIL — `practiceName` is not exported.

- [ ] **Step 3: Add `practiceName` and the button to `join.ts`**

```ts
/**
 * The name a practice session runs under (spec PR20).
 *
 * Optional by design: practice rooms are per-player, so the arena's uniqueness rule has no
 * counterpart here, and blocking a solo mode behind a text field is friction with no payoff. A
 * player who typed a name sees it in the HUD exactly as in a match; one who did not sees "Player".
 */
export function practiceName(raw: string): string {
  return raw.trim() || "Player";
}
```

Add a `Practice` button (`btn btn-secondary`, same 52px baseline as its neighbours) that calls `handlers.onPractice(practiceName(input.value))`. Extend `JoinHandlers` with `onPractice(name: string): void`.

- [ ] **Step 4: Wire `JoinScene`**

```ts
this.screen = renderJoin({
  onSubmit: (name) => void this.onJoin(name),
  onPractice: (name) => {
    // Stashed for PracticeSetupScene, which supplies it as the join option (PR20). No connection is
    // opened here: nothing validates a practice name, so there is nothing to fail.
    this.registry.set("playerName", name);
    this.scene.start("practice-setup");
  },
});
```

- [ ] **Step 5: Route the practice close codes in `ArenaScene`**

In the `room.onLeave` handler (around line 969), before the existing fallback to `"join"`:

```ts
// 4006 ends a live session (PR25); anything else — a server restart — falls through to the join
// screen as every other scene does. 4007 never reaches here: it refuses a join the player never
// left the settings page for, and PracticeSetupScene shows it inline.
if (code === PRACTICE_IDLE_CLOSE_CODE) {
  this.registry.set("practiceNotice", PRACTICE_IDLE_ERROR);
  this.registry.remove("room");
  this.scene.start("practice-setup");
  return;
}
```

Have `PracticeSetupScene.create` read and clear `practiceNotice`, showing it through `setError`.

Also handle `MSG_PRACTICE_IDLE_WARNING` while in the arena: `room.onMessage(MSG_PRACTICE_IDLE_WARNING, ...)` shows a transient line. Reuse whatever transient-text mechanism `ArenaScene` already has for the "killed by" banner rather than inventing a second one.

- [ ] **Step 6: Register the two scenes in `main.ts`**

```ts
scene: [
  BootScene,
  JoinScene,
  PracticeSetupScene,
  LobbyScene,
  CarSelectScene,
  RevealScene,
  ArenaScene,
  ResultsScene,
  PracticeSummaryScene,
],
```

- [ ] **Step 7: Full suite, typecheck, build**

Run: `npm test`, then `npm run build`
Expected: all green.

- [ ] **Step 8: Verify the release build still refuses dev-only code**

Run: `npm run build:release`
Expected: succeeds. `assertNoDevOnlyCode` must still pass — nothing in this feature carries `DEV_TOOL_MARKER` or lives under `dev/` (PR5). If it fails, a practice module imported something from `dev/`, which is a bug in the import, not in the assertion.

- [ ] **Step 9: Play it**

Run: `npm run dev`, open `http://localhost:5173`, and walk the whole path: type a name (and separately, leave it blank), click Practice, pick a car, an enemy and a difficulty, Start, drive, take a hit, die, respawn, press `P`, Resume, press `P`, Exit, read the summary, Back, Start again. Then check the negative: join a normal lobby and confirm `P` does nothing.

- [ ] **Step 10: Commit**

```bash
git add packages/client/src
git commit
```
Message: `feat(client): Practice button, close-code routing, scene registration (PR20/PR25)`

---

### Task 15: Documentation (spec "What this does not touch")

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/project-structure.md`, `docs/schema-reference.md`, `docs/config-reference.md`

- [ ] **Step 1: Add a `CLAUDE.md` paragraph**

After the playground paragraph, in the same voice as its neighbours — what the thing is, and the one rule that is easy to break:

```markdown
**Practice mode ships; the playground does not.** `PracticeRoom` is a third room type registered on
every server with no `DEV_TOOLS` gate — a player-facing 1v1 against a bot, reached from the join
screen's Practice button. It runs `runPipeline` and the deathmatch respawn helpers verbatim, pins
`phase` to `MATCH` with `mode = FFA_DEATHMATCH` and `matchEndsTick` at 0 (which is what hides the
clock and keeps the kills panel), and **never calls `setTuning`** — the store is process-wide, so a
practice room that touched it would re-balance every other room in the process. The mirror image of
that rule is `shouldRefusePlayground`, which refuses to open a playground while an arena **or a
practice room** has anyone in it. Settings ride as join options, not messages: practice has no
mid-session reconfiguration. See
[`docs/superpowers/specs/2026-09-03-practice-mode-design.md`](docs/superpowers/specs/2026-09-03-practice-mode-design.md).
```

- [ ] **Step 2: Add the docs-table row**

In `CLAUDE.md`'s "Read the right doc" table, beside the playground row:

```markdown
| Practice mode: the shipped 1v1-vs-bot room, its settings page, session limits (PR1–PR31) | [`docs/superpowers/specs/2026-09-03-practice-mode-design.md`](docs/superpowers/specs/2026-09-03-practice-mode-design.md) |
```

- [ ] **Step 3: Update the three reference pages**

- `docs/project-structure.md`: the new files from the File Structure block above.
- `docs/schema-reference.md`: `PracticeState` — `ArenaState` plus `paused`, and why nothing else.
- `docs/config-reference.md`: `PRACTICE_CONFIG`'s three knobs and the `MAX_PRACTICE_ROOMS` env override.

- [ ] **Step 4: Confirm the no-touch claims against the real diff**

Run: `git diff development/main --stat`
Confirm no file under `packages/shared/src/sim/`, `packages/server/src/sim/`, `packages/server/playtest/`, `packages/client/public/manual.html`, or `docs/turn-tuning.md` appears. If any does, the spec's "What this does not touch" section is now wrong — fix the code or amend the section, and say which in the summary.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: green, including `scripts/manual-page.test.mjs` and `scripts/turn-tuning-doc.test.mjs`, both of which prove the untouched claims.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/
git commit
```
Message: `docs: record practice mode, its never-tune rule and the widened playground guard`
