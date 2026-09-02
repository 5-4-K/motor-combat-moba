# Predator and Magma Blast Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Predator proximity-acquired homing on a lifetime clock and Magma Blast an explosive shell that detonates on any death, then trade the two weapons between Mirage's and Bullseye's slot 1.

**Architecture:** Two new config concepts (`lifetimeMs` hoisted onto projectiles, an `ExplosionDef` sub-def), one new homing acquisition mode resolved in `sim/combat.ts` where the pose list lives, and one new resolution seam (`instanceDefOf`) that hands a synthesized `BeamWeaponDef` to every site that resolves a def from a live instance. The explosion is a real `WeaponInstance` — a detached, centre-origin `disc` beam — which wakes the dormant aura path that is already live and unit-tested in sim and client.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared` / `server` / `client`), Vitest, Colyseus schema, Phaser 3.

**Spec:** [`docs/superpowers/specs/2026-09-02-predator-magmablast-mechanics-design.md`](../specs/2026-09-02-predator-magmablast-mechanics-design.md)

## Global Constraints

These apply to every task. They are not optional and they are not restated per task.

- **Shared is consumed as built `dist`.** After editing `packages/shared`, rebuild before anything outside shared can see the change.
- **Run `npm install` in this worktree before the first build.** A fresh worktree has no `node_modules` and Node walks up to the main checkout's, whose `@motor-combat-moba/shared` symlinks to the *main checkout's* package. Every build then inlines master's sim while all three suites pass on your `src`. Verify by grepping `packages/server/dist/index.js` for the inlined path: `// ../shared/dist/…` is correct, `// ../../../../../packages/shared/dist/…` has escaped the worktree.
- **Build with root `npm run build`, never `npm run build --workspaces`.** The root script enforces shared → server → client; `--workspaces` does not and has been observed building the server before shared.
- **Verify with root `npm test`.** A per-workspace run silently skips the server suite.
- **No magic numbers in logic.** Balance lives in `shared/config` and nowhere else.
- **`TICK_RATE_HZ` is 30** and lives once, in shared. Never write `1/30` or `33.3`.
- **Milliseconds become ticks exactly once**, at module load, in `weapon-ticks.ts`. Never convert at a call site — the two halves of the lockstep must round identically.
- **Enum uint8 values are explicit and stable; never renumber.**
- **Do not touch** `canDamage`, friendly fire, self-damage, the drive model, the OBB hitbox model, or collision-damage rules. Those require asking the user first.
- **`docs/ideas/` and `docs/invariants/` are off limits.** Do not read, cite, or grep them.
- **Commit after every task.** Branch is `claude/predator-magma-blast-mechanics-4b500d`; do not merge or push.

---

### Task 1: Hoist `lifetimeMs` off `BounceDef`

Pure refactor. `thumper` is the only bouncing row in the table, and it must behave identically afterwards. This task exists so Task 3 has a lifetime clock that is not welded to bouncing.

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts` (the `BounceDef` interface and `ProjectileWeaponDef`)
- Modify: `packages/shared/src/config/weapon-config.ts` (`thumper`, ~line 289)
- Modify: `packages/shared/src/config/weapon-ticks.ts` (`bounceLifetime` derivation, ~line 60)
- Modify: `packages/shared/src/sim/weapons/instances.ts` (`spawnInstances` ~line 176, `stepInstance` ~line 259)
- Test: `packages/shared/src/config/weapon-config.test.ts` (the guard at ~line 120)

**Interfaces:**
- Consumes: nothing.
- Produces: `ProjectileWeaponDef.lifetimeMs?: number`; `ProjectileWeaponDef.bounces?: boolean`; `WeaponTicks.projectileLifetime: number` (0 when the row authors no `lifetimeMs`), replacing `WeaponTicks.bounceLifetime`. Note the name: `WeaponTicks.lifetime` is already taken by a beam's post-extension linger, so the projectile clock needs its own.

- [ ] **Step 1: Update the guard test to the narrowed rule**

In `packages/shared/src/config/weapon-config.test.ts`, replace the existing `"bounds a bounce lifetime under its own cooldown, so two instances never coexist"` test with:

```ts
  it("bounds a BOUNCING row's lifetime under its own cooldown, so two never coexist", () => {
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (def.kind !== "projectile" || !def.bounces) continue;
      expect(def.lifetimeMs).toBeDefined();
      expect(def.lifetimeMs!).toBeLessThan(def.cooldownMs);
    }
  });

  it("keeps any authored projectile lifetime positive", () => {
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (def.kind !== "projectile" || def.lifetimeMs === undefined) continue;
      expect(def.lifetimeMs).toBeGreaterThan(0);
    }
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w @motor-combat-moba/shared -- weapon-config`
Expected: FAIL — `def.bounces` and `def.lifetimeMs` do not exist on the type, so this is a compile error, not an assertion failure. That is the correct failure.

- [ ] **Step 3: Change the types**

In `packages/shared/src/config/weapon-types.ts`, delete the `BounceDef` interface entirely and replace the two fields on `ProjectileWeaponDef`:

```ts
  /**
   * Total flight time. When present the shot expires on this clock instead of at `range`, which is
   * what lets a weapon be authored as "no range, just lifetime".
   *
   * Hoisted off the old `BounceDef` (2026-09-02): a bouncing shot needs a clock because `range` is
   * meaningless once it reflects, but a clock is not a fact about bouncing. `predator` uses one
   * without bouncing at all.
   */
  lifetimeMs?: number;
  /**
   * Wall-bouncing flight: reflect off level geometry rather than dying on it. Requires `lifetimeMs`,
   * and `weapon-config.test.ts` holds that lifetime strictly under `cooldownMs` so two bouncing
   * instances of one weapon can never coexist. Absent is false.
   */
  bounces?: boolean;
```

Remove `bounce?: BounceDef;`.

- [ ] **Step 4: Re-author `thumper`**

In `packages/shared/src/config/weapon-config.ts`, replace thumper's line:

```ts
    bounce: { lifetimeMs: 2900 }, // just under the 3000ms cooldown — a second instance can never coexist
```

with:

```ts
    bounces: true,
    lifetimeMs: 2900, // just under the 3000ms cooldown — a second bouncing instance can never coexist
```

Also update thumper's doc comment, which names the old field: change the line reading ``` `bounce: { lifetimeMs: 2900 }` — the shot now expires ``` to ``` `bounces: true` with `lifetimeMs: 2900` — the shot expires ```.

- [ ] **Step 5: Update the tick derivation**

In `packages/shared/src/config/weapon-ticks.ts`, rename the field in the `WeaponTicks` interface:

```ts
  /** Projectile flight clock from `lifetimeMs`; 0 when the row expires at `range` instead. */
  projectileLifetime: number;
```

and in `ticksFor`, replace the `bounceLifetime` line with:

```ts
    projectileLifetime:
      def.kind === "projectile" && def.lifetimeMs !== undefined ? msToTicks(def.lifetimeMs) : 0,
```

- [ ] **Step 6: Update the two `instances.ts` reads**

In `spawnInstances` (~line 176), replace:

```ts
  const bounce = def.kind === "projectile" ? def.bounce : undefined;
  const expiresAt = bounce ? tick + msToTicks(bounce.lifetimeMs) : 0;
```

with:

```ts
  // Any row authoring a lifetime expires on the clock, bouncing or not (spec P28a).
  const lifetime = def.kind === "projectile" ? weaponTicksOf(def.id).projectileLifetime : 0;
  const expiresAt = lifetime > 0 ? tick + lifetime : 0;
```

In `stepInstance` (~line 259), replace `if (def.kind === "projectile" && def.bounce) {` with `if (def.kind === "projectile" && def.bounces) {`.

In `hitsWorld` (`packages/shared/src/sim/combat.ts` ~line 645), replace `|| def.bounce)` with `|| def.bounces)`.

- [ ] **Step 7: Run the full shared suite**

Run: `npm test -w @motor-combat-moba/shared`
Expected: PASS. `thumper`'s behaviour is unchanged — same 2900 ms clock, same reflection — so no behavioural test should move. If one does, the refactor was not pure; stop and investigate rather than editing the test.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src
git commit -m "refactor(shared): hoist projectile lifetimeMs off BounceDef

A flight clock is not a fact about bouncing. `bounce?: BounceDef` becomes
`bounces?: boolean` plus `lifetimeMs?: number` on ProjectileWeaponDef, so a
non-bouncing row can expire on a clock instead of at range. thumper
re-authors identically; the two-instances guard narrows to bouncing rows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Add the homing acquisition mode

Types and guards only. Every existing row authors `acquire: "lock"`, so nothing changes behaviourally. This exists so Task 3's change is a data edit plus one new code path, not a type migration tangled with a behaviour change.

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts` (`HomingDef`)
- Modify: `packages/shared/src/config/weapon-config.ts` (`predator`, ~line 49)
- Test: `packages/shared/src/config/weapon-config.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `HomingDef.acquire: "lock" | "proximity"` and `HomingDef.acquireRadius?: number`.

- [ ] **Step 1: Write the failing guard test**

Append inside the `describe("new-mechanic guards", ...)` block in `weapon-config.test.ts`:

```ts
    it("pairs acquireRadius with proximity acquisition, both ways", () => {
      for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
        if (def.kind !== "projectile" || !def.homing) continue;
        if (def.homing.acquire === "proximity") {
          expect(def.homing.acquireRadius, `${def.id} acquires by proximity`).toBeGreaterThan(0);
        } else {
          expect(def.homing.acquireRadius, `${def.id} acquires by lock`).toBeUndefined();
        }
      }
    });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w @motor-combat-moba/shared -- weapon-config`
Expected: FAIL — `acquire` does not exist on `HomingDef`. A compile error is the correct failure here.

- [ ] **Step 3: Extend `HomingDef`**

In `packages/shared/src/config/weapon-types.ts`, replace the `HomingDef` interface with:

```ts
/** Homing guidance for a projectile (spec: Homing, and 2026-09-02 P1-P9). */
export interface HomingDef {
  /**
   * How this shot finds a target.
   *
   * - `"lock"` — the car's aim-assist lock, frozen at spawn. The shot commits to whatever the
   *   driver had bracketed when they pressed, and needs the aim to have actually resolved.
   * - `"proximity"` — no target at spawn. Each tick the shot takes the nearest eligible car within
   *   `acquireRadius` of ITSELF, then commits to it. The driver aims the launch; the shot finds
   *   the victim.
   *
   * Required rather than defaulted, for the reason `usesAimAssist` is: a homing row must state how
   * it finds things, so a new weapon cannot silently inherit an acquisition rule nobody chose.
   */
  acquire: "lock" | "proximity";
  /**
   * Proximity only: how near a car must come to the SHOT to be grabbed, world units. Required
   * exactly when `acquire: "proximity"` and forbidden otherwise (test-enforced both ways).
   *
   * Deliberately its own number rather than a fraction of `aimRangeUnits`. The two answer different
   * questions — one is how far the driver may bracket, the other is how near the missile must pass —
   * and coupling them means a balance edit to either silently moves the other.
   */
  acquireRadius?: number;
  /** Max steering rate toward the target, degrees per second. The counterplay dial. */
  turnRateDegPerSec: number;
  /** Guidance window after spawn. Afterwards the shot flies straight forever. */
  durationMs: number;
}
```

- [ ] **Step 4: Author the existing row**

In `packages/shared/src/config/weapon-config.ts`, change predator's homing line to:

```ts
    homing: { acquire: "lock", turnRateDegPerSec: 120, durationMs: 1200 },
