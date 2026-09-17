# Stage 2: Walls and Bumps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give walls, obstacles and car-to-car bumps Unity's zero-bounce, zero-friction response: the
speed into a surface is removed, the speed along it is untouched.

**Architecture:** `applyContact` already reflects the whole velocity vector by
`v' = v - (1 + e)(v·n)n`. At `e = 0` that IS Unity's contact material. **This stage changes one
constant and then fixes everything pinned to the old one.** No resolver logic is edited — if a step
here has you rewriting `collide.ts`, stop: the spec (U22) says the constant is the change.

**Tech Stack:** TypeScript, npm workspaces, vitest.

**Spec:** [`docs/superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`](../../specs/2026-09-18-unity-driving-and-ram-physics-port-design.md)
— §6 and decision U22.

**Ledger:** [`interfaces.md`](interfaces.md).

**Depends on:** stage 1 landed, `npm test` green apart from the three known-red bot tests.

## Global Constraints

- **`npm test` from the repo root.** **`npm run build`** at the root, never `--workspaces`.
- Rebuild shared after editing it: `npm run build -w @motor-combat-moba/shared`.
- No magic numbers in logic; constants live in `packages/shared/src/config/`.
- Do not touch `docs/ideas/` or `docs/invariants/`.
- `packages/server/playtest/` is **not** part of `npm test`. This stage does not fix the probes —
  stage 5 does — but it does record what it invalidated.

---

### Task 1: Restitution to zero

**Files:**
- Modify: `packages/shared/src/config/drive-config.ts` (`restitution`)
- Test: `packages/shared/src/sim/collide.test.ts:645-706,923-999`,
  `packages/shared/src/sim/golden.test.ts:174-302`

