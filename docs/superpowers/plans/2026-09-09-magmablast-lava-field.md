# Magma Blast Lava Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Magma Blast's burst becomes a two-second lava field that damages each car once per entry, its shell gains an additive halo, and the field draws as glowing cracked crust on the ground.

**Architecture:** Three layers, in order. The sim gains a third damage-clock mode (`perEntry`) on `ExplosionDef`, reached through a new `explosionDamageModeOf` accessor because the synthesized burst def cannot carry it. The client gains one additive `Graphics` in `ArenaScene` for vector glow (shell halos, field ring) and a pooled pair of textured `Image`s per field in `fx/layer.ts` for the crust and its seams. All new visual constants land in `ENVIRONMENT_FX` so the playground panel can tune them.

**Tech Stack:** TypeScript, npm workspaces, Vitest, Phaser 4, Colyseus.

**Spec:** [`docs/superpowers/specs/2026-09-09-magmablast-lava-field-design.md`](../specs/2026-09-09-magmablast-lava-field-design.md)

## Global Constraints

- **Verify with root `npm test`.** A per-workspace run silently skips the server suite.
- **Rebuild shared after editing it**: `npm run build -w @motor-combat-moba/shared`. Server and client consume built `dist`, never `src`. Build with root `npm run build`, never `npm run build --workspaces`.
- **No magic numbers in logic.** Sim balance lives in `packages/shared/src/config/`; client visual constants live in `ENVIRONMENT_FX` (`packages/client/src/fx/environment.ts`).
- **`fx/` must stay Phaser-free below `layer.ts`.** Client tests run in vitest's **node** environment — there is no `document`. Texture generators return raw RGBA bytes (`TexturePixels`); only `fx/layer.ts` uploads them.
- **Hard invariant 8 is not engaged.** No new Colyseus schema field is added by any task in this plan.
- **`docs/turn-tuning.md` is untouched.** No task changes a `CAR_TABLE` rating, a `DRIVE_CONFIG` knob, `RAM_CONFIG.spinMaxRate`, `TICK_RATE_HZ`, or a `STATUS_TABLE` row's `turnRate`.
- **Commit after every task.** End every commit message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Never run `npm run playtest` or `npm run balance` on your own initiative.** Task 9 tells you what to report instead.
- Exact values fixed by the spec: `lingerMs: 2000`, `explosion.damage: 15` (unchanged), `explosion.radius: 60` (unchanged), `cooldownMs: 1600` (unchanged), `GLOW_DEPTH = -4`, `LAVA_DEPTH = -7`, halo outer edge at 2.5× hitbox radius.

---

### Task 1: `damageMode` on `ExplosionDef`, and the accessor that reads it

Pure plumbing. Adds the field, sets `magmablast` to `"onceEver"` — today's exact behaviour — so this task provably changes nothing at runtime.

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts` (the `ExplosionDef` interface, ~line 338)
- Modify: `packages/shared/src/config/weapon-config.ts` (the `magmablast` row ~line 194; new export near `instanceDefOf` ~line 546)
- Test: `packages/shared/src/config/weapon-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ExplosionDamageMode = "onceEver" | "perEntry"` (exported from `weapon-types.ts`); `ExplosionDef.damageMode: ExplosionDamageMode` (required); `explosionDamageModeOf(id: WeaponId): ExplosionDamageMode | undefined` (exported from `weapon-config.ts`).

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("explosions (spec P22-P27)", ...)` block in `packages/shared/src/config/weapon-config.test.ts`:

```ts
    it("makes every explosion state its damage mode (LZ5)", () => {
      for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
        if (def.kind !== "projectile" || !def.explosion) continue;
        expect(["onceEver", "perEntry"], def.id).toContain(def.explosion.damageMode);
      }
    });

    it("reads the mode back off the row, and undefined for a weapon with no explosion (LZ10a)", () => {
      expect(explosionDamageModeOf("magmablast")).toBe(WEAPON_TABLE.magmablast.explosion.damageMode);
      // `lance` is a beam and authors no explosion at all.
      expect(explosionDamageModeOf("lance")).toBeUndefined();
    });
```

