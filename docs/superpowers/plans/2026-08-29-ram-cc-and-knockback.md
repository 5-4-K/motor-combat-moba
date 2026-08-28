# Ram CC and Knockback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ramming a real mechanic — a car that drives into another spins it, knocks it sideways, and degrades its steering — without changing the drive model, the collision resolver, or the `stepSim` signature.

**Architecture:** Four additive fields on `SimBody` (`angVel`, `shoveX`, `shoveY`, `authority`) that `stepDrive` adds to its existing integration rather than replacing any part of it, so a neutral knock state reproduces today's arithmetic exactly. A new server-only pass between driving and combat detects fresh car-vs-car contact, derives severity from the attacker's forward speed and mass, classifies which face was hit, and writes the knock onto the victim. Collision resolution keeps its single-body "only the body moves" contract; no impulse is exchanged anywhere.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared` / `server` / `client`), Colyseus schema, Vitest, Phaser 3.

**Spec:** [`../specs/2026-08-29-ram-cc-and-knockback-design.md`](../specs/2026-08-29-ram-cc-and-knockback-design.md) — decisions are referenced as R1–R20 throughout.

## Global Constraints

- **`stepSim` keeps its signature.** `stepSim(body, input, dt, ctx) -> SimBody`. Never change it. (Spec constraint 2)
- **Existing assertions never change.** No `expect(...)` in `drive.test.ts` or `collide.test.ts` may be edited or deleted. Their *fixture constructors* (`rest()`, `body()`) gain the four new fields at neutral values, and nothing else in those files moves. Task 1 pins this with golden values captured from the current code. (Spec constraint 3, refined — the spec's blanket "no existing test may be modified" is impossible once `SimBody` gains required fields.)
- **Neutral state is `angVel: 0, shoveX: 0, shoveY: 0, authority: 1`.** Note `authority` is 1, not 0. (R10, R20)
- **Ram deals zero hp.** Nothing in this plan calls `applyDamage` or touches `sim/damage.ts`. (R1)
- **No magic numbers in logic.** Every constant lives in `config/ram-config.ts`. Derived values are computed, never typed. (`CLAUDE.md` invariant 2)
- **Anything `stepSim` reads is a networked schema field.** All four new fields go on `PlayerState`. (`CLAUDE.md` invariant 8)
- **`TICK_RATE_HZ` stays 30** and is imported from shared, never re-spelled. (`CLAUDE.md` invariant 1)
- **Rebuild shared after editing it.** `npm run build -w @motor-combat-moba/shared`. Server and client consume built `dist`, not `src`. Root `npm test` does this for you; a bare workspace test does not.
- **Contact normal convention:** `n` points from `b` toward `a`. (R3)
- Run the full suite with `npm test` from the repo root. Baseline before any of this work: **766 tests passing** (275 shared, 84 server, 407 client).

---

## Task 1: Golden characterization tests

Pins the *current* behaviour of `stepDrive` and `resolveWorld` with exact numbers, captured by running the code as it stands today. This is the safety net for the whole plan: every later task must leave these passing untouched. No production code changes in this task.

**Files:**
- Create: `packages/shared/src/sim/golden.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. Later tasks rely on this file continuing to pass unmodified.

- [ ] **Step 1: Write the golden test**

Create `packages/shared/src/sim/golden.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { InputMessage } from "../net/input.js";
import { resolveWorld } from "./collide.js";
import { stepDrive } from "./drive.js";
import type { SimBody } from "./step.js";

/**
 * Behaviour frozen from the implementation as it stood on 2026-08-29, before ram CC was added.
 *
 * The ram work adds `angVel`, `shoveX`, `shoveY`, and `authority` to `SimBody` as terms that are
 * ADDED to the existing integration, never substituted into it. At neutral state those terms
 * contribute exactly zero, so every number below must survive the change untouched. If one of these
 * moves, the additive property has been broken and the change is wrong — do not re-record them.
 *
 * Only the `body()` fixture below may gain the new fields (at neutral values). No expectation here
 * may be edited.
 */
const DT = 1 / 30;
const CAR_ID = "rectangle";

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function body(over: Partial<SimBody> = {}): SimBody {
  return { x: 0, y: 0, angle: 0, speed: 0, reverseHold: 0, ...over };
}

function drive(start: SimBody, msg: InputMessage, ticks: number): SimBody {
  let next = start;
  for (let i = 0; i < ticks; i++) next = stepDrive(next, msg, DT, CAR_ID);
  return next;
}

function expectPose(actual: SimBody, x: number, y: number, angle: number, speed: number): void {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
  expect(actual.angle).toBeCloseTo(angle, 9);
  expect(actual.speed).toBeCloseTo(speed, 9);
}

describe("golden: stepDrive is unchanged by the ram work", () => {
  it("accelerates straight for 10 ticks", () => {
    expectPose(drive(body(), input(0, 1), 10), 47.6666666667, 0, 0, 260);
  });

  it("accelerates while turning right for 10 ticks", () => {
    expectPose(drive(body(), input(1, 1), 10), 27.434465046, 35.5795364692, 1.33, 260);
  });

  it("turns left under throttle for 25 ticks, capped at top speed", () => {
    expectPose(drive(body(), input(-1, 1), 25), -131.5066473051, -136.8263554597, -3.43, 540);
  });

  it("coasts from 300 for 8 ticks", () => {
    expectPose(drive(body({ speed: 300 }), input(0, 0), 8), 44, 0, 0, 60);
  });

  it("brakes from 300 to rest in 6 ticks", () => {
    expectPose(drive(body({ speed: 300 }), input(0, -1), 6), 23.3333333333, 0, 0, 0);
  });

  it("engages reverse from rest after the hold delay", () => {
    const out = drive(body(), input(0, -1), 12);
    expectPose(out, -78.4, 0, 0, -351);
    expect(out.reverseHold).toBe(2);
  });

  it("accelerates and turns from a non-zero heading", () => {
    expectPose(drive(body({ angle: 0.7 }), input(1, 1), 15), -45.2471561479, 79.1894268095, 2.73, 390);
  });
});

describe("golden: resolveWorld is unchanged by the ram work", () => {
  const bounds = { width: 1000, height: 800 };

  it("bounces off the left wall", () => {
    const out = resolveWorld(body({ x: 10, y: 400, speed: 200, angle: Math.PI }), [], [], bounds);
    expectPose(out, 24, 400, Math.PI, -70);
  });

  it("reflects off both walls at a corner", () => {
    const out = resolveWorld(body({ x: 5, y: 4, speed: 150, angle: Math.PI * 1.25 }), [], [], bounds);
    expectPose(out, 28.2842712475, 28.2842712475, 3.926990817, 84.1875);
  });

  it("separates from another car", () => {
    const other = { x: 530, y: 400, angle: 0, w: 48, h: 32 };
    const out = resolveWorld(body({ x: 500, y: 400, speed: 250, angle: 0 }), [other], [], bounds);
    expectPose(out, 482, 400, 0, -87.5);
  });

  it("separates from an obstacle", () => {
    const obstacle = { x: 320, y: 290, w: 60, h: 60 };
    const out = resolveWorld(body({ x: 300, y: 300, speed: 180, angle: 0.4 }), [], [obstacle], bounds);
    expectPose(out, 291.663842667, 300, 0.4, -90.997064641);
  });

  it("leaves a free body untouched", () => {
    const out = resolveWorld(body({ x: 500, y: 400, speed: 100, angle: 1.1 }), [], [], bounds);
    expectPose(out, 500, 400, 1.1, 100);
  });
});
```

- [ ] **Step 2: Run the golden tests and verify they PASS against current code**

```bash
npm test -w @motor-combat-moba/shared
```

Expected: PASS. These describe code that already exists, so a failure here means the values were mistranscribed — fix the values, not the code.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/sim/golden.test.ts
git commit -m "test(shared): pin drive and collide behaviour before the ram work"
```

---

## Task 2: Ram config and the mass rating

Adds every tunable constant and the fourth car rating. Pure configuration — no simulation behaviour changes, and no existing behaviour moves.

**Files:**
- Create: `packages/shared/src/config/ram-config.ts`
- Create: `packages/shared/src/config/ram-config.test.ts`
- Modify: `packages/shared/src/config/types.ts` (`CarDef` gains `mass`)
- Modify: `packages/shared/src/config/car-config.ts` (`mass` on every row, `massOf`, `RAM_REFERENCE_MASS`, `RAM_REFERENCE`)
- Modify: `packages/shared/src/config/config.test.ts` (delete the 150 budget assertion, extend range checks)
- Modify: `packages/shared/src/index.ts` (exports)

**Interfaces:**
- Produces:
  - `RAM_CONFIG` — frozen object of raw knobs (see Step 1 for every key).
  - `halfLifeToPerTick(halfLifeSeconds: number): number`
  - `RAM_DECAY: { spin: number; shove: number; authority: number; counterSteer: number }` — per-tick multipliers derived at module load.
  - `massOf(id: CarId): number`
  - `RAM_REFERENCE_MASS: number` (500) and `RAM_REFERENCE: number` (270000)
  - `CarDef.mass: number`

- [ ] **Step 1: Write the failing config test**

Create `packages/shared/src/config/ram-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { CAR_TABLE, RAM_REFERENCE, RAM_REFERENCE_MASS, forwardMaxSpeedOf, massOf } from "./car-config.js";
import { RAM_CONFIG, RAM_DECAY, halfLifeToPerTick } from "./ram-config.js";
import type { CarId } from "./types.js";

describe("halfLifeToPerTick", () => {
  it("halves the value after exactly one half-life of ticks", () => {
    const perTick = halfLifeToPerTick(0.5);
    const ticks = 0.5 * TICK_RATE_HZ;
    expect(perTick ** ticks).toBeCloseTo(0.5, 12);
  });

  it("is tick-rate independent: the same wall-clock half-life survives a rate change", () => {
    // Authored in seconds precisely so a future move to 60 Hz does not halve every recovery time.
    expect(halfLifeToPerTick(0.25) ** (0.25 * TICK_RATE_HZ)).toBeCloseTo(0.5, 12);
  });

  it("returns 0 for a non-positive or non-finite half-life rather than NaN", () => {
    expect(halfLifeToPerTick(0)).toBe(0);
    expect(halfLifeToPerTick(-1)).toBe(0);
    expect(halfLifeToPerTick(Number.NaN)).toBe(0);
  });

  it("never returns a multiplier at or above 1, which would make a knock permanent", () => {
    for (const hl of [0.05, 0.15, 0.25, 0.35, 2]) {
      expect(halfLifeToPerTick(hl)).toBeGreaterThan(0);
      expect(halfLifeToPerTick(hl)).toBeLessThan(1);
    }
  });
});

describe("RAM_CONFIG", () => {
  it("pins the authored knobs", () => {
    expect(RAM_CONFIG.contactPad).toBe(1);
    expect(RAM_CONFIG.minApproachSpeed).toBe(60);
    expect(RAM_CONFIG.bonusFront).toBe(0.3);
    expect(RAM_CONFIG.bonusFlank).toBe(1.0);
    expect(RAM_CONFIG.bonusRear).toBe(1.3);
    expect(RAM_CONFIG.authorityFloor).toBe(0.35);
    expect(RAM_CONFIG.knockMaxSpeed).toBe(260);
    expect(RAM_CONFIG.massPerRating).toBe(10);
  });

  it("orders the side bonuses front < flank < rear, which is the whole positional read", () => {
    expect(RAM_CONFIG.bonusFront).toBeLessThan(RAM_CONFIG.bonusFlank);
    expect(RAM_CONFIG.bonusFlank).toBeLessThan(RAM_CONFIG.bonusRear);
  });

  it("keeps the authority floor a real floor", () => {
    expect(RAM_CONFIG.authorityFloor).toBeGreaterThan(0);
    expect(RAM_CONFIG.authorityFloor).toBeLessThan(1);
  });

  it("clamps victim mass factor around 1", () => {
    expect(RAM_CONFIG.massFactorMin).toBeLessThan(1);
    expect(RAM_CONFIG.massFactorMax).toBeGreaterThan(1);
  });

  it("derives inertiaCoefficient from the hull, never typed", () => {
    expect(RAM_CONFIG.inertiaCoefficient).toBeCloseTo((48 ** 2 + 32 ** 2) / 12, 9);
  });

  it("bleeds spin faster when countersteering than when coasting", () => {
    expect(RAM_DECAY.counterSteer).toBeLessThan(RAM_DECAY.spin);
  });
});

