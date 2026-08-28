# Attack Stat and Damage Formula Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire collision damage, rename the chassis `strength` rating to `attack`, and make `attack` a bounded percentage modifier on weapon damage — tuned so an average car kills an average car in 5 seconds.

**Architecture:** Three moves, in order. First the ram-damage subsystem is deleted outright (it is the only consumer of `strength`, and removing it first keeps every intermediate commit compiling). Then chassis ratings widen from 0–10 to 0–100 on a 150-point budget, with `speedPerRating` divided by 10 so no car's top speed moves. Finally a pure `damageFor(attack, weaponDamage)` helper is added and wired in at **shot spawn** — the resolved damage is frozen onto the `WeaponInstance`, following the existing `ownerTeam` precedent, so `hits.ts` keeps its rule of never reading player state.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared` / `server` / `client`), Vitest, Colyseus schema, Phaser 3.

**Spec:** [`docs/superpowers/specs/2026-08-28-attack-stat-damage-formula-design.md`](../specs/2026-08-28-attack-stat-damage-formula-design.md)

## Global Constraints

- **This is a git worktree with no `node_modules`.** Run `npm install` from the worktree root before the first build — otherwise Node walks up to the main checkout and every build silently inlines *master's* shared `dist`. See Task 0.
- **Build with root `npm run build`, never `npm run build --workspaces`.** The server's tsup step inlines shared's `dist`; the root script enforces shared → server → client ordering.
- `npm test` (from the worktree root) builds shared and then runs all three suites plus the script tests. It is the verification command for every task.
- No magic numbers in logic. Every balance number lives in a shared config table.
- `PlayerState.hp` is `uint16` — damage must resolve to a non-negative integer.
- `sim/weapons/hits.ts` may **not** read player state. It is the lag-compensation seam.
- `applyDamage` in `sim/damage.ts` stays the only place hp is ever reduced.
- **Do not touch `sim/collide.ts`.** Collision physics is out of scope, including `obbsInContact`, which loses its only caller but stays exported.
- Commit after every task. Branch is `claude/combat-stats-scope-1c7815`; do not merge to `development/main` without asking.

---

### Task 0: Install the worktree

**Files:**
- Modify: none (writes `node_modules/`, leaves `package-lock.json` untouched)

**Interfaces:**
- Consumes: nothing
- Produces: a working build for every later task

- [ ] **Step 1: Install**

```bash
npm install
```

- [ ] **Step 2: Verify the suite is green before changing anything**

```bash
npm test
```

Expected: all three workspace suites pass. If they do not, stop and report — the baseline is broken and nothing below is trustworthy.

- [ ] **Step 3: Verify shared `dist` did not escape the worktree**

```bash
npm run build && grep -c "\.\./\.\./\.\./\.\./\.\./packages/shared/dist" packages/server/dist/index.js
```

Expected: `0`. A non-zero count means the build inlined the main checkout's shared — re-run `npm install`. Do not commit; this task produces no source changes.

---

### Task 1: Delete collision damage

Removes the whole ram-damage subsystem. After this task cars still collide and shove each other exactly as before, but contact costs nobody hp.

**Files:**
- Delete: `packages/shared/src/sim/ram.ts`
- Delete: `packages/shared/src/sim/ram.test.ts`
- Modify: `packages/shared/src/index.ts:34-35`
- Modify: `packages/shared/src/sim/combat.ts`
- Modify: `packages/shared/src/config/combat-config.ts`
- Modify: `packages/shared/src/config/config.test.ts:61-66`
- Modify: `packages/shared/src/sim/combat.test.ts:481-814`
- Modify: `packages/server/src/sim/combat-bridge.ts`
- Modify: `packages/server/src/rooms/ArenaRoom.ts`
- Modify: `packages/client/src/ui/car-select-view.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `CombatInput` and `CombatResult` without `ramCooldowns`; `COMBAT_CONFIG` reduced to `{ hpPerRating: 10 }`

- [ ] **Step 1: Delete the old ram suites first**

Do this **before** adding anything, or the line numbers below will have shifted under you.

In `packages/shared/src/sim/combat.test.ts`, delete two whole `describe` blocks and the long explanatory comment between them:

- `describe("ramming", ...)` — currently begins at line 481
- the multi-line comment beginning "The gap the unit tests above left open"
- `describe("ramming, driven through the real sim", ...)`

That is everything from line **481** up to but **not including** `describe("aim assist through a real tick", ...)` (currently line 815). Identify the boundaries by those block names rather than trusting the line numbers.

Delete the whole file `packages/shared/src/sim/ram.test.ts`.

- [ ] **Step 2: Write the failing test — contact must cost nothing**

Add this block to `packages/shared/src/sim/combat.test.ts` in the gap the deletion just left, between `describe("shots landing", ...)` and `describe("aim assist through a real tick", ...)`. It replaces the ram suite with its inverse.

Note both cars are asserted at `hpOf("rectangle")` even though car "a" is an oval: the file-level `player()` helper hardcodes `hp: hpOf("rectangle")` regardless of `carId`, and the ram tests being replaced asserted the same way. The `carId: "oval"` matters only because the old suite used the harder-hitting chassis to prove damage landed — here it proves the opposite.

```ts
/**
 * Collision deals no damage. The cars still collide — `resolveWorld` shoves them apart every tick —
 * they just cost each other no hp. Driven through the real `stepSim` rather than hand-placed,
 * because that is the only way to produce the "touching at a gap of zero" state a real crash ends in.
 */
