# Stage 1: Vector Drive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `SimBody.speed` (a scalar along the heading) with a true 2D velocity vector, delete
`shoveX`/`shoveY`/`authority`, and make coasting and braking per-car.

**Architecture:** Velocity becomes `vx, vy` in world space. `stepDrive` decomposes it into a forward
and a lateral component in the car's own frame, applies throttle/brake/drag to the forward component
and a flat bleed to the lateral one, then rebuilds a world velocity in the *new* heading — with
`steeringGrip` deciding how much of the rotation the velocity follows. Because grip keeps the car's
own motion aligned with its nose, any lateral component is by definition externally imposed, which is
why the separate shove vector can be deleted rather than ported.

**Tech Stack:** TypeScript, npm workspaces, Vitest, Colyseus schema, Phaser 4 client.

**Spec:** [`docs/superpowers/specs/2026-09-06-car-physics-rework-design.md`](../../specs/2026-09-06-car-physics-rework-design.md)
(P1–P8, plus P25a/P25b for what stage 3 inherits)

**Ledger:** [`interfaces.md`](interfaces.md) — read it before Task 1.

## Global Constraints

- `TICK_RATE_HZ` lives once in `@motor-combat-moba/shared`. Never redefine it.
- No magic numbers in logic. Every constant comes from `shared/config`.
- `stepSim` is the lockstep: server and client import the same function. Neither half may be
  reordered or skipped on one side only.
- **Invariant 8:** if `stepSim` reads it, it is a networked schema field.
- Enum uint8 values are explicit and stable. Never renumber.
- Shared is consumed as built `dist`. After editing shared, rebuild it
  (`npm run build -w @motor-combat-moba/shared`) or the server and client run the previous version.
- Build with root `npm run build`, **never** `npm run build --workspaces` — the latter has been
  observed building the server before shared.
- Durations are authored in **milliseconds or seconds and converted to ticks once**, never authored
  as per-tick values. Netcode phase 1 will take `TICK_RATE_HZ` from 30 to 60.
- `stepDrive` must never read `CAR_TABLE`. It receives a resolved `ChassisDrive`.
- The complete verification gate is root `npm test`. A per-workspace run silently skips the server
  suite.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/shared/src/sim/velocity.ts` | Frame conversion: world velocity ⇄ forward/lateral. The **only** place `cos(angle) * speed` is written. | Create |
| `packages/shared/src/sim/velocity.test.ts` | Tests for the above. | Create |
| `packages/shared/src/config/types.ts` | `CarDef` gains `coastHalfLifeSeconds`, `brakeDecel`. | Modify |
| `packages/shared/src/config/car-config.ts` | `CAR_TABLE` rows gain the two fields; `ChassisDrive` gains `coastPerTick`, `brakeDecel`; resolvers updated. | Modify |
| `packages/shared/src/config/drive-config.ts` | Gains `steeringGrip`, `impactGripDecel`; loses `drag`, `brakeDecel`. | Modify |
| `packages/shared/src/sim/step.ts` | `SimBody` shape. | Modify |
| `packages/shared/src/sim/drive.ts` | The integration rewrite. | Modify |
| `packages/shared/src/sim/collide.ts` | `applyContact` and the body copies move to `vx/vy`. | Modify |
| `packages/shared/src/sim/drive-vector.test.ts` | Specifies the new drive behaviour. | Create |
| `packages/shared/src/schema/PlayerState.ts` | `speed`/`shove*`/`authority` → `vx`/`vy`. | Modify |
| `packages/server/src/sim/tick.ts`, `ram-bridge.ts` | Body ⇄ schema mapping. | Modify |
| `packages/client/src/net/prediction.ts`, `interpolation.ts` | Body ⇄ schema mapping. | Modify |
| `packages/server/src/bot/brain/aim.ts`, `perception.ts` | Read real velocity instead of reconstructing it. | Modify |
| `packages/shared/src/sim/golden.test.ts` | Refixtured against the new integration. | Modify |
| `docs/turn-tuning.md` | Rewritten with the new values and two new columns. | Modify |

---

## Task 1: Velocity frame helpers

**Files:**
- Create: `packages/shared/src/sim/velocity.ts`
- Test: `packages/shared/src/sim/velocity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `forwardOf(vx, vy, angle): number`, `lateralOf(vx, vy, angle): number`,
  `speedOf(vx, vy): number`, `toWorld(angle, forward, lateral): { vx: number; vy: number }`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/sim/velocity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { forwardOf, lateralOf, speedOf, toWorld } from "./velocity.js";

