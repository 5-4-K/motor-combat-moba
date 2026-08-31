# Weapon/Status Overhaul — Plan 3 of 3: Roster Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the nine weapon slots with the overhaul roster — `fireball`/`needler`/`skewer`/`bulwark` retired, `shockwave` redefined, `predator`/`thunderclap`/`roadblock`/`wildcharge` new — wire the player-visible pieces (charge outline, dash streak, guide, icons), and update every doc and script the roster touches.

**Architecture:** One atomic cutover of `WeaponId`/`WEAPON_TABLE`/`CAR_TABLE` (Tasks 1–4 land as a single commit — the id change breaks compilation across all three workspaces at once, so intermediate commits cannot be green), then separable commits for visuals, TTK, and docs. All mechanics already exist (Plans 1–2); this plan only authors rows and render/doc surfaces.

**Tech Stack:** TypeScript 5.5, vitest 2, Phaser 3 (client), Node scripts.

**Spec:** `docs/superpowers/specs/2026-09-01-weapon-status-overhaul-design.md` — the roster table and "The roster" notes. **Prerequisites: Plans 1 and 2 fully landed.**

## Global Constraints

- Same base rules as Plans 1–2 (shared `dist`, root `npm test`, commit trailer).
- ⚙ numbers below are the spec's first-pass values — author them exactly as written; tuning is the owner's follow-up, not the executor's.
- Playtest probes: compile fixes on the spot only; flag stale expectations loudly. `packages/server/playtest/README.md` names the probes.
- Never run `npm run playtest` or `npm run playtest:lan` unbidden — recommend them.
- Art: do NOT generate or import icons. Retired ids leave the manifest; new ids ship on procedural fallbacks; the stale `shockwave` icon is flagged, not fixed.

## The authored rows (single source for Tasks 1–4)

`CAR_TABLE` loadouts (ratings untouched):

```ts
  mirage:   { ...weapons: ["predator", "thunderclap", "afterburner"] },
  bullseye: { ...weapons: ["shockwave", "pepperbox", "lance"] },
  bastion:  { ...weapons: ["thumper", "roadblock", "wildcharge"] },
```

`WeaponId` union: remove `"fireball" | "needler" | "skewer" | "bulwark"`, add `"predator" | "thunderclap" | "roadblock" | "wildcharge"` (`"shockwave"` stays and is redefined).

The nine `WEAPON_TABLE` rows. Rows shown in full are new or rewritten; "as today plus…" rows are edits to the existing row. Every derived claim here is checked by tests in Task 1.

```ts
  /**
   * Bullseye's slot 1 — the id survives from the retired Mirage aura, the weapon does not (O16/O17).
   * Fireball's flight profile carrying needler's output: 22 per 600 ms is needler's old 37
   * sustained DPS, the skirmisher's clean pressure slot. 1.67 Hz sits 33% clear of the 1.25 Hz
   * aim-assist cliff.
   */
  shockwave: {
    id: "shockwave",
    kind: "projectile",
    name: "Shockwave",
    color: "#22579E", // needler's navy — Bullseye's palette
    unlocksAt: 1,
    damage: 22,
    damageFrequencyMs: 0,
    speed: 900,
    range: 900, // >= aimRangeUnits, required for usesAimAssist
    startUpMs: 0,
    cooldownMs: 600,
    recoveryMs: 0,
    usesAimAssist: true,
    aimRangeUnits: 400,
    hitbox: { shape: "circle", radius: 12 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
```

`pepperbox` — as today plus: `usesAimAssist: false` (delete `aimRangeUnits` — O9's four-way spray cannot be lock-steered), `muzzles: [0, 90, 180, 270]`, and `hitbox: { shape: "ellipse", radiusAlong: 9, radiusAcross: 3 }` (needler's dart silhouette, per the spec roster). Everything else — 45/dart, 800 u/s, 600 range, 1800 ms, recovery 200, 3-pellet 12° fan — stays. Update the row comment: 12 darts per press, 4 fans; per-target reality is one fan (135), same as today.

