# Dash Substepping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `thunderclap`'s dash from tunnelling through the car it hits, by bounding how far a DASH body may translate between collision checks.

**Architecture:** `thunderclap` moves 53.3 world units per tick against a 48x32 hull, so its single per-tick teleport lands deep inside the target and `mtvBetween` ejects it out the cheapest face — sideways or out the far side — for 60% of sub-tick approach phases. Rather than teach the resolver where the body came from (an entry-normal or swept-hull rewrite), we cap the distance travelled between checks at half the hull's SHORT axis (16 u), so no single translation can bury the car past the 32-unit-wide band where the existing resolver is already correct. The loop lives in `stepSim` — the lockstep both server and client import — around the existing `resolveWorld`, gated on `ManeuverKind.DASH`. `stepDash`'s per-tick bookkeeping (duration countdown, exit-speed handoff, shove/authority decay) stays strictly once-per-tick; only the translation repeats.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared` consumed as built `dist`), Vitest, Node's test runner for `scripts/*.test.mjs`.

**Spec:** [`docs/superpowers/specs/2026-09-02-dash-substepping-design.md`](../specs/2026-09-02-dash-substepping-design.md) — decisions C1–C18. Read it alongside this plan.

## Global Constraints

- **This is a drive-model change.** Root `CLAUDE.md` requires stopping to ask before one. The question was put and answered before the spec was written; that approval is what both documents run under. Do not re-open it, and do not widen it — the OBB model, the SAT/MTV resolver, `resolveWorld`'s ordering and restitution, the collision-damage rules and friendly fire are all **out of scope**.
- **Invariant 2 — no magic numbers in logic.** The 16-unit bound is a `DRIVE_CONFIG` key, never a literal in `drive.ts` or `step.ts`.
- **Invariant 4 — `stepSim` is the lockstep.** The substep loop goes in `packages/shared/src/sim/step.ts` and nowhere else. Putting it in the server bridge would desync client prediction.
- **Invariant 9 — shared is consumed as built `dist`.** After any edit under `packages/shared/src`, rebuild with `npm run build -w @motor-combat-moba/shared` before running the server, the probes, or any `scripts/*.mjs`. `npm test` and `npm run playtest` do this for you; a bare `vitest` run does not.
- **Build with root `npm run build`, never `npm run build --workspaces`.** The server's tsup step inlines shared's `dist`, so shared must build first.
- **Verify with root `npm test`**, never a per-workspace run — a per-workspace run silently skips the server suite.
- **`thunderclap`'s balance numbers do not change.** `speed` stays 1600, `range` stays 400. This plan changes how the translation is applied, not how far or how fast it goes.
- **Exact new config value:** `dashSubstepMaxUnits: 16` in `DRIVE_CONFIG`. That is `DRIVE_CONFIG.carHeight / 2` — half the car's SHORT axis, not `carWidth / 2` and not an average (C4).
- **Free-air dash distance is unchanged** (C13). It is float-*close*, not bit-identical: four adds of `1600 * (dt/4)` can differ from one `1600 * dt` in the last bit or two, roughly 1e-14 world units against a 48-unit car. Assert it with `toBeCloseTo`, never `toBe`. `stepSim` already documents that `cos`/`sin` are not bit-identical between the server's V8 and a browser engine and that prediction reconciles rather than assuming bit-exact replay, so this changes nothing about the netcode's contract.
- **`stepDrive` must keep translating a dash by the full `dt`** (C16). `drive.test.ts`'s free-air dash cases call `stepDrive` directly and pin that arithmetic. They must pass **unchanged** — do not edit them to accommodate this work. The substep re-walk happens in `stepSim`, above `stepDrive`.
- **`golden.test.ts` must not move** (C15). Its fixture carries `maneuver: 0`, so no dash path runs in it. If its numbers change, something is wrong with the non-dash path — stop and diagnose rather than regenerating the fixture.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/shared/src/config/drive-config.ts` | Holds `dashSubstepMaxUnits: 16` beside the hull dimensions it is derived from | 1 |
| `packages/shared/src/config/config.test.ts` | Pins the bound to the hull, so shrinking a car fails the suite rather than silently reopening the bug | 1 |
| `packages/shared/src/sim/drive.ts` | Splits `stepDash` so the translation is a reusable pure helper while the per-tick bookkeeping stays per-tick; owns `isDashing` and `dashSubstepCount` | 2 |
| `packages/shared/src/sim/drive.test.ts` | Unit tests for the three new helpers. Existing dash cases stay untouched | 2 |
| `packages/shared/src/sim/step.ts` | The DASH-gated substep loop around `resolveWorld` — the fix itself | 3 |
| `packages/shared/src/sim/step.test.ts` | The sub-tick phase + approach-angle + target-orientation sweep (C14) | 3 |
| `packages/server/playtest/weapons2.ts` | Comment-only: the `(thunderclap 22/24 …)` parenthetical is stale | 4 |
| `packages/client/public/manual.html` | Regenerated: `balanceStamp` hashes `DRIVE_CONFIG` whole (C18) | 4 |

**Nothing else changes.** `resolveWorld`, `mtvBetween`, `applyContact`, the resolve ordering, `carObbOf`, the OBB dimensions, `resolveContacts`, `WEAPON_TABLE`, `CAR_TABLE`, `TICK_RATE_HZ`, `ArenaRoom.tick`, `ram-bridge`'s `endDash`, `wallBlockedDashers`, and every client render path stay exactly as they are. Client prediction inherits the fix through `stepSim` (C5).

### A note on C17, which is stale

The spec's C17 says `playtest/weapons2.ts` currently reports `thunderclap 22/24 approach angles dealt nothing at contact range <- POINT-BLANK MISS` and should be updated so the fix reads as `OK`. **It no longer reports that.** Commit `9fb05f0` taught both point-blank probes (`weapons.ts` W2 and `weapons2.ts` W15) to skip every `kind === "maneuver"` row as `KNOWN-BY-DESIGN — no muzzle`, and the latest report (`reports/2026-09-01-06/weapons2.md:64`) confirms the skip. The `22/24` figure survives only inside the comment explaining that skip.

The skip is also correct for a reason this change does not touch: a maneuver's damage rides the contact pass, which fires on contact **entry**, and the probe parks the hulls flush — giving a dash no edge to enter on. Substepping changes where a *moving* dasher ends up; it does not manufacture an entry edge for a car that starts already touching. So W15 will still skip after this fix, and un-skipping it would be inventing coverage, which `CLAUDE.md` reserves for the user.

Task 4 therefore corrects the misleading parenthetical and nothing else. The second half of C17 stands as written: `weapons.ts` W1's maneuver-reach row measures a real dash, and **`npm run playtest` is recommended after this work** — reading what moved is the user's call.

---

## Task 1: The config bound

**Files:**
- Modify: `packages/shared/src/config/drive-config.ts:89-91` (the `carWidth` / `carHeight` / `restitution` block)
- Test: `packages/shared/src/config/config.test.ts` (add beside the existing `stopEpsilon` case, around line 199)

**Interfaces:**
- Consumes: nothing.
- Produces: `DRIVE_CONFIG.dashSubstepMaxUnits: 16` — a `number`, read by `dashSubstepCount` in Task 2.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/config/config.test.ts`, add this case immediately after the existing `"keeps stopEpsilon a small positive rest band"` test:

```ts
  it("never lets a dash translate past the resolver's correct band", () => {
    // The MTV resolver returns the SHORTEST way out of an overlap, which is only the way the car
    // came in while the overlap is shallow. Bounding a dash's per-check travel at half the hull's
    // SHORTEST axis is what keeps every sample inside that band: a car may be at any angle, so the
    // 32-unit face can always be the competing escape axis, and sizing against the 48-unit face
    // would leave rotated approaches unprotected. Shrinking a car without revisiting this bound
    // reopens the tunnelling bug silently, so the hull is what this is pinned to — not the number.
    expect(DRIVE_CONFIG.dashSubstepMaxUnits).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.dashSubstepMaxUnits).toBeLessThanOrEqual(
      Math.min(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2,
    );
  });
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx vitest run packages/shared/src/config/config.test.ts -t "resolver's correct band"
```

Expected: FAIL. `dashSubstepMaxUnits` is `undefined`, so `toBeGreaterThan(0)` reports `received value must be a number`.

- [ ] **Step 3: Add the key**

In `packages/shared/src/config/drive-config.ts`, replace:

```ts
  carWidth: 48,
  carHeight: 32,
  restitution: 0.35,
```

with:

```ts
  carWidth: 48,
  carHeight: 32,
  /**
   * Max world units a DASH may translate between collision checks. Half the car's SHORT axis.
   *
   * `mtvBetween` answers "what is the shortest way out of this overlap", which is the way the car
   * came in only while the overlap is shallow. For two axis-aligned cars the backwards push wins
   * only while the centres are more than 16u apart on the dash axis, so there is a 32-unit-wide
   * band in which the resolver is already right — and `thunderclap` at 1600 u/s covers 53.3u per
   * tick, jumping clean over it. Capping the travel per check at half the 32-unit face keeps every
   * sample inside that band from any approach angle; the 48-unit face is the wrong one to size
   * against, because a rotated car can always present the thin one as the competing escape axis.
   *
   * It lives here rather than on a weapon row because it is a property of the collision resolver's
   * correct band, not of any one weapon — a second dash weapon inherits it. `config.test.ts` pins
   * it to the hull rather than to 16, so shrinking a car fails the suite instead of quietly
   * reopening the tunnelling bug.
   */
  dashSubstepMaxUnits: 16,
  restitution: 0.35,
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npx vitest run packages/shared/src/config/config.test.ts
```

Expected: PASS, whole file green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/config/drive-config.ts packages/shared/src/config/config.test.ts && git commit -m "feat(shared): add DRIVE_CONFIG.dashSubstepMaxUnits, pinned to the hull (C11)"
```