Add `explosionDamageModeOf` to the existing import from `./weapon-config.js` at the top of that file, and `WeaponDef` to the existing type import from `./weapon-types.js`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/config/weapon-config.test.ts -t "damage mode"`
Expected: FAIL — `explosionDamageModeOf is not a function`, and a TypeScript error that `damageMode` does not exist on `ExplosionDef`.

- [ ] **Step 3: Add the type**

In `packages/shared/src/config/weapon-types.ts`, immediately above `export interface ExplosionDef {`:

```ts
/**
 * How an explosion's per-target damage clock behaves (spec LZ4, LZ5).
 *
 * `"onceEver"` is the original rule and the right answer for a burst too brief to leave and
 * re-enter: a car pays once, and the clock is never re-armed.
 *
 * `"perEntry"` is what makes a LINGERING field a place rather than a moment. A car pays on the tick
 * it enters, pays nothing for standing there however long it stays, and pays again if it leaves and
 * comes back. Deliberately not a damage-over-time interval: a frequency punishes the car that is
 * stuck, where an entry rule punishes the car that chose to cross — and "go around" is the
 * counterplay the field is for.
 */
export type ExplosionDamageMode = "onceEver" | "perEntry";
```

Then, inside `ExplosionDef`, directly after the `lingerMs` field:

```ts
  /**
   * Required rather than defaulted, for the reason `BeamWeaponDef.origin` is: an explosion that
   * inherits a damage rule nobody chose is exactly the silent mistake this interface's own comment
   * was written to prevent. See `ExplosionDamageMode`.
   */
  damageMode: ExplosionDamageMode;
```

Also update the interface's leading doc comment: the paragraph beginning *"There is deliberately no damage-frequency knob"* now describes a rule that has been argued for and replaced. Replace that paragraph with:

```
 * There is deliberately no damage-FREQUENCY knob — `damageMode` is a two-value rule, not an
 * interval. A repeating explosion was argued for on its own terms in the 2026-09-09 lava field
 * design and the answer it reached was per-ENTRY, not per-tick; see `ExplosionDamageMode`.
```

- [ ] **Step 4: Add the accessor and set the row**

In `packages/shared/src/config/weapon-config.ts`, add `damageMode: "onceEver",` to the `magmablast` row's `explosion` block, directly after `lingerMs: 150,`.

Then add, directly below `instanceDefOf`:

```ts
/**
 * How this weapon's explosion re-arms its per-target damage clock, or `undefined` if it authors no
 * explosion (spec LZ10a).
 *
 * It lives here rather than on the synthesized burst def or in `WEAPON_TICKS`, and both alternatives
 * are worth naming because both look right. `instanceDefOf` returns a `BeamWeaponDef` for a burst,
 * and that type must not gain a `damageMode`: a beam fired from a muzzle has no inside to leave.
 * `WeaponTicks.explosion` is the other candidate and is also wrong — every field in it is a duration
 * converted to ticks, and a mode string is not a clock.
 *
 * Reads through `weaponDefOf` rather than indexing `WEAPON_TABLE` directly, for the narrowing reason
 * `buildBurstDefs` sets out at length: the table is `as const satisfies`, so a bare index yields a
 * union of literal row types on which ordinary `.kind` narrowing does not behave.
 */
export function explosionDamageModeOf(id: WeaponId): ExplosionDamageMode | undefined {
  const def = weaponDefOf(id);
  return def.kind === "projectile" ? def.explosion?.damageMode : undefined;
}
```

Add `ExplosionDamageMode` to the existing type import from `./weapon-types.js` at the top of `weapon-config.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS. Every suite green — this task changes no behaviour, so nothing else may move.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config/weapon-types.ts packages/shared/src/config/weapon-config.ts packages/shared/src/config/weapon-config.test.ts
git commit -m "$(cat <<'EOF'
feat(sim): give ExplosionDef a required damageMode, defaulted to today's rule

Plumbing only. Every explosion states its clock rule and `magmablast` states
"onceEver", which is what it already did, so nothing changes at runtime.
`explosionDamageModeOf` is the seam `hits.ts` will read: the synthesized burst
def is a BeamWeaponDef and cannot carry it, and WeaponTicks holds durations.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The `perEntry` clock mode in `resolveInstanceHits`

Still inert — no row uses `perEntry` until Task 3.

**Files:**
- Modify: `packages/shared/src/sim/weapons/hits.ts:63-86`
- Test: `packages/shared/src/sim/weapons/hits.test.ts`

**Interfaces:**
- Consumes: `explosionDamageModeOf` from Task 1.
- Produces: no new exports. `resolveInstanceHits`'s signature is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/sim/weapons/hits.test.ts`. The helper builds a burst literal directly rather than exporting `detonate`, which is module-private in `combat.ts`:

```ts
/**
 * A magmablast burst at full extent, the shape `detonate` produces. Built as a literal rather than
 * by exporting `detonate`, which is private to combat.ts and has no reason not to be.
 */
function burstAt(x: number, y: number, tick: number, mode: "onceEver" | "perEntry"): WeaponInstance {
  const def = instanceDefOf("magmablast", true);
  return {
    id: "aaa-1",
    ownerSessionId: "aaa",
    ownerTeam: 0,
    finalWave: true,
    damage: 15,
    weaponId: "magmablast",
    kind: "beam",
    x,
    y,
    angle: 0,
    extent: def.range,
    spawnTick: tick,
    distance: 0,
    pierceLeft: 0,
    attached: false,
    damageClock: new Map(),
    alive: true,
    muzzleDir: 0,
    homingTargetId: "",
    homingUntilTick: 0,
    expiresAtTick: 0,
    isExplosion: true,
    pressId: "aaa#100#0",
    // `mode` is not a field on the instance — it is read off the table by weapon id. The parameter
    // exists so each test reads as a statement about which mode it is exercising; the tests below
    // that need "perEntry" stub the table row.
  } satisfies WeaponInstance;
}

/** Inside the 60-unit disc; a car hull is 48 x 24, so this overlaps comfortably. */
const INSIDE = { sessionId: "bbb", team: 1 as const, x: 420, y: 300 };
/** Well clear of a 60-unit disc centred at (400, 300). */
const OUTSIDE = { sessionId: "bbb", team: 1 as const, x: 900, y: 300 };

describe("a lingering field's per-entry damage clock (LZ8)", () => {
  it("damages a car once when it enters and never again while it stays", () => {
    const field = burstAt(400, 300, 100, "perEntry");
    const inside = snapshot([INSIDE]);

    const first = resolveInstanceHits(field, field, inside, "ffa", 101);
    expect(first.damaged).toEqual([{ sessionId: "bbb", amount: 15 }]);

    // Ten more ticks parked in the same place.
    let carried = first.instance;
    for (let tick = 102; tick <= 111; tick++) {
      const out = resolveInstanceHits(carried, carried, inside, "ffa", tick);
      expect(out.damaged, `tick ${tick}`).toEqual([]);
      carried = out.instance;
    }
  });

  it("re-arms on exit, so leaving and returning costs a second hit", () => {
    const field = burstAt(400, 300, 100, "perEntry");

    const entered = resolveInstanceHits(field, field, snapshot([INSIDE]), "ffa", 101);
    expect(entered.damaged).toHaveLength(1);

    const left = resolveInstanceHits(entered.instance, entered.instance, snapshot([OUTSIDE]), "ffa", 102);
    expect(left.damaged).toEqual([]);
    expect(left.instance.damageClock.has("bbb")).toBe(false);

    const returned = resolveInstanceHits(left.instance, left.instance, snapshot([INSIDE]), "ffa", 103);
    expect(returned.damaged).toEqual([{ sessionId: "bbb", amount: 15 }]);
  });

  it("does not re-arm for a car that merely leaves the snapshot (LZ11)", () => {
    // A car that dies or goes `phased` inside the field is dropped from the snapshot by
    // `isTargetable` — it never fails the overlap test, so it must not count as having exited.
    const field = burstAt(400, 300, 100, "perEntry");
    const entered = resolveInstanceHits(field, field, snapshot([INSIDE]), "ffa", 101);

    const gone = resolveInstanceHits(entered.instance, entered.instance, snapshot([]), "ffa", 102);
    expect(gone.instance.damageClock.has("bbb")).toBe(true);

    const back = resolveInstanceHits(gone.instance, gone.instance, snapshot([INSIDE]), "ffa", 103);
    expect(back.damaged).toEqual([]);
  });

  it("leaves an onceEver field damaging each car exactly once, ever (LZ6)", () => {
    const field = burstAt(400, 300, 100, "onceEver");
    const entered = resolveInstanceHits(field, field, snapshot([INSIDE]), "ffa", 101);
    expect(entered.damaged).toHaveLength(1);

    const left = resolveInstanceHits(entered.instance, entered.instance, snapshot([OUTSIDE]), "ffa", 102);
    const returned = resolveInstanceHits(left.instance, left.instance, snapshot([INSIDE]), "ffa", 103);
    expect(returned.damaged).toEqual([]);
  });
});
```

The `snapshot` helper already in this file takes `{ sessionId, team?, x, y }`, so `INSIDE`/`OUTSIDE` drop straight in. Add `instanceDefOf` to the import from `../../config/weapon-config.js`.

**The three `perEntry` tests need `magmablast.explosion.damageMode` to read `"perEntry"`, which it does not until Task 3.** Drive that with a mock. Use `vi.hoisted` for the mutable box — `vi.mock` factories are hoisted above the file's `let` declarations, and a factory that closes over a plain outer `let` is the standard vitest footgun:

```ts
const modeBox = vi.hoisted(() => ({ current: null as "onceEver" | "perEntry" | null }));

vi.mock("../../config/weapon-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/weapon-config.js")>();
  return {
    ...actual,
    explosionDamageModeOf: (id: WeaponId) =>
      modeBox.current ?? actual.explosionDamageModeOf(id),
  };
});

afterEach(() => {
  modeBox.current = null;
});
```

Set `modeBox.current` at the top of each test (`"perEntry"` for the first three, `"onceEver"` for the fourth). Import `vi` and `afterEach` from `vitest`, and `WeaponId` from `../../config/weapon-types.js`. Drop the `mode` parameter from `burstAt` — the mock is what decides the mode, and a parameter nothing reads is worse than none.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/shared/src/sim/weapons/hits.test.ts -t "per-entry"`
Expected: FAIL — the field damages on every tick, because `resolveInstanceHits` has no `perEntry` branch and a beam's `damageInterval` of `Infinity` makes `tick < Infinity` true forever after the first hit. Specifically: the "once when it enters" case fails at tick 102 with `[]` expected but a 15-damage entry received... **verify the actual failure text before implementing** — if it passes, the mock is not wired and the test is proving nothing.

- [ ] **Step 3: Implement the branch**

In `packages/shared/src/sim/weapons/hits.ts`, add to the imports:

```ts
import { explosionDamageModeOf, instanceDefOf } from "../../config/weapon-config.js";
```

After the existing `const interval = ...` line, add:

```ts
  // A lingering field asks a different question of the snapshot than a shot does, so it takes a
  // different branch below rather than a different interval. See `ExplosionDamageMode`.
  const perEntry =
    instance.isExplosion && explosionDamageModeOf(instance.weaponId) === "perEntry";
```

Replace the loop body's damage block with:

```ts
  for (const entry of snapshot) {
    if (!alive) break;
    if (!canDamage(instance.ownerSessionId, instance.ownerTeam, entry.sessionId, entry.team, mode)) continue;

    if (perEntry) {
      // The shape test runs FIRST here, where every other mode checks the clock first. That
      // inversion IS the feature: this mode has to learn that a car is OUTSIDE, and a clock check
      // that `continue`s never reaches the test that could tell it.
      if (!shapeHitsObb(shape, entry.hull)) {
        // Re-armed. Note this only fires for a car actually IN the snapshot: one that died or went
        // `phased` inside the field was dropped by `isTargetable` and keeps its entry (LZ11).
        clock.delete(entry.sessionId);
        continue;
      }
      if (clock.has(entry.sessionId)) continue;
      damaged.push({ sessionId: entry.sessionId, amount: instance.damage });
      // Presence in the map is the whole flag. The value is Infinity rather than a tick because a
      // finite number would read as "re-arm at tick N" to anything inspecting this map generically,
      // which is precisely what this mode does not mean.
      clock.set(entry.sessionId, Number.POSITIVE_INFINITY);
      // No pierce arithmetic: a burst is a beam, and the block below skips beams anyway.
      continue;
    }

    if (tick < (clock.get(entry.sessionId) ?? 0)) continue;
    if (!shapeHitsObb(shape, entry.hull)) continue;

    damaged.push({ sessionId: entry.sessionId, amount: instance.damage });
    clock.set(entry.sessionId, interval === Number.POSITIVE_INFINITY ? interval : tick + interval);

    if (instance.kind !== "projectile") continue;
    if (pierceLeft <= 0) alive = false;
    else pierceLeft -= 1;
  }
```

Update `resolveInstanceHits`'s doc comment to mention the third mode.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS, all suites. No shipped row uses `perEntry` yet, so no other test may move.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/weapons/hits.ts packages/shared/src/sim/weapons/hits.test.ts
git commit -m "$(cat <<'EOF'
feat(sim): per-entry damage clock for lingering explosion fields

A third clock mode beside the interval and the once-ever. It inverts the guard
order — shape first, then clock — because the mode has to learn that a car is
OUTSIDE, and a clock check that continues never runs the test that would say so.

Absence from the pose snapshot is deliberately NOT an exit: a car dropped by
isTargetable (dead, or phased) keeps its entry, so respawning cannot re-arm a
field for free.

Inert until a row asks for it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Turn the burst into a two-second field

The behaviour change, alone in its own commit so it can be reverted without taking the mechanism with it.

**Files:**
- Modify: `packages/shared/src/config/weapon-config.ts` (the `magmablast` row)
- Modify: `packages/shared/src/config/weapon-config.test.ts:379`
- Modify: `packages/client/public/manual.html` (regenerated, not hand-edited)
- Check: `scripts/cars-and-weapons-copy.mjs`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `WEAPON_TABLE.magmablast.explosion` = `{ radius: 60, damage: 15, lingerMs: 2000, damageMode: "perEntry", applies: [...] }`.

- [ ] **Step 1: Update the failing assertion**

In `packages/shared/src/config/weapon-config.test.ts`, change the existing case:

```ts
    expect(sw.explosion).toMatchObject({
      radius: 60,
      damage: 15,
      lingerMs: 2000,
      damageMode: "perEntry",
    });
```

And add beside it:

```ts
    it("keeps the field alive long enough to be driven into and out of (LZ17)", () => {
      // 2000 ms at 30 Hz. The old 150 ms was 40 units of travel at Mirage's top speed — under one
      // car length — so nothing could enter a field that was not already standing in it.
      expect(weaponTicksOf("magmablast").explosion!.lifetime).toBe(60);
    });
```

Import `weaponTicksOf` from `./weapon-ticks.js` if it is not already imported in that file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/config/weapon-config.test.ts`
Expected: FAIL — `lingerMs` is 150, `damageMode` is `"onceEver"`, `lifetime` is 5.

- [ ] **Step 3: Edit the row**

In `packages/shared/src/config/weapon-config.ts`, the `magmablast` `explosion` block becomes:

```ts
    explosion: {
      radius: 60,
      damage: 15,
      // A field, not a flash (spec LZ17, superseding P19). Two seconds is long enough to drive into
      // and out of, which is what makes `perEntry` mean anything and what turns this from a splash
      // number into a place on the map you would rather not cross.
      lingerMs: 2000,
      damageMode: "perEntry",
      applies: [{ statusId: "corroded", target: "opponents", durationMs: 2000 }],
    },
```

Also extend the row's leading doc comment with a note that the field outlives the shell by design and that `cooldownMs` was knowingly left at 1600 (spec LZ19), so fields overlap by 400 ms of every cycle and a car in the overlap takes 15 from each.

- [ ] **Step 4: Run the tests**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: `scripts/manual-page.test.mjs` FAILS, naming `npm run build:manual`. That is correct and expected — `balanceStamp` hashes `WEAPON_TABLE` whole. Everything else passes.

- [ ] **Step 5: Check the guide's prose, then rebuild it**

Read `scripts/cars-and-weapons-copy.mjs` and search it for magmablast's paragraphs. If any sentence describes the burst as brief, momentary, or a flash, rewrite it to describe a lingering field — that is exactly the rot `balanceStamp` cannot catch, because it hashes the copy file rather than checking whether the copy is true. Quote numbers only through `{token}` placeholders defined in `scripts/manual-facts.mjs`; typing a figure as digits fails `scripts/manual-facts.test.mjs`.

Run: `npm run build:manual`

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, all suites including `manual-page.test.mjs`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/config/weapon-config.ts packages/shared/src/config/weapon-config.test.ts packages/client/public/manual.html scripts/cars-and-weapons-copy.mjs
git commit -m "$(cat <<'EOF'
feat(weapons): magma blast leaves a two-second lava field

lingerMs 150 -> 2000 and damageMode "perEntry". Supersedes P19, whose "mostly
for the eye" reasoning no longer describes what the burst is for: 150 ms was
under one car length of travel, so only a car already standing at the impact
point could be caught.

Damage (15) and radius (60) are unchanged, and cooldownMs stays 1600 knowingly
— fields overlap by 400 ms of every cycle and a car in the overlap takes 15
from each. That is the number to measure, not to predict.

Guide rebuilt: balanceStamp hashes WEAPON_TABLE whole.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Two new rungs on the depth ladder

**Files:**
- Modify: `packages/client/src/fx/depths.ts`
- Test: `packages/client/src/fx/depths.test.ts`

**Interfaces:**
- Produces: `LAVA_DEPTH = -7`, `GLOW_DEPTH = -4`, both exported from `fx/depths.ts`.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/depths.test.ts`, and add `GLOW_DEPTH, LAVA_DEPTH` to the import:

```ts
  it("puts the lava crust above decals and below ground FX", () => {
    // Rubber and scorch sit under a lava field; ground sparks throw over it; cars drive on it.
    expect(LAVA_DEPTH).toBeGreaterThan(DECAL_DEPTH);
    expect(LAVA_DEPTH).toBeLessThan(GROUND_FX_DEPTH);
  });

  it("puts additive glow over the shots and under the cars", () => {
    // Over the shots because additive light belongs on top of what emits it, and being additive it
    // cannot occlude the core it washes over. Under the cars because a glow across a chassis takes
    // colour off the player paint — the same readability rule as VFX24.
    expect(GLOW_DEPTH).toBeGreaterThan(SHOT_DEPTH);
    expect(GLOW_DEPTH).toBeLessThan(CAR_DEPTH);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/client/src/fx/depths.test.ts`
Expected: FAIL — `LAVA_DEPTH` and `GLOW_DEPTH` are not exported.

- [ ] **Step 3: Add the constants**

In `packages/client/src/fx/depths.ts`, after `DECAL_DEPTH`:

```ts
/**
 * A lingering lava field's cracked crust. Above the decals it is laid over, below the ground FX
 * thrown across it, and well below the cars — a field is ground, and you drive on it.
 */
export const LAVA_DEPTH = -7;
```

After `GROUND_FX_DEPTH`:

```ts
/**
 * Additive glow: shell halos and a lava field's ring and seams.
 *
 * ABOVE `SHOT_DEPTH` (-5) and below `CAR_DEPTH` (0). Above the shots because additive light belongs
 * over the thing emitting it, and because an additive layer can only add — it cannot hide the shot
 * core it washes across, so drawing it on top costs no readability. Below the cars for the reason
 * VFX24 keeps air FX below the HUD: a glow drawn over a chassis drains the player colour that says
 * whose car it is.
 */
export const GLOW_DEPTH = -4;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/client/src/fx/depths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/depths.ts packages/client/src/fx/depths.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): LAVA_DEPTH and GLOW_DEPTH rungs

Glow sits above the shots because additive light cannot occlude what it washes
over, and below the cars because it would otherwise drain the player paint.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The shell's halo

**Files:**
- Modify: `packages/client/src/scenes/combat-visual.ts` (`GlowStyle` ~line 228, `WEAPON_GLOW_STYLES` ~line 272, new export beside `instanceGlowBands` ~line 1259)
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`shotGfx` creation ~line 954, `displayObjects` list ~line 1314, teardown ~line 1425, `renderShots` ~line 2238)
- Test: `packages/client/src/scenes/combat-visual.test.ts`

**Interfaces:**
- Consumes: `GLOW_DEPTH` from Task 4.
- Produces: `interface HaloBand { radiusScale: number; color: string; alpha: number }`; `GlowStyle.halo?: readonly HaloBand[]`; `instanceHaloBands(weaponId: string, radius: number): DrawBand[]` returning `{ radius, fill, alpha }` — note this adds an `alpha` to the shape `DrawBand` already has, so widen `DrawBand` with an optional `alpha?: number` rather than introducing a second near-identical type.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/scenes/combat-visual.test.ts`:

```ts
describe("shell halos (LZ22, LZ23)", () => {
  it("draws magmablast's halo outside its hitbox, fading to nothing", () => {
    const bands = instanceHaloBands("magmablast", 12);
    expect(bands.length).toBeGreaterThan(0);
    // Every halo band is OUTSIDE the hitbox — that is what makes it a halo.
    for (const band of bands) expect(band.radius).toBeGreaterThan(12);
    // Outermost first, shrinking inward, exactly as `bands` is ordered.
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]!.radius).toBeLessThan(bands[i - 1]!.radius);
    }
    // The outer edge reaches 2.5x the hitbox radius and no further.
    expect(bands[0]!.radius).toBeCloseTo(30, 5);
  });

  it("keeps every halo band translucent, so no halo can read as an edge (LZ23)", () => {
    // The D19 exception is bounded: additive only, never opaque, and the outermost SOLID band stays
    // pinned at the hitbox. An opaque halo band would be a second silhouette outside the thing that
    // can actually hit you.
    for (const [id, style] of Object.entries(WEAPON_GLOW_STYLES)) {
      for (const band of style?.halo ?? []) {
        expect(band.alpha, `${id} halo`).toBeGreaterThan(0);
        expect(band.alpha, `${id} halo`).toBeLessThan(1);
        expect(band.radiusScale, `${id} halo`).toBeGreaterThan(1);
      }
      // The solid bands are untouched by any of this.
      const solid = style?.bands.map((b) => b.radiusScale) ?? [];
      expect(Math.max(...solid), `${id} solid`).toBe(1);
    }
  });

  it("draws no halo for a weapon that authors none", () => {
    expect(instanceHaloBands("pepperbox", 10)).toEqual([]);
    expect(instanceHaloBands("not-a-weapon", 10)).toEqual([]);
  });
});
```

Add `instanceHaloBands` to the import from `./combat-visual.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/client/src/scenes/combat-visual.test.ts -t "halo"`
Expected: FAIL — `instanceHaloBands is not a function`.

- [ ] **Step 3: Add the type, the table values and the function**

In `packages/client/src/scenes/combat-visual.ts`, above `GlowStyle`:

```ts
/**
 * One ring of an additive halo — a band drawn OUTSIDE the hitbox, in the glow layer.
 *
 * This is a deliberate, bounded exception to D19 ("a shot is drawn as the thing that can hit
 * you"), and the bounds are what make it safe. A halo is additive, so it adds light and never a
 * silhouette; it is never opaque, so it has no edge to mistake for a boundary; and the outermost
 * SOLID band stays pinned at `radiusScale: 1`, so the crisp readable edge is still exactly the
 * hitbox. `combat-visual.test.ts` holds all three. Break any one and the halo becomes a lie about
 * how big the shot is.
 */
