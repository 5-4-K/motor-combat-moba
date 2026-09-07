# Planner facing term — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the bot planner a seventh score term measuring nose-versus-travel alignment, so turning is no longer pure cost and the bot stops resting on a drive-model coincidence.

**Architecture:** `facingErrorOf(body)` is a pure function over a rollout's terminal `SimBody`, computed through `shared/sim/velocity.ts`. It joins `PlanWeights` as a seventh term, is read at the terminus beside `rangeError` and `threatAvoid`, and is subtracted in `rawScore`. Each of the eight situations in `objectives.ts`'s `BASE` supplies its own weight, so kiting plays can keep a low one.

**Tech Stack:** TypeScript, npm workspaces, Vitest. Server-side only — no shared, client, or schema change.

**Spec:** [`docs/superpowers/specs/2026-09-07-planner-facing-term-design.md`](../specs/2026-09-07-planner-facing-term-design.md)

## Global Constraints

- **Server-side only.** `forwardOf`/`speedOf` (`shared/src/index.ts:146`) and `DRIVE_CONFIG` (line 243) are already exported. **Do not edit `packages/shared`.** No `npm run build:manual`, no `balanceStamp` move, no `docs/turn-tuning.md` obligation.
- **No magic numbers in logic** (hard invariant 2). The rest band is `DRIVE_CONFIG.stopEpsilon`, not a new literal.
- **The conversion goes through `sim/velocity.ts`** (F6). Never open-code `cos(angle) * speed`.
- **The planner draws no randomness** (P43, H21). `facingErrorOf` is a deterministic function of the body; it must take no `rng` and must not branch on tier.
- **Run from the repo root**, and use `npx vitest` from `packages/server` for single-file runs.
- **Baseline before you start:** server suite is `639 passed | 2 failed`. The two failures are `controller.test.ts`'s dodge test and `tiers.test.ts`'s H39. Shared 967 ✅, client 619 ✅, scripts 151 ✅.

---

### Task 1: The `facingErrorOf` function

Pure function, no wiring. Nothing else in the codebase changes, so the full suite must still read exactly `639 passed | 2 failed` at the end of this task.

**Files:**
- Modify: `packages/server/src/bot/brain/planner.ts` (add import + exported function near `threatAvoidOf`, around line 855)
- Test: `packages/server/src/bot/brain/planner.test.ts`

**Interfaces:**
- Consumes: `speedOf`, `forwardOf`, `DRIVE_CONFIG`, `type SimBody` from `@motor-combat-moba/shared`
- Produces: `export function facingErrorOf(body: SimBody): number` — returns `0` driving straight ahead, `0.5` sliding exactly sideways, `1` reversing, `0` at rest. Bounded `[0, 1]`. Task 2 calls this.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/bot/brain/planner.test.ts`. Two import edits first, both exact — the file currently imports neither symbol:

- Line 2 is `import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";`. Change it to:
  ```ts
  import { DRIVE_CONFIG, slotsOf, weaponDefOf, type SimBody } from "@motor-combat-moba/shared";
  ```
- The `./planner.js` import block (lines 6-8) currently reads `ALL_ACTIONS, commitWindowOf, plan, type PlanArgs, type PlanWeights`. Add `facingErrorOf` to it.

```ts
describe("facingErrorOf", () => {
  // A body with only the fields the function reads. The planner's rollout produces full
  // SimBodies; this pins the function, not the rollout.
  const at = (vx: number, vy: number, angle: number) =>
    ({ x: 0, y: 0, angle, vx, vy } as SimBody);

  it("is 0 driving straight ahead, at any heading", () => {
    expect(facingErrorOf(at(100, 0, 0))).toBeCloseTo(0, 9);
    expect(facingErrorOf(at(0, 100, Math.PI / 2))).toBeCloseTo(0, 9);
    expect(facingErrorOf(at(-100, 0, Math.PI))).toBeCloseTo(0, 9);
  });

  it("is 1 reversing — the case the whole term exists for", () => {
    expect(facingErrorOf(at(-100, 0, 0))).toBeCloseTo(1, 9);
    expect(facingErrorOf(at(0, -100, Math.PI / 2))).toBeCloseTo(1, 9);
  });

  it("is 0.5 sliding exactly sideways", () => {
    expect(facingErrorOf(at(0, 100, 0))).toBeCloseTo(0.5, 9);
    expect(facingErrorOf(at(0, -100, 0))).toBeCloseTo(0.5, 9);
  });

  it("is 0 at rest, not undefined — this is what removes the reference-direction problem (F8)", () => {
    expect(facingErrorOf(at(0, 0, 0))).toBe(0);
    // Inside the sim's own rest band, so the sim and the planner agree on what 'stopped' means.
    expect(facingErrorOf(at(DRIVE_CONFIG.stopEpsilon / 2, 0, Math.PI))).toBe(0);
  });

  it("is scale-free: doubling the speed does not change the term", () => {
    expect(facingErrorOf(at(50, 50, 0))).toBeCloseTo(facingErrorOf(at(500, 500, 0)), 9);
  });

  it("stays inside [0, 1] at every angle, so it can never swamp a weight table tuned against it", () => {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const e = facingErrorOf(at(Math.cos(a) * 137, Math.sin(a) * 137, 0.7));
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && npx vitest run src/bot/brain/planner.test.ts -t "facingErrorOf"
```

