# Stage 3: Ram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make ramming feel like an impact — severity from relative closing speed, a real loss of
control, and diminishing returns so coordinated attackers cannot ram-lock a victim.

**Architecture:** `approachOf` starts reading both cars' velocity along the contact normal instead of
the attacker's alone. Control loss returns as a new `reeling` status carried on the existing duration
layer, replacing the deleted `authority` field. A server-side per-victim falloff stack scales both
the duration and the impulse of successive rams inside a rolling window.

**Tech Stack:** TypeScript, npm workspaces, Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-06-car-physics-rework-design.md`](../../specs/2026-09-06-car-physics-rework-design.md) (P17–P25b)

**Ledger:** [`interfaces.md`](interfaces.md)

**Depends on:** Stages 1 and 2 complete. `Impulse` and `applyImpulse` exist; ram and slam already
route through them; `RamHit.impulse.uncontrolTicks` is currently always 0.

## Global Constraints

Identical to stage 1 — see [`01-vector-drive.md`](01-vector-drive.md#global-constraints). The ones
that bite hardest here:

- Durations are authored in **milliseconds and converted to ticks once**, never per-tick.
- A status does not own its duration — the applier does. Statuses never stack with themselves.
- No magic numbers in logic.
- The complete verification gate is root `npm test`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/shared/src/sim/ram.ts` | Relative closing velocity. | Modify |
| `packages/shared/src/config/status-config.ts` | The `reeling` row. | Modify |
| `packages/shared/src/config/status-types.ts` | `StatusId` gains `"reeling"`. | Modify |
| `packages/shared/src/config/ram-config.ts` | Falloff knobs; dead authority/shove fields removed. | Modify |
| `packages/server/src/sim/ram-bridge.ts` | The falloff stack, and applying `reeling`. | Modify |
| `packages/server/src/sim/falloff.ts` | The stack's logic, isolated and testable. | Create |

---

## Task 1: Severity from relative closing velocity

**Files:**
- Modify: `packages/shared/src/sim/ram.ts`
- Test: `packages/shared/src/sim/ram.test.ts`

**Interfaces:**
- Consumes: `RamCar` — whose `speed` field becomes `vx`/`vy`.
- Produces: `RamCar { vx: number; vy: number }` replacing `RamCar.speed`. `ram-bridge.ts` and every
  playtest probe that builds a `RamCar` must follow.

- [ ] **Step 1: Write the failing test**

```ts
describe("ram severity reads relative closing velocity", () => {
  it("hits a fleeing car softer than a stationary one", () => {
    const attacker = carAt(600, 300, 0, { vx: 300, vy: 0 });
    const parked = carAt(650, 300, 0, { vx: 0, vy: 0 });
    const fleeing = carAt(650, 300, 0, { vx: 250, vy: 0 });

    const onParked = resolveRam(attacker, parked, "ffa");
    const onFleeing = resolveRam(attacker, fleeing, "ffa");

    expect(onParked!.severity).toBeGreaterThan(onFleeing!.severity * 2);
  });

  it("hits an oncoming car harder than a stationary one", () => {
    const attacker = carAt(600, 300, 0, { vx: 300, vy: 0 });
    const parked = carAt(650, 300, Math.PI, { vx: 0, vy: 0 });
    const oncoming = carAt(650, 300, Math.PI, { vx: -200, vy: 0 });

    expect(resolveRam(attacker, oncoming, "ffa")!.severity).toBeGreaterThan(
      resolveRam(attacker, parked, "ffa")!.severity,
    );
  });

  it("still refuses a ram below the minimum closing speed", () => {
    // Both drifting the same way at the same speed: they are touching, not colliding.
    const a = carAt(600, 300, 0, { vx: 200, vy: 0 });
    const b = carAt(650, 300, 0, { vx: 200, vy: 0 });
    expect(resolveRam(a, b, "ffa")).toBeNull();
  });

  it("a car shunted backwards deals nothing", () => {
    const a = carAt(600, 300, 0, { vx: -100, vy: 0 });
    const b = carAt(650, 300, 0, { vx: 0, vy: 0 });
    // b is the one closing, if anyone is; a certainly is not the attacker.
    const hit = resolveRam(a, b, "ffa");
    if (hit !== null) expect(hit.attackerId).not.toBe(a.sessionId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/sim/ram.test.ts -t "relative closing"`
