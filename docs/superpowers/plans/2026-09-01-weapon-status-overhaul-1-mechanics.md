# Weapon/Status Overhaul — Plan 1 of 3: Mechanics Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every sim mechanic the new roster needs — aim lead, per-weapon assist range, multi-muzzle, homing, bounce, the bar hitbox, the maneuver block (dash/hold/charge), hard slam, and stun interruption — behind the existing nine-weapon roster, fully unit-tested.

**Architecture:** All rules live in `@motor-combat-moba/shared`; server bridges map schema onto POJOs and hold no rules. Maneuver state is four networked `PlayerState` fields that `stepDrive` integrates (server-authoritative onset, spec decision O13). The contact pass extends the ram pipeline: a pure `resolveContacts` classifies each fresh hull contact as dash-hit / slam / ordinary ram, and the bridge feeds the resulting damage into `runCombat` through a new `contactHits` input beside the existing `statusRequests` seam.

**Tech Stack:** TypeScript 5.5, npm workspaces, vitest 2, Colyseus schema.

**Spec:** `docs/superpowers/specs/2026-09-01-weapon-status-overhaul-design.md` — read it first; task rationale ("O2", "S3") refers to its decision numbers.

## Global Constraints

- Shared is consumed as built `dist`: after editing `packages/shared/src`, run `npm run build -w @motor-combat-moba/shared` before running **server or client** tests, and before `npm run build:manual`.
- Final verification is root `npm test` (per-workspace runs silently skip suites) plus root `npm run typecheck`.
- No magic numbers in sim logic — every tunable goes in a shared config table. Durations are authored in **milliseconds** and converted exactly once via `msToTicks`.
- Enum values networked as uint8 are explicit and stable; never renumber (`ManeuverKind` below).
- Invariant 8: anything `stepSim` reads is a networked schema field. The four maneuver fields are; homing targets, damage clocks, and slam immunity clocks are server-only.
- **Any edit to `WEAPON_TABLE` moves `balanceStamp`** — run `npm run build:manual` and commit `packages/client/public/manual.html` in the same commit (Task 1 does this).
- This plan must leave shipped gameplay unchanged **except aim lead** (spec S1: assisted projectiles now lead moving targets — the one intended live behavior change). Everything else lands dormant until Plan 3's roster.
- Playtest probes (`packages/server/playtest/`): fix compile breaks on the spot; do NOT update thresholds/expectations — flag them loudly in the execution summary instead.
- `docs/turn-tuning.md` must NOT need edits (no `DRIVE_CONFIG`/`CAR_TABLE`-rating/`RAM_CONFIG`-value changes in this plan). If `scripts/turn-tuning-doc.test.mjs` fails, the implementation is wrong.
- New shared exports must be re-exported from `packages/shared/src/index.ts` — server and client import the package root only.
- Every commit ends with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## Testing seams (read before Task 5)

No shipped weapon row uses the new mechanics until Plan 3, and `spawnInstances` / `stepInstance` / `instanceExpired` resolve their `WeaponDef` from the table by id. To keep the mechanics unit-testable now, those three functions gain an **optional trailing `def` parameter defaulting to the table lookup** — the same dependency-injection move `stepDrive` made when it started taking a resolved `ChassisDrive` instead of reading `CAR_TABLE`. Tests inject synthetic defs; production callers pass nothing and are byte-for-byte unchanged. `resolveContacts` (Task 11) is designed table-free from the start: everything it needs (`slamsStunned`, weapon ids) arrives resolved on its input cars. Where a path is genuinely unreachable until Plan 3 wires a real row (e.g. `isUnInterruptable: true`), the task says so and the coverage note goes in the execution summary — this mirrors the repo's existing "tested through a borrowed row" honesty in `docs/combat-model.md`.

---

### Task 1: Weapon-def vocabulary and table guards

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts`
- Modify: `packages/shared/src/config/weapon-config.ts`
- Modify: `packages/shared/src/config/weapon-ticks.ts`
- Modify: `packages/shared/src/config/weapon-config.test.ts`
- Modify: `packages/shared/src/config/weapon-ticks.test.ts`
- Commit (regenerated): `packages/client/public/manual.html`

**Interfaces:**
- Produces: `WeaponBase.aimRangeUnits?: number`, `WeaponBase.muzzles?: readonly number[]` (degrees off heading, absent = `[0]`), `WeaponBase.isUnInterruptable?: boolean`, `BeamWeaponDef.holdsDuringFire?: boolean`, `ProjectileWeaponDef.homing?: HomingDef`, `ProjectileWeaponDef.bounce?: BounceDef`, `ManeuverWeaponDef` (third member of `WeaponDef`), `WeaponTicks.homingDuration/bounceLifetime/maneuverDuration: number`.
- Six existing assisted rows author `aimRangeUnits: 400`.

- [ ] **Step 1: Write the failing tests** — add to `weapon-config.test.ts`:

```ts
describe("per-weapon aim range (spec S1)", () => {
  it("pairs aimRangeUnits with usesAimAssist, both ways", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      if (def.usesAimAssist) {
        expect(def.aimRangeUnits, `${def.id} uses aim assist and must author aimRangeUnits`).toBeGreaterThan(0);
      } else {
        expect(def.aimRangeUnits, `${def.id} must not author aimRangeUnits without usesAimAssist`).toBeUndefined();
      }
    }
  });

  it("keeps every assisted weapon's range at or beyond its own aim range", () => {
    // Replaces the old `range >= AIM_CONFIG.lockRange` guard: the lock is now bounded per weapon.
    for (const def of Object.values(WEAPON_TABLE)) {
      if (!def.usesAimAssist || def.kind === "maneuver") continue;
      expect(def.range, `${def.id}`).toBeGreaterThanOrEqual(def.aimRangeUnits!);
    }
  });
});

