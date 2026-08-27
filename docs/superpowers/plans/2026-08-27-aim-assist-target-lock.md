# Aim Assist and Target Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give weapons an optional ambient target lock that decides their firing direction, without changing how any weapon plays until the final task.

**Architecture:** One lock per car, evaluated by a new pure module `sim/weapons/lock.ts` and run as a new phase inside `runCombat` before any shot is aimed. Geometry and feel live once in `AIM_CONFIG`; each weapon carries only a `usesAimAssist` boolean. Lock state is server-only room memory alongside `fireStates`; a single new schema field (`PlayerState.lockTargetSessionId`) crosses the wire so the client can draw a bracket.

**Tech Stack:** TypeScript (ESM, NodeNext), npm workspaces, Vitest, Colyseus schema, Phaser 3.

**Spec:** [`docs/superpowers/specs/2026-08-27-aim-assist-target-lock-design.md`](../specs/2026-08-27-aim-assist-target-lock-design.md) (commit `6925ad5`). Decisions are cited as A1–A14 throughout; read the spec alongside this plan.

## Global Constraints

- **`@motor-combat-moba/shared` is consumed as built `dist`.** After editing anything under `packages/shared/src`, run `npm run build -w @motor-combat-moba/shared` before running the server or client. Tests import `src` and will pass against a stale `dist`.
- **This is a git worktree.** Run `npm install` in the worktree root before the first build, or every build inlines the *main checkout's* shared `dist`. Verify with `grep -c '\.\./shared/dist' packages/server/dist/index.js` after a build — the path must be `../shared/dist/…`, never `../../../../../packages/shared/dist/…`.
- **Build with root `npm run build`, never `npm run build --workspaces`.** The order shared → server → client is load-bearing.
- **No magic numbers in logic.** Every tunable lands in `AIM_CONFIG`. Every duration is authored in **milliseconds** and converted to ticks exactly once, via `msToTicks`.
- **Combat is server-only.** The client never computes, predicts, or arbitrates a lock. It reads `lockTargetSessionId` and draws.
- **`runCombat` stays pure** over plain objects, and `combat-bridge.ts` holds zero rules.
- **Test commands** (run from the repo root):
  - shared: `npm run test -w @motor-combat-moba/shared -- <path>`
  - server: `npm run test -w @motor-combat-moba/server -- <path>`
  - client: `npm run test -w @motor-combat-moba/client -- <path>`
  - everything: `npm test`
- **Commit after every task.** Conventional Commits, and end every commit message body with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/config/aim-config.ts` | **New.** `AIM_CONFIG` (all geometry and feel) and `AIM_TICKS` (its three durations in ticks). |
| `packages/shared/src/config/aim-config.test.ts` | **New.** Validates A9 assertions 1–2 and the tick derivation. |
| `packages/shared/src/config/weapon-types.ts` | Modify. `usesAimAssist: boolean` on `WeaponBase`. |
| `packages/shared/src/config/weapon-config.ts` | Modify. `usesAimAssist` on both rows. Task 8 flips `cannon`. |
| `packages/shared/src/config/weapon-config.test.ts` | Modify. A9 assertions 3–4 and the A12 attached-beam guard. |
| `packages/shared/src/sim/weapons/lock.ts` | **New.** Geometry, scoring, region predicates, LOS, and `updateLock`. Pure. |
| `packages/shared/src/sim/weapons/lock.test.ts` | **New.** All of the above. |
| `packages/shared/src/sim/weapons/instances.ts` | Modify. `spawnInstances` takes an optional aim angle (A11). |
| `packages/shared/src/sim/combat.ts` | Modify. `CombatPlayer.lock`, the new lock phase, aim angle at spawn. |
| `packages/shared/src/sim/combat.test.ts` | Modify. Integration coverage through a real tick. |
| `packages/shared/src/schema/PlayerState.ts` | Modify. One field: `lockTargetSessionId`. |
| `packages/shared/src/index.ts` | Modify. Export the new surface. |
| `packages/server/src/sim/combat-bridge.ts` | Modify. `CombatMemory.locks`, write-back, clear on match end. |
| `packages/server/src/sim/combat-bridge.test.ts` | Modify. Lock persistence and clearing. |
| `packages/client/src/scenes/combat-visual.ts` | Modify. `lockBracketArms` — pure bracket geometry. |
| `packages/client/src/scenes/combat-visual.test.ts` | Modify. Bracket geometry. |
| `packages/client/src/scenes/ArenaScene.ts` | Modify. A `lockGfx` layer and the draw call. |
| `docs/combat-model.md`, `docs/config-reference.md`, `docs/schema-reference.md`, `CLAUDE.md` | Modify, Task 8. |

---

## Task 1: `AIM_CONFIG` and its tick derivation

**Files:**
- Create: `packages/shared/src/config/aim-config.ts`
- Create: `packages/shared/src/config/aim-config.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `msToTicks` from `./weapon-ticks.js`.
- Produces: `AIM_CONFIG` (frozen object literal, fields listed below) and `AIM_TICKS: Readonly<AimTicks>` with `commit`, `lockTimeout`, `losGrace` — all integer ticks.

**Why the import direction matters:** `aim-config.ts` imports from `weapon-ticks.ts`, never the reverse. `weapon-ticks.ts` imports `weapon-config.ts`, so a back-import would create a cycle.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/config/aim-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { AIM_CONFIG, AIM_TICKS } from "./aim-config.js";

describe("AIM_CONFIG", () => {
  it("keeps the cone a real forward cone", () => {
    // A9.1. At 90 degrees or more the cone stops meaning "in front of me": it would accept a target
    // exactly beside the car, and at 180 it accepts one directly behind.
    expect(AIM_CONFIG.coneDeg).toBeGreaterThan(0);
    expect(AIM_CONFIG.coneDeg).toBeLessThan(90);
  });

  it("keeps the lateral cap and lock range positive", () => {
    // A9.2. Either at zero collapses the acquisition region to nothing and aim assist silently
    // never fires, which looks exactly like the feature not being wired up.
    expect(AIM_CONFIG.lateralMax).toBeGreaterThan(0);
    expect(AIM_CONFIG.lockRange).toBeGreaterThan(0);
  });

  it("keeps every retention pad non-negative", () => {
    // A6. A negative pad would make retention TIGHTER than acquisition, so a target would be
    // dropped on the tick after it was acquired and the lock would strobe at the region edge.
    expect(AIM_CONFIG.retentionConeDeg).toBeGreaterThanOrEqual(0);
    expect(AIM_CONFIG.retentionLateralUnits).toBeGreaterThanOrEqual(0);
    expect(AIM_CONFIG.retentionRangeUnits).toBeGreaterThanOrEqual(0);
  });

  it("keeps the steal margin a real fraction", () => {
    // A7. At 0 any better score steals and the commit timer is the only friction; at 1 a candidate
    // would need a score of zero or less, which is unreachable, so nothing could ever steal.
    expect(AIM_CONFIG.stealMarginFraction).toBeGreaterThan(0);
    expect(AIM_CONFIG.stealMarginFraction).toBeLessThan(1);
  });

  it("scales the distance term to trade off against the angle term", () => {
    // A5. The two terms of the score must be comparable in magnitude across the lock range, or the
    // larger one decides every contest alone. At 0.4 per world unit (the figure that reads
    // naturally as "per metre", a unit this game does not have) a target at lockRange scores 160
    // against an angle term that maxes at coneDeg -- the angle becomes noise and the system
    // degenerates to "always nearest".
    const maxDistanceTerm = AIM_CONFIG.lockRange * AIM_CONFIG.scorePerDistanceUnit;
    expect(maxDistanceTerm).toBeGreaterThan(AIM_CONFIG.coneDeg / 4);
    expect(maxDistanceTerm).toBeLessThan(AIM_CONFIG.coneDeg * 4);
  });
});