Expected: FAIL — `RamCar` has `speed`, not `vx`/`vy`.

- [ ] **Step 3: Widen `RamCar` and rewrite `approachOf`**

In `ram.ts`, replace `RamCar.speed` with:

```ts
  /**
   * World velocity, carried into the tick.
   *
   * **This must be the PRE-COLLISION velocity.** Collision resolution runs before ram does and
   * reflects a car off whatever it struck, so a caller that passes the post-resolution value makes
   * the closing term negative on almost every tick a hull actually overlapped. That is not
   * hypothetical: it shipped, and it cost 80-90% of all rams until `playtest/ram.ts` measured the
   * trigger rate. `serverTick`'s `TickResult.approachVelocities` is the supply.
   */
  vx: number;
  vy: number;
```

Replace `approachOf` with a relative reading:

```ts
/**
 * How fast these two are closing on each other along the contact normal.
 *
 * RELATIVE, not absolute — this is the change that makes ramming a moving car feel like anything.
 * Reading only the attacker's own speed meant a car rear-ended while fleeing at the attacker's own
 * pace took a full-strength hit it should barely have felt, and an oncoming car took no more than a
 * parked one. Both read wrong for the same reason: the victim's motion was not in the equation.
 *
 * Still multiplied by how squarely the attacker's nose points down the normal, so a glancing
 * approach scores proportionally less rather than falling off a threshold — that part was right.
 */
function closingOf(attacker: RamCar, victim: RamCar, towardVictim: Vec2): number {
  const rvx = attacker.vx - victim.vx;
  const rvy = attacker.vy - victim.vy;
  const closing = rvx * towardVictim.x + rvy * towardVictim.y;
  const fwdX = Math.cos(attacker.angle);
  const fwdY = Math.sin(attacker.angle);
  const squareness = fwdX * towardVictim.x + fwdY * towardVictim.y;
  return closing * Math.max(0, squareness);
}
```

Both call sites in `resolveRam` change to `closingOf(a, b, ...)` / `closingOf(b, a, ...)`.

- [ ] **Step 4: Update the bridge's velocity cache**

`TickResult.approachSpeeds` (a `Map<string, number>`) becomes `approachVelocities`
(`Map<string, { vx: number; vy: number }>`), cached before collision resolution exactly as the scalar
was. Update `serverTick` and every `RamCar` construction.

- [ ] **Step 5: Run the tests**

Run: `npm test -w @motor-combat-moba/shared`
Expected: PASS. Several existing `ram.test.ts` fixtures build a `RamCar` with `speed`; convert them
with `toWorld(angle, speed, 0)`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/ram.ts packages/shared/src/sim/ram.test.ts packages/server/src/sim/
git commit -m "feat(sim): grade ram severity from relative closing velocity"
```

---

## Task 2: The `reeling` status

**Files:**
- Modify: `packages/shared/src/config/status-types.ts`
- Modify: `packages/shared/src/config/status-config.ts`
- Test: `packages/shared/src/config/status-config.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `StatusId` includes `"reeling"`; `STATUS_TABLE.reeling` exists.

- [ ] **Step 1: Write the failing test**