describe("new-mechanic guards (vacuous until plan 3's rows land — they gate authoring, not code)", () => {
  it("keeps multi-muzzle weapons off aim assist", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      if ((def.muzzles?.length ?? 1) > 1) expect(def.usesAimAssist, def.id).toBe(false);
    }
  });
  it("requires aim assist on homing weapons", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      if (def.kind === "projectile" && def.homing) expect(def.usesAimAssist, def.id).toBe(true);
    }
  });
  it("bounds a bounce lifetime under its own cooldown, so two instances never coexist", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      if (def.kind === "projectile" && def.bounce) expect(def.bounce.lifetimeMs, def.id).toBeLessThan(def.cooldownMs);
    }
  });
  it("bounds a charge duration under its own cooldown", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      if (def.kind === "maneuver" && def.maneuver.type === "charge") {
        expect(def.maneuver.durationMs, def.id).toBeLessThan(def.cooldownMs);
      }
    }
  });
  it("requires a dash to author positive speed and an aim range (its distance)", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      if (def.kind === "maneuver" && def.maneuver.type === "dash") {
        expect(def.speed, def.id).toBeGreaterThan(0);
        expect(def.aimRangeUnits, def.id).toBeGreaterThan(0);
      }
    }
  });
});
```

Find the existing per-row assertions that check `range >= AIM_CONFIG.lockRange` (grep `lockRange` in `weapon-config.test.ts`) and delete/replace them with the pair above. If the existing per-row loop asserts positive `speed`/`range` for every row unconditionally, scope those two assertions to `def.kind !== "maneuver"` (damage stays positive for all kinds).

Add to `weapon-ticks.test.ts`:

```ts
it("derives zero homing/bounce/maneuver ticks for every current row", () => {
  for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
    const t = weaponTicksOf(id);
    expect(t.homingDuration).toBe(0);
    expect(t.bounceLifetime).toBe(0);
    expect(t.maneuverDuration).toBe(0);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts src/config/weapon-ticks.test.ts`
Expected: FAIL — `aimRangeUnits` does not exist / new tick fields undefined.

- [ ] **Step 3: Implement.** In `weapon-types.ts`:

```ts
/** Homing guidance for a projectile fired with a lock (spec: Homing). */
export interface HomingDef {
  /** Max steering rate toward the frozen target, degrees per second. The counterplay dial. */
  turnRateDegPerSec: number;
  /** Guidance window after spawn. Afterwards the shot flies straight forever. */
  durationMs: number;
}

/** Wall-bouncing flight: reflect off level geometry; expire on this clock instead of at `range`. */
export interface BounceDef {
  /** Total flight time. Guarded < `cooldownMs` so two instances can never coexist. */
  lifetimeMs: number;
}

export type ManeuverSpec =
  | { type: "dash" }
  | {
      type: "charge";
      /** How long the charged state lasts (also ended early by the first slam, O2). */
      durationMs: number;
      /** May this weapon's hard slam land on a stunned victim (O3/O18)? */
      slamsStunned: boolean;
    };

/**
 * A weapon that moves the CAR instead of spawning an instance (spec: Maneuvers). The press rides
 * the same fire state machine as every other weapon — stocks, cooldown, recovery — and `damage`
 * is what its contact deals, resolved in `runCombat` like any hit. `speed` is the dash speed;
 * `aimRangeUnits` doubles as the dash distance. A charge uses neither.
 */
export interface ManeuverWeaponDef extends WeaponBase {
  kind: "maneuver";
  maneuver: ManeuverSpec;
}
```

Extend `WeaponBase` (place near `usesAimAssist`):

```ts
  /**
   * This weapon's own aim-assist reach, world units. Required exactly when `usesAimAssist` is
   * true (test-enforced both ways). Lock ACQUISITION uses the car's largest value
   * (`carAimRangeOf`); at fire time a lock farther than this fires straight ahead. Every row in
   * this pass authors 400 — `AIM_CONFIG.lockRange`'s value, written literally because importing
   * aim-config here is a cycle — so behavior is identical until the numbers diverge.
   */
  aimRangeUnits?: number;
  /**
   * Muzzle directions, degrees off the heading. Absent means `[0]`. Each muzzle emits the full
   * pellet fan (or its own beam instance). More than one requires `usesAimAssist: false` — a lock
   * cannot steer four directions at once.
   */
  muzzles?: readonly number[];
  /** Exempt from the stun interrupt sweep (O8). Absent = false; `wildcharge` will be the one true. */
  isUnInterruptable?: boolean;
```

Extend `ProjectileWeaponDef` with `homing?: HomingDef; bounce?: BounceDef;`, extend `BeamWeaponDef` with:

```ts
  /**
   * The car is held (no translation, steering only) from the press until the beam dies — the
   * HOLD maneuver, O10. Lance is the intended user; absent = false.
   */
  holdsDuringFire?: boolean;
```

and widen the union: `export type WeaponDef = ProjectileWeaponDef | BeamWeaponDef | ManeuverWeaponDef;`. (The `bar` hitbox member is Task 4's, not this task's — adding it without its shape branch would silently hit-test as an ellipse.)

In `weapon-config.ts` add `aimRangeUnits: 400,` directly under `usesAimAssist: true` on the six assisted rows (`fireball`, `pepperbox`, `needler`, `skewer`, `lance`, `thumper`) with a one-line comment on the first: `// = AIM_CONFIG.lockRange today; per-weapon from here (spec S1). Literal: importing aim-config here is a cycle.`

In `weapon-ticks.ts` extend `WeaponTicks` and `ticksFor`:

```ts
  /** Homing guidance window; 0 for a non-homing weapon. */
  homingDuration: number;
  /** Bounce flight clock; 0 for a non-bouncing weapon. */
  bounceLifetime: number;
  /** Charge duration; 0 for anything that is not a charge maneuver. */
  maneuverDuration: number;
```

```ts
    homingDuration: def.kind === "projectile" && def.homing ? msToTicks(def.homing.durationMs) : 0,
    bounceLifetime: def.kind === "projectile" && def.bounce ? msToTicks(def.bounce.lifetimeMs) : 0,
    maneuverDuration:
      def.kind === "maneuver" && def.maneuver.type === "charge" ? msToTicks(def.maneuver.durationMs) : 0,
```

and guard `flight` against the new kind: `flight: def.kind === "maneuver" ? 0 : Math.ceil((def.range / def.speed) * TICK_RATE_HZ),`. Check every `def.kind === "beam"` / `"projectile"` narrowing in shared for exhaustiveness fallout from the third kind (`npm run typecheck` finds them); where a maneuver falls through (`fire.ts` volley read, `spawnInstances` — Task 10 handles the real branch), the base-field reads still typecheck.

Export `HomingDef`, `BounceDef`, `ManeuverSpec`, `ManeuverWeaponDef` from `packages/shared/src/index.ts` alongside the existing weapon-type exports.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared` then `npm run typecheck`
Expected: shared PASS except `manual-page` script test is not in this workspace — fine. Typecheck clean across workspaces (client/server compile against the widened union).

- [ ] **Step 5: Rebuild the manual (the table changed, so `balanceStamp` moved)**

Run: `npm run build -w @motor-combat-moba/shared && npm run build:manual`
Then: `npm test` (root) — Expected: PASS, including `scripts/manual-page.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config packages/shared/src/index.ts packages/client/public/manual.html
git commit -m "feat(shared): weapon-def vocabulary for the overhaul — aimRangeUnits, muzzles, homing, bounce, maneuver kind"
```

---

### Task 2: Per-car lock range and the fire-time range gate

**Files:**
- Modify: `packages/shared/src/config/weapon-slots.ts`
- Modify: `packages/shared/src/config/weapon-slots.test.ts`
- Modify: `packages/shared/src/sim/weapons/lock.ts`
- Modify: `packages/shared/src/sim/weapons/lock.test.ts`
- Modify: `packages/shared/src/sim/combat.ts`
- Modify: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Produces: `carAimRangeOf(carId: CarId): number` (weapon-slots.ts); `inAcquireRegion(angleDeg, distance, lockRangeUnits)` and `inRetainRegion(angleDeg, distance, lockRangeUnits)` (third param NEW, required); `UpdateLockContext.lockRangeUnits: number` (required); `aimAngleFor` returns `null` when the lock sits beyond the firing weapon's `aimRangeUnits`.
- Consumes: `WeaponBase.aimRangeUnits` (Task 1).

- [ ] **Step 1: Write the failing tests**

`weapon-slots.test.ts`:

```ts
import { AIM_CONFIG } from "./aim-config.js";
import { carAimRangeOf } from "./weapon-slots.js";

describe("carAimRangeOf", () => {
  it("is 400 for every shipped chassis (all assisted rows author 400 in this pass)", () => {
    for (const id of ["mirage", "bullseye", "bastion"] as const) {
      expect(carAimRangeOf(id)).toBe(400);
    }
  });
  it("falls back to AIM_CONFIG.lockRange for a car with no assisted weapon", () => {
    // No such chassis ships; the fallback is the contract for one. Assert it equals the global.
    expect(AIM_CONFIG.lockRange).toBe(400); // if this moves, revisit carAimRangeOf's fallback
  });
});
```

`combat.test.ts` — add (model the fixture on the file's existing `CombatPlayer` builders):

```ts
it("fires straight ahead when the lock sits beyond the weapon's own aimRangeUnits", () => {
  // Retention can hold a lock out to lockRange + retentionRangeUnits (460), past fireball's 400.
  const shooter = playerAt("a", 0, 0, 0); // whatever helper the file already uses
  shooter.lock = { targetSessionId: "b", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
  const target = playerAt("b", 430, 0, 0);
  const byId = new Map([["a", shooter], ["b", target]]);
  expect(aimAngleFor(shooter, "fireball", byId)).toBeNull(); // 430 > 400 → welded to heading
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/config/weapon-slots.test.ts src/sim/combat.test.ts`
Expected: FAIL — `carAimRangeOf` not exported; `aimAngleFor` returns an angle for the 430-unit lock.

- [ ] **Step 3: Implement.**

`weapon-slots.ts` (imports: `AIM_CONFIG` from `./aim-config.js`, `WEAPON_TABLE` from `./weapon-config.js` — no cycle: nothing on the aim-config→weapon-ticks→weapon-config chain imports weapon-slots):

```ts
/**
 * The lock-acquisition range for one chassis: the LARGEST `aimRangeUnits` across its assisted
 * slots (spec S1 — one ambient lock per car, bounded by the longest-reaching assisted weapon; a
 * shorter weapon then declines the lock at fire time). Falls back to `AIM_CONFIG.lockRange` for a
 * car with no assisted weapon, so the bracket math never divides by a missing table.
 */
export function carAimRangeOf(carId: CarId): number {
  let max = 0;
  for (const id of slotsOf(carId)) {
    const def = WEAPON_TABLE[id];
    if (def.usesAimAssist && def.aimRangeUnits !== undefined) max = Math.max(max, def.aimRangeUnits);
  }
  return max > 0 ? max : AIM_CONFIG.lockRange;
}
```

`lock.ts`: give `withinRegion` a `lockRangeUnits: number` parameter replacing its `AIM_CONFIG.lockRange` read; thread it through `inAcquireRegion(angleDeg, distance, lockRangeUnits)` and `inRetainRegion(angleDeg, distance, lockRangeUnits)` (both now 3-arg, no default — same "the compiler keeps the two halves honest" reasoning as `StepContext.modifiers`). Add `lockRangeUnits: number` to `UpdateLockContext` (required, documented the same way) and pass `ctx.lockRangeUnits` at the three call sites inside `updateLock` (the retention gate, the scored-candidate `inRetainRegion` pre-filter, and the acquire test).

`combat.ts`: in the `updateLock` call add `lockRangeUnits: carAimRangeOf(carIdOf(player)),`. In `aimAngleFor`, after the target lookup:

```ts
  const def = weaponDefOf(weaponId);
  // Per-weapon range gate (spec S1): a lock the car holds through its longest assisted weapon may
  // still be out of THIS weapon's reach — then the weapon declines the assist and fires straight.
  // Centre-to-centre, matching how lock scoring measures distance.
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  if (distance > (def.aimRangeUnits ?? 0)) return null;
```

(`aimRangeUnits` is guaranteed present on assisted rows by Task 1's guard; the `?? 0` only defends a mis-authored row by failing safe to "no assist".)

Update `lock.test.ts` call sites mechanically: every `inAcquireRegion(a, d)` → `inAcquireRegion(a, d, AIM_CONFIG.lockRange)`, same for `inRetainRegion`, and every `updateLock` test context gains `lockRangeUnits: AIM_CONFIG.lockRange`. Grep the client for `inAcquireRegion|inRetainRegion|updateLock` — if the HUD calls any (bracket drawing), pass `carAimRangeOf(...)` of the viewed car there too.

Export `carAimRangeOf` from `index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared`, then `npm run build -w @motor-combat-moba/shared && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): per-weapon aim-assist range — carAimRangeOf acquisition bound, fire-time range gate"
```

---

### Task 3: Aim lead

> **REVERTED 2026-09-02.** Aim lead shipped and was taken back out: the assist sets a shot's
> direction, it does not decide the shot (A3). `aim.ts` and `CombatPlayer.speed` are gone and
> `aimAngleFor` aims at the target's current bearing again. This task is kept as a record of what
> was built, not as a description of the code.

**Files:**
- Create: `packages/shared/src/sim/weapons/aim.ts`
- Create: `packages/shared/src/sim/weapons/aim.test.ts`
- Modify: `packages/shared/src/sim/combat.ts` (`CombatPlayer.speed`, `aimAngleFor`)
- Modify: `packages/shared/src/sim/combat.test.ts` (fixtures gain `speed`)
- Modify: `packages/server/src/sim/combat-bridge.ts` (map `player.speed`)

**Interfaces:**
- Produces: `interceptTime(dx, dy, tvx, tvy, speed): number | null` and `interceptAngle(mx, my, tx, ty, tvx, tvy, speed): number` (aim.ts); `CombatPlayer.speed: number`.
- Consumes: `aimAngleFor`'s range gate (Task 2).

- [ ] **Step 1: Write the failing tests** — `aim.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { interceptAngle, interceptTime } from "./aim.js";

describe("interceptTime", () => {
  it("is distance/speed against a stationary target", () => {
    expect(interceptTime(300, 400, 0, 0, 1000)).toBeCloseTo(0.5); // hypot 500 at 1000 u/s
  });
  it("returns null when the target outruns the shot away from it", () => {
    expect(interceptTime(100, 0, 500, 0, 400)).toBeNull(); // fleeing at 500 vs a 400 u/s shot
  });
});

describe("interceptAngle", () => {
  it("leads a crossing target so the shot and the target arrive together", () => {
    const speed = 900;
    const [tx, ty, tvx, tvy] = [400, 0, 0, 300]; // crossing at 300 u/s
    const angle = interceptAngle(0, 0, tx, ty, tvx, tvy, speed);
    const t = interceptTime(tx, ty, tvx, tvy, speed)!;
    const sx = Math.cos(angle) * speed * t;
    const sy = Math.sin(angle) * speed * t;
    expect(sx).toBeCloseTo(tx + tvx * t, 5);
    expect(sy).toBeCloseTo(ty + tvy * t, 5);
  });
  it("falls back to aiming at the current position when no intercept exists", () => {
    const angle = interceptAngle(0, 0, 100, 0, 500, 0, 400);
    expect(angle).toBeCloseTo(0); // direct bearing
  });
});
```

`combat.test.ts` — add:

```ts
it("leads a moving locked target (assisted projectiles fire at the intercept, spec S1)", () => {
  const shooter = playerAt("a", 0, 0, 0);
  shooter.lock = { targetSessionId: "b", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
  const target = playerAt("b", 300, 0, Math.PI / 2); // heading +y
  target.speed = 300;
  const byId = new Map([["a", shooter], ["b", target]]);
  const led = aimAngleFor(shooter, "fireball", byId)!;
  const direct = Math.atan2(0 - 0, 300 - 24); // muzzle at x=24
  expect(led).toBeGreaterThan(direct); // aimed ahead of the target, up the +y path
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/aim.test.ts src/sim/combat.test.ts`
Expected: FAIL — module missing; then `speed` missing on fixtures (compile).

- [ ] **Step 3: Implement.** `aim.ts`:

```ts
/**
 * First-order intercept: when does a shot at `speed` meet a target offset (dx, dy) moving at
 * (tvx, tvy)? Solves |D + V t| = speed * t — the standard quadratic — returning the smallest
 * positive root, or null when no intercept exists (target faster than the shot and diverging).
 *
 * Used by aim assist (spec S1): the lock aims at the intercept instead of the current position,
 * which is what stops the far half of every lock acquiring reliably and missing reliably.
 */
export function interceptTime(
  dx: number,
  dy: number,
  tvx: number,
  tvy: number,
  speed: number,
): number | null {
  const a = tvx * tvx + tvy * tvy - speed * speed;
  const b = 2 * (dx * tvx + dy * tvy);
  const c = dx * dx + dy * dy;
  if (Math.abs(a) < 1e-9) {
    // Target speed equals shot speed: the quadratic degenerates to b t + c = 0.
    if (Math.abs(b) < 1e-9) return null;
    const t = -c / b;
    return t > 0 && Number.isFinite(t) ? t : null;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  let best: number | null = null;
  for (const t of [t1, t2]) {
    if (t > 0 && Number.isFinite(t) && (best === null || t < best)) best = t;
  }
  return best;
}

/** The angle to fire at to intercept, or the direct bearing when no intercept exists. */
export function interceptAngle(
  mx: number,
  my: number,
  tx: number,
  ty: number,
  tvx: number,
  tvy: number,
  speed: number,
): number {
  const dx = tx - mx;
  const dy = ty - my;
  const t = interceptTime(dx, dy, tvx, tvy, speed);
  if (t === null) return Math.atan2(dy, dx);
  return Math.atan2(dy + tvy * t, dx + tvx * t);
}
```

`combat.ts`: add `speed: number;` to `CombatPlayer` (doc: "Scalar velocity along the heading, for aim lead — the same reading `stepDrive` integrates. Post-collision is fine: lead is an estimate, not a promise."). In `aimAngleFor`, replace the final `return Math.atan2(...)` with:

```ts
  const muzzle = muzzleOf({ x: player.x, y: player.y, angle: player.angle });
  if (def.kind === "projectile") {
    // Lead is projectiles-only (spec S1): a beam crosses its reach near-instantly, and a maneuver
    // aims the car, not a shot. Target velocity is heading x speed — shove is small and decaying.
    return interceptAngle(
      muzzle.x, muzzle.y, target.x, target.y,
      Math.cos(target.angle) * target.speed, Math.sin(target.angle) * target.speed,
      def.speed,
    );
  }
  return Math.atan2(target.y - muzzle.y, target.x - muzzle.x);
```

Add `speed: 0` to every `CombatPlayer` fixture in `combat.test.ts` (mechanical). In `combat-bridge.ts` `toCombatPlayers`, add `speed: player.speed,`. Export `interceptAngle`/`interceptTime` from `index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared && npm run build -w @motor-combat-moba/shared && npm run test -w @motor-combat-moba/server`
Expected: PASS. (If a playtest probe builds `CombatPlayer` literals it will fail to compile — add `speed: 0` there too; that is a compile-break fix, allowed by policy.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src packages/server/src
git commit -m "feat(shared): aim assist leads moving targets — first-order intercept for assisted projectiles"
```

---

### Task 4: Bar hitbox

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts` (union member)
- Modify: `packages/shared/src/sim/weapons/shapes.ts`
- Modify: `packages/shared/src/sim/weapons/shapes.test.ts`
- Modify: `packages/shared/src/config/weapon-config.test.ts` (aspect guard)
- Check: `packages/client/src/scenes/combat-visual.ts` (exhaustiveness only)

**Interfaces:**
- Produces: `ProjectileHitbox` gains `{ shape: "bar"; radiusAlong: number; radiusAcross: number }` — `radiusAlong` = half-thickness ALONG travel (thin), `radiusAcross` = half-length ACROSS travel (long). `projectileShapeAt` returns its polygon.

- [ ] **Step 1: Write the failing tests** — `shapes.test.ts`:

```ts
describe("bar", () => {
  const bar = { shape: "bar", radiusAlong: 6, radiusAcross: 60 } as const;

  it("is long across the travel axis and thin along it", () => {
    const s = projectileShapeAt(bar, 0, 0, 0); // travelling +x
    expect(s.kind).toBe("polygon");
    const xs = (s as PolygonShape).points.map((p) => p.x);
    const ys = (s as PolygonShape).points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(12);  // 2 * radiusAlong
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(120); // 2 * radiusAcross
  });

  it("rotates with the flight angle", () => {
    const s = projectileShapeAt(bar, 0, 0, Math.PI / 2) as PolygonShape; // travelling +y
    const xs = s.points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120); // long side now spans x
  });

  it("catches two hulls a car-length apart at once", () => {
    const s = projectileShapeAt(bar, 0, 0, 0);
    expect(shapeHitsObb(s, { x: 10, y: 50, angle: 0, w: 48, h: 32 })).toBe(true);
    expect(shapeHitsObb(s, { x: 10, y: -50, angle: 0, w: 48, h: 32 })).toBe(true);
  });
});
```

`weapon-config.test.ts` (beside the capsule ratio guard):

```ts
it("keeps bar hitboxes wider than they are thick", () => {
  for (const def of Object.values(WEAPON_TABLE)) {
    if (def.kind === "projectile" && def.hitbox.shape === "bar") {
      expect(def.hitbox.radiusAcross, def.id).toBeGreaterThanOrEqual(def.hitbox.radiusAlong);
    }
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/shapes.test.ts`
Expected: FAIL — `"bar"` not assignable to `ProjectileHitbox`.

- [ ] **Step 3: Implement.** `weapon-types.ts` — add to `ProjectileHitbox`:

```ts
  /**
   * A wall sweeping forward: long axis PERPENDICULAR to flight, travelling along its short axis.
   * `radiusAlong` is half its thickness along the flight direction and `radiusAcross` half its
   * length across it, so the two are read the same way as `ellipse`/`capsule`. Guarded
   * `radiusAcross >= radiusAlong` — a bar thicker than it is wide is an ellipse job.
   */
  | { shape: "bar"; radiusAlong: number; radiusAcross: number }
```

`shapes.ts` — in `projectileShapeAt`, before the ellipse fall-through:

```ts
  if (hitbox.shape === "bar") {
    return {
      kind: "polygon",
      points: [
        rotateInto(x, y, angle, hitbox.radiusAlong, -hitbox.radiusAcross),
        rotateInto(x, y, angle, hitbox.radiusAlong, hitbox.radiusAcross),
        rotateInto(x, y, angle, -hitbox.radiusAlong, hitbox.radiusAcross),
        rotateInto(x, y, angle, -hitbox.radiusAlong, -hitbox.radiusAcross),
      ],
    };
  }
```

Then `npm run build -w @motor-combat-moba/shared && npm run typecheck`. If `combat-visual.ts` (client) switches exhaustively over projectile hitbox shapes, add a `bar` branch that draws the same polygon the hitbox is (mirror how it draws `rect`/ellipse fills — flat weapon-color fill, no style table entry). If it draws generically from the shape, nothing to do.

- [ ] **Step 4: Run to verify pass**

Run: `npm test` (root)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src packages/client/src
git commit -m "feat(shared): bar projectile hitbox — a thin wall travelling along its short axis"
```

---

### Task 5: Multi-muzzle spawning

**Files:**
- Modify: `packages/shared/src/sim/weapons/instances.ts`
- Modify: `packages/shared/src/sim/weapons/instances.test.ts`

**Interfaces:**
- Produces: `WeaponInstance.muzzleDir: number` (radians off the owner heading, frozen at spawn, sim-only); `spawnInstances` emits `muzzles.length × pellets` instances; `stepInstance` re-anchors an attached beam through `muzzleDir`; **`spawnInstances`, `stepInstance`, `instanceExpired` each gain an optional trailing `def: WeaponDef = weaponDefOf(...)` parameter** (the test seam — see "Testing seams" above).
- Consumes: `WeaponBase.muzzles` (Task 1).

- [ ] **Step 1: Write the failing tests** — `instances.test.ts`:

```ts
import { WEAPON_TABLE } from "../../config/weapon-config.js";

/** A synthetic def for mechanics no shipped row carries yet (see the plan's "Testing seams"). */
const quadMuzzle = {
  ...WEAPON_TABLE.needler,
  usesAimAssist: false,
  aimRangeUnits: undefined,
  muzzles: [0, 90, 180, 270],
} as const;

describe("multi-muzzle", () => {
  const order = { weaponId: "needler", slot: 0, finalVolley: true } as const;
  const owner = { sessionId: "a", team: 0 as const, carId: "bullseye", x: 100, y: 100, angle: 0 };

  it("emits one fan per muzzle, each centred on its own direction", () => {
    const { instances } = spawnInstances(order, owner, 1, 0, null, 1, "", quadMuzzle);
    expect(instances).toHaveLength(4); // 4 muzzles x 1 pellet
    const angles = instances.map((i) => i.angle).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(-Math.PI / 2); // -90 normalises below 0
    // Each dart leaves the hull edge along its own direction, not the nose:
    const rear = instances.find((i) => Math.abs(Math.cos(i.angle) + 1) < 1e-6)!;
    expect(rear.x).toBeCloseTo(100 - muzzleOffset());
    expect(rear.muzzleDir).toBeCloseTo(Math.PI);
  });

  it("defaults to the single forward muzzle, byte-for-byte as before", () => {
    const single = spawnInstances(order, owner, 1, 0, null, 1);
    expect(single.instances).toHaveLength(1);
    expect(single.instances[0]!.x).toBeCloseTo(100 + muzzleOffset());
    expect(single.instances[0]!.muzzleDir).toBe(0);
  });

  it("re-anchors an attached beam through its own muzzle direction", () => {
    const rearFlame = { ...WEAPON_TABLE.afterburner, muzzles: [180] } as const;
    const { instances } = spawnInstances(order, owner, 1, 0, null, 1, "", rearFlame);
    const stepped = stepInstance(instances[0]!, {
      dt: 1 / 30, tick: 2, obstacles: [], bounds: { width: 4000, height: 4000 },
      ownerPose: { x: 200, y: 100, angle: 0 }, homingTarget: null,
    }, rearFlame);
    expect(stepped.x).toBeCloseTo(200 - muzzleOffset()); // welded to the TAIL as the car moves
    expect(stepped.angle).toBeCloseTo(Math.PI);
  });
});
```

(If `homingTarget` on the context does not exist yet, add it as `homingTarget: null` in this task with type `{ x: number; y: number } | null` — Task 6 consumes it.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/instances.test.ts`
Expected: FAIL — signature/field mismatches.

- [ ] **Step 3: Implement.** In `instances.ts`:

Add to `WeaponInstance`:

```ts
  /**
   * This instance's muzzle direction, radians off the owner's heading, frozen at spawn. 0 for
   * every single-muzzle weapon. Sim-only, like `damageClock`: an attached beam re-anchors through
   * it every tick, so a rear flame stays welded to the tail rather than snapping to the nose.
   */
  muzzleDir: number;
```

Change `spawnInstances`'s signature to:

```ts
export function spawnInstances(
  order: ShotOrder,
  owner: { sessionId: string; team: 0 | 1; carId: string } & OwnerPose,
  tick: number,
  seq: number,
  aimAngle: number | null = null,
  damageMult = 1,
  homingTargetId = "",                       // consumed in Task 6; "" = none
  def: WeaponDef = weaponDefOf(order.weaponId), // test seam — see plan "Testing seams"
): { instances: WeaponInstance[]; seq: number } {
```

and wrap the existing per-pellet loop in a muzzle loop:

```ts
  const muzzleDirs = (def.muzzles ?? [0]).map((deg) => (deg * Math.PI) / 180);
  const instances: WeaponInstance[] = [];
  let next = seq;
  for (const dir of muzzleDirs) {
    const exitHeading = owner.angle + dir;
    const nose = def.kind === "beam" && def.origin === "center" ? 0 : muzzleOffset();
    const muzzleX = owner.x + Math.cos(exitHeading) * nose;
    const muzzleY = owner.y + Math.sin(exitHeading) * nose;
    // Multi-muzzle forces assist off (table guard), so `aimAngle` only ever steers the single
    // forward muzzle — for every other direction the axis is the heading plus the muzzle offset.
    const axis = (aimAngle ?? owner.angle) + dir;
    for (let i = 0; i < pellets; i++) {
      // ...existing instance literal, plus:  muzzleDir: dir,
    }
  }
```

In `stepInstance` (signature gains the same trailing `def = weaponDefOf(instance.weaponId)`), the attached-beam origin becomes:

```ts
  const anchorAngle = ctx.ownerPose.angle + instance.muzzleDir;
  // inside the attached ternary:
  { x: ctx.ownerPose.x + Math.cos(anchorAngle) * nose,
    y: ctx.ownerPose.y + Math.sin(anchorAngle) * nose,
    angle: anchorAngle }
```

Give `instanceExpired` the same optional `def` parameter now too (Task 7 relies on it). `combat.ts` call sites pass nothing — defaults preserve behavior.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared`
Expected: PASS, including every pre-existing instances test untouched in expectation.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): multi-muzzle fire — per-muzzle fans and beams, attached re-anchor through muzzleDir"
```

---

### Task 6: Homing projectiles

**Files:**
- Modify: `packages/shared/src/sim/weapons/instances.ts`
- Modify: `packages/shared/src/sim/weapons/instances.test.ts`
- Modify: `packages/shared/src/sim/combat.ts`

**Interfaces:**
- Produces: `WeaponInstance.homingTargetId: string` ("" = none) and `WeaponInstance.homingUntilTick: number` (0 = never), both frozen at spawn, sim-only; `StepInstanceContext.homingTarget: { x: number; y: number } | null`; `spawnInstances`'s `homingTargetId` param takes effect.
- Consumes: `HomingDef` (Task 1); the `def` test seam (Task 5).

- [ ] **Step 1: Write the failing tests** — `instances.test.ts`:

```ts
const rocket = {
  ...WEAPON_TABLE.fireball,
  speed: 600,
  homing: { turnRateDegPerSec: 120, durationMs: 1200 },
} as const;
const ctx = (tick: number, target: { x: number; y: number } | null) => ({
  dt: 1 / 30, tick, obstacles: [], bounds: { width: 4000, height: 4000 },
  ownerPose: null, homingTarget: target,
});
const owner = { sessionId: "a", team: 0 as const, carId: "mirage", x: 0, y: 0, angle: 0 };
const order = { weaponId: "fireball", slot: 0, finalVolley: true } as const;

describe("homing", () => {
  it("freezes the lock target at spawn and bends toward it, capped at the turn rate", () => {
    const { instances } = spawnInstances(order, owner, 10, 0, 0, 1, "victim", rocket);
    const shot = instances[0]!;
    expect(shot.homingTargetId).toBe("victim");
    const stepped = stepInstance(shot, ctx(11, { x: 500, y: 500 }), rocket); // 45 deg off
    const maxTurn = (120 * Math.PI / 180) / 30;
    expect(stepped.angle).toBeCloseTo(maxTurn); // clamped, not snapped to 45 deg
  });

  it("flies straight after the guidance window", () => {
    const { instances } = spawnInstances(order, owner, 10, 0, 0, 1, "victim", rocket);
    const until = instances[0]!.homingUntilTick;
    expect(until).toBe(10 + 36); // msToTicks(1200) at 30 Hz
    const past = stepInstance({ ...instances[0]!, x: 100 }, ctx(until + 1, { x: 500, y: 500 }), rocket);
    expect(past.angle).toBe(0);
  });

  it("flies straight when fired without a lock", () => {
    const { instances } = spawnInstances(order, owner, 10, 0, null, 1, "", rocket);
    expect(instances[0]!.homingTargetId).toBe("");
    const stepped = stepInstance(instances[0]!, ctx(11, null), rocket);
    expect(stepped.angle).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/instances.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** `instances.ts`:

`WeaponInstance` gains:

```ts
  /** Homing only: the locked car frozen at spawn (O11), or "". Sim-only, never networked. */
  homingTargetId: string;
  /** Homing only: the tick guidance ends; 0 for a non-homing shot. Frozen at spawn. */
  homingUntilTick: number;
```

In `spawnInstances`, before the loops:

```ts
  const homing = def.kind === "projectile" ? def.homing : undefined;
  const homingTarget = homing && homingTargetId !== "" ? homingTargetId : "";
  const homingUntil = homingTarget !== "" ? tick + msToTicks(homing!.durationMs) : 0;
```

(import `msToTicks` from `../../config/weapon-ticks.js` — deriving from the injected `def` rather than `WEAPON_TICKS` is what keeps the test seam honest) and set both fields in the instance literal (`homingTargetId: homingTarget, homingUntilTick: homingUntil,`).

In `stepInstance`'s projectile branch, before integrating:

```ts
    let angle = instance.angle;
    const homing = def.kind === "projectile" ? def.homing : undefined;
    if (
      homing &&
      instance.homingTargetId !== "" &&
      ctx.homingTarget !== null &&
      ctx.tick <= instance.homingUntilTick
    ) {
      // Bend toward the target's live position, capped at the turn rate — the counterplay is the
      // turning circle, so the cap is the whole mechanic (spec: Homing).
      const desired = Math.atan2(ctx.homingTarget.y - instance.y, ctx.homingTarget.x - instance.x);
      let delta = desired - angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta <= -Math.PI) delta += Math.PI * 2;
      const maxTurn = ((homing.turnRateDegPerSec * Math.PI) / 180) * ctx.dt;
      angle += Math.max(-maxTurn, Math.min(maxTurn, delta));
    }
```

then integrate along `angle` and return it on the instance. Add `homingTarget: { x: number; y: number } | null;` to `StepInstanceContext` (documented: "The homing target's live pose, or null — dead, missing, or no homing. The caller owns the lookup; this module never reads player state.").

`combat.ts` phase 2 step loop supplies it:

```ts
      const homingOwner =
        instance.homingTargetId !== "" ? byId.get(instance.homingTargetId) : undefined;
      // ...in the stepInstance context:
      homingTarget:
        homingOwner && isFighting(homingOwner) ? { x: homingOwner.x, y: homingOwner.y } : null,
```

and phase 3 passes the target id into `spawnInstances`: compute once per order,

```ts
      const def = weaponDefOf(order.weaponId);
      const aim = aimAngleFor(player, order.weaponId, byId);
      const homingTargetId =
        def.kind === "projectile" && def.homing && aim !== null ? player.lock.targetSessionId : "";
      const spawned = spawnInstances(order, player, world.tick, instanceSeq, aim, mods.damageDealt, homingTargetId);
```

(replacing the current inline `aimAngleFor` argument). Existing hand-built instances in tests need `muzzleDir: 0, homingTargetId: "", homingUntilTick: 0` added (mechanical; also `expiresAtTick: 0` after Task 7 — add all four in one sweep now to touch the fixtures once).

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): homing projectiles — target frozen at spawn, turn-rate-capped guidance window"
```

---

### Task 7: Bouncing projectiles

**Files:**
- Modify: `packages/shared/src/sim/weapons/instances.ts`
- Modify: `packages/shared/src/sim/weapons/instances.test.ts`
- Modify: `packages/shared/src/sim/combat.ts` (`hitsWorld` skip)

**Interfaces:**
- Produces: `WeaponInstance.expiresAtTick: number` (0 = range-based expiry, frozen at spawn); `bounceOffWorld(prevX, prevY, x, y, angle, obstacles, bounds)` exported from instances.ts; a bouncing projectile reflects instead of dying on level geometry and expires on its clock.
- Consumes: `BounceDef` (Task 1), the `def` seam (Task 5).

- [ ] **Step 1: Write the failing tests** — `instances.test.ts`:

```ts
const bouncer = { ...WEAPON_TABLE.thumper, bounce: { lifetimeMs: 2900 } } as const;
const bounds = { width: 1000, height: 1000 };

describe("bounce", () => {
  it("reflects off the arena edge, folding position and mirroring the angle", () => {
    const r = bounceOffWorld(990, 500, 1010, 500, 0, [], bounds);
    expect(r.x).toBeCloseTo(990);              // folded back inside
    expect(Math.cos(r.angle)).toBeCloseTo(-1); // now travelling -x
  });

  it("reflects off an obstacle face chosen by approach side", () => {
    const wall = { x: 500, y: 0, w: 40, h: 1000 };
    const r = bounceOffWorld(480, 500, 510, 500, 0, [wall], bounds);
    expect(r.x).toBeLessThanOrEqual(500);
    expect(Math.cos(r.angle)).toBeCloseTo(-1);
  });

  it("expires on its clock, not at range", () => {
    const owner = { sessionId: "a", team: 0 as const, carId: "bastion", x: 0, y: 0, angle: 0 };
    const order = { weaponId: "thumper", slot: 0, finalVolley: true } as const;
    const { instances } = spawnInstances(order, owner, 100, 0, null, 1, "", bouncer);
    const shot = instances[0]!;
    expect(shot.expiresAtTick).toBe(100 + 87); // msToTicks(2900) at 30 Hz
    expect(instanceExpired({ ...shot, distance: 99999 }, 150, bouncer)).toBe(false); // range ignored
    expect(instanceExpired(shot, 187, bouncer)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/instances.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** `instances.ts`:

`WeaponInstance` gains `expiresAtTick: number` (doc: "Bouncing rows only: the flight clock, frozen at spawn from `bounce.lifetimeMs`. 0 = expire at `range` as ever."). `spawnInstances` sets:

```ts
  const bounce = def.kind === "projectile" ? def.bounce : undefined;
  const expiresAt = bounce ? tick + msToTicks(bounce.lifetimeMs) : 0;
```

`instanceExpired` becomes:

```ts
export function instanceExpired(
  instance: WeaponInstance,
  tick: number,
  def: WeaponDef = weaponDefOf(instance.weaponId),
): boolean {
  if (instance.kind === "projectile") {
    if (instance.expiresAtTick > 0) return tick >= instance.expiresAtTick;
    return instance.distance >= def.range;
  }
  const ticks = weaponTicksOf(instance.weaponId);
  return tick - instance.spawnTick >= ticks.flight + ticks.lifetime;
}
```

New exported helper (center-point reflection — the hitbox may visually clip a wall by up to its own radius on the bounce tick; accepted, the smear still hit-tests correctly):

```ts
/**
 * Reflect a bouncing projectile off axis-aligned level geometry. The world is bounds plus AABBs,
 * so every reflection is a single component flip: crossing a vertical face mirrors the angle to
 * `PI - a`, a horizontal face to `-a`, and position folds across the face so speed is conserved.
 * Which obstacle face was crossed is decided by the side the shot came FROM (prev position); a
 * corner hit flips both. Centre-point test, deliberately: a face-accurate polygon sweep buys
 * precision nobody can see on a 30-unit-per-tick shot.
 */
export function bounceOffWorld(
  prevX: number,
  prevY: number,
  x: number,
  y: number,
  angle: number,
  obstacles: readonly Aabb[],
  bounds: Bounds,
): { x: number; y: number; angle: number } {
  let a = angle;
  if (x < 0) { x = -x; a = Math.PI - a; }
  else if (x > bounds.width) { x = 2 * bounds.width - x; a = Math.PI - a; }
  if (y < 0) { y = -y; a = -a; }
  else if (y > bounds.height) { y = 2 * bounds.height - y; a = -a; }
  for (const o of obstacles) {
    if (!pointInAabb(x, y, o)) continue;
    const fromLeft = prevX <= o.x;
    const fromRight = prevX >= o.x + o.w;
    const fromTop = prevY <= o.y;
    const fromBottom = prevY >= o.y + o.h;
    if ((fromLeft || fromRight) && !(fromTop || fromBottom)) {
      x = fromLeft ? 2 * o.x - x : 2 * (o.x + o.w) - x;
      a = Math.PI - a;
    } else if ((fromTop || fromBottom) && !(fromLeft || fromRight)) {
      y = fromTop ? 2 * o.y - y : 2 * (o.y + o.h) - y;
      a = -a;
    } else {
      x = fromLeft ? 2 * o.x - x : 2 * (o.x + o.w) - x;
      y = fromTop ? 2 * o.y - y : 2 * (o.y + o.h) - y;
      a = a + Math.PI;
    }
    break;
  }
  return { x, y, angle: a };
}
```

In `stepInstance`'s projectile branch, after computing the new `x`/`y`:

```ts
    if (def.kind === "projectile" && def.bounce) {
      const bounced = bounceOffWorld(instance.x, instance.y, x, y, angle, ctx.obstacles, ctx.bounds);
      x = bounced.x; y = bounced.y; angle = bounced.angle;
    }
```

(restructure the branch's return to use mutable locals). In `combat.ts` `hitsWorld`, first line becomes:

```ts
  if (def.kind !== "projectile" || instance.kind !== "projectile" || def.bounce) return false;
```

with a comment: "A bouncing projectile is never destroyed by the world — `stepInstance` reflected it instead, and testing the pre-reflection smear here would kill it on the very wall it just bounced off."

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): bouncing projectiles — axis-aligned reflection, clock-based expiry"
```

---

### Task 8: Maneuver state — SimBody, schema, stepDrive, fullStop

**Files:**
- Create: `packages/shared/src/sim/maneuver.ts`
- Modify: `packages/shared/src/sim/step.ts` (`SimBody`)
- Modify: `packages/shared/src/sim/drive.ts`
- Modify: `packages/shared/src/sim/drive.test.ts`
- Modify: `packages/shared/src/sim/golden.test.ts` (fixtures gain neutral fields; outputs unchanged)
- Modify: `packages/shared/src/schema/PlayerState.ts`
- Modify: `packages/shared/src/config/status-types.ts` (`fullStop` flag)
- Modify: `packages/shared/src/sim/status/modifiers.ts` + `modifiers.test.ts`
- Check: `packages/shared/src/sim/collide.ts` (`resolveWorld` must carry the new fields through)

**Interfaces:**
- Produces: `ManeuverKind = { NONE: 0, DASH: 1, HOLD: 2, CHARGE: 3 }` (uint8, stable — invariant 7); `SimBody.maneuver/maneuverTicksLeft/maneuverAngle/maneuverSpeed: number`; `PlayerState` mirrors all four (`uint8`/`uint16`/`number`/`number`); `StatusFlag` gains `"fullStop"`; `Modifiers.fullStop: boolean`; `stepDrive` integrates DASH (translate at `maneuverSpeed` along `maneuverAngle`, face welded, exit at chassis cap) and HOLD (no translation, steering at stop rate) and counts CHARGE down while driving normally.

- [ ] **Step 1: Write the failing tests** — `drive.test.ts` (use the file's existing `chassis`/`body` fixtures; extend the body fixture with the four neutral fields `maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0`):

```ts
import { ManeuverKind } from "./maneuver.js";

describe("maneuvers (spec S3 / O13)", () => {
  it("DASH translates at maneuverSpeed along maneuverAngle, ignoring inputs, face welded", () => {
    const dashing = { ...restingBody, maneuver: ManeuverKind.DASH, maneuverTicksLeft: 8,
      maneuverAngle: Math.PI / 2, maneuverSpeed: 1600 };
    const out = stepDrive(dashing, { seq: 1, steer: 1, throttle: -1, fireSlots: 0 }, DT, chassis, NEUTRAL_MODIFIERS);
    expect(out.y).toBeCloseTo(restingBody.y + 1600 * DT);
    expect(out.x).toBeCloseTo(restingBody.x);
    expect(out.angle).toBe(Math.PI / 2);          // welded, steer ignored
    expect(out.maneuverTicksLeft).toBe(7);
  });

  it("DASH hands the car back at the chassis speed cap on its last tick", () => {
    const lastTick = { ...restingBody, maneuver: ManeuverKind.DASH, maneuverTicksLeft: 1,
      maneuverAngle: 0, maneuverSpeed: 1600 };
    const out = stepDrive(lastTick, NEUTRAL_INPUT, DT, chassis, NEUTRAL_MODIFIERS);
    expect(out.maneuver).toBe(ManeuverKind.NONE);
    expect(out.speed).toBeCloseTo(chassis.maxSpeed);
  });

  it("HOLD pins the car and steers at the stopped turn rate", () => {
    const held = { ...restingBody, speed: 200, maneuver: ManeuverKind.HOLD, maneuverTicksLeft: 10 };
    const out = stepDrive(held, { seq: 1, steer: 1, throttle: 1, fireSlots: 0 }, DT, chassis, NEUTRAL_MODIFIERS);
    expect(out.x).toBeCloseTo(restingBody.x);     // throttle dead
    expect(out.speed).toBe(0);
    expect(out.angle).toBeCloseTo(restingBody.angle + chassis.turnRateAtStop * DT);
    expect(out.maneuverTicksLeft).toBe(9);
  });

  it("CHARGE drives completely normally and only counts down", () => {
    const charging = { ...movingBody, maneuver: ManeuverKind.CHARGE, maneuverTicksLeft: 300 };
    const plain = stepDrive(movingBody, THROTTLE_INPUT, DT, chassis, NEUTRAL_MODIFIERS);
    const out = stepDrive(charging, THROTTLE_INPUT, DT, chassis, NEUTRAL_MODIFIERS);
    expect(out.x).toBe(plain.x);
    expect(out.speed).toBe(plain.speed);
    expect(out.maneuverTicksLeft).toBe(299);
  });

  it("fullStop zeroes speed while shove still moves the car", () => {
    const stunned = { ...movingBody, speed: 250, shoveX: 100 };
    const out = stepDrive(stunned, THROTTLE_INPUT, DT, chassis, { ...NEUTRAL_MODIFIERS, fullStop: true });
    expect(out.speed).toBe(0);
    expect(out.x).toBeCloseTo(movingBody.x + 100 * DT); // the slam can still push you into a wall
  });
});
```

`modifiers.test.ts`: assert `NEUTRAL_MODIFIERS.fullStop === false` and that a synthetic status def carrying `flags: ["fullStop"]`… flags come from the table, so instead assert the OR-wiring indirectly: extend the existing flag test that uses `stunned` to also assert `modifiersOf` leaves `fullStop` false today (no row carries it until Plan 2).

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/drive.test.ts src/sim/status/modifiers.test.ts`
Expected: FAIL — `maneuver.js` missing, `SimBody` fields missing, `fullStop` missing.

- [ ] **Step 3: Implement.**

`sim/maneuver.ts`:

```ts
/**
 * The maneuver a car is in — the sim state behind dash, hold and charge (spec S3).
 *
 * Values are EXPLICIT AND STABLE (invariant 7): `PlayerState.maneuver` networks them as uint8.
 * Never renumber. Mirrors how `WeaponKind`/`RoomPhase` declare theirs.
 */
export const ManeuverKind = {
  NONE: 0,
  DASH: 1,
  HOLD: 2,
  CHARGE: 3,
} as const;
export type ManeuverKindValue = (typeof ManeuverKind)[keyof typeof ManeuverKind];

/** The four neutral fields, for spreading into fixtures and resets. */
export const NO_MANEUVER = Object.freeze({
  maneuver: ManeuverKind.NONE as number,
  maneuverTicksLeft: 0,
  maneuverAngle: 0,
  maneuverSpeed: 0,
});
```

`step.ts` — `SimBody` gains (with a doc block noting invariant 8 and O13: "server-written, `stepDrive`-integrated, exactly the ram-knock pattern — which is what keeps a later client-predicted trigger an additive upgrade"):

```ts
  /** ManeuverKind value. 0 = none. */
  maneuver: number;
  maneuverTicksLeft: number;
  /** DASH only: the direction the car translates and faces. */
  maneuverAngle: number;
  /** DASH only: world units per second. */
  maneuverSpeed: number;
```

`drive.ts` — at the top of `stepDrive`:

```ts
  if (body.maneuver === ManeuverKind.DASH && body.maneuverTicksLeft > 0) {
    return stepDash(body, dt, chassis, mods);
  }
  if (body.maneuver === ManeuverKind.HOLD && body.maneuverTicksLeft > 0) {
    return stepHold(body, input, dt, chassis, mods);
  }
  const maneuverNext = tickCharge(body);
```

with the three helpers (private to drive.ts):

```ts
/** DASH: scripted translation. Inputs are ignored; knock decay still runs; the face is welded. */
function stepDash(body: SimBody, dt: number, chassis: ChassisDrive, mods: Readonly<Modifiers>): SimBody {
  const ticksLeft = body.maneuverTicksLeft - 1;
  const done = ticksLeft <= 0;
  return {
    x: body.x + Math.cos(body.maneuverAngle) * body.maneuverSpeed * dt,
    y: body.y + Math.sin(body.maneuverAngle) * body.maneuverSpeed * dt,
    angle: body.maneuverAngle,
    // Hand the car back already rolling at its cap — a dash that exits frozen reads as a stall.
    speed: done ? chassis.maxSpeed * mods.topSpeed : body.speed,
    reverseHold: 0,
    angVel: nextAngVel(body.angVel, 0),
    shoveX: decayShove(body.shoveX),
    shoveY: decayShove(body.shoveY),
    authority: recoverAuthority(body.authority),
    maneuver: done ? ManeuverKind.NONE : ManeuverKind.DASH,
    maneuverTicksLeft: done ? 0 : ticksLeft,
    maneuverAngle: done ? 0 : body.maneuverAngle,
    maneuverSpeed: done ? 0 : body.maneuverSpeed,
  };
}

/** HOLD: the engine is dead but the wheel is not. Speed forced to 0; shove still displaces. */
function stepHold(body: SimBody, input: InputMessage, dt: number, chassis: ChassisDrive, mods: Readonly<Modifiers>): SimBody {
  const steer = mods.steeringLocked ? 0 : input.steer;
  const angle = body.angle + (steer * chassis.turnRateAtStop * mods.turnRate * body.authority + body.angVel) * dt;
  const ticksLeft = body.maneuverTicksLeft - 1;
  const done = ticksLeft <= 0;
  return {
    x: body.x + body.shoveX * dt,
    y: body.y + body.shoveY * dt,
    angle,
    speed: 0,
    reverseHold: 0,
    angVel: nextAngVel(body.angVel, steer),
    shoveX: decayShove(body.shoveX),
    shoveY: decayShove(body.shoveY),
    authority: recoverAuthority(body.authority),
    maneuver: done ? ManeuverKind.NONE : ManeuverKind.HOLD,
    maneuverTicksLeft: done ? 0 : ticksLeft,
    maneuverAngle: 0,
    maneuverSpeed: 0,
  };
}

/** CHARGE only counts down here; its rules live in the contact pass. Also normalises stale kinds. */
function tickCharge(body: SimBody): Pick<SimBody, "maneuver" | "maneuverTicksLeft" | "maneuverAngle" | "maneuverSpeed"> {
  if (body.maneuver !== ManeuverKind.CHARGE || body.maneuverTicksLeft <= 0) return { ...NO_MANEUVER };
  const ticksLeft = body.maneuverTicksLeft - 1;
  if (ticksLeft <= 0) return { ...NO_MANEUVER };
  return { maneuver: ManeuverKind.CHARGE, maneuverTicksLeft: ticksLeft, maneuverAngle: 0, maneuverSpeed: 0 };
}
```

In the normal path, apply `fullStop` after `nextSpeed` (`const held = mods.fullStop ? { speed: 0, reverseHold: 0 } : { speed, reverseHold };` and use `held` in the translation and return) and spread `...maneuverNext` into the returned body.

`status-types.ts`: add to `StatusFlag` union:

```ts
  /**
   * Speed forced to 0 every tick — the "total stop" half of the new stun (O6). Shove and injected
   * spin are untouched: a slammed car still slides into the wall, which is what wall-stun reads.
   * No row carries this until the Plan-2 status table lands it on `stunned`.
   */
  | "fullStop"
```

`modifiers.ts`: `Modifiers.fullStop: boolean`, `NEUTRAL_MODIFIERS.fullStop: false`, and `mods.fullStop = flags.has("fullStop");` beside the other three.

`PlayerState.ts`:

```ts
  /**
   * Maneuver state (spec S3, arch O13). Networked because `stepDrive` reads all four (invariant
   * 8) — server-written like the ram knock, integrated by both halves of the lockstep, snapped on
   * reconcile. `maneuver` holds a `ManeuverKind` value; values are stable, never renumbered.
   */
  @type("uint8") maneuver = 0;
  @type("uint16") maneuverTicksLeft = 0;
  @type("number") maneuverAngle = 0;
  @type("number") maneuverSpeed = 0;
```

Check `resolveWorld` in `collide.ts`: if it returns `{ ...body, x, y, ... }` spreads, nothing to do; if it builds the body field-by-field, add the four fields.

`golden.test.ts`: extend every `SimBody` literal with the four neutral fields. **Do not touch any expected output value for a pre-existing field** — if one moves, the implementation broke neutrality; fix the implementation, not the fixture.

Export `ManeuverKind`, `ManeuverKindValue`, `NO_MANEUVER` from `index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared` — Expected: PASS, `golden.test.ts` untouched in its expectations.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): maneuver state on SimBody/PlayerState — dash/hold/charge in stepDrive, fullStop flag"
```

---

### Task 9: Maneuver plumbing — server tick and client prediction

**Files:**
- Modify: `packages/server/src/sim/tick.ts` (`bodyOf`, `writeBody`, `hasKnock`)
- Modify: `packages/server/src/sim/tick.test.ts`
- Modify: `packages/client/src/net/prediction.ts` (+ wherever the client builds a `SimBody` from `PlayerState` — grep `authority` under `packages/client/src` to find every mapping site, typically `ArenaScene`/`step-context`)
- Modify: `packages/client/src/net/prediction.test.ts`

**Interfaces:**
- Consumes: `SimBody` maneuver fields, `ManeuverKind` (Task 8).
- Produces: the four fields round-trip server-side and snap on client reconcile.

- [ ] **Step 1: Write the failing tests**

`tick.test.ts` (model on the file's existing knock-coast test around line 337):

```ts
it("keeps stepping a silent player mid-dash — a dash is motion applied from outside", () => {
  const player = /* the file's standard IN_MATCH player builder */;
  player.maneuver = ManeuverKind.DASH;
  player.maneuverTicksLeft = 8;
  player.maneuverAngle = 0;
  player.maneuverSpeed = 1600;
  const before = player.x;
  serverTick(stateWith(player), new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
  expect(player.x).toBeGreaterThan(before);
  expect(player.maneuverTicksLeft).toBe(7);
});
```

`prediction.test.ts`:

```ts
it("snaps maneuver state on reconcile — it is rules for the next integration, not a pose", () => {
  const authoritative = { ...someBody, maneuver: 1, maneuverTicksLeft: 5, maneuverAngle: 2, maneuverSpeed: 1600 };
  const out = buffer.reconcile(authoritative, seq, predicted, ctx);
  expect(out.maneuver).toBe(1);
  expect(out.maneuverTicksLeft).toBeLessThanOrEqual(5); // replayed tail may consume ticks
  expect(out.maneuverSpeed).toBe(1600);
});
```

(Adapt to the file's actual fixtures; the assertion that matters is that the fields are carried, not dropped to `undefined`/0.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run build -w @motor-combat-moba/shared`, then `npm run test -w @motor-combat-moba/server -- src/sim/tick.test.ts` and `npm run test -w @motor-combat-moba/client -- src/net/prediction.test.ts`
Expected: FAIL (compile: fields missing from `bodyOf` object literals / reconcile).

- [ ] **Step 3: Implement.**

`tick.ts`: add the four fields to `bodyOf` and `writeBody`; extend `hasKnock`:

```ts
function hasKnock(player: PlayerState): boolean {
  return (
    player.angVel !== 0 || player.shoveX !== 0 || player.shoveY !== 0 || player.authority !== 1 ||
    // A maneuver is also motion applied from outside the player's own inputs: a dashing or held
    // car must keep integrating when its owner goes silent, or it freezes mid-dash holding the
    // whole state. Ends on its own when the ticks run out, exactly as the knock decays do.
    player.maneuver !== ManeuverKind.NONE
  );
}
```

Client: in every `PlayerState` → `SimBody` mapping found by the grep, add the four fields; in `reconcile`, add them to BOTH the `target` literal and the eased return (snap, beside `angVel`/`shove`/`authority` — same reasoning, same comment style). If the client's interpolation of REMOTE cars builds `SimBody`s too, extend those literals with neutral values — remote maneuver visuals are Plan 3's concern; only compile-completeness matters here.

- [ ] **Step 4: Run to verify pass**

Run: root `npm test`
Expected: PASS across all workspaces.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src packages/client/src
git commit -m "feat(net): maneuver fields round-trip the server tick and snap on client reconcile"
```

---

### Task 10: Maneuver triggers in combat

**Files:**
- Modify: `packages/shared/src/sim/combat.ts`
- Modify: `packages/shared/src/sim/combat.test.ts`
- Modify: `packages/server/src/sim/combat-bridge.ts` + `combat-bridge.test.ts`

**Interfaces:**
- Produces: `CombatPlayer.maneuver/maneuverTicksLeft/maneuverAngle/maneuverSpeed: number` and `CombatPlayer.maneuverWeaponId: WeaponId | ""` (server-only, carried like `fireState`); `startManeuver(player, def: ManeuverWeaponDef, byId): void` and `dashAngleFor(player, def, byId): number` exported from combat.ts; `CombatMemory.maneuverWeapons: Map<string, WeaponId | "">`; `applyCombatResult` writes the four networked fields back.
- Consumes: `ManeuverWeaponDef` (Task 1), `ManeuverKind` (Task 8), `weaponTicksOf(...).maneuverDuration` (Task 1).

- [ ] **Step 1: Write the failing tests** — `combat.test.ts` (synthetic defs; `startManeuver`/`dashAngleFor` take the def, so no table row is needed):

```ts
const dashDef = {
  ...WEAPON_TABLE.fireball, kind: "maneuver", maneuver: { type: "dash" },
  speed: 1600, aimRangeUnits: 400, usesAimAssist: true,
} as unknown as ManeuverWeaponDef;
const chargeDef = {
  ...WEAPON_TABLE.fireball, id: "fireball", kind: "maneuver",
  maneuver: { type: "charge", durationMs: 10000, slamsStunned: true },
  usesAimAssist: false, aimRangeUnits: undefined,
} as unknown as ManeuverWeaponDef;

describe("startManeuver", () => {
  it("starts a dash toward the lock, distance = aimRangeUnits at def.speed", () => {
    const p = playerAt("a", 0, 0, 0);
    p.lock = { targetSessionId: "b", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const byId = new Map([["a", p], ["b", playerAt("b", 0, 300, 0)]]);
    startManeuver(p, dashDef, byId);
    expect(p.maneuver).toBe(ManeuverKind.DASH);
    expect(p.maneuverAngle).toBeCloseTo(Math.PI / 2); // snapped toward the target, no lead
    expect(p.maneuverSpeed).toBe(1600);
    expect(p.maneuverTicksLeft).toBe(Math.ceil((400 / 1600) * 30)); // 8 ticks
    expect(p.maneuverWeaponId).toBe(dashDef.id);
  });

  it("dashes along the heading with no lock", () => {
    const p = playerAt("a", 0, 0, 1.2);
    startManeuver(p, dashDef, new Map([["a", p]]));
    expect(p.maneuverAngle).toBeCloseTo(1.2);
  });

  it("starts a charge for its authored duration and refuses to stack maneuvers", () => {
    const p = playerAt("a", 0, 0, 0);
    startManeuver(p, chargeDef, new Map([["a", p]]));
    expect(p.maneuver).toBe(ManeuverKind.CHARGE);
    expect(p.maneuverTicksLeft).toBe(300); // msToTicks(10000)
    const before = { ...p };
    startManeuver(p, dashDef, new Map([["a", p]])); // second press mid-charge
    expect(p.maneuver).toBe(before.maneuver);
  });
});
```

Note `maneuverTicksLeft` for charge comes from `msToTicks(def.maneuver.durationMs)` computed from the injected def (NOT `weaponTicksOf` — synthetic defs have no ticks row; production rows agree because `weaponTicksOf` derives from the same field).

`combat-bridge.test.ts`:

```ts
it("round-trips maneuver fields through toCombatPlayers/applyCombatResult", () => {
  const { state, memory } = /* the file's standard builders */;
  const player = state.players.get("p1")!;
  player.maneuver = 3; player.maneuverTicksLeft = 250;
  memory.maneuverWeapons.set("p1", "fireball");
  const combat = toCombatPlayers(state, roster, new Map(), memory);
  const p = combat.find((c) => c.sessionId === "p1")!;
  expect(p.maneuver).toBe(3);
  expect(p.maneuverWeaponId).toBe("fireball");
  p.maneuver = 0; p.maneuverTicksLeft = 0; p.maneuverWeaponId = "";
  applyCombatResult(state, { players: combat, instances: [], instanceSeq: 0 }, memory);
  expect(player.maneuver).toBe(0);
  expect(memory.maneuverWeapons.get("p1")).toBe("");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/combat.test.ts` (server bridge test after the shared build in step 4)
Expected: FAIL.

- [ ] **Step 3: Implement.**

`combat.ts` — extend `CombatPlayer` with the four fields plus:

```ts
  /**
   * Which weapon started the running maneuver, or "". Server-only, carried in and out like
   * `fireState`: the contact pass reads it to price a slam/dash hit, and the stun sweep reads its
   * `isUnInterruptable`. Never networked — `stepSim` reads the four numeric fields, not this.
   */
  maneuverWeaponId: WeaponId | "";
```

Exported helpers:

```ts
/** The dash direction: the lock target's bearing (NO lead — the car arrives, not a shot), or the heading. */
export function dashAngleFor(
  player: CombatPlayer,
  def: ManeuverWeaponDef,
  byId: ReadonlyMap<string, CombatPlayer>,
): number {
  if (!def.usesAimAssist || player.lock.targetSessionId === "") return player.angle;
  const target = byId.get(player.lock.targetSessionId);
  if (!target || !isFighting(target)) return player.angle;
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  if (distance > (def.aimRangeUnits ?? 0)) return player.angle;
  return Math.atan2(target.y - player.y, target.x - player.x);
}

/** Begin a maneuver-kind weapon's effect. One maneuver at a time; a second press is ignored. */
export function startManeuver(
  player: CombatPlayer,
  def: ManeuverWeaponDef,
  byId: ReadonlyMap<string, CombatPlayer>,
): void {
  if (player.maneuver !== ManeuverKind.NONE) return;
  player.maneuverWeaponId = def.id;
  if (def.maneuver.type === "dash") {
    const distance = def.aimRangeUnits ?? def.range;
    player.maneuver = ManeuverKind.DASH;
    player.maneuverSpeed = def.speed;
    player.maneuverTicksLeft = Math.max(1, Math.ceil((distance / def.speed) * TICK_RATE_HZ));
    player.maneuverAngle = dashAngleFor(player, def, byId);
  } else {
    player.maneuver = ManeuverKind.CHARGE;
    player.maneuverTicksLeft = msToTicks(def.maneuver.durationMs);
    player.maneuverAngle = 0;
    player.maneuverSpeed = 0;
  }
}
```

Phase 3 wiring:

```ts
    // A press that would start a maneuver (or a hold weapon) while one runs is ignored BEFORE the
    // stock is spent — masked out of the press, not swallowed after commitment.
    const blocked = player.maneuver !== ManeuverKind.NONE ? maneuverSlotMask(player.fireState) : 0;
    if (!mods.disarmed) {
      const prevPending = player.fireState.pending;
      player.fireState = beginFire(player.fireState, player.fireMask & ~blocked, world.tick);
      // A hold weapon commits the car the moment the wind-up starts (O10): press -> HOLD for
      // wind-up + growth + linger, released early only by wreck or stun.
      const pending = player.fireState.pending;
      if (pending !== null && prevPending === null) {
        const pendingDef = weaponDefOf(pending.weaponId);
        if (pendingDef.kind === "beam" && pendingDef.holdsDuringFire && player.maneuver === ManeuverKind.NONE) {
          const t = weaponTicksOf(pendingDef.id);
          player.maneuver = ManeuverKind.HOLD;
          player.maneuverTicksLeft = t.startUp + t.flight + t.lifetime;
          player.maneuverWeaponId = pendingDef.id;
        }
      }
    }
```

with:

```ts
/** Bitmask of slots whose weapon starts a maneuver or a hold — the presses masked out mid-maneuver. */
function maneuverSlotMask(fireState: FireState): number {
  let mask = 0;
  fireState.slots.forEach((slot, index) => {
    const def = weaponDefOf(slot.weaponId);
    if (def.kind === "maneuver" || (def.kind === "beam" && def.holdsDuringFire)) mask |= 1 << index;
  });
  return mask;
}
```

In the orders loop, branch before `spawnInstances`:

```ts
      // Task 6 already made this loop compute `const def = weaponDefOf(order.weaponId);` —
      // insert this branch right after that line and reuse its `def`.
      if (def.kind === "maneuver") {
        startManeuver(player, def, byId);
        applySelfStatuses(player, order.weaponId, world.tick, order.finalVolley);
        continue;
      }
```

Phase 1's `!isFighting` branch also clears the maneuver (`Object.assign(player, NO_MANEUVER); player.maneuverWeaponId = "";` — a wreck holds nothing).

`combat-bridge.ts`: `CombatMemory.maneuverWeapons: Map<string, WeaponId | "">` (init in `newCombatMemory`, clear in `clearInstances`); `toCombatPlayers` maps `maneuver: player.maneuver, maneuverTicksLeft: player.maneuverTicksLeft, maneuverAngle: player.maneuverAngle, maneuverSpeed: player.maneuverSpeed, maneuverWeaponId: memory.maneuverWeapons.get(sessionId) ?? ""`; `applyCombatResult` writes the four numeric fields onto `PlayerState` and `memory.maneuverWeapons.set(p.sessionId, p.maneuverWeaponId)`. Also extend `clearKnock` (ram-bridge.ts) to zero the four maneuver fields — same "nothing survives into a fresh match" rule.

Add `maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0, maneuverWeaponId: "" as const` to every `CombatPlayer` fixture in `combat.test.ts` (fold into a builder if the file has one). Export `startManeuver`, `dashAngleFor` from `index.ts`.

**Coverage note for the summary:** the full `runCombat` path (press → `beginFire` → order → `startManeuver`) is exercised end-to-end only when Plan 3 lands a maneuver row; the helpers carry the logic and are covered here. Same honesty as the repo's existing borrowed-row notes.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared && npm run build -w @motor-combat-moba/shared && npm run test -w @motor-combat-moba/server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src packages/server/src
git commit -m "feat(combat): maneuver triggers — dash/charge starts, hold on wind-up commit, bridge round-trip"
```

---

### Task 11: The contact pass — hard slam, dash hits, wall detection (pure)

**Files:**
- Create: `packages/shared/src/config/slam-config.ts`
- Create: `packages/shared/src/sim/contact.ts`
- Create: `packages/shared/src/sim/contact.test.ts`

**Interfaces:**
- Produces:
  - `SLAM_CONFIG = { knockSpeed: 520, victimAuthority: 0.35, selfKeepFactor: 0.7, wallStunWindowMs: 500, wallStunDurationMs: 500, reslamImmunityMs: 600, wallContactPad: 1 }` and `SLAM_TICKS = { wallStunWindow, wallStunDuration, reslamImmunity }`.
  - `ContactCar extends RamCar { maneuver: number; slamsStunned: boolean; stunned: boolean; maneuverWeaponId: WeaponId | "" }` — everything def-derived arrives RESOLVED (table-free module).
  - `ContactHit { attackerSessionId: string; targetSessionId: string; weaponId: WeaponId }`.
  - `ContactEvents { dashHits: ContactHit[]; slams: ContactHit[]; wallBlockedDashers: string[] }`.
  - `resolveContacts(cars, previous, mode, tick, slamImmuneUntil, obstacles, bounds): { knocks: RamKnock[]; contacts: Set<string>; events: ContactEvents }`.
  - `hullTouchesWorld(hull: Obb, obstacles: readonly Aabb[], bounds: Bounds, pad: number): boolean`.
- Consumes: `resolveRam`, `pairKey`, `RamKnock` (ram.ts); `ManeuverKind` (Task 8); `carHullOf`, collide helpers.

- [ ] **Step 1: Write the failing tests** — `contact.test.ts` (build a `car(...)` helper producing a `ContactCar` with neutral defaults: `massMult: 1, maneuver: 0, slamsStunned: false, stunned: false, maneuverWeaponId: ""`):

```ts
describe("hard slam (spec S3, O2/O3/O18)", () => {
  const bounds = { width: 4000, height: 4000 };
  const charger = (over = {}) => car({ sessionId: "a", x: 0, y: 0, angle: 0, speed: 300,
    carId: "bastion", maneuver: ManeuverKind.CHARGE, maneuverWeaponId: "fireball", slamsStunned: true, ...over });
  const victimAt = (x: number, over = {}) => car({ sessionId: "b", x, y: 0, angle: 0, speed: 0, carId: "mirage", ...over });

  it("replaces the ram with a FIXED impulse, independent of mass and speed", () => {
    const heavy = resolveContacts([charger(), victimAt(47, { carId: "bastion" })], new Set(), "ffa", 10, new Map(), [], bounds);
    const light = resolveContacts([charger(), victimAt(47, { carId: "bullseye" })], new Set(), "ffa", 10, new Map(), [], bounds);
    expect(heavy.events.slams).toHaveLength(1);
    expect(heavy.knocks[0]!.shoveX).toBeCloseTo(SLAM_CONFIG.knockSpeed);
    expect(light.knocks[0]!.shoveX).toBeCloseTo(SLAM_CONFIG.knockSpeed); // no mass factor
    expect(heavy.knocks[0]!.authority).toBe(SLAM_CONFIG.victimAuthority);
    expect(heavy.knocks[0]!.angVel).toBe(0); // a slam shoves, it does not spin
  });

  it("slams a stunned victim only when the weapon says so (O3)", () => {
    const blocked = resolveContacts([charger({ slamsStunned: false }), victimAt(47, { stunned: true })],
      new Set(), "ffa", 10, new Map(), [], bounds);
    expect(blocked.events.slams).toHaveLength(0); // falls back to an ordinary ram
    const exempt = resolveContacts([charger({ slamsStunned: true }), victimAt(47, { stunned: true })],
      new Set(), "ffa", 10, new Map(), [], bounds);
    expect(exempt.events.slams).toHaveLength(1);
  });

  it("respects re-slam immunity, falling back to an ordinary ram (O18)", () => {
    const immune = new Map([["b", 25]]); // immune until tick 25
    const r = resolveContacts([charger(), victimAt(47)], new Set(), "ffa", 10, immune, [], bounds);
    expect(r.events.slams).toHaveLength(0);
  });

  it("stays edge-triggered like the ram it extends", () => {
    const touching = new Set([pairKey("a", "b")]);
    const r = resolveContacts([charger(), victimAt(47)], touching, "ffa", 10, new Map(), [], bounds);
    expect(r.events.slams).toHaveLength(0);
    expect(r.knocks).toHaveLength(0);
  });
});

describe("dash contact", () => {
  it("reports a dash hit and writes no knock — damage and stun ride combat", () => {
    const dasher = car({ sessionId: "a", x: 0, y: 0, angle: 0, speed: 1600, carId: "mirage",
      maneuver: ManeuverKind.DASH, maneuverWeaponId: "fireball" });
    const r = resolveContacts([dasher, car({ sessionId: "b", x: 47, y: 0, angle: 0, speed: 0, carId: "bastion" })],
      new Set(), "ffa", 10, new Map(), [], { width: 4000, height: 4000 });
    expect(r.events.dashHits).toEqual([{ attackerSessionId: "a", targetSessionId: "b", weaponId: "fireball" }]);
    expect(r.knocks).toHaveLength(0);
  });

  it("reports a dasher pressed into level geometry", () => {
    const dasher = car({ sessionId: "a", x: 25, y: 500, angle: Math.PI, speed: 1600, carId: "mirage",
      maneuver: ManeuverKind.DASH, maneuverWeaponId: "fireball" });
    const r = resolveContacts([dasher], new Set(), "ffa", 10, new Map(), [], { width: 4000, height: 4000 });
    expect(r.events.wallBlockedDashers).toEqual(["a"]);
  });
});

describe("hullTouchesWorld", () => {
  const bounds = { width: 1000, height: 1000 };
  it("detects the arena edge and inflated obstacles, and clears open ground", () => {
    expect(hullTouchesWorld(carHullOf(24, 500, 0), [], bounds, 1)).toBe(true);   // nose ON the edge
    expect(hullTouchesWorld(carHullOf(500, 500, 0), [], bounds, 1)).toBe(false);
    const box = { x: 530, y: 480, w: 40, h: 40 };
    expect(hullTouchesWorld(carHullOf(505, 500, 0), [box], bounds, 1)).toBe(true);
  });
});
```

(Cars are 48×32; centres 47 apart on the x axis overlap within the 1-unit contact pad. `"fireball"` stands in for the real maneuver weapon id — the pass carries ids as data and never opens the table.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/contact.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement.**

`slam-config.ts` (values ⚙ per spec; comments name what each is):

```ts
import { msToTicks } from "./weapon-ticks.js";

/**
 * Hard-slam tuning (spec S3). A slam REPLACES the graded ram with a fixed exchange: same knock for
 * every attacker and victim, by design — "impulse strength is fixed unlike ram". Networked balance,
 * same standing as RAM_CONFIG.
 */
export const SLAM_CONFIG = {
  /** Fixed knock impulse (a speed), 2x RAM_CONFIG.knockMaxSpeed. No mass factor, no side bonus. */
  knockSpeed: 520,
  /** Victim steering authority after a slam; RAM_CONFIG.authorityFloor's value. */
  victimAuthority: 0.35,
  /** Fraction of the attacker's pre-impact speed restored after a slam — the reduced self-cost. */
  selfKeepFactor: 0.7,
  /** Wall contact within this window after being slammed stuns the victim. */
  wallStunWindowMs: 500,
  wallStunDurationMs: 500,
  /** A just-slammed car cannot be slammed again within this (O18; playtest-tuned; unexercised while Wild Charge, exempt and one-hit, is the only slammer). */
  reslamImmunityMs: 600,
  /** Hull inflation for "touching level geometry", mirroring RAM_CONFIG.contactPad. */
  wallContactPad: 1,
} as const;

export const SLAM_TICKS = Object.freeze({
  wallStunWindow: msToTicks(SLAM_CONFIG.wallStunWindowMs),
  wallStunDuration: msToTicks(SLAM_CONFIG.wallStunDurationMs),
  reslamImmunity: msToTicks(SLAM_CONFIG.reslamImmunityMs),
});
```

`contact.ts` — the pair loop mirrors `applyRams` (sorted ids, edge-triggered contact set, best-knock-per-victim keyed by a severity where a slam counts as 1). Classification per fresh touching pair, in order:

1. **Dash:** each car of the pair in `ManeuverKind.DASH` whose `canDamage(dasher → other)` passes and whose `maneuverWeaponId !== ""` pushes a `dashHit`. A dash pair writes **no knock** (the stun that follows is the CC; ordinary hull resolution already separates them).
2. **Slam:** otherwise, a car in `ManeuverKind.CHARGE` with `canDamage(charger → other)` and `maneuverWeaponId !== ""` slams, unless the victim is `stunned` and the charger's `slamsStunned` is false, or `tick < (slamImmuneUntil.get(victimId) ?? 0)` — the blocked cases fall through to case 3. A slam pushes a `slams` event and a knock `{ sessionId: victimId, angVel: 0, shoveX: away.x * SLAM_CONFIG.knockSpeed, shoveY: away.y * SLAM_CONFIG.knockSpeed, authority: SLAM_CONFIG.victimAuthority }` where `away` is the contact normal pointing attacker → victim (reuse `contactNormalBetween` exactly as `resolveRam` derives it).
3. **Ram:** `resolveRam(a, b, mode)` as today.

After the pair loop, sweep every DASH car against level geometry: `hullTouchesWorld(carHullOf(c.x, c.y, c.angle), obstacles, bounds, SLAM_CONFIG.wallContactPad)` → `wallBlockedDashers`.

```ts
/** Is this hull within `pad` of the arena edge or an obstacle? The wall half of dash-end and wall-stun. */
export function hullTouchesWorld(hull: Obb, obstacles: readonly Aabb[], bounds: Bounds, pad: number): boolean {
  for (const c of obbCorners(hull)) {
    if (c.x <= pad || c.y <= pad || c.x >= bounds.width - pad || c.y >= bounds.height - pad) return true;
  }
  const corners = obbCorners(hull);
  return obstacles.some((o) =>
    convexOverlap(corners, aabbCorners({ x: o.x - pad, y: o.y - pad, w: o.w + 2 * pad, h: o.h + 2 * pad })),
  );
}
```

Export everything (`SLAM_CONFIG`, `SLAM_TICKS`, `ContactCar`, `ContactHit`, `ContactEvents`, `resolveContacts`, `hullTouchesWorld`) from `index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared`
Expected: PASS, `ram.test.ts` untouched.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): contact pass — hard slam with fixed impulse, dash hits, wall detection"
```

---

### Task 12: Contact bridge and room wiring

**Files:**
- Modify: `packages/shared/src/sim/status/statuses.ts` (+ test) — `expireStatusesFromSource`
- Modify: `packages/shared/src/sim/combat.ts` (+ test) — `CombatInput.contactHits`
- Modify: `packages/server/src/sim/ram-bridge.ts` (+ test) — becomes the contact bridge
- Modify: `packages/server/src/rooms/ArenaRoom.ts`
- Check/fix compile: `packages/server/playtest/*` (imports of `newRamMemory`/`ramTick`)

**Interfaces:**
- Produces:
  - `expireStatusesFromSource(statuses, sourceSessionId, tick): ActiveStatus[]` (statuses.ts).
  - `CombatInput.contactHits?: readonly ContactHit[]` — processed in a new phase 0d: weapon-priced damage + `applies` ride the contact.
  - ram-bridge.ts: `ContactMemory { contacts: Set<string>; slammed: Map<string, { bySessionId: string; wallStunUntilTick: number; immuneUntilTick: number }> }`, `newContactMemory()`, `contactTick(state, roster, memory, mode, statusMods, approachSpeeds, maneuverWeapons, tick): ContactTickResult` where `ContactTickResult = { contactHits: ContactHit[]; statusRequests: StatusRequest[] }`. `clearKnock` also zeroes maneuver fields (done in Task 10).
- Consumes: Task 11's pure pass; `CombatMemory.maneuverWeapons` (Task 10).

- [ ] **Step 1: Write the failing tests**

`statuses.test.ts`:

```ts
it("expireStatusesFromSource strips only that source's live rows", () => {
  let s = applyStatus([], "fortified", 10, 300, "a");
  s = applyStatus(s, "corroded", 10, 60, "b");
  const out = expireStatusesFromSource(s, "a", 12);
  expect(out.map((r) => r.statusId)).toEqual(["corroded"]);
});
```

`combat.test.ts` — contact hits are fully testable with today's table (`thumper`: 60 damage + 450 ms stun):

```ts
it("prices a contact hit like a shot: attacker's weapon and attack, target's damageTaken, applies ride it", () => {
  const attacker = playerAt("a", 0, 0, 0);   // give it carId "bastion"
  const target = playerAt("b", 500, 0, 0);
  const result = runCombat({
    world, players: [attacker, target], instances: [], instanceSeq: 0,
    contactHits: [{ attackerSessionId: "a", targetSessionId: "b", weaponId: "thumper" }],
  });
  const hit = result.players.find((p) => p.sessionId === "b")!;
  expect(hit.hp).toBe(hpOf("mirage") - Math.round(60 * (1 + (42 - 50) * 0.01))); // damageFor via bastion's attack — mirror the file's existing damage assertions
  expect(hit.statuses.some((s) => s.statusId === "stunned")).toBe(true);
});
```

(Adjust the damage expectation to reuse whatever helper/constant the file already asserts `damageFor` results with — do not invent a second formula.)

`ram-bridge.test.ts`:

```ts
it("ends a charge on its first slam: fields cleared, self statuses expired, speed partly restored", () => {
  // Arrange two overlapping enemies; the attacker is mid-CHARGE with fortified self-applied.
  const attacker = state.players.get("a")!;
  attacker.maneuver = ManeuverKind.CHARGE; attacker.maneuverTicksLeft = 200;
  writeStatuses(attacker, applyStatus([], "fortified", 5, 300, "a"));
  const memory = newContactMemory();
  const result = contactTick(state, roster, memory, "ffa", statusMods,
    new Map([["a", 300], ["b", 0]]), new Map([["a", "thumper"]]), 10);
  expect(result.contactHits).toEqual([{ attackerSessionId: "a", targetSessionId: "b", weaponId: "thumper" }]);
  expect(attacker.maneuver).toBe(0);
  expect(readStatuses(attacker)).toHaveLength(0);              // fortified expired with the charge (O2)
  expect(attacker.speed).toBeCloseTo(300 * SLAM_CONFIG.selfKeepFactor);
  expect(memory.slammed.get("b")).toBeDefined();
});

it("stuns a slammed victim shoved into a wall inside the window, once", () => {
  const memory = newContactMemory();
  memory.slammed.set("b", { bySessionId: "a", wallStunUntilTick: 25, immuneUntilTick: 28 });
  // place b's hull against the arena edge
  const victim = state.players.get("b")!; victim.x = 24; victim.y = 500;
  const first = contactTick(state, roster, memory, "ffa", statusMods, speeds, new Map(), 12);
  expect(first.statusRequests).toEqual([
    { targetSessionId: "b", statusId: "stunned", durationTicks: SLAM_TICKS.wallStunDuration, sourceSessionId: "a" },
  ]);
  const second = contactTick(state, roster, memory, "ffa", statusMods, speeds, new Map(), 13);
  expect(second.statusRequests).toHaveLength(0); // one stun per slam
});
```

(Model state/roster/statusMods builders on the file's existing tests.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/status/statuses.test.ts src/sim/combat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`statuses.ts`:

```ts
/**
 * Expire every live status this source applied — the "ends with the charge" rule (O2): a power
 * whose window closes early takes its own riders with it. Returns the same-content list when the
 * source owns nothing live, mirroring `expireStatuses`' cheap path.
 */
export function expireStatusesFromSource(
  statuses: readonly ActiveStatus[],
  sourceSessionId: string,
  tick: number,
): ActiveStatus[] {
  return statuses.filter((s) => !(s.sourceSessionId === sourceSessionId && s.endsTick > tick));
}
```

`combat.ts` — `CombatInput.contactHits?: readonly ContactHit[]` (import the type from `../contact.js`), and phase 0d after the status-request loop:

```ts
  // 0d. Contact damage — a dash landing or a hard slam, discovered by the contact pass this tick.
  // Priced exactly like a shot: the attacker's weapon row through their `attack` and `damageDealt`,
  // the target's `damageTaken` at impact, and the weapon's `applies` riding the hit (spec S3). The
  // hull was the hitbox; this is the damage half arriving through the same seam a pickup would.
  for (const hit of input.contactHits ?? []) {
    const target = byId.get(hit.targetSessionId);
    if (!target || !isFighting(target)) continue;
    const attacker = byId.get(hit.attackerSessionId);
    const base = weaponDamageOf(attacker ? carIdOf(attacker) : DEFAULT_CAR_ID, hit.weaponId);
    const dealt = scaleDamage(base, attacker ? modsOf(hit.attackerSessionId).damageDealt : 1);
    damage(target, scaleDamage(dealt, modsOf(hit.targetSessionId).damageTaken));
    applyOpponentStatuses(target, hit.weaponId, world.tick, hit.attackerSessionId, true);
  }
```

(imports: `weaponDamageOf` from `./damage.js`, `DEFAULT_CAR_ID` from config.)

`ram-bridge.ts` — extend into the contact bridge (keep `clearKnock`; delete or alias the old `RamMemory`/`ramTick` — playtest probes importing them are compile breaks to fix on the spot, switching them to `newContactMemory`/`contactTick` with neutral extra args):

- `ramCarsOf` grows into `contactCarsOf`, adding: `maneuver: player.maneuver`, `maneuverWeaponId: maneuverWeapons.get(sessionId) ?? ""`, `stunned: hasStatus(readStatuses(player), "stunned", tick)`, `slamsStunned:` resolved from the def (`isWeaponId(id) && def.kind === "maneuver" && def.maneuver.type === "charge" ? def.maneuver.slamsStunned : false`).
- `contactTick` body: build cars → `resolveContacts(cars, memory.contacts, mode, tick, immuneMapFrom(memory.slammed), arena.obstacles, bounds)` → write knocks with the existing authority guard → handle events:
  - `wallBlockedDashers`: `endDash(player, /*speed*/ 0)` (a dash into a wall exits stopped, not at cap);
  - `dashHits`: `endDash(attacker, forwardMaxSpeedOf(carIdOf(attacker)))`, collect the hit;
  - `slams`: record `memory.slammed.set(victimId, { bySessionId, wallStunUntilTick: tick + SLAM_TICKS.wallStunWindow, immuneUntilTick: tick + SLAM_TICKS.reslamImmunity })`; end the attacker's charge (zero the four maneuver fields), restore `player.speed = (approachSpeeds.get(id) ?? player.speed) * SLAM_CONFIG.selfKeepFactor`, and `writeStatuses(player, expireStatusesFromSource(readStatuses(player), id, tick))`; collect the hit.
  - Wall-stun sweep over `memory.slammed`: delete entries past both clocks; for a live window (`tick < wallStunUntilTick`), if the victim is on-field and `hullTouchesWorld(carHullOf(...), obstacles, bounds, SLAM_CONFIG.wallContactPad)`, push the `StatusRequest` shown in the test and zero that entry's `wallStunUntilTick` (immunity keeps running).
  - `endDash(player, exitSpeed)` zeroes the four maneuver fields and sets `player.speed = exitSpeed`. (The bridge writing motion fields is the established ram pattern; combat still never moves a car.)

`ArenaRoom.ts` — replace the `ramTick(...)` block:

```ts
    let contact: ContactTickResult = { contactHits: [], statusRequests: [] };
    if (this.state.phase === RoomPhase.MATCH && this.matchRoster.size > 0) {
      contact = contactTick(this.state, this.matchRoster, this.ram, toFlowMode(this.state.mode),
        statusMods, approachSpeeds, this.combat.maneuverWeapons, this.state.tick);
    }
    this.combatTick(dt, masks, contact);
```

and thread `contact` into `combatTick`'s `runCombat` input as `contactHits: contact.contactHits, statusRequests: contact.statusRequests` (merge with any existing statusRequests source — today there is none). Rename the `this.ram` field's type to `ContactMemory` / `newContactMemory()`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run build -w @motor-combat-moba/shared && npm test` (root)
Expected: PASS. Check `packages/server/playtest/` compiles (`npm run playtest` build step or `tsc` — do not run the probes).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src packages/server/src packages/server/playtest
git commit -m "feat(server): contact bridge — slams and dash hits into combat, wall-stun window, charge end (O2)"
```

---

### Task 13: Stun interruption

**Files:**
- Modify: `packages/shared/src/sim/combat.ts` (+ `combat.test.ts`)

**Interfaces:**
- Produces: a car gaining `stunned` this tick has, at end of tick: its pending fire cancelled, its maneuver ended, and its attached instances killed — each skipped when the responsible weapon authors `isUnInterruptable: true` (O8/O14). No stock refund.
- Consumes: `hasStatus` (statuses.ts), `ManeuverKind`, `CombatPlayer.maneuverWeaponId`.

- [ ] **Step 1: Write the failing tests** — `combat.test.ts` (all reachable with today's table: `lance` has a 700 ms wind-up, `afterburner` an attached beam, `bulwark` a detached one; stun arrives via `statusRequests`):

```ts
describe("stun interruption (O8)", () => {
  const stunRequest = (id: string) =>
    [{ targetSessionId: id, statusId: "stunned" as const, durationTicks: 14, sourceSessionId: "x" }];

  it("cancels a committed wind-up, without refunding the stock", () => {
    // Bullseye presses lance (slot 3) on tick T; the stun lands the same tick.
    const p = bullseyeAt("a"); // fireMask pressing slot 3, per the file's fixture style
    const result = runCombat({ world: worldAt(100), players: [p, other], instances: [],
      instanceSeq: 0, statusRequests: stunRequest("a") });
    const out = result.players.find((r) => r.sessionId === "a")!;
    expect(out.fireState.pending).toBeNull();               // wind-up cancelled
    expect(out.fireState.slots[2]!.stocks).toBe(0);          // the press stayed spent (O14)
  });

  it("kills the stunned car's attached beams and spares detached ones", () => {
    const attached = builtInstance("afterburner", "a"); // helper: a live attached instance owned by "a"
    const detached = builtInstance("bulwark", "a");
    const result = runCombat({ world: worldAt(100), players: [mirageAt("a"), other],
      instances: [attached, detached], instanceSeq: 2, statusRequests: stunRequest("a") });
    const ids = result.instances.map((i) => i.weaponId);
    expect(ids).not.toContain("afterburner");
    expect(ids).toContain("bulwark"); // a committed detached shot persists
  });

  it("ends the stunned car's maneuver", () => {
    const p = mirageAt("a");
    p.maneuver = ManeuverKind.DASH; p.maneuverTicksLeft = 5; p.maneuverSpeed = 1600;
    p.maneuverWeaponId = "fireball"; // interruptible (no isUnInterruptable on the row)
    const result = runCombat({ world: worldAt(100), players: [p, other], instances: [],
      instanceSeq: 0, statusRequests: stunRequest("a") });
    expect(result.players.find((r) => r.sessionId === "a")!.maneuver).toBe(ManeuverKind.NONE);
  });

  it("does not re-sweep a car that was already stunned", () => {
    const p = mirageAt("a");
    p.statuses = applyStatus([], "stunned", 90, 30, "x"); // stunned since tick 90
    p.maneuver = ManeuverKind.CHARGE; p.maneuverTicksLeft = 100; p.maneuverWeaponId = "fireball";
    const result = runCombat({ world: worldAt(100), players: [p, other], instances: [], instanceSeq: 0 });
    expect(result.players.find((r) => r.sessionId === "a")!.maneuver).toBe(ManeuverKind.CHARGE);
  });
});
```

(Write the `builtInstance` helper from the file's existing instance fixtures, with the four new instance fields.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/combat.test.ts`
Expected: FAIL — pending survives, beam survives, maneuver survives.

- [ ] **Step 3: Implement.** In `runCombat`:

Capture, right after the players are cloned (before phase 0c can add anything):

```ts
  const wasStunned = new Set(
    players.filter((p) => hasStatus(p.statuses, "stunned", world.tick)).map((p) => p.sessionId),
  );
```

And before the return, after hit resolution — one sweep whatever path applied the stun (0c request, 0d contact, or this tick's hits):

```ts
  // Stun interruption (O8): a stun landing THIS tick cancels the car's committed states at the end
  // of the tick — after this tick's already-released shots resolved, the same one-tick seam every
  // other on-apply consequence accepts. `isUnInterruptable` (wildcharge-to-be) exempts per weapon.
  // Stocks spent on a cancelled wind-up stay spent (O14): interruption is the stun's payoff.
  const interrupted = new Set<string>();
  for (const player of players) {
    if (wasStunned.has(player.sessionId)) continue;
    if (!hasStatus(player.statuses, "stunned", world.tick)) continue;
    const pending = player.fireState.pending;
    if (pending && !weaponDefOf(pending.weaponId).isUnInterruptable) {
      player.fireState = cancelPending(player.fireState);
    }
    const maneuverDef = isWeaponId(player.maneuverWeaponId) ? weaponDefOf(player.maneuverWeaponId) : null;
    if (player.maneuver !== ManeuverKind.NONE && !maneuverDef?.isUnInterruptable) {
      Object.assign(player, NO_MANEUVER);
      player.maneuverWeaponId = "";
    }
    interrupted.add(player.sessionId);
  }
  const kept = survivors.filter(
    (i) => !(interrupted.has(i.ownerSessionId) && i.attached && !weaponDefOf(i.weaponId).isUnInterruptable),
  );
  return { players, instances: kept, instanceSeq };
```

(`isWeaponId` import from weapon-config.) **Coverage note for the summary:** the `isUnInterruptable: true` exemption branch has no carrier until Plan 3's `wildcharge`; the interruptible paths are fully exercised above.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(combat): stun interrupts committed states — pending, maneuvers, attached beams (O8/O14)"
```

---

### Task 14: Docs, final verification, and the execution summary

**Files:**
- Modify: `docs/schema-reference.md` (PlayerState: the four maneuver fields, documented like the ram knock block)
- Modify: `docs/combat-model.md` (short additions: aim lead + per-weapon range under "Aim assist and the target lock"; a new "Maneuvers and the contact pass" subsection noting dash/hold/charge, hard slam, stun interruption, and that every trigger is dormant until the roster cutover; the amended stun doctrine — "a press already committed still finishes" now has the interrupt exception)
- Modify: `packages/shared/CLAUDE.md` (one short paragraph: `sim/maneuver.ts`, `sim/contact.ts`, `config/slam-config.ts` exist and what owns what)

- [ ] **Step 1: Write the doc edits.** Keep them tight — the roster-facing rewrite belongs to Plan 3. Every claim must match the shipped code (re-read the diff, not the plan, while writing).

- [ ] **Step 2: Full verification**

Run, in order:
```
npm run build
npm test
npm run typecheck
```
Expected: all green. Also confirm `git status` shows no stray generated files beyond what tasks committed.

- [ ] **Step 3: Commit**

```bash
git add docs packages/shared/CLAUDE.md
git commit -m "docs: mechanics layer — maneuver schema fields, contact pass, amended stun doctrine"
```

- [ ] **Step 4: Write the execution summary** for the user. It MUST include, loudly:
  - **Playtest flag (project rule):** this plan changed `sim/` — aim lead now changes every assisted projectile's fired angle against moving targets (`fireball`, `needler`, `pepperbox`, `skewer`, `thumper`); the ram pipeline now routes through `resolveContacts`. Name any probe whose imports were fixed for compile. Recommend `npm run playtest` and compare ram trigger rates and any aim/prediction probe against the previous report. Do not run it unbidden.
  - The coverage notes from Tasks 10 and 13 (paths that wait for Plan 3's rows).
  - That `manual.html` was regenerated once (Task 1) and why.
  - That golden/turn-tuning suites pass unchanged — the neutrality proof.
  - Reminder that Plan 2 (status table) is next and `STATUS_CONFIG.maxDurationMs` (8000) must be raised to at least 10000 there or Wild Charge's 10 s fortified will be silently clamped — the spec's fortified row depends on it.

---

## Self-review (performed while writing)

- **Spec coverage:** S1 targeting → Tasks 1–3; bar → 4; multi-muzzle → 5; homing → 6; bounce → 7; maneuvers/O13 → 8–10; hard slam + O2/O3/O18 wall-stun/immunity → 11–12; O8/O14 interruption → 13; `fullStop` (O6's mechanism) → 8, applied to the `stunned` row in Plan 2; `armored`'s flag, status-table rows, and `expireStatusesFromSource`'s Plan-2 uses → Plan 2 by design; roster rows, visuals, guide → Plan 3.
- **Type consistency:** `ContactHit` field names (`attackerSessionId`/`targetSessionId`/`weaponId`) are identical in contact.ts, `CombatInput.contactHits`, and `ContactTickResult`; `NO_MANEUVER` spread is used in drive.ts, combat.ts phase 1, and the sweep; the optional `def` seam appears on exactly `spawnInstances`/`stepInstance`/`instanceExpired`.
- **Placeholders:** none — every step carries code or an exact mechanical instruction (fixture-field sweeps, call-site threading) with the target named.
