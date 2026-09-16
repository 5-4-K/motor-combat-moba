# Bigger Cars (1.5x hull) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every car's real hull grows from 48 × 32 to 72 × 48 world units, while ram spin, arena
spawns, the bot, client overlays and all car art stay correct at the new size.

**Architecture:** The hull is one global value (`DRIVE_CONFIG.carWidth`/`carHeight`), and almost
every reader derives from it. So the logic edits are small: two config values, one ram calibration
knob, the FFA spawn rows of two arenas, and four typed client overlay sizes. Most of the work is
keeping the test suite honest:
- every fixture authored against 48 × 32 is rescaled or derived,
- every measured figure is re-measured by its own documented method,
- every bot-behaviour failure is root-caused before it is touched.

Nine car sprites are then re-imported at 144 px from the user's source folder.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared`/`server`/`client`), Vitest,
Phaser 4, sharp (art importer), `node --test` (scripts).

**Spec:** [`docs/superpowers/specs/2026-09-16-bigger-cars-design.md`](../specs/2026-09-16-bigger-cars-design.md)
(clauses BC1–BC34). Read it before any task; the plan argues from it.

## Global Constraints

- **Branch.** Work on `feature/bigger-cars`, already checked out in `E:\Work\motor-combat-MOBA`. No worktree. Commit after every task.
- **Commits.** Every commit message ends with the line `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **New values.** Hull `carWidth: 72`, `carHeight: 48` (BC3). `RAM_CONFIG.spinScale: 15` (BC7).
- **Derived figures (BC5).** Half-length 36, half-width 24, diagonal 86.53, half-diagonal 43.27, `inertiaCoefficient` 624, muzzle offset 36, car sprite width 144 px.
- **Shared is consumed as built `dist`.** After any edit under `packages/shared/src`, run `npm run build -w @motor-combat-moba/shared` before running server or client tests or any script.
- **Running tests.** Run one package's tests from its own directory: `cd packages/<pkg> && npx vitest run <path>`. The final verification is **root `npm test`**; per-workspace runs have silently skipped the server suite before.
- **Thresholds (BC13).** Never loosen a threshold unless a measurement by the test's own documented method justifies it, with a comment saying so. Never delete a test.
- **Scaled fixtures.** When a fixture's geometry is scaled 1.5x, its hand-derived expectation should come out **unchanged**. If it does not, stop and find out why before re-pinning.
- **Untouchable values (§1.1, BC19).** Do not change `WEAPON_TABLE`, `CAR_TABLE`, `COMBAT_CONFIG`, `AIM_CONFIG` values, `CAMERA_CONFIG`, `SPIKE_CONFIG`, arena boundaries or spike strips, or `BOT_PROFILES`.
- **Off-limits folders.** Do not read or grep inside `docs/ideas/` or `docs/invariants/`; exclude them from every sweep.
- **Historical docs.** Do not rewrite historical specs or plans under `docs/superpowers/` that quote 48 × 32. The one exception is the note in Task 9.
- **Playtest probes (BC29).** Do not edit or run anything in `packages/server/playtest/`, except to fix a compile break, which you must then report.
- **Red suites between tasks.** Between Tasks 1 and 8, suites outside a task's named files are **expected to be red**; later tasks own them. A task is done when **its named test files** pass. Task 9 makes the whole suite green.
- **The GateGuard hook.** A hook may ask you to state facts before a Bash command or a new file ("Fact-Forcing Gate"). Answer it truthfully and retry. It blocks `git checkout -- <file>`, so revert a temporary edit by editing it back.

---

### Task 1: Flip the hull and hold ram spin constant

**Files:**
- Modify: `packages/shared/src/config/drive-config.ts:144-145`
- Modify: `packages/shared/src/config/ram-config.ts` (`spinScale` value and its doc comment, ~lines 154-180)
- Modify: `packages/shared/src/config/ram-config.test.ts:44-110`
- Modify: `packages/shared/src/sim/ram.test.ts` ("produces an ordinary flank ram spin", ~255-290; "keeps only the hardest impulse", ~592-610)
- Modify (comments only): `packages/shared/src/sim/ram.ts:89`, `packages/shared/src/config/aim-config.ts:68`

**Interfaces:**
- Consumes: nothing.
- Produces: `DRIVE_CONFIG.carWidth === 72`, `DRIVE_CONFIG.carHeight === 48`, `RAM_CONFIG.spinScale === 15`, `RAM_CONFIG.inertiaCoefficient === 624`. Every later task relies on these.

- [ ] **Step 1: Update the pinned-knob and derivation tests first (they will fail)**

In `ram-config.test.ts`, in "pins the authored knobs", change the `spinScale` line to:

```ts
    // 10 -> 15 on 2026-09-16 (bigger cars, spec BC7): the hull grew 1.5x, so the maximum lever arm
    // grew 1.5x and `inertiaCoefficient` 2.25x; 1.5 * 1.5 / 2.25 = 1 keeps every ram's spin identical.
    expect(RAM_CONFIG.spinScale).toBe(15);
```

In "derives inertiaCoefficient from the hull, never typed":

```ts
    expect(RAM_CONFIG.inertiaCoefficient).toBeCloseTo((72 ** 2 + 48 ** 2) / 12, 9);
```

In "keeps the roster's hardest possible ram strictly under spinMaxRate":
- Change the attacker to `x: 36, y: -45`.
- Rewrite the comment's geometry paragraph for the new hull: "the hull's half-length, 36 u"; the recovered local contact is "(36, -24)", with x at the half-length 36 and y at the half-width 24, because 45 exceeds it.
- Rewrite the derivation: `torque = 36*155.912 ~= 5612.83`, `inertia = 30 * 7488/12 = 18720`, `spin = (5612.83/18720) * 15 ~= 4.4975`.
- Add one sentence: the 2026-09-16 hull resize scaled this geometry 1.5x and moved `spinScale` to 15, which is why the figure did not move.
- Leave the `toBeCloseTo(4.4975, 3)` expectation **unchanged**.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd packages/shared && npx vitest run src/config/ram-config.test.ts`
Expected: FAIL on `spinScale` (10 vs 15) and `inertiaCoefficient` (277.33 vs 624).

- [ ] **Step 3: Flip the hull and the knob**

`drive-config.ts`:

```ts
  carWidth: 72,
  carHeight: 48,
```

In `ram-config.ts`, set `spinScale: 15,`. Then edit its doc comment:
- Add this paragraph after the "Re-pitched 100 -> 10" paragraph:

```ts
   * **Moved 10 -> 15 on 2026-09-16 by derivation, not measurement (bigger cars, spec BC7).** The
   * hull grew 48x32 -> 72x48: `contactPointOn`'s maximum lever arm grew 1.5x and
   * `inertiaCoefficient` grew 2.25x, so every ram would otherwise spin its victim 0.667x as hard.
   * 1.5 * 1.5 / 2.25 = 1 — the spin a player feels is unchanged, and so is every figure below once
   * its lever arm is read at the new scale. Stage 5 of the car-physics rework re-pitches from 15.
```

