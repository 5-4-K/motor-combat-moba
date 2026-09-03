# Game Balance Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless harness that runs N complete matches with bots and reports per-car and per-weapon performance, so a balance pass has evidence instead of a feeling.

**Architecture:** Three layers, built bottom-up. (1) An opt-in `fired`/`damaged`/`killed` event sink threaded through shared `runCombat` — observation only, zero cost when absent. (2) A stateful `BotController` behind a perception-fair `BotView`, replacing the duplicated bot driver in `PracticeRoom` and `PlaygroundRoom` and serving the harness as a third host. (3) `packages/server/balance/` — a match runner assembled from `tick-pipeline.ts`, two match shapes, statistics with confidence intervals, and a report with full provenance.

**Tech Stack:** TypeScript (ESM, strict), npm workspaces, Vitest, `tsx` for script entry points. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-09-03-game-balance-harness-design.md`](../specs/2026-09-03-game-balance-harness-design.md) — decisions **B1–B52** (plus B5a, B8a, B26a, B28a). The plan argues from the spec; read both.

## Global Constraints

- **B1 — the harness must not change what it measures.** `golden.test.ts` and the full combat suite must pass **unchanged** after the event seam. If a pinned number moves, the seam is wrong, not the test.
- **Invariant 2** — no magic numbers in logic; balance comes from `shared/config`.
- **Invariant 3** — clients send inputs, never state. A bot is a client; it authors `InputMessage`s and nothing else.
- **Invariant 8** — if `stepSim` reads it, it is a networked schema field. Nothing added by this plan is read by `stepSim`, so **nothing here becomes a schema field**. `pressId`, `maneuverPressId` and every event are sim/server-only.
- **Shared `dist` gotcha** — server and client consume built shared. After editing `packages/shared/src`, run `npm run build -w @motor-combat-moba/shared`. Build with root `npm run build`, **never** `npm run build --workspaces`.
- **Branch** — all work lands on `development/main`. "main" always means `development/main`.
- **`BOT_PROFILES` is not retuned by this plan.** `hard` is frozen and pinned by value in `bot.test.ts`. The three new latency knobs default to no-ops (B19).
- **Bot decision logic is out of scope.** `LegacyController` reproduces today's behaviour exactly (B22). A separate session owns bot intelligence.
- **Docs off limits:** never read, cite or plan against `docs/ideas/` or `docs/invariants/`.
- **Commit style:** end every commit message with the two attribution lines used by this repo's recent history (`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and the `Claude-Session:` line).

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/sim/combat-events.ts` | **NEW.** Event types, `DamageSource` union, `newCombatEvents()`. Types only — no logic that could alter the sim. |
| `packages/shared/src/sim/weapons/fire.ts` | **EDIT.** `pressId` on `PendingFire`; `beginFire` mints it. |
| `packages/shared/src/sim/weapons/instances.ts` | **EDIT.** `pressId` on `WeaponInstance`; `spawnInstances` carries it. |
| `packages/shared/src/sim/combat.ts` | **EDIT.** `maneuverPressId` on `CombatPlayer`; `detonate` inherits `pressId`; four emit points behind an optional sink. |
| `packages/server/src/bot/` | **NEW.** Mode-agnostic bot module: `types.ts`, `rng.ts`, `view.ts`, `controller.ts`, `input.ts` (moved `rooms/bot.ts`), `index.ts`. Imports no room types. |
| `packages/server/src/rooms/PlaygroundRoom.ts`, `PracticeRoom.ts` | **EDIT.** Both migrate onto `BotController`. |
| `packages/server/src/run-dir.ts` | **NEW.** Dated `NN` run-folder helper, lifted out of `playtest/reporter.ts` so playtest and balance share one implementation. |
| `packages/server/balance/` | **NEW.** `match.ts`, `runner.ts`, `stats.ts`, `attribution.ts`, `report.ts`, `baseline.ts`, `fingerprint.ts`, `cli.ts`, `run.ts`, `tsconfig.json`, `README.md`. Sibling of `playtest/` (B46). |

**Why this decomposition:** the event seam is pure shared-sim plumbing and must land first because everything downstream reads it. The bot seam is a behaviour-preserving refactor with existing tests as its safety net, independent of the harness. The harness consumes both and is the only place with new logic worth arguing about.

---

## Phase A — The combat event seam (shared)

### Task 1: Event types

**Files:**
- Create: `packages/shared/src/sim/combat-events.ts`
- Test: `packages/shared/src/sim/combat-events.test.ts`
- Modify: `packages/shared/src/index.ts` (export the new module)

**Interfaces:**
- Consumes: `WeaponId` from `../config/weapon-types.js`, `StatusId` from `../config/status-types.js`, `CarId` from `../config/types.js`.
- Produces: `CombatEvents`, `FiredEvent`, `DamagedEvent`, `KilledEvent`, `DamageSource`, `newCombatEvents()`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/sim/combat-events.test.ts
import { describe, expect, it } from "vitest";
import { newCombatEvents } from "./combat-events.js";

describe("newCombatEvents", () => {
  it("starts with three empty logs", () => {
    const events = newCombatEvents();
    expect(events.fired).toEqual([]);
    expect(events.damaged).toEqual([]);
    expect(events.killed).toEqual([]);
  });

  it("returns a fresh bag each call, so two matches never share a log", () => {
    const a = newCombatEvents();
    const b = newCombatEvents();
    a.fired.push({
      tick: 1, shooterSessionId: "p1", carId: "mirage",
      weaponId: "magmablast", slot: 0, pressId: "p1#1#0",
    });
    expect(b.fired).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/combat-events.test.ts -w @motor-combat-moba/shared`
(from `packages/shared`: `npx vitest run src/sim/combat-events.test.ts`)
Expected: FAIL — cannot resolve `./combat-events.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/sim/combat-events.ts
import type { CarId } from "../config/types.js";
import type { StatusId } from "../config/status-types.js";
import type { WeaponId } from "../config/weapon-types.js";

/**
 * What a balance run observes, and the ONLY thing the sim ever tells it (B3).
 *
 * Opt-in: `runCombat` takes this bag on its input and pushes into it. A caller that passes nothing
 * — every live room — allocates nothing and behaves identically. The seam is observation, never
 * behaviour: nothing in the sim may read an event back (B1).
 *
 * Server-only. `stepSim` never reads these, so invariant 8 does not apply and none of it is
 * networked. Putting a damage breakdown on a results screen is additive work, not implied by this.
 */
export interface CombatEvents {
  fired: FiredEvent[];
  damaged: DamagedEvent[];
  killed: KilledEvent[];
}

/**
 * One committed press (B7). NOT one projectile: a `pepperbox` fan and a multi-volley burst are each
 * one press, which is what makes hit rate comparable across weapon kinds (B30).
 */
export interface FiredEvent {
  tick: number;
  shooterSessionId: string;
  carId: CarId;
  weaponId: WeaponId;
  slot: number;
  pressId: string;
}

/**
 * Where a point of damage came from. Every path into `dealDamageTo` has a tag (B4).
 *
 * There is no ram case: a plain ram deals no damage (`sim/ram.ts` never calls `applyDamage`), so
 * every contact hit is a dash or a hard slam and always names its maneuver weapon (B5).
 */
export type DamageSource =
  | { kind: "weapon"; weaponId: WeaponId; pressId: string; isExplosion: boolean }
  | { kind: "contact"; weaponId: WeaponId; pressId: string }
  | { kind: "pulse"; statusId: StatusId; sourceSessionId: string };

export interface DamagedEvent {
  tick: number;
  victimSessionId: string;
  victimCarId: CarId;
  /** `""` when nothing owned the damage — a room-level grant or a pickup. */
  attackerSessionId: string;
  /** The attacker's chassis, or `null` when the attacker has left the room. */
  attackerCarId: CarId | null;
  source: DamageSource;
  /** Hp actually removed, after every multiplier. 0 is legal: a pure applicator still registers. */
  amount: number;
  /** Whether this is the hit that took the victim to 0. */
  killingBlow: boolean;
}

/**
 * Duplicates what `killingBlow` already marks, deliberately: the kill table wants victim and killer
 * without joining two logs, and the weapon table wants credited kills without joining either.
 */
export interface KilledEvent {
  tick: number;
  victimSessionId: string;
  victimCarId: CarId;
  killerSessionId: string;
  killerCarId: CarId | null;
  source: DamageSource;
}

/** A fresh, empty log. One per match — never shared, or two matches pool their statistics. */
export function newCombatEvents(): CombatEvents {
  return { fired: [], damaged: [], killed: [] };
}
```

- [ ] **Step 4: Export from the package index**

Add to `packages/shared/src/index.ts`, beside the other `sim/` exports. **This index uses explicit
named exports, never `export *`** — match it:

```ts
export { newCombatEvents } from "./sim/combat-events.js";
export type {
  CombatEvents, DamagedEvent, DamageSource, FiredEvent, KilledEvent,
} from "./sim/combat-events.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `packages/shared`): `npx vitest run src/sim/combat-events.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/combat-events.ts packages/shared/src/sim/combat-events.test.ts packages/shared/src/index.ts
git commit -m "feat(sim): combat event types for the balance harness (B3, B4)"
```

---

### Task 2: `pressId` on a committed press

**Files:**
- Modify: `packages/shared/src/sim/weapons/fire.ts` (`PendingFire` interface ~line 43; `beginFire` ~line 210)
- Test: `packages/shared/src/sim/weapons/fire.test.ts` (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PendingFire.pressId: string`, minted by `beginFire` as `` `${sessionId}#${tick}#${slot}` ``. `beginFire` gains a **leading** `sessionId: string` parameter: `beginFire(sessionId, state, mask, tick)`.

