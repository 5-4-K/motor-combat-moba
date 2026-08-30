# Multi-Arena Selection and Release Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the repo hold many arenas, switch which one the game plays by editing one constant, and ship only that arena's art in the release zip.

**Architecture:** The arena registry becomes a map keyed by arena id, and a single `ACTIVE_ARENA_ID` constant in `shared/config` names the arena a build plays. Arena art is namespaced `arena.<id>.<slot>` by convention, so one shared key parser drives both the client's boot-time load filter and the release script's asset pruner. Both read the active id from built shared, so there is exactly one source of truth.

**Tech Stack:** TypeScript, npm workspaces, Colyseus schema, Phaser 3, Vite, vitest (shared + client), `node:test` (scripts), tsup (server bundle).

**Spec:** [`docs/superpowers/specs/2026-08-26-arena-selection-and-release-pruning-design.md`](../specs/2026-08-26-arena-selection-and-release-pruning-design.md)

## Global Constraints

- `TICK_RATE_HZ` lives once in `@motor-combat-moba/shared`. Do not redefine it.
- No magic numbers in logic. Tweakables belong in `packages/shared/src/config/`.
- Clients send inputs, never authoritative sim state.
- `stepSim` is the lockstep; server and client import the same function. If `stepSim` reads a value, it must be a networked schema field. The arena palette added by this plan is **render-only** and must stay out of the schema.
- Shared is consumed as **built `dist`**, not `src`. After editing anything under `packages/shared/src/`, run `npm run build -w @motor-combat-moba/shared` before running client or server tests, or they will exercise stale code.
- Build with root `npm run build`, never `npm run build --workspaces`. The root script enforces shared → server → client ordering; the server's tsup step inlines shared's `dist`.
- Max 6 players (`MAX_PLAYERS`). Note `MAX_TEAM_SIZE` is 4 for lobby swap headroom, while `canStart` caps team mode at 3v3 — the per-team spawn floor in this plan is therefore `MAX_PLAYERS / 2`, never `MAX_TEAM_SIZE`.
- Enum uint8 values are explicit and stable; never renumber.
- Do not change the drive model, the OBB hitbox model, collision-damage rules, or friendly fire.

## File Structure

**Shared (`packages/shared/src/`)**
| File | Responsibility |
|---|---|
| `config/arena-config.ts` (new) | The one `ACTIVE_ARENA_ID` constant |
| `arena/registry.ts` (modify) | `ARENAS` map, `ArenaId`, `isArenaId`, `getArena`, `ARENA_IDS` |
| `arena/art-keys.ts` (new) | The `arena.<id>.<slot>` namespace parser, used by both client and release script |
| `arena/types.ts` (modify) | `ArenaDef` gains optional `palette` |
| `arena/arena-02.ts` (new) | Second arena layout |
| `arena/arena.test.ts` (rewrite) | Rule table run over every registered arena |
| `schema/ArenaState.ts` (modify) | `arenaId` defaults to `ACTIVE_ARENA_ID` |
| `index.ts` (modify) | Public exports |

**Client (`packages/client/src/`)**
| File | Responsibility |
|---|---|
| `assets/asset-keys.ts` (modify) | `shouldLoadAssetKey` boot-time filter |
| `scenes/BootScene.ts` (modify) | Apply the filter when loading manifest entries |
| `scenes/arena-visual.ts` (new) | Resolve an arena's palette to Phaser colour ints |
| `scenes/arena-mismatch.ts` (new) | Build the mismatch message string (pure, testable) |
| `ui/screens/arena-mismatch.ts` (new) | Render that message as DOM |
| `scenes/ArenaScene.ts` (modify) | `isArenaId` guard, palette-aware `drawArena` |

**Scripts**
| File | Responsibility |
|---|---|
| `scripts/build-release.mjs` (modify) | `pruneArenaAssets`, `assertOnlyActiveArenaShipped`, wiring in `main()` |
| `scripts/build-release.test.mjs` (modify) | Fixture-based tests for both |

Client vitest runs in the **node** environment with no DOM. Pure logic modules get tests; DOM-rendering `ui/screens/*` modules do not, matching the existing pattern.

---

### Task 1: Arena registry map and the `ACTIVE_ARENA_ID` constant

**Files:**
- Create: `packages/shared/src/config/arena-config.ts`
- Modify: `packages/shared/src/arena/registry.ts`
- Modify: `packages/shared/src/index.ts:69-70`
- Modify: `packages/shared/src/schema/ArenaState.ts:11`
- Modify: `packages/shared/src/schema/schema.test.ts:110,120,131`
- Modify: `packages/client/src/net/prediction.test.ts:3,14`
- Modify: `packages/client/src/net/step-context.test.ts:2,16`
- Test: `packages/shared/src/arena/arena.test.ts` (append; rewritten in Task 2)

**Interfaces:**
- Consumes: `ARENA_01` from `./arena-01.js`; `ArenaDef` from `./types.js`.
- Produces:
  - `ACTIVE_ARENA_ID: string` from `packages/shared/src/config/arena-config.ts`
  - `ARENAS: { readonly "arena-01": typeof ARENA_01 }` (grows in Task 3)
  - `type ArenaId = keyof typeof ARENAS`
  - `isArenaId(id: string): id is ArenaId`
  - `getArena(id: string): ArenaDef` — throws on unknown
  - `ARENA_IDS: readonly string[]`
  - All of the above re-exported from `@motor-combat-moba/shared`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/arena/arena.test.ts`:

```ts
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { ARENA_IDS, ARENAS, isArenaId } from "./registry.js";

describe("registry", () => {
  it("resolves every registered id to its own def", () => {
    for (const [id, def] of Object.entries(ARENAS)) {
      expect(getArena(id)).toBe(def);
    }
  });

  it("throws for an unknown arena id", () => {
    expect(() => getArena("nope")).toThrow(/nope/);
  });

  it("refuses prototype keys rather than resolving them", () => {
    expect(isArenaId("__proto__")).toBe(false);
    expect(isArenaId("constructor")).toBe(false);
    expect(() => getArena("toString")).toThrow();
  });

  it("lists exactly the registered ids", () => {
    expect([...ARENA_IDS].sort()).toEqual(Object.keys(ARENAS).sort());
  });

  it("has an ACTIVE_ARENA_ID that is actually registered", () => {
    expect(isArenaId(ACTIVE_ARENA_ID)).toBe(true);
  });
});
```

Also delete the old `describe("arena-01")` block's two trailing registry tests — `"registry resolves arena-01"` and `"throws for unknown arena id"` — since the new `describe("registry")` block replaces them. Leave the file's existing `import { getArena } from "./registry.js";` alone: it is still used. A second `import` statement from the same module is legal, so the snippet above does not need merging into it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/shared -- src/arena/arena.test.ts`
Expected: FAIL — cannot resolve `../config/arena-config.js`, and `ARENAS` / `ARENA_IDS` / `isArenaId` are not exported from `./registry.js`.

- [ ] **Step 3: Write the active-arena constant**

Create `packages/shared/src/config/arena-config.ts`:

```ts
/**
 * The one arena this build plays and ships.
 *
 * Change this single line to change arenas: the server's `ArenaState.arenaId` defaults to it, the
 * client loads only this arena's art at boot, and `scripts/build-release.mjs` prunes every other
 * arena's assets out of the release. It lives in `config/` rather than in the registry because this
 * is the file you are meant to edit; the registry is the file you are meant to append to.
 *
 * Must be a key of `ARENAS` in `arena/registry.ts`. `arena.test.ts` asserts that, so a typo fails
 * the build rather than throwing inside a live room.
 */
export const ACTIVE_ARENA_ID = "arena-01";
```

- [ ] **Step 4: Turn the registry into a map**

Replace the whole of `packages/shared/src/arena/registry.ts`:

```ts
import { ARENA_01 } from "./arena-01.js";
import type { ArenaDef } from "./types.js";

/**
 * Every arena the build knows about. Adding one is a new `arena-0N.ts` plus a row here; which of
 * them the game actually plays is `ACTIVE_ARENA_ID` in `config/arena-config.ts`.
 *
 * Registered arenas that are not active still cost the bundle their layout data — a few hundred
 * bytes of rects. Their *art* is what the release prunes, which is where the weight is.
 */
export const ARENAS = {
  "arena-01": ARENA_01,
} as const;

export type ArenaId = keyof typeof ARENAS;

/** Registered ids, for error messages and for iterating the registry. */
export const ARENA_IDS: readonly string[] = Object.keys(ARENAS);

/**
 * `Object.hasOwn` rather than `id in ARENAS`: `arenaId` arrives off the wire, so `"toString"` and
 * `"__proto__"` are reachable strings, and `in` would answer true for both. Same caution `isCarId`
 * and the manifest parser already take.
 */
export function isArenaId(id: string): id is ArenaId {
  return Object.hasOwn(ARENAS, id);
}

/**
 * Throws on an unknown id rather than falling back. This is called from the server's sim path, where
 * an unresolvable arena is a programming error with no sane default — silently simulating a
 * different arena than the one in state is strictly worse than stopping. The client checks
 * `isArenaId` first and renders a mismatch message instead of calling this.
 */
export function getArena(id: string): ArenaDef {
  if (!isArenaId(id)) {
    throw new Error(`Unknown arena: ${id}. Registered: ${ARENA_IDS.join(", ")}`);
  }
  return ARENAS[id];
}
```

- [ ] **Step 5: Update the shared public exports**

In `packages/shared/src/index.ts`, replace line 70 (`export { DEFAULT_ARENA_ID, getArena } from "./arena/registry.js";`) with:

```ts
export { ARENAS, ARENA_IDS, getArena, isArenaId } from "./arena/registry.js";
export type { ArenaId } from "./arena/registry.js";
export { ACTIVE_ARENA_ID } from "./config/arena-config.js";
```

- [ ] **Step 6: Default the schema field to the constant**

In `packages/shared/src/schema/ArenaState.ts`, add to the imports:

```ts
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
```

and change line 11 from `@type("string") arenaId = "arena-01";` to:

```ts
  @type("string") arenaId = ACTIVE_ARENA_ID;
```

- [ ] **Step 7: Run the shared suite**

Run: `npm run test -w @motor-combat-moba/shared`
Expected: PASS. `schema.test.ts` still passes because `ACTIVE_ARENA_ID` is `"arena-01"` today.

- [ ] **Step 8: Unpin the schema tests from the literal**

In `packages/shared/src/schema/schema.test.ts`, import `ACTIVE_ARENA_ID` from `../config/arena-config.js` and replace the three `"arena-01"` literals on lines 110, 120, and 131 with `ACTIVE_ARENA_ID`. These assert that the default round-trips, not that it is any particular arena — leaving the literal would break the suite the first time someone switches arenas, which is the workflow this plan exists to enable.

- [ ] **Step 9: Update the two client tests that used `DEFAULT_ARENA_ID`**

In `packages/client/src/net/prediction.test.ts` and `packages/client/src/net/step-context.test.ts`, replace `DEFAULT_ARENA_ID` with `ACTIVE_ARENA_ID` in both the import list and the `getArena(...)` call.

- [ ] **Step 10: Rebuild shared, then run everything**

Run: `npm run build -w @motor-combat-moba/shared && npm run test && npm run typecheck`
Expected: PASS. The rebuild is mandatory — the client resolves `@motor-combat-moba/shared` to `dist`, so without it the client tests import a `dist` that has no `ACTIVE_ARENA_ID`.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/config/arena-config.ts packages/shared/src/arena/registry.ts packages/shared/src/index.ts packages/shared/src/schema/ArenaState.ts packages/shared/src/schema/schema.test.ts packages/shared/src/arena/arena.test.ts packages/client/src/net/prediction.test.ts packages/client/src/net/step-context.test.ts
git commit -m "feat(shared): key arenas by id and select the active one from config"
```

---

### Task 2: Generic arena validator

**Files:**
- Modify (rewrite): `packages/shared/src/arena/arena.test.ts`

**Interfaces:**
- Consumes: `ARENAS`, `getArena`, `isArenaId`, `ARENA_IDS` (Task 1); `ACTIVE_ARENA_ID` (Task 1); `DRIVE_CONFIG`, `MAX_PLAYERS`.
- Produces: no runtime exports. Produces the safety net every later arena is authored against — Task 3 depends on it existing.

This task is test-only, so the usual red-green order inverts: the rules are the deliverable, and `ARENA_01` is the fixture that must already satisfy them. If a rule fails against `ARENA_01`, the rule is wrong — fix the rule, not the arena.

- [ ] **Step 1: Replace the whole test file**

`packages/shared/src/arena/arena.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { MAX_PLAYERS } from "../constants.js";
import { ARENA_IDS, ARENAS, getArena, isArenaId } from "./registry.js";
import type { ArenaDef, Spawn } from "./types.js";

/**
 * A car must always have somewhere to be pushed.
 *
 * `resolveWorld` ranks world bounds above obstacles, so an obstacle flush against a wall makes those
 * two rules contradict each other: the obstacle pushes the car out, the boundary clamp shoves it
 * straight back in, and the car ends up permanently embedded in level geometry — a stable fixed
 * point, not a transient overlap. A corridor narrower than the car traps it the same way. See the
 * doc comment on `resolveWorld` in `sim/collide.ts` for the ranking and why it is ordered that way.
 *
 * The floor is the car diagonal rather than its width, so the gap admits a car at any rotation.
 */
const CAR_DIAGONAL = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);

/**
 * Team mode is capped at 3v3 by `canStart`, so each side needs half the roster's worth of spawns.
 * Deliberately *not* `MAX_TEAM_SIZE`, which is 4: that number is lobby swap headroom, not match size,
 * and using it here would demand a fourth spawn per side that no match can ever occupy.
 */
const MIN_TEAM_SPAWNS = MAX_PLAYERS / 2;

/** Spawns keep clear of the walls by the same margin the original arena was authored to. */
const SPAWN_WALL_MARGIN = 80;

const entries = Object.entries(ARENAS) as ReadonlyArray<[string, ArenaDef]>;

function insideObstacle(s: Spawn, arena: ArenaDef): boolean {
  return arena.obstacles.some((o) => s.x > o.x && s.x < o.x + o.w && s.y > o.y && s.y < o.y + o.h);
}

/**
 * Pairs closer than a car diagonal, reported as strings so a failure names the offenders instead of
 * saying `false !== true`. Only sets used *together* are checked: FFA spawns among themselves, and
 * team A plus team B as one set, since those two are occupied in the same match.
 */
function tooCloseTogether(spawns: readonly Spawn[], label: string): string[] {
  const problems: string[] = [];
  for (let i = 0; i < spawns.length; i += 1) {
    for (let j = i + 1; j < spawns.length; j += 1) {
      const a = spawns[i]!;
      const b = spawns[j]!;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < CAR_DIAGONAL) {
        problems.push(`${label} #${i} and #${j} are ${distance.toFixed(1)} apart (< ${CAR_DIAGONAL})`);
      }
    }
  }
  return problems;
}

