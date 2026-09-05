# Bot Brain 1 (spec phase B) — Firing Solutions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bot's angular fire gate with a real firing-solution solver, so it shoots when a
shot will actually land and stops shooting when it will not.

**Architecture:** A new `brain/solution.ts` builds real `WeaponInstance`s with the sim's own
`spawnInstances`, marches them with `stepInstance`, and tests them against the target's hull with
`shapeHitsObb` — integrated over the shooter's aim error at fixed Gauss–Hermite quadrature points, so
it draws no random numbers. `chooseSlot` then ranks and gates on expected value per second of gun
time instead of `fireConeRad`.

**Tech Stack:** TypeScript, Vitest, `@motor-combat-moba/shared` (consumed as built `dist`).

**Spec:** `docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md` — decisions P7–P15,
P35–P37, P42, P43, P48, P49, P54, P57, P58a, P58b.

**Index:** `docs/superpowers/plans/2026-09-05-bot-predictive-brain-master-index.md`

## Global Constraints

Inherited verbatim from the master index's Global Constraints section. The three that bite hardest in
this plan:

- **The solver draws zero `rng()` calls (P43).** Aim error is integrated at fixed quadrature nodes,
  never sampled. Task 9 proves this with a throwing stub.
- **A behaviour is code, a tier is data (H8).** No `if (tier === "hard")` anywhere.
- **`npm install` in this worktree before the first build**, or the build inlines the main checkout's
  shared `dist` and every suite passes against the wrong sim.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/server/src/bot/brain/solution.ts` | Create | The solver. Quadrature, instance marching, hit chance, expected damage, EV. One responsibility: "would this shot land, and is it worth it". |
| `packages/server/src/bot/brain/solution.test.ts` | Create | Unit + ground-truth tests for the above. |
| `packages/server/src/bot/brain/firing.ts` | Modify | `chooseSlot` regated on EV. `weaponValueOf`/`effectiveRangeOf` keep their shape. |
| `packages/server/src/bot/brain/firing.test.ts` | Modify | Drop `fireConeRad` cases, add EV-gate cases. |
| `packages/server/src/bot/brain/controller.ts` | Modify | Stop applying the orbit desire; pass the solver into `chooseSlot`. |
| `packages/server/src/bot/brain/movement.ts` | Modify | Delete `orbitDesire` (unused after Task 2). |
| `packages/server/src/bot/brain/movement.test.ts` | Modify | Drop the `orbitDesire` block. |
| `packages/server/src/config/bot-profiles.ts` | Modify | Remove 6 fields, add `minShotValue`, bump `BOT_BRAIN_VERSION`. |
| `packages/server/src/config/bot-profiles.test.ts` | Modify | `LADDER` entries for the changed fields. |
| `docs/bot-behavior.md` | Modify | Hands + fire-economy tables, complaint map, P42 warning. |
| `.claude/skills/bot-tuner/SKILL.md` | Modify | P58a items 3 and 4; drop dead knobs and the dead invariant. |
| `packages/server/balance/README.md` | Modify | P57 — the `wildcharge` distortion note is now false. |

---

### Task 1: Measure the lockout before fixing it (P54)

Throwaway. Produces the "before" numbers that Tasks 2 and 9 assert against. **Not committed** — it
lives in the scratchpad and is deleted at the end of the task.

**Files:**
- Create (throwaway): `<scratchpad>/lockout-probe.mjs` where `<scratchpad>` is
  `C:\Users\user\AppData\Local\Temp\claude\E--Work-motor-combat-MOBA--claude-worktrees-bot-intelligence-rework-c37f8f\<session>\scratchpad`

**Interfaces:**
- Consumes: nothing.
- Produces: three recorded numbers, pasted into this plan's Validation section — hard's mean
  `|aimDelta|` in `fight`, its fire count over 300 ticks, and its time to kill a stationary target.

- [ ] **Step 1: Install and build, or every measurement is against the wrong sim**

```bash
npm install && npm run build -w @motor-combat-moba/shared
```

- [ ] **Step 2: Write the probe**

Create the file with this content:

```javascript
// THROWAWAY. Demonstrates spec section 1.1 before it is fixed. Not committed.
import { HumanController } from "../../packages/server/src/bot/brain/controller.js";
import { makeRng } from "../../packages/server/src/bot/rng.js";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";

const slots = slotsOf("bullseye").map((weaponId) => ({
  weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
  range: weaponDefOf(weaponId).range,
}));

const bot = new HumanController("hard");
const rng = makeRng(17);
let fires = 0;
const deltas = [];

for (let tick = 0; tick < 300; tick++) {
  const view = {
    tick,
    self: {
      sessionId: "me", carId: "bullseye", team: 0, x: 200, y: 360, angle: 0, speed: 300,
      hp: 65, maxHp: 65, alive: true, statuses: [], slots,
      switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
    },
    // Stationary target, 553 units out — hard's preferred range for this kit.
    others: [{
      sessionId: "them", carId: "mirage", team: 0, x: 753, y: 360, angle: Math.PI, speed: 0,
      hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
    }],
    instances: [], arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [], rng,
  };
  const intent = bot.decide(view);
  if (intent.fireSlots !== 0) fires += 1;
  const d = bot.debug();
  if (d) deltas.push(d.situation);
}

console.log("fires in 300 ticks:", fires);
console.log("situations seen:", [...new Set(deltas)].join(", "));
```

- [ ] **Step 3: Run it**

```bash
node --experimental-strip-types "<scratchpad>/lockout-probe.mjs"
```

Expected: a **low or zero** fire count while the situation reads `fight`. That is section 1.1. If the
fire count is healthy, **stop and report** — the diagnosis was wrong and this plan needs revisiting
before any code changes.

- [ ] **Step 4: Record the numbers in this plan's Validation section, then delete the probe**

```bash
rm "<scratchpad>/lockout-probe.mjs"
```

No commit for this task.

---

### Task 2: Stop the orbit desire fighting the aim line (spec §1.1, P32)

The minimum change that lets the bot fire at all. Phase D deletes the desire model entirely; this
removes only the term that creates the lockout, so the rest of the plan is testable.

**Files:**
- Modify: `packages/server/src/bot/brain/controller.ts` (the `inDeadband` block)
- Modify: `packages/server/src/bot/brain/movement.ts` (delete `orbitDesire`)
- Modify: `packages/server/src/bot/brain/movement.test.ts` (delete its `orbitDesire` block)
- Test: `packages/server/src/bot/brain/controller.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `HumanController` that keeps its body on the aim line while in `fight`. Task 7 depends
  on this to observe EV changes.

- [ ] **Step 1: Write the failing test**

**Two corrections from Task 1's measurement — the first draft of this test was worthless.**

1. **It must be a closed loop.** A helper that rebuilds `self` from the same literals every tick
   never lets the bot's steering rotate its own body, and the whole bug is that rotation. Task 1
   measured 146 fires open-loop against 62 closed-loop: the static version cannot see the bug.
2. **The bar must be above the measured baseline.** The unfixed bot fires **62** times in this
   scenario, so the original `> 10` passed before any fix existed. The unimpeded control is 146.

