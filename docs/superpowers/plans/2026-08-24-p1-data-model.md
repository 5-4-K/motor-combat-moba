# P1 — Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Companion: `2026-08-24-motor-combat-moba-v1-master-index.md`. Spec: `docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md` §§5–7, 10, 13.
>
> **After Validation passes:** update the Execution Tracker (P1 → Done).

**Goal:** All v1 balance/feel numbers, cars, colors, weapon, arena geometry, and networked schema fields exist in `shared` and are tested. No lobby UI, driving feel, or combat resolution yet.

**Architecture:** Config tables use `as const satisfies <Interface>`. Schema fields that `stepSim` will read are added now (even if unused) so P4/P5 do not reshape the protocol. Arena is data, not Phaser objects.

**Tech Stack:** `@motor-combat-moba/shared` + Vitest.

**Depends on:** P0 Done. **Blocks:** P2, P3, P4, P5.

---

## Files

- Create: `packages/shared/src/config/types.ts`
- Create: `packages/shared/src/config/car-config.ts`
- Create: `packages/shared/src/config/color-config.ts`
- Create: `packages/shared/src/config/weapon-config.ts`
- Create: `packages/shared/src/config/combat-config.ts`
- Create: `packages/shared/src/config/drive-config.ts`
- Create: `packages/shared/src/config/net-config.ts`
- Create: `packages/shared/src/config/flow-config.ts`
- Create: `packages/shared/src/config/config.test.ts`
- Create: `packages/shared/src/arena/types.ts`
- Create: `packages/shared/src/arena/arena-01.ts`
- Create: `packages/shared/src/arena/registry.ts`
- Create: `packages/shared/src/arena/arena.test.ts`
- Create: `packages/shared/src/schema/ProjectileState.ts`
- Modify: `packages/shared/src/constants.ts`, `schema/PlayerState.ts`, `schema/ArenaState.ts`, `schema/schema.test.ts`, `src/index.ts`
- Modify: `docs/schema-reference.md`, `docs/config-reference.md`

---

### Task 1: Config tables (TDD)

- [ ] **Step 1: Write `packages/shared/src/config/config.test.ts` first** (it must fail).

```ts
import { describe, expect, it } from "vitest";
import { CAR_TABLE, hpOf, forwardMaxSpeedOf } from "./car-config.js";
import { COLOR_TABLE } from "./color-config.js";
import { WEAPON_CONFIG } from "./weapon-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { FLOW_CONFIG } from "./flow-config.js";

describe("CAR_TABLE", () => {
  it("has exactly rectangle, oval, hexagon", () => {
    expect(Object.keys(CAR_TABLE).sort()).toEqual(["hexagon", "oval", "rectangle"]);
  });

  it("matches the locked ratings", () => {
    expect(CAR_TABLE.rectangle).toMatchObject({ speed: 8, strength: 3, hp: 5 });
    expect(CAR_TABLE.oval).toMatchObject({ speed: 5, strength: 8, hp: 3 });
    expect(CAR_TABLE.hexagon).toMatchObject({ speed: 3, strength: 5, hp: 8 });
  });

  it("derives actual HP via hpPerRating", () => {
    expect(hpOf("rectangle")).toBe(50);
    expect(hpOf("oval")).toBe(30);
    expect(hpOf("hexagon")).toBe(80);
  });

  it("derives forward max speed from the speed rating", () => {
    expect(forwardMaxSpeedOf("rectangle")).toBeGreaterThan(forwardMaxSpeedOf("oval"));
    expect(forwardMaxSpeedOf("oval")).toBeGreaterThan(forwardMaxSpeedOf("hexagon"));
  });
});

describe("COLOR_TABLE", () => {
  it("has 6 unique hex colors", () => {
    expect(COLOR_TABLE).toHaveLength(6);
    const hex = COLOR_TABLE.map((c) => c.hex);
    expect(new Set(hex).size).toBe(6);
    for (const h of hex) expect(h).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("weapon / combat / drive / flow knobs exist", () => {
  it("weapon defaults", () => {
    expect(WEAPON_CONFIG.damage).toBe(8);
    expect(WEAPON_CONFIG.fireRateHz).toBe(2);
    expect(WEAPON_CONFIG.projectileSpeed).toBe(900);
    expect(WEAPON_CONFIG.lifetimeTicks).toBe(30);
  });
  it("combat defaults", () => {
    expect(COMBAT_CONFIG.collisionDamagePerStrength).toBe(1);
    expect(COMBAT_CONFIG.ramDotThreshold).toBe(0.5);
    expect(COMBAT_CONFIG.collisionDamageCooldownTicks).toBe(15);
    expect(COMBAT_CONFIG.hpPerRating).toBe(10);
  });
  it("reverse is half of forward", () => {
    expect(DRIVE_CONFIG.reverseSpeedRatio).toBe(0.5);
  });
  it("flow timers", () => {
    expect(FLOW_CONFIG.carSelectSeconds).toBe(60);
    expect(FLOW_CONFIG.countdownSeconds).toBe(3);
  });
});
```

