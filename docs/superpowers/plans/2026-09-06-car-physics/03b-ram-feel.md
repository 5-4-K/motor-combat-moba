# Stage 3b: Ram Feel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a rammed car a real (but not frozen) loss of control, stop coordinated attackers from
ram-locking a victim, and re-pitch the two constants the contest's new impulse scale invalidated.

**Architecture:** `reeling` is a new status carried on the existing duration layer — flung and
sliding, not frozen, unlike `stunned`. A server-side per-victim falloff stack scales both the impulse
and the `reeling` duration of successive rams inside a rolling window, so a chain of hits diminishes
without needing an immunity state. Neither mechanism cares how an impulse's magnitude was computed —
they operate on `Impulse.speed` and a duration after stage 3's contest has already produced them —
which is what let them survive the rewrite from equal-and-opposite impulses to a contest largely
intact.

**Tech Stack:** TypeScript, npm workspaces, Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-06-car-physics-rework-design.md`](../../specs/2026-09-06-car-physics-rework-design.md)
— **P21–P25b** (the `reeling` status, falloff, and re-pitching spin), unchanged by revision 2. Read
the Changelog and R1–R11 first if you have not already: this plan builds directly on stage 3's
contest, not on the equal-and-opposite model P21–P25b were originally written against.

**Ledger:** [`interfaces.md`](interfaces.md) — outranks this plan. Read it before Task 1.

**Depends on:** Stage 3 executed (`03-ram.md`). `mass` is gone; `CarDef.ramAttack`/`ramDefence` and
their accessors exist; `RamCar` carries `vx`/`vy` and `defenceMult`; `resolveRam` produces
`RamHit.impulse` (the victim's) and `RamHit.attackerImpulse` (the attacker's, computed independently
— there is no `reactionOf`); `ImpulseEntry` carries `{ attackerId, impulse, attackerImpulse }`, with
`severity` gone; `applyImpulse(body, ramDefence, imp)` divides by `ramDefence` only when
`imp.defenceScaled` is true; `RAM_CONFIG.defencePushScale` and `globalScale` are set and measured;
`minApproachSpeed` and the (absent) ceiling ship inactive per R9. `Impulse.uncontrolTicks` is authored
`0` everywhere stage 3 builds one — this stage is what fills it in.

## Global Constraints

Identical to `03-ram.md`'s — see
[`03-ram.md#global-constraints`](03-ram.md#global-constraints). Repeated here because they bite
hardest in this stage too:

- `TICK_RATE_HZ` lives once in `@motor-combat-moba/shared`. Never redefine it.
- No magic numbers in logic. Every constant comes from `shared/config`. Frozen test fixtures are the
  deliberate exception.
- `stepSim` is the lockstep: server and client import the same function. Neither half may be
  reordered or skipped on one side only.
- **Invariant 8:** if `stepSim` reads it, it is a networked schema field. The falloff stack this
  stage adds is the deliberate counter-example — see Task 2.
- Durations authored in milliseconds or seconds and converted to ticks **once**.
- `stepDrive` must never read `CAR_TABLE`. It receives a resolved `ChassisDrive`.
- **Edge-triggered contact is retained (spec P25).** A ram fires only on the tick a pair *enters*
  contact. Nothing in this stage touches `resolveContacts`'s `previous`-set guard.
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
| `packages/shared/src/config/status-types.ts` | `StatusId` gains `"reeling"`. | Modify |
| `packages/shared/src/config/status-config.ts` | The `reeling` row. | Modify |
| `packages/shared/src/config/ram-config.ts` | Falloff knobs; `RAM_TICKS`; dead `authority`/`shove` fields deleted. `spinScale`/`spinMaxRate` re-pitch is **already done** — stage 3 Task 4 performed it under spec P25b (`spinScale` 100 → 10, `spinMaxRate` left at 6.0) — see Task 4 below. | Modify |
| `packages/server/src/sim/ram-bridge.ts` | `FalloffEntry`/`FalloffStack`/`nextFalloff`/`sweepFalloff`; `ContactMemory.falloff`; applies `reeling`, scaled by falloff, to ram victims only. | Modify |
| `packages/shared/src/sim/ram.test.ts` | Face-bonus pinning tests against the contest's real magnitudes. (A spin band was already re-derived and pinned by stage 3 Task 4 — see Task 4 below — so this file's spin coverage may only need extending, not authoring from scratch.) | Modify |
| `packages/shared/src/config/ram-config.test.ts` | Drop assertions on the five deleted `authority`/`shove` fields. (`spinScale`/`spinMaxRate` are already pinned as of stage 3 Task 4.) | Modify |