Add to `packages/server/src/bot/brain/controller.test.ts`:

```typescript
it("keeps the body on the aim line at its preferred range, so it can fire (spec 1.1)", () => {
  const { fires, meanOffset } = closedLoopDuel("hard", 300);
  // Measured 2026-09-05: 62 fires unfixed, 146 with steering not fed back (the control).
  // Removing the orbit term should land near the control, so the bar sits well above 62.
  expect(fires).toBeGreaterThan(110);
  // And the mechanism, not just the symptom: the body must stay near the aim line.
  expect(meanOffset).toBeLessThan(BOT_PROFILES.hard.fireConeRad);
});
```

Add this closed-loop helper beside the file's existing ones. Note it builds on the file's existing
`view(overrides)` helper, which defaults `slots: []`:

```typescript
function closedLoopDuel(
  tier: "easy" | "medium" | "hard",
  ticks: number,
): { fires: number; meanOffset: number } {
  const bot = new HumanController(tier);
  const rng = makeRng(17);
  const slots = slotsOf("bullseye").map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  }));
  // Real physics, so the bot's own steering rotates its own body — without this the bug is
  // invisible (Task 1, round 1).
  let body = {
    x: 200, y: 360, angle: 0, speed: 300, reverseHold: 0, angVel: 0,
    shoveX: 0, shoveY: 0, authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverSpeed: 0,
  };
  const target = {
    sessionId: "them", carId: "mirage" as const, team: 1 as const, x: 753, y: 360,
    angle: Math.PI, speed: 0, hp: 70, maxHp: 70, alive: true, phased: false,
    statuses: [], maneuver: 0,
  };
  let fires = 0;
  const offsets: number[] = [];

  for (let tick = 0; tick < ticks; tick++) {
    const intent = bot.decide(view({
      tick,
      self: {
        ...view().self,
        x: body.x, y: body.y, angle: body.angle, speed: body.speed, slots,
      },
      others: [target],
      rng,
    }));
    if (intent.fireSlots !== 0) fires += 1;
    const bearing = Math.atan2(target.y - body.y, target.x - body.x);
    offsets.push(Math.abs(
      Math.atan2(Math.sin(bearing - body.angle), Math.cos(bearing - body.angle)),
    ));
    body = stepDrive(
      body,
      { seq: tick, steer: intent.steer, throttle: intent.throttle, fireSlots: 0 },
      1 / TICK_RATE_HZ,
      driveOf("bullseye"),
      NEUTRAL_MODIFIERS,
    );
  }

  const tail = offsets.slice(-100);
  return { fires, meanOffset: tail.reduce((a, b) => a + b, 0) / tail.length };
}
```

Add the imports this needs from `@motor-combat-moba/shared`: `NEUTRAL_MODIFIERS`, `TICK_RATE_HZ`,
`driveOf`, `slotsOf`, `stepDrive`, `weaponDefOf`. If any is not exported from the package root,
import it from its deep path and note that in your report — **do not add exports to shared in this
task.**

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/bot/brain/controller.test.ts -t "keeps the body on the aim line"
```

Run from `packages/server`. Expected: **FAIL with `fires` around 62 and `meanOffset` around 0.365** —
those are Task 1's measured values, so a wildly different number means the harness does not match the
probe and should be reconciled before writing any fix.

- [ ] **Step 3: Remove the orbit application**

In `packages/server/src/bot/brain/controller.ts`, delete this block entirely:

```typescript
    if (inDeadband) {
      const orbit = orbitDesire(bearing, profile.orbitBias, this.orbitSide);
      if (orbit) desires.push(orbit);
    }
```

Keep the `inDeadband` constant itself — `reduceToIntent` still reads the deadband for throttle.
Remove `orbitDesire` from the `./movement.js` import list. Remove the now-unused `this.orbitSide`
field and the line in `decide` that assigns it.

- [ ] **Step 4: Delete `orbitDesire` from `movement.ts`**

Delete the whole function and its doc comment:

```typescript
/** Circle the target instead of closing head-on (H13). `side` keeps the bot circling one way. */
export function orbitDesire(
  bearingToTarget: number,
  orbitBias: number,
  side: 1 | -1,
): Desire | undefined {
  if (orbitBias <= 0) return undefined;
  return { headingRad: bearingToTarget + (side * Math.PI) / 2, weight: orbitBias };
}
```

Delete the matching `describe("orbitDesire", ...)` block from `movement.test.ts`.

- [ ] **Step 5: Run the brain suite**

```bash
npx vitest run src/bot
```

Expected: PASS, including the new test.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/bot/brain/controller.ts packages/server/src/bot/brain/controller.test.ts packages/server/src/bot/brain/movement.ts packages/server/src/bot/brain/movement.test.ts
git commit -m "fix(bot): stop the orbit desire holding hard's body off its own aim line

At orbitBias 0.35 against GOAL_WEIGHT 1 the blended heading sat 19.3 degrees
off the target, and fireConeRad on hard is 11.5. A hard bot parked at its
preferred range could never satisfy its own fire gate, so it weaved and held
fire indefinitely. Medium (11.3 vs 20) and easy (0) were unaffected, which is
why hard did not feel harder than medium.

orbitDesire goes with it. Orbiting returns in phase D as an emergent result of
the planner scoring a circling arc higher, rather than as a term that fights
the aim line.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The solver — quadrature and projectile marching (P7, P8, P43)

**Files:**
- Create: `packages/server/src/bot/brain/solution.ts`
- Test: `packages/server/src/bot/brain/solution.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, for Tasks 4–7 and for plans 2, 3 and 4:
  - `AIM_QUADRATURE: readonly { z: number; weight: number }[]`
  - `type PosePredictor = (ticksAhead: number) => { x: number; y: number; angle: number }`
  - `constantVelocityPredictor(target: BotCarView): PosePredictor`
  - `interface FiringSolution { hitChance: number; expectedDamage: number; value: number; aimHeadingRad: number; readyInTicks: number }`
  - `solve(args: SolveArgs): FiringSolution`
  - `interface SolveArgs { shooter: SolverShooter; slot: BotSlotView; slotIndex: number; target: BotCarView; targetAt: PosePredictor; aimSigmaRad: number; tick: number; arena: BotArenaView }`
  - `interface SolverShooter { sessionId: string; carId: CarId; team: 0 | 1; x: number; y: number; angle: number; speed: number; lockTargetSessionId: string }`

`PosePredictor` is the seam plan 3 replaces. Nothing outside `solution.ts` may assume how a pose is
predicted.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/bot/brain/solution.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";
import type { BotArenaView, BotCarView, BotSlotView } from "../types.js";
import {
  AIM_QUADRATURE, constantVelocityPredictor, solve, type SolverShooter,
} from "./solution.js";

const arena: BotArenaView = { width: 1280, height: 720, obstacles: [] };

function slotFor(weaponId: Parameters<typeof weaponDefOf>[0]): BotSlotView {
  return {
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  };
}

function shooterAt(x: number, y: number, angle: number): SolverShooter {
  return {
    sessionId: "me", carId: "bullseye", team: 0, x, y, angle, speed: 0,
    lockTargetSessionId: "",
  };
}