```ts
describe("reeling", () => {
  it("is not a stun: it never freezes or disarms the victim", () => {
    const row = STATUS_TABLE.reeling;
    expect(row.flags ?? []).toEqual([]);
  });

  it("refreshes rather than ignoring, so falloff can shorten a chained ram", () => {
    expect(STATUS_TABLE.reeling.reapply).toBe("refresh");
  });

  it("degrades steering and the engine without breaching the global clamps", () => {
    const mods = STATUS_TABLE.reeling.modifiers;
    expect(mods.turnRate).toBeGreaterThanOrEqual(STATUS_LIMITS.turnRate.min);
    expect(mods.accel).toBeGreaterThanOrEqual(STATUS_LIMITS.accel.min);
    expect(mods.turnRate).toBeLessThan(1);
    expect(mods.accel).toBeLessThan(1);
  });

  it("leaves top speed alone, so a reeling car is slowed by physics not by a debuff", () => {
    expect(STATUS_TABLE.reeling.modifiers.topSpeed ?? 1).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/config/status-config.test.ts -t "reeling"`
Expected: FAIL — `STATUS_TABLE.reeling` is undefined.

- [ ] **Step 3: Add the row**

In `status-types.ts`, add `"reeling"` to the `StatusId` union. In `status-config.ts`:

```ts
  /**
   * Rammed: flung, sliding and fighting for grip. **Not a stun, and close to its opposite.**
   *
   * `stunned` is `immobilised + steeringLocked + disarmed + fullStop` — you stop dead and sit there,
   * which is the bumper-car-that-stops behaviour this rework exists to reject. `reeling` carries no
   * flags at all: you are moving fast in the wrong direction with your tyres saturated, you can
   * still shoot, and you can still fight the spin. That is what keeps ramming a setup rather than a
   * delete.
   *
   * **`flags: []` is load-bearing, not incidental.** `StatusDef` forces flag-carrying rows to
   * `reapply: "ignore"` so hard CC can never be chained. Because this row carries none, it escapes
   * that rule and a second ram may write a new (already-reduced) duration — which is exactly what
   * the falloff stack needs. Adding a flag here would silently break diminishing returns.
   *
   * Both multipliers sit AT the `STATUS_LIMITS` floors, deliberately. Do not lower those floors to
   * make this harsher: they are documented guarantees, widening one for a single row is how a
   * guarantee stops guaranteeing, and the helplessness here comes from the physics rather than the
   * debuff — a car sliding sideways with saturated tyres is already a passenger. `accel: 0.4` is
   * the friction-circle stagger on top: while the tyres are fighting the slide there is little grip
   * left for the engine, so a big hit visibly bogs you.
   */
  reeling: {
    id: "reeling",
    name: "Reeling",
    kind: "debuff",
    color: "#e8590c",
    reapply: "refresh",
    modifiers: { turnRate: 0.4, accel: 0.4 },
    flags: [],
  },
```

- [ ] **Step 4: Run the tests and commit**

Run: `npx vitest run packages/shared/src/config/`
Expected: PASS.

```bash
git add packages/shared/src/config/status-config.ts packages/shared/src/config/status-types.ts packages/shared/src/config/status-config.test.ts
git commit -m "feat(status): add reeling, the ram control-loss status"
```

---

## Task 3: The falloff stack

**Files:**
- Create: `packages/server/src/sim/falloff.ts`
- Create: `packages/server/src/sim/falloff.test.ts`
- Modify: `packages/shared/src/config/ram-config.ts`

**Interfaces:**
- Consumes: `RAM_CONFIG` falloff knobs.
- Produces: `nextFalloff(stack, victimId, tick): { durationScale: number; impulseScale: number }`,
  which **mutates** `stack` — it records the ram as well as reading it.

- [ ] **Step 1: Add the knobs**

In `ram-config.ts`:

```ts
  /** Full-strength `reeling` duration from a ram, before falloff. Weapons author their own. */
  ramUncontrolMs: 1000,
  /**
   * How long "recently rammed" lasts. ROLLING: each ram pushes the window out from itself, so
   * protection never lapses under sustained pressure. A window measured from the FIRST ram would
   * let an attacker who counts to one second land full-strength rams forever, which is the exact
   * lock this exists to prevent.
   */
  drWindowMs: 2000,
  /** Each successive ram's duration, as a fraction of the last. 1.0 disables duration falloff. */
  durationDrScale: 0.5,
  /** Duration never falls below this, so a late ram in a chain never reads as a whiff. */
  durationDrFloorMs: 150,
  /** Each successive ram's impulse, as a fraction of the last. 1.0 disables impulse falloff. */
  impulseDrScale: 0.5,
  /** Impulse never falls below this fraction of full. */
  impulseDrFloor: 0.25,
```

