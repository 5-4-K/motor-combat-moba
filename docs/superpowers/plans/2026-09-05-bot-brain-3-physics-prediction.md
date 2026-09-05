# Bot Brain 3 (spec phase A) — Physics Prediction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.
>
> **Blocked on plan 1.** This plan replaces the implementation behind plan 1's `PosePredictor` seam.

**Goal:** Predict where a car will actually be by rolling the real drive model forward, instead of
extrapolating a straight line — and make the quality of that prediction a tier knob.

**Architecture:** `brain/predict.ts` reconstructs a `SimBody` from what a bot can legitimately see
and steps it through the real `stepDrive` with `driveOf(carId)`. State a human infers rather than
reads (`angVel`, `authority`, `shove`, `reverseHold`) is inferred from observed motion or assumed
neutral, which is both the fairness mechanism and the source of a very human error class.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md` — decisions P3, P5,
P17–P22, P36, P47, P58b.

**Index:** `docs/superpowers/plans/2026-09-05-bot-predictive-brain-master-index.md`

## Global Constraints

Inherited from the master index. The one that governs this entire plan:

- **P5.** `angVel`, `authority`, `shoveX/Y` and `reverseHold` on **another** car are never read from
  the wire. They are inferred from observed motion or assumed neutral. `BotCarView` carries none of
  them, and must not be widened to. On the bot's **own** car every field is legitimately available.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/server/src/bot/brain/predict.ts` | Create | Reconstruct a `SimBody` from observation; roll it forward through `stepDrive`. |
| `packages/server/src/bot/brain/predict.test.ts` | Create | Tests for both halves. |
| `packages/server/src/bot/brain/perception.ts` | Modify | `KnownCar` remembers the previous pose so turn rate is observable. |
| `packages/server/src/bot/brain/solution.ts` | Modify | Nothing structural — `PosePredictor` already abstracts this. |
| `packages/server/src/bot/brain/controller.ts` | Modify | Build a physics predictor instead of `constantVelocityPredictor`. |
| `packages/server/src/config/bot-profiles.ts` | Modify | Add `stateEstimationSigma`; bump to `4.2.0`. |
| `packages/server/src/config/bot-profiles.test.ts` | Modify | `LADDER` entry. |
| `docs/bot-behavior.md`, `.claude/skills/bot-tuner/SKILL.md` | Modify | P58b. |

---

### Task 1: Observe how fast a car is turning (P18)

`BotCarView` gives a pose per tick. Turn rate is the difference between two of them — which is
exactly what a person watching the screen has.

**Files:**
- Modify: `packages/server/src/bot/brain/perception.ts`
- Test: `packages/server/src/bot/brain/perception.test.ts`

**Interfaces:**
- Consumes: `PerceptionState`, `KnownCar`.
- Produces: `KnownCar.previous: { angle: number; tick: number } | undefined` and
  `observedAngVelOf(state: PerceptionState, sessionId: string): number` — radians per second, 0 when
  unknown.

- [ ] **Step 1: Write the failing test**

```typescript
describe("observedAngVelOf", () => {
  it("is 0 for a car seen only once", () => {
    const state = newPerception();
    const view = viewWith([carAt(100, 100, 0)]);
    perceive(state, view, BOT_PROFILES.hard);
    expect(observedAngVelOf(state, "them")).toBe(0);
  });

  it("measures a turn from two observed poses", () => {
    const state = newPerception();
    perceive(state, viewWith([carAt(100, 100, 0)], 0), BOT_PROFILES.hard);
    perceive(state, viewWith([carAt(100, 100, 0.2)], 1), BOT_PROFILES.hard);
    // 0.2 rad in one tick at 30 Hz == 6 rad/s.
    expect(observedAngVelOf(state, "them")).toBeCloseTo(6, 3);
  });

  it("takes the short way round the seam rather than reading a near-full turn", () => {
    const state = newPerception();
    perceive(state, viewWith([carAt(100, 100, Math.PI - 0.05)], 0), BOT_PROFILES.hard);
    perceive(state, viewWith([carAt(100, 100, -Math.PI + 0.05)], 1), BOT_PROFILES.hard);
    // 0.1 rad across the seam, not 2*pi - 0.1.
    expect(Math.abs(observedAngVelOf(state, "them"))).toBeCloseTo(3, 3);
  });
});
```

