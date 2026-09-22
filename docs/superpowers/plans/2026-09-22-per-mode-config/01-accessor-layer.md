# Phase 1 — Accessor layer, one bundle

**Goal:** Every config read in `sim/` goes through the bundle, and the bundle holds today's values.
A pure refactor: zero behaviour change, `golden.test.ts` byte-identical, whole suite green.

**Why this phase exists alone:** it is the only phase that touches all 12 sim files. Landing it with
one bundle means a reviewer can check "did anything move?" by running the suite, with no new data to
reason about.

Read [`interfaces.md`](interfaces.md) before starting. Commands: build with `npm run build` from the
repo root; shared's suite is `npm test -w @motor-combat-moba/shared` (vitest).

---

### Task 1: The bundle types and builder

**Files:**
- Create: `packages/shared/src/modes/types.ts`
- Create: `packages/shared/src/modes/build.ts`
- Test: `packages/shared/src/modes/build.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ModeTables`, `ModeDerived`, `ModeConfig` (exact shapes in `interfaces.md`);
  `assembleModeConfig(id: GameMode, tables: ModeTables): ModeConfig`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/modes/build.test.ts
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { assembleModeConfig } from "./build.js";
import { LEGACY_TABLES } from "./legacy.js";

describe("assembleModeConfig", () => {
  it("derives the five artifacts the sim reads", () => {
    const config = assembleModeConfig(GameMode.FFA_LAST_STANDING, LEGACY_TABLES);
    expect(Object.keys(config.derived.weaponTicks)).toEqual(Object.keys(LEGACY_TABLES.weapons));
    expect(Object.keys(config.derived.chassisDrive)).toEqual(Object.keys(LEGACY_TABLES.cars));
    expect(config.derived.ramTicks).toBeDefined();
    expect(config.derived.turretTicks).toBeDefined();
  });

  it("deep-freezes the bundle, so nothing can mutate a live mode", () => {
    const config = assembleModeConfig(GameMode.FFA_LAST_STANDING, LEGACY_TABLES);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.drive)).toBe(true);
    expect(Object.isFrozen(config.weapons.predator)).toBe(true);
    expect(Object.isFrozen(config.derived.weaponTicks)).toBe(true);
  });

  it("gives two bundles built from the same tables independent objects", () => {
    const a = assembleModeConfig(GameMode.FFA_LAST_STANDING, LEGACY_TABLES);
    const b = assembleModeConfig(GameMode.FFA_DEATHMATCH, LEGACY_TABLES);
    expect(a.weapons.predator).not.toBe(b.weapons.predator);
    expect(a.weapons.predator).toEqual(b.weapons.predator);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- build.test`
Expected: FAIL — `Cannot find module './build.js'`.

- [ ] **Step 3: Write `types.ts`**

Copy the three interfaces verbatim from [`interfaces.md`](interfaces.md). Import every referenced
type from `../config/*.js` — **define no new type aliases here**; this file is a composition of
existing types only (MC4).

- [ ] **Step 4: Write `legacy.ts`, the single bundle of today's values**

```ts
// packages/shared/src/modes/legacy.ts
// SCAFFOLDING. Phase 2 replaces this with brawl/ and deathmatch/ folders and deletes this file.
// It exists so phase 1 is a pure refactor: one bundle, today's numbers, nothing to compare.
import { CAR_TABLE } from "../config/car-config.js";
import { WEAPON_TABLE } from "../config/weapon-config.js";
// ...one import per table in ModeTables
import type { ModeTables } from "./types.js";

export const LEGACY_TABLES: ModeTables = {
  cars: CAR_TABLE, weapons: WEAPON_TABLE, drive: DRIVE_CONFIG, ram: RAM_CONFIG,
  impulse: IMPULSE_CONFIG, combat: COMBAT_CONFIG, turret: TURRET_CONFIG,
  statusConfig: STATUS_CONFIG, statusTable: STATUS_TABLE, statusLimits: STATUS_LIMITS,
  spike: SPIKE_CONFIG, slots: WEAPON_SLOT_CONFIG, flow: FLOW_CONFIG,
  deathmatch: DEATHMATCH_CONFIG, camera: CAMERA_CONFIG,
  arenas: ["arena-01", "arena-02"], maxPlayers: MAX_PLAYERS,
};
```

- [ ] **Step 5: Write `build.ts`**

`assembleModeConfig` must (a) `structuredClone` the incoming tables so two bundles never share a
sub-object, (b) compute each `ModeDerived` field from the cloned tables. Four resolvers already exist by name —
`resolveTicks` (`weapon-ticks.ts`), `resolveChassisDrive` (`car-config.ts`), `buildBurstDefs`
(`weapon-config.ts`), `resolveRamTicks` (`ram-config.ts`). **Check the others before assuming a
name:** `turret-config.ts`, `spike-config.ts`, `deathmatch-config.ts` and `status-ticks.ts` compute
`TURRET_TICKS`, `SPIKE_TICKS`, `DEATHMATCH_TICKS` and the status pulse ticks inline at module load.
Extract each into a named `resolveX(tables)` function first, leaving the module-load call site
working, then call it here. Every resolver must be **parameterised on the passed tables rather than
reading module globals**, or two bundles silently share one derivation. Then (c) deep-freeze the result with the same recursive freeze
`tuning.ts` already uses.

Each resolver currently closes over its module's global table. Change each to take its inputs as
parameters and keep a zero-argument wrapper for the existing module-load call. Example, in
`weapon-ticks.ts`:

```ts
export function resolveTicks(
  table: Readonly<Record<WeaponId, WeaponDef>> = WEAPON_TABLE,
  status: StatusConfig = STATUS_CONFIG,
): Readonly<Record<WeaponId, WeaponTicks>> { /* body unchanged, reading the params */ }
```

- [ ] **Step 6: Run the test**

Run: `npm test -w @motor-combat-moba/shared -- build.test`
Expected: PASS, 3 tests.

- [ ] **Step 7: Full suite, then commit**

```bash
npm run build && npm test
git add packages/shared/src/modes packages/shared/src/config
git commit -m "feat(shared): ModeConfig bundle type and builder (MC1, MC7)"
```

---

### Task 2: The scope and the accessors

**Files:**
- Create: `packages/shared/src/modes/active.ts`
- Test: `packages/shared/src/modes/active.test.ts`

**Interfaces:**
- Consumes: `ModeConfig`, `assembleModeConfig`, `LEGACY_TABLES`.
- Produces: `withMode`, `cfg`, `hasMode`, `installMode`, and the 16 named accessors listed in
  `interfaces.md`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/modes/active.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { assembleModeConfig } from "./build.js";
import { LEGACY_TABLES } from "./legacy.js";
import { cfg, drive, hasMode, installMode, withMode } from "./active.js";

const A = assembleModeConfig(GameMode.FFA_LAST_STANDING, LEGACY_TABLES);
const B = assembleModeConfig(GameMode.FFA_DEATHMATCH, {
  ...LEGACY_TABLES,
  drive: { ...LEGACY_TABLES.drive, baseMaxSpeed: 999 },
});

afterEach(() => installMode(A));

describe("withMode", () => {
  it("serves the installed bundle", () => {
    withMode(B, () => expect(drive().baseMaxSpeed).toBe(999));
  });

  it("restores the previous bundle after the scope, including on throw", () => {
    installMode(A);
    const before = drive().baseMaxSpeed;
    expect(() => withMode(B, () => { throw new Error("boom"); })).toThrow("boom");
    expect(drive().baseMaxSpeed).toBe(before);
  });

  it("nests, so an inner scope cannot strand the outer one", () => {
    withMode(A, () => {
      withMode(B, () => expect(cfg().id).toBe(GameMode.FFA_DEATHMATCH));
      expect(cfg().id).toBe(GameMode.FFA_LAST_STANDING);
    });
  });

  it("returns the callback's value", () => {
    expect(withMode(B, () => 42)).toBe(42);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- active.test`
Expected: FAIL — `Cannot find module './active.js'`.

- [ ] **Step 3: Implement `active.ts`**

```ts
let current: ModeConfig | null = null;

export function withMode<T>(config: ModeConfig, fn: () => T): T {
  const prev = current;
  current = config;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/** Boot-time install, no restore. Scaffolding — see interfaces.md. */
export function installMode(config: ModeConfig): void {
  current = config;
}

export function hasMode(): boolean {
  return current !== null;
}

export function cfg(): ModeConfig {
  if (current === null) {
    throw new Error(
      "config read outside a mode scope — wrap the entry point in withMode(config, ...)",
    );
  }
  return current;
}

export function drive(): DriveConfig { return cfg().drive; }
// ...one line per accessor in interfaces.md
```

- [ ] **Step 4: Run the test**

Run: `npm test -w @motor-combat-moba/shared -- active.test`
Expected: PASS, 4 tests.

- [ ] **Step 5: Install the legacy bundle at module load (scaffolding)**

In `packages/shared/src/modes/registry.ts`, after building the bundle, call `installMode(...)` once.
Add the comment `// SCAFFOLDING (phase 1-2): removed in phase 3, when cfg() starts throwing.`

- [ ] **Step 6: Commit**

```bash
npm run build && npm test
git add packages/shared/src/modes
git commit -m "feat(shared): withMode scope and bundle accessors (MC9-MC13)"
```

---

### Task 3: Rewrite the existing accessor bodies

**Files:**
- Modify: `packages/shared/src/config/car-config.ts`, `weapon-config.ts`, `weapon-ticks.ts`,
  `status-config.ts`, `ram-config.ts`, `turret-config.ts`, `weapon-slots.ts`, `spike-config.ts`,
  `deathmatch-config.ts`
- Test: the existing suites for each — they must pass unchanged.

**Interfaces:**
- Consumes: the accessors from Task 2.
- Produces: `driveOf`, `weaponDefOf`, `weaponTicksOf`, `hpOf`, `statusDefOf`, `slotsOf`,
  `basicAttackOf`, `ramAttackOf`, `ramDefenceOf`, `turretMountOf`, `instanceDefOf`, `fireSlotsOf`,
  `activeCarIds`, `armedCarIds`, `basicAttackIds`, `isCarId`, `isWeaponId`, `isStatusId`,
  `statusPulseTicksOf`, `explosionDamageModeOf`, `inertiaRadiusSquared`, `ramTicks` — **signatures
  unchanged** (MC14).

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/modes/accessor-routing.test.ts
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { driveOf, hpOf } from "../config/car-config.js";
import { weaponDefOf } from "../config/weapon-config.js";
import { assembleModeConfig } from "./build.js";
import { LEGACY_TABLES } from "./legacy.js";
import { withMode } from "./active.js";

describe("existing accessors read the active bundle", () => {
  it("driveOf reflects the scoped mode, not a module global", () => {
    const fast = assembleModeConfig(GameMode.FFA_DEATHMATCH, {
      ...LEGACY_TABLES,
      drive: { ...LEGACY_TABLES.drive, baseMaxSpeed: 999, speedPerRating: 0 },
    });
    withMode(fast, () => expect(driveOf("mirage").maxSpeed).toBe(999));
  });

  it("weaponDefOf reflects the scoped mode", () => {
    const buffed = assembleModeConfig(GameMode.FFA_DEATHMATCH, {
      ...LEGACY_TABLES,
      weapons: { ...LEGACY_TABLES.weapons,
        predator: { ...LEGACY_TABLES.weapons.predator, damage: 777 } },
    });
    withMode(buffed, () => expect(weaponDefOf("predator").damage).toBe(777));
  });

  it("hpOf reflects the scoped mode", () => {
    const tanky = assembleModeConfig(GameMode.FFA_DEATHMATCH, {
      ...LEGACY_TABLES,
      combat: { ...LEGACY_TABLES.combat, baseHp: 1234, hpPerRating: 0 },
    });
    withMode(tanky, () => expect(hpOf("bastion")).toBe(1234));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- accessor-routing`
Expected: FAIL — each accessor still returns the shipped value, not the scoped one.

- [ ] **Step 3: Rewrite each accessor body**

One mechanical substitution per function. `driveOf` becomes `return derived().chassisDrive[id];`,
`weaponDefOf` becomes `return weapons()[id];`, `hpOf` reads `combat()`, `statusDefOf` reads
`statusTable()`, `weaponTicksOf` reads `derived().weaponTicks`, `ramTicks()` reads
`derived().ramTicks`, `instanceDefOf` reads `derived().burstDefs`, `activeCarIds` filters `cars()`.

**Delete** the mutable module-level singletons these replace: `ACTIVE_DRIVE`, `ACTIVE_TICKS`,
`ACTIVE_BURST_DEFS`, `ACTIVE_RAM_TICKS`, and `TURRET_TICKS`'s mutable holder — with their
`rebuildResolvedDrive` / `rebuildWeaponTicks` / `rebuildRamTicks` / `rebuildBurstDefs` /
`rebuildTurretTicks` functions. `setTuning` calls all five; leave `setTuning` compiling by making
those calls no-ops with a `// phase 5 deletes this` comment. Phase 5 removes it properly.

- [ ] **Step 4: Run the test and the whole suite**

Run: `npm run build && npm test`
Expected: PASS. **If `golden.test.ts` fails, stop** — the refactor changed behaviour and the fixture
is right.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "refactor(shared): accessors read the mode bundle (MC14)"
```

---

### Task 4: Convert the 21 `RAM_CONFIG` and `DRIVE_CONFIG` reads in the physics files

**Files:**
- Modify: `packages/shared/src/sim/ram.ts` (17 `RAM_CONFIG`, 4 `DRIVE_CONFIG`),
  `sim/drive.ts` (5 `DRIVE_CONFIG`, 2 `RAM_CONFIG`), `sim/impulse.ts` (4 `RAM_CONFIG`,
  3 `IMPULSE_CONFIG`), `sim/contact.ts` (2 `RAM_CONFIG`, 1 `IMPULSE_CONFIG`, 1 `SPIKE_CONFIG`)
- Test: existing `sim/*.test.ts` must pass unchanged; `golden.test.ts` byte-identical.

**Interfaces:**
- Consumes: `drive()`, `ram()`, `impulse()`, `spike()` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Replace the imports**

In each file, delete `import { RAM_CONFIG } from "../config/ram-config.js";` and add
`import { ram } from "../modes/active.js";` (same shape for `drive`, `impulse`, `spike`).

- [ ] **Step 2: Rewrite each dereference**

`RAM_CONFIG.minRamSpeed` → `ram().minRamSpeed`. `DRIVE_CONFIG.restitution` → `drive().restitution`.
Purely mechanical; the compiler finds every one.

**Where a function reads the same config three or more times, hoist once at the top** —
`const r = ram();` — rather than calling the accessor per field. It reads better and costs one
property read instead of several.

- [ ] **Step 3: Build and run the suite**

Run: `npm run build && npm test`
Expected: PASS, `golden.test.ts` unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/sim
git commit -m "refactor(sim): physics files read config through the bundle"
```

---

### Task 5: Convert the remaining 8 sim files

**Files:**
- Modify: `sim/weapons/turret.ts` (5 `TURRET_CONFIG`, 3 `WEAPON_SLOT_CONFIG`, 2
  `BASIC_ATTACK_CONFIG`, 1 `TURRET_TICKS`), `sim/weapons/fire.ts` (2 `WEAPON_SLOT_CONFIG`, 1
  `TURRET_CONFIG`, 1 `BASIC_ATTACK_CONFIG`), `sim/weapons/instances.ts` (2 `TURRET_CONFIG`, 1
  `DRIVE_CONFIG`), `sim/collide.ts` (2 `DRIVE_CONFIG`, 1 `COMBAT_CONFIG`), `sim/combat.ts`
  (1 `STATUS_TABLE`, 1 `SPIKE_CONFIG`), `sim/status/statuses.ts` (2 `STATUS_CONFIG`),
  `sim/damage.ts` (1 `COMBAT_CONFIG`), `sim/context.ts` (1 `DRIVE_CONFIG`)
- Test: existing suites unchanged.

**Interfaces:**
- Consumes: `turret()`, `slots()`, `combat()`, `statusTable()`, `statusConfig()`, `spike()`,
  `drive()`, `derived()`.
- Produces: nothing new.

- [ ] **Step 1: Apply the same two substitutions as Task 4, per file**

`TURRET_TICKS` becomes `derived().turretTicks`. `BASIC_ATTACK_CONFIG.enabled` becomes
`slots().basicAttackEnabled` — **note the rename**: the flag moves into the per-mode slot config
rather than keeping a config object of its own, since it is one boolean (MC27).

- [ ] **Step 2: Assert no raw table reads survive in `sim/`**

```bash
grep -rnE "\b(WEAPON_TABLE|CAR_TABLE|DRIVE_CONFIG|RAM_CONFIG|COMBAT_CONFIG|IMPULSE_CONFIG|STATUS_TABLE|STATUS_CONFIG|SPIKE_CONFIG|TURRET_CONFIG|TURRET_TICKS|WEAPON_SLOT_CONFIG|BASIC_ATTACK_CONFIG)\." \
  packages/shared/src/sim --include=*.ts | grep -v '\.test\.'
```

Expected: **no output**.

- [ ] **Step 3: Add that grep as a test**

```ts
// packages/shared/src/modes/no-raw-config-in-sim.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BANNED = /\b(WEAPON_TABLE|CAR_TABLE|DRIVE_CONFIG|RAM_CONFIG|COMBAT_CONFIG|IMPULSE_CONFIG|STATUS_TABLE|STATUS_CONFIG|SPIKE_CONFIG|TURRET_CONFIG|TURRET_TICKS|WEAPON_SLOT_CONFIG|BASIC_ATTACK_CONFIG)\./;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name))
    : e.name.endsWith(".ts") && !e.name.includes(".test.") ? [join(dir, e.name)] : []);
}

describe("sim reads config only through the bundle (MC13)", () => {
  it("has no raw config table dereference", () => {
    const offenders = walk("src/sim")
      .filter((f) => BANNED.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 4: Build, run the suite, commit**

```bash
npm run build && npm test
git add packages/shared/src
git commit -m "refactor(sim): every config read goes through the bundle (MC13, MC14)"
```

---

### Task 6: Update the phase state file

- [ ] **Step 1: Mark phase 1 done in `EXECUTION.md`**

Set phase 1's state to `done`, set **In flight** to `none` and **Next** to `Phase 2, Task 1`. Record
anything found-but-not-fixed under **Deferred findings**, naming the phase that should own it.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-09-22-per-mode-config/EXECUTION.md
git commit -m "docs: phase 1 complete"
```