describe("AIM_TICKS", () => {
  it("derives whole ticks from the authored milliseconds", () => {
    expect(AIM_TICKS.commit).toBe(Math.ceil((AIM_CONFIG.commitMs * TICK_RATE_HZ) / 1000));
    expect(AIM_TICKS.lockTimeout).toBe(Math.ceil((AIM_CONFIG.lockTimeoutMs * TICK_RATE_HZ) / 1000));
    expect(AIM_TICKS.losGrace).toBe(Math.ceil((AIM_CONFIG.losGraceMs * TICK_RATE_HZ) / 1000));
  });

  it("pins the derived counts at 30 Hz", () => {
    expect(TICK_RATE_HZ).toBe(30);
    expect(AIM_TICKS.commit).toBe(12);
    expect(AIM_TICKS.lockTimeout).toBe(24);
    expect(AIM_TICKS.losGrace).toBe(9);
  });

  it("gives the commit timer room to matter inside the engagement window", () => {
    // A7/A8 interact: if the commit window were as long as the engagement timeout, a lock could
    // never be stolen -- the timer would always lapse before the commit cleared, so every switch
    // would go through the no-margin path and the 25% margin would be dead config.
    expect(AIM_TICKS.commit).toBeLessThan(AIM_TICKS.lockTimeout);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/shared -- src/config/aim-config.test.ts`
Expected: FAIL — `Failed to resolve import "./aim-config.js"`.

- [ ] **Step 3: Write the config**

Create `packages/shared/src/config/aim-config.ts`:

```ts
import { msToTicks } from "./weapon-ticks.js";

/**
 * Aim assist geometry and feel. Every number here is global: a weapon opts in with a boolean
 * (`usesAimAssist`) and inherits all of this (A1).
 *
 * **Why one lock per car and not one per slot.** Per-slot locks with per-weapon cones are more
 * expressive, but cost up to three lock state machines per car, three brackets needing slot tags in
 * the HUD and in spectate, three commit/retention timers driven by a single per-car engagement
 * clock, and three runs of every "release on target death" cleanup path. All three chassis carry
 * exactly one slot today. If a second aim-assist weapon ever needs its own cone, the migration is
 * additive: this block moves onto the weapon def and the lock splits per slot.
 *
 * **What the two region bounds are for.** Neither survives alone in this arena.
 * A pure cone's half-width scales with distance -- at 20 degrees that is 0.36x, so 327 units at the
 * cannon's 900 unit range, a 654 unit wide region inside a 1280 unit wide arena.
 * A pure lateral lane has the mirror-image flaw: its ANGULAR width collapses with distance and
 * explodes near the car, so a 120 unit lane accepts a target 13 units ahead sitting 83 degrees off
 * the nose. Since ramming is a core mechanic, cars spend much of a match at exactly that range, and
 * the lock is ambient -- the trigger cannot override it. Intersected, the cone governs contact
 * range and the cap governs long range, crossing over at `lateralMax / tan(coneDeg)`, about 330 u.
 */
export const AIM_CONFIG = {
  /** Half-angle of the acquisition cone, degrees. Validated strictly inside 0-90. */
  coneDeg: 20,
  /** Maximum perpendicular offset from the car's centreline, world units. */
  lateralMax: 120,
  /**
   * Maximum distance to a lockable target, world units. Deliberately its own number and well below
   * any weapon's `range` (A3).
   *
   * The lock aims where the target IS, with no lead. Displacement during flight is
   * `(targetSpeed / projectileSpeed) * distance`; at 540 / 900 that is `0.6 * distance` against a
   * tolerance of about 28 units (half a car's 32 unit width plus the cannon's 12 unit hitbox), so a
   * full-speed crosser is only hittable inside roughly 47 units. Inheriting a 900 unit weapon range
   * would make the far half of every lock acquire reliably and miss reliably -- a strong-looking
   * snap that whiffs, which reads as a broken system rather than as a skill boundary.
   */
  lockRange: 400,

  /**
   * Retention pads. An already-locked target is held while it stays inside every acquisition bound
   * widened by its own pad (A6).
   *
   * All THREE are padded, not just the angle. Padding only the cone -- the natural reading of
   * "retain within cone + 5 degrees" -- does nothing at long range, where the lateral cap is the
   * binding constraint: a target 400 units out crosses the lane edge at 17.5 degrees, nowhere near
   * the 20 degree cone, so it would exit with zero hysteresis and strobe exactly as the pad exists
   * to prevent. Kept small; wider retention starts to feel like an aimbot.
   */
  retentionConeDeg: 5,
  retentionLateralUnits: 30,
  retentionRangeUnits: 60,

  /**
   * The distance term's weight, **per world unit** (A5).
   *
   * The unit matters more than the digit. This game has no metres -- the world is in units and cars
   * are 48 x 32 -- so a coefficient written as 0.4 "per metre" scores a target at 400 units at 160,
   * against an angle term that maxes at 20. The angle becomes noise and the result is "always
   * nearest target", not a scoring system. 0.04 makes the two terms comparable across `lockRange`.
   * This is the lever for how close-range the game feels.
   */
  scorePerDistanceUnit: 0.04,
  /** How much better (lower) a rival's score must be to steal the lock. 0.25 = 25% better. */
  stealMarginFraction: 0.25,

  /** Minimum time on a target before it may be stolen away. */
  commitMs: 400,
  /**
   * How long after the last fire press the lock keeps its INCUMBENCY (A8).
   *
   * Lapsing does not unlock: release and re-acquisition resolve in the same pass, so the bracket
   * never blanks for a frame. What lapses is the steal margin and the commit timer, so the next
   * evaluation simply picks the best-scoring target. That is what splits weapons into two classes --
   * faster than `1000 / lockTimeoutMs` holds locks and the margin governs; slower re-picks the best
   * target every shot. 800 ms puts the cliff at 1.25 Hz, clear of the cannon's 2.0 Hz. At the 600 ms
   * this was first drafted at, the cliff sat at 1.67 Hz and the only shipped weapon landed inside
   * the unstable band its own guard test rejects.
   */
  lockTimeoutMs: 800,
  /** How long a target may be out of sight before the lock is released. */
  losGraceMs: 300,
} as const;

/** `AIM_CONFIG`'s three durations, in the integer ticks the sim actually counts. */
export interface AimTicks {
  commit: number;
  lockTimeout: number;
  losGrace: number;
}

/**
 * Derived once at module load and frozen, exactly as `WEAPON_TICKS` is: server and client both
 * import shared's built `dist`, so both compute identical counts or neither does.
 */
export const AIM_TICKS: Readonly<AimTicks> = Object.freeze({
  commit: msToTicks(AIM_CONFIG.commitMs),
  lockTimeout: msToTicks(AIM_CONFIG.lockTimeoutMs),
  losGrace: msToTicks(AIM_CONFIG.losGraceMs),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/shared -- src/config/aim-config.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Export from the shared barrel**

In `packages/shared/src/index.ts`, immediately after the `export { COMBAT_CONFIG } from "./config/combat-config.js";` line, add:

```ts
export { AIM_CONFIG, AIM_TICKS } from "./config/aim-config.js";
export type { AimTicks } from "./config/aim-config.js";
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck -w @motor-combat-moba/shared`
Expected: no output, exit 0.

```bash
git add packages/shared/src/config/aim-config.ts packages/shared/src/config/aim-config.test.ts packages/shared/src/index.ts
git commit -m "feat(config): add AIM_CONFIG and its tick derivation"
```

---

## Task 2: `usesAimAssist` on every weapon row, plus the authoring guards

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts`
- Modify: `packages/shared/src/config/weapon-config.ts`
- Modify: `packages/shared/src/config/weapon-config.test.ts`

**Interfaces:**
- Consumes: `AIM_CONFIG` from Task 1.
- Produces: `WeaponDef.usesAimAssist: boolean` — readable off any `weaponDefOf(id)`.

The field is **required**, not optional, so every existing row must state its answer and a new weapon cannot forget to. Both rows ship `false` here; Task 8 flips `cannon`.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/config/weapon-config.test.ts`, add `AIM_CONFIG` to the imports:

```ts
import { AIM_CONFIG } from "./aim-config.js";
```

Then append these three tests inside the existing `describe("WEAPON_TABLE", ...)` block:

```ts
  it("ships every row with aim assist off", () => {
    // Task 8 flips `cannon` on its own, as the single commit that changes how the game plays.
    // Until then the whole system is inert in play and proven by unit tests alone.
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      expect(def.usesAimAssist).toBe(false);
    }
  });

  it("never lets an aim-assist weapon lock past its own reach", () => {
    // A9.3. This is the one corner case a single per-car lock leaves open: with global geometry, a
    // weapon can hold a lock on a target its own `range` cannot reach, so it fires at a visible
    // bracket and falls short. Caught at authoring time instead of in play.
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (!def.usesAimAssist) continue;
      expect(def.range).toBeGreaterThanOrEqual(AIM_CONFIG.lockRange);
    }
  });

  it("keeps aim-assist weapons off the behavioural cliff", () => {
    // A9.4. `lockTimeoutMs` splits weapons into two targeting classes at `1000 / lockTimeoutMs`:
    // above it presses keep refreshing the timer and the 25% steal margin governs; below it the
    // timer lapses between shots and every shot re-picks the best target. A weapon authored near
    // the boundary flips between the two depending on how metronomically the player fires.
    //
    // The cliff is DERIVED, not hardcoded, so retuning `lockTimeoutMs` moves this guard with it
    // rather than stranding a stale range. Sustained rate is `1000 / cooldownMs` for every weapon:
    // a stocked weapon still needs one full `cooldownMs` per stock, and `refireDelayMs` only spaces
    // a burst. Per-row and therefore conservative -- a multi-slot car presses MORE often, which
    // moves it away from the cliff, never toward it.
    const cliffHz = 1000 / AIM_CONFIG.lockTimeoutMs;
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (!def.usesAimAssist) continue;
      const sustainedHz = 1000 / def.cooldownMs;
      const distance = Math.abs(sustainedHz - cliffHz) / cliffHz;
      expect(distance).toBeGreaterThan(0.15);
    }
  });

  it("refuses aim assist on an attached beam", () => {
    // A12. An attached beam re-derives its origin and angle from the owner's pose every tick, so it
    // would snap to the lock at birth and immediately re-weld to the car's nose. Dormant until the
    // first beam row ships, and written now rather than then: making an attached beam track the
    // lock every tick is a far stronger weapon than its numbers suggest, and not a decision anyone
    // should make implicitly.
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (def.kind !== "beam" || !def.attached) continue;
      expect(def.usesAimAssist).toBe(false);
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts`
Expected: FAIL — the first test reports `expected undefined to be false`, because no row has the field yet.

- [ ] **Step 3: Add the field to the type**

In `packages/shared/src/config/weapon-types.ts`, inside `interface WeaponBase`, add immediately after the `recoveryMs` field and before `stock?:`:

```ts
  /**
   * true = this weapon fires at the car's current lock (A1); false = its exit angle is welded to
   * the car's heading, which is how every weapon behaved before aim assist existed.
   *
   * Required rather than optional on purpose: every row must state its answer, so authoring a new
   * weapon cannot silently inherit a targeting behaviour nobody chose.
   */
  usesAimAssist: boolean;
```

- [ ] **Step 4: Add the field to both rows**

In `packages/shared/src/config/weapon-config.ts`, add `usesAimAssist: false,` to each row directly beneath its `recoveryMs` line — once in `cannon` and once in `repeater`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts`
Expected: PASS. The three guard tests pass vacuously (no row opts in yet), which is correct — they exist to fire the moment one does.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck -w @motor-combat-moba/shared`
Expected: exit 0.

```bash
git add packages/shared/src/config/weapon-types.ts packages/shared/src/config/weapon-config.ts packages/shared/src/config/weapon-config.test.ts
git commit -m "feat(config): add usesAimAssist to every weapon row, off by default"
```

---

## Task 3: Lock geometry — scoring, regions, line of sight

**Files:**
- Create: `packages/shared/src/sim/weapons/lock.ts`
- Create: `packages/shared/src/sim/weapons/lock.test.ts`

**Interfaces:**
- Consumes: `AIM_CONFIG` (Task 1); `wallClipDistance` and `muzzleOffset` from `./instances.js`; `Aabb`, `Bounds` from `../collide.js`.
- Produces:
  - `interface LockOwner { sessionId: string; team: 0 | 1; x: number; y: number; angle: number }`
  - `interface LockTarget { sessionId: string; team: 0 | 1; x: number; y: number }`
  - `signedAngleDegTo(owner: LockOwner, tx: number, ty: number): number`
  - `lockScore(angleDeg: number, distance: number): number`
  - `inAcquireRegion(angleDeg: number, distance: number): boolean`
  - `inRetainRegion(angleDeg: number, distance: number): boolean`
  - `hasLineOfSight(ox, oy, tx, ty, obstacles: readonly Aabb[], bounds: Bounds): boolean`
  - `muzzleOf(owner: LockOwner): { x: number; y: number }`

This task is pure geometry — no state, no state machine. Task 4 builds the machine on top.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/sim/weapons/lock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AIM_CONFIG } from "../../config/aim-config.js";
import type { Aabb, Bounds } from "../collide.js";
import {
  hasLineOfSight,
  inAcquireRegion,
  inRetainRegion,
  lockScore,
  muzzleOf,
  signedAngleDegTo,
  type LockOwner,
} from "./lock.js";

// `Bounds` is an extent, not a min/max box: the world is [0, width] x [0, height].
const BOUNDS: Bounds = { width: 2000, height: 2000 };

// `Aabb` is `{x, y, w, h}` with x/y at the TOP-LEFT, matching how arena obstacles are authored.
function ownerAt(x: number, y: number, angle = 0): LockOwner {
  return { sessionId: "me", team: 0, x, y, angle };
}

describe("signedAngleDegTo", () => {
  it("is zero for a target straight ahead", () => {
    expect(signedAngleDegTo(ownerAt(100, 100), 300, 100)).toBeCloseTo(0, 6);
  });

  it("is signed, and measured relative to the car's heading, not to the world", () => {
    // Same world bearing, two headings: the angle is what the DRIVER sees, so rotating the car
    // must move it. A world-relative angle would report 90 in both cases.
    const facingEast = signedAngleDegTo(ownerAt(100, 100, 0), 100, 300);
    const facingSouth = signedAngleDegTo(ownerAt(100, 100, Math.PI / 2), 100, 300);
    expect(facingEast).toBeCloseTo(90, 6);
    expect(facingSouth).toBeCloseTo(0, 6);
  });

  it("wraps to (-180, 180] rather than accumulating", () => {
    // A car that has spun several times carries a large `angle`. Without normalisation the delta
    // grows without bound and every region test fails for a target sitting straight ahead.
    const spun = ownerAt(100, 100, Math.PI * 6);
    expect(Math.abs(signedAngleDegTo(spun, 300, 100))).toBeLessThan(1e-6);
    const behind = signedAngleDegTo(ownerAt(100, 100, 0), 0, 100);
    expect(Math.abs(behind)).toBeCloseTo(180, 6);
  });
});

describe("lockScore", () => {
  it("adds the angle in degrees to the distance in scaled world units", () => {
    expect(lockScore(10, 200)).toBeCloseTo(10 + 200 * AIM_CONFIG.scorePerDistanceUnit, 6);
  });

  it("ignores the sign of the angle", () => {
    expect(lockScore(-12, 300)).toBeCloseTo(lockScore(12, 300), 6);
  });

  it("prefers a nearer off-axis target to a far centreline one", () => {
    // This is the case the distance term exists for (A5). Without it, the far target -- which sits
    // near the centreline precisely BECAUSE it is far -- wins every contest.
    const nearOffAxis = lockScore(12, 80);
    const farCentreline = lockScore(1, 390);
    expect(nearOffAxis).toBeLessThan(farCentreline);
  });
});

describe("inAcquireRegion", () => {
  it("accepts a target inside every bound", () => {
    expect(inAcquireRegion(5, 150)).toBe(true);
  });

  it("rejects on the cone alone, with the lateral cap satisfied", () => {
    // 40 units out at 45 degrees: lateral offset is only 28 units, far inside the 120 unit cap, and
    // the distance is far inside lockRange. The cone is the only thing saying no -- which is the
    // whole reason a pure lateral lane was rejected.
    expect(inAcquireRegion(45, 40)).toBe(false);
  });

  it("rejects on the lateral cap alone, with the cone satisfied", () => {
    // 380 units out at 19 degrees: inside the 20 degree cone, but the lateral offset is 124 units,
    // just past the 120 unit cap. The cap is the only thing saying no -- the reason a pure cone was
    // rejected.
    expect(inAcquireRegion(19, 380)).toBe(false);
  });

  it("rejects on range alone", () => {
    expect(inAcquireRegion(0, AIM_CONFIG.lockRange + 1)).toBe(false);
    expect(inAcquireRegion(0, AIM_CONFIG.lockRange)).toBe(true);
  });

  it("hands over from the cone to the cap at the crossover distance", () => {
    // Below `lateralMax / tan(coneDeg)` (about 330 u) the cone binds; above it the cap does.
    const crossover = AIM_CONFIG.lateralMax / Math.tan((AIM_CONFIG.coneDeg * Math.PI) / 180);
    const justInside = crossover - 20;
    const justOutside = crossover + 20;
    // At the cone's exact edge: accepted below the crossover, rejected above it.
    expect(inAcquireRegion(AIM_CONFIG.coneDeg, justInside)).toBe(true);
    expect(inAcquireRegion(AIM_CONFIG.coneDeg, justOutside)).toBe(false);
  });
});

describe("inRetainRegion", () => {
  it("is wider than acquisition on the cone", () => {
    const justPastCone = AIM_CONFIG.coneDeg + AIM_CONFIG.retentionConeDeg / 2;
    expect(inAcquireRegion(justPastCone, 100)).toBe(false);
    expect(inRetainRegion(justPastCone, 100)).toBe(true);
  });

  it("is wider than acquisition on the lateral cap", () => {
    // The bound that a cone-only retention pad would miss entirely (A6). At 380 units the cap binds,
    // so widening only the angle would leave this target with no hysteresis at all.
    expect(inAcquireRegion(19, 380)).toBe(false);
    expect(inRetainRegion(19, 380)).toBe(true);
  });

  it("is wider than acquisition on range", () => {
    const justPast = AIM_CONFIG.lockRange + AIM_CONFIG.retentionRangeUnits / 2;
    expect(inAcquireRegion(0, justPast)).toBe(false);
    expect(inRetainRegion(0, justPast)).toBe(true);
  });

  it("still releases once every pad is exceeded", () => {
    expect(inRetainRegion(AIM_CONFIG.coneDeg + AIM_CONFIG.retentionConeDeg + 1, 100)).toBe(false);
    expect(
      inRetainRegion(0, AIM_CONFIG.lockRange + AIM_CONFIG.retentionRangeUnits + 1),
    ).toBe(false);
  });
});

describe("muzzleOf", () => {
  it("sits half a car length ahead of the centre, along the heading", () => {
    const m = muzzleOf(ownerAt(100, 100, 0));
    expect(m.x).toBeCloseTo(124, 6);
    expect(m.y).toBeCloseTo(100, 6);
  });
});

describe("hasLineOfSight", () => {
  it("is clear across empty ground", () => {
    expect(hasLineOfSight(100, 100, 500, 100, [], BOUNDS)).toBe(true);
  });

  it("is blocked by an obstacle between the two", () => {
    const wall: Aabb = { x: 280, y: 60, w: 40, h: 200 };
    expect(hasLineOfSight(100, 100, 500, 100, [wall], BOUNDS)).toBe(false);
  });

  it("is clear when the obstacle sits BEYOND the target", () => {
    // The ray is cast only as far as the target. A raycast run to the weapon's full range instead
    // would report a wall standing behind the enemy as cover.
    const wall: Aabb = { x: 600, y: 60, w: 40, h: 200 };
    expect(hasLineOfSight(100, 100, 500, 100, [wall], BOUNDS)).toBe(true);
  });

  it("is clear when the obstacle is off the line", () => {
    const wall: Aabb = { x: 280, y: 400, w: 40, h: 200 };
    expect(hasLineOfSight(100, 100, 500, 100, [wall], BOUNDS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/lock.test.ts`
Expected: FAIL — `Failed to resolve import "./lock.js"`.

- [ ] **Step 3: Write the geometry module**

Create `packages/shared/src/sim/weapons/lock.ts`:

```ts
import { AIM_CONFIG } from "../../config/aim-config.js";
import type { Aabb, Bounds } from "../collide.js";
import { muzzleOffset, wallClipDistance } from "./instances.js";

/** The car doing the locking, as the lock step sees it. */
export interface LockOwner {
  sessionId: string;
  team: 0 | 1;
  x: number;
  y: number;
  angle: number;
}

/** A car that might be locked. Poses only -- validity is decided by the caller and `canDamage`. */
export interface LockTarget {
  sessionId: string;
  team: 0 | 1;
  x: number;
  y: number;
}

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/**
 * Where the shot actually leaves from: the front face of the owner's hull, along its heading.
 *
 * Shared by the line-of-sight ray and by the fired angle (A11a), so the two can never disagree
 * about where the weapon is. The muzzle position itself is never moved by the lock (A11b) -- it is
 * a physical point on the car, and a wide-angle lock that moved it would spawn shots off the side
 * of the hull in open space.
 */
export function muzzleOf(owner: LockOwner): { x: number; y: number } {
  const nose = muzzleOffset();
  return { x: owner.x + Math.cos(owner.angle) * nose, y: owner.y + Math.sin(owner.angle) * nose };
}

/**
 * Signed angle from the car's heading to a target, in degrees, normalised to (-180, 180].
 *
 * Measured from the car CENTRE, not the muzzle: "how far off my nose is this" is a fact about the
 * car's facing, and it is what both the region test and the score are asking. The angle actually
 * FIRED is muzzle-derived instead (A11a) -- the 24 unit offset between the two is a real parallax
 * at close range, and conflating them would miss by about a car length at 100 units and 40 degrees.
 *
 * Normalisation is not decoration: `angle` accumulates as a car spins, so an un-wrapped delta grows
 * without bound and every region test would reject a target sitting straight ahead.
 */
export function signedAngleDegTo(owner: LockOwner, tx: number, ty: number): number {
  const bearing = Math.atan2(ty - owner.y, tx - owner.x);
  let delta = bearing - owner.angle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  return delta * DEG_PER_RAD;
}

/**
 * How good a target is. **Lowest wins** (A5).
 *
 * The distance term is what stops the score being biased toward far targets, which sit near the
 * centreline precisely because they are far. Its coefficient is per WORLD UNIT -- see
 * `AIM_CONFIG.scorePerDistanceUnit` for why the unit is the load-bearing part.
 */
export function lockScore(angleDeg: number, distance: number): number {
  return Math.abs(angleDeg) + distance * AIM_CONFIG.scorePerDistanceUnit;
}

/**
 * The three bounds of the acquisition region, each optionally widened by a pad. Acquisition passes
 * zero pads; retention passes `AIM_CONFIG`'s (A6).
 */
function withinRegion(
  angleDeg: number,
  distance: number,
  conePadDeg: number,
  lateralPadUnits: number,
  rangePadUnits: number,
): boolean {
  const absDeg = Math.abs(angleDeg);
  if (absDeg > AIM_CONFIG.coneDeg + conePadDeg) return false;
  if (distance > AIM_CONFIG.lockRange + rangePadUnits) return false;
  const lateral = distance * Math.sin(absDeg * RAD_PER_DEG);
  return lateral <= AIM_CONFIG.lateralMax + lateralPadUnits;
}

/** Cone AND lateral cap AND lock range (A2). All three, or the region is wrong at one end. */
export function inAcquireRegion(angleDeg: number, distance: number): boolean {
  return withinRegion(angleDeg, distance, 0, 0, 0);
}

/** Acquisition widened by every retention pad. Strictly wider than `inAcquireRegion` (A6). */
export function inRetainRegion(angleDeg: number, distance: number): boolean {
  return withinRegion(
    angleDeg,
    distance,
    AIM_CONFIG.retentionConeDeg,
    AIM_CONFIG.retentionLateralUnits,
    AIM_CONFIG.retentionRangeUnits,
  );
}

/**
 * Can the muzzle see the target centre? Reuses the beam clip's raycast rather than adding a second
 * spelling of "what stops a ray".
 *
 * The ray is cast exactly as far as the TARGET, never to the weapon's range: a wall standing behind
 * an enemy is not cover.
 *
 * A no-op in every shipped match -- `ACTIVE_ARENA_ID` is `arena-01`, whose `obstacles` is `[]` --
 * and built anyway, because switching arenas is deliberately a one-line edit and `arena-02` already
 * exists with obstacles in it. Without this, that one line would silently turn aim assist into
 * lock-through-walls with no targeting code touched.
 *
 * **Wrecks are not cover.** They are never in the candidate list, and they are not obstacles: a
 * wreck is solid to driving but transparent to combat, so shots already pass straight through one
 * without even spending a pierce budget. Treating it as cover would drop the lock for an
 * obstruction that demonstrably does not stop the bullet.
 */
export function hasLineOfSight(
  ox: number,
  oy: number,
  tx: number,
  ty: number,
  obstacles: readonly Aabb[],
  bounds: Bounds,
): boolean {
  const distance = Math.hypot(tx - ox, ty - oy);
  if (distance === 0) return true;
  const angle = Math.atan2(ty - oy, tx - ox);
  return wallClipDistance(ox, oy, angle, distance, obstacles, bounds) >= distance;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/lock.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/weapons/lock.ts packages/shared/src/sim/weapons/lock.test.ts
git commit -m "feat(sim): add lock scoring, region predicates, and line of sight"
```

---

## Task 4: `updateLock` — the state machine

**Files:**
- Modify: `packages/shared/src/sim/weapons/lock.ts`
- Modify: `packages/shared/src/sim/weapons/lock.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: everything from Task 3, plus `AIM_TICKS` (Task 1) and `canDamage` from `./targets.js`.
- Produces:
  - `interface LockState { targetSessionId: string; lockedAtTick: number; losLostSinceTick: number; lastPressTick: number }`
  - `newLockState(): LockState`
  - `interface UpdateLockContext { owner: LockOwner; ownerFighting: boolean; pressedThisTick: boolean; candidates: readonly LockTarget[]; mode: "ffa" | "team"; obstacles: readonly Aabb[]; bounds: Bounds; tick: number }`
  - `updateLock(state: LockState, ctx: UpdateLockContext): LockState`

**The two hystereses, kept separate** — this is the part most likely to be implemented wrong:

- **Spatial** (retention region + LOS grace) decides whether the *current* target is still held at all.
- **Competitive** (steal margin + commit timer) decides whether a *rival* may take its place, and is what the engagement timeout switches off.

A lapsed timeout therefore never blanks the bracket. It only drops the margin and commit gates, so the best-scoring target wins outright.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/sim/weapons/lock.test.ts`, extend the import from `./lock.js` with `newLockState`, `updateLock`, and `type LockTarget`, and add these helpers below the existing `ownerAt`:

```ts
/**
 * The owner sits well inside the arena, NOT at the origin. `pointOutsideBounds` is inclusive on
 * every edge, so a car at (0, 0) has its muzzle on the boundary and `wallClipDistance` reports a
 * reach of 0 — every line-of-sight test would fail for reasons that have nothing to do with locks.
 */
const OX = 400;
const OY = 400;

/** Enemies are placed in the owner's frame: `forward` along its nose, `lateral` across it. */
function enemyAt(sessionId: string, forward: number, lateral: number): LockTarget {
  return { sessionId, team: 1, x: OX + forward, y: OY + lateral };
}

function ctxFor(
  candidates: readonly LockTarget[],
  tick: number,
  overrides: Partial<Parameters<typeof updateLock>[1]> = {},
) {
  return {
    owner: ownerAt(OX, OY, 0),
    ownerFighting: true,
    pressedThisTick: false,
    candidates,
    mode: "ffa" as const,
    obstacles: [] as Aabb[],
    bounds: BOUNDS,
    tick,
    ...overrides,
  };
}
```

Then append these describe blocks:

```ts
describe("updateLock: acquisition", () => {
  it("locks the only valid target in the region", () => {
    const next = updateLock(newLockState(), ctxFor([enemyAt("a", 200, 0)], 5));
    expect(next.targetSessionId).toBe("a");
    expect(next.lockedAtTick).toBe(5);
  });

  it("locks nothing when the region is empty", () => {
    const next = updateLock(newLockState(), ctxFor([enemyAt("a", 0, 300)], 5));
    expect(next.targetSessionId).toBe("");
  });

  it("takes the lowest score when several qualify", () => {
    // "b" is nearer and only slightly off-axis; "a" is dead ahead but far.
    const next = updateLock(newLockState(), ctxFor([enemyAt("a", 390, 0), enemyAt("b", 80, 17)], 5));
    expect(next.targetSessionId).toBe("b");
  });

  it("ignores the steal margin and the commit timer when there is no incumbent", () => {
    // Acquiring from nothing has no incumbent to beat, so a marginal target still locks instantly.
    const next = updateLock(newLockState(), ctxFor([enemyAt("a", 200, 0)], 0));
    expect(next.targetSessionId).toBe("a");
  });

  it("never locks a teammate in team mode", () => {
    const mate: LockTarget = { sessionId: "mate", team: 0, x: OX + 200, y: OY };
    const next = updateLock(newLockState(), ctxFor([mate], 5, { mode: "team" }));
    expect(next.targetSessionId).toBe("");
  });

  it("locks that same car in ffa, where teams are only seating", () => {
    const other: LockTarget = { sessionId: "other", team: 0, x: OX + 200, y: OY };
    const next = updateLock(newLockState(), ctxFor([other], 5, { mode: "ffa" }));
    expect(next.targetSessionId).toBe("other");
  });

  it("never locks itself", () => {
    const self: LockTarget = { sessionId: "me", team: 0, x: OX + 200, y: OY };
    const next = updateLock(newLockState(), ctxFor([self], 5));
    expect(next.targetSessionId).toBe("");
  });

  it("will not acquire a target it cannot see", () => {
    // Acquisition needs sight NOW. The grace period is a retention rule only -- extending it to
    // acquisition would let a lock pop onto a car that has been behind a wall the whole time.
    const wall: Aabb = { x: OX + 90, y: OY - 60, w: 40, h: 120 };
    const next = updateLock(newLockState(), ctxFor([enemyAt("a", 200, 0)], 5, { obstacles: [wall] }));
    expect(next.targetSessionId).toBe("");
  });
});

describe("updateLock: retention", () => {
  it("holds a target that has drifted past acquisition but not past retention", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    // 19 degrees at 380 units: 124 units of lateral offset, past the 120 cap, inside 120 + 30.
    const drifted = enemyAt("a", 380 * Math.cos(0.3316), 380 * Math.sin(0.3316));
    const next = updateLock(held, ctxFor([drifted], 20));
    expect(next.targetSessionId).toBe("a");
    expect(next.lockedAtTick).toBe(0);
  });

  it("releases a target that leaves the retention region", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const gone = enemyAt("a", 100, 400);
    expect(updateLock(held, ctxFor([gone], 20)).targetSessionId).toBe("");
  });

  it("releases a target that has left the field entirely", () => {
    // Death, disconnect and leaving the roster all arrive the same way: the car is simply absent
    // from the candidate list the caller builds from living fighters.
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    expect(updateLock(held, ctxFor([], 20)).targetSessionId).toBe("");
  });

  it("holds through a brief loss of sight and records when it started", () => {
    const wall: Aabb = { x: OX + 90, y: OY - 60, w: 40, h: 120 };
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([enemyAt("a", 200, 0)], 20, { obstacles: [wall] }));
    expect(next.targetSessionId).toBe("a");
    expect(next.losLostSinceTick).toBe(20);
  });

  it("releases once sight has been lost for longer than the grace", () => {
    const wall: Aabb = { x: OX + 90, y: OY - 60, w: 40, h: 120 };
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 20, lastPressTick: 0 };
    const stillHidden = updateLock(
      held,
      ctxFor([enemyAt("a", 200, 0)], 20 + AIM_TICKS.losGrace - 1, { obstacles: [wall] }),
    );
    expect(stillHidden.targetSessionId).toBe("a");

    const expired = updateLock(
      held,
      ctxFor([enemyAt("a", 200, 0)], 20 + AIM_TICKS.losGrace, { obstacles: [wall] }),
    );
    expect(expired.targetSessionId).toBe("");
  });

  it("clears the loss timer when sight returns", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 20, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([enemyAt("a", 200, 0)], 25));
    expect(next.losLostSinceTick).toBe(0);
  });
});

describe("updateLock: stealing", () => {
  // "a" straight ahead at 200 scores 8. A rival must reach 6 or lower to beat it by 25%.
  const incumbent = enemyAt("a", 200, 0);
  const marginal = enemyAt("b", 175, 0); // score 7 -- better, but not by enough
  const decisive = enemyAt("c", 100, 0); // score 4 -- clears the margin

  it("refuses a rival that does not clear the margin", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 30 };
    const next = updateLock(held, ctxFor([incumbent, marginal], 30));
    expect(next.targetSessionId).toBe("a");
  });

  it("refuses even a decisive rival inside the commit window", () => {
    const held = { targetSessionId: "a", lockedAtTick: 28, losLostSinceTick: 0, lastPressTick: 30 };
    const next = updateLock(held, ctxFor([incumbent, decisive], 30));
    expect(next.targetSessionId).toBe("a");
  });

  it("allows a decisive rival once the commit window has passed", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 30 };
    const at = AIM_TICKS.commit + 1;
    const next = updateLock(held, ctxFor([incumbent, decisive], Math.max(at, 30)));
    expect(next.targetSessionId).toBe("c");
    expect(next.lockedAtTick).toBe(Math.max(at, 30));
  });
});

describe("updateLock: the engagement timeout", () => {
  const incumbent = enemyAt("a", 200, 0); // score 8
  const marginal = enemyAt("b", 175, 0); // score 7 -- beats it, but not by 25%

  it("keeps incumbency alive while the player keeps pressing fire", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const tick = AIM_TICKS.lockTimeout + 5;
    const next = updateLock(held, ctxFor([incumbent, marginal], tick, { pressedThisTick: true }));
    expect(next.targetSessionId).toBe("a");
    expect(next.lastPressTick).toBe(tick);
  });

  it("refreshes on a press of ANY slot, even one the cooldown will reject", () => {
    // The timer answers "has this player disengaged?", which is a fact about the driver. It is read
    // before `beginFire`, so a press blocked by a cooldown still counts as engagement.
    const next = updateLock(newLockState(), ctxFor([incumbent], 40, { pressedThisTick: true }));
    expect(next.lastPressTick).toBe(40);
  });

  it("drops the margin once the timer lapses, so the best target simply wins", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([incumbent, marginal], AIM_TICKS.lockTimeout));
    expect(next.targetSessionId).toBe("b");
  });

  it("does not blank the lock when the timer lapses with the incumbent still best", () => {
    // The timeout strips INCUMBENCY, not the lock. Releasing and re-acquiring resolve in the same
    // pass, so the bracket never flickers off for a frame.
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([incumbent], AIM_TICKS.lockTimeout + 50));
    expect(next.targetSessionId).toBe("a");
    expect(next.lockedAtTick).toBe(0);
  });

  it("ignores the commit window once the timer has lapsed", () => {
    // Freshly locked AND disengaged: the commit timer is competitive friction, which is exactly
    // what the timeout switches off.
    const held = { targetSessionId: "a", lockedAtTick: 100, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([incumbent, marginal], 100));
    expect(next.targetSessionId).toBe("b");
  });
});

