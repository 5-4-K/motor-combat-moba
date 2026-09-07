# Stage 3: The Ram Contest — Implementation Plan

> **EXECUTED — 2026-09-06/07, in 11 commits. Its unchecked `- [ ]` boxes below are historical, not a
> to-do list.** Written against spec revision 2; `mass` is gone from `packages/` and the contest
> (R1–R11) is what ships. One exit criterion reads as unmet on the arithmetic — that was diagnosed,
> escalated, approved as its own stage, and then **parked by play** on 2026-09-07. **Do not
> re-execute this plan, and do not trust a step here over the shipped code** — read
> [`EXECUTION.md`](EXECUTION.md) first, especially "The restitution stage, and why it is parked".

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mass-derived, equal-and-opposite ram impulses with a contest between the two cars'
`ramAttack` and `ramDefence`, and remove `mass` from the game.

**Architecture:** Each car brings a **push** into a collision — its `ramAttack` times the speed it is
driving into the impact, plus a standing contribution from its `ramDefence`. The two pushes compete.
Each car's impact is the *other* car's push, scaled by its own share of the contest, by the face
bonus for the face **it** presents, and divided by its own `ramDefence`. Each car's outcome is
computed directly; there is no negated copy and no `reactionOf`.

**Tech Stack:** TypeScript, npm workspaces, Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-06-car-physics-rework-design.md`](../../specs/2026-09-06-car-physics-rework-design.md)
— **revision 2, clauses R1–R11.** Read the Changelog first: it explains why the model changed after
stage 2 shipped, and which stage-2 clauses are superseded.

**Ledger:** [`interfaces.md`](interfaces.md) — outranks this plan. Read it before Task 1.

**Depends on:** Stages 1 and 2 executed. `SimBody` carries `vx`/`vy`; the `Impulse` struct,
`applyImpulse`, `resolveWorld`'s fifth parameter and edge-triggered contact all exist and are kept.

## Global Constraints

- `TICK_RATE_HZ` lives once in `@motor-combat-moba/shared`. Never redefine it.
- No magic numbers in logic. Every constant comes from `shared/config`. Frozen test fixtures are the
  deliberate exception.
- `stepSim` is the lockstep: server and client import the same function. Neither half may be
  reordered or skipped on one side only.
- **Invariant 8:** if `stepSim` reads it, it is a networked schema field.
- Durations authored in milliseconds or seconds and converted to ticks **once**.
- `stepDrive` must never read `CAR_TABLE`. It receives a resolved `ChassisDrive`.
- **Edge-triggered contact is retained (spec P25).** A ram fires only on the tick a pair *enters*
  contact. `resolveContacts` keys this off its `previous` set, never off "is there an overlap now" —
  since stage 2 a pinned pair holds a non-null MTV every tick, so an overlap-keyed trigger would fire
  continuously and reintroduce ram-locking.
- **The ram stats are `ramAttack` and `ramDefence`, never `attack`/`defence`.** `CarDef.attack`
  already exists and scales weapon damage (`damageFor` in `sim/damage.ts`, `sim/combat.ts`).
- Shared is consumed as built `dist`. Rebuild it after editing shared.
- Build with root `npm run build`, **never** `npm run build --workspaces`.
- The complete verification gate is root `npm test` **plus** `npm run typecheck` — stage 1 repaired
  the typecheck gate and it must not rot.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/shared/src/config/types.ts` | `CarDef` gains `ramAttack`/`ramDefence`, loses `mass`. | Modify |