- [ ] **Step 2: Run `npm run test -w @motor-combat-moba/shared` — fail on missing modules.**

- [ ] **Step 3: Implement tables** with these exact values (do not invent extras).

`packages/shared/src/config/types.ts`:

```ts
export type CarId = "rectangle" | "oval" | "hexagon";

export interface CarDef {
  id: CarId;
  name: string;
  speed: number;     // 0–10 rating
  strength: number;  // 0–10 rating
  hp: number;        // 0–10 rating
}

export interface ColorDef {
  colorId: number;
  name: string;
  hex: string;
}
```

`car-config.ts`:

```ts
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import type { CarDef, CarId } from "./types.js";

export const CAR_TABLE = {
  rectangle: { id: "rectangle", name: "Rectangle", speed: 8, strength: 3, hp: 5 },
  oval: { id: "oval", name: "Oval", speed: 5, strength: 8, hp: 3 },
  hexagon: { id: "hexagon", name: "Hexagon", speed: 3, strength: 5, hp: 8 },
} as const satisfies Record<CarId, CarDef>;

export function hpOf(id: CarId): number {
  return CAR_TABLE[id].hp * COMBAT_CONFIG.hpPerRating;
}

export function forwardMaxSpeedOf(id: CarId): number {
  return DRIVE_CONFIG.baseMaxSpeed + CAR_TABLE[id].speed * DRIVE_CONFIG.speedPerRating;
}

export function reverseMaxSpeedOf(id: CarId): number {
  return forwardMaxSpeedOf(id) * DRIVE_CONFIG.reverseSpeedRatio;
}
```

`drive-config.ts` (feel knobs — all used by P4; define now):

```ts
export const DRIVE_CONFIG = {
  baseMaxSpeed: 120,       // world units / second at speed rating 0
  speedPerRating: 30,      // extra u/s per speed point → rectangle 360 u/s
  accel: 520,
  brakeDecel: 780,
  drag: 140,
  turnRate: 2.8,           // radians / second at speed
  turnRateAtStop: 1.4,
  reverseSpeedRatio: 0.5,
  reverseHoldTicks: 6,     // ticks of brake-while-stopped before reverse arms
  carWidth: 48,
  carHeight: 32,
  restitution: 0.35,
} as const;
```

`weapon-config.ts`:

```ts
export const WEAPON_CONFIG = {
  damage: 8,
  fireRateHz: 2,
  projectileSpeed: 900,
  lifetimeTicks: 30,
} as const;
```

`combat-config.ts`:

```ts
export const COMBAT_CONFIG = {
  hpPerRating: 10,
  collisionDamagePerStrength: 1,
  ramDotThreshold: 0.5,
  collisionDamageCooldownTicks: 15,
} as const;
```

`color-config.ts` — exact hexes from the spec:

```ts
import type { ColorDef } from "./types.js";

export const COLOR_TABLE: readonly ColorDef[] = [
  { colorId: 0, name: "Crimson", hex: "#E74C3C" },
  { colorId: 1, name: "Azure", hex: "#3498DB" },
  { colorId: 2, name: "Emerald", hex: "#2ECC71" },
  { colorId: 3, name: "Gold", hex: "#F1C40F" },
  { colorId: 4, name: "Violet", hex: "#9B59B6" },
  { colorId: 5, name: "Orange", hex: "#E67E22" },
];
```

`flow-config.ts`:

```ts
export const FLOW_CONFIG = {
  carSelectSeconds: 60,
  countdownSeconds: 3,
  nameMin: 1,
  nameMax: 16,
} as const;
```

`net-config.ts`:

```ts
export const NET_CONFIG = {
  pendingInputCap: 24,
  reconcileSnapPos: 24,
  reconcileSnapAngle: 0.6,
  reconcileEaseRate: 0.25,
  interpolationDelayMs: 50,
} as const;
```

- [ ] **Step 4: Tests pass.** Commit `feat: shared config tables for cars, colors, combat, drive`

---

### Task 2: Arena-01 data (TDD)

- [ ] **Step 1: Write `arena.test.ts` first.**

