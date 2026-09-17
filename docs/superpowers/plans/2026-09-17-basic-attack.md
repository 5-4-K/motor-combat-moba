# Basic Attack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every chassis a fourth weapon — a basic attack — fired from its own input, hidden from the HUD slot bar, and published as a "Basic attack" card in the players' guide.

**Architecture:** Nine `basic-attack-<carId>` rows in `WEAPON_TABLE`, all spreading one frozen base object. A new `CarDef.basicAttack` field holds each chassis's row; `CarDef.weapons` keeps meaning the three-weapon ability kit. A new `fireSlotsOf(carId)` — `[...slotsOf(carId), basicAttackOf(carId)]` — has exactly three readers (the sim's `newFireState`, the balance report's per-weapon seeding, and `ttk`). The basic attack is fire slot 3, rides the existing fire state machine with `recoveryMs: 0`, and the wire mask widens from 3 bits to 4.

**Tech Stack:** TypeScript, npm workspaces (`shared` / `server` / `client`), Vitest, Phaser 4, Colyseus, plain `.mjs` build scripts.

**Spec:** [`docs/superpowers/specs/2026-09-17-basic-attack-design.md`](../specs/2026-09-17-basic-attack-design.md) (BA1–BA38)

## Global Constraints

- **Build order matters.** After editing `packages/shared`, rebuild it before anything consumes it: `npm run build -w @motor-combat-moba/shared`. Never `npm run build --workspaces` — use root `npm run build`, which enforces shared → server → client.
- **`npm test` from the repo root** runs every suite including the `scripts/*.test.mjs` guards. A task is not done until it is green.
- **No magic numbers in logic** (hard invariant 2). Every number this plan adds lives in a config table.
- **`TICK_RATE_HZ` is 30** and lives once in shared. Durations are authored in ms and converted in `WEAPON_TICKS`.
- **Weapon ids are the exact strings** `basic-attack-bullseye`, `basic-attack-mirage`, `basic-attack-bastion`, `basic-attack-taurus`, `basic-attack-anvil`, `basic-attack-prowler`, `basic-attack-cleaver`, `basic-attack-skorpios`, `basic-attack-caprico` — one per `CarId`, spelled the same everywhere.
- **The basic attack's authored numbers** (BA4), used verbatim wherever this plan writes a row: `damage: 20`, `cooldownMs: 800`, `speed: 900`, `range: 960`, `startUpMs: 0`, `recoveryMs: 0`, `damageFrequencyMs: 0`, `pierce: 0`, `unlocksAt: 1`, `hitbox: { shape: "circle", radius: 12 }`, `color: "#101014"`.
- **Commit after every task**, message in the repo's `type(scope): summary` style, and end every commit message with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WSw6JLYzHP77RgRPk59Re3
```

- **Branch:** all work lands on `feature/basic-attack`.

---

## File Structure

**Shared (`packages/shared/src/`)**
- `config/weapon-types.ts` — `BasicAttackId` template-literal type joins the `WeaponId` union.
- `config/weapon-config.ts` — `BASIC_ATTACK_BASE` + nine rows.
- `config/types.ts` — `CarDef.basicAttack`.
- `config/car-config.ts` — nine `basicAttack` fields, `basicAttackOf`.
- `config/weapon-slots.ts` — `maxAbilitySlots` / `maxFireSlots` / `basicAttackSlotIndex`, `fireSlotsOf`.
- `sim/weapons/fire.ts` — `newFireState` appends the basic attack.
- `index.ts` — exports.

**Server (`packages/server/src/`)**
- `sim/tick.ts` — `SLOT_MASK` widens.
- `sim/combat-bridge.ts` — `loadoutFor` appends.
- `bot/brain/personality.ts` — a fourth per-slot weight.
- `bot/brain/duel.fixture.ts` — press-rate model reads `fireSlotsOf`; bars re-pinned.
- `config/bot-profiles.ts` — `BOT_BRAIN_VERSION`.

**Server harness (`packages/server/balance/`)**
- `stats.ts` — per-weapon accumulator seeding.

**Client (`packages/client/src/`)**
- `config/slot-keys.ts` — four bindings.
- `scenes/movement-hint.ts` — hint display order.
- `scenes/weapon-hud.ts`, `scenes/ArenaScene.ts` — the bar stays three boxes.
- `scenes/combat-visual.ts` — nine glow-style entries from one authored constant.
- `dev/playground/ui-model.ts` — loadout pickers exclude basic attacks; tuning group titles disambiguate.

**Scripts**
- `scripts/ttk.mjs` — rotation counts the basic attack.
- `scripts/build-cars-and-weapons.mjs`, `scripts/cars-and-weapons-copy.mjs` — the card.

**Docs** — `CLAUDE.md`, `docs/combat-model.md`, `docs/config-reference.md`, `docs/schema-reference.md`, rebuilt `packages/client/public/manual.html`.

---

### Task 1: The nine weapon rows

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts` (the `WeaponId` union, top of file)
- Modify: `packages/shared/src/config/weapon-config.ts` (add `BASIC_ATTACK_BASE` above `WEAPON_TABLE`; nine rows at the end of the table)
- Test: `packages/shared/src/config/weapon-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type BasicAttackId = \`basic-attack-${CarId}\``; `WEAPON_TABLE["basic-attack-mirage"]` and eight siblings, each a `ProjectileWeaponDef`.

- [ ] **Step 1: Write the failing tests**

In `weapon-config.test.ts`, replace the existing `it("carries ten weapons — nine on the roster plus the unassigned tremor — every one a different colour", …)` block and the existing `it("gives every weapon its own \`#RRGGBB\` colour, and never a player's", …)` block with these three. Keep every other test untouched.

```ts
  it("carries nineteen weapons — ten authored rows plus one basic attack per chassis", () => {
    const rows = Object.values(WEAPON_TABLE);
    expect(rows).toHaveLength(19);
    const basics = rows.filter((def) => def.id.startsWith("basic-attack-"));
    expect(basics).toHaveLength(Object.keys(CAR_TABLE).length);
  });

  it("gives every ABILITY weapon its own `#RRGGBB` colour, one shared colour to the basic attacks, and never a player's", () => {
    const rows: WeaponDef[] = Object.values(WEAPON_TABLE);
    const colors = rows.map((def) => def.color.toUpperCase());
    for (const color of colors) expect(color).toMatch(/^#[0-9A-F]{6}$/);

    // Uniqueness is about telling two WEAPONS apart on screen, since every instance draws as a
    // plain filled hitbox. The nine basic attacks are one weapon wearing nine ids — a player must
    // not be able to tell Mirage's bolt from Bastion's — so they share one colour on purpose, and
    // this asserts BOTH halves rather than loosening the rule (BA7).
    const abilities = rows.filter((def) => !def.id.startsWith("basic-attack-"));
    const basics = rows.filter((def) => def.id.startsWith("basic-attack-"));
    const abilityColors = abilities.map((def) => def.color.toUpperCase());
    expect(new Set(abilityColors).size).toBe(abilities.length);
    expect(new Set(basics.map((def) => def.color.toUpperCase())).size).toBe(1);
    expect(abilityColors).not.toContain(basics[0]!.color.toUpperCase());

    // And never a player colour. A shot is not owner-coloured, so one wearing a player's paint
    // would claim an identity it does not carry.
    const players = new Set(COLOR_TABLE.map((c) => c.hex.toUpperCase()));
    for (const color of colors) expect(players.has(color)).toBe(false);
  });

  it("keeps every basic attack identical, boring, and mechanic-free (BA3, BA34)", () => {
    const basics = Object.values(WEAPON_TABLE).filter((def) => def.id.startsWith("basic-attack-"));
    for (const def of basics) {
      expect(def.kind, def.id).toBe("projectile");
      expect(def.applies, def.id).toBeUndefined();
      expect(def.impulse, def.id).toBeUndefined();
      expect(def.stock, def.id).toBeUndefined();
      expect(def.muzzles, def.id).toBeUndefined();
      if (def.kind === "projectile") {
        expect(def.explosion, def.id).toBeUndefined();
        expect(def.homing, def.id).toBeUndefined();
        expect(def.pierce, def.id).toBe(0);
      }
      // Every row carries the same numbers as every other. A later per-car balance pass is
      // expected to break this test deliberately, one field at a time (spec section 10).
      expect(
        { damage: def.damage, cooldownMs: def.cooldownMs, speed: def.speed, range: def.range },
        def.id,
      ).toEqual({ damage: 20, cooldownMs: 800, speed: 900, range: 960 });
    }
  });