Add to `RAM_TICKS` (or create it, mirroring `SLAM_TICKS`):

```ts
export const RAM_TICKS = Object.freeze({
  uncontrol: msToTicks(RAM_CONFIG.ramUncontrolMs),
  drWindow: msToTicks(RAM_CONFIG.drWindowMs),
  durationFloor: msToTicks(RAM_CONFIG.durationDrFloorMs),
});
```

- [ ] **Step 2: Write the failing test**

Create `packages/server/src/sim/falloff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RAM_CONFIG, RAM_TICKS } from "@motor-combat-moba/shared";
import { nextFalloff, type FalloffStack } from "./falloff.js";

const VICTIM = "v1";

describe("ram falloff", () => {
  it("leaves the first ram at full strength", () => {
    const stack: FalloffStack = new Map();
    const out = nextFalloff(stack, VICTIM, 0);
    expect(out.durationScale).toBe(1);
    expect(out.impulseScale).toBe(1);
  });

  it("halves the second ram inside the window", () => {
    const stack: FalloffStack = new Map();
    nextFalloff(stack, VICTIM, 0);
    const out = nextFalloff(stack, VICTIM, 10);
    expect(out.durationScale).toBeCloseTo(RAM_CONFIG.durationDrScale);
    expect(out.impulseScale).toBeCloseTo(RAM_CONFIG.impulseDrScale);
  });

  it("compounds across a chain", () => {
    const stack: FalloffStack = new Map();
    nextFalloff(stack, VICTIM, 0);
    nextFalloff(stack, VICTIM, 5);
    const third = nextFalloff(stack, VICTIM, 10);
    expect(third.impulseScale).toBeCloseTo(RAM_CONFIG.impulseDrScale ** 2);
  });

  it("never falls below the impulse floor", () => {
    const stack: FalloffStack = new Map();
    for (let i = 0; i < 20; i++) nextFalloff(stack, VICTIM, i);
    expect(nextFalloff(stack, VICTIM, 20).impulseScale).toBeCloseTo(RAM_CONFIG.impulseDrFloor);
  });

  it("resets to full strength once the window lapses", () => {
    const stack: FalloffStack = new Map();
    nextFalloff(stack, VICTIM, 0);
    const later = nextFalloff(stack, VICTIM, 10_000);
    expect(later.durationScale).toBe(1);
  });

  it("rolls the window forward from each ram, not from the first", () => {
    const stack: FalloffStack = new Map();
    const window = RAM_TICKS.drWindow; // never recompute from ms and a literal tick rate
    nextFalloff(stack, VICTIM, 0);
    nextFalloff(stack, VICTIM, window - 1);        // just inside
    const third = nextFalloff(stack, VICTIM, window + 1); // past the FIRST window, inside the second
    expect(third.durationScale).toBeLessThan(1);
  });

  it("is per-victim: one car's chain does not protect another", () => {
    const stack: FalloffStack = new Map();
    nextFalloff(stack, VICTIM, 0);
    expect(nextFalloff(stack, "someone-else", 1).durationScale).toBe(1);
  });

  it("is global across attackers: who did the ramming is not recorded at all", () => {
    // The stack is keyed by victim only. Three cars taking turns is exactly the case this covers.
    const stack: FalloffStack = new Map();
    nextFalloff(stack, VICTIM, 0);
    expect(nextFalloff(stack, VICTIM, 1).durationScale).toBeLessThan(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run packages/server/src/sim/falloff.test.ts`
Expected: FAIL — `Failed to resolve import "./falloff.js"`.

- [ ] **Step 4: Write the implementation**

Create `packages/server/src/sim/falloff.ts`:

```ts
import { RAM_CONFIG, RAM_TICKS } from "@motor-combat-moba/shared";

/**
 * Per-victim diminishing returns on ramming.
 *
 * **Server-side only, and deliberately NOT a schema field.** This looks like an invariant 8
 * violation and is not: `stepSim` never reads the stack. It is consumed once, here, at the moment a
 * ram resolves, to scale the impulse and the duration BEFORE they are applied. What reaches the
 * client is the already-scaled result — a velocity change and a `reeling` status with a concrete
 * duration — both of which are networked already. It lives beside `slamImmuneUntil`, which is the
 * same shape of per-victim server map for the same reason.
 *
 * Keyed by victim and by nothing else. Who did the ramming is not recorded, because three cars
 * taking turns is the exact case this exists to defuse.
 */
export interface FalloffEntry {
  /** How many rams have landed inside the current rolling window. */
  count: number;
  /** Tick the window lapses. Each fresh ram pushes this out from itself. */
  expiresAtTick: number;
}

export type FalloffStack = Map<string, FalloffEntry>;

export interface FalloffScales {
  durationScale: number;
  impulseScale: number;
}

/**
 * Read the victim's current falloff and record this ram against it.
 *
 * MUTATES `stack` — it is both the read and the write, so a caller cannot accidentally scale a ram
 * without also counting it.
 */
export function nextFalloff(stack: FalloffStack, victimId: string, tick: number): FalloffScales {
  const standing = stack.get(victimId);
  const live = standing !== undefined && tick < standing.expiresAtTick;
  const count = live ? standing.count : 0;

  stack.set(victimId, { count: count + 1, expiresAtTick: tick + RAM_TICKS.drWindow });

  return {
    durationScale: Math.max(
      RAM_TICKS.durationFloor / RAM_TICKS.uncontrol,
      RAM_CONFIG.durationDrScale ** count,
    ),
    impulseScale: Math.max(RAM_CONFIG.impulseDrFloor, RAM_CONFIG.impulseDrScale ** count),
  };
}

/** Drop lapsed entries. Called from the room's per-tick sweep so the map cannot grow unbounded. */
export function sweepFalloff(stack: FalloffStack, tick: number): void {
  for (const [id, entry] of stack) {
    if (tick >= entry.expiresAtTick) stack.delete(id);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run packages/server/src/sim/falloff.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/sim/falloff.ts packages/server/src/sim/falloff.test.ts packages/shared/src/config/ram-config.ts
git commit -m "feat(sim): per-victim diminishing returns on ramming"
```

---

## Task 4: Wire falloff and `reeling` into the bridge

**Files:**
- Modify: `packages/server/src/sim/ram-bridge.ts`
- Test: `packages/server/src/sim/ram-bridge.test.ts`

**Interfaces:**
- Consumes: `nextFalloff`, `sweepFalloff`, `STATUS_TABLE.reeling`, `RAM_TICKS`.
- Produces: nothing new exported. The stack is owned by the room, one per room instance.

- [ ] **Step 1: Write the failing test**

```ts
describe("ram applies reeling, scaled by falloff", () => {
  it("gives a fresh victim the full uncontrol duration", () => {
    const room = harness();
    room.ram("attacker", "victim");
    expect(room.statusTicksOf("victim", "reeling")).toBe(RAM_TICKS.uncontrol);
  });

  it("gives a re-rammed victim a shorter one", () => {
    const room = harness();
    room.ram("attacker", "victim");
    room.advance(10);
    room.ram("attacker2", "victim");
    expect(room.statusTicksOf("victim", "reeling")).toBeLessThan(RAM_TICKS.uncontrol);
  });

  it("also shrinks the impulse on a re-ram, not only the duration", () => {
    const room = harness();
    const first = room.ramAndMeasureSpeedChange("attacker", "victim");
    room.advance(10);
    const second = room.ramAndMeasureSpeedChange("attacker2", "victim");
    expect(second).toBeLessThan(first);
  });

  it("does not apply reeling to the attacker", () => {
    const room = harness();
    room.ram("attacker", "victim");
    expect(room.statusTicksOf("attacker", "reeling")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/server/src/sim/ram-bridge.test.ts`
