# Chassis Rename and Weapon Redistribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the three chassis to Bullseye / Mirage / Bastion, give them per-car acceleration and turn rate, restat the roster, and redistribute and retune all nine weapons so the three types form an explicit rock-paper-scissors.

**Architecture:** Nine tasks in strict order, each one independently green. The mechanism changes land *before* the balance changes that need them, so any red suite names its own cause: Tasks 1–2 and 5–6 are behaviour-preserving refactors that must leave every existing test expectation untouched, and Tasks 3–4 and 7 are where numbers are allowed to move. `stepDrive` stops reading `CAR_TABLE` and takes a resolved `ChassisDrive`, which is what lets the three frozen drive suites survive a per-car drive model.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared` → `server` → `client`), Vitest for the three package suites, `node --test` for `scripts/*.test.mjs`.

**Spec:** [`docs/superpowers/specs/2026-08-30-chassis-rename-and-weapon-redistribution-design.md`](../specs/2026-08-30-chassis-rename-and-weapon-redistribution-design.md) (decisions T1–T22)

---

## Global Constraints

- **Build with root `npm run build`, never `npm run build --workspaces`.** The server's tsup step inlines shared's `dist`; the root script enforces shared → server → client ordering.
- **After editing shared, rebuild it** before anything downstream reads it. `npm test` at the root already does this first.
- **Verify with root `npm test`.** Per-workspace runs silently skip suites.
- `TICK_RATE_HZ` is 30 and lives once in shared. `DEFAULT_PATCH_RATE_HZ` is 20. Neither moves.
- **No magic numbers in logic** — all balance from `packages/shared/src/config/`.
- **Enum uint8 values are explicit and stable; never renumber.**
- **If `stepSim` reads it, it is a networked schema field.** This plan adds **no schema field**: `finalWave` is frozen at spawn on the sim-only `WeaponInstance`, exactly like `damage` and `ownerTeam`.
- Max 6 players. `{x, y, angle}` is canonical world state.
- **`docs/ideas/` and `docs/invariants/` are off limits.** Never read, cite, grep, or edit them.
- **Branch is `development/main`.** Never `master`.
- **Do not run `npm run playtest`.** Task 8 fixes the probes; running them is the user's call.
- Ratings are integers 0–100 with 50 average. Weapon `color` values do **not** change in this plan.

### The rating table (T5) — copy verbatim

| | `speed` | `accel` | `handling` | `attack` | `hp` | `mass` |
|---|---|---|---|---|---|---|
| **bullseye** | 52 | 45 | 28 | 55 | 30 | 30 |
| **mirage** | 88 | 85 | 50 | 63 | 48 | 48 |
| **bastion** | 30 | 20 | 82 | 42 | 82 | 90 |

### The drive scales (T7) — copy verbatim

```
baseTurnRate: 2.4    turnRatePerRating: 0.036   stopTurnRatio: 0.5
baseAccel:  420      accelPerRating:    7.2     reverseAccelFactor: 1.41
```

---

## File Structure

**Shared — config**
- `config/types.ts` — `CarId` union; `CarDef` gains `accel`, `handling`.
- `config/car-config.ts` — `CAR_TABLE`, `DEFAULT_CAR_ID`, `turnRateOf`, `accelOf`, `reverseAccelOf`, `ChassisDrive`, `CHASSIS_DRIVE`, `driveOf`.
- `config/drive-config.ts` — flat constants replaced by base + per-rating pairs.
- `config/weapon-types.ts` — `VolleyDef` / `PelletDef` split; `StatusApplication.onWave`.
- `config/weapon-config.ts` — nine rows retuned, one renamed.
- `config/weapon-ticks.ts` — `volleyInterval` for every kind.

**Shared — sim**
- `sim/drive.ts` — takes `ChassisDrive` instead of `CarId`.
- `sim/step.ts` — resolves `driveOf(ctx.carId)`.
- `sim/weapons/fire.ts` — beam volleys; `ShotOrder.finalVolley`.
- `sim/weapons/instances.ts` — `WeaponInstance.finalWave`; `pellets` for fanning.
- `sim/combat.ts` — the two status helpers gate on `onWave`.

**Client** — `assets/`, `scenes/car-visual.ts`, `scenes/combat-visual.ts`, `ui/reveal-view.ts`, `ui/results-view.ts`, `ui/car-select-view.ts` (the stat card is player-facing and reads the drive constants directly), `public/art/manifest.json`.

**Server** — `playtest/*.ts` (7 files), `src/sim/*`, `src/rooms/*` test fixtures.

**Scripts** — `build-cars-and-weapons.mjs` (two new stat rows), `import-art.test.mjs`, `check-*.mjs`.

**Docs & skills** — root + 3 package `CLAUDE.md`, 5 docs, 2 skills.

---

## Task 1: Rename the three chassis and `splinter` → `needler`

Pure rename. **No number in any table changes, and no test expectation may be edited** — every suite must pass after mechanical substitution alone. If a suite goes red, the rename was wrong, not the test.

**Files:**
- Modify: `packages/shared/src/config/types.ts` (`CarId` union)
- Modify: `packages/shared/src/config/car-config.ts` (`CAR_TABLE` keys, `name`, `DEFAULT_CAR_ID`)
- Modify: `packages/shared/src/config/weapon-types.ts` (`WeaponId` union)
- Modify: `packages/shared/src/config/weapon-config.ts` (`splinter` key, `id`, `name`)
- Modify: `packages/client/public/art/manifest.json` (4 keys + 4 file paths)
- Rename: `packages/client/public/art/cars/{rectangle,oval,hexagon}.png` → `{mirage,bullseye,bastion}.png`
- Rename: `packages/client/public/art/weapon-icons/splinter.png` → `needler.png`
- Modify: every `.ts` / `.mjs` file referencing the old ids (see Step 2's inventory)

**Interfaces:**
- Consumes: nothing.
- Produces: `CarId = "bullseye" | "mirage" | "bastion"`; `WeaponId` with `"needler"` in place of `"splinter"`; `DEFAULT_CAR_ID = "mirage"`.

The mapping, in full:

| old | new |
|---|---|
| `rectangle` / `"Rectangle"` | `mirage` / `"Mirage"` |
| `oval` / `"Oval"` | `bullseye` / `"Bullseye"` |
| `hexagon` / `"Hexagon"` | `bastion` / `"Bastion"` |
| `splinter` / `"Splinter"` | `needler` / `"Needler"` |

- [ ] **Step 1: Read this warning before touching anything**

**A blind find-and-replace will corrupt this codebase.** `rectangle`, `oval` and `hexagon` appear as ordinary English and as geometry names that must NOT change:

- `hexagonPoints(...)` in `packages/client/src/scenes/car-visual.ts` — a geometry helper that draws an actual hexagon. **Keep the name.**
- `"an opaque rectangle is not a lesser result"` — `.claude/skills/process-car-asset/` prose about image alpha.
- `"a full rectangle reads as a selection marquee"` — `combat-visual.ts` comment about a UI box.
- `pointInAabb` / `aabbCorners` doc comments describing rectangles as shapes.

Change an occurrence only when it names **the car**. When a comment names the car *as a shape* ("the oval or the hexagon"), rewrite the sentence to name the car instead.

- [ ] **Step 2: Take the inventory**

```bash
grep -rn "rectangle\|oval\|hexagon\|splinter" --include=*.ts --include=*.mjs --include=*.json packages scripts .claude | grep -v node_modules | grep -v "/dist/" > /tmp/rename-inventory.txt
```

Read every line and classify it: car/weapon reference (change) or English/geometry (keep). Expect roughly 45 files.

- [ ] **Step 3: Rename the union and the tables first**

`packages/shared/src/config/types.ts`:

```ts
export type CarId = "bullseye" | "mirage" | "bastion";
```

`packages/shared/src/config/car-config.ts` — keys, ids and names only; **every rating stays exactly as it is today**:

```ts
export const CAR_TABLE = {
  mirage: { id: "mirage", name: "Mirage", speed: 80, attack: 30, hp: 40, mass: 35, weapons: ["fireball", "pepperbox", "afterburner"] },
  bullseye: { id: "bullseye", name: "Bullseye", speed: 50, attack: 70, hp: 30, mass: 45, weapons: ["needler", "skewer", "lance"] },
  bastion: { id: "bastion", name: "Bastion", speed: 30, attack: 50, hp: 70, mass: 85, weapons: ["thumper", "shockwave", "bulwark"] },
} as const satisfies Record<CarId, CarDef>;

export const DEFAULT_CAR_ID: CarId = "mirage";
```

`packages/shared/src/config/weapon-types.ts` — replace `| "splinter"` with `| "needler"`.

`packages/shared/src/config/weapon-config.ts` — rename the `splinter` key, its `id`, and its `name` to `"Needler"`. **No stat changes.**

- [ ] **Step 4: Let the compiler drive the rest**

```bash
npm run build -w @motor-combat-moba/shared
```

Fix each error. Repeat until clean, then:

```bash
npm run typecheck
```

Typed references are now exhaustively handled. Untyped ones are not — Step 5.

- [ ] **Step 5: Fix the untyped wiring the compiler cannot see**

`packages/client/public/art/manifest.json` — rename four keys and four `file` paths:

```json
{
  "sprites": {
    "car.mirage":   { "file": "cars/mirage.png" },
    "car.bastion":  { "file": "cars/bastion.png" },
    "car.bullseye": { "file": "cars/bullseye.png" },
    "weapon-icon.fireball":    { "file": "weapon-icons/fireball.png",    "colorMode": "none", "scale": "fit" },
    "weapon-icon.pepperbox":   { "file": "weapon-icons/pepperbox.png",   "colorMode": "none", "scale": "fit" },
    "weapon-icon.afterburner": { "file": "weapon-icons/afterburner.png", "colorMode": "none", "scale": "fit" },
    "weapon-icon.needler":     { "file": "weapon-icons/needler.png",     "colorMode": "none", "scale": "fit" },
    "weapon-icon.skewer":      { "file": "weapon-icons/skewer.png",      "colorMode": "none", "scale": "fit" },
    "weapon-icon.lance":       { "file": "weapon-icons/lance.png",       "colorMode": "none", "scale": "fit" },
    "weapon-icon.thumper":     { "file": "weapon-icons/thumper.png",     "colorMode": "none", "scale": "fit" },
    "weapon-icon.shockwave":   { "file": "weapon-icons/shockwave.png",   "colorMode": "none", "scale": "fit" },
    "weapon-icon.bulwark":     { "file": "weapon-icons/bulwark.png",     "colorMode": "none", "scale": "fit" }
  }
}
```

Then the art files (`git mv` so history follows):

```bash
git mv packages/client/public/art/cars/rectangle.png packages/client/public/art/cars/mirage.png
git mv packages/client/public/art/cars/oval.png packages/client/public/art/cars/bullseye.png
git mv packages/client/public/art/cars/hexagon.png packages/client/public/art/cars/bastion.png
git mv packages/client/public/art/weapon-icons/splinter.png packages/client/public/art/weapon-icons/needler.png
```

Then `packages/client/src/scenes/car-visual.ts` — the shape map keys move, the values do **not**, and the comment must now say the shape is a rendering fallback rather than the car's identity:

```ts
/**
 * The procedural silhouette each chassis falls back to when its sprite is missing.
 *
 * The shape is no longer what the car *is* — these were once named `rectangle`, `oval` and
 * `hexagon` — so this map is a rendering detail, not an identity. Each chassis keeps the outline it
 * shipped with so a missing texture still reads as the right car.
 */