| `packages/shared/src/config/car-config.ts` | `CAR_TABLE` rows; `ramAttackOf`/`ramDefenceOf`; `massOf`/`ramReference*` deleted. | Modify |
| `packages/shared/src/config/ram-config.ts` | `defencePushScale`, `globalScale`; mass clamps deleted; `minApproachSpeed` → 0. | Modify |
| `packages/shared/src/sim/ram.ts` | `driveIn`, `pushOf`, the contest. Replaces severity. | Modify |
| `packages/shared/src/sim/contact.ts` | `ImpulseEntry` carries the attacker's impulse; `severity` gone. | Modify |
| `packages/shared/src/sim/impulse.ts` | `applyImpulse` off `ramDefence`; `reactionOf` deleted. | Modify |
| `packages/shared/src/sim/collide.ts` | `shareOf` and `CarObstacle` read `ramDefence`. | Modify |
| `packages/shared/src/sim/context.ts` | `otherCarHulls` supplies `ramDefence`. | Modify |
| `packages/shared/src/sim/status/modifiers.ts` | `ramMass` channel → `ramDefence`. | Modify |
| `packages/server/src/sim/ram-bridge.ts` | Applies both cars' outcomes; `selfKeepFactor` use deleted. | Modify |
| `packages/client/src/ui/car-select-view.ts` | Mass stat → `ramAttack`/`ramDefence`. | Modify |

---

## Task 1: Add the ram ratings alongside `mass`

Additive on purpose. `mass` is **not** removed until Task 4, when nothing reads it — so every task
in between compiles and the suite stays green. Stage 1 landed a deliberately non-compiling window and
it cost three fix rounds; this plan avoids repeating that.

**Files:**
- Modify: `packages/shared/src/config/types.ts`
- Modify: `packages/shared/src/config/car-config.ts`
- Modify: `packages/shared/src/config/ram-config.ts`
- Test: `packages/shared/src/config/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CarDef.ramAttack`, `CarDef.ramDefence`, `ramAttackOf(id)`, `ramDefenceOf(id)`,
  `RAM_CONFIG.defencePushScale`, `RAM_CONFIG.globalScale`.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/config/config.test.ts`:

```ts
import { activeCarIds, ramAttackOf, ramDefenceOf } from "./car-config.js";
import { RAM_CONFIG } from "./ram-config.js";