`lance` — as today plus: `usesAimAssist: false` (delete `aimRangeUnits`), `attached: true`, `lifetimeMs: 1500`, `holdsDuringFire: true`. Rewrite the comment: the T13 aim-assist argument is superseded (O10) — the beam now sweeps under manual steering while the car is held (windup 700 + growth 200 + linger 1500 ≈ 2.4 s committed), which is the new risk budget alongside `recoveryMs: 1000`.

```ts
  /**
   * Mirage's slot 1: the homing rocket (O11). Fired with a lock it tracks the frozen target for
   * 1.2 s at 120 deg/s — a ~286-unit turning circle Mirage and Bullseye can corner inside and
   * Bastion mostly cannot, which fits the triangle. Fired bare it is a slow straight shot.
   * 600 u/s is the second-slowest aimed shot in the table: reactable at range. 0.5 Hz, 60% clear
   * of the aim cliff. ⚙ speed/turn/duration are the spec's first-pass numbers.
   */
  predator: {
    id: "predator",
    kind: "projectile",
    name: "Predator",
    color: "#D63A14", // fireball's ember — Mirage's palette
    unlocksAt: 1,
    damage: 50,
    damageFrequencyMs: 0,
    speed: 600,
    range: 900,
    startUpMs: 0,
    cooldownMs: 2000,
    recoveryMs: 0,
    usesAimAssist: true,
    aimRangeUnits: 400,
    hitbox: { shape: "capsule", radiusAlong: 14, radiusAcross: 6 },
    pierce: 0,
    homing: { turnRateDegPerSec: 120, durationMs: 1200 },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
    applies: [{ statusId: "corroded", target: "opponents", durationMs: 2000 }],
  },
```

```ts
  /**
   * Mirage's slot 2: the dash (O12/O13). `speed` is the dash speed and `aimRangeUnits` the dash
   * distance — 400 units in ~8 ticks, snapped toward the lock when one is held. First enemy hull
   * contact deals `damage` + 1 s stun and ends the dash; a wall ends it cold. The car's own hull
   * is the hit volume; no instance spawns. 0.2 Hz, 84% clear of the aim cliff.
   */
  thunderclap: {
    id: "thunderclap",
    kind: "maneuver",
    name: "Thunderclap",
    color: "#7A1D1D", // the retired aura's maroon — Mirage's palette
    unlocksAt: 1,
    damage: 100,
    damageFrequencyMs: 0,
    speed: 1600, // ⚙ dash speed
    range: 400,  // = the dash distance, for the guide's reach figure
    startUpMs: 0,
    cooldownMs: 5000, // ⚙
    recoveryMs: 200,
    usesAimAssist: true,
    aimRangeUnits: 400,
    maneuver: { type: "dash" },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    applies: [{ statusId: "stunned", target: "opponents", durationMs: 1000 }],
  },
```

`afterburner` — as today plus `muzzles: [0, 180]` (two mirrored attached cones per press, each its own instance and damage clock). Comment note: total per-press ceiling doubles only against a target somehow held in both cones; per-cone numbers unchanged.