describe("mass rating", () => {
  it("gives every chassis an integer 0-100 mass", () => {
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const { mass } = CAR_TABLE[id];
      expect(Number.isInteger(mass)).toBe(true);
      expect(mass).toBeGreaterThanOrEqual(0);
      expect(mass).toBeLessThanOrEqual(100);
    }
  });

  it("scales ratings to real mass via massPerRating", () => {
    expect(massOf("rectangle")).toBe(350);
    expect(massOf("oval")).toBe(450);
    expect(massOf("hexagon")).toBe(850);
  });

  it("makes the tank the heaviest and the speedster the lightest", () => {
    expect(massOf("hexagon")).toBeGreaterThan(massOf("oval"));
    expect(massOf("oval")).toBeGreaterThan(massOf("rectangle"));
  });

  it("derives the ram reference from an average chassis at the roster's top speed", () => {
    expect(RAM_REFERENCE_MASS).toBe(500);
    expect(RAM_REFERENCE).toBe(RAM_REFERENCE_MASS * forwardMaxSpeedOf("rectangle"));
    expect(RAM_REFERENCE).toBe(270000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -w @motor-combat-moba/shared -- src/config/ram-config.test.ts
```

Expected: FAIL — `Cannot find module './ram-config.js'`.

- [ ] **Step 3: Create the ram config**

Create `packages/shared/src/config/ram-config.ts`:

```ts
import { TICK_RATE_HZ } from "../constants.js";
import { DRIVE_CONFIG } from "./drive-config.js";

/**
 * Ram control-and-knockback tuning. Every value here is read by the sim, so server tick and client
 * prediction both depend on them agreeing — this is networked balance, not render preference.
 *
 * **Decays are authored as half-lives in SECONDS, never as per-tick multipliers.** The design this
 * implements was written against a 60 Hz sim and this project runs at 30; a per-tick decay copied
 * across unchanged would silently halve every recovery time. Authoring in seconds and converting
 * once, here, makes the table tick-rate independent. Same principle as `weapon-ticks.ts` converting
 * authored milliseconds to ticks exactly once at module load.
 *
 * `massPerRating` lives here rather than in `COMBAT_CONFIG` because mass affects ramming and nothing
 * else — never acceleration, never top speed. That is deliberate: a force-based drive would make
 * heavy imply sluggish and collapse the roster to one axis, so mass stays out of the drive model
 * entirely and exists only as combat identity.
 */
export const RAM_CONFIG = {
  /**
   * World units each hull is inflated by when testing for ram contact.
   *
   * A ram must be detected as contact, not interpenetration: `resolveWorld` runs first and pushes
   * cars out to *exactly* the separation boundary, and SAT treats "just touching" as separated. A
   * strict overlap test is therefore false on every tick of a real ram. Kept small — cars rebound to
   * a 2-8 unit gap on following ticks, and a pad reaching those would fire on near-misses.
   */
  contactPad: 1,
  /**
   * Below this closing speed along the attacker's nose, a contact is a nudge and no ram is written.
   * About 11% of the roster's top speed. This is also what stops a pair chattering in and out of
   * contact from re-triggering: after impact the attacker has already been rebounded to roughly
   * -35% of its impact speed by `applyContact`, so its approach term is negative.
   */
  minApproachSpeed: 60,
  /** Rating-to-mass scale, mirroring `COMBAT_CONFIG.hpPerRating`. Ratings are 0-100. */
  massPerRating: 10,

  /**
   * The positional read, and the single most important balance lever in the feature. Front is cheap
   * so head-on ramming is deliberately not the play; rear is dear so getting behind someone pays.
   */
  bonusFront: 0.3,
  bonusFlank: 1.0,
  bonusRear: 1.3,

  /** Steering multiplier at maximum severity. The feel dial: too low and the victim is a passenger. */
  authorityFloor: 0.35,
  /** Peak knock impulse (expressed as a speed) at severity 1.0, before the victim mass factor. */
  knockMaxSpeed: 260,
  /** Bounds on `referenceMass / victimMass`, so neither the heaviest nor the lightest car degenerates. */
  massFactorMin: 0.6,
  massFactorMax: 1.6,
  /** Calibration multiplier on the torque-derived spin rate. Tuned by feel, not derived. */
  spinScale: 1.0,
  /** Ceiling on injected spin, so a corner contact cannot produce an absurd rotation. */
  spinMaxRate: 6.0,
  /**
   * Rotational inertia per unit mass for the car hull, `(len^2 + wid^2) / 12`. Derived from the hull
   * so it cannot drift out of step with `carHullOf`.
   */
  inertiaCoefficient: (DRIVE_CONFIG.carWidth ** 2 + DRIVE_CONFIG.carHeight ** 2) / 12,

  /** Injected spin halves this often while the player is not fighting it. */
  spinHalfLifeSeconds: 0.35,
  /** Lateral knock halves this often. */
  shoveHalfLifeSeconds: 0.25,
  /** The gap between current authority and full control halves this often. */
  authorityHalfLifeSeconds: 0.3,
  /**
   * Spin half-life while the player steers AGAINST it. Shorter than `spinHalfLifeSeconds` on
   * purpose: without this, steering only offsets the visible rotation and recovery time is fixed by
   * decay alone, so skill cannot shorten a spin. This one constant is what makes countersteering a
   * skill rather than a cosmetic.
   */
  counterSteerHalfLifeSeconds: 0.15,

  /** Below these magnitudes a knock snaps to exact rest, as `stopEpsilon` does for `speed`. */
  spinEpsilon: 0.01,
  shoveEpsilon: 1,
  authorityEpsilon: 0.01,
} as const;

/**
 * A half-life in seconds to the per-tick multiplier that realises it. `0` for a non-positive or
 * non-finite input, so a bad config value produces a knock that vanishes immediately rather than one
 * that NaNs the whole body and never recovers.
 */
export function halfLifeToPerTick(halfLifeSeconds: number): number {
  if (!Number.isFinite(halfLifeSeconds) || halfLifeSeconds <= 0) return 0;
  return 0.5 ** (1 / (halfLifeSeconds * TICK_RATE_HZ));
}

/**
 * The per-tick multipliers, derived once at module load and frozen. Server and client both import
 * shared's built `dist`, so both compute identical decays or neither does.
 */
export const RAM_DECAY = Object.freeze({
  spin: halfLifeToPerTick(RAM_CONFIG.spinHalfLifeSeconds),
  shove: halfLifeToPerTick(RAM_CONFIG.shoveHalfLifeSeconds),
  authority: halfLifeToPerTick(RAM_CONFIG.authorityHalfLifeSeconds),
  counterSteer: halfLifeToPerTick(RAM_CONFIG.counterSteerHalfLifeSeconds),
});
```

- [ ] **Step 4: Add `mass` to the car definition type**

In `packages/shared/src/config/types.ts`, add `mass` to `CarDef` immediately after `hp`:

```ts
export interface CarDef {
  id: CarId;
  name: string;
  speed: number;
  attack: number;
  hp: number;
  /**
   * Ram weight, 0-100. Affects ramming and NOTHING else — never acceleration, never top speed.
   * Scaled to real mass by `RAM_CONFIG.massPerRating`.
   */
  mass: number;
  /** Ordered loadout: index 0 is slot 1. Order IS the slot mapping. */
  weapons: readonly WeaponId[];
}
```

- [ ] **Step 5: Add mass to the roster and the derived reference**

In `packages/shared/src/config/car-config.ts`, add the `RAM_CONFIG` import, put `mass` on every row, and append the two helpers.

Replace the import block and `CAR_TABLE` doc comment plus rows:

```ts
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { RAM_CONFIG } from "./ram-config.js";
import type { CarDef, CarId } from "./types.js";

/**
 * The roster. Every rating is an integer 0-100 with 50 as average.
 *
 * Ratings used to be held to a 150-point budget across speed/attack/hp, which was the roster's only
 * automatic guard against a fourth chassis being authored strictly better than these three. That
 * budget was deliberately removed on 2026-08-29 so `mass` could be a free-floating fourth axis, and
 * no replacement guard was adopted. Roster fairness is a review-time judgement from here on.
 *
 * `attack` is not damage. It is a percentage modifier on whatever weapon the car is firing, applied
 * by `damageFor` (`sim/damage.ts`): 0.5x at rating 0, 1.0x at 50, 1.5x at 100.
 *
 * `mass` is not durability. It scales how hard this chassis rams and how easily it is rammed, and it
 * touches nothing else — see `RAM_CONFIG.massPerRating`.
 */
export const CAR_TABLE = {
  rectangle: { id: "rectangle", name: "Rectangle", speed: 80, attack: 30, hp: 40, mass: 35, weapons: ["fireball"] },
  oval: { id: "oval", name: "Oval", speed: 50, attack: 70, hp: 30, mass: 45, weapons: ["fireball"] },
  hexagon: { id: "hexagon", name: "Hexagon", speed: 30, attack: 50, hp: 70, mass: 85, weapons: ["fireball"] },
} as const satisfies Record<CarId, CarDef>;
```

Then append to the end of the same file:

```ts
export function massOf(id: CarId): number {
  return CAR_TABLE[id].mass * RAM_CONFIG.massPerRating;
}

/**
 * The mass of a chassis rated exactly average. Ram severity is measured against this, so a rating of
 * 50 at top speed is the natural "1.0 severity" anchor rather than an arbitrary number.
 */
export const RAM_REFERENCE_MASS = 50 * RAM_CONFIG.massPerRating;

/**
 * The momentum that saturates ram severity: an average-mass chassis travelling at the roster's
 * highest top speed. Derived, never typed — raising `baseMaxSpeed` or a car's `speed` rating moves
 * this with it, so ram severity stays anchored to what a car can actually achieve.
 */
export const RAM_REFERENCE =
  RAM_REFERENCE_MASS *
  Math.max(...(Object.keys(CAR_TABLE) as CarId[]).map((id) => forwardMaxSpeedOf(id)));
```

- [ ] **Step 6: Delete the 150-point budget assertion**

In `packages/shared/src/config/config.test.ts`, replace the whole `it("spends exactly the 150-point budget...")` block with:

```ts
  it("gives every chassis whole 0-100 ratings on all four axes", () => {
    // The 150-point budget that used to be asserted here was removed on 2026-08-29 so that `mass`
    // could be a free-floating fourth rating. Nothing enforces roster fairness now; see CAR_TABLE.
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const def = CAR_TABLE[id];
      for (const rating of [def.speed, def.attack, def.hp, def.mass]) {
        expect(Number.isInteger(rating)).toBe(true);
        expect(rating).toBeGreaterThanOrEqual(0);
        expect(rating).toBeLessThanOrEqual(100);
      }
    }
  });
```

- [ ] **Step 7: Export the new surface**

In `packages/shared/src/index.ts`, find the line exporting from `./sim/damage.js` and add these lines immediately **above** it:

```ts
export { RAM_CONFIG, RAM_DECAY, halfLifeToPerTick } from "./config/ram-config.js";
export { RAM_REFERENCE, RAM_REFERENCE_MASS, massOf } from "./config/car-config.js";
```

If `car-config.js` already has an export line in this file, add the three new names to it instead of writing a second line.

- [ ] **Step 8: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS, with the new `ram-config.test.ts` cases green and the golden tests from Task 1 still green. `config.test.ts` now has one changed test and no deletions elsewhere.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/config packages/shared/src/index.ts
git commit -m "feat(shared): ram config and the mass rating

Adds RAM_CONFIG with decays authored as half-lives in seconds and converted
to per-tick multipliers once at load, so the table survives a tick-rate
change. mass becomes a fourth free-floating car rating; the 150-point budget
assertion is deleted with no replacement guard, per R18."
```

---

## Task 3: `SimBody` gains the four knock fields

Purely mechanical. Every site that constructs a `SimBody` learns to carry the new fields; nothing yet reads or writes them. The golden tests are the proof that behaviour has not moved.

Adding required fields to `SimBody` breaks compilation everywhere at once, so this cannot be split further.

**Files:**
- Modify: `packages/shared/src/sim/step.ts`
- Modify: `packages/shared/src/sim/drive.ts` (return literal only)
- Modify: `packages/shared/src/sim/collide.ts` (three return literals)
- Modify: `packages/shared/src/schema/PlayerState.ts`
- Modify: `packages/server/src/sim/tick.ts` (`bodyOf`, `writeBody`)
- Modify: `packages/client/src/net/prediction.ts` (`reconcile` target and eased return)
- Modify: `packages/client/src/net/interpolation.ts` (`push`)
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`bodyOf`)
- Modify: fixture constructors only, in `packages/shared/src/sim/golden.test.ts`, `drive.test.ts`, `collide.test.ts`, `step.test.ts`, `packages/server/src/sim/tick.test.ts`, `packages/client/src/net/prediction.test.ts`, `interpolation.test.ts`
- Modify: `packages/shared/src/schema/schema.test.ts`

**Interfaces:**
- Produces: `SimBody` with `angVel: number`, `shoveX: number`, `shoveY: number`, `authority: number`. Neutral state is `0, 0, 0, 1`.

- [ ] **Step 1: Write the failing schema-default test**

In `packages/shared/src/schema/schema.test.ts`, add inside the existing `PlayerState` describe block:

```ts
  it("defaults authority to 1, not 0 — a 0 default would mean an undriveable car", () => {
    const p = new PlayerState();
    expect(p.authority).toBe(1);
    expect(p.angVel).toBe(0);
    expect(p.shoveX).toBe(0);
    expect(p.shoveY).toBe(0);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm test -w @motor-combat-moba/shared -- src/schema/schema.test.ts
```

Expected: FAIL — `Property 'authority' does not exist on type 'PlayerState'`.

- [ ] **Step 3: Add the fields to `SimBody`**

In `packages/shared/src/sim/step.ts`, replace the `SimBody` interface:

```ts
export interface SimBody {
  x: number;
  y: number;
  angle: number;
  speed: number;
  reverseHold: number;
  /**
   * Injected rotation, radians per second, decaying toward 0. Set only by a ram; steering is a
   * separate term and does not write here. Added to the steering rate rather than replacing it, so
   * `angVel: 0` reproduces the pre-ram drive model exactly.
   */
  angVel: number;
  /** Injected lateral knock, world units per second, decaying toward 0. Added to the drive velocity. */
  shoveX: number;
  shoveY: number;
  /**
   * Steering effectiveness, 1 = full control, decaying back UP toward 1. Scales the steer input only
   * — never throttle, so a knocked player can always drive their way out. Neutral is 1, not 0.
   */
  authority: number;
}
```

- [ ] **Step 4: Carry the fields through `drive.ts`**

In `packages/shared/src/sim/drive.ts`, replace the return of `stepDrive`:

```ts
  return {
    x,
    y,
    angle,
    speed,
    reverseHold,
    angVel: body.angVel,
    shoveX: body.shoveX,
    shoveY: body.shoveY,
    authority: body.authority,
  };
```

- [ ] **Step 5: Carry the fields through `collide.ts`**

Three literals in `packages/shared/src/sim/collide.ts` gain the same four lines. Fields stay spelled out rather than spread, for uniformity with the rest of the repo (R14).

In `resolveWorld`, replace the final return:

```ts
  return {
    x: next.x,
    y: next.y,
    angle: next.angle,
    speed: next.speed,
    reverseHold: next.reverseHold,
    angVel: next.angVel,
    shoveX: next.shoveX,
    shoveY: next.shoveY,
    authority: next.authority,
  };
```

In `clampIntoBounds`, replace its return:

```ts
  return {
    x: body.x + push.x,
    y: body.y + push.y,
    angle: body.angle,
    speed: body.speed,
    reverseHold: body.reverseHold,
    angVel: body.angVel,
    shoveX: body.shoveX,
    shoveY: body.shoveY,
    authority: body.authority,
  };
```

In `applyContact`, replace its return:

```ts
  return {
    x: body.x + push.x,
    y: body.y + push.y,
    angle: body.angle,
    speed,
    reverseHold: body.reverseHold,
    angVel: body.angVel,
    shoveX: body.shoveX,
    shoveY: body.shoveY,
    authority: body.authority,
  };
```

- [ ] **Step 6: Add the schema fields**

In `packages/shared/src/schema/PlayerState.ts`, add after the `reverseHold` line:

```ts
  /**
   * Ram knock state. Networked because `stepDrive` reads all four (invariant 8), and reconciled by
   * snapping rather than easing — they feed the next integration, so a half-eased value would poison
   * every subsequent step rather than merely look wrong.
   *
   * `authority` defaults to 1. A Schema numeric default of 0 would mean "no steering" for every
   * player who has never been touched, which presents as a completely undriveable car on first spawn.
   */
  @type("number") angVel = 0;
  @type("number") shoveX = 0;
  @type("number") shoveY = 0;
  @type("number") authority = 1;
```

- [ ] **Step 7: Carry the fields through the server tick**

In `packages/server/src/sim/tick.ts`, replace `bodyOf` and `writeBody`:

```ts
function bodyOf(player: PlayerState): SimBody {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    speed: player.speed,
    reverseHold: player.reverseHold,
    angVel: player.angVel,
    shoveX: player.shoveX,
    shoveY: player.shoveY,
    authority: player.authority,
  };
}

function writeBody(player: PlayerState, body: SimBody): void {
  player.x = body.x;
  player.y = body.y;
  player.angle = body.angle;
  player.speed = body.speed;
  player.reverseHold = body.reverseHold;
  player.angVel = body.angVel;
  player.shoveX = body.shoveX;
  player.shoveY = body.shoveY;
  player.authority = body.authority;
}
```

- [ ] **Step 8: Carry the fields through the client**

In `packages/client/src/net/prediction.ts`, in `reconcile`, replace the `target` literal:

```ts
    let target: SimBody = {
      x: authoritative.x,
      y: authoritative.y,
      angle: authoritative.angle,
      speed: authoritative.speed,
      reverseHold: authoritative.reverseHold,
      angVel: authoritative.angVel,
      shoveX: authoritative.shoveX,
      shoveY: authoritative.shoveY,
      authority: authoritative.authority,
    };
```

and in the same function, replace the eased return so the four knock fields **snap** alongside `speed` and `reverseHold`:

```ts
    return {
      x: lerp(currentPredicted.x, target.x, NET_CONFIG.reconcileEaseRate),
      y: lerp(currentPredicted.y, target.y, NET_CONFIG.reconcileEaseRate),
      // Ease along the wrapped delta so the correction takes the short way round the seam.
      angle: currentPredicted.angle + dAngle * NET_CONFIG.reconcileEaseRate,
      speed: target.speed,
      reverseHold: target.reverseHold,
      // Knock state snaps for the same reason `speed` does: these feed the next integration. This is
      // also what makes an unpredicted ram viable — the knock lands as one velocity snap and the
      // client then plays the whole spin-and-slide out locally through its own stepSim.
      angVel: target.angVel,
      shoveX: target.shoveX,
      shoveY: target.shoveY,
      authority: target.authority,
    };
```

In `packages/client/src/net/interpolation.ts`, in `InterpolationBuffer.push`, replace the `pose` literal:

```ts
      pose: {
        x: pose.x,
        y: pose.y,
        angle: pose.angle,
        speed: pose.speed,
        reverseHold: pose.reverseHold,
        angVel: pose.angVel,
        shoveX: pose.shoveX,
        shoveY: pose.shoveY,
        authority: pose.authority,
      },
```

In `packages/client/src/scenes/ArenaScene.ts`, replace the module-level `bodyOf`:

```ts
function bodyOf(player: ArenaPlayer): SimBody {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    speed: player.speed,
    reverseHold: player.reverseHold,
    angVel: player.angVel,
    shoveX: player.shoveX,
    shoveY: player.shoveY,
    authority: player.authority,
  };
}
```

The `ArenaPlayer` interface in that same file needs the four fields added alongside its existing `speed` and `reverseHold` entries:

```ts
  angVel: number;
  shoveX: number;
  shoveY: number;
  authority: number;
```

- [ ] **Step 9: Update fixture constructors ONLY in existing tests**

Every test helper that builds a `SimBody` gains `angVel: 0, shoveX: 0, shoveY: 0, authority: 1`. **No expectation changes.** Compile errors point at every site; the pattern is always the same. For example, in `packages/shared/src/sim/drive.test.ts`:

```ts
function rest(): SimBody {
  return { x: 0, y: 0, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0, authority: 1 };
}
```

and in `packages/shared/src/sim/golden.test.ts`:

```ts
function body(over: Partial<SimBody> = {}): SimBody {
  return { x: 0, y: 0, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0, authority: 1, ...over };
}
```

Find the rest with:

```bash
npm run typecheck
```

- [ ] **Step 10: Run the full suite**

```bash
npm test
```

Expected: PASS, 766 + 1 tests. **The golden tests must be green without any edit to their expectations.** If a golden value moved, a pass-through was written wrong (for example `angVel: 0` where `angVel: body.angVel` was meant) — fix the carry, never the golden value.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(shared): SimBody carries ram knock state

Four additive fields — angVel, shoveX, shoveY, authority — threaded through
every construction site. Nothing reads or writes them yet; the golden tests
passing unchanged is the proof that no behaviour moved."
```

---

## Task 4: `stepDrive` integrates the knock

The behaviour change. Additive terms, decay, and the countersteer bleed.

**Files:**
- Modify: `packages/shared/src/sim/drive.ts`
- Modify: `packages/shared/src/sim/drive.test.ts` (new tests appended; existing ones untouched)

**Interfaces:**
- Consumes: `SimBody` knock fields (Task 3), `RAM_CONFIG` / `RAM_DECAY` (Task 2).
- Produces: `stepDrive` decays knock state and applies it. Signature unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/sim/drive.test.ts` (the existing `rest()` and `drive()` helpers are reused):

```ts
describe("stepDrive: ram knock state", () => {
  it("is a no-op at neutral state — the additive terms contribute exactly zero", () => {
    const knocked = drive({ ...rest(), angVel: 0, shoveX: 0, shoveY: 0, authority: 1 }, input(1, 1), 10);
    const plain = drive(rest(), input(1, 1), 10);
    expect(knocked.x).toBe(plain.x);
    expect(knocked.y).toBe(plain.y);
    expect(knocked.angle).toBe(plain.angle);
    expect(knocked.speed).toBe(plain.speed);
  });

  it("rotates the car from angVel with no steering input", () => {
    const out = stepDrive({ ...rest(), angVel: 2 }, input(0, 0), DT, CAR_ID);
    expect(out.angle).toBeCloseTo(2 * DT, 9);
  });

  it("decays angVel toward zero and snaps inside the epsilon", () => {
    const spun = drive({ ...rest(), angVel: 3 }, input(0, 0), 1);
    expect(Math.abs(spun.angVel)).toBeLessThan(3);
    const settled = drive({ ...rest(), angVel: 3 }, input(0, 0), 300);
    expect(settled.angVel).toBe(0);
  });

  it("translates the car from shove with no throttle", () => {
    const out = stepDrive({ ...rest(), shoveX: 120, shoveY: -60 }, input(0, 0), DT, CAR_ID);
    expect(out.x).toBeCloseTo(120 * DT, 9);
    expect(out.y).toBeCloseTo(-60 * DT, 9);
  });

  it("decays shove toward zero and snaps inside the epsilon", () => {
    const settled = drive({ ...rest(), shoveX: 200, shoveY: 200 }, input(0, 0), 300);
    expect(settled.shoveX).toBe(0);
    expect(settled.shoveY).toBe(0);
  });

  it("adds shove to drive velocity rather than replacing it", () => {
    const out = stepDrive({ ...rest(), speed: 300, shoveY: 150 }, input(0, 0), DT, CAR_ID);
    // angle 0, so drive motion is +x and the shove is +y. Both must survive.
    expect(out.x).toBeGreaterThan(0);
    expect(out.y).toBeCloseTo(150 * DT, 9);
  });

  it("scales steering by authority", () => {
    const full = stepDrive({ ...rest(), speed: 200 }, input(1, 0), DT, CAR_ID);
    const half = stepDrive({ ...rest(), speed: 200, authority: 0.5 }, input(1, 0), DT, CAR_ID);
    expect(half.angle).toBeCloseTo(full.angle * 0.5, 9);
  });

  it("does NOT scale throttle by authority — a knocked player can always drive out", () => {
    const full = stepDrive(rest(), input(0, 1), DT, CAR_ID);
    const crushed = stepDrive({ ...rest(), authority: RAM_CONFIG.authorityFloor }, input(0, 1), DT, CAR_ID);
    expect(crushed.speed).toBe(full.speed);
  });

  it("does NOT scale braking by authority", () => {
    const full = stepDrive({ ...rest(), speed: 300 }, input(0, -1), DT, CAR_ID);
    const crushed = stepDrive({ ...rest(), speed: 300, authority: RAM_CONFIG.authorityFloor }, input(0, -1), DT, CAR_ID);
    expect(crushed.speed).toBe(full.speed);
  });

  it("recovers authority back toward 1 and snaps at full control", () => {
    const one = drive({ ...rest(), authority: 0.35 }, input(0, 0), 1);
    expect(one.authority).toBeGreaterThan(0.35);
    expect(one.authority).toBeLessThan(1);
    const settled = drive({ ...rest(), authority: 0.35 }, input(0, 0), 300);
    expect(settled.authority).toBe(1);
  });

  it("bleeds spin faster when steering against it than when coasting", () => {
    const coasting = stepDrive({ ...rest(), speed: 200, angVel: 3 }, input(0, 0), DT, CAR_ID);
    const fighting = stepDrive({ ...rest(), speed: 200, angVel: 3 }, input(-1, 0), DT, CAR_ID);
    expect(fighting.angVel).toBeLessThan(coasting.angVel);
  });

  it("does not bleed spin when steering WITH it", () => {
    const coasting = stepDrive({ ...rest(), speed: 200, angVel: 3 }, input(0, 0), DT, CAR_ID);
    const going = stepDrive({ ...rest(), speed: 200, angVel: 3 }, input(1, 0), DT, CAR_ID);
    expect(going.angVel).toBe(coasting.angVel);
  });
});
```

Add the import at the top of the file:

```ts
import { RAM_CONFIG } from "../config/ram-config.js";
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -w @motor-combat-moba/shared -- src/sim/drive.test.ts
```

Expected: FAIL — angVel is never applied and never decays.

- [ ] **Step 3: Implement the integration**

In `packages/shared/src/sim/drive.ts`, add the import:

```ts
import { RAM_CONFIG, RAM_DECAY } from "../config/ram-config.js";
```

Replace the body of `stepDrive`:

```ts
export function stepDrive(body: SimBody, input: InputMessage, dt: number, carId: CarId): SimBody {
  const turnRate = isMoving(body.speed) ? DRIVE_CONFIG.turnRate : DRIVE_CONFIG.turnRateAtStop;
  // Steering is scaled by authority; injected spin is not. Both are ADDED into one rotation, which
  // is what makes countersteering free: the integrator does not know why angVel is high, so steering
  // the other way simply subtracts from the same sum.
  const angle = body.angle + (input.steer * turnRate * body.authority + body.angVel) * dt;

  const { speed, reverseHold } = nextSpeed(body.speed, body.reverseHold, input.throttle, dt, carId);

  // cos/sin are not guaranteed bit-identical across JS engines (server V8 vs. client browser
  // engine), so replayed positions can drift by an ULP or two. That's fine here: Task 4
  // reconciles client prediction against authoritative server state rather than trusting
  // bit-exact replay, so this is not a desync-checksum-safe function.
  //
  // Shove is added to the drive velocity, never substituted for it: a car that is both driving and
  // knocked does both. At `shoveX/shoveY` of 0 this is arithmetically identical to the pre-ram
  // model, which `golden.test.ts` pins.
  const x = body.x + (Math.cos(angle) * speed + body.shoveX) * dt;
  const y = body.y + (Math.sin(angle) * speed + body.shoveY) * dt;

  return {
    x,
    y,
    angle,
    speed,
    reverseHold,
    angVel: nextAngVel(body.angVel, input.steer),
    shoveX: decayShove(body.shoveX),
    shoveY: decayShove(body.shoveY),
    authority: recoverAuthority(body.authority),
  };
}

/**
 * Injected spin decays on its own, and decays FASTER while the player steers against it.
 *
 * Without that second rate, steering could only offset the visible rotation while the underlying
 * spin ran its full course, so recovery time would be fixed by decay alone and skill could not
 * shorten a knock. This is the one line that makes reading the spin direction worth anything.
 */
function nextAngVel(angVel: number, steer: InputMessage["steer"]): number {
  const fighting = steer * angVel < 0;
  const next = angVel * (fighting ? RAM_DECAY.counterSteer : RAM_DECAY.spin);
  return Math.abs(next) < RAM_CONFIG.spinEpsilon ? 0 : next;
}

function decayShove(component: number): number {
  const next = component * RAM_DECAY.shove;
  return Math.abs(next) < RAM_CONFIG.shoveEpsilon ? 0 : next;
}

/**
 * Authority climbs back toward full control: it is the GAP to 1 that halves, not the value itself.
 * Snapped to exactly 1 inside the epsilon so a car is never left permanently a hair below full
 * steering — exponential recovery never actually arrives.
 */
function recoverAuthority(authority: number): number {
  const next = 1 - (1 - authority) * RAM_DECAY.authority;
  return 1 - next < RAM_CONFIG.authorityEpsilon ? 1 : next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS. **The golden tests must still be green** — this is the load-bearing check for the whole plan.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/drive.ts packages/shared/src/sim/drive.test.ts
git commit -m "feat(shared): stepDrive applies and decays ram knock state

Spin and shove are added to the existing integration, never substituted into
it, so neutral state reproduces the old arithmetic exactly. Authority scales
steering only, so a knocked player can always drive their way out.
Countersteering bleeds spin faster than coasting (R12)."
```

---

## Task 5: Contact normal and shove reflection in `collide.ts`

**Files:**
- Modify: `packages/shared/src/sim/collide.ts`
- Modify: `packages/shared/src/sim/collide.test.ts` (new tests appended; existing ones untouched)
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `contactNormalBetween(a: Obb, b: Obb, pad: number): Vec2 | null` — unit vector pointing from `b` toward `a`, `null` when not in contact.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/sim/collide.test.ts`:

```ts
describe("contactNormalBetween", () => {
  const car = (x: number, y: number, angle = 0) => ({ x, y, angle, w: 48, h: 32 });

  it("returns null for boxes that are nowhere near each other", () => {
    expect(contactNormalBetween(car(0, 0), car(500, 500), 1)).toBeNull();
  });

  it("points from b toward a — the pinned sign convention", () => {
    // a sits to the LEFT of b and just touching, so the normal must point in -x.
    const n = contactNormalBetween(car(0, 0), car(48, 0), 1);
    expect(n).not.toBeNull();
    expect(n!.x).toBeCloseTo(-1, 6);
    expect(n!.y).toBeCloseTo(0, 6);
  });

  it("flips with the argument order", () => {
    const forward = contactNormalBetween(car(0, 0), car(48, 0), 1)!;
    const backward = contactNormalBetween(car(48, 0), car(0, 0), 1)!;
    expect(backward.x).toBeCloseTo(-forward.x, 6);
  });

  it("returns a unit vector", () => {
    const n = contactNormalBetween(car(0, 0), car(40, 6), 1)!;
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 9);
  });

  it("finds contact where a strict overlap test does not, which is the whole reason it pads", () => {
    // Exactly touching: resolveWorld leaves colliding cars here, and SAT calls it separated.
    const a = car(0, 0);
    const b = car(48, 0);
    expect(obbsOverlap(a, b)).toBe(false);
    expect(contactNormalBetween(a, b, 1)).not.toBeNull();
  });
});

describe("applyContact reflects shove", () => {
  // `BOUNDS` and `body(patch)` are this file's existing fixtures — reuse them, do not add new ones.
  it("rebounds a shoved car off a wall instead of pinning it there", () => {
    const out = resolveWorld(body({ x: 10, y: 400, shoveX: -300 }), [], [], BOUNDS);
    expect(out.shoveX).toBeGreaterThan(0);
  });

  it("leaves a car with no shove behaving exactly as before", () => {
    const out = resolveWorld(body({ x: 10, y: 400, speed: 200, angle: Math.PI }), [], [], BOUNDS);
    expect(out.shoveX).toBe(0);
    expect(out.shoveY).toBe(0);
  });

  it("does not amplify a shove that is already moving away from the surface", () => {
    const out = resolveWorld(body({ x: 10, y: 400, shoveX: 300 }), [], [], BOUNDS);
    expect(out.shoveX).toBeCloseTo(300, 9);
  });
});
```

Notes for the implementer:
- `contactNormalBetween` must be added to this file's existing import from `./collide.js`.
- `body(patch)` is the fixture already in `collide.test.ts` (it takes a required patch object); `BOUNDS` is its existing arena constant. Reuse both rather than introducing a `rest()`.
- The `car()` helper in the `contactNormalBetween` block builds an `Obb`, not a `SimBody` — keep it local to that describe block.

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -w @motor-combat-moba/shared -- src/sim/collide.test.ts
```

Expected: FAIL — `contactNormalBetween` is not exported.

- [ ] **Step 3: Implement**

In `packages/shared/src/sim/collide.ts`, add the export beside `obbsInContact`:

```ts
/**
 * The unit contact normal between two boxes that are touching or overlapping within `pad`, or `null`
 * when they are apart.
 *
 * **`n` points from `b` toward `a`**, matching `mtvBetween`'s contract that its vector moves `a`
 * clear of `b`. Pinned by test, because an inverted normal here would spin ram victims the wrong way
 * and classify every front hit as a rear one.
 *
 * The pad is not optional decoration. `resolveWorld` runs before anything that would ask this
 * question and pushes colliding cars out to *exactly* the separation boundary, where SAT reports
 * them separated — so an unpadded normal is `null` on every tick of a real collision. This is the
 * same problem, and the same fix, as `obbsInContact`.
 */
export function contactNormalBetween(a: Obb, b: Obb, pad: number): Vec2 | null {
  const mtv = mtvBetween(inflate(a, pad), inflate(b, pad));
  if (mtv === null) return null;
  const length = Math.hypot(mtv.x, mtv.y);
  if (length <= MIN_OVERLAP) return null;
  return { x: mtv.x / length, y: mtv.y / length };
}
```

Then in `applyContact`, reflect the shove alongside the existing speed reflection. Replace the block from `const intoSurface` through the `return`:

```ts
  const intoSurface = vx * n.x + vy * n.y;
  if (intoSurface < 0) {
    const scale = (1 + DRIVE_CONFIG.restitution) * intoSurface;
    vx -= scale * n.x;
    vy -= scale * n.y;
  }

  const magnitude = Math.hypot(vx, vy);
  const speed = vx * forward.x + vy * forward.y < 0 ? -magnitude : magnitude;

  // Ram shove is a second velocity the drive model does not know about, so it needs its own
  // reflection or a knocked car would be driven into the surface every tick and held there by the
  // clamp until the shove decayed. Same normal, same restitution, and gated on actually moving INTO
  // the surface so a shove already leaving it is never amplified. A zero shove is a no-op, which is
  // why the pre-ram collide tests are unaffected.
  let shoveX = body.shoveX;
  let shoveY = body.shoveY;
  const shoveIntoSurface = shoveX * n.x + shoveY * n.y;
  if (shoveIntoSurface < 0) {
    const shoveScale = (1 + DRIVE_CONFIG.restitution) * shoveIntoSurface;
    shoveX -= shoveScale * n.x;
    shoveY -= shoveScale * n.y;
  }

  return {
    x: body.x + push.x,
    y: body.y + push.y,
    angle: body.angle,
    speed,
    reverseHold: body.reverseHold,
    angVel: body.angVel,
    shoveX,
    shoveY,
    authority: body.authority,
  };
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add `contactNormalBetween` to the existing `./sim/collide.js` export list, keeping the list alphabetical:

```ts
export {
  circleOverlapsObb,
  contactNormalBetween,
  convexOverlap,
  obbCorners,
  obbsInContact,
  obbsOverlap,
  pointInAabb,
  pointInObb,
  resolveWorld,
} from "./sim/collide.js";
```

Also export the `Vec2` type if it is not already exported, since callers need it:

```ts
export type { Aabb, Bounds, Obb, Vec2 } from "./sim/collide.js";
```

If a type export line for `collide.js` already exists, add `Vec2` to it rather than writing a second line.

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: PASS, golden tests included.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/collide.ts packages/shared/src/sim/collide.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): contact normal export and shove reflection

contactNormalBetween recovers the direction resolveWorld discards, padded
because resolution leaves collided cars exactly touching. applyContact now
reflects ram shove alongside speed, so a knocked car rebounds off a wall
instead of pinning against it."
```

---

## Task 6: The pure ram rules

The heart of the feature. Entirely pure and independently testable — no schema, no room, no `MapSchema`.

**Files:**
- Create: `packages/shared/src/sim/ram.ts`
- Create: `packages/shared/src/sim/ram.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `contactNormalBetween` (Task 5), `RAM_CONFIG` / `RAM_DECAY` (Task 2), `massOf` / `RAM_REFERENCE` (Task 2), `carHullOf` from `sim/context.js`, `canDamage` from `sim/weapons/targets.js`.
- Produces:
  - `type ImpactSide = "front" | "flank" | "rear"`
  - `interface RamCar { sessionId: string; team: 0 | 1; x: number; y: number; angle: number; speed: number; carId: CarId }`
  - `interface RamKnock { sessionId: string; angVel: number; shoveX: number; shoveY: number; authority: number }`
  - `interface RamHit { attackerId: string; victimId: string; side: ImpactSide; severity: number; knock: RamKnock }`
  - `function impactSideOf(n: Vec2, victimAngle: number): ImpactSide`
  - `function pairKey(a: string, b: string): string`
  - `function resolveRam(a: RamCar, b: RamCar, mode: "ffa" | "team"): RamHit | null`
  - `function applyRams(cars: readonly RamCar[], previous: ReadonlySet<string>, mode: "ffa" | "team"): { knocks: RamKnock[]; contacts: Set<string> }`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/sim/ram.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RAM_CONFIG } from "../config/ram-config.js";
import { massOf } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import { applyRams, impactSideOf, pairKey, resolveRam, type RamCar } from "./ram.js";

function car(over: Partial<RamCar> = {}): RamCar {
  return { sessionId: "a", team: 0, x: 0, y: 0, angle: 0, speed: 0, carId: "rectangle" as CarId, ...over };
}

/**
 * Attacker at the origin driving +x into a victim just ahead of it.
 *
 * The victim's OWN heading decides which face is struck, and it is easy to get backwards: the
 * attacker always arrives from the victim's -x side, so a victim facing +x (angle 0) is hit in the
 * REAR, and a victim facing -x (angle PI) is hit in the FRONT. Verified against `impactSideOf`.
 */
function headOn(attackerSpeed: number, victimAngle = 0) {
  const attacker = car({ sessionId: "a", x: 0, y: 0, angle: 0, speed: attackerSpeed });
  const victim = car({ sessionId: "b", x: 47, y: 0, angle: victimAngle });
  return { attacker, victim };
}

const REAR_ON = 0;
const FRONT_ON = Math.PI;

function ram(attackerSpeed: number, victimAngle = REAR_ON) {
  const { attacker, victim } = headOn(attackerSpeed, victimAngle);
  return resolveRam(attacker, victim, "ffa");
}

describe("impactSideOf", () => {
  it("classifies a normal off the nose as front", () => {
    expect(impactSideOf({ x: 1, y: 0 }, 0)).toBe("front");
  });

  it("classifies a normal off the tail as rear", () => {
    expect(impactSideOf({ x: -1, y: 0 }, 0)).toBe("rear");
  });

  it("classifies a normal off either side as flank", () => {
    expect(impactSideOf({ x: 0, y: 1 }, 0)).toBe("flank");
    expect(impactSideOf({ x: 0, y: -1 }, 0)).toBe("flank");
  });

  it("is measured in the victim's frame, so rotating the victim reclassifies the same normal", () => {
    expect(impactSideOf({ x: 1, y: 0 }, 0)).toBe("front");
    expect(impactSideOf({ x: 1, y: 0 }, Math.PI)).toBe("rear");
    expect(impactSideOf({ x: 1, y: 0 }, Math.PI / 2)).toBe("flank");
  });
});

describe("pairKey", () => {
  it("is order independent", () => {
    expect(pairKey("z", "a")).toBe(pairKey("a", "z"));
  });
});

describe("resolveRam", () => {
  it("returns null when neither car is driving into the other", () => {
    const { attacker, victim } = headOn(0);
    expect(resolveRam(attacker, victim, "ffa")).toBeNull();
  });

  it("returns null below the minimum approach speed", () => {
    const { attacker, victim } = headOn(RAM_CONFIG.minApproachSpeed - 1);
    expect(resolveRam(attacker, victim, "ffa")).toBeNull();
  });

  it("returns null when the cars are not in contact", () => {
    const attacker = car({ sessionId: "a", speed: 400 });
    const far = car({ sessionId: "b", x: 400 });
    expect(resolveRam(attacker, far, "ffa")).toBeNull();
  });

  it("names the faster approacher the attacker and the other the victim", () => {
    const a = car({ sessionId: "a", x: 0, angle: 0, speed: 400 });
    const b = car({ sessionId: "b", x: 47, angle: Math.PI, speed: 100 });
    const hit = resolveRam(a, b, "ffa");
    expect(hit?.attackerId).toBe("a");
    expect(hit?.victimId).toBe("b");
  });

  it("deals nothing to a car shunted backwards into someone — facing is what counts", () => {
    // `a` is travelling in -x (negative speed along +x heading) so it is not driving into `b`.
    const a = car({ sessionId: "a", x: 0, angle: 0, speed: -400 });
    const b = car({ sessionId: "b", x: 47, angle: 0, speed: 0 });
    expect(resolveRam(a, b, "ffa")).toBeNull();
  });

  it("writes the knock onto the victim, never the attacker", () => {
    const { attacker, victim } = headOn(500);
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.knock.sessionId).toBe(victim.sessionId);
  });

  it("degrades victim authority below 1 but never below the floor", () => {
    const { attacker, victim } = headOn(540);
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.knock.authority).toBeLessThan(1);
    expect(hit.knock.authority).toBeGreaterThanOrEqual(RAM_CONFIG.authorityFloor);
  });

  it("grades severity by approach speed", () => {
    expect(ram(540)!.severity).toBeGreaterThan(ram(150)!.severity);
  });

  it("grades severity by attacker mass", () => {
    const light = car({ sessionId: "a", speed: 300, carId: "rectangle" as CarId });
    const heavy = car({ sessionId: "a", speed: 300, carId: "hexagon" as CarId });
    const victim = car({ sessionId: "b", x: 47 });
    const lightHit = resolveRam(light, victim, "ffa")!;
    const heavyHit = resolveRam(heavy, victim, "ffa")!;
    expect(massOf("hexagon")).toBeGreaterThan(massOf("rectangle"));
    expect(heavyHit.severity).toBeGreaterThan(lightHit.severity);
  });

  it("hurts more from behind than from the front", () => {
    const front = ram(540, FRONT_ON)!;
    const rear = ram(540, REAR_ON)!;
    expect(front.side).toBe("front");
    expect(rear.side).toBe("rear");
    expect(rear.severity).toBeGreaterThan(front.severity);
    expect(rear.knock.authority).toBeLessThan(front.knock.authority);
  });

  it("clamps severity at 1 even on a rear hit, so authority never dips below the floor", () => {
    const attacker = car({ sessionId: "a", speed: 100000, carId: "hexagon" as CarId });
    const victim = car({ sessionId: "b", x: 47, angle: REAR_ON });
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(hit.severity).toBeLessThanOrEqual(1);
    expect(hit.knock.authority).toBeCloseTo(RAM_CONFIG.authorityFloor, 9);
  });

  it("produces no spin on a dead-centre hit along the victim's long axis", () => {
    expect(ram(540)!.knock.angVel).toBeCloseTo(0, 9);
  });

  it("spins opposite ways for flank hits forward of and aft of centre", () => {
    const attackerFwd = car({ sessionId: "a", x: 12, y: -30, angle: Math.PI / 2, speed: 500 });
    const attackerAft = car({ sessionId: "a", x: -12, y: -30, angle: Math.PI / 2, speed: 500 });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const fwd = resolveRam(attackerFwd, victim, "ffa")!;
    const aft = resolveRam(attackerAft, victim, "ffa")!;
    expect(fwd.side).toBe("flank");
    expect(aft.side).toBe("flank");
    expect(Math.sign(fwd.knock.angVel)).toBe(-Math.sign(aft.knock.angVel));
    expect(fwd.knock.angVel).not.toBe(0);
  });

  it("clamps spin at spinMaxRate", () => {
    const attacker = car({ sessionId: "a", x: 20, y: -30, angle: Math.PI / 2, speed: 100000 });
    const victim = car({ sessionId: "b", x: 0, y: 0, angle: 0 });
    const hit = resolveRam(attacker, victim, "ffa")!;
    expect(Math.abs(hit.knock.angVel)).toBeLessThanOrEqual(RAM_CONFIG.spinMaxRate);
  });

  it("shoves a light victim further than a heavy one for the identical ram", () => {
    const attacker = car({ sessionId: "a", speed: 540, carId: "hexagon" as CarId });
    const light = car({ sessionId: "b", x: 47, carId: "rectangle" as CarId });
    const heavy = car({ sessionId: "b", x: 47, carId: "hexagon" as CarId });
    const lightHit = resolveRam(attacker, light, "ffa")!;
    const heavyHit = resolveRam(attacker, heavy, "ffa")!;
    expect(Math.hypot(lightHit.knock.shoveX, lightHit.knock.shoveY)).toBeGreaterThan(
      Math.hypot(heavyHit.knock.shoveX, heavyHit.knock.shoveY),
    );
  });

  it("counts attacker mass once: equal momentum means equal impulse regardless of chassis", () => {
    // Two attackers whose (mass x speed) products match must produce the same shove on one victim.
    // Speeds chosen so severity lands well short of the clamp — at the clamp both would trivially
    // agree at 1.0 and the test would prove nothing.
    const victim = car({ sessionId: "b", x: 47, carId: "oval" as CarId });
    const heavySlow = car({ sessionId: "a", speed: 150, carId: "hexagon" as CarId });
    const scaled = (massOf("hexagon") * 150) / massOf("rectangle");
    const lightFast = car({ sessionId: "a", speed: scaled, carId: "rectangle" as CarId });
    const one = resolveRam(heavySlow, victim, "ffa")!;
    const two = resolveRam(lightFast, victim, "ffa")!;
    expect(one.severity).toBeLessThan(1);
    expect(one.severity).toBeCloseTo(two.severity, 6);
    expect(one.knock.shoveX).toBeCloseTo(two.knock.shoveX, 6);
  });

  it("shoves the victim away from the attacker", () => {
    const { attacker, victim } = headOn(540);
    const hit = resolveRam(attacker, victim, "ffa")!;
    // Attacker is at -x of the victim, so the victim is pushed toward +x.
    expect(hit.knock.shoveX).toBeGreaterThan(0);
  });

  it("spares teammates in team mode entirely", () => {
    const a = car({ sessionId: "a", team: 0, speed: 540 });
    const mate = car({ sessionId: "b", team: 0, x: 47 });
    expect(resolveRam(a, mate, "team")).toBeNull();
  });

  it("still rams opponents in team mode", () => {
    const a = car({ sessionId: "a", team: 0, speed: 540 });
    const foe = car({ sessionId: "b", team: 1, x: 47 });
    expect(resolveRam(a, foe, "team")).not.toBeNull();
  });

  it("rams everyone in ffa regardless of team number", () => {
    const a = car({ sessionId: "a", team: 0, speed: 540 });
    const other = car({ sessionId: "b", team: 0, x: 47 });
    expect(resolveRam(a, other, "ffa")).not.toBeNull();
  });
});

describe("applyRams", () => {
  const attacker = () => car({ sessionId: "a", x: 0, angle: 0, speed: 540 });
  const victim = () => car({ sessionId: "b", x: 47, angle: 0 });

  it("fires on the tick a pair enters contact", () => {
    const out = applyRams([attacker(), victim()], new Set(), "ffa");
    expect(out.knocks).toHaveLength(1);
    expect(out.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("does not re-fire while the pair stays in contact", () => {
    const first = applyRams([attacker(), victim()], new Set(), "ffa");
    const second = applyRams([attacker(), victim()], first.contacts, "ffa");
    expect(second.knocks).toHaveLength(0);
    expect(second.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("fires again after the pair separates and re-approaches", () => {
    const first = applyRams([attacker(), victim()], new Set(), "ffa");
    const apart = applyRams([attacker(), car({ sessionId: "b", x: 400 })], first.contacts, "ffa");
    expect(apart.contacts.has(pairKey("a", "b"))).toBe(false);
    const again = applyRams([attacker(), victim()], apart.contacts, "ffa");
    expect(again.knocks).toHaveLength(1);
  });

  it("tracks contact even for pairs that produce no ram, so a slow touch still blocks a re-trigger", () => {
    const idle = applyRams([car({ sessionId: "a" }), victim()], new Set(), "ffa");
    expect(idle.knocks).toHaveLength(0);
    expect(idle.contacts.has(pairKey("a", "b"))).toBe(true);
  });

  it("keeps only the hardest knock when one car is hit by two others in a tick", () => {
    const soft = car({ sessionId: "a", x: -47, angle: 0, speed: 200 });
    const hard = car({ sessionId: "c", x: 47, angle: Math.PI, speed: 540, carId: "hexagon" as CarId });
    const middle = car({ sessionId: "b", x: 0, angle: 0 });
    const out = applyRams([soft, middle, hard], new Set(), "ffa");
    const onB = out.knocks.filter((k) => k.sessionId === "b");
    expect(onB).toHaveLength(1);
  });

  it("is deterministic regardless of the order cars are supplied in", () => {
    const cars = [attacker(), victim()];
    const forward = applyRams(cars, new Set(), "ffa");
    const backward = applyRams([...cars].reverse(), new Set(), "ffa");
    expect(backward.knocks).toEqual(forward.knocks);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -w @motor-combat-moba/shared -- src/sim/ram.test.ts
```

Expected: FAIL — `Cannot find module './ram.js'`.

- [ ] **Step 3: Implement `ram.ts`**

Create `packages/shared/src/sim/ram.ts`:

```ts
import { RAM_CONFIG } from "../config/ram-config.js";
import { RAM_REFERENCE, RAM_REFERENCE_MASS, massOf } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import { contactNormalBetween, type Vec2 } from "./collide.js";
import { carHullOf } from "./context.js";
import { canDamage } from "./weapons/targets.js";

/**
 * Ram control-and-knockback. Pure: no schema, no room, no wall clock.
 *
 * **A ram deals no damage.** It spins the victim, knocks it sideways, and degrades its steering, and
 * that is all — `applyDamage` is never called from here. Weapons remain the only damage source, so
 * the `attack` rating keeps meaning exactly what its name says. Ramming sets up the kill; weapons
 * land it.
 *
 * **This does not conserve momentum, and is not trying to.** It is a tuned one-way knock derived
 * from the attacker's forward momentum, layered on top of a collision resolver that has already
 * separated the pair. Real exchange would need an impulse solver with a contact manifold; see the
 * design doc's future-work section.
 *
 * Runs AFTER driving has resolved for the tick, so every measurement reads the poses cars actually
 * ended up at, and BEFORE combat. The knock it writes is read by `stepDrive` on the following tick.
 */

export type ImpactSide = "front" | "flank" | "rear";

/** One car as the ram step sees it. Plain data: the room maps `PlayerState` onto this. */
export interface RamCar {
  sessionId: string;
  team: 0 | 1;
  x: number;
  y: number;
  angle: number;
  /** Scalar velocity along the car's own heading — exactly the `dot(vel, fwd)` the severity needs. */
  speed: number;
  carId: CarId;
}

/** What one ram writes onto its victim. Absolute values, not deltas: a knock replaces, never stacks. */
export interface RamKnock {
  sessionId: string;
  angVel: number;
  shoveX: number;
  shoveY: number;
  authority: number;
}

export interface RamHit {
  attackerId: string;
  victimId: string;
  side: ImpactSide;
  severity: number;
  knock: RamKnock;
}

/** Unordered pair identity, so contact tracking cannot depend on iteration order. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Which face of the victim was struck, measured in the victim's own frame.
 *
 * `n` points from the victim toward the attacker (see `contactNormalBetween`), so a positive local x
 * means the attacker is off the victim's nose. The hull is 48 long by 32 wide, so front and rear are
 * the narrow faces and the flanks are the long ones — which is the geometry the bonus table assumes.
 */
export function impactSideOf(n: Vec2, victimAngle: number): ImpactSide {
  const cos = Math.cos(-victimAngle);
  const sin = Math.sin(-victimAngle);
  const localX = n.x * cos - n.y * sin;
  const localY = n.x * sin + n.y * cos;
  if (Math.abs(localX) <= Math.abs(localY)) return "flank";
  return localX > 0 ? "front" : "rear";
}

function bonusFor(side: ImpactSide): number {
  if (side === "front") return RAM_CONFIG.bonusFront;
  if (side === "rear") return RAM_CONFIG.bonusRear;
  return RAM_CONFIG.bonusFlank;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * How fast this car is closing on the other along its own nose.
 *
 * `car.speed` IS `dot(vel, fwd)` in this drive model, so no vector state is needed. Multiplying by
 * how squarely the nose points down the contact normal grades what used to be a yes/no facing test:
 * a glancing approach scores proportionally less rather than falling off a threshold.
 *
 * A car shunted backwards has negative `speed` and so scores negative — it deals nothing, which is
 * what keeps "get behind them" a strategy rather than "be moving fastest".
 */
function approachOf(car: RamCar, towardOther: Vec2): number {
  const fwdX = Math.cos(car.angle);
  const fwdY = Math.sin(car.angle);
  return car.speed * (fwdX * towardOther.x + fwdY * towardOther.y);
}

/**
 * The knock one ram writes, or `null` when this contact is not a ram.
 *
 * `null` covers four distinct cases deliberately kept indistinguishable to the caller: the pair is
 * not in contact, they are teammates, neither is driving into the other, or the closing speed is
 * below `minApproachSpeed`.
 */
export function resolveRam(a: RamCar, b: RamCar, mode: "ffa" | "team"): RamHit | null {
  // Friendly fire is off for contact exactly as it is for shots, decided by the same predicate, so
  // the two can never disagree about who is on your side. Teammates still collide and shove each
  // other through ordinary resolution; they simply cost each other no control.
  if (!canDamage(a.sessionId, a.team, b.sessionId, b.team, mode)) return null;

  const n = contactNormalBetween(
    carHullOf(a.x, a.y, a.angle),
    carHullOf(b.x, b.y, b.angle),
    RAM_CONFIG.contactPad,
  );
  if (n === null) return null;

  // `n` points from b toward a, so a drives along -n to reach b and b drives along +n to reach a.
  const approachA = approachOf(a, { x: -n.x, y: -n.y });
  const approachB = approachOf(b, n);

  const aAttacks = approachA >= approachB;
  const attacker = aAttacks ? a : b;
  const victim = aAttacks ? b : a;
  const approach = aAttacks ? approachA : approachB;
  if (approach < RAM_CONFIG.minApproachSpeed) return null;

  // Points from the attacker toward the victim: the direction the victim is pushed.
  const away: Vec2 = aAttacks ? { x: -n.x, y: -n.y } : n;
  // Points from the victim toward the attacker: what the side classification reads.
  const incoming: Vec2 = aAttacks ? n : { x: -n.x, y: -n.y };

  const side = impactSideOf(incoming, victim.angle);
  // Attacker mass enters HERE and nowhere else. Clamped before the side bonus and again after, so a
  // rear hit on an already-saturated ram cannot drive `authority` below its own floor.
  const raw = clamp01((approach * massOf(attacker.carId)) / RAM_REFERENCE);
  const severity = clamp01(raw * bonusFor(side));

  const impulse = severity * RAM_CONFIG.knockMaxSpeed;
  const victimMass = massOf(victim.carId);
  // Victim mass enters HERE — the same impulse displaces a light car further. Clamped at both ends so
  // neither the heaviest nor the lightest chassis degenerates.
  const massFactor = clamp(
    RAM_REFERENCE_MASS / victimMass,
    RAM_CONFIG.massFactorMin,
    RAM_CONFIG.massFactorMax,
  );

  const shoveX = away.x * impulse * massFactor;
  const shoveY = away.y * impulse * massFactor;

  return {
    attackerId: attacker.sessionId,
    victimId: victim.sessionId,
    side,
    severity,
    knock: {
      sessionId: victim.sessionId,
      angVel: spinOf(attacker, victim, away, impulse),
      shoveX,
      shoveY,
      authority: 1 + (RAM_CONFIG.authorityFloor - 1) * severity,
    },
  };
}

/**
 * Spin from a recovered contact point rather than a guessed direction.
 *
 * Clamping the attacker's centre into the victim's hull, in the victim's local frame, gives an
 * approximate contact point — the same technique `circleOverlapsObb` uses to find a nearest point.
 * The 2D cross product of that lever arm with the knock force is the torque term a real impulse
 * solver would produce, evaluated at one point instead of over a manifold.
 *
 * It behaves correctly by construction rather than by tuning: a dead-centre nose hit puts the lever
 * arm and the force on the same line, so the cross product is zero and there is no spin. A flank hit
 * forward of centre spins the nose away; aft of centre spins the tail away.
 *
 * `spinScale` absorbs the unit mismatch that follows from `impulse` being expressed as a speed. It
 * exists to be calibrated by feel, not derived.
 */
function spinOf(attacker: RamCar, victim: RamCar, away: Vec2, impulse: number): number {
  const cos = Math.cos(-victim.angle);
  const sin = Math.sin(-victim.angle);
  const dx = attacker.x - victim.x;
  const dy = attacker.y - victim.y;

  const hullHalfLength = 24;
  const hullHalfWidth = 16;
  const rx = clamp(dx * cos - dy * sin, -hullHalfLength, hullHalfLength);
  const ry = clamp(dx * sin + dy * cos, -hullHalfWidth, hullHalfWidth);

  const fx = (away.x * cos - away.y * sin) * impulse;
  const fy = (away.x * sin + away.y * cos) * impulse;

  const torque = rx * fy - ry * fx;
  const inertia = massOf(victim.carId) * RAM_CONFIG.inertiaCoefficient;
  const spin = (torque / inertia) * RAM_CONFIG.spinScale;
  return clamp(spin, -RAM_CONFIG.spinMaxRate, RAM_CONFIG.spinMaxRate);
}

/**
 * One tick of ramming over every pair.
 *
 * **Edge triggered.** A ram fires only on the tick a pair *enters* contact. `previous` is the set of
 * pairs that were touching last tick; the returned `contacts` replaces it. Holding the throttle into
 * someone therefore lands one knock, not a stun-lock — to ram again you must separate and
 * re-approach, which is the skill expression the mechanic wants.
 *
 * Contact is tracked even for pairs that produce no ram, so a slow touch still occupies the pair and
 * cannot be converted into a fresh trigger by accelerating while already touching.
 *
 * Iteration is over sorted session ids and each victim keeps only its hardest knock, so the result
 * does not depend on the order `cars` arrives in. A knock REPLACES rather than accumulates: two rams
 * landing on one car in one tick is rare, and summing them would let a sandwich stack past the
 * authority floor the severity clamp exists to guarantee.
 */
export function applyRams(
  cars: readonly RamCar[],
  previous: ReadonlySet<string>,
  mode: "ffa" | "team",
): { knocks: RamKnock[]; contacts: Set<string> } {
  const ordered = [...cars].sort((x, y) => (x.sessionId < y.sessionId ? -1 : x.sessionId > y.sessionId ? 1 : 0));
  const contacts = new Set<string>();
  const best = new Map<string, { severity: number; knock: RamKnock }>();

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j]!;
      const key = pairKey(a.sessionId, b.sessionId);

      const touching =
        contactNormalBetween(
          carHullOf(a.x, a.y, a.angle),
          carHullOf(b.x, b.y, b.angle),
          RAM_CONFIG.contactPad,
        ) !== null;
      if (!touching) continue;
      contacts.add(key);
      if (previous.has(key)) continue;

      const hit = resolveRam(a, b, mode);
      if (hit === null) continue;

      const standing = best.get(hit.victimId);
      if (standing === undefined || hit.severity > standing.severity) {
        best.set(hit.victimId, { severity: hit.severity, knock: hit.knock });
      }
    }
  }

  return { knocks: [...best.values()].map((entry) => entry.knock), contacts };
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add below the `runCombat` export lines:

```ts
export { applyRams, impactSideOf, pairKey, resolveRam } from "./sim/ram.js";
export type { ImpactSide, RamCar, RamHit, RamKnock } from "./sim/ram.js";
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/ram.ts packages/shared/src/sim/ram.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): ram severity, impact side, and knock output

