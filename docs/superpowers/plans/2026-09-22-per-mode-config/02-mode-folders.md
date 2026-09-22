# Phase 2 — Two mode folders

**Goal:** `brawl/` and `deathmatch/` exist as full literal copies (MC3), the registry carries their
bundles, and a test proves both are deep-equal to the pre-change tables (G4). `legacy.ts` is gone.

**Precondition:** phase 1 complete, suite green.

---

### Task 1: Generate the two mode folders

**Files:**
- Create: `packages/shared/src/modes/brawl/{cars,weapons,drive,ram,impulse,combat,turret,status,spike,slots,flow,deathmatch,index}.ts`
- Create: `packages/shared/src/modes/deathmatch/` — the same thirteen
- Create then DELETE: `scripts/seed-mode-folders.mjs`

**Interfaces:**
- Consumes: `ModeTables` from phase 1.
- Produces: `export const BRAWL_TABLES: ModeTables` and `DEATHMATCH_TABLES: ModeTables`.

- [ ] **Step 1: Write the one-shot generator**

`scripts/seed-mode-folders.mjs` imports each table from built shared, serialises it as a TypeScript
literal with `JSON.stringify(value, null, 2)` post-processed to unquote keys that are valid
identifiers, and writes one file per table into each folder with an `as const satisfies` clause.
Hand-copying 15KB twice is how a typo reaches a live room; generate it.

- [ ] **Step 2: Run it, then delete it**

```bash
node scripts/seed-mode-folders.mjs && rm scripts/seed-mode-folders.mjs
```

The folders are now source, maintained by hand from here on. The script is deliberately not kept:
keeping it invites someone to regenerate and silently discard a mode's authored divergence.

- [ ] **Step 3: Write each `index.ts`**

```ts
// packages/shared/src/modes/brawl/index.ts
import type { ModeTables } from "../types.js";
import { BRAWL_CARS } from "./cars.js";
// ...one import per table
export const BRAWL_TABLES: ModeTables = {
  cars: BRAWL_CARS, weapons: BRAWL_WEAPONS, drive: BRAWL_DRIVE, ram: BRAWL_RAM,
  impulse: BRAWL_IMPULSE, combat: BRAWL_COMBAT, turret: BRAWL_TURRET,
  statusConfig: BRAWL_STATUS_CONFIG, statusTable: BRAWL_STATUS_TABLE,
  statusLimits: BRAWL_STATUS_LIMITS, spike: BRAWL_SPIKE, slots: BRAWL_SLOTS,
  flow: BRAWL_FLOW, deathmatch: BRAWL_DEATHMATCH, camera: BRAWL_CAMERA,
  arenas: ["arena-01", "arena-02"], maxPlayers: 6,
};
```

- [ ] **Step 4: Typecheck, commit**

```bash
npm run build
git add packages/shared/src/modes
git commit -m "feat(shared): brawl and deathmatch mode folders (MC2, MC3)"
```

---

### Task 2: The registry

**Files:**
- Create: `packages/shared/src/modes/registry.ts`
- Delete: `packages/shared/src/config/mode-config.ts` (its contents move here)
- Modify: `packages/shared/src/index.ts` — re-export from the new path
- Test: `packages/shared/src/modes/registry.test.ts`

**Interfaces:**
- Produces: `MODE_TABLE`, `modeConfigOf`, `activeArenaIds`, and the moved `isGameMode`,
  `isActiveGameMode`, `activeGameModes`, `DEFAULT_GAME_MODE` (signatures unchanged).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { MODE_TABLE, activeGameModes, modeConfigOf } from "./registry.js";

describe("MODE_TABLE", () => {
  it("carries a bundle for every mode", () => {
    for (const def of Object.values(MODE_TABLE)) {
      expect(def.config.id).toBe(def.id);
    }
  });

  it("hides an inactive mode from the picker but keeps its bundle reachable", () => {
    expect(activeGameModes()).not.toContain(GameMode.TEAM);
    expect(modeConfigOf(GameMode.TEAM)).toBeDefined();
  });

  it("gives each mode its own bundle object", () => {
    expect(modeConfigOf(GameMode.FFA_LAST_STANDING))
      .not.toBe(modeConfigOf(GameMode.FFA_DEATHMATCH));
  });
});
```

- [ ] **Step 2: Run it — FAIL, module missing**

- [ ] **Step 3: Implement `registry.ts`**

Move `MODE_TABLE`, `DEFAULT_GAME_MODE`, `MODE_ORDER`, `isGameMode`, `isActiveGameMode` and
`activeGameModes` over verbatim, then add `config: assembleModeConfig(id, TABLES)` to each row.
`GameMode.TEAM` is unpublished and has no folder of its own — point it at `BRAWL_TABLES`, with a
comment saying so, since the balance harness still drives it.

- [ ] **Step 4: Run test, full suite, commit**

```bash
npm run build && npm test
git commit -am "feat(shared): mode registry carries each mode's bundle (MC18, MC19)"
```

---

### Task 3: Prove day one is a no-op (G4)

**Files:**
- Test: `packages/shared/src/modes/parity.test.ts`
- Create: `packages/shared/src/modes/__fixtures__/shipped-tables.json` (snapshot of the
  pre-change tables, generated once from `git show HEAD~N`)

- [ ] **Step 1: Capture the shipped tables as a fixture**

From the commit before phase 1, dump each table to JSON and commit it as the fixture. This is the
only trustworthy witness that nothing moved — a test comparing the new bundles to each other proves
only that they match each other.

- [ ] **Step 2: Write the test**

```ts
import shipped from "./__fixtures__/shipped-tables.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { modeConfigOf } from "./registry.js";

