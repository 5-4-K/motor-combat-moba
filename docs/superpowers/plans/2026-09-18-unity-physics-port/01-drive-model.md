# Stage 1: The Drive Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `stepDrive`'s ordinary branch with Unity's drag + grip + turn model, and reshape
the config and per-car resolution that feed it.

**Architecture:** One drag rate per car, always on, sets top speed, wind-up and roll together. A
global grip rate bleeds the lateral velocity component, which is what makes a car drift. Every
per-tick factor is resolved once into `ChassisDrive`, so `stepDrive` reads no module-level rate and a
60 Hz run is a different `ChassisDrive`, not a different function.

**Tech Stack:** TypeScript, npm workspaces, vitest. `@motor-combat-moba/shared` is consumed as built
`dist` — rebuild it after editing (`npm run build -w @motor-combat-moba/shared`).

**Spec:** [`docs/superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`](../../specs/2026-09-18-unity-driving-and-ram-physics-port-design.md)
— §4, §5, §9.1, §9.2, §10, and decisions U4, U8, U9, U12–U20, U34–U37.

**Ledger:** [`interfaces.md`](interfaces.md) — outranks this plan for every shared name.

## Global Constraints

- **`npm test` from the repo root**, never per-workspace: a per-workspace run silently skips the
  server suite.
- **`npm install` in this worktree before the first build**, or the build inlines the main checkout's
  shared `dist`.
- **Build with root `npm run build`**, never `npm run build --workspaces` (ordering).
- **No magic numbers in logic.** Every constant lands in `packages/shared/src/config/`.
- **`TICK_RATE_HZ` lives once in shared.** Per-tick factors are derived from it, never typed.
- Ratings are 0–100: `speed`, `accel`, `handling`, `attack`, `hp`, `ramAttack`, `ramDefence`.
- The hull is `DRIVE_CONFIG.carWidth` 60 × `carHeight` 40 and does not move in this work.
- Do not touch `docs/ideas/` or `docs/invariants/`.
- **Three bot tests are already red** before this stage starts (`controller.test.ts` OFF-AXIS,
  `tiers.test.ts` P49 and P50). Record their readings; do not re-pin them to make them pass.

---

### Task 1: Rate helpers and the new drive knobs

**Files:**
- Modify: `packages/shared/src/config/drive-config.ts`
- Test: `packages/shared/src/config/config.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `perTickDecay(ratePerSecond: number): number`; `DRIVE_CONFIG.baseDrag`, `.dragPerRating`,
  `.lateralGripRate`, `.reverseEpsilon`, `.flipSteeringInReverse`.

The old knobs stay in place this task so the tree keeps compiling; Task 6 deletes them.

- [ ] **Step 1: Write the failing test**

Append to the `DRIVE_CONFIG` describe in `packages/shared/src/config/config.test.ts`:

```ts
describe("the Unity drive knobs", () => {
  it("turns a per-second rate into a per-tick factor", () => {
    expect(perTickDecay(0)).toBe(1);
    // A rate of ln(2) per second halves in exactly one second, whatever the tick rate is.
    const oneSecond = perTickDecay(Math.LN2) ** TICK_RATE_HZ;
    expect(oneSecond).toBeCloseTo(0.5, 12);
  });

  it("authors drag, grip and the reverse threshold as per-second rates", () => {
    expect(DRIVE_CONFIG.baseDrag).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.dragPerRating).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.lateralGripRate).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.reverseEpsilon).toBeGreaterThan(DRIVE_CONFIG.stopEpsilon);
    expect(DRIVE_CONFIG.flipSteeringInReverse).toBe(true);
  });

});
```

Add `perTickDecay` and `TICK_RATE_HZ` to that file's imports.

> **The slip-angle assertion is deliberately NOT in this task.** Slip at full lock is
> `atan(turnRate / lateralGripRate)`, and `baseTurnRate`/`turnRatePerRating` do not reach their
> ported values until Task 6 — against today’s 3.6/0.054 the sharpest turn slips 71.6°, so any
> bound that passed here would be measuring the OLD turn model, and the only way to satisfy it
> would be to falsify `lateralGripRate`. **`lateralGripRate` is 3.0 verbatim (spec §9.2, a user
> decision).** Task 6 asserts the slip angle, in the same edit that lands the new rates.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm test -w @motor-combat-moba/shared -- config.test
```

Expected: FAIL — `perTickDecay is not a function`.

- [ ] **Step 3: Add the helper and the knobs**

In `packages/shared/src/config/drive-config.ts`, import `TICK_RATE_HZ` (copy the import path another
file in `config/` already uses) and add above `DRIVE_CONFIG`:

```ts
/**
 * A per-second decay rate as the factor one tick multiplies by: `exp(-rate / TICK_RATE_HZ)`.
 *
 * Every rate in the Unity drive model is authored per SECOND and converted here exactly once, which
 * is what makes the model tick-rate independent (U7): raising `TICK_RATE_HZ` re-derives every factor
 * and changes no behaviour. Never type a per-tick number into config.
 */
export function perTickDecay(ratePerSecond: number): number {
  return Math.exp(-ratePerSecond / TICK_RATE_HZ);
}
```

Then add these fields to `DRIVE_CONFIG`, each with its doc comment:

```ts
  /**
   * Velocity decay rate at `accel` rating 0, in 1/s. Unity's `DriveConfig.linearDrag` (1.0).
   *
   * THIS ONE NUMBER SETS THREE THINGS at once, which is the whole content of the Unity model (U4):
   * top speed (`engineAccel / dragRate`), the time constant of the wind-up, and how far the car
   * rolls off the throttle. A car cannot launch quickly and roll a long way.
   */
  baseDrag: 0.768,
  /** Added drag per point of `accel` rating, 1/s. Anchored so rating 85 reaches ~90% of top speed in ~1.8 s. */
  dragPerRating: 0.00608,
  /**
   * How fast sideways velocity bleeds off, 1/s. Unity's `DriveConfig.lateralGripStrength` (6.0).
   *
   * Global rather than per-car (U10). The steady-state slip angle while holding full lock is
   * `atan(turnRate / lateralGripRate)` at ANY speed, so this is the drift knob: lower drifts more,
   * and 0 is a hockey puck. 3.0 gives ~35° at the sharpest turn on the roster — a real drift, looser
   * than Unity's grippy 6.0.
   *
   * **This rate is the DRIVER's drift only.** How long an IMPOSED shove carries a victim is the
   * `grip` status multiplier on `reeling` (spec §5), because one number could not answer both
   * questions once the base rate came down this far.
   */
  lateralGripRate: 3.0,
  /**
   * Forward speed below which Down reverses instead of braking, u/s. Unity's
   * `DriveConfig.reverseEpsilon` (0.5 m/s). It is also the threshold the steering flip reads, which
   * is why there is one of it and not two.
   */
  reverseEpsilon: 6.0,
  /**
   * Invert the steering sense while genuinely travelling backwards, the way a real car behaves.
   * Unity's `DriveConfig.flipSteeringInReverse`. Off gives tank-style absolute steering. Turning on
   * the spot is unaffected either way, because the flip needs `forwardSpeed < -reverseEpsilon`.
   */
  flipSteeringInReverse: true,
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npm test -w @motor-combat-moba/shared -- config.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/config/drive-config.ts packages/shared/src/config/config.test.ts
git commit -m "feat(drive): add the Unity drag, grip and reverse knobs"
```

---

### Task 2: Two new status flags and the `grip` channel

**Files:**
- Modify: `packages/shared/src/config/status-types.ts`, `packages/shared/src/sim/status/modifiers.ts`,
  `packages/shared/src/config/status-config.ts` (`STATUS_LIMITS` only)
- Test: `packages/shared/src/sim/status/channels.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `StatusFlag` members `"spinFree" | "ramBlocked"`; `Modifiers.spinFree`, `.ramBlocked`
  (both `false` in `NEUTRAL_MODIFIERS`); **`Modifiers.grip`**, a multiplier neutral at 1, with a
  `STATUS_LIMITS.grip` entry of `{ min: 0.25, max: 2 }`.

No `STATUS_TABLE` row uses any of them until stage 3; this task is the plumbing alone.

**Why `grip` is a channel and not a `gripless` flag (spec §5):** one rate has to answer two
questions — how far a DRIVER drifts through a corner, and how long an IMPOSED shove carries a victim.
A multiplier lets `reeling` say "scrubs, but slower"; a boolean can only say "not at all", which at
this game's loose base rate would throw a rammed car most of the way across the arena.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/sim/status/channels.test.ts`:

```ts
describe("the Unity ability flags and the grip channel", () => {
  it("is neutral on every new modifier for a car in no status", () => {
    expect(NEUTRAL_MODIFIERS.spinFree).toBe(false);
    expect(NEUTRAL_MODIFIERS.ramBlocked).toBe(false);
    expect(NEUTRAL_MODIFIERS.grip).toBe(1);
  });

  it("leaves them neutral for a row that declares none of them", () => {
    const mods = modifiersOf([{ statusId: "stunned", endsTick: 10, sourceSessionId: "" }], 0);
    expect(mods.spinFree).toBe(false);
    expect(mods.ramBlocked).toBe(false);
    expect(mods.grip).toBe(1);
  });

  it("clamps grip to STATUS_LIMITS, so no stack of debuffs turns a car into a puck", () => {
    expect(STATUS_LIMITS.grip.min).toBeGreaterThan(0);
    expect(STATUS_LIMITS.grip.max).toBeGreaterThanOrEqual(1);
  });
});
```

Match the `ActiveStatus` literal to the shape the rest of that file uses.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm test -w @motor-combat-moba/shared -- channels.test
```

Expected: FAIL — `Property 'grip' does not exist on type 'Modifiers'`.

- [ ] **Step 3: Add the flags**

In `status-types.ts`, extend the `StatusFlag` union:

```ts
  /**
   * Steering does not write the car's yaw rate, so an injected spin survives and decays on its own.
   * Unity's `CarAbility.YawHold` blocked. Outside this flag `angVel` IS the steering's yaw rate
   * (U16), so a spin ends the moment control returns.
   */
  | "spinFree"
  /** This car cannot qualify as a ram attacker. Unity's `CarAbility.Ram` blocked. */
  | "ramBlocked"
```

In `modifiers.ts`, add the two booleans to `Modifiers` with the same doc lines, add
`spinFree: false, ramBlocked: false` to `NEUTRAL_MODIFIERS`, and add two lines beside the existing
flag reads in `modifiersOf`:

```ts
  mods.spinFree = flags.has("spinFree");
  mods.ramBlocked = flags.has("ramBlocked");
```

Then add the `grip` multiplier. It needs three edits and no new machinery, because `modifiersOf`
already walks `STATUS_LIMITS`'s keys and multiplies whatever it finds:

```ts
  // in Modifiers
  /**
   * Scales the lateral grip RATE this car is subject to (spec §5). 1 is the drive config's own rate.
   * Below 1 a sideways slide lasts longer, which is what a ram's victim gets; 0 would be Unity's
   * grip-off Reeling, and the `STATUS_LIMITS` floor deliberately keeps it out of reach.
   */
  grip: number;

  // in NEUTRAL_MODIFIERS
  grip: 1,

  // in STATUS_LIMITS (status-config.ts), beside the other channels
  grip: { min: 0.25, max: 2 },
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npm test -w @motor-combat-moba/shared -- channels.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/config/status-types.ts packages/shared/src/sim/status/modifiers.ts packages/shared/src/sim/status/channels.test.ts
git commit -m "feat(status): add the spinFree and ramBlocked flags and the grip channel"
```

---

### Task 3: `ChassisDrive`, the resolvers, and the new `stepDrive`

The stage's core. It lands in one task because `ChassisDrive`'s shape and `stepDrive`'s body cannot
compile apart.

**Files:**
- Modify: `packages/shared/src/config/car-config.ts:124-232`, `packages/shared/src/sim/drive.ts`
- Test: `packages/shared/src/sim/drive-vector.test.ts`, `packages/shared/src/sim/drive.test.ts`,
  `packages/shared/src/sim/golden.test.ts`

**Interfaces:**
- Consumes: `perTickDecay` (Task 1); `Modifiers.grip`, `.spinFree` (Task 2).
- Produces:

```ts
export interface ChassisDrive {
  maxSpeed: number;      // u/s — emergent: engineAccel / dragRate
  engineAccel: number;   // u/s²
  reverseAccel: number;  // u/s²
  brakeDecel: number;    // u/s²
  turnRate: number;      // rad/s, speed-independent
  dragRate: number;      // 1/s — the authored rate, for docs and status scaling
  dragPerTick: number;   // perTickDecay(dragRate)
  gripPerTick: number;   // perTickDecay(DRIVE_CONFIG.lateralGripRate)
  spinPerTick: number;   // perTickDecay(RAM_CONFIG.reelingSpinDecayRate) — 1 until stage 3
}