Graded attacker determination from forward speed and mass, front/flank/rear
classification in the victim's frame, and spin from a recovered contact point.
Edge triggered on fresh contact so holding the throttle lands one knock rather
than a stun-lock. Teammates are immune, gated by the same canDamage predicate
that decides friendly fire for shots."
```

---

## Task 7: Wire ram into the server tick

**Files:**
- Create: `packages/server/src/sim/ram-bridge.ts`
- Create: `packages/server/src/sim/ram-bridge.test.ts`
- Modify: `packages/server/src/rooms/ArenaRoom.ts`

**Interfaces:**
- Consumes: `applyRams`, `RamCar`, `RamKnock` (Task 6); `PlayerStatus`, `ArenaState`, `PlayerState`.
- Produces:
  - `interface RamMemory { contacts: Set<string> }`
  - `function newRamMemory(): RamMemory`
  - `function ramTick(state: ArenaState, roster: ReadonlySet<string>, memory: RamMemory, mode: "ffa" | "team"): void`
  - `function clearKnock(player: PlayerState): void`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/sim/ram-bridge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ArenaState, PlayerState, PlayerStatus } from "@motor-combat-moba/shared";
import { clearKnock, newRamMemory, ramTick } from "./ram-bridge.js";

function addPlayer(state: ArenaState, id: string, over: Partial<PlayerState> = {}): PlayerState {
  const p = new PlayerState();
  p.sessionId = id;
  p.carId = "rectangle";
  p.status = PlayerStatus.IN_MATCH;
  p.alive = true;
  Object.assign(p, over);
  state.players.set(id, p);
  return p;
}

function arena(): ArenaState {
  const state = new ArenaState();
  state.arenaId = "arena-01";
  return state;
}

describe("ramTick", () => {
  it("knocks a victim that was just rammed", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa");
    expect(victim.authority).toBeLessThan(1);
    expect(victim.shoveX).toBeGreaterThan(0);
  });

  it("leaves the attacker untouched", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa");
    expect(attacker.authority).toBe(1);
    expect(attacker.shoveX).toBe(0);
    expect(attacker.angVel).toBe(0);
  });

  it("never changes hp", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540, hp: 400 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0, hp: 400 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa");
    expect(victim.hp).toBe(400);
  });

  it("fires once per contact episode, not once per tick", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newRamMemory();
    ramTick(state, new Set(["a", "b"]), memory, "ffa");
    const afterFirst = victim.authority;
    victim.authority = 1;
    ramTick(state, new Set(["a", "b"]), memory, "ffa");
    expect(afterFirst).toBeLessThan(1);
    expect(victim.authority).toBe(1);
  });

  it("ignores players who are not in the roster", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const bystander = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    ramTick(state, new Set(["a"]), newRamMemory(), "ffa");
    expect(bystander.authority).toBe(1);
  });

  it("ignores players who are not on the field", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const lobbying = addPlayer(state, "b", { x: 47, y: 400, angle: 0, status: PlayerStatus.READY });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa");
    expect(lobbying.authority).toBe(1);
  });

  it("ignores wrecks", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const wreck = addPlayer(state, "b", { x: 47, y: 400, angle: 0, alive: false });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa");
    expect(wreck.authority).toBe(1);
  });

  it("spares teammates in team mode", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540, team: 0 });
    const mate = addPlayer(state, "b", { x: 47, y: 400, angle: 0, team: 0 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "team");
    expect(mate.authority).toBe(1);
  });
});

describe("clearKnock", () => {
  it("restores a knocked player to neutral", () => {
    const p = new PlayerState();
    p.angVel = 3;
    p.shoveX = 100;
    p.shoveY = -50;
    p.authority = 0.35;
    clearKnock(p);
    expect(p.angVel).toBe(0);
    expect(p.shoveX).toBe(0);
    expect(p.shoveY).toBe(0);
    expect(p.authority).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -w @motor-combat-moba/server
```