Expected: FAIL — `facingErrorOf is not exported by ./planner.js` (a TypeScript/import error, not an assertion failure).

- [ ] **Step 3: Write the implementation**

Add `speedOf, forwardOf` to the existing `@motor-combat-moba/shared` import block at the top of `packages/server/src/bot/brain/planner.ts` (lines 2-4). Then add this immediately after `threatAvoidOf` (which ends around line 867):

```ts
/**
 * How badly this pose points somewhere other than where it is going (F4-F8).
 *
 * The planner's other six terms are about where the car IS or what it can SHOOT. None of them says
 * that ORIENTATION IS FUTURE OPTIONS: a car pointing where it is going can keep going, and a car
 * pointing backwards relative to its travel is committed to a slow reversal. A receding-horizon
 * planner that scores only the terminal POSITION cannot see that cost, which is exactly what a
 * short horizon loses.
 *
 * Nose-versus-TRAVEL, deliberately, not nose-versus-objective. The second reading duplicates `myEv`
 * (per-slot solutions are already built from the car's real pose) and `lockKeep`, and it is zero at
 * `steer: 0` in `controller.test.ts`'s dodge scene, where the nose already points at the target —
 * so it would reinforce the input under test rather than move it.
 *
 * `forwardOf / speed` is the cosine of the angle between velocity and nose, so this is 0 driving
 * ahead, 0.5 sliding sideways, 1 reversing, and bounded in [0, 1] — an angle-like quantity, never a
 * distance. That matters: the existing terms already span three magnitude regimes (`rangeError`
 * ~302, `threatAvoid` ~20, `wallPenalty` ~0.004) and a fourth would make the weight table harder to
 * reason about rather than easier.
 *
 * At rest it is 0, not undefined, and the band is the sim's own `stopEpsilon` so the two agree on
 * what stopped means. That is the whole answer to the reference-direction problem: a
 * nose-versus-objective term has no defined value in `recover` or a targetless `evade`, where
 * `targetAt` falls back to the car's own pose. Velocity is always defined, so no situation needs a
 * special case.
 */
export function facingErrorOf(body: SimBody): number {
  const speed = speedOf(body.vx, body.vy);
  if (speed <= DRIVE_CONFIG.stopEpsilon) return 0;
  return (1 - forwardOf(body.vx, body.vy, body.angle) / speed) / 2;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/server && npx vitest run src/bot/brain/planner.test.ts -t "facingErrorOf"
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Verify nothing else moved**

```bash
npm test
```

Expected: server `639 passed | 2 failed` — **exactly the baseline**, same two named failures. Shared 967 ✅, client 619 ✅, scripts 151 ✅. If any third test moved, stop: the function is not yet wired to anything and cannot legitimately change behaviour.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/bot/brain/planner.ts packages/server/src/bot/brain/planner.test.ts
git commit -m "feat(bot): add facingErrorOf, the planner's nose-versus-travel measure

Pure function, not yet wired into the score. Nose-versus-TRAVEL rather
than nose-versus-objective (F4): the latter duplicates myEv and lockKeep,
and is zero at steer 0 in the dodge scene it would need to move.

Bounded [0, 1] and scale-free so it cannot swamp a weight table tuned
against the existing three magnitude regimes. Zero at rest, banded on the
sim's own stopEpsilon, which is what removes the reference-direction
problem a nose-versus-objective term would have in recover and a
targetless evade."
```

---

### Task 2: Wire it into the score at weight 0