```

Add `CAR_TABLE` to the file's imports from `./car-config.js` if it is not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/shared/src/config/weapon-config.test.ts`
Expected: FAIL — `expect(rows).toHaveLength(19)` receives 10, and the basic-attack filters are empty.

- [ ] **Step 3: Widen the `WeaponId` union**

In `packages/shared/src/config/weapon-types.ts`, add the import and replace the union:

```ts
import type { CarId } from "./types.js";
import type { StatusId } from "./status-types.js";

/** Every ABILITY weapon in the game. Add an id here and a row in `WEAPON_TABLE`. */
export type AbilityWeaponId =
  | "magmablast"
  | "pepperbox"
  | "lance"
  | "predator"
  | "thunderclap"
  | "afterburner"
  | "thumper"
  | "roadblock"
  | "wildcharge"
  | "tremor";

/**
 * Every chassis's basic attack (BA1) — the fourth weapon every car carries, fired from its own
 * input and never drawn in the HUD slot bar.
 *
 * Derived from `CarId` rather than listed, so `Record<WeaponId, WeaponDef>` refuses to compile the
 * day a tenth chassis is authored without one. Nine ids rather than one shared row because they are
 * expected to diverge per chassis later; until then every row spreads one base (`BASIC_ATTACK_BASE`)
 * and `weapon-config.test.ts` holds them identical.
 *
 * The `import type { CarId }` above closes a TYPE-ONLY cycle with `types.ts` (which imports
 * `WeaponId` from here). Both are erased at compile time, so no runtime import is emitted and there
 * is no module cycle to resolve.
 */
export type BasicAttackId = `basic-attack-${CarId}`;

export type WeaponId = AbilityWeaponId | BasicAttackId;
```

- [ ] **Step 4: Add the shared base to `weapon-config.ts`**

Immediately above `export const WEAPON_TABLE = {`:

```ts
/**
 * Everything every basic attack has in common (BA3, BA4).
 *
 * Nine rows spread this and add only their own `id`, so "all nine are identical" is structural
 * rather than nine copies somebody has to keep in sync — and a later per-chassis divergence is one
 * field appended after the spread, which is the whole reason nine ids exist instead of one.
 *
 * A round near-black bolt: magmablast's 12-unit radius so it reads at a familiar size, predator's
 * 900 u/s so it arrives fast, and 960 units of reach — authored as three quarters of `arena-01`'s
 * frame width, and knowingly long for a weapon with no ammunition (BA36).
 *
 * `recoveryMs: 0` is load-bearing (BA20): the basic attack shares the fire state machine with the
 * three ability slots, and a non-zero recovery here would lock an ability out every time a player
 * pressed the weapon they press most.
 */
const BASIC_ATTACK_BASE = {
  kind: "projectile",
  name: "Basic Attack",
  // Shared by all nine on purpose — see BA7 and the colour test. Dark, but never the flat fill:
  // `WEAPON_GLOW_STYLES` gives it a lit core so it reads on dark asphalt.
  color: "#101014",
  unlocksAt: 1,
  damage: 20,
  damageFrequencyMs: 0,
  speed: 900,
  range: 960,
  startUpMs: 0,
  cooldownMs: 800,
  recoveryMs: 0,
  hitbox: { shape: "circle", radius: 12 },
  pierce: 0,
  volley: { volleys: 1, volleyIntervalMs: 0 },
  pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 },
} as const;
```

- [ ] **Step 5: Add the nine rows**

At the end of `WEAPON_TABLE`, after the last existing row and before the closing `} as const satisfies Record<WeaponId, WeaponDef>;`:

```ts
  // --- Basic attacks: one per chassis, all nine identical today (BA1-BA5) -----------------------
  //
  // Written out rather than spread in from a generated object: this table is
  // `as const satisfies Record<WeaponId, WeaponDef>` and several call sites depend on a bare index
  // yielding one specific union member, which a computed spread would collapse to the union.
  "basic-attack-bullseye": { ...BASIC_ATTACK_BASE, id: "basic-attack-bullseye" },
  "basic-attack-mirage": { ...BASIC_ATTACK_BASE, id: "basic-attack-mirage" },
  "basic-attack-bastion": { ...BASIC_ATTACK_BASE, id: "basic-attack-bastion" },
  "basic-attack-taurus": { ...BASIC_ATTACK_BASE, id: "basic-attack-taurus" },
  "basic-attack-anvil": { ...BASIC_ATTACK_BASE, id: "basic-attack-anvil" },
  "basic-attack-prowler": { ...BASIC_ATTACK_BASE, id: "basic-attack-prowler" },
  "basic-attack-cleaver": { ...BASIC_ATTACK_BASE, id: "basic-attack-cleaver" },
  "basic-attack-skorpios": { ...BASIC_ATTACK_BASE, id: "basic-attack-skorpios" },
  "basic-attack-caprico": { ...BASIC_ATTACK_BASE, id: "basic-attack-caprico" },
```

- [ ] **Step 6: Run the shared suite**

Run: `npx vitest run packages/shared/src/config`
Expected: PASS. If `weapon-ticks.test.ts` or `tuning-walker.test.ts` fails on a count, read the failure before changing it — `WEAPON_TICKS` derives per row and should need no edit.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/config/weapon-types.ts packages/shared/src/config/weapon-config.ts packages/shared/src/config/weapon-config.test.ts
git commit -m "feat(weapons): author nine basic-attack rows from one shared base (BA1-BA7)"
```

---

### Task 2: `CarDef.basicAttack`

**Files:**
- Modify: `packages/shared/src/config/types.ts:67` (after the `weapons` field)
- Modify: `packages/shared/src/config/car-config.ts` (nine rows; new `basicAttackOf` beside `hpOf`)
- Test: `packages/shared/src/config/weapon-slots.test.ts`

**Interfaces:**
- Consumes: `BasicAttackId` (Task 1).
- Produces: `CarDef.basicAttack: WeaponId`; `basicAttackOf(id: CarId): WeaponId`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("loadouts", …)` block in `weapon-slots.test.ts`:

```ts
  it("gives every chassis a basic attack named after it, shipped or not (BA2, BA9)", () => {
    for (const car of Object.values(CAR_TABLE)) {
      expect(basicAttackOf(car.id), car.id).toBe(`basic-attack-${car.id}`);
      expect(WEAPON_TABLE, car.id).toHaveProperty(basicAttackOf(car.id));
    }
  });

  it("keeps the basic attack out of the chassis's own kit (BA10)", () => {
    // `weapons` means the three ABILITY slots and nothing else. A basic attack leaking into it
    // would double-arm the car and put a fourth box in the HUD.
    for (const car of Object.values(CAR_TABLE)) {
      expect(car.weapons, car.id).not.toContain(basicAttackOf(car.id));
      for (const weaponId of car.weapons) expect(weaponId.startsWith("basic-attack-"), car.id).toBe(false);
    }
  });
```

Add `basicAttackOf` to the import from `./car-config.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/config/weapon-slots.test.ts`
Expected: FAIL — `basicAttackOf` is not exported.

- [ ] **Step 3: Add the field to `CarDef`**

In `types.ts`, directly after the `weapons` field:

```ts
  /** Ordered loadout: index 0 is slot 1. Order IS the slot mapping. */
  weapons: readonly WeaponId[];
  /**
   * This chassis's basic attack (BA9) — the fourth weapon it always carries, fired from its own
   * input and never drawn in the HUD slot bar.
   *
   * Deliberately NOT a fourth entry in `weapons`. That field means "the three-weapon kit this
   * chassis was designed around", and roughly fifteen readers depend on it meaning exactly that:
   * the HUD, the guide, the playground's loadout editor, the balance harness's armed filter, ttk's
   * attacker axis, the bot's reach model. `fireSlotsOf` is where the two are joined, and its
   * readers are named in `weapon-slots.ts`.
   *
   * Required on every row, including the unreleased prototypes: a chassis that cannot shoot cannot
   * be judged in the playground, and `isActive: true` stays a one-field change.
   */
  basicAttack: WeaponId;
```

- [ ] **Step 4: Fill it in on all nine rows**

In `car-config.ts`, add `basicAttack: "basic-attack-<id>"` to each row immediately after its `weapons` entry. The three shipped rows become:

```ts
  mirage: { id: "mirage", name: "Mirage", speed: 85, accel: 85, handling: 85, attack: 63, hp: 70, ramAttack: 55, ramDefence: 50, coastHalfLifeSeconds: 1.2, brakeDecel: 500, weapons: ["magmablast", "thunderclap", "afterburner"], basicAttack: "basic-attack-mirage", isActive: true },
  bullseye: { id: "bullseye", name: "Bullseye", speed: 65, accel: 45, handling: 65, attack: 55, hp: 65, ramAttack: 45, ramDefence: 30, coastHalfLifeSeconds: 1.0, brakeDecel: 520, weapons: ["predator", "pepperbox", "lance"], basicAttack: "basic-attack-bullseye", isActive: true },
  bastion: { id: "bastion", name: "Bastion", speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90, coastHalfLifeSeconds: 1.5, brakeDecel: 430, weapons: ["thumper", "roadblock", "wildcharge"], basicAttack: "basic-attack-bastion", isActive: true },
```

and each prototype takes its own, e.g. `taurus` gets `basicAttack: "basic-attack-taurus"`. Leave `weapons: []` on all six prototypes exactly as it is.

- [ ] **Step 5: Add the accessor**

In `car-config.ts`, directly after `hpOf`:

```ts
/**
 * This chassis's basic attack (BA9). Beside `slotsOf`, never inside it: `slotsOf` answers "what kit
 * was this chassis designed around" and this answers "what else can it fire".
 */
export function basicAttackOf(id: CarId): WeaponId {
  return CAR_TABLE[id].basicAttack;
}
```

Add `WeaponId` to the file's type imports (`import type { CarDef, CarId } from "./types.js";` gains `import type { WeaponId } from "./weapon-types.js";`).

- [ ] **Step 6: Export it**

In `packages/shared/src/index.ts`, add `basicAttackOf` to the existing export list from `./config/car-config.js` (beside `hpOf`, `activeCarIds`).

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run packages/shared/src/config`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/config/types.ts packages/shared/src/config/car-config.ts packages/shared/src/config/weapon-slots.test.ts packages/shared/src/index.ts
git commit -m "feat(roster): give every chassis a basicAttack field (BA2, BA9)"
```

---

### Task 3: Slot constants and `fireSlotsOf`

This task is a pure rename plus two additions. **No behaviour changes here** — every existing reader keeps reading the ability count under its new name, so all three suites stay green and the diff is reviewable on its own.

**Files:**
- Modify: `packages/shared/src/config/weapon-slots.ts`
- Modify: every reader of `maxWeaponSlots` — `packages/shared/src/sim/weapons/fire.ts:246`, `packages/shared/src/schema/PlayerState.ts:84` (a comment), `packages/server/src/sim/tick.ts:27`, `packages/server/src/bot/brain/personality.ts:127`, `packages/client/src/config/slot-keys.ts:47`, `packages/client/src/scenes/weapon-hud.ts:272`, `packages/client/src/scenes/ArenaScene.ts:2707`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/config/weapon-slots.test.ts`

**Interfaces:**
- Consumes: `basicAttackOf` (Task 2), `slotsOf` (existing).
- Produces: `WEAPON_SLOT_CONFIG.maxAbilitySlots` (3), `WEAPON_SLOT_CONFIG.maxFireSlots` (4), `WEAPON_SLOT_CONFIG.basicAttackSlotIndex` (3), `fireSlotsOf(carId: CarId): readonly WeaponId[]`.

- [ ] **Step 1: Write the failing tests**

Append to `weapon-slots.test.ts`:

```ts
  it("derives the fire-slot constants from the ability count, so the two cannot drift (BA11, BA13)", () => {
    expect(WEAPON_SLOT_CONFIG.maxAbilitySlots).toBe(3);
    expect(WEAPON_SLOT_CONFIG.maxFireSlots).toBe(WEAPON_SLOT_CONFIG.maxAbilitySlots + 1);
    expect(WEAPON_SLOT_CONFIG.basicAttackSlotIndex).toBe(WEAPON_SLOT_CONFIG.maxAbilitySlots);
  });

  it("puts the basic attack last in the fire order, behind an unmoved kit (BA12, BA13)", () => {
    expect(fireSlotsOf("bastion")).toEqual([
      "thumper",
      "roadblock",
      "wildcharge",
      "basic-attack-bastion",
    ]);
    // A prototype carries no abilities at all, so its basic attack is its only fire slot — and it
    // still lands at index 0, not index 3: the fire order is the kit followed by the basic attack,
    // not a fixed four-element array with holes.
    expect(fireSlotsOf("taurus")).toEqual(["basic-attack-taurus"]);
  });
```

Add `fireSlotsOf` to the import from `./weapon-slots.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/config/weapon-slots.test.ts`
Expected: FAIL — `fireSlotsOf` is not exported and `maxAbilitySlots` is undefined.

- [ ] **Step 3: Rewrite `weapon-slots.ts`**

Replace the `WEAPON_SLOT_CONFIG` declaration and add `fireSlotsOf` at the end of the file:

```ts
import { CAR_TABLE, basicAttackOf } from "./car-config.js";
import type { CarId } from "./types.js";
import type { WeaponId } from "./weapon-types.js";

/**
 * The slot counts, and the difference between them.
 *
 * `maxAbilitySlots` is how many weapons a chassis's KIT may present: the server rejects an ability
 * fire at or beyond this index, and the HUD draws at most this many boxes. It was called
 * `maxWeaponSlots` until 2026-09-17, and the rename is the point — every car carries four weapons
 * now, and a constant called "max weapon slots" reading 3 would be a quiet lie.
 *
 * `maxFireSlots` is how many weapons a car can actually fire: the kit plus its basic attack (BA11).
 * It is what the wire mask is masked to and what the client's key table runs to. Derived, never
 * typed, so the two can never disagree.
 */
export const WEAPON_SLOT_CONFIG = {
  maxAbilitySlots: 3,
  maxFireSlots: 4,
  /** The basic attack is always last, so the three ability indices never move (BA13). */
  basicAttackSlotIndex: 3,
} as const;
```

Then, in `slotsFrom`, change `const max = WEAPON_SLOT_CONFIG.maxWeaponSlots;` to `const max = WEAPON_SLOT_CONFIG.maxAbilitySlots;` and update the warning string's `maxWeaponSlots` mention to `maxAbilitySlots`. Append:

```ts
/**
 * Everything this chassis can fire, in fire-slot order: its kit, then its basic attack (BA12).
 *
 * **Three readers, named so a fourth is a deliberate act rather than a habit:**
 *
 * 1. `newFireState` (`sim/weapons/fire.ts`) — the sim's fire state, the only one on the tick path.
 * 2. `packages/server/balance/stats.ts` — the per-weapon accumulator seeding. A weapon the bots
 *    press but nobody seeded is silently absent from the report.
 * 3. `scripts/ttk.mjs` — the rotation and the one-press input table.
 *
 * Everything else wants `slotsOf`. The rule: **`fireSlotsOf` answers "what can this car fire",
 * `slotsOf` answers "what kit was this chassis designed around".** The HUD, the guide, the
 * playground's loadout editor, the balance seat filter, ttk's attacker axis, the bot's reach model
 * and the playtest probes all ask the second question.
 */
export function fireSlotsOf(carId: CarId): readonly WeaponId[] {
  return [...slotsOf(carId), basicAttackOf(carId)];
}
```

- [ ] **Step 4: Rename at every call site**

Run this to find them, then edit each by hand — there are seven, and two are inside comments:

```bash
grep -rn "maxWeaponSlots" --include=*.ts packages scripts
```

Every hit becomes `maxAbilitySlots`. **Do not** point any of them at `maxFireSlots` in this task — the widening is Tasks 5, 6 and 7, one behaviour at a time.

- [ ] **Step 5: Export `fireSlotsOf`**

In `packages/shared/src/index.ts:198`, extend the existing line:

```ts
export { WEAPON_SLOT_CONFIG, slotsFrom, slotsOf, fireSlotsOf } from "./config/weapon-slots.js";
```

- [ ] **Step 6: Rebuild shared and run everything**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS, all suites. A `maxWeaponSlots` typo anywhere fails the TypeScript build first.

- [ ] **Step 7: Verify the old name is gone**

Run: `grep -rn "maxWeaponSlots" --include=*.ts --include=*.mjs --include=*.md packages scripts docs`
Expected: no hits outside `docs/superpowers/` (spec and plan prose may mention the old name historically).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(weapons): split slot counts into ability and fire, add fireSlotsOf (BA11-BA13)"
```

---

### Task 4: The sim fires it

