# Mouse Aim and Turret Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth muzzle, the turret. It fires selected weapons along a mouse-chosen world bearing, after turning to it. Around it: pointer lock with a crosshair, a menu in every room kind, one control layout, tinted turret art on every car, and the basic attack switched on.

**Architecture:** The turret is sim state (approach A). `FireState` gains a car-relative `turretAngle`. A turret press stores a frozen world `bearing` and turns the turret before the wind-up starts: `tickRecharge → beginFire → turnTurret → releaseShots`. The spawn point is `pivot + bearing × (defaultOffset + additionalOffset)`, clamped at walls. The bearing arrives as an optional `aimAngle` on `InputMessage`. The turret angle is mirrored to a render-only `PlayerState.turretAngle`. The client owns pointer lock, the crosshair, the menu and the turret drawing.

**Tech Stack:** TypeScript npm workspaces (`@motor-combat-moba/shared` / `server` / `client`), Colyseus schema, Phaser 4, Vitest, node:test for `scripts/`.

**Spec:** [`docs/superpowers/specs/2026-09-21-mouse-aim-turret-design.md`](../specs/2026-09-21-mouse-aim-turret-design.md) (TR1–TR52). Read it before any task; clause numbers below refer to it.

## Global Constraints

- The root `CLAUDE.md` hard invariants hold. In particular: no magic numbers in logic (balance lives in shared config); `stepSim` is untouched (the turret is combat, not drive); enum values are never renumbered; shared is consumed as built `dist`.
- After editing `packages/shared`, rebuild it before running server or client tests: `npm run build -w @motor-combat-moba/shared`.
- Verify with **root** `npm test`, never per-workspace alone: per-workspace runs silently skip the server suite. Per-workspace runs are fine for the red/green inner loop.
- Tests that were red **before** this work are in the baseline log at `C:\Users\user\AppData\Local\Temp\claude\E--Work-motor-combat-MOBA--claude-worktrees-motor-combat-physics-analysis-3e7a9a\2bca22b9-0009-44e1-9529-05ff10631d25\scratchpad\baseline-test.log`. Any other red test is yours.
- Turret numbers (exact): `turnRateDegPerSec: 540`, `defaultOffset: 25`, every `turretMount: { x: 0, y: 0 }`, every shipped `additionalOffset: 0`, turret visual length `36`, default turret pivot origin `[0.31, 0.5]`.
- Turret rows (exact): the nine `basic-attack-*` rows (via `BASIC_ATTACK_BASE`), `predator`, `magmablast`, `thumper`.
- Bindings (exact): fire slot 0 LMB, 1 RMB, 2 Q (81), 3 E (69), 4 Space (32). Nothing else fires.
- Commit after each task. End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Do not read `docs/ideas/` or `docs/invariants/`.
- Do not edit `packages/server/playtest/` probes except to fix a compile break, and name any such fix in your report.

## File map

| File | Responsibility | Task |
|---|---|---|
| `packages/shared/src/config/turret-config.ts` (new) | `TURRET_CONFIG`, `TURRET_TICKS` | 1 |
| `packages/shared/src/config/weapon-types.ts` | `TurretDef`, `WeaponBase.turret` | 1 |
| `packages/shared/src/config/weapon-config.ts` | turret field on 3 rows + `BASIC_ATTACK_BASE` | 1 |
| `packages/shared/src/config/types.ts`, `car-config.ts` | `CarDef.turretMount`, `turretMountOf` | 1 |
| `packages/shared/src/sim/weapons/turret.ts` (new) | `wrapAngle`, `turretPivotOf`, `turnTurret` | 1, 2 |
| `packages/shared/src/sim/weapons/fire.ts` | `turretAngle`, `bearing`/`aligned`, `beginFire` params, release gate | 2 |
| `packages/shared/src/sim/weapons/instances.ts` | `ShotOrder.bearing`, turret spawn, wall clamp, `aimAngle` param removed | 2, 3 |
| `packages/shared/src/sim/combat.ts` | `CombatPlayer.aimBearing`, call order, world into spawn | 3 |
| `packages/shared/src/net/input.ts`, `schema/PlayerState.ts` | `aimAngle?`, `turretAngle` | 4 |
| `packages/server/src/net/input-message.ts`, `sim/tick.ts`, `sim/combat-bridge.ts`, `rooms/tick-pipeline.ts` | wire validation, aim capture, threading, mirror | 4 |
| `packages/server/src/bot/**`, `config/bot-profiles.ts` | bot aim, `BOT_BRAIN_VERSION` | 5 |
| `BASIC_ATTACK_CONFIG`, `packages/client/src/config/slot-keys.ts`, `scenes/movement-hint.ts`, `ArenaScene.ts` bindings | one layout, basic attack on | 6 |
| `packages/client/src/input/pointer-lock.ts`, `input/aim.ts`, `config/crosshair.ts`, `scenes/crosshair.ts` (new), `ui/screens/pause.ts`, `ArenaScene.ts`, `dev/playground/overlay.ts` | lock, crosshair, aim, menu | 7 |
| `scripts/import-art.mjs`, `.claude/skills/process-car-asset/**`, `scripts/check-art.mjs`, `packages/client/public/art/**`, `assets/asset-keys.ts` | turret art pipeline | 8 |
| `packages/client/src/scenes/turret-visual.ts`, `config/turret-visual.ts` (new), `ArenaScene.ts`, `dev/AssetTuningScene.ts` | turret drawing, dev overlay | 9 |
| `scripts/build-cars-and-weapons.mjs`, `manual.html`, docs, `CLAUDE.md` | manual + docs | 10 |

---

### Task 1: Turret config, the weapon flag, and the mount (TR1–TR6)

**Files:**
- Create: `packages/shared/src/config/turret-config.ts`
- Create: `packages/shared/src/config/turret-config.test.ts`
- Create: `packages/shared/src/sim/weapons/turret.ts`
- Create: `packages/shared/src/sim/weapons/turret.test.ts`
- Modify: `packages/shared/src/config/weapon-types.ts` (`WeaponBase`, around line 152)
- Modify: `packages/shared/src/config/weapon-config.ts` (`BASIC_ATTACK_BASE` line 19, `predator` ~107, `magmablast` ~235, `thumper` ~398)
- Modify: `packages/shared/src/config/types.ts` (`CarDef`, before `isActive`)
- Modify: `packages/shared/src/config/car-config.ts` (all nine rows; new `turretMountOf`)
- Modify: `packages/shared/src/index.ts` (exports)

**Interfaces:**
- Produces:
  - `TURRET_CONFIG: { turnRateDegPerSec: 540; defaultOffset: 25 }`
  - `TURRET_TICKS: { turnPerTick: number }` (radians)
  - `interface TurretDef { additionalOffset: number }`, `WeaponBase.turret?: TurretDef`
  - `CarDef.turretMount: { x: number; y: number }`
  - `turretMountOf(carId: string): { x: number; y: number }`
  - `wrapAngle(a: number): number` (into (−π, π])
  - `turretPivotOf(pose: { x: number; y: number; angle: number }, carId: string, mount = turretMountOf(carId)): { x: number; y: number }`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/config/turret-config.test.ts` (find the real `TICK_RATE_HZ` module with `grep -rn "export const TICK_RATE_HZ" packages/shared/src` and fix the import path if it differs):

```ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { CAR_TABLE, turretMountOf } from "./car-config.js";
import { TURRET_CONFIG, TURRET_TICKS } from "./turret-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";

describe("turret config (TR1-TR5)", () => {
  it("turns at the configured rate, converted once to radians per tick", () => {
    expect(TURRET_TICKS.turnPerTick).toBeCloseTo(
      (TURRET_CONFIG.turnRateDegPerSec * Math.PI) / 180 / TICK_RATE_HZ,
      12,
    );
  });

  it("puts `turret` only on single-muzzle projectile rows with a finite, non-negative offset (TR3)", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      if (!def.turret) continue;
      expect(def.kind, `${def.id} carries turret`).toBe("projectile");
      expect(def.muzzles, `${def.id} carries turret with muzzles`).toBeUndefined();
      expect(Number.isFinite(def.turret.additionalOffset) && def.turret.additionalOffset >= 0, def.id).toBe(true);
    }
  });

  it("ships the turret on exactly the basic attacks, predator, magmablast and thumper (TR4)", () => {
    const turretIds = Object.values(WEAPON_TABLE).filter((d) => d.turret).map((d) => d.id).sort();
    const basics = Object.keys(WEAPON_TABLE).filter((id) => id.startsWith("basic-attack-"));
    expect(turretIds).toEqual([...basics, "magmablast", "predator", "thumper"].sort());
  });

  it("gives every chassis a mount, and an unknown id the centre (TR5)", () => {
    for (const car of Object.values(CAR_TABLE)) expect(car.turretMount).toEqual({ x: 0, y: 0 });
    expect(turretMountOf("not-a-car")).toEqual({ x: 0, y: 0 });
  });
});
```

`packages/shared/src/sim/weapons/turret.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { turretPivotOf, wrapAngle } from "./turret.js";