The term reaches `PlanWeights`, `scoreCandidate` and `rawScore`, but **every weight is 0**, so behaviour is provably unchanged. This is the task that isolates plumbing bugs from tuning effects — do not set a real weight here.

**Files:**
- Modify: `packages/server/src/bot/brain/planner.ts` (`PlanWeights` ~line 36, `scoreCandidate` terminal block ~line 771, `rawScore` ~line 869)
- Modify: `packages/server/src/bot/brain/objectives.ts` (`BASE`, ~line 109 — all 8 rows)
- Modify: `packages/server/src/bot/brain/planner.test.ts` (existing `PlanWeights` literals)
- Test: `packages/server/src/bot/brain/objectives.test.ts`

**Interfaces:**
- Consumes: `facingErrorOf(body: SimBody): number` from Task 1
- Produces: `PlanWeights.facingError: number`; `PlanResult.terms.facingError`; every `BASE` row carries `facingError`. Task 3 changes only the eight numbers.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/bot/brain/objectives.test.ts`:

```ts
describe("facingError weights", () => {
  it("is present on every situation, so the planner never reads undefined", () => {
    for (const id of ALL_SITUATIONS) {
      const w = weightsFor(id, BOT_PROFILES.hard);
      expect(typeof w.facingError, `${id} has no facingError weight`).toBe("number");
      expect(Number.isFinite(w.facingError), `${id} facingError is not finite`).toBe(true);
    }
  });

  it("never returns a negative facing weight — the sign lives in rawScore", () => {
    for (const id of ALL_SITUATIONS) {
      expect(weightsFor(id, BOT_PROFILES.hard).facingError).toBeGreaterThanOrEqual(0);
    }
  });
});
```

**No new imports.** This file already imports `ALL_SITUATIONS` from `./situation.js` (line 3), `weightsFor` from `./objectives.js` (line 4) and `BOT_PROFILES` (line 2), and its existing tests loop over `ALL_SITUATIONS` the same way.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && npx vitest run src/bot/brain/objectives.test.ts -t "facingError weights"
```

Expected: FAIL — `expected "undefined" to be "number"`.

- [ ] **Step 3: Add the field to `PlanWeights`**

In `packages/server/src/bot/brain/planner.ts`, inside `interface PlanWeights` (after `threatAvoid`):

```ts
  /**
   * How much this play cares that the car points where it is going (F1-F13).
   *
   * PER-SITUATION AND NOT A GLOBAL CONSTANT, on purpose. `fight` and `reset` are where a ranged
   * chassis correctly backs off toward its preferred range with its guns on the target, and this
   * term must not forbid that — a single global "reversing is bad" scalar could not express the
   * difference between that and the hunt, where facing your travel IS the play.
   */
  facingError: number;
```

- [ ] **Step 4: Compute it at the terminus**

In `scoreCandidate`, add a declaration beside the other two terminal terms (near `let rangeError = 0;` / `let threatAvoid = 0;`, ~line 756):

```ts
  let facingError = 0;
```

Then inside the `if (i === last) {` block, after the `threatAvoid` assignment:

```ts
      // F9: a TERMINAL reading, like the two above. A maximum or mean over the arc would punish the
      // transient mid-turn misalignment every good turn necessarily passes through — penalising the
      // exact behaviour this term exists to make affordable.
      facingError = facingErrorOf(body);
```

Add `facingError` to the object this function returns, alongside the other six terms.

- [ ] **Step 5: Subtract it in `rawScore`**

```ts
function rawScore(terms: Record<keyof PlanWeights, number>, weights: PlanWeights): number {
  return terms.myEv * weights.myEv
    - terms.theirEv * weights.theirEv
    - terms.rangeError * weights.rangeError
    - terms.wallPenalty * weights.wallPenalty
    + terms.lockKeep * weights.lockKeep
    + terms.threatAvoid * weights.threatAvoid
    - terms.facingError * weights.facingError;
}
```

- [ ] **Step 6: Add `facingError: 0` to all eight `BASE` rows**

In `packages/server/src/bot/brain/objectives.ts`, add `facingError: 0` to each of `recover`, `waitOut`, `evade`, `unpin`, `punish`, `reset`, `fight`, `close`. **Leave every value at 0 in this task** — Task 3 sets them.

- [ ] **Step 7: Fix the remaining construction sites**

```bash
npm run typecheck
```