---

## Task 1: The `reeling` status

Unchanged in substance from the version of this plan written before revision 2 — `reeling` is about
what happens *after* an impulse lands, and does not care how its magnitude was computed.

**Files:**
- Modify: `packages/shared/src/config/status-types.ts`
- Modify: `packages/shared/src/config/status-config.ts`
- Test: `packages/shared/src/config/status-config.test.ts`

**Interfaces:**
- Consumes: `STATUS_LIMITS` (existing).
- Produces: `StatusId` includes `"reeling"`; `STATUS_TABLE.reeling`.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/config/status-config.test.ts`:

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

  it("sits exactly at the STATUS_LIMITS floors, not below them (spec P22)", () => {
    expect(STATUS_TABLE.reeling.modifiers.turnRate).toBe(STATUS_LIMITS.turnRate.min);
    expect(STATUS_TABLE.reeling.modifiers.accel).toBe(STATUS_LIMITS.accel.min);
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
   * the falloff stack (Task 2) needs. Adding a flag here would silently break diminishing returns.
   *
   * Both multipliers sit AT the `STATUS_LIMITS` floors, deliberately (spec P22). Do not lower those
   * floors to make this harsher: they are documented guarantees, and widening one for a single row
   * is how a guarantee stops guaranteeing. The helplessness here comes from the physics rather than
   * the debuff — a car sliding sideways with saturated tyres is already a passenger, courtesy of
   * `DRIVE_CONFIG.impactGripDecel` (P11) doing the real work. `accel: 0.4` is the friction-circle
   * stagger on top: while the tyres fight the slide there is little grip left for the engine, so a
   * big hit visibly bogs you.
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
git add packages/shared/src/config/status-config.ts packages/shared/src/config/status-types.ts \
        packages/shared/src/config/status-config.test.ts
git commit -m "feat(status): add reeling, the ram control-loss status"
```

---

## Task 2: The falloff stack

**Adapted from the version of this plan written before revision 2.** The mechanism is unchanged —
per-victim, global across attackers, a rolling window, multiplicative with a floor, ram-only — because
falloff scales *whatever* impulse a ram produced, not the contest that produced it. The one real
adaptation is structural, not behavioural: **the ledger (`interfaces.md`) places `FalloffEntry`/
`FalloffStack` directly in `ram-bridge.ts`**, beside `SlamRecord` and `ContactMemory`, rather than in
a standalone `falloff.ts` file the way an earlier draft of this plan did. That mirrors how
`slamImmuneUntil`-style state already lives in this file, and the ledger outranks that earlier draft.

**Files:**
- Modify: `packages/shared/src/config/ram-config.ts`
- Modify: `packages/server/src/sim/ram-bridge.ts`
- Test: `packages/server/src/sim/ram-bridge.test.ts`

**Interfaces:**
- Consumes: nothing new from stage 3.
- Produces: `RAM_CONFIG` falloff knobs; `RAM_TICKS: { uncontrol, drWindow, durationFloor }`;
  `FalloffEntry`, `FalloffStack`, `nextFalloff(stack, victimId, tick)`,
  `sweepFalloff(stack, tick)` exported from `ram-bridge.ts`; `ContactMemory.falloff: FalloffStack`,
  initialised by `newContactMemory()`.

- [ ] **Step 1: Add the knobs**

In `ram-config.ts`, beside the existing fields:

```ts
  /** Full-strength `reeling` duration from a ram, before falloff. Weapons author their own (stage 4). */
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

Add `RAM_TICKS` at the bottom of the file, mirroring the existing `SLAM_TICKS`/`WEAPON_TICKS`
pattern — authored milliseconds converted to whole ticks exactly once, at module load:

```ts
import { msToTicks } from "./weapon-ticks.js";

export const RAM_TICKS: Readonly<{ uncontrol: number; drWindow: number; durationFloor: number }> =
  Object.freeze({
    uncontrol: msToTicks(RAM_CONFIG.ramUncontrolMs),
    drWindow: msToTicks(RAM_CONFIG.drWindowMs),
    durationFloor: msToTicks(RAM_CONFIG.durationDrFloorMs),
  });
```

- [ ] **Step 2: Write the failing test**

In `packages/server/src/sim/ram-bridge.test.ts`, add:

```ts
import { RAM_TICKS } from "@motor-combat-moba/shared";
import { newFalloffStack, nextFalloff, sweepFalloff } from "./ram-bridge.js";

const VICTIM = "v1";

describe("ram falloff", () => {
  it("leaves the first ram at full strength", () => {
    const stack = newFalloffStack();
    const out = nextFalloff(stack, VICTIM, 0);
    expect(out.durationScale).toBe(1);
    expect(out.impulseScale).toBe(1);
  });

  it("halves the second ram inside the window", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    const out = nextFalloff(stack, VICTIM, 10);
    expect(out.durationScale).toBeCloseTo(RAM_CONFIG.durationDrScale);
    expect(out.impulseScale).toBeCloseTo(RAM_CONFIG.impulseDrScale);
  });

  it("compounds across a chain", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    nextFalloff(stack, VICTIM, 5);
    const third = nextFalloff(stack, VICTIM, 10);
    expect(third.impulseScale).toBeCloseTo(RAM_CONFIG.impulseDrScale ** 2);
  });

  it("never falls below the impulse floor", () => {
    const stack = newFalloffStack();
    for (let i = 0; i < 20; i++) nextFalloff(stack, VICTIM, i);
    expect(nextFalloff(stack, VICTIM, 20).impulseScale).toBeCloseTo(RAM_CONFIG.impulseDrFloor);
  });

  it("resets to full strength once the window lapses", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    const later = nextFalloff(stack, VICTIM, 10_000);
    expect(later.durationScale).toBe(1);
  });

  it("rolls the window forward from each ram, not from the first", () => {
    const stack = newFalloffStack();
    const window = RAM_TICKS.drWindow; // never recompute from ms and a literal tick rate
    nextFalloff(stack, VICTIM, 0);
    nextFalloff(stack, VICTIM, window - 1);        // just inside
    const third = nextFalloff(stack, VICTIM, window + 1); // past the FIRST window, inside the second
    expect(third.durationScale).toBeLessThan(1);
  });

  it("is per-victim: one car's chain does not protect another", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    expect(nextFalloff(stack, "someone-else", 1).durationScale).toBe(1);
  });

  it("is global across attackers: who did the ramming is not recorded at all", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    expect(nextFalloff(stack, VICTIM, 1).durationScale).toBeLessThan(1);
  });

  it("sweeps lapsed entries so the map cannot grow unbounded", () => {
    const stack = newFalloffStack();
    nextFalloff(stack, VICTIM, 0);
    sweepFalloff(stack, 10_000);
    expect(stack.size).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run packages/server/src/sim/ram-bridge.test.ts -t "ram falloff"`
Expected: FAIL — `nextFalloff` is not exported from `ram-bridge.ts`.

- [ ] **Step 4: Add the stack to `ram-bridge.ts`**

Beside `SlamRecord`:

```ts
/**
 * Per-victim diminishing returns on ramming (spec P24).
 *
 * **Server-side only, and deliberately NOT a schema field.** This looks like an invariant 8
 * violation and is not: `stepSim` never reads the stack. It is consumed once, here, at the moment a
 * ram resolves, to scale the impulse and the duration BEFORE they are applied. What reaches the
 * client is the already-scaled result — a velocity change and a `reeling` status with a concrete
 * duration — both of which are networked already. It lives beside `SlamRecord`/`slammed` above,
 * which is the same shape of per-victim server map for the same reason.
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

export function newFalloffStack(): FalloffStack {
  return new Map();
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

/** Drop lapsed entries so the map cannot grow unbounded across a long match. */
export function sweepFalloff(stack: FalloffStack, tick: number): void {
  for (const [id, entry] of stack) {
    if (tick >= entry.expiresAtTick) stack.delete(id);
  }
}
```

Add `RAM_CONFIG` and `RAM_TICKS` to this file's imports from `@motor-combat-moba/shared`.

- [ ] **Step 5: Wire the stack into `ContactMemory`**

```ts
export interface ContactMemory {
  contacts: Set<string>;
  slammed: Map<string, SlamRecord>;
  /** Per-victim ram falloff (spec P24/P24a). Same lifetime and reasoning as `slammed`. */
  falloff: FalloffStack;
}

export function newContactMemory(): ContactMemory {
  return { contacts: new Set(), slammed: new Map(), falloff: newFalloffStack() };
}
```

Sweep it in `contactTick`, right where `memory.contacts` is reassigned:

```ts
  memory.contacts = contacts;
  sweepFalloff(memory.falloff, tick);
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run packages/server/src/sim/ram-bridge.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/sim/ram-bridge.ts packages/server/src/sim/ram-bridge.test.ts \
        packages/shared/src/config/ram-config.ts
git commit -m "feat(sim): per-victim diminishing returns on ramming"
```

---

## Task 3: Wire falloff and `reeling` into the bridge

**The heaviest adaptation in this plan.** The pre-revision-2 version of this task applied one
impulse to the victim and `reactionOf` of it to the attacker. Neither piece of that survives: stage 3
deleted `reactionOf` outright (R7), and each car's outcome — `entry.impulse` for the victim,
`entry.attackerImpulse` for the attacker — is now computed independently by the contest. This task
also has to solve something the pre-revision-2 draft never had to, because it assumed a dedicated
`room.ram(...)` test harness that does not exist in this codebase: **`resolveContacts`'s `impulses`
map holds both ram entries and slam entries**, and P24 is explicit that falloff is ram-only. The two
must be told apart inside `contactTick` itself.

**Files:**
- Modify: `packages/server/src/sim/ram-bridge.ts`
- Test: `packages/server/src/sim/ram-bridge.test.ts`

**Interfaces:**
- Consumes: `nextFalloff`, `RAM_TICKS.uncontrol`/`durationFloor` (Task 2), `STATUS_TABLE.reeling`
  (Task 1), `entry.impulse`/`entry.attackerImpulse` and `defenceFor` (stage 3).
- Produces: nothing new exported. `contactTick` now applies `reeling` to a rammed victim, scaled by
  its falloff stack.

- [ ] **Step 1: Write the failing test**

In `packages/server/src/sim/ram-bridge.test.ts`, using the same `arena()`/`addPlayer()`/
`approachVelocities()` harness the rest of the file already uses (there is no separate room harness
in this codebase — `contactTick` is exercised directly against plain `ArenaState`/`PlayerState`):

```ts
describe("contactTick applies reeling to a ram victim, scaled by falloff", () => {
  it("gives a freshly rammed victim the full RAM_TICKS.uncontrol duration", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    const reeling = readStatuses(victim).find((s) => s.statusId === "reeling");
    expect(reeling).toBeDefined();
    expect(reeling!.endsTick - 10).toBe(RAM_TICKS.uncontrol);
  });

  it("gives a re-rammed victim a shorter reeling duration than the first ram", () => {
    const state = arena();
    const memory = newContactMemory();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    const first = readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 10;

    // Force a fresh contact episode on the SAME memory (and so the same falloff stack) without
    // re-deriving the geometry a real separate-and-return would need: `resolveContacts` keys the
    // "fresh touch" edge-trigger off `memory.contacts`, so clearing it is the direct way to
    // simulate re-approach.
    memory.contacts = new Set();
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 11,
    );
    const second = readStatuses(victim).find((s) => s.statusId === "reeling")!.endsTick - 11;

    expect(second).toBeLessThan(first);
  });

  it("also shrinks the impulse on a re-ram, not only the duration", () => {
    const state = arena();
    const memory = newContactMemory();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    const first = Math.abs(victim.vx);

    victim.x = 47; victim.y = 400; victim.vx = 0; victim.vy = 0;
    attacker.vx = 540;
    memory.contacts = new Set();
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 11,
    );
    const second = Math.abs(victim.vx);

    expect(second).toBeLessThan(first);
  });

  it("does not apply reeling to the attacker", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 540 });
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS,
      approachVelocities(state), NO_MANEUVER_WEAPONS, 10,
    );
    expect(readStatuses(attacker).find((s) => s.statusId === "reeling")).toBeUndefined();
  });

  it("does not run a slam through the ram falloff stack or scale its uncontrol", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, vx: 300 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS,
      new Map([["a", { vx: 300, vy: 0 }], ["b", { vx: 0, vy: 0 }]]),
      new Map<string, WeaponId | "">([["a", "wildcharge"]]), 10,
    );
    // A slam's own control-loss is authored on wildcharge's own row in stage 4 (currently 0, per
    // `contact.ts`'s slam branch). Falloff and this stage's ram-only `reeling` scaling must not
    // invent a stand-in for it — see the note under Step 3.
    expect(readStatuses(victim).find((s) => s.statusId === "reeling")).toBeUndefined();
  });
});
```

`approachVelocities` is a small helper mirroring the file's existing (pre-stage-3) `approachSpeeds`,
now returning the pair `TickResult.approachVelocities` supplies:

```ts
function approachVelocities(state: ArenaState): Map<string, { vx: number; vy: number }> {
  const out = new Map<string, { vx: number; vy: number }>();
  state.players.forEach((p, id) => out.set(id, { vx: p.vx, vy: p.vy }));
  return out;
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/server/src/sim/ram-bridge.test.ts -t "reeling"`
Expected: FAIL — no `reeling` is ever applied.

- [ ] **Step 3: Apply reeling, scaled by falloff, to ram victims only**

In `contactTick`'s impulses loop, distinguish a ram entry from a slam entry using
`events.slams` — the one fact already available that says which victims were slammed this tick — and
scale only the former:

```ts
  const slammedVictims = new Set(events.slams.map((s) => s.targetSessionId));

  for (const [victimId, entry] of impulses) {
    const isRam = !slammedVictims.has(victimId);

    // Falloff and the RAM_TICKS-derived uncontrol duration are ram-only (spec P24's final bullet:
    // "Weapon impulses do not participate and do not share the stack"). A slam's own impulse
    // already carries whatever `uncontrolTicks` its own weapon authored (0 until stage 4 wires
    // wildcharge's ImpulseDef) and must pass through untouched, or this stage would invent a stand-in
    // for a control-loss duration that is stage 4's decision to make, not this one's.
    const scaledImpulse: Impulse = isRam
      ? (() => {
          const scales = nextFalloff(memory.falloff, victimId, tick);
          return {
            ...entry.impulse,
            speed: entry.impulse.speed * scales.impulseScale,
            uncontrolTicks: Math.max(
              RAM_TICKS.durationFloor,
              Math.round(RAM_TICKS.uncontrol * scales.durationScale),
            ),
          };
        })()
      : entry.impulse;

    const victim = state.players.get(victimId);
    if (victim) {
      const next = applyImpulse(victim, defenceFor(state, statusMods, victimId), scaledImpulse);
      victim.vx = next.vx;
      victim.vy = next.vy;
      victim.angVel = next.angVel;
      if (isRam) {
        writeStatuses(
          victim,
          applyStatus(readStatuses(victim), "reeling", tick, scaledImpulse.uncontrolTicks, entry.attackerId),
        );
      }
    }

    const attacker = state.players.get(entry.attackerId);
    if (attacker) {
      const next = applyImpulse(attacker, defenceFor(state, statusMods, entry.attackerId), entry.attackerImpulse);
      attacker.vx = next.vx;
      attacker.vy = next.vy;
      attacker.angVel = next.angVel;
    }
  }
```

> **Why falloff scales only the victim's half, never `entry.attackerImpulse`.** Falloff exists to
> stop a *victim* being ram-locked — chained into a stunlock by repeated hits that each land at full
> strength. The attacker's own impulse is the cost of throwing the punch: it is charged in full every
> time, regardless of how many rams the victim has recently absorbed. Discounting it too would mean
> spamming rams into an already-worn-down victim gets progressively *safer* for the attacker, which is
> the opposite of what a diminishing-returns mechanic should do to the aggressor. Nothing in the
> victim's falloff stack is even visible from the attacker's side of the contest — `nextFalloff` is
> keyed by victim id and never consulted when building `entry.attackerImpulse` — so this is not a
> flag to remember to check; there is no path by which the attacker's impulse could be scaled by it.

`applyStatus` refuses a duration of zero or less outright (see its own doc comment), so a slam's
`uncontrolTicks: 0` passing through the non-ram branch never risks writing a zero-length `reeling`;
this stage simply never calls `applyStatus` for a slam victim at all.

`RAM_TICKS`, `nextFalloff`, `Impulse`, `applyStatus`, `readStatuses` and `writeStatuses` need adding
to this file's imports if not already present from Task 2.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sim/ram-bridge.ts packages/server/src/sim/ram-bridge.test.ts
git commit -m "feat(sim): apply reeling from rams, scaled by falloff"
```

---

## Task 4: Pin the face bonuses, delete the dead `RAM_CONFIG` fields

**The old plan's Task 5, not carried across — adapted, per the assignment.** Its widening of the mass
clamps and its re-derivation of `minApproachSpeed` are both moot: `massFactorMin`/`massFactorMax` are
deleted outright by stage 3 (R1), never widened, and `minApproachSpeed` ships at `0` and inactive by
stage 3 (R9). What survives from that old task, genuinely still open, is the five dead
`authority`/`shove` fields stage 3 left standing (`03-ram.md`'s own Task 4 deletes only the
mass-family names, not these). This task also adds something the old draft did not need: a pinning
test for R6's headline claim, now that a real `globalScale` exists to measure it against.

**The spin re-pitch this task originally planned (Step 3 below) is DONE — stage 3 Task 4 performed
it under spec P25b, not this stage.** `spinScale` moved 100 → 10; `spinMaxRate` was deliberately left
at 6.0 (it is the target `spinScale` was solved against). Measured, victim spin at 10, by lever arm
(clamped at the 24 u hull half-length): an ordinary Mirage-on-Mirage flank ram spans 0.34 rad/s at 4 u
to 2.06 at the clamp; the hardest ram in the roster — Bastion flanking a Bullseye at the clamp —
reaches 5.95 rad/s, 99% of the 6.0 ceiling without pinning it. `ram.test.ts` already carries a
re-derived spin band from this measurement (a 267 u/s Mirage-on-Mirage flank fixture, asserted
0.9–1.2 rad/s) and a separate test pinning the genuine `spinMaxRate` clamp. Step 3 below is kept as a
record of the reasoning, not a to-do: **do not lower `spinScale` again** without first checking
whether the goal is a real re-tune (a config value change, out of this task's scope) rather than
finishing something already finished.

**Files:**
- Modify: `packages/shared/src/config/ram-config.ts`
- Modify: `packages/shared/src/config/ram-config.test.ts`
- Modify: `packages/shared/src/sim/ram.test.ts`

**Interfaces:**
- Consumes: `RAM_CONFIG.spinScale`/`spinMaxRate`, `ramDefenceOf`, `resolveRam`, `applyImpulse` (all
  from stage 3).
- Produces: no new names. This task changes numbers and deletes dead ones.

- [ ] **Step 1: Delete the dead `authority`/`shove` fields**

`authorityFloor`, `authorityHalfLifeSeconds`, `authorityEpsilon`, `shoveHalfLifeSeconds` and
`shoveEpsilon` have carried "INERT — stage 3 deletes it" comments since the vector-drive rework, but
`03-ram.md`'s Task 4 (which removes `mass` and its family) never actually touches them. Delete them
now, along with their entries in `RamDecay`, `resolveRamDecay`, `RAM_DECAY`, `ramDecay()` and
`rebuildRamDecay`:

```ts
export interface RamDecay {
  spin: number;
  counterSteer: number;
}

function resolveRamDecay(): Readonly<RamDecay> {
  return Object.freeze({
    spin: halfLifeToPerTick(RAM_CONFIG.spinHalfLifeSeconds),
    counterSteer: halfLifeToPerTick(RAM_CONFIG.counterSteerHalfLifeSeconds),
  });
}
```

**`spinHalfLifeSeconds` and `counterSteerHalfLifeSeconds` stay.** Both still govern `angVel`, which
this rework never touches, and `counterSteerHalfLifeSeconds` in particular is "the one constant that
makes countersteering a skill rather than a cosmetic."

In `ram-config.test.ts`, delete any assertion on the five removed fields (by the time this task runs,
stage 3 has already rewritten this file's mass-related assertions; remove whatever remains that reads
`authorityFloor` or the other four — a test for a deleted field is not a test).

- [ ] **Step 2: Run to verify the deletions compile clean**

Run: `npx vitest run packages/shared/src/config/`
Expected: PASS, with no reference to the five deleted names anywhere in `packages/`.

- [x] **Step 3: Re-pitch `spinScale`/`spinMaxRate` against the contest's real magnitudes — DONE by
      stage 3 Task 4 (spec P25b), landed at `spinScale: 10`, `spinMaxRate: 6.0` (unchanged). Kept
      below for the reasoning record only.**

`spinScale` (100) and `spinMaxRate` (6.0) were calibrated by feel against an impulse capped at a
`knockMaxSpeed` of 260 and divided by a *mass* in the 300–900 range. Both halves of that calibration
are gone: impulses are now contest-derived and routinely larger (R9 — the whole point of dropping the
saturating 0–1 fraction), and `nextSpin`'s inertia term now reads `ramDefence` (0–100), not mass, so
the same torque produces a much larger angular rate unless `spinScale` comes down to compensate.

In `packages/shared/src/sim/ram.test.ts`, add `ramDefenceOf` to the existing import from
`../config/car-config.js`, then add a test that pins the *intent* rather than a specific number, so a
future retune cannot silently re-saturate it:

```ts
it("leaves an ordinary flank ram well short of the spin ceiling", () => {
  // A solid flank hit — Bastion at full speed into a stationary Bullseye's side — should read as A
  // spin, not THE maximum possible spin. If this fails, spinScale is too high for the impulse scale
  // the contest now produces (spec P25b); lower it, do not raise the ceiling.
  const attacker: RamCar = {
    sessionId: "a", team: 0, x: 0, y: 0, angle: 0,
    vx: forwardMaxSpeedOf("bastion"), vy: 0,
    carId: "bastion" as CarId, defenceMult: 1,
  };
  const victim: RamCar = {
    sessionId: "b", team: 0, x: 47, y: 0, angle: Math.PI / 2,
    vx: 0, vy: 0, carId: "bullseye" as CarId, defenceMult: 1,
  };
  const hit = resolveRam(attacker, victim, "ffa");
  expect(hit).not.toBeNull();

  const spun = applyImpulse(bodyAt(47, 0, Math.PI / 2), ramDefenceOf("bullseye"), hit!.impulse);
  expect(Math.abs(spun.angVel)).toBeLessThan(RAM_CONFIG.spinMaxRate * 0.7);
});
```

Run it, and lower `spinScale` until it passes. Record the value you land on, and why, in the config
comment — the same discipline `globalScale`'s own comment already follows for its measurement.

- [ ] **Step 4: Pin R6's headline claim — a head-on lands meaningfully softer than a T-bone**

R6 is what makes a head-on gentler than a T-bone: both cars score their *own* presented face, so a
head-on scores `bonusFront` (0.3) on both sides where a T-bone scores the victim's `bonusFlank` (1.0)
against the attacker's `bonusFront`. Nothing pins that outcome against the real, measured
`globalScale` yet. Add, in `ram.test.ts`:

```ts
it("makes a head-on meaningfully gentler than a T-bone at the same closing speed (R6)", () => {
  // T-bone: attacker drives +x into a victim sitting broadside. The victim presents its flank
  // (bonusFlank 1.0); the attacker presents its nose (bonusFront 0.3).
  const tBone = resolveRam(
    { sessionId: "a", team: 0, x: 0, y: 0, angle: 0, vx: 200, vy: 0, carId: "mirage" as CarId, defenceMult: 1 },
    { sessionId: "b", team: 0, x: 47, y: 0, angle: Math.PI / 2, vx: 0, vy: 0, carId: "mirage" as CarId, defenceMult: 1 },
    "ffa",
  );
  // Head-on: same closing speed (100 + 100 = 200, matching the T-bone's 200), but both cars face
  // each other along the same line, so BOTH score bonusFront — the credit R6 gives that revision 1
  // never did.
  const headOn = resolveRam(
    { sessionId: "a", team: 0, x: 0, y: 0, angle: 0, vx: 100, vy: 0, carId: "mirage" as CarId, defenceMult: 1 },
    { sessionId: "b", team: 0, x: 47, y: 0, angle: Math.PI, vx: -100, vy: 0, carId: "mirage" as CarId, defenceMult: 1 },
    "ffa",
  );

  expect(tBone).not.toBeNull();
  expect(headOn).not.toBeNull();
  // The spec's own worked table puts a head-on at roughly 12% of a T-bone at equal closing speed
  // (up to ~25% at a head-on's typically higher real closing speed). Pinned as a RATIO, which is
  // invariant to globalScale, defencePushScale and any future ramAttack/ramDefence retune — not as
  // absolute figures, which move with all three.
  expect(headOn!.impulse.speed).toBeLessThan(tBone!.impulse.speed * 0.3);
});
```

- [ ] **Step 5: Run the full gate**

Run: `npm test` then `npm run typecheck`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config/ram-config.ts packages/shared/src/config/ram-config.test.ts \
        packages/shared/src/sim/ram.test.ts
git commit -m "feat(balance): re-pitch spin, delete dead ram-config fields, pin R6's head-on/T-bone ratio"
```

---

## Stage 3b exit criteria

- [ ] `npm test`, `npm run typecheck` and `npm run build` all pass from the repo root.
- [ ] `authorityFloor`, `authorityHalfLifeSeconds`, `authorityEpsilon`, `shoveHalfLifeSeconds` and
      `shoveEpsilon` appear nowhere in `packages/`.
- [ ] `npm run dev` → Practice: ram the bot side-on at speed. It is thrown sideways, spins, and
      visibly cannot steer or accelerate for about a second — but it can still shoot back.
- [ ] Ram a bot that is *fleeing* at your own speed: it barely moves. Ram one coming *at* you: it is
      launched.
- [ ] Ram the same bot three times in quick succession: the third barely registers.
- [ ] Wait three seconds and ram again: full strength returns.
- [ ] Wildcharge a bot: it does not gain `reeling` from the slam itself (stage 4 wires its own
      control-loss duration onto `wildcharge`'s `ImpulseDef`) — this stage's falloff and `reeling`
      apply to ordinary rams only, exactly as spec P24's last bullet requires.

**Not done in this stage, deliberately:** `wildcharge`'s own `uncontrolMs` and the rest of the
`ImpulseDef` seam. That is stage 4 (`04-impulse-def.md`).