describe("updateLock: the owner", () => {
  it("holds no lock once the owner stops fighting", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const next = updateLock(held, ctxFor([enemyAt("a", 200, 0)], 20, { ownerFighting: false }));
    expect(next).toEqual(newLockState());
  });

  it("never mutates the state it was given", () => {
    const held = { targetSessionId: "a", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
    const before = { ...held };
    updateLock(held, ctxFor([enemyAt("c", 100, 0)], 200));
    expect(held).toEqual(before);
  });
});
```

Add `AIM_TICKS` to the `aim-config.js` import at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/lock.test.ts`
Expected: FAIL — `updateLock is not a function` / import errors for `newLockState`.

- [ ] **Step 3: Write the state machine**

Append to `packages/shared/src/sim/weapons/lock.ts`, and extend its imports with:

```ts
import { AIM_CONFIG, AIM_TICKS } from "../../config/aim-config.js";
import { canDamage } from "./targets.js";
```

(Replace the existing `AIM_CONFIG`-only import line.) Then append:

```ts
/**
 * One car's lock, carried across ticks. Server-only room memory: only `targetSessionId` is ever
 * projected onto the schema (A14), the same way `pending` stays server-side and only the tick it
 * fires on crosses the wire.
 */
export interface LockState {
  /** Session id of the locked target, or `""` for no lock. */
  targetSessionId: string;
  /** Tick the CURRENT target was acquired. Gates the commit timer. */
  lockedAtTick: number;
  /** Tick sight of the current target was first lost, or 0 while visible. Gates the LOS grace. */
  losLostSinceTick: number;
  /** Tick of the most recent fire press on any slot. Gates the engagement timeout. */
  lastPressTick: number;
}

export function newLockState(): LockState {
  return { targetSessionId: "", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
}

export interface UpdateLockContext {
  owner: LockOwner;
  /** In the roster and not a wreck. A wreck holds no lock. */
  ownerFighting: boolean;
  /**
   * Did this car press any fire slot on an input the server actually simulated this tick?
   *
   * Read BEFORE `beginFire`, so a press a cooldown will reject still counts. The timer answers
   * "has this player disengaged?", which is a fact about the driver, not about a gun -- which is
   * also why a press on any slot refreshes it, not only the aim-assist slot's.
   */
  pressedThisTick: boolean;
  /** Living roster cars. Wrecks and lobby players are simply absent, which is how they release. */
  candidates: readonly LockTarget[];
  mode: "ffa" | "team";
  obstacles: readonly Aabb[];
  bounds: Bounds;
  tick: number;
}

interface ScoredTarget {
  sessionId: string;
  score: number;
  angleDeg: number;
  distance: number;
  visible: boolean;
}

/**
 * One car's lock for one tick: release, steal and acquisition resolved in a single pass.
 *
 * Pure -- the input state is never mutated.
 *
 * **Two hystereses, deliberately separate.** Getting these confused is the most likely way to
 * implement this wrongly:
 *
 * - *Spatial* -- the retention region (A6) and the LOS grace (A10) -- decides whether the CURRENT
 *   target is still held at all.
 * - *Competitive* -- the 25% steal margin and the commit timer (A7) -- decides whether a RIVAL may
 *   take its place.
 *
 * The engagement timeout (A8) switches off the competitive half only. It therefore never blanks
 * the bracket: a lapsed timer means the best-scoring target simply wins, which is what makes a slow
 * weapon re-pick fresh every shot while a fast one holds its lock.
 *
 * Resolving all of it in one pass is what stops a released-then-re-acquired lock producing an
 * unlocked frame the HUD would flicker on.
 *
 * At tick 0 with a fresh state, `lastPressTick` is 0 and the car reads as engaged for the first
 * `AIM_TICKS.lockTimeout` ticks of a match. The only effect is slightly stickier locks in the first
 * 0.8s, before anyone has fired at all.
 */
export function updateLock(state: LockState, ctx: UpdateLockContext): LockState {
  if (!ctx.ownerFighting) return newLockState();

  const lastPressTick = ctx.pressedThisTick ? ctx.tick : state.lastPressTick;
  const muzzle = muzzleOf(ctx.owner);

  const scored: ScoredTarget[] = [];
  for (const target of ctx.candidates) {
    // The same predicate shots and rams use, so the lock can never disagree with the shot about who
    // is an enemy -- no teammates in team mode, and never yourself.
    if (!canDamage(ctx.owner.sessionId, ctx.owner.team, target.sessionId, target.team, ctx.mode)) {
      continue;
    }
    const angleDeg = signedAngleDegTo(ctx.owner, target.x, target.y);
    const distance = Math.hypot(target.x - ctx.owner.x, target.y - ctx.owner.y);
    scored.push({
      sessionId: target.sessionId,
      score: lockScore(angleDeg, distance),
      angleDeg,
      distance,
      visible: hasLineOfSight(muzzle.x, muzzle.y, target.x, target.y, ctx.obstacles, ctx.bounds),
    });
  }

  // --- Spatial: is the current target still held? ---
  const current = scored.find((s) => s.sessionId === state.targetSessionId) ?? null;
  let losLostSinceTick = 0;
  let held: ScoredTarget | null = null;

  if (current && inRetainRegion(current.angleDeg, current.distance)) {
    if (current.visible) {
      held = current;
    } else {
      const since = state.losLostSinceTick === 0 ? ctx.tick : state.losLostSinceTick;
      if (ctx.tick - since < AIM_TICKS.losGrace) {
        held = current;
        losLostSinceTick = since;
      }
    }
  }

  // --- The best target anyone could acquire fresh this tick. Sight is required NOW. ---
  let best: ScoredTarget | null = null;
  for (const candidate of scored) {
    if (!candidate.visible || !inAcquireRegion(candidate.angleDeg, candidate.distance)) continue;
    if (best === null || candidate.score < best.score) best = candidate;
  }

  const acquire = (target: ScoredTarget): LockState => ({
    targetSessionId: target.sessionId,
    lockedAtTick: ctx.tick,
    losLostSinceTick: 0,
    lastPressTick,
  });

  if (!held) {
    return best
      ? acquire(best)
      : { targetSessionId: "", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick };
  }

  const keep: LockState = {
    targetSessionId: held.sessionId,
    lockedAtTick: state.lockedAtTick,
    losLostSinceTick,
    lastPressTick,
  };

  if (!best || best.sessionId === held.sessionId) return keep;

  // --- Competitive: may this rival take the lock? ---
  const engaged = ctx.tick - lastPressTick < AIM_TICKS.lockTimeout;
  if (!engaged) return best.score < held.score ? acquire(best) : keep;

  const committed = ctx.tick - state.lockedAtTick >= AIM_TICKS.commit;
  const clearsMargin = best.score <= held.score * (1 - AIM_CONFIG.stealMarginFraction);
  return committed && clearsMargin ? acquire(best) : keep;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/lock.test.ts`