Expected: FAIL — `Cannot find module './ram-bridge.js'`.

- [ ] **Step 3: Implement the bridge**

Create `packages/server/src/sim/ram-bridge.ts`:

```ts
import {
  PlayerStatus,
  applyRams,
  carIdOf,
  isOnField,
  type ArenaState,
  type PlayerState,
  type RamCar,
} from "@motor-combat-moba/shared";

/**
 * The schema half of ramming: read `ArenaState` into plain objects, run the pure `applyRams`, write
 * the answer back.
 *
 * The split mirrors `combat-bridge.ts`. Every rule lives in `@motor-combat-moba/shared` and can be
 * tested without a Colyseus room; this file knows about `MapSchema` and holds no rules at all.
 *
 * Ram runs between driving and combat. Driving must have resolved first, so contacts are measured
 * against the poses cars actually ended the tick at; combat runs after, unaffected, because a ram
 * deals no damage and touches no combat state.
 */

/** Room-owned state that lives across ticks and is deliberately never networked. */
export interface RamMemory {
  /** Pairs that were in contact last tick, so a ram fires on entry rather than every tick. */
  contacts: Set<string>;
}

export function newRamMemory(): RamMemory {
  return { contacts: new Set() };
}

/** Reset a player's knock state to neutral. `authority` is 1 at rest, not 0. */
export function clearKnock(player: PlayerState): void {
  player.angVel = 0;
  player.shoveX = 0;
  player.shoveY = 0;
  player.authority = 1;
}

/**
 * Only living roster members on the field can ram or be rammed. A lobby player standing in the room
 * is not part of the fight, and a wreck is scenery — both still collide through `resolveWorld`, they
 * just neither deal nor take control loss.
 */
function ramCarsOf(state: ArenaState, roster: ReadonlySet<string>): RamCar[] {
  const cars: RamCar[] = [];
  state.players.forEach((player, sessionId) => {
    if (!roster.has(sessionId)) return;
    if (!isOnField(player)) return;
    if (!player.alive) return;
    cars.push({
      sessionId,
      team: player.team === 1 ? 1 : 0,
      x: player.x,
      y: player.y,
      angle: player.angle,
      speed: player.speed,
      carId: carIdOf(player),
    });
  });
  return cars;
}

export function ramTick(
  state: ArenaState,
  roster: ReadonlySet<string>,
  memory: RamMemory,
  mode: "ffa" | "team",
): void {
  const { knocks, contacts } = applyRams(ramCarsOf(state, roster), memory.contacts, mode);
  memory.contacts = contacts;

  for (const knock of knocks) {
    const player = state.players.get(knock.sessionId);
    if (!player) continue;
    player.angVel = knock.angVel;
    player.shoveX = knock.shoveX;
    player.shoveY = knock.shoveY;
    player.authority = knock.authority;
  }
}
```

