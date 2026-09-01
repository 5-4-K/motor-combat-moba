# Playtest Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-only `?dev=playground` sandbox — straight to the match screen against a bot, with a pause menu, live tuning sliders over the balance tables, free car/weapon assignment, and override export.

**Architecture:** A `DEV_TOOLS=1`-gated `PlaygroundRoom` beside the singleton arena runs the extracted real tick pipeline; a module-level tuning store in shared re-resolves the balance tables on both halves of the lockstep from one networked JSON blob; the human's input is *routed* to whichever of the two cars `controlledSessionId` names; the overlay is DOM, mounted by a dev-registry scene that release builds strip.

**Tech Stack:** TypeScript, Colyseus (server rooms + schema), Phaser 3 (client), vitest (node env — never import Phaser in a test).

**Spec:** `docs/superpowers/specs/2026-09-01-playtest-playground-design.md` (decisions PG1–PG23 — read it first; tasks cite it).

## Global Constraints

- Verify with **root** `npm test` (per-workspace runs silently skip suites) and root `npm run build` (never `--workspaces` — build order matters).
- After editing anything in `packages/shared/src`, rebuild shared (`npm run build -w @motor-combat-moba/shared`) before running server/playtest code; unit tests import `src` and don't need it.
- Existing suites — `golden.test.ts` above all — must stay green **without edits**. If a task breaks one, the task is wrong, not the test (the sole planned exception: additive updates to `registry.test.ts` and config tests where a task says so).
- No new playtest probe files or scenarios; do not touch `packages/server/playtest/` at all.
- Enum uint8 wire values are never renumbered; nothing in this plan changes an existing schema field.
- No magic numbers in logic — new knobs go in config objects.
- Commit after every task (the steps say when); commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Working branch: `claude/playtesting-playground-05a4cf` (current). Never touch `master`.

## File Structure (locked in)

```
packages/shared/src/config/tuning.ts             (new) setTuning + flat-path override store
packages/shared/src/config/tuning-walker.ts      (new) tunableFields / validateTuning / sanitizeStoredTuning
packages/shared/src/schema/PlaygroundState.ts    (new) ArenaState + paused/controlledSessionId/botEnabled/tuningJson
packages/shared/src/net/playground-messages.ts   (new) MSG_PLAYGROUND_*, PLAYGROUND_ROOM_NAME, setup payload + validator
packages/server/src/rooms/tick-pipeline.ts       (new) extracted sim pipeline + deathmatch respawn helpers
packages/server/src/rooms/PlaygroundRoom.ts      (new) the dev room
packages/server/src/rooms/playground-bot.ts      (new) pure bot input derivation
packages/client/src/dev/PlaygroundScene.ts       (new) dev-tool scene: join, launch arena, mount overlay
packages/client/src/dev/playground/overlay.ts    (new) DOM pause menu + settings (thin, untested)
packages/client/src/dev/playground/ui-model.ts   (new) pure overlay logic (tested)
packages/client/src/dev/playground/storage.ts    (new) localStorage codec + export payload (tested)
packages/client/src/scenes/controlled-car.ts     (new) controlledCarOf / isPlaygroundPaused seam (tested)
```

Modified: `config/types.ts`, `config/car-config.ts`, `config/weapon-ticks.ts`, `sim/ram.ts`,
`sim/weapons/fire.ts`, `shared/src/index.ts`, `server/src/index.ts`, `server/src/rooms/ArenaRoom.ts`,
`client/src/dev/registry.ts`, `client/src/net/connection.ts`, `client/src/scenes/ArenaScene.ts`,
`client/src/ui/car-select-view.ts`, root `package.json`, docs, `manual.html` (regenerated).

---

### Task 1: `isActive` on `CarDef` (spec PG18)

**Files:**
- Modify: `packages/shared/src/config/types.ts` (the `CarDef` interface)
- Modify: `packages/shared/src/config/car-config.ts`
- Modify: `packages/shared/src/index.ts` (export `isActiveCarId`, `activeCarIds`)
- Modify: `packages/client/src/ui/car-select-view.ts` (~line 116: the grid enumerates `Object.keys(CAR_TABLE)`)
- Modify: `packages/server/src/rooms/ArenaRoom.ts` (`MSG_SELECT_CAR` ~line 202, `MSG_PREVIEW_CAR` ~line 216)
- Test: `packages/shared/src/config/config.test.ts` (additions), `packages/client/src/ui/car-select-view.test.ts` (additions)
- Regenerate: `packages/client/public/manual.html` (the `CAR_TABLE` balance stamp moves)

**Interfaces:**
- Produces: `CarDef.isActive: boolean`; `activeCarIds(): CarId[]`; `isActiveCarId(value: unknown): value is CarId` (true only for an id that exists AND is active). Task 7's playground deliberately does NOT use these.

- [ ] **Step 1: Write the failing tests** — in `config.test.ts`:

```ts
describe("isActive", () => {
  it("ships every current car active, and at least one car is always active", () => {
    expect(activeCarIds()).toEqual(["mirage", "bullseye", "bastion"]);
  });
  it("keeps DEFAULT_CAR_ID active, so every fallback path resolves to a selectable car", () => {
    expect(CAR_TABLE[DEFAULT_CAR_ID].isActive).toBe(true);
  });
  it("isActiveCarId refuses unknown ids and inherited names", () => {
    expect(isActiveCarId("mirage")).toBe(true);
    expect(isActiveCarId("toString")).toBe(false);
    expect(isActiveCarId(undefined)).toBe(false);
  });
});
```

And in `car-select-view.test.ts` (it already builds the view model): assert the grid's `cars` array
lists only active ids — with all three active today, assert `view.cars.map(c => c.id)` equals
`activeCarIds()`.

- [ ] **Step 2: Run to verify failure** — `npm test -w @motor-combat-moba/shared` → FAIL (`activeCarIds` not defined).
- [ ] **Step 3: Implement**
  - `types.ts`: add to `CarDef`: `/** Selectable in real matches. The playground ignores this — that is how a car is tested before release (spec PG18). */ isActive: boolean;`
  - `car-config.ts`: add `isActive: true` to all three rows; add:

```ts
export function isActiveCarId(value: unknown): value is CarId {
  return isCarId(value) && CAR_TABLE[value].isActive;
}
export function activeCarIds(): CarId[] {
  return (Object.keys(CAR_TABLE) as CarId[]).filter((id) => CAR_TABLE[id].isActive);
}
```

  - `car-select-view.ts`: replace the grid's `(Object.keys(CAR_TABLE) as CarId[])` with `activeCarIds()`. Leave every other `CAR_TABLE` read alone.
  - `ArenaRoom.ts`: in `isSelectCarPayload`, replace `isCarId(...)` with `isActiveCarId(...)` (one change guards both `MSG_SELECT_CAR` and `MSG_PREVIEW_CAR`, which share the guard). Update the import.
- [ ] **Step 4: Run root `npm test`** — expect ONE failure: `manual-page.test.mjs` (stamp moved). Everything else green.
- [ ] **Step 5: Regenerate the manual** — `npm run build -w @motor-combat-moba/shared && npm run build:manual`, then root `npm test` → all green.
- [ ] **Step 6: Commit** — `feat(config): isActive flag on CarDef; real car select filters to active cars` (include the regenerated `manual.html`).

---

### Task 2: The tuning store (spec PG12)

**Files:**
- Create: `packages/shared/src/config/tuning.ts`
- Modify: `packages/shared/src/config/car-config.ts`, `packages/shared/src/config/weapon-ticks.ts`, `packages/shared/src/sim/ram.ts`
- Modify: `packages/shared/src/index.ts` (export `setTuning`, `activeTuning`, types)
- Test: `packages/shared/src/config/tuning.test.ts`

**Interfaces:**
- Produces:

```ts
export type TuningValue = number | boolean | string;
/** Flat dot-paths: "car.mirage.speed", "drive.baseTurnRate", "ram.massPerRating",
 *  "combat.hpPerRating", "weapon.predator.damage", "weapon.pepperbox.hitbox.radius". */
export type TuningOverrides = Readonly<Record<string, TuningValue>>;
export function setTuning(overrides: TuningOverrides | null): void; // throws on unknown path
export function activeTuning(): TuningOverrides | null;
```

- Also produces (module-internal to shared, imported by `tuning.ts`, not re-exported from index):
  `rebuildResolvedDrive()` in `car-config.ts`, `rebuildWeaponTicks()` in `weapon-ticks.ts`,
  and public `ramReference(): number` / `ramReferenceMass(): number` in `car-config.ts`.