Expected: PASS, both the Task 3 geometry tests and every new state-machine test.

- [ ] **Step 5: Export from the shared barrel**

In `packages/shared/src/index.ts`, immediately after the `export { canDamage } from "./sim/weapons/targets.js";` line, add:

```ts
export {
  hasLineOfSight,
  inAcquireRegion,
  inRetainRegion,
  lockScore,
  muzzleOf,
  newLockState,
  signedAngleDegTo,
  updateLock,
} from "./sim/weapons/lock.js";
export type { LockOwner, LockState, LockTarget, UpdateLockContext } from "./sim/weapons/lock.js";
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck -w @motor-combat-moba/shared`
Expected: exit 0.

```bash
git add packages/shared/src/sim/weapons/lock.ts packages/shared/src/sim/weapons/lock.test.ts packages/shared/src/index.ts
git commit -m "feat(sim): add updateLock, the per-car ambient target lock"
```

---

## Task 5: Wire the lock into `runCombat` and aim the shots

**Files:**
- Modify: `packages/shared/src/sim/weapons/instances.ts`
- Modify: `packages/shared/src/sim/weapons/instances.test.ts`
- Modify: `packages/shared/src/sim/combat.ts`
- Modify: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `updateLock`, `newLockState`, `LockState`, `muzzleOf` (Task 4); `weaponDefOf(...).usesAimAssist` (Task 2).
- Produces:
  - `spawnInstances(order, owner, tick, seq, aimAngle?: number | null)` — the fifth parameter defaults to `null`, meaning "use the owner's heading", so every existing call site is unchanged.
  - `CombatPlayer.lock: LockState` — required, so the bridge must supply it.