```

- [ ] **Step 5: Run the shared suite**

Run: `npm test -w @motor-combat-moba/shared`
Expected: PASS, with no behavioural test moving. `acquire: "lock"` is exactly what the code already does.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): give HomingDef an explicit acquisition mode

Every homing row must now say how it finds a target. predator authors
\"lock\", which is what the code already did, so nothing moves. Guards pair
acquireRadius with proximity acquisition in both directions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Proximity acquisition, and Predator's new row

The first behaviour change. Acquisition lives in `sim/combat.ts` because it needs the pose list; `instances.ts` must keep its rule that it never reads player state, and its existing steering integrator is reused untouched.

**Files:**
- Modify: `packages/shared/src/sim/combat.ts` (the instance-step loop, ~lines 322-345)
- Modify: `packages/shared/src/config/weapon-config.ts` (`predator`, ~lines 24-52)
- Modify: `packages/shared/src/config/weapon-slots.test.ts` (~line 65)
- Test: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `HomingDef.acquire` / `acquireRadius` (Task 2), `lifetimeMs` (Task 1).
- Produces: no new exported symbols. The behaviour is internal to `runCombat`.

- [ ] **Step 1: Write the failing behaviour tests**

Append to `packages/shared/src/sim/combat.test.ts`, reusing the file's existing `world()`, `player()` and `find()` helpers (defined at the top — read them before writing).

**The geometry matters and is chosen, not arbitrary.** The bystander sits **150 units** off the flight line. That is past `AIM_CONFIG.lateralMax` (120) *and* outside the 20-degree cone, so the shooter can never lock it — which is what isolates proximity acquisition from aim assist. Any smaller offset and a passing test would prove nothing, because the lock would have steered the shot anyway.

```ts
describe("proximity homing (spec P1-P6)", () => {
  const LIFETIME_TICKS = weaponTicksOf("predator").projectileLifetime;

  /** Fire mirage's slot 1 once and step `ticks` times, returning the last result. */
  function fireAndStep(bystanders: CombatPlayer[], ticks: number): CombatResult {
    let world_ = world();
    let players: CombatPlayer[] = [
      player("aaa", { x: 300, y: OPEN_Y, angle: 0, fireMask: 0b001 }),
      ...bystanders,
    ];
    let instances: readonly WeaponInstance[] = [];
    let instanceSeq = 0;
    let result: CombatResult | null = null;
    for (let i = 0; i < ticks; i++) {
      result = runCombat({ world: world_, players, instances, instanceSeq });
      // Press on the first tick only; a held key would just be rejected by the cooldown anyway.
      players = result.players.map((p) => (p.sessionId === "aaa" ? { ...p, fireMask: 0 } : p));
      instances = result.instances;
      instanceSeq = result.instanceSeq;
      world_ = { ...world_, tick: world_.tick + 1 };
    }
    return result!;
  }

  it("grabs a car that comes within acquireRadius and bends toward it", () => {
    // Bystander 150u off the line: unlockable (lateralMax is 120), so only proximity can find it.
    // The shot leaves the muzzle at x=324 and covers 30u/tick, so it closes to within 200u of
    // (600, 300) around x=520 — roughly tick 7. Ten ticks leaves room to see the turn.
    const result = fireAndStep([player("bbb", { x: 600, y: OPEN_Y + 150 })], 10);
    const shot = result.instances.find((i) => i.weaponId === "predator");
    expect(shot).toBeDefined();
    expect(shot!.homingTargetId).toBe("bbb");
    // Bystander is at +y, so a shot that acquired turns to a positive angle. It launched at 0.
    expect(shot!.angle).toBeGreaterThan(0.1);
  });

  it("ignores a wreck at the same spot", () => {
    const result = fireAndStep([player("bbb", { x: 600, y: OPEN_Y + 150, alive: false })], 10);
    const shot = result.instances.find((i) => i.weaponId === "predator");
    expect(shot!.homingTargetId).toBe("");
    expect(shot!.angle).toBeCloseTo(0, 5);
  });

  it("never grabs its own shooter, whose hull the muzzle sits on", () => {
    // The shot spawns 24u from the shooter's centre — inside its own 200u bubble from tick one.
    // `canDamage` refusing the owner is the only thing stopping it homing on itself immediately.
    const result = fireAndStep([], 4);
    const shot = result.instances.find((i) => i.weaponId === "predator");
    expect(shot!.homingTargetId).toBe("");
    expect(shot!.angle).toBeCloseTo(0, 5);
  });

  it("takes the nearer of two eligible cars", () => {
    const result = fireAndStep(
      [
        player("far", { x: 640, y: OPEN_Y + 190 }),
        player("near", { x: 600, y: OPEN_Y + 150 }),
      ],
      10,
    );
    expect(result.instances.find((i) => i.weaponId === "predator")!.homingTargetId).toBe("near");
  });

  it("commits: it does not re-acquire after its target is wrecked (P5)", () => {
    // Acquire first, then wreck the target and keep stepping. The angle must freeze where it was,
    // not swing to the other car.
    let world_ = world();
    let players: CombatPlayer[] = [
      player("aaa", { x: 300, y: OPEN_Y, angle: 0, fireMask: 0b001 }),
      player("bbb", { x: 600, y: OPEN_Y + 150 }),
      player("ccc", { x: 700, y: OPEN_Y - 150 }),
    ];
    let instances: readonly WeaponInstance[] = [];
    let instanceSeq = 0;
    let result: CombatResult | null = null;
    for (let i = 0; i < 8; i++) {
      result = runCombat({ world: world_, players, instances, instanceSeq });
      players = result.players.map((p) => (p.sessionId === "aaa" ? { ...p, fireMask: 0 } : p));
      instances = result.instances;
      instanceSeq = result.instanceSeq;
      world_ = { ...world_, tick: world_.tick + 1 };
    }
    const acquiredAngle = result!.instances.find((i) => i.weaponId === "predator")!.angle;
    expect(acquiredAngle).toBeGreaterThan(0);

    players = players.map((p) => (p.sessionId === "bbb" ? { ...p, alive: false } : p));
    for (let i = 0; i < 3; i++) {
      result = runCombat({ world: world_, players, instances, instanceSeq });
      instances = result.instances;
      instanceSeq = result.instanceSeq;
      world_ = { ...world_, tick: world_.tick + 1 };
    }
    const after = result!.instances.find((i) => i.weaponId === "predator")!;
    expect(after.homingTargetId).toBe("bbb"); // still committed to the dead one
    expect(after.angle).toBeCloseTo(acquiredAngle, 5); // flying straight from where it was
  });

  it("carries a lifetime clock even though it does not bounce (P28a/P30)", () => {
    const result = fireAndStep([], 1);
    const shot = result.instances.find((i) => i.weaponId === "predator")!;
    expect(LIFETIME_TICKS).toBeGreaterThan(0);
    expect(shot.expiresAtTick).toBe(shot.spawnTick + LIFETIME_TICKS);
  });
});
```

Add `weaponTicksOf` to the file's imports from `../config/weapon-ticks.js`.

**On the last test:** Predator's `range` is authored as exactly `speed x lifetime`, so its range clock and its lifetime clock expire on the same tick by construction (P30) — a survival test cannot tell them apart. Asserting the field is populated is what actually proves the clock is the mechanism, which is why the test is written that way rather than stepping 60 ticks. (It could not survive that long regardless: the arena is 1280 wide and the shot leaves it around tick 32.)

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @motor-combat-moba/shared -- combat`
Expected: FAIL — the shot flies straight, because nothing acquires yet.