Note: `PlayerStatus` is imported for parity with the rest of the server sim modules; if the linter flags it as unused, drop it from the import list.

- [ ] **Step 4: Wire it into the room**

In `packages/server/src/rooms/ArenaRoom.ts`:

Add to the imports from `../sim/ram-bridge.js`:

```ts
import { clearKnock, newRamMemory, ramTick, type RamMemory } from "../sim/ram-bridge.js";
```

Add a field beside the existing `combat` memory field:

```ts
  private ram: RamMemory = newRamMemory();
```

In `update`, insert the ram pass between `serverTick` and `combatTick`:

```ts
    const masks = serverTick(this.state, this.inputQueues, dt, this.state.phase);
    // Ramming, after driving and before combat. The order is the rule: contacts are measured against
    // the poses driving actually produced, and the knock written here is read by stepDrive next tick.
    if (this.state.phase === RoomPhase.MATCH && this.matchRoster.size > 0) {
      ramTick(this.state, this.matchRoster, this.ram, toFlowMode(this.state.mode));
    }
    this.combatTick(dt, masks);
```

In the match-start loop, replace `player.speed = 0;` with:

```ts
      player.speed = 0;
      // Nothing from the previous match survives into this one — a knock included, or a car would
      // spawn already spinning with its steering degraded.
      clearKnock(player);
```

