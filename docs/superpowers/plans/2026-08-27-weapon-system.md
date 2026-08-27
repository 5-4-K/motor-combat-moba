# Weapon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hardcoded weapon with a configurable multi-weapon system — projectile and beam types, per-car slot loadouts, shaped hitboxes, stocks, and an unlock gate — without changing the shipped game's balance.

**Architecture:** Weapon definitions live in a shared discriminated-union table; all durations are authored in milliseconds and converted once to integer ticks. Four new pure modules under `packages/shared/src/sim/weapons/` (shapes, instances, hits, fire) hold the rules; `runCombat` keeps ordering the phases and keeps owning ramming untouched. Combat stays server-only — the client sends a slot bitmask and renders what the server reports.

**Tech Stack:** TypeScript (ESM, NodeNext), npm workspaces, Vitest (shared/server/client), `node --test` for `scripts/*.test.mjs`, Colyseus schema v2, Phaser 3, sharp (image processing).

**Spec:** [`docs/superpowers/specs/2026-08-27-weapon-system-design.md`](../specs/2026-08-27-weapon-system-design.md) — read it alongside this plan; every task references its decisions by number (D1–D22).

## Global Constraints

- `TICK_RATE_HZ` lives once in `@motor-combat-moba/shared`. Never re-declare it, never hardcode 30.
- No magic numbers in logic. Every balance value comes from a shared config table.
- Clients send inputs only, never authoritative sim state.
- `stepSim` is the lockstep; server and client import the same function.
- If `stepSim` reads it, it is a networked schema field.
- Enum uint8 values are explicit and stable; never renumber. `WeaponKind.PROJECTILE = 0`, `WeaponKind.BEAM = 1`.
- Max 6 players.
- Combat is **server-only**. Never add client-side prediction of firing, cooldowns, or damage.
- Shared is consumed as built `dist`. After editing shared, rebuild: `npm run build -w @motor-combat-moba/shared`. Build everything with root `npm run build`, **never** `npm run build --workspaces`.
- Durations are authored in **integer milliseconds** and converted with `msToTicks(ms) = Math.ceil(ms * TICK_RATE_HZ / 1000)` exactly once, in `weapon-ticks.ts`. Sim code reads ticks only, never raw ms (D6).
- Determinism: iterate players in sorted `sessionId` order and slots in index order, everywhere (matches existing `runCombat`).
- Do not touch the drive model, the car OBB hull model, ramming, or friendly-fire rules.
- Every task ends green: `npm test` from the repo root must pass before the commit.
- Run tests for one package with `npm test -w @motor-combat-moba/shared` (likewise `server`, `client`). Vitest filters: `npm test -w @motor-combat-moba/shared -- weapon-config`.

---

## File Structure

**Created (shared):**
- `packages/shared/src/config/weapon-types.ts` — the `WeaponDef` union and its sub-types. Types only, no data.
- `packages/shared/src/config/weapon-ticks.ts` — `msToTicks` and the derived, frozen `WEAPON_TICKS`.
- `packages/shared/src/config/weapon-slots.ts` — `WEAPON_SLOT_CONFIG` and `slotsOf(carId)` with the over-slot warning.
- `packages/shared/src/sim/weapons/shapes.ts` — hitbox → world shape, the swept smear, shape-vs-hull tests.
- `packages/shared/src/sim/weapons/instances.ts` — the live-instance model, spawning, stepping, expiry, beam wall-clipping.
- `packages/shared/src/sim/weapons/hits.ts` — pose-snapshot hit resolution, per-target damage clocks, pierce.
- `packages/shared/src/sim/weapons/fire.ts` — the per-car fire state machine.
- `packages/shared/src/sim/weapons/targets.ts` — `canDamage`, moved from `sim/projectiles.ts`.
- `packages/shared/src/schema/WeaponInstanceState.ts`, `packages/shared/src/schema/WeaponSlotState.ts`.

**Created (client / scripts):**
- `packages/client/src/config/slot-keys.ts` — key bindings per slot (client-only; the server sees indices).
- `packages/client/src/scenes/weapon-hud.ts` — pure HUD derivations.
- `scripts/import-weapon-icon.mjs` — icon importer.
- `.claude/skills/process-weapon-icon/SKILL.md` — the icon skill.

**Modified:**
- `packages/shared/src/config/weapon-config.ts` — `WEAPON_CONFIG` (4 numbers) → `WEAPON_TABLE`.
- `packages/shared/src/config/types.ts`, `car-config.ts` — `CarDef.weapons`.
- `packages/shared/src/sim/combat.ts` — orchestrator only; firing/flight/hits move out. Ramming untouched.
- `packages/shared/src/sim/collide.ts` — export `convexOverlap`, `circleOverlapsObb`, `obbCorners`, `Vec2`.
- `packages/shared/src/schema/PlayerState.ts`, `ArenaState.ts`, `packages/shared/src/net/input.ts`, `packages/shared/src/index.ts`.
- `packages/server/src/sim/tick.ts`, `packages/server/src/sim/combat-bridge.ts`, `packages/server/src/rooms/ArenaRoom.ts`.
- `packages/client/src/scenes/ArenaScene.ts`, `combat-visual.ts`, `packages/client/src/assets/asset-keys.ts`.
- Docs: `combat-model.md`, `schema-reference.md`, `config-reference.md`, `asset-pipeline.md`.

**Deleted:** `packages/shared/src/sim/projectiles.ts` (Task 8), `packages/shared/src/schema/ProjectileState.ts` (Task 9).

---

### Task 1: Weapon definition types and table

**Files:**
- Create: `packages/shared/src/config/weapon-types.ts`
- Modify: `packages/shared/src/config/weapon-config.ts` (replace contents, keeping `WEAPON_CONFIG` exported for now)
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/config/weapon-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WeaponId`, `WeaponDef`, `ProjectileWeaponDef`, `BeamWeaponDef`, `ProjectileHitbox`, `BeamHitbox`, `StockDef`, `VolleyDef`, `WEAPON_TABLE`, `isWeaponId(v: unknown): v is WeaponId`, `weaponDefOf(id: WeaponId): WeaponDef`.

**Context:** D1, D5, D7, D9, D12, D17, D22. `WEAPON_CONFIG` stays exported and unchanged this task so `combat.ts` keeps compiling; Task 8 deletes it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/config/weapon-config.test.ts
import { describe, expect, it } from "vitest";
import { WEAPON_TABLE, isWeaponId, weaponDefOf } from "./weapon-config.js";

describe("WEAPON_TABLE", () => {
  it("ships the migrated cannon with today's numbers", () => {
    const cannon = WEAPON_TABLE.cannon;
    expect(cannon.kind).toBe("projectile");
    expect(cannon.damage).toBe(8);
    expect(cannon.cooldownMs).toBe(500); // was fireRateHz: 2
    expect(cannon.speed).toBe(900);
    expect(cannon.range).toBe(900); // was lifetimeTicks: 30 == 1s of flight at 900 u/s
    expect(cannon.startUpMs).toBe(0);
    expect(cannon.recoveryMs).toBe(0);
    expect(cannon.damageFrequencyMs).toBe(0);
    expect(cannon.unlocksAt).toBe(1);
    expect(cannon.stock).toBeUndefined();
  });

  it("gives the cannon a single-target circle hitbox and no volley spread", () => {
    const cannon = WEAPON_TABLE.cannon;
    if (cannon.kind !== "projectile") throw new Error("cannon must be a projectile");
    expect(cannon.pierce).toBe(0);
    expect(cannon.hitbox).toEqual({ shape: "circle", radius: 3 });
    expect(cannon.volley).toEqual({
      volleys: 1,
      volleyIntervalMs: 0,
      pelletsPerVolley: 1,
      spreadAngleDeg: 0,
    });
  });

  it("validates every row: positive stats, unlocksAt >= 1", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      expect(def.unlocksAt).toBeGreaterThanOrEqual(1);
      expect(def.damage).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.range).toBeGreaterThan(0);
      expect(def.name.length).toBeGreaterThan(0);
      if (def.stock) {
        expect(def.stock.max).toBeGreaterThanOrEqual(2);
        expect(def.stock.refireDelayMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("rejects prototype names as weapon ids", () => {
    expect(isWeaponId("cannon")).toBe(true);
    expect(isWeaponId("constructor")).toBe(false);
    expect(isWeaponId("__proto__")).toBe(false);
    expect(isWeaponId(7)).toBe(false);
  });

  it("resolves a def by id", () => {
    expect(weaponDefOf("cannon").id).toBe("cannon");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- weapon-config`
Expected: FAIL — `WEAPON_TABLE` is not exported from `weapon-config.js`.

- [ ] **Step 3: Write `weapon-types.ts`**

```ts
// packages/shared/src/config/weapon-types.ts

/** Every weapon in the game. Add an id here and a row in `WEAPON_TABLE`. */
export type WeaponId = "cannon";

/**
 * Optional charge system. Absent means single-stock, which is exactly the pre-weapon-system
 * behaviour: fire, wait out `cooldownMs`, fire again.
 *
 * `refireDelayMs` lives here rather than on the base because for a single-stock weapon the next
 * shot is already gated by the recharge, so the field would be provably redundant there — any
 * value below `cooldownMs` does nothing and any value above it could have been a cooldown edit.
 */
export interface StockDef {
  /** How many shots may be banked. Validated >= 2; a max of 1 is the absent case. */
  max: number;
  /** Minimum gap between consecutive shots of THIS weapon when firing from stock. */
  refireDelayMs: number;
}

/** One press: `volleys` groups of `pelletsPerVolley`, fanned across `spreadAngleDeg`. */
export interface VolleyDef {
  /** Sequential groups. 1 = a single shot or a single shotgun blast. */
  volleys: number;
  /** Gap between sequential groups. Ignored when `volleys` is 1. */
  volleyIntervalMs: number;
  /** Simultaneous instances per group. 1 = not a shotgun. */
  pelletsPerVolley: number;
  /** Total fan width, split evenly and symmetrically about the car's heading. */
  spreadAngleDeg: number;
}

/** Projectiles are fixed-size, so they configure their full extent. */
export type ProjectileHitbox =
  | { shape: "circle"; radius: number }
  | { shape: "ellipse"; radiusAlong: number; radiusAcross: number };

/**
 * Beams configure their CROSS-SECTION only. The axial extent is the current expansion, growing
 * 0 -> `range` at `speed`, so `range` means one thing everywhere and cannot contradict a length.
 */
export type BeamHitbox =
  | { shape: "rect"; width: number }
  | { shape: "cone"; angleDeg: number };

export type Hitbox = ProjectileHitbox | BeamHitbox;

interface WeaponBase {
  id: WeaponId;
  /** Display name. Render-only: `stepSim` never reads it, so it is not a schema field. */
  name: string;
  /** In-match level at which this weapon unlocks. Validated >= 1. */
  unlocksAt: number;
  damage: number;
  /** 0 = each car may be damaged by one instance exactly once. > 0 = re-arm on that interval. */
  damageFrequencyMs: number;
  /** World units per second: travel speed (projectile) or expansion speed (beam). */
  speed: number;
  /** World units: max travel (projectile) or max extent (beam). */
  range: number;
  /** Press -> the weapon actually fires. Driving is unaffected; the press cannot be cancelled. */
  startUpMs: number;
  /** Recharge interval for one stock. */
  cooldownMs: number;
  /** Lockout before a DIFFERENT weapon may fire. Not a universal lockout — see `StockDef`. */
  recoveryMs: number;
  stock?: StockDef;
}

export interface ProjectileWeaponDef extends WeaponBase {
  kind: "projectile";
  hitbox: ProjectileHitbox;
  /** Additional opponents passed through after damaging one. 0 = dies on the first car it damages. */
  pierce: number;
  volley: VolleyDef;
}

export interface BeamWeaponDef extends WeaponBase {
  kind: "beam";
  hitbox: BeamHitbox;
  /** true = origin and angle follow the firing car every tick, and it dies with its owner. */
  attached: boolean;
  /** Linger AFTER full extension. Total life = range/speed + this. */
  lifetimeMs: number;
}

export type WeaponDef = ProjectileWeaponDef | BeamWeaponDef;
```

- [ ] **Step 4: Write `weapon-config.ts`**

```ts
// packages/shared/src/config/weapon-config.ts
import type { WeaponDef, WeaponId } from "./weapon-types.js";

/**
 * Every weapon in the game, mirroring `CAR_TABLE`. Balance lives here and nowhere else.
 *
 * `cannon` is the migrated pre-weapon-system shot, carrying its exact numbers: `fireRateHz: 2`
 * became `cooldownMs: 500`, and `lifetimeTicks: 30` became `range: 900` (one second of flight at
 * 900 u/s). Its 3-unit circle is the smallest hitbox that keeps the old point-hit feel while
 * satisfying "every weapon has a hitbox".
 */
export const WEAPON_TABLE = {
  cannon: {
    id: "cannon",
    kind: "projectile",
    name: "Cannon",
    unlocksAt: 1,
    damage: 8,
    damageFrequencyMs: 0,
    speed: 900,
    range: 900,
    startUpMs: 0,
    cooldownMs: 500,
    recoveryMs: 0,
    hitbox: { shape: "circle", radius: 3 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
} as const satisfies Record<WeaponId, WeaponDef>;

/**
 * Own-property check, deliberately not `value in WEAPON_TABLE`: `in` walks the prototype chain, so
 * inherited names like `"constructor"` would pass as weapon ids and resolve to undefined stats.
 * Same rule as `isCarId`.
 */
export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WEAPON_TABLE, value);
}

export function weaponDefOf(id: WeaponId): WeaponDef {
  return WEAPON_TABLE[id];
}

/** @deprecated Superseded by `WEAPON_TABLE`; removed once `combat.ts` stops reading it. */
export const WEAPON_CONFIG = {
  damage: 8,
  fireRateHz: 2,
  projectileSpeed: 900,
  lifetimeTicks: 30,
} as const;
```

- [ ] **Step 5: Export from the shared index**

In `packages/shared/src/index.ts`, replace the `WEAPON_CONFIG` export line with:

```ts
export { WEAPON_CONFIG, WEAPON_TABLE, isWeaponId, weaponDefOf } from "./config/weapon-config.js";
export type {
  BeamHitbox,
  BeamWeaponDef,
  Hitbox,
  ProjectileHitbox,
  ProjectileWeaponDef,
  StockDef,
  VolleyDef,
  WeaponDef,
  WeaponId,
} from "./config/weapon-types.js";
```

- [ ] **Step 6: Run tests**

Run: `npm test -w @motor-combat-moba/shared` then `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/config/weapon-types.ts packages/shared/src/config/weapon-config.ts packages/shared/src/config/weapon-config.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add weapon definition union and WEAPON_TABLE"
```

---

### Task 2: Millisecond → tick derivation

**Files:**
- Create: `packages/shared/src/config/weapon-ticks.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/config/weapon-ticks.test.ts`

**Interfaces:**
- Consumes: `WEAPON_TABLE`, `WeaponId`, `WeaponDef` (Task 1).
- Produces: `msToTicks(ms: number): number`, `WeaponTicks` (fields `startUp`, `cooldown`, `recovery`, `refireDelay`, `lifetime`, `damageInterval`, `volleyInterval`, `flight`), `WEAPON_TICKS: Readonly<Record<WeaponId, WeaponTicks>>`, `weaponTicksOf(id: WeaponId): WeaponTicks`.

**Context:** D6. Sim code reads this table and never raw milliseconds.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/config/weapon-ticks.test.ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import { WEAPON_TICKS, msToTicks, weaponTicksOf } from "./weapon-ticks.js";