- [ ] **Step 3: Add the acquisition scan**

In `packages/shared/src/sim/combat.ts`, inside the instance-step loop (phase 2), replace the `homingOwner` lookup and the `stepInstance` call with:

```ts
    // The locked car's LIVE pose, looked up fresh every tick. For a proximity shot the target is
    // not known at spawn: it is chosen HERE, where the pose list is, so `instances.ts` keeps its
    // rule that it never reads player state (spec P1).
    let targetId = instance.homingTargetId;
    if (targetId === "") {
      targetId = acquireByProximity(instance, players, world.mode);
    }
    const homingOwner = targetId !== "" ? byId.get(targetId) : undefined;
    stepped.push({
      ...stepInstance(instance, {
        dt: world.dt,
        tick: world.tick,
        obstacles: world.obstacles,
        bounds: world.bounds,
        ownerPose: owner ? { x: owner.x, y: owner.y, angle: owner.angle } : null,
        homingTarget:
          homingOwner && isFighting(homingOwner) ? { x: homingOwner.x, y: homingOwner.y } : null,
      }),
      // Commit: once chosen the shot keeps this target for life, and flies straight if it dies
      // (spec P5). Written back here rather than inside `stepInstance` for the same reason the
      // scan is here — the choice is the caller's, the steering is the instance's.
      homingTargetId: targetId,
    });
```

Then add the helper near `hitsWorld` at the bottom of the file:

```ts
/**
 * The nearest car this shot may grab, or `""` for none (spec P1-P4).
 *
 * A full 360-degree bubble around the SHOT — not a cone off the shooter's nose. Eligibility is the
 * same pair of predicates the hit test already uses, so a proximity shot can never chase something
 * it could not have damaged: `canDamage` refuses the owner and teammates, `isTargetable` refuses
 * wrecks and phased cars. No third notion of "valid target" is introduced.
 *
 * Returns `""` for any instance whose weapon does not acquire by proximity, so the caller needs no
 * guard of its own.
 */
function acquireByProximity(
  instance: WeaponInstance,
  players: readonly CombatPlayer[],
  mode: "ffa" | "team",
): string {
  const def = weaponDefOf(instance.weaponId);
  if (def.kind !== "projectile") return "";
  const homing = def.homing;
  if (!homing || homing.acquire !== "proximity") return "";
  const radius = homing.acquireRadius ?? 0;
  if (radius <= 0) return "";

  const radiusSq = radius * radius;
  let bestId = "";
  let bestSq = Number.POSITIVE_INFINITY;
  for (const player of players) {
    if (!isTargetable(player)) continue;
    if (!canDamage(instance.ownerSessionId, instance.ownerTeam, player.sessionId, player.team, mode)) {
      continue;
    }
    const dx = player.x - instance.x;
    const dy = player.y - instance.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > radiusSq || distSq >= bestSq) continue;
    bestSq = distSq;
    bestId = player.sessionId;
  }
  return bestId;
}
```

`isTargetable` is currently declared inside `runCombat`. Lift it to a module-level function beside `isFighting` so the helper can use it — it reads only the player, so the lift is mechanical. Import `canDamage` from `./weapons/targets.js` if `combat.ts` does not already.

- [ ] **Step 4: Run and watch them pass**

Run: `npm test -w @motor-combat-moba/shared -- combat`
Expected: PASS.

- [ ] **Step 5: Rewrite Predator's row**

In `packages/shared/src/config/weapon-config.ts`, replace the `predator` entry and its doc comment:

```ts
  /**
   * Mirage's slot 1 until the 2026-09-02 pass moves it to Bullseye: the proximity seeker. It leaves
   * the muzzle as an ordinary fast dart aimed by the lock, carries no target, and grabs the first
   * eligible car to come within 200 u of ITSELF — then chases that one until it hits something or
   * its 2 s clock runs out.
   *
   * It has no range in any sense a player experiences: `range` is authored as `speed x lifetime`
   * (900 x 2 s) purely because `WEAPON_TICKS.flight`, the guide's reach figure and the
   * `range >= aimRangeUnits` validator all read it. At 1800 the flight count is exactly the
   * lifetime, so the two clocks cannot disagree. That clears arena-01's 1469 u diagonal; it would
   * not clear arena-02's, so "no range" is a statement about the shipped arena, not the engine.
   *
   * `turnRateDegPerSec: 300` is the counterplay dial. Turn radius is `speed / turnRate`, so at
   * 900 u/s this arcs at 172 u — tight enough to convert a 200 u grab. The old 120 deg/s would arc
   * at 430 u and sail past everything it acquired. ⚙
   *
   * 3.33 Hz, 167% clear of the 1.25 Hz aim cliff, and its 2 s life on a 300 ms cooldown means up to
   * seven in the air at once — which is why the two-instances guard is scoped to bouncing rows.
   */
  predator: {
    id: "predator",
    kind: "projectile",
    name: "Predator",
    color: "#D63A14",
    unlocksAt: 1,
    damage: 25,
    damageFrequencyMs: 0,
    speed: 900,
    range: 1800, // = speed x lifetimeMs; see the comment above for why this is authored at all
    startUpMs: 0,
    cooldownMs: 300,
    recoveryMs: 0,
    usesAimAssist: true,
    aimRangeUnits: 800,
    hitbox: { shape: "capsule", radiusAlong: 14, radiusAcross: 6 },
    pierce: 0,
    lifetimeMs: 2000,
    homing: { acquire: "proximity", acquireRadius: 200, turnRateDegPerSec: 300, durationMs: 2000 },
    volley: { volleys: 1, volleyIntervalMs: 0 },
    pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
```

Note the deleted `applies` — "Effect: none" (spec P11).

- [ ] **Step 6: Fix the aim-range test that this breaks**

`packages/shared/src/config/weapon-slots.test.ts` line ~65 asserts `carAimRangeOf(id)` is 400 for every chassis. Predator now authors 800. Replace that test with:

```ts
  it("is the longest assisted reach on each chassis", () => {
    // Mirage and Bastion carry only 400 u assisted rows. Predator authors 800, which lifts the
    // whole car's acquisition range — carAimRangeOf returns the MAX across assisted slots, so one
    // long-reaching weapon re-ranges the car's ambient lock (spec: Bullseye's lock doubles).
    expect(carAimRangeOf("mirage")).toBe(800);
    expect(carAimRangeOf("bullseye")).toBe(400);
    expect(carAimRangeOf("bastion")).toBe(400);
  });
```

Predator is still on Mirage at this point in the plan — Task 8 does the swap, and flips these two expectations. That transient is deliberate: it keeps the mechanism change and the roster change in separate reviewable commits.

- [ ] **Step 7: Run the whole shared suite**

Run: `npm test -w @motor-combat-moba/shared`
Expected: PASS. Watch specifically for the aim-cliff guard (3.33 Hz is 167% clear, fine) and the "every status reachable from some weapon" test — `corroded` was only on predator, so **this test should now FAIL**. Do not fix it here by re-adding the status. Task 5 gives `corroded` its new home on Magma Blast's explosion, and that is where this test goes green again.

If it is red at the end of this task, that is expected and correct. Note it in the commit message so a reviewer is not surprised.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): predator acquires by proximity on a lifetime clock

The shot spawns with no target and grabs the nearest eligible car within
200u of itself, then commits. Acquisition lives in combat.ts where the pose
list is, so instances.ts keeps its rule that it never reads player state;
the existing steering integrator is reused untouched.