const CAR_SHAPES = {
  mirage: "rect",
  bullseye: "ellipse",
  bastion: "hex",
} as const;
```

And `FALLBACK_CAR` in both `packages/client/src/ui/reveal-view.ts` and `packages/client/src/ui/results-view.ts`:

```ts
const FALLBACK_CAR = "mirage";
```

- [ ] **Step 6: Run the full suite — zero expectation edits allowed**

```bash
npm test
```

Expected: **PASS**. Every test file's *identifiers* changed; no test's *expected value* did. If a numeric expectation fails, you changed something you should not have — revert that edit rather than updating the number.

- [ ] **Step 7: Verify the art wiring**

```bash
npm run check:art
```

Expected: no blockers. Warnings about `lance` and `bulwark` icon colour are pre-existing and expected.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename chassis to bullseye/mirage/bastion and splinter to needler

Pure rename: ids, display names, art files and manifest keys. No rating,
weapon stat, or test expectation changed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Decouple `stepDrive` from the roster

Behaviour-preserving. `stepDrive` stops taking a `CarId` and takes a resolved `ChassisDrive`. **No number changes; no existing test expectation may be edited.**

**Files:**
- Modify: `packages/shared/src/config/car-config.ts` (add `ChassisDrive`, `CHASSIS_DRIVE`, `driveOf`)
- Modify: `packages/shared/src/sim/drive.ts` (signature + 4 internal helpers)
- Modify: `packages/shared/src/sim/step.ts:60`
- Modify: `packages/shared/src/index.ts` (export the new symbols)
- Test: `packages/shared/src/sim/golden.test.ts`, `drive.test.ts`, `status/channels.test.ts`
- Test: `packages/shared/src/config/config.test.ts` (new `driveOf` coverage)

**Interfaces:**
- Consumes: `CarId` from Task 1.
- Produces:
  ```ts
  export interface ChassisDrive {
    maxSpeed: number;
    reverseMaxSpeed: number;
    accel: number;
    reverseAccel: number;
    turnRate: number;
    turnRateAtStop: number;
  }
  export const CHASSIS_DRIVE: Readonly<Record<CarId, ChassisDrive>>;
  export function driveOf(id: CarId): ChassisDrive;
  export function stepDrive(
    body: SimBody, input: InputMessage, dt: number,
    chassis: ChassisDrive, mods: Readonly<Modifiers>,
  ): SimBody;
  ```

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/config/config.test.ts`, importing `driveOf` and `CHASSIS_DRIVE` from `./car-config.js`:

```ts
describe("driveOf", () => {
  it("resolves every car's drive numbers from the tables", () => {
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const d = driveOf(id);
      expect(d.maxSpeed).toBe(forwardMaxSpeedOf(id));
      expect(d.reverseMaxSpeed).toBe(reverseMaxSpeedOf(id));
      expect(d.accel).toBeGreaterThan(0);
      expect(d.reverseAccel).toBeGreaterThan(0);
      expect(d.turnRate).toBeGreaterThan(0);
      expect(d.turnRateAtStop).toBeGreaterThan(0);
    }
  });

  it("returns the same frozen object every call, so the tick allocates nothing", () => {
    expect(driveOf("mirage")).toBe(driveOf("mirage"));
    expect(Object.isFrozen(driveOf("mirage"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/config/config.test.ts -t "driveOf" --root packages/shared
```

Expected: FAIL — `driveOf` is not exported.

- [ ] **Step 3: Add `ChassisDrive`, `CHASSIS_DRIVE` and `driveOf`**

Append to `packages/shared/src/config/car-config.ts` (import `reverseMaxSpeedOf` is already local):

```ts
/**
 * Everything `stepDrive` needs to move one chassis for one tick, resolved from the roster and the
 * drive scales.
 *
 * The sim receives this instead of a `CarId` on purpose. `stepDrive` used to read `CAR_TABLE`
 * itself, which welded the drive integration to the roster: retuning a car's rating moved numbers
 * inside `golden.test.ts`, whose whole job is proving the integration has NOT changed. With the
 * chassis passed in, that suite pins the equation against a fixed set of constants and stays honest
 * through every future balance edit.
 */
export interface ChassisDrive {
  maxSpeed: number;
  reverseMaxSpeed: number;
  accel: number;
  reverseAccel: number;
  turnRate: number;
  turnRateAtStop: number;
}

/**
 * Resolved once at module load and frozen, mirroring `WEAPON_TICKS`. `stepSim` runs this lookup for
 * every player every tick on both halves of the lockstep, so it must not allocate.
 */
export const CHASSIS_DRIVE: Readonly<Record<CarId, ChassisDrive>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(CAR_TABLE) as CarId[]).map((id) => [
      id,
      Object.freeze({
        maxSpeed: forwardMaxSpeedOf(id),
        reverseMaxSpeed: reverseMaxSpeedOf(id),
        accel: DRIVE_CONFIG.accel,
        reverseAccel: DRIVE_CONFIG.reverseAccel,
        turnRate: DRIVE_CONFIG.turnRate,
        turnRateAtStop: DRIVE_CONFIG.turnRateAtStop,
      }),
    ]),
  ) as Record<CarId, ChassisDrive>,
);

export function driveOf(id: CarId): ChassisDrive {
  return CHASSIS_DRIVE[id];
}
```

Export `ChassisDrive`, `CHASSIS_DRIVE` and `driveOf` from `packages/shared/src/index.ts` alongside the existing `car-config` exports.

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run src/config/config.test.ts -t "driveOf" --root packages/shared
```

Expected: PASS.

- [ ] **Step 5: Change `stepDrive`'s signature**

In `packages/shared/src/sim/drive.ts`, replace the `carId: CarId` parameter with `chassis: ChassisDrive` in `stepDrive`, `nextSpeed`, `accelerateForward`, `brakeOrReverse` and `reverseFurther`, and swap the five lookups:

| was | becomes |
|---|---|
| `DRIVE_CONFIG.turnRate` (line 31) | `chassis.turnRate` |
| `DRIVE_CONFIG.turnRateAtStop` (line 31) | `chassis.turnRateAtStop` |
| `DRIVE_CONFIG.accel` (in `accelerateForward`) | `chassis.accel` |
| `DRIVE_CONFIG.reverseAccel` (in `reverseFurther`) | `chassis.reverseAccel` |
| `forwardMaxSpeedOf(carId)` | `chassis.maxSpeed` |
| `reverseMaxSpeedOf(carId)` | `chassis.reverseMaxSpeed` |

Drop the now-unused `CarId`, `forwardMaxSpeedOf` and `reverseMaxSpeedOf` imports. `DRIVE_CONFIG` is still needed for `brakeDecel`, `drag`, `stopEpsilon` and `reverseHoldTicks`.

Add to `stepDrive`'s doc comment:

```
 * `chassis` is this car's resolved drive numbers (`driveOf`). The sim is handed them rather than
 * looking them up, so the integration below has no knowledge of the roster at all.