Immediately after that same loop, reset the contact memory alongside `clearInstances`:

```ts
    this.ram = newRamMemory();
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/sim/ram-bridge.ts packages/server/src/sim/ram-bridge.test.ts packages/server/src/rooms/ArenaRoom.ts
git commit -m "feat(server): run ramming between driving and combat

New ramTick pass and RamMemory, mirroring the combat bridge split. Match start
clears knock state and contact memory so a spin cannot survive into the next
match."
```

---

## Task 8: Client — mass on the car select screen

**Files:**
- Modify: `packages/client/src/ui/car-select-view.ts`
- Modify: `packages/client/src/ui/car-select-view.test.ts`

**Interfaces:**
- Consumes: `massOf`, `CAR_TABLE` (Task 2).

- [ ] **Step 1: Write the failing test**

Append to the appropriate describe block in `packages/client/src/ui/car-select-view.test.ts`:

```ts
  it("shows mass among the full stats", () => {
    const rows = fullStatsFor("hexagon");
    const mass = rows.find((r) => r.label === "Mass");
    expect(mass?.value).toBe("850");
  });

  it("shows a heavier mass for the tank than the speedster", () => {
    const of = (id: CarId) => fullStatsFor(id).find((r) => r.label === "Mass")!.value;
    expect(Number(of("hexagon"))).toBeGreaterThan(Number(of("rectangle")));
  });
```