Write `viewWith(cars, tick = 0)` and `carAt(x, y, angle)` helpers matching the file's existing
fixture style if they are not already present.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/perception.test.ts -t "observedAngVelOf"
```

Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `KnownCar`:

```typescript
  /**
   * The pose before the current one, so turn rate is observable (P18).
   *
   * A person watching a car sees it rotating; they do not see its `angVel` field, and `BotCarView`
   * deliberately does not carry one. Differencing two observed angles is the honest reconstruction.
   */
  previous: { angle: number; tick: number } | undefined;
```

In `perceive`, when updating an existing `KnownCar`, capture the old pose before overwriting:

```typescript
      existing.previous = { angle: existing.car.angle, tick: existing.lastSeenTick };
```

placed immediately before the line that assigns the new `car`. Initialise `previous: undefined` in
the branch that creates a fresh `KnownCar`.

Add:

```typescript
/**
 * How fast this car was observed to be turning, radians per second, or 0 when unknown (P18).
 *
 * `signedDelta` rather than a raw subtraction: a car crossing the +-pi seam differs by nearly 2*pi
 * in raw terms, which would read as a violent spin and send every prediction built on it sideways.
 */
export function observedAngVelOf(state: PerceptionState, sessionId: string): number {
  const known = state.cars.get(sessionId);
  if (!known?.previous) return 0;
  const ticks = known.lastSeenTick - known.previous.tick;
  if (ticks <= 0) return 0;
  return (signedDelta(known.previous.angle, known.car.angle) * TICK_RATE_HZ) / ticks;
}
```

Import `signedDelta` from `./aim.js` and `TICK_RATE_HZ` from `@motor-combat-moba/shared`.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/bot/brain/perception.test.ts
```

```bash
git add packages/server/src/bot/brain/perception.ts packages/server/src/bot/brain/perception.test.ts
git commit -m "feat(bot): observe another car's turn rate from two poses

A person watching a car sees it rotating; they do not see its angVel field, and
BotCarView deliberately carries none. Differencing two observed angles is the
honest reconstruction, and signedDelta keeps a car crossing the pi seam from
reading as a violent spin.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Roll a car forward through the real drive model (P17, P19)

**Files:**
- Create: `packages/server/src/bot/brain/predict.ts`
- Test: `packages/server/src/bot/brain/predict.test.ts`

**Interfaces:**
- Consumes: `observedAngVelOf` (Task 1).
- Produces:
  - `bodyFromObservation(car: BotCarView, angVel: number): SimBody`
  - `bodyFromSelf(self: BotSelfView): SimBody`
  - `rollForward(body: SimBody, carId: CarId, input: { steer: -1 | 0 | 1; throttle: -1 | 0 | 1 }, ticks: number): SimBody[]`
  - `physicsPredictor(car: BotCarView, angVel: number, input: { steer: -1 | 0 | 1; throttle: -1 | 0 | 1 }, horizonTicks: number): PosePredictor`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/bot/brain/predict.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import type { BotCarView } from "../types.js";
import { bodyFromObservation, physicsPredictor, rollForward } from "./predict.js";

function carAt(over: Partial<BotCarView> = {}): BotCarView {
  return {
    sessionId: "them", carId: "mirage", team: 1, x: 0, y: 0, angle: 0, speed: 300,
    hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0, ...over,
  };
}

describe("rollForward", () => {
  it("carries a straight-line car forward at roughly its speed", () => {
    const body = bodyFromObservation(carAt(), 0);
    const poses = rollForward(body, "mirage", { steer: 0, throttle: 0 }, TICK_RATE_HZ);
    // One second of coasting from 300 u/s covers most of 300 units; drag makes it a little less.
    expect(poses.at(-1)!.x).toBeGreaterThan(200);
    expect(poses.at(-1)!.x).toBeLessThan(320);
    expect(Math.abs(poses.at(-1)!.y)).toBeLessThan(1);
  });

  it("curves a car that was observed turning, without any input", () => {
    const straight = rollForward(
      bodyFromObservation(carAt(), 0), "mirage", { steer: 0, throttle: 0 }, 15,
    );
    const turning = rollForward(
      bodyFromObservation(carAt(), 3), "mirage", { steer: 0, throttle: 0 }, 15,
    );
    expect(Math.abs(turning.at(-1)!.y)).toBeGreaterThan(Math.abs(straight.at(-1)!.y));
  });

  it("returns one pose per tick", () => {
    const poses = rollForward(bodyFromObservation(carAt(), 0), "mirage", { steer: 0, throttle: 0 }, 12);
    expect(poses).toHaveLength(12);
  });
});

describe("physicsPredictor", () => {
  it("beats a straight line for a turning car", () => {
    const turning = carAt({ speed: 400 });
    const predictor = physicsPredictor(turning, 4, { steer: 0, throttle: 1 }, 20);
    const predicted = predictor(20);
    const straight = {
      x: turning.x + Math.cos(turning.angle) * turning.speed * (20 / TICK_RATE_HZ),
      y: turning.y + Math.sin(turning.angle) * turning.speed * (20 / TICK_RATE_HZ),
    };
    // A car turning at 4 rad/s is nowhere near the straight-line point 20 ticks out.
    expect(Math.hypot(predicted.x - straight.x, predicted.y - straight.y)).toBeGreaterThan(50);
  });

  it("clamps past its horizon rather than extrapolating off the end", () => {
    const predictor = physicsPredictor(carAt(), 0, { steer: 0, throttle: 0 }, 10);
    expect(predictor(50)).toEqual(predictor(10));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/predict.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/server/src/bot/brain/predict.ts`:

```typescript
import {
  ManeuverKind, NEUTRAL_MODIFIERS, TICK_RATE_HZ, driveOf, stepDrive,
  type CarId, type SimBody,
} from "@motor-combat-moba/shared";
import type { BotCarView, BotSelfView } from "../types.js";
import type { PosePredictor } from "./solution.js";

/** The two axes a rollout candidate varies. Matches `InputMessage`'s complete action space. */
export interface DriveAction {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
}

/**
 * A `SimBody` for ANOTHER car, from what a bot may legitimately see (P17, P5).
 *
 * `x`, `y`, `angle`, `speed` and `maneuver` are drawn on screen and come straight off `BotCarView`.
 * `angVel` is INFERRED from two observed poses. `authority`, `shoveX/Y` and `reverseHold` are not
 * numbers a human reads at all, so they are assumed neutral.
 *
 * That last assumption is reliably WRONG for a few hundred milliseconds after a ram (P19), when
 * authority is suppressed and shove is still decaying. Bots therefore mispredict cars that have just
 * been hit — which is what a person does too, and is kept rather than corrected.
 */
export function bodyFromObservation(car: BotCarView, angVel: number): SimBody {
  return {
    x: car.x, y: car.y, angle: car.angle, speed: car.speed,
    reverseHold: 0,
    angVel,
    shoveX: 0, shoveY: 0,
    authority: 1,
    maneuver: car.maneuver as ManeuverKind,
    maneuverTicksLeft: 0,
    maneuverSpeed: 0,
  };
}

/** A `SimBody` for the bot's OWN car. Every field here is on its own HUD, so none is inferred. */
export function bodyFromSelf(self: BotSelfView): SimBody {
  return {
    x: self.x, y: self.y, angle: self.angle, speed: self.speed,
    reverseHold: 0,
    angVel: 0,
    shoveX: 0, shoveY: 0,
    authority: 1,
    maneuver: self.maneuver as ManeuverKind,
    maneuverTicksLeft: self.maneuverTicksLeft,
    maneuverSpeed: 0,
  };
}

/**
 * Step a body `ticks` times through the REAL drive model, holding one input (P3).
 *
 * `stepDrive` plus `driveOf` — the same pair the sim itself resolves at its single production call
 * site — so a prediction and the thing predicted cannot drift apart through a balance edit.
 * Statuses are not modelled: the bot sees that a car is slowed but has no principled way to know the
 * multiplier, and assuming neutral is the conservative direction.
 */
export function rollForward(
  body: SimBody,
  carId: CarId,
  input: DriveAction,
  ticks: number,
): SimBody[] {
  const dt = 1 / TICK_RATE_HZ;
  const chassis = driveOf(carId);
  const out: SimBody[] = [];
  let current = body;
  for (let i = 0; i < ticks; i++) {
    current = stepDrive(current, { seq: 0, ...input, fireSlots: 0 }, dt, chassis, NEUTRAL_MODIFIERS);
    out.push(current);
  }
  return out;
}

/**
 * A `PosePredictor` backed by real physics — the phase-A replacement for
 * `constantVelocityPredictor` behind the same seam.
 *
 * Clamps past its horizon rather than extrapolating: a caller asking beyond what was rolled gets the
 * last real pose, never a straight line grafted onto a curve.
 */
export function physicsPredictor(
  car: BotCarView,
  angVel: number,
  input: DriveAction,
  horizonTicks: number,
): PosePredictor {
  const poses = rollForward(bodyFromObservation(car, angVel), car.carId, input, horizonTicks);
  return (ticksAhead) => {
    if (ticksAhead <= 0 || poses.length === 0) {
      return { x: car.x, y: car.y, angle: car.angle };
    }
    const body = poses[Math.min(Math.round(ticksAhead), poses.length) - 1]!;
    return { x: body.x, y: body.y, angle: body.angle };
  };
}
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/bot/brain/predict.test.ts
```