export interface HaloBand {
  /** Multiple of the hitbox radius. Always > 1 — a band at or inside 1 belongs in `bands`. */
  radiusScale: number;
  color: string;
  /** Always in (0, 1). See the type comment: an opaque halo band is a second silhouette. */
  alpha: number;
}
```

Add to `GlowStyle`:

```ts
  /**
   * An additive bloom outside the hitbox, outermost first. Absent draws none, which is every weapon
   * but `magmablast`. See `HaloBand` for why this may leave the hitbox when nothing else may.
   */
  halo?: readonly HaloBand[];
```

Widen `DrawBand`:

```ts
export interface DrawBand {
  radius: number;
  fill: number;
  /** Halo bands only. Absent means fully opaque, which is every solid band. */
  alpha?: number;
}
```

Extend the `magmablast` entry in `WEAPON_GLOW_STYLES` — hotter core, plus the halo:

```ts
  magmablast: {
    bands: [
      { radiusScale: 1, color: "#C02000" },
      { radiusScale: 0.74, color: "#FF6000" },
      // Hotter than the icon's own core: a shell that casts a halo should have something casting it.
      { radiusScale: 0.42, color: "#FFD060" },
    ],
    // Out to 2.5x the 12-unit hitbox — 30 units, about two thirds of a car length. Continues the
    // ramp outward rather than restating it: the halo is the same fire, further from the middle.
    halo: [
      { radiusScale: 2.5, color: "#4A1000", alpha: 0.1 },
      { radiusScale: 1.9, color: "#8A2400", alpha: 0.16 },
      { radiusScale: 1.4, color: "#C04000", alpha: 0.26 },
    ],
    // No flicker, deliberately, and the halo authors no rate of its own. A pulsing outline on a
    // 12-unit disc reads as a rendering fault rather than as fire — and a static halo also costs no
    // per-frame hash, which is what keeps this affordable.
    flickerDepth: 0,
    flickerHz: 0,
  },