```ts
import { describe, expect, it } from "vitest";
import { ARENA_01 } from "./arena-01.js";
import { getArena } from "./registry.js";

describe("arena-01", () => {
  it("is 2400x1600 with 6 obstacles", () => {
    expect(ARENA_01.width).toBe(2400);
    expect(ARENA_01.height).toBe(1600);
    expect(ARENA_01.obstacles).toHaveLength(6);
  });

  it("keeps every obstacle inside bounds", () => {
    for (const o of ARENA_01.obstacles) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.x + o.w).toBeLessThanOrEqual(ARENA_01.width);
      expect(o.y + o.h).toBeLessThanOrEqual(ARENA_01.height);
    }
  });

  it("exposes 6 FFA spawns and 3+3 team spawns, none overlapping an obstacle", () => {
    expect(ARENA_01.ffaSpawns).toHaveLength(6);
    expect(ARENA_01.teamASpawns).toHaveLength(3);
    expect(ARENA_01.teamBSpawns).toHaveLength(3);
    const all = [...ARENA_01.ffaSpawns, ...ARENA_01.teamASpawns, ...ARENA_01.teamBSpawns];
    for (const s of all) {
      expect(s.x).toBeGreaterThan(80);
      expect(s.x).toBeLessThan(ARENA_01.width - 80);
      for (const o of ARENA_01.obstacles) {
        const inside = s.x > o.x && s.x < o.x + o.w && s.y > o.y && s.y < o.y + o.h;
        expect(inside).toBe(false);
      }
    }
    for (const s of ARENA_01.teamASpawns) expect(s.x).toBeLessThan(ARENA_01.width / 2);
    for (const s of ARENA_01.teamBSpawns) expect(s.x).toBeGreaterThan(ARENA_01.width / 2);
  });

  it("registry resolves arena-01", () => {
    expect(getArena("arena-01")).toBe(ARENA_01);
  });
});
```

- [ ] **Step 2: Implement `arena/types.ts`, `arena-01.ts`, `registry.ts`.**

Obstacle layout (use these exact rects so later plans agree):

```ts
export const ARENA_01 = {
  id: "arena-01",
  width: 2400,
  height: 1600,
  obstacles: [
    { x: 500, y: 350, w: 220, h: 80 },
    { x: 1680, y: 350, w: 220, h: 80 },
    { x: 500, y: 1170, w: 220, h: 80 },
    { x: 1680, y: 1170, w: 220, h: 80 },
    { x: 1080, y: 620, w: 240, h: 360 },
    { x: 200, y: 720, w: 80, h: 160 },
  ],
  ffaSpawns: [
    { x: 200, y: 200, angle: 0 },
    { x: 2200, y: 200, angle: Math.PI },
    { x: 200, y: 1400, angle: 0 },
    { x: 2200, y: 1400, angle: Math.PI },
    { x: 1200, y: 180, angle: Math.PI / 2 },
    { x: 1200, y: 1420, angle: -Math.PI / 2 },
  ],
  teamASpawns: [
    { x: 220, y: 400, angle: 0 },
    { x: 220, y: 800, angle: 0 },
    { x: 220, y: 1200, angle: 0 },
  ],
  teamBSpawns: [
    { x: 2180, y: 400, angle: Math.PI },
    { x: 2180, y: 800, angle: Math.PI },
    { x: 2180, y: 1200, angle: Math.PI },
  ],
};
```

`getArena(id)` throws if unknown. `DEFAULT_ARENA_ID = "arena-01"`.

- [ ] **Step 3: Tests pass.** Commit `feat: arena-01 definition and registry`

---

### Task 3: Expand schema

Add fields from spec §10. Do not put `pendingCarId` on the schema.

`PlayerState` add (keep P0 fields):

```ts
@type("string") name = "";
@type("uint8") colorId = 0;
@type("uint8") team = 0;
@type("uint32") joinedAtTick = 0;
@type("string") carId = "";
@type("number") speed = 0;
@type("uint16") reverseHold = 0;
@type("uint16") hp = 0;
@type("boolean") alive = true;
@type("uint32") weaponCooldown = 0;
@type("boolean") selectLocked = false;
```

`ProjectileState`:

```ts
@type("string") id = "";
@type("string") ownerSessionId = "";
@type("number") x = 0;
@type("number") y = 0;
@type("number") angle = 0;
@type("number") speed = 0;
@type("uint32") spawnTick = 0;
@type("boolean") alive = true;
```

`ArenaState` add:

```ts
@type("string") arenaId = "arena-01";
@type("uint32") carSelectDeadlineTick = 0;
@type("uint32") countdownEndsTick = 0;
@type("int8") winnerTeam = -1;
@type("string") winnerSessionId = "";
@type({ map: ProjectileState }) projectiles = new MapSchema<ProjectileState>();
```

Extend `schema.test.ts`: construct, set every new field, add a projectile to the map.

Rebuild shared. Server/client should still compile (extra fields are backward compatible).

- [ ] **Step 1: Tests first, then implementation.**
- [ ] **Step 2: Update `docs/schema-reference.md` and `docs/config-reference.md` with every field/knob.**
- [ ] **Step 3: Commit** `feat: full v1 schema and config reference docs`

---

## Validation

1. `npm run test -w @motor-combat-moba/shared` exits 0. All new tests above pass.
2. `npm run build --workspaces` exits 0.
3. `npm run test --workspaces` exits 0 (P0 client/server tests still pass).
4. Grep the repo for magic combat/drive numbers outside `packages/shared/src/config` — there should be none in logic files. (P0 placeholder positions `400 + 80 * index` may remain until P3 spawn; that is OK.)

Update the tracker: P1 Done.
