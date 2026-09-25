# Game-mode layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every game-mode difference (config, rules, win logic, HUD) live in that mode's own folders behind interfaces, prove zero behaviour change with per-mode bundle snapshots, and split tests/playtests into common vs mode scope with a mechanical rule for which to run.

**Architecture:** Part A replaces 3×14 copied table files with `BASE_TABLES` (the `config/` globals) plus a typed per-mode overrides object merged by `mergeTables`; per-mode resolved-bundle snapshots are the safety net. Part B introduces `ModeRules` (shared), `ModeController` (server) and `ModeHud` (client), each in a `Record<GameMode, …>` registry, and removes every inline mode branch from common code. Part C moves mode tests into mode folders, adds per-package contract tests, scoped npm scripts, `scripts/test-scope.mjs`, playtest `common/` + `modes/<family>/` with three new mode probes, and `docs/testing.md`.

**Tech Stack:** TypeScript 5.5, npm workspaces, vitest 2, Colyseus schema (server), Phaser 4 (client), node:test for `scripts/*.test.mjs`, tsx for playtest probes.

**Spec:** `docs/superpowers/specs/2026-09-25-game-mode-layer-design.md` (GM1–GM40). Read it before any task.

## Global Constraints

- Zero behaviour change (GM4): every mode's resolved bundle byte-identical before/after; no retune, no wire change.
- `GameMode` enum values never renumbered (hard invariant 7). No schema field added or removed.
- Never read a config accessor at module scope; never read a raw `config/` global outside `modes/base.ts`, `config/` itself, and the existing allow-list in `no-raw-config-in-sim.test.ts`.
- `cfg()` throws outside a mode scope — every new entry point/test that reads config wraps in `withMode`/`withDefaultMode`.
- Build with root `npm run build`, never `--workspaces`. Shared is consumed as built `dist`: after editing shared, `npm run build -w @motor-combat-moba/shared` before running server/client tests.
- Pre-existing failures that stay red and are NOT to be fixed: `packages/server/src/bot/brain/controller.test.ts` › two `G12` "hunts …" cases. Any other red test is yours.
- `docs/ideas/` and `docs/invariants/` are off limits.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LDKfFXirDixdzB5ktUMJtt
  ```
- Work on branch `claude/merge-team-shooter-main-n50hj5`. Do not push (the controller pushes).
- Mode slugs (from `modeSlug`): `brawl` (FFA_LAST_STANDING=0), `team-brawl` (TEAM=1), `deathmatch` (FFA_DEATHMATCH=2), `conquer` (CONQUER=3). Rule/controller family `last-standing` covers brawl + team. Use `modeSlug(mode)` from shared (already exists, `modes/mode-arg.ts`) — verified at plan time.

## Review Focus

1. **Unknown mode byte off the wire** → `rulesOf`, `controllerOf`, `hudOf` fall back to `DEFAULT_GAME_MODE`'s entry and never throw (Tasks 5, 6, 7 each carry a test).
2. **Typo'd override key** (e.g. `cars.mirage.sped`) → `mergeTables` throws at module load naming the full path (Task 2 test).
3. **Two modes overriding the same row** → `BASE_TABLES` is never mutated; the second mode sees base values, not the first mode's override (Task 2 test).
4. **Host switches mode between matches** → `ArenaRoom` resolves `controllerOf(this.state.mode)` per call, never caches it, so a Conquer match after a Brawl match gets zone reset/tick (Task 6 test).
5. **Leaver mid-match in each mode** → last-standing ends when one side remains; deathmatch ends when < 2 roster players; conquer ends when a team is emptied (Task 6 tests, per controller).

---

## Part A — config

### Task 1: Per-mode resolved-bundle snapshots (the GM4 baseline)

**Files:**
- Create: `packages/shared/src/modes/snapshot-serialize.ts`
- Create: `packages/shared/src/modes/snapshots.test.ts`
- Create (generated): `packages/shared/src/modes/__snapshots__/{brawl,team-brawl,deathmatch,conquer}.tables.json`

**Interfaces:**
- Produces: `stableStringify(value: unknown): string` — sorted keys, 2-space indent, trailing newline, non-finite numbers encoded as the strings `"Infinity"`, `"-Infinity"`, `"NaN"`, `undefined` properties omitted.
- Produces: `tablesOf(config: ModeConfig): ModeTables` — the config minus `id` and `derived`.

- [ ] **Step 1: Write the serializer test inside `snapshots.test.ts` and the snapshot test**

```ts
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { MODE_TABLE, modeConfigOf } from "./registry.js";
import { modeSlug } from "./mode-arg.js";
import { stableStringify, tablesOf } from "./snapshot-serialize.js";

describe("stableStringify", () => {
  it("sorts keys, encodes non-finite numbers, drops undefined", () => {
    expect(stableStringify({ b: 1, a: { d: Infinity, c: undefined, e: -Infinity } })).toBe(
      '{\n  "a": {\n    "d": "Infinity",\n    "e": "-Infinity"\n  },\n  "b": 1\n}\n',
    );
  });
  it("keeps array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[\n  3,\n  1,\n  2\n]\n");
  });
});

/**
 * GM10: one file per mode holding that mode's RESOLVED tables. Editing one mode's overrides moves
 * only that mode's file; editing the base moves every mode that does not override the value. A
 * moved file is the blast radius of a config edit, reviewed in the diff and accepted with `-u`.
 */