```

Add beside `instanceGlowBands`:

```ts
/**
 * The additive bands to fill OUTSIDE one instance's hitbox, outermost first, or `[]` for a weapon
 * with no halo.
 *
 * Takes no clock: halos do not flicker (LZ25), so unlike `instanceGlowBands` there is nothing here
 * to phase. Pure, for the same reason everything else in this module is — `ArenaScene` cannot be
 * unit tested without a browser.
 */
export function instanceHaloBands(weaponId: string, radius: number): DrawBand[] {
  const style = isWeaponId(weaponId) ? WEAPON_GLOW_STYLES[weaponId] : undefined;
  if (!style?.halo) return [];
  return style.halo.map((band) => ({
    radius: radius * band.radiusScale,
    fill: hexToFill(band.color),
    alpha: band.alpha,
  }));
}
```

- [ ] **Step 4: Wire the glow layer into `ArenaScene`**

Add `GLOW_DEPTH` to the `fx/depths.js` import and `instanceHaloBands` to the `combat-visual.js` import.

Beside the `shotGfx` field declaration (~line 695):

```ts
  /**
   * Additive glow: shell halos and a lava field's ring. Cleared and refilled each frame beside
   * `shotGfx`.
   *
   * Its own object rather than a mode set on `shotGfx`, because `combat-visual.ts` warns by name
   * against a per-instance `setBlendMode` — what that forbids is switching blend state inside the
   * draw loop, once per shot per frame. Setting ADD once at construction and reusing the object for
   * the life of the scene costs one extra draw batch per frame and nothing per shot.
   */
  private glowGfx: Phaser.GameObjects.Graphics | undefined;
```

Beside `this.shotGfx = this.add.graphics().setDepth(SHOT_DEPTH);` (~line 954):

```ts
    this.glowGfx = this.add
      .graphics()
      .setDepth(GLOW_DEPTH)
      .setBlendMode(Phaser.BlendModes.ADD);
```

Add `...(this.glowGfx ? [this.glowGfx] : []),` beside the `shotGfx` entry in the display-object list (~line 1314). **This is required, not cosmetic:** `splitCameras` needs every display object ignored by exactly one camera — ignored by neither and it draws twice, by both and it vanishes (VFX25).

In the teardown beside `this.shotGfx?.destroy()` (~line 1425):

```ts
    this.glowGfx?.destroy();
    this.glowGfx = undefined;
```

In `renderShots`, after `gfx.clear();`:

```ts
    const glow = this.glowGfx;
    glow?.clear();
```

And in the circle branch, immediately before the `bands` block:

```ts
      // Additive bloom outside the hitbox, in its own layer. Drawn before the solid bands so the
      // core reads over its own glow. See `HaloBand` for why this is allowed past the hitbox.
      if (glow) {
        for (const band of instanceHaloBands(instance.weaponId, shape.radius)) {
          glow.fillStyle(band.fill, alpha * (band.alpha ?? 1));
          glow.fillCircle(shape.x, shape.y, band.radius);
        }
      }