**The phase must run before `beginFire`.** `spawnInstances` reads the lock to aim, and with `startUpMs: 0` a press schedules and fires on the same tick.

- [ ] **Step 1: Write the failing test for the aim angle**

In `packages/shared/src/sim/weapons/instances.test.ts`, append:

```ts
describe("spawnInstances aim angle", () => {
  const owner = { sessionId: "p1", team: 0 as const, x: 100, y: 100, angle: 0 };
  const order = { weaponId: "cannon" as const, slot: 0 };

  it("uses the owner's heading when no aim angle is given", () => {
    const { instances } = spawnInstances(order, owner, 0, 0);
    expect(instances[0]!.angle).toBeCloseTo(0, 6);
  });

  it("fires along the aim angle when one is given", () => {
    const { instances } = spawnInstances(order, owner, 0, 0, Math.PI / 4);
    expect(instances[0]!.angle).toBeCloseTo(Math.PI / 4, 6);
  });

  it("keeps the muzzle on the car's nose whatever the aim angle", () => {
    // A11b. The muzzle is a physical point on the hull. If the lock moved it, a wide-angle lock
    // would spawn shots off the side of the car in open space.
    const straight = spawnInstances(order, owner, 0, 0).instances[0]!;
    const swung = spawnInstances(order, owner, 0, 0, Math.PI / 3).instances[0]!;
    expect(swung.x).toBeCloseTo(straight.x, 6);
    expect(swung.y).toBeCloseTo(straight.y, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/instances.test.ts`
Expected: FAIL — "fires along the aim angle" reports `expected 0 to be close to 0.785…` (the extra argument is ignored).

- [ ] **Step 3: Add the aim angle to `spawnInstances`**

In `packages/shared/src/sim/weapons/instances.ts`, replace the `spawnInstances` signature and the head of its body. The new signature:

```ts
export function spawnInstances(
  order: ShotOrder,
  owner: { sessionId: string; team: 0 | 1 } & OwnerPose,
  tick: number,
  seq: number,
  aimAngle: number | null = null,
): { instances: WeaponInstance[]; seq: number } {
```

Extend its doc comment with:

```
 * `aimAngle` is the car's lock direction, or `null` for "welded to the heading" -- which is what
 * every non-aim-assist weapon passes and what the whole table did before aim assist existed
 * (A11c). It replaces the heading as the axis the pellet fan is symmetric about, and it is re-read
 * by the caller at EACH shot's own tick, so a burst tracks a moving target the same way it already
 * tracks a turning driver.
 *
 * It never moves the muzzle (A11b): the shot always leaves the car's physical nose, derived from
 * `owner.angle`, and only its travel direction changes.
```

Inside the body, replace the `const nose = muzzleOffset();` line and the loop's angle/position lines:

```ts
  const nose = muzzleOffset();
  // A11b: the muzzle is derived from the HEADING, never from the aim angle.
  const muzzleX = owner.x + Math.cos(owner.angle) * nose;
  const muzzleY = owner.y + Math.sin(owner.angle) * nose;
  const axis = aimAngle ?? owner.angle;
```

and in the `for` loop body change the angle line to:

```ts
    const angle = axis + fanOffset(i, pellets, spread);
```

and the two position fields in the pushed object to:

```ts
      x: muzzleX,
      y: muzzleY,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/weapons/instances.test.ts`
Expected: PASS — the three new tests plus every pre-existing one.

- [ ] **Step 5: Write the failing integration tests**

In `packages/shared/src/sim/combat.test.ts`. This file already has factories — `world(over)`,
`player(sessionId, over)`, `run(over)` and `find(result, sessionId)` — so use them rather than
building `CombatPlayer` literals by hand.

**First, two one-line edits the compiler will demand.** `lock` is a required field on
`CombatPlayer`, so every factory that builds one must supply it. There are **two** in this file: the
shared `player()` near the top, and a second, local `player()` that `describe("firing")` shadows it
with. Add `lock: newLockState(),` immediately before the `...over` spread in **both**, or the file
will not compile and the failure will look like it belongs to the new tests.

Add `newLockState` to the imports from `./weapons/lock.js`, then append:

```ts
describe("aim assist through a real tick", () => {
  it("acquires a lock without anyone firing", () => {
    // A4: the lock is ambient. The trigger fires; it never targets.
    const result = run({
      players: [
        player("a", { x: 300, y: 300, angle: 0 }),
        player("b", { x: 500, y: 300, angle: Math.PI }),
      ],
    });
    expect(find(result, "a").lock.targetSessionId).toBe("b");
  });

  it("fires along the car's heading while the weapon opts out", () => {
    // The zero-balance-change guard. Until Task 8 flips `cannon`, a lock is acquired and changes
    // nothing about where the shot goes. "b" sits 18 degrees off the nose, well inside the cone, so
    // this fails loudly if the aim angle ever reaches a weapon that has not opted in.
    const result = run({
      players: [
        player("a", { x: 300, y: 300, angle: 0, fireMask: 1 }),
        player("b", { x: 480, y: 360, angle: Math.PI }),
      ],
    });
    const shot = result.instances.find((i) => i.ownerSessionId === "a");
    expect(shot).toBeDefined();
    expect(shot!.angle).toBeCloseTo(0, 6);
  });

  it("holds no lock for a wrecked owner", () => {
    const result = run({
      players: [
        player("a", { x: 300, y: 300, angle: 0, alive: false, hp: 0 }),
        player("b", { x: 500, y: 300, angle: Math.PI }),
      ],
    });
    expect(find(result, "a").lock.targetSessionId).toBe("");
  });

  it("never locks a wreck", () => {
    const result = run({
      players: [
        player("a", { x: 300, y: 300, angle: 0 }),
        player("b", { x: 500, y: 300, angle: Math.PI, alive: false, hp: 0 }),
      ],
    });
    expect(find(result, "a").lock.targetSessionId).toBe("");
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm run test -w @motor-combat-moba/shared -- src/sim/combat.test.ts`
Expected: FAIL — TypeScript rejects `lock` as an unknown property on `CombatPlayer`, and `result.players[…].lock` is undefined.

- [ ] **Step 7: Add the lock phase to `runCombat`**

In `packages/shared/src/sim/combat.ts`:

Extend the imports:

```ts
import { muzzleOf, newLockState, updateLock, type LockState, type LockTarget } from "./weapons/lock.js";
```

Add the field to `CombatPlayer`, directly after `fireState`:

```ts
  /**
   * This car's ambient target lock (A1). Server-only state carried in and back out, exactly as
   * `fireState` is; only `targetSessionId` is ever projected onto the schema.
   */
  lock: LockState;
```

Insert the new phase in `runCombat` between phase 2 (stepping instances) and phase 3 (presses):

```ts
  // 2b. Locks, BEFORE any shot is aimed by one. `spawnInstances` reads the lock in phase 3, and
  // with `startUpMs: 0` a press both schedules and fires on the same tick, so a lock updated after
  // phase 3 would aim every shot one tick stale. Runs after driving, like the rest of combat, so
  // scoring and the sight raycast read the poses cars actually ended the tick at.
  //
  // A car wrecked by THIS tick's hit resolution is still locked until the next tick's update: the
  // same one-tick seam the pose snapshot already accepts, worth at most one shot at 30 Hz.
  const lockTargets: LockTarget[] = players
    .filter(isFighting)
    .map((p) => ({ sessionId: p.sessionId, team: p.team, x: p.x, y: p.y }));

  for (const player of players) {
    player.lock = updateLock(player.lock ?? newLockState(), {
      owner: {
        sessionId: player.sessionId,
        team: player.team,
        x: player.x,
        y: player.y,
        angle: player.angle,
      },
      ownerFighting: isFighting(player),
      // Read before `beginFire`, so a press a cooldown will reject still counts as engagement.
      pressedThisTick: player.fireMask > 0,
      candidates: lockTargets,
      mode: world.mode,
      obstacles: world.obstacles,
      bounds: world.bounds,
      tick: world.tick,
    });
  }
```

In phase 3, replace the `spawnInstances` call with:

```ts
    for (const order of released.orders) {
      const spawned = spawnInstances(
        order,
        player,
        world.tick,
        instanceSeq,
        aimAngleFor(player, order.weaponId, byId),
      );
      instanceSeq = spawned.seq;
      stepped.push(...spawned.instances);
    }
```

And add this helper beside `isFighting`:

```ts
/**
 * The direction one shot should travel, or `null` for "along the car's heading".
 *
 * Re-derived per ORDER rather than once per press (A11c), so each volley of a burst aims at where
 * the target is on its own tick. That is the direct translation of the rule that a burst's shots
 * each exit from the car's pose at their own tick -- the thing that makes a burst steerable.
 *
 * Measured from the MUZZLE, not the car centre (A11a). Scoring uses the centre, because "angle off
 * my nose" is a fact about the car's facing, but the shot leaves the nose: at a target 100 units
 * out and 40 degrees off, a centre-derived angle misses by roughly a car length.
 */
function aimAngleFor(
  player: CombatPlayer,
  weaponId: WeaponId,
  byId: ReadonlyMap<string, CombatPlayer>,
): number | null {
  if (!weaponDefOf(weaponId).usesAimAssist) return null;
  if (player.lock.targetSessionId === "") return null;
  const target = byId.get(player.lock.targetSessionId);
  if (!target || !isFighting(target)) return null;
  const muzzle = muzzleOf({
    sessionId: player.sessionId,
    team: player.team,
    x: player.x,
    y: player.y,
    angle: player.angle,
  });
  return Math.atan2(target.y - muzzle.y, target.x - muzzle.x);
}
```

Add `WeaponId` to the type imports from `../config/weapon-types.js`.

- [ ] **Step 8: Run the full shared suite**

Run: `npm run test -w @motor-combat-moba/shared`
Expected: PASS. If any pre-existing `combat.test.ts` fixture builds a `CombatPlayer` literal, TypeScript will now demand `lock` — add `lock: newLockState()` to each.

- [ ] **Step 9: Typecheck and commit**

Run: `npm run typecheck -w @motor-combat-moba/shared`
Expected: exit 0.

**Do not run the repo-wide `npm run typecheck` yet — it will fail, and that is expected.** Making
`lock` required on `CombatPlayer` breaks two construction sites in
`packages/server/src/sim/combat-bridge.test.ts` that Task 6 Step 1 fixes. The shared workspace is
green on its own, which is what this step is checking.

```bash
git add packages/shared/src/sim/weapons/instances.ts packages/shared/src/sim/weapons/instances.test.ts packages/shared/src/sim/combat.ts packages/shared/src/sim/combat.test.ts
git commit -m "feat(sim): run the lock phase in runCombat and aim shots from it"
```

---

## Task 6: Server bridge and the one schema field

**Files:**
- Modify: `packages/shared/src/schema/PlayerState.ts`
- Modify: `packages/server/src/sim/combat-bridge.ts`
- Modify: `packages/server/src/sim/combat-bridge.test.ts`

**Interfaces:**
- Consumes: `LockState`, `newLockState` (Task 4); `CombatPlayer.lock` (Task 5).
- Produces: `PlayerState.lockTargetSessionId: string`; `CombatMemory.locks: Map<string, LockState>`.

- [ ] **Step 1: Write the failing tests**

In `packages/server/src/sim/combat-bridge.test.ts`. This file builds an `ArenaState` inline and has
two factories — `playerIn(state, sessionId, over)`, which creates a `PlayerState` and inserts it,
and `result(over)`, which fills in a `CombatResult`. Use both.

Add `newLockState` to the `@motor-combat-moba/shared` import.

**First, the compile fixes this file needs.** `lock` became a required field on `CombatPlayer` in
Task 5, so this file will not typecheck until two more construction sites supply it. Both are in
this test file, and neither is in `combat.test.ts`:

1. `combatPlayerFor(player, over)` inside `describe("applyCombatResult")` (around line 197) — add
   `lock: newLockState(),` immediately before the `...over` spread.
2. A hand-written inline `CombatPlayer` literal (around line 250–269, in the `applyCombatResult`
   call that asserts instance diffing) — add `lock: newLockState(),` after its `fireState` line.

Together with the two factories in `combat.test.ts`, that is **four** places across the repo that
build a `CombatPlayer` literal. Missing any one is a typecheck failure whose message points at the
test file rather than at the field that changed.

Then extend the existing emptiness check in `describe("newCombatMemory")` with one line:

```ts
    expect(memory.locks.size).toBe(0);
```

Then append:

```ts
describe("lock state across the bridge", () => {
  const aLock = {
    targetSessionId: "b",
    lockedAtTick: 7,
    losLostSinceTick: 3,
    lastPressTick: 9,
  };

  it("hands a player with no lock yet a fresh one", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    const memory = newCombatMemory();

    const players = toCombatPlayers(state, new Set(["a"]), new Map(), memory);

    expect(players[0]!.lock).toEqual(newLockState());
  });

  it("carries a lock forward between ticks instead of rebuilding it", () => {
    // Locks live in room memory, never on the schema. `lockedAtTick` and `losLostSinceTick` have no
    // wire representation, so rebuilding from `ArenaState` each tick would reset both timers and
    // neither the commit window nor the sight grace could ever elapse -- the lock would be
    // permanently stealable and permanently one tick from releasing on sight.
    const state = new ArenaState();
    playerIn(state, "a");
    const memory = newCombatMemory();
    memory.locks.set("a", { ...aLock });

    const players = toCombatPlayers(state, new Set(["a"]), new Map(), memory);

    expect(players[0]!.lock).toEqual(aLock);
  });

  it("writes only the target id onto the schema, keeping the machine in memory", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    const memory = newCombatMemory();
    const players = toCombatPlayers(state, new Set(["a"]), new Map(), memory);
    players[0]!.lock = { ...aLock };

    applyCombatResult(state, result({ players }), memory);

    expect(state.players.get("a")!.lockTargetSessionId).toBe("b");
    expect(memory.locks.get("a")).toEqual(aLock);
  });

  it("clears every lock when a match ends", () => {
    // The same rule that already stops a shot in flight carrying into the next match: nothing from
    // a previous match may survive into the next one.
    const state = new ArenaState();
    playerIn(state, "a");
    const memory = newCombatMemory();
    memory.locks.set("a", { ...aLock });

    clearInstances(state, memory);

    expect(memory.locks.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @motor-combat-moba/server -- src/sim/combat-bridge.test.ts`
Expected: FAIL — `memory.locks` is undefined.

- [ ] **Step 3: Add the schema field**

In `packages/shared/src/schema/PlayerState.ts`, append inside the class, after `lastFiredSlot`:

```ts
  /**
   * Session id of this car's current aim-assist target, or `""` for none (A14).
   *
   * The only part of the lock that crosses the wire. The machine behind it -- the commit timer, the
   * sight grace, the last press -- stays server-side, exactly as `pending` does: the client is told
   * the result, never the rules. All the HUD needs is which car to draw a bracket on.
   */
  @type("string") lockTargetSessionId = "";
```

- [ ] **Step 4: Rebuild shared**

Run: `npm run build -w @motor-combat-moba/shared`
Expected: exit 0. The server imports shared's built `dist`, so the new field is invisible to it until this runs.

- [ ] **Step 5: Carry locks through the bridge**

In `packages/server/src/sim/combat-bridge.ts`:

Add `newLockState` and `type LockState` to the `@motor-combat-moba/shared` import.

In `CombatMemory`, after `fireStates`:

```ts
  /** Per-player target lock. Server-only; only `targetSessionId` is projected onto the schema. */
  locks: Map<string, LockState>;
```

In `newCombatMemory`, add `locks: new Map()` to the returned object.

In `toCombatPlayers`, before the `players.push({...})` call:

```ts
    // Carried forward rather than rebuilt from the schema: `lockedAtTick` and `losLostSinceTick`
    // have no wire representation, so a rebuild would reset both timers every tick and neither the
    // commit window nor the sight grace could ever elapse.
    const lock = memory.locks.get(sessionId) ?? newLockState();
    memory.locks.set(sessionId, lock);
```

and add `lock,` to the pushed object beside `fireState`.

In `applyCombatResult`, inside the `for (const p of result.players)` loop, beside the existing `memory.fireStates.set(...)`:

```ts
    memory.locks.set(p.sessionId, p.lock);
```

and after `player.lastFiredSlot = p.fireState.lastFiredSlot;`:

```ts
    player.lockTargetSessionId = p.lock.targetSessionId;
```

In `clearInstances`, beside `memory.fireStates.clear();`:

```ts
  memory.locks.clear();
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -w @motor-combat-moba/server`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: exit 0 for all three workspaces.

```bash
git add packages/shared/src/schema/PlayerState.ts packages/server/src/sim/combat-bridge.ts packages/server/src/sim/combat-bridge.test.ts
git commit -m "feat(server): carry target locks in room memory and network the target id"
```

---

## Task 7: The lock bracket on screen