Also: 25 dmg / 300ms / 900 u/s, aim range 800, 2s lifetime, corroded
dropped. The status-reachability test is RED until task 5 rehomes corroded
onto magmablast's explosion.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `ExplosionDef` and the `instanceDefOf` seam

Config layer only. Magma Blast authors an explosion but nothing spawns one yet, so this task is pure capability with no behaviour change.

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts`
- Modify: `packages/shared/src/config/weapon-config.ts` (`magmablast`, and a new `instanceDefOf` export)
- Modify: `packages/shared/src/config/weapon-ticks.ts`
- Modify: `packages/shared/src/index.ts` (export `instanceDefOf`)
- Test: `packages/shared/src/config/weapon-config.test.ts`, `packages/shared/src/config/weapon-ticks.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-3.
- Produces:
  - `ExplosionDef { radius: number; damage: number; lingerMs: number; applies?: readonly StatusApplication[] }`
  - `ProjectileWeaponDef.explosion?: ExplosionDef`
  - `instanceDefOf(weaponId: WeaponId, isExplosion: boolean): WeaponDef`
  - `WeaponTicks.explosion: { flight: number; lifetime: number; damageInterval: number; applyDurations: readonly number[] } | null`

- [ ] **Step 1: Write the failing tests**

In `weapon-config.test.ts`:

```ts
  describe("explosions (spec P22-P27)", () => {
    it("requires a positive radius and something to do", () => {
      for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
        if (def.kind !== "projectile" || !def.explosion) continue;
        expect(def.explosion.radius, def.id).toBeGreaterThan(0);
        expect(def.explosion.lingerMs, def.id).toBeGreaterThan(0);
        const doesSomething =
          def.explosion.damage > 0 || (def.explosion.applies?.length ?? 0) > 0;
        expect(doesSomething, `${def.id}'s explosion must do something`).toBe(true);
      }
    });

    it("targets only opponents — self is refused by canDamage, ownerInside is a zone concept", () => {
      for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
        if (def.kind !== "projectile" || !def.explosion) continue;
        for (const a of def.explosion.applies ?? []) {
          expect(a.target, `${def.id}'s explosion`).toBe("opponents");
        }
      }
    });

    it("resolves an explosion instance to a real disc beam def, and never to another explosion", () => {
      const burst = instanceDefOf("magmablast", true);
      expect(burst.kind).toBe("beam");
      expect(burst.id).toBe("magmablast");
      expect(burst.color).toBe(WEAPON_TABLE.magmablast.color);
      if (burst.kind !== "beam") throw new Error("unreachable");
      expect(burst.hitbox).toEqual({ shape: "disc" });
      expect(burst.origin).toBe("center");
      expect(burst.attached).toBe(false);
      expect(burst.usesAimAssist).toBe(false);
      expect(burst.range).toBe(WEAPON_TABLE.magmablast.explosion!.radius);
      expect(burst.damage).toBe(WEAPON_TABLE.magmablast.explosion!.damage);
      expect(burst.damageFrequencyMs).toBe(0);
      // P25a: a BeamWeaponDef has no `explosion` field, so a burst cannot spawn a burst.
      expect("explosion" in burst).toBe(false);
    });

    it("returns the plain def when the instance is not an explosion", () => {
      expect(instanceDefOf("magmablast", false)).toBe(WEAPON_TABLE.magmablast);
    });

    it("synthesizes once, so the def is referentially stable", () => {
      expect(instanceDefOf("magmablast", true)).toBe(instanceDefOf("magmablast", true));
    });
  });
```

In `weapon-ticks.test.ts`:

```ts
  it("derives an explosion's ticks, with flight pinned at one tick (spec P25b)", () => {
    const ticks = weaponTicksOf("magmablast").explosion;
    expect(ticks).not.toBeNull();
    expect(ticks!.flight).toBe(1);
    expect(ticks!.lifetime).toBe(msToTicks(WEAPON_TABLE.magmablast.explosion!.lingerMs));
    expect(ticks!.damageInterval).toBe(Number.POSITIVE_INFINITY);
    expect(ticks!.applyDurations).toEqual([msToTicks(2000)]);
  });

  it("leaves explosion ticks null for a weapon with no explosion", () => {
    expect(weaponTicksOf("predator").explosion).toBeNull();
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @motor-combat-moba/shared -- weapon-config weapon-ticks`
Expected: FAIL — `explosion` and `instanceDefOf` do not exist.

- [ ] **Step 3: Add `ExplosionDef`**

In `packages/shared/src/config/weapon-types.ts`, above `ProjectileWeaponDef`:

```ts
/**
 * An area effect left where a projectile died (spec P13-P21).
 *
 * It is spawned as a real `WeaponInstance` — a detached, centre-origin `disc` beam — rather than
 * resolved inline, so it inherits every rule already written for instances: the per-target damage
 * clock, damage frozen at spawn, friendly fire, status application, networking and rendering. The
 * synthesis lives in `instanceDefOf`.
 *
 * There is deliberately no damage-frequency knob. A burst hits each car once, ever; a repeating
 * explosion is a different feature and should be argued for on its own terms rather than arriving
 * as a field nobody chose a value for.
 */
export interface ExplosionDef {
  /** Radius of the field, world units. It is the synthesized beam's `range`. */
  radius: number;
  /** Damage to every car caught, before chassis and status scaling. */
  damage: number;
  /**
   * How long the field persists. Mostly for the eye, but not only: the per-target clock is
   * once-ever, so a car that drives in during the linger is caught.
   */
  lingerMs: number;
  /**
   * Statuses the field applies. `opponents` only — `self` means the shooter, whom `canDamage`
   * refuses, and `ownerInside` is a presence buff for a zone the owner stands in, which a brief
   * burst at a remote impact point is not. Guarded in `weapon-config.test.ts`.
   */
  applies?: readonly StatusApplication[];
}
```

Add to `ProjectileWeaponDef`:

```ts
  /** Detonate on ANY death — enemy, wall, bounds or max range (spec P13). */
  explosion?: ExplosionDef;
```

- [ ] **Step 4: Author Magma Blast's explosion**

In `packages/shared/src/config/weapon-config.ts`, add to the `magmablast` entry (stats stay as they are for now; Task 5 changes them):

```ts
    explosion: {
      radius: 60,
      damage: 15,
      lingerMs: 150,
      applies: [{ statusId: "corroded", target: "opponents", durationMs: 2000 }],
    },
```

- [ ] **Step 5: Write `instanceDefOf`**

At the bottom of `packages/shared/src/config/weapon-config.ts`, below `weaponDefOf`:

```ts
/**
 * The def that describes one LIVE instance — which is not always its weapon's own row.
 *
 * A weapon's explosion is spawned as an instance carrying its parent's `weaponId`, so a plain
 * `weaponDefOf` lookup would describe the shell when the thing in the world is the burst: a
 * 12-unit dart where a 60-unit disc belongs, and — worse — a `def.explosion` that is still
 * populated, so the burst's own expiry would spawn another burst, every tick, forever (P25a).
 *
 * Routing every instance-side lookup through here makes that unrepresentable rather than merely
 * unlikely: what comes back for a burst is a `BeamWeaponDef`, and a `BeamWeaponDef` has no
 * `explosion` field for the recursion to read.
 */
export function instanceDefOf(id: WeaponId, isExplosion: boolean): WeaponDef {
  if (!isExplosion) return WEAPON_TABLE[id];
  const burst = BURST_DEFS[id];
  if (!burst) throw new Error(`instanceDefOf: ${id} authors no explosion`);
  return burst;
}

/**
 * Synthesized once at module load, not per call, so the returned def is referentially stable and
 * free — the same reasoning as `WEAPON_TICKS`.
 *
 * The fields a `WeaponDef` requires but an explosion has no opinion about are fixed here rather
 * than left to the author. `id` and `color` are the PARENT's: the burst is Magma Blast in every
 * lookup keyed by weapon, and only its shape and stats differ. The fire-control clocks are inert —
 * a burst is spawned, never fired — and take the parent's values rather than zeroes, so a future
 * reader who does reach for one finds a coherent number instead of a trap.
 */
const BURST_DEFS: Partial<Record<WeaponId, BeamWeaponDef>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(WEAPON_TABLE) as WeaponId[])
      .map((id) => [id, WEAPON_TABLE[id]] as const)
      .filter(([, def]) => def.kind === "projectile" && def.explosion !== undefined)
      .map(([id, def]) => {
        const parent = def as ProjectileWeaponDef;
        const blast = parent.explosion!;
        const burst: BeamWeaponDef = {
          id: parent.id,
          kind: "beam",
          name: parent.name,
          color: parent.color,
          unlocksAt: parent.unlocksAt,
          damage: blast.damage,
          // Once per car, ever. See ExplosionDef for why there is no knob.
          damageFrequencyMs: 0,
          // Derived so `WEAPON_TICKS.flight` is exactly one tick (P25b): a beam expires at
          // `flight + lifetime`, so a small speed here would give a burst that outlives the match.
          // Growth itself is irrelevant — the instance is spawned at full extent.
          speed: blast.radius * TICK_RATE_HZ,
          range: blast.radius,
          startUpMs: parent.startUpMs,
          cooldownMs: parent.cooldownMs,
          recoveryMs: parent.recoveryMs,
          usesAimAssist: false,
          hitbox: { shape: "disc" },
          attached: false,
          origin: "center",
          lifetimeMs: blast.lingerMs,
          volley: { volleys: 1, volleyIntervalMs: 0 },
          ...(blast.applies ? { applies: blast.applies } : {}),
        };
        return [id, Object.freeze(burst)] as const;
      }),
  ),
);
```

Import `TICK_RATE_HZ` from `../constants.js` and the `BeamWeaponDef` / `ProjectileWeaponDef` types from `./weapon-types.js`.

- [ ] **Step 6: Derive the explosion's ticks**

In `packages/shared/src/config/weapon-ticks.ts`, add to the `WeaponTicks` interface:

```ts
  /**
   * The burst's own tick counts, or `null` for a weapon that authors no explosion. A parallel
   * record rather than a second `WeaponTicks`, because most of a weapon's clocks (start-up,
   * cooldown, volley interval) are meaningless for something that is spawned rather than fired.
   */
  explosion: {
    flight: number;
    lifetime: number;
    damageInterval: number;
    applyDurations: readonly number[];
  } | null;