```

- [ ] **Step 6: Update the one production call site**

`packages/shared/src/sim/step.ts:60`:

```ts
const driven = stepDrive(body, input, dt, driveOf(ctx.carId), ctx.modifiers);
```

Import `driveOf` from `../config/car-config.js`. `StepContext.carId` stays exactly as it is.

- [ ] **Step 7: Give the three frozen suites a fixture**

In **each** of `golden.test.ts`, `drive.test.ts` and `status/channels.test.ts`, replace the `CAR_ID` / `CAR` constant with a frozen fixture and pass it to every `stepDrive` call:

```ts
/**
 * The drive numbers this suite was recorded against — the chassis that shipped as `rectangle` on
 * 2026-08-29, before per-car acceleration and turn rate existed.
 *
 * Frozen here rather than read from `CAR_TABLE` deliberately: these expectations pin the SHAPE of
 * the integration, not the roster's balance. A car's ratings must be free to move without any
 * number below moving with them.
 */
const GOLDEN_CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 540,
  reverseMaxSpeed: 351,
  accel: 780,
  reverseAccel: 1100,
  turnRate: 4.2,
  turnRateAtStop: 2.1,
});
```

Import `type ChassisDrive` from `../config/car-config.js` (`./car-config.js` path adjusted per file).

**Some assertions read a drive constant instead of a literal, and those must be re-pointed at the fixture.** This is a *source substitution*, not an expectation edit — `GOLDEN_CHASSIS` holds the identical value, so the assertion's meaning is unchanged. The exact sites:

| file | line | was | becomes |
|---|---|---|---|
| `drive.test.ts` | 81 | `DRIVE_CONFIG.reverseAccel * DT` | `GOLDEN_CHASSIS.reverseAccel * DT` |
| `drive.test.ts` | 177 | `DRIVE_CONFIG.turnRate` > `DRIVE_CONFIG.turnRateAtStop` | `GOLDEN_CHASSIS.turnRate` > `GOLDEN_CHASSIS.turnRateAtStop` |
| `drive.test.ts` | 264 | `DRIVE_CONFIG.turnRateAtStop * DT` | `GOLDEN_CHASSIS.turnRateAtStop * DT` |
| `drive.test.ts` | 268 | `DRIVE_CONFIG.turnRate * DT` | `GOLDEN_CHASSIS.turnRate * DT` |
| `drive.test.ts` | 389 | `DRIVE_CONFIG.turnRate * DT` | `GOLDEN_CHASSIS.turnRate * DT` |
| `status/channels.test.ts` | 84 | `DRIVE_CONFIG.accel * 0.5 * DT` | `GOLDEN_CHASSIS.accel * 0.5 * DT` |

`DRIVE_CONFIG` is still imported in both files for `brakeDecel`, `drag` and `stopEpsilon`. Do this in Task 2, while the values are still identical — after Task 3 deletes those four constants, the same edit would be indistinguishable from a re-record.

In `golden.test.ts` also rewrite the header's closing line — the "do not re-record" rule now has teeth it did not have before:

```
 * These numbers are pinned against `GOLDEN_CHASSIS`, a frozen fixture, not against a car in
 * `CAR_TABLE`. Retuning the roster therefore cannot move them, and a future balance edit has no
 * excuse to. If one of these moves, the integration changed — do not re-record them.
```

**Do not edit a single expected value in any of the three files.**

- [ ] **Step 8: Run the suite**

```bash
npm test
```

Expected: **PASS**, with every original expectation intact.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: stepDrive takes a resolved ChassisDrive instead of a CarId

The sim no longer reads CAR_TABLE. golden/drive/channels pin the drive
integration against a frozen fixture, so roster balance can move without
touching a single recorded expectation. No behaviour change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Add the `accel` and `handling` ratings

Adds the mechanism only. Ratings are authored at **50 for every car**, so `accelOf` and `turnRateOf` reproduce today's constants exactly and **no behaviour changes**. Task 4 does the restat.

**Files:**
- Modify: `packages/shared/src/config/types.ts` (`CarDef`)
- Modify: `packages/shared/src/config/car-config.ts` (ratings, `turnRateOf`, `accelOf`, `reverseAccelOf`, `CHASSIS_DRIVE`)
- Modify: `packages/shared/src/config/drive-config.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/config/config.test.ts`

**Interfaces:**
- Consumes: `ChassisDrive`, `driveOf`, `CHASSIS_DRIVE` from Task 2.
- Produces: `CarDef.accel`, `CarDef.handling`; `turnRateOf(id)`, `turnRateAtStopOf(id)`, `accelOf(id)`, `reverseAccelOf(id)`.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/config/config.test.ts`:

```ts
describe("per-car drive ratings", () => {
  it("anchors both scales so rating 50 reproduces the constants that shipped globally", () => {
    // The pivot in T7. `turnRateOf` and `accelOf` are authored so an exactly-average chassis
    // drives like the pre-2026-08-30 game did, which is what keeps "rating 50 is average" a
    // reading aid rather than a slogan. A scale edit that moves the pivot fails here.
    // `toBeCloseTo`, not `toBe`: 2.4 + 50 * 0.036 is 4.199999999999999 in IEEE-754. The anchor is
    // the design intent, not a bit pattern, and no decimal scale reproduces 4.2 exactly.
    const { baseTurnRate, turnRatePerRating, baseAccel, accelPerRating } = DRIVE_CONFIG;
    expect(baseTurnRate + 50 * turnRatePerRating).toBeCloseTo(4.2, 9);
    expect(baseAccel + 50 * accelPerRating).toBeCloseTo(780, 9);
  });

  it("keeps the stopped turn rate at half the moving one, as it shipped", () => {
    expect(DRIVE_CONFIG.stopTurnRatio).toBe(0.5);
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      expect(turnRateAtStopOf(id)).toBeCloseTo(turnRateOf(id) * 0.5, 9);
    }
  });

  it("feeds the derived rates into every chassis's ChassisDrive", () => {
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const d = driveOf(id);
      expect(d.turnRate).toBeCloseTo(turnRateOf(id), 9);
      expect(d.turnRateAtStop).toBeCloseTo(turnRateAtStopOf(id), 9);
      expect(d.accel).toBeCloseTo(accelOf(id), 9);
      expect(d.reverseAccel).toBeCloseTo(reverseAccelOf(id), 9);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/config/config.test.ts -t "per-car drive ratings" --root packages/shared
```

Expected: FAIL — `turnRateOf` is not exported and `DRIVE_CONFIG.baseTurnRate` is undefined.

- [ ] **Step 3: Reshape `DRIVE_CONFIG`**

In `packages/shared/src/config/drive-config.ts`, delete `accel`, `turnRate`, `turnRateAtStop` and `reverseAccel`, and add:

```ts
  /**
   * Turn rate is `baseTurnRate + handling * turnRatePerRating`, resolved per car by `turnRateOf`.
   *
   * Anchored so rating 50 yields exactly 4.2 — the single global turn rate this game shipped with —
   * so the roster moves around a fixed pivot and "an average chassis corners like the old game" stays
   * true. `config.test.ts` pins that anchor.
   */
  baseTurnRate: 2.4,
  turnRatePerRating: 0.036,
  /** Steering at rest, as a fraction of the moving rate. Preserves the shipped 2.1 / 4.2. */
  stopTurnRatio: 0.5,
  /**
   * Engine push is `baseAccel + accel * accelPerRating`, resolved per car by `accelOf`. Anchored the
   * same way `baseTurnRate` is: rating 50 yields exactly 780.
   */
  baseAccel: 420,
  accelPerRating: 7.2,
  /**
   * Reverse push as a fraction of forward. At rating 50 this gives 1099.8 against the 1100 that
   * shipped — a deliberate 0.02% rounding, below anything a driver can feel, taken because the exact
   * ratio (1100/780) is not a number anyone should have to read in a config file.
   */
  reverseAccelFactor: 1.41,
```

Rewrite the coupling doc-comment at the top of the file: turn radius (`speed / turnRate`) and time to top speed (`maxSpeed / accel`) are now **per-car**, so both must be reasoned about per chassis rather than quoted for "the fastest car".

- [ ] **Step 4: Add the two ratings and the four derivations**

`packages/shared/src/config/types.ts` — add to `CarDef`:

```ts
  /**
   * Engine push, 0-100. Scaled to units/s^2 by `accelOf`. Independent of `speed`: this roster's
   * accel ordering happens to match its speed ordering, but the axis exists so a future chassis can
   * be fast-topped and sluggish off the line, or the reverse.
   */
  accel: number;
  /**
   * Cornering, 0-100. Scaled to radians/s by `turnRateOf`. Note this is turn RATE, not turn radius:
   * radius is `speed / turnRate`, so a slow car with middling handling still corners tightly.
   */
  handling: number;
```

`packages/shared/src/config/car-config.ts` — every car gets `accel: 50, handling: 50` for now (Task 4 restats them), then add:

```ts
export function turnRateOf(id: CarId): number {
  return DRIVE_CONFIG.baseTurnRate + CAR_TABLE[id].handling * DRIVE_CONFIG.turnRatePerRating;
}

export function turnRateAtStopOf(id: CarId): number {
  return turnRateOf(id) * DRIVE_CONFIG.stopTurnRatio;
}

export function accelOf(id: CarId): number {
  return DRIVE_CONFIG.baseAccel + CAR_TABLE[id].accel * DRIVE_CONFIG.accelPerRating;
}

export function reverseAccelOf(id: CarId): number {
  return accelOf(id) * DRIVE_CONFIG.reverseAccelFactor;
}
```