The compiler enumerates every `PlanWeights` literal missing the new field — there are **13 `threatAvoid:` sites** across `planner.ts`, `objectives.ts` and `planner.test.ts`. Add `facingError: 0` to each until typecheck is clean. This is the whole reason the field is required rather than optional: absent must be a compile error, not a silent `undefined` reaching `rawScore` as `NaN`.

- [ ] **Step 8: Run the tests**

```bash
cd packages/server && npx vitest run src/bot/brain/objectives.test.ts
npm test
```

Expected: objectives suite PASS. Full suite: server `639 passed | 2 failed` — **still exactly the baseline**. Every weight is 0, so `rawScore` is arithmetically identical to before. If any third test moved, the wiring is wrong (most likely `facingError` missing from `scoreCandidate`'s returned object, making the term `undefined` and the score `NaN`) — fix it before continuing.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/bot/brain/planner.ts packages/server/src/bot/brain/planner.test.ts packages/server/src/bot/brain/objectives.ts packages/server/src/bot/brain/objectives.test.ts
git commit -m "feat(bot): wire facingError into PlanWeights at weight 0

Seventh term reaches the interface, the terminal sample and rawScore,
with every situation weighted 0 -- so the score is arithmetically
identical and the suite reads the same 639/2 baseline. Isolates the
plumbing from the tuning, which is Task 3.

Read at the terminus beside rangeError and threatAvoid (F9): a maximum
over the arc would punish the transient mid-turn misalignment every good
turn passes through, penalising what the term exists to make affordable.

Required rather than optional so a missing weight is a compile error
instead of an undefined reaching rawScore as NaN."
```

---

### Task 3: Set the weights and measure

The behaviour change. This task is **measurement-led**: the numbers below are starting points reasoned from term scale, not measured optima, and the step that matters is the sweep.

**Files:**
- Modify: `packages/server/src/bot/brain/objectives.ts` (`BASE`, the eight `facingError` values)
- Test: `packages/server/src/bot/brain/objectives.test.ts`, and the two currently-failing suites

**Interfaces:**
- Consumes: everything from Task 2
- Produces: eight tuned weights. Task 4 documents them.

- [ ] **Step 1: Record the pre-change measurement**

```bash
cd packages/server && npx vitest run src/bot/brain/controller.test.ts src/bot/brain/tiers.test.ts 2>&1 | tail -20
```

Write down which tests fail and the duel counts reported by the passing canaries. You are about to change bot behaviour and you need the before-picture to say what moved.

- [ ] **Step 2: Set the starting weights**

Rationale, from the measured term scales — the term is bounded `[0,1]`, so a weight IS the maximum penalty it can contribute, and it must be read against what it competes with in that situation:

| Situation | `facingError` | Why |
|---|---|---|
| `recover` | `0` | Dead or phased; the intent is forced to coast anyway. Nothing to steer. |
| `waitOut` | `120` | **The highest (F13).** Hunting is where facing your travel IS the play. Competes with `rangeError` 0.375 × ~857 ≈ 321. |
| `evade` | `40` | Must not dictate the dodge direction — the escape axis is set by the shot, and reversing is sometimes the correct perpendicular. |
| `unpin` | `60` | Escaping a wall nose-first leaves the car able to drive away. Competes with `wallPenalty` 2400 × ~0.004 ≈ 10. |
| `punish` | `50` | Committed aggression; arrive pointing at the fight. |
| `reset` | `10` | **Low (F12).** Disengaging while facing the threat is correct. |
| `fight` | `15` | **Low (F12).** Kiting is correct play; competes with `rangeError` 0.3 × ~302 ≈ 90. |
| `close` | `80` | Driving to contact — arrive nose-first or the contact is wasted. |

Set exactly these values in `BASE`.

- [ ] **Step 3: Measure**

```bash
cd packages/server && npx vitest run src/bot/brain/ 2>&1 | tail -30
```

Record: which of the two known failures now pass, and **whether any previously-passing bot test broke**. A previously-passing test going red is a real regression and outranks fixing either target.

- [ ] **Step 4: Sweep the two weights that matter**

Only if Step 3 leaves a target failing or breaks a passing test. Sweep `waitOut` over `{60, 90, 120, 180, 240}` and `fight` over `{0, 5, 15, 30, 60}`, one axis at a time, re-running `npx vitest run src/bot/brain/` at each point. Record the pass/fail count per value in a table — that table goes in the commit message, because the next person to retune needs to know what was already tried and rejected. **Do not sweep beyond these two axes without saying so:** the others were set by argument, and a value found by chasing two tests across six free parameters is overfitting, not tuning.

- [ ] **Step 5: Decide the honest outcome for each remaining failure**

Per the spec's section 5:

- If a target test now passes — good, note it.
- If **H39** still fails, that is a genuine miss; the spec expected it to pass. Re-diagnose rather than reweighting further.
- If **the dodge test** still fails, that is the outcome the spec explicitly left open. Reversing IS the correct perpendicular escape in that scene. **Do not bend the weights to satisfy it.** Instead: write down what the bot now does, why it is defensible, and STOP — the spec commits to bringing that back for approval rather than rewriting the assertion silently.

- [ ] **Step 6: Run the full suite**

```bash
npm test
```

Expected: shared 967 ✅, client 619 ✅, scripts 151 ✅. Server: report the exact count.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/bot/brain/objectives.ts packages/server/src/bot/brain/objectives.test.ts
git commit -m "feat(bot): weight the facing term per situation

<state which of the two known failures now pass, and paste the sweep
table from Step 4 if a sweep was run>

waitOut carries the highest weight because hunting is where facing your
travel is the play. fight and reset carry the lowest deliberately: a
ranged chassis backing off toward its preferred range with its guns on
the target is correct, and this term must not forbid it -- which is the
reason it is a per-situation column and not a global scalar."
```

---

### Task 4: Version bump and docs

**Files:**
- Modify: `packages/server/src/config/bot-profiles.ts:751` (`BOT_BRAIN_VERSION`)
- Modify: `docs/bot-behavior.md` (line 19 version line, the weights table at ~line 131, the term-scale prose at ~line 143, the `wallPenalty`/H39 row at line 38)

**Interfaces:**
- Consumes: the tuned weights from Task 3
- Produces: nothing code depends on.

- [ ] **Step 1: Bump the brain version**

In `packages/server/src/config/bot-profiles.ts:751`:

```ts
export const BOT_BRAIN_VERSION = "4.5.0";
```

Behaviour changed without `BOT_PROFILES` moving, which is precisely what this version exists to catch — `botFingerprint` would otherwise report two different pilots as the same one and the balance harness would compare incomparable reports.

- [ ] **Step 2: Update `docs/bot-behavior.md`**

Four edits:

1. **Line 19** reads ``BOT_BRAIN_VERSION` is `4.3.0`.`` — this is **already stale** (the code said `4.4.0` before this work). Correct it to `4.5.0` and note the drift was pre-existing, so nobody reads it as a fix this change needed.
2. **The weights table at ~line 131** gains a `facingError` column with the eight values from Task 3.
3. **The term-scale prose at ~line 143** — which currently explains that `myEv` is 0-75, `rangeError` is world units, `wallPenalty` is a squared normalised overlap and `threatAvoid` is a displacement — gains `facingError` as a bounded `[0, 1]` alignment, and says why bounded matters.
4. **Line 38's tuning row** discusses `wallPenalty` and H39's near-wall scene by name. If Task 3 changed what H39 does, this row's account is now wrong — update it to match the measured behaviour.

- [ ] **Step 3: Verify the docs tests still pass**

```bash
npm run test:scripts
```

Expected: `# fail 0`. `docs/bot-behavior.md` is not machine-checked, but `docs/turn-tuning.md` is, and this confirms nothing was disturbed.

- [ ] **Step 4: Full verification**

```bash
npm run typecheck && npm test
```

- [ ] **Step 5: Commit and push**

```bash
git add packages/server/src/config/bot-profiles.ts docs/bot-behavior.md
git commit -m "docs(bot): brain 4.5.0 -- the facing term

Behaviour changed without BOT_PROFILES moving, which is the case
BOT_BRAIN_VERSION exists for: balance reports across the bump are not
comparable and --baseline will refuse them.

Also corrects the version line, which read 4.3.0 against a shipped 4.4.0
-- pre-existing drift, not something this change introduced."
git push -u origin claude/run-npm-test-bjhzyh
```

- [ ] **Step 6: Report what needs running, do not run it**

State in the handoff summary, and do NOT run on your own initiative:

- **`npm run balance`** — win rates are conditioned on how the bots played and the fingerprint just moved. Reports from before this are not comparable.
- **`npm run playtest`** — the probes drive the real tick pipeline. `bc3c03e` refreshed their numbers for the physics rework, but none of them was measured against a bot that turns.