**Files:**
- Modify: `packages/client/src/scenes/combat-visual.ts`
- Modify: `packages/client/src/scenes/combat-visual.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `PlayerState.lockTargetSessionId` (Task 6).
- Produces: `lockBracketArms(x: number, y: number): { x1: number; y1: number; x2: number; y2: number }[]` — eight segments, two per corner, in world space.

Bracket geometry is pure and unit-tested; `ArenaScene` only strokes what it returns. The bracket is drawn for **the camera's subject** — the local car while driving, the watched car while spectating — which is the same rule the weapon HUD already follows.

- [ ] **Step 1: Write the failing test**

In `packages/client/src/scenes/combat-visual.test.ts`, append:

```ts
describe("lockBracketArms", () => {
  it("returns two arms per corner", () => {
    expect(lockBracketArms(0, 0)).toHaveLength(8);
  });

  it("is centred on the point it is given", () => {
    const arms = lockBracketArms(500, 300);
    const xs = arms.flatMap((a) => [a.x1, a.x2]);
    const ys = arms.flatMap((a) => [a.y1, a.y2]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(500, 6);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(300, 6);
  });

  it("is a corner bracket, not a closed box", () => {
    // Every arm is shorter than the bracket's own side, so the four corners never join up. A closed
    // box reads as a selection rectangle and hides the car inside it.
    const arms = lockBracketArms(0, 0);
    const side = LOCK_BRACKET_HALF * 2;
    for (const a of arms) {
      expect(Math.hypot(a.x2 - a.x1, a.y2 - a.y1)).toBeLessThan(side / 2);
    }
  });

  it("clears a car hull, so the bracket frames the car rather than crossing it", () => {
    // The hull is 48 x 32, so its half-diagonal is 29. A bracket inside that would be drawn over
    // the sprite instead of around it.
    expect(LOCK_BRACKET_HALF).toBeGreaterThan(Math.hypot(48, 32) / 2);
  });
});
```

Add `lockBracketArms` and `LOCK_BRACKET_HALF` to the file's `./combat-visual.js` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- src/scenes/combat-visual.test.ts`
Expected: FAIL — `lockBracketArms is not a function`.

- [ ] **Step 3: Write the bracket geometry**

Append to `packages/client/src/scenes/combat-visual.ts`:

```ts
/**
 * Half the bracket's side, world units. Larger than a car hull's half-diagonal (29 units for the
 * 48 x 32 hull) so the bracket frames the car instead of being drawn across it.
 */
export const LOCK_BRACKET_HALF = 34;

/** How far each arm runs from its corner. Kept well under the side, so the corners never join. */
export const LOCK_BRACKET_ARM = 11;

/**
 * The eight line segments of a corner bracket centred on a car, in world space.
 *
 * Corners rather than a closed box: a full rectangle reads as a selection marquee and competes with
 * the car it is meant to point at. Unrotated, like the hp bar above it -- the bracket says "this is
 * your lock", not "this is how the car is facing".
 *
 * Pure geometry so it can be tested without a Phaser scene; `ArenaScene` only strokes the result.
 */
export function lockBracketArms(
  x: number,
  y: number,
): { x1: number; y1: number; x2: number; y2: number }[] {
  const h = LOCK_BRACKET_HALF;
  const a = LOCK_BRACKET_ARM;
  const left = x - h;
  const right = x + h;
  const top = y - h;
  const bottom = y + h;

  return [
    { x1: left, y1: top, x2: left + a, y2: top },
    { x1: left, y1: top, x2: left, y2: top + a },
    { x1: right, y1: top, x2: right - a, y2: top },
    { x1: right, y1: top, x2: right, y2: top + a },
    { x1: left, y1: bottom, x2: left + a, y2: bottom },
    { x1: left, y1: bottom, x2: left, y2: bottom - a },
    { x1: right, y1: bottom, x2: right - a, y2: bottom },
    { x1: right, y1: bottom, x2: right, y2: bottom - a },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- src/scenes/combat-visual.test.ts`
Expected: PASS.

- [ ] **Step 5: Draw it in `ArenaScene`**

In `packages/client/src/scenes/ArenaScene.ts`:

Add to the `combat-visual.js` import: `lockBracketArms`.

Beside the other depth constants (near `const HP_BAR_DEPTH = 60;`):

```ts
/** Under the hp bar, over the shots: the bracket frames a car, it never occludes its own hp. */
const LOCK_DEPTH = 55;
const LOCK_COLOR = 0xf2e14c;
const LOCK_WIDTH = 2;
```

Beside the other Graphics fields (near `private hpGfx`):

```ts
  private lockGfx: Phaser.GameObjects.Graphics | undefined;
```

Beside `this.hpGfx = this.add.graphics().setDepth(HP_BAR_DEPTH);`:

```ts
    this.lockGfx = this.add.graphics().setDepth(LOCK_DEPTH);
```

In `renderCars`, replace the opening lines and add the bracket pass. The rendered pose of the locked car is only known inside the loop, so collect poses and draw afterwards:

```ts
  private renderCars(room: Room<ArenaState>, delta: number): void {
    const seen = new Set<string>();
    const hp = this.hpGfx;
    const lock = this.lockGfx;
    hp?.clear();
    lock?.clear();
    const poses = new Map<string, SimBody>();
```

Inside the `forEach`, immediately after `this.syncCar(sessionId, player, pose);`:

```ts
      poses.set(sessionId, pose);
```

After the `forEach` closes and before the stale-car cleanup loop:

```ts
    // The bracket follows the CAMERA's subject -- the local car while driving, the watched car while
    // spectating -- which is the same rule the weapon slot bar already uses. Read straight off the
    // wire and never computed here: combat is server-only, and a mispredicted bracket is a lie about
    // where your shot is going.
    const subject = room.state.players.get(this.cameraTarget(room));
    const target = subject?.lockTargetSessionId ?? "";
    const at = target === "" ? undefined : poses.get(target);
    if (lock && at) {
      lock.lineStyle(LOCK_WIDTH, LOCK_COLOR, 0.9);
      for (const arm of lockBracketArms(at.x, at.y)) {
        lock.beginPath();
        lock.moveTo(arm.x1, arm.y1);
        lock.lineTo(arm.x2, arm.y2);
        lock.strokePath();
      }
    }
```

- [ ] **Step 6: Verify the client builds and its suite passes**

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: exit 0.

Run: `npm run test -w @motor-combat-moba/client`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/scenes/combat-visual.ts packages/client/src/scenes/combat-visual.test.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(client): draw a lock bracket on the camera subject's target"
```

---

## Task 8: Turn it on, and write it down

**Files:**
- Modify: `packages/shared/src/config/weapon-config.ts`
- Modify: `packages/shared/src/config/weapon-config.test.ts`
- Modify: `docs/combat-model.md`
- Modify: `docs/config-reference.md`
- Modify: `docs/schema-reference.md`
- Modify: `CLAUDE.md`

This is the only commit that changes how the game plays, and it is a one-line revert.

- [ ] **Step 1: Flip the cannon**

In `packages/shared/src/config/weapon-config.ts`, change `cannon`'s `usesAimAssist: false` to `true`, and add above it:

```ts
    // The system would otherwise ship dark: `cannon` is the only weapon any chassis carries, so
    // leaving it off would put aim assist on the same never-seen-in-play list as beams, multi-pellet
    // volleys and `repeater`. Note the consequence -- every chassis carries `cannon`, so aim assist
    // is universal until a second weapon is authored.
    usesAimAssist: true,
```

- [ ] **Step 2: Update the row test**

In `packages/shared/src/config/weapon-config.test.ts`, replace the "ships every row with aim assist off" test with:

```ts
  it("gives the cannon aim assist and leaves the repeater without it", () => {
    // The pair that makes `usesAimAssist` a real switch rather than a global: one row on, one off.
    expect(WEAPON_TABLE.cannon.usesAimAssist).toBe(true);
    expect(WEAPON_TABLE.repeater.usesAimAssist).toBe(false);
  });
```

- [ ] **Step 3: Run the guard tests, which are now live**

Run: `npm run test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts`
Expected: PASS. Both guards now evaluate `cannon` for real:
- A9.3: `range` 900 ≥ `lockRange` 400. ✓
- A9.4: sustained 2.0 Hz against a cliff of 1.25 Hz is 60% away, well past the 15% band. ✓

If A9.4 fails, do **not** widen the band — it means `lockTimeoutMs` and `cannon.cooldownMs` have drifted into conflict, and the spec's Rollout section lists the three ways out.

- [ ] **Step 4: Run the whole suite and build**

Run: `npm test`
Expected: PASS across shared, server, client, and scripts.

Run: `npm run build`
Expected: exit 0.

Run: `grep -c '\.\./shared/dist' packages/server/dist/index.js`
Expected: a non-zero count. A count of 0 with `../../../../../packages/shared/dist` present instead means the worktree is resolving to the main checkout — run `npm install` in the worktree root and rebuild.

- [ ] **Step 5: Document it**

In `docs/combat-model.md`, add a section after "Firing input" and before "One fire state machine per car":

```markdown
### Aim assist and the target lock

A weapon whose `usesAimAssist` is true fires at the car's **lock** instead of along its heading.
The lock decides a direction only: the instance is an ordinary projectile frozen to its exit pose,
with no homing and no correction in flight.

The lock is **ambient** — maintained every tick whenever a valid target exists, whether or not the
player is firing. The trigger fires; it never targets. With no lock, a weapon fires straight ahead,
and firing is never blocked.

**The region** is a cone intersected with a lateral cap, out to `AIM_CONFIG.lockRange` — all three
bounds, because neither of the first two survives alone. A pure cone's width scales with distance,
so at the cannon's range it would span half the arena; a pure lane's angular width explodes near the
car, so it would accept a target 83° off your nose during a ram. The cone governs contact range, the
cap governs long range, and they cross over around 330 units.

**Scoring** is `abs(angleDeg) + distance × scorePerDistanceUnit`, lowest wins. The coefficient is per
**world unit** — there are no metres in this game, and a value sized for metres makes the distance
term swamp the angle and turns the whole system into "always nearest target".

**Hysteresis comes in two independent halves**, and conflating them is the easy mistake:

- *Spatial* — the retention pads and the sight grace — decides whether the current target is still
  held. All three bounds are padded, not just the angle: at long range the lateral cap is what binds,
  so a degrees-only pad would give a distant target no hysteresis at all.
- *Competitive* — the 25% steal margin and the commit timer — decides whether a rival may replace it.

`AIM_CONFIG.lockTimeoutMs` switches off the **competitive** half after a spell with no fire press
(any slot: the timer asks whether the driver has disengaged, not whether a particular gun is in use).
It never blanks the bracket — release and re-acquisition resolve in one pass — it just means the
best-scoring target wins outright. That is what splits weapons into two classes: faster than
`1000 / lockTimeoutMs` holds locks and the margin governs, slower re-picks the best target every
shot. `weapon-config.test.ts` fails any aim-assist weapon authored within 15% of that cliff.

**Line of sight** is a muzzle-to-target raycast reusing `wallClipDistance`. It is a no-op in
`arena-01`, which has no obstacles, and exists because switching arenas is a one-line edit.
**Wrecks are not cover** — shots already pass straight through them, so blocking a lock on one would
drop it for an obstruction that provably does not stop the bullet.

**Shot geometry:** the fired angle is measured from the **muzzle**, not the car centre (scoring uses
the centre); the muzzle itself never moves; and a pellet fan or a sequential burst re-reads the lock
at each shot's own tick, the same way it already re-reads the car's pose.

`repeater` is the table's reference row for `usesAimAssist: false`, as `cannon` is for `true`.
See [`../docs/superpowers/specs/2026-08-27-aim-assist-target-lock-design.md`] for the decisions
(A1–A14) and the rejected alternatives.
```

In `docs/config-reference.md`, add an `AIM_CONFIG` section listing each field, its value, and its unit, following the file's existing table format for `COMBAT_CONFIG`.

In `docs/schema-reference.md`, add `lockTargetSessionId` (`string`) to the `PlayerState` table: *"Session id of this car's aim-assist target, or `""`. The only part of the lock that is networked."*

In `CLAUDE.md`, extend the weapon-system row of the "Read the right doc" table so the new spec is discoverable:

```markdown
| Weapon system decisions (D1–D22), aim assist and target lock (A1–A14), online-play review, future work | [`docs/superpowers/specs/2026-08-27-weapon-system-design.md`](docs/superpowers/specs/2026-08-27-weapon-system-design.md), [`docs/superpowers/specs/2026-08-27-aim-assist-target-lock-design.md`](docs/superpowers/specs/2026-08-27-aim-assist-target-lock-design.md), [`docs/superpowers/plans/2026-08-27-weapon-system.md`](docs/superpowers/plans/2026-08-27-weapon-system.md) |
```

- [ ] **Step 6: See it work**

Run: `npm run dev`

Open `http://localhost:5173` in two browser tabs, join with both, start a match, and drive one car so the other is roughly ahead of it. Confirm:
- A yellow corner bracket appears on the other car once it is inside the cone, **without firing**.
- The bracket persists as the target drifts slightly past the cone edge, and drops once it is well outside.
- Firing while locked sends the shot at the bracketed car rather than along your nose.
- The bracket disappears when the target is wrecked.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/config/weapon-config.ts packages/shared/src/config/weapon-config.test.ts docs/combat-model.md docs/config-reference.md docs/schema-reference.md CLAUDE.md
git commit -m "feat(balance): give the cannon aim assist"
```

---

## Self-Review

**Spec coverage.** Every decision maps to a task:

| Spec | Task |
|---|---|
| A1 (per-weapon boolean, global geometry, one lock per car) | 1, 2 |
| A2 (cone ∩ lateral cap ∩ range) | 3 |
| A3 (`lockRange` its own number) | 1, 3 |
| A4 (ambient lock) | 4, 5 |
| A5 (scoring, per-world-unit coefficient) | 1, 3 |
| A6 (three retention pads) | 1, 3, 4 |
| A7 (steal margin + commit timer) | 4 |
| A8 (five release conditions, timeout strips incumbency) | 4 |
| A9 (four config assertions) | 1 (1–2), 2 (3–4) |
| A10 (LOS, grace, wrecks not cover) | 3, 4 |
| A11 (muzzle-derived angle, fixed muzzle, re-read per shot) | 5 |
| A12 (attached-beam guard) | 2 |
| A13 (one pure function, one pass, one bracket) | 4, 7 |
| A14 (server-only state, one schema field) | 6 |
| Rollout steps 1–6 | Tasks 1–2, 3–4, 5, 6, 7, 8 |
| Testing section | Tasks 1, 3, 4, 5, 6, 7 |

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Every code step carries the actual code. The one prose-only instruction is Task 8 Step 5's `config-reference.md` and `schema-reference.md` edits, which are told to follow those files' existing table formats — the content to add is specified exactly.

**Type consistency.** Checked across tasks: `LockState`'s four field names are identical in Tasks 4, 5, 6 and in every test fixture. `updateLock`'s context field is `pressedThisTick` everywhere (not `firedThisTick`). `spawnInstances`' fifth parameter is `aimAngle: number | null = null` in Task 5 and is passed positionally as `aimAngleFor(...)`, which returns `number | null`. `muzzleOf` takes a `LockOwner` in both Task 3 and Task 5's `aimAngleFor`. `lockBracketArms` returns `{x1,y1,x2,y2}[]` in Task 7 and is consumed as such. `AIM_TICKS` fields are `commit` / `lockTimeout` / `losGrace` in Tasks 1 and 4.

**Five errors found and fixed during review**, all from writing fixtures against assumed shapes instead of the real ones:

1. **`Bounds` is `{width, height}`**, an extent from a top-left origin — not the `{minX, minY, maxX, maxY}` box the fixtures first used.
2. **`Aabb` is `{x, y, w, h}`**, not `{x, y, width, height}`, with `x, y` at the **top-left** so arena obstacles pass into `resolveWorld` unconverted.
3. **The owner cannot sit at the origin.** `pointOutsideBounds` is inclusive on every edge, so a car at `(0, 0)` has its muzzle on the boundary and `wallClipDistance` returns a reach of 0 — every line-of-sight assertion in Task 4 would have failed for a reason unrelated to locks. Task 4's fixtures now place the owner at `(400, 400)` and position enemies in its frame.
4. **`combat.test.ts` already has `world` / `player` / `run` / `find` factories.** Task 5 was rolling its own. It now uses them, and — more importantly — names the **two** `player()` factories that must gain `lock: newLockState()`: the shared one and the one `describe("firing")` shadows it with. Miss the second and the file will not compile.
5. **`combat-bridge.test.ts` has `playerIn` and `result`, not a `stateWithPlayers`.** Task 6 referenced a helper that does not exist; it now builds `new ArenaState()` inline and uses the two real factories.
6. **There are FOUR places that build a `CombatPlayer` literal, not two.** Found by asking the code graph for `references_to CombatPlayer` — a `head`-truncated grep had hidden `combatPlayerFor` (`combat-bridge.test.ts:197`) and an inline literal at `combat-bridge.test.ts:250-269`. Both are now named in Task 6 Step 1, and Task 5 Step 9 warns that the repo-wide typecheck stays red between the two tasks. Without this the plan would have handed the implementer a compile error whose message points at a test file rather than at the field that changed.

**A note on method for whoever executes this.** The blast-radius checks above came from
`code-review-graph` (`query_graph_tool` / `get_impact_radius_tool`), not from grep — that is what
caught finding 6 after a truncated grep had missed it. `spawnInstances` is confirmed to have exactly
one non-test caller (`runCombat`, `combat.ts:149`) plus a `shotFrom` helper in `hits.test.ts`, all of
which keep compiling because the new fifth parameter defaults to `null`. The graph in this worktree
was built at `a47ebae`; the commits since are documentation only, so it is current for source.