function targetAt(x: number, y: number): BotCarView {
  return {
    sessionId: "them", carId: "mirage", team: 1, x, y, angle: Math.PI, speed: 0,
    hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
  };
}

describe("AIM_QUADRATURE", () => {
  it("is a normalised weighting, so hitChance cannot exceed 1", () => {
    const total = AIM_QUADRATURE.reduce((sum, node) => sum + node.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("is symmetric about zero, so a perfectly aimed shot is not biased to one side", () => {
    const shifted = AIM_QUADRATURE.reduce((sum, node) => sum + node.z * node.weight, 0);
    expect(shifted).toBeCloseTo(0, 9);
  });
});

describe("solve — projectile", () => {
  it("is near certain against a stationary target dead ahead with perfect hands", () => {
    const target = targetAt(400, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeGreaterThan(0.95);
  });

  it("is near zero when the shooter is pointed 90 degrees away", () => {
    const target = targetAt(400, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, Math.PI / 2),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeLessThan(0.05);
  });

  it("falls off with distance for the same shaky hands, because the target subtends less", () => {
    const near = targetAt(200, 0);
    const far = targetAt(800, 0);
    const at = (target: BotCarView) => solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0.05, tick: 0, arena,
    }).hitChance;
    expect(at(near)).toBeGreaterThan(at(far));
  });

  it("reports 0 beyond the weapon's reach rather than a small number", () => {
    const target = targetAt(3000, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBe(0);
    expect(solution.value).toBe(0);
  });

  it("values a shot per second of gun time, not per press (P14)", () => {
    const target = targetAt(300, 0);
    const common = {
      shooter: shooterAt(0, 0, 0), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    };
    // predator: 30 damage on a 1000 ms cooldown. pepperbox: 45 per pellet on 1800 ms.
    const predator = solve({ ...common, slot: slotFor("predator") });
    expect(predator.value).toBeCloseTo(predator.expectedDamage / 1, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/bot/brain/solution.test.ts
```

Expected: FAIL — `Cannot find module './solution.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/bot/brain/solution.ts`:

```typescript
import {
  TICK_RATE_HZ, carHullOf, instanceExpired, projectileShapeAt, shapeHitsObb, smear,
  spawnInstances, stepInstance, weaponDefOf,
  type CarId, type WeaponInstance, type WorldShape,
} from "@motor-combat-moba/shared";
import type { BotArenaView, BotCarView, BotSlotView } from "../types.js";
import { weaponReachOf } from "./reach.js";

/**
 * Where the aim error is sampled, and how much each sample counts (P43).
 *
 * Seven-point Gauss–Hermite, transformed for the probabilists' normal: nodes are `sqrt(2) * x_i` and
 * weights are `w_i / sqrt(pi)`. FIXED points, never random draws — the solver must consume no `rng()`
 * (H21), and a smooth `hitChance` is also what stops the phase-D planner chattering on a noisy score.
 */
export const AIM_QUADRATURE: readonly { z: number; weight: number }[] = Object.freeze([
  { z: -3.750439717725742, weight: 0.00054826 },
  { z: -2.366759410734541, weight: 0.03075712 },
  { z: -1.154405394739968, weight: 0.24012318 },
  { z: 0, weight: 0.45714286 },
  { z: 1.154405394739968, weight: 0.24012318 },
  { z: 2.366759410734541, weight: 0.03075712 },
  { z: 3.750439717725742, weight: 0.00054826 },
]);

/** Where a car will be `ticksAhead` from now. Plan 3 swaps the implementation behind this type. */
export type PosePredictor = (ticksAhead: number) => { x: number; y: number; angle: number };

/** Straight-line extrapolation — what a bot assumes before it can roll real physics forward. */
export function constantVelocityPredictor(target: BotCarView): PosePredictor {
  const vx = Math.cos(target.angle) * target.speed;
  const vy = Math.sin(target.angle) * target.speed;
  return (ticksAhead) => {
    const seconds = ticksAhead / TICK_RATE_HZ;
    return { x: target.x + vx * seconds, y: target.y + vy * seconds, angle: target.angle };
  };
}

export interface SolverShooter {
  sessionId: string;
  carId: CarId;
  team: 0 | 1;
  x: number; y: number; angle: number; speed: number;
  lockTargetSessionId: string;
}

export interface FiringSolution {
  /** 0..1, weighted over `AIM_QUADRATURE`. */
  hitChance: number;
  /** Damage this press is worth in expectation, counting every pellet and pulse that connects. */
  expectedDamage: number;
  /** `expectedDamage / cooldownSeconds` — EV per second of gun time (P14). */
  value: number;
  /** The heading that produced the best chance. */
  aimHeadingRad: number;
  /** 0 when the slot may be pressed now. */
  readyInTicks: number;
}

export interface SolveArgs {
  shooter: SolverShooter;
  slot: BotSlotView;
  slotIndex: number;
  target: BotCarView;
  targetAt: PosePredictor;
  /** The shooter's own aim-error sigma. 0 means perfect hands. */
  aimSigmaRad: number;
  tick: number;
  arena: BotArenaView;
}

const NO_SOLUTION: FiringSolution = Object.freeze({
  hitChance: 0, expectedDamage: 0, value: 0, aimHeadingRad: 0, readyInTicks: 0,
});

/** How many ticks until this slot may be pressed. */
export function readyInTicksOf(slot: BotSlotView, tick: number): number {
  if (slot.stocks >= 1 && tick >= slot.refireLockUntilTick) return 0;
  const when = Math.max(slot.refireLockUntilTick, slot.stocks >= 1 ? 0 : slot.rechargeEndsTick);
  return Math.max(0, when - tick);
}

/**
 * Would this slot's press land on this target, and what is it worth (P7)?
 *
 * Marches REAL instances — `spawnInstances` then `stepInstance` — rather than approximating a
 * trajectory, so pellets, bounces and expiry behave exactly as they will in the match. That is what
 * makes the ground-truth test in `solution.test.ts` meaningful rather than tautological: the solver
 * and the sim can still disagree about hulls, expiry or the muzzle, and the test catches it.
 */
export function solve(args: SolveArgs): FiringSolution {
  const { shooter, slot, target, targetAt, aimSigmaRad, tick, arena } = args;
  const def = weaponDefOf(slot.weaponId);
  const reach = weaponReachOf(slot.weaponId);
  const distance = Math.hypot(target.x - shooter.x, target.y - shooter.y);
  if (distance > reach) return NO_SOLUTION;

  const nominal = Math.atan2(target.y - shooter.y, target.x - shooter.x);
  const cooldownSeconds = Math.max(def.cooldownMs, 1) / 1000;

  let hitChance = 0;
  let expectedDamage = 0;
  for (const node of AIM_QUADRATURE) {
    const heading = nominal + node.z * aimSigmaRad;
    const landed = marchPress(args, heading);
    if (landed.hits > 0) hitChance += node.weight;
    expectedDamage += node.weight * landed.damage;
  }

  return {
    hitChance,
    expectedDamage,
    value: expectedDamage / cooldownSeconds,
    aimHeadingRad: nominal,
    readyInTicks: readyInTicksOf(slot, tick),
  };
}

/** One press fired along `heading`: how many instances connect, and for how much. */
function marchPress(
  args: SolveArgs,
  heading: number,
): { hits: number; damage: number } {
  // `targetAt` and `arena` are not destructured here on purpose: this function only spawns, and
  // hands the whole `args` to `marchOne`, which is what actually walks the shot.
  const { shooter, slot, slotIndex, tick } = args;
  const def = weaponDefOf(slot.weaponId);
  if (def.kind === "maneuver") return { hits: 0, damage: 0 }; // Task 5 fills this in.

  const spawned = spawnInstances(
    { weaponId: slot.weaponId, slot: slotIndex, finalVolley: true, pressId: "solve" },
    {
      sessionId: shooter.sessionId, team: shooter.team, carId: shooter.carId,
      x: shooter.x, y: shooter.y, angle: heading,
    },
    tick,
    0,
  );

  let hits = 0;
  let damage = 0;
  for (const spawnedInstance of spawned.instances) {
    const landed = marchOne(spawnedInstance, args, heading);
    if (landed > 0) {
      hits += 1;
      damage += landed;
    }
  }
  return { hits, damage };
}

/** March one instance to expiry, returning the damage it deals to the target. */
function marchOne(start: WeaponInstance, args: SolveArgs, heading: number): number {
  const { shooter, target, targetAt, tick, arena } = args;
  const dt = 1 / TICK_RATE_HZ;
  let instance = start;
  let previous = shapeOf(instance);
  let damage = 0;

  for (let ahead = 1; ahead <= MAX_MARCH_TICKS; ahead++) {
    const now = tick + ahead;
    instance = stepInstance(instance, {
      dt, tick: now,
      obstacles: arena.obstacles,
      bounds: { width: arena.width, height: arena.height },
      ownerPose: { x: shooter.x, y: shooter.y, angle: heading },
      homingTarget: { x: target.x, y: target.y },
    });
    const current = shapeOf(instance);
    const pose = targetAt(ahead);
    if (shapeHitsObb(smear(previous, current), carHullOf(pose.x, pose.y, pose.angle))) {
      damage += instance.damage;
      break; // Single-hit for now; Task 4 replaces this for ticking beams.
    }
    previous = current;
    if (instanceExpired(instance, now)) break;
  }
  return damage;
}

/** No shot on this roster stays alive longer than this; the loop must terminate regardless. */
const MAX_MARCH_TICKS = 120;

function shapeOf(instance: WeaponInstance): WorldShape {
  const def = weaponDefOf(instance.weaponId);
  if (def.kind !== "projectile") {
    throw new Error(`shapeOf: ${instance.weaponId} is not a projectile`);
  }
  return projectileShapeAt(def.hitbox, instance.x, instance.y, instance.angle);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/bot/brain/solution.test.ts
```

Expected: PASS, all seven cases.

If `spawnInstances` or `stepInstance` are not exported from the shared package root, add them to
`packages/shared/src/index.ts`'s export list and rebuild shared
(`npm run build -w @motor-combat-moba/shared`) before re-running. Adding an export is in scope;
changing behaviour is not.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bot/brain/solution.ts packages/server/src/bot/brain/solution.test.ts
git commit -m "feat(bot): add the firing-solution solver, projectile path

Marches real WeaponInstances with the sim's own spawnInstances and stepInstance
rather than approximating a trajectory, and integrates over the shooter's aim
error at seven fixed Gauss-Hermite nodes. Fixed nodes rather than sampling
because the solver must draw no rng (H21) and because a smooth hitChance is
what keeps the phase-D planner from chattering.

Value is expected damage per second of gun time, not per press, so a cheap
fast-recharging gun can outrank a big slow one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Pellet fans and ticking beams (P10 rows 2–3)

**Files:**
- Modify: `packages/server/src/bot/brain/solution.ts`
- Test: `packages/server/src/bot/brain/solution.test.ts`

**Interfaces:**
- Consumes: `solve`, `marchOne` from Task 3.
- Produces: no new exported names. `solve` becomes correct for `pepperbox`, `lance`, `afterburner`
  and `tremor`.

- [ ] **Step 1: Write the failing tests**

Append to `solution.test.ts`:

```typescript
describe("solve — pellet fan", () => {
  it("counts more than one pellet's damage on a close target (P10)", () => {
    const target = targetAt(120, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("pepperbox"), slotIndex: 1,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    // 45 per pellet. A centred close fan puts at least two on the hull.
    expect(solution.expectedDamage).toBeGreaterThan(45);
  });
});

describe("solve — ticking beam", () => {
  it("counts repeated pulses, not one (P10)", () => {
    const target = targetAt(150, 0);
    const solution = solve({
      shooter: shooterAt(0, 0, 0),
      slot: slotFor("afterburner"), slotIndex: 2,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    // 49 per pulse; a target parked in the cone takes several.
    expect(solution.expectedDamage).toBeGreaterThan(49);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/bot/brain/solution.test.ts -t "pellet fan"
npx vitest run src/bot/brain/solution.test.ts -t "ticking beam"
```

Expected: FAIL — the fan case throws from `shapeOf` (beams are not projectiles) or under-counts;
the beam case throws.

- [ ] **Step 3: Teach `shapeOf` about beams and `marchOne` about pulses**

Replace `shapeOf` with:

```typescript
function shapeOf(instance: WeaponInstance): WorldShape {
  const def = weaponDefOf(instance.weaponId);
  if (def.kind === "projectile") {
    return projectileShapeAt(def.hitbox, instance.x, instance.y, instance.angle);
  }
  if (def.kind === "beam") {
    return beamShapeAt(def.hitbox, instance.x, instance.y, instance.angle, instance.extent);
  }
  throw new Error(`shapeOf: ${instance.weaponId} spawns no instance`);
}
```

Add `beamShapeAt` and `weaponTicksOf` to the import list from `@motor-combat-moba/shared`.

Replace `marchOne`'s single-hit `break` with pulse counting:

```typescript
function marchOne(start: WeaponInstance, args: SolveArgs, heading: number): number {
  const { shooter, target, targetAt, tick, arena } = args;
  const def = weaponDefOf(start.weaponId);
  const interval = def.kind === "beam" ? weaponTicksOf(start.weaponId).damageInterval : Infinity;
  const dt = 1 / TICK_RATE_HZ;
  let instance = start;
  let previous = shapeOf(instance);
  let damage = 0;
  let lastHitTick = -Infinity;

  for (let ahead = 1; ahead <= MAX_MARCH_TICKS; ahead++) {
    const now = tick + ahead;
    instance = stepInstance(instance, {
      dt, tick: now,
      obstacles: arena.obstacles,
      bounds: { width: arena.width, height: arena.height },
      ownerPose: { x: shooter.x, y: shooter.y, angle: heading },
      homingTarget: { x: target.x, y: target.y },
    });
    const current = shapeOf(instance);
    const pose = targetAt(ahead);
    const connects = shapeHitsObb(smear(previous, current), carHullOf(pose.x, pose.y, pose.angle));
    if (connects) {
      // A ticking beam damages on the first tick it covers them, then once per `damageInterval` —
      // the same cadence `resolveInstanceHits` applies. A projectile stops at its first contact.
      if (!Number.isFinite(interval)) return damage + instance.damage;
      if (now - lastHitTick >= interval) {
        damage += instance.damage;
        lastHitTick = now;
      }
    }
    previous = current;
    if (instanceExpired(instance, now)) break;
  }
  return damage;
}
```

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/bot/brain/solution.test.ts
```

Expected: PASS, all cases including Task 3's.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bot/brain/solution.ts packages/server/src/bot/brain/solution.test.ts
git commit -m "feat(bot): solve pellet fans and ticking beams

A fan is already several instances out of spawnInstances, so the fan case needed
only the per-instance sum. A ticking beam needed the pulse cadence: first tick
it covers them, then once per damageInterval, matching resolveInstanceHits.
Reading a beam's damage as one hit under-rated lance by a factor of four, which
is what made the old weaponValueOf comment necessary.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Maneuvers, so the bot can finally press `wildcharge` (P10 row 4, P11, G4)

**Files:**
- Modify: `packages/server/src/bot/brain/solution.ts`
- Test: `packages/server/src/bot/brain/solution.test.ts`

**Interfaces:**
- Consumes: `solve` from Tasks 3–4.
- Produces: `solve` returns a non-zero solution for `wildcharge` and `thunderclap`.

A maneuver spawns no instance — the car itself is the shot — so it is marched as a hull sweep rather
than a projectile.

- [ ] **Step 1: Write the failing test**

```typescript
describe("solve — maneuver", () => {
  it("gives wildcharge a real solution at contact range, so the bot can press it (P11)", () => {
    const target = targetAt(120, 0);
    const solution = solve({
      shooter: { ...shooterAt(0, 0, 0), carId: "bastion" },
      slot: slotFor("wildcharge"), slotIndex: 2,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeGreaterThan(0.5);
    expect(solution.expectedDamage).toBeGreaterThan(0);
  });

  it("gives it nothing across the arena", () => {
    const target = targetAt(900, 0);
    const solution = solve({
      shooter: { ...shooterAt(0, 0, 0), carId: "bastion" },
      slot: slotFor("wildcharge"), slotIndex: 2,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/solution.test.ts -t "maneuver"
```

Expected: FAIL — `hitChance` is 0, because `marchPress` returns early for `kind === "maneuver"`.

- [ ] **Step 3: Implement the hull sweep**

Replace the early return in `marchPress`:

```typescript
  if (def.kind === "maneuver") return marchManeuver(args, heading, def);
```

and add:

```typescript
/**
 * A maneuver's "shot" is the car (P10). Sweeps the shooter's own hull along the dash line and
 * reports a hit when it overlaps the target's predicted hull.
 *
 * `wildcharge` authors `range: 0` and `speed: 0` — it is a charge, not a dash — so its reach is
 * `BRAIN_CONSTANTS.contactTriggerUnits` via `weaponReachOf`, and the sweep runs over that distance
 * at the chassis top speed. Without this branch the bot never presses it, which the balance harness
 * documented as a known distortion.
 */
function marchManeuver(
  args: SolveArgs,
  heading: number,
  def: ReturnType<typeof weaponDefOf>,
): { hits: number; damage: number } {
  const { shooter, slot, target, targetAt } = args;
  const reach = weaponReachOf(slot.weaponId);
  const speed = def.speed > 0 ? def.speed : forwardMaxSpeedOf(shooter.carId);
  const ticks = Math.max(1, Math.ceil((reach / Math.max(speed, 1)) * TICK_RATE_HZ));

  let previous = carHullOf(shooter.x, shooter.y, heading);
  for (let ahead = 1; ahead <= ticks; ahead++) {
    const travelled = Math.min(reach, (speed * ahead) / TICK_RATE_HZ);
    const hull = carHullOf(
      shooter.x + Math.cos(heading) * travelled,
      shooter.y + Math.sin(heading) * travelled,
      heading,
    );
    const pose = targetAt(ahead);
    const swept = smear(obbShape(previous), obbShape(hull));
    if (shapeHitsObb(swept, carHullOf(pose.x, pose.y, pose.angle))) {
      return { hits: 1, damage: weaponDamageOf(shooter.carId, slot.weaponId) };
    }
    previous = hull;
  }
  return { hits: 0, damage: 0 };
}

/** An OBB as a polygon, so `smear` can hull two of them together. */
function obbShape(hull: ReturnType<typeof carHullOf>): WorldShape {
  const cos = Math.cos(hull.angle);
  const sin = Math.sin(hull.angle);
  const hw = hull.w / 2;
  const hh = hull.h / 2;
  const corner = (dx: number, dy: number) => ({
    x: hull.x + dx * cos - dy * sin,
    y: hull.y + dx * sin + dy * cos,
  });
  return {
    kind: "polygon",
    points: [corner(hw, hh), corner(-hw, hh), corner(-hw, -hh), corner(hw, -hh)],
  };
}
```

Add `forwardMaxSpeedOf` and `weaponDamageOf` to the shared import list.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/bot/brain/solution.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bot/brain/solution.ts packages/server/src/bot/brain/solution.test.ts
git commit -m "feat(bot): solve maneuvers by sweeping the car's own hull

wildcharge and thunderclap spawn no instance -- the car is the shot -- so the
projectile march had nothing to walk. Sweeping the shooter's hull along the dash
line and testing it against the target's predicted hull closes the gap the
balance harness documents as 'the bot cannot press wildcharge'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Splash damage and aim assist (P12, P13)

**Files:**
- Modify: `packages/server/src/bot/brain/solution.ts`
- Test: `packages/server/src/bot/brain/solution.test.ts`

**Interfaces:**
- Consumes: `solve`.
- Produces: `solve` accounts for `magmablast`'s detonation and for a live aim-assist lock.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("solve — explosion", () => {
  it("credits magmablast's splash on a near miss (P12)", () => {
    // Offset laterally by more than a hull's half-width but inside the blast.
    const target = targetAt(300, 40);
    const solution = solve({
      shooter: { ...shooterAt(0, 0, 0), carId: "mirage" },
      slot: slotFor("magmablast"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.expectedDamage).toBeGreaterThan(0);
  });
});

describe("solve — aim assist", () => {
  it("is near certain with a live lock even when the nose is off, inside aimRangeUnits (P13)", () => {
    const target = targetAt(300, 0);
    const locked = solve({
      shooter: { ...shooterAt(0, 0, 0.25), lockTargetSessionId: "them" },
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    const unlocked = solve({
      shooter: shooterAt(0, 0, 0.25),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(locked.hitChance).toBeGreaterThan(unlocked.hitChance);
    expect(locked.hitChance).toBeGreaterThan(0.9);
  });

  it("declines the assist beyond the weapon's aimRangeUnits, per the sim's own gate", () => {
    // magmablast: aimRangeUnits 400. At 600 the lock exists but the weapon fires straight.
    const target = targetAt(600, 0);
    const solution = solve({
      shooter: { ...shooterAt(0, 0, 0.4), carId: "mirage", lockTargetSessionId: "them" },
      slot: slotFor("magmablast"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0, tick: 0, arena,
    });
    expect(solution.hitChance).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/bot/brain/solution.test.ts -t "explosion"
npx vitest run src/bot/brain/solution.test.ts -t "aim assist"
```

Expected: FAIL on all three.

- [ ] **Step 3: Model the lock, then the splash**

In `solve`, replace the `nominal` computation so a live, in-range lock removes the aim error — the
sim's `aimAngleFor` points the shot at the target regardless of the nose:

```typescript
  const assisted = def.usesAimAssist
    && shooter.lockTargetSessionId === target.sessionId
    && distance <= (def.aimRangeUnits ?? 0);
  const nominal = Math.atan2(target.y - shooter.y, target.x - shooter.x);
  const sigma = assisted ? 0 : aimSigmaRad;
```

and use `sigma` in the quadrature loop instead of `aimSigmaRad`.

In `marchOne`, credit splash when a projectile with an `explosion` expires near the target:

```typescript
    if (instanceExpired(instance, now)) {
      damage += splashAt(instance, targetAt(ahead), def);
      break;
    }
```

and add:

```typescript
/**
 * A shell's detonation (P12). `magmablast` is the only row with one today: its blast is a detached
 * centre-origin disc, so the honest test is "is the target's hull inside the blast radius".
 *
 * Counted even when the direct shot missed, because that is exactly when it matters — a shell whose
 * value ignored its explosion would be ranked below the small gun beside it and never pressed.
 */
function splashAt(
  instance: WeaponInstance,
  pose: { x: number; y: number; angle: number },
  def: ReturnType<typeof weaponDefOf>,
): number {
  if (def.kind !== "projectile" || !def.explosion) return 0;
  const blast = { kind: "circle" as const, x: instance.x, y: instance.y, radius: def.explosion.radius };
  return shapeHitsObb(blast, carHullOf(pose.x, pose.y, pose.angle)) ? def.explosion.damage : 0;
}
```

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/bot/brain/solution.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bot/brain/solution.ts packages/server/src/bot/brain/solution.test.ts
git commit -m "feat(bot): model splash damage and aim assist in the solver

Aim assist is the subtlety that made hard orbit itself out of its own predator
lock without noticing: for an assisted weapon inside aimRangeUnits, aimAngleFor
sends the shot at the target regardless of where the nose points, so the solver
must zero the aim error rather than integrate over it.

Splash is credited even on a direct miss, which is when it matters -- magmablast
ranked on direct hits alone sits below the gun beside it and never gets pressed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Gate firing on expected value, and migrate the profile (P14, P35, P36, P37)

**Files:**
- Modify: `packages/server/src/bot/brain/firing.ts`
- Modify: `packages/server/src/bot/brain/firing.test.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`
- Modify: `packages/server/src/config/bot-profiles.ts`
- Modify: `packages/server/src/config/bot-profiles.test.ts`

**Interfaces:**
- Consumes: `solve`, `FiringSolution`, `constantVelocityPredictor` from Tasks 3–6.
- Produces:
  - `chooseSlot` gains a required `solutions: ReadonlyMap<number, FiringSolution>` argument and
    loses its `aimDelta` argument.
  - `BotProfile` loses `fireConeRad`, `fireDisciplineChance`, `aimToleranceRad`, `leadFactor`,
    `standoffFraction`, `deadbandFraction`, `orbitBias`; gains `minShotValue: number`.

`aimToleranceRad`, `standoffFraction` and `deadbandFraction` are still read by `reduceToIntent` and
`preferredRangeOf`, which plan 4 deletes. **Keep those three for now** and remove only
`fireConeRad`, `fireDisciplineChance`, `orbitBias` and `leadFactor` in this plan — `orbitBias` and
`leadFactor` have no readers left after Task 2 and Task 6 respectively. This split is what P35's
Phase column records: four fields leave here, three leave in plan 4.

- [ ] **Step 1: Write the failing tests**

In `firing.test.ts`, delete every case referencing `fireConeRad` or `fireDisciplineChance`, then add:

```typescript
describe("chooseSlot — expected value gate", () => {
  const solutionsFor = (entries: [number, number][]) =>
    new Map(entries.map(([slot, value]) => [slot, {
      hitChance: value > 0 ? 0.8 : 0, expectedDamage: value, value,
      aimHeadingRad: 0, readyInTicks: 0,
    }]));

  it("holds fire when nothing clears minShotValue", () => {
    const decision = chooseSlot({
      self: self("bullseye"), target, distance: 300,
      profile: { ...BOT_PROFILES.hard, minShotValue: 26 },
      weights: ones, tick: 100, lastPressTick: 0, rng: makeRng(1),
      ultHold: new Map<number, UltHoldEntry>(),
      solutions: solutionsFor([[0, 5], [1, 3], [2, 1]]),
    });
    expect(decision.slot).toBeUndefined();
  });

  it("presses the highest-value slot that clears it", () => {
    const decision = chooseSlot({
      self: self("bullseye"), target, distance: 300,
      profile: { ...BOT_PROFILES.hard, minShotValue: 26 },
      weights: ones, tick: 100, lastPressTick: 0, rng: makeRng(1),
      ultHold: new Map<number, UltHoldEntry>(),
      solutions: solutionsFor([[0, 30], [1, 45], [2, 1]]),
    });
    expect(decision.slot).toBe(1);
  });

  it("an amateur threshold takes a shot a skilled one declines (P37)", () => {
    const solutions = solutionsFor([[0, 6], [1, 0], [2, 0]]);
    const at = (minShotValue: number) => chooseSlot({
      self: self("bullseye"), target, distance: 300,
      profile: { ...BOT_PROFILES.easy, minShotValue },
      weights: ones, tick: 100, lastPressTick: 0, rng: makeRng(1),
      ultHold: new Map<number, UltHoldEntry>(), solutions,
    }).slot;
    expect(at(2)).toBe(0);
    expect(at(26)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/bot/brain/firing.test.ts
```

Expected: FAIL — `minShotValue` and `solutions` do not exist.

- [ ] **Step 3: Regate `chooseSlot`**

In `firing.ts`, change the signature: delete `aimDelta: number`, add
`solutions: ReadonlyMap<number, FiringSolution>`. Delete these two blocks:

```typescript
  if (Math.abs(aimDelta) >= profile.fireConeRad) return hold;
```

```typescript
    } else if (distance > reach * 0.9 && disciplineRoll < profile.fireDisciplineChance) {
      // A marginal shot at the very edge of reach: a disciplined bot waits, a sprayer takes it (H29).
      continue;
    }
```

Keep the `disciplineRoll` draw itself — H21 requires the count to stay fixed — and mark it:

```typescript
  // Still drawn, still discarded: the count per call must not change (H21). The value's old
  // consumer was `fireDisciplineChance`, which the EV threshold replaces.
  void disciplineRoll;
```

Inside the slot loop, replace the `fit`-based score with the solution's value and add the gate:

```typescript
    const solution = solutions.get(i);
    if (!solution || solution.value < profile.minShotValue) continue;
    let score = solution.value * Math.max(weights[i] ?? 1, 0.01) * windowBonus;
```

Delete the now-unused `const fit = ...` line and the `distance > reach` check (the solver already
returns a zero-value solution beyond reach).

- [ ] **Step 4: Wire the solver into the controller**

In `controller.ts`'s `plan`, build the solutions map before `chooseSlot` and pass it:

```typescript
    const predictor = target ? constantVelocityPredictor(target) : undefined;
    const solutions = new Map<number, FiringSolution>();
    if (target && predictor) {
      for (let i = 0; i < self.slots.length; i++) {
        const candidate = self.slots[i]!;
        if (!slotIsReady(candidate, tick)) continue;
        solutions.set(i, solve({
          shooter: {
            sessionId: self.sessionId, carId: self.carId, team: self.team,
            x: self.x, y: self.y, angle: self.angle, speed: self.speed,
            lockTargetSessionId: self.lockTargetSessionId,
          },
          slot: candidate, slotIndex: i, target, targetAt: predictor,
          aimSigmaRad: profile.aimErrorSigmaRad, tick, arena: view.arena,
        }));
      }
    }
```

Pass `solutions` to `chooseSlot` and drop `aimDelta` from that call. Delete the `aimPoint` /
`aimHeading` / `aimDelta` / `bodyIntercept` block's `leadFactor` uses by replacing
`profile.leadFactor` with `1` — plan 3 replaces this whole block. Keep `aimHeading` itself; the
`fight` and `reset` cases still steer by it.

- [ ] **Step 5: Migrate the profile**

In `bot-profiles.ts`: delete `fireConeRad`, `fireDisciplineChance`, `orbitBias` and `leadFactor` from
the `BotProfile` interface and from all three tier objects. Add to the Fire economy group:

```typescript
  /**
   * Expected damage per second of gun time a shot must be worth before this bot takes it (P14).
   *
   * The EV threshold IS discipline — it replaced `fireDisciplineChance`, which gated on distance
   * rather than on whether the shot would land. Low means an amateur who sprays; high means a
   * skilled player who only spends gun time on shots that pay.
   */
  readonly minShotValue: number;
```

with values `easy: 2`, `medium: 12`, `hard: 26`. Bump:

```typescript
// 4.0.0 (2026-09-05): firing solutions replace the angular fire gate (spec phase B).
export const BOT_BRAIN_VERSION = "4.0.0";
```

In `bot-profiles.test.ts`, remove the four deleted keys from `LADDER` and add:

```typescript
  minShotValue: "rises",
```

- [ ] **Step 6: Run the full suite**

```bash
npm test
```

Run from the repo root, never per-workspace. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/bot packages/server/src/config/bot-profiles.ts packages/server/src/config/bot-profiles.test.ts
git commit -m "feat(bot): gate firing on expected value instead of an angle

fireConeRad was an angular tolerance with no relation to whether a shot would
connect: at hard's fighting range its 0.2 rad cone was 3.5x wider than the car
it was shooting at, which is what 'its shots are all over the place' was.

chooseSlot now ranks and gates on the solver's value -- expected damage per
second of gun time -- so a 35% predator shot on a 1s cooldown correctly
outranks a 90% lance on 16s, and a bot with shaky hands declines long shots
because it knows its own hands are shaky.

fireDisciplineChance goes with it: the threshold is the discipline. Its rng
draw stays, discarded, because the per-call count must not change (H21).

BOT_BRAIN_VERSION 4.0.0. Prior balance baselines are correctly refused.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Ground-truth the solver against the real sim (P48)

The strongest guarantee in the design: the solver's claim is checked against what the sim actually
does, not against itself.

**Files:**
- Test: `packages/server/src/bot/brain/solution.test.ts`

**Interfaces:**
- Consumes: `solve`, `AIM_QUADRATURE`.
- Produces: no exported names.

- [ ] **Step 1: Write the test**

```typescript
describe("solver ground truth (P48)", () => {
  it("agrees with resolveInstanceHits about whether a predator shot lands", () => {
    // Walk the target across a range of lateral offsets. For each, ask the solver with perfect
    // hands, then fire the real shot through the sim and see whether it connects. The two must
    // agree on every offset -- this is what makes the solver honest about the game rather than
    // merely self-consistent.
    for (let offset = 0; offset <= 60; offset += 10) {
      const target = targetAt(400, offset);
      const claimed = solve({
        shooter: shooterAt(0, 0, 0),
        slot: slotFor("predator"), slotIndex: 0,
        target, targetAt: constantVelocityPredictor(target),
        aimSigmaRad: 0, tick: 0, arena,
      }).hitChance > 0.5;

      const actual = firesAndConnects("predator", shooterAt(0, 0, 0), target);
      expect(actual, `lateral offset ${offset}`).toBe(claimed);
    }
  });
});

/** Fire one real press through the sim and report whether it touches the target's hull. */
function firesAndConnects(
  weaponId: Parameters<typeof weaponDefOf>[0],
  shooter: SolverShooter,
  target: BotCarView,
): boolean {
  const { instances } = spawnInstances(
    { weaponId, slot: 0, finalVolley: true, pressId: "truth" },
    {
      sessionId: shooter.sessionId, team: shooter.team, carId: shooter.carId,
      x: shooter.x, y: shooter.y, angle: shooter.angle,
    },
    0, 0,
  );
  const hull = carHullOf(target.x, target.y, target.angle);
  const def = weaponDefOf(weaponId);
  if (def.kind !== "projectile") throw new Error("helper handles projectiles only");

  for (const start of instances) {
    let instance = start;
    let previous = projectileShapeAt(def.hitbox, instance.x, instance.y, instance.angle);
    for (let tick = 1; tick <= 120; tick++) {
      instance = stepInstance(instance, {
        dt: 1 / TICK_RATE_HZ, tick,
        obstacles: arena.obstacles,
        bounds: { width: arena.width, height: arena.height },
        ownerPose: { x: shooter.x, y: shooter.y, angle: shooter.angle },
        homingTarget: { x: target.x, y: target.y },
      });
      const current = projectileShapeAt(def.hitbox, instance.x, instance.y, instance.angle);
      if (shapeHitsObb(smear(previous, current), hull)) return true;
      previous = current;
      if (instanceExpired(instance, tick)) break;
    }
  }
  return false;
}
```

Add the shared imports the helper needs at the top of the test file: `TICK_RATE_HZ`, `carHullOf`,
`instanceExpired`, `projectileShapeAt`, `shapeHitsObb`, `smear`, `spawnInstances`, `stepInstance`.

- [ ] **Step 2: Run it**

```bash
npx vitest run src/bot/brain/solution.test.ts -t "ground truth"
```

Expected: PASS. **If it fails, the solver is wrong, not the test** — fix `solution.ts` and re-run.
A disagreement here is exactly the class of bug this test exists to catch.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/bot/brain/solution.test.ts
git commit -m "test(bot): ground the solver against the real sim

Asserts the solver's verdict matches what spawnInstances + stepInstance +
shapeHitsObb actually do, across a sweep of lateral offsets. Without this the
solver could only be self-consistent; with it, a drift in hull construction,
expiry handling or the muzzle offset fails the suite.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Determinism guard (P43, P51)

**Files:**
- Test: `packages/server/src/bot/brain/solution.test.ts`

- [ ] **Step 1: Write the test**

```typescript
describe("solver determinism (P43)", () => {
  it("draws no random numbers at all", () => {
    const target = targetAt(400, 0);
    const throwing = () => {
      throw new Error("the solver must not draw rng (P43)");
    };
    // The solver takes no rng parameter by design; this guards against one being threaded in
    // later, and against a helper reaching for Math.random.
    const original = Math.random;
    Math.random = throwing as unknown as typeof Math.random;
    try {
      expect(() => solve({
        shooter: shooterAt(0, 0, 0),
        slot: slotFor("predator"), slotIndex: 0,
        target, targetAt: constantVelocityPredictor(target),
        aimSigmaRad: 0.05, tick: 0, arena,
      })).not.toThrow();
    } finally {
      Math.random = original;
    }
  });

  it("returns identical results for identical inputs", () => {
    const target = targetAt(400, 25);
    const once = () => solve({
      shooter: shooterAt(0, 0, 0.1),
      slot: slotFor("predator"), slotIndex: 0,
      target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad: 0.05, tick: 0, arena,
    });
    expect(once()).toEqual(once());
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/bot/brain/solution.test.ts -t "determinism"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/bot/brain/solution.test.ts
git commit -m "test(bot): guard that the solver draws no randomness

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Docs, skill and the balance README (P42, P57, P58a, P58b)

**Not optional and not deferrable.** `bot-tuner` fires automatically on any "the bot feels wrong"
phrasing; left stale it will propose edits to `fireConeRad`, which no longer exists, for the whole
duration of plans 2 and 3.

**Files:**
- Modify: `docs/bot-behavior.md`
- Modify: `.claude/skills/bot-tuner/SKILL.md`
- Modify: `packages/server/balance/README.md`

- [ ] **Step 1: Update `docs/bot-behavior.md`**

- Change the `BOT_BRAIN_VERSION` line to `4.0.0` and the "Copied from" date.
- In the **Aim (hands)** table, delete the `fireConeRad` and `leadFactor` rows.
- In the **Fire economy** table, delete `fireDisciplineChance`, add `minShotValue` with `2 / 12 / 26`.
- In **Positioning**, delete the `orbitBias` row.
- In **Reading a complaint**, replace these rows:
  - `"medium is too hard to hit"` → `aimErrorSigmaRad` up; `minShotValue` down widens what it will
    try, `minShotValue` up makes it pickier and therefore deadlier.
  - `"hard isn't attacking / holds fire"` → `minShotValue` down. Check the overlay first: `fight`
    with a low EV ratio means it is correctly declining shots it cannot make.
  - `"shots are all over the place"` → **new row.** Not a knob. The solver decides this; if it is
    firing shots that miss, that is a solver bug, not a tuning problem.
  - Delete the `"weaves instead of fighting"` row's `orbitBias` advice; orbiting no longer exists
    until plan 4 reintroduces it as emergent.
- Add, under the pipeline section:

```markdown
**Expect a skilled bot to fire noticeably LESS often than before 4.0.0, and hit far more.** The
trigger is now expected value per second of gun time, so a shot that will not land is not taken.
Fewer, deadlier shots is the intended shape, not a regression.
```

- [ ] **Step 2: Update `.claude/skills/bot-tuner/SKILL.md`**

- Delete the closing line `` `aimToleranceRad` must stay **below** `fireConeRad` on that same row. ``
  — both fields are gone or going.
- In the complaint table, apply the same row replacements as Step 1.
- Replace the "Path" step 2 with a diagnostic that reads the overlay first:

```markdown
2. **Read the overlay before naming a factor.** It prints `ev <best>/<threshold>`. If the best
   available EV is far below the threshold, the bot is correctly declining shots — the question is
   whether `minShotValue` is too high (tune it) or the solver is wrong about that weapon (a bug —
   stop and say so). If EV clears the threshold and it still holds fire, that is a bug too.
```

- Add to the "You do not" list: `**You do not tune around a solver bug.**`

- [ ] **Step 3: Correct the balance README (P57)**

Find the known-distortions section and replace the `wildcharge` claim:

```markdown
- ~~The bot cannot press `wildcharge`.~~ **Fixed in `BOT_BRAIN_VERSION` 4.0.0** — the solver sweeps
  the car's own hull for maneuver weapons, so `wildcharge` and `thunderclap` are now pressed. Reports
  from before 4.0.0 measured a Bastion that never used its third slot and are not comparable.
```

- [ ] **Step 4: Verify and commit**

```bash
npm test
```

```bash
git add docs/bot-behavior.md .claude/skills/bot-tuner/SKILL.md packages/server/balance/README.md
git commit -m "docs: update bot docs, tuner skill and balance README for brain 4.0.0

bot-tuner is a skill and fires automatically, so leaving it naming deleted knobs
would have it confidently proposing edits to fireConeRad through plans 2 and 3.
Its diagnostic now starts at the overlay's EV ratio rather than at the symptom.

The balance README's 'the bot cannot press wildcharge' distortion is no longer
true and is marked as fixed, with the note that older reports measured a Bastion
that never used its third slot.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Validation

Run every step. Record the results in the master index's Execution Tracker.

- [ ] **1. Full suite from the repo root**

```bash
npm test
```

Expected: all suites pass. A per-workspace run silently skips the server suite — do not substitute one.

- [ ] **2. Build, and confirm the worktree is not inlining the wrong shared**

```bash
npm run build
```

Then confirm `packages/server/dist/index.js` contains `// ../shared/dist/` and **not**
`// ../../../../../packages/shared/dist/`.

- [ ] **3. The symptom is gone (P49)**

Re-run Task 1's probe from the scratchpad (recreate it; it was deleted). Compare against the numbers
recorded in Task 1:

| Measure | Before (Task 1) | After | Bar |
|---|---|---|---|
| Fires in 300 ticks, hard vs stationary target | _record_ | _record_ | Greater than 10, and greater than before |
| Situations seen | _record_ | _record_ | Includes `fight` |

- [ ] **4. Play it**

```bash
npm run dev
```

Open `http://localhost:5173/?dev=playground`, spawn a hard bot, and stand still in front of it. It
must shoot you and kill you in a time that feels like a player, not a stalemate. Then check a hard
Bastion presses `wildcharge` at least once in a close fight.

- [ ] **5. Report — do not run these on the user's behalf**

State in the summary, loudly:

- **Playtest probes are affected.** This changes firing cadence, engagement range and — for the first
  time — makes the bot press `wildcharge`, which reaches ram trigger rates. Name the probes and the
  specific numbers after reading `packages/server/playtest/`, and **recommend** `npm run playtest`.
  Do not run it, and do not update a probe unless it fails to compile.
- **Balance baselines are invalidated.** `BOT_BRAIN_VERSION` moved to 4.0.0, so `--baseline` will
  refuse older reports. That is correct behaviour, not a bug.