describe("velocity frame helpers", () => {
  it("reads pure forward motion as forward, with no lateral", () => {
    // Facing +x, moving +x at 100.
    expect(forwardOf(100, 0, 0)).toBeCloseTo(100);
    expect(lateralOf(100, 0, 0)).toBeCloseTo(0);
  });

  it("reads reversing as negative forward", () => {
    expect(forwardOf(-100, 0, 0)).toBeCloseTo(-100);
  });

  it("reads pure sideways motion as lateral, with no forward", () => {
    // Facing +x, moving +y. +y is to the car's LEFT in this coordinate system.
    expect(forwardOf(0, 100, 0)).toBeCloseTo(0);
    expect(lateralOf(0, 100, 0)).toBeCloseTo(100);
  });

  it("decomposes a 45-degree drift into equal parts", () => {
    const angle = 0;
    expect(forwardOf(70.71, 70.71, angle)).toBeCloseTo(70.71, 1);
    expect(lateralOf(70.71, 70.71, angle)).toBeCloseTo(70.71, 1);
  });

  it("respects the car's heading, not the world axes", () => {
    // Facing +y (90 degrees), moving +y at 100: that is pure forward.
    const angle = Math.PI / 2;
    expect(forwardOf(0, 100, angle)).toBeCloseTo(100);
    expect(lateralOf(0, 100, angle)).toBeCloseTo(0);
  });

  it("speedOf is direction-agnostic and never negative", () => {
    expect(speedOf(3, 4)).toBeCloseTo(5);
    expect(speedOf(-3, -4)).toBeCloseTo(5);
  });

  it("toWorld round-trips with forwardOf and lateralOf", () => {
    const angle = 1.234;
    const { vx, vy } = toWorld(angle, 210, -45);
    expect(forwardOf(vx, vy, angle)).toBeCloseTo(210);
    expect(lateralOf(vx, vy, angle)).toBeCloseTo(-45);
  });

  it("toWorld with zero lateral points exactly along the heading", () => {
    const angle = 0.7;
    const { vx, vy } = toWorld(angle, 100, 0);
    expect(vx).toBeCloseTo(Math.cos(angle) * 100);
    expect(vy).toBeCloseTo(Math.sin(angle) * 100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/sim/velocity.test.ts`
Expected: FAIL — `Failed to resolve import "./velocity.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/sim/velocity.ts`:

```ts
/**
 * World velocity to and from the car's own frame.
 *
 * This is the ONLY place the conversion is written. Before this rework, `cos(angle) * speed` was
 * open-coded in the drive integration, the collision resolver, the ram maths, and twice inside the
 * bot's brain — five copies of the same assumption, one of which (the bot's) was silently wrong for
 * any car carrying sideways motion. Route every frame conversion through these four functions.
 *
 * Sign conventions, which nothing downstream may re-derive:
 *   forward > 0  driving nose-first;  forward < 0  reversing
 *   lateral > 0  sliding to the car's LEFT
 */

/** Signed speed along the car's nose. Negative means reversing. */
export function forwardOf(vx: number, vy: number, angle: number): number {
  return vx * Math.cos(angle) + vy * Math.sin(angle);
}

/** Signed speed across the car's nose. Positive is to the car's left. */
export function lateralOf(vx: number, vy: number, angle: number): number {
  return -vx * Math.sin(angle) + vy * Math.cos(angle);
}

/** Total speed regardless of direction. Always >= 0. */
export function speedOf(vx: number, vy: number): number {
  return Math.hypot(vx, vy);
}

/** Rebuild a world velocity from its two components in the car's frame. */
export function toWorld(angle: number, forward: number, lateral: number): { vx: number; vy: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    vx: forward * cos - lateral * sin,
    vy: forward * sin + lateral * cos,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/shared/src/sim/velocity.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Export from the package index**

In `packages/shared/src/index.ts`, add to the sim exports (find the block exporting from
`./sim/collide.js` and friends and follow its style):

```ts
export { forwardOf, lateralOf, speedOf, toWorld } from "./sim/velocity.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/velocity.ts packages/shared/src/sim/velocity.test.ts packages/shared/src/index.ts
git commit -m "feat(sim): add velocity frame helpers"
```

---

## Task 2: Per-car coast and brake, and the two new drive knobs

**Files:**
- Modify: `packages/shared/src/config/types.ts` (`CarDef`)
- Modify: `packages/shared/src/config/car-config.ts` (`CAR_TABLE`, `ChassisDrive`, `resolveChassisDrive`)
- Modify: `packages/shared/src/config/drive-config.ts`
- Test: `packages/shared/src/config/config.test.ts`

**Interfaces:**
- Consumes: `halfLifeToPerTick` from `packages/shared/src/config/ram-config.ts` (already exported).
- Produces: `ChassisDrive.coastPerTick`, `ChassisDrive.brakeDecel`, `DRIVE_CONFIG.steeringGrip`,
  `DRIVE_CONFIG.impactGripDecel`, `coastHalfLifeSecondsOf(id)`, `brakeDecelOf(id)`.

> **Note on ordering.** `DRIVE_CONFIG.drag` and `DRIVE_CONFIG.brakeDecel` are **removed** in this
> task, and `drive.ts` still reads both. The shared package will not compile between Step 3 and
> Task 4. That is expected and unavoidable — see the spec's sequencing note: stage 1 cannot be
> partially landed. Do not try to keep it green here; keep it *small* instead.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/config/config.test.ts`, add:

```ts
import { activeCarIds, driveOf, forwardMaxSpeedOf } from "./car-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";

describe("per-car coast and brake", () => {
  it("resolves a coast multiplier for every active chassis", () => {
    for (const id of activeCarIds()) {
      const coast = driveOf(id).coastPerTick;
      expect(coast).toBeGreaterThan(0);
      expect(coast).toBeLessThan(1);
    }
  });

  it("keeps the brake ahead of coasting on every chassis, measured where drag is strongest", () => {
    // Proportional drag is fiercest at top speed. The instantaneous coast deceleration there is
    // (1 - coastPerTick) * maxSpeed * TICK_RATE_HZ. The brake pedal must beat lifting off, or the
    // control reads as broken rather than degraded.
    for (const id of activeCarIds()) {
      const drive = driveOf(id);
      const coastDecelAtTop = (1 - drive.coastPerTick) * forwardMaxSpeedOf(id) * TICK_RATE_HZ;
      expect(drive.brakeDecel).toBeGreaterThan(coastDecelAtTop);
    }
  });

  it("defaults steering grip to fully on rails", () => {
    expect(DRIVE_CONFIG.steeringGrip).toBe(1);
  });

  it("bounds steering grip to 0..1", () => {
    expect(DRIVE_CONFIG.steeringGrip).toBeGreaterThanOrEqual(0);
    expect(DRIVE_CONFIG.steeringGrip).toBeLessThanOrEqual(1);
  });

  it("has a positive impact grip deceleration", () => {
    expect(DRIVE_CONFIG.impactGripDecel).toBeGreaterThan(0);
  });
});
```

Import `TICK_RATE_HZ` from `../constants.js` at the top of the file if it is not already imported.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/config/config.test.ts`
Expected: FAIL — `coastPerTick` is undefined, `steeringGrip` is undefined.

- [ ] **Step 3: Add the fields**

In `packages/shared/src/config/types.ts`, add to `CarDef`:

```ts
  /**
   * How long this chassis takes to shed half its speed while coasting, in seconds.
   *
   * A DIRECT VALUE, NOT A 0-100 RATING. This and `brakeDecel` are the first two fields on this
   * table that are not ratings — do not scale them by anything, and do not derive them from `mass`
   * (spec P7: mass stays out of the drive model).
   */
  coastHalfLifeSeconds: number;
  /** Flat deceleration while the brake is held, u/s². Also a direct value, not a rating. */
  brakeDecel: number;
```

In `packages/shared/src/config/car-config.ts`, add both to every `CAR_TABLE` row. Use the current
global values as the starting point so this task changes no feel — the real numbers land in Task 7:

```ts
mirage:   { ..., coastHalfLifeSeconds: 0.35, brakeDecel: 1600, ... },
bullseye: { ..., coastHalfLifeSeconds: 0.35, brakeDecel: 1600, ... },
bastion:  { ..., coastHalfLifeSeconds: 0.35, brakeDecel: 1600, ... },
```

Then add the accessors, beside `accelOf`:

```ts
export function coastHalfLifeSecondsOf(id: CarId): number {
  return CAR_TABLE[id].coastHalfLifeSeconds;
}

export function brakeDecelOf(id: CarId): number {
  return CAR_TABLE[id].brakeDecel;
}
```

Extend `ChassisDrive` and `resolveChassisDrive` (import `halfLifeToPerTick` from `./ram-config.js`):

```ts
export interface ChassisDrive {
  maxSpeed: number;
  reverseMaxSpeed: number;
  accel: number;
  reverseAccel: number;
  turnRate: number;
  turnRateAtStop: number;
  /** Per-tick multiplier on forward speed while coasting. Resolved from `coastHalfLifeSeconds`. */
  coastPerTick: number;
  /** Flat deceleration while the brake is held, u/s². */
  brakeDecel: number;
}
```

Inside `resolveChassisDrive`'s `Object.freeze({ ... })`, add:

```ts
          coastPerTick: halfLifeToPerTick(coastHalfLifeSecondsOf(id)),
          brakeDecel: brakeDecelOf(id),
```

In `packages/shared/src/config/drive-config.ts`, **delete** `drag` and `brakeDecel` and add:

```ts
  /**
   * How completely the velocity vector rotates with the heading, 0-1.
   *
   * At 1 the car is on rails: velocity tracks the nose exactly, so turning at any speed puts you
   * where you aim and you never fight your own momentum while steering. Below 1 the velocity lags
   * and the car washes wide.
   *
   * This is deliberately NOT one half of a friction circle. Holding Mirage's turn at top speed
   * demands roughly fifteen times the lateral force that bleeding a ram's knockback needs, so a
   * single honest grip cap high enough to corner on rails would annihilate knockback in about 70ms.
   * Steering is therefore exempt from the grip budget by construction, and `impactGripDecel` below
   * governs imposed motion alone. See spec "Why one friction circle does not work here".
   */
  steeringGrip: 1.0,
  /**
   * The rate externally imposed sideways velocity bleeds off, u/s². Ram recovery and nothing else.
   * Flat rather than proportional: a saturated tyre delivers a roughly constant force.
   */
  impactGripDecel: 250,
```

- [ ] **Step 4: Run the config test to verify it passes**

Run: `npx vitest run packages/shared/src/config/config.test.ts`
Expected: PASS. The rest of the package does not compile yet — that is Task 4.

- [ ] **Step 5: Remove the now-dead ordering assertion**

`config.test.ts` has an existing assertion that `DRIVE_CONFIG.brakeDecel > DRIVE_CONFIG.drag`. Both
constants are gone; delete that assertion — the per-car version written in Step 1 replaces it.

Also delete `STATUS_LIMITS.brakeDecel`'s floor justification if it references `DRIVE_CONFIG.drag`
directly; the check in `status-config.test.ts` must now compare against the *slowest-coasting*
chassis. Update it to:

```ts
const worstCoastDecel = Math.max(
  ...activeCarIds().map((id) => (1 - driveOf(id).coastPerTick) * forwardMaxSpeedOf(id) * TICK_RATE_HZ),
);
const slowestBrake = Math.min(...activeCarIds().map((id) => driveOf(id).brakeDecel));
expect(slowestBrake * STATUS_LIMITS.brakeDecel.min).toBeGreaterThan(worstCoastDecel);
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config/
git commit -m "feat(config): per-car coast and brake, steering and impact grip knobs"
```

---

## Task 3: Specify the new drive behaviour (failing tests)

**Files:**
- Create: `packages/shared/src/sim/drive-vector.test.ts`

**Interfaces:**
- Consumes: `stepDrive` (about to change shape), `SimBody` (about to gain `vx`/`vy`),
  `ChassisDrive` from Task 2, the four helpers from Task 1.
- Produces: the executable definition of stage 1's target behaviour. Task 4 exists to make this pass.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/sim/drive-vector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ChassisDrive } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { InputMessage } from "../net/input.js";
import { stepDrive } from "./drive.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import type { SimBody } from "./step.js";
import { forwardOf, lateralOf } from "./velocity.js";

const DT = 1 / 30;

/**
 * A fixed chassis, frozen here rather than read from `CAR_TABLE`. These expectations pin the SHAPE
 * of the new integration, not the roster's balance — every car's ratings must stay free to move
 * without any number below moving with them. Same principle as `golden.test.ts`.
 */
const CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 300,
  reverseMaxSpeed: 195,
  accel: 200,
  reverseAccel: 282,
  turnRate: 6.3,
  turnRateAtStop: 3.15,
  coastPerTick: 0.5 ** (1 / (1.0 * 30)), // a 1.0s half-life at 30Hz
  brakeDecel: 500,
});

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function body(over: Partial<SimBody> = {}): SimBody {
  return {
    x: 0, y: 0, angle: 0,
    vx: 0, vy: 0,
    reverseHold: 0,
    angVel: 0,
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
    ...over,
  };
}

describe("vector drive: throttle acts on the forward component", () => {
  it("accelerates along the heading from rest", () => {
    const next = stepDrive(body(), input(0, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(CHASSIS.accel * DT);
    expect(lateralOf(next.vx, next.vy, next.angle)).toBeCloseTo(0);
  });

  it("clamps forward speed to the chassis maximum", () => {
    const next = stepDrive(body({ vx: 295, vy: 0 }), input(0, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(CHASSIS.maxSpeed);
  });

  it("brakes at the chassis flat rate while rolling forward", () => {
    const next = stepDrive(body({ vx: 200, vy: 0 }), input(0, -1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(200 - CHASSIS.brakeDecel * DT);
  });
});

describe("vector drive: coasting is speed-proportional", () => {
  it("sheds a fixed FRACTION per tick, not a fixed amount", () => {
    const fast = stepDrive(body({ vx: 300, vy: 0 }), input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    const slow = stepDrive(body({ vx: 30, vy: 0 }), input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    const fastLoss = 300 - forwardOf(fast.vx, fast.vy, fast.angle);
    const slowLoss = 30 - forwardOf(slow.vx, slow.vy, slow.angle);
    // Ten times the speed sheds ten times the speed. Flat drag would shed the same amount.
    expect(fastLoss / slowLoss).toBeCloseTo(10, 1);
  });

  it("halves the speed over one half-life", () => {
    let b = body({ vx: 300, vy: 0 });
    for (let i = 0; i < 30; i++) b = stepDrive(b, input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(b.vx, b.vy, b.angle)).toBeCloseTo(150, 0);
  });

  it("snaps to true rest inside stopEpsilon rather than creeping forever", () => {
    let b = body({ vx: DRIVE_CONFIG.stopEpsilon / 2, vy: 0 });
    b = stepDrive(b, input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
  });
});

describe("vector drive: steering grip", () => {
  it("at grip 1.0 the velocity follows the nose exactly, leaving no lateral", () => {
    // A car doing 300 that turns hard should still be doing ~300 straight ahead afterwards.
    const next = stepDrive(body({ vx: 300, vy: 0 }), input(1, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(next.angle).toBeGreaterThan(0); // it did turn
    expect(lateralOf(next.vx, next.vy, next.angle)).toBeCloseTo(0);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeGreaterThan(295);
  });

  it("steers at the at-rest rate when stopped", () => {
    const next = stepDrive(body(), input(1, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(next.angle).toBeCloseTo(CHASSIS.turnRateAtStop * DT);
  });
});

describe("vector drive: imposed lateral velocity", () => {
  it("bleeds sideways motion at the flat impact-grip rate", () => {
    const next = stepDrive(body({ vx: 0, vy: 200 }), input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    // Facing +x, so all 200 is lateral. It loses impactGripDecel * dt.
    expect(lateralOf(next.vx, next.vy, next.angle)).toBeCloseTo(
      200 - DRIVE_CONFIG.impactGripDecel * DT,
    );
  });

  it("never overshoots through zero", () => {
    const tiny = DRIVE_CONFIG.impactGripDecel * DT * 0.25;
    const next = stepDrive(body({ vx: 0, vy: tiny }), input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(lateralOf(next.vx, next.vy, next.angle)).toBeCloseTo(0);
  });

  it("bleeds lateral independently of forward, so a shoved car keeps driving", () => {
    const next = stepDrive(body({ vx: 200, vy: 100 }), input(0, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeGreaterThan(200); // still accelerating
    expect(lateralOf(next.vx, next.vy, next.angle)).toBeLessThan(100);    // and still recovering
  });
});

describe("vector drive: reverse", () => {
  it("does not engage reverse until the hold delay elapses at rest", () => {
    let b = body();
    b = stepDrive(b, input(0, -1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(b.vx, b.vy, b.angle)).toBeCloseTo(0);
    expect(b.reverseHold).toBe(1);
  });

  it("reverses once the hold delay is satisfied, clamped to the reverse cap", () => {
    let b = body({ reverseHold: DRIVE_CONFIG.reverseHoldTicks });
    for (let i = 0; i < 200; i++) b = stepDrive(b, input(0, -1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(b.vx, b.vy, b.angle)).toBeCloseTo(-CHASSIS.reverseMaxSpeed);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/sim/drive-vector.test.ts`
Expected: FAIL — TypeScript errors on `vx`/`vy` not existing on `SimBody`.

- [ ] **Step 3: Commit the failing spec**

Committing a red test on its own is deliberate here: it is the executable definition of what Task 4
must produce, and it wants to be reviewable before the cutover happens.

```bash
git add packages/shared/src/sim/drive-vector.test.ts
git commit -m "test(sim): specify vector drive behaviour (red)"
```

---

## Task 4: The cutover — `SimBody`, `stepDrive`, `collide`

**Files:**
- Modify: `packages/shared/src/sim/step.ts`
- Modify: `packages/shared/src/sim/drive.ts`
- Modify: `packages/shared/src/sim/collide.ts`
- Test: `packages/shared/src/sim/drive-vector.test.ts` (from Task 3)

**Interfaces:**
- Consumes: Task 1's helpers, Task 2's `ChassisDrive`, Task 3's failing spec.
- Produces: `SimBody` with `vx`/`vy` and without `speed`/`shoveX`/`shoveY`/`authority`. Every later
  task and every later stage depends on this shape.

- [ ] **Step 1: Change the `SimBody` shape**

In `packages/shared/src/sim/step.ts`, replace `speed`, `shoveX`, `shoveY` and `authority` with:

```ts
  /**
   * World velocity, units per second. REPLACES the old scalar `speed`, which was a magnitude along
   * the heading with a separate `shoveX/shoveY` vector bolted alongside for knockback.
   *
   * There is no successor to `shove`. Steering grip keeps the car's own motion aligned with its
   * nose, so any LATERAL component of this vector is by definition externally imposed — the thing
   * `shove` existed to represent is now just a decomposition of the one velocity, which is why a
   * knocked car's motion and a driven car's motion finally obey the same integrator.
   */
  vx: number;
  vy: number;
```

`authority` is not replaced here. Ram control-loss is reinstated as the `reeling` status in stage 3;
between now and then a rammed car keeps full steering. That is the "ramming temporarily degraded"
note in the folder README, and it is expected.

- [ ] **Step 2: Rewrite `stepDrive`'s main path**

In `packages/shared/src/sim/drive.ts`, replace the body of `stepDrive`'s non-maneuver path:

```ts
export function stepDrive(
  body: SimBody,
  input: InputMessage,
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): SimBody {
  if (isDashing(body)) return stepDash(body, dt, chassis, mods);
  if (body.maneuver === ManeuverKind.HOLD && body.maneuverTicksLeft > 0) {
    return stepHold(body, input, dt, chassis, mods);
  }
  const maneuverNext = tickCharge(body);

  const forward = forwardOf(body.vx, body.vy, body.angle);
  const lateral = lateralOf(body.vx, body.vy, body.angle);

  const baseTurnRate = isMoving(forward) ? chassis.turnRate : chassis.turnRateAtStop;
  const turnRate = baseTurnRate * mods.turnRate;
  const steer = mods.steeringLocked ? 0 : input.steer;
  // Steering and injected spin are ADDED into one rotation, which is what makes countersteering
  // free: the integrator does not know why angVel is high, so steering the other way subtracts
  // from the same sum. `authority` used to scale the steer term; the `reeling` status scales
  // `mods.turnRate` instead as of stage 3.
  const angle = body.angle + (steer * turnRate + body.angVel) * dt;

  const throttle = mods.immobilised ? 0 : input.throttle;
  const stepped = nextForward(forward, body.reverseHold, throttle, dt, chassis, mods);
  const heldForward = mods.fullStop ? 0 : stepped.forward;
  const reverseHold = mods.fullStop ? 0 : stepped.reverseHold;

  // Imposed sideways motion bleeds at a FLAT rate — a saturated tyre delivers a roughly constant
  // force — while the forward component above decays proportionally. The two axes are independent
  // by construction; see the spec on why one friction circle cannot serve both.
  const nextLateral = bleedLateral(lateral, dt);

  // `steeringGrip` decides how much of this tick's rotation the velocity follows. At 1 the velocity
  // is rebuilt entirely in the NEW heading (on rails). At 0 it is rebuilt in the OLD one, so the
  // nose turns and the car keeps sliding the way it was already going.
  const velocityAngle = body.angle + (angle - body.angle) * DRIVE_CONFIG.steeringGrip;
  const v = toWorld(velocityAngle, heldForward, nextLateral);

  return {
    x: body.x + v.vx * dt,
    y: body.y + v.vy * dt,
    angle,
    vx: v.vx,
    vy: v.vy,
    reverseHold,
    angVel: nextAngVel(body.angVel, steer),
    ...maneuverNext,
  };
}
```

- [ ] **Step 3: Rewrite the speed helpers as forward helpers**

Still in `drive.ts`. `nextSpeed` becomes `nextForward` and returns `{ forward, reverseHold }`;
`accelerateForward`, `brakeOrReverse` and `reverseFurther` keep their logic but read
`chassis.brakeDecel` instead of `DRIVE_CONFIG.brakeDecel`. `coast` becomes multiplicative:

```ts
/** No throttle: the forward component decays by a fixed FRACTION per tick. */
function coast(forward: number, chassis: ChassisDrive): number {
  const next = forward * chassis.coastPerTick;
  // Proportional decay is asymptotic and never actually reaches zero. `stopEpsilon` is what stops
  // a coasting car creeping forever a hair above rest.
  return Math.abs(next) <= DRIVE_CONFIG.stopEpsilon ? 0 : next;
}

/** Imposed sideways motion, bled toward zero at a flat rate and never overshot through it. */
function bleedLateral(lateral: number, dt: number): number {
  const drop = DRIVE_CONFIG.impactGripDecel * dt;
  if (lateral > 0) return Math.max(0, lateral - drop);
  if (lateral < 0) return Math.min(0, lateral + drop);
  return 0;
}
```

Delete `decayShove`, `recoverAuthority`, and every reference to `RAM_CONFIG.shoveEpsilon` and
`RAM_CONFIG.authorityEpsilon`. `nextAngVel` stays exactly as it is — spin is untouched by this stage.

Add the imports: `import { forwardOf, lateralOf, toWorld } from "./velocity.js";`

- [ ] **Step 4: Port `stepDash` and `stepHold`**

Both build a `SimBody` literal and both must stop emitting the four dead fields. In `stepDash`, the
exit handoff becomes a velocity along the dash angle:

```ts
    // Hand the car back already rolling at its cap — a dash that exits frozen reads as a stall.
    ...(done
      ? toWorld(body.maneuverAngle, chassis.maxSpeed * mods.topSpeed, 0)
      : { vx: body.vx, vy: body.vy }),
```

In `stepHold`, the engine is dead but the wheel is not, so the forward component is forced to 0
while any imposed lateral motion still displaces the car:

```ts
  const lateral = bleedLateral(lateralOf(body.vx, body.vy, body.angle), dt);
  const v = toWorld(angle, 0, lateral);
```

and the position lines become `body.x + v.vx * dt`, `body.y + v.vy * dt`.

- [ ] **Step 5: Port `collide.ts` mechanically**

`applyContact`'s reflection currently reconstructs `v` from `forward * speed`, reflects it, then
throws the direction away by re-projecting onto `forward`. **Keep that discard for now** — making
walls genuinely deflect is stage 2's Task 1, and doing it here would make this task's diff
unreviewable. The minimal port:

```ts
function applyContact(body: SimBody, push: Vec2): SimBody {
  const length = Math.hypot(push.x, push.y);
  if (length <= MIN_OVERLAP) return body;
  const n: Vec2 = { x: push.x / length, y: push.y / length };

  let vx = body.vx;
  let vy = body.vy;
  const intoSurface = vx * n.x + vy * n.y;
  if (intoSurface < 0) {
    const scale = (1 + DRIVE_CONFIG.restitution) * intoSurface;
    vx -= scale * n.x;
    vy -= scale * n.y;
  }

  // STAGE 2 REMOVES THE NEXT THREE LINES. Today the reflected direction is discarded and only the
  // magnitude survives along the unchanged facing, which is why walls damp but never redirect.
  // Preserved here so this task is a pure representation change with no behavioural surprise.
  const forward: Vec2 = { x: Math.cos(body.angle), y: Math.sin(body.angle) };
  const magnitude = Math.hypot(vx, vy);
  const signed = vx * forward.x + vy * forward.y < 0 ? -magnitude : magnitude;

  return { ...body, x: body.x + push.x, y: body.y + push.y, ...toWorld(body.angle, signed, 0) };
}
```

Every other function in `collide.ts` that spells out a full `SimBody` literal (`clampIntoBounds`,
`resolveWorld`'s return) can now use `{ ...next }` spread — the four dead fields are gone and
listing them by hand was the only reason those literals existed.

- [ ] **Step 6: Run the new spec to verify it passes**

Run: `npx vitest run packages/shared/src/sim/drive-vector.test.ts`
Expected: PASS, all 13 tests.

- [ ] **Step 7: Run the shared suite and triage**

Run: `npm test -w @motor-combat-moba/shared`
Expected: `drive.test.ts`, `collide.test.ts`, `step.test.ts`, `ram.test.ts`, `contact.test.ts` and
`golden.test.ts` all fail on the removed fields. **Update the fixtures, not the assertions'
intent** — every `rest()`/`body()` helper in those files needs `speed`/`shoveX`/`shoveY`/`authority`
swapped for `vx`/`vy`. Where an assertion reads `next.speed`, replace it with
`forwardOf(next.vx, next.vy, next.angle)`.

Leave `golden.test.ts` failing. Task 6 owns it.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/sim/
git commit -m "feat(sim)!: replace scalar speed with a 2D velocity vector"
```

---

## Task 5: Port the schema, server, client and bot

**Files:**
- Modify: `packages/shared/src/schema/PlayerState.ts`
- Modify: `packages/server/src/sim/tick.ts`, `packages/server/src/sim/ram-bridge.ts`
- Modify: `packages/client/src/net/prediction.ts`, `packages/client/src/net/interpolation.ts`
- Modify: `packages/server/src/bot/brain/aim.ts`, `packages/server/src/bot/brain/perception.ts`
- Modify: `packages/server/src/bot/brain/profiles.ts` (or wherever `BOT_BRAIN_VERSION` lives)

**Interfaces:**
- Consumes: `SimBody` from Task 4.
- Produces: `PlayerState.vx`, `PlayerState.vy` on the wire.

- [ ] **Step 1: Change the schema**

In `packages/shared/src/schema/PlayerState.ts`, delete `speed`, `shoveX`, `shoveY` and `authority`,
and add:

```ts
  /**
   * World velocity, units/second. Networked because `stepSim` reads both (invariant 8), and
   * reconciled by SNAPPING rather than easing — they feed the next integration, so a half-eased
   * value would poison every subsequent step rather than merely look wrong.
   *
   * Replaces four fields with two: the old `speed` + `shoveX`/`shoveY` + `authority` quartet.
   * `authority` is gone entirely; ram control-loss is the `reeling` status as of stage 3.
   */
  @type("number") vx = 0;
  @type("number") vy = 0;
```

Update `packages/shared/src/schema/schema.test.ts`: its default-value and round-trip assertions name
the removed fields.

- [ ] **Step 2: Port the server mapping**

`packages/server/src/sim/tick.ts` and `ram-bridge.ts` map `PlayerState` to and from `SimBody`.
Replace every `player.speed` / `body.speed` pair with `vx`/`vy`, and every
`shoveX`/`shoveY`/`authority` copy is deleted.

`ram-bridge.ts` needs three specific changes:

1. `TickResult.approachSpeeds` currently caches each car's pre-collision `speed`. It must now cache
   the pre-collision **forward** component: `forwardOf(body.vx, body.vy, body.angle)`. This is
   load-bearing — the doc comment on `RamCar.speed` records that passing the post-resolution value
   cost 80–90% of all rams until a playtest probe caught it.
2. Applying a `RamKnock` no longer writes `shoveX`/`shoveY`/`authority`. Until stage 2 replaces
   `RamKnock` with `Impulse`, add the knock straight into the victim's velocity:
   ```ts
   player.vx += knock.shoveX;
   player.vy += knock.shoveY;
   // knock.authority is dropped on the floor until stage 3 reinstates control loss as `reeling`.
   ```
3. `SLAM_CONFIG.selfKeepFactor` is applied as `attacker.speed * selfKeepFactor`. Rewrite it in terms
   of the forward component and leave it in place — stage 4 deletes it.

- [ ] **Step 3: Port the client mapping**

`prediction.ts` and `interpolation.ts` copy pose fields between schema and body. Replace `speed:` with
`vx:`/`vy:` in every literal. In `interpolation.ts`, `vx`/`vy` interpolate linearly exactly as
`speed` did — they are ordinary numeric pose fields to that module.

- [ ] **Step 4: Simplify the bot's velocity reads**

`packages/server/src/bot/brain/aim.ts` reconstructs a target's velocity by hand:

```ts
  if (leadFactor <= 0 || projectileSpeed <= 0 || target.speed === 0) return here;
  const vx = Math.cos(target.angle) * target.speed;
  const vy = Math.sin(target.angle) * target.speed;
```

becomes:

```ts
  if (leadFactor <= 0 || projectileSpeed <= 0) return here;
  const { vx, vy } = target;
  if (vx === 0 && vy === 0) return here;
```

`perception.ts` does the same in its dead-reckoning:

```ts
    x: known.car.x + Math.cos(known.car.angle) * known.car.speed * dt,
    y: known.car.y + Math.sin(known.car.angle) * known.car.speed * dt,
```

becomes:

```ts
    x: known.car.x + known.car.vx * dt,
    y: known.car.y + known.car.vy * dt,
```

Both get shorter *and* more correct: neither could previously lead a car that was being shoved or
sliding, because that motion did not exist in the scalar. Update `packages/server/src/bot/view.ts`
to carry `vx`/`vy` on its car view instead of `speed`.

- [ ] **Step 5: Bump `BOT_BRAIN_VERSION`**

Step 4 changes bot behaviour without `BOT_PROFILES` moving, which is exactly the case
`BOT_BRAIN_VERSION` exists for — `botFingerprint` would otherwise claim two incomparable balance
runs are comparable. Increment it by one.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS everywhere **except** `golden.test.ts`, which Task 6 owns. If anything else fails,
it is a porting miss — fix it here rather than deferring.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schema/ packages/server/src/ packages/client/src/net/
git commit -m "feat!: carry velocity as vx/vy across schema, server, client and bot"
```

---

## Task 6: Refixture `golden.test.ts`

**Files:**
- Modify: `packages/shared/src/sim/golden.test.ts`

**Interfaces:**
- Consumes: the finished integration from Tasks 4 and 5.
- Produces: a frozen fixture pinning the *new* integration.

> **Be honest about what this costs.** `golden.test.ts` exists to prove the drive integration has not
> changed. This rework changes it deliberately, so the fixture is regenerated by design — but the
> fixture that would have caught an *accidental* change is being replaced by one recorded from code
> written minutes ago. Read the new numbers and sanity-check them against Task 3's spec before
> accepting them; do not paste whatever the code emits.

- [ ] **Step 1: Update the fixture's chassis and body helpers**

`GOLDEN_CHASSIS` needs the two new `ChassisDrive` fields. Keep the existing six values exactly as
they are — they are deliberately not the roster's — and add:

```ts
  coastPerTick: 0.5 ** (1 / (0.35 * 30)), // the pre-rework 0.35s half-life, frozen
  brakeDecel: 1600,                       // the pre-rework global, frozen
```

- [ ] **Step 2: Run the suite and read the failures**

Run: `npx vitest run packages/shared/src/sim/golden.test.ts`
Expected: FAIL on every recorded position and speed.

- [ ] **Step 3: Re-record, then verify by hand**

Update each expected value. Before accepting any of them, hand-check these three against Task 3's
spec:

- A full-throttle-from-rest tick moves the car by `accel * dt * dt` and leaves zero lateral.
- A coasting tick from speed `s` leaves `s * coastPerTick`, not `s - drag * dt`.
- A hard-turn-at-speed tick leaves lateral at zero (grip is 1.0), and total speed essentially
  unchanged.

If any of those three disagrees with the code, the code is wrong and the fixture must not be
recorded from it.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, everything.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/golden.test.ts
git commit -m "test(sim): refixture golden against the vector integration"
```

---

## Task 7: Apply the starting values and rewrite `turn-tuning.md`

**Files:**
- Modify: `packages/shared/src/config/car-config.ts`, `drive-config.ts`
- Modify: `docs/turn-tuning.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the roster the rest of the stages are tuned against.

- [ ] **Step 1: Apply the new drive scales**

In `drive-config.ts`:

```ts
  baseMaxSpeed: 80,        // was 135
  speedPerRating: 2.2,     // was 3.7
  baseAccel: 60,           // was 420
  accelPerRating: 1.4,     // was 7.2
```

`baseTurnRate`, `turnRatePerRating` and `stopTurnRatio` are **not** touched. Turn radius is
`speed / turnRate`, so the speed cut alone drops every chassis from ~53 u to ~31 u of radius —
comfortably under one car length. That is "aiming gets easier" arriving for free (spec P8).

- [ ] **Step 2: Apply the per-car coast and brake**

In `car-config.ts`:

```ts
mirage:   { ..., coastHalfLifeSeconds: 1.2, brakeDecel: 500, ... },
bullseye: { ..., coastHalfLifeSeconds: 1.0, brakeDecel: 520, ... },
bastion:  { ..., coastHalfLifeSeconds: 1.5, brakeDecel: 430, ... },
```

- [ ] **Step 3: Bring the spectator camera down**

`CAMERA_CONFIG.freeRoamSpeed` is 1050 against a new fastest car of 267. `config.test.ts` still passes
(it only requires the camera to be faster), but a free-look pan four times quicker than any car reads
as unmoored. Set it to `340` — a little above the fastest car, which is what the coupling note in
`drive-config.ts` asks for.

- [ ] **Step 4: Verify the derived numbers**

Run the snippet from `docs/turn-tuning.md`'s "Keeping this page honest" section and record the output.
Do not retype the derived values by hand.

Expected, to sanity-check the snippet against: Mirage 267 u/s and 33 u radius, Bullseye 223 and 31,
Bastion 190 and 30.

- [ ] **Step 5: Rewrite the doc**

`docs/turn-tuning.md` carries three hand-written tables and
`scripts/turn-tuning-doc.test.mjs` recomputes every cell from built shared. Update:

- Every value in all three tables, from Step 4's output.
- **Two new columns** in the per-car table: coast half-life and brake deceleration.
- The "Keeping this page honest" field list, which must now name `coastHalfLifeSeconds`,
  `brakeDecel`, `steeringGrip` and `impactGripDecel` as fields that oblige an edit, and must drop
  `DRIVE_CONFIG.drag` and `DRIVE_CONFIG.brakeDecel`, which no longer exist.

- [ ] **Step 6: Re-read the prose**

The doc test parses tables. **It cannot see numbers inside sentences**, and that page argues from
figures in prose throughout — including the claim that Bastion turns inside every other chassis and
the discussion of the old speed/handling inversion. Read every paragraph and correct any figure the
new values invalidate. This step has no command; it is done by reading.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, including `scripts/turn-tuning-doc.test.mjs`.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/config/ docs/turn-tuning.md
git commit -m "feat(balance): heavy-car speed and acceleration, per-car coast and brake"
```

---

## Stage 1 exit criteria

- [ ] `npm test` passes from the repo root.
- [ ] `npm run build` (root, not `--workspaces`) succeeds.
- [ ] `npm run dev`, drive a car: it takes ~1.5 s to reach speed, rolls a long way off the throttle,
      and turns inside its own length without washing wide.
- [ ] Ramming still knocks cars sideways, but the victim keeps full steering. **This is expected** —
      control loss returns in stage 3.

**Not done in this stage, deliberately:** walls still damp rather than deflect (stage 2), separation
is still mass-blind (stage 2), ram severity still reads the attacker's speed alone (stage 3).
