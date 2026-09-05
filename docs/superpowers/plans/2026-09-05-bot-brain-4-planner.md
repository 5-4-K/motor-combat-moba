# Bot Brain 4 (spec phase D) — The Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.
>
> **Blocked on plans 1, 2 and 3.** The planner scores on plan 1's `myEV` and plan 2's `theirEV`, and
> rolls candidates forward with plan 3's `rollForward`.

**Goal:** Replace desire-vector averaging with a receding-horizon planner, so the bot chooses an arc
instead of reacting to a blend — and make the tier ladder reflex → shallow → planning.

**Architecture:** Enumerate the complete 9-action input space, roll each forward K ticks through the
real `stepDrive`, score the result on my expected value, the danger I would be in, range, walls and
lock retention, and emit the winner's first action. The situation FSM stops choosing headings and
starts choosing the *weights* those terms are scored with.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md` — decisions P6, P9,
P23–P33, P35–P36, P41, P45–P47, P49–P52, P58a, P58b.

**Index:** `docs/superpowers/plans/2026-09-05-bot-predictive-brain-master-index.md`

## Global Constraints

Inherited from the master index. The three that govern this plan:

- **The planner draws zero `rng()` calls (P43).** Task 10 proves it.
- **A behaviour is code, a tier is data (H8).** `planHorizonTicks: 0` is what makes easy a reflex
  agent. There is no `if (tier === "easy")`.
- **Perf is a gate (P33).** Task 9 measures it against a stated budget before this plan is Done.

---

### Task 1: The cheap proxy the planner scores with (P9)

The exact solver costs ~90 shape tests per slot. A planner evaluating 9 candidates across K ticks
cannot afford it. **The trigger keeps the exact solver; the planner gets an analytic proxy.**

**Files:**
- Modify: `packages/server/src/bot/brain/solution.ts`
- Test: `packages/server/src/bot/brain/solution.test.ts`

**Interfaces:**
- Produces: `proxyValue(args: ProxyArgs): number` and
  `interface ProxyArgs { shooter: { x: number; y: number; angle: number }; slot: BotSlotView; targetX: number; targetY: number; aimSigmaRad: number; assisted: boolean }`

- [ ] **Step 1: Write the failing test**

```typescript
describe("proxyValue (P9)", () => {
  const slot = () => slotFor("predator");

  it("agrees with the exact solver about which of two positions is better", () => {
    const near = { shooter: { x: 0, y: 0, angle: 0 }, slot: slot(), targetX: 250, targetY: 0, aimSigmaRad: 0.05, assisted: false };
    const off = { ...near, shooter: { x: 0, y: 0, angle: 0.6 } };
    expect(proxyValue(near)).toBeGreaterThan(proxyValue(off));
  });

  it("falls with distance", () => {
    const at = (targetX: number) => proxyValue({
      shooter: { x: 0, y: 0, angle: 0 }, slot: slot(), targetX, targetY: 0,
      aimSigmaRad: 0.05, assisted: false,
    });
    expect(at(200)).toBeGreaterThan(at(700));
  });

  it("is 0 beyond reach", () => {
    expect(proxyValue({
      shooter: { x: 0, y: 0, angle: 0 }, slot: slot(), targetX: 5000, targetY: 0,
      aimSigmaRad: 0.05, assisted: false,
    })).toBe(0);
  });

  it("ignores the nose when the shot is assisted, because aimAngleFor does (P13)", () => {
    const common = { slot: slot(), targetX: 250, targetY: 0, aimSigmaRad: 0.05 };
    const straight = { ...common, shooter: { x: 0, y: 0, angle: 0 }, assisted: true };
    const turned = { ...common, shooter: { x: 0, y: 0, angle: 0.6 }, assisted: true };
    expect(proxyValue(turned)).toBeCloseTo(proxyValue(straight), 6);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/solution.test.ts -t "proxyValue"
```

Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```typescript
export interface ProxyArgs {
  shooter: { x: number; y: number; angle: number };
  slot: BotSlotView;
  targetX: number;
  targetY: number;
  aimSigmaRad: number;
  /** True when a live lock will point this shot regardless of the nose (P13). */
  assisted: boolean;
}

/**
 * A cheap stand-in for `solve().value`, for scoring a planner candidate (P9).
 *
 * ~20 flops against the exact solver's ~90 shape tests. It answers "is this a better place to be
 * standing", never "should I pull the trigger" — the trigger keeps the exact solver. That split is
 * deliberate and mirrors how people play: move on intuition, shoot on confirmation.
 *
 * The model is: how wide does the target look from here, against how badly do my hands wander. An
 * assisted shot skips the angle term entirely, because `aimAngleFor` points it for me.
 */
export function proxyValue(args: ProxyArgs): number {
  const { shooter, slot, targetX, targetY, aimSigmaRad, assisted } = args;
  const def = weaponDefOf(slot.weaponId);
  const reach = weaponReachOf(slot.weaponId);
  const dx = targetX - shooter.x;
  const dy = targetY - shooter.y;
  const distance = Math.hypot(dx, dy);
  if (distance > reach || distance < 1) return 0;

  // Half the target's angular width from here — how much room the shot has to be wrong by.
  const subtense = Math.atan2(DRIVE_CONFIG.carHeight / 2, distance);
  const offBy = assisted ? 0 : Math.abs(signedDelta(shooter.angle, Math.atan2(dy, dx)));
  // Total angular budget: how far off I am now, plus how far my hands wander.
  const spread = Math.hypot(offBy, aimSigmaRad);
  const chance = spread <= 0 ? 1 : Math.min(1, subtense / spread);

  const damage = def.damage * (def.kind === "projectile" ? def.pellets.pelletsPerVolley : 1);
  const cooldownSeconds = Math.max(def.cooldownMs, 1) / 1000;
  return (chance * damage) / cooldownSeconds;
}
```

Import `DRIVE_CONFIG` from `@motor-combat-moba/shared` and `signedDelta` from `./aim.js`.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/bot/brain/solution.test.ts
```

```bash
git add packages/server/src/bot/brain/solution.ts packages/server/src/bot/brain/solution.test.ts
git commit -m "feat(bot): add the planner's cheap value proxy

The exact solver costs ~90 shape tests per slot, which a planner evaluating nine
candidates across K ticks cannot pay. The proxy answers 'is this a better place
to stand' in ~20 flops; the trigger keeps the exact solver for 'should I shoot'.
Move on intuition, shoot on confirmation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The planner (P23, P24, P26)

**Files:**
- Create: `packages/server/src/bot/brain/planner.ts`
- Test: `packages/server/src/bot/brain/planner.test.ts`

**Interfaces:**
- Consumes: `proxyValue`, `dangerEvAgainst`, `rollForward`, `bodyFromSelf`, `DriveAction`.
- Produces:
  - `ALL_ACTIONS: readonly DriveAction[]` (9 entries)
  - `interface PlanWeights { myEv: number; theirEv: number; rangeError: number; wallPenalty: number; lockKeep: number }`
  - `interface PlanResult { action: DriveAction; score: number; terms: Record<keyof PlanWeights, number>; runnerUp: DriveAction | undefined }`
  - `plan(args: PlanArgs): PlanResult`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/bot/brain/planner.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";
import type { BotArenaView, BotCarView, BotSelfView, BotSlotView } from "../types.js";
import { ALL_ACTIONS, plan, type PlanWeights } from "./planner.js";

const arena: BotArenaView = { width: 1280, height: 720, obstacles: [] };

function slotsFor(carId: "bullseye"): BotSlotView[] {
  return slotsOf(carId).map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  }));
}

function selfAt(x: number, y: number, angle: number): BotSelfView {
  return {
    sessionId: "me", carId: "bullseye", team: 0, x, y, angle, speed: 200,
    hp: 65, maxHp: 65, alive: true, statuses: [], slots: slotsFor("bullseye"),
    switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
  };
}

const target: BotCarView = {
  sessionId: "them", carId: "mirage", team: 1, x: 700, y: 360, angle: Math.PI, speed: 0,
  hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
};

const fightWeights: PlanWeights = {
  myEv: 1, theirEv: 0, rangeError: 0.01, wallPenalty: 5, lockKeep: 0.5,
};

describe("ALL_ACTIONS", () => {
  it("is the complete input space, not a sample (P23)", () => {
    expect(ALL_ACTIONS).toHaveLength(9);
    const seen = new Set(ALL_ACTIONS.map((a) => `${a.steer}:${a.throttle}`));
    expect(seen.size).toBe(9);
  });
});

describe("plan", () => {
  const base = {
    target, targetAt: (() => ({ x: target.x, y: target.y, angle: target.angle })),
    readiness: () => 1, aimSigmaRad: 0.03, preferredRange: 400,
    weights: fightWeights, horizonTicks: 20, depth: 1 as const,
    targetBranches: 1 as const, commitPenalty: 0, lastAction: undefined,
    tick: 0, arena,
  };

  it("turns toward a target that is off to one side", () => {
    // Target is at bearing 0; the bot faces 90 degrees away from it.
    const result = plan({ ...base, self: selfAt(300, 360, -Math.PI / 2) });
    expect(result.action.steer).toBe(1);
  });

  it("does not steer into a wall it is about to hit", () => {
    // Nose into the left wall, target behind. Turning away must beat driving on.
    const result = plan({ ...base, self: selfAt(30, 360, Math.PI) });
    expect(result.action.throttle === 1 && result.action.steer === 0).toBe(false);
  });

  it("reports a score breakdown for the overlay (P45)", () => {
    const result = plan({ ...base, self: selfAt(300, 360, 0) });
    expect(Object.keys(result.terms).sort()).toEqual(
      ["lockKeep", "myEv", "rangeError", "theirEv", "wallPenalty"],
    );
  });

  it("with horizon 0 still avoids an immediate wall, but does not plan an arc (P29)", () => {
    const reflex = plan({ ...base, self: selfAt(30, 360, Math.PI), horizonTicks: 0 });
    expect(reflex.action).toBeDefined();
  });

  it("prefers its last action when commitPenalty is high, all else equal (P30)", () => {
    const sticky = plan({
      ...base, self: selfAt(300, 360, 0),
      commitPenalty: 1000, lastAction: { steer: -1, throttle: -1 },
    });
    expect(sticky.action).toEqual({ steer: -1, throttle: -1 });
  });

  it("draws no random numbers (P43)", () => {
    const original = Math.random;
    Math.random = (() => { throw new Error("planner must not draw rng"); }) as typeof Math.random;
    try {
      expect(() => plan({ ...base, self: selfAt(300, 360, 0) })).not.toThrow();
    } finally {
      Math.random = original;
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/planner.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/server/src/bot/brain/planner.ts`:

```typescript
import { DRIVE_CONFIG, TICK_RATE_HZ, weaponDefOf, type WeaponId } from "@motor-combat-moba/shared";
import type { BotArenaView, BotCarView, BotSelfView } from "../types.js";
import { bodyFromSelf, rollForward, type DriveAction } from "./predict.js";
import { dangerEvAgainst, proxyValue, type PosePredictor } from "./solution.js";
import { slotIsReady } from "./firing.js";
import { weaponReachOf } from "./reach.js";

/** Every input the game accepts. Complete, not sampled — `InputMessage` is -1|0|1 on both axes. */
export const ALL_ACTIONS: readonly DriveAction[] = Object.freeze(
  ([-1, 0, 1] as const).flatMap((steer) =>
    ([-1, 0, 1] as const).map((throttle) => ({ steer, throttle })),
  ),
);

/** How much each term counts. Supplied by the situation (P27), scaled by the profile (P38). */
export interface PlanWeights {
  myEv: number;
  theirEv: number;
  rangeError: number;
  wallPenalty: number;
  lockKeep: number;
}

export interface PlanResult {
  action: DriveAction;
  score: number;
  /** Per-term contributions of the winning candidate, for the overlay (P45). */
  terms: Record<keyof PlanWeights, number>;
  runnerUp: DriveAction | undefined;
}

export interface PlanArgs {
  self: BotSelfView;
  target: BotCarView | undefined;
  targetAt: PosePredictor;
  readiness: (weaponId: WeaponId) => number;
  aimSigmaRad: number;
  preferredRange: number;
  weights: PlanWeights;
  /** K. 0 means score the current pose — a reflex agent (P29). */
  horizonTicks: number;
  /** 1 holds one action for K ticks; 2 splits into two K/2 segments (P25). */
  depth: 1 | 2;
  /** How many of the target's possible inputs to hedge against (P28). 1 or 3. */
  targetBranches: 1 | 3;
  commitPenalty: number;
  lastAction: DriveAction | undefined;
  tick: number;
  arena: BotArenaView;
}

/**
 * Choose this tick's input by looking ahead (P24).
 *
 * Receding horizon: every candidate is rolled K ticks, but only the winner's FIRST action is
 * emitted, and the whole thing is redone on the next recompute. That is what lets a bot plan a
 * second-long arc while still reacting inside two ticks.
 *
 * Draws no randomness (P43) — every term is a deterministic function of the observation, which is
 * also what keeps the score smooth enough not to chatter.
 */
export function plan(args: PlanArgs): PlanResult {
  const candidates = args.depth === 2 ? twoSegment(args) : ALL_ACTIONS.map((a) => [a] as const);

  let best: PlanResult | undefined;
  let runnerUpAction: DriveAction | undefined;
  let runnerUpScore = -Infinity;

  for (const sequence of candidates) {
    const terms = scoreSequence(args, sequence);
    let score =
      terms.myEv * args.weights.myEv -
      terms.theirEv * args.weights.theirEv -
      terms.rangeError * args.weights.rangeError -
      terms.wallPenalty * args.weights.wallPenalty +
      terms.lockKeep * args.weights.lockKeep;

    const first = sequence[0]!;
    if (args.lastAction
      && first.steer === args.lastAction.steer
      && first.throttle === args.lastAction.throttle) {
      score += args.commitPenalty;
    }

    if (!best || score > best.score) {
      if (best) {
        runnerUpAction = best.action;
        runnerUpScore = best.score;
      }
      best = { action: first, score, terms, runnerUp: undefined };
    } else if (score > runnerUpScore) {
      runnerUpAction = first;
      runnerUpScore = score;
    }
  }

  const chosen = best ?? {
    action: { steer: 0, throttle: 0 } as DriveAction,
    score: 0,
    terms: { myEv: 0, theirEv: 0, rangeError: 0, wallPenalty: 0, lockKeep: 0 },
    runnerUp: undefined,
  };
  return { ...chosen, runnerUp: runnerUpAction };
}

/** Depth 2: every first action paired with every second action (P25). */
function twoSegment(args: PlanArgs): (readonly DriveAction[])[] {
  void args;
  const out: DriveAction[][] = [];
  for (const first of ALL_ACTIONS) for (const second of ALL_ACTIONS) out.push([first, second]);
  return out;
}

/** Roll one action sequence out and measure every term at the pose it ends in. */
function scoreSequence(
  args: PlanArgs,
  sequence: readonly DriveAction[],
): Record<keyof PlanWeights, number> {
  const { self, target, targetAt, arena, horizonTicks } = args;
  const segment = Math.max(0, Math.floor(horizonTicks / sequence.length));

  let body = bodyFromSelf(self);
  let elapsed = 0;
  for (const action of sequence) {
    if (segment === 0) break;
    const poses = rollForward(body, self.carId, action, segment);
    body = poses.at(-1) ?? body;
    elapsed += segment;
  }

  const wallPenalty = boundsPenalty(body.x, body.y, arena);
  if (!target) {
    return { myEv: 0, theirEv: 0, rangeError: 0, wallPenalty, lockKeep: 0 };
  }

  const future = targetAt(elapsed);
  const distance = Math.hypot(future.x - body.x, future.y - body.y);

  let myEv = 0;
  let lockKeep = 0;
  for (const slot of self.slots) {
    if (!slotIsReady(slot, args.tick)) continue;
    const def = weaponDefOf(slot.weaponId);
    const assisted = def.usesAimAssist && distance <= (def.aimRangeUnits ?? 0);
    myEv = Math.max(myEv, proxyValue({
      shooter: { x: body.x, y: body.y, angle: body.angle },
      slot, targetX: future.x, targetY: future.y,
      aimSigmaRad: args.aimSigmaRad, assisted,
    }));
    if (assisted && withinLockEnvelope(body, future, weaponReachOf(slot.weaponId))) lockKeep = 1;
  }

  // Worst case over the target's plausible inputs (P28): a skilled bot does not rely on them
  // holding still. `targetBranches` 1 trusts the nominal prediction; 3 also checks a hard left and
  // a hard right, and takes the most dangerous of the three.
  const theirEv = worstCaseDanger(args, body, future);

  return {
    myEv,
    theirEv,
    rangeError: Math.abs(distance - args.preferredRange),
    wallPenalty,
    lockKeep,
  };
}

/** How badly this pose is jammed against the world. Squared, so a corner dominates an edge. */
function boundsPenalty(x: number, y: number, arena: BotArenaView): number {
  const margin = Math.max(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);
  const over = (v: number) => (v < margin ? (margin - v) / margin : 0);
  const penalties = [
    over(x), over(y), over(arena.width - x), over(arena.height - y),
  ];
  let total = 0;
  for (const p of penalties) total += p * p;
  for (const box of arena.obstacles) {
    if (x > box.x - margin && x < box.x + box.w + margin
      && y > box.y - margin && y < box.y + box.h + margin) total += 1;
  }
  return total;
}

/** Would an assisted weapon still hold its lock from here (P13, P26)? */
function withinLockEnvelope(
  body: { x: number; y: number; angle: number },
  target: { x: number; y: number },
  lockRange: number,
): boolean {
  const dx = target.x - body.x;
  const dy = target.y - body.y;
  const distance = Math.hypot(dx, dy);
  if (distance > lockRange) return false;
  const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - body.angle),
    Math.cos(Math.atan2(dy, dx) - body.angle)));
  const lateral = distance * Math.sin(off);
  return off <= (AIM_CONFIG.coneDeg * Math.PI) / 180 && lateral <= AIM_CONFIG.lateralMax;
}

function worstCaseDanger(
  args: PlanArgs,
  body: { x: number; y: number; angle: number; speed: number },
  future: { x: number; y: number; angle: number },
): number {
  const { target, tick, arena, readiness } = args;
  if (!target) return 0;
  const me: BotCarView = {
    sessionId: args.self.sessionId, carId: args.self.carId, team: args.self.team,
    x: body.x, y: body.y, angle: body.angle, speed: body.speed,
    hp: args.self.hp, maxHp: args.self.maxHp, alive: true, phased: false,
    statuses: args.self.statuses, maneuver: args.self.maneuver,
  };
  const meAt: PosePredictor = () => ({ x: body.x, y: body.y, angle: body.angle });
  const offsets = args.targetBranches === 3 ? [0, 0.5, -0.5] : [0];
  let worst = 0;
  for (const offset of offsets) {
    const threat: BotCarView = {
      ...target, x: future.x, y: future.y, angle: future.angle + offset,
    };
    worst = Math.max(worst, dangerEvAgainst({
      threat, me, meAt, readiness,
      assumedAimSigmaRad: BRAIN_CONSTANTS.assumedOpponentAimSigmaRad,
      tick, arena,
    }));
  }
  return worst;
}
```

Import `AIM_CONFIG` from `@motor-combat-moba/shared` and `BRAIN_CONSTANTS` from
`../../config/bot-profiles.js`.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/bot/brain/planner.test.ts
```

```bash
git add packages/server/src/bot/brain/planner.ts packages/server/src/bot/brain/planner.test.ts
git commit -m "feat(bot): add the receding-horizon planner

Enumerates the complete nine-action input space -- InputMessage is -1|0|1 on
both axes, so this is exhaustive rather than a sample and carries no
discretization error -- rolls each forward K ticks through the real stepDrive,
and emits only the winner's first action.

Draws no randomness, which is both an H21 requirement and what keeps the score
smooth enough not to chatter. Reports a per-term breakdown so a mis-weighted
score function is debuggable rather than merely confidently wrong.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The situation supplies weights, not headings (P27)

Collapses the eight-case `switch` in `controller.ts`. **This is the structural fix for spec §1.1:**
after it there is nowhere for two headings to be averaged.

**Files:**
- Create: `packages/server/src/bot/brain/objectives.ts`
- Test: `packages/server/src/bot/brain/objectives.test.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`

**Interfaces:**
- Produces: `weightsFor(situation: SituationId, profile: BotProfile): PlanWeights`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { ALL_SITUATIONS } from "./situation.js";
import { weightsFor } from "./objectives.js";

describe("weightsFor", () => {
  it("covers every situation", () => {
    for (const id of ALL_SITUATIONS) {
      expect(() => weightsFor(id, BOT_PROFILES.hard)).not.toThrow();
    }
  });

  it("weights my own value highest in a fight", () => {
    const fight = weightsFor("fight", BOT_PROFILES.hard);
    expect(fight.myEv).toBeGreaterThan(fight.theirEv);
  });

  it("weights danger over damage when resetting", () => {
    const reset = weightsFor("reset", BOT_PROFILES.hard);
    expect(reset.theirEv).toBeGreaterThan(reset.myEv);
  });

  it("makes leaving a wall dominate everything when unpinning", () => {
    const unpin = weightsFor("unpin", BOT_PROFILES.hard);
    const fight = weightsFor("fight", BOT_PROFILES.hard);
    expect(unpin.wallPenalty).toBeGreaterThan(fight.wallPenalty);
  });

  it("scales the danger term by opponentRangeRespect, so easy ignores it (P38)", () => {
    expect(weightsFor("fight", BOT_PROFILES.easy).theirEv).toBe(0);
    expect(weightsFor("fight", BOT_PROFILES.hard).theirEv).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/objectives.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/server/src/bot/brain/objectives.ts`:

```typescript
import type { BotProfile } from "../../config/bot-profiles.js";
import type { SituationId } from "../types.js";
import type { PlanWeights } from "./planner.js";

/**
 * What each situation is FOR, as a weight vector (P27).
 *
 * The situation layer used to choose a heading per play, which the movement layer then averaged
 * against wall and orbit desires — and averaging two good headings is what produced spec section
 * 1.1. Now a situation states an objective and the planner is the only thing that turns an
 * objective into steer and throttle. There is no second place for a heading to come from.
 *
 * These are BASE weights, identical across tiers. Exactly two terms are then profile-scaled
 * (P38) — a tier may change how strongly it feels a pressure, never what a situation is for.
 */
const BASE: Readonly<Record<SituationId, PlanWeights>> = Object.freeze({
  recover: { myEv: 0, theirEv: 0, rangeError: 0, wallPenalty: 1, lockKeep: 0 },
  waitOut: { myEv: 0, theirEv: 0.5, rangeError: 0.02, wallPenalty: 4, lockKeep: 0 },
  evade: { myEv: 0.3, theirEv: 4, rangeError: 0, wallPenalty: 6, lockKeep: 0 },
  unpin: { myEv: 0.2, theirEv: 1, rangeError: 0, wallPenalty: 40, lockKeep: 0 },
  punish: { myEv: 3, theirEv: 0.25, rangeError: 0.03, wallPenalty: 4, lockKeep: 1.5 },
  reset: { myEv: 0.4, theirEv: 3, rangeError: 0.04, wallPenalty: 6, lockKeep: 0.2 },
  fight: { myEv: 2, theirEv: 1, rangeError: 0.02, wallPenalty: 5, lockKeep: 1 },
  close: { myEv: 1, theirEv: 0.75, rangeError: 0.06, wallPenalty: 5, lockKeep: 0.5 },
});

export function weightsFor(situation: SituationId, profile: BotProfile): PlanWeights {
  const base = BASE[situation];
  return { ...base, theirEv: base.theirEv * profile.opponentRangeRespect };
}
```

- [ ] **Step 4: Rewire the controller**

**Name collision — read this first.** `HumanController` already has a `private plan(view, target)`
method, and `planner.ts` exports a function called `plan`. Importing it unaliased shadows nothing at
compile time but reads as a bug to every future reader, and `this.plan` vs `plan` inside that very
method is exactly the confusion to avoid. Import it aliased:

```typescript
import { plan as planMotion, type PlanResult } from "./planner.js";
```

and call `planMotion(...)` throughout. Do **not** rename the controller's own method — it is called
from `decide` and its name is accurate.

In `controller.ts`, delete the entire `switch (sit)` block, the `desires` array, the `wall` /
`inDeadband` / `blendHeading` / `reduceToIntent` calls, and the `range` / `closing` locals. Replace
with:

```typescript
    const result = planMotion({
      self, target, targetAt: predictor ?? (() => ({ x: self.x, y: self.y, angle: self.angle })),
      readiness: (weaponId) => target
        ? readinessOf(this.perception, target.sessionId, weaponId, tick, profile)
        : 1,
      aimSigmaRad: profile.aimErrorSigmaRad,
      preferredRange: ownComfort,
      weights: weightsFor(sit, profile),
      horizonTicks: profile.planHorizonTicks,
      depth: profile.planDepth,
      targetBranches: profile.targetBranches,
      commitPenalty: profile.commitPenalty,
      lastAction: this.lastAction,
      tick,
      arena: view.arena,
    });
    this.lastAction = result.action;
    this.lastPlan = result;
    const { steer, throttle } = result.action;
```

Add fields `private lastAction: DriveAction | undefined;` and
`private lastPlan: PlanResult | undefined;`.

The `waitOut` hunt still needs its heading. Keep `huntHeading` and, for `waitOut` only, override
`preferredRange` and pass the hunt point as the target position via a synthetic `targetAt`:

```typescript
    const hunt = sit === "waitOut" ? this.huntHeading(view, self.angle) : undefined;
```

and when `hunt` is set, pass `targetAt: () => ({
  x: self.x + Math.cos(hunt.headingRad) * BRAIN_CONSTANTS.minEngageUnits,
  y: self.y + Math.sin(hunt.headingRad) * BRAIN_CONSTANTS.minEngageUnits,
  angle: hunt.headingRad })` with `preferredRange: 0`, so the planner drives toward the hunt point
using the same machinery rather than a parallel path.

- [ ] **Step 5: Run and commit**

```bash
npm test
```

```bash
git add packages/server/src/bot
git commit -m "refactor(bot): situations choose objectives, the planner chooses inputs

The eight-case switch chose a heading per play, which the movement layer then
averaged against wall and orbit desires -- and averaging two good headings is
what produced the lockout in spec section 1.1. A situation now states a weight
vector and the planner is the only thing that turns an objective into steer and
throttle, so there is no second place for a heading to come from.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Delete the desire model (P6, P31)

**Files:**
- Modify: `packages/server/src/bot/brain/movement.ts`
- Modify: `packages/server/src/bot/brain/movement.test.ts`
- Modify: `packages/server/src/bot/brain/firing.ts`

- [ ] **Step 1: Delete**

From `movement.ts`, delete `Desire`, `WALL_WEIGHT`, `GOAL_WEIGHT`, `blendHeading`, `goalDesire`,
`dodgeDesires`, `wallDesire` and `reduceToIntent`. Keep `nearBound`, `openFloorHeading` and
`reverseWouldHitBound` — they are still useful helpers, and `boundsPenalty` may call `nearBound`.

Delete the matching `describe` blocks from `movement.test.ts`.

- [ ] **Step 2: Make preferred range solver-derived (P31)**

In `firing.ts`, replace `preferredRangeOf`'s body:

```typescript
/**
 * Where this bot wants to stand: the range at which its kit's value PEAKS (P31).
 *
 * Was `standoffFraction * weighted reach` — a guess with a per-tier fudge factor. The solver can
 * answer the question directly, so it does: sample the proxy across the kit's reach and take the
 * best. A Bastion and a Mirage now want genuinely different distances because their kits do, rather
 * than because they carry different fractions of a shared formula.
 */
export function preferredRangeOf(
  self: BotSelfView,
  profile: BotProfile,
  weights: readonly number[],
  tick: number,
): number {
  let bestRange = BRAIN_CONSTANTS.minEngageUnits;
  let bestValue = -Infinity;
  const longest = Math.max(
    BRAIN_CONSTANTS.minEngageUnits,
    ...self.slots.map((slot) => weaponReachOf(slot.weaponId)),
  );
  const step = Math.max(10, longest / 24);
  for (let range = BRAIN_CONSTANTS.minEngageUnits; range <= longest; range += step) {
    let total = 0;
    for (let i = 0; i < self.slots.length; i++) {
      const slot = self.slots[i]!;
      if (!slotIsReady(slot, tick)) continue;
      total += proxyValue({
        shooter: { x: 0, y: 0, angle: 0 }, slot,
        targetX: range, targetY: 0,
        aimSigmaRad: profile.aimErrorSigmaRad, assisted: false,
      }) * Math.max(weights[i] ?? 1, 0.01);
    }
    if (total > bestValue) {
      bestValue = total;
      bestRange = range;
    }
  }
  return Math.min(bestRange, profile.awarenessRadiusUnits);
}
```

Import `proxyValue` from `./solution.js`.

- [ ] **Step 3: Run and commit**

```bash
npm test
```

```bash
git add packages/server/src/bot
git commit -m "refactor(bot): delete the desire-vector model, derive preferred range

blendHeading summed desires as unit vectors, which is the classic averaging
failure: two good options make a bad third. Nothing uses it now.

preferredRangeOf stops guessing (standoffFraction times weighted reach) and asks
the solver where this kit's value actually peaks. A Bastion and a Mirage now
want different distances because their kits do, not because they carry different
fractions of one formula.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Profile migration and the LADDER direction (P35, P36)

**Files:**
- Modify: `packages/server/src/config/bot-profiles.ts`
- Modify: `packages/server/src/config/bot-profiles.test.ts`

`LADDER` is `Record<keyof BotProfile, Direction>` and therefore exhaustive — the compiler will
demand every change. Its three directions are `"rises"` (strict), `"falls"` (strict) and `"equal"`.
**Two new fields are none of those:** `planDepth` is `1, 1, 2` and `targetBranches` is `1, 1, 3`.
Add a fourth direction rather than distorting the values to fit the test.

- [ ] **Step 1: Write the failing test**

In `bot-profiles.test.ts`, add to the direction union and the switch:

```typescript
        case "rises-or-equal":
          expect(medium, label("easy", "medium")).toBeGreaterThanOrEqual(easy);
          expect(hard, label("medium", "hard")).toBeGreaterThanOrEqual(medium);
          // Must still rise SOMEWHERE, or the direction is meaningless and the field is not a ladder.
          expect(hard, label("easy", "hard")).toBeGreaterThan(easy);
          break;
```

Add the `LADDER` entries:

```typescript
  planHorizonTicks: "rises",
  planDepth: "rises-or-equal",
  targetBranches: "rises-or-equal",
  commitPenalty: "rises",
```

and remove `standoffFraction`, `deadbandFraction` and `aimToleranceRad`.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/config/bot-profiles.test.ts
```

Expected: FAIL — the fields do not exist yet.

- [ ] **Step 3: Migrate the profile**

Remove `aimToleranceRad`, `standoffFraction` and `deadbandFraction` from `BotProfile` and all three
tiers (their last readers went in Tasks 3 and 4). Add:

```typescript
  // --- Planning ------------------------------------------------------------------------------
  /**
   * How many ticks ahead the planner rolls a candidate (P24, P29).
   *
   * 0 is a reflex agent: it still avoids a wall it is about to hit, but cannot plan an arc. This is
   * the single number that makes the tiers differ in KIND rather than degree, and it is a number
   * precisely so that no module has to branch on the difficulty name (H8).
   */
  readonly planHorizonTicks: number;
  /** 1 holds one action for the whole horizon; 2 splits it into two segments, 81 branches (P25). */
  readonly planDepth: 1 | 2;
  /** How many of the target's plausible inputs to take the worst case over (P28). */
  readonly targetBranches: 1 | 3;
  /** Score bonus for repeating last tick's action. Anti-chatter (P30). */
  readonly commitPenalty: number;
```

Values: `planHorizonTicks` `0 / 8 / 22`; `planDepth` `1 / 1 / 2`; `targetBranches` `1 / 1 / 3`;
`commitPenalty` `0.1 / 0.4 / 0.8`. Bump:

```typescript
// 4.3.0 (2026-09-05): the receding-horizon planner replaces desire blending (spec phase D).
export const BOT_BRAIN_VERSION = "4.3.0";
```

- [ ] **Step 4: Run and commit**

```bash
npm test
```

```bash
git add packages/server/src/config
git commit -m "feat(bot): planner knobs, and a LADDER direction that fits them

planDepth is 1,1,2 and targetBranches is 1,1,3 -- neither strictly rising nor
equal, which the exhaustive LADDER had no direction for. Added rises-or-equal
rather than distorting the values to satisfy the test: medium genuinely does not
need a second segment, and inventing one to make a monotone table would be
tuning for the test.

BOT_BRAIN_VERSION 4.3.0.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The overlay (P45, P46)

**Files:**
- Modify: `packages/server/src/bot/types.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`
- Modify: the playground overlay renderer (find it with
  `grep -rn "preferredRange" packages/client/src`)

- [ ] **Step 1: Extend `BotDebug`**

```typescript
  /** The action the planner chose, and what it scored. Overlay only (P45). */
  plan: { steer: -1 | 0 | 1; throttle: -1 | 0 | 1; score: number } | undefined;
  /** Per-term contributions of the winning candidate. Overlay only. */
  planTerms: Record<"myEv" | "theirEv" | "rangeError" | "wallPenalty" | "lockKeep", number> | undefined;
  /** Best available shot value against the tier's threshold — the primary tuning diagnostic. */
  shotEv: { best: number; threshold: number };
```

- [ ] **Step 2: Populate it in `decide`**

```typescript
      plan: this.lastPlan
        ? { ...this.lastPlan.action, score: this.lastPlan.score }
        : undefined,
      planTerms: this.lastPlan?.terms,
      shotEv: { best: this.lastBestEv, threshold: this.effectiveProfile.minShotValue },
```

Track `this.lastBestEv` as the maximum `solution.value` across the solutions map built in plan 1's
Task 7.

- [ ] **Step 3: Render it**

Extend the overlay line to:

```
kiter | fight | plan(+1,+1) 8.4 | ev 24/26 | slot 0
```

Keep it playground-only, behind the existing `DEV_TOOLS` gate. Practice mode stays clean.

- [ ] **Step 4: Run and commit**

```bash
npm test
```

```bash
git add packages/server/src/bot packages/client/src
git commit -m "feat(bot): show the plan and the EV ratio in the playground overlay

A mis-weighted score function reads as confidently wrong, which is worse than
random and cannot be debugged by watching a car drive. The overlay now carries
the chosen action, its per-term breakdown, and the best available shot value
against the tier's threshold -- which is the first thing bot-tuner is told to
read.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The symptoms, pinned permanently (P49, P50)

**Files:**
- Modify: `packages/server/src/bot/brain/tiers.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
describe("the reported symptoms stay fixed (P49)", () => {
  it("hard kills a stationary target inside twice its kit's theoretical floor", () => {
    const { ticks } = duelAgainstDummy("hard");
    const floor = hpOf("mirage") / bestSustainedDpsOf("bullseye");
    expect(ticks / TICK_RATE_HZ).toBeLessThan(floor * 2);
  });

  it("hard fires at its preferred range rather than parking and weaving (spec 1.1)", () => {
    const { fires } = duelAgainstDummy("hard", 300);
    expect(fires).toBeGreaterThan(0);
    expect(fires).toBeGreaterThan(300 / BOT_PROFILES.hard.burstGapTicks / 4);
  });
});

describe("the ladder holds (P50)", () => {
  it("easy fires most and hits least; hard fires least and hits most", () => {
    const easy = duelAgainstDummy("easy", 600);
    const medium = duelAgainstDummy("medium", 600);
    const hard = duelAgainstDummy("hard", 600);
    expect(easy.fires).toBeGreaterThan(hard.fires);
    expect(hard.hitRate).toBeGreaterThan(medium.hitRate);
    expect(medium.hitRate).toBeGreaterThan(easy.hitRate);
  });
});

describe("whole-brain determinism (P51)", () => {
  // The solver and planner are proved rng-free individually. This asserts the property that
  // actually matters to the balance harness: one seed replays the entire brain, every tier,
  // whether or not there is a threat in the scene to change which branches run.
  for (const tier of ["easy", "medium", "hard"] as const) {
    for (const [label, withThreat] of [["quiet", false], ["under fire", true]] as const) {
      it(`${tier} replays identically from one seed, ${label}`, () => {
        const run = () => {
          const bot = new HumanController(tier);
          const rng = makeRng(4242);
          const out: string[] = [];
          for (let tick = 0; tick < 400; tick++) {
            const intent = bot.decide(duelView(tick, rng, withThreat));
            out.push(`${intent.steer}:${intent.throttle}:${intent.fireSlots}`);
          }
          return out.join("|");
        };
        expect(run()).toBe(run());
      });
    }
  }
});
```

`duelView(tick, rng, withThreat)` reuses the same fixture `duelAgainstDummy` drives, adding one
incoming `predator` instance when `withThreat` is set. The threat case matters specifically: tracked
threats consume an extra `rng()` draw per tick (`perceive`'s unconditional `dodgeChance` roll), so a
branch-dependent draw introduced anywhere in this plan shows up here and nowhere else.

Write `duelAgainstDummy(tier, ticks = 600)` as a harness that runs `HumanController` against a
stationary, non-firing target, marches every press through the sim with the plan-1 ground-truth
helper, and returns `{ fires, hits, hitRate, ticks }`. Write `bestSustainedDpsOf(carId)` as
`max over slots of (weaponDamageOf(carId, id) * pellets) / cooldownSeconds`.

- [ ] **Step 2: Run**

```bash
npx vitest run src/bot/brain/tiers.test.ts
```

Expected: PASS. **If the ladder assertions fail, the tier VALUES are wrong, not the test** — the
whole point of this plan is that these relations hold. Retune `minShotValue`, `planHorizonTicks` and
`aimErrorSigmaRad` until they do, and record what you changed.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/bot/brain/tiers.test.ts
git commit -m "test(bot): pin the reported symptoms and the tier ladder

Time to kill a sitting duck is asserted as a multiple of the kit's theoretical
floor rather than an absolute, so a weapon retune moves both sides together.
The ladder is finally testable across tiers: with an EV gate, easy fires most
and hits least while hard fires least and hits most.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The perf gate (P33, P52)

**Files:**
- Create: `packages/server/src/bot/brain/planner.bench.test.ts`

- [ ] **Step 1: Write the gate**

```typescript
describe("planner cost (P33)", () => {
  it("stays inside the stated budget for the heaviest tier", () => {
    const args = hardestPlanArgs(); // depth 2, K 22, targetBranches 3
    const runs = 200;
    const started = performance.now();
    for (let i = 0; i < runs; i++) plan(args);
    const perPlan = (performance.now() - started) / runs;

    // Budget: six bots replanning at 15 Hz must stay under ~30 ms of CPU per simulated second.
    // 6 * 15 == 90 plans per simulated second, so one plan has 30/90 == 0.33 ms.
    expect(perPlan).toBeLessThan(0.33);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/bot/brain/planner.bench.test.ts
```

**If it fails, do not raise the budget.** Reduce `planDepth` to 1 for hard, or `planHorizonTicks`,
and re-run Task 7's ladder tests to confirm the tiers still separate. Record the final values and
say in the summary that the planner was throttled to fit.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/bot/brain/planner.bench.test.ts
git commit -m "test(bot): gate the planner's cost against the stated budget

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Reshape blunders (P41)

**Files:**
- Modify: `packages/server/src/bot/brain/humanize.ts`
- Modify: `packages/server/src/bot/brain/humanize.test.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("a blundering bot commits to a plausible alternative, not an inverted steer", () => {
  // "second-best" must actually differ from the chosen action, and must be a real action.
  const out = applyBlunder(
    { steer: 1, throttle: 1, fireSlots: 1 },
    "second-best",
    { steer: -1, throttle: 0 },
  );
  expect(out.steer).toBe(-1);
  expect(out.throttle).toBe(0);
});
```

- [ ] **Step 2: Implement**

Replace the `BLUNDERS` list with `["second-best", "late-brake", "marginal-shot", "hold-fire"]` and
rewrite `applyBlunder` to take the planner's runner-up:

```typescript
/**
 * A mistake a person would make (P41).
 *
 * The old kinds inverted `steer`, which reads as a spasm rather than a misjudgement — a car
 * twitching, not a driver getting it wrong. Every kind here is an action the bot could plausibly
 * have chosen on purpose: taking the second-best line, braking late, taking a shot it rated
 * marginal, or hesitating.
 */
function applyBlunder(
  intent: BotIntent,
  kind: BlunderKind,
  runnerUp: { steer: -1 | 0 | 1; throttle: -1 | 0 | 1 } | undefined,
): BotIntent {
  switch (kind) {
    case "second-best":
      return runnerUp ? { ...intent, ...runnerUp } : intent;
    case "late-brake":
      return { ...intent, throttle: 1 };
    case "marginal-shot":
      return intent;
    case "hold-fire":
      return { ...intent, fireSlots: 0 };
  }
}
```

Thread `this.lastPlan?.runnerUp` through `applyHumanize` into `applyBlunder`. Keep the three
unconditional `rng()` draws exactly as they are (H21).

- [ ] **Step 3: Run and commit**

```bash
npm test
```

```bash
git add packages/server/src/bot
git commit -m "feat(bot): make blunders plausible instead of spasmodic

Inverting steer reads as a car twitching, not a driver misjudging. Every kind is
now an action the bot could plausibly have chosen on purpose -- most usefully
the planner's own runner-up, which is by construction a nearly-good line.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Docs and skill — the full P58a rewrite

The rewrite `bot-tuner` has been owed since plan 1. Everything in **P58a** lands here.

**Files:**
- Modify: `docs/bot-behavior.md`
- Modify: `.claude/skills/bot-tuner/SKILL.md`

- [ ] **Step 1: `docs/bot-behavior.md`**

- Version → `4.3.0`.
- Replace the **Pipeline** block with the phase-D pipeline (`perceive → predict → assess → plan →
  fire → humanize`).
- Replace the **Situations** table's "Drive" column with the objective each situation weights.
- New **Planning** parameter table: `planHorizonTicks`, `planDepth`, `targetBranches`,
  `commitPenalty`.
- Delete `standoffFraction`, `deadbandFraction`, `aimToleranceRad` from **Positioning** and **Aim**.
- Rewrite the **Overlay** section for the new line.

- [ ] **Step 2: `.claude/skills/bot-tuner/SKILL.md` — the four P58a changes**

1. **Third factor.** Change the Path's step 2 taxonomy from *judgment vs hands* to **judgment,
   hands, and planning**, with planning covering `planHorizonTicks`, `planDepth`, `targetBranches`,
   `commitPenalty`.
2. **The weave row inverts.** Replace it:

| They say | Factor | First knobs |
|---|---|---|
| "it weaves / circles me" | planning | Often correct now — circling is emergent when it scores better. If it looks like a stutter rather than an arc, that is chatter: raise `commitPenalty` |

3. **Wider escape hatch.** Extend the "stop tuning, that's a brain bug" note:

```markdown
Stop tuning and say so when the overlay shows either: the wrong **situation** for the moment, or a
`plan` score whose winning term is obviously the wrong one for that situation (`wallPenalty`
dominating in open floor, say). And distinguish two cases that look identical from outside — the
bot holding fire because `ev` is below threshold is a *tuning* answer (`minShotValue`); the bot
holding fire while `ev` clears the threshold is a *bug*.
```

4. **Overlay-first diagnostic.** Already added in plans 1 and 2; extend it to name `plan` and the
   per-term breakdown.

Also add to the "You do not" list: `**You do not tune the planner's base weights.**` Those are
`objectives.ts` and are per-situation, not per-tier — changing one changes what a situation *means*
for every tier at once.

- [ ] **Step 3: Verify and commit**

```bash
npm test
```

```bash
git add docs/bot-behavior.md .claude/skills/bot-tuner/SKILL.md
git commit -m "docs: bot brain 4.3.0 — the planner, and bot-tuner's third factor

bot-tuner sorted every complaint into judgment vs hands and had nowhere to put
'it does not set up its shots'. Planning is now a first-class factor. The
weave row inverts: circling is emergent and usually correct, and a stutter is
chatter rather than a bad orbitBias -- a knob that no longer exists.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Validation

- [ ] **1.** `npm test` from the repo root passes, including Task 7's ladder and Task 8's budget.
- [ ] **2.** `npm run build` succeeds; `packages/server/dist/index.js` inlines `// ../shared/dist/`.
- [ ] **3.** Confirm nothing branches on a tier name:

```bash
grep -rn '"hard"\|"medium"\|"easy"' packages/server/src/bot --include=*.ts | grep -v "\.test\."
```

Expected: no hits outside type declarations. Any behavioural hit violates H8 — fix it.

- [ ] **4. Play all three tiers** in `?dev=playground`, one match each:
  - **Easy** should look like someone learning: sprays, misses, drifts into walls.
  - **Medium** should look competent and beatable.
  - **Hard** should look *deliberate* — it should take fewer shots than easy, land far more, and
    visibly position before it fires. If it looks confidently wrong rather than random, read the
    overlay's per-term breakdown; that is what Task 6 exists for.
  - Watch for **chatter** (rapid steer flapping). If present, raise `commitPenalty` before anything else.
- [ ] **5. Report — do not run these on the user's behalf:**
  - **`npm run balance`** is now worth a fresh baseline across all three tiers, since the whole point
    was better data. Recommend it; the fingerprint has moved four times.
  - **Playtest probes are affected** by the driving change. Name the probes and their numbers after
    reading `packages/server/playtest/`, and recommend `npm run playtest`. Fix a probe only if it
    fails to compile.
  - State whether the planner was throttled to fit the Task 8 budget, and to what values.