describe("per-mode resolved tables (GM10)", () => {
  const modes = Object.keys(MODE_TABLE).map(Number) as GameMode[];
  it.each(modes)("mode %i matches its committed snapshot", async (mode) => {
    await expect(stableStringify(tablesOf(modeConfigOf(mode)))).toMatchFileSnapshot(
      `./__snapshots__/${modeSlug(mode)}.tables.json`,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/shared && npx vitest run src/modes/snapshots.test.ts`
Expected: FAIL — cannot resolve `./snapshot-serialize.js`.

- [ ] **Step 3: Implement `snapshot-serialize.ts`**

```ts
import type { ModeConfig, ModeTables } from "./types.js";

/** Canonical JSON for snapshot files: sorted keys, non-finite numbers as strings, no undefined. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function normalize(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner !== undefined) out[key] = normalize(inner);
    }
    return out;
  }
  return value;
}

/** A bundle's authored tables: everything but its `id` and the `derived` artifacts. */
export function tablesOf(config: ModeConfig): ModeTables {
  const { id: _id, derived: _derived, ...tables } = config;
  return tables;
}
```

- [ ] **Step 4: Generate snapshots and verify they pass**

Run: `cd packages/shared && npx vitest run src/modes/snapshots.test.ts -u && npx vitest run src/modes/snapshots.test.ts`
Expected: 4 files written under `src/modes/__snapshots__/`; second run PASS. Confirm `brawl.tables.json` and `team-brawl.tables.json` are identical and `conquer.tables.json` differs from `deathmatch.tables.json` only in `arenas` (`diff` them). If any other difference appears, STOP and report it — the plan assumes it.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/modes/snapshot-serialize.ts packages/shared/src/modes/snapshots.test.ts packages/shared/src/modes/__snapshots__
git commit -m "test(shared): per-mode resolved-bundle snapshots — the GM4 baseline (GM10)"
```

### Task 2: `mergeTables`, `replace()`, `ModeOverrides`

**Files:**
- Create: `packages/shared/src/modes/merge.ts`
- Test: `packages/shared/src/modes/merge.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DeepPartial<T> = T extends readonly (infer _U)[] ? T
    : T extends object ? { readonly [K in keyof T]?: DeepPartial<T[K]> | Replaced<T[K]> } : T;
  export interface Replaced<T> { readonly [REPLACE]: true; readonly value: T }
  export function replace<T>(value: T): Replaced<T>;
  export type ModeOverrides = DeepPartial<ModeTables>;
  export function mergeTables(base: ModeTables, overrides: ModeOverrides): ModeTables;
  ```
  `REPLACE` is a module-private `unique symbol`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { mergeTables, replace, type ModeOverrides } from "./merge.js";
import type { ModeTables } from "./types.js";

// A tiny structural stand-in: mergeTables is generic over plain data, so the test does not need a
// real 1,400-line table set. Cast through unknown at the boundary only.
const base = {
  cars: { mirage: { speed: 85, weapons: ["a", "b"], turret: { x: 1 } } },
  weapons: { a: { damage: 10 } },
  slots: { basicAttackEnabled: false, maxAbilitySlots: 3 },
  arenas: ["arena-01", "arena-02"],
  maxPlayers: 6,
} as unknown as ModeTables;
const o = (x: unknown) => x as ModeOverrides;

describe("mergeTables", () => {
  it("returns equal tables for empty overrides, as a fresh object", () => {
    const out = mergeTables(base, {});
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
    expect((out as any).cars.mirage).not.toBe((base as any).cars.mirage);
  });
  it("merges plain objects key by key", () => {
    const out = mergeTables(base, o({ cars: { mirage: { speed: 90 } }, slots: { basicAttackEnabled: true } })) as any;
    expect(out.cars.mirage).toEqual({ speed: 90, weapons: ["a", "b"], turret: { x: 1 } });
    expect(out.slots).toEqual({ basicAttackEnabled: true, maxAbilitySlots: 3 });
  });
  it("replaces arrays whole", () => {
    const out = mergeTables(base, o({ cars: { mirage: { weapons: ["b"] } }, arenas: ["arena-03"] })) as any;
    expect(out.cars.mirage.weapons).toEqual(["b"]);
    expect(out.arenas).toEqual(["arena-03"]);
  });
  it("replace() swaps a whole row, which is how an optional field is removed", () => {
    const out = mergeTables(base, o({ cars: { mirage: replace({ speed: 1, weapons: [] }) } })) as any;
    expect(out.cars.mirage).toEqual({ speed: 1, weapons: [] });
  });
  it("adds a new keyed row only through replace()", () => {
    const out = mergeTables(base, o({ weapons: { z: replace({ damage: 5 }) } })) as any;
    expect(out.weapons.z).toEqual({ damage: 5 });
  });
  it("throws naming the full path on an unknown key (typo guard, GM13)", () => {
    expect(() => mergeTables(base, o({ cars: { mirage: { sped: 1 } } }))).toThrow(
      "mode override path does not exist in the base: cars.mirage.sped",
    );
    expect(() => mergeTables(base, o({ weapons: { z: { damage: 5 } } }))).toThrow("weapons.z");
  });
  it("throws when an override changes a value's type", () => {
    expect(() => mergeTables(base, o({ maxPlayers: "6" }))).toThrow("maxPlayers");
    expect(() => mergeTables(base, o({ slots: 3 }))).toThrow("slots");
  });
  it("never mutates the base, so two modes overriding one row stay independent", () => {
    const snapshot = structuredClone(base);
    const a = mergeTables(base, o({ cars: { mirage: { speed: 1 } } })) as any;
    const b = mergeTables(base, {}) as any;
    expect(base).toEqual(snapshot);
    expect(a.cars.mirage.speed).toBe(1);
    expect(b.cars.mirage.speed).toBe(85);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/shared && npx vitest run src/modes/merge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `merge.ts`**

```ts
import type { ModeTables } from "./types.js";

const REPLACE: unique symbol = Symbol("replace");

/** A whole value that replaces the base's instead of merging into it (GM8). */
export interface Replaced<T> {
  readonly [REPLACE]: true;
  readonly value: T;
}

/**
 * Wrap a row in `replace(...)` to swap it whole — the only way to add a new keyed row (a new car,
 * weapon or status) or to REMOVE an optional field (e.g. a weapon's `turret`) from a base row.
 */
export function replace<T>(value: T): Replaced<T> {
  return { [REPLACE]: true, value };
}

function isReplaced(value: unknown): value is Replaced<unknown> {
  return typeof value === "object" && value !== null && REPLACE in value;
}

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [K in keyof T]?: DeepPartial<T[K]> | Replaced<T[K]> }
    : T;

/** What a mode folder authors: only the values it changes from the base (GM7, GM8). */
export type ModeOverrides = DeepPartial<ModeTables>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kindOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function mergeInto(base: unknown, override: unknown, path: string): unknown {
  if (isReplaced(override)) return structuredClone(override.value);
  if (kindOf(base) !== kindOf(override)) {
    throw new Error(`mode override at ${path} is ${kindOf(override)}, base is ${kindOf(base)}`);
  }
  if (!isPlainObject(base) || !isPlainObject(override)) return structuredClone(override);
  const out: Record<string, unknown> = structuredClone(base);
  for (const key of Object.keys(override)) {
    const inner = override[key];
    if (inner === undefined) continue;
    const at = path === "" ? key : `${path}.${key}`;
    if (!Object.prototype.hasOwnProperty.call(base, key)) {
      if (isReplaced(inner)) {
        out[key] = structuredClone(inner.value);
        continue;
      }
      throw new Error(`mode override path does not exist in the base: ${at}`);
    }
    out[key] = mergeInto(base[key], inner, at);
  }
  return out;
}

/**
 * Base tables plus one mode's overrides → that mode's tables. Plain objects merge key by key;
 * arrays and primitives replace; `replace(...)` swaps a whole value. Never mutates either input.
 * Throws on a path the base does not have (a typo'd override must not silently do nothing, GM13)
 * or on a type change.
 */
export function mergeTables(base: ModeTables, overrides: ModeOverrides): ModeTables {
  return mergeInto(base, overrides, "") as ModeTables;
}
```

- [ ] **Step 4: Run tests, verify pass; typecheck**

Run: `cd packages/shared && npx vitest run src/modes/merge.test.ts && npx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/modes/merge.ts packages/shared/src/modes/merge.test.ts
git commit -m "feat(shared): mergeTables + replace() — per-mode overrides over a base (GM8, GM13)"
```

### Task 3: `BASE_TABLES` + per-mode overrides; delete the copied table files

**Files:**
- Create: `packages/shared/src/modes/base.ts`
- Create: `packages/shared/src/modes/{brawl,team-brawl,deathmatch,conquer}/config.ts`
- Create: `packages/shared/src/modes/team-brawl/index.ts`
- Modify: `packages/shared/src/modes/{brawl,deathmatch,conquer}/index.ts` (rewrite)
- Delete: every other `.ts` file in `modes/brawl/`, `modes/deathmatch/`, `modes/conquer/` (13 each: cars, weapons, drive, ram, impulse, combat, turret, status, spike, slots, flow, deathmatch, conquer, camera)
- Delete: `packages/shared/src/modes/table-pinning.test.ts`, `packages/shared/src/modes/parity.test.ts`
- Modify: `packages/shared/src/modes/registry.ts` (TEAM → `TEAM_TABLES`, doc comment)
- Modify: every importer of a deleted file (found by `grep -rn "modes/brawl/\|modes/deathmatch/\|modes/conquer/\|BRAWL_\|DEATHMATCH_[A-Z]*\b\|CONQUER_[A-Z]*\b" packages scripts --include=*.ts --include=*.mjs | grep -v node_modules | grep -v /dist/`): at plan time these are `config/tuning.ts`, `modes/overlay.ts`, `modes/build.ts`, `modes/*.test.ts` (overlay, registry-arenas, concurrency, build, active, accessor-routing), `sim/weapons/fire.test.ts`, `sim/combat.test.ts`, `client/src/net/mode-scope.test.ts`, `client/src/ui/lobby-view.ts` + test.
- Modify: `packages/shared/src/modes/no-raw-config-in-sim.test.ts` (allow `modes/base.ts`)

**Interfaces:**
- Consumes: `mergeTables`, `replace`, `ModeOverrides` (Task 2).
- Produces: `BASE_TABLES: ModeTables` from `modes/base.ts`; `BRAWL_OVERRIDES`, `TEAM_OVERRIDES`, `DEATHMATCH_OVERRIDES`, `CONQUER_OVERRIDES: ModeOverrides`; `BRAWL_TABLES`, `TEAM_TABLES`, `DEATHMATCH_TABLES`, `CONQUER_TABLES: ModeTables` (same names as before for the three that existed).

- [ ] **Step 1: Write `modes/base.ts`**

Assemble from the `config/` globals (check each export name in its file; the list below is the set `ModeTables` needs):

```ts
// GM6: the common defaults every mode starts from. These ARE the `config/` globals — editing one
// changes every mode that does not override that value, and the per-mode snapshots
// (`__snapshots__/<slug>.tables.json`) show exactly which modes moved.
import type { ArenaId } from "../arena/registry.js";
import { CAR_TABLE } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { CONQUER_CONFIG } from "../config/conquer-config.js";
import { DEATHMATCH_CONFIG } from "../config/deathmatch-config.js";
import { CAMERA_CONFIG, DRIVE_CONFIG } from "../config/drive-config.js";
import { FLOW_CONFIG } from "../config/flow-config.js";
import { IMPULSE_CONFIG } from "../config/impulse-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import { SPIKE_CONFIG } from "../config/spike-config.js";
import { STATUS_CONFIG, STATUS_LIMITS } from "../config/status-config.js";
import { STATUS_TABLE } from "../config/status-table.js";
import { TURRET_CONFIG } from "../config/turret-config.js";
import { WEAPON_TABLE } from "../config/weapon-config.js";
import { WEAPON_SLOT_CONFIG } from "../config/weapon-slots.js";
import type { ModeTables } from "./types.js";

// The hull is global (MC35): stripped here so no mode's tables can carry it.
const { carWidth: _w, carHeight: _h, ...DRIVE_WITHOUT_HULL } = DRIVE_CONFIG;

export const BASE_TABLES: ModeTables = {
  cars: CAR_TABLE,
  weapons: WEAPON_TABLE,
  drive: DRIVE_WITHOUT_HULL,
  ram: RAM_CONFIG,
  impulse: IMPULSE_CONFIG,
  combat: COMBAT_CONFIG,
  turret: TURRET_CONFIG,
  statusConfig: STATUS_CONFIG,
  statusTable: STATUS_TABLE,
  statusLimits: STATUS_LIMITS,
  spike: SPIKE_CONFIG,
  slots: WEAPON_SLOT_CONFIG,
  flow: FLOW_CONFIG,
  deathmatch: DEATHMATCH_CONFIG,
  conquer: CONQUER_CONFIG,
  camera: CAMERA_CONFIG,
  arenas: ["arena-01", "arena-02"] as readonly ArenaId[],
  maxPlayers: 6,
};
```

Verify each import path/name with `grep -n "export const <NAME>" packages/shared/src/config/*.ts` (the deleted `table-pinning.test.ts` imports show the right paths — read it before deleting).

- [ ] **Step 2: Write the four `config.ts` files and indexes**

`modes/brawl/config.ts`:
```ts
import type { ModeOverrides } from "../merge.js";

/**
 * Brawl's differences from the base (`modes/base.ts`). Empty: Brawl plays the common defaults.
 * Add only the values Brawl changes; the snapshot `__snapshots__/brawl.tables.json` shows the
 * resolved result.
 */
export const BRAWL_OVERRIDES: ModeOverrides = {};
```
`modes/team-brawl/config.ts`: same shape, `TEAM_OVERRIDES`, text "Team brawl's differences … Empty today; Team brawl has its own folder so it can diverge from Brawl without touching it."
`modes/deathmatch/config.ts`: `DEATHMATCH_OVERRIDES = {}`.
`modes/conquer/config.ts`:
```ts
import type { ArenaId } from "../../arena/registry.js";
import type { ModeOverrides } from "../merge.js";

/** Conquer's differences from the base. It plays its own arena (CQ20); every number is the base's. */
export const CONQUER_OVERRIDES: ModeOverrides = {
  arenas: ["arena-03"] as readonly ArenaId[],
};
```
Keep the CQ42 comment from the deleted `modes/conquer/deathmatch.ts` by moving it into `CONQUER_OVERRIDES`'s doc comment (it explains why the base `phaseSeconds` ceiling matters for Conquer).

Each `index.ts` (example brawl; same for team/deathmatch/conquer with their names):
```ts
import { BASE_TABLES } from "../base.js";
import { mergeTables } from "../merge.js";
import type { ModeTables } from "../types.js";
import { BRAWL_OVERRIDES } from "./config.js";

export const BRAWL_TABLES: ModeTables = mergeTables(BASE_TABLES, BRAWL_OVERRIDES);
```

- [ ] **Step 3: Point the registry's TEAM row at `TEAM_TABLES`**; rewrite its doc comment: "TEAM has its own folder (`modes/team-brawl/`), empty overrides today, so it can diverge from Brawl."

- [ ] **Step 4: Delete the 39 copied table files and the two copy-equality tests**

```bash
cd packages/shared/src/modes
for m in brawl deathmatch conquer; do find $m -name '*.ts' ! -name index.ts ! -name config.ts -delete; done
git rm -q table-pinning.test.ts parity.test.ts
```

- [ ] **Step 5: Fix every importer of a deleted symbol.** Rules: a test that needs "a mode's tables" uses `modeConfigOf(GameMode.X)` or `tablesOf(modeConfigOf(...))`; code that needed the raw defaults uses `BASE_TABLES`; a test that asserted two copies were equal is deleted with the reason in the commit message (the snapshot replaces it). `config/tuning.ts` and `modes/overlay.ts` must not import a mode folder at all — if they did for defaults, use `BASE_TABLES`. `client/src/ui/lobby-view.ts` — if it imports a mode table, switch to `modeConfigOf`. Also check that `parity.test.ts` asserted nothing beyond copy-equality (read it first; move any non-copy assertion into `invariants.test.ts`).

- [ ] **Step 6: `no-raw-config-in-sim.test.ts`** — add `modes/base.ts` to its allow-list with the comment `// the base IS the raw globals (GM6)`. Read the test to find the allow-list shape.

- [ ] **Step 7: Verify zero change**

Run: `cd packages/shared && npx tsc --noEmit -p . && npx vitest run`
Expected: typecheck clean; ALL shared tests pass; `snapshots.test.ts` passes WITHOUT `-u` (GM4 proof). If a snapshot differs, the base or an override is wrong — fix it, never update the snapshot.
Then: `cd ../.. && npm run build && npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` — only the two G12 failures.

- [ ] **Step 8: Commit** (list deleted files/tests in body)

```bash
git add -A packages/shared scripts packages/client packages/server
git commit -m "refactor(shared): modes are base + overrides; delete 39 copied table files (GM6, GM7, GM11)"
```

### Task 4: Basic attack per mode — delete `BASIC_ATTACK_CONFIG`

**Files:**
- Modify: `packages/shared/src/config/weapon-config.ts` (delete `BASIC_ATTACK_CONFIG` and its doc; keep `BASIC_ATTACK_BASE`)
- Modify: `packages/shared/src/config/weapon-slots.ts` (`basicAttackEnabled: false` literal; rewrite the doc: "per mode; override `slots.basicAttackEnabled` in a mode's `config.ts`")
- Modify: `packages/shared/src/index.ts` (drop the export)
- Modify: `packages/server/src/bot/brain/firing.ts:263` → `if (i === basicAttackSlotIndex && !slots().basicAttackEnabled) continue;` (confirm `slots` is already imported — it is; it reads `slots()` for `basicAttackSlotIndex` just above; the bot runs inside the room's mode scope)
- Modify: `packages/client/src/config/slot-keys.ts:77` → `hintSlotOrder(slots().basicAttackEnabled)`; update the doc comment at :51
- Modify: `packages/client/src/scenes/ArenaScene.ts:4709-4710` → `slots().basicAttackEnabled` (import `slots` from shared if not already; drop `BASIC_ATTACK_CONFIG` import)
- Modify: `packages/client/src/scenes/movement-hint.ts:37`, `packages/client/src/config/aim-hud.ts:42` (comments only)
- Modify: `scripts/build-cars-and-weapons.mjs` and any other `scripts/*.mjs` reading the flag → read `modeConfigOf(mode).slots.basicAttackEnabled` per tab (the generator already loops modes via `withMode`; inside it, `slots().basicAttackEnabled`). The stamp must hash the per-mode flag (it already hashes each mode's `slots` table — then drop the separate global flag from the stamp inputs).
- Modify tests that flip the global: `shared/src/config/{weapon-slots,turret-config}.test.ts`, `shared/src/sim/weapons/{turret,instances,fire}.test.ts`, `shared/src/sim/combat.test.ts`, `shared/src/modes/no-raw-config-in-sim.test.ts`, `server/src/rooms/tick-pipeline.test.ts`, `server/src/bot/brain/{solution,firing,tiers}.test.ts`, `client/src/config/slot-keys.test.ts`, `client/src/scenes/movement-hint.test.ts`, `scripts/manual-page.test.mjs`.

**Interfaces:**
- Consumes: `applyOverrides(base: ModeConfig, overrides: TuningOverrides): ModeConfig` (existing, `modes/overlay.ts`), `withMode(config, fn)`.
- Produces (test helper, add to `packages/shared/src/modes/test-setup.ts`):
  ```ts
  /** Runs `fn` under the default mode's bundle with `slots.basicAttackEnabled` set to `enabled`. */
  export function withBasicAttack<T>(enabled: boolean, fn: () => T): T {
    const base = modeConfigOf(DEFAULT_GAME_MODE);
    return withMode(applyOverrides(base, { "slots.basicAttackEnabled": enabled }), fn);
  }
  ```
  First check that `applyOverrides` accepts the `slots.*` root (read `rootsOf` in `overlay.ts`); if `slots` is not a root, add it there (one line) with a test in `overlay.test.ts`. Server/client tests import it via a relative path is not possible across packages — for them, build the bundle inline with `applyOverrides`/`withMode` imported from `@motor-combat-moba/shared` (check they are exported from `index.ts`; export them if not).

- [ ] **Step 1:** Add `withBasicAttack` + the `overlay.test.ts` case `applyOverrides can switch slots.basicAttackEnabled` (asserts the returned bundle's `slots.basicAttackEnabled` flipped and the base's did not). Run → FAIL if the root is missing, then fix.
- [ ] **Step 2:** Rewrite each test listed above that mutated `BASIC_ATTACK_CONFIG.enabled` to use `withBasicAttack(true|false, …)` (shared) or `withMode(applyOverrides(modeConfigOf(DEFAULT_GAME_MODE), {"slots.basicAttackEnabled": x}), …)` (server/client/scripts). Remove save/restore `afterEach` blocks that existed only to restore the global. Delete the test that "pins `slots().basicAttackEnabled` equal to `BASIC_ATTACK_CONFIG.enabled`" (the global is gone; say so in the commit).
- [ ] **Step 3:** Apply the production edits listed in Files.
- [ ] **Step 4: Verify**

Run: `grep -rn "BASIC_ATTACK_CONFIG" packages scripts .claude docs --include=*.ts --include=*.mjs | grep -v node_modules | grep -v /dist/` → no hits in code (docs updated in Task 16).
Run: `npm run build && npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → only the two G12 failures.
Run: `npm run build:manual && git diff --stat packages/client/public/manual.html` → if only the embedded stamp changed, keep the rebuilt page and say so in the commit; if visible content changed, STOP and report.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor: basic attack is per mode (slots.basicAttackEnabled); delete BASIC_ATTACK_CONFIG (GM9)"
```

---

## Part B — the mode layer

### Task 5: Shared `ModeRules`, rule registry, outcome modules

**Files:**
- Create: `packages/shared/src/modes/rules-types.ts`, `packages/shared/src/modes/rules-registry.ts`
- Create: `packages/shared/src/modes/last-standing/rules.ts`, `packages/shared/src/modes/last-standing/outcome.ts`
- Create: `packages/shared/src/modes/deathmatch/rules.ts`, `packages/shared/src/modes/deathmatch/outcome.ts`
- Create: `packages/shared/src/modes/conquer/rules.ts`, `packages/shared/src/modes/conquer/outcome.ts` (content of `flow/conquer.ts`)
- Create: `packages/shared/src/modes/brawl/rules.ts`, `packages/shared/src/modes/team-brawl/rules.ts` (one-liners over the family)
- Move tests: `flow/win.test.ts` → split into `modes/last-standing/outcome.test.ts` and `modes/deathmatch/outcome.test.ts`; `flow/conquer.test.ts` → `modes/conquer/outcome.test.ts`; `flow/modes.test.ts` → rewrite as `modes/rules-registry.test.ts` (common) + per-mode cases in each `modes/<slug>/rules.test.ts`; `lobby/start-rules.test.ts` mode-specific cases → the mode's `rules.test.ts` (keep a common test that `canStart` delegates).
- Delete: `flow/win.ts`, `flow/conquer.ts` (after moving), and from `flow/modes.ts` delete `sidesOf` and `respawnsIn` (keep `winRuleOf` until Task 9 — it still has server/client callers).
- Modify: `lobby/start-rules.ts`, `lobby/car-claims.ts`, `flow/spawns.ts`, `index.ts`; every caller of `sidesOf`/`respawnsIn` in all packages (list: `server/src/rooms/{ArenaRoom,tick-pipeline,PracticeRoom}.ts`, `client/src/ui/{reveal-view,lobby-view}.ts`, `client/src/scenes/{ArenaScene,spectate}.ts`, `packages/server/balance/*.ts`, `packages/server/playtest/*.ts`, `scripts/*.mjs` — grep to confirm).

**Interfaces:**
- Produces (`rules-types.ts`):
  ```ts
  import type { ModeConfig } from "./types.js";
  export type Sides = "ffa" | "team";
  export interface StartRulePlayer { status: "ready" | "in_match" | "post_match"; team: number }
  export type CanStartResult = { ok: true } | { ok: false; error: string };
  export interface ModeRules {
    readonly sides: Sides;
    readonly respawns: boolean;
    readonly hasMatchClock: boolean;
    canStart(config: ModeConfig, ready: readonly StartRulePlayer[]): CanStartResult;
    claimsChassis(config: ModeConfig): boolean;
  }
  ```
  `StartRulePlayer`/`CanStartResult` MOVE here from `lobby/start-rules.ts` (re-exported from there and from `index.ts` under the same names). `canStart` receives only READY players.
- Produces (`rules-registry.ts`): `export const MODE_RULES = {...} satisfies Record<GameMode, ModeRules>`; `export function rulesOf(mode: number): ModeRules` — `isGameMode(mode) ? MODE_RULES[mode] : MODE_RULES[DEFAULT_GAME_MODE]`.
- Produces (`last-standing/rules.ts`): `export function lastStandingRules(sides: Sides): ModeRules` — `respawns:false`, `hasMatchClock:false`, `claimsChassis: () => false`; `canStart`: ffa → ≥2 ready else "Need at least 2 ready players"; team → each team ≥1 ("Need at least 1 ready player per team") and equal ("Teams must be equal to start") — exact strings from today's `start-rules.ts`.
- Produces (`deathmatch/rules.ts`): `DEATHMATCH_RULES: ModeRules` — `sides:"ffa"`, `respawns:true`, `hasMatchClock:true`, `canStart` = ffa ≥2, `claimsChassis: () => false`.
- Produces (`conquer/rules.ts`): `CONQUER_RULES: ModeRules` — `sides:"team"`, `respawns:true`, `hasMatchClock:true`, `canStart(config, ready)`: exactly `config.conquer.teamSize` ready per team else `` `Conquer needs exactly ${size} ready players per team` ``; `claimsChassis: (c) => c.conquer.uniqueChassisPerTeam`.
- `brawl/rules.ts`: `export const BRAWL_RULES = lastStandingRules("ffa");` `team-brawl/rules.ts`: `export const TEAM_RULES = lastStandingRules("team");`
- Outcome modules export the SAME names they export today (`livingSides`, `livingAfterLeave`, `LivingPlayer`, `LivingSidesResult` from last-standing; `DeathmatchPlayer`, `deathmatchOutcome`, `deathmatchEnded` from deathmatch; everything in `flow/conquer.ts` from conquer) and `index.ts` re-exports them unchanged, so external importers do not change. Note `deathmatchOutcome` returns `LivingSidesResult` — import that type from `../last-standing/outcome.js`.
- `lobby/start-rules.ts` becomes:
  ```ts
  export function canStart(mode: GameMode, players: readonly StartRulePlayer[]): CanStartResult {
    return rulesOf(mode).canStart(modeConfigOf(mode), players.filter((p) => p.status === "ready"));
  }
  ```
- `lobby/car-claims.ts`: `uniqueChassisApplies(mode) = rulesOf(mode).claimsChassis(modeConfigOf(mode))`.
- Caller migration: `sidesOf(x)` → `rulesOf(x).sides`; `respawnsIn(x)` → `rulesOf(x).respawns`; `this.state.matchEndsTick = respawnsIn(mode) ? … : 0` → `rulesOf(mode).hasMatchClock ? … : 0`.

- [ ] **Step 1: Write failing tests** — `modes/rules-registry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, MODE_TABLE } from "./registry.js";
import { MODE_RULES, rulesOf } from "./rules-registry.js";

describe("rulesOf", () => {
  it("has an entry for every GameMode in MODE_TABLE", () => {
    expect(Object.keys(MODE_RULES).sort()).toEqual(Object.keys(MODE_TABLE).sort());
  });
  it("falls back to the default mode's rules for an unknown wire byte, never throws", () => {
    expect(rulesOf(250)).toBe(MODE_RULES[DEFAULT_GAME_MODE]);
    expect(rulesOf(-1)).toBe(MODE_RULES[DEFAULT_GAME_MODE]);
  });
});
```
and per-mode `rules.test.ts` in `modes/brawl`, `modes/team-brawl`, `modes/deathmatch`, `modes/conquer` asserting each field and every `canStart` branch with its exact error string (port the cases from `lobby/start-rules.test.ts` and `flow/modes.test.ts`; e.g. conquer: `[3 on team 0, 3 on team 1]` ok, `[3,2]` fails with "Conquer needs exactly 3 ready players per team", `claimsChassis(modeConfigOf(GameMode.CONQUER))` true; brawl: 1 ready fails "Need at least 2 ready players").
- [ ] **Step 2:** Run → FAIL (modules missing).
- [ ] **Step 3:** Implement rules, registry, outcome moves (use `git mv` for `flow/conquer.ts` → `modes/conquer/outcome.ts` and its test to keep history), start-rules/car-claims/spawns rewrites, index exports (`rulesOf`, `MODE_RULES`, `ModeRules`, `Sides`, `lastStandingRules`), delete `sidesOf`/`respawnsIn` from `flow/modes.ts` and migrate every caller in all packages.
- [ ] **Step 4: Verify**: `cd packages/shared && npx tsc --noEmit -p . && npx vitest run` then `cd ../.. && npm run build && npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → only G12. `grep -rn "sidesOf\|respawnsIn" packages scripts --include=*.ts --include=*.mjs | grep -v node_modules | grep -v /dist/` → none.
- [ ] **Step 5: Commit** `refactor(shared): ModeRules per mode, rulesOf registry, outcome logic in mode folders (GM14–GM17)`

### Task 6: Server `ModeController` per family; `ArenaRoom` stops naming modes

**Files:**
- Create: `packages/server/src/modes/types.ts`, `packages/server/src/modes/registry.ts`
- Create: `packages/server/src/modes/last-standing/controller.ts`, `packages/server/src/modes/deathmatch/controller.ts`, `packages/server/src/modes/conquer/controller.ts` (absorbs `rooms/conquer-room.ts`)
- Tests: `packages/server/src/modes/{last-standing,deathmatch,conquer}/controller.test.ts`; `git mv rooms/conquer-room.test.ts modes/conquer/zone-fields.test.ts` (its read/write/reset/advance cases); `packages/server/src/modes/registry.test.ts`
- Delete: `packages/server/src/rooms/conquer-room.ts`
- Modify: `packages/server/src/rooms/ArenaRoom.ts` (leave handler ~L413-447, `tick()` ~L450-520, `conquerTick`/`checkDeathmatchEnd` deleted, `applyFlow` MATCH edge ~L603-612)

**Interfaces:**
- Consumes: `rulesOf` (Task 5); outcome exports (`livingSides`, `livingAfterLeave`, `deathmatchEnded`, `deathmatchOutcome`, `stepZone`, `zonePresence`, `conquerOutcome`, `conquerLeaveOutcome`, `ZonePresenceCar`, `ZoneState`) from `@motor-combat-moba/shared`; `derived()`, `getArena`.
- Produces (`modes/types.ts`):
  ```ts
  import type { ArenaState } from "../state/ArenaState.js"; // verify the actual path
  export interface MatchOutcome { readonly winnerSessionId: string; readonly winnerTeam: number }
  export interface CombatPlayerView {
    readonly sessionId: string; readonly team: 0 | 1; readonly alive: boolean; readonly inRoster: boolean;
  }
  export interface ModeRoomView { readonly state: ArenaState; readonly roster: ReadonlySet<string> }
  export interface ModeController {
    onMatchStart(room: ModeRoomView): void;
    afterTick(room: ModeRoomView, combatPlayers: readonly CombatPlayerView[]): MatchOutcome | undefined;
    afterLeave(room: ModeRoomView): MatchOutcome | undefined;
  }
  ```
- Produces (`registry.ts`): `MODE_CONTROLLERS = {[GameMode.FFA_LAST_STANDING]: LAST_STANDING_CONTROLLER, [GameMode.TEAM]: LAST_STANDING_CONTROLLER, [GameMode.FFA_DEATHMATCH]: DEATHMATCH_CONTROLLER, [GameMode.CONQUER]: CONQUER_CONTROLLER} satisfies Record<GameMode, ModeController>`; `controllerOf(mode: number): ModeController` with default fallback.
- Behaviour, moved verbatim from `ArenaRoom`:
  - `LAST_STANDING_CONTROLLER` (reads `rulesOf(state.mode).sides`): `onMatchStart` sets `state.matchEndsTick = 0`; `afterTick` = `livingSides(sides, combatPlayers)`, ends when `sides <= 1`; `afterLeave` = `livingSides(sides, livingAfterLeave(remainingPlayers, roster))`, same end test, where `remainingPlayers` is built from `state.players` exactly as ArenaRoom L433-440 does.
  - `DEATHMATCH_CONTROLLER`: `onMatchStart` sets `state.matchEndsTick = state.tick + derived().deathmatchTicks.match`; `afterTick` and `afterLeave` both = today's `checkDeathmatchEnd` (roster players → `deathmatchEnded` → `deathmatchOutcome`).
  - `CONQUER_CONTROLLER`: `onMatchStart` sets `matchEndsTick` as deathmatch does AND `resetZone(state)`; `afterTick` = today's `conquerTick` (zone from `getArena(state.arenaId).zone`, cars from `state.players` with `inRoster: roster.has(id)`, `advanceConquer` with `derived().conquerTicks`), outcome `{winnerSessionId: "", winnerTeam}`; `afterLeave` = today's L418-426 team counts → `conquerLeaveOutcome`.
  - `ArenaRoom`: leave → `const out = controllerOf(this.state.mode).afterLeave(this.modeView()); if (out) this.endMatch(out.winnerSessionId, out.winnerTeam);` tick → `const out = controllerOf(this.state.mode).afterTick(this.modeView(), combatPlayers.map(...)); if (out) this.endMatch(...)`; `applyFlow` MATCH edge → `controllerOf(this.state.mode).onMatchStart(this.modeView())` replacing the `matchEndsTick` ternary and `resetZone`; respawn sweep and `runPhaseSweep` → `rulesOf(this.state.mode).respawns`. `private modeView(): ModeRoomView { return { state: this.state, roster: this.matchRoster }; }`. Never store the controller on the room (Review Focus 4).
  - NOTE behaviour delta, intended by GM20: non-Conquer modes no longer call `resetZone`. Zone fields are 0/-1/false by schema default and nothing else writes them outside Conquer; the controller tests assert Brawl leaves them untouched.

- [ ] **Step 1: Failing tests** — controller tests with a hand-built `ArenaState` (see how `rooms/conquer-room.test.ts` and `rooms/tick-pipeline.test.ts` construct state; wrap in `withMode(modeConfigOf(mode), …)`):
  - last-standing ffa: 3 roster, 2 dead → outcome winner = survivor; all dead → draw (`winnerSessionId: ""`, `winnerTeam: -1` — check `livingSides`' exact draw shape and assert it); 2 alive → undefined. Team: team 1 all dead → `winnerTeam: 0`.
  - last-standing afterLeave: 2-player ffa, one leaves → the remaining player wins.
  - deathmatch: before `matchEndsTick` → undefined; at it → highest kills wins; `onMatchStart` stamps `matchEndsTick = tick + derived().deathmatchTicks.match`; afterLeave with 1 roster player left → ends.
  - conquer: `onMatchStart` resets zone fields and stamps clock; `afterTick` with 1 team-0 car in zone for `captureDelay` ticks then `controlTarget` ticks → winnerTeam 0; afterLeave with team 1 emptied → winnerTeam 0.
  - registry: every mode has a controller; `controllerOf(250)` → default's; brawl and team share `LAST_STANDING_CONTROLLER`.
  - Review Focus 4: a test that calls `controllerOf(GameMode.FFA_LAST_STANDING).onMatchStart` then switches `state.mode = GameMode.CONQUER` and asserts `controllerOf(state.mode)` is the conquer controller (documents the per-call resolution contract).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement controllers, registry; migrate ArenaRoom; delete `conquer-room.ts`.
- [ ] **Step 4: Verify:** `cd packages/server && npx tsc --noEmit -p . && npx vitest run` → only G12 red. `grep -n "winRuleOf\|conquer\|deathmatch\|GameMode\." packages/server/src/rooms/ArenaRoom.ts` → no mode-specific hits (comments naming a controller file are fine).
- [ ] **Step 5: Commit** `refactor(server): ModeController per family; ArenaRoom never names a mode (GM18–GM21)`

### Task 7: Client `ModeHud` — lobby card, results, clock, kills, spectate

**Files:**
- Create: `packages/client/src/modes/types.ts`, `packages/client/src/modes/registry.ts`
- Create: `packages/client/src/modes/{brawl,team-brawl,deathmatch,conquer}/hud.ts` and `hud.test.ts` each
- Modify: `packages/client/src/ui/lobby-view.ts` (delete `modeCardsData`; `modeCards()` builds from `activeGameModes()` + `hudOf(m).lobbyCard()`), `packages/client/src/ui/results-view.ts` (`controlLine` → `hudOf(mode).resultsLine`; conquer branch of `winnerLabel` → `hudOf(mode).resultsHeadline?.(...) ?? defaultWinnerLabel(...)`), `packages/client/src/scenes/ArenaScene.ts` (L3802 `showKills` → `hudOf(room.state.mode).showsKills`; L4657 clock → `hudOf(room.state.mode).clockLabel(room.state, tick)`), `packages/client/src/scenes/spectate.ts` (already migrated to `rulesOf` in Task 5 — confirm).
- Move tests: mode-specific cases in `ui/lobby-view.test.ts`, `ui/results-view.test.ts`, `scenes/deathmatch-hud.test.ts` → the mode's `hud.test.ts`. Keep common cases (layout, labels, non-mode logic) where they are.

**Interfaces:**
- Produces (`modes/types.ts`):
  ```ts
  import type { ArenaState } from "@motor-combat-moba/shared"; // use whatever type ArenaScene's room.state has (check imports in ArenaScene)
  import type { ResultsViewState } from "../ui/results-view.js";
  export interface ModeCardCopy { readonly kicker: string; readonly body: string; readonly meta: readonly string[] }
  export interface ModeHud {
    lobbyCard(): ModeCardCopy;
    clockLabel(state: ArenaState, tick: number): string;
    readonly showsKills: boolean;
    resultsLine(state: ResultsViewState, localSessionId: string): string | undefined;
    resultsHeadline?(state: ResultsViewState, localSessionId: string): string | undefined;
    createGutter?(host: GutterHost): ModeGutter; // types added in Task 8; declare as `unknown`-free placeholders there
  }
  ```
  In Task 7 declare `createGutter?` WITHOUT the host types (omit the member); Task 8 adds it.
- Produces (`registry.ts`): `MODE_HUDS satisfies Record<GameMode, ModeHud>`; `hudOf(mode: number): ModeHud` with default fallback.
- Behaviour (moved verbatim):
  - brawl: card = today's FFA_LAST_STANDING copy; `clockLabel` = `matchClockLabel(tick, state.matchEndsTick)` (it returns "" when `matchEndsTick` is 0 — verify; if not, return ""), `showsKills: false`, `resultsLine: () => undefined`.
  - team: today's TEAM copy; otherwise as brawl.
  - deathmatch: today's copy, but read `modeConfigOf(GameMode.FFA_DEATHMATCH).deathmatch` instead of the ambient `deathmatch()` (same values — each card reads its own mode's bundle); `clockLabel` = `matchClockLabel(...)`; `showsKills: true`.
  - conquer: today's copy reading `modeConfigOf(GameMode.CONQUER)` (it already does); `clockLabel: () => ""` (clock lives in the gutter, CQ56); `showsKills: false`; `resultsLine` = today's `controlLine`; `resultsHeadline` = today's conquer branch of `winnerLabel` ("Draw"/"You win"/"You lose").
  - `matchClockLabel` and `respawnSeconds` stay in their current common modules (`scenes/deathmatch-hud.ts` — if that file is deathmatch-only in name but used by conquer too, leave it common and say so in a comment; do not rename it in this task).

- [ ] **Step 1: Failing tests** — `modes/registry.test.ts` (every mode has a HUD; `hudOf(250)` is default's), and each `hud.test.ts`: card copy equals today's strings (port the assertions from `lobby-view.test.ts`), `showsKills`, `clockLabel` for a state with and without `matchEndsTick`, conquer's `resultsLine`/`resultsHeadline` (port from `results-view.test.ts`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; migrate the four call sites; delete `modeCardsData` (and its re-export — grep for importers; `lobby-view.test.ts` may import it: port those cases).
- [ ] **Step 4: Verify:** `cd packages/client && npx tsc --noEmit -p . && npx vitest run` → all pass. `grep -n "winRuleOf" packages/client/src --include=*.ts -r` → only `ArenaScene.ts` L1941 (gutter, Task 8) remains.
- [ ] **Step 5: Commit** `refactor(client): ModeHud per mode — lobby card, clock, kills, results (GM22, GM23, GM25)`

### Task 8: Client — Conquer's gutter moves into `modes/conquer/`

**Files:**
- Create: `packages/client/src/modes/conquer/gutter.ts`
- Move: `git mv packages/client/src/scenes/conquer-hud.ts packages/client/src/modes/conquer/layout.ts` and `conquer-hud.test.ts` → `modes/conquer/layout.test.ts` (fix imports)
- Modify: `packages/client/src/modes/types.ts` (add `GutterHost`, `ModeGutter`, `createGutter?`), `packages/client/src/modes/conquer/hud.ts` (`createGutter`), `packages/client/src/scenes/ArenaScene.ts` (delete `renderConquerGutter`, `conquerTexts`, `conquerHud` and their creation at ~L3670-3697 and destruction ~L1844-1853 and HUD-camera routing ~L1677; add a `modeGutter: ModeGutter | undefined` created where the conquer texts were created, destroyed where they were destroyed, its `objects()` routed where `conquerTexts` were routed; L1940-1943 → `this.modeGutter ? this.modeGutter.render(room) : this.renderRosterPanel(room)`)

**Interfaces:**
- Produces:
  ```ts
  export interface GutterHost {
    /** A HUD text at depth/scroll settings identical to today's `conquerText` helper. */
    addText(fontPx: number, originX: number, originY: number): Phaser.GameObjects.Text;
    /** The live roster layer (`rosterGfx`), cleared by the gutter each frame. */
    readonly gfx: Phaser.GameObjects.Graphics | undefined;
    /** The pooled roster row texts the default panel also uses. */
    readonly rosterNameTexts: readonly Phaser.GameObjects.Text[];
    readonly rosterKillTexts: readonly Phaser.GameObjects.Text[];
    /** The session id of the car the local player drives (`drivenSid`). */
    viewerSessionId(room: Room<ArenaState>): string;
    /** Body colour for a roster swatch (`carFillFor`). */
    carFill(sessionId: string, colorId: number): number;
  }
  export interface ModeGutter {
    render(room: Room<ArenaState>): number;
    objects(): Phaser.GameObjects.GameObject[];
    destroy(): void;
  }
  ```
  `ModeHud.createGutter?(host: GutterHost): ModeGutter`. `ArenaScene` implements `GutterHost` with an object literal (getters for `gfx`, because `rosterGfx` is recreated) — not by passing `this`.
- `ConquerGutter` = today's `renderConquerGutter` body + the text-pool build from ~L3670-3697, moved verbatim, reading `host.*` instead of `this.*`. Constants it needs that live in `ArenaScene` (`CONQUER_BAR_TRACK_ALPHA`, `CONQUER_CHIP_FILL_ALPHA`, `ROSTER_DEAD_SWATCH_ALPHA`, `ROSTER_LIVE_TEXT`, `ROSTER_DEAD_TEXT`, `VIEW_WIDTH`, `VIEW_HEIGHT`, `HUD_GUTTER_WIDTH`, ally/enemy css): Conquer-only ones move into `modes/conquer/layout.ts`; shared ones are exported from wherever they are defined (if defined inside `ArenaScene.ts`, move them to an existing common HUD constants module, e.g. `scenes/roster-panel.ts`, and import from there in both).

- [ ] **Step 1: Failing test** — `modes/conquer/gutter.test.ts` with a fake `GutterHost` whose `addText` returns stub objects recording `setText/setPosition/setVisible/setColor` calls and whose `gfx` records `fillRect` calls (no Phaser runtime: type the stubs as `unknown as Phaser.GameObjects.Text`). Build a minimal `room` stub (`{ state: { players: Map, tick, matchEndsTick, overtime, controlTicksA, controlTicksB, zoneHolder, zoneStreakTicks, zoneContested } }`) under `withMode(modeConfigOf(GameMode.CONQUER), …)`. Assert: `render` returns `conquerGutterLayout(...).slotTopInset`; the ally percent text reads `controlPercentText(controlTicksA, target)` for a team-0 viewer and B's for a team-1 viewer; kill texts are hidden; `objects()` returns every text it created; `destroy()` destroys them.
  If `ArenaScene`'s existing tests construct no Phaser at all and Phaser import at module scope crashes vitest, keep `gutter.ts` free of runtime Phaser imports (`import type` only), as `conquer-hud.ts` already is.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement and migrate ArenaScene.
- [ ] **Step 4: Verify:** `cd packages/client && npx tsc --noEmit -p . && npx vitest run`; `npm run build` (vite bundle builds). `grep -n "conquer\|Conquer\|winRuleOf" packages/client/src/scenes/ArenaScene.ts` → only arena-feature comments (zone ring/view rotation, GM24).
  Manual smoke (report the result, do not skip): `npm run dev` is not available headless — instead run the client unit suite plus `npm run build`; state in the report that the Conquer gutter needs an in-browser look.
- [ ] **Step 5: Commit** `refactor(client): Conquer gutter is a ModeGutter in modes/conquer (GM22–GM24)`

### Task 9: Delete `winRuleOf`; enforce no mode branching; contract tests

**Files:**
- Delete: `packages/shared/src/flow/modes.ts` (+ `flow/modes.test.ts` if anything is left), its `index.ts` export
- Migrate remaining `winRuleOf` callers (grep; expected leftovers: `packages/server/balance/*`, `packages/server/playtest/*`, `scripts/*`, `client/src/scenes/roster-panel.ts` comment). For report/label uses (balance report prints the win rule), add `readonly winRuleLabel: "last_standing" | "deathmatch" | "conquer"` to `ModeRules` ONLY if a non-test caller still needs the string; otherwise delete the use.
- Create: `packages/shared/src/modes/no-mode-branching.test.ts`
- Create: `packages/shared/src/modes/contract.test.ts`, `packages/server/src/modes/contract.test.ts`, `packages/client/src/modes/contract.test.ts`

**Interfaces:**
- `no-mode-branching.test.ts` walks `packages/{shared,server,client}/src/**/*.ts` (reuse the file-walking helper pattern from `no-raw-config-in-sim.test.ts` — read it; import its helper if exported, otherwise copy the ~10-line walker), skipping `*.test.ts`, any path containing `/modes/`, and this allow-list (each with its reason as a comment):
  - `shared/src/constants.ts` — defines the enum
  - `shared/src/modes/registry.ts` — is under `/modes/` anyway
  - `server/src/config/mode-bot.ts` — `Record<GameMode, BotModeConfig>` registry
  - `server/src/rooms/PracticeRoom.ts` — practice pins `FFA_DEATHMATCH` (room kind, GM21)
  - `client/src/scenes/PracticeSetupScene.ts` — installs practice's pinned mode
  Fails on regex `/\bGameMode\.[A-Z_]+\b/`, `/\bwinRuleOf\b/`, `/["'](conquer|deathmatch|last_standing)["']/` in code with comments stripped (reuse the comment stripper from `practice-room.test.ts`/`no-raw-config-in-sim.test.ts` if one exists). Message: `` `${file}:${line} branches on a specific game mode — move it into that mode's module (GM2)` ``.
- Contract tests (`describe.each(allModes)` where `allModes = Object.keys(MODE_TABLE).map(Number)`):
  - shared: `rulesOf(m)` is `MODE_RULES[m]`; `hasMatchClock === respawns` for every shipped mode (true today; document as an observed contract, not a law — if a future mode breaks it, the test's comment says to split the assertion); `canStart` refuses zero ready players with `ok:false`; `claimsChassis` returns a boolean; the mode's bundle `arenas` are non-empty.
  - server: every controller's `afterTick` returns `undefined` for a fresh match with every roster car alive and the clock not expired (fixture: 2 cars on opposite teams, `matchEndsTick = tick + 1000`, zone empty); `onMatchStart` sets `matchEndsTick` to 0 iff `!rulesOf(m).hasMatchClock`.
  - client: `hudOf(m).lobbyCard()` has non-empty `kicker`, `body`, `meta`; `clockLabel` returns a string; `showsKills` is boolean.

- [ ] **Step 1:** Write `no-mode-branching.test.ts` and the three contract tests; run → the branching test FAILS listing remaining sites (that list is the work).
- [ ] **Step 2:** Migrate every listed site; delete `flow/modes.ts`.
- [ ] **Step 3: Verify:** `npm run build && npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → only G12. `grep -rn "winRuleOf" packages scripts --include=*.ts --include=*.mjs | grep -v node_modules | grep -v /dist/` → none.
- [ ] **Step 4: Commit** `refactor: delete winRuleOf; test that common code never branches on a mode; contract tests (GM2, GM26, GM28)`

---

## Part C — tests, playtests, rules

### Task 10: Scoped test commands and `scripts/test-scope.mjs`

**Files:**
- Create: `scripts/test-scope.mjs`, `scripts/test-scope.test.mjs`
- Modify: root `package.json` (scripts `test:common`, `test:mode`, `test:affected`), `packages/{shared,server,client}/package.json` (`test:common`, `test:mode`)

**Interfaces:**
- `scripts/test-scope.mjs` exports:
  ```js
  /** @returns {{ scope: "none" } | { scope: "mode", modes: string[], commonProbes: boolean } | { scope: "full" }} */
  export function scopeOf(changedPaths) { … }
  export const MODE_FAMILY = { brawl: "last-standing", "team-brawl": "last-standing", deathmatch: "deathmatch", conquer: "conquer" };
  export function commandsFor(scope) { … } // string[] of shell commands
  ```
  and, when run as main (`node scripts/test-scope.mjs [--run] [--base=<ref>]`), collects `git diff --name-only <base>...HEAD` (default base `origin/development/main`) ∪ `git diff --name-only` ∪ `git diff --name-only --cached` ∪ untracked (`git ls-files --others --exclude-standard`), prints the scope and commands, and with `--run` executes them in order, exiting non-zero on the first failure.
- Rules (GM35), in order:
  1. drop paths under `docs/` except `docs/turn-tuning.md` (a tested doc → full), and `*.md` outside `packages/` and `scripts/`; if nothing remains → `none`.
  2. a path matches mode scope for slug `s` if it matches `^packages/(shared|client)/src/modes/${s}/`, `^packages/shared/src/modes/__snapshots__/${s}\.tables\.json$`, or (via family `f`) `^packages/server/src/modes/${f}/`, `^packages/shared/src/modes/${f}/`, `^packages/client/src/modes/${f}/`, `^packages/server/playtest/modes/${f}/`. A family path expands to every slug in that family.
  3. if EVERY remaining path matched at least one slug → `{scope:"mode", modes:[...sorted unique slugs], commonProbes}` where `commonProbes` is true iff some path is a `modes/<slug>/config.ts` or a snapshot file.
  4. otherwise → `full`.
- `commandsFor`:
  - none → `[]`
  - mode → for each slug: `npm run test:mode -- <slug>`, `npm run playtest -- --mode=<slug> --scope=mode`, and if `commonProbes`: `npm run playtest -- --mode=<slug> --scope=common`
  - full → `npm test`, then for each ACTIVE mode slug (import `activeGameModes`, `modeSlug` from `packages/shared/dist/index.js`, as other scripts do): `npm run playtest -- --mode=<slug> --scope=all`
- package scripts:
  - each package: `"test:common": "vitest run --exclude \"**/modes/*/**\""`, `"test:mode": "vitest run"` (the slug arrives as a path filter: root script passes `src/modes/<slug>/ src/modes/<family>/ src/modes/contract.test.ts`). Verify vitest 2's `--exclude` flag exists (`npx vitest --help | grep exclude`); if not, implement `test:common` via a `vitest.common.config.ts` that sets `test.exclude` to defaults + `**/modes/*/**`.
  - root: `"test:common": "npm run build -w @motor-combat-moba/shared && npm run test:common --workspaces --if-present"`, `"test:mode": "node scripts/test-mode.mjs"` — tiny script: resolves slug + family via `MODE_FAMILY`, runs `vitest run` in each package with the existing path filters (skip a package with no matching folder), after building shared. Put it in `scripts/test-mode.mjs`. `"test:affected": "node scripts/test-scope.mjs --run"`.

- [ ] **Step 1: Failing tests** (`node:test`, like the other `scripts/*.test.mjs`):
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeOf, commandsFor } from "./test-scope.mjs";

test("docs-only is none", () => assert.deepEqual(scopeOf(["docs/roadmap.md", "README.md"]), { scope: "none" }));
test("tested doc is full", () => assert.equal(scopeOf(["docs/turn-tuning.md"]).scope, "full"));
test("one mode's overrides → mode scope with common probes", () =>
  assert.deepEqual(scopeOf(["packages/shared/src/modes/conquer/config.ts", "packages/shared/src/modes/__snapshots__/conquer.tables.json"]),
    { scope: "mode", modes: ["conquer"], commonProbes: true }));
test("client hud only → mode scope without common probes", () =>
  assert.deepEqual(scopeOf(["packages/client/src/modes/deathmatch/hud.ts"]), { scope: "mode", modes: ["deathmatch"], commonProbes: false }));
test("family path expands to its modes", () =>
  assert.deepEqual(scopeOf(["packages/server/src/modes/last-standing/controller.ts"]), { scope: "mode", modes: ["brawl", "team-brawl"], commonProbes: false }));
test("two modes stay mode scope", () =>
  assert.deepEqual(scopeOf(["packages/client/src/modes/brawl/hud.ts", "packages/client/src/modes/conquer/hud.ts"]).modes, ["brawl", "conquer"]));
test("a common path makes it full", () =>
  assert.equal(scopeOf(["packages/client/src/modes/brawl/hud.ts", "packages/shared/src/sim/drive.ts"]).scope, "full"));
test("modes root files are common", () =>
  assert.equal(scopeOf(["packages/shared/src/modes/merge.ts"]).scope, "full"));
test("mode commands", () =>
  assert.deepEqual(commandsFor({ scope: "mode", modes: ["conquer"], commonProbes: false }),
    ["npm run test:mode -- conquer", "npm run playtest -- --mode=conquer --scope=mode"]));
```
- [ ] **Step 2:** `node --test scripts/test-scope.test.mjs` → FAIL.
- [ ] **Step 3:** Implement `test-scope.mjs`, `test-mode.mjs`, the package scripts.
- [ ] **Step 4: Verify:** `node --test scripts/test-scope.test.mjs` PASS; `npm run test:common` passes except G12; `npm run test:mode -- conquer` runs only conquer + contract tests and passes; `node scripts/test-scope.mjs` prints `full` for this branch.
- [ ] **Step 5: Commit** `feat: scoped test commands and test-scope.mjs (GM34, GM35)`

### Task 11: Dedupe + relocate — shared

**Files:** `packages/shared/src/**/*.test.ts`.

- [ ] **Step 1:** Inventory: `grep -c "it(\|it.each\|test(" ` per file; list test names per file (`grep -n "it(\"\|it('" …`). Identify candidates by GM30 (a)–(e). Known candidates at plan time: `config/deathmatch-config.test.ts` and `config/conquer-config.test.ts` (value pins now covered by snapshots — keep clause-named design assertions, drop pure value echoes); `modes/registry.test.ts` vs `modes/registry-arenas.test.ts` vs `modes/invariants.test.ts` (overlapping "every mode has…" checks); `modes/concurrency.test.ts` vs `modes/active.test.ts` vs `modes/accessor-routing.test.ts` (scope/installation overlap); `modes/mode-arg.test.ts` vs `server/playtest/mode.test.ts` (the second is server's — only flag it for Task 12).
- [ ] **Step 2:** For each candidate, read both tests; delete/merge only when the kept test asserts the same behaviour through the same entry point. Move remaining mode-specific cases from common files into `modes/<slug>/`. Keep a list: `file › test name → deleted (reason) | merged into X | moved to Y`.
- [ ] **Step 3: Verify:** `cd packages/shared && npx vitest run` passes; count of tests before/after recorded.
- [ ] **Step 4: Commit** with the list in the body: `test(shared): dedupe and relocate mode-specific tests (GM27, GM30)`

### Task 12: Dedupe + relocate — server (incl. playtest `mode.test.ts`)

Same procedure as Task 11 over `packages/server/src/**/*.test.ts` and `packages/server/playtest/*.test.ts`. Known candidates: `rooms/mode-scope.test.ts` vs `rooms/mode-concurrency.test.ts`; `rooms/practice-room.test.ts` vs `rooms/practice-room-arena.test.ts` vs `rooms/practice-rules.test.ts`; `rooms/match-helpers.test.ts` mode cases (move to `modes/<family>/`); `bot/brain/firing.test.ts` basic-attack cases after Task 4 (merge duplicates). Do NOT touch the two G12 tests.
- [ ] Steps 1–4 as Task 11; commit `test(server): dedupe and relocate mode-specific tests (GM27, GM30)`

### Task 13: Dedupe + relocate — client and scripts

Same procedure over `packages/client/src/**/*.test.ts` and `scripts/*.test.mjs`. Known candidates: `net/mode-scope.test.ts` mode cases; `ui/car-select-view.test.ts` conquer-claims cases (move to `modes/conquer/`); `scenes/spectate.test.ts` per-mode cases (spectate is common — keep one case per `respawns` value, drop per-mode repeats); `ui/reveal-view.test.ts` team cases.
- [ ] Steps 1–4 as Task 11; commit `test(client): dedupe and relocate mode-specific tests (GM27, GM30)`

### Task 14: Playtest restructure — `common/` and `--scope`

**Files:**
- Move: `git mv packages/server/playtest/{collision,ram,geometry,weapons,weapons2,prediction,world,reporter,mode}.ts packages/server/playtest/common/` and `mode.test.ts` likewise; fix relative imports (`lan.ts`, `run-all.ts` stay at `playtest/` root; `lan.ts` imports from `./common/…`).
- Modify: `packages/server/playtest/run-all.ts` — probe paths under `common/`; parse `--scope=common|mode|all` (default `all`; unknown → exit 2 naming the valid values); `mode` scope runs every `.ts` in `playtest/modes/<family>/` (family from `rulesOf`-independent map: import `MODE_FAMILY` equivalent — define `FAMILY_OF: Record<GameMode, string>` in `playtest/common/mode.ts` with `satisfies Record<GameMode, string>`); pass `PLAYTEST_RUN_DIR` and the mode env as today.
- Modify: `packages/server/package.json` playtest script path if it points at `playtest/run-all.ts` (unchanged) and `tsconfig` include globs for `playtest/**` if needed.
- Modify: `packages/server/playtest/README.md` (layout, `--scope`).

- [ ] **Step 1:** Add to `common/mode.test.ts`: `FAMILY_OF` has every GameMode; brawl and team map to `last-standing`. Add a `run-all` arg-parse unit: extract `parseScope(argv): "common" | "mode" | "all"` into `common/mode.ts` and test it (`--scope=bogus` throws naming valid values).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement moves + flag. 
- [ ] **Step 4: Verify:** `npx tsc --noEmit -p packages/server` clean; `npm run playtest -- --mode=brawl --scope=common` completes and writes a report with the six probes (it takes minutes — run in background if needed; confirm all six exit 0); `--scope=mode` with an empty modes folder prints "no mode probes for <family>" and exits 0.
- [ ] **Step 5: Commit** `refactor(playtest): common/ probes and --scope flag (GM31, GM33)`

### Task 15: Mode probes

**Files:**
- Create: `packages/server/playtest/modes/last-standing/elimination.ts`, `packages/server/playtest/modes/deathmatch/respawn.ts`, `packages/server/playtest/modes/conquer/zone.ts`

**Interfaces:**
- Consumes: `common/world.ts` (read it — it builds a headless room/tick harness the common probes use), `common/reporter.ts` (report + verdict API), `controllerOf`, `rulesOf`, `withMode`, `modeConfigOf`, `derived`.
- Each probe: installs the resolved mode bundle (from the mode env, as common probes do; the probe for family `f` refuses to run under a mode outside `f`, printing why and exiting 0), builds a room state via `world.ts`, drives the real `runPipeline` + the mode's `ModeController` tick by tick (the same order `ArenaRoom.tick` uses: respawn sweep if `rules.respawns`, `runPipeline`, `afterTick`), and records rows with verdicts `OK`/`FINDING`/`KNOWN-BY-DESIGN`. Never throws on a surprise — a scenario's failure is a `FINDING` row with the measured numbers.
- Scenarios (each a table row: scenario, expected, measured, verdict):
  - elimination (brawl): kill all but one car by setting hp to 0 through `sim/damage.ts`'s writer (find the function `applyDamage`/damage helper used by combat) → match ends within 1 tick with that winner; two last cars die same tick → draw; a leaver (`afterLeave` with the roster reduced) → remaining car wins. (team): wipe team 1 → `winnerTeam 0`; friendly fire: a team-0 projectile overlapping a team-0 car deals 0 damage — spawn via the weapons harness the common `weapons.ts` probe uses, sweeping the sub-tick phase (5 offsets) as the probe rules require.
  - respawn (deathmatch): kill a car at tick T → `alive` false until `T + derived().deathmatchTicks.respawnDelay` (read the exact ticks field names from `deathmatch-config.ts`), respawns within ±1 tick; after respawn it is `phased` for ≥ `phase` ticks — during that window a ram at max speed produces no contact (`isSolid` false) and a projectile passes through; the match ends at `matchEndsTick` exactly; ranking kills-then-deaths (A 3/1, B 3/0 → B wins).
  - zone (conquer): one team-0 car parked in the zone: `zoneHolder` becomes 0 after exactly `captureDelay` ticks; control accrues 1/tick after; a team-1 car entering sets `zoneContested` and freezes both bars; team 0 alone reaching `controlTarget` ends the match before the clock; at `matchEndsTick` the higher bar wins; equal bars → overtime (`state.overtime` true); every team-1 car leaving → `afterLeave` gives team 0 the win.
- Reports go to the run dir the runner provides (same `reporter.ts` API as the common probes), one markdown file per probe with its verdict table so `run-all`'s summary picks it up.

- [ ] **Step 1:** Implement `elimination.ts`; run `npm run playtest -- --mode=brawl --scope=mode` and `--mode=team-brawl --scope=mode`; every row should read `OK` on current code. A `FINDING` means either a real bug (report it to the controller with numbers — do NOT change game code) or a probe bug (fix the probe).
- [ ] **Step 2:** Implement `respawn.ts`; run with `--mode=deathmatch --scope=mode`.
- [ ] **Step 3:** Implement `zone.ts`; run with `--mode=conquer --scope=mode`.
- [ ] **Step 4: Verify:** `npx tsc --noEmit -p packages/server` clean; paste each probe's verdict table into the task report.
- [ ] **Step 5: Commit** `feat(playtest): mode probes — elimination, respawn, zone (GM32)`

### Task 16: Docs and skills

**Files:**
- Create: `docs/testing.md`
- Modify: `CLAUDE.md` (per-mode config section rewrite; basic-attack paragraph; new "Which tests to run" section; Read-the-right-doc table row for `docs/testing.md` and the new spec), `packages/shared/CLAUDE.md` (references to mode folders), `.claude/skills/game-mode/SKILL.md`, `.claude/skills/basic-attack-toggle/SKILL.md`, `docs/config-reference.md`, `docs/project-structure.md`, `packages/server/playtest/README.md` (if not done in Task 14).

Content requirements:
- `docs/testing.md`: (1) layout — common vs `modes/<slug>/` vs family folders vs contract tests, with the folder list per package; (2) the scoping rule exactly as GM35 with a table of example diffs → scope → commands; (3) commands: `npm test`, `test:common`, `test:mode -- <slug>`, `test:affected`, `playtest -- --mode --scope`; (4) what contract tests guarantee; (5) how to add a mode's tests and probes; (6) snapshots — what a moved snapshot means and when `-u` is right; (7) the pre-existing G12 failures.
- `CLAUDE.md` config section: base = `config/` globals (common defaults); one-mode change = that mode's `config.ts` overrides (`replace()` for whole rows); snapshots show blast radius; delete all table-pinning text and the "edit all four copies" instructions; basic attack = `slots.basicAttackEnabled` per mode (shipped `false` in every mode). New section "Which tests to run" (≤ 12 lines) summarising GM35 and pointing at `docs/testing.md`, `node scripts/test-scope.mjs`.
- `game-mode` skill: checklist = enum value → `modes/<slug>/config.ts`+`index.ts` → `rules.ts` → server controller (reuse a family or add one) → client `hud.ts` → registries (compile fails until done) → snapshot (`vitest -u` on the new file only) → tests in the mode folders → probe folder → lobby/guide/turn-tuning as before.
- `basic-attack-toggle` skill: per-mode flip via `slots: { basicAttackEnabled: true }` in that mode's `config.ts`; the snapshot moves for that mode only; rebuild manual.

- [ ] **Step 1:** Write/modify docs. **Step 2:** `npm test` (manual-page, turn-tuning, manual-facts tests read docs/copy) → only G12. **Step 3:** Commit `docs: testing rules, base+overrides config, mode-layer skills (GM36–GM39)`

### Task 17: Final verification

- [ ] `npm run build` clean.
- [ ] `npm test` → only the two G12 failures; record totals.
- [ ] `git diff 8d1e45d -- packages/shared/src/modes/__snapshots__` → only additions from Task 1 (no snapshot content changed since Task 1's commit): `git log --oneline -- packages/shared/src/modes/__snapshots__` shows a single commit.
- [ ] `npm run build:manual` → no diff in `packages/client/public/manual.html` beyond what Task 4 committed.
- [ ] `npm run playtest -- --mode=<slug> --scope=all` for each active mode (brawl, deathmatch, conquer) and `--scope=mode` for team-brawl; collect summary tables; no probe exits non-zero.
- [ ] `node scripts/test-scope.mjs` prints `full` and the right commands.
- [ ] Report: totals, deleted/merged test counts, probe verdict tables, any FINDINGs.