- Relabel the table's lever column from `4 u` / `12 u` / `24 u (clamped max)` to `6 u` / `18 u` / `36 u (clamped max)`. Leave the values as they are.
- Change "clamps at the 24 u hull half-length" to "clamps at the 36 u hull half-length".

- [ ] **Step 4: Rebuild shared and run the ram-config tests**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/shared && npx vitest run src/config/ram-config.test.ts`
Expected: PASS, including the hardest ram still at 4.4975.

- [ ] **Step 5: Rescale the two ram.test.ts fixtures**

In "produces an ordinary flank ram spin in a sane, non-trivial band":
- Change the attacker from `x: 12, y: -30` to `x: 18, y: -45`.
- Update the comment to match:
  - "attacker at (18,-45)"
  - "The recovered contact point clamps the attacker's offset into the victim's hull half-extents (36 long, 24 wide): local (18, -45) clamps to (18, -24)"
  - `torque = 18 * 118.8272 ~= 2138.890`
  - `inertia = 50 * 7488/12 = 31200`
  - `spin = (2138.890 / 31200) * 15 ~= 1.0283 rad/s`
- Leave the band (`> 0.9`, `< 1.2`) unchanged.
- In the "reverting `spinScale` toward 100" sentence, change "toward 100" to "toward 150 (10x)".

In "keeps only the hardest impulse when one car is hit by two others in a tick":
- Change `soft` to `x: 18, y: -45` and `hard` to `x: 18, y: 45`. At ±30, the two 72-long attackers overlap and ram each other, producing a second impulse.
- Add this comment:

```ts
    // y = ±45, not ±30: at the 72x48 hull the two attackers (72 long along y) must stay clear of EACH
    // OTHER, or they ram one another and a second impulse appears for a reason unrelated to this test.
```

- [ ] **Step 6: Fix the two comments that state the hull size**

- `ram.ts:89`: change "The hull is 48 long by 32 wide" to "The hull is 72 long by 48 wide". Re-read the rest of that comment block and fix any figure derived from it.
- `aim-config.ts:68`: change "cars are 48 x 32" to "cars are 72 x 48". Leave the rest.

- [ ] **Step 7: Run the Task 1 test files**

Run: `cd packages/shared && npx vitest run src/config/ram-config.test.ts src/sim/ram.test.ts src/config/config.test.ts`
Expected: PASS, all three.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/config/drive-config.ts packages/shared/src/config/ram-config.ts packages/shared/src/config/ram-config.test.ts packages/shared/src/sim/ram.test.ts packages/shared/src/sim/ram.ts packages/shared/src/config/aim-config.ts
git commit -m "feat(sim): grow the car hull to 72x48 and hold ram spin with spinScale 15

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Move FFA spawns clear of the spikes

**Files:**
- Modify: `packages/shared/src/arena/arena-01.ts:86-91`
- Modify: `packages/shared/src/arena/arena-02.ts:59-64`
- Test (unchanged, must pass): `packages/shared/src/arena/arena-01.test.ts`, `arena-02.test.ts`, `arena.test.ts`, `packages/shared/src/flow/spawns.test.ts`

**Interfaces:**
- Consumes: the 72 × 48 hull from Task 1 (the tests read `DRIVE_CONFIG`).
- Produces: new FFA spawn rows (BC10).

- [ ] **Step 1: Confirm the failure**

Run: `cd packages/shared && npx vitest run src/arena`
Expected: FAIL. "clears every spike strip by more than a car diagonal" reports 76 (arena-01) and 69 (arena-02) against 86.53.

- [ ] **Step 2: Move the rows**

`arena-01.ts` `ffaSpawns` (x and angle unchanged):

```ts
    { x: 200, y: 180, angle: 0 },
    { x: 1080, y: 180, angle: Math.PI },
    { x: 200, y: 540, angle: 0 },
    { x: 1080, y: 540, angle: Math.PI },
    { x: 640, y: 180, angle: Math.PI / 2 },
    { x: 640, y: 540, angle: -Math.PI / 2 },
```

`arena-02.ts` `ffaSpawns`:

```ts
    { x: 200, y: 187, angle: 0 },
    { x: 1080, y: 187, angle: Math.PI },
    { x: 200, y: 543, angle: 0 },
    { x: 1080, y: 543, angle: Math.PI },
    { x: 640, y: 187, angle: Math.PI / 2 },
    { x: 640, y: 543, angle: -Math.PI / 2 },