**Files:**
- Modify: `packages/shared/src/sim/weapons/fire.ts` (`newFireState` around line 106, `beginFire`'s `usable` at line 246)
- Test: `packages/shared/src/sim/weapons/fire.test.ts`

**Interfaces:**
- Consumes: `fireSlotsOf` (Task 3).
- Produces: a `FireState` whose `slots` array is the kit followed by the basic attack; `beginFire` accepting bit 3.

- [ ] **Step 1: Write the failing tests**

Append a new `describe` to `fire.test.ts` (match the file's existing import style and helpers):

```ts
describe("the basic attack slot", () => {
  it("sits last in the fire state, behind an unmoved kit (BA13)", () => {
    const state = newFireState("bastion", 1);
    expect(state.slots.map((s) => s.weaponId)).toEqual([
      "thumper",
      "roadblock",
      "wildcharge",
      "basic-attack-bastion",
    ]);
  });

  it("fires on bit 3", () => {
    const fired = beginFire("p1", newFireState("bastion", 1), 1 << 3, 0);
    expect(fired.pending?.weaponId).toBe("basic-attack-bastion");
    expect(fired.pending?.slot).toBe(3);
  });

  it("loses a same-tick tie to an ability, because the lowest usable bit wins (BA21)", () => {
    const fired = beginFire("p1", newFireState("bastion", 1), (1 << 0) | (1 << 3), 0);
    expect(fired.pending?.weaponId).toBe("thumper");
  });

  it("rides an explicit playground loadout too, and is not overridable by it (BA14)", () => {
    const state = newFireState("mirage", 1, ["predator", "lance", "thumper"]);
    expect(state.slots.map((s) => s.weaponId)).toEqual([
      "predator",
      "lance",
      "thumper",
      "basic-attack-mirage",
    ]);
  });

  it("leaves no switch lock behind, so pressing it never locks an ability out (BA20)", () => {
    const pressed = beginFire("p1", newFireState("bastion", 1), 1 << 3, 0);
    const { state } = releaseShots(pressed, 0);
    expect(state.switchLockUntilTick).toBe(0);
  });

  it("is blocked by an ability's own recovery, because the lock is not per slot (BA22)", () => {
    // `afterburner` authors `recoveryMs: 200` == 6 ticks at 30 Hz. This is the shared machinery
    // doing its job, not a bug: a future reader tempted to carve the basic attack out of the switch
    // lock should change the spec first, because that carve-out is a second press pipeline (BA22).
    const pressed = beginFire("p1", newFireState("mirage", 1), 1 << 2, 0);
    const { state } = releaseShots(pressed, 0);
    expect(state.switchLockUntilTick).toBeGreaterThan(0);
    expect(beginFire("p1", state, 1 << 3, 1).pending).toBeNull();
    // ...and it is free again the moment that recovery lapses.
    expect(beginFire("p1", state, 1 << 3, state.switchLockUntilTick).pending?.weaponId).toBe(
      "basic-attack-mirage",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/sim/weapons/fire.test.ts`
Expected: FAIL — the state carries three slots, and `beginFire` ignores bit 3.

- [ ] **Step 3: Append the basic attack in `newFireState`**

Replace the body's first line:

```ts
export function newFireState(carId: CarId | "", level: number, weaponIds?: readonly WeaponId[]): FireState {
  // The KIT, then the basic attack (BA12/BA14). An explicit playground loadout overrides the three
  // ability slots and nothing else: the basic attack is a property of the chassis, not of the
  // loadout, so it is appended either way and the settings panel never offers it.
  const kit = weaponIds ? slotsFrom(carId, weaponIds) : isCarId(carId) ? slotsOf(carId) : [];
  const weapons = isCarId(carId) ? [...kit, basicAttackOf(carId)] : kit;
```

Import `basicAttackOf` from `../../config/car-config.js`.

- [ ] **Step 4: Let `beginFire` reach slot 3**

At line 246, change the cap:

```ts
  const usable = Math.min(state.slots.length, WEAPON_SLOT_CONFIG.maxFireSlots);
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run packages/shared/src/sim`
Expected: PASS. `golden.test.ts` must be untouched — it pins the drive integration and nothing here reaches it. If it fails, stop and investigate rather than re-pinning.

- [ ] **Step 6: Rebuild shared, run everything**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS. Server suites may now show a car with four slots; that is the point.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sim/weapons/fire.ts packages/shared/src/sim/weapons/fire.test.ts
git commit -m "feat(sim): append the basic attack as fire slot 3 (BA13, BA14, BA20, BA21)"
```

---

### Task 5: The wire accepts bit 3

**Files:**
- Modify: `packages/server/src/sim/tick.ts:27`
- Modify: `packages/server/src/sim/combat-bridge.ts:162-168`
- Test: `packages/server/src/sim/combat-bridge.test.ts` (or `tick.test.ts` — put each test beside the function it covers)

**Interfaces:**
- Consumes: `fireSlotsOf`, `basicAttackOf`, `WEAPON_SLOT_CONFIG.maxFireSlots`.
- Produces: `loadoutFor` returning four ids; a four-bit `SLOT_MASK`.

- [ ] **Step 1: Write the failing tests**

In `combat-bridge.test.ts`:

```ts
  it("resolves a loadout as the kit plus the chassis's basic attack (BA14)", () => {
    expect(loadoutFor("bastion", undefined)).toEqual([
      "thumper",
      "roadblock",
      "wildcharge",
      "basic-attack-bastion",
    ]);
    expect(loadoutFor("mirage", ["predator", "lance", "thumper"])).toEqual([
      "predator",
      "lance",
      "thumper",
      "basic-attack-mirage",
    ]);
  });
```

In `tick.test.ts`, beside the existing mask tests:

```ts
  it("lets a press through on the basic attack's bit, and still strips everything above it (BA15)", () => {
    // Hand-rolled wire data: bit 3 is a real slot now, bit 4 never is.
    const queues = new Map([["p1", [{ seq: 1, steer: 0, throttle: 0, fireSlots: (1 << 3) | (1 << 4) }]]]);
    const result = serverTick(state, queues, 1 / TICK_RATE_HZ, RoomPhase.MATCH, new Map(), new Map());
    expect(result.masks.get("p1")).toBe(1 << 3);
  });
```

Use the file's own `tickWith` / `makePlayer` / `fires` helpers rather than inventing a setup — copy the arrangement from the mask test directly above.

**And update the existing test this widening invalidates.** `packages/server/src/sim/tick.test.ts` currently reads:

```ts
  it("masks off bits beyond maxAbilitySlots", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b1111_1111)]);
    expect(masks.get("p1")).toBe(0b111); // maxAbilitySlots = 3
  });