Then point `CHASSIS_DRIVE` at them:

```ts
        accel: accelOf(id),
        reverseAccel: reverseAccelOf(id),
        turnRate: turnRateOf(id),
        turnRateAtStop: turnRateAtStopOf(id),
```

Export the four functions from `packages/shared/src/index.ts`.

- [ ] **Step 5: Fix the deleted constants' remaining consumers**

Deleting `accel`, `reverseAccel`, `turnRate` and `turnRateAtStop` from `DRIVE_CONFIG` breaks three call sites outside `drive.ts`. Task 2 already handled the two frozen test files; these are the rest.

**(a) The car select screen — player-facing, and the one that matters.**
`packages/client/src/ui/car-select-view.ts:78` renders a **Turn rate** row from the global constant. It is now per-car, and the two new ratings deserve rows of their own. Replace the `DRIVE_CONFIG.turnRate` row with:

```ts
    { label: "Acceleration", value: `${trim(accelOf(id))} u/s²` },
    { label: "Turn rate", value: `${trim(turnRateOf(id))} rad/s` },
    { label: "Turn radius", value: `${trim(forwardMaxSpeedOf(id) / turnRateOf(id))} u` },
```

Import `accelOf` and `turnRateOf` from `@motor-combat-moba/shared`. **Turn radius earns its row**: turn rate alone misleads here — the chassis with the lowest rate does not have the widest arc, and a player comparing cards needs the number they will actually feel. Update `car-select-view.test.ts` for the three new rows; its existing assertions about top speed, hull and mass are unaffected.

**(b) `packages/server/src/sim/tick.test.ts:86` and `:99`** assert against `DRIVE_CONFIG.accel * DT`. Re-point them at the chassis the fixture actually drives:

```ts
expect(player.speed).toBeCloseTo(driveOf(FIXTURE_CAR_ID).accel * DT, 6);
```

using whichever car id that test already sets up.

**(c) `packages/shared/src/config/config.test.ts:136-137`** asserts `reverseAccel > 0` and `reverseAccel >= accel`. Both constants are gone; the property they were protecting — reverse push is at least as strong as forward — now lives on the factor:

```ts
    expect(DRIVE_CONFIG.reverseAccelFactor).toBeGreaterThanOrEqual(1);
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      expect(reverseAccelOf(id)).toBeGreaterThanOrEqual(accelOf(id));
    }
```

- [ ] **Step 6: Run the tests**

```bash
npm test
```

Expected: **PASS**, with no existing expectation edited. Every car is at rating 50, so `accelOf` returns 780 and `turnRateOf` returns 4.2 (to within a float ulp) for all three — the same numbers `DRIVE_CONFIG` held directly.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add accel and handling ratings with per-rating drive scales

Mechanism only. Every car is authored at rating 50, so both scales
reproduce the shipped global constants exactly and no behaviour changes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Restat the roster

The first task where numbers move. Every failure here should be an expectation that legitimately needs recomputing — **except in `golden.test.ts`, `drive.test.ts` and `status/channels.test.ts`, which must stay untouched** because Task 2 insulated them.