Expected: PASS. If `NEUTRAL_MODIFIERS`, `stepDrive`, `driveOf` or `SimBody` are not exported from the
shared package root, add them to `packages/shared/src/index.ts` and rebuild shared.

```bash
git add packages/server/src/bot/brain/predict.ts packages/server/src/bot/brain/predict.test.ts
git commit -m "feat(bot): predict a car by rolling the real drive model forward

stepDrive plus driveOf -- the same pair the sim resolves at its production call
site -- so a prediction and the thing predicted cannot drift apart through a
balance edit.

Only what a human can see comes off the observation. angVel is inferred from two
poses; authority, shove and reverseHold are assumed neutral because they are not
numbers anyone reads. That assumption is reliably wrong just after a ram, so
bots mispredict cars that have just been hit. Kept, not corrected: it is what a
person does too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Make prediction quality a tier knob (P20, P36)

**Files:**
- Modify: `packages/server/src/config/bot-profiles.ts`
- Modify: `packages/server/src/config/bot-profiles.test.ts`
- Modify: `packages/server/src/bot/brain/predict.ts`
- Test: `packages/server/src/bot/brain/predict.test.ts`

**Interfaces:**
- Produces: `BotProfile.stateEstimationSigma: number`; `physicsPredictor` gains an
  `estimationSigma` and an `rng` parameter.

This is the **only** new `rng()` consumer in the plan. It draws **one Gaussian (two `rng()` calls)
per predictor construction**, unconditionally, per H21.

- [ ] **Step 1: Write the failing test**

```typescript
describe("state estimation noise (P20)", () => {
  it("perturbs the prediction, and a tighter sigma perturbs it less", () => {
    const car = carAt({ speed: 400 });
    const at = (sigma: number) => physicsPredictor(
      car, 0, { steer: 0, throttle: 1 }, 20, sigma, makeRng(9),
    )(20);
    const truth = physicsPredictor(car, 0, { steer: 0, throttle: 1 }, 20, 0, makeRng(9))(20);
    const sloppy = at(0.25);
    const sharp = at(0.03);
    const err = (p: { x: number; y: number }) => Math.hypot(p.x - truth.x, p.y - truth.y);
    expect(err(sloppy)).toBeGreaterThan(err(sharp));
  });

  it("draws the same number of rng calls whether sigma is zero or not (H21)", () => {
    let calls = 0;
    const counting = () => { calls += 1; return 0.5; };
    physicsPredictor(carAt(), 0, { steer: 0, throttle: 0 }, 5, 0, counting);
    const withZero = calls;
    calls = 0;
    physicsPredictor(carAt(), 0, { steer: 0, throttle: 0 }, 5, 0.2, counting);
    expect(calls).toBe(withZero);
  });
});
```

Import `makeRng` from `../rng.js`.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/predict.test.ts -t "state estimation"
```