**Why a parameter and not a counter:** `beginFire` commits at most one press per player per tick (it returns early when `state.pending` is set), so `sessionId#tick#slot` is unique by construction — no mutable counter, no allocation, deterministic across replays (B7).

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/sim/weapons/fire.test.ts`:

```ts
describe("beginFire pressId (B7)", () => {
  it("mints sessionId#tick#slot on the committed press", () => {
    const state = newFireState("mirage", 1);
    const next = beginFire("p1", state, 0b1, 10);
    expect(next.pending?.pressId).toBe("p1#10#0");
  });

  it("gives two players pressing the same slot on the same tick different ids", () => {
    const a = beginFire("p1", newFireState("mirage", 1), 0b1, 10);
    const b = beginFire("p2", newFireState("mirage", 1), 0b1, 10);
    expect(a.pending?.pressId).not.toBe(b.pending?.pressId);
  });

  it("gives the same player different ids on different ticks", () => {
    const a = beginFire("p1", newFireState("mirage", 1), 0b1, 10);
    const b = beginFire("p1", newFireState("mirage", 1), 0b1, 11);
    expect(a.pending?.pressId).not.toBe(b.pending?.pressId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/shared`): `npx vitest run src/sim/weapons/fire.test.ts -t "pressId"`
Expected: FAIL — `beginFire` takes 3 arguments, and `pressId` is not on `PendingFire`.

- [ ] **Step 3: Add the field**

In `packages/shared/src/sim/weapons/fire.ts`, add to `PendingFire`:

```ts
export interface PendingFire {
  weaponId: WeaponId;
  slot: number;
  shotsLeft: number;
  nextShotTick: number;
  /**
   * Identity of the press this pending shot belongs to (B7). Sim-only, never networked.
   *
   * `sessionId#tick#slot`, and it needs no counter: `beginFire` returns early when a press is
   * already pending, so at most one press commits per player per tick. Frozen here and carried onto
   * every instance the press spawns, which is what makes press-to-damage attribution exact rather
   * than a correlation window — the difference that matters most for a lingering `lance` beam, an
   * attached `afterburner` cone, and a bursting `pepperbox`.
   */
  pressId: string;
}
```

- [ ] **Step 4: Mint it in `beginFire`**

Change the signature and every `pending:` object literal inside `beginFire`:

```ts
export function beginFire(
  sessionId: string,
  state: FireState,
  mask: number,
  tick: number,
): FireState {
```

and where the function builds its `pending`, add:

```ts
pressId: `${sessionId}#${tick}#${index}`,
```

(`index` is the loop variable already naming the slot.)

- [ ] **Step 5: Update every caller and existing test**

Run `grep -rn "beginFire(" packages --include=*.ts` and add the session id as the first argument at each site. The production call site is `packages/shared/src/sim/combat.ts` phase 3 — pass `player.sessionId`. Existing tests pass any stable string (`"p1"`).

- [ ] **Step 6: Run the full shared suite**

Run (from `packages/shared`): `npx vitest run`
Expected: PASS, including `golden.test.ts` unchanged (B1).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sim/weapons/fire.ts packages/shared/src/sim/weapons/fire.test.ts packages/shared/src/sim/combat.ts
git commit -m "feat(sim): pressId on a committed press (B7)"
```

---

### Task 3: `pressId` on every instance a press spawns

**Files:**
- Modify: `packages/shared/src/sim/weapons/instances.ts` (`WeaponInstance` ~line 16; `spawnInstances` ~line 172)
- Modify: `packages/shared/src/sim/combat.ts` (`detonate` ~line 769; the `spawnInstances` call in phase 3)
- Test: `packages/shared/src/sim/weapons/instances.test.ts`, `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `PendingFire.pressId` (Task 2), `ShotOrder`.
- Produces: `WeaponInstance.pressId: string`; `ShotOrder.pressId: string`; `spawnInstances` copies `order.pressId` onto each instance; `detonate` copies `shell.pressId` onto the burst.

**Why `ShotOrder` carries it:** `releaseShots` is what turns a pending press into orders, and it is the only thing that still knows which press an order came from by the time `spawnInstances` runs.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/sim/weapons/instances.test.ts`:

```ts
describe("spawnInstances pressId (B8)", () => {
  it("stamps every pellet of one press with the same pressId", () => {
    const order = { weaponId: "pepperbox", slot: 1, finalVolley: true, pressId: "p1#5#1" } as const;
    const owner = { sessionId: "p1", team: 0, carId: "bullseye", x: 0, y: 0, angle: 0 } as const;
    const { instances } = spawnInstances(order, owner, 5, 0);
    expect(instances.length).toBeGreaterThan(1); // pepperbox is a fan
    expect(instances.every((i) => i.pressId === "p1#5#1")).toBe(true);
  });
});
```

Append to `packages/shared/src/sim/combat.test.ts`:

```ts
it("a magmablast burst inherits the pressId of the shell that threw it (B8)", () => {
  // Build a shell instance mid-flight, then step it to detonation.
  // Assert the synthesized explosion instance carries the shell's pressId.
  const shell = { /* magmablast shell, pressId: "p1#3#0" */ } as WeaponInstance;
  const out = runCombat({ /* world/players/instances with `shell`, stepped to its detonation tick */ });
  const burst = out.instances.find((i) => i.isExplosion);
  expect(burst?.pressId).toBe("p1#3#0");
});
```

> **Implementer note:** build the shell with the file's existing instance helper rather than a literal — `combat.test.ts` already has fixtures for stepping an instance to detonation. Find them with `grep -n "isExplosion" packages/shared/src/sim/combat.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/shared`): `npx vitest run src/sim/weapons/instances.test.ts src/sim/combat.test.ts -t "pressId"`
Expected: FAIL — `pressId` is not on `ShotOrder` or `WeaponInstance`.

- [ ] **Step 3: Add the fields**

`instances.ts` — on `ShotOrder`:

```ts
  /** The press this order belongs to (B8). Sim-only; carried onto every instance it spawns. */
  pressId: string;
```

on `WeaponInstance`, beside `finalWave`:

```ts
  /**
   * The press that spawned this instance (B8). Frozen at spawn and SIM-ONLY — never networked —
   * for exactly the reason `damage` and `ownerTeam` are: it must be answerable at impact, long
   * after the press.
   *
   * An explosion synthesized by `instanceDefOf` inherits its shell's, so a `magmablast` detonation
   * is credited to the press that threw the shell rather than reading as its own free shot.
   */
  pressId: string;
```

- [ ] **Step 4: Carry it through**

- In `spawnInstances`, add `pressId: order.pressId` to the instance literal.
- In `releaseShots` (`fire.ts`), add `pressId: pending.pressId` to each `ShotOrder` literal (there are two — the burst-continues path and the final-volley path; `grep -n "weaponId: pending.weaponId" packages/shared/src/sim/weapons/fire.ts`).
- In `detonate` (`combat.ts`), add `pressId: shell.pressId` to the `burst` literal.

- [ ] **Step 5: Run the full shared suite**

Run (from `packages/shared`): `npx vitest run`
Expected: PASS. `golden.test.ts` must be untouched and green (B1).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/weapons/instances.ts packages/shared/src/sim/weapons/fire.ts packages/shared/src/sim/combat.ts packages/shared/src/sim/weapons/instances.test.ts packages/shared/src/sim/combat.test.ts
git commit -m "feat(sim): carry pressId onto instances and inherited explosions (B8)"
```

---

### Task 4: `maneuverPressId` — so a charge that lands is measurable

**Files:**
- Modify: `packages/shared/src/sim/combat.ts` (`CombatPlayer` ~line 83; `NO_MANEUVER`/`clearManeuver` ~line 101; `startManeuver` ~line 663)
- Modify: `packages/server/src/sim/combat-bridge.ts` (`toCombatPlayers` — supply the new field)
- Test: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `ShotOrder.pressId` (Task 3).
- Produces: `CombatPlayer.maneuverPressId: string` — set by `startManeuver`, cleared by `clearManeuver`, `""` when no maneuver runs.

**Why this exists (B8a):** `wildcharge` and `thunderclap` spawn no instance. Their damage arrives through the contact pass, possibly many ticks after the press. Without this the contact damage event carries no press, both weapons report a 0% hit rate, and "how often does this charge actually convert?" — the entire design question for a 250-damage, 20-second-cooldown ultimate — becomes unanswerable.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/sim/combat.test.ts
describe("maneuverPressId (B8a)", () => {
  it("startManeuver records the press that started it", () => {
    const player = combatant("p1", { carId: "bastion" });
    startManeuver(player, weaponDefOf("wildcharge") as ManeuverWeaponDef, new Map(), "p1#7#2");
    expect(player.maneuverPressId).toBe("p1#7#2");
  });

  it("clearManeuver drops it with the rest of the maneuver state", () => {
    const player = combatant("p1", { carId: "bastion" });
    startManeuver(player, weaponDefOf("wildcharge") as ManeuverWeaponDef, new Map(), "p1#7#2");
    clearManeuver(player);
    expect(player.maneuverPressId).toBe("");
    expect(player.maneuverWeaponId).toBe("");
  });
});
```

> **Implementer note:** `combatant(...)` is the existing fixture helper in `combat.test.ts`; `clearManeuver` is currently module-private — export it, or exercise it through the public path that calls it. Prefer exporting: it sits beside `startManeuver`, which is already exported.

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/shared`): `npx vitest run src/sim/combat.test.ts -t "maneuverPressId"`
Expected: FAIL — `startManeuver` takes 3 arguments; `maneuverPressId` does not exist.

- [ ] **Step 3: Add the field and thread it**

On `CombatPlayer`, immediately after `maneuverWeaponId`:

```ts
  /**
   * The press that started the running maneuver, or `""` (B8a). Server-only, carried in and out
   * like `maneuverWeaponId` beside it, and for the same reason: the contact pass prices a dash or
   * slam hit long after the press, and the damage event it produces has to name that press or the
   * two maneuver weapons can never be measured for how often they land.
   */
  maneuverPressId: string;
```

- Add `maneuverPressId: ""` to the `NO_MANEUVER` constant so `clearManeuver` drops it with everything else.
- Change `startManeuver(player, def, byId)` → `startManeuver(player, def, byId, pressId: string)` and set `player.maneuverPressId = pressId;` beside the existing `player.maneuverWeaponId = def.id;`.
- At the phase-3 call site in `runCombat`, pass `order.pressId`.
- In `packages/server/src/sim/combat-bridge.ts`, `toCombatPlayers` builds `CombatPlayer`s — add `maneuverPressId` to the object it constructs and to whatever server-side memory holds `maneuverWeaponId` (`grep -n "maneuverWeaponId" packages/server/src/sim/combat-bridge.ts`).

- [ ] **Step 4: Run the shared and server suites**

Run (from repo root): `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS across shared, server and client.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/combat.ts packages/shared/src/sim/combat.test.ts packages/server/src/sim/combat-bridge.ts
git commit -m "feat(sim): maneuverPressId, so a dash or slam names the press that landed it (B8a)"
```

---

### Task 5: Emit `fired`

**Files:**
- Modify: `packages/shared/src/sim/combat.ts` (`CombatInput` ~line 138; phase 3 ~line 396)
- Test: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `CombatEvents` (Task 1), `PendingFire.pressId` (Task 2).
- Produces: `CombatInput.events?: CombatEvents`. One `FiredEvent` per newly committed press.

- [ ] **Step 1: Write the failing test**

```ts
describe("fired events (B6)", () => {
  it("emits one event per committed press, not per pellet", () => {
    const events = newCombatEvents();
    const shooter = combatant("p1", { carId: "bullseye", fireMask: 0b10 }); // pepperbox, a fan
    runCombat({ world: worldAt(1), players: [shooter], instances: [], instanceSeq: 0, events });
    expect(events.fired).toHaveLength(1);
    expect(events.fired[0]).toMatchObject({
      shooterSessionId: "p1", carId: "bullseye", weaponId: "pepperbox", slot: 1,
    });
  });

  it("emits nothing on the ticks a held burst continues", () => {
    const events = newCombatEvents();
    // A press already pending coming into the tick must not re-emit.
    const shooter = combatant("p1", { carId: "bullseye", fireMask: 0b10 });
    let state = runCombat({ world: worldAt(1), players: [shooter], instances: [], instanceSeq: 0, events });
    const before = events.fired.length;
    runCombat({ world: worldAt(2), players: state.players, instances: state.instances, instanceSeq: state.instanceSeq, events });
    expect(events.fired.length).toBe(before);
  });

  it("allocates nothing and behaves identically with no sink", () => {
    const shooter = combatant("p1", { carId: "bullseye", fireMask: 0b10 });
    const withSink = runCombat({ world: worldAt(1), players: [combatant("p1", { carId: "bullseye", fireMask: 0b10 })], instances: [], instanceSeq: 0, events: newCombatEvents() });
    const without = runCombat({ world: worldAt(1), players: [shooter], instances: [], instanceSeq: 0 });
    expect(without.players).toEqual(withSink.players);
    expect(without.instances).toEqual(withSink.instances);
  });
});
```

> **Implementer note:** `worldAt(tick)` is a helper you add beside the existing fixtures if `combat.test.ts` does not already have one — `grep -n "world:" packages/shared/src/sim/combat.test.ts` for the shape it uses.

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/shared`): `npx vitest run src/sim/combat.test.ts -t "fired events"`
Expected: FAIL — `events` is not a property of `CombatInput`.

- [ ] **Step 3: Add the input field**

On `CombatInput`, after `contactHits`:

```ts
  /**
   * Where this tick's observations go, or absent for none — which is every live room (B3).
   *
   * A caller-owned bag rather than a return value: `runCombat` runs at the tick rate and a balance
   * run wants ONE log for the whole match, so returning an array would allocate and concatenate
   * 5,400 times per match. When absent, every emit site is a single undefined check.
   *
   * Observation only. Nothing in the sim may ever read an event back (B1).
   */
  events?: CombatEvents;
```

- [ ] **Step 4: Emit at the press commitment**

In phase 3, inside the existing `if (pending !== null && prevPending === null)` block (which already exists to arm hold weapons):

```ts
        input.events?.fired.push({
          tick: world.tick,
          shooterSessionId: player.sessionId,
          carId: carIdOf(player),
          weaponId: pending.weaponId,
          slot: pending.slot,
          pressId: pending.pressId,
        });
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `packages/shared`): `npx vitest run`
Expected: PASS, `golden.test.ts` included and untouched.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/combat.ts packages/shared/src/sim/combat.test.ts
git commit -m "feat(sim): emit fired events on press commitment (B6)"
```

---

### Task 6: Emit `damaged` and `killed`

**Files:**
- Modify: `packages/shared/src/sim/combat.ts` (three `dealDamageTo` call sites: ~269 pulse, ~306 contact, ~526 weapon)
- Test: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `CombatEvents`, `DamageSource`, `maneuverPressId`, `WeaponInstance.pressId`.
- Produces: a module-private `recordDamage(...)` helper in `combat.ts`. **`dealDamageTo` keeps its current exported signature** — the emit wraps it at the call sites, which are the only places that know the source.

- [ ] **Step 1: Write the failing test**

```ts
describe("damaged and killed events (B4, B5)", () => {
  it("tags a weapon hit with its weaponId and pressId", () => {
    const events = newCombatEvents();
    /* shooter fires predator into a target in range; step to impact */
    expect(events.damaged[0]?.source).toMatchObject({ kind: "weapon", weaponId: "predator" });
    expect((events.damaged[0]?.source as { pressId: string }).pressId).toMatch(/^p1#\d+#0$/);
  });

  it("tags contact damage with the maneuver weapon and its press", () => {
    const events = newCombatEvents();
    /* run a tick with contactHits: [{ attackerSessionId: "p1", targetSessionId: "p2", weaponId: "wildcharge" }]
       and p1 mid-maneuver with maneuverPressId "p1#4#2" */
    expect(events.damaged[0]?.source).toEqual({
      kind: "contact", weaponId: "wildcharge", pressId: "p1#4#2",
    });
  });

  it("tags pulse damage with the status and who applied it", () => {
    const events = newCombatEvents();
    /* victim carries `corroded` applied by p1; step one pulse interval */
    expect(events.damaged[0]?.source).toEqual({
      kind: "pulse", statusId: "corroded", sourceSessionId: "p1",
    });
  });

  it("marks the killing blow and emits exactly one killed event", () => {
    const events = newCombatEvents();
    /* victim on 1 hp takes a lethal hit */
    expect(events.damaged.filter((d) => d.killingBlow)).toHaveLength(1);
    expect(events.killed).toHaveLength(1);
    expect(events.killed[0]).toMatchObject({ victimSessionId: "p2", killerSessionId: "p1" });
  });

  it("records a 0-damage hit from a pure applicator without a killing blow", () => {
    const events = newCombatEvents();
    /* roadblock (applies `stunned`) hits a full-hp target */
    expect(events.damaged.some((d) => d.amount === 0 && !d.killingBlow)).toBe(true);
  });

  it("emits no killed event when an already-dead car is hit again", () => {
    const events = newCombatEvents();
    /* a wreck at 0 hp takes another hit in the same tick */
    expect(events.killed).toHaveLength(0);
  });
});
```

> **Implementer note:** fill each `/* ... */` from the fixtures already in `combat.test.ts` — it has helpers for stepping an instance to impact and for seeding statuses. Do not invent new fixtures where one exists.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/shared`): `npx vitest run src/sim/combat.test.ts -t "damaged and killed"`
Expected: FAIL — no events are emitted.

- [ ] **Step 3: Add the helper**

Beside `dealDamageTo` in `combat.ts`:

```ts
/**
 * `dealDamageTo`, plus the observation of it (B6).
 *
 * The emit lives HERE rather than inside `dealDamageTo` because only a call site knows its own
 * `DamageSource`, and because `dealDamageTo`'s exported signature is pinned by tests that have
 * nothing to do with this seam. Wrapping is what keeps the seam additive.
 *
 * `killingBlow` is measured across the call, not inferred afterwards: a car already at 0 coming in
 * is a wreck taking another hit, which is damage but not a kill.
 */
function recordDamage(
  target: CombatPlayer,
  amount: number,
  mods: Readonly<Modifiers>,
  attackerSessionId: string,
  source: DamageSource,
  world: CombatWorld,
  byId: ReadonlyMap<string, CombatPlayer>,
  events: CombatEvents | undefined,
): void {
  const wasAlive = target.hp > 0;
  const before = target.hp;
  dealDamageTo(target, amount, mods, attackerSessionId);
  if (!events) return;

  const killingBlow = wasAlive && target.hp === 0;
  const attackerCarId = attackerSessionId === "" ? null : byId.get(attackerSessionId)?.carId ?? null;
  events.damaged.push({
    tick: world.tick,
    victimSessionId: target.sessionId,
    victimCarId: carIdOf(target),
    attackerSessionId,
    attackerCarId: attackerCarId === null ? null : carIdOf({ carId: attackerCarId }),
    source,
    amount: before - target.hp,
    killingBlow,
  });
  if (killingBlow) {
    events.killed.push({
      tick: world.tick,
      victimSessionId: target.sessionId,
      victimCarId: carIdOf(target),
      killerSessionId: attackerSessionId,
      killerCarId: attackerCarId === null ? null : carIdOf({ carId: attackerCarId }),
      source,
    });
  }
}
```

> **Implementer note:** `carIdOf` normalizes a loose `carId` string to a `CarId`. If its signature does not accept `{ carId }`, call it however the surrounding code does — `grep -n "carIdOf(" packages/shared/src/sim/combat.ts` — and keep the behaviour: an unrecognised chassis falls back the same way it does everywhere else.

**`amount` is measured as `before - target.hp`, not the argument.** `invulnerable` refuses the hp change while the hit still "happens", so passing the requested amount would report damage that was never dealt.

- [ ] **Step 4: Convert the three call sites**

| Line | Source to pass |
|---|---|
| ~269 pulse | `{ kind: "pulse", statusId: pulse.statusId, sourceSessionId: pulse.sourceSessionId }` |
| ~306 contact | `{ kind: "contact", weaponId: hit.weaponId, pressId: byId.get(hit.attackerSessionId)?.maneuverPressId ?? "" }` |
| ~526 weapon | `{ kind: "weapon", weaponId: instance.weaponId, pressId: instance.pressId, isExplosion: instance.isExplosion }` |

Each becomes a `recordDamage(...)` call with the same first four arguments it passes today, plus the source, `world`, `byId` and `input.events`.

- [ ] **Step 5: Run the full suite**

Run (from repo root): `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS. **`golden.test.ts` must not have been edited** — check with `git diff --stat packages/shared/src/sim/golden.test.ts` (expect no output).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/combat.ts packages/shared/src/sim/combat.test.ts
git commit -m "feat(sim): emit damaged and killed events from all three damage paths (B4, B6)"
```

---

## Phase B — The bot seam (server)

### Task 7: Move the bot out of `rooms/`

**Files:**
- Move: `packages/server/src/rooms/bot.ts` → `packages/server/src/bot/input.ts`
- Move: `packages/server/src/rooms/bot.test.ts` → `packages/server/src/bot/input.test.ts`
- Create: `packages/server/src/bot/index.ts`
- Modify: `packages/server/src/rooms/PlaygroundRoom.ts`, `packages/server/src/rooms/PracticeRoom.ts` (import paths only)

**Interfaces:**
- Consumes: nothing new.
- Produces: `packages/server/src/bot/index.ts` re-exporting `botInput`, `shouldRecomputeIntent`, `pulsedFireSlots`, `BotPose`, and the `BOT_PROFILES` / `BotProfile` re-exports already in the file.

**Why (B13):** it serves two rooms and soon a harness, and depends on nothing room-shaped. `BOT_PROFILES` stays in `src/config/bot-profiles.ts` where practice mode correctly put it.

- [ ] **Step 1: Move the files with git so history follows**

```bash
mkdir -p packages/server/src/bot
git mv packages/server/src/rooms/bot.ts packages/server/src/bot/input.ts
git mv packages/server/src/rooms/bot.test.ts packages/server/src/bot/input.test.ts
```

- [ ] **Step 2: Fix the relative imports inside the moved files**

`../config/bot-profiles.js` stays correct (both `rooms/` and `bot/` are one level under `src/`). Inside `input.test.ts`, change `./bot.js` → `./input.js`.

- [ ] **Step 3: Add the barrel**

```ts
// packages/server/src/bot/index.ts
/**
 * The bot, as every host sees it.
 *
 * Mode-agnostic by construction: nothing here imports a room type, because the same bot serves the
 * dev playground, the shipped practice room, the balance harness, and whatever multiplayer bot
 * deployment comes next (B13). Server-side only — a bot authors `InputMessage`s, and only the
 * server authors inputs (invariant 3, B14).
 */
export * from "./input.js";
```

- [ ] **Step 4: Repoint the two rooms**

In `PlaygroundRoom.ts` and `PracticeRoom.ts`, change `from "./bot.js"` → `from "../bot/index.js"`.

- [ ] **Step 5: Verify**

Run (from repo root): `npm run typecheck && npm test`
Expected: PASS, with `bot.test.ts`'s by-value pin on `hard` intact.

- [ ] **Step 6: Commit**

```bash
git add -A packages/server/src
git commit -m "refactor(bot): move the bot out of rooms/ so three hosts can share it (B13)"
```

---

### Task 8: Seeded RNG

**Files:**
- Create: `packages/server/src/bot/rng.ts`
- Test: `packages/server/src/bot/rng.test.ts`

**Interfaces:**
- Produces: `type Rng = () => number` (returns `[0, 1)`); `makeRng(seed: number): Rng`; `deriveSeed(seed: number, ...parts: (number | string)[]): number`.

**Why (B20, B43):** every bot draws from an injected stream so a bot that wants inconsistency — most of what makes a casual a casual — cannot destroy reproducibility. Threaded from day one even though today's bot ignores it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/bot/rng.test.ts
import { describe, expect, it } from "vitest";
import { deriveSeed, makeRng } from "./rng.js";

describe("makeRng", () => {
  it("is deterministic for a seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("differs between seeds", () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it("stays inside [0, 1)", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("deriveSeed", () => {
  it("gives each (match, slot) its own stream", () => {
    expect(deriveSeed(1, "match", 0)).not.toBe(deriveSeed(1, "match", 1));
  });

  it("is stable across runs, so a replay reproduces exactly", () => {
    expect(deriveSeed(99, "m", 3)).toBe(deriveSeed(99, "m", 3));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/server`): `npx vitest run src/bot/rng.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/server/src/bot/rng.ts
/**
 * Seeded randomness for anything a bot or a balance run does (B20, B43).
 *
 * `Math.random()` is banned from every path a run touches: the harness's whole value rests on a
 * seed replaying identically, so that a balance edit can be measured as a paired difference rather
 * than sampled around (B36).
 *
 * mulberry32 — 32 bits of state, one multiply-xor-shift round. Chosen for being short enough to
 * read in full and stable forever: this is not cryptography, and a replay from six weeks ago must
 * still reproduce.
 */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A child seed from a parent and a path — `(runSeed, matchIndex)`, then `(matchSeed, slot)`.
 *
 * FNV-1a over the string form, so the parts may be numbers or names without a second scheme. Order
 * matters and is part of the identity: `(1, "a", 2)` and `(1, 2, "a")` are different streams.
 */
export function deriveSeed(seed: number, ...parts: (number | string)[]): number {
  let hash = 0x811c9dc5 ^ (seed >>> 0);
  for (const part of [String(seed), ...parts.map(String)].join("/")) {
    hash ^= part.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `packages/server`): `npx vitest run src/bot/rng.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bot/rng.ts packages/server/src/bot/rng.test.ts
git commit -m "feat(bot): seeded rng and seed derivation (B20, B43)"
```

---

### Task 9: `BotView`, `BotIntent`, `BotController`

**Files:**
- Create: `packages/server/src/bot/types.ts`
- Modify: `packages/server/src/bot/index.ts` (export it)

**Interfaces:**
- Consumes: `Rng` (Task 8), `FiredEvent` (Task 1), shared schema and config types.
- Produces: `BotView`, `BotSelfView`, `BotCarView`, `BotInstanceView`, `BotArenaView`, `BotIntent`, `BotController`.

**This task has no test of its own** — it is types only, and Tasks 10–12 are what exercise them. It is a separate task because three later tasks consume these names and an implementer reading Task 11 alone needs them written down.

- [ ] **Step 1: Write the types**

```ts
// packages/server/src/bot/types.ts
import type {
  ActiveStatus, CarId, FiredEvent, Aabb, WeaponId,
} from "@motor-combat-moba/shared";
import type { Rng } from "./rng.js";

/** What the bot asks for. Deliberately NOT an `InputMessage`: `seq` is the host's business. */
export interface BotIntent {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fireSlots: number;
}

/** One of this car's weapon slots, as its own HUD draws it. */
export interface BotSlotView {
  weaponId: WeaponId;
  stocks: number;
  rechargeEndsTick: number;
  refireLockUntilTick: number;
  /** `WeaponDef.range` — how far this slot reaches. */
  range: number;
}

/**
 * The bot's own car, in full. Everything here is on the player's own HUD, so all of it is fair
 * (B16).
 */
export interface BotSelfView {
  sessionId: string;
  carId: CarId;
  team: 0 | 1;
  x: number; y: number; angle: number; speed: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  statuses: readonly ActiveStatus[];
  slots: readonly BotSlotView[];
  switchLockUntilTick: number;
  lockTargetSessionId: string;
  maneuver: number;
  maneuverTicksLeft: number;
}

/**
 * Another car, as it is drawn on screen.
 *
 * NO weapon slot state (B18). `stocks` / `rechargeEndsTick` / `refireLockUntilTick` are networked
 * for every player but the HUD draws only your own, so a bot reading an enemy's recharge timer
 * would be inside the wire and outside what a human can see — clairvoyance, and it would inflate
 * the measured value of cooldown-punishing play. What a human gets is `observedFires` below: they
 * watch the ult go off and remember it. The remembering is the bot's own state, and is exactly one
 * of the things separating a pro from a casual.
 */
export interface BotCarView {
  sessionId: string;
  carId: CarId;
  team: 0 | 1;
  x: number; y: number; angle: number; speed: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Spawn-protected: driveable, not solid, not targetable. Visibly translucent on screen. */
  phased: boolean;
  statuses: readonly ActiveStatus[];
  /** `ManeuverKind` value — a dash or a charge is drawn in the world, so it is visible. */
  maneuver: number;
}

/** A shot in flight, as drawn. */
export interface BotInstanceView {
  id: string;
  ownerSessionId: string;
  weaponId: WeaponId;
  x: number; y: number; angle: number;
}

export interface BotArenaView {
  width: number;
  height: number;
  obstacles: readonly Aabb[];
}

/**
 * Everything a bot may know, and nothing else (B15).
 *
 * A CONSTRUCTED PROJECTION, never a handle on `ArenaState`. That is the structural form of "the bot
 * never cheats": `inputQueues` and `prevFireMasks` — the actual keypresses — are not reachable from
 * inside `decide`, because they are not in the type. A promise decays; a type does not.
 *
 * `arena-01` is authored to fit the viewport exactly, so a human sees every car all the time and
 * `others` needs no vision limit (B17). When an arena larger than the view ships, the limit belongs
 * in `buildBotView` and nowhere else.
 */
export interface BotView {
  tick: number;
  self: BotSelfView;
  others: readonly BotCarView[];
  instances: readonly BotInstanceView[];
  arena: BotArenaView;
  /**
   * Presses observed this tick — who fired what (B18). The observable half of enemy resource
   * tracking: a human sees the shot, and remembers.
   *
   * Empty when the host does not collect combat events, which is every room today. A bot that needs
   * these is what turns the `fired` sink on in that room.
   */
  observedFires: readonly FiredEvent[];
  /** This bot's own seeded stream (B20). Never `Math.random()`. */
  rng: Rng;
}

/**
 * One bot, alive for one match.
 *
 * An INSTANCE, not a pure function (B10). It owns the reaction clock, the held intent, the fire
 * pulse, target selection, and — when the bot session lands — the memory of what it has seen. A
 * pure function could not remember an ult being spent, which is the whole of B18.
 *
 * A deathmatch respawn does NOT reset it: a human does not forget what they learned when they
 * respawn (B21).
 */
export interface BotController {
  readonly profileId: string;
  decide(view: BotView): BotIntent;
}
```

- [ ] **Step 2: Export from the barrel**

Add `export * from "./types.js";` to `packages/server/src/bot/index.ts`.

- [ ] **Step 3: Verify it compiles**

Run (from repo root): `npm run typecheck`
Expected: PASS. If `Aabb` or `ActiveStatus` are not exported from shared's index, export them there — they are already public sim types.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/bot/types.ts packages/server/src/bot/index.ts packages/shared/src/index.ts
git commit -m "feat(bot): BotView, BotIntent and the BotController contract (B10, B15, B16)"
```

---

### Task 10: `buildBotView` — the fairness projection

**Files:**
- Create: `packages/server/src/bot/view.ts`
- Test: `packages/server/src/bot/view.test.ts`

**Interfaces:**
- Consumes: `BotView` and friends (Task 9), `ArenaState`/`PlayerState` from shared, `CombatMemory` from `../sim/combat-bridge.js`, `Rng`.
- Produces:

```ts
export function buildBotView(args: {
  state: ArenaState;
  selfSessionId: string;
  combat: CombatMemory;
  rng: Rng;
  observedFires?: readonly FiredEvent[];
}): BotView | null;
```

Returns `null` when the self player is absent — the host then enqueues a neutral input, exactly as both rooms do today.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/bot/view.test.ts
import { describe, expect, it } from "vitest";
import { buildBotView } from "./view.js";
import { makeRng } from "./rng.js";

describe("buildBotView fairness (B15, B16, B18)", () => {
  it("gives the bot its own slot state in full", () => {
    const view = buildBotView(fixture())!;
    expect(view.self.slots.length).toBeGreaterThan(0);
    expect(view.self.slots[0]).toHaveProperty("rechargeEndsTick");
    expect(view.self.slots[0]).toHaveProperty("range");
  });

  it("never exposes another car's slot state", () => {
    const view = buildBotView(fixture())!;
    for (const other of view.others) {
      expect(other).not.toHaveProperty("slots");
      expect(other).not.toHaveProperty("stocks");
      expect(other).not.toHaveProperty("rechargeEndsTick");
    }
  });

  it("carries no route back to keypresses", () => {
    const view = buildBotView(fixture())!;
    const json = JSON.stringify({ ...view, rng: undefined });
    expect(json).not.toContain("inputQueues");
    expect(json).not.toContain("prevFireMasks");
    expect(json).not.toContain("fireMask");
    expect(json).not.toContain("lastDamagerSessionId");
  });

  it("marks a phased car as phased, since a human sees it translucent", () => {
    const view = buildBotView(fixtureWithPhasedOpponent())!;
    expect(view.others.find((o) => o.sessionId === "p2")?.phased).toBe(true);
  });

  it("excludes the bot itself from others", () => {
    const view = buildBotView(fixture())!;
    expect(view.others.map((o) => o.sessionId)).not.toContain("bot");
  });

  it("passes observed fires through, and defaults them to empty", () => {
    expect(buildBotView(fixture())!.observedFires).toEqual([]);
    const fires = [{ tick: 1, shooterSessionId: "p2", carId: "mirage", weaponId: "magmablast", slot: 0, pressId: "p2#1#0" }] as const;
    expect(buildBotView({ ...fixture(), observedFires: fires })!.observedFires).toEqual(fires);
  });

  it("returns null when the bot's own car is gone", () => {
    expect(buildBotView({ ...fixture(), selfSessionId: "nobody" })).toBeNull();
  });
});
```

> **Implementer note:** write `fixture()` in this file to build a two-player `ArenaState` plus a `CombatMemory`. `packages/server/src/rooms/playground-room.test.ts` already constructs both — copy its setup rather than inventing one, so the view is tested against the same state shape a room produces.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/server`): `npx vitest run src/bot/view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/server/src/bot/view.ts
import {
  carIdOf, getArena, hasStatus, hpOf, weaponDefOf,
  type ArenaState, type FiredEvent, type PlayerState,
} from "@motor-combat-moba/shared";
import type { CombatMemory } from "../sim/combat-bridge.js";
// `readStatuses` is the SERVER's status bridge, not shared: it is the only file that maps
// `PlayerState.statuses` onto the sim's `ActiveStatus[]`, and it lives beside the other bridges.
import { readStatuses } from "../sim/status-bridge.js";
import type { Rng } from "./rng.js";
import type { BotCarView, BotSelfView, BotView } from "./types.js";

/**
 * One car's fair picture of the world (B15-B18).
 *
 * Built fresh per decision rather than cached: it is a projection of mutable room state, and a view
 * held across a tick would describe a world that has moved.
 */
export function buildBotView(args: {
  state: ArenaState;
  selfSessionId: string;
  combat: CombatMemory;
  rng: Rng;
  observedFires?: readonly FiredEvent[];
}): BotView | null {
  const { state, selfSessionId, combat, rng } = args;
  const self = state.players.get(selfSessionId);
  if (!self) return null;

  const arena = getArena(state.arenaId);
  const others: BotCarView[] = [];
  state.players.forEach((player, id) => {
    if (id === selfSessionId) return;
    others.push(carView(player, state.tick));
  });
  // Sorted, for the same reason the sim sorts by sessionId: a bot scanning "the nearest enemy" must
  // break a tie the same way on every replay of the same seed.
  others.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));

  return {
    tick: state.tick,
    self: selfView(self, combat),
    others,
    instances: [], // filled by the host in Task 12's follow-up; see note below
    arena: { width: arena.width, height: arena.height, obstacles: arena.obstacles },
    observedFires: args.observedFires ?? [],
    rng,
  };
}

function selfView(player: PlayerState, combat: CombatMemory): BotSelfView {
  const carId = carIdOf(player);
  const fireState = combat.fireStates.get(player.sessionId);
  return {
    sessionId: player.sessionId,
    carId,
    team: player.team as 0 | 1,
    x: player.x, y: player.y, angle: player.angle, speed: player.speed,
    hp: player.hp,
    maxHp: hpOf(carId),
    alive: player.alive,
    statuses: readStatuses(player),
    slots: (fireState?.slots ?? []).map((slot) => ({
      weaponId: slot.weaponId,
      stocks: slot.stocks,
      rechargeEndsTick: slot.rechargeEndsTick,
      refireLockUntilTick: slot.refireLockUntilTick,
      range: weaponDefOf(slot.weaponId).range,
    })),
    switchLockUntilTick: fireState?.switchLockUntilTick ?? 0,
    lockTargetSessionId: player.lockTargetSessionId,
    maneuver: player.maneuver,
    maneuverTicksLeft: player.maneuverTicksLeft,
  };
}

/**
 * Another car, drawn.
 *
 * Note what is NOT read here: no `FireState` from `CombatMemory`, no `lastDamagerSessionId`, no
 * lock internals. `phased` IS read, because spawn protection is drawn on screen — and because a bot
 * that shoots at a car it cannot hit would corrupt exactly the accuracy statistics this exists to
 * produce (B28a).
 */
function carView(player: PlayerState, tick: number): BotCarView {
  const carId = carIdOf(player);
  const statuses = readStatuses(player);
  return {
    sessionId: player.sessionId,
    carId,
    team: player.team as 0 | 1,
    x: player.x, y: player.y, angle: player.angle, speed: player.speed,
    hp: player.hp,
    maxHp: hpOf(carId),
    alive: player.alive,
    phased: hasStatus(statuses, "phased", tick),
    statuses,
    maneuver: player.maneuver,
  };
}
```

> **Implementer note on `instances`:** the live instance list is server-only memory reachable through `toInstances(combat)` in `combat-bridge.ts`. Fill it by mapping that to `BotInstanceView` — `id`, `ownerSessionId`, `weaponId`, `x`, `y`, `angle` and nothing else. It is listed as a separate note because `toInstances` allocates, and the view is built once per bot per decision; if a profiler ever objects, this is the line to look at.

- [ ] **Step 4: Run tests to verify they pass**

Run (from `packages/server`): `npx vitest run src/bot/view.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bot/view.ts packages/server/src/bot/view.test.ts
git commit -m "feat(bot): buildBotView, the perception-fair projection (B15-B18)"
```

---

### Task 11: `LegacyController`

**Files:**
- Create: `packages/server/src/bot/controller.ts`
- Test: `packages/server/src/bot/controller.test.ts`
- Modify: `packages/server/src/bot/index.ts`

**Interfaces:**
- Consumes: `BotController`, `BotView`, `BotIntent` (Task 9); `botInput`, `shouldRecomputeIntent`, `pulsedFireSlots` (Task 7); `BotProfile`, `BOT_PROFILES`.
- Produces:

```ts
export class LegacyController implements BotController {
  constructor(profileId: BotDifficulty, options?: { targetSessionId?: string });
  readonly profileId: BotDifficulty;
  decide(view: BotView): BotIntent;
  /** Point the bot at one specific car, or `undefined` to pick the nearest living solid enemy. */
  setTarget(sessionId: string | undefined): void;
}
```

**Behaviour it must reproduce exactly (B22):** hold the previous intent between recomputes per `profile.reactionTicks`; drop the hold when the target is dead or absent; pulse the fire mask per `profile.firePeriodTicks`; coast on zeros when there is no target.

**The one thing that is new:** target selection. Both rooms hand the bot a single fixed opponent; a six-car FFA has five candidates. Nearest living non-phased enemy, re-picked on the same cadence as the intent. This is harness-owned scaffolding, not bot intelligence — the bot session replaces it (B10). `setTarget` is what keeps both rooms on their existing single-opponent behaviour, so the migration in Tasks 12–13 changes nothing.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/bot/controller.test.ts
import { describe, expect, it } from "vitest";
import { LegacyController } from "./controller.js";

describe("LegacyController (B22)", () => {
  it("holds its intent between recomputes on easy's 9-tick cadence", () => {
    const bot = new LegacyController("easy", { targetSessionId: "p2" });
    const first = bot.decide(viewAt(1, { targetX: 500 }));
    const held = bot.decide(viewAt(2, { targetX: -500 })); // target teleports; too soon to react
    expect(held.steer).toBe(first.steer);
  });

  it("recomputes on the cadence tick", () => {
    const bot = new LegacyController("hard", { targetSessionId: "p2" }); // reactionTicks: 1
    const a = bot.decide(viewAt(1, { targetX: 500 }));
    const b = bot.decide(viewAt(2, { targetX: -500 }));
    expect(b.steer).not.toBe(a.steer);
  });

  it("coasts on zeros when the target is dead", () => {
    const bot = new LegacyController("hard", { targetSessionId: "p2" });
    expect(bot.decide(viewAt(1, { targetAlive: false }))).toEqual({ steer: 0, throttle: 0, fireSlots: 0 });
  });

  it("pulses the fire mask, so serverTick sees a fresh press edge", () => {
    const bot = new LegacyController("hard", { targetSessionId: "p2" }); // firePeriodTicks: 2
    const masks = [1, 2, 3, 4].map((t) => bot.decide(viewAt(t, { targetX: 60 })).fireSlots);
    expect(masks.some((m) => m === 0)).toBe(true);
    expect(masks.some((m) => m > 0)).toBe(true);
  });

  it("picks the nearest living enemy when no target is fixed", () => {
    const bot = new LegacyController("hard");
    const intent = bot.decide(viewWithEnemies([
      { sessionId: "far", x: 900, alive: true, phased: false },
      { sessionId: "near", x: 100, alive: true, phased: false },
    ]));
    expect(bot.currentTargetSessionId).toBe("near");
    expect(intent.throttle).not.toBe(0);
  });

  it("skips a phased enemy, which cannot be hit", () => {
    const bot = new LegacyController("hard");
    bot.decide(viewWithEnemies([
      { sessionId: "near", x: 100, alive: true, phased: true },
      { sessionId: "far", x: 900, alive: true, phased: false },
    ]));
    expect(bot.currentTargetSessionId).toBe("far");
  });

  it("reproduces botInput exactly for the same pose and profile", () => {
    const bot = new LegacyController("medium", { targetSessionId: "p2" });
    const view = viewAt(1, { targetX: 300 });
    const direct = botInput(1, { x: 0, y: 0, angle: 0 }, { x: 300, y: 0, angle: 0 },
      view.self.slots.map((s) => s.range), BOT_PROFILES.medium);
    const viaController = bot.decide(view);
    expect(viaController.steer).toBe(direct.steer);
    expect(viaController.throttle).toBe(direct.throttle);
  });
});
```

> **Implementer note:** `viewAt` / `viewWithEnemies` are local builders returning a `BotView`; reuse `buildBotView`'s test fixture from Task 10 rather than hand-rolling a second one. Add `currentTargetSessionId` as a readonly getter on the class — the tests above need it and so does the report's diagnostics.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/server`): `npx vitest run src/bot/controller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/server/src/bot/controller.ts
import type { BotDifficulty } from "@motor-combat-moba/shared";
import { BOT_PROFILES, type BotProfile } from "../config/bot-profiles.js";
import { botInput, pulsedFireSlots, shouldRecomputeIntent } from "./input.js";
import type { BotController, BotIntent, BotView } from "./types.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

/**
 * Today's chaser, statefully (B22).
 *
 * This is the ONLY controller this work ships, and it is deliberately not an improvement: it
 * reproduces the bot that both rooms already run, so their existing tests are what prove the
 * migration in the next two tasks changed nothing. Bot intelligence is a separate session's work
 * (B2) — replacing `decide` is the whole of it.
 *
 * What moved INTO the bot here is the cadence and the fire pulse, which lived in each room. That
 * overturns `PlaygroundRoom`'s comment calling the pulse "the room's decision... exactly as a real
 * client's key state does" — under an instance model the bot IS the client, and holds its own key
 * state (B11).
 */
export class LegacyController implements BotController {
  readonly profileId: BotDifficulty;
  private readonly profile: BotProfile;
  private held: BotIntent | undefined;
  private fixedTarget: string | undefined;
  private target: string | undefined;

  constructor(profileId: BotDifficulty, options: { targetSessionId?: string } = {}) {
    this.profileId = profileId;
    this.profile = BOT_PROFILES[profileId];
    this.fixedTarget = options.targetSessionId;
  }

  /** Who this bot is shooting at, for a report's diagnostics. `undefined` when it has no target. */
  get currentTargetSessionId(): string | undefined {
    return this.target;
  }

  setTarget(sessionId: string | undefined): void {
    this.fixedTarget = sessionId;
  }

  decide(view: BotView): BotIntent {
    const target = this.pickTarget(view);
    this.target = target?.sessionId;

    // A dead or absent target is no target: coast rather than chase a wreck's last pose, and drop
    // the hold so the bot reacts the instant one reappears instead of waiting out its cadence.
    if (!target) {
      this.held = undefined;
      return COAST;
    }

    if (shouldRecomputeIntent(view.tick, this.profile.reactionTicks, this.held !== undefined)) {
      const raw = botInput(
        0, // `seq` belongs to the host; `botInput` only echoes it
        { x: view.self.x, y: view.self.y, angle: view.self.angle },
        { x: target.x, y: target.y, angle: target.angle },
        view.self.slots.map((slot) => slot.range),
        this.profile,
      );
      this.held = { steer: raw.steer, throttle: raw.throttle, fireSlots: raw.fireSlots };
    }

    const intent = this.held ?? COAST;
    return {
      ...intent,
      fireSlots: pulsedFireSlots(view.tick, this.profile.firePeriodTicks, intent.fireSlots),
    };
  }

  /**
   * A fixed opponent when the host named one — which is both rooms, unchanged — otherwise the
   * nearest living, non-phased enemy.
   *
   * Nearest-first is harness scaffolding, not bot intelligence: something has to choose among five
   * cars in a free-for-all, and who bots focus is a real influence on kill distribution that the bot
   * session will own. Phased cars are skipped because they cannot be hit at all, and shooting at one
   * would register as a miss in exactly the accuracy numbers this rig exists to produce (B28a).
   */
  private pickTarget(view: BotView): BotView["others"][number] | undefined {
    if (this.fixedTarget !== undefined) {
      const fixed = view.others.find((o) => o.sessionId === this.fixedTarget);
      return fixed?.alive ? fixed : undefined;
    }
    let best: BotView["others"][number] | undefined;
    let bestDistance = Infinity;
    for (const other of view.others) {
      if (!other.alive || other.phased) continue;
      if (other.team === view.self.team && view.others.some((o) => o.team !== view.self.team)) continue;
      const distance = Math.hypot(other.x - view.self.x, other.y - view.self.y);
      // `others` arrives sorted by sessionId, so a distance tie resolves identically every replay.
      if (distance < bestDistance) {
        bestDistance = distance;
        best = other;
      }
    }
    return best;
  }
}
```

- [ ] **Step 4: Export from the barrel**

Add `export * from "./controller.js";` to `packages/server/src/bot/index.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run (from `packages/server`): `npx vitest run src/bot/controller.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/bot/controller.ts packages/server/src/bot/controller.test.ts packages/server/src/bot/index.ts
git commit -m "feat(bot): LegacyController, today's chaser as a stateful instance (B10, B22)"
```

---

### Task 12: Migrate `PlaygroundRoom`

**Files:**
- Modify: `packages/server/src/rooms/PlaygroundRoom.ts` (`enqueueOpponentInput` ~lines 330–385; the `heldBotIntent` field ~line 145 and its three resets at ~192, ~276, ~349)
- Test: `packages/server/src/rooms/playground-room.test.ts` (must pass **unchanged**)

**Interfaces:**
- Consumes: `LegacyController` (Task 11), `buildBotView` (Task 10), `makeRng`/`deriveSeed` (Task 8).
- Produces: no new exports. `PlaygroundRoom` holds a `BotController` instead of a `heldBotIntent`.

**This is a behaviour-preserving refactor.** The room's existing tests are the gate: if any needs editing to pass, the refactor is wrong.

- [ ] **Step 1: Run the existing tests and record the baseline**

Run (from `packages/server`): `npx vitest run src/rooms/playground-room.test.ts`
Expected: PASS. Note the count — it must be identical at the end.

- [ ] **Step 2: Replace the held intent with a controller**

Delete the `private heldBotIntent: InputMessage | undefined;` field and add:

```ts
  /**
   * The bot, as an instance (B10). Rebuilt when the difficulty changes, because a profile is
   * constructor state — and rebuilding also drops the held intent, which is exactly what the three
   * old `heldBotIntent = undefined` resets were doing by hand.
   */
  private bot: BotController | undefined;
```

- [ ] **Step 3: Rewrite `enqueueOpponentInput`**

```ts
  private enqueueOpponentInput(): void {
    const opponentId = otherPlaygroundId(this.state.controlledSessionId, this.humanSessionId);
    const queue = this.inputQueues.get(opponentId);
    if (!queue) return;

    this.opponentSeq += 1;
    const seq = this.opponentSeq;

    // Alone mode (PG11) sends a NEUTRAL input, not silence. `serverTick` leaves an input-less
    // player unstepped unless it is carrying a knock, so a dummy handed no input freezes where the
    // bot was switched off — keeping the `speed` it was carrying, which `resolveRam` then reads as
    // an approach term forever. Coasting on zeros runs it through the ordinary drive model instead.
    if (!this.state.botEnabled) {
      // Dropping the controller is what stops switching the bot back on from replaying an intent
      // computed against a pose from minutes ago (PG29).
      this.bot = undefined;
      queue.push({ seq, steer: 0, throttle: 0, fireSlots: 0 });
      return;
    }

    const difficulty = isBotDifficulty(this.state.botDifficulty) ? this.state.botDifficulty : "medium";
    if (this.bot?.profileId !== difficulty) {
      this.bot = new LegacyController(difficulty, { targetSessionId: this.state.controlledSessionId });
    }
    // The playground can re-point the camera at the other car mid-session, which changes who the
    // bot is fighting; the target is re-stated every tick rather than only at construction.
    (this.bot as LegacyController).setTarget(this.state.controlledSessionId);

    const view = buildBotView({
      state: this.state,
      selfSessionId: opponentId,
      combat: this.combat,
      rng: this.botRng,
    });
    if (!view) {
      queue.push({ seq, steer: 0, throttle: 0, fireSlots: 0 });
      return;
    }

    // A fresh `seq` every tick, held intent or not: `serverTick` wants one input per tick per car,
    // and reusing a sequence number reads as a duplicate rather than a repeat.
    queue.push({ seq, ...this.bot.decide(view) });
  }
```

Add a `private readonly botRng = makeRng(deriveSeed(1, "playground-bot"));` field. The playground is interactive, so the seed is a constant — it exists to satisfy the contract, not to make the playground reproducible.

- [ ] **Step 4: Remove the now-dead resets**

The three `this.heldBotIntent = undefined;` lines outside `enqueueOpponentInput` become `this.bot = undefined;`. Delete any now-unused imports (`botInput`, `shouldRecomputeIntent`, `pulsedFireSlots`, `BOT_PROFILES`, `weaponDefOf`, `poseOf`, `BotPose`) — `npm run typecheck` will name them.

- [ ] **Step 5: Run the room's tests, unchanged**

Run (from `packages/server`): `npx vitest run src/rooms/playground-room.test.ts`
Expected: PASS, same count as Step 1, **with no edits to the test file**. Confirm with `git diff --stat packages/server/src/rooms/playground-room.test.ts` (expect no output).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/rooms/PlaygroundRoom.ts
git commit -m "refactor(playground): drive the bot through BotController (B11, B12)"
```

---

### Task 13: Migrate `PracticeRoom`

**Files:**
- Modify: `packages/server/src/rooms/PracticeRoom.ts` (`enqueueBotInput` ~lines 355–396; `heldBotIntent` ~line 116)
- Test: `packages/server/src/rooms/practice-room.test.ts` (must pass **unchanged**)

**Interfaces:**
- Consumes: same as Task 12.
- Produces: no new exports.

**Practice mode is shipped and player-facing.** The bar is higher than Task 12's, not lower: no behaviour change, no test edits.

- [ ] **Step 1: Run the existing tests and record the baseline**

Run (from `packages/server`): `npx vitest run src/rooms/practice-room.test.ts src/rooms/practice-rules.test.ts`
Expected: PASS. Note the counts.

- [ ] **Step 2: Replace the held intent with a controller**

Delete `private heldBotIntent: InputMessage | undefined;`, add:

```ts
  /** The bot, as an instance (B10). Built once: practice has no mid-session reconfiguration. */
  private bot: BotController | undefined;
  private readonly botRng = makeRng(deriveSeed(1, "practice-bot"));
```

- [ ] **Step 3: Rewrite `enqueueBotInput`**

```ts
  /**
   * One input per tick for the bot's car, through the ordinary input queue — so "clients send
   * inputs, never state" holds: the bot is a client, just an in-process one. Nothing here ever
   * writes to the human's queue (PR14).
   */
  private enqueueBotInput(): void {
    const queue = this.inputQueues.get(BOT_SESSION_ID);
    if (!queue) return;

    this.botSeq += 1;
    const seq = this.botSeq;

    this.bot ??= new LegacyController(this.difficulty, { targetSessionId: this.humanSessionId });

    const view = buildBotView({
      state: this.state,
      selfSessionId: BOT_SESSION_ID,
      combat: this.combat,
      rng: this.botRng,
    });
    if (!view) return;

    // A fresh `seq` every tick: `serverTick` wants one input per tick per car, and reusing a
    // sequence number reads as a duplicate rather than a repeat.
    queue.push({ seq, ...this.bot.decide(view) });
  }
```

Note the early return when `view` is null matches today's `if (!self || !queue) return;`.

- [ ] **Step 4: Delete the now-unused imports**

`botInput`, `pulsedFireSlots`, `shouldRecomputeIntent`, `BOT_PROFILES`, `BotPose`, `weaponDefOf` (if unused elsewhere in the file), and the module-private `poseOf`. `npm run typecheck` names them all.

- [ ] **Step 5: Run the practice tests, unchanged**

Run (from `packages/server`): `npx vitest run src/rooms/practice-room.test.ts src/rooms/practice-rules.test.ts`
Expected: PASS, same counts, no test-file edits (`git diff --stat` on both must be empty).

- [ ] **Step 6: Run everything**

Run (from repo root): `npm run build && npm test`
Expected: PASS across all three packages.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/rooms/PracticeRoom.ts
git commit -m "refactor(practice): drive the bot through BotController (B12)"
```

---

## Phase C — The harness

### Task 14: Shared run-folder helper

**Files:**
- Create: `packages/server/src/run-dir.ts`
- Modify: `packages/server/playtest/reporter.ts` (delegate to it)
- Test: `packages/server/src/run-dir.test.ts`

**Interfaces:**
- Produces: `createRunDir(root: string): string`, `resolveRunDir(root: string, envVar: string): string`.

**Why (B46):** `balance/` writes dated `NN` folders exactly as `playtest/` does. One implementation, parameterized by root, rather than a copy that drifts.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/run-dir.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRunDir } from "./run-dir.js";

const temps: string[] = [];
function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-dir-"));
  temps.push(dir);
  return dir;
}
afterEach(() => { for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("createRunDir", () => {
  it("numbers the first run of a day -01", () => {
    expect(path.basename(createRunDir(tempRoot()))).toMatch(/^\d{4}-\d{2}-\d{2}-01$/);
  });

  it("counts up from what is already on disk", () => {
    const root = tempRoot();
    createRunDir(root);
    expect(path.basename(createRunDir(root))).toMatch(/-02$/);
  });

  it("creates the directory it names", () => {
    expect(fs.existsSync(createRunDir(tempRoot()))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/server`): `npx vitest run src/run-dir.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Move the bodies of `createRunDir` and `resolveRunDir` out of `playtest/reporter.ts` into `src/run-dir.ts`, adding a `root: string` first parameter and taking the env var name as a parameter on `resolveRunDir`. Keep the existing comments — the "derived by scanning what is on disk rather than a counter file" rationale is still the reason.

- [ ] **Step 4: Delegate from the playtest reporter**

```ts
// packages/server/playtest/reporter.ts
import { createRunDir as createRunDirIn, resolveRunDir as resolveRunDirIn } from "../src/run-dir.js";

export const REPORTS_ROOT = path.join(HERE, "reports");
export const createRunDir = (): string => createRunDirIn(REPORTS_ROOT);
export const resolveRunDir = (): string => resolveRunDirIn(REPORTS_ROOT, "PLAYTEST_RUN_DIR");
```

- [ ] **Step 5: Verify the playtest harness still runs**

Run (from repo root): `npm run playtest`
Expected: six probes run, one dated folder, exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/run-dir.ts packages/server/src/run-dir.test.ts packages/server/playtest/reporter.ts
git commit -m "refactor(playtest): lift the dated run-folder helper out of the reporter (B46)"
```

---

### Task 15: One match

**Files:**
- Create: `packages/server/balance/match.ts`, `packages/server/balance/tsconfig.json`
- Test: `packages/server/balance/match.test.ts`
- Modify: `packages/server/package.json` (`typecheck` covers `balance/`)

**Interfaces:**
- Consumes: `runPipeline`/`respawnSweep`/`respawnPlayer`/`phaseEndSweep` (`../src/rooms/tick-pipeline.js`), `LegacyController`/`buildBotView` (`../src/bot/index.js`), `newCombatEvents` and the flow functions from shared, `makeRng`/`deriveSeed`.
- Produces:

```ts
export interface MatchSetup {
  seats: readonly { sessionId: string; carId: CarId; team: 0 | 1 }[];
  mode: GameMode;
  arenaId: string;
  difficulty: BotDifficulty;
  seed: number;
  maxTicks: number;
}

export interface MatchOutcome {
  ticks: number;
  winnerSessionId: string;
  winnerTeam: number;
  hitClock: boolean;
  seats: readonly {
    sessionId: string; carId: CarId;
    kills: number; deaths: number;
    aliveTicks: number; placement: number;
  }[];
  events: CombatEvents;
}

export function runMatch(setup: MatchSetup): MatchOutcome;
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/balance/match.test.ts
import { describe, expect, it } from "vitest";
import { GameMode } from "@motor-combat-moba/shared";
import { runMatch } from "./match.js";

const SETUP = {
  seats: [
    { sessionId: "a", carId: "mirage", team: 0 },
    { sessionId: "b", carId: "bastion", team: 0 },
  ],
  mode: GameMode.FFA_LAST_STANDING,
  arenaId: "arena-01",
  difficulty: "hard",
  seed: 1,
  maxTicks: 30 * 60,
} as const;

describe("runMatch", () => {
  it("runs to a conclusion and names a winner or a draw", () => {
    const out = runMatch(SETUP);
    expect(out.ticks).toBeGreaterThan(0);
    expect(out.ticks).toBeLessThanOrEqual(SETUP.maxTicks);
  });

  it("collects combat events", () => {
    const out = runMatch(SETUP);
    expect(out.events.fired.length).toBeGreaterThan(0);
  });

  it("is deterministic for a seed (B43)", () => {
    const a = runMatch(SETUP);
    const b = runMatch(SETUP);
    expect(b.ticks).toBe(a.ticks);
    expect(b.winnerSessionId).toBe(a.winnerSessionId);
    expect(b.events.damaged.length).toBe(a.events.damaged.length);
  });

  it("differs between seeds", () => {
    const a = runMatch(SETUP);
    const b = runMatch({ ...SETUP, seed: 2 });
    // Spawn assignment is seeded, so two seeds place the cars differently.
    expect(b.ticks).not.toBe(a.ticks);
  });

  it("respawns in deathmatch, so both cars can outlive their first death", () => {
    const out = runMatch({ ...SETUP, mode: GameMode.FFA_DEATHMATCH, maxTicks: 30 * 60 });
    expect(out.seats.every((s) => s.deaths >= 0)).toBe(true);
    expect(out.hitClock).toBe(true);
  });

  it("ranks placement by kills then fewest deaths in deathmatch", () => {
    const out = runMatch({ ...SETUP, mode: GameMode.FFA_DEATHMATCH });
    expect(out.seats.map((s) => s.placement).sort()).toEqual([1, 2]);
  });
});
```

> **Implementer note:** the "differs between seeds" assertion can be flaky if two seeds happen to produce the same tick count. If it flakes, compare the full event count instead — but investigate first: identical event counts across seeds would mean the seed is not reaching `assignSpawns`, which is the bug this test exists to catch.

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/server`): `npx vitest run balance/match.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Build `match.ts` around the same pieces `ArenaRoom.tick` uses. The shape:

```ts
export function runMatch(setup: MatchSetup): MatchOutcome {
  const rng = makeRng(setup.seed);
  const state = new ArenaState();
  state.arenaId = setup.arenaId;
  state.phase = RoomPhase.MATCH;
  state.mode = setup.mode;
  state.matchEndsTick =
    winRuleOf(setup.mode) === "deathmatch" ? DEATHMATCH_TICKS.match : 0;

  // Seats, spawns and per-seat bots.
  const spawns = assignSpawns(getArena(setup.arenaId), setup.mode, setup.seats, rng);
  const bots = new Map<string, LegacyController>();
  for (const [slot, seat] of setup.seats.entries()) {
    /* build a PlayerState exactly as PlaytestWorld.add does, from `spawns[seat.sessionId]` */
    bots.set(seat.sessionId, new LegacyController(setup.difficulty));
    /* seeded per seat: makeRng(deriveSeed(setup.seed, "seat", slot)) */
  }

  const events = newCombatEvents();
  const ctx = (): PipelineCtx => ({ /* state, inputQueues, prevFireMasks, matchRoster, phaseCaps,
                                      combat, ram, hz: TICK_RATE_HZ,
                                      runPhaseSweep: winRuleOf(setup.mode) === "deathmatch" */ });

  const aliveTicks = new Map<string, number>();
  while (state.tick < setup.maxTicks) {
    state.tick += 1;
    if (winRuleOf(setup.mode) === "deathmatch") respawnSweep(ctx());
    for (const seat of setup.seats) { /* buildBotView -> bot.decide -> push InputMessage */ }
    const { masks } = runPipeline({ ...ctx(), events });
    if (winRuleOf(setup.mode) === "deathmatch") phaseEndSweep(ctx(), masks);
    for (const seat of setup.seats) {
      if (state.players.get(seat.sessionId)?.alive) {
        aliveTicks.set(seat.sessionId, (aliveTicks.get(seat.sessionId) ?? 0) + 1);
      }
    }
    if (isOver(state, setup.mode)) break;
  }
  /* assemble MatchOutcome; placement from deathmatchOutcome's ranking or elimination order */
}
```

Three rules this must follow:

1. **`PipelineCtx` is built fresh at every use, never cached** — the type's own comment says so: `applyFlow` reassigns `matchRoster` and `revealCars` reassigns `ram`, and a stale ctx runs the previous match's contact memory.
2. **`runPipeline` must accept the event sink.** Add `events?: CombatEvents` to `PipelineCtx` and pass it through to `runCombat`'s input. That is a one-line change in `tick-pipeline.ts` and is the only edit this phase makes to shipped code.
3. **The win check is the room's, not the harness's** (B29): `winRuleOf(mode) === "deathmatch" ? deathmatchEnded(roster.size, tick, state.matchEndsTick) : livingSides(sidesOf(mode), players).sides <= 1`.

- [ ] **Step 4: Add the tsconfig and wire typecheck**

```json
// packages/server/balance/tsconfig.json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["**/*.ts"]
}
```

In `packages/server/package.json`, extend the typecheck script:

```json
"typecheck": "tsc --noEmit && tsc --noEmit -p playtest/tsconfig.json && tsc --noEmit -p balance/tsconfig.json"
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `packages/server`): `npx vitest run balance/match.test.ts && npx tsc --noEmit -p balance/tsconfig.json`
Expected: PASS, 6 tests, clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add packages/server/balance/match.ts packages/server/balance/match.test.ts packages/server/balance/tsconfig.json packages/server/package.json packages/server/src/rooms/tick-pipeline.ts
git commit -m "feat(balance): run one headless match through the real pipeline (B24, B25, B29)"
```

---

### Task 16: Status-to-weapon attribution

**Files:**
- Create: `packages/server/balance/attribution.ts`
- Test: `packages/server/balance/attribution.test.ts`

**Interfaces:**
- Consumes: `WEAPON_TABLE` from shared.
- Produces: `buildApplierMap(): ReadonlyMap<StatusId, readonly WeaponId[]>`; `attributeSource(source: DamageSource, appliers: ReadonlyMap<StatusId, readonly WeaponId[]>): { weaponId: WeaponId | null; derived: boolean }`.

**Why (B5a):** `corroded` deals 8 damage every 400 ms for 2 s — **40 damage**, against `magmablast`'s 50 on the direct hit. Banking that under the status understates the weapon that caused it by nearly half.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/balance/attribution.test.ts
import { describe, expect, it } from "vitest";
import { attributeSource, buildApplierMap } from "./attribution.js";

describe("buildApplierMap (B5a)", () => {
  it("finds corroded's applier inside magmablast's explosion", () => {
    expect(buildApplierMap().get("corroded")).toEqual(["magmablast"]);
  });

  it("lists every weapon that applies a status shared by more than one", () => {
    // `stunned` comes from roadblock, thunderclap and wildcharge's wall slam.
    expect((buildApplierMap().get("stunned") ?? []).length).toBeGreaterThan(1);
  });

  it("ignores self-targeted applications, which damage nobody", () => {
    // `fortified` is target: "self" — it must never make wildcharge the applier of someone's pulse.
    expect(buildApplierMap().get("fortified") ?? []).not.toContain("wildcharge");
  });
});

describe("attributeSource", () => {
  const appliers = buildApplierMap();

  it("passes a weapon source straight through", () => {
    expect(attributeSource({ kind: "weapon", weaponId: "predator", pressId: "x", isExplosion: false }, appliers))
      .toEqual({ weaponId: "predator", derived: false });
  });

  it("credits a corroded pulse to magmablast, and says the credit was derived", () => {
    expect(attributeSource({ kind: "pulse", statusId: "corroded", sourceSessionId: "p1" }, appliers))
      .toEqual({ weaponId: "magmablast", derived: true });
  });

  it("refuses to guess when two weapons apply the same status", () => {
    expect(attributeSource({ kind: "pulse", statusId: "stunned", sourceSessionId: "p1" }, appliers))
      .toEqual({ weaponId: null, derived: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/server`): `npx vitest run balance/attribution.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/server/balance/attribution.ts
import { WEAPON_TABLE, type DamageSource, type StatusId, type WeaponId } from "@motor-combat-moba/shared";

/**
 * Which weapons can apply each status, scanned out of `WEAPON_TABLE` (B5a).
 *
 * Derived rather than hardcoded because CLAUDE.md's own note on `corroded` — "grep
 * `applies:.*corroded` if a second source ever needs checking" — describes a fact a future weapon
 * can change silently. A map built from the table cannot go stale; a constant would, and would go
 * stale in the direction of a WRONG number rather than a missing one.
 *
 * Only `target: "opponents"` applications count. A self-buff damages nobody, so folding it in would
 * make a weapon the applier of a pulse it can never inflict.
 */
export function buildApplierMap(): ReadonlyMap<StatusId, readonly WeaponId[]> {
  const map = new Map<StatusId, WeaponId[]>();
  const add = (statusId: StatusId, weaponId: WeaponId): void => {
    const existing = map.get(statusId);
    if (existing) { if (!existing.includes(weaponId)) existing.push(weaponId); }
    else map.set(statusId, [weaponId]);
  };
  for (const def of Object.values(WEAPON_TABLE)) {
    for (const application of def.applies ?? []) {
      if (application.target === "opponents") add(application.statusId, def.id);
    }
    // An explosion is a real instance with its own `applies` — and it is where `corroded` lives.
    const explosion = "explosion" in def ? def.explosion : undefined;
    for (const application of explosion?.applies ?? []) {
      if (application.target === "opponents") add(application.statusId, def.id);
    }
  }
  return map;
}

/**
 * Which weapon a point of damage belongs to.
 *
 * `derived: true` means the credit came through a status rather than off the event, and the report
 * says so: it is a defensible inference, not a measurement, and a reader deserves to know which.
 */
export function attributeSource(
  source: DamageSource,
  appliers: ReadonlyMap<StatusId, readonly WeaponId[]>,
): { weaponId: WeaponId | null; derived: boolean } {
  if (source.kind === "weapon" || source.kind === "contact") {
    return { weaponId: source.weaponId, derived: false };
  }
  const candidates = appliers.get(source.statusId) ?? [];
  // Two appliers make attribution genuinely ambiguous from the event alone. Reporting the damage
  // under the status is the honest answer; picking one would invent a number.
  if (candidates.length !== 1) return { weaponId: null, derived: false };
  return { weaponId: candidates[0]!, derived: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `packages/server`): `npx vitest run balance/attribution.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/balance/attribution.ts packages/server/balance/attribution.test.ts
git commit -m "feat(balance): credit pulse damage to the weapon that applied the status (B5a)"
```

---

### Task 17: Statistics

**Files:**
- Create: `packages/server/balance/stats.ts`
- Test: `packages/server/balance/stats.test.ts`

**Interfaces:**
- Consumes: `MatchOutcome` (Task 15), `attributeSource`/`buildApplierMap` (Task 16).
- Produces:

```ts
export interface Interval { rate: number; low: number; high: number; n: number }
export function wilson(successes: number, n: number): Interval;

export interface CarStats {
  carId: CarId; matches: number; wins: number; winRate: Interval;
  meanPlacement: number; kills: number; deaths: number;
  damageDealt: number; damageTaken: number;
  meanAliveSeconds: number; phasedFraction: number;
}
export interface WeaponStats {
  weaponId: WeaponId; carId: CarId;
  presses: number; connectingPresses: number; hitRate: Interval;
  damage: number; derivedDamage: number; kills: number;
  damagePerPress: number; kitDamageShare: number; pressesPerMinute: number;
  meanFirstUseSeconds: number | null;
}
export interface MatchupCell { attacker: CarId; defender: CarId; winRate: Interval; meanTicks: number; meanWinnerHp: number }
export interface PaceStats { meanMatchSeconds: number; meanFirstBloodSeconds: number | null; killsPerMinute: number; clockFraction: number }

export function aggregate(outcomes: readonly MatchOutcome[]): {
  cars: CarStats[]; weapons: WeaponStats[]; matchups: MatchupCell[]; pace: PaceStats;
};
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/balance/stats.test.ts
import { describe, expect, it } from "vitest";
import { aggregate, wilson } from "./stats.js";

describe("wilson (B35)", () => {
  it("brackets the point estimate", () => {
    const i = wilson(50, 100);
    expect(i.rate).toBeCloseTo(0.5, 6);
    expect(i.low).toBeLessThan(0.5);
    expect(i.high).toBeGreaterThan(0.5);
  });

  it("narrows as n grows", () => {
    const small = wilson(5, 10);
    const large = wilson(500, 1000);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("stays inside [0, 1] at the extremes", () => {
    expect(wilson(0, 10).low).toBeGreaterThanOrEqual(0);
    expect(wilson(10, 10).high).toBeLessThanOrEqual(1);
  });

  it("returns a zero-width interval at the origin for n = 0", () => {
    expect(wilson(0, 0)).toEqual({ rate: 0, low: 0, high: 0, n: 0 });
  });
});

describe("aggregate (B30, B31)", () => {
  it("counts a press as one shot however many pellets it spawns", () => {
    const out = aggregate([synthetic({
      fired: [{ pressId: "a#1#1", weaponId: "pepperbox", shooterSessionId: "a", carId: "bullseye", slot: 1, tick: 1 }],
      damaged: [
        dmg({ pressId: "a#1#1", weaponId: "pepperbox", amount: 9 }),
        dmg({ pressId: "a#1#1", weaponId: "pepperbox", amount: 9 }),
      ],
    })]);
    const row = out.weapons.find((w) => w.weaponId === "pepperbox")!;
    expect(row.presses).toBe(1);
    expect(row.connectingPresses).toBe(1);
    expect(row.hitRate.rate).toBe(1);
    expect(row.damage).toBe(18);
  });

  it("counts a press that landed nothing as a miss", () => {
    const out = aggregate([synthetic({
      fired: [{ pressId: "a#1#0", weaponId: "lance", shooterSessionId: "a", carId: "bullseye", slot: 0, tick: 1 }],
      damaged: [],
    })]);
    expect(out.weapons.find((w) => w.weaponId === "lance")!.hitRate.rate).toBe(0);
  });

  it("credits corroded pulse damage to magmablast and tracks it separately (B5a)", () => {
    const out = aggregate([synthetic({
      fired: [{ pressId: "a#1#0", weaponId: "magmablast", shooterSessionId: "a", carId: "mirage", slot: 0, tick: 1 }],
      damaged: [
        dmg({ pressId: "a#1#0", weaponId: "magmablast", amount: 50 }),
        { tick: 5, victimSessionId: "b", victimCarId: "bastion", attackerSessionId: "a", attackerCarId: "mirage",
          source: { kind: "pulse", statusId: "corroded", sourceSessionId: "a" }, amount: 8, killingBlow: false },
      ],
    })]);
    const row = out.weapons.find((w) => w.weaponId === "magmablast")!;
    expect(row.damage).toBe(58);
    expect(row.derivedDamage).toBe(8);
  });

  it("reports a weapon that is never pressed, so an ignored row is visible (B31)", () => {
    const out = aggregate([synthetic({ fired: [], damaged: [] })]);
    expect(out.weapons.some((w) => w.presses === 0)).toBe(true);
  });
});
```

> **Implementer note:** `synthetic(...)` and `dmg(...)` are local builders producing a `MatchOutcome` with the given events and two seats. Keep them in this file — they are the fixture that makes every assertion above readable.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/server`): `npx vitest run balance/stats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Key rules the implementation must honour:

- **`wilson(successes, n)`** at 95% (`z = 1.959964`): centre `(p + z²/2n) / (1 + z²/n)`, half-width `z/(1 + z²/n) · sqrt(p(1-p)/n + z²/4n²)`. Clamp to `[0, 1]`. `n = 0` returns `{rate: 0, low: 0, high: 0, n: 0}` rather than dividing by zero.
- **A press connects** when any `DamagedEvent` carries its `pressId` (B30). Build a `Set<string>` of press ids seen in `damaged`, then intersect with `fired`.
- **Weapon rows come from `CAR_TABLE`, not from the events** (B31). Every slot of every chassis gets a row, so a weapon nobody pressed reports `presses: 0` instead of vanishing.
- **`derivedDamage`** counts only damage attributed through `attributeSource(...).derived === true`, reported alongside the total so a reader can see how much of a weapon's number is inference (B5a).
- **`kitDamageShare`** is this weapon's damage over the total damage dealt by cars of its own chassis — a within-kit share, not a roster-wide one.
- **`phasedFraction`** is per-car phased ticks over alive ticks (B28a).

- [ ] **Step 4: Run tests to verify they pass**

Run (from `packages/server`): `npx vitest run balance/stats.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/balance/stats.ts packages/server/balance/stats.test.ts
git commit -m "feat(balance): per-car and per-weapon aggregation with Wilson intervals (B30-B35)"
```

---

### Task 18: The runner and its shapes

**Files:**
- Create: `packages/server/balance/runner.ts`
- Test: `packages/server/balance/runner.test.ts`

**Interfaces:**
- Consumes: `runMatch`/`MatchSetup` (Task 15), `aggregate` (Task 17), `deriveSeed` (Task 8).
- Produces:

```ts
export type Shape = "ffa" | "duel";
export interface RunConfig {
  shape: Shape; matches: number; mode: GameMode;
  difficulty: BotDifficulty; seed: number; arenaId: string; matchSeconds: number;
}
export function seatsFor(shape: Shape, matchIndex: number): { seats: MatchSetup["seats"]; label: string };
export function runAll(config: RunConfig, onMatch?: (i: number, total: number) => void): {
  outcomes: MatchOutcome[]; totalMatches: number;
};
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/balance/runner.test.ts
import { describe, expect, it } from "vitest";
import { runAll, seatsFor } from "./runner.js";

describe("seatsFor (B26, B27)", () => {
  it("seats an ffa match 2/2/2, always", () => {
    const carIds = seatsFor("ffa", 0).seats.map((s) => s.carId).sort();
    expect(carIds).toEqual(["bastion", "bastion", "bullseye", "bullseye", "mirage", "mirage"]);
  });

  it("gives every ffa match the same composition, so the null is exactly 1/3", () => {
    expect(seatsFor("ffa", 7).seats.map((s) => s.carId).sort())
      .toEqual(seatsFor("ffa", 0).seats.map((s) => s.carId).sort());
  });

  it("cycles duel through all nine ordered pairs", () => {
    const pairs = new Set(
      Array.from({ length: 9 }, (_, i) => seatsFor("duel", i).seats.map((s) => s.carId).join("-")),
    );
    expect(pairs.size).toBe(9);
  });

  it("includes the three mirrors, which are the rig's noise floor (B26a)", () => {
    const pairs = Array.from({ length: 9 }, (_, i) => seatsFor("duel", i).seats.map((s) => s.carId));
    expect(pairs.filter(([a, b]) => a === b)).toHaveLength(3);
  });
});

describe("runAll (B43)", () => {
  const config = {
    shape: "duel", matches: 1, mode: GameMode.FFA_LAST_STANDING,
    difficulty: "hard", seed: 5, arenaId: "arena-01", matchSeconds: 20,
  } as const;

  it("runs matches x pairs in duel", () => {
    expect(runAll(config).totalMatches).toBe(9);
  });

  it("replays identically for a seed", () => {
    const a = runAll(config);
    const b = runAll(config);
    expect(b.outcomes.map((o) => o.ticks)).toEqual(a.outcomes.map((o) => o.ticks));
  });

  it("gives each match its own derived seed, so two matches are not the same match", () => {
    const out = runAll({ ...config, shape: "ffa", matches: 2 });
    expect(out.outcomes[0]!.ticks !== out.outcomes[1]!.ticks
        || out.outcomes[0]!.events.damaged.length !== out.outcomes[1]!.events.damaged.length).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/server`): `npx vitest run balance/runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * The two shapes, because one experiment cannot answer both questions (B26).
 *
 * `ffa` seats a fixed 2/2/2 six-car match: equal representation makes the null hypothesis exactly
 * 33.3% and removes any need to normalize a win rate by how often a chassis appeared (B27).
 *
 * `duel` cycles all nine ordered chassis pairs. A six-way melee cannot answer "does Mirage beat
 * Bastion" — with five cars shooting each other every pairwise claim is confounded. The three
 * mirrors are kept deliberately: they MUST converge on 50%, so a mirror that does not is proof of
 * positional bias in the rig itself, not a finding about the game (B26a).
 */
```

`runAll` derives `deriveSeed(config.seed, "match", i)` per match and calls `runMatch` with `maxTicks: config.matchSeconds * TICK_RATE_HZ`. In `duel`, the outer loop is `matches` and the inner is the nine pairs, so `totalMatches = matches * 9`.

- [ ] **Step 4: Run tests to verify they pass**

Run (from `packages/server`): `npx vitest run balance/runner.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/balance/runner.ts packages/server/balance/runner.test.ts
git commit -m "feat(balance): ffa and duel shapes, seeded per match (B26, B26a, B27, B43)"
```

---

### Task 19: Fingerprints and the report

**Files:**
- Create: `packages/server/balance/fingerprint.ts`, `packages/server/balance/report.ts`
- Test: `packages/server/balance/fingerprint.test.ts`, `packages/server/balance/report.test.ts`

**Interfaces:**
- Consumes: aggregation output (Task 17), `RunConfig` (Task 18), `createRunDir` (Task 14), `BOT_PROFILES`.
- Produces:

```ts
export function configFingerprint(): string;   // WEAPON_TABLE, CAR_TABLE, COMBAT_CONFIG, DRIVE_CONFIG, STATUS_TABLE
export function botFingerprint(): string;      // BOT_PROFILES, whole
export interface RunRecord { config: RunConfig; fingerprints: { config: string; bot: string };
  gitCommit: string; startedAt: string; durationSeconds: number; totalMatches: number;
  cars: CarStats[]; weapons: WeaponStats[]; matchups: MatchupCell[]; pace: PaceStats }
export function writeReport(dir: string, record: RunRecord, baseline?: RunRecord): string[];
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/balance/fingerprint.test.ts
describe("fingerprints (B39)", () => {
  it("is stable across calls", () => {
    expect(configFingerprint()).toBe(configFingerprint());
  });
  it("is a short hex string, readable in a header", () => {
    expect(configFingerprint()).toMatch(/^[0-9a-f]{8,16}$/);
  });
  it("distinguishes the config and bot hashes", () => {
    expect(configFingerprint()).not.toBe(botFingerprint());
  });
});
```

```ts
// packages/server/balance/report.test.ts
describe("writeReport (B38, B39, B40)", () => {
  it("writes summary.md, matches.csv, weapons.csv and run.json", () => {
    const files = writeReport(tempDir(), record());
    expect(files.map((f) => path.basename(f)).sort())
      .toEqual(["matches.csv", "run.json", "summary.md", "weapons.csv"]);
  });

  it("prints every rate with its interval, never bare (B35)", () => {
    const md = fs.readFileSync(path.join(tempDir(), "summary.md"), "utf8");
    expect(md).toMatch(/\d+\.\d%\s*\(\s*\d+\.\d–\d+\.\d\s*\)/);
  });

  it("carries seed, shape, mode, commit and both fingerprints in the header", () => {
    const md = readSummary();
    for (const token of ["seed", "shape", "mode", "commit", "config fingerprint", "bot fingerprint"]) {
      expect(md.toLowerCase()).toContain(token);
    }
  });

  it("prints the bot profile values verbatim, so an old report stays interpretable", () => {
    expect(readSummary()).toContain("standoffUnits");
  });

  it("states its limitations in its own body (B40)", () => {
    const md = readSummary().toLowerCase();
    expect(md).toContain("model of skill");
    expect(md).toContain("run #1 validates the rig");
  });

  it("leads the duel table with the mirror noise floor (B26a)", () => {
    const md = readSummary({ shape: "duel" });
    expect(md.indexOf("Mirror")).toBeLessThan(md.indexOf("Matchup matrix"));
  });

  it("round-trips run.json, so a baseline can be read back", () => {
    writeReport(tempDir(), record());
    const parsed = JSON.parse(fs.readFileSync(path.join(tempDir(), "run.json"), "utf8"));
    expect(parsed.fingerprints.config).toBe(configFingerprint());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/server`): `npx vitest run balance/fingerprint.test.ts balance/report.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`fingerprint.ts` — FNV-1a over `JSON.stringify` of each table with sorted keys, hex-encoded. Hash the tables **whole**, following `balanceStamp`'s precedent, so any field of any row counts. Computed here rather than imported because `balanceStamp` lives in `scripts/build-cars-and-weapons.mjs`, a build script outside the TypeScript packages (B39).

`report.ts` — `summary.md` sections in this order:

1. **Header** — seed, shape, mode, arena, N, git commit (`git rev-parse --short HEAD`), duration, both fingerprints, and the `BOT_PROFILES` row used, verbatim.
2. **Limitations** — B45's list, plus B2's pilot caveat and B23's profile tension, in prose. Not a link: a caveat that lives only in a design doc is a caveat nobody reads while reading a number (B40).
3. **Mirror noise floor** (duel only, first) — the three mirrors with intervals, and one line saying what a reading far from 50% means (B26a).
4. **Per-car** table.
5. **Per-weapon** table, with a `derived` column where `derivedDamage > 0`.
6. **Matchup matrix** (duel only).
7. **Pace**.
8. **Deltas vs baseline** when one was supplied.

Format every rate as `41.3% (32.1–50.9)`.

- [ ] **Step 4: Run tests to verify they pass**

Run (from `packages/server`): `npx vitest run balance/fingerprint.test.ts balance/report.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/balance/fingerprint.ts packages/server/balance/report.ts packages/server/balance/fingerprint.test.ts packages/server/balance/report.test.ts
git commit -m "feat(balance): report with intervals, provenance and stated limits (B38-B40)"
```

---

### Task 20: Baseline comparison

**Files:**
- Create: `packages/server/balance/baseline.ts`
- Test: `packages/server/balance/baseline.test.ts`

**Interfaces:**
- Consumes: `RunRecord` (Task 19).
- Produces: `loadBaseline(dir: string): RunRecord`; `checkComparable(current: RunRecord, baseline: RunRecord): { ok: boolean; reasons: string[] }`.

**Why the guard (B37):** comparing across a bot revision or a config edit is exactly the mistake that attributes a bot improvement to a weapon nerf.

- [ ] **Step 1: Write the failing test**

```ts
describe("checkComparable (B37)", () => {
  it("accepts two runs with matching fingerprints and shape", () => {
    expect(checkComparable(record(), record()).ok).toBe(true);
  });

  it("refuses when the bot changed, and says so", () => {
    const other = { ...record(), fingerprints: { ...record().fingerprints, bot: "deadbeef" } };
    const result = checkComparable(record(), other);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("bot");
  });

  it("refuses when the config changed", () => {
    const other = { ...record(), fingerprints: { ...record().fingerprints, config: "deadbeef" } };
    expect(checkComparable(record(), other).ok).toBe(false);
  });

  it("refuses when the shape or mode differ", () => {
    const other = { ...record(), config: { ...record().config, shape: "duel" as const } };
    expect(checkComparable(record(), other).ok).toBe(false);
  });

  it("warns rather than refuses when only the seed differs, since that is just a different sample", () => {
    const other = { ...record(), config: { ...record().config, seed: 99 } };
    const result = checkComparable(record(), other);
    expect(result.ok).toBe(true);
    expect(result.reasons.join(" ")).toContain("seed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/server`): `npx vitest run balance/baseline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Whether two runs may be compared at all (B37).
 *
 * A differing CONFIG or BOT fingerprint is fatal: the two runs measured different games, and a delta
 * between them would attribute a bot improvement to a weapon nerf. Shape and mode are fatal for the
 * same reason — a duel win rate and an FFA win rate are not the same quantity.
 *
 * A differing SEED is not fatal. It is a different sample of the same experiment, which is a
 * legitimate thing to compare; it just is not the PAIRED comparison that makes a one-number edit
 * measurable (B36), so it warns.
 */
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `packages/server`): `npx vitest run balance/baseline.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/balance/baseline.ts packages/server/balance/baseline.test.ts
git commit -m "feat(balance): paired-baseline comparison behind a fingerprint guard (B36, B37)"
```

---

### Task 21: CLI

**Files:**
- Create: `packages/server/balance/cli.ts`, `packages/server/balance/run.ts`
- Test: `packages/server/balance/cli.test.ts`
- Modify: `packages/server/package.json`, root `package.json`

**Interfaces:**
- Consumes: everything above.
- Produces: `parseArgs(argv: readonly string[]): RunConfig & { baseline?: string; out?: string }`; `run.ts` as the `tsx` entry point.

- [ ] **Step 1: Write the failing test**

```ts
describe("parseArgs (B41, B42)", () => {
  it("defaults to ffa deathmatch at pro, 50 matches", () => {
    const c = parseArgs([]);
    expect(c).toMatchObject({ shape: "ffa", mode: GameMode.FFA_DEATHMATCH, difficulty: "hard", matches: 50 });
  });

  it("maps player types to difficulties (B42)", () => {
    expect(parseArgs(["--skill=amateur"]).difficulty).toBe("easy");
    expect(parseArgs(["--skill=casual"]).difficulty).toBe("medium");
    expect(parseArgs(["--skill=pro"]).difficulty).toBe("hard");
  });

  it("defaults duel to last-standing, since a duel wants one clean winner", () => {
    expect(parseArgs(["--shape=duel"]).mode).toBe(GameMode.FFA_LAST_STANDING);
  });

  it("lets --mode override the shape default", () => {
    expect(parseArgs(["--shape=duel", "--mode=deathmatch"]).mode).toBe(GameMode.FFA_DEATHMATCH);
  });

  it("generates a seed when none is given", () => {
    expect(Number.isInteger(parseArgs([]).seed)).toBe(true);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseArgs(["--matches=10", "--tyop=3"])).toThrow(/tyop/);
  });

  it("rejects a non-numeric match count", () => {
    expect(() => parseArgs(["--matches=lots"])).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/server`): `npx vitest run balance/cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cli.ts`**

Flags per B41. Throw on an unknown flag — silently ignoring a typo would produce a run that says it did something it did not. The skill→difficulty mapping lives here and only here (B42), and the report prints both forms (`pro (hard)`).

- [ ] **Step 4: Implement `run.ts`**

```ts
/**
 * `npm run balance -- [flags]`.
 *
 * Prints the seed FIRST, before anything runs: a run that turns out interesting is one you will
 * want to replay exactly, and the seed is the whole of that (B36).
 */
```

It parses, prints the resolved config and seed, runs, prints per-match progress and the measured per-match cost (B44), aggregates, writes the report, and prints the folder. Exit non-zero only when the harness itself failed — a lopsided balance result is a finding, not an error, exactly as `run-all.ts` treats a `FINDING`.

- [ ] **Step 5: Wire the scripts**

`packages/server/package.json`: `"balance": "tsx balance/run.ts"`
Root `package.json`: `"balance": "npm run build -w @motor-combat-moba/shared && npm run balance -w @motor-combat-moba/server"`

- [ ] **Step 6: Smoke-run it**

Run (from repo root): `npm run balance -- --matches=2 --match-seconds=20 --seed=1`
Expected: two matches, a dated folder under `packages/server/balance/reports/`, four files, exit 0. Open `summary.md` and confirm the header, the limitations section and the intervals are all present.

- [ ] **Step 7: Commit**

```bash
git add packages/server/balance/cli.ts packages/server/balance/run.ts packages/server/balance/cli.test.ts packages/server/package.json package.json
git commit -m "feat(balance): npm run balance, with seeded replay and a stated skill mapping (B41-B44)"
```

---

### Task 22: Docs, gitignore, and the behaviour-preservation proof

**Files:**
- Create: `packages/server/balance/README.md`
- Modify: `.gitignore`, root `CLAUDE.md`, `docs/superpowers/specs/2026-09-03-game-balance-harness-design.md` (status line)

- [ ] **Step 1: Ignore the reports**

Add to `.gitignore`, beside the playtest entry:

```
packages/server/balance/reports/
```

A report is a record of one run on one machine, never source — the same rule `playtest/reports/` follows.

- [ ] **Step 2: Write the README**

Cover: what it measures and what it does not (B45 verbatim); the two shapes and which questions each answers; every flag; the paired-run workflow (B36) as the *primary* way to use it; how to read an interval, and why a 38% chassis over 100 matches is not a finding (B35); the mirror noise floor (B26a); and where the reports land. Follow `playtest/README.md`'s voice — step-by-step, with the shared-`dist` warning up front.

- [ ] **Step 3: Add a root `CLAUDE.md` section**

A short section beside the playtest one: what `npm run balance` is, that it is not part of the test suite or the release build, that it measures balance rather than glitches, that its numbers are conditioned on the bot tier and carry a bot fingerprint for that reason, and a pointer to the README and the spec. Add `npm run balance` to the Commands block and a row to the "Read the right doc" table.

- [ ] **Step 4: Prove behaviour was preserved (B50)**

```bash
npm run build && npm test
npm run playtest
```

Expected: all three suites pass; six probes run and exit 0. Compare this run's `summary.md` verdicts against a run from before Phase A — **any probe whose numbers moved means B1 was violated** and the seam changed behaviour. Investigate before proceeding; do not update the probe to match.

- [ ] **Step 5: Flip the spec's status**

Change `**Status:** Approved, not yet implemented.` to `**Status:** Implemented 2026-09-03.`

- [ ] **Step 6: Commit**

```bash
git add .gitignore packages/server/balance/README.md CLAUDE.md docs/superpowers/specs/2026-09-03-game-balance-harness-design.md
git commit -m "docs(balance): README, CLAUDE.md section, and the behaviour-preservation check (B45, B50)"
```

---

## Self-Review

**Spec coverage.** Every decision maps to a task: B1/B50 → Tasks 6, 22. B2/B40/B45 → Task 19, 22. B3–B6 → Tasks 1, 5, 6. B5a → Task 16. B7/B8/B8a → Tasks 2, 3, 4. B9 → Task 1 (server-side by construction). B10–B14/B20–B22 → Tasks 7–11. B15–B19 → Tasks 9, 10. B23 → Global Constraints (no retune). B24–B29 → Tasks 15, 18. B26a → Tasks 18, 19. B28a → Tasks 10, 17. B30–B35 → Task 17. B36–B39 → Tasks 19, 20. B41–B44 → Task 21. B46 → Tasks 14, 15. B47–B49 → tests throughout. B51/B52 → rejected, nothing to build.

**Four gaps found and closed while reviewing:**
- `runPipeline` had no way to receive the event sink. Now called out explicitly in Task 15, Step 3, rule 2 — it is the only edit Phase C makes to shipped code.
- `BotView.instances` needed `toInstances(combat)`, which Task 10's first draft left unfilled. Now an explicit implementer note with the allocation caveat.
- Task 1 told the implementer to add `export * from` to `packages/shared/src/index.ts`. That index uses **explicit named exports** throughout, with `export type` for types — corrected, or the first task would have introduced a style break into the package's public API.
- Task 10 imported `readStatuses` from shared. It is the **server's** status bridge (`packages/server/src/sim/status-bridge.ts`) — the only file that maps `PlayerState.statuses` onto the sim — and importing it from shared would not have compiled.

**Type consistency.** `pressId` is a `string` everywhere (`PendingFire`, `ShotOrder`, `WeaponInstance`, `maneuverPressId`, `DamageSource`). `BotIntent` is `{steer, throttle, fireSlots}` at every use, never an `InputMessage`. `Rng` is `() => number` in `rng.ts`, `types.ts` and `view.ts`. `Interval` is produced by `wilson` and consumed by `CarStats`, `WeaponStats` and `MatchupCell` under the same name.

**Known ordering constraint.** Phase A must land before Phase C — Task 15 needs the sink, Task 17 needs the events. Phase B is independent of Phase A and could run in parallel, but Tasks 12 and 13 must follow 7–11, and Task 15 needs Task 11.
