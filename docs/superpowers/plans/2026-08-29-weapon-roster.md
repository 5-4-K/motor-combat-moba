# Weapon Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the three chassis its own exclusive three-weapon kit — nine weapons total — by converting `repeater` into `splinter` and authoring seven new `WEAPON_TABLE` rows.

**Architecture:** This is a **config-only** change. No sim logic, no schema, no client rendering code is modified. Every weapon is expressible with fields that already exist on `WeaponDef`, so the entire feature is new rows in `WEAPON_TABLE`, new ids in the `WeaponId` union, and three edited `weapons` arrays in `CAR_TABLE`. The work that is *not* mechanical is updating the eight test sites and four doc passages that currently assert "no car carries this" — several of those claims stop being true, and each must be re-pointed at a weapon that is now real rather than deleted.

**Tech Stack:** TypeScript, npm workspaces, Vitest. All shared config lives in `packages/shared/src/config/`.

**Spec:** [`docs/superpowers/specs/2026-08-29-weapon-roster-design.md`](../specs/2026-08-29-weapon-roster-design.md) — decisions L1–L7 and the solved numbers. Read it before Task 1.

## Global Constraints

- **Durations are authored in milliseconds, never ticks.** `WEAPON_TICKS` converts once at module load with `ceil(ms × TICK_RATE_HZ / 1000)`. `TICK_RATE_HZ` is 30, so one tick is 33.3 ms (D6).
- **Balance numbers live only in `packages/shared/src/config/`.** Never in logic (`CLAUDE.md` invariant 2).
- **Every weapon ships `unlocksAt: 1`.** The level system does not exist (spec constraint 3).
- **`WEAPON_SLOT_CONFIG.maxWeaponSlots` is 3.** Each chassis gets exactly three weapons.
- **Build with root `npm run build`, never `npm run build --workspaces`.** The server's tsup step inlines shared's `dist`, so shared must build first. The root script enforces that order.
- **No sim, schema, or rendering changes.** If a task appears to need one, stop and report — it means a number in the spec is not expressible and the spec is wrong.
- **Nine weapon colours, fixed by the spec.** `fireball` `#E8590C`, `pepperbox` `#B45309`, `afterburner` `#D6336C`, `splinter` `#0CA5B0`, `skewer` `#1864AB`, `lance` `#6741D9`, `thumper` `#495057`, `shockwave` `#5C940D`, `bulwark` `#862E9C`.

## Two guards that will reject wrong numbers

Both live in `packages/shared/src/config/weapon-config.test.ts` and both are already written. They exist to catch exactly the mistakes this plan could make:

1. **The aim-assist cliff.** `AIM_CONFIG.lockTimeoutMs` is 800, so the cliff is 1.25 Hz, and any aim-assist weapon whose `1000 / cooldownMs` is within 15% of it is rejected. **This forbids every `cooldownMs` between 696 and 941 for an aim-assist weapon.** Only `fireball` (500), `splinter` (400) and `thumper` (1000) use aim assist; all three clear it.
2. **Aim assist needs reach.** An aim-assist weapon's `range` must be `>= AIM_CONFIG.lockRange` (400). A third guard separately refuses aim assist on any `attached` beam. Between them, `afterburner` (range 220, attached) and `shockwave` (range 150, attached) are *forced* to `usesAimAssist: false` — this is not a preference.

## File structure

| File | Responsibility | Touched by |
|---|---|---|
| `packages/shared/src/config/weapon-types.ts` | The `WeaponId` union | Tasks 1–4 |
| `packages/shared/src/config/weapon-config.ts` | `WEAPON_TABLE` — every weapon's stats | Tasks 1–4 |
| `packages/shared/src/config/car-config.ts` | `CAR_TABLE` — the three loadouts | Task 5 |
| `packages/shared/src/config/weapon-config.test.ts` | Row validation, the aim-assist guards | Tasks 1–4 |
| `packages/shared/src/config/weapon-ticks.test.ts` | Tick derivation from ms | Task 1 |
| `packages/shared/src/config/weapon-slots.test.ts` | Pins each car's loadout by value | Task 5 |
| `packages/shared/src/sim/weapons/fire.test.ts` | Stock, refire, recovery, burst fixtures | Tasks 1, 2, 3 |
| `packages/shared/src/sim/combat.test.ts` | End-to-end tick, `aimAngleFor` opt-out | Tasks 1, 3 |
| `packages/client/src/assets/asset-keys.test.ts` | Icon key namespacing | Task 1 |
| `packages/client/src/scenes/combat-visual.test.ts` | "a weapon with no authored glow" case | Task 1 |
| `packages/client/src/scenes/weapon-hud.test.ts` | "unknown icon id" case | Task 1 |
| `docs/config-reference.md`, `docs/combat-model.md` | The tables and the coverage claims | Task 6 |

**Nothing on the client needs new code.** `SLOT_KEYS` already binds three slots (Space, Q, E), and `WEAPON_GLOW_STYLES` is a `Partial<Record<WeaponId, GlowStyle>>` — a weapon with no entry draws as a flat fill of its `color`, which is the intended look for all eight new weapons.

## Task ordering and why the build stays green

Tasks 1–4 add weapons to `WEAPON_TABLE` **without putting them on any car**. `WEAPON_TABLE` is `satisfies Record<WeaponId, WeaponDef>`, so a union id with no row fails to compile — id and row must always land in the same commit. But a row with no *car* is perfectly legal (that is what `repeater` has always been). Task 5 is the single commit where the game actually changes.

---

### Task 1: Convert `repeater` into `splinter`

`repeater` exists only as the live reference for the stock mechanic, because `fireball` had to ship single-stock. Oval's slot 1 is a stock weapon, so the reference becomes a weapon players can actually fire (L4). This is a **rename plus a retune** — only the `stock` shape and the teal colour carry over.

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts`
- Modify: `packages/shared/src/config/weapon-config.ts`
- Test: `packages/shared/src/config/weapon-config.test.ts`
- Test: `packages/shared/src/sim/weapons/fire.test.ts`
- Test: `packages/shared/src/sim/combat.test.ts`
- Test: `packages/client/src/assets/asset-keys.test.ts`
- Test: `packages/client/src/scenes/combat-visual.test.ts`
- Test: `packages/client/src/scenes/weapon-hud.test.ts`

**Interfaces:**
- Produces: `WeaponId` gains `"splinter"` and loses `"repeater"`. `WEAPON_TABLE.splinter` is a `ProjectileWeaponDef` with `stock: { max: 3, refireDelayMs: 130 }`, `cooldownMs: 400`, `usesAimAssist: true`. At 30 Hz its derived ticks are **cooldown 12, refireDelay 4, flight 24, recovery 0**.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/config/weapon-config.test.ts`, replace the `"gives the fireball aim assist and leaves the repeater without it"` test with a `splinter` row assertion. Add it directly below the existing `"resolves a def by id"` test:

```ts
  it("ships splinter as the table's multi-stock reference, now carried rather than dormant", () => {
    const splinter = WEAPON_TABLE.splinter;
    expect(splinter.kind).toBe("projectile");
    expect(splinter.damage).toBe(30);
    expect(splinter.cooldownMs).toBe(400);
    expect(splinter.speed).toBe(1100);
    expect(splinter.range).toBe(850);
    expect(splinter.usesAimAssist).toBe(true);
    expect(splinter.stock).toEqual({ max: 3, refireDelayMs: 130 });
    // 400ms is the whole design: tapping one dart sustains 75 DPS, dumping all three puts 90
    // damage out in 260ms and then leaves a 1.2s dry spell. See the spec's derivation rule.
    expect(splinter.damage * (1000 / splinter.cooldownMs)).toBe(75);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts
```