```

(the constant was renamed by Task 3; the number was not.) It becomes:

```ts
  it("masks off bits beyond maxFireSlots", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b1111_1111)]);
    expect(masks.get("p1")).toBe(0b1111); // three ability slots plus the basic attack (BA15)
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/server/src/sim`
Expected: FAIL — `loadoutFor` returns three ids, and the mask comes back 0 because bit 3 is stripped.

- [ ] **Step 3: Widen `SLOT_MASK`**

`packages/server/src/sim/tick.ts`:

```ts
/** Every bit at or beyond `maxFireSlots` is stripped before a wire mask ever reaches the sim. */
const SLOT_MASK = (1 << WEAPON_SLOT_CONFIG.maxFireSlots) - 1;
```

Update the `serverTick` doc comment's "masked to `WEAPON_SLOT_CONFIG.maxWeaponSlots` bits" sentence to name `maxFireSlots`.

- [ ] **Step 4: Append in `loadoutFor`**

```ts
export function loadoutFor(
  carId: CarId | "",
  explicit: readonly WeaponId[] | undefined,
): readonly string[] {
  // Mirrors `newFireState` exactly, including the appended basic attack — the staleness check above
  // compares against this, so a divergence here would rebuild every car's fire state every tick.
  const kit = explicit ? slotsFrom(carId, explicit) : isCarId(carId) ? slotsOf(carId) : [];
  return isCarId(carId) ? [...kit, basicAttackOf(carId)] : kit;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run packages/server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/sim/tick.ts packages/server/src/sim/combat-bridge.ts packages/server/src/sim/combat-bridge.test.ts packages/server/src/sim/tick.test.ts
git commit -m "feat(net): widen the fire mask to four slots (BA14, BA15)"
```

---

### Task 6: The bot presses it

**Files:**
- Modify: `packages/server/src/bot/brain/personality.ts:127`
- Modify: `packages/server/src/bot/brain/duel.fixture.ts:120,145`
- Modify: `packages/server/src/config/bot-profiles.ts:793`
- Test: `packages/server/src/bot/brain/*.test.ts` (whichever pins the fixture bars — find it with the grep in Step 2)

**Interfaces:**
- Consumes: `fireSlotsOf`, `WEAPON_SLOT_CONFIG.maxFireSlots`.
- Produces: `BOT_BRAIN_VERSION = "5.1.0"`; re-pinned fixture expectations.

- [ ] **Step 1: Give the personality a fourth weight**

In `personality.ts`, change the loop bound and its doc line:

```ts
 * Draws `1 + maxFireSlots` random numbers, always: the archetype, then one weight per slot —
 * including the basic attack, which a bot presses like any other weapon (BA23, BA24).
```

```ts
  for (let i = 0; i < WEAPON_SLOT_CONFIG.maxFireSlots; i++) {
```

- [ ] **Step 2: Point the fixture's press-rate model at the fire slots**

In `duel.fixture.ts`, both loops read the fire slots, because they are asking what the bot can fire:

```ts
  for (const weaponId of fireSlotsOf(carId)) {
```

```ts
  for (const weaponId of fireSlotsOf(carId)) fromCooldowns += seconds / (weaponDefOf(weaponId).cooldownMs / 1000);
```

Swap `slotsOf` for `fireSlotsOf` in the file's import from `@motor-combat-moba/shared`.

- [ ] **Step 3: Bump the brain version**

```ts
export const BOT_BRAIN_VERSION = "5.1.0";
```

with a one-line comment above the constant naming the change: `// 5.1.0: the basic attack (BA24) — a fourth per-slot weight moved every bot's RNG stream.`

- [ ] **Step 4: Run the bot suites and read the failures**

Run: `npx vitest run packages/server/src/bot`
Expected: FAIL on the pinned duel-fixture bars. **This is expected fallout, not a regression** (BA25): the RNG stream shifted by one draw per bot and every car now fires a fourth weapon.

Find the pins:

```bash
grep -rn "toBeGreaterThan\|toBeLessThan\|toBeCloseTo" packages/server/src/bot/brain/*.test.ts | head -40
```

- [ ] **Step 5: Re-pin, one bar at a time**

For each failing expectation: run the fixture, read the new measured value, and move the bar to it — **keeping the same margin the old bar used** (if a bar was `toBeGreaterThan(0.6)` against a measured 0.72, and the new measurement is 0.81, the new bar is `toBeGreaterThan(0.7)`, not `toBeGreaterThan(0.80)`). Add a comment on every bar you move naming BA24 as the cause. Do not widen a margin to make a failure go away; if a bar moves in a direction that surprises you (a bot getting *worse*), stop and investigate before re-pinning.

- [ ] **Step 6: Run the whole server suite**

Run: `npx vitest run packages/server`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/bot packages/server/src/config/bot-profiles.ts
git commit -m "feat(bot): press the basic attack, bump BOT_BRAIN_VERSION to 5.1.0 (BA23-BA25)"
```

---

### Task 7: Input bindings

**Files:**
- Modify: `packages/client/src/config/slot-keys.ts`
- Modify: `packages/client/src/scenes/movement-hint.ts:35-37`
- Test: `packages/client/src/config/slot-keys.test.ts` (create if absent), `packages/client/src/scenes/movement-hint.test.ts`

**Interfaces:**
- Consumes: `WEAPON_SLOT_CONFIG.maxFireSlots`.
- Produces: a four-entry `SLOT_KEYS` indexed by fire slot; `ACTION_KEYS` / `ACTION_ALTS` in display order.

- [ ] **Step 1: Rewrite the failing tests**

`packages/client/src/config/slot-keys.test.ts` already exists and **most of it becomes wrong** — the mouse bindings move, so this is a rewrite, not an append. Replace the whole file:

```ts
import { describe, expect, it } from "vitest";
import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import { SLOT_KEYS, slotMaskFrom } from "./slot-keys.js";

describe("slot keys", () => {
  it("binds every fire slot, the basic attack included", () => {
    expect(SLOT_KEYS.length).toBeGreaterThanOrEqual(WEAPON_SLOT_CONFIG.maxFireSlots);
  });

  it("gives every slot a display glyph for the HUD", () => {
    for (const key of SLOT_KEYS) expect(key.glyph.length).toBeGreaterThan(0);
  });

  it("keeps every printed glyph inside the pill's five-character budget (BA18)", () => {
    // `SLOT_KEY_COLUMN_PX` was measured against "SPACE"; a sixth character overflows the gutter.
    for (const key of SLOT_KEYS) expect(key.glyph.length).toBeLessThanOrEqual(5);
  });

  it("packs held keys into a bitmask, ability slot 1 as bit 0", () => {
    expect(slotMaskFrom([true, false, false])).toBe(0b0001);
    expect(slotMaskFrom([false, true, false])).toBe(0b0010);
    expect(slotMaskFrom([true, true, true])).toBe(0b0111);
    expect(slotMaskFrom([])).toBe(0);
  });

  it("packs the basic attack as bit 3 (BA13)", () => {
    expect(slotMaskFrom([false, false, false, true])).toBe(0b1000);
    expect(slotMaskFrom([true, true, true, true])).toBe(0b1111);
  });

  it("ignores keys past the fire-slot limit", () => {
    expect(slotMaskFrom([true, true, true, true, true])).toBe(0b1111);
  });

  it("fires the basic attack from the left mouse button and ability 1 from the right (BA16)", () => {
    // LMB is the basic attack now — the button a mouse hand reaches for first, for the weapon
    // pressed most. The abilities shifted to RMB / SHIFT / SPACE.
    expect(slotMaskFrom([], 0b01)).toBe(0b1000);
    expect(slotMaskFrom([], 0b10)).toBe(0b0001);
    expect(slotMaskFrom([], 0b11)).toBe(0b1001);
  });

  it("ORs mouse buttons with keys instead of replacing them", () => {
    expect(slotMaskFrom([false, false, true], 0b01)).toBe(0b1100);
    expect(slotMaskFrom([true, false, false], 0)).toBe(0b0001);
  });

  it("ignores mouse bits no slot claims", () => {
    // Middle button (bit 4 of MouseEvent.buttons) is deliberately unbound.
    expect(slotMaskFrom([], 0b100)).toBe(0);
  });
});

describe("slot key glyphs", () => {
  it("binds H / J / K / L with the mouse-hand alternates, in FIRE SLOT order (BA16)", () => {
    // Indexed by fire slot: 0-2 are the ability kit, 3 is the basic attack. SHIFT (16) is a second
    // keyCode on ability 2 the same way SPACE (32) already is on ability 3.
    expect(SLOT_KEYS.map((key) => [...key.codes])).toEqual([[74], [75, 16], [76, 32], [72]]);
    expect(SLOT_KEYS.map((key) => key.buttonsMask)).toEqual([2, 0, 0, 1]);
  });

  it("prints the mouse-hand binding on the gutter pill and keeps a letter glyph for the hint", () => {
    expect(SLOT_KEYS.map((key) => key.glyph)).toEqual(["RMB", "SHIFT", "SPACE", "LMB"]);
    expect(SLOT_KEYS.map((key) => key.keyGlyph)).toEqual(["J", "K", "L", "H"]);
  });

  it("leaves Q and E unbound — still reserved", () => {
    for (const code of [81, 69]) {
      expect(SLOT_KEYS.some((key) => (key.codes as readonly number[]).includes(code))).toBe(false);
    }
  });
});
```

Then in `packages/client/src/scenes/movement-hint.test.ts`, lines 89-92 currently assert the hint is `SLOT_KEYS` in slot order. Replace those four lines with:

```ts
    // Teaching order, not slot order (BA19): the basic attack comes first, because it is the first
    // thing a new player should press — and because the gutter pill never teaches it.
    expect(ACTION_KEYS).toEqual(["H", "J", "K", "L"]);
    expect(ACTION_ALTS).toEqual(["LMB", "RMB", "SHIFT", "SPACE"]);
    expect(new Set(ACTION_ALTS)).toEqual(new Set(SLOT_KEYS.map((key) => key.glyph)));
    expect(new Set(ACTION_KEYS)).toEqual(new Set(SLOT_KEYS.map((key) => key.keyGlyph)));
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/client/src/config packages/client/src/scenes/movement-hint.test.ts`
Expected: FAIL — `SLOT_KEYS` has three entries with the old mouse bindings, and `ACTION_KEYS` reads `["J", "K", "L"]`.

- [ ] **Step 3: Rewrite `SLOT_KEYS`**

```ts
/**
 * Which inputs fire which FIRE SLOT, indexed by slot: 0-2 are the ability kit, 3 is the basic
 * attack (BA13, BA16).
 *
 * Client-only on purpose: the server never sees a key or a mouse button, only a slot index, so a
 * re-bind is a local change with no protocol consequence. Must be at least `maxFireSlots` long.
 *
 * Each slot has TWO bindings: a home-row key under the right hand (H-J-K-L, for driving on WASD),
 * and a mouse-hand alternate. The basic attack takes LMB — the button a player holding a mouse
 * reaches for first, for the weapon they press most — which is why the abilities' mouse bindings
 * shifted to RMB / SHIFT / SPACE. SHIFT is a second `keyCode` (16) rather than a mouse button, the
 * same way SPACE (32) already is on slot 2; only the basic attack and ability 1 carry a
 * `buttonsMask`.
 *
 * The rule from the 2026-08-30 controls pass still stands — a binding nobody printed is a thing
 * that breaks quietly later — but the basic attack BENDS it and the spec says so (BA19): it has no
 * gutter pill, because hiding it from the panel is the feature, so the countdown action hint is the
 * only place either of its bindings is taught. Do not remove that hint.
 *
 * `codes` are standard DOM `KeyboardEvent.keyCode` values — the same numbers `Phaser.Input.
 * Keyboard.KeyCodes` exposes (`H` 72, `J` 74, `K` 75, `L` 76, `SHIFT` 16, `SPACE` 32) — spelled out
 * here rather than imported from `phaser`, because importing the `phaser` package runs its browser
 * device-detection code at module load and crashes under this project's node-environment tests.
 *
 * `buttonsMask` is a DOM `MouseEvent.buttons` bitmask (1 left, 2 right) — the same value Phaser's
 * `Pointer.buttons` carries — so a slot fires while any of its bits is held. 0 means the slot has
 * no mouse binding.
 *
 * "SHIFT" is five characters, the same width budget `SLOT_KEY_COLUMN_PX` was measured against for
 * "SPACE" — a longer pill label overflows the gutter's right edge, so re-measure before wording one
 * differently.
 */
export const SLOT_KEYS = [
  { codes: [74], buttonsMask: 2, glyph: "RMB", keyGlyph: "J" },
  { codes: [75, 16], buttonsMask: 0, glyph: "SHIFT", keyGlyph: "K" },
  { codes: [76, 32], buttonsMask: 0, glyph: "SPACE", keyGlyph: "L" },
  { codes: [72], buttonsMask: 1, glyph: "LMB", keyGlyph: "H" },
] as const;

/** Fire slots in the order the countdown hint teaches them: basic attack first (BA19). */
export const HINT_SLOT_ORDER = [3, 0, 1, 2] as const;
```

and in `slotMaskFrom`, change the limit:

```ts
  const limit = Math.min(SLOT_KEYS.length, WEAPON_SLOT_CONFIG.maxFireSlots);
```

- [ ] **Step 4: Reorder the hint**

In `movement-hint.ts`:

```ts
export const ACTION_KEYS: readonly string[] = HINT_SLOT_ORDER.map((slot) => SLOT_KEYS[slot]!.keyGlyph);
export const ACTION_ALTS: readonly string[] = HINT_SLOT_ORDER.map((slot) => SLOT_KEYS[slot]!.glyph);
```

importing `HINT_SLOT_ORDER` alongside `SLOT_KEYS`. Extend the block comment above them: the hint reads in teaching order, not slot order, because the basic attack is the first thing a new player should press.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run packages/client`
Expected: PASS. A snapshot or layout test that counted three pills in the action row needs its count updated to four — do that, and only that.

- [ ] **Step 6: Check the reserved keys are still free**

Run: `grep -rn "addKey(81)\|addKey(69)" packages/client/src`
Expected: no hits. Q (81) and E (69) stay unbound.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/config/slot-keys.ts packages/client/src/config/slot-keys.test.ts packages/client/src/scenes/movement-hint.ts packages/client/src/scenes/movement-hint.test.ts
git commit -m "feat(controls): bind the basic attack to H and LMB, shift abilities to RMB/SHIFT/SPACE (BA16-BA19)"
```

---

### Task 8: The HUD stays three boxes, and the bolt is visible

**Files:**
- Modify: `packages/client/src/scenes/weapon-hud.ts:272`
- Modify: `packages/client/src/scenes/ArenaScene.ts:2707` and the `renderWeaponHud` doc comment near line 2829
- Modify: `packages/client/src/scenes/combat-visual.ts` (`WEAPON_GLOW_STYLES`, around line 307)
- Test: `packages/client/src/scenes/weapon-hud.test.ts`, `packages/client/src/scenes/combat-visual.test.ts`

**Interfaces:**
- Consumes: `WEAPON_SLOT_CONFIG.maxAbilitySlots`, `CAR_TABLE`, `basicAttackOf`.
- Produces: `slotBarLayout` capped at the ability count; nine `WEAPON_GLOW_STYLES` entries.

- [ ] **Step 1: Write the failing tests**

In `weapon-hud.test.ts`:

```ts
  it("draws the ability kit only, never the basic attack, however many slots a car carries (BA15)", () => {
    // A car's schema `weapons` array carries four rows now. The bar is the ABILITY panel.
    expect(slotBarLayout(4, 1280, 720, 200, 0)).toHaveLength(WEAPON_SLOT_CONFIG.maxAbilitySlots);
  });
```

In `combat-visual.test.ts`:

```ts
  it("gives every basic attack a lit core, so a near-black bolt reads on dark asphalt (BA8)", () => {
    for (const carId of Object.keys(CAR_TABLE) as CarId[]) {
      const style = WEAPON_GLOW_STYLES[basicAttackOf(carId)];
      expect(style, carId).toBeDefined();
      // The outermost solid band sits exactly ON the hitbox — the existing halo test asserts this
      // for every style, and a basic attack authors no halo at all.
      expect(Math.max(...style!.bands.map((b) => b.radiusScale)), carId).toBe(1);
      expect(style!.halo, carId).toBeUndefined();
      expect(style!.flickerDepth, carId).toBe(0);
    }
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/client/src/scenes`
Expected: FAIL — `slotBarLayout(4, …)` returns 4 boxes only if `maxAbilitySlots` is wrong (it should already pass after Task 3's rename; if so, keep the test as a regression guard and say so), and `WEAPON_GLOW_STYLES` has no basic-attack entry.

- [ ] **Step 3: Make the HUD cap explicit**

In `weapon-hud.ts`, the cap is already `maxAbilitySlots` after Task 3. Replace the `slotBarLayout` doc line that says "drawing `min(weapons.length, maxWeaponSlots)` boxes" (and its twin on `ArenaScene.renderWeaponHud`) with:

```
 * The slot bar draws the ABILITY kit — `min(weapons.length, maxAbilitySlots)` boxes. A car's
 * `weapons` array carries four rows as of 2026-09-17; the fourth is its basic attack and it is
 * deliberately not drawn (BA15). That is a decision, not a truncation that happens to work: if the
 * basic attack ever needs a readout, it gets its own, not a fourth box here.
```

- [ ] **Step 4: Author the glow style**

In `combat-visual.ts`, above `WEAPON_GLOW_STYLES`:

```ts
/**
 * The basic attack's look (BA8): a near-black bolt with a lit core.
 *
 * A weapon with no entry here draws as a single flat fill of its `color`, and a flat `#101014` disc
 * on dark asphalt is close to invisible — so "shiny black" has to be authored. Concentric bands are
 * all this renderer has (a band is a radius, not a position), so the highlight is a small bright
 * CORE rather than an off-centre specular: the bolt reads as a polished sphere lit from inside.
 *
 * No halo and no flicker, for `magmablast`'s reason: a pulsing outline on a 12-unit disc reads as a
 * rendering fault rather than as light, and a static style costs no per-frame hash.
 */
const BASIC_ATTACK_GLOW: GlowStyle = {
  bands: [
    { radiusScale: 1, color: "#101014" },
    { radiusScale: 0.66, color: "#2E3138" },
    { radiusScale: 0.3, color: "#9AA3B2" },
  ],
  flickerDepth: 0,
  flickerHz: 0,
};
```

and inside the table literal, after the `magmablast` entry:

```ts
  // One authored look, nine ids. Spread rather than nine copies for `BASIC_ATTACK_BASE`'s reason:
  // this table is a `Partial<Record<…>>` read by index, so nothing here depends on literal keys.
  ...Object.fromEntries(
    (Object.keys(CAR_TABLE) as CarId[]).map((carId) => [basicAttackOf(carId), BASIC_ATTACK_GLOW]),
  ),
```

Add `CAR_TABLE`, `basicAttackOf` and `type CarId` to the file's imports from `@motor-combat-moba/shared`.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run packages/client`
Expected: PASS, including the existing "keeps every halo band translucent" test, which now iterates ten styles.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/scenes
git commit -m "feat(hud): keep the slot bar at three, light the basic attack's bolt (BA8, BA15)"
```

---

### Task 9: The playground

**Files:**
- Modify: `packages/client/src/dev/playground/ui-model.ts` — `weaponOptions()` (~line 93), the picker list at ~line 108, `statsTabs`'s weapon groups (~line 168)
- Test: `packages/client/src/dev/playground/ui-model.test.ts`

**Interfaces:**
- Consumes: `WEAPON_TABLE`, `basicAttackOf`, `enabledSeats` (existing, same file).
- Produces: `weaponOptions()` excluding basic attacks; `statsTabs` weapon groups including each enabled seat's basic attack, uniquely titled.

- [ ] **Step 1: Rewrite the two tests this changes**

In `ui-model.test.ts`, replace the `describe("weaponOptions", …)` block with:

```ts
describe("weaponOptions", () => {
  it("lists every ABILITY row of WEAPON_TABLE, and no basic attack (BA37)", () => {
    // A tester could otherwise seat another chassis's basic attack as Mirage's slot 1 — a car with
    // two basic attacks, one of them borrowed — and nine options all reading "Basic Attack" would
    // be unusable anyway. The basic attack is a property of the chassis, not of the loadout.
    const options = weaponOptions();
    const expectedIds = (Object.keys(WEAPON_TABLE) as WeaponId[]).filter(
      (id) => !id.startsWith("basic-attack-"),
    );
    expect(options.map((o) => o.id).sort()).toEqual([...expectedIds].sort());
    for (const id of expectedIds) {
      expect(options.find((o) => o.id === id)?.name).toBe(WEAPON_TABLE[id].name);
    }
  });
});
```

Replace the weapons-tab test (`it("gives each SELECTED weapon its own group under weapons, and no other weapon", …)`) with:

```ts
  it("gives each SELECTED weapon its own group under weapons, plus each seat's basic attack (BA38)", () => {
    // Nine rows share the name "Basic Attack", so a shared name is titled by id instead.
    const weapons = statsTabs(twoCarSetup())[2]!;
    expect(weapons.groups.map((g) => g.title)).toEqual([
      WEAPON_TABLE.thumper.name,
      WEAPON_TABLE.roadblock.name,
      WEAPON_TABLE.wildcharge.name,
      "basic-attack-bastion",
      WEAPON_TABLE.predator.name,
      WEAPON_TABLE.thunderclap.name,
      WEAPON_TABLE.afterburner.name,
      "basic-attack-mirage",
    ]);
  });
```

**Read `twoCarSetup()` in that file before pinning this order** — it decides which chassis sit in which seat, and the group order follows seat order then `tunableFields()` order. If the helper seats different chassis than `bastion` and `mirage`, use the ones it actually seats; the shape of the assertion (each seat's three abilities, then its basic attack titled by id) is what matters.

Update the neighbouring `it("dedupes a chassis and a weapon both cars picked", …)`: both seats are the same chassis in `defaultPlaygroundSetup()`, so they share one basic attack too — `expect(tabs[2]!.groups).toHaveLength(4)`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/client/src/dev`
Expected: FAIL — `weaponOptions` lists all nineteen rows, and the weapons tab has no basic-attack group.

- [ ] **Step 3: Filter the pickers**

```ts
/**
 * The weapons a playground seat may be given. ABILITY rows only (BA37): the basic attack is a
 * property of the chassis, not of the loadout, so it is never picked — `newFireState` appends the
 * driven car's own.
 */
export function weaponOptions(): { id: WeaponId; name: string }[] {
  return Object.values(WEAPON_TABLE)
    .filter((row) => !row.id.startsWith("basic-attack-"))
    .map((row) => ({ id: row.id, name: row.name }));
}
```

Apply the same `.filter(...)` to the second `Object.values(WEAPON_TABLE)` list around line 108 **only if** it feeds a loadout picker. Read its surrounding comment first: if it feeds the VFX panel's weapon list, leave it — tuning a basic attack's burst is wanted.

- [ ] **Step 4: Add each seat's basic attack to the tuning panel**

In `statsTabs`:

```ts
  // Each seat's three abilities AND its chassis's basic attack (BA38). The panel is built from the
  // seats' own loadouts rather than from `WEAPON_TABLE`, so a weapon nobody seated has no group —
  // and a basic attack would have no group at all unless it is added here, which would leave BA36's
  // expected retune with no knob to reach for.
  const weaponIds = [
    ...new Set(seats.flatMap((car) => [...car.weapons, basicAttackOf(car.carId)])),
  ];
  const weaponGroups: StatsGroup[] = [];
  for (const weaponId of weaponIds) {
    const weaponFields = fields.filter((f) => f.group === "weapon" && f.ownerId === weaponId);
    if (weaponFields.length > 0) {
      // Nine rows share the name "Basic Attack" (BA5), so a shared name falls back to the id — the
      // smallest fix, and one that needs no second name field on `WEAPON_TABLE`.
      const name = WEAPON_TABLE[weaponId].name;
      const shared = Object.values(WEAPON_TABLE).filter((row) => row.name === name).length > 1;
      weaponGroups.push({ title: shared ? weaponId : name, fields: weaponFields });
    }
  }
```

Import `basicAttackOf` from `@motor-combat-moba/shared`.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run packages/client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/dev/playground
git commit -m "feat(playground): hide basic attacks from the loadout pickers, tune them per seat (BA37, BA38)"
```

---

### Task 10: The harnesses count it

**Files:**
- Modify: `packages/server/balance/stats.ts:226`
- Modify: `scripts/ttk.mjs:144,258`
- Test: `packages/server/balance/stats.test.ts` (if the file exists; otherwise verify by running the harness in Step 4)

**Interfaces:**
- Consumes: `fireSlotsOf`.
- Produces: a balance report whose weapons table includes every basic attack; ttk rotations that fire it.

- [ ] **Step 1: Seed the balance accumulators from the fire slots**

```ts
  for (const carId of carIds) {
    // `fireSlotsOf`, not `slotsOf` (BA30): the bots press the basic attack, and a weapon nobody
    // seeded accumulates into maps that `weaponCarOf.entries()` never reads — silently absent from
    // the report, which is the exact failure this up-front seeding exists to prevent.
    for (const weaponId of fireSlotsOf(carId)) {
```

Swap the import.

- [ ] **Step 2: Leave the seat filter alone**

Confirm `packages/server/balance/runner.ts:66` still reads `slotsOf`:

```bash
grep -n "slotsOf" packages/server/balance/runner.ts
```

Expected: `return ids.filter((id) => slotsOf(id).length > 0);` — unchanged. A prototype whose only weapon is the one every chassis carries measures nothing (BA30).

- [ ] **Step 3: Count it in ttk's rotation**

In `scripts/ttk.mjs`, line 144 and line 258 both become `fireSlotsOf(attacker)`; `armedCarIds()` at line 226 keeps `slotsOf`. Add to the import list at line 64. Extend the comment above `simulateTtk`:

```js
 * The kit is `fireSlotsOf` (BA31) — a time-to-kill that ignored a trigger the car actually pulls
 * would answer a question nobody asked. The ATTACKER AXIS is still `armedCarIds()`, off `slotsOf`:
 * a chassis whose only weapon is the basic attack every chassis has books a row that measures
 * nothing.
```

- [ ] **Step 4: Run both harnesses and read the output**

```bash
npm run ttk
npm run balance -- --shape=duel --matches=4 --seed=7
```

Expected: `ttk` prints every kill time lower than before and lists a `basic-attack-*` row per shipped chassis in its one-press table; the balance report's weapons table lists a basic attack per seated car with a non-zero press count. If a basic attack shows `presses: 0`, the bot is not firing it — stop and diagnose before continuing.

- [ ] **Step 5: Commit**

```bash
git add packages/server/balance/stats.ts scripts/ttk.mjs
git commit -m "feat(harness): count the basic attack in ttk and the balance weapons table (BA30, BA31)"
```

---

### Task 11: The players' guide

**Files:**
- Modify: `scripts/build-cars-and-weapons.mjs` (`OWNER_OF` ~line 115, `WEAPONS` ~line 257, `derive` ~line 191, `weaponCard` ~line 612, `carSection` ~line 659, `iconMarkup` ~line 339)
- Modify: `scripts/cars-and-weapons-copy.mjs` (`WEAPON_COPY`)
- Regenerate: `packages/client/public/manual.html`
- Test: `scripts/manual-page.test.mjs`, `scripts/manual-facts.test.mjs`

**Interfaces:**
- Consumes: `basicAttackOf`, `activeCarIds`.
- Produces: a "Basic attack" card at the head of each active chassis's weapon list.

- [ ] **Step 1: Give every basic attack a copy line**

In `cars-and-weapons-copy.mjs`, append to `WEAPON_COPY` — nine entries, the same sentence, because the nine weapons are the same weapon:

```js
  "basic-attack-bullseye": { line: "Always loaded. A plain black bolt, and the only shot that never runs out." },
  "basic-attack-mirage": { line: "Always loaded. A plain black bolt, and the only shot that never runs out." },
  "basic-attack-bastion": { line: "Always loaded. A plain black bolt, and the only shot that never runs out." },
  "basic-attack-taurus": { line: "Always loaded. A plain black bolt, and the only shot that never runs out." },
  "basic-attack-anvil": { line: "Always loaded. A plain black bolt, and the only shot that never runs out." },
  "basic-attack-prowler": { line: "Always loaded. A plain black bolt, and the only shot that never runs out." },
  "basic-attack-cleaver": { line: "Always loaded. A plain black bolt, and the only shot that never runs out." },
  "basic-attack-skorpios": { line: "Always loaded. A plain black bolt, and the only shot that never runs out." },
  "basic-attack-caprico": { line: "Always loaded. A plain black bolt, and the only shot that never runs out." },
```

No digits and no spelled-out measurements — `manual-facts.test.mjs` fails on both.

- [ ] **Step 2: Teach the builder the fourth weapon**

`OWNER_OF` and `WEAPONS` both derive from `slotsOf`; both need the basic attack, because `derive()` is what turns a row into card data:

```js
const OWNER_OF = Object.fromEntries(
  CAR_IDS.flatMap((carId) => [...slotsOf(carId), basicAttackOf(carId)].map((weaponId) => [weaponId, carId])),
);
```

```js
const WEAPONS = CAR_IDS.flatMap((carId) => [...slotsOf(carId), basicAttackOf(carId)]).map(derive);
```

Import `basicAttackOf` at line 51. **Do not** use `fireSlotsOf` here: this file publishes the ACTIVE subset and builds both maps from `CAR_IDS`, and the distinction is worth keeping visible at the two call sites.

- [ ] **Step 3: Label the card**

`derive()` computes `const slot = slotsOf(carId).indexOf(id);`, which is `-1` for a basic attack. Give the derived row an explicit label instead of indexing a label array:

```js
  const slot = slotsOf(carId).indexOf(id);
  // `-1` means this is the chassis's basic attack, not a kit slot (BA27): indexing `SLOT_LABEL` by
  // a fire-slot index would print `undefined`.
  const slotLabel = slot < 0 ? "Basic attack" : SLOT_LABEL[slot];
```

and add `slotLabel` to the returned object. In `weaponCard`, replace `${esc(SLOT_LABEL[w.slot])}` with `${esc(w.slotLabel)}`.

- [ ] **Step 4: Put it first in the list**

```js
    <div class="weapons">${[basicAttackOf(carId), ...slotsOf(carId)].map((id) => weaponCard(byId[id])).join("")}</div>
```

- [ ] **Step 5: Make the icon fallback visible on a dark page**

`iconMarkup`'s fallback swatch paints raw `w.def.color`, and `#101014` is invisible against the page. Lift it the way the accent rule already is:

```js
  return `<div class="icon-fallback" style="background:${lift(w.def.color)}" aria-hidden="true"></div>`;
```

This changes nothing for any weapon shipping today — all nine carried ability weapons have icons — and it is what keeps the new card legible until someone draws one.

- [ ] **Step 6: Rebuild and look at the page**

```bash
npm run build -w @motor-combat-moba/shared
npm run build:manual
```

Then open `packages/client/public/manual.html` and confirm: three chassis, each opening with a "Basic attack" card, each card showing 20 damage scaled by that chassis's attack rating, a 0.8s recharge, and a 960-unit reach.

- [ ] **Step 7: Run the page guards**

Run: `npx vitest run scripts/manual-page.test.mjs scripts/manual-facts.test.mjs scripts/check-art.test.mjs`
Expected: PASS. The stamp moved (BA29) and the rebuild is what satisfies it.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-cars-and-weapons.mjs scripts/cars-and-weapons-copy.mjs packages/client/public/manual.html
git commit -m "docs(manual): publish a Basic attack card on every chassis (BA26-BA29)"
```

---

### Task 12: Docs and full verification

**Files:**
- Modify: `CLAUDE.md`, `docs/combat-model.md`, `docs/config-reference.md`, `docs/schema-reference.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a green repo and a summary that names what moved.

- [ ] **Step 1: `CLAUDE.md`**

Add a paragraph after the statuses paragraph, in this file's voice — what the thing is, what it is not, and the trap:

```markdown
**Every car carries a fourth weapon it never sees in the HUD: its basic attack.** Nine
`basic-attack-<carId>` rows in `WEAPON_TABLE`, all nine identical today and all spreading one
`BASIC_ATTACK_BASE`, held on a `CarDef.basicAttack` field **beside** the three-weapon kit rather
than inside it. **`CarDef.weapons` and `slotsOf` still mean the three ABILITY slots** — the HUD, the
guide, the playground's loadout picker, the balance seat filter, ttk's attacker axis and the bot's
reach model all depend on that and are the reason it did not widen. `fireSlotsOf(carId)` is where
the two are joined, and it has exactly three readers: `newFireState`, `balance/stats.ts`'s
accumulator seeding, and `scripts/ttk.mjs`. The basic attack is always fire slot 3 (`H` / `LMB`; the
abilities moved to `J`/`RMB`, `K`/`SHIFT`, `L`/`SPACE`), rides the ordinary fire state machine with
`recoveryMs: 0`, and loses a same-tick tie to an ability because the lowest set bit wins. Its
binding is taught **only** in the countdown action hint — it has no gutter pill, which is the one
place the "a binding nobody printed breaks quietly" rule is knowingly bent. See
[`docs/superpowers/specs/2026-09-17-basic-attack-design.md`](docs/superpowers/specs/2026-09-17-basic-attack-design.md) (BA1–BA38).
```

Also update the two places in `CLAUDE.md` that count the roster ("the nine-weapon roster", "**All nine carried weapons read `ok`**" in the art section) to say what is now true: ten authored ability rows plus nine basic attacks, and nine icon-less basic-attack rows warning alongside `tremor`.

- [ ] **Step 2: `docs/combat-model.md`**

Add a "Basic attack" subsection under the weapons section covering: what it is, the slot index, the bindings, that it shares the fire state machine, that an ability beats it on a tie, and that it is hidden from the slot bar by decision rather than by truncation.

- [ ] **Step 3: `docs/config-reference.md`**

Document `CarDef.basicAttack`, the renamed `WEAPON_SLOT_CONFIG.maxAbilitySlots`, the new `maxFireSlots` and `basicAttackSlotIndex`, and `BASIC_ATTACK_BASE`'s numbers. Update the "Adding an inactive chassis" section: a prototype still carries `weapons: []` **and** must carry its own `basicAttack`.

- [ ] **Step 4: `docs/schema-reference.md`**

`PlayerState.weapons` now carries four `WeaponSlotState` rows — three ability slots and the basic attack at index 3, which the HUD does not draw.

- [ ] **Step 5: Full verification**

```bash
npm run build
npm test
npm run check:art
```

Expected: build clean; all suites pass; `check:art` reports nine new `basic-attack-*` warnings (no manifest row) alongside `tremor`'s and **zero blockers**.

- [ ] **Step 6: Confirm the server bundle actually has the new sim**

```bash
grep -c "basic-attack-mirage" packages/server/dist/index.js
```

Expected: at least 1. Zero means shared was built after the server — rebuild with root `npm run build`.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "docs: record the basic attack in CLAUDE.md and the reference docs (BA35)"
git push -u origin feature/basic-attack
```

- [ ] **Step 8: Say the playtest part out loud**

In the final summary to the user, state plainly: this changed weapon reach, fire cadence and per-press damage, so `packages/server/playtest/`'s weapon-reach and ram-trigger probes now measure a different game; **recommend `npm run playtest`** and name the probes. Do not run it, and do not edit a probe unless it failed to compile — in which case say that you fixed it.

---

## Notes for the executor

- **`BA36` is a known, accepted risk, not a bug to fix.** The 960-unit range is longer than most of the roster's weapons and the user knows. Do not "helpfully" lower it.
- **Do not widen `slotsOf`.** Every time a task looks like it wants a fourth weapon out of `slotsOf`, the answer is either `fireSlotsOf` (three named readers) or `basicAttackOf` (everything else).
- **A failing pinned bot bar in Task 6 is expected.** A failing `golden.test.ts` at any point is not — stop and investigate.
- **Never run `npm run build --workspaces`.** Root `npm run build` only.