```

and in `ticksFor`, derive it from the same synthesized def so the two can never disagree:

```ts
    explosion:
      def.kind === "projectile" && def.explosion
        ? Object.freeze({
            // 1 by construction: `instanceDefOf` synthesizes `speed` as `radius * TICK_RATE_HZ`
            // precisely so `range / speed` is one tick (P25b). Written as the literal rather than
            // as `radius / (radius * TICK_RATE_HZ) * TICK_RATE_HZ`, which is the same number
            // spelled unreadably.
            flight: 1,
            lifetime: msToTicks(def.explosion.lingerMs),
            damageInterval: Number.POSITIVE_INFINITY,
            applyDurations: Object.freeze(
              (def.explosion.applies ?? []).map((a) =>
                msToTicks(Math.min(a.durationMs, STATUS_CONFIG.maxDurationMs)),
              ),
            ),
          })
        : null,
```

- [ ] **Step 7: Export it**

In `packages/shared/src/index.ts`, add `instanceDefOf` to the existing `weapon-config.js` export line and `ExplosionDef` to the `weapon-types.js` type exports.

- [ ] **Step 8: Run the tests**

Run: `npm test -w @motor-combat-moba/shared -- weapon-config weapon-ticks`
Expected: PASS. The status-reachability test from Task 3 may now also go green if it reads `explosion.applies` — it does not yet, so expect it still red. Task 5 fixes it.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): add ExplosionDef and the instanceDefOf seam

An explosion is authored on its parent projectile row and resolved to a
real disc-hitbox BeamWeaponDef, synthesized once at load. Routing every
instance-side def lookup through instanceDefOf is what stops a burst from
spawning a burst: the synthesized def has no explosion field to read.

Nothing spawns one yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Detonation, and Magma Blast's new row

**Files:**
- Modify: `packages/shared/src/sim/weapons/instances.ts` (`WeaponInstance`, `stepInstance` def default)
- Modify: `packages/shared/src/sim/weapons/hits.ts` (~lines 48, 52)
- Modify: `packages/shared/src/sim/combat.ts` (the survivor loop, ~lines 458-502; `hitsWorld` ~line 644; `applyOpponentStatuses` ~line 715)
- Modify: `packages/shared/src/config/weapon-config.ts` (`magmablast` stats and its stale colour comment)
- Test: `packages/shared/src/sim/combat.test.ts` (the burst is built in `combat.ts`'s `detonate`, so its coverage belongs here rather than in `instances.test.ts`)

**Interfaces:**
- Consumes: `instanceDefOf` and `WeaponTicks.explosion` (Task 4).
- Produces: `WeaponInstance.isExplosion: boolean`, and an internal `detonate(instance, x, y, tick, seq)` in `combat.ts`.

- [ ] **Step 1: Write the failing tests**

In `combat.test.ts`. **Magma Blast is still on Bullseye at this point in the plan** — Task 8 does the swap — so these fire `carId: "bullseye"` with `fireMask: 0b001`. Note that the file's `player()` helper hardcodes `hp: hpOf("mirage")` regardless of `carId`, so pass `hp` explicitly rather than trusting the default.

**The contact and the splash land on different ticks.** The shell dies on tick N and the burst is appended to the survivor list; the burst hit-tests on N+1. Every test below therefore steps one tick past the impact.

```ts
describe("magma blast detonation (spec P13-P21)", () => {
  const BULLSEYE_HP = hpOf("bullseye");
  const CONTACT = weaponDamageOf("bullseye", "magmablast");

  function shooter(over: Partial<CombatPlayer> = {}): CombatPlayer {
    return player("aaa", { carId: "bullseye", hp: BULLSEYE_HP, fireState: newFireState("bullseye", 1), ...over });
  }

  /** Fire bullseye's slot 1 from `from` and step `ticks` times. */
  function fire(
    from: Partial<CombatPlayer>,
    others: CombatPlayer[],
    ticks: number,
    obstacles: CombatWorld["obstacles"] = [],
  ): CombatResult {
    let world_ = world({ obstacles });
    let players: CombatPlayer[] = [shooter({ ...from, fireMask: 0b001 }), ...others];
    let instances: readonly WeaponInstance[] = [];
    let instanceSeq = 0;
    let result: CombatResult | null = null;
    for (let i = 0; i < ticks; i++) {
      result = runCombat({ world: world_, players, instances, instanceSeq });
      players = result.players.map((p) => (p.sessionId === "aaa" ? { ...p, fireMask: 0 } : p));
      instances = result.instances;
      instanceSeq = result.instanceSeq;
      world_ = { ...world_, tick: world_.tick + 1 };
    }
    return result!;
  }

  const bursts = (r: CombatResult) => r.instances.filter((i) => i.isExplosion);

  it("costs a directly-hit car contact PLUS splash, and corrodes it (P16)", () => {
    // Muzzle at x=324, shell at 600 u/s = 20 u/tick, target hull's near edge at 400-24=376.
    // Contact around tick 4; one more tick for the burst to resolve.
    const result = fire(
      { x: 300, y: OPEN_Y, angle: 0 },
      [player("bbb", { x: 400, y: OPEN_Y, hp: BULLSEYE_HP })],
      7,
    );
    const victim = find(result, "bbb");
    // Strictly MORE than contact alone — that difference is the splash, and it is the whole point.
    expect(victim.hp).toBeLessThan(BULLSEYE_HP - CONTACT);
    expect(victim.statuses.some((s) => s.id === "corroded")).toBe(true);
  });

  it("spawns exactly one burst per shot, already at full extent (P13a/P15)", () => {
    const result = fire(
      { x: 300, y: OPEN_Y, angle: 0 },
      [player("bbb", { x: 400, y: OPEN_Y, hp: BULLSEYE_HP })],
      6,
    );
    expect(bursts(result)).toHaveLength(1);
    // Full size on the tick it forms, not grown into over several. This is what makes the
    // direct-hit test above deterministic rather than a race with the victim driving away.
    expect(bursts(result)[0]!.extent).toBe(WEAPON_TABLE.magmablast.explosion!.radius);
    expect(bursts(result)[0]!.kind).toBe("beam");
  });

  it("never damages its own shooter, even detonating on its nose (P18)", () => {
    // A wall directly in front of the muzzle: the shell dies almost immediately and the 60u field
    // certainly covers the shooter. `canDamage` refusing the owner is the only thing saving them.
    const result = fire({ x: 300, y: OPEN_Y, angle: 0 }, [], 6, [
      { x: 340, y: OPEN_Y - 100, w: 40, h: 200 },
    ]);
    expect(bursts(result).length).toBeGreaterThan(0);
    expect(find(result, "aaa").hp).toBe(BULLSEYE_HP);
  });

  it("detonates at the PRE-step pose on a wall, never inside it (P14)", () => {
    const box = { x: 600, y: OPEN_Y - 100, w: 240, h: 200 };
    const result = fire({ x: 300, y: OPEN_Y, angle: 0 }, [], 20, [box]);
    const burst = bursts(result)[0];
    expect(burst).toBeDefined();
    // The shell crossed into the box on the tick it died; the burst belongs on the near side.
    expect(burst!.x).toBeLessThan(box.x);
  });

  it("reaches a car on the far side of a wall, because a disc has no wall clip (P17)", () => {
    // Thin wall so the far car sits inside the 60u radius of a burst forming on the near face.
    const wall = { x: 600, y: OPEN_Y - 100, w: 20, h: 200 };
    const result = fire(
      { x: 300, y: OPEN_Y, angle: 0 },
      [player("bbb", { x: 650, y: OPEN_Y, hp: BULLSEYE_HP })],
      20,
      [wall],
    );
    expect(find(result, "bbb").hp).toBeLessThan(BULLSEYE_HP);
  });

  it("detonates at max range with nothing hit at all", () => {
    // No obstacles, no other cars, aimed along open floor. The shell dies on its range and must
    // still leave a burst.
    const ticks = weaponTicksOf("magmablast").flight + 3;
    const result = fire({ x: 100, y: OPEN_Y, angle: 0 }, [], ticks);
    // It leaves the arena before its range clock in this arena, which is itself a P13 death — the
    // rule is "any removal detonates", so a bounds kill counts exactly the same.
    expect(bursts(result).length + result.instances.length).toBeGreaterThan(0);
  });

  it("does not spawn another burst when the burst itself expires (P25a)", () => {
    // THE RECURSION GUARD. If the detonation check read weaponDefOf rather than instanceDefOf, the
    // burst would see magmablast's `explosion` on its own expiry and spawn another, every tick,
    // forever. The instance list must drain to empty instead.
    const result = fire(
      { x: 300, y: OPEN_Y, angle: 0 },
      [player("bbb", { x: 400, y: OPEN_Y, hp: BULLSEYE_HP })],
      60,
    );
    expect(result.instances).toHaveLength(0);
  });
});
```

Add `newFireState` and `weaponTicksOf` to the imports if they are not already there.

**On the max-range test:** in `arena-01` a shell fired from x=100 reaches the arena edge before its 900 u range, so that case is a bounds kill rather than a range kill. Both are removals and P13 makes no distinction, which is exactly why the assertion is written loosely. Do not "fix" it by moving the shooter — a tighter arena-dependent placement is more fragile, not more correct.

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @motor-combat-moba/shared -- combat`
Expected: FAIL — no burst is ever spawned.