```

If either file has a comment next to `ffaSpawns` that quotes the old y values or a clearance, update
it: since the 2026-09-16 hull resize, every FFA row clears the spike band by about 106 u, the same as
the team spawns (spec BC10).

- [ ] **Step 3: Sweep for other readers of the old coordinates**

Run: `git grep -n -E "y: ?(150|570)\b" -- packages docs/*.md ':!docs/ideas' ':!docs/invariants' ':!docs/superpowers'`

For each hit, decide whether it refers to these FFA spawns. Most hits are unrelated fixtures, such as
`combat-bridge.test.ts`'s `y: 150`. Update only genuine references to these spawn rows. Playtest
probes are flagged, not edited.

- [ ] **Step 4: Run the arena and spawn tests**

Run: `cd packages/shared && npx vitest run src/arena src/flow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/arena/arena-01.ts packages/shared/src/arena/arena-02.ts
git commit -m "feat(arena): move FFA spawns inward so a 72x48 car clears the spikes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Rescale shared collision, golden, lock and aim fixtures

**Files:**
- Modify: `packages/shared/src/sim/collide.test.ts` (fixtures at ~208-216, ~227-263, ~268-280, ~345-348, ~593-620, ~623-638, ~641-675)
- Modify: `packages/shared/src/sim/golden.test.ts` (~225-277, the `resolveWorld` block only)
- Modify: `packages/shared/src/sim/weapons/lock.test.ts:139-145`
- Modify: `packages/shared/src/sim/combat.test.ts` (~835-854 and ~1880-1900)

**Interfaces:**
- Consumes: the 72 × 48 hull. `CAR_W`/`CAR_H` in `collide.test.ts` already read `DRIVE_CONFIG`.
- Produces: nothing new.

- [ ] **Step 1: Confirm the failures**

Run: `cd packages/shared && npx vitest run src/sim/collide.test.ts src/sim/golden.test.ts src/sim/weapons/lock.test.ts src/sim/combat.test.ts`
Expected: FAIL. There are 9 failures in collide, 4 in golden, 1 in lock and 2 in combat, matching the spec's dry run.

- [ ] **Step 2: collide.test.ts, "leaves a body that only touches an obstacle edge alone"**

```ts
    // Car spans [100 - CAR_W/2, 100 + CAR_W/2] on x at angle 0; this obstacle starts exactly at its +x face.
    const touching: Aabb = { x: 100 + CAR_W / 2, y: 90, w: 100, h: 100 };
```

- [ ] **Step 3: collide.test.ts, the "the car is a real OBB" pair**

Scale the whole configuration by 1.5 about the car centre (100, 100). A similarity transform
preserves every inside/outside relation the comment hand-computed.

```ts
  // Car centre (100,100), half-extents 36 x 24.
```

```ts
  // Sits just past the car's +x face, but inside the 45deg-rotated rectangle.
  // (The 48x32-era fixture scaled 1.5x about the car centre with the 2026-09-16 hull resize, so every
  // hand-computed inside/outside relation is preserved exactly.)
  const clearsAxisAligned: Aabb = { x: 137.5, y: 106, w: 6, h: 6 };
  // Sits inside the car's +x/-y corner, but outside the 45deg-rotated rectangle.
  const clearsRotated: Aabb = { x: 130, y: 76, w: 6, h: 6 };
```

- [ ] **Step 4: collide.test.ts, "separates two cars overlapping along x"**

Change `other.x` from 520 to **530**. At 520 the x overlap (52) exceeds the y overlap (48), so the
resolver correctly picks y and the test's premise breaks. Add this comment:

```ts
    // 30 apart (scaled with the 2026-09-16 hull): x overlap CAR_W - 30 = 42 stays under the y overlap
    // CAR_H = 48, so the shortest way out is still along x, which is the axis this test is about.
```

- [ ] **Step 5: collide.test.ts, "converges a real-ramDefence pair…"**

Change `bastion`'s x from 630 to **645**. The starting depth becomes 27, which is 1.5x the old 18.

Run the test. If `depths[depths.length - 1]` is still above `TOUCH_SLACK`, do **not** raise
`TOUCH_SLACK`. Instead:
1. Print `depths` once with a temporary `console.log`, and count the ticks until the depth drops under 1e-6.
2. If that count is under 20, the assertion should already pass, so recheck which axis the resolver chose.
3. If it genuinely needs more ticks because it started 1.5x deeper, raise `MAX_TICKS` to the smallest value that converges, and quote the printed tick count in a comment saying why.
4. Remove the log.

- [ ] **Step 6: collide.test.ts, "contact priority ordering" (both tests in the describe)**

Derive the positions so "starts 6px clear, pushed 7px in" stays literally true at any hull size:

```ts
    // Starts 6px CLEAR of the block; the car-vs-car push (a 13px overlap) drives it 7px in.
    const start = body({ x: block.x - CAR_W / 2 - 6, y: 1210, angle: 0 });
    const other: Obb = { x: start.x - (CAR_W - 13), y: 1210, angle: 0, w: CAR_W, h: CAR_H };
```

Apply the same `start`/`other` to "gives obstacles priority over other cars…".

- [ ] **Step 7: collide.test.ts, "the leading bounds pass is load-bearing"**

```ts
    expect(out.x).toBe(BOUNDS.width - CAR_W);
```

Update the comment wherever it implies 952.

- [ ] **Step 8: collide.test.ts, "one restitution per distinct surface"**

Scale the fixture so the obstacle is still wider than the car, and the car is still both past the wall and inside the obstacle:

```ts
  const hugging: Aabb = { x: 910, y: 400, w: 90, h: 200 };
  // Car spans [949,1021]: past the wall at 1000 and overlapping the obstacle at 910.
  const wedged = () => body({ x: 985, y: 500, angle: 0, ...alongHeading(0, 100) });
```

Update the prose to "it spans x[910,1000]". In "leaves the wedged body deeply embedded…":

```ts
    expect(out.x).toBe(BOUNDS.width - CAR_W / 2);
    // CAR_W deep: the car's entire length, not a graze.
```

- [ ] **Step 9: Run collide.test.ts**

Run: `cd packages/shared && npx vitest run src/sim/collide.test.ts`
Expected: PASS.

If a test from Steps 2–8 still fails, re-read its comment. The fixture has to satisfy the premise the
comment states (which axis wins, which surface is touched). Adjust the geometry to that premise, never
the assertion.

- [ ] **Step 10: golden.test.ts, the `resolveWorld` block only (BC14)**

The drive-integration cases in this file stay untouched. The `resolveWorld` cases read the hull and
re-pin as follows.

"bounces off the left wall": `expectPose(out, 36, 400, Math.PI, -30);`

"reflects off both walls at a corner": `expectPose(out, 42.4264068712, 42.4264068712, 3.926990817, -22.5);`

"separates from another car": derive the other hull from `DRIVE_CONFIG`, and widen the separation
from 30 to 45 so the MTV stays along x:

```ts
    const other = {
      hull: { x: 545, y: 400, angle: 0, w: DRIVE_CONFIG.carWidth, h: DRIVE_CONFIG.carHeight },
      ramDefence: 90,
    };
```

Expected x: depth `72 - 45 = 27`, `27 * 90/140 = 17.357142857142858`, `x' = 500 - 243/14 = 482.6428571428571`:

```ts
    expectPose(out, 482.6428571428571, 400, 0, -37.5);
```

Import `DRIVE_CONFIG` if the file does not already. Then update the long REFIXTURED comment above
these cases by adding a dated paragraph, "RE-PINNED for the 2026-09-16 hull resize (72x48, spec
BC14)", explaining that:
- the wall cases now settle at the new half-extents: 36, and 60/√2 = 42.43 at the corner;
- the car case scaled its 30-unit centre gap to 45, so depth `72 - 45 = 27` is 1.5x the old 18, and `x' = 500 - 27 * 0.6428571428571429`.

"separates from an obstacle" is measured, not derived. Run the test and read the received pose from
the failure (x was 280.2220908548701 in the dry run). Re-pin every field `expectPose` checks, with
the printed values at the precision the file already uses. Say in the dated paragraph that this case
was re-measured.

If any case **outside** the `resolveWorld` describe fails, stop and report it (BC14).

- [ ] **Step 11: lock.test.ts, `muzzleOf`**

```ts
    expect(m.x).toBeCloseTo(100 + DRIVE_CONFIG.carWidth / 2, 6);
```

Import `DRIVE_CONFIG` from the shared config index the file already uses, or from `../../config/drive-config.js`.

- [ ] **Step 12: combat.test.ts, both `aimAngleFor` pins**

In "returns the muzzle-derived bearing…" and "stops steering a lock that was already held…":
- Change target `b` from `{ x: 124, y: 100 }` to `{ x: 136, y: 100 }`.
- Rewrite the comments to "muzzleOffset() == DRIVE_CONFIG.carWidth / 2 == 72 / 2 == 36, so the muzzle is at (36, 0). Target … at (136, 100), so dx = 100 and dy = 100".
- Keep the `Math.PI / 4` expectations.

The neighbouring `afterburner` test asserts `null`; leave it at 124 unless it fails.

- [ ] **Step 13: Run the whole shared suite**

Run: `cd packages/shared && npx vitest run`
Expected: PASS, every shared test.

- [ ] **Step 14: Commit**

```bash
git add packages/shared/src/sim/collide.test.ts packages/shared/src/sim/golden.test.ts packages/shared/src/sim/weapons/lock.test.ts packages/shared/src/sim/combat.test.ts
git commit -m "test(sim): rescale collision, golden and aim fixtures to the 72x48 hull

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Re-measure dash penetration against the new hull

**Files:**
- Modify: `packages/shared/src/sim/step.test.ts` (~100-110 comment; ~285-323 bounds and comments; ~327 comment)
- Modify: `packages/shared/src/config/drive-config.ts` (the `dashSubstepMaxUnits` doc comment, ~146-207; the value stays 16)
- Modify: `packages/shared/src/sim/step.ts:108` (comment)
- Modify: `packages/shared/src/config/config.test.ts:251-257` (comment only)

**Interfaces:**
- Consumes: the 72 × 48 hull.
- Produces: re-measured penetration figures (BC11). No code behaviour changes.

- [ ] **Step 1: Measure the full-sweep and reachable worst cases**

In `step.test.ts`, in the sweep test that computes `worstDepth` and `worstReachableDepth`, add this
temporary line immediately before the `MAX_PENETRATION` assertion:

```ts
    console.log("MEASURE", JSON.stringify({ worstDepth, worstDepthLabel, worstReachableDepth, worstReachableDepthLabel }));
```

Run: `cd packages/shared && npx vitest run src/sim/step.test.ts --reporter=verbose 2>&1 | grep MEASURE`
Record all four values exactly.

- [ ] **Step 2: Measure the `dashSubstepMaxUnits` table**

For each of 16, 12, 8, 6 and 4 in turn:
1. Temporarily set `dashSubstepMaxUnits` in `drive-config.ts` to that value.
2. Run `npm run build -w @motor-combat-moba/shared && cd packages/shared && npx vitest run src/sim/step.test.ts --reporter=verbose 2>&1 | grep MEASURE`.
3. Record `worstReachableDepth`.

When all five are recorded, **set the value back to 16** and remove the `console.log`. Check
`git diff packages/shared/src/config/drive-config.ts`: the only remaining diff lines should be the
comment edits from later steps.

- [ ] **Step 3: Re-derive the bounds in step.test.ts**

- `MAX_PENETRATION`: keep the old headroom ratio `34 / 26.640625`. The new value is `Math.ceil(newWorstDepth * 34 / 26.640625)`, written as an integer literal.
- `MEASURED_WORST_REACHABLE`: set it to the exact measured `worstReachableDepth`.
- `MAX_REACHABLE_PENETRATION`: keep the formula's shape, but replace the literal `26.640625` with the exact new `worstDepth`, so the ratio is `MAX_PENETRATION / newWorstDepth`.
- Update every comment figure in that test:
  - `~26.64u against the 48x32 hull` becomes the new value, "against the 72x48 hull";
  - the Mirage-into-Bullseye figure and its label take the new measurements;
  - the headroom arithmetic (`~23.6u`, `~37.0u`) is recomputed with the arithmetic the comment already shows.
- Add a dated line: "Re-measured 2026-09-16 for the 72x48 hull resize (spec BC11), same sweep and method."
- Comment at ~106: "53.3u per tick against a 48x32 hull" becomes "against a 72x48 hull".
- Comment at ~327: "against a 48-unit car" becomes "against a 72-unit car".

- [ ] **Step 4: Run the step test**

Run: `cd packages/shared && npx vitest run src/sim/step.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the `dashSubstepMaxUnits` doc comment in drive-config.ts**

- Replace the first line with: `Max world units a DASH may translate between collision checks. At most half the car's SHORT axis (24 at the 72x48 hull, since 2026-09-16); 16 predates that resize and is kept as a tighter, still-valid value.`
- In the band explanation:
  - "more than 16u apart … a 32-unit-wide band" becomes "more than 24u apart … a 48-unit-wide band";
  - "half the 32-unit face" becomes "half the 48-unit face";
  - "the 48-unit face is the wrong one" becomes "the 72-unit face is the wrong one".
- "At 16 the dasher still advances 13.3u…" stays as written, because it is set by speed, not the hull.
- In the measured worst case, replace `**18.49u** (exact: 18.492296006944457 …)` with the new exact `worstReachableDepth`, and say "against a 72x48 hull". Keep the stage-3 history sentence, then add "Re-measured 2026-09-16 for the hull resize."
- Recompute both decay sequences from the new base with the unchanged factors, `0.234375` (both cars resolving) and `0.625` (silent victim), to the same number of terms at 2-decimal precision.
- Replace the worst-penetration column of the five-row table with the Step 2 measurements.

- [ ] **Step 6: The other two comments**

- `step.ts:108`: "53.3 units per tick against a 48x32 hull" becomes "against a 72x48 hull". Re-read the sentence and fix any figure that depends on it.
- `config.test.ts:255`: "32-unit face can always be the competing escape axis, and sizing against the 48-unit face" becomes "48-unit face … sizing against the 72-unit face".

- [ ] **Step 7: Run shared again, then commit**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/shared && npx vitest run`
Expected: PASS.

```bash
git add packages/shared/src/sim/step.test.ts packages/shared/src/config/drive-config.ts packages/shared/src/sim/step.ts packages/shared/src/config/config.test.ts
git commit -m "test(sim): re-measure dash penetration against the 72x48 hull

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Rescale server sim fixtures

**Files:**
- Modify: `packages/server/src/sim/tick.test.ts` (`CORRIDOR_Y` ~26-38; "steps each player…" ~379-406; "settles angVel to exact neutral…" ~672-745)
- Modify: `packages/server/src/sim/ram-bridge.test.ts` (~525-575 fixture; ~313 comment)

**Interfaces:**
- Consumes: the 72 × 48 hull. Shared must be built.
- Produces: nothing new.

- [ ] **Step 1: Confirm the failures**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/server && npx vitest run src/sim/tick.test.ts src/sim/ram-bridge.test.ts`
Expected: 3 failures in tick and 1 in ram-bridge (spec §5).

- [ ] **Step 2: `CORRIDOR_Y`**

At `CORRIDOR_Y = 100`, a 48-wide car's top edge sits at 76. That is 2 u from arena-01's top spike
strip (y 54–74, x 129–310), so "ram knock state round-trip" (x 300, `vy -60`) grazes it. Before the
resize the clearance was 10 u (100 − 16 − 74). Restore it:

```ts
const CORRIDOR_Y = 108;
```

Update its doc comment to say that it keeps a 10 u clearance under that strip for a car half-width of
24 (`74 + 24 + 10`), and that it moved from 100 with the 2026-09-16 hull resize.

- [ ] **Step 3: "steps each player against the updated poses…"**

```ts
    const LEADER_X = 400;
    const FOLLOWER_X = 460; // < LEADER_X + carWidth, so the two start overlapping
    const CLEARING_SPEED = 450; // enough to open a gap in a single tick
```

These are the old 40-unit offset and 300 u/s speed, both scaled 1.5x with the hull. One tick at
450 u/s carries the leader about 15 u, so the gap reaches about 75, which is more than the new
`carWidth` of 72.

- [ ] **Step 4: Run tick.test.ts and read what is left**

Run: `cd packages/server && npx vitest run src/sim/tick.test.ts`

Expected: the round-trip and follower tests PASS. "settles angVel to exact neutral…" may still fail
on `toBeCloseTo(8.1, 2)`.

If the round-trip test's pinned `vx` (120.892) now fails, stop and report it: that value does not
read the hull.

- [ ] **Step 5: Re-pin the coasting residual by its own documented method (category 2)**

Follow the method the fixture's comment documents:
1. Add a temporary `console.log` of `residualSpeed`, and of `player.x` on the first tick the arc reaches the bottom wall band (the first tick where `player.y + DRIVE_CONFIG.carHeight / 2 >= 666 - 1`).
2. Run the test and record both values.
3. Rebuild the test's state with `ARENA_01.obstacles` emptied, the same way the 2026-09-11 note proved spikes take no part. Re-run and confirm `residualSpeed` is identical. If it is **not** identical, a spike now touches this trajectory: stop and report that, rather than re-pinning over a spike hit.
4. Restore the obstacles and remove the logs.
5. Set `APPROACH_X` to the traced x rounded to an integer, and change the assertion to `toBeCloseTo(<new residual>, 2)`.
6. Add a paragraph: "REPINNED again for the 2026-09-16 hull resize (72x48): the 48-unit-wide hull reaches the bottom wall earlier in the same arc, so the single wall contact happens at a different point (traced x = …) and the residual moved 8.1 -> …; re-verified spike-free by emptying `ARENA_01.obstacles` (identical value)."

- [ ] **Step 6: ram-bridge.test.ts, "caps a victim at ONE slam push per tick…"**

At 72 × 48, chargers `a` (−47, 0) and `c` (0, −39) overlap **each other**, so four contact hits
appear instead of two. Scale both offsets by 1.5x:

```ts
    const first = addPlayer(state, "a", { x: -70.5, y: 0, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 0, y: 0, angle: 0 });
    const second = addPlayer(state, "c", { x: 0, y: -58.5, angle: Math.PI / 2, vy: 300 });
```

`a` now spans x −106.5..−34.5 and `c` spans x −24..24, so the chargers are clear of each other while
each overlaps `b` by 1.5 u. Add a one-line comment saying so.

At ~313, change "margin against the hull's 32-unit height" to "48-unit height", then re-read that
comment and fix any figure that depends on it.

- [ ] **Step 7: Run the server sim tests, then commit**

Run: `cd packages/server && npx vitest run src/sim`
Expected: PASS.

```bash
git add packages/server/src/sim/tick.test.ts packages/server/src/sim/ram-bridge.test.ts
git commit -m "test(server): rescale tick and slam fixtures to the 72x48 hull

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Bot behaviour at the new hull

**REQUIRED SUB-SKILL:** `superpowers:systematic-debugging`. Every failure in this task gets a root
cause **before** any edit (BC17–BC19).

**Files (only as the root cause dictates):**
- Modify: `packages/server/src/config/bot-profiles.ts:784` (`BOT_BRAIN_VERSION`)
- Possibly modify: `packages/server/src/bot/brain/*.ts`, only for typed numbers that silently assumed the 48-unit hull (outcome b)
- Possibly modify tests: `packages/server/src/bot/brain/controller.test.ts`, `firing.test.ts`, `planner.test.ts`, `tiers.test.ts`, `packages/server/balance/match.test.ts`
- Possibly modify: `docs/bot-behavior.md:234`, only if the `firing.test.ts` cell count changes
- Modify (comments): `packages/server/src/bot/brain/planner.ts:967`, `planner.test.ts:500`, `solution.test.ts:316`

**Interfaces:**
- Consumes: the 72 × 48 hull. Shared must be built.
- Produces: `BOT_BRAIN_VERSION = "4.7.0"`.

- [ ] **Step 1: Bump the brain version**

```ts
export const BOT_BRAIN_VERSION = "4.7.0";
```

If a comment beside it keeps a changelog of bumps, add: `4.7.0 (2026-09-16): the car hull grew 48x32 -> 72x48; every hull-derived margin in perceive/move/plan/solution grew with it, with BOT_PROFILES unchanged.`

- [ ] **Step 2: Reproduce all six failures**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/server && npx vitest run src/bot balance/match.test.ts`

Expected, per the spec's BC17 list:
- controller off-axis: 0.69 vs < 0.2
- firing: `["mirage/medium","mirage/hard"]`
- planner R-P16: throttle 1 vs −1
- tiers P49: 18.7 s vs < 17.87
- tiers P50: hard 0.63, not > medium 0.86
- match seed 98: no winner

Record the actual values.

- [ ] **Step 3: Hunt for typed hull assumptions in the brain (outcome b)**

Run: `git grep -n -E "\b(16|24|29|32|48|58)\b" -- packages/server/src/bot/brain ':!*.test.ts'`

For every hit, decide whether the number means a hull dimension, half-extent or diagonal, or
something else such as a tick count, a percentage or a range. A number that means the hull is a bug:
replace it with the `DRIVE_CONFIG` expression it stands for. In your report, list every hit you ruled
out, with a one-phrase reason.

- [ ] **Step 4: Root-cause each failure, one at a time, cheapest first**

Work in this order: firing, planner, controller, tiers P50, tiers P49, match. For each, follow
systematic-debugging (hypothesis, instrument, confirm), then classify it as one of:

- **(a) Hull-relative scene.** A fixture places a car or target where a 72-unit car now overlaps, touches or reaches something it did not before. For example, `planner.test.ts` R-P16 plants the nose at x = 5 facing the wall, and `boundsPenalty`'s margin is now 72. Fix the scene so its stated premise holds again, and document why.
- **(b) Typed hull number in the brain.** Fix it as in Step 3.
- **(c) Measured band.** Re-measure with the **exact seeds the test's comment lists**: tiers P50 uses 17, 3, 7, 42, 99; P49 uses 17, 3, 7, 42, 99, 2026, 5. The fixture seed is set in `duel.fixture.ts`/`runDuel`, so vary it by the same mechanism the comment's measurement used. Re-pin only if the asserted relation (strictly monotonic ladder; hard's kill time inside twice the floor) holds on **every** listed seed, and add a dated line to the comment's measured table.

Three failures already have documented procedures:
- **`firing.test.ts` ("exactly ONE cell of nine").** The test says it **is allowed to fail on a roster/geometry change**. If the root cause confirms the hull moved the count, update the expected list **and** both prose claims the test names: `preferredRangeOf`'s doc comment in the brain, and "one chassis-by-tier cell of nine" in `docs/bot-behavior.md` (line ~234).
- **`planner.test.ts` R-P16.** There is precedent for re-pinning the named winner when physics changes (the 2026-09-07 note). Re-pin the winner only if the R-P16 subject still holds, meaning the two `sticky` assertions below it (a commit bonus cannot latch onto `clearlyWorse`) pass. Add a dated note in the same style.
- **`balance/match.test.ts`.** It documents a re-seeding procedure: sweep seeds 1–150 with the same `runMatch` call, and prefer a seed already present in an earlier known-good set named in the comment (79, 22, 98, 3 and the lists quoted there). Set the chosen seed, and add a dated paragraph in the same style listing the decisive seeds you found.

- [ ] **Step 5: STOP conditions (BC19)**

For the failure in question, commit nothing further, stop and report the measurements if any of these happen:
- a failure can only be resolved by changing `BOT_PROFILES`;
- the tier ladder does not hold on every listed seed;
- hard's kill time is outside twice the floor on any listed seed;
- the off-axis controller offset stays above 0.2, with no fixture or typed-number cause.

Do not loosen the bars.

- [ ] **Step 6: Comment sweep**

- `planner.ts:967` says "reachable car centres are `x ∈ [90, 1190]`, `y ∈ [70, 650]`, so a 48-unit margin", written against the 48 × 32 hull.
  - Recompute the reachable centre ranges for arena-01 with half-width 24 and half-length 36 (boundary x 74–1206, y 54–666). A centre is inset by the half-extent the car presents: use the half-diagonal 43.27 for a conservative band, or state which axis-aligned figure you used.
  - Change "48-unit margin" to "72-unit margin".
- `planner.test.ts:500`: change "the 48-unit margin" to "the 72-unit margin". Re-check that the fixture it describes still clears every rect edge by more than 72; if it does not, handle it as a Step 4 item.
- `solution.test.ts:316`: change "the target's hull is 48x32" to "72x48".

- [ ] **Step 7: Run the server suite, then commit**

Run: `cd packages/server && npx vitest run`
Expected: PASS. The exception is a failure you stopped on under Step 5; report that part instead of committing it.

```bash
git add packages/server docs/bot-behavior.md
git commit -m "fix(bot): keep the brain honest at the 72x48 hull; BOT_BRAIN_VERSION 4.7.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Client overlays and FX fixtures

**Files:**
- Modify: `packages/client/src/scenes/combat-visual.ts:2835-2842` (`LOCK_BRACKET_HALF`, `LOCK_BRACKET_ARM` and their comment); ~737 comment
- Modify: `packages/client/src/scenes/countdown-arrow.ts:64-72` (`ARROW_GAP_PX` and its comment)
- Modify: `packages/client/src/scenes/countdown-arrow.test.ts:66-75`
- Modify: `packages/client/src/scenes/ArenaScene.ts:270-275` (`HP_BAR_GEOMETRY.length`)
- Modify: `packages/client/src/fx/events.test.ts:110-128`
- Modify (comments only): `packages/client/src/fx/environment.ts:174`, `fx/occlusion.ts:48`, `scenes/car-lighting.ts:162`, `scenes/weapon-hud.ts:212`, `assets/sprite-fit.ts:24`, `assets/sprite-fit.test.ts:44`, `packages/client/CLAUDE.md:49`

**Interfaces:**
- Consumes: the 72 × 48 hull. Shared must be built.
- Produces: `LOCK_BRACKET_HALF = 51`, `LOCK_BRACKET_ARM = 16`, `ARROW_GAP_PX = 57`, HP bar `length: 66` (BC25).

- [ ] **Step 1: Make countdown-arrow.test.ts derive the hull, and watch it fail**

Replace the hardcoded half-diagonal:

```ts
    // Worst case is the hull's half-diagonal, whichever way the car is pointing. Read from DRIVE_CONFIG
    // so a chassis resize moves this assertion instead of silently leaving the arrow inside the car.
    const hullHalfDiagonal = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2;
```

Import `DRIVE_CONFIG` from `@motor-combat-moba/shared`.

Run: `npm run build -w @motor-combat-moba/shared && cd packages/client && npx vitest run src/scenes/countdown-arrow.test.ts src/scenes/combat-visual.test.ts src/fx/events.test.ts`

Expected: FAIL in three places:
- the countdown-arrow clearance, because the gap no longer clears 43.27;
- the lock bracket, 34 vs 43.27;
- both hull-skin tests in `events.test.ts`.

- [ ] **Step 2: Scale the overlay constants**

`combat-visual.ts`:

```ts
/**
 * Half the bracket's side, world units. Larger than a car hull's half-diagonal (43 units for the
 * 72 x 48 hull) so the bracket frames the car instead of being drawn across it. Scaled 34 -> 51 with
 * the 2026-09-16 hull resize, keeping its old proportion to the car.
 */