describe("collision deals no damage", () => {
  const OPEN = { width: ARENA_01.width, height: ARENA_01.height };
  const CLEAR = { carId: "rectangle" as const, obstacles: [] as never[], bounds: OPEN };
  const THROTTLE: InputMessage = { seq: 1, steer: 0, throttle: 1, fireSlots: 0 };
  const COAST: InputMessage = { seq: 1, steer: 0, throttle: 0, fireSlots: 0 };

  function simTick(
    state: { a: SimBody; b: SimBody; players: CombatPlayer[] },
    tick: number,
    inputs: { a: InputMessage; b: InputMessage },
  ) {
    const a = stepSim(state.a, inputs.a, DT, {
      ...CLEAR,
      others: [carHullOf(state.b.x, state.b.y, state.b.angle)],
    });
    const b = stepSim(state.b, inputs.b, DT, {
      ...CLEAR,
      others: [carHullOf(a.x, a.y, a.angle)],
    });
    const result = runCombat({
      world: { tick, dt: DT, mode: "ffa", obstacles: [], bounds: OPEN },
      players: [
        { ...state.players[0]!, x: a.x, y: a.y, angle: a.angle },
        { ...state.players[1]!, x: b.x, y: b.y, angle: b.angle },
      ],
      instances: [],
      instanceSeq: 0,
    });
    return { a, b, players: result.players };
  }

  function pair(bAngle: number) {
    const a: SimBody = { x: 800, y: 800, angle: 0, speed: 300, reverseHold: 0 };
    const b: SimBody = { x: 900, y: 800, angle: bAngle, speed: 0, reverseHold: 0 };
    return {
      a,
      b,
      players: [
        player("a", { x: a.x, y: a.y, angle: 0, carId: "oval" }),
        player("b", { x: b.x, y: b.y, angle: bAngle }),
      ],
    };
  }

  it("a car driven into the back of another deals no damage", () => {
    let state = pair(0);
    for (let tick = 0; tick < 20; tick++) state = simTick(state, tick, { a: THROTTLE, b: COAST });
    expect(state.players[0]!.hp).toBe(hpOf("rectangle"));
    expect(state.players[1]!.hp).toBe(hpOf("rectangle"));
  });

  it("a head-on deals no damage to either car", () => {
    let state = pair(Math.PI);
    for (let tick = 0; tick < 20; tick++) state = simTick(state, tick, { a: THROTTLE, b: THROTTLE });
    expect(state.players[0]!.hp).toBe(hpOf("rectangle"));
    expect(state.players[1]!.hp).toBe(hpOf("rectangle"));
  });

  it("the cars still collide: contact pushes them apart rather than through each other", () => {
    let state = pair(0);
    for (let tick = 0; tick < 20; tick++) state = simTick(state, tick, { a: THROTTLE, b: COAST });
    // b was rear-ended and shoved forward; the hulls never interpenetrate.
    expect(state.b.x).toBeGreaterThan(900);
    expect(state.b.x - state.a.x).toBeGreaterThanOrEqual(DRIVE_CONFIG.carWidth - 1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test -w @motor-combat-moba/shared
```

Expected: FAIL. `ramCooldowns` is still a required property of `CombatInput`, so the new `runCombat({...})` call in `simTick` will not type-check.

- [ ] **Step 4: Delete `sim/ram.ts` and its exports**

Delete the whole file `packages/shared/src/sim/ram.ts`.

In `packages/shared/src/index.ts`, delete these two lines:

```ts
export { isRamming, ramDamage, ramOutcome } from "./sim/ram.js";
export type { RamOutcome } from "./sim/ram.js";
```

- [ ] **Step 5: Strip ramming out of `sim/combat.ts`**

Delete the import of ram helpers entirely:

```ts
import { isRamming, ramDamage, ramOutcome } from "./ram.js";
```

Narrow three surviving imports — `COMBAT_CONFIG`, `CAR_TABLE`, `obbsInContact` and `carIdOf` all become unused:

```ts
// delete these two whole import statements:
import { CAR_TABLE } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";

// drop `obbsInContact` from this list, keeping the rest:
import {
  aabbCorners,
  convexOverlap,
  pointOutsideBounds,
  type Aabb,
  type Bounds,
} from "./collide.js";

// drop `carIdOf`, keeping `carHullOf`:
import { carHullOf } from "./context.js";
```

Delete the `ramCooldowns` field and its doc comment from `CombatInput`, and the `ramCooldowns` field from `CombatResult`:

```ts
export interface CombatInput {
  world: CombatWorld;
  players: readonly CombatPlayer[];
  instances: readonly WeaponInstance[];
  /** Monotonic counter behind instance ids. Carried in and back out so ids never repeat. */
  instanceSeq: number;
}

export interface CombatResult {
  players: CombatPlayer[];
  instances: WeaponInstance[];
  instanceSeq: number;
}
```

Delete **the whole of phase 5** — from the comment `// 5. Ramming — unchanged from the pre-weapon-system combat step apart from the rename of the projectile phase above it.` through the closing brace of its outer `for` loop — and change the return statement:

```ts
  return { players, instances: survivors, instanceSeq };
```

Delete the two now-orphaned helper functions near the bottom of the file: `ramDamageOf` and `pruneCooldowns` (including their doc comments).

Finally, update `runCombat`'s doc comment. Two sentences describe ramming and are now false — replace the first line and the phase-order line:

```ts
/**
 * One tick of combat: recharge, shots fired, shots flown, shots landed. Pure — inputs are never
 * mutated, and the result is a fresh set of players and instances for the caller to write back.
 *
 * This runs *after* driving has resolved for the tick, so every hit test reads the poses cars
 * actually ended up at.
 *
 * ...
 *
 *     tickRecharge -> (step existing instances) -> update lock -> beginFire -> releaseShots -> hit resolution
 *
 * ...
 */
```

Leave the rest of that comment (server-only, lag compensation, sorted order, `startUpMs: 0`) exactly as it is.

- [ ] **Step 6: Shrink `COMBAT_CONFIG`**

Replace the whole of `packages/shared/src/config/combat-config.ts` with:

```ts
export const COMBAT_CONFIG = {
  hpPerRating: 10,
} as const;
```

- [ ] **Step 7: Strip `ramCooldowns` from the server**

In `packages/server/src/sim/combat-bridge.ts`, delete the `ramCooldowns` field and its doc comment from `CombatMemory`, and the `ramCooldowns: new Map(),` line from `newCombatMemory()`. Also fix the module doc comment, which cites ramming as an example of a rule:

```ts
 * The split is deliberate. `runCombat` is where every rule lives and it can be tested without a
 * Colyseus room; this file is the only place that knows about `MapSchema`, and it holds no rules at
 * all. Anything resembling a decision — who may be hit, what a shot costs — belongs on the other
 * side of this boundary, in `@motor-combat-moba/shared`.
```

In `packages/server/src/rooms/ArenaRoom.ts`, delete all four `ramCooldowns` lines:

```ts
      ramCooldowns: this.combat.ramCooldowns,   // in the runCombat({...}) call
    this.combat.ramCooldowns = result.ramCooldowns;
    this.combat.ramCooldowns = new Map();       // in match setup
    this.combat.ramCooldowns = new Map();       // in endMatch
```

The match-setup comment above one of them mentions ram cooldowns; re-word it:

```ts
    // Nothing from the previous match survives into this one: no shots in flight, and no stale fire
    // state (a stock or a switch lock the new car never earned).
```

- [ ] **Step 8: Drop the two dead rows from the car-select panel**

In `packages/client/src/ui/car-select-view.ts`, delete the `"Ram damage"` and `"Hit cooldown"` rows from `fullStatsFor`. The function becomes:

```ts
export function fullStatsFor(id: CarId): StatRow[] {
  const def = CAR_TABLE[id];
  return [
    { label: "Top speed", value: `${trim(forwardMaxSpeedOf(id))} u/s` },
    { label: "Reverse speed", value: `${trim(reverseMaxSpeedOf(id))} u/s` },
    { label: "Turn rate", value: `${trim(DRIVE_CONFIG.turnRate)} rad/s` },
    { label: "Hull HP", value: String(hpOf(id)) },
    { label: "Hull size", value: `${DRIVE_CONFIG.carWidth} x ${DRIVE_CONFIG.carHeight}` },
  ];
}
```

`def` and the `COMBAT_CONFIG` / `TICK_RATE_HZ` imports are now unused in this file — remove `const def = ...` and drop `COMBAT_CONFIG` and `TICK_RATE_HZ` from the import list at the top. (`CAR_TABLE` is still used further down by `carSelectView`; keep it.)

- [ ] **Step 9: Fix the config test's combat block**

In `packages/shared/src/config/config.test.ts`, replace the `"combat defaults"` test:

```ts
  it("combat defaults", () => {
    expect(COMBAT_CONFIG.hpPerRating).toBe(10);
  });
```

- [ ] **Step 10: Run the full suite**

```bash
npm test
```

Expected: PASS, all three workspaces. If `tsc` reports an unused import anywhere, delete it — do not suppress it.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat(combat)!: remove collision damage" -m "Deletes the ram-damage subsystem outright rather than zeroing its rate: sim/ram.ts, phase 5 of runCombat, the per-pair ramCooldowns map threaded through CombatInput/CombatResult and the server, and the four now-orphaned COMBAT_CONFIG keys.

Collision physics is untouched. Cars still shove each other; contact just costs nobody hp.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Rename to `attack`, widen ratings to 0–100, retune to a 5-second TTK

The balance change, landed whole: ratings, hull HP, and weapon damage all move in one commit so the game is never in a half-scaled state. Every car deals the same 50 damage at the end of this task; per-chassis differentiation arrives in Task 4.

**Files:**
- Modify: `packages/shared/src/config/types.ts:8`
- Modify: `packages/shared/src/config/car-config.ts:5-9`
- Modify: `packages/shared/src/config/drive-config.ts:19-26`
- Modify: `packages/shared/src/config/weapon-config.ts`
- Modify: `packages/shared/src/config/config.test.ts`
- Modify: `packages/client/src/ui/car-select-view.ts:25,110`
- Modify: `packages/client/src/ui/screens/car-select.ts:13-24`
- Modify: `packages/shared/src/sim/combat.test.ts` (see Step 6)

**Interfaces:**
- Consumes: `COMBAT_CONFIG` from Task 1
- Produces: `CarDef.attack: number`; ratings 0–100 summing to 150 per row; `hpOf` returning 400 / 300 / 700; `WEAPON_TABLE.fireball.damage === 50`, `WEAPON_TABLE.repeater.damage === 31`

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/config/config.test.ts`, replace the `"matches the locked ratings"` and `"derives actual HP via hpPerRating"` tests, and add three new ones, inside the existing `describe("CAR_TABLE", ...)`:

```ts
  it("matches the locked ratings", () => {
    expect(CAR_TABLE.rectangle).toMatchObject({ speed: 80, attack: 30, hp: 40 });
    expect(CAR_TABLE.oval).toMatchObject({ speed: 50, attack: 70, hp: 30 });
    expect(CAR_TABLE.hexagon).toMatchObject({ speed: 30, attack: 50, hp: 70 });
  });

  it("spends exactly the 150-point budget on every chassis, in whole 0-100 ratings", () => {
    // The budget is the roster's fairness rule: a fourth car cannot be authored strictly better than
    // the three shipped ones. It was already true by eye (every car summed to 16 on the old 0-10
    // scale); pinning it makes it a rule rather than a coincidence.
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const def = CAR_TABLE[id];
      for (const rating of [def.speed, def.attack, def.hp]) {
        expect(Number.isInteger(rating)).toBe(true);
        expect(rating).toBeGreaterThanOrEqual(0);
        expect(rating).toBeLessThanOrEqual(100);
      }
      expect(def.speed + def.attack + def.hp).toBe(150);
    }
  });

  it("derives actual HP via hpPerRating", () => {
    expect(hpOf("rectangle")).toBe(400);
    expect(hpOf("oval")).toBe(300);
    expect(hpOf("hexagon")).toBe(700);
  });

  it("keeps every top speed exactly where it was before the ratings widened", () => {
    // The 10x rating change is cancelled by speedPerRating 45 -> 4.5. This is a combat change; if a
    // car's top speed moved, the cancellation is wrong.
    expect(forwardMaxSpeedOf("rectangle")).toBe(540);
    expect(forwardMaxSpeedOf("oval")).toBe(405);
    expect(forwardMaxSpeedOf("hexagon")).toBe(315);
  });

  it("kills an average chassis with the baseline weapon in 5 seconds", () => {
    // The spec's headline number (S7). An "average" chassis is one rating point of each at the
    // baseline: 50 -> 500 hull HP. TTK is reckoned as hullHP / DPS, the sustained-fire figure.
    // This test is deliberately over-coupled: it should go red if ANY of hpPerRating,
    // fireball.damage, or fireball.cooldownMs drifts, because those three are what the 5s means.
    const averageHp = 50 * COMBAT_CONFIG.hpPerRating;
    const dps = (WEAPON_TABLE.fireball.damage * 1000) / WEAPON_TABLE.fireball.cooldownMs;
    expect(averageHp / dps).toBe(5);
  });
```

Add `WEAPON_TABLE` to the imports at the top of that file:

```ts
import { WEAPON_TABLE } from "./weapon-config.js";
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -w @motor-combat-moba/shared
```

Expected: FAIL — `Property 'attack' does not exist on type` from the `toMatchObject` and budget tests, plus value mismatches on hp and TTK.

- [ ] **Step 3: Rename the field on `CarDef`**

In `packages/shared/src/config/types.ts`, rename the field:

```ts
export interface CarDef {
  id: CarId;
  name: string;
  speed: number;
  attack: number;
  hp: number;
  /** Ordered loadout: index 0 is slot 1. Order IS the slot mapping. */
  weapons: readonly WeaponId[];
}
```

- [ ] **Step 4: Re-scale the roster**

In `packages/shared/src/config/car-config.ts`, replace `CAR_TABLE` and add the budget to its doc:

```ts
/**
 * The roster. Every rating is an integer 0-100 with 50 as average, and the three **must sum to
 * exactly 150** — the budget is what stops a fourth car being authored strictly better than these
 * three, and `config.test.ts` enforces it.
 *
 * `attack` is not damage. It is a percentage modifier on whatever weapon the car is firing, applied
 * by `damageFor` (`sim/damage.ts`): 0.5x at rating 0, 1.0x at 50, 1.5x at 100.
 */
export const CAR_TABLE = {
  rectangle: { id: "rectangle", name: "Rectangle", speed: 80, attack: 30, hp: 40, weapons: ["fireball"] },
  oval: { id: "oval", name: "Oval", speed: 50, attack: 70, hp: 30, weapons: ["fireball"] },
  hexagon: { id: "hexagon", name: "Hexagon", speed: 30, attack: 50, hp: 70, weapons: ["fireball"] },
} as const satisfies Record<CarId, CarDef>;
```

- [ ] **Step 5: Cancel the rating change in `speedPerRating`**

In `packages/shared/src/config/drive-config.ts`, change the value and re-word the two doc paragraphs that quote it:

```ts
  baseMaxSpeed: 180,
  /**
   * Ratings are 0-100 (see `CAR_TABLE`), so this is a tenth of what it would be on a 0-10 scale.
   * It was 45 against 0-10 ratings and became 4.5 when they widened, precisely so that every car's
   * top speed stayed where it was: widening the ratings is a combat change, not a driving one.
   */
  speedPerRating: 4.5,
```

In the module doc comment above `DRIVE_CONFIG`, the sentence beginning "`baseMaxSpeed` and `speedPerRating` scale together deliberately" stays true and needs no edit. The closing line "Times below are quoted for the fastest chassis (rectangle, speed rating 8, 540 units/second)" does not — change `speed rating 8` to `speed rating 80`.

- [ ] **Step 6: Re-scale weapon damage**

In `packages/shared/src/config/weapon-config.ts`, change `fireball`'s `damage: 8` to `damage: 50` and `repeater`'s `damage: 5` to `damage: 31`.

Add this paragraph to the `WEAPON_TABLE` doc comment, after the paragraph describing the `fireball` migration:

```
 * `damage` is what the weapon deals from a chassis at `COMBAT_CONFIG.attackBaseline` — an *average*
 * car, not every car. `damageFor` (`sim/damage.ts`) moves it +/-50% with the firing chassis's
 * `attack` rating. Fireball's 50 is solved, not chosen: an average chassis has 500 hull HP and
 * fireball fires twice a second, so 50 is the number that makes an average-vs-average kill take the
 * design target of 5 seconds. `repeater`'s 31 preserves its former 5:8 ratio against fireball.
```

- [ ] **Step 7: Fix the client stat bars**

In `packages/client/src/ui/car-select-view.ts`, rename the bar key and drop the `* 10`:

```ts
/** The three summary bars on a card. The panel carries the detail; the card stays readable. */
export const CAR_BARS = ["speed", "attack", "hp"] as const;
```

```ts
export interface StatBar {
  key: CarBarKey;
  /** 0-100, and so the rating verbatim — ratings are already on that scale. */
  percent: number;
}
```

```ts
      bars: CAR_BARS.map((key) => ({ key, percent: CAR_TABLE[id][key] })),
```

In `packages/client/src/ui/screens/car-select.ts`, rename the `strength` key in both records. The sword glyph moves with it unchanged:

```ts
const BAR_ICONS: Record<CarBarKey, string> = {
  speed: '<path d="M4 14h6v7l10-11h-6V3z"></path>',
  attack:
    '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"></path><path d="m13 19 6-6"></path><path d="m16 16 4 4"></path><path d="m19 21 2-2"></path>',
  hp: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>',
};

const BAR_LABELS: Record<CarBarKey, string> = {
  speed: "Speed",
  attack: "Attack",
  hp: "Bulk",
};
```

- [ ] **Step 8: Run the full suite**

```bash
npm test
```

Expected: PASS. The existing suites derive hp from `hpOf` and damage from `WEAPON_TABLE` rather than transcribing literals, so they should survive the re-scale untouched — the only assertions pinning the old numbers are the ones Step 1 already replaced.

Two hits you may notice while searching and should **not** change: `schema.test.ts` sets `p.hp = 50` and `combat-bridge.test.ts` uses `hp: 50` as fixture data. Neither is a roster value; both are arbitrary `uint16` payloads.

If anything else fails, it is a hard-coded number that should have been derived — fix it by deriving from `hpOf` / `forwardMaxSpeedOf` / `WEAPON_TABLE`, never by transcribing a fresh literal. Do not change any assertion's intent, only its arithmetic.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(combat)!: rename strength to attack and widen ratings to 0-100" -m "Ratings move to 0-100 on an explicit 150-point budget so a percentage damage modifier can resolve to distinct integers. hpPerRating stays 10, so hull HP becomes 400/300/700; speedPerRating drops 45 -> 4.5 to cancel the change, leaving every top speed exactly where it was.

fireball.damage 8 -> 50 is solved from the 5s average-vs-average TTK target, not picked. repeater 5 -> 31 keeps its former ratio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The `damageFor` formula

A pure, fully tested helper with no consumers yet. Task 4 wires it in.

**Files:**
- Modify: `packages/shared/src/config/combat-config.ts`
- Modify: `packages/shared/src/sim/damage.ts`
- Modify: `packages/shared/src/sim/damage.test.ts`
- Modify: `packages/shared/src/index.ts:33`
- Modify: `packages/shared/src/config/config.test.ts`

**Interfaces:**
- Consumes: `CarDef.attack` and the roster from Task 2
- Produces:
  - `damageFor(attack: number, weaponDamage: number): number` — exported from `sim/damage.ts` and from the package index
  - `weaponDamageOf(carId: CarId, weaponId: WeaponId): number` — same two places
  - `COMBAT_CONFIG.attackBaseline === 50`, `COMBAT_CONFIG.damagePerAttack === 0.01`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/sim/damage.test.ts`:

```ts
describe("damageFor", () => {
  it("leaves a weapon's damage untouched at the baseline rating", () => {
    expect(damageFor(COMBAT_CONFIG.attackBaseline, 50)).toBe(50);
  });

  it("halves at rating 0 and adds half again at rating 100", () => {
    expect(damageFor(0, 50)).toBe(25);
    expect(damageFor(100, 50)).toBe(75);
  });

  it("rises with attack and never falls", () => {
    let previous = -1;
    for (let attack = 0; attack <= 100; attack += 1) {
      const value = damageFor(attack, 50);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("always returns a whole number, so hp stays an integer", () => {
    // uint16 hp: a fractional subtraction would round somewhere less visible.
    for (const attack of [0, 7, 30, 33, 50, 66, 70, 99, 100]) {
      expect(Number.isInteger(damageFor(attack, 31))).toBe(true);
    }
  });

  it("keeps a zero-damage weapon at zero however high the attack", () => {
    expect(damageFor(100, 0)).toBe(0);
  });

  it("never returns a negative number for an out-of-range rating", () => {
    // Ratings are validated in config.test.ts, but a defensive floor here means a bad authoring
    // value cannot turn a weapon into a repair kit via applyDamage's `amount <= 0` early return.
    expect(damageFor(-500, 50)).toBeGreaterThanOrEqual(0);
  });
});

describe("weaponDamageOf", () => {
  it("gives each chassis its own damage with the same weapon", () => {
    expect(weaponDamageOf("rectangle", "fireball")).toBe(40);
    expect(weaponDamageOf("oval", "fireball")).toBe(60);
    expect(weaponDamageOf("hexagon", "fireball")).toBe(50);
  });
});
```

Add the imports this file needs at the top:

```ts
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { applyDamage, damageFor, weaponDamageOf } from "./damage.js";
```

(Keep whatever `applyDamage` import already exists — merge, do not duplicate.)

In `packages/shared/src/config/config.test.ts`, extend the combat block:

```ts
  it("combat defaults", () => {
    expect(COMBAT_CONFIG.hpPerRating).toBe(10);
    expect(COMBAT_CONFIG.attackBaseline).toBe(50);
    expect(COMBAT_CONFIG.damagePerAttack).toBe(0.01);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -w @motor-combat-moba/shared
```

Expected: FAIL with `damageFor is not exported` / `Property 'attackBaseline' does not exist`.

- [ ] **Step 3: Add the two config knobs**

Replace `packages/shared/src/config/combat-config.ts`:

```ts
export const COMBAT_CONFIG = {
  /** Hull HP per point of the `hp` rating. Ratings are 0-100, so hull HP runs 0-1000. */
  hpPerRating: 10,
  /**
   * The `attack` rating an "average" chassis carries, and the pivot `damageFor` measures from. A car
   * at exactly this rating deals a weapon's `damage` verbatim — which is what makes the number in
   * `WEAPON_TABLE` readable as damage rather than as an opaque base.
   */
  attackBaseline: 50,
  /**
   * Fractional damage change per point of `attack` away from `attackBaseline`. At 0.01 the full
   * 0-100 rating range spans 0.5x to 1.5x.
   *
   * Multiplicative, not additive, and that is load-bearing: a FLAT bonus would be collected once per
   * shot and so pay out in proportion to fire rate, quietly making `attack` a fire-rate stat — a
   * three-stock weapon like `repeater` would bank it three times per volley. A percentage gives a
   * fast weapon and a slow weapon the same proportional gain, so `attack` means the same thing
   * whatever is in the slot.
   */
  damagePerAttack: 0.01,
} as const;
```

- [ ] **Step 4: Write `damageFor` and `weaponDamageOf`**

Append to `packages/shared/src/sim/damage.ts`:

```ts
/**
 * What one hit of `weaponDamage` costs when fired by a chassis with this `attack` rating.
 *
 * The single definition of "how much does this hurt", as `applyDamage` above is the single
 * definition of "hp goes down". A later balance term — a level scalar, a per-weapon scaling
 * coefficient — enters here and nowhere else.
 *
 * Rounded here rather than at the point of impact, so an integer reaches `applyDamage` and a
 * piercing shot deals the identical number to every car it passes through. Floored at 0 so an
 * out-of-range rating cannot produce a negative amount.
 */
export function damageFor(attack: number, weaponDamage: number): number {
  const scale = 1 + (attack - COMBAT_CONFIG.attackBaseline) * COMBAT_CONFIG.damagePerAttack;
  return Math.max(0, Math.round(weaponDamage * scale));
}

/** `damageFor` with both lookups done: what this chassis deals with this weapon. */
export function weaponDamageOf(carId: CarId, weaponId: WeaponId): number {
  return damageFor(CAR_TABLE[carId].attack, weaponDefOf(weaponId).damage);
}
```

Add the imports at the top of `sim/damage.ts`:

```ts
import { CAR_TABLE } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { weaponDefOf } from "../config/weapon-config.js";
import type { CarId } from "../config/types.js";
import type { WeaponId } from "../config/weapon-types.js";
```

- [ ] **Step 5: Export from the package index**

In `packages/shared/src/index.ts`, replace line 33:

```ts
export { applyDamage, damageFor, weaponDamageOf } from "./sim/damage.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS, all three workspaces.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(combat): add the damageFor attack formula" -m "damageFor(attack, weaponDamage) is a bounded percentage modifier: 0.5x at rating 0, 1.0x at the 50 baseline, 1.5x at 100. Lives beside applyDamage as the single definition of how much a hit costs. No consumers yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Freeze resolved damage on the shot at spawn

Turns on per-chassis differentiation. The owner's attack is read **once**, at spawn, and frozen onto the instance — `hits.ts` must keep its rule of never reading player state.

**Files:**
- Modify: `packages/shared/src/sim/weapons/instances.ts`
- Modify: `packages/shared/src/sim/weapons/hits.ts:71`
- Modify: `packages/shared/src/sim/weapons/instances.test.ts`
- Modify: `packages/shared/src/sim/weapons/hits.test.ts`
- Modify: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `damageFor` / `weaponDamageOf` from Task 3
- Produces:
  - `WeaponInstance` gains a required `damage: number` field (sim-only; **not** added to `WeaponInstanceState`)
  - `spawnInstances`'s `owner` parameter widens to `{ sessionId: string; team: 0 | 1; carId: string } & OwnerPose`

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/sim/weapons/instances.test.ts` there are **two** `owner` fixtures — one at the top of the file (line 26) and a second inside a later describe block (line 222). Both are call sites of `spawnInstances` and both need `carId`:

```ts
// line 26
const owner = { sessionId: "aaa", team: 0 as const, carId: "rectangle", x: 500, y: 300, angle: 0 };
```

```ts
// line 222, inside its own describe
  const owner = { sessionId: "p1", team: 0 as const, carId: "rectangle", x: 100, y: 100, angle: 0 };
```

Then add a new test to `describe("spawning", ...)`:

```ts
  it("freezes the owner's chassis-scaled damage onto the instance", () => {
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, owner, 100, 0);
    expect(instances[0]!.damage).toBe(weaponDamageOf("rectangle", "fireball"));
  });

  it("gives a harder-hitting chassis a harder-hitting shot from the same weapon", () => {
    const glassCannon = { ...owner, carId: "oval" };
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, glassCannon, 100, 0);
    expect(instances[0]!.damage).toBe(60);
    expect(instances[0]!.damage).toBeGreaterThan(weaponDamageOf("rectangle", "fireball"));
  });

  it("falls back to the default chassis for an unrecognised carId rather than NaN-ing damage", () => {
    const unknown = { ...owner, carId: "not-a-car" };
    const { instances } = spawnInstances({ weaponId: "fireball", slot: 0 }, unknown, 100, 0);
    expect(instances[0]!.damage).toBe(weaponDamageOf(DEFAULT_CAR_ID, "fireball"));
  });
```

Add to that file's imports:

```ts
import { DEFAULT_CAR_ID } from "../../config/car-config.js";
import { weaponDamageOf } from "../damage.js";
```

In `packages/shared/src/sim/weapons/hits.test.ts`, give `shotFrom` a chassis and assert against the frozen value:

```ts
function shotFrom(x: number, y: number, angle = 0, team: 0 | 1 = 0, carId = "rectangle"): WeaponInstance {
  return spawnInstances(
    { weaponId: "fireball", slot: 0 },
    { sessionId: "aaa", team, carId, x, y, angle },
    100,
    0,
  ).instances[0]!;
}
```

```ts
  it("damages a car the shot has reached", () => {
    const shot = shotFrom(400, 300);
    const moved = stepInstance(shot, { dt: DT, tick: 101, obstacles: [], bounds: BOUNDS, ownerPose: null });
    const out = resolveInstanceHits(moved, shot, snapshot([{ sessionId: "bbb", x: 434, y: 300 }]), "ffa", 101);
    expect(out.damaged).toEqual([{ sessionId: "bbb", amount: weaponDamageOf("rectangle", "fireball") }]);
  });

  it("uses the damage frozen on the instance, not the weapon table's own number", () => {
    // The whole point of freezing at spawn: an oval's fireball hits harder than a rectangle's, and
    // hits.ts learns that from the instance rather than by looking the owner up.
    const shot = shotFrom(400, 300, 0, 0, "oval");
    const moved = stepInstance(shot, { dt: DT, tick: 101, obstacles: [], bounds: BOUNDS, ownerPose: null });
    const out = resolveInstanceHits(moved, shot, snapshot([{ sessionId: "bbb", x: 434, y: 300 }]), "ffa", 101);
    expect(out.damaged).toEqual([{ sessionId: "bbb", amount: 60 }]);
    expect(60).not.toBe(WEAPON_TABLE.fireball.damage);
  });
```

Add to that file's imports:

```ts
import { weaponDamageOf } from "../damage.js";
```

In `packages/shared/src/sim/combat.test.ts`, add a test to `describe("shots landing", ...)` proving the freeze survives its owner:

```ts
  it("keeps a shot's damage after its owner is wrecked mid-flight", () => {
    // S8: the owner is looked up once, at spawn. A live lookup at hit time would find nothing —
    // the pose snapshot holds living fighters only — and silently fall back to a default chassis.
    const target = player("b", { x: 800 });
    const shooter = player("a", { carId: "oval", alive: false });
    const shot = { ...aimedAt(target, "a"), damage: weaponDamageOf("oval", "fireball") };
    const result = run({ players: [shooter, target], instances: [shot] });
    expect(find(result, "b").hp).toBe(hpOf("rectangle") - weaponDamageOf("oval", "fireball"));
  });
```

And one proving the differentiation survives a whole real firing tick, rather than only the two units it is assembled from.

Add it as **its own file-level `describe`**, placed after `describe("shots landing", ...)`. It must NOT go inside `describe("firing", ...)`: that block deliberately shadows `player` with a one-argument version that always uses session id `"aaa"`, and this test needs two distinct ids.

```ts
describe("chassis attack scales weapon damage through a real tick", () => {
  /** One shot, fired for real, from `carId` into a stationary rectangle. Returns the hp it cost. */
  const damageDealtBy = (carId: "rectangle" | "oval" | "hexagon"): number => {
    let state = run({
      players: [
        player("a", {
          x: 400,
          y: OPEN_Y,
          angle: 0,
          carId,
          fireMask: 1,
          fireState: newFireState(carId, 1),
        }),
        player("b", { x: 400 + DRIVE_CONFIG.carWidth + 40, y: OPEN_Y }),
      ],
    });
    // The shot leaves the muzzle on tick 100 and covers the ~40 unit gap in about two ticks.
    // Bounded at 110, well inside fireball's 15-tick cooldown, so exactly one shot is measured.
    for (let tick = 101; tick <= 110; tick++) {
      state = run({
        world: world({ tick }),
        players: state.players,
        instances: state.instances,
        instanceSeq: state.instanceSeq,
      });
    }
    return hpOf("rectangle") - find(state, "b").hp;
  };

  it("lands a different number for each chassis firing the identical weapon", () => {
    // Spec test 5: through the real tick, not by calling damageFor. `attack` is invisible in the
    // weapon table, so this is the only place the roster's damage spread is actually observable.
    expect(damageDealtBy("rectangle")).toBe(40);
    expect(damageDealtBy("oval")).toBe(60);
    expect(damageDealtBy("hexagon")).toBe(50);
  });
});
```

Add `weaponDamageOf` to that file's imports:

```ts
import { weaponDamageOf } from "./damage.js";
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -w @motor-combat-moba/shared
```

Expected: FAIL — `Property 'damage' does not exist on type 'WeaponInstance'`.

- [ ] **Step 3: Add the frozen field**

In `packages/shared/src/sim/weapons/instances.ts`, add to the `WeaponInstance` interface, immediately after `ownerTeam`:

```ts
  /**
   * What this shot costs on a hit, resolved from the owner's chassis `attack` and frozen at spawn —
   * never looked up later, for exactly the reason `ownerTeam` is frozen above it. `hits.ts` tests
   * against a snapshot of living fighters only, so an owner wrecked while their own shot is still in
   * flight has vanished from any lookup by the time it lands, and a live one would quietly fall back
   * to the default chassis. Freezing also stops a mid-match car change re-powering a shot already in
   * the air.
   *
   * Already rounded (`damageFor`), so a piercing shot deals the identical number to every car it
   * passes through. Sim-only, like `ownerTeam` and `damageClock`: the client is told the resulting
   * hp, never the arithmetic.
   */
  damage: number;
```

Widen the `owner` parameter of `spawnInstances` and compute the value:

```ts
export function spawnInstances(
  order: ShotOrder,
  owner: { sessionId: string; team: 0 | 1; carId: string } & OwnerPose,
  tick: number,
  seq: number,
  aimAngle: number | null = null,
): { instances: WeaponInstance[]; seq: number } {
  const def = weaponDefOf(order.weaponId);
  const damage = weaponDamageOf(carIdOf(owner), order.weaponId);
```

and set it on the literal, right after `ownerTeam: owner.team,`:

```ts
      ownerTeam: owner.team,
      damage,
```

Add the imports:

```ts
import { carIdOf } from "../context.js";
import { weaponDamageOf } from "../damage.js";
```

- [ ] **Step 4: Read the frozen value in `hits.ts`**

In `packages/shared/src/sim/weapons/hits.ts`, change line 71:

```ts
    damaged.push({ sessionId: entry.sessionId, amount: instance.damage });
```

Update the `resolveInstanceHits` doc comment with one added sentence:

```
 * The amount comes from `instance.damage`, frozen at spawn — this module never reads player state,
 * and the owner's chassis is exactly the player state it would otherwise have to read.
```

- [ ] **Step 5: Run the tests and fix the hand-built instance literals**

```bash
npm test
```

`tsc` will flag every place a `WeaponInstance` is written as an object literal and now misses `damage` — including `aimedAt` in `combat.test.ts`. Give each one an explicit value; do not make the field optional. `aimedAt` becomes:

```ts
  function aimedAt(target: CombatPlayer, ownerSessionId: string, ownerTeam: 0 | 1 = 0): WeaponInstance {
    return {
      id: "p1",
      ownerSessionId,
      ownerTeam,
      damage: weaponDamageOf("rectangle", "fireball"),
      weaponId: "fireball",
      kind: "projectile",
      x: target.x - WEAPON_TABLE.fireball.speed * DT,
      y: target.y,
      angle: 0,
      extent: 0,
      spawnTick: 100,
      distance: 0,
      pierceLeft: 0,
      attached: false,
      damageClock: new Map(),
      alive: true,
    };
  }
```

Assertions in that block that read `WEAPON_TABLE.fireball.damage` must become `weaponDamageOf("rectangle", "fireball")` — the players there are rectangles, so the number changes from 50 to 40.

Expected after fixes: PASS, all three workspaces.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(combat): scale weapon damage by the firing chassis's attack" -m "WeaponInstance gains a `damage` field, resolved from the owner's attack rating once at spawn and frozen — the same treatment ownerTeam already gets, and for the same reason: hits.ts tests against a snapshot of living fighters only, so a live owner lookup at hit time would miss an owner wrecked mid-flight.

Fireball now lands for 40/60/50 depending on chassis.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Show per-weapon damage on the car-select panel

The same weapon now hits for different amounts and the player has no way to see it. Task 1 left a hole in the stats panel where "Ram damage" used to be; this fills it.

**Files:**
- Modify: `packages/client/src/ui/car-select-view.ts`
- Modify: `packages/client/src/ui/car-select-view.test.ts` — **this file already exists**; append to it and merge the imports. Do not overwrite it.

**Interfaces:**
- Consumes: `weaponDamageOf` from Task 3, `CAR_TABLE[id].weapons` from Task 2
- Produces: nothing later tasks depend on

- [ ] **Step 1: Write the failing test**

Append this `describe` to the existing `packages/client/src/ui/car-select-view.test.ts`, merging the imports with whatever the file already imports rather than duplicating them. If the file already has a `describe("fullStatsFor", ...)` block, add these cases to it instead of opening a second one.

```ts
// merge into the file's existing imports
import { CAR_TABLE, weaponDamageOf } from "@motor-combat-moba/shared";
import { fullStatsFor } from "./car-select-view.js";

describe("fullStatsFor", () => {
  it("shows each chassis's own damage for every weapon it carries", () => {
    const rows = fullStatsFor("oval");
    const damage = rows.find((r) => r.label === "Fireball damage");
    expect(damage).toBeDefined();
    expect(damage!.value).toBe(String(weaponDamageOf("oval", "fireball")));
  });

  it("derives the number rather than transcribing it, so a retune moves the screen too", () => {
    // The panel's standing rule: every number comes out of the shared config tables. A hard-coded
    // "60" here would let the screen quietly lie about the car after a balance pass.
    for (const id of Object.keys(CAR_TABLE) as (keyof typeof CAR_TABLE)[]) {
      const rows = fullStatsFor(id);
      for (const weaponId of CAR_TABLE[id].weapons) {
        const row = rows.find((r) => r.label.toLowerCase().endsWith("damage"));
        expect(row).toBeDefined();
        expect(row!.value).toBe(String(weaponDamageOf(id, weaponId)));
      }
    }
  });

  it("still reports the hull HP the sim actually gives the car", () => {
    expect(fullStatsFor("hexagon").find((r) => r.label === "Hull HP")!.value).toBe("700");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @motor-combat-moba/client
```

Expected: FAIL — no row is labelled `"Fireball damage"`.

- [ ] **Step 3: Add the damage rows**

In `packages/client/src/ui/car-select-view.ts`, restore the `def` lookup and append one row per equipped weapon:

```ts
export function fullStatsFor(id: CarId): StatRow[] {
  const def = CAR_TABLE[id];
  return [
    { label: "Top speed", value: `${trim(forwardMaxSpeedOf(id))} u/s` },
    { label: "Reverse speed", value: `${trim(reverseMaxSpeedOf(id))} u/s` },
    { label: "Turn rate", value: `${trim(DRIVE_CONFIG.turnRate)} rad/s` },
    { label: "Hull HP", value: String(hpOf(id)) },
    { label: "Hull size", value: `${DRIVE_CONFIG.carWidth} x ${DRIVE_CONFIG.carHeight}` },
    // One row per equipped weapon, derived through the same `weaponDamageOf` the sim fires with.
    // The chassis `attack` rating is invisible on its own — this is where it becomes a number the
    // player can compare between cards.
    ...def.weapons.map((weaponId) => ({
      label: `${weaponDefOf(weaponId).name} damage`,
      value: String(weaponDamageOf(id, weaponId)),
    })),
  ];
}
```

Add `weaponDamageOf` and `weaponDefOf` to the `@motor-combat-moba/shared` import at the top of the file.

- [ ] **Step 4: Rebuild shared before running the client suite**

`weaponDefOf` is already exported from `packages/shared/src/index.ts` (line 97) and Task 3 added `weaponDamageOf` beside `applyDamage`. The client consumes shared's built `dist`, so both are invisible to it until shared is rebuilt:

```bash
npm run build -w @motor-combat-moba/shared
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS, all three workspaces.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(client): show per-chassis weapon damage on car select" -m "Fills the hole the Ram damage row left. Derived through weaponDamageOf, so a balance retune moves the screen and the sim together.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation

The docs currently describe a ram-damage rule that no longer exists and a `strength` stat that no longer exists.

**Files:**
- Modify: `docs/combat-model.md`
- Modify: `docs/config-reference.md`
- Modify: `docs/superpowers/specs/2026-08-27-weapon-system-design.md`
- Modify: `docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md`
- Modify: `docs/superpowers/specs/2026-08-28-attack-stat-damage-formula-design.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Rewrite the combat model's damage section**

In `docs/combat-model.md`:

- Delete the entire `## Ramming` section and its `### Contact, not interpenetration` subsection.
- Add a `## Damage` section in its place:

```markdown
## Damage

Weapons are the only damage source. Collision costs nobody hp — cars shove each other and nothing
more.

One hit costs `damageFor(attack, weapon.damage)`:

    Math.round(weaponDamage * (1 + (attack - COMBAT_CONFIG.attackBaseline) * COMBAT_CONFIG.damagePerAttack))

`WeaponDef.damage` is what the weapon deals from a chassis at the baseline rating (50) — an *average*
car, not every car. `attack` moves it between 0.5x and 1.5x across the 0-100 rating range.

The number is resolved **once, at spawn**, and frozen onto the `WeaponInstance` as `instance.damage`.
`hits.ts` reads it there and never looks the owner up: it tests against a snapshot of living fighters
only, so an owner wrecked while their own shot is in flight would have vanished from any live lookup.
Same reasoning as `ownerTeam`.

Rounding happens inside `damageFor`, so `applyDamage` always subtracts an integer from a `uint16`
and a piercing shot deals the identical number to every car it passes through.

The roster is tuned so an average chassis (500 hull HP) kills another with the baseline weapon in
**5 seconds** at perfect accuracy, reckoned as `hullHP / DPS`.
```

- Fix line 31, which lists a chassis's identity: change `speed, strength, hp, guns` to `speed, attack, hp, guns`.
- Around line 345 there is a fixture note explaining a `50.5` spacing that must stay outside `ramContactPad`. That constant is gone; delete the sentence about the ram and keep only the part about the hitbox radius.

- [ ] **Step 2: Update the config reference**

In `docs/config-reference.md`, replace the `CAR_TABLE` table and its derived-values note:

```markdown
## CAR_TABLE

| id | name | speed | attack | hp | weapons |
|---|---|---|---|---|---|
| `rectangle` | Rectangle | 80 | 30 | 40 | `["fireball"]` |
| `oval` | Oval | 50 | 70 | 30 | `["fireball"]` |
| `hexagon` | Hexagon | 30 | 50 | 70 | `["fireball"]` |

Ratings are integers 0-100 with 50 as average, and every row **must sum to exactly 150** —
`config.test.ts` enforces the budget.

Derived: `hpOf` = hp × `COMBAT_CONFIG.hpPerRating` (400 / 300 / 700). `forwardMaxSpeedOf` =
`baseMaxSpeed` + speed × `speedPerRating` (540 / 405 / 315 u/s). `reverseMaxSpeedOf` = forward ×
`reverseSpeedRatio`. `weaponDamageOf(carId, weaponId)` = `damageFor(attack, weapon.damage)` — a
fireball is 40 / 60 / 50 depending on who fires it.
```

Also add the two new `COMBAT_CONFIG` knobs wherever that file lists combat config, and remove the four deleted ones if they are listed.

- [ ] **Step 3: Mark the superseded spec decisions**

In `docs/superpowers/specs/2026-08-27-weapon-system-design.md`, add a note under the `## Constraints` heading:

```markdown
> **Superseded 2026-08-28:** constraint 5 ("Ramming works, is well tested, and is not to be touched")
> and the non-goal of changing collision-damage rules no longer hold. Collision damage was removed
> and the chassis `strength` rating became `attack`, a modifier on weapon damage — see
> [`2026-08-28-attack-stat-damage-formula-design.md`](2026-08-28-attack-stat-damage-formula-design.md).
> `WeaponDef.damage` is now the damage from an *average* chassis, not the final damage.
```

In `docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md`, add the same style of note near the top, since its damage model line and its `damageFrom(attacker)` formula are both superseded.

- [ ] **Step 4: Flip the new spec's status**

In `docs/superpowers/specs/2026-08-28-attack-stat-damage-formula-design.md`, update the header:

```markdown
**Status:** Implemented.
**Plan:** [`../plans/2026-08-28-attack-stat-damage-formula.md`](../plans/2026-08-28-attack-stat-damage-formula.md)
```

- [ ] **Step 5: Verify no stale references remain**

```bash
grep -rn "strength\|ramCooldowns\|ramDamage\|isRamming\|collisionDamagePerStrength\|ramContactPad\|ramDotThreshold\|collisionDamageCooldownTicks" docs packages --include=*.ts --include=*.md | grep -v node_modules | grep -v "/dist/" | grep -v "docs/superpowers/plans/2026-08-24" | grep -v "docs/superpowers/plans/2026-08-27" | grep -v "2026-08-28-attack-stat"
```

Expected: no output. Historical plan documents under `docs/superpowers/plans/2026-08-24-*` and `2026-08-27-*` are records of what was built at the time and are **not** to be rewritten — that is why they are filtered out. The `brawl-mode-design.md` hit on "boost strength" is unrelated English and may be ignored if it appears.

- [ ] **Step 6: Run the full suite one last time**

```bash
npm test && npm run build
```

Expected: PASS, and a clean build.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "docs: attack stat and the removal of collision damage" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Manual verification

After Task 6, before considering the branch done:

```bash
npm run dev
```

Open `http://localhost:5173`, join, and check by eye:

1. Car select shows three bars labelled **Speed / Attack / Bulk**, and the bar lengths differ between cards (they read the rating verbatim now, so Rectangle's speed bar should be nearly full).
2. The stats panel shows **Hull HP** of 400 / 300 / 700 and a **Fireball damage** row of 40 / 60 / 50.
3. Driving into another car does **not** drain either car's health bar, and the cars still shove each other apart.
4. Shooting another car does drain it, and an Oval empties a health bar in noticeably fewer shots than a Rectangle.