Expected: FAIL — TypeScript error, `Property 'splinter' does not exist on type ...`.

- [ ] **Step 3: Add the id to the union**

In `packages/shared/src/config/weapon-types.ts`, line 2:

```ts
export type WeaponId = "fireball" | "splinter";
```

- [ ] **Step 4: Replace the `repeater` row with `splinter`**

In `packages/shared/src/config/weapon-config.ts`, replace the whole `repeater` block — its doc comment included — with:

```ts
  /**
   * Oval's slot 1, and the table's only multi-stock weapon. It replaced `repeater`, which held this
   * reference role while carried by no car; a reachable reference is strictly better, because stock
   * bugs now surface in matches instead of only in `fire.test.ts`.
   *
   * `cooldownMs: 400` is the entire design and is not a knob to round off. One dart per 400 ms
   * sustains 75 DPS; dumping all three puts 90 damage out in 260 ms and then leaves a 1.2 s dry
   * spell at 62 DPS across the cycle. So tapping wins the long fight and dumping wins the moment,
   * which is the trigger discipline the weapon exists to ask for. At the 1.7 s first drafted for it
   * the weapon sustains 18 DPS against `fireball`'s 100 and is not a viable slot 1.
   */
  splinter: {
    id: "splinter",
    kind: "projectile",
    name: "Splinter",
    color: "#0CA5B0",
    unlocksAt: 1,
    damage: 30,
    damageFrequencyMs: 0,
    speed: 1100,
    range: 850, // >= AIM_CONFIG.lockRange (400), required for usesAimAssist
    startUpMs: 0,
    cooldownMs: 400, // 2.5 Hz, clear of the 1.25 Hz aim-assist cliff by 100%
    recoveryMs: 0, // a go-to never gates another slot (L5)
    usesAimAssist: true,
    hitbox: { shape: "circle", radius: 5 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
    stock: { max: 3, refireDelayMs: 130 },
  },
```

Then update the `WEAPON_TABLE` doc comment above it: the sentence beginning `` `repeater`'s 31 preserves its former 5:8 ratio against fireball `` no longer describes anything. Replace it with:

```
 * `splinter`'s 30 is solved from its own recharge rather than from `fireball`: 30 damage per 400 ms
 * is 75 sustained DPS, three quarters of the anchor, which is where a 1.2x `attack` chassis wants
 * its go-to. See `docs/superpowers/specs/2026-08-29-weapon-roster-design.md`.
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts
```

Expected: the new test PASSES. Other tests in the file may still fail if any referenced `repeater`; the guards (`never lets an aim-assist weapon lock past its own reach`, `keeps aim-assist weapons off the behavioural cliff`, `gives every weapon its own #RRGGBB colour`) must all pass — if the cliff guard fails, the `cooldownMs` is wrong, not the guard.

- [ ] **Step 6: Re-host the stock and refire fixtures in `fire.test.ts`**

In `packages/shared/src/sim/weapons/fire.test.ts`, in `describe("stocks", ...)`, replace the fixture comment and every `"repeater"` with `"splinter"`, and recompute the tick windows — **`splinter`'s cooldown is 12 ticks, not 90**:

```ts
describe("stocks", () => {
  /**
   * `splinter` is the table's only multi-stock weapon: 3 stocks, a 400ms == 12-tick recharge, and a
   * 130ms refire that rounds up to 4 ticks at 30Hz. Oval carries it, so unlike the `repeater` this
   * replaced, every number here is one a player actually experiences.
   */
  const stocked = (): FireState => ({
    slots: [{ weaponId: "splinter", stocks: 1, rechargeEndsTick: 190, refireLockUntilTick: 0 }],
    switchLockUntilTick: 0,
    lastFiredSlot: -1,
    pending: null,
    level: 1,
  });

  it("adds a stock when the timer completes and restarts while below max", () => {
    const state = tickRecharge({ ...stocked() }, 190);
    expect(state.slots[0]!.stocks).toBe(2);
    expect(state.slots[0]!.rechargeEndsTick).toBe(202); // 190 + 12
  });

  it("clears the timer at max stocks rather than banking progress", () => {
    const nearlyFull: FireState = {
      ...stocked(),
      slots: [{ weaponId: "splinter", stocks: 2, rechargeEndsTick: 190, refireLockUntilTick: 0 }],
    };
    const full = tickRecharge(nearlyFull, 190);
    expect(full.slots[0]!.stocks).toBe(3);
    expect(full.slots[0]!.rechargeEndsTick).toBe(0);
  });

  it("starts a fresh full timer when firing from max, however long it sat full", () => {
    const full: FireState = {
      ...stocked(),
      slots: [{ weaponId: "splinter", stocks: 3, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
    };
    const waited = idle(full, 200, 500);
    const fired = releaseShots(beginFire(waited, SLOT_1, 700), 700).state;
    expect(fired.slots[0]!.rechargeEndsTick).toBe(712); // 700 + 12, a whole cooldown, not a shortened one
  });

  it("leaves a running timer untouched when firing below max", () => {
    const running = stocked();
    const fired = releaseShots(beginFire(running, SLOT_1, 100), 100).state;
    expect(fired.slots[0]!.rechargeEndsTick).toBe(190); // the in-flight timer keeps its remaining time
  });
});
```

Then in `describe("refire delay", ...)`, replace the body of the single test:

```ts
  it("refuses a second shot of the same weapon before its refire delay, and allows it once the lock elapses", () => {
    // splinter's refireDelayMs is 130ms, which rounds UP to 4 ticks (133ms) at 30Hz. Two stocks
    // banked so a second press has ammo to spend; only the refire lock, not stock count, is under
    // test here.
    const twoStocks: FireState = {
      slots: [{ weaponId: "splinter", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
      switchLockUntilTick: 0,
      lastFiredSlot: -1,
      pending: null,
      level: 1,
    };
    const firstShot = releaseShots(beginFire(twoStocks, SLOT_1, 100), 100).state;
    expect(firstShot.slots[0]!.refireLockUntilTick).toBe(104); // 100 + 4

    expect(beginFire(firstShot, SLOT_1, 103).pending).toBeNull(); // still locked
    expect(beginFire(firstShot, SLOT_1, 104).pending).not.toBeNull(); // lock has elapsed
  });
```

Leave `describe("the two lockouts", ...)` and `describe("volleys and wind-up", ...)` alone for now — they need `lance` and `pepperbox`, which do not exist yet. They will fail until Tasks 2 and 3. **This is expected**; do not try to fix them here.

- [ ] **Step 7: Re-host the end-to-end tick in `combat.test.ts`**

In `packages/shared/src/sim/combat.test.ts`, replace the `"drives repeater..."` test:

```ts
  it("drives splinter, the table's only multi-stock weapon, through a real tick", () => {
    // Oval carries splinter, so this is now the shipped path rather than a hand-built loadout
    // proving an unreachable weapon. Kept as an explicit fixture anyway: it is the only test that
    // walks the stock mechanic through `runCombat` rather than through `FireState` literals.
    const shooter = player({
      fireMask: 0b001,
      fireState: {
        slots: [{ weaponId: "splinter", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
        switchLockUntilTick: 0,
        lastFiredSlot: -1,
        pending: null,
        level: 1,
      },
    });
    const result = runCombat({
      world: world(),
      players: [shooter],
      instances: [],
      instanceSeq: 0,
    });
    expect(result.instances.map((i) => i.weaponId)).toEqual(["splinter"]);

    const fired = result.players[0]!.fireState;
    expect(fired.slots[0]!.stocks).toBe(1); // one of two spent
    expect(fired.slots[0]!.rechargeEndsTick).toBe(112); // tick 100 + a 400ms cooldown == 12 ticks
    expect(fired.slots[0]!.refireLockUntilTick).toBe(104); // 130ms refire delay == 4 ticks
    expect(fired.switchLockUntilTick).toBe(100); // splinter's recoveryMs is 0 — a go-to never gates
```

Keep whatever assertions follow that block in the existing test.

The `aimAngleFor` opt-out test at the bottom of the file still names `"repeater"`. It needs a `usesAimAssist: false` weapon, and none exists yet in this task — **leave it failing**; Task 3 re-points it at `skewer`.

- [ ] **Step 8: Update the three client test sites**

Each is a plain id swap; none tests `repeater`'s numbers.

In `packages/client/src/assets/asset-keys.test.ts`:

```ts
    expect(weaponIconKey("splinter")).toBe("weapon-icon.splinter");
```

In `packages/client/src/scenes/combat-visual.test.ts`:

```ts
  it("returns nothing for a weapon with no authored look, so it keeps its flat disc", () => {
    // `splinter` is the whole point of this assertion: styles are per weapon, not a shared formula
    // over `color`, so a second weapon must NOT silently inherit the fireball's bands.
    expect(instanceGlowBands("splinter", 3, 0, 0)).toEqual([]);
  });
```

In `packages/client/src/scenes/weapon-hud.test.ts`, in `"does not fall back to any other weapon's icon for an unknown id"`, change the `"repeater"` argument to `"splinter"` — the manifest passed in holds only `weapon-icon.fireball`, so the assertion still means "an id absent from this manifest resolves to undefined".

- [ ] **Step 9: Verify the shared suite, accepting three known failures**

```bash
npm test -w @motor-combat-moba/shared
```

Expected: PASS except `fire.test.ts`'s `"the two lockouts"` and `"volleys and wind-up"` blocks and `combat.test.ts`'s `aimAngleFor` opt-out test, all of which reference weapons that arrive in Tasks 2–3. **If anything else fails, stop and report it** — every other reference to `repeater` should have been covered above.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/config packages/shared/src/sim packages/client/src && git commit -m "feat(shared): convert repeater into splinter, Oval's stock weapon"
```

---

### Task 2: Rectangle's new rows — `pepperbox` and `afterburner`

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts`
- Modify: `packages/shared/src/config/weapon-config.ts`
- Test: `packages/shared/src/config/weapon-config.test.ts`
- Test: `packages/shared/src/sim/weapons/fire.test.ts`

