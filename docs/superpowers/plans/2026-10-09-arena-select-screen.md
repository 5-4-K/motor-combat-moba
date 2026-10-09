# Arena Select Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a host-driven arena select screen between the lobby's Start and car select, with a per-mode on/off switch, a 10 s clock, Select / Select random (with a roulette), and a centred reveal of the chosen arena.

**Architecture:** A new room phase `ARENA_SELECT = 5`. The server's decisions (which branch Start takes, which messages are accepted, when the reveal ends) live in a pure module `server/src/rooms/arena-select.ts`; `ArenaRoom` only wires them. On the client a four-layer split keeps the screen ignorant of arenas: an adapter (`arena-cards.ts`) turns arena ids into `{ id, name, previewUrl }` cards, a pure view model and a pure `rouletteFrames` drive a DOM renderer, and a Phaser scene binds it all to room state.

**Tech Stack:** TypeScript, Colyseus schema, Phaser 4 + DOM overlay, vitest. npm workspaces `@motor-combat-moba/{shared,server,client}`.

**Spec:** [`docs/superpowers/specs/2026-10-09-arena-select-screen-design.md`](../specs/2026-10-09-arena-select-screen-design.md) (AR1–AR40). Read it before starting any task.

## Global Constraints

- Enum wire values are explicit and never renumbered: `RoomPhase.ARENA_SELECT = 5` is appended (invariant 7).
- No magic numbers in logic: every duration comes from the mode's `flow` table, read through an accessor or the room's mode bundle, never captured at module scope.
- Clients send intents only (`MSG_ARENA_HIGHLIGHT`, `MSG_ARENA_PICK`); the server decides, including the random draw (invariant 3).
- Shared is consumed as built `dist`: after editing `packages/shared`, run `npm run build -w @motor-combat-moba/shared` before server/client typecheck or tests. Build everything with root `npm run build`, never `--workspaces`.
- This worktree must have its own `node_modules`: run `npm install` at the worktree root once before the first build.
- Display names: "Arena 01", "Arena 02", "Arena 03".
- Base `flow` values: `arenaSelectEnabled: true`, `arenaSelectSeconds: 10`, `arenaRevealSeconds: 3`, `arenaRouletteSeconds: 1.5`.
- `PROTOCOL_VERSION` 8 → 9.
- Preview art key `arena.<arenaId>.preview`, file `arenas/<arenaId>/preview.png`, 16:9. No preview art is added in this plan.
- Copy: header "Choose the arena"; clock label "Picks in"; host status "Choose an arena, then Select."; watcher status "The host is choosing the arena."; buttons "Select random", "Select"; reveal heading "Arena selected"; reveal count "Car select in N".
- Never run the slow tests (`src/bot/**`, `balance/match.test.ts`, `balance/runner.test.ts`) inside a task; they run once in Task 8. Never read or edit anything under `docs/ideas/` or `docs/invariants/`.
- Do not edit `packages/server/playtest/lan.ts` (AR40): it is flagged to the user, not changed.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/shared/src/arena/types.ts` | modify | `ArenaDef.displayName` |
| `packages/shared/src/arena/tiles/compile.ts` | modify | `TileArenaSource.displayName`, passed through |
| `packages/shared/src/arena/arena-0{1,2,3}.ts` | modify | seed names |
| `packages/shared/src/arena/display-names.test.ts` | create | AR2 |
| `packages/shared/src/config/flow-config.ts` | modify | four `flow` keys |
| `packages/shared/src/modes/__snapshots__/*.tables.json` | regenerate | four snapshots move |
| `packages/shared/src/constants.ts` | modify | `RoomPhase.ARENA_SELECT`, `PROTOCOL_VERSION` 9 |
| `packages/shared/src/flow/match-flow.ts` | modify | `"arena_select"` phase, `start.firstPhase`, `begin_car_select` |
| `packages/shared/src/lobby/status.ts` | modify | `ViewId "arena_select"`, `viewFor` |
| `packages/shared/src/schema/ArenaState.ts` | modify | four fields |
| `packages/shared/src/net/lobby-messages.ts` | modify | two messages + guards |
| `packages/shared/src/index.ts` | modify | exports |
| `packages/client/src/net/view.ts` | modify | `VIEW_TO_SCENE.arena_select` |
| `packages/server/src/rooms/flow-map.ts` | modify | map the phase |
| `packages/server/src/rooms/arena-select.ts` | create | pure server decisions |
| `packages/server/src/rooms/arena-select.test.ts` | create | its tests |
| `packages/server/src/rooms/ArenaRoom.ts` | modify | wiring |
| `packages/server/src/rooms/arena-select-room.test.ts` | create | white-box room tests |
| `packages/client/src/assets/asset-keys.ts` | modify | `arenaPreviewKey` |
| `packages/client/src/ui/arena-cards.ts` | create | the adapter |
| `packages/client/src/ui/roulette.ts` | create | `rouletteFrames` |
| `packages/client/src/ui/arena-select-view.ts` | create | the pure view model |
| `packages/client/src/ui/screens/arena-select.ts` | create | DOM renderer |
| `packages/client/src/ui/organic.css` | modify | reveal keyframes |
| `packages/client/src/scenes/ArenaSelectScene.ts` | create | scene |
| `packages/client/src/main.ts` | modify | register the scene |
| docs (see Task 8) | modify | |

---

### Task 1: Arena display names

**Files:**
- Modify: `packages/shared/src/arena/types.ts` (the `ArenaDef` interface, ~line 63)
- Modify: `packages/shared/src/arena/tiles/compile.ts` (`TileArenaSource` ~line 8, `compileTileArena` ~line 90)
- Modify: `packages/shared/src/arena/arena-01.ts`, `arena-02.ts`, `arena-03.ts`
- Create: `packages/shared/src/arena/display-names.test.ts`
- Modify: every other `ArenaDef` / `TileArenaSource` object literal the compiler flags (test fixtures in shared, server and client)

**Interfaces:**
- Produces: `ArenaDef.displayName: string` (required); `TileArenaSource.displayName: string` (required).

- [ ] **Step 1: Write the failing test** — `packages/shared/src/arena/display-names.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ARENAS } from "./registry.js";

/**
 * AR2: the arena select screen shows `displayName`, so two arenas a player cannot tell apart by name
 * are a bug. Compared trimmed and case-folded — "Arena 01" and "arena 01 " are the same name to a
 * player.
 */