---

## Task 2: Split `stepDash` into bookkeeping and translation

**Files:**
- Modify: `packages/shared/src/sim/drive.ts` (the `stepDash` function, and new exports beside it)
- Test: `packages/shared/src/sim/drive.test.ts` (add a new `describe` block at the end; **do not touch** the existing `"maneuvers (spec S3 / O13)"` block)

**Interfaces:**
- Consumes: `DRIVE_CONFIG.dashSubstepMaxUnits` from Task 1.
- Produces, all exported from `packages/shared/src/sim/drive.ts`:
  - `isDashing(body: SimBody): boolean` — true when `body.maneuver === ManeuverKind.DASH && body.maneuverTicksLeft > 0`. The exact condition `stepDrive` already branches on.
  - `dashTranslation(body: SimBody, dt: number): { x: number; y: number }` — the displacement a dash covers in `dt` seconds. Returns a delta, not a position.
  - `dashSubstepCount(body: SimBody, dt: number): number` — `max(1, ceil(travel / DRIVE_CONFIG.dashSubstepMaxUnits))` where `travel = |maneuverSpeed| * dt`. An integer, always at least 1.

This task is a **pure refactor**: no observable behaviour changes. `stepDash` keeps translating the full `dt` and every existing test stays green untouched.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/sim/drive.test.ts`. Add `dashSubstepCount`, `dashTranslation` and `isDashing` to the existing import from `./drive.js`, and `DRIVE_CONFIG` from `../config/drive-config.js` if it is not already imported:

```ts
describe("dash substep helpers (spec C3 / C6)", () => {
  const dashing: SimBody = {
    ...rest(),
    maneuver: ManeuverKind.DASH,
    maneuverTicksLeft: 8,
    maneuverAngle: 0,
    maneuverSpeed: 1600,
  };

  it("recognises a live dash and nothing else", () => {
    expect(isDashing(dashing)).toBe(true);
    // A dash whose duration has run out is not one: `stepDrive` falls through to ordinary driving
    // on exactly this condition, and the substep gate must agree with it or the two disagree about
    // which body is being stepped.
    expect(isDashing({ ...dashing, maneuverTicksLeft: 0 })).toBe(false);
    expect(isDashing({ ...dashing, maneuver: ManeuverKind.HOLD })).toBe(false);
    expect(isDashing({ ...dashing, maneuver: ManeuverKind.CHARGE })).toBe(false);
    expect(isDashing(rest())).toBe(false);
  });

  it("returns the dash displacement for dt, as a delta rather than a position", () => {
    const full = dashTranslation(dashing, DT);
    expect(full.x).toBeCloseTo(1600 * DT, 9);
    expect(full.y).toBeCloseTo(0, 9);

    const sideways = dashTranslation({ ...dashing, maneuverAngle: Math.PI / 2 }, DT);
    expect(sideways.x).toBeCloseTo(0, 9);
    expect(sideways.y).toBeCloseTo(1600 * DT, 9);
  });

  it("splits a quarter-dt translation into exactly a quarter of the travel", () => {
    const quarter = dashTranslation(dashing, DT / 4);
    expect(quarter.x).toBeCloseTo((1600 * DT) / 4, 9);
  });

  it("derives the substep count from distance, so it survives a retune of speed or tick rate", () => {
    // thunderclap: 1600 u/s at 30Hz = 53.3u per tick against a 16u bound -> 4 substeps.
    expect(dashSubstepCount(dashing, DT)).toBe(4);
    // Derived, not hardcoded: halving the speed halves the travel and needs half the substeps.
    expect(dashSubstepCount({ ...dashing, maneuverSpeed: 800 }, DT)).toBe(2);
    // Exactly on the bound is one substep, not two — `ceil` of exactly 1.
    expect(dashSubstepCount({ ...dashing, maneuverSpeed: DRIVE_CONFIG.dashSubstepMaxUnits / DT }, DT)).toBe(1);
  });

  it("never returns fewer than one substep, however slow the dash", () => {
    expect(dashSubstepCount({ ...dashing, maneuverSpeed: 0 }, DT)).toBe(1);
    expect(dashSubstepCount({ ...dashing, maneuverSpeed: 1 }, DT)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
npx vitest run packages/shared/src/sim/drive.test.ts -t "dash substep helpers"
```

Expected: FAIL at import — `isDashing`, `dashTranslation` and `dashSubstepCount` are not exported from `./drive.js`.

- [ ] **Step 3: Split `stepDash` and add the helpers**

In `packages/shared/src/sim/drive.ts`, replace the `stepDash` function with the following. The bookkeeping is untouched; only the two position lines are routed through the new helper:

```ts
/**
 * Is this body in a live DASH? Exactly the condition `stepDrive` branches on above, named once so
 * the substep gate in `stepSim` and the drive branch here can never drift apart.
 */
export function isDashing(body: SimBody): boolean {
  return body.maneuver === ManeuverKind.DASH && body.maneuverTicksLeft > 0;
}

/**
 * The displacement a dash covers in `dt` seconds — a DELTA, not a position.
 *
 * Factored out of `stepDash` so `stepSim` can apply it N times at `dt / N` without also re-running
 * the per-tick bookkeeping around it (C6). One place computes the dash's motion, so a substepped
 * walk and a single full-`dt` step can never disagree about direction or speed.
 */
export function dashTranslation(body: SimBody, dt: number): { x: number; y: number } {
  return {
    x: Math.cos(body.maneuverAngle) * body.maneuverSpeed * dt,
    y: Math.sin(body.maneuverAngle) * body.maneuverSpeed * dt,
  };
}

/**
 * How many collision checks this tick of dash needs: enough that no single translation exceeds
 * `DRIVE_CONFIG.dashSubstepMaxUnits`.
 *
 * DERIVED from distance rather than hardcoded (C3), so the value stays correct if
 * `thunderclap.speed`, `TICK_RATE_HZ` or the hull dimensions are ever retuned — including by a
 * later rescale of the dash itself. At 1600 u/s and 30Hz that is 53.3u against a 16u bound: 4.
 */
export function dashSubstepCount(body: SimBody, dt: number): number {
  const travel = Math.abs(body.maneuverSpeed) * dt;
  return Math.max(1, Math.ceil(travel / DRIVE_CONFIG.dashSubstepMaxUnits));
}

/**
 * DASH: scripted translation. Inputs are ignored; knock decay still runs; the face is welded.
 *
 * Everything here except the two position lines is PER-TICK and must run exactly once —
 * `maneuverTicksLeft - 1`, the `done` exit-speed handoff, `decayShove`, `recoverAuthority`,
 * `nextAngVel`. That is why `stepSim` re-walks the position itself rather than calling this N
 * times: four substeps of this function would burn the dash's duration and decay a knock four
 * times as fast. This still applies the FULL `dt` translation, so `stepDrive` on its own is
 * arithmetically what it always was.
 */
function stepDash(body: SimBody, dt: number, chassis: ChassisDrive, mods: Readonly<Modifiers>): SimBody {
  const ticksLeft = body.maneuverTicksLeft - 1;
  const done = ticksLeft <= 0;
  const step = dashTranslation(body, dt);
  return {
    x: body.x + step.x,
    y: body.y + step.y,
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
```

Then change `stepDrive`'s dash branch to use the shared predicate. Replace:

```ts
  if (body.maneuver === ManeuverKind.DASH && body.maneuverTicksLeft > 0) {
    return stepDash(body, dt, chassis, mods);
  }
```

with:

```ts
  if (isDashing(body)) {
    return stepDash(body, dt, chassis, mods);
  }
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npx vitest run packages/shared/src/sim/drive.test.ts
```

Expected: PASS, the whole file green — including the untouched `"maneuvers (spec S3 / O13)"` block, which is the proof the split changed nothing (C16).

- [ ] **Step 5: Verify the refactor moved nothing else**

```bash
npm test
```

Expected: PASS across all three workspaces and `scripts/`. In particular `golden.test.ts` must be green with no fixture regeneration (C15), and `packages/shared/src/sim/step.test.ts` must be untouched and green — nothing calls the new helpers yet.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/drive.ts packages/shared/src/sim/drive.test.ts && git commit -m "refactor(shared): split stepDash's translation from its per-tick bookkeeping (C6)"
```

---

## Task 3: The substep loop in `stepSim`

This is the fix. Write the sweep first and watch it fail on the real bug before touching `step.ts`.

**Files:**
- Modify: `packages/shared/src/sim/step.ts:74-77` (the body of `stepSim`)
- Test: `packages/shared/src/sim/step.test.ts` (add a new `describe` block at the end)

**Interfaces:**
- Consumes: `isDashing`, `dashTranslation`, `dashSubstepCount` from Task 2; `DRIVE_CONFIG.dashSubstepMaxUnits` from Task 1 (transitively).
- Produces: no new exported symbol. `stepSim`'s signature is unchanged — that is the point of C5, and it is why client prediction and the server bridge both inherit the fix with no edit.

- [ ] **Step 1: Write the failing sweep**

Append to `packages/shared/src/sim/step.test.ts`. Extend the existing imports at the top of the file with:

```ts
import { obbsOverlap, type Obb } from "./collide.js";
import { ManeuverKind } from "./maneuver.js";
```

Then append this block. Note that every `SimBody` literal here spells out all thirteen fields — the older tests in this file predate the maneuver fields and omit them, which Vitest tolerates because `tsconfig.json` excludes `**/*.test.ts`; new code should not rely on that.

```ts
/**
 * `thunderclap` covers 53.3u per tick against a 48x32 hull, so before substepping the dasher
 * arrived already deep inside its target and `mtvBetween` — which returns the SHORTEST way out of
 * an overlap, not the way the car came in — ejected it sideways or out the far side. It was fully
 * deterministic in the sub-tick phase, which is exactly why it read as intermittent in play.
 *
 * A single placement measures one arbitrary point on the tick grid and would have passed against
 * the broken code for 10 of 25 phases. So this sweeps the phase, and it sweeps approach angles and
 * target orientations too: the failure band depends on which hull face is the competing escape
 * axis, so head-on-only would test one geometry out of all the ones a player produces.
 */
describe("dash substepping (spec C2 / C12 / C14)", () => {
  const DASH_SPEED = 1600; // thunderclap
  const DASH_TICKS = 8; // 400u of range at 53.3u per tick
  const TICK_TRAVEL = DASH_SPEED * DT;
  const TARGET = { x: 640, y: 360 };
  /** Clear of the target by more than a hull diagonal, and inside the dash's 400u reach. */
  const START_BACK = 240;
  const PHASE_SAMPLES = 24;

  const NO_INPUT: InputMessage = { seq: 1, steer: 0, throttle: 0, fireSlots: 0 };

  function hullOf(x: number, y: number, angle: number): Obb {
    return { x, y, angle, w: DRIVE_CONFIG.carWidth, h: DRIVE_CONFIG.carHeight };
  }

  function dasherAt(x: number, y: number, angle: number): SimBody {
    return {
      x,
      y,
      angle,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
      maneuver: ManeuverKind.DASH,
      maneuverTicksLeft: DASH_TICKS,
      maneuverAngle: angle,
      maneuverSpeed: DASH_SPEED,
    };
  }

  it("never leaves the dasher inside or past the car it dashed into, from any phase or angle", () => {
    const failures: string[] = [];

    for (let deg = 0; deg < 360; deg += 30) {
      const a = (deg * Math.PI) / 180;
      const dir = { x: Math.cos(a), y: Math.sin(a) };

      for (const targetDeg of [0, 22.5, 45, 67.5]) {
        const targetAngle = (targetDeg * Math.PI) / 180;
        const targetHull = hullOf(TARGET.x, TARGET.y, targetAngle);
        const ctx: StepContext = {
          carId: "mirage",
          others: [targetHull],
          obstacles: [],
          bounds: { width: 1280, height: 720 },
          modifiers: NEUTRAL_MODIFIERS,
        };

        // Sweep the full sub-tick phase: shifting the start by one tick's travel walks the contact
        // through every position it can occupy on the tick grid.
        for (let p = 0; p < PHASE_SAMPLES; p++) {
          const back = START_BACK + (p * TICK_TRAVEL) / PHASE_SAMPLES;
          let body = dasherAt(TARGET.x - dir.x * back, TARGET.y - dir.y * back, a);

          for (let tick = 0; tick < DASH_TICKS; tick++) {
            body = stepSim(body, NO_INPUT, DT, ctx);
            const along = (body.x - TARGET.x) * dir.x + (body.y - TARGET.y) * dir.y;
            const label = `approach ${deg}deg, target ${targetDeg}deg, phase ${p}, tick ${tick}`;

            // Started behind the target, so the projection onto the dash axis must stay negative:
            // the dasher plants itself in front of what it hit and never comes out the far side.
            if (along >= 0) failures.push(`${label}: ended ${along.toFixed(1)}u PAST the target centre`);
            if (obbsOverlap(hullOf(body.x, body.y, body.angle), targetHull)) {
              failures.push(`${label}: ended INSIDE the target hull`);
            }
          }
        }
      }
    }

    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures).toHaveLength(0);
  });

  it("leaves an uncontested dash covering exactly the ground it always did", () => {
    // C13: substepping changes the contact case and nothing else. Four adds of 1600*(dt/4) can
    // differ from one 1600*dt in the last bit or two — 1e-14 units against a 48-unit car — so this
    // is close, not bit-identical, and `stepSim` already documents that cos/sin are not bit-exact
    // across engines either.
    const empty: StepContext = {
      carId: "mirage",
      others: [],
      obstacles: [],
      bounds: { width: 4000, height: 4000 },
      modifiers: NEUTRAL_MODIFIERS,
    };
    let body = dasherAt(200, 2000, 0);
    for (let tick = 0; tick < DASH_TICKS; tick++) {
      body = stepSim(body, NO_INPUT, DT, empty);
    }
    expect(body.x).toBeCloseTo(200 + DASH_SPEED * DT * DASH_TICKS, 6);
    expect(body.y).toBeCloseTo(2000, 9);
    expect(body.maneuver).toBe(ManeuverKind.NONE);
    expect(body.maneuverTicksLeft).toBe(0);
  });

  it("burns the dash's duration once per tick, not once per substep", () => {
    // The whole reason `stepDash` was split (C6): four substeps of the un-split function would
    // spend four ticks of dash in one tick of sim.
    const empty: StepContext = {
      carId: "mirage",
      others: [],
      obstacles: [],
      bounds: { width: 4000, height: 4000 },
      modifiers: NEUTRAL_MODIFIERS,
    };
    const out = stepSim(dasherAt(200, 2000, 0), NO_INPUT, DT, empty);
    expect(out.maneuverTicksLeft).toBe(DASH_TICKS - 1);
  });

  it("leaves an ordinary driving car on the single-step path", () => {
    // C9: the loop is gated on DASH explicitly. Repeated restitution within one tick is harmless
    // for a dash (its motion source is `maneuverSpeed`, and `endDash` overwrites `speed` on the
    // tick the hit lands) but would break `resolveWorld`'s "each distinct surface damps exactly
    // once" contract for ordinary driving. A driven car must reach `resolveWorld` exactly once.
    const wall: StepContext = {
      carId: "mirage",
      others: [],
      obstacles: [{ x: 300, y: 200, w: 200, h: 200 }],
      bounds: { width: 1280, height: 720 },
      modifiers: NEUTRAL_MODIFIERS,
    };
    const driving: SimBody = {
      x: 200,
      y: 300,
      angle: 0,
      speed: 300,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
      maneuver: ManeuverKind.NONE,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
    };
    let body = driving;
    for (let tick = 0; tick < 20; tick++) body = stepSim(body, UP, DT, wall);
    // One bounce off one surface: speed is damped by `restitution` once, never r^2 or r^3, so a
    // car that hit the wall is still rolling rather than stopped dead by repeated damping.
    expect(body.x).toBeLessThan(300);
    expect(Math.abs(body.speed)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the sweep and verify it fails on the real bug**

```bash
npx vitest run packages/shared/src/sim/step.test.ts -t "dash substepping"
```

Expected: the first test FAILS, and the `failures.slice(0, 10)` assertion prints the first ten as readable strings — a mix of `ended … PAST the target centre` entries across several approach angles. This is the bug reproducing. The other three tests in the block should already PASS against the current code; if one of them fails, stop and diagnose before continuing, because it means the pre-change baseline is not what this plan assumes.

- [ ] **Step 3: Add the substep loop**

In `packages/shared/src/sim/step.ts`, add to the imports from `./drive.js`:

```ts
import { dashSubstepCount, dashTranslation, isDashing, stepDrive } from "./drive.js";
```

Then replace the body of `stepSim`:

```ts
export function stepSim(body: SimBody, input: InputMessage, dt: number, ctx: StepContext): SimBody {
  const driven = stepDrive(body, input, dt, driveOf(ctx.carId), ctx.modifiers);
  return resolveWorld(driven, ctx.others, ctx.obstacles, ctx.bounds);
}
```

with:

```ts
export function stepSim(body: SimBody, input: InputMessage, dt: number, ctx: StepContext): SimBody {
  const driven = stepDrive(body, input, dt, driveOf(ctx.carId), ctx.modifiers);
  if (!isDashing(body)) {
    return resolveWorld(driven, ctx.others, ctx.obstacles, ctx.bounds);
  }
  return resolveDash(body, driven, dt, ctx);
}

/**
 * A dash, resolved in bounded steps instead of one teleport.
 *
 * `thunderclap` covers 53.3 units per tick against a 48x32 hull, so a single translation lands the
 * car deep inside whatever it hit — and `mtvBetween` returns the SHORTEST way out of an overlap,
 * which for a deep overlap is not the way the car came in. The resolver is not wrong; it is being
 * asked the wrong question (C1). Rather than teach it where the body came from — an entry-normal
 * or a swept hull, a rewrite of `resolveWorld` and its ordering contract — this bounds how far the
 * body may move between checks, so "shortest way out" and "back the way you came" stay the same
 * direction and the existing resolver is already right (C2).
 *
 * Three things this deliberately does:
 *
 * - **Re-walks from the ORIGINAL position, carrying the tick's bookkeeping.** `driven` already
 *   holds the once-per-tick state — the duration countdown, the exit-speed handoff, the shove and
 *   authority decay — and `stepDrive` applied the full-`dt` translation on top of it. Winding the
 *   position back to `body.x/y` and walking it forward in N pieces re-does only the translation
 *   (C6). In free air the N pieces sum to the same distance, so an uncontested dash is unchanged.
 * - **Holds the world frozen across substeps.** `ctx.others`, `ctx.obstacles` and `ctx.bounds` are
 *   the start-of-tick snapshot every car is already stepped against; re-reading mid-tick would
 *   make the outcome depend on iteration order (C7).
 * - **Does not break out early when a substep is blocked.** Later substeps translate into the
 *   target again and are pushed out again, so the car settles flush against what it hit. Detecting
 *   "made no progress" needs a float epsilon for no behavioural gain (C8).
 *
 * Gated on DASH by the caller even though the derived count would independently be 1 for every
 * other body in the game — the roster's fastest car covers ~10.5u per tick. `applyContact` damps
 * `speed` and reflects the shove on every call, and `resolveWorld`'s contract is that each distinct
 * surface damps exactly once, never r^2 or r^3. Repeating it is harmless for a dash, whose motion
 * comes from `maneuverSpeed` and whose `speed` is overwritten by `endDash` on the tick the hit
 * lands; it would not be harmless for ordinary driving (C9). The gate documents that intent.
 */
function resolveDash(body: SimBody, driven: SimBody, dt: number, ctx: StepContext): SimBody {
  const substeps = dashSubstepCount(body, dt);
  const step = dashTranslation(body, dt / substeps);
  let next: SimBody = { ...driven, x: body.x, y: body.y };
  for (let i = 0; i < substeps; i++) {
    next = resolveWorld(
      { ...next, x: next.x + step.x, y: next.y + step.y },
      ctx.others,
      ctx.obstacles,
      ctx.bounds,
    );
  }
  return next;
}
```

- [ ] **Step 4: Run the sweep and verify it passes**

```bash
npx vitest run packages/shared/src/sim/step.test.ts
```

Expected: PASS, the whole file green.

- [ ] **Step 5: Verify nothing else moved**

```bash
npm test
```

Expected: PASS across all three workspaces and `scripts/` — with one known exception. `scripts/manual-page.test.mjs` **will fail** from here on: `balanceStamp` hashes `DRIVE_CONFIG` whole via `JSON.stringify`, so Task 1's new key moved the fingerprint even though no player-facing number changed (C18). Task 4 fixes it. Every other suite must be green, and in particular:

- `golden.test.ts` — unchanged, no fixture regeneration (C15).
- `drive.test.ts`'s `"maneuvers (spec S3 / O13)"` block — unchanged and green (C16).
- `scripts/turn-tuning-doc.test.mjs` — green. It reads six named `DRIVE_CONFIG` fields, none of which changed, and does not enumerate the object's keys.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/step.ts packages/shared/src/sim/step.test.ts && git commit -m "fix(shared): substep the dash translation so thunderclap stops on first contact (C2/C5)"
```

---

## Task 4: Repo chores — the manual, the stale probe comment, and a full verification

**Files:**
- Modify: `packages/client/public/manual.html` (regenerated, never hand-edited)
- Modify: `packages/server/playtest/weapons2.ts:203-208` (comment only)

**Interfaces:**
- Consumes: everything above.
- Produces: a green `npm test` and a build whose server bundle actually contains the fix.

- [ ] **Step 1: Confirm the manual test is red for the reason C18 predicts**

```bash
node --test scripts/manual-page.test.mjs
```

Expected: FAIL, naming a fingerprint mismatch and telling you to run `npm run build:manual`.

- [ ] **Step 2: Regenerate the manual**

```bash
npm run build:manual
```

Expected: the script rewrites `packages/client/public/manual.html`. `git diff --stat` should show that one file. No player-facing number changes — the stamp moved because `dashSubstepMaxUnits` joined the hashed object, which is the whole rule: if the stamp moved, the page owed players a rebuild.

- [ ] **Step 3: Fix the stale probe comment**

In `packages/server/playtest/weapons2.ts`, the W15 skip explanation cites a measurement this change invalidates. Replace:

```ts
    // A maneuver row has no muzzle to bury in the victim — the bug this probe exists to catch.
    // Its damage rides the contact pass, which fires on contact ENTRY: hulls parked flush give a
    // dash no edge to enter on, and a stationary charge slams nobody, so both would read as a
    // point-blank miss here while working exactly as authored (thunderclap 22/24, wildcharge
    // 24/24 when this swept them).
```

with:

```ts
    // A maneuver row has no muzzle to bury in the victim — the bug this probe exists to catch.
    // Its damage rides the contact pass, which fires on contact ENTRY: hulls parked flush give a
    // dash no edge to enter on, and a stationary charge slams nobody, so both would read as a
    // point-blank miss here while working exactly as authored (thunderclap 22/24, wildcharge
    // 24/24 when this last swept them).
    //
    // The 22/24 was ALSO a real bug for a while, and is no longer: a dash covering 53.3u per tick
    // teleported clean through its target and was ejected sideways by the MTV resolver. Fixed
    // 2026-09-02 by substepping the dash translation (`docs/superpowers/specs/
    // 2026-09-02-dash-substepping-design.md`). That fix does not change this row's verdict — a car
    // that starts flush still has no contact edge to enter on, whatever its travel per check — so
    // the skip below stands on its own reasoning, not on the old number.
```

- [ ] **Step 4: Verify the probes still compile**

```bash
npm run typecheck -w @motor-combat-moba/server
```

Expected: PASS. The probes have their own `tsconfig` and are typechecked here; a probe that does not build measures nothing.

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: PASS, everything green including `scripts/manual-page.test.mjs`.

- [ ] **Step 6: Build and confirm the fix actually reached the server bundle**

```bash
npm run build
```

Then confirm the shared `dist` inlined into the server is the one you just wrote, not a stale or cross-worktree copy:

```bash
grep -c "dashSubstepMaxUnits" packages/server/dist/index.js
```

Expected: a count of at least 1. A count of 0 means the server bundle is running an older shared — rebuild in the correct order (root `npm run build`, never `--workspaces`), and in a worktree run `npm install` first.

- [ ] **Step 7: Commit**

```bash
git add packages/client/public/manual.html packages/server/playtest/weapons2.ts && git commit -m "chore: rebuild the cars & weapons guide and correct W15's stale dash note (C17/C18)"
```

- [ ] **Step 8: Report what the probes now measure differently**

Do **not** run `npm run playtest` on your own initiative, and do not update any probe's thresholds or expectations beyond the comment in Step 3. Instead, say the following in the summary, loudly:

> This change moves what the playtest probes measure. `weapons.ts` W1's maneuver-reach row drives `thunderclap` into a target and measures the hit it lands — the dash now stops on first contact for every approach phase instead of 40% of them, so its numbers may move. `collision.ts` and `geometry.ts` measure penetration depth against a sim that no longer lets a dash bury itself. **`npm run playtest` is recommended**, and reading what moved is your call.

---

## Self-Review

**Spec coverage.** C1/C2 — Task 3's `resolveDash` doc comment and the loop itself. C3 — `dashSubstepCount`, Task 2, tested for derivation rather than a hardcoded 4. C4 — Task 1's `Math.min(carWidth, carHeight) / 2` pin. C5 — the loop is in `step.ts`; Task 3 Step 3. C6 — Task 2's split, plus the "burns the dash's duration once per tick" test. C7 — the frozen `ctx` is documented and structurally guaranteed, since `resolveDash` never re-reads. C8 — no early break; documented. C9 — the `isDashing` gate plus the "leaves an ordinary driving car on the single-step path" test. C10 — obstacles and bounds ride the same `resolveWorld` call, no extra work. C11 — Task 1. C12 — the gameplay change is what the sweep's `along >= 0` assertion pins. C13 — the free-air test in Task 3. C14 — the sweep: 12 approach angles x 4 target orientations x 24 phases x 8 ticks. C15 — asserted at Task 2 Step 5 and Task 3 Step 5. C16 — `drive.test.ts`'s existing block is explicitly not to be edited, stated in the Global Constraints and re-checked at Task 3 Step 5. C17 — amended and handled in Task 4 Steps 3 and 8, with the reason it is stale recorded under File Structure. C18 — Task 4 Steps 1, 2 and 7.

**Placeholder scan.** No TBDs, no "handle edge cases", no "similar to Task N". Every code step carries the literal code.

**Type consistency.** `isDashing(body: SimBody): boolean`, `dashTranslation(body: SimBody, dt: number): { x: number; y: number }` and `dashSubstepCount(body: SimBody, dt: number): number` are defined in Task 2 and consumed under those exact names and signatures in Task 3. `DRIVE_CONFIG.dashSubstepMaxUnits` is defined in Task 1 and read in Task 2. `resolveDash` is private to `step.ts` and referenced nowhere else. `obbsOverlap` and `Obb` are existing exports of `./collide.js`; `ManeuverKind` is an existing export of `./maneuver.js`.