describe.each(entries)("arena %s", (id, arena) => {
  it("declares the id it is registered under", () => {
    expect(arena.id).toBe(id);
  });

  it("has positive finite bounds", () => {
    expect(Number.isFinite(arena.width)).toBe(true);
    expect(Number.isFinite(arena.height)).toBe(true);
    expect(arena.width).toBeGreaterThan(0);
    expect(arena.height).toBeGreaterThan(0);
  });

  it("keeps every obstacle inside bounds", () => {
    for (const o of arena.obstacles) {
      expect(o.w).toBeGreaterThan(0);
      expect(o.h).toBeGreaterThan(0);
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.x + o.w).toBeLessThanOrEqual(arena.width);
      expect(o.y + o.h).toBeLessThanOrEqual(arena.height);
    }
  });

  it("keeps every obstacle at least a car diagonal clear of the arena boundary", () => {
    const tooClose = arena.obstacles.flatMap((o) => {
      const sides = [
        ["left", o.x],
        ["top", o.y],
        ["right", arena.width - (o.x + o.w)],
        ["bottom", arena.height - (o.y + o.h)],
      ] as const;
      return sides
        .filter(([, gap]) => gap < CAR_DIAGONAL)
        .map(([side, gap]) => `obstacle at {${o.x},${o.y}}: ${side} gap ${gap} < ${CAR_DIAGONAL}`);
    });
    expect(tooClose).toEqual([]);
  });

  it("leaves no corridor between obstacles too narrow for a car", () => {
    // Only a pair overlapping on one axis forms a corridor on the other. A gap of exactly 0 means
    // the two touch, which is one solid mass and perfectly drivable-around — not a trap. A negative
    // gap means they overlap into a single compound shape, which is likewise fine.
    const narrow: string[] = [];
    const obstacles = arena.obstacles;
    for (let i = 0; i < obstacles.length; i += 1) {
      for (let j = i + 1; j < obstacles.length; j += 1) {
        const a = obstacles[i]!;
        const b = obstacles[j]!;
        if (a.y < b.y + b.h && b.y < a.y + a.h) {
          const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
          if (gap > 0 && gap < CAR_DIAGONAL) narrow.push(`x corridor ${gap} between #${i} and #${j}`);
        }
        if (a.x < b.x + b.w && b.x < a.x + a.w) {
          const gap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
          if (gap > 0 && gap < CAR_DIAGONAL) narrow.push(`y corridor ${gap} between #${i} and #${j}`);
        }
      }
    }
    expect(narrow).toEqual([]);
  });

  it("seats a full lobby in every mode", () => {
    expect(arena.ffaSpawns.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
    expect(arena.teamASpawns.length).toBeGreaterThanOrEqual(MIN_TEAM_SPAWNS);
    expect(arena.teamBSpawns.length).toBeGreaterThanOrEqual(MIN_TEAM_SPAWNS);
  });

  it("puts every spawn inside the bounds and clear of obstacles", () => {
    const all = [...arena.ffaSpawns, ...arena.teamASpawns, ...arena.teamBSpawns];
    for (const s of all) {
      expect(s.x).toBeGreaterThan(SPAWN_WALL_MARGIN);
      expect(s.x).toBeLessThan(arena.width - SPAWN_WALL_MARGIN);
      expect(s.y).toBeGreaterThan(SPAWN_WALL_MARGIN);
      expect(s.y).toBeLessThan(arena.height - SPAWN_WALL_MARGIN);
      expect(Number.isFinite(s.angle)).toBe(true);
      expect(insideObstacle(s, arena)).toBe(false);
    }
  });

  it("separates the teams across the halfway line", () => {
    for (const s of arena.teamASpawns) expect(s.x).toBeLessThan(arena.width / 2);
    for (const s of arena.teamBSpawns) expect(s.x).toBeGreaterThan(arena.width / 2);
  });

  it("never stacks two spawns that are occupied in the same match", () => {
    expect(tooCloseTogether(arena.ffaSpawns, "ffa")).toEqual([]);
    expect(tooCloseTogether([...arena.teamASpawns, ...arena.teamBSpawns], "team")).toEqual([]);
  });
});