describe("arena display names (AR2)", () => {
  const rows = Object.entries(ARENAS).map(([id, def]) => ({ id, name: def.displayName }));

  it.each(rows)("$id has a non-blank display name", ({ name }) => {
    expect(typeof name).toBe("string");
    expect(name.trim().length).toBeGreaterThan(0);
  });

  it("no two arenas share a display name, ignoring case and surrounding space", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const { id, name } of rows) {
      const key = name.trim().toLowerCase();
      const other = seen.get(key);
      if (other !== undefined) clashes.push(`${other} and ${id} are both "${name.trim()}"`);
      else seen.set(key, id);
    }
    expect(clashes).toEqual([]);
  });

  it("seeds names from the id (AR1)", () => {
    expect(ARENAS["arena-01"].displayName).toBe("Arena 01");
    expect(ARENAS["arena-02"].displayName).toBe("Arena 02");
    expect(ARENAS["arena-03"].displayName).toBe("Arena 03");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/shared && npx vitest run src/arena/display-names.test.ts`
Expected: FAIL — `displayName` is `undefined`.

- [ ] **Step 3: Implement**

In `types.ts`, add to `ArenaDef` right after `id`:

```ts
  /**
   * What players read on the arena select screen (AR1). Unique across `ARENAS`, ignoring case and
   * surrounding space — `display-names.test.ts` holds it. Never used as a key: `id` is the key.
   */
  displayName: string;
```

In `tiles/compile.ts`, add `readonly displayName: string;` to `TileArenaSource` after `id`, and `displayName: src.displayName,` in `compileTileArena`'s returned object after `id: src.id,`.

In `arena-01.ts` add `displayName: "Arena 01",` after `id: "arena-01",` (inside the `compileTileArena({...})` source). In `arena-02.ts` add `displayName: "Arena 02",` after `id: "arena-02",`; in `arena-03.ts` `displayName: "Arena 03",` after `id: "arena-03",`.

- [ ] **Step 4: Fix every other literal the compiler flags**

Run: `cd packages/shared && npx tsc --noEmit -p .` — for each "Property 'displayName' is missing" error, add `displayName: "<something unique to that fixture>"` (e.g. `displayName: "Test arena"`). Then from the worktree root `npm run build -w @motor-combat-moba/shared`, then `cd packages/server && npx tsc --noEmit -p .` and `cd packages/client && npx tsc --noEmit -p .`, fixing fixtures the same way. (If a package has no `tsconfig.json` at its root, use the package's `typecheck` script from its `package.json` instead.)

- [ ] **Step 5: Run the shared suite**

Run: `cd packages/shared && npx vitest run`
Expected: PASS (the new file included).

- [ ] **Step 6: Commit**

```bash
git add -A packages
git commit -m "feat(arena): display names on ArenaDef, unique case-insensitively (AR1-AR2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Per-mode arena-select config

**Files:**
- Modify: `packages/shared/src/config/flow-config.ts`
- Modify: `packages/shared/src/config/config.test.ts` (near line 299, beside the existing `FLOW_CONFIG` asserts)
- Regenerate: `packages/shared/src/modes/__snapshots__/*.tables.json` (four files)

**Interfaces:**
- Produces: `flow().arenaSelectEnabled: boolean`, `flow().arenaSelectSeconds: number`, `flow().arenaRevealSeconds: number`, `flow().arenaRouletteSeconds: number`.

- [ ] **Step 1: Write the failing test** — in `config.test.ts`, inside the describe block that holds `expect(FLOW_CONFIG.carSelectSeconds).toBe(60);`, add:

```ts
  it("carries the arena select screen's base values (AR6)", () => {
    expect(FLOW_CONFIG.arenaSelectEnabled).toBe(true);
    expect(FLOW_CONFIG.arenaSelectSeconds).toBe(10);
    expect(FLOW_CONFIG.arenaRevealSeconds).toBe(3);
    expect(FLOW_CONFIG.arenaRouletteSeconds).toBe(1.5);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/shared && npx vitest run src/config/config.test.ts`
Expected: FAIL — properties undefined.

- [ ] **Step 3: Implement** — `flow-config.ts` becomes:

```ts
export type FlowConfig = typeof FLOW_CONFIG;

export const FLOW_CONFIG = {
  carSelectSeconds: 60,
  /** How long the "cars locked in" grid holds before the match countdown starts. */
  revealSeconds: 10,
  countdownSeconds: 3,
  nameMin: 1,
  nameMax: 16,
  /**
   * Whether Start opens the arena select screen (AR6). Widened to `boolean` so a mode's `config.ts`
   * can override it to `false` — `as const` would pin the literal `true`. Off means the match plays
   * the mode's `arenas[0]` and goes straight to car select, as before the screen existed.
   */
  arenaSelectEnabled: true as boolean,
  /** The host's choosing clock. At its end the highlighted arena is picked. */
  arenaSelectSeconds: 10,
  /** How long the chosen arena's card holds in the centre before car select. */
  arenaRevealSeconds: 3,
  /** Added to the reveal when the pick was Select random, so the roulette has time to spin. */
  arenaRouletteSeconds: 1.5,
} as const;
```

- [ ] **Step 4: Run config test, then the snapshot test**

Run: `cd packages/shared && npx vitest run src/config/config.test.ts` → PASS.
Run: `cd packages/shared && npx vitest run src/modes/snapshots.test.ts` → FAIL on all four modes (expected: base `flow` edit, AR7).

- [ ] **Step 5: Accept the four moved snapshots and inspect them**

Run: `cd packages/shared && npx vitest run src/modes/snapshots.test.ts -u`
Run: `git diff --stat packages/shared/src/modes/__snapshots__` — exactly four files; `git diff packages/shared/src/modes/__snapshots__` shows only the four new `flow.arena*` keys added in each. If anything else moved, stop and report.

- [ ] **Step 6: Run the shared suite and the scripts suite**

Run: `cd packages/shared && npx vitest run` → PASS. From the worktree root: `npm run build -w @motor-combat-moba/shared && npm run test:scripts` → PASS (confirms AR8: the guide's stamp does not hash `flow`). If `manual-page.test.mjs` fails asking for `build:manual`, stop and report — AR8 was wrong.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(flow): per-mode arena select switch and timings (AR5-AR8)

Base flow table edit: all four mode snapshots move by exactly the four new keys.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared contract — phase, reducer, routing, schema, messages

**Files:**
- Modify: `packages/shared/src/constants.ts` (`RoomPhase`, `PROTOCOL_VERSION` and its doc comment)
- Modify: `packages/shared/src/flow/match-flow.ts`, `packages/shared/src/flow/match-flow.test.ts`
- Modify: `packages/shared/src/lobby/status.ts`, `packages/shared/src/lobby/status.test.ts`
- Modify: `packages/shared/src/schema/ArenaState.ts`
- Modify: `packages/shared/src/net/lobby-messages.ts`, `packages/shared/src/net/lobby-messages.test.ts`
- Modify: `packages/shared/src/index.ts` (the `./net/lobby-messages.js` export block, ~lines 55-65)
- Modify: `packages/client/src/net/view.ts` (keeps the client compiling: `Record<ViewId, string>` is exhaustive)
- Modify: `packages/server/src/rooms/flow-map.ts` signatures only if the compiler requires it (mapping is Task 4)
- Modify: `packages/server/src/rooms/protocol-version.test.ts` only if it pins the number 8 literally

**Interfaces:**
- Produces:
  - `RoomPhase.ARENA_SELECT = 5`
  - `FlowState.phase` includes `"arena_select"`
  - `FlowEvent` `start` gains optional `firstPhase?: "arena_select" | "car_select"` (absent means `"car_select"`)
  - `FlowEvent` `{ type: "begin_car_select"; nowTick: number; carSelectTicks: number }`
  - `ViewId` includes `"arena_select"`; `viewFor(in_match, ARENA_SELECT) === "arena_select"`
  - `ArenaState.arenaHighlightId: string`, `arenaSelectDeadlineTick: number`, `arenaRevealEndsTick: number`, `arenaPickRandom: boolean`
  - `MSG_ARENA_HIGHLIGHT = "arena_highlight"`, `MSG_ARENA_PICK = "arena_pick"`
  - `isArenaHighlightPayload(msg: unknown): msg is { arenaId: string }`
  - `isArenaPickPayload(msg: unknown): msg is { arenaId: string } | { random: true }`

- [ ] **Step 1: Write the failing tests**

Append to `match-flow.test.ts` (reuses its `player` and `lobbyState` helpers; if `FlowState` requires `revealEndsTick` and `lobbyState` lacks it, add `revealEndsTick: 0` there):

```ts
describe("arena select (AR15)", () => {
  const ready = () => lobbyState([player({ sessionId: "a" }), player({ sessionId: "b" })]);

  it("start with firstPhase arena_select forms the roster without a car-select deadline", () => {
    const next = reduceFlow(ready(), {
      type: "start", readyIds: ["a", "b"], nowTick: 100, carSelectTicks: 3600, firstPhase: "arena_select",
    });
    expect(next.phase).toBe("arena_select");
    expect(next.roster).toEqual(["a", "b"]);
    expect(next.carSelectDeadlineTick).toBe(0);
    expect(next.players.every((p) => p.status === "in_match")).toBe(true);
  });

  it("start without firstPhase still goes straight to car_select", () => {
    const next = reduceFlow(ready(), { type: "start", readyIds: ["a", "b"], nowTick: 100, carSelectTicks: 3600 });
    expect(next.phase).toBe("car_select");
    expect(next.carSelectDeadlineTick).toBe(3700);
  });

  it("begin_car_select moves arena_select to car_select and starts the car clock then", () => {
    const picking = reduceFlow(ready(), {
      type: "start", readyIds: ["a", "b"], nowTick: 100, carSelectTicks: 3600, firstPhase: "arena_select",
    });
    const next = reduceFlow(picking, { type: "begin_car_select", nowTick: 900, carSelectTicks: 3600 });
    expect(next.phase).toBe("car_select");
    expect(next.carSelectDeadlineTick).toBe(4500);
    expect(next.roster).toEqual(["a", "b"]);
  });

  it("begin_car_select outside arena_select is a no-op", () => {
    const lobby = ready();
    expect(reduceFlow(lobby, { type: "begin_car_select", nowTick: 5, carSelectTicks: 60 })).toBe(lobby);
  });
});
```

Append to `status.test.ts` (match its imports: `viewFor`, `RoomPhase`, `PlayerStatus`):

```ts
describe("arena select routing (AR25)", () => {
  it("routes an in-match player to arena_select", () => {
    expect(viewFor("in_match", RoomPhase.ARENA_SELECT)).toBe("arena_select");
    expect(viewFor(PlayerStatus.IN_MATCH, RoomPhase.ARENA_SELECT)).toBe("arena_select");
  });
  it("keeps a lobby player in the lobby", () => {
    expect(viewFor("ready", RoomPhase.ARENA_SELECT)).toBe("lobby");
  });
  it("keeps the wire value", () => {
    expect(RoomPhase.ARENA_SELECT).toBe(5);
  });
});
```

Append to `lobby-messages.test.ts` (add the new names to its import):

```ts
describe("arena select messages (AR16)", () => {
  it("names the wire messages", () => {
    expect(MSG_ARENA_HIGHLIGHT).toBe("arena_highlight");
    expect(MSG_ARENA_PICK).toBe("arena_pick");
  });

  it("guards the highlight payload", () => {
    expect(isArenaHighlightPayload({ arenaId: "arena-01" })).toBe(true);
    expect(isArenaHighlightPayload({ arenaId: 3 })).toBe(false);
    expect(isArenaHighlightPayload({})).toBe(false);
    expect(isArenaHighlightPayload(null)).toBe(false);
    expect(isArenaHighlightPayload(Object.create({ arenaId: "arena-01" }))).toBe(false);
  });

  it("guards the pick payload", () => {
    expect(isArenaPickPayload({ arenaId: "arena-02" })).toBe(true);
    expect(isArenaPickPayload({ random: true })).toBe(true);
    expect(isArenaPickPayload({ random: false })).toBe(false);
    expect(isArenaPickPayload({ random: "yes" })).toBe(false);
    expect(isArenaPickPayload({ arenaId: 1 })).toBe(false);
    expect(isArenaPickPayload("arena-01")).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/shared && npx vitest run src/flow/match-flow.test.ts src/lobby/status.test.ts src/net/lobby-messages.test.ts`
Expected: FAIL (missing names / wrong phase).

- [ ] **Step 3: Implement**

`constants.ts` — add to `RoomPhase` after `REVEAL = 4,`:

```ts
  /**
   * The host choosing the match's arena, then that arena's reveal, between Start and car select
   * (arena select screen spec, AR9). Appended with an explicit 5 for the same reason REVEAL was.
   */
  ARENA_SELECT = 5,
```

Change `export const PROTOCOL_VERSION = 8;` to `9`, and append to its doc comment, after the sentence ending "…so a client of 7 would draw no impact for any shot that lived.":

```
 * 9 adds `RoomPhase.ARENA_SELECT` and the four arena-select `ArenaState` fields (AR11–AR12); a client
 * of 8 would route that phase to its lobby fallback and never leave it.
```

`match-flow.ts`:
- `FlowState.phase` type: `"lobby" | "arena_select" | "car_select" | "reveal" | "countdown" | "match"`.
- `start` event: `{ type: "start"; readyIds: string[]; nowTick: number; carSelectTicks: number; firstPhase?: "arena_select" | "car_select" }`.
- Add `| { type: "begin_car_select"; nowTick: number; carSelectTicks: number }` to `FlowEvent`.
- In `reduceFlow`, add:

```ts
    case "begin_car_select":
      if (state.phase !== "arena_select") return state;
      return {
        ...state,
        phase: "car_select",
        carSelectDeadlineTick: event.nowTick + event.carSelectTicks,
      };
```

- In `applyStart`, declare `const arenaFirst = event.firstPhase === "arena_select";` at the top, and replace the two lines `phase: "car_select",` / `carSelectDeadlineTick: event.nowTick + event.carSelectTicks,` with:

```ts
    // AR15: with the arena select screen on, the car-select clock starts when car select opens
    // (`begin_car_select`), not here.
    phase: arenaFirst ? "arena_select" : "car_select",
    carSelectDeadlineTick: arenaFirst ? 0 : event.nowTick + event.carSelectTicks,
```

`status.ts`: `ViewId` becomes `"lobby" | "arena_select" | "car_select" | "reveal" | "match" | "results"`; in `viewFor`, before the `CAR_SELECT` line add `if (phase === RoomPhase.ARENA_SELECT) return "arena_select";`.

`ArenaState.ts` — after `countdownEndsTick`, add:

```ts
  /**
   * Arena select (AR11). Room-flow display state only — `stepSim` reads none of these. The arena
   * the host's highlight sits on, mirrored to every client so watchers see it move.
   */
  @type("string") arenaHighlightId = "";
  /** When the host's choosing clock runs out. */
  @type("uint32") arenaSelectDeadlineTick = 0;
  /** 0 while choosing; the tick the reveal ends once a pick has landed. */
  @type("uint32") arenaRevealEndsTick = 0;
  /** The pick came from Select random, so clients play the roulette before the reveal. */
  @type("boolean") arenaPickRandom = false;
```

`lobby-messages.ts` — append:

```ts
/** Host only, during ARENA_SELECT: move the highlight. Never commits (AR16). */
export const MSG_ARENA_HIGHLIGHT = "arena_highlight";
/** Host only, during ARENA_SELECT: commit a named arena, or ask the server to draw one at random. */
export const MSG_ARENA_PICK = "arena_pick";

/** Wire shape only; whether the arena is in the mode's list is the room's question. */
export function isArenaHighlightPayload(msg: unknown): msg is { arenaId: string } {
  if (msg === null || typeof msg !== "object") return false;
  if (!Object.hasOwn(msg, "arenaId")) return false;
  return typeof (msg as { arenaId: unknown }).arenaId === "string";
}

/** `{ arenaId }` or exactly `{ random: true }`. */
export function isArenaPickPayload(msg: unknown): msg is { arenaId: string } | { random: true } {
  if (isArenaHighlightPayload(msg)) return true;
  if (msg === null || typeof msg !== "object") return false;
  return Object.hasOwn(msg, "random") && (msg as { random: unknown }).random === true;
}
```

`index.ts` — add `MSG_ARENA_HIGHLIGHT, MSG_ARENA_PICK, isArenaHighlightPayload, isArenaPickPayload,` to the `./net/lobby-messages.js` export block.

`client/src/net/view.ts` — add `arena_select: "arena_select",` to `VIEW_TO_SCENE` after `lobby`.

- [ ] **Step 4: Run the tests, rebuild, typecheck downstream**

Run: `cd packages/shared && npx vitest run` → PASS.
Then from root: `npm run build -w @motor-combat-moba/shared`; typecheck server and client. Fix only compile errors this task caused — e.g. if `flow-map.ts`'s spelled-out phase union no longer accepts `FlowState["phase"]`, widen its parameter/return unions to include `"arena_select"` (the actual mapping lines are Task 4). Run `cd packages/server && npx vitest run src/rooms/protocol-version.test.ts`; if it pins `8`, change it to `9`.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(flow): ARENA_SELECT phase, schema fields and messages (AR9-AR16, AR25)

PROTOCOL_VERSION 8 -> 9.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server decisions as a pure module

**Files:**
- Modify: `packages/server/src/rooms/flow-map.ts`, `packages/server/src/rooms/flow-map.test.ts`
- Create: `packages/server/src/rooms/arena-select.ts`
- Create: `packages/server/src/rooms/arena-select.test.ts`

**Interfaces:**
- Consumes: Task 3's `RoomPhase.ARENA_SELECT`, `isArenaHighlightPayload`, `isArenaPickPayload`.
- Produces (all from `arena-select.ts`):

```ts
export type ArenaSelectOpening =
  | { kind: "skip"; arenaId: string }
  | { kind: "choose"; highlightId: string }
  | { kind: "reveal"; arenaId: string };
export function openArenaSelect(enabled: boolean, arenas: readonly string[]): ArenaSelectOpening;

export interface ArenaSelectGate {
  senderId: string;
  hostSessionId: string;
  senderOnRoster: boolean;
  phase: RoomPhase;
  arenaRevealEndsTick: number;
  arenas: readonly string[];
}
export function acceptHighlight(gate: ArenaSelectGate, msg: unknown): string | null;
export interface ArenaPick { arenaId: string; random: boolean }
export function acceptPick(gate: ArenaSelectGate, msg: unknown, rand: () => number): ArenaPick | null;

export interface RevealTiming { arenaRevealSeconds: number; arenaRouletteSeconds: number }
export function revealEndsTickFor(nowTick: number, timing: RevealTiming, random: boolean): number;
```

- [ ] **Step 1: Write the failing tests**

In `flow-map.test.ts` add (match its existing imports):

```ts
it("maps ARENA_SELECT both ways (AR10)", () => {
  expect(toFlowPhase(RoomPhase.ARENA_SELECT)).toBe("arena_select");
  expect(fromFlowPhase("arena_select")).toBe(RoomPhase.ARENA_SELECT);
});
```

`arena-select.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RoomPhase, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import {
  acceptHighlight,
  acceptPick,
  openArenaSelect,
  revealEndsTickFor,
  type ArenaSelectGate,
} from "./arena-select.js";

const TWO = ["arena-01", "arena-02"] as const;
const gate = (over: Partial<ArenaSelectGate> = {}): ArenaSelectGate => ({
  senderId: "host",
  hostSessionId: "host",
  senderOnRoster: true,
  phase: RoomPhase.ARENA_SELECT,
  arenaRevealEndsTick: 0,
  arenas: TWO,
  ...over,
});
const TIMING = { arenaRevealSeconds: 3, arenaRouletteSeconds: 1.5 };

describe("openArenaSelect (AR13)", () => {
  it("skips the screen when the mode turns it off, playing arenas[0]", () => {
    expect(openArenaSelect(false, TWO)).toEqual({ kind: "skip", arenaId: "arena-01" });
  });
  it("opens choosing on arenas[0] when there are two or more", () => {
    expect(openArenaSelect(true, TWO)).toEqual({ kind: "choose", highlightId: "arena-01" });
  });
  it("goes straight to the reveal with one arena", () => {
    expect(openArenaSelect(true, ["arena-03"])).toEqual({ kind: "reveal", arenaId: "arena-03" });
  });
});

describe("acceptHighlight (AR16)", () => {
  it("accepts the host naming an arena in the list", () => {
    expect(acceptHighlight(gate(), { arenaId: "arena-02" })).toBe("arena-02");
  });
  it.each([
    ["a non-host", gate({ senderId: "other" })],
    ["a host who is not on the roster", gate({ senderOnRoster: false })],
    ["the wrong phase", gate({ phase: RoomPhase.CAR_SELECT })],
    ["after the pick", gate({ arenaRevealEndsTick: 500 })],
  ])("refuses %s", (_label, g) => {
    expect(acceptHighlight(g, { arenaId: "arena-02" })).toBeNull();
  });
  it("refuses an arena outside the mode's list", () => {
    expect(acceptHighlight(gate(), { arenaId: "arena-03" })).toBeNull();
  });
  it("refuses a malformed payload", () => {
    expect(acceptHighlight(gate(), { arenaId: 7 })).toBeNull();
    expect(acceptHighlight(gate(), null)).toBeNull();
  });
});

describe("acceptPick (AR16, AR18)", () => {
  const never = () => {
    throw new Error("rand must not be called for a named pick");
  };
  it("accepts a named arena, not random", () => {
    expect(acceptPick(gate(), { arenaId: "arena-02" }, never)).toEqual({ arenaId: "arena-02", random: false });
  });
  it("draws a random pick on the server, inside the list", () => {
    expect(acceptPick(gate(), { random: true }, () => 0)).toEqual({ arenaId: "arena-01", random: true });
    expect(acceptPick(gate(), { random: true }, () => 0.999999)).toEqual({ arenaId: "arena-02", random: true });
  });
  it("never lands outside the list, whatever rand returns in [0, 1)", () => {
    for (let i = 0; i < 100; i++) {
      const r = i / 100;
      expect(TWO).toContain(acceptPick(gate(), { random: true }, () => r)?.arenaId);
    }
  });
  it.each([
    ["a non-host", gate({ senderId: "other" })],
    ["a host who is not on the roster", gate({ senderOnRoster: false })],
    ["the wrong phase", gate({ phase: RoomPhase.LOBBY })],
    ["after the pick", gate({ arenaRevealEndsTick: 1 })],
  ])("refuses %s", (_label, g) => {
    expect(acceptPick(g, { random: true }, () => 0)).toBeNull();
    expect(acceptPick(g, { arenaId: "arena-01" }, () => 0)).toBeNull();
  });
  it("refuses an arena outside the list and a malformed payload", () => {
    expect(acceptPick(gate(), { arenaId: "arena-03" }, () => 0)).toBeNull();
    expect(acceptPick(gate(), { random: false }, () => 0)).toBeNull();
  });
});

describe("reveal timing (AR17)", () => {
  it("holds the reveal for arenaRevealSeconds after a named pick", () => {
    expect(revealEndsTickFor(1000, TIMING, false)).toBe(1000 + 3 * TICK_RATE_HZ);
  });
  it("adds the roulette's time after a random pick", () => {
    expect(revealEndsTickFor(1000, TIMING, true)).toBe(1000 + Math.ceil(4.5 * TICK_RATE_HZ));
  });
  it("rounds up to a whole tick", () => {
    expect(Number.isInteger(revealEndsTickFor(0, { arenaRevealSeconds: 0.01, arenaRouletteSeconds: 0 }, false))).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/server && npx vitest run src/rooms/arena-select.test.ts src/rooms/flow-map.test.ts`
Expected: FAIL (module not found / mapping missing).

- [ ] **Step 3: Implement**

`flow-map.ts`: phase unions include `"arena_select"` (prefer importing `type FlowState` from shared and using `FlowState["phase"]`); in `toFlowPhase` add `if (phase === RoomPhase.ARENA_SELECT) return "arena_select";` first; in `fromFlowPhase` add `if (phase === "arena_select") return RoomPhase.ARENA_SELECT;` first.

`arena-select.ts`:

```ts
import {
  RoomPhase,
  TICK_RATE_HZ,
  isArenaHighlightPayload,
  isArenaPickPayload,
} from "@motor-combat-moba/shared";

/**
 * The arena select screen's server decisions (spec AR13-AR18), kept pure so they are tested without
 * standing up a room. `ArenaRoom` reads the mode's `flow` and `arenas`, asks these, and writes state;
 * nothing here touches the room.
 */

export type ArenaSelectOpening =
  | { kind: "skip"; arenaId: string }
  | { kind: "choose"; highlightId: string }
  | { kind: "reveal"; arenaId: string };

/**
 * What Start does (AR13): off plays `arenas[0]` straight into car select; one arena is decided
 * already, so only its reveal shows; two or more open the host's choice on `arenas[0]`.
 * `modes/invariants.test.ts` already guarantees the list is non-empty.
 */
export function openArenaSelect(enabled: boolean, arenas: readonly string[]): ArenaSelectOpening {
  const first = arenas[0];
  if (first === undefined) throw new Error("A mode's arena list is empty");
  if (!enabled) return { kind: "skip", arenaId: first };
  if (arenas.length === 1) return { kind: "reveal", arenaId: first };
  return { kind: "choose", highlightId: first };
}

export interface ArenaSelectGate {
  senderId: string;
  hostSessionId: string;
  /**
   * AR20: a host inherited from the lobby (not on this match's roster) is not looking at the screen,
   * so they may not pick; the clock decides instead.
   */
  senderOnRoster: boolean;
  phase: RoomPhase;
  arenaRevealEndsTick: number;
  arenas: readonly string[];
}

function mayAct(gate: ArenaSelectGate): boolean {
  return (
    gate.senderId === gate.hostSessionId &&
    gate.senderOnRoster &&
    gate.phase === RoomPhase.ARENA_SELECT &&
    gate.arenaRevealEndsTick === 0
  );
}

/** The arena to highlight, or null when the message is refused. */
export function acceptHighlight(gate: ArenaSelectGate, msg: unknown): string | null {
  if (!isArenaHighlightPayload(msg) || !mayAct(gate)) return null;
  return gate.arenas.includes(msg.arenaId) ? msg.arenaId : null;
}

export interface ArenaPick {
  arenaId: string;
  random: boolean;
}

/**
 * The pick, or null when refused. A random pick is drawn HERE, on the server, so every client sees
 * the same arena (AR18). `rand` returns [0, 1), like `Math.random`.
 */
export function acceptPick(gate: ArenaSelectGate, msg: unknown, rand: () => number): ArenaPick | null {
  if (!isArenaPickPayload(msg) || !mayAct(gate)) return null;
  if (isArenaHighlightPayload(msg)) {
    return gate.arenas.includes(msg.arenaId) ? { arenaId: msg.arenaId, random: false } : null;
  }
  const index = Math.min(gate.arenas.length - 1, Math.floor(rand() * gate.arenas.length));
  return { arenaId: gate.arenas[index], random: true };
}

export interface RevealTiming {
  arenaRevealSeconds: number;
  arenaRouletteSeconds: number;
}

/** AR17: the reveal's end, with the roulette's time added in front of it after a random pick. */
export function revealEndsTickFor(nowTick: number, timing: RevealTiming, random: boolean): number {
  const seconds = timing.arenaRevealSeconds + (random ? timing.arenaRouletteSeconds : 0);
  return nowTick + Math.ceil(seconds * TICK_RATE_HZ);
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/server && npx vitest run src/rooms/arena-select.test.ts src/rooms/flow-map.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/rooms/arena-select.ts packages/server/src/rooms/arena-select.test.ts packages/server/src/rooms/flow-map.ts packages/server/src/rooms/flow-map.test.ts
git commit -m "feat(server): arena select decisions as a pure module (AR13-AR18, AR20)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire arena select into ArenaRoom

**Files:**
- Modify: `packages/server/src/rooms/ArenaRoom.ts` — the `MSG_START_MATCH` handler (~lines 264-297), `step()` (~lines 502-542), new handlers and methods
- Create: `packages/server/src/rooms/arena-select-room.test.ts`

**Interfaces:**
- Consumes: Task 4's `openArenaSelect`, `acceptHighlight`, `acceptPick`, `revealEndsTickFor`, `ArenaSelectGate`; Task 3's `MSG_ARENA_HIGHLIGHT`, `MSG_ARENA_PICK`, `start.firstPhase`, `begin_car_select`; Task 2's `flow()` keys.
- Produces (private; the test reaches them white-box):
  - field `arenaRandom: () => number` (default `Math.random`)
  - `beginMatch(readyIds: string[]): void` — everything `MSG_START_MATCH` did after `canStart` passed, plus the arena branch
  - `onArenaHighlight(sessionId: string, msg: unknown): void`
  - `onArenaPick(sessionId: string, msg: unknown): void`
  - `pickArena(arenaId: string, random: boolean): void`
  - `advanceFlow(): void` — the phase-deadline chain of `step()`, extracted unchanged, with the two arena branches added in front

- [ ] **Step 1: Confirm two names before writing code**

Read `packages/server/src/rooms/match-helpers.ts` `resolveSetMode` (~line 69-82): it reads the mode's arena list as `config.arenas` or `config.tables.arenas` — use that exact path everywhere this plan writes `<config>.arenas`. Read `packages/shared/src/modes/` for `applyOverrides`' signature (used by the playground to build a tuned sibling bundle) — the test below assumes `applyOverrides(config, { flow: { arenaSelectEnabled: false } })` returns a `ModeConfig`; adapt the call to the real signature.

- [ ] **Step 2: Write the failing white-box tests** — `arena-select-room.test.ts`. Same harness style as `view-leak.test.ts` (no `onCreate`; state and `modeConfig` set by hand):

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  ArenaState,
  GameMode,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  applyOverrides,
  installMode,
  modeConfigOf,
  withMode,
  type ModeConfig,
} from "@motor-combat-moba/shared";
import { ArenaRoom } from "./ArenaRoom.js";

/**
 * White-box, like `view-leak.test.ts`: no `onCreate` (matchmaker, transport). The room's
 * `modeConfig` and state are set by hand and the private seams Task 5 extracted are driven directly.
 */
interface Harness {
  state: ArenaState;
  modeConfig: ModeConfig;
  arenaRandom: () => number;
  setState(state: unknown): void;
  beginMatch(readyIds: string[]): void;
  onArenaHighlight(sessionId: string, msg: unknown): void;
  onArenaPick(sessionId: string, msg: unknown): void;
  advanceFlow(): void;
}

function room(config: ModeConfig, ids: string[] = ["host", "guest"]) {
  const r = new ArenaRoom() as unknown as Harness;
  const state = new ArenaState();
  state.mode = config.id;
  r.setState(state);
  r.modeConfig = config;
  ids.forEach((id, i) => {
    const p = new PlayerState();
    p.sessionId = id;
    p.name = id;
    p.status = PlayerStatus.READY;
    p.joinedAtTick = i;
    state.players.set(id, p);
  });
  state.hostSessionId = ids[0];
  const run = <T>(fn: () => T): T => withMode(config, fn);
  const start = (readyIds: string[] = ids) => run(() => r.beginMatch(readyIds));
  /** Sets the room's tick and runs the flow deadlines once, as `step()` would. */
  const at = (tick: number) =>
    run(() => {
      r.state.tick = tick;
      r.advanceFlow();
    });
  return { r, state, run, start, at };
}

const brawl = () => modeConfigOf(GameMode.FFA_LAST_STANDING);
const conquer = () => modeConfigOf(GameMode.CONQUER);

beforeEach(() => installMode(brawl()));

describe("Start (AR13-AR14)", () => {
  it("opens ARENA_SELECT on arenas[0] with the choosing clock running", () => {
    const { state, start } = room(brawl());
    state.tick = 100;
    start();
    expect(state.phase).toBe(RoomPhase.ARENA_SELECT);
    expect(state.arenaHighlightId).toBe("arena-01");
    expect(state.arenaSelectDeadlineTick).toBe(100 + 10 * TICK_RATE_HZ);
    expect(state.arenaRevealEndsTick).toBe(0);
    expect(state.players.get("guest")?.status).toBe(PlayerStatus.IN_MATCH);
  });

  it("with one arena, lands the pick at once and shows only the reveal", () => {
    const { state, start } = room(conquer(), ["h", "a", "b", "c"]);
    state.tick = 50;
    start();
    expect(state.phase).toBe(RoomPhase.ARENA_SELECT);
    expect(state.arenaId).toBe("arena-03");
    expect(state.arenaPickRandom).toBe(false);
    expect(state.arenaRevealEndsTick).toBe(50 + 3 * TICK_RATE_HZ);
  });

  it("with the screen off, goes straight to CAR_SELECT on arenas[0]", () => {
    const off = applyOverrides(brawl(), { flow: { arenaSelectEnabled: false } });
    const { state, start } = room(off);
    state.arenaId = "arena-02";
    start();
    expect(state.phase).toBe(RoomPhase.CAR_SELECT);
    expect(state.arenaId).toBe("arena-01");
  });
});

describe("host messages (AR16-AR18)", () => {
  it("moves the highlight for the host only", () => {
    const { r, state, start, run } = room(brawl());
    start();
    run(() => r.onArenaHighlight("guest", { arenaId: "arena-02" }));
    expect(state.arenaHighlightId).toBe("arena-01");
    run(() => r.onArenaHighlight("host", { arenaId: "arena-02" }));
    expect(state.arenaHighlightId).toBe("arena-02");
  });

  it("commits a named pick and refuses a second one", () => {
    const { r, state, start, run } = room(brawl());
    state.tick = 10;
    start();
    run(() => r.onArenaPick("host", { arenaId: "arena-02" }));
    expect(state.arenaId).toBe("arena-02");
    expect(state.arenaRevealEndsTick).toBe(10 + 3 * TICK_RATE_HZ);
    run(() => r.onArenaPick("host", { arenaId: "arena-01" }));
    expect(state.arenaId).toBe("arena-02");
  });

  it("draws a random pick on the server and lengthens the reveal for the roulette", () => {
    const { r, state, start, run } = room(brawl());
    r.arenaRandom = () => 0.99;
    state.tick = 10;
    start();
    run(() => r.onArenaPick("host", { random: true }));
    expect(state.arenaId).toBe("arena-02");
    expect(state.arenaPickRandom).toBe(true);
    expect(state.arenaRevealEndsTick).toBe(10 + Math.ceil(4.5 * TICK_RATE_HZ));
  });
});

describe("deadlines (AR19)", () => {
  it("picks the highlighted arena when the clock runs out, then opens car select after the reveal", () => {
    const { r, state, start, run, at } = room(brawl());
    state.tick = 0;
    start();
    run(() => r.onArenaHighlight("host", { arenaId: "arena-02" }));
    at(10 * TICK_RATE_HZ - 1);
    expect(state.arenaRevealEndsTick).toBe(0);
    at(10 * TICK_RATE_HZ);
    expect(state.arenaId).toBe("arena-02");
    expect(state.arenaPickRandom).toBe(false);
    const revealEnds = state.arenaRevealEndsTick;
    expect(revealEnds).toBe(13 * TICK_RATE_HZ);
    at(revealEnds - 1);
    expect(state.phase).toBe(RoomPhase.ARENA_SELECT);
    at(revealEnds);
    expect(state.phase).toBe(RoomPhase.CAR_SELECT);
    expect(state.carSelectDeadlineTick).toBeGreaterThan(revealEnds);
  });
});

describe("host leaves mid-pick (AR20)", () => {
  it("a lobby player who inherits host cannot pick; the clock decides", () => {
    const { r, state, start, run } = room(brawl(), ["host", "guest", "lurker"]);
    start(["host", "guest"]);
    state.players.delete("host");
    state.hostSessionId = "lurker";
    run(() => r.onArenaPick("lurker", { arenaId: "arena-02" }));
    expect(state.arenaRevealEndsTick).toBe(0);
  });

  it("a roster player who inherits host can pick", () => {
    const { r, state, start, run } = room(brawl());
    start();
    state.hostSessionId = "guest";
    run(() => r.onArenaPick("guest", { arenaId: "arena-02" }));
    expect(state.arenaId).toBe("arena-02");
  });
});
```

If `beginMatch` touches a field only `onCreate` sets, initialize it in `room()` the way `view-leak.test.ts` does and say why in a comment. AR21 (a roster player leaving mid-pick) needs no new code — `onLeave`'s existing `afterLeave` call covers every non-LOBBY phase — and is not unit-tested here because `onLeave` needs the transport; record that in the commit message.

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/server && npx vitest run src/rooms/arena-select-room.test.ts`
Expected: FAIL — `beginMatch` / `advanceFlow` / `onArenaHighlight` are not functions.

- [ ] **Step 4: Implement in `ArenaRoom.ts`**

1. Imports: add `MSG_ARENA_HIGHLIGHT`, `MSG_ARENA_PICK` to the shared import, and
   `import { acceptHighlight, acceptPick, openArenaSelect, revealEndsTickFor, type ArenaSelectGate } from "./arena-select.js";`.
2. Field: `private arenaRandom: () => number = Math.random;`
3. `MSG_START_MATCH`: keep the host / phase / `canStart` checks and the `readyIds` collection, then replace everything from `this.reduce({ type: "start", …` through `controllerOf(this.state.mode).onStartRequested(this.modeView());` with `this.beginMatch(readyIds);`.
4. New methods (`<arenas>` = `this.modeConfig.arenas` or `this.modeConfig.tables.arenas`, per Step 1):

```ts
  /** Start, after `canStart` passed (AR13-AR14). Every branch forms the roster exactly as before. */
  private beginMatch(readyIds: string[]): void {
    const opening = openArenaSelect(flow().arenaSelectEnabled, <arenas>);
    this.reduce({
      type: "start",
      readyIds,
      nowTick: this.state.tick,
      carSelectTicks: getCarSelectSeconds(flow().carSelectSeconds) * TICK_RATE_HZ,
      firstPhase: opening.kind === "skip" ? "car_select" : "arena_select",
    });
    this.pendingCarId.clear();
    // CQ29: last match's chassis claims must not block this car select.
    this.state.players.forEach((p) => {
      p.lockedCarId = "";
    });
    // (move the existing onStartRequested comment here verbatim)
    controllerOf(this.state.mode).onStartRequested(this.modeView());

    this.state.arenaRevealEndsTick = 0;
    this.state.arenaPickRandom = false;
    if (opening.kind === "skip") {
      this.state.arenaId = opening.arenaId;
    } else if (opening.kind === "reveal") {
      this.pickArena(opening.arenaId, false);
    } else {
      this.state.arenaHighlightId = opening.highlightId;
      this.state.arenaSelectDeadlineTick =
        this.state.tick + Math.ceil(flow().arenaSelectSeconds * TICK_RATE_HZ);
    }
  }

  private arenaGate(sessionId: string): ArenaSelectGate {
    return {
      senderId: sessionId,
      hostSessionId: this.state.hostSessionId,
      senderOnRoster: this.matchRoster.has(sessionId),
      phase: this.state.phase,
      arenaRevealEndsTick: this.state.arenaRevealEndsTick,
      arenas: <arenas>,
    };
  }

  private onArenaHighlight(sessionId: string, msg: unknown): void {
    const arenaId = acceptHighlight(this.arenaGate(sessionId), msg);
    if (arenaId !== null) this.state.arenaHighlightId = arenaId;
  }

  private onArenaPick(sessionId: string, msg: unknown): void {
    const pick = acceptPick(this.arenaGate(sessionId), msg, this.arenaRandom);
    if (pick) this.pickArena(pick.arenaId, pick.random);
  }

  /** AR17: the one place a pick lands — a button, the deadline, or a one-arena mode. */
  private pickArena(arenaId: string, random: boolean): void {
    this.state.arenaId = arenaId;
    this.state.arenaHighlightId = arenaId;
    this.state.arenaPickRandom = random;
    this.state.arenaRevealEndsTick = revealEndsTickFor(this.state.tick, flow(), random);
  }
```

5. Register the handlers in `onCreate` next to `MSG_SELECT_CAR`:

```ts
      this.onMessage(MSG_ARENA_HIGHLIGHT, limited(this.limits, "lobby", (client, msg: unknown) =>
        scoped(this.modeConfig, () => this.onArenaHighlight(client.sessionId, msg))),
      );
      this.onMessage(MSG_ARENA_PICK, limited(this.limits, "lobby", (client, msg: unknown) =>
        scoped(this.modeConfig, () => this.onArenaPick(client.sessionId, msg))),
      );
```

6. `step()`: move the whole `if (CAR_SELECT deadline) … else if (REVEAL) … else if (COUNTDOWN) …` chain into `private advanceFlow(): void` and call `this.advanceFlow();` from `step()` where the chain was. In `advanceFlow`, put this branch first in the chain:

```ts
    if (this.state.phase === RoomPhase.ARENA_SELECT) {
      if (this.state.arenaRevealEndsTick === 0) {
        if (this.state.tick >= this.state.arenaSelectDeadlineTick) {
          // AR19: the clock picks whatever the host left highlighted.
          this.pickArena(this.state.arenaHighlightId, false);
        }
      } else if (this.state.tick >= this.state.arenaRevealEndsTick) {
        this.reduce({
          type: "begin_car_select",
          nowTick: this.state.tick,
          carSelectTicks: getCarSelectSeconds(flow().carSelectSeconds) * TICK_RATE_HZ,
        });
      }
    } else if (
      // …the existing CAR_SELECT branch, unchanged
```

- [ ] **Step 5: Run tests**

Run: `cd packages/server && npx vitest run src/rooms/arena-select-room.test.ts src/rooms/arena-select.test.ts` → PASS.
Run: `cd packages/server && npx vitest run` (normal suite; slow tests are excluded by config) → PASS.

- [ ] **Step 6: Verify the server bundle carries the new code**

Run: `npm run build` (root). Then `grep -c "arenaRevealEndsTick" packages/server/dist/index.js` → non-zero, and `grep -n "shared/dist" packages/server/dist/index.js | head -2` shows `// ../shared/dist/…`, not `../../../../../packages/shared/dist/…` (if the latter, run `npm install` at the worktree root and rebuild).

- [ ] **Step 7: Commit**

```bash
git add packages/server
git commit -m "feat(server): ARENA_SELECT in ArenaRoom — host pick, deadline, reveal (AR13-AR20)

AR21 needs no code: onLeave's afterLeave already runs in every non-LOBBY phase.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Client pure layer — adapter, roulette, view model

**Files:**
- Modify: `packages/client/src/assets/asset-keys.ts` (beside `arenaFloorKey`, ~line 87)
- Create: `packages/client/src/ui/arena-cards.ts`, `packages/client/src/ui/arena-cards.test.ts`
- Create: `packages/client/src/ui/roulette.ts`, `packages/client/src/ui/roulette.test.ts`
- Create: `packages/client/src/ui/arena-select-view.ts`, `packages/client/src/ui/arena-select-view.test.ts`
- Modify or create: the test covering `sceneKeyFor` (`grep -rln "sceneKeyFor" packages/client/src`; create `packages/client/src/net/view.test.ts` if none)

**Interfaces:**
- Consumes: Task 1's `displayName`; Task 3's `RoomPhase.ARENA_SELECT`, `VIEW_TO_SCENE.arena_select`.
- Produces:

```ts
// asset-keys.ts
export function arenaPreviewKey(arenaId: string): string; // "arena.<id>.preview"

// arena-cards.ts
export interface ArenaCard { id: string; name: string; previewUrl: string | null }
export function arenaCards(mode: number, manifest: AssetManifest): ArenaCard[];

// roulette.ts
export interface RouletteFrame { index: number; holdMs: number }
export function rouletteFrames(count: number, fromIndex: number, targetIndex: number, budgetMs: number): RouletteFrame[];

// arena-select-view.ts
export type ArenaSelectStage = "choosing" | "roulette" | "revealed";
export interface ArenaSelectInput {
  cards: readonly ArenaCard[];
  modeLabel: string;
  highlightId: string;
  chosenId: string | null;
  isHost: boolean;
  stage: ArenaSelectStage;
  secondsLeft: number;
  revealSecondsLeft: number;
}
export interface ArenaSelectCardView extends ArenaCard { highlighted: boolean }
export interface ArenaSelectView {
  modeLabel: string;
  clock: string;
  urgent: boolean;
  cards: ArenaSelectCardView[];
  status: string;
  canAct: boolean;
  stage: ArenaSelectStage;
  chosen: ArenaCard | null;
  revealLabel: string;
}
export function arenaSelectView(input: ArenaSelectInput): ArenaSelectView;
export function inRouletteWindow(tick: number, revealEndsTick: number, revealSeconds: number): boolean;
```

- [ ] **Step 1: Write the failing tests**

`arena-cards.test.ts` (check `SPRITE_DEFAULTS`' real shape in `assets/manifest-schema.ts`; the spread plus `file` must be a `SpriteEntry`):

```ts
import { describe, expect, it } from "vitest";
import { GameMode } from "@motor-combat-moba/shared";
import { arenaCards } from "./arena-cards.js";
import { EMPTY_MANIFEST, SPRITE_DEFAULTS, type AssetManifest } from "../assets/manifest-schema.js";

const withPreview: AssetManifest = {
  sprites: { "arena.arena-02.preview": { ...SPRITE_DEFAULTS, file: "arenas/arena-02/preview.png" } },
};

describe("arenaCards (AR26)", () => {
  it("lists the mode's arenas in order, named from the def", () => {
    expect(arenaCards(GameMode.FFA_LAST_STANDING, EMPTY_MANIFEST)).toEqual([
      { id: "arena-01", name: "Arena 01", previewUrl: null },
      { id: "arena-02", name: "Arena 02", previewUrl: null },
    ]);
  });
  it("reads the preview from the manifest, null without a row (AR4)", () => {
    const cards = arenaCards(GameMode.FFA_LAST_STANDING, withPreview);
    expect(cards[0].previewUrl).toBeNull();
    expect(cards[1].previewUrl).toBe("art/arenas/arena-02/preview.png");
  });
  it("follows the room's mode, not the installed one", () => {
    expect(arenaCards(GameMode.CONQUER, EMPTY_MANIFEST).map((c) => c.id)).toEqual(["arena-03"]);
  });
});
```

`roulette.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rouletteFrames } from "./roulette.js";

describe("rouletteFrames (AR34)", () => {
  const BUDGET = 1500;
  for (let count = 2; count <= 5; count++) {
    for (let from = 0; from < count; from++) {
      for (let target = 0; target < count; target++) {
        it(`count ${count}, ${from} -> ${target}`, () => {
          const frames = rouletteFrames(count, from, target, BUDGET);
          expect(frames.at(-1)?.index).toBe(target);
          expect(frames.length).toBeGreaterThanOrEqual(2 * count);
          frames.forEach((f, i) => {
            const prev = i === 0 ? from : frames[i - 1].index;
            expect(f.index).toBe((prev + 1) % count);
            if (i > 0) expect(f.holdMs).toBeGreaterThanOrEqual(frames[i - 1].holdMs);
          });
          expect(frames.reduce((s, f) => s + f.holdMs, 0)).toBeLessThanOrEqual(BUDGET);
        });
      }
    }
  }
  it("with one card, shows only the target", () => {
    expect(rouletteFrames(1, 0, 0, BUDGET)).toEqual([{ index: 0, holdMs: 0 }]);
  });
});
```

`arena-select-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { arenaSelectView, inRouletteWindow, type ArenaSelectInput } from "./arena-select-view.js";

const cards = [
  { id: "arena-01", name: "Arena 01", previewUrl: null },
  { id: "arena-02", name: "Arena 02", previewUrl: "art/x.png" },
];
const base: ArenaSelectInput = {
  cards, modeLabel: "Brawl", highlightId: "arena-01", chosenId: null,
  isHost: true, stage: "choosing", secondsLeft: 10, revealSecondsLeft: 3,
};

describe("arenaSelectView (AR28-AR33)", () => {
  it("marks the highlighted card", () => {
    const v = arenaSelectView({ ...base, highlightId: "arena-02" });
    expect(v.cards.map((c) => c.highlighted)).toEqual([false, true]);
  });
  it("lets the host act while choosing", () => {
    const v = arenaSelectView(base);
    expect(v.canAct).toBe(true);
    expect(v.status).toBe("Choose an arena, then Select.");
  });
  it("disables a watcher's buttons and says who is choosing", () => {
    const v = arenaSelectView({ ...base, isHost: false });
    expect(v.canAct).toBe(false);
    expect(v.status).toBe("The host is choosing the arena.");
  });
  it("disables everyone once picked", () => {
    expect(arenaSelectView({ ...base, stage: "roulette", chosenId: "arena-02" }).canAct).toBe(false);
    expect(arenaSelectView({ ...base, stage: "revealed", chosenId: "arena-02" }).canAct).toBe(false);
  });
  it("formats the clock and turns urgent in the last 3 s", () => {
    expect(arenaSelectView(base).clock).toBe("0:10");
    expect(arenaSelectView(base).urgent).toBe(false);
    expect(arenaSelectView({ ...base, secondsLeft: 3 }).urgent).toBe(true);
  });
  it("carries the chosen card and the reveal count", () => {
    const v = arenaSelectView({ ...base, stage: "revealed", chosenId: "arena-02", revealSecondsLeft: 2 });
    expect(v.chosen?.name).toBe("Arena 02");
    expect(v.revealLabel).toBe("Car select in 2");
  });
});

describe("inRouletteWindow (AR34)", () => {
  it("is open until the plain reveal's share begins", () => {
    const ends = 1000;
    const revealStart = ends - 3 * TICK_RATE_HZ;
    expect(inRouletteWindow(revealStart - 1, ends, 3)).toBe(true);
    expect(inRouletteWindow(revealStart, ends, 3)).toBe(false);
  });
});
```

Routing assert (in the `sceneKeyFor` test file; import `RoomPhase` from shared and `sceneKeyFor` from `./view.js`):

```ts
it("routes ARENA_SELECT to the arena_select scene (AR25)", () => {
  expect(sceneKeyFor("in_match", RoomPhase.ARENA_SELECT)).toBe("arena_select");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/client && npx vitest run src/ui/arena-cards.test.ts src/ui/roulette.test.ts src/ui/arena-select-view.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`asset-keys.ts`, after `arenaFloorKey`:

```ts
/**
 * The manifest key for an arena's 16:9 preview on the arena select screen (AR3). Optional — a card
 * without one renders blank with the name only. Pruned with the rest of `arena.<id>.*`.
 */
export function arenaPreviewKey(arenaId: string): string {
  return `arena.${arenaId}.preview`;
}
```

`arena-cards.ts` (use the arena-list path Task 5 confirmed — `.arenas` or `.tables.arenas`):

```ts
import { getArena, modeConfigOrDefault } from "@motor-combat-moba/shared";
import { arenaPreviewKey } from "../assets/asset-keys.js";
import type { AssetManifest } from "../assets/manifest-schema.js";

/**
 * Everything the arena select screen knows about an arena (AR26). The screen draws these and
 * nothing else; this file is the only one on the client that turns an arena id into them.
 */
export interface ArenaCard {
  id: string;
  name: string;
  previewUrl: string | null;
}

/**
 * The room's mode's arenas, in list order. Read through `modeConfigOrDefault(mode)` rather than the
 * installed bundle: the host can switch mode in the lobby, and the screen must show THAT mode's list.
 */
export function arenaCards(mode: number, manifest: AssetManifest): ArenaCard[] {
  return modeConfigOrDefault(mode).arenas.map((id) => {
    const row = manifest.sprites[arenaPreviewKey(id)];
    return { id, name: getArena(id).displayName, previewUrl: row ? `art/${row.file}` : null };
  });
}
```

`roulette.ts`:

```ts
/**
 * The roulette Select random plays before the reveal (AR34): the highlight steps one card at a time,
 * slowing down, and always stops on the arena the server already drew. Pure, so every client plays
 * the same spin and a test can hold the "always ends on the target" promise.
 */
export interface RouletteFrame {
  index: number;
  holdMs: number;
}

/** Each step holds this much longer than the one before it. */
const SLOWDOWN = 1.12;
/** Leaves headroom inside the budget so a late frame never runs into the reveal. */
const BUDGET_SHARE = 0.9;

export function rouletteFrames(
  count: number,
  fromIndex: number,
  targetIndex: number,
  budgetMs: number,
): RouletteFrame[] {
  if (count < 2) return [{ index: targetIndex, holdMs: 0 }];
  const steps = 2 * count + ((targetIndex - fromIndex + count) % count);
  const geometric = (SLOWDOWN ** steps - 1) / (SLOWDOWN - 1);
  const first = (budgetMs * BUDGET_SHARE) / geometric;
  const frames: RouletteFrame[] = [];
  for (let i = 1; i <= steps; i++) {
    frames.push({ index: (fromIndex + i) % count, holdMs: Math.floor(first * SLOWDOWN ** (i - 1)) });
  }
  return frames;
}
```

`arena-select-view.ts`:

```ts
import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import type { ArenaCard } from "./arena-cards.js";

/** Room state to the arena select screen (AR28-AR35). No Phaser, no DOM. */

export type ArenaSelectStage = "choosing" | "roulette" | "revealed";

/** The clock turns to the accent colour for the last few seconds (AR28). */
const URGENT_SECONDS = 3;

export interface ArenaSelectInput {
  cards: readonly ArenaCard[];
  modeLabel: string;
  highlightId: string;
  chosenId: string | null;
  isHost: boolean;
  stage: ArenaSelectStage;
  secondsLeft: number;
  revealSecondsLeft: number;
}

export interface ArenaSelectCardView extends ArenaCard {
  highlighted: boolean;
}

export interface ArenaSelectView {
  modeLabel: string;
  clock: string;
  urgent: boolean;
  cards: ArenaSelectCardView[];
  status: string;
  canAct: boolean;
  stage: ArenaSelectStage;
  chosen: ArenaCard | null;
  revealLabel: string;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function arenaSelectView(input: ArenaSelectInput): ArenaSelectView {
  return {
    modeLabel: input.modeLabel,
    clock: formatClock(input.secondsLeft),
    urgent: input.stage === "choosing" && input.secondsLeft <= URGENT_SECONDS,
    cards: input.cards.map((c) => ({ ...c, highlighted: c.id === input.highlightId })),
    status: input.isHost ? "Choose an arena, then Select." : "The host is choosing the arena.",
    canAct: input.isHost && input.stage === "choosing",
    stage: input.stage,
    chosen: input.cards.find((c) => c.id === input.chosenId) ?? null,
    revealLabel: `Car select in ${Math.max(0, input.revealSecondsLeft)}`,
  };
}

/**
 * Whether a random pick's roulette still has time to play (AR34): the reveal's plain share is its
 * LAST `revealSeconds`, so anything before that is the roulette's.
 */
export function inRouletteWindow(tick: number, revealEndsTick: number, revealSeconds: number): boolean {
  return tick < revealEndsTick - Math.ceil(revealSeconds * TICK_RATE_HZ);
}
```

- [ ] **Step 4: Run tests**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/client && npx vitest run` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client
git commit -m "feat(client): arena cards adapter, roulette and arena select view model (AR26, AR28-AR34)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Client screen and scene

**Files:**
- Create: `packages/client/src/ui/screens/arena-select.ts`
- Modify: `packages/client/src/ui/organic.css` (append the reveal keyframes)
- Create: `packages/client/src/scenes/ArenaSelectScene.ts`
- Modify: `packages/client/src/main.ts` (scene list, ~line 41)

**Interfaces:**
- Consumes: Task 6's `ArenaSelectView`, `arenaSelectView`, `arenaCards`, `ArenaCard`, `rouletteFrames`, `inRouletteWindow`; `secondsLeft` from `ui/reveal-view.ts`; `modeLabel` from `ui/lobby-view.ts`; `assetManifest()` from `scenes/BootScene.ts`; `ScreenOverlay` from `ui/overlay.ts`; `h`, `button` from `ui/dom.ts`.
- Produces: `renderArenaSelect(view: ArenaSelectView, handlers: ArenaSelectHandlers): HTMLElement`, `ArenaSelectHandlers = { onHighlight(arenaId: string): void; onSelect(): void; onRandom(): void }`; Phaser scene key `"arena_select"`.

- [ ] **Step 1: The CSS** — append to `organic.css`:

```css
/* Arena select reveal (AR35). Runs once per mount: the scene renders the revealed stage once and only
   updates the count text afterwards, so these animations never restart mid-reveal. */
@keyframes mc-arena-dismiss { to { opacity: 0; transform: scale(0.8); } }
@keyframes mc-arena-backdrop { from { opacity: 0; } to { opacity: 1; } }
@keyframes mc-arena-chosen { from { transform: scale(0.5); opacity: 0; } 60% { transform: scale(1.04); opacity: 1; } to { transform: scale(1); } }
.mc-arena-dismissed { animation: mc-arena-dismiss 350ms ease-out forwards; }
.mc-arena-stage { animation: mc-arena-backdrop 300ms ease-out 200ms both; }
.mc-arena-chosen { animation: mc-arena-chosen 600ms cubic-bezier(.2,.9,.3,1.25) 250ms both; }
```

- [ ] **Step 2: The renderer** — `screens/arena-select.ts`. Before writing, check `button`'s signature in `ui/dom.ts` (car-select calls `button(attrs, children, handler)`) and that `btn-secondary` exists in `organic.css` (use whatever the secondary button class is actually called):

```ts
import { button, h } from "../dom.js";
import type { ArenaCard } from "../arena-cards.js";
import type { ArenaSelectCardView, ArenaSelectView } from "../arena-select-view.js";

/**
 * The arena select screen (AR28-AR36): a centred grid of up to three cards a row, the host's clock,
 * Select / Select random, and the reveal. Draws `ArenaCard`s only — it knows nothing about arenas.
 */
export interface ArenaSelectHandlers {
  onHighlight(arenaId: string): void;
  onSelect(): void;
  onRandom(): void;
}

/** ≈340 px at 1280 × 720 (AR29); three of these plus two gaps fit the overlay's width. */
const CARD_WIDTH = 340;
const GAP = 22;
const CHOSEN_WIDTH = 560;

function preview(card: ArenaCard, width: number): HTMLElement {
  // AR30: the same 16:9 well with or without art, so a card never changes height for lack of it.
  const style = `width: ${width}px; aspect-ratio: 16 / 9; background: var(--color-neutral-200); display: block; object-fit: cover;`;
  return card.previewUrl
    ? h("img", { src: card.previewUrl, alt: "", style })
    : h("div", { "aria-hidden": "true", style });
}

function cardEl(card: ArenaSelectCardView, view: ArenaSelectView, onClick: () => void): HTMLElement {
  const dismissed = view.stage === "revealed" && view.chosen?.id !== card.id;
  const el = h(
    "div",
    {
      class: dismissed ? "mc-arena-dismissed" : undefined,
      "data-arena-id": card.id,
      style:
        `width: ${CARD_WIDTH}px; border-radius: 4px; overflow: hidden; background: var(--color-surface); ` +
        `border: 2px solid ${card.highlighted ? "var(--color-accent)" : "var(--color-neutral-300)"}; ` +
        `cursor: ${view.canAct ? "pointer" : "default"};`,
    },
    [
      preview(card, CARD_WIDTH),
      h("div", { style: "padding: 10px 14px; font-family: var(--font-heading); font-size: 20px; text-transform: uppercase; letter-spacing: 0.04em;" }, [card.name]),
    ],
  );
  if (view.canAct) el.addEventListener("click", onClick);
  return el;
}

function revealStage(view: ArenaSelectView): HTMLElement | null {
  if (view.stage !== "revealed" || !view.chosen) return null;
  return h(
    "div",
    {
      class: "mc-arena-stage",
      style:
        "position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; " +
        "background: color-mix(in srgb, var(--color-bg) 86%, transparent);",
    },
    [
      h("div", { style: "font-size: 13px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 16px;" }, ["Arena selected"]),
      h("div", { class: "mc-arena-chosen", style: "border: 2px solid var(--color-accent); border-radius: 4px; overflow: hidden; background: var(--color-surface); box-shadow: var(--shadow-lg);" }, [
        preview(view.chosen, CHOSEN_WIDTH),
        h("div", { style: "padding: 14px 18px; text-align: center; font-family: var(--font-heading); font-size: 34px; text-transform: uppercase; letter-spacing: 0.05em;" }, [view.chosen.name]),
      ]),
      h("div", { "data-reveal-count": "", style: "margin-top: 16px; font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-neutral-700);" }, [view.revealLabel]),
    ],
  );
}

export function renderArenaSelect(view: ArenaSelectView, handlers: ArenaSelectHandlers): HTMLElement {
  return h("div", { style: "position: absolute; inset: 0; display: flex; flex-direction: column; padding: 30px 40px 34px;" }, [
    h("div", { style: "display: flex; align-items: flex-end; gap: 14px;" }, [
      h("h2", { style: "margin: 0; font-size: 36px; line-height: 1;" }, ["Choose the arena"]),
      h("span", { class: "tag tag-accent", style: "position: relative; bottom: 3px;" }, [view.modeLabel]),
      h("div", { style: "margin-left: auto; display: flex; align-items: baseline; gap: 8px;" }, [
        h("div", { style: "font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-neutral-600);" }, ["Picks in"]),
        h("div", { style: `font-family: var(--font-heading); font-size: 34px; color: ${view.urgent ? "var(--color-accent)" : "var(--color-text)"};` }, [view.clock]),
      ]),
    ]),
    // AR29: wrap at three, centred both ways in whatever space the header and footer leave.
    h("div", { style: "flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;" }, [
      h(
        "div",
        { style: `display: flex; flex-wrap: wrap; justify-content: center; gap: ${GAP}px; max-width: ${3 * CARD_WIDTH + 2 * GAP + 8}px;` },
        view.cards.map((card) => cardEl(card, view, () => handlers.onHighlight(card.id))),
      ),
    ]),
    h("div", { style: "display: flex; align-items: center; gap: 12px; padding-top: 20px;" }, [
      h("div", { style: "font-size: 14px; color: var(--color-neutral-700);" }, [view.status]),
      button(
        { class: "btn btn-secondary", style: "margin-left: auto; min-height: 48px; font-size: 18px; padding-inline: 26px;", disabled: !view.canAct },
        ["Select random"],
        handlers.onRandom,
      ),
      button(
        { class: "btn btn-primary", style: "min-height: 48px; font-size: 18px; padding-inline: 30px;", disabled: !view.canAct },
        ["Select"],
        handlers.onSelect,
      ),
    ]),
    revealStage(view),
  ]);
}
```

- [ ] **Step 3: The scene** — `scenes/ArenaSelectScene.ts`. The roulette and reveal timings must come from the ROOM's mode: read `modeConfigOrDefault(s.mode)`'s flow table (path per Task 5 Step 1: `.flow` or `.tables.flow`), not the client's installed bundle:

```ts
import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import { ArenaState, MSG_ARENA_HIGHLIGHT, MSG_ARENA_PICK, modeConfigOrDefault } from "@motor-combat-moba/shared";
import { bindViewRouter } from "../net/view.js";
import { arenaCards, type ArenaCard } from "../ui/arena-cards.js";
import { arenaSelectView, inRouletteWindow, type ArenaSelectStage } from "../ui/arena-select-view.js";
import { secondsLeft } from "../ui/reveal-view.js";
import { modeLabel } from "../ui/lobby-view.js";
import { rouletteFrames } from "../ui/roulette.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderArenaSelect } from "../ui/screens/arena-select.js";
import { assetManifest } from "./BootScene.js";

/**
 * Arena select (spec AR25-AR36). The host's highlight and pick are server state; this scene draws
 * them and sends intents. The roulette is local theatre scripted to land on the arena the server
 * already chose, and plays only when this client first sees a random pick inside its window.
 */
export class ArenaSelectScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private overlay: ScreenOverlay | undefined;
  private unbind: Array<() => void> = [];
  private cards: ArenaCard[] = [];
  private stage: ArenaSelectStage = "choosing";
  /** During the roulette, the card the spin is on; otherwise null and the server's highlight shows. */
  private spinIndex: number | null = null;
  /** The highlight just before the pick landed — where the roulette starts spinning from. */
  private lastChoosingHighlight = "";
  private lastKey = "";
  private rouletteTimer: Phaser.Time.TimerEvent | undefined;

  constructor() {
    super({ key: "arena_select" });
  }

  create(): void {
    this.unbindAll();
    this.overlay = new ScreenOverlay(this);
    this.room = this.registry.get("room") as Room<ArenaState> | undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    if (!this.room) {
      this.scene.start("join");
      return;
    }
    this.cards = arenaCards(this.room.state.mode, assetManifest());
    this.stage = "choosing";
    this.spinIndex = null;
    this.lastChoosingHighlight = this.room.state.arenaHighlightId;
    this.lastKey = "";
    this.bindRoom(this.room);
    this.sync();
  }

  private onShutdown(): void {
    this.unbindAll();
    this.rouletteTimer?.remove();
    this.rouletteTimer = undefined;
    this.overlay?.destroy();
    this.overlay = undefined;
    this.room = undefined;
  }

  private unbindAll(): void {
    for (const fn of this.unbind) fn();
    this.unbind = [];
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));
    const onState = (): void => this.sync();
    room.onStateChange(onState);
    this.unbind.push(() => room.onStateChange.remove(onState));
    const onLeave = (): void => {
      this.registry.remove("room");
      this.scene.start("join");
    };
    room.onLeave(onLeave);
    this.unbind.push(() => room.onLeave.remove(onLeave));
  }

  /** Moves the local stage forward from server state, starting the roulette when it is owed. */
  private sync(): void {
    const s = this.room?.state;
    if (!s) return;
    if (this.stage === "choosing") {
      if (s.arenaRevealEndsTick === 0) {
        this.lastChoosingHighlight = s.arenaHighlightId;
      } else {
        const flowTable = modeConfigOrDefault(s.mode).flow;
        const target = this.cards.findIndex((c) => c.id === s.arenaId);
        const playRoulette =
          s.arenaPickRandom && this.cards.length > 1 && target >= 0 &&
          inRouletteWindow(s.tick, s.arenaRevealEndsTick, flowTable.arenaRevealSeconds);
        if (playRoulette) this.startRoulette(target, flowTable.arenaRouletteSeconds * 1000);
        else this.stage = "revealed";
      }
    }
    this.render();
  }

  private startRoulette(target: number, budgetMs: number): void {
    this.stage = "roulette";
    const from = Math.max(0, this.cards.findIndex((c) => c.id === this.lastChoosingHighlight));
    const frames = rouletteFrames(this.cards.length, from, target, budgetMs);
    const step = (i: number): void => {
      if (!this.room) return;
      if (i >= frames.length) {
        this.spinIndex = null;
        this.stage = "revealed";
        this.render();
        return;
      }
      this.spinIndex = frames[i].index;
      this.render();
      this.rouletteTimer = this.time.delayedCall(frames[i].holdMs, () => step(i + 1));
    };
    step(0);
  }

  private render(): void {
    const room = this.room;
    if (!room || !this.overlay) return;
    const s = room.state;
    const highlightId = this.spinIndex !== null ? this.cards[this.spinIndex]?.id ?? "" : s.arenaHighlightId;
    const view = arenaSelectView({
      cards: this.cards,
      modeLabel: modeLabel(s.mode),
      highlightId,
      chosenId: s.arenaRevealEndsTick > 0 ? s.arenaId : null,
      isHost: s.hostSessionId === room.sessionId,
      stage: this.stage,
      secondsLeft: secondsLeft(s.arenaSelectDeadlineTick, s.tick),
      revealSecondsLeft: secondsLeft(s.arenaRevealEndsTick, s.tick),
    });
    // AR35: the revealed stage mounts once (its CSS animations must not restart); afterwards only the
    // count text changes. Every other stage re-renders when something it shows changes.
    const key = view.stage === "revealed" ? "revealed" : `${view.stage}|${highlightId}|${view.clock}|${view.canAct}`;
    if (key === this.lastKey) {
      if (view.stage === "revealed") {
        const count = this.overlay.mount().querySelector<HTMLElement>("[data-reveal-count]");
        if (count && count.textContent !== view.revealLabel) count.textContent = view.revealLabel;
      }
      return;
    }
    this.lastKey = key;
    this.overlay.render(
      renderArenaSelect(view, {
        onHighlight: (arenaId) => room.send(MSG_ARENA_HIGHLIGHT, { arenaId }),
        onSelect: () => room.send(MSG_ARENA_PICK, { arenaId: room.state.arenaHighlightId }),
        onRandom: () => room.send(MSG_ARENA_PICK, { random: true }),
      }),
    );
  }
}
```

- [ ] **Step 4: Register the scene** — in `main.ts`, import `ArenaSelectScene` from `./scenes/ArenaSelectScene.js` and add it to the `scene:` list between `LobbyScene` and `CarSelectScene`.

- [ ] **Step 5: Build and unit tests**

Run: `npm run build` (root) → succeeds. `cd packages/client && npx vitest run` → PASS.

- [ ] **Step 6: Verify in the browser**

Ensure the worktree's `.claude/launch.json` has a `dev` configuration (create it if missing: `{"version":"0.0.1","configurations":[{"name":"dev","runtimeExecutable":"npm","runtimeArgs":["run","dev"],"port":5173}]}`). Only one checkout may run `npm run dev` at a time — if port 5173 or 2567 is already taken, stop and report rather than killing anything. Start it with `preview_start {name: "dev"}`. Open two tabs at `http://localhost:5173`, join both ("Host", "Guest"), and have the host press Start in Brawl. Check with screenshots:
1. Both tabs show "Choose the arena", two centred cards, "0:10" counting down; the guest's buttons are disabled with "The host is choosing the arena."
2. Host clicks Arena 02 — the guest's highlight moves.
3. Host presses Select random — both tabs spin and land on the same card, then the reveal (dimmed backdrop, big card, "Car select in N"), then car select opens.
4. Return to the lobby, Start again, and let the clock run out — the highlighted arena is picked and revealed.
5. Start once more and close the guest's tab mid-pick (AR21) — the host's tab ends back in the lobby (or the results screen), exactly as leaving mid car-select does; it must not hang on the arena screen.
Check `read_console_messages` in both tabs for errors. One-arena (Conquer) behaviour is covered by Task 5's test; Conquer's `canStart` needs a full 3v3, so do not try it here. Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add packages/client
git commit -m "feat(client): arena select screen with roulette and reveal (AR25-AR36)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs and full verification

**Files:**
- Modify: `docs/config-reference.md` (the "Arena selection" section, ~lines 1469-1498, and wherever `FLOW_CONFIG` is tabulated)
- Modify: `docs/schema-reference.md` (ArenaState fields, RoomPhase)
- Modify: `docs/asset-pipeline.md` (arena art namespace: the `preview` slot)
- Modify: `CLAUDE.md` (one paragraph after the lobby-chat paragraph; one "Read the right doc" row)
- Modify: `packages/shared/src/arena/registry.ts` doc comment (it says the list lives in `modes/<mode>/index.ts`; it lives in `modes/base.ts`, overridden in a mode's `config.ts`)

- [ ] **Step 1: Rewrite `config-reference.md#arena-selection`** — the list is `ModeTables.arenas`, base `["arena-01", "arena-02"]` in `modes/base.ts`, Conquer overrides to `["arena-03"]` in `modes/conquer/config.ts`; `arenas[0]` is the default; with `flow.arenaSelectEnabled` true the host picks on the arena select screen, with it false `arenas[0]` plays; one arena shows only the reveal. Add the four `flow` keys with base values and meanings (AR6's table), the preview art key and its 16:9 size, and a link to the spec. Remove the stale "both shipped modes" sentence.
- [ ] **Step 2: `schema-reference.md`** — `RoomPhase.ARENA_SELECT = 5`, the four `ArenaState` fields with AR11's meanings, `PROTOCOL_VERSION` 9.
- [ ] **Step 3: `asset-pipeline.md`** — `arena.<id>.preview` (`arenas/<id>/preview.png`, 16:9, at least 640 × 360, optional; a missing one renders a blank card) beside the `floor` slot.
- [ ] **Step 4: `CLAUDE.md`** — after the lobby-chat paragraph add:

```markdown
**Arena select is a phase, and the host drives it (2026-10-09).** Start now opens
`RoomPhase.ARENA_SELECT` (5) when the mode's `flow.arenaSelectEnabled` is true: the host highlights
and picks one of the mode's `arenas` (Select, or Select random — drawn on the server, then a
client-side roulette scripted to land on it) within `flow.arenaSelectSeconds`, the deadline picks
the highlight, and the chosen card holds for `flow.arenaRevealSeconds` before car select. One
arena skips straight to the reveal; `false` skips the screen and plays `arenas[0]`. The server's
decisions are pure (`rooms/arena-select.ts`); the client screen sees only `ArenaCard`
(`{ id, name, previewUrl }`) from the adapter `ui/arena-cards.ts`. `ArenaDef.displayName` is the
card's name and is unique case-insensitively; previews are optional `arena.<id>.preview` art. See
[`docs/superpowers/specs/2026-10-09-arena-select-screen-design.md`](docs/superpowers/specs/2026-10-09-arena-select-screen-design.md) (AR1–AR40).
```

  and in "Read the right doc": `| Arena select screen: the host's pick, roulette, reveal, per-mode switch, display names, preview art (AR1–AR40) | [docs/superpowers/specs/2026-10-09-arena-select-screen-design.md](docs/superpowers/specs/2026-10-09-arena-select-screen-design.md) |`.
- [ ] **Step 5: Fix the stale registry comment** in `packages/shared/src/arena/registry.ts`.
- [ ] **Step 6: Full verification** (from the worktree root):

```bash
npm run build
npm test
npm run test:scripts
npm run test:slow
npm run playtest -- --scope=all
```

Expected: build, `npm test` and `test:scripts` green. For `test:slow` and the playtest, report any failure with its output and say whether it also fails on `development/main` (run the same command there only if needed to tell); do not retune bots. Report AR40 explicitly: `playtest:lan`'s match now passes through a 10 s `ARENA_SELECT` resolved by the deadline.

- [ ] **Step 7: Commit**

```bash
git add docs CLAUDE.md packages/shared/src/arena/registry.ts
git commit -m "docs: arena select screen — config, schema, art slot, CLAUDE.md (AR1-AR40)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