export const LOCK_BRACKET_HALF = 51;

/** How far each arm runs from its corner. Kept well under the side, so the corners never join. */
export const LOCK_BRACKET_ARM = 16;
```

`countdown-arrow.ts`: set `export const ARROW_GAP_PX = 57;` and rewrite its comment: "the worst case
is the 72 x 48 hull's half-diagonal, 43 units. At the bottom of the bob the apex is <57 minus
ARROW_BOB_AMPLITUDE_PX> units out, so the arrow never touches the car…". Compute that figure from the
real `ARROW_BOB_AMPLITUDE_PX` in the same file; the old comment's 33 came from 38 − 5.

`ArenaScene.ts` `HP_BAR_GEOMETRY`: set `length: 66,` and add this comment on that line: `// 44 -> 66 with the 2026-09-16 hull resize: the bar lies across the tail, which grew 32 -> 48.` Leave `offset` and `thickness` alone.

- [ ] **Step 3: Derive the hull in events.test.ts**

In "pulls an overshooting projectile's shotEnded back onto the hull it struck", update the comment:

```ts
    // Car "a" sits at (100, 200) facing +x, hull x (100 - carWidth/2)..(100 + carWidth/2). A dart
    // travelling +x observed at 150 — a quite ordinary one-tick overshoot — used to burst behind the car.
```