**Files:**
- Modify: `packages/shared/src/config/car-config.ts` (`CAR_TABLE` ratings)
- Test: `packages/shared/src/config/config.test.ts`, `ram-config.test.ts`, and any suite asserting a derived car number

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: the T5 ratings.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/config/config.test.ts`. It already imports `CAR_TABLE`, `hpOf`, `forwardMaxSpeedOf` and `damageFor`; **add `massOf`, `accelOf`, `turnRateOf` and `reverseMaxSpeedOf`** to the `./car-config.js` import.

```ts
describe("the three types (T5/T6)", () => {
  it("derives the roster's drive profile from its ratings", () => {
    expect(forwardMaxSpeedOf("bullseye")).toBe(414);
    expect(forwardMaxSpeedOf("mirage")).toBe(576);
    expect(forwardMaxSpeedOf("bastion")).toBe(315);

    expect(accelOf("bullseye")).toBeCloseTo(744, 9);
    expect(accelOf("mirage")).toBeCloseTo(1032, 9);
    expect(accelOf("bastion")).toBeCloseTo(564, 9);

    expect(turnRateOf("bullseye")).toBeCloseTo(3.408, 9);
    expect(turnRateOf("mirage")).toBeCloseTo(4.2, 9);
    expect(turnRateOf("bastion")).toBeCloseTo(5.352, 9);

    expect(hpOf("bullseye")).toBe(300);
    expect(hpOf("mirage")).toBe(480);
    expect(hpOf("bastion")).toBe(820);
  });

  it("gives Bastion the tightest turn radius despite being the slowest", () => {
    // T6. Radius is speed / turnRate, so turn RATE and turn RADIUS order the roster differently:
    // Bullseye has the lowest rate but not the widest arc, because Mirage is far faster. Bastion
    // turning inside every other chassis is the mechanical reason "3 beats 2" holds.
    const radius = (id: CarId) => forwardMaxSpeedOf(id) / turnRateOf(id);
    expect(radius("bastion")).toBeLessThan(radius("bullseye"));
    expect(radius("bullseye")).toBeLessThan(radius("mirage"));
    expect(radius("bastion")).toBeCloseTo(58.9, 1);
  });

  it("orders the three types on every axis the design names", () => {
    expect(forwardMaxSpeedOf("mirage")).toBeGreaterThan(forwardMaxSpeedOf("bullseye"));
    expect(forwardMaxSpeedOf("bullseye")).toBeGreaterThan(forwardMaxSpeedOf("bastion"));
    expect(accelOf("mirage")).toBeGreaterThan(accelOf("bullseye"));
    expect(accelOf("bullseye")).toBeGreaterThan(accelOf("bastion"));
    expect(turnRateOf("bastion")).toBeGreaterThan(turnRateOf("mirage"));
    expect(turnRateOf("mirage")).toBeGreaterThan(turnRateOf("bullseye"));
    expect(hpOf("bastion")).toBeGreaterThan(hpOf("mirage"));
    expect(hpOf("mirage")).toBeGreaterThan(hpOf("bullseye"));
    expect(massOf("bastion")).toBeGreaterThan(massOf("mirage"));
    expect(massOf("mirage")).toBeGreaterThan(massOf("bullseye"));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/config/config.test.ts -t "the three types" --root packages/shared
```

Expected: FAIL — the ratings are still the old ones.

- [ ] **Step 3: Write the ratings**

`packages/shared/src/config/car-config.ts` — the loadouts still hold Task 1's assignments; Task 7 redistributes them:

```ts
export const CAR_TABLE = {
  mirage:   { id: "mirage",   name: "Mirage",   speed: 88, accel: 85, handling: 50, attack: 63, hp: 48, mass: 48, weapons: ["fireball", "pepperbox", "afterburner"] },
  bullseye: { id: "bullseye", name: "Bullseye", speed: 52, accel: 45, handling: 28, attack: 55, hp: 30, mass: 30, weapons: ["needler", "skewer", "lance"] },
  bastion:  { id: "bastion",  name: "Bastion",  speed: 30, accel: 20, handling: 82, attack: 42, hp: 82, mass: 90, weapons: ["thumper", "shockwave", "bulwark"] },
} as const satisfies Record<CarId, CarDef>;
```

Rewrite the table's doc comment to describe the three types (T1) and to state that `handling` is turn rate rather than turn radius.

- [ ] **Step 4: Recompute the expectations that legitimately moved**

In `packages/shared/src/config/config.test.ts`:

- `derives actual HP via hpPerRating` → `bullseye` 300, `mirage` 480, `bastion` 820.
- `keeps every top speed exactly where it was before the ratings widened` — **delete this test.** It pinned a 2026-08-28 migration ("the 10x rating change is cancelled by speedPerRating 45 → 4.5") whose numbers this design deliberately replaces. The new `derives the roster's drive profile` test above supersedes it.
- `kills an average chassis with the baseline weapon in 5 seconds` — leave as-is. It reads `attackBaseline` and `fireball.damage`, neither of which Task 4 touches. **Task 7 changes fireball's cooldown and must revisit it there.**
- `pins the roster's TTK spread, and with it damagePerAttack` — the two cells named `rectangle`/`oval` no longer exist as those ratings. Replace the whole test body with direct damage assertions, which pin `damagePerAttack` more legibly than a TTK ratio:

```ts
  it("pins damagePerAttack through off-baseline chassis", () => {
    // At `attackBaseline` the scale is identically 1, so no baseline assertion can see
    // `damagePerAttack` move. These three cells are all off-baseline in both directions.
    expect(damageFor(63, 50)).toBe(57); // mirage 1.13x
    expect(damageFor(55, 45)).toBe(47); // bullseye 1.05x
    expect(damageFor(42, 60)).toBe(55); // bastion 0.92x
  });
```

- `lets a spectator's free-look camera outrun the fastest car` — leave as-is; it is a ranged assertion and 1050 > 576 still holds.

In `packages/shared/src/config/ram-config.test.ts`:

- Lines 80–82 pin `massOf` at 350 / 450 / 850. The new values are **`bullseye` 300, `mirage` 480, `bastion` 900**.
- Lines 86–87 assert the mass ordering. It is now `bastion` > `mirage` > `bullseye` — note this **reverses** the old `oval` > `rectangle` pairing, because the chassis that was `oval` (now `bullseye`) drops from 45 to the roster's lowest mass.
- Anything pinning `RAM_REFERENCE` moves with the roster's fastest car: 540 → 576 u/s, so the reference rises 6.7% (T8). Recompute rather than loosening the assertion.

In `packages/client/src/ui/car-select-view.test.ts` and `packages/client/src/scenes/combat-visual.test.ts`, any hull-HP or top-speed figure quoted as a literal moves to the T6 table.

Then run the whole suite and recompute anything else that fails **only** where the failure is a genuinely moved derived number:

```bash
npm test
```

- [ ] **Step 5: Confirm the three frozen suites never moved**

```bash
git diff --stat packages/shared/src/sim/golden.test.ts packages/shared/src/sim/drive.test.ts packages/shared/src/sim/status/channels.test.ts
```

Expected: **empty output.** If any of the three shows a diff, Task 2's insulation failed — stop and fix that rather than editing an expectation.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: restat the roster into the three types

Bullseye 52/45/28/55/30/30, Mirage 88/85/50/63/48/48,
Bastion 30/20/82/42/82/90. RAM_REFERENCE rises 6.7% as a derived
consequence of Mirage's higher top speed (T8).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Beams gain volleys

Behaviour-preserving. `VolleyDef` splits so beams can carry `volleys`, and every beam authors `volleys: 1` — so nothing fires differently.

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts`
- Modify: `packages/shared/src/config/weapon-config.ts` (all nine rows' volley/pellet blocks)
- Modify: `packages/shared/src/config/weapon-ticks.ts`
- Modify: `packages/shared/src/sim/weapons/fire.ts` (`beginFire`)
- Modify: `packages/shared/src/sim/weapons/instances.ts` (`spawnInstances`)
- Test: `packages/shared/src/config/weapon-config.test.ts`, `weapon-ticks.test.ts`, `sim/weapons/fire.test.ts`, `instances.test.ts`

**Interfaces:**
- Consumes: `WeaponId` from Task 1.
- Produces:
  ```ts
  export interface VolleyDef { volleys: number; volleyIntervalMs: number }
  export interface PelletDef { pelletsPerVolley: number; spreadAngleDeg: number }
  // WeaponBase.volley: VolleyDef  (every weapon)
  // ProjectileWeaponDef.pellets: PelletDef  (projectiles only)
  ```

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/sim/weapons/fire.test.ts` (follow the file's existing helper style for building a `FireState`):

```ts
it("schedules one order per volley for a BEAM, not a single shot", () => {
  // Beams were hardcoded to one volley. A multi-wave beam is the whole point of the split.
  const def = WEAPON_TABLE.shockwave;
  if (def.kind !== "beam") throw new Error("shockwave must be a beam");
  expect(def.volley.volleys).toBeGreaterThanOrEqual(1);

  const state = beginFire(stateWith("shockwave"), 0b1, 0);
  expect(state.pending?.shotsLeft).toBe(def.volley.volleys);
});
```

And to `packages/shared/src/config/weapon-ticks.test.ts`:

```ts
it("converts volleyInterval for beams as well as projectiles", () => {
  for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
    const def = WEAPON_TABLE[id];
    expect(weaponTicksOf(id).volleyInterval).toBe(msToTicks(def.volley.volleyIntervalMs));
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/sim/weapons/fire.test.ts src/config/weapon-ticks.test.ts --root packages/shared
```

Expected: FAIL — `def.volley` does not exist on a beam.

- [ ] **Step 3: Split the type**

In `packages/shared/src/config/weapon-types.ts`, replace the existing `VolleyDef` with:

```ts
/**
 * One press fires `volleys` sequential groups, `volleyIntervalMs` apart. 1 = a single shot, a single
 * shotgun blast, or a single beam.
 *
 * On `WeaponBase` rather than on projectiles alone, so a beam can be a WAVE SEQUENCE: `shockwave`
 * pulses three rings out of the car half a second apart. Each group is a fresh instance emitted from
 * the car's pose at ITS OWN tick, which is what makes a sequence steerable.
 */
export interface VolleyDef {
  volleys: number;
  volleyIntervalMs: number;
}

/**
 * Projectiles only: how many instances one group emits, and how wide they fan.
 *
 * Kept apart from `VolleyDef` rather than merged into one four-field block on the base, for the
 * reason `BeamStyle` is kept apart from `GlowStyle`: a merged type makes every author answer for the
 * half that cannot apply to their row, and a beam has no pellets to fan.
 */
export interface PelletDef {
  pelletsPerVolley: number;
  spreadAngleDeg: number;
}
```

Add `volley: VolleyDef;` to `WeaponBase`, and change `ProjectileWeaponDef`'s `volley: VolleyDef` to `pellets: PelletDef`.

- [ ] **Step 4: Re-author all nine rows**

In `packages/shared/src/config/weapon-config.ts`, split each projectile's block and give each beam a volley block. **No number changes** — `pepperbox` keeps 3 × 2 until Task 7:

| weapon | `volley` | `pellets` |
|---|---|---|
| `fireball` | `{ volleys: 1, volleyIntervalMs: 0 }` | `{ pelletsPerVolley: 1, spreadAngleDeg: 0 }` |
| `pepperbox` | `{ volleys: 3, volleyIntervalMs: 100 }` | `{ pelletsPerVolley: 2, spreadAngleDeg: 10 }` |
| `needler` | `{ volleys: 1, volleyIntervalMs: 0 }` | `{ pelletsPerVolley: 1, spreadAngleDeg: 0 }` |
| `skewer` | `{ volleys: 1, volleyIntervalMs: 0 }` | `{ pelletsPerVolley: 1, spreadAngleDeg: 0 }` |
| `thumper` | `{ volleys: 1, volleyIntervalMs: 0 }` | `{ pelletsPerVolley: 1, spreadAngleDeg: 0 }` |
| `afterburner`, `lance`, `shockwave`, `bulwark` | `{ volleys: 1, volleyIntervalMs: 0 }` | — (beams) |

- [ ] **Step 5: Make the three consumers kind-agnostic**

`packages/shared/src/config/weapon-ticks.ts`:

```ts
    volleyInterval: msToTicks(def.volley.volleyIntervalMs),
```

`packages/shared/src/sim/weapons/fire.ts`, in `beginFire`:

```ts
    const volleys = def.volley.volleys;
```

`packages/shared/src/sim/weapons/instances.ts`, in `spawnInstances`:

```ts
  const pellets = def.kind === "projectile" ? def.pellets.pelletsPerVolley : 1;
  const spread = def.kind === "projectile" ? (def.pellets.spreadAngleDeg * Math.PI) / 180 : 0;
```

Update `fanOffset`'s doc comment: `pepperbox` has shipped `pelletsPerVolley > 1` since the weapon roster landed, so the "no shipped weapon has more than one pellet" claim is stale and should simply be deleted.

- [ ] **Step 6: Fix the tests that deep-equal the old shape**

`weapon-config.test.ts` asserts `expect(fireball.volley).toEqual({ volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 })` and similar for `pepperbox`. Split each into two assertions matching the new shape. Also update the validation loop, which reads `def.volley.pelletsPerVolley` and `def.volley.spreadAngleDeg` under a `kind === "projectile"` guard — those move to `def.pellets`, and `def.volley.volleys >= 1` now applies to **every** row, not just projectiles.

- [ ] **Step 7: Run the tests**

```bash
npm test
```

Expected: **PASS**. No weapon fires differently; only the type's shape changed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: split VolleyDef so beams can carry volleys

volley (volleys + interval) moves to WeaponBase; pellets (count + spread)
stays on projectiles. Every beam authors volleys: 1, so nothing fires
differently.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Per-wave status application

Behaviour-preserving. `onWave` is absent from every row, so every status still applies on every wave.

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts` (`StatusApplication`)
- Modify: `packages/shared/src/sim/weapons/fire.ts` (`ShotOrder`, `releaseShots`)
- Modify: `packages/shared/src/sim/weapons/instances.ts` (`WeaponInstance`, `spawnInstances`)
- Modify: `packages/shared/src/sim/combat.ts` (the two status helpers, lines ~310, ~349, ~425, ~442)
- Test: `packages/shared/src/sim/status/combat.test.ts`, `sim/weapons/instances.test.ts`

**Interfaces:**
- Consumes: `VolleyDef` from Task 5.
- Produces:
  ```ts
  // StatusApplication.onWave?: "all" | "final"        — absent === "all"
  // ShotOrder.finalVolley: boolean
  // WeaponInstance.finalWave: boolean                 — sim-only, never networked
  function applySelfStatuses(p: CombatPlayer, w: WeaponId, tick: number, finalWave: boolean): void
  function applyOpponentStatuses(t: CombatPlayer, w: WeaponId, tick: number, src: string, finalWave: boolean): void
  ```

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/sim/weapons/instances.test.ts`:

```ts
it("freezes the wave's finality onto every instance it spawns", () => {
  const owner = { sessionId: "a", team: 0 as const, carId: "mirage", x: 0, y: 0, angle: 0 };
  const mid = spawnInstances(
    { weaponId: "fireball", slot: 0, finalVolley: false }, owner, 0, 0,
  );
  const last = spawnInstances(
    { weaponId: "fireball", slot: 0, finalVolley: true }, owner, 0, 0,
  );
  expect(mid.instances[0]!.finalWave).toBe(false);
  expect(last.instances[0]!.finalWave).toBe(true);
});
```

And to `packages/shared/src/config/weapon-config.test.ts`:

```ts
it("defaults every status application to firing on all waves", () => {
  // `onWave` absent must mean today's behaviour, so adding the field cannot change any row that
  // does not opt in.
  for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
    for (const a of def.applies ?? []) {
      if (a.onWave === undefined) continue;
      expect(["all", "final"]).toContain(a.onWave);
    }
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/sim/weapons/instances.test.ts src/config/weapon-config.test.ts --root packages/shared
```

Expected: FAIL — `finalVolley` is not a property of `ShotOrder`.

- [ ] **Step 3: Add `onWave`**

In `packages/shared/src/config/weapon-types.ts`, add to `StatusApplication`:

```ts
  /**
   * Which volley of a multi-wave press this application rides.
   *
   * - `"all"` (the default when absent) — every wave applies it. Correct for anything a lingering or
   *   repeating source should keep topping up.
   * - `"final"` — only the last wave. This is what lets a wave sequence build to something: the
   *   early pulses are pressure and the last one is the payload, without needing two weapon rows.
   *
   * Absent means `"all"`, so adding this field changed no shipped row.
   */
  onWave?: "all" | "final";
```

- [ ] **Step 4: Carry finality from press to instance**

`packages/shared/src/sim/weapons/fire.ts` — add to `ShotOrder`:

```ts
export interface ShotOrder {
  weaponId: WeaponId;
  slot: number;
  /**
   * True on the LAST volley of the press. Carried rather than recomputed downstream: only
   * `releaseShots` knows how many volleys are left, and a `StatusApplication` marked
   * `onWave: "final"` needs the answer at hit time, arbitrarily far from the press.
   */
  finalVolley: boolean;
}
```

In `releaseShots`, `pending.shotsLeft` is still 1 on the last volley when the order is built:

```ts
  const orders: ShotOrder[] = [
    { weaponId: pending.weaponId, slot: pending.slot, finalVolley: pending.shotsLeft === 1 },
  ];
```

`packages/shared/src/sim/weapons/instances.ts` — add to `WeaponInstance`:

```ts
  /**
   * Whether this instance came from the last volley of its press. Frozen at spawn and SIM-ONLY —
   * never networked — for exactly the reason `damage` and `ownerTeam` are: it must be answerable at
   * impact, long after the press, without reading back mutable state.
   *
   * Always true for a single-volley weapon, which is every row but `shockwave`.
   */
  finalWave: boolean;
```

In `spawnInstances`, set `finalWave: order.finalVolley` on each pushed instance.

- [ ] **Step 5: Gate the two helpers**

`packages/shared/src/sim/combat.ts` — both helpers take the flag and skip `"final"` entries when it is false:

```ts
function applySelfStatuses(
  player: CombatPlayer, weaponId: WeaponId, tick: number, finalWave: boolean,
): void {
  const applies = weaponDefOf(weaponId).applies;
  if (!applies) return;
  const durations = weaponTicksOf(weaponId).applyDurations;
  applies.forEach((application, index) => {
    if (application.target !== "self") return;
    if (application.onWave === "final" && !finalWave) return;
    player.statuses = applyStatus(
      player.statuses, application.statusId, tick, durations[index] ?? 0, player.sessionId,
    );
  });
}
```

`applyOpponentStatuses` takes the same guard after its `target !== "opponents"` check.

Call sites:

```ts
// ~line 310, inside the released-orders loop — `order` is in scope
applySelfStatuses(player, order.weaponId, world.tick, order.finalVolley);

// ~line 349, inside the hit loop — `instance` is in scope
applyOpponentStatuses(target, instance.weaponId, world.tick, instance.ownerSessionId, instance.finalWave);
```

- [ ] **Step 6: Fix every other `ShotOrder` and `WeaponInstance` literal**

The compiler finds them:

```bash
npm run build -w @motor-combat-moba/shared && npm run typecheck
```

Test fixtures constructing a `ShotOrder` need `finalVolley: true`; those constructing a `WeaponInstance` need `finalWave: true`. True is the right default — every single-volley weapon's only wave is its last.

- [ ] **Step 7: Run the tests**

```bash
npm test
```

Expected: **PASS**. No row sets `onWave`, so no status applies differently.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: statuses can ride the final wave of a multi-volley press

StatusApplication.onWave ('all' | 'final', absent = 'all'), carried from
releaseShots through ShotOrder to a sim-only WeaponInstance.finalWave.
No schema field, no wire traffic, no shipped row opts in yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Redistribute and retune the weapons

Where the balance lands. T10–T19.

**Files:**
- Modify: `packages/shared/src/config/car-config.ts` (the three `weapons` arrays)
- Modify: `packages/shared/src/config/weapon-config.ts` (eight of nine rows)
- Modify: `packages/client/src/scenes/combat-visual.ts` (`lance` charge `maxRadius`)
- Test: `packages/shared/src/config/weapon-config.test.ts`, `weapon-slots.test.ts`, `config.test.ts`

**Interfaces:**
- Consumes: `VolleyDef`/`PelletDef` (Task 5), `onWave` (Task 6), the T5 ratings (Task 4).
- Produces: the final `WEAPON_TABLE` and the three kits.

The kits (T10):

```ts
mirage:   weapons: ["fireball", "shockwave", "afterburner"]
bullseye: weapons: ["needler", "pepperbox", "lance"]
bastion:  weapons: ["thumper", "skewer", "bulwark"]
```

The row changes, in full:

| weapon | field | from | to |
|---|---|---|---|
| `needler` | `hitbox` | `{ shape: "circle", radius: 5 }` | `{ shape: "ellipse", radiusAlong: 9, radiusAcross: 3 }` |
| | `damage` | 30 | 22 |
| | `cooldownMs` | 400 | 300 |
| | `speed` | 1100 | 1300 |
| | `stock` | `{ max: 3, refireDelayMs: 130 }` | `{ max: 3, refireDelayMs: 110 }` |
| | `applies` | `[{ spiked, opponents, 3000 }]` | **removed entirely** |
| `pepperbox` | `volley` | `{ volleys: 3, volleyIntervalMs: 100 }` | `{ volleys: 1, volleyIntervalMs: 0 }` |
| | `pellets` | `{ pelletsPerVolley: 2, spreadAngleDeg: 10 }` | `{ pelletsPerVolley: 3, spreadAngleDeg: 12 }` |
| | `hitbox.radius` | 7 | 6 |
| | `damage` | 28 | 45 |
| | `usesAimAssist` | false | **true** |
| `lance` | `hitbox.width` | 20 | 23 |
| | `damage` | 180 | 170 |
| | `usesAimAssist` | false | **true** |
| `fireball` | `cooldownMs` | 500 | 550 |
| `shockwave` | `volley` | `{ volleys: 1, volleyIntervalMs: 0 }` | `{ volleys: 3, volleyIntervalMs: 500 }` |
| | `damage` | 100 | 45 |
| | `cooldownMs` | 5000 | 5500 |
| | `applies` | `[{ stunned, opponents, 700 }]` | `[{ corroded, opponents, 2500, onWave: "final" }]` |
| `thumper` | `damage` | 75 | 60 |
| | `applies` | absent | `[{ stunned, opponents, 900 }]` |
| `skewer` | `range` | 1100 | 650 |
| | `speed` | 1400 | 1000 |
| | `usesAimAssist` | false | **true** |
| `bulwark` | `range` | 500 | 550 |
| | `speed` | 500 | 550 |
| | `lifetimeMs` | 2500 | 2875 |
| | `applies` | `[{ corroded, opponents, 2500 }, { fortified, self, 4000 }]` | `[{ spiked, opponents, 3000 }, { fortified, self, 4500 }]` |
| `afterburner` | — | — | **no change** |

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/config/weapon-slots.test.ts`, replacing the existing exclusive-kit test:

```ts
it("gives each chassis the kit its type calls for", () => {
  expect(CAR_TABLE.bullseye.weapons).toEqual(["needler", "pepperbox", "lance"]);
  expect(CAR_TABLE.mirage.weapons).toEqual(["fireball", "shockwave", "afterburner"]);
  expect(CAR_TABLE.bastion.weapons).toEqual(["thumper", "skewer", "bulwark"]);
});
```

Add to `packages/shared/src/config/weapon-config.test.ts`. It currently imports `WEAPON_TABLE`, `isWeaponId`, `weaponDefOf`, `COLOR_TABLE` and `AIM_CONFIG`; **add `slotsOf` from `./weapon-slots.js`, `CAR_TABLE` from `./car-config.js`, and `type CarId` from `./types.js`**.

```ts
it("ships shockwave as a three-wave aura whose last wave carries the debuff", () => {
  const sw = WEAPON_TABLE.shockwave;
  if (sw.kind !== "beam") throw new Error("shockwave must be a beam");
  expect(sw.volley).toEqual({ volleys: 3, volleyIntervalMs: 500 });
  expect(sw.damage).toBe(45); // 135 if all three connect, against the old single 100
  expect(sw.applies).toEqual([
    { statusId: "corroded", target: "opponents", durationMs: 2500, onWave: "final" },
  ]);
  // The stun moved to `thumper` with Type 3's CC identity. It must not linger here.
  expect((sw.applies ?? []).some((a) => a.statusId === "stunned")).toBe(false);
});

it("keeps Bullseye reaching further than anything Bastion carries", () => {
  // T1's "1 beats 3" edge, asserted rather than asserted-in-prose. Cutting skewer's range is the
  // whole reason the kite works; at its old 1100 the tank out-ranged two thirds of the kiter's kit.
  const reach = (id: CarId) => Math.max(...slotsOf(id).map((w) => weaponDefOf(w).range));
  expect(reach("bullseye")).toBeGreaterThan(reach("bastion"));
  expect(WEAPON_TABLE.skewer.range).toBe(650);
});

it("keeps Bastion's crowd control the longest in the roster", () => {
  // T20: per-chassis CC duration needs no mechanism, because kits are exclusive and the applier
  // owns the duration. This is what makes that true rather than merely claimed.
  const longestCc = (id: CarId) =>
    Math.max(0, ...slotsOf(id).flatMap((w) =>
      (weaponDefOf(w).applies ?? [])
        .filter((a) => a.target === "opponents")
        .map((a) => a.durationMs)));
  expect(longestCc("bastion")).toBeGreaterThan(longestCc("mirage"));
  expect(longestCc("bastion")).toBeGreaterThan(longestCc("bullseye"));
});

it("keeps every status in the table reachable from some weapon", () => {
  const applied = new Set(
    Object.values(WEAPON_TABLE).flatMap((d) => (d.applies ?? []).map((a) => a.statusId)),
  );
  for (const id of ["overheated", "corroded", "stunned", "spiked", "fortified"] as const) {
    expect(applied.has(id)).toBe(true);
  }
  // `overhauled` is the pickup row and is deliberately applied by nothing.
  expect(applied.has("overhauled")).toBe(false);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/config/weapon-slots.test.ts src/config/weapon-config.test.ts --root packages/shared
```

Expected: FAIL on the kits and on shockwave's volley.

- [ ] **Step 3: Write the kits and the rows**

Apply the kit arrays and every row change from the tables above. For each row you touch, **rewrite the doc comment so it describes the number it now holds** — several currently derive numbers this task invalidates:

- `fireball` — its comment solves 50 damage from a 500 ms cooldown for a 5-second kill. At 550 ms it sustains 91 DPS and the kill takes 5.5 s. Say that.
- `needler` — the whole `splinter` comment is about a 400 ms cooldown and a `spiked` rider. Rewrite: 22 per 300 ms is 73 sustained DPS, three stocks put 66 out in 220 ms then owe a 900 ms refill, and `spiked` moved to `bulwark`.
- `pepperbox` — the comment is built on sequential volleys being steerable. That skill expression is gone; the fan is decided at the press. Say so plainly rather than deleting the paragraph.
- `shockwave` — it documents a 140° cone that became a 360° ring. Now document the three-wave sequence, the 45-per-wave ceiling of 135, and that the stun left for `thumper`.
- `skewer` — its comment argues aim assist is off *by choice* and that lining two cars up should not be handed to the lock. That argument is reversed; explain that a 650-unit lunge on the slowest chassis needs the help the old 1100-unit poke did not.
- `bulwark` — its comment computes 9 damage ticks for 315. The longer life crosses another tick: **10 ticks, 350** (322 after Bastion's 0.92× attack). Show the arithmetic, as the existing comment does.
- `lance` — note the beam is 15% wider and now takes the lock, and that the lock only reaches `AIM_CONFIG.lockRange` (400) against its own 1200 range.

Then `packages/client/src/scenes/combat-visual.ts`, in `WEAPON_BEAM_STYLES.lance.charge`:

```ts
      maxRadius: 21,
```

with a comment noting it tracks the beam's 15% widening so the telegraph keeps matching what it warns about.

- [ ] **Step 4: Fix the pre-existing tests the retune invalidates**

- `weapon-config.test.ts` → `ships splinter as the table's multi-stock reference`: rename to `needler` and recompute. `22 * (1000 / 300)` is `73.333…`, so the exact-equality assertion becomes `expect(needler.damage * (1000 / needler.cooldownMs)).toBeCloseTo(73.3, 1)`.
- `weapon-config.test.ts` → `ships pepperbox as the table's first burst-and-fan weapon`: 1 volley × 3 pellets × 45 = 135; `usesAimAssist` is now `true`.
- `weapon-config.test.ts` → `ships skewer piercing exactly two cars`: `usesAimAssist` is now `true`; range 650.
- `weapon-config.test.ts` → `ships lance as a detached beam…`: damage 170, width 23, assist true.
- `weapon-config.test.ts` → `ships the migrated fireball with today's numbers`: `cooldownMs` 550.
- `config.test.ts` → `kills an average chassis with the baseline weapon in 5 seconds`: the expectation is now **5.5**, and the test name must change to match. Fix both.
- `status/combat.test.ts` and `server/src/sim/combat-bridge.test.ts`: any test asserting `shockwave` stuns must move to `thumper`.

- [ ] **Step 5: Verify the aim-assist guards still pass for the four newly assisted rows**

The two authoring guards in `weapon-config.test.ts` are already generic over the table, so they cover this automatically. Confirm the margins by hand once:

| weapon | `range` ≥ 400? | Hz | distance from the 1.25 Hz cliff |
|---|---|---|---|
| `needler` | 850 ✔ | 3.33 | 167% ✔ |
| `pepperbox` | 600 ✔ | 0.56 | 56% ✔ |
| `lance` | 1200 ✔ | 0.06 | 95% ✔ |
| `skewer` | 650 ✔ | 0.42 | 67% ✔ |
| `thumper` | 550 ✔ | 1.00 | 20% ✔ |
| `fireball` | 900 ✔ | 1.82 | 45% ✔ |

`lance` is a beam but `attached: false`, so the "no assist on an attached beam" guard does not reach it. **`thumper`'s 1000 ms cooldown must not be lowered** — the guard forbids 696–941 ms.

- [ ] **Step 6: Run the tests**

```bash
npm test
```

Expected: **PASS**.

- [ ] **Step 7: Confirm the three frozen suites still never moved**

```bash
git diff --stat packages/shared/src/sim/golden.test.ts packages/shared/src/sim/drive.test.ts packages/shared/src/sim/status/channels.test.ts
```

Expected: **empty output**, cumulative across Tasks 2–7.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: redistribute and retune the roster into a type triangle

Bullseye needler/pepperbox/lance, Mirage fireball/shockwave/afterburner,
Bastion thumper/skewer/bulwark. Shockwave becomes three waves whose last
corrodes; thumper takes the stun; skewer becomes a 650-unit lunge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Repair the playtest probes

Compile breaks are fixed on the spot — a probe that does not build measures nothing. Stale thresholds and quoted numbers are updated so an `OK` still means what it says.

**Files:**
- Modify: `packages/server/playtest/{weapons,weapons2,collision,geometry,ram,prediction,lan}.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: probes that compile and whose stated expectations match the shipped tables.

- [ ] **Step 1: Read the probes' contract**

Read [`packages/server/playtest/README.md`](../../../packages/server/playtest/README.md). Two rules govern every edit:

1. **Probes report, they do not assert.** Verdicts are `OK`, `FINDING`, `KNOWN-BY-DESIGN`. A probe that throws on the first surprise stops measuring everything after it.
2. **Anything involving contact sweeps the sub-tick phase.** A car covers 10–18 units per tick; removing a sweep makes the probe report whatever one arbitrary phase happened to do.

**Do not create a new probe file or a new scenario.** Do not run `npm run playtest`.

- [ ] **Step 2: Make them compile**

```bash
npm run build && npm run typecheck
```

Fix every error. Most are the car and weapon renames from Task 1; `prediction.ts` and `collision.ts` may also need `driveOf` where they previously reached for `DRIVE_CONFIG.accel` or `.turnRate` directly.

- [ ] **Step 3: Update stale expectations and quoted numbers**

Grep each probe for numbers this change moved and fix the ones that are now wrong:

```bash
grep -rn "540\|405\|315\|780\|4\.2\|1100\|500\|1800\|2500\|140\|700 \|315\b" packages/server/playtest/*.ts
```

Known stale sites, by probe:

- **`ram.ts`** — `RAM_REFERENCE` rose 6.7% because the roster's fastest car went 540 → 576 (T8). Any comment or threshold quoting the old saturation momentum, or quoting a car's mass or top speed, is now wrong.
- **`collision.ts`** — per-car top speed and accel changed, so quoted contact depths and closing speeds are stale.
- **`geometry.ts`** — every weapon's reach moved: `skewer` 1100 → 650, `lance`'s beam is 15% wider, `bulwark` grew 10%, and `shockwave` is now three instances rather than one.
- **`weapons.ts` / `weapons2.ts`** — every kit changed chassis. Any scenario that fires a weapon "from Oval" now needs the chassis that actually carries it. `pepperbox` fires 3 pellets in one volley, not 6 across three.
- **`prediction.ts`** — per-car accel and turn rate are new prediction inputs; a scenario pinned to one car's handling is measuring something different now.

**Where a probe's `FINDING` was about behaviour this change fixed, update its expectation so the fix now reads as `OK` — do not delete the probe.**

- [ ] **Step 4: Verify they build**

```bash
npm run build && npm run typecheck
```

Expected: clean. **Do not run the probes.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: repair playtest probes for the renamed, restatted roster

Compile fixes plus stale thresholds and quoted numbers. Probes not run --
that is the user's call.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Docs, skills, and the generated guide

**Files:**
- Modify: `CLAUDE.md`, `packages/{shared,server,client}/CLAUDE.md`
- Modify: `docs/config-reference.md`, `docs/combat-model.md`, `docs/asset-pipeline.md`, `docs/glossary.md`, `docs/project-structure.md`
- Modify: `.claude/skills/process-car-asset/SKILL.md` + `scripts/preflight.mjs`, `.claude/skills/weapon-forger/SKILL.md`
- Modify: `scripts/build-cars-and-weapons.mjs` (two new stat rows)
- Regenerate + commit: `packages/client/public/manual.html`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: docs that match the shipped tables.

**Never read, cite, or edit `docs/ideas/` or `docs/invariants/`.**

- [ ] **Step 1: Add the two chassis stat rows to the guide generator**

`scripts/build-cars-and-weapons.mjs`, around line 394, currently renders four rows. Add Accel and Handling, importing `accelOf` and `turnRateOf` from built shared:

```js
  const rows = [
    ["Speed", car.speed, `${round(forwardMaxSpeedOf(carId))} u/s top`],
    ["Accel", car.accel, `${round(accelOf(carId))} u/s² · ${round(forwardMaxSpeedOf(carId) / accelOf(carId), 2)}s to top`],
    ["Handling", car.handling, `${round(turnRateOf(carId), 2)} rad/s · ${round(forwardMaxSpeedOf(carId) / turnRateOf(carId))}u turn radius`],
    ["Attack", car.attack, `${round(1 + (car.attack - COMBAT_CONFIG.attackBaseline) * COMBAT_CONFIG.damagePerAttack, 2)}× damage`],
    ["Hull", car.hp, `${hpOf(carId)} HP`],
    ["Mass", car.mass, "ram authority"],
  ];
```

- [ ] **Step 2: Update the prose beside it**

`scripts/cars-and-weapons-copy.mjs` — `CHASSIS_COPY` is keyed by car id, so its three keys must be renamed and its text rewritten for the three types (T1). `WEAPON_COPY` needs its `splinter` key renamed to `needler` and its copy rewritten for the rows Task 7 changed. `SLOT_ROLES` may name chassis; check it.

- [ ] **Step 3: Rebuild and commit the guide**

```bash
npm run build:manual
```

This rewrites `packages/client/public/manual.html`. `balanceStamp` moved on nearly every input, so this is mandatory — `scripts/manual-page.test.mjs` fails with the command to run otherwise.

- [ ] **Step 4: Update the root `CLAUDE.md`**

Three sections need real edits, not renames:

- The intro paragraph naming the aura change — `shockwave` is now Mirage's three-wave slot 2, not Hexagon's ring.
- The chassis-ratings paragraph — it says four ratings (`speed`, `attack`, `hp`, `mass`). There are now **six**; add `accel` and `handling` and note that `handling` is turn rate, not turn radius.
- The statuses paragraph — still accurate, but the sentence naming `shockwave` as the stun source must move to `thumper`.

Add a short note that `stepDrive` takes a resolved `ChassisDrive` and no longer reads `CAR_TABLE`.

- [ ] **Step 5: Update the five docs**

- `docs/config-reference.md` — `CAR_TABLE` gains two columns; `DRIVE_CONFIG` loses four constants and gains six; document `turnRateOf` / `accelOf` / `driveOf`. The 150-point-budget note stays.
- `docs/combat-model.md` — kits, the nine rows, the status-applier map (T20), and the new `onWave` field.
- `docs/asset-pipeline.md` — the three car sprite names and `needler.png`.
- `docs/glossary.md` — add **aura**, **wave**, **handling**, **type**, and the three chassis names.
- `docs/project-structure.md` — only if it names files this change renamed.

- [ ] **Step 6: Update the two skills**

- `.claude/skills/process-car-asset/SKILL.md` and `scripts/preflight.mjs` — the valid car ids are now `bullseye`, `mirage`, `bastion`. **Leave the "opaque rectangle" prose about alpha channels alone** — it is about image data, not a car.
- `.claude/skills/weapon-forger/SKILL.md` — its stock-block row cites `splinter`; that is `needler` now. Its authoring checklist should also mention that `volley` is available on beams and that `onWave` exists.

- [ ] **Step 7: Verify**

```bash
npm test
npm run check:art
```

Expected: both clean. `manual-page.test.mjs` passing is the proof the guide was rebuilt.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: update guide, docs and skills for the new roster

Adds Accel and Handling to the generated cars & weapons guide and
rebuilds it; rewrites the chassis and weapon copy for the three types.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Full verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Clean build in dependency order**

```bash
npm run build
```

Never `npm run build --workspaces` — it has been observed building the server before shared.

- [ ] **Step 2: Prove the server bundle actually contains the new sim**

The classic failure here is a green suite over a stale bundle, because tests import `src` and the server ships an inlined `dist`:

```bash
grep -c "bullseye" packages/server/dist/index.js
grep -o "// \.\..*shared/dist/[a-z-]*\.js" packages/server/dist/index.js | head -3
```

Expected: a non-zero count, and paths reading `// ../shared/dist/…`. A path like `// ../../../../../packages/shared/dist/…` means the build escaped into another checkout — run `npm install` at the repo root and rebuild.

- [ ] **Step 3: Run every suite**

```bash
npm test
```

Expected: **PASS** — all three package suites plus `scripts/*.test.mjs`.

- [ ] **Step 4: Run the art integrity check**

```bash
npm run check:art
```

Expected: no blockers. The `lance` and `bulwark` icon-colour warnings are pre-existing.

- [ ] **Step 5: Final guard — the frozen suites never moved**

```bash
git diff --stat 06be990 -- packages/shared/src/sim/golden.test.ts
```

Expected: the only change is the `GOLDEN_CHASSIS` fixture and the header comment from Task 2 — **no expected value**. Read the diff and confirm by eye.

- [ ] **Step 6: Confirm no schema field was added**

```bash
git diff 06be990 -- packages/shared/src/schema/
```

Expected: **empty.** Invariant 8 holds only because `finalWave` never crossed the wire.

- [ ] **Step 7: Commit anything outstanding**

```bash
git status
```

Expected: clean.

---

## Self-Review

**Spec coverage.** T1 → Task 7's type-chart tests; T2/T3 → Task 1; T4 → Task 3; T5/T6 → Task 4; T7 → Task 3; T8 → Task 4 commit message + Task 8's `ram.ts`; T9 → Task 2; T10–T19 → Task 7 (T19 `afterburner` explicitly unchanged); T20 → Task 7's status-reachability and CC-duration tests; T21 → Tasks 5 and 6; T22 → Tasks 8, 9, 10.

**Placeholder scan.** No TBDs. Every code step carries real code; every "update the comment" step names the specific claim that is now false.

**Type consistency.** `ChassisDrive` is defined in Task 2 and consumed by name in Tasks 3, 4 and 8. `VolleyDef`/`PelletDef` are defined in Task 5 and consumed in Task 7's row table. `ShotOrder.finalVolley` and `WeaponInstance.finalWave` are defined in Task 6 and used in Task 7's `shockwave` row. `turnRateOf` / `accelOf` / `reverseAccelOf` / `turnRateAtStopOf` are defined in Task 3 and consumed in Tasks 4 and 9.

**Ordering.** Every task that moves a number comes after the task providing the mechanism, and each of Tasks 1, 2, 3, 5 and 6 must leave the suite green with zero expectation edits — so a red suite always names its own cause.

**Defects found in review and fixed inline:**

1. The rating-50 anchor test used `toBe(4.2)`. `2.4 + 50 * 0.036` is `4.199999999999999` in IEEE-754, so the test as written could never pass. Now `toBeCloseTo(4.2, 9)`, with the reason on the line.
2. `packages/client/src/ui/car-select-view.ts:78` renders a player-facing **Turn rate** row from `DRIVE_CONFIG.turnRate`. Task 3 deletes that constant, so the car select screen would not have compiled. Now handled in Task 3 Step 5, with Acceleration and Turn radius rows added — turn rate alone misleads on this roster.
3. `packages/server/src/sim/tick.test.ts:86,99` and `config.test.ts:136-137` also read the four deleted constants. Both now have explicit replacements.
4. Six assertions in `drive.test.ts` and `status/channels.test.ts` read `DRIVE_CONFIG.turnRate` / `.accel` / `.reverseAccel` rather than a literal. They must be re-pointed at `GOLDEN_CHASSIS` **in Task 2, while the values are still identical** — afterwards the same edit is indistinguishable from a re-record. Listed line by line.
5. `ram-config.test.ts` pins `massOf` at 350/450/850 and asserts a mass ordering this restat **reverses**. Both now called out with the new values.
6. Three test files needed imports the new assertions depend on (`massOf`, `accelOf`, `turnRateOf`, `reverseMaxSpeedOf`, `slotsOf`, `CarId`). Named at each site.