Add `massOf` and `CarId` to that file's imports if not present.

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -w @motor-combat-moba/client -- src/ui/car-select-view.test.ts
```

Expected: FAIL — no row labelled "Mass".

- [ ] **Step 3: Implement**

In `packages/client/src/ui/car-select-view.ts`, add `massOf` to the shared import and add the row to `fullStatsFor`, after "Hull HP":

```ts
    { label: "Mass", value: String(massOf(id)) },
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/ui/car-select-view.ts packages/client/src/ui/car-select-view.test.ts
git commit -m "feat(client): show the mass rating on car select"
```

---

## Task 9: Client — instant impact feedback

Render-only. The knock itself is authoritative and arrives a round trip later; this is what makes the ram *feel* immediate in the meantime. Nothing here reaches `stepSim`, the schema, or the server.

**Files:**
- Create: `packages/client/src/scenes/impact-feedback.ts`
- Create: `packages/client/src/scenes/impact-feedback.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `carHullOf`, `obbsInContact`, `RAM_CONFIG` from shared.
- Produces:
  - `interface ImpactTracker { contacts: Set<string> }`
  - `function newImpactTracker(): ImpactTracker`
  - `function freshImpacts(self: {sessionId, x, y, angle}, others: readonly {sessionId, x, y, angle}[], tracker: ImpactTracker): {sessionId: string; x: number; y: number}[]`

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/scenes/impact-feedback.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { freshImpacts, newImpactTracker } from "./impact-feedback.js";