In that test, the expected event's `x` becomes `100 - DRIVE_CONFIG.carWidth / 2`. The same expected
`x` applies in "puts a damaged event on the skin the shot came through…".

Import `DRIVE_CONFIG` from `@motor-combat-moba/shared` if the file does not already. The dart at 150
is still past the car's +x face (136), so the overshoot premise holds.

- [ ] **Step 4: Run the three files**

Run: `cd packages/client && npx vitest run src/scenes/countdown-arrow.test.ts src/scenes/combat-visual.test.ts src/fx/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Comment sweep (no logic)**

- `fx/environment.ts:174`, `scenes/car-lighting.ts:162`, `packages/client/CLAUDE.md:49`: change "the hull is a 48x32 box" to "a 72x48 box".
- `fx/occlusion.ts:48` says "put the hole at roughly 107 x 93 units against a 48 x 32 hull".
  - Recompute the hole from `occlusionWidth`/`occlusionHeight` in that file (`carWidth + halo*2`, `carHeight + halo*2`), using the shipped `ENVIRONMENT_FX.occlusion.halo`.
  - Write the new figures, "against a 72 x 48 hull".
  - Read the surrounding sentence: if the old figures included a scale other than the halo, apply the same one.
- `scenes/combat-visual.ts:737`: change "a 48-unit" to "a 72-unit", and re-read the sentence for any figure that depends on it.
- `scenes/weapon-hud.ts:212`: change "not the 48x32 car hull" to "not the 72x48 car hull".
- `assets/sprite-fit.ts:24` and `assets/sprite-fit.test.ts:44` explain the rotation fit using the hull's 48 and 32. Rewrite them with 72 and 48 ("128 against the hull's 48 rather than against its 72"). If the test's **code** uses a literal 48/32 hull, leave it: it is a pure function under test with explicit inputs.

- [ ] **Step 6: Run the client suite, then commit**

Run: `cd packages/client && npx vitest run`
Expected: PASS.

```bash
git add packages/client
git commit -m "feat(client): scale lock bracket, countdown arrow and hp bar with the 72x48 hull

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Re-import all nine car sprites at 144 px