**Interfaces:**
- Consumes: nothing from stage 1 beyond a green tree.
- Produces: `DRIVE_CONFIG.restitution === 0`.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/sim/collide.test.ts`, reusing that file's existing body and `BOUNDS`
helpers rather than adding new ones:

```ts
describe("Unity's zero-bounce contact", () => {
  it("removes the speed into a wall and keeps the speed along it", () => {
    // Driving at 45° into the left wall: the x component dies, the y component is untouched.
    const body = { ...restingBody(), x: 5, y: 300, angle: 0, vx: -100, vy: 100 };
    const out = resolveWorld(body, [], [], BOUNDS, 50);
    expect(out.vx).toBeCloseTo(0, 9);
    expect(out.vy).toBeCloseTo(100, 9);
  });

  it("never returns more speed than it was given, at any approach angle", () => {
    for (let deg = 5; deg <= 85; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const body = { ...restingBody(), x: 5, y: 300, angle: 0, vx: -200 * Math.cos(rad), vy: 200 * Math.sin(rad) };
      const out = resolveWorld(body, [], [], BOUNDS, 50);
      expect(Math.hypot(out.vx, out.vy)).toBeLessThanOrEqual(200 + 1e-9);
    }
  });

  it("is idempotent: resolving an already-resolved contact changes nothing", () => {
    const body = { ...restingBody(), x: 5, y: 300, angle: 0, vx: -100, vy: 0 };
    const once = resolveWorld(body, [], [], BOUNDS, 50);
    const twice = resolveWorld(once, [], [], BOUNDS, 50);
    expect(twice.vx).toBeCloseTo(once.vx, 9);
    expect(twice.vy).toBeCloseTo(once.vy, 9);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w @motor-combat-moba/shared -- collide.test
```

Expected: FAIL — `vx` comes back at `+15` (0.15 × 100), not 0.

- [ ] **Step 3: Set the constant**

In `drive-config.ts`, replace the `restitution` value and rewrite its doc comment:

```ts
  /**
   * Coefficient of restitution for every contact — walls, obstacles and cars alike.
   *
   * **0: nothing in this game bounces.** Unity's cars carry a zero-friction, zero-bounce contact
   * material (`CarFactory.Frictionless`), and this is that material: `applyContact` removes the
   * velocity INTO a surface and leaves the velocity ALONG it, so a car angled at a wall slides down
   * it instead of rebounding. It was 0.35, then 0.15 from 2026-09-06, on the argument that real cars
   * crush rather than bounce — the Unity port finishes that argument.
   *
   * Two things follow. The reflection is now idempotent, so the relaxation passes cannot compound a
   * rebound. And knockback in this game comes from ramming alone (`sim/ram.ts`), never from
   * springiness here — raising this to get bigger knocks is reaching for the wrong knob.
   */
  restitution: 0,
```

- [ ] **Step 4: Run the new tests**

```bash
npm test -w @motor-combat-moba/shared -- collide.test
```

Expected: the three new cases PASS. Older cases in the same file now fail — Step 5.

- [ ] **Step 5: Re-pin the tests that encoded the bounce**

- `collide.test.ts:645-706`, "one restitution per distinct surface (r², never r³)": the property it
  guards — each surface damps once — is now invisible, because zero applied twice is still zero.
  **Replace it, do not delete it**, with the idempotence case from Step 1 plus a comment recording
  what it used to guard and that a future non-zero restitution needs the old form back.
- `collide.test.ts:923-999`, the whole-velocity reflection cases: keep the DIRECTION assertions (a
  car angled at a wall must come out moving along it — the 2026-09-06 fix, still true) and re-pin the
  magnitudes to the dead-stop value.
- `golden.test.ts:174-302`: the wall bounce, the corner double-reflection and the car-car separation
  traces all move. Run, read the actual numbers, paste them in, and **add a dated REFIXTURED
  paragraph** in the file's own style. Its hand-derivation block quotes
  `v' = v - (1+restitution)(v·n)n` — update the worked numbers, not the formula.

- [ ] **Step 6: Verify**

```bash
npm run build -w @motor-combat-moba/shared && npm test
```

Expected: shared green. `packages/server/src/sim/pipeline-order.test.ts` is expected to fail — Task 2.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src
git commit -m "feat(collide): zero restitution — walls and bumps stop bouncing"
```

---

### Task 2: The server-side expectations that priced the bounce

**Files:**
- Modify: `packages/server/src/sim/pipeline-order.test.ts:75-131`,
  `packages/server/src/sim/ram-bridge.test.ts` (only the cases whose arithmetic includes a rebound),
  `packages/shared/src/config/ram-config.ts:112,145` (comments only)

**Interfaces:**
- Consumes: Task 1's constant.
- Produces: a green server suite.

- [ ] **Step 1: Run the server suite and list the failures**

```bash
npm test -w @motor-combat-moba/server
```

Write the list down before touching anything. Each failure is one of two kinds:

- **It recomputed an expectation from `DRIVE_CONFIG.restitution`.** Re-run and re-pin: the arithmetic
  is still right, the constant moved.
- **It asserted that a rebound happens at all** — `pipeline-order.test.ts`'s "the attacker eats
  restitution AND its own contest impulse" is the headline case. That behaviour is **gone**, not
  merely smaller. Rewrite the case to assert what now happens (the attacker keeps its along-surface
  motion and loses the into-surface part) and leave a comment naming this stage.

- [ ] **Step 2: Fix the ram-config comments**

`ram-config.ts:112` and `:145` argue from `DRIVE_CONFIG.restitution` inside the `globalScale` and
`spinScale` calibration prose. Those constants are re-pitched in stage 3 anyway, so correct only what
is now false — one line noting restitution is 0 as of this stage and that the tables below were
measured at 0.15 — rather than rewriting tables stage 3 deletes.

- [ ] **Step 3: Verify**

```bash
npm run build && npm test
```

Expected: green except the three already-red bot tests.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(sim): re-pin the contact expectations at zero restitution"
```

---

### Task 3: Measure what zero restitution did to the spikes

**Files:**
- Modify: `docs/combat-model.md` (environmental hazards), `CLAUDE.md` (the spikes paragraph) — **only
  if the measurement moves the documented behaviour**

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: a measured answer, and docs that match it.

`SPIKE_CONFIG` charges 80 damage on a fresh push into the surface above `triggerSpeed` (25 u/s). The
documented behaviour is that a **self-driven** car settles at about 5 u/s into a wall and so pays
once, on arrival, while an **externally shoved** car keeps paying. That figure was measured at
restitution 0.15 and has to be re-measured: a car that no longer rebounds sits against the wall
differently.

- [ ] **Step 1: Measure it**

Run this from the repo root after a shared build. It is throwaway — do not add a file to the repo:

```bash
node --input-type=module -e "
const m = await import('./packages/shared/dist/index.js');
let b = { x: 100, y: 300, angle: Math.PI, vx: 0, vy: 0, angVel: 0, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0 };
const bounds = { width: 1280, height: 720 };
for (let i = 0; i < 120; i++) {
  b = m.stepDrive(b, { steer: 0, throttle: 1, fireSlots: 0 }, 1/30, m.driveOf('bastion'), m.NEUTRAL_MODIFIERS);
  b = m.resolveWorld(b, [], [], bounds, 90);
  if (i > 110) console.log(i, 'into wall u/s:', (-b.vx).toFixed(2));
}
"
```

Adjust the import list to what `dist` actually exports and the body literal to the current `SimBody`
shape. The number you want is the settled speed into the wall, per tick, once the car is pressed
against it.

- [ ] **Step 2: Compare against `SPIKE_CONFIG.triggerSpeed`**

- **Settled speed below `triggerSpeed`:** the documented behaviour holds. Add one sentence to
  `docs/combat-model.md`'s spikes section recording the re-measurement at restitution 0 and the
  number.
- **Settled speed at or above `triggerSpeed`:** a self-driven car now bleeds against spikes forever.
  That is a balance change and **is not this stage's to decide** — record the measurement, change no
  code, and hand it to the user in the stage's handoff, naming the number and the knob
  (`SPIKE_CONFIG.triggerSpeed`).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(combat-model): re-measure the spike self-trigger at zero restitution"
```

---

### Task 4: Record what this invalidated, and close the stage

**Files:**
- Modify: `EXECUTION.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: the tracker row.

- [ ] **Step 1: Note the probe damage without fixing it**

`packages/server/playtest/collision.ts` computes its energy-gain sweep from
`atan(sqrt(DRIVE_CONFIG.restitution))`, which is now `atan(0)` — zero degrees — so that probe sweeps
nothing. **Do not fix it here.** Stage 5 owns the probes and needs to know: write the file, the line
and the consequence into `EXECUTION.md`'s deferred list.

- [ ] **Step 2: Full verification**

```bash
npm run build && npm test
```

Expected: green except the three already-red bot tests.

- [ ] **Step 3: Commit and update the tracker**

```bash
git add -A
git commit -m "docs(execution): stage 2 landed — zero restitution"
```

Update [`EXECUTION.md`](EXECUTION.md) in this same commit: stage 2 to **Landed**, the spike
measurement from Task 3, and the probe note from Step 1.

---

## Stage 2 exit criteria

- [ ] `DRIVE_CONFIG.restitution` is 0 and `collide.ts` is otherwise unedited.
- [ ] A car driven into a wall at any angle slides along it and never gains speed.
- [ ] The contact resolution is idempotent, and a test says so.
- [ ] `npm test` green except the three already-red bot tests.
- [ ] The spike self-trigger is re-measured, and either documented as unchanged or handed to the user.
- [ ] `EXECUTION.md` records the `collision.ts` sweep that zero restitution silently flattened.