Expected: FAIL — no `reeling` is ever applied.

- [ ] **Step 3: Scale and apply**

In `ram-bridge.ts`, before applying each impulse:

```ts
  for (const [victimId, entry] of result.impulses) {
    const scales = nextFalloff(falloffStack, victimId, tick);

    const scaled: Impulse = {
      ...entry.impulse,
      speed: entry.impulse.speed * scales.impulseScale,
      uncontrolTicks: Math.max(
        RAM_TICKS.durationFloor,
        Math.round(RAM_TICKS.uncontrol * scales.durationScale),
      ),
    };

    writeBody(victimId, applyImpulse(bodyOf(victimId), massFor(victimId), scaled));
    applyStatus(victimId, "reeling", scaled.uncontrolTicks);

    // The reaction carries no uncontrol (see `reactionOf`) and is NOT counted against the
    // attacker's own falloff stack — being the attacker is not being rammed.
    writeBody(entry.attackerId, applyImpulse(bodyOf(entry.attackerId), massFor(entry.attackerId), reactionOf(scaled)));
  }
```

> **Only rams go through `nextFalloff`.** Slam impulses (and, from stage 4, weapon impulses) bypass
> the stack entirely and use their own `uncontrolTicks`. That is the user's explicit call: a victim
> who is stunned, then rammed, then slammed is unfortunate, and coordination is allowed to pay off.

Call `sweepFalloff(falloffStack, tick)` from the room's tick, beside the existing `slamImmuneUntil`
housekeeping.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sim/
git commit -m "feat(sim): apply reeling from rams, scaled by falloff"
```

---

## Task 5: Re-pitch the constants the new impulse scale invalidated

**Files:**
- Modify: `packages/shared/src/config/ram-config.ts`
- Test: `packages/shared/src/config/ram-config.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no new names. This task changes numbers and deletes dead ones.

> Three constants were calibrated against a world that no longer exists, and **none of them will fail
> a test if left alone.** That is what makes this task easy to skip and important not to.

- [ ] **Step 1: Widen the mass clamps**

```ts
  /**
   * Bounds on `referenceMass / victimMass`. Widened from 0.6/1.6 on 2026-09-06: both roster extremes
   * had drifted outside the old range (Bastion computed 0.56, Bullseye 1.67), so part of what mass
   * did was being clipped away before it reached the sim.
   */
  massFactorMin: 0.5,
  massFactorMax: 2.0,
```

- [ ] **Step 2: Re-derive `minApproachSpeed`**

It is 60 — about 11% of the *old* 449 u/s roster top speed, and its doc comment reasons about a
rebound that `applyContact` no longer produces the same way. Against the new 267 u/s ceiling, 60 is
22% and gates out rams that should land. Set it to `35` (about 13% of the new top speed) and rewrite
the comment to reason about **relative closing speed**, which is what it now measures.

- [ ] **Step 3: Re-pitch spin**

`spinScale` (100) and `spinMaxRate` (6.0) were tuned so that a solid flank ram landed near 2 rad/s
against an impulse capped at 260 u/s. Impulses are now momentum-derived and routinely larger, so
`spinMaxRate` will saturate on ordinary contacts and every ram will look identical.

Add a test that pins the *intent* rather than the number, so a future retune cannot silently
re-saturate it:

```ts
it("leaves an ordinary flank ram well short of the spin ceiling", () => {
  // A mid-severity flank hit should read as a spin, not as the maximum possible spin. If this
  // fails, spinScale is too high for the current impulse scale and every ram looks the same.
  const hit = resolveRam(midSpeedAttacker(), flankVictim(), "ffa");
  const spun = applyImpulse(victimBody(), 480, hit!.impulse);
  expect(Math.abs(spun.angVel)).toBeLessThan(RAM_CONFIG.spinMaxRate * 0.7);
});
```