**REQUIRED SKILL:** read `.claude/skills/process-car-asset/SKILL.md` in full and follow its workflow
for each car. It is the source of truth for flags, blockers and warnings.

**Files:**
- Modify (binary): `packages/client/public/art/cars/{anvil,bastion,bullseye,caprico,cleaver,mirage,prowler,skorpios,taurus}.png`
- Modify (idempotent rewrite): `packages/client/public/art/manifest.json`
- Modify (prose): `.claude/skills/process-car-asset/SKILL.md:53,153`, `.claude/skills/process-car-asset/generation-prompt.md:12,34-35`, `packages/client/public/art/README.md:41,103`, `docs/asset-pipeline.md:48,156-161,177,273`, `scripts/import-weapon-icon.mjs:35`

**Interfaces:**
- Consumes: shared built with the 72 × 48 hull. The importer reads `DRIVE_CONFIG` from `packages/shared/dist`.
- Produces: nine sprites 144 px wide (BC20–BC24).

- [ ] **Step 1: Build shared and confirm the importer sees the new hull**

Run: `npm run build -w @motor-combat-moba/shared && node -e "import('./packages/shared/dist/index.js').then(m=>console.log(m.DRIVE_CONFIG.carWidth, m.DRIVE_CONFIG.carHeight))"`