- [ ] **Step 3: Add the instance flag and route the def lookups**

In `packages/shared/src/sim/weapons/instances.ts`, add to the `WeaponInstance` interface:

```ts
  /**
   * This instance is its weapon's EXPLOSION, not its shell (spec P22-P27). Frozen at spawn.
   *
   * It carries the parent's `weaponId`, so this flag is the only thing separating the two, and
   * every def lookup for a live instance must go through `instanceDefOf` rather than `weaponDefOf`.
   */
  isExplosion: boolean;
```

Set `isExplosion: false` in the object literal `spawnInstances` builds, and change both `def` parameter defaults in that file from `weaponDefOf(instance.weaponId)` to `instanceDefOf(instance.weaponId, instance.isExplosion)`.

In `packages/shared/src/sim/weapons/hits.ts`, change line ~48 to `const def = instanceDefOf(instance.weaponId, instance.isExplosion);` and line ~52's `weaponTicksOf(instance.weaponId).damageInterval` to read the explosion sub-record when the flag is set:

```ts
  const ticks = weaponTicksOf(instance.weaponId);
  const interval = instance.isExplosion
    ? ticks.explosion!.damageInterval
    : ticks.damageInterval;
```

Do the same for `instanceExpired` in `instances.ts`, whose beam branch reads `ticks.flight + ticks.lifetime`:

```ts
  const ticks = weaponTicksOf(instance.weaponId);
  const life = instance.isExplosion
    ? ticks.explosion!.flight + ticks.explosion!.lifetime
    : ticks.flight + ticks.lifetime;
  return tick - instance.spawnTick >= life;
```

In `combat.ts`, `hitsWorld` (~line 644) and `applyOpponentStatuses` (~line 715) both do `weaponDefOf(instance.weaponId)` / `weaponTicksOf(instance.weaponId).applyDurations`. Route both through the instance-aware lookups the same way. `applyOpponentStatuses` takes a `weaponId` today; change its signature to take the instance (or a `(weaponId, isExplosion)` pair) so a burst applies the EXPLOSION's `corroded` and not the shell's absent list.

- [ ] **Step 4: Write `detonate` and wire the three removal sites**

In `combat.ts`, add beside `acquireByProximity`:

```ts
/**
 * The burst one dying shot leaves behind, or `null` if its weapon authors no explosion.
 *
 * Born at FULL extent rather than growing from zero (spec P15). That is what makes "a direct hit
 * costs contact plus splash" true without a timing race: the car that stopped the shell is inside
 * the field on the very tick it forms, rather than a tick or two later once it has grown out.
 *
 * Damage is re-derived from the burst's own def and the owner's chassis, and frozen here for the
 * same reason a shell's is frozen at the muzzle: it must be answerable at impact without reading
 * player state, and the shooter may be wrecked before the field expires.
 */
function detonate(
  shell: WeaponInstance,
  x: number,
  y: number,
  tick: number,
  seq: number,
  owner: CombatPlayer | undefined,
): { burst: WeaponInstance; seq: number } | null {
  const def = instanceDefOf(shell.weaponId, shell.isExplosion);
  if (def.kind !== "projectile" || !def.explosion) return null;
  const burstDef = instanceDefOf(shell.weaponId, true);
  const next = seq + 1;
  return {
    seq: next,
    burst: {
      id: `${shell.ownerSessionId}-${next}`,
      ownerSessionId: shell.ownerSessionId,
      ownerTeam: shell.ownerTeam,
      finalWave: shell.finalWave,
      // `weaponDamageOf` reads the weapon ROW's damage — the shell's 50, not the burst's 15 — so
      // it is the wrong helper here. `damageFor` takes an explicit base, which is what a burst
      // needs. Do not widen `weaponDamageOf` to mean two things.
      damage: owner
        ? scaleDamage(
            damageFor(CAR_TABLE[carIdOf(owner)].attack, burstDef.damage),
            modsOf(owner.sessionId).damageDealt,
          )
        : burstDef.damage,
      weaponId: shell.weaponId,
      kind: "beam",
      x,
      y,
      angle: 0,
      extent: burstDef.range,
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
    },
  };
}
```

Import `damageFor` from `./damage.js` and `CAR_TABLE` from `../config/car-config.js` if `combat.ts` does not already have them.

Then in the survivor loop, replace each of the three bare `continue`s:

```ts
  const survivors: WeaponInstance[] = [];
  const bursts: WeaponInstance[] = [];
  for (const instance of stepped) {
    const before = previous.get(instance.id) ?? instance;
    const owner = byId.get(instance.ownerSessionId);

    if (instanceExpired(instance, world.tick)) {
      const blast = detonate(instance, instance.x, instance.y, world.tick, instanceSeq, owner);
      if (blast) { bursts.push(blast.burst); instanceSeq = blast.seq; }
      continue;
    }
    if (hitsWorld(instance, before, world)) {
      // P14: the PRE-step pose. `hitsWorld` fires when the swept hull CROSSED a boundary, so the
      // post-step point can be inside a wall or off the field entirely.
      const blast = detonate(instance, before.x, before.y, world.tick, instanceSeq, owner);
      if (blast) { bursts.push(blast.burst); instanceSeq = blast.seq; }
      continue;
    }

    // ... existing resolveInstanceHits block, unchanged ...

    if (outcome.instance.alive) {
      survivors.push(outcome.instance);
    } else {
      const blast = detonate(instance, instance.x, instance.y, world.tick, instanceSeq, owner);
      if (blast) { bursts.push(blast.burst); instanceSeq = blast.seq; }
    }
  }
  survivors.push(...bursts);
```

The `before` and `owner` lookups move ABOVE the expiry check, since all three sites need them. Bursts are collected separately and appended after the loop so they are not iterated by the loop that created them — a burst must not be hit-tested on its own spawn tick before every shell has resolved.

- [ ] **Step 5: Run and watch them pass**

Run: `npm test -w @motor-combat-moba/shared -- combat instances hits`
Expected: PASS.

- [ ] **Step 6: Rewrite Magma Blast's stats and comment**

In `weapon-config.ts`, set `damage: 50`, `cooldownMs: 1000`, `speed: 600`, and replace the doc comment:

```ts
  /**
   * Bullseye's slot 1 until the 2026-09-02 pass moves it to Mirage: the explosive shell. It flies
   * as an ordinary aimed dart and detonates on ANY death — a car, a wall, the arena edge, or its
   * own 900 u range — leaving a 60 u corroding field for 150 ms.
   *
   * A direct hit costs contact AND splash, 65 base plus the corrode: the burst is born at full
   * extent on the tick the shell dies, so the car that stopped it is standing inside it. Excluding
   * the victim would have made a perfect shot the one way to not apply your own weapon's effect.
   *
   * The field passes through level geometry, and that is not a special case: a `disc` has no axis
   * for the wall raycast to follow, so it never had a clip to skip. A car hugging the far side of
   * a wall within 60 u takes the splash.
   *
   * 1.0 Hz sits 20% clear of the 1.25 Hz aim cliff — it passes the guard's 15% floor, but it is the
   * tightest margin in the table. Do not retune this cooldown toward 800 ms without re-reading that
   * guard.
   */
```