Expected: FAIL — `physicsPredictor` takes four arguments.

- [ ] **Step 3: Implement**

Extend `physicsPredictor`:

```typescript
export function physicsPredictor(
  car: BotCarView,
  angVel: number,
  input: DriveAction,
  horizonTicks: number,
  estimationSigma: number,
  rng: Rng,
): PosePredictor {
  // Drawn unconditionally, and the SAME count regardless of sigma (H21): a draw that happened only
  // when sigma was non-zero would make the stream depend on the tier, and one seed would stop
  // replaying across a profile edit.
  const speedNoise = gaussian(rng) * estimationSigma;
  const turnNoise = gaussian(rng) * estimationSigma;
  const observed: BotCarView = { ...car, speed: car.speed * (1 + speedNoise) };
  const poses = rollForward(
    bodyFromObservation(observed, angVel * (1 + turnNoise)), car.carId, input, horizonTicks,
  );
  return (ticksAhead) => {
    if (ticksAhead <= 0 || poses.length === 0) {
      return { x: car.x, y: car.y, angle: car.angle };
    }
    const body = poses[Math.min(Math.round(ticksAhead), poses.length) - 1]!;
    return { x: body.x, y: body.y, angle: body.angle };
  };
}

/** Box-Muller, one half used. Two draws every call, always — same contract as `aim.ts`'s. */
function gaussian(rng: Rng): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
```

Import `type Rng` from `../rng.js`.

Add to `BotProfile`, in the Perception group:

```typescript
  /**
   * How wrong this bot's read of an opponent's speed and turn rate is, as a fraction (P20).
   *
   * Reading exact `speed` off a car every tick is the one place a bot sees more precisely than a
   * person, who eyeballs it. This is the answer to that, and it is a knob rather than a fixed
   * penalty because how well you read a car IS a skill.
   */
  readonly stateEstimationSigma: number;
```

with `easy: 0.25`, `medium: 0.1`, `hard: 0.03`. Add `stateEstimationSigma: "falls"` to `LADDER`.
Bump:

```typescript
// 4.2.0 (2026-09-05): physics-based prediction replaces the constant-velocity solve (spec phase A).
export const BOT_BRAIN_VERSION = "4.2.0";
```

- [ ] **Step 4: Run and commit**

```bash
npm test
```

```bash
git add packages/server/src/bot/brain/predict.ts packages/server/src/bot/brain/predict.test.ts packages/server/src/config/bot-profiles.ts packages/server/src/config/bot-profiles.test.ts
git commit -m "feat(bot): make how well a bot reads a car a tier knob

Reading exact speed off a car every tick is the one place a bot saw more
precisely than a person. stateEstimationSigma perturbs the observed speed and
turn rate before the rollout, so a casual's lead is wrong in the way a casual's
lead is wrong. Two rng draws, unconditionally, whatever the sigma (H21).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Swap the predictor into the controller (P22)

**Files:**
- Modify: `packages/server/src/bot/brain/controller.ts`
- Test: `packages/server/src/bot/brain/controller.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("leads a crossing target better than a straight-line solve would (P22)", () => {
  // A Mirage crossing at full speed. A constant-velocity predictor is close for a straight
  // crosser, so the target TURNS: only a physics rollout tracks that.
  const bot = new HumanController("hard");
  const rng = makeRng(17);
  let fires = 0;
  for (let tick = 0; tick < 200; tick++) {
    const intent = bot.decide(turningCrosserView(tick, rng));
    if (intent.fireSlots !== 0) fires += 1;
  }
  // A bot that cannot predict the curve sees a low EV on every slot and holds fire.
  expect(fires).toBeGreaterThan(5);
});
```

with a helper placing a target at radius 400 that advances along a circular arc each tick and
carries a matching non-zero `angle`, so `observedAngVelOf` has two poses to difference.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/controller.test.ts -t "leads a crossing target"
```