Expected: `72 48`. If it prints `48 32`, the dist is stale; stop.

- [ ] **Step 2: Preflight all nine**

The source folder is `E:/Work/PROJECT DOCS/car racer/assets/cars/`, and each filename is the capitalised car id.

```bash
for pair in Anvil:anvil Bastion:bastion Bullseye:bullseye Caprico:caprico Cleaver:cleaver Mirage:mirage Prowler:prowler Skorpios:skorpios Taurus:taurus; do
  src="E:/Work/PROJECT DOCS/car racer/assets/cars/${pair%%:*}.png"; id="${pair##*:}"
  echo "=== $id"; node .claude/skills/process-car-asset/scripts/preflight.mjs "$src" "$id"
done
```

Record each car's JSON result: blockers, warnings, the output size (its long side must be 144) and
hull coverage. **Skip any car with a blocker** (BC21): leave its current PNG in place and report it.

- [ ] **Step 3: Import each car that passed preflight**

For each passing car, use only the flags its preflight recommends. SKILL.md explains them, and the
default is none:

```bash
node scripts/import-art.mjs "E:/Work/PROJECT DOCS/car racer/assets/cars/Mirage.png" mirage
```

Repeat for each passing car. From each run, record the importer's printed summary: source size,
trimmed art, the in-game line, hull coverage, greyscale and warnings.

- [ ] **Step 4: Verify dimensions and the art checks**

Run: `node -e "const fs=require('fs');for(const f of fs.readdirSync('packages/client/public/art/cars')){const b=fs.readFileSync('packages/client/public/art/cars/'+f);console.log(f,b.readUInt32BE(16),'x',b.readUInt32BE(20))}"`
Expected: every re-imported car is 144 wide.

Run: `npm run check:cars`
Expected: no blockers. Relay every warning.

Run: `git diff packages/client/public/art/manifest.json`
Expected: no diff, or only an idempotent reordering. Report any rows that changed in substance.

- [ ] **Step 5: Prose updates**

- `SKILL.md:53`: "how much of the 48x32 hull" becomes "how much of the 72x48 hull". Line 153: "legible at 48×32" becomes "legible at 72×48".
- `generation-prompt.md`:
  - line 12: "legible at 48x32 pixels" becomes "legible at 72x48 pixels";
  - line 34: "fits art to the 48×32 hull" becomes "72×48";
  - line 35: "**Legible at 48x32**" becomes "**Legible at 72x48**".
- `packages/client/public/art/README.md`:
  - line 41 is an example output line from an old import. Replace it with a real line from one car's Step 3 output, and keep the surrounding example consistent.
  - line 103: "inside the 48x32 hull" becomes "72x48".
- `docs/asset-pipeline.md`:
  - line 48: "48x32" becomes "72x48";
  - line 156: "inside the 48×32 hull" becomes "72×48";
  - line 161: "presents 128 along the hull's 48, not along its 32" becomes "along the hull's 72, not along its 48";
  - line 177: "Cars render at roughly 48×32 world units" becomes "72×48". Re-read that paragraph's size advice (the 128×128 working size) and state what a 144-px-wide sprite means for it; change the advice only if it is now false;
  - line 273: "48×32 hull" becomes "72×48".
- `scripts/import-weapon-icon.mjs:35`: "rather than the 48x32 car hull" becomes "72x48".

- [ ] **Step 6: Run the scripts suite, then commit**

Run: `npm run test:scripts`

Expected: PASS, except `manual-page.test.mjs`'s stamp check, which Task 9 fixes. Any `check-art`
failure here is a blocker: fix it or report it.