const pose = (sessionId: string, x: number, y: number, angle = 0) => ({ sessionId, x, y, angle });

describe("freshImpacts", () => {
  it("reports nothing when nobody is touching", () => {
    const tracker = newImpactTracker();
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 500, 500)], tracker)).toEqual([]);
  });

  it("reports a contact on the frame it begins, with a midpoint to draw at", () => {
    const tracker = newImpactTracker();
    const hits = freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sessionId).toBe("them");
    expect(hits[0]!.x).toBeCloseTo(23.5, 6);
    expect(hits[0]!.y).toBeCloseTo(0, 6);
  });

  it("does not re-report a contact that is still held", () => {
    const tracker = newImpactTracker();
    freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker);
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker)).toEqual([]);
  });

  it("reports again after separating and re-touching", () => {
    const tracker = newImpactTracker();
    freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker);
    freshImpacts(pose("me", 0, 0), [pose("them", 500, 0)], tracker);
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker)).toHaveLength(1);
  });

  it("forgets a car that disappears, so a rejoin is not stuck as still-touching", () => {
    const tracker = newImpactTracker();
    freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker);
    freshImpacts(pose("me", 0, 0), [], tracker);
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -w @motor-combat-moba/client -- src/scenes/impact-feedback.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/client/src/scenes/impact-feedback.ts`:

```ts
import { RAM_CONFIG, carHullOf, obbsInContact } from "@motor-combat-moba/shared";

/**
 * Local contact detection for impact feedback ONLY — a camera shake and a spark.
 *
 * The ram itself is authoritative and unpredicted: the knock arrives from the server a round trip
 * later and snaps in through reconciliation. This exists to cover that gap perceptually. A ram that
 * sparks immediately and knocks a moment later reads as impact; one that does nothing for four ticks
 * reads as a dropped input.
 *
 * Nothing here reaches `stepSim`, the schema, or the server, so a false positive costs one spurious
 * spark and nothing else. That is the deliberate trade — this is the "predict the feedback, wait for
 * the effect" split, and CC application is firmly on the wait side.
 */

export interface ImpactPose {
  sessionId: string;
  x: number;
  y: number;
  angle: number;
}

export interface ImpactTracker {
  contacts: Set<string>;
}

export interface Impact {
  sessionId: string;
  x: number;
  y: number;
}

export function newImpactTracker(): ImpactTracker {
  return { contacts: new Set() };
}

/**
 * Contacts that BEGAN this frame, between the local car and each remote.
 *
 * Edge triggered against the tracker so a sustained grind sparks once rather than every frame. Cars
 * that vanish from `others` drop out of the tracker, so a reconnecting player is not remembered as
 * still touching and silently denied their next spark.
 */
export function freshImpacts(
  self: ImpactPose,
  others: readonly ImpactPose[],
  tracker: ImpactTracker,
): Impact[] {
  const selfHull = carHullOf(self.x, self.y, self.angle);
  const touching = new Set<string>();
  const fresh: Impact[] = [];

  for (const other of others) {
    if (other.sessionId === self.sessionId) continue;
    const inContact = obbsInContact(
      selfHull,
      carHullOf(other.x, other.y, other.angle),
      RAM_CONFIG.contactPad,
    );
    if (!inContact) continue;
    touching.add(other.sessionId);
    if (tracker.contacts.has(other.sessionId)) continue;
    fresh.push({
      sessionId: other.sessionId,
      x: (self.x + other.x) / 2,
      y: (self.y + other.y) / 2,
    });
  }

  tracker.contacts = touching;
  return fresh;
}
```

- [ ] **Step 4: Call it from the scene**

In `packages/client/src/scenes/ArenaScene.ts`, add the import:

```ts
import { freshImpacts, newImpactTracker, type ImpactTracker } from "./impact-feedback.js";
```

Add the field beside the other private scene state:

```ts
  private impacts: ImpactTracker = newImpactTracker();
```

In `create`, reset it so a re-entered arena does not carry stale contacts:

```ts
    this.impacts = newImpactTracker();
```

In `renderCars` (the method that already builds the `poses` map of every car's render pose), after the map is populated and the local session id is known, add:

```ts
    const selfId = this.room?.sessionId;
    const selfPose = selfId ? poses.get(selfId) : undefined;
    if (selfId && selfPose) {
      const others = [...poses.entries()]
        .filter(([id]) => id !== selfId)
        .map(([id, pose]) => ({ sessionId: id, x: pose.x, y: pose.y, angle: pose.angle }));
      for (const impact of freshImpacts({ sessionId: selfId, ...selfPose }, others, this.impacts)) {
        this.showImpact(impact.x, impact.y);
      }
    }
```

Add the render method to the same class:

```ts
  /**
   * Impact feedback: a brief shake and a spark at the contact point. Render-only — this reacts to
   * locally observed contact, not to an authoritative ram, so it must never change anything the sim
   * or the schema can see.
   */
  private showImpact(x: number, y: number): void {
    this.cameras.main.shake(120, 0.006);
    const spark = this.add.circle(x, y, 10, 0xffffff, 0.9);
    this.hudCamera?.ignore(spark);
    this.tweens.add({
      targets: spark,
      alpha: 0,
      scale: 2.2,
      duration: 180,
      onComplete: () => spark.destroy(),
    });
  }
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Verify in the running game**

```bash
npm run dev
```

Open `http://localhost:5173` in two browser tabs, join with both, start a match, and drive one car into the other. Confirm: a spark and shake on contact, the victim visibly spun and pushed, the victim's steering mushy for a moment then recovering, and no hp change on either car.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/scenes/impact-feedback.ts packages/client/src/scenes/impact-feedback.test.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(client): instant impact feedback on local contact

Render-only spark and shake fired on locally observed contact, covering the
round trip before the authoritative knock arrives. A false positive costs one
spurious spark and cannot reach the sim."
```

---

## Task 10: Documentation sweep

**Files:**
- Modify: `docs/combat-model.md`
- Modify: `docs/schema-reference.md`
- Modify: `docs/config-reference.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the docs**

- `docs/combat-model.md` — add a ramming section: contact is edge triggered, severity comes from the attacker's forward speed and mass, the front/flank/rear bonus table, teammates are immune, and **ramming deals no hp**. Correct any lingering claim that contact costs nothing at all.
- `docs/schema-reference.md` — document `angVel`, `shoveX`, `shoveY`, `authority` on `PlayerState`, noting `authority` defaults to 1 and all four snap rather than ease during reconciliation.
- `docs/config-reference.md` — document `RAM_CONFIG`, that decays are authored as half-lives in seconds and converted once at load, and the `mass` rating with `massPerRating`.
- `CLAUDE.md` — in the "Read the right doc" table, add a row pointing ram questions at the new spec. Note in the roster description that the 150-point budget no longer exists.

- [ ] **Step 2: Verify the whole thing is green**

```bash
npm run build && npm test && npm run typecheck
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: ram CC, the knock schema fields, and the mass rating"
```

---

## Self-Review Notes

**Spec coverage.** R1 → Task 6 (no `applyDamage` call, asserted in Task 7). R2 → Task 7. R3 → Task 5. R4 → Task 6 `applyRams`. R5, R6, R7, R8 → Task 6. R9 → Task 7 (attacker-untouched test). R10 → Tasks 3 and 4. R11 → Task 4 (authority scopes to steering). R12 → Task 4. R13 → Task 5. R14 → Task 3 (explicit literals throughout). R15 → Tasks 6 and 7. R16 → Task 3 Step 8 (snap set). R17 → Task 9. R18 → Task 2. R19 → Task 2. R20 → Task 7.

**Known deviation from the spec, recorded deliberately.** The spec's testing rule says no existing test in `drive.test.ts` or `collide.test.ts` may be modified. That is impossible once `SimBody` gains required fields — their fixture constructors must gain them too. The Global Constraints section narrows the rule to what is actually achievable and enforceable: no *assertion* changes, and Task 1's golden file is the mechanical guarantee.

**Spec testing item 16 ("no hp moves") is covered** by Task 7's `never changes hp` test rather than by a shared-package test, because hp lives on the schema and the bridge is where a mistake would occur.