Expected: FAIL or a low count.

- [ ] **Step 3: Replace the predictor**

In `controller.ts`'s `plan`, replace:

```typescript
    const predictor = target ? constantVelocityPredictor(target) : undefined;
```

with:

```typescript
    // The target's own input is unknowable, so assume they hold what their motion implies: coasting
    // straight. Plan 4's `targetBranches` is what stops a skilled bot relying on that assumption.
    const predictor = target
      ? physicsPredictor(
          target,
          observedAngVelOf(this.perception, target.sessionId),
          { steer: 0, throttle: 0 },
          BRAIN_CONSTANTS.predictionHorizonTicks,
          profile.stateEstimationSigma,
          view.rng,
        )
      : undefined;
```

Add to `BRAIN_CONSTANTS`:

```typescript
  /**
   * How far ahead a firing solution rolls a target. Not per-tier: this is how far a SHOT flies, not
   * how far a bot thinks — that is plan 4's `planHorizonTicks`. The longest flight on the roster is
   * thumper's 2.9 s, and no solution needs to see past its own shot landing.
   */
  predictionHorizonTicks: 90,
```

Delete the now-unused `constantVelocityPredictor` import from `controller.ts`; **keep the export** in
`solution.ts` — `solution.test.ts` uses it as a fixture and it documents the seam.

Delete the `bodyIntercept` / `interceptHeading` block and replace the `close` case's
`goalDesire(interceptHeading)` with `goalDesire(Math.atan2(predicted.y - self.y, predicted.x - self.x))`
computed from `predictor?.(BRAIN_CONSTANTS.predictionHorizonTicks / 3) ?? target`.

- [ ] **Step 4: Run and commit**

```bash
npm test
```

```bash
git add packages/server/src/bot
git commit -m "feat(bot): lead with real physics instead of a straight line

interceptPoint solved a constant-velocity intercept, which is exactly wrong for
the case that matters: a car turning. The solver's PosePredictor seam made this
a swap rather than a rewrite -- nothing in solution.ts changed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Docs and skill (P58b)

- [ ] **Step 1: `docs/bot-behavior.md`**

- Version → `4.2.0`.
- **Aim (hands)** table: add `stateEstimationSigma` at `0.25 / 0.1 / 0.03`. (`leadFactor` was
  removed in plan 1.)
- Complaint map: replace any surviving "it doesn't lead me" advice with `stateEstimationSigma`
  down, and add: *"if it fails to lead a car that is TURNING, that is prediction, not aim —
  `stateEstimationSigma`, not `aimErrorSigmaRad`."*

- [ ] **Step 2: `.claude/skills/bot-tuner/SKILL.md`**

Add to the complaint table:

| They say | Factor | First knobs |
|---|---|---|
| "it misses me when I turn" | hands (prediction) | `stateEstimationSigma` down on that tier. Not `aimErrorSigmaRad` — that is steady-state hands, this is reading a curve |

- [ ] **Step 3: Verify and commit**

```bash
npm test
```

```bash
git add docs/bot-behavior.md .claude/skills/bot-tuner/SKILL.md
git commit -m "docs: bot brain 4.2.0 — physics prediction

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Validation

- [ ] **1.** `npm test` from the repo root passes.
- [ ] **2.** `npm run build` succeeds; `packages/server/dist/index.js` inlines `// ../shared/dist/`.
- [ ] **3.** In `?dev=playground`, drive a **constant circle** around a hard bot at medium range. It
  should hit you materially more often than it did at `4.1.0`. Then do the same against easy — it
  should still miss, because `stateEstimationSigma` 0.25 is a bad read, not a bad hand.
- [ ] **4.** Ram a hard bot and immediately drive off. Its next shot should miss (P19 — it assumes
  neutral authority and shove on a car that has just been hit). This is intended behaviour; confirm
  it looks like a plausible mistake rather than a glitch.
- [ ] **5.** Report: balance baselines invalidated (`4.2.0`). **Playtest probes are affected** —
  prediction changes engagement range and firing cadence. Name the probes and numbers after reading
  `packages/server/playtest/`, and recommend `npm run playtest`. Do not run it.