```

Update `renderShots`'s doc comment: `WEAPON_GLOW_STYLES` is no longer "empty as of the 2026-09-01 roster cutover" — that sentence is already stale and this task makes it more so.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS. Watch for `projectile-marks.test.ts:197`, which comments that magmablast's `GlowStyle` is "empty today" — if it asserts on band count it needs updating.

- [ ] **Step 6: Verify in the browser**

Run `npm run dev`, open `http://localhost:5173/?dev=playground`, fire Magma Blast. Confirm: a soft bloom around the shell that does not read as a hard edge; the shell core still crisply 12 units; no glow washing across cars; hp bars unaffected. Take a screenshot for the summary.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/scenes/combat-visual.ts packages/client/src/scenes/combat-visual.test.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "$(cat <<'EOF'
feat(fx): an additive glow layer, and a halo on magma blast's shell

One ADD-blended Graphics beside shotGfx, blend state set once at construction
rather than per instance — which is what combat-visual.ts's budget note
actually forbids.

The halo is a bounded D19 exception: additive only, never opaque, and the
outermost SOLID band still pinned at the hitbox, so what reads as the shot's
edge is still exactly what can hit you. Tests hold all three bounds.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Cellular noise and the cracked-crust texture

Pure pixel generation, fully testable in node. No Phaser.

**Files:**
- Modify: `packages/client/src/fx/noise.ts`
- Modify: `packages/client/src/fx/textures.ts`
- Test: `packages/client/src/fx/noise.test.ts`, `packages/client/src/fx/textures.test.ts`

**Interfaces:**
- Consumes: `hash2` (already exported from `fx/noise.ts`), `EnvironmentFx` (widened in Task 7 — **write this task against the field names listed below and add them to the interface here**, so Task 7 only adds the panel rows).
- Produces: `cellular(x, y, seed): { f1: number; f2: number }`; `crackedCrustTexture(seed, size, env): { crust: TexturePixels; seam: TexturePixels }`.

**Both textures are drawn in greyscale and coloured by Phaser tint at draw time**, so every colour stays a live knob rather than a baked one. Only geometry is baked.

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/src/fx/noise.test.ts`:

```ts
describe("cellular noise", () => {
  it("returns the two nearest feature distances, in order", () => {
    for (let i = 0; i < 200; i++) {
      const { f1, f2 } = cellular(i * 0.37, i * 0.61, 9);
      expect(f1).toBeLessThanOrEqual(f2);
      expect(f1).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(f2)).toBe(true);
    }
  });

  it("is deterministic for a seed and drifts for a different one", () => {
    expect(cellular(3.2, 4.8, 1)).toEqual(cellular(3.2, 4.8, 1));
    expect(cellular(3.2, 4.8, 1)).not.toEqual(cellular(3.2, 4.8, 2));
  });

  it("puts f2 - f1 near zero on a cell boundary and larger inside a cell", () => {
    // This difference IS the crack network: near 0 where two cells meet, large in a plate's middle.
    let onBoundary = 0;
    let interior = 0;
    for (let i = 0; i < 4000; i++) {
      const edge = cellular((i % 64) * 0.25, Math.floor(i / 64) * 0.25, 3);
      if (edge.f2 - edge.f1 < 0.05) onBoundary++;
      if (edge.f2 - edge.f1 > 0.4) interior++;
    }
    expect(onBoundary).toBeGreaterThan(0);
    expect(interior).toBeGreaterThan(onBoundary);
  });
});
```

Append to `packages/client/src/fx/textures.test.ts`:

```ts
describe("cracked crust", () => {
  const env = ENVIRONMENT_FX;

  it("is transparent outside its radius and solid well inside it", () => {
    const { crust } = crackedCrustTexture(5, 128, env);
    // Corners are outside the inscribed circle.
    expect(alphaAt(crust, 1, 1)).toBe(0);
    expect(alphaAt(crust, 126, 126)).toBe(0);
    expect(alphaAt(crust, 64, 64)).toBeGreaterThan(0);
  });

  it("feathers its edge rather than cookie-cutting a circle (LZ34)", () => {
    // The ring states the damage boundary; the crust must not draw a second, competing one.
    const { crust } = crackedCrustTexture(5, 128, env);
    const mid = alphaAt(crust, 64 + 40, 64); // ~0.63r
    const near = alphaAt(crust, 64 + 62, 64); // ~0.97r
    expect(mid).toBeGreaterThan(near);
    expect(near).toBeLessThan(40);
  });

  it("draws seams that are a minority of the disc, and registered to the crust", () => {
    const { crust, seam } = crackedCrustTexture(5, 128, env);
    expect(seam.width).toBe(crust.width);
    let hot = 0;
    let inside = 0;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        if (alphaAt(crust, x, y) === 0) continue;
        inside++;
        if (alphaAt(seam, x, y) > 128) hot++;
      }
    }
    // Cracks between plates, not a sheet of fire. If this ever approaches 1 the cell size or the
    // seam width has run away and the field will read as a solid orange disc.
    expect(hot / inside).toBeGreaterThan(0.02);
    expect(hot / inside).toBeLessThan(0.35);
  });

  it("is greyscale, so every colour stays a live tint rather than a baked one", () => {
    const { seam } = crackedCrustTexture(5, 64, env);
    for (let i = 0; i < seam.data.length; i += 4) {
      if (seam.data[i + 3] === 0) continue;
      expect(seam.data[i]).toBe(seam.data[i + 1]);
      expect(seam.data[i + 1]).toBe(seam.data[i + 2]);
    }
  });

  it("gives different fields different plates", () => {
    const a = crackedCrustTexture(1, 64, env);
    const b = crackedCrustTexture(2, 64, env);
    expect(Array.from(a.seam.data)).not.toEqual(Array.from(b.seam.data));
  });
});
```

Add `crackedCrustTexture` and `ENVIRONMENT_FX` to that file's imports, and `cellular` to the noise test's.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/client/src/fx/noise.test.ts packages/client/src/fx/textures.test.ts`
Expected: FAIL — neither function exists.

- [ ] **Step 3: Add `cellular`**

Append to `packages/client/src/fx/noise.ts`:

```ts
/**
 * Cellular (Worley) noise: the distances to the nearest and second-nearest of a scattered set of
 * feature points, one per integer lattice cell.
 *
 * `f2 - f1` is the value the lava field is built on — it approaches 0 exactly on the boundary
 * between two cells and grows toward the middle of one, which draws a network of closed polygonal
 * plates. `fbm` cannot produce that shape at any octave count: fractal noise gives clouds, and a
 * lava crust is plates.
 *
 * Searches the 3x3 neighbourhood, which is sufficient because every cell holds exactly one point
 * inside its own unit square.
 */
export function cellular(x: number, y: number, seed: number): { f1: number; f2: number } {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = Number.POSITIVE_INFINITY;
  let f2 = Number.POSITIVE_INFINITY;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i;
      const gy = cy + j;
      const px = gx + hash2(gx, gy, seed);
      const py = gy + hash2(gx, gy, seed + 8191);
      const dx = x - px;
      const dy = y - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2 };
}
```

- [ ] **Step 4: Add the `lava` section to `EnvironmentFx`**

In `packages/client/src/fx/environment.ts`, add to the `EnvironmentFx` interface after `occlusion`:

```ts
  /**
   * A lingering lava field (spec LZ28-LZ38). Two stamps per live field: a dark crust of plates at
   * `LAVA_DEPTH`, and the hot cracks between them additively at `GLOW_DEPTH`.
   *
   * **`cells`, `octaves`, `seamWidth` and `featherStart` are baked into the texture** and need the
   * panel's Regenerate button, exactly as `floor.*` does (EV27). Every other field here is live:
   * both textures are generated greyscale and coloured by tint at draw time, which is what keeps
   * the colours tunable without a rebuild.
   */
  readonly lava: {
    /** Plates across the texture. Baked. Higher is a finer crackle. */
    readonly cells: number;
    /** Octaves of grain within a plate. Baked. */
    readonly octaves: number;
    /** How wide a seam is, in cell units, before it falls to nothing. Baked. */
    readonly seamWidth: number;
    /** Fraction of the radius the crust holds full before feathering to 0 at the edge. Baked. */
    readonly featherStart: number;
    readonly crustTint: number;
    readonly crustAlpha: number;
    readonly seamTint: number;
    readonly seamAlpha: number;
    /** Seam brightness cycles per second. 0 freezes it. */
    readonly pulseHz: number;
    /** How much of `seamAlpha` the pulse takes off at its trough, 0-1. */
    readonly pulseDepth: number;
  };
```