**Interfaces:**
- Produces: `WeaponId` gains `"pepperbox"` and `"afterburner"`. `pepperbox` is the table's **first multi-volley, multi-pellet weapon** (`volleys: 3`, `pelletsPerVolley: 2`); its derived ticks are cooldown 54, volley interval 3, flight 23. `afterburner` is the table's **first beam of any kind** and its first `damageFrequencyMs > 0`; ticks are damageInterval 6, flight 6, and a 2000 ms linger.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/config/weapon-config.test.ts`:

```ts
  it("ships pepperbox as the table's first burst-and-fan weapon", () => {
    const pepperbox = WEAPON_TABLE.pepperbox;
    if (pepperbox.kind !== "projectile") throw new Error("pepperbox must be a projectile");
    expect(pepperbox.volley).toEqual({
      volleys: 3,
      volleyIntervalMs: 100,
      pelletsPerVolley: 2,
      spreadAngleDeg: 10,
    });
    // 6 pellets x 28 = 168 in a 200ms window. Its all-pellets-connect sustained DPS is 83, BELOW
    // fireball's 100 — that is the burst-over-sustained trade, not a bug. See the spec's rule.
    const pellets = pepperbox.volley.volleys * pepperbox.volley.pelletsPerVolley;
    expect(pellets * pepperbox.damage).toBe(168);
    expect(pepperbox.usesAimAssist).toBe(false);
  });

  it("ships afterburner as the table's first beam, attached and ticking", () => {
    const afterburner = WEAPON_TABLE.afterburner;
    if (afterburner.kind !== "beam") throw new Error("afterburner must be a beam");
    expect(afterburner.attached).toBe(true);
    expect(afterburner.lifetimeMs).toBe(2000);
    expect(afterburner.damageFrequencyMs).toBe(200);
    expect(afterburner.hitbox).toEqual({ shape: "cone", angleDeg: 55 });
    // Total life is range/speed + lifetime == 200ms + 2000ms. At one tick per 200ms that is ~11
    // ticks == 286 max, 57% of an average car's 500 hull HP.
    expect(afterburner.range / afterburner.speed + afterburner.lifetimeMs / 1000).toBeCloseTo(2.2);
    // Forced, not chosen: range 220 < AIM_CONFIG.lockRange, and an attached beam re-derives its
    // angle from the owner every tick, so a lock would have nothing to decide.
    expect(afterburner.usesAimAssist).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts
```

Expected: FAIL — `Property 'pepperbox' does not exist on type ...`.

- [ ] **Step 3: Add both ids to the union**

```ts
export type WeaponId = "fireball" | "pepperbox" | "afterburner" | "splinter";
```

- [ ] **Step 4: Add both rows to `WEAPON_TABLE`**

Insert after the `fireball` row:

```ts
  /**
   * Rectangle's slot 2. The table's first multi-volley, multi-pellet weapon, and the first place
   * `volleys` and `pelletsPerVolley` are both > 1.
   *
   * Sequential volleys exit on their own ticks, each from the car's pose AT that tick, so driving
   * straight clusters the six pellets and turning through the burst sprays them across an arc. The
   * skill expression is a consequence of the mechanic, not an added rule.
   *
   * Its all-pellets-connect sustained DPS is 83, deliberately BELOW `fireball`'s 100: a mid weapon
   * buys a chunk of damage inside a window the go-to cannot match (168 in 200 ms against
   * `fireball`'s 1.7 s for the same total), and pays for it in sustained output. Neither dominates.
   */
  pepperbox: {
    id: "pepperbox",
    kind: "projectile",
    name: "Pepperbox",
    color: "#B45309",
    unlocksAt: 1,
    damage: 28, // per pellet; 6 pellets == 168, 34% of an average car
    damageFrequencyMs: 0,
    speed: 800,
    range: 600,
    startUpMs: 0, // a drive-by must be instant
    cooldownMs: 1800,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "circle", radius: 7 },
    pierce: 0,
    volley: { volleys: 3, volleyIntervalMs: 100, pelletsPerVolley: 2, spreadAngleDeg: 10 },
  },
  /**
   * Rectangle's slot 3, and the FIRST BEAM THE GAME HAS EVER SHIPPED. Several paths in
   * `instances.ts` and `instanceDrawShape` run in live play for the first time because of this row.
   *
   * `attached: true` welds its origin and angle to the car every tick, so it sweeps as the driver
   * steers and dies the instant its owner is wrecked. Total life is `range / speed + lifetimeMs`
   * == 2.2 s; at a 200 ms damage interval that is about 11 ticks, 286 damage, 57% of an average car
   * — but only against a target held in the cone for the full duration.
   *
   * `usesAimAssist: false` is FORCED twice over: `range` (220) is below `AIM_CONFIG.lockRange`, and
   * a separate guard refuses aim assist on any attached beam. Do not "fix" this to true.
   *
   * `recoveryMs: 200` is deliberately small (L5). The beam lives on its own once spawned, so the
   * driver stays free to keep firing `fireball` into a target that is already burning.
   */
  afterburner: {
    id: "afterburner",
    kind: "beam",
    name: "Afterburner",
    color: "#D6336C",
    unlocksAt: 1,
    damage: 26, // per tick
    damageFrequencyMs: 200,
    speed: 1100, // extends its 220 range in 200ms
    range: 220,
    startUpMs: 0,
    cooldownMs: 13000,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "cone", angleDeg: 55 },
    attached: true,
    lifetimeMs: 2000,
  },
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts
```

Expected: PASS, including `"refuses aim assist on an attached beam"`, which now has a real row to check for the first time.

- [ ] **Step 6: Re-host the burst fixture in `fire.test.ts`**

`describe("volleys and wind-up", ...)` currently hand-stages a burst because no shipped weapon had `volleys > 1`. `pepperbox` does. Replace the fixture and its comment:

```ts
describe("volleys and wind-up", () => {
  /**
   * `pepperbox` is the table's first real burst: 3 volleys of 2 pellets at a 100ms == 3-tick
   * interval, on a 1800ms == 54-tick cooldown. Before it shipped this fixture had to hand-build the
   * `pending` a press would have produced; it no longer does, so the burst path is now exercised
   * with the numbers a player actually fires.
   */
  const bursting = (nextShotTick: number, shotsLeft: number, rechargeEndsTick = 0): FireState => ({
    slots: [{ weaponId: "pepperbox", stocks: 0, rechargeEndsTick, refireLockUntilTick: 0 }],
    switchLockUntilTick: 0,
    lastFiredSlot: 0,
    pending: { weaponId: "pepperbox", slot: 0, shotsLeft, nextShotTick },
    level: 1,
  });
```

Leave the `drive` helper and the tests below it as they are, then run the block and **read each failure before changing an assertion**. Any hard-coded tick window derived from `repeater`'s 90-tick cooldown must become `pepperbox`'s 54; any derived from its `volleyIntervalMs: 0` floor-of-one-tick must become 3 ticks. If a test fails for a reason you cannot trace to one of those two numbers, stop and report it.

```bash
npm test -w @motor-combat-moba/shared -- src/sim/weapons/fire.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src && git commit -m "feat(shared): add pepperbox and afterburner, the table's first burst and first beam"
```

---

### Task 3: Oval's remaining rows — `skewer` and `lance`

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts`
- Modify: `packages/shared/src/config/weapon-config.ts`
- Test: `packages/shared/src/config/weapon-config.test.ts`
- Test: `packages/shared/src/sim/weapons/fire.test.ts`
- Test: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Produces: `WeaponId` gains `"skewer"` and `"lance"`. `skewer` is the table's first `pierce > 0` and first `ellipse` hitbox; ticks are startUp 8 (250 ms rounds up to 266 ms), cooldown 72, flight 24. `lance` is the first **detached** beam and the roster's only substantial `recoveryMs`; ticks are startUp 21, recovery 30, cooldown 480, flight 6.

- [ ] **Step 1: Write the failing test**

```ts
  it("ships skewer piercing exactly two cars, not three", () => {
    const skewer = WEAPON_TABLE.skewer;
    if (skewer.kind !== "projectile") throw new Error("skewer must be a projectile");
    // `pierce` counts opponents passed through AFTER the first, so 1 == two cars. At `pierce: 2`
    // a 110-damage shot deals 396 on Oval's 1.2x attack and out-damages `lance`, the ultimate.
    expect(skewer.pierce).toBe(1);
    expect(skewer.hitbox).toEqual({ shape: "ellipse", radiusAlong: 22, radiusAcross: 5 });
    expect(skewer.startUpMs).toBe(250);
    expect(skewer.usesAimAssist).toBe(false);
  });

  it("ships lance as a detached beam with the roster's only substantial recovery", () => {
    const lance = WEAPON_TABLE.lance;
    if (lance.kind !== "beam") throw new Error("lance must be a beam");
    expect(lance.attached).toBe(false);
    expect(lance.damage).toBe(180);
    expect(lance.damageFrequencyMs).toBe(0); // one hit per car, not a ticking zone
    expect(lance.startUpMs).toBe(700);
    // The wind-up alone is not the whole cost: a missed lance also owes a second of silence, which
    // is what makes it punishing on a 300 HP chassis (L5).
    expect(lance.recoveryMs).toBe(1000);
    const highest = Math.max(
      ...Object.values(WEAPON_TABLE).map((def) => def.recoveryMs),
    );
    expect(lance.recoveryMs).toBe(highest);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts
```

Expected: FAIL — `Property 'skewer' does not exist on type ...`.

- [ ] **Step 3: Add both ids to the union**

```ts
export type WeaponId =
  | "fireball"
  | "pepperbox"
  | "afterburner"
  | "splinter"
  | "skewer"
  | "lance";
```

- [ ] **Step 4: Add both rows to `WEAPON_TABLE`**

Insert after the `splinter` row:

```ts
  /**
   * Oval's slot 2. The table's first `pierce` and first `ellipse` hitbox.
   *
   * `pierce: 1` is TWO CARS, not one and not three — the field counts opponents passed through
   * after the first. Authoring it as 2 would let a 110-damage shot deal 396 from Oval's 1.2x
   * `attack` and beat `lance`, which is the chassis's actual ultimate.
   *
   * Aim assist is off on purpose rather than by constraint: `range` (1100) clears
   * `AIM_CONFIG.lockRange` easily, so this row COULD take it. Lining two cars up is meant to be the
   * highest-value press in the game, and handing that to the lock would give it away.
   */
  skewer: {
    id: "skewer",
    kind: "projectile",
    name: "Skewer",
    color: "#1864AB",
    unlocksAt: 1,
    damage: 110,
    damageFrequencyMs: 0,
    speed: 1400,
    range: 1100,
    startUpMs: 250, // rounds up to 8 ticks == 266ms at 30Hz
    cooldownMs: 2400,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "ellipse", radiusAlong: 22, radiusAcross: 5 },
    pierce: 1,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Oval's slot 3, and the table's first DETACHED beam: it stamps into the world at its fire-tick
   * pose and never moves again, unlike `afterburner` which rides the car. It is also the only row
   * with a `lifetimeMs` short enough to read as a flash rather than a zone.
   *
   * The 700 ms wind-up leaves a 300 HP chassis standing still and visible, and `recoveryMs: 1000`
   * means a miss also costs a second of silence. That pair is the whole risk budget — `lance` has
   * no lingering presence to fall back on, unlike the roster's other two ultimates, so its
   * commitment has to be paid up front and afterward rather than during (L5).
   */
  lance: {
    id: "lance",
    kind: "beam",
    name: "Lance",
    color: "#6741D9",
    unlocksAt: 1,
    damage: 180, // 36% of an average car; 72% if it catches two
    damageFrequencyMs: 0,
    speed: 6000, // crosses its full 1200 range in 200ms — a flash, not a sweep
    range: 1200,
    startUpMs: 700,
    cooldownMs: 16000,
    recoveryMs: 1000,
    usesAimAssist: false,
    hitbox: { shape: "rect", width: 20 },
    attached: false,
    lifetimeMs: 150,
  },
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Re-host the lockout fixtures in `fire.test.ts`**

`describe("the two lockouts", ...)` was built on `repeater`, which uniquely had **both** a large `recoveryMs` and a `stock` block. **No weapon in the new roster has both** — `lance` has the recovery and no stocks, `splinter` has the stocks and zero recovery — so the fixture now carries one of each and each test presses the slot it needs. Replace the whole `describe` block:

```ts
describe("the two lockouts", () => {
  /**
   * The roster splits the two clocks across two weapons, so the fixture carries both. `lance` in
   * slot 2 owns the recovery (1000ms == 30 ticks) — it is the only row with a substantial one, and
   * `fireball`'s is 0, so a fireball fixture can only prove the gate by hand-setting
   * `switchLockUntilTick`, never that `releaseShots` WRITES it. `splinter` in slot 1 owns the
   * refire delay (130ms == 4 ticks) and has `recoveryMs: 0`, which is itself worth asserting: a
   * go-to must never gate another slot.
   *
   * BOTH clocks are written by `releaseShots` at the tick the shot EXITS — never by `beginFire` at
   * press time (`fire.ts:165,174`). `repeater` hid that distinction because its `startUpMs` was 0,
   * so press and release fell on the same tick. `lance` winds up for 700ms == 21 ticks, so a press
   * at 200 does not release, and does not write the switch lock, until 221. `fireAt` drives that.
   */
  const twoSlots = (): FireState => ({
    slots: [
      { weaponId: "splinter", stocks: 2, rechargeEndsTick: 0, refireLockUntilTick: 0 },
      { weaponId: "lance", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
    ],
    switchLockUntilTick: 0,
    lastFiredSlot: -1,
    pending: null,
    level: 1,
  });

  /** Press `mask` at `pressTick`, then run ticks until the shot actually exits. */
  function fireAt(state: FireState, mask: number, pressTick: number, throughTick: number): FireState {
    let next = beginFire(state, mask, pressTick);
    for (let tick = pressTick; tick <= throughTick; tick++) next = releaseShots(next, tick).state;
    return next;
  }

  const LANCE_EXIT = 221; // pressed at 200; nextShotTick == tick + startUp == 200 + 21

  it("writes the recovery lockout from the weapon that fired, at the tick the shot exits", () => {
    const fired = fireAt(twoSlots(), SLOT_2, 200, LANCE_EXIT);
    expect(fired.pending).toBeNull(); // the wind-up has run out and the beam is away
    expect(fired.switchLockUntilTick).toBe(251); // 221 + 30 ticks == lance's 1000ms recovery
  });

  it("blocks a different slot for the firing weapon's recovery", () => {
    const fired = fireAt(twoSlots(), SLOT_2, 200, LANCE_EXIT);
    expect(beginFire(fired, SLOT_1, 250).pending).toBeNull();
    expect(beginFire(fired, SLOT_1, 251).pending).not.toBeNull();
  });

  it("gates the same slot on its own refire delay, and gates no other slot at zero recovery", () => {
    // splinter's startUpMs is 0, so its shot exits on the press tick and both clocks land at 200.
    const fired = releaseShots(beginFire(twoSlots(), SLOT_1, 200), 200).state;
    expect(fired.slots[0]!.refireLockUntilTick).toBe(204); // 200 + 4
    expect(beginFire(fired, SLOT_1, 203).pending).toBeNull(); // same slot, still inside the lock
    expect(beginFire(fired, SLOT_1, 204).pending).not.toBeNull(); // its own refire delay elapsed
    expect(fired.switchLockUntilTick).toBe(200); // splinter's recoveryMs is 0: no switch lock at all
    expect(beginFire(fired, SLOT_2, 201).pending).not.toBeNull(); // so the other slot is free
  });

  it("holds the switch lock across two slots carrying the SAME weapon id", () => {
    // Reachable from config alone: a car whose `weapons` list repeats an id. Deciding "same weapon"
    // by id would let slot 2 skip the switch lock as "the same weapon" and then find its OWN
    // refireLockUntilTick still at 0 — a free second shot inside the recovery window.
    const duplicate: FireState = {
      ...twoSlots(),
      slots: [
        { weaponId: "lance", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
        { weaponId: "lance", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
      ],
    };
    const fired = fireAt(duplicate, SLOT_1, 200, LANCE_EXIT);
    expect(fired.lastFiredSlot).toBe(0);
    expect(beginFire(fired, SLOT_2, 250).pending).toBeNull(); // a different SLOT, so the switch lock
    expect(beginFire(fired, SLOT_2, 251).pending).not.toBeNull();
  });
});
```

**Do not shortcut `fireAt` back to `releaseShots(beginFire(...), 200)`.** That form works only for a
zero-wind-up weapon; with `lance` it leaves `pending` set and `switchLockUntilTick` at 0, and the
test fails for a reason that has nothing to do with the lockouts.

- [ ] **Step 6b: Restore the aim-assist on/off pair assertion**

Task 1 deleted `weapon-config.test.ts`'s `"gives the fireball aim assist and leaves the repeater without it"` and nothing has replaced it, so the table currently has no test asserting that **both** branches of `usesAimAssist` are populated. `skewer` makes that possible again. Add to `weapon-config.test.ts`:

```ts
  it("keeps both branches of usesAimAssist populated by carried weapons", () => {
    // The pair that makes `usesAimAssist` a real switch rather than a global: one row on, one off.
    // Both are now weapons a player can fire, unlike the fireball/repeater pair this replaced.
    expect(WEAPON_TABLE.fireball.usesAimAssist).toBe(true);
    expect(WEAPON_TABLE.skewer.usesAimAssist).toBe(false);
  });
```

- [ ] **Step 7: Re-host the `aimAngleFor` opt-out in `combat.test.ts`**

At the bottom of `packages/shared/src/sim/combat.test.ts`, update the block comment and the assertion:

```ts
describe("aimAngleFor", () => {
  // Direct coverage of both branches of the per-weapon opt-in (A1). Deleting the `usesAimAssist`
  // check entirely still passes most other tests in this file, so these two call `aimAngleFor`
  // directly. `skewer` is Oval's slot 2 and is `usesAimAssist: false` by design rather than by
  // constraint — its range clears `AIM_CONFIG.lockRange`, so the row could have taken assist and
  // deliberately does not.

  it("returns null for a weapon with usesAimAssist: false, even with a live lock", () => {
```

and inside it:

```ts
    // "skewer" is usesAimAssist: false and exists in WEAPON_TABLE.
    expect(aimAngleFor(a, "skewer", byId)).toBeNull();
```

- [ ] **Step 8: Run the whole shared suite**

```bash
npm test -w @motor-combat-moba/shared
```

Expected: PASS. Every test deferred from Task 1 now has its weapon. If anything still fails, stop and report it.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src && git commit -m "feat(shared): add skewer and lance, completing Oval's kit"
```

---

### Task 4: Hexagon's rows — `thumper`, `shockwave` and `bulwark`

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts`
- Modify: `packages/shared/src/config/weapon-config.ts`
- Test: `packages/shared/src/config/weapon-config.test.ts`

**Interfaces:**
- Produces: `WeaponId` gains `"thumper"`, `"shockwave"` and `"bulwark"`, completing the nine. `thumper` is the third and last aim-assist weapon; ticks are cooldown 30, flight 37. `bulwark` is the only **detached ticking** beam; ticks are damageInterval 12, flight 30, plus a 2500 ms linger.

- [ ] **Step 1: Write the failing test**

```ts
  it("keeps thumper's cooldown clear of the band the aim-assist cliff forbids", () => {
    const thumper = WEAPON_TABLE.thumper;
    expect(thumper.usesAimAssist).toBe(true);
    // The cliff guard rejects any aim-assist weapon within 15% of 1000 / lockTimeoutMs. At
    // lockTimeoutMs 800 that is 1.25 Hz, which forbids EVERY cooldownMs between 696 and 941. The
    // 900ms first drafted for this row sat inside the band and would have failed the suite.
    const forbiddenLow = 1000 / (1.25 * 1.15);
    const forbiddenHigh = 1000 / (1.25 * 0.85);
    expect(thumper.cooldownMs).toBe(1000);
    expect(thumper.cooldownMs).toBeGreaterThan(forbiddenHigh);
    expect(forbiddenLow).toBeLessThan(forbiddenHigh); // the band is a band, not a point
    expect(thumper.hitbox).toEqual({ shape: "circle", radius: 20 });
    expect(thumper.range).toBeGreaterThanOrEqual(AIM_CONFIG.lockRange);
  });

  it("ships bulwark as a detached beam that lingers and ticks", () => {
    const bulwark = WEAPON_TABLE.bulwark;
    if (bulwark.kind !== "beam") throw new Error("bulwark must be a beam");
    expect(bulwark.attached).toBe(false); // stamped into the world, unlike afterburner
    expect(bulwark.lifetimeMs).toBe(2500);
    expect(bulwark.damageFrequencyMs).toBe(400);
    // Total life is range/speed + lifetime == 1s + 2.5s. At one tick per 400ms that is ~8 ticks
    // == 280 max, matching afterburner's ceiling as L6 intends.
    expect(bulwark.range / bulwark.speed + bulwark.lifetimeMs / 1000).toBeCloseTo(3.5);
  });

  it("carries exactly nine weapons, every one a different colour", () => {
    const rows = Object.values(WEAPON_TABLE);
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((def) => def.color.toUpperCase())).size).toBe(9);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts
```

Expected: FAIL — `Property 'thumper' does not exist on type ...`.

- [ ] **Step 3: Add all three ids to the union**

```ts
export type WeaponId =
  | "fireball"
  | "pepperbox"
  | "afterburner"
  | "splinter"
  | "skewer"
  | "lance"
  | "thumper"
  | "shockwave"
  | "bulwark";
```

- [ ] **Step 4: Add all three rows to `WEAPON_TABLE`**

Append after the `lance` row:

```ts
  /**
   * Hexagon's slot 1. A fat, slow slug: the 20-unit radius is the largest hitbox in the table and
   * makes it near-unmissable in a brawl, while 450 u/s over 550 units means 1.2 s of flight and a
   * genuinely dodgeable shot at range. It buys pressure, not a ranged win — but Hexagon is 90 u/s
   * slower than Oval and 225 slower than Rectangle, so without one weapon that reaches at all, the
   * slowest chassis has no answer to a patient opponent.
   *
   * `cooldownMs: 1000` IS CONSTRAINED, not chosen for feel. The aim-assist cliff guard rejects any
   * assisted weapon whose `1000 / cooldownMs` is within 15% of `1000 / AIM_CONFIG.lockTimeoutMs`,
   * which forbids every value between 696 and 941. This row was first drafted at 900 and would have
   * failed the suite. Do not "round it down" to 900 without re-reading that guard.
   */
  thumper: {
    id: "thumper",
    kind: "projectile",
    name: "Thumper",
    color: "#495057",
    unlocksAt: 1,
    damage: 75,
    damageFrequencyMs: 0,
    speed: 450,
    range: 550, // >= AIM_CONFIG.lockRange (400), required for usesAimAssist
    startUpMs: 0,
    cooldownMs: 1000, // 1.0 Hz — 20% clear of the 1.25 Hz cliff
    recoveryMs: 0,
    usesAimAssist: true,
    hitbox: { shape: "circle", radius: 20 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Hexagon's slot 2. The widest hitbox in the game and the shortest-lived: a 140-degree cone that
   * hugs the chassis for a quarter second and hits each car once. It is not aimed so much as
   * triggered — it only needs opponents to be near — which is the point on a chassis that cannot
   * disengage.
   *
   * `usesAimAssist: false` is FORCED, same as `afterburner`: `range` (150) is far below
   * `AIM_CONFIG.lockRange`, and attached beams are refused assist by a separate guard.
   */
  shockwave: {
    id: "shockwave",
    kind: "beam",
    name: "Shockwave",
    color: "#5C940D",
    unlocksAt: 1,
    damage: 100,
    damageFrequencyMs: 0, // one hit per car, not a ticking field
    speed: 1500, // extends its 150 range in 100ms; +150ms linger == 250ms of total life
    range: 150,
    startUpMs: 0,
    cooldownMs: 5000,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "cone", angleDeg: 140 },
    attached: true,
    lifetimeMs: 150,
  },
  /**
   * Hexagon's slot 3, and the table's only DETACHED TICKING beam — the combination that makes it a
   * zone rather than a shot. It stamps into the world and sits there for 3.5 s total, re-arming
   * against anything still inside every 400 ms.
   *
   * The weapon only works because `canDamage` returns false for `ownerId === targetId` and there is
   * no friendly fire: **the owner can park inside their own bulwark.** It is not a symmetric
   * hazard, it is an asymmetric exclusion zone, and that asymmetry is most of the design (L6). Its
   * damage output is secondary to the ground it denies, but it must never read as a safe wall to
   * drive through — 8 ticks is 280, matching `afterburner`'s ceiling.
   */
  bulwark: {
    id: "bulwark",
    kind: "beam",
    name: "Bulwark",
    color: "#862E9C",
    unlocksAt: 1,
    damage: 35, // per tick
    damageFrequencyMs: 400,
    speed: 500, // grows out over a full second, so it is visible before it is dangerous
    range: 500,
    startUpMs: 0,
    cooldownMs: 15000,
    recoveryMs: 200,
    usesAimAssist: false,
    hitbox: { shape: "cone", angleDeg: 60 },
    attached: false,
    lifetimeMs: 2500,
  },
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-config.test.ts
```

Expected: PASS, including the nine-row and nine-colour assertion.

- [ ] **Step 6: Confirm every tick derivation is defined**

`weapon-ticks.test.ts` has a `"covers every weapon in the table and is frozen"` test that loops `WEAPON_TABLE`, so it now covers all nine automatically. Run it to confirm nothing NaNs:

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-ticks.test.ts
```

Expected: PASS with no changes to that file.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src && git commit -m "feat(shared): add thumper, shockwave and bulwark, completing the nine"
```

---

### Task 5: Rewire the three loadouts

**This is the commit where the game changes.** Everything before it added dormant rows.

**Files:**
- Modify: `packages/shared/src/config/car-config.ts`
- Test: `packages/shared/src/config/weapon-slots.test.ts`

**Interfaces:**
- Consumes: all nine ids from Tasks 1–4.
- Produces: `CAR_TABLE[id].weapons` is a three-element array on every chassis, and no weapon id appears on two chassis. `slotsOf("oval")` returns `["splinter", "skewer", "lance"]`.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/config/weapon-slots.test.ts`, replace the `"ships all three cars carrying the migrated fireball in slot 1"` and `"returns the car's list in slot order"` tests with:

```ts
  it("gives each chassis its own exclusive three-weapon kit", () => {
    expect(CAR_TABLE.rectangle.weapons).toEqual(["fireball", "pepperbox", "afterburner"]);
    expect(CAR_TABLE.oval.weapons).toEqual(["splinter", "skewer", "lance"]);
    expect(CAR_TABLE.hexagon.weapons).toEqual(["thumper", "shockwave", "bulwark"]);
  });

  it("shares no weapon between two chassis, so car select is a real choice", () => {
    // L1. Exclusivity is the point of having three chassis: a shared opener would drag all three
    // toward the same early-fight rhythm.
    const all = Object.values(CAR_TABLE).flatMap((car) => [...car.weapons]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("puts every weapon in the table on exactly one chassis", () => {
    const carried = new Set(Object.values(CAR_TABLE).flatMap((car) => [...car.weapons]));
    expect(carried.size).toBe(Object.keys(WEAPON_TABLE).length);
  });

  it("returns the car's list in slot order", () => {
    expect(slotsOf("hexagon")).toEqual(["thumper", "shockwave", "bulwark"]);
  });
```

Add the `WEAPON_TABLE` import at the top of the file:

```ts
import { WEAPON_TABLE } from "./weapon-config.js";
```

The `"truncates an over-long loadout"` and `"does not warn for a loadout inside the limit"` tests pass literal arrays to `slotsFrom`, not `CAR_TABLE` rows, so they need no change.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-slots.test.ts
```

Expected: FAIL — `expected [ 'fireball' ] to deeply equal [ 'fireball', 'pepperbox', 'afterburner' ]`.

- [ ] **Step 3: Rewire `CAR_TABLE`**

In `packages/shared/src/config/car-config.ts`:

```ts
export const CAR_TABLE = {
  rectangle: { id: "rectangle", name: "Rectangle", speed: 80, attack: 30, hp: 40, weapons: ["fireball", "pepperbox", "afterburner"] },
  oval: { id: "oval", name: "Oval", speed: 50, attack: 70, hp: 30, weapons: ["splinter", "skewer", "lance"] },
  hexagon: { id: "hexagon", name: "Hexagon", speed: 30, attack: 50, hp: 70, weapons: ["thumper", "shockwave", "bulwark"] },
} as const satisfies Record<CarId, CarDef>;
```

Extend the table's doc comment with a line naming the new rule:

```
 * `weapons` is the chassis's kit in slot order, and the kits are EXCLUSIVE: no weapon id appears on
 * two chassis (L1). `weapon-slots.test.ts` enforces that, so moving a weapon between chassis means
 * swapping a pair, never copying one.
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -w @motor-combat-moba/shared -- src/config/weapon-slots.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the whole suite, including the client**

```bash
npm test
```

Expected: PASS. `combat.test.ts` derives expected damage through `weaponDamageOf(carId, weaponId)`, so any test pairing a chassis with `"fireball"` that is no longer that chassis's weapon still computes correctly — `weaponDamageOf` does not check the loadout. **If a test fails because it assumed a chassis carries `fireball`, fix the test to name that chassis's actual slot-1 weapon**, and report which test it was.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src && git commit -m "feat(shared): give each chassis its own exclusive three-weapon kit"
```

---

### Task 6: Update the docs the new roster falsifies

Several doc claims are now untrue — not stale phrasing, but statements that actively mislead a reader debugging the sim. `combat-model.md` in particular tells you which paths have never run.

**Files:**
- Modify: `docs/config-reference.md`
- Modify: `docs/combat-model.md`
- Modify: `packages/client/src/scenes/ArenaScene.ts:1145` (a comment only)

- [ ] **Step 1: Find every claim the roster falsifies**

```bash
grep -rn "repeater\|no car carries\|carried by no car\|no shipped weapon\|never yet\|unreachable" docs/combat-model.md docs/config-reference.md packages/client/src/scenes/ArenaScene.ts
```

Every hit is either a `repeater` reference to re-point or a coverage claim to rewrite. Work through the list.

- [ ] **Step 2: Rewrite `docs/config-reference.md`**

Replace the `WEAPON_TABLE` table's two rows with nine, transcribing the values from `weapon-config.ts` — do not retype them from the spec, read them from the code so the doc cannot drift. Replace the `CAR_TABLE` loadout column with the three kits. Delete the whole `**repeater is carried by no car, on purpose — it is not dead config.**` passage and the sentence about `recoveryMs > 0` being uncarried; both describe a table that no longer exists.

- [ ] **Step 3: Rewrite `docs/combat-model.md`**

Three sections need real edits, not find-and-replace:

1. Under `## Weapon`, `Today's whole roster carries a single slot, ["fireball"]` becomes the three exclusive kits.
2. The whole paragraph beginning `` `WEAPON_TABLE` also ships `repeater`, which **no car carries**, on purpose `` is deleted. Replace it with a sentence naming `splinter` as Oval's slot 1 and the table's multi-stock weapon.
3. **The coverage list under "What the tests do and do not reach" is now substantially wrong.** Its claims that beams, non-zero `lifetimeMs`, multi-pellet volleys and `instanceDrawShape`'s beam branch are unreachable in play are all falsified. Rewrite the list to say what is now exercised by a carried weapon and what genuinely remains uncovered.

Also update the sentence `` `repeater` is the table's reference row for `usesAimAssist: false`, as `fireball` is for `true` `` to name `skewer`.

- [ ] **Step 4: Fix the client comment**

`packages/client/src/scenes/ArenaScene.ts:1145` says the one weapon with `recoveryMs > 0` is carried by no car. Oval carries `lance`. Update the comment to match; **change no code in that file**.

- [ ] **Step 5: Verify no stale claim survives**

```bash
grep -rn "repeater" docs/ packages/ --include=*.ts --include=*.md | grep -v "docs/superpowers/plans\|docs/superpowers/specs\|docs/ideas\|docs/invariants\|dist/"
```

Expected: no output. Hits inside `docs/superpowers/specs/` and `docs/superpowers/plans/` are historical records of decisions and **must not be edited** — those documents describe what was true when they were written.

- [ ] **Step 6: Commit**

```bash
git add docs packages/client/src && git commit -m "docs: update the roster, loadouts and coverage claims for the nine weapons"
```

---

### Task 7: Verify the mechanics that have never run in live play

The suites are not sufficient here. Four beams, a pellet fan and a multi-volley burst are shipping into paths that until now had unit tests but no player ever reached. This task is the check that the built server actually runs this code, and that a beam does damage on a real tick.

**Files:**
- Test: `packages/shared/src/sim/combat.test.ts`

- [ ] **Step 1: Add a scenario test driving a beam through `runCombat`**

Append to `packages/shared/src/sim/combat.test.ts`. This is the first test where a beam reaches `runCombat` from a real loadout rather than a hand-built instance.

**A beam cannot damage anyone on its own spawn tick.** `spawnInstances` (`instances.ts`) births every new instance — beam or projectile — at `extent: 0`, and `runCombat`'s phase order steps (grows) an *existing* instance's extent before any new one is born this tick, precisely so a fresh shot draws at the muzzle rather than a tick's travel beyond it. A beam only starts growing on the tick *after* it spawns. A single `runCombat` call therefore can never show spawn-tick beam damage, for any target position or angle — the scenario has to drive several ticks, feeding each tick's output back in as the next tick's input:

```ts
it("damages a target with a real attached beam fired from a real loadout, once it has grown to reach", () => {
  // afterburner is Rectangle's slot 3 and the game's first beam. Its cone is 55 degrees out to
  // 220 units, so a target 100 units directly ahead at angle 0 is inside it once the beam has
  // grown that far. Slot 3 is bit 2. `player` builds its fireState with `newFireState(carId, 1)`,
  // so the slot only exists because Task 5 put three weapons on the chassis — this test is
  // unreachable before that commit.
  //
  // A beam is born at extent 0 (instances.ts's `spawnInstances`) and grows by `speed * dt` per
  // tick — ~36.7 units/tick for afterburner's speed 1100 at 30 Hz — so it cannot damage anyone on
  // its own spawn tick; `runCombat`'s phase order steps an EXISTING instance's extent before new
  // ones are born, precisely so a fresh shot draws at the muzzle rather than a tick's travel
  // beyond it (combat.ts's own module comment). This drives three ticks of `runCombat`, feeding
  // each tick's returned players/instances back in as the next tick's input exactly as `stepSim`
  // does, until the beam's growing extent reaches the target's near edge:
  // muzzle at x = 300 + carWidth/2 = 324; target's near hull edge at x = 400 - carWidth/2 = 376;
  // distance 52. Extent after tick 1 (spawn) is 0; after tick 2, ~36.7 (still short); after tick 3,
  // ~73.3 (past 52) — so the first damage lands on the third call.
  let world_ = world();
  let players: CombatPlayer[] = [
    player("aaa", { x: 300, y: OPEN_Y, angle: 0, fireMask: 0b100 }),
    player("bbb", { x: 400, y: OPEN_Y }),
  ];
  let instances: readonly WeaponInstance[] = [];
  let instanceSeq = 0;
  let result: CombatResult | null = null;

  for (let i = 0; i < 3; i++) {
    result = runCombat({ world: world_, players, instances, instanceSeq });
    // Only the first tick is a press; holding the key does nothing extra here since
    // `cooldownMs: 13000` would reject a second press long before this loop ends.
    players = result.players.map((p) => (p.sessionId === "aaa" ? { ...p, fireMask: 0 } : p));
    instances = result.instances;
    instanceSeq = result.instanceSeq;
    world_ = { ...world_, tick: world_.tick + 1 };
  }

  expect(result!.instances.map((i) => i.weaponId)).toEqual(["afterburner"]);
  const hit = result!.players.find((p) => p.sessionId === "bbb")!;
  // damageFrequencyMs: 200 is 6 ticks at 30 Hz; this loop only runs 3, so exactly one damage tick
  // can have landed. 26 base * scale(0.8 for Rectangle's attack 30 vs baseline 50) = 20.8, rounds
  // to 21 (weaponDamageOf, damage.ts's `damageFor`).
  expect(hit.hp).toBe(hpOf("rectangle") - weaponDamageOf("rectangle", "afterburner"));
});
```

**Two traps in that snippet, both verified against the file:**

- `combat.test.ts` defines **two different `player` helpers**. The file-scope one at line 43 takes `(sessionId, over)`; a second one nested inside a `describe` at line 85 takes `(over)` with the session id baked in. The code above uses the **file-scope** signature, so append this test at file scope — if you put it inside that describe block, the call shape changes.
- Use `OPEN_Y`, not a literal `y`. It is the file's constant for a row of the arena with no obstacle in it; a hand-picked y can put a car in a wall and make the beam clip short for reasons that have nothing to do with the weapon.

- [ ] **Step 2: Run it**

```bash
npm test -w @motor-combat-moba/shared -- src/sim/combat.test.ts
```

Expected: PASS. **A failure here is the important result of this whole plan** — it means a beam does not actually damage anyone through the shipped path, which no existing test could have caught. If it fails, report the failure rather than adjusting the test to match.

- [ ] **Step 3: Build in the correct order and confirm the server bundle is not stale**

```bash
npm run build
```

Then confirm the server bundle really contains the new table — the stale-`dist` failure mode looks exactly like "I changed constants but nothing happened":

```bash
grep -c "afterburner" packages/server/dist/index.js
```

Expected: a non-zero count. If it is 0, shared's `dist` did not make it into the bundle — re-read the "Shared `dist` gotcha" section of `CLAUDE.md` before continuing. Also confirm the bundle inlined *this* checkout's shared and not another one:

```bash
grep -m1 "shared/dist" packages/server/dist/index.js
```

Expected: a path reading `// ../shared/dist/…`. A path reading `// ../../../../../packages/shared/dist/…` means the build escaped into the main checkout and every number above is the wrong build — run `npm install` in this worktree root and rebuild.

- [ ] **Step 4: Smoke-test in the browser**

Start the dev server and confirm the three kits render and fire. This is the only step that exercises `instanceDrawShape`'s beam branch, which has never drawn anything.

Use the Browser pane: `preview_start` with the dev server, join a match, pick each chassis in turn, and fire all three slots (Space, Q, E). Check specifically:

- The HUD draws three slot boxes, not one.
- Each weapon draws in its own colour, and no shot draws in a player colour.
- `afterburner`'s cone follows the car as it turns; `bulwark`'s stays where it was fired.
- `read_console_messages` reports no errors, especially none naming a texture or shape.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src && git commit -m "test(shared): drive a real beam through runCombat from a shipped loadout"
```

---

## Self-review notes

**Spec coverage.** L1 → Task 5. L2 and the derivation rule → the damage and cooldown values in Tasks 1–4, asserted in each row's test. L3 → `fireball` is untouched by every task; its digit-for-digit guard in `weapon-config.test.ts` is deliberately never edited, which is the proof. L4 → Task 1. L5 → `recoveryMs` values in Tasks 1–4, asserted in Task 3's `lance` test. L6 → `bulwark` in Task 4. L7 → the mechanics land across Tasks 1–4 and are verified in Task 7.

**Known deferred failures.** Task 1 knowingly leaves three test blocks red because they need weapons from Tasks 2 and 3. Each is named explicitly at the step that causes it and at the step that fixes it. If the plan is executed out of order, that will not hold.

**The one thing most likely to go wrong.** Task 7 Step 2. Beams have never damaged anyone through `runCombat` from a real loadout, and `combat-model.md` is explicit that `instanceDrawShape`'s beam branch is uncovered. If there is a latent bug anywhere in this feature, it is there — which is why that step says to report a failure rather than adjust the test.