export function dragRateOf(id: CarId): number;
export function engineAccelOf(id: CarId): number;
```

**`gripPerTick` and `spinPerTick` are resolved per chassis even though both rates are global.** That
is deliberate: it leaves `stepDrive` reading no module-level rate, which is what makes Task 8's
30-vs-60 Hz test possible — build a `ChassisDrive` at the other rate and step it.

- [ ] **Step 1: Write the failing drive tests**

Replace the body of `packages/shared/src/sim/drive-vector.test.ts`. Its chassis literal becomes:

```ts
const DT = 1 / TICK_RATE_HZ;
const DRAG_RATE = 1.0;
const CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 200,
  engineAccel: 200,        // maxSpeed * dragRate
  reverseAccel: 80,        // engineAccel * 0.4
  brakeDecel: 500,
  turnRate: 2,
  dragRate: DRAG_RATE,
  dragPerTick: perTickDecay(DRAG_RATE),
  gripPerTick: perTickDecay(3),
  spinPerTick: 1,
});
```

and the cases are:

```ts
it("approaches top speed asymptotically instead of clamping to it", () => {
  let b = body({ vx: 0, vy: 0 });
  for (let i = 0; i < TICK_RATE_HZ * 10; i++) b = stepDrive(b, input(0, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
  const speed = forwardOf(b.vx, b.vy, b.angle);
  expect(speed).toBeLessThan(CHASSIS.maxSpeed);
  expect(speed).toBeGreaterThan(CHASSIS.maxSpeed * 0.99);
});

it("reaches 90% of top speed after ln(10) time constants", () => {
  const ticks = Math.round((Math.log(10) / DRAG_RATE) * TICK_RATE_HZ);
  let b = body({ vx: 0, vy: 0 });
  for (let i = 0; i < ticks; i++) b = stepDrive(b, input(0, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
  expect(forwardOf(b.vx, b.vy, b.angle)).toBeCloseTo(CHASSIS.maxSpeed * 0.9, 0);
});

it("decays a coasting car by the drag factor every tick, in both components", () => {
  const b0 = body({ ...toWorld(0, 100, 40) });
  const b1 = stepDrive(b0, input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
  expect(forwardOf(b1.vx, b1.vy, b1.angle)).toBeCloseTo(100 * CHASSIS.dragPerTick, 9);
  // The lateral component takes drag AND grip.
  expect(lateralOf(b1.vx, b1.vy, b1.angle)).toBeCloseTo(40 * CHASSIS.dragPerTick * CHASSIS.gripPerTick, 9);
});

it("scales grip by the `grip` modifier, so a shove can be made to ride longer", () => {
  const b0 = body({ ...toWorld(0, 0, 100) });
  const reeling = stepDrive(b0, input(0, 0), DT, CHASSIS, { ...NEUTRAL_MODIFIERS, grip: 0.6 });
  expect(lateralOf(reeling.vx, reeling.vy, reeling.angle)).toBeCloseTo(
    100 * CHASSIS.dragPerTick * CHASSIS.gripPerTick ** 0.6, 9);

  // `grip: 0` is the Unity "no grip at all" case: drag alone. Out of STATUS_LIMITS' reach for a
  // status, reachable here, and the proof the power form degenerates correctly.
  const puck = stepDrive(b0, input(0, 0), DT, CHASSIS, { ...NEUTRAL_MODIFIERS, grip: 0 });
  expect(lateralOf(puck.vx, puck.vy, puck.angle)).toBeCloseTo(100 * CHASSIS.dragPerTick, 9);
});

it("drifts: turning at speed leaves velocity pointing where the car WAS going", () => {
  let b = body({ ...toWorld(0, 150, 0) });
  for (let i = 0; i < 10; i++) b = stepDrive(b, input(1, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
  expect(Math.abs(lateralOf(b.vx, b.vy, b.angle))).toBeGreaterThan(1);
});

it("settles at the slip angle the two rates predict, holding full lock", () => {
  let b = body({ ...toWorld(0, 150, 0) });
  for (let i = 0; i < TICK_RATE_HZ * 5; i++) b = stepDrive(b, input(1, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
  const slip = Math.abs(Math.atan2(lateralOf(b.vx, b.vy, b.angle), forwardOf(b.vx, b.vy, b.angle)));
  expect(slip).toBeCloseTo(Math.atan(CHASSIS.turnRate / 7), 1);
});

it("turns at the same rate stopped as at speed", () => {
  const stopped = stepDrive(body({ vx: 0, vy: 0 }), input(1, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
  const rolling = stepDrive(body({ ...toWorld(0, 150, 0) }), input(1, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
  expect(stopped.angle).toBeCloseTo(CHASSIS.turnRate * DT, 9);
  expect(rolling.angle).toBeCloseTo(CHASSIS.turnRate * DT, 9);
});

it("flips the steering sense once genuinely reversing, and not at rest", () => {
  const reversing = stepDrive(body({ ...toWorld(0, -50, 0) }), input(1, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
  expect(reversing.angle).toBeLessThan(0);
  const atRest = stepDrive(body({ vx: 0, vy: 0 }), input(1, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
  expect(atRest.angle).toBeGreaterThan(0);
});

it("brakes while rolling forward and reverses once nearly stopped, with no hold delay", () => {
  const braking = stepDrive(body({ ...toWorld(0, 100, 0) }), input(0, -1), DT, CHASSIS, NEUTRAL_MODIFIERS);
  expect(forwardOf(braking.vx, braking.vy, braking.angle)).toBeCloseTo(
    100 * CHASSIS.dragPerTick - CHASSIS.brakeDecel * DT, 9);
  const engaging = stepDrive(body({ vx: 0, vy: 0 }), input(0, -1), DT, CHASSIS, NEUTRAL_MODIFIERS);
  expect(forwardOf(engaging.vx, engaging.vy, engaging.angle)).toBeCloseTo(-CHASSIS.reverseAccel * DT, 9);
});

it("scales drag as a power, so `accel: 0` holds a speed instead of stopping the car", () => {
  const held = stepDrive(body({ ...toWorld(0, 120, 0) }), input(0, 1), DT, CHASSIS,
    { ...NEUTRAL_MODIFIERS, accel: 0 });
  expect(forwardOf(held.vx, held.vy, held.angle)).toBeCloseTo(120, 9);
});

it("keeps its spin while spinFree and erases it the moment control returns", () => {
  const spun = { ...body({ vx: 0, vy: 0 }), angVel: 4 };
  const free = stepDrive(spun, input(0, 0), DT, { ...CHASSIS, spinPerTick: 0.9 },
    { ...NEUTRAL_MODIFIERS, spinFree: true });
  expect(free.angVel).toBeCloseTo(3.6, 9);
  const held = stepDrive(spun, input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
  expect(held.angVel).toBe(0);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test -w @motor-combat-moba/shared -- drive-vector.test
```

Expected: FAIL — `ChassisDrive` has no `dragPerTick`.

- [ ] **Step 3: Reshape `ChassisDrive` and its resolvers**

In `packages/shared/src/config/car-config.ts`, replace `accelOf`, `reverseMaxSpeedOf`,
`turnRateAtStopOf` and `coastHalfLifeSecondsOf` with:

```ts
/**
 * This chassis's drag rate, 1/s — the single number that sets its wind-up AND its roll (U4).
 *
 * Named for what it IS rather than for the rating that feeds it: the rating is still `accel`,
 * because a higher rating still means a car that gets going sooner, but the quantity is drag. It was
 * `accelOf` and returned an acceleration until the Unity port; the engine push is `engineAccelOf`.
 */
export function dragRateOf(id: CarId): number {
  return DRIVE_CONFIG.baseDrag + CAR_TABLE[id].accel * DRIVE_CONFIG.dragPerRating;
}

/**
 * The engine's push, u/s². DERIVED so top speed is exactly `forwardMaxSpeedOf`: at equilibrium
 * `engineAccel === maxSpeed * dragRate`. Nothing clamps to the ceiling any more — it is where these
 * two balance, which is why it cannot be authored independently of them.
 */
export function engineAccelOf(id: CarId): number {
  return forwardMaxSpeedOf(id) * dragRateOf(id);
}

export function reverseAccelOf(id: CarId): number {
  return engineAccelOf(id) * DRIVE_CONFIG.reverseAccelFactor;
}
```

and rewrite `resolveChassisDrive`'s inner object:

```ts
        Object.freeze({
          maxSpeed: forwardMaxSpeedOf(id),
          engineAccel: engineAccelOf(id),
          reverseAccel: reverseAccelOf(id),
          brakeDecel: brakeDecelOf(id),
          turnRate: turnRateOf(id),
          dragRate: dragRateOf(id),
          dragPerTick: perTickDecay(dragRateOf(id)),
          gripPerTick: perTickDecay(DRIVE_CONFIG.lateralGripRate),
          // Placeholder for exactly one stage: stage 3 replaces this with
          // `perTickDecay(RAM_CONFIG.reelingSpinDecayRate)` once that knob exists. 1 means "no
          // decay", and nothing sets `spinFree` until that same stage, so it is unreachable here.
          spinPerTick: 1,
        }),
```

- [ ] **Step 4: Rewrite `stepDrive`'s ordinary branch**

In `packages/shared/src/sim/drive.ts`:

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

  // 1. The engine command, decided on the velocity the car carried INTO the tick, as Unity's
  //    `DrivePhysics.DriveForce` reads `body.linearVelocity` before its own drag step.
  const throttle = mods.immobilised ? 0 : input.throttle;
  const command = engineCommandOf(forwardOf(body.vx, body.vy, body.angle), throttle, chassis, mods);

  // 2. Drag, on the WHOLE vector. This is the only thing slowing a car down: there is no separate
  //    coast branch, because the throttle does not switch drag off in a real car either.
  const drag = dragFactorOf(chassis, mods);
  let forward = forwardOf(body.vx, body.vy, body.angle) * drag;
  let lateral = lateralOf(body.vx, body.vy, body.angle) * drag;

  // 3. Grip: the sideways component alone, scaled by the car's own grip modifier. Whatever
  //    survives is the drift.
  lateral *= gripFactorOf(chassis, mods);

  // 4. Yaw. Steering SETS the rate (U16) — it is not added to a separate spin channel — so an
  //    injected ram spin lives exactly as long as `spinFree` does.
  const steer = mods.steeringLocked ? 0 : input.steer;
  const angVel = mods.spinFree
    ? nextSpinOf(body.angVel, chassis)
    : steer * chassis.turnRate * mods.turnRate * steerSenseOf(forward);
  const angle = body.angle + angVel * dt;

  // 5. Integrate, semi-implicit: the command acts along the heading it was decided in, then the
  //    position follows the resulting velocity.
  forward += command * dt;
  if (mods.fullStop || atRest(forward, lateral, throttle)) {
    forward = 0;
    lateral = 0;
  }

  // Recomposed at the OLD angle on purpose: rotating the car must not rotate its velocity. The gap
  // the rotation opens is read as lateral velocity on the NEXT tick, and that gap is the drift.
  const v = toWorld(body.angle, forward, lateral);

  return {
    x: body.x + v.vx * dt,
    y: body.y + v.vy * dt,
    angle,
    vx: v.vx,
    vy: v.vy,
    angVel,
    ...maneuverNext,
  };
}

/** Throttle, brake and reverse as one signed acceleration. Unity's `DrivePhysics.DriveForce`. */
function engineCommandOf(
  forward: number,
  throttle: InputMessage["throttle"],
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): number {
  if (throttle === 1) return chassis.engineAccel * mods.topSpeed * mods.accel;
  if (throttle === -1) {
    return forward > DRIVE_CONFIG.reverseEpsilon
      ? -chassis.brakeDecel * mods.brakeDecel
      : -chassis.reverseAccel * mods.topSpeed * mods.accel;
  }
  return 0;
}

/**
 * The drag factor for this tick, with the `accel` channel applied as a POWER (U36).
 *
 * `exp(-k·m·dt)` is `exp(-k·dt)^m`, so this is exact. Multiplying `dragPerTick` by the modifier
 * instead would be a different function entirely — and at `mods.accel` of 0 it would stop the car
 * dead rather than remove its drag, which is precisely backwards.
 */
function dragFactorOf(chassis: ChassisDrive, mods: Readonly<Modifiers>): number {
  return mods.accel === 1 ? chassis.dragPerTick : Math.pow(chassis.dragPerTick, mods.accel);
}

/**
 * The lateral grip factor for this tick, with the `grip` channel applied the same way (spec §5).
 *
 * The channel is what separates a driver's drift from a victim's ride: `lateralGripRate` says how
 * loose the car is in a corner, and a status — `reeling` is the only one today — says how much of
 * that grip a car currently has. `grip: 0` degenerates to no grip at all, which is Unity's flag.
 */
function gripFactorOf(chassis: ChassisDrive, mods: Readonly<Modifiers>): number {
  return mods.grip === 1 ? chassis.gripPerTick : Math.pow(chassis.gripPerTick, mods.grip);
}

/** -1 once the car is genuinely travelling backwards and the flip is on. Unity's `YawRate` sense. */
function steerSenseOf(forward: number): number {
  return DRIVE_CONFIG.flipSteeringInReverse && forward < -DRIVE_CONFIG.reverseEpsilon ? -1 : 1;
}

/** Injected spin, decaying on its own while nothing holds the yaw. */
function nextSpinOf(angVel: number, chassis: ChassisDrive): number {
  const next = angVel * chassis.spinPerTick;
  return Math.abs(next) < RAM_CONFIG.spinEpsilon ? 0 : next;
}

/**
 * Exponential decay never reaches zero, so a car with no input would creep forever a hair above
 * rest. Only with the throttle neutral: a car held against a wall is not at rest, it is pushing.
 */
function atRest(forward: number, lateral: number, throttle: InputMessage["throttle"]): boolean {
  return throttle === 0 && Math.hypot(forward, lateral) < DRIVE_CONFIG.stopEpsilon;
}
```

Delete `nextForward`, `accelerateForward`, `brakeOrReverse`, `reverseFurther`, `coast`,
`bleedLateral`, `isMoving` and `nextAngVel`. In `stepHold`, steer at `chassis.turnRate` (there is no
at-rest rate any more) and replace `nextAngVel(body.angVel, steer)` with
`nextSpinOf(body.angVel, chassis)`; do the same in `stepDash`. Both branches also drop `reverseHold`
from their returned objects — Task 4 removes the field itself, so if TypeScript objects to the field
still being required, run Task 4 first and come back.

- [ ] **Step 5: Run the drive tests**

```bash
npm test -w @motor-combat-moba/shared -- drive-vector.test
```

Expected: PASS.

- [ ] **Step 6: Re-pin `drive.test.ts` and `golden.test.ts`**

`drive.test.ts` keeps every case whose behaviour still exists and deletes the rest:

- DELETE: the `reverseHoldTicks` gating cases, the `turnRateAtStop` cases, the coast half-life cases,
  the countersteer cases (steering no longer adds to a spin), and any case asserting the top-speed
  clamp.
- KEEP and re-pin: the maneuver-branch cases and the dash substep helpers, unchanged in intent.

`golden.test.ts`'s `GOLDEN_CHASSIS` becomes a literal of the new nine fields — keep it decoupled from
`CAR_TABLE`, which is the whole point of that suite:

```ts
const GOLDEN_CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 200,
  engineAccel: 200,
  reverseAccel: 80,
  brakeDecel: 500,
  turnRate: 2,
  dragRate: 1,
  dragPerTick: Math.exp(-1 / 30),
  gripPerTick: Math.exp(-7 / 30),
  spinPerTick: 1,
});
```

Run the suite, read the actual values off the failures, and paste them in — then **read each one and
write down why it is right**, the way the existing REFIXTURED paragraphs do. That file's contract is
that these numbers move only for a deliberate, understood change; this is one, and the comment is
what lets the next reader tell.

- [ ] **Step 7: Build shared and run the suite**

```bash
npm run build -w @motor-combat-moba/shared && npm test
```

Expected: the shared drive suites pass. Other suites still fail — Tasks 4–7 exist to fix them.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src
git commit -m "feat(drive): Unity drag, grip and turn model in stepDrive"
```

---

### Task 4: Remove `reverseHold`

**Files:**
- Modify: `packages/shared/src/sim/step.ts` (`SimBody`), `packages/shared/src/schema/PlayerState.ts:30`,
  `packages/server/src/sim/tick.ts:320,339`, `packages/client/src/net/prediction.ts`,
  `packages/client/src/net/interpolation.ts`, `packages/client/src/scenes/ArenaScene.ts:587,638`,
  `packages/server/playtest/prediction.ts:141-152`, `docs/schema-reference.md`, `docs/networking.md`
- Test: `packages/shared/src/schema/schema.test.ts`, `packages/client/src/net/prediction.test.ts`,
  `packages/client/src/net/interpolation.test.ts`, `packages/shared/src/sim/collide.test.ts:181`

**Interfaces:**
- Consumes: Task 3's `stepDrive`, which no longer writes the field.
- Produces: a `SimBody` and `PlayerState` with no `reverseHold`.

- [ ] **Step 1: Delete the field at its source**

Remove `reverseHold` from `SimBody` in `step.ts` and the `@type("uint16") reverseHold` line from
`PlayerState.ts`.

- [ ] **Step 2: Let the compiler find every reader**

```bash
npm run build
```

Expected: FAIL, naming each site. Work the list: `bodyOf`/`writeBody` in `server/src/sim/tick.ts`,
the client's `prediction.ts` snap and ease paths, `interpolation.ts`, `ArenaScene.ts`'s pose struct,
and `playtest/prediction.ts`'s field-by-field body. Delete the field at each; change nothing else.

- [ ] **Step 3: Update the tests that pin it**

`schema.test.ts` drops it from its round-trip; `prediction.test.ts` drops it from the snap and ease
assertions; `interpolation.test.ts` drops it from its fixtures; `collide.test.ts:181` ("carries
`reverseHold` through") is deleted outright — there is no field left to carry.

- [ ] **Step 4: Update the two docs**

In `docs/schema-reference.md`, delete the `reverseHold` row and add one line to the change notes:
"`reverseHold` was removed by the 2026-09-18 Unity drive port: reverse engages at
`DRIVE_CONFIG.reverseEpsilon` with no hold delay, so the field had no reader." In
`docs/networking.md`, remove it from the reconciliation list.

- [ ] **Step 5: Verify**

```bash
npm run build && npm test
grep -rn "reverseHold" packages docs --include=*.ts --include=*.md | grep -v superpowers
```

Expected: no compile errors; the grep returns nothing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(sim): remove reverseHold — reverse engages at reverseEpsilon now"
```

---

### Task 5: The bot's observation modifiers

**Files:**
- Modify: `packages/server/src/bot/brain/predict.ts:120-215`, `packages/server/src/config/bot-profiles.ts`
  (only if `observationTopSpeedHeadroom` is left unused), and wherever `BOT_BRAIN_VERSION` is declared
- Test: `packages/server/src/bot/brain/predict.test.ts`

**Interfaces:**
- Consumes: Task 3's `stepDrive`.
- Produces: `OBSERVATION_MODIFIERS` without `topSpeed`; `BOT_BRAIN_VERSION` at `"6.0.0"`.

- [ ] **Step 1: Write the failing test**

Add to `predict.test.ts`, reusing that file's existing rollout helpers and their call shapes:

```ts
it("rolls an observed car at the speed it was seen at", () => {
  const seen = 150;
  // Build the observation body the file's other cases build, at `seen` u/s on a zero heading.
  const rolled = rollForward(bodyAtSpeed(seen), { steer: 0, throttle: 1 }, 45, "mirage");
  expect(speedOf(rolled.vx, rolled.vy)).toBeCloseTo(seen, 6);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w @motor-combat-moba/server -- predict.test
```

Expected: FAIL — the rollout drifts off the observed speed while the old `topSpeed` headroom is in
the set.

- [ ] **Step 3: Rewrite the set and its argument**

```ts
/**
 * How an OBSERVED car is rolled forward: hold the speed and the turn it was seen at.
 *
 * Under the Unity drive model this needs exactly one channel. `accel: 0` scales BOTH the engine push
 * and the drag rate (spec U18), and drag is applied as `dragPerTick ** mods.accel`, so a rollout
 * with the throttle held adds nothing and sheds nothing: the observed speed is carried exactly. Grip
 * still runs, so a car seen sliding is rolled the way it will really travel.
 *
 * `brakeDecel: 0` is kept as a guard rather than a live term: no production predictor passes
 * `throttle: -1`, and the engine-command table gives the brake no other path.
 *
 * There is no `topSpeed` entry any more. It existed to lift the drive model's speed CLAMP out of
 * reach, and the clamp is gone — top speed is where push and drag balance, so nothing clips a
 * rollout that starts above it.
 *
 * It exists because a bot cannot see another car's throttle. Rolling every observed target with the
 * engine on assumes each is flooring it, which systematically over-leads; assuming a reversing car
 * is braking under-leads by more. Holding what was seen is also the honest statement of what a human
 * reads off the screen.
 */
export const OBSERVATION_MODIFIERS: Readonly<Modifiers> = Object.freeze({
  ...NEUTRAL_MODIFIERS,
  accel: 0,
  brakeDecel: 0,
});
```

Delete the ~60 lines of superseded derivation above it, **including the measured error table**: every
figure in it was taken on a model that no longer exists, and a table of wrong numbers is worse than
none. If `BRAIN_CONSTANTS.observationTopSpeedHeadroom` has no other reader, delete it too.

- [ ] **Step 4: Bump the brain version**

```bash
grep -rn "BOT_BRAIN_VERSION" packages/server/src | head -3
```

Set it to `"6.0.0"`, with: "6.0.0 — the 2026-09-18 Unity drive port. Behaviour moved without
`BOT_PROFILES` moving, so balance reports across this line are not comparable."

- [ ] **Step 5: Run the bot suites and record the damage**

```bash
npm test -w @motor-combat-moba/server -- bot
```

Expected: the three already-red tests stay red. Note every test that moved and **put the numbers in
the commit message**. Do not re-pin a threshold to make one pass — stage 5's `bot-tuner` pass owns
that.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src
git commit -m "refactor(bot): observation modifiers under the Unity drive model"
```

---

### Task 6: Delete the superseded knobs and rename the resolvers

**Files:**
- Modify: `packages/shared/src/config/drive-config.ts`, `packages/shared/src/config/car-config.ts`,
  `packages/shared/src/config/types.ts` (`CarDef`), `packages/shared/src/index.ts`,
  `packages/client/src/ui/car-select-view.ts`, `scripts/build-cars-and-weapons.mjs:44-54,644-650`
- Test: `packages/shared/src/config/config.test.ts`,
  `packages/shared/src/config/tuning-walker.test.ts`,
  `packages/client/src/ui/car-select-view.test.ts`

**Interfaces:**
- Consumes: Task 3's resolvers.
- Produces: a `DRIVE_CONFIG` and `CarDef` with no superseded fields.

- [ ] **Step 1: Delete the knobs and retune the three pairs**

From `DRIVE_CONFIG`: `steeringGrip`, `impactGripDecel`, `stopTurnRatio`, `baseAccel`,
`accelPerRating`, `reverseSpeedRatio`, `reverseHoldTicks`. From `CarDef` and all nine `CAR_TABLE`
rows: `coastHalfLifeSeconds`. In the same edit: `baseTurnRate` 3.6 → **0.667**, `turnRatePerRating`
0.054 → **0.0169**, `reverseAccelFactor` 0.6 → **0.4**, each with a doc comment recording the old
value, the new one, and why (spec §9.2).

- [ ] **Step 2: Let the compiler find the readers**

```bash
npm run build
```

Fix each: `index.ts`'s export list (`accelOf` → `dragRateOf`, add `engineAccelOf`, drop
`reverseMaxSpeedOf` and `turnRateAtStopOf`), and `car-select-view.ts`'s stat rows — Acceleration
reads `engineAccelOf`, Reverse speed reads `forwardMaxSpeedOf(id) * DRIVE_CONFIG.reverseAccelFactor`,
Turn radius keeps `forwardMaxSpeedOf / turnRateOf`.

- [ ] **Step 3: Fix the guide builder by hand — the compiler cannot**

`scripts/build-cars-and-weapons.mjs` is not typechecked, so a missed rename ships as `NaN` on the
players' guide. Update its imports and its three derived cells: top speed, "s to top"
(`forwardMaxSpeedOf / engineAccelOf`) and turn radius. Then prove it:

```bash
npm run build -w @motor-combat-moba/shared && npm run build:manual
grep -c "NaN" packages/client/public/manual.html
```

Expected: `0`.

- [ ] **Step 4: Update the config tests**

In `config.test.ts`, delete the rating-50 anchor for `accelOf` and the `stopTurnRatio`,
`reverseSpeedRatio`, `steeringGrip`, `impactGripDecel` and `coastPerTick` cases, then add:

```ts
it("drifts rather than cornering on rails: grip is finite against the sharpest turn", () => {
  // Slip angle at full lock is atan(turnRate / lateralGripRate), the same at any speed. A grip rate
  // high enough to drive that to ~0 would be the deleted `steeringGrip: 1` under another name (U3).
  // This can only be asserted once the turn rates above are the ported ones — see Task 1.
  const sharpest = DRIVE_CONFIG.baseTurnRate + 100 * DRIVE_CONFIG.turnRatePerRating;
  const slipDeg = (Math.atan(sharpest / DRIVE_CONFIG.lateralGripRate) * 180) / Math.PI;
  expect(slipDeg).toBeGreaterThan(5);
  expect(slipDeg).toBeLessThan(45);
});

it("anchors the new pairs at rating 50", () => {
  expect(DRIVE_CONFIG.baseTurnRate + 50 * DRIVE_CONFIG.turnRatePerRating).toBeCloseTo(1.512, 3);
  expect(DRIVE_CONFIG.baseDrag + 50 * DRIVE_CONFIG.dragPerRating).toBeCloseTo(1.072, 3);
});

it("keeps the brake ahead of drag at top speed for every chassis", () => {
  for (const id of activeCarIds()) {
    const d = driveOf(id);
    // Drag's strongest pull, in u/s², is `dragRate * maxSpeed` — at the ceiling.
    expect(d.brakeDecel).toBeGreaterThan(d.dragRate * d.maxSpeed);
  }
});

it("derives top speed as the balance point of push and drag", () => {
  for (const id of activeCarIds()) {
    const d = driveOf(id);
    expect(d.engineAccel / d.dragRate).toBeCloseTo(d.maxSpeed, 9);
  }
});
```

In `tuning-walker.test.ts`, update the emitted-path expectations for the deleted and added `drive.*`
keys. In `car-select-view.test.ts`, point the Acceleration and Reverse speed rows at the new
expressions.

- [ ] **Step 5: Verify**

```bash
npm run build && npm test
```

Expected: green except `scripts/turn-tuning-doc.test.mjs` (Task 7) and the three already-red bot
tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(drive): delete the superseded knobs, rename accelOf to dragRateOf"
```

---

### Task 7: `docs/turn-tuning.md` and its parser test

**Files:**
- Modify: `docs/turn-tuning.md`, `scripts/turn-tuning-doc.test.mjs`

**Interfaces:**
- Consumes: Task 6's config.
- Produces: a page whose tables the test recomputes clean.

The test selects a table by its header label and compares rows by **ordered equality**, so page and
test move together or the suite fails.

- [ ] **Step 1: Update the test's expectations**

- Per-car direct values (header `Value`): drop the `coastHalfLifeSeconds` row, keep `brakeDecel`, add
  `dragRate — drag (1/s)` reading `driveOf(id).dragRate`.
- Global knobs (header `Knob`): drop `stopTurnRatio` and `reverseSpeedRatio`; add `baseDrag`,
  `dragPerRating`, `lateralGripRate`, `reverseAccelFactor`, `reverseEpsilon`.
- Derived (header `Stat`, matched positionally): drop `Turn rate at rest`, its degrees row,
  `180° from standstill` and `Rate while reeling`; add `Engine push` (`d.engineAccel`),
  `Time to 90% of top speed` (`Math.log(10) / d.dragRate`), `Roll distance from top speed`
  (`d.maxSpeed / d.dragRate`) and `Slip angle at full lock`
  (`Math.atan(d.turnRate / DRIVE_CONFIG.lateralGripRate)` in degrees). `Reverse top speed` now reads
  `d.maxSpeed * DRIVE_CONFIG.reverseAccelFactor`.
- Delete the `reelingTurnRate()` helper: `reeling` carries no `turnRate` multiplier after stage 3.

- [ ] **Step 2: Rewrite the four tables on the page**

Regenerate every derived cell rather than typing it, and update the page's own "Keeping this page
honest" snippet to the new field names in the same edit:

```bash
node -e "import('./packages/shared/dist/index.js').then(({CAR_TABLE,DRIVE_CONFIG,driveOf})=>{for(const id of Object.keys(CAR_TABLE)){const d=driveOf(id);console.log(id,d.maxSpeed.toFixed(2),d.engineAccel.toFixed(2),d.dragRate.toFixed(4),(Math.log(10)/d.dragRate).toFixed(2),(d.maxSpeed/d.dragRate).toFixed(1),(Math.atan(d.turnRate/DRIVE_CONFIG.lateralGripRate)*180/Math.PI).toFixed(1));}})"
```

- [ ] **Step 3: Fix the prose the test cannot see**

Reread and correct: the turn-radius paragraphs and the "1.5 u band" claim, the time-to-top-speed
history, the `steeringGrip`/`impactGripDecel` paragraph, and the whole **"What is *not* a knob"**
section — it asserts that no grip or traction value exists for cornering, which this stage makes
false. Replace that section with a short one naming `lateralGripRate` as the drift knob and giving
the slip-angle formula.

- [ ] **Step 4: Verify**

```bash
node --test scripts/turn-tuning-doc.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/turn-tuning.md scripts/turn-tuning-doc.test.mjs
git commit -m "docs(turn-tuning): retabulate against the Unity drive model"
```

---

### Task 8: Tick-rate independence, and the stage's exit

**Files:**
- Create: `packages/shared/src/sim/drive-rate.test.ts`
- Modify: `packages/client/public/manual.html` (generated), `EXECUTION.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the proof that U7 holds.

- [ ] **Step 1: Write the equivalence test**

```ts
import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { ChassisDrive } from "../config/car-config.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import { stepDrive } from "./drive.js";
import { speedOf } from "./velocity.js";

/** The same chassis resolved at an arbitrary tick rate — exactly what `resolveChassisDrive` does. */
function chassisAt(hz: number): ChassisDrive {
  const dragRate = 1.0;
  return {
    maxSpeed: 200, engineAccel: 200, reverseAccel: 80, brakeDecel: 500, turnRate: 2,
    dragRate,
    dragPerTick: Math.exp(-dragRate / hz),
    gripPerTick: Math.exp(-DRIVE_CONFIG.lateralGripRate / hz),
    spinPerTick: 1,
  };
}

function run(hz: number, ticks: number) {
  let b = {
    x: 0, y: 0, angle: 0, vx: 0, vy: 0, angVel: 0,
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
  };
  for (let i = 0; i < ticks; i++) {
    b = stepDrive(b, { steer: 1, throttle: 1, fireSlots: 0 }, 1 / hz, chassisAt(hz), NEUTRAL_MODIFIERS);
  }
  return b;
}

describe("the drive model is tick-rate independent", () => {
  it("puts a car in the same place after one second at 30 Hz and at 60 Hz", () => {
    const slow = run(30, 30);
    const fast = run(60, 60);
    // Euler integration is not exact, so this is a tolerance, not an equality: a car covering ~180
    // units in that second must land within a tenth of a hull length of itself.
    expect(Math.hypot(fast.x - slow.x, fast.y - slow.y)).toBeLessThan(DRIVE_CONFIG.carWidth / 10);
    expect(fast.angle).toBeCloseTo(slow.angle, 6);
    expect(speedOf(fast.vx, fast.vy)).toBeCloseTo(speedOf(slow.vx, slow.vy), 0);
  });
});
```

Match the `InputMessage` literal and the `SimBody` literal to whatever those types require at the
time — the point of the test is the two rates, not the field list.

- [ ] **Step 2: Run it**

```bash
npm test -w @motor-combat-moba/shared -- drive-rate.test
```

Expected: PASS. If it fails, a per-tick factor is being typed somewhere instead of derived — find it
rather than widening the tolerance.

- [ ] **Step 3: Rebuild the players' guide**

`DRIVE_CONFIG` and `CAR_TABLE` both feed `balanceStamp`.

```bash
npm run build -w @motor-combat-moba/shared && npm run build:manual
```

- [ ] **Step 4: Full verification**

```bash
npm install
npm run build
npm test
grep -n "shared/dist" packages/server/dist/index.js | head -3
```

Expected: build green; `npm test` green except the three already-red bot tests; the inlined path
reads `// ../shared/dist/…`, not an escaped worktree path.

- [ ] **Step 5: Commit and update the tracker**

```bash
git add -A
git commit -m "test(drive): pin tick-rate independence; rebuild the guide"
```

Update [`EXECUTION.md`](EXECUTION.md) **in this same commit**: stage 1 row to **Landed**, the measured
figures (time to 90% of top speed and roll distance per chassis, the slip angle, the three bot tests'
readings), and which stage is next.

---

## Stage 1 exit criteria

- [ ] `npm run build` (root) succeeds and the server bundle inlines `// ../shared/dist/…`.
- [ ] `npm test` passes except the three bot tests that were already red, whose readings are recorded.
- [ ] `stepDrive` reads no module-level rate: every per-tick factor arrives on `ChassisDrive`.
- [ ] A car approaches its top speed asymptotically and never clamps to it.
- [ ] Holding full lock leaves a measurable slip angle matching `atan(turnRate / lateralGripRate)`.
- [ ] `docs/turn-tuning.md` recomputes clean, and its prose no longer claims cornering has no grip knob.
- [ ] `manual.html` is rebuilt and contains no `NaN`.