describe("registry", () => {
  it("resolves every registered id to its own def", () => {
    for (const [id, def] of entries) {
      expect(getArena(id)).toBe(def);
    }
  });

  it("throws for an unknown arena id", () => {
    expect(() => getArena("nope")).toThrow(/nope/);
  });

  it("refuses prototype keys rather than resolving them", () => {
    expect(isArenaId("__proto__")).toBe(false);
    expect(isArenaId("constructor")).toBe(false);
    expect(() => getArena("toString")).toThrow();
  });

  it("lists exactly the registered ids", () => {
    expect([...ARENA_IDS].sort()).toEqual(Object.keys(ARENAS).sort());
  });

  it("has an ACTIVE_ARENA_ID that is actually registered", () => {
    expect(isArenaId(ACTIVE_ARENA_ID)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm every rule passes against `arena-01`**

Run: `npm run test -w @motor-combat-moba/shared -- src/arena/arena.test.ts`
Expected: PASS, with the arena block reported once for `arena-01`.

- [ ] **Step 3: Prove the rules actually bite**

Temporarily edit `packages/shared/src/arena/arena-01.ts` and change the last obstacle `{ x: 200, y: 720, w: 80, h: 160 }` to `{ x: 10, y: 720, w: 80, h: 160 }`.

Run: `npm run test -w @motor-combat-moba/shared -- src/arena/arena.test.ts`
Expected: FAIL on "keeps every obstacle at least a car diagonal clear of the arena boundary", naming `left gap 10`.

Then revert the edit with `git checkout packages/shared/src/arena/arena-01.ts` and re-run to confirm PASS. A validator that has never been seen to fail is not a validator.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/arena/arena.test.ts
git commit -m "test(shared): validate every registered arena by rule, not by pinned values"
```

---

### Task 3: Second arena

**Files:**
- Create: `packages/shared/src/arena/arena-02.ts`
- Modify: `packages/shared/src/arena/registry.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `ArenaDef` from `./types.js`; the Task 2 validator gates it.
- Produces: `ARENA_02`, and `ARENAS` gains the `"arena-02"` key, so `ArenaId` becomes `"arena-01" | "arena-02"`.

- [ ] **Step 1: Write the arena**

Create `packages/shared/src/arena/arena-02.ts`:

```ts
import type { ArenaDef } from "./types.js";

/**
 * "Crossroads" — a square arena built around a central plus-shaped block with four corner bunkers.
 *
 * Deliberately a different shape from `ARENA_01`: square rather than 3:2, with one large central
 * mass instead of scattered cover, so the two read as different places rather than as two
 * rearrangements of the same one. The plus is authored as two overlapping rects; overlapping pairs
 * form one compound solid and are exempt from the corridor rule, which only fires on a positive gap.
 */
export const ARENA_02 = {
  id: "arena-02",
  width: 2000,
  height: 2000,
  obstacles: [
    { x: 940, y: 700, w: 120, h: 600 },
    { x: 700, y: 940, w: 600, h: 120 },
    { x: 400, y: 400, w: 200, h: 200 },
    { x: 1400, y: 400, w: 200, h: 200 },
    { x: 400, y: 1400, w: 200, h: 200 },
    { x: 1400, y: 1400, w: 200, h: 200 },
  ],
  ffaSpawns: [
    { x: 200, y: 200, angle: 0 },
    { x: 1800, y: 200, angle: Math.PI },
    { x: 200, y: 1800, angle: 0 },
    { x: 1800, y: 1800, angle: Math.PI },
    { x: 1000, y: 200, angle: Math.PI / 2 },
    { x: 1000, y: 1800, angle: -Math.PI / 2 },
  ],
  teamASpawns: [
    { x: 200, y: 600, angle: 0 },
    { x: 200, y: 1000, angle: 0 },
    { x: 200, y: 1400, angle: 0 },
  ],
  teamBSpawns: [
    { x: 1800, y: 600, angle: Math.PI },
    { x: 1800, y: 1000, angle: Math.PI },
    { x: 1800, y: 1400, angle: Math.PI },
  ],
} as const satisfies ArenaDef;
```

- [ ] **Step 2: Register it**

In `packages/shared/src/arena/registry.ts`, add the import and the row:

```ts
import { ARENA_02 } from "./arena-02.js";
```

```ts
export const ARENAS = {
  "arena-01": ARENA_01,
  "arena-02": ARENA_02,
} as const;
```

In `packages/shared/src/index.ts`, beside the existing `ARENA_01` export:

```ts
export { ARENA_02 } from "./arena/arena-02.js";
```

- [ ] **Step 3: Run the validator against both arenas**

Run: `npm run test -w @motor-combat-moba/shared -- src/arena/arena.test.ts`
Expected: PASS, with the arena block now reported twice — once for `arena-01`, once for `arena-02`.

- [ ] **Step 4: Verify the switch works end to end**

Temporarily set `ACTIVE_ARENA_ID` to `"arena-02"` in `packages/shared/src/config/arena-config.ts`, then run:

`npm run build -w @motor-combat-moba/shared && npm run test`

Expected: PASS. This proves the constant is the only edit a switch requires. Revert it to `"arena-01"` and re-run before committing.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/arena/arena-02.ts packages/shared/src/arena/registry.ts packages/shared/src/index.ts
git commit -m "feat(shared): add arena-02 crossroads layout"
```

---

### Task 4: Per-arena palette

**Files:**
- Modify: `packages/shared/src/arena/types.ts`
- Modify: `packages/shared/src/arena/arena-02.ts`
- Create: `packages/client/src/scenes/arena-visual.ts`
- Create: `packages/client/src/scenes/arena-visual.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts:242-256`

**Interfaces:**
- Consumes: `ArenaDef` (Task 1/3).
- Produces:
  - `ArenaPalette { readonly floor: string; readonly obstacle: string; readonly border: string }` and `ArenaDef.palette?: ArenaPalette`, both from `packages/shared/src/arena/types.ts`
  - `ARENA_COLOR_DEFAULTS: { floor: number; obstacle: number; border: number }` from `packages/client/src/scenes/arena-visual.ts`
  - `arenaColorsOf(arena: ArenaDef): { floor: number; obstacle: number; border: number }` from the same file

`ARENA_01` deliberately gets no palette, so the fallback path stays exercised by the arena the build ships today.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/scenes/arena-visual.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ArenaDef } from "@motor-combat-moba/shared";
import { ARENA_COLOR_DEFAULTS, arenaColorsOf } from "./arena-visual.js";

const bare: ArenaDef = {
  id: "test",
  width: 100,
  height: 100,
  obstacles: [],
  ffaSpawns: [],
  teamASpawns: [],
  teamBSpawns: [],
};

describe("arenaColorsOf", () => {
  it("falls back to the client defaults when the arena declares no palette", () => {
    expect(arenaColorsOf(bare)).toEqual(ARENA_COLOR_DEFAULTS);
  });

  it("converts a declared palette to Phaser colour integers", () => {
    const colors = arenaColorsOf({
      ...bare,
      palette: { floor: "#d8cfc4", obstacle: "#6b5b4b", border: "#2f2a26" },
    });
    expect(colors).toEqual({ floor: 0xd8cfc4, obstacle: 0x6b5b4b, border: 0x2f2a26 });
  });

  it("falls back per channel when a hex string is malformed", () => {
    const colors = arenaColorsOf({
      ...bare,
      palette: { floor: "not-a-colour", obstacle: "#6b5b4b", border: "" },
    });
    expect(colors.floor).toBe(ARENA_COLOR_DEFAULTS.floor);
    expect(colors.obstacle).toBe(0x6b5b4b);
    expect(colors.border).toBe(ARENA_COLOR_DEFAULTS.border);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- src/scenes/arena-visual.test.ts`
Expected: FAIL — cannot resolve `./arena-visual.js`.

- [ ] **Step 3: Add the palette to the shared type**

In `packages/shared/src/arena/types.ts`, add above `ArenaDef`:

```ts
/**
 * How an arena is painted. Hex strings in the manner of `COLOR_TABLE`, converted to Phaser's colour
 * integers on the client.
 *
 * Render-only: `stepSim` never reads it, so it is not a schema field and invariant 8 does not apply.
 * Optional — an arena without one uses the client's default palette, which is what `ARENA_01` does.
 */
export interface ArenaPalette {
  readonly floor: string;
  readonly obstacle: string;
  readonly border: string;
}
```

and add the field to `ArenaDef`:

```ts
  palette?: ArenaPalette;
```

- [ ] **Step 4: Give arena-02 its own palette**

In `packages/shared/src/arena/arena-02.ts`, add after `height: 2000,`:

```ts
  palette: { floor: "#d8cfc4", obstacle: "#6b5b4b", border: "#2f2a26" },
```

- [ ] **Step 5: Write the client colour resolver**

Create `packages/client/src/scenes/arena-visual.ts`:

```ts
import type { ArenaDef } from "@motor-combat-moba/shared";

/**
 * The palette an arena gets when it declares none. These are the three constants `ArenaScene` used
 * inline before arenas could carry their own, so `ARENA_01` looks exactly as it always has.
 */
export const ARENA_COLOR_DEFAULTS = {
  floor: 0xebebeb,
  obstacle: 0x4a5568,
  border: 0x2d3436,
} as const;

export interface ArenaColors {
  floor: number;
  obstacle: number;
  border: number;
}

/**
 * `#RRGGBB` as the integer Phaser wants, falling back per channel rather than producing `NaN` —
 * Phaser renders `NaN` as an invisible fill, which would turn a one-character typo in a palette into
 * an arena with no visible walls. The same guard `carFillOf` takes for an out-of-range `colorId`.
 */
function hexToInt(hex: string, fallback: number): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return Number.parseInt(hex.slice(1), 16);
}

export function arenaColorsOf(arena: ArenaDef): ArenaColors {
  const palette = arena.palette;
  if (!palette) return { ...ARENA_COLOR_DEFAULTS };
  return {
    floor: hexToInt(palette.floor, ARENA_COLOR_DEFAULTS.floor),
    obstacle: hexToInt(palette.obstacle, ARENA_COLOR_DEFAULTS.obstacle),
    border: hexToInt(palette.border, ARENA_COLOR_DEFAULTS.border),
  };
}
```

- [ ] **Step 6: Rebuild shared and run the test**

Run: `npm run build -w @motor-combat-moba/shared && npm run test -w @motor-combat-moba/client -- src/scenes/arena-visual.test.ts`
Expected: PASS. Without the rebuild the client sees a `dist` whose `ArenaDef` has no `palette`, and the typecheck of the test fixture fails.

- [ ] **Step 7: Draw with the arena's palette**

In `packages/client/src/scenes/ArenaScene.ts`, add the import beside the other scene-local imports:

```ts
import { arenaColorsOf } from "./arena-visual.js";
```

Delete the three now-unused constants on lines 38-40 (`ARENA_FLOOR`, `OBSTACLE_FILL`, `ARENA_BORDER`) — they live in `arena-visual.ts` now. Keep `ARENA_BORDER_PX`.

Replace the body of `drawArena` (lines 242-256) with:

```ts
  private drawArena(arena: ArenaDef): void {
    const colors = arenaColorsOf(arena);
    const gfx = this.add.graphics().setDepth(ARENA_DEPTH);
    gfx.fillStyle(colors.obstacle, 1);
    for (const obstacle of arena.obstacles) {
      gfx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    }
    gfx.lineStyle(ARENA_BORDER_PX, colors.border, 1);
    gfx.strokeRect(0, 0, arena.width, arena.height);
    this.arenaGfx = gfx;

    const cam = this.cameras.main;
    // Scene-scoped: the global game background stays dark for the lobby and results screens.
    cam.setBackgroundColor(colors.floor);
    cam.setZoom(CAMERA_CONFIG.zoom);
    // Stops the soft follow from panning past the arena edge into empty space.
    cam.setBounds(0, 0, arena.width, arena.height);
  }
```

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm run test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/arena/types.ts packages/shared/src/arena/arena-02.ts packages/client/src/scenes/arena-visual.ts packages/client/src/scenes/arena-visual.test.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat: let an arena carry its own palette"
```

---

### Task 5: Arena art namespace and the boot-time load filter

**Files:**
- Create: `packages/shared/src/arena/art-keys.ts`
- Create: `packages/shared/src/arena/art-keys.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/client/src/assets/asset-keys.ts`
- Modify: `packages/client/src/assets/asset-keys.test.ts`
- Modify: `packages/client/src/scenes/BootScene.ts` (the `loadArt` entries loop)

**Interfaces:**
- Consumes: nothing from earlier tasks except `ACTIVE_ARENA_ID` at the call site.
- Produces:
  - `ARENA_ART_PREFIX = "arena."` and `ARENA_ART_COMMON = "common"` from `packages/shared/src/arena/art-keys.ts`
  - `arenaIdFromArtKey(key: string): string | undefined` from the same file — `undefined` for any key outside the `arena.` namespace
  - `shouldLoadAssetKey(key: string, activeArenaId: string): boolean` from `packages/client/src/assets/asset-keys.ts`

The parser lives in **shared**, not the client, because `scripts/build-release.mjs` needs the identical rule when pruning and already imports built shared. One implementation, two consumers, no regex to keep in sync.

- [ ] **Step 1: Write the failing shared test**

Create `packages/shared/src/arena/art-keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ARENA_ART_COMMON, ARENA_ART_PREFIX, arenaIdFromArtKey } from "./art-keys.js";

describe("arenaIdFromArtKey", () => {
  it("returns undefined for keys outside the arena namespace", () => {
    expect(arenaIdFromArtKey("car.rectangle")).toBeUndefined();
    expect(arenaIdFromArtKey("powerup.boost")).toBeUndefined();
    expect(arenaIdFromArtKey("")).toBeUndefined();
  });

  it("extracts the arena id from a namespaced key", () => {
    expect(arenaIdFromArtKey("arena.arena-02.floor")).toBe("arena-02");
    expect(arenaIdFromArtKey("arena.arena-02.obstacle.crate")).toBe("arena-02");
  });

  it("treats a key with no slot as naming its arena", () => {
    expect(arenaIdFromArtKey("arena.arena-02")).toBe("arena-02");
  });

  it("recognises the shared namespace", () => {
    expect(arenaIdFromArtKey(`${ARENA_ART_PREFIX}${ARENA_ART_COMMON}.wall`)).toBe(ARENA_ART_COMMON);
  });

  it("returns undefined rather than an empty id", () => {
    expect(arenaIdFromArtKey("arena.")).toBeUndefined();
    expect(arenaIdFromArtKey("arena..floor")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @motor-combat-moba/shared -- src/arena/art-keys.test.ts`
Expected: FAIL — cannot resolve `./art-keys.js`.

- [ ] **Step 3: Write the parser**

Create `packages/shared/src/arena/art-keys.ts`:

```ts
/**
 * How arena art is namespaced, so that a release can carry only the active arena's files.
 *
 * A manifest key `arena.<arenaId>.<slot>` names art owned by one arena, and lives on disk at
 * `public/art/arenas/<arenaId>/<slot>.png`. Two namespaces are never pruned: `arena.common.*`, for
 * art several arenas share, and everything outside the `arena.` prefix — cars today, powers later.
 *
 * This lives in shared rather than in the client because `scripts/build-release.mjs` applies the
 * same rule to files on disk that `shouldLoadAssetKey` applies to manifest keys at boot, and the
 * script already imports built shared. Two copies of this rule would eventually disagree, and the
 * symptom would be art that loads in dev and is missing from the zip.
 */
export const ARENA_ART_PREFIX = "arena.";

/** The namespace for art shared between arenas. Never pruned. */
export const ARENA_ART_COMMON = "common";

/**
 * The arena a manifest key belongs to, or `undefined` if the key is not arena-owned at all.
 * A malformed key with an empty id (`"arena."`, `"arena..floor"`) is treated as not arena-owned, so
 * it survives pruning and is left for the manifest parser to complain about rather than being
 * silently deleted by a build step.
 */
export function arenaIdFromArtKey(key: string): string | undefined {
  if (!key.startsWith(ARENA_ART_PREFIX)) return undefined;
  const rest = key.slice(ARENA_ART_PREFIX.length);
  const dot = rest.indexOf(".");
  const id = dot === -1 ? rest : rest.slice(0, dot);
  return id.length > 0 ? id : undefined;
}
```

- [ ] **Step 4: Export it and confirm the test passes**

In `packages/shared/src/index.ts`, beside the other arena exports:

```ts
export { ARENA_ART_COMMON, ARENA_ART_PREFIX, arenaIdFromArtKey } from "./arena/art-keys.js";
```

Run: `npm run test -w @motor-combat-moba/shared -- src/arena/art-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing client filter test**

Append to `packages/client/src/assets/asset-keys.test.ts`:

```ts
import { shouldLoadAssetKey } from "./asset-keys.js";

describe("shouldLoadAssetKey", () => {
  it("loads everything outside the arena namespace", () => {
    expect(shouldLoadAssetKey("car.rectangle", "arena-01")).toBe(true);
    expect(shouldLoadAssetKey("powerup.boost", "arena-01")).toBe(true);
  });

  it("loads the active arena's art", () => {
    expect(shouldLoadAssetKey("arena.arena-01.floor", "arena-01")).toBe(true);
  });

  it("skips another arena's art", () => {
    expect(shouldLoadAssetKey("arena.arena-02.floor", "arena-01")).toBe(false);
  });

  it("always loads shared arena art", () => {
    expect(shouldLoadAssetKey("arena.common.wall", "arena-01")).toBe(true);
  });

  it("loads a malformed arena key rather than silently dropping it", () => {
    expect(shouldLoadAssetKey("arena.", "arena-01")).toBe(true);
  });
});
```

If `asset-keys.test.ts` does not already import `describe`/`expect`/`it` from `vitest`, add that import at the top.

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- src/assets/asset-keys.test.ts`
Expected: FAIL — `shouldLoadAssetKey` is not exported.

- [ ] **Step 7: Write the filter**

Append to `packages/client/src/assets/asset-keys.ts`, and add `ARENA_ART_COMMON` and `arenaIdFromArtKey` to the existing `@motor-combat-moba/shared` import:

```ts
/**
 * Whether boot should load a manifest entry at all.
 *
 * The runtime half of "only the selected arena ships": another arena's art is skipped even if a
 * manifest row names it, which keeps a dev build from spending load time on arenas it will not draw
 * and keeps behaviour identical to the pruned release. `scripts/build-release.mjs` applies the same
 * rule to the files themselves.
 */
export function shouldLoadAssetKey(key: string, activeArenaId: string): boolean {
  const arenaId = arenaIdFromArtKey(key);
  if (arenaId === undefined) return true;
  return arenaId === ARENA_ART_COMMON || arenaId === activeArenaId;
}
```

- [ ] **Step 8: Rebuild shared and run the client test**

Run: `npm run build -w @motor-combat-moba/shared && npm run test -w @motor-combat-moba/client -- src/assets/asset-keys.test.ts`
Expected: PASS.

- [ ] **Step 9: Apply the filter in BootScene**

In `packages/client/src/scenes/BootScene.ts`, add to the imports:

```ts
import { ACTIVE_ARENA_ID } from "@motor-combat-moba/shared";
import { shouldLoadAssetKey } from "../assets/asset-keys.js";
```

In `loadArt`, replace the line

```ts
    const entries = Object.entries(parsed.sprites);
```

with

```ts
    // Filtered before anything is queued, so `entries` stays the one list the loader, the
    // FILE_LOAD_ERROR handler, and the missing-texture sweep below all agree on. A key skipped here
    // is not "failed to load" — it was never asked for, and must not be warned about.
    const entries = Object.entries(parsed.sprites).filter(([key]) =>
      shouldLoadAssetKey(key, ACTIVE_ARENA_ID),
    );
```

Everything downstream in `loadArt` already derives from `entries`, so no other line changes.

- [ ] **Step 10: Create the art directory convention**

```bash
mkdir -p packages/client/public/art/arenas/common
```

Add `packages/client/public/art/arenas/README.md`:

```markdown
# Arena art

One directory per arena, named by its arena id: `arena-02/floor.png` is declared in
`../manifest.json` as `"arena.arena-02.floor"`.

`common/` holds art shared between arenas and is never pruned. Everything else here is pruned from
the release except the directory matching `ACTIVE_ARENA_ID`, so an experimental arena costs the
shipped zip nothing.

Nothing lives here yet — arenas are drawn procedurally. The convention is in place so the first PNG
does not require moving files.
```

- [ ] **Step 11: Run everything**

Run: `npm run test && npm run typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/shared/src/arena/art-keys.ts packages/shared/src/arena/art-keys.test.ts packages/shared/src/index.ts packages/client/src/assets/asset-keys.ts packages/client/src/assets/asset-keys.test.ts packages/client/src/scenes/BootScene.ts packages/client/public/art/arenas/README.md
git commit -m "feat: namespace arena art by id and load only the active arena's"
```

---

### Task 6: Arena mismatch guard

**Files:**
- Create: `packages/client/src/scenes/arena-mismatch.ts`
- Create: `packages/client/src/scenes/arena-mismatch.test.ts`
- Create: `packages/client/src/ui/screens/arena-mismatch.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`create`, around line 189)

**Interfaces:**
- Consumes: `isArenaId`, `ARENA_IDS` (Task 1); `ScreenOverlay` from `../ui/overlay.js`; `h` from `../ui/dom.js`.
- Produces:
  - `arenaMismatchMessage(serverArenaId: string, knownIds: readonly string[]): string` from `packages/client/src/scenes/arena-mismatch.ts`
  - `renderArenaMismatch(message: string): HTMLElement` from `packages/client/src/ui/screens/arena-mismatch.ts`

Client vitest has no DOM, so the message builder is tested and the DOM screen is not — the same split every other `ui/screens/*` module follows.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/scenes/arena-mismatch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { arenaMismatchMessage } from "./arena-mismatch.js";

describe("arenaMismatchMessage", () => {
  it("names the server's arena and the ones this build has", () => {
    const message = arenaMismatchMessage("arena-03", ["arena-01", "arena-02"]);
    expect(message).toContain("arena-03");
    expect(message).toContain("arena-01, arena-02");
  });

  it("tells the reader what to actually do about it", () => {
    const message = arenaMismatchMessage("arena-03", ["arena-01"]);
    expect(message).toMatch(/rebuild/i);
    expect(message).toMatch(/refresh/i);
  });

  it("handles a build with no arenas registered without producing a dangling list", () => {
    const message = arenaMismatchMessage("arena-03", []);
    expect(message).toContain("(none)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- src/scenes/arena-mismatch.test.ts`
Expected: FAIL — cannot resolve `./arena-mismatch.js`.

- [ ] **Step 3: Write the message builder**

Create `packages/client/src/scenes/arena-mismatch.ts`:

```ts
/**
 * What to show when the server names an arena this build does not have.
 *
 * The release zip cannot reach this state: it ships one build of server and client with one
 * `ACTIVE_ARENA_ID` inlined into both. Development can, via the stale-`dist` gotcha in `CLAUDE.md`
 * and its browser-side twin — a tab held open across a server restart, or a Vite dep cache still
 * holding the previous `shared/dist`. That is exactly the loop arena authoring lives in, so the
 * message names both sides and the fix, rather than leaving a stack trace inside Phaser's boot.
 */
export function arenaMismatchMessage(serverArenaId: string, knownIds: readonly string[]): string {
  const known = knownIds.length > 0 ? knownIds.join(", ") : "(none)";
  return (
    `Arena mismatch.\n\n` +
    `The server is running "${serverArenaId}", but this build only knows: ${known}.\n\n` +
    `Rebuild shared (npm run build -w @motor-combat-moba/shared) and hard-refresh this page.`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- src/scenes/arena-mismatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the DOM screen**

Create `packages/client/src/ui/screens/arena-mismatch.ts`:

```ts
import { h } from "../dom.js";

/**
 * A full-bleed error card. Deliberately plain: this screen only appears when the build is
 * inconsistent with the server, so it must not depend on anything the mismatch might have broken.
 */
export function renderArenaMismatch(message: string): HTMLElement {
  return h(
    "div",
    {
      style:
        "position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; " +
        "background: var(--color-surface); pointer-events: auto;",
    },
    [
      h(
        "pre",
        {
          style:
            "max-width: 900px; margin: 0; padding: 32px 40px; white-space: pre-wrap; " +
            "font: 500 20px/1.5 var(--font-body, system-ui); color: var(--color-text);",
        },
        [message],
      ),
    ],
  );
}
```

- [ ] **Step 6: Guard the scene**

In `packages/client/src/scenes/ArenaScene.ts`:

Add `isArenaId` and `ARENA_IDS` to the existing `@motor-combat-moba/shared` import block, and add:

```ts
import { ScreenOverlay } from "../ui/overlay.js";
import { renderArenaMismatch } from "../ui/screens/arena-mismatch.js";
import { arenaMismatchMessage } from "./arena-mismatch.js";
```

Add a field beside the other private fields:

```ts
  private mismatchOverlay: ScreenOverlay | undefined;
```

Replace lines 187-190 — the comment and the two statements that resolve and draw the arena — with:

```ts
    // Guarded rather than resolved directly: `getArena` throws, and this line runs before the rest
    // of create() builds anything, so an unknown id would leave a half-constructed scene and a
    // stack trace instead of a black screen with a reason on it.
    const arenaId = this.room.state.arenaId;
    if (!isArenaId(arenaId)) {
      this.mismatchOverlay = new ScreenOverlay(this);
      this.mismatchOverlay.render(renderArenaMismatch(arenaMismatchMessage(arenaId, ARENA_IDS)));
      console.error(`[arena] ${arenaMismatchMessage(arenaId, ARENA_IDS)}`);
      return;
    }

    // Hoisted out of the 30 Hz prediction path: `getArena` is a lookup that throws, and the arena
    // cannot change while the scene is alive.
    this.arena = getArena(arenaId);
    this.drawArena(this.arena);
```

Find the scene's existing `SHUTDOWN` handler (`this.events.once(Phaser.Scenes.Events.SHUTDOWN, ...)`) and add to its body:

```ts
    this.mismatchOverlay?.destroy();
    this.mismatchOverlay = undefined;
```

If `ArenaScene` has no `SHUTDOWN` handler, add one in `create()` immediately before the guard:

```ts
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.mismatchOverlay?.destroy();
      this.mismatchOverlay = undefined;
    });
```

The early `return` skips every subscription and graphics object the rest of `create()` builds, so nothing else in the scene needs a guard: `update` finds `this.arena` undefined and no room bindings exist.

- [ ] **Step 7: Verify the guard by hand**

Temporarily change `ArenaState.arenaId`'s default in `packages/shared/src/schema/ArenaState.ts` to the literal `"arena-99"`, then run:

```bash
npm run build -w @motor-combat-moba/shared
```

Start the dev server with `npm run dev`, open `http://localhost:5173`, join, and start a match. Expected: the arena screen shows "Arena mismatch. The server is running "arena-99", but this build only knows: arena-01, arena-02." instead of a black screen.

Then revert: `git checkout packages/shared/src/schema/ArenaState.ts && npm run build -w @motor-combat-moba/shared`.

- [ ] **Step 8: Run everything**

Run: `npm run test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/scenes/arena-mismatch.ts packages/client/src/scenes/arena-mismatch.test.ts packages/client/src/ui/screens/arena-mismatch.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(client): show a readable message when the server names an unknown arena"
```

---

### Task 7: Release pruning

**Files:**
- Modify: `scripts/build-release.mjs`
- Modify: `scripts/build-release.test.mjs`

**Interfaces:**
- Consumes: `ACTIVE_ARENA_ID`, `ARENA_ART_COMMON`, `arenaIdFromArtKey` from `../packages/shared/dist/index.js` (Tasks 1 and 5).
- Produces:
  - `pruneArenaAssets(clientDistDir, activeArenaId) -> { kept: string[], removed: string[], bytesRemoved: number }`
  - `assertOnlyActiveArenaShipped(clientDistDir, activeArenaId) -> void` (throws on a survivor)

Both operate on the **copied** release folder, never on `packages/client/dist`, so the source dist stays complete and repeated release builds are idempotent.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/build-release.test.mjs`, and add `assertOnlyActiveArenaShipped` and `pruneArenaAssets` to the existing import from `./build-release.mjs`:

```js
describe("pruneArenaAssets", () => {
  const madeDirs = [];
  after(() => {
    for (const dir of madeDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A client dist holding three arenas' art plus a car and a shared wall, with a manifest naming all five. */
  function makeDist() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcm-arena-"));
    madeDirs.push(dir);
    const art = path.join(dir, "art");
    for (const arena of ["arena-01", "arena-02", "arena-03", "common"]) {
      fs.mkdirSync(path.join(art, "arenas", arena), { recursive: true });
      fs.writeFileSync(path.join(art, "arenas", arena, "floor.png"), "x".repeat(100));
    }
    fs.mkdirSync(path.join(art, "cars"), { recursive: true });
    fs.writeFileSync(path.join(art, "cars", "rectangle.png"), "x");
    fs.writeFileSync(
      path.join(art, "manifest.json"),
      JSON.stringify({
        sprites: {
          "car.rectangle": { file: "cars/rectangle.png" },
          "arena.common.floor": { file: "arenas/common/floor.png" },
          "arena.arena-01.floor": { file: "arenas/arena-01/floor.png" },
          "arena.arena-02.floor": { file: "arenas/arena-02/floor.png" },
          "arena.arena-03.floor": { file: "arenas/arena-03/floor.png" },
        },
      }),
    );
    return dir;
  }

  it("keeps the active arena and common, removes the rest", () => {
    const dir = makeDist();
    const result = pruneArenaAssets(dir, "arena-01");
    assert.deepEqual(result.kept, ["arena-01", "common"]);
    assert.deepEqual(result.removed, ["arena-02", "arena-03"]);
    assert.ok(result.bytesRemoved >= 200);
    assert.ok(fs.existsSync(path.join(dir, "art", "arenas", "arena-01", "floor.png")));
    assert.ok(fs.existsSync(path.join(dir, "art", "arenas", "common", "floor.png")));
    assert.ok(!fs.existsSync(path.join(dir, "art", "arenas", "arena-02")));
    assert.ok(!fs.existsSync(path.join(dir, "art", "arenas", "arena-03")));
  });

  it("drops the pruned arenas' manifest keys and keeps every other key", () => {
    const dir = makeDist();
    pruneArenaAssets(dir, "arena-01");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "art", "manifest.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest.sprites).sort(), [
      "arena.arena-01.floor",
      "arena.common.floor",
      "car.rectangle",
    ]);
  });

  it("is idempotent", () => {
    const dir = makeDist();
    pruneArenaAssets(dir, "arena-01");
    const second = pruneArenaAssets(dir, "arena-01");
    assert.deepEqual(second.removed, []);
    assert.equal(second.bytesRemoved, 0);
  });

  it("does nothing when there is no arena art at all", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcm-arena-"));
    madeDirs.push(dir);
    const result = pruneArenaAssets(dir, "arena-01");
    assert.deepEqual(result.kept, []);
    assert.deepEqual(result.removed, []);
  });

  it("passes its own assertion afterwards", () => {
    const dir = makeDist();
    pruneArenaAssets(dir, "arena-01");
    assert.doesNotThrow(() => assertOnlyActiveArenaShipped(dir, "arena-01"));
  });
});

describe("assertOnlyActiveArenaShipped", () => {
  const madeDirs = [];
  after(() => {
    for (const dir of madeDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcm-assert-"));
    madeDirs.push(dir);
    fs.mkdirSync(path.join(dir, "art", "arenas", "arena-01"), { recursive: true });
    fs.writeFileSync(path.join(dir, "art", "manifest.json"), JSON.stringify({ sprites: {} }));
    return dir;
  }

  it("throws when another arena's directory survived", () => {
    const dir = makeDir();
    fs.mkdirSync(path.join(dir, "art", "arenas", "arena-07"), { recursive: true });
    assert.throws(() => assertOnlyActiveArenaShipped(dir, "arena-01"), /arena-07/);
  });

  it("throws when another arena's manifest key survived", () => {
    const dir = makeDir();
    fs.writeFileSync(
      path.join(dir, "art", "manifest.json"),
      JSON.stringify({ sprites: { "arena.arena-07.floor": { file: "arenas/arena-07/floor.png" } } }),
    );
    assert.throws(() => assertOnlyActiveArenaShipped(dir, "arena-01"), /arena\.arena-07\.floor/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/build-release.test.mjs`
Expected: FAIL — `pruneArenaAssets` and `assertOnlyActiveArenaShipped` are not exported.

- [ ] **Step 3: Implement both functions**

In `scripts/build-release.mjs`, add to the imports at the top:

```js
import {
  ACTIVE_ARENA_ID,
  ARENA_ART_COMMON,
  arenaIdFromArtKey,
} from "../packages/shared/dist/index.js";
```

and add `const sharedDist = path.join(rootDir, "packages", "shared", "dist");` beside the other dist path constants.

Then add, above `writeZip`:

```js
function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return undefined;
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!raw || typeof raw !== "object") return undefined;
  if (!raw.sprites || typeof raw.sprites !== "object") return undefined;
  return raw;
}

/**
 * Strip every arena's art but the active one's from a built client tree.
 *
 * Two namespaces always survive: `arena.common.*`, for art several arenas share, and every key
 * outside the `arena.` prefix. `arenaIdFromArtKey` is imported from shared rather than reimplemented
 * here so the file-level rule and the client's boot-time load filter cannot drift apart.
 *
 * Call this on the **copied** release tree, never on `packages/client/dist`: the source dist stays
 * complete and reusable, and running a release twice in a row does the same thing as running it once.
 */
export function pruneArenaAssets(clientDistDir, activeArenaId) {
  const arenasDir = path.join(clientDistDir, "art", "arenas");
  const kept = [];
  const removed = [];
  let bytesRemoved = 0;

  if (fs.existsSync(arenasDir)) {
    for (const entry of fs.readdirSync(arenasDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ARENA_ART_COMMON || entry.name === activeArenaId) {
        kept.push(entry.name);
        continue;
      }
      const full = path.join(arenasDir, entry.name);
      bytesRemoved += directorySize(full);
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(entry.name);
    }
  }

  const manifestPath = path.join(clientDistDir, "art", "manifest.json");
  const manifest = readManifest(manifestPath);
  if (manifest) {
    for (const key of Object.keys(manifest.sprites)) {
      const arenaId = arenaIdFromArtKey(key);
      if (arenaId === undefined) continue;
      if (arenaId === ARENA_ART_COMMON || arenaId === activeArenaId) continue;
      delete manifest.sprites[key];
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return { kept: kept.sort(), removed: removed.sort(), bytesRemoved };
}

/**
 * Throw if any non-active arena's art or manifest key reached the release. Checks the condition the
 * player would actually suffer — a file in the zip — rather than trusting that the prune ran, the
 * same way `assertFontsVendored` checks the file rather than the copy step.
 */
export function assertOnlyActiveArenaShipped(clientDistDir, activeArenaId) {
  const offenders = [];
  const arenasDir = path.join(clientDistDir, "art", "arenas");
  if (fs.existsSync(arenasDir)) {
    for (const entry of fs.readdirSync(arenasDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ARENA_ART_COMMON || entry.name === activeArenaId) continue;
      offenders.push(`art/arenas/${entry.name}/`);
    }
  }

  const manifest = readManifest(path.join(clientDistDir, "art", "manifest.json"));
  if (manifest) {
    for (const key of Object.keys(manifest.sprites)) {
      const arenaId = arenaIdFromArtKey(key);
      if (arenaId === undefined) continue;
      if (arenaId === ARENA_ART_COMMON || arenaId === activeArenaId) continue;
      offenders.push(`manifest key ${key}`);
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      `non-active arena art shipped (ACTIVE_ARENA_ID is "${activeArenaId}"): ${offenders.join(", ")}. ` +
        `pruneArenaAssets should have removed these from the copied client dist.`,
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/build-release.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire it into `main()`**

In `main()` in `scripts/build-release.mjs`, add `requireBuiltDist(sharedDist, "packages/shared/dist");` as the first line, and immediately after the `fs.cpSync(clientDist, ...)` call add:

```js
  const releaseClientDist = path.join(appDir, "packages", "client", "dist");
  const pruned = pruneArenaAssets(releaseClientDist, ACTIVE_ARENA_ID);
  assertOnlyActiveArenaShipped(releaseClientDist, ACTIVE_ARENA_ID);
```

and at the end of `main()`, beside the two existing `console.log` lines:

```js
  console.log(`Arena: ${ACTIVE_ARENA_ID}`);
  if (pruned.removed.length > 0) {
    const kb = Math.round(pruned.bytesRemoved / 1024);
    console.log(`Pruned arena art: ${pruned.removed.join(", ")} (${kb} KB)`);
  }
```

The `cpSync` for the client must already have happened before this runs — `pruneArenaAssets` operates on the copy, and pruning before the copy would do nothing.

- [ ] **Step 6: Run a real release build**

Run: `npm run build:release`
Expected: succeeds, printing `Arena: arena-01`. With no arena art on disk yet there is nothing to prune, so no prune line appears.

- [ ] **Step 7: Prove the prune works against real files**

```bash
mkdir -p packages/client/public/art/arenas/arena-02
node -e "require('fs').writeFileSync('packages/client/public/art/arenas/arena-02/floor.png', Buffer.alloc(200000))"
npm run build:release
```

Expected: the output includes `Pruned arena art: arena-02 (195 KB)`, and:

```bash
ls dist-release/motor-combat-moba/packages/client/dist/art/arenas
```

lists no `arena-02`. Then clean up:

```bash
rm -rf packages/client/public/art/arenas/arena-02
```

- [ ] **Step 8: Run everything**

Run: `npm run test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/build-release.mjs scripts/build-release.test.mjs
git commit -m "feat(release): ship only the active arena's art"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/config-reference.md`
- Modify: `docs/asset-pipeline.md`
- Modify: `docs/deployment.md`
- Modify: `docs/project-structure.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-26-arena-selection-and-release-pruning-design.md` (status line)

**Interfaces:**
- Consumes: everything built in Tasks 1-7. Produces no code.

- [ ] **Step 1: Document the switch in `docs/config-reference.md`**

Add a section, placed with the other shared-config tables:

```markdown
## Arena selection

`ACTIVE_ARENA_ID` in `packages/shared/src/config/arena-config.ts` names the one arena a build plays
and ships. Changing arenas is that single edit:

1. Set `ACTIVE_ARENA_ID` to a key of `ARENAS` in `packages/shared/src/arena/registry.ts`.
2. Rebuild shared — `npm run build -w @motor-combat-moba/shared`, or just restart `npm run dev`.

A value that is not a registered id fails `arena.test.ts`, so a typo breaks the build rather than a
live room. `ArenaState.arenaId` defaults to this constant, which is how the server tells clients
which arena to draw.

To add an arena: write `packages/shared/src/arena/arena-0N.ts`, add one row to `ARENAS`, and export
it from `packages/shared/src/index.ts`. `arena.test.ts` validates every registered arena against the
clearance and spawn rules automatically — no test to write.
```

- [ ] **Step 2: Document the art namespace in `docs/asset-pipeline.md`**

Add:

```markdown
## Arena art

Arena-owned art is namespaced by arena id, so the release can carry only the active arena's files.

| Manifest key | On disk | In the release? |
|---|---|---|
| `arena.<arenaId>.<slot>` | `public/art/arenas/<arenaId>/<slot>.png` | Only when `<arenaId>` is `ACTIVE_ARENA_ID` |
| `arena.common.<slot>` | `public/art/arenas/common/<slot>.png` | Always |
| `car.*`, and anything else | as before | Always |

Two places apply the same rule, both through `arenaIdFromArtKey` in
`packages/shared/src/arena/art-keys.ts`: `shouldLoadAssetKey` filters manifest entries at boot so a
dev build only loads the active arena's art, and `pruneArenaAssets` in `scripts/build-release.mjs`
deletes the other arenas' files from the release.

The consequence worth knowing: an arena you are experimenting with costs the shipped zip nothing, so
there is no reason to delete an arena to keep the download small.
```

- [ ] **Step 3: Document the prune in `docs/deployment.md`**

Add to the description of what `npm run build:release` produces:

```markdown
The release build prints the arena it shipped (`Arena: arena-01`) and, when it removed any, the
arenas whose art it pruned and how much that saved. `assertOnlyActiveArenaShipped` then re-walks the
copied client dist and fails the build if any non-active arena's directory or manifest key survived.

Pruning operates on the copy inside `dist-release/`, so `packages/client/dist` keeps every arena and
running a release twice does not compound.
```

- [ ] **Step 4: Update `docs/project-structure.md`**

Add `packages/shared/src/config/arena-config.ts` (the active-arena constant), `packages/shared/src/arena/art-keys.ts` (the art namespace parser), `packages/shared/src/arena/arena-02.ts`, `packages/client/src/scenes/arena-visual.ts`, `packages/client/src/scenes/arena-mismatch.ts`, and `packages/client/src/ui/screens/arena-mismatch.ts` to the source tree listing, each with the one-line responsibility given in this plan's File Structure table.

- [ ] **Step 5: Record the mismatch symptom in `CLAUDE.md`**

Append to the "Shared `dist` gotcha" section:

```markdown
The arena-specific symptom: if the arena screen shows "Arena mismatch. The server is running
"arena-0N", but this build only knows: …", the server and client are running different builds of
shared. Rebuild shared and hard-refresh the browser. The release zip cannot produce this — it ships
one build of both.
```

- [ ] **Step 6: Mark the spec implemented**

In `docs/superpowers/specs/2026-08-26-arena-selection-and-release-pruning-design.md`, change the status line to:

```markdown
**Status:** Implemented.
**Plan:** [`docs/superpowers/plans/2026-08-26-arena-selection-and-release-pruning.md`](../plans/2026-08-26-arena-selection-and-release-pruning.md)
```

- [ ] **Step 7: Final verification**

Run: `npm run build && npm run test && npm run typecheck && npm run build:release`
Expected: all PASS, with `Arena: arena-01` in the release output.

- [ ] **Step 8: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: document arena selection, the art namespace, and release pruning"
```