And to `ENVIRONMENT_FX` itself, after `occlusion`:

```ts
  lava: Object.freeze({
    cells: 7,
    octaves: 3,
    seamWidth: 0.16,
    featherStart: 0.72,
    crustTint: 0x3a2018,
    crustAlpha: 0.92,
    seamTint: 0xff7a10,
    seamAlpha: 0.85,
    pulseHz: 0.9,
    pulseDepth: 0.25,
  }),
```

- [ ] **Step 5: Add `crackedCrustTexture`**

Append to `packages/client/src/fx/textures.ts`, and add `cellular` to the `./noise.js` import:

```ts
/**
 * A lingering lava field: dark polygonal plates, and the hot cracks between them.
 *
 * Returns TWO textures because they need different blend modes — the crust draws normally at
 * `LAVA_DEPTH`, the seams additively at `GLOW_DEPTH` — and a single texture cannot be both. They are
 * generated in one pass so the seams stay registered to the plates they divide.
 *
 * **Both are greyscale**: RGB carries luminance and the colour arrives as a Phaser tint at draw
 * time, which is what keeps `crustTint`/`seamTint` live knobs rather than Regenerate-only ones.
 *
 * Unlike `asphaltTexture` this does NOT need to tile. The floor is one `tileSprite` repeated across
 * the arena and pays for a closed lattice (EV15); a field is a single stamped disc and has no seam
 * to close. Do not port that requirement across.
 */
export function crackedCrustTexture(
  seed: number,
  size = 192,
  env: EnvironmentFx = ENVIRONMENT_FX,
): { crust: TexturePixels; seam: TexturePixels } {
  const f = env.lava;
  const { data: crust, half } = blank(size);
  const { data: seam } = blank(size);
  const scale = f.cells / size;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = (j * size + i) * 4;
      const r = Math.hypot((i - half) / half, (j - half) / half);
      if (r >= 1) continue;

      // Full inside `featherStart`, ramping to 0 exactly at the rim (LZ34). The ring is what states
      // the damage boundary; a hard-cut disc here would draw a second one competing with it.
      const feather =
        r <= f.featherStart ? 1 : 1 - (r - f.featherStart) / (1 - f.featherStart);

      const { f1, f2 } = cellular(i * scale, j * scale, seed);
      // 1 on a plate boundary, 0 well inside a plate.
      const heat = Math.max(0, 1 - (f2 - f1) / f.seamWidth);

      // Plate grain, so a crust is not a flat fill. Darkened toward a seam: rock next to a crack is
      // in shadow relative to the plate's face, which is what gives the plates depth.
      const grain = fbm(i / 14, j / 14, seed + 131, f.octaves);
      const plate = 90 + grain * 90 - heat * 60;
      crust[k] = plate;
      crust[k + 1] = plate;
      crust[k + 2] = plate;
      crust[k + 3] = 255 * feather;

      if (heat <= 0) continue;
      // Cubed so the bright core of a crack is thin and its shoulders fall away fast. A linear ramp
      // reads as a wide orange smear rather than as molten rock in a gap.
      const glow = heat * heat * heat;
      const v = 255 * glow;
      seam[k] = v;
      seam[k + 1] = v;
      seam[k + 2] = v;
      seam[k + 3] = 255 * glow * feather;
    }
  }

  return {
    crust: { width: size, height: size, data: crust },
    seam: { width: size, height: size, data: seam },
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run packages/client/src/fx/noise.test.ts packages/client/src/fx/textures.test.ts`
Expected: PASS. If the seam-coverage ratio falls outside 0.02–0.35, tune `seamWidth` in `ENVIRONMENT_FX` — **not** the test's bounds; those bounds are the statement that a field reads as cracks rather than as a solid orange disc.

- [ ] **Step 7: Run the full suite and commit**

Run: `npm test`

```bash
git add packages/client/src/fx/noise.ts packages/client/src/fx/noise.test.ts packages/client/src/fx/textures.ts packages/client/src/fx/textures.test.ts packages/client/src/fx/environment.ts
git commit -m "$(cat <<'EOF'
feat(fx): cellular noise and a cracked lava crust texture

f2 - f1 from Worley noise draws closed polygonal plates; fbm cannot, at any
octave count — fractal noise gives clouds and a lava crust is plates.

Two textures rather than one because crust and seams need different blend
modes, generated in one pass so the seams stay registered to their plates.
Both greyscale: colour arrives as a tint at draw time, so every colour stays a
live knob and only geometry needs Regenerate.

Deliberately not tileable — a field is a stamped disc, not a repeated floor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The `lava` panel rows

**Files:**
- Modify: `packages/client/src/fx/env-tuning.ts` (`ENV_FIELDS`)
- Test: `packages/client/src/fx/env-tuning.test.ts` (the existing reachability test does the work)

**Interfaces:**
- Consumes: the `lava` section added in Task 6.
- Produces: ten `ENV_FIELDS` rows.

- [ ] **Step 1: Run the existing test to watch it fail**

Run: `npx vitest run packages/client/src/fx/env-tuning.test.ts`
Expected: FAIL — the reachability test holds `ENV_FIELDS` and `EnvironmentFx` to each other in both directions, so Task 6's ten new knobs are unreachable from the panel and the suite already says so. **This task's failing test was written before the feature existed; do not add a new one.**

- [ ] **Step 2: Add the rows**

Append to `ENV_FIELDS` in `packages/client/src/fx/env-tuning.ts`:

```ts
  // Baked into the texture — these four need the panel's Regenerate button (EV27, LZ38).
  c("lava", "cells", "Plates across", 3, 20, 1, "integer"),
  c("lava", "octaves", "Grain octaves", 1, 6, 1, "integer"),
  c("lava", "seamWidth", "Seam width", 0.02, 0.5, 0.01),
  c("lava", "featherStart", "Feather start", 0.3, 1, 0.01),
  // Live.
  c("lava", "crustTint", "Crust tint", 0, 0xffffff, 1, "color"),
  c("lava", "crustAlpha", "Crust alpha", 0, 1, 0.01),
  c("lava", "seamTint", "Seam tint", 0, 0xffffff, 1, "color"),
  c("lava", "seamAlpha", "Seam alpha", 0, 1, 0.01),
  c("lava", "pulseHz", "Pulse (Hz)", 0, 4, 0.05),
  c("lava", "pulseDepth", "Pulse depth", 0, 1, 0.01),
```

- [ ] **Step 3: Check how the panel marks a non-live knob**

Find how `floor.*` is flagged as Regenerate-only in the settings panel (grep for `floor` in `packages/client/src/dev/`). Apply the same treatment to the four baked `lava` rows. If the flag is a hard-coded list of section names, add `lava`'s four field names to it — do not mark the whole section, since six of its ten knobs are live.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/env-tuning.ts packages/client/src/dev
git commit -m "$(cat <<'EOF'
feat(playground): lava field knobs in the environment panel

Four are baked into the texture and need Regenerate; six are live. Marked per
field rather than per section, because the section is a mix.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The field on the ground

**Files:**
- Modify: `packages/client/src/fx/events.ts` (`FxInstanceView`)
- Modify: `packages/client/src/scenes/ArenaScene.ts` (world-view assembly ~line 2388; the aura branch in `renderShots` ~line 2258)
- Modify: `packages/client/src/fx/layer.ts` (`FX_TEXTURE_KEYS`, `uploadTextures`, `displayObjects`, `update`)
- Test: `packages/client/src/fx/events.test.ts`

**Interfaces:**
- Consumes: `crackedCrustTexture` (Task 6), `LAVA_DEPTH`/`GLOW_DEPTH` (Task 4), `env.lava` (Task 6).
- Produces: `FxInstanceView.isExplosion: boolean` and `FxInstanceView.extent: number`; `FX_TEXTURE_KEYS.lavaCrust` / `.lavaSeam` (three seed variants each, suffixed `0`/`1`/`2`).

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/events.test.ts`:

```ts
describe("the instance view carries what a field needs (LZ36a)", () => {
  it("distinguishes a burst from the shell that threw it", () => {
    const shell = { id: "a", weaponId: "magmablast", x: 0, y: 0, angle: 0, alive: true, isExplosion: false, extent: 0 };
    const field = { id: "b", weaponId: "magmablast", x: 0, y: 0, angle: 0, alive: true, isExplosion: true, extent: 60 };
    // Both are magmablast; only `isExplosion` and `extent` say one is a 60-unit field on the ground
    // and the other a 12-unit shell in the air.
    expect(shell.isExplosion).toBe(false);
    expect(field.extent).toBe(60);
    // The view type must accept both without a cast.
    const view: FxWorldView = { cars: [], instances: [shell, field] };
    expect(view.instances).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/client/src/fx/events.test.ts`
Expected: FAIL — TypeScript rejects `isExplosion` and `extent` as excess properties on `FxInstanceView`.

- [ ] **Step 3: Widen the view**

In `packages/client/src/fx/events.ts`, add to `FxInstanceView`:

```ts
  /**
   * `WeaponInstanceState.isExplosion`. A burst carries its shell's `weaponId`, so without this the
   * layer cannot tell a 60-unit field on the ground from the 12-unit shell that made it.
   */
  readonly isExplosion: boolean;
  /** Current extent — a burst's radius, since one spawns at full extent (P15). */
  readonly extent: number;
```

In `ArenaScene`'s world-view assembly (~line 2388), add both to the mapped object:

```ts
      isExplosion: instance.isExplosion,
      extent: instance.extent,
```

Both are already on `WeaponInstanceState`, so this is a widening of the view and adds no wire field.

- [ ] **Step 4: Generate and upload the crust textures**

In `packages/client/src/fx/layer.ts`, add to `FX_TEXTURE_KEYS`:

```ts
  lavaCrust0: "fx.lava.crust.0",
  lavaCrust1: "fx.lava.crust.1",
  lavaCrust2: "fx.lava.crust.2",
  lavaSeam0: "fx.lava.seam.0",
  lavaSeam1: "fx.lava.seam.1",
  lavaSeam2: "fx.lava.seam.2",
```

In `uploadTextures`, after the asphalt line:

```ts
    // Three variants so consecutive fields from one shooter do not stamp identically (LZ31).
    for (let v = 0; v < LAVA_VARIANTS; v++) {
      const { crust, seam } = crackedCrustTexture(seed + 1301 + v * 97, 192, env);
      this.addTexture(LAVA_CRUST_KEYS[v]!, crust);
      this.addTexture(LAVA_SEAM_KEYS[v]!, seam);
    }
```

At module scope in that file:

```ts
/** How many distinct plate patterns a field may stamp. See LZ31. */
const LAVA_VARIANTS = 3;
const LAVA_CRUST_KEYS = [FX_TEXTURE_KEYS.lavaCrust0, FX_TEXTURE_KEYS.lavaCrust1, FX_TEXTURE_KEYS.lavaCrust2];
const LAVA_SEAM_KEYS = [FX_TEXTURE_KEYS.lavaSeam0, FX_TEXTURE_KEYS.lavaSeam1, FX_TEXTURE_KEYS.lavaSeam2];
```

- [ ] **Step 5: Pool the stamps**

**The stamps are a FIXED POOL allocated in the constructor, not created on demand.** `splitCameras` runs exactly once, during `create` (`ArenaScene.ts:1025`), and takes a one-shot snapshot of `displayObjects()`. An `Image` created mid-match is in that snapshot for no camera: ignored by neither, so it draws twice — once over the HUD gutter, unclipped. `ArenaScene.syncCar` is the one place in the codebase that creates a world object late, and it pays for it with an explicit `this.hudCamera?.ignore(gfx)` — plumbing `FxLayer` through to `hudCamera` to repeat that is strictly worse than not needing it. `FxLayer` is constructed before `splitCameras` runs (see the note at `ArenaScene.ts:919`, which says exactly this about the emitters), so a pool built in the constructor is covered for free.

Add fields to `FxLayer`:

```ts
  /**
   * Every lava stamp this layer will ever use, allocated up front and checked out by instance id.
   *
   * A FIXED pool rather than on-demand creation, because `splitCameras` snapshots
   * `displayObjects()` once during `create` — an Image born later belongs to no camera and draws
   * twice, over the gutter. Building them in the constructor puts them on the display list in time,
   * the same reason the emitters are built there.
   *
   * 12 is the real ceiling: six players, and a 2000 ms field against a 1600 ms cooldown means each
   * can hold at most two at once.
   */
  private readonly lavaPool: { crust: Phaser.GameObjects.Image; seam: Phaser.GameObjects.Image }[] = [];
  /** Which pool slot is drawing which live field, by instance id (LZ36). */
  private readonly lavaFields = new Map<string, number>();
```

In the constructor, after `this.eraser = ...` and before `this.buildEraserTextures()`:

```ts
    for (let i = 0; i < LAVA_POOL_SIZE; i++) {
      const v = i % LAVA_VARIANTS;
      const crust = scene.add
        .image(0, 0, LAVA_CRUST_KEYS[v]!)
        .setDepth(LAVA_DEPTH)
        .setVisible(false);
      const seam = scene.add
        .image(0, 0, LAVA_SEAM_KEYS[v]!)
        .setDepth(GLOW_DEPTH)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false);
      // Set once per object for its whole life — never per frame, and never inside a draw loop.
      // That distinction is the whole of `combat-visual.ts`'s blend-mode warning.
      const rotation = (i * 2.399) % (Math.PI * 2);
      crust.setRotation(rotation);
      seam.setRotation(rotation);
      this.lavaPool.push({ crust, seam });
    }
```

Add a private method:

```ts
  /**
   * Create, move and retire one stamp pair per live lava field.
   *
   * Retirement keys off `alive` going false, NOT off the id leaving the map: the server clears
   * `alive` a tick or more before it deletes the row, so keying off deletion draws a dead field for
   * an extra tick. Same trap `shotEnded` is written around — see `deriveFxEvents`.
   */
  private drawLavaFields(view: FxWorldView, env: EnvironmentFx): void {
    const f = env.lava;
    // One pulse for every field on screen, off the wall clock. Two fields therefore breathe in
    // step, which is the same trade `crackleHz` already takes: it is cosmetic, and nothing reads it.
    const pulse = f.pulseHz <= 0 ? 1 : 1 - f.pulseDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * f.pulseHz * (this.clockMs / 1000)));

    const seen = new Set<string>();
    const taken = new Set(this.lavaFields.values());

    for (const instance of view.instances) {
      if (!instance.isExplosion || !instance.alive) continue;
      seen.add(instance.id);

      let slot = this.lavaFields.get(instance.id);
      if (slot === undefined) {
        // First free slot. A full pool simply draws nothing for the newest field rather than
        // stealing a slot from a live one — a flicker on an extra field is a smaller failure than
        // one field vanishing mid-life, and 12 is already above the reachable ceiling.
        slot = this.lavaPool.findIndex((_, i) => !taken.has(i));
        if (slot < 0) continue;
        taken.add(slot);
        this.lavaFields.set(instance.id, slot);
      }

      const pair = this.lavaPool[slot]!;
      // The texture is 192 px across and covers a diameter of 2 * extent world units.
      const scale = (instance.extent * 2) / 192;
      for (const img of [pair.crust, pair.seam]) {
        img.setVisible(true);
        img.setPosition(instance.x, instance.y);
        img.setScale(scale);
      }
      pair.crust.setTint(f.crustTint).setAlpha(f.crustAlpha);
      pair.seam.setTint(f.seamTint).setAlpha(f.seamAlpha * pulse);
    }

    for (const [id, slot] of this.lavaFields) {
      if (seen.has(id)) continue;
      const pair = this.lavaPool[slot]!;
      // Hidden and returned to the pool, never destroyed: the objects must survive for the life of
      // the scene or they fall out of `splitCameras`'s one-shot snapshot.
      pair.crust.setVisible(false);
      pair.seam.setVisible(false);
      this.lavaFields.delete(id);
    }
  }
```