Then lower `spinScale` until it passes. Record the value you land on and why in the config comment.

- [ ] **Step 4: Delete the dead fields**

`authorityFloor`, `authorityHalfLifeSeconds`, `authorityEpsilon`, `shoveHalfLifeSeconds` and
`shoveEpsilon` have no readers left — authority is the `reeling` status and shove is lateral
velocity. Delete them, and delete their entries from `RamDecay`, `resolveRamDecay`, `RAM_DECAY`,
`ramDecay()` and `rebuildRamDecay`.

**`counterSteerHalfLifeSeconds` and `spinHalfLifeSeconds` stay.** Both still govern `angVel`, which
this rework never touched, and `counterSteer` in particular is what makes countersteering out of a
spin a skill rather than a cosmetic.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config/ram-config.ts packages/shared/src/config/ram-config.test.ts
git commit -m "feat(balance): re-pitch ram constants against momentum-derived impulses"
```

---

> **Carried in from the stage 2 review (Tasks 3–4), not a new task.** The equal-and-opposite reaction
> that stage 2 shipped (`applyImpulse` + `reactionOf`) makes `RAM_CONFIG.knockMaxSpeed` and
> `SLAM_CONFIG.knockSpeed` cost the ATTACKER as well as the victim, and both constants were tuned
> before that existed — see the doc comments on those two config values for the measured numbers.
>
> **The final stage-2 re-review found the first pass of those numbers itself wrong, in a way that
> matters to whoever re-pitches these constants.** They were computed against `contactTick` run in
> isolation — the way `ram-bridge.test.ts` exercises it — which charges the reaction straight onto the
> attacker's PRE-collision speed. That is not the shipped order: `runPipeline`
> (`tick-pipeline.ts:80`) runs `serverTick` (drive + `resolveWorld`) BEFORE `contactTick`, and
> `resolveWorld` has already reflected the attacker's velocity by `DRIVE_CONFIG.restitution` (0.15) by
> the time the ram's reaction lands — measured to fire on 40/40 sampled sub-tick phases at every
> speed on this roster, not merely most of them. The two charges compose (reflect, then recoil on
> top), so the TRUE cost is roughly 5x worse for a ram and 2.8x worse for a slam than the
> isolated-`contactTick` numbers suggested:
>
> | case | isolated-`contactTick` figure (wrong) | actual, through the real order |
> |---|---|---|
> | Bastion full-severity ram | `190 → 34` (82% of top speed) | `190 → -184.5` — backwards at 97% of top speed |
> | Bastion Wild Charge slam | `190 → -122` (64% of top speed) | `190 → -340.5` — backwards at 1.8x top speed |
>
> `packages/server/src/sim/pipeline-order.test.ts` now pins the composed order for a ram, so this
> class of error fails a test rather than requiring a re-review to catch a second time. Task 5's
> mass-clamp widening above already answers the `massFactorMin/Max` half of the finding ("Bastion
> computed 0.56, Bullseye 1.67"); `knockMaxSpeed` itself is not named in Task 5 as written, and should
> be checked (and probably re-pitched) alongside `spinScale` in that task before this stage is called
> done — against the REAL composed numbers above, not the isolated ones. `SLAM_CONFIG.knockSpeed` is a
> separate number, moved onto `wildcharge.impulse.speed` in stage 4 — see `04-impulse-def.md` and spec
> P31, which already flags it as "the number most likely to be wrong and least likely to be noticed."

## Stage 3 exit criteria

- [ ] `npm test` passes from the repo root.
- [ ] `npm run dev` → Practice: ram the bot side-on at speed. It is thrown sideways, spins, and
      visibly cannot steer or accelerate for about a second.
- [ ] Ram a bot that is *fleeing* at your own speed: it barely moves. Ram one coming *at* you: it is
      launched.
- [ ] Ram the same bot three times in quick succession: the third barely registers.
- [ ] Wait three seconds and ram again: full strength returns.