Also fix the stale palette comment on the `color` line (spec P32 — the colour itself stays):

```ts
    // Kept as authored through the 2026-09-02 move to Mirage. It reads navy against a fire-orange
    // icon, which `npm run check:weapons` warns about; that drift is a known, deliberate deferral
    // rather than an oversight, and warnings never fail the suite.
    color: "#22579E",
```

Predator's `color` line loses its `// fireball's ember — Mirage's palette` comment in Task 3's rewrite for the same reason: the palette claim stops being true the moment the weapon changes chassis.

- [ ] **Step 7: Teach the status-reachability test about explosions**

In `weapon-config.test.ts`, the `"keeps every status in the table reachable from some weapon"` test reads top-level `applies` only. `corroded` now lives ONLY inside `magmablast.explosion.applies`, so the test must union both sources:

```ts
    const reachable = new Set<StatusId>();
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      for (const a of def.applies ?? []) reachable.add(a.statusId);
      // An explosion's statuses are reachable too — corroded's only source since 2026-09-02.
      if (def.kind === "projectile") {
        for (const a of def.explosion?.applies ?? []) reachable.add(a.statusId);
      }
    }
```

- [ ] **Step 8: Run the whole shared suite**

Run: `npm test -w @motor-combat-moba/shared`
Expected: PASS, including the status-reachability test that Task 3 left red.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): magmablast detonates on any death

A dying shell leaves a full-extent disc burst at its death point — pre-step
pose for a world kill, since hitsWorld fires on a CROSSING and the post-step
point can be inside the wall. Exactly one burst per shot: the loop's
early-exits are preserved rather than collecting reasons.

Direct hit is contact plus splash plus corroded, and the field crosses walls
because a disc never had a raycast to clip. 50 dmg / 1000ms / 600 u/s.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Network the flag

**Files:**
- Modify: `packages/shared/src/schema/WeaponInstanceState.ts`
- Modify: `packages/server/src/sim/combat-bridge.ts:258-269`
- Test: `packages/shared/src/schema/schema.test.ts`