describe("day one is behaviourally a no-op (G4)", () => {
  for (const mode of [GameMode.FFA_LAST_STANDING, GameMode.FFA_DEATHMATCH]) {
    it(`mode ${mode} carries the shipped values`, () => {
      const c = modeConfigOf(mode);
      expect(c.weapons).toEqual(shipped.weapons);
      expect(c.cars).toEqual(shipped.cars);
      expect(c.drive).toEqual(shipped.drive);
      expect(c.ram).toEqual(shipped.ram);
      expect(c.statusTable).toEqual(shipped.statusTable);
      expect(c.turret).toEqual(shipped.turret);
      expect(c.combat).toEqual(shipped.combat);
      expect(c.impulse).toEqual(shipped.impulse);
      expect(c.spike).toEqual(shipped.spike);
    });
  }
});
```

- [ ] **Step 3: Run, expect PASS. If it fails, the generator dropped or reordered something — fix
      the folder, never the fixture.**

- [ ] **Step 4: Commit**

```bash
git commit -am "test(shared): both modes carry the shipped values (G4)"
```

---

### Task 4: Per-mode invariants (MC42, Review Focus #4)

**Files:**
- Test: `packages/shared/src/modes/invariants.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { ABILITY_SLOT_CEILING } from "../config/weapon-slots.js";
import { MODE_TABLE } from "./registry.js";

for (const def of Object.values(MODE_TABLE)) {
  describe(`mode ${def.name}`, () => {
    it("carries maxAbilitySlots within [1, ABILITY_SLOT_CEILING] (MC33)", () => {
      expect(def.config.slots.maxAbilitySlots).toBeGreaterThanOrEqual(1);
      expect(def.config.slots.maxAbilitySlots).toBeLessThanOrEqual(ABILITY_SLOT_CEILING);
    });

    it("derives maxFireSlots from maxAbilitySlots (MC28)", () => {
      expect(def.config.slots.maxFireSlots).toBe(def.config.slots.maxAbilitySlots + 1);
      expect(def.config.slots.basicAttackSlotIndex).toBe(0);
    });

    it("gives no weapon to two chassis (L1, weapon exclusivity)", () => {
      const seen = new Map<string, string>();
      for (const car of Object.values(def.config.cars)) {
        for (const w of [...car.weapons, car.basicAttack]) {
          expect(seen.has(w), `${w} on ${seen.get(w)} and ${car.id} in ${def.name}`).toBe(false);
          seen.set(w, car.id);
        }
      }
    });

    it("caps seats at MAX_PLAYERS and needs at least two (MC34)", () => {
      expect(def.config.maxPlayers).toBeGreaterThanOrEqual(2);
      expect(def.config.maxPlayers).toBeLessThanOrEqual(6);
    });

    it("puts an impulse only on a maneuver row", () => {
      for (const w of Object.values(def.config.weapons)) {
        if ("impulse" in w && w.impulse) expect(w.kind).toBe("maneuver");
      }
    });

    it("truncates an over-long kit silently, and only warns past the ceiling", () => {
      for (const car of Object.values(def.config.cars)) {
        expect(car.weapons.length).toBeLessThanOrEqual(ABILITY_SLOT_CEILING);
      }
    });
  });
}
```

- [ ] **Step 2: Run — expect PASS. A failure here names the mode, which is the point of MC42.**

- [ ] **Step 3: Commit**

```bash
git commit -am "test(shared): config invariants run per mode and name the offender (MC42)"
```

---

### Task 5: Wire-width bounds (MC38, Review Focus #2)

**Files:**
- Test: `packages/shared/src/modes/wire-bounds.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { hpOf } from "../config/car-config.js";
import { withMode } from "./active.js";
import { MODE_TABLE } from "./registry.js";

// A value above its schema type's range does not error — it TRUNCATES on the wire, producing a car
// that dies at the wrong HP with nothing in the log. These bounds are the only thing that catches it.
for (const def of Object.values(MODE_TABLE)) {
  describe(`mode ${def.name} fits the wire`, () => {
    it("keeps every chassis hp inside uint16", () => {
      withMode(def.config, () => {
        for (const id of Object.keys(def.config.cars)) {
          const hp = hpOf(id as never);
          expect(hp, `${id} in ${def.name}`).toBeGreaterThan(0);
          expect(hp, `${id} in ${def.name}`).toBeLessThanOrEqual(65535);
        }
      });
    });

    it("keeps the deathmatch kill target inside uint8", () => {
      expect(def.config.deathmatch.killTarget ?? 0).toBeLessThanOrEqual(255);
    });

    it("keeps maxFireSlots inside int8, since lastFiredSlot is int8", () => {
      expect(def.config.slots.maxFireSlots).toBeLessThanOrEqual(127);
    });
  });
}
```

- [ ] **Step 2: Run — expect PASS. Commit.**

```bash
git commit -am "test(shared): per-mode values fit their wire types (MC38)"
```

---

### Task 6: Delete the scaffolding and update state

- [ ] **Step 1: Delete `packages/shared/src/modes/legacy.ts`**

Repoint every test that imported `LEGACY_TABLES` at `BRAWL_TABLES`.

- [ ] **Step 2: Build, full suite, commit**

```bash
npm run build && npm test
git rm packages/shared/src/modes/legacy.ts
git commit -am "chore(shared): drop the phase-1 legacy bundle"
```

- [ ] **Step 3: Mark phase 2 done in `EXECUTION.md`, set Next to Phase 3 Task 1, commit.**