At module scope in that file:

```ts
/** Live lava fields the pool can draw at once. See `lavaPool` for why this is a fixed number. */
const LAVA_POOL_SIZE = 12;
```

Call it from `update`, before `this.prevView = view;`:

```ts
    this.drawLavaFields(view, env);
```

Add the whole pool to `displayObjects()` — **required for the VFX25 camera split**, and correct precisely because the pool is fixed and already built:

```ts
  displayObjects(): Phaser.GameObjects.GameObject[] {
    const lava = this.lavaPool.flatMap((p) => [p.crust, p.seam]);
    return [...Object.values(this.emitters), this.decals, this.smoke, this.eraser, ...lava];
  }
```

Import `LAVA_DEPTH`, `GLOW_DEPTH`, `crackedCrustTexture` and `Phaser` as needed.

- [ ] **Step 6: Drop the wash from the aura branch**

In `ArenaScene.renderShots`, the aura branch currently fills a 14%-alpha disc and strokes a ring. The crust replaces the wash. Change it to stroke the ring into `glow` and drop the fill:

```ts
      if (shape.kind === "circle" && isAuraInstance(instance)) {
        // The crust the fx layer stamps underneath is the field's body now, so the flat wash that
        // used to stand in for it is gone. The RING stays, and stays here rather than moving to the
        // fx layer with the crust: it is a hitbox statement, and it belongs beside the D19 logic
        // that draws every other instance as exactly the thing that can hit you.
        const fill = weaponFillOf(instance.weaponId);
        (glow ?? gfx).lineStyle(AURA_RING_WIDTH, fill, alpha);
        (glow ?? gfx).strokeCircle(shape.x, shape.y, shape.radius);
        return;
      }
```

`AURA_FILL_ALPHA` is now unused in `ArenaScene`. Leave the constant exported in `combat-visual.ts` only if a test still references it; otherwise delete it and its test.

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS. `combat-visual.test.ts` may assert on `AURA_FILL_ALPHA` — update or remove that case with a comment saying the crust replaced the wash.

- [ ] **Step 8: Verify in the browser**

`npm run dev`, `http://localhost:5173/?dev=playground`. Fire Magma Blast at a wall. Confirm: cracked plates on the ground, glowing seams, cars driving visibly over the field, the ring still legible at exactly the damage boundary, the field fading out at 2 s and leaving no orphaned image. Open the environment panel, confirm the six live `lava` knobs move the look immediately and the four baked ones need Regenerate. Screenshot for the summary.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/fx/events.ts packages/client/src/fx/events.test.ts packages/client/src/fx/layer.ts packages/client/src/scenes/ArenaScene.ts packages/client/src/scenes/combat-visual.ts packages/client/src/scenes/combat-visual.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): stamp a lava field on the ground where magma blast lands

Crust at LAVA_DEPTH, seams additively at GLOW_DEPTH, pooled per instance in
fx/layer.ts — which already owns the pooling, depths, textures and EnvResolver
this needs, none of which renderShots has.

Stamps retire on `alive` going false rather than on the row leaving the map:
the server clears alive a tick before it deletes, so keying off deletion draws
a dead field for an extra frame.

The ring stays in renderShots. It is a hitbox statement and belongs with the
D19 logic; the crust is atmosphere and belongs with the smoke. The 14% wash it
used to sit on is gone — the crust is the field's body now.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Documentation, and the two things to report loudly

**Files:**
- Modify: `docs/combat-model.md` (the **Pierce and per-target damage clocks** section ~line 612, and **Auras** ~line 1008)
- Modify: `CLAUDE.md` (the aura paragraph, and the statuses paragraph naming `corroded`'s source)
- Check: `packages/server/playtest/weapons.ts:490`, `packages/server/playtest/geometry.ts:287`, `packages/server/playtest/weapons2.ts:152`

- [ ] **Step 1: Update `docs/combat-model.md`**

In **Pierce and per-target damage clocks**, add the third mode: an interval, once-ever, and per-entry. State that per-entry inverts the guard order, that presence in the map is the flag, and that absence from the snapshot is not an exit.

In **Auras**, describe the burst as a two-second field: what it costs to cross, that standing in it costs the same as crossing it once, that leaving and returning costs again, and that `corroded` refreshes on each hit because statuses ride the damage list.

- [ ] **Step 2: Update `CLAUDE.md`**

The aura paragraph currently describes the magmablast disc as a detonation. Add that it lingers 2 s and damages once per entry, and name `damageMode` as the knob.

- [ ] **Step 3: Check the three probes compile and still measure what they claim**

Run: `npm run build`

Read `packages/server/playtest/weapons.ts:490` (W9, magmablast's burst through a wall). It reads damage on the far side of a wall from a burst that used to live 5 ticks and now lives 60. **Do not change its threshold or its verdict logic.** Note precisely what it now measures differently.

**If any probe fails to compile, fix it on the spot and say so** — a probe that does not build measures nothing, and leaving it broken is worse than leaving it stale. That is the only probe edit this task authorises.

- [ ] **Step 4: Run everything**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/combat-model.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: the lingering lava field and the third damage-clock mode

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Report these two things in the summary — loudly, not as a footnote**

**Playtest.** Name W9 (`packages/server/playtest/weapons.ts:490`), name what its number was and what it is likely to be now, and **recommend `npm run playtest`**. Do not run it. Do not update the probes. Running it and reading what moved is the user's call; the obligation is that they never learn about it later.

**Balance.** The bot has no concept of a hazard zone — `perceive`/`assess` see poses, HP, reach and big-gun fires, and nothing on the ground. Bots will drive through fields they should go around, so **every `npm run balance` run after this overstates Magma Blast**. Say so before the user reads a win-rate move as a balance fact. The config fingerprint moves with the table, so the harness already refuses cross-change comparison.

---

## Self-Review

**Spec coverage.** LZ1–LZ7 → Task 1. LZ8–LZ13 → Task 2. LZ14–LZ19 → Task 3. LZ20–LZ27 → Tasks 4, 5. LZ28–LZ31, LZ38 → Task 6. LZ32 → Task 4. LZ33–LZ37 → Tasks 7, 8. LZ-A → Task 3 Step 5. LZ-B, LZ-C → Task 9. LZ-D, LZ-E → Task 9.

**Two deliberate deviations from the spec, both recorded here rather than silently taken:**

1. **LZ34 says the ring keeps its 14% wash company; Task 8 deletes the wash.** The crust is the field's body now, and a translucent orange disc under a textured one is two answers to the same question. If the crust ever fails to load, the ring alone still states the boundary.
2. **LZ37 lists `ringWidth` and `ringAlpha` as `lava` knobs; they are not in Task 7.** They are `AURA_RING_WIDTH` and `AURA_FILL_ALPHA` in `combat-visual.ts`, which is weapon-visual code rather than environment code, and moving them would drag the aura constants into `ENVIRONMENT_FX` for one weapon's benefit. Left where they are. If the ring needs tuning, that is a follow-up with its own argument.

**Two problems the review caught and the plan now closes rather than flags:**

1. **`splitCameras` is a one-shot.** It runs once at `ArenaScene.ts:1025` and snapshots `displayObjects()`. The first draft of Task 8 created lava stamps on demand, every one of which would have belonged to no camera and drawn twice over the HUD gutter — a bug that reads as a rendering fault anywhere but its cause. Task 8 now allocates a fixed 12-slot pool in the `FxLayer` constructor, which runs before the split. 12 is the reachable ceiling: six players, and a 2000 ms field on a 1600 ms cooldown means each holds at most two.
2. **`vi.mock` factories are hoisted above `let` declarations.** Task 2's mock now goes through `vi.hoisted`.

**Verified against the code while reviewing**, so the implementer need not re-derive them: `msToTicks(2000) === 60` at 30 Hz; `env-tuning.test.ts`'s reachability case is genuinely bidirectional, so Task 7's failing test already exists and must not be written; `hexToFill` and `isWeaponId` are both already in scope in `combat-visual.ts`; `blank` and `fbm` are both already in scope in `textures.ts`; `WeaponInstanceState` already carries `isExplosion` and `extent`, so Task 8 widens a view rather than the wire.