**Interfaces:**
- Consumes: `WeaponInstance.isExplosion` (Task 5).
- Produces: `WeaponInstanceState.isExplosion: boolean`.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/schema/schema.test.ts`, beside the existing `WeaponInstanceState` defaults test:

```ts
  it("defaults isExplosion to false", () => {
    expect(new WeaponInstanceState().isExplosion).toBe(false);
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -w @motor-combat-moba/shared -- schema`
Expected: FAIL — property does not exist.

- [ ] **Step 3: Add the field**

In `WeaponInstanceState.ts`, after `kind`:

```ts
  /**
   * This row is its weapon's explosion rather than its shell (spec P27).
   *
   * On the wire because the client resolves a def from `weaponId`, which names the parent — a
   * projectile — so without this it would draw a 12 u dart where a 60 u disc belongs. Deriving it
   * instead (a row whose `kind` disagrees with its def's `kind` can only be an explosion) is true
   * today and rots the first time another weapon spawns a child instance.
   *
   * Frozen at spawn, so it is written on row creation and never patched after.
   */
  @type("boolean") isExplosion = false;
```

- [ ] **Step 4: Write it in the bridge**

In `packages/server/src/sim/combat-bridge.ts`, inside the `if (!row)` block (frozen-at-spawn fields only, beside `kind` and `spawnTick`):

```ts
      row.isExplosion = instance.isExplosion;
```

- [ ] **Step 5: Rebuild shared, then run everything**

```bash
npm run build -w @motor-combat-moba/shared && npm test
```

Expected: PASS. The server suite imports built shared for its bridge tests, which is why the rebuild comes first.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src packages/server/src
git commit -m "feat(schema): network WeaponInstanceState.isExplosion

The client resolves a def from weaponId, which names the parent projectile,
so a burst needs one bit to be drawn as the disc it is. Written once at row
creation, like kind and spawnTick.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Draw the explosion

The aura render path is already live and unit-tested — a ring on the hitbox edge plus a low-alpha wash — and was left in place for exactly this. The work is routing the def lookup, not writing a renderer.

**Files:**
- Modify: `packages/client/src/scenes/combat-visual.ts` (`DrawableInstance` ~line 158, `instanceDrawShape` ~line 886, `projectileDrawLayers` ~line 608, `beamGrownExtent` ~line 551, `isAuraWeapon` ~line 1062)
- Modify: `packages/client/src/scenes/ArenaScene.ts:1663-1692`
- Test: `packages/client/src/scenes/combat-visual.test.ts:375`

**Interfaces:**
- Consumes: `instanceDefOf` (Task 4), `WeaponInstanceState.isExplosion` (Task 6).
- Produces: `DrawableInstance.isExplosion: boolean`; `isAuraWeapon(weaponId)` becomes `isAuraInstance(instance: DrawableInstance)`.

- [ ] **Step 1: Write the failing tests**

In `combat-visual.test.ts`:

```ts
  it("draws a magmablast burst as its disc, not as the shell's dart", () => {
    const burst: DrawableInstance = {
      weaponId: "magmablast", isExplosion: true, x: 100, y: 100, angle: 0, extent: 60,
    };
    const shape = instanceDrawShape(burst, 0);
    expect(shape.kind).toBe("circle");
    expect(shape).toMatchObject({ x: 100, y: 100, radius: 60 });
    expect(isAuraInstance(burst)).toBe(true);
  });

  it("still draws the shell as a projectile", () => {
    const shell: DrawableInstance = {
      weaponId: "magmablast", isExplosion: false, x: 100, y: 100, angle: 0, extent: 0,
    };
    expect(isAuraInstance(shell)).toBe(false);
  });
```

Line ~375's existing `expect(beamDrawLayers("magmablast", 0, 0, 0, 100, 0)).toEqual([])` asserts magmablast is not a beam. It still passes — `beamDrawLayers` takes a bare `weaponId` and magmablast's own def is a projectile — but its comment claims no shipped weapon has a disc hitbox. Update the comment: a disc ships again, as an explosion, reached through `isAuraInstance` rather than through this function.

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @motor-combat-moba/client -- combat-visual`
Expected: FAIL — `isExplosion` is not on `DrawableInstance`, `isAuraInstance` does not exist.

- [ ] **Step 3: Extend `DrawableInstance` and route the lookups**

Add `isExplosion: boolean;` to the interface with a one-line comment pointing at the schema field's reasoning.

Replace every `isWeaponId(x) ? weaponDefOf(x) : null` in `instanceDrawShape` and `projectileDrawLayers` with a shared local helper:

```ts
/**
 * The def describing one drawable instance — the parent row, or its synthesized burst def. Mirrors
 * the sim's `instanceDefOf` (spec P24); a burst carries the parent's `weaponId`, so a bare
 * `weaponDefOf` would draw the shell's 12 u dart where a 60 u disc belongs.
 */
function drawDefOf(instance: DrawableInstance): WeaponDef | null {
  if (!isWeaponId(instance.weaponId)) return null;
  return instanceDefOf(instance.weaponId, instance.isExplosion);
}
```

Replace `isAuraWeapon(weaponId: string)` with:

```ts
export function isAuraInstance(instance: DrawableInstance): boolean {
  const def = drawDefOf(instance);
  return def?.kind === "beam" && def.hitbox.shape === "disc";
}
```

`beamGrownExtent(weaponId, extent, elapsedMs)` also resolves a def by bare id and would grow the burst using the shell's speed. Change it to take the instance. A burst is spawned at full extent and its synthesized speed exists only to make the expiry clock read one tick, so growth extrapolation must be skipped for it entirely — return `extent` unchanged when `instance.isExplosion`.

- [ ] **Step 4: Update the two ArenaScene call sites**

`ArenaScene.ts:1673` becomes `isAuraInstance(instance)`, and `:1692`'s `beamDrawLayers(...)` call passes the instance through the new signature. The instances ArenaScene builds from `state.weapons` must now carry `isExplosion` — find where the `DrawableInstance` objects are constructed from schema rows and add the field.

- [ ] **Step 5: Run the client suite**

Run: `npm test -w @motor-combat-moba/client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src
git commit -m "feat(client): draw a magmablast burst as its disc

Routes the client's def lookups through instanceDefOf so a burst resolves
to its synthesized beam def rather than the parent shell's projectile row.
isAuraWeapon(weaponId) becomes isAuraInstance(instance) — the answer now
depends on which instance it is, not just which weapon.

The ring-and-wash aura renderer itself is unchanged; it was left live for
exactly this.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Swap the loadouts

**Files:**
- Modify: `packages/shared/src/config/car-config.ts:52-53`
- Modify: `packages/shared/src/config/weapon-slots.test.ts` (~lines 17, 65)
- Modify: `packages/shared/src/config/weapon-config.test.ts` (the Bullseye-reach test, ~line 323; the magmablast dart test, ~line 315)
- Modify: `packages/shared/src/config/aim-config.ts` (the `AIM_CONFIG` doc comments)
- Test: the above.

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: no new symbols.

- [ ] **Step 1: Update the kit and aim-range tests first**

In `weapon-slots.test.ts`, the `"gives each chassis the kit its type calls for"` test pins the loadouts — update Mirage to `["magmablast", "thunderclap", "afterburner"]` and Bullseye to `["predator", "pepperbox", "lance"]`. Then flip the aim-range expectations from Task 3:

```ts
    expect(carAimRangeOf("mirage")).toBe(400);   // magmablast 400, thunderclap 400
    expect(carAimRangeOf("bullseye")).toBe(800); // predator's 800 re-ranges the whole car
    expect(carAimRangeOf("bastion")).toBe(400);
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @motor-combat-moba/shared -- weapon-slots`
Expected: FAIL — the table still has the old kits.

- [ ] **Step 3: Swap the table**

In `packages/shared/src/config/car-config.ts`, swap the first entry of each list:

```ts
  mirage: { ..., weapons: ["magmablast", "thunderclap", "afterburner"], isActive: true },
  bullseye: { ..., weapons: ["predator", "pepperbox", "lance"], isActive: true },
```

- [ ] **Step 4: Fix the two weapon-config tests whose meaning changed**

- `"ships magmablast as a plain single-shot dart, no longer even the retired aura's old id"` — it is not a plain dart any more. Rewrite it to assert the explosive shell: single volley, single pellet, and a populated `explosion`.
- `"keeps Bullseye's straight-line reach further than anything Bastion carries"` — Bullseye's longest straight reach is now Predator's 1800. Confirm the assertion still holds and that its comment does not name a stale weapon; the guard excludes `thumper` as a bounced path length, and that exclusion still applies.

- [ ] **Step 5: Rewrite the stale prose in `aim-config.ts`**

No test can see any of this, so it must be done by reading. Three passages name numbers this pass moved:

1. `"327 units at magmablast's 900 unit range"` — magmablast's range is still 900, so the arithmetic survives, but check the sentence still reads correctly now that the weapon is Mirage's.
2. The lead-error paragraph on `lockRange`: `"at mirage's 576 top speed over magmablast's 900"` — magmablast's speed is now **600**, and Mirage carries it, so the ratio changes from 0.64 to 0.96 and the "hittable inside roughly 44 units" figure moves with it. Recompute and rewrite; do not leave the old number.
3. The `lockTimeoutMs` paragraph calls magmablast `"the fastest aim-assisted weapon in the roster today"` at 1.67 Hz. Predator at 3.33 Hz now holds that, and magmablast has dropped to 1.0 Hz — which is 20% clear of the cliff, the tightest margin in the table. Say so.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: everything passes EXCEPT `scripts/manual-page.test.mjs`, which fails because `balanceStamp` has moved. That is expected and Task 10 fixes it; the failure names the command to run.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): trade predator and magmablast between chassis

Mirage takes the explosive shell, Bullseye the proximity seeker; slot 1 both
times, so slot bits and HUD ordering are untouched. Bullseye's ambient lock
doubles to 800 as a consequence — carAimRangeOf returns the max across a
car's assisted slots.

Also rewrites the three passages in aim-config.ts that argued the lock range
from magmablast's old speed and fire rate by name. No test can see prose.

manual-page.test.mjs is RED until task 10 rebuilds the guide.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Fix the playtest probes

Not part of the test suite and not part of the release build, but a probe that does not compile measures nothing. **Compile fixes and invalidated expectations only — do not invent new scenarios or new probe files.**

**Files:**
- Modify: `packages/server/playtest/geometry.ts:230,287,290`
- Modify: `packages/server/playtest/weapons.ts:275,495,580`
- Modify: `packages/server/playtest/weapons2.ts:149,256,304`

- [ ] **Step 1: Find every break**

```bash
npx tsc --noEmit -p packages/server/playtest/tsconfig.json
```

Every `slotBitFor("bullseye", "magmablast")` is now a wrong pairing. Repoint each to the chassis that actually carries the weapon the probe is measuring: `slotBitFor("mirage", "magmablast")`, or `slotBitFor("bullseye", "predator")` where the probe's intent was Bullseye's slot 1 rather than that specific weapon. **Read each probe's surrounding scenario to decide which** — they are not interchangeable, and picking the wrong one silently changes what the probe measures.

- [ ] **Step 2: Rewrite the wall-leak verdict in `geometry.ts`**

Lines 287-290 exempt `magmablast` from the `<- THROUGH THE WALL` finding with the comment `(disc — passes through by design)`, left from when this row was the retired aura. The exemption is correct again but for a new reason, and the probe should say the true one:

```ts
    // magmablast's SHELL dies on the wall like any projectile; its 60u burst is a disc, and a disc
    // has no axis for the wall raycast to follow, so the splash does reach the far side. Damage
    // here is the explosion by design (spec P17), not a leak.
    if (dealt > 0 && id !== "magmablast") leak = true;
```

and update the report string on line 290 to match.

- [ ] **Step 3: Verify they run**

```bash
npm run playtest
```

Expected: it completes and writes a report to `packages/server/playtest/reports/<date-NN>/`. Findings may have moved — that is information, not a failure. **Do not tune anything to make a finding go away.**

- [ ] **Step 4: Commit**

```bash
git add packages/server/playtest
git commit -m "fix(playtest): repoint probes after the weapon swap

slotBitFor(\"bullseye\", \"magmablast\") stopped existing. Each of the six
call sites is repointed to the chassis that carries the weapon that probe
was actually measuring.

geometry.ts's wall-leak exemption for magmablast is correct again, for a
new reason: the shell dies on the wall but the disc burst crosses it. The
comment said 'aura' and now says why.

Compile fixes and invalidated expectations only; no new scenarios.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Docs, the generated guide, and full verification

**Files:**
- Modify: `CLAUDE.md`, `docs/combat-model.md`, `docs/config-reference.md`, `docs/schema-reference.md`
- Regenerate: `packages/client/public/manual.html`

- [ ] **Step 1: Rebuild shared, then the guide**

```bash
npm run build -w @motor-combat-moba/shared && npm run build:manual
```

The guide reads every number from built shared, so the rebuild is not optional.

- [ ] **Step 2: Update `CLAUDE.md`**

Two paragraphs are now false:

- The aura paragraph states the mechanism is *"dormant, not deleted"* and that *"no row in the roster uses a `disc` hitbox any more"*. Both stop being true — a disc ships again, as Magma Blast's explosion, reached through `instanceDefOf`. Rewrite it to describe what actually ships.
- The weapon-status paragraph names which chassis carries what. Update Mirage's and Bullseye's slot 1.

Add a line noting that `corroded`'s only source is now an explosion, since that is exactly the sort of thing a future reader would grep for and not find.

- [ ] **Step 3: Update the three reference docs**

- `docs/combat-model.md` — the two weapons' behaviour, and corrode's new source.
- `docs/config-reference.md` — `ExplosionDef`, `lifetimeMs`/`bounces`, `HomingDef.acquire`.
- `docs/schema-reference.md` — `WeaponInstanceState.isExplosion`.

`docs/turn-tuning.md` is **not** touched: nothing in this pass moves a drive stat, and editing it would fail its own parser test for no reason.

- [ ] **Step 4: Full verification**

```bash
npm install && npm run build && npm test
```

Then confirm the build did not escape the worktree:

```bash
grep -c "// \.\./\.\./\.\./\.\./\.\./packages/shared/dist/" packages/server/dist/index.js
```

Expected: `0`. Any hit means the build inlined the main checkout's shared and every result above is suspect.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs packages/client/public/manual.html
git commit -m "docs: predator/magmablast mechanics, and rebuild the guide

CLAUDE.md's aura paragraph said no row uses a disc hitbox and the mechanism
was dormant. A disc ships again as magmablast's explosion, so both claims
are rewritten. corroded's only source is now an explosion, which is worth
saying where someone would grep for it.

balanceStamp moved, so manual.html is regenerated — this is what unblocks
manual-page.test.mjs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After the plan

Two things need the user, and neither is a step above:

1. **`npm run ttk`** — this pass changes damage, cadence and reach on two weapons and moves both between chassis. Predator lands at ~87 sustained DPS from Bullseye, the roster's highest, and it steers itself. Recommend the run; do not act on its output unasked.
2. **`npm run playtest`** — Task 9 fixes the compile breaks and one invalidated verdict, and nothing more. The probes measure weapon reach, damage output and instance counts, which is most of what moved. Recommend the run and report what shifted; do not tune anything to make a finding disappear.