describe("ram ratings", () => {
  it("gives every active chassis a positive ramAttack and ramDefence", () => {
    for (const id of activeCarIds()) {
      expect(ramAttackOf(id)).toBeGreaterThan(0);
      expect(ramDefenceOf(id)).toBeGreaterThan(0);
    }
  });

  it("keeps them as 0-100 ratings, not direct values", () => {
    for (const id of activeCarIds()) {
      expect(ramAttackOf(id)).toBeLessThanOrEqual(100);
      expect(ramDefenceOf(id)).toBeLessThanOrEqual(100);
    }
  });

  it("orders ramDefence tank-first, preserving the old mass ordering", () => {
    expect(ramDefenceOf("bastion")).toBeGreaterThan(ramDefenceOf("mirage"));
    expect(ramDefenceOf("mirage")).toBeGreaterThan(ramDefenceOf("bullseye"));
  });

  it("spreads ramAttack more narrowly than ramDefence, so offence and defence are not the same axis", () => {
    const atk = activeCarIds().map(ramAttackOf);
    const def = activeCarIds().map(ramDefenceOf);
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(atk)).toBeLessThan(spread(def));
  });

  it("has a positive defence push scale and global scale", () => {
    expect(RAM_CONFIG.defencePushScale).toBeGreaterThan(0);
    expect(RAM_CONFIG.globalScale).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/config/config.test.ts -t "ram ratings"`
Expected: FAIL — `ramAttackOf` is not exported.

- [ ] **Step 3: Add the `CarDef` fields**

In `packages/shared/src/config/types.ts`, beside `mass`:

```ts
  /**
   * How hard this chassis hits in a ram contest, 0-100. Affects **only** what it does to others —
   * never what happens to it (spec R1). This is what lets a chassis be made to hit harder without
   * also becoming immovable, which one `mass` rating could not express.
   *
   * NOT `attack`: that field already exists on this table and scales WEAPON damage. Reusing it
   * would couple ramming power to gun damage, which is the class of hidden coupling revision 2
   * exists to remove.
   */
  ramAttack: number;
  /**
   * How solid this chassis is, 0-100: what it resists in the contest, what it absorbs, and how hard
   * it is to shoulder aside (spec R1, R5, R8).
   *
   * Worth more per point than `ramAttack`, deliberately: it both adds to your push and divides your
   * received impact, so its effect compounds. That is what makes a tank read as a tank — price the
   * roster around it rather than weakening one of the two roles (spec "Flagged for confirmation").
   */
  ramDefence: number;
```

In `packages/shared/src/config/car-config.ts`, add both to every `CAR_TABLE` row. `ramDefence`
inherits the old `mass` ratings so today's solidity ordering survives the migration legibly;
`ramAttack` starts deliberately flatter, because under the old model one number drove offence and
defence together:

```ts
mirage:   { ..., ramAttack: 55, ramDefence: 50, ... },
bullseye: { ..., ramAttack: 45, ramDefence: 30, ... },
bastion:  { ..., ramAttack: 70, ramDefence: 90, ... },
```

Add the accessors beside `massOf`:

```ts
export function ramAttackOf(id: CarId): number {
  return CAR_TABLE[id].ramAttack;
}

export function ramDefenceOf(id: CarId): number {
  return CAR_TABLE[id].ramDefence;
}
```

- [ ] **Step 4: Add the two global knobs**

In `packages/shared/src/config/ram-config.ts`:

```ts
  /**
   * How much a STATIONARY car resists, as a multiplier on its `ramDefence` when building its push
   * (spec R2). The first knob to reach for when contact feels wrong: low and parked cars are nearly
   * free hits, high and everything feels like hitting a wall.
   *
   * At 35 a stationary mid-tier car brings roughly 12% of what a full-speed car brings. It is also
   * what makes T-boning a Bastion cost more than T-boning a Bullseye — about seven times more at the
   * starting ratings, and nobody authored that number; it falls out of the contest.
   */
  defencePushScale: 35,
  /**
   * Converts a contest result into a Δv (spec R5).
   *
   * **MEASURE THIS, DO NOT DERIVE IT.** Revision 1's equivalent was derived from arithmetic and was
   * wrong by 5x — it threw every chassis backwards faster than its own top speed. Task 4 measures it
   * against the shipped pipeline order and records what it measured.
   */
  globalScale: 1,
```

Also in the same file, **set the two gates inactive** (spec R9):

```ts
  /**
   * Minimum combined drive-in below which no ram fires. **Ships at 0 — deliberately inactive**
   * (spec R9), to be tuned later by feel.
   *
   * At 0, a gentle bump is simply a ram with a low drive-in, and linear scaling makes it come out
   * small on its own — which is why revision 2 needs no separate "baseline versus ram" path. The old
   * value of 60 was authored against a 449 u/s roster and means something different against 267, so
   * it cannot be carried across even when it is re-enabled.
   */
  minApproachSpeed: 0,
```

**There is no ceiling constant to add.** Spec R9 requires ram strength to stop being a normalised
0-1 fraction that saturates — under revision 1 two of the three chassis hit that cap on an ordinary
full-speed rear ram, so speed differences above it did nothing. The contest in Task 2 is open-ended
by construction: `impactOn` never clamps. **Do not reintroduce a `clamp01` anywhere in the ram
path** — that is the defect, not a safeguard.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/shared/src/config/config.test.ts`
Expected: PASS. `mass` is still present and still read by everything, so the package still compiles.

- [ ] **Step 6: Run the full gate**

Run: `npm test` then `npm run typecheck`
Expected: PASS both. `CAR_TABLE` gained fields, so `balanceStamp` moved — if
`scripts/manual-page.test.mjs` fails, run `npm run build:manual` and commit the page it writes.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/config/ packages/client/public/manual.html
git commit -m "feat(config): add ramAttack and ramDefence ratings"
```

---

## Task 2: The contest replaces severity

**Files:**
- Modify: `packages/shared/src/sim/ram.ts`
- Test: `packages/shared/src/sim/ram.test.ts`

**Interfaces:**
- Consumes: `ramAttackOf`, `ramDefenceOf`, `RAM_CONFIG.defencePushScale`, `RAM_CONFIG.globalScale`
  from Task 1.
- Produces: `RamCar` carrying `vx`/`vy` and `defenceMult` (was `speed` and `massMult`);
  `RamHit.impulse` built from the contest; `driveInOf`, `pushOf`, `impactOn` internal to `ram.ts`.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/sim/ram.test.ts`, add:

```ts
describe("the ram contest", () => {
  it("gives the whole impact to a car that brings no drive-in", () => {
    // Attacker drives +x into a stationary victim's flank.
    const hit = resolveRam(attackerAt(600, 300), victimAt(640, 300), "ffa");
    expect(hit).not.toBeNull();
    expect(hit!.impulse.speed).toBeGreaterThan(0);
  });

  it("takes less impact when you drive into the hit than when you are stopped", () => {
    const stopped = resolveRam(attackerAt(600, 300), victimAt(640, 300), "ffa");
    const driving = resolveRam(
      attackerAt(600, 300),
      { ...victimAt(640, 300), vx: -200, vy: 0 },
      "ffa",
    );
    // The victim driving INTO the attacker wins more of the contest, so it absorbs less.
    expect(driving!.impulse.speed).toBeLessThan(stopped!.impulse.speed);
  });

  it("ignores a victim fleeing along the normal rather than crediting it negative push", () => {
    const fleeing = resolveRam(
      attackerAt(600, 300),
      { ...victimAt(640, 300), vx: 400, vy: 0 },
      "ffa",
    );
    // driveIn clamps at 0, so a fleeing car brings only its standing defence push.
    expect(fleeing).not.toBeNull();
    expect(fleeing!.impulse.speed).toBeGreaterThan(0);
  });

  it("scales linearly with closing speed", () => {
    const slow = resolveRam(
      { ...attackerAt(600, 300), vx: 100, vy: 0 },
      victimAt(640, 300),
      "ffa",
    );
    const fast = resolveRam(
      { ...attackerAt(600, 300), vx: 200, vy: 0 },
      victimAt(640, 300),
      "ffa",
    );
    // Not exactly 2x — the defence push term does not scale with speed — but close, and monotonic.
    expect(fast!.impulse.speed).toBeGreaterThan(slow!.impulse.speed * 1.5);
  });

  it("costs the attacker more for hitting a solid car than a flimsy one", () => {
    const vsFlimsy = resolveRam(attackerAt(600, 300), victimAt(640, 300, "bullseye"), "ffa");
    const vsSolid = resolveRam(attackerAt(600, 300), victimAt(640, 300, "bastion"), "ffa");
    expect(vsSolid!.attackerImpulse.speed).toBeGreaterThan(vsFlimsy!.attackerImpulse.speed);
  });

  it("never fires on a pair that is not closing at all", () => {
    const apart = resolveRam(
      { ...attackerAt(600, 300), vx: 0, vy: 0 },
      { ...victimAt(640, 300), vx: 0, vy: 0 },
      "ffa",
    );
    // Both bring only standing defence push, and neither is driving in: no contact event.
    expect(apart).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/sim/ram.test.ts -t "the ram contest"`
Expected: FAIL — `attackerImpulse` does not exist on `RamHit`, and `RamCar` has no `vx`.

- [ ] **Step 3: Widen `RamCar`**

In `packages/shared/src/sim/ram.ts`, replace `speed: number` with the velocity pair and rename the
status multiplier. Keep the pre-collision warning verbatim — it is load-bearing and was earned by a
shipped bug:

```ts
export interface RamCar {
  sessionId: string;
  team: 0 | 1;
  x: number;
  y: number;
  angle: number;
  /**
   * World velocity. **These must be the PRE-COLLISION values** — the ones the car carried into the
   * tick, supplied by `serverTick`'s `TickResult.approachVelocities`. Collision resolution runs
   * before ram does and reflects a car off what it hit, so a caller that passes post-resolution
   * velocity makes every drive-in term wrong on exactly the ticks a hull overlapped. That is not
   * hypothetical: it shipped, and it cost 80-90% of all rams until `playtest/ram.ts` measured the
   * trigger rate.
   */
  vx: number;
  vy: number;
  carId: CarId;
  /**
   * The car's `ramDefence` status multiplier, 1 for a car in no status. There is deliberately no
   * `ramAttack` multiplier — spec R11 gives statuses no offence channel.
   */
  defenceMult: number;
}
```

- [ ] **Step 4: Replace `approachOf`/`effectiveMassOf` with the contest**

Delete `effectiveMassOf` and rewrite `approachOf` as `driveInOf`:

```ts
/**
 * How fast this car is driving INTO the contact, along the normal pointing at the other car.
 * Clamped at zero: a car moving away brings nothing to the contest rather than a negative push.
 *
 * This is NOT closing speed. Closing speed is the SUM of the two cars' drive-ins; the contest needs
 * them separately, because who is losing decides who absorbs the hit (spec R3, R4).
 */
function driveInOf(car: RamCar, towardOther: Vec2): number {
  return Math.max(0, car.vx * towardOther.x + car.vy * towardOther.y);
}

/**
 * What this car brings to the contest (spec R2): what it is driving in with, plus what it is
 * standing there being. The defence term is speed-independent on purpose — solidity does not depend
 * on motion, and it is what stops a stationary car being a completely free hit.
 */
function pushOf(car: RamCar, driveIn: number): number {
  return (
    ramAttackOf(car.carId) * driveIn +
    ramDefenceOf(car.carId) * car.defenceMult * RAM_CONFIG.defencePushScale
  );
}

/**
 * What one car takes (spec R5): the other car's push, reduced by how much you are winning the
 * contest, adjusted for which of YOUR faces got hit, and softened by your own solidity.
 *
 * The face bonus is yours, not the other car's (spec R6) — your own nose is braced too, which is
 * what makes a head-on far gentler than a T-bone at the same closing speed.
 */
function impactOn(
  theirPush: number,
  myPush: number,
  myFaceBonus: number,
  myRamDefence: number,
): number {
  const total = myPush + theirPush;
  if (total <= 0 || myRamDefence <= 0) return 0;
  const myShare = theirPush / total;
  return (theirPush * myShare * myFaceBonus * RAM_CONFIG.globalScale) / myRamDefence;
}
```

- [ ] **Step 5: Rebuild `resolveRam` around the contest**

Both cars now get an outcome, so `RamHit` carries two impulses. Keep the attacker/victim naming —
it still says which car initiated, which the side bonus and the events need — but neither is
computed as a negation of the other:

```ts
export interface RamHit {
  attackerId: string;
  victimId: string;
  side: ImpactSide;
  /** What the victim takes. */
  impulse: Impulse;
  /** What the attacker takes. Computed independently, NOT a negated copy (spec R7). */
  attackerImpulse: Impulse;
}
```

Inside `resolveRam`, after `n` and the side classification are known:

```ts
  const towardVictim: Vec2 = aAttacks ? { x: -n.x, y: -n.y } : n;
  const towardAttacker: Vec2 = { x: -towardVictim.x, y: -towardVictim.y };

  const attackerDriveIn = driveInOf(attacker, towardVictim);
  const victimDriveIn = driveInOf(victim, towardAttacker);
  if (attackerDriveIn + victimDriveIn <= RAM_CONFIG.minApproachSpeed) return null;

  const attackerPush = pushOf(attacker, attackerDriveIn);
  const victimPush = pushOf(victim, victimDriveIn);

  // The victim presents the face the attacker struck; the attacker presents its own struck face,
  // which for a car driving forward into something is its front (spec R6).
  const victimImpact = impactOn(
    attackerPush, victimPush, bonusFor(side), ramDefenceOf(victim.carId) * victim.defenceMult,
  );
  const attackerImpact = impactOn(
    victimPush, attackerPush, RAM_CONFIG.bonusFront, ramDefenceOf(attacker.carId) * attacker.defenceMult,
  );
```

Then build both impulses. Each pushes its car **away from the other**, and both recover the contact
point exactly as before via `contactPointOn` — that helper is unchanged:

```ts
  const contact = contactPointOn(victim, attacker);
  return {
    attackerId: attacker.sessionId,
    victimId: victim.sessionId,
    side,
    impulse: {
      dirX: towardVictim.x,
      dirY: towardVictim.y,
      speed: victimImpact,
      spin: 1,
      defenceScaled: false, // the contest already divided by ramDefence; see the note below
      uncontrolTicks: 0,    // stage 3b fills this in
      contactX: contact.x,
      contactY: contact.y,
    },
    attackerImpulse: {
      dirX: towardAttacker.x,
      dirY: towardAttacker.y,
      speed: attackerImpact,
      spin: 1,
      defenceScaled: false,
      uncontrolTicks: 0,
      contactX: contact.x,
      contactY: contact.y,
    },
  };
```

> **Why `defenceScaled: false` on a ram.** `impactOn` already divides by the car's own `ramDefence`,
> so letting `applyImpulse` divide again would apply it twice. `defenceScaled` exists for impulses
> whose magnitude was **not** built from a contest — a weapon reading fixed numbers off its own row
> (stage 4), which needs `applyImpulse` to do the dividing. Ram and weapons genuinely differ here;
> that is spec principle D, and it is why the flag is on the struct rather than assumed.

- [ ] **Step 6: Carry the attacker's impulse through `contact.ts`**

`ImpulseEntry` in `packages/shared/src/sim/contact.ts` currently carries `{ attackerId, severity,
impulse }`. `severity` no longer exists — the contest produces magnitudes directly, not a 0-1 grade —
and the attacker's impulse has to reach the bridge:

```ts
/** One resolved contact and who threw it. Keyed by VICTIM id in the returned map. */
export interface ImpulseEntry {
  attackerId: string;
  /** What the victim takes. */
  impulse: Impulse;
  /** What the attacker takes. Computed independently by the contest, not a negated copy (R7). */
  attackerImpulse: Impulse;
}
```

`resolveContacts`'s "keep only the hardest hit per victim" comparison read `hit.severity`. Compare
`hit.impulse.speed` instead — the same ordering, now on the quantity that actually exists.

The slam branch builds its own `attackerImpulse` too. A slam is authored, not contested, so the
attacker takes nothing from it: build a zero-magnitude impulse rather than skipping the field, so
the bridge has one code path.

**Do not touch the edge-trigger.** `resolveContacts`'s `previous`-set guard is unchanged; only the
value type in `best` moves.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run packages/shared/src/sim/ram.test.ts packages/shared/src/sim/contact.test.ts`
Expected: PASS. Existing severity-shaped assertions in that file need rewriting against the
contest — **update what they measure, never weaken them to a bare "something happened"**. Where a
test pinned `severity`, pin `impulse.speed` instead.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/sim/ram.ts packages/shared/src/sim/ram.test.ts \
        packages/shared/src/sim/contact.ts packages/shared/src/sim/contact.test.ts
git commit -m "feat(sim): resolve rams as a contest between both cars' push"
```

---

## Task 3: `applyImpulse` and separation read `ramDefence`

**Files:**
- Modify: `packages/shared/src/sim/impulse.ts`
- Modify: `packages/shared/src/sim/collide.ts`
- Modify: `packages/shared/src/sim/context.ts`
- Modify: `packages/shared/src/sim/step.ts`
- Test: `packages/shared/src/sim/impulse.test.ts`, `collide.test.ts`

**Interfaces:**
- Consumes: `ramDefenceOf` from Task 1.
- Produces: `applyImpulse(body, ramDefence, imp)`, `Impulse.defenceScaled`,
  `CarObstacle { hull, ramDefence }`, `StepContext.selfRamDefence`. **`reactionOf` is deleted.**

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/sim/impulse.test.ts`, replace the `reactionOf` describe block with:

```ts
describe("applyImpulse scales by ramDefence", () => {
  it("moves a flimsy car further than a solid one under the same impulse", () => {
    const flimsy = applyImpulse(body(), 30, impulse());
    const solid = applyImpulse(body(), 90, impulse());
    expect(Math.abs(flimsy.vy)).toBeGreaterThan(Math.abs(solid.vy));
  });

  it("ignores ramDefence entirely when defenceScaled is false", () => {
    const flimsy = applyImpulse(body(), 30, impulse({ defenceScaled: false }));
    const solid = applyImpulse(body(), 90, impulse({ defenceScaled: false }));
    expect(flimsy.vy).toBeCloseTo(solid.vy);
  });
});
```

Delete the `reactionOf` import and its tests — the function is gone (spec R7), and a test for a
deleted function is not a test.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/sim/impulse.test.ts`
Expected: FAIL — `defenceScaled` does not exist; `reactionOf` is still exported.

- [ ] **Step 3: Rewrite the applier**

In `packages/shared/src/sim/impulse.ts`, rename `massScaled` → `defenceScaled` on `Impulse`, replace
`massFactorOf` with a `ramDefence` divisor, and **delete `reactionOf` entirely**:

```ts
/**
 * How far this impulse displaces a car of this solidity.
 *
 * The single place `ramDefence` divides a push out. `defenceScaled: false` opts out entirely: a hard
 * slam punts every chassis identically, which is the designer's escape hatch spec principle C grants
 * (R10).
 *
 * There are no clamps here. `massFactorMin`/`massFactorMax` are deleted (spec P19): they existed to
 * stop a mass ratio degenerating, and both roster extremes clipped against them anyway, so part of
 * what the stat did was being discarded.
 */
function defenceFactorOf(ramDefence: number, defenceScaled: boolean): number {
  if (!defenceScaled || ramDefence <= 0) return 1;
  return 1 / ramDefence;
}
```

`applyImpulse`'s second parameter is renamed `ramDefence` throughout, including in `nextSpin`, whose
inertia term reads it instead of mass.

> **Delete `reactionOf` and every call site.** Each car's outcome now comes from the contest
> (Task 2), computed directly. A negated copy is exactly the double-charging that made an attacker
> pay twice for one collision.

- [ ] **Step 4: Re-weight separation**

In `collide.ts`, `CarObstacle.mass` becomes `ramDefence` and `shareOf` reads it:

```ts
function shareOf(selfRamDefence: number, otherRamDefence: number): number {
  const total = selfRamDefence + otherRamDefence;
  return total <= 0 ? OBSTACLE_SHARE : otherRamDefence / total;
}
```

`resolveWorld`'s fifth parameter becomes `selfRamDefence`. In `context.ts`, `otherCarHulls` supplies
`ramDefence: ramDefenceOf(carIdOf(player))`. In `step.ts`, `StepContext.selfMass` becomes
`selfRamDefence` — **still required, never optional with a default**, for the reason its comment
already records: the compiler is what stops the two halves of the lockstep disagreeing about who
moves.

- [ ] **Step 5: Run the shared suite**

Run: `npm test -w @motor-combat-moba/shared`
Expected: PASS. `golden.test.ts`'s car-separation case moves (the split is now defence-weighted) —
**hand-derive the new value from the documented rule before recording it**, as stages 1 and 2 both
did. This is the fixture's third regeneration; do not paste what the code emits.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/
git commit -m "feat(sim): scale impulses and separation by ramDefence, delete reactionOf"
```

---

## Task 4: Wire the bridge, remove `mass`, measure `globalScale`

**Files:**
- Modify: `packages/server/src/sim/ram-bridge.ts`, `packages/server/src/sim/tick.ts`
- Modify: `packages/shared/src/sim/status/modifiers.ts`, `packages/shared/src/config/status-types.ts`
- Modify: `packages/shared/src/config/car-config.ts`, `types.ts`, `ram-config.ts`
- Modify: `packages/client/src/ui/car-select-view.ts`
- Modify: `docs/turn-tuning.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `mass` gone from the codebase; `TickResult.approachVelocities`; a measured `globalScale`.

- [ ] **Step 1: Apply both outcomes in the bridge**

`ram-bridge.ts` currently applies `imp` to the victim and `reactionOf(imp)` to the attacker. Replace
with the two independently computed impulses:

```ts
  for (const [victimId, entry] of result.impulses) {
    writeBody(victimId, applyImpulse(bodyOf(victimId), defenceFor(victimId), entry.impulse));
    writeBody(
      entry.attackerId,
      applyImpulse(bodyOf(entry.attackerId), defenceFor(entry.attackerId), entry.attackerImpulse),
    );
  }
```

`defenceFor` is the existing `massFor` helper renamed — same shape, same call sites, reading
`ramDefenceOf(carIdOf(player))` times the car's `ramDefence` status multiplier instead of mass.

Delete the `SLAM_CONFIG.selfKeepFactor` line (spec P20 — the contest replaces it) and mark the
constant `INERT` in `slam-config.ts`, as stage 1 marked the five dead `RAM_CONFIG` knobs.

- [ ] **Step 2: Widen `approachSpeeds` to `approachVelocities`**

`tick.ts` caches each car's pre-collision forward component. The contest needs the full velocity:
`TickResult.approachSpeeds` (`Map<string, number>`) becomes `approachVelocities`
(`Map<string, { vx: number; vy: number }>`). **Cache it in exactly the same place** — the first
statement of the per-player loop, before `resolveWorld` runs.

- [ ] **Step 3: Rename the status channel**

`ramMass` becomes `ramDefence` in `modifiers.ts` and `status-types.ts`. No `STATUS_TABLE` row carries
it today, so this is a rename with no behavioural change — but check `channels.test.ts`, which
asserts that fact explicitly.

- [ ] **Step 4: Remove `mass`**

Delete `CarDef.mass`, the `mass` field from every `CAR_TABLE` row, `massOf`, `massPerRating`,
`REFERENCE_MASS_RATING`, `resolveRamReferenceMass`, `resolveRamReference`, `RAM_REFERENCE_MASS`,
`RAM_REFERENCE`, `ramReference`, `ramReferenceMass`, `massFactorMin` and `massFactorMax`.

In `packages/client/src/ui/car-select-view.ts`, the `{ label: "Mass", value: String(massOf(id)) }`
row becomes two rows for `ramAttack` and `ramDefence` (spec R11). This is player-facing: the labels
should read as game concepts, not config field names.

- [ ] **Step 5: Measure `globalScale`**

**Measure it; do not derive it.** Drive the real shipped order — `serverTick` (drive +
`resolveWorld`) then `contactTick` — for a Bastion at top speed into a stationary Bullseye's flank,
sweeping the sub-tick phase, and read what the victim and attacker actually end up doing.

`packages/server/src/sim/pipeline-order.test.ts` already drives exactly that sequence and is the
right place to work from.

Set `globalScale` so that a full-speed flank ram throws the victim hard while leaving the attacker
still moving **forwards**. Record the measured numbers in `globalScale`'s comment. Deriving revision
1's equivalent from arithmetic instead of measuring it is what shipped attackers flying backwards at
97% of their top speed.

- [ ] **Step 6: Run the full gate**

Run: `npm test`, then `npm run typecheck`, then `npm run build`
Expected: PASS all three. Removing a `CAR_TABLE` field moves `balanceStamp`: run
`npm run build:manual` and commit the page. `docs/turn-tuning.md` needs its mass column removed and
its "Keeping this page honest" field list updated — `scripts/turn-tuning-doc.test.mjs` fails until it
agrees, and its prose argues from figures inside sentences that no test can see.

`packages/server/playtest/` and `balance/` read `mass` and are covered by `npm run typecheck`. **Fix
the compile breaks; change no threshold or scenario** — stage 5 owns those — and leave a comment at
any threshold this invalidates.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat!: remove mass; ramming resolves as a ramAttack/ramDefence contest"
```

---

## Stage 3 exit criteria

- [ ] `npm test`, `npm run typecheck` and `npm run build` all pass from the repo root.
- [ ] `mass` appears nowhere in `packages/`.
- [ ] `npm run dev`: ram a Bullseye as Bastion — **the Bastion keeps moving forwards** and the
      Bullseye is thrown. This is the criterion revision 1 failed; it is the point of the stage.
- [ ] Ram a Bastion as Bullseye: you bounce off hard, it barely moves.
- [ ] Charge head-on into someone: both cars are pushed back, noticeably less than a flank hit.
- [ ] T-bone a Bastion, then a Bullseye: the Bastion costs you visibly more.

**Not done in this stage, deliberately:** a rammed car still keeps full steering, and repeated rams
still stack without diminishing returns. Both land in stage 3b (`reeling` and falloff).