describe("wrapAngle", () => {
  it("maps into (-pi, pi]", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle((-5 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe("turretPivotOf (TR6)", () => {
  it("is the car centre for the shipped zero mount", () => {
    expect(turretPivotOf({ x: 100, y: 50, angle: 1.2 }, "mirage")).toEqual({ x: 100, y: 50 });
  });

  it("rotates a non-zero mount with the car", () => {
    const p = turretPivotOf({ x: 0, y: 0, angle: Math.PI / 2 }, "mirage", { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(10, 9);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @motor-combat-moba/shared -- src/config/turret-config.test.ts src/sim/weapons/turret.test.ts`
Expected: FAIL. The modules do not exist.

- [ ] **Step 3: Implement**

`packages/shared/src/config/turret-config.ts`:

```ts
import { TICK_RATE_HZ } from "../constants.js";

/**
 * The turret muzzle (spec TR1). A weapon row opts in with `turret` (`WeaponBase.turret`); these are
 * the knobs every turret shares.
 *
 * `defaultOffset` is world units from the turret's PIVOT (`CarDef.turretMount`) to its barrel tip
 * at the shipped drawn size (the client's `TURRET_VISUAL.lengthUnits`). It is a sim number because
 * the server spawns the shot there; resizing the art does not move it — line the two up in
 * `?dev=assets`, which draws the spawn point on the barrel (TR45).
 */
export const TURRET_CONFIG = {
  turnRateDegPerSec: 540,
  defaultOffset: 25,
} as const;

/** `TURRET_CONFIG` resolved to the tick grid once. Radians per tick. */
export const TURRET_TICKS = {
  turnPerTick: (TURRET_CONFIG.turnRateDegPerSec * Math.PI) / 180 / TICK_RATE_HZ,
} as const;
```

In `weapon-types.ts`, above `WeaponBase`:

```ts
/**
 * Fires from the car's turret along a player-chosen world bearing (spec TR2). Presence IS the flag.
 * `additionalOffset` pushes the spawn point further out along the line of fire, on top of
 * `TURRET_CONFIG.defaultOffset`. Legal only on a single-muzzle projectile row (TR3,
 * `turret-config.test.ts`).
 */
export interface TurretDef {
  additionalOffset: number;
}
```

Inside `WeaponBase`, after `muzzles?`:

```ts
  /** Fire from the turret rather than a fixed muzzle (spec TR2). Absent = a fixed muzzle. */
  turret?: TurretDef;
```

In `weapon-config.ts`, add `turret: { additionalOffset: 0 },` to `BASIC_ATTACK_BASE` (after `pellets`) and to the `predator`, `magmablast` and `thumper` rows.

In `types.ts` `CarDef`, before `isActive`:

```ts
  /**
   * Where the turret sits on the hull, car-local world units: `x` along the heading, `y` along the
   * car's +y in the sim frame (spec TR5). The line of fire is measured from here, not the centre.
   */
  turretMount: { x: number; y: number };
```

In `car-config.ts`, add `turretMount: { x: 0, y: 0 },` to all nine rows (before `isActive`), and below `isCarId`:

```ts
const NO_MOUNT = { x: 0, y: 0 } as const;

/** The turret mount of a chassis; the centre for an unknown id (spec TR5). */
export function turretMountOf(carId: string): { x: number; y: number } {
  return isCarId(carId) ? CAR_TABLE[carId].turretMount : NO_MOUNT;
}
```

`packages/shared/src/sim/weapons/turret.ts`:

```ts
import { turretMountOf } from "../../config/car-config.js";

const TAU = Math.PI * 2;

/** Normalise an angle into (-pi, pi]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/**
 * The turret mount's world point for a pose (spec TR6). The ONLY place the car-local -> world
 * rotation of the mount is written: the sim's spawn, the client's turret drawing and the crosshair
 * bearing all call this. `mount` is a test seam; production callers leave it to default.
 */
export function turretPivotOf(
  pose: { x: number; y: number; angle: number },
  carId: string,
  mount: { x: number; y: number } = turretMountOf(carId),
): { x: number; y: number } {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return { x: pose.x + mount.x * c - mount.y * s, y: pose.y + mount.x * s + mount.y * c };
}
```

Export from `packages/shared/src/index.ts`, following the file's existing grouping:
- `export { TURRET_CONFIG, TURRET_TICKS } from "./config/turret-config.js";`
- `export { turretPivotOf, wrapAngle } from "./sim/weapons/turret.js";`
- add `turretMountOf` to the existing `car-config.js` export
- add `TurretDef` to the `weapon-types.js` type exports.

- [ ] **Step 4: Run the shared suite**

Run: `npm test -w @motor-combat-moba/shared && npm run typecheck -w @motor-combat-moba/shared`
Expected: all green. If a `satisfies Record<CarId, CarDef>` error appears, a row is missing `turretMount`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): turret config, the weapon turret flag, and the car mount (TR1-TR6)"
```

---

### Task 2: The turn phase in the fire state machine (TR7–TR9, TR11–TR16)

**Files:**
- Modify: `packages/shared/src/sim/weapons/fire.ts`
- Modify: `packages/shared/src/sim/weapons/turret.ts` (add `turnTurret`)
- Modify: `packages/shared/src/sim/weapons/instances.ts` (`ShotOrder`, ~line 107: add `bearing?`)
- Modify: `packages/shared/src/index.ts` (export `turnTurret`)
- Test: `packages/shared/src/sim/weapons/turret.test.ts`

**Interfaces:**
- Consumes: `wrapAngle`, `TURRET_TICKS` (Task 1).
- Produces:
  - `FireState.turretAngle: number` (car-relative, (−π, π]; `newFireState` → 0)
  - `PendingFire.bearing?: number | null` (world; absent or null = not a turret press)
  - `PendingFire.aligned?: boolean` (absent = aligned)
  - `ShotOrder.bearing?: number | null`
  - `beginFire(sessionId, state, mask, tick, aimBearing: number | null = null, carAngle = 0): FireState`
  - `turnTurret(state: FireState, carAngle: number, tick: number, step = TURRET_TICKS.turnPerTick): FireState`

- [ ] **Step 1: Write the failing tests**

Append to `turret.test.ts`. Mirage's kit is `["magmablast", "thunderclap", "afterburner"]`, with the basic attack at index 0, so fire slot 1 is magmablast (turret) and slot 3 is afterburner (fixed). These tests avoid slot 0 because it depends on `BASIC_ATTACK_CONFIG.enabled`.

```ts
import { TURRET_TICKS } from "../../config/turret-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import { beginFire, newFireState, releaseShots, tickRecharge, type FireState } from "./fire.js";
import { turnTurret } from "./turret.js";

const step = TURRET_TICKS.turnPerTick;
function mirage(): FireState {
  return newFireState("mirage", 1);
}

describe("beginFire captures a bearing for a turret weapon (TR12)", () => {
  it("freezes the wire bearing and waits for the turret", () => {
    const s = beginFire("a", mirage(), 1 << 1, 10, 1.0, 0);
    expect(s.pending?.bearing).toBe(1.0);
    expect(s.pending?.aligned).toBe(false);
    expect(s.pending?.nextShotTick).toBe(Number.POSITIVE_INFINITY);
    expect(s.slots[1]!.stocks).toBe(0); // a press is still a commitment
  });

  it("falls back to where the turret already points when no aim came in", () => {
    const s = beginFire("a", { ...mirage(), turretAngle: 0.5 }, 1 << 1, 10, null, 1.0);
    expect(s.pending?.bearing).toBeCloseTo(1.5, 12);
  });

  it("leaves a fixed-muzzle weapon exactly as before", () => {
    const s = beginFire("a", mirage(), 1 << 3, 10, 1.0, 0);
    expect(s.pending?.bearing ?? null).toBeNull();
    expect(s.pending?.aligned ?? true).toBe(true);
    expect(s.pending?.nextShotTick).toBe(10 + weaponTicksOf("afterburner").startUp);
  });
});

describe("turnTurret (TR13-TR14)", () => {
  it("fires on the press tick when the turret already points at the bearing", () => {
    let s = beginFire("a", mirage(), 1 << 1, 10, 0, 0);
    s = turnTurret(s, 0, 10);
    expect(s.pending?.aligned).toBe(true);
    expect(s.pending?.nextShotTick).toBe(10 + weaponTicksOf("magmablast").startUp);
    expect(releaseShots(s, 10).orders).toHaveLength(1);
  });

  it("turns at most one step per tick, then counts the wind-up from alignment", () => {
    const target = step * 3.5;
    let s = beginFire("a", mirage(), 1 << 1, 0, target, 0);
    for (let t = 0; t < 3; t++) {
      s = turnTurret(s, 0, t);
      expect(s.turretAngle).toBeCloseTo(step * (t + 1), 12);
      expect(s.pending?.aligned).toBe(false);
      expect(releaseShots(s, t).orders).toHaveLength(0);
    }
    s = turnTurret(s, 0, 3);
    expect(s.turretAngle).toBeCloseTo(target, 12);
    expect(s.pending?.aligned).toBe(true);
    expect(s.pending?.nextShotTick).toBe(3 + weaponTicksOf("magmablast").startUp);
  });

  it("takes the short way across +-pi", () => {
    let s: FireState = { ...mirage(), turretAngle: Math.PI - step / 2 };
    s = beginFire("a", s, 1 << 1, 0, -Math.PI + step / 2, 0);
    s = turnTurret(s, 0, 0);
    expect(s.pending?.aligned).toBe(true);
    expect(s.turretAngle).toBeCloseTo(-Math.PI + step / 2, 9);
  });

  it("aims at a WORLD bearing, so a car that turned changes the relative target", () => {
    let s = beginFire("a", mirage(), 1 << 1, 0, 1.0, 0);
    s = turnTurret(s, 1.0, 0);
    expect(s.turretAngle).toBeCloseTo(0, 12);
    expect(s.pending?.aligned).toBe(true);
  });

  it("keeps tracking the bearing after alignment while the car turns", () => {
    let s = beginFire("a", mirage(), 1 << 1, 0, 0, 0);
    s = turnTurret(s, 0, 0);
    s = { ...s, pending: { ...s.pending!, nextShotTick: 99 } }; // pretend a long wind-up
    s = turnTurret(s, step / 2, 1);
    expect(s.turretAngle).toBeCloseTo(-step / 2, 12);
    expect(s.pending?.nextShotTick).toBe(99); // alignment is decided once
  });

  it("holds the car-relative angle when nothing is pending (D2)", () => {
    const s: FireState = { ...mirage(), turretAngle: 0.7 };
    expect(turnTurret(s, 2.0, 5)).toBe(s);
  });

  it("ignores a fixed-muzzle press", () => {
    const s = beginFire("a", { ...mirage(), turretAngle: 0.7 }, 1 << 3, 5, 1.0, 0);
    expect(turnTurret(s, 0, 5).turretAngle).toBe(0.7);
  });

  it("does not start a stock recharge while the turret turns (TR16)", () => {
    let s = beginFire("a", mirage(), 1 << 1, 0, Math.PI, 0);
    s = tickRecharge(s, 1);
    expect(s.slots[1]!.rechargeEndsTick).toBe(0);
  });
});

describe("releaseShots carries the bearing (TR9)", () => {
  it("copies the frozen bearing onto the order", () => {
    let s = beginFire("a", mirage(), 1 << 1, 0, 0.25, 0.25);
    s = turnTurret(s, 0.25, 0);
    expect(releaseShots(s, 0).orders[0]!.bearing).toBe(0.25);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w @motor-combat-moba/shared -- src/sim/weapons/turret.test.ts`
Expected: FAIL. `turnTurret` is not exported, and the new fields do not exist.

- [ ] **Step 3: Implement**

`fire.ts`:
- Module doc: change the order line to `tickRecharge -> beginFire -> turnTurret -> releaseShots`, and add one paragraph. A turret press is committed by `beginFire` with `nextShotTick = +Infinity`, and `turnTurret` (in `turret.ts`) sets the real one on the first tick the turret is on the bearing, so wind-up counts from alignment (spec TR11–TR13).
- `PendingFire` adds:

```ts
  /**
   * The world bearing a turret press was aimed along, frozen at press time (spec D5, TR8). Absent or
   * `null` for a fixed-muzzle weapon.
   */
  bearing?: number | null;
  /**
   * `false` while the turret is still turning toward `bearing` (TR13); `releaseShots` refuses to
   * release until it is true (TR14). Absent means aligned — every fixed-muzzle press.
   */
  aligned?: boolean;
```

- `FireState` adds:

```ts
  /**
   * The turret's angle RELATIVE to the car's heading, radians in (-pi, pi] (spec TR7). Held between
   * shots, so the turret turns with the hull (D2); only `turnTurret` moves it. Mirrored to
   * `PlayerState.turretAngle` for drawing.
   */
  turretAngle: number;
```

- `newFireState` returns `turretAngle: 0`.
- `beginFire`: add `aimBearing: number | null = null, carAngle = 0` to the parameters and document both. Its return becomes:

```ts
    const turret = def.turret !== undefined;
    return {
      ...state,
      slots: state.slots.map((s, i) => (i === index ? { ...s, stocks: s.stocks - 1 } : s)),
      lastFiredSlot: index,
      pending: {
        weaponId: slot.weaponId,
        slot: index,
        shotsLeft: volleys,
        // A turret press waits for `turnTurret` to name the real tick (TR12/TR13).
        nextShotTick: turret ? Number.POSITIVE_INFINITY : tick + weaponTicksOf(slot.weaponId).startUp,
        pressId: `${sessionId}#${tick}#${index}`,
        bearing: turret ? (aimBearing ?? carAngle + state.turretAngle) : null,
        aligned: !turret,
      },
    };
```

- `releaseShots`: the first line becomes
  `if (!pending || pending.aligned === false || tick < pending.nextShotTick) return { state, orders: [] };`
  and the order literal gains `bearing: pending.bearing ?? null,`.

`instances.ts`, in `ShotOrder`:

```ts
  /**
   * The turret press's frozen world bearing (spec TR9), or absent/null for a fixed muzzle. The only
   * carrier of the bearing from the fire state machine to `spawnInstances`.
   */
  bearing?: number | null;
```

`turret.ts`, add (`fire.ts` must NOT import `turret.ts`; this direction only):

```ts
import { TURRET_TICKS } from "../../config/turret-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import type { FireState } from "./fire.js";

/**
 * One tick of the turret (spec TR13). Pure. With a pending turret press, turn toward the frozen world
 * bearing along the shortest arc, at most `step` per tick, snapping when within one step. The first
 * tick on target marks the press aligned and starts its wind-up. With nothing to aim at the turret
 * holds its car-relative angle (D2), which is why a fixed-muzzle press leaves it alone.
 */
export function turnTurret(
  state: FireState,
  carAngle: number,
  tick: number,
  step: number = TURRET_TICKS.turnPerTick,
): FireState {
  const pending = state.pending;
  if (!pending || pending.bearing === null || pending.bearing === undefined) return state;
  const target = wrapAngle(pending.bearing - carAngle);
  const delta = wrapAngle(target - state.turretAngle);
  const arrived = Math.abs(delta) <= step;
  const turretAngle = arrived ? target : wrapAngle(state.turretAngle + Math.sign(delta) * step);
  if (pending.aligned !== false || !arrived) return { ...state, turretAngle };
  return {
    ...state,
    turretAngle,
    pending: { ...pending, aligned: true, nextShotTick: tick + weaponTicksOf(pending.weaponId).startUp },
  };
}
```

Export `turnTurret` from `index.ts` beside `turretPivotOf`.

- [ ] **Step 4: Fix typecheck fallout, run the suites**

`FireState.turretAngle` is required, so every hand-built `FireState` literal in tests must gain `turretAngle: 0`. Find them with `npm run typecheck -w @motor-combat-moba/shared` and (after `npm run build -w @motor-combat-moba/shared`) `npm run typecheck -w @motor-combat-moba/server`. Add the field; do not make it optional.

Run: `npm test -w @motor-combat-moba/shared`
Expected: green, including the existing `fire.test.ts`. Every fixed-muzzle behaviour is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src packages/server/src
git commit -m "feat(shared): the turret turn phase between press and wind-up (TR7-TR16)"
```

---

### Task 3: Spawning from the turret, and wiring runCombat (TR18–TR20, the combat half of TR24)

**Files:**
- Modify: `packages/shared/src/sim/weapons/instances.ts` (`spawnInstances`, lines ~173–281)
- Modify: `packages/shared/src/sim/combat.ts` (`CombatPlayer` ~44; phase 3 ~438–505)
- Modify: every `spawnInstances` caller whose positional arguments shift: `packages/shared/src/sim/weapons/instances.test.ts`, `hits.test.ts`, `sim/status/channels.test.ts`, `packages/server/src/bot/brain/solution.ts`, `solution.test.ts` (`scripts/manual-page.test.mjs` passes only four arguments and needs no change)
- Test: `packages/shared/src/sim/weapons/instances.test.ts`, `packages/shared/src/sim/combat.test.ts` (existing; add cases)

**Interfaces:**
- Consumes: `turretPivotOf`, `TURRET_CONFIG`, `ShotOrder.bearing`, `turnTurret`, `beginFire(…, aimBearing, carAngle)`.
- Produces:
  - `spawnInstances(order, owner, tick, seq, damageMult = 1, homingTargetId = "", def = weaponDefOf(order.weaponId), world?: { obstacles: readonly Aabb[]; bounds: Bounds }): { instances; seq }`. The old 5th parameter `aimAngle` is **gone**.
  - `CombatPlayer.aimBearing?: number | null`

- [ ] **Step 1: Write the failing tests**

In `instances.test.ts`, add the block below. Find the obstacle type with `grep -n "interface Aabb" -r packages/shared/src` and match its fields (the literal assumes `minX/minY/maxX/maxY`). For `bounds`, reuse exactly what that file's bounce tests build (search the file for `bounds`).

```ts
import { TURRET_CONFIG } from "../../config/turret-config.js";

describe("turret spawn (TR18-TR19)", () => {
  const owner = { sessionId: "a", team: 0 as const, carId: "mirage", x: 100, y: 100, angle: 0 };
  const d = TURRET_CONFIG.defaultOffset;

  it("spawns along the bearing from the pivot, not from the nose", () => {
    const order = { weaponId: "magmablast" as const, slot: 1, finalVolley: true, pressId: "p", bearing: Math.PI / 2 };
    const [shot] = spawnInstances(order, owner, 0, 0).instances;
    expect(shot!.x).toBeCloseTo(100, 9);
    expect(shot!.y).toBeCloseTo(100 + d, 9);
    expect(shot!.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(shot!.muzzleDir).toBeCloseTo(Math.PI / 2, 12);
  });

  it("uses the heading when a turret order carries no bearing", () => {
    const order = { weaponId: "magmablast" as const, slot: 1, finalVolley: true, pressId: "p" };
    const [shot] = spawnInstances(order, owner, 0, 0).instances;
    expect(shot!.x).toBeCloseTo(100 + d, 9);
    expect(shot!.y).toBeCloseTo(100, 9);
  });

  it("never spawns a shot on the far side of a wall", () => {
    const wall = { minX: 110, minY: 0, maxX: 120, maxY: 200 };
    const order = { weaponId: "magmablast" as const, slot: 1, finalVolley: true, pressId: "p", bearing: 0 };
    const [shot] = spawnInstances(order, owner, 0, 0, 1, "", undefined, { obstacles: [wall], bounds: BOUNDS }).instances;
    expect(shot!.x).toBeLessThanOrEqual(110);
  });
});
```

(`BOUNDS` is whatever `Bounds` value the file already builds; define one at the top of the block if it has none.)

In `combat.test.ts`, add one case. Build the input the same way that file's existing fire tests do: a mirage player with `fireMask: 1 << 1`, `aimBearing: Math.PI / 2`, `angle: 0`. Assert:
- after tick 0, no `magmablast` instance exists, because the turret is turning;
- threading `fireState`, the instances and `fireMask: 0` into successive ticks exactly as the neighbouring tests do, one exists within `Math.ceil((Math.PI / 2) / TURRET_TICKS.turnPerTick) + 1` ticks (the +1 absorbs float rounding at an exact multiple; at 540°/s and 30 Hz the turn is exactly 5 steps of 18°), with `angle ≈ π/2`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w @motor-combat-moba/shared -- src/sim/weapons/instances.test.ts src/sim/combat.test.ts`
Expected: FAIL. The shots come from the nose, and the combat test sees a shot on tick 0 along the heading.

- [ ] **Step 3: Implement `spawnInstances`**

- Replace the signature with the one in **Produces**. Delete the `aimAngle` doc paragraph (the lock/aim-assist prose, A11b/A11c) and the two comments inside the loop that mention it. Replace them with one sentence: fixed muzzles exit along the heading plus their offset, and a turret row exits along the order's frozen bearing from the turret pivot (spec TR18).
- Replace the per-muzzle geometry with a list of exits:

```ts
  // One exit per fixed muzzle, or the turret's single exit along the frozen bearing (spec TR18).
  const exits: { x: number; y: number; axis: number; dir: number }[] = [];
  if (def.turret) {
    const bearing = order.bearing ?? owner.angle;
    const pivot = turretPivotOf(owner, owner.carId);
    let reach = TURRET_CONFIG.defaultOffset + def.turret.additionalOffset;
    // TR19: never born through a wall. At the wall face it dies (or detonates) on its first step,
    // exactly as a shot flying into that wall would.
    if (world) reach = Math.min(reach, wallClipDistance(pivot.x, pivot.y, bearing, reach, world.obstacles, world.bounds));
    exits.push({
      x: pivot.x + Math.cos(bearing) * reach,
      y: pivot.y + Math.sin(bearing) * reach,
      axis: bearing,
      dir: bearing - owner.angle,
    });
  } else {
    for (const dir of muzzleDirs) {
      const exitHeading = owner.angle + dir;
      exits.push({
        x: owner.x + Math.cos(exitHeading) * nose,
        y: owner.y + Math.sin(exitHeading) * nose,
        axis: owner.angle + dir,
        dir,
      });
    }
  }
  for (const exit of exits) {
    for (let i = 0; i < pellets; i++) {
      const angle = exit.axis + fanOffset(i, pellets, spread);
      next += 1;
      // ...the existing instance literal, unchanged except:
      //    x: exit.x, y: exit.y, angle, muzzleDir: exit.dir,
    }
  }
```

- Import `turretPivotOf` from `./turret.js` and `TURRET_CONFIG` from `../../config/turret-config.js`. There is no cycle: `turret.ts` imports only `fire.ts`'s type and config.

- [ ] **Step 4: Fix every caller of the removed parameter**

Each call that passed a 5th argument drops it: `(order, owner, t, s, null, 1, "", def)` becomes `(order, owner, t, s, 1, "", def)`, and `(…, 0, 1, "victim", rocket)` becomes `(…, 1, "victim", rocket)`. Delete the `instances.test.ts` cases that exercised `aimAngle` itself (near lines 276–292; they spawn with `Math.PI / 4` and `Math.PI / 3`): the parameter no longer exists. Read `solution.ts`'s call (~line 240) and drop only an `aimAngle` argument if it has one.

**Tests that used `magmablast` as a generic nose projectile** (the one-liners in `instances.test.ts` around lines 37–143, and possibly `hits.test.ts` / `channels.test.ts`) now get a turret origin. For each failing assertion, decide which of two cases it is:
- It is about generic projectile behaviour (spawn seq, ids, damage scaling, expiry): switch the weapon to `roadblock`, a fixed-muzzle projectile, and keep the assertion.
- It is specifically about magmablast (explosion tests): update the expected position to the turret origin.

Do not loosen any assertion.

- [ ] **Step 5: Wire `runCombat`**

- `CombatPlayer` gains:

```ts
  /**
   * The world bearing this tick's press was aimed along (spec TR24), or null/absent when the input
   * carried none. Read only when a press commits a turret weapon.
   */
  aimBearing?: number | null;
```

- Phase 3 (~452): `beginFire(player.sessionId, player.fireState, player.fireMask & ~blocked, world.tick, player.aimBearing ?? null, player.angle)`.
- Directly after the `if (!mods.disarmed) { … }` block and **before** `releaseShots`:

```ts
    // TR11/TR15: the turret turns every tick a turret press is pending, disarmed or not — a turn in
    // progress finishes like a wind-up does.
    player.fireState = turnTurret(player.fireState, player.angle, world.tick);
```

- The `spawnInstances` call becomes `spawnInstances(order, player, world.tick, instanceSeq, mods.damageDealt, "", undefined, { obstacles: world.obstacles, bounds: world.bounds })`. Rewrite the comment above it: the exit angle is the heading for fixed muzzles and the frozen bearing for the turret.

- [ ] **Step 6: Run the suites**

Run: `npm run build -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/server`
Expected: shared green. Server: only the baseline's pre-existing red cases.

- [ ] **Step 7: Commit**

```bash
git add packages
git commit -m "feat(shared): spawn turret shots along the frozen bearing, never through a wall (TR18-TR20)"
```

---

### Task 4: The wire, the server tick, and the schema mirror (TR10, TR17, TR21–TR24)

**Files:**
- Modify: `packages/shared/src/net/input.ts`
- Modify: `packages/shared/src/schema/PlayerState.ts`
- Modify: `packages/server/src/net/input-message.ts`
- Modify: `packages/server/src/sim/tick.ts` (`TickResult` ~32; drain loop ~225–241)
- Modify: `packages/server/src/sim/combat-bridge.ts` (`toCombatPlayers` ~108; the write-back ~237–242)
- Modify: `packages/server/src/rooms/tick-pipeline.ts` (~95–179)
- Modify: `docs/schema-reference.md`, `docs/networking.md`
- Test: `input-message.test.ts`, `tick.test.ts`, `combat-bridge.test.ts`, `tick-pipeline.test.ts` beside their modules (extend the existing files; create one only if missing)

**Interfaces:**
- Consumes: `CombatPlayer.aimBearing`, `FireState.turretAngle`, `PendingFire.aligned`.
- Produces:
  - `InputMessage.aimAngle?: number`
  - `PlayerState.turretAngle: number` (`@type("number")`)
  - `TickResult.aims: Map<string, number>`
  - `toCombatPlayers(state, roster, masks, memory, aims: ReadonlyMap<string, number> = new Map())`
  - `combatTick(ctx, dt, masks, contact, aims: ReadonlyMap<string, number> = new Map())`, appended to its existing parameter list

- [ ] **Step 1: Write the failing tests**

`input-message.test.ts`:

```ts
it("accepts an absent or finite aimAngle and rejects anything else (TR22)", () => {
  const base = { seq: 1, steer: 0, throttle: 0, fireSlots: 0 };
  expect(isInputMessage(base)).toBe(true);
  expect(isInputMessage({ ...base, aimAngle: 1.25 })).toBe(true);
  expect(isInputMessage({ ...base, aimAngle: Number.NaN })).toBe(false);
  expect(isInputMessage({ ...base, aimAngle: Infinity })).toBe(false);
  expect(isInputMessage({ ...base, aimAngle: "1" })).toBe(false);
});
```

`tick.test.ts`: set up the way the file's existing fire-mask tests do (one player in `RoomPhase.MATCH`, `IN_MATCH`, `alive`). Add three cases:
- A batch `[{seq:1, fireSlots:0, aimAngle:0.1}, {seq:2, fireSlots:2, aimAngle:0.2}, {seq:3, fireSlots:2, aimAngle:0.3}]` → `result.aims.get(id) === 0.2`. Seq 2 is the last input whose **pressed** mask was non-zero; seq 3 only holds the button.
- A pressing input with no `aimAngle` → `result.aims.has(id) === false`.
- A pressing input beyond `NET_CONFIG.maxInputsPerTick` → contributes no aim.

`combat-bridge.test.ts`:
- After a combat result whose fire state has `turretAngle: 0.4`, `player.turretAngle === 0.4`.
- With `pending: { …, aligned: false, nextShotTick: Number.POSITIVE_INFINITY }`, `player.pendingUntilTick === state.tick + 1`.
- `toCombatPlayers(…, aims)` puts `aims.get(id)` on `aimBearing`, and `null` when absent.

`tick-pipeline.test.ts`: one integration test, following the file's existing setup. A mirage car at angle 0 in a MATCH arena state gets a queued input `{ fireSlots: 1 << 1, aimAngle: Math.PI / 2 }` on the first tick, then the same held mask. Assert:
- after the first tick, no magmablast instance exists;
- within `Math.ceil((Math.PI / 2) / TURRET_TICKS.turnPerTick) + 1` ticks (the +1 absorbs float rounding at an exact multiple; at 540°/s and 30 Hz the turn is exactly 5 steps of 18°) one exists, with `angle ≈ π/2`;
- the player's `turretAngle` ≈ π/2.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/server -- src/net src/sim/tick.test.ts src/sim/combat-bridge.test.ts src/rooms/tick-pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`input.ts`, in `InputMessage`:

```ts
  /**
   * World bearing, radians, from the driven car's turret pivot to the crosshair (spec TR21). Sent on
   * every input; the server reads it only off an input whose fire mask carried a new press (TR23).
   * Absent = "fire where the turret already points".
   */
  aimAngle?: number;
```

`PlayerState.ts`, after `lastFiredSlot`:

```ts
  /**
   * The turret's angle relative to the heading, radians (spec TR10). Mirrored from the server-only
   * `FireState.turretAngle`. Render-only: `stepSim` never reads it, so invariant 8 does not apply and
   * the client does not predict it.
   */
  @type("number") turretAngle = 0;
```

`input-message.ts`: add
`(rec.aimAngle === undefined || (typeof rec.aimAngle === "number" && Number.isFinite(rec.aimAngle)))`
to the conjunction.

`tick.ts`:
- `TickResult` gains:

```ts
  /**
   * Per session id, the `aimAngle` of the LAST simulated input this tick whose fire mask carried a
   * new press (spec TR23). Absent when that input carried no aim — the press then fires where the
   * turret already points (TR12).
   */
  aims: Map<string, number>;
```

- Create `const aims = new Map<string, number>();` beside `masks`. In the capped branch, after `pressed` is computed:
  `if (pressed !== 0 && msg.aimAngle !== undefined) aims.set(sessionId, msg.aimAngle);`
- Return `{ masks, aims, approachVelocities }`.

`combat-bridge.ts`:
- `toCombatPlayers` takes the extra `aims` parameter and adds `aimBearing: aims.get(sessionId) ?? null,` next to `fireMask`.
- In the write-back, replace the `pendingUntilTick` line and add the mirror:

```ts
    // A turret still turning has no real release tick yet (+Infinity, which a uint32 cannot hold);
    // `tick + 1` keeps "mid-press" true for the HUD until it aligns (spec TR17).
    const pending = p.fireState.pending;
    player.pendingUntilTick =
      pending === null ? 0 : pending.aligned === false ? state.tick + 1 : pending.nextShotTick;
    player.turretAngle = p.fireState.turretAngle;
```

`tick-pipeline.ts`: destructure `aims` from `serverTick`, and pass it through `combatTick` to `toCombatPlayers`. The pipeline's return value keeps only `masks`; nothing downstream needs `aims`.

Docs: add a `turretAngle` row to `docs/schema-reference.md`'s `PlayerState` table (render-only, TR10), and an `aimAngle` line to the input-message section of `docs/networking.md`.

- [ ] **Step 4: Run the suites**

Run: `npm run build -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/server`
Expected: green apart from the baseline's red cases.

- [ ] **Step 5: Commit**

```bash
git add packages docs
git commit -m "feat(server): carry the aim bearing on the wire and mirror the turret angle (TR10, TR17, TR21-TR24)"
```

---

### Task 5: The bot aims its turret (TR25–TR28)

**Files:**
- Modify: `packages/server/src/bot/types.ts` (`BotIntent`)
- Modify: `packages/server/src/bot/brain/controller.ts` (~line 572 builds the intent). Find where an intent becomes an `InputMessage` with `grep -rn "intent.fireSlots\|fireSlots: intent" packages/server/src`.
- Modify: `packages/server/src/bot/brain/humanize.ts` (it rebuilds intents with `{ ...intent, fireSlots: 0 }`; confirm `aimAngle` survives the spread and is dropped only where firing is)
- Modify: `packages/server/src/bot/brain/solution.ts` (the firing solution)
- Modify: `packages/server/src/bot/brain/duel.fixture.ts` (~252, forward `aimAngle` into the input it builds; ~263, into `aimBearing` on the combat player it builds)
- Modify: `packages/server/src/config/bot-profiles.ts:805` (`BOT_BRAIN_VERSION` → `"6.2.0"`)
- Test: `packages/server/src/bot/brain/solution.test.ts`, `controller.test.ts`

**Interfaces:**
- Consumes: `turretPivotOf`, `TURRET_CONFIG`, `TURRET_TICKS`, `wrapAngle`, `WeaponDef.turret`, `spawnInstances(order with bearing, …)`.
- Produces: `BotIntent.aimAngle?: number`, set whenever the chosen slot's weapon has `turret`.

Read `solution.ts` end to end before editing. It predicts the target (`constantVelocityPredictor`) and simulates candidate shots through `spawnInstances` at a `heading`. The turret changes one assumption: **for a turret weapon the shot direction is a free bearing from the turret pivot**, not the hull heading, and the press only releases after the turret has turned.

- [ ] **Step 1: Write the failing tests**

In `solution.test.ts`, following the file's existing shooter/target fixtures:
- **Stationary target.** A turret weapon (the shooter's basic attack, with `BASIC_ATTACK_CONFIG.enabled` forced on the way that suite's other basic-attack tests do, or `magmablast` on mirage). The target is stationary, 90° off the shooter's heading, in range, with a clear line. The solution is fireable, with a bearing within `1e-3` of `atan2(target − pivot)`.
- **Moving target.** The same, with the target crossing. The bearing leads the target: it differs from the bearing to the target's current position, and a shot simulated along it (`spawnInstances` with that `bearing`) comes within the target's hull at the predicted time. That time includes the turn, `|wrapAngle(bearing − (heading + turretAngle))| / TURRET_TICKS.turnPerTick` ticks.
- **Fixed muzzle unchanged.** A fixed-muzzle weapon (`roadblock` on bastion) keeps its heading-bound behaviour. An existing test may already pin this; make sure it still passes.

In `controller.test.ts`: a bot whose chosen slot is a turret weapon emits `intent.aimAngle`. It equals the solution's bearing under a zero-error profile, and is within the profile's error bound otherwise (follow how `aim.ts`'s error is sampled and tested today).

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w @motor-combat-moba/server -- src/bot/brain/solution.test.ts src/bot/brain/controller.test.ts`
Expected: the new cases FAIL.

- [ ] **Step 3: Implement**

- `BotIntent.aimAngle?: number`, documented as: "World bearing for a turret weapon (spec TR25); absent for fixed muzzles."
- In the solver, branch on `weaponDefOf(slot.weaponId).turret`:
  - **Turret branch.**
    1. Estimate the arrival time as turn ticks + (distance − `TURRET_CONFIG.defaultOffset`) / `speed`.
    2. Aim at the predicted target position at that time.
    3. Iterate the lead two or three times, as a fixed point: the same way the heading-bound lead is solved, if it has one.
    4. Validate through `spawnInstances` with `bearing` set on the order, exactly as the heading branch validates. The hull does not need to face the target.
  - **Everything else** keeps today's path.
- The controller applies the tier's existing aim error to the solved bearing and puts the result on `intent.aimAngle`. Sample the same way `aim.ts` does today, in radians.
- Forward `aimAngle` wherever an intent becomes an `InputMessage`, and in `duel.fixture.ts`.
- `BOT_BRAIN_VERSION = "6.2.0"`. If there is a changelog comment beside it, add: "turret aim: bearing solved from the pivot, turn time budgeted (spec TR26)".

- [ ] **Step 4: Run the whole server suite**

Run: `npm test -w @motor-combat-moba/server`
Expected: the new tests pass. Compare every red case with the baseline log. Tier-comparison cases in `tiers.test.ts` and `controller.test.ts` **may move**, since bots now free-aim. For each case whose state differs from the baseline, record the before/after values in your report. **Do not retune `BOT_PROFILES`**: that is a `bot-tuner` pass the user decides on.

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(bot): aim turret weapons by bearing and budget the turret turn (TR25-TR28)"
```

---

### Task 6: One control layout, and the basic attack comes on (TR29, TR30, TR46)

**Files:**
- Modify: `packages/shared/src/config/weapon-config.ts:59` (`BASIC_ATTACK_CONFIG.enabled: true`)
- Modify: `packages/client/src/config/slot-keys.ts`
- Modify: `packages/client/src/scenes/movement-hint.ts` (`actionKeysFor` / `actionAltsFor`, ~39–45)
- Modify: `packages/client/src/scenes/ArenaScene.ts` (~975–981 the MMB listener; ~1180 the pause-key comment; ~514 the stale "SHIFT" comment; any `keyGlyph` read, e.g. `drawHudSlot` ~3260)
- Test: `packages/client/src/config/slot-keys.test.ts`, `packages/client/src/scenes/movement-hint.test.ts` (existing)

**Interfaces:**
- Produces: `SLOT_KEYS: readonly { readonly codes: readonly number[]; readonly buttonsMask: number; readonly glyph: string }[]` (no `keyGlyph`).

Follow `.claude/skills/basic-attack-toggle/SKILL.md` for the flag flip. Read it first; it lists every place the flag reaches. Its manual-rebuild step and its `CLAUDE.md` prose step are **deferred to Task 10**, which rebuilds once for this whole change. So `scripts/manual-page.test.mjs` is expected to fail on the stale stamp from here until Task 10. Say so in your report.

- [ ] **Step 1: Write the failing tests**

In `slot-keys.test.ts`, replace the layout assertions with:

```ts
it("binds exactly one layout: LMB, RMB, Q, E, Space (TR29)", () => {
  expect(SLOT_KEYS.map((k) => k.glyph)).toEqual(["LMB", "RMB", "Q", "E", "SPACE"]);
  expect(SLOT_KEYS.map((k) => k.buttonsMask)).toEqual([1, 2, 0, 0, 0]);
  expect(SLOT_KEYS.map((k) => [...k.codes])).toEqual([[], [], [81], [69], [32]]);
});

it("maps held inputs to fire slots, capped at maxFireSlots", () => {
  expect(slotMaskFrom([], 1)).toBe(1 << 0);
  expect(slotMaskFrom([], 2)).toBe(1 << 1);
  expect(slotMaskFrom([false, false, true])).toBe(1 << 2);
  expect(slotMaskFrom([false, false, false, true])).toBe(1 << 3);
  expect(slotMaskFrom([false, false, false, false, true])).toBe(0); // slot 4 inert while N = 3
});

it("teaches the basic attack first now it is on (TR30)", () => {
  expect(HINT_SLOT_ORDER).toEqual([0, 1, 2, 3]);
});
```

Delete the assertions about `H`/`J`/`K`/`L`/`;`/MMB/`keyGlyph`. In `movement-hint.test.ts`, the action hint reads `LMB RMB Q E`, with one label per slot and no alternates.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/client -- src/config/slot-keys.test.ts src/scenes/movement-hint.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`slot-keys.ts`:

```ts
export const SLOT_KEYS: readonly { readonly codes: readonly number[]; readonly buttonsMask: number; readonly glyph: string }[] = [
  { codes: [], buttonsMask: 1, glyph: "LMB" },
  { codes: [], buttonsMask: 2, glyph: "RMB" },
  { codes: [81], buttonsMask: 0, glyph: "Q" },
  { codes: [69], buttonsMask: 0, glyph: "E" },
  { codes: [32], buttonsMask: 0, glyph: "SPACE" },
];
```

Rewrite its doc comment to say:
- There is one layout (spec TR29).
- The basic attack takes LMB back now that it is on.
- The abilities are RMB/Q/E, with Space bound for a fourth ability and inert while `N` is 3.
- The glyph is the only label.
- BA19's no-pill rule for the basic attack stands, so the countdown hint is where LMB is taught.

Keep the keyCode and `buttonsMask` explanations. Delete the paragraphs about J-K-L-;, MMB, `keyGlyph` and the basic attack "giving LMB up".

`movement-hint.ts`: `actionKeysFor` returns the glyphs, and `actionAltsFor` returns no alternates. If the hint renderer draws alternates, remove that branch rather than leaving an empty one.

`ArenaScene.ts`:
- Delete the MMB `mousedown` `preventDefault` listener and its comment.
- Keep `disableContextMenu`, and update its comment: RMB is ability 1.
- Fix the stale P-key comment (Q/E/Space now; P stays free) and the stale "SHIFT" comment.
- Replace any `keyGlyph` read with `glyph`.

`weapon-config.ts`: `BASIC_ATTACK_CONFIG = { enabled: true }`, and update its doc comment's "ships false" wording. Do every other step `basic-attack-toggle/SKILL.md` lists, except the two deferred to Task 10.

- [ ] **Step 4: Run the suites**

Run: `npm run build -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/client && npm test -w @motor-combat-moba/server`
Expected: green apart from the baseline's red cases. The bot now presses slot 0, so compare the tier tests to Task 5's report and record any further movement.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat: one control layout (LMB/RMB/Q/E/Space) and the basic attack switched on (TR29, TR30, TR46)"
```

---

### Task 7: Pointer lock, the crosshair, the aim bearing, and the menu (TR31–TR40)

**Files:**
- Create: `packages/client/src/input/pointer-lock.ts`, `pointer-lock.test.ts`
- Create: `packages/client/src/input/aim.ts`, `aim.test.ts`
- Create: `packages/client/src/config/crosshair.ts`
- Create: `packages/client/src/scenes/crosshair.ts`
- Modify: `packages/client/src/ui/screens/pause.ts` (+ `pause.test.ts`; create it if missing), and the CSS that styles `.dialog-backdrop` (find it with `grep -rn "dialog-backdrop" packages/client/src packages/client/index.html`)
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`create` ~965; `pumpInput` ~1702; `pumpPauseKey` ~1727; `syncPauseOverlay` ~1740; `sendInputTick` ~1830; `update`; shutdown)
- Modify: `packages/client/src/dev/playground/overlay.ts` (~768–789 the menu's Resume; ~1087–1115 the P handler)

**Interfaces:**
- Consumes: `turretPivotOf` (shared), `MSG_PRACTICE_PAUSE`, the playground pause message (`grep -rn "PLAYGROUND_PAUSE" packages/shared/src`), `isSimPaused`, `isPracticeRoom`, `isPlaygroundRoom`.
- Produces:
  - `pointer-lock.ts`:
    - `LockState`
    - `LockEvent`
    - `initialLock(w, h)`
    - `reduceLock(s, e): { state: LockState; openMenu: boolean }`
    - `fireButtons(s, buttons): number`
  - `aim.ts`: `aimBearingOf(pivot, world, fallback): number`
  - `config/crosshair.ts`: `CROSSHAIR_STYLE`
  - `scenes/crosshair.ts`: `drawCrosshair(g, x, y): void`
  - `pause.ts`: `renderPause(handlers, variant: "paused" | "overlay" = "paused")`

- [ ] **Step 1: Write the failing tests**

`pointer-lock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fireButtons, initialLock, reduceLock } from "./pointer-lock.js";

describe("pointer lock reducer (TR31)", () => {
  it("starts unlocked, cursor at the canvas centre, and fires no mouse button", () => {
    const s = initialLock(800, 600);
    expect(s.cursor).toEqual({ x: 400, y: 300 });
    expect(fireButtons(s, 1)).toBe(0);
  });

  it("swallows the click that acquired the lock until it is released", () => {
    let s = reduceLock(initialLock(800, 600), { type: "acquired", buttons: 1 }).state;
    expect(fireButtons(s, 1)).toBe(0);
    s = reduceLock(s, { type: "buttons", buttons: 0 }).state;
    expect(fireButtons(s, 1)).toBe(1);
    expect(fireButtons(s, 2)).toBe(2);
  });

  it("integrates movement, clamped to the canvas", () => {
    let s = reduceLock(initialLock(800, 600), { type: "acquired", buttons: 0 }).state;
    s = reduceLock(s, { type: "move", dx: 50, dy: -20, w: 800, h: 600 }).state;
    expect(s.cursor).toEqual({ x: 450, y: 280 });
    s = reduceLock(s, { type: "move", dx: 9999, dy: 9999, w: 800, h: 600 }).state;
    expect(s.cursor).toEqual({ x: 800, y: 600 });
  });

  it("ignores movement while unlocked", () => {
    const s = reduceLock(initialLock(800, 600), { type: "move", dx: 50, dy: 0, w: 800, h: 600 }).state;
    expect(s.cursor.x).toBe(400);
  });

  it("opens the menu when the lock is lost unasked (Esc, alt-tab)", () => {
    const locked = reduceLock(initialLock(800, 600), { type: "acquired", buttons: 0 }).state;
    const lost = reduceLock(locked, { type: "lost" });
    expect(lost.openMenu).toBe(true);
    expect(lost.state.locked).toBe(false);
  });

  it("does not open the menu for a release the game asked for", () => {
    let s = reduceLock(initialLock(800, 600), { type: "acquired", buttons: 0 }).state;
    s = reduceLock(s, { type: "release" }).state;
    const lost = reduceLock(s, { type: "lost" });
    expect(lost.openMenu).toBe(false);
    expect(lost.state.releasing).toBe(false);
  });

  it("keeps the cursor across an unlock", () => {
    let s = reduceLock(initialLock(800, 600), { type: "acquired", buttons: 0 }).state;
    s = reduceLock(s, { type: "move", dx: 10, dy: 10, w: 800, h: 600 }).state;
    s = reduceLock(s, { type: "lost" }).state;
    expect(s.cursor).toEqual({ x: 410, y: 310 });
  });
});
```

`aim.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { aimBearingOf } from "./aim.js";

describe("aimBearingOf (TR33)", () => {
  it("is the bearing from the pivot to the world point", () => {
    expect(aimBearingOf({ x: 0, y: 0 }, { x: 0, y: 10 }, 0)).toBeCloseTo(Math.PI / 2, 12);
  });
  it("falls back when the cursor sits on the pivot", () => {
    expect(aimBearingOf({ x: 5, y: 5 }, { x: 5, y: 5 }, 1.3)).toBe(1.3);
  });
});
```

`pause.test.ts`. Client tests run in node, so copy the DOM environment setup from an existing `ui/screens/*.test.ts` (e.g. an `@vitest-environment` pragma). Assert:
- `renderPause(h)` has title "Paused" and Resume/Exit buttons;
- `renderPause(h, "overlay")` has title "Menu" and Resume/Exit buttons, and its root carries the class `overlay-translucent`;
- clicking each button calls its handler.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w @motor-combat-moba/client -- src/input src/ui/screens/pause.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the pure modules**

`pointer-lock.ts`:

```ts
/**
 * Pointer lock as a pure reducer (spec TR31). `ArenaScene` feeds it DOM events and reads back the
 * cursor, the buttons it may fire with, and whether to open the menu.
 *
 * - A lock needs a user gesture, so the first click on the canvas asks for it — and that click never
 *   fires: every button down when the lock arrives is swallowed until it is released.
 * - While locked, the cursor is integrated from movementX/Y and clamped to the canvas.
 * - Losing the lock unasked (the browser's Esc, alt-tab, focus loss) opens the menu; a release the
 *   game asked for (`release`, e.g. the menu opening) does not.
 */
export interface LockState {
  locked: boolean;
  /** Mouse buttons held when the lock arrived; ignored until released. */
  swallow: number;
  /** Virtual cursor, canvas pixels. */
  cursor: { x: number; y: number };
  /** The game asked for the lock to go; the next `lost` is expected. */
  releasing: boolean;
}

export type LockEvent =
  | { type: "acquired"; buttons: number }
  | { type: "lost" }
  | { type: "release" }
  | { type: "move"; dx: number; dy: number; w: number; h: number }
  | { type: "buttons"; buttons: number };

export function initialLock(w: number, h: number): LockState {
  return { locked: false, swallow: 0, cursor: { x: w / 2, y: h / 2 }, releasing: false };
}

export function reduceLock(s: LockState, e: LockEvent): { state: LockState; openMenu: boolean } {
  switch (e.type) {
    case "acquired":
      return { state: { ...s, locked: true, swallow: e.buttons, releasing: false }, openMenu: false };
    case "release":
      return { state: { ...s, releasing: true }, openMenu: false };
    case "lost":
      return { state: { ...s, locked: false, swallow: 0, releasing: false }, openMenu: s.locked && !s.releasing };
    case "move": {
      if (!s.locked) return { state: s, openMenu: false };
      const x = Math.min(e.w, Math.max(0, s.cursor.x + e.dx));
      const y = Math.min(e.h, Math.max(0, s.cursor.y + e.dy));
      return { state: { ...s, cursor: { x, y } }, openMenu: false };
    }
    case "buttons":
      return { state: { ...s, swallow: s.swallow & e.buttons }, openMenu: false };
  }
}

/** Mouse buttons that may fire: none while unlocked, and never a swallowed one. */
export function fireButtons(s: LockState, buttons: number): number {
  return s.locked ? buttons & ~s.swallow : 0;
}
```

`aim.ts`:

```ts
/** World bearing from the turret pivot to the crosshair's world point (spec TR33). */
export function aimBearingOf(
  pivot: { x: number; y: number },
  world: { x: number; y: number },
  fallback: number,
): number {
  const dx = world.x - pivot.x;
  const dy = world.y - pivot.y;
  return dx === 0 && dy === 0 ? fallback : Math.atan2(dy, dx);
}
```

`config/crosshair.ts`:

```ts
/** The crosshair's look (spec TR32), screen pixels. White with a dark outline, to read on both floors. */
export const CROSSHAIR_STYLE = {
  radius: 10,
  dotRadius: 1.5,
  /** Gap between the dot and where each arm starts. */
  armGap: 4,
  /** How far each arm runs past the circle. */
  armOverhang: 5,
  lineWidth: 2,
  outlineWidth: 4,
  color: 0xffffff,
  outlineColor: 0x101014,
} as const;
```

`scenes/crosshair.ts`:

```ts
import type Phaser from "phaser";
import { CROSSHAIR_STYLE as C } from "../config/crosshair.js";

/** Circle, centre dot, four arms running from near the dot out past the circle (spec TR32). */
export function drawCrosshair(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.clear();
  const reach = C.radius + C.armOverhang;
  for (const [width, color] of [
    [C.outlineWidth, C.outlineColor],
    [C.lineWidth, C.color],
  ] as const) {
    g.lineStyle(width, color, 1);
    g.strokeCircle(x, y, C.radius);
    g.lineBetween(x + C.armGap, y, x + reach, y);
    g.lineBetween(x - C.armGap, y, x - reach, y);
    g.lineBetween(x, y + C.armGap, x, y + reach);
    g.lineBetween(x, y - C.armGap, x, y - reach);
    g.fillStyle(color, 1);
    g.fillCircle(x, y, color === C.outlineColor ? C.dotRadius + 1 : C.dotRadius);
  }
}
```

`pause.ts`: add `variant: "paused" | "overlay" = "paused"`. For `"overlay"`, the backdrop's class is `"dialog-backdrop overlay-translucent"` and the title is `"Menu"`. Add a `.overlay-translucent` rule beside `.dialog-backdrop`'s styles with a background of about `rgba(10, 10, 16, 0.35)`. The `.dialog` panel keeps its opaque background, so its text stays readable (TR38). Update the doc comment: two variants, the practice pause (mounted off `state.paused`) and the arena's non-pausing menu.

- [ ] **Step 4: Run the pure-module tests**

Run: `npm test -w @motor-combat-moba/client -- src/input src/ui/screens/pause.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `ArenaScene`**

Add scene fields: `lock: LockState`, `crosshair?: Phaser.GameObjects.Graphics`, `arenaMenuOpen = false`, `arenaMenu?: ScreenOverlay`. Then:

1. **In `create`**, after the input bindings:
   - `this.lock = initialLock(cam.width, cam.height)`, using the main camera's size in game pixels.
   - Register the four listeners below, remove them all on the scene's `shutdown` event, and call `document.exitPointerLock()` if the canvas holds the lock (TR40):
     - `canvas.addEventListener("mousedown", onDown)`: if `!this.lock.locked && !this.menuOpen(room)`, call `canvas.requestPointerLock()`.
     - `document.addEventListener("pointerlockchange", onChange)`: if `document.pointerLockElement === canvas`, dispatch `acquired` with `this.input.mousePointer?.buttons ?? 0`. Otherwise dispatch `lost`, and if the result's `openMenu` is true, call `this.openMenu(room)`.
     - `document.addEventListener("mousemove", onMove)`: dispatch `move` with `movementX/Y`, scaled from CSS pixels to game pixels by `cam.width / canvas.clientWidth` and `cam.height / canvas.clientHeight`, and `w/h` = the camera size.
     - `document.addEventListener("mouseup", onUp)`: dispatch `buttons` with `event.buttons`.
   - Create `this.crosshair = this.add.graphics().setScrollFactor(0).setDepth(D)`, where `D` is one above the highest `setDepth` this scene uses for its HUD (grep `setDepth(`). Name it as a constant beside the scene's other depth constants.
2. **`menuOpen(room)`**: `isPracticeRoom(room) || isPlaygroundRoom(room) ? isSimPaused(room.state) : this.arenaMenuOpen`.
3. **`openMenu(room)`**. Dispatch `release`, call `document.exitPointerLock()`, then:
   - Practice, if not paused: `room.send(MSG_PRACTICE_PAUSE)`.
   - Playground, if not paused: send exactly what `overlay.ts`'s P handler sends.
   - Arena: set `this.arenaMenuOpen = true`, and render `renderPause({ onResume, onExit }, "overlay").root` into `this.arenaMenu ??= new ScreenOverlay(this)`.
     - `onResume`: destroy the overlay, set `arenaMenuOpen = false`, then `this.game.canvas.requestPointerLock()`. The click is the gesture.
     - `onExit`: `void room.leave()`. `exitTarget` stays unset, so `onLeave` routes to `"join"` (D4).
4. **P** (`pumpPauseKey`), on `JustDown(P)`:
   - Practice: today's `room.send(MSG_PRACTICE_PAUSE)`, plus dispatch `release` and `document.exitPointerLock()` when the room is not already paused.
   - Arena: if the menu is closed, `openMenu(room)`. If it is open, close it the same way `onResume` does, **without** the relock: a keypress is not a gesture the browser accepts for pointer lock, so the next canvas click relocks.
   - Playground: nothing here; `overlay.ts` owns P.
   - Practice's `syncPauseOverlay` Resume becomes `() => { room.send(MSG_PRACTICE_PAUSE); this.game.canvas.requestPointerLock(); }`.
5. **Aim and input** (`sendInputTick`):
   - `pivot = turretPivotOf(<the driven car's rendered pose>, local.carId)`. Read the rendered pose the way `renderCars` does for the driven car (the predicted/interpolated body), not the raw schema.
   - `world = this.cameras.main.getWorldPoint(this.lock.cursor.x, this.lock.cursor.y)`.
   - `aimAngle: aimBearingOf(pivot, world, local.angle + local.turretAngle)`.
   - `fireSlots` passes `fireButtons(this.lock, this.input.mousePointer?.buttons ?? 0)` as the mouse argument. Keyboard slots are unaffected by the lock.
   - **TR34:** if `this.menuOpen(room)`, send `{ seq, steer: 0, throttle: 0, fireSlots: 0, aimAngle }` and predict with it, instead of reading keys. Practice and the playground still stop earlier at `pumpInput`'s pause gate; keep that gate.
6. **Crosshair, per frame in `update`:** if `this.lock.locked`, the driven car is `alive` with status `IN_MATCH`, and the menu is closed, call `drawCrosshair(this.crosshair, cursor.x, cursor.y)` and show it. Otherwise hide it.

`overlay.ts` (playground):
- When the P handler's action pauses, call `document.exitPointerLock()`.
- The menu's Resume button handler also relocks: `game.canvas.requestPointerLock()`. Check how `overlay.ts` reaches the Phaser game or scene. If it cannot, use `document.querySelector<HTMLCanvasElement>("canvas")`.

- [ ] **Step 6: Typecheck, test, and exercise in the browser**

Run: `npm run build -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/client && npm run typecheck -w @motor-combat-moba/client`
Expected: green.

Then start the dev server with the browser preview tools. Use `preview_start`, and create `.claude/launch.json` running `npm run dev` on port 5173 if it is missing. Open `http://localhost:5173/?dev=playground` and check:
- a canvas click locks the pointer, and that click does not fire;
- the crosshair follows the mouse;
- LMB fires the basic attack toward the crosshair after a short turn (the turret is not drawn until Task 9, so judge by the shot's direction);
- P pauses and shows the cursor, and Resume relocks;
- Esc opens the menu.

An automated browser may refuse pointer lock. If `requestPointerLock` rejects, record that, then verify the non-lock paths: the menu, neutral input, and Q/E firing toward the canvas-centre cursor. **Never claim lock behaviour you did not observe.**

- [ ] **Step 7: Commit**

```bash
git add packages/client .claude/launch.json
git commit -m "feat(client): pointer lock, crosshair, mouse aim and a menu in every room (TR31-TR40)"
```

---

### Task 8: The turret art pipeline (TR41, TR43, TR44)

**Files:**
- Modify: `scripts/import-art.mjs` (+ its test, e.g. `scripts/import-art.test.mjs`)
- Modify: `.claude/skills/process-car-asset/SKILL.md` and `.claude/skills/process-car-asset/scripts/preflight.mjs`
- Modify: `scripts/check-art.mjs` (+ `scripts/check-art.test.mjs`)
- Modify: `packages/client/src/assets/asset-keys.ts` (+ its test)
- Create (via the importer): `packages/client/public/art/turrets/default.png`; a `turret.default` row in `packages/client/public/art/manifest.json`

**Interfaces:**
- Produces:
  - `turretSpriteKeys(carId: string): readonly [string, string]`, i.e. `["turret.<carId>", "turret.default"]`, the resolution order.
  - Manifest rows `turret.<id>`: `{ file: "turrets/<id>.png", origin: [x, y], ... }`.

- [ ] **Step 1: Read the existing pipeline**

Read `scripts/import-art.mjs` and `.claude/skills/process-car-asset/SKILL.md` end to end. Note three things: how the car path picks its output size (the long edge for the 60 × 40 hull at 2 px/u), how it preserves hand-tuned manifest fields, and how `preflight.mjs` gates.

- [ ] **Step 2: Write the failing tests**

- **`import-art` test**, following the existing test's style:
  - `--turret` with id `default` writes `art/turrets/default.png` and upserts `turret.default`.
  - The output's long edge is `TURRET_TARGET_PX`. Define it beside the car constant as 72, with the derivation in a comment: 36 u × 2 px/u.
  - The aspect ratio is preserved, and the pixels are desaturated.
  - A re-import preserves a hand-edited `origin`.
  - A first import writes `origin: [0.31, 0.5]` for `default` (the default image's mount plate) and the schema default for any other id.
- **`check-art` test:**
  - A `turret.*` row naming a missing file is a blocker, and so is one whose PNG has no alpha.
  - A turret row is in the `cars` scope.
- **`asset-keys` test:** `turretSpriteKeys("mirage")` → `["turret.mirage", "turret.default"]`.

- [ ] **Step 3: Run to verify they fail**

Run: `node --test scripts/import-art.test.mjs scripts/check-art.test.mjs && npm test -w @motor-combat-moba/client -- src/assets`
Expected: FAIL.

- [ ] **Step 4: Implement**

- `import-art.mjs`: parse `--turret`. In turret mode:
  - the id may be `default` or any car id;
  - the output is `turrets/<id>.png` and the manifest key `turret.<id>`;
  - the size target is `TURRET_TARGET_PX` on the long edge;
  - skip the car-only hull-coverage check (`MIN_HULL_COVERAGE`).

  Trim, desaturate (unless `--keep-color`) and `--key-background` behave as for cars.
- `preflight.mjs`: accept `--turret` and skip the hull-fit warnings for it.
- `check-art.mjs`: treat `turret.` keys like `car.` keys, for the alpha and missing-file blockers, the tint warnings, and the `cars` scope.
- `asset-keys.ts`: add `turretSpriteKeys`.
- `SKILL.md`: add a "Turret art" section covering:
  - the command: `node scripts/import-art.mjs <image> <carId|default> --turret`;
  - the art faces +x;
  - the manifest `origin` is the rotation pivot, so put it on the mount plate and tune it in `?dev=assets`;
  - the turret-spawn dot there should sit on the barrel tip, and if it doesn't, tune `TURRET_CONFIG.defaultOffset`, `CarDef.turretMount` or `TURRET_VISUAL.lengthUnits`;
  - a car with no turret row falls back to `turret.default`, then to a procedural turret.
- Import the default turret:

```bash
npm run build -w @motor-combat-moba/shared
node .claude/skills/process-car-asset/scripts/preflight.mjs "E:/Work/PROJECT DOCS/car racer/assets/turrets/default-turret.png" default --turret
node scripts/import-art.mjs "E:/Work/PROJECT DOCS/car racer/assets/turrets/default-turret.png" default --turret
```

Open the written `packages/client/public/art/turrets/default.png` with the Read tool and look at it: greyscale, trimmed tight, barrel on the right. Confirm that `turret.default` has `origin: [0.31, 0.5]`.

- [ ] **Step 5: Run the checks**

Run: `npm run check:art && npm run test:scripts`
Expected: `check:art` reports no blockers. `test:scripts` is green apart from the stale manual stamp (Task 10).

- [ ] **Step 6: Commit**

```bash
git add scripts .claude/skills/process-car-asset packages/client/public/art packages/client/src/assets
git commit -m "feat(art): turret art pipeline, and the default turret imported (TR41, TR43, TR44)"
```

---

### Task 9: Drawing the turret, and the ?dev=assets alignment overlay (TR42, TR45)

**Files:**
- Create: `packages/client/src/config/turret-visual.ts`
- Create: `packages/client/src/scenes/turret-visual.ts`, `turret-visual.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`drawCar` ~2339–2390, `spriteFor` ~2397, the per-frame tint ~2269, the death fade, the preload of car textures)
- Modify: `packages/client/src/dev/AssetTuningScene.ts`

**Interfaces:**
- Consumes: `turretSpriteKeys`, `turretPivotOf`, `TURRET_CONFIG`, `wrapAngle`, `PlayerState.turretAngle`.
- Produces:
  - `TURRET_VISUAL = { lengthUnits: 36 } as const`
  - `turretDisplayLength(scale: "fit" | number): number`
  - `easeTurretAngle(shown: number, target: number, dtSeconds: number): number`

- [ ] **Step 1: Write the failing test**

`turret-visual.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TURRET_CONFIG } from "@motor-combat-moba/shared";
import { easeTurretAngle, turretDisplayLength } from "./turret-visual.js";

const rate = (TURRET_CONFIG.turnRateDegPerSec * Math.PI) / 180;

describe("turret visual (TR42)", () => {
  it("sizes the turret from the manifest scale", () => {
    expect(turretDisplayLength("fit")).toBe(36);
    expect(turretDisplayLength(1.5)).toBe(54);
  });
  it("eases toward the networked angle at the turret's own rate", () => {
    expect(easeTurretAngle(0, 1, 0.01)).toBeCloseTo(rate * 0.01, 9);
    expect(easeTurretAngle(0, 0.001, 0.1)).toBe(0.001);
  });
  it("takes the short way, and snaps across a respawn-sized jump", () => {
    expect(easeTurretAngle(3.1, -3.1, 0.001)).toBeGreaterThan(3.1 - 1e-9);
    expect(easeTurretAngle(0, 3, 0.001)).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- src/scenes/turret-visual.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`config/turret-visual.ts`:

```ts
/**
 * How long the turret is drawn, world units, before the manifest row's numeric `scale` (spec TR42).
 * NOT the sim's spawn offset: `TURRET_CONFIG.defaultOffset` is tuned to put the shot on this length's
 * barrel tip, and `?dev=assets` draws the spawn dot to show whether the two still agree (TR45).
 */
export const TURRET_VISUAL = { lengthUnits: 36 } as const;
```

`scenes/turret-visual.ts`:

```ts
import { TURRET_CONFIG, wrapAngle } from "@motor-combat-moba/shared";
import { TURRET_VISUAL } from "../config/turret-visual.js";

const RATE = (TURRET_CONFIG.turnRateDegPerSec * Math.PI) / 180;

export function turretDisplayLength(scale: "fit" | number): number {
  return scale === "fit" ? TURRET_VISUAL.lengthUnits : TURRET_VISUAL.lengthUnits * scale;
}

/**
 * The drawn turret chases the networked one at the turret's own turn rate — what the sim does between
 * patches (spec TR42). A gap wider than a quarter turn is a respawn or a lost patch, not a turn, so it
 * snaps.
 */
export function easeTurretAngle(shown: number, target: number, dtSeconds: number): number {
  const delta = wrapAngle(target - shown);
  if (Math.abs(delta) > Math.PI / 2) return target;
  const max = RATE * dtSeconds;
  return Math.abs(delta) <= max ? target : wrapAngle(shown + Math.sign(delta) * max);
}
```

`ArenaScene.ts`:
- Keep a turret display object per car beside its car sprite, stored and destroyed the same way.
- **Texture.** Resolve it through `turretSpriteKeys(carId)` against the loaded manifest and textures, following how `spriteFor` / `resolveCarSprite` resolve and fall back for a car. Preload `turret.*` textures wherever `car.*` textures are preloaded.
- **Procedural fallback** (no texture): a `Graphics` rounded block at the pivot, plus a barrel rectangle running `TURRET_CONFIG.defaultOffset` along +x.
- **Per frame, per car:**
  - `shown = easeTurretAngle(shown, player.turretAngle, deltaSeconds)`, stored per car;
  - position `turretPivotOf(rendered pose, carId)`, rotation `rendered angle + shown`;
  - display long edge `turretDisplayLength(entry.scale)`, aspect from the texture, origin from the row;
  - depth just above the car sprite;
  - tint: when the row's `colorMode` is `"tint"`, the same four-corner lit car fill the hull gets (~2269);
  - alpha and visibility follow the car's, including the death fade.

`AssetTuningScene.ts`:
- Draw each car's turret at its mount, facing forward.
- Draw a small contrasting dot at `pivot + defaultOffset` along +x (the turret-shot spawn point for `additionalOffset: 0`), labelled "turret spawn" in the tool's existing label style.
- Show the resolved turret key (`turret.<id>`, `turret.default` or `procedural`) wherever the tool reports a car's resolved key.

- [ ] **Step 4: Test, then look at it**

Run: `npm test -w @motor-combat-moba/client && npm run typecheck -w @motor-combat-moba/client`
Expected: green.

In the browser preview:
- `http://localhost:5173/?dev=assets`: the turret sits on each car. Report where the spawn dot lands relative to the barrel tip; the user tunes it.
- `?dev=playground`: the turret is tinted in the car's colour, turns toward a click, and the shot leaves its barrel.

Take a screenshot of each and send both to the user with the SendUserFile tool.

- [ ] **Step 5: Commit**

```bash
git add packages/client
git commit -m "feat(client): draw the tinted turret on every car, and the spawn-point overlay in ?dev=assets (TR42, TR45)"
```

---

### Task 10: The guide, the docs, and the finish line (TR47–TR52)

**Files:**
- Modify: `scripts/build-cars-and-weapons.mjs` (the weapon stat rows ~620–640; `balanceStamp` inputs)
- Regenerate: `packages/client/public/manual.html` (`npm run build:manual`)
- Modify: root `CLAUDE.md`, `docs/combat-model.md`, `docs/config-reference.md`, `docs/asset-pipeline.md`
- Modify: `docs/superpowers/specs/2026-09-21-mouse-aim-turret-design.md` (status line → implemented)

- [ ] **Step 1: The Aim stat point (TR47)**

In the weapon stat-row builder, after the Range row:

```js
  if (d.turret) {
    rows.push(["Aim", `turret <span class="sub">mouse; turns at ${TURRET_CONFIG.turnRateDegPerSec}°/s before firing</span>`]);
  }
```

Import `TURRET_CONFIG` from built shared, the same way the script imports its other tables. Add `TURRET_CONFIG` to `balanceStamp`'s inputs; per that function's own doc, every input is something the page prints. If `manual-page.test.mjs` asserts the row set per weapon, extend it: a turret row prints "Aim", and a fixed-muzzle row does not.

- [ ] **Step 2: Rebuild and run the scripts suite**

```bash
npm run build -w @motor-combat-moba/shared
npm run build:manual
npm run test:scripts
```

Expected: green, with the basic-attack cards now on the page and the stamp matching. If `manual-page.test.mjs`'s reach check moved because turret rows now start at `pivot + 25`, read why before changing anything: the published range is the table's `range`, measured from the spawn point.

- [ ] **Step 3: Docs (TR48)**

- `docs/combat-model.md`: a "Turret muzzle" subsection covering the six muzzle kinds, the frozen world bearing, turn-then-wind-up, the pivot and the two offsets, the wall clamp, and the fallback when no aim arrives.
- `docs/config-reference.md`: `TURRET_CONFIG` (both knobs), `CarDef.turretMount`, `WeaponBase.turret`.
- `docs/asset-pipeline.md`: the `turret.<id>` / `turret.default` rows, the pivot `origin`, `--turret`, and the procedural fallback.
- Root `CLAUDE.md`: a minimal factual edit of the basic-attack paragraphs.
  - The basic attack **ships on** as of 2026-09-21, bound to **LMB**.
  - The abilities are **RMB / Q / E**, with Space inert at `N` 3.
  - `H`, J/K/L, `;` and MMB are unbound.
  - Correct each sentence that says it ships `false` or describes the old key hands.
  - Add one short paragraph for this spec: the turret muzzle, pointer lock and the arena overlay menu.
  - Add a row to "Read the right doc".
  - Do not rewrite history paragraphs beyond what became false.

- [ ] **Step 4: Full verification (TR52)**

```bash
npm run build
npm test
npm run check:art
```

Compare `npm test`'s red cases with the baseline log line by line; name any difference and its cause.

Then exercise the running game in the browser, in all three room kinds, with screenshots as proof:
- **Arena:** two tabs join one match. The overlay menu opens, the sim keeps running behind it, and Exit lands on the join screen while the other tab sees the car leave.
- **Practice:** P and Esc pause, and Resume relocks.
- **Playground:** the same checks as practice.

Stop the preview server when done.

- [ ] **Step 5: Commit**

```bash
git add scripts packages/client/public/manual.html docs CLAUDE.md
git commit -m "docs: the turret muzzle, one control layout, and the rebuilt guide (TR47-TR52)"
```

- [ ] **Step 6: The final report must say, loudly**

- **Playtest probes (TR49):** `packages/server/playtest/weapons.ts`, `weapons2.ts` and `geometry.ts` now measure turret rows from `pivot + 25` rather than the nose. Recommend `npm run playtest`.
- **Balance:** every earlier balance report is incomparable (`BOT_BRAIN_VERSION` 6.2.0, basic attack on, free aim). Recommend `npm run balance`.
- **Bot tier tests:** every one whose state changed, with before/after values from Tasks 5 and 6.
- **Netcode rewrite plans (TR50):** `aimAngle` and `turretAngle` need rows in that work's `interfaces.md` when it runs.
- **Tuning left to the user:** `defaultOffset`, `turretMount`, the turret `origin` and `lengthUnits`, lined up by eye in `?dev=assets`.