`thumper` — as today plus: `bounce: { lifetimeMs: 2900 }` (just under the 3000 ms cooldown, so a second thumper can never coexist — Plan 1's guard enforces it), `range: 1305` (450 u/s × 2.9 s — the honest reach figure now that expiry is clock-based and `range` is otherwise unread), and `applies: [{ statusId: "spiked", target: "opponents", durationMs: 3000 }]` replacing the stun. Rewrite the comment: the stun's whole history paragraph is superseded — hard CC now enters Bastion's kit through `roadblock`, and thumper is the bouncing pressure shot that spikes (0.6 slow, 3 s).

```ts
  /**
   * Bastion's slot 2: a wall that stops what it touches (O15). The bar is 120 wide by 12 thick,
   * travels along its short axis, pierces everything (5 = max players minus the shooter), and
   * stuns each car it crosses for 1 s. Aim assist is deliberately OFF: a 120-unit face aims
   * itself, and skewer's old "help the slowest chassis" argument is answered by width here. ⚙
   * speed/range/cooldown are first-pass.
   */
  roadblock: {
    id: "roadblock",
    kind: "projectile",
    name: "Roadblock",
    color: "#C89A14", // skewer's gold — Bastion's palette
    unlocksAt: 1,
    damage: 100,
    damageFrequencyMs: 0,
    speed: 600,
    range: 500,
    startUpMs: 0,
    cooldownMs: 6000,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "bar", radiusAlong: 6, radiusAcross: 60 },
    pierce: 5,
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
    applies: [{ statusId: "stunned", target: "opponents", durationMs: 1000 }],
  },
```

```ts
  /**
   * Bastion's slot 3: the one-hit ultimate (O2). One press opens a 10 s window: Fortified rides
   * it (self, 10 s — ended early WITH the window), the car wears the charge outline, and the
   * first enemy hull contact hard-slams for a fixed impulse plus 250 damage (230 on Bastion's
   * 0.92x), ending the window. `isUnInterruptable` (O8): a stun stops the car dead but the state
   * holds — the roster's only exemption. `slamsStunned` (O3): the one slam that lands on a
   * stunned victim, safe because it cannot chain. `speed`/`range` are 0: a charge dashes nowhere.
   */
  wildcharge: {
    id: "wildcharge",
    kind: "maneuver",
    name: "Wild Charge",
    color: "#D9A814", // bulwark's amber — Bastion's palette
    unlocksAt: 1,
    damage: 250,
    damageFrequencyMs: 0,
    speed: 0,
    range: 0,
    startUpMs: 0,
    cooldownMs: 20000, // ⚙ must exceed the 10 s window (guarded)
    recoveryMs: 200,
    usesAimAssist: false,
    isUnInterruptable: true,
    maneuver: { type: "charge", durationMs: 10000, slamsStunned: true },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    applies: [{ statusId: "fortified", target: "self", durationMs: 10000 }],
  },
```

Delete the `fireball`, `needler`, `skewer`, `bulwark` rows outright (O17) — their comment history lives in git.

---

### Task 1: Shared cutover — table, ids, loadouts, config tests

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts` (`WeaponId`)
- Modify: `packages/shared/src/config/weapon-config.ts` (rows above)
- Modify: `packages/shared/src/config/car-config.ts` (loadouts above)
- Modify: `packages/shared/src/config/weapon-config.test.ts`, `weapon-ticks.test.ts`, `weapon-slots.test.ts`

**Interfaces:**
- Produces: the nine-row table exactly as authored above; every config test green against it.

- [ ] **Step 1: Make the config edits** (rows, union, loadouts, exactly as in "The authored rows").

- [ ] **Step 2: Rewrite the config tests.** In `weapon-config.test.ts`:
  - Delete the fireball digit-pin block (its migration is over) and replace with a spec-conformance pin for the new roster:

```ts
it("pins the overhaul roster's load-bearing numbers (spec 2026-09-01)", () => {
  expect(WEAPON_TABLE.shockwave).toMatchObject({ damage: 22, cooldownMs: 600, speed: 900, range: 900 });
  expect(WEAPON_TABLE.predator.homing).toEqual({ turnRateDegPerSec: 120, durationMs: 1200 });
  expect(WEAPON_TABLE.thunderclap).toMatchObject({ damage: 100, speed: 1600, aimRangeUnits: 400 });
  expect(WEAPON_TABLE.roadblock).toMatchObject({ damage: 100, pierce: 5 });
  expect(WEAPON_TABLE.roadblock.hitbox).toEqual({ shape: "bar", radiusAlong: 6, radiusAcross: 60 });
  expect(WEAPON_TABLE.wildcharge.maneuver).toEqual({ type: "charge", durationMs: 10000, slamsStunned: true });
  expect(WEAPON_TABLE.wildcharge.isUnInterruptable).toBe(true);
  expect(WEAPON_TABLE.thumper.bounce).toEqual({ lifetimeMs: 2900 });
  expect(WEAPON_TABLE.pepperbox.muzzles).toEqual([0, 90, 180, 270]);
  expect(WEAPON_TABLE.afterburner.muzzles).toEqual([0, 180]);
  expect(WEAPON_TABLE.lance).toMatchObject({ attached: true, lifetimeMs: 1500, holdsDuringFire: true, usesAimAssist: false });
});
```

  - Add `it("keeps maneuver rows single-volley", ...)` asserting `volleys === 1` for `kind === "maneuver"` rows.
  - The Plan-1 guards (aim-range pairing, cliff, muzzles⇒no-assist, homing⇒assist, bounce<cooldown, charge<cooldown, bar aspect) now bite on real rows — they must pass as-is. If the cliff guard's forbidden band trips any row, the row is mis-authored; check against: shockwave 1.67 Hz, predator 0.5 Hz, thumper 0.33 Hz, thunderclap 0.2 Hz — all ≥33% clear of 1.25 Hz.
  - Fix any test referencing a retired id (grep `fireball|needler|skewer|bulwark` in the three config test files): the reference row for `usesAimAssist: false` prose is now `roadblock`; ticks tests re-pin against new rows (`shockwave` cooldown 18 ticks, `thumper` bounceLifetime 87, `wildcharge` maneuverDuration 300, `predator` homingDuration 36).

- [ ] **Step 3: Run**

Run: `npm run test -w @motor-combat-moba/shared -- src/config`
Expected: config suites PASS; sim suites still broken (Task 2). Do not commit.

---

### Task 2: Shared sim test sweep

**Files:**
- Modify: `packages/shared/src/sim/**` test files (grep `fireball|needler|skewer|bulwark|shockwave` under `packages/shared/src/sim`)

Rules for the sweep — do these, in order, per file:

1. **Like-for-like borrow swap:** tests that borrowed `fireball`'s row for a generic projectile/beam fixture switch to `"shockwave"` — deliberately re-authored with fireball's exact flight numbers (900/900, circle r12), so distance/offset arithmetic (`50.5`, muzzle sums, flight ticks) survives unchanged. Damage expectations move 50 → 22 where the test asserted hp.
2. **Aim-assist fixtures** using `fireball` keep working via `shockwave` (assist on, 400).
3. **`skewer` pierce tests:** `hits.test.ts` hand-sets `pierceLeft`, untouched; any test deriving from `skewer.pierce` re-derives from `roadblock.pierce` (5).
4. **The `shockwave` 3-wave tests in `fire.test.ts` and `combat.test.ts`:** DELETE, with a comment where each block was: multi-wave volleys, `onWave: "final"`, and the aura (`disc`/`origin: "center"`) are dormant machinery as of the 2026-09-01 overhaul (spec: "The roster" notes) — code and generic unit tests stay, the real-row drivers have no row to drive. `fire.test.ts`'s "two lockouts" block (lance) stands unchanged.
5. **`needler` stock test in `combat.test.ts`** ("drives needler… through a real tick"): DELETE with the same dormancy comment — `StockDef` keeps its hand-built `fire.test.ts` coverage; no shipped row banks stocks.
6. **`bulwark`/`afterburner` beam fixtures:** `bulwark` fixtures (detached ticking beam) re-anchor on a synthetic def spread from `afterburner` with `attached: false` via the Plan-1 `def` seam where the test calls `spawnInstances`/`stepInstance` directly; where a test needs a real detached row id end-to-end (Task 13 of Plan 1 used bulwark), use `lance` (now attached — so use the def-seam synthetic instead and note it).
7. **Status-application tests** keyed to old appliers: thumper now applies `spiked` 3 s (90 ticks) — re-target the stun-application assertions onto `roadblock`/`thunderclap` paths where they run through `runCombat` with real rows (roadblock's projectile lands in a normal combat tick; that is the easiest end-to-end stun).
8. **New real-row integration tests** — add these three, now that rows exist (they retire Plan 1's "helpers only" coverage notes):

```ts
it("a thunderclap press starts a dash through the real fire pipeline", () => {
  // Mirage, fireMask bit 1 (slot 2), lock on a target 300 units off-axis; run one combat tick.
  // Assert: maneuver === DASH, maneuverSpeed === 1600, maneuverTicksLeft === 8,
  // maneuverWeaponId === "thunderclap", stock spent, angle snapped toward the target.
});

it("a wildcharge press opens the charge window and self-applies fortified", () => {
  // Bastion, fireMask bit 2 (slot 3). Assert CHARGE, ticksLeft 300, fortified in statuses
  // with sourceSessionId === the bastion's own id (the O2 early-expiry key).
});

it("a stun does not end wildcharge — the roster's isUnInterruptable exemption (O8)", () => {
  // Charge first, then a statusRequest stun on a later tick. Assert maneuver stays CHARGE
  // while the pending/attached sweeps still ran for interruptible weapons.
});
```

Flesh each out with the file's existing world/player builders; the assertions named are the contract.

- [ ] **Step: Run** `npm run test -w @motor-combat-moba/shared` — Expected: PASS, `golden.test.ts` and `drive.test.ts` untouched. Do not commit yet.

---

### Task 3: Server sweep

**Files:**
- Modify: `packages/server/src` + `packages/server/playtest` (grep the four retired ids)

- [ ] Fix compile references: bridge tests using retired ids swap per Task 2's rules (`fireball`→`shockwave` like-for-like; the contact-bridge tests from Plan 1 used `"thumper"` as a stand-in maneuver weapon — now use the real ids: `"thunderclap"` for dash entries, `"wildcharge"` for charge entries, and update the priced-damage expectation if it asserted thumper's 60). Playtest probes naming retired ids: minimal edits to compile and reach an equivalent code path (e.g. a reach probe listing weapon ids per chassis reads the new loadouts); every behavioural expectation left alone and listed in the summary as stale.
- [ ] Run: `npm run build -w @motor-combat-moba/shared && npm run test -w @motor-combat-moba/server` — Expected: PASS. Do not commit yet.

---

### Task 4: Client sweep, manifest, and the guide — the atomic commit closes here

**Files:**
- Modify: `packages/client/src/scenes/combat-visual.ts` (+ its tests, `projectile-marks.test.ts`)
- Modify: the art manifest (find it via `docs/asset-pipeline.md`; the importers name the path) — remove rows for `fireball`, `needler`, `skewer`, `bulwark` icons; delete those four icon PNGs
- Modify: `scripts/build-cars-and-weapons.mjs` + `scripts/cars-and-weapons-copy.mjs`
- Regenerate: `packages/client/public/manual.html`

- [ ] **Step 1: Visual style tables.** Retired ids leave `WEAPON_GLOW_STYLES` (`fireball`), `WEAPON_PROJECTILE_STYLES` (`needler`, `skewer`), `WEAPON_BEAM_STYLES` (`bulwark`). `pepperbox` moves OUT of `WEAPON_GLOW_STYLES` (its hitbox is an ellipse now — round-glow tables cannot own it; the flat weapon-color fill is the correct fallback). `thumper` keeps its projectile style; `afterburner`/`lance` keep their beam styles (verify lance's still renders sensibly attached — it draws from extent/cross-section, which did not change). New ids get NO style entries: the hitbox-faithful flat fill is the shipped look until the owner arts them. Update `projectile-marks.test.ts` and any `combat-visual.test.ts` fixtures per Task 2's swap rules (the "claiming beam" fixture over fireball's numbers → shockwave's identical numbers).
- [ ] **Step 2: Manifest.** Remove the four retired icon rows and delete their PNGs under `packages/client/public/art/weapon-icons/`. Leave `shockwave.png` in place (it depicts the retired aura — flagged in the summary, owner's call). Run `npm run check:art` — blockers must be zero; note any new warnings verbatim in the summary.
- [ ] **Step 3: Guide.** Teach `scripts/build-cars-and-weapons.mjs` the `maneuver` kind (it derives per-weapon stats — give maneuvers: reach = `range` (400 for the dash, "—" for a 0), DPS = `damage * 1000 / cooldownMs`, and a "kind" label of "Dash" / "Charge" matching however the script labels projectile/beam). Rewrite `cars-and-weapons-copy.mjs` prose for changed/new weapons, in the file's existing voice; draft copy to adapt:
  - **shockwave:** "A fast, straight bolt and Bullseye's bread and butter. Nothing fancy — it arrives quickly, often, and exactly where the assist points it."
  - **pepperbox:** "One press, twelve darts: a three-dart fan from the nose, tail, and both flanks. The panic button that punishes anyone who closes in — or the drive-by that clips everyone around you."
  - **lance:** "Seven hundred milliseconds standing still, then a beam you steer for a second and a half. The car is rooted until it ends — the wheel still works, and sweeping the line across a fight is the whole skill."
  - **predator:** "A rocket that remembers who it was fired at. With a lock it chases for 1.2 seconds and leaves the target corroded; sharp cornering inside its turning circle beats it."
  - **thunderclap:** "A 400-unit lunge at the lock. The first car you touch takes the hit and stops — stunned for a second — and so do you, right on top of them."
  - **afterburner:** "The same flame, now pouring from both ends. Overheats anyone who stays in either cone — chasing you or blocking your escape."
  - **thumper:** "The slug no longer stops on walls — it bounces until it finds someone, and what it finds, it spikes: 40% slower for three seconds."
  - **roadblock:** "A wall on the move. Everything it touches takes the hit and stops dead for a second — line them up and the whole line stops."
  - **wildcharge:** "Ten seconds of armor and intent. The first enemy you touch is slammed off their line — into a wall, stunned — takes 250, and the charge is spent. Stuns can't cancel it."
- [ ] **Step 4: Rebuild and verify the atomic cutover**

Run: `npm run build -w @motor-combat-moba/shared && npm run build:manual && npm test && npm run typecheck`
Expected: all green, root-wide.

- [ ] **Step 5: The atomic commit (Tasks 1–4)**

```bash
git add packages/shared/src packages/server packages/client scripts/build-cars-and-weapons.mjs scripts/cars-and-weapons-copy.mjs
git commit -m "feat(roster)!: the overhaul roster — four ids retired, shockwave redefined, predator/thunderclap/roadblock/wildcharge shipped"
```

---

### Task 5: Charge outline and dash streak

**Files:**
- Modify: `packages/client/src/scenes/` — the car-drawing path in `ArenaScene` (or its extracted helper module; follow the codebase rule that derivations live in testable modules and `ArenaScene` keeps only the Phaser calls)
- Create/modify a small pure helper + test, e.g. `packages/client/src/scenes/maneuver-visual.ts` + `.test.ts`

**Interfaces:**
- Produces: `maneuverOutline(maneuver: number): { color: number; width: number } | null` — non-null only for `ManeuverKind.CHARGE`, color `0xd9a814` (wildcharge's own hex), width 3; `dashGhostAlphas(): readonly number[]` (e.g. `[0.28, 0.16, 0.07]`) for three ghost hull outlines trailed behind a `DASH` car along `-maneuverAngle` at fixed spacings (e.g. 18/36/54 units).

- [ ] **Step 1: Failing tests** for the pure helper: outline null for NONE/DASH/HOLD, styled for CHARGE; ghost alphas descending and in (0, 1).
- [ ] **Step 2: Implement** the helper, then wire `ArenaScene`: every drawn car (local, remote, spectated) reads its `PlayerState.maneuver` — the outline is a stroked rect around the hull footprint above the sprite, redrawn/rotated with the car per frame; the dash streak draws the ghost outlines in the car's own paint at the helper's alphas. Both are render-only; spectators see them because the field is networked (spec S6).
- [ ] **Step 3: Verify** `npm run test -w @motor-combat-moba/client` and `npm run typecheck`; then a quick smoke via the browser preview if a dev server is already sanctioned in-session — otherwise leave visual confirmation to the owner (say so in the summary).
- [ ] **Step 4: Commit**

```bash
git add packages/client/src
git commit -m "feat(client): wild-charge outline and thunderclap dash streak from networked maneuver state"
```

---

### Task 6: TTK script

**Files:**
- Modify: `scripts/ttk.mjs` (+ its test if `scripts/*.test.mjs` covers it)

- [ ] Read the script's header contract first. Make it run against the new table: maneuver-kind rows contribute `damage` per `cooldownMs` like any other row for `thunderclap`; **exclude `wildcharge`** from sustained rotations (a 20 s one-hit ultimate distorts a sustained-DPS matrix) and say so in the header. Extend the header's stated blind spots: homing accuracy, dash landing rates, slam damage windows, and bounce paths are unmodeled — the matrix now UNDERSTATES Mirage and Bastion (spec: Tests and guardrails).
- [ ] Run `npm run ttk` once to prove it executes; paste its matrix into the execution summary for the owner (that is reporting, not tuning).
- [ ] Commit: `git add scripts && git commit -m "chore(ttk): overhaul roster support — maneuver rows, stated blind spots"`

---

### Task 7: Docs sweep

**Files:**
- Modify: `CLAUDE.md` (root — the Statuses/aura/chassis-kit paragraphs are roster-specific and now false: shockwave is not Mirage's aura, needler's magazine history note, "stunned is thumper's" → Roadblock/Thunderclap, etc.)
- Modify: `docs/combat-model.md` (kit table, "Who applies what" table, aura section → dormant-machinery note, coverage lists that name retired rows)
- Modify: `docs/config-reference.md` (weapon table section)
- Modify: `packages/shared/CLAUDE.md`, `packages/client/CLAUDE.md` (roster references)
- Check: `docs/glossary.md`, `docs/asset-pipeline.md` for retired-id mentions

- [ ] Grep all of `docs/` and every `CLAUDE.md` for the four retired ids and `shockwave` — **excluding `docs/ideas/` and `docs/invariants/`** (`--exclude-dir=ideas --exclude-dir=invariants`, per the project rule) — and update each hit to the shipped truth, verifying every number against the code. The "Who applies what" table becomes: overheated←afterburner 1.5 s, corroded←predator 2 s, stunned←roadblock 1 s / thunderclap 1 s / slam-wall 0.5 s, spiked←thumper 3 s, fortified←wildcharge self 10 s (ends with the charge), overhauled+armored←nothing yet.
- [ ] `npm test` (root) — the doc-fingerprint suites must agree.
- [ ] Commit: `git add docs CLAUDE.md packages/*/CLAUDE.md && git commit -m "docs: roster cutover — kits, appliers, dormant aura machinery"`

---

### Task 8: Final verification and the execution summary

- [ ] Run, in order: `npm run build`, `npm test`, `npm run typecheck`, `npm run check:art`. All green; `git status` clean.
- [ ] The summary MUST carry, loudly:
  - **Playtest (project rule):** nearly everything `packages/server/playtest/` measures moved — name each probe whose expectations are now stale (the W7 stun-duty probe's subject no longer stuns; reach probes' numbers; ram probes vs slams) and each compile fix made. Recommend `npm run playtest` and `npm run playtest:lan` before the next play session.
  - **Art (project rule, said loudly):** the guide's cover/kit/card imagery changed with zero test failing — four icons removed, four new weapons on procedural glyphs, and `shockwave.png` still depicts the retired aura. Point at `http://localhost:5173/manual.html` and recommend the owner look at it; recommend re-importing a shockwave icon (and note the icon-color-vs-`WEAPON_TABLE.color` pairing rule for any new imports).
  - The TTK matrix output, with its blind-spot caveat.
  - Balance ⚙ numbers shipped as speced, untuned, with the spec's list of which knobs they are.
  - Dormant machinery record: stocks, multi-wave volleys, `onWave`, aura (`disc`/center-origin) — kept, unit-tested, carried by no row.

---

## Self-review (performed while writing)

- **Spec coverage:** every roster-table row above matches the spec's table cell-for-cell (damage, speed, cd, assist, applies, ⚙ marks); O2/O3/O8 land via wildcharge's fields; O9 pepperbox muzzles; O10 lance hold; O11 predator; O12 thunderclap; O15 roadblock pierce; O16 shockwave numbers; O17 retirements; S6 visuals (Task 5), guide (Task 4), TTK/probes/docs (Tasks 6–8). Icon work is explicitly out (spec: owner's call).
- **Guard audit:** every authored row was checked against Plan 1's guards — assist⇔aimRange pairing ✓, cliff clearances (33/60/73/84%) ✓, bounce 2900<3000 ✓, charge 10000<20000 ✓, bar 60≥6 ✓, muzzles⇒no-assist (pepperbox, afterburner already false) ✓, homing⇒assist (predator ✓), maneuver rows single-volley ✓, capsule 14≥6 ✓.
- **Type consistency:** row literals use only fields Plans 1–2 defined (`maneuver`, `bounce`, `homing`, `muzzles`, `holdsDuringFire`, `isUnInterruptable`, `aimRangeUnits`, `bar`); colors reuse retired hexes so the player-color-clearance test keeps holding.
- **Placeholders:** none — sweep tasks name their grep, their swap rule, and their expected end state; prose drafts are supplied.