describe("msToTicks", () => {
  it("rounds up, so a duration is never shorter than authored", () => {
    expect(msToTicks(0)).toBe(0);
    expect(msToTicks(1)).toBe(1); // 0.03 ticks still costs a whole tick
    expect(msToTicks(1000)).toBe(TICK_RATE_HZ);
    expect(msToTicks(500)).toBe(15);
    expect(msToTicks(250)).toBe(8); // 7.5 -> 8, i.e. 266ms at 30Hz
  });

  it("treats a negative duration as zero rather than a negative tick count", () => {
    expect(msToTicks(-100)).toBe(0);
  });
});

describe("WEAPON_TICKS", () => {
  it("derives the cannon's clocks from its milliseconds", () => {
    const ticks = weaponTicksOf("cannon");
    expect(ticks.cooldown).toBe(15); // 500ms at 30Hz — the old fireCooldownTicks()
    expect(ticks.startUp).toBe(0);
    expect(ticks.recovery).toBe(0);
    expect(ticks.refireDelay).toBe(0); // no stock block
  });

  it("derives flight ticks from range and speed", () => {
    // 900 units at 900 u/s = 1s = 30 ticks, the old WEAPON_CONFIG.lifetimeTicks
    expect(weaponTicksOf("cannon").flight).toBe(30);
  });

  it("maps damageFrequencyMs 0 to Infinity, meaning one hit per target ever", () => {
    expect(weaponTicksOf("cannon").damageInterval).toBe(Number.POSITIVE_INFINITY);
  });

  it("covers every weapon in the table and is frozen", () => {
    for (const id of Object.keys(WEAPON_TABLE)) {
      expect(WEAPON_TICKS[id as keyof typeof WEAPON_TABLE]).toBeDefined();
    }
    expect(Object.isFrozen(WEAPON_TICKS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- weapon-ticks`
Expected: FAIL — cannot resolve `./weapon-ticks.js`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/config/weapon-ticks.ts
import { TICK_RATE_HZ } from "../constants.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import type { WeaponDef, WeaponId } from "./weapon-types.js";

/**
 * Milliseconds to whole ticks, rounded up so an authored duration is never *shorter* than written.
 * At 30 Hz a tick is 33.3ms, so `250` becomes 8 ticks (266ms). That rounding is the documented
 * cost of authoring in ms; it happens here, once, and nowhere else.
 */
export function msToTicks(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil((ms * TICK_RATE_HZ) / 1000);
}

/** Every duration a weapon has, in the integer ticks the sim actually counts. */
export interface WeaponTicks {
  startUp: number;
  cooldown: number;
  recovery: number;
  /** From `stock.refireDelayMs`; 0 when the weapon is single-stock. */
  refireDelay: number;
  /** Beams only: linger after full extension. 0 for projectiles. */
  lifetime: number;
  /** `Infinity` when `damageFrequencyMs` is 0 — one hit per target, ever. */
  damageInterval: number;
  volleyInterval: number;
  /** Projectiles: ticks to cross `range`. Beams: ticks to reach full extension. */
  flight: number;
}

function ticksFor(def: WeaponDef): WeaponTicks {
  return {
    startUp: msToTicks(def.startUpMs),
    cooldown: msToTicks(def.cooldownMs),
    recovery: msToTicks(def.recoveryMs),
    refireDelay: def.stock ? msToTicks(def.stock.refireDelayMs) : 0,
    lifetime: def.kind === "beam" ? msToTicks(def.lifetimeMs) : 0,
    damageInterval:
      def.damageFrequencyMs === 0 ? Number.POSITIVE_INFINITY : msToTicks(def.damageFrequencyMs),
    volleyInterval: def.kind === "projectile" ? msToTicks(def.volley.volleyIntervalMs) : 0,
    flight: Math.ceil((def.range / def.speed) * TICK_RATE_HZ),
  };
}

/**
 * Derived once at module load and frozen. Server and client both import shared's built `dist`, so
 * both compute identical tick counts or neither does — which is what keeps ms-authored balance
 * safe for a lockstep sim.
 */
export const WEAPON_TICKS: Readonly<Record<WeaponId, WeaponTicks>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(WEAPON_TABLE) as WeaponId[]).map((id) => [id, Object.freeze(ticksFor(WEAPON_TABLE[id]))]),
  ) as Record<WeaponId, WeaponTicks>,
);

export function weaponTicksOf(id: WeaponId): WeaponTicks {
  return WEAPON_TICKS[id];
}
```

- [ ] **Step 4: Export and run tests**

Add to `packages/shared/src/index.ts`:

```ts
export { WEAPON_TICKS, msToTicks, weaponTicksOf } from "./config/weapon-ticks.js";
export type { WeaponTicks } from "./config/weapon-ticks.js";
```

Run: `npm test -w @motor-combat-moba/shared` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/config/weapon-ticks.ts packages/shared/src/config/weapon-ticks.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): derive weapon tick counts from authored milliseconds"
```

---

### Task 3: Per-car loadouts and slot limits

**Files:**
- Create: `packages/shared/src/config/weapon-slots.ts`
- Modify: `packages/shared/src/config/types.ts`, `packages/shared/src/config/car-config.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/config/weapon-slots.test.ts`

**Interfaces:**
- Consumes: `WeaponId`, `WEAPON_TABLE` (Task 1); `CarId`, `CAR_TABLE`.
- Produces: `WEAPON_SLOT_CONFIG` (`{ maxWeaponSlots: 3 }`), `slotsOf(carId: CarId): readonly WeaponId[]`, `CarDef.weapons: readonly WeaponId[]`.

**Context:** D2, D16, D22. Over-slot loadouts **warn and truncate** — never throw, never fail a test.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/config/weapon-slots.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAR_TABLE } from "./car-config.js";
import { WEAPON_SLOT_CONFIG, slotsOf, slotsFrom } from "./weapon-slots.js";

afterEach(() => vi.restoreAllMocks());

describe("loadouts", () => {
  it("gives every car at least one weapon and no more than the slot limit", () => {
    for (const car of Object.values(CAR_TABLE)) {
      expect(car.weapons.length).toBeGreaterThanOrEqual(1);
      expect(car.weapons.length).toBeLessThanOrEqual(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    }
  });

  it("ships all three cars carrying the migrated cannon in slot 1", () => {
    expect(CAR_TABLE.rectangle.weapons).toEqual(["cannon"]);
    expect(CAR_TABLE.oval.weapons).toEqual(["cannon"]);
    expect(CAR_TABLE.hexagon.weapons).toEqual(["cannon"]);
  });

  it("returns the car's list in slot order", () => {
    expect(slotsOf("hexagon")).toEqual(["cannon"]);
  });

  it("truncates an over-long loadout to the slot limit and warns once, naming the car", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const over = ["cannon", "cannon", "cannon", "cannon"] as const;

    const first = slotsFrom("hexagon", over);
    const second = slotsFrom("hexagon", over);

    expect(first).toHaveLength(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    expect(second).toHaveLength(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    expect(warn).toHaveBeenCalledTimes(1); // once per car, not once per call
    expect(warn.mock.calls[0]![0]).toContain("hexagon");
  });

  it("does not warn for a loadout inside the limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    slotsFrom("oval", ["cannon"]);
    expect(warn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- weapon-slots`
Expected: FAIL — cannot resolve `./weapon-slots.js`.

- [ ] **Step 3: Add `weapons` to `CarDef` and every car row**

In `packages/shared/src/config/types.ts`, add to `CarDef`:

```ts
import type { WeaponId } from "./weapon-types.js";

export interface CarDef {
  id: CarId;
  name: string;
  speed: number;
  strength: number;
  hp: number;
  /** Ordered loadout: index 0 is slot 1. Order IS the slot mapping. */
  weapons: readonly WeaponId[];
}
```

In `packages/shared/src/config/car-config.ts`:

```ts
export const CAR_TABLE = {
  rectangle: { id: "rectangle", name: "Rectangle", speed: 8, strength: 3, hp: 5, weapons: ["cannon"] },
  oval: { id: "oval", name: "Oval", speed: 5, strength: 8, hp: 3, weapons: ["cannon"] },
  hexagon: { id: "hexagon", name: "Hexagon", speed: 3, strength: 5, hp: 8, weapons: ["cannon"] },
} as const satisfies Record<CarId, CarDef>;
```

- [ ] **Step 4: Implement `weapon-slots.ts`**

```ts
// packages/shared/src/config/weapon-slots.ts
import { CAR_TABLE } from "./car-config.js";
import type { CarId } from "./types.js";
import type { WeaponId } from "./weapon-types.js";

/**
 * How many weapon slots any chassis may present. The server rejects a fire on a slot at or beyond
 * this index, and the HUD draws at most this many boxes.
 */
export const WEAPON_SLOT_CONFIG = { maxWeaponSlots: 3 } as const;

/** Cars already warned about, so an over-long loadout logs once rather than once per tick. */
const warned = new Set<string>();

/**
 * A car's loadout, capped at the slot limit. A car listing more weapons than slots is a config
 * mistake worth surfacing but not worth crashing over: the extras can never be selected or drawn,
 * so they are dropped with one warning naming the car.
 */
export function slotsFrom(carId: string, weapons: readonly WeaponId[]): readonly WeaponId[] {
  const max = WEAPON_SLOT_CONFIG.maxWeaponSlots;
  if (weapons.length <= max) return weapons;
  if (!warned.has(carId)) {
    warned.add(carId);
    console.warn(
      `[weapons] car "${carId}" lists ${weapons.length} weapons but maxWeaponSlots is ${max}; ` +
        `ignoring: ${weapons.slice(max).join(", ")}`,
    );
  }
  return weapons.slice(0, max);
}

export function slotsOf(carId: CarId): readonly WeaponId[] {
  return slotsFrom(carId, CAR_TABLE[carId].weapons);
}
```

- [ ] **Step 5: Export, run tests**

Add to `packages/shared/src/index.ts`:

```ts
export { WEAPON_SLOT_CONFIG, slotsFrom, slotsOf } from "./config/weapon-slots.js";
```

Run: `npm test -w @motor-combat-moba/shared` and `npm run typecheck`
Expected: PASS. (`config.test.ts` may assert `CAR_TABLE` shape — if it enumerates keys, add `weapons` there.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config/weapon-slots.ts packages/shared/src/config/weapon-slots.test.ts packages/shared/src/config/types.ts packages/shared/src/config/car-config.ts packages/shared/src/index.ts
git commit -m "feat(shared): give each car an ordered weapon loadout"
```

---

### Task 4: Convex overlap primitives in `collide.ts`

**Files:**
- Modify: `packages/shared/src/sim/collide.ts` (export existing internals, add two functions)
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/sim/collide.test.ts` (append a describe block)

**Interfaces:**
- Consumes: existing `Obb`, `Aabb`.
- Produces: `Vec2` (exported type), `obbCorners(box: Obb): Vec2[]`, `convexOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean`, `circleOverlapsObb(cx: number, cy: number, r: number, box: Obb): boolean`.

**Context:** D7. Ramming and driving must be untouched — this task only *adds* exported helpers alongside `mtvBetween`, which stays private and unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/shared/src/sim/collide.test.ts
import { circleOverlapsObb, convexOverlap, obbCorners } from "./collide.js";

describe("convex overlap", () => {
  const box = { x: 100, y: 100, angle: 0, w: 40, h: 20 };

  it("reports the four corners of an axis-aligned box", () => {
    const corners = obbCorners(box);
    expect(corners).toHaveLength(4);
    const xs = corners.map((c) => c.x).sort((a, b) => a - b);
    const ys = corners.map((c) => c.y).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(80);
    expect(xs[3]).toBeCloseTo(120);
    expect(ys[0]).toBeCloseTo(90);
    expect(ys[3]).toBeCloseTo(110);
  });

  it("finds overlap between a triangle and a box they share area with", () => {
    const triangle = [
      { x: 100, y: 100 },
      { x: 200, y: 60 },
      { x: 200, y: 140 },
    ];
    expect(convexOverlap(triangle, obbCorners(box))).toBe(true);
  });

  it("reports separation for a triangle clear of the box", () => {
    const triangle = [
      { x: 300, y: 300 },
      { x: 400, y: 260 },
      { x: 400, y: 340 },
    ];
    expect(convexOverlap(triangle, obbCorners(box))).toBe(false);
  });

  it("treats mere touching as separated, matching the driving resolver", () => {
    const flush = [
      { x: 120, y: 95 },
      { x: 160, y: 95 },
      { x: 160, y: 105 },
      { x: 120, y: 105 },
    ];
    expect(convexOverlap(flush, obbCorners(box))).toBe(false);
  });

  it("tests a circle against a box exactly, including the corner case", () => {
    expect(circleOverlapsObb(100, 100, 1, box)).toBe(true); // inside
    expect(circleOverlapsObb(125, 100, 6, box)).toBe(true); // overlapping the right face
    expect(circleOverlapsObb(125, 100, 4, box)).toBe(false); // clear of it
    expect(circleOverlapsObb(123, 113, 5, box)).toBe(true); // nearest point is the corner
    expect(circleOverlapsObb(126, 116, 5, box)).toBe(false); // just past the corner
  });

  it("respects rotation", () => {
    const turned = { x: 100, y: 100, angle: Math.PI / 2, w: 40, h: 20 };
    expect(circleOverlapsObb(100, 118, 1, turned)).toBe(true); // long axis now vertical
    expect(circleOverlapsObb(118, 100, 1, turned)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- collide`
Expected: FAIL — `obbCorners`, `convexOverlap`, `circleOverlapsObb` are not exported.

- [ ] **Step 3: Implement**

In `packages/shared/src/sim/collide.ts`: change `interface Vec2` to `export interface Vec2`, change `function obbCorners` to `export function obbCorners`, and append:

```ts
/**
 * Separating Axis Theorem over two convex polygons, as a yes/no. Shares `MIN_OVERLAP` with
 * `mtvBetween`, so "just touching" counts as separated here exactly as it does for driving — the
 * property `obbsInContact` exists to work around, and one weapon hit tests must not contradict.
 *
 * Both inputs must be convex and wound consistently. Weapon hitboxes are generated (Task 5), never
 * hand-authored, which is what makes that safe to assume.
 */
export function convexOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const axis of [...edgeNormals(a), ...edgeNormals(b)]) {
    const spanA = projectOnto(a, axis);
    const spanB = projectOnto(b, axis);
    if (spanA.max - spanB.min <= MIN_OVERLAP) return false;
    if (spanB.max - spanA.min <= MIN_OVERLAP) return false;
  }
  return true;
}

/** Outward normals of each edge, the candidate separating axes for a convex polygon. */
function edgeNormals(points: readonly Vec2[]): Vec2[] {
  const axes: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const length = Math.hypot(ex, ey);
    if (length <= MIN_OVERLAP) continue;
    axes.push({ x: -ey / length, y: ex / length });
  }
  return axes;
}

/**
 * Exact circle-vs-OBB: rotate the circle's centre into the box's local frame, clamp to the box, and
 * compare the distance to the radius. Exact rather than polygonal because a circle is the common
 * projectile hitbox and an inscribed polygon would quietly under-report hits.
 */
export function circleOverlapsObb(cx: number, cy: number, r: number, box: Obb): boolean {
  const cos = Math.cos(-box.angle);
  const sin = Math.sin(-box.angle);
  const dx = cx - box.x;
  const dy = cy - box.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  const hx = box.w / 2;
  const hy = box.h / 2;
  const nearestX = Math.min(hx, Math.max(-hx, localX));
  const nearestY = Math.min(hy, Math.max(-hy, localY));

  return Math.hypot(localX - nearestX, localY - nearestY) < r;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @motor-combat-moba/shared`
Expected: PASS, including every pre-existing collide/drive/ram test — this task must not change resolution behaviour.

- [ ] **Step 5: Export and commit**

Add to `packages/shared/src/index.ts`: `circleOverlapsObb, convexOverlap, obbCorners` to the existing `./sim/collide.js` export, and `Vec2` to its type export.

```bash
git add packages/shared/src/sim/collide.ts packages/shared/src/sim/collide.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): export convex-polygon and circle overlap primitives"
```

---

### Task 5: Weapon hitbox shapes and the swept smear

**Files:**
- Create: `packages/shared/src/sim/weapons/shapes.ts`
- Test: `packages/shared/src/sim/weapons/shapes.test.ts`

**Interfaces:**
- Consumes: `ProjectileHitbox`, `BeamHitbox` (Task 1); `Vec2`, `Obb`, `convexOverlap`, `circleOverlapsObb`, `obbCorners` (Task 4).
- Produces: `WorldShape` (`{ kind: "circle"; x; y; radius }` | `{ kind: "polygon"; points: Vec2[] }`), `projectileShapeAt(hitbox, x, y, angle): WorldShape`, `beamShapeAt(hitbox, x, y, angle, extent): WorldShape`, `smear(from: WorldShape, to: WorldShape): WorldShape`, `shapeHitsObb(shape: WorldShape, hull: Obb): boolean`, `ELLIPSE_SEGMENTS`, `CIRCLE_SEGMENTS`.

**Context:** D7, D8. A beam configures cross-section only; its axial extent is passed in.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/sim/weapons/shapes.test.ts
import { describe, expect, it } from "vitest";
import { beamShapeAt, projectileShapeAt, shapeHitsObb, smear } from "./shapes.js";

const hull = { x: 200, y: 100, angle: 0, w: 48, h: 32 };

describe("projectile shapes", () => {
  it("keeps a circle exact so small shots are not under-reported", () => {
    const shape = projectileShapeAt({ shape: "circle", radius: 5 }, 100, 100, 0);
    expect(shape).toEqual({ kind: "circle", x: 100, y: 100, radius: 5 });
  });

  it("builds an ellipse as a polygon oriented along the heading", () => {
    const shape = beamOrEllipse();
    if (shape.kind !== "polygon") throw new Error("ellipse must be a polygon");
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    // 20 long, 6 across, pointing +x: wider in x than in y
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));
  });

  it("rotates the ellipse with the heading", () => {
    const turned = projectileShapeAt(
      { shape: "ellipse", radiusAlong: 20, radiusAcross: 6 },
      100,
      100,
      Math.PI / 2,
    );
    if (turned.kind !== "polygon") throw new Error("ellipse must be a polygon");
    const xs = turned.points.map((p) => p.x);
    const ys = turned.points.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
  });

  function beamOrEllipse() {
    return projectileShapeAt({ shape: "ellipse", radiusAlong: 20, radiusAcross: 6 }, 100, 100, 0);
  }
});

describe("beam shapes", () => {
  it("grows a rectangle forward from the muzzle, not around it", () => {
    const shape = beamShapeAt({ shape: "rect", width: 20 }, 100, 100, 0, 300);
    if (shape.kind !== "polygon") throw new Error("beam must be a polygon");
    const xs = shape.points.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(100); // starts at the muzzle
    expect(Math.max(...xs)).toBeCloseTo(400); // reaches muzzle + extent
    const ys = shape.points.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20); // cross-section is the width
  });

  it("fans a cone from an apex at the muzzle, widening with extent", () => {
    const near = beamShapeAt({ shape: "cone", angleDeg: 60 }, 100, 100, 0, 100);
    const far = beamShapeAt({ shape: "cone", angleDeg: 60 }, 100, 100, 0, 300);
    if (near.kind !== "polygon" || far.kind !== "polygon") throw new Error("cone must be a polygon");
    const spread = (s: { points: { y: number }[] }) =>
      Math.max(...s.points.map((p) => p.y)) - Math.min(...s.points.map((p) => p.y));
    expect(spread(far)).toBeGreaterThan(spread(near));
  });

  it("has zero area at zero extent, so a beam does not hit on the tick it is born", () => {
    const shape = beamShapeAt({ shape: "rect", width: 20 }, 200, 100, 0, 0);
    expect(shapeHitsObb(shape, hull)).toBe(false);
  });
});

describe("smear", () => {
  it("covers the gap between two positions, so a fast shot cannot tunnel", () => {
    // A 3-unit shot stepping 120 units per tick straddles the hull without a smear.
    const before = projectileShapeAt({ shape: "circle", radius: 3 }, 140, 100, 0);
    const after = projectileShapeAt({ shape: "circle", radius: 3 }, 260, 100, 0);

    expect(shapeHitsObb(before, hull)).toBe(false);
    expect(shapeHitsObb(after, hull)).toBe(false);
    expect(shapeHitsObb(smear(before, after), hull)).toBe(true);
  });

  it("still misses a hull the path never crosses", () => {
    const before = projectileShapeAt({ shape: "circle", radius: 3 }, 140, 300, 0);
    const after = projectileShapeAt({ shape: "circle", radius: 3 }, 260, 300, 0);
    expect(shapeHitsObb(smear(before, after), hull)).toBe(false);
  });

  it("is a no-op in effect when the shot has not moved", () => {
    const still = projectileShapeAt({ shape: "circle", radius: 3 }, 200, 100, 0);
    expect(shapeHitsObb(smear(still, still), hull)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- shapes`
Expected: FAIL — cannot resolve `./shapes.js`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/sim/weapons/shapes.ts
import type { BeamHitbox, ProjectileHitbox } from "../../config/weapon-types.js";
import { circleOverlapsObb, convexOverlap, obbCorners, type Obb, type Vec2 } from "../collide.js";

/**
 * A hitbox placed in the world. A circle stays a circle because it is the common projectile shape
 * and an inscribed polygon would quietly under-report hits; everything else is a convex polygon
 * running through the same SAT the car hulls use.
 */
export type WorldShape =
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "polygon"; points: Vec2[] };

/** Segments in a generated ellipse. Even, so the shape is symmetric about both axes. */
export const ELLIPSE_SEGMENTS = 12;
/** Segments used when a circle has to become a polygon (only inside `smear`). */
export const CIRCLE_SEGMENTS = 12;

export function projectileShapeAt(
  hitbox: ProjectileHitbox,
  x: number,
  y: number,
  angle: number,
): WorldShape {
  if (hitbox.shape === "circle") return { kind: "circle", x, y, radius: hitbox.radius };
  return {
    kind: "polygon",
    points: ring(ELLIPSE_SEGMENTS).map((t) =>
      rotateInto(x, y, angle, Math.cos(t) * hitbox.radiusAlong, Math.sin(t) * hitbox.radiusAcross),
    ),
  };
}

/**
 * A beam at its current reach. `extent` is the axial dimension — beams configure cross-section
 * only (D7) — so a zero extent is a degenerate shape that hits nothing, which is what makes the
 * tick a beam is born harmless.
 */
export function beamShapeAt(
  hitbox: BeamHitbox,
  x: number,
  y: number,
  angle: number,
  extent: number,
): WorldShape {
  const reach = Math.max(0, extent);
  if (hitbox.shape === "rect") {
    const half = hitbox.width / 2;
    return {
      kind: "polygon",
      points: [
        rotateInto(x, y, angle, 0, -half),
        rotateInto(x, y, angle, reach, -half),
        rotateInto(x, y, angle, reach, half),
        rotateInto(x, y, angle, 0, half),
      ],
    };
  }
  // Cone: apex at the muzzle, so it fans wider in absolute terms as it grows.
  const half = (hitbox.angleDeg * Math.PI) / 360;
  const spread = Math.tan(half) * reach;
  return {
    kind: "polygon",
    points: [
      rotateInto(x, y, angle, 0, 0),
      rotateInto(x, y, angle, reach, -spread),
      rotateInto(x, y, angle, reach, spread),
    ],
  };
}

/**
 * The convex hull of a shape at its previous and current positions: a solid covering the whole
 * path travelled this tick.
 *
 * Without it a 3-unit shot moving 30 units per tick is sampled only where it lands and can pass
 * clean through a car. The smear is deliberately generous — it registers anywhere along that
 * tick's path — which is the correct bias for a shooter.
 */
export function smear(from: WorldShape, to: WorldShape): WorldShape {
  return { kind: "polygon", points: convexHull([...verticesOf(from), ...verticesOf(to)]) };
}

export function shapeHitsObb(shape: WorldShape, hull: Obb): boolean {
  if (shape.kind === "circle") return circleOverlapsObb(shape.x, shape.y, shape.radius, hull);
  return convexOverlap(shape.points, obbCorners(hull));
}

/** Local (forward, lateral) offset placed at a world pose. Forward is +x at angle 0. */
function rotateInto(x: number, y: number, angle: number, forward: number, lateral: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x + forward * cos - lateral * sin, y: y + forward * sin + lateral * cos };
}

function ring(segments: number): number[] {
  return Array.from({ length: segments }, (_, i) => (i / segments) * Math.PI * 2);
}

/**
 * Circles become polygons only here, and are *circumscribed* (radius scaled by 1/cos(pi/n)) so the
 * smear never covers less area than the circle it stands for.
 */
function verticesOf(shape: WorldShape): Vec2[] {
  if (shape.kind === "polygon") return shape.points;
  const scale = 1 / Math.cos(Math.PI / CIRCLE_SEGMENTS);
  return ring(CIRCLE_SEGMENTS).map((t) => ({
    x: shape.x + Math.cos(t) * shape.radius * scale,
    y: shape.y + Math.sin(t) * shape.radius * scale,
  }));
}

/** Monotone chain. Deterministic: sorted input, fixed traversal, no floating tie-breaks. */
function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (sorted.length < 3) return sorted;

  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const build = (input: Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...build(sorted), ...build([...sorted].reverse())];
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @motor-combat-moba/shared -- shapes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/weapons/shapes.ts packages/shared/src/sim/weapons/shapes.test.ts
git commit -m "feat(shared): weapon hitbox shapes with swept smear hit testing"
```

---

### Task 6: Live instances — spawn, step, expire, wall-clip

**Files:**
- Create: `packages/shared/src/sim/weapons/instances.ts`
- Test: `packages/shared/src/sim/weapons/instances.test.ts`

**Interfaces:**
- Consumes: `WEAPON_TABLE`, `weaponTicksOf` (Tasks 1–2); `Aabb`, `Bounds` (collide).
- Produces:
  - `WeaponInstance` — `{ id, ownerSessionId, weaponId, kind, x, y, angle, extent, spawnTick, distance, pierceLeft, attached, damageClock: Map<string, number>, alive }`
  - `ShotOrder` — `{ weaponId: WeaponId; slot: number }`
  - `spawnInstances(order, owner, tick, seq): { instances: WeaponInstance[]; seq: number }` where `owner` is `{ sessionId, x, y, angle }`
  - `stepInstance(instance, ctx): WeaponInstance` where `ctx` is `{ dt, tick, obstacles, bounds, ownerPose: { x, y, angle } | null }`
  - `instanceExpired(instance, tick): boolean`
  - `wallClipDistance(x, y, angle, range, obstacles, bounds): number`
  - `MUZZLE_STEP_UNITS`

**Context:** D11, D12, D8. Instances are frozen at birth unless `attached`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/sim/weapons/instances.test.ts
import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../../constants.js";
import { DRIVE_CONFIG } from "../../config/drive-config.js";
import {
  instanceExpired,
  spawnInstances,
  stepInstance,
  wallClipDistance,
  type WeaponInstance,
} from "./instances.js";

const DT = MS_PER_TICK / 1000;
const BOUNDS = { width: 2000, height: 1200 };
const ctx = (over: Partial<Parameters<typeof stepInstance>[1]> = {}) => ({
  dt: DT,
  tick: 100,
  obstacles: [],
  bounds: BOUNDS,
  ownerPose: null,
  ...over,
});

const owner = { sessionId: "aaa", x: 500, y: 300, angle: 0 };

describe("spawning", () => {
  it("births a shot at the car's nose, not its centre", () => {
    const { instances } = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 0);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.x).toBeCloseTo(500 + DRIVE_CONFIG.carWidth / 2);
    expect(instances[0]!.y).toBeCloseTo(300);
  });

  it("gives every instance a unique id from the sequence and returns the advanced sequence", () => {
    const first = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 7);
    const second = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 101, first.seq);
    expect(first.seq).toBe(8);
    expect(second.seq).toBe(9);
    expect(first.instances[0]!.id).not.toBe(second.instances[0]!.id);
  });

  it("carries the weapon's pierce budget onto the instance", () => {
    const { instances } = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 0);
    expect(instances[0]!.pierceLeft).toBe(0);
  });
});

describe("projectile flight", () => {
  it("moves along its own frozen heading and accumulates distance", () => {
    const { instances } = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 0);
    const stepped = stepInstance(instances[0]!, ctx());
    expect(stepped.x).toBeCloseTo(instances[0]!.x + 900 * DT);
    expect(stepped.distance).toBeCloseTo(900 * DT);
  });

  it("ignores the owner's pose, even when the owner turns", () => {
    const { instances } = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 0);
    const stepped = stepInstance(instances[0]!, ctx({ ownerPose: { x: 0, y: 0, angle: Math.PI } }));
    expect(stepped.angle).toBe(instances[0]!.angle);
    expect(stepped.x).toBeGreaterThan(instances[0]!.x);
  });

  it("expires once it has travelled its range", () => {
    const { instances } = spawnInstances({ weaponId: "cannon", slot: 0 }, owner, 100, 0);
    const spent: WeaponInstance = { ...instances[0]!, distance: 900 };
    const short: WeaponInstance = { ...instances[0]!, distance: 899 };
    expect(instanceExpired(spent, 130)).toBe(true);
    expect(instanceExpired(short, 130)).toBe(false);
  });
});

describe("wall clipping", () => {
  it("stops a beam at the first obstacle down its centre axis", () => {
    const box = { x: 700, y: 250, w: 100, h: 100 };
    expect(wallClipDistance(500, 300, 0, 600, [box], BOUNDS)).toBeCloseTo(200, 0);
  });

  it("stops a beam at the arena edge", () => {
    expect(wallClipDistance(1900, 300, 0, 600, [], BOUNDS)).toBeCloseTo(100, 0);
  });

  it("returns the full range when nothing is in the way", () => {
    expect(wallClipDistance(500, 300, 0, 600, [], BOUNDS)).toBe(600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- instances`
Expected: FAIL — cannot resolve `./instances.js`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/sim/weapons/instances.ts
import { DRIVE_CONFIG } from "../../config/drive-config.js";
import { WEAPON_TABLE } from "../../config/weapon-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import type { WeaponId } from "../../config/weapon-types.js";
import { pointInAabb, type Aabb, type Bounds } from "../collide.js";

/**
 * One live hitbox in the world. Projectiles use `x/y/angle/distance`; beams use `x/y/angle` as the
 * ORIGIN and `extent` as the current reach.
 *
 * `damageClock` is server-only bookkeeping (target -> next tick it may be damaged again) and is
 * never networked; it dies with the instance.
 */
export interface WeaponInstance {
  id: string;
  ownerSessionId: string;
  weaponId: WeaponId;
  kind: "projectile" | "beam";
  x: number;
  y: number;
  angle: number;
  extent: number;
  spawnTick: number;
  distance: number;
  pierceLeft: number;
  attached: boolean;
  damageClock: Map<string, number>;
  alive: boolean;
}

/** One group of instances to emit: which weapon, from which slot. */
export interface ShotOrder {
  weaponId: WeaponId;
  slot: number;
}

export interface OwnerPose {
  x: number;
  y: number;
  angle: number;
}

export interface StepInstanceContext {
  dt: number;
  tick: number;
  obstacles: readonly Aabb[];
  bounds: Bounds;
  /** The owner's current pose, for an attached beam. `null` for everything else. */
  ownerPose: OwnerPose | null;
}

/** How far ahead of the car's centre an instance is born: the front face of its hull. */
export function muzzleOffset(): number {
  return DRIVE_CONFIG.carWidth / 2;
}

/** Step length of the wall raycast, in world units. Finer than the thinnest sane obstacle. */
export const MUZZLE_STEP_UNITS = 4;

/**
 * Emit one order's instances from the owner's pose AT THIS TICK — a shot is aimed by where the car
 * is when it exits, not where it was when the key went down (D3), which is what makes a sequential
 * burst steerable.
 *
 * Pellets are fanned evenly and symmetrically about the heading; a single-pellet volley gets no
 * offset at all.
 */
export function spawnInstances(
  order: ShotOrder,
  owner: { sessionId: string } & OwnerPose,
  tick: number,
  seq: number,
): { instances: WeaponInstance[]; seq: number } {
  const def = WEAPON_TABLE[order.weaponId];
  const pellets = def.kind === "projectile" ? def.volley.pelletsPerVolley : 1;
  const spread = def.kind === "projectile" ? (def.volley.spreadAngleDeg * Math.PI) / 180 : 0;
  const nose = muzzleOffset();

  const instances: WeaponInstance[] = [];
  let next = seq;
  for (let i = 0; i < pellets; i++) {
    const offset = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5) * spread;
    const angle = owner.angle + offset;
    next += 1;
    instances.push({
      id: `${owner.sessionId}-${next}`,
      ownerSessionId: owner.sessionId,
      weaponId: order.weaponId,
      kind: def.kind,
      x: owner.x + Math.cos(owner.angle) * nose,
      y: owner.y + Math.sin(owner.angle) * nose,
      angle,
      extent: 0,
      spawnTick: tick,
      distance: 0,
      pierceLeft: def.kind === "projectile" ? def.pierce : 0,
      attached: def.kind === "beam" ? def.attached : false,
      damageClock: new Map(),
      alive: true,
    });
  }
  return { instances, seq: next };
}

/**
 * One tick of existence. Pure: the input is never mutated.
 *
 * A projectile integrates a straight line from its own frozen heading and never reads its owner. A
 * beam grows toward `min(range, wall)` and then holds; an attached beam re-reads its owner's pose
 * and re-runs the wall clip every tick, which is what lets it be swept by turning.
 */
export function stepInstance(instance: WeaponInstance, ctx: StepInstanceContext): WeaponInstance {
  const def = WEAPON_TABLE[instance.weaponId];

  if (instance.kind === "projectile") {
    const step = def.speed * ctx.dt;
    return {
      ...instance,
      x: instance.x + Math.cos(instance.angle) * step,
      y: instance.y + Math.sin(instance.angle) * step,
      distance: instance.distance + step,
    };
  }

  const origin =
    instance.attached && ctx.ownerPose
      ? {
          x: ctx.ownerPose.x + Math.cos(ctx.ownerPose.angle) * muzzleOffset(),
          y: ctx.ownerPose.y + Math.sin(ctx.ownerPose.angle) * muzzleOffset(),
          angle: ctx.ownerPose.angle,
        }
      : { x: instance.x, y: instance.y, angle: instance.angle };

  const reach = wallClipDistance(origin.x, origin.y, origin.angle, def.range, ctx.obstacles, ctx.bounds);
  return {
    ...instance,
    x: origin.x,
    y: origin.y,
    angle: origin.angle,
    extent: Math.min(reach, instance.extent + def.speed * ctx.dt),
  };
}

/**
 * Has this instance finished? A projectile dies at its range; a beam dies once it has been at full
 * extension for its linger. Obstacle and bounds death for projectiles is handled by the caller,
 * which owns the world.
 */
export function instanceExpired(instance: WeaponInstance, tick: number): boolean {
  const def = WEAPON_TABLE[instance.weaponId];
  if (instance.kind === "projectile") return instance.distance >= def.range;
  const ticks = weaponTicksOf(instance.weaponId);
  return tick - instance.spawnTick >= ticks.flight + ticks.lifetime;
}

/**
 * How far a beam may reach before level geometry stops it: a ray marched down its CENTRE AXIS
 * against obstacles and the arena edge.
 *
 * Centre-axis only, deliberately. A full polygon sweep against every obstacle for every beam every
 * tick buys precision nobody can see; the visible consequence of this simplification is that a
 * wide beam may overhang a wall's corner slightly.
 */
export function wallClipDistance(
  x: number,
  y: number,
  angle: number,
  range: number,
  obstacles: readonly Aabb[],
  bounds: Bounds,
): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let d = MUZZLE_STEP_UNITS; d <= range; d += MUZZLE_STEP_UNITS) {
    const px = x + cos * d;
    const py = y + sin * d;
    if (px < 0 || py < 0 || px > bounds.width || py > bounds.height) return d - MUZZLE_STEP_UNITS;
    for (const obstacle of obstacles) {
      if (pointInAabb(px, py, obstacle)) return d - MUZZLE_STEP_UNITS;
    }
  }
  return range;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @motor-combat-moba/shared -- instances`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/weapons/instances.ts packages/shared/src/sim/weapons/instances.test.ts
git commit -m "feat(shared): weapon instance spawning, flight, beam expansion and wall clipping"
```

---

### Task 7: Hit resolution over a pose snapshot

**Files:**
- Create: `packages/shared/src/sim/weapons/hits.ts`, `packages/shared/src/sim/weapons/targets.ts`
- Test: `packages/shared/src/sim/weapons/hits.test.ts`

**Interfaces:**
- Consumes: `WeaponInstance` (Task 6), shape helpers (Task 5), `WEAPON_TABLE`, `weaponTicksOf`.
- Produces:
  - `canDamage(ownerId, ownerTeam, targetId, targetTeam, mode)` — moved verbatim from `sim/projectiles.ts`
  - `PoseEntry` — `{ sessionId: string; team: 0 | 1; hull: Obb }`
  - `PoseSnapshot` — `readonly PoseEntry[]`, sorted by `sessionId`
  - `HitOutcome` — `{ instance: WeaponInstance; damaged: { sessionId: string; amount: number }[] }`
  - `resolveInstanceHits(instance, previous, snapshot, mode, tick): HitOutcome`

**Context:** D9, D10, D20. **`hits.ts` must never import player state or reach outside its arguments** — that is the lag-compensation seam.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/sim/weapons/hits.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WEAPON_TABLE } from "../../config/weapon-config.js";
import { carHullOf } from "../context.js";
import { spawnInstances, stepInstance, type WeaponInstance } from "./instances.js";
import { resolveInstanceHits, type PoseSnapshot } from "./hits.js";

const BOUNDS = { width: 2000, height: 1200 };
const DT = 1 / 30;

const snapshot = (
  entries: { sessionId: string; team?: 0 | 1; x: number; y: number }[],
): PoseSnapshot =>
  entries
    .map((e) => ({ sessionId: e.sessionId, team: e.team ?? 0, hull: carHullOf(e.x, e.y, 0) }))
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1));

function shotFrom(x: number, y: number, angle = 0): WeaponInstance {
  return spawnInstances({ weaponId: "cannon", slot: 0 }, { sessionId: "aaa", x, y, angle }, 100, 0)
    .instances[0]!;
}

describe("hit resolution", () => {
  it("damages a car the shot has reached", () => {
    const shot = shotFrom(400, 300);
    const moved = stepInstance(shot, { dt: DT, tick: 101, obstacles: [], bounds: BOUNDS, ownerPose: null });
    const out = resolveInstanceHits(moved, shot, snapshot([{ sessionId: "bbb", x: 434, y: 300 }]), "ffa", 101);
    expect(out.damaged).toEqual([{ sessionId: "bbb", amount: WEAPON_TABLE.cannon.damage }]);
  });

  it("never damages the shooter", () => {
    const shot = shotFrom(400, 300);
    const out = resolveInstanceHits(shot, shot, snapshot([{ sessionId: "aaa", x: 424, y: 300 }]), "ffa", 100);
    expect(out.damaged).toEqual([]);
  });

  it("passes through a teammate in team mode without spending pierce", () => {
    const shot = { ...shotFrom(400, 300), pierceLeft: 0 };
    const out = resolveInstanceHits(
      shot,
      shot,
      snapshot([{ sessionId: "bbb", team: 0, x: 424, y: 300 }]),
      "team",
      100,
    );
    expect(out.damaged).toEqual([]);
    expect(out.instance.alive).toBe(true);
    expect(out.instance.pierceLeft).toBe(0);
  });

  it("dies on the first car it damages when pierce is 0", () => {
    const shot = shotFrom(400, 300);
    const out = resolveInstanceHits(shot, shot, snapshot([{ sessionId: "bbb", x: 424, y: 300 }]), "ffa", 100);
    expect(out.instance.alive).toBe(false);
  });

  it("spends one pierce per car and keeps flying while budget remains", () => {
    const shot = { ...shotFrom(400, 300), pierceLeft: 1 };
    const two = snapshot([
      { sessionId: "bbb", x: 424, y: 300 },
      { sessionId: "ccc", x: 424, y: 300 },
    ]);
    const out = resolveInstanceHits(shot, shot, two, "ffa", 100);
    expect(out.damaged).toHaveLength(2);
    expect(out.instance.alive).toBe(false); // budget of 1 = two cars total
  });

  it("damages a given car once per instance when damageFrequencyMs is 0", () => {
    const shot = { ...shotFrom(400, 300), pierceLeft: 5 };
    const target = snapshot([{ sessionId: "bbb", x: 424, y: 300 }]);
    const first = resolveInstanceHits(shot, shot, target, "ffa", 100);
    const second = resolveInstanceHits(first.instance, shot, target, "ffa", 101);
    expect(first.damaged).toHaveLength(1);
    expect(second.damaged).toEqual([]);
  });

  it("resolves overlapping targets in sorted sessionId order", () => {
    const shot = shotFrom(400, 300);
    const overlapping = snapshot([
      { sessionId: "zzz", x: 424, y: 300 },
      { sessionId: "bbb", x: 424, y: 300 },
    ]);
    const out = resolveInstanceHits(shot, shot, overlapping, "ffa", 100);
    expect(out.damaged[0]!.sessionId).toBe("bbb");
  });

  it("does not mutate the instance it is given", () => {
    const shot = shotFrom(400, 300);
    const before = JSON.stringify({ ...shot, damageClock: [...shot.damageClock] });
    resolveInstanceHits(shot, shot, snapshot([{ sessionId: "bbb", x: 424, y: 300 }]), "ffa", 100);
    expect(JSON.stringify({ ...shot, damageClock: [...shot.damageClock] })).toBe(before);
  });
});

describe("the lag-compensation seam", () => {
  it("reads nothing but its arguments — no player-state imports", () => {
    const source = readFileSync(new URL("./hits.ts", import.meta.url), "utf8");
    expect(source).not.toContain("CombatPlayer");
    expect(source).not.toContain("PlayerState");
    expect(source).not.toMatch(/from "\.\.\/combat\.js"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- hits`
Expected: FAIL — cannot resolve `./hits.js`.

- [ ] **Step 3: Move `canDamage` into `targets.ts`**

Create `packages/shared/src/sim/weapons/targets.ts` containing `canDamage` copied **verbatim** (including its doc comment) from `packages/shared/src/sim/projectiles.ts`. Leave `projectiles.ts` in place for now; Task 8 deletes it.

- [ ] **Step 4: Implement `hits.ts`**

```ts
// packages/shared/src/sim/weapons/hits.ts
import { WEAPON_TABLE } from "../../config/weapon-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import type { Obb } from "../collide.js";
import type { WeaponInstance } from "./instances.js";
import { beamShapeAt, projectileShapeAt, shapeHitsObb, smear } from "./shapes.js";
import { canDamage } from "./targets.js";

/** One damageable car as the hit test sees it. Poses only — no hp, no status, no schema. */
export interface PoseEntry {
  sessionId: string;
  team: 0 | 1;
  hull: Obb;
}

/**
 * Everyone a hit may land on this tick, sorted by `sessionId`.
 *
 * This is the lag-compensation seam (D20). Hit testing is a pure function of an instance and a
 * snapshot, so adding rewind later means passing a snapshot rebuilt from a pose history — a
 * call-site change, not a refactor of every hit path. Nothing in this module may read player state.
 */
export type PoseSnapshot = readonly PoseEntry[];

export interface HitOutcome {
  /** The instance after the tick: pierce spent, damage clocks armed, possibly dead. */
  instance: WeaponInstance;
  /** Damage to apply, in resolution order. The caller owns hp. */
  damaged: { sessionId: string; amount: number }[];
}

/**
 * Every car this instance damages on this tick.
 *
 * Projectiles are tested as the SMEAR between `previous` and `instance`, so a fast shot cannot
 * straddle a car between samples. Beams are tested at their current extent and are never destroyed
 * by contact — they may catch several cars at once.
 */
export function resolveInstanceHits(
  instance: WeaponInstance,
  previous: WeaponInstance,
  snapshot: PoseSnapshot,
  mode: "ffa" | "team",
  tick: number,
): HitOutcome {
  const def = WEAPON_TABLE[instance.weaponId];
  const interval = weaponTicksOf(instance.weaponId).damageInterval;

  const shape =
    instance.kind === "projectile"
      ? smear(
          projectileShapeAt(def.hitbox as never, previous.x, previous.y, previous.angle),
          projectileShapeAt(def.hitbox as never, instance.x, instance.y, instance.angle),
        )
      : beamShapeAt(def.hitbox as never, instance.x, instance.y, instance.angle, instance.extent);

  const clock = new Map(instance.damageClock);
  const damaged: { sessionId: string; amount: number }[] = [];
  let pierceLeft = instance.pierceLeft;
  let alive = instance.alive;

  const ownerTeam = snapshot.find((e) => e.sessionId === instance.ownerSessionId)?.team ?? 0;

  for (const entry of snapshot) {
    if (!alive) break;
    // Teammates, wrecks and the shooter are not contacts at all: the instance passes through them
    // freely and they consume no pierce.
    if (!canDamage(instance.ownerSessionId, ownerTeam, entry.sessionId, entry.team, mode)) continue;
    if (tick < (clock.get(entry.sessionId) ?? 0)) continue;
    if (!shapeHitsObb(shape, entry.hull)) continue;

    damaged.push({ sessionId: entry.sessionId, amount: def.damage });
    clock.set(entry.sessionId, interval === Number.POSITIVE_INFINITY ? interval : tick + interval);

    if (instance.kind !== "projectile") continue;
    if (pierceLeft <= 0) alive = false;
    else pierceLeft -= 1;
  }

  return { instance: { ...instance, damageClock: clock, pierceLeft, alive }, damaged };
}

export { canDamage };
```

- [ ] **Step 5: Run tests**

Run: `npm test -w @motor-combat-moba/shared -- hits`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/weapons/hits.ts packages/shared/src/sim/weapons/targets.ts packages/shared/src/sim/weapons/hits.test.ts
git commit -m "feat(shared): resolve weapon hits against a pose snapshot"
```

---

### Task 8: The fire state machine

**Files:**
- Create: `packages/shared/src/sim/weapons/fire.ts`
- Test: `packages/shared/src/sim/weapons/fire.test.ts`

**Interfaces:**
- Consumes: `WEAPON_TABLE`, `weaponTicksOf`, `slotsOf`, `WEAPON_SLOT_CONFIG`, `ShotOrder` (Task 6).
- Produces:
  - `SlotState` — `{ weaponId: WeaponId; stocks: number; rechargeEndsTick: number; refireLockUntilTick: number }`
  - `PendingFire` — `{ weaponId: WeaponId; slot: number; shotsLeft: number; nextShotTick: number }`
  - `FireState` — `{ slots: SlotState[]; switchLockUntilTick: number; lastFiredWeaponId: string; pending: PendingFire | null; level: number }`
  - `newFireState(carId: CarId | "", level: number): FireState`
  - `tickRecharge(state: FireState, tick: number): FireState`
  - `releaseShots(state: FireState, tick: number): { state: FireState; orders: ShotOrder[] }`
  - `beginFire(state: FireState, mask: number, tick: number): FireState`
  - `cancelPending(state: FireState): FireState`

**Context:** D2, D3, D4, D5, D12, D14. Order per tick is recharge → release → begin.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/sim/weapons/fire.test.ts
import { describe, expect, it } from "vitest";
import { beginFire, cancelPending, newFireState, releaseShots, tickRecharge, type FireState } from "./fire.js";

const SLOT_1 = 0b001;
const SLOT_2 = 0b010;

/** A cannon-only car, as shipped. */
const fresh = () => newFireState("rectangle", 1);

/** Drive a state forward n ticks of pure recharge. */
function idle(state: FireState, from: number, ticks: number): FireState {
  let next = state;
  for (let t = from; t < from + ticks; t++) next = tickRecharge(next, t);
  return next;
}

describe("slots", () => {
  it("starts with one stock in every slot", () => {
    const state = fresh();
    expect(state.slots).toHaveLength(1);
    expect(state.slots[0]!.weaponId).toBe("cannon");
    expect(state.slots[0]!.stocks).toBe(1);
  });

  it("gives a player with no car no slots at all", () => {
    expect(newFireState("", 1).slots).toEqual([]);
  });
});

describe("pressing", () => {
  it("schedules a shot and spends a stock immediately", () => {
    const state = beginFire(fresh(), SLOT_1, 100);
    expect(state.pending).toEqual({ weaponId: "cannon", slot: 0, shotsLeft: 1, nextShotTick: 100 });
    expect(state.slots[0]!.stocks).toBe(0);
  });

  it("ignores a press for a slot the car does not have", () => {
    expect(beginFire(fresh(), SLOT_2, 100).pending).toBeNull();
  });

  it("ignores a press with no stock left", () => {
    const spent = beginFire(fresh(), SLOT_1, 100);
    const released = releaseShots(spent, 100).state;
    expect(beginFire(released, SLOT_1, 101).pending).toBeNull();
  });

  it("fires the lowest pressed slot when two arrive on one tick", () => {
    const twoSlot = newFireState("rectangle", 1);
    twoSlot.slots.push({ ...twoSlot.slots[0]!, weaponId: "cannon" });
    const state = beginFire(twoSlot, SLOT_1 | SLOT_2, 100);
    expect(state.pending!.slot).toBe(0);
  });

  it("refuses a weapon whose unlocksAt is above the player's level", () => {
    const locked = newFireState("rectangle", 0); // level below every weapon's unlocksAt
    expect(beginFire(locked, SLOT_1, 100).pending).toBeNull();
  });

  it("ignores every press while a shot is already pending", () => {
    const winding: FireState = { ...fresh(), pending: { weaponId: "cannon", slot: 0, shotsLeft: 1, nextShotTick: 105 } };
    expect(beginFire(winding, SLOT_1, 100).pending!.nextShotTick).toBe(105);
  });
});

describe("releasing", () => {
  it("emits the order on the scheduled tick and starts the recharge", () => {
    const pressed = beginFire(fresh(), SLOT_1, 100);
    const { state, orders } = releaseShots(pressed, 100);
    expect(orders).toEqual([{ weaponId: "cannon", slot: 0 }]);
    expect(state.pending).toBeNull();
    expect(state.slots[0]!.rechargeEndsTick).toBe(115); // 500ms == 15 ticks
    expect(state.lastFiredWeaponId).toBe("cannon");
  });

  it("emits nothing before the scheduled tick", () => {
    const pressed = beginFire(fresh(), SLOT_1, 100);
    expect(releaseShots(pressed, 99).orders).toEqual([]);
  });
});

describe("stocks", () => {
  /** A three-stock, three-second weapon, exactly the worked example in the spec. */
  const stocked = (): FireState => ({
    slots: [{ weaponId: "cannon", stocks: 1, rechargeEndsTick: 190, refireLockUntilTick: 0 }],
    switchLockUntilTick: 0,
    lastFiredWeaponId: "",
    pending: null,
    level: 1,
  });

  it("adds a stock when the timer completes and restarts while below max", () => {
    const state = tickRecharge({ ...stocked() }, 190);
    expect(state.slots[0]!.stocks).toBe(2);
    expect(state.slots[0]!.rechargeEndsTick).toBeGreaterThan(190);
  });

  it("clears the timer at max stocks rather than banking progress", () => {
    const nearlyFull: FireState = {
      ...stocked(),
      slots: [{ weaponId: "cannon", stocks: 2, rechargeEndsTick: 190, refireLockUntilTick: 0 }],
    };
    const full = tickRecharge(nearlyFull, 190);
    expect(full.slots[0]!.stocks).toBe(3);
    expect(full.slots[0]!.rechargeEndsTick).toBe(0);
  });

  it("starts a fresh full timer when firing from max, however long it sat full", () => {
    const full: FireState = {
      ...stocked(),
      slots: [{ weaponId: "cannon", stocks: 3, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
    };
    const waited = idle(full, 200, 500);
    const fired = releaseShots(beginFire(waited, SLOT_1, 700), 700).state;
    expect(fired.slots[0]!.rechargeEndsTick).toBe(715); // a whole cooldown, not a shortened one
  });

  it("leaves a running timer untouched when firing below max", () => {
    const running = stocked();
    const fired = releaseShots(beginFire(running, SLOT_1, 100), 100).state;
    expect(fired.slots[0]!.rechargeEndsTick).toBe(190); // the in-flight timer keeps its remaining time
  });
});

describe("the two lockouts", () => {
  it("blocks a different weapon for recovery while allowing the same one after its refire delay", () => {
    // cooldown 3s (90 ticks), recovery 5s (150 ticks), refire delay 0, 2 stocks banked.
    const state: FireState = {
      slots: [
        { weaponId: "cannon", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 },
        { weaponId: "cannon", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
      ],
      switchLockUntilTick: 250,
      lastFiredWeaponId: "cannon",
      pending: null,
      level: 1,
    };
    // Slot 2 holds a different LAST-FIRED identity only via lastFiredWeaponId; the switch lock gates it.
    expect(beginFire(state, SLOT_1, 200).pending).not.toBeNull(); // same weapon: allowed
    expect(beginFire({ ...state, lastFiredWeaponId: "other" }, SLOT_1, 200).pending).toBeNull();
  });
});

describe("cancelling", () => {
  it("drops a pending burst, as a wreck does mid-volley", () => {
    const pressed = beginFire(fresh(), SLOT_1, 100);
    expect(cancelPending(pressed).pending).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- fire`
Expected: FAIL — cannot resolve `./fire.js`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/sim/weapons/fire.ts
import { isCarId } from "../../config/car-config.js";
import type { CarId } from "../../config/types.js";
import { WEAPON_TABLE } from "../../config/weapon-config.js";
import { WEAPON_SLOT_CONFIG, slotsOf } from "../../config/weapon-slots.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import type { WeaponId } from "../../config/weapon-types.js";
import type { ShotOrder } from "./instances.js";

export interface SlotState {
  weaponId: WeaponId;
  stocks: number;
  /** Tick the running recharge completes. 0 = not recharging (at max, or nothing to recharge). */
  rechargeEndsTick: number;
  /** Tick this weapon may fire again. Only ever set by a weapon with a `stock` block. */
  refireLockUntilTick: number;
}

/** A committed press: the wind-up, then one order per remaining volley. */
export interface PendingFire {
  weaponId: WeaponId;
  slot: number;
  shotsLeft: number;
  nextShotTick: number;
}

export interface FireState {
  slots: SlotState[];
  /** Tick a DIFFERENT weapon may fire. */
  switchLockUntilTick: number;
  lastFiredWeaponId: string;
  pending: PendingFire | null;
  /** In-match level. Pinned to 1 until the level system exists (D14). */
  level: number;
}

/**
 * A car's slots at spawn: one stock each, no locks. A player with no chassis — pre-reveal, or an
 * unrecognised `carId` on the wire — gets no slots and can fire nothing, the same gate the old
 * `carId === ""` check applied.
 */
export function newFireState(carId: CarId | "", level: number): FireState {
  const weapons = isCarId(carId) ? slotsOf(carId) : [];
  return {
    slots: weapons.map((weaponId) => ({
      weaponId,
      stocks: 1,
      rechargeEndsTick: 0,
      refireLockUntilTick: 0,
    })),
    switchLockUntilTick: 0,
    lastFiredWeaponId: "",
    pending: null,
    level,
  };
}

/**
 * Stock recharge, run first each tick so a slot whose timer completes on this tick may fire on it.
 *
 * At max stocks the timer is CLEARED rather than left running: no progress is banked, so firing
 * from max always costs a whole fresh cooldown however long the weapon sat full.
 */
export function tickRecharge(state: FireState, tick: number): FireState {
  return {
    ...state,
    slots: state.slots.map((slot) => {
      const def = WEAPON_TABLE[slot.weaponId];
      const max = def.stock?.max ?? 1;
      if (slot.stocks >= max) return slot.rechargeEndsTick === 0 ? slot : { ...slot, rechargeEndsTick: 0 };
      if (slot.rechargeEndsTick === 0) {
        return { ...slot, rechargeEndsTick: tick + weaponTicksOf(slot.weaponId).cooldown };
      }
      if (tick < slot.rechargeEndsTick) return slot;

      const stocks = slot.stocks + 1;
      return {
        ...slot,
        stocks,
        rechargeEndsTick: stocks >= max ? 0 : tick + weaponTicksOf(slot.weaponId).cooldown,
      };
    }),
  };
}

/**
 * Emit whatever is scheduled for this tick. Returns the orders for the caller to turn into
 * instances from the car's pose AT THIS TICK, which is what makes a burst steerable.
 *
 * The recharge and both locks are set from the LAST shot of a volley, so `cooldownMs` keeps meaning
 * "time until another stock" rather than partly serving its own burst.
 */
export function releaseShots(state: FireState, tick: number): { state: FireState; orders: ShotOrder[] } {
  const pending = state.pending;
  if (!pending || pending.nextShotTick !== tick) return { state, orders: [] };

  const ticks = weaponTicksOf(pending.weaponId);
  const orders: ShotOrder[] = [{ weaponId: pending.weaponId, slot: pending.slot }];
  const shotsLeft = pending.shotsLeft - 1;

  if (shotsLeft > 0) {
    return {
      state: {
        ...state,
        pending: { ...pending, shotsLeft, nextShotTick: tick + Math.max(1, ticks.volleyInterval) },
      },
      orders,
    };
  }

  const slots = state.slots.map((slot, index) => {
    if (index !== pending.slot) return slot;
    const max = WEAPON_TABLE[slot.weaponId].stock?.max ?? 1;
    return {
      ...slot,
      // Only start a timer that is not already running: a shot fired below max leaves the in-flight
      // recharge alone rather than restarting it.
      rechargeEndsTick:
        slot.stocks >= max ? 0 : slot.rechargeEndsTick === 0 ? tick + ticks.cooldown : slot.rechargeEndsTick,
      refireLockUntilTick: tick + ticks.refireDelay,
    };
  });

  return {
    state: {
      ...state,
      slots,
      pending: null,
      lastFiredWeaponId: pending.weaponId,
      switchLockUntilTick: tick + ticks.recovery,
    },
    orders,
  };
}

/**
 * Resolve this tick's presses. `mask` is the slot bitmask from the wire (bit 0 = slot 1); the
 * lowest set bit the car can actually use wins.
 *
 * A press is a commitment: the stock is spent here, at press time, because a wind-up cannot be
 * cancelled. Nothing is queued — a press that cannot fire is dropped.
 */
export function beginFire(state: FireState, mask: number, tick: number): FireState {
  if (state.pending) return state;
  if (mask <= 0) return state;

  const usable = Math.min(state.slots.length, WEAPON_SLOT_CONFIG.maxWeaponSlots);
  for (let index = 0; index < usable; index++) {
    if ((mask & (1 << index)) === 0) continue;

    const slot = state.slots[index]!;
    const def = WEAPON_TABLE[slot.weaponId];
    if (def.unlocksAt > state.level) continue;
    if (slot.stocks < 1) continue;

    const sameWeapon = state.lastFiredWeaponId === slot.weaponId;
    if (sameWeapon && tick < slot.refireLockUntilTick) continue;
    if (!sameWeapon && tick < state.switchLockUntilTick) continue;

    const volleys = def.kind === "projectile" ? def.volley.volleys : 1;
    return {
      ...state,
      slots: state.slots.map((s, i) => (i === index ? { ...s, stocks: s.stocks - 1 } : s)),
      pending: {
        weaponId: slot.weaponId,
        slot: index,
        shotsLeft: volleys,
        nextShotTick: tick + weaponTicksOf(slot.weaponId).startUp,
      },
    };
  }
  return state;
}

/** Drop a scheduled burst — a wreck does not finish firing. */
export function cancelPending(state: FireState): FireState {
  return state.pending === null ? state : { ...state, pending: null };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @motor-combat-moba/shared -- fire`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/weapons/fire.ts packages/shared/src/sim/weapons/fire.test.ts
git commit -m "feat(shared): per-car weapon fire state machine with stocks and two lockouts"
```

---

### Task 9: Rewire `runCombat` onto the weapon modules

**Files:**
- Modify: `packages/shared/src/sim/combat.ts`
- Delete: `packages/shared/src/sim/projectiles.ts`
- Modify: `packages/shared/src/sim/combat.test.ts`, `packages/shared/src/index.ts`, `packages/shared/src/config/weapon-config.ts` (drop `WEAPON_CONFIG`)
- Test: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–8.
- Produces: `CombatPlayer` gains `fireState: FireState` and `fireMask: number`, loses `weaponCooldown` and `fired`. `CombatInput.projectiles` → `CombatInput.instances: readonly WeaponInstance[]`; `projectileSeq` → `instanceSeq`. `CombatResult` mirrors it. `runCombat` unchanged in name and role.

**Context:** D3, D11, D21. Ramming code inside `runCombat` must be preserved byte-for-byte apart from the rename of the projectile phase.

- [ ] **Step 1: Write the failing tests**

Rewrite the `firing`, `shots in flight` and `shots landing` blocks of `packages/shared/src/sim/combat.test.ts` against the new input shape. Keep every `ramming` and `ramming, driven through the real sim` block untouched. Add:

```ts
// packages/shared/src/sim/combat.test.ts (new/changed cases)
import { newFireState } from "./weapons/fire.js";
import { WEAPON_TABLE } from "../config/weapon-config.js";

function player(over: Partial<CombatPlayer> = {}): CombatPlayer {
  return {
    sessionId: "aaa",
    x: 300,
    y: OPEN_Y,
    angle: 0,
    team: 0,
    carId: "rectangle",
    hp: hpOf("rectangle"),
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState: newFireState("rectangle", 1),
    ...over,
  };
}

describe("firing", () => {
  it("spawns one instance at the muzzle when slot 1 is pressed", () => {
    const result = runCombat({
      world: world(),
      players: [player({ fireMask: 0b001 })],
      instances: [],
      ramCooldowns: new Map(),
      instanceSeq: 0,
    });
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]!.weaponId).toBe("cannon");
  });

  it("does not fire again inside the cooldown, held or tapped", () => {
    let state = { world: world(), players: [player({ fireMask: 0b001 })], instances: [], ramCooldowns: new Map(), instanceSeq: 0 };
    const first = runCombat(state);
    const second = runCombat({
      world: world({ tick: 101 }),
      players: first.players.map((p) => ({ ...p, fireMask: 0b001 })),
      instances: first.instances,
      ramCooldowns: first.ramCooldowns,
      instanceSeq: first.instanceSeq,
    });
    expect(second.instances.filter((i) => i.spawnTick === 101)).toHaveLength(0);
  });

  it("fires nothing for a player with no chassis", () => {
    const result = runCombat({
      world: world(),
      players: [player({ carId: "", fireState: newFireState("", 1), fireMask: 0b001 })],
      instances: [],
      ramCooldowns: new Map(),
      instanceSeq: 0,
    });
    expect(result.instances).toEqual([]);
  });

  it("cancels a wrecked player's pending burst and kills their attached beams", () => {
    const wrecked = player({ hp: 0, alive: false, fireState: { ...newFireState("rectangle", 1), pending: { weaponId: "cannon", slot: 0, shotsLeft: 2, nextShotTick: 100 } } });
    const result = runCombat({
      world: world(),
      players: [wrecked],
      instances: [],
      ramCooldowns: new Map(),
      instanceSeq: 0,
    });
    expect(result.players[0]!.fireState.pending).toBeNull();
    expect(result.instances).toEqual([]);
  });

  it("still lands the migrated cannon's damage on a car in front", () => {
    const shooter = player({ sessionId: "aaa", x: 300, fireMask: 0b001 });
    const target = player({ sessionId: "bbb", x: 300 + 34, fireMask: 0 });
    const result = runCombat({
      world: world(),
      players: [shooter, target],
      instances: [],
      ramCooldowns: new Map(),
      instanceSeq: 0,
    });
    const hit = result.players.find((p) => p.sessionId === "bbb")!;
    expect(hit.hp).toBe(hpOf("rectangle") - WEAPON_TABLE.cannon.damage);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @motor-combat-moba/shared -- combat`
Expected: FAIL — `instances`/`fireMask`/`fireState` are not on the combat types.

- [ ] **Step 3: Rewrite `combat.ts`**

Replace the projectile phase. Keep the ramming half exactly as it is. New shape:

```ts
// packages/shared/src/sim/combat.ts (structure; ramming block unchanged)
import { carHullOf, carIdOf } from "./context.js";
import { applyDamage } from "./damage.js";
import { cancelPending, beginFire, releaseShots, tickRecharge, type FireState } from "./weapons/fire.js";
import { instanceExpired, spawnInstances, stepInstance, type WeaponInstance } from "./weapons/instances.js";
import { resolveInstanceHits, type PoseSnapshot } from "./weapons/hits.js";
import { WEAPON_TABLE } from "../config/weapon-config.js";
import { pointInAabb } from "./collide.js";

export interface CombatPlayer {
  sessionId: string;
  x: number;
  y: number;
  angle: number;
  team: 0 | 1;
  carId: string;
  hp: number;
  alive: boolean;
  inRoster: boolean;
  /** Slot bitmask from an input the server actually simulated this tick. Bit 0 = slot 1. */
  fireMask: number;
  fireState: FireState;
}

export interface CombatInput {
  world: CombatWorld;
  players: readonly CombatPlayer[];
  instances: readonly WeaponInstance[];
  ramCooldowns: ReadonlyMap<string, number>;
  instanceSeq: number;
}

export interface CombatResult {
  players: CombatPlayer[];
  instances: WeaponInstance[];
  ramCooldowns: Map<string, number>;
  instanceSeq: number;
}

export function runCombat(input: CombatInput): CombatResult {
  const { world } = input;
  const players = input.players
    .map((p) => ({ ...p, fireState: { ...p.fireState, slots: p.fireState.slots.map((s) => ({ ...s })) } }))
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  const byId = new Map(players.map((p) => [p.sessionId, p]));
  let instanceSeq = input.instanceSeq;

  // 1. Recharge first, so a stock that lands this tick can be spent this tick.
  for (const player of players) {
    if (!isFighting(player)) {
      player.fireState = cancelPending(player.fireState);
      continue;
    }
    player.fireState = tickRecharge(player.fireState, world.tick);
  }

  // 2. Existing instances step BEFORE new ones are born, so a fresh shot draws at the muzzle
  //    rather than a tick's travel beyond it. Preserved from the pre-weapon-system behaviour.
  const previous = new Map(input.instances.map((i) => [i.id, i]));
  const stepped: WeaponInstance[] = [];
  for (const instance of input.instances) {
    const owner = byId.get(instance.ownerSessionId);
    // An attached beam dies with its owner: a wreck does not shoot. Everything already frozen at
    // birth — projectiles, detached beams — finishes its life regardless.
    if (instance.attached && (!owner || !isFighting(owner))) continue;
    stepped.push(
      stepInstance(instance, {
        dt: world.dt,
        tick: world.tick,
        obstacles: world.obstacles,
        bounds: world.bounds,
        ownerPose: owner ? { x: owner.x, y: owner.y, angle: owner.angle } : null,
      }),
    );
  }

  // 3. Scheduled shots, then new presses.
  for (const player of players) {
    if (!isFighting(player)) continue;
    const released = releaseShots(player.fireState, world.tick);
    player.fireState = released.state;
    for (const order of released.orders) {
      const spawned = spawnInstances(order, player, world.tick, instanceSeq);
      instanceSeq = spawned.seq;
      stepped.push(...spawned.instances);
    }
    player.fireState = beginFire(player.fireState, player.fireMask, world.tick);
  }

  // 4. Hits, against a snapshot rather than player state (the lag-compensation seam).
  const snapshot: PoseSnapshot = players
    .filter(isFighting)
    .map((p) => ({ sessionId: p.sessionId, team: p.team, hull: carHullOf(p.x, p.y, p.angle) }));

  const survivors: WeaponInstance[] = [];
  for (const instance of stepped) {
    if (instanceExpired(instance, world.tick)) continue;
    if (instance.kind === "projectile" && hitsWorld(instance, world)) continue;

    const outcome = resolveInstanceHits(
      instance,
      previous.get(instance.id) ?? instance,
      snapshot,
      world.mode,
      world.tick,
    );
    for (const hit of outcome.damaged) {
      const target = byId.get(hit.sessionId);
      if (target) damage(target, hit.amount);
    }
    if (outcome.instance.alive) survivors.push(outcome.instance);
  }

  // 5. Ramming — unchanged from here down.
  // ... existing ram block verbatim, using `players`, `byId`, `world` ...

  return { players, instances: survivors, ramCooldowns, instanceSeq };
}

/** A projectile that has left the arena or entered level geometry is spent, whatever its pierce. */
function hitsWorld(instance: WeaponInstance, world: CombatWorld): boolean {
  if (instance.x < 0 || instance.y < 0 || instance.x > world.bounds.width || instance.y > world.bounds.height) {
    return true;
  }
  for (const obstacle of world.obstacles) {
    if (pointInAabb(instance.x, instance.y, obstacle)) return true;
  }
  return false;
}
```

Delete `fireCooldownTicks` and `muzzleOffset` from `combat.ts` (`muzzleOffset` now lives in `instances.ts`). Delete `packages/shared/src/sim/projectiles.ts`.

- [ ] **Step 4: Update `weapon-config.ts` and the shared index**

Remove the deprecated `WEAPON_CONFIG` export from `weapon-config.ts`. In `index.ts`: drop `WEAPON_CONFIG`, `ProjectileState`-adjacent projectile exports (`projectileExpired`, `projectileHitsCar`, `projectileHitsObstacle`, `stepProjectile`, `Proj`) and `fireCooldownTicks`/`muzzleOffset` from `./sim/combat.js`; export instead:

```ts
export { runCombat } from "./sim/combat.js";
export type { CombatInput, CombatPlayer, CombatResult, CombatWorld } from "./sim/combat.js";
export { canDamage } from "./sim/weapons/targets.js";
export {
  beginFire,
  cancelPending,
  newFireState,
  releaseShots,
  tickRecharge,
} from "./sim/weapons/fire.js";
export type { FireState, PendingFire, SlotState } from "./sim/weapons/fire.js";
export {
  instanceExpired,
  muzzleOffset,
  spawnInstances,
  stepInstance,
  wallClipDistance,
} from "./sim/weapons/instances.js";
export type { ShotOrder, WeaponInstance } from "./sim/weapons/instances.js";
export { resolveInstanceHits } from "./sim/weapons/hits.js";
export type { PoseEntry, PoseSnapshot } from "./sim/weapons/hits.js";
export { beamShapeAt, projectileShapeAt, shapeHitsObb, smear } from "./sim/weapons/shapes.js";
export type { WorldShape } from "./sim/weapons/shapes.js";
```

- [ ] **Step 5: Run the full shared suite**

Run: `npm test -w @motor-combat-moba/shared` and `npm run typecheck -w @motor-combat-moba/shared`
Expected: PASS. Server and client will not compile yet — Tasks 10–13 fix them.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "refactor(shared): run combat on the weapon module set"
```

---

### Task 10: Schema — instances, slots, and the input bitmask

**Files:**
- Create: `packages/shared/src/schema/WeaponInstanceState.ts`, `packages/shared/src/schema/WeaponSlotState.ts`
- Delete: `packages/shared/src/schema/ProjectileState.ts`
- Modify: `packages/shared/src/schema/PlayerState.ts`, `ArenaState.ts`, `packages/shared/src/constants.ts`, `packages/shared/src/net/input.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/schema/schema.test.ts`

**Interfaces:**
- Produces: `WeaponKind` enum (`PROJECTILE = 0`, `BEAM = 1`), `WeaponInstanceState`, `WeaponSlotState`, `PlayerState.weapons/switchLockUntilTick/level`, `ArenaState.weapons`, `InputMessage.fireSlots: number`.

**Context:** D15, D2. `MapSchema` keyed by id, so the bridge can diff instead of clearing.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/schema/schema.test.ts (append)
import { WeaponKind } from "../constants.js";
import { WeaponInstanceState } from "./WeaponInstanceState.js";
import { WeaponSlotState } from "./WeaponSlotState.js";
import { ArenaState } from "./ArenaState.js";
import { PlayerState } from "./PlayerState.js";

describe("weapon schema", () => {
  it("numbers weapon kinds explicitly and stably", () => {
    expect(WeaponKind.PROJECTILE).toBe(0);
    expect(WeaponKind.BEAM).toBe(1);
  });

  it("defaults an instance to a live projectile at the origin", () => {
    const instance = new WeaponInstanceState();
    expect(instance.kind).toBe(WeaponKind.PROJECTILE);
    expect(instance.extent).toBe(0);
    expect(instance.alive).toBe(true);
  });

  it("carries instances on the arena keyed by id", () => {
    const state = new ArenaState();
    const instance = new WeaponInstanceState();
    instance.id = "aaa-1";
    state.weapons.set(instance.id, instance);
    expect(state.weapons.get("aaa-1")).toBe(instance);
  });

  it("gives a player an ordered slot array and a level", () => {
    const player = new PlayerState();
    const slot = new WeaponSlotState();
    slot.weaponId = "cannon";
    slot.stocks = 1;
    player.weapons.push(slot);
    expect(player.weapons.at(0)!.weaponId).toBe("cannon");
    expect(player.level).toBe(1);
    expect(player.switchLockUntilTick).toBe(0);
  });

  it("no longer carries the single-weapon cooldown", () => {
    expect("weaponCooldown" in new PlayerState()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @motor-combat-moba/shared -- schema`
Expected: FAIL — cannot resolve `./WeaponInstanceState.js`.

- [ ] **Step 3: Implement the schema**

Add to `packages/shared/src/constants.ts`:

```ts
/** Wire discriminant for a live weapon instance. Explicit and stable — never renumber. */
export enum WeaponKind {
  PROJECTILE = 0,
  BEAM = 1,
}
```

```ts
// packages/shared/src/schema/WeaponInstanceState.ts
import { Schema, type } from "@colyseus/schema";
import { WeaponKind } from "../constants.js";

/**
 * One live hitbox as the client sees it. Deliberately minimal: speed, range, shape, dimensions,
 * colour and icon are all looked up client-side from `WEAPON_TABLE` by `weaponId`, so the row
 * carries only what cannot be derived.
 */
export class WeaponInstanceState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("string") weaponId = "";
  @type("uint8") kind: WeaponKind = WeaponKind.PROJECTILE;
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") angle = 0;
  /** Beams: current reach. Projectiles: always 0. */
  @type("number") extent = 0;
  @type("uint32") spawnTick = 0;
  @type("boolean") alive = true;
}
```

```ts
// packages/shared/src/schema/WeaponSlotState.ts
import { Schema, type } from "@colyseus/schema";

/** One slot's live state. Array position is the slot index. */
export class WeaponSlotState extends Schema {
  @type("string") weaponId = "";
  @type("uint8") stocks = 0;
  /** Tick the running recharge completes; 0 = not recharging. The HUD derives its sweep from this. */
  @type("uint32") rechargeEndsTick = 0;
  @type("uint32") refireLockUntilTick = 0;
}
```

In `PlayerState.ts`: delete `weaponCooldown`, add

```ts
@type([WeaponSlotState]) weapons = new ArraySchema<WeaponSlotState>();
@type("uint32") switchLockUntilTick = 0;
@type("uint8") level = 1;
```

In `ArenaState.ts`: replace the `projectiles` field with

```ts
@type({ map: WeaponInstanceState }) weapons = new MapSchema<WeaponInstanceState>();
```

In `net/input.ts`:

```ts
export interface InputMessage {
  seq: number;
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  /** Slot bitmask: bit 0 = slot 1. The server masks it to the car's real slots before simulating. */
  fireSlots: number;
}
```

Update `index.ts`: drop `ProjectileState`, export `WeaponInstanceState`, `WeaponSlotState`, `WeaponKind`.

- [ ] **Step 4: Run tests**

Run: `npm test -w @motor-combat-moba/shared` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): weapon instance and slot schema, slot bitmask input"
```

---

### Task 11: Server — tick, bridge, and room wiring

**Files:**
- Modify: `packages/server/src/sim/tick.ts`, `packages/server/src/sim/combat-bridge.ts`, `packages/server/src/rooms/ArenaRoom.ts`
- Test: `packages/server/src/sim/tick.test.ts`, `packages/server/src/sim/combat-bridge.test.ts`

**Interfaces:**
- Consumes: shared Tasks 9–10.
- Produces: `serverTick(...)` returns `Map<string, number>` (session id → validated fire mask) instead of `Set<string>`; `CombatMemory` gains `fireStates: Map<string, FireState>` and renames `projectileSeq` → `instanceSeq`; `toCombatPlayers(state, roster, masks, memory)`, `toInstances(state, memory)`, `applyCombatResult(state, result, memory)`, `clearInstances(state, memory)`.

**Context:** The mask must be sanitised server-side — a hand-rolled client may send any integer.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/server/src/sim/tick.test.ts (replace the `fired` cases)
it("reports the slot mask from an input it actually simulated", () => {
  const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b001)]);
  expect(masks.get("p1")).toBe(0b001);
});

it("masks off bits beyond maxWeaponSlots", () => {
  const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b1111_1111)]);
  expect(masks.get("p1")).toBe(0b111); // maxWeaponSlots = 3
});

it("ors the masks of every input simulated this tick", () => {
  const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b001), fires(2, 0b010)]);
  expect(masks.get("p1")).toBe(0b011);
});

it("reports nothing for a player outside the match", () => {
  const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b001)], RoomPhase.COUNTDOWN);
  expect(masks.size).toBe(0);
});

it("ignores a negative or non-integer mask", () => {
  const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, -5 as number)]);
  expect(masks.get("p1") ?? 0).toBe(0);
});
```

```ts
// packages/server/src/sim/combat-bridge.test.ts (new cases)
it("builds a fire state from the player's chassis on first sight", () => {
  const state = new ArenaState();
  const player = new PlayerState();
  player.carId = "rectangle";
  state.players.set("aaa", player);
  const memory = newCombatMemory();

  const players = toCombatPlayers(state, new Set(["aaa"]), new Map([["aaa", 0b001]]), memory);
  expect(players[0]!.fireState.slots.map((s) => s.weaponId)).toEqual(["cannon"]);
  expect(players[0]!.fireMask).toBe(0b001);
});

it("writes slots back onto the player schema in order", () => {
  const state = new ArenaState();
  state.players.set("aaa", new PlayerState());
  const memory = newCombatMemory();
  applyCombatResult(
    state,
    {
      players: [
        {
          sessionId: "aaa",
          x: 0, y: 0, angle: 0, team: 0, carId: "rectangle",
          hp: 50, alive: true, inRoster: true, fireMask: 0,
          fireState: newFireState("rectangle", 1),
        },
      ],
      instances: [],
      ramCooldowns: new Map(),
      instanceSeq: 0,
    },
    memory,
  );
  const player = state.players.get("aaa")!;
  expect(player.weapons.length).toBe(1);
  expect(player.weapons.at(0)!.weaponId).toBe("cannon");
  expect(player.weapons.at(0)!.stocks).toBe(1);
});

it("diffs instances by id rather than clearing and refilling", () => {
  const state = new ArenaState();
  const memory = newCombatMemory();
  const live = {
    id: "aaa-1", ownerSessionId: "aaa", weaponId: "cannon" as const, kind: "projectile" as const,
    x: 100, y: 100, angle: 0, extent: 0, spawnTick: 90, distance: 0, pierceLeft: 0,
    attached: false, damageClock: new Map<string, number>(), alive: true,
  };
  const result = { players: [], instances: [live], ramCooldowns: new Map(), instanceSeq: 1 };

  applyCombatResult(state, result, memory);
  const first = state.weapons.get("aaa-1");
  applyCombatResult(state, { ...result, instances: [{ ...live, x: 130 }] }, memory);

  expect(state.weapons.get("aaa-1")).toBe(first); // same object, patched — not replaced
  expect(state.weapons.get("aaa-1")!.x).toBe(130);
});

it("drops an instance the sim no longer reports", () => {
  const state = new ArenaState();
  const memory = newCombatMemory();
  const live = {
    id: "aaa-1", ownerSessionId: "aaa", weaponId: "cannon" as const, kind: "projectile" as const,
    x: 100, y: 100, angle: 0, extent: 0, spawnTick: 90, distance: 0, pierceLeft: 0,
    attached: false, damageClock: new Map<string, number>(), alive: true,
  };
  applyCombatResult(state, { players: [], instances: [live], ramCooldowns: new Map(), instanceSeq: 1 }, memory);
  applyCombatResult(state, { players: [], instances: [], ramCooldowns: new Map(), instanceSeq: 1 }, memory);
  expect(state.weapons.size).toBe(0);
  expect(memory.instances.size).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @motor-combat-moba/server`
Expected: FAIL — compile errors on the old `fired`/`projectiles` shapes.

- [ ] **Step 3: Update `tick.ts`**

Replace the `fired` set with a mask map, sanitising the wire value:

```ts
const masks = new Map<string, number>();
const SLOT_MASK = (1 << WEAPON_SLOT_CONFIG.maxWeaponSlots) - 1;
// ... inside the simulated-input loop:
const raw = msg.fireSlots;
const clean = Number.isInteger(raw) && raw > 0 ? raw & SLOT_MASK : 0;
if (clean !== 0) masks.set(sessionId, (masks.get(sessionId) ?? 0) | clean);
```

- [ ] **Step 4: Update `combat-bridge.ts`**

```ts
export interface CombatMemory {
  ramCooldowns: Map<string, number>;
  /** Monotonic across the room's life, so a re-used session id cannot re-use an instance id. */
  instanceSeq: number;
  /** Per-player fire state, and the per-instance damage clocks. Server-only, never networked. */
  fireStates: Map<string, FireState>;
  instances: Map<string, WeaponInstance>;
}
```

```ts
/**
 * Fire state is rebuilt whenever a player's chassis changes — including the reveal, where `carId`
 * goes from "" to a real car. Keyed by session id and never networked: the client is told the
 * *result* (stocks, timers) through `WeaponSlotState`, never the machine.
 */
export function toCombatPlayers(
  state: ArenaState,
  roster: ReadonlySet<string>,
  masks: ReadonlyMap<string, number>,
  memory: CombatMemory,
): CombatPlayer[] {
  const players: CombatPlayer[] = [];
  state.players.forEach((player, sessionId) => {
    const existing = memory.fireStates.get(sessionId);
    const carId = isCarId(player.carId) ? player.carId : "";
    const stale = !existing || existing.slots.map((s) => s.weaponId).join() !== slotsFor(carId).join();
    const fireState = stale ? newFireState(carId, player.level) : existing;
    memory.fireStates.set(sessionId, fireState);

    players.push({
      sessionId,
      x: player.x,
      y: player.y,
      angle: player.angle,
      team: player.team === 1 ? 1 : 0,
      carId: player.carId,
      hp: player.hp,
      alive: player.alive,
      inRoster: roster.has(sessionId),
      fireMask: masks.get(sessionId) ?? 0,
      fireState,
    });
  });
  return players;
}

function slotsFor(carId: CarId | ""): readonly string[] {
  return isCarId(carId) ? slotsOf(carId) : [];
}

/**
 * Live instances come from room memory rather than from the schema: `damageClock`, `pierceLeft` and
 * `distance` are server-only and have no wire representation, so the schema is a projection of this
 * map, never its source.
 */
export function toInstances(memory: CombatMemory): WeaponInstance[] {
  return [...memory.instances.values()];
}

export function applyCombatResult(
  state: ArenaState,
  result: CombatResult,
  memory: CombatMemory,
): void {
  for (const p of result.players) {
    memory.fireStates.set(p.sessionId, p.fireState);
    const player = state.players.get(p.sessionId);
    if (!player) continue;
    player.hp = p.hp;
    player.alive = p.alive;
    player.level = p.fireState.level;
    player.switchLockUntilTick = p.fireState.switchLockUntilTick;
    writeSlots(player, p.fireState);
  }

  memory.instances = new Map(result.instances.map((i) => [i.id, i]));

  const stale: string[] = [];
  state.weapons.forEach((_, id) => {
    if (!memory.instances.has(id)) stale.push(id);
  });
  for (const id of stale) state.weapons.delete(id);

  // Diffed, never cleared and refilled: a collection emptied each tick patches every instance to
  // every client every tick, which is exactly the bandwidth the patch rate exists to avoid.
  for (const instance of result.instances) {
    let row = state.weapons.get(instance.id);
    if (!row) {
      row = new WeaponInstanceState();
      row.id = instance.id;
      row.ownerSessionId = instance.ownerSessionId;
      row.weaponId = instance.weaponId;
      row.kind = instance.kind === "beam" ? WeaponKind.BEAM : WeaponKind.PROJECTILE;
      row.spawnTick = instance.spawnTick;
      state.weapons.set(instance.id, row);
    }
    row.x = instance.x;
    row.y = instance.y;
    row.angle = instance.angle;
    row.extent = instance.extent;
    row.alive = instance.alive;
  }
}

/** Slot rows are positional: index is the slot, so they are resized rather than rebuilt. */
function writeSlots(player: PlayerState, fireState: FireState): void {
  while (player.weapons.length > fireState.slots.length) player.weapons.pop();
  fireState.slots.forEach((slot, index) => {
    let row = player.weapons.at(index);
    if (!row) {
      row = new WeaponSlotState();
      player.weapons.push(row);
    }
    row.weaponId = slot.weaponId;
    row.stocks = slot.stocks;
    row.rechargeEndsTick = slot.rechargeEndsTick;
    row.refireLockUntilTick = slot.refireLockUntilTick;
  });
}

/** Clear every live instance. Called when a match ends or a new one is set up. */
export function clearInstances(state: ArenaState, memory: CombatMemory): void {
  const ids: string[] = [];
  state.weapons.forEach((_, id) => ids.push(id));
  for (const id of ids) state.weapons.delete(id);
  memory.instances.clear();
  memory.fireStates.clear();
}
```

- [ ] **Step 5: Update `ArenaRoom.ts`**

Rename the three `clearProjectiles` call sites to `clearInstances(this.state, this.combat)`, pass the
mask map through `combatTick`, and replace `this.combat.projectileSeq` with `this.combat.instanceSeq`.
Reset `fireStates` wherever a match is set up or ended, alongside the existing ram-cooldown reset.

- [ ] **Step 6: Run tests**

Run: `npm run build -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/server`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src
git commit -m "feat(server): bridge weapon slots, masks and instances onto the schema"
```

---

### Task 12: Client — send the mask, draw the instances

**Files:**
- Create: `packages/client/src/config/slot-keys.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts`, `packages/client/src/scenes/combat-visual.ts`
- Test: `packages/client/src/scenes/combat-visual.test.ts`, `packages/client/src/config/slot-keys.test.ts`

**Interfaces:**
- Produces: `SLOT_KEYS: readonly { code: number; glyph: string }[]`, `slotMaskFrom(down: readonly boolean[]): number`, `instanceDrawShape(instance, elapsedMs): WorldShape` in `combat-visual.ts`.

**Context:** D19. Instances are drawn procedurally from their own hitbox — what you see is the hitbox.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/config/slot-keys.test.ts
import { describe, expect, it } from "vitest";
import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import { SLOT_KEYS, slotMaskFrom } from "./slot-keys.js";

describe("slot keys", () => {
  it("binds at least as many keys as there are slots", () => {
    expect(SLOT_KEYS.length).toBeGreaterThanOrEqual(WEAPON_SLOT_CONFIG.maxWeaponSlots);
  });

  it("gives every slot a display glyph for the HUD", () => {
    for (const key of SLOT_KEYS) expect(key.glyph.length).toBeGreaterThan(0);
  });

  it("packs held keys into a bitmask, slot 1 as bit 0", () => {
    expect(slotMaskFrom([true, false, false])).toBe(0b001);
    expect(slotMaskFrom([false, true, false])).toBe(0b010);
    expect(slotMaskFrom([true, true, true])).toBe(0b111);
    expect(slotMaskFrom([])).toBe(0);
  });

  it("ignores keys past the slot limit", () => {
    expect(slotMaskFrom([true, true, true, true])).toBe(0b111);
  });
});
```

```ts
// packages/client/src/scenes/combat-visual.test.ts (append)
import { WeaponKind } from "@motor-combat-moba/shared";
import { instanceDrawShape } from "./combat-visual.js";

describe("instance drawing", () => {
  const projectile = {
    weaponId: "cannon", kind: WeaponKind.PROJECTILE,
    x: 100, y: 100, angle: 0, extent: 0,
  };

  it("extrapolates a projectile along its own heading between patches", () => {
    const still = instanceDrawShape(projectile, 0);
    const later = instanceDrawShape(projectile, 25);
    if (still.kind !== "circle" || later.kind !== "circle") throw new Error("cannon draws as a circle");
    expect(later.x).toBeGreaterThan(still.x);
  });

  it("caps extrapolation at one patch interval so a stalled patch cannot fling a shot", () => {
    const capped = instanceDrawShape(projectile, 5000);
    const oneInterval = instanceDrawShape(projectile, 1000 / 20);
    if (capped.kind !== "circle" || oneInterval.kind !== "circle") throw new Error("circle expected");
    expect(capped.x).toBeCloseTo(oneInterval.x);
  });

  it("draws a beam at its reported extent", () => {
    const beam = { weaponId: "cannon", kind: WeaponKind.BEAM, x: 100, y: 100, angle: 0, extent: 200 };
    const shape = instanceDrawShape(beam, 0);
    expect(shape.kind).toBe("polygon");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @motor-combat-moba/client`
Expected: FAIL — cannot resolve `./slot-keys.js`; `instanceDrawShape` not exported.

- [ ] **Step 3: Implement `slot-keys.ts`**

```ts
// packages/client/src/config/slot-keys.ts
import Phaser from "phaser";
import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";

/**
 * Which key fires which slot, and what the HUD prints beside that slot's icon.
 *
 * Client-only on purpose: the server never sees a key, only a slot index, so a re-bind is a local
 * change with no protocol consequence. Must be at least `maxWeaponSlots` long.
 */
export const SLOT_KEYS = [
  { code: Phaser.Input.Keyboard.KeyCodes.SPACE, glyph: "␣" },
  { code: Phaser.Input.Keyboard.KeyCodes.Q, glyph: "Q" },
  { code: Phaser.Input.Keyboard.KeyCodes.E, glyph: "E" },
] as const;

/** Held slot keys as the wire's bitmask. Bit 0 is slot 1; anything past the limit is dropped. */
export function slotMaskFrom(down: readonly boolean[]): number {
  let mask = 0;
  const limit = Math.min(down.length, WEAPON_SLOT_CONFIG.maxWeaponSlots);
  for (let i = 0; i < limit; i++) if (down[i]) mask |= 1 << i;
  return mask;
}
```

- [ ] **Step 4: Implement `instanceDrawShape` and rewire `ArenaScene`**

In `combat-visual.ts`, keep `extrapolateShot` unchanged and add these imports plus the function:

```ts
import {
  DEFAULT_PATCH_RATE_HZ,
  beamShapeAt,
  isWeaponId,
  projectileShapeAt,
  weaponDefOf,
  type WorldShape,
} from "@motor-combat-moba/shared";

/**
 * Extrapolation is capped at one patch interval, so a stalled connection cannot fling a stale
 * instance across the arena while the client waits for the delete that already happened.
 */
function capMs(elapsedMs: number): number {
  return Math.min(Math.max(elapsedMs, 0), 1000 / DEFAULT_PATCH_RATE_HZ);
}

/**
 * What to draw for one live instance, in world space. The silhouette is the weapon's own hitbox
 * (D19), so what a player sees is exactly what can hurt them — and a new weapon needs no art.
 */
export function instanceDrawShape(
  instance: { weaponId: string; kind: number; x: number; y: number; angle: number; extent: number },
  elapsedMs: number,
): WorldShape {
  const def = isWeaponId(instance.weaponId) ? weaponDefOf(instance.weaponId) : null;
  if (!def) return { kind: "circle", x: instance.x, y: instance.y, radius: 3 };

  if (def.kind === "beam") {
    const grown = Math.min(def.range, instance.extent + def.speed * capMs(elapsedMs) / 1000);
    return beamShapeAt(def.hitbox, instance.x, instance.y, instance.angle, grown);
  }
  const at = extrapolateShot(instance.x, instance.y, instance.angle, def.speed, elapsedMs);
  return projectileShapeAt(def.hitbox, at.x, at.y, instance.angle);
}
```

In `ArenaScene.ts`: replace the `fire` key with `SLOT_KEYS.map(k => keyboard.addKey(k.code))`, send
`fireSlots: slotMaskFrom(this.slotKeys.map(k => k.isDown))`, and rewrite `renderShots` to iterate
`room.state.weapons`, fill each `instanceDrawShape(...)` (circle → `fillCircle`, polygon →
`fillPoints`) in the owner's colour, with beams fading toward transparent through their linger.

- [ ] **Step 5: Run tests and the app**

Run: `npm run build -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/client`
Then start the dev server via the preview tool (`npm run dev`), join, and confirm firing still draws
shots and still damages. Screenshot the arena as proof.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src
git commit -m "feat(client): send the slot mask and draw weapon instances from their hitboxes"
```

---

### Task 13: Client — the slot HUD

**Files:**
- Create: `packages/client/src/scenes/weapon-hud.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts`
- Test: `packages/client/src/scenes/weapon-hud.test.ts`

**Interfaces:**
- Produces: `SlotVisual` (`"ready" | "recharging" | "locked" | "car-locked"`), `slotVisualState(slot, weapon, level, switchLockUntilTick, pending, tick, isLastFired = false): SlotVisual`, `sweepFraction(rechargeEndsTick, cooldownTicks, tick): number`, `countdownSeconds(endsTick, tick): number | null`, `slotBarLayout(count, width, height): { x, y, size }[]`, `HUD_DIM` (`{ ready: 1, recharging: 0.4, locked: 0.25, carLocked: 0.7 }`).

**Context:** D18. All four states must be distinguishable; the locked dim is heavier and static.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/scenes/weapon-hud.test.ts
import { describe, expect, it } from "vitest";
import { HUD_DIM, countdownSeconds, slotBarLayout, slotVisualState, sweepFraction } from "./weapon-hud.js";

describe("sweep", () => {
  it("is full the tick a recharge starts and empty when it ends", () => {
    expect(sweepFraction(115, 15, 100)).toBeCloseTo(1);
    expect(sweepFraction(115, 15, 115)).toBeCloseTo(0);
    expect(sweepFraction(115, 15, 107.5)).toBeCloseTo(0.5);
  });

  it("is zero when nothing is recharging", () => {
    expect(sweepFraction(0, 15, 100)).toBe(0);
  });

  it("never reports outside [0,1], however stale the tick", () => {
    expect(sweepFraction(115, 15, 900)).toBe(0);
    expect(sweepFraction(115, 15, 0)).toBe(1);
  });
});

describe("countdown", () => {
  it("shows seconds only above a second, so short cooldowns stay uncluttered", () => {
    expect(countdownSeconds(160, 100)).toBeCloseTo(2); // 60 ticks == 2s
    expect(countdownSeconds(115, 100)).toBeNull(); // 0.5s: no number
    expect(countdownSeconds(0, 100)).toBeNull();
  });
});

describe("slot state", () => {
  const cannon = { unlocksAt: 1 };
  const slot = { stocks: 1, rechargeEndsTick: 0 };

  it("reads ready when stocked, unlocked and unblocked", () => {
    expect(slotVisualState(slot, cannon, 1, 0, null, 100)).toBe("ready");
  });

  it("reads locked when the weapon is above the player's level", () => {
    expect(slotVisualState(slot, { unlocksAt: 2 }, 1, 0, null, 100)).toBe("locked");
  });

  it("reads recharging while its own timer runs", () => {
    expect(slotVisualState({ stocks: 0, rechargeEndsTick: 115 }, cannon, 1, 0, null, 100)).toBe("recharging");
  });

  it("reads car-locked for every slot during a wind-up or volley", () => {
    const pending = { slot: 0 };
    expect(slotVisualState(slot, cannon, 1, 0, pending, 100)).toBe("car-locked");
  });

  it("reads car-locked during recovery only for OTHER slots", () => {
    // switch lock to tick 150; this slot is not the one that fired
    expect(slotVisualState(slot, cannon, 1, 150, null, 100, false)).toBe("car-locked");
    expect(slotVisualState(slot, cannon, 1, 150, null, 100, true)).toBe("ready");
  });

  it("dims a locked slot harder than a recharging one", () => {
    expect(HUD_DIM.locked).toBeLessThan(HUD_DIM.recharging);
  });
});

describe("layout", () => {
  it("centres the bar horizontally and pins it near the bottom", () => {
    const boxes = slotBarLayout(3, 1280, 720);
    expect(boxes).toHaveLength(3);
    const centres = boxes.map((b) => b.x + b.size / 2);
    expect((centres[0]! + centres[2]!) / 2).toBeCloseTo(640, 0);
    for (const box of boxes) expect(box.y).toBeGreaterThan(600);
  });

  it("draws nothing for a car with no slots", () => {
    expect(slotBarLayout(0, 1280, 720)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- weapon-hud`
Expected: FAIL — cannot resolve `./weapon-hud.js`.

- [ ] **Step 3: Implement `weapon-hud.ts`**

Pure functions only — no Phaser import, so every state is testable without a canvas.

```ts
// packages/client/src/scenes/weapon-hud.ts
import { TICK_RATE_HZ, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";

export type SlotVisual = "ready" | "recharging" | "locked" | "car-locked";

/** Icon alpha per state. The locked dim is heavier AND static, so it cannot read as a cooldown. */
export const HUD_DIM = { ready: 1, recharging: 0.4, locked: 0.25, carLocked: 0.7 } as const;

const BOX_PX = 64;
const GAP_PX = 12;
const BOTTOM_MARGIN_PX = 72;
/** Below this, a number is more clutter than information — the sweep already says "nearly ready". */
const COUNTDOWN_FLOOR_TICKS = TICK_RATE_HZ;

/** How much of the cooldown wedge is still drawn: 1 the tick it starts, 0 the tick it ends. */
export function sweepFraction(rechargeEndsTick: number, cooldownTicks: number, tick: number): number {
  if (rechargeEndsTick === 0 || cooldownTicks <= 0) return 0;
  const remaining = rechargeEndsTick - tick;
  return Math.min(1, Math.max(0, remaining / cooldownTicks));
}

/** Seconds left, or `null` when the wait is short enough that the sweep alone reads better. */
export function countdownSeconds(endsTick: number, tick: number): number | null {
  if (endsTick === 0) return null;
  const remaining = endsTick - tick;
  if (remaining < COUNTDOWN_FLOOR_TICKS) return null;
  return remaining / TICK_RATE_HZ;
}

/**
 * Which of the four looks this slot wears. Precedence matters: a locked weapon reads as locked even
 * mid-recovery, because "you do not have this yet" outranks "you cannot act this instant".
 */
export function slotVisualState(
  slot: { stocks: number; rechargeEndsTick: number },
  weapon: { unlocksAt: number },
  level: number,
  switchLockUntilTick: number,
  pending: { slot: number } | null,
  tick: number,
  isLastFired = false,
): SlotVisual {
  if (weapon.unlocksAt > level) return "locked";
  // A wind-up or volley locks every slot; recovery locks only the OTHER slots (D3).
  if (pending !== null) return "car-locked";
  if (!isLastFired && tick < switchLockUntilTick) return "car-locked";
  if (slot.stocks === 0 && slot.rechargeEndsTick !== 0) return "recharging";
  return "ready";
}

/** Camera-fixed boxes, centred horizontally and pinned above the bottom edge. */
export function slotBarLayout(
  count: number,
  viewWidth: number,
  viewHeight: number,
): { x: number; y: number; size: number }[] {
  const shown = Math.min(count, WEAPON_SLOT_CONFIG.maxWeaponSlots);
  if (shown <= 0) return [];
  const totalWidth = shown * BOX_PX + (shown - 1) * GAP_PX;
  const left = (viewWidth - totalWidth) / 2;
  const y = viewHeight - BOTTOM_MARGIN_PX;
  return Array.from({ length: shown }, (_, i) => ({
    x: left + i * (BOX_PX + GAP_PX),
    y,
    size: BOX_PX,
  }));
}
```

- [ ] **Step 4: Draw it in `ArenaScene`**

Add a `setScrollFactor(0)` container that, each frame, reads the local player's `weapons` array,
draws `min(length, maxWeaponSlots)` boxes via `slotBarLayout`, fills each with the weapon icon
texture (`weaponIconKey`) or the procedural glyph, applies `HUD_DIM[state]`, draws the radial sweep
for `recharging`, prints `countdownSeconds` when non-null, prints the `SLOT_KEYS[i].glyph` beneath
the box, and prints the stock count when the weapon has a `stock` block. Hide the bar entirely in
free-roam spectate; show the watched car's bar otherwise.

- [ ] **Step 5: Run tests and verify in the browser**

Run: `npm test -w @motor-combat-moba/client`, then run the app and screenshot the HUD showing a
ready slot and a recharging slot.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src
git commit -m "feat(client): weapon slot HUD with cooldown sweep and lock states"
```

---

### Task 14: Weapon icon pipeline

**Files:**
- Create: `scripts/import-weapon-icon.mjs`, `scripts/import-weapon-icon.test.mjs`, `.claude/skills/process-weapon-icon/SKILL.md`
- Modify: `packages/client/src/assets/asset-keys.ts`, `packages/client/public/art/README.md`

**Interfaces:**
- Produces: `weaponIconKey(weaponId: string): string` → `"weapon-icon.<id>"`; the importer CLI `node scripts/import-weapon-icon.mjs --weapon <id> --src <path>`.

**Context:** D19. Icons keep their colour (`colorMode: "none"`) — the car importer's desaturation would ruin them.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/import-weapon-icon.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { iconManifestRow, weaponIconKeyOf, ICON_PX } from "./import-weapon-icon.mjs";

test("namespaces the manifest key", () => {
  assert.equal(weaponIconKeyOf("cannon"), "weapon-icon.cannon");
});

test("writes an untinted, fitted row", () => {
  const row = iconManifestRow("cannon");
  assert.equal(row.file, "weapon-icons/cannon.png");
  assert.equal(row.colorMode, "none");
  assert.equal(row.scale, "fit");
});

test("preserves hand-tuned fields on re-import", () => {
  const existing = { file: "weapon-icons/cannon.png", origin: [0.4, 0.6], colorMode: "none" };
  const row = iconManifestRow("cannon", existing);
  assert.deepEqual(row.origin, [0.4, 0.6]);
});

test("renders at twice the HUD box so the icon stays sharp", () => {
  assert.equal(ICON_PX, 128);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:scripts`
Expected: FAIL — cannot find `./import-weapon-icon.mjs`.

- [ ] **Step 3: Implement the importer**

Model it on `scripts/import-art.mjs` — read that file first and follow its CLI parsing, manifest
read-modify-write, and error reporting exactly. The three exported pure helpers the tests drive:

```js
// scripts/import-weapon-icon.mjs
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ART_DIR = "packages/client/public/art";
/** Twice the 64px HUD box, so the icon stays sharp and the deferred dpr work needs no re-import. */
export const ICON_PX = 128;

export function weaponIconKeyOf(weaponId) {
  return `weapon-icon.${weaponId}`;
}

/**
 * The manifest row for an icon. Deliberately NOT the car defaults: `colorMode: "none"` because an
 * icon is not player-tinted (the car importer desaturates for tinting, which would leave an icon a
 * grey blob), and `scale: "fit"` against the square slot box rather than the 48x32 hull.
 *
 * Any field already present is preserved, so a hand-tuned `origin` survives a re-import.
 */
export function iconManifestRow(weaponId, existing = {}) {
  return {
    ...existing,
    file: `weapon-icons/${weaponId}.png`,
    colorMode: "none",
    scale: existing.scale ?? "fit",
  };
}

export async function importIcon(weaponId, srcPath) {
  const outDir = path.join(ART_DIR, "weapon-icons");
  await mkdir(outDir, { recursive: true });
  await sharp(srcPath)
    .trim()
    .resize(ICON_PX, ICON_PX, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outDir, `${weaponId}.png`));

  const manifestPath = path.join(ART_DIR, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const key = weaponIconKeyOf(weaponId);
  manifest.sprites ??= {};
  manifest.sprites[key] = iconManifestRow(weaponId, manifest.sprites[key]);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { key, row: manifest.sprites[key] };
}
```

Note there is no `.greyscale()` anywhere in this file — that is the single most important
difference from the car importer, and a comment should say so where the pipeline is built.

- [ ] **Step 4: Add the client key helper**

In `packages/client/src/assets/asset-keys.ts`, beside `carSpriteKey`:

```ts
/** Manifest key for a weapon's HUD icon. Namespaced like `car.<id>`, with its own defaults. */
export function weaponIconKey(weaponId: string): string {
  return `weapon-icon.${weaponId}`;
}
```

Load these keys in `BootScene`'s `assetManifest()` alongside the car sprites.

- [ ] **Step 5: Write the skill**

`.claude/skills/process-weapon-icon/SKILL.md`, mirroring `process-car-asset`: front-matter name and
description covering "add/replace/wire a weapon icon" and "why is my icon blurry/missing", steps
that run the importer, report the manifest row, and include this generation prompt verbatim:

> Flat vector game icon of \<weapon description\>, centred single object, viewed straight on,
> filling most of a square frame with a small even margin. Bold simplified silhouette that stays
> readable at 64×64 pixels. Limited palette of 3–4 saturated colours with strong value contrast
> against both light and dark backgrounds. Clean crisp edges, no gradients, no texture, no drop
> shadow, no outer glow, no perspective, no background scenery, no text, no lettering, no
> watermark. Consistent top-left light source. Transparent background. PNG.

- [ ] **Step 6: Run and commit**

Run: `npm run test:scripts` — Expected: PASS.

```bash
git add scripts/import-weapon-icon.mjs scripts/import-weapon-icon.test.mjs .claude/skills/process-weapon-icon packages/client/src/assets/asset-keys.ts packages/client/public/art/README.md
git commit -m "feat(art): weapon icon importer, manifest namespace and skill"
```

---

### Task 15: Documentation and release check

**Files:**
- Modify: `docs/combat-model.md`, `docs/schema-reference.md`, `docs/config-reference.md`, `docs/asset-pipeline.md`, `docs/project-structure.md`, `CLAUDE.md`
- Test: full suite + a real two-client LAN run

- [ ] **Step 1: Rewrite the "Weapon" section of `combat-model.md`**

Replace the single-weapon table with: the slot model and bitmask input, the fire state machine and
its three clocks, stocks, volleys, the two instance types and their lifecycles, shaped hitboxes and
the smear, pierce, and the per-target damage clocks. Keep the ramming and elimination sections as
they are. State plainly that hits are still tested with no lag compensation and point at the spec's
future-work section.

- [ ] **Step 2: Update the other docs**

`schema-reference.md` — the new `WeaponInstanceState`/`WeaponSlotState` rows, the `PlayerState`
changes, `ArenaState.weapons`, and `InputMessage.fireSlots`. `config-reference.md` — `WEAPON_TABLE`,
`WEAPON_TICKS`, `WEAPON_SLOT_CONFIG`, and the ms-authoring rule. `asset-pipeline.md` — the
`weapon-icon.<id>` namespace, its differing defaults, and the importer. `project-structure.md` — the
`sim/weapons/` module set. `CLAUDE.md` — add the weapon spec to the "Read the right doc" table.

- [ ] **Step 3: Full verification**

```bash
npm run build
npm test
```

Expected: PASS. Then `grep -c "resolveInstanceHits" packages/server/dist/index.js` to confirm the
server bundle actually contains the new sim (the stale-`dist` trap from `CLAUDE.md`).

- [ ] **Step 4: Play it**

Run `npm run dev`, open two browser tabs, start a match, and confirm: firing works from slot 1,
the HUD sweep matches the cooldown, damage and elimination are unchanged, and the release build
(`npm run build:release`) still produces a working zip.

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: document the weapon system"
```

---

## Self-Review Notes

**Spec coverage:** D1 → T1; D2 → T3, T10, T11, T12; D3 → T8, T9; D4 → T8; D5 → T8; D6 → T2; D7 → T5; D8 → T5; D9 → T7; D10 → T7; D11 → T6, T9; D12 → T6, T8; D13 → nothing to build (explicit non-goals); D14 → T8, T10; D15 → T10, T11; D16 → T3; D17 → T1; D18 → T13; D19 → T12, T14; D20 → T7; D21 → T5–T9; D22 → T1, T3.

**Known deviation from the spec:** D15 said `ArraySchema` for instances; this plan uses
`MapSchema<WeaponInstanceState>` keyed by id, because `applyCombatResult` diffs live instances by id
and a cleared-and-refilled collection would patch every instance to every client every tick. The
spec has been corrected to match. Per-player slots remain an `ArraySchema`, where order is the slot
index.

**Deliberately deferred inside tasks:** beam rendering polish (fade curve) and the procedural icon
fallback glyph are drawn in Task 12/13 with the simplest thing that reads correctly; no shipped
weapon exercises beams (D22), so their live behaviour is proven by unit tests rather than by play.