```bash
git add packages/client/public/art .claude/skills/process-car-asset docs/asset-pipeline.md scripts/import-weapon-icon.mjs
git commit -m "art(cars): re-import all nine chassis at 144px for the 72x48 hull

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Docs, the guide page, and full verification

**Files:**
- Modify: `docs/config-reference.md` (~436-437, ~584, ~586, ~597-601, ~631-632)
- Modify: `docs/turn-tuning.md` (~115-118, ~187)
- Modify: root `CLAUDE.md` (one new paragraph)
- Modify: `docs/superpowers/plans/2026-09-06-car-physics/EXECUTION.md` (one note)
- Regenerate: `packages/client/public/manual.html`, via `npm run build:manual`
- Possibly modify: any file the final sweep finds

**Interfaces:**
- Consumes: everything above.
- Produces: a green root `npm test` and a correct build.

- [ ] **Step 1: config-reference.md**

- `DRIVE_CONFIG` table: the `carWidth` row becomes `72` and the `carHeight` row becomes `48`.
- `RAM_CONFIG` table:
  - `spinScale` row: value `15`, with this appended to its description: "**Moved 10 → 15 on 2026-09-16** by derivation, not measurement: the hull resize to 72×48 grew the maximum lever arm 1.5x and `inertiaCoefficient` 2.25x, so 15 holds every ram's spin exactly where it was."
  - `inertiaCoefficient` row: `624 **[D]**`.
- Spin prose (~597–601):
  - "it is 10 now that it divides by `ramDefence`" becomes "it was 10 once it divided by `ramDefence`, and 15 since the 2026-09-16 hull resize";
  - "clamped at the 24 u hull half-length" becomes "36 u";
  - relabel any lever-arm table rows 4/12/24 to 6/18/36, as in Task 1.
- ~631–632: "(24 and 16 today)" becomes "(36 and 24 today)".

- [ ] **Step 2: turn-tuning.md prose**

- ~115 describes the current state: "now comfortably under one car length (48 u)" becomes "now well under one car length (72 u since the 2026-09-16 hull resize)". Re-read lines 115–120: "under a tenth of a car length" was measured against 48 u, and it is still true at 72 u (1.5/72), so keep it.
- ~187 is a dated history sentence about the 2026-09-06 pass. Keep "(48 u)", and add "(the hull was 48 u long until the 2026-09-16 resize to 72 u)".

Run `node --test scripts/turn-tuning-doc.test.mjs`. Expected: PASS.

- [ ] **Step 3: One new paragraph in root CLAUDE.md**

Insert this directly after the paragraph that begins "**The 2026-09-16 pass cut top speed a third time…**":

```markdown
**The 2026-09-16 hull resize made every car 1.5x bigger — for real, not just in the drawing.**
`DRIVE_CONFIG.carWidth`/`carHeight` went 48 × 32 → **72 × 48**; the arenas did not grow, so the field
is relatively more crowded. Every reader derives from the hull, so the logic edits were small, and
three of them are worth knowing: `RAM_CONFIG.spinScale` went 10 → **15** by derivation (a 1.5x lever
over a 2.25x `inertiaCoefficient`), which keeps every ram's spin exactly where it was — stage 5 of the
car-physics rework re-pitches from 15, not 10; both arenas' FFA spawn rows moved inward (arena-01
y 180/540, arena-02 y 187/543) to clear the spikes by a car diagonal; and the client's lock bracket,
countdown arrow and hp bar length scaled 1.5x with the car. Weapon balance was deliberately **not**
touched: a bigger target is easier to hit, so hit rates rose, and that is for the balance harness to
measure. `BOT_BRAIN_VERSION` went to 4.7.0, so balance reports across this change are not comparable.
All nine car sprites were re-imported at 144 px. See
[`docs/superpowers/specs/2026-09-16-bigger-cars-design.md`](docs/superpowers/specs/2026-09-16-bigger-cars-design.md).
```

If Task 6 reported a stop, or Task 8 skipped a car, add one sentence saying what remains open.

- [ ] **Step 4: Note in the car-physics EXECUTION.md**

Append this to `docs/superpowers/plans/2026-09-06-car-physics/EXECUTION.md`. Use whichever section it
already has for deferred findings or out-of-band changes; if it has none, add
`## Outside changes since the last stage` at the end.

```markdown
- **2026-09-16, bigger cars (not part of this rework):** the hull grew 48×32 → 72×48 and
  `RAM_CONFIG.spinScale` moved 10 → 15 to hold every ram's spin constant (1.5x lever / 2.25x
  inertia). Stage 5's re-pitch starts from 15. `globalScale` did not move — push never read the hull.
  See `docs/superpowers/specs/2026-09-16-bigger-cars-design.md` (BC6–BC9).
```

- [ ] **Step 5: Final sweep for stale hull figures**

Run:

```bash
git grep -n -I -E "48 ?[x×] ?32|32-unit|48-unit|24 u hull|hull half-length \(24|half-diagonal, 29|hull is 48|48 long" -- ':!docs/ideas' ':!docs/invariants' ':!docs/superpowers' ':!docs/playtest' ':!packages/client/public/manual.html' ':!packages/server/playtest'
```

Every remaining hit must be one of:
- a pure-geometry test with explicit arbitrary inputs, such as `shapes.test.ts`'s `w: 48, h: 32`, `maneuver-visual.test.ts`'s `hullOutlinePoints(…, 48, 32)`, `contact.test.ts`'s standalone hull, or `hits.test.ts`;
- a dated history sentence that says it is history;
- a genuine miss, which you fix.

List every remaining hit in the report with its classification.

- [ ] **Step 6: Regenerate the guide page**

Run: `npm run build:manual`
Then: `grep -o "a car is [0-9]* long" packages/client/public/manual.html`
Expected: `a car is 72 long`.

- [ ] **Step 7: Check that the playtest probes still compile (BC29)**

Run: `npx tsc -p packages/server/playtest/tsconfig.json --noEmit`

Expected: no errors. If it errors, fix only the compile break and list it in the report. Do not
change any probe expectation, threshold or report string.

- [ ] **Step 8: Full verification**

Run: `npm test` (root)
Expected: PASS across shared, server, client and scripts, including the manual stamp and the check-art blockers.

Run: `npm run build` (root)
Expected: success.

Run: `grep -o "carWidth: [0-9]*" packages/server/dist/index.js | head -1`
Expected: `carWidth: 72`.

- [ ] **Step 9: Commit**

Include any files that the Step 5 sweep or the Step 7 compile check touched.

```bash
git add docs/config-reference.md docs/turn-tuning.md CLAUDE.md docs/superpowers/plans/2026-09-06-car-physics/EXECUTION.md packages/client/public/manual.html
git commit -m "docs: record the 72x48 hull resize; regenerate the players' guide

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10 (controller, not a subagent): Visual check (BC34)

The orchestrating session does this step, because it has the browser pane.

- [ ] Start the dev server with `preview_start { name: "motor-combat-moba" }`. It is single-instance, so first check that nothing else holds ports 5173 or 2567.
- [ ] Open `http://localhost:5173/?dev=playground`, enable at least two seats, and turn on hitbox display if the panel offers it.
- [ ] Confirm three things:
  - cars draw at the new size with the re-imported art;
  - the hitbox outline matches the sprite's footprint;
  - two cars stop where they visibly touch.
- [ ] Take a screenshot and share it.
- [ ] Load `http://localhost:5173/manual.html` and confirm the new sprites and "a car is 72 long".
- [ ] The final summary must **loudly** flag (BC29–BC31):
  - the probes `geometry.ts`, `collision.ts`, `prediction.ts` (its FINDING threshold is `carWidth`), `ram.ts` (`vx - 48 - gap`), `weapons.ts` (`HULLS_TOUCH_AT = 48`, "hulls touch at 48") and `weapons2.ts`, recommending `npm run playtest`;
  - a recommendation to run `npm run ttk` and `npm run balance`, noting that reports from before this change are not comparable across `BOT_BRAIN_VERSION` 4.7.0;
  - the regenerated guide page and the nine re-imported sprites, pointing at `/manual.html`.