**How it works (read before coding):** the five source tables (`CAR_TABLE`, `DRIVE_CONFIG`,
`RAM_CONFIG`, `COMBAT_CONFIG`, `WEAPON_TABLE`) are `as const` but NOT `Object.freeze`d — verified.
`tuning.ts` snapshots a deep clone of each at module load (`structuredClone`, deep-frozen). `setTuning`
first restores every table's own properties in place from the snapshot (deep copy-into, preserving
object identity so every existing import sees it), then walks each override path and writes the value,
then calls the rebuild hooks for the three derived artifacts. `setTuning(null)` restores and rebuilds
only. Consumers that read the source tables at call time (`hpOf`, `massOf`, every `RAM_CONFIG.x` /
`COMBAT_CONFIG.x` read in the sim, `weaponDefOf`, the client's render tables) therefore need **no
change at all**.

- [ ] **Step 1: Write the failing tests** — `tuning.test.ts`:

```ts
import { CAR_TABLE, CHASSIS_DRIVE, DRIVE_CONFIG, WEAPON_TABLE } from "./…";
import { driveOf, hpOf, ramReference } from "./car-config.js";
import { weaponTicksOf } from "./weapon-ticks.js";
import { activeTuning, setTuning } from "./tuning.js";

afterEach(() => setTuning(null));

it("null tuning resolves to the identical frozen defaults, by reference", () => {
  setTuning(null);
  expect(driveOf("mirage")).toBe(CHASSIS_DRIVE.mirage);
  expect(activeTuning()).toBeNull();
});
it("a car rating override moves the resolved drive and hp", () => {
  const before = driveOf("bastion").maxSpeed;
  setTuning({ "car.bastion.speed": 90 });
  expect(driveOf("bastion").maxSpeed).toBeGreaterThan(before);
  setTuning({ "car.bastion.hp": 10 });
  expect(hpOf("bastion")).toBe(10 * /* COMBAT_CONFIG.hpPerRating */ …);
});
it("a drive override reaches every chassis; reset restores the shipped number in the table itself", () => {
  const shipped = DRIVE_CONFIG.baseTurnRate;
  setTuning({ "drive.baseTurnRate": shipped * 2 });
  expect(DRIVE_CONFIG.baseTurnRate).toBe(shipped * 2);
  setTuning(null);
  expect(DRIVE_CONFIG.baseTurnRate).toBe(shipped);
});
it("a weapon ms override re-derives ticks; a nested path works", () => {
  const before = weaponTicksOf("pepperbox").cooldown;
  setTuning({ "weapon.pepperbox.cooldownMs": WEAPON_TABLE.pepperbox.cooldownMs * 4 });
  expect(weaponTicksOf("pepperbox").cooldown).toBeGreaterThan(before);
  setTuning({ "weapon.pepperbox.hitbox.radius": 99 });
  expect(WEAPON_TABLE.pepperbox.hitbox.radius).toBe(99);
});
it("a mass-scale override moves the ram reference", () => {
  const before = ramReference();
  setTuning({ "ram.massPerRating": 1 });
  expect(ramReference()).not.toBe(before);
});
it("throws on a path that does not exist, leaving tables untouched", () => {
  expect(() => setTuning({ "car.mirage.nope": 1 })).toThrow();
  expect(activeTuning()).toBeNull();
});
```

(Fill the `…` with the real import paths and `COMBAT_CONFIG.hpPerRating` — read the files.)

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `tuning.ts`:**

```ts
import { CAR_TABLE } from "./car-config.js";
// … DRIVE_CONFIG, RAM_CONFIG, COMBAT_CONFIG, WEAPON_TABLE imports
import { rebuildResolvedDrive } from "./car-config.js";
import { rebuildWeaponTicks } from "./weapon-ticks.js";

const ROOTS: Record<string, object> = {
  car: CAR_TABLE, drive: DRIVE_CONFIG, ram: RAM_CONFIG, combat: COMBAT_CONFIG, weapon: WEAPON_TABLE,
};
const DEFAULTS: Record<string, unknown> = Object.fromEntries(
  Object.entries(ROOTS).map(([k, v]) => [k, structuredClone(v)]),
);
let active: TuningOverrides | null = null;

function restoreInPlace(target: unknown, source: unknown): void { /* recursive: for each key of
  source, primitives assign, arrays splice-replace with clones, objects recurse — identity of every
  pre-existing object preserved */ }
function writePath(root: object, segments: string[], value: TuningValue): void { /* walk with
  Object.prototype.hasOwnProperty at every hop; numeric segments index arrays; throw
  `unknown tuning path` if any hop is missing or the leaf's typeof differs from the value's */ }

export function setTuning(overrides: TuningOverrides | null): void {
  // Validate every path against DEFAULTS FIRST, so a throw leaves the live tables untouched.
  if (overrides) for (const path of Object.keys(overrides)) assertPathExists(DEFAULTS, path);
  for (const [k, root] of Object.entries(ROOTS)) restoreInPlace(root, DEFAULTS[k]);
  if (overrides) for (const [path, v] of Object.entries(overrides)) {
    const [group, ...rest] = path.split(".");
    writePath(ROOTS[group]!, rest, v);
  }
  active = overrides ? Object.freeze({ ...overrides }) : null;
  rebuildResolvedDrive();
  rebuildWeaponTicks();
}
export function activeTuning(): TuningOverrides | null { return active; }
```

  - `car-config.ts`: keep `CHASSIS_DRIVE` (frozen default) exactly as is. Add
    `let ACTIVE_DRIVE: Readonly<Record<CarId, ChassisDrive>> = CHASSIS_DRIVE;` and
    `let activeRamReference = RAM_REFERENCE; let activeRamReferenceMass = RAM_REFERENCE_MASS;`
    Change `driveOf` to `return ACTIVE_DRIVE[id];`. Add:

```ts
/** Playground tuning only (spec PG12). With no tuning active this reassigns the frozen defaults by reference. */
export function rebuildResolvedDrive(): void {
  ACTIVE_DRIVE = Object.freeze(Object.fromEntries((Object.keys(CAR_TABLE) as CarId[]).map((id) => [id,
    Object.freeze({ maxSpeed: forwardMaxSpeedOf(id), reverseMaxSpeed: reverseMaxSpeedOf(id),
      accel: accelOf(id), reverseAccel: reverseAccelOf(id), turnRate: turnRateOf(id),
      turnRateAtStop: turnRateAtStopOf(id) })]))) as Record<CarId, ChassisDrive>;
  activeRamReferenceMass = 50 * RAM_CONFIG.massPerRating;
  activeRamReference = activeRamReferenceMass *
    Math.max(...(Object.keys(CAR_TABLE) as CarId[]).map((id) => forwardMaxSpeedOf(id)));
}
export function ramReference(): number { return activeRamReference; }
export function ramReferenceMass(): number { return activeRamReferenceMass; }
```

    (Note: with tuning null the recomputed values equal the frozen constants; to satisfy the
    by-reference test cheaply, have `rebuildResolvedDrive` short-circuit to
    `ACTIVE_DRIVE = CHASSIS_DRIVE; activeRamReference = RAM_REFERENCE; …` when `activeTuning()`
    is null — import `activeTuning` lazily via a registered callback to avoid an import cycle:
    `tuning.ts` calls `rebuildResolvedDrive(hasOverrides: boolean)` — pass it as a parameter, no
    cycle.)
  - `weapon-ticks.ts`: same pattern — `let ACTIVE_TICKS = WEAPON_TICKS;`, `weaponTicksOf` reads
    `ACTIVE_TICKS[id]`, `rebuildWeaponTicks(hasOverrides: boolean)` re-runs the existing `ticksFor`
    mapping or reassigns the default. Every sim consumer already goes through `weaponTicksOf` —
    verified — so nothing else changes.
  - `sim/ram.ts` (~lines 175, 183): replace the two reads of `RAM_REFERENCE` / `RAM_REFERENCE_MASS`
    with `ramReference()` / `ramReferenceMass()`. Keep the constant exports for existing tests.
- [ ] **Step 4: Run root `npm test`** — everything green, `golden.test.ts` untouched. That green run is spec PG22's inertness proof.
- [ ] **Step 5: Commit** — `feat(shared): module-level tuning store re-resolving balance tables (PG12)`.

---

### Task 3: The tuning walker (spec PG14)

**Files:**
- Create: `packages/shared/src/config/tuning-walker.ts`
- Modify: `packages/shared/src/index.ts` (export all three functions + `TunableField`)
- Test: `packages/shared/src/config/tuning-walker.test.ts`

**Interfaces:**
- Consumes: the five source tables; `setTuning`'s path grammar from Task 2.
- Produces:

```ts
export interface TunableField {
  path: string;                       // setTuning-compatible: "weapon.predator.damage"
  group: "car" | "drive" | "ram" | "combat" | "weapon";
  ownerId?: string;                   // carId or weaponId for car/weapon groups
  label: string;                      // path minus group+owner, e.g. "hitbox.radius"
  kind: "number" | "boolean" | "enum";
  shipped: TuningValue;
  min?: number; max?: number; step?: number;   // numbers only
  options?: readonly string[];                  // enums only
}
export function tunableFields(): TunableField[];
export function validateTuning(raw: unknown):
  | { ok: true; overrides: TuningOverrides }
  | { ok: false; error: string };              // reject-whole (spec PG13)
export function sanitizeStoredTuning(raw: unknown): TuningOverrides; // lenient: drop bad entries (spec PG20)
```

**Rules (from the spec):** car group walks ONLY the six ratings (`speed, accel, handling, attack,
hp, mass`); drive/ram/combat walk every own field (all numeric today); weapon rows walk recursively
into nested objects and arrays, skipping keys `id`, `name`, `kind`, `color` at any depth. Ranges:
car ratings `min 0, max 100, step 1`; other numbers `min 0, max = shipped > 0 ? shipped * 3 :
(path.endsWith("Ms") ? 2000 : 10), step = max / 100`. A string leaf becomes an enum whose `options`
are the distinct values at the same relative path across all `WEAPON_TABLE` rows sharing the row's
`kind`; if that yields fewer than 2 options, skip the field. Booleans are toggles.

- [ ] **Step 1: Write the failing tests:**

```ts
it("every emitted path round-trips through setTuning without throwing", () => {
  for (const f of tunableFields()) {
    expect(() => setTuning({ [f.path]: f.shipped })).not.toThrow();
  }
  setTuning(null);
});
it("walks the six ratings per car and nothing else from CAR_TABLE", () => {
  const mirage = tunableFields().filter((f) => f.group === "car" && f.ownerId === "mirage");
  expect(mirage.map((f) => f.label).sort()).toEqual(["accel", "attack", "handling", "hp", "mass", "speed"]);
});
it("skips identity fields at any depth and never emits color or kind", () => {
  expect(tunableFields().some((f) => /(^|\.)(id|name|kind|color)$/.test(f.label))).toBe(false);
});
it("validateTuning rejects the whole blob on one bad entry", () => {
  expect(validateTuning({ "drive.baseTurnRate": 1, "drive.nope": 2 }).ok).toBe(false);
  expect(validateTuning({ "drive.baseTurnRate": Number.NaN }).ok).toBe(false);
  expect(validateTuning({ "car.mirage.speed": 101 }).ok).toBe(false); // above max
});
it("sanitizeStoredTuning drops stale paths silently and keeps good ones", () => {
  const clean = sanitizeStoredTuning({ "drive.baseTurnRate": 2, "weapon.retired.damage": 5 });
  expect(Object.keys(clean)).toEqual(["drive.baseTurnRate"]);
});
```

- [ ] **Step 2: Verify failure.  Step 3: Implement** (`tunableFields` computes once and caches;
  `validateTuning` checks every entry against the field map — unknown path, wrong kind, non-finite,
  out of range, enum value not in options → `{ ok: false }` naming the first offender;
  `sanitizeStoredTuning` runs the same per-entry check but filters instead of rejecting).
- [ ] **Step 4: Green.  Step 5: Commit** — `feat(shared): tuning walker — tunable field enumeration and blob validation (PG14)`.

---

### Task 4: Playground schema, messages, and per-car loadouts (spec PG5, PG13, PG17)

**Files:**
- Create: `packages/shared/src/schema/PlaygroundState.ts`, `packages/shared/src/net/playground-messages.ts`
- Modify: `packages/shared/src/sim/weapons/fire.ts` (`newFireState`), `packages/shared/src/index.ts`
- Test: `packages/shared/src/net/playground-messages.test.ts`, additions to `packages/shared/src/sim/weapons/fire.test.ts`

**Interfaces:**
- Produces:

```ts
// PlaygroundState.ts — dev-only room state; release clients can never join this room (spec PG3/PG5)
export class PlaygroundState extends ArenaState {
  @type("boolean") paused = false;
  @type("string") controlledSessionId = "";
  @type("boolean") botEnabled = true;
  @type("string") tuningJson = "";
}
// playground-messages.ts
export const PLAYGROUND_ROOM_NAME = "playground";
export const BOT_SESSION_ID = "bot";
export const MSG_PLAYGROUND_PAUSE = "pg_pause";     // no payload: toggle
export const MSG_PLAYGROUND_SWITCH = "pg_switch";   // no payload: flip control
export const MSG_PLAYGROUND_TUNING = "pg_tuning";   // payload: TuningOverrides (flat object)
export const MSG_PLAYGROUND_SETUP = "pg_setup";     // payload: PlaygroundSetup
export interface PlaygroundCarSetup { carId: CarId; weapons: readonly [WeaponId, WeaponId, WeaponId]; }
export interface PlaygroundSetup { botEnabled: boolean; arenaId: string;
  me: PlaygroundCarSetup; opponent: PlaygroundCarSetup; }
export function isPlaygroundSetup(msg: unknown): msg is PlaygroundSetup;
export function defaultPlaygroundSetup(): PlaygroundSetup; // DEFAULT_CAR_ID, shipped loadouts, ACTIVE_ARENA_ID, botEnabled true (spec PG20)
// fire.ts — third parameter, optional:
export function newFireState(carId: CarId | "", level: number, weaponIds?: readonly WeaponId[]): FireState;
```

- [ ] **Step 1: Failing tests.** `isPlaygroundSetup`: accepts `defaultPlaygroundSetup()`; rejects a
  duplicate weapon within one car (`["lance","lance","pepperbox"]`), an unknown weapon id, an
  inactive-format carId (`"toString"`), an unknown arenaId (use `isArenaId` from `arena/registry.ts`),
  and non-object input. Note dupes ACROSS the two cars are legal — assert a setup with `lance` on
  both cars passes (spec PG17). `newFireState` additions: explicit `weaponIds` produces slots in that
  order; omitted falls back to `slotsOf(carId)` (assert deep-equality with a current call).
- [ ] **Step 2: Verify failure.  Step 3: Implement.** In `newFireState` change line ~80 to
  `const weapons = weaponIds ?? (isCarId(carId) ? slotsOf(carId) : []);` — run `weaponIds` through
  `slotsFrom(carId, weaponIds)` so the 3-slot cap still holds. Register the new exports in
  `packages/shared/src/index.ts`.
- [ ] **Step 4: Root `npm test` green.  Step 5: Commit** — `feat(shared): playground schema, messages, per-car loadouts (PG5, PG13, PG17)`.

---

### Task 5: Extract the tick pipeline from `ArenaRoom` (spec PG4) — refactor, zero behavior change

**Files:**
- Create: `packages/server/src/rooms/tick-pipeline.ts`
- Modify: `packages/server/src/rooms/ArenaRoom.ts`
- Test: none new — the proof is every existing suite green and the file diff being motion, not logic.

**Interfaces:**
- Produces:

```ts
export interface PipelineCtx {
  state: ArenaState;                       // or a subclass
  inputQueues: Map<string, InputMessage[]>;
  prevFireMasks: Map<string, number>;
  matchRoster: ReadonlySet<string>;
  combat: CombatMemory;
  ram: ContactMemory;
  hz: number;                              // getTickRateHz(TICK_RATE_HZ), passed in
}
/** statusTick → serverTick → contactTick → combat. Returns runCombat's players (or null when
 *  combat was skipped) and the fire masks, for the caller's win checks / phase sweep. */
export function runPipeline(ctx: PipelineCtx): { masks: ReadonlyMap<string, number>;
  combatPlayers: CombatResultPlayer[] | null };
export function respawnSweep(ctx: PipelineCtx): void;          // moved verbatim
export function respawnPlayer(ctx: PipelineCtx, player: PlayerState): void;  // was ArenaRoom.respawn
export function phaseEndSweep(ctx: PipelineCtx, masks: ReadonlyMap<string, number>): void; // moved
```

(`CombatResultPlayer` = the element type of `runCombat(...).players` — name it from what
`combat-bridge.ts` exports; add a type export there if none exists.)

- [ ] **Step 1: Move code.** Lift from `ArenaRoom.ts` into `tick-pipeline.ts`, body-verbatim:
  the sim block of `tick()` (lines ~348–383: `dt` computation from `ctx.hz`, `statusTick`,
  `serverTick`, the contact block), the combat body of `combatTick` **minus** its win checks
  (the `clearInstances` guard, `getArena`, `runCombat`, `applyCombatResult`, `instanceSeq`
  write, and the deathmatch-gated `phaseEndSweep` call stay in the pipeline; `checkDeathmatchEnd`
  and the `livingSides` block stay in `ArenaRoom`), plus `respawnSweep`, `respawn` →
  `respawnPlayer`, `phaseEndSweep`, `overlapsSolid` (module-private). Preserve every comment.
- [ ] **Step 2: Rewire `ArenaRoom`.** `tick()` keeps its phase-deadline handling and the
  deathmatch `respawnSweep` call (now `respawnSweep(this.ctx())`), then calls `runPipeline`,
  then runs its win checks on the returned `combatPlayers` (skip when null). Add a private
  `ctx(): PipelineCtx` assembling the maps/bags. `phaseCaps` note: the moved `respawnPlayer`
  and `phaseEndSweep` read/write `phaseCaps` — move that map INTO `PipelineCtx` as
  `phaseCaps: Map<string, number>` and delete the field's uses from `ArenaRoom` except
  `onLeave`'s cleanup, which reaches through the ctx it owns.
- [ ] **Step 3: Verify — root `npm run build` and root `npm test`, all green.** Then
  `git diff --stat`: `ArenaRoom.ts` shrinks, no other behavior file moved.
- [ ] **Step 4: Commit** — `refactor(server): extract tick pipeline + deathmatch respawn helpers for reuse (PG4)`.

---

### Task 6: The bot (spec PG10)

**Files:**
- Create: `packages/server/src/rooms/playground-bot.ts`
- Test: `packages/server/src/rooms/playground-bot.test.ts`

**Interfaces:**
- Produces:

```ts
export interface BotPose { x: number; y: number; angle: number; }
/** One tick of bot intent. `target` null (alone mode / target dead) → coast: everything zero. */
export function botInput(seq: number, self: BotPose, target: BotPose | null,
  slotRanges: readonly number[]): InputMessage;
export const BOT_CONFIG = Object.freeze({
  aimToleranceRad: 0.3, standoffUnits: 70, fireConeRad: 0.35,
});
```

Behavior (the LAN probe's chaser, `playtest/lan.ts` ~line 97, is the pattern): signed shortest
angle delta to target → `steer` (`1` above `+aimToleranceRad`, `-1` below, else `0`); `throttle`
`1` beyond `standoffUnits`, `-1` inside it; `fireSlots` sets bit `i` when `|delta| < fireConeRad`
and distance `< slotRanges[i]`. Returns `{ seq, steer, throttle, fireSlots }`.

- [ ] **Step 1: Failing tests** — target dead ahead in range fires all masked slots
  (`fireSlots === 0b111` with three in-range slots); target behind → `steer !== 0` and
  `fireSlots === 0`; inside standoff → `throttle === -1`; `target: null` → all zero; angle
  wrap-around (self at `angle ≈ π`, target just across the seam) steers the short way.
- [ ] **Step 2–4: fail → implement → green.  Step 5: Commit** — `feat(server): playground bot input derivation (PG10)`.

---

### Task 7: `PlaygroundRoom` (spec PG3, PG6–PG9, PG11, PG15–PG17)

**Files:**
- Create: `packages/server/src/rooms/PlaygroundRoom.ts`
- Modify: `packages/server/src/index.ts`, `packages/server/src/mode.ts`, root `package.json`
- Test: `packages/server/src/rooms/playground-room.test.ts` (pure helpers), addition to `packages/server/src/mode.test.ts`

**Interfaces:**
- Consumes: `runPipeline`/`respawnSweep`/`respawnPlayer`/`PipelineCtx` (Task 5), `botInput` (Task 6),
  `setTuning`/`validateTuning` (Tasks 2–3), `PlaygroundState`, messages, `newFireState(carId, level, weaponIds)` (Task 4).
- Produces: room `"playground"`; `isDevToolsEnabled(): boolean` in `mode.ts`.

Implementation outline — the room is thin; anything with a branch worth testing goes in an
exported pure helper in the same file:

```ts
export const PLAYGROUND_LEVEL = 3; // every unlocksAt in WEAPON_TABLE is ≤ 3; keeps all slots usable

export class PlaygroundRoom extends Room<PlaygroundState> {
  maxClients = 1;
  // inputQueues, prevFireMasks, combat, ram, phaseCaps, roster — same bags as ArenaRoom
  async onCreate() {
    // Spec PG15: refuse while the arena has anyone in it — tuning is process-wide.
    const listings = await matchMaker.query({ name: ROOM_NAME });
    if (listings.some((l) => l.clients > 0)) throw new ServerError(4004, "Close the arena first: playground tuning is process-wide");
    this.setState(new PlaygroundState());
    this.state.phase = RoomPhase.MATCH;                       // pinned forever (PG6)
    this.setPatchRate(1000 / DEFAULT_PATCH_RATE_HZ);
    this.setSimulationInterval(() => this.tick(), 1000 / getTickRateHz(TICK_RATE_HZ));
    this.onMessage(INPUT_MESSAGE, (client, msg) => {          // route to the CONTROLLED car (PG9)
      if (!isInputMessage(msg)) return;
      this.inputQueues.get(this.state.controlledSessionId)?.push(msg);
    });
    this.onMessage(MSG_PLAYGROUND_PAUSE, () => { this.state.paused = !this.state.paused; });
    this.onMessage(MSG_PLAYGROUND_SWITCH, () => {
      this.state.controlledSessionId = this.otherId(this.state.controlledSessionId);
    });
    this.onMessage(MSG_PLAYGROUND_TUNING, (client, msg) => {
      const result = validateTuning(msg);
      if (!result.ok) return;                                  // reject-whole (PG13)
      const overrides = Object.keys(result.overrides).length ? result.overrides : null;
      setTuning(overrides);
      this.state.tuningJson = overrides ? JSON.stringify(overrides) : "";
    });
    this.onMessage(MSG_PLAYGROUND_SETUP, (client, msg) => { if (isPlaygroundSetup(msg)) this.applySetup(msg); });
  }
  onJoin(client) { /* human PlayerState (name from options or "Dev") + bot PlayerState under
    BOT_SESSION_ID, distinct colorIds, both level = PLAYGROUND_LEVEL, both in roster, queues +
    masks for both; controlledSessionId = client.sessionId; applySetup(defaultPlaygroundSetup())
    then let the client's replayed setup (PG20) overwrite it */ }
  private applySetup(setup: PlaygroundSetup) { /* botEnabled → state; arena change → state.arenaId
    then respawn BOTH cars; car/loadout change per car → player.carId, hp = hpOf(carId),
    combat.fireStates.set(id, newFireState(carId, PLAYGROUND_LEVEL, setup.<side>.weapons)),
    then respawnPlayer for the changed car(s) only (PG16). "me" is the human session, "opponent"
    is BOT_SESSION_ID — NOT the controlled car: identity, not control. */ }
  private tick() {
    if (this.state.paused) return;                             // freezes state.tick itself (PG7)
    this.state.tick += 1;
    respawnSweep(this.ctx());                                  // endless (PG6, PG21)
    if (this.state.botEnabled) {
      const botCarId = this.otherId(this.state.controlledSessionId);
      /* build BotPose from the two PlayerStates; target = the controlled car if alive, else null;
         slotRanges from the bot car's fire-state weapon ids via weaponDefOf(id).range;
         this.inputQueues.get(botCarId)!.push(botInput(this.state.tick, …)) */
    }
    runPipeline(this.ctx());                                   // and NO win checks, ever
  }
  onLeave() { setTuning(null); this.disconnect(); }            // PG15
  onDispose() { setTuning(null); }
}
```

- [ ] **Step 1: Failing tests** for the exported pure pieces: `shouldRefusePlayground(listings)`
  (extract the refuse predicate: `[{clients: 0}]` → false, `[{clients: 2}]` → true, `[]` → false);
  `PLAYGROUND_LEVEL` covers the roster (`Object.values(WEAPON_TABLE).every(d => d.unlocksAt <= PLAYGROUND_LEVEL)`);
  `otherId` as a pure two-element flip. In `mode.test.ts`: `isDevToolsEnabled` is true only for
  the exact string `"1"`.
- [ ] **Step 2: fail.  Step 3: Implement** the room + `mode.ts`'s
  `export function isDevToolsEnabled(): boolean { return process.env.DEV_TOOLS === "1"; }` +
  `index.ts`: `if (isDevToolsEnabled()) gameServer.define(PLAYGROUND_ROOM_NAME, PlaygroundRoom);`
  after the arena define. Root `package.json` `dev:server`: add `DEV_TOOLS=1` inside the existing
  `cross-env` prefix.
- [ ] **Step 4: Root `npm test` green; root `npm run build` clean.  Step 5: Commit** —
  `feat(server): DEV_TOOLS-gated PlaygroundRoom — routed control, bot, endless respawn, tuning apply (PG3-PG17)`.

---

### Task 8: Client seam — `controlledCarOf`, pause gating, switch recovery (spec PG7, PG9)

**Files:**
- Create: `packages/client/src/scenes/controlled-car.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts`
- Test: `packages/client/src/scenes/controlled-car.test.ts`

**Interfaces:**
- Produces:

```ts
/** The session id of the car this client DRIVES. Base ArenaState has no controlledSessionId, so a
 *  real match always resolves to the client's own session (spec PG9). */
export function controlledCarOf(state: ArenaState, ownSessionId: string): string {
  const id = (state as { controlledSessionId?: string }).controlledSessionId;
  return id || ownSessionId;
}
/** True only inside a paused playground; false on every real-match state (spec PG7). */
export function isPlaygroundPaused(state: ArenaState): boolean {
  return (state as { paused?: boolean }).paused === true;
}
```

- [ ] **Step 1: Failing tests** — a bare `new ArenaState()` resolves to `ownSessionId` and is not
  paused; a `new PlaygroundState()` with `controlledSessionId = "bot"` resolves to `"bot"`;
  `paused = true` reports paused.
- [ ] **Step 2: fail → implement → green.**
- [ ] **Step 3: Rewire `ArenaScene`.** Add a private helper `private drivenSid(room: Room<ArenaState>): string { return controlledCarOf(room.state, room.sessionId); }` and replace `room.sessionId` at every **sim/HUD identity** site — currently lines 692 (`lastProcessedInputSeq` read), 1086, 1091, 1122, 1127 (`localModifiers`), 1132, 1184, 1194 (`isLocal` — prediction owns the driven car, interpolation the rest), 1248, 1316, 1468, 1747, 2200, 2211 (spectate fallback), 2341. Find them by grepping `room.sessionId` / `this.room.sessionId`; every one of them means "the car I drive" and takes the helper. Two additions in the input/predict path (~line 1110): skip sending and skip predicting while `isPlaygroundPaused(room.state)`; and track `lastDrivenSid` — when it changes between frames, clear the `PredictionBuffer` (re-instantiate it, matching how it is first constructed) and snap the predicted pose to the driven car's server state before predicting again.
- [ ] **Step 4: Root `npm test` green** (ArenaScene has no unit tests; the seam module does).
- [ ] **Step 5: Commit** — `feat(client): controlled-car seam — playground drives any car, pause stops prediction (PG7, PG9)`.

---

### Task 9: Client entry — `PlaygroundScene` + registry row (spec PG2)

**Files:**
- Create: `packages/client/src/dev/PlaygroundScene.ts`
- Modify: `packages/client/src/dev/registry.ts`, `packages/client/src/net/connection.ts`
- Test: `packages/client/src/dev/registry.test.ts` (addition), `packages/client/src/net/connection.test.ts` (addition if it tests `joinArena`'s shape)

**Interfaces:**
- Consumes: `DEV_TOOL_MARKER`, `PLAYGROUND_ROOM_NAME`, `PlaygroundState`.
- Produces: `joinPlayground(): Promise<Room<PlaygroundState>>` in `connection.ts` (same client
  construction as `joinArena`, room name `PLAYGROUND_ROOM_NAME`, `{ name: "Dev" }`); registry row
  `playground: async () => (await import("./PlaygroundScene.js")).PlaygroundScene`.

`PlaygroundScene` (key `dev.playground`, added by `BootScene`'s existing dev branch — no BootScene
change needed): `create()` renders the `DEV_TOOL_MARKER` heading (the release-strip sentinel, like
`AssetTuningScene`), then async: `joinPlayground()` → on failure draw the error text (covers a
server without `DEV_TOOLS=1`) → on success `this.registry.set("room", room)` (how `ArenaScene`
finds its room — line 682), send `MSG_PLAYGROUND_SETUP` with `defaultPlaygroundSetup()` (Task 11
replaces this with the stored replay), subscribe `room.state` `tuningJson` changes →
`setTuning(parsed || null)` (wrap `JSON.parse` in try/catch, ignore malformed), then
`this.scene.launch("arena")` and mount the overlay (Task 10's `mountPlaygroundOverlay(room, hooks)`
— until Task 10 lands, a stub `console.log`). Also: `events.on("shutdown")` → `setTuning(null)`.

- [ ] **Step 1: Failing test** — `registry.test.ts`: known ids now `["assets", "playground"]`
  (match the existing test's style; `isDevToolId("playground")` true).
- [ ] **Step 2: fail → implement → green** (`PlaygroundScene` itself is scene code, untestable in
  node env — keep every derivation inside Tasks 10–11 modules).
- [ ] **Step 3: Manual smoke** — `npm run dev`, open `http://localhost:5173/?dev=playground`: match
  screen, two cars, bot chases and fires. (Report result honestly; if broken, fix before commit.)
- [ ] **Step 4: Commit** — `feat(client): ?dev=playground joins the playground room straight to the arena (PG2)`.

---

### Task 10: Overlay — pause menu + settings selections (spec PG16, PG19)

**Files:**
- Create: `packages/client/src/dev/playground/overlay.ts`, `packages/client/src/dev/playground/ui-model.ts`
- Modify: `packages/client/src/dev/PlaygroundScene.ts` (replace the stub mount)
- Test: `packages/client/src/dev/playground/ui-model.test.ts`

**Interfaces:**
- Produces (`ui-model.ts`, all pure):

```ts
export type OverlayView = "hidden" | "menu" | "settings";
/** What the P key does given where focus is and which view is up. */
export function pauseKeyAction(view: OverlayView, targetTag: string):
  "toggle" | "back-to-menu" | "ignore";   // ignore when targetTag is INPUT/SELECT/TEXTAREA
export function carOptions(): { id: CarId; name: string }[];               // ALL cars — isActive ignored (PG18)
export function weaponOptions(): { id: WeaponId; name: string }[];         // all rows of WEAPON_TABLE
export function arenaOptions(): string[];                                  // Object.keys(ARENAS)
/** Slot dropdown legality: the 3 picks of one car must be distinct (PG17). */
export function isLoadoutLegal(weapons: readonly WeaponId[]): weapons is [WeaponId, WeaponId, WeaponId];
```

- Produces (`overlay.ts`, thin DOM, untested): `mountPlaygroundOverlay(room: Room<PlaygroundState>, onArenaChanged: () => void): () => void` (returns unmount). Behavior:
  - `window.addEventListener("keydown")` for `p`/`P` via `pauseKeyAction`; `"toggle"` sends `MSG_PLAYGROUND_PAUSE`; `"back-to-menu"` switches view locally.
  - Renders from state: menu visible iff `state.paused` (listen on state change); buttons **Resume** (send pause toggle), **Switch car** (send `MSG_PLAYGROUND_SWITCH`), **Settings** (view = settings).
  - Settings: Mode radio (alone / vs bot), Arena `<select>`, My/Opponent car `<select>`s, two rows of three weapon `<select>`s (an illegal duplicate pick disables the Back button and highlights the row). Any change rebuilds a `PlaygroundSetup` and sends `MSG_PLAYGROUND_SETUP`; an arena change also calls `onArenaChanged` (the scene restarts `ArenaScene` so the new geometry draws — `scene.stop("arena"); scene.launch("arena")` in `PlaygroundScene`).
  - Styling: one absolutely-positioned dark panel, plain CSS in a `<style>` node the module owns. No framework, no external asset.
- [ ] **Step 1: Failing tests** for `ui-model.ts`: `pauseKeyAction("hidden","BODY")` → toggle; `("settings","BODY")` → back-to-menu; `("menu","INPUT")` → ignore; `carOptions()` lists all of `CAR_TABLE` even if a row were inactive; `isLoadoutLegal` rejects dupes/short arrays, accepts 3 distinct.
- [ ] **Step 2: fail → implement both modules → green.**
- [ ] **Step 3: Manual smoke** — pause with P, switch car (bot takes over your old car), change opponent car + loadout (respawns), play alone (opponent rolls to a stop).
- [ ] **Step 4: Commit** — `feat(client): playground overlay — pause menu and setup settings (PG16, PG19)`.

---

### Task 11: Overlay — tuning sliders, persistence, export (spec PG13, PG14, PG19, PG20)

**Files:**
- Create: `packages/client/src/dev/playground/storage.ts`
- Modify: `packages/client/src/dev/playground/overlay.ts`, `ui-model.ts`, `PlaygroundScene.ts`
- Test: `packages/client/src/dev/playground/storage.test.ts`, additions to `ui-model.test.ts`

**Interfaces:**
- Produces (`storage.ts`):

```ts
export const PLAYGROUND_STORAGE_KEY = "motor-combat.playground.v1";
export interface StoredPlayground { setup: PlaygroundSetup; overrides: TuningOverrides; }
/** Never throws; unparseable/absent → defaults; overrides run through sanitizeStoredTuning (PG20). */
export function decodeStored(raw: string | null): StoredPlayground;
export function encodeStored(s: StoredPlayground): string;
export function loadStored(storage?: Pick<Storage, "getItem">): StoredPlayground;   // injectable for tests
export function saveStored(s: StoredPlayground, storage?: Pick<Storage, "setItem">): void;
```

- Produces (`ui-model.ts` addition): `sliderGroups(setup: PlaygroundSetup): { title: string; fields: TunableField[] }[]` — groups the walker output: per-car sections for the two SELECTED chassis, one Global section (drive+ram+combat), per-weapon sections for the six SELECTED weapons; everything else filtered out.
- Overlay additions: a "Stats" area rendered from `sliderGroups` — `input[type=range]` (min/max/step from the field) with a live number, checkbox for booleans, `<select>` for enums; each row shows `shipped` and a ↺ reset; "Reset all" clears the overrides map; the overrides map holds only values ≠ shipped. Sending: on leaving the settings view, `MSG_PLAYGROUND_TUNING` with the current map (hot-apply on resume, PG16). Every change also `saveStored`. A **Copy overrides** button: `navigator.clipboard.writeText(JSON.stringify(overrides, null, 2))`.
- `PlaygroundScene`: replace Task 9's `defaultPlaygroundSetup()` send with a `loadStored()` replay — send `MSG_PLAYGROUND_SETUP` with the stored setup, then `MSG_PLAYGROUND_TUNING` with the stored overrides (a server-side validation failure simply leaves defaults standing).
- [ ] **Step 1: Failing tests** — `decodeStored(null)` → `defaultPlaygroundSetup()` + `{}`; garbage JSON → defaults; a stored blob with one stale path (`"weapon.retired.damage"`) keeps the setup and drops the path; encode→decode round-trips; `sliderGroups` for the default setup contains a group per selected weapon and none for an unselected one.
- [ ] **Step 2: fail → implement → green.  Step 3: Manual smoke** — drag Bastion's speed up, resume, feel it; reload the tab, overrides persist; Copy overrides yields clean JSON; tweak a weapon's `hitbox.radius` and confirm the drawn shot grows (render agrees with hits, PG12).
- [ ] **Step 4: Commit** — `feat(client): playground tuning sliders, persistence, copy-overrides export (PG13, PG14, PG20)`.

---

### Task 12: Docs, final verification, loud flags (spec PG23)

**Files:**
- Modify: `docs/config-reference.md` (an `isActive` note under `CAR_TABLE`; a short "Tuning store (dev-only)" section naming `setTuning` and its two callers), `docs/project-structure.md` (new files), root `CLAUDE.md` (doc-table row pointing at the spec; a line in the Commands section for `?dev=playground`), spec `Status:` line → Implemented.
- Do NOT touch `docs/turn-tuning.md` (no shipped turn number moved) or `packages/server/playtest/`.

- [ ] **Step 1: Write the doc edits.**
- [ ] **Step 2: Full gate** — `npm run build` (root) then `npm test` (root): all green. `grep -c "MOTOR DEV TOOL" packages/client/dist/assets/*.js` after a production build should find nothing (run `npm run build:release` if cheap, or note that `build-release.mjs` asserts it).
- [ ] **Step 3: Commit** — `docs: playground, isActive, tuning store; spec marked implemented (PG23)`.
- [ ] **Step 4: In the final summary to the user, say LOUDLY:** the tick pipeline was extracted and config resolution now reads active tables — behavior-identical by design, but both sit in what the probes measure; recommend `npm run playtest` and comparing verdicts to the last report. Also note `manual.html` was regenerated (Task 1) and that six weapon-icon warnings from `npm run check:weapons` predate this work.

---

## Self-review notes (already applied)

- Spec coverage: PG1–PG23 all land — PG1/PG3 (Task 7 + registration), PG2 (Task 9), PG4 (5), PG5 (4), PG6/PG21 (7), PG7 (7+8), PG8–PG11 (6+7+8), PG12 (2), PG13 (3+4+7+11), PG14 (3), PG15 (7), PG16 (7+10), PG17 (4+10), PG18 (1), PG19 (10), PG20 (11), PG22 (each task's tests + inertness runs), PG23 (12).
- Type consistency: `TuningOverrides`/`TunableField`/`PlaygroundSetup`/`PipelineCtx`/`controlledCarOf` names are used identically across tasks; `newFireState`'s third parameter is `weaponIds?: readonly WeaponId[]` everywhere.
- The one deliberately unpinned detail: exact `restoreInPlace`/`writePath` bodies in Task 2 — the tests in that task define their contract precisely.
